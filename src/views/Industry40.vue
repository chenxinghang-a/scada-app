<template>
  <div class="industry40">
    <el-tabs v-model="activeTab" @tab-change="onTabChange" type="border-card">
      <!-- 总览 -->
      <el-tab-pane label="总览" name="overview">
        <el-row :gutter="12" class="metric-row">
          <el-col :span="6"><div class="metric-box"><div class="metric-label">平均健康评分</div><div class="metric-value" :style="{color:healthColor(overview.health)}">{{ overview.health }}%</div></div></el-col>
          <el-col :span="6"><div class="metric-box"><div class="metric-label">平均 OEE</div><div class="metric-value" :style="{color:oeeColor(overview.oee)}">{{ overview.oee }}%</div></div></el-col>
          <el-col :span="6"><div class="metric-box"><div class="metric-label">总功率</div><div class="metric-value">{{ overview.power }} kW</div></div></el-col>
          <el-col :span="6"><div class="metric-box"><div class="metric-label">碳排放</div><div class="metric-value">{{ overview.carbon }} kg</div></div></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="16">
            <el-card shadow="hover"><div ref="processFlowRef" class="process-flow"></div></el-card>
          </el-col>
          <el-col :span="8">
            <el-card shadow="hover" header="维护建议">
              <div class="alert-list">
                <div v-for="(a,i) in overview.alerts" :key="i" class="alert-item" :class="'sev-'+a.severity">
                  <span class="alert-sev">{{ a.severity }}</span>
                  <span class="alert-msg">{{ a.message || a.device_id }}</span>
                </div>
                <el-empty v-if="!overview.alerts.length" description="暂无建议" :image-size="60" />
              </div>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- 预测性维护 -->
      <el-tab-pane label="预测维护" name="predictive">
        <el-row :gutter="12">
          <el-col :span="16">
            <el-card shadow="hover" header="设备健康评分">
              <el-table :data="healthScores" stripe size="small" max-height="500">
                <el-table-column prop="device_id" label="设备" width="160" />
                <el-table-column prop="register_name" label="寄存器" width="140" />
                <el-table-column label="健康评分" width="100">
                  <template #default="{row}">
                    <span :style="{color:healthColor(row.health_score),fontWeight:700}">{{ row.health_score }}%</span>
                  </template>
                </el-table-column>
                <el-table-column label="趋势" width="70">
                  <template #default="{row}">{{ trendArrow(row.trend) }}</template>
                </el-table-column>
                <el-table-column prop="anomaly_count" label="异常数" width="70" />
                <el-table-column label="故障预测" width="100">
                  <template #default="{row}">{{ row.failure_prediction?.days_to_limit != null ? row.failure_prediction.days_to_limit+'天' : '-' }}</template>
                </el-table-column>
                <el-table-column prop="updated_at" label="更新时间" />
              </el-table>
            </el-card>
          </el-col>
          <el-col :span="8">
            <el-card shadow="hover" header="维护建议">
              <div class="alert-list">
                <div v-for="(a,i) in maintenanceAlerts" :key="i" class="alert-item" :class="'sev-'+a.severity">
                  <span class="alert-sev">{{ a.severity }}</span>
                  <span class="alert-msg">{{ a.message || a.device_id }}</span>
                </div>
                <el-empty v-if="!maintenanceAlerts.length" description="暂无建议" :image-size="60" />
              </div>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- OEE -->
      <el-tab-pane label="OEE效率" name="oee">
        <el-row :gutter="12">
          <el-col :span="8">
            <el-card shadow="hover"><div ref="oeeGaugeRef" class="chart-box"></div></el-card>
          </el-col>
          <el-col :span="16">
            <el-card shadow="hover"><div ref="oeeCompareRef" class="chart-box"></div></el-card>
          </el-col>
        </el-row>
        <el-card shadow="hover" header="OEE明细" style="margin-top:12px">
          <el-table :data="oeeRecords" stripe size="small">
            <el-table-column prop="device_id" label="设备" width="160" />
            <el-table-column label="可用率A" width="90"><template #default="{row}">{{ (row.availability*100).toFixed(1) }}%</template></el-table-column>
            <el-table-column label="性能率P" width="90"><template #default="{row}">{{ (row.performance*100).toFixed(1) }}%</template></el-table-column>
            <el-table-column label="质量率Q" width="90"><template #default="{row}">{{ (row.quality*100).toFixed(1) }}%</template></el-table-column>
            <el-table-column label="OEE" width="80"><template #default="{row}"><span :style="{color:oeeColor(row.oee_percent),fontWeight:700}">{{ row.oee_percent }}%</span></template></el-table-column>
            <el-table-column prop="grade" label="等级" width="60" />
            <el-table-column prop="total_production" label="总产量" />
            <el-table-column prop="good_production" label="合格品" />
          </el-table>
        </el-card>
      </el-tab-pane>

      <!-- SPC -->
      <el-tab-pane label="SPC过程控制" name="spc">
        <el-card shadow="hover">
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <el-select v-model="spc.deviceId" placeholder="选择设备" size="small" style="width:200px" @change="onSpcDeviceChange">
              <el-option v-for="d in deviceList" :key="d.device_id" :label="d.name||d.device_id" :value="d.device_id" />
            </el-select>
            <el-select v-model="spc.registerName" placeholder="选择寄存器" size="small" style="width:160px">
              <el-option v-for="r in spc.registers" :key="r" :label="r" :value="r" />
            </el-select>
            <el-button type="primary" size="small" @click="loadSPC" :disabled="!spc.deviceId||!spc.registerName">查看</el-button>
          </div>
          <el-row :gutter="12">
            <el-col :span="12"><div ref="spcXbarRef" class="chart-box"></div></el-col>
            <el-col :span="12"><div ref="spcRRef" class="chart-box"></div></el-col>
          </el-row>
          <el-row :gutter="12" style="margin-top:12px">
            <el-col :span="12">
              <el-card shadow="hover" header="过程能力指数">
                <div class="cap-grid" v-if="spc.capability">
                  <div class="cap-item"><span class="cap-label">Cp</span><span class="cap-val">{{ spc.capability.cp }}</span></div>
                  <div class="cap-item"><span class="cap-label">Cpk</span><span class="cap-val">{{ spc.capability.cpk }}</span></div>
                  <div class="cap-item"><span class="cap-label">Pp</span><span class="cap-val">{{ spc.capability.pp }}</span></div>
                  <div class="cap-item"><span class="cap-label">Ppk</span><span class="cap-val">{{ spc.capability.ppk }}</span></div>
                </div>
                <el-empty v-else description="请选择设备和寄存器" :image-size="40" />
              </el-card>
            </el-col>
            <el-col :span="12">
              <el-card shadow="hover" header="判异规则检测">
                <div class="violation-list">
                  <div v-for="(v,i) in spc.violations" :key="i" class="violation-item">
                    <span class="v-rule">{{ v.rule }}</span>
                    <span class="v-dev">{{ v.device_id }}</span>
                    <span class="v-time">{{ v.timestamp }}</span>
                  </div>
                  <el-empty v-if="!spc.violations.length" description="无判异" :image-size="40" />
                </div>
              </el-card>
            </el-col>
          </el-row>
        </el-card>
      </el-tab-pane>

      <!-- 能源 -->
      <el-tab-pane label="能源管理" name="energy">
        <el-row :gutter="12" class="metric-row">
          <el-col :span="6"><div class="metric-box"><div class="metric-label">总用电</div><div class="metric-value">{{ energy.total_kwh }} kWh</div></div></el-col>
          <el-col :span="6"><div class="metric-box"><div class="metric-label">电费</div><div class="metric-value">¥{{ energy.total_cost }}</div></div></el-col>
          <el-col :span="6"><div class="metric-box"><div class="metric-label">碳排放</div><div class="metric-value">{{ energy.carbon_kg }} kg</div></div></el-col>
          <el-col :span="6"><div class="metric-box"><div class="metric-label">等效树木</div><div class="metric-value">{{ energy.equivalent_trees }} 棵</div></div></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12"><el-card shadow="hover"><div ref="energyPieRef" class="chart-box"></div></el-card></el-col>
          <el-col :span="12"><el-card shadow="hover"><div ref="powerBarRef" class="chart-box"></div></el-card></el-col>
        </el-row>
      </el-tab-pane>

      <!-- 边缘决策 -->
      <el-tab-pane label="边缘决策" name="edge">
        <el-row :gutter="12" class="metric-row">
          <el-col :span="8"><div class="metric-box"><div class="metric-label">决策规则</div><div class="metric-value">{{ edgeStatus.rules_count }}</div></div></el-col>
          <el-col :span="8"><div class="metric-box"><div class="metric-label">安全联锁</div><div class="metric-value">{{ edgeStatus.interlocks_count }}</div></div></el-col>
          <el-col :span="8"><div class="metric-box"><div class="metric-label">PID控制器</div><div class="metric-value">{{ edgeStatus.pid_controllers }}</div></div></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="14">
            <el-card shadow="hover" header="规则列表">
              <el-table :data="edgeRules" stripe size="small" max-height="400">
                <el-table-column prop="rule_id" label="规则ID" width="140" />
                <el-table-column prop="name" label="名称" />
                <el-table-column prop="type" label="类型" width="80" />
                <el-table-column prop="trigger_count" label="触发次数" width="90" />
                <el-table-column label="状态" width="80">
                  <template #default="{row}"><el-tag :type="row.enabled?'success':'danger'" size="small">{{ row.enabled?'启用':'禁用' }}</el-tag></template>
                </el-table-column>
              </el-table>
            </el-card>
          </el-col>
          <el-col :span="10">
            <el-card shadow="hover" header="决策日志">
              <div class="log-list">
                <div v-for="(l,i) in edgeLog" :key="i" class="log-item">
                  <span class="log-type">{{ l.rule_type }}</span>
                  <span class="log-rule">{{ l.rule_id }}</span>
                  <span class="log-result">{{ l.result }}</span>
                  <span class="log-time">{{ l.timestamp }}</span>
                </div>
                <el-empty v-if="!edgeLog.length" description="暂无日志" :image-size="40" />
              </div>
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>

      <!-- 数字孪生 -->
      <el-tab-pane label="数字孪生" name="twin">
        <el-row :gutter="12" class="metric-row">
          <el-col :span="6"><div class="metric-box"><div class="metric-label">设备总数</div><div class="metric-value">{{ twinDevices.length }}</div></div></el-col>
          <el-col :span="6"><div class="metric-box"><div class="metric-label">运行中</div><div class="metric-value" style="color:#22c55e">{{ twinDevices.filter(d=>d.connected).length }}</div></div></el-col>
          <el-col :span="6"><div class="metric-box"><div class="metric-label">故障设备</div><div class="metric-value" style="color:#ef4444">{{ twinDevices.filter(d=>d.status==='fault').length }}</div></div></el-col>
          <el-col :span="6"><div class="metric-box"><div class="metric-label">平均健康分</div><div class="metric-value">{{ twinAvgHealth }}</div></div></el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="16">
            <el-card shadow="hover">
              <div ref="twinFloorRef" class="twin-floor">
                <svg class="twin-links" v-if="twinDevices.length">
                  <line v-for="(c,i) in twinConnections" :key="i"
                    :x1="c.x1" :y1="c.y1" :x2="c.x2" :y2="c.y2"
                    stroke="#4f46e5" stroke-width="2" stroke-dasharray="6 4" opacity="0.5" />
                </svg>
                <div v-for="d in twinDevices" :key="d.device_id"
                  class="twin-node" :class="'status-'+(d.status||'offline')"
                  :style="{left:d.x+'px',top:d.y+'px'}"
                  @click="selectTwinDevice(d)">
                  <div class="node-icon">{{ d.icon }}</div>
                  <div class="node-name">{{ d.name }}</div>
                </div>
              </div>
            </el-card>
          </el-col>
          <el-col :span="8">
            <el-card shadow="hover" header="设备详情">
              <div v-if="twinSelected" class="twin-detail">
                <div class="detail-name">{{ twinSelected.name }}</div>
                <div class="detail-row"><span>工艺类型</span><span>{{ twinSelected.process_type }}</span></div>
                <div class="detail-row"><span>健康评分</span><span :style="{color:healthColor(twinSelected.health_score)}">{{ twinSelected.health_score }}%</span></div>
                <div class="detail-row"><span>OEE</span><span :style="{color:oeeColor(twinSelected.oee)}">{{ twinSelected.oee }}%</span></div>
                <div class="detail-row"><span>功率</span><span>{{ twinSelected.power }} kW</span></div>
              </div>
              <el-empty v-else description="点击设备查看详情" :image-size="60" />
            </el-card>
          </el-col>
        </el-row>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import * as echarts from 'echarts'
import { industry40Api, type OEERecord, type HealthScore, type EdgeStatus, type EdgeRule } from '@/api'
import { devicesApi } from '@/api'

// ========== 状态 ==========
const activeTab = ref('overview')
let refreshTimer: ReturnType<typeof setInterval>

// 总览
const overview = reactive({ health: 0, oee: 0, power: 0, carbon: 0, alerts: [] as any[] })

// 预测维护
const healthScores = ref<HealthScore[]>([])
const maintenanceAlerts = ref<any[]>([])

// OEE
const oeeRecords = ref<OEERecord[]>([])

// SPC
const spc = reactive({ deviceId: '', registerName: '', registers: [] as string[], capability: null as any, violations: [] as any[] })

// 能源
const energy = reactive({ total_kwh: 0 as number | string, total_cost: 0 as number | string, carbon_kg: 0 as number | string, equivalent_trees: 0 as number | string, peak_kwh: 0, flat_kwh: 0, valley_kwh: 0 })

// 边缘决策
const edgeStatus = reactive<EdgeStatus>({ rules_count: 0, interlocks_count: 0, pid_controllers: 0 })
const edgeRules = ref<any[]>([])
const edgeLog = ref<any[]>([])

// 数字孪生
const twinDevices = ref<any[]>([])
const twinSelected = ref<any>(null)
const twinAvgHealth = computed(() => {
  const scores = twinDevices.value.filter(d => d.health_score != null).map(d => d.health_score)
  return scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '-'
})

// 设备列表
const deviceList = ref<any[]>([])

// ECharts refs
const processFlowRef = ref<HTMLElement>()
const oeeGaugeRef = ref<HTMLElement>()
const oeeCompareRef = ref<HTMLElement>()
const spcXbarRef = ref<HTMLElement>()
const spcRRef = ref<HTMLElement>()
const energyPieRef = ref<HTMLElement>()
const powerBarRef = ref<HTMLElement>()
const twinFloorRef = ref<HTMLElement>()

let charts: Record<string, echarts.ECharts> = {}

// 数字孪生设备映射
const TWIN_MAP: Record<string, any> = {
  siemens_1500_01: { x: 100, y: 60, icon: '🔥', name: '锅炉产线', process_type: '热处理', temp: [200, 800], pressure: [0.5, 2.0] },
  hollysys_lk_01: { x: 300, y: 60, icon: '⚗️', name: '化工车间', process_type: '化学反应', temp: [30, 150], pressure: [0.1, 1.5] },
  mitsubishi_fx5u_01: { x: 500, y: 60, icon: '🏭', name: '注塑车间', process_type: '注塑成型', temp: [150, 300], pressure: [5, 20] },
  delta_dvp_01: { x: 100, y: 220, icon: '📦', name: '包装线', process_type: '包装封装', temp: [15, 35], pressure: [0, 0] },
  inovance_h5u_01: { x: 300, y: 220, icon: '🎨', name: '涂装车间', process_type: '喷涂烘干', temp: [40, 200], pressure: [0.2, 0.8] },
  schneider_m340_01: { x: 500, y: 220, icon: '⚡', name: '配电系统', process_type: '电力分配', temp: [20, 45], pressure: [0, 0] },
  abb_m4m_01: { x: 700, y: 140, icon: '📊', name: '电力监测', process_type: '电力监控', temp: [20, 40], pressure: [0, 0] },
}

const twinConnections = computed(() => {
  const devs = twinDevices.value
  if (devs.length < 2) return []
  // 动态连线：相邻设备依次连接，形成产线拓扑
  const conns: {x1:number;y1:number;x2:number;y2:number}[] = []
  for (let i = 0; i < devs.length - 1; i++) {
    conns.push({ x1: devs[i].x + 40, y1: devs[i].y + 40, x2: devs[i+1].x + 40, y2: devs[i+1].y + 40 })
  }
  // 首尾相连形成环形拓扑（如果设备数 >= 3）
  if (devs.length >= 3) {
    const last = devs[devs.length - 1]
    conns.push({ x1: last.x + 40, y1: last.y + 40, x2: devs[0].x + 40, y2: devs[0].y + 40 })
  }
  return conns
})

// ========== 工具函数 ==========
function healthColor(v: number) { return v >= 80 ? '#22c55e' : v >= 60 ? '#84cc16' : v >= 40 ? '#f59e0b' : '#ef4444' }
function oeeColor(v: number) { return v >= 85 ? '#22c55e' : v >= 65 ? '#f59e0b' : '#ef4444' }
function trendArrow(t: string) { return t === 'rising' ? '↑' : t === 'falling' ? '↓' : '→' }

// ========== 数据加载 ==========
async function loadOverview() {
  try {
    const data = await industry40Api.getOverview()
    overview.health = data?.predictive_maintenance?.avg_health_score?.toFixed(1) || 0
    overview.oee = data?.oee?.avg_oee_percent?.toFixed(1) || 0
    overview.power = data?.energy?.total_power_kw?.toFixed(1) || 0
    overview.carbon = data?.energy?.carbon_emission_kg?.toFixed(1) || 0
    overview.alerts = data?.alerts || []
    renderProcessFlow(data)
  } catch { /* ignore */ }
}

function renderProcessFlow(data: any) {
  if (!processFlowRef.value) return
  if (!charts.processFlow) charts.processFlow = echarts.init(processFlowRef.value)
  const devices = data?.device_statuses || data?.devices || []
  const nodes = devices.map((d: any, i: number) => ({
    name: d.device_id || d.name || `设备${i+1}`,
    x: (i % 4) * 160 + 80,
    y: Math.floor(i / 4) * 120 + 60,
    symbolSize: 50,
    itemStyle: { color: d.connected ? '#22c55e' : d.status === 'fault' ? '#ef4444' : '#f59e0b' },
    label: { show: true, position: 'bottom', fontSize: 10, color: '#333' },
  }))
  const links = nodes.slice(1).map((_: any, i: number) => ({ source: nodes[i].name, target: nodes[i+1].name }))
  charts.processFlow.setOption({
    tooltip: { trigger: 'item' },
    series: [{
      type: 'graph', layout: 'none', roam: true,
      data: nodes, links,
      lineStyle: { color: '#4f46e5', curveness: 0.1 },
      emphasis: { focus: 'adjacency' },
    }],
  })
}

async function loadPredictive() {
  try {
    const [h, a] = await Promise.all([industry40Api.getHealthScores(), industry40Api.getMaintenanceAlerts()])
    healthScores.value = h?.health_scores || []
    maintenanceAlerts.value = a?.alerts || []
  } catch { /* ignore */ }
}

async function loadOEE() {
  try {
    const data = await industry40Api.getOEE()
    oeeRecords.value = data?.devices || []
    renderOEECharts()
  } catch { /* ignore */ }
}

function renderOEECharts() {
  const devices = oeeRecords.value
  if (!devices.length) return
  const avgOEE = devices.reduce((s, d) => s + d.oee_percent, 0) / devices.length

  // 仪表盘
  if (oeeGaugeRef.value) {
    if (!charts.oeeGauge) charts.oeeGauge = echarts.init(oeeGaugeRef.value)
    charts.oeeGauge.setOption({
      series: [{
        type: 'gauge', startAngle: 200, endAngle: -20, min: 0, max: 100,
        axisLine: { lineStyle: { width: 20, color: [[0.5, '#ff4444'], [0.65, '#ffaa00'], [0.85, '#a0d911'], [1, '#22c55e']] } },
        pointer: { itemStyle: { color: '#4f46e5' } },
        detail: { valueAnimation: true, formatter: '{value}%', fontSize: 24, color: '#1a1a2e' },
        data: [{ value: avgOEE.toFixed(1) }],
      }],
    })
  }

  // 对比柱状图
  if (oeeCompareRef.value) {
    if (!charts.oeeCompare) charts.oeeCompare = echarts.init(oeeCompareRef.value)
    charts.oeeCompare.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: devices.map(d => d.device_id), axisLabel: { rotate: 30, fontSize: 10 } },
      yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
      series: [{
        type: 'bar', barWidth: '40%',
        data: devices.map(d => ({
          value: d.oee_percent,
          itemStyle: { color: d.oee_percent >= 85 ? '#22c55e' : d.oee_percent >= 65 ? '#f59e0b' : '#ef4444' },
        })),
        label: { show: true, position: 'top', formatter: '{c}%', fontSize: 10 },
      }],
    })
  }
}

async function loadSPC() {
  if (!spc.deviceId || !spc.registerName) return
  try {
    const [chart, v] = await Promise.all([
      industry40Api.getSPC(spc.deviceId, spc.registerName),
      industry40Api.getSPCViolations(spc.deviceId),
    ])
    spc.capability = chart?.chart_data?.capability || null
    spc.violations = v?.violations || []
    renderSPCCharts(chart?.chart_data)
  } catch { /* ignore */ }
}

function renderSPCCharts(data: any) {
  if (!data) return
  const opts = (title: string, vals: number[], ucl: number, cl: number, lcl: number) => ({
    title: { text: title, left: 'center', textStyle: { fontSize: 13 } },
    tooltip: { trigger: 'axis' },
    xAxis: { type: 'category', data: data.points?.map((_: any, i: number) => i + 1) || [] },
    yAxis: { type: 'value' },
    series: [{
      type: 'line', data: vals, smooth: true, symbol: 'none', lineStyle: { color: '#4f46e5', width: 2 },
      markLine: { silent: true, data: [
        { yAxis: ucl, lineStyle: { color: '#ef4444', type: 'dashed' }, label: { formatter: 'UCL' } },
        { yAxis: cl, lineStyle: { color: '#22c55e' }, label: { formatter: 'CL' } },
        { yAxis: lcl, lineStyle: { color: '#ef4444', type: 'dashed' }, label: { formatter: 'LCL' } },
      ]},
    }],
  })

  if (spcXbarRef.value) {
    if (!charts.spcXbar) charts.spcXbar = echarts.init(spcXbarRef.value)
    charts.spcXbar.setOption(opts('X-bar 控制图', data.values || [], data.ucl, data.cl, data.lcl), true)
  }
  if (spcRRef.value) {
    if (!charts.spcR) charts.spcR = echarts.init(spcRRef.value)
    charts.spcR.setOption(opts('R 控制图', data.values || [], data.ucl, data.cl, data.lcl), true)
  }
}

async function loadEnergy() {
  try {
    const [e, c, p] = await Promise.all([
      industry40Api.getEnergy(), industry40Api.getEnergyCost(), industry40Api.getEnergyPower(),
    ])
    const s = e?.summary || {}
    energy.total_kwh = s.total_kwh?.toFixed(1) || 0
    energy.total_cost = s.total_cost?.toFixed(0) || 0
    energy.carbon_kg = s.carbon_kg?.toFixed(1) || 0
    energy.equivalent_trees = s.equivalent_trees?.toFixed(0) || 0
    energy.peak_kwh = s.peak_kwh || 0
    energy.flat_kwh = s.flat_kwh || 0
    energy.valley_kwh = s.valley_kwh || 0
    renderEnergyCharts()
  } catch { /* ignore */ }
}

function renderEnergyCharts() {
  if (energyPieRef.value) {
    if (!charts.energyPie) charts.energyPie = echarts.init(energyPieRef.value)
    charts.energyPie.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} kWh ({d}%)' },
      series: [{
        type: 'pie', radius: ['40%', '70%'],
        data: [
          { value: energy.peak_kwh, name: '峰时', itemStyle: { color: '#ef4444' } },
          { value: energy.flat_kwh, name: '平时', itemStyle: { color: '#f59e0b' } },
          { value: energy.valley_kwh, name: '谷时', itemStyle: { color: '#22c55e' } },
        ],
      }],
    })
  }
  if (powerBarRef.value) {
    if (!charts.powerBar) charts.powerBar = echarts.init(powerBarRef.value)
    charts.powerBar.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: ['峰时', '平时', '谷时'] },
      yAxis: { type: 'value', name: 'kWh' },
      series: [{ type: 'bar', barWidth: '50%', data: [
        { value: energy.peak_kwh, itemStyle: { color: '#ef4444' } },
        { value: energy.flat_kwh, itemStyle: { color: '#f59e0b' } },
        { value: energy.valley_kwh, itemStyle: { color: '#22c55e' } },
      ]}],
    })
  }
}

async function loadEdge() {
  try {
    const [s, r, l] = await Promise.all([
      industry40Api.getEdgeStatus(), industry40Api.getEdgeRules(), industry40Api.getEdgeLog(),
    ])
    Object.assign(edgeStatus, s || {})
    const rules = r?.rules || {}
    const interlocks = r?.interlocks || {}
    edgeRules.value = [
      ...Object.entries(rules).map(([id, v]: any) => ({ ...v, rule_id: id, type: '规则' })),
      ...Object.entries(interlocks).map(([id, v]: any) => ({ ...v, rule_id: id, type: '联锁' })),
    ]
    edgeLog.value = l?.log || []
  } catch { /* ignore */ }
}

async function loadTwin() {
  try {
    const [devs, health, oee, energyPower] = await Promise.all([
      industry40Api.getDevicesStatus(), industry40Api.getHealthScores(), industry40Api.getOEE(),
      industry40Api.getEnergyPower().catch(() => null),
    ])
    const healthMap = new Map<string, number>()
    ;(health?.health_scores || []).forEach((h: any) => healthMap.set(h.device_id, h.health_score))
    const oeeMap = new Map<string, number>()
    ;(oee?.devices || []).forEach((o: any) => oeeMap.set(o.device_id, o.oee_percent))
    const powerMap = new Map<string, number>()
    ;(energyPower?.devices || []).forEach((p: any) => powerMap.set(p.device_id, p.power_kw || p.power || 0))

    // 动态生成设备布局：用 TWIN_MAP 匹配已知设备，未知设备自动排列
    const knownIds = Object.keys(TWIN_MAP)
    let unknownIdx = 0
    twinDevices.value = (devs?.devices || []).map((d: any) => {
      const m = TWIN_MAP[d.device_id]
      if (m) {
        return {
          ...d, x: m.x, y: m.y, icon: m.icon,
          name: m.name || d.device_id, process_type: m.process_type || '',
          health_score: healthMap.get(d.device_id) || 0,
          oee: oeeMap.get(d.device_id) || 0,
          power: (powerMap.get(d.device_id) || 0).toFixed(1),
        }
      }
      // 未知设备自动排列
      const x = 100 + (unknownIdx % 4) * 180
      const y = 60 + Math.floor(unknownIdx / 4) * 160
      unknownIdx++
      return {
        ...d, x, y, icon: '⚙️',
        name: d.name || d.device_id, process_type: '',
        health_score: healthMap.get(d.device_id) || 0,
        oee: oeeMap.get(d.device_id) || 0,
        power: (powerMap.get(d.device_id) || 0).toFixed(1),
      }
    })
  } catch { /* ignore */ }
}

async function loadSPCTab() {
  // SPC tab 切换时，自动选择第一个设备的第一个寄存器并加载
  if (!spc.deviceId && deviceList.value.length) {
    const firstDev = deviceList.value[0]
    spc.deviceId = firstDev.device_id
    onSpcDeviceChange(firstDev.device_id)
    if (spc.registers.length) {
      spc.registerName = spc.registers[0]
      await loadSPC()
    }
  }
}

// ========== 振动分析 ==========
const vibrationData = ref<any[]>([])
const vibrationSpectrum = ref<any[]>([])

async function loadVibration() {
  try {
    const data = await industry40Api.getVibrationAll()
    vibrationData.value = data?.vibrations || data?.devices || []
    if (vibrationData.value.length) {
      renderVibrationChart()
    }
  } catch { /* ignore */ }
}

function renderVibrationChart() {
  // 振动分析在 Industry40 页面没有独立 tab，数据通过 overview 展示
  // 此函数预留用于未来扩展
}

function selectTwinDevice(d: any) { twinSelected.value = d }

// ========== 设备列表 ==========
async function loadDeviceList() {
  try {
    const data = await devicesApi.getAll()
    deviceList.value = data?.devices || []
  } catch { /* ignore */ }
}

function onSpcDeviceChange(deviceId: string) {
  const dev = deviceList.value.find((d: any) => d.device_id === deviceId)
  spc.registers = (dev?.registers || []).map((r: any) => r.name)
  spc.registerName = ''
}

// ========== Tab 切换 ==========
const loaders: Record<string, () => any> = {
  overview: loadOverview,
  predictive: loadPredictive,
  oee: loadOEE,
  spc: loadSPCTab,
  energy: loadEnergy,
  edge: loadEdge,
  twin: loadTwin,
  vibration: loadVibration,
}

function onTabChange(tab: string) {
  loaders[tab]?.()
}

// ========== 生命周期 ==========
onMounted(async () => {
  await loadDeviceList()
  loadOverview()
  refreshTimer = setInterval(() => { loaders[activeTab.value]?.() }, 30000)
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  clearInterval(refreshTimer)
  window.removeEventListener('resize', handleResize)
  Object.values(charts).forEach(c => c.dispose())
})

function handleResize() { Object.values(charts).forEach(c => c.resize()) }
</script>

<style scoped>
.industry40 { padding: 0; }
.metric-row { margin-bottom: 12px; }
.metric-box { background: #fff; border: 1px solid #e2e5ea; border-radius: 8px; padding: 16px; text-align: center; }
.metric-label { font-size: 12px; color: #999; margin-bottom: 4px; }
.metric-value { font-size: 24px; font-weight: 700; color: #1a1a2e; }
.chart-box { height: 280px; }
.process-flow { height: 300px; }
.alert-list { max-height: 400px; overflow-y: auto; }
.alert-item { padding: 8px; border-bottom: 1px solid #f0f0f0; display: flex; gap: 8px; align-items: center; }
.alert-sev { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
.sev-critical .alert-sev { background: #fee2e2; color: #991b1b; }
.sev-warning .alert-sev { background: #fef3c7; color: #92400e; }
.sev-info .alert-sev { background: #e0f2fe; color: #075985; }
.alert-msg { font-size: 12px; color: #333; }
.cap-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.cap-item { background: #f8f9fa; border-radius: 6px; padding: 12px; text-align: center; }
.cap-label { display: block; font-size: 11px; color: #999; }
.cap-val { display: block; font-size: 20px; font-weight: 700; color: #1a1a2e; }
.violation-list { max-height: 300px; overflow-y: auto; }
.violation-item { padding: 6px; border-bottom: 1px solid #f0f0f0; display: flex; gap: 8px; font-size: 12px; }
.v-rule { font-weight: 600; color: #ef4444; }
.v-dev { color: #666; }
.v-time { color: #999; margin-left: auto; }
.log-list { max-height: 400px; overflow-y: auto; }
.log-item { padding: 6px; border-bottom: 1px solid #f0f0f0; font-size: 12px; display: flex; gap: 6px; }
.log-type { color: #4f46e5; font-weight: 600; }
.log-rule { color: #333; }
.log-result { color: #666; }
.log-time { color: #999; margin-left: auto; }
.twin-floor { position: relative; min-height: 350px; background: linear-gradient(90deg, rgba(79,70,229,0.03) 1px, transparent 1px), linear-gradient(rgba(79,70,229,0.03) 1px, transparent 1px); background-size: 30px 30px; border: 1px solid #e2e5ea; border-radius: 8px; }
.twin-links { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.twin-node { position: absolute; width: 80px; height: 80px; border-radius: 50%; background: #fff; border: 3px solid #e2e5ea; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; transition: all 0.2s; }
.twin-node:hover { transform: scale(1.08); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
.twin-node.status-running { border-color: #22c55e; }
.twin-node.status-fault { border-color: #ef4444; animation: pulse 1.5s infinite; }
.twin-node.status-idle { border-color: #f59e0b; }
.twin-node.status-stopped { border-color: #9ca3af; }
@keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); } 50% { box-shadow: 0 0 0 10px rgba(239,68,68,0); } }
.node-icon { font-size: 24px; }
.node-name { font-size: 10px; color: #333; text-align: center; margin-top: 2px; }
.twin-detail { font-size: 13px; }
.detail-name { font-size: 16px; font-weight: 700; margin-bottom: 12px; color: #1a1a2e; }
.detail-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; }
</style>
