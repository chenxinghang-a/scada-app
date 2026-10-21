/**
 * 故障预测剩余时间的展示（round 237）。
 *
 * 后端 `days_to_limit` 保留 2 位小数；「2 小时后到限」显示成「0.21天」
 * 没人能读，所以 48 小时内改用 `hours_to_limit`。
 */
import { describe, it, expect } from 'vitest'
import { etaText } from '@/utils/predictionEta'

describe('etaText', () => {
  it('48 小时内用小时', () => {
    expect(etaText({ days_to_limit: 0.21, hours_to_limit: 5 })).toBe('5小时')
  })

  it('超过 48 小时用天', () => {
    expect(etaText({ days_to_limit: 3.5, hours_to_limit: 84 })).toBe('3.5天')
  })

  it('恰好 48 小时按天显示（边界）', () => {
    expect(etaText({ days_to_limit: 2, hours_to_limit: 48 })).toBe('2天')
  })

  it('没有 hours_to_limit（老后端）时退回天', () => {
    expect(etaText({ days_to_limit: 1.5 })).toBe('1.5天')
  })

  it('没有预测时显示 -', () => {
    expect(etaText(null)).toBe('-')
    expect(etaText(undefined)).toBe('-')
    expect(etaText({})).toBe('-')
  })
})
