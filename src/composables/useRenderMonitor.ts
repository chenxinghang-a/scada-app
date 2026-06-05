/**
 * 组件渲染性能监控 Composable
 * 检测长渲染（>16ms），记录渲染时间，提供优化建议。
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
}

const SLOW_THRESHOLD = 16 // 60fps = 16.67ms per frame
const renderHistory: RenderRecord[] = []
const MAX_HISTORY = 100

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

  /** 获取所有组件渲染统计 */
  function getAllStats(): Record<string, { count: number; avg: number; max: number }> {
    const stats: Record<string, { count: number; total: number; max: number }> = {}
    for (const record of renderHistory) {
      if (!stats[record.component]) {
        stats[record.component] = { count: 0, total: 0, max: 0 }
      }
      stats[record.component].count++
      stats[record.component].total += record.duration
      stats[record.component].max = Math.max(stats[record.component].max, record.duration)
    }

    return Object.fromEntries(
      Object.entries(stats).map(([name, s]) => [
        name,
        { count: s.count, avg: s.total / s.count, max: s.max },
      ])
    )
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
  }
}
