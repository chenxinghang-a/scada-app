import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 元守卫：**真起子进程的用例必须显式给超时**（2026-10-12）。
 *
 * 真实教训（本族第 3 次，每次都是同一个形状）：
 *   · 第 1 次 `cleanupUntilClean` 满载并行超了 vitest 默认 5s；
 *   · 第 2 次批量给 12 个起子进程的用例补 30s；
 *   · 第 3 次（本轮）`verify-staging.test.ts` 里 10 个真起 node 进程的用例
 *     **又是默认 5s** —— 本机 4 核单用例就跑 334~877ms，CI 是 **2 核**，
 *     并行满载时 2~3 倍 → 逼近甚至超过 5s（不确定的红，最耗人）。
 *
 * 为什么必须机械守卫而不是"记得加"：
 *   每次新增一个起进程的用例，作者都要**主动想起**这条纪律 ——
 *   而 CI runner 只有 2 核这一事实**在任何本地运行里都看不见**，
 *   所以这类缺陷**本地永远绿**、只在 CI 偶发红，且复现困难。
 *
 * 判据：`it(...)` 块内出现"真起进程"的调用 → 该 `it` 必须带显式超时参数。
 *   真起进程的信号：`spawn(` / `spawnSync(` / `execFile(` / `execFileSync(` /
 *   `execSync(` / `child_process`；以及本仓的本地包装 `await run(` /
 *   `await runWithEnv(` / `await runCmd(`（它们内部都是 spawn）。
 *   显式超时的形态：`it('...', async () => { ... }, 30000)` —— 第一个参数的
 *   收尾 `)` 之后跟 `, <数字>)`。
 */

const REPO = process.cwd()

/** 收集所有测试文件（递归）。 */
function collectTestFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...collectTestFiles(p))
    else if (e.isFile() && /\.test\.(ts|js)$/.test(e.name)) out.push(p)
  }
  return out
}

/** 真起进程的信号（在 it 块体内出现即算）。 */
const SPAWNS = [
  /\bspawn\s*\(/,
  /\bspawnSync\s*\(/,
  /\bexecFile\s*\(/,
  /\bexecFileSync\s*\(/,
  /\bexecSync\s*\(/,
  /\bchild_process\b/,
  /\bawait\s+run\s*\(/,
  /\bawait\s+runWithEnv\s*\(/,
  /\bawait\s+runCmd\s*\(/,
]

/**
 * 从一个测试文件源码里提取所有 `it(...)` 块。
 * 返回每块的：标题、起始偏移、**块体收尾**的偏移（用于判断其后是否跟超时）。
 *
 * 解析法：找 `it(` / `it.only(` / `it.each(...)(` 的起点，用**括号配对**找
 * 到第一个参数（标题）的收尾，再找到该 `it` 调用的整体收尾 ——
 * 即从 `it(` 的左括号开始配对，配到平衡的那个右括号。
 * 文本里可能出现字符串/模板里的括号，用**跳过字符串字面量**的方式规避。
 */
interface ItBlock {
  title: string
  body: string
  /** `it(...)` 最后一个参数（超时）是否存在 —— true 表示带显式超时。 */
  hasTimeout: boolean
}

function extractItBlocks(src: string): ItBlock[] {
  const blocks: ItBlock[] = []
  // `it` 前面可以是行首/空白，标题用引号包裹；也支持 it.only / it.skip。
  const itRe = /(^|[\s;{}()])it(?:\.\w+(?:\([^)]*\))?)?\s*\(/g
  let m: RegExpExecArray | null
  while ((m = itRe.exec(src)) !== null) {
    const openParen = m.index + m[0].length - 1 // 指向 `it(` 的左括号
    const closeParen = matchParen(src, openParen)
    if (closeParen < 0) continue
    const call = src.slice(openParen + 1, closeParen) // it 的**参数内容**（含超时）
    // 标题 = 第一个字符串字面量
    const t = call.match(/^\s*(['"`])([\s\S]*?)\1/)
    const title = t ? t[2] : '(无标题)'
    // 超时参数在 it 参数内容的**末尾**：`..., <数字>`（收尾由 closeParen 提供）。
    // 关键：`matchParen` 已经从 `it(` 配对到整个调用的右括号，
    // 所以超时数字就落在 `call` 的**尾部**，不是 closeParen 之后。
    const hasTimeout = /,\s*\d+\s*$/.test(call)
    blocks.push({ title, body: call, hasTimeout })
  }
  return blocks
}

/** 从左括号位置出发，返回配对右括号的偏移；跳过字符串/模板/注释。找不到返回 -1。 */
function matchParen(src: string, openIdx: number): number {
  let depth = 0
  let i = openIdx
  while (i < src.length) {
    const ch = src[i]
    // 字符串字面量 / 模板：整体跳过
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(src, i)
      continue
    }
    // 行注释
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      i = nl < 0 ? src.length : nl
      continue
    }
    // 块注释
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

/** 跳过从 i 开始的字符串/模板字面量，返回结束引号之后的位置。支持 `\` 转义。 */
function skipString(src: string, i: number): number {
  const quote = src[i]
  i++
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue }
    if (src[i] === quote) return i + 1
    i++
  }
  return src.length
}

/**
 * 剥离注释与**字符串字面量**。
 *
 * 为什么要剥字符串：真实代码里 `spawn(process.execPath, ...)` 的 `spawn`
 * 关键字在字符串**外**，剥离不影响判定；而**本守卫自己的自检用例**把
 * 被测源码写成**模板字符串**（`` it('x', () => { await run(d) }) ``），
 * 里面的 `spawn(` / `run(` 是**数据不是代码** —— 不剥就会把守卫自己
 * 扫成违规（自指假阳性，本轮实测过）。
 */
function stripCodeNoise(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i = skipString(src, i)
      // 用一个占位符替代，避免前后 token 粘连
      out += '""'
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
    out += ch
    i++
  }
  return out
}

/** 该 it 块是否真起进程。 */
function spawnsProcess(body: string): boolean {
  const code = stripCodeNoise(body)
  return SPAWNS.some((re) => re.test(code))
}

/** it 调用之后是否跟了显式超时（`, <数字>`，判定见 extractItBlocks）。 */
function findViolations(src: string): { title: string }[] {
  return extractItBlocks(src)
    .filter((b) => spawnsProcess(b.body) && !b.hasTimeout)
    .map((b) => ({ title: b.title }))
}

// ---------------------------------------------------------------------------

describe('元守卫：真起子进程的用例必须带显式超时', () => {
  const SELF = path.join(REPO, 'tests', 'tools', 'timeout-discipline.test.ts')
  // ⚠️ 排除自身：本文件用**合成夹具**测试守卫的判别力，夹具把被测源码写成
  //    模板字符串（含 `await run(` 等形状）→ 若扫自己会把夹具误判成违规
  //    （自指假阳性）。守卫自己的代码不产生"真起进程的用例"，排除是正确语义。
  const files = collectTestFiles(path.join(REPO, 'tests')).filter((f) => f !== SELF)

  it('至少扫到一批测试文件（否则守卫形同虚设）', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('全仓所有「真起进程」用例都有显式超时（默认 5s 在 2 核 CI 上不够）', () => {
    const offenders: string[] = []
    for (const f of files) {
      const rel = path.relative(REPO, f).replace(/\\/g, '/')
      for (const v of findViolations(fs.readFileSync(f, 'utf8'))) {
        offenders.push(`${rel} :: ${v.title}`)
      }
    }
    expect(
      offenders,
      `以下用例真起子进程却没有显式超时（默认 5s；CI 只有 2 核，满载时会假红）：\n` +
        offenders.map((o) => '  - ' + o).join('\n') +
        `\n修法：把 it(..., async () => { ... }) 的收尾写成 }, 30000)。`,
    ).toEqual([])
  })

  // 负向对照：没有它，上面那条可能因为「什么都没解析到」而假绿
  describe('判别力自检（合成夹具）', () => {
    it('起进程 + 无超时 → 必须报出来', () => {
      const fake = `
        it('起进程的用例', async () => {
          const r = await run(dir)
          expect(r.code).toBe(0)
        })
      `
      const v = findViolations(fake)
      expect(v.map((x) => x.title)).toEqual(['起进程的用例'])
    })

    it('起进程 + 有超时（}, 30000)）→ 不报', () => {
      const fake = `
        it('起进程但给了超时', async () => {
          const child = spawn(process.execPath, ['x'])
          expect(child).toBeTruthy()
        }, 30000)
      `
      expect(findViolations(fake)).toEqual([])
    })

    it('不起进程 + 无超时 → 不报（静态断言用例不该被误伤）', () => {
      const fake = `
        it('纯静态断言', () => {
          expect(read(MAIN)).toContain('foo')
        })
      `
      expect(findViolations(fake)).toEqual([])
    })

    it('注释里出现 spawn( 不算（不得造成假阳性）', () => {
      const fake = `
        it('注释里提到 spawn 但没真用', () => {
          // 这里讨论 spawn(...) 的行为
          const src = read(MAIN)
          expect(src).toContain('x')
        })
      `
      expect(findViolations(fake)).toEqual([])
    })

    it('本地包装 await runWithEnv( 也算起进程', () => {
      const fake = `
        it('用本地包装起进程', async () => {
          const r = await runWithEnv(dir, { A: '1' })
        })
      `
      expect(findViolations(fake).map((x) => x.title)).toEqual(['用本地包装起进程'])
    })

    it('字符串字面量里的括号不破坏块边界解析', () => {
      const fake = `
        it('标题里有)括号', async () => {
          const child = spawn(process.execPath, ['--x=(y)'])
        }, 30000)
      `
      // 关键：解析器要能正确切开块，且识别出已有超时 → 不报
      expect(findViolations(fake)).toEqual([])
    })
  })
})
