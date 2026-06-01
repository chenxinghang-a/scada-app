import { ElMessage } from 'element-plus'

/**
 * 用户操作失败时显示错误提示
 * @param action 操作描述（如"保存配置"）
 * @param error 捕获的异常
 */
export function showActionError(action: string, error?: any) {
  const msg = error?.response?.data?.error
    || error?.response?.data?.message
    || error?.message
    || '未知错误'
  console.error(`[操作失败] ${action}:`, error)
  ElMessage.error(`${action}失败: ${msg}`)
}

/**
 * 数据加载失败时记录日志（不弹 toast，避免轮询刷屏）
 * @param module 模块名（如"设备列表"）
 * @param error 捕获的异常
 */
export function logLoadError(module: string, error?: any) {
  const msg = error?.response?.data?.error || error?.message || '未知错误'
  console.warn(`[加载失败] ${module}: ${msg}`)
}
