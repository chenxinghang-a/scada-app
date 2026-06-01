import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authApi, type UserInfo } from '@/api'
import { resetCsrfToken } from '@/api/request'

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
      operator: '操作员',
      viewer: '观察者',
    }
    return roles[user.value?.role || ''] || user.value?.role || '-'
  })

  async function login(username: string, password: string) {
    const data = await authApi.login({ username, password })
    if (!data) throw new Error('登录响应为空')
    if (data.success) {
      token.value = data.token
      refreshToken.value = data.refresh_token
      user.value = data.user
      localStorage.setItem('auth_token', data.token)
      if (data.refresh_token) localStorage.setItem('scada_refresh_token', data.refresh_token)
      else localStorage.removeItem('scada_refresh_token')
      localStorage.setItem('scada_user', JSON.stringify(data.user))
      // 设置cookie对齐原项目（httponly由后端设置，前端设置SameSite=Lax）
      document.cookie = `token=${encodeURIComponent(data.token)}; path=/; SameSite=Lax`
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
      await logout()
      return false
    } catch (err: any) {
      const status = err?.response?.status
      if (status === 401 || status === 403) {
        await logout()
      }
      // 其他错误保留 token，下次再试
      return false
    }
  }

  async function logout() {
    // 调用后端API撤销token（原项目要求）
    try {
      if (token.value) {
        await authApi.logout()
      }
    } catch {
      // 即使后端调用失败，也要清除本地状态
    }
    token.value = null
    refreshToken.value = null
    user.value = null
    localStorage.removeItem('auth_token')
    localStorage.removeItem('scada_refresh_token')
    localStorage.removeItem('scada_user')
    localStorage.removeItem('scada_must_change_password')
    // 清除cookie（对齐原项目）
    document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  }

  // 从 localStorage 恢复用户信息
  const savedUser = localStorage.getItem('scada_user')
  if (savedUser) {
    try {
      const parsed = JSON.parse(savedUser)
      if (parsed && typeof parsed === 'object' && parsed.username) {
        user.value = parsed
      } else {
        // 数据结构异常，清除
        localStorage.removeItem('scada_user')
      }
    } catch {
      // JSON 解析失败，清除损坏数据
      localStorage.removeItem('scada_user')
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
