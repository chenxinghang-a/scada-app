/**
 * 列宽拖拽调整 Composable
 * 表格列宽拖拽调整+持久化。
 *
 * 用法:
 *   const { startResize, getColumnStyle, resetWidths } = useColumnResize('devices-table', columns)
 */

import { ref, computed, onMounted, onUnmounted } from 'vue'

interface ColumnConfig {
  key: string
  width?: number
  minWidth?: number
  maxWidth?: number
}

interface ResizeState {
  columnKey: string
  startX: number
  startWidth: number
}

const STORAGE_PREFIX = 'scada-colwidth:'
const MIN_WIDTH = 50
const MAX_WIDTH = 800

export function useColumnResize(
  tableId: string,
  columns: ColumnConfig[]
) {
  const storageKey = `${STORAGE_PREFIX}${tableId}`
  const widths = ref<Record<string, number>>({})
  const isResizing = ref(false)
  const resizeState = ref<ResizeState | null>(null)

  // 从存储恢复
  function loadWidths() {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        widths.value = JSON.parse(saved)
      }
    } catch {}
  }

  // 保存到存储
  function saveWidths() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(widths.value))
    } catch {}
  }

  // 获取列宽
  function getColumnWidth(col: ColumnConfig): number {
    return widths.value[col.key] || col.width || 150
  }

  // 获取列样式
  function getColumnStyle(col: ColumnConfig) {
    return {
      width: `${getColumnWidth(col)}px`,
      minWidth: `${col.minWidth || MIN_WIDTH}px`,
      maxWidth: `${col.maxWidth || MAX_WIDTH}px`,
      position: 'relative' as const,
    }
  }

  // 开始拖拽
  function startResize(event: MouseEvent, col: ColumnConfig) {
    event.preventDefault()
    isResizing.value = true
    resizeState.value = {
      columnKey: col.key,
      startX: event.clientX,
      startWidth: getColumnWidth(col),
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function onMouseMove(event: MouseEvent) {
    if (!resizeState.value) return

    const diff = event.clientX - resizeState.value.startX
    const col = columns.find(c => c.key === resizeState.value!.columnKey)
    if (!col) return

    const newWidth = Math.max(
      col.minWidth || MIN_WIDTH,
      Math.min(col.maxWidth || MAX_WIDTH, resizeState.value.startWidth + diff)
    )

    widths.value[resizeState.value.columnKey] = newWidth
  }

  function onMouseUp() {
    isResizing.value = false
    resizeState.value = null
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    saveWidths()
  }

  // 重置所有列宽
  function resetWidths() {
    widths.value = {}
    saveWidths()
  }

  // 获取resize handle样式
  const handleStyle = computed(() => ({
    position: 'absolute' as const,
    right: 0,
    top: 0,
    bottom: 0,
    width: '4px',
    cursor: 'col-resize',
    background: 'transparent',
    zIndex: 10,
  }))

  onMounted(loadWidths)

  return {
    widths,
    isResizing,
    getColumnWidth,
    getColumnStyle,
    startResize,
    resetWidths,
    handleStyle,
  }
}