/**
 * 组件接线状态守卫：
 *   1. `src/components/*.vue` 每个组件必须「被 import 过」**或**「显式声明为未接线」；
 *   2. **Vue 组件错误必须有人接** —— 因为 `useErrorLogger` 明确依赖这件事。
 *
 * 为什么需要它（接线状态透镜的第四次应用）
 * ----------------------------------------
 * 前三次：192 `electronAPI`（IPC）→ 193 后端端点 → 196 `src/api/*.ts`（HTTP 包装层）。
 * 这次是 **Vue 组件**。实测（2026-10-09，round 197）：
 * `src/components/` 共 **9** 个组件，**只有 `MainLayout.vue` 被 import 过**
 * （在 `src/router/index.ts` 里），另外 **8 个（1,393 行）从未被任何地方导入**。
 *
 * 其中 `ErrorBoundary.vue` 的未挂载**不只是死代码，而是一个功能缺口**：
 *
 *   `useErrorLogger.installErrorLogger()` 里写着
 *       「Vue 错误由 App.vue 的 onErrorCaptured 处理，这里处理全局 JS 错误」
 *   —— 而当时 **App.vue 里没有 onErrorCaptured**、`main.ts` 里没有
 *   `app.config.errorHandler`、`ErrorBoundary.vue` 也没挂。
 *   Vue 3 对组件内异常默认只 `console.error`，**不会冒泡到 `window.onerror`**，
 *   于是**「Vue 组件异常」这一类错误整类不被上报** —— 静默丢失。
 *
 *   → 这暴露了一类更普遍的坏味道：**注释声称的接线可能根本不存在**。
 *     本守卫因此不只查「组件有没有被用」，还查「那句注释的前提有没有代码兜着」。
 *
 * 口径
 * ----
 * * 「被 import」= `src/` 里出现 `from '…/<组件名>.vue'`（静态 import 即可；
 *   本仓库没有动态 import 组件、也没有自动导入插件 —— vite.config.ts 里无
 *   `unplugin-vue-components` / `unplugin-auto-import`，已核实）；
 * * **注释先剥掉**再判 —— 本仓库的注释里会提到组件名（例如
 *   `locales/index.ts` 就写着「ErrorBoundary.vue 从 main.ts 出发不可达（死代码）」），
 *   不剥注释会把「注释里提过」当成「被引用」；
 * * 未接线组件进 `UNWIRED` 表并写明理由；**双向**断言。
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const REPO = process.cwd()
const SRC = path.join(REPO, 'src')
const COMPONENTS = path.join(SRC, 'components')

const read = (p: string) => fs.readFileSync(p, 'utf8')

function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** `src/components/` 下的组件名。 */
function componentNames(): string[] {
  return fs
    .readdirSync(COMPONENTS)
    .filter((f) => f.endsWith('.vue'))
    .map((f) => f.replace(/\.vue$/, ''))
    .sort()
}

/** 递归收集 src 下所有源码（剥掉注释）。 */
function srcText(): string {
  const parts: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|vue)$/.test(entry.name)) parts.push(stripComments(read(full)))
    }
  }
  walk(SRC)
  return parts.join('\n')
}

/**
 * 已确认**当前未被导入**的组件，及理由。
 * 进这张表 = 「已知且已判断过」，**不是**「允许随便加」。
 */
const UNWIRED: Record<string, string> = {
  ErrorBoundary:
    '组件错误边界的 UI（错误卡片 + 重试 + 回首页，221 行）。**从未挂载**。' +
    '本轮已用 `App.vue` 的 `onErrorCaptured` 补上「上报」这一步（见下），' +
    '但这个组件的**用户可见错误 UI** 仍未接线。' +
    '⚠️ 注意它**不是半成品**：7 个 `errorBoundary.*` i18n 键在 zh-CN / en-US 里' +
    '**都已存在**（已核实）—— 也就是说「组件 + 文案」全都齐了，只差挂载。' +
    '挂载它需要 GUI 验证（它是最外层包裹，出错会影响整页），处置见 D17。',
  DeviceTopology:
    '设备拓扑图组件（266 行）。没有任何界面引用它 —— 属「功能未接线」。见 D17。',
  TrendComparison:
    '趋势对比图组件（254 行）。没有任何界面引用它 —— 属「功能未接线」。见 D17。',
  OnboardingGuide:
    '首次使用引导组件（172 行）。没有任何界面引用它 —— 属「功能未接线」。见 D17。',
  ReportGenerator:
    '报表生成组件（153 行）。没有任何界面引用它；' +
    '注意 `tests/utils/export.test.ts` 里有两条注释**以它为反例**说明历史漏洞，' +
    '但那不构成接线。见 D17。',
  VirtualList:
    '虚拟滚动列表组件（142 行）。没有任何界面引用它。见 D17。',
  SkeletonScreen:
    '骨架屏组件（138 行）。没有任何界面引用它。见 D17。',
  StatCard:
    '统计卡片组件（47 行）。没有任何界面引用它。见 D17。',
}

const names = componentNames()
const text = srcText()

const isImported = (name: string) =>
  new RegExp(`from\\s+['"][^'"]*/${name}\\.vue['"]`).test(text)

describe('Vue 组件接线状态（src/components ⇄ 谁 import 了它）', () => {
  it('抠出来的组件面非空（否则守卫本身失效）', () => {
    expect(names.length).toBeGreaterThan(5)
  })

  it('抠出来的 src 文本非空（否则「没人 import」是因为没扫到文件）', () => {
    expect(text.length).toBeGreaterThan(10000)
  })

  it('每个组件：要么被 import，要么在 UNWIRED 表里声明', () => {
    const problems = names.filter((n) => !isImported(n) && !(n in UNWIRED))
    expect(
      problems,
      'src/components 下未被任何地方 import 的组件必须显式声明 ——\n' +
        '这类「组件写好了、没人挂」的缺陷不会报错，只会让那部分 UI 不存在。\n' +
        problems.map((p) => `  ${p}`).join('\n'),
    ).toEqual([])
  })

  it('UNWIRED 表里的每一条都必须真的仍未接线（否则表会过期腐烂）', () => {
    const stale = Object.keys(UNWIRED).filter((n) => isImported(n))
    expect(stale, `以下组件已经被 import 了，请从 UNWIRED 表删掉：${stale.join(', ')}`).toEqual([])
  })

  it('UNWIRED 表里不许有已不存在的组件（防改错名留下僵尸条目）', () => {
    const ghosts = Object.keys(UNWIRED).filter((n) => !names.includes(n))
    expect(ghosts, `UNWIRED 表里有已不存在的组件：${ghosts.join(', ')}`).toEqual([])
  })

  it('每条声明都必须写明理由', () => {
    const thin = Object.entries(UNWIRED)
      .filter(([, r]) => !r || r.trim().length < 20)
      .map(([n]) => n)
    expect(thin, `以下组件没写清理由：${thin.join(', ')}`).toEqual([])
  })

  it('正向对照：已知被 import 的 MainLayout 必须被扫到', () => {
    // 这条红了说明扫描口径坏了，而不是「它没被 import」
    expect(isImported('MainLayout')).toBe(true)
  })
})

describe('Vue 组件错误必须有人接（useErrorLogger 的前提）', () => {
  // 为什么单列一组：`installErrorLogger()` 的注释**声称**
  // 「Vue 错误由 App.vue 的 onErrorCaptured 处理」——
  // 这个前提曾经不成立（round 197），导致「Vue 组件异常」整类不被上报。
  // **注释里声称的接线必须有代码兜着。**

  it('App.vue 注册了 onErrorCaptured，或 main.ts 设了 app.config.errorHandler', () => {
    const app = stripComments(read(path.join(SRC, 'App.vue')))
    const main = stripComments(read(path.join(SRC, 'main.ts')))
    const wired =
      /onErrorCaptured\s*\(/.test(app) || /config\s*\.\s*errorHandler/.test(main)
    expect(
      wired,
      '没有任何地方接住 Vue 组件错误 —— Vue 3 默认只 console.error，' +
        '不会冒泡到 window.onerror，于是这类错误**完全不被上报**。' +
        '要么在 App.vue 用 onErrorCaptured，要么在 main.ts 设 app.config.errorHandler。',
    ).toBe(true)
  })

  it('那个错误处理钩子必须真的把错误送进上报链路（不是空实现）', () => {
    const app = stripComments(read(path.join(SRC, 'App.vue')))
    const main = stripComments(read(path.join(SRC, 'main.ts')))
    const reports =
      /reportVueError\s*\(/.test(app) ||
      /reportVueError\s*\(/.test(main) ||
      /addError\s*\(/.test(main)
    expect(
      reports,
      '钩子存在但没把错误交给上报链路（reportVueError）—— 那只是把错误吞掉了',
    ).toBe(true)
  })

  it('main.ts 仍然调用 installErrorLogger()（全局 JS 错误那一半）', () => {
    const main = stripComments(read(path.join(SRC, 'main.ts')))
    expect(/installErrorLogger\s*\(/.test(main)).toBe(true)
  })
})
