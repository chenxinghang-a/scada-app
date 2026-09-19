import { describe, it, expect } from 'vitest'
import {
  escCSV,
  assertBinaryDownload,
  describeDownloadError,
  BlobContentError,
} from '@/utils/export'

describe('escCSV', () => {
  it('returns plain string unchanged', () => {
    expect(escCSV('hello')).toBe('hello')
  })

  it('escapes comma', () => {
    expect(escCSV('a,b')).toBe('"a,b"')
  })

  it('escapes double quote', () => {
    expect(escCSV('a"b')).toBe('"a""b"')
  })

  it('escapes newline', () => {
    expect(escCSV('a\nb')).toBe('"a\nb"')
  })

  it('handles null', () => {
    expect(escCSV(null)).toBe('')
  })

  it('handles undefined', () => {
    expect(escCSV(undefined)).toBe('')
  })

  it('converts number to string', () => {
    expect(escCSV(42)).toBe('42')
  })

  it('handles empty string', () => {
    expect(escCSV('')).toBe('')
  })

  it('escapes multiple special chars', () => {
    expect(escCSV('a,"b"\nc')).toBe('"a,""b""\nc"')
  })
})

// ---------------------------------------------------------------------------
// assertBinaryDownload —— 二进制下载的内容守卫
//
// 背景（真实缺陷）：`responseType: 'blob'` 的请求在后端返回错误时，HTTP 状态码
// 可能是 200，axios 不 reject，`response.data` 是一个内容为 {"error": "..."} 的
// Blob。调用方若不检查直接下载，用户会得到名为 .csv/.xlsx 的假文件。
//
// 原实现三处各不相同：
//   History.vue        —— 只在 catch 里解包（漏判 200 + JSON 错误体）
//   ReportGenerator.vue —— 检查 blob.type.includes('json')（依赖后端正确设 Content-Type）
//   其它               —— 无检查
// 统一为本函数后，判据改为「内容是否真的是 JSON」，不依赖 blob.type。
// ---------------------------------------------------------------------------

describe('assertBinaryDownload', () => {
  it('accepts a normal CSV blob', async () => {
    const blob = new Blob(['time,value\n2026-01-01,42\n'], { type: 'text/csv' })
    await expect(assertBinaryDownload(blob)).resolves.toBe(blob)
  })

  it('accepts a CSV blob even when it starts with a number', async () => {
    // 数值开头的内容绝不能被误判成 JSON
    const blob = new Blob(['123,456\n789,012\n'], { type: '' })
    await expect(assertBinaryDownload(blob)).resolves.toBe(blob)
  })

  it('rejects a JSON error body returned as blob with HTTP 200', async () => {
    // 关键场景：后端 200 + JSON 错误体。原 History.vue 的实现会漏判。
    const blob = new Blob([JSON.stringify({ error: '设备不存在' })], { type: '' })
    await expect(assertBinaryDownload(blob)).rejects.toThrow('设备不存在')
  })

  it('rejects a JSON error body even when Content-Type is empty', async () => {
    // 不能依赖 blob.type —— 这是原 ReportGenerator.vue 的漏洞
    const blob = new Blob([JSON.stringify({ message: '导出失败：无数据' })], { type: '' })
    await expect(assertBinaryDownload(blob)).rejects.toThrow('导出失败：无数据')
  })

  it('rejects a JSON error body mislabeled as octet-stream', async () => {
    const blob = new Blob([JSON.stringify({ error: '权限不足' })], {
      type: 'application/octet-stream',
    })
    await expect(assertBinaryDownload(blob)).rejects.toThrow('权限不足')
  })

  it('throws BlobContentError so callers can distinguish it', async () => {
    const blob = new Blob(['{"error":"x"}'], { type: '' })
    await expect(assertBinaryDownload(blob)).rejects.toBeInstanceOf(BlobContentError)
  })

  it('handles UTF-8 BOM before the JSON body', async () => {
    const blob = new Blob(['\uFEFF' + JSON.stringify({ error: '带 BOM 的错误' })], { type: '' })
    await expect(assertBinaryDownload(blob)).rejects.toThrow('带 BOM 的错误')
  })

  it('handles leading whitespace before the JSON body', async () => {
    const blob = new Blob(['  \n\t' + JSON.stringify({ error: '前导空白' })], { type: '' })
    await expect(assertBinaryDownload(blob)).rejects.toThrow('前导空白')
  })

  it('accepts an array-rooted CSV that happens to start with bracket', async () => {
    // 以 [ 开头但不是合法 JSON 的内容，应视为正常文件
    const blob = new Blob(['[not json at all'], { type: 'text/csv' })
    await expect(assertBinaryDownload(blob)).resolves.toBe(blob)
  })

  it('rejects a JSON array error body', async () => {
    const blob = new Blob([JSON.stringify([{ error: '批量失败' }])], { type: '' })
    await expect(assertBinaryDownload(blob)).rejects.toBeInstanceOf(BlobContentError)
  })

  it('rejects non-Blob input', async () => {
    await expect(assertBinaryDownload({ success: true, data: {} })).rejects.toThrow(
      /响应格式异常/,
    )
  })

  it('rejects null input', async () => {
    await expect(assertBinaryDownload(null)).rejects.toBeInstanceOf(BlobContentError)
  })

  it('rejects an empty file', async () => {
    // 0 字节既不是有效文件也拿不到错误信息，应明确失败而非下载空文件
    const blob = new Blob([], { type: 'text/csv' })
    await expect(assertBinaryDownload(blob)).rejects.toThrow(/空文件/)
  })

  it('accepts a binary blob with non-text content', async () => {
    // 模拟 Excel：内容是二进制字节，不应被当成 JSON
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01])
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    await expect(assertBinaryDownload(blob)).resolves.toBe(blob)
  })
})

describe('describeDownloadError', () => {
  it('passes through BlobContentError message', async () => {
    const err = new BlobContentError('设备不存在')
    await expect(describeDownloadError(err)).resolves.toBe('设备不存在')
  })

  it('unwraps a JSON error body held in error.response.data as Blob', async () => {
    // 这是 axios 真正 reject 的路径（HTTP 4xx/5xx + blob responseType）
    const err = { response: { data: new Blob([JSON.stringify({ error: '服务内部错误' })]) } }
    await expect(describeDownloadError(err)).resolves.toBe('服务内部错误')
  })

  it('reads message field as fallback', async () => {
    const err = { response: { data: new Blob([JSON.stringify({ message: '无权限' })]) } }
    await expect(describeDownloadError(err)).resolves.toBe('无权限')
  })

  it('falls back to error.message for non-JSON blob body', async () => {
    const err = { response: { data: new Blob(['plain text']) }, message: 'Request failed' }
    await expect(describeDownloadError(err)).resolves.toBe('Request failed')
  })

  it('reads plain object error body', async () => {
    const err = { response: { data: { error: '对象形式的错误' } } }
    await expect(describeDownloadError(err)).resolves.toBe('对象形式的错误')
  })

  it('falls back to generic message for unknown shapes', async () => {
    await expect(describeDownloadError({})).resolves.toBe('未知错误')
  })
})

