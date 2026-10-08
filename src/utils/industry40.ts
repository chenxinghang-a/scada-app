/**
 * industry40.ts — Industry40（工业 4.0）页面的**纯函数**层
 *
 * 为什么存在
 * ----------
 * `views/Industry40.vue` 是一个 1873 行的 SFC，里面混着三类东西：
 *   ① 数据契约（列表归一化、unknown 收敛）
 *   ② 业务规则（健康度/OEE/过程能力的**分档**、告警等级 → 色条类名）
 *   ③ 视图胶水（echarts / DOM 令牌读取 / 定时器）
 *
 * ①② 是**有回归价值**的部分，但它们原先内联在组件里、没有导出，
 * 测试只能手抄一份同名逻辑再断言它自己 —— 手抄副本拦不住组件里的回归。
 * 本模块把那部分逻辑抽成不依赖 Vue / echarts / DOM 的纯函数，
 * 让测试可以直接测**真实现**。
 *
 * 边界
 * ----
 * - 不 import Vue、不 import echarts、不 import DOM API —— 纯函数，可直接单测。
 * - 只搬运，**不改行为**。每条函数上方都写明它原来在哪一行、语义是什么。
 * - 依赖 DOM 的 `token()`（读 CSS 变量）与依赖 echarts 的 `ringGaugeOption()`
 *   **留在组件内**：前者的纯部分已拆出（见 `bandTokenOf`）。
 *
 * 与 `dashboard.ts` 的关系
 * ------------------------
 * 同款模式（round 176 为 Dashboard.vue 建立）。本文件是其在 Industry40.vue
 * 上的延续；两个 utils 文件之间**没有重名**，各管各的页面。
 *
 * ⚠️ 跨文件同名（2026-10-07 实测全 src/，含本模块 33 个导出名）——**本模块只承载 Industry40 的原口径**：
 *   - `fmtTime`：Alarms.vue / Screen.vue / AlarmOutput.vue 各有一份，
 *     **三份语义互不相同**（非法时间戳兜底：本模块「原样返回输入」/ Alarms 与 AlarmOutput「'-'」/
 *     Screen「不判」；输出格式：本模块与 Screen 是 HH:MM:SS，Alarms / AlarmOutput 是 toLocaleString 全格式）。
 *     谁想统一口径先定标准，**别直接合并**。
 *   - `levelBarClass`：Alarms.vue / Screen.vue / **Dashboard.vue** 各有一份，实现是转 `levelKey()`
 *     （而 `levelKey` 自身在 3 个 view + utils/dashboard.ts 各有一份、兜底值有 3 套，
 *     见 utils/dashboard.ts 头注释）；本模块是 Industry40 的内联三分支口径。**不要与那三处合并。**
 *   - `OEE_TARGET`：Dashboard.vue 有同名本地常量（同为 85）。值一致属巧合；
 *     将来改 OEE 标准要两处一起改（统一归并属独立决策，不在本轮范围）。
 *
 * 📌 上面这张地图**有守卫盯着**：`tests/utils/cross-file-duplicates.test.ts`。
 *    它按「文件 + 名称」双向核对（新增副本 → 红；地图列了但已不存在 → 红）。
 *    ⚠️ 本注释**不再写行号** —— 行号必漂：2026-10-09 实测，原先写的
 *    `Dashboard.vue:346` 已在 349，且 `levelBarClass` 还**漏记了 Dashboard.vue 那份**。
 *    改这些名字时请同步改守卫里的表，别只改这里。
 */

// ==========================================================================
// 分档（Band）系统
// ==========================================================================

/**
 * 通用分档结构：`[min, max)` 半开区间。
 * 原 `Industry40.vue:603` 的 `interface Band`。
 */
export interface Band {
  label: string
  token: string
  min: number
  max: number
}

/** 健康度分档。原 `Industry40.vue:709-715`。 */
export const HEALTH_BANDS: Band[] = [
  { label: '差', token: '--color-offline', min: -Infinity, max: 20 },
  { label: '较差', token: '--color-danger', min: 20, max: 40 },
  { label: '一般', token: '--color-warning', min: 40, max: 60 },
  { label: '良好', token: '--chart-7', min: 60, max: 80 },
  { label: '优秀', token: '--color-success', min: 80, max: Infinity },
]

/** OEE 分档。原 `Industry40.vue:717-723`。 */
export const OEE_BANDS: Band[] = [
  { label: '需改进', token: '--color-danger', min: -Infinity, max: 50 },
  { label: '一般', token: '--color-warning', min: 50, max: 65 },
  { label: '良好', token: '--color-info', min: 65, max: 75 },
  { label: '优秀', token: '--chart-7', min: 75, max: 85 },
  { label: '世界级', token: '--color-success', min: 85, max: Infinity },
]

/** 过程能力（Cp/Cpk/Pp/Ppk）分档。原 `Industry40.vue:725-729`。 */
export const CAP_BANDS: Band[] = [
  { label: '不足', token: '--color-danger', min: -Infinity, max: 1.0 },
  { label: '勉强', token: '--color-warning', min: 1.0, max: 1.33 },
  { label: '充足', token: '--color-success', min: 1.33, max: Infinity },
]

/**
 * 过程能力四指标：key 限定为 SPCCapability 的数值字段，模板里按 key 取数才有类型。
 * 原 `Industry40.vue:731-737`。
 */
export const CAP_KEYS: { key: 'cp' | 'cpk' | 'pp' | 'ppk'; label: string }[] = [
  { key: 'cp', label: 'Cp' },
  { key: 'cpk', label: 'Cpk' },
  { key: 'pp', label: 'Pp' },
  { key: 'ppk', label: 'Ppk' },
]

/**
 * OEE 世界级标准（后端 oee_calculator 定义为 ≥85%），用于排序图目标线。
 * 原 `Industry40.vue:739-740`。
 */
export const OEE_TARGET = 85

// ISO 10816 四个分区（边界取后端 VIBRATION_ZONES 的 max），用于振动值着色与分区参考线。
// 原 `Industry40.vue:768-773`。
export const ZONE_A: Band = { label: 'A 良好', token: '--color-success', min: -Infinity, max: 0.71 }
export const ZONE_B: Band = { label: 'B 可接受', token: '--chart-7', min: 0.71, max: 1.8 }
export const ZONE_C: Band = { label: 'C 报警', token: '--color-warning', min: 1.8, max: 4.5 }
export const ZONE_D: Band = { label: 'D 危险', token: '--color-danger', min: 4.5, max: Infinity }

/** 分区字母 → 设计令牌。原 `Industry40.vue:773`。 */
export const ZONE_TOKEN: Record<string, string> = {
  A: '--color-success',
  B: '--chart-7',
  C: '--color-warning',
  D: '--color-danger',
}

// ==========================================================================
// 分档判定
// ==========================================================================

/**
 * 值落在第几档（`[min, max)` 半开区间；`max` 取 `Infinity` 兜底）。
 *
 * 原 `Industry40.vue:742-747`。两条兜底口径要保留：
 * - 非有限数（NaN / Infinity 输入 / 字符串脏值）→ **第 0 档**（不抛错）；
 * - 没命中任何区间（理论不可达，因为首尾档覆盖 ±Infinity）→ **最后一档**。
 */
export function bandIndexOf(bands: Band[], v: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  const i = bands.findIndex((b) => n >= b.min && n < b.max)
  return i === -1 ? bands.length - 1 : i
}

/** 分档文案。原 `Industry40.vue:748`。 */
export function bandLabelOf(bands: Band[], v: number): string {
  return bands[bandIndexOf(bands, v)].label
}

/** 当前档位是否 ≥ 第 i 档（用于阶梯式高亮）。原 `Industry40.vue:749`。 */
export function isBandOn(bands: Band[], v: number, i: number): boolean {
  return bandIndexOf(bands, v) >= i
}

/** 分档结果对应的**令牌名**（如 `--color-success`，未经 DOM 解析）。原 `Industry40.vue:1102` `bandColorOf` 的内核（token 解析部分留在组件）。 */
export function bandTokenOf(bands: Band[], v: number): string {
  return bands[bandIndexOf(bands, v)].token
}

/** 模板用：返回 CSS 变量引用（自动跟随深浅主题）。原 `Industry40.vue:751-752`。 */
export function bandVarOf(bands: Band[], v: number): string {
  return 'var(' + bands[bandIndexOf(bands, v)].token + ')'
}

/** 健康度 → CSS 变量引用。原 `Industry40.vue:753`。 */
export function healthVar(v: number): string {
  return bandVarOf(HEALTH_BANDS, v)
}

/** OEE → CSS 变量引用。原 `Industry40.vue:754`。 */
export function oeeVar(v: number): string {
  return bandVarOf(OEE_BANDS, v)
}

/** 过程能力 → CSS 变量引用（null / undefined 经 `Number()` 走非有限数分支 → 第 0 档）。原 `Industry40.vue:755`。 */
export function capVar(v: number | null | undefined): string {
  return bandVarOf(CAP_BANDS, Number(v))
}

/** 振动分区字母 → CSS 变量引用（未知字母兜底 offline 色）。原 `Industry40.vue:756`。 */
export function zoneVar(zone?: string): string {
  return 'var(' + (ZONE_TOKEN[zone ?? ''] || '--color-offline') + ')'
}

/**
 * 分档 → 标签（tag）CSS 类。原 `Industry40.vue:758-764`。
 *
 * 映射口径：success 与 chart-7 都算「好」（绿），danger → 红，warning → 黄，
 * 其余（如 info / offline）→ 蓝。
 */
export function bandTagClass(bands: Band[], v: number): string {
  const t = bands[bandIndexOf(bands, v)].token
  if (t === '--color-success' || t === '--chart-7') return 'tag--success'
  if (t === '--color-danger') return 'tag--danger'
  if (t === '--color-warning') return 'tag--warning'
  return 'tag--info'
}

/** OEE → 标签类。原 `Industry40.vue:765`。 */
export function oeeTagClass(v: number): string {
  return bandTagClass(OEE_BANDS, v)
}

/** 过程能力 → 标签类（null / undefined 同 `capVar` 口径）。原 `Industry40.vue:766`。 */
export function capTagClass(v: number | null | undefined): string {
  return bandTagClass(CAP_BANDS, Number(v))
}

// ==========================================================================
// 状态等级 → 色条 / 标签
// ==========================================================================

/**
 * 模板用：状态等级 → 设计基线里的色条类。原 `Industry40.vue:781-785`。
 *
 * 只认 `critical` / `warning`，其余（含 `info`、空值、脏值）一律 `info`。
 */
export function levelBarClass(level: string): string {
  const k = level === 'critical' ? 'critical' : level === 'warning' ? 'warning' : 'info'
  return `level-bar--${k}`
}

/**
 * 决策日志没有 level 字段：按 rule_type 区分安全联锁（critical 色）与普通规则触发（info 色）。
 * 原 `Industry40.vue:934-935`。
 */
export function edgeLevelBarClass(ruleType?: string): string {
  return ruleType === 'interlock' ? 'level-bar--critical' : 'level-bar--info'
}

/** 同 `edgeLevelBarClass`，标签版本。原 `Industry40.vue:936`。 */
export function edgeLevelTagClass(ruleType?: string): string {
  return ruleType === 'interlock' ? 'tag--danger' : 'tag--info'
}

/**
 * ISO 10816 等级（A/B/C/D）→ element-plus 标签 type。
 * 原 `Industry40.vue:1685-1689`。空值 / 未知等级 → `info`。
 */
export function isoGradeType(grade: string): string {
  if (!grade) return 'info'
  const map: Record<string, string> = { A: 'success', B: 'success', C: 'warning', D: 'danger' }
  return map[grade] || 'info'
}

// ==========================================================================
// 兼容读取 / 格式化
// ==========================================================================

/** 兼容读取：把 unknown 收敛为 string（取不到时用兜底值），语义等价于旧写法 `a || b`。原 `Industry40.vue:787-790`。 */
export function asStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v ? v : fallback
}

/** 兼容读取：把 unknown 收敛为 number | undefined（非数值 → undefined）。原 `Industry40.vue:791-795`。 */
export function asNum(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

/** 趋势箭头。原 `Industry40.vue:928`。 */
export function trendArrow(t: string): string {
  return t === 'rising' ? '↑' : t === 'falling' ? '↓' : '→'
}

/**
 * 时间戳 → `HH:MM:SS`（zh-CN）。原 `Industry40.vue:929-933`。
 *
 * 兜底口径：缺值 → `'-'`；不可解析 → **原样返回输入**（不抛错）。
 * ⚠️ 输出受运行时时区影响，测试断言请用「形状」而非具体钟点。
 */
export function fmtTime(t?: string): string {
  if (!t) return '-'
  const d = new Date(t)
  return Number.isNaN(d.getTime())
    ? t
    : d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ==========================================================================
// 列表归一化
// ==========================================================================

/**
 * 后端多个接口返回以 device_id / `"device:register"` 为键的字典
 * （axios 拦截器已解开 `{success,data}`），统一转成数组后再交给表格/图表，
 * 避免字段名错配导致列表恒为空。原 `Industry40.vue:938-946`。
 *
 * - 数组 → 原样返回（**不复制**，与原件一致）；
 * - 对象 → `Object.entries` 展开，键写成 `device_id` 字段；
 * - 其余（null / 原始值）→ `[]`。
 */
export function toList<T extends object>(v: unknown): Array<T & { device_id: string }> {
  if (Array.isArray(v)) return v as Array<T & { device_id: string }>
  if (v && typeof v === 'object') {
    return Object.entries(v as Record<string, T>).map(([id, item]) => ({ device_id: id, ...item }))
  }
  return []
}
