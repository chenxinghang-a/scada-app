<template>
  <div class="performance-monitor">
    <div class="header">
      <h2>系统性能监控</h2>
      <div class="controls">
        <el-button @click="refreshMetrics" :loading="loading" type="primary" size="small">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
        <el-select v-model="historyHours" @change="loadHistory" size="small" style="width: 120px">
          <el-option label="1小时" :value="1" />
          <el-option label="6小时" :value="6" />
          <el-option label="24小时" :value="24" />
          <el-option label="7天" :value="168" />
        </el-select>
        <el-tag :type="connectionStatusType" size="small">
          {{ connectionStatusText }}
        </el-tag>
      </div>
    </div>

    <div class="metrics-grid">
      <!-- 系统指标卡片 -->
      <el-card class="metric-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <el-icon><Cpu /></el-icon>
            <span>系统资源</span>
          </div>
        </template>
        <div class="metric-items">
          <div class="metric-item">
            <span class="label">CPU使用率</span>
            <el-progress
              :percentage="realtimeMetrics?.system?.cpu_percent || 0"
              :color="getProgressColor(realtimeMetrics?.system?.cpu_percent)"
              :stroke-width="12"
            />
          </div>
          <div class="metric-item">
            <span class="label">内存使用率</span>
            <el-progress
              :percentage="realtimeMetrics?.system?.memory_percent || 0"
              :color="getProgressColor(realtimeMetrics?.system?.memory_percent)"
              :stroke-width="12"
            />
          </div>
          <div class="metric-item">
            <span class="label">磁盘使用率</span>
            <el-progress
              :percentage="realtimeMetrics?.system?.disk_percent || 0"
              :color="getProgressColor(realtimeMetrics?.system?.disk_percent)"
              :stroke-width="12"
            />
          </div>
          <div class="metric-info">
            <span>CPU: {{ realtimeMetrics?.system?.cpu_count || '-' }}核</span>
            <span>内存: {{ realtimeMetrics?.system?.memory_used_gb || '-' }}/{{ realtimeMetrics?.system?.memory_total_gb || '-' }}GB</span>
            <span>磁盘: {{ realtimeMetrics?.system?.disk_free_gb || '-' }}GB可用</span>
          </div>
        </div>
      </el-card>

      <!-- 数据库指标卡片 -->
      <el-card class="metric-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <el-icon><Coin /></el-icon>
            <span>数据库</span>
          </div>
        </template>
        <div class="metric-items">
          <div class="metric-item">
            <span class="label">数据库大小</span>
            <span class="value">{{ realtimeMetrics?.database?.size_mb || 0 }} MB</span>
          </div>
          <div class="metric-item">
            <span class="label">总记录数</span>
            <span class="value">{{ formatNumber(realtimeMetrics?.database?.total_records) }}</span>
          </div>
          <div class="metric-item">
            <span class="label">WAL大小</span>
            <span class="value">{{ realtimeMetrics?.database?.wal_size_mb || 0 }} MB</span>
          </div>
          <div class="table-stats" v-if="realtimeMetrics?.database?.tables">
            <div v-for="(count, table) in realtimeMetrics.database.tables" :key="table" class="table-stat">
              <span class="table-name">{{ table }}</span>
              <span class="table-count">{{ formatNumber(count) }}</span>
            </div>
          </div>
        </div>
      </el-card>

      <!-- 应用指标卡片 -->
      <el-card class="metric-card" shadow="hover">
        <template #header>
          <div class="card-header">
            <el-icon><Monitor /></el-icon>
            <span>应用状态</span>
          </div>
        </template>
        <div class="metric-items">
          <div class="metric-item">
            <span class="label">日志文件数</span>
            <span class="value">{{ realtimeMetrics?.application?.log_count || 0 }}</span>
          </div>
          <div class="metric-item">
            <span class="label">日志总大小</span>
            <span class="value">{{ realtimeMetrics?.application?.log_total_mb || 0 }} MB</span>
          </div>
          <div class="metric-item">
            <span class="label">配置文件数</span>
            <span class="value">{{ realtimeMetrics?.application?.config_count || 0 }}</span>
          </div>
          <div class="metric-item">
            <span class="label">活跃线程数</span>
            <span class="value">{{ realtimeMetrics?.system?.thread_count || 0 }}</span>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 历史趋势图 -->
    <el-card class="chart-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <el-icon><TrendCharts /></el-icon>
          <span>历史趋势</span>
        </div>
      </template>
      <div ref="cpuChart" class="chart-container"></div>
    </el-card>

    <!-- 指标摘要 -->
    <el-card class="summary-card" shadow="hover" v-if="summary">
      <template #header>
        <div class="card-header">
          <el-icon><DataAnalysis /></el-icon>
          <span>指标摘要 ({{ summary.hours }}小时)</span>
        </div>
      </template>
      <el-descriptions :column="3" border>
        <el-descriptions-item label="采样数">{{ summary.samples }}</el-descriptions-item>
        <el-descriptions-item label="CPU平均">{{ summary.cpu?.avg || 0 }}%</el-descriptions-item>
        <el-descriptions-item label="CPU最大">{{ summary.cpu?.max || 0 }}%</el-descriptions-item>
        <el-descriptions-item label="内存平均">{{ summary.memory?.avg || 0 }}%</el-descriptions-item>
        <el-descriptions-item label="内存最大">{{ summary.memory?.max || 0 }}%</el-descriptions-item>
        <el-descriptions-item label="内存最小">{{ summary.memory?.min || 0 }}%</el-descriptions-item>
      </el-descriptions>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
import { Refresh, Cpu, Coin, Monitor, TrendCharts, DataAnalysis } from '@element-plus/icons-vue'
import * as echarts from 'echarts'
import { performanceApi } from '@/api/performance'
import { showActionError } from '@/utils/error'

// 状态
const loading = ref(false)
const realtimeMetrics = ref<any>(null)
const summary = ref<any>(null)
const historyHours = ref(24)
const historyData = ref<any[]>([])
const connected = ref(false)

// 图表
const cpuChart = ref<HTMLElement | null>(null)
let cpuChartInstance: echarts.ECharts | null = null

// 轮询
let refreshTimer: ReturnType<typeof setInterval> | null = null

// 计算属性
const connectionStatusType = computed(() => connected.value ? 'success' : 'danger')
const connectionStatusText = computed(() => connected.value ? '已连接' : '未连接')

// 格式化数字
function formatNumber(num: number | undefined): string {
  if (num === undefined || num === null) return '-'
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
  return num.toString()
}

// 进度条颜色
function getProgressColor(percent: number | undefined): string {
  if (!percent) return '#409eff'
  if (percent >= 90) return '#f56c6c'
  if (percent >= 70) return '#e6a23c'
  return '#67c23a'
}

// 刷新实时指标
async function refreshMetrics() {
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

// 加载历史数据
async function loadHistory() {
  try {
    const result = await performanceApi.getMetricsHistory(historyHours.value)
    historyData.value = result.data || []
    await nextTick()
    updateChart()
  } catch (e) {
    showActionError('获取历史数据', e)
  }
}

// 加载摘要
async function loadSummary() {
  try {
    summary.value = await performanceApi.getMetricsSummary(historyHours.value)
  } catch (e) {
    showActionError('获取指标摘要', e)
  }
}

// 更新图表
function updateChart() {
  if (!cpuChart.value || !historyData.value.length) return

  if (!cpuChartInstance) {
    cpuChartInstance = echarts.init(cpuChart.value)
  }

  const times = historyData.value.map((m: any) => {
    const d = new Date(m.timestamp)
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  })
  const cpuData = historyData.value.map((m: any) => m.system?.cpu_percent || 0)
  const memData = historyData.value.map((m: any) => m.system?.memory_percent || 0)
  const diskData = historyData.value.map((m: any) => m.system?.disk_percent || 0)

  cpuChartInstance.setOption({
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        let result = params[0].axisValue + '<br/>'
        params.forEach((p: any) => {
          result += `${p.marker} ${p.seriesName}: ${p.value}%<br/>`
        })
        return result
      },
    },
    legend: {
      data: ['CPU', '内存', '磁盘'],
      textStyle: { color: '#c9d1d9' },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: times,
      axisLabel: { color: '#8b949e' },
      axisLine: { lineStyle: { color: '#30363d' } },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      axisLabel: { color: '#8b949e', formatter: '{value}%' },
      axisLine: { lineStyle: { color: '#30363d' } },
      splitLine: { lineStyle: { color: '#21262d' } },
    },
    series: [
      {
        name: 'CPU',
        type: 'line',
        data: cpuData,
        smooth: true,
        lineStyle: { color: '#58a6ff' },
        itemStyle: { color: '#58a6ff' },
        areaStyle: { color: 'rgba(88, 166, 255, 0.1)' },
      },
      {
        name: '内存',
        type: 'line',
        data: memData,
        smooth: true,
        lineStyle: { color: '#3fb950' },
        itemStyle: { color: '#3fb950' },
        areaStyle: { color: 'rgba(63, 185, 80, 0.1)' },
      },
      {
        name: '磁盘',
        type: 'line',
        data: diskData,
        smooth: true,
        lineStyle: { color: '#d29922' },
        itemStyle: { color: '#d29922' },
        areaStyle: { color: 'rgba(210, 153, 34, 0.1)' },
      },
    ],
  })
}

// 窗口大小变化处理
function handleResize() {
  cpuChartInstance?.resize()
}

onMounted(async () => {
  await refreshMetrics()
  await loadHistory()
  await loadSummary()

  // 每30秒自动刷新
  refreshTimer = setInterval(() => {
    refreshMetrics()
  }, 30000)

  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
  }
  if (cpuChartInstance) {
    cpuChartInstance.dispose()
  }
  window.removeEventListener('resize', handleResize)
})
</script>

<style scoped>
.performance-monitor {
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header h2 {
  margin: 0;
  color: #c9d1d9;
}

.controls {
  display: flex;
  gap: 12px;
  align-items: center;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

.metric-card {
  background: #161b22;
  border: 1px solid #30363d;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #c9d1d9;
  font-weight: 600;
}

.metric-items {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.metric-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-item .label {
  font-size: 12px;
  color: #8b949e;
}

.metric-item .value {
  font-size: 18px;
  font-weight: 600;
  color: #c9d1d9;
}

.metric-info {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: #8b949e;
  padding-top: 8px;
  border-top: 1px solid #30363d;
}

.table-stats {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid #30363d;
}

.table-stat {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.table-name {
  color: #8b949e;
}

.table-count {
  color: #c9d1d9;
  font-weight: 500;
}

.chart-card {
  background: #161b22;
  border: 1px solid #30363d;
  margin-bottom: 20px;
}

.chart-container {
  height: 300px;
}

.summary-card {
  background: #161b22;
  border: 1px solid #30363d;
}

/* Element Plus 深色主题覆盖 */
:deep(.el-card) {
  background: #161b22;
  border-color: #30363d;
  color: #c9d1d9;
}

:deep(.el-card__header) {
  background: #161b22;
  border-bottom-color: #30363d;
  color: #c9d1d9;
}

:deep(.el-descriptions) {
  background: #161b22;
}

:deep(.el-descriptions__label) {
  background: #0d1117;
  color: #8b949e;
  border-color: #30363d;
}

:deep(.el-descriptions__content) {
  background: #161b22;
  color: #c9d1d9;
  border-color: #30363d;
}

:deep(.el-progress__text) {
  color: #c9d1d9;
}
</style>
