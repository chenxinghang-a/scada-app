import axios from 'axios'
import type { AxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'
import { useAuthStore } from '@/stores/auth'

// 生产模式（Electron 打包后）直接请求后端，开发模式走 Vite proxy
const isDev = import.meta.env.DEV
const api = axios.create({
  baseURL: isDev ? '/api' : 'http://localhost:5000/api',
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
    const resp = await axios.get(`${isDev ? '/api' : 'http://localhost:5000/api'}/csrf-token`, { timeout: 5000 })
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
    `${isDev ? '/api' : 'http://localhost:5000/api'}/auth/refresh`,
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

// 响应拦截器 - 统一错误处理 + token 自动刷新 + success/data 信封解包
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
    const originalConfig = error.config as AxiosRequestConfig & { _retry?: boolean }
    if (error.response) {
      const { status, data } = error.response

      // 401 且未重试过 → 尝试刷新 token
      if (status === 401 && !originalConfig._retry) {
        originalConfig._retry = true

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
            if (!isRedirectingToLogin) {
              isRedirectingToLogin = true
              // 同步清理 Pinia store
              try { const store = useAuthStore(); store.token = null; store.refreshToken = null; store.user = null } catch {}
              localStorage.removeItem('auth_token')
              localStorage.removeItem('scada_refresh_token')
              localStorage.removeItem('scada_user')
              localStorage.removeItem('scada_must_change_password')
              document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
              const currentPath = router.currentRoute.value.fullPath
              const redirect = currentPath && currentPath !== '/login' ? currentPath : '/dashboard'
              router.push({ path: '/login', query: { redirect } })
              ElMessage.error('登录已过期，请重新登录')
              setTimeout(() => { isRedirectingToLogin = false }, 2000)
            }
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

      if (status === 403) {
        ElMessage.error('权限不足')
      } else if (status !== 401) {
        // 非 401/403 错误不跳转，只提示
        ElMessage.error(data?.error || `请求失败 (${status})`)
      }
    } else {
      // 网络错误不跳转，只提示
      ElMessage.error('网络连接失败，请检查后端服务是否启动')
    }
    return Promise.reject(error)
  }
)

export default api
