/**
 * 批量操作 Composable
 * 支持列表项批量选中、批量删除、批量导出等操作。
 *
 * 用法:
 *   const { selected, toggle, selectAll, clearSelection, batchDelete, batchExport } = useBatchOperations()
 */

import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

export function useBatchOperations<T extends { id: string | number }>() {
  const selected = ref<Set<string | number>>(new Set())
  const isProcessing = ref(false)

  /** 选中数量 */
  const selectedCount = computed(() => selected.value.size)

  /** 是否有选中项 */
  const hasSelection = computed(() => selected.value.size > 0)

  /** 切换选中状态 */
  function toggle(id: string | number) {
    const newSet = new Set(selected.value)
    if (newSet.has(id)) {
      newSet.delete(id)
    } else {
      newSet.add(id)
    }
    selected.value = newSet
  }

  /** 选中/取消选中 */
  function select(id: string | number, state: boolean) {
    const newSet = new Set(selected.value)
    if (state) {
      newSet.add(id)
    } else {
      newSet.delete(id)
    }
    selected.value = newSet
  }

  /** 全选/取消全选 */
  function selectAll(items: T[], state?: boolean) {
    const shouldSelect = state ?? !isAllSelected(items)
    if (shouldSelect) {
      selected.value = new Set(items.map(i => i.id))
    } else {
      selected.value = new Set()
    }
  }

  /** 清除选中 */
  function clearSelection() {
    selected.value = new Set()
  }

  /** 是否全选 */
  function isAllSelected(items: T[]): boolean {
    return items.length > 0 && items.every(i => selected.value.has(i.id))
  }

  /** 是否部分选中 */
  function isIndeterminate(items: T[]): boolean {
    const sel = selected.value.size
    return sel > 0 && sel < items.length
  }

  /** 批量删除 */
  async function batchDelete(
    items: T[],
    deleteFn: (ids: (string | number)[]) => Promise<void>,
    options?: { confirmTitle?: string; successMessage?: string }
  ) {
    const ids = [...selected.value]
    if (ids.length === 0) return

    try {
      await ElMessageBox.confirm(
        `确定要删除选中的 ${ids.length} 项吗？`,
        options?.confirmTitle || '批量删除',
        { type: 'warning' }
      )
    } catch {
      return // 用户取消
    }

    isProcessing.value = true
    try {
      await deleteFn(ids)
      ElMessage.success(options?.successMessage || `成功删除 ${ids.length} 项`)
      clearSelection()
    } catch (e: any) {
      ElMessage.error(`批量删除失败: ${e.message || '未知错误'}`)
    } finally {
      isProcessing.value = false
    }
  }

  /** 批量导出 */
  async function batchExport(
    items: T[],
    exportFn: (ids: (string | number)[]) => Promise<void>,
    options?: { successMessage?: string }
  ) {
    const ids = [...selected.value]
    if (ids.length === 0) {
      ElMessage.warning('请先选择要导出的项目')
      return
    }

    isProcessing.value = true
    try {
      await exportFn(ids)
      ElMessage.success(options?.successMessage || `成功导出 ${ids.length} 项`)
    } catch (e: any) {
      ElMessage.error(`批量导出失败: ${e.message || '未知错误'}`)
    } finally {
      isProcessing.value = false
    }
  }

  /** 获取选中项 */
  function getSelectedItems(items: T[]): T[] {
    return items.filter(i => selected.value.has(i.id))
  }

  return {
    selected,
    selectedCount,
    hasSelection,
    isProcessing,
    toggle,
    select,
    selectAll,
    clearSelection,
    isAllSelected,
    isIndeterminate,
    batchDelete,
    batchExport,
    getSelectedItems,
  }
}
