import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'

interface ShortcutConfig {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  action: () => void
  description: string
}

export function useKeyboard() {
  const router = useRouter()

  // 默认快捷键配置
  const shortcuts: ShortcutConfig[] = [
    {
      key: '1',
      alt: true,
      action: () => router.push('/dashboard'),
      description: '跳转到仪表盘',
    },
    {
      key: '2',
      alt: true,
      action: () => router.push('/devices'),
      description: '跳转到设备管理',
    },
    {
      key: '3',
      alt: true,
      action: () => router.push('/control'),
      description: '跳转到设备控制',
    },
    {
      key: '4',
      alt: true,
      action: () => router.push('/history'),
      description: '跳转到历史数据',
    },
    {
      key: '5',
      alt: true,
      action: () => router.push('/alarms'),
      description: '跳转到报警管理',
    },
    {
      key: 'd',
      alt: true,
      action: () => {
        document.documentElement.setAttribute(
          'data-theme',
          document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
        )
      },
      description: '切换深色/浅色模式',
    },
  ]

  // 处理键盘事件
  function handleKeydown(event: KeyboardEvent) {
    // 忽略输入框内的快捷键
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return
    }

    for (const shortcut of shortcuts) {
      const keyMatch = event.key.toLowerCase() === shortcut.key.toLowerCase()
      const ctrlMatch = shortcut.ctrl ? event.ctrlKey : true
      const altMatch = shortcut.alt ? event.altKey : true
      const shiftMatch = shortcut.shift ? event.shiftKey : true

      if (keyMatch && ctrlMatch && altMatch && shiftMatch) {
        event.preventDefault()
        shortcut.action()
        return
      }
    }
  }

  // 注册快捷键
  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })

  // 清理快捷键
  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
  })

  return {
    shortcuts,
  }
}
