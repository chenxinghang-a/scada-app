/**
 * 错误源码映射 Composable
 * 错误堆栈+源码映射，便于定位前端错误。
 *
 * 用法:
 *   const { enhanceError, formatError } = useErrorSourceMap()
 *   const enhanced = enhanceError(error)
 */

import { ref } from 'vue'

interface SourceMapInfo {
  file: string
  line: number
  column: number
  source?: string
  context?: string[]
}

interface EnhancedError {
  name: string
  message: string
  stack: string
  sourceMap: SourceMapInfo | null
  timestamp: string
  url: string
  userAgent: string
}

export function useErrorSourceMap() {
  const lastError = ref<EnhancedError | null>(null)

  /** 增强错误信息 */
  function enhanceError(error: Error): EnhancedError {
    const enhanced: EnhancedError = {
      name: error.name,
      message: error.message,
      stack: error.stack || '',
      sourceMap: extractSourceMap(error),
      timestamp: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
    }

    lastError.value = enhanced
    return enhanced
  }

  /** 从堆栈中提取源码映射信息 */
  function extractSourceMap(error: Error): SourceMapInfo | null {
    if (!error.stack) return null

    // 匹配堆栈中的文件位置
    const stackLines = error.stack.split('\n')
    for (const line of stackLines) {
      // 匹配 at Function (file:line:column) 格式
      const match = line.match(/at\s+.*?\s+\((.+?):(\d+):(\d+)\)/)
      if (match) {
        const [, file, lineStr, colStr] = match
        // 过滤掉node_modules和内部文件
        if (!file.includes('node_modules') && !file.includes('<anonymous>')) {
          return {
            file: extractFileName(file),
            line: parseInt(lineStr, 10),
            column: parseInt(colStr, 10),
          }
        }
      }

      // 匹配 at file:line:column 格式
      const match2 = line.match(/at\s+(.+?):(\d+):(\d+)/)
      if (match2) {
        const [, file, lineStr, colStr] = match2
        if (!file.includes('node_modules') && !file.includes('<anonymous>')) {
          return {
            file: extractFileName(file),
            line: parseInt(lineStr, 10),
            column: parseInt(colStr, 10),
          }
        }
      }
    }

    return null
  }

  /** 提取文件名 */
  function extractFileName(path: string): string {
    const parts = path.split('/')
    return parts[parts.length - 1] || path
  }

  /** 格式化错误信息 */
  function formatError(error: EnhancedError): string {
    const lines = [
      `[${error.name}] ${error.message}`,
      `时间: ${error.timestamp}`,
      `URL: ${error.url}`,
    ]

    if (error.sourceMap) {
      lines.push(`位置: ${error.sourceMap.file}:${error.sourceMap.line}:${error.sourceMap.column}`)
    }

    if (error.stack) {
      lines.push('堆栈:')
      lines.push(error.stack)
    }

    return lines.join('\n')
  }

  /** 格式化为JSON（用于上报） */
  function formatForReport(error: EnhancedError): object {
    return {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      source: error.sourceMap ? {
        file: error.sourceMap.file,
        line: error.sourceMap.line,
        column: error.sourceMap.column,
      } : null,
      context: {
        url: error.url,
        userAgent: error.userAgent,
        timestamp: error.timestamp,
      },
    }
  }

  /** 解析堆栈帧 */
  function parseStackFrames(stack: string): Array<{ file: string; line: number; column: number; function: string }> {
    const frames: Array<{ file: string; line: number; column: number; function: string }> = []
    const lines = stack.split('\n')

    for (const line of lines) {
      const match = line.match(/at\s+(.*?)\s+\((.+?):(\d+):(\d+)\)/)
      if (match) {
        const [, func, file, lineStr, colStr] = match
        frames.push({
          file: extractFileName(file),
          line: parseInt(lineStr, 10),
          column: parseInt(colStr, 10),
          function: func,
        })
      }
    }

    return frames
  }

  return {
    lastError,
    enhanceError,
    formatError,
    formatForReport,
    parseStackFrames,
  }
}
