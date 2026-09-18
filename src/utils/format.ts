/**
 * 通用格式化工具函数
 */

/**
 * 归一化小数位：toFixed 的 digits 必须在 0-100，越界（含 NaN）会抛 RangeError
 */
function normalizeDecimals(decimals: number, fallback: number): number {
  const d = Math.trunc(Number(decimals))
  if (!Number.isFinite(d)) return fallback
  return Math.min(100, Math.max(0, d))
}

/**
 * 格式化运行时间
 * @param seconds 秒数
 * @returns 格式化的时间字符串
 */
export function formatUptime(seconds: number): string {
  // 负数/NaN 直接算会得到 "-1分" / "NaN分"，统一显示 0 分钟
  const s = Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return '0分'
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}天${h}时` : h > 0 ? `${h}时${m}分` : `${m}分`
}

/**
 * 获取设备显示名称
 * @param device 设备对象
 * @returns 显示名称
 */
export function getDeviceDisplayName(device: any): string {
  return device?.name || device?.device_name || device?.device_id || '未知设备'
}

/**
 * 格式化数字（保留小数位）
 */
export function formatNumber(value: number | undefined | null, decimals: number = 2): string {
  // Number.isFinite 同时排除 null/undefined/NaN/±Infinity 与非数字类型
  if (!Number.isFinite(value)) return '-'
  return (value as number).toFixed(normalizeDecimals(decimals, 2))
}

/**
 * 格式化百分比
 */
export function formatPercent(value: number | undefined | null, decimals: number = 1): string {
  if (!Number.isFinite(value)) return '-'
  return `${(value as number).toFixed(normalizeDecimals(decimals, 1))}%`
}
