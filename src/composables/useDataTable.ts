/**
 * 数据表格 Composable
 * 排序+筛选+分页组合，支持服务端和客户端模式。
 *
 * 用法:
 *   const { data, sort, filter, pagination, refresh } = useDataTable(fetchData, { pageSize: 20 })
 */

import { ref, computed, watch, type Ref } from 'vue'

interface SortConfig {
  key: string
  direction: 'asc' | 'desc'
}

interface FilterConfig {
  key: string
  value: any
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'startsWith' | 'endsWith' | 'in'
}

interface PaginationConfig {
  page: number
  pageSize: number
  total: number
}

interface DataTableOptions {
  pageSize?: number
  defaultSort?: SortConfig
  serverSide?: boolean
  debounceMs?: number
}

export function useDataTable<T = any>(
  fetcher: (params: {
    page: number
    pageSize: number
    sort?: SortConfig
    filters: FilterConfig[]
  }) => Promise<{ data: T[]; total: number }>,
  options: DataTableOptions = {}
) {
  const {
    pageSize = 20,
    defaultSort,
    serverSide = true,
    debounceMs = 300,
  } = options

  const data = ref<T[]>([]) as Ref<T[]>
  const isLoading = ref(false)
  const error = ref<any>(null)

  // 排序
  const sortConfig = ref<SortConfig | null>(defaultSort || null)

  // 筛选
  const filters = ref<FilterConfig[]>([])

  // 分页
  const pagination = ref<PaginationConfig>({
    page: 1,
    pageSize,
    total: 0,
  })

  // 计算属性
  const totalPages = computed(() =>
    Math.ceil(pagination.value.total / pagination.value.pageSize)
  )

  const hasPrev = computed(() => pagination.value.page > 1)
  const hasNext = computed(() => pagination.value.page < totalPages.value)

  // 客户端模式下的排序和筛选
  const filteredData = computed(() => {
    if (serverSide) return data.value

    let result = [...data.value]

    // 应用筛选
    for (const filter of filters.value) {
      result = result.filter(item => applyFilter(item, filter))
    }

    // 应用排序
    if (sortConfig.value) {
      result.sort((a, b) => compareSort(a, b, sortConfig.value!))
    }

    return result
  })

  const paginatedData = computed(() => {
    if (serverSide) return filteredData.value

    const start = (pagination.value.page - 1) * pagination.value.pageSize
    return filteredData.value.slice(start, start + pagination.value.pageSize)
  })

  // 加载数据
  async function loadData() {
    isLoading.value = true
    error.value = null

    try {
      const result = await fetcher({
        page: pagination.value.page,
        pageSize: pagination.value.pageSize,
        sort: sortConfig.value || undefined,
        filters: filters.value,
      })

      data.value = result.data
      pagination.value.total = result.total
    } catch (e) {
      error.value = e
    } finally {
      isLoading.value = false
    }
  }

  // 排序
  function sortBy(key: string) {
    if (sortConfig.value?.key === key) {
      sortConfig.value = {
        key,
        direction: sortConfig.value.direction === 'asc' ? 'desc' : 'asc',
      }
    } else {
      sortConfig.value = { key, direction: 'asc' }
    }

    pagination.value.page = 1
    if (serverSide) loadData()
  }

  function clearSort() {
    sortConfig.value = null
    if (serverSide) loadData()
  }

  // 筛选
  function addFilter(filter: FilterConfig) {
    const existing = filters.value.findIndex(f => f.key === filter.key)
    if (existing >= 0) {
      filters.value[existing] = filter
    } else {
      filters.value.push(filter)
    }
    pagination.value.page = 1
    if (serverSide) loadData()
  }

  function removeFilter(key: string) {
    filters.value = filters.value.filter(f => f.key !== key)
    pagination.value.page = 1
    if (serverSide) loadData()
  }

  function clearFilters() {
    filters.value = []
    pagination.value.page = 1
    if (serverSide) loadData()
  }

  // 分页
  function goToPage(page: number) {
    pagination.value.page = Math.max(1, Math.min(page, totalPages.value))
    if (serverSide) loadData()
  }

  function nextPage() {
    if (hasNext.value) goToPage(pagination.value.page + 1)
  }

  function prevPage() {
    if (hasPrev.value) goToPage(pagination.value.page - 1)
  }

  function setPageSize(size: number) {
    pagination.value.pageSize = size
    pagination.value.page = 1
    if (serverSide) loadData()
  }

  // 刷新
  function refresh() {
    loadData()
  }

  // 重置
  function reset() {
    sortConfig.value = defaultSort || null
    filters.value = []
    pagination.value.page = 1
    pagination.value.total = 0
    loadData()
  }

  return {
    data: paginatedData,
    allData: data,
    isLoading,
    error,
    sortConfig,
    filters,
    pagination,
    totalPages,
    hasPrev,
    hasNext,
    sortBy,
    clearSort,
    addFilter,
    removeFilter,
    clearFilters,
    goToPage,
    nextPage,
    prevPage,
    setPageSize,
    refresh,
    reset,
    loadData,
  }
}

/** 应用筛选条件 */
function applyFilter(item: any, filter: FilterConfig): boolean {
  const value = getNestedValue(item, filter.key)
  const filterValue = filter.value

  switch (filter.operator) {
    case 'eq': return value === filterValue
    case 'ne': return value !== filterValue
    case 'gt': return value > filterValue
    case 'lt': return value < filterValue
    case 'gte': return value >= filterValue
    case 'lte': return value <= filterValue
    case 'contains': return String(value).toLowerCase().includes(String(filterValue).toLowerCase())
    case 'startsWith': return String(value).toLowerCase().startsWith(String(filterValue).toLowerCase())
    case 'endsWith': return String(value).toLowerCase().endsWith(String(filterValue).toLowerCase())
    case 'in': return Array.isArray(filterValue) && filterValue.includes(value)
    default: return true
  }
}

/** 排序比较 */
function compareSort(a: any, b: any, sort: SortConfig): number {
  const valA = getNestedValue(a, sort.key)
  const valB = getNestedValue(b, sort.key)

  if (valA === valB) return 0
  if (valA === null || valA === undefined) return 1
  if (valB === null || valB === undefined) return -1

  const comparison = valA < valB ? -1 : 1
  return sort.direction === 'asc' ? comparison : -comparison
}

/** 获取嵌套值 */
function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => o?.[k], obj)
}
