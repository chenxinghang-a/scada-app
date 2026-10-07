import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * electron/backend-paths.js 的行为契约。
 *
 * 这个模块是「后端 exe / 运行时端口文件」的**唯一定位口径**，
 * `electron/main.js` 与 CI 闸门 `tools/verify-backend-runtime.js` 共用它。
 *
 * 它存在的原因是一个**真实缺陷**（2026-09-24 实测）：
 *   `main.js` 原先内联拼 `<backend_dir>/data/runtime.json`，注释还写着
 *   「与后端 paths.RUNTIME_JSON_PATH 对齐」。但实际发布的 onedir 布局下，
 *   后端 `paths.py` 取 `_BASE = exe_dir/_internal`，文件落在
 *   `<backend_dir>/_internal/data/runtime.json`。
 *   于是 `readRuntimePort()` 恒返回 null，整个 5000/5001 端口发现机制
 *   **从未生效过** —— 只是回退值 5000 恰好等于模拟模式端口才没暴露。
 *
 * 所以下面这条断言是本文件的**核心回归钉子**：
 *   「onedir 布局（只有 `_internal/data/runtime.json`）必须能被找到」。
 *
 * 夹具放在仓库内 `.vitest_cache/` 下（已 gitignore），**不做任何删除** ——
 * 环境对删除有批量保护，测试里删目录会弹确认框。
 */

const require_ = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bp: any = require_(path.join(process.cwd(), 'electron', 'backend-paths.js'))

const REPO = process.cwd()
const FIXTURE_ROOT = path.join(REPO, '.vitest_cache', 'backend-paths-fixtures', String(process.pid))

/** 造一个「后端目录」，可选地放入 runtime.json。 */
function makeBackendDir(
  name: string,
  opts: { onedirRuntime?: unknown; flatRuntime?: unknown } = {},
): { exe: string; onedirPath: string; flatPath: string } {
  const dir = path.join(FIXTURE_ROOT, name)
  const onedirPath = path.join(dir, '_internal', 'data', 'runtime.json')
  const flatPath = path.join(dir, 'data', 'runtime.json')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'scada-backend.exe'), '', 'utf8')
  if (opts.onedirRuntime !== undefined) {
    fs.mkdirSync(path.dirname(onedirPath), { recursive: true })
    fs.writeFileSync(onedirPath, JSON.stringify(opts.onedirRuntime), 'utf8')
  }
  if (opts.flatRuntime !== undefined) {
    fs.mkdirSync(path.dirname(flatPath), { recursive: true })
    fs.writeFileSync(flatPath, JSON.stringify(opts.flatRuntime), 'utf8')
  }
  return { exe: path.join(dir, 'scada-backend.exe'), onedirPath, flatPath }
}

beforeAll(() => {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true })
})

afterAll(() => {
  // 刻意不删：环境对删除有批量保护
})

describe('backend-paths 常量', () => {
  it('后端可执行文件名三处统一', () => {
    expect(bp.BACKEND_EXE_NAME).toBe('scada-backend.exe')
  })

  it('runtime.json 候选列表：onedir 在前、平铺在后', () => {
    expect(bp.RUNTIME_JSON_RELATIVE).toEqual([
      ['_internal', 'data', 'runtime.json'],
      ['data', 'runtime.json'],
    ])
  })
})

describe('getBackendPath', () => {
  it('打包态取 resources/backend/<exe>', () => {
    const p = bp.getBackendPath({
      isPackaged: true,
      resourcesPath: path.join('C:', 'app', 'resources'),
      appDir: path.join('C:', 'app', 'electron'),
    })
    expect(p).toBe(path.join('C:', 'app', 'resources', 'backend', 'scada-backend.exe'))
  })

  it('开发态取 <appDir>/../backend/<exe>', () => {
    const p = bp.getBackendPath({
      isPackaged: false,
      resourcesPath: 'ignored',
      appDir: path.join('C:', 'app', 'electron'),
    })
    expect(p).toBe(path.join('C:', 'app', 'backend', 'scada-backend.exe'))
  })
})

describe('runtimeJsonCandidates', () => {
  it('给出两个候选，onedir 优先', () => {
    const exe = path.join('C:', 'app', 'resources', 'backend', 'scada-backend.exe')
    expect(bp.runtimeJsonCandidates(exe)).toEqual([
      path.join('C:', 'app', 'resources', 'backend', '_internal', 'data', 'runtime.json'),
      path.join('C:', 'app', 'resources', 'backend', 'data', 'runtime.json'),
    ])
  })
})

describe('findRuntimeJson / readRuntimePort', () => {
  it('【核心回归】onedir 布局必须能找到 runtime.json', () => {
    // 这正是 2026-09-24 修掉的缺陷：只拼 <dir>/data/runtime.json 时这里返回 null
    const { exe, onedirPath } = makeBackendDir('onedir-only', {
      onedirRuntime: { port: 5000, host: '127.0.0.1', mode: 'simulated' },
    })
    expect(bp.findRuntimeJson(exe)).toBe(onedirPath)
    expect(bp.readRuntimePort(exe)).toBe(5000)
  })

  it('平铺布局（onefile / 配置目录平铺）也能找到', () => {
    const { exe, flatPath } = makeBackendDir('flat-only', {
      flatRuntime: { port: 5001, mode: 'real' },
    })
    expect(bp.findRuntimeJson(exe)).toBe(flatPath)
    expect(bp.readRuntimePort(exe)).toBe(5001)
  })

  it('两种都在时优先 onedir（避免读到陈旧的平铺文件）', () => {
    const { exe, onedirPath } = makeBackendDir('both', {
      onedirRuntime: { port: 5000 },
      flatRuntime: { port: 5001 },
    })
    expect(bp.findRuntimeJson(exe)).toBe(onedirPath)
    expect(bp.readRuntimePort(exe)).toBe(5000)
  })

  it('都没有时返回 null（不抛异常 —— 这是辅助手段，不是判定依据）', () => {
    const { exe } = makeBackendDir('none')
    expect(bp.findRuntimeJson(exe)).toBeNull()
    expect(bp.readRuntimePort(exe)).toBeNull()
  })

  it('端口字段缺失 / 类型不对 / 越界一律 null', () => {
    const cases: Array<[string, unknown]> = [
      ['无 port 字段', { host: '127.0.0.1' }],
      ['port 是字符串', { port: '5000' }],
      ['port 是布尔', { port: true }],
      ['port 为 0', { port: 0 }],
      ['port 为负', { port: -1 }],
      ['port 越界', { port: 70000 }],
      ['port 是小数', { port: 5000.5 }],
      ['顶层不是对象', [1, 2, 3]],
    ]
    for (const [label, payload] of cases) {
      const { exe } = makeBackendDir(`bad-${label}`, { onedirRuntime: payload })
      expect(bp.readRuntimePort(exe), label).toBeNull()
    }
  })

  it('runtime.json 内容不是合法 JSON 时返回 null', () => {
    const dir = path.join(FIXTURE_ROOT, 'broken-json')
    fs.mkdirSync(path.join(dir, '_internal', 'data'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'scada-backend.exe'), '', 'utf8')
    fs.writeFileSync(path.join(dir, '_internal', 'data', 'runtime.json'), '{not json', 'utf8')
    expect(bp.findRuntimeJson(path.join(dir, 'scada-backend.exe'))).not.toBeNull()
    expect(bp.readRuntimePort(path.join(dir, 'scada-backend.exe'))).toBeNull()
  })

  it('runtime.json 是目录时视为「没找到」，不抛异常', () => {
    const dir = path.join(FIXTURE_ROOT, 'runtime-is-dir')
    fs.mkdirSync(path.join(dir, '_internal', 'data', 'runtime.json'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'scada-backend.exe'), '', 'utf8')
    expect(bp.findRuntimeJson(path.join(dir, 'scada-backend.exe'))).toBeNull()
    expect(bp.readRuntimePort(path.join(dir, 'scada-backend.exe'))).toBeNull()
  })
})
