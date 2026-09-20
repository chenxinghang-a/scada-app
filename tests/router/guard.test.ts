/**
 * src/router/index.ts 全局守卫测试
 *
 * 守卫是这台 SCADA 的**唯一入口闸门**：前端权限全部靠它兜底
 * （后端也有校验，但页面/按钮级泄露由这里决定）。
 *
 * 关键回归点：
 *   1. 未登录必须带 redirect 回登录页 —— 否则登录后用户被丢回仪表盘，
 *      正在做的操作（比如改某个设备参数）上下文丢失；
 *   2. must_change_password 闸门必须能拦住所有业务页 —— 否则临时密码
 *      可以被无限期使用（合规问题）；
 *   3. 角色不匹配回仪表盘，且**仪表盘自身无权限时不能自己跳自己**
 *      （会触发 vue-router 的无限重定向检测并白屏）；
 *   4. token 过期且没有 refresh_token 时必须清凭证，否则用户卡在
 *      所有请求 401 的页面里。
 *
 * 隔离说明：所有视图组件被替换成空组件。守卫测试只关心"跳到哪"，
 * 加载真实的 Dashboard/History（echarts + socket.io）既慢又和断言无关。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// vi.hoisted 保证这个工厂在 vi.mock 调用之前就绪（vi.mock 会被提升到文件顶部）
const H = vi.hoisted(() => ({
  stub: () => ({ default: { name: 'Stub', template: '<div />' } }),
}))

vi.mock('@/components/MainLayout.vue', H.stub)
vi.mock('@/views/Login.vue', H.stub)
vi.mock('@/views/ForceChangePassword.vue', H.stub)
vi.mock('@/views/Screen.vue', H.stub)
vi.mock('@/views/Dashboard.vue', H.stub)
vi.mock('@/views/Devices.vue', H.stub)
vi.mock('@/views/Control.vue', H.stub)
vi.mock('@/views/History.vue', H.stub)
vi.mock('@/views/Alarms.vue', H.stub)
vi.mock('@/views/AlarmOutput.vue', H.stub)
vi.mock('@/views/Industry40.vue', H.stub)
vi.mock('@/views/Config.vue', H.stub)
vi.mock('@/views/Users.vue', H.stub)
vi.mock('@/views/PerformanceMonitor.vue', H.stub)

// ---- helpers -------------------------------------------------------------

function base64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

/** 造一个能被守卫解析的 JWT（只关心 exp） */
function jwt(expOffsetSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + expOffsetSeconds
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url({ exp })}.sig`
}

/** 建立一份"已登录"的本地状态 */
function seedLogin(role = 'admin', token = 'valid-token') {
  localStorage.setItem('auth_token', token)
  localStorage.setItem('scada_user', JSON.stringify({ username: 'ops', role }))
}

let router: any

async function go(path: string): Promise<string> {
  await router.push(path).catch(() => {})
  return router.currentRoute.value.path
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT'
  window.location.hash = ''
  router = (await import('@/router')).default
})

// ===========================================================================
// 未登录
// ===========================================================================
describe('未登录拦截', () => {
  it('访问业务页跳登录并带上 redirect，保证登录后能回到原页面', async () => {
    const finalPath = await go('/devices')
    expect(finalPath).toBe('/login')
    expect(router.currentRoute.value.query.redirect).toBe('/devices')
  })

  it('query 也要一起带进 redirect（否则筛选条件丢失）', async () => {
    const finalPath = await go('/history?device=d1&range=24h')
    expect(finalPath).toBe('/login')
    expect(router.currentRoute.value.query.redirect).toBe('/history?device=d1&range=24h')
  })

  it('访问 /login 自身不被重定向（否则死循环）', async () => {
    expect(await go('/login')).toBe('/login')
  })

  it('访问 /force-change-password 不被拦截（改密页必须能在未登录态打开）', async () => {
    expect(await go('/force-change-password')).toBe('/force-change-password')
  })
})

// ===========================================================================
// 强制改密
// ===========================================================================
describe('强制改密闸门', () => {
  it('must_change_password=true 时所有业务页都被改密页截获', async () => {
    seedLogin('admin')
    localStorage.setItem('scada_must_change_password', 'true')

    for (const path of ['/dashboard', '/devices', '/control', '/config']) {
      expect(await go(path), `${path} 未被强制改密拦截`).toBe('/force-change-password')
    }
  })

  it('改密页自身可正常访问（否则用户无法完成改密）', async () => {
    seedLogin('admin')
    localStorage.setItem('scada_must_change_password', 'true')
    expect(await go('/force-change-password')).toBe('/force-change-password')
  })

  it('标志为其它值（如 false）时不触发强制改密', async () => {
    seedLogin('admin')
    localStorage.setItem('scada_must_change_password', 'false')
    expect(await go('/dashboard')).toBe('/dashboard')
  })
})

// ===========================================================================
// 角色权限
// ===========================================================================
describe('角色权限', () => {
  it('角色匹配时放行', async () => {
    seedLogin('engineer')
    expect(await go('/devices')).toBe('/devices')
  })

  it('角色不匹配时退回仪表盘，绝不放行未授权页面', async () => {
    seedLogin('viewer')
    const finalPath = await go('/users') // 仅 admin 可访问
    expect(finalPath).toBe('/dashboard')
    expect(router.currentRoute.value.path).not.toBe('/users')
  })

  it('viewer 访问 /config 同样被挡回仪表盘', async () => {
    seedLogin('viewer')
    expect(await go('/config')).toBe('/dashboard')
  })

  it('仪表盘自身角色非法时回登录页并清理 user 缓存，且不产生自跳循环', async () => {
    // 回归点：原先角色不匹配一律 next('/dashboard')，但 /dashboard 自己也带 roles，
    // 无权限时就会"仪表盘 → 仪表盘"无限重定向，vue-router 直接抛错、页面白屏。
    seedLogin('ghost')
    const finalPath = await go('/dashboard')

    expect(finalPath).toBe('/login')
    expect(localStorage.getItem('scada_user')).toBeNull()
    // token 保留：角色信息可能是脏数据，不该顺手把会话也废掉
    expect(localStorage.getItem('auth_token')).toBe('valid-token')
  })

  it('scada_user 存在但缺少 role 字段时视为无权限 → 回登录页', async () => {
    localStorage.setItem('auth_token', 'valid-token')
    localStorage.setItem('scada_user', JSON.stringify({ username: 'ops' }))
    expect(await go('/devices')).toBe('/login')
  })

  it('scada_user JSON 损坏时清缓存并回登录页，保留 token', async () => {
    localStorage.setItem('auth_token', 'valid-token')
    localStorage.setItem('scada_user', '{ 这不是合法 JSON')

    expect(await go('/devices')).toBe('/login')
    expect(localStorage.getItem('scada_user')).toBeNull()
    expect(localStorage.getItem('auth_token')).toBe('valid-token')
  })
})

// ===========================================================================
// 404 兜底
// ===========================================================================
describe('未知路径兜底', () => {
  it('已登录时未知路径不会渲染空白页，落到仪表盘', async () => {
    seedLogin('admin')
    expect(await go('/definitely-not-a-route')).toBe('/dashboard')
  })

  it('未登录时未知路径最终落到登录页并带 redirect', async () => {
    expect(await go('/definitely-not-a-route')).toBe('/login')
    expect(router.currentRoute.value.query.redirect).toBe('/dashboard')
  })
})

// ===========================================================================
// token 过期处理
// ===========================================================================
describe('token 过期处理', () => {
  it('token 已过期且没有 refresh_token → 清理全部残留凭证并跳登录', async () => {
    localStorage.setItem('auth_token', jwt(-3600)) // 1 小时前过期
    localStorage.setItem('scada_user', JSON.stringify({ username: 'ops', role: 'admin' }))
    localStorage.setItem('scada_must_change_password', 'true')
    // 刻意不放 scada_refresh_token

    expect(await go('/dashboard')).toBe('/login')

    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(localStorage.getItem('scada_user')).toBeNull()
    expect(localStorage.getItem('scada_must_change_password')).toBeNull()
  })

  it('token 过期但存在 refresh_token → 保留会话，交给拦截器静默续期', async () => {
    // 回归点：若在这里就把凭证清掉，PWA 长时间挂着后再操作会被强制登出，
    // 而其实 refresh_token 还能换回新 token。
    localStorage.setItem('auth_token', jwt(-3600))
    localStorage.setItem('scada_refresh_token', 'refresh-1')
    localStorage.setItem('scada_user', JSON.stringify({ username: 'ops', role: 'admin' }))

    expect(await go('/dashboard')).toBe('/dashboard')
    expect(localStorage.getItem('auth_token')).not.toBeNull()
    expect(localStorage.getItem('scada_refresh_token')).toBe('refresh-1')
  })

  it('token 未过期时正常放行', async () => {
    seedLogin('admin', jwt(3600))
    expect(await go('/dashboard')).toBe('/dashboard')
    expect(localStorage.getItem('auth_token')).not.toBeNull()
  })

  it('token 结构无法解析时按"未过期"处理，不误登出', async () => {
    // 解析失败 = 不是标准 JWT（老版本/后端换算法），不能当成过期把人踢走
    seedLogin('admin', 'not-a-jwt-at-all')
    expect(await go('/dashboard')).toBe('/dashboard')
    expect(localStorage.getItem('auth_token')).toBe('not-a-jwt-at-all')
  })
})
