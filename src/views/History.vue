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
        <el-table-column prop="timestamp" label="时间" width="180">
          <template #default="{ row }">{{ new Date(row.timestamp).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="value" label="平均值" width="100">
          <template #default="{ row }">{{ row.value?.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column prop="min_value" label="最小值" width="100">
          <template #default="{ row }">{{ row.min_value?.toFixed(2) || '-' }}</template>
        </el-table-column>
        <el-table-column prop="max_value" label="最大值" width="100">
          <template #default="{ row }">{{ row.max_value?.toFixed(2) || '-' }}</template>
        </el-table-column>
        <el-table-column prop="count" label="采样数" width="80" />
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
const chartRef = ref<HTMLElement>()
let chart: echarts.ECharts | null = null

const filter = reactive({ device_id: '', register_name: '', timeRange: null as any, interval: '', quickRange: '1h' })

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
  }
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
  chart?.dispose()
  chart = null
})

async function loadRegisters(deviceId: string) {
  try { const data = await devicesApi.getById(deviceId); registers.value = data.device?.registers || [] } catch (e: any) { console.warn('[History] 加载失败:', e?.message || e) }
}

const MAX_CHART_POINTS = 500  // 图表最大数据点数

async function queryHistory() {
  if (!filter.device_id || !filter.register_name) { ElMessage.warning('请选择设备和参数'); return }
  loading.value = true
  try {
    const params: any = { interval: filter.interval }
    if (filter.timeRange?.length === 2) { params.start = filter.timeRange[0].toISOString(); params.end = filter.timeRange[1].toISOString() }
    const data = await dataApi.getHistory(filter.device_id, filter.register_name, params)
    tableData.value = data.data || []
    if (chart && tableData.value.length > 0) {
      // 大数据量采样：超过MAX_CHART_POINTS时均匀采样
      let displayData = tableData.value
      if (displayData.length > MAX_CHART_POINTS) {
        const step = Math.ceil(displayData.length / MAX_CHART_POINTS)
        displayData = displayData.filter((_, i) => i % step === 0)
      }
      chart.setOption({
        xAxis: { data: displayData.map(d => new Date(d.timestamp).toLocaleTimeString()) },
        series: [{ data: displayData.map(d => d.value) }],
      })
    }
  } catch (e: any) { console.warn('[History] 加载失败:', e?.message || e) }
  finally { loading.value = false }
}

async function exportData() {
  if (!filter.device_id) { ElMessage.warning('请先选择设备'); return }
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
    if (blob instanceof Blob) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `device_${filter.device_id}_${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }
    ElMessage.success('导出成功')
  } catch (e: any) { console.warn('[History] 导出失败:', e?.message || e); ElMessage.error('导出失败: ' + (e?.message || '未知错误')) }
}
</script>

<style scoped>
.filter-form { margin-bottom: 16px; }
.chart-container { height: 350px; }
.mt-16 { margin-top: 16px; }
</style>
