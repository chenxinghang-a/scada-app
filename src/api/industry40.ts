import api from './request'

// ============================================================
// 类型定义 —— 字段名严格对齐后端实际返回
// 说明：/industry40/* 全部走 `success_response(data, message)`，响应体是
// `{success, data, message}`；api/request.ts 的响应拦截器会把它解包成 `data`
// （仅当同时存在 success 与 data 两个键时才解包），因此下面描述的都是**解包后**的对象。
// ============================================================

/** 趋势分析结果（predictive_maintenance._analyze_trend） */
export interface HealthTrend {
  slope: number
  intercept: number
  r_squared: number
  direction: 'rising' | 'falling' | 'stable'
  change_rate: number
}

/** 故障预测（predictive_maintenance._predict_failure），无阈值时后端返回 null */
export interface FailurePrediction {
  predicted_limit: number
  days_to_limit: number
  limit_type: 'upper' | 'lower'
  confidence: number
}

/**
 * /industry40/health 的字典值（键为 `device_id:register_name`）
 * 字段见 智能层/predictive_maintenance.py:138（_run_analysis 写入 health_scores）
 */
export interface HealthScore {
  device_id: string
  register_name: string
  health_score: number
  /** 注意：后端返回的是对象（HealthTrend），不是 'rising'/'falling' 字符串 */
  trend: HealthTrend
  anomaly_count: number
  failure_prediction: FailurePrediction | null
  updated_at: string
}

/** 维护建议（predictive_maintenance._generate_maintenance_alert） */
export interface MaintenanceAlert {
  device_id: string
  register_name: string
  severity: 'critical' | 'warning' | 'info'
  health_score: number
  message: string
  failure_prediction: FailurePrediction | null
  created_at: string
}

/** OEE 记录（oee_calculator.calculate_oee） */
export interface OEERecord {
  device_id: string
  device_name?: string
  availability: number
  performance: number
  quality: number
  oee_percent: number
  grade: string
  total_production?: number
  good_production?: number
}

/** SPC 能力指数（spc_analyzer.calculate_capability） */
export interface SPCCapability {
  device_id?: string
  register_name?: string
  sample_size?: number
  mean?: number
  sigma_within?: number
  sigma_total?: number
  usl?: number
  lsl?: number
  target?: number
  cp?: number
  cpk?: number
  pp?: number
  ppk?: number
  estimated_ppm?: number
  /** 注意：字段名是 capability_grade，不是 grade */
  capability_grade?: string
  updated_at?: string
}

/** 单张控制图（calculate_xbar_r_chart / calculate_xbar_s_chart） */
export interface SPCChart {
  points: number[]
  values?: number[]
  ucl: number
  cl: number
  lcl: number
  subgroup_size?: number
  sample_count?: number
}

/** 控制图 + 能力指数组合（保留旧导出名，便于既有引用） */
export interface SPCData extends SPCChart {
  capability?: SPCCapability
}

/** /industry40/spc/<device>/<register> 解包后的对象 */
export interface SPCResponse {
  control_chart: {
    xbar_chart?: SPCChart
    r_chart?: SPCChart
    s_chart?: SPCChart
    [key: string]: unknown
  } | null
  capability: SPCCapability | null
}

/** SPC 判异记录（spc_analyzer._record_violations，本身不含 device_id） */
export interface SPCViolation {
  rule?: string
  description?: string
  value?: number
  index?: number
  timestamp?: string
  device_id?: string
  register_name?: string
  [key: string]: unknown
}

/** /industry40/energy 解包后的能耗汇总（energy_manager.get_energy_summary） */
export interface EnergySummary {
  total_energy_kwh: number
  peak_kwh: number
  flat_kwh: number
  valley_kwh: number
  electricity_cost: number
  carbon_emission_kg: number
  water_m3?: number
  gas_m3?: number
  tariff_rates?: { peak: number; flat: number; valley: number }
}

/** 分时电费单项（get_energy_cost_breakdown） */
export interface EnergyCostBucket {
  kwh: number
  rate: number
  cost: number
}

/** /industry40/energy/cost 解包后的对象 */
export interface EnergyCostBreakdown {
  peak: EnergyCostBucket
  flat: EnergyCostBucket
  valley: EnergyCostBucket
  total_cost: number
}

/** 单设备实时功率（energy_manager.realtime_power[device_id]） */
export interface RealtimePower {
  power_kw?: number
  total_kwh?: number
  last_update?: string
  [key: string]: unknown
}

/** /industry40/energy/power 解包后的对象 */
export interface EnergyPowerResponse {
  total_power_kw: number
  devices: Record<string, RealtimePower>
}

/** /industry40/energy/tariff 解包后的对象（energy_manager.get_tariff_config） */
export interface EnergyTariffConfig {
  tariff: { peak: number; flat: number; valley: number }
  tariff_periods?: Record<string, Array<[number, number]>>
  carbon_factor?: number
}

/** /industry40/energy/carbon 解包后的对象（get_carbon_emission） */
export interface CarbonEmission {
  total_emission_kg: number
  total_emission_ton: number
  energy_mwh: number
  factor_kg_per_kwh: number
  equivalent_trees: number
}

/** 边缘决策引擎状态（edge_decision.get_status） */
export interface EdgeStatus {
  running?: boolean
  rules_count: number
  interlocks_count: number
  pid_controllers_count: number
  data_points?: number
  decision_log_size?: number
  registered_actions?: string[]
}

/** 边缘决策规则/联锁条目 */
export interface EdgeRule {
  name?: string
  type?: string
  rule_type?: 'rule' | 'interlock'
  condition?: string
  action?: string
  trigger_count?: number
  enabled?: boolean
  [key: string]: unknown
}

/** /industry40/edge/rules 解包后的对象（edge_decision.get_rules） */
export interface EdgeRulesResponse {
  rules: Record<string, EdgeRule>
  interlocks: Record<string, EdgeRule>
  pid_controllers?: Record<string, unknown>
}

/** 决策日志条目（edge_decision._execute_action 写入 decision_log） */
export interface EdgeLogEntry {
  rule_id?: string
  rule_type?: 'rule' | 'interlock'
  /** 动作类型：write_register / set_alarm / callback */
  action_type?: string
  timestamp?: string
  /** 触发时数据快照的前 5 个键（后端字段名就是 snapshot_keys） */
  snapshot_keys?: string[]
  /** 动作执行结果，未执行动作时不存在 */
  result?: string
  [key: string]: unknown
}

/**
 * 数字孪生设备状态（oee_calculator.get_all_device_states）。
 * 后端只写入 `{status, since}`（status ∈ running/stopped/fault/idle），
 * **没有 connected 字段**，判断“运行中”必须用 status === 'running'。
 */
export interface DeviceState {
  status?: string
  since?: string
  [key: string]: unknown
}

/** 振动评分（vibration_analyzer._scores[device_id]） */
export interface VibrationRecord {
  device_id?: string
  rms?: number
  peak?: number
  peak_to_peak?: number
  zone?: string
  zone_color?: string
  zone_description?: string
  health_score?: number
  trend?: string
  sample_count?: number
  updated_at?: string
  [key: string]: unknown
}

/** 频谱本体（vibration_analyzer.FFTResult.to_dict()） */
export interface VibrationSpectrum {
  frequencies: number[]
  amplitudes: number[]
  [key: string]: unknown
}

/** 振动频谱（/industry40/vibration/<device>/spectrum 解包后的对象） */
export interface VibrationSpectrumResponse {
  device_id?: string
  available: boolean
  spectrum: VibrationSpectrum | null
  sample_count?: number
  sample_rate?: number
  reason?: string
  updated_at?: string
}

/** 轴承特征频率单项（vibration_analyzer.check_bearing_fault 的 bearing_faults 子项） */
export interface BearingFaultSignature {
  name?: string
  expected_frequency_hz?: number
  detected_frequency_hz?: number
  amplitude?: number
  has_fault_signature?: boolean
}

/**
 * 轴承诊断（check_bearing_fault 直接返回该对象，**没有再包一层 bearing**）。
 * 后端字段：device_id/rpm/shaft_frequency_hz/bearing_faults/fault_count/diagnosis/updated_at。
 * 前端 `bearingData?.bearing || bearingData` 的兜底写法对两种形态都成立，
 * 故这里把 `bearing` 标为可选以兼容未来加壳。
 */
export interface BearingDiagnosis {
  device_id?: string
  rpm?: number
  shaft_frequency_hz?: number
  bearing_faults?: Record<string, BearingFaultSignature>
  fault_count?: number
  diagnosis?: string
  updated_at?: string
  /** 兼容字段：后端当前不返回，前端作为可选的加壳形态读取 */
  bearing?: BearingDiagnosis
  [key: string]: unknown
}

/** /industry40/overview 解包后的对象 */
export interface Industry40Overview {
  predictive_maintenance: {
    status: string
    device_count: number
    avg_health_score: number
    recent_alerts: MaintenanceAlert[]
  }
  oee: {
    status: string
    device_count: number
    avg_oee_percent: number
    devices: Record<string, OEERecord>
  }
  energy: EnergySummary & { status?: string; total_power_kw?: number }
  edge_decision: EdgeStatus & { status?: string }
}

// ============================================================
// API 对象
// ============================================================
export const industry40Api = {
  // 总览
  getOverview() {
    return api.get('/industry40/overview') as Promise<Industry40Overview>
  },

  // 预测性维护
  getHealthScores() {
    return api.get('/industry40/health') as Promise<Record<string, HealthScore>>
  },
  getHealthScore(deviceId: string) {
    return api.get(`/industry40/health/${deviceId}`) as Promise<Record<string, HealthScore>>
  },
  getMaintenanceAlerts(limit = 50) {
    return api.get(`/industry40/maintenance-alerts?limit=${limit}`) as Promise<MaintenanceAlert[]>
  },

  // 趋势分析
  getTrend(deviceId: string, registerName: string) {
    return api.get(`/industry40/trend/${deviceId}/${registerName}`) as Promise<{
      device_id: string
      register_name: string
      data_points: number
      current_value: number | null
      min_value: number | null
      max_value: number | null
      mean_value: number | null
      health_score?: number
      trend?: HealthTrend
      failure_prediction?: FailurePrediction | null
    }>
  },

  // OEE
  getOEE() {
    return api.get('/industry40/oee') as Promise<Record<string, OEERecord>>
  },
  getOEEDevice(deviceId: string) {
    return api.get(`/industry40/oee/${deviceId}`) as Promise<OEERecord>
  },

  // SPC
  getSPC(deviceId: string, registerName: string) {
    return api.get(`/industry40/spc/${deviceId}/${registerName}`) as Promise<SPCResponse>
  },
  getSPCViolations(deviceId?: string, limit = 50) {
    const params = new URLSearchParams()
    if (deviceId) params.set('device_id', deviceId)
    params.set('limit', String(limit))
    return api.get(`/industry40/spc/violations?${params}`) as Promise<SPCViolation[]>
  },

  // 能源
  getEnergy() {
    return api.get('/industry40/energy') as Promise<EnergySummary>
  },
  getEnergyCost() {
    return api.get('/industry40/energy/cost') as Promise<EnergyCostBreakdown>
  },
  getEnergyCarbon() {
    return api.get('/industry40/energy/carbon') as Promise<CarbonEmission>
  },
  getEnergyPower() {
    return api.get('/industry40/energy/power') as Promise<EnergyPowerResponse>
  },
  getEnergyTariff() {
    return api.get('/industry40/energy/tariff') as Promise<EnergyTariffConfig>
  },
  setEnergyTariff(tariff: {
    tariff?: { peak?: number; flat?: number; valley?: number }
    tariff_periods?: Record<string, Array<[number, number]>>
    carbon_factor?: number
  }) {
    return api.put('/industry40/energy/tariff', tariff) as Promise<{ success: boolean }>
  },
  getEnergyAnomalyConfig() {
    return api.get('/industry40/energy/anomaly-config') as Promise<Record<string, unknown>>
  },
  setEnergyAnomalyConfig(config: Record<string, unknown>) {
    return api.put('/industry40/energy/anomaly-config', config) as Promise<Record<string, unknown>>
  },

  // 边缘决策
  getEdgeStatus() {
    return api.get('/industry40/edge/status') as Promise<EdgeStatus>
  },
  getEdgeRules() {
    return api.get('/industry40/edge/rules') as Promise<EdgeRulesResponse>
  },
  getEdgeLog(limit = 50) {
    return api.get(`/industry40/edge/log?limit=${limit}`) as Promise<EdgeLogEntry[]>
  },

  // 数字孪生
  getDevicesStatus() {
    return api.get('/industry40/devices/status') as Promise<Record<string, DeviceState>>
  },

  // 振动分析
  getVibrationAll() {
    return api.get('/industry40/vibration') as Promise<Record<string, VibrationRecord>>
  },
  getVibration(deviceId: string) {
    return api.get(`/industry40/vibration/${deviceId}`) as Promise<VibrationRecord>
  },
  getVibrationSpectrum(deviceId: string) {
    return api.get(`/industry40/vibration/${deviceId}/spectrum`) as Promise<VibrationSpectrumResponse>
  },
  getVibrationBearing(deviceId: string) {
    return api.get(`/industry40/vibration/${deviceId}/bearing`) as Promise<BearingDiagnosis>
  },
}
