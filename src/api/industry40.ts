import api from './request'

// ========== 类型定义 ==========
export interface OEERecord {
  device_id: string
  device_name: string
  availability: number
  performance: number
  quality: number
  oee_percent: number
  grade: string
  total_production: number
  good_production: number
}

export interface HealthScore {
  device_id: string
  register_name: string
  health_score: number
  trend: string
  anomaly_count: number
  failure_prediction: { days_to_limit: number | null }
  updated_at: string
}

export interface SPCCapability {
  mean: number
  usl: number
  lsl: number
  cp: number
  cpk: number
  pp: number
  ppk: number
  grade: string
}

export interface SPCData {
  points: number[]
  values: number[]
  ucl: number
  cl: number
  lcl: number
  capability: SPCCapability
}

export interface EnergySummary {
  total_kwh: number
  total_cost: number
  carbon_kg: number
  equivalent_trees: number
  peak_kwh: number
  flat_kwh: number
  valley_kwh: number
}

export interface EdgeStatus {
  rules_count: number
  interlocks_count: number
  pid_controllers: number
}

export interface EdgeRule {
  rule_id: string
  name: string
  type: string
  trigger_count: number
  enabled: boolean
}

// ========== API 对象 ==========
export const industry40Api = {
  // 总览
  getOverview() {
    return api.get('/industry40/overview') as Promise<any>
  },

  // 预测性维护
  getHealthScores() {
    return api.get('/industry40/health') as Promise<any>
  },
  getHealthScore(deviceId: string) {
    return api.get(`/industry40/health/${deviceId}`) as Promise<any>
  },
  getMaintenanceAlerts(limit = 50) {
    return api.get(`/industry40/maintenance-alerts?limit=${limit}`) as Promise<any>
  },

  // 趋势分析
  getTrend(deviceId: string, registerName: string) {
    return api.get(`/industry40/trend/${deviceId}/${registerName}`) as Promise<any>
  },

  // OEE
  getOEE() {
    return api.get('/industry40/oee') as Promise<any>
  },
  getOEEDevice(deviceId: string) {
    return api.get(`/industry40/oee/${deviceId}`) as Promise<any>
  },

  // SPC
  getSPC(deviceId: string, registerName: string) {
    return api.get(`/industry40/spc/${deviceId}/${registerName}`) as Promise<any>
  },
  getSPCViolations(deviceId?: string, limit = 50) {
    const params = new URLSearchParams()
    if (deviceId) params.set('device_id', deviceId)
    params.set('limit', String(limit))
    return api.get(`/industry40/spc/violations?${params}`) as Promise<{ violations: any[] }>
  },

  // 能源
  getEnergy() {
    return api.get('/industry40/energy') as Promise<{ summary: EnergySummary }>
  },
  getEnergyCost() {
    return api.get('/industry40/energy/cost') as Promise<any>
  },
  getEnergyCarbon() {
    return api.get('/industry40/energy/carbon') as Promise<any>
  },
  getEnergyPower() {
    return api.get('/industry40/energy/power') as Promise<any>
  },
  getEnergyTariff() {
    return api.get('/industry40/energy/tariff') as Promise<any>
  },
  setEnergyTariff(tariff: any) {
    return api.put('/industry40/energy/tariff', tariff) as Promise<any>
  },
  getEnergyAnomalyConfig() {
    return api.get('/industry40/energy/anomaly-config') as Promise<any>
  },
  setEnergyAnomalyConfig(config: any) {
    return api.put('/industry40/energy/anomaly-config', config) as Promise<any>
  },

  // 边缘决策
  getEdgeStatus() {
    return api.get('/industry40/edge/status') as Promise<EdgeStatus>
  },
  getEdgeRules() {
    return api.get('/industry40/edge/rules') as Promise<{ rules: Record<string, EdgeRule>, interlocks: Record<string, EdgeRule> }>
  },
  getEdgeLog(limit = 50) {
    return api.get(`/industry40/edge/log?limit=${limit}`) as Promise<{ log: any[] }>
  },

  // 数字孪生
  getDevicesStatus() {
    return api.get('/industry40/devices/status') as Promise<{ devices: any[] }>
  },

  // 振动分析
  getVibrationAll() {
    return api.get('/industry40/vibration') as Promise<any>
  },
  getVibration(deviceId: string) {
    return api.get(`/industry40/vibration/${deviceId}`) as Promise<any>
  },
  getVibrationSpectrum(deviceId: string) {
    return api.get(`/industry40/vibration/${deviceId}/spectrum`) as Promise<any>
  },
  getVibrationBearing(deviceId: string) {
    return api.get(`/industry40/vibration/${deviceId}/bearing`) as Promise<any>
  },
}
