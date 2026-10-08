/**
 * config.ts — Config 页面的**纯函数**层
 *
 * 为什么存在
 * ----------
 * `views/Config.vue` 是一个 1341 行的 SFC，其中「保存状态检测」「配置段映射」
 * 「键回填/导入安全」三类逻辑**有真实回归价值**（改错会静默丢配置或误报已保存），
 * 但它们内联在组件里、依赖组件闭包状态，测试无从下手。
 * 本模块把那部分逻辑抽成可单测的纯函数（依赖通过参数注入）。
 *
 * 边界
 * ----
 * - 不 import Vue、不 import @/api、不碰 DOM —— 纯函数/纯变换，可直接单测。
 * - 只搬运，**不改行为**。每条函数上方注明原行号与口径。
 * - ⚠️ 刻意**不**依赖 `@/api` 的具体类型：只声明真正用到的字段
 *   （同 utils/dashboard.ts 的做法，避免类型随接口演进漂移）。
 *
 * ⚠️ 跨文件「等级映射」近义实现（2026-10-08 实测全 src/ 96 文件；本模块只承载 **Config 口径**）：
 *   - `Config.vue`（本模块）：`levelTag/levelLabel/LEVEL_MAP` —— 兜底 `tag--offline` / 原样返回 label
 *   - `AlarmOutput.vue:202-204`：`levelKey/levelText/levelTagClass/LEVEL_TEXT` —— **名字不同**，
 *     兜底 `'normal'` / `'正常'`，且实现走 `levelKey()` 转发
 *   - `Dashboard.vue` / `Screen.vue`：`levelKey` 另一套（兜底 `'info'`，见 utils/dashboard.ts 头注释）
 *   - `Alarms.vue`：又一套（`levelBarClass` 转 `levelKey`）
 *   同名的严格重复：无。近义不同义的：**四套**。谁想统一先定口径，**别直接合并**。
 */

// ==========================================================================
// 配置段
// ==========================================================================

/** 界面「按段保存」支持的配置段名。原 `Config.vue:749`。 */
export const CONFIG_SECTIONS = ['system', 'collection', 'database', 'energy'] as const

export type ConfigSectionName = typeof CONFIG_SECTIONS[number]

/** 只要求这 4 个段存在（unknown 即可，函数内部 cast）。 */
export interface ConfigSectionSource {
  system: unknown
  collection: unknown
  database: unknown
  energy: unknown
}

/**
 * 段名 → 表单模型对象。原 `Config.vue:752-760`。
 *
 * 显式分支而非 `(config as any)[section]`：段名与模型字段在类型层对齐，
 * 段名写错时编译期即可发现。未知段名返回 `undefined`。
 */
export function configSectionOf(
  config: ConfigSectionSource,
  name: string,
): Record<string, unknown> | undefined {
  switch (name as ConfigSectionName) {
    case 'system': return config.system as Record<string, unknown>
    case 'collection': return config.collection as Record<string, unknown>
    case 'database': return config.database as Record<string, unknown>
    case 'energy': return config.energy as Record<string, unknown>
    default: return undefined
  }
}

/** 采集段模型（只声明 buildPayload 用到的字段）。 */
export interface CollectionModel {
  interval: number
  timeout: number
  retries: number
  retry_interval: number
}

/** 数据库段模型。 */
export interface DatabaseModel {
  retention_days: number
  compression: boolean
  compression_interval: number
}

/** 最近一次 GET /config 的原始内容（只声明用到的嵌套字段）。 */
export interface RawConfigLike {
  collection?: { retry?: Record<string, unknown> } | null
  database?: { retention?: Record<string, unknown>; compression?: Record<string, unknown> } | null
}

/**
 * 按后端实际 YAML 结构组装配置段（键名对齐 system.yaml，避免写入无效键
 * 甚至把 dict 覆盖成 bool）。原 `Config.vue:763-786`。
 *
 * - `collection`：合并 `raw.collection.retry`，再覆写 `max_attempts` / `interval_seconds`；
 * - `database`：合并 `raw.database.retention` 与 `raw.database.compression`，再覆写已知键；
 * - 其余段：原样展开 `configSectionOf`（未知段 → 空对象 `{}`）。
 */
export function buildPayload(
  section: string,
  config: { collection: CollectionModel; database: DatabaseModel } & ConfigSectionSource,
  raw: RawConfigLike | null | undefined,
): Record<string, unknown> {
  if (section === 'collection') {
    return {
      default_interval: config.collection.interval,
      timeout: config.collection.timeout,
      retry: {
        ...(raw?.collection?.retry || {}),
        max_attempts: config.collection.retries,
        interval_seconds: config.collection.retry_interval,
      },
    }
  }
  if (section === 'database') {
    return {
      retention: { ...(raw?.database?.retention || {}), raw_data_days: config.database.retention_days },
      compression: {
        ...(raw?.database?.compression || {}),
        enabled: config.database.compression,
        interval_hours: config.database.compression_interval,
      },
    }
  }
  return { ...(configSectionOf(config, section) || {}) }
}

// ==========================================================================
// 保存状态检测（对比「已落盘快照」与当前表单）
// ==========================================================================

/**
 * 用一次快照写入生成**新的** baseline 表（不改传入对象）。原 `Config.vue:591-593` 的计算部分。
 *
 * ⚠️ 快照以 `JSON.stringify` 存储 —— **键序敏感**：
 * `{a:1,b:2}` 与 `{b:2,a:1}` 序列化不同 → 即使内容等价也会判 `dirty`。
 * 这是既有口径（表单模型字段顺序稳定，实际不误报），**不改**。
 */
export function withBaselineEntry(
  baseline: Record<string, string>,
  key: string,
  snapshot: unknown,
): Record<string, string> {
  return { ...baseline, [key]: JSON.stringify(snapshot) }
}

/**
 * 未记录 → `'unknown'`；与快照逐字符一致 → `'saved'`；否则 → `'dirty'`。
 * 原 `Config.vue:595-599`（`baseline.value` 改为参数注入）。
 */
export function saveStateOf(
  baseline: Record<string, string>,
  key: string,
  snapshot: unknown,
): 'saved' | 'dirty' | 'unknown' {
  const base = baseline[key]
  if (base === undefined) return 'unknown'
  return base === JSON.stringify(snapshot) ? 'saved' : 'dirty'
}

/** 保存状态文案。原 `Config.vue:601-605`。 */
export function saveStateLabel(
  baseline: Record<string, string>,
  key: string,
  snapshot: unknown,
): string {
  const state = saveStateOf(baseline, key, snapshot)
  if (state === 'unknown') return '未加载'
  return state === 'dirty' ? '有未保存修改' : '已保存'
}

// ==========================================================================
// 等级 → 标签样式/显示名（Config 口径）
// ==========================================================================

/** 等级映射表。原 `Config.vue:641-645`。 */
export const LEVEL_MAP: Record<string, { label: string; tag: string }> = {
  critical: { label: '严重', tag: 'tag--danger' },
  warning: { label: '警告', tag: 'tag--warning' },
  info: { label: '信息', tag: 'tag--info' },
}

/** 未知等级兜底 `tag--offline`。原 `Config.vue:646`。 */
export function levelTag(level: string): string {
  return LEVEL_MAP[level]?.tag || 'tag--offline'
}

/** 未知等级**原样返回**输入。原 `Config.vue:647`。 */
export function levelLabel(level: string): string {
  return LEVEL_MAP[level]?.label || level
}

// ==========================================================================
// 键回填 / 导入安全
// ==========================================================================

/**
 * 只把 source 中与 target **同名**的键回填到 target（**就地修改**）。
 * 原 `Config.vue:654-661`。
 *
 * 避免两种历史问题：把响应外壳（success/config 等）写进表单模型，
 * 以及把结构不同的后端段整体 Object.assign 后又被原样 PUT 回写。
 *
 * 口径：**跳过 `undefined`**（键存在但值为 undefined 时不覆盖）。
 * 对照 `pickOwnKnownKeys`：那个按「**自有键存在**」复制（undefined 也会复制）——
 * 两者是不同口径，勿合并。
 */
export function assignKnownKeys(target: Record<string, unknown>, source: unknown): void {
  if (!source || typeof source !== 'object') return
  const src = source as Record<string, unknown>
  for (const key of Object.keys(target)) {
    const v = src[key]
    if (v !== undefined) target[key] = v
  }
}

/**
 * 导入配置用：只覆盖 target 已知键中**在 source 里自有（hasOwnProperty）**的。
 * 原 `Config.vue:1088-1091`。
 *
 * 与 `assignKnownKeys` 的差异：本函数按「键存在」判定（`undefined` 也会被复制），
 * 且用 `hasOwnProperty` 防原型链键（`__proto__` / `constructor` 等）。**勿合并。**
 */
export function pickOwnKnownKeys(target: Record<string, unknown>, source: unknown): void {
  if (!source || typeof source !== 'object') return
  const src = source as Record<string, unknown>
  for (const key of Object.keys(target)) {
    if (Object.prototype.hasOwnProperty.call(src, key)) target[key] = src[key]
  }
}

/**
 * 把 unknown 收敛成可遍历的对象；非对象一律返回空对象（不抛错）。
 * 原 `Config.vue:664-666`。
 *
 * 口径：数组 `typeof === 'object'` → **原样返回**（as Record）。
 */
export function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

/**
 * 导入时从 parsed 对象中挑出「可识别的配置段名」。
 * 原 `Config.vue:1072-1075`。
 *
 * 判定：值存在（`!!v`）且 `typeof === 'object'` 且 `!== null`。
 * （`!!v` 已排除 null，第三条件冗余但如实保留。）
 */
export function matchedSections(imported: Record<string, unknown>, sections: readonly string[]): string[] {
  return sections.filter((s) => {
    const v = imported[s]
    return !!v && typeof v === 'object' && v !== null
  })
}

// ==========================================================================
// 展示派生
// ==========================================================================

/**
 * `/system/status` 的 `devices` 字段归一化：数组原样、字典取 values、空值 → `[]`。
 * 原 `Config.vue:615-619`（`systemStatus.value?.devices` 改为参数注入）。
 */
export function toDeviceList(value: unknown): Array<Partial<{ connected: boolean }>> {
  if (!value) return []
  return Array.isArray(value)
    ? (value as Array<Partial<{ connected: boolean }>>)
    : Object.values(value as Record<string, Partial<{ connected: boolean }>>)
}

/** `/system/database` 响应中本页面用到的字段。 */
export interface DbInfoLike {
  realtime_records?: number
  history_records?: number
  alarm_records?: number
  archive_records?: number
}

export interface DbTableRow {
  name: string
  rows: number
  size: string
}

/** 后端扁平结构 → 数据库表格数据（固定 4 行，缺字段兜底 0）。原 `Config.vue:628-638`。 */
export function buildDbTables(info: DbInfoLike | null | undefined): DbTableRow[] {
  if (!info) return []
  return [
    { name: 'realtime_data', rows: info.realtime_records || 0, size: '-' },
    { name: 'history_data', rows: info.history_records || 0, size: '-' },
    { name: 'alarm_records', rows: info.alarm_records || 0, size: '-' },
    { name: 'history_archive', rows: info.archive_records || 0, size: '-' },
  ]
}

// ==========================================================================
// 杂项
// ==========================================================================

/** 广播区域字符串 → 数组（逗号分隔、去空格、滤空）。原 `Config.vue:1014`。 */
export function parseAreas(str: string): string[] {
  return str.split(',').map((s) => s.trim()).filter(Boolean)
}

/**
 * 导出配置的下载文件名。原 `Config.vue:1050`。
 *
 * ⚠️ 口径：用 `toISOString()`（**UTC 日期**）——本机 UTC+8 时，00:00~08:00 导出
 * 会得到「昨天」的日期。既有行为，**不改**（谁要改成本地日期属独立决策）。
 */
export function exportFileName(now: Date): string {
  return `smartscada-config-${now.toISOString().slice(0, 10)}.json`
}
