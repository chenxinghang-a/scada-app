<template>
  <div class="dashboard">
    <!-- KPI 行 -->
    <div class="kpi-row">
      <div class="kpi" :class="{ warn: kpi.online < kpi.total }">
        <div class="kpi-label">设备</div>
        <div class="kpi-value"><span id="kpi-online">{{ kpi.online }}</span> / <span id="kpi-total">{{ kpi.total }}</span></div>
      </div>
      <div class="kpi" :class="{ alarm: kpi.alarmCount > 0 }">
        <div class="kpi-label">报警</div>
        <div class="kpi-value">{{ kpi.alarmCount }}</div>
        <div class="kpi-badges">
          <span class="badge-crit">CRIT: {{ kpi.crit }}</span>
          <span class="badge-high">HIGH: {{ kpi.high }}</span>
          <span class="badge-med">MED: {{ kpi.med }}</span>
        </div>
      </div>
      <div class="kpi">
        <div class="kpi-label">采集率</div>
        <div class="kpi-value">{{ kpi.rate }} <small>次/分</small></div>
      </div>
      <div class="kpi">
        <div class="kpi-label">数据质量</div>
        <div class="kpi-value">{{ kpi.quality }}%</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">运行时间</div>
        <div class="kpi-value">{{ kpi.uptime }}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">模式</div>
        <div class="kpi-value mode-badge" :class="kpi.mode === '模拟模式' ? 'sim' : 'real'">{{ kpi.mode }}</div>
      </div>
    </div>

    <!-- 主区域：设备网格 + 报警面板 -->
    <div class="main-area">
      <!-- 设备卡片网格（带分类筛选 + 分页） -->
      <div class="device-panel">
        <!-- 分类筛选栏 -->
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

        <!-- 设备卡片网格 -->
        <div class="device-grid">
          <div v-for="d in pagedDeviceList" :key="getDeviceId(d)" class="dev-card" :class="getDeviceClass(d)" @click="selectDevice(getDeviceId(d))">
            <div class="dev-status" :class="getDeviceStatusClass(d)"></div>
            <div class="dev-info">
              <div class="dev-name">{{ d.name || d.device_id }} <span class="dev-state-tag" :class="getDeviceStatusClass(d)">{{ getDeviceStatusText(d) }}</span></div>
              <div class="dev-meta">{{ d.protocol || 'modbus_tcp' }} · {{ d.host || '' }}</div>
              <div class="dev-values">
                <span v-for="r in (d.registers || []).slice(0, 3)" :key="r.name" class="dev-val">
                  <span class="label">{{ getShortLabel(r.name) }}</span>
                  <span class="num">{{ getDeviceValue(getDeviceId(d), r.name) }}</span>
                </span>
              </div>
            </div>
            <button v-if="d.device_category === 'mechanical' && d.connected" class="dev-ctrl-btn" :class="d.stopped ? 'start' : 'stop'" @click.stop="toggleDevice(getDeviceId(d), !d.stopped)" :title="d.stopped ? '启动' : '停止'">
              {{ d.stopped ? '▶' : '■' }}
            </button>
          </div>
          <div v-if="pagedDeviceList.length === 0" class="dev-empty">暂无匹配设备</div>
        </div>

        <!-- 分页控件 -->
        <div v-if="filteredDeviceList.length > devPageSize" class="dev-pager">
          <button class="pager-btn" :disabled="devPage <= 1" @click="devPage--">‹ 上一页</button>
          <span class="pager-info">{{ devPage }} / {{ devTotalPages }}</span>
          <button class="pager-btn" :disabled="devPage >= devTotalPages" @click="devPage++">下一页 ›</button>
        </div>
      </div>

      <!-- 报警面板 -->
      <div class="alarm-panel">
        <div class="alarm-header">
          <span>报警</span>
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
        <select v-model="selectedDeviceId" @change="onDeviceChange" class="trend-device-select">
          <option v-for="d in allDeviceList" :key="getDeviceId(d)" :value="getDeviceId(d)">{{ d.name || d.device_id }}</option>
        </select>
      </div>
      <div ref="trendChartRef" class="trend-chart"></div>
    </div>

    <!-- 状态栏 -->
    <div class="status-bar">
      <span class="status-dot" :class="statusDotClass"></span>
      <span id="status-text">{{ statusText }}</span>
      <span class="status-db">DB: {{ kpi.dbRecords.toLocaleString() }} 条</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive } from 'vue'
import * as echarts from 'echarts'
import { io } from 'socket.io-client'
import { systemApi, type DeviceStatus, type SystemStatus } from '@/api'
import { alarmsApi, type Alarm } from '@/api'
import api from '@/api/request'

const allDeviceList = ref<DeviceStatus[]>([])
const alarms = ref<Alarm[]>([])
const selectedDeviceId = ref('')
const trendChartRef = ref<HTMLElement>()
let trendChart: echarts.ECharts | null = null
let socket: ReturnType<typeof io> | null = null
let loadTimer: ReturnType<typeof setInterval>

const deviceCache: Record<string, DeviceStatus> = {}
const dataBuffers: Record<string, Array<{ t: string; v: number }>> = {}
const deviceValues: Record<string, number> = {}
const MAX_POINTS = 60

// ========== 设备分类筛选 + 分页 ==========
const devFilter = ref('all')
const devProtocolFilter = ref('')
const devPage = ref(1)
const devPageSize = 12

const onlineCount = computed(() => allDeviceList.value.filter(d => d.connected).length)
const offlineCount = computed(() => allDeviceList.value.filter(d => !d.connected).length)
const faultCount = computed(() => allDeviceList.value.filter(d => d.status === 'fault' || d.status === 'warning').length)
const mechanicalCount = computed(() => allDeviceList.value.filter(d => d.device_category === 'mechanical').length)

const protocolList = computed(() => {
  const set = new Set(allDeviceList.value.map(d => d.protocol || 'modbus_tcp'))
  return Array.from(set).sort()
})

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

function setDevFilter(f: string) {
  devFilter.value = f
  devPage.value = 1
}

const kpi = reactive({
  online: 0, total: 0, alarmCount: 0, crit: 0, high: 0, med: 0,
  rate: 0, quality: 100, uptime: '-', mode: '模拟模式', dbRecords: 0,
})

const statusDotClass = ref('status-dot green')
const statusText = ref('系统运行中')

onMounted(() => {
  initTrendChart()
  connectSocket()
  loadData()
  loadTimer = setInterval(loadData, 10000)
})

onUnmounted(() => {
  trendChart?.dispose()
  socket?.disconnect()
  clearInterval(loadTimer)
})

async function loadData() {
  try {
    const status = await systemApi.getStatus()
    updateKPI(status)
    updateDeviceGrid(status)
    updateStatusBar(status)
  } catch {
    statusDotClass.value = 'status-dot red'
    statusText.value = '连接异常'
  }

  // 独立 try-catch，一个失败不影响其他
  try {
    const data = await api.get('/data/realtime?limit=5000') as any
    if (data?.data) updateTrendChart(data.data)
  } catch { /* 趋势图数据获取失败不影响主界面 */ }

  try {
    const alarmData = await alarmsApi.getAll({ limit: 50 })
    if (alarmData?.alarms) alarms.value = alarmData.alarms
  } catch { /* 报警数据获取失败不影响主界面 */ }
}

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
  if (stats.database) {
    kpi.dbRecords = stats.database.total_records || 0
  }
}

function updateDeviceGrid(stats: SystemStatus) {
  if (!stats.devices) return
  const devs = Array.isArray(stats.devices) ? stats.devices : Object.values(stats.devices)
  devs.forEach(d => { deviceCache[d.device_id || d.id || ''] = d })
  allDeviceList.value = devs
  if (!selectedDeviceId.value && devs.length > 0) {
    selectedDeviceId.value = devs[0].device_id || devs[0].id || ''
  }
  // 订阅所有设备的 WebSocket 推送（socket 未连接时 emit 会被忽略，connect handler 会重新订阅）
  devs.forEach(d => {
    const id = d.device_id || d.id
    if (id && socket?.connected) socket.emit('subscribe', { device_id: id })
  })
}

function updateStatusBar(stats: SystemStatus) {
  statusDotClass.value = 'status-dot green'
  statusText.value = '系统运行中'
}

function getDeviceId(d: DeviceStatus): string { return d.device_id || d.id || '' }
function getDeviceClass(d: DeviceStatus) { return '' }
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
  const key = `${deviceId}__${regName}`
  return deviceValues[key] !== undefined ? deviceValues[key].toFixed(1) : '--'
}

function selectDevice(id: string) {
  selectedDeviceId.value = id
  Object.keys(dataBuffers).forEach(k => delete dataBuffers[k])
  trendChart?.clear()
}

function onDeviceChange() {
  Object.keys(dataBuffers).forEach(k => delete dataBuffers[k])
  trendChart?.clear()
}

async function toggleDevice(deviceId: string, stop: boolean) {
  const action = stop ? 'stop' : 'start'
  if (!confirm(`确认${stop ? '停止' : '启动'}设备 ${deviceId}？`)) return
  try {
    const data = await api.post(`/devices/${deviceId}/${action}`) as any
    if (data.success) loadData()
    else alert(data.message || '操作失败')
  } catch (e: any) { alert('操作异常: ' + e.message) }
}

function getAlarmLevel(level: string): string {
  return level === 'critical' ? 'critical' : level === 'warning' ? 'warning' : 'low'
}
function getAlarmPrioText(level: string): string {
  return level === 'critical' ? 'CRIT' : level === 'warning' ? 'HIGH' : 'LOW'
}
function formatAlarmTime(t: string): string {
  return t ? new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'
}
function getAlarmPV(a: any): string {
  const v = a.last_value != null ? a.last_value : a.actual_value
  return v != null ? `PV:${parseFloat(v).toFixed(1)}` : ''
}

async function ackAlarm(alarmId: string, deviceId: string, regName: string) {
  if (!alarmId) return
  try {
    await alarmsApi.acknowledge(alarmId, deviceId, regName)
    loadData()
  } catch { /* ignore */ }
}

function formatUptime(s: number): string {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}天${h}时`
  if (h > 0) return `${h}时${m}分`
  return `${m}分`
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

// ========== 趋势图 ==========
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
    if (dataBuffers[key].length > MAX_POINTS) dataBuffers[key].shift()
    matched++
  })
  if (matched === 0) return

  const keys = Object.keys(dataBuffers)
  const timeSet = new Set<string>()
  keys.forEach(k => dataBuffers[k].forEach(d => timeSet.add(d.t)))
  const times = Array.from(timeSet).sort().slice(-MAX_POINTS)
  const colors = ['#6366f1', '#06b6d4', '#f59e0b', '#ef4444', '#22c55e', '#ec4899']

  trendChart.setOption({
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: '#e2e5ea', textStyle: { color: '#1a1a2e', fontSize: 11 } },
    legend: { top: 0, right: 0, textStyle: { color: '#666', fontSize: 11 }, itemWidth: 12, itemHeight: 2 },
    grid: { left: 50, right: 10, top: 25, bottom: 20 },
    xAxis: { type: 'category', data: times, boundaryGap: false, axisLine: { lineStyle: { color: '#e2e5ea' } }, axisLabel: { color: '#999', fontSize: 10 }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLine: { show: false }, axisLabel: { color: '#999', fontSize: 10 }, splitLine: { lineStyle: { color: '#f0f0f0' } } },
    series: keys.slice(0, 4).map((key, i) => {
      const map: Record<string, number> = {}
      dataBuffers[key].forEach(d => { map[d.t] = d.v })
      return { name: getShortLabel(key), type: 'line', smooth: true, symbol: 'none', lineStyle: { width: 1.5, color: colors[i % colors.length] }, data: times.map(t => map[t] ?? null) }
    }),
  })
}

// ========== WebSocket ==========
function connectSocket() {
  const socketUrl = import.meta.env.DEV ? window.location.origin : 'http://localhost:5000'
  socket = io(socketUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 3000,
    reconnectionAttempts: Infinity,
  })
  socket.on('connect', () => {
    statusDotClass.value = 'status-dot green'
    statusText.value = '系统运行中'
    // 重连后重新订阅所有设备房间
    allDeviceList.value.forEach(d => {
      const id = getDeviceId(d)
      if (id) socket?.emit('subscribe', { device_id: id })
    })
  })
  socket.on('disconnect', () => {
    statusDotClass.value = 'status-dot yellow'
    statusText.value = '连接断开，正在重连...'
  })
  socket.on('data_update', (data: any) => {
    if (data?.device_id && data?.register_name && data.value !== null) {
      deviceValues[`${data.device_id}__${data.register_name}`] = parseFloat(data.value)
    }
    // 同步更新设备列表中的 connected 状态
    const dev = allDeviceList.value.find(d => getDeviceId(d) === data?.device_id)
    if (dev && data?.connected !== undefined) {
      dev.connected = data.connected
    }
  })
  socket.on('device_status', (data: any) => {
    if (data?.device_id) {
      const dev = allDeviceList.value.find(d => getDeviceId(d) === data.device_id)
      if (dev) {
        dev.connected = data.status?.connected ?? dev.connected
        dev.status = data.status?.status ?? dev.status
      }
    }
  })
  socket.on('alarm', () => loadData())
}
</script>

<style scoped>
.dashboard { display: flex; flex-direction: column; height: calc(100vh - 60px); gap: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

/* KPI 行 */
.kpi-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; padding: 8px 12px; background: #fff; border-bottom: 1px solid #e2e5ea; }
.kpi { padding: 8px 12px; border-left: 3px solid transparent; border-radius: 4px; }
.kpi.warn { border-left-color: #eab308; }
.kpi.alarm { border-left-color: #ef4444; }
.kpi-label { font-size: 11px; color: #999; text-transform: uppercase; }
.kpi-value { font-size: 20px; font-weight: 600; color: #1a1a2e; }
.kpi-value small { font-size: 11px; color: #999; }
.kpi-badges { display: flex; gap: 6px; margin-top: 2px; }
.badge-crit { font-size: 10px; color: #ef4444; font-weight: 600; }
.badge-high { font-size: 10px; color: #f59e0b; font-weight: 600; }
.badge-med { font-size: 10px; color: #3b82f6; font-weight: 600; }

/* 主区域 */
.main-area { display: grid; grid-template-columns: 1fr 1fr; gap: 0; flex: 1; min-height: 0; overflow: hidden; }

/* 设备面板（含筛选栏 + 网格 + 分页） */
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
.device-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px; padding: 8px; overflow-y: auto; align-content: start; max-height: calc(100vh - 320px); }
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
.dev-meta { font-size: 10px; color: #999; margin-top: 1px; }
.dev-values { display: flex; gap: 10px; margin-top: 3px; }
.dev-val .label { font-size: 10px; color: #999; }
.dev-val .num { font-size: 13px; font-weight: 600; color: #1a1a2e; margin-left: 2px; }
.dev-ctrl-btn { width: 28px; height: 28px; border-radius: 50%; border: 2px solid; font-size: 12px; cursor: pointer; align-self: center; margin-right: 8px; display: flex; align-items: center; justify-content: center; }
.dev-ctrl-btn.start { border-color: #22c55e; color: #22c55e; background: transparent; }
.dev-ctrl-btn.stop { border-color: #ef4444; color: #ef4444; background: transparent; }
.dev-empty { grid-column: 1 / -1; text-align: center; color: #999; padding: 40px 0; font-size: 13px; }

/* 分页控件 */
.dev-pager { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 8px 10px; border-top: 1px solid #e2e5ea; background: #f8f9fa; }
.pager-btn { padding: 4px 12px; border: 1px solid #ddd; border-radius: 4px; background: #fff; cursor: pointer; font-size: 12px; color: #555; }
.pager-btn:hover:not(:disabled) { border-color: #6366f1; color: #6366f1; }
.pager-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pager-info { font-size: 12px; color: #666; }

/* 报警面板 */
.alarm-panel { border-left: 1px solid #e2e5ea; display: flex; flex-direction: column; }
.alarm-header { padding: 8px 12px; font-weight: 600; font-size: 13px; border-bottom: 1px solid #e2e5ea; display: flex; align-items: center; gap: 12px; }
.alarm-badges { display: flex; gap: 8px; }
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
.trend-header { margin-bottom: 4px; }
.trend-device-select { font-size: 12px; padding: 2px 8px; border: 1px solid #d1d5db; border-radius: 4px; }
.trend-chart { height: 180px; }

/* 状态栏 */
.mode-badge { font-size: 14px !important; }
.mode-badge.sim { color: #e6a23c; }
.mode-badge.real { color: #67c23a; }

.status-bar { display: flex; align-items: center; gap: 8px; padding: 4px 12px; background: #f9fafb; border-top: 1px solid #e2e5ea; font-size: 11px; color: #666; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; }
.status-dot.green { background: #22c55e; box-shadow: 0 0 6px rgba(34, 197, 94, 0.6); }
.status-dot.red { background: #ef4444; box-shadow: 0 0 6px rgba(239, 68, 68, 0.6); }
.status-dot.yellow { background: #eab308; box-shadow: 0 0 6px rgba(234, 179, 8, 0.6); }
.status-db { margin-left: auto; }
</style>
