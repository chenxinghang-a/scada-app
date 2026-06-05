/**
 * 拖拽排序 Composable
 * 支持列表拖拽重排、跨列表拖拽、拖拽预览。
 *
 * 用法:
 *   const { items, dragHandlers, isDragging } = useDragSort(items)
 *   // 模板中: v-for="item in items" v-bind="dragHandlers(item)"
 */

import { ref, computed, type Ref } from 'vue'

interface DragState {
  dragging: any | null
  over: any | null
  overIndex: number
  dragIndex: number
}

export function useDragSort<T extends { id: string | number }>(
  items: Ref<T[]>,
  options: {
    onReorder?: (newItems: T[]) => void
    onDragStart?: (item: T) => void
    onDragEnd?: (item: T) => void
    disabled?: Ref<boolean>
  } = {}
) {
  const { onReorder, onDragStart, onDragEnd, disabled } = options

  const dragState = ref<DragState>({
    dragging: null,
    over: null,
    overIndex: -1,
    dragIndex: -1,
  })

  const isDragging = computed(() => dragState.value.dragging !== null)

  function getIndex(item: T): number {
    return items.value.findIndex(i => i.id === item.id)
  }

  function dragHandlers(item: T) {
    return {
      draggable: !disabled?.value,
      onDragstart: (e: DragEvent) => {
        if (disabled?.value) return
        dragState.value.dragging = item
        dragState.value.dragIndex = getIndex(item)
        onDragStart?.(item)

        // 设置拖拽预览
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', String(item.id))
        }
      },
      onDragover: (e: DragEvent) => {
        if (disabled?.value) return
        e.preventDefault()
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move'
        }

        const overItem = item
        if (overItem && dragState.value.dragging?.id !== overItem.id) {
          dragState.value.over = overItem
          dragState.value.overIndex = getIndex(overItem)
        }
      },
      onDragenter: (e: DragEvent) => {
        if (disabled?.value) return
        e.preventDefault()
        dragState.value.over = item
        dragState.value.overIndex = getIndex(item)
      },
      onDragleave: () => {
        if (disabled?.value) return
        if (dragState.value.over?.id === item.id) {
          dragState.value.over = null
          dragState.value.overIndex = -1
        }
      },
      onDrop: (e: DragEvent) => {
        if (disabled?.value) return
        e.preventDefault()

        const dragged = dragState.value.dragging
        const target = item

        if (dragged && target && dragged.id !== target.id) {
          const dragIdx = getIndex(dragged)
          const dropIdx = getIndex(target)

          if (dragIdx !== -1 && dropIdx !== -1) {
            const newItems = [...items.value]
            const [removed] = newItems.splice(dragIdx, 1)
            newItems.splice(dropIdx, 0, removed)
            items.value = newItems
            onReorder?.(newItems)
          }
        }

        resetDragState()
      },
      onDragend: () => {
        if (disabled?.value) return
        onDragEnd?.(item)
        resetDragState()
      },
    }
  }

  function resetDragState() {
    dragState.value = {
      dragging: null,
      over: null,
      overIndex: -1,
      dragIndex: -1,
    }
  }

  /** 移动项到指定位置 */
  function moveTo(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    const newItems = [...items.value]
    const [removed] = newItems.splice(fromIndex, 1)
    newItems.splice(toIndex, 0, removed)
    items.value = newItems
    onReorder?.(newItems)
  }

  /** 上移一项 */
  function moveUp(index: number) {
    if (index > 0) moveTo(index, index - 1)
  }

  /** 下移一项 */
  function moveDown(index: number) {
    if (index < items.value.length - 1) moveTo(index, index + 1)
  }

  /** 移到顶部 */
  function moveToTop(index: number) {
    moveTo(index, 0)
  }

  /** 移到底部 */
  function moveToBottom(index: number) {
    moveTo(index, items.value.length - 1)
  }

  /** 获取拖拽状态样式类 */
  function getItemClasses(item: T) {
    return {
      'is-dragging': dragState.value.dragging?.id === item.id,
      'is-over': dragState.value.over?.id === item.id && dragState.value.dragging?.id !== item.id,
    }
  }

  return {
    dragState,
    isDragging,
    dragHandlers,
    moveTo,
    moveUp,
    moveDown,
    moveToTop,
    moveToBottom,
    getItemClasses,
  }
}
