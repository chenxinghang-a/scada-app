/**
 * 路由级代码分割+预取 Composable
 * 智能预取路由组件chunk，减少页面切换延迟。
 *
 * 用法:
 *   const { prefetchRoute, prefetchAdjacent, isPrefetched } = useRouteChunkPrefetch()
 *   prefetchRoute('/dashboard')
 */

import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'

interface PrefetchOptions {
  /** 预取优先级 */
  priority?: 'high' | 'low'
  /** 延迟预取（ms） */
  delay?: number
  /** 最大预取数量 */
  maxPrefetch?: number
}

const prefetchedRoutes = new Set<string>()
const prefetchPromises = new Map<string, Promise<any>>()

export function useRouteChunkPrefetch() {
  const router = useRouter()
  const isPrefetching = ref(false)
  const prefetchCount = ref(0)

  /** 预取单个路由 */
  async function prefetchRoute(path: string, options: PrefetchOptions = {}): Promise<boolean> {
    if (prefetchedRoutes.has(path)) return true
    if (prefetchPromises.has(path)) {
      await prefetchPromises.get(path)
      return true
    }

    const { priority = 'low', delay = 0 } = options

    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    const route = router.resolve(path)
    if (!route.matched.length) return false

    const promise = (async () => {
      try {
        isPrefetching.value = true

        // 预取所有组件
        const componentPromises = route.matched
          .flatMap(record => Object.values(record.components || {}))
          .filter((component): component is () => Promise<any> =>
            typeof component === 'function'
          )
          .map(component => component().catch(() => null))

        await Promise.all(componentPromises)
        prefetchedRoutes.add(path)
        prefetchCount.value++
        return true
      } catch {
        return false
      } finally {
        isPrefetching.value = false
        prefetchPromises.delete(path)
      }
    })()

    prefetchPromises.set(path, promise)
    return promise
  }

  /** 预取相邻路由 */
  function prefetchAdjacent(maxRoutes: number = 3): void {
    const currentPath = router.currentRoute.value.path
    const routes = router.getRoutes()

    // 找到当前路由的相邻路由
    const currentIndex = routes.findIndex(r => r.path === currentPath)
    if (currentIndex === -1) return

    const adjacentPaths: string[] = []

    // 前后各取几个路由
    for (let i = 1; i <= maxRoutes; i++) {
      if (currentIndex + i < routes.length) {
        adjacentPaths.push(routes[currentIndex + i].path)
      }
      if (currentIndex - i >= 0) {
        adjacentPaths.push(routes[currentIndex - i].path)
      }
    }

    // 延迟预取，避免阻塞当前页面
    adjacentPaths.forEach((path, index) => {
      prefetchRoute(path, { delay: 1000 + index * 500, priority: 'low' })
    })
  }

  /** 预取路由及其子路由 */
  async function prefetchRouteTree(path: string): Promise<void> {
    const route = router.resolve(path)
    if (!route.matched.length) return

    // 预取当前路由
    await prefetchRoute(path, { priority: 'high' })

    // 找到所有以该路径开头的子路由
    const childRoutes = router.getRoutes()
      .filter(r => r.path.startsWith(path + '/') && r.path !== path)

    // 预取前几个子路由
    const maxChildren = 5
    for (let i = 0; i < Math.min(childRoutes.length, maxChildren); i++) {
      await prefetchRoute(childRoutes[i].path, { delay: 200 * i })
    }
  }

  /** 检查路由是否已预取 */
  function isPrefetched(path: string): boolean {
    return prefetchedRoutes.has(path)
  }

  /** 获取预取统计 */
  const stats = computed(() => ({
    prefetchedCount: prefetchedRoutes.size,
    pendingCount: prefetchPromises.size,
    isPrefetching: isPrefetching.value,
  }))

  /** 清除预取缓存 */
  function clearPrefetchCache(): void {
    prefetchedRoutes.clear()
    prefetchPromises.clear()
    prefetchCount.value = 0
  }

  return {
    prefetchRoute,
    prefetchAdjacent,
    prefetchRouteTree,
    isPrefetched,
    isPrefetching,
    prefetchCount,
    stats,
    clearPrefetchCache,
  }
}
