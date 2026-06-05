/**
 * 系统主题检测 Composable
 * 跟随操作系统深色/浅色模式自动切换。
 *
 * 用法:
 *   const { isDark, theme, setTheme } = useSystemTheme()
 */

import { ref, watch, onMounted, onUnmounted } from 'vue'

type ThemeMode = 'light' | 'dark' | 'system'

const themeMode = ref<ThemeMode>('system')
const isDark = ref(false)
let mediaQuery: MediaQueryList | null = null

function getSystemTheme(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(dark: boolean) {
  isDark.value = dark
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  document.documentElement.classList.toggle('dark', dark)
}

function handleSystemChange(e: MediaQueryListEvent) {
  if (themeMode.value === 'system') {
    applyTheme(e.matches)
  }
}

export function useSystemTheme() {
  function setTheme(mode: ThemeMode) {
    themeMode.value = mode
    localStorage.setItem('theme', mode)

    if (mode === 'system') {
      applyTheme(getSystemTheme())
    } else {
      applyTheme(mode === 'dark')
    }
  }

  function initTheme() {
    const saved = localStorage.getItem('theme') as ThemeMode | null
    if (saved) {
      themeMode.value = saved
    }

    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', handleSystemChange)

    if (themeMode.value === 'system') {
      applyTheme(getSystemTheme())
    } else {
      applyTheme(themeMode.value === 'dark')
    }
  }

  onMounted(() => {
    initTheme()
  })

  onUnmounted(() => {
    mediaQuery?.removeEventListener('change', handleSystemChange)
  })

  return {
    isDark,
    theme: themeMode,
    setTheme,
  }
}
