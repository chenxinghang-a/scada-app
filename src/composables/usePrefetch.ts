/**
 * 数据预加载 Composable
 * 预测用户可能的下一步操作，提前加载数据。
 *
 * 用法:
 *   const { prefetch, clearCache, cacheSize } = usePrefetch()
 *   // 鼠标悬停时预加载
 *   @mouseenter="prefetch('/api/devices/1', () => deviceApi.getById(1))"
 */

import { ref, onUnmounted } from 'vue'

interface PrefetchEntry {
  data: any
  timestamp: number
  ttl: number
}

const cache = new Map<string, PrefetchEntry>()
const pending = new Map<string, Promise<any>>()
const MAX_CACHE_SIZE = 50

export function usePrefetch(defaultTtl: number = 30000) {
  /**
   * 预加载数据
   * @param key 缓存键
   * @param fetcher 数据获取函数
   * @param ttl 缓存有效期（ms）
   */
  async function prefetch(key: string, fetcher: () => Promise<any>, ttl: number = defaultTtl) {
    // 检查缓存
    const cached = cache.get(key)
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.data
    }

    // 检查是否已有进行中的请求
    if (pending.has(key)) {
      return pending.get(key)
    }

    // 发起预加载
    const promise = fetcher()
      .then(data => {
        // 缓存结果
        if (cache.size >= MAX_CACHE_SIZE) {
          // 删除最旧的条目
          const oldest = cache.keys().next().value
          if (oldest) cache.delete(oldest)
        }
        cache.set(key, { data, timestamp: Date.now(), ttl })
        return data
      })
      .catch(e => {
        // 预加载失败不报错
        console.debug(`[Prefetch] ${key} 失败:`, e)
        return null
      })
      .finally(() => {
        pending.delete(key)
      })

    pending.set(key, promise)
    return promise
  }

  /**
   * 获取预加载的数据（如果缓存中存在）
   */
  function getPrefetched(key: string): any | null {
    const cached = cache.get(key)
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.data
    }
    return null
  }

  /**
   * 清除缓存
   */
  function clearCache(key?: string) {
    if (key) {
      cache.delete(key)
    } else {
      cache.clear()
    }
  }

  /**
   * 缓存大小
   */
  const cacheSize = ref(cache.size)

  // 定期更新缓存大小
  const timer = setInterval(() => {
    cacheSize.value = cache.size
  }, 5000)

  onUnmounted(() => {
    clearInterval(timer)
  })

  return {
    prefetch,
    getPrefetched,
    clearCache,
    cacheSize,
  }
}

/**
 * 鼠标悬停预加载指令
 * 用法: v-prefetch="{ key: '/api/devices/1', handler: () => deviceApi.getById(1) }"
 */
export const vPrefetch = {
  mounted(el: HTMLElement, binding: any) {
    const { key, handler, delay = 200 } = binding.value || {}
    if (!key || !handler) return

    let timer: ReturnType<typeof setTimeout> | null = null

    el.addEventListener('mouseenter', () => {
      timer = setTimeout(() => {
        const cached = cache.get(key)
        if (!cached || Date.now() - cached.timestamp >= cached.ttl) {
          handler().catch(() => {})
        }
      }, delay)
    })

    el.addEventListener('mouseleave', () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    })
  },
}
