/**
 * src/api/request.ts 拦截器契约测试
 *
 * 为什么这组测试值得写：
 *   这台 SCADA 前端会向 PLC 下发**控制指令**（启停/急停/写寄存器）。
 *   拦截器里的三条逻辑一旦回归，后果不是"页面难看"，而是：
 *     1. POST 被网络重试 → **同一条控制命令重复下发**（最危险）；
 *     2. 并发 401 各自刷新 token → refresh_token 被反复消费，会话被踢；
 *     3. 刷新失败不清理会话 → 用户卡在全 401 的页面且无法自愈。
 *   这些分支在 UI 上很难覆盖到，只能靠这里钉住。
 *
 * 实现说明：request.ts 用模块级变量（isRefreshing / refreshQueue / csrf 缓存 /
 * isRedirectingToLogin）保存状态，所以每个用例都 `vi.resetModules()` 后**动态
 * import**，拿到干净的模块实例；同时 axios 也必须一起动态导入，否则测试里
 * import 到的 axios 与 request.ts 内部的是两个不同的模块实例，改默认 adapter
 * 不会生效。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createMockAdapter, deferred, flushMicrotasks } from '../helpers/mockAdapter'
import type { MockAdapter, RecordedCall } from '../helpers/mockAdapter'

// ---- 被 mock 的外部依赖（用 hoisted 保证 mock 工厂能安全引用） ----
const H = vi.hoisted(() => ({
  elError: vi.fn(),
  pushes: [] as any[],
  route: { value: { path: '/dashboard', fullPath: '/dashboard' } },
  store: { token: null as string | null, refreshToken: null as string | null, user: null as any },
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    error: H.elError,
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('@/router', () => ({
  default: {
    currentRoute: H.route,
    push: (arg: any) => {
      H.pushes.push(arg)
      return Promise.resolve()
    },
  },
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => H.store,
}))

// ---- 每个用例重建的模块引用 ----
let axios: any
let api: any
let mock: MockAdapter

/** 从记录到的调用里读 Authorization 头（AxiosHeaders 实例要用 get()） */
function authHeaderOf(call: RecordedCall): string {
  const h: any = call.config.headers
  if (!h) return ''
  if (typeof h.get === 'function') return String(h.get('Authorization') ?? '')
  return String(h.Authorization ?? h.authorization ?? '')
}

function seedSession(token = 'old-token', refresh = 'refresh-1') {
  localStorage.setItem('auth_token', token)
  if (refresh) localStorage.setItem('scada_refresh_token', refresh)
  localStorage.setItem('scada_user', JSON.stringify({ username: 'ops', role: 'engineer' }))
}

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  H.pushes.length = 0
  H.elError.mockClear()
  H.store.token = null
  H.store.refreshToken = null
  H.store.user = null
  H.route.value = { path: '/dashboard', fullPath: '/dashboard' }

  axios = (await import('axios')).default
  mock = createMockAdapter()
  axios.defaults.adapter = mock.adapter

  api = (await import('@/api/request')).default
  api.defaults.adapter = mock.adapter
})

afterEach(() => {
  vi.useRealTimers()
})

// ===========================================================================
// 响应信封解包
// ===========================================================================
describe('响应信封解包（success/data）', () => {
  it('带 success+data 的信封会被解包成内层 data', async () => {
    mock.setHandler(() => ({
      status: 200,
      data: { success: true, data: { id: 7, name: '泵1' }, message: 'ok' },
    }))
    const res = await api.get('/devices/1')
    expect(res).toEqual({ id: 7, name: '泵1' })
  })

  it('信封内层是数组时也正确解包（不能被 falsy 兜底吃掉）', async () => {
    mock.setHandler(() => ({ status: 200, data: { success: true, data: [1, 2, 3] } }))
    expect(await api.get('/alarms')).toEqual([1, 2, 3])
  })

  it('只有 data 没有 success 时不解包 —— {data:[...]} 必须原样返回', async () => {
    // 这是回归点：dataApi.getRealtime() 的调用方读的是 result.data，
    // 若被误解包成数组，调用方 `result.data.map` 直接崩。
    mock.setHandler(() => ({ status: 200, data: { data: [1, 2, 3] } }))
    expect(await api.get('/data/realtime')).toEqual({ data: [1, 2, 3] })
  })

  it('success 存在但 data 不是对象（数组/原始值）时不被信封逻辑误伤', async () => {
    mock.setHandler(() => ({ status: 200, data: [1, 2, 3] }))
    expect(await api.get('/list')).toEqual([1, 2, 3])
  })
})

// ===========================================================================
// 401 → 刷新 → 重放
// ===========================================================================
describe('401 自动刷新 token', () => {
  it('401 后刷新 token 并重放原请求，新 token 落盘', async () => {
    seedSession('old-token', 'refresh-1')
    mock.setHandler((cfg) => {
      if (cfg.url!.includes('/auth/refresh')) {
        return { status: 200, data: { token: 'new-token', refresh_token: 'refresh-2' } }
      }
      const attempt = mock.countMatching('/protected')
      return attempt <= 1
        ? { status: 401, data: { error: 'token expired' } }
        : { status: 200, data: { ok: true } }
    })

    const res = await api.get('/protected')
    expect(res).toEqual({ ok: true })

    // 原请求 + 重放 = 2 次
    expect(mock.countMatching('/protected')).toBe(2)
    // 刷新只发生 1 次
    expect(mock.countMatching('/auth/refresh')).toBe(1)
    // 新 token 已落盘，refresh_token 被轮换
    expect(localStorage.getItem('auth_token')).toBe('new-token')
    expect(localStorage.getItem('scada_refresh_token')).toBe('refresh-2')

    // 重放请求确实带上了新 token
    const replay = mock.callsMatching('/protected')[1]
    expect(authHeaderOf(replay)).toBe('Bearer new-token')
  })

  it('并发 401 只刷新一次，其余请求排队等新 token', async () => {
    seedSession('old-token', 'refresh-1')
    const refreshGate = deferred<any>()

    mock.setHandler((cfg) => {
      if (cfg.url!.includes('/auth/refresh')) {
        // 挂住刷新响应，制造"两个请求同时 401、刷新仍在飞行中"的时序
        return refreshGate.promise
      }
      const seen = mock.callsMatching(cfg.url!).length
      return seen <= 1
        ? { status: 401, data: { error: 'token expired' } }
        : { status: 200, data: { ok: true, url: cfg.url } }
    })

    const p1 = api.get('/protected/a')
    const p2 = api.get('/protected/b')

    // 等两个请求都撞上 401 并进入刷新/排队
    for (let i = 0; i < 50 && mock.countMatching('/auth/refresh') < 1; i++) {
      await flushMicrotasks(5)
    }
    await flushMicrotasks(30)

    // 关键断言：refresh_token 只被消费一次（多次刷新会把用户踢下线）
    expect(mock.countMatching('/auth/refresh')).toBe(1)

    refreshGate.resolve({ status: 200, data: { token: 'new-token' } })

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual({ ok: true, url: '/protected/a' })
    expect(r2).toEqual({ ok: true, url: '/protected/b' })
    expect(mock.countMatching('/auth/refresh')).toBe(1)
  })

  it('刷新失败 → 清理全部本地会话并跳登录（带 redirect）', async () => {
    seedSession('old-token', 'bad-refresh')
    localStorage.setItem('scada_must_change_password', 'true')
    H.route.value = { path: '/control', fullPath: '/control?tab=1' }

    mock.setHandler((cfg) => {
      if (cfg.url!.includes('/auth/refresh')) {
        return { status: 401, data: { error: 'refresh token revoked' } }
      }
      return { status: 401, data: { error: 'token expired' } }
    })

    await expect(api.get('/protected')).rejects.toBeTruthy()

    // 会话凭证必须全部清干净，否则残 token 会让用户卡在 401 循环里
    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(localStorage.getItem('scada_refresh_token')).toBeNull()
    expect(localStorage.getItem('scada_user')).toBeNull()
    expect(localStorage.getItem('scada_must_change_password')).toBeNull()
    expect(H.store.token).toBeNull()
    expect(H.store.refreshToken).toBeNull()
    expect(H.store.user).toBeNull()

    expect(H.pushes).toEqual([{ path: '/login', query: { redirect: '/control?tab=1' } }])
    expect(H.elError).toHaveBeenCalledWith('登录已过期，请重新登录')
  })

  it('刷新成功但重放仍 401 → 判定会话失效，清理并跳登录且不重复跳转', async () => {
    seedSession('old-token', 'refresh-1')
    mock.setHandler((cfg) => {
      if (cfg.url!.includes('/auth/refresh')) {
        return { status: 200, data: { token: 'new-token' } }
      }
      // 无论重放多少次都 401
      return { status: 401, data: { error: 'still unauthorized' } }
    })

    await expect(api.get('/protected')).rejects.toBeTruthy()

    expect(mock.countMatching('/protected')).toBe(2) // 原请求 + 重放，不无限循环
    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(H.pushes.length).toBe(1)
    expect(H.pushes[0].path).toBe('/login')
  })

  it('无 token 的 401（如密码错误）不触发刷新、不跳转、不弹"登录已过期"', async () => {
    // 回归点：登录接口本身就是 401，若走全局登出逻辑会污染登录页体验
    mock.setHandler(() => ({ status: 401, data: { error: '用户名或密码错误' } }))

    await expect(api.post('/auth/login', { username: 'a', password: 'b' })).rejects.toBeTruthy()

    expect(mock.countMatching('/auth/refresh')).toBe(0)
    expect(H.pushes).toEqual([])
    expect(H.elError).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// 网络错误重试（安全关键）
// ===========================================================================
describe('网络错误自动重试', () => {
  it('GET 网络错误会重试（最多 3 次，共 4 次请求）', async () => {
    vi.useFakeTimers()
    mock.setHandler(() => ({ networkError: true }))

    const p = api.get('/data/realtime').catch((e: any) => e)
    await vi.advanceTimersByTimeAsync(10000)
    const err = await p

    expect(err).toBeTruthy()
    expect(mock.countMatching('/data/realtime')).toBe(4)
  })

  it('POST 网络错误绝不重试 —— 防止控制命令重复下发', async () => {
    // ★ 本组最重要的一条：/control/* 是启停/急停/写寄存器。
    // 网络超时不代表后端没执行，重试会造成重复动作，属于安全事故级别回归。
    mock.setHandler(() => ({ networkError: true }))

    const err = await api.post('/control/start', { device_id: 'd1' }).catch((e: any) => e)

    expect(err).toBeTruthy()
    expect(mock.countMatching('/control/start')).toBe(1)
  })

  it('PUT / DELETE 同样不重试', async () => {
    mock.setHandler(() => ({ networkError: true }))

    await api.put('/devices/d1', { name: 'x' }).catch(() => {})
    await api.delete('/devices/d1').catch(() => {})

    expect(mock.countMatching('/devices/d1')).toBe(2) // 各发 1 次，无重试
  })

  it('CanceledError（组件卸载/切页主动取消）静默失败：不重试也不弹提示', async () => {
    mock.setHandler(() => ({ cancel: true }))

    await expect(api.get('/data/realtime')).rejects.toBeTruthy()

    expect(mock.countMatching('/data/realtime')).toBe(1)
    expect(H.elError).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// 错误文案提取
// ===========================================================================
describe('错误文案提取', () => {
  it('优先取后端 data.error', async () => {
    mock.setHandler(() => ({ status: 400, data: { error: '寄存器不存在' } }))
    await expect(api.get('/x')).rejects.toBeTruthy()
    expect(H.elError).toHaveBeenCalledWith('寄存器不存在')
  })

  it('data.error 缺失时回落到 data.message', async () => {
    mock.setHandler(() => ({ status: 500, data: { message: '数据库连接超时' } }))
    await expect(api.get('/x')).rejects.toBeTruthy()
    expect(H.elError).toHaveBeenCalledWith('数据库连接超时')
  })

  it('后端没有可读文案时回落到「请求失败 (状态码)」', async () => {
    mock.setHandler(() => ({ status: 400, data: {} }))
    await expect(api.get('/x')).rejects.toBeTruthy()
    expect(H.elError).toHaveBeenCalledWith('请求失败 (400)')
  })

  it('403 统一提示「权限不足」', async () => {
    mock.setHandler(() => ({ status: 403, data: { error: 'forbidden' } }))
    await expect(api.get('/users')).rejects.toBeTruthy()
    expect(H.elError).toHaveBeenCalledWith('权限不足')
  })
})

// ===========================================================================
// 请求拦截器
// ===========================================================================
describe('请求拦截器', () => {
  it('自动注入 Authorization 头', async () => {
    seedSession('tok-abc')
    mock.setHandler(() => ({ status: 200, data: {} }))
    await api.get('/devices')
    expect(authHeaderOf(mock.callsMatching('/devices')[0])).toBe('Bearer tok-abc')
  })

  it('无 token 时不注入 Authorization', async () => {
    mock.setHandler(() => ({ status: 200, data: {} }))
    await api.get('/public')
    expect(authHeaderOf(mock.callsMatching('/public')[0])).toBe('')
  })

  it('CSRF 端点不可用时请求正常发出（不因 CSRF 拉不到而卡死）', async () => {
    mock.setHandler((cfg) =>
      cfg.url!.includes('csrf-token')
        ? { status: 404, data: {} }
        : { status: 200, data: { ok: true } }
    )
    const res = await api.post('/control/stop', { device_id: 'd1' })
    expect(res).toEqual({ ok: true })
    expect(mock.countMatching('/control/stop')).toBe(1)
  })

  it('CSRF 端点可用时给写请求带上 X-CSRF-Token', async () => {
    mock.setHandler((cfg) =>
      cfg.url!.includes('csrf-token')
        ? { status: 200, data: { csrf_token: 'csrf-xyz' } }
        : { status: 200, data: {} }
    )
    await api.post('/control/stop', {})

    const h: any = mock.callsMatching('/control/stop')[0].config.headers
    const value = typeof h.get === 'function' ? h.get('X-CSRF-Token') : h['X-CSRF-Token']
    expect(value).toBe('csrf-xyz')
  })
})
