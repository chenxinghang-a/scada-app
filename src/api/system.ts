import api from './request'

// 对齐原项目 /api/system/status 返回结构
export interface DeviceStatus {
  device_id: string
  id?: string
  name: string
  connected: boolean
  stopped?: boolean
  status?: string        // 'online' | 'offline'（brief）/ 'fault' | 'warning' | 'running' | 'idle'
  device_category?: string // 'mechanical' | 'sensor'
  protocol?: string
  host?: string
  port?: number
  zone?: string
  registers?: Array<{ name: string; [key: string]: unknown }>
}

/**
 * /system/status 的 collector 段：data_collector.get_stats()
 * 字段见 采集层/data_collector.py:1441。
 */
export interface CollectorStats {
  running: boolean
  queue_size: number
  total_collections: number
  successful_collections: number
  failed_collections: number
  last_collection_time: string | null
  dropped_items: number
  requeued_db_retry: number
  dropped_db_retry: number
  requeue_full_db_retry: number
  protocols_active: Record<string, number>
}

/**
 * /system/status 的 alarms 段：alarm_manager.get_alarm_statistics()
 * 字段见 报警层/alarm_manager.py:1424。
 */
export interface AlarmStatistics {
  total_active_alarms: number
  by_level: Record<string, number>
  by_device: Record<string, number>
  total_rules: number
  enabled_rules: number
}

export interface SystemStatus {
  version: string
  /**
   * 注意：/system/status 走 device_manager.get_all_status()，实际返回**数组**
   * （采集层/device_manager.py:485）。这里保留字典联合类型是因为 Dashboard.vue /
   * stores/app.ts 已有的消费代码按 `Array.isArray(...) ? ... : Object.values(...)`
   * 做了双形态兼容，收窄会牵动无关文件；新增消费方请按数组处理。
   */
  devices: DeviceStatus[] | Record<string, DeviceStatus>
  alarms: AlarmStatistics
  collector: CollectorStats
  uptime_seconds: number
  simulation_mode: boolean
  database: DatabaseInfo
  start_time: string | null
}

/** /system/database：storage.database.get_database_stats()（含膨胀指标） */
export interface DatabaseInfo {
  realtime_records: number
  history_records: number
  alarm_records: number
  unacknowledged_alarms: number
  archive_records: number
  total_records: number
  // 以下为 get_fragmentation_stats() 附加的膨胀指标（部分环境可能缺失）
  database_size_mb?: number
  page_count?: number
  page_size?: number
  freelist_count?: number
  free_page_ratio?: number
  is_bloated?: boolean
}

/**
 * GET /config 的 config 段：**经脱敏后的 配置/system.yaml 全文**。
 * 后端只脱敏（secret_key/password 等置 '***'），不改结构，见 展示层/api/api_system.py:103。
 * 之所以带索引签名：后端可能新增配置段，且前端存在读取当前后端并不返回的段
 * （如 `archive`）的历史代码，索引签名让这类读取在类型层保持可见而非报错中断构建。
 */
export interface SystemConfigFile {
  system?: {
    name?: string
    version?: string
    author?: string
    description?: string
    simulation_mode?: boolean
  }
  web?: {
    host?: string
    port?: number
    debug?: boolean
    secret_key?: string
    cors?: { enabled?: boolean; origins?: string[] }
  }
  collection?: {
    default_interval?: number
    timeout?: number
    max_concurrent?: number
    retry?: { max_attempts?: number; interval_seconds?: number }
  }
  database?: {
    type?: string
    path?: string
    retention?: { raw_data_days?: number; alarm_days?: number; compressed_data_days?: number }
    compression?: { enabled?: boolean; interval_hours?: number; method?: string }
  }
  logging?: {
    level?: string
    format?: string
    console?: { enabled?: boolean }
    file?: { enabled?: boolean; path?: string; max_size_mb?: number; backup_count?: number }
  }
  alarm?: { check_interval?: number; confirm_timeout?: number; escalation_time?: number }
  performance?: {
    cache?: { enabled?: boolean; type?: string; ttl_seconds?: number }
    connection_pool?: { size?: number; timeout?: number }
  }
  mqtt?: {
    broker_host?: string
    broker_port?: number
    tls?: { enabled?: boolean; ca_cert?: string; client_cert?: string; client_key?: string; insecure?: boolean }
  }
  export?: { directory?: string; formats?: string[]; max_rows?: number }
  [section: string]: unknown
}

/** GET /health/status 响应（api_health） */
export interface HealthStatus {
  global_status: string
  modules: Record<string, unknown>
  checks: Record<string, boolean>
  unhealthy_modules: string[]
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
    return api.get('/config') as Promise<{ config: SystemConfigFile }>
  },

  saveConfig(section: string, data: Record<string, unknown>) {
    return api.put('/config', { section, data }) as Promise<{ success: boolean }>
  },

  getHealth() {
    return api.get('/health/status') as Promise<HealthStatus>
  },

  getHealthModules() {
    return api.get('/health/modules') as Promise<Record<string, { status: string; has_instance: boolean; error: string | null }>>
  },

  getHealthModule(moduleName: string) {
    return api.get(`/health/modules/${moduleName}`) as Promise<{ status: string; has_instance: boolean; error: string | null }>
  },

  getHealthChecks() {
    return api.get('/health/checks') as Promise<Record<string, boolean>>
  },

  getHealthCheck(checkName: string) {
    return api.get(`/health/checks/${checkName}`) as Promise<{ status: boolean; message: string }>
  },

  getHealthAvailable() {
    return api.get('/health/available') as Promise<string[]>
  },

  getHealthUnavailable() {
    return api.get('/health/unavailable') as Promise<string[]>
  },

  getHAStatus() {
    return api.get('/system/ha-status') as Promise<{ role: string; state: string; peer: string | null }>
  },

  forceHARole(role: string) {
    return api.post('/system/ha-force-role', { role }) as Promise<{ success: boolean }>
  },
}
