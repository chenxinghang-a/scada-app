/**
 * ECharts主题适配 Composable
 * 根据系统深色/浅色模式自动切换ECharts主题。
 *
 * 用法:
 *   const { getTheme, getThemeColors, applyTheme } = useEChartsTheme()
 *   const chart = echarts.init(el, getTheme())
 */

import { computed, watch } from 'vue'
import { useSystemTheme } from './useSystemTheme'

// 浅色主题配置
const lightTheme = {
  backgroundColor: 'transparent',
  textStyle: { color: '#333' },
  title: { textStyle: { color: '#333' } },
  legend: { textStyle: { color: '#666' } },
  tooltip: {
    backgroundColor: '#fff',
    borderColor: '#e4e7ed',
    textStyle: { color: '#333' },
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: '#ddd' } },
    axisTick: { lineStyle: { color: '#ddd' } },
    axisLabel: { color: '#666' },
    splitLine: { lineStyle: { color: '#f0f0f0' } },
  },
  valueAxis: {
    axisLine: { lineStyle: { color: '#ddd' } },
    axisTick: { lineStyle: { color: '#ddd' } },
    axisLabel: { color: '#666' },
    splitLine: { lineStyle: { color: '#f0f0f0' } },
  },
}

// 深色主题配置
const darkTheme = {
  backgroundColor: 'transparent',
  textStyle: { color: '#ccc' },
  title: { textStyle: { color: '#eee' } },
  legend: { textStyle: { color: '#aaa' } },
  tooltip: {
    backgroundColor: '#2c2c2c',
    borderColor: '#444',
    textStyle: { color: '#eee' },
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: '#555' } },
    axisTick: { lineStyle: { color: '#555' } },
    axisLabel: { color: '#aaa' },
    splitLine: { lineStyle: { color: '#333' } },
  },
  valueAxis: {
    axisLine: { lineStyle: { color: '#555' } },
    axisTick: { lineStyle: { color: '#555' } },
    axisLabel: { color: '#aaa' },
    splitLine: { lineStyle: { color: '#333' } },
  },
}

// 配色方案
const lightColors = [
  '#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399',
  '#b37feb', '#36cfc9', '#ff85c0', '#ffc53d', '#73d13d',
]

const darkColors = [
  '#5B8FF9', '#5AD8A5', '#F6BD16', '#E86452', '#6DC8EC',
  '#945FB9', '#FF9845', '#1E9493', '#FF99C3', '#269A99',
]

export function useEChartsTheme() {
  const { isDark } = useSystemTheme()

  /** 获取当前主题名称 */
  const themeName = computed(() => isDark.value ? 'scada-dark' : 'scada-light')

  /** 获取当前主题配置 */
  const themeConfig = computed(() => isDark.value ? darkTheme : lightTheme)

  /** 获取当前配色方案 */
  const themeColors = computed(() => isDark.value ? darkColors : lightColors)

  /** 获取主题（用于echarts.init） */
  function getTheme(): string {
    return themeName.value
  }

  /** 获取主题颜色 */
  function getThemeColors(): string[] {
    return themeColors.value
  }

  /** 注册自定义主题到ECharts */
  function registerThemes(echarts: any) {
    echarts.registerTheme('scada-light', {
      color: lightColors,
      ...lightTheme,
    })
    echarts.registerTheme('scada-dark', {
      color: darkColors,
      ...darkTheme,
    })
  }

  /** 动态更新图表主题 */
  function applyTheme(chart: any) {
    if (!chart) return
    chart.dispose()
    // 需要重新init，ECharts不支持动态切换主题
    return themeName.value
  }

  return {
    isDark,
    themeName,
    themeConfig,
    themeColors,
    getTheme,
    getThemeColors,
    registerThemes,
    applyTheme,
  }
}
