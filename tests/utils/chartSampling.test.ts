/**
 * src/utils/chartSampling.ts 降采样算法边界测试。
 *
 * 这个模块此前零覆盖，而它服务的是**趋势图/历史曲线**：
 *   - 采样点数量算错 → ECharts 渲染卡顿或点数对不上 target；
 *   - 首尾点丢失 → 曲线两端"缺一截"，操作员看到的时间轴与实际不符（工业场景里这是误导判断）；
 *   - 尖峰被抹掉 → 真正的异常波动（比如压力瞬间冲高）在曲线上消失，
 *     比"图卡"严重得多。
 *
 * 所以断言集中在：**数量 == target、首尾必须保留、尖峰必须保留**，
 * 而不是具体挑中了哪个中间点（那属于实现细节）。
 */

import { describe, it, expect } from 'vitest'
import {
  lttbDownsample,
  uniformDownsample,
  adaptiveDownsample,
  timeSeriesDownsample,
  slidingWindowSample,
} from '@/utils/chartSampling'

type Pt = [number, number]

function series(n: number, fn: (i: number) => number = i => i): Pt[] {
  return Array.from({ length: n }, (_, i) => [i, fn(i)] as Pt)
}

const BIG = series(1000)

describe('lttbDownsample', () => {
  it('targetCount <= 0 返回空数组（不能让调用方拿到 undefined）', () => {
    expect(lttbDownsample(BIG, 0)).toEqual([])
    expect(lttbDownsample(BIG, -5)).toEqual([])
  })

  it('数据量本就不超目标时原样返回（不做无谓拷贝）', () => {
    const small = series(10)
    expect(lttbDownsample(small, 10)).toBe(small)
    expect(lttbDownsample(small, 100)).toBe(small)
  })

  it('采样后的点数恰好等于 targetCount', () => {
    for (const target of [3, 5, 100, 999]) {
      expect(lttbDownsample(BIG, target).length, `target=${target}`).toBe(target)
    }
  })

  it('首点与末点必须保留（否则曲线两端缺一截）', () => {
    const out = lttbDownsample(BIG, 50)
    expect(out[0]).toEqual(BIG[0])
    expect(out[out.length - 1]).toEqual(BIG[BIG.length - 1])
  })

  it('尖峰必须被保留（LTTB 存在的唯一理由）', () => {
    // 第 500 点是一个孤立尖峰，两侧都是平坦基线
    const spike = series(1000, i => (i === 500 ? 999 : 1))
    const out = lttbDownsample(spike, 30)
    expect(out.some(p => p[1] === 999), '尖峰被采样抹掉了').toBe(true)
  })

  it('输出索引严格单调递增（顺序错乱会让折线自交）', () => {
    const out = lttbDownsample(BIG, 77)
    for (let i = 1; i < out.length; i++) {
      expect(out[i][0]).toBeGreaterThan(out[i - 1][0])
    }
  })

  it('targetCount < 3 的退化分支不越界', () => {
    const out = lttbDownsample(BIG, 2)
    expect(out.length).toBe(2)
    expect(BIG).toContainEqual(out[0])
    expect(BIG).toContainEqual(out[1])
  })

  it('targetCount 远大于数据量时原样返回（内部 bucket 不会除零得到 NaN）', () => {
    const small = series(5)
    const out = lttbDownsample(small, 5000)
    expect(out).toBe(small)
  })

  it('空输入不抛异常', () => {
    expect(lttbDownsample([], 10)).toEqual([])
  })
})

describe('uniformDownsample', () => {
  it('数据量不超目标时原样返回', () => {
    const small = series(10)
    expect(uniformDownsample(small, 10)).toBe(small)
  })

  it('点数等于 targetCount 且索引不越界', () => {
    const out = uniformDownsample(BIG, 100)
    expect(out.length).toBe(100)
    for (const p of out) expect(BIG).toContainEqual(p)
  })

  it('首点为原始首点，末点不超过最后一个索引', () => {
    const out = uniformDownsample(BIG, 100)
    expect(out[0]).toEqual(BIG[0])
    expect(out[out.length - 1][0]).toBeLessThanOrEqual(BIG.length - 1)
  })

  it('采样是均匀的：相邻索引间隔基本相等', () => {
    const out = uniformDownsample(BIG, 10) // step = 100
    const idx = out.map(p => p[0])
    expect(idx).toEqual([0, 100, 200, 300, 400, 500, 600, 700, 800, 900])
  })

  it('targetCount <= 0 返回空数组', () => {
    expect(uniformDownsample(BIG, 0)).toEqual([])
  })
})

describe('adaptiveDownsample', () => {
  it('数据量不超目标时 ratio=1 且原样返回', () => {
    const small = series(10)
    const r = adaptiveDownsample(small, 100)
    expect(r.data).toBe(small)
    expect(r.originalCount).toBe(10)
    expect(r.sampledCount).toBe(10)
    expect(r.ratio).toBe(1)
  })

  it('返回的元信息与 data 一致（ratio 用于 UI 提示"已降采样 N%"）', () => {
    const r = adaptiveDownsample(BIG, 100)
    expect(r.originalCount).toBe(1000)
    expect(r.sampledCount).toBe(r.data.length)
    expect(r.ratio).toBeCloseTo(r.data.length / 1000, 6)
  })

  it('剧烈波动时优先 LTTB，尖峰不丢', () => {
    const spike = series(1000, i => (i === 700 ? 500 : 1))
    const r = adaptiveDownsample(spike, 40)
    expect(r.data.some(p => p[1] === 500), '自适应降采样抹掉了尖峰').toBe(true)
  })

  it('平稳数据走均匀采样（结果索引是等步长的）', () => {
    // 注意要同时满足两个条件才走均匀分支：低波动（cv<=0.1）且
    // data.length <= targetCount * 10 —— 否则还是 LTTB。
    const flat = series(1000, () => 42)
    const r = adaptiveDownsample(flat, 200)
    expect(r.data.map(p => p[0])).toEqual(
      Array.from({ length: 200 }, (_, i) => i * 5)
    )
  })

  it('采样结果点数不超过目标', () => {
    for (const target of [1, 2, 3, 50, 999]) {
      const r = adaptiveDownsample(BIG, target)
      expect(r.sampledCount, `target=${target}`).toBeLessThanOrEqual(target)
    }
  })
})

describe('timeSeriesDownsample', () => {
  it('数据量不超目标时原样返回', () => {
    const small = series(10)
    expect(timeSeriesDownsample(small, 10)).toBe(small)
  })

  it('降采样后保留首尾时间点（时间轴两端不能缺）', () => {
    const out = timeSeriesDownsample(BIG, 60)
    expect(out.length).toBe(60)
    expect(out[0]).toEqual(BIG[0])
    expect(out[out.length - 1]).toEqual(BIG[BIG.length - 1])
  })
})

describe('slidingWindowSample', () => {
  it('数据量不超上限时原样返回', () => {
    const small = series(10)
    expect(slidingWindowSample(small, 50)).toBe(small)
  })

  it('结果点数不超过 maxPoints（契约：滑动窗口不能越界）', () => {
    for (const ratio of [0, 0.1, 0.3, 0.5, 0.9, 1]) {
      const out = slidingWindowSample(BIG, 100, ratio)
      expect(out.length, `recentRatio=${ratio} 时点数超出窗口上限`).toBeLessThanOrEqual(100)
    }
  })

  it('最近的数据必须原样保留在尾部（实时监控最关心最新值）', () => {
    const out = slidingWindowSample(BIG, 100, 0.3)
    const recent = BIG.slice(-30)
    expect(out.slice(-30)).toEqual(recent)
    expect(out[out.length - 1]).toEqual(BIG[BIG.length - 1])
  })

  it('recentRatio=1 时全部窗口留给最近数据', () => {
    const out = slidingWindowSample(BIG, 100, 1)
    expect(out.length).toBe(100)
    expect(out).toEqual(BIG.slice(-100))
  })

  it('输出索引保持单调递增', () => {
    const out = slidingWindowSample(BIG, 100, 0.4)
    for (let i = 1; i < out.length; i++) {
      expect(out[i][0]).toBeGreaterThan(out[i - 1][0])
    }
  })
})
