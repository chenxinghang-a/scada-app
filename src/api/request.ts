import axios from 'axios'
import type { AxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'
import { useAuthStore } from '@/stores/auth'

// 生产模式（Electron 打包后）直接请求后端，开发模式走 Vite proxy
const isDev = import.meta.env.DEV

// 读取 Electron 注入的实际后端端口；读不到回退 5000（开发模式走 Vite proxy，不使用此端口）
export function getBackendPort(): string {
  const p = (window as any).__BACKEND_PORT__
  const s = p != null ? String(p).trim() : ''
  return s && /^\d+$/.test(s) ? s : '5000'
}

// 生产模式后端 API 基础地址（含 /api 前缀）；开发模式走 Vite proxy
function getApiBaseURL(): string {
  return isDev ? '/api' : `http://localhost:${getBackendPort()}/api`
}

// 供 WebSocket 等模块使用的后端基础地址（不含 /api）
export function getWsBaseUrl(): string {
  if (isDev) return window.location.origin
  return `http://localhost:${getBackendPort()}`
}

const api = axios.create({
  baseURL: getApiBaseURL(),
  timeout: 30000,
})

// 防止 401 连锁跳转：标记正在跳转中，避免多个请求同时 401 导致反复刷新
let isRedirectingToLogin = false
// token 刷新中标记，防止并发刷新
let isRefreshing = false
let refreshQueue: Array<{ resolve: (token: string) => void; reject: (err: any) => void }> = []

// CSRF token 缓存
let csrfToken: string | null = null
let csrfAttempted = false
let csrfLastAttempt = 0
const CSRF_RETRY_INTERVAL = 30000 // 30秒后重试

async function ensureCsrfToken(): Promise<string | null> {
  const now = Date.now()
  // 如果已获取到token，直接返回
  if (csrfToken) return csrfToken
  // 如果上次尝试失败且未超过重试间隔，返回null
  if (csrfAttempted && (now - csrfLastAttempt) < CSRF_RETRY_INTERVAL) return null
  csrfAttempted = true
  csrfLastAttempt = now
  try {
    const resp = await axios.get(`${getApiBaseURL()}/csrf-token`, { timeout: 5000 })
    csrfToken = resp.data?.csrf_token || null
    return csrfToken
  } catch {
    // CSRF 端点不存在（后端未启用），允许后续重试
    return null
  }
}

// 请求拦截器 - 注入 JWT token + CSRF token
api.interceptors.request.use(async (config) => {
  const token = localStorage.getItem('auth_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  // 生产模式：动态拼接 Electron 注入的后端端口（支持运行时变更，避免写死 5000）
  if (!isDev && config.url && !/^https?:\/\//.test(config.url)) {
    config.baseURL = `http://localhost:${getBackendPort()}/api`
  }
  // POST/PUT/DELETE 请求注入 CSRF token
  const method = config.method?.toUpperCase()
  if (method && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const csrf = await ensureCsrfToken()
    if (csrf) {
      config.headers['X-CSRF-Token'] = csrf
    }
  }
  return config
})

// 刷新 token
async function doRefreshToken(): Promise<string> {
  const refreshToken = localStorage.getItem('scada_refresh_token')
  if (!refreshToken) throw new Error('no refresh token')
  const resp = await axios.post(
    `${getApiBaseURL()}/auth/refresh`,
    { refresh_token: refreshToken },
    { timeout: 10000 }
  )
  const newToken = resp.data?.token
  if (!newToken) throw new Error('refresh failed')
  localStorage.setItem('auth_token', newToken)
  if (resp.data?.refresh_token) {
    localStorage.setItem('scada_refresh_token', resp.data.refresh_token)
  }
  // 更新cookie对齐原项目
  document.cookie = `token=${encodeURIComponent(newToken)}; path=/; SameSite=Lax`
  // 同步 Pinia store，避免响应式状态过期
  try {
    const authStore = useAuthStore()
    authStore.token = newToken
  } catch { /* store 未初始化时忽略 */ }
  return newToken
}

// 获取认证 token（供外部如 WebSocket 使用）
export function getAuthToken(): string | null {
  return localStorage.getItem('auth_token')
}

// 登录/登出时调用，清除 CSRF 缓存
export function resetCsrfToken() {
  csrfToken = null
  csrfAttempted = false
}

// 只有幂等方法允许在网络错误后自动重试；POST/PUT/PATCH/DELETE 可能是控制写入/急停，重试会造成重复危险动作
const RETRYABLE_METHODS = ['get', 'head', 'options']

// 会话失效时统一清理本地凭证并跳转登录页（isRedirectingToLogin 抑制重复提示/重复跳转）
function clearSessionAndRedirect() {
  try {
    const store = useAuthStore()
    store.token = null
    store.refreshToken = null
    store.user = null
  } catch { /* store 未初始化时忽略 */ }
  localStorage.removeItem('auth_token')
  localStorage.removeItem('scada_refresh_token')
  localStorage.removeItem('scada_user')
  localStorage.removeItem('scada_must_change_password')
  document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  if (isRedirectingToLogin) return
  isRedirectingToLogin = true
  setTimeout(() => { isRedirectingToLogin = false }, 2000)
  if (router.currentRoute.value.path === '/login') return
  const currentPath = router.currentRoute.value.fullPath
  router.push({ path: '/login', query: { redirect: currentPath || '/dashboard' } })
  ElMessage.error('登录已过期，请重新登录')
}

// 响应拦截器 - 统一错误处理 + token 自动刷新 + success/data 信封解包 + 网络重试
api.interceptors.response.use(
  (response) => {
    const data = response.data
    // 自动解包 { success, data, message } 信封（api_industry40/api_health 使用此格式）
    if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
      return data.data
    }
    return data
  },
  async (error) => {
    // 请求被主动取消（组件卸载/切换页面/超时中止）：静默失败，既不重试也不提示
    if (axios.isCancel(error)) {
      return Promise.reject(error)
    }

    const originalConfig = error.config as AxiosRequestConfig & { _retry?: boolean; _retryCount?: number }
    // 拦截器抛错等异常可能没有 config，避免后续读属性崩溃
    if (!originalConfig) {
      return Promise.reject(error)
    }

    const method = String(originalConfig.method || 'get').toLowerCase()

    // 网络错误自动重试（最多3次，指数退避，仅限幂等方法）
    if (!error.response && !originalConfig._retry && RETRYABLE_METHODS.includes(method)) {
      const maxRetries = 3
      const retryCount = originalConfig._retryCount || 0

      if (retryCount < maxRetries) {
        originalConfig._retryCount = retryCount + 1
        const delay = Math.pow(2, retryCount) * 1000  // 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, delay))
        return api(originalConfig)
      }
    }

    if (error.response) {
      const { status, data } = error.response
      // 该请求发出时携带的 token；无 token 的请求（如登录）不参与刷新与登出逻辑
      const usedToken = String((originalConfig.headers as any)?.Authorization || '')

      // 会话正在清理中：直接失败，避免对已失效的 refresh_token 反复刷新
      if (status === 401 && isRedirectingToLogin) {
        return Promise.reject(error)
      }

      // 401 且未重试过 → 尝试刷新 token
      if (status === 401 && usedToken && !originalConfig._retry) {
        originalConfig._retry = true

        // 并发 401 的迟到响应：token 已被其它请求刷新 → 直接用新 token 重试，不重复刷新
        const currentToken = localStorage.getItem('auth_token')
        if (currentToken && `Bearer ${currentToken}` !== usedToken) {
          if (originalConfig.headers) {
            originalConfig.headers.Authorization = `Bearer ${currentToken}`
          }
          return api(originalConfig)
        }

        if (!isRefreshing) {
          isRefreshing = true
          try {
            const newToken = await doRefreshToken()
            // 刷新成功，重试原始请求
            if (originalConfig.headers) {
              originalConfig.headers.Authorization = `Bearer ${newToken}`
            }
            // 通知队列中的等待者
            refreshQueue.forEach(cb => cb.resolve(newToken))
            refreshQueue = []
            return api(originalConfig)
          } catch (refreshErr) {
            // 刷新失败，清除登录状态
            refreshQueue.forEach(cb => cb.reject(new Error('refresh failed')))
            refreshQueue = []
            clearSessionAndRedirect()
            // 必须 reject，否则调用方收到 undefined 会崩溃
            return Promise.reject(refreshErr)
          } finally {
            isRefreshing = false
          }
        } else {
          // 正在刷新中，加入队列等待
          return new Promise((resolve, reject) => {
            refreshQueue.push({
              resolve: (token: string) => {
                if (originalConfig.headers) {
                  originalConfig.headers.Authorization = `Bearer ${token}`
                }
                resolve(api(originalConfig))
              },
              reject,
            })
          })
        }
      }

      // 已刷新过 token 仍返回 401 → 会话确实失效，清理并跳登录（否则用户会卡在全 401 的页面）
      if (status === 401 && originalConfig._retry) {
        clearSessionAndRedirect()
        return Promise.reject(error)
      }

      if (status === 403) {
        ElMessage.error('权限不足')
      } else if (status !== 401) {
        // 非 401/403 错误不跳转，只提示（后端错误体可能用 error 或 message 字段）
        ElMessage.error(data?.error || data?.message || `请求失败 (${status})`)
      }
    } else {
      // 网络错误不跳转，只提示
      ElMessage.error('网络连接失败，请检查后端服务是否启动')
    }
    return Promise.reject(error)
  }
)

// 监听 Electron 后端状态变更事件（下发 port 字段），实时更新后端基础地址
if (typeof window !== 'undefined') {
  window.addEventListener('backend-status-changed', ((e: any) => {
    const port = e?.detail?.port ?? e?.port
    if (port != null) {
      ;(window as any).__BACKEND_PORT__ = port
      api.defaults.baseURL = `http://localhost:${getBackendPort()}/api`
    }
  }) as EventListener)
}

export default api
