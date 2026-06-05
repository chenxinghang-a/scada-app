/**
 * 统一错误处理 composable
 * 提供一致的错误提示和日志记录，支持中英文国际化
 */
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'

// 错误消息国际化映射
const errorMessages: Record<string, Record<string, string>> = {
  'zh-CN': {
    unknown: '未知错误',
    network: '网络连接失败',
    timeout: '请求超时',
    unauthorized: '未授权，请重新登录',
    forbidden: '权限不足',
    notFound: '资源不存在',
    serverError: '服务器内部错误',
    loadFailed: '加载失败',
    actionFailed: '操作失败',
  },
  'en-US': {
    unknown: 'Unknown error',
    network: 'Network connection failed',
    timeout: 'Request timeout',
    unauthorized: 'Unauthorized, please login again',
    forbidden: 'Permission denied',
    notFound: 'Resource not found',
    serverError: 'Internal server error',
    loadFailed: 'Load failed',
    actionFailed: 'Action failed',
  },
}

function getErrorMessage(key: string, locale: string = 'zh-CN'): string {
  return errorMessages[locale]?.[key] || errorMessages['zh-CN'][key] || key
}

export function useErrorHandler(moduleName: string) {
  let locale = 'zh-CN'

  try {
    const { locale: i18nLocale } = useI18n()
    locale = i18nLocale.value || 'zh-CN'
  } catch {
    // i18n not available, use default
  }

  function handleError(e: any, action: string = '操作') {
    const msg = e?.response?.data?.error || e?.message || getErrorMessage('unknown', locale)
    console.error(`[${moduleName}] ${action}失败:`, e)
    ElMessage.error(`${action}失败: ${msg}`)
  }

  function handleWarning(e: any, action: string = '加载') {
    const msg = e?.response?.data?.error || e?.message || getErrorMessage('unknown', locale)
    console.warn(`[${moduleName}] ${action}失败:`, e)
    ElMessage.warning(`${action}失败: ${msg}`)
  }

  function handleLoadError(e: any) {
    handleWarning(e, getErrorMessage('loadFailed', locale))
  }

  function handleActionError(e: any) {
    handleError(e, getErrorMessage('actionFailed', locale))
  }

  return {
    handleError,
    handleWarning,
    handleLoadError,
    handleActionError,
  }
}
