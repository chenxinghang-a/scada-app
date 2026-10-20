import { describe, it, expect } from 'vitest'
import {
  summarizeQueryResults,
  describeQueryFailures,
  type RegisterQueryResult,
} from '../../src/utils/historyQuery'

const ok = (register: string): RegisterQueryResult => ({ register, rows: [1, 2], failed: false })
const bad = (register: string): RegisterQueryResult => ({ register, rows: [], failed: true })

describe('summarizeQueryResults：多寄存器查询的失败汇总', () => {
  it('全部成功 → 不算失败', () => {
    const s = summarizeQueryResults([ok('温度'), ok('压力')])
    expect(s.allFailed).toBe(false)
    expect(s.partiallyFailed).toBe(false)
    expect(s.failedRegisters).toEqual([])
    expect(s.okRegisters).toEqual(['温度', '压力'])
  })

  it('全部失败 → allFailed', () => {
    const s = summarizeQueryResults([bad('温度'), bad('压力')])
    expect(s.allFailed).toBe(true)
    expect(s.partiallyFailed).toBe(false)
    expect(s.failedRegisters).toEqual(['温度', '压力'])
  })

  it('部分失败 → partiallyFailed 且点名失败的参数（这是原实现漏掉的那一档）', () => {
    const s = summarizeQueryResults([ok('温度'), bad('压力'), ok('流量')])
    expect(s.allFailed).toBe(false)
    expect(s.partiallyFailed).toBe(true)
    expect(s.failedRegisters).toEqual(['压力'])
    expect(s.okRegisters).toEqual(['温度', '流量'])
  })

  it('空结果集不算失败（没有请求就没有失败）', () => {
    const s = summarizeQueryResults([])
    expect(s.allFailed).toBe(false)
    expect(s.partiallyFailed).toBe(false)
    expect(s.failedRegisters).toEqual([])
  })

  it('保持传入顺序（提示语里的顺序要稳定，便于对照界面）', () => {
    const s = summarizeQueryResults([bad('c'), bad('a'), bad('b')])
    expect(s.failedRegisters).toEqual(['c', 'a', 'b'])
  })
})

describe('describeQueryFailures：给用户看的文案', () => {
  it('无失败 → 空串（调用方据此决定不弹提示）', () => {
    expect(describeQueryFailures(summarizeQueryResults([ok('温度')]))).toBe('')
  })

  it('全部失败 → 整体失败文案', () => {
    const text = describeQueryFailures(summarizeQueryResults([bad('温度')]))
    expect(text).toBe('历史数据查询失败，请稍后重试')
  })

  it('部分失败 → 点名失败参数，并说明「图表不完整」', () => {
    const text = describeQueryFailures(summarizeQueryResults([ok('温度'), bad('压力'), bad('流量')]))
    expect(text).toContain('图表不完整')
    expect(text).toContain('压力')
    expect(text).toContain('流量')
    expect(text).not.toContain('温度')
  })
})
