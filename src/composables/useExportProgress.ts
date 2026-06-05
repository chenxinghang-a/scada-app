/**
 * 数据导出进度显示 Composable
 * 大文件导出时显示进度条+ETA+取消操作。
 *
 * 用法:
 *   const { progress, isExporting, startExport, cancelExport } = useExportProgress()
 *   await startExport('/api/export/history', { format: 'csv' })
 */

import { ref, computed, onUnmounted } from 'vue'

interface ExportOptions {
  format?: 'csv' | 'excel' | 'pdf'
  filename?: string
  onProgress?: (percent: number) => void
  onComplete?: (blob: Blob, filename: string) => void
  onError?: (error: Error) => void
}

interface ExportProgress {
  percent: number
  loaded: number
  total: number
  speed: number // bytes/sec
  eta: number // seconds
  status: 'idle' | 'downloading' | 'processing' | 'complete' | 'error' | 'cancelled'
  error?: string
}

export function useExportProgress() {
  const progress = ref<ExportProgress>({
    percent: 0,
    loaded: 0,
    total: 0,
    speed: 0,
    eta: 0,
    status: 'idle',
  })

  const isExporting = computed(() =>
    progress.value.status === 'downloading' || progress.value.status === 'processing'
  )

  let abortController: AbortController | null = null
  let speedSamples: { loaded: number; time: number }[] = []

  async function startExport(url: string, params: Record<string, any> = {}, options: ExportOptions = {}) {
    if (isExporting.value) return

    progress.value = { percent: 0, loaded: 0, total: 0, speed: 0, eta: 0, status: 'downloading' }
    speedSamples = []
    abortController = new AbortController()

    const startTime = Date.now()
    let lastLoaded = 0
    let lastTime = startTime

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`导出失败: ${response.status} ${response.statusText}`)
      }

      const contentLength = response.headers.get('Content-Length')
      const total = contentLength ? parseInt(contentLength, 10) : 0
      const contentType = response.headers.get('Content-Type') || ''

      // 检查是否是JSON错误响应
      if (contentType.includes('application/json')) {
        const text = await response.text()
        try {
          const json = JSON.parse(text)
          if (json.error || json.success === false) {
            throw new Error(json.error || '导出失败')
          }
        } catch (parseErr) {
          if (parseErr instanceof Error && parseErr.message !== '导出失败') {
            // 不是JSON错误，可能是正常的JSON数据
          } else {
            throw parseErr
          }
        }
      }

      progress.value.total = total

      // 流式读取进度
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('无法读取响应流')
      }

      const chunks: Uint8Array[] = []
      let received = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        chunks.push(value)
        received += value.length

        // 计算速度和ETA
        const now = Date.now()
        const elapsed = (now - startTime) / 1000
        const speed = received / elapsed

        // 滑动窗口平均速度
        speedSamples.push({ loaded: received, time: now })
        speedSamples = speedSamples.filter(s => now - s.time < 5000) // 保留5秒窗口
        let avgSpeed = speed
        if (speedSamples.length >= 2) {
          const first = speedSamples[0]
          const last = speedSamples[speedSamples.length - 1]
          avgSpeed = (last.loaded - first.loaded) / ((last.time - first.time) / 1000)
        }

        const percent = total > 0 ? Math.round((received / total) * 100) : 0
        const eta = total > 0 ? (total - received) / avgSpeed : 0

        progress.value = {
          percent: total > 0 ? percent : -1, // -1 表示未知总量
          loaded: received,
          total,
          speed: avgSpeed,
          eta: Math.max(0, eta),
          status: 'downloading',
        }

        options.onProgress?.(percent)
      }

      // 组装Blob
      const blob = new Blob(chunks, { type: contentType })
      const filename = options.filename || getFilenameFromResponse(response) || 'export'

      progress.value.status = 'processing'

      // 触发下载
      downloadBlob(blob, filename)

      progress.value = {
        percent: 100,
        loaded: received,
        total: received,
        speed: 0,
        eta: 0,
        status: 'complete',
      }

      options.onComplete?.(blob, filename)
    } catch (err: any) {
      if (err.name === 'AbortError') {
        progress.value.status = 'cancelled'
        return
      }

      progress.value.status = 'error'
      progress.value.error = err.message
      options.onError?.(err)
    }
  }

  function cancelExport() {
    abortController?.abort()
    progress.value.status = 'cancelled'
  }

  function reset() {
    abortController?.abort()
    progress.value = { percent: 0, loaded: 0, total: 0, speed: 0, eta: 0, status: 'idle' }
    speedSamples = []
  }

  function getFilenameFromResponse(response: Response): string | null {
    const disposition = response.headers.get('Content-Disposition')
    if (!disposition) return null
    const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
    return match ? match[1].replace(/['"]/g, '') : null
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    setTimeout(() => {
      URL.revokeObjectURL(url)
      a.remove()
    }, 100)
  }

  /** 格式化文件大小 */
  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  /** 格式化速度 */
  function formatSpeed(bytesPerSec: number): string {
    if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`
    if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
  }

  /** 格式化ETA */
  function formatEta(seconds: number): string {
    if (seconds < 60) return `${Math.ceil(seconds)}秒`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分${Math.ceil(seconds % 60)}秒`
    return `${Math.floor(seconds / 3600)}时${Math.floor((seconds % 3600) / 60)}分`
  }

  onUnmounted(() => {
    abortController?.abort()
  })

  return {
    progress,
    isExporting,
    startExport,
    cancelExport,
    reset,
    formatSize,
    formatSpeed,
    formatEta,
  }
}
