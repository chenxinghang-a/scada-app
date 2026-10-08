/**
 * 语言包**键齐全**守卫（zh-CN ⇄ en-US 双向对齐）。
 *
 * 为什么需要它
 * ------------
 * `src/locales/index.ts` 的文件头「完整启用的前置条件」里，**第 4 条**写着：
 *
 *   > 4. 增加一条「语言包键是否齐全」的单测，避免中英键漂移。
 *
 * —— **而这条单测一直不存在**（2026-10-09 round 198 补上）。
 * 现状实测：zh-CN / en-US 各 **142** 个键、完全对称；但**代码里只用到了 7 个**
 * （界面文案 95% 是硬编码中文）。也就是说 i18n 属于「装了但没接线」，
 * 而**只要没人盯着，两侧键就会漂** —— 漂了以后即使将来启用 i18n，
 * 英文界面也会显示原始键名或静默回退到中文。
 *
 * 本守卫**不做**的事（有意为之）
 * ----------------------------
 * * 不要求「所有界面都改用 t()」—— 那是产品口径（见 locales/index.ts 的说明：
 *   只改一半会出现「登录页英文、主界面中文」的半截状态，比现状更差）；
 * * 不要求「删掉未使用的键」—— 语言包是为将来启用准备的，删了等于毁掉前置条件。
 *
 * 只盯**机械可查**的两件事：
 *   1. 两侧**键集合完全相同**（双向：缺的、多的都要报）；
 *   2. 代码里 `t('...')` 用到的键**必须在两侧都存在**。
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import zhCN from '../../src/locales/zh-CN'
import enUS from '../../src/locales/en-US'

const REPO = process.cwd()
const SRC = path.join(REPO, 'src')

/** 把嵌套语言包压成点号路径集合（叶子节点）。 */
function flatten(obj: unknown, prefix = ''): Map<string, unknown> {
  const out = new Map<string, unknown>()
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      for (const [kk, vv] of flatten(v, `${prefix}${k}.`)) out.set(kk, vv)
    }
  } else {
    out.set(prefix.replace(/\.$/, ''), obj)
  }
  return out
}

const zh = flatten(zhCN)
const en = flatten(enUS)

/** 扫源码里 `t('...')` 的字面量键（剥掉注释）。 */
function usedKeys(): Set<string> {
  const out = new Set<string>()
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { walk(full); continue }
      if (!/\.(ts|vue)$/.test(e.name)) continue
      if (full.includes(`${path.sep}locales${path.sep}`)) continue
      const text = fs
        .readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
      for (const m of text.matchAll(/\bt\(\s*['"]([A-Za-z][\w.]*)['"]/g)) {
        out.add(m[1])
      }
    }
  }
  walk(SRC)
  return out
}

describe('语言包键齐全（zh-CN ⇄ en-US）', () => {
  it('两侧键数量都够多（否则守卫会退化成空断言）', () => {
    expect(zh.size).toBeGreaterThan(100)
    expect(en.size).toBeGreaterThan(100)
  })

  it('两侧键集合**完全相同**（双向）', () => {
    const onlyZh = [...zh.keys()].filter((k) => !en.has(k)).sort()
    const onlyEn = [...en.keys()].filter((k) => !zh.has(k)).sort()

    expect(
      onlyZh,
      '以下键只有 zh-CN 有、en-US 缺 —— 英文界面会显示原始键名或回退到中文：\n  ' +
        onlyZh.join('\n  '),
    ).toEqual([])
    expect(
      onlyEn,
      '以下键只有 en-US 有、zh-CN 缺：\n  ' + onlyEn.join('\n  '),
    ).toEqual([])
  })

  it('没有空值（空字符串会让界面出现空白文案）', () => {
    const empty: string[] = []
    for (const [m, tag] of [[zh, 'zh-CN'], [en, 'en-US']] as const) {
      for (const [k, v] of m) {
        if (typeof v === 'string' && v.trim() === '') empty.push(`${tag}: ${k}`)
      }
    }
    expect(empty, `以下键是空字符串：\n  ${empty.join('\n  ')}`).toEqual([])
  })

  it('两侧的插值占位符一致（{count} 之类）', () => {
    const ph = (s: unknown) =>
      [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
    const bad: string[] = []
    for (const k of zh.keys()) {
      if (!en.has(k)) continue
      if (ph(zh.get(k)) !== ph(en.get(k))) {
        bad.push(`${k}: zh={${ph(zh.get(k))}} en={${ph(en.get(k))}}`)
      }
    }
    expect(bad, `以下键的插值占位符两侧不一致：\n  ${bad.join('\n  ')}`).toEqual([])
  })

  it('代码里 t() 用到的键，两侧都必须存在', () => {
    const used = usedKeys()
    expect(used.size, '一个 t() 都没扫到 —— 扫描口径可能坏了').toBeGreaterThan(0)

    const missZh = [...used].filter((k) => !zh.has(k)).sort()
    const missEn = [...used].filter((k) => !en.has(k)).sort()
    expect(missZh, `zh-CN 缺这些被代码引用的键：\n  ${missZh.join('\n  ')}`).toEqual([])
    expect(missEn, `en-US 缺这些被代码引用的键：\n  ${missEn.join('\n  ')}`).toEqual([])
  })
})
