/**
 * 无第三方依赖的 axios 测试适配器。
 *
 * 为什么不用 axios-mock-adapter：
 *   - 该项目禁止改动 package.json，无法新增测试依赖；
 *   - axios 本身支持 `config.adapter`，自定义实现足够覆盖我们需要的场景。
 *
 * 关键点在 **status >= 400 时要抛出带 `.response` 的 AxiosError**：
 * 真实 HTTP adapter 是通过 `settle()` 做这件事的，自定义 adapter 若不抛，
 * 响应拦截器的 `error.response` 分支永远不会被执行 —— 那样测出来的
 * "通过"是假的。
 */

import { AxiosError, CanceledError, AxiosHeaders } from 'axios'
import type { AxiosRequestConfig, AxiosResponse } from 'axios'

/** 记录一次适配器调用，便于断言"到底发了几次请求" */
export interface RecordedCall {
  url: string
  method: string
  config: AxiosRequestConfig
  data: any
}

/** 适配器要返回的东西 */
export interface MockReply {
  status?: number
  data?: any
  headers?: Record<string, string>
  /** true → 模拟网络不可达（无 response 的 AxiosError），用于触发重试分支 */
  networkError?: boolean
  /** true → 模拟请求被主动取消（CanceledError） */
  cancel?: boolean
}

/** 处理函数可以是同步的，也可以返回 pending promise（用来精确控制并发时序） */
export type MockHandler = (config: AxiosRequestConfig) => MockReply | Promise<MockReply>

function codeFor(status: number): string {
  if (status >= 500) return AxiosError.ERR_BAD_RESPONSE
  if (status === 401) return AxiosError.ERR_BAD_REQUEST
  return AxiosError.ERR_BAD_REQUEST
}

export interface MockAdapter {
  adapter: (config: AxiosRequestConfig) => Promise<AxiosResponse>
  /** 全部调用记录（含 axios 直连的 CSRF / refresh 请求），按发生顺序 */
  calls: RecordedCall[]
  setHandler: (h: MockHandler) => void
  /** 按 URL 子串过滤调用记录 */
  callsMatching: (substr: string) => RecordedCall[]
  /** 按 URL 子串统计调用次数 */
  countMatching: (substr: string) => number
  reset: () => void
}

export function createMockAdapter(): MockAdapter {
  const calls: RecordedCall[] = []
  let handler: MockHandler = () => ({ status: 200, data: {} })

  const adapter = async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
    const record: RecordedCall = {
      url: String(config.url ?? ''),
      method: String(config.method || 'get').toLowerCase(),
      config,
      data: config.data,
    }
    calls.push(record)

    const reply = await handler(config)

    if (reply.cancel) {
      // axios.isCancel 依赖 __CANCEL__ 标记
      throw new CanceledError('canceled', config as any)
    }

    const status = reply.status ?? 200

    if (reply.networkError || status === 0) {
      throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config as any)
    }

    const response = {
      data: reply.data,
      status,
      statusText: '',
      headers: (reply.headers ?? {}) as any,
      config: config as any,
      request: {},
    } as AxiosResponse

    if (status >= 200 && status < 300) return response

    // 与 axios 内置 settle() 行为对齐：非 2xx 必须以 AxiosError 形式 reject，
    // 且 response 挂在上面对应的字段上，拦截器才能读到 status / data。
    throw new AxiosError(
      `Request failed with status code ${status}`,
      codeFor(status),
      config as any,
      {},
      response
    )
  }

  const callsMatching = (substr: string) => calls.filter(c => c.url.includes(substr))

  return {
    adapter,
    calls,
    setHandler(h: MockHandler) {
      handler = h
    },
    callsMatching,
    countMatching: (substr: string) => callsMatching(substr).length,
    reset() {
      calls.length = 0
      handler = () => ({ status: 200, data: {} })
    },
  }
}

/** 创建一个可手动 settle 的 deferred，用于制造"并发"时序 */
export function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: any) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** 让出若干个微任务周期，等待原生 promise 链推进 */
export async function flushMicrotasks(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve()
}

export { AxiosHeaders }
