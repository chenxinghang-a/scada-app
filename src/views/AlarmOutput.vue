<template>
  <div class="alarm-output-page">
    <!-- 信号灯塔可视化 -->
    <el-row :gutter="16" class="mb-16">
      <el-col :span="10">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <span>信号灯塔</span>
              <div>
                <el-tag :type="towerStatus.mode === 'simulation' ? 'warning' : 'success'" size="small">{{ towerStatus.mode === 'simulation' ? '模拟模式' : '硬件模式' }}</el-tag>
              </div>
            </div>
          </template>
          <div class="tower-visual">
            <div class="tower-body">
              <div class="tower-lamp red" :class="{ on: towerStatus.red, flash: towerStatus.red && towerStatus.flash }"></div>
              <div class="tower-lamp yellow" :class="{ on: towerStatus.yellow }"></div>
              <div class="tower-lamp green" :class="{ on: towerStatus.green }"></div>
            </div>
            <div class="tower-buzzer" :class="{ active: towerStatus.buzzer }">🔊</div>
          </div>
          <div class="tower-info">
            <div>当前等级: <el-tag :type="towerStatus.level === 'critical' ? 'danger' : towerStatus.level === 'warning' ? 'warning' : 'success'" size="small">{{ towerStatus.level || '正常' }}</el-tag></div>
            <div class="tower-msg">{{ towerStatus.message || '无报警' }}</div>
          </div>
          <div class="tower-actions">
            <el-button type="warning" @click="silenceAlarm">消音</el-button>
            <el-button type="info" @click="resetAlarm">复位</el-button>
          </div>
        </el-card>
      </el-col>

      <!-- 手动控制 -->
      <el-col :span="14">
        <el-card shadow="hover">
          <template #header><span>手动控制</span></template>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form label-width="60px">
                <el-form-item label="红灯"><el-switch v-model="manual.red" /></el-form-item>
                <el-form-item label="黄灯"><el-switch v-model="manual.yellow" /></el-form-item>
                <el-form-item label="绿灯"><el-switch v-model="manual.green" /></el-form-item>
                <el-form-item label="蜂鸣器"><el-switch v-model="manual.buzzer" /></el-form-item>
                <el-form-item label="持续(秒)"><el-input-number v-model="manual.duration" :min="0" :max="300" style="width:100%" /></el-form-item>
                <el-form-item>
                  <el-button type="primary" @click="sendManualControl">执行</el-button>
                  <el-button @click="allOff">全部关闭</el-button>
                </el-form-item>
              </el-form>
            </el-col>
            <el-col :span="12">
              <el-form label-width="60px">
                <el-form-item label="区域">
                  <el-select v-model="broadcast.area" style="width:100%">
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
                  <el-input v-model="broadcast.text" type="textarea" :rows="3" />
                </el-form-item>
                <el-form-item>
                  <el-button type="primary" @click="sendBroadcast">广播</el-button>
                </el-form-item>
              </el-form>
              <div class="preset-msgs">
                <el-button size="small" @click="broadcast.text = '注意！发生严重报警，请立即处置！'">严重报警</el-button>
                <el-button size="small" @click="broadcast.text = '提醒：出现告警，请关注。'">警告</el-button>
                <el-button size="small" @click="broadcast.text = '请注意，发生紧急状况，请沿疏散通道撤离！'">疏散</el-button>
                <el-button size="small" @click="broadcast.text = '广播通知，警报解除，恢复正常。'">解除</el-button>
              </div>
            </el-col>
          </el-row>
        </el-card>
      </el-col>
    </el-row>

    <!-- 广播历史 -->
    <el-card shadow="hover">
      <template #header><span>广播历史</span></template>
      <el-table :data="broadcastHistory" size="small" max-height="300">
        <el-table-column prop="timestamp" label="时间" width="180">
          <template #default="{ row }">{{ new Date(row.timestamp).toLocaleString() }}</template>
        </el-table-column>
        <el-table-column prop="level" label="等级" width="80">
          <template #default="{ row }">
            <el-tag :type="row.level === 'critical' ? 'danger' : row.level === 'warning' ? 'warning' : 'info'" size="small">{{ row.level }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="area" label="区域" width="100" />
        <el-table-column prop="text" label="内容" show-overflow-tooltip />
        <el-table-column prop="source" label="来源" width="100" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'
import { io } from 'socket.io-client'
import { alarmsApi } from '@/api'
import { getAuthToken } from '@/api/request'

const towerStatus = reactive({ red: false, yellow: false, green: false, buzzer: false, flash: false, level: '', message: '', mode: 'simulation' })
const manual = reactive({ red: false, yellow: false, green: false, buzzer: false, duration: 10 })
const broadcast = reactive({ area: 'all', level: 'warning', text: '' })
const broadcastAreas = ref<string[]>([])
const broadcastHistory = ref<any[]>([])
let socket: ReturnType<typeof io> | null = null

onMounted(async () => {
  loadStatus()
  loadAreas()
  loadHistory()
  connectSocket()
})

onUnmounted(() => { socket?.disconnect() })

async function loadStatus() {
  try {
    const data = await alarmsApi.getAlarmOutputStatus()
    if (!data) return
    Object.assign(towerStatus, data.tower || {})
    towerStatus.mode = data.mode || 'simulation'
  } catch (e: any) { console.warn('[AlarmOutput] 加载失败:', e?.message || e) }
}

async function loadAreas() {
  try { const data = await alarmsApi.getBroadcastAreas(); broadcastAreas.value = Array.isArray(data?.areas) ? data.areas : [] } catch (e: any) { console.warn('[AlarmOutput] 加载失败:', e?.message || e) }
}

async function loadHistory() {
  try { const data = await alarmsApi.getBroadcastHistory(30); broadcastHistory.value = Array.isArray(data?.history) ? data.history : [] } catch (e: any) { console.warn('[AlarmOutput] 加载失败:', e?.message || e) }
}

function connectSocket() {
  const baseUrl = import.meta.env.DEV ? window.location.origin : 'http://localhost:5000'
  const token = getAuthToken()
  const socketUrl = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl
  socket = io(socketUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 3000,
  })
  socket.on('alarm', () => loadStatus())
  socket.on('broadcast', (data: any) => { if (data) broadcastHistory.value.unshift(data) })
}

async function silenceAlarm() {
  try { await alarmsApi.alarmOutputAcknowledge(); ElMessage.success('已消音'); loadStatus() } catch (e: any) { console.error('[AlarmOutput] 操作失败:', e); ElMessage.error('操作失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}

async function resetAlarm() {
  try { await alarmsApi.alarmOutputReset(); ElMessage.success('已复位'); loadStatus() } catch (e: any) { console.error('[AlarmOutput] 操作失败:', e); ElMessage.error('操作失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}

async function sendManualControl() {
  try { await alarmsApi.alarmOutputManual(manual); ElMessage.success('指令已发送') } catch (e: any) { console.error('[AlarmOutput] 操作失败:', e); ElMessage.error('操作失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}

function allOff() { manual.red = false; manual.yellow = false; manual.green = false; manual.buzzer = false; sendManualControl() }

async function sendBroadcast() {
  if (!broadcast.text) { ElMessage.warning('请输入广播内容'); return }
  try { await alarmsApi.broadcastSpeak(broadcast); ElMessage.success('广播已发送'); broadcast.text = ''; loadHistory() } catch (e: any) { console.error('[AlarmOutput] 操作失败:', e); ElMessage.error('操作失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}
</script>

<style scoped>
.mb-16 { margin-bottom: 16px; }
.card-header { display: flex; align-items: center; justify-content: space-between; }
.tower-visual { display: flex; align-items: center; justify-content: center; gap: 20px; padding: 20px; }
.tower-body { display: flex; flex-direction: column; gap: 8px; }
.tower-lamp { width: 40px; height: 40px; border-radius: 50%; border: 2px solid #dcdfe6; opacity: 0.3; transition: all 0.3s; }
.tower-lamp.red.on { background: #f56c6c; opacity: 1; box-shadow: 0 0 10px #f56c6c; }
.tower-lamp.yellow.on { background: #e6a23c; opacity: 1; box-shadow: 0 0 10px #e6a23c; }
.tower-lamp.green.on { background: #67c23a; opacity: 1; box-shadow: 0 0 10px #67c23a; }
.tower-lamp.flash { animation: lamp-flash 0.5s infinite; }
@keyframes lamp-flash { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
.tower-buzzer { font-size: 32px; opacity: 0.3; }
.tower-buzzer.active { opacity: 1; animation: buzz 0.2s infinite; }
@keyframes buzz { 0%,100% { transform: rotate(-5deg); } 50% { transform: rotate(5deg); } }
.tower-info { text-align: center; padding: 8px 0; }
.tower-msg { font-size: 13px; color: #909399; margin-top: 4px; }
.tower-actions { display: flex; justify-content: center; gap: 12px; margin-top: 8px; }
.preset-msgs { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
</style>
