/**
 * 组件状态持久化 Composable
 * 页面刷新后恢复组件状态（表单、滚动位置、展开状态等）。
 *
 * 用法:
 *   const { saveState, restoreState, clearState } = useStatePersistence('my-component')
 *   saveState({ form: formData, scroll: scrollTop })
 *   const saved = restoreState()
 */

import { ref, onUnmounted, watch } from 'vue'

interface PersistenceOptions {
  /** 存储类型 */
  storage?: 'local' | 'session'
  /** 过期时间（ms，0表示不过期） */
  ttl?: number
  /** 序列化方式 */
  serialize?: (value: any) => string
  /** 反序列化方式 */
  deserialize?: (value: string) => any
}

const DEFAULT_TTL = 30 * 60 * 1000 // 30分钟

export function useStatePersistence(
  componentId: string,
  options: PersistenceOptions = {}
) {
  const {
    storage = 'session',
    ttl = DEFAULT_TTL,
    serialize = JSON.stringify,
    deserialize = JSON.parse,
  } = options

  const storageKey = `scada-state:${componentId}`
  const isRestored = ref(false)

  function getStorage(): Storage {
    return storage === 'local' ? localStorage : sessionStorage
  }

  /** 保存状态 */
  function saveState(state: any): void {
    try {
      const entry = {
        data: state,
        timestamp: Date.now(),
        ttl,
      }
      getStorage().setItem(storageKey, serialize(entry))
    } catch (e) {
      console.warn(`[StatePersistence] 保存状态失败 (${componentId}):`, e)
    }
  }

  /** 恢复状态 */
  function restoreState<T = any>(): T | null {
    try {
      const stored = getStorage().getItem(storageKey)
      if (!stored) return null

      const entry = deserialize(stored)
      if (!entry || !entry.data) return null

      // 检查过期
      if (entry.ttl > 0 && Date.now() - entry.timestamp > entry.ttl) {
        clearState()
        return null
      }

      isRestored.value = true
      return entry.data as T
    } catch (e) {
      console.warn(`[StatePersistence] 恢复状态失败 (${componentId}):`, e)
      return null
    }
  }

  /** 清除状态 */
  function clearState(): void {
    try {
      getStorage().removeItem(storageKey)
    } catch {}
  }

  /** 自动保存（监听状态变化） */
  function autoSave(stateRef: any, delay: number = 500): void {
    let timer: ReturnType<typeof setTimeout> | null = null

    watch(
      stateRef,
      (newVal) => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => saveState(newVal), delay)
      },
      { deep: true }
    )

    onUnmounted(() => {
      if (timer) clearTimeout(timer)
    })
  }

  /** 保存滚动位置 */
  function saveScrollPosition(element: HTMLElement | null): void {
    if (!element) return
    const current = restoreState() || {}
    saveState({
      ...current,
      scroll: {
        top: element.scrollTop,
        left: element.scrollLeft,
      },
    })
  }

  /** 恢复滚动位置 */
  function restoreScrollPosition(element: HTMLElement | null): void {
    if (!element) return
    const saved = restoreState()
    if (saved?.scroll) {
      requestAnimationFrame(() => {
        element.scrollTop = saved.scroll.top
        element.scrollLeft = saved.scroll.left
      })
    }
  }

  /** 保存表单状态 */
  function saveFormState(formData: Record<string, any>): void {
    const current = restoreState() || {}
    saveState({
      ...current,
      form: formData,
    })
  }

  /** 恢复表单状态 */
  function restoreFormState<T extends Record<string, any>>(): T | null {
    const saved = restoreState()
    return saved?.form || null
  }

  return {
    isRestored,
    saveState,
    restoreState,
    clearState,
    autoSave,
    saveScrollPosition,
    restoreScrollPosition,
    saveFormState,
    restoreFormState,
  }
}
