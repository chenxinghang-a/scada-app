import { describe, it, expect } from 'vitest'
import {
  CONFIG_SECTIONS,
  configSectionOf,
  buildPayload,
  withBaselineEntry,
  saveStateOf,
  saveStateLabel,
  LEVEL_MAP,
  levelTag,
  levelLabel,
  assignKnownKeys,
  pickOwnKnownKeys,
  asRecord,
  matchedSections,
  toDeviceList,
  buildDbTables,
  parseAreas,
  exportFileName,
} from '@/utils/config'

/**
 * `src/utils/config.ts` 的行为契约。
 *
 * 这些断言测的是 **Config.vue 真正调用的那份实现**（组件已改为从本模块 import），
 * 而不是手抄副本 —— 后者只能证明「算法意图」，拦不住组件里的回归。
 */

// 通用夹具：4 段齐备的表单模型
const CFG = {
  system: { name: 'SmartSCADA', port: 5000, host: '127.0.0.1', debug: false },
  collection: { interval: 5, timeout: 10, retries: 3, retry_interval: 5 },
  database: { retention_days: 30, compression: true, compression_interval: 24 },
  energy: { peak_price: 1.2, flat_price: 0.8, valley_price: 0.4, carbon_factor: 0.5 },
}

// ==========================================================================
// 配置段
// ==========================================================================

describe('CONFIG_SECTIONS / configSectionOf', () => {
  it('四段齐全且顺序固定', () => {
    expect(CONFIG_SECTIONS).toEqual(['system', 'collection', 'database', 'energy'])
  })

  it('按名取段，返回同一引用', () => {
    expect(configSectionOf(CFG, 'system')).toBe(CFG.system)
    expect(configSectionOf(CFG, 'collection')).toBe(CFG.collection)
    expect(configSectionOf(CFG, 'database')).toBe(CFG.database)
    expect(configSectionOf(CFG, 'energy')).toBe(CFG.energy)
  })

  it('未知段名 → undefined（不抛错）', () => {
    expect(configSectionOf(CFG, 'nope')).toBe(undefined)
    expect(configSectionOf(CFG, '')).toBe(undefined)
  })
})

describe('buildPayload —— 按后端 YAML 结构组装', () => {
  it('collection：合并 raw.retry 后覆写 max_attempts / interval_seconds', () => {
    const raw = { collection: { retry: { extra_kept: 1, max_attempts: 99, interval_seconds: 99 } } }
    expect(buildPayload('collection', CFG, raw)).toEqual({
      default_interval: 5,
      timeout: 10,
      retry: { extra_kept: 1, max_attempts: 3, interval_seconds: 5 },
    })
  })

  it('collection：无 raw 时 retry 只含两个已知键', () => {
    expect(buildPayload('collection', CFG, null)).toEqual({
      default_interval: 5,
      timeout: 10,
      retry: { max_attempts: 3, interval_seconds: 5 },
    })
  })

  it('database：合并 retention / compression 的未知键后覆写已知键', () => {
    const raw = { database: { retention: { extra: true }, compression: { level: 9 } } }
    expect(buildPayload('database', CFG, raw)).toEqual({
      retention: { extra: true, raw_data_days: 30 },
      compression: { level: 9, enabled: true, interval_hours: 24 },
    })
  })

  it('system / energy：原样展开对应段', () => {
    expect(buildPayload('system', CFG, null)).toEqual(CFG.system)
    expect(buildPayload('energy', CFG, null)).toEqual(CFG.energy)
  })

  it('未知段 → 空对象（configSectionOf undefined 的兜底）', () => {
    expect(buildPayload('nope', CFG, null)).toEqual({})
  })

  it('返回值是浅拷贝，改它不影响原模型', () => {
    const p = buildPayload('system', CFG, null)
    ;(p as Record<string, unknown>).name = 'changed'
    expect(CFG.system.name).toBe('SmartSCADA')
  })
})

// ==========================================================================
// 保存状态检测
// ==========================================================================

describe('withBaselineEntry', () => {
  it('新增键', () => {
    expect(withBaselineEntry({}, 'system', { a: 1 })).toEqual({ system: '{"a":1}' })
  })

  it('覆盖已有键', () => {
    expect(withBaselineEntry({ system: 'old' }, 'system', { a: 1 })).toEqual({ system: '{"a":1}' })
  })

  it('返回新对象，不改传入 baseline', () => {
    const base = { x: '1' }
    const next = withBaselineEntry(base, 'y', { b: 2 })
    expect(base).toEqual({ x: '1' })
    expect(next).toEqual({ x: '1', y: '{"b":2}' })
  })
})

describe('saveStateOf —— 未记录 / 一致 / 不一致', () => {
  it('未记录 → unknown', () => {
    expect(saveStateOf({}, 'system', { a: 1 })).toBe('unknown')
  })

  it('与快照 JSON 逐字符一致 → saved', () => {
    const snapshot = { name: 'S', port: 1 }
    const base = { system: JSON.stringify(snapshot) }
    expect(saveStateOf(base, 'system', snapshot)).toBe('saved')
  })

  it('内容变化 → dirty', () => {
    const base = { system: JSON.stringify({ name: 'S' }) }
    expect(saveStateOf(base, 'system', { name: 'T' })).toBe('dirty')
  })

  it('键序敏感：内容等价但键序不同 → dirty（口径如此，别当 bug 改）', () => {
    const base = { system: JSON.stringify({ a: 1, b: 2 }) }
    expect(saveStateOf(base, 'system', { b: 2, a: 1 })).toBe('dirty')
  })
})

describe('saveStateLabel', () => {
  it('三种文案', () => {
    expect(saveStateLabel({}, 'k', {})).toBe('未加载')
    expect(saveStateLabel({ k: '{"a":1}' }, 'k', { a: 1 })).toBe('已保存')
    expect(saveStateLabel({ k: '{"a":1}' }, 'k', { a: 2 })).toBe('有未保存修改')
  })
})

// ==========================================================================
// 等级映射（Config 口径）
// ==========================================================================

describe('LEVEL_MAP / levelTag / levelLabel', () => {
  it('三档映射', () => {
    expect(levelTag('critical')).toBe('tag--danger')
    expect(levelTag('warning')).toBe('tag--warning')
    expect(levelTag('info')).toBe('tag--info')
    expect(levelLabel('critical')).toBe('严重')
    expect(levelLabel('warning')).toBe('警告')
    expect(levelLabel('info')).toBe('信息')
  })

  it('未知等级：tag 兜底 offline，label 原样返回（两函数口径不同！）', () => {
    expect(levelTag('fatal')).toBe('tag--offline')
    expect(levelTag('')).toBe('tag--offline')
    expect(levelLabel('fatal')).toBe('fatal')
    expect(levelLabel('')).toBe('')
  })

  it('LEVEL_MAP 只有三键（不包含 normal —— 那是 AlarmOutput 的口径）', () => {
    expect(Object.keys(LEVEL_MAP).sort()).toEqual(['critical', 'info', 'warning'])
  })
})

// ==========================================================================
// 键回填 / 导入安全
// ==========================================================================

describe('assignKnownKeys —— 同名回填，undefined 跳过', () => {
  it('同名键回填', () => {
    const target: Record<string, unknown> = { a: 1, b: 2 }
    assignKnownKeys(target, { a: 9, b: 8, extra: 'ignored' })
    expect(target).toEqual({ a: 9, b: 8 })
  })

  it('source 的额外键不写入 target', () => {
    const target: Record<string, unknown> = { a: 1 }
    assignKnownKeys(target, { a: 2, success: true, config: {} })
    expect(target).toEqual({ a: 2 })
  })

  it('source 键值为 undefined → 跳过（不覆盖）', () => {
    const target: Record<string, unknown> = { a: 1 }
    assignKnownKeys(target, { a: undefined })
    expect(target).toEqual({ a: 1 })
  })

  it('非对象 / null source → 不动', () => {
    const target: Record<string, unknown> = { a: 1 }
    assignKnownKeys(target, null)
    assignKnownKeys(target, 'str')
    assignKnownKeys(target, 42)
    expect(target).toEqual({ a: 1 })
  })
})

describe('pickOwnKnownKeys —— 自有键存在即复制（导入口径）', () => {
  it('自有键为 undefined 也会复制（与 assignKnownKeys 的关键差异，勿合并）', () => {
    const target: Record<string, unknown> = { a: 1 }
    pickOwnKnownKeys(target, { a: undefined })
    expect('a' in target).toBe(true)
    expect(target.a).toBe(undefined)
  })

  it('继承键（非自有）不复制', () => {
    const target: Record<string, unknown> = { x: 'orig' }
    const source = Object.create({ x: 'inherited' }) as Record<string, unknown>
    pickOwnKnownKeys(target, source)
    expect(target.x).toBe('orig')
  })

  it('与 assignKnownKeys 对「缺失键」行为一致（都不动）', () => {
    const t1: Record<string, unknown> = { x: 1 }
    const t2: Record<string, unknown> = { x: 1 }
    assignKnownKeys(t1, {})
    pickOwnKnownKeys(t2, {})
    expect(t1).toEqual({ x: 1 })
    expect(t2).toEqual({ x: 1 })
  })
})

describe('asRecord', () => {
  it('对象原样返回（同一引用）', () => {
    const o = { a: 1 }
    expect(asRecord(o)).toBe(o)
  })

  it('数组原样返回（typeof object，口径如此）', () => {
    const arr = [1, 2]
    expect(asRecord(arr)).toBe(arr as unknown as Record<string, unknown>)
  })

  it('null / undefined / 原始值 → 空对象', () => {
    expect(asRecord(null)).toEqual({})
    expect(asRecord(undefined)).toEqual({})
    expect(asRecord('str')).toEqual({})
    expect(asRecord(42)).toEqual({})
  })
})

describe('matchedSections', () => {
  it('只挑对象值且非 null 的段', () => {
    const imported = { system: { name: 'S' }, collection: 'bad', database: null, other: 1 }
    expect(matchedSections(imported, CONFIG_SECTIONS)).toEqual(['system'])
  })

  it('空对象也算可识别段', () => {
    expect(matchedSections({ system: {} }, CONFIG_SECTIONS)).toEqual(['system'])
  })

  it('没有可识别段 → 空数组', () => {
    expect(matchedSections({}, CONFIG_SECTIONS)).toEqual([])
    expect(matchedSections({ system: 'x' }, CONFIG_SECTIONS)).toEqual([])
  })
})

// ==========================================================================
// 展示派生
// ==========================================================================

describe('toDeviceList', () => {
  it('数组原样返回（同一引用）', () => {
    const arr = [{ connected: true }]
    expect(toDeviceList(arr)).toBe(arr)
  })

  it('字典 → values 数组', () => {
    expect(toDeviceList({ d1: { connected: true }, d2: { connected: false } })).toEqual([
      { connected: true },
      { connected: false },
    ])
  })

  it('空字典 → []；null / undefined → []', () => {
    expect(toDeviceList({})).toEqual([])
    expect(toDeviceList(null)).toEqual([])
    expect(toDeviceList(undefined)).toEqual([])
  })
})

describe('buildDbTables', () => {
  it('扁平结构 → 固定 4 行', () => {
    expect(
      buildDbTables({ realtime_records: 10, history_records: 20, alarm_records: 3, archive_records: 1 }),
    ).toEqual([
      { name: 'realtime_data', rows: 10, size: '-' },
      { name: 'history_data', rows: 20, size: '-' },
      { name: 'alarm_records', rows: 3, size: '-' },
      { name: 'history_archive', rows: 1, size: '-' },
    ])
  })

  it('缺字段兜底 0（0 也是有效值，不被吞）', () => {
    expect(buildDbTables({ realtime_records: 0 })).toEqual([
      { name: 'realtime_data', rows: 0, size: '-' },
      { name: 'history_data', rows: 0, size: '-' },
      { name: 'alarm_records', rows: 0, size: '-' },
      { name: 'history_archive', rows: 0, size: '-' },
    ])
  })

  it('null / undefined → []（未加载）', () => {
    expect(buildDbTables(null)).toEqual([])
    expect(buildDbTables(undefined)).toEqual([])
  })
})

// ==========================================================================
// 杂项
// ==========================================================================

describe('parseAreas', () => {
  it('常规逗号分隔 + 去空格', () => {
    expect(parseAreas('车间A,车间B,仓库')).toEqual(['车间A', '车间B', '仓库'])
    expect(parseAreas(' a , b ')).toEqual(['a', 'b'])
  })

  it('空串 / 纯空格 → []', () => {
    expect(parseAreas('')).toEqual([])
    expect(parseAreas('   ')).toEqual([])
  })

  it('连续逗号 / 尾逗号 → 滤掉空段', () => {
    expect(parseAreas('a,,b,')).toEqual(['a', 'b'])
    expect(parseAreas(',,')).toEqual([])
  })
})

describe('exportFileName', () => {
  it('格式：smartscada-config-YYYY-MM-DD.json', () => {
    expect(exportFileName(new Date('2026-10-08T10:00:00Z'))).toBe('smartscada-config-2026-10-08.json')
  })

  it('UTC 口径锚定：UTC+8 的凌晨取的是 UTC 日期（口径如此，别当 bug 改）', () => {
    // 本地（UTC+8）2026-10-08 00:30 = UTC 2026-10-07 16:30 → 文件名是 10-07
    expect(exportFileName(new Date('2026-10-07T16:30:00Z'))).toBe('smartscada-config-2026-10-07.json')
  })
})
