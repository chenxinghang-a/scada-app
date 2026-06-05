/**
 * 主题变量 Composable
 * CSS变量+动态主题切换，支持自定义主题色。
 *
 * 用法:
 *   const { vars, setThemeColor, applyTheme } = useThemeVars()
 *   setThemeColor('primary', '#409EFF')
 */

import { ref, computed, watch, onMounted } from 'vue'
import { useSystemTheme } from './useSystemTheme'

interface ThemeColors {
  primary: string
  success: string
  warning: string
  danger: string
  info: string
  background: string
  surface: string
  text: string
  textSecondary: string
  border: string
  shadow: string
}

const LIGHT_COLORS: ThemeColors = {
  primary: '#409EFF',
  success: '#67C23A',
  warning: '#E6A23C',
  danger: '#F56C6C',
  info: '#909399',
  background: '#f5f7fa',
  surface: '#ffffff',
  text: '#303133',
  textSecondary: '#606266',
  border: '#dcdfe6',
  shadow: 'rgba(0, 0, 0, 0.1)',
}

const DARK_COLORS: ThemeColors = {
  primary: '#409EFF',
  success: '#67C23A',
  warning: '#E6A23C',
  danger: '#F56C6C',
  info: '#909399',
  background: '#1a1a2e',
  surface: '#16213e',
  text: '#e4e6eb',
  textSecondary: '#a8abb2',
  border: '#4c4d4f',
  shadow: 'rgba(0, 0, 0, 0.3)',
}

const STORAGE_KEY = 'scada-theme-colors'

export function useThemeVars() {
  const { isDark } = useSystemTheme()

  /** 从localStorage加载自定义颜色 */
  function loadCustomColors(): Partial<ThemeColors> {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? JSON.parse(stored) : {}
    } catch {
      return {}
    }
  }

  const customColors = ref<Partial<ThemeColors>>(loadCustomColors())

  /** 当前主题颜色（合并默认+自定义） */
  const colors = computed<ThemeColors>(() => {
    const base = isDark.value ? DARK_COLORS : LIGHT_COLORS
    return { ...base, ...customColors.value }
  })

  /** CSS变量映射 */
  const vars = computed(() => ({
    '--color-primary': colors.value.primary,
    '--color-success': colors.value.success,
    '--color-warning': colors.value.warning,
    '--color-danger': colors.value.danger,
    '--color-info': colors.value.info,
    '--color-bg': colors.value.background,
    '--color-surface': colors.value.surface,
    '--color-text': colors.value.text,
    '--color-text-secondary': colors.value.textSecondary,
    '--color-border': colors.value.border,
    '--color-shadow': colors.value.shadow,
    '--is-dark': isDark.value ? '1' : '0',
  }))

  /** 设置主题色 */
  function setThemeColor(key: keyof ThemeColors, value: string) {
    customColors.value = { ...customColors.value, [key]: value }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customColors.value))
    applyTheme()
  }

  /** 重置为默认主题 */
  function resetTheme() {
    customColors.value = {}
    localStorage.removeItem(STORAGE_KEY)
    applyTheme()
  }

  /** 应用主题到DOM */
  function applyTheme() {
    const root = document.documentElement
    const currentVars = vars.value
    for (const [key, value] of Object.entries(currentVars)) {
      root.style.setProperty(key, String(value))
    }
  }

  /** 预设主题 */
  const presets = {
    blue: { primary: '#409EFF' },
    green: { primary: '#67C23A' },
    purple: { primary: '#9c27b0' },
    orange: { primary: '#ff9800' },
    teal: { primary: '#009688' },
    red: { primary: '#f44336' },
  }

  /** 应用预设主题 */
  function applyPreset(name: keyof typeof presets) {
    const preset = presets[name]
    if (preset) {
      setThemeColor('primary', preset.primary)
    }
  }

  /** 获取当前主题名称 */
  const currentPreset = computed(() => {
    const primary = customColors.value.primary
    if (!primary) return 'default'
    for (const [name, preset] of Object.entries(presets)) {
      if (preset.primary === primary) return name
    }
    return 'custom'
  })

  // 自动应用主题
  watch(isDark, () => applyTheme(), { immediate: true })

  onMounted(() => {
    applyTheme()
  })

  return {
    colors,
    vars,
    isDark,
    customColors,
    currentPreset,
    presets,
    setThemeColor,
    resetTheme,
    applyTheme,
    applyPreset,
  }
}
