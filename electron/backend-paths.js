'use strict';
/**
 * backend-paths.js — 后端可执行文件 / 运行时端口文件的**唯一定位口径**
 *
 * 为什么单独成模块
 * ----------------
 * 这段逻辑原先内联在 `electron/main.js` 里，而 `main.js` 是单体脚本、**不导出任何东西**
 * —— 意味着它无法被单元测试覆盖，也无法被 CI 的运行时闸门复用。
 * 定位口径一旦写错，症状是「应用找不到自己的后端」，而且**失败方式是静默的**：
 * 端口发现退化成硬编码回退值，界面只会显示「后端离线」，日志里没有异常。
 *
 * 2026-09-24 实测到的真实缺陷（就是本模块存在的原因）：
 *   `main.js` 原先拼的是 `<backend_dir>/data/runtime.json`，注释还写着
 *   「路径与后端 paths.RUNTIME_JSON_PATH 对齐」。但对**实际发布的 onedir 布局**，
 *   后端的 `paths.py` 是这样推的：
 *
 *       PROJECT_ROOT = <backend_dir>            # sys.executable 的父目录
 *       _BASE        = PROJECT_ROOT / '_internal'   # 因为 _internal/ 存在
 *       DATA_DIR     = _BASE / 'data'
 *       RUNTIME_JSON_PATH = DATA_DIR / 'runtime.json'
 *
 *   即真实落点是 `<backend_dir>/_internal/data/runtime.json`。
 *   实测真产物：`dist/scada-backend/_internal/data/runtime.json` 存在（132 字节，
 *   `{"port": 5000, ...}`），而 `<backend_dir>/data/` 下**没有** runtime.json。
 *
 *   于是 `readRuntimePort()` 恒返回 null，整个「避免 5000/5001 错配」的机制
 *   **一次也没有生效过** —— 它能跑是因为回退值 5000 恰好等于模拟模式端口
 *   （`run.py:446`：模拟=5000，真实/模拟器=5001），而 Electron 恒
 *   `spawn(exe, [])` 不传参数 → 恒模拟模式。**巧合掩盖了缺陷。**
 *
 * 现在的口径：**两个候选都试**，谁先存在用谁。不猜布局，探测。
 * 这与后端闸门 `.github/scripts/smoke_packaged_backend.py` 的
 * `runtime_json_candidates()` 是同一口径，两边必须一致。
 */

const fs = require('fs');
const path = require('path');

/** 后端可执行文件名。本项目只发布 Windows 产物，三处（dev/packaged/CI）统一用这个名字。 */
const BACKEND_EXE_NAME = 'scada-backend.exe';

/**
 * `runtime.json` 相对**后端目录**的候选位置，按优先级排列。
 *
 * 1. `_internal/data/runtime.json` —— PyInstaller **onedir**（COLLECT）布局，
 *    也就是当前 CI 与实际安装包发布的那一种。
 * 2. `data/runtime.json` —— onefile 布局，或 `配置/` 平铺在 exe 旁边的布局
 *    （`paths.py` 在这两种情况下 `_BASE` 就是 exe 目录本身）。
 *
 * 顺序不能反：onedir 产物里 `<backend_dir>/data/` 也可能存在
 * （历史运行残留），若把它排在前面，就会读到一个陈旧的 runtime.json。
 */
const RUNTIME_JSON_RELATIVE = [
  ['_internal', 'data', 'runtime.json'],
  ['data', 'runtime.json'],
];

/**
 * 后端可执行文件的绝对路径。
 *
 * @param {{isPackaged: boolean, resourcesPath?: string, appDir: string}} opts
 *   - `isPackaged`   Electron 的 `app.isPackaged`
 *   - `resourcesPath` 打包后为 `process.resourcesPath`（`<app>/resources`）
 *   - `appDir`       `electron/` 目录（即 main.js 的 `__dirname`）
 * @returns {string}
 */
function getBackendPath(opts) {
  const { isPackaged, resourcesPath, appDir } = opts || {};
  if (isPackaged) {
    return path.join(String(resourcesPath), 'backend', BACKEND_EXE_NAME);
  }
  return path.join(String(appDir), '..', 'backend', BACKEND_EXE_NAME);
}

/**
 * `runtime.json` 的全部候选路径（按优先级）。纯函数，不碰文件系统。
 *
 * @param {string} backendExePath 后端 exe 的绝对路径
 * @returns {string[]}
 */
function runtimeJsonCandidates(backendExePath) {
  const dir = path.dirname(String(backendExePath));
  return RUNTIME_JSON_RELATIVE.map((parts) => path.join(dir, ...parts));
}

/**
 * 返回第一个**存在**的 `runtime.json` 路径；都不存在返回 `null`。
 *
 * 存在的意义：闸门要能断言「后端写出的端口文件，在前端算出的路径上真的能找到」。
 * 只测 `readRuntimePort()` 拿到数字是不够的 —— 那可能是某个候选路径碰巧命中，
 * 而真正要钉住的是「候选集合覆盖了真实布局」。
 *
 * @param {string} backendExePath
 * @returns {string|null}
 */
function findRuntimeJson(backendExePath) {
  for (const cand of runtimeJsonCandidates(backendExePath)) {
    try {
      if (fs.statSync(cand).isFile()) return cand;
    } catch (e) {
      // 不存在 / 无权限：继续试下一个候选。这是**探测**，不是判定。
    }
  }
  return null;
}

/**
 * 读出后端本次启动实际监听的端口；读不到返回 `null`。
 *
 * 刻意不抛异常：这是「**辅助**发现端口」的手段，不是判定依据 ——
 * 真正的判定依据是健康端点。辅助手段失败不该让应用崩。
 *
 * 注意 `Number.isInteger(true)` 为 `false`，所以 JSON 里的 `true` 天然被排除，
 * 不会像 Python 那样把 `bool` 当 `int` 用（那边的 `read_runtime_port` 需要显式排除）。
 *
 * @param {string} backendExePath
 * @returns {number|null}
 */
function readRuntimePort(backendExePath) {
  const file = findRuntimeJson(backendExePath);
  if (!file) return null;
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const port = obj.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

module.exports = {
  BACKEND_EXE_NAME,
  RUNTIME_JSON_RELATIVE,
  getBackendPath,
  runtimeJsonCandidates,
  findRuntimeJson,
  readRuntimePort,
};
