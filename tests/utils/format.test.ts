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
