import api from './request'

// 对齐原项目 /api/system/status 返回结构
export interface DeviceStatus {
  device_id: string
  id?: string
  name: string
  connected: boolean
  stopped?: boolean
  status?: string        // 'fault' | 'warning' | 'running' | 'idle'
  device_category?: string // 'mechanical' | 'sensor'
  protocol?: string
  host?: string
  zone?: string
  registers?: Array<{ name: string; [key: string]: any }>
}

export interface SystemStatus {
  devices: DeviceStatus[] | Record<string, DeviceStatus>
  alarms: {
    total_active_alarms: number
    by_level: { critical: number; high: number; warning: number; medium: number }
  }
  collector: {
    total_collections: number
    successful_collections: number
    failed_collections: number
  }
  uptime_seconds: number
  simulation_mode: boolean
  database: { total_records: number }
  start_time: string
}

export interface DatabaseInfo {
  realtime_records: number
  history_records: number
  alarm_records: number
  unacknowledged_alarms: number
  archive_records: number
  total_records: number
  database_size_mb: number
}

export const systemApi = {
  getStatus() {
    return api.get('/system/status') as Promise<SystemStatus>
  },

  getDatabase() {
    return api.get('/system/database') as Promise<DatabaseInfo>
  },

  getSimulationMode() {
    return api.get('/system/simulation-mode') as Promise<{ simulation_mode: boolean }>
  },

  setSimulationMode(enabled: boolean) {
    return api.post('/system/simulation-mode', { simulation_mode: enabled }) as Promise<{ success: boolean }>
  },

  getConfig() {
    return api.get('/config') as Promise<{ config: any }>
  },

  saveConfig(section: string, data: any) {
    return api.put('/config', { section, data }) as Promise<{ success: boolean }>
  },

  getHealth() {
    return api.get('/health/status') as Promise<{ status: string; checks: Record<string, boolean> }>
  },

  getHealthStatus() {
    return api.get('/health/status') as Promise<any>
  },

  getHealthModules() {
    return api.get('/health/modules') as Promise<any>
  },

  getHealthModule(moduleName: string) {
    return api.get(`/health/modules/${moduleName}`) as Promise<any>
  },

  getHealthChecks() {
    return api.get('/health/checks') as Promise<any>
  },

  getHealthCheck(checkName: string) {
    return api.get(`/health/checks/${checkName}`) as Promise<any>
  },

  getHealthAvailable() {
    return api.get('/health/available') as Promise<any>
  },

  getHealthUnavailable() {
    return api.get('/health/unavailable') as Promise<any>
  },

  getHAStatus() {
    return api.get('/system/ha-status') as Promise<any>
  },

  forceHARole(role: string) {
    return api.post('/system/ha-force-role', { role }) as Promise<any>
  },
}
