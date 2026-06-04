<template>
  <div class="trend-comparison">
    <div class="comparison-header">
      <h3>趋势对比分析</h3>
      <el-button size="small" @click="addComparison">添加对比</el-button>
    </div>

    <!-- 对比配置 -->
    <div class="comparison-config">
      <div v-for="(comp, index) in comparisons" :key="index" class="comparison-item">
        <el-select v-model="comp.deviceId" placeholder="选择设备" style="width: 150px">
          <el-option
            v-for="device in devices"
            :key="device.device_id"
            :label="device.name || device.device_id"
            :value="device.device_id"
          />
        </el-select>

        <el-select v-model="comp.registerName" placeholder="选择参数" style="width: 120px">
          <el-option
            v-for="reg in getDeviceRegisters(comp.deviceId)"
            :key="reg.name"
            :label="reg.description || reg.name"
            :value="reg.name"
          />
        </el-select>

        <el-date-picker
          v-model="comp.timeRange"
          type="datetimerange"
          range-separator="至"
          start-placeholder="开始"
          end-placeholder="结束"
          style="width: 300px"
        />

        <el-button type="danger" :icon="Delete" circle size="small" @click="removeComparison(index)" />
      </div>
    </div>

    <!-- 对比图表 -->
    <div ref="chartRef" class="comparison-chart"></div>

    <!-- 统计信息 -->
    <div v-if="statistics.length > 0" class="comparison-stats">
      <el-table :data="statistics" size="small" border>
        <el-table-column prop="name" label="参数" />
        <el-table-column prop="avg" label="平均值" />
        <el-table-column prop="min" label="最小值" />
        <el-table-column prop="max" label="最大值" />
        <el-table-column prop="stddev" label="标准差" />
      </el-table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import { Delete } from '@element-plus/icons-vue'
import { devicesApi, dataApi } from '@/api'

interface Comparison {
  deviceId: string
  registerName: string
  timeRange: Date[]
}

interface Device {
  device_id: string
  name: string
  registers: Array<{ name: string; description: string }>
}

interface Statistic {
  name: string
  avg: string
  min: string
  max: string
  stddev: string
}

const chartRef = ref<HTMLElement>()
let chart: echarts.ECharts | null = null
const devices = ref<Device[]>([])
const comparisons = ref<Comparison[]>([])
const statistics = ref<Statistic[]>([])

onMounted(async () => {
  await loadDevices()
  initChart()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  chart?.dispose()
  window.removeEventListener('resize', handleResize)
})

async function loadDevices() {
  try {
    const data = await devicesApi.getAll()
    devices.value = data.devices || []
  } catch (e) {
    console.warn('加载设备列表失败:', e)
  }
}

function initChart() {
  if (!chartRef.value) return
  chart = echarts.init(chartRef.value)
}

function addComparison() {
  comparisons.value.push({
    deviceId: '',
    registerName: '',
    timeRange: [],
  })
}

function removeComparison(index: number) {
  comparisons.value.splice(index, 1)
  updateChart()
}

function getDeviceRegisters(deviceId: string) {
  const device = devices.value.find(d => d.device_id === deviceId)
  return device?.registers || []
}

async function updateChart() {
  if (!chart || comparisons.value.length === 0) return

  const series: any[] = []
  const legendData: string[] = []

  for (const comp of comparisons.value) {
    if (!comp.deviceId || !comp.registerName || comp.timeRange.length !== 2) continue

    try {
      const params = {
        start_time: comp.timeRange[0].toISOString(),
        end_time: comp.timeRange[1].toISOString(),
      }
      const data = await dataApi.getHistory(comp.deviceId, comp.registerName, params)
      const historyData = data.data || []

      const name = `${comp.deviceId}/${comp.registerName}`
      legendData.push(name)

      series.push({
        name,
        type: 'line',
        smooth: true,
        data: historyData.map(d => [d.timestamp, d.value]),
      })

      // 计算统计信息
      const values = historyData.map(d => d.value)
      if (values.length > 0) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length
        const min = Math.min(...values)
        const max = Math.max(...values)
        const variance = values.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / values.length
        const stddev = Math.sqrt(variance)

        statistics.value.push({
          name,
          avg: avg.toFixed(2),
          min: min.toFixed(2),
          max: max.toFixed(2),
          stddev: stddev.toFixed(2),
        })
      }
    } catch (e) {
      console.warn('加载历史数据失败:', e)
    }
  }

  chart.setOption({
    tooltip: {
      trigger: 'axis',
    },
    legend: {
      data: legendData,
    },
    xAxis: {
      type: 'time',
    },
    yAxis: {
      type: 'value',
    },
    series,
  })
}

function handleResize() {
  chart?.resize()
}
</script>

<style scoped>
.trend-comparison {
  padding: 16px;
}

.comparison-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.comparison-header h3 {
  margin: 0;
  font-size: 16px;
}

.comparison-config {
  margin-bottom: 16px;
}

.comparison-item {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.comparison-chart {
  height: 400px;
  margin-bottom: 16px;
}

.comparison-stats {
  margin-top: 16px;
}
</style>
