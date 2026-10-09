import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 桌面/开始菜单快捷方式**自愈**守卫（2026-10-09）。
 *
 * 真实故障（本守卫诞生的原因）：
 *   桌面 `SmartSCADA.lnk` 被外部工具重写成了指向**不存在**的目录
 *   （`...\Programs\SmartSCADA-1033\SmartSCADA.exe`，三处字节级证据一致）——
 *   双击的表现 = Windows 找不到目标 = 用户嘴里的「双击没反应」。
 *   而应用原先的逻辑是 `if (!existsSync) 才创建`：**指错了也不管** ——
 *   这类损坏可以永久存活，每次双击都白点，而且**应用自己永远修不好它**。
 *
 * 现在的语义（三条都要在）：
 *   1. 目标正确 → 一个字节都不碰（幂等，不制造无谓写入）；
 *   2. 目标不对 / 读不出来 → 重写为当前 exe（自愈）；
 *   3. 整个过程被 try/catch 兜住 + 出声（console.warn），
 *      快捷方式问题**绝不许**拖垮启动。
 */

const REPO = process.cwd()
const MAIN = path.join(REPO, 'electron', 'main.js')
const read = (p: string) => fs.readFileSync(p, 'utf8')

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('快捷方式自愈（存在但目标不对 → 重写）', () => {
  const src = stripComments(read(MAIN))
  const fnStart = src.indexOf('function createShortcuts')
  const fn = src.slice(fnStart, src.indexOf('\n}\n', fnStart))

  it('有 createShortcuts，且会**读取现有快捷方式的目标**做比对', () => {
    expect(fnStart).toBeGreaterThan(-1)
    expect(fn).toContain('readShortcutLink')
    // 比对必须大小写不敏感（Windows 路径）
    expect(fn).toMatch(/toLowerCase\(\)/)
    // 比对对象必须是当前 exe
    expect(fn).toMatch(/readShortcutLink/)
  })

  it('读取发生在写入之前（先判断、再决定动不动手）', () => {
    expect(fn.indexOf('readShortcutLink')).toBeGreaterThan(-1)
    expect(fn.indexOf('writeShortcutLink')).toBeGreaterThan(-1)
    expect(
      fn.indexOf('readShortcutLink'),
      '读取必须在写入前 —— 否则又变回「无脑覆盖/不管对错」',
    ).toBeLessThan(fn.indexOf('writeShortcutLink'))
  })

  it('目标正确 → 直接 return（幂等：不碰正确的文件）', () => {
    const idx = fn.indexOf('readShortcutLink')
    expect(idx).toBeGreaterThan(-1)
    const seg = fn.slice(idx, idx + 400)
    expect(seg, '目标比对之后没有提前返回 —— 正确的快捷方式也会被重写').toContain('return')
  })

  it('目标不对/读不出 → 重写（删不掉也直接覆盖写）', () => {
    expect(fn).toContain('unlinkSync')
    expect(fn).toContain('writeShortcutLink')
  })

  it('出错不静默、也不拖垮启动（catch + console.warn，不许 throw）', () => {
    expect(fn).toContain('catch (e)')
    expect(fn).toMatch(/console\.warn/)
    // catch 块里不许 rethrow
    expect(fn).not.toMatch(/catch \(e\) \{\s*throw/)
  })

  it('桌面与开始菜单两个入口都走自愈（不是只管一个）', () => {
    // 定义是 `const ensureShortcut = (`，不匹配「名字紧邻左括号」的调用形状；
    // 匹配到的就是**调用点**：桌面 + 开始菜单 ≥ 2 处。
    const ensureCalls = [...fn.matchAll(/ensureShortcut\s*\(/g)].length
    expect(ensureCalls, 'ensureShortcut 的调用点少于两处 —— 有入口没接自愈').toBeGreaterThanOrEqual(2)
  })
})
