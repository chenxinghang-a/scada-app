/**
 * 虚拟无限滚动表格 Composable
 * 结合虚拟列表性能+无限滚动分页，适合大数据集。
 *
 * 用法:
 *   const { rows, containerRef, loadMore, isLoading, total } = useVirtualInfiniteTable(
 *     (page, size) => fetchDevices(page, size),
 *     { pageSize: 50, rowHeight: 48 }
 *   )
 */

import { ref, computed, onMounted, onUnmounted, type Ref } from 'vue'

interface VirtualInfiniteOptions {
  pageSize?: number
  rowHeight?: number
  overscan?: number
  threshold?: number
  maxRows?: number
}

interface LoadResult<T> {
  items: T[]
  total: number
  hasMore: boolean
}

export function useVirtualInfiniteTable<T = any>(
  fetcher: (page: number, pageSize: number) => Promise<LoadResult<T>>,
  options: VirtualInfiniteOptions = {}
) {
  const {
    pageSize = 50,
    rowHeight = 48,
    overscan = 5,
    threshold = 200,
    maxRows = 10000,
  } = options

  const rows = ref<T[]>([]) as Ref<T[]>
  const total = ref(0)
  const isLoading = ref(false)
  const hasMore = ref(true)
  const error = ref<string | null>(null)
  const containerRef = ref<HTMLElement | null>(null)

  let currentPage = 1
  let loadingTimer: ReturnType<typeof setTimeout> | null = null

  // 虚拟滚动状态
  const scrollTop = ref(0)
  const containerHeight = ref(600)

  const visibleRange = computed(() => {
    const start = Math.max(0, Math.floor(scrollTop.value / rowHeight) - overscan)
    const visibleCount = Math.ceil(containerHeight.value / rowHeight) + overscan * 2
    const end = Math.min(rows.value.length, start + visibleCount)
    return { start, end }
  })

  const visibleRows = computed(() => {
    const { start, end } = visibleRange.value
    return rows.value.slice(start, end).map((item, i) => ({
      item,
      index: start + i,
      style: {
        position: 'absolute' as const,
        top: `${(start + i) * rowHeight}px`,
        height: `${rowHeight}px`,
        width: '100%',
      },
    }))
  })

  const totalHeight = computed(() => rows.value.length * rowHeight)
  const offsetY = computed(() => visibleRange.value.start * rowHeight)

  async function loadMore() {
    if (isLoading.value || !hasMore.value) return

    isLoading.value = true
    error.value = null

    try {
      const result = await fetcher(currentPage, pageSize)

      if (currentPage === 1) {
        rows.value = result.items
      } else {
        rows.value = [...rows.value, ...result.items]
      }

      total.value = result.total
      hasMore.value = result.hasMore && rows.value.length < maxRows
      currentPage++
    } catch (e: any) {
      error.value = e.message || '加载失败'
    } finally {
      isLoading.value = false
    }
  }

  function onScroll(e: Event) {
    const target = e.target as HTMLElement
    scrollTop.value = target.scrollTop

    // 检查是否需要加载更多
    const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight
    if (distanceToBottom < threshold && hasMore.value && !isLoading.value) {
      loadMore()
    }
  }

  function reset() {
    rows.value = []
    total.value = 0
    hasMore.value = true
    currentPage = 1
    error.value = null
    scrollTop.value = 0
  }

  async function refresh() {
    reset()
    await loadMore()
  }

  function scrollToIndex(index: number) {
    if (containerRef.value) {
      containerRef.value.scrollTop = index * rowHeight
    }
  }

  onMounted(() => {
    if (containerRef.value) {
      containerRef.value.addEventListener('scroll', onScroll, { passive: true })
      containerHeight.value = containerRef.value.clientHeight
    }
    loadMore()
  })

  onUnmounted(() => {
    if (containerRef.value) {
      containerRef.value.removeEventListener('scroll', onScroll)
    }
    if (loadingTimer) clearTimeout(loadingTimer)
  })

  return {
    rows,
    total,
    isLoading,
    hasMore,
    error,
    containerRef,
    visibleRows,
    totalHeight,
    offsetY,
    loadMore,
    refresh,
    reset,
    scrollToIndex,
  }
}