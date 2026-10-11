/**
 * 元守卫：**源码解析原语必须来自共享模块，禁止本地重写**（2026-10-12）。
 *
 * 为什么需要这条
 * --------------
 * 仓库里曾经有 **10 个测试文件各自写了一份 `stripComments`**，实现分成 **5 种**，
 * 而且**5 种全都不认识正则字面量** —— 例如 `main.js:636` 的
 *   `.replace(/"/g, '&quot;')`
 * 里面那个 `"` 会被错误剥离逻辑当成**字符串开始**，导致其后所有 `//` 注释都剥不掉。
 *
 * 这个缺陷在旧的正则版里**恰好不暴露**（正则版不追踪引号），
 * 但一旦有人把某一份升级成"更正确的状态机版"，那份守卫就会**静默失真**
 * —— 而且失真方向是**假红**（`startup-diagnostics.test.ts` 实测：迁到共享版后
 * 第一次跑真红了，查半天才发现是共享原语自己的盲区）。
 *
 * 更糟的是"各自演进"：某一份修了 bug、其余 9 份没修 →
 * **同一仓库里 10 个守卫的"注释语义"互不相同**，且无人知晓。
 *
 * 本守卫的对策是**机械禁止本地重写**：测试目录里不得再出现这些函数定义，
 * 只能从 `tests/helpers/source-text.ts` import。
 * 这样"语义一致性"由**单一真源 + 一处修订**保证，而不是靠"记得同步 10 份"。
 *
 * 这与 `timeout-discipline.test.ts`（禁止漏超时）、`gate-wiring.test.ts`
 * （禁止死闸门 / 孤儿脚本）是同一族：**把一条需要人记住的纪律，变成一条会红的断言。**
 */

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { stripComments, matchParen } from '../helpers/source-text'

const REPO = process.cwd()
const TESTS = path.join(REPO, 'tests')
const SHARED = path.join(TESTS, 'helpers', 'source-text.ts')

/** 必须走共享模块的函数名（本地重写即违规）。 */
const SHARED_PRIMITIVES = [
  'stripComments',
  'stripHtmlComments',
  'stripCommentsAndStrings',
  'skipString',
  'matchParen',
  'extractFunctionBody',
  'extractBraceBlock',
]

/** 递归收集所有 .ts/.js 文件（含 .test.ts 与 helpers）。 */
function collectFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...collectFiles(p))
    else if (e.isFile() && /\.(ts|js)$/.test(e.name)) out.push(p)
  }
  return out
}

/**
 * 找出源码里**本地定义**了某个共享原语的函数。
 * 只用"定义"形态匹配，不用"引用"形态 —— 调用是允许的（导入后调用）。
 */
function localDefinitions(src: string, name: string): boolean {
  const code = stripComments(src) // 注释里的提及不算（本文档自己就提到了这些名字）
  // `function name(` —— 函数声明
  if (new RegExp(`\\bfunction\\s+${name}\\s*\\(`).test(code)) return true
  // `const name = (…) =>` / `const name = function` —— 箭头/表达式声明
  if (new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*(?:\\(|function\\b|async\\b)`).test(code)) {
    return true
  }
  return false
}

/**
 * 找出源码里**内联的注释剥离**（不写成函数，所以函数定义扫描抓不到）。
 *
 * 真实教训（2026-10-12，本轮第二次发现）：`i18n/locale-parity.test.ts`
 * 里有这么一段 —— 它**没有** `function stripComments`，所以首版元守卫放过了它：
 *   const text = fs.readFileSync(full,'utf8')
 *     .replace(/块注释正则/g, '')
 *     .replace(/行注释正则, '$1')
 * 依然是"第 6 份正则实现"，依然不认识正则字面量。
 *
 * ⚠️ 这正是**守卫自己要防的那个病**：判据（只抓函数定义）比它要防的事（一切就地剥离）
 *    范围更小 —— Bug 15 同款。所以必须补上内联形态的探测。
 *
 * 判据（避免退化成"文本特征匹配"）：定位每个 `.replace(` 调用，抠出它的**第一个实参**，
 * 看该实参是不是一个**注释类正则字面量** —— 即 `/.../`，且体内含 `[\s\S]`（块注释特征）
 * 或 `//` 或 `^|[^:]`（行注释特征）。三者都是"就地剥注释"的指纹。
 */
function inlineCommentStrip(src: string): boolean {
  const code = stripComments(src) // 注释里的提及不算（本文件自己就写了这些形态）
  const callRe = /\.replace\s*\(/g
  let m: RegExpExecArray | null
  while ((m = callRe.exec(code)) !== null) {
    const open = m.index + m[0].length - 1 // 指向 `(` 
    const close = matchParen(code, open)
    if (close < 0) continue
    const args = code.slice(open + 1, close)
    // 取第一个实参（到第一个顶层逗号为止）
    const arg1 = args.split(',')[0] ?? ''
    // 必须是正则字面量：/.../
    const rx = arg1.match(/^\s*\/[\s\S]*\/[gimsuy]*\s*$/)
    if (!rx) continue
    const body = arg1
    // 注释类指纹
    if (body.includes('[\\s\\S]') || body.includes('//') || body.includes('^|[^:]')) return true
  }
  return false
}

/**
 * 内联剥离的**显式豁免表**（每条都要写清理由）。
 *
 * 只允许"为了**证明共享版优于旧实现**而刻意保留旧实现作反例"这一种情形。
 * 豁免表本身也要有守卫（见用例"豁免表里不得出现已删除的文件"）。
 */
const INLINE_STRIP_EXEMPTIONS: Array<{ file: string; why: string }> = [
  {
    file: 'tests/helpers/source-text.test.ts',
    why:
      '共享原语的单测需要**反例对照**：其中 legacyStripByRegex 刻意复刻旧正则实现，' +
      '用来断言"它在字符串含 // 时会失真"（证明共享版更正确）。' +
      '它不是任何守卫的解析依赖，只是被断言的测试夹具。',
  },
]

describe('元守卫：源码解析原语必须来自共享模块', () => {
  const files = collectFiles(TESTS)
  const self = path.join(TESTS, 'tools', 'no-local-source-parsers.test.ts')

  it('至少扫到一批文件（否则守卫形同虚设）', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it('共享模块存在且导出了全部原语（防止"共享模块被删/改名"后守卫变瞎）', () => {
    const src = fs.readFileSync(SHARED, 'utf8')
    for (const name of SHARED_PRIMITIVES) {
      expect(
        new RegExp(`export\\s+function\\s+${name}\\b`).test(src),
        `tests/helpers/source-text.ts 未导出 ${name} —— 共享真源被破坏`,
      ).toBe(true)
    }
  })

  it('测试目录里不得**本地定义**这些原语（必须 import 共享模块）', () => {
    const offenders: string[] = []
    for (const f of files) {
      if (f === SHARED) continue // 真源本身当然有定义
      if (f === self) continue // 本守卫（它用字符串字面量列出名字，不是定义）
      const src = fs.readFileSync(f, 'utf8')
      for (const name of SHARED_PRIMITIVES) {
        if (localDefinitions(src, name)) {
          offenders.push(`${path.relative(REPO, f)} 定义了 ${name}`)
        }
      }
    }
    expect(
      offenders,
      '以下文件**重写**了共享解析原语，会造成"同一仓库多种注释语义"且各自漂移：\n' +
        offenders.map((o) => `  ${o}`).join('\n') +
        '\n修法：删除本地定义，改为 `import { ... } from "<相对路径>/helpers/source-text"`。\n' +
        '若确有共享模块不支持的需求，请**扩展共享模块**（并补单测），而不是就地再写一份。',
    ).toEqual([])
  })

  it('测试目录里不得**内联**剥注释（.replace(/注释正则/) —— 函数定义扫描抓不到这种）', () => {
    const exempt = new Set(INLINE_STRIP_EXEMPTIONS.map((e) => e.file))
    const offenders: string[] = []
    for (const f of files) {
      if (f === SHARED) continue
      if (f === self) continue
      const rel = path.relative(REPO, f).split(path.sep).join('/')
      if (exempt.has(rel)) continue
      const src = fs.readFileSync(f, 'utf8')
      if (inlineCommentStrip(src)) {
        offenders.push(rel)
      }
    }
    expect(
      offenders,
      '以下文件**就地内联**了注释剥离（`.replace(/…注释正则…/)`），是"第 N 份正则实现"：\n' +
        offenders.map((o) => `  ${o}`).join('\n') +
        '\n这类实现不认识正则字面量（如 `/"/g` 里的引号），会让剥离结果静默出错。\n' +
        '修法：改用 `stripComments(src, { html: true })`（来自共享模块）。\n' +
        '确有"必须保留旧实现"的理由（如反例对照），请登记进 INLINE_STRIP_EXEMPTIONS 并写清原因。',
    ).toEqual([])
  })

  it('豁免表里不得出现已删除的文件（防豁免表腐烂成"后门清单"）', () => {
    for (const e of INLINE_STRIP_EXEMPTIONS) {
      const abs = path.join(REPO, e.file)
      expect(fs.existsSync(abs), `豁免表登记的 ${e.file} 已不存在 —— 请清理豁免表`).toBe(true)
      expect(e.why.length, `豁免 ${e.file} 必须写清理由`).toBeGreaterThan(20)
    }
  })

  it('判别力自检：本地定义确实会被本守卫识别（防"守卫永远绿"）', () => {
    // 合成夹具：一份"本地定义 stripComments"的源码
    const poisoned = [
      'function stripComments(src: string) {',
      "  return src.replace(/\\/\\/.*$/gm, '')",
      '}',
      'export const x = stripComments("a // b")',
    ].join('\n')
    expect(localDefinitions(poisoned, 'stripComments')).toBe(true)

    // 对照：只是 import + 调用，不算违规
    const clean = [
      "import { stripComments } from '../helpers/source-text'",
      'const CODE = stripComments("a // b")',
    ].join('\n')
    expect(localDefinitions(clean, 'stripComments')).toBe(false)

    // 对照：注释里的提及不算（本文档顶部就提到了这些名字）
    const onlyComment = [
      '/** 说明：这里曾经写过 function stripComments(...) 但已迁移 */',
      "import { stripComments } from '../helpers/source-text'",
    ].join('\n')
    expect(localDefinitions(onlyComment, 'stripComments')).toBe(false)
  })

  it('判别力自检：内联剥注释会被识别；而普通过滤型 replace 不误报', () => {
    // 真实踩到的形态（locale-parity.test.ts 迁移前）
    const inlineBlock = [
      'const text = fs.readFileSync(full, "utf8")',
      "  .replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')",
      "  .replace(/(^|[^:])\\/\\/.*$/gm, '$1')",
    ].join('\n')
    expect(inlineCommentStrip(inlineBlock)).toBe(true)

    // 对照：与注释无关的 replace 不得误报
    const innocuous = [
      "const s = 'a-b'.replace(/-/g, '_')",
      "const u = x.replace(/\\s+/g, ' ').trim()",
    ].join('\n')
    expect(inlineCommentStrip(innocuous)).toBe(false)

    // 对照：注释里提到这些正则不算（本文件自己就写了）
    const inComment = [
      '/** 曾写过 .replace(/\\/\\*[\\s\\S]*?\\*\\//g, "") 但已迁移 */',
      "const a = 1",
    ].join('\n')
    expect(inlineCommentStrip(inComment)).toBe(false)
  })
})
