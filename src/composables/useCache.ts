import { ref, watch } from 'vue'

interface CacheEntry<T> {
  data: T
  timestamp: number
  expiry: number
}

interface CacheOptions {
  ttl?: number        // 缓存过期时间（毫秒），默认5分钟
  maxSize?: number    // 最大缓存条目数，默认100
  /**
   * 过期后仍返回旧数据，并在后台刷新（Stale-While-Revalidate）。
   * 默认 false：get() 对过期条目返回 null，与 has()/isStale() 保持一致。
   * 仅影响 getOrFetch()，开启后它会在返回旧数据的同时触发后台刷新。
   */
  staleWhileRevalidate?: boolean
}

const caches = new Map<string, Map<string, CacheEntry<any>>>()

export function useCache<T>(namespace: string, options: CacheOptions = {}) {
  const {
    ttl = 5 * 60 * 1000,
    maxSize = 100,
    staleWhileRevalidate = false,
  } = options

  // 获取或创建命名空间缓存
  if (!caches.has(namespace)) {
    caches.set(namespace, new Map())
  }
  const cache = caches.get(namespace)!

  function get(key: string): T | null {
    const entry = cache.get(key)
    if (!entry) return null

    const now = Date.now()
    if (now > entry.expiry) {
      // 已过期：严格模式下清除并返回 null
      cache.delete(key)
      return null
    }

    return entry.data
  }

  function set(key: string, data: T): void {
    // 检查缓存大小限制
    if (cache.size >= maxSize) {
      // 删除最旧的条目
      const oldestKey = cache.keys().next().value
      if (oldestKey) cache.delete(oldestKey)
    }

    cache.set(key, {
      data,
      timestamp: Date.now(),
      expiry: Date.now() + ttl,
    })
  }

  function has(key: string): boolean {
    const entry = cache.get(key)
    if (!entry) return false
    return Date.now() <= entry.expiry
  }

  function isStale(key: string): boolean {
    const entry = cache.get(key)
    if (!entry) return true
    return Date.now() > entry.expiry
  }

  function remove(key: string): void {
    cache.delete(key)
  }

  function clear(): void {
    cache.clear()
  }

  function clearNamespace(): void {
    caches.delete(namespace)
  }

  // 带缓存的数据获取
  async function getOrFetch(
    key: string,
    fetcher: () => Promise<T>,
    forceRefresh = false
  ): Promise<T> {
    if (!forceRefresh) {
      const entry = cache.get(key)
      if (entry) {
        if (!isStale(key)) {
          return entry.data
        }
        if (staleWhileRevalidate) {
          // 先返回旧数据，后台静默刷新（失败不抛出，保留旧值）
          void fetcher()
            .then(fresh => set(key, fresh))
            .catch(() => { /* 后台刷新失败忽略，下次调用再试 */ })
          return entry.data
        }
      }
    }

    const data = await fetcher()
    set(key, data)
    return data
  }

  return {
    get,
    set,
    has,
    isStale,
    remove,
    clear,
    clearNamespace,
    getOrFetch,
  }
}

// 预定义的缓存命名空间
export const deviceCache = useCache<any[]>('devices', { ttl: 30000 })  // 30秒
export const alarmCache = useCache<any[]>('alarms', { ttl: 10000 })    // 10秒
export const configCache = useCache<any>('config', { ttl: 60000 })     // 1分钟
export const userCache = useCache<any>('users', { ttl: 300000 })       // 5分钟
