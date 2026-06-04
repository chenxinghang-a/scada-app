<template>
  <div class="config-page">
    <el-card shadow="hover">
      <template #header><span>系统配置</span></template>
      <el-tabs v-model="activeTab">
        <!-- 系统设置 -->
        <el-tab-pane label="系统设置" name="system">
          <el-form label-width="120px" style="max-width:600px">
            <el-form-item label="系统名称"><el-input v-model="config.system.name" /></el-form-item>
            <el-form-item label="版本"><el-input :value="appVersion" disabled /></el-form-item>
            <el-form-item label="Web端口"><el-input-number v-model="config.system.port" :min="1" :max="65535" /></el-form-item>
            <el-form-item label="Web地址"><el-input v-model="config.system.host" /></el-form-item>
            <el-form-item label="调试模式"><el-switch v-model="config.system.debug" /></el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveConfig('system')">保存</el-button>
              <el-button @click="exportConfig">导出配置</el-button>
              <el-button @click="importConfig">导入配置</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <!-- 采集设置 -->
        <el-tab-pane label="采集设置" name="collection">
          <el-form label-width="120px" style="max-width:600px">
            <el-form-item label="默认采集间隔(秒)"><el-input-number v-model="config.collection.interval" :min="1" /></el-form-item>
            <el-form-item label="连接超时(秒)"><el-input-number v-model="config.collection.timeout" :min="1" /></el-form-item>
            <el-form-item label="重试次数"><el-input-number v-model="config.collection.retries" :min="0" /></el-form-item>
            <el-form-item label="重试间隔(秒)"><el-input-number v-model="config.collection.retry_interval" :min="1" /></el-form-item>
            <el-form-item><el-button type="primary" @click="saveConfig('collection')">保存</el-button></el-form-item>
          </el-form>
        </el-tab-pane>

        <!-- 数据库设置 -->
        <el-tab-pane label="数据库设置" name="database">
          <el-form label-width="140px" style="max-width:600px">
            <el-form-item label="原始数据保留(天)"><el-input-number v-model="config.database.retention_days" :min="1" /></el-form-item>
            <el-form-item label="数据压缩"><el-switch v-model="config.database.compression" /></el-form-item>
            <el-form-item label="压缩间隔(小时)"><el-input-number v-model="config.database.compression_interval" :min="1" /></el-form-item>
            <el-form-item><el-button type="primary" @click="saveConfig('database')">保存</el-button></el-form-item>
          </el-form>
        </el-tab-pane>

        <!-- 报警规则 -->
        <el-tab-pane label="报警规则" name="alarms">
          <el-button type="primary" size="small" class="mb-16" @click="showRuleDialog">添加规则</el-button>
          <el-table :data="alarmRules" stripe size="small">
            <el-table-column prop="id" label="ID" width="100" />
            <el-table-column prop="name" label="名称" />
            <el-table-column prop="device_id" label="设备" width="140" />
            <el-table-column prop="condition" label="条件" width="80" />
            <el-table-column prop="threshold" label="阈值" width="80" />
            <el-table-column prop="level" label="等级" width="80">
              <template #default="{ row }">
                <el-tag :type="row.level === 'critical' ? 'danger' : 'warning'" size="small">{{ row.level }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="enabled" label="启用" width="60">
              <template #default="{ row }"><el-switch v-model="row.enabled" size="small" @change="toggleRule(row)" /></template>
            </el-table-column>
            <el-table-column label="操作" width="120">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click="editRule(row)">编辑</el-button>
                <el-popconfirm title="确定删除？" @confirm="deleteRule(row.id)">
                  <template #reference><el-button type="danger" link size="small">删除</el-button></template>
                </el-popconfirm>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>

        <!-- 能源费率 -->
        <el-tab-pane label="能源费率" name="energy">
          <el-form label-width="140px" style="max-width:600px">
            <el-form-item label="峰时电价(元/kWh)"><el-input-number v-model="config.energy.peak_price" :min="0" :step="0.01" /></el-form-item>
            <el-form-item label="平时电价(元/kWh)"><el-input-number v-model="config.energy.flat_price" :min="0" :step="0.01" /></el-form-item>
            <el-form-item label="谷时电价(元/kWh)"><el-input-number v-model="config.energy.valley_price" :min="0" :step="0.01" /></el-form-item>
            <el-form-item label="碳排放因子"><el-input-number v-model="config.energy.carbon_factor" :min="0" :step="0.01" /></el-form-item>
            <el-form-item><el-button type="primary" @click="saveConfig('energy')">保存</el-button></el-form-item>
          </el-form>
          <el-divider />
          <h4>费率预览</h4>
          <el-descriptions :column="3" border size="small">
            <el-descriptions-item label="峰时">{{ config.energy.peak_price }} 元/kWh</el-descriptions-item>
            <el-descriptions-item label="平时">{{ config.energy.flat_price }} 元/kWh</el-descriptions-item>
            <el-descriptions-item label="谷时">{{ config.energy.valley_price }} 元/kWh</el-descriptions-item>
          </el-descriptions>
        </el-tab-pane>

        <!-- 系统状态 -->
        <el-tab-pane label="系统状态" name="status">
          <el-descriptions :column="2" border>
            <el-descriptions-item label="运行模式">
              <el-tag :type="systemStatus.simulation_mode ? 'warning' : 'success'">{{ systemStatus.simulation_mode ? '模拟模式' : '实时模式' }}</el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="设备总数">{{ systemStatus.devices_total || 0 }}</el-descriptions-item>
            <el-descriptions-item label="在线设备">{{ systemStatus.devices_connected || 0 }}</el-descriptions-item>
            <el-descriptions-item label="活跃报警">{{ systemStatus.alarms_active || 0 }}</el-descriptions-item>
            <el-descriptions-item label="数据采集器">
              <el-tag :type="systemStatus.data_collector_running ? 'success' : 'danger'">{{ systemStatus.data_collector_running ? '运行中' : '已停止' }}</el-tag>
            </el-descriptions-item>
          </el-descriptions>
          <el-divider />
          <h4>数据库信息</h4>
          <el-table :data="dbTables" stripe size="small">
            <el-table-column prop="name" label="表名" />
            <el-table-column prop="rows" label="记录数" width="120" />
            <el-table-column prop="size" label="大小" width="120" />
          </el-table>
        </el-tab-pane>

        <!-- 报警输出硬件配置 -->
        <el-tab-pane label="报警输出硬件" name="alarm-hardware">
          <el-row :gutter="16">
            <el-col :span="12">
              <el-card shadow="hover" header="Patlite LR7 光柱配置 (Modbus)">
                <el-form label-width="120px">
                  <el-form-item label="启用声光报警器"><el-switch v-model="signalTower.enabled" /></el-form-item>
                  <el-form-item label="Modbus IP"><el-input v-model="signalTower.host" placeholder="192.168.1.70" /></el-form-item>
                  <el-form-item label="端口"><el-input-number v-model="signalTower.port" :min="1" :max="65535" /></el-form-item>
                  <el-form-item label="从站ID"><el-input-number v-model="signalTower.slave_id" :min="1" :max="247" /></el-form-item>
                  <el-divider>DO 线圈映射</el-divider>
                  <el-form-item label="红灯 DO"><el-input-number v-model="signalTower.do_mapping.red_light" :min="0" /></el-form-item>
                  <el-form-item label="黄灯 DO"><el-input-number v-model="signalTower.do_mapping.yellow_light" :min="0" /></el-form-item>
                  <el-form-item label="绿灯 DO"><el-input-number v-model="signalTower.do_mapping.green_light" :min="0" /></el-form-item>
                  <el-form-item label="蜂鸣器 DO"><el-input-number v-model="signalTower.do_mapping.buzzer" :min="0" /></el-form-item>
                  <el-form-item><el-button type="primary" @click="saveSignalTower">保存</el-button></el-form-item>
                </el-form>
              </el-card>
            </el-col>
            <el-col :span="12">
              <el-card shadow="hover" header="广播系统配置 (MQTT)">
                <el-form label-width="120px">
                  <el-form-item label="启用广播系统"><el-switch v-model="broadcastConfig.enabled" /></el-form-item>
                  <el-form-item label="MQTT Broker"><el-input v-model="broadcastConfig.mqtt.broker" placeholder="192.168.1.200" /></el-form-item>
                  <el-form-item label="端口"><el-input-number v-model="broadcastConfig.mqtt.port" :min="1" :max="65535" /></el-form-item>
                  <el-form-item label="主题前缀"><el-input v-model="broadcastConfig.mqtt.topic_prefix" placeholder="pa/" /></el-form-item>
                  <el-form-item label="用户名"><el-input v-model="broadcastConfig.mqtt.username" placeholder="可选" /></el-form-item>
                  <el-form-item label="密码"><el-input v-model="broadcastConfig.mqtt.password" type="password" placeholder="可选" show-password /></el-form-item>
                  <el-form-item label="广播区域"><el-input v-model="broadcastAreasStr" placeholder="车间A,车间B,仓库,办公楼" /></el-form-item>
                  <el-form-item><el-button type="primary" @click="saveBroadcastHardware">保存</el-button></el-form-item>
                </el-form>
              </el-card>
            </el-col>
          </el-row>
        </el-tab-pane>

        <!-- 日志设置 -->
        <el-tab-pane label="日志设置" name="logging">
          <el-form label-width="140px" style="max-width:600px">
            <el-form-item label="日志级别">
              <el-select v-model="loggingConfig.level" style="width:100%">
                <el-option label="DEBUG" value="DEBUG" />
                <el-option label="INFO" value="INFO" />
                <el-option label="WARNING" value="WARNING" />
                <el-option label="ERROR" value="ERROR" />
              </el-select>
            </el-form-item>
            <el-form-item label="日志文件最大(MB)"><el-input-number v-model="loggingConfig.file.max_size_mb" :min="1" /></el-form-item>
            <el-form-item label="日志备份数"><el-input-number v-model="loggingConfig.file.backup_count" :min="0" /></el-form-item>
            <el-form-item><el-button type="primary" @click="saveLoggingConfig">保存</el-button></el-form-item>
          </el-form>
        </el-tab-pane>

        <!-- 运维管理 -->
        <el-tab-pane label="运维管理" name="ops">
          <el-row :gutter="16">
            <el-col :span="12">
              <el-card shadow="hover" header="运行模式">
                <el-form label-width="100px">
                  <el-form-item label="当前模式">
                    <el-tag :type="simulationMode ? 'warning' : 'success'" size="large">{{ simulationMode ? '模拟模式' : '实时模式' }}</el-tag>
                  </el-form-item>
                  <el-form-item label="切换模式">
                    <el-switch v-model="simulationMode" active-text="模拟" inactive-text="实时" @change="toggleSimulationMode" />
                  </el-form-item>
                </el-form>
              </el-card>
            </el-col>
            <el-col :span="12">
              <el-card shadow="hover" header="系统健康">
                <div v-if="healthStatus">
                  <div v-for="(val, key) in healthStatus" :key="key" class="health-row">
                    <span class="health-key">{{ key }}</span>
                    <el-tag :type="val ? 'success' : 'danger'" size="small">{{ val ? '正常' : '异常' }}</el-tag>
                  </div>
                </div>
                <el-empty v-else description="加载中..." :image-size="40" />
                <el-button size="small" @click="loadHealthStatus" style="margin-top:8px">刷新</el-button>
              </el-card>
            </el-col>
          </el-row>
          <el-row :gutter="16" style="margin-top:16px">
            <el-col :span="12">
              <el-card shadow="hover" header="报警输出配置">
                <el-form label-width="120px">
                  <el-form-item label="灯塔模式">
                    <el-select v-model="alarmOutputConfig.mode" style="width:100%">
                      <el-option label="自动模式" value="auto" />
                      <el-option label="手动模式" value="manual" />
                      <el-option label="禁用" value="disabled" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="蜂鸣器启用"><el-switch v-model="alarmOutputConfig.buzzer_enabled" /></el-form-item>
                  <el-form-item label="自动消音(秒)"><el-input-number v-model="alarmOutputConfig.auto_silence_seconds" :min="0" /></el-form-item>
                  <el-form-item><el-button type="primary" @click="saveAlarmOutputConfig">保存</el-button></el-form-item>
                </el-form>
              </el-card>
            </el-col>
            <el-col :span="12">
              <el-card shadow="hover" header="报警升级配置">
                <el-form label-width="140px">
                  <el-form-item label="启用报警升级"><el-switch v-model="alarmEscalation.enabled" /></el-form-item>
                  <el-form-item label="升级阈值(分钟)"><el-input-number v-model="alarmEscalation.timeout_minutes" :min="1" /></el-form-item>
                  <el-form-item label="升级目标等级">
                    <el-select v-model="alarmEscalation.escalate_to" style="width:100%">
                      <el-option label="严重 (critical)" value="critical" />
                      <el-option label="警告 (warning)" value="warning" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="通知方式">
                    <el-checkbox-group v-model="alarmEscalation.notify_methods">
                      <el-checkbox label="sound">声光报警</el-checkbox>
                      <el-checkbox label="broadcast">广播通知</el-checkbox>
                    </el-checkbox-group>
                  </el-form-item>
                  <el-form-item><el-button type="primary" @click="saveAlarmEscalation">保存</el-button></el-form-item>
                </el-form>
              </el-card>
            </el-col>
          </el-row>
          <el-row :gutter="16" style="margin-top:16px">
            <el-col :span="24">
              <el-card shadow="hover" header="数据归档管理">
                <el-row :gutter="16">
                  <el-col :span="12">
                    <el-form label-width="140px">
                      <el-form-item label="自动归档"><el-switch v-model="archiveConfig.auto_archive" /></el-form-item>
                      <el-form-item label="归档周期(天)"><el-input-number v-model="archiveConfig.archive_interval_days" :min="1" /></el-form-item>
                      <el-form-item label="数据保留(天)"><el-input-number v-model="archiveConfig.retention_days" :min="1" /></el-form-item>
                      <el-form-item label="压缩已归档数据"><el-switch v-model="archiveConfig.compress_archived" /></el-form-item>
                      <el-form-item>
                        <el-button type="primary" @click="saveArchiveConfig">保存归档策略</el-button>
                        <el-button @click="triggerArchive" :loading="archiveLoading">立即归档</el-button>
                      </el-form-item>
                    </el-form>
                  </el-col>
                  <el-col :span="12">
                    <el-descriptions :column="1" border size="small">
                      <el-descriptions-item label="历史数据总量">{{ dbTables.reduce((s, t) => t.name === 'history_data' ? s + t.rows : s, 0) }} 条</el-descriptions-item>
                      <el-descriptions-item label="归档数据总量">{{ dbTables.reduce((s, t) => t.name === 'history_archive' ? s + t.rows : s, 0) }} 条</el-descriptions-item>
                      <el-descriptions-item label="数据库大小">{{ dbTables.reduce((s, t) => s + (parseFloat(t.size) || 0), 0).toFixed(2) }} MB</el-descriptions-item>
                    </el-descriptions>
                  </el-col>
                </el-row>
              </el-card>
            </el-col>
          </el-row>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <!-- 报警规则弹窗 -->
    <el-dialog v-model="ruleDialogVisible" :title="isEditRule ? '编辑规则' : '添加规则'" width="500px">
      <el-form :model="ruleForm" label-width="80px">
        <el-form-item label="名称"><el-input v-model="ruleForm.name" /></el-form-item>
        <el-form-item label="设备">
          <el-select v-model="ruleForm.device_id" style="width:100%">
            <el-option v-for="d in devices" :key="d.device_id" :label="d.name || d.device_name || d.device_id" :value="d.device_id" />
          </el-select>
        </el-form-item>
        <el-form-item label="条件">
          <el-select v-model="ruleForm.condition" style="width:100%">
            <el-option label="大于 (>)" value=">" />
            <el-option label="小于 (<)" value="<" />
            <el-option label="大于等于 (>=)" value=">=" />
            <el-option label="小于等于 (<=)" value="<=" />
            <el-option label="等于 (=)" value="=" />
          </el-select>
        </el-form-item>
        <el-form-item label="阈值"><el-input-number v-model="ruleForm.threshold" style="width:100%" /></el-form-item>
        <el-form-item label="等级">
          <el-select v-model="ruleForm.level" style="width:100%">
            <el-option label="严重" value="critical" />
            <el-option label="警告" value="warning" />
            <el-option label="信息" value="info" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用"><el-switch v-model="ruleForm.enabled" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="ruleDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveRule">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { systemApi, devicesApi, alarmsApi, type Device } from '@/api'

// 从 package.json 读取版本号
const appVersion = __APP_VERSION__ || 'v1.0.0'

const activeTab = ref('system')
const devices = ref<Device[]>([])
const alarmRules = ref<any[]>([])
const systemStatus = ref<any>({})
const dbInfo = ref<any>(null)
const ruleDialogVisible = ref(false)
const isEditRule = ref(false)
const simulationMode = ref(false)
const healthStatus = ref<any>(null)
const alarmOutputConfig = reactive({ mode: 'auto', buzzer_enabled: true, auto_silence_seconds: 60 })
const alarmEscalation = reactive({ enabled: false, timeout_minutes: 30, escalate_to: 'critical', notify_methods: ['sound'] as string[] })
const archiveConfig = reactive({ auto_archive: true, archive_interval_days: 7, retention_days: 90, compress_archived: true })
const archiveLoading = ref(false)

// 报警输出硬件配置 (Patlite LR7 Modbus)
const signalTower = reactive({
  enabled: true,
  host: '192.168.1.70',
  port: 502,
  slave_id: 1,
  do_mapping: { red_light: 0, yellow_light: 1, green_light: 2, buzzer: 5 },
})

// 广播系统配置 (MQTT)
const broadcastConfig = reactive({
  enabled: true,
  mqtt: { broker: '192.168.1.200', port: 1883, topic_prefix: 'pa/', username: '', password: '' },
  areas: [] as string[],
})
const broadcastAreasStr = ref('车间A,车间B,仓库,办公楼')

// 日志设置
const loggingConfig = reactive({
  level: 'INFO',
  file: { enabled: true, path: 'logs/scada.log', max_size_mb: 50, backup_count: 5 },
})

const config = reactive({
  system: { name: 'SmartSCADA', port: 5000, host: '127.0.0.1', debug: false },
  collection: { interval: 5, timeout: 10, retries: 3, retry_interval: 5 },
  database: { retention_days: 30, compression: true, compression_interval: 24 },
  energy: { peak_price: 1.2, flat_price: 0.8, valley_price: 0.4, carbon_factor: 0.5 },
})

const ruleForm = reactive({ id: '', name: '', device_id: '', register_name: '', condition: '>', threshold: 0, level: 'warning', enabled: true })

const dbTables = computed(() => {
  if (!dbInfo.value?.tables) return []
  return Object.entries(dbInfo.value.tables).map(([name, info]: any) => ({ name, rows: info.rows, size: info.size }))
})

onMounted(async () => {
  try { const data = await devicesApi.getAll(); devices.value = data.devices || [] } catch (e: any) { console.warn('[Config] 加载设备列表失败:', e?.message || e) }
  loadConfig()
  loadSystemStatus()
  loadAlarmRules()
  loadSimulationMode()
  loadHealthStatus()
  loadAlarmOutputConfig()
  loadAlarmEscalation()
  loadArchiveConfig()
  loadSignalTowerConfig()
  loadBroadcastHardwareConfig()
  loadLoggingConfig()
})

async function loadConfig() {
  try {
    const data = await systemApi.getConfig()
    if (data?.config) {
      const c = data.config
      if (c.system) Object.assign(config.system, c.system)
      if (c.collection) Object.assign(config.collection, c.collection)
      if (c.database) Object.assign(config.database, c.database)
      if (c.energy) Object.assign(config.energy, c.energy)
    }
  } catch (e: any) { console.warn('[Config] 加载系统配置失败:', e?.message || e) }
}

async function loadSystemStatus() {
  try {
    const [s, d] = await Promise.all([systemApi.getStatus(), systemApi.getDatabase()])
    systemStatus.value = s
    dbInfo.value = d
  } catch (e: any) { console.warn('[Config] 加载系统状态失败:', e?.message || e) }
}

async function loadAlarmRules() {
  try { const data = await alarmsApi.getRules(); alarmRules.value = data.rules || [] } catch (e: any) { console.warn('[Config] 加载报警规则失败:', e?.message || e) }
}

async function saveConfig(section: string) {
  try {
    await systemApi.saveConfig(section, (config as any)[section])
    ElMessage.success('配置已保存')
  } catch (e: any) { console.error('[Config] 操作失败:', e); ElMessage.error('操作失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}

function showRuleDialog() {
  isEditRule.value = false
  Object.assign(ruleForm, { id: '', name: '', device_id: '', register_name: '', condition: '>', threshold: 0, level: 'warning', enabled: true })
  ruleDialogVisible.value = true
}

function editRule(rule: any) {
  isEditRule.value = true
  Object.assign(ruleForm, rule)
  ruleDialogVisible.value = true
}

async function saveRule() {
  try {
    if (isEditRule.value) {
      await alarmsApi.updateRule(ruleForm.id, ruleForm)
    } else {
      await alarmsApi.createRule(ruleForm)
    }
    ElMessage.success('规则已保存')
    ruleDialogVisible.value = false
    loadAlarmRules()
  } catch (e: any) { console.error('[Config] 操作失败:', e); ElMessage.error('操作失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}

async function deleteRule(id: string) {
  try { await alarmsApi.deleteRule(id); ElMessage.success('规则已删除'); loadAlarmRules() } catch (e: any) { console.error('[Config] 操作失败:', e); ElMessage.error('操作失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}

async function toggleRule(rule: any) {
  try {
    await alarmsApi.updateRule(rule.id, { enabled: rule.enabled })
    ElMessage.success(rule.enabled ? '规则已启用' : '规则已禁用')
  } catch (e: any) {
    rule.enabled = !rule.enabled
    console.error('[Config] 操作失败:', e); ElMessage.error('操作失败: ' + (e?.response?.data?.error || e?.message || '未知错误'))
  }
}

async function loadSimulationMode() {
  try {
    const data = await systemApi.getSimulationMode()
    simulationMode.value = data.simulation_mode
  } catch (e: any) { console.warn('[Config] 加载模拟模式失败:', e?.message || e) }
}

async function toggleSimulationMode(val: boolean) {
  try {
    await systemApi.setSimulationMode(val)
    ElMessage.success(`已切换为${val ? '模拟模式' : '实时模式'}`)
  } catch (e: any) {
    console.error('[Config] 切换模式失败:', e)
    simulationMode.value = !val
    ElMessage.error('切换模式失败: ' + (e?.response?.data?.error || e?.message || '未知错误'))
  }
}

async function loadHealthStatus() {
  try {
    const data = await systemApi.getHealth()
    healthStatus.value = data.checks || data
  } catch (e: any) { console.warn('[Config] 健康状态加载失败:', e?.message || e) }
}

async function loadAlarmOutputConfig() {
  try {
    const data = await alarmsApi.getAlarmOutputConfig()
    if (data) Object.assign(alarmOutputConfig, data)
  } catch (e: any) { console.warn('[Config] 报警输出配置加载失败:', e?.message || e) }
}

async function saveAlarmOutputConfig() {
  try {
    await alarmsApi.setAlarmOutputConfig(alarmOutputConfig)
    ElMessage.success('报警输出配置已保存')
  } catch (e: any) { console.error('[Config] 操作失败:', e); ElMessage.error('保存失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}

async function loadAlarmEscalation() {
  try {
    const data = await alarmsApi.getAlarmOutputConfig()
    if (data?.escalation) Object.assign(alarmEscalation, data.escalation)
  } catch (e: any) { console.warn('[Config] 报警升级配置加载失败:', e?.message || e) }
}

async function saveAlarmEscalation() {
  try {
    await systemApi.saveConfig('alarm_escalation', { ...alarmEscalation })
    ElMessage.success('报警升级配置已保存')
  } catch (e: any) { console.error('[Config] 操作失败:', e); ElMessage.error('保存失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}

function loadArchiveConfig() {
  // 归档配置在 loadConfig 中已统一拉取，此处从 config reactive 中读取
  // 如果 loadConfig 中没有 archive 段，尝试单独拉取
  systemApi.getConfig().then(data => {
    if (data?.config?.archive) Object.assign(archiveConfig, data.config.archive)
  }).catch((e: any) => { console.warn('[Config] 归档配置加载失败:', e?.message || e) })
}

async function saveArchiveConfig() {
  try {
    await systemApi.saveConfig('archive', archiveConfig)
    ElMessage.success('归档策略已保存')
  } catch (e: any) { console.error('[Config] 操作失败:', e); ElMessage.error('保存失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}

async function triggerArchive() {
  archiveLoading.value = true
  try {
    await systemApi.saveConfig('archive_trigger', { action: 'archive_now' })
    ElMessage.success('归档任务已触发')
  } catch (e: any) { console.error('[Config] 操作失败:', e); ElMessage.error('归档失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
  finally { archiveLoading.value = false }
}

// ========== 报警输出硬件配置 ==========
async function loadSignalTowerConfig() {
  try {
    const data = await alarmsApi.getAlarmOutputConfig()
    if (data?.config) {
      const st = data.config.signal_tower || data.config
      if (st.enabled !== undefined) signalTower.enabled = st.enabled
      if (st.host) signalTower.host = st.host
      if (st.port) signalTower.port = st.port
      if (st.slave_id) signalTower.slave_id = st.slave_id
      if (st.do_mapping) Object.assign(signalTower.do_mapping, st.do_mapping)
    }
  } catch (e: any) { console.warn('[Config] 光柱配置加载失败:', e?.message || e) }
}

async function saveSignalTower() {
  try {
    await alarmsApi.setAlarmOutputConfig({
      enabled: signalTower.enabled,
      signal_tower: { host: signalTower.host, port: signalTower.port, slave_id: signalTower.slave_id, do_mapping: { ...signalTower.do_mapping } },
    })
    ElMessage.success('报警输出硬件配置已保存')
  } catch (e: any) { console.error('[Config] 操作失败:', e); ElMessage.error('保存失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}

// ========== 广播系统硬件配置 ==========
async function loadBroadcastHardwareConfig() {
  try {
    const data = await alarmsApi.getBroadcastConfig()
    if (data?.config) {
      const bc = data.config
      if (bc.enabled !== undefined) broadcastConfig.enabled = bc.enabled
      if (bc.mqtt) Object.assign(broadcastConfig.mqtt, bc.mqtt)
      if (bc.areas && Array.isArray(bc.areas)) {
        broadcastConfig.areas = bc.areas
        broadcastAreasStr.value = bc.areas.join(',')
      }
    }
  } catch (e: any) { console.warn('[Config] 广播配置加载失败:', e?.message || e) }
}

async function saveBroadcastHardware() {
  try {
    const areas = broadcastAreasStr.value.split(',').map(s => s.trim()).filter(Boolean)
    await alarmsApi.setBroadcastConfig({ enabled: broadcastConfig.enabled, mqtt: { ...broadcastConfig.mqtt }, areas })
    ElMessage.success('广播系统配置已保存')
  } catch (e: any) { console.error('[Config] 操作失败:', e); ElMessage.error('保存失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}

// ========== 日志设置 ==========
async function loadLoggingConfig() {
  try {
    const data = await systemApi.getConfig()
    if (data?.config?.logging) {
      const lc = data.config.logging
      if (lc.level) loggingConfig.level = lc.level
      if (lc.file) Object.assign(loggingConfig.file, lc.file)
    }
  } catch (e: any) { console.warn('[Config] 日志配置加载失败:', e?.message || e) }
}

async function saveLoggingConfig() {
  try {
    await systemApi.saveConfig('logging', { level: loggingConfig.level, file: { ...loggingConfig.file } })
    ElMessage.success('日志设置已保存')
  } catch (e: any) { console.error('[Config] 操作失败:', e); ElMessage.error('保存失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}

function exportConfig() {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `smartscada-config-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('配置已导出')
}

function importConfig() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  input.onchange = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const imported = JSON.parse(text)
      // 安全校验：只接受已知配置段，防止原型链污染
      const allowedSections = ['system', 'collection', 'database', 'energy']
      for (const section of allowedSections) {
        if (imported[section] && typeof imported[section] === 'object' && imported[section] !== null) {
          Object.assign((config as any)[section], imported[section])
        }
      }
      // 自动保存所有配置段
      for (const section of ['system', 'collection', 'database', 'energy']) {
        if (imported[section]) {
          try { await systemApi.saveConfig(section, config[section as keyof typeof config]) } catch (e: any) { console.warn(`[Config] 导入段 ${section} 保存失败:`, e?.message || e) }
        }
      }
      ElMessage.success('配置已导入并保存')
    } catch (e: any) {
      console.error('[Config] 导入失败:', e)
      ElMessage.error('配置文件格式错误: ' + (e?.message || '未知错误'))
    }
  }
  input.click()
}
</script>

<style scoped>
.mb-16 { margin-bottom: 16px; }
.health-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f0f0f0; }
.health-key { font-size: 13px; color: #333; }
</style>
