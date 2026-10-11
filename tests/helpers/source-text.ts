/**
 * 源码文本解析原语 —— 所有「守卫类测试」共用的**唯一真源**。
 *
 * 为什么必须有这个模块（2026-10-12）
 * ----------------------------------
 * 仓库里曾经有 **10 个测试文件各自写了一份 `stripComments`**，实现分成 **5 种**。
 * 它们都是**正则**实现，形态类似：
 *   src.replace(块注释正则, '').replace(行注释正则, '$1')
 *
 * 这种实现有一个**共同的、沉默的弱点**：它不认识字符串字面量。
 *   · `const s = 'a//b'`            → 被削成 `const s = 'a`   （字符串内容被当注释删了）
 *   · `const p = '（块注释开头）x（块注释结尾）'` → 字符串被整段当块注释删了
 *
 * 平时看不出来 —— 直到某个守卫要断言"**某字符串字面量里出现了 X**"
 * （例如断言 `url('...')`、`'http://...'`、`apiPath` 常量），
 * 它就会**把自己要断言的文本先剥掉**，然后断言永远通过/永远失败，
 * 而**没有任何测试会红**。这正是本项目反复栽的**「判据读错文本」**家族
 * （见 BUGS.md Bug 10/11/14/15）：
 *   · Bug 14 自喂陷阱：判据把自己的注释当成了"实现"（假绿）
 *   · Bug 15 弱断言：断言被函数体内残留**注释**里的词点亮（假绿）
 *   · 本条：判据把**字符串**当注释删掉（同族，第三形态）
 *
 * 5 种实现各自演进还会漂移：某一份修了 bug、其余 9 份没修，
 * 于是**同一个仓库里 10 个守卫的"注释语义"互不相同**，且无人知晓。
 *
 * 对策（两层）
 * ------------
 *   1. 本模块提供**状态机**版原语（逐字符扫描，正确识别字符串/模板/转义），
 *      作为全仓唯一真源；
 *   2. `tests/tools/no-local-source-parsers.test.ts` 元守卫**机械禁止**
 *      测试目录里再出现本地定义的同名函数 —— 必须从这里 import。
 *
 * ⚠️ 语义约定（务必看清，与旧的正则版**有意不同**）
 *   · `stripComments` **保留字符串与模板字面量的内容**（这是更正确的语义）；
 *   · 若你需要"代码骨架"（连字符串也抹掉，用于"关键字是否出现在**代码**里"），
 *     用 `stripCommentsAndStrings`。
 *   · 若还需要剥离 HTML/Vue 模板注释（`<!-- -->`），用 `stripHtmlComments` 包一层，
 *     或直接用 `stripComments(src, { html: true })`。
 */

/** 剥离选项。 */
export interface StripOptions {
  /** 是否一并剥离 HTML/Vue 模板注释 `<!-- ... -->`（默认 false）。 */
  html?: boolean
}

/**
 * 剥离源码中的**注释**，保留字符串字面量内容。
 *
 * 状态机逐字符扫描，正确处理：
 *   · 行注释 `// ...`；
 *   · 块注释 `/* ... *\/`；
 *   · 单引号 / 双引号 / 反引号（模板）字符串 —— 字符串内的 `//`、`/*` **不当注释**；
 *   · 反斜杠转义（`'a\'b'`、`\'`、`\\`）—— 不会把转义引号当成字符串结束。
 *
 * @param src  源码文本
 * @param opts `{ html: true }` 时额外剥离 HTML 注释
 */
export function stripComments(src: string, opts: StripOptions = {}): string {
  let out = ''
  let i = 0
  const n = src.length
  let quote: string | null = null
  /**
   * 上一个"有意义"的字符（跳过空白），用于区分 `/` 是**正则字面量**还是**除号**。
   *
   * 为什么必须有这个：`main.js` 第 636 行有 `.replace(/"/g, '&quot;')` ——
   * 正则字面量 `/"/g` 里有一个 ASCII 双引号。不认识正则的状态机会把它当成
   * **字符串开始**，于是 quote 永久错位，从那一行起后面所有 `//` 注释都剥不掉。
   * 实测（2026-10-12）：`startup-diagnostics.test.ts` 因此从「绿」变「红」，
   * 而根因是**共享原语的盲区**，不是被测代码的问题。旧的正则版 stripComments
   * 反而不受影响（它根本不追踪引号）—— 这是"更精确的实现引入新盲区"的典型。
   */
  let prevSignificant = ''

  while (i < n) {
    const ch = src[i]
    const next = src[i + 1]

    if (quote) {
      // 字符串内部：原样保留（含注释符号）
      out += ch
      if (ch === '\\') {
        // 转义：下一个字符原样带出，避免把「被转义的引号」误判为结束
        if (i + 1 < n) {
          out += src[i + 1]
          i += 2
        } else {
          i += 1
        }
        continue
      }
      if (ch === quote) quote = null
      i++
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      out += ch
      prevSignificant = ch
      i++
      continue
    }

    if (ch === '/' && next === '/') {
      // 行注释：吞到行尾，保留换行以维持行结构
      while (i < n && src[i] !== '\n') i++
      continue
    }

    if (ch === '/' && next === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2 // 跳过收尾的 */（若到文件尾则自然越界结束）
      continue
    }

    // 正则字面量：`/` 处于"表达式起始"位置时才是正则（否则是除号）。
    // 判据：上一个有意义字符不是标识符尾 / `)` / `]` / `}`（那些后面跟的是除号）。
    if (ch === '/' && isRegexStart(prevSignificant)) {
      const end = scanRegexLiteral(src, i)
      if (end > i) {
        out += src.slice(i, end)
        prevSignificant = '/' // 正则字面量整体视作一个"值"，其后可跟 `/`（除号）等
        i = end
        continue
      }
      // 不是合法正则（如未闭合）→ 退化为普通字符
    }

    out += ch
    if (ch !== ' ' && ch !== '\t' && ch !== '\r' && ch !== '\n') prevSignificant = ch
    i++
  }

  if (opts.html) return stripHtmlComments(out)
  return out
}

/**
 * 判断 `/` 是否处于**正则字面量**的起始位置。
 *
 * 依据上一个有意义字符：
 *   · 空（行首/文件首）→ 是；
 *   · 运算符 / 分隔符 / 开括号（`( , = : [ ! & | ? { } ; + - * % < > ~ ^`）→ 是；
 *   · 标识符字符 / 数字 / `)` / `]` / `}` / 引号结尾 → 否（那是除号）。
 *
 * 这是 JS 词法里经典的 `/` 歧义，纯文本层面无法 100% 判定（需要完整 AST），
 * 但上述启发式覆盖了真实代码里 99% 的情形，且**失败方向是安全**的：
 * 判错时最坏退化成"把除号当正则起点"，而 `scanRegexLiteral` 找不到合法收尾会返回原样。
 */
function isRegexStart(prev: string): boolean {
  if (prev === '') return true
  if (/[A-Za-z0-9_$)\]}'"`]/.test(prev)) return false
  return true
}

/**
 * 从 `i`（必须是 `/` 的位置）扫描一个正则字面量，返回**结束位置**（含 flags 之后）；
 * 若未找到合法收尾则返回 `i`（表示"这不是正则"）。
 *
 * 扫描规则：正则体内 `\x` 转义跳过；`[...]` 字符类内的 `/` 不算收尾；
 * 第一个不在字符类内、未被转义的 `/` 结束正则体；其后连续吃掉字母（flags）。
 * ⚠️ 正则体内**不允许换行** —— 遇到换行即判定"不是正则"（未闭合）。
 */
function scanRegexLiteral(src: string, i: number): number {
  let j = i + 1
  let inClass = false
  while (j < src.length) {
    const c = src[j]
    if (c === '\n' || c === '\r') return i // 正则不跨行 → 判定失败
    if (c === '\\') {
      j += 2
      continue
    }
    if (inClass) {
      if (c === ']') inClass = false
      j++
      continue
    }
    if (c === '[') {
      inClass = true
      j++
      continue
    }
    if (c === '/') {
      j++
      break
    }
    j++
  }
  if (j <= i + 1) return i
  // 吃掉 flags（字母）
  while (j < src.length && /[a-z]/i.test(src[j])) j++
  return j
}

/**
 * 剥离 HTML/Vue 模板注释 `<!-- ... -->`。
 * 独立导出，便于"只想剥 HTML 注释"的场景，也便于单测。
 */
export function stripHtmlComments(src: string): string {
  return src.replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * 剥离注释**与字符串字面量内容** —— 得到"纯代码骨架"。
 *
 * 用途：断言"某**标识符**是否出现在**代码**里"时，避免字符串里的同名文本
 * 冒充实现（例如 `console.log('spawn(')` 里的 `spawn(` 不是真调用）。
 *
 * 语义：字符串字面量整体替换为 `""`（保留一个占位，避免前后 token 粘连，
 * 与 `timeout-discipline.test.ts` 原 `stripCodeNoise` 行为一致）。
 */
export function stripCommentsAndStrings(src: string, opts: StripOptions = {}): string {
  const base = opts.html ? stripHtmlComments(src) : src
  let out = ''
  let i = 0
  const n = base.length

  while (i < n) {
    const ch = base[i]
    const next = base[i + 1]

    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(base, i)
      out += '""'
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < n && base[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < n && !(base[i] === '*' && base[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * 从 `i`（必须是引号位置）开始跳过一个字符串/模板字面量，
 * 返回**结束引号之后**的偏移。支持 `\` 转义。未闭合则返回 `src.length`。
 */
export function skipString(src: string, i: number): number {
  const quote = src[i]
  i++
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2
      continue
    }
    if (src[i] === quote) return i + 1
    i++
  }
  return src.length
}

/**
 * 从 `openIdx`（必须是 `(` 的位置）出发，返回**配对右括号**的偏移；
 * 找不到返回 -1。
 *
 * 跳过字符串/模板/行注释/块注释，因此括号出现在这些里面时不会被计入深度。
 */
export function matchParen(src: string, openIdx: number): number {
  let depth = 0
  let i = openIdx
  while (i < src.length) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(src, i)
      continue
    }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      i = nl < 0 ? src.length : nl
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? src.length : end + 2
      continue
    }
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

/**
 * 抠出一个具名**函数体**（从 `function name(...) {` 到配平 `}`），返回**不含外层花括号**的内容。
 *
 * 用花括号配平（而非正则贪婪/非贪婪匹配）—— 函数体里有多层 `{}`
 * （if / try / 对象字面量 / 模板里的 `${}` 已由 matchParen 的字符串跳过处理），
 * 简单 `{[\s\S]*?}` 会在第一个 `}` 处早停，把断言范围切错。
 *
 * ⚠️ 返回的是**原始文本（含注释）**。若要断言"某段代码里做了什么"，
 *    务必再套一层 `stripComments` —— 否则注释里的词会冒充实现（Bug 15 实测）。
 *
 * @returns 函数体文本；找不到该函数或花括号不配平返回 null
 */
export function extractFunctionBody(code: string, name: string): string | null {
  const start = code.search(new RegExp(`function\\s+${name}\\s*\\(`))
  if (start < 0) return null
  const braceOpen = code.indexOf('{', start)
  if (braceOpen < 0) return null
  const body = extractBraceBlock(code, braceOpen)
  return body
}

/**
 * 从 `openIdx`（必须是 `{` 的位置）出发，返回**花括号内部**的文本（不含外层 `{}`）。
 * 花括号不配平返回 null。跳过字符串/注释，避免其中的 `{}` 干扰配平。
 */
export function extractBraceBlock(src: string, openIdx: number): string | null {
  let depth = 0
  let i = openIdx
  while (i < src.length) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(src, i)
      continue
    }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      i = nl < 0 ? src.length : nl
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? src.length : end + 2
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return src.slice(openIdx + 1, i)
    }
    i++
  }
  return null
}
