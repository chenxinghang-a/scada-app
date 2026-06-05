/**
 * 请求重试 Composable
 * 指数退避 + 随机抖动，防止重试风暴雪崩。
 *
 * 用法:
 *   const { executeWithRetry } = useRetryRequest()
 *   const data = await executeWithRetry(() => api.get('/devices'), { maxRetries: 3 })
 */

import { ref } from 'vue'

interface RetryOptions {
  /** 最大重试次数 */
  maxRetries?: number
  /** 基础延迟（ms） */
  baseDelay?: number
  /** 最大延迟（ms） */
  maxDelay?: number
  /** 抖动系数 (0-1) */
  jitterFactor?: number
  /** 可重试的状态码 */
  retryableStatuses?: number[]
  /** 重试回调 */
  onRetry?: (attempt: number, error: any, delay: number) => void
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  jitterFactor: 0.3,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  onRetry: () => {},
}

export function useRetryRequest() {
  const isRetrying = ref(false)
  const retryCount = ref(0)

  /**
   * 计算退避延迟（指数退避 + 随机抖动）
   */
  function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
    // 指数退避: base * 2^attempt
    const exponential = options.baseDelay * Math.pow(2, attempt)
    // 限制最大延迟
    const capped = Math.min(exponential, options.maxDelay)
    // 添加随机抖动: delay * (1 ± jitter)
    const jitter = capped * options.jitterFactor * (Math.random() * 2 - 1)
    return Math.max(0, capped + jitter)
  }

  /**
   * 判断错误是否可重试
   */
  function isRetryable(error: any, options: Required<RetryOptions>): boolean {
    // 网络错误（无response）可重试
    if (!error.response) {
      return true
    }
    // 特定状态码可重试
    return options.retryableStatuses.includes(error.response?.status)
  }

  /**
   * 延迟
   */
  function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 执行带重试的请求
   */
  async function executeWithRetry<T>(
    fn: () => Promise<T>,
    userOptions?: RetryOptions
  ): Promise<T> {
    const options = { ...DEFAULT_OPTIONS, ...userOptions }
    let lastError: any

    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          isRetrying.value = true
          retryCount.value = attempt
        }

        const result = await fn()

        // 成功，重置状态
        isRetrying.value = false
        retryCount.value = 0
        return result
      } catch (error: any) {
        lastError = error

        // 最后一次尝试失败，不再重试
        if (attempt >= options.maxRetries) {
          break
        }

        // 不可重试的错误，直接抛出
        if (!isRetryable(error, options)) {
          break
        }

        // 计算延迟并等待
        const delay = calculateDelay(attempt, options)
        options.onRetry(attempt + 1, error, delay)
        await sleep(delay)
      }
    }

    isRetrying.value = false
    retryCount.value = 0
    throw lastError
  }

  /**
   * 创建带重试的请求函数
   */
  function withRetry<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    options?: RetryOptions
  ): T {
    return ((...args: any[]) => {
      return executeWithRetry(() => fn(...args), options)
    }) as T
  }

  return {
    /** 是否正在重试 */
    isRetrying,
    /** 当前重试次数 */
    retryCount,
    /** 执行带重试的请求 */
    executeWithRetry,
    /** 包装函数为带重试版本 */
    withRetry,
  }
}
