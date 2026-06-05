/**
 * 表格列配置持久化 Composable
 * 用户自定义列显示/隐藏、排序、宽度，持久化到localStorage。
 *
 * 用法:
 *   const { columns, visibleColumns, toggleColumn, resetColumns } = useTableColumns('devices-table', defaultColumns)
 */

import { ref, computed, watch, type Ref } from 'vue'

interface ColumnConfig {
  key: string
  label: string
  visible: boolean
  width?: number
  order: number
  fixed?: boolean
}

interface StoredColumns {
  columns: ColumnConfig[]
  timestamp: number
}

const STORAGE_PREFIX = 'scada-columns:'
const MAX_AGE = 30 * 24 * 60 * 60 * 1000 // 30天

export function useTableColumns(
  tableId: string,
  defaultColumns: Array<{ key: string; label: string; visible?: boolean; width?: number; fixed?: boolean }>
) {
  const storageKey = STORAGE_PREFIX + tableId

  /** 初始化列配置 */
  function initColumns(): ColumnConfig[] {
    return defaultColumns.map((col, index) => ({
      key: col.key,
      label: col.label,
      visible: col.visible ?? true,
      width: col.width,
      order: index,
      fixed: col.fixed ?? false,
    }))
  }

  /** 从存储加载 */
  function loadFromStorage(): ColumnConfig[] | null {
    try {
      const stored = localStorage.getItem(storageKey)
      if (!stored) return null

      const data: StoredColumns = JSON.parse(stored)
      if (Date.now() - data.timestamp > MAX_AGE) {
        localStorage.removeItem(storageKey)
        return null
      }

      // 合并：保留存储的配置，添加新的默认列
      const storedKeys = new Set(data.columns.map(c => c.key))
      const merged = [...data.columns]

      for (const col of defaultColumns) {
        if (!storedKeys.has(col.key)) {
          merged.push({
            key: col.key,
            label: col.label,
            visible: col.visible ?? true,
            width: col.width,
            order: merged.length,
            fixed: col.fixed ?? false,
          })
        }
      }

      return merged
    } catch {
      return null
    }
  }

  /** 保存到存储 */
  function saveToStorage(cols: ColumnConfig[]) {
    try {
      const data: StoredColumns = {
        columns: cols,
        timestamp: Date.now(),
      }
      localStorage.setItem(storageKey, JSON.stringify(data))
    } catch {}
  }

  const columns = ref<ColumnConfig[]>(loadFromStorage() || initColumns())

  /** 可见列（按排序） */
  const visibleColumns = computed(() =>
    columns.value
      .filter(c => c.visible)
      .sort((a, b) => a.order - b.order)
  )

  /** 所有列（按排序） */
  const allColumns = computed(() =>
    [...columns.value].sort((a, b) => a.order - b.order)
  )

  /** 切换列可见性 */
  function toggleColumn(key: string) {
    const col = columns.value.find(c => c.key === key)
    if (col && !col.fixed) {
      col.visible = !col.visible
      saveToStorage(columns.value)
    }
  }

  /** 显示列 */
  function showColumn(key: string) {
    const col = columns.value.find(c => c.key === key)
    if (col) {
      col.visible = true
      saveToStorage(columns.value)
    }
  }

  /** 隐藏列 */
  function hideColumn(key: string) {
    const col = columns.value.find(c => c.key === key)
    if (col && !col.fixed) {
      col.visible = false
      saveToStorage(columns.value)
    }
  }

  /** 设置列宽度 */
  function setColumnWidth(key: string, width: number) {
    const col = columns.value.find(c => c.key === key)
    if (col) {
      col.width = Math.max(50, Math.min(1000, width))
      saveToStorage(columns.value)
    }
  }

  /** 移动列位置 */
  function moveColumn(fromIndex: number, toIndex: number) {
    const cols = [...columns.value]
    const [moved] = cols.splice(fromIndex, 1)
    cols.splice(toIndex, 0, moved)

    // 更新排序
    cols.forEach((col, index) => {
      col.order = index
    })

    columns.value = cols
    saveToStorage(cols)
  }

  /** 重置为默认配置 */
  function resetColumns() {
    columns.value = initColumns()
    saveToStorage(columns.value)
  }

  /** 显示所有列 */
  function showAllColumns() {
    columns.value.forEach(col => {
      col.visible = true
    })
    saveToStorage(columns.value)
  }

  /** 隐藏所有非固定列 */
  function hideAllColumns() {
    columns.value.forEach(col => {
      if (!col.fixed) {
        col.visible = false
      }
    })
    saveToStorage(columns.value)
  }

  /** 获取列样式 */
  function getColumnStyle(col: ColumnConfig) {
    return {
      width: col.width ? `${col.width}px` : undefined,
      minWidth: '50px',
    }
  }

  /** 检查是否有自定义配置 */
  const hasCustomConfig = computed(() => {
    const stored = localStorage.getItem(storageKey)
    return stored !== null
  })

  return {
    columns,
    visibleColumns,
    allColumns,
    hasCustomConfig,
    toggleColumn,
    showColumn,
    hideColumn,
    setColumnWidth,
    moveColumn,
    resetColumns,
    showAllColumns,
    hideAllColumns,
    getColumnStyle,
  }
}
