<template>
  <div class="control-page">
    <!-- 急停激活横幅（最高优先级告警） -->
    <div v-if="eStop.active" class="panel estop-banner" role="alert">
      <div class="estop-banner__info">
        <span class="estop-banner__title">紧急停止已激活</span>
        <span class="estop-banner__meta">
          {{ eStop.reason || '未提供原因' }}{{ eStop.time ? ' · ' + eStop.time : '' }}
        </span>
      </div>
      <el-button class="btn-estop-reset" @click="resetEStop">重置急停</el-button>
    </div>

    <!-- 权限提示 -->
    <div v-if="!canControl" class="panel notice notice--warning">
      <span class="notice__mark" aria-hidden="true">!</span>
      <span>当前角色无控制权限，仅管理员和工程师可执行控制操作</span>
    </div>

    <!-- 安全区：急停 / 联锁 / 设备健康 -->
    <div class="safety-grid">
      <!-- 急停：权重最高 -->
      <section class="panel panel--danger estop-panel">
        <div class="panel__header panel__header--danger">
          <span>紧急停止</span>
          <span class="panel__meta panel__meta--danger">EMERGENCY STOP</span>
        </div>
        <div class="panel__body estop-body">
          <button
            type="button"
            class="estop-btn"
            :class="{ 'estop-btn--active': eStop.active }"
            @click="triggerEStop"
          >
            <span class="estop-btn__label">{{ eStop.active ? '已激活' : '急停' }}</span>
            <span class="estop-btn__sub">STOP</span>
          </button>
          <p class="estop-hint">
            按下后立即停止所有设备输出。复位前必须确认现场人员与设备安全。
          </p>
        </div>
      </section>

      <!-- 安全联锁 -->
      <section class="panel">
        <div class="panel__header">
          <span>安全联锁</span>
          <span class="panel__meta">旁路属危险操作</span>
        </div>
        <div class="panel__body interlock-list">
          <div
            v-for="il in interlocks"
            :key="il.id"
            class="interlock-item"
            :class="`interlock-item--${il.status}`"
          >
            <span class="interlock-item__bar" aria-hidden="true"></span>
            <div class="il-info">
              <div class="il-name">{{ il.name }}</div>
              <div class="il-desc">{{ il.description || '无描述' }}</div>
            </div>
            <div class="il-actions">
              <span class="tag" :class="interlockTag(il.status)">{{ interlockLabel(il.status) }}</span>
              <el-button
                v-if="il.status !== 'bypassed'"
                class="btn-bypass"
                size="small"
                @click="bypassInterlock(il.id)"
              >旁路</el-button>
              <el-button v-else type="success" size="small" plain @click="restoreInterlock(il.id)">恢复</el-button>
            </div>
          </div>
          <el-empty v-if="interlocks.length === 0" description="暂无联锁规则" :image-size="70" />
        </div>
      </section>

      <!-- 设备健康 -->
      <section class="panel">
        <div class="panel__header">
          <span>设备健康</span>
          <span class="panel__meta">平均响应</span>
        </div>
        <div class="panel__body health-list">
          <div v-for="h in deviceHealth" :key="h.device_id" class="health-item">
            <div class="h-info">
              <span class="status-dot" :class="h.connected ? 'status-dot--success' : 'status-dot--danger'"></span>
              <span class="h-name">{{ h.name || h.device_name || h.device_id }}</span>
            </div>
            <div class="h-meta">
              <span class="mono h-time">{{ h.response_time }}<span class="h-unit">ms</span></span>
              <span class="tag" :class="h.connected ? 'tag--success' : 'tag--danger'">{{ h.connected ? '在线' : '离线' }}</span>
            </div>
          </div>
          <el-empty v-if="deviceHealth.length === 0" description="暂无设备" :image-size="70" />
        </div>
      </section>
    </div>

    <!-- 写入区 -->
    <div class="write-grid">
      <!-- 寄存器写入 -->
      <section class="panel">
        <div class="panel__header">
          <span>寄存器写入</span>
          <span class="panel__meta">写入前请核对目标值</span>
        </div>
        <div class="panel__body">
          <el-form :model="regForm" label-width="80px" class="control-form">
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

            <!-- 当前值 / 目标值 / 单位 -->
            <div class="value-grid">
              <div class="value-cell">
                <div class="metric-label">当前值</div>
                <div class="value-cell__num mono">{{ regCurrentText }}</div>
              </div>
              <div class="value-cell value-cell--target">
                <div class="metric-label">目标值</div>
                <div class="value-cell__num mono">{{ regForm.value }}</div>
              </div>
              <div class="value-cell">
                <div class="metric-label">单位</div>
                <div class="value-cell__num value-cell__num--unit">{{ regUnit }}</div>
              </div>
            </div>

            <el-form-item label="写入值">
              <el-input-number v-model="regForm.value" style="width:100%" />
            </el-form-item>
            <div v-if="regRange" class="range-hint">量程 {{ regRange }}</div>
            <el-form-item label="预设值">
              <el-select v-model="regForm.value" style="width:100%">
                <el-option label="温度设定 75°C" :value="75" />
                <el-option label="压力设定 1.0 MPa" :value="100" />
                <el-option label="启动设备" :value="1" />
                <el-option label="停止设备" :value="0" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="controlLoading" @click="writeRegister" :disabled="!canControl">写入寄存器</el-button>
            </el-form-item>
          </el-form>
        </div>
      </section>

      <!-- 线圈控制 -->
      <section class="panel">
        <div class="panel__header">
          <span>线圈控制</span>
          <span class="panel__meta">启停类操作需二次确认</span>
        </div>
        <div class="panel__body">
          <el-form :model="coilForm" label-width="80px" class="control-form">
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

            <!-- 当前值 / 目标值 / 单位 -->
            <div class="value-grid">
              <div class="value-cell">
                <div class="metric-label">当前值</div>
                <div class="value-cell__num mono">{{ coilCurrentText }}</div>
              </div>
              <div class="value-cell value-cell--target">
                <div class="metric-label">目标值</div>
                <div class="value-cell__num mono" :class="coilForm.value ? 'is-on' : 'is-off'">
                  {{ coilForm.value ? 'ON' : 'OFF' }}
                </div>
              </div>
              <div class="value-cell">
                <div class="metric-label">单位</div>
                <div class="value-cell__num value-cell__num--unit">{{ coilUnit }}</div>
              </div>
            </div>

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
              <el-button type="primary" :loading="controlLoading" @click="writeCoil" :disabled="!canControl">写入线圈</el-button>
            </el-form-item>
          </el-form>
        </div>
      </section>
    </div>

    <!-- 批量控制 + 操作日志 -->
    <div class="bottom-grid">
      <section class="panel">
        <div class="panel__header"><span>批量控制</span></div>
        <div class="panel__body batch-btns">
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
      </section>

      <section class="panel">
        <div class="panel__header">
          <span>操作日志</span>
          <span class="panel__meta">最近 {{ controlLogs.length }} 条</span>
        </div>
        <div class="panel__body panel__body--flush">
          <el-table :data="controlLogs" max-height="280" class="log-table">
            <el-table-column prop="timestamp" label="时间" width="190">
              <template v-slot:default="{ row }"><span class="mono">{{ new Date(row.timestamp).toLocaleString() }}</span></template>
            </el-table-column>
            <el-table-column prop="operator" label="操作员" width="120" />
            <el-table-column prop="action_type" label="操作类型" width="140" />
            <el-table-column prop="details" label="详情" show-overflow-tooltip />
            <template v-slot:empty>
              <el-empty description="暂无操作记录" :image-size="70" />
            </template>
          </el-table>
        </div>
      </section>
    </div>
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

// ===== 联锁状态字典：后端 status 只有 driven/bypassed/normal 三态 =====
const INTERLOCK_STATUS: Record<string, { label: string; tag: string }> = {
  triggered: { label: '已触发', tag: 'tag--danger' },
  bypassed: { label: '已旁路', tag: 'tag--warning' },
  normal: { label: '正常', tag: 'tag--success' },
}

function interlockLabel(status: string) {
  return INTERLOCK_STATUS[status]?.label || status || '未知'
}

function interlockTag(status: string) {
  return INTERLOCK_STATUS[status]?.tag || 'tag--offline'
}

// ===== 写入区数值呈现（后端若提供 value / unit / min / max 才展示，否则显示占位符） =====
const DASH = '—'

const regSelected = computed(() => currentRegisters.value.find(r => r.name === regForm.register_name) || null)
const coilSelected = computed(() => coilRegisters.value.find(r => r.name === coilForm.register_name) || null)

function pickCurrentValue(reg: Register | null): string {
  const r = reg as any
  const v = r?.value ?? r?.current_value ?? r?.last_value
  return v === undefined || v === null || v === '' ? DASH : String(v)
}

const regCurrentText = computed(() => pickCurrentValue(regSelected.value))
const coilCurrentText = computed(() => pickCurrentValue(coilSelected.value))
const regUnit = computed(() => (regSelected.value as any)?.unit || DASH)
const coilUnit = computed(() => (coilSelected.value as any)?.unit || DASH)

const regRange = computed(() => {
  const r = regSelected.value as any
  if (!r) return ''
  const min = r.min ?? r.min_value
  const max = r.max ?? r.max_value
  if (min == null && max == null) return ''
  if (min != null && max != null) return `${min} ~ ${max}${r.unit ? ' ' + r.unit : ''}`
  if (min != null) return `≥ ${min}${r.unit ? ' ' + r.unit : ''}`
  return `≤ ${max}${r.unit ? ' ' + r.unit : ''}`
})

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
    await ElMessageBox.confirm(
      `确认写入 ${regForm.register_name} (地址${address}) = ${regForm.value}${regUnit.value !== DASH ? ' ' + regUnit.value : ''}？`,
      '确认写入',
      { type: 'warning', confirmButtonText: '确认写入', cancelButtonText: '取消', customClass: 'write-confirm' }
    )
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
    await ElMessageBox.confirm(
      `确认写入 ${coilForm.register_name} (地址${address}) = ${coilForm.value ? 'ON' : 'OFF'}？`,
      '确认写入',
      { type: 'warning', confirmButtonText: '确认写入', cancelButtonText: '取消', customClass: 'write-confirm' }
    )
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
    await ElMessageBox.confirm(
      '确定执行紧急停止？此操作将停止所有设备！',
      '紧急停止',
      {
        type: 'error',
        confirmButtonText: '执行急停',
        cancelButtonText: '取消',
        customClass: 'estop-confirm',
      }
    )
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
    await ElMessageBox.confirm('确定复位急停？确认现场人员已安全后再操作！', '复位急停', {
      type: 'warning', confirmButtonText: '确认复位', cancelButtonText: '取消', customClass: 'estop-confirm',
    })
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
    await ElMessageBox.confirm(
      `确定执行「${action === 'start' ? '启动全部' : action === 'stop' ? '停止全部' : '重置全部'}」？`,
      '批量控制',
      { type: 'warning', confirmButtonText: '确认执行', cancelButtonText: '取消', customClass: action === 'stop' ? 'estop-confirm' : 'write-confirm' }
    )
    await controlApi.batchControl(action)
    ElMessage.success('指令已发送')
    loadLogs()
  } catch (e: any) { if (e !== 'cancel') showActionError('批量控制', e) }
  finally { controlLoading.value = false }
}
</script>

<style scoped>
.control-page {
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
}

.panel__meta--danger { color: var(--color-danger); }

.panel__body--flush { padding: 0; }

/* 危险着色面板：仅用于急停 */
.panel--danger { border-color: var(--color-danger); }

.panel__header--danger {
  border-bottom-color: var(--color-danger);
  background: var(--color-danger-soft);
  color: var(--color-danger);
}

/* ===== 急停横幅 ===== */
.estop-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--color-danger-soft);
  border-color: var(--color-danger);
  border-left-width: 6px;
  flex-wrap: wrap;
}

.estop-banner__info {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.estop-banner__title {
  font-size: var(--font-lg);
  font-weight: var(--weight-semibold);
  color: var(--color-danger);
}

.estop-banner__meta {
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.btn-estop-reset {
  border-color: var(--color-danger);
  color: var(--color-danger);
  background: var(--bg-surface);
}

.btn-estop-reset:hover {
  background: var(--color-danger);
  border-color: var(--color-danger);
  color: var(--text-inverse);
}

/* ===== 提示条 ===== */
.notice {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  font-size: var(--font-sm);
}

.notice--warning {
  background: var(--color-warning-soft);
  border-color: var(--color-warning);
  color: var(--color-warning);
}

.notice__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: var(--radius-pill);
  background: var(--color-warning);
  color: var(--text-inverse);
  font-weight: var(--weight-semibold);
  font-size: var(--font-xs);
  flex: none;
}

/* ===== 布局栅格 ===== */
.safety-grid {
  display: grid;
  grid-template-columns: minmax(260px, 1fr) 1.4fr 1.2fr;
  gap: var(--space-4);
  align-items: stretch;
}

.write-grid,
.bottom-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(320px, 1fr));
  gap: var(--space-4);
}

.bottom-grid { grid-template-columns: minmax(240px, 320px) 1fr; }

@media (max-width: 1100px) {
  .safety-grid,
  .write-grid,
  .bottom-grid { grid-template-columns: 1fr; }
}

/* ===== 急停按钮：全页最高视觉权重 ===== */
.estop-panel { display: flex; flex-direction: column; }

.estop-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-6) var(--space-4);
}

.estop-btn {
  width: 148px;
  height: 148px;
  border-radius: var(--radius-pill);
  background: var(--color-danger);
  border: 5px solid var(--color-danger-soft);
  color: var(--text-inverse);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  font-family: inherit;
  box-shadow: var(--shadow-md);
  transition: transform var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.estop-btn:hover { transform: scale(1.03); border-color: var(--color-danger); }
.estop-btn:active { transform: scale(0.98); }

.estop-btn__label {
  font-size: 30px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.08em;
}

.estop-btn__sub {
  font-size: var(--font-xs);
  letter-spacing: 0.24em;
  opacity: 0.85;
}

/* 已激活：反色表达"已按下"状态，不加发光/动画 */
.estop-btn--active {
  background: var(--bg-surface);
  color: var(--color-danger);
  border-color: var(--color-danger);
}

.estop-hint {
  margin: 0;
  font-size: var(--font-xs);
  line-height: var(--leading-base);
  color: var(--text-muted);
  text-align: center;
  max-width: 240px;
}

/* ===== 联锁 ===== */
.interlock-list { max-height: 300px; overflow-y: auto; }

.interlock-item {
  display: grid;
  grid-template-columns: 4px 1fr auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-base);
}

.interlock-item:last-of-type { border-bottom: none; }

.interlock-item__bar {
  width: 4px;
  height: 28px;
  border-radius: var(--radius-pill);
  background: var(--color-success);
}

.interlock-item--triggered .interlock-item__bar { background: var(--color-danger); }
.interlock-item--bypassed .interlock-item__bar { background: var(--color-warning); }
.interlock-item--normal .interlock-item__bar { background: var(--color-success); }

.il-name {
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
  color: var(--text-primary);
}

.il-desc {
  font-size: var(--font-xs);
  color: var(--text-muted);
  margin-top: 2px;
}

.il-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* 旁路：危险操作，用危险色描边按钮，与常规操作区分 */
.btn-bypass {
  border-color: var(--color-danger);
  color: var(--color-danger);
  background: var(--bg-surface);
}

.btn-bypass:hover {
  background: var(--color-danger);
  border-color: var(--color-danger);
  color: var(--text-inverse);
}

/* ===== 设备健康 ===== */
.health-list { max-height: 300px; overflow-y: auto; }

.health-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--border-base);
}

.health-item:last-of-type { border-bottom: none; }

.h-info {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.h-name {
  font-size: var(--font-sm);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.h-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: none;
}

.h-time {
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.h-unit {
  font-size: var(--font-xs);
  color: var(--text-muted);
  margin-left: 2px;
}

/* ===== 写入区数值对齐 ===== */
.control-form :deep(.el-form-item__label) {
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.control-form :deep(.el-form-item) { margin-bottom: var(--space-4); }

.value-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-3);
  align-items: end;
  padding: var(--space-3);
  margin-bottom: var(--space-4);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-sunken);
}

.value-cell {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.value-cell__num {
  font-size: var(--font-xl);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  line-height: var(--leading-tight);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.value-cell--target .value-cell__num { color: var(--color-brand); }
.value-cell__num--unit { font-family: var(--font-sans); font-size: var(--font-lg); color: var(--text-secondary); }
.value-cell__num.is-on { color: var(--color-success); }
.value-cell__num.is-off { color: var(--text-muted); }

.range-hint {
  margin: calc(-1 * var(--space-3)) 0 var(--space-4);
  font-size: var(--font-xs);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

/* ===== 批量控制 / 日志 ===== */
.batch-btns {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.batch-btns .el-button { width: 100%; }

.log-table :deep(.el-table__header th.el-table__cell) {
  background: var(--bg-sunken);
  color: var(--text-secondary);
  font-size: var(--font-sm);
  font-weight: var(--weight-semibold);
}

.log-table :deep(.el-table__body td.el-table__cell) {
  font-size: var(--font-sm);
  color: var(--text-primary);
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--font-sm);
  color: var(--text-secondary);
}
</style>

<!-- 急停/写入二次确认样式：MessageBox 挂载在 body 下，scoped 无法命中，故单独声明并限定类名 -->
<style>
.write-confirm .el-message-box__title,
.estop-confirm .el-message-box__title {
  font-size: var(--font-lg);
  font-weight: var(--weight-semibold);
}

.estop-confirm .el-message-box__title { color: var(--color-danger); }

.write-confirm .el-message-box__content,
.estop-confirm .el-message-box__content {
  font-size: var(--font-base);
  color: var(--text-primary);
}

.estop-confirm .el-message-box__btns .el-button--primary {
  background: var(--color-danger);
  border-color: var(--color-danger);
  color: var(--text-inverse);
  font-weight: var(--weight-semibold);
}
</style>
