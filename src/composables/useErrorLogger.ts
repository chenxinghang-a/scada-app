/**
 * 前端错误日志上报
 * 捕获 Vue 组件异常、未处理 Promise 拒绝、JS 运行时错误，
 * 批量上报到后端 /api/system/client-errors 端点。
 *
 * 等保2.0 GB/T 22239 要求：应记录安全事件，便于事后追溯。
 */

import { ref, onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/auth'

interface ErrorEntry {
  type: 'vue' | 'unhandledrejection' | 'js' | 'resource'
  message: string
  stack?: string
  component?: string
  url: string
  userAgent: string
  timestamp: string
  userId?: string
}

const errorQueue = ref<ErrorEntry[]>([])
const MAX_QUEUE_SIZE = 50
const FLUSH_INTERVAL = 30000 // 30秒批量上报
let flushTimer: ReturnType<typeof setInterval> | null = null
let installed = false

function addError(entry: ErrorEntry) {
  if (errorQueue.value.length >= MAX_QUEUE_SIZE) {
    errorQueue.value.shift() // 丢弃最旧的
  }
  errorQueue.value.push(entry)
}

async function flushErrors() {
  if (errorQueue.value.length === 0) return
  const batch = [...errorQueue.value]
  errorQueue.value = []

  try {
    const isDev = import.meta.env.DEV
    const base = isDev ? '/api' : 'http://localhost:5000/api'
    await fetch(`${base}/system/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ errors: batch }),
      keepalive: true, // 页面卸载时也能发送
    })
  } catch {
    // 上报失败不重试，避免循环
  }
}

function getUserId(): string | undefined {
  try {
    const authStore = useAuthStore()
    return authStore.user?.username
  } catch {
    return undefined
  }
}

/**
 * 全局安装错误监听（应在 main.ts 中调用一次）
 */
export function installErrorLogger() {
  if (installed) return
  installed = true

  // Vue 错误由 App.vue 的 onErrorCaptured 处理，这里处理全局 JS 错误
  window.addEventListener('error', (event) => {
    // 排除资源加载错误（由 resource handler 处理）
    if (event.target && (event.target as HTMLElement).tagName) return
    addError({
      type: 'js',
      message: event.message || 'Unknown error',
      stack: event.error?.stack,
      url: location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      userId: getUserId(),
    })
  })

  // 未处理的 Promise 拒绝
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    addError({
      type: 'unhandledrejection',
      message: reason?.message || String(reason),
      stack: reason?.stack,
      url: location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      userId: getUserId(),
    })
  })

  // 资源加载失败
  window.addEventListener('error', (event) => {
    const target = event.target as HTMLElement
    if (!target?.tagName) return
    const src = (target as HTMLImageElement).src || (target as HTMLScriptElement).src || ''
    addError({
      type: 'resource',
      message: `资源加载失败: ${target.tagName} ${src}`,
      url: location.href,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
      userId: getUserId(),
    })
  }, true) // capture phase

  // 定时批量上报
  flushTimer = setInterval(flushErrors, FLUSH_INTERVAL)

  // 页面卸载时上报剩余错误
  window.addEventListener('beforeunload', flushErrors)
}

/**
 * 手动上报 Vue 组件错误（供 ErrorBoundary 使用）
 */
export function reportVueError(error: Error, component?: string) {
  addError({
    type: 'vue',
    message: error.message,
    stack: error.stack,
    component,
    url: location.href,
    userAgent: navigator.userAgent,
    timestamp: new Date().toISOString(),
    userId: getUserId(),
  })
}

/**
 * Composable: 在组件中使用错误日志
 */
export function useErrorLogger() {
  return {
    reportError: reportVueError,
    flushErrors,
    errorQueue,
  }
}
