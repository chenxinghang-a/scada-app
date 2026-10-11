import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { matchParen, stripCommentsAndStrings, extractFunctionBody } from '../helpers/source-text'

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
  // ⚠️ `exec(` / `fork(` 必须排除"方法调用"形态：`re.exec(` 是 RegExp.prototype.exec，
  //    不是 child_process。实测：放宽成 `\bexec\s*\(` 会把 `inlineCommentStrip`（用 re.exec）
  //    误报成"起进程包装"。故要求前面不是 `.` 或标识符字符。
  /(?<![.\w$])exec\s*\(/,
  /(?<![.\w$])fork\s*\(/,
  /\bchild_process\b/,
  /\bawait\s+run\s*\(/,
  /\bawait\s+runWithEnv\s*\(/,
  /\bawait\s+runCmd\s*\(/,
  /\bawait\s+runPy\s*\(/,
  /\bawait\s+runRaw\s*\(/,
  /\bgit\s*\(/,
  /\binitRepo\s*\(/,
]

/**
 * **已登记**的"起进程包装函数"名字（与 SPAWNS 里的本地包装一一对应）。
 *
 * 为什么要有这个登记表 + 配套守卫（2026-10-12 加固）：
 *   SPAWNS 里的本地包装名是**硬编码**的。实测：在测试里加一个 `await runNode(REPO)`
 *   （无超时）后，守卫**8/8 全绿** —— 因为 `/\bawait\s+run\s*\(/` 不匹配 `runNode(`，
 *   调用处也没有 `spawn(`。**新包装 = 新盲区**（枚举式覆盖 ≠ 完备，同 Bug 14/16）。
 *
 * 但"自动把全仓所有含 spawn 的函数名都纳入信号"会**误伤**：
 *   像 `run` 这种通用名在很多无关位置出现，会造出一批假阳性（实测过）。
 *
 * 折中方案（本表 + "未登记则报红"守卫）：
 *   守卫**扫描**全仓找出所有"内部调用了 spawn 的函数名"，与登记表核对；
 *   有**未登记**的就报红，要求作者**手工登记**并决定该名字要不要进 SPAWNS。
 *   这样既不引入假阳性（识别走保守的 SPAWNS），又能**发现**新包装而不是漏掉。
 */
const REGISTERED_SPAWN_WRAPPERS = ['run', 'runWithEnv', 'runCmd', 'runPy', 'runRaw', 'git', 'initRepo']

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

/** 该 it 块是否真起进程。 */
function spawnsProcess(body: string): boolean {
  const code = stripCommentsAndStrings(body)
  return SPAWNS.some((re) => re.test(code))
}

/** it 调用之后是否跟了显式超时（`, <数字>`，判定见 extractItBlocks）。 */
function findViolations(src: string): { title: string }[] {
  return extractItBlocks(src)
    .filter((b) => spawnsProcess(b.body) && !b.hasTimeout)
    .map((b) => ({ title: b.title }))
}

// ---------------------------------------------------------------------------

/**
 * 扫描一批文件，找出所有"**内部真实调用了起进程 API** 的函数名"。
 *
 * 用途：发现**未登记**的包装（新写的 `runNode` / `spawnAndWait` 等），
 * 提醒作者登记（见 REGISTERED_SPAWN_WRAPPERS 的说明）。
 *
 * 实现要点：先用共享的 `extractFunctionBody`（花括号配平，跳过字符串/注释）
 * 精确抠出每个具名函数体，再在**函数体内部**找直接的起进程调用。
 * ⚠️ 必须用共享原语 —— 手写花括号扫描会把"函数体内嵌套的其它函数"算进来
 *    （实测：会误报 `norm` / `walk` / `git` 等）。这不是"实现风格"问题，
 *    而是**同一个花括号配平逻辑**必须只有一份。
 */
function discoverSpawnWrapperNames(files: string[], excludeSelf: string): Set<string> {
  const names = new Set<string>()
  const DIRECT = [
    /\bspawn\s*\(/,
    /\bspawnSync\s*\(/,
    /\bexecFile\s*\(/,
    /\bexecFileSync\s*\(/,
    /\bexecSync\s*\(/,
    /(?<![.\w$])exec\s*\(/,
    /(?<![.\w$])fork\s*\(/,
    /\bchild_process\b/,
  ]
  for (const f of files) {
    if (f === excludeSelf) continue
    const raw = fs.readFileSync(f, 'utf8')
    // 收集本文件里所有 `function X(` / `const X = (…) =>` 的名字
    const defRe =
      /(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\()/g
    const seen = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = defRe.exec(raw)) !== null) {
      const name = m[1] ?? m[2]
      if (!name || seen.has(name)) continue
      seen.add(name)
      const body = extractFunctionBody(raw, name)
      if (!body) continue
      const code = stripCommentsAndStrings(body)
      if (DIRECT.some((re) => re.test(code))) names.add(name)
    }
  }
  return names
}

describe('元守卫：真起子进程的用例必须带显式超时', () => {
  const SELF = path.join(REPO, 'tests', 'tools', 'timeout-discipline.test.ts')
  // ⚠️ 排除自身：本文件用**合成夹具**测试守卫的判别力，夹具把被测源码写成
  //    模板字符串（含 `await run(` 等形状）→ 若扫自己会把夹具误判成违规
  //    （自指假阳性）。守卫自己的代码不产生"真起进程的用例"，排除是正确语义。
  const files = collectTestFiles(path.join(REPO, 'tests')).filter((f) => f !== SELF)

  it('至少扫到一批测试文件（否则守卫形同虚设）', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('新出现的"起进程包装函数"必须登记进 REGISTERED_SPAWN_WRAPPERS（防新包装成为盲区）', () => {
    const found = discoverSpawnWrapperNames(files, SELF)
    const unregistered = [...found].filter((n) => !REGISTERED_SPAWN_WRAPPERS.includes(n))
    expect(
      unregistered,
      '以下函数**内部真调用了起进程 API，但没有登记**：\n' +
        unregistered.map((n) => `  ${n}`).join('\n') +
        '\n不登记 = SPAWNS 认不出它的调用 → 用它起的进程用例会被漏检（无超时也不报）。\n' +
        '修法二选一：(a) 把名字加进 REGISTERED_SPAWN_WRAPPERS 并在 SPAWNS 里补一条 ' +
        '`/\\bawait\\s+<name>\\s*\\(/`；(b) 若它只是内部工具、不会出现在 it 块里，' +
        '请加进 REGISTERED_SPAWN_WRAPPERS 的"已知但无需监护"白名单并注明原因。',
    ).toEqual([])
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
