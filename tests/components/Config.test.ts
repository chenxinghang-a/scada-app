import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { saveStateOf, levelTag, parseAreas, exportFileName } from '@/utils/config'

/**
 * Config 组件层接线守卫。
 *
 * 职责与 `tests/components/Dashboard.test.ts`（round 176）/
 * `tests/components/Industry40.test.ts`（round 177）同款：
 * 纯逻辑测试在 `tests/utils/config.test.ts`（44 例，测**真实现**）。
 * 本文件防的是**最隐蔽的一类假绿**：有人把逻辑重新内联回 `Config.vue`，
 * 而 `tests/utils/config.test.ts` 还在那边全绿 —— 它测的函数已经没有调用方了。
 *
 * 本文件做三件事：
 *   ① 断言组件**不得重新内联**被抽走的实现（15 条「不得出现」）；
 *   ② 断言 wrapper 保持**接线形态**（一行转发，不是把算法改个名字放回来）；
 *   ③ 两条元守卫：防假绿（塞回去必须被抓住）/ 防假红（注释里提到旧写法不算违规）。
 */

const REPO = process.cwd()
const CONFIG_VUE = path.join(REPO, 'src', 'views', 'Config.vue')

/**
 * 去掉注释后再做「不得出现」断言 —— 组件里留了多处以
 * 「已移至 @/utils/config」的说明注释，其中恰好会引用旧实现的样子。
 * 不去注释的话守卫会被自己的说明文字假红 —— 而假红的守卫早晚被人关掉。
 */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')      // HTML 注释
    .replace(/\/\*[\s\S]*?\*\//g, '')     // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // 行注释（避开 https:// 这类）
}

const RAW = fs.readFileSync(CONFIG_VUE, 'utf8')
const CODE = stripComments(RAW)

describe('Config', () => {
  describe('真实实现可用（组件 import 的就是它）', () => {
    it('抽样：保存状态 / 等级映射 / 区域解析 / 导出文件名走真实现', () => {
      expect(saveStateOf({ k: '{"a":1}' }, 'k', { a: 1 })).toBe('saved')
      expect(levelTag('critical')).toBe('tag--danger')
      expect(parseAreas('a,, b ,')).toEqual(['a', 'b'])
      expect(exportFileName(new Date('2026-10-08T10:00:00Z'))).toBe('smartscada-config-2026-10-08.json')
    })
  })

  describe('接线守卫 —— 逻辑必须留在纯函数层', () => {
    it('Config.vue 确实导入了 @/utils/config', () => {
      expect(CODE).toContain("from '@/utils/config'")
    })

    it('wrapper 保持接线形态：saveStateOf 只做 baseline 注入转发', () => {
      // 固定「接线方式」：一行转发到纯函数层，组件侧不持有算法
      expect(CODE).toMatch(/saveStateOfPure\(baseline\.value,\s*key,\s*snapshot\)/)
      expect(CODE).toMatch(/withBaselineEntry\(baseline\.value,\s*key,\s*snapshot\)/)
    })

    it.each([
      ['等级映射表', /const\s+LEVEL_MAP\s*[:=]/],
      ['等级 tag 兜底', /LEVEL_MAP\[level\]\?\.tag/],
      ['等级 label 回落', /LEVEL_MAP\[level\]\?\.label/],
      ['baseline 快照写入', /\[key\]:\s*JSON\.stringify\(snapshot\)/],
      ['保存状态对比', /===\s*JSON\.stringify\(snapshot\)/],
      ['保存状态文案', /'有未保存修改'/],
      ['段名分支', /case 'system': return config\./],
      ['payload 组装（collection）', /default_interval: config\.collection\.interval/],
      ['payload 组装（retry 合并）', /max_attempts: config\.collection\.retries/],
      ['键回填循环', /Object\.keys\(target\)/],
      ['导入键复制', /hasOwnProperty\.call\(src,\s*key\)/],
      ['区域解析', /split\(','\)\.map/],
      ['导出文件名拼装', /toISOString\(\)\.slice\(0,\s*10\)/],
      ['段匹配过滤', /typeof v === 'object' && v !== null/],
      ['表格行构造', /info\.archive_records/],
    ])('不得把「%s」重新内联进组件', (_label, pattern) => {
      // 这些逻辑一旦被抄回组件，tests/utils/config.test.ts 就变成
      // 「测一个组件已经不用的函数」—— 测试还在、还在绿，但毫无意义。
      expect(CODE).not.toMatch(pattern)
    })

    it('守卫本身有效：把旧实现塞回去必须被抓住（防假绿）', () => {
      const poisoned = `${CODE}\nconst LEVEL_MAP: Record<string, { label: string; tag: string }> = {}\n`
      expect(stripComments(poisoned)).toMatch(/const\s+LEVEL_MAP\s*[:=]/)
      expect(CODE).not.toMatch(/const\s+LEVEL_MAP\s*[:=]/)
    })

    it('守卫不会被自己的注释假红：注释里提到旧写法不算违规（防假红）', () => {
      const withComment = `${CODE}\n// 原来这里是 const LEVEL_MAP: Record<string, { label: string }> = {}\n`
      expect(stripComments(withComment)).not.toMatch(/const\s+LEVEL_MAP\s*[:=]/)
    })
  })
})
