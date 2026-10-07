#!/usr/bin/env node
/**
 * verify-backend-runtime.js — 后端打包产物的**运行时**闸门（fail-closed）
 *
 * 为什么必须有这一步
 * ------------------
 * 本仓库 CI（`.github/workflows/ci.yml` 的 `electron-build` job）里，产物可用性验证
 * 原先**全是静态的**：
 *
 *   - `Test-Path backend/scada-backend.exe` —— 只证明文件存在；
 *   - 残留文件 `LastWriteTime` 断言 —— 只证明时间戳；
 *   - `npm run verify:dist` —— 只读 `dist/index.html` 的引用是否落地；
 *   - `node tools/verify-asar.js` —— 只读 asar 里的引用是否落地。
 *
 * 也就是说：`electron/main.js` 的 spawn 链路、端口发现、健康等待
 * **从未在任何自动化里被执行过**。而 PyInstaller 的失败模式恰好全在运行时：
 * 缺 `hiddenimports`、`datas` 漏文件、冻结环境路径推导错 ——
 * **打包阶段一个都不报**，只有进程启动那一刻才炸。
 * 于是「构建成功 + exe 存在 + CI 全绿」与「产物一运行就崩」可以同时成立。
 * 这是典型的 **fail-open 闸门**：闸门装了，但它测的性质与「能不能用」无关。
 *
 * 本脚本把闸门改成 fail-closed，判五件事：
 *
 *   1. 进程**活着**（没在启动阶段就退出 —— 缺 hiddenimport 的典型症状）；
 *   2. 端口**起来了**；
 *   3. `/api/health/status` 返回 200 且 `success == true`；
 *   4. 健康判定**没有确定的负面信号**，且后台巡检线程**已跑过至少一轮**；
 *   5. **前后端契约**：后端写出的 `runtime.json`，必须能在**前端自己算出的路径**
 *      上找到，且里面的端口等于实际监听端口。
 *
 * 第 5 条是本脚本与后端仓库那份闸门（`.github/scripts/smoke_packaged_backend.py`）
 * 的本质区别，也是它存在的主要理由 —— 后端那份测的是「后端自己能不能跑」，
 * 测不到「前端能不能找到它」。而 2026-09-24 实测到的真实缺陷正好落在这一层：
 *
 *   `electron/main.js` 原先拼的是 `<backend_dir>/data/runtime.json`，注释还写着
 *   「与后端 paths.RUNTIME_JSON_PATH 对齐」。但实际发布的 onedir 布局下，
 *   后端 `paths.py` 取 `_BASE = exe_dir/_internal`，文件落在
 *   `<backend_dir>/_internal/data/runtime.json`。
 *   于是 `readRuntimePort()` 恒返回 null，整个 5000/5001 端口发现机制
 *   **从未生效过** —— 只是回退值 5000 恰好等于模拟模式端口才没暴露。
 *
 *   **静态检查永远抓不到这个**：文件都在、引用都对、exe 能跑。
 *   只有「起真服务 → 让后端写出端口文件 → 用前端的口径去找它」才能抓到。
 *
 * 关于第 4 条：`/api/health/status` 是**探活**接口，磁盘写满 / 内存打爆 /
 * 落库停摆时**照样返回 200** —— 只看状态码等于没测。结论在响应体里
 * （`global_status` / `modules` / `checks`）。
 *
 * **刻意没有「跳过」分支**：exe 不存在、进程提前退出、端口一直不开、
 * 健康端点非 200、判定出负面信号、端口文件找不到 —— 一律 exit 1。
 * 闸门不允许静默放行。
 *
 * 用法：
 *   node tools/verify-backend-runtime.js [--exe backend/scada-backend.exe]
 *                                        [--ports 5000,5001]
 *                                        [--health-path /api/health/status]
 *                                        [--timeout 180] [--checks-timeout 150]
 *
 * 退出码：
 *   0 = 通过；1 = 闸门失败（任何原因）；2 = 命令行用法错误
 *
 * 注意：不带参数启动时后端进**模拟模式**（`devices_simulated.yaml`），
 * 不会去连真实设备 —— 这是冒烟该有的姿势。
 */
'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

// 前后端共用的定位口径 —— **不允许在本文件里另写一份**。
// 闸门要验的就是「前端的口径能不能找到后端的产物」，所以它必须用前端真正在用的那份实现。
const backendPaths = require('../electron/backend-paths');

//: 默认候选端口。模拟模式用 `WebConfig.PORT`（5000），真实/模拟器模式用 5001
//: （`run.py:446`：`WebConfig.REAL_PORT if not simulation_mode else WebConfig.PORT`）。
const DEFAULT_PORTS = '5000,5001';

//: 默认健康端点。它是**唯一无需认证**的健康接口
//: （`/status/detail` 与 `/checks` 都挂了 `@jwt_required`）。
const DEFAULT_HEALTH_PATH = '/api/health/status';

//: 等待端口起来的默认秒数。
const DEFAULT_TIMEOUT = 180;

//: 端口起来后等待健康检查解析的默认秒数。
//:
//: 必须**显著大于** `run.py` 里 `start_periodic_checks(interval=30)` 的间隔：
//: 巡检线程是「先 sleep 再跑第一轮」（`core/health_checker.py`），
//: 所以闸门至少要等一个完整间隔才能看到检查项从 `unknown` 变成结论。
//: 这是两处独立常量，靠 `tests/tools/verify-backend-runtime.test.ts` 里的守卫用例绑住。
const DEFAULT_CHECKS_TIMEOUT = 150;

//: 「模块未就绪」的状态集合，口径与 `展示层/api/api_health.py` 一致。
const BAD_MODULE_STATUSES = ['error', 'disabled', 'unavailable'];

//: 唯一被当作硬失败的检查项状态。
const UNHEALTHY = 'unhealthy';

//: 响应体读取上限，防止异常产物吐出巨量内容把 CI 日志刷爆。
const MAX_BODY_BYTES = 1 << 20;

// --------------------------------------------------------------------------
// 纯函数（可单测）
// --------------------------------------------------------------------------

/**
 * 把 `"5000,5001"` 解析成 `[5000, 5001]`（去重、保序、校验越界）。
 * @param {string} raw
 * @returns {number[]}
 */
function candidatePorts(raw) {
  const out = [];
  for (const part of String(raw).split(',')) {
    const s = part.trim();
    if (!s) continue;
    if (!/^\d+$/.test(s)) throw new Error(`非法端口: ${JSON.stringify(part)}`);
    const port = Number(s);
    if (!(port >= 1 && port <= 65535)) throw new Error(`端口越界: ${port}`);
    if (!out.includes(port)) out.push(port);
  }
  if (out.length === 0) throw new Error('候选端口列表为空');
  return out;
}

/**
 * 取文本末尾 `limit` 个字符（失败时打日志用，别把 CI 日志刷爆）。
 * @param {string} text
 * @param {number} [limit]
 * @returns {string}
 */
function tail(text, limit = 4000) {
  const s = String(text || '');
  if (!s) return '(空)';
  return s.length <= limit ? s : '…(前略)\n' + s.slice(-limit);
}

/**
 * 把 `/api/health/status` 的响应体归纳成判定结果（纯函数）。
 *
 * 响应结构（见 `展示层/api/api_health.py` 与 `core/health_checker.py`）：
 * ```
 * {"success": true,
 *  "data": {"global_status": "healthy|degraded|unhealthy",
 *           "modules": {"data_collector": {"status": "initialized"}, ...},
 *           "checks": {"global_status": ...,
 *                      "checks": {"database": {"status": ..., "last_check": iso8601|null},
 *                                 ...},
 *                      "total_checks": 6}}}
 * ```
 *
 * 判定口径 —— **只对确定的负面信号判负**：
 *   - `success !== true` / 缺 `data`            → 判负（接口本身坏了）
 *   - `global_status === 'unhealthy'`           → 判负
 *   - `checks.global_status === 'unhealthy'`    → 判负（巡检线程自己的结论）
 *   - 任一模块 `error|disabled|unavailable`      → 判负
 *   - 任一检查项 `unhealthy`                     → 判负
 *
 * `unknown`（巡检还没跑第一轮）与 `degraded`（数据新鲜度临界，阈值很紧：
 * `STALE_DEGRADED_SECONDS = 30`）**不判负** —— 前者是启动瞬态，后者会随 runner
 * 快慢抖动。**会抖的闸门早晚被人关掉。**
 *
 * `unhealthy_modules` 这个派生字段**不采信**，一律从 `modules` 重算：
 * 一个派生字段写错了，采信它的人就会跟着错。
 *
 * @param {any} payload
 * @returns {{ok: boolean, reason: string, global_status: string|null,
 *            modules: Record<string,string|null>, checks: Record<string,string|null>,
 *            resolved: boolean}}
 */
function assessHealth(payload) {
  const result = {
    ok: true, reason: '', global_status: null,
    modules: {}, checks: {}, resolved: false,
  };
  const fail = (reason) => ({ ...result, ok: false, reason });

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return fail('响应不是 JSON 对象');
  }
  if (payload.success !== true) {
    return fail(`success != true（${JSON.stringify(payload.success)}）—— 接口返回了业务错误`);
  }
  const data = payload.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return fail('data 字段缺失或不是对象');
  }

  result.global_status = data.global_status === undefined ? null : data.global_status;

  const modules = (data.modules && typeof data.modules === 'object') ? data.modules : {};
  for (const [name, info] of Object.entries(modules)) {
    result.modules[name] = (info && typeof info === 'object') ? (info.status ?? null) : null;
  }

  const wrapper = (data.checks && typeof data.checks === 'object') ? data.checks : {};
  const inner = (wrapper.checks && typeof wrapper.checks === 'object') ? wrapper.checks : {};
  for (const [name, info] of Object.entries(inner)) {
    result.checks[name] = (info && typeof info === 'object') ? (info.status ?? null) : null;
  }
  result.resolved = Object.values(inner).some(
    (info) => info && typeof info === 'object' && Boolean(info.last_check),
  );

  if (result.global_status === UNHEALTHY) return fail("global_status == 'unhealthy'");
  if (wrapper.global_status === UNHEALTHY) {
    return fail("checks.global_status == 'unhealthy'（巡检线程自己的结论）");
  }
  const badModules = Object.keys(result.modules)
    .filter((n) => BAD_MODULE_STATUSES.includes(result.modules[n])).sort();
  if (badModules.length) {
    return fail(`模块未就绪 ${JSON.stringify(badModules)} —— 打包缺 hiddenimport 的典型表现`);
  }
  const badChecks = Object.keys(result.checks)
    .filter((n) => result.checks[n] === UNHEALTHY).sort();
  if (badChecks.length) {
    return fail(`健康检查项为 unhealthy: ${JSON.stringify(badChecks)}`);
  }
  return result;
}

/**
 * 记录一棵树下的 `{files:Set, dirs:Set}`（相对路径）。
 * @param {string} root
 */
function snapshotTree(root) {
  const files = new Set();
  const dirs = new Set();
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      let rel;
      try {
        rel = path.relative(root, full);
      } catch (e) {
        continue;
      }
      if (ent.isDirectory()) {
        dirs.add(rel);
        walk(full);
      } else if (ent.isFile()) {
        files.add(rel);
      }
    }
  };
  walk(root);
  return { files, dirs };
}

/**
 * 删掉冒烟运行期间在产物目录里**新建**的文件与空目录，返回删不掉的路径。
 *
 * 为什么必须做：冒烟会**真启动产物**，而产物首次运行会在自己旁边建库 /
 * 写 `runtime.json` / 建 `logs`。本仓库的 `backend/` 是 `extraResources`
 * 的源目录（`package.json` 的 `extraResources: from backend/ → to backend/`，
 * filter 是「全部文件，再排除 `*.log` / `logs` / `exports` / `__pycache__` / `*.pyc`」）——
 * **`data/` 不在排除列表里**，而且 electron-builder 不看 `.gitignore`。
 * 也就是说：若不清理，冒烟跑出来的模拟数据库 / `runtime.json`
 * 会**原样打进安装包，装到用户机器上**。
 *
 * 用「运行前后清单求差」而不是「按目录名删固定几个」，而且**只删本次新建的**：
 * 哪天打包配置真的开始随包携带 `data/` 预置内容、或携带一个空目录，
 * 按名字删会把产物自己的东西一起删掉。
 *
 * @param {string} root
 * @param {{files:Set<string>, dirs:Set<string>}} before
 * @returns {string[]}
 */
function cleanupCreated(root, before) {
  const after = snapshotTree(root);
  const failed = [];

  const depthDesc = (a, b) => b.split(path.sep).length - a.split(path.sep).length;
  const newFiles = [...after.files].filter((f) => !before.files.has(f)).sort(depthDesc);
  for (const rel of newFiles) {
    try {
      fs.unlinkSync(path.join(root, rel));
    } catch (e) {
      failed.push(rel);
    }
  }

  // 清掉本次新建的空目录（深度优先，免得父目录被非空子目录挡住）
  const newDirs = [...after.dirs].filter((d) => !before.dirs.has(d)).sort(depthDesc);
  for (const rel of newDirs) {
    try {
      fs.rmdirSync(path.join(root, rel));
    } catch (e) {
      // 非空（里面有删不掉的文件）或仍被占用：留着
    }
  }
  return failed;
}

/**
 * 端口是否已经有人监听。
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host });
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; try { sock.destroy(); } catch (e) { /* */ } resolve(v); } };
    sock.setTimeout(1500);
    sock.on('connect', () => done(true));
    sock.on('timeout', () => done(false));
    sock.on('error', () => done(false));
  });
}

/**
 * 返回第一个能连上的候选端口；都不通返回 `null`。
 * @param {number[]} ports
 * @param {string} [host]
 * @returns {Promise<number|null>}
 */
async function findOpenPort(ports, host = '127.0.0.1') {
  for (const port of ports) {
    if (await isPortOpen(port, host)) return port;
  }
  return null;
}

/**
 * GET 一次，返回 `{status, body}`；连不上 / 超时返回 `{status: null, body: 原因}`。
 *
 * 响应体**必须整份读回**：健康结论全在 body 里，读前 N 字节会把 JSON 截断，
 * 于是 `JSON.parse` 必然失败 —— 闸门就变成了「响应是不是合法 JSON」的随机测试。
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{status: number|null, body: string}>}
 */
function httpGet(url, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let req;
    try {
      req = http.get(url, { timeout: timeoutMs }, (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size <= MAX_BODY_BYTES) chunks.push(c);
        });
        res.on('end', () => {
          done({ status: res.statusCode ?? null, body: Buffer.concat(chunks).toString('utf-8') });
        });
        res.on('error', (e) => done({ status: res.statusCode ?? null, body: `响应流错误: ${e.message}` }));
      });
    } catch (e) {
      return done({ status: null, body: `请求构造失败: ${e.message}` });
    }
    req.on('error', (e) => done({ status: null, body: `请求失败: ${e.message}` }));
    req.on('timeout', () => { try { req.destroy(); } catch (e) { /* */ } done({ status: null, body: `请求超时(${timeoutMs}ms)` }); });
  });
}

/**
 * 杀掉整棵进程树（含根进程）。
 *
 * 必须整树：PyInstaller onedir 的 exe 会拉起子进程（采集线程 / 后台任务），
 * 只杀父进程会留下孤儿占着端口，让**下一次** CI 跑出莫名其妙的「端口被占」。
 *
 * POSIX 分支额外显式 `process.kill` 根进程：`pkill -P` 只杀子进程。
 *
 * @param {number} pid
 */
function killTree(pid) {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    } else {
      spawnSync('pkill', ['-P', String(pid)], { stdio: 'ignore' });
      process.kill(pid, 'SIGKILL');
    }
  } catch (e) {
    // 进程可能已经退出
  }
}

/**
 * 相对 `before` 快照，当前**仍存在**的运行期新文件（排序后）。
 *
 * 这是「清理是否真的生效」的**唯一可信判据**。
 * 不能只看 `unlink` 有没有抛异常 —— Windows 上删除一个仍被句柄占用的文件时，
 * `DeleteFile` 会成功返回，但目录项要等最后一个句柄关闭才消失；
 * 于是「删了」与「还在」可以同时为真，而代码会静默放过。
 *
 * @param {string} root
 * @param {{files:Set<string>, dirs:Set<string>}} before
 * @returns {string[]}
 */
function runtimeNewFiles(root, before) {
  const after = snapshotTree(root);
  return [...after.files].filter((f) => !before.files.has(f)).sort();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 反复清理直到「复核确认干净」或次数用尽。
 *
 * 单次清理是不够的：进程刚被杀时它的子进程 / 句柄可能还没完全释放，
 * 第一次 `unlink` 可能落空。所以这里做「删 → 复核 → 退避 → 再删」。
 *
 * @param {string} root
 * @param {{files:Set<string>, dirs:Set<string>}} before
 * @param {number} [attempts]
 * @param {number} [delayMs]
 * @returns {Promise<{failed: string[], leftover: string[]}>}
 *   `failed` = unlink 抛异常的；`leftover` = 删完复核仍在的（**这才是判据**）
 */
async function cleanupUntilClean(root, before, attempts = 3, delayMs = 500) {
  let failed = cleanupCreated(root, before);
  let leftover = runtimeNewFiles(root, before);
  for (let i = 1; i < attempts && leftover.length; i++) {
    await sleep(delayMs);
    failed = failed.concat(cleanupCreated(root, before));
    leftover = runtimeNewFiles(root, before);
  }
  return { failed, leftover };
}

/**
 * 等候选端口**真正关闭**。
 *
 * 为什么不能只等 `proc.exitCode !== null`：那只证明**根进程**退出了。
 * PyInstaller onedir 的 exe 会派生进程，根进程退出后子进程可能仍在跑并继续
 * 持有数据库 / 日志句柄 —— 于是「清理失败」和「下一次跑端口被占」都会发生。
 * 端口是外部可观测的「它真的没了」的判据。
 *
 * @param {number[]} ports
 * @param {string} [host]
 * @param {number} [timeoutMs]
 * @returns {Promise<number[]>} 超时后仍开着的端口
 */
async function waitForPortsClosed(ports, host = '127.0.0.1', timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const stillOpen = [];
    for (const port of ports) {
      if (await isPortOpen(port, host)) stillOpen.push(port);
    }
    if (stillOpen.length === 0 || Date.now() >= deadline) return stillOpen;
    await sleep(500);
  }
}

// --------------------------------------------------------------------------
// 主流程
// --------------------------------------------------------------------------

function printHealth(assess) {
  if (!assess) return;
  console.log(`global_status : ${assess.global_status}`);
  const mods = Object.entries(assess.modules).sort();
  if (mods.length) console.log('modules       : ' + mods.map(([n, s]) => `${n}=${s}`).join(', '));
  const chks = Object.entries(assess.checks).sort();
  if (chks.length) console.log('checks        : ' + chks.map(([n, s]) => `${n}=${s}`).join(', '));
}

function fail(reason, logText, logTail) {
  console.error(`\n[FAIL] ${reason}`);
  console.error('--- 后端日志尾部 ---');
  console.error(tail(logText, logTail));
  return 1;
}

/**
 * 起 exe、等端口、判健康、**验前后端端口文件契约**、杀掉。返回进程退出码。
 *
 * @param {{exe: string, ports: number[], healthPath: string, timeout: number,
 *          checksTimeout: number, logTail: number}} opts
 * @returns {Promise<number>}
 */
async function smoke(opts) {
  const { ports: initialPorts, healthPath, timeout, checksTimeout, logTail } = opts;
  const exe = path.resolve(opts.exe);

  if (!fs.existsSync(exe) || !fs.statSync(exe).isFile()) {
    // fail-closed：产物不存在是**闸门失败**，不是「跳过」
    console.error(`[FAIL] 打包产物不存在: ${exe}`);
    console.error('       上一步（PyInstaller / 暂存 backend）可能没产出 exe，或路径写错了。');
    return 1;
  }

  const exeDir = path.dirname(exe);
  console.log(`exe      : ${exe}`);
  console.log(`size     : ${fs.statSync(exe).size.toLocaleString('en-US')} bytes`);
  console.log(`cwd      : ${exeDir}`);
  console.log(`ports    : ${JSON.stringify(initialPorts)}`);
  console.log(`timeout  : 启动 ${timeout}s / 健康 ${checksTimeout}s`);
  console.log(`runtime  : ${JSON.stringify(backendPaths.runtimeJsonCandidates(exe))}`);

  // ---- 前置：候选端口必须干净 ------------------------------------------
  // 若某个候选端口**在启动前**就有人监听，那么后面的健康判定可能是在探一个
  // 外部服务，闸门会以「通过」姿态放过一个根本没起来的产物。
  // 这是 fail-open 的另一种形态，必须显式判死而不是硬着头皮往下跑。
  for (const port of initialPorts) {
    if (await isPortOpen(port)) {
      console.error(`[FAIL] 候选端口 ${port} 在启动被测产物**之前**就已被占用。`);
      console.error('       无法确定后续健康响应来自被测产物，闸门拒绝给出结论。');
      console.error('       常见原因：上一步的进程没杀干净，或 runner 上有别的服务占着这个端口。');
      return 1;
    }
  }

  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-backend-'));
  const logPath = path.join(logDir, 'backend.log');
  console.log(`log      : ${logPath}`);

  // 产物清单快照：运行结束后据此删掉本次新建的文件，保证「冒烟不改动产物」。
  // 对本仓库尤其关键 —— backend/ 是 extraResources 的源，留下的运行期文件
  // 会被原样打进安装包。
  const before = snapshotTree(exeDir);
  console.log(`产物快照 : ${before.files.size} 个文件 / ${before.dirs.size} 个目录`
    + '（运行结束后据此复核是否留了垃圾）');

  // 杀进程后要盯的端口：根进程退出不等于子进程退出，端口才是外部可观测的判据。
  const watchPorts = initialPorts.slice();

  const logFd = fs.openSync(logPath, 'w');
  const proc = spawn(exe, [], { cwd: exeDir, stdio: ['ignore', logFd, logFd], windowsHide: true });
  fs.closeSync(logFd);

  const readLog = () => {
    try { return fs.readFileSync(logPath, 'utf-8'); } catch (e) { return ''; }
  };

  let ok = false;
  try {
    // ---- 阶段一：等端口 -------------------------------------------------
    const ports = watchPorts;
    let port = null;
    const startupDeadline = Date.now() + timeout * 1000;

    while (Date.now() < startupDeadline) {
      if (proc.exitCode !== null) {
        return fail(
          `后端进程在监听端口前就退出了（exitCode=${proc.exitCode}）—— `
          + '典型原因：PyInstaller 缺 hiddenimports（动态导入的模块没被打进去）',
          readLog(), logTail);
      }

      // 先看 runtime.json（应用自己报的端口，最准），再退回到端口探测
      const reported = backendPaths.readRuntimePort(exe);
      if (reported !== null && !ports.includes(reported)) ports.unshift(reported);

      port = await findOpenPort(ports);
      if (port !== null) break;
      await sleep(1000);
    }

    if (port === null) {
      return fail(
        `${timeout}s 内候选端口 ${JSON.stringify(ports)} 一个都没起来 —— `
        + '进程可能卡在启动阶段（缺依赖 / 配置读不到 / 端口被占）',
        readLog(), logTail);
    }
    console.log(`listening: 127.0.0.1:${port}`);

    // ---- 阶段二：判健康 -------------------------------------------------
    // 端口开了不代表应用就绪（Flask 可能在路由注册完成前就 bind），
    // 所以要在剩余时间内重试，而不是探一次就下结论。
    const url = `http://127.0.0.1:${port}${healthPath}`;
    console.log(`GET      : ${url}`);

    const checksDeadline = Date.now() + checksTimeout * 1000;
    let lastNote = '(未尝试)';
    let lastAssess = null;
    let healthy = false;

    while (true) {
      if (proc.exitCode !== null) {
        return fail(`后端进程在健康检查期间退出（exitCode=${proc.exitCode}）`, readLog(), logTail);
      }

      const { status, body } = await httpGet(url, 10000);
      if (status !== 200) {
        lastNote = `HTTP ${status}: ${body.slice(0, 300)}`;
      } else {
        let payload;
        try {
          payload = JSON.parse(body);
        } catch (e) {
          lastNote = `响应不是合法 JSON: ${e.message}; body=${body.slice(0, 300)}`;
          payload = undefined;
        }
        if (payload !== undefined) {
          const assess = assessHealth(payload);
          lastAssess = assess;
          if (!assess.ok) {
            // 确定的负面信号 —— 再等也不会自己好，直接判死
            printHealth(assess);
            return fail(`健康判定失败: ${assess.reason}`, readLog(), logTail);
          }
          if (assess.resolved) {
            printHealth(assess);
            healthy = true;
            break;
          }
          lastNote = 'HTTP 200 且无负面信号，但后台巡检线程尚未跑第一轮（检查项全为 unknown）';
        }
      }

      if (Date.now() >= checksDeadline) break;
      await sleep(1000);
    }

    if (!healthy) {
      printHealth(lastAssess);
      return fail(`健康检查未在 ${checksTimeout}s 内通过: ${lastNote}`, readLog(), logTail);
    }

    // ---- 阶段三：前后端端口文件契约 -------------------------------------
    // 这是本脚本存在的**主要理由**：后端能跑 ≠ 前端找得到它。
    // 用前端真正的实现（electron/backend-paths.js，main.js 用的就是它）去找
    // 后端刚刚写出的 runtime.json，找不到就是契约破裂。
    const found = backendPaths.findRuntimeJson(exe);
    if (!found) {
      return fail(
        '后端已健康，但**前端算出的路径上找不到 runtime.json** —— 前后端端口发现契约破裂。\n'
        + `       候选路径: ${JSON.stringify(backendPaths.runtimeJsonCandidates(exe))}\n`
        + '       后果：前端 readRuntimePort() 恒返回 null，端口发现退化成硬编码回退值；\n'
        + '       一旦后端监听的不是那个回退端口，应用会永远显示「后端离线」且日志无异常。\n'
        + '       修法：改 electron/backend-paths.js 的候选列表，与后端 paths.py 的 _BASE 推导对齐。',
        readLog(), logTail);
    }
    const reported = backendPaths.readRuntimePort(exe);
    if (reported !== port) {
      return fail(
        `runtime.json 报的端口(${reported}) 与实际监听端口(${port}) 不一致`
        + `（文件: ${found}）—— 前端会连错端口`,
        readLog(), logTail);
    }
    console.log(`runtime  : ${found}（port=${reported}，与实际监听一致）`);

    console.log('\n[PASS] 打包产物能启动、模块全部就绪、后台巡检线程已跑过至少一轮，'
      + '且前端能在自己的口径上找到后端端口文件');
    ok = true;
    return 0;
  } finally {
    killTree(proc.pid);
    // 先等根进程退出（快速路径）
    const deadline = Date.now() + 15000;
    while (proc.exitCode === null && Date.now() < deadline) {
      await sleep(200);
    }
    if (proc.exitCode === null) {
      try { proc.kill('SIGKILL'); } catch (e) { /* */ }
    }

    // 再等**端口真正关闭** —— 根进程退出 ≠ 整棵树没了。
    const stillListening = await waitForPortsClosed(watchPorts, '127.0.0.1', 15000);
    if (stillListening.length) {
      console.error(`[WARN] 杀掉进程树后端口仍在监听: ${JSON.stringify(stillListening)}`
        + ' —— 可能有子进程逃逸，会污染下一次运行');
    }

    // 「冒烟不得改动产物」：删掉本次运行在产物目录里新建的东西，**并复核**。
    // 不复核就等于没有隔离：Windows 上删除仍被句柄占用的文件时，
    // `unlink` 会成功返回，而目录项要等最后一个句柄关闭才消失 ——
    // 只看「有没有抛异常」会把「删了但还在」静默放过。
    const { failed, leftover } = await cleanupUntilClean(exeDir, before);
    if (failed.length) {
      console.error(`[WARN] ${failed.length} 个运行期文件删除时抛错: `
        + JSON.stringify(failed.slice(0, 5)));
    }
    if (leftover.length) {
      // 这是**发布缺陷**，不是环境噪声：`backend/` 是 extraResources 的源
      // （filter 不排除 `data/`，electron-builder 也不看 `.gitignore`），
      // 残留的模拟库 / runtime.json 会随安装包发到用户机器上。
      console.error(`[FAIL] 冒烟留下了 ${leftover.length} 个运行期文件未能清理:`);
      for (const rel of leftover.slice(0, 20)) console.error(`         ${rel}`);
      console.error('       backend/ 会被 electron-builder 通过 extraResources 打进安装包，');
      console.error('       这些文件会随安装包发到用户机器上。闸门拒绝放行。');
      // 注意：`finally` 里的 return 会**覆盖** try 里的返回值。
      // 这里正是要覆盖 —— 清理没做干净时，即使健康判定通过也不能算过。
      return 1;
    }

    if (ok) {
      // 成功时把临时日志收掉。本机已经被 `.pytest_tmp-*` 淹过一次
      // （约 250 个目录 / 7380 个文件），不要再往里加一类会累积的垃圾。
      // 失败时**保留**，因为排查看完整日志比看截尾有用。
      try { fs.rmSync(logDir, { recursive: true, force: true }); } catch (e) { /* */ }
    } else {
      console.error(`[INFO] 失败日志保留在: ${logPath}`);
    }
  }
}

function main(argv) {
  const args = { exe: null, ports: DEFAULT_PORTS, healthPath: DEFAULT_HEALTH_PATH,
    timeout: DEFAULT_TIMEOUT, checksTimeout: DEFAULT_CHECKS_TIMEOUT, logTail: 4000 };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = () => {
      const v = argv[++i];
      if (v === undefined) { console.error(`[用法错误] ${a} 缺少取值`); process.exit(2); }
      return v;
    };
    if (a === '--exe') args.exe = need();
    else if (a === '--ports') args.ports = need();
    else if (a === '--health-path') args.healthPath = need();
    else if (a === '--timeout') args.timeout = Number(need());
    else if (a === '--checks-timeout') args.checksTimeout = Number(need());
    else if (a === '--log-tail') args.logTail = Number(need());
    else if (a === '--help' || a === '-h') {
      console.log('用法: node tools/verify-backend-runtime.js [--exe <path>] [--ports 5000,5001]');
      console.log('      [--health-path /api/health/status] [--timeout 180] [--checks-timeout 150]');
      return 0;
    } else {
      console.error(`[用法错误] 未知参数: ${a}`);
      return 2;
    }
  }

  if (!args.exe) args.exe = path.join(__dirname, '..', 'backend', backendPaths.BACKEND_EXE_NAME);

  let ports;
  try {
    ports = candidatePorts(args.ports);
  } catch (e) {
    console.error(`[用法错误] ${e.message}`);
    return 2;
  }
  if (!(args.timeout > 0)) { console.error('[用法错误] --timeout 必须为正数'); return 2; }
  if (!(args.checksTimeout > 0)) { console.error('[用法错误] --checks-timeout 必须为正数'); return 2; }

  return smoke({
    exe: args.exe, ports, healthPath: args.healthPath,
    timeout: args.timeout, checksTimeout: args.checksTimeout, logTail: args.logTail,
  });
}

module.exports = {
  DEFAULT_PORTS, DEFAULT_HEALTH_PATH, DEFAULT_TIMEOUT, DEFAULT_CHECKS_TIMEOUT,
  BAD_MODULE_STATUSES, UNHEALTHY, MAX_BODY_BYTES,
  candidatePorts, tail, assessHealth, snapshotTree, cleanupCreated,
  runtimeNewFiles, cleanupUntilClean, isPortOpen, findOpenPort, waitForPortsClosed,
  httpGet, killTree, smoke, main,
};

if (require.main === module) {
  Promise.resolve(main(process.argv.slice(2))).then(
    (code) => process.exit(code),
    (err) => { console.error(`[FAIL] 未捕获异常: ${err && err.stack ? err.stack : err}`); process.exit(1); },
  );
}
