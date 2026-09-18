<template>
  <div class="alarm-output-page">
    <div class="top-grid">
      <!-- 信号灯塔示意 -->
      <div class="panel">
        <div class="panel__header">
          <span>信号灯塔</span>
          <div class="panel__tools">
            <span class="tag" :class="towerStatus.mode === 'simulation' ? 'tag--warning' : 'tag--success'">
              {{ towerStatus.mode === 'simulation' ? '模拟模式' : '硬件模式' }}
            </span>
            <span class="tag" :class="statusBusy ? 'tag--info' : 'tag--offline'">{{ statusSyncText }}</span>
          </div>
        </div>
        <div class="panel__body">
          <div class="tower-visual">
            <!-- 三灯灯位：亮/灭直接体现在灯体与右侧状态标签上，不做闪烁动画 -->
            <div class="tower-column">
              <div v-for="lamp in lamps" :key="lamp.key" class="lamp-row">
                <span class="lamp" :class="['lamp--' + lamp.key, { 'lamp--on': lamp.on }]"></span>
                <span class="lamp-label">{{ lamp.label }}</span>
                <span class="tag" :class="lampTagClass(lamp)">{{ lamp.on ? '亮' : '灭' }}</span>
              </div>
            </div>
            <dl class="tower-meta">
              <div class="tower-meta__row">
                <dt class="metric-label">蜂鸣器</dt>
                <dd><span class="tag" :class="towerStatus.buzzer ? 'tag--danger' : 'tag--offline'">{{ towerStatus.buzzer ? '响铃中' : '静音' }}</span></dd>
              </div>
              <div class="tower-meta__row">
                <dt class="metric-label">输出等级</dt>
                <dd><span class="tag" :class="levelTagClass(towerStatus.level)">{{ levelText(towerStatus.level) }}</span></dd>
              </div>
              <div class="tower-meta__row">
                <dt class="metric-label">闪烁模式</dt>
                <dd><span class="tag tag--info">{{ patternText }}</span></dd>
              </div>
              <div class="tower-meta__row">
                <dt class="metric-label">状态更新</dt>
                <dd class="mono">{{ lastUpdateText }}</dd>
              </div>
            </dl>
          </div>
          <p class="tower-msg">{{ towerStatus.message || '当前无报警输出' }}</p>
          <div class="tower-actions">
            <el-button type="warning" :loading="busy.silence" @click="silenceAlarm">消音</el-button>
            <el-button type="info" :loading="busy.reset" @click="resetAlarm">复位</el-button>
            <el-button :loading="statusBusy" @click="loadStatus">刷新状态</el-button>
          </div>
        </div>
      </div>

      <!-- 手动控制 -->
      <div class="panel">
        <div class="panel__header">
          <span>手动控制</span>
          <span class="panel__meta">{{ manualPreview }}</span>
        </div>
        <div class="panel__body">
          <el-form label-width="70px">
            <el-form-item label="红灯"><el-switch v-model="manual.red" /></el-form-item>
            <el-form-item label="黄灯"><el-switch v-model="manual.yellow" /></el-form-item>
            <el-form-item label="绿灯"><el-switch v-model="manual.green" /></el-form-item>
            <el-form-item label="蜂鸣器"><el-switch v-model="manual.buzzer" /></el-form-item>
            <el-form-item label="持续(秒)"><el-input-number v-model="manual.duration" :min="0" :max="300" style="width:100%" /></el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="busy.manual" @click="sendManualControl">执行</el-button>
              <el-button :disabled="busy.manual" @click="allOff">全部关闭</el-button>
            </el-form-item>
          </el-form>
          <p class="hint">手动指令按“持续秒数”覆盖当前报警输出；0 秒表示不自动恢复。</p>
        </div>
      </div>

      <!-- 广播 -->
      <div class="panel">
        <div class="panel__header">
          <span>广播喊话</span>
          <span class="tag" :class="levelTagClass(broadcast.level)">{{ levelText(broadcast.level) }}广播</span>
        </div>
        <div class="panel__body">
          <el-form label-width="70px">
            <el-form-item label="区域">
              <el-select v-model="broadcast.area" style="width:100%" :loading="areasLoading">
                <el-option label="全部区域" value="all" />
                <el-option v-for="a in broadcastAreas" :key="a" :label="a" :value="a" />
              </el-select>
            </el-form-item>
            <el-form-item label="等级">
              <el-select v-model="broadcast.level" style="width:100%">
                <el-option label="信息" value="info" />
                <el-option label="警告" value="warning" />
                <el-option label="严重" value="critical" />
              </el-select>
            </el-form-item>
            <el-form-item label="内容">
              <el-input v-model="broadcast.text" type="textarea" :rows="3" placeholder="输入广播内容，或选择下方话术模板" />
            </el-form-item>
          </el-form>
          <p v-if="!areasLoading && !broadcastAreas.length" class="hint">未获取到区域列表，将按“全部区域”广播。</p>

          <div class="preset-block">
            <div class="metric-label">话术模板</div>
            <div class="preset-msgs">
              <el-button v-for="p in presets" :key="p.label" size="small" @click="applyPreset(p)">{{ p.label }}</el-button>
            </div>
          </div>

          <p class="broadcast-preview">
            <span class="tag" :class="levelTagClass(broadcast.level)">{{ levelText(broadcast.level) }}</span>
            <span class="mono muted">{{ areaText }}</span>
            <span class="broadcast-preview__text">{{ broadcast.text || '（尚未填写内容）' }}</span>
          </p>

          <div class="broadcast-actions">
            <el-button type="primary" :loading="busy.broadcast" @click="sendBroadcast">广播</el-button>
            <el-button :disabled="busy.broadcast || !broadcast.text" @click="broadcast.text = ''">清空</el-button>
          </div>
        </div>
      </div>
    </div>

    <!-- 广播历史 -->
    <div class="panel">
      <div class="panel__header">
        <span>广播历史</span>
        <div class="panel__tools">
          <span class="panel__meta">最近 {{ broadcastHistory.length }} 条（最多保留 50 条）</span>
          <el-button size="small" :loading="historyLoading" @click="loadHistory">刷新</el-button>
        </div>
      </div>
      <div class="panel__body">
        <el-table :data="broadcastHistory" size="small" max-height="300" v-loading="historyLoading">
          <el-table-column prop="timestamp" label="时间" width="190" class-name="mono-cell">
            <template v-slot:default="{ row }">{{ fmtTime(row.timestamp) }}</template>
          </el-table-column>
          <el-table-column prop="level" label="等级" width="90">
            <template v-slot:default="{ row }">
              <span class="tag" :class="levelTagClass(row.level)">{{ levelText(row.level) }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="area" label="区域" width="110" />
          <el-table-column prop="text" label="内容" show-overflow-tooltip />
          <el-table-column prop="source" label="来源" width="110" />
          <template #empty>
            <el-empty description="暂无广播记录" :image-size="80" />
          </template>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { io } from 'socket.io-client'
import { alarmsApi } from '@/api'
import { showActionError } from '@/utils/error'
import { getAuthToken, getWsBaseUrl } from '@/api/request'

const towerStatus = reactive({
  red: false, yellow: false, green: false, buzzer: false,
  flash: false, pattern: '', level: '', message: '', mode: 'simulation',
})
const manual = reactive({ red: false, yellow: false, green: false, buzzer: false, duration: 10 })
const broadcast = reactive({ area: 'all', level: 'warning', text: '' })
const broadcastAreas = ref<string[]>([])
const broadcastHistory = ref<any[]>([])
const statusBusy = ref(false)
const areasLoading = ref(false)
const historyLoading = ref(false)
const lastUpdate = ref<Date | null>(null)
// 各操作的在途标记，避免重复点击并发提交
const busy = reactive({ silence: false, reset: false, manual: false, broadcast: false })
let socket: ReturnType<typeof io> | null = null
// 请求序号：状态/区域/历史并发刷新时丢弃过期响应
let statusSeq = 0
let areasSeq = 0
let historySeq = 0

const LEVEL_TEXT: Record<string, string> = { critical: '严重', warning: '警告', info: '信息', normal: '正常' }
const BCAST_HISTORY_MAX = 50

const presets = [
  { label: '严重报警', level: 'critical', text: '注意！发生严重报警，请立即处置！' },
  { label: '警告', level: 'warning', text: '提醒：出现告警，请关注。' },
  { label: '疏散', level: 'critical', text: '请注意，发生紧急状况，请沿疏散通道撤离！' },
  { label: '解除', level: 'info', text: '广播通知，警报解除，恢复正常。' },
]

onMounted(async () => {
  loadStatus()
  loadAreas()
  loadHistory()
  connectSocket()
})

onUnmounted(() => { socket?.disconnect() })

// ========== 展示辅助 ==========
function levelKey(level: string): string { return LEVEL_TEXT[level] ? level : 'normal' }
function levelText(level: string): string { return LEVEL_TEXT[level] || '正常' }
function levelTagClass(level: string): string {
  const k = levelKey(level)
  if (k === 'critical') return 'tag--danger'
  if (k === 'warning') return 'tag--warning'
  if (k === 'info') return 'tag--info'
  return 'tag--success'
}
function fmtTime(t: string): string {
  if (!t) return '-'
  const d = new Date(t)
  return isNaN(d.getTime()) ? '-' : d.toLocaleString()
}

// 灯位顺序与颜色语义（红=严重 / 黄=警告 / 绿=正常），直接来自后端 state
const lamps = computed(() => [
  { key: 'red', label: '红', on: towerStatus.red },
  { key: 'yellow', label: '黄', on: towerStatus.yellow },
  { key: 'green', label: '绿', on: towerStatus.green },
])
function lampTagClass(lamp: { key: string; on: boolean }): string {
  if (!lamp.on) return 'tag--offline'
  if (lamp.key === 'red') return 'tag--danger'
  if (lamp.key === 'yellow') return 'tag--warning'
  return 'tag--success'
}
// 闪烁模式以文字标签呈现（原闪烁动画会干扰值守人员长时间注视）
const patternText = computed(() => {
  if (towerStatus.pattern === 'fast') return '快闪（fast）'
  if (towerStatus.pattern === 'slow') return '慢闪（slow）'
  return '常亮'
})
const manualPreview = computed(() => {
  const on = [manual.red ? '红灯' : '', manual.yellow ? '黄灯' : '', manual.green ? '绿灯' : '', manual.buzzer ? '蜂鸣器' : ''].filter(Boolean)
  if (!on.length) return '将执行：全部关闭'
  return `将执行：${on.join(' + ')} · ${manual.duration} 秒`
})
const areaText = computed(() => broadcast.area === 'all' ? '全部区域' : broadcast.area)
const lastUpdateText = computed(() => lastUpdate.value ? lastUpdate.value.toLocaleTimeString('zh-CN', { hour12: false }) : '—')
const statusSyncText = computed(() => statusBusy.value ? '同步中…' : `已同步 ${lastUpdateText.value}`)

// ========== 数据加载 ==========
async function loadStatus() {
  const seq = ++statusSeq
  statusBusy.value = true
  try {
    // 后端 /api/alarm-output/status 返回 {alarm_output, broadcast}
    // 其中 alarm_output.get_status() = {enabled, simulation, state:{red,yellow,green,buzzer,pattern,level,message,...}, do_mapping}
    const data = await alarmsApi.getAlarmOutputStatus() as any
    if (seq !== statusSeq) return
    if (!data) return
    const ao = data.alarm_output || {}
    const state = ao.state || {}
    Object.assign(towerStatus, {
      red: !!state.red,
      yellow: !!state.yellow,
      green: !!state.green,
      buzzer: !!state.buzzer,
      // pattern 为 fast/slow 时视为闪烁
      flash: state.pattern === 'fast' || state.pattern === 'slow',
      pattern: state.pattern || '',
      level: state.level || '',
      message: state.message || '',
      mode: ao.simulation ? 'simulation' : 'hardware',
    })
    lastUpdate.value = new Date()
  } catch (e: any) { console.warn('[AlarmOutput] 加载失败:', e?.message || e) }
  finally { if (seq === statusSeq) statusBusy.value = false }
}

async function loadAreas() {
  const seq = ++areasSeq
  areasLoading.value = true
  try {
    const data = await alarmsApi.getBroadcastAreas()
    if (seq !== areasSeq) return
    broadcastAreas.value = Array.isArray(data?.areas) ? data.areas : []
  } catch (e: any) { console.warn('[AlarmOutput] 加载失败:', e?.message || e) }
  finally { if (seq === areasSeq) areasLoading.value = false }
}

async function loadHistory() {
  const seq = ++historySeq
  historyLoading.value = true
  try {
    const data = await alarmsApi.getBroadcastHistory(30)
    if (seq !== historySeq) return
    broadcastHistory.value = Array.isArray(data?.history) ? data.history : []
  } catch (e: any) { console.warn('[AlarmOutput] 加载失败:', e?.message || e) }
  finally { if (seq === historySeq) historyLoading.value = false }
}

function connectSocket() {
  const baseUrl = getWsBaseUrl()
  const token = getAuthToken()
  const socketUrl = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl
  socket = io(socketUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 3000,
  })
  // 重连后主动拉一次状态，避免灯塔画面停留在断线前的旧状态
  socket.on('connect', () => loadStatus())
  socket.on('alarm', () => loadStatus())
  socket.on('broadcast', (data: any) => {
    if (!data) return
    broadcastHistory.value.unshift(data)
    if (broadcastHistory.value.length > BCAST_HISTORY_MAX) broadcastHistory.value.pop()
  })
}

// ========== 操作 ==========
async function silenceAlarm() {
  if (busy.silence) return
  busy.silence = true
  try { await alarmsApi.alarmOutputAcknowledge(); ElMessage.success('已消音'); loadStatus() } catch (e: any) { showActionError('消音', e) } finally { busy.silence = false }
}

async function resetAlarm() {
  if (busy.reset) return
  busy.reset = true
  try { await alarmsApi.alarmOutputReset(); ElMessage.success('已复位'); loadStatus() } catch (e: any) { showActionError('复位', e) } finally { busy.reset = false }
}

async function sendManualControl(): Promise<boolean> {
  if (busy.manual) return false
  busy.manual = true
  try { await alarmsApi.alarmOutputManual(manual); ElMessage.success('指令已发送'); loadStatus(); return true } catch (e: any) { showActionError('手动控制', e); return false } finally { busy.manual = false }
}

async function allOff() {
  try {
    await ElMessageBox.confirm('确定关闭所有报警输出？', '确认操作', { confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning' })
  } catch { return }
  const prev = { red: manual.red, yellow: manual.yellow, green: manual.green, buzzer: manual.buzzer }
  manual.red = false; manual.yellow = false; manual.green = false; manual.buzzer = false
  // 指令失败时恢复开关，避免界面与现场输出状态不一致
  if (!await sendManualControl()) Object.assign(manual, prev)
}

function applyPreset(p: { label: string; level: string; text: string }) {
  broadcast.text = p.text
  broadcast.level = p.level
}

async function sendBroadcast() {
  if (!broadcast.text) { ElMessage.warning('请输入广播内容'); return }
  if (busy.broadcast) return
  busy.broadcast = true
  try {
    await alarmsApi.broadcastSpeak(broadcast)
    ElMessage.success(`广播已发送 · ${areaText.value}`)
    broadcast.text = ''
    loadHistory()
  } catch (e: any) { showActionError('发送广播', e) } finally { busy.broadcast = false }
}
</script>

<style scoped>
.alarm-output-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--bg-page);
  color: var(--text-primary);
}

.top-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-4);
}

.panel__tools {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.panel__meta {
  font-size: var(--font-xs);
  font-weight: var(--weight-normal);
  color: var(--text-muted);
  font-family: var(--font-mono);
}

/* ===== 灯塔示意 ===== */
.tower-visual {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  flex-wrap: wrap;
}

.tower-column {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-lg);
  background: var(--bg-sunken);
}

.lamp-row {
  display: grid;
  grid-template-columns: 34px 20px 44px;
  align-items: center;
  gap: var(--space-3);
}

/* 灯体：亮=语义色实心，灭=下沉底色；无渐变/发光 */
.lamp {
  width: 30px;
  height: 30px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-base);
  background: var(--bg-surface);
  transition: background var(--duration-base) var(--ease-out), border-color var(--duration-base) var(--ease-out);
}

.lamp--red.lamp--on { background: var(--color-danger); border-color: var(--color-danger); }
.lamp--yellow.lamp--on { background: var(--color-warning); border-color: var(--color-warning); }
.lamp--green.lamp--on { background: var(--color-success); border-color: var(--color-success); }

.lamp-label {
  font-size: var(--font-sm);
  color: var(--text-secondary);
  text-align: center;
}

.tower-meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  flex: 1 1 180px;
}

.tower-meta__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--border-subtle);
}

.tower-meta__row dt { margin: 0; }
.tower-meta__row dd { margin: 0; }

.tower-msg {
  margin: var(--space-3) 0 0;
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.tower-actions {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

/* ===== 广播 ===== */
.preset-block { margin-top: var(--space-2); }

.preset-msgs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.broadcast-preview {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  margin: var(--space-4) 0 var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--bg-sunken);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  font-size: var(--font-sm);
}

.broadcast-preview__text { color: var(--text-primary); }

.broadcast-actions { display: flex; gap: var(--space-2); }

.hint {
  margin: var(--space-2) 0 0;
  font-size: var(--font-xs);
  color: var(--text-muted);
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.muted { color: var(--text-muted); }

:deep(.mono-cell .cell) {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
