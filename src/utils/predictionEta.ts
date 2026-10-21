/**
 * 故障预测的「还有多久」文案（纯函数，可单测）。
 *
 * 后端 `days_to_limit` 是保留 2 位小数的天数。对「2 小时后到限」这种情况，
 * 直接显示「0.21天」没人能读 —— 所以 48 小时内改用 `hours_to_limit`。
 *
 * 背景（round 237）：后端原先用**写死的 60 秒采样间隔**换算天数，
 * 而设备实际可能是 5 秒一个点 → 剩余时间被报大 12 倍。现在后端按真实
 * 时间戳换算并同时给 `hours_to_limit`，这里只负责挑合适的单位。
 */

export interface FailureEta {
  days_to_limit?: number | null
  hours_to_limit?: number | null
}

export function etaText(pred: FailureEta | null | undefined): string {
  if (!pred || pred.days_to_limit == null) return '-'
  const hours = pred.hours_to_limit
  if (hours != null && hours < 48) return `${hours}小时`
  return `${pred.days_to_limit}天`
}
