/**
 * 工具层**接线状态**守卫：`src/utils|composables|stores` 的每个导出符号，
 * 必须「被某个文件 import 过」**或**「在 UNWIRED 表里带理由声明」。
 *
 * 为什么需要它（接线状态透镜的第 6 次应用）
 * ----------------------------------------
 * 192 `electronAPI`（IPC）→ 193 后端端点 → 196 `src/api/*.ts`（HTTP 包装层）
 * → 197 Vue 组件 → 198 i18n → **200 utils / composables / stores**。
 *
 * 失败方式每次都一样：**代码写好了、类型全对、构建全绿，只是没人用** ——
 * 于是那部分能力静默地不存在。
 *
 * 实测（2026-10-09，round 200）：**104 个导出里有 20 个从未被任何文件 import**，
 * 其中两个是**整模块**：
 *   * `src/utils/chartSampling.ts`（181 行）—— 5 个导出全部无人 import，
 *     整个图表降采样工具模块是死的；
 *   * `src/stores/theme.ts`（34 行）—— `useThemeStore` 无人 import，主题 store 是死的。
 *
 * 口径（这一条踩过坑，写清楚）
 * --------------------------
 * **按 import 判定，不按「标识符在别处出现过」判定。**
 * 后者有两个方向的错：
 *   * **假阳性**：把整个目录从消费侧排除掉，会漏掉「目录内部互相 import」
 *     （第一版就这么错的，`logLoadError` 被误报）；
 *   * **假阴性**：`createValidator` 这类名字在别处被用作无关用途时，
 *     会被当成「已使用」（第一版也这么错的）。
 * 所以现在解析 `import … from '…'` 语句，把模块路径归一后取**导入的符号名**；
 * `import * as ns` / 默认导入 / 副作用 import 视为「整模块被引用」。
 *
 * 本守卫**不**回答「该不该保留」—— 删或启用是产品口径（见决策简报 D19）。
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const REPO = process.cwd()
const SRC = path.join(REPO, 'src')
const TRACKED_DIRS = ['src/utils', 'src/composables', 'src/stores']

/**
 * 已确认**当前未被任何文件 import** 的导出符号，及理由。
 * 进这张表 = 「已知且已判断过」，**不是**「允许随便加」。
 */
const UNWIRED: Record<string, { reason: string; symbols: string[] }> = {
  // ── 整模块死 ──────────────────────────────────────────────
  'src/utils/chartSampling.ts': {
    reason:
      '【整模块】图表降采样工具（LTTB / 均匀 / 自适应 / 时间序列 / 滑动窗口），' +
      '5 个导出**全部无人 import** —— 整个模块（181 行）是死的。见 D19。',
    symbols: [
      'lttbDownsample', 'uniformDownsample', 'adaptiveDownsample',
      'timeSeriesDownsample', 'slidingWindowSample',
    ],
  },
  'src/stores/theme.ts': {
    reason:
      '【整模块】主题 store（useThemeStore）无人 import，34 行是死的。' +
      '⚠️ 注意 `utils/echartsTheme.ts` 那套 SCADA 主题**是活的**' +
      '（Dashboard / History / Industry40 在用）—— 死的是这个 store，不是主题本身。见 D19。',
    symbols: ['useThemeStore'],
  },

  // ── 单函数死：格式化工具（**这一组值得单独看**）────────────────
  'src/utils/format.ts': {
    reason:
      '⚠️ 这几个函数**带边界处理**（`Number.isFinite` 守卫 → 返回 "-"；负数 uptime → "0分"），' +
      '而视图里散着 **56 处内联 `.toFixed()`**（Industry40 一个视图就 37 处）**没有这层守卫** ——' +
      '属「口径分裂」：同一件事两套实现，且被弃用的这套反而是更稳的那套。见 D19。',
    symbols: ['formatUptime', 'formatNumber', 'formatPercent', 'getDeviceDisplayName'],
  },
  'src/utils/export.ts': {
    reason:
      '⚠️ 同模块的 `assertBinaryDownload` / `downloadBlob` / `describeDownloadError` **是活的**' +
      '（round 193 已核实 3 个下载点都在用）—— 死的是 CSV / JSON 那两个变体。',
    symbols: ['escCSV', 'downloadCSV', 'downloadJSON', 'BlobContentError'],
  },
  'src/utils/dashboard.ts': {
    reason: '同模块其余导出（levelKey / filterDevices / 分档系统等）是活的；这两个是死的。',
    symbols: ['buildThresholdMarkLine', 'escapeCsvField'],
  },
  'src/utils/config.ts': {
    reason:
      'LEVEL_MAP（报警等级 → 展示文案的映射表）无人 import。' +
      '⚠️ 这与 `levelKey` 那套是**两件事**：levelKey 做归一化，LEVEL_MAP 做展示文案；' +
      '视图里的等级文案目前是各写各的。',
    symbols: ['LEVEL_MAP'],
  },
  'src/utils/echartsTheme.ts': {
    reason:
      '这三个常量无人直接 import，但**模块是活的** —— Dashboard / History / Industry40 导入的是' +
      'registerScadaTheme / scadaThemeName / applyScadaTheme / SCADA_LEVEL_COLORS。' +
      '属「导出出去但没人直接引用」。',
    symbols: ['SCADA_CHART_COLORS', 'LIGHT_THEME', 'DARK_THEME'],
  },
}

/** 取模块的导出符号名。 */
function exportsOf(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8')
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/.exec(line)
    if (m) out.push(m[1])
  }
  return out
}

/** 把 import 的模块路径归一成 `src/...`（无扩展名）；解析不了返回 null。 */
function resolveModule(spec: string, fromFile: string): string | null {
  if (spec.startsWith('@/')) return `src/${spec.slice(2)}`
  if (spec.startsWith('.')) {
    const abs = path.resolve(path.dirname(fromFile), spec)
    const rel = path.relative(REPO, abs).replace(/\\/g, '/')
    return rel.startsWith('src/') ? rel : null
  }
  return null
}

/** 扫全 src，返回 `模块路径 -> 被导入的符号集合`（含 '*' 表示整模块）。 */
function importedSymbols(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  const add = (mod: string, sym: string) => {
    if (!map.has(mod)) map.set(mod, new Set())
    map.get(mod)!.add(sym)
  }
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (!/\.(ts|vue)$/.test(e.name)) continue
      const text = fs.readFileSync(full, 'utf8')
      const re = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g
      for (const m of text.matchAll(re)) {
        const mod = resolveModule(m[2], full)
        if (!mod) continue
        const clause = m[1].trim()
        if (clause === '') { add(mod, '*'); continue }        // 副作用 import
        for (const name of clause.match(/[A-Za-z_$][\w$]*/g) ?? []) {
          if (name === 'type' || name === 'as') continue
          add(mod, name)
        }
        if (clause.startsWith('*') || /^[A-Za-z_$][\w$]*$/.test(clause)) add(mod, '*')
      }
    }
  }
  walk(SRC)
  return map
}

const imported = importedSymbols()

/** 实际未被 import 的导出符号 → 出处列表。 */
function unwiredExports(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const d of TRACKED_DIRS) {
    const root = path.join(REPO, d)
    if (!fs.existsSync(root)) continue
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) { walk(full); continue }
        if (!e.name.endsWith('.ts')) continue
        const rel = path.relative(REPO, full).replace(/\\/g, '/')
        const names = exportsOf(full)
        if (names.length === 0) continue
        const got = new Set([
          ...(imported.get(rel) ?? []),
          ...(imported.get(rel.replace(/\.ts$/, '')) ?? []),
        ])
        if (got.has('*')) continue                     // 整模块被引用
        const missing = names.filter((n) => !got.has(n))
        if (missing.length) out.set(rel, missing)
      }
    }
    walk(root)
  }
  return out
}

const unwired = unwiredExports()

describe('工具层导出符号的接线状态（utils / composables / stores）', () => {
  it('扫描口径有效：确实扫到了导出符号与 import 语句', () => {
    const total = TRACKED_DIRS.reduce((acc, d) => {
      const root = path.join(REPO, d)
      if (!fs.existsSync(root)) return acc
      let n = 0
      const walk = (dir: string) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name)
          if (e.isDirectory()) walk(full)
          else if (e.name.endsWith('.ts')) n += exportsOf(full).length
        }
      }
      walk(root)
      return acc + n
    }, 0)
    expect(total, '一个导出符号都没扫到 —— 口径可能坏了').toBeGreaterThan(50)
    expect(imported.size, '解析到的模块太少 —— 口径可能坏了').toBeGreaterThanOrEqual(10)
  })

  it('每个未被 import 的导出符号，都必须在 UNWIRED 表里**逐个列名**声明', () => {
    // ⚠️ 这条判据第一版只查「文件在不在表里」—— 于是
    //    「已声明文件里**新增**一个死导出」会静默溜过（M1 变异没被抓住）。
    //    现在按**符号**核对：多一个没登记的符号就红。
    const undeclared: string[] = []
    for (const [file, names] of unwired) {
      const declared = new Set(UNWIRED[file]?.symbols ?? [])
      for (const n of names) {
        if (!declared.has(n)) undeclared.push(`  ${file}  →  ${n}`)
      }
    }
    expect(
      undeclared,
      '以下导出符号**未被任何文件 import 且未在 UNWIRED 表里登记** ——\n' +
        '要么用起来，要么删掉，要么补进表并写清为什么保留：\n' + undeclared.join('\n'),
    ).toEqual([])
  })

  it('UNWIRED 表里的每个符号都必须**仍然**未被 import（否则表会腐烂）', () => {
    // 同样按符号核对：某个符号被接上线了，就要从表里删掉它（M2 变异）。
    const stale: string[] = []
    for (const [file, entry] of Object.entries(UNWIRED)) {
      if (!fs.existsSync(path.join(REPO, file))) {
        stale.push(`  ${file}（文件已不存在）`)
        continue
      }
      const still = new Set(unwired.get(file) ?? [])
      for (const n of entry.symbols) {
        if (!still.has(n)) stale.push(`  ${file}  →  ${n}（已被接线或已不存在）`)
      }
    }
    expect(stale, '以下条目已不成立，请从 UNWIRED 表删掉：\n' + stale.join('\n')).toEqual([])
  })

  it('每条声明都必须写明理由', () => {
    const thin = Object.entries(UNWIRED)
      .filter(([, e]) => !e.reason || e.reason.trim().length < 30)
      .map(([f]) => f)
    expect(thin, `以下条目没写清理由：${thin.join(', ')}`).toEqual([])
  })

  it('正向对照：已知被 import 的 format.ts 里的 `formatDate` 类符号必须被判为「已接线」', () => {
    // 用一个确定在用的符号做对照：`src/utils/export.ts` 的 assertBinaryDownload
    const rel = 'src/utils/export.ts'
    // ⚠️ 映射表的 key **不带扩展名**（`src/utils/export`）—— 第一版按 `…export.ts` 取，
    //    取不到 → 假红。这里两个都试。
    const got = new Set([
      ...(imported.get(rel) ?? []),
      ...(imported.get(rel.replace(/\.ts$/, '')) ?? []),
    ])
    expect(got.has('assertBinaryDownload'), '对照失败：assertBinaryDownload 应被判为已接线').toBe(true)
    // 而它确实不在未接线名单里
    expect((unwired.get(rel) ?? []).includes('assertBinaryDownload')).toBe(false)
  })
})
