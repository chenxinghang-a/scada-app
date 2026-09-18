<template>
  <div class="devices-page">
    <!-- 操作栏 -->
    <section class="panel">
      <div class="panel__body toolbar">
        <div class="toolbar__actions">
          <el-button type="primary" @click="showAddDialog"><el-icon><Plus /></el-icon>自定义添加</el-button>
          <el-button @click="showPresets = !showPresets"><el-icon><Grid /></el-icon>预设设备</el-button>
          <el-button @click="refreshDevices"><el-icon><Refresh /></el-icon>刷新</el-button>
        </div>
        <div class="toolbar__meta">
          <span class="tag tag--offline">共 {{ devices.length }} 台</span>
          <span class="tag tag--success">在线 {{ onlineCount }}</span>
          <span v-if="offlineCount > 0" class="tag tag--warning">离线 {{ offlineCount }}</span>
        </div>
      </div>
    </section>

    <!-- 预设设备面板 -->
    <el-collapse-transition>
      <section v-show="showPresets" class="panel">
        <div class="panel__header">
          <span>预设设备</span>
          <el-button type="success" size="small" :disabled="presetBusy" @click="addAllPresets">一键添加全部</el-button>
        </div>
        <div class="panel__body">
          <el-tabs v-model="presetCategory" type="card">
            <el-tab-pane v-for="cat in presetCategories" :key="cat" :label="cat" :name="cat" />
          </el-tabs>
          <div v-if="filteredPresets.length" class="preset-grid">
            <button v-for="p in filteredPresets" :key="p.id" type="button" class="preset-card" @click="addPreset(p)">
              <div class="preset-card__name">{{ p.name }}</div>
              <div class="preset-card__tag"><span class="tag tag--info">{{ protocolLabel(p.protocol) }}</span></div>
              <div class="preset-card__desc">{{ p.description }}</div>
            </button>
          </div>
          <el-empty v-else description="该分类下暂无预设设备" :image-size="70" />
        </div>
      </section>
    </el-collapse-transition>

    <!-- 设备列表 -->
    <section class="panel">
      <div class="panel__header">
        <span>设备列表</span>
        <span class="panel__meta">共 {{ devices.length }} 台设备</span>
      </div>
      <div class="panel__body panel__body--flush">
        <el-table :data="devices" stripe v-loading="loading" class="device-table">
          <el-table-column prop="device_id" label="设备ID" width="180" show-overflow-tooltip>
            <template v-slot:default="{ row }"><span class="mono">{{ row.device_id }}</span></template>
          </el-table-column>
          <el-table-column label="设备名称" min-width="200" show-overflow-tooltip>
            <template v-slot:default="{ row }">{{ row.name || row.device_name || row.device_id }}</template>
          </el-table-column>
          <el-table-column label="协议" width="120">
            <template v-slot:default="{ row }">
              <span class="tag tag--info">{{ protocolLabel(row.protocol) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="地址" width="180" show-overflow-tooltip>
            <template v-slot:default="{ row }">
              <span class="mono">{{ row.host }}{{ row.port ? ':' + row.port : '' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template v-slot:default="{ row }">
              <span class="tag" :class="row.connected ? 'tag--success' : 'tag--offline'">
                <span class="status-dot" :class="row.connected ? 'status-dot--success' : 'status-dot--offline'"></span>
                {{ row.connected ? '在线' : '离线' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="数据点" width="90" align="right">
            <template v-slot:default="{ row }"><span class="mono">{{ row.registers?.length || 0 }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="240" fixed="right" align="right">
            <template v-slot:default="{ row }">
              <div class="row-actions">
                <el-button type="primary" link size="small" @click="testDevice(row)">测试</el-button>
                <el-button type="warning" link size="small" @click="editDevice(row)">编辑</el-button>
                <el-button type="info" link size="small" @click="viewData(row)">数据</el-button>
                <span class="row-actions__sep" aria-hidden="true"></span>
                <el-popconfirm
                  title="删除后不可恢复，确定删除此设备？"
                  confirm-button-text="删除"
                  cancel-button-text="取消"
                  confirm-button-type="danger"
                  width="240"
                  @confirm="deleteDevice(row)"
                >
                  <template v-slot:reference>
                    <el-button link size="small" class="btn-danger-link">删除</el-button>
                  </template>
                </el-popconfirm>
              </div>
            </template>
          </el-table-column>
          <template v-slot:empty>
            <el-empty description="还没有设备，可自定义添加或从预设中添加" :image-size="90">
              <el-button type="primary" @click="showAddDialog">自定义添加</el-button>
              <el-button @click="showPresets = true">从预设添加</el-button>
            </el-empty>
          </template>
        </el-table>
      </div>
    </section>

    <!-- 添加/编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑设备' : '添加设备'" width="700px" top="5vh" class="device-dialog">
      <el-form :model="form" :rules="deviceRules" ref="deviceFormRef" label-width="110px" class="device-form">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="设备ID">
              <el-input v-model="form.device_id" :disabled="isEdit" placeholder="如 schneider_m340_01" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="设备名称">
              <el-input v-model="form.name" placeholder="如 施耐德M340 PLC" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="协议">
              <el-select v-model="form.protocol" @change="onProtocolChange" style="width:100%">
                <el-option label="Modbus TCP" value="modbus_tcp" />
                <el-option label="Modbus RTU" value="modbus_rtu" />
                <el-option label="三菱MC协议" value="mc" />
                <el-option label="欧姆龙FINS" value="fins" />
                <el-option label="OPC UA" value="opcua" />
                <el-option label="MQTT" value="mqtt" />
                <el-option label="REST HTTP" value="rest" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="采集间隔">
              <el-input-number v-model="form.collection_interval" :min="1" :max="3600" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <!-- Modbus TCP/RTU 字段 -->
        <template v-if="form.protocol?.startsWith('modbus')">
          <div class="form-section-title">Modbus 配置</div>
          <el-row :gutter="16">
            <el-col :span="8">
              <el-form-item :label="form.protocol === 'modbus_rtu' ? '串口' : 'IP地址'">
                <el-input v-model="form.host" :placeholder="form.protocol === 'modbus_rtu' ? 'COM1' : '192.168.1.100'" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item :label="form.protocol === 'modbus_rtu' ? '波特率' : '端口'">
                <el-input-number v-model="form.port" :min="1" :max="115200" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="从站ID">
                <el-input-number v-model="form.slave_id" :min="1" :max="247" style="width:100%" />
              </el-form-item>
            </el-col>
          </el-row>
          <div class="form-section-title">寄存器配置</div>
          <div v-for="(reg, i) in form.registers" :key="i" class="register-row">
            <el-input v-model="reg.name" placeholder="名称" style="width:120px" />
            <el-input v-model="reg.description" placeholder="描述" style="width:150px" />
            <el-input-number v-model="reg.address" placeholder="地址" :min="0" :max="65535" style="width:100px" />
            <el-select v-model="reg.data_type" style="width:100px">
              <el-option label="INT16" value="int16" />
              <el-option label="UINT16" value="uint16" />
              <el-option label="INT32" value="int32" />
              <el-option label="FLOAT32" value="float32" />
            </el-select>
            <el-input v-model="reg.unit" placeholder="单位" style="width:60px" />
            <el-button type="danger" :icon="Delete" circle size="small" @click="form.registers.splice(i, 1)" />
          </div>
          <el-button type="primary" link @click="addRegister"><el-icon><Plus /></el-icon> 添加寄存器</el-button>
        </template>

        <!-- OPC UA 字段 -->
        <template v-if="form.protocol === 'opcua'">
          <div class="form-section-title">OPC UA 配置</div>
          <el-form-item label="端点URL">
            <el-input v-model="form.host" placeholder="opc.tcp://192.168.1.100:4840" />
          </el-form-item>
        </template>

        <!-- MC/FINS 字段 -->
        <template v-if="form.protocol === 'mc' || form.protocol === 'fins'">
          <div class="form-section-title">{{ form.protocol === 'mc' ? '三菱MC协议' : '欧姆龙FINS' }} 配置</div>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="IP地址">
                <el-input v-model="form.host" :placeholder="form.protocol === 'mc' ? '192.168.1.100' : '192.168.1.200'" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="端口">
                <el-input-number v-model="form.port" :min="1" :max="65535" style="width:100%" />
              </el-form-item>
            </el-col>
          </el-row>
          <div class="form-section-title">寄存器配置</div>
          <div v-for="(reg, i) in form.registers" :key="i" class="register-row">
            <el-input v-model="reg.name" placeholder="名称" style="width:120px" />
            <el-input v-model="reg.description" placeholder="描述" style="width:150px" />
            <el-input-number v-model="reg.address" placeholder="地址" :min="0" :max="65535" style="width:100px" />
            <el-select v-model="reg.data_type" style="width:100px">
              <el-option label="INT16" value="int16" />
              <el-option label="UINT16" value="uint16" />
              <el-option label="INT32" value="int32" />
              <el-option label="FLOAT32" value="float32" />
            </el-select>
            <el-input v-model="reg.unit" placeholder="单位" style="width:60px" />
            <el-button type="danger" :icon="Delete" circle size="small" @click="form.registers.splice(i, 1)" />
          </div>
          <el-button type="primary" link @click="addRegister"><el-icon><Plus /></el-icon> 添加寄存器</el-button>
        </template>

        <!-- MQTT 字段 -->
        <template v-if="form.protocol === 'mqtt'">
          <div class="form-section-title">MQTT 配置</div>
          <el-row :gutter="16">
            <el-col :span="12">
              <el-form-item label="Broker地址">
                <el-input v-model="form.host" placeholder="192.168.1.100" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="端口">
                <el-input-number v-model="form.port" :min="1" :max="65535" style="width:100%" />
              </el-form-item>
            </el-col>
          </el-row>
        </template>

        <!-- REST 字段 -->
        <template v-if="form.protocol === 'rest'">
          <div class="form-section-title">REST 配置</div>
          <el-form-item label="基础URL">
            <el-input v-model="form.host" placeholder="http://192.168.1.100:8080" />
          </el-form-item>
        </template>

        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template v-slot:footer>
        <el-button :disabled="saving" @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveDevice">保存</el-button>
      </template>
    </el-dialog>

    <!-- 测试结果弹窗 -->
    <el-dialog v-model="testDialogVisible" title="连接测试" width="420px">
      <el-result
        :icon="testResult.success ? 'success' : 'error'"
        :title="testResult.success ? '连接成功' : '连接失败'"
        :sub-title="testResult.message"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Delete } from '@element-plus/icons-vue'
import { useRouter } from 'vue-router'
import { devicesApi, type Device } from '@/api'
import api from '@/api/request'
import { showActionError } from '@/utils/error'

const router = useRouter()

const devices = ref<Device[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const testDialogVisible = ref(false)
const isEdit = ref(false)
const showPresets = ref(false)
const presetCategory = ref('Modbus')

const form = reactive<any>({
  device_id: '', name: '', protocol: 'modbus_tcp', host: '127.0.0.1', port: 502, slave_id: 1,
  collection_interval: 5, enabled: true, registers: [],
})

const testResult = reactive({ success: false, message: '' })
const deviceFormRef = ref<any>(null)
const saving = ref(false)        // 保存中标记，防止连点重复创建设备
const presetBusy = ref(false)    // 预设添加中标记，防止并发重复添加
const deviceRules = {
  device_id: [{ required: true, message: '请输入设备ID', trigger: 'blur' }],
  name: [{ required: true, message: '请输入设备名称', trigger: 'blur' }],
  protocol: [{ required: true, message: '请选择协议', trigger: 'change' }],
  host: [{ required: true, message: '请输入地址', trigger: 'blur' }],
  port: [
    { required: true, message: '请输入端口', trigger: 'blur' },
    { type: 'number', min: 1, max: 65535, message: '端口范围 1-65535', trigger: 'blur' }
  ],
}

// 预设设备（从后端API加载）
const presetCategories = ref<string[]>([])
const presets = ref<any[]>([])

async function loadPresets() {
  try {
    const data = await devicesApi.getPresets()
    presets.value = data.presets || []
    // 从预设数据中提取分类
    const cats = new Set(presets.value.map(p => p.category).filter(Boolean))
    presetCategories.value = cats.size > 0 ? Array.from(cats).sort() : ['Modbus', 'MC协议', 'FINS', 'OPC UA', 'MQTT', 'REST']
  } catch (e: any) {
    console.warn('[Devices] 加载预设失败，使用本地默认:', e?.message || e)
    // 降级：使用本地默认预设
    presetCategories.value = ['Modbus', 'MC协议', 'FINS', 'OPC UA', 'MQTT', 'REST']
    presets.value = [
      { id: 'schneider_m340_01', name: '施耐德M340 PLC', protocol: 'modbus_tcp', category: 'Modbus', description: '施耐德M340 PLC - 水处理控制' },
      { id: 'abb_m4m_01', name: 'ABB M4M仪表', protocol: 'modbus_tcp', category: 'Modbus', description: 'ABB M4M电力监测仪表' },
      { id: 'siemens_1500_01', name: '西门子S7-1500', protocol: 'modbus_tcp', category: 'Modbus', description: '西门子S7-1500 PLC - 锅炉控制' },
      { id: 'fx5u_mc', name: '三菱FX5U (MC协议)', protocol: 'mc', category: 'MC协议', description: '三菱FX5U SLMP/3E帧协议' },
      { id: 'nj501_fins', name: '欧姆龙NJ501 (FINS)', protocol: 'fins', category: 'FINS', description: '欧姆龙NJ系列FINS/TCP协议' },
      { id: 'opcua_plc_01', name: 'OPC UA PLC', protocol: 'opcua', category: 'OPC UA', description: 'OPC UA PLC测试设备' },
      { id: 'vibration_sensor_01', name: 'MQTT振动传感器', protocol: 'mqtt', category: 'MQTT', description: 'MQTT振动监测节点' },
    ]
  }
}

const filteredPresets = computed(() => presets.value.filter(p => p.category === presetCategory.value))
const onlineCount = computed(() => devices.value.filter(d => (d as any).connected).length)
const offlineCount = computed(() => devices.value.length - onlineCount.value)

onMounted(() => { refreshDevices(); loadPresets() })

async function refreshDevices() {
  loading.value = true
  try {
    const data = await devicesApi.getAll()
    devices.value = data.devices || []
  } catch (e: any) { console.warn('[Devices] 加载失败:', e?.message || e) }
  finally { loading.value = false }
}

function showAddDialog() {
  isEdit.value = false
  Object.assign(form, { device_id: '', name: '', protocol: 'modbus_tcp', host: '127.0.0.1', port: 502, slave_id: 1, collection_interval: 5, enabled: true, registers: [] })
  dialogVisible.value = true
}

function editDevice(device: any) {
  isEdit.value = true
  Object.assign(form, { ...device, registers: device.registers ? [...device.registers] : [] })
  dialogVisible.value = true
}

function onProtocolChange(protocol: string) {
  const defaults: Record<string, any> = {
    modbus_tcp: { host: '127.0.0.1', port: 502 },
    modbus_rtu: { host: 'COM1', port: 9600 },
    mc: { host: '192.168.1.100', port: 5000 },
    fins: { host: '192.168.1.200', port: 9600 },
    opcua: { host: 'opc.tcp://localhost:4840', port: 4840 },
    mqtt: { host: 'localhost', port: 1883 },
    rest: { host: 'http://localhost:8080', port: 8080 },
  }
  const d = defaults[protocol]
  if (d) { form.host = d.host; form.port = d.port }
}

function addRegister() {
  form.registers.push({ name: '', description: '', address: 0, data_type: 'int16', scale: 1, unit: '', rw: 'r' })
}

async function saveDevice() {
  if (saving.value) return
  if (deviceFormRef.value) {
    try { await deviceFormRef.value.validate() } catch { return }
  }
  saving.value = true
  try {
    if (isEdit.value) {
      await devicesApi.update(form.device_id, form)
      ElMessage.success('设备更新成功')
    } else {
      // 后端要求 id/name 字段名
      const payload = {
        ...form,
        id: form.device_id,
      }
      await devicesApi.create(payload)
      ElMessage.success('设备添加成功')
    }
    dialogVisible.value = false
    refreshDevices()
  } catch (e: any) { showActionError('保存设备', e) }
  finally { saving.value = false }
}

async function deleteDevice(device: Device) {
  try {
    await devicesApi.delete(device.device_id)
    ElMessage.success('设备已删除')
    refreshDevices()
  } catch (e: any) { console.error('[Devices] 操作失败:', e); ElMessage.error('删除失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}

async function testDevice(device: Device) {
  try {
    const data = await devicesApi.test(device.device_id)
    testResult.success = data.success
    testResult.message = data.message
    testDialogVisible.value = true
  } catch (e: any) { console.error('[Devices] 操作失败:', e); ElMessage.error('测试失败: ' + (e?.response?.data?.error || e?.message || '未知错误')) }
}

function viewData(device: Device) {
  router.push({ path: '/history', query: { device: device.device_id } })
}

async function addPreset(preset: any) {
  if (presetBusy.value) return
  presetBusy.value = true
  try {
    // 后端失败时返回 200 + {success:false,message}，必须显式判断，否则会假成功
    const res: any = await api.post('/devices/presets/add', { preset_id: preset.id })
    if (res?.success === false) { ElMessage.error(res?.message || `添加预设「${preset.name}」失败`); return }
    ElMessage.success(`已添加: ${preset.name}`)
    refreshDevices()
  } catch (e: any) {
    // 之前只打 console，用户看不到任何反馈；改为明确报错
    showActionError(`添加预设「${preset.name}」`, e)
  } finally { presetBusy.value = false }
}

async function addAllPresets() {
  if (presetBusy.value) return
  presetBusy.value = true
  try {
    const res: any = await api.post('/devices/presets/add-all')
    if (res?.success === false) { ElMessage.error(res?.message || '添加全部预设失败'); return }
    ElMessage.success('全部预设设备已添加')
    refreshDevices()
  } catch (e: any) {
    showActionError('添加全部预设', e)
  } finally { presetBusy.value = false }
}

// 协议展示名（仅呈现层映射，不改动协议字段值）
function protocolLabel(p: string) {
  const map: Record<string, string> = {
    modbus_tcp: 'Modbus TCP', modbus_rtu: 'Modbus RTU', mc: '三菱 MC',
    fins: '欧姆龙 FINS', opcua: 'OPC UA', mqtt: 'MQTT', rest: 'REST',
  }
  return map[p] || p || '未知'
}
</script>

<style scoped>
.devices-page {
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

.panel__body--flush { padding: 0; }

/* ===== 操作栏 ===== */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.toolbar__actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.toolbar__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

/* ===== 预设卡片 ===== */
.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-3);
}

.preset-card {
  display: block;
  width: 100%;
  text-align: left;
  padding: var(--space-3);
  border: 1px solid var(--border-base);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  cursor: pointer;
  font-family: inherit;
  transition: border-color var(--duration-fast) var(--ease-out),
    background var(--duration-fast) var(--ease-out);
}

.preset-card:hover {
  border-color: var(--color-brand);
  background: var(--bg-hover);
}

.preset-card__name {
  font-size: var(--font-base);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  margin-bottom: var(--space-2);
}

.preset-card__tag { margin-bottom: var(--space-2); }

.preset-card__desc {
  font-size: var(--font-xs);
  color: var(--text-muted);
  line-height: var(--leading-base);
}

/* ===== 表格 ===== */
.device-table { width: 100%; }

.device-table :deep(.el-table__header th.el-table__cell) {
  background: var(--bg-sunken);
  color: var(--text-secondary);
  font-size: var(--font-sm);
  font-weight: var(--weight-semibold);
  height: 44px;
}

.device-table :deep(.el-table__body td.el-table__cell) {
  font-size: var(--font-sm);
  color: var(--text-primary);
  padding: var(--space-3) 0;
}

.device-table :deep(.el-table__cell) {
  padding: var(--space-3) 0;
}

.mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

/* ===== 行操作分组 ===== */
.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  white-space: nowrap;
}

.row-actions__sep {
  width: 1px;
  height: 14px;
  background: var(--border-base);
  flex: none;
}

.btn-danger-link { color: var(--color-danger); }

.btn-danger-link:hover {
  color: var(--color-danger);
  background: var(--color-danger-soft);
}

/* ===== 表单 ===== */
.device-form { font-size: var(--font-base); }

.device-form :deep(.el-form-item__label) {
  font-size: var(--font-sm);
  color: var(--text-secondary);
  padding-right: var(--space-3);
}

.device-form :deep(.el-form-item) { margin-bottom: var(--space-4); }

.form-section-title {
  font-size: var(--font-sm);
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  margin: var(--space-2) 0 var(--space-3);
  padding-left: var(--space-2);
  border-left: 3px solid var(--color-brand);
}

.register-row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  margin-bottom: var(--space-2);
  flex-wrap: wrap;
}
</style>
