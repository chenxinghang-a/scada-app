/**
 * SmartSCADA 统一 ECharts 主题
 * ============================
 * 目的：消除各页面图表"各画各的"——坐标轴、网格、字体、色板、提示框全部统一。
 * 色板与 src/styles/design-tokens.css 的 --chart-1..8 保持一致（canvas 内无法直接
 * 使用 CSS 变量，故此处以常量镜像；两边改动需同步）。
 *
 * 用法：
 *   import { registerScadaTheme, scadaThemeName } from '@/utils/echartsTheme'
 *   registerScadaTheme(echarts)                 // 应用启动时注册一次
 *   const chart = echarts.init(el, scadaThemeName())   // 按当前主题初始化
 *
 * 主题切换：
 *   import { applyScadaTheme } from '@/utils/echartsTheme'
 *   applyScadaTheme(chart)                      // 重新 init 并保留 option
 */

/** 与 design-tokens.css 的 --chart-1..8 同步（色盲可辨顺序） */
export const SCADA_CHART_COLORS = [
  '#2563eb',
  '#f59e0b',
  '#0891b2',
  '#7c3aed',
  '#16a34a',
  '#db2777',
  '#65a30d',
  '#64748b',
]

/** 报警等级色（与后端 alarm_level 对齐） */
export const SCADA_LEVEL_COLORS: Record<string, string> = {
  critical: '#dc2626',
  warning: '#d97706',
  info: '#0891b2',
}

interface ScadaThemeVars {
  dark: boolean
  text: string
  textMuted: string
  grid: string
  gridStrong: string
  surface: string
  tooltipBg: string
  tooltipText: string
  axisLine: string
}

const LIGHT: ScadaThemeVars = {
  dark: false,
  text: '#0f172a',
  textMuted: '#64748b',
  grid: '#e2e8f0',
  gridStrong: '#cbd5e1',
  surface: '#ffffff',
  tooltipBg: 'rgba(15,23,42,0.92)',
  tooltipText: '#f8fafc',
  axisLine: '#cbd5e1',
}

const DARK: ScadaThemeVars = {
  dark: true,
  text: '#e8edf5',
  textMuted: '#8091a8',
  grid: '#263148',
  gridStrong: '#33405c',
  surface: '#131c2e',
  tooltipBg: 'rgba(232,237,245,0.94)',
  tooltipText: '#0b1220',
  axisLine: '#33405c',
}

function buildTheme(v: ScadaThemeVars) {
  const axis = {
    axisLine: { show: true, lineStyle: { color: v.axisLine, width: 1 } },
    axisTick: { show: false },
    axisLabel: {
      color: v.textMuted,
      fontSize: 12,
      fontFamily: 'Inter, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
    },
    splitLine: { show: true, lineStyle: { color: v.grid, width: 1, type: 'solid' as const } },
    splitArea: { show: false },
    nameTextStyle: { color: v.textMuted, fontSize: 12 },
  }

  return {
    color: SCADA_CHART_COLORS,
    backgroundColor: 'transparent',
    textStyle: {
      fontFamily: 'Inter, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
      color: v.text,
      fontSize: 13,
    },
    title: {
      textStyle: { color: v.text, fontSize: 15, fontWeight: 600 },
      subtextStyle: { color: v.textMuted, fontSize: 12 },
    },
    legend: {
      textStyle: { color: v.textMuted, fontSize: 12 },
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 14,
    },
    tooltip: {
      backgroundColor: v.tooltipBg,
      borderWidth: 0,
      padding: [8, 12],
      textStyle: { color: v.tooltipText, fontSize: 12 },
      axisPointer: {
        lineStyle: { color: v.gridStrong, type: 'dashed' as const },
        crossStyle: { color: v.gridStrong, type: 'dashed' as const },
        label: { backgroundColor: v.gridStrong },
      },
    },
    grid: {
      left: 12,
      right: 16,
      top: 32,
      bottom: 8,
      containLabel: true,
    },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: axis,
    timeAxis: axis,
    logAxis: axis,
    line: {
      symbol: 'none',
      smooth: false,
      lineStyle: { width: 2 },
      emphasis: { focus: 'series' as const },
    },
    bar: {
      itemStyle: { borderRadius: [3, 3, 0, 0] },
      emphasis: { focus: 'series' as const },
    },
    pie: {
      itemStyle: { borderColor: v.surface, borderWidth: 2 },
      label: { color: v.text },
      labelLine: { lineStyle: { color: v.axisLine } },
    },
    gauge: {
      axisLine: { lineStyle: { width: 12 } },
      splitLine: { lineStyle: { color: v.grid } },
      axisLabel: { color: v.textMuted, fontSize: 11 },
      detail: { color: v.text, fontSize: 24, fontWeight: 600 },
      title: { color: v.textMuted, fontSize: 12 },
    },
    /* 数据质量/阈值参考线统一用虚线 + 语义色，避免各页面自造 */
    markLine: {
      symbol: 'none',
      label: { color: v.textMuted, fontSize: 11, formatter: '{b}' },
      lineStyle: { type: 'dashed' as const, width: 1 },
    },
  }
}

/** 主题名常量：需要显式指定主题（如大屏固定深色）时使用，避免调用方写字面量 */
export const LIGHT_THEME = 'scada-light'
export const DARK_THEME = 'scada-dark'

let registered = false

/** 注册两套主题；重复调用安全（幂等） */
export function registerScadaTheme(echarts: any): void {
  if (registered || !echarts?.registerTheme) return
  echarts.registerTheme(LIGHT_THEME, buildTheme(LIGHT))
  echarts.registerTheme(DARK_THEME, buildTheme(DARK))
  registered = true
}

/** 当前应使用的主题名（跟随 html[data-theme]） */
export function scadaThemeName(): string {
  const attr = typeof document !== 'undefined'
    ? document.documentElement.getAttribute('data-theme')
    : null
  return attr === 'dark' ? DARK_THEME : LIGHT_THEME
}

/**
 * 主题切换后重新应用（ECharts 不支持运行时换主题，需重新 init）。
 * 保留原 option，并把旧图表的 option 移植到新实例。
 */
export function applyScadaTheme(chart: any, echarts: any): any {
  if (!chart || !echarts) return chart
  const dom = chart.getDom?.()
  if (!dom) return chart
  const option = chart.getOption?.()
  chart.dispose?.()
  const next = echarts.init(dom, scadaThemeName())
  if (option) next.setOption(option, true)
  return next
}
