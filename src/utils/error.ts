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

/**
 * 检查控制类响应的 `{success:false}` 信封 —— 被拒绝时**抛错**。
 *
 * 为什么必须有（2026-10-13，联锁 fail-closed 整改暴露的端到端问题）：
 * 后端控制端点（写寄存器/写线圈/批量控制/复位急停/联锁旁路…）在**被拒绝**时
 * 返回的是 **HTTP 200** + `{success:false, message:'…'}`，**不是错误码** ——
 * axios 不会抛异常。调用处若只 `await` 不看返回值、直接
 * `ElMessage.success('写入成功')`，就会出现**「显示成功、实际被拒」的假成功**：
 *   · 安全联锁缺失/未解除（整改后 fail-closed 拒绝是**常规路径**）
 *   · 写白名单之外 / 量程之外 / 设备不存在
 * 工业场景下这种误导会让操作员**误判设备已动作**（甚至反复操作）。
 *
 * 用法：`const res = await controlApi.xxx(); ensureControlOk(res)`
 * —— 被拒时抛错，走既有的 `catch → showActionError` 通道（文案/样式归一）。
 *
 * 设计取舍：只认**显式** `success === false`（undefined/缺字段一律放行）——
 * 避免对不使用该信封的端点（如解包后的 `data`）产生误伤。
 */
export function ensureControlOk(res: unknown): void {
  if (res && typeof res === 'object' && (res as Record<string, unknown>).success === false) {
    const r = res as Record<string, unknown>
    const msg = normalizeErrorMsg(r.message) || normalizeErrorMsg(r.reason) || '操作被服务端拒绝'
    throw new Error(msg)
  }
}
