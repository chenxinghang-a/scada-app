import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { healthVar, toList, edgeLevelTagClass } from '@/utils/industry40'

/**
 * Industry40 组件层接线守卫。
 *
 * 职责与 `tests/components/Dashboard.test.ts` 同款（round 176 建立）：
 * 纯逻辑测试在 `tests/utils/industry40.test.ts`（42 例，测**真实现**）。
 * 本文件防的是**最隐蔽的一类假绿**：有人把逻辑重新内联回 `Industry40.vue`，
 * 而 `tests/utils/industry40.test.ts` 还在那边全绿 —— 它测的函数已经
 * 没有任何调用方了，测试还在、还在绿，但零意义。
 *
 * 所以这里做两件事：
 *   ① 断言组件**不得重新内联**被抽走的实现（13 条「不得出现」）；
 *   ② 两条元守卫：防假绿（塞回去必须被抓住）/ 防假红（注释里提到旧写法不算违规）。
 *
 * 不挂载组件：1873 行的 SFC 里真正有价值的是数据契约与分档规则，
 * 前者已由 tests/api/*、tests/router/* 用真实模块覆盖，
 * 后者已抽到 utils 层直接测试。
 */

const REPO = process.cwd()
const INDUSTRY40_VUE = path.join(REPO, 'src', 'views', 'Industry40.vue')

/**
 * 去掉注释后再做「不得出现」断言。
 *
 * 为什么必须去注释：组件里留了多处「（XXX 已移至 @/utils/industry40）」的说明注释，
 * 里面恰好会引用旧实现的样子。不去注释的话守卫会被自己的说明文字假红 ——
 * 而**假红的守卫早晚被人关掉**。
 */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')      // HTML 注释
    .replace(/\/\*[\s\S]*?\*\//g, '')     // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // 行注释（避开 https:// 这类）
}

const RAW = fs.readFileSync(INDUSTRY40_VUE, 'utf8')
const CODE = stripComments(RAW)

describe('Industry40', () => {
  describe('真实实现可用（组件 import 的就是它）', () => {
    it('抽样：分档 / 归一化 / 联锁分色走真实现', () => {
      expect(healthVar(90)).toBe('var(--color-success)')
      expect(toList<{ v: number }>({ d1: { v: 1 } })).toEqual([{ device_id: 'd1', v: 1 }])
      expect(edgeLevelTagClass('interlock')).toBe('tag--danger')
    })
  })

  describe('接线守卫 —— 逻辑必须留在纯函数层', () => {
    it('Industry40.vue 确实导入了 @/utils/industry40', () => {
      expect(CODE).toContain("from '@/utils/industry40'")
    })

    it('bandColorOf 走 bandTokenOf 组合，不把取 token 逻辑内联回来', () => {
      // 依赖 DOM 的 token() 留在组件是有意为之；但它的**纯部分**必须是 utils 的 bandTokenOf
      expect(CODE).toMatch(/token\(bandTokenOf\(bands, v\)\)/)
    })

    it.each([
      ['Band 分档核心（findIndex 半开区间）', /bands\.findIndex\(\s*b\s*=>\s*n\s*>=/],
      ['Band 常量表（HEALTH/OEE/CAP）', /const\s+(?:HEALTH|OEE|CAP)_BANDS\s*[:=\[]/],
      ['ZONE 分区常量', /const\s+ZONE_[A-D]\s*:/],
      ['bandVarOf 拼接', /'var\('\s*\+\s*bands\[/],
      ['bandTagClass 映射分支', /t\s*===\s*'--color-success'\s*\|\|\s*t\s*===/],
      ['asNum 收敛实现', /typeof\s+n\s*===\s*'number'\s*&&\s*Number\.isFinite\(n\)\s*\?\s*n\s*:\s*undefined/],
      ['asStr 收敛实现', /typeof\s+v\s*===\s*'string'\s*&&\s*v\s*\?\s*v\s*:\s*fallback/],
      ['toList 字典展开', /Object\.entries\(v as Record<string, T>/],
      ['fmtTime 实现（toLocaleTimeString）', /toLocaleTimeString\('zh-CN'/],
      ['isoGradeType 映射表', /\{\s*A:\s*'success',\s*B:\s*'success'/],
      ['trendArrow 映射', /t\s*===\s*'rising'\s*\?\s*'↑'/],
      ['edgeLevel* 联锁分色三元', /'level-bar--critical'\s*:\s*'level-bar--info'/],
      ['levelBarClass 模板插值', /level-bar--\$\{k\}/],
    ])('不得把「%s」重新内联进组件', (_label, pattern) => {
      // 这些逻辑一旦被抄回组件，tests/utils/industry40.test.ts 就变成
      // 「测一个组件已经不用的函数」—— 测试还在、还在绿，但毫无意义。
      expect(CODE).not.toMatch(pattern)
    })

    it('守卫本身有效：把旧实现塞回去必须被抓住（防假绿）', () => {
      // 元守卫：证明上面那组断言真的在扫代码，而不是因为 stripComments 把一切都删空了
      const poisoned = `${CODE}\nconst HEALTH_BANDS: Band[] = []\n`
      expect(stripComments(poisoned)).toMatch(/const\s+(?:HEALTH|OEE|CAP)_BANDS\s*[:=\[]/)
      expect(CODE).not.toMatch(/const\s+(?:HEALTH|OEE|CAP)_BANDS\s*[:=\[]/)
    })

    it('守卫不会被自己的注释假红：注释里提到旧写法不算违规（防假红）', () => {
      const withComment = `${CODE}\n// 原来这里是 const HEALTH_BANDS: Band[] = [...]\n`
      expect(stripComments(withComment)).not.toMatch(/const\s+(?:HEALTH|OEE|CAP)_BANDS\s*[:=\[]/)
    })
  })
})
