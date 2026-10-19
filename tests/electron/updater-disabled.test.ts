/**
 * 自动更新契约守卫 —— 开关状态与「发布渠道是否真的配好」必须一致。
 *
 * 为什么需要这条
 * --------------
 * 2026-10-19 起自动更新**已启用**（决策 A：走 GitHub Releases）。
 * 但"启用"不是一个布尔值的事：开关翻成 true 而依赖没装 / publish 没配，
 * 运行时会走到 `reportDisabled()` 打出"未启用"——**用户以为有自动更新，
 * 实际永远不会更新**，这正是本项目反复在修的"静默失效"。
 *
 * 所以本守卫不再断言"开关必须是 false"（那是旧口径，改一次决策就要改测试，
 * 属于把判据写死成结论），而是断言**一致性**：
 *
 *   ① 开关为 true ⇒ 必须已声明 electron-updater 依赖 + build.publish 指向 GitHub；
 *      开关为 false ⇒ 允许依赖/publish 存在，但必须显式写 false（不能删掉开关）；
 *   ② 注释把「未配置 publish」列为硬约束 → 每个入口函数体内必须真的检查并 return；
 *   ③ 依赖缺失必须由 `!autoUpdater` 分支兜住（不得静默吞错）。
 *
 * ⚠️ 期望值来源：从**代码与 package.json 的实际状态**推导，不写死字面量。
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { stripComments, extractFunctionBody } from '../helpers/source-text'

const REPO = process.cwd()
const UPDATER = path.join(REPO, 'electron', 'updater.js')
const PKG = path.join(REPO, 'package.json')

const src = () => fs.readFileSync(UPDATER, 'utf8')
const pkg = () => JSON.parse(fs.readFileSync(PKG, 'utf8'))

/**
 * 注释剥离与函数体抠取来自**共享原语** `tests/helpers/source-text`。
 *
 * 为什么必须"先剥注释再断言"（本守卫自己踩过的坑）
 * ------------------------------------------------
 * 变异实验：把 `setupUpdater` 里那段 `if (!hasPublishConfig()) { ... return }` 整块删掉后，
 * 守卫**依然 3/3 绿** —— 因为函数体里还留着一行注释：
 *   `// 防御：即便开关打开，但依赖缺失 / 未配置 publish...`
 * 断言 `/hasPublishConfig(...)/.test(body) === false` 为真、但 `/\bpublish\b/.test(body)`
 * 被**注释里的 "publish"** 点亮 → 弱断言蒙混过关。
 *
 * 这正是本项目 Bug 14「自喂陷阱」的近亲：**判据读取了它本不该读的文本**（这里是注释）。
 * 结论：一切"代码里有没有 X"的判据，都必须先剥注释，否则注释能冒充实现。
 *
 * ⚠️ 该逻辑曾在本文件里内联一份，2026-10-12 统一迁到共享模块 ——
 * 因为仓库里当时有 10 个测试各写一份，实现分 5 种，且**都不认识正则字面量**
 * （`/"/g` 里的引号会被当字符串开头）。共享原语已修掉该盲区并配 17 例单测。
 */
describe('自动更新契约（开关 ⇔ 发布渠道）', () => {
  it('① 开关为 true ⇒ 依赖与 publish 必须真的配好（否则是"假启用"）', () => {
    const m = src().match(/const\s+AUTO_UPDATE_ENABLED\s*=\s*(true|false)/)
    expect(m, '找不到 AUTO_UPDATE_ENABLED 声明 —— 守卫失效').toBeTruthy()
    const enabled = m![1] === 'true'

    const p = pkg()
    const hasDep =
      'electron-updater' in (p.dependencies ?? {}) ||
      'electron-updater' in (p.devDependencies ?? {})
    const publish = p.build?.publish
    const publishList = Array.isArray(publish) ? publish : publish ? [publish] : []
    const hasPublish = publishList.length > 0

    if (enabled) {
      expect(
        hasDep,
        'AUTO_UPDATE_ENABLED=true 但 package.json 未声明 electron-updater —— ' +
          '运行时会走 reportDisabled 打出"未启用"，用户以为有更新但永远不更新。',
      ).toBe(true)
      expect(
        hasPublish,
        'AUTO_UPDATE_ENABLED=true 但 build 段未配置 publish —— 会打向一个不存在的服务器。',
      ).toBe(true)
      // publish 必须真的指向一个仓库，而不是占位
      const gh = publishList.find((x: any) => x && x.provider === 'github')
      expect(gh, 'publish 里没有 provider=github 的条目').toBeTruthy()
      expect(gh.owner, 'publish.owner 缺失 —— 更新会 404').toBeTruthy()
      expect(gh.repo, 'publish.repo 缺失 —— 更新会 404').toBeTruthy()
    } else {
      // 关闭状态：允许依赖/publish 残留，但开关必须显式写 false（不得删掉这行）
      expect(enabled, 'AUTO_UPDATE_ENABLED 既不是 true 也不是 false —— 守卫失效').toBe(false)
    }
  })

  it('② 注释把「未配置 publish」列为硬约束 → 代码必须真的读 publish（且每个入口都查）', () => {
    const s = src()
    // 从注释里认这条约束是否存在（"未配置 publish" / "配置 publish"）
    const commentClaimsPublish =
      /未配置\s*publish/.test(s) || /build\s*段.{0,6}publish/.test(s)
    if (!commentClaimsPublish) return // 注释没承诺这条，本判据不适用（不假装通过）

    // ⚠️ 判据必须"每个入口都查"，不能只查"代码里出现过 publish" ——
    //    实测：只在 checkForUpdates 里查、漏掉 setupUpdater 时，
    //    "出现过即通过"的弱断言**照样绿**（守卫是瞎的）。
    //    所以切成函数颗粒度：每个会走更新链路的入口函数体内都必须出现 publish 检查。
    //
    // ⚠️⚠️ 而且必须**先剥注释**：变异实验证明，函数体内残留的一行注释
    //    `// ...未配置 publish...` 足以让 `/\bpublish\b/` 为真 → 删掉整段检查后守卫仍绿。
    //    剥注释后，断言只认真实代码。
    //
    // ⚠️⚠️⚠️ 第三轮变异（M2）又暴露一层：把终止动作的判据放宽成"函数体里出现过 return"
    //    也不好使 —— setupUpdater 里 `!autoUpdater` 分支本来就有一个 return，
    //    于是"检查了但不 return"（漏拦）的缺陷**照样绿**。
    //    正确判据必须**贴着检查本身**：`if (!hasPublishConfig()) { ... }` 这个块内必须有 return。
    //    → 一切"某代码块是否做了 X"的判据，块的范围必须精确到该块，不能放大到所在函数。
    const entryFns = ['setupUpdater', 'checkForUpdates']
    const missing: string[] = []
    for (const fn of entryFns) {
      const raw = extractFunctionBody(s, fn)
      if (!raw) {
        missing.push(`${fn}（找不到函数体 —— 守卫失效）`)
        continue
      }
      const body = stripComments(raw)
      // 定位 `if (!hasPublishConfig())` 这个守卫块，取其后配对的 { ... }
      const guardIdx = body.search(/if\s*\(\s*!\s*hasPublishConfig\s*\(\s*\)\s*\)/)
      if (guardIdx < 0) {
        missing.push(`${fn}（未调用 hasPublishConfig()）`)
        continue
      }
      const braceIdx = body.indexOf('{', guardIdx)
      if (braceIdx < 0) {
        missing.push(`${fn}（hasPublishConfig 检查后没有代码块 —— 守卫失效）`)
        continue
      }
      let depth = 0
      let end = -1
      for (let i = braceIdx; i < body.length; i++) {
        if (body[i] === '{') depth++
        else if (body[i] === '}') {
          depth--
          if (depth === 0) {
            end = i
            break
          }
        }
      }
      if (end < 0) {
        missing.push(`${fn}（hasPublishConfig 检查块花括号不配平 —— 守卫失效）`)
        continue
      }
      const guardBlock = body.slice(braceIdx + 1, end)
      // 块内必须真的终止流程：return（或 throw）
      if (!/\breturn\b/.test(guardBlock) && !/\bthrow\b/.test(guardBlock)) {
        missing.push(`${fn}（hasPublishConfig() 为假时未 return —— 检查形同虚设，更新照跑）`)
      }
    }

    expect(
      missing,
      '注释承诺「build 段未配置 publish ⇒ 更新保持关闭」这条硬约束，' +
        '但以下**入口函数里没有 publish 检查**：\n' +
        missing.map((m) => `  ${m}`).join('\n') +
        '\n这是把安全条件写成了"注释担保"。一旦有人把 AUTO_UPDATE_ENABLED 翻成 true，' +
        '更新会打向未配置的服务器且无人拦截。\n' +
        '修法二选一：(a) 在**每个**入口里真的检查 build.publish，不满足则 reportDisabled 后 return；' +
        '(b) 把注释里这条约束删掉 / 降级为"启用前须知"，不再声称它是硬约束。',
    ).toEqual([])
  })

  it('③ 依赖未声明（注释约束 3）必须由 !autoUpdater 分支兜住', () => {
    const s = src()
    // 依赖现状：若未声明 electron-updater，则 require 会 throw → autoUpdater 保持 null
    const hasDep =
      'electron-updater' in (pkg().dependencies ?? {}) ||
      'electron-updater' in (pkg().devDependencies ?? {})
    const guardsNull = /if\s*\(\s*!autoUpdater\s*\)/.test(s)

    expect(
      guardsNull,
      'updater.js 没有 !autoUpdater 兜底分支 —— 依赖缺失时会走到 autoUpdater.xxx 抛错',
    ).toBe(true)

    if (!hasDep) {
      // 依赖确实没声明：那 autoUpdater 必然为 null（require 被 catch），
      // 断言 try/catch 存在且吞错时把 loadError 记下来（否则是静默失效）
      expect(/catch\s*\(\s*\w+\s*\)\s*\{[^}]*loadError\s*=/.test(s), '加载失败必须记入 loadError（不得静默吞掉）').toBe(true)
    }
  })
})
