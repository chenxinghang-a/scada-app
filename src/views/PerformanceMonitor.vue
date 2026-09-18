<template>
  <div class="performance-monitor">
    <div class="header">
      <div class="header__title">
        <h2>系统性能监控</h2>
        <span class="tag tag--info">{{ rangeLabel }}</span>
      </div>
      <div class="controls">
        <el-select v-model="historyHours" size="small" style="width: 130px" @change="onHistoryRangeChange">
          <el-option label="1小时" :value="1" />
          <el-option label="6小时" :value="6" />
          <el-option label="24小时" :value="24" />
          <el-option label="7天" :value="168" />
        </el-select>
        <el-button @click="refreshMetrics" :loading="loading" type="primary" size="small">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
        <span class="tag" :class="connected ? 'tag--success' : 'tag--danger'">{{ connectionStatusText }}</span>
      </div>
    </div>

    <!-- 关键指标卡 + 迷你趋势（趋势取自历史接口同名字段） -->
    <div class="metrics-grid">
      <div v-for="c in metricCards" :key="c.key" class="panel metric-card">
        <div class="metric-card__head">
          <span class="metric-label">{{ c.label }}</span>
          <span class="metric-card__range">{{ rangeLabel }}</span>
        </div>
        <div class="metric-value">{{ c.value }}<span class="metric-unit">{{ c.unit }}</span></div>
        <svg v-if="c.points" class="spark" :class="c.sparkClass" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
          <polygon :points="c.area" class="spark__area" />
          <polyline :points="c.points" class="spark__line" />
        </svg>
        <div v-else class="spark-empty">该区间暂无趋势数据</div>
        <div class="metric-card__foot">{{ c.foot }}</div>
      </div>
    </div>

    <!-- 历史趋势：随上方时间范围联动 -->
    <div class="panel">
      <div class="panel__header">
        <span class="panel__title"><el-icon><TrendCharts /></el-icon> 历史趋势</span>
        <span class="panel__meta">{{ rangeLabel }} · {{ historyData.length }} 个采样点<template v-if="historyLoading"> · 加载中…</template></span>
      </div>
      <div class="panel__body">
        <div class="chart-wrap" v-loading="historyLoading">
          <div ref="cpuChart" class="chart-container"></div>
          <div v-if="!historyLoading && !historyData.length" class="chart-overlay">
            <el-empty :description="`${rangeLabel} 内没有历史采样数据`" />
          </div>
        </div>
      </div>
    </div>

    <!-- 指标摘要：与上方时间范围使用同一个 rangeLabel，明确二者联动 -->
    <div class="panel">
      <div class="panel__header">
        <span class="panel__title"><el-icon><DataAnalysis /></el-icon> 指标摘要</span>
        <span class="panel__meta">{{ rangeLabel }}<template v-if="summaryLoading"> · 加载中…</template></span>
      </div>
      <div class="panel__body">
        <div v-if="summary" class="summary-grid" v-loading="summaryLoading">
          <div class="summary-item">
            <span class="metric-label">采样数</span>
            <span class="summary-item__value mono">{{ summary.samples ?? '-' }}</span>
          </div>
          <div class="summary-item">
            <span class="metric-label">CPU 平均 / 最大</span>
            <span class="summary-item__value mono">{{ fmtPct(summary.cpu?.avg) }} / {{ fmtPct(summary.cpu?.max) }}</span>
          </div>
          <div class="summary-item">
            <span class="metric-label">内存 平均 / 最大</span>
            <span class="summary-item__value mono">{{ fmtPct(summary.memory?.avg) }} / {{ fmtPct(summary.memory?.max) }}</span>
          </div>
          <div class="summary-item">
            <span class="metric-label">内存 最小</span>
            <span class="summary-item__value mono">{{ fmtPct(summary.memory?.min) }}</span>
          </div>
        </div>
        <el-empty v-else description="暂无摘要数据" :image-size="70" />
      </div>
    </div>

    <!-- 运行信息（保持原有真实字段展示） -->
    <div class="panel">
      <div class="panel__header">
        <span class="panel__title"><el-icon><Monitor /></el-icon> 运行信息</span>
        <span class="panel__meta">实时采样 · 30 秒刷新</span>
      </div>
      <div class="panel__body info-grid">
        <div class="info-block">
          <div class="metric-label">系统</div>
          <dl class="info-list">
            <div><dt>CPU 核数</dt><dd class="mono">{{ realtimeMetrics?.system?.cpu_count ?? '-' }}</dd></div>
            <div><dt>内存使用量</dt><dd class="mono">{{ realtimeMetrics?.system?.memory_used_gb ?? '-' }} / {{ realtimeMetrics?.system?.memory_total_gb ?? '-' }} GB</dd></div>
            <div><dt>磁盘可用</dt><dd class="mono">{{ realtimeMetrics?.system?.disk_free_gb ?? '-' }} GB</dd></div>
            <div><dt>活跃线程数</dt><dd class="mono">{{ realtimeMetrics?.system?.thread_count ?? '-' }}</dd></div>
          </dl>
        </div>
        <div class="info-block">
          <div class="metric-label">应用</div>
          <dl class="info-list">
            <div><dt>日志文件数</dt><dd class="mono">{{ realtimeMetrics?.application?.log_count ?? '-' }}</dd></div>
            <div><dt>日志总大小</dt><dd class="mono">{{ realtimeMetrics?.application?.log_total_mb ?? '-' }} MB</dd></div>
            <div><dt>配置文件数</dt><dd class="mono">{{ realtimeMetrics?.application?.config_count ?? '-' }}</dd></div>
          </dl>
        </div>
        <div class="info-block">
          <div class="metric-label">数据库</div>
          <dl class="info-list">
            <div><dt>数据库大小</dt><dd class="mono">{{ realtimeMetrics?.database?.size_mb ?? '-' }} MB</dd></div>
            <div><dt>总记录数</dt><dd class="mono">{{ formatNumber(realtimeMetrics?.database?.total_records) }}</dd></div>
            <div><dt>WAL 大小</dt><dd class="mono">{{ realtimeMetrics?.database?.wal_size_mb ?? '-' }} MB</dd></div>
          </dl>
          <div class="table-stats" v-if="realtimeMetrics?.database?.tables">
            <div v-for="(count, table) in realtimeMetrics.database.tables" :key="table" class="table-stat">
              <span class="table-name">{{ table }}</span>
              <span class="table-count mono">{{ formatNumber(count as number) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { Refresh, Monitor, TrendCharts, DataAnalysis } from '@element-plus/icons-vue'
import * as echarts from 'echarts'
import { performanceApi } from '@/api/performance'
import { showActionError } from '@/utils/error'
import { registerScadaTheme, scadaThemeName, applyScadaTheme } from '@/utils/echartsTheme'

registerScadaTheme(echarts)

// 状态
const loading = ref(false)
const historyLoading = ref(false)
const summaryLoading = ref(false)
const realtimeMetrics = ref<any>(null)
const summary = ref<any>(null)
const historyHours = ref(24)
const historyData = ref<any[]>([])
const connected = ref(false)

// 图表
const cpuChart = ref<HTMLElement | null>(null)
let cpuChartInstance: echarts.ECharts | null = null
let chartResizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null

// 轮询
let refreshTimer: ReturnType<typeof setInterval> | null = null

// 快速切换时间范围时慢响应会覆盖新数据，用请求序号丢弃过期响应
let historyReqId = 0

const RANGE_LABELS: Record<number, string> = { 1: '近 1 小时', 6: '近 6 小时', 24: '近 24 小时', 168: '近 7 天' }
const rangeLabel = computed(() => RANGE_LABELS[historyHours.value] || `近 ${historyHours.value} 小时`)
const connectionStatusText = computed(() => connected.value ? '已连接' : '未连接')

// 格式化数字
function formatNumber(num: number | undefined): string {
  if (num === undefined || num === null) return '-'
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toString()
}
function fmtPct(v: any): string {
  const n = Number(v)
  return Number.isFinite(n) ? `${n}%` : '-'
}
function fmtValue(v: any, digits = 1): string {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(digits) : '-'
}
function toNum(v: any): number { return Number.isFinite(Number(v)) ? Number(v) : NaN }

// 横轴标签：跨度超过 2 天时带日期
function fmtAxisTime(t: string): string {
  const d = new Date(t)
  if (isNaN(d.getTime())) return t || ''
  const p = (n: number) => String(n).padStart(2, '0')
  if (historyHours.value > 48) return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

// ========== 迷你趋势 ==========
function sparkPolyline(values: number[]): string {
  const v = values.filter(n => Number.isFinite(n))
  if (v.length < 2) return ''
  const min = Math.min(...v)
  const max = Math.max(...v)
  const span = max - min || 1
  return v
    .map((n, i) => `${((i / (v.length - 1)) * 100).toFixed(2)},${(26 - ((n - min) / span) * 22).toFixed(2)}`)
    .join(' ')
}
function sparkArea(points: string): string { return `0,28 ${points} 100,28` }

const cpuSeries = computed(() => historyData.value.map((m: any) => toNum(m?.system?.cpu_percent)))
const memSeries = computed(() => historyData.value.map((m: any) => toNum(m?.system?.memory_percent)))
const diskSeries = computed(() => historyData.value.map((m: any) => toNum(m?.system?.disk_percent)))
// 数据库趋势优先用 size_mb，缺失时退回 total_records（两者都是接口已有字段）
const dbSeries = computed(() => historyData.value.map((m: any) => {
  const size = toNum(m?.database?.size_mb)
  return Number.isFinite(size) ? size : toNum(m?.database?.total_records)
}))
const dbTrendUnit = computed(() => {
  const hasSize = historyData.value.some((m: any) => Number.isFinite(toNum(m?.database?.size_mb)))
  return hasSize ? 'MB' : '条'
})

interface MetricCard {
  key: string
  label: string
  value: string
  unit: string
  foot: string
  points: string
  area: string
  sparkClass: string
}

const metricCards = computed<MetricCard[]>(() => {
  const sys = realtimeMetrics.value?.system || {}
  const db = realtimeMetrics.value?.database || {}
  const cpu = cpuSeries.value
  const mem = memSeries.value
  const disk = diskSeries.value
  const dbs = dbSeries.value
  const build = (key: string, label: string, value: string, unit: string, foot: string, series: number[], sparkClass: string): MetricCard => {
    const points = sparkPolyline(series)
    return { key, label, value, unit, foot, points, area: sparkArea(points), sparkClass }
  }
  return [
    build('cpu', 'CPU 使用率', fmtValue(sys.cpu_percent), '%',
      `${rangeLabel.value}均 ${fmtPct(summary.value?.cpu?.avg)} · 峰 ${fmtPct(summary.value?.cpu?.max)}`, cpu, 'spark--1'),
    build('memory', '内存使用率', fmtValue(sys.memory_percent), '%',
      `${rangeLabel.value}均 ${fmtPct(summary.value?.memory?.avg)} · 峰 ${fmtPct(summary.value?.memory?.max)}`, mem, 'spark--2'),
    build('disk', '磁盘使用率', fmtValue(sys.disk_percent), '%',
      `可用 ${sys.disk_free_gb ?? '-'} GB`, disk, 'spark--3'),
    build('database', '数据库大小', fmtValue(db.size_mb), 'MB',
      `记录 ${formatNumber(db.total_records)} 条 · 趋势按${dbTrendUnit.value}`, dbs, 'spark--4'),
  ]
})

// ========== 数据加载 ==========
// 刷新实时指标
async function refreshMetrics() {
  if (loading.value) return   // 30s 轮询与手动刷新重入保护
  loading.value = true
  try {
    realtimeMetrics.value = await performanceApi.getRealtimeMetrics()
    connected.value = true
  } catch (e) {
    connected.value = false
    showActionError('获取性能指标', e)
  } finally {
    loading.value = false
  }
}

// 时间范围切换：历史趋势与摘要必须一起刷新，否则摘要仍是旧区间数据
function onHistoryRangeChange() {
  loadHistory()
  loadSummary()
}

// 加载历史数据
async function loadHistory() {
  const reqId = ++historyReqId
  historyLoading.value = true
  try {
    const result = await performanceApi.getMetricsHistory(historyHours.value)
    if (reqId !== historyReqId) return
    historyData.value = result.data || []
    await nextTick()
    updateChart()
  } catch (e) {
    if (reqId === historyReqId) showActionError('获取历史数据', e)
  } finally {
    if (reqId === historyReqId) historyLoading.value = false
  }
}

// 加载摘要
async function loadSummary() {
  const hours = historyHours.value
  summaryLoading.value = true
  try {
    const data = await performanceApi.getMetricsSummary(hours)
    if (hours !== historyHours.value) return   // 期间用户已切换范围，丢弃过期摘要
    summary.value = data
  } catch (e) {
    showActionError('获取指标摘要', e)
  } finally {
    if (hours === historyHours.value) summaryLoading.value = false
  }
}

// 更新图表
function updateChart() {
  if (!cpuChart.value) return
  // 新时间范围没有数据时清空旧曲线，避免残留上一个区间的图
  if (!historyData.value.length) {
    cpuChartInstance?.clear()
    return
  }

  if (!cpuChartInstance) {
    cpuChartInstance = echarts.init(cpuChart.value, scadaThemeName())
    chartResizeObserver = new ResizeObserver(() => cpuChartInstance?.resize())
    chartResizeObserver.observe(cpuChart.value)
  }

  const times = historyData.value.map((m: any) => fmtAxisTime(m.timestamp))
  // 保留用户已关闭的图例项，避免每次刷新把图例开关重置
  const prevLegend = (cpuChartInstance.getOption() as any)?.legend?.[0]?.selected
  const legendSelected = prevLegend && Object.keys(prevLegend).length ? prevLegend : undefined

  cpuChartInstance.setOption({
    // 颜色与坐标轴样式全部来自统一主题，页面不再自带色板
    legend: { top: 0, right: 0, data: ['CPU', '内存', '磁盘'], selected: legendSelected },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: (params: any) => {
        const arr = Array.isArray(params) ? params : [params]
        if (!arr.length) return ''
        const rows = arr
          .filter((p: any) => p.value != null && Number.isFinite(Number(p.value)))
          .map((p: any) => `${p.marker}${p.seriesName}: <b>${Number(p.value).toFixed(1)}</b>%`)
        return `${arr[0].axisValueLabel ?? ''}${rows.length ? '<br/>' + rows.join('<br/>') : '<br/>无数据'}`
      },
    },
    grid: { left: 12, right: 16, top: 34, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: times, boundaryGap: false },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
    series: [
      { name: 'CPU', type: 'line', smooth: true, showSymbol: false, areaStyle: { opacity: 0.12 }, data: cpuSeries.value.map(v => Number.isFinite(v) ? v : null) },
      { name: '内存', type: 'line', smooth: true, showSymbol: false, areaStyle: { opacity: 0.12 }, data: memSeries.value.map(v => Number.isFinite(v) ? v : null) },
      { name: '磁盘', type: 'line', smooth: true, showSymbol: false, areaStyle: { opacity: 0.12 }, data: diskSeries.value.map(v => Number.isFinite(v) ? v : null) },
    ],
  }, true)
}

// 窗口大小变化处理
function handleResize() { cpuChartInstance?.resize() }

onMounted(async () => {
  await refreshMetrics()
  await loadHistory()
  await loadSummary()

  // 每30秒自动刷新
  refreshTimer = setInterval(() => {
    refreshMetrics()
  }, 30000)

  window.addEventListener('resize', handleResize)

  // 深浅主题切换后重建图表实例（ECharts 不支持运行时换主题）
  themeObserver = new MutationObserver(() => {
    if (!cpuChartInstance) return
    cpuChartInstance = applyScadaTheme(cpuChartInstance, echarts)
    updateChart()
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
  chartResizeObserver?.disconnect()
  chartResizeObserver = null
  themeObserver?.disconnect()
  themeObserver = null
  if (cpuChartInstance) {
    cpuChartInstance.dispose()
    cpuChartInstance = null
  }
  window.removeEventListener('resize', handleResize)
})
</script>

<style scoped>
.performance-monitor {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--bg-page);
  color: var(--text-primary);
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.header__title {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.header h2 {
  margin: 0;
  font-size: var(--font-xl);
  color: var(--text-primary);
}

.controls {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

/* ===== 指标卡 ===== */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-4);
}

.metric-card {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.metric-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.metric-card__range {
  font-size: var(--font-xs);
  color: var(--text-muted);
}

.metric-card__foot {
  font-size: var(--font-xs);
  color: var(--text-muted);
}

/* 迷你趋势：颜色继承自 --chart-* ，无硬编码色 */
.spark {
  width: 100%;
  height: 40px;
  display: block;
}

.spark__line {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linejoin: round;
}

.spark__area {
  fill: currentColor;
  opacity: 0.14;
  stroke: none;
}

.spark--1 { color: var(--chart-1); }
.spark--2 { color: var(--chart-2); }
.spark--3 { color: var(--chart-3); }
.spark--4 { color: var(--chart-4); }

.spark-empty {
  height: 40px;
  display: flex;
  align-items: center;
  font-size: var(--font-xs);
  color: var(--text-muted);
}

/* ===== 面板 ===== */
.panel__title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.panel__meta {
  font-size: var(--font-xs);
  font-weight: var(--weight-normal);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.chart-wrap { position: relative; }

.chart-container {
  height: 320px;
  width: 100%;
}

.chart-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-surface);
}

/* ===== 摘要 ===== */
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--space-4);
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  background: var(--bg-sunken);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
}

.summary-item__value {
  font-size: var(--font-lg);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}

/* ===== 运行信息 ===== */
.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--space-5);
}

.info-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.info-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.info-list > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  font-size: var(--font-sm);
  border-bottom: 1px solid var(--border-subtle);
  padding-bottom: var(--space-1);
}

.info-list dt { color: var(--text-muted); }
.info-list dd { margin: 0; color: var(--text-primary); }

.table-stats {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding-top: var(--space-2);
}

.table-stat {
  display: flex;
  justify-content: space-between;
  font-size: var(--font-xs);
}

.table-name { color: var(--text-muted); }
.table-count { color: var(--text-primary); }

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
