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
  message?: string
  name?: string
  description?: string
  delay?: number
  enabled: boolean
}

/**
 * 报警输出硬件（Modbus 继电器 / 声光灯塔 / 工位继电器）
 * 对应 配置/alarms.yaml 的 alarm_output.<device> 段（见 展示层/api/api_alarms.py:328）。
 */
export interface ModbusOutputDevice {
  device_id?: string
  host?: string
  port?: number
  protocol?: string
  slave_id?: number
  /** 逻辑名 → DO 通道号，例如 { red_light: 0, buzzer: 5, flash_interval: 6 } */
  do_mapping?: Record<string, number>
}

/**
 * GET /alarm-output/config 的 config 段 = 配置/alarms.yaml 的 alarm_output 整段。
 * 注意：该响应形态为 `{success, config}`（**没有** data 字段），
 * 因此不会被 api/request.ts 的信封解包规则命中，调用方拿到的是含 config 的对象。
 */
export interface AlarmOutputConfig {
  enabled?: boolean
  relay_output?: ModbusOutputDevice
  signal_tower?: ModbusOutputDevice
  station_output?: ModbusOutputDevice
  /**
   * 报警升级配置。后端 alarms.yaml 的 alarm_output 段**当前并不返回该字段**，
   * 故实际总是 undefined；保留可选以便接口补齐后前端无需再改类型。
   */
  escalation?: AlarmEscalationConfig
}

/** 报警升级配置（前端表单模型，后端尚无对应持久化段，见报告） */
export interface AlarmEscalationConfig {
  enabled: boolean
  timeout_minutes: number
  escalate_to: string
  notify_methods: string[]
}

/** 广播系统 MQTT 连接参数（配置/alarms.yaml 的 broadcast.mqtt） */
export interface BroadcastMqttConfig {
  broker?: string
  port?: number
  topic_prefix?: string
  username?: string
  password?: string
}

/** GET /broadcast/config 的 config 段 = 配置/alarms.yaml 的 broadcast 段 */
export interface BroadcastConfig {
  enabled?: boolean
  mqtt?: BroadcastMqttConfig
  areas?: string[]
}

/** 通知渠道配置（alarms.yaml 的 notification 段，随 /alarm-rules 一并返回） */
export interface AlarmNotificationConfig {
  email?: { enabled?: boolean; smtp_server?: string; smtp_port?: number; username?: string; password?: string; recipients?: string[] }
  sms?: { enabled?: boolean; provider?: string; access_key?: string; secret_key?: string; sign_name?: string; template_code?: string; phone_numbers?: string[] }
  sound?: { enabled?: boolean; critical_sound?: string; warning_sound?: string }
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
    // 后端 /api/alarms/statistics 返回 alarm_manager.get_alarm_statistics() 原始结构
    // （alarm_manager.py:1184-1208），无 success/data 信封
    return api.get('/alarms/statistics') as Promise<{
      total_active_alarms: number
      by_level: Record<string, number>
      by_device: Record<string, number>
      total_rules: number
      enabled_rules: number
      output?: { alarm_output: any; broadcast: any }
      dedup?: {
        enabled: boolean
        emit_cooldown_seconds: number
        acknowledge_suppress_seconds: number
        tracked_alarms: number
        acknowledged_alarms: number
      }
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
    // 展示层/api/api_alarms.py:207 直接 jsonify({rules, notification})，无 success 信封
    return api.get('/alarm-rules') as Promise<{ rules: AlarmRule[]; notification: AlarmNotificationConfig }>
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
    return api.get('/alarm-output/config') as Promise<{ success: boolean; config: AlarmOutputConfig }>
  },

  setAlarmOutputConfig(config: Record<string, unknown>) {
    return api.put('/alarm-output/config', config) as Promise<{ success: boolean; message?: string }>
  },

  getBroadcastConfig() {
    return api.get('/broadcast/config') as Promise<{ success: boolean; config: BroadcastConfig; runtime: Record<string, unknown> }>
  },

  setBroadcastConfig(config: Record<string, unknown>) {
    return api.put('/broadcast/config', config) as Promise<{ success: boolean; message?: string }>
  },
}
