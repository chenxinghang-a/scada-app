<template>
  <div class="dashboard" :class="{ 'dashboard--trend-collapsed': trendCollapsed }">
    <!-- KPI 行：主 KPI（OEE / 活动报警）+ 次要 KPI，每个带迷你可视化 -->
    <div class="kpi-row">
      <!-- 主 KPI：OEE，细进度条 + 目标对标线 -->
      <div class="kpi kpi--primary" :class="{ 'kpi--warn': kpi.oee < OEE_TARGET, 'kpi--bad': kpi.oee < OEE_WARN }">
        <div class="kpi__head">
          <span class="metric-label">OEE 综合效率</span>
          <span class="tag" :class="kpi.oee >= OEE_TARGET ? 'tag--success' : 'tag--warning'">
            {{ kpi.oee >= OEE_TARGET ? '达标' : '未达标' }}
          </span>
        </div>
        <div class="metric-value metric-value--lg">{{ kpi.oee }}<span class="metric-unit">%</span></div>
        <div class="kpi-bar" :title="`目标 ${OEE_TARGET}%`">
          <div class="kpi-bar__fill" :class="oeeBarClass" :style="{ width: clampPct(kpi.oee) + '%' }"></div>
          <div class="kpi-bar__target" :style="{ left: OEE_TARGET + '%' }"></div>
        </div>
        <div class="kpi__foot">目标 ≥{{ OEE_TARGET }}%</div>
      </div>

      <!-- 次要 KPI：设备在线分布 -->
      <div class="kpi">
        <div class="kpi__head">
          <span class="metric-label">设备状态</span>
          <span class="tag" :class="kpi.online < kpi.total ? 'tag--warning' : 'tag--success'">在线率 {{ onlinePctText }}%</span>
        </div>
        <div class="metric-value">{{ kpi.online }}<span class="metric-unit">/ {{ kpi.total }} 台</span></div>
        <div class="mini-split" :title="`在线 ${kpi.online} 台 / 离线 ${offlineKpi} 台`">
          <span class="mini-split__on" :style="{ width: onlinePct + '%' }"></span>
          <span class="mini-split__off" :style="{ width: (100 - onlinePct) + '%' }"></span>
        </div>
        <div class="kpi__foot">离线 {{ offlineKpi }} 台</div>
      </div>

      <!-- 主 KPI：活动报警，等级分段条 -->
      <div class="kpi kpi--primary" :class="{ 'kpi--alarm': kpi.alarmCount > 0 }">
        <div class="kpi__head">
          <span class="metric-label">活动报警</span>
          <span class="tag" :class="kpi.unacked > 0 ? 'tag--warning' : 'tag--success'">未确认 {{ kpi.unacked }}</span>
        </div>
        <div class="metric-value metric-value--lg">{{ kpi.alarmCount }}<span class="metric-unit">条</span></div>
        <div class="alarm-seg" :title="`CRIT ${kpi.crit} / HIGH ${kpi.high} / MED ${kpi.med}`">
          <span v-for="s in alarmSegments" :key="s.key" class="alarm-seg__item" :class="s.cls" :style="{ width: s.pct + '%' }"></span>
        </div>
        <div class="alarm-seg__legend">
          <span v-for="s in alarmSegments" :key="s.key" class="alarm-seg__lg">
            <i class="alarm-seg__dot" :class="s.cls"></i>{{ s.label }} {{ s.count }}
          </span>
        </div>
      </div>

      <!-- 次要 KPI：采集吞吐，迷你 sparkline -->
      <div class="kpi">
        <div class="kpi__head">
          <span class="metric-label">采集吞吐</span>
        </div>
        <div class="metric-value">{{ kpi.rate }}<span class="metric-unit">条/分</span></div>
        <svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
          <polygon class="spark__area" :points="sparkAreaPoints" />
          <polyline class="spark__line" :points="sparkPoints" />
        </svg>
        <div class="kpi__foot">近 {{ rateHistory.length }} 个采样点</div>
      </div>

      <!-- 次要 KPI：数据质量，细进度条 + 目标对标线 -->
      <div class="kpi">
        <div class="kpi__head">
          <span class="metric-label">数据质量</span>
          <span class="tag" :class="kpi.quality >= QUALITY_TARGET ? 'tag--success' : 'tag--warning'">成功率</span>
        </div>
        <div class="metric-value">{{ kpi.quality }}<span class="metric-unit">%</span></div>
        <div class="kpi-bar" :title="`目标 ${QUALITY_TARGET}%`">
          <div class="kpi-bar__fill" :class="qualityBarClass" :style="{ width: clampPct(kpi.quality) + '%' }"></div>
          <div class="kpi-bar__target" :style="{ left: QUALITY_TARGET + '%' }"></div>
        </div>
        <div class="kpi__foot">目标 ≥{{ QUALITY_TARGET }}%</div>
      </div>

      <!-- 次要 KPI：运行时间 -->
      <div class="kpi">
        <div class="kpi__head">
          <span class="metric-label">运行时间</span>
          <span class="tag tag--info">{{ kpi.mode }}</span>
        </div>
        <div class="metric-value">{{ kpi.uptime }}</div>
        <div class="kpi__foot">自系统启动累计</div>
      </div>
    </div>

    <!-- 报警提示横幅：等级色条 + 语义底色，不做整行闪烁 -->
    <div v-if="latestAlarm" class="alarm-banner" :class="bannerClass" @click="$router.push('/alarms')">
      <span class="level-bar" :class="levelBarClass(latestAlarm.alarm_level)"></span>
      <span class="banner-text">{{ latestAlarm.alarm_message }}</span>
      <span class="tag tag--danger">{{ latestAlarm.device_id }}</span>
      <button class="banner-close" @click.stop="dismissBanner" aria-label="关闭">×</button>
    </div>

    <!-- 主区域：设备优先 -->
    <div class="main-area">
      <!-- 设备卡片网格 -->
      <div class="panel device-panel">
        <div class="panel__header dev-filter-bar">
          <div class="dev-filter-tabs">
            <button class="dev-tab" :class="{ active: devFilter === 'all' }" @click="setDevFilter('all')">全部 {{ allDeviceList.length }}</button>
            <button class="dev-tab" :class="{ active: devFilter === 'online' }" @click="setDevFilter('online')">在线 {{ onlineCount }}</button>
            <button class="dev-tab" :class="{ active: devFilter === 'offline' }" @click="setDevFilter('offline')">离线 {{ offlineCount }}</button>
            <button class="dev-tab" :class="{ active: devFilter === 'fault' }" @click="setDevFilter('fault')">告警 {{ faultCount }}</button>
            <button class="dev-tab" :class="{ active: devFilter === 'mechanical' }" @click="setDevFilter('mechanical')">机械 {{ mechanicalCount }}</button>
          </div>
          <div class="dev-filter-right">
            <select v-model="devProtocolFilter" class="dev-proto-select">
              <option value="">全部协议</option>
              <option v-for="p in protocolList" :key="p" :value="p">{{ p }}</option>
            </select>
            <span class="dev-count-badge">共 {{ filteredDeviceList.length }} 台</span>
          </div>
        </div>

        <!-- 加载失败：必须可见（原因 + 重试），不再只写 console.warn -->
        <div
          v-if="deviceLoadState === 'error'"
          class="dev-state dev-state--error"
          :class="{ 'dev-state--solo': allDeviceList.length === 0 }"
          role="alert"
        >
          <span class="dev-state__title">设备列表加载失败</span>
          <span class="dev-state__reason" :title="deviceLoadError">{{ deviceLoadError || '未知错误' }}</span>
          <button class="dev-state__retry" @click="retryDeviceLoad">重试</button>
          <span v-if="allDeviceList.length" class="dev-state__note">下方为上次成功获取的数据</span>
        </div>

        <!-- 首次加载：骨架屏（明确区别于"真的没有设备"） -->
        <div
          v-if="allDeviceList.length === 0 && deviceLoadState !== 'error'"
          class="device-grid device-grid--skeleton"
          aria-busy="true"
          aria-label="设备列表加载中"
        >
          <div v-for="i in SKELETON_CARDS" :key="i" class="dev-card dev-card--skeleton">
            <span class="dev-skel dev-skel--title"></span>
            <span class="dev-skel dev-skel--meta"></span>
            <span class="dev-skel dev-skel--value"></span>
          </div>
        </div>

        <div v-else class="device-grid">
          <div
            v-for="d in pagedDeviceList"
            :key="getDeviceId(d)"
            class="dev-card"
            :class="{ 'dev-card--expanded': expandedDeviceId === getDeviceId(d), 'dev-card--alarm': hasDeviceAlarm(d) }"
            @click="onCardClick(getDeviceId(d))"
          >
            <div class="dev-status" :class="getDeviceStatusClass(d)"></div>
            <div class="dev-info">
              <!-- 主行：设备名 + 状态 + 告警角标 -->
              <div class="dev-name">
                <span class="dev-name__text" :title="d.name || getDeviceId(d)">{{ d.name || d.device_id }}</span>
                <span class="tag" :class="statusTagClass(d)">{{ getDeviceStatusText(d) }}</span>
                <span v-if="getDeviceAlarm(d)" class="tag" :class="alarmTagClass(d)" :title="alarmTagTitle(d)">告警 {{ getDeviceAlarm(d)?.total }}</span>
                <span v-if="d.zone" class="tag tag--info">{{ d.zone }}</span>
              </div>
              <!-- 次行：协议 · 地址 · 点位数 -->
              <div class="dev-meta">
                <span>{{ d.protocol || 'modbus_tcp' }}</span>
                <span class="dev-meta__sep">·</span>
                <span class="dev-meta__addr" :title="deviceAddress(d)">{{ deviceAddress(d) }}</span>
                <span class="dev-meta__sep">·</span>
                <span>{{ devicePoints(d).length }} 点位</span>
              </div>
              <!-- 第三行：关键值（大号等宽）+ 迷你趋势 + 相对量程条 -->
              <div class="dev-kv">
                <div v-for="(k, i) in cardKeyPoints(d)" :key="k.name" class="kv" :class="{ 'kv--primary': i === 0 }">
                  <div class="kv__head">
                    <span class="kv__label" :title="k.desc || k.name">{{ k.label }}<span v-if="k.unit" class="kv__unit"> · {{ k.unit }}</span></span>
                    <svg v-if="k.spark" class="spark spark--mini" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
                      <polyline class="spark__line" :points="k.spark" />
                    </svg>
                    <span v-else class="kv__trend-none" title="历史点不足（采集满 2 个点后出现迷你趋势）">—</span>
                  </div>
                  <div class="kv__value">
                    <span class="kv__num" :style="{ color: k.color }">{{ k.valueText }}</span>
                    <span v-if="k.quality != null" class="quality-dot" :class="k.qualityLevel" :title="k.qualityLabel"></span>
                  </div>
                  <div v-if="k.bar" class="dev-bar" :title="k.bar.title">
                    <span class="dev-bar__fill" :class="k.bar.cls" :style="{ width: k.bar.pct + '%' }"></span>
                  </div>
                  <div v-else class="dev-bar dev-bar--none" :title="`${k.label}：无可用量程/阈值，仅显示数值`"></div>
                </div>
              </div>
              <!-- 就地展开：全部点位（点击卡片切换，点击展开区不收起） -->
              <div v-if="expandedDeviceId === getDeviceId(d)" class="dev-detail" @click.stop>
                <div class="dev-detail__head">
                  <span class="dev-detail__title">全部 {{ devicePoints(d).length }} 个点位</span>
                  <span v-if="deviceDescription(d)" class="dev-detail__desc" :title="deviceDescription(d)">{{ deviceDescription(d) }}</span>
                  <span class="dev-detail__hint">再次点击卡片收起</span>
                </div>
                <div class="dev-detail__rows">
                  <div v-for="r in cardAllPoints(d)" :key="r.name" class="dev-row">
                    <span class="dev-row__label" :title="r.desc || r.name">{{ r.label }}</span>
                    <span class="dev-row__num" :style="{ color: r.color }">{{ r.valueText }}</span>
                    <span class="dev-row__unit">{{ r.unit }}</span>
                    <span v-if="r.bar" class="dev-row__bar" :title="r.bar.title">
                      <span class="dev-bar__fill" :class="r.bar.cls" :style="{ width: r.bar.pct + '%' }"></span>
                    </span>
                    <span v-else class="dev-row__bar dev-row__bar--none"></span>
                  </div>
                </div>
              </div>
            </div>
            <span class="dev-expand" aria-hidden="true">{{ expandedDeviceId === getDeviceId(d) ? '▴' : '▾' }}</span>
            <button v-if="d.device_category === 'mechanical' && d.connected" class="dev-ctrl-btn" :class="d.stopped ? 'start' : 'stop'" @click.stop="toggleDevice(getDeviceId(d), !d.stopped)" :title="d.stopped ? '启动' : '停止'">
              {{ d.stopped ? '▶' : '■' }}
            </button>
          </div>
          <div v-if="deviceLoadState === 'ok' && pagedDeviceList.length === 0" class="grid-empty">
            <el-empty v-if="allDeviceList.length === 0" description="接口未返回任何设备（0 台）" :image-size="64" />
            <el-empty v-else description="当前筛选条件下暂无匹配设备" :image-size="64" />
          </div>
        </div>

        <!-- 分页 -->
        <div v-if="filteredDeviceList.length > devPageSize" class="dev-pager">
          <button class="pager-btn" :disabled="devPage <= 1" @click="devPage = 1" title="首页">«</button>
          <button class="pager-btn" :disabled="devPage <= 1" @click="devPage--">‹</button>
          <span class="pager-info">{{ (devPage-1)*devPageSize+1 }}-{{ Math.min(devPage*devPageSize, filteredDeviceList.length) }} / 共 {{ filteredDeviceList.length }} 台</span>
          <button class="pager-btn" :disabled="devPage >= devTotalPages" @click="devPage++">›</button>
          <button class="pager-btn" :disabled="devPage >= devTotalPages" @click="devPage = devTotalPages" title="末页">»</button>
        </div>
      </div>

      <!-- 报警面板 -->
      <div class="panel alarm-panel">
        <div class="panel__header alarm-header">
          <span>实时报警</span>
          <span class="alarm-badges">
            <span class="tag tag--danger">CRIT: {{ kpi.crit }}</span>
            <span class="tag tag--warning">HIGH: {{ kpi.high }}</span>
            <span class="tag tag--info">MED: {{ kpi.med }}</span>
          </span>
        </div>
        <div class="alarm-list">
          <div v-if="alarms.length === 0" class="alarm-empty">
            <el-empty description="暂无活动报警，系统运行正常" :image-size="64" />
          </div>
          <div v-for="a in alarms.slice(0, 20)" :key="a.id || a.alarm_id" class="alarm-row">
            <span
              class="level-bar"
              :class="[levelBarClass(a.alarm_level), a.acknowledged ? '' : pulseClass(a.alarm_level)]"
            ></span>
            <div class="alarm-row__main">
              <div class="alarm-row__line1">
                <span class="alarm-row__device">{{ a.device_id || '-' }}</span>
                <span class="alarm-row__prio" :class="'alarm-row__prio--' + levelKey(a.alarm_level)">{{ getAlarmPrioText(a.alarm_level) }}</span>
                <span class="alarm-row__time">{{ formatAlarmTime(a.last_trigger_time || a.timestamp) }}</span>
                <span v-if="(a.trigger_count || 1) > 1" class="alarm-row__count">×{{ a.trigger_count }}</span>
                <button v-if="!a.acknowledged" class="alarm-row__ack" @click="ackAlarm(a.alarm_id || a.id || '', a.device_id, a.register_name)">确认</button>
                <span v-else class="tag tag--offline alarm-row__acked">已确认</span>
              </div>
              <div class="alarm-row__line2">
                <span class="alarm-row__msg">{{ a.alarm_message || a.id }}</span>
                <span v-if="getAlarmPV(a)" class="alarm-row__pv">{{ getAlarmPV(a) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 趋势图（可折叠：小屏折叠后把高度让给设备区） -->
    <div class="panel trend-area" :class="{ 'trend-area--collapsed': trendCollapsed }">
      <div class="panel__header trend-header">
        <span class="trend-title">实时趋势</span>
        <div class="trend-tools">
          <select v-model="selectedDeviceId" @change="onDeviceChange" class="trend-select" :disabled="trendCollapsed">
            <option v-for="d in allDeviceList" :key="getDeviceId(d)" :value="getDeviceId(d)">{{ d.name || d.device_id }}</option>
          </select>
          <span class="tag tag--info">{{ trendSeriesCount }} 个指标</span>
          <button class="trend-btn" @click="exportChartData">导出图表</button>
          <button class="trend-btn" @click="exportAllData">导出全部</button>
          <button
            class="trend-btn trend-btn--toggle"
            :aria-expanded="!trendCollapsed"
            @click="toggleTrend"
          >{{ trendCollapsed ? '展开趋势' : '收起趋势' }}</button>
        </div>
      </div>
      <div v-show="!trendCollapsed" ref="trendChartRef" class="trend-chart"></div>
    </div>

    <!-- 状态栏 -->
    <div class="status-bar">
      <span class="status-dot" :class="statusDotClass"></span>
      <span>{{ statusText }}</span>
      <span class="status-db">DB: {{ kpi.dbRecords.toLocaleString() }} 条</span>
      <span class="status-right">
        <router-link to="/users" class="status-link">{{ userName }}</router-link>
        <router-link to="/screen" class="status-link">大屏</router-link>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive, watch, nextTick } from 'vue'
import * as echarts from 'echarts'
import { io } from 'socket.io-client'
import { ElMessage, ElMessageBox } from 'element-plus'
import { systemApi, devicesApi, dataApi, alarmsApi, industry40Api, type DeviceStatus, type SystemStatus, type Alarm } from '@/api'
import { getAuthToken, getWsBaseUrl } from '@/api/request'
import { useAuthStore } from '@/stores/auth'
import { showActionError } from '@/utils/error'
import { registerScadaTheme, scadaThemeName, applyScadaTheme, SCADA_LEVEL_COLORS } from '@/utils/echartsTheme'

const authStore = useAuthStore()

// 统一图表主题（幂等注册）
registerScadaTheme(echarts)

// ========== 展示常量 ==========
const OEE_TARGET = 85
const OEE_WARN = 70
const QUALITY_TARGET = 99
const RATE_HISTORY_MAX = 30

// ========== 状态 ==========
const allDeviceList = ref<DeviceStatus[]>([])
const alarms = ref<Alarm[]>([])
const latestAlarm = ref<Alarm | null>(null)
const selectedDeviceId = ref('')
const userName = ref('用户')
const trendChartRef = ref<HTMLElement>()
let trendChart: echarts.ECharts | null = null
let trendResizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let socket: ReturnType<typeof io> | null = null
let loadTimer: ReturnType<typeof setInterval> | undefined
let loadDataInProgress = false
let loadGeneration = 0
let isUnmounted = false
// 防止同一报警被重复确认（防重复提交）
const pendingAcks = new Set<string>()

const deviceCache: Record<string, DeviceStatus> = {}
// 按 device_id + register_name 分桶，避免切换设备后同名寄存器数据串台
const dataBuffers: Record<string, Array<{ t: string; v: number }>> = {}
const deviceValues = reactive<Record<string, number>>({})
const deviceQuality = reactive<Record<string, number>>({})
// 寄存器单位（来自 realtime 接口的 unit 字段），仅用于提示/图例展示
const registerUnits = reactive<Record<string, string>>({})
const MAX_CHART_POINTS = 200
// 卡片迷你趋势采样点数（非选中设备只保留这么多点，控制内存）
const CARD_SPARK_POINTS = 20
// 卡片第三行展示的关键点位数
const CARD_KEY_POINTS = 2

// ========== 设备区三态（A：加载中 / 失败 / 无设备 必须可分辨）==========
const deviceLoadState = ref<'loading' | 'ok' | 'error'>('loading')
const deviceLoadError = ref('')
const SKELETON_CARDS = 6
// 卡片就地展开的设备（B5）
const expandedDeviceId = ref('')
// 趋势区折叠开关（A3），折叠后设备区获得更多高度
const trendCollapsed = ref(false)
// dataBuffers 是普通对象（非响应式），用版本号驱动卡片 sparkline 重算
const bufferVersion = ref(0)

// ========== 报警按设备聚合（B4：告警设备置顶 + 卡片角标）==========
// 后端 /api/system/status 的 devices[] 不含 status/zone 字段（实测），
// 设备级的"告警"只能从 alarms 列表按 device_id 聚合，不再依赖不存在的 d.status
type DeviceAlarmInfo = { total: number; unacked: number; worst: 'critical' | 'warning' | 'info' }
const alarmByDevice = computed(() => {
  const map: Record<string, DeviceAlarmInfo> = {}
  alarms.value.forEach(a => {
    const id = a.device_id
    if (!id) return
    const lvl = levelKey(a.alarm_level)
    const info = map[id] || (map[id] = { total: 0, unacked: 0, worst: 'info' })
    info.total++
    if (!a.acknowledged) info.unacked++
    if (lvl === 'critical' || (lvl === 'warning' && info.worst === 'info')) info.worst = lvl
  })
  return map
})
function getDeviceAlarm(d: DeviceStatus): DeviceAlarmInfo | null { return alarmByDevice.value[getDeviceId(d)] || null }
function hasDeviceAlarm(d: DeviceStatus): boolean { return !!getDeviceAlarm(d) }
function alarmTagClass(d: DeviceStatus): string {
  const a = getDeviceAlarm(d)
  return a && (a.worst === 'critical' || a.unacked > 0) ? 'tag--danger' : 'tag--warning'
}
function alarmTagTitle(d: DeviceStatus): string {
  const a = getDeviceAlarm(d)
  if (!a) return ''
  return `活动报警 ${a.total} 条，未确认 ${a.unacked} 条`
}
// 排序优先级：未确认告警 > 已确认告警 > 离线 > 停机 > 正常（操作员先看到异常设备）
function devicePriority(d: DeviceStatus): number {
  const a = getDeviceAlarm(d)
  if (a) return a.unacked > 0 ? 0 : 1
  if (!d.connected) return 2
  if (d.stopped) return 3
  return 4
}
function compareDevice(a: DeviceStatus, b: DeviceStatus): number {
  const pa = devicePriority(a), pb = devicePriority(b)
  if (pa !== pb) return pa - pb
  return getDeviceId(a).localeCompare(getDeviceId(b))
}

// ========== 筛选 + 分页 ==========
const devFilter = ref('all')
const devProtocolFilter = ref('')
const devPage = ref(1)
// 监听协议筛选变化时重置分页
watch(devProtocolFilter, () => { devPage.value = 1 })
const devPageSize = 50

const onlineCount = computed(() => allDeviceList.value.filter(d => d.connected).length)
const offlineCount = computed(() => allDeviceList.value.filter(d => !d.connected).length)
// 告警台数改为按 alarms 聚合（原来依赖 devices[].status，实测后端不下发该字段 → 恒为 0）
const faultCount = computed(() => allDeviceList.value.filter(hasDeviceAlarm).length)
const mechanicalCount = computed(() => allDeviceList.value.filter(d => d.device_category === 'mechanical').length)
const protocolList = computed(() => Array.from(new Set(allDeviceList.value.map(d => d.protocol || 'modbus_tcp'))).sort())
const filteredDeviceList = computed(() => {
  let list = allDeviceList.value
  if (devFilter.value === 'online') list = list.filter(d => d.connected)
  else if (devFilter.value === 'offline') list = list.filter(d => !d.connected)
  else if (devFilter.value === 'fault') list = list.filter(hasDeviceAlarm)
  else if (devFilter.value === 'mechanical') list = list.filter(d => d.device_category === 'mechanical')
  if (devProtocolFilter.value) list = list.filter(d => (d.protocol || 'modbus_tcp') === devProtocolFilter.value)
  // 告警设备置顶（复制后排序，不改动 allDeviceList 本身）
  return list.slice().sort(compareDevice)
})
const devTotalPages = computed(() => Math.max(1, Math.ceil(filteredDeviceList.value.length / devPageSize)))
const pagedDeviceList = computed(() => {
  const start = (devPage.value - 1) * devPageSize
  return filteredDeviceList.value.slice(start, start + devPageSize)
})
function setDevFilter(f: string) { devFilter.value = f; devPage.value = 1 }

// ========== KPI ==========
const kpi = reactive({
  oee: 0, online: 0, total: 0, alarmCount: 0, unacked: 0, crit: 0, high: 0, med: 0,
  rate: 0, quality: 100, uptime: '-', mode: '模拟模式', dbRecords: 0,
})
// 采集吞吐采样点（每次轮询追加，用于迷你 sparkline）
const rateHistory = ref<number[]>([])
const statusDotClass = ref('status-dot--success')
const statusText = ref('系统运行中')

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, v))
}

const oeeBarClass = computed(() =>
  kpi.oee >= OEE_TARGET ? 'kpi-bar__fill--success' : kpi.oee >= OEE_WARN ? 'kpi-bar__fill--warning' : 'kpi-bar__fill--danger'
)
const qualityBarClass = computed(() =>
  kpi.quality >= QUALITY_TARGET ? 'kpi-bar__fill--success' : kpi.quality >= QUALITY_TARGET - 4 ? 'kpi-bar__fill--warning' : 'kpi-bar__fill--danger'
)
const onlinePct = computed(() => kpi.total > 0 ? clampPct(kpi.online / kpi.total * 100) : 0)
const onlinePctText = computed(() => kpi.total > 0 ? Math.round(kpi.online / kpi.total * 100) : 0)
const offlineKpi = computed(() => Math.max(0, kpi.total - kpi.online))

// 活动报警等级分段条（critical / high / med 三段，宽度按占比）
const alarmSegments = computed(() => {
  const base = Math.max(1, kpi.crit + kpi.high + kpi.med)
  return [
    { key: 'critical', label: 'CRIT', count: kpi.crit, cls: 'seg--critical', pct: kpi.crit / base * 100 },
    { key: 'warning', label: 'HIGH', count: kpi.high, cls: 'seg--warning', pct: kpi.high / base * 100 },
    { key: 'info', label: 'MED', count: kpi.med, cls: 'seg--info', pct: kpi.med / base * 100 },
  ]
})

// 迷你 sparkline（归一化到 0..100 x 0..28 的 viewBox）
const sparkPoints = computed(() => {
  const h = rateHistory.value
  if (h.length < 2) return '0,26 100,26'
  const min = Math.min(...h)
  const max = Math.max(...h)
  const span = max - min || 1
  return h
    .map((v, i) => `${(i / (h.length - 1) * 100).toFixed(2)},${(26 - (v - min) / span * 22).toFixed(2)}`)
    .join(' ')
})
const sparkAreaPoints = computed(() => `0,28 ${sparkPoints.value} 100,28`)

// ========== 报警横幅 ==========
const bannerClass = computed(() => {
  const lvl = levelKey(latestAlarm.value?.alarm_level || 'info')
  return `alarm-banner--${lvl}`
})
function dismissBanner() { latestAlarm.value = null }

// ========== 生命周期 ==========
onMounted(() => {
  initTrendChart()
  initThemeObserver()
  connectSocket()
  loadData()
  loadOEE()
  loadUserName()
  setPollInterval(5000)
})

onUnmounted(() => {
  isUnmounted = true
  if (loadTimer) { clearInterval(loadTimer); loadTimer = undefined }
  trendResizeObserver?.disconnect()
  trendResizeObserver = null
  themeObserver?.disconnect()
  themeObserver = null
  trendChart?.dispose()
  trendChart = null
  socket?.disconnect()
  socket = null
})

// 轮询定时器统一入口：先清后建，避免断开/重连时叠加出多个定时器
function setPollInterval(ms: number) {
  if (isUnmounted) return
  if (loadTimer) clearInterval(loadTimer)
  loadTimer = setInterval(loadData, ms)
}

// ========== 数据加载 ==========
async function loadData() {
  if (loadDataInProgress) return
  loadDataInProgress = true
  const gen = ++loadGeneration
  try {
    // 1. 先加载 realtime 数据填充缓存（确保首次不显示 "--"）
    try {
      const data = await dataApi.getRealtime() as any
      if (gen !== loadGeneration) return
      if (data?.data) {
        data.data.forEach((item: any) => {
          if (item.device_id && item.register_name && item.value != null) {
            const k = `${item.device_id}:${item.register_name}`
            deviceValues[k] = parseFloat(item.value)
            if (item.unit) registerUnits[k] = item.unit
            // 质量码（OPC UA 码，int）。此前只在 WS 分支填过，而 WS 载荷来自
            // SQLite 行、当时没有 quality 列 → 轮询与 WS 两条路都拿不到，
            // 质量圆点 UI 恒定走降级分支。现后端已把 quality 列补齐并随
            // /api/data/realtime 返回，这里必须一并回填。
            const q = normalizeQuality(item.quality)
            if (q != null) deviceQuality[k] = q
          }
        })
        updateTrendChart(data.data)
      }
    } catch (e: any) { console.warn('[Dashboard] 加载失败:', e?.message || e) }

    // 2. 加载系统状态
    try {
      const status = await systemApi.getStatus()
      if (gen !== loadGeneration) return
      // 接口返回缺少 devices → 视为失败并显式暴露（此前会被静默跳过，界面永远空白）
      if (!status || typeof status !== 'object' || !status.devices) {
        throw new Error('接口 /api/system/status 返回缺少 devices 字段')
      }
      updateKPI(status)
      updateDeviceGrid(status)
      updateStatusBar(status)
      deviceLoadState.value = 'ok'
      deviceLoadError.value = ''
    } catch (e: any) {
      if (gen !== loadGeneration) return
      const reason = e?.message || String(e)
      console.warn('[Dashboard] 系统状态加载失败:', reason)
      deviceLoadState.value = 'error'
      deviceLoadError.value = reason
      statusDotClass.value = 'status-dot--danger'
      statusText.value = '连接异常'
    }

    // 3. 加载报警
    try {
      const alarmData = await alarmsApi.getAll({ limit: 50 })
      if (gen !== loadGeneration) return
      if (alarmData?.alarms) {
        alarms.value = alarmData.alarms
        latestAlarm.value = alarmData.alarms.find((a: Alarm) => !a.acknowledged) || null
        const unacked = alarmData.alarms.filter((a: Alarm) => !a.acknowledged).length
        kpi.unacked = unacked
      }
    } catch (e: any) { console.warn('[Dashboard] 加载失败:', e?.message || e) }
  } finally {
    loadDataInProgress = false
  }
}

async function loadOEE() {
  try {
    // 后端 /api/industry40/oee 返回 {device_id: {...}} 映射（响应拦截器已解包 success/data 信封）
    const data = await industry40Api.getOEE() as any
    if (data && typeof data === 'object') {
      const list = Array.isArray(data) ? data : Object.values(data)
      if (list.length) {
        kpi.oee = Math.round(list.reduce((s: number, d: any) => s + (d?.oee_percent || 0), 0) / list.length)
      }
    }
  } catch (e: any) { console.warn('[Dashboard] 加载失败:', e?.message || e) }
}

function loadUserName() {
  userName.value = authStore.user?.display_name || authStore.user?.username || '用户'
}

// ========== KPI 更新 ==========
function updateKPI(stats: SystemStatus) {
  if (stats.devices) {
    const devs = Array.isArray(stats.devices) ? stats.devices : Object.values(stats.devices)
    kpi.online = devs.filter(d => d.connected).length
    kpi.total = devs.length
  }
  if (stats.alarms) {
    kpi.alarmCount = stats.alarms.total_active_alarms || 0
    const bl = stats.alarms.by_level || {}
    kpi.crit = bl.critical || 0
    kpi.high = bl.high || bl.warning || 0
    kpi.med = bl.medium || 0
  }
  if (stats.collector) {
    const c = stats.collector
    kpi.rate = Math.floor((c.total_collections || 0) / Math.max((stats.uptime_seconds || 1) / 60, 1))
    const total = (c.successful_collections || 0) + (c.failed_collections || 0)
    kpi.quality = total > 0 ? Math.round(c.successful_collections / total * 100) : 100
    // 追加吞吐采样点（环形上限，供 sparkline 展示近期趋势）
    rateHistory.value.push(kpi.rate)
    if (rateHistory.value.length > RATE_HISTORY_MAX) rateHistory.value.shift()
  }
  if (stats.uptime_seconds !== undefined) {
    kpi.uptime = formatUptime(stats.uptime_seconds)
    kpi.mode = stats.simulation_mode ? '模拟模式' : '真实设备'
  }
  if (stats.database) kpi.dbRecords = stats.database.total_records || 0
}

function updateDeviceGrid(stats: SystemStatus) {
  if (!stats.devices) return
  const devs = Array.isArray(stats.devices) ? stats.devices : Object.values(stats.devices)
  // 合并而非覆盖：保留已有的 host、port 等静态字段
  const activeIds = new Set<string>()
  devs.forEach(d => {
    const id = d.device_id || d.id || ''
    activeIds.add(id)
    const existing = deviceCache[id]
    if (existing) {
      // 合并：新数据覆盖旧数据，但保留旧数据中有而新数据中没有的字段
      deviceCache[id] = { ...existing, ...d }
      // 如果新数据没有 host 但旧数据有，保留旧的 host
      if (!d.host && existing.host) deviceCache[id].host = existing.host
      if (!(d as any).port && (existing as any).port) (deviceCache[id] as any).port = (existing as any).port
    } else {
      deviceCache[id] = d
    }
  })
  // 清除已删除的设备
  Object.keys(deviceCache).forEach(id => {
    if (!activeIds.has(id)) delete deviceCache[id]
  })
  allDeviceList.value = Object.values(deviceCache)
  if (!selectedDeviceId.value && allDeviceList.value.length > 0) selectedDeviceId.value = allDeviceList.value[0].device_id || allDeviceList.value[0].id || ''
  if (socket?.connected) {
    devs.forEach(d => { const id = d.device_id || d.id; if (id) socket!.emit('subscribe', { device_id: id }) })
  }
}

function updateStatusBar(_stats: SystemStatus) {
  statusDotClass.value = 'status-dot--success'
  statusText.value = '系统运行中'
}

// ========== 设备区状态与交互（A3/A4/B5）==========
// 加载失败后手动重试（失败必须可见且可恢复）
function retryDeviceLoad() {
  deviceLoadError.value = ''
  deviceLoadState.value = 'loading'
  loadData()
}
// 折叠/展开趋势区；重新展开后容器从 display:none 恢复，必须重新测量尺寸
function toggleTrend() {
  trendCollapsed.value = !trendCollapsed.value
  if (!trendCollapsed.value) nextTick(() => trendChart?.resize())
}
// 点击卡片：既切换趋势图设备（保留原行为），也就地展开全部点位
function onCardClick(deviceId: string) {
  if (!deviceId) return
  selectDevice(deviceId)
  expandedDeviceId.value = expandedDeviceId.value === deviceId ? '' : deviceId
}

// ========== 设备点位字段归一 ==========
// 实测 /api/system/status：只有 Modbus 设备有 registers，
// MQTT 设备点位在 topics、OPC UA 在 nodes、REST 在 endpoints（结构同为 {name, unit}）。
// 30 台里有 8 台 registers 为空 —— 只读 registers 会让这些卡片一个数值都显示不出来。
interface PointDef {
  name?: string
  unit?: string
  description?: string
  address?: number | string
  min?: number
  max?: number
  range?: number[]
}
function devicePoints(d: DeviceStatus): PointDef[] {
  const anyD = d as any
  const out: PointDef[] = []
  const seen = new Set<string>()
  const lists: any[] = [anyD.registers, anyD.nodes, anyD.topics, anyD.endpoints]
  lists.forEach(l => {
    if (!Array.isArray(l)) return
    l.forEach((p: any) => {
      const name = p?.name
      if (!name || seen.has(name)) return
      seen.add(name)
      out.push(p as PointDef)
    })
  })
  return out
}
function deviceAddress(d: DeviceStatus): string {
  const host = d.host || ''
  const port = (d as any).port
  if (!host) return '—'
  return port ? `${host}:${port}` : host
}
function deviceDescription(d: DeviceStatus): string {
  return (d as any).description || ''
}

// ========== 设备卡片 ==========
function getDeviceId(d: DeviceStatus): string { return d.device_id || d.id || '' }
// 状态色条：离线 > 活动告警（严重=红/一般=黄）> 停机 > 运行
// 注：后端 devices[] 实测不下发 status 字段，告警态改由 alarms 聚合（见 alarmByDevice）
function getDeviceStatusClass(d: DeviceStatus): string {
  if (!d.connected) return 'offline'
  const a = getDeviceAlarm(d)
  if (a) return a.worst === 'critical' ? 'fault' : 'warning'
  if (d.stopped) return 'stopped'
  if (d.status === 'fault' || d.status === 'warning') return 'warning'
  return 'online'
}
function statusTagClass(d: DeviceStatus): string {
  const s = getDeviceStatusClass(d)
  if (s === 'online') return 'tag--success'
  if (s === 'stopped') return 'tag--info'
  if (s === 'offline') return 'tag--offline'
  if (s === 'fault') return 'tag--danger'
  return 'tag--warning'
}
function getDeviceStatusText(d: DeviceStatus): string {
  if (!d.connected) return '离线'
  if (getDeviceAlarm(d)) return '告警'
  if (d.stopped) return '已停止'
  if (d.status === 'fault' || d.status === 'warning') return '告警'
  return '运行中'
}
function getDeviceValue(deviceId: string, regName: string): string {
  const v = deviceValues[`${deviceId}:${regName}`]
  return v !== undefined ? v.toFixed(1) : '--'
}
// 值超阈值时变色（保留原有语义，颜色改为设计令牌）
function getDeviceValueColor(deviceId: string, regName: string): string {
  const q = deviceQuality[`${deviceId}:${regName}`]
  if (q == null) return 'var(--text-primary)'
  return q >= 192 ? 'var(--color-success)' : q >= 64 ? 'var(--color-warning)' : 'var(--color-danger)'
}
function getDeviceQuality(deviceId: string, regName: string): number | null {
  const q = deviceQuality[`${deviceId}:${regName}`]
  return q != null ? q : null
}

// ========== 卡片点位视图模型（B1 量程条 / B2 迷你趋势）==========
interface PointVM {
  name: string
  label: string
  desc: string
  unit: string
  valueText: string
  color: string
  quality: number | null
  qualityLevel: string
  qualityLabel: string
  spark: string | null
  bar: { pct: number; cls: string; title: string } | null
}
/**
 * 相对量程可视化：
 * 1) 点位自带 min/max（或 range:[min,max]）→ 按真实量程取位置（当前后端未下发，拿到就画）
 * 2) 否则退化为"当前值相对报警阈值的位置"（阈值来自后端 alarms 规则，非推测）
 * 3) 两者都拿不到 → 返回 null，卡片只显示"值与单位"
 */
function valueBar(deviceId: string, regName: string, v: number, p: PointDef): PointVM['bar'] {
  const lo = Number(p.min ?? (Array.isArray(p.range) ? p.range[0] : NaN))
  const hi = Number(p.max ?? (Array.isArray(p.range) ? p.range[1] : NaN))
  if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
    const ratio = (v - lo) / (hi - lo)
    return {
      pct: clampPct(ratio * 100),
      cls: ratio > 1 ? 'dev-bar--danger' : ratio > 0.9 ? 'dev-bar--warning' : 'dev-bar--normal',
      title: `量程 ${lo}~${hi}，当前处于 ${Math.round(ratio * 100)}%`,
    }
  }
  const th = getRegisterThreshold(deviceId, regName)
  if (th && Number.isFinite(th.value) && th.value !== 0) {
    const ratio = v / th.value
    return {
      pct: clampPct(ratio * 100),
      cls: ratio >= 1 ? 'dev-bar--danger' : ratio >= 0.9 ? 'dev-bar--warning' : 'dev-bar--normal',
      title: `报警阈值 ${th.value}（${th.level} 级），当前为阈值的 ${Math.round(ratio * 100)}%`,
    }
  }
  return null
}
// 迷你趋势：复用 dataBuffers 的 device_id:register 分桶，取最近 N 点归一化到 0..100 / 0..24
function sparkFor(deviceId: string, regName: string): string | null {
  void bufferVersion.value // 建立响应式依赖（dataBuffers 为普通对象）
  const buf = dataBuffers[bufferKey(deviceId, regName)]
  if (!buf || buf.length < 2) return null
  const pts = buf.slice(-CARD_SPARK_POINTS)
  let min = Infinity, max = -Infinity
  pts.forEach(p => { if (p.v < min) min = p.v; if (p.v > max) max = p.v })
  const span = max - min || 1
  return pts
    .map((p, i) => `${(i / (pts.length - 1) * 100).toFixed(2)},${(22 - (p.v - min) / span * 20).toFixed(2)}`)
    .join(' ')
}
function pointVM(d: DeviceStatus, p: PointDef): PointVM {
  const id = getDeviceId(d)
  const name = p.name || ''
  const key = `${id}:${name}`
  const raw = deviceValues[key]
  const quality = getDeviceQuality(id, name)
  const bar = raw !== undefined && Number.isFinite(raw) ? valueBar(id, name, raw, p) : null
  // 质量码缺失时用"是否越过报警阈值"补语义色；有质量码时保留 getDeviceValueColor 原语义
  const semantic = quality == null && bar && bar.cls !== 'dev-bar--normal'
    ? (bar.cls === 'dev-bar--danger' ? 'var(--color-danger)' : 'var(--color-warning)')
    : null
  return {
    name,
    label: getShortLabel(name),
    desc: p.description || '',
    unit: registerUnits[key] || p.unit || '',
    valueText: getDeviceValue(id, name),
    color: raw === undefined ? 'var(--text-disabled)' : (semantic || getDeviceValueColor(id, name)),
    quality,
    qualityLevel: getQualityLevel(quality),
    qualityLabel: getQualityLabel(quality),
    spark: sparkFor(id, name),
    bar,
  }
}
/**
 * 卡片"关键值"挑选：优先有报警阈值规则的点位（真正需要盯的点），其次有实时值的点位，
 * 最后按设备配置顺序补齐；不再无脑取前 2 个寄存器。
 */
function cardKeyPoints(d: DeviceStatus): PointVM[] {
  const id = getDeviceId(d)
  const rank = (p: PointDef) => {
    const name = p.name || ''
    const noThreshold = getRegisterThreshold(id, name) ? 0 : 2
    const noValue = deviceValues[`${id}:${name}`] === undefined ? 1 : 0
    return noThreshold + noValue
  }
  // devicePoints 每次返回新数组，此处就地排序不会影响原配置
  return devicePoints(d)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, CARD_KEY_POINTS)
    .map(p => pointVM(d, p))
}
function cardAllPoints(d: DeviceStatus): PointVM[] {
  return devicePoints(d).map(p => pointVM(d, p))
}

// ========== 设备控制 ==========
async function toggleDevice(deviceId: string, stop: boolean) {
  const action = stop ? '停止' : '启动'
  try {
    await ElMessageBox.confirm(`确认${action}设备 ${deviceId}？`, '设备控制', { type: 'warning' })
  } catch { return }
  try {
    const data = stop ? await devicesApi.stop(deviceId) : await devicesApi.start(deviceId)
    if (data.success) loadData()
    else ElMessage.error(data.message || '操作失败')
  } catch (e: any) { ElMessage.error('操作异常: ' + e.message) }
}

// ========== 报警 ==========
// 等级归一化：后端只有 critical / warning / info 三类
function levelKey(level: string): 'critical' | 'warning' | 'info' {
  return level === 'critical' ? 'critical' : level === 'warning' ? 'warning' : 'info'
}
function levelBarClass(level: string): string { return `level-bar--${levelKey(level)}` }
// 未确认报警：只让左侧色条呼吸（不整行闪烁）
function pulseClass(level: string): string {
  const k = levelKey(level)
  return k === 'critical' ? 'level-bar--pulse-critical' : k === 'warning' ? 'level-bar--pulse-warning' : ''
}
function getAlarmPrioText(level: string): string { return level === 'critical' ? 'CRIT' : level === 'warning' ? 'HIGH' : 'LOW' }
function formatAlarmTime(t: string): string { return t ? new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-' }
function getAlarmPV(a: any): string { const v = a.last_value != null ? a.last_value : a.actual_value; return v != null ? `PV:${parseFloat(v).toFixed(1)}` : '' }
async function ackAlarm(alarmId: string, deviceId: string, regName: string) {
  // 同一 alarm_id 可能出现在多台设备上，按 设备+规则ID 作为去重键
  const key = `${deviceId}:${alarmId}`
  if (!alarmId || pendingAcks.has(key)) return
  pendingAcks.add(key)
  try {
    // 后端确认失败时返回 HTTP 200 + success:false，必须显式判断，否则静默失败
    const res: any = await alarmsApi.acknowledge(alarmId, deviceId, regName)
    if (res && res.success === false) ElMessage.error(res.message || '报警确认失败')
    loadData()
  } catch (e: any) { showActionError('确认报警', e) } finally { pendingAcks.delete(key) }
}

// ========== 工具函数 ==========
function formatUptime(s: number): string {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}天${h}时` : h > 0 ? `${h}时${m}分` : `${m}分`
}
function getShortLabel(name: string): string {
  const map: Record<string, string> = {
    'boiler_temperature': '锅炉温度', 'boiler_pressure': '锅炉压力',
    'heat_exchanger_temperature': '换热器温度', 'flue_gas_temperature': '排烟温度',
    'steam_flow': '蒸汽流量', 'feed_water_level': '给水液位',
    'oxygen_content': '含氧量', 'boiler_status': '锅炉状态',
    'mold_temperature': '模具温度', 'injection_pressure': '注射压力',
    'injection_speed': '注射速度', 'barrel_temperature': '料筒温度',
    'spray_pressure': '喷涂压力', 'oven_temperature': '烘干温度',
    'voltage_a': 'A相电压', 'current_a': 'A相电流',
    'active_power': '总有功', 'frequency': '频率',
    'temperature': '温度', 'pressure': '压力',
    'flow': '流量', 'level': '液位',
    'voltage': '电压', 'current': '电流', 'power': '功率',
  }
  if (map[name]) return map[name]
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(map)) { if (lower.includes(k)) return v }
  return name.length > 6 ? name.slice(0, 6) : name
}
// OPC 质量码 → 语义等级（颜色由 CSS 令牌决定）
function getQualityLevel(q: number | null): string {
  if (q == null) return 'quality-dot--unknown'
  return q >= 192 ? 'quality-dot--good' : q >= 64 ? 'quality-dot--uncertain' : 'quality-dot--bad'
}
/**
 * 把后端来的质量码收敛成 number | null。
 *
 * 为什么必须有这一步：后端历史上**同时存在三种 quality 语义** ——
 *   - 采集层的 OPC UA 数值码（192/104/0/4/6/8/80/64，int）
 *   - 模拟客户端的字符串标记（'good' / 'simulated' / 'BAD'）
 *   - OEE 接口的 `quality` 是 0~1 的**质量率**（同名不同义）
 * 直接写进 `deviceQuality` 会让下游的 `q >= 192` 对字符串做比较 ——
 * JS 里 `'BAD' >= 192` 求值为 false，静默判成 Bad 而不报错，
 * 属于最难查的一类 bug。这里显式收敛：只接受有限数值，其余一律 null
 * （null 会走"用报警阈值补语义色"的降级分支，是安全的默认行为）。
 */
function normalizeQuality(raw: any): number | null {
  if (raw == null) return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : null
}
function getQualityLabel(q: number | null): string {
  if (q == null) return ''
  return q >= 192 ? 'Good' : q >= 64 ? 'Uncertain' : 'Bad'
}

// ========== 趋势图 ==========
function bufferKey(deviceId: string, regName: string) { return `${deviceId}:${regName}` }
function selectedBuffers(): Record<string, Array<{ t: string; v: number }>> {
  const prefix = `${selectedDeviceId.value}:`
  const out: Record<string, Array<{ t: string; v: number }>> = {}
  Object.keys(dataBuffers).forEach(k => { if (k.startsWith(prefix)) out[k] = dataBuffers[k] })
  return out
}
// dataBuffers 是非响应式的普通对象，系列数用 ref 在渲染时同步
const trendSeriesCount = ref(0)
function selectDevice(id: string) {
  selectedDeviceId.value = id
  // 只渲染当前设备自己的历史缓冲，避免显示上一台设备的数据
  renderTrend()
}
function onDeviceChange() {
  renderTrend()
}

function initTrendChart() {
  if (!trendChartRef.value) return
  trendChart = echarts.init(trendChartRef.value, scadaThemeName())
  // 窗口缩放/侧边栏折叠会改变容器宽度，不 resize 图表会被裁切
  trendResizeObserver = new ResizeObserver(() => {
    if (isUnmounted) return
    const el = trendChartRef.value
    // 趋势区折叠时容器尺寸为 0，跳过（否则 ECharts 会按 0 尺寸重算）
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) return
    trendChart?.resize()
  })
  trendResizeObserver.observe(trendChartRef.value)
}

// 切换深浅主题时重建图表实例（ECharts 不支持运行时换主题）
function initThemeObserver() {
  themeObserver = new MutationObserver(() => {
    if (!trendChart || isUnmounted) return
    trendChart = applyScadaTheme(trendChart, echarts)
    renderTrend()
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}

/**
 * 报警阈值参考线：仅使用后端已下发的报警规则阈值（alarms.threshold）。
 * 寄存器定义中没有上下限字段，故不做任何推测，拿不到就不画。
 */
function getRegisterThreshold(deviceId: string, regName: string): { value: number; level: string; text: string } | null {
  const hit = alarms.value.find(a => a.device_id === deviceId && a.register_name === regName && Number.isFinite(Number(a.threshold)))
  if (!hit) return null
  const lvl = levelKey(hit.alarm_level)
  return { value: Number(hit.threshold), level: lvl, text: `报警阈值(${lvl})` }
}

function updateTrendChart(data: any[] = []) {
  if (!selectedDeviceId.value) return
  const now = new Date().toTimeString().slice(0, 8)
  let matched = 0
  let buffered = 0
  data.forEach((item: any) => {
    if (item.value === null || item.value === undefined) return
    const v = parseFloat(item.value)
    if (!Number.isFinite(v)) return
    // 所有设备都入桶（键含 device_id，不会串台）：卡片迷你趋势需要每台设备自己的历史
    // 仅"当前选中设备"保留完整点数供趋势图使用，其余设备只留 CARD_SPARK_POINTS 个点
    const key = bufferKey(item.device_id, item.register_name)
    if (!dataBuffers[key]) dataBuffers[key] = []
    dataBuffers[key].push({ t: now, v })
    const cap = item.device_id === selectedDeviceId.value ? MAX_CHART_POINTS : CARD_SPARK_POINTS
    while (dataBuffers[key].length > cap) dataBuffers[key].shift()
    if (item.unit) registerUnits[key] = item.unit
    buffered++
    if (item.device_id === selectedDeviceId.value) matched++
  })
  // bufferVersion 变化驱动卡片内联 sparkline 重算（dataBuffers 本身非响应式）
  if (buffered > 0) bufferVersion.value++
  if (matched === 0) return
  renderTrend()
}

function renderTrend() {
  if (!trendChart) return
  const buffers = selectedBuffers()
  const keys = Object.keys(buffers)
  const timeSet = new Set<string>()
  keys.forEach(k => buffers[k].forEach(d => timeSet.add(d.t)))
  const times = Array.from(timeSet).sort().slice(-MAX_CHART_POINTS)
  trendSeriesCount.value = keys.length

  // setOption(..., true) 会重建图例，需显式带回用户已勾选的系列，否则每次刷新开关被重置
  const prevLegend = (trendChart.getOption() as any)?.legend?.[0]?.selected
  const legendSelected = prevLegend && Object.keys(prevLegend).length ? prevLegend : undefined

  // 系列展示名 → 单位（用于 tooltip 的“时间 + 值 + 单位”）
  const unitByName: Record<string, string> = {}
  keys.forEach(k => { unitByName[getShortLabel(k.slice(k.indexOf(':') + 1))] = registerUnits[k] || '' })

  trendChart.setOption({
    legend: { top: 0, right: 0, type: 'scroll', selectedMode: 'multiple', selected: legendSelected },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      formatter: (params: any) => {
        const arr = Array.isArray(params) ? params : [params]
        if (!arr.length) return ''
        const head = `${arr[0].axisValueLabel ?? arr[0].axisValue ?? ''}`
        const rows = arr
          .filter((p: any) => p.value != null && Number.isFinite(Number(p.value)))
          .map((p: any) => {
            const unit = unitByName[p.seriesName]
            return `${p.marker}${p.seriesName}: <b>${Number(p.value).toFixed(2)}</b>${unit ? ' ' + unit : ''}`
          })
        return head + rows.join('<br/>')
      },
    },
    grid: { left: 12, right: 16, top: 32, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: times, boundaryGap: false },
    yAxis: { type: 'value', scale: true },
    series: keys.map(key => {
      const map: Record<string, number> = {}
      buffers[key].forEach(d => { map[d.t] = d.v })
      const regName = key.slice(key.indexOf(':') + 1)
      const unit = registerUnits[key] || ''
      const threshold = getRegisterThreshold(selectedDeviceId.value, regName)
      return {
        name: getShortLabel(regName),
        type: 'line',
        smooth: true,
        symbol: 'none',
        // 颜色由统一主题的色板分配，页面不再自带颜色数组
        data: times.map(t => map[t] ?? null),
        markLine: threshold ? {
          silent: true,
          symbol: 'none',
          data: [{
            yAxis: threshold.value,
            name: threshold.text,
            lineStyle: { color: SCADA_LEVEL_COLORS[threshold.level] || SCADA_LEVEL_COLORS.info, type: 'dashed', width: 1 },
            label: { formatter: `${threshold.text} ${threshold.value}${unit ? ' ' + unit : ''}`, position: 'insideEndTop' },
          }],
        } : undefined,
      }
    }),
  }, true)
}

// ========== CSV 导出（客户端生成） ==========
function exportChartData() {
  const buffers = selectedBuffers()
  const keys = Object.keys(buffers)
  if (!selectedDeviceId.value || !keys.length) { ElMessage.error('无数据可导出'); return }
  const timeSet = new Set<string>()
  keys.forEach(k => buffers[k].forEach(d => timeSet.add(d.t)))
  const times = Array.from(timeSet).sort()
  const escCSV = (v: string) => v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v
  let csv = '﻿时间,' + keys.map(k => escCSV(getShortLabel(k.slice(k.indexOf(':') + 1)))).join(',') + '\n'
  times.forEach(t => {
    csv += escCSV(t) + ',' + keys.map(k => { const d = buffers[k].find(x => x.t === t); return d ? d.v.toFixed(2) : '' }).join(',') + '\n'
  })
  downloadCSV(csv, `trend_${selectedDeviceId.value}_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`)
}

async function exportAllData() {
  try {
    const data = await dataApi.getRealtime() as any
    if (!data?.data?.length) { ElMessage.error('无数据可导出'); return }
    const escCSV = (v: string) => (v.includes(',') || v.includes('"') || v.includes('\n')) ? `"${v.replace(/"/g, '""')}"` : String(v ?? '')
    let csv = '﻿设备ID,寄存器,值,单位,时间\n'
    data.data.forEach((item: any) => {
      csv += `${escCSV(item.device_id)},${escCSV(item.register_name)},${item.value},${escCSV(item.unit||'')},${escCSV(item.timestamp)}\n`
    })
    downloadCSV(csv, `all_devices_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`)
  } catch (e: any) { console.error('[Dashboard] 操作失败:', e); ElMessage.error('导出失败') }
}

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

// ========== WebSocket ==========
function connectSocket() {
  const baseUrl = getWsBaseUrl()
  const token = getAuthToken()
  // token 通过 query 传递 — 后端从 request.args.get('token') 读取
  const socketUrl = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl
  socket = io(socketUrl, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 3000,
    reconnectionAttempts: Infinity,
  })
  socket.on('connect', () => {
    if (isUnmounted) return
    statusDotClass.value = 'status-dot--success'
    statusText.value = '系统运行中'
    // 恢复 5 秒轮询（首次连接与重连都会走这里；socket.io v4 的 'reconnect' 只在 Manager 上触发）
    setPollInterval(5000)
    allDeviceList.value.forEach(d => { const id = getDeviceId(d); if (id) socket?.emit('subscribe', { device_id: id }) })
  })
  socket.on('disconnect', () => {
    if (isUnmounted) return
    statusDotClass.value = 'status-dot--warning'
    statusText.value = '实时连接断开，降级为轮询模式（每2秒刷新）'
    // WebSocket断开时增加轮询频率（从5秒降到2秒）
    setPollInterval(2000)
  })
  socket.on('connect_error', () => {
    if (isUnmounted) return
    statusDotClass.value = 'status-dot--warning'
    statusText.value = '实时连接失败，使用轮询模式'
  })
  socket.on('data_update', (data: any) => {
    if (!data) return
    // 兼容两种格式：单对象 或 {register_name: {device_id, ...}} 映射
    // 注：后端 websocket.py 的推送路径固定发**映射格式**，
    // 单对象分支是给未来的定向推送留的兼容入口。
    if (data.device_id && data.register_name && data.value != null) {
      // 单对象格式
      const k = `${data.device_id}:${data.register_name}`
      deviceValues[k] = parseFloat(data.value)
      const q = normalizeQuality(data.quality)
      if (q != null) deviceQuality[k] = q
    } else {
      // 映射格式：{register_name: {device_id, register_name, value, quality}}
      Object.entries(data).forEach(([regName, info]: [string, any]) => {
        if (!info || typeof info !== 'object') return
        const devId = info.device_id
        const val = info.value
        if (!devId || val == null) return
        const k = `${devId}:${regName}`
        deviceValues[k] = parseFloat(val)
        const q = normalizeQuality(info.quality)
        if (q != null) deviceQuality[k] = q
      })
    }
  })
  socket.on('device_status', (data: any) => {
    if (!data?.device_id) return
    const dev = allDeviceList.value.find(d => getDeviceId(d) === data.device_id)
    if (dev) {
      dev.connected = data.status?.connected ?? dev.connected
      dev.status = data.status?.status ?? dev.status
    }
  })
  socket.on('alarm', (data: any) => {
    if (data?.alarm_id) {
      // 实时插入报警到列表顶部
      alarms.value.unshift(data)
      if (alarms.value.length > 50) alarms.value.pop()
      latestAlarm.value = data
    } else {
      loadData()
    }
  })
}
</script>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  /* 跟随 el-main 的可用高度自适应：不写死 100vh - 60px，不与外层 padding 打架，
     自身不滚动（页面级滚动统一交给 el-main，避免双层滚动条） */
  min-height: 100%;
  background: var(--bg-page);
  color: var(--text-primary);
  font-family: var(--font-sans);
}

/* ==================== KPI 行 ==================== */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: var(--space-2);
  padding: var(--space-3);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-base);
}
.kpi {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-3);
  background: var(--bg-sunken);
  border: 1px solid var(--border-base);
  border-left: 3px solid var(--border-strong);
  border-radius: var(--radius-md);
}
/* 主 KPI 视觉权重更高 */
.kpi--primary {
  background: var(--bg-surface);
  border-left-color: var(--color-brand);
  box-shadow: var(--shadow-sm);
}
.kpi--warn { border-left-color: var(--color-warning); }
.kpi--bad { border-left-color: var(--color-danger); }
.kpi--alarm { border-left-color: var(--level-critical); }
.kpi__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: 20px;
}
.kpi__foot {
  font-size: var(--font-xs);
  color: var(--text-muted);
}

/* 细进度条 + 目标对标线 */
.kpi-bar {
  position: relative;
  height: 6px;
  margin: var(--space-1) 0;
  background: var(--bg-hover);
  border-radius: var(--radius-pill);
}
.kpi-bar__fill {
  height: 100%;
  border-radius: var(--radius-pill);
  transition: width var(--duration-base) var(--ease-out), background-color var(--duration-fast) linear;
}
.kpi-bar__fill--success { background: var(--color-success); }
.kpi-bar__fill--warning { background: var(--color-warning); }
.kpi-bar__fill--danger { background: var(--color-danger); }
.kpi-bar__target {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: var(--text-secondary);
  border-radius: var(--radius-pill);
  transform: translateX(-1px);
}

/* 在线/离线分布条 */
.mini-split {
  display: flex;
  height: 6px;
  margin: var(--space-1) 0;
  border-radius: var(--radius-pill);
  overflow: hidden;
  background: var(--bg-hover);
}
.mini-split__on { background: var(--color-success); transition: width var(--duration-base) var(--ease-out); }
.mini-split__off { background: var(--color-offline); transition: width var(--duration-base) var(--ease-out); }

/* 采集吞吐迷你 sparkline */
.spark {
  display: block;
  width: 100%;
  height: 28px;
}
.spark__line {
  fill: none;
  stroke: var(--chart-1);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.spark__area {
  fill: var(--chart-1);
  opacity: 0.12;
  stroke: none;
}
/* 设备卡内的迷你趋势（复用同一套 spark 样式，仅尺寸更小） */
.spark--mini {
  flex: none;
  width: 36px;
  height: 14px;
}

/* 活动报警等级分段条 */
.alarm-seg {
  display: flex;
  height: 8px;
  margin: var(--space-1) 0;
  border-radius: var(--radius-pill);
  overflow: hidden;
  background: var(--bg-hover);
}
.alarm-seg__item { height: 100%; transition: width var(--duration-base) var(--ease-out); }
.seg--critical { background: var(--level-critical); }
.seg--warning { background: var(--level-warning); }
.seg--info { background: var(--level-info); }
.alarm-seg__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
}
.alarm-seg__lg {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-xs);
  color: var(--text-muted);
}
.alarm-seg__dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: var(--radius-pill);
}

/* ==================== 报警横幅 ==================== */
.alarm-banner {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  border-bottom: 1px solid var(--border-base);
  cursor: pointer;
}
.alarm-banner--critical { background: var(--color-danger-soft); }
.alarm-banner--warning { background: var(--color-warning-soft); }
.alarm-banner--info { background: var(--color-info-soft); }
.alarm-banner .level-bar { min-height: 20px; }
.banner-text {
  flex: 1;
  min-width: 0;
  font-size: var(--font-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.banner-close {
  padding: 0 var(--space-1);
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: var(--font-lg);
  line-height: 1;
  cursor: pointer;
}
.banner-close:hover { color: var(--text-primary); }

/* ==================== 主区域：设备优先 ==================== */
.main-area {
  display: grid;
  grid-template-columns: 2.2fr 1fr;
  /* 行高锁定为容器高度：设备网格再长也不会把整行撑高、把卡片挤出可视区 */
  grid-template-rows: minmax(0, 1fr);
  gap: var(--space-3);
  /* 弹性高度（相对视口的 clamp，不是"100vh 减顶栏"）：
     给小窗口一个确定的高度基准，设备区/报警区各自内部滚动，趋势区不被推走。
     flex 只允许向上撑满（grow）不允许被压缩（shrink 0），保证设备卡始终有可见高度 */
  height: clamp(340px, 52vh, 620px);
  min-height: clamp(320px, 46vh, 560px);
  flex: 1 0 auto;
  padding: var(--space-3);
}
/* 折叠趋势区后把高度让给设备区（小屏看设备卡的关键路径） */
.dashboard--trend-collapsed .main-area {
  height: clamp(420px, 74vh, 900px);
  min-height: clamp(400px, 68vh, 860px);
}
.device-panel,
.alarm-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

/* 筛选栏 */
.dev-filter-bar {
  flex-wrap: wrap;
  padding: var(--space-2) var(--space-3);
}
.dev-filter-tabs { display: flex; gap: var(--space-1); flex-wrap: wrap; }
.dev-tab {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--font-xs);
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
}
.dev-tab:hover { border-color: var(--color-brand); color: var(--color-brand); }
.dev-tab.active {
  background: var(--color-brand);
  border-color: var(--color-brand);
  color: var(--text-inverse);
}
.dev-filter-right { display: flex; align-items: center; gap: var(--space-2); }
.dev-proto-select {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: var(--font-xs);
}
.dev-count-badge {
  padding: 2px var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--bg-hover);
  color: var(--text-muted);
  font-size: var(--font-xs);
}

/* 设备网格 */
.device-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(268px, 1fr));
  /* 行高必须显式 max-content：卡片 overflow:hidden 会把"自动最小行高"算成 0，
     容器高度不足时行会停在卡片 min-height 上、把内容裁掉（实测被裁到 96px） */
  grid-auto-rows: max-content;
  align-content: start;
  gap: var(--space-3);
  padding: var(--space-3);
  /* flex 链路上的明确可见高度：占满设备区剩余空间，并允许内部滚动（min-height:0 防塌陷） */
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
.device-grid--skeleton { pointer-events: none; }
.dev-card {
  position: relative;
  display: flex;
  align-items: stretch;
  min-height: 96px;
  overflow: hidden;
  background: var(--bg-surface);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out);
}
/* 有活动报警的卡片：整卡描边强调，配合置顶排序 */
.dev-card--alarm { border-color: var(--color-warning); }
.dev-card:hover { border-color: var(--color-brand); box-shadow: var(--shadow-sm); }
.dev-card--expanded { border-color: var(--color-brand); box-shadow: var(--shadow-md); }
.dev-status { width: 4px; flex: none; }
.dev-status.online { background: var(--color-success); }
.dev-status.stopped { background: var(--color-info); }
.dev-status.warning { background: var(--color-warning); }
.dev-status.fault { background: var(--color-danger); }
.dev-status.offline { background: var(--color-offline); }
.dev-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1;
  min-width: 0;
  padding: var(--space-3);
}
.dev-name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--font-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
}
.dev-name__text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 次行：协议 · 地址 · 点位数 */
.dev-meta {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-wrap: wrap;
  min-width: 0;
  font-size: var(--font-xs);
  color: var(--text-muted);
}
.dev-meta__sep { color: var(--text-disabled); }
.dev-meta__addr {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 第三行：关键值 + 迷你趋势 + 相对量程条 */
.dev-kv {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: var(--space-2);
  margin-top: var(--space-1);
}
.kv { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
/* 只有一个关键点时占满整行 */
.kv:only-child { grid-column: 1 / -1; }
.kv__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-1);
  min-width: 0;
}
.kv__label {
  font-size: var(--font-xs);
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kv__trend-none { flex: none; font-size: var(--font-xs); color: var(--text-disabled); }
.kv__value { display: flex; align-items: baseline; gap: var(--space-1); min-width: 0; }
.kv__num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--font-xl);
  font-weight: var(--weight-semibold);
  line-height: var(--leading-tight);
  white-space: nowrap;
  transition: color var(--duration-fast) linear;
}
.kv--primary .kv__num { font-size: var(--font-2xl); }
.kv__unit { font-size: var(--font-xs); font-weight: var(--weight-normal); color: var(--text-muted); }
/* 相对量程/阈值位置条（4px 细条，语义色只在越限时出现） */
.dev-bar {
  height: 4px;
  margin-top: 2px;
  border-radius: var(--radius-pill);
  background: var(--bg-hover);
  overflow: hidden;
}
.dev-bar--none { background: transparent; }
.dev-bar__fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--color-brand);
  transition: width var(--duration-base) var(--ease-out), background-color var(--duration-fast) linear;
}
.dev-bar__fill.dev-bar--warning { background: var(--color-warning); }
.dev-bar__fill.dev-bar--danger { background: var(--color-danger); }
.dev-expand {
  align-self: center;
  flex: none;
  padding-right: var(--space-2);
  color: var(--text-muted);
  font-size: var(--font-xs);
}
/* 就地展开：全部点位 */
.dev-detail {
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--border-base);
  cursor: default;
}
.dev-detail__head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
  font-size: var(--font-xs);
  color: var(--text-muted);
}
.dev-detail__title { flex: none; font-weight: var(--weight-semibold); color: var(--text-secondary); }
.dev-detail__desc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dev-detail__hint { flex: none; margin-left: auto; color: var(--text-disabled); }
.dev-detail__rows {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: var(--space-1);
  max-height: 176px;
  overflow-y: auto;
}
.dev-row {
  display: grid;
  grid-template-columns: 1fr 68px 44px 56px;
  align-items: center;
  gap: var(--space-2);
  padding: 2px 0;
  font-size: var(--font-xs);
}
.dev-row__label { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dev-row__num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--font-sm);
  font-weight: var(--weight-semibold);
  text-align: right;
}
.dev-row__unit { color: var(--text-muted); }
.dev-row__bar {
  display: block;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--bg-hover);
  overflow: hidden;
}
.dev-row__bar--none { background: transparent; }
.quality-dot { width: 8px; height: 8px; border-radius: var(--radius-pill); align-self: center; flex: none; }
.quality-dot--good { background: var(--color-success); }
.quality-dot--uncertain { background: var(--color-warning); }
.quality-dot--bad { background: var(--color-danger); }
.quality-dot--unknown { background: var(--color-offline); }
.dev-ctrl-btn {
  align-self: center;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-right: var(--space-3);
  border: 2px solid;
  border-radius: var(--radius-pill);
  background: transparent;
  font-size: var(--font-xs);
  cursor: pointer;
}
.dev-ctrl-btn.start { border-color: var(--color-success); color: var(--color-success); }
.dev-ctrl-btn.stop { border-color: var(--color-danger); color: var(--color-danger); }
.grid-empty { grid-column: 1 / -1; padding: var(--space-4) 0; }

/* 设备区加载失败（可见 + 可重试） */
.dev-state {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin: var(--space-3) var(--space-3) 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-danger);
  border-left-width: 3px;
  border-radius: var(--radius-sm);
  background: var(--color-danger-soft);
  font-size: var(--font-xs);
}
.dev-state--solo {
  flex: 1;
  margin-bottom: var(--space-3);
  align-content: center;
  justify-content: center;
}
.dev-state__title { font-weight: var(--weight-semibold); color: var(--color-danger); }
.dev-state__reason {
  max-width: 46ch;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dev-state__retry {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--color-danger);
  font-size: var(--font-xs);
  cursor: pointer;
}
.dev-state__retry:hover { background: var(--color-danger); color: var(--text-inverse); }
.dev-state__note { color: var(--text-muted); }

/* 首屏骨架屏（与"真的没有设备"区分） */
.dev-card--skeleton {
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-3);
  min-height: 96px;
  cursor: default;
}
.dev-skel {
  display: block;
  height: 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-hover);
}
.dev-skel--title { width: 62%; }
.dev-skel--meta { width: 42%; }
.dev-skel--value { width: 78%; height: 22px; }
@media (prefers-reduced-motion: no-preference) {
  .dev-card--skeleton .dev-skel { animation: skel-pulse 1.4s ease-in-out infinite; }
}
@keyframes skel-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

/* 分页 */
.dev-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--border-base);
  background: var(--bg-sunken);
}
.pager-btn {
  min-width: 28px;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--font-xs);
  cursor: pointer;
}
.pager-btn:hover:not(:disabled) { border-color: var(--color-brand); color: var(--color-brand); }
.pager-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pager-info { font-size: var(--font-xs); color: var(--text-muted); }

/* ==================== 报警面板 ==================== */
.alarm-header { padding: var(--space-2) var(--space-3); font-size: var(--font-sm); }
.alarm-badges { display: flex; gap: var(--space-1); flex-wrap: wrap; }
.alarm-list { flex: 1; min-height: 0; overflow-y: auto; padding: var(--space-1); }
.alarm-empty { padding: var(--space-4) var(--space-2); }
.alarm-row {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
}
.alarm-row:hover { background: var(--bg-hover); }
.alarm-row__main {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  flex: 1;
  min-width: 0;
}
.alarm-row__line1 {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.alarm-row__device {
  min-width: 0;
  font-size: var(--font-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.alarm-row__prio {
  flex: none;
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  font-size: var(--font-xs);
  font-weight: var(--weight-semibold);
}
.alarm-row__prio--critical { background: var(--color-danger-soft); color: var(--color-danger); }
.alarm-row__prio--warning { background: var(--color-warning-soft); color: var(--color-warning); }
.alarm-row__prio--info { background: var(--color-info-soft); color: var(--color-info); }
.alarm-row__time {
  flex: none;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--font-xs);
  color: var(--text-muted);
}
.alarm-row__count { flex: none; font-size: var(--font-xs); color: var(--text-muted); }
.alarm-row__ack {
  margin-left: auto;
  flex: none;
  padding: 2px var(--space-2);
  border: 1px solid var(--color-brand);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-brand);
  font-size: var(--font-xs);
  cursor: pointer;
}
.alarm-row__ack:hover { background: var(--color-brand); color: var(--text-inverse); }
.alarm-row__acked { margin-left: auto; flex: none; }
.alarm-row__line2 {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}
.alarm-row__msg {
  flex: 1;
  min-width: 0;
  font-size: var(--font-sm);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.alarm-row__pv {
  flex: none;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--font-sm);
  font-weight: var(--weight-semibold);
  color: var(--color-brand);
}

/* ==================== 趋势区 ==================== */
.trend-area { margin: 0 var(--space-3) var(--space-3); }
.trend-header { padding: var(--space-2) var(--space-4); }
.trend-title { font-size: var(--font-sm); }
.trend-tools { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
.trend-select {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-primary);
  font-size: var(--font-xs);
}
.trend-btn {
  padding: var(--space-1) var(--space-3);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: var(--font-xs);
  cursor: pointer;
}
.trend-btn:hover { border-color: var(--color-brand); color: var(--color-brand); }
.trend-btn--toggle { border-color: var(--color-brand); color: var(--color-brand); }
.trend-chart { height: 280px; }
/* 折叠态：隐藏图表容器（v-show），面板只保留标题行 */
.trend-area--collapsed { margin-bottom: var(--space-3); }

/* ==================== 状态栏 ==================== */
.status-bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-top: 1px solid var(--border-base);
  background: var(--bg-sunken);
  color: var(--text-muted);
  font-size: var(--font-xs);
}
.status-db { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.status-right { margin-left: auto; display: flex; gap: var(--space-3); }
.status-link { color: var(--color-brand); font-size: var(--font-xs); text-decoration: none; }
.status-link:hover { text-decoration: underline; }
</style>
