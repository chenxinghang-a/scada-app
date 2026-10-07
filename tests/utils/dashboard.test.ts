import { describe, it, expect } from 'vitest'
import {
  levelKey,
  deviceIdOf,
  aggregateAlarmsByDevice,
  deviceStateOf,
  deviceStateTagClass,
  deviceStateText,
  devicePriority,
  compareDevices,
  countDeviceStates,
  filterDevices,
  protocolOptions,
  realtimeKey,
  normalizeQuality,
  qualityLabel,
  parseRealtimeItem,
  parseRealtimePayload,
  pushCapped,
} from '@/utils/dashboard'

/**
 * `src/utils/dashboard.ts` 的行为契约。
 *
 * 这个文件取代了原先 `tests/components/Dashboard.test.ts` 里的**手抄副本**断言 ——
 * 那些用例把组件里的逻辑抄一遍再断言抄件，只能证明「算法意图」，
 * **拦不住组件里的回归**（组件改错、抄件没改，测试照样绿）。
 * 现在测的是组件真正调用的那份实现。
 */

describe('levelKey —— 报警等级归一化', () => {
  it('critical / warning 原样保留', () => {
    expect(levelKey('critical')).toBe('critical')
    expect(levelKey('warning')).toBe('warning')
  })

  it('其余一律归 info（含 info / 未知 / 空 / null）', () => {
    expect(levelKey('info')).toBe('info')
    expect(levelKey('medium')).toBe('info')
    expect(levelKey('')).toBe('info')
    expect(levelKey(null)).toBe('info')
    expect(levelKey(undefined)).toBe('info')
  })

  it('大小写敏感 —— "Critical" 归 info（口径如此，别当 bug 改）', () => {
    expect(levelKey('Critical')).toBe('info')
  })
})

describe('deviceIdOf', () => {
  it('device_id 优先，退回 id', () => {
    expect(deviceIdOf({ device_id: 'a', id: 'b' })).toBe('a')
    expect(deviceIdOf({ id: 'b' })).toBe('b')
  })

  it('都没有 / 传 null 给空串（不抛异常）', () => {
    expect(deviceIdOf({})).toBe('')
    expect(deviceIdOf(null)).toBe('')
    expect(deviceIdOf(undefined)).toBe('')
  })
})

describe('aggregateAlarmsByDevice —— 按 device_id 聚合', () => {
  it('统计 total / unacked，worst 取最高级', () => {
    const map = aggregateAlarmsByDevice([
      { device_id: 'd1', alarm_level: 'warning', acknowledged: true },
      { device_id: 'd1', alarm_level: 'critical', acknowledged: false },
      { device_id: 'd2', alarm_level: 'info', acknowledged: false },
    ])
    expect(map.d1).toEqual({ total: 2, unacked: 1, worst: 'critical' })
    expect(map.d2).toEqual({ total: 1, unacked: 1, worst: 'info' })
  })

  it('warning 不会把已经升到 critical 的 worst 降级', () => {
    const map = aggregateAlarmsByDevice([
      { device_id: 'd1', alarm_level: 'critical' },
      { device_id: 'd1', alarm_level: 'warning' },
    ])
    expect(map.d1.worst).toBe('critical')
  })

  it('info 不会覆盖 warning', () => {
    const map = aggregateAlarmsByDevice([
      { device_id: 'd1', alarm_level: 'warning' },
      { device_id: 'd1', alarm_level: 'info' },
    ])
    expect(map.d1.worst).toBe('warning')
  })

  it('缺 device_id 的报警被跳过（不聚到 "" 键上）', () => {
    const map = aggregateAlarmsByDevice([
      { alarm_level: 'critical' },
      { device_id: '', alarm_level: 'critical' },
      { device_id: 'd1', alarm_level: 'info' },
    ])
    expect(Object.keys(map)).toEqual(['d1'])
  })

  it('空 / 非数组输入返回空映射（不抛异常）', () => {
    expect(aggregateAlarmsByDevice([])).toEqual({})
    expect(aggregateAlarmsByDevice(null)).toEqual({})
    expect(aggregateAlarmsByDevice(undefined)).toEqual({})
    expect(aggregateAlarmsByDevice('x' as never)).toEqual({})
  })

  it('acknowledged 缺省视为未确认', () => {
    const map = aggregateAlarmsByDevice([{ device_id: 'd1', alarm_level: 'info' }])
    expect(map.d1.unacked).toBe(1)
  })
})

describe('deviceStateOf —— 优先级：离线 > 告警 > 停机 > 运行', () => {
  it('未连接 → offline（即使有告警）', () => {
    expect(deviceStateOf({ connected: false }, { total: 1, unacked: 1, worst: 'critical' })).toBe('offline')
  })

  it('critical 告警 → fault', () => {
    expect(deviceStateOf({ connected: true }, { total: 1, unacked: 0, worst: 'critical' })).toBe('fault')
  })

  it('warning 告警 → warning', () => {
    expect(deviceStateOf({ connected: true }, { total: 1, unacked: 0, worst: 'warning' })).toBe('warning')
  })

  it('info 告警 → warning（有告警就算 warning 态）', () => {
    expect(deviceStateOf({ connected: true }, { total: 1, unacked: 0, worst: 'info' })).toBe('warning')
  })

  it('无告警 + stopped → stopped', () => {
    expect(deviceStateOf({ connected: true, stopped: true }, null)).toBe('stopped')
  })

  it('无告警 + d.status=fault → warning（不是 fault，口径如此）', () => {
    expect(deviceStateOf({ connected: true, status: 'fault' }, null)).toBe('warning')
    expect(deviceStateOf({ connected: true, status: 'warning' }, null)).toBe('warning')
  })

  it('正常 → online', () => {
    expect(deviceStateOf({ connected: true }, null)).toBe('online')
    expect(deviceStateOf({ connected: true, status: 'running' }, null)).toBe('online')
  })
})

describe('deviceStateTagClass / deviceStateText', () => {
  it('状态类映射', () => {
    expect(deviceStateTagClass('online')).toBe('tag--success')
    expect(deviceStateTagClass('stopped')).toBe('tag--info')
    expect(deviceStateTagClass('offline')).toBe('tag--offline')
    expect(deviceStateTagClass('fault')).toBe('tag--danger')
    expect(deviceStateTagClass('warning')).toBe('tag--warning')
  })

  it('文案与 deviceStateOf 的分支一致', () => {
    expect(deviceStateText({ connected: false }, { total: 1, unacked: 1, worst: 'critical' })).toBe('离线')
    expect(deviceStateText({ connected: true }, { total: 1, unacked: 0, worst: 'info' })).toBe('告警')
    expect(deviceStateText({ connected: true, stopped: true }, null)).toBe('已停止')
    expect(deviceStateText({ connected: true, status: 'fault' }, null)).toBe('告警')
    expect(deviceStateText({ connected: true }, null)).toBe('运行中')
  })
})

describe('devicePriority / compareDevices —— 异常设备置顶', () => {
  it('未确认告警 0 > 已确认告警 1 > 离线 2 > 停机 3 > 正常 4', () => {
    expect(devicePriority({ connected: true }, { total: 1, unacked: 1, worst: 'info' })).toBe(0)
    expect(devicePriority({ connected: true }, { total: 1, unacked: 0, worst: 'info' })).toBe(1)
    expect(devicePriority({ connected: false }, null)).toBe(2)
    expect(devicePriority({ connected: true, stopped: true }, null)).toBe(3)
    expect(devicePriority({ connected: true }, null)).toBe(4)
  })

  it('同优先级按设备 ID 字典序', () => {
    const list = [
      { device_id: 'c', connected: true },
      { device_id: 'a', connected: true },
      { device_id: 'b', connected: true },
    ]
    expect(list.slice().sort((x, y) => compareDevices(x, y, {})).map(deviceIdOf)).toEqual(['a', 'b', 'c'])
  })

  it('告警设备排在正常设备之前', () => {
    const alarmMap = aggregateAlarmsByDevice([{ device_id: 'z', alarm_level: 'critical', acknowledged: false }])
    const list = [
      { device_id: 'a', connected: true },
      { device_id: 'z', connected: true },
    ]
    expect(list.slice().sort((x, y) => compareDevices(x, y, alarmMap)).map(deviceIdOf)).toEqual(['z', 'a'])
  })
})

describe('countDeviceStates', () => {
  const devices = [
    { device_id: 'd1', connected: true },
    { device_id: 'd2', connected: false },
    { device_id: 'd3', connected: true, device_category: 'mechanical' },
    { device_id: 'd4', connected: true },
  ]

  it('统计总数 / 在线 / 离线 / 机械', () => {
    const c = countDeviceStates(devices, {})
    expect(c.total).toBe(4)
    expect(c.online).toBe(3)
    expect(c.offline).toBe(1)
    expect(c.mechanical).toBe(1)
  })

  it('fault 口径 = **有活动报警的设备数**，不是 status=fault 的设备数', () => {
    // 这条是真实踩过的坑：早先依赖后端不下发的 d.status → 告警台数恒为 0
    const alarmMap = aggregateAlarmsByDevice([{ device_id: 'd4', alarm_level: 'critical' }])
    const c = countDeviceStates(devices, alarmMap)
    expect(c.fault).toBe(1)
    // 就算设备自己声称 status=fault，没有报警也不算
    expect(countDeviceStates([{ device_id: 'x', connected: true, status: 'fault' }], {}).fault).toBe(0)
  })

  it('空 / 非数组输入给全 0', () => {
    expect(countDeviceStates([], {})).toEqual({ total: 0, online: 0, offline: 0, fault: 0, mechanical: 0 })
    expect(countDeviceStates(null, {})).toEqual({ total: 0, online: 0, offline: 0, fault: 0, mechanical: 0 })
  })
})

describe('filterDevices', () => {
  const devices = [
    { device_id: 'd1', connected: true, protocol: 'modbus_tcp' },
    { device_id: 'd2', connected: false, protocol: 'opcua' },
    { device_id: 'd3', connected: true, device_category: 'mechanical', protocol: 'modbus_tcp' },
  ]
  const alarmMap = aggregateAlarmsByDevice([{ device_id: 'd3', alarm_level: 'critical' }])

  it('all → 全部', () => {
    expect(filterDevices(devices, 'all', '', alarmMap).length).toBe(3)
  })

  it('online / offline / fault / mechanical 各自口径', () => {
    // 注意 d3 有活动报警 → 排序时置顶，所以 online 是 ['d3','d1'] 而不是 ['d1','d3']
    expect(filterDevices(devices, 'online', '', alarmMap).map(deviceIdOf)).toEqual(['d3', 'd1'])
    expect(filterDevices(devices, 'offline', '', alarmMap).map(deviceIdOf)).toEqual(['d2'])
    expect(filterDevices(devices, 'fault', '', alarmMap).map(deviceIdOf)).toEqual(['d3'])
    expect(filterDevices(devices, 'mechanical', '', alarmMap).map(deviceIdOf)).toEqual(['d3'])
  })

  it('协议筛选：缺省按 modbus_tcp', () => {
    expect(filterDevices(devices, 'all', 'opcua', alarmMap).map(deviceIdOf)).toEqual(['d2'])
    expect(filterDevices(devices, 'all', 'modbus_tcp', alarmMap).map(deviceIdOf)).toEqual(['d3', 'd1'])
  })

  it('筛选 + 协议叠加', () => {
    expect(filterDevices(devices, 'online', 'modbus_tcp', alarmMap).map(deviceIdOf)).toEqual(['d3', 'd1'])
  })

  it('**不改动传入数组的顺序**（排序前先复制）', () => {
    const original = [
      { device_id: 'z', connected: true },
      { device_id: 'a', connected: true },
    ]
    const snapshot = original.map(deviceIdOf)
    filterDevices(original, 'all', '', {})
    expect(original.map(deviceIdOf)).toEqual(snapshot)
  })

  it('告警设备被排到前面', () => {
    expect(filterDevices(devices, 'all', '', alarmMap).map(deviceIdOf)[0]).toBe('d3')
  })

  it('空 / 非数组输入返回空数组', () => {
    expect(filterDevices([], 'all', '', {})).toEqual([])
    expect(filterDevices(null, 'all', '', {})).toEqual([])
  })
})

describe('protocolOptions', () => {
  it('去重 + 排序 + 缺省补 modbus_tcp', () => {
    expect(protocolOptions([
      { protocol: 'opcua' },
      { protocol: 'modbus_tcp' },
      { protocol: 'opcua' },
      {},
    ])).toEqual(['modbus_tcp', 'opcua'])
  })

  it('空输入给空数组', () => {
    expect(protocolOptions([])).toEqual([])
    expect(protocolOptions(null)).toEqual([])
  })
})

describe('realtimeKey', () => {
  it('拼成 device_id:register_name', () => {
    expect(realtimeKey('d1', 'temperature')).toBe('d1:temperature')
  })
})

describe('normalizeQuality —— 收敛三种同名不同义的质量码', () => {
  it('有限数值原样通过（含 0 —— 0 是合法的 Bad 码，不能被当成假值丢掉）', () => {
    expect(normalizeQuality(192)).toBe(192)
    expect(normalizeQuality(0)).toBe(0)
    expect(normalizeQuality('64')).toBe(64)
  })

  it('字符串标记 / 非有限数一律 null', () => {
    expect(normalizeQuality('BAD')).toBeNull()
    expect(normalizeQuality('Good')).toBeNull()
    expect(normalizeQuality(NaN)).toBeNull()
    expect(normalizeQuality(Infinity)).toBeNull()
    expect(normalizeQuality(null)).toBeNull()
    expect(normalizeQuality(undefined)).toBeNull()
  })

  it('**关键**：字符串质量码直接参与 `q >= 192` 比较会静默判假 —— 必须先归一化', () => {
    // 这就是为什么必须收敛：'BAD' >= 192 在 JS 里求值为 false，
    // 不报错、不抛异常，只是静默把坏码当成「不满足 Good」——
    // 一旦下游逻辑写成 `q >= 192 ? good : bad`，字符串会一路落到 bad 分支看起来「对」，
    // 但任何 `q < 64` 之类的判断都会错。归一成 null 后走降级分支，行为是明确的。
    const bad = 'BAD' as unknown as number
    expect(bad >= 192).toBe(false)
    expect(normalizeQuality('BAD')).toBeNull()
  })
})

describe('qualityLabel', () => {
  it('OPC UA 口径：>=192 Good / >=64 Uncertain / 其余 Bad', () => {
    expect(qualityLabel(192)).toBe('Good')
    expect(qualityLabel(200)).toBe('Good')
    expect(qualityLabel(64)).toBe('Uncertain')
    expect(qualityLabel(191)).toBe('Uncertain')
    expect(qualityLabel(0)).toBe('Bad')
    expect(qualityLabel(63)).toBe('Bad')
  })

  it('null / undefined 给空串（不显示 Bad）', () => {
    expect(qualityLabel(null)).toBe('')
    expect(qualityLabel(undefined)).toBe('')
  })
})

describe('parseRealtimeItem —— 轮询接口单条记录', () => {
  it('完整记录解析出 key / value / unit / quality', () => {
    expect(parseRealtimeItem({
      device_id: 'd1', register_name: 'temperature', value: '25.5', unit: '℃', quality: 192,
    })).toEqual({ key: 'd1:temperature', value: 25.5, unit: '℃', quality: 192 })
  })

  it('数值型 value 直接可用', () => {
    expect(parseRealtimeItem({ device_id: 'd1', register_name: 'r', value: 1.5 })?.value).toBe(1.5)
  })

  it('缺 device_id / register_name / value 一律 null', () => {
    expect(parseRealtimeItem({ register_name: 'r', value: 1 })).toBeNull()
    expect(parseRealtimeItem({ device_id: 'd1', value: 1 })).toBeNull()
    expect(parseRealtimeItem({ device_id: 'd1', register_name: 'r' })).toBeNull()
    expect(parseRealtimeItem({ device_id: 'd1', register_name: 'r', value: null })).toBeNull()
  })

  it('**不可解析的 value 被丢弃**（不再把 NaN 写进桶渲染成 "NaN"）', () => {
    expect(parseRealtimeItem({ device_id: 'd1', register_name: 'r', value: 'abc' })).toBeNull()
    expect(parseRealtimeItem({ device_id: 'd1', register_name: 'r', value: '' })).toBeNull()
    expect(parseRealtimeItem({ device_id: 'd1', register_name: 'r', value: {} })).toBeNull()
  })

  it('unit 只在真值时写入（空串不写）', () => {
    expect(parseRealtimeItem({ device_id: 'd1', register_name: 'r', value: 1, unit: '' })?.unit).toBeUndefined()
    expect(parseRealtimeItem({ device_id: 'd1', register_name: 'r', value: 1 })?.unit).toBeUndefined()
  })

  it('quality 无法解析时给 null（不是 undefined，也不是 NaN）', () => {
    expect(parseRealtimeItem({ device_id: 'd1', register_name: 'r', value: 1, quality: 'BAD' })?.quality).toBeNull()
    expect(parseRealtimeItem({ device_id: 'd1', register_name: 'r', value: 1 })?.quality).toBeNull()
  })

  it('null / 非对象输入给 null', () => {
    expect(parseRealtimeItem(null)).toBeNull()
    expect(parseRealtimeItem(undefined)).toBeNull()
  })
})

describe('parseRealtimePayload —— WebSocket data_update 两种格式', () => {
  it('① 单对象格式', () => {
    expect(parseRealtimePayload({ device_id: 'dev1', register_name: 'temperature', value: '25.5' }))
      .toEqual([{ key: 'dev1:temperature', value: 25.5, quality: null }])
  })

  it('② 映射格式（后端 websocket.py 实际发的就是这种）', () => {
    const out = parseRealtimePayload({
      temperature: { device_id: 'dev1', value: '25.5' },
      pressure: { device_id: 'dev1', value: '1.2', quality: 192 },
    })
    expect(out).toHaveLength(2)
    expect(out).toContainEqual({ key: 'dev1:temperature', value: 25.5, quality: null })
    expect(out).toContainEqual({ key: 'dev1:pressure', value: 1.2, quality: 192 })
  })

  it('映射格式的键是 register_name（不是对象里的字段）', () => {
    const out = parseRealtimePayload({ r1: { device_id: 'd', value: 1, register_name: 'ignored' } })
    expect(out[0].key).toBe('d:r1')
  })

  it('单对象与映射同时满足条件时，走单对象分支（与原实现的 if/else 一致）', () => {
    const out = parseRealtimePayload({
      device_id: 'd1', register_name: 'r1', value: 1,
      other: { device_id: 'd2', value: 2 },
    })
    expect(out).toEqual([{ key: 'd1:r1', value: 1, quality: null }])
  })

  it('映射里非对象 / 缺字段 / 值不可解析的条目被跳过', () => {
    const out = parseRealtimePayload({
      a: null,
      b: 'not-an-object',
      c: { value: 1 },
      d: { device_id: 'd1' },
      e: { device_id: 'd1', value: 'abc' },
      ok: { device_id: 'd1', value: 1 },
    })
    expect(out).toEqual([{ key: 'd1:ok', value: 1, quality: null }])
  })

  it('空 / null / 非对象输入给空数组（不抛异常）', () => {
    expect(parseRealtimePayload(null)).toEqual([])
    expect(parseRealtimePayload(undefined)).toEqual([])
    expect(parseRealtimePayload('x')).toEqual([])
    expect(parseRealtimePayload({})).toEqual([])
  })

  it('质量码随报文透出（WS 载荷来自 SQLite 行，quality 曾是缺失列）', () => {
    expect(parseRealtimePayload({ r: { device_id: 'd', value: 1, quality: 0 } })[0].quality).toBe(0)
    expect(parseRealtimePayload({ device_id: 'd', register_name: 'r', value: 1, quality: 64 })[0].quality).toBe(64)
  })
})

describe('pushCapped —— 环形缓冲裁剪', () => {
  it('未超上限时不裁剪', () => {
    const buf: number[] = []
    expect(pushCapped(buf, 1, 3)).toBe(false)
    expect(buf).toEqual([1])
  })

  it('超上限时丢最旧的（保留末尾 cap 个）', () => {
    const buf: number[] = []
    for (let i = 1; i <= 5; i++) pushCapped(buf, i, 3)
    expect(buf).toEqual([3, 4, 5])
    expect(buf.length).toBe(3)
  })

  it('**缓冲已经超上限时一次清干净**（不是只丢一个）', () => {
    // 真实场景：切换选中设备时 cap 会从 MAX_CHART_POINTS(200) 掉到
    // CARD_SPARK_POINTS(20)，而该设备的缓冲**已经是 200 点**。
    // 用 `if` 而不是 `while` 的话，每次新数据只丢 1 个点 →
    // 迷你趋势会长时间显示 199/198/197… 个点，视觉上像没切换。
    // 这条用例专门钉住 `while`。
    const buf = [1, 2, 3, 4, 5]
    pushCapped(buf, 6, 3)
    expect(buf).toEqual([4, 5, 6])
  })

  it('cap 从大变小：一次调用就把历史压到新上限', () => {
    const buf: number[] = []
    for (let i = 1; i <= 25; i++) pushCapped(buf, i, 200)
    expect(buf.length).toBe(25)
    pushCapped(buf, 26, 20) // 切走选中设备 → cap 降到 20
    expect(buf.length).toBe(20)
    expect(buf[0]).toBe(7)
  })

  it('返回本次是否发生裁剪', () => {
    const buf: number[] = []
    expect(pushCapped(buf, 1, 2)).toBe(false)
    expect(pushCapped(buf, 2, 2)).toBe(false)
    expect(pushCapped(buf, 3, 2)).toBe(true)
  })

  it('cap 非有限正数时不裁剪（与原式 `length > NaN` 恒 false 一致）', () => {
    const buf: number[] = [1, 2, 3]
    expect(pushCapped(buf, 4, NaN)).toBe(false)
    expect(buf).toEqual([1, 2, 3, 4])
    expect(pushCapped(buf, 5, 0)).toBe(false)
    expect(buf.length).toBe(5)
  })

  it('对象点也能裁剪（趋势缓冲的真实形态 {t, v}）', () => {
    const buf: Array<{ t: string; v: number }> = []
    for (let i = 0; i < 25; i++) pushCapped(buf, { t: `t${i}`, v: i }, 20)
    expect(buf.length).toBe(20)
    expect(buf[0].v).toBe(5)
    expect(buf[19].v).toBe(24)
  })
})
