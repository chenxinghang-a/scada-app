/**
 * 组件错误恢复 Composable
 * 当组件渲染失败时自动重试，提供降级UI。
 *
 * 用法:
 *   const { errorCount, isRecovering, retry, reset } = useErrorRecovery({
 *     maxRetries: 3,
 *     onMaxRetries: () => showFallback()
 *   })
 */

import { ref, onErrorCaptured, onMounted } from 'vue'

interface ErrorRecoveryOptions {
  /** 最大重试次数 */
  maxRetries?: number
  /** 重试延迟（ms） */
  retryDelay?: number
  /** 达到最大重试次数回调 */
  onMaxRetries?: (error: Error) => void
  /** 错误回调 */
  onError?: (error: Error, attempt: number) => void
  /** 恢复回调 */
  onRecover?: () => void
}

export function useErrorRecovery(options: ErrorRecoveryOptions = {}) {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    onMaxRetries = () => {},
    onError = () => {},
    onRecover = () => {},
  } = options

  const errorCount = ref(0)
  const isRecovering = ref(false)
  const lastError = ref<Error | null>(null)
  const hasGivenUp = ref(false)

  let retryTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 重试渲染
   */
  function retry() {
    if (hasGivenUp.value) return

    isRecovering.value = true
    errorCount.value++
    lastError.value = null

    // 使用nextTick延迟重试，让Vue有时间清理
    retryTimer = setTimeout(() => {
      isRecovering.value = false
      onRecover()
    }, retryDelay)
  }

  /**
   * 重置状态
   */
  function reset() {
    errorCount.value = 0
    isRecovering.value = false
    lastError.value = null
    hasGivenUp.value = false
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  /**
   * 捕获子组件错误
   */
  onErrorCaptured((error: Error) => {
    lastError.value = error
    onError(error, errorCount.value + 1)

    if (errorCount.value >= maxRetries) {
      hasGivenUp.value = true
      onMaxRetries(error)
      return false // 阻止错误向上传播
    }

    retry()
    return false // 阻止错误向上传播
  })

  /**
   * 手动触发重试（用于用户点击重试按钮）
   */
  function manualRetry() {
    reset()
    retry()
  }

  return {
    /** 错误计数 */
    errorCount,
    /** 是否正在恢复 */
    isRecovering,
    /** 最后一次错误 */
    lastError,
    /** 是否已放弃重试 */
    hasGivenUp,
    /** 手动重试 */
    retry: manualRetry,
    /** 重置状态 */
    reset,
  }
}
