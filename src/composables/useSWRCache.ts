/**
 * Stale-While-Revalidate 缓存策略
 * 先返回缓存中的旧数据（立即显示），同时后台请求新数据刷新。
 *
 * 用法:
 *   const { data, error, isValidating, mutate } = useSWRCache(
 *     '/api/devices',
 *     () => deviceApi.getAll(),
 *     { staleTime: 5000, revalidateOnFocus: true }
 *   )
 */

import { ref, watch, onUnmounted, type Ref } from 'vue'

interface SWROptions {
  /** 数据过期时间（ms），过期后仍返回旧数据但触发后台刷新 */
  staleTime?: number
  /** 缓存最大生存时间（ms），超过后删除缓存 */
  cacheTime?: number
  /** 窗口获得焦点时重新验证 */
  revalidateOnFocus?: boolean
  /** 网络恢复时重新验证 */
  revalidateOnReconnect?: boolean
  /** 重新验证间隔（ms，0表示不定时刷新） */
  refreshInterval?: number
  /** 错误重试次数 */
  retryCount?: number
  /** 错误重试间隔（ms） */
  retryDelay?: number
  /** 成功回调 */
  onSuccess?: (data: any) => void
  /** 错误回调 */
  onError?: (error: any) => void
}

interface CacheEntry {
  data: any
  timestamp: number
  error: any
}

// 全局缓存存储
const cache = new Map<string, CacheEntry>()
const listeners = new Map<string, Set<(entry: CacheEntry) => void>>()

export function useSWRCache<T = any>(
  key: string,
  fetcher: () => Promise<T>,
  options: SWROptions = {}
) {
  const {
    staleTime = 5000,
    cacheTime = 5 * 60 * 1000,
    revalidateOnFocus = true,
    revalidateOnReconnect = true,
    refreshInterval = 0,
    retryCount = 3,
    retryDelay = 1000,
    onSuccess,
    onError,
  } = options

  const data = ref<T | null>(null) as Ref<T | null>
  const error = ref<any>(null)
  const isValidating = ref(false)
  const isStale = ref(false)

  let refreshTimer: ReturnType<typeof setInterval> | null = null
  let mounted = true

  /** 获取缓存 */
  function getCached(): CacheEntry | null {
    const entry = cache.get(key)
    if (!entry) return null

    // 检查缓存是否过期
    if (Date.now() - entry.timestamp > cacheTime) {
      cache.delete(key)
      return null
    }

    return entry
  }

  /** 设置缓存 */
  function setCache(newData: T, newError: any = null) {
    const entry: CacheEntry = {
      data: newData,
      timestamp: Date.now(),
      error: newError,
    }
    cache.set(key, entry)

    // 通知监听者
    const keyListeners = listeners.get(key)
    if (keyListeners) {
      keyListeners.forEach(fn => fn(entry))
    }
  }

  /** 验证数据 */
  async function revalidate(): Promise<void> {
    if (!mounted) return

    isValidating.value = true

    let retries = 0
    while (retries <= retryCount) {
      try {
        const newData = await fetcher()
        if (!mounted) return

        setCache(newData)
        data.value = newData
        error.value = null
        isStale.value = false
        onSuccess?.(newData)
        return
      } catch (e) {
        retries++
        if (retries > retryCount) {
          if (!mounted) return
          error.value = e
          onError?.(e)
          return
        }
        await new Promise(r => setTimeout(r, retryDelay * retries))
      }
    }

    if (mounted) {
      isValidating.value = false
    }
  }

  /** 手动更新缓存 */
  function mutate(newData?: T, shouldRevalidate = true) {
    if (newData !== undefined) {
      setCache(newData)
      data.value = newData
      error.value = null
    }

    if (shouldRevalidate) {
      revalidate()
    }
  }

  /** 初始化 */
  function initialize() {
    const cached = getCached()

    if (cached) {
      data.value = cached.data
      error.value = cached.error

      // 检查是否过期
      const age = Date.now() - cached.timestamp
      if (age > staleTime) {
        isStale.value = true
        revalidate()
      }
    } else {
      revalidate()
    }

    // 定时刷新
    if (refreshInterval > 0) {
      refreshTimer = setInterval(() => {
        revalidate()
      }, refreshInterval)
    }

    // 注册监听者
    if (!listeners.has(key)) {
      listeners.set(key, new Set())
    }
    listeners.get(key)!.handleCacheUpdate = (entry: CacheEntry) => {
      if (mounted) {
        data.value = entry.data
        error.value = entry.error
      }
    }
    listeners.get(key)!.add(listeners.get(key)!.handleCacheUpdate)

    // 焦点重新验证
    if (revalidateOnFocus) {
      window.addEventListener('focus', handleFocus)
    }

    // 网络恢复重新验证
    if (revalidateOnReconnect) {
      window.addEventListener('online', handleOnline)
    }
  }

  function handleFocus() {
    const cached = getCached()
    if (cached && Date.now() - cached.timestamp > staleTime) {
      revalidate()
    }
  }

  function handleOnline() {
    revalidate()
  }

  // 清理
  onUnmounted(() => {
    mounted = false

    if (refreshTimer) {
      clearInterval(refreshTimer)
    }

    window.removeEventListener('focus', handleFocus)
    window.removeEventListener('online', handleOnline)

    // 延迟删除缓存
    setTimeout(() => {
      const keyListeners = listeners.get(key)
      if (keyListeners && keyListeners.handleCacheUpdate) {
        keyListeners.delete(keyListeners.handleCacheUpdate)
      }
    }, cacheTime)
  })

  initialize()

  return {
    data,
    error,
    isValidating,
    isStale,
    mutate,
    revalidate,
  }
}

/** 清除所有缓存 */
export function clearSWRCache() {
  cache.clear()
}

/** 清除指定key缓存 */
export function clearSWRCacheKey(key: string) {
  cache.delete(key)
}
