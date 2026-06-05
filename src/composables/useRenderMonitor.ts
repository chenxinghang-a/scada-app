/**
 * 组件渲染性能监控 Composable
 * 检测长渲染（>16ms），记录渲染时间，提供优化建议。
 * 增强: P95/P99延迟、按组件统计百分比、导出API。
 *
 * 用法:
 *   const { renderTime, isSlow, startMeasure, endMeasure } = useRenderMonitor('MyComponent')
 */

import { ref, onMounted, onUpdated, nextTick } from 'vue'

interface RenderRecord {
  component: string
  duration: number
  timestamp: number
  type: 'mount' | 'update'
  memory?: number
}

interface ComponentStats {
  count: number
  total: number
  max: number
  min: number
  p95: number
  p99: number
  slowCount: number
}

const SLOW_THRESHOLD = 16 // 60fps = 16.67ms per frame
const renderHistory: RenderRecord[] = []
const MAX_HISTORY = 500

export function useRenderMonitor(componentName: string) {
  const renderTime = ref(0)
  const isSlow = ref(false)
  const mountTime = ref(0)
  const updateCount = ref(0)
  let measureStart = 0

  function startMeasure() {
    measureStart = performance.now()
  }

  function endMeasure(type: 'mount' | 'update' = 'update') {
    if (!measureStart) return

    const duration = performance.now() - measureStart
    measureStart = 0

    renderTime.value = duration
    isSlow.value = duration > SLOW_THRESHOLD

    const record: RenderRecord = {
      component: componentName,
      duration,
      timestamp: Date.now(),
      type,
    }

    renderHistory.push(record)
    if (renderHistory.length > MAX_HISTORY) {
      renderHistory.shift()
    }

    if (type === 'mount') {
      mountTime.value = duration
    } else {
      updateCount.value++
    }

    if (duration > SLOW_THRESHOLD) {
      console.warn(
        `[RenderMonitor] ${componentName} ${type} 渲染耗时: ${duration.toFixed(2)}ms (阈值: ${SLOW_THRESHOLD}ms)`
      )
    }
  }

  onMounted(() => {
    startMeasure()
    nextTick(() => endMeasure('mount'))
  })

  onUpdated(() => {
    startMeasure()
    nextTick(() => endMeasure('update'))
  })

  /** 获取慢渲染统计 */
  function getSlowRenders(threshold: number = SLOW_THRESHOLD): RenderRecord[] {
    return renderHistory.filter(r => r.duration > threshold)
  }

  /** 获取组件平均渲染时间 */
  function getAverageRenderTime(): number {
    const componentRecords = renderHistory.filter(r => r.component === componentName)
    if (componentRecords.length === 0) return 0
    return componentRecords.reduce((sum, r) => sum + r.duration, 0) / componentRecords.length
  }

  /** 获取所有组件渲染统计（增强版） */
  function getAllStats(): Record<string, ComponentStats> {
    const stats: Record<string, { durations: number[]; slowCount: number }> = {}

    for (const record of renderHistory) {
      if (!stats[record.component]) {
        stats[record.component] = { durations: [], slowCount: 0 }
      }
      stats[record.component].durations.push(record.duration)
      if (record.duration > SLOW_THRESHOLD) {
        stats[record.component].slowCount++
      }
    }

    return Object.fromEntries(
      Object.entries(stats).map(([name, s]) => {
        const sorted = [...s.durations].sort((a, b) => a - b)
        const count = sorted.length
        const total = sorted.reduce((a, b) => a + b, 0)
        return [name, {
          count,
          total,
          avg: total / count,
          max: sorted[sorted.length - 1] || 0,
          min: sorted[0] || 0,
          p95: sorted[Math.floor(count * 0.95)] || 0,
          p99: sorted[Math.floor(count * 0.99)] || 0,
          slowCount: s.slowCount,
        }]
      })
    )
  }

  /** 导出渲染报告（JSON格式，可上报API） */
  function exportReport(): object {
    const stats = getAllStats()
    return {
      timestamp: Date.now(),
      totalRecords: renderHistory.length,
      slowThreshold: SLOW_THRESHOLD,
      components: stats,
      recentSlowRenders: renderHistory
        .filter(r => r.duration > SLOW_THRESHOLD)
        .slice(-20)
        .map(r => ({ component: r.component, duration: r.duration, type: r.type, timestamp: r.timestamp })),
    }
  }

  /** 清空历史记录 */
  function clearHistory() {
    renderHistory.length = 0
  }

  return {
    renderTime,
    isSlow,
    mountTime,
    updateCount,
    startMeasure,
    endMeasure,
    getSlowRenders,
    getAverageRenderTime,
    getAllStats,
    exportReport,
    clearHistory,
  }
}
