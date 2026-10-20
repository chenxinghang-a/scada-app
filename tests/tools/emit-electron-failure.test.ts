/**
 * `emit_electron_failure.py` 的第二条注解：打包版运行时探针的输出。
 *
 * 背景（2026-10-20）
 * -----------------
 * `electron-build` 作业里有两类完全不同的失败：
 *   ① electron-builder 装不出包；
 *   ② 包装出来了、但**启动后打不开**（`verify-packaged-runtime.js` 的 CDP 探针）。
 *
 * 当天实测：②偶发失败（重跑即绿），而失败注解里只有 electron-builder 的进度行 ——
 * 因为注解脚本只读 `electron-build.log`，而那份日志在②里是**成功的**。
 * 结果就是「红了但不知道为什么红」，而 CI 的 job log 又拿不到（403，需管理员）。
 *
 * 修法：探针自己把输出 tee 到 `.vitest_cache/packaged-runtime.log`，
 * 注解脚本读它、单独发一条 annotation。
 *
 * 本测试钉三件事：
 *   ① 有运行时日志时，注解里出现探针输出，且**不再**误报「未找到构建日志」；
 *   ② 只有构建日志时，行为不变（原有通道不能被这次改动弄坏）；
 *   ③ 两处路径必须一致（脚本写哪儿 = 注解读哪儿），否则静默失联。
 */

import { describe, it, expect } from 'vitest'
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const REPO = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO, '.github', 'scripts', 'emit_electron_failure.py')
const RUNTIME_TOOL = path.join(REPO, 'tools', 'verify-packaged-runtime.js')

/** 在指定 cwd 下跑注解脚本，返回 stdout+stderr（异步 spawn：本目录约定）。 */
function runReporter(cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('python', [SCRIPT], { cwd })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { out += d })
    child.on('error', (e) => resolve(`spawn 失败: ${e.message}`))
    child.on('close', () => resolve(out))
  })
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'emit-ann-'))
}

describe('emit_electron_failure：运行时探针注解', () => {
  it('只有运行时日志时，发出探针注解且不误报「未找到构建日志」', async () => {
    const dir = makeTempDir()
    fs.mkdirSync(path.join(dir, '.vitest_cache'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, '.vitest_cache', 'packaged-runtime.log'),
      [
        '[packaged-runtime] 调试端口：9333',
        '[packaged-runtime] 启动打包版：release/win-unpacked/SmartSCADA.exe',
        '[packaged-runtime] 40s 内没等到调试端口/页面目标 —— fail-closed。',
      ].join('\n'),
      'utf8',
    )

    const out = await runReporter(dir)

    expect(out).toContain('::error title=打包版运行时验证失败::')
    expect(out, '注解里必须带探针的原始输出（否则看不出卡在哪一步）')
      .toContain('40s 内没等到调试端口/页面目标')
    expect(out, '构建日志不存在，但失败在运行时探针 —— 不该报「未找到 electron-build.log」')
      .not.toContain('未找到 electron-build.log')
  }, 30000)

  it('只有构建日志时，行为与改动前一致', async () => {
    const dir = makeTempDir()
    fs.writeFileSync(
      path.join(dir, 'electron-build.log'),
      '  • packaging       platform=win32 arch=x64\n  ⨯ cannot execute 7za\n',
      'utf8',
    )

    const out = await runReporter(dir)

    expect(out).toContain('::error title=electron-builder 失败关键行::')
    expect(out).toContain('cannot execute')
    expect(out).not.toContain('打包版运行时验证失败')
  }, 30000)

  it('两处路径一致：脚本写的文件 = 注解读的文件', () => {
    const tool = fs.readFileSync(RUNTIME_TOOL, 'utf8')
    const reporter = fs.readFileSync(SCRIPT, 'utf8')

    // 脚本侧：path.join(cacheDir, 'packaged-runtime.log')，cacheDir = REPO/.vitest_cache
    expect(tool).toContain("path.join(cacheDir, 'packaged-runtime.log')")
    expect(tool).toContain("path.join(REPO, '.vitest_cache')")
    // 注解侧：Path('.vitest_cache') / 'packaged-runtime.log'
    expect(reporter).toContain("pathlib.Path('.vitest_cache')")
    expect(reporter).toContain("'packaged-runtime.log'")
  })

  it('tee 只在直接执行时安装（被 require 不应写文件）', () => {
    const tool = fs.readFileSync(RUNTIME_TOOL, 'utf8')
    expect(tool).toMatch(/if \(require\.main === module\) \{\s*installLogTee\(\)/)
  })
})
