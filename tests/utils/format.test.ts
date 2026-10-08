import { describe, it, expect } from 'vitest'
import { formatUptime, getDeviceDisplayName, formatNumber, formatPercent } from '@/utils/format'

describe('formatUptime', () => {
  it('formats minutes only', () => {
    expect(formatUptime(90)).toBe('1分')
  })

  it('formats hours and minutes', () => {
    expect(formatUptime(3661)).toBe('1时1分')
  })

  it('formats days and hours', () => {
    expect(formatUptime(90000)).toBe('1天1时')
  })

  it('handles zero', () => {
    expect(formatUptime(0)).toBe('0分')
  })

  it('handles exact hours', () => {
    expect(formatUptime(7200)).toBe('2时0分')
  })
})

describe('getDeviceDisplayName', () => {
  it('returns name if present', () => {
    expect(getDeviceDisplayName({ name: 'Pump A' })).toBe('Pump A')
  })

  it('falls back to device_name', () => {
    expect(getDeviceDisplayName({ device_name: 'Pump B' })).toBe('Pump B')
  })

  it('falls back to device_id', () => {
    expect(getDeviceDisplayName({ device_id: 'dev-001' })).toBe('dev-001')
  })

  it('returns default for null', () => {
    expect(getDeviceDisplayName(null)).toBe('未知设备')
  })

  it('returns default for undefined', () => {
    expect(getDeviceDisplayName(undefined)).toBe('未知设备')
  })
})

describe('formatNumber', () => {
  it('formats with default 2 decimals', () => {
    expect(formatNumber(3.14159)).toBe('3.14')
  })

  it('formats with custom decimals', () => {
    expect(formatNumber(3.14159, 4)).toBe('3.1416')
  })

  it('returns dash for null', () => {
    expect(formatNumber(null)).toBe('-')
  })

  it('returns dash for undefined', () => {
    expect(formatNumber(undefined)).toBe('-')
  })

  it('returns dash for NaN', () => {
    expect(formatNumber(NaN)).toBe('-')
  })
})

describe('formatPercent', () => {
  it('formats percent with default 1 decimal', () => {
    expect(formatPercent(85.456)).toBe('85.5%')
  })

  it('formats percent with custom decimals', () => {
    expect(formatPercent(85.456, 2)).toBe('85.46%')
  })

  it('returns dash for null', () => {
    expect(formatPercent(null)).toBe('-')
  })

  it('returns dash for undefined', () => {
    expect(formatPercent(undefined)).toBe('-')
  })
})

/**
 * **等价性证明**：把视图里的内联 `.toFixed()` 换成这些格式化函数，为什么是安全的。
 *
 * 背景（round 201，决策简报 D19）：`utils/format.ts` 这套函数一直**没人 import**，
 * 而视图里散着 56 处内联 `.toFixed()`（Industry40 一个视图就 36 处），
 * **没有这里的 `Number.isFinite` 守卫**。
 *
 * 本组用例把两件事钉住：
 *   1. **对有限值，两者输出逐字相同** —— 所以替换**不会改变正常数据的显示**；
 *   2. **只对非有限值不同** —— 内联那套会渲染 `NaN%`，这套渲染 `-`。
 * 这样「统一口径」这件事就从「凭感觉」变成「有据可查」。
 */
describe('与内联 .toFixed() 的等价性（D19 统一口径的依据）', () => {
  const FINITE = [0, 0.5, 1, 33.333, 85.456, 99.999, 100, 1234.5678]

  it('formatPercent(v) 与 `(v).toFixed(1) + "%"` 对有限值逐字相同', () => {
    for (const v of FINITE) {
      expect(formatPercent(v), `v=${v}`).toBe(`${v.toFixed(1)}%`)
    }
  })

  it('formatNumber(v) 与 `(v).toFixed(2)` 对有限值逐字相同', () => {
    for (const v of FINITE) {
      expect(formatNumber(v), `v=${v}`).toBe(v.toFixed(2))
    }
  })

  it('⚠️ 只对**非有限值**不同：内联那套渲染 "NaN%"，这套渲染 "-"', () => {
    // 这一条是「为什么要换」的直接证据：OEE 表原先写的是
    //   `(row.performance*100).toFixed(1) + '%'`
    // 一旦 performance 缺值 → undefined*100 = NaN → 界面显示 "NaN%"。
    const broken = (v: number | undefined) => `${(Number(v) * 100).toFixed(1)}%`
    const fixed = (v: number | undefined) => formatPercent(Number(v) * 100)

    expect(broken(undefined)).toBe('NaN%')       // ← 旧写法的实际输出
    expect(fixed(undefined)).toBe('-')           // ← 新写法
    expect(broken(0.854)).toBe('85.4%')          // 正常值两者一致
    expect(fixed(0.854)).toBe('85.4%')
  })

  it('formatUptime 对非法输入不会算出 "-1分" / "NaN分"', () => {
    // 负数/NaN 直接做除法会得到 "-1分" / "NaN分"
    expect(formatUptime(-5)).toBe('0分')
    expect(formatUptime(NaN)).toBe('0分')
    expect(formatUptime(0)).toBe('0分')
    expect(formatUptime(90)).toBe('1分')
  })
})
