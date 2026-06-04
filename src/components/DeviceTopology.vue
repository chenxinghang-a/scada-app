<template>
  <div class="topology-container">
    <div class="topology-header">
      <h3>设备拓扑图</h3>
      <div class="topology-actions">
        <el-button size="small" @click="resetZoom">重置缩放</el-button>
        <el-button size="small" @click="toggleLabels">
          {{ showLabels ? '隐藏标签' : '显示标签' }}
        </el-button>
      </div>
    </div>
    <div ref="chartRef" class="topology-chart"></div>

    <!-- 设备详情弹窗 -->
    <el-dialog v-model="detailVisible" title="设备详情" width="400px">
      <el-descriptions v-if="selectedDevice" :column="1" border>
        <el-descriptions-item label="设备ID">{{ selectedDevice.device_id }}</el-descriptions-item>
        <el-descriptions-item label="设备名称">{{ selectedDevice.name }}</el-descriptions-item>
        <el-descriptions-item label="协议">{{ selectedDevice.protocol }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="selectedDevice.connected ? 'success' : 'danger'">
            {{ selectedDevice.connected ? '在线' : '离线' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="地址">
          {{ selectedDevice.host }}:{{ selectedDevice.port }}
        </el-descriptions-item>
      </el-descriptions>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import * as echarts from 'echarts'
import { devicesApi } from '@/api'

interface Device {
  device_id: string
  name: string
  protocol: string
  host: string
  port: number
  connected: boolean
  zone?: string
}

const chartRef = ref<HTMLElement>()
let chart: echarts.ECharts | null = null
const showLabels = ref(true)
const detailVisible = ref(false)
const selectedDevice = ref<Device | null>(null)
const devices = ref<Device[]>([])

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

  // 构建拓扑数据
  const { nodes, links, categories } = buildTopologyData()

  const option = {
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        if (params.dataType === 'node') {
          const device = params.data
          return `
            <div>
              <strong>${device.name || device.id}</strong><br/>
              协议: ${device.protocol}<br/>
              状态: ${device.online ? '在线' : '离线'}<br/>
              ${device.address ? `地址: ${device.address}` : ''}
            </div>
          `
        }
        return ''
      },
    },
    legend: {
      data: categories.map(c => c.name),
      orient: 'vertical',
      right: 10,
      top: 20,
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        data: nodes,
        links: links,
        categories: categories,
        roam: true,
        draggable: true,
        label: {
          show: showLabels.value,
          position: 'right',
          formatter: '{b}',
        },
        lineStyle: {
          color: 'source',
          curveness: 0.3,
        },
        emphasis: {
          focus: 'adjacency',
          lineStyle: {
            width: 4,
          },
        },
        force: {
          repulsion: 200,
          gravity: 0.1,
          edgeLength: 150,
          layoutAnimation: true,
        },
      },
    ],
  }

  chart.setOption(option)

  // 点击事件
  chart.on('click', (params: any) => {
    if (params.dataType === 'node') {
      const device = devices.value.find(d => d.device_id === params.data.id)
      if (device) {
        selectedDevice.value = device
        detailVisible.value = true
      }
    }
  })
}

function buildTopologyData() {
  // 按协议分组
  const protocolGroups: Record<string, Device[]> = {}
  devices.value.forEach(device => {
    const protocol = device.protocol || 'unknown'
    if (!protocolGroups[protocol]) {
      protocolGroups[protocol] = []
    }
    protocolGroups[protocol].push(device)
  })

  // 分类
  const categories = [
    { name: 'Modbus TCP', itemStyle: { color: '#409eff' } },
    { name: 'Modbus RTU', itemStyle: { color: '#67c23a' } },
    { name: 'OPC UA', itemStyle: { color: '#e6a23c' } },
    { name: 'MQTT', itemStyle: { color: '#f56c6c' } },
    { name: 'REST', itemStyle: { color: '#909399' } },
    { name: 'MC协议', itemStyle: { color: '#b37feb' } },
    { name: 'FINS', itemStyle: { color: '#36cfc9' } },
  ]

  const categoryMap: Record<string, number> = {
    'modbus_tcp': 0,
    'modbus_rtu': 1,
    'opcua': 2,
    'mqtt': 3,
    'rest': 4,
    'mc': 5,
    'fins': 6,
  }

  // 节点
  const nodes = devices.value.map(device => ({
    id: device.device_id,
    name: device.name || device.device_id,
    protocol: device.protocol,
    online: device.connected,
    address: `${device.host}:${device.port}`,
    category: categoryMap[device.protocol] ?? 7,
    symbolSize: device.connected ? 30 : 20,
    itemStyle: {
      color: device.connected ? undefined : '#ccc',
    },
  }))

  // 连接（相同zone的设备相互连接）
  const links: any[] = []
  const zoneDevices: Record<string, Device[]> = {}
  devices.value.forEach(device => {
    const zone = device.zone || 'default'
    if (!zoneDevices[zone]) {
      zoneDevices[zone] = []
    }
    zoneDevices[zone].push(device)
  })

  Object.values(zoneDevices).forEach(group => {
    for (let i = 0; i < group.length - 1; i++) {
      links.push({
        source: group[i].device_id,
        target: group[i + 1].device_id,
      })
    }
  })

  return { nodes, links, categories }
}

function handleResize() {
  chart?.resize()
}

function resetZoom() {
  chart?.dispatchAction({
    type: 'restore',
  })
}

function toggleLabels() {
  showLabels.value = !showLabels.value
  chart?.setOption({
    series: [{
      label: {
        show: showLabels.value,
      },
    }],
  })
}
</script>

<style scoped>
.topology-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.topology-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e2e5ea;
}

.topology-header h3 {
  margin: 0;
  font-size: 16px;
  color: #303133;
}

.topology-actions {
  display: flex;
  gap: 8px;
}

.topology-chart {
  flex: 1;
  min-height: 400px;
}
</style>
