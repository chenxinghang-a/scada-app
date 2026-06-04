/**
 * 通用格式化工具函数
 */

/**
 * 格式化运行时间
 * @param seconds 秒数
 * @returns 格式化的时间字符串
 */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
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
  if (value === undefined || value === null || isNaN(value)) return '-'
  return value.toFixed(decimals)
}

/**
 * 格式化百分比
 */
export function formatPercent(value: number | undefined | null, decimals: number = 1): string {
  if (value === undefined || value === null || isNaN(value)) return '-'
  return `${value.toFixed(decimals)}%`
}
