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
  // ⚠️ 切片必须真正停在函数结尾。2026-10-10 发现：原实现用 indexOf('\n}\n')
  // 找函数尾，但**工作区文件是 CRLF**（pnpm/git autocrlf），'\n}\n' 永远匹配不到
  // → slice(fnStart, -1) = 扫到**文件尾**，断言被函数后面的代码喂饱（变异不红）。
  // 修法：从 fnStart 起找第一个**行首顶格 }**（兼容 CRLF/LF；函数体内所有 } 都有缩进）。
  const fnEndMatch = /^}/m.exec(src.slice(fnStart))
  const fn = src.slice(fnStart, fnStart + (fnEndMatch ? fnEndMatch.index : src.length - fnStart))

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

  it('开发模式（未打包）不碰快捷方式 —— 否则会把桌面图标带歪到 electron.exe', () => {
    // 推演过的真实风险：`electron:dev` 下 app.getPath('exe') 是 node_modules
    // 里的 electron.exe；自愈会忠实执行「把错误目标改成当前 exe」——
    // 于是用户的桌面图标被「修复」成 electron.exe，比不修还糟。
    const guardIdx = fn.indexOf('isPackaged')
    expect(guardIdx, '没有 app.isPackaged 守卫').toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(fn.indexOf('readShortcutLink'))
    expect(guardIdx).toBeLessThan(fn.indexOf('writeShortcutLink'))
    expect(fn.slice(guardIdx, guardIdx + 60), '守卫必须早退（return），不是记个标记继续走').toMatch(/return/)
  })

  it('孤儿 lnk（旧版无子目录版）存在才修、复用自愈逻辑（只修不删、不新建）', () => {
    // 实机发现（2026-10-10）：旧版本曾在 `Programs\` 直下写过无子目录的
    // `SmartSCADA.lnk`；升级后没人管它，实测有一条被外部工具写坏成
    // `C:\UserscxxAppData...SmartSCADA-1033\...`（反斜杠全丢）——点击必失败。
    // 纪律：① 路径必须区分于子目录版（`'Programs', 'SmartSCADA'` vs `'Programs', 'SmartSCADA.lnk'`）；
    //      ② existsSync 门控（不新建 —— 全新环境不该产生无子目录版）；
    //      ③ 复用 ensureShortcut（同一套「读比对→不对才重写，且只修不删」）。
    const orphanIdx = fn.search(/'Programs',\s*'SmartSCADA\.lnk'/)
    expect(orphanIdx, '没有处理旧版无子目录版 lnk 的路径构造').toBeGreaterThan(-1)
    const existsIdx = fn.indexOf('existsSync', orphanIdx)
    expect(existsIdx, '孤儿 lnk 没有 existsSync 门控 —— 会新建不该存在的条目').toBeGreaterThan(orphanIdx)
    const after = fn.slice(orphanIdx, Math.min(fn.length, orphanIdx + 220))
    expect(after, '孤儿 lnk 没有复用 ensureShortcut 自愈').toContain('ensureShortcut')
  })
})
