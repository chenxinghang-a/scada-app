/**
 * 前端 HTTP API 层的**接线状态**守卫：
 * `src/api/*.ts` 导出的每个方法，必须「有视图/组件在调用」**或**「显式声明为不接线」。
 *
 * 为什么需要它
 * ------------
 * 这是同一套透镜的**第三次**应用：
 *   * round 192：`electronAPI` 暴露 8 个方法，渲染层只调 1 个；
 *   * round 193：后端 42 个端点前端从不调用（「只报告不失败」）；
 *   * **round 196（本轮）**：`src/api/*.ts` 导出 **131** 个方法，
 *     **50 个在 `src/` 的视图/组件里从没被调用过**。
 *
 * 失败方式同样是**静默的**：包装函数写好了、类型全对、`vue-tsc` 全绿，
 * 只是**没有任何界面用它** —— 于是那部分能力等于不存在。
 * 实测到的两个具体例子：
 *
 *   1. `dataApi.getLatestLatestMap` / `getLatestSingle` / `getLatest` ——
 *      **round 169 专门做过一次拆分重构**（把 `getLatest` 拆成两个精确方法，
 *      理由是「后端传 register_name 时返回单条平铺 dict，原类型统一声明成映射是撒谎」），
 *      配了 17 + 10 条测试 —— 而这三个方法**至今无人调用**。
 *      （Dashboard 走的是 `dataApi.getRealtime()`。）
 *   2. `controlApi` 的 14 个方法（联锁旁路审批 / 设备微调 / 端点写入 /
 *      设备健康 / 控制审计 / 配方管理）—— 整个高级控制面**没有界面**。
 *
 * 口径
 * ----
 * * 「被调用」= 在 `src/` 里（**排除 `src/api/` 自身**）出现 `.<方法名>(`；
 *   整行注释会先剥掉，避免「注释里提过」被当成调用。
 * * 未接线的方法按 **API 对象分组**声明，每组写清理由；
 * * **双向断言**：新出现的未接线方法 → 红；已声明但**已被接线** → 红
 *   （否则表会腐烂成过期清单）；声明里的 API 对象已不存在 → 也红。
 *
 * ⚠️ 本守卫只回答「有没有人调用」，**不回答「该不该保留」**。
 * 删方法 / 补界面属产品口径 —— 见报告与决策简报。
 */

import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const REPO = process.cwd()
const API_DIR = path.join(REPO, 'src', 'api')
const SRC_DIR = path.join(REPO, 'src')

const read = (p: string) => fs.readFileSync(p, 'utf8')

/** 剥掉注释（「不得出现」类断言必须先过这一步 —— 见 round 191 M4 / 192 的教训）。 */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** 取 `export const xxxApi = { … }` 的顶层方法名。 */
function apiMethods(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const name of fs.readdirSync(API_DIR)) {
    if (!name.endsWith('.ts')) continue
    const text = read(path.join(API_DIR, name))
    for (const m of text.matchAll(/export const (\w+Api)\s*=\s*\{/g)) {
      const apiName = m[1]
      const start = text.indexOf('{', m.index + m[0].length - 1)
      let depth = 0
      let body = ''
      for (let i = start; i < text.length; i++) {
        if (text[i] === '{') depth++
        else if (text[i] === '}') {
          depth--
          if (depth === 0) { body = text.slice(start + 1, i); break }
        }
      }
      const methods = [...body.matchAll(/^ {2}(\w+)\s*\(/gm)].map((x) => x[1])
      out.set(apiName, methods)
    }
  }
  return out
}

/** 递归收集渲染层消费方（排除 src/api/ 自身）。 */
function consumerText(): string {
  const parts: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'api' && path.dirname(full) === SRC_DIR) continue
        walk(full)
      } else if (/\.(ts|vue)$/.test(entry.name)) {
        parts.push(stripComments(read(full)))
      }
    }
  }
  walk(SRC_DIR)
  return parts.join('\n')
}

/**
 * 已确认**当前不接线**的 API 方法，按 API 对象分组。
 *
 * 进这张表 = 「已知且已判断过」，**不是**「允许随便加」。
 */
const UNWIRED: Record<string, { reason: string; methods: string[] }> = {
  systemApi: {
    reason:
      '健康检查的**细分接口**（modules / checks / available / unavailable / 单项 check）。' +
      'UI 只用 /health/status 的汇总视图；这些细粒度接口是给运维与排障脚本用的。' +
      'HA（高可用）两个方法同理：当前部署是单机，界面没有主备切换入口。',
    methods: [
      'getHealthModules', 'getHealthModule', 'getHealthChecks', 'getHealthCheck',
      'getHealthAvailable', 'getHealthUnavailable', 'getHAStatus', 'forceHARole',
    ],
  },
  controlApi: {
    reason:
      '**高级控制面**：联锁旁路申请/审批/拒绝、待审批列表、设备微调、端点写入、' +
      '设备健康、控制审计日志、配方（recipe）启停与状态、急停状态、联锁列表。' +
      '这一整套**当前没有任何界面** —— 属「功能未接线」，需产品口径决定补界面还是删方法。',
    methods: [
      'eStopStatus', 'getInterlocks', 'requestBypass', 'approveBypass', 'rejectBypass',
      'getPendingBypasses', 'adjustDevice', 'writeEndpoint', 'getDeviceHealth',
      'getAuditLog', 'getRecipes', 'startRecipe', 'stopRecipe', 'getRecipeStatus',
    ],
  },
  devicesApi: {
    reason:
      '设备管理的**细粒度操作**：单设备连接、协议清单、模板、按 id 取预设、批量加预设、' +
      '故障注入、强制状态、行为查询。界面上有 Devices 页，但这些操作没有入口。' +
      '（注：`addPreset` / `addAllPresets` 原先也在这张表里 —— 因为 Devices.vue ' +
      '绕过包装层直接 `api.post` 重复实现了一遍；round 196 已改为走包装层，故从表中移除。）',
    methods: [
      'connect', 'getProtocols', 'getTemplates', 'getPresetById',
      'batchAddPresets', 'injectFault', 'forceState', 'getBehavior',
    ],
  },
  industry40Api: {
    reason:
      '工业4.0 的**单设备/配置类**接口：单设备健康分、单设备趋势、单设备 OEE、' +
      '能耗异常配置读写、单设备振动。界面用的是**汇总**接口（overview / devices 批量）。',
    methods: [
      'getHealthScore', 'getTrend', 'getOEEDevice',
      'getEnergyAnomalyConfig', 'setEnergyAnomalyConfig', 'getVibration',
    ],
  },
  alarmsApi: {
    reason:
      '报警的**细分/配置类**接口：活动报警原始列表、洪水（flood）状态、' +
      '去重配置读写、通知设置更新。界面走汇总统计 + 报警列表接口，这些没有入口。',
    methods: [
      'getActive', 'getFloodStatus', 'getDedupConfig', 'setDedupConfig', 'updateNotification',
    ],
  },
  dataApi: {
    reason:
      '① `getLatest` / `getLatestSingle` / `getLatestLatestMap` —— ' +
      '**round 169 专门做过拆分重构**（把 getLatest 拆成两个精确方法，' +
      '理由是「后端传 register_name 时返回单条平铺 dict，原类型统一声明成映射是撒谎」），' +
      '配了 17 + 10 条测试 —— **而这三个方法至今无人调用**（Dashboard 走 getRealtime）。' +
      '② Excel / PDF 导出变体：界面只用了 CSV 导出（`exportDevice` / `exportAlarms`）。',
    methods: [
      'getLatest', 'getLatestSingle', 'getLatestLatestMap',
      'exportDeviceExcel', 'exportDevicePDF', 'exportAlarmsExcel',
    ],
  },
  authApi: {
    reason:
      '`refreshToken` 包装方法无人调用 —— 但**刷新逻辑本身是活的**：' +
      '`src/api/request.ts` 的响应拦截器在 401 时**自己**发 `/auth/refresh`。' +
      '也就是说同一件事有两份实现，其中一份没人用（与 round 191/192 的' +
      '「两份真源」同构）。',
    methods: ['refreshToken'],
  },
}

const methods = apiMethods()
const consumers = consumerText()

const isWired = (method: string) =>
  new RegExp(`\\.${method}\\s*\\(`).test(consumers)

const declaredUnwired = new Set(
  Object.values(UNWIRED).flatMap((g) => g.methods),
)

describe('前端 HTTP API 接线状态（src/api 导出面 ⇄ 视图/组件调用）', () => {
  it('抠出来的 API 方法面非空（否则守卫本身失效，会变成空断言假绿）', () => {
    const total = [...methods.values()].reduce((a, b) => a + b.length, 0)
    expect(total).toBeGreaterThan(50)
    expect(methods.size).toBeGreaterThan(3)
  })

  it('抠出来的消费方文本非空（否则「没人调用」是因为没扫到文件）', () => {
    expect(consumers.length).toBeGreaterThan(10000)
  })

  it('每个导出的 API 方法：要么有人调用，要么在 UNWIRED 表里声明', () => {
    const problems: string[] = []
    for (const [api, list] of methods) {
      for (const m of list) {
        if (!isWired(m) && !declaredUnwired.has(m)) {
          problems.push(`  ${api}.${m} —— 视图/组件里无人调用，且未在 UNWIRED 表中声明`)
        }
      }
    }
    expect(
      problems,
      'src/api 里导出了但没人调用的方法必须显式声明（接线状态：未接线）——\n' +
        '这类「包装写好了、界面没用上」的缺陷不会报错，只会让能力静默不存在。\n' +
        problems.join('\n'),
    ).toEqual([])
  })

  it('UNWIRED 表里的每一条都必须真的仍未接线（否则表会过期腐烂）', () => {
    const stale: string[] = []
    for (const [api, group] of Object.entries(UNWIRED)) {
      for (const m of group.methods) {
        if (isWired(m)) {
          stale.push(`  ${api}.${m} —— 已经被接线了，请从 UNWIRED 表里删掉`)
        }
      }
    }
    expect(stale, 'UNWIRED 表已过期：\n' + stale.join('\n')).toEqual([])
  })

  it('UNWIRED 表里不许有不存在的 API 对象或方法（防改错名留下僵尸条目）', () => {
    const ghosts: string[] = []
    for (const [api, group] of Object.entries(UNWIRED)) {
      if (!methods.has(api)) {
        ghosts.push(`  API 对象 ${api} 已不存在`)
        continue
      }
      for (const m of group.methods) {
        if (!methods.get(api)!.includes(m)) {
          ghosts.push(`  ${api}.${m} 已不存在`)
        }
      }
    }
    expect(ghosts, `UNWIRED 表里有已不存在的条目：\n${ghosts.join('\n')}`).toEqual([])
  })

  it('每组未接线声明都必须写明理由', () => {
    const thin = Object.entries(UNWIRED)
      .filter(([, g]) => !g.reason || g.reason.trim().length < 30)
      .map(([api]) => api)
    expect(thin, `以下分组没写清理由：${thin.join(', ')}`).toEqual([])
  })

  it('正向对照：已知被接线的 getRealtime 必须被扫到', () => {
    // 这条红了说明扫描口径坏了，而不是「它没被调用」
    expect(isWired('getRealtime')).toBe(true)
  })

  it('视图/组件不得绕过 src/api 包装层直接调 axios 实例', () => {
    // 为什么单列一条：**绕过包装层正是包装方法变成死代码的成因**。
    // 实测（round 196）：`devicesApi.addPreset` / `addAllPresets` 之所以
    // 从来没人调用，就是因为 Devices.vue 直接 `api.post('/devices/presets/add', …)`
    // 又实现了一遍 —— 同一件事两份实现，其中一份没人用。
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(full); continue }
        if (!/\.(ts|vue)$/.test(entry.name)) continue
        // 先剥注释 —— 解释性注释里会引用 `api.post(...)` 这个写法本身
        stripComments(read(full)).split(/\r?\n/).forEach((line, i) => {
          if (/\bapi\s*\.\s*(get|post|put|delete|patch)\s*\(/.test(line)) {
            offenders.push(`${path.relative(REPO, full).replace(/\\/g, '/')}:${i + 1}`)
          }
        })
      }
    }
    walk(path.join(SRC_DIR, 'views'))
    walk(path.join(SRC_DIR, 'components'))

    expect(
      offenders,
      '这些视图/组件绕过了 src/api 包装层，直接调 axios 实例 —— ' +
        '同一件事两份实现，包装层那份会变成死代码：\n' + offenders.join('\n'),
    ).toEqual([])
  })
})
