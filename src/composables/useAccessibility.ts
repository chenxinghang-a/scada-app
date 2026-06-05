/**
 * 无障碍增强 Composable
 * 提供 ARIA 标签、键盘导航、焦点管理等辅助功能。
 *
 * 用法:
 *   const { ariaLabel, trapFocus, announceToScreenReader } = useAccessibility()
 */

import { ref, onMounted, onUnmounted, type Ref } from 'vue'

export function useAccessibility() {
  /**
   * 生成 ARIA 标签属性
   */
  function ariaLabel(label: string) {
    return { 'aria-label': label }
  }

  function ariaDescribedBy(id: string) {
    return { 'aria-describedby': id }
  }

  function ariaRole(role: string) {
    return { role }
  }

  /**
   * 屏幕阅读器公告（创建临时 live region）
   */
  function announceToScreenReader(message: string, priority: 'polite' | 'assertive' = 'polite') {
    const el = document.createElement('div')
    el.setAttribute('aria-live', priority)
    el.setAttribute('aria-atomic', 'true')
    el.className = 'sr-only'
    el.style.cssText = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0;'
    document.body.appendChild(el)

    // 延迟设置内容，确保屏幕阅读器能捕获变化
    requestAnimationFrame(() => {
      el.textContent = message
      setTimeout(() => el.remove(), 3000)
    })
  }

  /**
   * 焦点陷阱（用于模态框/对话框）
   */
  function trapFocus(containerRef: Ref<HTMLElement | null>) {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab') return
      const container = containerRef.value
      if (!container) return

      const focusable = container.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    onMounted(() => {
      document.addEventListener('keydown', handleKeyDown)
    })

    onUnmounted(() => {
      document.removeEventListener('keydown', handleKeyDown)
    })
  }

  /**
   * ESC 键关闭处理
   */
  function onEscape(callback: () => void) {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        callback()
      }
    }

    onMounted(() => {
      document.addEventListener('keydown', handleKeyDown)
    })

    onUnmounted(() => {
      document.removeEventListener('keydown', handleKeyDown)
    })
  }

  /**
   * 键盘导航（上下左右 + Enter）
   */
  function keyboardNavigation(
    items: Ref<any[]>,
    onSelect: (item: any, index: number) => void,
    options: { orientation?: 'vertical' | 'horizontal' } = {}
  ) {
    const { orientation = 'vertical' } = options
    const activeIndex = ref(-1)

    function handleKeyDown(e: KeyboardEvent) {
      const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
      const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight'

      switch (e.key) {
        case prevKey:
          e.preventDefault()
          activeIndex.value = Math.max(0, activeIndex.value - 1)
          break
        case nextKey:
          e.preventDefault()
          activeIndex.value = Math.min(items.value.length - 1, activeIndex.value + 1)
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          if (activeIndex.value >= 0 && activeIndex.value < items.value.length) {
            onSelect(items.value[activeIndex.value], activeIndex.value)
          }
          break
        case 'Home':
          e.preventDefault()
          activeIndex.value = 0
          break
        case 'End':
          e.preventDefault()
          activeIndex.value = items.value.length - 1
          break
      }
    }

    return {
      activeIndex,
      handleKeyDown,
    }
  }

  /**
   * 减少动画偏好检测
   */
  function prefersReducedMotion(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  return {
    ariaLabel,
    ariaDescribedBy,
    ariaRole,
    announceToScreenReader,
    trapFocus,
    onEscape,
    keyboardNavigation,
    prefersReducedMotion,
  }
}
