<template>
  <div class="history-page">
    <!-- 查询条件 -->
    <div class="panel">
      <div class="panel__header">
        <span>历史数据查询</span>
        <span class="panel__meta">{{ windowSummary }}</span>
      </div>
      <div class="panel__body">
        <div class="filter-row">
          <div class="field">
            <label class="field__label">设备</label>
            <el-select v-model="filter.device_id" placeholder="选择设备" style="width:200px" @change="onDeviceChange">
              <el-option v-for="d in devices" :key="d.device_id" :label="d.name || d.device_name || d.device_id" :value="d.device_id" />
            </el-select>
          </div>
          <div class="field">
            <label class="field__label">参数</label>
            <el-select
              v-model="filter.register_names"
              placeholder="选择参数（可多选）"
              multiple
              collapse-tags
              collapse-tags-tooltip
              :max-collapse-tags="2"
              style="width:260px"
              @change="onRegisterChange"
            >
              <el-option label="全部寄存器（合并）" value="*" />
              <el-option v-for="r in registers" :key="r.name" :label="r.description || r.name" :value="r.name" />
            </el-select>
          </div>
          <div class="field field--actions">
            <el-button type="primary" :loading="loading" @click="queryHistory">查询</el-button>
            <el-button :loading="exporting" @click="exportData">导出</el-button>
            <span v-if="exportStatus" class="tag" :class="exportOk ? 'tag--success' : 'tag--danger'">{{ exportStatus }}</span>
          </div>
        </div>

        <!-- 时间范围 × 聚合粒度：同一窗口的两个维度，视觉上绑定在一个块里 -->
        <div class="query-window">
          <div class="query-window__head">
            <span class="query-window__title">查询窗口</span>
            <span class="query-window__hint">{{ windowHint }}</span>
          </div>
          <div class="query-window__body">
            <div class="field">
              <label class="field__label">时间范围</label>
              <div class="field__control">
                <el-button-group>
                  <el-button size="small" :type="activeQuick === '1h' ? 'primary' : ''" @click="setQuickRange('1h')">1小时</el-button>
                  <el-button size="small" :type="activeQuick === '6h' ? 'primary' : ''" @click="setQuickRange('6h')">6小时</el-button>
                  <el-button size="small" :type="activeQuick === '24h' ? 'primary' : ''" @click="setQuickRange('24h')">24小时</el-button>
                  <el-button size="small" :type="activeQuick === '7d' ? 'primary' : ''" @click="setQuickRange('7d')">7天</el-button>
                </el-button-group>
                <el-date-picker v-model="filter.timeRange" type="datetimerange" range-separator="至" start-placeholder="开始时间" end-placeholder="结束时间" />
              </div>
            </div>
            <span class="window-operator" title="时间范围 × 聚合粒度 → 曲线点数">×</span>
            <div class="field">
              <label class="field__label">聚合粒度</label>
              <el-select v-model="filter.interval" style="width:130px">
                <el-option label="原始" value="" />
                <el-option label="1分钟" value="1min" />
                <el-option label="5分钟" value="5min" />
                <el-option label="1小时" value="1hour" />
                <el-option label="1天" value="1day" />
              </el-select>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 趋势曲线 -->
    <div class="panel chart-panel">
      <div class="panel__header">
        <span>趋势曲线</span>
        <div class="panel__tools">
          <span v-if="seriesList.length" class="tag tag--info">{{ seriesList.length }} 条曲线</span>
          <span v-if="hasThreshold" class="tag tag--warning">含阈值参考线</span>
          <span class="panel__meta">滚轮缩放 · 拖拽平移 · 图例可开关</span>
        </div>
      </div>
      <div class="panel__body">
        <div class="chart-wrap">
          <div ref="chartRef" class="chart-container"></div>
          <div v-if="!loading && !tableData.length" class="chart-overlay">
            <el-empty description="当前条件下没有历史数据" />
          </div>
        </div>
      </div>
    </div>

    <!-- 明细表 -->
    <div class="panel table-panel">
      <div class="panel__header">
        <span>数据明细</span>
        <span class="panel__meta" v-if="tableData.length">共 {{ tableData.length }} 条</span>
      </div>
      <div class="panel__body">
        <el-table :data="tableData" stripe max-height="420" v-loading="loading">
          <el-table-column label="时间" width="190" class-name="mono-cell">
            <template v-slot:default="{ row }">{{ formatBucketTime(row) }}</template>
          </el-table-column>
          <el-table-column v-if="seriesList.length > 1" label="参数" min-width="140" show-overflow-tooltip>
            <template v-slot:default="{ row }">{{ registerLabel(row.__register) }}</template>
          </el-table-column>
          <el-table-column label="平均值" width="110" align="right" class-name="mono-cell">
            <template v-slot:default="{ row }">{{ fmtNum(bucketValue(row)) }}</template>
          </el-table-column>
          <el-table-column label="最小值" width="110" align="right" class-name="mono-cell">
            <template v-slot:default="{ row }">{{ fmtNum(row.min_value) }}</template>
          </el-table-column>
          <el-table-column label="最大值" width="110" align="right" class-name="mono-cell">
            <template v-slot:default="{ row }">{{ fmtNum(row.max_value) }}</template>
          </el-table-column>
          <el-table-column label="采样数" width="90" align="right" class-name="mono-cell">
            <template v-slot:default="{ row }">{{ row.sample_count ?? row.count ?? '-' }}</template>
          </el-table-column>
          <template #empty>
            <el-empty description="无数据" :image-size="80" />
          </template>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, reactive, computed } from 'vue'
import { useRoute } from 'vue-router'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import { devicesApi, dataApi, alarmsApi, type Device, type Register, type AlarmRule } from '@/api'
import { registerScadaTheme, scadaThemeName, applyScadaTheme, SCADA_LEVEL_COLORS } from '@/utils/echartsTheme'
import { assertBinaryDownload, describeDownloadError, downloadBlob } from '@/utils/export'

const route = useRoute()

registerScadaTheme(echarts)

const devices = ref<Device[]>([])
const registers = ref<Register[]>([])
const tableData = ref<any[]>([])
const loading = ref(false)
const exporting = ref(false)
const exportStatus = ref('')
const exportOk = ref(true)
const chartRef = ref<HTMLElement>()
let chart: echarts.ECharts | null = null
let chartResizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
// 请求序号：设备/时间范围快速切换时丢弃过期响应，避免旧数据覆盖新数据
let querySeq = 0
let registerSeq = 0
let ruleSeq = 0

const filter = reactive({
  device_id: '',
  register_names: [] as string[],
  timeRange: null as any,
  interval: '',
})

// 报警规则：仅用于给曲线画真实阈值参考线（阈值来自后端配置的 threshold 字段）
const alarmRules = ref<AlarmRule[]>([])

// 曲线数据：每个寄存器一条曲线，横轴为共享的时间桶
interface RegSeries {
  register: string
  name: string
  unit: string
  points: Record<string, number | null>
}
const seriesList = ref<RegSeries[]>([])
const timeAxis = ref<string[]>([])
// 横轴跨度超过一天时，标签带上日期
const longSpan = computed(() => {
  const list = timeAxis.value
  if (list.length < 2) return false
  const a = toDate(list[0])
  const b = toDate(list[list.length - 1])
  if (!a || !b) return false
  return b.getTime() - a.getTime() > 86400000
})
const chartAxisData = computed(() => timeAxis.value.map(t => axisLabelOf(t)))

const LEVEL_TEXT: Record<string, string> = { critical: '严重', warning: '警告', info: '信息' }
const QUICK_OFFSETS: Record<string, number> = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000 }
const INTERVAL_TEXT: Record<string, string> = { '': '原始', '1min': '1 分钟', '5min': '5 分钟', '1hour': '1 小时', '1day': '1 天' }
const INTERVAL_MS: Record<string, number> = { '1min': 60000, '5min': 300000, '1hour': 3600000, '1day': 86400000 }

const MAX_CHART_POINTS = 500  // 图表最大数据点数

// 后端 /api/data/history 返回聚合字段：time_bucket/avg_value/min_value/max_value/sample_count
// （兼容原始明细字段 timestamp/value/count）
function bucketTime(row: any): string { return row?.time_bucket || row?.timestamp || '' }
function bucketValue(row: any): number | undefined { return row?.avg_value ?? row?.value }
function fmtNum(v: any): string { return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '-' }
function toDate(t: string): Date | null {
  if (!t) return null
  const d = new Date(t.includes('T') ? t : t.replace(' ', 'T'))
  return isNaN(d.getTime()) ? null : d
}
function formatBucketTime(row: any): string {
  const t = bucketTime(row)
  if (!t) return '-'
  // 1day 聚合只返回日期（2026-09-18），按 UTC 解析会偏移时区，原样显示
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const d = toDate(t)
  return d ? d.toLocaleString() : t
}
// 横轴标签：跨度超过一天时补上日期，避免只看时分无法定位
function axisLabelOf(t: string): string {
  if (!t) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.slice(5)
  const d = toDate(t)
  if (!d) return t
  if (longSpan.value) {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }
  return d.toLocaleTimeString('zh-CN', { hour12: false })
}
function fmtDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function registerLabel(name: string): string {
  if (!name) return '-'
  if (name === '*') return '全部寄存器（合并）'
  const r = registers.value.find(x => x.name === name)
  return r?.description || name
}
function registerUnit(name: string): string {
  if (!name || name === '*') return ''
  return registers.value.find(x => x.name === name)?.unit || ''
}

// 阈值参考线：取后端报警规则里的真实 threshold；没有规则就不画
interface ThresholdLine { value: number; level: string; text: string }
function thresholdOf(register: string): ThresholdLine | null {
  if (!register || register === '*') return null
  const hit = alarmRules.value.find(r =>
    r.device_id === filter.device_id &&
    r.register_name === register &&
    Number.isFinite(Number(r.threshold)))
  if (!hit) return null
  const level = LEVEL_TEXT[String(hit.level)] ? String(hit.level) : 'info'
  return { value: Number(hit.threshold), level, text: `报警阈值(${LEVEL_TEXT[level]})` }
}
const hasThreshold = computed(() => seriesList.value.some(s => !!thresholdOf(s.register)))

// ========== 查询窗口提示（时间范围 × 聚合粒度） ==========
const rangeSpanMs = computed(() => {
  const r = filter.timeRange
  if (!r || r.length !== 2) return 0
  const span = new Date(r[1]).getTime() - new Date(r[0]).getTime()
  return Number.isFinite(span) && span > 0 ? span : 0
})
const rangeSpanText = computed(() => {
  const ms = rangeSpanMs.value
  if (!ms) return '未设置范围'
  if (ms >= 86400000) return `约 ${(ms / 86400000).toFixed(ms % 86400000 ? 1 : 0)} 天`
  if (ms >= 3600000) return `约 ${(ms / 3600000).toFixed(ms % 3600000 ? 1 : 0)} 小时`
  return `约 ${Math.round(ms / 60000)} 分钟`
})
const windowHint = computed(() => {
  const intervalLabel = INTERVAL_TEXT[filter.interval] ?? filter.interval
  const step = INTERVAL_MS[filter.interval]
  if (!step) return `${rangeSpanText.value} · 原始明细（按采样间隔，不做聚合）`
  const ms = rangeSpanMs.value
  if (!ms) return `聚合 ${intervalLabel}`
  const points = Math.ceil(ms / step)
  const tail = points > MAX_CHART_POINTS ? ` · 超出 ${MAX_CHART_POINTS} 点将自动降采样` : ''
  return `${rangeSpanText.value} · 聚合 ${intervalLabel} · 预计 ${points} 个点${tail}`
})
const windowSummary = computed(() => {
  const r = filter.timeRange
  const intervalLabel = INTERVAL_TEXT[filter.interval] ?? filter.interval
  if (!r || r.length !== 2) return `聚合 ${intervalLabel}`
  return `${fmtDateTime(new Date(r[0]))} → ${fmtDateTime(new Date(r[1]))} · ${intervalLabel}聚合`
})

// 快捷区间高亮：由实际时间范围反推，避免手动改日期后按钮仍高亮
const activeQuick = computed(() => {
  const r = filter.timeRange
  if (!r || r.length !== 2) return ''
  const span = new Date(r[1]).getTime() - new Date(r[0]).getTime()
  const gap = Date.now() - new Date(r[1]).getTime()
  for (const [key, ms] of Object.entries(QUICK_OFFSETS)) {
    if (Math.abs(span - ms) < 60000 && Math.abs(gap) < 300000) return key
  }
  return ''
})

function setQuickRange(range: string) {
  const now = new Date()
  filter.timeRange = [new Date(now.getTime() - (QUICK_OFFSETS[range] || 3600000)), now]
}

// 「全部寄存器」与具体寄存器互斥：选中全部则只保留全部，选具体项则去掉全部
function onRegisterChange(val: string[]) {
  const list = Array.isArray(val) ? val : []
  if (list[list.length - 1] === '*') filter.register_names = ['*']
  else if (list.includes('*')) filter.register_names = list.filter(v => v !== '*')
}

function handleResize() { chart?.resize() }

onMounted(async () => {
  setQuickRange('1h')
  try { const data = await devicesApi.getAll(); devices.value = data.devices || [] } catch (e: any) { console.warn('[History] 加载失败:', e?.message || e) }
  // 从路由query参数中读取设备ID（从设备管理页面跳转过来）
  const queryDevice = route.query.device as string
  if (queryDevice && devices.value.some(d => d.device_id === queryDevice)) {
    filter.device_id = queryDevice
    loadRegisters(queryDevice)
    loadRules(queryDevice)
  }
  if (chartRef.value) {
    chart = echarts.init(chartRef.value, scadaThemeName())
    // 侧边栏折叠不会触发 window resize，需要监听容器尺寸变化
    chartResizeObserver = new ResizeObserver(() => chart?.resize())
    chartResizeObserver.observe(chartRef.value)
    // 深浅主题切换后重建实例（ECharts 不支持运行时换主题）
    themeObserver = new MutationObserver(() => {
      if (!chart) return
      chart = applyScadaTheme(chart, echarts)
      renderChart()
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  }
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chartResizeObserver?.disconnect()
  chartResizeObserver = null
  themeObserver?.disconnect()
  themeObserver = null
  chart?.dispose()
  chart = null
})

async function loadRegisters(deviceId: string) {
  const seq = ++registerSeq
  try {
    const data = await devicesApi.getById(deviceId)
    if (seq !== registerSeq) return  // 已切换到其他设备，丢弃过期响应
    registers.value = data.device?.registers || []
  } catch (e: any) { console.warn('[History] 加载失败:', e?.message || e) }
}

// 切设备时清空上一个设备的寄存器选择，避免提交无效参数
function onDeviceChange(deviceId: string) {
  filter.register_names = []
  seriesList.value = []
  timeAxis.value = []
  tableData.value = []
  chart?.clear()
  if (deviceId) { loadRegisters(deviceId); loadRules(deviceId) }
}

async function loadRules(deviceId: string) {
  const seq = ++ruleSeq
  try {
    const data = await alarmsApi.getRules()
    if (seq !== ruleSeq) return
    alarmRules.value = Array.isArray(data?.rules) ? data.rules : []
  } catch (e: any) {
    // 报警规则拿不到时只是不画阈值线，不影响历史查询
    console.warn('[History] 报警规则加载失败:', e?.message || e)
    if (seq === ruleSeq) alarmRules.value = []
  }
}

// 多寄存器 → 每个寄存器一次请求，再按时间桶合并成多条曲线
function buildSeries(results: Array<{ register: string; rows: any[] }>) {
  const timeSet = new Set<string>()
  results.forEach(r => r.rows.forEach(row => { const t = bucketTime(row); if (t) timeSet.add(t) }))
  let times = Array.from(timeSet).sort()
  // 大数据量采样：超过MAX_CHART_POINTS时均匀采样
  if (times.length > MAX_CHART_POINTS) {
    const step = Math.ceil(times.length / MAX_CHART_POINTS)
    times = times.filter((_, i) => i % step === 0)
  }
  timeAxis.value = times
  seriesList.value = results.map(r => {
    const points: Record<string, number | null> = {}
    r.rows.forEach(row => {
      const t = bucketTime(row)
      if (!t) return
      const v = bucketValue(row)
      points[t] = (typeof v === 'number' && Number.isFinite(v)) ? v : null
    })
    return { register: r.register, name: registerLabel(r.register), unit: registerUnit(r.register), points }
  })
}

function renderChart() {
  if (!chart) return
  // setOption(..., true) 会重建图例，需带回用户已勾选的系列，否则刷新后图例开关被重置
  const prevLegend = (chart.getOption() as any)?.legend?.[0]?.selected
  const legendSelected = prevLegend && Object.keys(prevLegend).length ? prevLegend : undefined

  const unitByName: Record<string, string> = {}
  seriesList.value.forEach(s => { unitByName[s.name] = s.unit })

  chart.setOption({
    legend: { top: 0, right: 0, type: 'scroll', selectedMode: 'multiple', selected: legendSelected },
    tooltip: {
      trigger: 'axis',
      // 十字指针 + 时间/值/单位
      axisPointer: { type: 'cross', snap: true },
      formatter: (params: any) => {
        const arr = Array.isArray(params) ? params : [params]
        if (!arr.length) return ''
        const head = `${arr[0].axisValueLabel ?? arr[0].axisValue ?? ''}`
        const rows = arr
          .filter((p: any) => p.value != null && Number.isFinite(Number(p.value)))
          .map((p: any) => {
            const unit = unitByName[p.seriesName]
            return `${p.marker}${p.seriesName}: <b>${Number(p.value).toFixed(2)}</b>${unit ? ' ' + unit : ''}`
          })
        return head + (rows.length ? '<br/>' + rows.join('<br/>') : '<br/>无数据')
      },
    },
    grid: { left: 12, right: 16, top: 34, bottom: 58, containLabel: true },
    xAxis: { type: 'category', data: chartAxisData.value, boundaryGap: false },
    yAxis: { type: 'value', scale: true },
    dataZoom: [
      { type: 'inside', throttle: 50, zoomOnMouseWheel: true, moveOnMouseMove: true },
      { type: 'slider', height: 20, bottom: 8, borderColor: 'transparent', showDetail: false },
    ],
    series: seriesList.value.map(s => {
      const threshold = thresholdOf(s.register)
      return {
        name: s.name,
        type: 'line',
        smooth: true,
        showSymbol: false,
        emphasis: { focus: 'series' },
        areaStyle: { opacity: 0.12 },
        data: timeAxis.value.map(t => s.points[t] ?? null),
        markLine: threshold ? {
          silent: true,
          symbol: 'none',
          data: [{
            yAxis: threshold.value,
            name: threshold.text,
            lineStyle: { color: SCADA_LEVEL_COLORS[threshold.level] || SCADA_LEVEL_COLORS.info, type: 'dashed', width: 1 },
            label: { formatter: `${threshold.text} ${threshold.value}${s.unit ? ' ' + s.unit : ''}`, position: 'insideEndTop' },
          }],
        } : undefined,
      }
    }),
  }, true)
}

async function queryHistory() {
  if (!filter.device_id || !filter.register_names.length) { ElMessage.warning('请选择设备和参数'); return }
  const seq = ++querySeq
  loading.value = true
  exportStatus.value = ''
  try {
    const params: any = { interval: filter.interval }
    const start = filter.timeRange?.[0]
    const end = filter.timeRange?.[1]
    if (filter.timeRange?.length === 2) { params.start = new Date(start).toISOString(); params.end = new Date(end).toISOString() }
    const wanted = filter.register_names
    const results = await Promise.all(wanted.map(register =>
      dataApi.getHistory(filter.device_id, register, params)
        .then(data => ({ register, rows: data.data || [], failed: false }))
        .catch(() => ({ register, rows: [] as any[], failed: true })),
    ))
    if (seq !== querySeq) return  // 已有更新的查询，丢弃过期响应

    // 全部请求都失败时给出明确提示，避免与"确实没有数据"混淆
    if (results.length && results.every(r => r.failed)) {
      tableData.value = []
      seriesList.value = []
      timeAxis.value = []
      renderChart()
      ElMessage.error('历史数据查询失败，请稍后重试')
      return
    }

    // 明细表：多寄存器时补上来源寄存器列
    const flat: any[] = []
    results.forEach(({ register, rows }) => {
      rows.forEach(row => flat.push({ ...row, __register: register, __t: bucketTime(row) }))
    })
    flat.sort((a, b) => String(a.__t).localeCompare(String(b.__t)))
    tableData.value = flat

    buildSeries(results)
    renderChart()
  } catch (e: any) { console.warn('[History] 加载失败:', e?.message || e) }
  finally { if (seq === querySeq) loading.value = false }
}

// responseType:'blob' 会把后端 JSON 错误体包成 Blob。原先这里只在 catch 里解包，
// 漏判"HTTP 200 + JSON 错误体"——那种情况不抛异常，会直接下载一个假 CSV。
// 现改用 @/utils/export 的统一守卫（判据是内容本身而非 blob.type）。

async function exportData() {
  if (!filter.device_id) { ElMessage.warning('请先选择设备'); return }
  if (exporting.value) return
  exporting.value = true
  exportStatus.value = ''
  try {
    const params: any = { format: 'csv' }
    if (filter.timeRange?.length === 2) {
      params.start_time = new Date(filter.timeRange[0]).toISOString()
      params.end_time = new Date(filter.timeRange[1]).toISOString()
    } else {
      // 默认导出最近24小时
      params.start_time = new Date(Date.now() - 86400000).toISOString()
      params.end_time = new Date().toISOString()
    }
    const blob = await dataApi.exportDevice(filter.device_id, params) as any
    // 统一守卫：非 Blob / 空文件 / 内容是 JSON 错误体，都在这里抛出可读错误
    await assertBinaryDownload(blob)
    downloadBlob(blob, `device_${filter.device_id}_${new Date().toISOString().slice(0, 10)}.csv`)
    exportOk.value = true
    exportStatus.value = `已导出 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`
    ElMessage.success('导出成功')
  } catch (e: any) {
    console.warn('[History] 导出失败:', e?.message || e)
    const reason = await describeDownloadError(e)
    exportOk.value = false
    exportStatus.value = `导出失败：${reason}`
    ElMessage.error('导出失败: ' + reason)
  } finally { exporting.value = false }
}
</script>

<style scoped>
.history-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--bg-page);
  color: var(--text-primary);
}

.panel__meta {
  font-size: var(--font-xs);
  font-weight: var(--weight-normal);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.panel__tools {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--space-4);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.field__label {
  font-size: var(--font-xs);
  font-weight: var(--weight-medium);
  color: var(--text-muted);
}

.field__control {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.field--actions {
  flex-direction: row;
  align-items: center;
  gap: var(--space-2);
}

/* 时间范围 × 聚合粒度：同属一个查询窗口，用同一块底色绑定表达 */
.query-window {
  margin-top: var(--space-4);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
}

.query-window__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px dashed var(--border-base);
}

.query-window__title {
  font-size: var(--font-xs);
  font-weight: var(--weight-semibold);
  color: var(--text-secondary);
  letter-spacing: 0.04em;
}

.query-window__hint {
  font-size: var(--font-xs);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.query-window__body {
  display: flex;
  align-items: flex-end;
  gap: var(--space-3);
  padding: var(--space-3);
  flex-wrap: wrap;
}

.window-operator {
  font-size: var(--font-lg);
  color: var(--text-disabled);
  padding-bottom: var(--space-2);
}

.chart-wrap {
  position: relative;
}

.chart-container {
  height: 420px;
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

:deep(.mono-cell .cell) {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

@media (max-width: 900px) {
  .query-window__body { flex-direction: column; align-items: stretch; }
  .window-operator { display: none; }
}
</style>
