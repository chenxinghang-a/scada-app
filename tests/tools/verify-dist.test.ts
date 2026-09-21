import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * tools/verify-dist.js 的行为契约。
 *
 * 背景：本机环境的批量删除保护会在 `vite build` 的 emptyOutDir 阶段中途拦截，
 * 把 dist/ 删成半拉子（index.html 引用着已经消失的 CSS/JS）。此时
 * electron-builder 照样打包成功，装出来的应用运行时才 404。
 * 这个脚本就是那道「不许把不完整产物打成包」的闸门。
 *
 * 夹具放在仓库内 `.vitest_cache/` 下（已 gitignore），**不做任何删除** ——
 * 环境对删除有批量保护，测试里删目录会弹出确认框。
 */

const REPO = process.cwd()
const TOOL = path.join(REPO, 'tools', 'verify-dist.js')
const FIXTURE_ROOT = path.join(REPO, '.vitest_cache', 'verify-dist-fixtures', String(process.pid))

function makeDist(name: string, files: Record<string, string | null>): string {
  const dir = path.join(FIXTURE_ROOT, name)
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    // null = 建一个零字节文件（模拟被删到只剩空壳）
    fs.writeFileSync(p, content === null ? '' : content, 'utf8')
  }
  return dir
}

function run(dir: string): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [TOOL, dir], { encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, out }
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? -1, out: String(err.stdout || '') + String(err.stderr || '') }
  }
}

const HEALTHY_HTML = [
  '<!DOCTYPE html><html><head>',
  '<script type="module" src="./assets/index-AAA.js"></script>',
  '<link rel="stylesheet" href="./assets/vendor-element-BBB.css">',
  '<link rel="stylesheet" href="./assets/index-CCC.css">',
  '</head><body></body></html>',
].join('\n')

const HEALTHY_FILES = {
  'index.html': HEALTHY_HTML,
  'assets/index-AAA.js': 'console.log(1)',
  'assets/vendor-element-BBB.css': '.a{color:red}',
  'assets/index-CCC.css': '.b{color:blue}',
}

beforeAll(() => {
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true })
})

describe('tools/verify-dist.js 构建产物闸门', () => {
  it('引用全部存在 → 通过（exit 0）', () => {
    const dir = makeDist('healthy', HEALTHY_FILES)
    const r = run(dir)
    expect(r.code).toBe(0)
    expect(r.out).toContain('均存在且非空')
  })

  it('被引用的 CSS 消失（批量删除保护的真实后果）→ 拒绝（exit 1）', () => {
    const dir = makeDist('missing-css', {
      'index.html': HEALTHY_HTML,
      'assets/index-AAA.js': 'console.log(1)',
      // 刻意不建 assets/vendor-element-BBB.css
      'assets/index-CCC.css': '.b{color:blue}',
    })
    const r = run(dir)
    expect(r.code).toBe(1)
    expect(r.out).toContain('vendor-element-BBB.css')
    expect(r.out).toContain('拒绝打包')
  })

  it('被引用的文件存在但为零字节 → 同样拒绝（存在 ≠ 可用）', () => {
    const dir = makeDist('empty-file', { ...HEALTHY_FILES, 'assets/index-AAA.js': null })
    const r = run(dir)
    expect(r.code).toBe(1)
    expect(r.out).toContain('index-AAA.js')
  })

  it('index.html 不存在 → exit 2（区分「产物没构建」与「产物不完整」）', () => {
    const dir = makeDist('no-index', { 'assets/index-AAA.js': 'x' })
    const r = run(dir)
    expect(r.code).toBe(2)
    expect(r.out).toContain('找不到构建产物')
  })

  it('本地引用数异常偏少（产物只剩空壳）→ 拒绝', () => {
    const dir = makeDist('too-few-refs', {
      'index.html': '<html><head><link rel="stylesheet" href="./assets/only.css"></head></html>',
      'assets/only.css': '.x{}',
    })
    const r = run(dir)
    expect(r.code).toBe(1)
    expect(r.out).toContain('异常偏少')
  })

  it('外链 / data: / 锚点不参与本地校验', () => {
    const html = [
      '<html><head>',
      '<link rel="stylesheet" href="https://cdn.example.com/x.css">',
      '<link rel="stylesheet" href="data:text/css,.a{}">',
      '<script type="module" src="./assets/index-AAA.js"></script>',
      '<link rel="stylesheet" href="./assets/index-CCC.css">',
      '</head><body><a href="#top">top</a></body></html>',
    ].join('\n')
    const dir = makeDist('external-refs', {
      'index.html': html,
      'assets/index-AAA.js': 'x',
      'assets/index-CCC.css': '.c{}',
    })
    const r = run(dir)
    expect(r.code).toBe(0)
    expect(r.out).toContain('本地引用数: 2')
  })

  it('带 query/hash 的引用按去参后比对', () => {
    const html = [
      '<html><head>',
      '<script type="module" src="./assets/index-AAA.js"></script>',
      '<link rel="stylesheet" href="./assets/index-CCC.css?v=2#x">',
      '</head></html>',
    ].join('\n')
    const dir = makeDist('with-query', {
      'index.html': html,
      'assets/index-AAA.js': 'x',
      'assets/index-CCC.css': '.c{}',
    })
    expect(run(dir).code).toBe(0)
  })
})
