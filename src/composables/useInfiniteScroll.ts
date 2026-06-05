/**
 * 无限滚动 Composable
 * 大数据集分段加载，滚动到底部自动加载更多。
 *
 * 用法:
 *   const { items, isLoading, hasMore, loadMore, reset } = useInfiniteScroll(
 *     (page) => fetchDevices(page),
 *     { pageSize: 20 }
 *   )
 */

import { ref, computed, onMounted, onUnmounted, type Ref } from 'vue'

interface InfiniteScrollOptions {
  /** 每页数量 */
  pageSize?: number
  /** 初始加载 */
  immediate?: boolean
  /** 距离底部多远触发加载（px） */
  threshold?: number
  /** 最大加载数量 */
  maxItems?: number
  /** 加载回调 */
  onLoad?: (items: any[]) => void
}

export function useInfiniteScroll<T = any>(
  fetcher: (page: number, pageSize: number) => Promise<T[]>,
  options: InfiniteScrollOptions = {}
) {
  const {
    pageSize = 20,
    immediate = true,
    threshold = 100,
    maxItems = 1000,
    onLoad,
  } = options

  const items = ref<T[]>([]) as Ref<T[]>
  const isLoading = ref(false)
  const hasMore = ref(true)
  const currentPage = ref(1)
  const error = ref<any>(null)
  const totalLoaded = ref(0)

  let observer: IntersectionObserver | null = null
  let sentinelElement: HTMLElement | null = null

  /** 加载更多 */
  async function loadMore(): Promise<void> {
    if (isLoading.value || !hasMore.value) return

    if (totalLoaded.value >= maxItems) {
      hasMore.value = false
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const newItems = await fetcher(currentPage.value, pageSize)

      if (newItems.length === 0) {
        hasMore.value = false
      } else {
        items.value = [...items.value, ...newItems]
        totalLoaded.value += newItems.length
        currentPage.value++

        if (newItems.length < pageSize) {
          hasMore.value = false
        }

        onLoad?.(newItems)
      }
    } catch (e) {
      error.value = e
      console.error('[InfiniteScroll] 加载失败:', e)
    } finally {
      isLoading.value = false
    }
  }

  /** 重置 */
  function reset(): void {
    items.value = []
    currentPage.value = 1
    hasMore.value = true
    totalLoaded.value = 0
    error.value = null
  }

  /** 刷新（重置后重新加载） */
  async function refresh(): Promise<void> {
    reset()
    await loadMore()
  }

  /** 设置哨兵元素（用于IntersectionObserver） */
  function setSentinel(element: HTMLElement | null): void {
    if (observer) {
      observer.disconnect()
    }

    sentinelElement = element

    if (element) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore.value && !isLoading.value) {
            loadMore()
          }
        },
        { threshold: 0.1 }
      )
      observer.observe(element)
    }
  }

  /** 滚动事件处理器 */
  function handleScroll(event: Event): void {
    const target = event.target as HTMLElement
    if (!target) return

    const { scrollTop, scrollHeight, clientHeight } = target
    const distanceToBottom = scrollHeight - scrollTop - clientHeight

    if (distanceToBottom < threshold && hasMore.value && !isLoading.value) {
      loadMore()
    }
  }

  /** 绑定到滚动容器 */
  function bindToContainer(container: HTMLElement | null): void {
    if (container) {
      container.addEventListener('scroll', handleScroll, { passive: true })
    }
  }

  /** 获取加载状态信息 */
  const statusInfo = computed(() => ({
    loaded: totalLoaded.value,
    hasMore: hasMore.value,
    isLoading: isLoading.value,
    page: currentPage.value,
  }))

  onMounted(() => {
    if (immediate) {
      loadMore()
    }
  })

  onUnmounted(() => {
    if (observer) {
      observer.disconnect()
    }
  })

  return {
    items,
    isLoading,
    hasMore,
    error,
    currentPage,
    totalLoaded,
    statusInfo,
    loadMore,
    reset,
    refresh,
    setSentinel,
    bindToContainer,
  }
}
