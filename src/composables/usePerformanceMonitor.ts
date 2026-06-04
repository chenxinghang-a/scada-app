import { ref, onMounted, onUnmounted } from 'vue'

interface PerformanceMetrics {
  fps: number
  memoryUsage: number | null
  renderTime: number
  apiLatency: Map<string, number>
}

export function usePerformanceMonitor() {
  const metrics = ref<PerformanceMetrics>({
    fps: 60,
    memoryUsage: null,
    renderTime: 0,
    apiLatency: new Map(),
  })

  let frameCount = 0
  let lastTime = performance.now()
  let animationId: number | null = null
  let memoryInterval: ReturnType<typeof setInterval> | null = null

  // FPS 监控
  function measureFPS() {
    frameCount++
    const now = performance.now()
    if (now - lastTime >= 1000) {
      metrics.value.fps = Math.round(frameCount * 1000 / (now - lastTime))
      frameCount = 0
      lastTime = now
    }
    animationId = requestAnimationFrame(measureFPS)
  }

  // 内存监控（仅 Chrome 支持）
  function measureMemory() {
    if ('memory' in performance) {
      const memory = (performance as any).memory
      metrics.value.memoryUsage = Math.round(memory.usedJSHeapSize / 1024 / 1024)
    }
  }

  // API 延迟追踪
  function trackApiLatency(endpoint: string, duration: number) {
    metrics.value.apiLatency.set(endpoint, duration)
    // 只保留最近 50 个端点
    if (metrics.value.apiLatency.size > 50) {
      const firstKey = metrics.value.apiLatency.keys().next().value
      if (firstKey) metrics.value.apiLatency.delete(firstKey)
    }
  }

  // 渲染时间测量
  function measureRenderTime(fn: () => void): number {
    const start = performance.now()
    fn()
    const duration = performance.now() - start
    metrics.value.renderTime = Math.round(duration * 100) / 100
    return duration
  }

  // 获取性能报告
  function getReport() {
    return {
      fps: metrics.value.fps,
      memoryMB: metrics.value.memoryUsage,
      renderTimeMs: metrics.value.renderTime,
      apiLatency: Object.fromEntries(metrics.value.apiLatency),
      timestamp: new Date().toISOString(),
    }
  }

  // 检查是否需要优化
  function needsOptimization(): string[] {
    const issues: string[] = []
    if (metrics.value.fps < 30) {
      issues.push('FPS过低，可能有性能问题')
    }
    if (metrics.value.memoryUsage && metrics.value.memoryUsage > 500) {
      issues.push('内存使用过高，可能存在泄漏')
    }
    if (metrics.value.renderTime > 16) {
      issues.push('渲染时间过长，可能导致卡顿')
    }
    metrics.value.apiLatency.forEach((duration, endpoint) => {
      if (duration > 3000) {
        issues.push(`API ${endpoint} 响应过慢 (${Math.round(duration)}ms)`)
      }
    })
    return issues
  }

  onMounted(() => {
    measureFPS()
    memoryInterval = setInterval(measureMemory, 5000)
  })

  onUnmounted(() => {
    if (animationId) cancelAnimationFrame(animationId)
    if (memoryInterval) clearInterval(memoryInterval)
  })

  return {
    metrics,
    trackApiLatency,
    measureRenderTime,
    getReport,
    needsOptimization,
  }
}
