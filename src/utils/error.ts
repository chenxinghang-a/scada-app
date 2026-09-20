import { ElMessage } from 'element-plus'

/**
 * 把后端的各种错误体归一化成可读文本
 * （error 字段可能是对象 {code,message}，直接模板拼接会显示 "[object Object]"）
 */
function normalizeErrorMsg(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    return String(o.message ?? o.error ?? '')
  }
  return String(v)
}

/** 从 axios 风格异常中取出后端错误体（response.data.error / response.data.message） */
function backendErrorText(e: unknown): string {
  if (!e || typeof e !== 'object') return ''
  const resp = (e as Record<string, unknown>).response
  if (!resp || typeof resp !== 'object') return ''
  const data = (resp as Record<string, unknown>).data
  if (!data || typeof data !== 'object') return ''
  const d = data as Record<string, unknown>
  return normalizeErrorMsg(d.error) || normalizeErrorMsg(d.message)
}

/**
 * 从任意异常中取出可读文本，等价于旧写法 `e?.response?.data?.error || e?.message || e`。
 * 用于 `catch (e)` 场景（TS 下 e 是 unknown，不能直接读 .message）。
 * 优先级：后端错误体 → Error.message → 其它对象 → String(e)。
 */
export function errorMessage(e: unknown): string {
  const backend = backendErrorText(e)
  if (backend) return backend
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    return normalizeErrorMsg(o.message) || String(e)
  }
  return String(e)
}

/**
 * 用户操作失败时显示错误提示
 * @param action 操作描述（如"保存配置"）
 * @param error 捕获的异常
 */
export function showActionError(action: string, error?: unknown) {
  const msg = errorMessage(error) || '未知错误'
  console.error(`[操作失败] ${action}:`, error)
  ElMessage.error(`${action}失败: ${msg}`)
}

/**
 * 数据加载失败时记录日志（不弹 toast，避免轮询刷屏）
 * @param module 模块名（如"设备列表"）
 * @param error 捕获的异常
 */
export function logLoadError(module: string, error?: unknown) {
  const msg = errorMessage(error) || '未知错误'
  console.warn(`[加载失败] ${module}: ${msg}`)
}
