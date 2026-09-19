/**
 * 通用导出工具函数
 */

/**
 * CSV转义
 *
 * 除常规的逗号/引号/换行转义外，还需防"公式注入"（CSV Injection）：
 * 以 = + - @ 或制表符/回车开头的单元格，被 Excel/WPS 打开时会当公式执行
 * （如 =cmd|'/C calc'!A1），因此前置单引号强制为文本。
 * 纯负数（-5、-1.2e3）不是公式，不做处理，避免污染正常数值列。
 */
export function escCSV(value: any): string {
  const s = String(value ?? '')
  const isNegativeNumber = /^-\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)
  const escaped = /^[=+\-@\t\r]/.test(s) && !isNegativeNumber ? `'${s}` : s
  return /[",\r\n]/.test(escaped)
    ? `"${escaped.replace(/"/g, '""')}"` : escaped
}

/** 触发浏览器下载并释放 blob URL（延迟释放，避免下载启动前 URL 已失效） */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * 下载CSV文件
 */
export function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8' })
  triggerDownload(blob, filename)
}

/**
 * 下载JSON文件
 */
export function downloadJSON(data: any, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  triggerDownload(blob, filename)
}

/**
 * 下载Blob文件
 */
export function downloadBlob(blob: Blob, filename: string): void {
  triggerDownload(blob, filename)
}

// ---------------------------------------------------------------------------
// 二进制下载的内容守卫
// ---------------------------------------------------------------------------

/** 后端错误体被包成 Blob 时抛出的错误，调用方可据此给出可读提示 */
export class BlobContentError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'BlobContentError'
    this.status = status
  }
}

/**
 * 判断一段文本是否像 JSON（而非 CSV / PDF / Excel 等真实文件内容）。
 *
 * 为什么需要这个判断：`responseType: 'blob'` 的请求，当后端返回**错误 JSON**
 * 时，axios 不会走 reject —— HTTP 状态码可能是 200，`response.data` 就是一个
 * 内容为 `{"error": "..."}` 的 Blob。若不检查就直接下载，用户会得到一个
 * 名为 `.csv` / `.xlsx` 的假文件，打开才发现是报错文本。
 *
 * 判据说明：**不能依赖 `blob.type`**。
 *   - 后端出错时未必设置 Content-Type（实测多为空串或 `application/octet-stream`）；
 *   - 部分后端会把错误体标成 `application/json`，但成功文件也可能被标错。
 * 所以唯一可靠的判据是**内容本身**：去掉 BOM 与空白后以 `{` 或 `[` 开头，
 * 且能被 JSON.parse 解析成功。
 */
function looksLikeJson(text: string): boolean {
  // 去掉 UTF-8 BOM（\uFEFF）与首尾空白
  const s = text.replace(/^\uFEFF/, '').trim()
  if (!s) return false
  if (!s.startsWith('{') && !s.startsWith('[')) return false
  try {
    JSON.parse(s)
    return true
  } catch {
    return false
  }
}

/**
 * 从 Blob 中提取后端错误信息。
 *
 * 只在内容确实是 JSON 时返回消息，否则返回 `null`（表示"这是一个正常文件"）。
 */
async function extractJsonErrorMessage(blob: Blob): Promise<string | null> {
  // 只读头部即可判定：错误体通常很短，且大文件全量读入会浪费内存。
  const head = await blob.slice(0, 8192).text()
  if (!looksLikeJson(head)) return null
  try {
    const obj = JSON.parse(head)
    return String(obj?.error || obj?.message || obj?.msg || '后端返回了错误信息')
  } catch (e) {
    // 头部 8KB 被截断导致解析失败：这是"内容像 JSON 但更长"的情况，
    // 仍然判定为错误体（正常的 CSV/Excel 不会以 { 开头）。
    void e
    return '后端返回了无法解析的错误响应'
  }
}

/**
 * 校验二进制下载响应，必要时抛错。
 *
 * 用法（替换原先各调用方各自手写的检查）：
 * ```ts
 * const blob = await dataApi.exportDevice(id, params) as unknown as Blob
 * await assertBinaryDownload(blob)
 * downloadBlob(blob, 'xxx.csv')
 * ```
 *
 * @throws {BlobContentError} 响应不是 Blob，或内容是后端错误 JSON
 */
export async function assertBinaryDownload(blob: unknown): Promise<Blob> {
  if (!(blob instanceof Blob)) {
    throw new BlobContentError('导出失败：后端返回的响应格式异常（非二进制内容）')
  }
  // 大小写不敏感地判断：真实文件不会是 0 字节且无错误信息，
  // 但 0 字节也拿不到内容，同样视为失败。
  if (blob.size === 0) {
    throw new BlobContentError('导出失败：后端返回了空文件')
  }
  const msg = await extractJsonErrorMessage(blob)
  if (msg) {
    throw new BlobContentError(msg)
  }
  return blob
}

/**
 * 把任意异常转成可读的导出失败原因。
 *
 * 覆盖三种来源：
 *   1. `BlobContentError`（由 `assertBinaryDownload` 抛出）—— 直接用其 message；
 *   2. axios 错误且 `response.data` 是 Blob（**catch 路径**下的错误 JSON）—— 解包后取 message；
 *   3. 其它异常 —— 依次回落到 `response.data.error/message` 与 `error.message`。
 *
 * 原先 `History.vue` 只处理了第 2 种，导致"200 + JSON 错误体"这类
 * 不抛异常的失败场景漏判；统一到这里后两类都能覆盖。
 */
export async function describeDownloadError(e: any): Promise<string> {
  if (e instanceof BlobContentError) return e.message

  const data = e?.response?.data
  if (data instanceof Blob) {
    try {
      const text = await data.slice(0, 8192).text()
      const obj = JSON.parse(text)
      return String(obj?.error || obj?.message || obj?.msg || e?.message || '未知错误')
    } catch {
      /* 非 JSON 错误体，回落到 axios 消息 */
    }
  }
  return String(data?.error || data?.message || e?.message || '未知错误')
}

