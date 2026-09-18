import request from './request'

export const performanceApi = {
  /** 获取实时性能指标 */
  getRealtimeMetrics(): Promise<any> {
    // baseURL 已含 /api，这里只写 /performance/...（避免 /api/api 双前缀）
    return request.get('/performance/metrics/realtime')
  },

  /** 获取历史指标 */
  getMetricsHistory(hours: number = 24): Promise<{ hours: number; samples: number; data: any[] }> {
    return request.get('/performance/metrics/history', { params: { hours } })
  },

  /** 获取指标摘要 */
  getMetricsSummary(hours: number = 24): Promise<any> {
    return request.get('/performance/metrics/summary', { params: { hours } })
  },
}
