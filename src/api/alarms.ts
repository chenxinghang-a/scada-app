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
    // 从 localStorage 获取真实用户名（auth store 同步写入）
    let username = 'operator'
    try {
      const user = JSON.parse(localStorage.getItem('scada_user') || '{}')
      username = user.username || 'operator'
    } catch {}
    return api.post(`/alarms/${id}/acknowledge`, {
      device_id,
      register_name,
      acknowledged_by: username,
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

  getFloodStatus() {
    return api.get('/alarms/flood-status') as Promise<any>
  },

  getDedupConfig() {
    return api.get('/alarms/dedup-config') as Promise<any>
  },

  setDedupConfig(config: any) {
    return api.put('/alarms/dedup-config', config) as Promise<any>
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

  exportAlarms(format: string = 'csv') {
    return api.post('/export/alarms', { format }, { responseType: 'blob' })
  },

  // 报警输出（灯塔）
  getAlarmOutputStatus() {
    return api.get('/alarm-output/status') as Promise<any>
  },

  alarmOutputAcknowledge() {
    return api.post('/alarm-output/acknowledge') as Promise<any>
  },

  alarmOutputReset() {
    return api.post('/alarm-output/reset') as Promise<any>
  },

  alarmOutputManual(control: any) {
    return api.post('/alarm-output/manual', control) as Promise<any>
  },

  // 广播系统
  getBroadcastAreas() {
    return api.get('/broadcast/areas') as Promise<any>
  },

  getBroadcastHistory(limit = 30) {
    return api.get(`/broadcast/history?limit=${limit}`) as Promise<any>
  },

  broadcastSpeak(data: any) {
    return api.post('/broadcast/speak', data) as Promise<any>
  },

  updateNotification(config: any) {
    return api.put('/alarm-rules/notification', config) as Promise<any>
  },

  getAlarmOutputConfig() {
    return api.get('/alarm-output/config') as Promise<any>
  },

  setAlarmOutputConfig(config: any) {
    return api.put('/alarm-output/config', config) as Promise<any>
  },

  getBroadcastConfig() {
    return api.get('/broadcast/config') as Promise<any>
  },

  setBroadcastConfig(config: any) {
    return api.put('/broadcast/config', config) as Promise<any>
  },
}
