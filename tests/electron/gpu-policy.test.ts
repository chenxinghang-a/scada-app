import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * electron/gpu-policy.js —— 降级阶梯的**纯决策层**契约（2026-10-09）。
 *
 * 为什么值得单测：阶梯的升级/粘性逻辑是**跨启动状态机**
 * （launch-attempt.json + gpu-state.json），在真机上把每种组合都跑一遍不现实；
 * 把决策抽成纯函数后，所有组合在这里一次钉死。
 * 配合 main.js 的源码结构守卫（gpu-fallback.test.ts）——
 * 「算得对」与「接得对」两边都有钉子。
 *
 * 背景（实测记录）：受限环境里崩溃是一整条谱系 ——
 *   L0：GPU 进程沙箱起不来 → 连崩 9 次 → FATAL 秒退；
 *   L1（disable-gpu-sandbox + 软渲染）：GPU 不崩了，但**渲染进程**崩 → 白窗；
 *   L2（+no-sandbox）：0 崩溃。
 * 只到 L1 的两级自愈在受限环境里**永远到不了可用状态**，所以必须有 L2。
 */

const require_ = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const policy: any = require_(path.join(process.cwd(), 'electron', 'gpu-policy.js'))

describe('gpu-policy：级别归一化', () => {
  it('非法输入 → 0（旧标记没有 level 字段走的就是这条路）', () => {
    for (const v of [undefined, null, NaN, 'x', {}, -1, -0.5]) {
      expect(policy.normalizeLevel(v), `normalizeLevel(${JSON.stringify(v)})`).toBe(0)
    }
  })

  it('合法输入 → 截到 [0, 2] 的整数', () => {
    expect(policy.normalizeLevel(0)).toBe(0)
    expect(policy.normalizeLevel(1)).toBe(1)
    expect(policy.normalizeLevel(2)).toBe(2)
    expect(policy.normalizeLevel(999)).toBe(2)
    expect(policy.normalizeLevel(1.9)).toBe(1)
    expect(policy.normalizeLevel('1')).toBe(1) // JSON 里若存成字符串也要认
  })

  it('MAX_FALLBACK_LEVEL = 2（no-sandbox 是最后一级）', () => {
    expect(policy.MAX_FALLBACK_LEVEL).toBe(2)
  })
})

describe('gpu-policy：决策（崩一级升一级 + 粘性成功级 + 手动只抬不降）', () => {
  it('无任何输入 → L0、无原因（默认行为不变）', () => {
    expect(policy.decideLevel({})).toEqual({ level: 0, reason: null })
    expect(policy.decideLevel()).toEqual({ level: 0, reason: null })
  })

  it('旧版标记崩过（无 level）→ 升到 L1，原因 auto-retry（与旧行为逐位兼容）', () => {
    expect(policy.decideLevel({ prevCrashed: true, prevLevel: undefined })).toEqual({
      level: 1,
      reason: 'auto-retry',
    })
  })

  it('L1 崩过 → 升到 L2（受限环境的关键一跳）', () => {
    expect(policy.decideLevel({ prevCrashed: true, prevLevel: 1 })).toEqual({
      level: 2,
      reason: 'auto-retry',
    })
  })

  it('L2 也崩过 → 封顶在 L2 重试（不越界）', () => {
    expect(policy.decideLevel({ prevCrashed: true, prevLevel: 2 })).toEqual({
      level: 2,
      reason: 'auto-retry',
    })
  })

  it('没崩过时 prevLevel 无效（不会因历史数值就降级）', () => {
    expect(policy.decideLevel({ prevCrashed: false, prevLevel: 2 })).toEqual({ level: 0, reason: null })
  })

  it('历史成功级别是粘性的：直接采用', () => {
    expect(policy.decideLevel({ goodLevel: 2 })).toEqual({ level: 2, reason: 'sticky' })
    expect(policy.decideLevel({ goodLevel: 1 })).toEqual({ level: 1, reason: 'sticky' })
  })

  it('手动开关只抬不降（env/flag）', () => {
    expect(policy.decideLevel({ manualLevel: 1, manualReason: 'env' })).toEqual({
      level: 1,
      reason: 'env',
    })
    // 手动 L1 + 历史成功 L2 → 取更大的 L2
    expect(policy.decideLevel({ manualLevel: 1, manualReason: 'flag', goodLevel: 2 })).toEqual({
      level: 2,
      reason: 'sticky',
    })
  })

  it('三者取最大；原因取「最高级别的来源」', () => {
    // 崩过（L1 崩 → auto=2）＋ 粘性 L1 ＋ 手动 L1 → L2 / auto-retry
    expect(
      policy.decideLevel({ prevCrashed: true, prevLevel: 1, goodLevel: 1, manualLevel: 1, manualReason: 'env' }),
    ).toEqual({ level: 2, reason: 'auto-retry' })
    // L0 崩过（auto=1）＋ 粘性 L2 → L2 / sticky
    expect(policy.decideLevel({ prevCrashed: true, prevLevel: 0, goodLevel: 2 })).toEqual({
      level: 2,
      reason: 'sticky',
    })
  })

  it('手动原因缺省时不编造（reason=manual 兜底）', () => {
    expect(policy.decideLevel({ manualLevel: 1 }).reason).toBe('manual')
  })
})
