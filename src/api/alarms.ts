import api from './request'

export interface Alarm {
  id: string
  alarm_id?: string
  device_id: string
  register_name: string
  alarm_level: 'critical' | 'warning' | 'info'
  alarm_message: string
  threshold: number
  actual_value: number
  last_value?: number
  timestamp: string
  last_trigger_time?: string
  trigger_count?: number
  acknowledged: boolean
  acknowledged_by?: string
  acknowledged_at?: string
}

export interface AlarmRule {
  id: string
  device_id: string
  register_name: string
  condition: string
  threshold: number
  level: string
  message: string
  enabled: boolean
}

export const alarmsApi = {
  getAll(params?: { page?: number; per_page?: number; level?: string; limit?: number; device_id?: string; alarm_level?: string }) {
    return api.get('/alarms', { params }) as Promise<{
      alarms: Alarm[]
      total: number
    }>
  },

  getActive() {
    return api.get('/alarms/active') as Promise<{ alarms: Alarm[] }>
  },

  acknowledge(id: string, device_id?: string, register_name?: string) {
    return api.post(`/alarms/${id}/acknowledge`, {
      device_id,
      register_name,
      acknowledged_by: 'operator',
    }) as Promise<{ success: boolean }>
  },

  getStatistics() {
    return api.get('/alarms/statistics') as Promise<{
      total: number
      active: number
      acknowledged: number
      by_level: Record<string, number>
    }>
  },

  getRules() {
    return api.get('/alarm-rules') as Promise<{ rules: AlarmRule[] }>
  },

  createRule(rule: Partial<AlarmRule>) {
    return api.post('/alarm-rules', rule)
  },

  updateRule(id: string, rule: Partial<AlarmRule>) {
    return api.put(`/alarm-rules/${id}`, rule)
  },

  deleteRule(id: string) {
    return api.delete(`/alarm-rules/${id}`)
  },
}
