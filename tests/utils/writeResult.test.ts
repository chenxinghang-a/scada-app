/**
 * 写入结果提示（round 234）。
 *
 * 后端 `write_with_verification` 返回 `verified`：
 *   true  → 回读一致；false → 回读不一致（设备没接受）；null → 没能回读。
 *
 * 控制页原先一律弹「写入成功」，于是「写进去了但设备没接受」和「根本没验证」
 * 都被显示成成功。操作员据此判断现场状态 —— 安全相关的假成功。
 */
import { describe, it, expect } from 'vitest'
import { describeWriteResult } from '@/utils/writeResult'

describe('describeWriteResult', () => {
  it('verified=false 必须是 warning，绝不能是 success', () => {
    const n = describeWriteResult({ success: true, verified: false, message: '写入成功，但回读验证失败' })
    expect(n.level).toBe('warning')
    expect(n.level).not.toBe('success')
    expect(n.message).toContain('回读验证失败')
  })

  it('verified=null（未能回读）是 info，不是 success', () => {
    const n = describeWriteResult({ success: true, verified: null, message: '写入成功，但无法回读验证' })
    expect(n.level).toBe('info')
    expect(n.message).toContain('无法回读验证')
  })

  it('verified=true 才是 success', () => {
    const n = describeWriteResult({ success: true, verified: true })
    expect(n.level).toBe('success')
    expect(n.message).toBe('写入成功')
  })

  it('后端没给 verified（老版本/降级路径）→ 维持 success', () => {
    expect(describeWriteResult({ success: true }).level).toBe('success')
  })

  it('没有 message 时用兜底文案，不显示 undefined', () => {
    expect(describeWriteResult({ verified: false }).message).not.toContain('undefined')
    expect(describeWriteResult({ verified: null }).message).not.toContain('undefined')
  })
})
