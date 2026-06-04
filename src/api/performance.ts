import request from './request'

export const performanceApi = {
  /** 获取实时性能指标 */
  getRealtimeMetrics(): Promise<any> {
    return request.get('/api/performance/metrics/realtime')
  },

  /** 获取历史指标 */
  getMetricsHistory(hours: number = 24): Promise<{ hours: number; samples: number; data: any[] }> {
    return request.get('/api/performance/metrics/history', { params: { hours } })
  },

  /** 获取指标摘要 */
  getMetricsSummary(hours: number = 24): Promise<any> {
    return request.get('/api/performance/metrics/summary', { params: { hours } })
  },
}
