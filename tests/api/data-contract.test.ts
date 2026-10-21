/**
 * 数据接口契约测试。
 *
 * 这里测的是「前后端字段语义是否真的对得上」，不是组件行为。
 * 起因是一个真实的、已在生产代码里躺了很久的契约缺口：
 *
 *   1. `RealtimeData.quality` 曾声明为 `string`，但后端 `realtime_data`
 *      表的该列是 INTEGER、采集层用的是 OPC UA 数值码 → 类型撒谎。
 *   2. `getLatest()` 的返回类型曾统一声明为 `Record<string, LatestValue>`，
 *      但后端在**传了 register_name 时返回单条平铺 dict** → 调用方按
 *      映射去 Object.entries() 会把 id/device_id 当"寄存器名"，静默跑错。
 *   3. 后端曾**根本没有** quality 列，`insert_data_batch` 把采集层算好的
 *      质量码整个丢掉 → 前端质量圆点 UI 永远拿不到数据。
 *
 * 这些问题的共同点是：**运行时不会报错，只会静默给出错误结果**。
 * 所以用类型级断言 + 契约形状断言把它们钉住。
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { RealtimeData, LatestValue, LatestMap, HistoryQueryParams } from '@/api/data'
import { dataApi } from '@/api/data'

describe('RealtimeData 类型契约', () => {
  it('quality 必须是 number | null，不能是 string', () => {
    // 为什么不能是 string：后端存的是 OPC UA 数值码（192/104/0/...），
    // 而消费方 Dashboard.vue 做的是 `q >= 192` 这类**数值比较**。
    // 若类型是 string，TS 不会报错，但运行时 `'BAD' >= 192` 求值为 false
    // → 静默判成 Bad，且没有任何异常可追。
    expectTypeOf<NonNullable<RealtimeData['quality']>>().toEqualTypeOf<number>()
  })

  it('quality 是可选字段（老库/部分路径可能没有）', () => {
    const row: RealtimeData = {
      device_id: 'd1',
      register_name: 'temp',
      value: 25,
      timestamp: '2026-09-19T00:00:00',
    }
    expect(row.quality).toBeUndefined()
  })

  it('quality 取值为 undefined / null / number 三种都合法', () => {
    const base = {
      device_id: 'd1',
      register_name: 'temp',
      value: 25,
      timestamp: '2026-09-19T00:00:00',
    }
    const a: RealtimeData = { ...base }
    const b: RealtimeData = { ...base, quality: null }
    const c: RealtimeData = { ...base, quality: 192 }
    expect(a.quality).toBeUndefined()
    expect(b.quality).toBeNull()
    expect(c.quality).toBe(192)
  })
})

describe('LatestValue 类型契约', () => {
  it('quality 同样是 number | null', () => {
    expectTypeOf<NonNullable<LatestValue['quality']>>().toEqualTypeOf<number>()
  })

  it('LatestMap 是寄存器名到值对象的映射', () => {
    const m: LatestMap = {
      temp: { value: 25, unit: 'C', timestamp: '2026-09-19T00:00:00', quality: 192 },
      press: { value: 1.2, unit: 'MPa', timestamp: '2026-09-19T00:00:00', quality: 0 },
    }
    expect(Object.keys(m)).toEqual(['temp', 'press'])
    // 关键：BAD=0 必须能原样表达，不能被 falsy 兜底吃掉
    expect(m.press.quality).toBe(0)
  })
})

describe('getLatest 返回形态契约', () => {
  /**
   * 后端 `/api/data/latest/<id>` 有两种形态，必须提供**两个精确方法**，
   * 而不是一个"看起来统一"的联合类型 —— 联合类型在调用点不做收窄的话，
   * 等于没写类型。
   *
   * ⚠️ 这里**只做类型级断言**，不调用方法：
   *    真调会走 axios 发真实 HTTP 请求（vi.mock 只挡了 echarts），
   *    在本机没有后端的情况下挂到 5s 超时才失败 —— 那测的是"网络通不通"，
   *    不是"类型对不对"。类型断言在编译期就完成了，不需要运行时调用。
   */
  it('不传 registerName 时用 getLatestLatestMap → 映射形态', () => {
    expectTypeOf(dataApi.getLatestLatestMap).returns.toEqualTypeOf<
      Promise<{ data: LatestMap }>
    >()
  })

  it('传 registerName 时用 getLatestSingle → 单条形态', () => {
    expectTypeOf(dataApi.getLatestSingle).returns.toEqualTypeOf<
      Promise<{ data: LatestValue }>
    >()
  })

  it('兼容入口 getLatest 返回联合类型（新代码应优先用上面两个）', () => {
    expectTypeOf(dataApi.getLatest).returns.toEqualTypeOf<
      Promise<{ data: LatestMap | LatestValue }>
    >()
  })

  it('映射形态与单条形态在类型上不可互换（防退化成 any/Record）', () => {
    // 若哪天有人把 getLatestSingle 的返回改成 LatestMap，
    // 这个断言会失败 —— 提醒那段改动会破坏"单条"语义。
    expectTypeOf<LatestValue>().not.toEqualTypeOf<LatestMap>()
  })
})

describe('dataApi 接口面完整性', () => {
  it('应有的方法都在（防止重构时误删）', () => {
    for (const name of [
      'getRealtime',
      'getLatest',
      'getLatestLatestMap',
      'getLatestSingle',
      'getHistory',
      'exportDevice',
    ]) {
      expect(typeof (dataApi as any)[name], `dataApi.${name} 缺失`).toBe('function')
    }
  })
})

describe('历史查询参数名契约（round 226）', () => {
  it('参数名必须是 start_time / end_time', () => {
    // 后端 `展示层/api/api_data.py` 读的是 `request.args.get('start_time')`。
    // 前端曾经传 `start` / `end` → 后端读不到 → **静默回落到「最近 1 小时」**，
    // 用户在历史页选的时间范围被整体丢弃，界面上没有任何提示。
    const p: HistoryQueryParams = {
      start_time: '2026-10-21T07:00:00.000Z',
      end_time: '2026-10-21T08:00:00.000Z',
      interval: '1min',
    }
    expectTypeOf(p).toHaveProperty('start_time')
    expectTypeOf(p).toHaveProperty('end_time')
  })

  it('`start` / `end` 必须编译不过（否则又会被静默丢弃）', () => {
    // @ts-expect-error 后端不认 start，传了不会报错，只会查错时间段
    const bad: HistoryQueryParams = { start: '2026-10-21T07:00:00.000Z' }
    expect(bad).toBeTruthy()
  })

  it("interval 允许空串（前端「原始」= 不聚合）", () => {
    const p: HistoryQueryParams = { interval: '' }
    expect(p.interval).toBe('')
  })

  it("interval 只接受已知粒度，拼错必须编译不过", () => {
    // @ts-expect-error '1miin' 不是合法粒度
    const bad: HistoryQueryParams = { interval: '1miin' }
    expect(bad).toBeTruthy()
  })

  it('视图里真正传的是 start_time / end_time（源码级，会真跑）', () => {
    // ⚠️ 上面几条 `expectTypeOf` / `@ts-expect-error` 只有**类型检查**才生效，
    //    而 `tsconfig.app.json` 的 include 只到 `src/**`，**测试文件不参与
    //    vue-tsc**（vitest 走 esbuild，只剥类型不检查）。所以这里补源码断言。
    //
    //    断言必须是**精确的赋值形式**，不能只查「文件里有没有 start_time」——
    //    第一版就是 `toContain('start_time')`，而 `History.vue` 的导出功能本来
    //    就用 `params.start_time`，于是把查询改回 `params.start` 也照样绿
    //    （变异验证当场抓到）。
    const root = path.resolve(__dirname, '../..')

    const history = fs.readFileSync(path.join(root, 'src/views/History.vue'), 'utf-8')
    expect(history, 'History.vue 的查询参数被改回 params.start 了（后端只认 start_time）')
      .not.toMatch(/params\.start\s*=/)
    expect(history, 'History.vue 的查询参数被改回 params.end 了')
      .not.toMatch(/params\.end\s*=/)
    expect(history, 'History.vue 不再设置 params.start_time').toMatch(/params\.start_time\s*=/)
    expect(history, 'History.vue 不再设置 params.end_time').toMatch(/params\.end_time\s*=/)

    const trend = fs.readFileSync(path.join(root, 'src/components/TrendComparison.vue'), 'utf-8')
    expect(trend, 'TrendComparison.vue 的参数名被改回 start:/end:')
      .not.toMatch(/^\s*start\s*:/m)
    expect(trend, 'TrendComparison.vue 不再传 start_time').toMatch(/start_time\s*:/)
    expect(trend, 'TrendComparison.vue 不再传 end_time').toMatch(/end_time\s*:/)
  })
})
