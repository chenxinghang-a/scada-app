<template>
  <div class="history-page">
    <el-card shadow="hover">
      <template #header><span>历史数据查询</span></template>
      <el-form :inline="true" class="filter-form">
        <el-form-item label="设备">
          <el-select v-model="filter.device_id" placeholder="选择设备" @change="loadRegisters" style="width:180px">
            <el-option v-for="d in devices" :key="d.device_id" :label="d.name || d.device_name || d.device_id" :value="d.device_id" />
          </el-select>
        </el-form-item>
        <el-form-item label="参数">
          <el-select v-model="filter.register_name" placeholder="选择参数" style="width:150px">
            <el-option label="全部" value="*" />
            <el-option v-for="r in registers" :key="r.name" :label="r.description || r.name" :value="r.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="时间范围">
          <el-button-group class="mr-8">
            <el-button size="small" :type="filter.quickRange === '1h' ? 'primary' : ''" @click="setQuickRange('1h')">1小时</el-button>
            <el-button size="small" :type="filter.quickRange === '6h' ? 'primary' : ''" @click="setQuickRange('6h')">6小时</el-button>
            <el-button size="small" :type="filter.quickRange === '24h' ? 'primary' : ''" @click="setQuickRange('24h')">24小时</el-button>
            <el-button size="small" :type="filter.quickRange === '7d' ? 'primary' : ''" @click="setQuickRange('7d')">7天</el-button>
          </el-button-group>
          <el-date-picker v-model="filter.timeRange" type="datetimerange" range-separator="至" start-placeholder="开始" end-placeholder="结束" />
        </el-form-item>
        <el-form-item label="聚合">
          <el-select v-model="filter.interval" style="width:100px">
            <el-option label="原始" value="" />
            <el-option label="1分钟" value="1min" />
            <el-option label="5分钟" value="5min" />
            <el-option label="1小时" value="1hour" />
            <el-option label="1天" value="1day" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="queryHistory">查询</el-button>
          <el-button @click="exportData">导出</el-button>
        </el-form-item>
      </el-form>

      <div ref="chartRef" class="chart-container"></div>

      <el-table :data="tableData" stripe class="mt-16" max-height="400" v-loading="loading">
        <el-table-column label="时间" width="180">
          <template #default="{ row }">{{ formatBucketTime(row) }}</template>
        </el-table-column>
        <el-table-column label="平均值" width="100">
          <template #default="{ row }">{{ fmtNum(bucketValue(row)) }}</template>
        </el-table-column>
        <el-table-column label="最小值" width="100">
          <template #default="{ row }">{{ fmtNum(row.min_value) }}</template>
        </el-table-column>
        <el-table-column label="最大值" width="100">
          <template #default="{ row }">{{ fmtNum(row.max_value) }}</template>
        </el-table-column>
        <el-table-column label="采样数" width="80">
          <template #default="{ row }">{{ row.sample_count ?? row.count ?? '-' }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, reactive } from 'vue'
import { useRoute } from 'vue-router'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import { devicesApi, dataApi, type Device, type Register, type HistoryRecord } from '@/api'

const route = useRoute()

const devices = ref<Device[]>([])
const registers = ref<Register[]>([])
const tableData = ref<any[]>([])
const loading = ref(false)
const exporting = ref(false)
const chartRef = ref<HTMLElement>()
let chart: echarts.ECharts | null = null
let chartResizeObserver: ResizeObserver | null = null
// 请求序号：设备/时间范围快速切换时丢弃过期响应，避免旧数据覆盖新数据
let querySeq = 0
let registerSeq = 0

const filter = reactive({ device_id: '', register_name: '', timeRange: null as any, interval: '', quickRange: '1h' })

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
function axisLabelOf(row: any): string {
  const t = bucketTime(row)
  if (!t) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.slice(5)
  const d = toDate(t)
  return d ? d.toLocaleTimeString('zh-CN', { hour12: false }) : t
}

function setQuickRange(range: string) {
  filter.quickRange = range
  const now = new Date()
  const offsets: Record<string, number> = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000 }
  filter.timeRange = [new Date(now.getTime() - (offsets[range] || 3600000)), now]
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
  }
  if (chartRef.value) {
    chart = echarts.init(chartRef.value)
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', data: [] },
      yAxis: { type: 'value' },
      series: [{ type: 'line', smooth: true, showSymbol: false, areaStyle: { opacity: 0.15 }, data: [] }],
    })
    // 侧边栏折叠不会触发 window resize，需要监听容器尺寸变化
    chartResizeObserver = new ResizeObserver(() => chart?.resize())
    chartResizeObserver.observe(chartRef.value)
  }
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chartResizeObserver?.disconnect()
  chartResizeObserver = null
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

const MAX_CHART_POINTS = 500  // 图表最大数据点数

async function queryHistory() {
  if (!filter.device_id || !filter.register_name) { ElMessage.warning('请选择设备和参数'); return }
  const seq = ++querySeq
  loading.value = true
  try {
    const params: any = { interval: filter.interval }
    if (filter.timeRange?.length === 2) { params.start = filter.timeRange[0].toISOString(); params.end = filter.timeRange[1].toISOString() }
    const data = await dataApi.getHistory(filter.device_id, filter.register_name, params)
    if (seq !== querySeq) return  // 已有更新的查询，丢弃过期响应
    tableData.value = data.data || []
    if (chart && tableData.value.length > 0) {
      // 大数据量采样：超过MAX_CHART_POINTS时均匀采样
      let displayData = tableData.value
      if (displayData.length > MAX_CHART_POINTS) {
        const step = Math.ceil(displayData.length / MAX_CHART_POINTS)
        displayData = displayData.filter((_, i) => i % step === 0)
      }
      chart.setOption({
        xAxis: { data: displayData.map(d => axisLabelOf(d)) },
        series: [{ data: displayData.map(d => bucketValue(d) ?? null) }],
      })
    } else if (chart) {
      // 结果为空时清空图表，避免残留上一次查询的曲线
      chart.setOption({ xAxis: { data: [] }, series: [{ data: [] }] })
    }
  } catch (e: any) { console.warn('[History] 加载失败:', e?.message || e) }
  finally { if (seq === querySeq) loading.value = false }
}

// responseType:'blob' 会把后端 JSON 错误体包成 Blob，这里解出真实原因
async function extractBlobError(e: any): Promise<string> {
  const data = e?.response?.data
  if (data instanceof Blob) {
    try {
      const obj = JSON.parse(await data.text())
      return obj?.message || obj?.error || e?.message || '未知错误'
    } catch { /* 非 JSON 错误体，回落到 axios 消息 */ }
  }
  return e?.response?.data?.error || e?.response?.data?.message || e?.message || '未知错误'
}

async function exportData() {
  if (!filter.device_id) { ElMessage.warning('请先选择设备'); return }
  if (exporting.value) return
  exporting.value = true
  try {
    const params: any = { format: 'csv' }
    if (filter.timeRange?.length === 2) {
      params.start_time = filter.timeRange[0].toISOString()
      params.end_time = filter.timeRange[1].toISOString()
    } else {
      // 默认导出最近24小时
      params.start_time = new Date(Date.now() - 86400000).toISOString()
      params.end_time = new Date().toISOString()
    }
    const blob = await dataApi.exportDevice(filter.device_id, params) as any
    if (!(blob instanceof Blob)) { ElMessage.error('导出失败: 响应格式异常'); return }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `device_${filter.device_id}_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('导出成功')
  } catch (e: any) {
    console.warn('[History] 导出失败:', e?.message || e)
    ElMessage.error('导出失败: ' + await extractBlobError(e))
  } finally { exporting.value = false }
}
</script>

<style scoped>
.filter-form { margin-bottom: 16px; }
.chart-container { height: 350px; }
.mt-16 { margin-top: 16px; }
</style>
