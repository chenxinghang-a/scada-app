/**
 * 历史数据多寄存器查询的结果汇总（纯函数，可直接单测）。
 *
 * 为什么单独抽出来
 * ----------------
 * `History.vue` 一次查询会**并发发 N 个请求**（每个寄存器一个）。原实现只处理了
 * 两种极端：
 *   · 全部成功 → 画图；
 *   · 全部失败 → 提示「查询失败」。
 * **部分失败**没有任何提示：图里少一条曲线，用户会以为「这个参数确实没数据」，
 * 而不是「这次查询失败了」。这与本项目反复修的「静默假成功/静默缺失」同类。
 *
 * 把判定抽成纯函数，是为了让这条规则能被单测钉住 —— 组件里内联的判断没有测试
 * 覆盖（History.vue 至今没有组件测试）。
 */

export interface RegisterQueryResult<T = unknown> {
  register: string
  rows: T[]
  failed: boolean
}

export interface QueryFailureSummary {
  /** 是否**全部**寄存器都失败（此时应当整体报错，而不是画一张空图）。 */
  allFailed: boolean
  /** 失败的寄存器名（保持传入顺序）。 */
  failedRegisters: string[]
  /** 成功的寄存器名（保持传入顺序）。 */
  okRegisters: string[]
  /** 是否存在「部分失败」（有成功也有失败）。 */
  partiallyFailed: boolean
}

/**
 * 汇总一次多寄存器查询的结果。
 *
 * @param results 每个寄存器一条结果（含 failed 标记）
 * @returns 失败汇总；空数组时 `allFailed=false`（没有请求就没有失败可言）
 */
export function summarizeQueryResults<T>(results: RegisterQueryResult<T>[]): QueryFailureSummary {
  const failedRegisters: string[] = []
  const okRegisters: string[] = []

  for (const r of results) {
    if (r.failed) failedRegisters.push(r.register)
    else okRegisters.push(r.register)
  }

  const total = results.length
  return {
    allFailed: total > 0 && failedRegisters.length === total,
    failedRegisters,
    okRegisters,
    partiallyFailed: failedRegisters.length > 0 && okRegisters.length > 0,
  }
}

/** 给用户看的一句话（失败时用），例如「以下参数查询失败，图表不完整：温度、压力」。 */
export function describeQueryFailures(summary: QueryFailureSummary): string {
  if (!summary.failedRegisters.length) return ''
  if (summary.allFailed) return '历史数据查询失败，请稍后重试'
  return `以下参数查询失败，图表不完整：${summary.failedRegisters.join('、')}`
}
