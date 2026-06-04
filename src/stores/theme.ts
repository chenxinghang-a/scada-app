import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export const useThemeStore = defineStore('theme', () => {
  // 从localStorage读取主题设置，默认浅色
  const isDark = ref(localStorage.getItem('scada_theme') === 'dark')

  // 切换主题
  function toggleTheme() {
    isDark.value = !isDark.value
  }

  // 设置主题
  function setTheme(dark: boolean) {
    isDark.value = dark
  }

  // 监听变化并应用
  watch(isDark, (dark) => {
    localStorage.setItem('scada_theme', dark ? 'dark' : 'light')
    applyTheme(dark)
  }, { immediate: true })

  // 应用主题到DOM
  function applyTheme(dark: boolean) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  }

  return {
    isDark,
    toggleTheme,
    setTheme,
  }
})
