<template>
  <!-- 大屏固定深色：局部 data-theme="dark" 让 design-tokens.css 的深色变量在本作用域生效，
       与全局主题无关，且不复制任何色值 -->
  <div class="screen-root" data-theme="dark">
    <!-- 顶部 KPI -->
    <header class="screen-topbar">
      <div class="topbar-title">
        <router-link to="/dashboard" class="topbar-back">← 返回</router-link>
        <span class="topbar-name">工业数据大屏</span>
      </div>
      <div class="topbar-kpi">
        <div class="screen-kpi">
          <span class="metric-label">设备在线</span>
          <span class="metric-value metric-value--lg">
            {{ kpi.online }}<span class="metric-unit">/{{ kpi.total }}</span>
          </span>
        </div>
        <div class="screen-kpi">
          <span class="metric-label">活动报警</span>
          <span class="metric-value metric-value--lg" :class="{ 'screen-kpi__val--alarm': kpi.alarms > 0 }">{{ kpi.alarms }}</span>
        </div>
        <div class="screen-kpi">
          <span class="metric-label">采集吞吐</span>
          <span class="metric-value metric-value--lg">{{ kpi.rate }}<span class="metric-unit">条/分</span></span>
        </div>
        <div class="screen-kpi">
          <span class="metric-label">数据质量</span>
          <span class="metric-value metric-value--lg">{{ kpi.quality }}<span class="metric-unit">%</span></span>
        </div>
        <div class="screen-kpi">
          <span class="metric-label">运行时间</span>
          <span class="metric-value metric-value--lg">{{ kpi.uptime }}</span>
        </div>
      </div>
      <div class="topbar-clock metric-value">{{ clock }}</div>
    </header>

    <!-- 三列栅格 -->
    <div class="screen-body">
      <!-- 左列 -->
      <div class="screen-col">
        <section class="panel screen-panel">
          <h3 class="screen-panel__title">设备状态分布</h3>
          <div ref="devicePieRef" class="chart-area"></div>
        </section>
        <section class="panel screen-panel">
          <h3 class="screen-panel__title">OEE 综合效率</h3>
          <div ref="oeeGaugeRef" class="chart-area"></div>
        </section>
        <section class="panel screen-panel">
          <h3 class="screen-panel__title">能源消耗趋势</h3>
          <div ref="energyBarRef" class="chart-area"></div>
        </section>
      </div>

      <!-- 中列 -->
      <div class="screen-col">
        <section class="panel screen-panel screen-panel--main">
          <h3 class="screen-panel__title">实时趋势</h3>
          <div ref="trendRef" class="chart-area"></div>
        </section>
        <section class="panel screen-panel">
          <h3 class="screen-panel__title">工艺参数</h3>
          <div class="params-table">
            <div class="pt-header"><span>设备</span><span>温度</span><span>压力</span><span>功率</span><span>状态</span></div>
            <div v-for="d in devices" :key="d.device_id" class="pt-row">
              <span class="pt-name">{{ d.name || d.device_id }}</span>
              <span class="pt-num">{{ getVal(d.device_id, 'temperature') }}</span>
              <span class="pt-num">{{ getVal(d.device_id, 'pressure') }}</span>
              <span class="pt-num">{{ getVal(d.device_id, 'power') }}</span>
              <span class="tag" :class="d.connected ? 'tag--success' : 'tag--offline'">{{ d.connected ? '在线' : '离线' }}</span>
            </div>
            <div v-if="!devices.length" class="pt-empty">
              <el-empty description="暂无设备数据" :image-size="48" />
            </div>
          </div>
        </section>
      </div>

      <!-- 右列 -->
      <div class="screen-col">
        <section class="panel screen-panel">
          <h3 class="screen-panel__title">实时报警</h3>
          <div class="alarm-scroll">
            <div v-for="a in alarms" :key="a.id||a.alarm_id" class="alarm-row">
              <span class="level-bar" :class="levelBarClass(a.alarm_level)"></span>
              <span class="alarm-row__prio" :class="'alarm-row__prio--' + levelKey(a.alarm_level)">
                {{ a.alarm_level==='critical'?'CRIT':a.alarm_level==='warning'?'HIGH':'LOW' }}
              </span>
              <span class="alarm-row__msg">{{ a.alarm_message || a.id }}</span>
              <span class="alarm-row__time">{{ fmtTime(a.last_trigger_time||a.timestamp) }}</span>
            </div>
            <div v-if="!alarms.length" class="alarm-empty">
              <el-empty description="暂无活动报警" :image-size="48" />
            </div>
          </div>
        </section>
        <section class="panel screen-panel">
          <h3 class="screen-panel__title">SPC 控制图</h3>
          <div ref="spcRef" class="chart-area"></div>
        </section>
        <section class="panel screen-panel">
          <h3 class="screen-panel__title">设备健康度</h3>
          <div ref="healthBarRef" class="chart-area"></div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import { io } from 'socket.io-client'
import { systemApi, alarmsApi, industry40Api, dataApi } from '@/api'
import { getAuthToken, getWsBaseUrl } from '@/api/request'
import { registerScadaTheme } from '@/utils/echartsTheme'

registerScadaTheme(echarts)

/** 大屏固定深色：图表直接用 echartsTheme.ts 注册的深色主题（不跟随全局 html[data-theme]） */
const SCREEN_CHART_THEME = 'scada-dark'

/**
 * 读取设计令牌（canvas 内无法使用 CSS 变量）。
 * 作用域取 .screen-root，因此拿到的是深色主题值，无需在 JS 里复制任何色值。
 */
function cssToken(name: string): string {
  if (typeof document === 'undefined') return ''
  const el = document.querySelector('.screen-root') || document.documentElement
  return getComputedStyle(el).getPropertyValue(name).trim()
}

function levelKey(level: string): 'critical' | 'warning' | 'info' {
  return level === 'critical' ? 'critical' : level === 'warning' ? 'warning' : 'info'
}
function levelBarClass(level: string): string { return `level-bar--${levelKey(level)}` }

const clock = ref('')
const devices = ref<any[]>([])
const alarms = ref<any[]>([])
const deviceValues = reactive<Record<string, number>>({})
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
let disposed = false            // 组件卸载后丢弃迟到的响应，避免重建已 dispose 的图表
let loadingData = false         // loadData 重入保护
let loadingI40 = false          // loadI40 重入保护
const subscribed = new Set<string>()  // 已向 WS 订阅的设备，避免重复订阅/漏订阅

// 统一初始化入口：所有图表都用同一套已注册主题
function ensureChart(name: string, el: HTMLElement | undefined): echarts.ECharts | null {
  if (disposed || !el) return null
  if (!charts[name]) charts[name] = echarts.init(el, SCREEN_CHART_THEME)
  return charts[name]
}

function getVal(deviceId: string, reg: string) {
  const v = deviceValues[`${deviceId}:${reg}`]
  return Number.isFinite(v) ? (v as number).toFixed(1) : '--'
}

function fmtTime(t: string) { return t ? new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-' }

function formatUptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}天${h}时` : h > 0 ? `${h}时${m}分` : `${m}分`
}

async function loadData() {
  // 10s 定时器与 WS alarm 事件都会触发本函数，慢响应时会叠加并发请求，这里做重入保护
  if (loadingData) return
  loadingData = true
  try {
    const status = await systemApi.getStatus()
    if (disposed) return
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
    subscribeDevices()
  } catch (e: any) { console.warn('[Screen] 加载失败:', e?.message || e) }

  try {
    const a = await alarmsApi.getAll({ limit: 30 })
    if (disposed) return
    alarms.value = a?.alarms || []
  } catch (e: any) { console.warn('[Screen] 加载失败:', e?.message || e) }

  try {
    const data = await dataApi.getRealtime() as any
    if (disposed) return
    if (data?.data) {
      data.data.forEach((item: any) => {
        if (item.device_id && item.register_name && item.value != null) {
          deviceValues[`${item.device_id}:${item.register_name}`] = parseFloat(item.value)
        }
      })
      renderTrend(data.data)
    }
  } catch (e: any) { console.warn('[Screen] 加载失败:', e?.message || e) }
  finally { loadingData = false }
}

async function loadI40() {
  if (loadingI40) return
  loadingI40 = true
  try {
    const [oee, health, energy, spcViolations] = await Promise.all([
      industry40Api.getOEE().catch(() => null),
      industry40Api.getHealthScores().catch(() => null),
      industry40Api.getEnergy().catch(() => null),
      industry40Api.getSPCViolations().catch(() => null),
    ])
    if (disposed) return
    if (oee && typeof oee === 'object' && Object.keys(oee).length) renderOEEGauge(Object.values(oee))
    if (health && typeof health === 'object' && Object.keys(health).length) renderHealthBar(Object.values(health))
    // 后端 /industry40/energy 返回扁平的能耗汇总（无 summary 外层）
    if (energy && typeof energy === 'object' && Object.keys(energy).length) renderEnergyBar(energy)
    // SPC 控制图：用第一个设备的第一个寄存器数据渲染
    if (devices.value.length) {
      const firstDev = devices.value[0]
      const regs = firstDev.registers || []
      const firstReg = regs[0]?.name || 'temperature'
      try {
        const spcData = await industry40Api.getSPC(firstDev.device_id, firstReg) as any
        if (disposed) return
        // 后端 /api/industry40/spc/<d>/<r> 返回 {control_chart, capability}，
        // control_chart = {xbar:{points,ucl,cl,lcl}, r_chart:{...}, violations}
        const cc = spcData?.control_chart
        const xbar = cc?.xbar || {}
        if (xbar.points) {
          renderSPCChart({
            values: xbar.points,
            ucl: xbar.ucl,
            cl: xbar.cl,
            lcl: xbar.lcl,
          })
        }
      } catch (e: any) { console.warn('[Screen] 加载失败:', e?.message || e) }
    }
  } catch (e: any) { console.warn('[Screen] 加载失败:', e?.message || e) }
  finally { loadingI40 = false }
}

function renderDevicePie(devs: any[]) {
  const chart = ensureChart('devicePie', devicePieRef.value)
  if (!chart) return
  const online = devs.filter(d => d.connected).length
  chart.setOption({
    tooltip: { trigger: 'item' },
    series: [{
      type: 'pie', radius: ['42%', '70%'],
      data: [
        { value: online, name: '在线', itemStyle: { color: cssToken('--color-success') } },
        { value: devs.length - online, name: '离线', itemStyle: { color: cssToken('--color-offline') } },
      ],
      label: { fontSize: 13 },
    }],
  }, true)
}

function renderOEEGauge(devices: any[]) {
  const chart = ensureChart('oeeGauge', oeeGaugeRef.value)
  if (!chart) return
  // 缺字段/空数组会让均值变成 NaN，直接跳过渲染
  const values = devices.map(d => Number(d?.oee_percent)).filter(v => Number.isFinite(v))
  if (!values.length) return
  const avg = values.reduce((s, v) => s + v, 0) / values.length
  chart.setOption({
    series: [{
      type: 'gauge', startAngle: 200, endAngle: -20, min: 0, max: 100,
      axisLine: { lineStyle: { width: 16, color: [
        [0.5, cssToken('--color-danger')],
        [0.85, cssToken('--color-warning')],
        [1, cssToken('--color-success')],
      ] } },
      pointer: { itemStyle: { color: cssToken('--color-brand') } },
      detail: { valueAnimation: true, formatter: '{value}%', fontSize: 32 },
      data: [{ value: avg.toFixed(1) }],
    }],
  }, true)
}

function renderHealthBar(scores: any[]) {
  const chart = ensureChart('healthBar', healthBarRef.value)
  if (!chart) return
  const top8 = scores.slice(0, 8)
  chart.setOption({
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'value', max: 100 },
    yAxis: { type: 'category', data: top8.map(s => s.device_id) },
    grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
    series: [{
      type: 'bar', barWidth: 12,
      data: top8.map(s => ({
        value: s.health_score,
        itemStyle: {
          color: s.health_score >= 80
            ? cssToken('--color-success')
            : s.health_score >= 60 ? cssToken('--color-warning') : cssToken('--color-danger'),
        },
      })),
      label: { show: true, position: 'right', formatter: '{c}%', fontSize: 12 },
    }],
  }, true)
}

function renderEnergyBar(summary: any) {
  const chart = ensureChart('energyBar', energyBarRef.value)
  if (!chart) return
  chart.setOption({
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: ['峰时', '平时', '谷时'] },
    yAxis: { type: 'value', name: 'kWh' },
    grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
    series: [{
      type: 'bar', barWidth: '40%',
      data: [
        { value: summary.peak_kwh || 0, itemStyle: { color: cssToken('--color-danger') } },
        { value: summary.flat_kwh || 0, itemStyle: { color: cssToken('--color-warning') } },
        { value: summary.valley_kwh || 0, itemStyle: { color: cssToken('--color-success') } },
      ],
    }],
  }, true)
}

function renderSPCChart(data: any) {
  const chart = ensureChart('spc', spcRef.value)
  if (!chart) return
  const values = data.values || data.points || []
  chart.setOption({
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: values.map((_: any, i: number) => i + 1) },
    yAxis: { type: 'value' },
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    series: [{
      type: 'line', data: values, smooth: true, symbol: 'none',
      markLine: { silent: true, lineStyle: { width: 1, type: 'dashed' }, data: [
        { yAxis: data.ucl, name: 'UCL', lineStyle: { color: cssToken('--color-danger'), type: 'dashed' }, label: { formatter: 'UCL' } },
        { yAxis: data.cl, name: 'CL', lineStyle: { color: cssToken('--color-success'), type: 'solid' }, label: { formatter: 'CL' } },
        { yAxis: data.lcl, name: 'LCL', lineStyle: { color: cssToken('--color-danger'), type: 'dashed' }, label: { formatter: 'LCL' } },
      ]},
    }],
  }, true)
}

function renderTrend(data: any[]) {
  const chart = ensureChart('trend', trendRef.value)
  if (!chart) return
  const grouped: Record<string, number[]> = {}
  data.forEach(item => {
    if (!grouped[item.register_name]) grouped[item.register_name] = []
    grouped[item.register_name].push(parseFloat(item.value))
  })
  const keys = Object.keys(grouped).slice(0, 4)
  const maxLen = Math.max(...keys.map(k => grouped[k].length), 1)
  const xData = Array.from({ length: maxLen }, (_, i) => i + 1)
  // setOption(..., true) 会重建图例，需带回用户已勾选的系列
  const prevLegend = (chart.getOption() as any)?.legend?.[0]?.selected
  chart.setOption({
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    legend: { top: 0, right: 0, type: 'scroll', selected: prevLegend && Object.keys(prevLegend).length ? prevLegend : undefined },
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: xData },
    yAxis: { type: 'value', scale: true },
    // 系列颜色由统一主题色板分配，页面不再自带颜色数组
    series: keys.map(k => ({
      name: k, type: 'line', smooth: true, symbol: 'none',
      data: grouped[k],
    })),
  }, true)
}

function subscribeDevices() {
  if (!socket?.connected) return
  devices.value.forEach((d: any) => {
    if (d.device_id && !subscribed.has(d.device_id)) {
      socket.emit('subscribe', { device_id: d.device_id })
      subscribed.add(d.device_id)
    }
  })
}

function connectSocket() {
  const baseUrl = getWsBaseUrl()
  const token = getAuthToken()
  const url = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl
  socket = io(url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 3000,
  })
  socket.on('connect', () => {
    subscribed.clear()   // 重连后需重新订阅
    subscribeDevices()
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
  disposed = true
  clearInterval(refreshTimer)
  clearInterval(clockTimer)
  socket?.disconnect()
  Object.values(charts).forEach(c => c.dispose())
  charts = {}
  window.removeEventListener('resize', handleResize)
})

function handleResize() { Object.values(charts).forEach(c => c.resize()) }
</script>

<style scoped>
/* 大屏固定深色：这里只写布局，颜色全部来自 design-tokens（data-theme="dark" 作用域） */
.screen-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: var(--bg-page);
  color: var(--text-primary);
  font-family: var(--font-sans);
}

/* ==================== 顶栏 ==================== */
.screen-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-2) var(--space-5);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-base);
  flex: none;
}
.topbar-title { display: flex; align-items: center; gap: var(--space-3); flex: none; }
.topbar-back { color: var(--color-brand); font-size: var(--font-sm); text-decoration: none; }
.topbar-back:hover { text-decoration: underline; }
.topbar-name {
  font-size: var(--font-xl);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}
.topbar-kpi { display: flex; gap: var(--space-6); flex-wrap: wrap; }
.screen-kpi { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); }
.screen-kpi__val--alarm { color: var(--color-danger); }
.topbar-clock {
  flex: none;
  font-variant-numeric: tabular-nums;
  color: var(--color-brand);
}

/* ==================== 三列栅格 ==================== */
.screen-body {
  flex: 1;
  display: grid;
  grid-template-columns: 23fr 54fr 23fr;
  gap: var(--space-3);
  padding: var(--space-3);
  min-height: 0;
}
.screen-col {
  display: grid;
  grid-template-rows: 1fr 1fr 1fr;
  gap: var(--space-3);
  min-height: 0;
}
.screen-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}
.screen-panel--main { grid-row: span 2; }
.screen-panel__title {
  flex: none;
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-base);
  font-size: var(--font-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
}
.chart-area { flex: 1; min-height: 0; }

/* ==================== 工艺参数表 ==================== */
.params-table { flex: 1; min-height: 0; overflow-y: auto; }
.pt-header,
.pt-row {
  display: grid;
  grid-template-columns: 1.6fr 1fr 1fr 1fr 0.7fr;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}
.pt-header {
  position: sticky;
  top: 0;
  background: var(--bg-sunken);
  color: var(--text-muted);
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
}
.pt-row { font-size: var(--font-sm); color: var(--text-primary); }
.pt-row:hover { background: var(--bg-hover); }
.pt-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pt-num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.pt-row .tag { justify-self: start; }
.pt-empty { padding: var(--space-4) 0; }

/* ==================== 报警 ==================== */
.alarm-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: var(--space-1); }
.alarm-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  font-size: var(--font-sm);
}
.alarm-row:hover { background: var(--bg-hover); }
.alarm-row__prio {
  flex: none;
  min-width: 40px;
  font-size: var(--font-xs);
  font-weight: var(--weight-semibold);
}
.alarm-row__prio--critical { color: var(--color-danger); }
.alarm-row__prio--warning { color: var(--color-warning); }
.alarm-row__prio--info { color: var(--color-info); }
.alarm-row__msg {
  flex: 1;
  min-width: 0;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.alarm-row__time {
  flex: none;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--font-xs);
  color: var(--text-muted);
}
.alarm-empty { padding: var(--space-4) 0; }
</style>
