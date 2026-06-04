import { ref } from 'vue'

/**
 * 防抖Hook
 * @param fn 需要防抖的函数
 * @param delay 延迟时间（毫秒）
 */
export function useDebounce<T extends (...args: any[]) => any>(fn: T, delay: number = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null

  const debouncedFn = (...args: Parameters<T>) => {
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      fn(...args)
      timer = null
    }, delay)
  }

  const cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  return { debouncedFn, cancel }
}

/**
 * 防抖Ref
 * @param value 初始值
 * @param delay 延迟时间（毫秒）
 */
export function useDebouncedRef<T>(value: T, delay: number = 300) {
  const debouncedValue = ref(value)
  let timer: ReturnType<typeof setTimeout> | null = null

  const set = (newValue: T) => {
    if (timer) {
      clearTimeout(timer)
    }
    timer = setTimeout(() => {
      debouncedValue.value = newValue
      timer = null
    }, delay)
  }

  const cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  return { debouncedValue, set, cancel }
}

/**
 * 表单提交防抖Hook
 * @param submitFn 提交函数
 * @param delay 防抖时间（毫秒）
 */
export function useFormSubmit(submitFn: (...args: any[]) => Promise<any>, delay: number = 1000) {
  const loading = ref(false)
  let lastSubmitTime = 0

  const submit = async (...args: any[]) => {
    const now = Date.now()
    if (now - lastSubmitTime < delay) {
      return
    }

    if (loading.value) {
      return
    }

    loading.value = true
    lastSubmitTime = now

    try {
      await submitFn(...args)
    } finally {
      loading.value = false
    }
  }

  return { loading, submit }
}
