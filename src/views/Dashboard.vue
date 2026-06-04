<template>
  <div class="dashboard">
    <!-- KPI 行 -->
    <div class="kpi-row">
      <div class="kpi" :class="{ warn: kpi.oee < 85 }">
        <div class="kpi-label">OEE 综合效率</div>
        <div class="kpi-value">{{ kpi.oee }}%</div>
        <div class="kpi-sub">目标 ≥85%</div>
      </div>
      <div class="kpi" :class="{ warn: kpi.online < kpi.total }">
        <div class="kpi-label">设备状态</div>
        <div class="kpi-value"><span>{{ kpi.online }}</span>/<span>{{ kpi.total }}</span></div>
        <div class="kpi-sub">在线/总数</div>
      </div>
      <div class="kpi" :class="{ alarm: kpi.alarmCount > 0 }">
        <div class="kpi-label">活动报警</div>
        <div class="kpi-value">{{ kpi.alarmCount }}</div>
        <div class="kpi-sub">未确认: <span>{{ kpi.unacked }}</span></div>
      </div>
      <div class="kpi">
        <div class="kpi-label">采集吞吐</div>
        <div class="kpi-value">{{ kpi.rate }} <small>条/分</small></div>
      </div>
      <div class="kpi">
        <div class="kpi-label">数据质量</div>
        <div class="kpi-value">{{ kpi.quality }}%</div>
        <div class="kpi-sub">成功率</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">运行时间</div>
        <div class="kpi-value">{{ kpi.uptime }}</div>
        <div class="kpi-sub">{{ kpi.mode }}</div>
      </div>
    </div>

    <!-- 告警闪烁横幅 -->
    <div v-if="latestAlarm" class="alarm-banner" :style="bannerStyle" @click="$router.push('/alarms')">
      <div class="banner-content">
        <span class="banner-icon">⚠️</span>
        <span class="banner-text">{{ latestAlarm.alarm_message }}</span>
        <span class="banner-device">{{ latestAlarm.device_id }}</span>
        <button class="banner-close" @click.stop="dismissBanner">×</button>
      </div>
    </div>

    <!-- 主区域 -->
    <div class="main-area">
      <!-- 设备卡片网格 -->
      <div class="device-panel">
        <div class="dev-filter-bar">
          <div class="dev-filter-tabs">
            <button class="dev-tab" :class="{ active: devFilter === 'all' }" @click="setDevFilter('all')">全部 {{ allDeviceList.length }}</button>
            <button class="dev-tab" :class="{ active: devFilter === 'online' }" @click="setDevFilter('online')">在线 {{ onlineCount }}</button>
            <button class="dev-tab" :class="{ active: devFilter === 'offline' }" @click="setDevFilter('offline')">离线 {{ offlineCount }}</button>
            <button class="dev-tab" :class="{ active: devFilter === 'fault' }" @click="setDevFilter('fault')">告警 {{ faultCount }}</button>
            <button class="dev-tab" :class="{ active: devFilter === 'mechanical' }" @click="setDevFilter('mechanical')">机械 {{ mechanicalCount }}</button>
          </div>
          <div class="dev-filter-right">
            <select v-model="devProtocolFilter" class="dev-proto-select">
              <option value="">全部协议</option>
              <option v-for="p in protocolList" :key="p" :value="p">{{ p }}</option>
            </select>
            <span class="dev-count-badge">共 {{ filteredDeviceList.length }} 台</span>
          </div>
        </div>

        <div class="device-grid">
          <div v-for="d in pagedDeviceList" :key="getDeviceId(d)" class="dev-card" @click="selectDevice(getDeviceId(d))">
            <div class="dev-status" :class="getDeviceStatusClass(d)"></div>
            <div class="dev-info">
              <div class="dev-name">{{ d.name || d.device_id }} <span class="dev-state-tag" :class="getDeviceStatusClass(d)">{{ getDeviceStatusText(d) }}</span><span v-if="d.zone" class="dev-zone-tag">{{ d.zone }}</span></div>
              <div class="dev-meta">{{ d.protocol || 'modbus_tcp' }} · {{ d.host || '' }}</div>
              <div class="dev-values">
                <span v-for="r in (d.registers || []).slice(0, 2)" :key="r.name" class="dev-val">
                  <span class="label">{{ getShortLabel(r.name) }}</span>
                  <span class="num" :style="{ color: getDeviceValueColor(getDeviceId(d), r.name) }">{{ getDeviceValue(getDeviceId(d), r.name) }}</span>
                  <span v-if="getDeviceQuality(getDeviceId(d), r.name) != null" class="quality-dot" :style="{ background: getQualityColor(getDeviceQuality(getDeviceId(d), r.name)) }" :title="getQualityLabel(getDeviceQuality(getDeviceId(d), r.name))"></span>
                </span>
              </div>
            </div>
            <button v-if="d.device_category === 'mechanical' && d.connected" class="dev-ctrl-btn" :class="d.stopped ? 'start' : 'stop'" @click.stop="toggleDevice(getDeviceId(d), !d.stopped)" :title="d.stopped ? '启动' : '停止'">
              {{ d.stopped ? '▶' : '■' }}
            </button>
          </div>
          <div v-if="pagedDeviceList.length === 0" class="dev-empty">暂无匹配设备</div>
        </div>

        <!-- 分页 -->
        <div v-if="filteredDeviceList.length > devPageSize" class="dev-pager">
          <button class="pager-btn" :disabled="devPage <= 1" @click="devPage = 1" title="首页">«</button>
          <button class="pager-btn" :disabled="devPage <= 1" @click="devPage--">‹</button>
          <span class="pager-info">{{ (devPage-1)*devPageSize+1 }}-{{ Math.min(devPage*devPageSize, filteredDeviceList.length) }} / 共 {{ filteredDeviceList.length }} 台</span>
          <button class="pager-btn" :disabled="devPage >= devTotalPages" @click="devPage++">›</button>
          <button class="pager-btn" :disabled="devPage >= devTotalPages" @click="devPage = devTotalPages" title="末页">»</button>
        </div>
      </div>

      <!-- 报警面板 -->
      <div class="alarm-panel">
        <div class="alarm-header">
          <span>实时报警</span>
          <span class="alarm-badges">
            <span class="badge-crit">CRIT: {{ kpi.crit }}</span>
            <span class="badge-high">HIGH: {{ kpi.high }}</span>
            <span class="badge-med">MED: {{ kpi.med }}</span>
          </span>
        </div>
        <div class="alarm-list">
          <div v-if="alarms.length === 0" class="alarm-empty">暂无活动报警</div>
          <div v-for="a in alarms.slice(0, 20)" :key="a.id || a.alarm_id" class="alarm-row" :class="{ unacked: !a.acknowledged }">
            <span class="alarm-prio" :class="getAlarmLevel(a.alarm_level)">{{ getAlarmPrioText(a.alarm_level) }}</span>
            <span class="alarm-time">{{ formatAlarmTime(a.last_trigger_time || a.timestamp) }}</span>
            <span class="alarm-device">{{ (a.device_id || '').substring(0, 12) }}</span>
            <span class="alarm-msg">{{ a.alarm_message || a.id }}</span>
            <span class="alarm-pv">{{ getAlarmPV(a) }}</span>
            <span v-if="(a.trigger_count || 1) > 1" class="alarm-count">×{{ a.trigger_count }}</span>
            <button v-if="!a.acknowledged" class="alarm-ack-btn" @click="ackAlarm(a.id || a.alarm_id || '', a.device_id, a.register_name)">确认</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 趋势图 -->
    <div class="trend-area">
      <div class="trend-header">
        <span class="trend-title">实时趋势</span>
        <div style="display:flex;gap:6px;align-items:center">
          <select v-model="selectedDeviceId" @change="onDeviceChange" class="trend-device-select">
            <option v-for="d in allDeviceList" :key="getDeviceId(d)" :value="getDeviceId(d)">{{ d.name || d.device_id }}</option>
          </select>
          <button class="trend-btn" @click="exportChartData">📊 导出图表</button>
          <button class="trend-btn" @click="exportAllData">📥 导出全部</button>
        </div>
      </div>
      <div ref="trendChartRef" class="trend-chart"></div>
    </div>

    <!-- 状态栏 -->
    <div class="status-bar">
      <span class="status-dot" :class="statusDotClass"></span>
      <span>{{ statusText }}</span>
      <span class="status-db">DB: {{ kpi.dbRecords.toLocaleString() }} 条</span>
      <span class="status-right">
        <router-link to="/users" class="status-link">{{ userName }}</router-link>
        <router-link to="/screen" class="status-link">大屏</router-link>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive, watch } from 'vue'
import * as echarts from 'echarts'
import { io } from 'socket.io-client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { systemApi, devicesApi, dataApi, alarmsApi, industry40Api, type DeviceStatus, type SystemStatus, type Alarm } from '@/api'
import { getAuthToken } from '@/api/request'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()

// ========== 状态 ==========
const allDeviceList = ref<DeviceStatus[]>([])
const alarms = ref<Alarm[]>([])
const latestAlarm = ref<Alarm | null>(null)
const selectedDeviceId = ref('')
const userName = ref('用户')
const trendChartRef = ref<HTMLElement>()
let trendChart: echarts.ECharts | null = null
let socket: ReturnType<typeof io> | null = null
let loadTimer: ReturnType<typeof setInterval>
let loadDataInProgress = false
let loadGeneration = 0

const deviceCache: Record<string, DeviceStatus> = {}
const dataBuffers: Record<string, Array<{ t: string; v: number }>> = {}
const deviceValues = reactive<Record<string, number>>({})
const deviceQuality = reactive<Record<string, number>>({})
const MAX_CHART_POINTS = 200

// ========== 筛选 + 分页 ==========
const devFilter = ref('all')
const devProtocolFilter = ref('')
const devPage = ref(1)
// 监听协议筛选变化时重置分页
watch(devProtocolFilter, () => { devPage.value = 1 })
const devPageSize = 50

const onlineCount = computed(() => allDeviceList.value.filter(d => d.connected).length)
const offlineCount = computed(() => allDeviceList.value.filter(d => !d.connected).length)
const faultCount = computed(() => allDeviceList.value.filter(d => d.status === 'fault' || d.status === 'warning').length)
const mechanicalCount = computed(() => allDeviceList.value.filter(d => d.device_category === 'mechanical').length)
const protocolList = computed(() => Array.from(new Set(allDeviceList.value.map(d => d.protocol || 'modbus_tcp'))).sort())
const filteredDeviceList = computed(() => {
  let list = allDeviceList.value
  if (devFilter.value === 'online') list = list.filter(d => d.connected)
  else if (devFilter.value === 'offline') list = list.filter(d => !d.connected)
  else if (devFilter.value === 'fault') list = list.filter(d => d.status === 'fault' || d.status === 'warning')
  else if (devFilter.value === 'mechanical') list = list.filter(d => d.device_category === 'mechanical')
  if (devProtocolFilter.value) list = list.filter(d => (d.protocol || 'modbus_tcp') === devProtocolFilter.value)
  return list
})
const devTotalPages = computed(() => Math.max(1, Math.ceil(filteredDeviceList.value.length / devPageSize)))
const pagedDeviceList = computed(() => {
  const start = (devPage.value - 1) * devPageSize
  return filteredDeviceList.value.slice(start, start + devPageSize)
})
function setDevFilter(f: string) { devFilter.value = f; devPage.value = 1 }

// ========== KPI ==========
const kpi = reactive({
  oee: 0, online: 0, total: 0, alarmCount: 0, unacked: 0, crit: 0, high: 0, med: 0,
  rate: 0, quality: 100, uptime: '-', mode: '模拟模式', dbRecords: 0,
})
const statusDotClass = ref('status-dot green')
const statusText = ref('系统运行中')

// ========== 报警横幅 ==========
const bannerStyle = computed(() => {
  if (!latestAlarm.value) return {}
  const lvl = latestAlarm.value.alarm_level
  const bg = lvl === 'critical' ? '#dc2626' : lvl === 'warning' ? '#ea580c' : '#ca8a04'
  return { background: bg, color: '#fff' }
})
function dismissBanner() { latestAlarm.value = null }

// ========== 生命周期 ==========
onMounted(() => {
  initTrendChart()
  connectSocket()
  loadData()
  loadOEE()
  loadUserName()
  loadTimer = setInterval(loadData, 5000)
})

onUnmounted(() => {
  trendChart?.dispose()
  socket?.disconnect()
  clearInterval(loadTimer)
})

// ========== 数据加载 ==========
async function loadData() {
  if (loadDataInProgress) return
  loadDataInProgress = true
  const gen = ++loadGeneration
  try {
    // 1. 先加载 realtime 数据填充缓存（确保首次不显示 "--"）
    try {
      const data = await dataApi.getRealtime() as any
      if (gen !== loadGeneration) return
      if (data?.data) {
        data.data.forEach((item: any) => {
          if (item.device_id && item.register_name && item.value != null) {
            deviceValues[`${item.device_id}:${item.register_name}`] = parseFloat(item.value)
          }
        })
        updateTrendChart(data.data)
      }
    } catch (e: any) { console.warn('[Dashboard] 加载失败:', e?.message || e) }

    // 2. 加载系统状态
    try {
      const status = await systemApi.getStatus()
      if (gen !== loadGeneration) return
      updateKPI(status)
      updateDeviceGrid(status)
      updateStatusBar(status)
    } catch (e: any) {
      console.warn('[Dashboard] 系统状态加载失败:', e?.message || e)
      statusDotClass.value = 'status-dot red'
      statusText.value = '连接异常'
    }

    // 3. 加载报警
    try {
      const alarmData = await alarmsApi.getAll({ limit: 50 })
      if (gen !== loadGeneration) return
      if (alarmData?.alarms) {
        alarms.value = alarmData.alarms
        latestAlarm.value = alarmData.alarms.find((a: Alarm) => !a.acknowledged) || null
        const unacked = alarmData.alarms.filter((a: Alarm) => !a.acknowledged).length
        kpi.unacked = unacked
      }
    } catch (e: any) { console.warn('[Dashboard] 加载失败:', e?.message || e) }
  } finally {
    loadDataInProgress = false
  }
}

async function loadOEE() {
  try {
    const data = await industry40Api.getOEE() as any
    if (data?.devices?.length) {
      kpi.oee = Math.round(data.devices.reduce((s: number, d: any) => s + d.oee_percent, 0) / data.devices.length)
    }
  } catch (e: any) { console.warn('[Dashboard] 加载失败:', e?.message || e) }
}

function loadUserName() {
  userName.value = authStore.user?.display_name || authStore.user?.username || '用户'
}

// ========== KPI 更新 ==========
function updateKPI(stats: SystemStatus) {
  if (stats.devices) {
    const devs = Array.isArray(stats.devices) ? stats.devices : Object.values(stats.devices)
    kpi.online = devs.filter(d => d.connected).length
    kpi.total = devs.length
  }
  if (stats.alarms) {
    kpi.alarmCount = stats.alarms.total_active_alarms || 0
    const bl = stats.alarms.by_level || {}
    kpi.crit = bl.critical || 0
    kpi.high = bl.high || bl.warning || 0
    kpi.med = bl.medium || 0
  }
  if (stats.collector) {
    const c = stats.collector
    kpi.rate = Math.floor((c.total_collections || 0) / Math.max((stats.uptime_seconds || 1) / 60, 1))
    const total = (c.successful_collections || 0) + (c.failed_collections || 0)
    kpi.quality = total > 0 ? Math.round(c.successful_collections / total * 100) : 100
  }
  if (stats.uptime_seconds !== undefined) {
    kpi.uptime = formatUptime(stats.uptime_seconds)
    kpi.mode = stats.simulation_mode ? '模拟模式' : '真实设备'
  }
  if (stats.database) kpi.dbRecords = stats.database.total_records || 0
}

function updateDeviceGrid(stats: SystemStatus) {
  if (!stats.devices) return
  const devs = Array.isArray(stats.devices) ? stats.devices : Object.values(stats.devices)
  // 合并而非覆盖：保留已有的 host、port 等静态字段
  const activeIds = new Set<string>()
  devs.forEach(d => {
    const id = d.device_id || d.id || ''
    activeIds.add(id)
    const existing = deviceCache[id]
    if (existing) {
      // 合并：新数据覆盖旧数据，但保留旧数据中有而新数据中没有的字段
      deviceCache[id] = { ...existing, ...d }
      // 如果新数据没有 host 但旧数据有，保留旧的 host
      if (!d.host && existing.host) deviceCache[id].host = existing.host
      if (!(d as any).port && (existing as any).port) (deviceCache[id] as any).port = (existing as any).port
    } else {
      deviceCache[id] = d
    }
  })
  // 清除已删除的设备
  Object.keys(deviceCache).forEach(id => {
    if (!activeIds.has(id)) delete deviceCache[id]
  })
  allDeviceList.value = Object.values(deviceCache)
  if (!selectedDeviceId.value && allDeviceList.value.length > 0) selectedDeviceId.value = allDeviceList.value[0].device_id || allDeviceList.value[0].id || ''
  if (socket?.connected) {
    devs.forEach(d => { const id = d.device_id || d.id; if (id) socket!.emit('subscribe', { device_id: id }) })
  }
}

function updateStatusBar(_stats: SystemStatus) {
  statusDotClass.value = 'status-dot green'
  statusText.value = '系统运行中'
}

// ========== 设备卡片 ==========
function getDeviceId(d: DeviceStatus): string { return d.device_id || d.id || '' }
function getDeviceStatusClass(d: DeviceStatus): string {
  if (!d.connected) return 'offline'
  if (d.stopped) return 'stopped'
  if (d.status === 'fault' || d.status === 'warning') return 'warning'
  return 'online'
}
function getDeviceStatusText(d: DeviceStatus): string {
  if (!d.connected) return '离线'
  if (d.stopped) return '已停止'
  if (d.status === 'fault' || d.status === 'warning') return '告警'
  return '运行中'
}
function getDeviceValue(deviceId: string, regName: string): string {
  const v = deviceValues[`${deviceId}:${regName}`]
  return v !== undefined ? v.toFixed(1) : '--'
}
function getDeviceValueColor(deviceId: string, regName: string): string {
  const q = deviceQuality[`${deviceId}:${regName}`]
  if (q == null) return '#1a1a2e'
  return q >= 192 ? '#22c55e' : q >= 64 ? '#f59e0b' : '#ef4444'
}
function getDeviceQuality(deviceId: string, regName: string): number | null {
  const q = deviceQuality[`${deviceId}:${regName}`]
  return q != null ? q : null
}

// ========== 设备控制 ==========
async function toggleDevice(deviceId: string, stop: boolean) {
  const action = stop ? '停止' : '启动'
  try {
    await ElMessageBox.confirm(`确认${action}设备 ${deviceId}？`, '设备控制', { type: 'warning' })
  } catch { return }
  try {
    const data = stop ? await devicesApi.stop(deviceId) : await devicesApi.start(deviceId)
    if (data.success) loadData()
    else ElMessage.error(data.message || '操作失败')
  } catch (e: any) { ElMessage.error('操作异常: ' + e.message) }
}

// ========== 报警 ==========
function getAlarmLevel(level: string): string { return level === 'critical' ? 'critical' : level === 'warning' ? 'warning' : 'low' }
function getAlarmPrioText(level: string): string { return level === 'critical' ? 'CRIT' : level === 'warning' ? 'HIGH' : 'LOW' }
function formatAlarmTime(t: string): string { return t ? new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-' }
function getAlarmPV(a: any): string { const v = a.last_value != null ? a.last_value : a.actual_value; return v != null ? `PV:${parseFloat(v).toFixed(1)}` : '' }
async function ackAlarm(alarmId: string, deviceId: string, regName: string) {
  if (!alarmId) return
  try { await alarmsApi.acknowledge(alarmId, deviceId, regName); loadData() } catch (e: any) { console.error('[Dashboard] 操作失败:', e); ElMessage.error('操作失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}

// ========== 工具函数 ==========
function formatUptime(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}天${h}时` : h > 0 ? `${h}时${m}分` : `${m}分`
}
function getShortLabel(name: string): string {
  const map: Record<string, string> = {
    'boiler_temperature': '锅炉温度', 'boiler_pressure': '锅炉压力',
    'heat_exchanger_temperature': '换热器温度', 'flue_gas_temperature': '排烟温度',
    'steam_flow': '蒸汽流量', 'feed_water_level': '给水液位',
    'oxygen_content': '含氧量', 'boiler_status': '锅炉状态',
    'mold_temperature': '模具温度', 'injection_pressure': '注射压力',
    'injection_speed': '注射速度', 'barrel_temperature': '料筒温度',
    'spray_pressure': '喷涂压力', 'oven_temperature': '烘干温度',
    'voltage_a': 'A相电压', 'current_a': 'A相电流',
    'active_power': '总有功', 'frequency': '频率',
    'temperature': '温度', 'pressure': '压力',
    'flow': '流量', 'level': '液位',
    'voltage': '电压', 'current': '电流', 'power': '功率',
  }
  if (map[name]) return map[name]
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(map)) { if (lower.includes(k)) return v }
  return name.length > 6 ? name.slice(0, 6) : name
}
function getQualityColor(q: number | null): string {
  if (q == null) return '#999'
  return q >= 192 ? '#52c41a' : q >= 64 ? '#faad14' : '#ff4d4f'
}
function getQualityLabel(q: number | null): string {
  if (q == null) return ''
  return q >= 192 ? 'Good' : q >= 64 ? 'Uncertain' : 'Bad'
}

// ========== 趋势图 ==========
function selectDevice(id: string) {
  selectedDeviceId.value = id
  // 不清空历史数据，切换设备后趋势图自动显示新设备的数据
  updateTrendChart()
}
function onDeviceChange() {
  // 不清空历史数据，保留所有设备的趋势记录
  updateTrendChart()
}

function initTrendChart() {
  if (!trendChartRef.value) return
  trendChart = echarts.init(trendChartRef.value)
}

function updateTrendChart(data: any[]) {
  if (!trendChart || !selectedDeviceId.value) return
  const now = new Date().toTimeString().slice(0, 8)
  let matched = 0
  data.forEach((item: any) => {
    if (item.device_id !== selectedDeviceId.value) return
    if (item.value === null || item.value === undefined) return
    const key = item.register_name
    if (!dataBuffers[key]) dataBuffers[key] = []
    dataBuffers[key].push({ t: now, v: parseFloat(item.value) })
    if (dataBuffers[key].length > MAX_CHART_POINTS) dataBuffers[key].shift()
    matched++
  })
  if (matched === 0) return
  const keys = Object.keys(dataBuffers)
  const timeSet = new Set<string>()
  keys.forEach(k => dataBuffers[k].forEach(d => timeSet.add(d.t)))
  const times = Array.from(timeSet).sort().slice(-MAX_CHART_POINTS)
  const colors = ['#6366f1', '#06b6d4', '#f59e0b', '#ef4444', '#22c55e', '#ec4899']
  trendChart.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: '#e2e5ea', textStyle: { color: '#1a1a2e', fontSize: 11 } },
    legend: { top: 0, right: 0, textStyle: { color: '#666', fontSize: 11 }, itemWidth: 12, itemHeight: 2 },
    grid: { left: 50, right: 10, top: 25, bottom: 20 },
    xAxis: { type: 'category', data: times, boundaryGap: false, axisLine: { lineStyle: { color: '#e2e5ea' } }, axisLabel: { color: '#999', fontSize: 10 }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLine: { show: false }, axisLabel: { color: '#999', fontSize: 10 }, splitLine: { lineStyle: { color: '#f0f0f0' } } },
    series: keys.map((key, i) => {
      const map: Record<string, number> = {}
      dataBuffers[key].forEach(d => { map[d.t] = d.v })
      return { name: getShortLabel(key), type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 1.5, color: colors[i % colors.length] }, data: times.map(t => map[t] ?? null) }
    }),
  })
}

// ========== CSV 导出（客户端生成） ==========
function exportChartData() {
  if (!selectedDeviceId.value || !Object.keys(dataBuffers).length) { ElMessage.error('无数据可导出'); return }
  const keys = Object.keys(dataBuffers)
  const timeSet = new Set<string>()
  keys.forEach(k => dataBuffers[k].forEach(d => timeSet.add(d.t)))
  const times = Array.from(timeSet).sort()
  const escCSV = (v: string) => v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v
  let csv = '﻿时间,' + keys.map(k => escCSV(getShortLabel(k))).join(',') + '\n'
  times.forEach(t => {
    csv += escCSV(t) + ',' + keys.map(k => { const d = dataBuffers[k].find(x => x.t === t); return d ? d.v.toFixed(2) : '' }).join(',') + '\n'
  })
  downloadCSV(csv, `trend_${selectedDeviceId.value}_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`)
}

async function exportAllData() {
  try {
    const data = await dataApi.getRealtime() as any
    if (!data?.data?.length) { ElMessage.error('无数据可导出'); return }
    const escCSV = (v: string) => (v.includes(',') || v.includes('"') || v.includes('\n')) ? `"${v.replace(/"/g, '""')}"` : String(v ?? '')
    let csv = '﻿设备ID,寄存器,值,单位,时间\n'
    data.data.forEach((item: any) => {
      csv += `${escCSV(item.device_id)},${escCSV(item.register_name)},${item.value},${escCSV(item.unit||'')},${escCSV(item.timestamp)}\n`
    })
    downloadCSV(csv, `all_devices_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`)
  } catch (e: any) { console.error('[Dashboard] 操作失败:', e); ElMessage.error('导出失败') }
}

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

// ========== WebSocket ==========
function connectSocket() {
  const baseUrl = import.meta.env.DEV ? window.location.origin : 'http://localhost:5000'
  const token = getAuthToken()
  // token 通过 query 传递 — 后端从 request.args.get('token') 读取
  const socketUrl = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl
  socket = io(socketUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 3000,
    reconnectionAttempts: Infinity,
  })
  socket.on('connect', () => {
    statusDotClass.value = 'status-dot green'
    statusText.value = '系统运行中'
    allDeviceList.value.forEach(d => { const id = getDeviceId(d); if (id) socket?.emit('subscribe', { device_id: id }) })
  })
  socket.on('disconnect', () => {
    statusDotClass.value = 'status-dot yellow'
    statusText.value = '实时连接断开，降级为轮询模式（每2秒刷新）'
    // WebSocket断开时增加轮询频率（从5秒降到2秒）
    clearInterval(loadTimer)
    loadTimer = setInterval(loadData, 2000)
  })
  socket.on('reconnect', () => {
    statusDotClass.value = 'status-dot green'
    statusText.value = '系统运行中'
    // 恢复正常轮询频率
    clearInterval(loadTimer)
    loadTimer = setInterval(loadData, 5000)
  })
  socket.on('data_update', (data: any) => {
    if (!data) return
    // 兼容两种格式：单对象 或 {register_name: {device_id, ...}} 映射
    if (data.device_id && data.register_name && data.value != null) {
      // 单对象格式
      deviceValues[`${data.device_id}:${data.register_name}`] = parseFloat(data.value)
      if (data.quality != null) deviceQuality[`${data.device_id}:${data.register_name}`] = data.quality
    } else {
      // 映射格式：{register_name: {device_id, register_name, value, quality}}
      Object.entries(data).forEach(([regName, info]: [string, any]) => {
        if (!info || typeof info !== 'object') return
        const devId = info.device_id
        const val = info.value
        if (!devId || val == null) return
        deviceValues[`${devId}:${regName}`] = parseFloat(val)
        if (info.quality != null) deviceQuality[`${devId}:${regName}`] = info.quality
      })
    }
  })
  socket.on('device_status', (data: any) => {
    if (!data?.device_id) return
    const dev = allDeviceList.value.find(d => getDeviceId(d) === data.device_id)
    if (dev) {
      dev.connected = data.status?.connected ?? dev.connected
      dev.status = data.status?.status ?? dev.status
    }
  })
  socket.on('alarm', (data: any) => {
    if (data?.alarm_id) {
      // 实时插入报警到列表顶部
      alarms.value.unshift(data)
      if (alarms.value.length > 50) alarms.value.pop()
      latestAlarm.value = data
    } else {
      loadData()
    }
  })
}
</script>

<style scoped>
.dashboard { display: flex; flex-direction: column; height: calc(100vh - 60px); gap: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

/* KPI */
.kpi-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; padding: 8px 12px; background: #fff; border-bottom: 1px solid #e2e5ea; }
.kpi { padding: 8px 12px; border-left: 3px solid transparent; border-radius: 4px; }
.kpi.warn { border-left-color: #eab308; }
.kpi.alarm { border-left-color: #ef4444; }
.kpi-label { font-size: 11px; color: #999; text-transform: uppercase; }
.kpi-value { font-size: 20px; font-weight: 600; color: #1a1a2e; }
.kpi-value small { font-size: 11px; color: #999; }
.kpi-sub { font-size: 10px; color: #999; margin-top: 2px; }

/* 报警横幅 */
.alarm-banner { padding: 6px 16px; cursor: pointer; animation: banner-flash 2s infinite; }
@keyframes banner-flash { 0%,100% { opacity: 1; } 50% { opacity: 0.85; } }
.banner-content { display: flex; align-items: center; gap: 8px; font-size: 12px; }
.banner-icon { font-size: 16px; }
.banner-text { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.banner-device { font-size: 11px; opacity: 0.8; }
.banner-close { background: none; border: none; font-size: 16px; cursor: pointer; opacity: 0.7; padding: 0 4px; }

/* 主区域 */
.main-area { display: grid; grid-template-columns: 1fr 1fr; gap: 0; flex: 1; min-height: 0; overflow: auto; }
.device-panel { display: flex; flex-direction: column; overflow: hidden; }

/* 筛选栏 */
.dev-filter-bar { display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: #f8f9fa; border-bottom: 1px solid #e2e5ea; gap: 8px; flex-wrap: wrap; }
.dev-filter-tabs { display: flex; gap: 4px; }
.dev-tab { padding: 4px 10px; border: 1px solid #ddd; border-radius: 4px; background: #fff; cursor: pointer; font-size: 11px; color: #555; transition: all 0.15s; }
.dev-tab:hover { border-color: #6366f1; color: #6366f1; }
.dev-tab.active { background: #6366f1; color: #fff; border-color: #6366f1; }
.dev-filter-right { display: flex; align-items: center; gap: 8px; }
.dev-proto-select { padding: 3px 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 11px; background: #fff; }
.dev-count-badge { font-size: 11px; color: #666; background: #e8e8e8; padding: 2px 8px; border-radius: 10px; }

/* 设备网格 */
.device-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px; padding: 8px; overflow-y: auto; align-content: start; }
.dev-card { display: flex; align-items: stretch; background: #fff; border: 1px solid #e2e5ea; border-radius: 6px; cursor: pointer; transition: border-color 0.2s; position: relative; min-height: 60px; }
.dev-card:hover { border-color: #6366f1; }
.dev-status { width: 6px; border-radius: 6px 0 0 6px; }
.dev-status.online { background: #22c55e; }
.dev-status.stopped { background: #a855f7; }
.dev-status.warning { background: #f59e0b; }
.dev-status.fault { background: #ef4444; }
.dev-status.offline { background: #9ca3af; }
.dev-info { flex: 1; padding: 6px 8px; min-width: 0; }
.dev-name { font-size: 12px; font-weight: 600; color: #1a1a2e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dev-state-tag { font-size: 9px; padding: 1px 4px; border-radius: 3px; font-weight: 500; }
.dev-state-tag.online { background: #dcfce7; color: #166534; }
.dev-state-tag.stopped { background: #f3e8ff; color: #6b21a8; }
.dev-state-tag.warning { background: #fef3c7; color: #92400e; }
.dev-state-tag.fault { background: #fee2e2; color: #991b1b; }
.dev-state-tag.offline { background: #f3f4f6; color: #6b7280; }
.dev-zone-tag { font-size: 9px; padding: 1px 4px; border-radius: 3px; background: #e0f2fe; color: #075985; margin-left: 4px; }
.dev-meta { font-size: 10px; color: #999; margin-top: 1px; }
.dev-values { display: flex; gap: 10px; margin-top: 3px; }
.dev-val .label { font-size: 10px; color: #999; }
.dev-val .num { font-size: 13px; font-weight: 600; margin-left: 2px; }
.quality-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-left: 2px; vertical-align: middle; }
.dev-ctrl-btn { width: 28px; height: 28px; border-radius: 50%; border: 2px solid; font-size: 12px; cursor: pointer; align-self: center; margin-right: 8px; display: flex; align-items: center; justify-content: center; }
.dev-ctrl-btn.start { border-color: #22c55e; color: #22c55e; background: transparent; }
.dev-ctrl-btn.stop { border-color: #ef4444; color: #ef4444; background: transparent; }
.dev-empty { grid-column: 1 / -1; text-align: center; color: #999; padding: 40px 0; font-size: 13px; }

/* 分页 */
.dev-pager { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 8px 10px; border-top: 1px solid #e2e5ea; background: #f8f9fa; }
.pager-btn { padding: 4px 10px; border: 1px solid #ddd; border-radius: 4px; background: #fff; cursor: pointer; font-size: 12px; color: #555; min-width: 28px; }
.pager-btn:hover:not(:disabled) { border-color: #6366f1; color: #6366f1; }
.pager-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pager-info { font-size: 12px; color: #666; }

/* 报警面板 */
.alarm-panel { border-left: 1px solid #e2e5ea; display: flex; flex-direction: column; }
.alarm-header { padding: 8px 12px; font-weight: 600; font-size: 13px; border-bottom: 1px solid #e2e5ea; display: flex; align-items: center; gap: 12px; }
.alarm-badges { display: flex; gap: 8px; }
.badge-crit { font-size: 10px; color: #ef4444; font-weight: 600; }
.badge-high { font-size: 10px; color: #f59e0b; font-weight: 600; }
.badge-med { font-size: 10px; color: #3b82f6; font-weight: 600; }
.alarm-list { flex: 1; overflow-y: auto; padding: 4px; }
.alarm-empty { padding: 20px; text-align: center; color: #999; font-size: 13px; }
.alarm-row { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-bottom: 1px solid #f0f0f0; font-size: 11px; }
.alarm-row.unacked { animation: alarm-flash 2s infinite; }
@keyframes alarm-flash { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
.alarm-prio { font-size: 10px; font-weight: 700; padding: 1px 4px; border-radius: 3px; min-width: 36px; text-align: center; }
.alarm-prio.critical { background: #fee2e2; color: #991b1b; }
.alarm-prio.warning { background: #fef3c7; color: #92400e; }
.alarm-prio.low { background: #e0f2fe; color: #075985; }
.alarm-time { color: #999; min-width: 55px; }
.alarm-device { color: #666; min-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.alarm-msg { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #1a1a2e; }
.alarm-pv { color: #6366f1; font-weight: 600; min-width: 55px; }
.alarm-count { font-size: 10px; background: #f3f4f6; padding: 1px 4px; border-radius: 3px; color: #666; }
.alarm-ack-btn { font-size: 10px; padding: 2px 6px; border: 1px solid #6366f1; color: #6366f1; background: transparent; border-radius: 3px; cursor: pointer; }
.alarm-ack-btn:hover { background: #6366f1; color: #fff; }

/* 趋势图 */
.trend-area { background: #fff; border-top: 1px solid #e2e5ea; padding: 4px 12px 8px; }
.trend-header { margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between; }
.trend-title { font-size: 12px; font-weight: 600; color: #333; }
.trend-device-select { font-size: 12px; padding: 2px 8px; border: 1px solid #d1d5db; border-radius: 4px; }
.trend-btn { font-size: 11px; padding: 2px 8px; border: 1px solid #ddd; border-radius: 4px; background: #fff; cursor: pointer; }
.trend-btn:hover { border-color: #6366f1; color: #6366f1; }
.trend-chart { height: 180px; }

/* 状态栏 */
.status-bar { display: flex; align-items: center; gap: 8px; padding: 4px 12px; background: #f9fafb; border-top: 1px solid #e2e5ea; font-size: 11px; color: #666; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; }
.status-dot.green { background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,0.6); }
.status-dot.red { background: #ef4444; box-shadow: 0 0 6px rgba(239,68,68,0.6); }
.status-dot.yellow { background: #eab308; box-shadow: 0 0 6px rgba(234,179,8,0.6); }
.status-right { margin-left: auto; display: flex; gap: 12px; }
.status-link { color: #6366f1; text-decoration: none; font-size: 11px; }
.status-link:hover { text-decoration: underline; }
</style>
