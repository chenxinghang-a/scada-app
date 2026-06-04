/**
 * 统一错误处理 composable
 * 提供一致的错误提示和日志记录
 */
import { ElMessage } from 'element-plus'

export function useErrorHandler(moduleName: string) {
  function handleError(e: any, action: string = '操作') {
    const msg = e?.response?.data?.error || e?.message || '未知错误'
    console.error(`[${moduleName}] ${action}失败:`, e)
    ElMessage.error(`${action}失败: ${msg}`)
  }

  function handleWarning(e: any, action: string = '加载') {
    const msg = e?.response?.data?.error || e?.message || '未知错误'
    console.warn(`[${moduleName}] ${action}失败:`, e)
    ElMessage.warning(`${action}失败: ${msg}`)
  }

  function handleLoadError(e: any) {
    handleWarning(e, '加载')
  }

  function handleActionError(e: any) {
    handleError(e, '操作')
  }

  return {
    handleError,
    handleWarning,
    handleLoadError,
    handleActionError,
  }
}
