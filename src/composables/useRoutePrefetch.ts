/**
 * 路由预加载策略 Composable
 * 智能预取相邻路由组件，减少页面切换延迟。
 *
 * 用法:
 *   const { prefetchRoute, prefetchAdjacent } = useRoutePrefetch()
 *   // 鼠标悬停时预加载
 *   @mouseenter="prefetchRoute('/dashboard')"
 *   // 自动预加载相邻路由
 *   prefetchAdjacent()
 */

import { useRouter, useRoute } from 'vue-router'

// 预加载缓存
const prefetched = new Set<string>()
const prefetching = new Map<string, Promise<any>>()

// 路由邻接关系（定义哪些路由应该互相预加载）
const ADJACENT_ROUTES: Record<string, string[]> = {
  '/dashboard': ['/devices', '/alarms', '/history'],
  '/devices': ['/control', '/dashboard', '/config'],
  '/control': ['/devices', '/dashboard'],
  '/history': ['/dashboard', '/devices'],
  '/alarms': ['/dashboard', '/devices'],
  '/config': ['/devices', '/dashboard'],
  '/industry40': ['/dashboard', '/devices'],
  '/users': ['/dashboard'],
}

export function useRoutePrefetch() {
  const router = useRouter()
  const route = useRoute()

  /** 预加载指定路由 */
  async function prefetchRoute(path: string): Promise<void> {
    if (prefetched.has(path)) return
    if (prefetching.has(path)) return prefetching.get(path)

    const matched = router.resolve(path)
    if (!matched.matched.length) return

    // 找到路由组件的加载函数
    const components = matched.matched
      .flatMap(record => Object.values(record.components || {}))
      .filter(comp => typeof comp === 'function')

    if (components.length === 0) return

    const promise = Promise.all(
      components.map(comp => (comp as Function)())
    ).then(() => {
      prefetched.add(path)
      prefetching.delete(path)
    }).catch(() => {
      prefetching.delete(path)
    })

    prefetching.set(path, promise)
    return promise
  }

  /** 预加载当前路由的相邻路由 */
  function prefetchAdjacent(): void {
    const currentPath = route.path
    const adjacent = ADJACENT_ROUTES[currentPath] || []

    // 延迟预加载，不阻塞当前页面
    setTimeout(() => {
      adjacent.forEach(path => {
        prefetchRoute(path)
      })
    }, 1000)
  }

  /** 鼠标悬停预加载指令 */
  function getPrefetchHandlers(path: string) {
    let timer: ReturnType<typeof setTimeout> | null = null

    return {
      onMouseenter: () => {
        timer = setTimeout(() => prefetchRoute(path), 200)
      },
      onMouseleave: () => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
      },
    }
  }

  /** 获取预加载状态 */
  function isPrefetched(path: string): boolean {
    return prefetched.has(path)
  }

  /** 清除预加载缓存 */
  function clearPrefetchCache(): void {
    prefetched.clear()
    prefetching.clear()
  }

  return {
    prefetchRoute,
    prefetchAdjacent,
    getPrefetchHandlers,
    isPrefetched,
    clearPrefetchCache,
  }
}
