/**
 * 跨文件**同名不同义**副本的守卫：把「口径地图」从注释里的散文变成机器可查的表。
 *
 * 为什么需要它
 * ------------
 * `src/utils/industry40.ts` 的文件头有一段很有价值的「⚠️ 跨文件同名」说明，
 * 逐条列出了 `fmtTime` / `levelBarClass` / `levelKey` / `OEE_TARGET` 在多个文件里
 * **各有一份、语义不同**，并明确写着「**谁想统一口径先定标准，别直接合并**」。
 *
 * 但那张地图是**注释里的散文** —— **没有任何东西在核对它**。于是：
 *
 *   实测（2026-10-09，round 199）：地图说 `levelBarClass` 在 Alarms / Screen
 *   各有一份（加本模块共 3 处），**而 `Dashboard.vue:895` 还有第 4 份**，
 *   实现与 Alarms/Screen **逐字相同**（`level-bar--${levelKey(level)}`）——
 *   **地图漏记了它**。地图的整个用途就是「合并前先看这里」，
 *   一份漏项的地图会把人**引向错误的结论**（以为只有两处）。
 *
 *   同时注释里写的行号也已经漂了（写 `Dashboard.vue:346`，实际在 349）——
 *   所以本守卫**只认「文件 + 名称」，不认行号**。
 *
 * 这与 round 197（注释声称的接线其实不存在）、round 198（文档里写了要做却没人做）
 * 是同一类问题：**散文形式的承诺会腐烂，只有机械可查的断言不会。**
 *
 * 口径
 * ----
 * * 「定义点」= `src/**` 里形如 `function X` / `const X =` / `export function X` 的模块级或组件内定义；
 * * 表里声明的**文件集合**必须与实际**完全一致**（双向）：
 *     新增副本 → 红（逼你决定：是合并、还是补进地图并写明语义差异）
 *     表里列了但已不存在 → 红（防地图腐烂）
 * * 本守卫**不**要求合并它们 —— 合并是产品口径（地图已说明「别直接合并」）。
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const REPO = process.cwd()
const SRC = path.join(REPO, 'src')

/** 被追踪的跨文件同名标识符 → 已确认的副本位置与语义差异说明。 */
const DOCUMENTED_DUPLICATES: Record<string, { reason: string; sites: string[] }> = {
  fmtTime: {
    reason:
      '跨 4 处同名，**语义互不相同**：非法时间戳兜底分别是「原样返回输入」' +
      '（utils/industry40）/ 「-」（Alarms、AlarmOutput）/ 「不判」（Screen）；' +
      '输出格式也分两种（utils/industry40 与 Screen 是 HH:MM:SS，Alarms / AlarmOutput 是 toLocaleString 全格式）。' +
      '**别直接合并** —— 合并会静默改掉 UI 行为。',
    sites: [
      'src/utils/industry40.ts',
      'src/views/Alarms.vue',
      'src/views/Screen.vue',
      'src/views/AlarmOutput.vue',
    ],
  },
  levelBarClass: {
    reason:
      '跨 4 处同名，分两种口径：Alarms / Screen / **Dashboard**（本轮补记）都是' +
      '`level-bar--${levelKey(level)}` 转发；utils/industry40 那份是**内联三分支**' +
      '（不经过 levelKey）。注意 Dashboard 那份**原先没被地图记上**。',
    sites: [
      'src/utils/industry40.ts',
      'src/views/Alarms.vue',
      'src/views/Screen.vue',
      'src/views/Dashboard.vue',
    ],
  },
  levelKey: {
    reason:
      '跨 4 处同名，**兜底值有 3 套**（utils/dashboard 是归一化实现；AlarmOutput ' +
      '兜底 normal；Alarms 另一套；Screen 兜底 info）。见 utils/dashboard.ts 头注释。',
    sites: [
      'src/utils/dashboard.ts',
      'src/views/Alarms.vue',
      'src/views/Screen.vue',
      'src/views/AlarmOutput.vue',
    ],
  },
  OEE_TARGET: {
    reason:
      '两处各一份常量，值都是 85。**值一致属巧合** —— 改 OEE 标准要两处一起改。' +
      '（归并属独立决策，本守卫只保证「改一处就会被发现」。）',
    sites: ['src/utils/industry40.ts', 'src/views/Dashboard.vue'],
  },
}

/** 扫出 src/** 里各被追踪标识符的定义点（文件相对路径集合）。 */
function actualSites(names: string[]): Map<string, Set<string>> {
  const pat = new RegExp(
    `^\\s*(?:export\\s+)?(?:function\\s+|const\\s+|let\\s+|var\\s+)(${names.join('|')})\\b`,
  )
  const out = new Map<string, Set<string>>()
  for (const n of names) out.set(n, new Set())

  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (!/\.(ts|vue)$/.test(e.name)) continue
      const rel = path.relative(REPO, full).replace(/\\/g, '/')
      for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
        const m = pat.exec(line)
        if (m) out.get(m[1])!.add(rel)
      }
    }
  }
  walk(SRC)
  return out
}

const NAMES = Object.keys(DOCUMENTED_DUPLICATES)
const actual = actualSites(NAMES)

describe('跨文件同名副本的「口径地图」必须与实际一致', () => {
  it('扫描口径有效：每个被追踪的名字都至少扫到一处', () => {
    for (const n of NAMES) {
      expect(actual.get(n)!.size, `一个 ${n} 定义点都没扫到 —— 扫描口径可能坏了`).toBeGreaterThan(0)
    }
  })

  it('没有**地图未记录**的新副本（新增同名定义必须显式登记）', () => {
    const problems: string[] = []
    for (const n of NAMES) {
      const declared = new Set(DOCUMENTED_DUPLICATES[n].sites)
      for (const f of actual.get(n)!) {
        if (!declared.has(f)) problems.push(`  ${n}  →  ${f}（地图里没有）`)
      }
    }
    expect(
      problems,
      '以下位置出现了**跨文件同名定义但地图未记录** —— 要么合并掉，' +
        '要么补进 DOCUMENTED_DUPLICATES 并写清语义差异：\n' + problems.join('\n'),
    ).toEqual([])
  })

  it('地图里没有**已不存在**的条目（防地图腐烂）', () => {
    const stale: string[] = []
    for (const n of NAMES) {
      const found = actual.get(n)!
      for (const f of DOCUMENTED_DUPLICATES[n].sites) {
        if (!found.has(f)) stale.push(`  ${n}  →  ${f}（实际已无定义）`)
      }
    }
    expect(stale, '以下条目在地图里但实际已不存在，请更新地图：\n' + stale.join('\n')).toEqual([])
  })

  it('每条都要写清**语义差异**（不能只写「有重复」）', () => {
    const thin = Object.entries(DOCUMENTED_DUPLICATES)
      .filter(([, v]) => !v.reason || v.reason.trim().length < 40)
      .map(([n]) => n)
    expect(thin, `以下条目的说明太短，没写清语义差异：${thin.join(', ')}`).toEqual([])
  })

  it('条目必须真的有多处（单处不该进这张表）', () => {
    const single = Object.entries(DOCUMENTED_DUPLICATES)
      .filter(([, v]) => v.sites.length < 2)
      .map(([n]) => n)
    expect(single, `以下条目只有一处，不属于「跨文件同名」：${single.join(', ')}`).toEqual([])
  })

  it('人读的那份地图（utils/industry40.ts 头注释）必须覆盖表里的每个名字', () => {
    // 为什么单列一条：这张表是**机器读的**，而 utils/industry40.ts 头注释里那张
    // 是**人读的**。两者各自漂移的话，人按注释去合并就会踩坑（本轮就是这么发现的：
    // 注释漏了 Dashboard 那份 levelBarClass，而表里补上了）。
    // 这里把「人读的」和「机器读的」绑在一起：表里有的名字，注释里必须也提到。
    const header = fs
      .readFileSync(path.join(SRC, 'utils', 'industry40.ts'), 'utf8')
      .split('*/')[0] // 只取文件头注释块
    const missing = NAMES.filter((n) => !header.includes(n))
    expect(
      missing,
      `utils/industry40.ts 头注释里没提到这些名字 —— 人读的地图与机器读的表已脱节：` +
        `${missing.join(', ')}`,
    ).toEqual([])
  })
})
