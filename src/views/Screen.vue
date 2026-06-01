<template>
  <div class="screen">
    <!-- 顶部 KPI -->
    <div class="screen-topbar">
      <div class="topbar-title"><router-link to="/dashboard" style="color:#fff;text-decoration:none;margin-right:12px">← 返回</router-link>🏭 工业数据大屏</div>
      <div class="topbar-kpi">
        <div class="kpi-item"><span class="kpi-label">设备在线</span><span class="kpi-val">{{ kpi.online }}/{{ kpi.total }}</span></div>
        <div class="kpi-item"><span class="kpi-label">活动报警</span><span class="kpi-val alarm">{{ kpi.alarms }}</span></div>
        <div class="kpi-item"><span class="kpi-label">采集吞吐</span><span class="kpi-val">{{ kpi.rate }} 条/分</span></div>
        <div class="kpi-item"><span class="kpi-label">数据质量</span><span class="kpi-val">{{ kpi.quality }}%</span></div>
        <div class="kpi-item"><span class="kpi-label">运行时间</span><span class="kpi-val">{{ kpi.uptime }}</span></div>
      </div>
      <div class="topbar-clock">{{ clock }}</div>
    </div>

    <!-- 三列布局 -->
    <div class="screen-body">
      <!-- 左列 -->
      <div class="screen-col left">
        <div class="screen-panel"><div class="panel-title">设备状态分布</div><div ref="devicePieRef" class="chart-area"></div></div>
        <div class="screen-panel"><div class="panel-title">OEE 综合效率</div><div ref="oeeGaugeRef" class="chart-area"></div></div>
        <div class="screen-panel"><div class="panel-title">能源消耗趋势</div><div ref="energyBarRef" class="chart-area"></div></div>
      </div>

      <!-- 中列 -->
      <div class="screen-col center">
        <div class="screen-panel main-trend"><div class="panel-title">实时趋势</div><div ref="trendRef" class="chart-area-lg"></div></div>
        <div class="screen-panel"><div class="panel-title">工艺参数</div>
          <div class="params-table">
            <div class="pt-header"><span>设备</span><span>温度</span><span>压力</span><span>功率</span><span>状态</span></div>
            <div v-for="d in devices" :key="d.device_id" class="pt-row">
              <span>{{ d.name || d.device_id }}</span>
              <span>{{ getVal(d.device_id, 'temperature') }}</span>
              <span>{{ getVal(d.device_id, 'pressure') }}</span>
              <span>{{ getVal(d.device_id, 'power') }}</span>
              <span :class="'st-'+(d.connected?'on':'off')">{{ d.connected?'在线':'离线' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 右列 -->
      <div class="screen-col right">
        <div class="screen-panel"><div class="panel-title">实时报警</div>
          <div class="alarm-scroll">
            <div v-for="a in alarms" :key="a.id||a.alarm_id" class="alarm-row" :class="'lvl-'+a.alarm_level">
              <span class="alarm-lvl">{{ a.alarm_level==='critical'?'CRIT':a.alarm_level==='warning'?'HIGH':'LOW' }}</span>
              <span class="alarm-msg">{{ a.alarm_message || a.id }}</span>
              <span class="alarm-time">{{ fmtTime(a.last_trigger_time||a.timestamp) }}</span>
            </div>
            <div v-if="!alarms.length" class="alarm-empty">暂无报警</div>
          </div>
        </div>
        <div class="screen-panel"><div class="panel-title">SPC 控制图</div><div ref="spcRef" class="chart-area"></div></div>
        <div class="screen-panel"><div class="panel-title">设备健康度</div><div ref="healthBarRef" class="chart-area"></div></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import { io } from 'socket.io-client'
import { systemApi, alarmsApi, industry40Api, dataApi } from '@/api'
import { getAuthToken } from '@/api/request'

const clock = ref('')
const devices = ref<any[]>([])
const alarms = ref<any[]>([])
const deviceValues: Record<string, number> = {}
const kpi = reactive({ online: 0, total: 0, alarms: 0, rate: 0, quality: 100, uptime: '-' })

// ECharts
const devicePieRef = ref<HTMLElement>()
const oeeGaugeRef = ref<HTMLElement>()
const energyBarRef = ref<HTMLElement>()
const trendRef = ref<HTMLElement>()
const spcRef = ref<HTMLElement>()
const healthBarRef = ref<HTMLElement>()
let charts: Record<string, echarts.ECharts> = {}
let socket: any = null
let refreshTimer: ReturnType<typeof setInterval>
let clockTimer: ReturnType<typeof setInterval>

function getVal(deviceId: string, reg: string) {
  const v = deviceValues[`${deviceId}:${reg}`]
  return v != null ? v.toFixed(1) : '--'
}

function fmtTime(t: string) { return t ? new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-' }

function formatUptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}天${h}时` : h > 0 ? `${h}时${m}分` : `${m}分`
}

async function loadData() {
  try {
    const status = await systemApi.getStatus()
    const devs = Array.isArray(status.devices) ? status.devices : Object.values(status.devices || {})
    devices.value = devs
    kpi.online = devs.filter((d: any) => d.connected).length
    kpi.total = devs.length
    kpi.alarms = status.alarms?.total_active_alarms || 0
    const c = status.collector || {}
    const total = (c.successful_collections || 0) + (c.failed_collections || 0)
    kpi.rate = Math.floor((c.total_collections || 0) / Math.max((status.uptime_seconds || 1) / 60, 1))
    kpi.quality = total > 0 ? Math.round(c.successful_collections / total * 100) : 100
    kpi.uptime = formatUptime(status.uptime_seconds || 0)
    renderDevicePie(devs)
  } catch (e: any) { console.warn('[Screen] 加载失败:', e?.message || e) }

  try {
    const a = await alarmsApi.getAll({ limit: 30 })
    alarms.value = a?.alarms || []
  } catch (e: any) { console.warn('[Screen] 加载失败:', e?.message || e) }

  try {
    const data = await dataApi.getRealtime() as any
    if (data?.data) {
      data.data.forEach((item: any) => {
        if (item.device_id && item.register_name && item.value != null) {
          deviceValues[`${item.device_id}:${item.register_name}`] = parseFloat(item.value)
        }
      })
      renderTrend(data.data)
    }
  } catch (e: any) { console.warn('[Screen] 加载失败:', e?.message || e) }
}

async function loadI40() {
  try {
    const [oee, health, energy, spcViolations] = await Promise.all([
      industry40Api.getOEE().catch(() => null),
      industry40Api.getHealthScores().catch(() => null),
      industry40Api.getEnergy().catch(() => null),
      industry40Api.getSPCViolations().catch(() => null),
    ])
    if (oee?.devices?.length) renderOEEGauge(oee.devices)
    if (health?.health_scores?.length) renderHealthBar(health.health_scores)
    if (energy?.summary) renderEnergyBar(energy.summary)
    // SPC 控制图：用第一个设备的第一个寄存器数据渲染
    if (devices.value.length) {
      const firstDev = devices.value[0]
      const regs = firstDev.registers || []
      const firstReg = regs[0]?.name || 'temperature'
      try {
        const spcData = await industry40Api.getSPC(firstDev.device_id, firstReg)
        if (spcData?.chart_data) renderSPCChart(spcData.chart_data)
      } catch (e: any) { console.warn('[Screen] 加载失败:', e?.message || e) }
    }
  } catch (e: any) { console.warn('[Screen] 加载失败:', e?.message || e) }
}

function renderDevicePie(devs: any[]) {
  if (!devicePieRef.value) return
  if (!charts.devicePie) charts.devicePie = echarts.init(devicePieRef.value)
  const online = devs.filter(d => d.connected).length
  charts.devicePie.setOption({
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie', radius: ['40%', '70%'],
      data: [
        { value: online, name: '在线', itemStyle: { color: '#22c55e' } },
        { value: devs.length - online, name: '离线', itemStyle: { color: '#ef4444' } },
      ],
      label: { color: '#ccc', fontSize: 11 },
    }],
  })
}

function renderOEEGauge(devices: any[]) {
  if (!oeeGaugeRef.value) return
  if (!charts.oeeGauge) charts.oeeGauge = echarts.init(oeeGaugeRef.value)
  const avg = devices.reduce((s, d) => s + d.oee_percent, 0) / devices.length
  charts.oeeGauge.setOption({
    series: [{
      type: 'gauge', startAngle: 200, endAngle: -20, min: 0, max: 100,
      axisLine: { lineStyle: { width: 15, color: [[0.5, '#ff4444'], [0.65, '#ffaa00'], [0.85, '#a0d911'], [1, '#22c55e']] } },
      pointer: { itemStyle: { color: '#00d4ff' } },
      detail: { valueAnimation: true, formatter: '{value}%', fontSize: 20, color: '#fff' },
      data: [{ value: avg.toFixed(1) }],
      title: { color: '#999', fontSize: 11 },
    }],
  })
}

function renderHealthBar(scores: any[]) {
  if (!healthBarRef.value) return
  if (!charts.healthBar) charts.healthBar = echarts.init(healthBarRef.value)
  const top8 = scores.slice(0, 8)
  charts.healthBar.setOption({
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'value', max: 100, axisLabel: { color: '#999', fontSize: 10 } },
    yAxis: { type: 'category', data: top8.map(s => s.device_id), axisLabel: { color: '#ccc', fontSize: 10 } },
    grid: { left: 80, right: 10, top: 5, bottom: 5 },
    series: [{
      type: 'bar', barWidth: 12,
      data: top8.map(s => ({
        value: s.health_score,
        itemStyle: { color: s.health_score >= 80 ? '#22c55e' : s.health_score >= 60 ? '#f59e0b' : '#ef4444' },
      })),
      label: { show: true, position: 'right', formatter: '{c}%', color: '#ccc', fontSize: 10 },
    }],
  })
}

function renderEnergyBar(summary: any) {
  if (!energyBarRef.value) return
  if (!charts.energyBar) charts.energyBar = echarts.init(energyBarRef.value)
  charts.energyBar.setOption({
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: ['峰时', '平时', '谷时'], axisLabel: { color: '#ccc' } },
    yAxis: { type: 'value', name: 'kWh', axisLabel: { color: '#999' } },
    series: [{
      type: 'bar', barWidth: '40%',
      data: [
        { value: summary.peak_kwh || 0, itemStyle: { color: '#ef4444' } },
        { value: summary.flat_kwh || 0, itemStyle: { color: '#f59e0b' } },
        { value: summary.valley_kwh || 0, itemStyle: { color: '#22c55e' } },
      ],
    }],
  })
}

function renderSPCChart(data: any) {
  if (!spcRef.value) return
  if (!charts.spc) charts.spc = echarts.init(spcRef.value)
  const values = data.values || data.points || []
  charts.spc.setOption({
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: values.map((_: any, i: number) => i + 1), axisLabel: { color: '#999', fontSize: 9 } },
    yAxis: { type: 'value', axisLabel: { color: '#999', fontSize: 9 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
    grid: { left: 40, right: 10, top: 20, bottom: 20 },
    series: [{
      type: 'line', data: values, smooth: true, symbol: 'none',
      lineStyle: { color: '#06b6d4', width: 1.5 },
      markLine: { silent: true, lineStyle: { width: 1 }, data: [
        { yAxis: data.ucl, lineStyle: { color: '#ef4444', type: 'dashed' }, label: { formatter: 'UCL', color: '#ef4444', fontSize: 9 } },
        { yAxis: data.cl, lineStyle: { color: '#22c55e' }, label: { formatter: 'CL', color: '#22c55e', fontSize: 9 } },
        { yAxis: data.lcl, lineStyle: { color: '#ef4444', type: 'dashed' }, label: { formatter: 'LCL', color: '#ef4444', fontSize: 9 } },
      ]},
    }],
  })
}

function renderTrend(data: any[]) {
  if (!trendRef.value) return
  if (!charts.trend) charts.trend = echarts.init(trendRef.value)
  const grouped: Record<string, number[]> = {}
  data.forEach(item => {
    if (!grouped[item.register_name]) grouped[item.register_name] = []
    grouped[item.register_name].push(parseFloat(item.value))
  })
  const keys = Object.keys(grouped).slice(0, 4)
  const maxLen = Math.max(...keys.map(k => grouped[k].length), 1)
  const xData = Array.from({ length: maxLen }, (_, i) => i + 1)
  charts.trend.setOption({
    tooltip: { trigger: 'axis' },
    legend: { top: 0, right: 0, textStyle: { color: '#999', fontSize: 10 }, itemWidth: 10, itemHeight: 2 },
    grid: { left: 50, right: 10, top: 25, bottom: 20 },
    xAxis: { type: 'category', data: xData, axisLabel: { color: '#999', fontSize: 10 }, splitLine: { show: false } },
    yAxis: { type: 'value', axisLabel: { color: '#999', fontSize: 10 }, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
    series: keys.map((k, i) => ({
      name: k, type: 'line', smooth: true, symbol: 'none',
      lineStyle: { width: 1.5, color: ['#6366f1', '#06b6d4', '#f59e0b', '#ef4444'][i] },
      data: grouped[k],
    })),
  })
}

function connectSocket() {
  const baseUrl = import.meta.env.DEV ? window.location.origin : 'http://localhost:5000'
  const token = getAuthToken()
  const url = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl
  socket = io(url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 3000,
  })
  socket.on('connect', () => {
    devices.value.forEach((d: any) => { if (d.device_id) socket.emit('subscribe', { device_id: d.device_id }) })
  })
  socket.on('data_update', (data: any) => {
    if (data?.device_id && data?.register_name && data.value != null) {
      deviceValues[`${data.device_id}:${data.register_name}`] = parseFloat(data.value)
    }
  })
  socket.on('alarm', () => loadData())
}

onMounted(() => {
  clockTimer = setInterval(() => { clock.value = new Date().toLocaleTimeString('zh-CN') }, 1000)
  loadData()
  loadI40()
  connectSocket()
  refreshTimer = setInterval(() => { loadData(); loadI40() }, 10000)
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  clearInterval(refreshTimer)
  clearInterval(clockTimer)
  socket?.disconnect()
  Object.values(charts).forEach(c => c.dispose())
  window.removeEventListener('resize', handleResize)
})

function handleResize() { Object.values(charts).forEach(c => c.resize()) }
</script>

<style scoped>
.screen { height: 100vh; background: #0a0e27; color: #e0e0e0; display: flex; flex-direction: column; overflow: hidden; font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; }
.screen-topbar { display: flex; align-items: center; justify-content: space-between; padding: 8px 20px; background: linear-gradient(90deg, #1a1a3e, #0a0e27); border-bottom: 1px solid rgba(79,70,229,0.3); }
.topbar-title { font-size: 18px; font-weight: 700; color: #fff; }
.topbar-kpi { display: flex; gap: 24px; }
.kpi-item { text-align: center; }
.kpi-label { display: block; font-size: 10px; color: #999; }
.kpi-val { font-size: 18px; font-weight: 700; color: #00d4ff; }
.kpi-val.alarm { color: #ef4444; }
.topbar-clock { font-size: 16px; color: #6366f1; font-weight: 600; font-variant-numeric: tabular-nums; }
.screen-body { flex: 1; display: flex; gap: 8px; padding: 8px; min-height: 0; }
.screen-col { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.screen-col.left, .screen-col.right { flex: 0 0 22%; }
.screen-col.center { flex: 1; }
.screen-panel { background: rgba(255,255,255,0.03); border: 1px solid rgba(79,70,229,0.2); border-radius: 8px; padding: 8px; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.screen-panel.main-trend { flex: 2; }
.panel-title { font-size: 12px; color: #999; margin-bottom: 4px; font-weight: 600; }
.chart-area { flex: 1; min-height: 0; }
.chart-area-lg { flex: 1; min-height: 0; }
.params-table { flex: 1; overflow-y: auto; font-size: 11px; }
.pt-header, .pt-row { display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr 0.6fr; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.05); }
.pt-header { color: #999; font-weight: 600; }
.pt-row span { color: #e0e0e0; }
.st-on { color: #22c55e; }
.st-off { color: #ef4444; }
.alarm-scroll { flex: 1; overflow-y: auto; }
.alarm-row { padding: 6px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; gap: 6px; align-items: center; font-size: 11px; }
.alarm-row.lvl-critical { border-left: 3px solid #ef4444; }
.alarm-row.lvl-warning { border-left: 3px solid #f59e0b; }
.alarm-lvl { font-weight: 700; font-size: 10px; min-width: 36px; }
.lvl-critical .alarm-lvl { color: #ef4444; }
.lvl-warning .alarm-lvl { color: #f59e0b; }
.alarm-msg { flex: 1; color: #e0e0e0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.alarm-time { color: #999; font-size: 10px; }
.alarm-empty { text-align: center; color: #666; padding: 20px; }
</style>
