/**
 * 导出接口（src/api/data.ts）的 blob 错误处理 —— 端到端契约测试。
 *
 * 为什么必须走**真实的 request.ts 拦截器**而不是直接调 assertBinaryDownload：
 *   真正的风险在两者之间 —— `responseType: 'blob'` 的响应，拦截器会先过一遍
 *   "success/data 信封解包"。如果哪天拦截器把 Blob 也当信封处理，或者在
 *   非 2xx 时把 Blob 错误体丢掉，那么"用户下载到一个名为 .csv 的报错文本"
 *   这个事故就会重新出现。用 mock adapter 驱动 api 实例能把整条链路钉住。
 *
 * 事故形态：后端返回 200 + `{"error":"设备不存在"}`（Content-Type 可能是
 * 空 / octet-stream），前端若直接下载，用户拿到一个假 CSV —— 直到打开才发现。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createMockAdapter } from '../helpers/mockAdapter'
import type { MockAdapter } from '../helpers/mockAdapter'
import { assertBinaryDownload, BlobContentError, describeDownloadError } from '@/utils/export'

const H = vi.hoisted(() => ({
  elError: vi.fn(),
  pushes: [] as any[],
  route: { value: { path: '/history', fullPath: '/history' } },
  store: { token: null as any, refreshToken: null as any, user: null as any },
}))

vi.mock('element-plus', () => ({
  ElMessage: { error: H.elError, success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))
vi.mock('@/router', () => ({
  default: {
    currentRoute: H.route,
    push: (a: any) => {
      H.pushes.push(a)
      return Promise.resolve()
    },
  },
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => H.store }))

let axios: any
let mock: MockAdapter
let dataApi: typeof import('@/api/data')['dataApi']

function jsonBlob(obj: unknown, type = ''): Blob {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj)
  return new Blob([body], type ? { type } : undefined)
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  H.pushes.length = 0
  H.elError.mockClear()

  axios = (await import('axios')).default
  mock = createMockAdapter()
  axios.defaults.adapter = mock.adapter

  const api = (await import('@/api/request')).default
  api.defaults.adapter = mock.adapter

  dataApi = (await import('@/api/data')).dataApi
})

describe('导出请求的契约（方法与参数）', () => {
  it('exportDevice 用 POST 且默认 format=csv', async () => {
    mock.setHandler(() => ({ status: 200, data: new Blob(['a,b\n1,2']) }))
    await dataApi.exportDevice('dev1')
    const call = mock.callsMatching('/export/device/dev1')[0]
    expect(call.method).toBe('post')
    expect(JSON.parse(call.data)).toEqual({ format: 'csv' })
  })

  it('excel / pdf 变体各自带上正确的 format', async () => {
    mock.setHandler(() => ({ status: 200, data: new Blob(['x']) }))
    await dataApi.exportDeviceExcel('dev1')
    await dataApi.exportDevicePDF('dev1')
    const calls = mock.callsMatching('/export/device/dev1')
    expect(JSON.parse(calls[0].data).format).toBe('excel')
    expect(JSON.parse(calls[1].data).format).toBe('pdf')
  })

  it('exportAlarms 打到 /export/alarms 且默认 csv', async () => {
    mock.setHandler(() => ({ status: 200, data: new Blob(['x']) }))
    await dataApi.exportAlarms({ start_time: '2026-01-01' })
    const call = mock.callsMatching('/export/alarms')[0]
    expect(call.method).toBe('post')
    expect(JSON.parse(call.data)).toEqual({ format: 'csv', start_time: '2026-01-01' })
  })

  it('responseType 必须是 blob（否则二进制文件会被当文本解析坏掉）', async () => {
    mock.setHandler(() => ({ status: 200, data: new Blob(['x']) }))
    await dataApi.exportDevice('dev1')
    expect(mock.callsMatching('/export/device/dev1')[0].config.responseType).toBe('blob')
  })
})

describe('正常导出', () => {
  it('返回的 Blob 能通过内容守卫，且内容未被拦截器改写', async () => {
    const csv = 'timestamp,value\n2026-09-20,25.5'
    mock.setHandler(() => ({ status: 200, data: new Blob([csv]) }))

    const blob = (await dataApi.exportDevice('dev1')) as unknown as Blob

    expect(blob).toBeInstanceOf(Blob)
    await expect(assertBinaryDownload(blob)).resolves.toBe(blob)
    expect(await blob.text()).toBe(csv)
  })

  it('PDF 这类二进制内容不会被误判成错误体', async () => {
    mock.setHandler(() => ({ status: 200, data: new Blob(['%PDF-1.7'], { type: 'application/pdf' }) }))
    const blob = (await dataApi.exportDevicePDF('dev1')) as unknown as Blob
    await expect(assertBinaryDownload(blob)).resolves.toBe(blob)
  })
})

describe('后端返回 JSON 错误体时不能当文件下载', () => {
  it('200 + {"error":...}：Blob 不被拦截器当信封解包，且内容守卫生效抛错', async () => {
    // 若拦截器错误地把 Blob 当信封，这里拿到的就不是 Blob 了
    mock.setHandler(() => ({ status: 200, data: jsonBlob({ error: '设备不存在' }) }))

    const blob = (await dataApi.exportDevice('dev1')) as unknown as Blob
    expect(blob).toBeInstanceOf(Blob)

    await expect(assertBinaryDownload(blob)).rejects.toBeInstanceOf(BlobContentError)
    await expect(assertBinaryDownload(blob)).rejects.toThrow('设备不存在')
  })

  it('错误体只有 message 字段时也能取出可读原因', async () => {
    mock.setHandler(() => ({ status: 200, data: jsonBlob({ message: '时间范围过大' }) }))
    const blob = (await dataApi.exportDevice('dev1')) as unknown as Blob
    await expect(assertBinaryDownload(blob)).rejects.toThrow('时间范围过大')
  })

  it('错误体未设置 Content-Type 时依然能识别（判据是内容而不是 type）', async () => {
    mock.setHandler(() => ({
      status: 200,
      data: jsonBlob('{"error":"导出服务未就绪"}', 'application/octet-stream'),
    }))
    const blob = (await dataApi.exportDevice('dev1')) as unknown as Blob
    await expect(assertBinaryDownload(blob)).rejects.toThrow('导出服务未就绪')
  })

  it('200 + 空文件：不能静默下载一个空 CSV', async () => {
    mock.setHandler(() => ({ status: 200, data: new Blob([]) }))
    const blob = (await dataApi.exportDevice('dev1')) as unknown as Blob
    await expect(assertBinaryDownload(blob)).rejects.toBeInstanceOf(BlobContentError)
  })

  it('5xx + Blob 错误体：请求被 reject，describeDownloadError 能解出后端文案', async () => {
    mock.setHandler(() => ({ status: 500, data: jsonBlob({ error: '存储层写入失败' }) }))

    let caught: any
    try {
      await dataApi.exportDevice('dev1')
    } catch (e) {
      caught = e
    }

    expect(caught).toBeTruthy()
    await expect(describeDownloadError(caught)).resolves.toBe('存储层写入失败')
  })

  it('5xx + Blob 错误体时不会把用户踢到登录页（导出失败不是会话问题）', async () => {
    mock.setHandler(() => ({ status: 500, data: jsonBlob({ error: 'boom' }) }))
    await dataApi.exportDevice('dev1').catch(() => {})
    expect(H.pushes).toEqual([])
  })
})
