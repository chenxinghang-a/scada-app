import { ref, watch } from 'vue'

interface CacheEntry<T> {
  data: T
  timestamp: number
  expiry: number
}

interface CacheOptions {
  ttl?: number        // 缓存过期时间（毫秒），默认5分钟
  maxSize?: number    // 最大缓存条目数，默认100
  staleWhileRevalidate?: boolean  // 过期后仍返回旧数据，后台刷新
}

const caches = new Map<string, Map<string, CacheEntry<any>>>()

export function useCache<T>(namespace: string, options: CacheOptions = {}) {
  const {
    ttl = 5 * 60 * 1000,
    maxSize = 100,
    staleWhileRevalidate = true,
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
      // 已过期
      if (!staleWhileRevalidate) {
        cache.delete(key)
        return null
      }
      // 返回旧数据，但标记为需要刷新
      return entry.data
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
      const cached = get(key)
      if (cached !== null && !isStale(key)) {
        return cached
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
