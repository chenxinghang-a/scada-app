import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi, type UserInfo } from '@/api'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserInfo | null>(null)
  const token = ref<string | null>(localStorage.getItem('auth_token'))
  const refreshToken = ref<string | null>(localStorage.getItem('scada_refresh_token'))

  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => user.value?.role === 'admin')
  const isEngineer = computed(() => user.value?.role === 'engineer' || isAdmin.value)
  const displayName = computed(() => user.value?.display_name || user.value?.username || '用户')
  const roleName = computed(() => {
    const roles: Record<string, string> = {
      admin: '管理员',
      engineer: '工程师',
      viewer: '观察者',
    }
    return roles[user.value?.role || ''] || user.value?.role || '-'
  })

  async function login(username: string, password: string) {
    const data = await authApi.login({ username, password })
    if (data.success) {
      token.value = data.token
      refreshToken.value = data.refresh_token
      user.value = data.user
      localStorage.setItem('auth_token', data.token)
      localStorage.setItem('scada_refresh_token', data.refresh_token)
      localStorage.setItem('scada_user', JSON.stringify(data.user))
    }
    return data
  }

  async function verify() {
    if (!token.value) return false
    try {
      const data = await authApi.verify()
      if (data.valid) {
        user.value = data.user
        return true
      }
      // token 确实无效（服务端明确返回 invalid）
      logout()
      return false
    } catch (err: any) {
      // 网络错误 / 超时 / 500 等 → 不要清 token，只是验证失败
      // 只有 401 才清 token（由 request.ts 拦截器处理）
      const status = err?.response?.status
      if (status === 401 || status === 403) {
        logout()
      }
      // 其他错误保留 token，下次再试
      return false
    }
  }

  function logout() {
    token.value = null
    refreshToken.value = null
    user.value = null
    localStorage.removeItem('auth_token')
    localStorage.removeItem('scada_refresh_token')
    localStorage.removeItem('scada_user')
  }

  // 从 localStorage 恢复用户信息
  const savedUser = localStorage.getItem('scada_user')
  if (savedUser) {
    try {
      user.value = JSON.parse(savedUser)
    } catch {
      // ignore
    }
  }

  return {
    user,
    token,
    isLoggedIn,
    isAdmin,
    isEngineer,
    displayName,
    roleName,
    login,
    verify,
    logout,
  }
})
