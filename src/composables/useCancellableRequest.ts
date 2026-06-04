/**
 * 可取消请求 composable
 * 用于组件卸载时自动取消未完成的请求，防止内存泄漏和状态异常
 */
import { ref, onUnmounted } from 'vue'

export function useCancellableRequest() {
  const abortController = ref<AbortController | null>(null)

  function createController(): AbortController {
    // 取消之前的请求
    if (abortController.value) {
      abortController.value.abort()
    }
    abortController.value = new AbortController()
    return abortController.value
  }

  function getSignal(): AbortSignal {
    if (!abortController.value) {
      createController()
    }
    return abortController.value!.signal
  }

  function cancel() {
    if (abortController.value) {
      abortController.value.abort()
      abortController.value = null
    }
  }

  // 组件卸载时自动取消
  onUnmounted(() => {
    cancel()
  })

  return {
    createController,
    getSignal,
    cancel,
    signal: getSignal,
  }
}
