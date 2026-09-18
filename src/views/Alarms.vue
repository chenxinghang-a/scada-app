<template>
  <div class="alarms-page">
    <!-- 指标卡 -->
    <div class="stats-grid">
      <div class="panel stat-card">
        <div class="metric-label">活动报警</div>
        <div class="metric-value">{{ totalActive }}<span class="metric-unit">条</span></div>
        <div class="stat-foot">规则启用 {{ stats.enabled_rules || 0 }} / {{ stats.total_rules || 0 }}</div>
      </div>
      <div class="panel stat-card">
        <div class="metric-label">严重报警</div>
        <div class="metric-value stat-value--danger">{{ levelCount('critical') }}<span class="metric-unit">条</span></div>
        <div class="stat-foot">占活动报警 {{ levelPct('critical') }}%</div>
      </div>
      <div class="panel stat-card">
        <div class="metric-label">警告</div>
        <div class="metric-value stat-value--warning">{{ levelCount('warning') }}<span class="metric-unit">条</span></div>
        <div class="stat-foot">占活动报警 {{ levelPct('warning') }}%</div>
      </div>
      <div class="panel stat-card">
        <div class="metric-label">已确认</div>
        <div class="metric-value stat-value--success">{{ stats.dedup?.acknowledged_alarms || 0 }}<span class="metric-unit">条</span></div>
        <div class="stat-foot">去重跟踪 {{ stats.dedup?.tracked_alarms || 0 }} 条</div>
      </div>
    </div>

    <!-- 占比可视化 -->
    <div class="viz-grid">
      <div class="panel">
        <div class="panel__header">
          <span>等级占比</span>
          <span class="panel__meta">按 alarm_level 统计</span>
        </div>
        <div class="panel__body">
          <template v-if="totalActive">
            <div class="segment-bar" role="img" :aria-label="segmentAriaLabel">
              <span
                v-for="s in levelSegments"
                :key="s.key"
                class="segment"
                :class="'segment--' + s.key"
                :style="{ width: s.pct + '%' }"
                :title="`${s.label} ${s.value} 条`"
              ></span>
            </div>
            <ul class="legend-list">
              <li v-for="s in levelSegments" :key="s.key">
                <span class="dot" :class="'dot--' + s.key"></span>
                <span class="legend-list__label">{{ s.label }}</span>
                <span class="mono">{{ s.value }} 条</span>
                <span class="mono muted">{{ s.pct.toFixed(1) }}%</span>
              </li>
            </ul>
          </template>
          <el-empty v-else description="当前没有活动报警" :image-size="70" />
        </div>
      </div>

      <div class="panel">
        <div class="panel__header">
          <span>设备分布</span>
          <span class="panel__meta">按报警数降序</span>
        </div>
        <div class="panel__body">
          <ul v-if="deviceBars.length" class="bar-list">
            <li v-for="b in deviceBars" :key="b.id">
              <span class="bar-list__name" :title="b.name">{{ b.name }}</span>
              <span class="bar-track">
                <span class="bar-fill" :style="{ width: b.width + '%' }"></span>
              </span>
              <span class="mono bar-list__value">{{ b.value }} 条</span>
            </li>
          </ul>
          <p v-if="hiddenDeviceCount" class="panel__meta">另有 {{ hiddenDeviceCount }} 台设备存在报警，未在图中展开</p>
          <el-empty v-if="!deviceBars.length" description="暂无设备报警分布" :image-size="70" />
        </div>
      </div>
    </div>

    <!-- 筛选 + 列表 -->
    <div class="panel">
      <div class="panel__header">
        <span>报警记录</span>
        <div class="panel__tools">
          <el-select v-model="filter.device_id" placeholder="全部设备" clearable style="width:150px" @change="refreshAlarms">
            <el-option v-for="d in devices" :key="d.device_id" :label="d.name || d.device_name || d.device_id" :value="d.device_id" />
          </el-select>
          <el-select v-model="filter.alarm_level" placeholder="全部等级" clearable style="width:120px" @change="refreshAlarms">
            <el-option label="严重" value="critical" />
            <el-option label="警告" value="warning" />
            <el-option label="信息" value="info" />
          </el-select>
          <el-select v-model="filter.status" placeholder="全部状态" clearable style="width:120px" @change="refreshAlarms">
            <el-option label="未确认" value="unacknowledged" />
            <el-option label="已确认" value="acknowledged" />
          </el-select>
          <el-button :loading="loading" @click="refreshAlarms"><el-icon><Refresh /></el-icon> 刷新</el-button>
          <el-button :loading="exporting" type="success" @click="exportAlarms"><el-icon><Download /></el-icon> 导出</el-button>
        </div>
      </div>

      <div class="panel__body">
        <!-- 当前筛选与批量操作：一行内说清"看到的=筛选结果"，并提供批量确认入口 -->
        <div class="list-bar">
          <div class="list-bar__summary">
            <span class="mono">共 {{ alarms.length }} 条</span>
            <span class="mono">未确认 {{ unackCount }} 条</span>
            <span v-if="filter.device_id" class="tag tag--offline">设备：{{ deviceName(filter.device_id) }}</span>
            <span v-if="filter.alarm_level" class="tag" :class="'tag--' + statusTagKind(filter.alarm_level)">等级：{{ LEVEL_TEXT[filter.alarm_level] }}</span>
            <span v-if="filter.status" class="tag tag--offline">状态：{{ filter.status === 'unacknowledged' ? '未确认' : '已确认' }}</span>
            <span v-if="loading" class="tag tag--info">加载中…</span>
          </div>
          <div class="list-bar__actions">
            <el-button type="primary" size="small" :loading="batchAcking" :disabled="!selectedKeys.length || batchAcking" @click="acknowledgeSelected">
              批量确认 ({{ selectedKeys.length }})
            </el-button>
            <el-button size="small" :disabled="!selectedKeys.length || batchAcking" @click="clearSelection">清空选择</el-button>
          </div>
        </div>

        <el-table
          ref="tableRef"
          :data="alarms"
          :row-key="rowKey"
          stripe
          v-loading="loading"
          max-height="600"
          @selection-change="onSelectionChange"
        >
          <el-table-column type="selection" width="44" :selectable="selectable" />
          <el-table-column label="" width="22" class-name="level-col">
            <template v-slot:default="{ row }">
              <span
                class="level-bar"
                :class="[levelBarClass(row.alarm_level), row.acknowledged ? '' : pulseClass(row.alarm_level)]"
                :title="row.acknowledged ? '已确认' : '未确认'"
              ></span>
            </template>
          </el-table-column>
          <el-table-column label="时间" width="190" class-name="mono-cell">
            <template v-slot:default="{ row }">{{ fmtTime(row.timestamp) }}</template>
          </el-table-column>
          <el-table-column prop="device_id" label="设备" width="140" show-overflow-tooltip />
          <el-table-column prop="register_name" label="参数" width="120" show-overflow-tooltip />
          <el-table-column prop="alarm_level" label="等级" width="80">
            <template v-slot:default="{ row }">
              <span class="tag" :class="'tag--' + statusTagKind(row.alarm_level)">{{ LEVEL_TEXT[row.alarm_level] || row.alarm_level }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="alarm_message" label="报警信息" show-overflow-tooltip />
          <el-table-column prop="threshold" label="阈值" width="90" align="right" class-name="mono-cell" />
          <el-table-column prop="actual_value" label="实际值" width="100" align="right" class-name="mono-cell">
            <template v-slot:default="{ row }">{{ fmtNum(row.actual_value) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template v-slot:default="{ row }">
              <span class="tag" :class="row.acknowledged ? 'tag--success' : 'tag--danger'">{{ row.acknowledged ? '已确认' : '未确认' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template v-slot:default="{ row }">
              <el-button
                v-if="!row.acknowledged"
                type="primary"
                link
                size="small"
                :loading="isPending(row)"
                @click="acknowledge(row.alarm_id || row.id)"
              >确认</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="没有符合条件的报警记录" :image-size="80" />
          </template>
        </el-table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { alarmsApi, devicesApi, type Alarm, type Device } from '@/api'

const alarms = ref<Alarm[]>([])
const devices = ref<Device[]>([])
const stats = ref<any>({})
const loading = ref(false)
const exporting = ref(false)
const batchAcking = ref(false)
const selectedKeys = ref<string[]>([])
const tableRef = ref<any>(null)
const filter = reactive({ device_id: '', alarm_level: '', status: '' })
// 防止同一报警重复提交确认
const pendingAcks = new Set<string>()
// 用于按钮 loading 反馈的响应式镜像（Set 本身不是响应式）
const pendingKeys = ref<string[]>([])
// 请求序号：快速切换筛选条件时丢弃过期响应
let refreshSeq = 0

const LEVEL_TEXT: Record<string, string> = { critical: '严重', warning: '警告', info: '信息' }

onMounted(() => { refreshAlarms(); loadDevices() })

async function loadDevices() {
  try { const data = await devicesApi.getAll(); devices.value = data.devices || [] } catch (e: any) { console.warn('[Alarms] 加载失败:', e?.message || e) }
}

async function refreshAlarms() {
  const seq = ++refreshSeq
  loading.value = true
  try {
    const params: any = { limit: 100 }
    if (filter.device_id) params.device_id = filter.device_id
    if (filter.alarm_level) params.alarm_level = filter.alarm_level
    const [alarmData, statsData] = await Promise.all([alarmsApi.getAll(params), alarmsApi.getStatistics()])
    if (seq !== refreshSeq) return
    alarms.value = (alarmData.alarms || []).filter((a: any) => {
      if (filter.status === 'unacknowledged') return !a.acknowledged
      if (filter.status === 'acknowledged') return a.acknowledged
      return true
    })
    stats.value = statsData || {}
    // 列表被替换后旧的勾选已无意义，清掉避免批量操作指向不存在的行
    clearSelection()
  } catch (e: any) { console.warn('[Alarms] 加载失败:', e?.message || e) }
  finally { if (seq === refreshSeq) loading.value = false }
}

// ========== 展示辅助 ==========
function fmtNum(v: any): string {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : '-'
}
function fmtTime(t: string): string {
  if (!t) return '-'
  const d = new Date(t)
  return isNaN(d.getTime()) ? '-' : d.toLocaleString()
}
function levelKey(level: string): string {
  return LEVEL_TEXT[level] ? level : 'info'
}
function levelBarClass(level: string): string { return `level-bar--${levelKey(level)}` }
function pulseClass(level: string): string {
  const k = levelKey(level)
  return k === 'critical' ? 'level-bar--pulse-critical' : k === 'warning' ? 'level-bar--pulse-warning' : ''
}
// 等级 → 基线标签类（critical 复用 danger 语义色）
function statusTagKind(level: string): string {
  const k = levelKey(level)
  return k === 'critical' ? 'danger' : k === 'warning' ? 'warning' : 'info'
}
function deviceName(id: string): string {
  const d = devices.value.find(x => x.device_id === id)
  return d?.name || d?.device_name || id
}

// ========== 统计与占比（全部来自 /alarms/statistics 真实字段） ==========
const totalActive = computed(() => Number(stats.value?.total_active_alarms) || 0)
const unackCount = computed(() => alarms.value.filter(a => !a.acknowledged).length)

function levelCount(level: string): number { return Number(stats.value?.by_level?.[level]) || 0 }
function levelPct(level: string): string {
  const by = stats.value?.by_level || {}
  const sum = ['critical', 'warning', 'info'].reduce((s, k) => s + (Number(by[k]) || 0), 0)
  if (!sum) return '0.0'
  return ((levelCount(level) / sum) * 100).toFixed(1)
}
const levelSegments = computed(() => {
  const items = (['critical', 'warning', 'info'] as const).map(key => ({
    key, label: LEVEL_TEXT[key], value: levelCount(key),
  }))
  const sum = items.reduce((s, i) => s + i.value, 0)
  return items.map(i => ({ ...i, pct: sum ? (i.value / sum) * 100 : 0 }))
})
const segmentAriaLabel = computed(() =>
  levelSegments.value.map(s => `${s.label} ${s.value} 条`).join('，'))

const TOP_DEVICES = 8
const deviceBars = computed(() => {
  const by = stats.value?.by_device || {}
  const rows = Object.entries(by)
    .map(([id, v]) => ({ id, value: Number(v) || 0 }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
  const top = rows.slice(0, TOP_DEVICES)
  const max = top.length ? top[0].value : 0
  return top.map(r => ({ ...r, name: deviceName(r.id), width: max ? Math.max(6, (r.value / max) * 100) : 0 }))
})
const hiddenDeviceCount = computed(() => {
  const by = stats.value?.by_device || {}
  const total = Object.values(by).filter(v => (Number(v) || 0) > 0).length
  return Math.max(0, total - deviceBars.value.length)
})

// ========== 选择与批量确认 ==========
function rowKey(row: any): string { return `${row?.device_id || ''}:${row?.alarm_id || row?.id || ''}` }
function selectable(row: any): boolean { return !row?.acknowledged }
function onSelectionChange(rows: Alarm[]) { selectedKeys.value = rows.map(rowKey) }
function isPending(row: any): boolean { return pendingKeys.value.includes(rowKey(row)) }
function clearSelection() {
  selectedKeys.value = []
  tableRef.value?.clearSelection?.()
}

async function acknowledge(id: string | number) {
  const alarmId = id == null ? '' : String(id)
  if (!alarmId) return
  // 后端按 alarm_id（规则ID）+ device_id + register_name 定位记录，传数据库自增 id 会确认失败
  const alarm = alarms.value.find(a => String(a.alarm_id) === alarmId || String(a.id) === alarmId)
  // 同一 alarm_id 可能出现在多台设备上，按 设备+规则ID 去重，避免重复提交
  const key = `${alarm?.device_id || ''}:${alarmId}`
  if (pendingAcks.has(key)) return
  pendingAcks.add(key)
  pendingKeys.value = [...pendingAcks]
  try {
    const res: any = await alarmsApi.acknowledge(alarmId, alarm?.device_id, alarm?.register_name)
    if (res && res.success === false) { ElMessage.error(res.message || '报警确认失败'); return }
    ElMessage.success('报警已确认')
    refreshAlarms()
  } catch (e: any) {
    console.warn('[Alarms] 确认失败:', e?.message || e)
    ElMessage.error('报警确认失败: ' + (e?.response?.data?.error || e?.response?.data?.message || e?.message || '未知错误'))
  } finally {
    pendingAcks.delete(key)
    pendingKeys.value = [...pendingAcks]
  }
}

// 批量确认：逐条串行提交，最后统一刷新并给出成功/失败条数
async function acknowledgeSelected() {
  if (batchAcking.value) return
  const targets = alarms.value.filter(a => selectedKeys.value.includes(rowKey(a)) && !a.acknowledged)
  if (!targets.length) { ElMessage.warning('请先勾选未确认的报警'); return }
  try {
    await ElMessageBox.confirm(`确定确认选中的 ${targets.length} 条报警？`, '批量确认', {
      confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning',
    })
  } catch { return }

  batchAcking.value = true
  let ok = 0, fail = 0, skipped = 0
  for (const a of targets) {
    const alarmId = String(a.alarm_id || a.id || '')
    const key = `${a.device_id || ''}:${alarmId}`
    if (!alarmId || pendingAcks.has(key)) { skipped++; continue }
    pendingAcks.add(key)
    pendingKeys.value = [...pendingAcks]
    try {
      const res: any = await alarmsApi.acknowledge(alarmId, a.device_id, a.register_name)
      if (res && res.success === false) fail++
      else ok++
    } catch (e: any) {
      console.warn('[Alarms] 批量确认失败:', e?.message || e)
      fail++
    } finally {
      pendingAcks.delete(key)
      pendingKeys.value = [...pendingAcks]
    }
  }
  batchAcking.value = false
  await refreshAlarms()
  const tail = skipped ? `，跳过重复提交 ${skipped} 条` : ''
  if (fail) ElMessage.warning(`批量确认完成：成功 ${ok} 条，失败 ${fail} 条${tail}`)
  else ElMessage.success(`已确认 ${ok} 条报警${tail}`)
}

async function exportAlarms() {
  if (exporting.value) return
  exporting.value = true
  try {
    const blob = await alarmsApi.exportAlarms('csv') as any
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `alarms-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('报警数据已导出')
  } catch (e: any) {
    // 如果后端导出失败，用前端数据生成 CSV（同时提示用户是本地数据，避免误认为后端导出成功）
    const headers = ['时间', '设备', '参数', '等级', '报警信息', '阈值', '实际值', '状态']
    const esc = (v: any) => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s }
    const rows = alarms.value.map(a => [
      fmtTime(a.timestamp),
      a.device_id,
      a.register_name,
      a.alarm_level,
      a.alarm_message,
      a.threshold,
      a.actual_value,
      a.acknowledged ? '已确认' : '未确认',
    ])
    const csv = [headers.join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `alarms-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    if (e?.response) ElMessage.warning('后端导出失败，已改为导出当前列表数据')
    else ElMessage.success('报警数据已导出')
  } finally { exporting.value = false }
}
</script>

<style scoped>
.alarms-page {
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
  margin: 0;
}

.panel__tools {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
}

/* ===== 指标卡 ===== */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-4);
}

.stat-card {
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.stat-foot {
  font-size: var(--font-xs);
  color: var(--text-muted);
}

.stat-value--danger { color: var(--color-danger); }
.stat-value--warning { color: var(--color-warning); }
.stat-value--success { color: var(--color-success); }

/* ===== 占比可视化 ===== */
.viz-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--space-4);
}

.segment-bar {
  display: flex;
  height: 18px;
  border-radius: var(--radius-pill);
  overflow: hidden;
  background: var(--bg-sunken);
  border: 1px solid var(--border-base);
}

.segment { display: block; height: 100%; }
.segment--critical { background: var(--level-critical); }
.segment--warning { background: var(--level-warning); }
.segment--info { background: var(--level-info); }

.legend-list {
  list-style: none;
  margin: var(--space-3) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.legend-list li {
  display: grid;
  grid-template-columns: 10px 1fr auto auto;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.legend-list__label { color: var(--text-primary); }

.dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
}

.dot--critical { background: var(--level-critical); }
.dot--warning { background: var(--level-warning); }
.dot--info { background: var(--level-info); }

.bar-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.bar-list li {
  display: grid;
  grid-template-columns: 140px 1fr 70px;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--font-sm);
}

.bar-list__name {
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-list__value { text-align: right; color: var(--text-secondary); }

.bar-track {
  height: 10px;
  border-radius: var(--radius-pill);
  background: var(--bg-sunken);
  border: 1px solid var(--border-base);
  overflow: hidden;
}

.bar-fill {
  display: block;
  height: 100%;
  background: var(--color-brand);
  border-radius: var(--radius-pill);
}

/* ===== 列表 ===== */
.list-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.list-bar__summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  font-size: var(--font-xs);
  color: var(--text-muted);
}

.list-bar__actions { display: flex; gap: var(--space-2); }

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.muted { color: var(--text-muted); }

/* 行内等级色条：只强调左侧色条，不做整行闪烁 */
.level-col .level-bar {
  display: inline-block;
  height: 26px;
  vertical-align: middle;
}

:deep(.mono-cell .cell) {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
</style>
