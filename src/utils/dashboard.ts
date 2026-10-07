/**
 * dashboard.ts — Dashboard 页面的**纯函数**层
 *
 * 为什么存在
 * ----------
 * `views/Dashboard.vue` 是一个 1912 行的 SFC，里面混着三类东西：
 *   ① 数据契约（实时数据解析、质量码归一化）
 *   ② 业务规则（设备状态分类、告警聚合、排序优先级）
 *   ③ 视图胶水（echarts / socket / element-plus）
 *
 * ①② 是**有回归价值**的部分，但它们原先内联在组件里、没有导出，
 * 于是测试只能**手抄一份同名逻辑**再断言它自己 ——
 * `tests/components/Dashboard.test.ts` 的注释里自己写明了这一点。
 * 手抄副本只能证明「算法意图」，**拦不住组件里的回归**：
 * 组件改错了、副本没改，测试照样绿。
 *
 * 本模块把那部分逻辑抽成不依赖 Vue / echarts / socket 的纯函数，
 * 让测试可以直接测**真实现**。
 *
 * 边界
 * ----
 * - 不 import Vue、不 import echarts、不 import socket.io —— 纯函数，可直接单测。
 * - 只搬运，**不改行为**。每条函数上方都写明它原来在哪一行、语义是什么。
 * - 视图层该做的事（ref/computed/渲染）仍留在 `Dashboard.vue`。
 *
 * ⚠️ 一个已发现的**跨组件不一致**（本轮只记录、不修，改了就是行为变更）：
 *   同名函数 `levelKey` 在 4 个 view 里各有一份实现，且**兜底值不同**：
 *     - `Dashboard.vue` / `Screen.vue`：`'critical' | 'warning' | 'info'`，兜底 `'info'`
 *     - `Alarms.vue`：另一套
 *     - `AlarmOutput.vue`：兜底 `'normal'`
 *   谁哪天想「统一」它们，会静默改掉 UI 行为。要收敛得先定口径。
 */

// ==========================================================================
// 报警等级
// ==========================================================================

export type AlarmLevelKey = 'critical' | 'warning' | 'info'

/**
 * 报警等级归一化。原 `Dashboard.vue:893`。
 *
 * 只认 `critical` / `warning`，其余（含 `info`、`medium`、空值、脏值）一律归 `info`。
 * **注意**：这是 Dashboard 的口径，与其他 view 的同名函数**不一致**（见文件头说明）。
 */
export function levelKey(level: string | null | undefined): AlarmLevelKey {
  return level === 'critical' ? 'critical' : level === 'warning' ? 'warning' : 'info'
}

// ==========================================================================
// 设备
// ==========================================================================

/**
 * 设备的结构化视图。
 *
 * 刻意**不** import `@/api` 的 `DeviceStatus`：
 * 那个类型来自后端契约，会随接口演进而变；纯函数层只依赖它真正用到的字段，
 * 这样测试构造夹具时不必满足整个类型。
 */
export interface DeviceLike {
  device_id?: string
  id?: string
  connected?: boolean
  stopped?: boolean
  status?: string
  device_category?: string
  protocol?: string
}

/** 设备 ID。原 `Dashboard.vue:735`（`device_id` 优先，退回 `id`，都没有给空串）。 */
export function deviceIdOf(d: DeviceLike | null | undefined): string {
  if (!d) return ''
  return d.device_id || d.id || ''
}

export interface DeviceAlarmInfo {
  total: number
  unacked: number
  worst: AlarmLevelKey
}

/** 参与聚合的最小报警形状。 */
export interface AlarmLike {
  device_id?: string
  alarm_level?: string
  acknowledged?: boolean
}

/**
 * 按 `device_id` 聚合报警。原 `Dashboard.vue:372-384` 的 `alarmByDevice` computed。
 *
 * 为什么需要它：后端 `/api/system/status` 的 `devices[]` **实测不下发 `status` 字段**，
 * 所以「这台设备有没有告警」只能从 `alarms` 列表聚合 —— 早先依赖 `d.status`
 * 导致告警台数**恒为 0**（代码里留了这条注释）。
 *
 * `worst` 的升级规则：`critical` 直接覆盖；`warning` 只在当前还是 `info` 时覆盖
 * （即**不会**把 `critical` 降级成 `warning`）。
 */
export function aggregateAlarmsByDevice(alarms: AlarmLike[] | null | undefined): Record<string, DeviceAlarmInfo> {
  const map: Record<string, DeviceAlarmInfo> = {}
  if (!Array.isArray(alarms)) return map
  alarms.forEach((a) => {
    const id = a?.device_id
    if (!id) return
    const lvl = levelKey(a.alarm_level)
    const info = map[id] || (map[id] = { total: 0, unacked: 0, worst: 'info' })
    info.total++
    if (!a.acknowledged) info.unacked++
    if (lvl === 'critical' || (lvl === 'warning' && info.worst === 'info')) info.worst = lvl
  })
  return map
}

export type DeviceStateKey = 'offline' | 'fault' | 'warning' | 'stopped' | 'online'

/**
 * 设备状态色条分类。原 `Dashboard.vue:738-745`。
 *
 * 优先级：**离线 > 活动告警（严重=红 / 一般=黄）> 停机 > 运行**。
 * 注意 `d.status === 'fault'` 只降级成 `'warning'`（不是 `'fault'`）——
 * 因为后端实测不下发 `status`，这个分支基本走不到，但语义要保留。
 */
export function deviceStateOf(d: DeviceLike, alarm: DeviceAlarmInfo | null | undefined): DeviceStateKey {
  if (!d.connected) return 'offline'
  if (alarm) return alarm.worst === 'critical' ? 'fault' : 'warning'
  if (d.stopped) return 'stopped'
  if (d.status === 'fault' || d.status === 'warning') return 'warning'
  return 'online'
}

/** 状态标签的 CSS 类。原 `Dashboard.vue:746-753` 的 `statusTagClass`。 */
export function deviceStateTagClass(state: DeviceStateKey): string {
  if (state === 'online') return 'tag--success'
  if (state === 'stopped') return 'tag--info'
  if (state === 'offline') return 'tag--offline'
  if (state === 'fault') return 'tag--danger'
  return 'tag--warning'
}

/** 状态中文文案。原 `Dashboard.vue:754-760`。 */
export function deviceStateText(d: DeviceLike, alarm: DeviceAlarmInfo | null | undefined): string {
  if (!d.connected) return '离线'
  if (alarm) return '告警'
  if (d.stopped) return '已停止'
  if (d.status === 'fault' || d.status === 'warning') return '告警'
  return '运行中'
}

/**
 * 排序优先级（数字越小越靠前）。原 `Dashboard.vue:397-403`。
 *
 * 未确认告警 > 已确认告警 > 离线 > 停机 > 正常 —— 让操作员先看到异常设备。
 */
export function devicePriority(d: DeviceLike, alarm: DeviceAlarmInfo | null | undefined): number {
  if (alarm) return alarm.unacked > 0 ? 0 : 1
  if (!d.connected) return 2
  if (d.stopped) return 3
  return 4
}

/** 设备排序：先按优先级，同优先级按设备 ID 字典序。原 `Dashboard.vue:404-408`。 */
export function compareDevices(
  a: DeviceLike,
  b: DeviceLike,
  alarmMap: Record<string, DeviceAlarmInfo> = {},
): number {
  const pa = devicePriority(a, alarmMap[deviceIdOf(a)] || null)
  const pb = devicePriority(b, alarmMap[deviceIdOf(b)] || null)
  if (pa !== pb) return pa - pb
  return deviceIdOf(a).localeCompare(deviceIdOf(b))
}

export interface DeviceStateCounts {
  total: number
  online: number
  offline: number
  fault: number
  mechanical: number
}

/**
 * 各状态设备台数。原 `Dashboard.vue:418-422` 的四个 computed。
 *
 * `fault` 口径是「**有活动报警的设备数**」，不是 `status === 'fault'` 的设备数
 * （见 `aggregateAlarmsByDevice` 的说明）。
 */
export function countDeviceStates(
  devices: DeviceLike[] | null | undefined,
  alarmMap: Record<string, DeviceAlarmInfo> = {},
): DeviceStateCounts {
  const list = Array.isArray(devices) ? devices : []
  return {
    total: list.length,
    online: list.filter((d) => d.connected).length,
    offline: list.filter((d) => !d.connected).length,
    fault: list.filter((d) => !!alarmMap[deviceIdOf(d)]).length,
    mechanical: list.filter((d) => d.device_category === 'mechanical').length,
  }
}

export type DeviceFilterKey = 'all' | 'online' | 'offline' | 'fault' | 'mechanical'

/**
 * 按筛选条件 + 协议筛选过滤，并按 `compareDevices` 排序。
 * 原 `Dashboard.vue:424-433` 的 `filteredDeviceList` computed。
 *
 * 排序前先 `slice()` 复制 —— **不改动传入数组的顺序**（原实现特意留了注释）。
 *
 * 泛型 `T extends DeviceLike` 是为了**保留调用方的元素类型**：
 * 组件传进来的是 `DeviceStatus[]`，模板后续要按 `DeviceStatus` 用它；
 * 若这里退化成 `DeviceLike[]`，调用点会全线类型不兼容。
 */
export function filterDevices<T extends DeviceLike>(
  devices: T[] | null | undefined,
  filter: string = 'all',
  protocolFilter = '',
  alarmMap: Record<string, DeviceAlarmInfo> = {},
): T[] {
  let list: T[] = Array.isArray(devices) ? devices : []
  if (filter === 'online') list = list.filter((d) => d.connected)
  else if (filter === 'offline') list = list.filter((d) => !d.connected)
  else if (filter === 'fault') list = list.filter((d) => !!alarmMap[deviceIdOf(d)])
  else if (filter === 'mechanical') list = list.filter((d) => d.device_category === 'mechanical')
  if (protocolFilter) list = list.filter((d) => (d.protocol || 'modbus_tcp') === protocolFilter)
  return list.slice().sort((a, b) => compareDevices(a, b, alarmMap))
}

/** 协议下拉选项：出现过的协议去重后排序，缺省按 `modbus_tcp`。原 `Dashboard.vue:423`。 */
export function protocolOptions(devices: DeviceLike[] | null | undefined): string[] {
  const list = Array.isArray(devices) ? devices : []
  return Array.from(new Set(list.map((d) => d.protocol || 'modbus_tcp'))).sort()
}

// ==========================================================================
// 实时数据 / WebSocket 报文
// ==========================================================================

/** 实时数据的桶键：`<device_id>:<register_name>`。原 `Dashboard.vue:971` 的 `bufferKey`。 */
export function realtimeKey(deviceId: string, registerName: string): string {
  return `${deviceId}:${registerName}`
}

/**
 * 质量码归一化。原 `Dashboard.vue:960-964`。
 *
 * 只接受**有限数值**，其余一律 `null`。
 *
 * 为什么必须收敛：下游做的是 `q >= 192` 的**数值比较**，而质量码在链路上有三种
 * 同名不同义的形态（OPC UA 数值码 / 模拟客户端的字符串标记 / OEE 的 0~1 质量率）。
 * 直接写进 `deviceQuality` 会让 `'BAD' >= 192` 静默求值为 `false` ——
 * 判成 Bad 却不报错，属最难查的一类 bug。`null` 会走「用报警阈值补语义色」的
 * 降级分支，是安全的默认行为。
 */
export function normalizeQuality(raw: unknown): number | null {
  if (raw == null) return null
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : null
}

/** 质量码文案（OPC UA 口径）。原 `Dashboard.vue:965-968` 的 `getQualityLabel`。 */
export function qualityLabel(q: number | null | undefined): string {
  if (q == null) return ''
  return q >= 192 ? 'Good' : q >= 64 ? 'Uncertain' : 'Bad'
}

/** 一条实时数据归一化后的形态。 */
export interface RealtimeUpdate {
  /** `realtimeKey(deviceId, registerName)` */
  key: string
  /** `parseFloat` 后的数值（非有限数一律丢弃，不会出现在结果里） */
  value: number
  /** 单位，缺省 `undefined` */
  unit?: string
  /** 归一化后的质量码；无法解析为有限数时为 `null` */
  quality: number | null
}

function toUpdate(
  deviceId: unknown,
  registerName: unknown,
  rawValue: unknown,
  rawQuality?: unknown,
  unit?: unknown,
): RealtimeUpdate | null {
  if (!deviceId || !registerName || rawValue == null) return null
  const value = typeof rawValue === 'number' ? rawValue : parseFloat(String(rawValue))
  // ⚠️ 这里比原实现**多了一道守卫**，是有意为之（唯一的非纯搬运点）：
  //   原实现直接 `parseFloat(item.value)` 写进桶，值不可解析时会把 `NaN` 存进去，
  //   卡片上渲染成字面量 "NaN"；而同一份数据在 `updateTrendChart` 里被
  //   `Number.isFinite(v)` 挡掉了 → **同一条数据在卡片与趋势图里表现不一致**。
  //   现在两边口径统一：不可解析就丢弃（卡片显示 "--"）。
  if (!Number.isFinite(value)) return null
  const out: RealtimeUpdate = {
    key: realtimeKey(String(deviceId), String(registerName)),
    value,
    quality: normalizeQuality(rawQuality),
  }
  // 与原实现一致：单位只在**真值**时写入（`if (item.unit)`），空串不写。
  if (unit) out.unit = String(unit)
  return out
}

/**
 * 解析**轮询接口** `/api/data/realtime` 返回的单条记录。
 * 原 `Dashboard.vue:538-549`（`data.data.forEach` 内那段）。
 *
 * 形状：`{device_id, register_name, value, unit?, quality?}`。
 */
export function parseRealtimeItem(item: Record<string, unknown> | null | undefined): RealtimeUpdate | null {
  if (!item || typeof item !== 'object') return null
  return toUpdate(item.device_id, item.register_name, item.value, item.quality, item.unit)
}

/**
 * 解析 **WebSocket `data_update` 载荷**。原 `Dashboard.vue:1186-1210`。
 *
 * 兼容两种格式：
 *   ① **单对象**：`{device_id, register_name, value, quality?}`
 *   ② **映射**：`{<register_name>: {device_id, value, quality?}, ...}`
 *
 * 注：后端 `展示层/websocket.py` 的推送路径**固定发映射格式**，
 * 单对象分支是给将来的定向推送留的兼容入口 —— 所以两种都要测。
 *
 * 返回**更新列表**而不是就地改两个对象，这样这个函数是纯的、可直接断言。
 */
export function parseRealtimePayload(data: unknown): RealtimeUpdate[] {
  if (!data || typeof data !== 'object') return []
  const obj = data as Record<string, any>

  // ① 单对象
  if (obj.device_id && obj.register_name && obj.value != null) {
    const one = toUpdate(obj.device_id, obj.register_name, obj.value, obj.quality)
    return one ? [one] : []
  }

  // ② 映射
  const out: RealtimeUpdate[] = []
  Object.entries(obj).forEach(([regName, info]) => {
    if (!info || typeof info !== 'object') return
    const upd = toUpdate((info as any).device_id, regName, (info as any).value, (info as any).quality)
    if (upd) out.push(upd)
  })
  return out
}

/**
 * 往环形缓冲追加一个点，并把长度压到 `cap`。原 `Dashboard.vue:1037-1039`。
 *
 * 就地修改 `buf`（与组件里 `dataBuffers[key].push` + `while(shift)` 的行为一致）——
 * `dataBuffers` 是非响应式的普通对象，靠 `bufferVersion` 版本号驱动重算。
 *
 * @returns 本次是否发生了裁剪（`true` 表示丢过旧点）
 */
export function pushCapped<T>(buf: T[], item: T, cap: number): boolean {
  buf.push(item)
  // 与原实现一致：`cap` 不是有限正数时**不裁剪**（原式 `length > NaN` 恒为 false）。
  // 这条分支正常走不到（调用方给的是 200 / 20 两个常量），但口径要保留，
  // 免得将来有人传了脏 cap 就把整个缓冲清空。
  if (!Number.isFinite(cap) || cap <= 0) return false
  let trimmed = false
  while (buf.length > cap) {
    buf.shift()
    trimmed = true
  }
  return trimmed
}
