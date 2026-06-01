import api from './request'

export interface LoginParams {
  username: string
  password: string
}

export interface UserInfo {
  username: string
  display_name: string
  role: string
  role_name: string
}

export const authApi = {
  login(params: LoginParams) {
    return api.post('/auth/login', params) as Promise<{
      success: boolean
      token: string
      refresh_token: string
      user: UserInfo
      must_change_password?: boolean
    } | null>
  },

  logout() {
    return api.post('/auth/logout') as Promise<{ success: boolean }>
  },

  verify() {
    return api.get('/auth/verify') as Promise<{ valid: boolean; user: UserInfo }>
  },

  refreshToken(refreshToken: string) {
    return api.post('/auth/refresh', { refresh_token: refreshToken }) as Promise<{
      success: boolean
      token: string
    }>
  },

  register(params: { username: string; password: string; role?: string; display_name?: string }) {
    return api.post('/auth/register', params) as Promise<{ success: boolean; message: string }>
  },

  changePassword(oldPassword: string, newPassword: string) {
    return api.post('/auth/change-password', {
      old_password: oldPassword,
      new_password: newPassword,
    }) as Promise<{ success: boolean; message: string }>
  },

  getUsers() {
    return api.get('/auth/users') as Promise<{ users: UserInfo[] }>
  },

  updateUser(username: string, data: { display_name?: string; role?: string; password?: string }) {
    return api.put(`/auth/users/${username}`, data) as Promise<{ success: boolean; message: string }>
  },

  deleteUser(username: string) {
    return api.delete(`/auth/users/${username}`) as Promise<{ success: boolean; message: string }>
  },

  getLogs(params?: { page?: number; per_page?: number }) {
    return api.get('/auth/logs', { params })
  },
}
