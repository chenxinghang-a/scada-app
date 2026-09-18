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
