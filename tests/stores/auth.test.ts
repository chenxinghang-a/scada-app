/**
 * src/stores/auth.ts 测试
 *
 * 这里的关键不是"登录函数能跑通"，而是**落库的字段是否和别的模块对得上**：
 *   - 路由守卫读的是 localStorage 的 `scada_user.role` 与
 *     `scada_must_change_password`；
 *   - 响应拦截器读的是 `scada_refresh_token`；
 *   - 后端只用 `status: 'must_change_password'` 表达首次登录/被重置密码，
 *     没有 `must_change_password` 布尔字段 —— 归一化漏了就会**静默放行**
 *     临时密码用户进入所有业务页面。
 *
 * `verify()` 的三态（true / false / 'error'）也是回归重灾区：
 * 把网络错误当成 token 失效，离线用户会被直接登出。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const H = vi.hoisted(() => ({
  login: vi.fn(),
  verify: vi.fn(),
  logout: vi.fn(),
  resetCsrf: vi.fn(),
}))

vi.mock('@/api', () => ({
  authApi: { login: H.login, verify: H.verify, logout: H.logout },
}))
vi.mock('@/api/request', () => ({ resetCsrfToken: H.resetCsrf }))

// 必须在 mock 之后导入（store 的依赖已被替换）
async function makeStore() {
  const { useAuthStore } = await import('@/stores/auth')
  return useAuthStore()
}

const OK_LOGIN = {
  success: true,
  token: 'access-1',
  refresh_token: 'refresh-1',
  user: { username: 'ops', role: 'admin', display_name: '运维小陈' },
}

function clearCookies() {
  document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  clearCookies()
  setActivePinia(createPinia())
})

// ===========================================================================
// login
// ===========================================================================
describe('login 落库契约', () => {
  it('成功后 token / refresh_token / user 同时写入内存与 localStorage', async () => {
    H.login.mockResolvedValue({ ...OK_LOGIN })
    const store = await makeStore()

    const data = await store.login('ops', 'pwd')

    expect(data.success).toBe(true)
    expect(store.token).toBe('access-1')
    expect(store.refreshToken).toBe('refresh-1')
    expect(store.user?.username).toBe('ops')
    expect(store.isLoggedIn).toBe(true)
    expect(store.isAdmin).toBe(true)

    expect(localStorage.getItem('auth_token')).toBe('access-1')
    expect(localStorage.getItem('scada_refresh_token')).toBe('refresh-1')
    expect(JSON.parse(localStorage.getItem('scada_user')!).role).toBe('admin')
  })

  it('写入 token cookie 供后端/SSR 场景识别', async () => {
    H.login.mockResolvedValue({ ...OK_LOGIN })
    const store = await makeStore()
    await store.login('ops', 'pwd')
    expect(document.cookie).toContain('token=access-1')
  })

  it('登录成功会清掉上一个会话的 CSRF 缓存', async () => {
    H.login.mockResolvedValue({ ...OK_LOGIN })
    const store = await makeStore()
    await store.login('ops', 'pwd')
    expect(H.resetCsrf).toHaveBeenCalled()
  })

  it('没有 refresh_token 时必须清掉旧的 refresh_token（不能留上一个会话的）', async () => {
    localStorage.setItem('scada_refresh_token', 'stale-refresh')
    H.login.mockResolvedValue({ ...OK_LOGIN, refresh_token: undefined })
    const store = await makeStore()

    await store.login('ops', 'pwd')

    expect(localStorage.getItem('scada_refresh_token')).toBeNull()
    expect(store.refreshToken).toBeFalsy()
  })

  it('后端用 status=must_change_password 表达时归一化成标志位并落盘', async () => {
    // 回归点：这是后端**唯一**的"必须改密"信号，漏掉等于临时密码永久可用
    H.login.mockResolvedValue({ ...OK_LOGIN, status: 'must_change_password' })
    const store = await makeStore()

    const data = await store.login('ops', 'pwd')

    expect(data.must_change_password).toBe(true)
    expect(localStorage.getItem('scada_must_change_password')).toBe('true')
  })

  it('后端直接给 must_change_password=true 时同样落盘', async () => {
    H.login.mockResolvedValue({ ...OK_LOGIN, must_change_password: true })
    const store = await makeStore()
    await store.login('ops', 'pwd')
    expect(localStorage.getItem('scada_must_change_password')).toBe('true')
  })

  it('正常登录会清除上次会话残留的强制改密标志', async () => {
    localStorage.setItem('scada_must_change_password', 'true')
    H.login.mockResolvedValue({ ...OK_LOGIN })
    const store = await makeStore()

    await store.login('ops', 'pwd')

    expect(localStorage.getItem('scada_must_change_password')).toBeNull()
  })

  it('后端返回 success=false 时不写入任何凭证', async () => {
    H.login.mockResolvedValue({ success: false, error: '用户名或密码错误' })
    const store = await makeStore()

    const data = await store.login('ops', 'bad')

    expect(data.success).toBe(false)
    expect(store.token).toBeNull()
    expect(store.isLoggedIn).toBe(false)
    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(localStorage.getItem('scada_user')).toBeNull()
  })

  it('响应体为空时抛错，避免调用方拿到 undefined 继续跑', async () => {
    H.login.mockResolvedValue(null)
    const store = await makeStore()
    await expect(store.login('ops', 'pwd')).rejects.toThrow('登录响应为空')
  })
})

// ===========================================================================
// verify
// ===========================================================================
describe('verify 三态', () => {
  it('无 token 直接返回 false，且不请求后端', async () => {
    const store = await makeStore()
    expect(await store.verify()).toBe(false)
    expect(H.verify).not.toHaveBeenCalled()
  })

  it('后端判定有效 → true，并把最新 user 同步到 localStorage（守卫靠它判角色）', async () => {
    localStorage.setItem('auth_token', 'access-1')
    const store = await makeStore()
    H.verify.mockResolvedValue({
      valid: true,
      user: { username: 'ops', role: 'engineer' },
    })

    expect(await store.verify()).toBe(true)
    expect(store.user?.role).toBe('engineer')
    // 关键：不同步的话路由守卫仍按旧 role 判权限
    expect(JSON.parse(localStorage.getItem('scada_user')!).role).toBe('engineer')
  })

  it('后端判定无效 → false，并清理本地会话', async () => {
    localStorage.setItem('auth_token', 'access-1')
    localStorage.setItem('scada_refresh_token', 'refresh-1')
    localStorage.setItem('scada_user', JSON.stringify({ username: 'ops', role: 'admin' }))
    const store = await makeStore()
    H.verify.mockResolvedValue({ valid: false })
    H.logout.mockResolvedValue(undefined)

    expect(await store.verify()).toBe(false)
    expect(H.logout).toHaveBeenCalled()
    expect(store.token).toBeNull()
    expect(localStorage.getItem('auth_token')).toBeNull()
  })

  it('401 → 判定会话失效，登出并返回 false', async () => {
    localStorage.setItem('auth_token', 'access-1')
    const store = await makeStore()
    H.verify.mockRejectedValue({ response: { status: 401 } })
    H.logout.mockResolvedValue(undefined)

    expect(await store.verify()).toBe(false)
    expect(localStorage.getItem('auth_token')).toBeNull()
  })

  it('403 → 同样登出', async () => {
    localStorage.setItem('auth_token', 'access-1')
    const store = await makeStore()
    H.verify.mockRejectedValue({ response: { status: 403 } })
    H.logout.mockResolvedValue(undefined)

    expect(await store.verify()).toBe(false)
  })

  it('网络错误 → 返回 "error" 且保留 token（离线不能被登出）', async () => {
    // 回归点：把网络错误当失效会让后端一重启、网络一抖，所有人的会话被清空
    localStorage.setItem('auth_token', 'access-1')
    const store = await makeStore()
    H.verify.mockRejectedValue(new Error('Network Error'))

    expect(await store.verify()).toBe('error')
    expect(store.token).toBe('access-1')
    expect(localStorage.getItem('auth_token')).toBe('access-1')
    expect(H.logout).not.toHaveBeenCalled()
  })

  it('500 → 也算"服务端暂时不可用"，保留 token', async () => {
    localStorage.setItem('auth_token', 'access-1')
    const store = await makeStore()
    H.verify.mockRejectedValue({ response: { status: 500 } })

    expect(await store.verify()).toBe('error')
    expect(localStorage.getItem('auth_token')).toBe('access-1')
  })
})

// ===========================================================================
// logout
// ===========================================================================
describe('logout', () => {
  it('清理内存状态与全部本地凭证', async () => {
    H.login.mockResolvedValue({ ...OK_LOGIN, status: 'must_change_password' })
    H.logout.mockResolvedValue(undefined)
    const store = await makeStore()
    await store.login('ops', 'pwd')

    await store.logout()

    expect(store.token).toBeNull()
    expect(store.refreshToken).toBeNull()
    expect(store.user).toBeNull()
    expect(store.isLoggedIn).toBe(false)
    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(localStorage.getItem('scada_refresh_token')).toBeNull()
    expect(localStorage.getItem('scada_user')).toBeNull()
    expect(localStorage.getItem('scada_must_change_password')).toBeNull()
    expect(document.cookie).not.toContain('token=access-1')
    expect(H.resetCsrf).toHaveBeenCalled()
  })

  it('后端撤销接口失败也必须清理本地状态（否则用户永远退不出去）', async () => {
    localStorage.setItem('auth_token', 'access-1')
    const store = await makeStore()
    H.logout.mockRejectedValue(new Error('后端 500'))

    await expect(store.logout()).resolves.toBeUndefined()

    expect(store.token).toBeNull()
    expect(localStorage.getItem('auth_token')).toBeNull()
  })

  it('无 token 时不调用后端撤销接口', async () => {
    const store = await makeStore()
    await store.logout()
    expect(H.logout).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// 初始化恢复 & 计算属性
// ===========================================================================
describe('初始化与计算属性', () => {
  it('从 localStorage 恢复 token 与 user', async () => {
    localStorage.setItem('auth_token', 'access-1')
    localStorage.setItem('scada_refresh_token', 'refresh-1')
    localStorage.setItem('scada_user', JSON.stringify({ username: 'ops', role: 'engineer' }))

    const store = await makeStore()

    expect(store.token).toBe('access-1')
    expect(store.user?.username).toBe('ops')
    expect(store.isEngineer).toBe(true)
  })

  it('scada_user 损坏时清除，不阻塞 store 初始化', async () => {
    localStorage.setItem('scada_user', '{ 坏数据')
    const store = await makeStore()

    expect(store.user).toBeNull()
    expect(localStorage.getItem('scada_user')).toBeNull()
  })

  it('scada_user 结构不合法（缺 username）时也清除', async () => {
    localStorage.setItem('scada_user', JSON.stringify({ role: 'admin' }))
    const store = await makeStore()
    expect(store.user).toBeNull()
    expect(localStorage.getItem('scada_user')).toBeNull()
  })

  it('admin 同时满足 isEngineer（管理员天然具备工程师权限）', async () => {
    localStorage.setItem('scada_user', JSON.stringify({ username: 'a', role: 'admin' }))
    const store = await makeStore()
    expect(store.isAdmin).toBe(true)
    expect(store.isEngineer).toBe(true)
  })

  it('displayName / roleName 的兜底文案正确', async () => {
    const store = await makeStore()
    expect(store.displayName).toBe('用户')
    expect(store.roleName).toBe('-')

    localStorage.setItem('scada_user', JSON.stringify({ username: 'ops', role: 'operator' }))
    setActivePinia(createPinia())
    const store2 = await makeStore()
    expect(store2.displayName).toBe('ops')
    expect(store2.roleName).toBe('操作员')
  })
})
