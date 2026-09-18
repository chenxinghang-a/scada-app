<template>
  <div class="control-page">
    <!-- 急停横幅 -->
    <el-alert v-if="eStop.active" type="error" :closable="false" class="mb-16" effect="dark">
      <template #title>
        <div class="estop-banner">
          <span>⚠️ 紧急停止已激活 — {{ eStop.reason }} ({{ eStop.time }})</span>
          <el-button type="warning" size="small" @click="resetEStop">重置急停</el-button>
        </div>
      </template>
    </el-alert>

    <!-- 安全提示 -->
    <el-alert v-if="!canControl" type="warning" :closable="false" class="mb-16">
      <template #title>
        <span>当前角色无控制权限，仅管理员和工程师可执行控制操作</span>
      </template>
    </el-alert>

    <el-row :gutter="16" class="mb-16">
      <!-- 急停按钮 -->
      <el-col :span="4">
        <el-card shadow="hover" class="estop-card">
          <div class="estop-wrapper">
            <button class="estop-btn" :class="{ active: eStop.active }" @click="triggerEStop">
              <span>急停</span>
            </button>
            <div class="estop-label">紧急停止</div>
          </div>
        </el-card>
      </el-col>

      <!-- 安全联锁 -->
      <el-col :span="10">
        <el-card shadow="hover">
          <template #header><span>安全联锁</span></template>
          <div class="interlock-list">
            <div v-for="il in interlocks" :key="il.id" class="interlock-item" :class="`il-${il.status}`">
              <div class="il-info">
                <div class="il-name">{{ il.name }}</div>
                <div class="il-desc">{{ il.description }}</div>
              </div>
              <div class="il-actions">
                <el-tag :type="il.status === 'triggered' ? 'danger' : il.status === 'bypassed' ? 'warning' : 'success'" size="small">
                  {{ il.status === 'triggered' ? '已触发' : il.status === 'bypassed' ? '已旁路' : '正常' }}
                </el-tag>
                <el-button v-if="il.status !== 'bypassed'" type="warning" link size="small" @click="bypassInterlock(il.id)">旁路</el-button>
                <el-button v-else type="success" link size="small" @click="restoreInterlock(il.id)">恢复</el-button>
              </div>
            </div>
            <el-empty v-if="interlocks.length === 0" description="暂无联锁规则" :image-size="40" />
          </div>
        </el-card>
      </el-col>

      <!-- 设备健康 -->
      <el-col :span="10">
        <el-card shadow="hover">
          <template #header><span>设备健康</span></template>
          <div class="health-list">
            <div v-for="h in deviceHealth" :key="h.device_id" class="health-item">
              <div class="h-info">
                <span class="h-name">{{ h.name || h.device_name || h.device_id }}</span>
                <span class="h-time">{{ h.response_time }}ms</span>
              </div>
              <el-tag :type="h.connected ? 'success' : 'danger'" size="small">{{ h.connected ? '在线' : '离线' }}</el-tag>
            </div>
            <el-empty v-if="deviceHealth.length === 0" description="暂无设备" :image-size="40" />
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 控制面板 -->
    <el-row :gutter="16" class="mb-16">
      <el-col :span="12">
        <el-card shadow="hover">
          <template #header><span>寄存器写入</span></template>
          <el-form :model="regForm" label-width="80px">
            <el-form-item label="设备">
              <el-select v-model="regForm.device_id" style="width:100%" @change="onDeviceChange">
                <el-option v-for="d in devices" :key="d.device_id" :label="`${d.name || d.device_name || d.device_id} (${d.device_id})`" :value="d.device_id" />
              </el-select>
            </el-form-item>
            <el-form-item label="寄存器">
              <el-select v-model="regForm.register_name" style="width:100%">
                <el-option v-for="r in currentRegisters" :key="r.name" :label="`${r.description || r.name} (${r.name})`" :value="r.name" />
              </el-select>
            </el-form-item>
            <el-form-item label="写入值">
              <el-input-number v-model="regForm.value" style="width:100%" />
            </el-form-item>
            <el-form-item label="预设值">
              <el-select v-model="regForm.value" style="width:100%">
                <el-option label="温度设定 75°C" :value="75" />
                <el-option label="压力设定 1.0 MPa" :value="100" />
                <el-option label="启动设备" :value="1" />
                <el-option label="停止设备" :value="0" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="writeRegister" :disabled="!canControl">写入寄存器</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="hover">
          <template #header><span>线圈控制</span></template>
          <el-form :model="coilForm" label-width="80px">
            <el-form-item label="设备">
              <el-select v-model="coilForm.device_id" style="width:100%">
                <el-option v-for="d in devices" :key="d.device_id" :label="`${d.name || d.device_name || d.device_id} (${d.device_id})`" :value="d.device_id" />
              </el-select>
            </el-form-item>
            <el-form-item label="线圈">
              <el-select v-model="coilForm.register_name" style="width:100%">
                <el-option v-for="r in coilRegisters" :key="r.name" :label="`${r.description || r.name} (${r.name})`" :value="r.name" />
              </el-select>
            </el-form-item>
            <el-form-item label="状态">
              <el-radio-group v-model="coilForm.value">
                <el-radio :value="true">ON</el-radio>
                <el-radio :value="false">OFF</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="预设">
              <el-select v-model="coilForm.value" style="width:100%">
                <el-option label="启动设备" :value="true" />
                <el-option label="停止设备" :value="false" />
                <el-option label="打开阀门" :value="true" />
                <el-option label="关闭阀门" :value="false" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="writeCoil" :disabled="!canControl">写入线圈</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>

    <!-- 批量控制 + 操作日志 -->
    <el-row :gutter="16">
      <el-col :span="8">
        <el-card shadow="hover">
          <template #header><span>批量控制</span></template>
          <div class="batch-btns">
            <el-button type="success" size="large" @click="batchControl('start')" :disabled="!canControl">
              <el-icon><CaretRight /></el-icon> 启动全部
            </el-button>
            <el-button type="danger" size="large" @click="batchControl('stop')" :disabled="!canControl">
              <el-icon><SwitchButton /></el-icon> 停止全部
            </el-button>
            <el-button type="warning" size="large" @click="batchControl('reset')" :disabled="!canControl">
              <el-icon><RefreshRight /></el-icon> 重置全部
            </el-button>
          </div>
        </el-card>
      </el-col>
      <el-col :span="16">
        <el-card shadow="hover">
          <template #header><span>操作日志</span></template>
          <el-table :data="controlLogs" size="small" max-height="250">
            <el-table-column prop="timestamp" label="时间" width="180">
              <template #default="{ row }">{{ new Date(row.timestamp).toLocaleString() }}</template>
            </el-table-column>
            <el-table-column prop="operator" label="操作员" width="100" />
            <el-table-column prop="action_type" label="操作类型" width="120" />
            <el-table-column prop="details" label="详情" show-overflow-tooltip />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, reactive, computed, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { devicesApi, controlApi, type Device, type Register } from '@/api'
import { useAuthStore } from '@/stores/auth'
import { showActionError } from '@/utils/error'

const authStore = useAuthStore()

const devices = ref<Device[]>([])
const currentRegisters = ref<Register[]>([])
const coilRegisters = ref<Register[]>([])
const interlocks = ref<any[]>([])
const deviceHealth = ref<any[]>([])
const controlLogs = ref<any[]>([])

const eStop = reactive({ active: false, reason: '', time: '' })
const controlLoading = ref(false)

const regForm = reactive({ device_id: '', register_name: '', value: 0 })
const coilForm = reactive({ device_id: '', register_name: '', value: true })

// 监听线圈表单设备变化，自动加载寄存器（独立于寄存器表单）
watch(() => coilForm.device_id, async (deviceId) => {
  // 换设备必须清空已选线圈，否则会拿旧设备的线圈名去查新设备地址
  coilForm.register_name = ''
  if (deviceId) {
    try {
      const data = await devicesApi.getById(deviceId)
      coilRegisters.value = data.device?.registers || []
    } catch (e: any) { console.warn('[Control] 加载失败:', e?.message || e) }
  } else {
    coilRegisters.value = []
  }
})

const canControl = computed(() => authStore.isAdmin || authStore.isEngineer)

let statusTimer: ReturnType<typeof setInterval>

onMounted(async () => {
  await loadDevices()
  loadSafetyStatus()
  loadLogs()
  statusTimer = setInterval(loadSafetyStatus, 10000)
})

onUnmounted(() => {
  clearInterval(statusTimer)
})

async function loadDevices() {
  try {
    const data = await devicesApi.getAll()
    devices.value = data.devices || []
  } catch (e: any) { console.warn('[Control] 加载失败:', e?.message || e) }
}

async function onDeviceChange(deviceId: string) {
  // 换设备必须清空已选寄存器，避免用旧寄存器名匹配不到新设备地址
  regForm.register_name = ''
  try {
    const data = await devicesApi.getById(deviceId)
    currentRegisters.value = data.device?.registers || []
  } catch (e: any) { console.warn('[Control] 加载失败:', e?.message || e) }
}

async function loadSafetyStatus() {
  try {
    const data = await controlApi.getStatus()
    if (!data) return
    if (data.estop) {
      eStop.active = !!data.estop.active
      eStop.reason = data.estop.reason || ''
      eStop.time = data.estop.time || ''
    }
    // 后端 /control/status 返回 interlocks.rules 字典：{rule_id: {name, description, triggered, bypassed}}
    const rawInterlocks = (data.interlocks as any)?.rules ?? data.interlocks
    interlocks.value = rawInterlocks && typeof rawInterlocks === 'object' && !Array.isArray(rawInterlocks)
      ? Object.entries(rawInterlocks as Record<string, any>).map(([id, r]) => ({
          id,
          name: r?.name || id,
          description: r?.description || r?.condition || '',
          status: r?.triggered ? 'triggered' : r?.bypassed ? 'bypassed' : 'normal',
        }))
      : Array.isArray(rawInterlocks) ? rawInterlocks : []
    // 后端字段为 device_health.devices：{device_id: {status:'connected'|'disconnected', avg_response_ms, name}}
    const rawHealth = (data.device_health as any)?.devices ?? data.health
    const healthList = rawHealth && typeof rawHealth === 'object' && !Array.isArray(rawHealth)
      ? Object.entries(rawHealth as Record<string, any>).map(([id, h]) => ({ device_id: id, ...(h || {}) }))
      : Array.isArray(rawHealth) ? rawHealth : []
    deviceHealth.value = healthList.map((h: any) => ({
      device_id: h.device_id,
      name: h.name || h.device_id,
      connected: h.connected ?? h.status === 'connected',
      response_time: h.avg_response_ms ?? h.response_time ?? 0,
    }))
  } catch (e: any) { console.warn('[Control] 加载失败:', e?.message || e) }
}

async function loadLogs() {
  try {
    const data = await controlApi.getLogs({ per_page: 20 })
    controlLogs.value = Array.isArray(data?.logs) ? data.logs : []
  } catch (e: any) { console.warn('[Control] 加载失败:', e?.message || e) }
}

// 根据寄存器名查找地址
function findRegisterAddress(deviceId: string, registerName: string): number | undefined {
  const dev = devices.value.find((d: any) => d.device_id === deviceId)
  const reg = (dev?.registers || []).find((r: any) => r.name === registerName)
  return reg?.address ?? undefined
}

async function writeRegister() {
  if (controlLoading.value) return
  if (!regForm.device_id || !regForm.register_name) { ElMessage.warning('请选择设备和寄存器'); return }
  const address = findRegisterAddress(regForm.device_id, regForm.register_name)
  if (address === undefined) { ElMessage.error('无法找到寄存器地址'); return }
  // 先占锁再弹确认框：否则确认框未关闭时连点会发起多次写入
  controlLoading.value = true
  try {
    await ElMessageBox.confirm(`确认写入 ${regForm.register_name} (地址${address}) = ${regForm.value}？`, '确认操作', { type: 'warning' })
    await controlApi.writeRegister(regForm.device_id, address, regForm.value)
    ElMessage.success('写入成功')
    loadLogs()
  } catch (e: any) { if (e !== 'cancel') showActionError('写入寄存器', e) }
  finally { controlLoading.value = false }
}

async function writeCoil() {
  if (controlLoading.value) return
  if (!coilForm.device_id || !coilForm.register_name) { ElMessage.warning('请选择设备和线圈'); return }
  const address = findRegisterAddress(coilForm.device_id, coilForm.register_name)
  if (address === undefined) { ElMessage.error('无法找到线圈地址'); return }
  controlLoading.value = true
  try {
    await ElMessageBox.confirm(`确认写入 ${coilForm.register_name} (地址${address}) = ${coilForm.value ? 'ON' : 'OFF'}？`, '确认操作', { type: 'warning' })
    await controlApi.writeCoil(coilForm.device_id, address, coilForm.value)
    ElMessage.success('写入成功')
    loadLogs()
  } catch (e: any) { if (e !== 'cancel') showActionError('写入线圈', e) }
  finally { controlLoading.value = false }
}

async function triggerEStop() {
  if (controlLoading.value) return
  controlLoading.value = true
  try {
    await ElMessageBox.confirm('确定执行紧急停止？此操作将停止所有设备！', '紧急停止', { type: 'error', confirmButtonText: '执行急停' })
    await controlApi.eStop()
    ElMessage.success('急停已执行')
    loadSafetyStatus()
  } catch (e: any) { if (e !== 'cancel') showActionError('紧急停止', e) }
  finally { controlLoading.value = false }
}

async function resetEStop() {
  if (controlLoading.value) return
  controlLoading.value = true
  try {
    await ElMessageBox.confirm('确定复位急停？确认现场人员已安全后再操作！', '复位急停', { type: 'warning', confirmButtonText: '确认复位' })
    await controlApi.eStopReset()
    ElMessage.success('急停已重置')
    loadSafetyStatus()
  } catch (e: any) { if (e !== 'cancel') showActionError('复位急停', e) }
  finally { controlLoading.value = false }
}

// 联锁操作按 id 防重入，避免连点对同一联锁重复旁路/恢复
const pendingInterlocks = new Set<string>()

async function bypassInterlock(id: string) {
  if (pendingInterlocks.has(id)) return
  pendingInterlocks.add(id)
  try {
    const res: any = await controlApi.bypassInterlock(id)
    // 后端失败时返回 200 + {success:false}，必须显式判断，否则会假成功
    if (res?.success === false) ElMessage.error(res?.message || '联锁旁路失败')
    else ElMessage.success('联锁已旁路')
  } catch (e: any) { showActionError('旁路联锁', e) }
  finally { pendingInterlocks.delete(id); loadSafetyStatus() }
}

async function restoreInterlock(id: string) {
  if (pendingInterlocks.has(id)) return
  pendingInterlocks.add(id)
  try {
    const res: any = await controlApi.restoreInterlock(id)
    if (res?.success === false) ElMessage.error(res?.message || '联锁恢复失败')
    else ElMessage.success('联锁已恢复')
  } catch (e: any) { showActionError('恢复联锁', e) }
  finally { pendingInterlocks.delete(id); loadSafetyStatus() }
}

async function batchControl(action: string) {
  if (controlLoading.value) return
  controlLoading.value = true
  try {
    await ElMessageBox.confirm(`确定执行「${action === 'start' ? '启动全部' : action === 'stop' ? '停止全部' : '重置全部'}」？`, '批量控制', { type: 'warning' })
    await controlApi.batchControl(action)
    ElMessage.success('指令已发送')
    loadLogs()
  } catch (e: any) { if (e !== 'cancel') showActionError('批量控制', e) }
  finally { controlLoading.value = false }
}
</script>

<style scoped>
.mb-16 { margin-bottom: 16px; }
.estop-banner { display: flex; align-items: center; justify-content: space-between; }
.estop-card { display: flex; align-items: center; justify-content: center; min-height: 280px; }
.estop-wrapper { text-align: center; }
.estop-btn { width: 120px; height: 120px; border-radius: 50%; background: #f56c6c; border: 4px solid #c45656; color: #fff; font-size: 20px; font-weight: bold; cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 12px rgba(245,108,108,0.4); }
.estop-btn:hover { background: #e64c4c; transform: scale(1.05); }
.estop-btn.active { animation: pulse 1.5s infinite; background: #c45656; }
@keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(245,108,108,0.7); } 50% { box-shadow: 0 0 0 15px rgba(245,108,108,0); } }
.estop-label { margin-top: 8px; font-size: 14px; color: #909399; }

.interlock-list, .health-list { max-height: 220px; overflow-y: auto; }
.interlock-item { display: flex; align-items: center; justify-content: space-between; padding: 8px; border-bottom: 1px solid #f0f0f0; }
.il-name { font-weight: 500; font-size: 13px; }
.il-desc { font-size: 12px; color: #909399; }
.il-actions { display: flex; align-items: center; gap: 8px; }
.health-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid #f0f0f0; }
.h-info { display: flex; align-items: center; gap: 8px; }
.h-name { font-size: 13px; }
.h-time { font-size: 12px; color: #909399; }

.batch-btns { display: flex; flex-direction: column; gap: 12px; }
.batch-btns .el-button { width: 100%; }
</style>
