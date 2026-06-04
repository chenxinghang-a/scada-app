/**
 * 统一loading状态管理
 * 避免每个视图重复定义loading ref
 */
import { ref, readonly } from 'vue'

export function useLoading(initialState = false) {
  const loading = ref(initialState)
  const error = ref<string | null>(null)

  async function withLoading<T>(fn: () => Promise<T>): Promise<T | undefined> {
    loading.value = true
    error.value = null
    try {
      return await fn()
    } catch (e: any) {
      error.value = e?.message || '操作失败'
      throw e
    } finally {
      loading.value = false
    }
  }

  function startLoading() {
    loading.value = true
    error.value = null
  }

  function stopLoading() {
    loading.value = false
  }

  return {
    loading: readonly(loading),
    error: readonly(error),
    withLoading,
    startLoading,
    stopLoading,
  }
}
