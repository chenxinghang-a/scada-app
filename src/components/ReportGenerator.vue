<template>
  <el-dialog v-model="visible" title="生成报表" width="600px">
    <el-form :model="form" label-width="120px">
      <!-- 报表类型 -->
      <el-form-item label="报表类型">
        <el-select v-model="form.type" style="width: 100%">
          <el-option label="设备运行报表" value="device" />
          <el-option label="报警统计报表" value="alarm" />
          <el-option label="能源消耗报表" value="energy" />
          <el-option label="生产效率报表" value="production" />
        </el-select>
      </el-form-item>

      <!-- 时间范围 -->
      <el-form-item label="时间范围">
        <el-date-picker
          v-model="form.timeRange"
          type="datetimerange"
          range-separator="至"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          style="width: 100%"
        />
      </el-form-item>

      <!-- 设备选择 -->
      <el-form-item v-if="form.type === 'device'" label="选择设备">
        <el-select v-model="form.deviceIds" multiple style="width: 100%">
          <el-option
            v-for="device in devices"
            :key="device.device_id"
            :label="device.name || device.device_id"
            :value="device.device_id"
          />
        </el-select>
      </el-form-item>

      <!-- 报表格式 -->
      <el-form-item label="导出格式">
        <el-radio-group v-model="form.format">
          <el-radio value="excel">Excel</el-radio>
          <el-radio value="pdf">PDF</el-radio>
          <el-radio value="csv">CSV</el-radio>
        </el-radio-group>
      </el-form-item>

      <!-- 包含内容 -->
      <el-form-item label="包含内容">
        <el-checkbox-group v-model="form.sections">
          <el-checkbox value="summary">数据摘要</el-checkbox>
          <el-checkbox value="charts">图表</el-checkbox>
          <el-checkbox value="details">详细数据</el-checkbox>
          <el-checkbox value="statistics">统计分析</el-checkbox>
        </el-checkbox-group>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="generating" @click="generateReport">
        生成报表
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { devicesApi, dataApi } from '@/api'

const visible = ref(false)
const generating = ref(false)
const devices = ref<any[]>([])

const form = reactive({
  type: 'device',
  timeRange: [] as Date[],
  deviceIds: [] as string[],
  format: 'excel',
  sections: ['summary', 'charts', 'details'],
})

onMounted(async () => {
  try {
    const data = await devicesApi.getAll()
    devices.value = data.devices || []
  } catch (e) {
    console.warn('加载设备列表失败:', e)
  }
})

function show() {
  visible.value = true
}

async function generateReport() {
  if (!form.timeRange || form.timeRange.length !== 2) {
    ElMessage.warning('请选择时间范围')
    return
  }

  generating.value = true

  try {
    const params = {
      format: form.format,
      start_time: form.timeRange[0].toISOString(),
      end_time: form.timeRange[1].toISOString(),
    }

    let blob: Blob

    if (form.type === 'device' && form.deviceIds.length > 0) {
      // 设备报表
      const deviceId = form.deviceIds[0]
      blob = await dataApi.exportDevice(deviceId, params) as unknown as Blob
    } else {
      // 报警报表
      blob = await dataApi.exportAlarms(params) as unknown as Blob
    }

    // 下载文件
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report_${form.type}_${new Date().toISOString().slice(0, 10)}.${form.format}`
    a.click()
    URL.revokeObjectURL(url)

    ElMessage.success('报表生成成功')
    visible.value = false
  } catch (e: any) {
    ElMessage.error('报表生成失败: ' + (e?.message || '未知错误'))
  } finally {
    generating.value = false
  }
}

defineExpose({ show })
</script>

<style scoped>
.el-form-item {
  margin-bottom: 20px;
}
</style>
