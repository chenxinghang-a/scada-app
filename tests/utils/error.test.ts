/**
 * src/utils/error.ts 测试。
 *
 * 这是个"看起来没啥可测"的工具，但它决定了**所有页面**的报错文案：
 * 后端把 `error` 字段写成对象（`{"code": 4001, "message": "..."}`）时，
 * 老的模板拼接会显示 "[object Object]"，运维现场看到这种提示完全无从下手。
 * 所以这里钉的是**取值优先级**：
 *   response.data.error(对象要取 message) → response.data.message
 *   → e.message → String(e)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const H = vi.hoisted(() => ({ elError: vi.fn() }))

vi.mock('element-plus', () => ({
  ElMessage: { error: H.elError, success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

import { errorMessage, showActionError, logLoadError } from '@/utils/error'

function axiosError(status: number, data: unknown) {
  const e: any = new Error('Request failed with status code ' + status)
  e.response = { status, data }
  return e
}

beforeEach(() => {
  H.elError.mockClear()
})

describe('errorMessage 取值优先级', () => {
  it('优先使用 response.data.error（字符串）', () => {
    expect(errorMessage(axiosError(400, { error: '寄存器地址越界' }))).toBe('寄存器地址越界')
  })

  it('response.data.error 是对象时取内部 message，不出现 [object Object]', () => {
    const msg = errorMessage(axiosError(500, { error: { code: 4001, message: 'PLC 连接中断' } }))
    expect(msg).toBe('PLC 连接中断')
    expect(msg).not.toContain('[object Object]')
  })

  it('error 对象只有 error 字段时取它', () => {
    expect(errorMessage(axiosError(500, { error: { error: '采集器未启动' } }))).toBe('采集器未启动')
  })

  it('error 缺失时回落到 data.message', () => {
    expect(errorMessage(axiosError(500, { message: '数据库连接池耗尽' }))).toBe('数据库连接池耗尽')
  })

  it('error 为空字符串时继续回落到 data.message', () => {
    expect(errorMessage(axiosError(422, { error: '', message: '字段校验失败' }))).toBe('字段校验失败')
  })

  it('后端只给了数字/布尔值时也能显示', () => {
    expect(errorMessage(axiosError(400, { error: 4001 }))).toBe('4001')
    expect(errorMessage(axiosError(400, { error: false }))).toBe('false')
  })

  it('没有 response（网络错误）时用 Error.message', () => {
    expect(errorMessage(new Error('Network Error'))).toBe('Network Error')
  })

  it('response.data 不是对象时回落到 Error.message', () => {
    expect(errorMessage(axiosError(502, 'Bad Gateway'))).toBe('Request failed with status code 502')
  })

  it('普通对象带 message 时取 message', () => {
    expect(errorMessage({ message: '自定义错误' })).toBe('自定义错误')
  })

  it('字符串异常直接返回自身', () => {
    expect(errorMessage('直接抛的字符串')).toBe('直接抛的字符串')
  })

  it('数字异常转成字符串', () => {
    expect(errorMessage(404)).toBe('404')
  })

  it('嵌套的 error.response.data.error 坏成 null 时不崩', () => {
    expect(errorMessage(axiosError(500, { error: null, message: '兜底文案' }))).toBe('兜底文案')
  })
})

describe('showActionError', () => {
  let errSpy: any
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => errSpy.mockRestore())

  it('把操作名与后端文案拼成可读提示', () => {
    showActionError('保存配置', axiosError(400, { error: '参数不合法' }))
    expect(H.elError).toHaveBeenCalledWith('保存配置失败: 参数不合法')
  })

  it('同时把原始异常打到 console 便于排查（toast 会被用户关掉）', () => {
    const err = axiosError(500, { error: 'boom' })
    showActionError('下发指令', err)
    expect(errSpy).toHaveBeenCalled()
    expect(errSpy.mock.calls[0][1]).toBe(err)
  })
})

describe('logLoadError', () => {
  let warnSpy: any
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warnSpy.mockRestore())

  it('只写 warn 不弹 toast（轮询场景下弹窗会刷屏）', () => {
    logLoadError('设备列表', axiosError(500, { error: '查询超时' }))

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0][0])).toContain('设备列表')
    expect(String(warnSpy.mock.calls[0][0])).toContain('查询超时')
    expect(H.elError).not.toHaveBeenCalled()
  })
})
