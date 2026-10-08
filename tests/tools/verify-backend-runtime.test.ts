import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * tools/verify-backend-runtime.js 的行为契约。
 *
 * 这是前端仓库里**第一道真起后端进程**的闸门。它存在的理由：
 * `electron/main.js` 的 spawn 链路、端口发现、健康等待此前**从未在任何自动化里
 * 被执行过**（`verify:dist` / `verify-asar` 都是静态读文件）。而 PyInstaller 的
 * 失败模式全在运行时 —— 「构建成功 + exe 存在 + CI 全绿」与「产物一运行就崩」
 * 可以同时成立。
 *
 * 测试策略（照抄 round 174 在 Python 侧的教训）：
 *   1. **正向对照必须有** —— 一条「真起真跑 → 断言成功」的用例。
 *      没有它，所有「期望 exit 1」的负向用例都会因为「什么都没测到」而假绿。
 *   2. 假 exe 不是 mock：它是一个**真进程**（`node.exe` 的副本 + `NODE_OPTIONS`
 *      预加载脚本），起真 HTTP 服务、真写 runtime.json。生产代码里**没有任何**
 *      为测试开的口子。
 *   3. 夹具放仓库内 `.vitest_cache/`（已 gitignore），不做批量删除。
 */

const require_ = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gate: any = require_(path.join(process.cwd(), 'tools', 'verify-backend-runtime.js'))

const REPO = process.cwd()
// fixture 根（稳定）+ 本轮专属子目录（唯一）。
//
// 这两层各有各的理由，缺一个就会出问题 —— 两个都踩过：
//   · 根必须稳定：fake exe 是 87MB，不想每轮重写。
//   · 本轮目录必须**唯一**：本套件大量用「快照 before → 造新文件 → 断言只有新的被处理」，
//     目录一旦跨轮复用，上一轮留下的 runtime.json / .env 会被 before 快照吃掉，
//     用例**确定性**失败（实测：`expected [] to deeply equal [ 'runtime.json' ]`）。
//   · 而且**绝不能靠"每轮开始清一次"来保证干净** —— 本机删除守卫有一条
//     **按整轮累计**的配额（`{"count":50,"threshold":50,"scope":"turn"}`），
//     同一轮累计删到 50 个文件后**任何删除都抛异常**。
//     实测：把复位放在 beforeAll 里，配额早被别的用例吃掉时，
//     `fs.rmSync` 直接抛 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` → **整个文件级失败**。
const FIXTURE_ROOT = path.join(REPO, '.vitest_cache', 'verify-backend-runtime')
const RUN_DIR = path.join(FIXTURE_ROOT, `run-${process.pid}`)
const FAKE_DIR = path.join(RUN_DIR, 'fake-backend')
const FAKE_EXE = path.join(FAKE_DIR, 'scada-backend.exe')
const PRELOAD = path.join(FAKE_DIR, 'preload.js')

/**
 * 假后端的预加载脚本。由 `node.exe` 副本在启动时 `--require`。
 *
 * 行为全部由环境变量驱动，这样一个 87MB 的副本可以服务所有用例
 * （`spawn` 继承父进程环境，所以测试改 `process.env` 即可）。
 */
const PRELOAD_SRC = `'use strict'
const http = require('http')
const fs = require('fs')
const path = require('path')

const port = Number(process.env.FAKE_PORT)
const status = Number(process.env.FAKE_STATUS || 200)
const payload = process.env.FAKE_PAYLOAD || ''
const writeRuntime = process.env.FAKE_WRITE_RUNTIME !== '0'
const runtimePort = process.env.FAKE_RUNTIME_PORT ? Number(process.env.FAKE_RUNTIME_PORT) : port
const createFiles = process.env.FAKE_CREATE_FILES !== '0'

if (process.env.FAKE_EXIT_EARLY === '1') {
  process.stdout.write('fake backend: 启动阶段就退出（模拟缺 hiddenimport）\\n')
  process.exit(3)
}

// 模拟真产物首次运行会在自己旁边建库 / 建日志目录（用来验证「冒烟不改动产物」）
if (createFiles) {
  fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true })
  fs.writeFileSync(path.join(process.cwd(), 'logs', 'fake.log'), 'x')
  fs.mkdirSync(path.join(process.cwd(), '_internal', 'data'), { recursive: true })
  fs.writeFileSync(path.join(process.cwd(), '_internal', 'data', 'scada_simulated.db'), 'SQLite format 3')
}
if (writeRuntime) {
  fs.mkdirSync(path.join(process.cwd(), '_internal', 'data'), { recursive: true })
  fs.writeFileSync(
    path.join(process.cwd(), '_internal', 'data', 'runtime.json'),
    JSON.stringify({ port: runtimePort, host: '127.0.0.1', pid: process.pid, mode: 'simulated' }),
  )
}

http.createServer((req, res) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}).listen(port, '127.0.0.1')
`

/** 健康响应体：模块就绪、检查项 healthy 且巡检跑过一轮（last_check 非空）。 */
const HEALTHY = JSON.stringify({
  success: true,
  data: {
    global_status: 'healthy',
    modules: { database: { status: 'initialized' }, data_collector: { status: 'initialized' } },
    checks: {
      global_status: 'healthy',
      total_checks: 1,
      checks: { database: { status: 'healthy', last_check: '2026-09-24T00:00:00' } },
    },
  },
})

/** 巡检线程还没跑第一轮：检查项全 unknown、last_check 为 null。 */
const UNRESOLVED = JSON.stringify({
  success: true,
  data: {
    global_status: 'healthy',
    modules: { database: { status: 'initialized' } },
    checks: {
      global_status: 'unknown',
      total_checks: 1,
      checks: { database: { status: 'unknown', last_check: null } },
    },
  },
})

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
  })
}

/** 在指定端口上起一个「外部服务」，用来验证端口预占检查。 */
function occupy(port: number): Promise<() => Promise<void>> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(port, '127.0.0.1', () => resolve(() => new Promise((r) => srv.close(() => r()))))
  })
}

let savedNodeOptions: string | undefined
let savedFakeEnv: Record<string, string | undefined> = {}

/**
 * 设置假后端行为 → 跑闸门 → 还原环境，并**捕获闸门打印的文本**。
 *
 * 为什么要捕获输出：只断言 `code === 1` 的用例，无法区分
 * 「失败在正确的地方」与「失败在别的地方」。闸门里有好几条独立失败路径
 * （产物不存在 / 启动即退 / 端口被占 / 健康不通过 / 契约破裂 / 端口不一致），
 * 把其中一条架空后，代码会落到另一条上**照样返回 1** → 用例照样绿 → 变异抓不住。
 * 所以每条负向用例都要断言**关键原因文本**。
 */
async function runSmoke(
  env: Record<string, string>,
  opts: Partial<{ exe: string; ports: number[]; healthPath: string; timeout: number; checksTimeout: number; logTail: number }> = {},
): Promise<{ code: number; out: string }> {
  const lines: string[] = []
  const spyLog = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    lines.push(a.map((x) => String(x)).join(' '))
  })
  const spyErr = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    lines.push(a.map((x) => String(x)).join(' '))
  })
  savedFakeEnv = {}
  for (const [k, v] of Object.entries(env)) {
    savedFakeEnv[k] = process.env[k]
    process.env[k] = v
  }
  try {
    const code = await gate.smoke({
      exe: opts.exe ?? FAKE_EXE,
      ports: opts.ports ?? [Number(env.FAKE_PORT)],
      healthPath: opts.healthPath ?? gate.DEFAULT_HEALTH_PATH,
      timeout: opts.timeout ?? 20,
      checksTimeout: opts.checksTimeout ?? 15,
      logTail: opts.logTail ?? 500,
    })
    return { code, out: lines.join('\n') }
  } finally {
    spyLog.mockRestore()
    spyErr.mockRestore()
    for (const [k, v] of Object.entries(savedFakeEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

beforeAll(() => {
  fs.mkdirSync(FAKE_DIR, { recursive: true })

  // 假 exe = node.exe 的**硬链接**（实测可用，`nlink` 计数递增，不占额外磁盘）。
  //
  // 为什么是硬链接而不是副本：副本 87MB，而本机删除守卫处理不了指向 node.exe 的硬链接
  // （`trash` 操作失败）→ 一旦用了硬链接，目录就永远删不掉。
  // 但**我们本来就不删**（见 afterAll），所以这个限制不再构成问题，
  // 而硬链接把「每轮一个 fixture 目录」的成本从 87MB 降到 ~0。
  // 万一 linkSync 不可用（跨卷等），退回副本 —— 只在那种环境下才吃 87MB。
  try {
    fs.linkSync(process.execPath, FAKE_EXE)
  } catch {
    if (!fs.existsSync(FAKE_EXE)) fs.copyFileSync(process.execPath, FAKE_EXE)
  }

  fs.writeFileSync(PRELOAD, PRELOAD_SRC, 'utf8')
  savedNodeOptions = process.env.NODE_OPTIONS
  const flag = `--require ${PRELOAD}`
  process.env.NODE_OPTIONS = savedNodeOptions ? `${savedNodeOptions} ${flag}` : flag
})

afterAll(() => {
  if (savedNodeOptions === undefined) delete process.env.NODE_OPTIONS
  else process.env.NODE_OPTIONS = savedNodeOptions

  // ⚠️ 这里**刻意什么都不删** —— 这是踩了三次才定下来的形状，别改回去。
  //
  // 本机删除守卫有一条**按整轮累计**的配额：
  //   [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":50,"threshold":50,"scope":"turn"}
  // 同一个命令调用里**累计删到 50 个文件后，任何删除都抛异常** —— 包括别的测试文件、
  // 也包括被测闸门自己的 `cleanupCreated`。三条实测证据：
  //   ① 本文件 afterAll 删整个 PID 目录（36 个）→ 累计越过 50 → 闸门清理也删不动
  //      → 5 条用例偶发红（本机 3 轮 2 轮红，CI 全绿）。
  //   ② 改成「稳定路径 + beforeAll 定点复位」→ 复位那一步**自己**抛
  //      `SAFE_DELETE_BULK_CONFIRM_REQUIRED` → 整个文件级失败（run3/run4，19s/21s 就挂）。
  //   ③ 最终形状：**每轮唯一目录（不污染）+ 硬链接（不占盘）+ 永不删除（不碰配额）**。
  //
  // 代价：`run-<pid>/` 目录会随运行次数累积，但每个只有几 KB（exe 是硬链接），
  // 且**不需要也不应该**由测试去清理（清理会重新掉进配额陷阱）。
})

// ---------------------------------------------------------------------------

describe('candidatePorts', () => {
  it('解析、去重、保序', () => {
    expect(gate.candidatePorts('5000,5001')).toEqual([5000, 5001])
    expect(gate.candidatePorts('5001, 5000 ,5001')).toEqual([5001, 5000])
    expect(gate.candidatePorts('8080')).toEqual([8080])
  })

  it('非法输入一律抛错（闸门不接受「悄悄退化」）', () => {
    expect(() => gate.candidatePorts('')).toThrow()
    expect(() => gate.candidatePorts(',,')).toThrow()
    expect(() => gate.candidatePorts('abc')).toThrow()
    expect(() => gate.candidatePorts('5000,abc')).toThrow()
    expect(() => gate.candidatePorts('0')).toThrow()
    expect(() => gate.candidatePorts('70000')).toThrow()
    expect(() => gate.candidatePorts('-1')).toThrow()
  })
})

describe('tail', () => {
  it('短文本原样返回；空文本给占位符', () => {
    expect(gate.tail('abc', 10)).toBe('abc')
    expect(gate.tail('', 10)).toBe('(空)')
    expect(gate.tail(undefined, 10)).toBe('(空)')
  })

  it('超长文本只保留末尾（不把 CI 日志刷爆）', () => {
    const long = 'x'.repeat(100) + 'TAIL'
    const out = gate.tail(long, 10)
    expect(out.endsWith('TAIL')).toBe(true)
    expect(out.length).toBeLessThan(40)
  })
})

describe('assessHealth —— 只对确定的负面信号判负', () => {
  const wrap = (data: unknown) => ({ success: true, data })

  it('健康响应 → ok 且 resolved', () => {
    const r = gate.assessHealth(JSON.parse(HEALTHY))
    expect(r.ok).toBe(true)
    expect(r.resolved).toBe(true)
    expect(r.global_status).toBe('healthy')
  })

  it('巡检未跑第一轮（全 unknown）→ 不判负，但 resolved=false', () => {
    const r = gate.assessHealth(JSON.parse(UNRESOLVED))
    expect(r.ok).toBe(true)
    expect(r.resolved).toBe(false)
  })

  it('degraded 不判负（新鲜度阈值很紧，会随 runner 快慢抖动）', () => {
    const r = gate.assessHealth(wrap({
      global_status: 'degraded',
      modules: { database: { status: 'initialized' } },
      checks: { global_status: 'degraded', checks: { database: { status: 'degraded', last_check: 'x' } } },
    }))
    expect(r.ok).toBe(true)
  })

  it('success != true → 判负', () => {
    expect(gate.assessHealth({ success: false, data: {} }).ok).toBe(false)
    expect(gate.assessHealth({ data: {} }).ok).toBe(false)
    expect(gate.assessHealth({ success: 'true', data: {} }).ok).toBe(false)
  })

  it('缺 data / data 不是对象 → 判负', () => {
    expect(gate.assessHealth({ success: true }).ok).toBe(false)
    expect(gate.assessHealth({ success: true, data: [] }).ok).toBe(false)
    expect(gate.assessHealth({ success: true, data: 'x' }).ok).toBe(false)
  })

  it('响应不是对象 → 判负', () => {
    expect(gate.assessHealth(null).ok).toBe(false)
    expect(gate.assessHealth([1, 2]).ok).toBe(false)
    expect(gate.assessHealth('x').ok).toBe(false)
    expect(gate.assessHealth(42).ok).toBe(false)
  })

  it('global_status == unhealthy → 判负', () => {
    expect(gate.assessHealth(wrap({ global_status: 'unhealthy' })).ok).toBe(false)
  })

  it('checks.global_status == unhealthy → 判负（巡检线程自己的结论）', () => {
    const r = gate.assessHealth(wrap({ global_status: 'healthy', checks: { global_status: 'unhealthy' } }))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('巡检线程')
  })

  it.each(['error', 'disabled', 'unavailable'])('模块状态 %s → 判负', (status) => {
    const r = gate.assessHealth(wrap({ global_status: 'healthy', modules: { database: { status } } }))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('模块未就绪')
  })

  it('任一检查项 unhealthy → 判负', () => {
    const r = gate.assessHealth(wrap({
      global_status: 'healthy',
      checks: { global_status: 'healthy', checks: { disk: { status: 'unhealthy', last_check: 'x' } } },
    }))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('disk')
  })

  it('派生字段 unhealthy_modules 不采信 —— 一律从 modules 重算', () => {
    // 派生字段说没问题，但 modules 里明明有 error → 必须判负
    const r = gate.assessHealth(wrap({
      global_status: 'healthy',
      unhealthy_modules: [],
      modules: { database: { status: 'error' } },
    }))
    expect(r.ok).toBe(false)
  })

  it('modules / checks 结构异常时不崩，按「无信号」处理', () => {
    expect(gate.assessHealth(wrap({ global_status: 'healthy', modules: 'x', checks: 'y' })).ok).toBe(true)
    expect(gate.assessHealth(wrap({ global_status: 'healthy', modules: { a: null } })).ok).toBe(true)
    expect(gate.assessHealth(wrap({
      global_status: 'healthy', checks: { checks: { a: { status: null } } },
    })).ok).toBe(true)
  })
})

describe('快照 / 清理（「冒烟不改动产物」）', () => {
  // 这三条是纯 fs 操作、本身不慢，但**本机的文件系统调用很慢**
  // （实测单条 cleanupCreated 要 4.1s），满载并行时必然超 vitest 默认的 5s。
  // 显式给宽超时 —— 它们不是计时敏感用例，不该因为机器负载假红。
  it('snapshotTree 同时给出文件与目录', () => {
    const dir = path.join(RUN_DIR, 'snap')
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'a', 'b', 'f.txt'), 'x')
    const s = gate.snapshotTree(dir)
    expect([...s.files]).toEqual([path.join('a', 'b', 'f.txt')])
    expect([...s.dirs].sort()).toEqual([path.join('a', 'b'), 'a'].sort())
  }, 30000)

  it('cleanupCreated 只删本次新建的，保留运行前就有的', () => {
    const dir = path.join(RUN_DIR, 'cleanup')
    fs.mkdirSync(path.join(dir, 'keep'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'keep', 'old.txt'), 'x')
    const before = gate.snapshotTree(dir)

    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'logs', 'new.log'), 'y')
    fs.writeFileSync(path.join(dir, '.env'), 'z')

    const failed = gate.cleanupCreated(dir, before)
    expect(failed).toEqual([])
    expect(fs.existsSync(path.join(dir, 'keep', 'old.txt'))).toBe(true)
    expect(fs.existsSync(path.join(dir, '.env'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'logs'))).toBe(false)
  }, 30000)

  it('runtimeNewFiles 是「清理是否真生效」的判据（不只看 unlink 有没有抛异常）', () => {
    const dir = path.join(RUN_DIR, 'verify-clean')
    fs.mkdirSync(dir, { recursive: true })
    const before = gate.snapshotTree(dir)
    fs.writeFileSync(path.join(dir, 'runtime.json'), '{}')
    expect(gate.runtimeNewFiles(dir, before)).toEqual(['runtime.json'])
    gate.cleanupCreated(dir, before)
    expect(gate.runtimeNewFiles(dir, before)).toEqual([])
  }, 30000)

  it('cleanupUntilClean 复核后返回空 leftover', async () => {
    const dir = path.join(RUN_DIR, 'until-clean')
    fs.mkdirSync(dir, { recursive: true })
    // 快照必须在「造出运行期文件」之前 —— 否则那些目录会被当成运行前就有的，不该删
    const before = gate.snapshotTree(dir)
    fs.mkdirSync(path.join(dir, '_internal', 'data'), { recursive: true })
    fs.writeFileSync(path.join(dir, '_internal', 'data', 'runtime.json'), '{}')
    const r = await gate.cleanupUntilClean(dir, before, 2, 10)
    expect(r.leftover).toEqual([])
    expect(fs.existsSync(path.join(dir, '_internal', 'data'))).toBe(false)
    expect(fs.existsSync(path.join(dir, '_internal'))).toBe(false)
  })
})

describe('smoke() —— 真起进程的闸门（fail-closed）', () => {
  it('【正向对照】健康产物 → exit 0，且契约成立', async () => {
    const port = await freePort()
    const { code, out } = await runSmoke({ FAKE_PORT: String(port), FAKE_PAYLOAD: HEALTHY })
    expect(code).toBe(0)
    expect(out).toContain('[PASS]')
    expect(out).toContain('与实际监听一致')
  }, 30000)

  it('【正向对照】跑完不留运行期垃圾（backend/ 会被 extraResources 打进安装包）', async () => {
    const port = await freePort()
    const before = gate.snapshotTree(FAKE_DIR)
    const { code } = await runSmoke({ FAKE_PORT: String(port), FAKE_PAYLOAD: HEALTHY })
    expect(code).toBe(0)
    const after = gate.snapshotTree(FAKE_DIR)
    expect([...after.files].sort()).toEqual([...before.files].sort())
    expect([...after.dirs].sort()).toEqual([...before.dirs].sort())
  }, 30000)

  it('产物不存在 → exit 1（不是「跳过」）', async () => {
    const port = await freePort()
    const { code, out } = await runSmoke(
      { FAKE_PORT: String(port), FAKE_PAYLOAD: HEALTHY },
      { exe: path.join(RUN_DIR, '不存在的后端.exe') },
    )
    expect(code).toBe(1)
    expect(out).toContain('打包产物不存在')
  }, 30000)

  it('进程启动阶段就退出（模拟缺 hiddenimport）→ exit 1', async () => {
    const port = await freePort()
    const { code, out } = await runSmoke({ FAKE_PORT: String(port), FAKE_EXIT_EARLY: '1' })
    expect(code).toBe(1)
    expect(out).toContain('在监听端口前就退出了')
    expect(out).toContain('hiddenimports')
  }, 30000)

  it('候选端口在启动前就被占用 → exit 1（否则可能探到外部服务而假通过）', async () => {
    const port = await freePort()
    const release = await occupy(port)
    try {
      const { code, out } = await runSmoke({ FAKE_PORT: String(port), FAKE_PAYLOAD: HEALTHY })
      expect(code).toBe(1)
      expect(out).toContain('已被占用')
    } finally {
      await release()
    }
  }, 30000)

  it('健康端点返回非 200 → exit 1', async () => {
    const port = await freePort()
    const { code, out } = await runSmoke(
      { FAKE_PORT: String(port), FAKE_PAYLOAD: '{"success":true}', FAKE_STATUS: '500' },
      { checksTimeout: 3 },
    )
    expect(code).toBe(1)
    expect(out).toContain('健康检查未在')
    expect(out).toContain('HTTP 500')
  }, 30000)

  it('健康响应体不是合法 JSON → exit 1', async () => {
    const port = await freePort()
    const { code, out } = await runSmoke(
      { FAKE_PORT: String(port), FAKE_PAYLOAD: '<html>not json</html>' },
      { checksTimeout: 3 },
    )
    expect(code).toBe(1)
    expect(out).toContain('不是合法 JSON')
  }, 30000)

  it('global_status == unhealthy → exit 1', async () => {
    const port = await freePort()
    const payload = JSON.stringify({ success: true, data: { global_status: 'unhealthy' } })
    const { code, out } = await runSmoke({ FAKE_PORT: String(port), FAKE_PAYLOAD: payload })
    expect(code).toBe(1)
    expect(out).toContain("global_status == 'unhealthy'")
  }, 30000)

  it('巡检线程一直没跑第一轮（检查项全 unknown）→ 超时 exit 1', async () => {
    const port = await freePort()
    const { code, out } = await runSmoke(
      { FAKE_PORT: String(port), FAKE_PAYLOAD: UNRESOLVED },
      { checksTimeout: 3 },
    )
    expect(code).toBe(1)
    expect(out).toContain('尚未跑第一轮')
  }, 30000)

  it('【契约】后端健康但前端算出的路径上找不到 runtime.json → exit 1', async () => {
    const port = await freePort()
    const { code, out } = await runSmoke({
      FAKE_PORT: String(port), FAKE_PAYLOAD: HEALTHY, FAKE_WRITE_RUNTIME: '0',
    })
    expect(code).toBe(1)
    // 必须断言「原因」：这条路径与「端口不一致」那条都会返回 1，
    // 只看 exit code 时两条会互相掩护（变异 M6 就是这样逃掉的）。
    expect(out).toContain('找不到 runtime.json')
    expect(out).toContain('契约破裂')
  }, 30000)

  it('【契约】runtime.json 报的端口与实际监听不一致 → exit 1', async () => {
    const port = await freePort()
    // freePort 连调两次可能拿到同一个临时端口（内核会立刻复用刚释放的号），
    // 那样这条用例就退化成「端口一致」，测不到东西。
    let other = await freePort()
    while (other === port) other = await freePort()
    const { code, out } = await runSmoke({
      FAKE_PORT: String(port), FAKE_PAYLOAD: HEALTHY, FAKE_RUNTIME_PORT: String(other),
    })
    expect(code).toBe(1)
    expect(out).toContain('不一致')
    expect(out).toContain(String(other))
  }, 30000)
})

describe('CI 接线与常量耦合（防止闸门被摘掉 / 常量被改散）', () => {
  const CI = path.join(REPO, '.github', 'workflows', 'ci.yml')
  const ciText = fs.existsSync(CI) ? fs.readFileSync(CI, 'utf8') : ''

  it('ci.yml 里真起了「暂存目录」的后端', () => {
    expect(ciText).toContain('tools/verify-backend-runtime.js')
    expect(ciText).toMatch(/verify-backend-runtime\.js\s+--exe\s+backend\/scada-backend\.exe/)
  })

  it('ci.yml 里真起了「安装包内」的后端（extraResources 的产物）', () => {
    expect(ciText).toMatch(
      /verify-backend-runtime\.js\s+--exe\s+release\/win-unpacked\/resources\/backend\/scada-backend\.exe/,
    )
  })

  it('闸门步骤不得挂 continue-on-error（fail-open 的另一种形态）', () => {
    const lines = ciText.split(/\r?\n/)
    const idx = lines.findIndex((l) => l.includes('tools/verify-backend-runtime.js'))
    expect(idx).toBeGreaterThan(-1)
    // 从步骤名往上找，检查该 step 内没有 continue-on-error
    const window = lines.slice(Math.max(0, idx - 12), idx + 1).join('\n')
    expect(window).not.toContain('continue-on-error')
  })

  it('健康等待超时必须显著大于后端巡检间隔（30s），否则闸门会随 runner 快慢抖动', () => {
    expect(gate.DEFAULT_CHECKS_TIMEOUT).toBeGreaterThanOrEqual(120)
  })

  it('若能找到后端源码，则把两处独立常量绑死', () => {
    // CI 的 electron-build 会 checkout 后端源码到 backend-src/；本机可能没有。
    const candidates = [
      path.join(REPO, 'backend-src', 'run.py'),
      path.join(REPO, '..', 'industrial_scada', 'run.py'),
    ]
    const runPy = candidates.find((p) => fs.existsSync(p))
    if (!runPy) {
      // 找不到就只保留上面的绝对下界断言（≥120），不静默通过
      return
    }
    const src = fs.readFileSync(runPy, 'utf8')
    const m = src.match(/start_periodic_checks\(\s*interval\s*=\s*(\d+)/)
    expect(m, '后端 run.py 里应能找到 start_periodic_checks(interval=...)').not.toBeNull()
    const interval = Number((m as RegExpMatchArray)[1])
    expect(gate.DEFAULT_CHECKS_TIMEOUT).toBeGreaterThanOrEqual(2 * interval)
  })

  it('fixture 必须走「每轮唯一 + 零删除」路线（防偶发失败回归）', () => {
    // 这是踩了三次才定下来的形状，三条一起守，缺一条就会重新变成偶发红：
    //
    // ① **本轮目录必须唯一**（带 `process.pid`）。不唯一 → 上一轮的 runtime.json/.env
    //    会被这一轮的 before 快照吃掉 → `cleanupCreated` 认为"不是新建的" → 确定性失败。
    // ② **不能靠"每轮开始清一次"来保证干净**。本机删除守卫按**整轮累计**计数
    //    （`{"count":50,"threshold":50,"scope":"turn"}`），累计到 50 后任何删除都抛异常 ——
    //    复位那一步会**自己**把整个文件搞挂（实测 run3/run4 在 19s/21s 就 FAIL）。
    // ③ **afterAll 不删东西**。删得再干净也还是在跟配额抢额度。
    //
    // 静态断言防的是「有人顺手改回去」：改回去不会有任何用例立刻变红，
    // 只会让套件重新变成"本机偶发红、CI 全绿"——最容易被当抖动放过的形态。
    const self = path.join(REPO, 'tests', 'tools', 'verify-backend-runtime.test.ts')
    const src = fs.readFileSync(self, 'utf8')

    expect(src, 'RUN_DIR 必须带 process.pid（每轮唯一，否则跨轮污染）').toMatch(
      /const RUN_DIR = [^\n]*process\.pid/,
    )
    expect(src, 'beforeAll 里不应有 rmSync（复位会自己撞上删除配额）').not.toMatch(
      /beforeAll\(\(\) => \{[\s\S]*?\n\}\)[\s\S]{0,50}?rmSync/,
    )
    const afterAllBody = src.match(/afterAll\(\(\) => \{[\s\S]*?\n\}\)/)?.[0] ?? ''
    expect(afterAllBody, 'afterAll 里不应有 rmSync（会消耗删除配额）').not.toContain('rmSync')
  })
})
