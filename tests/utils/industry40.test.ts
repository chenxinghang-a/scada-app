import { describe, it, expect } from 'vitest'
import {
  HEALTH_BANDS,
  OEE_BANDS,
  CAP_BANDS,
  CAP_KEYS,
  OEE_TARGET,
  ZONE_A,
  ZONE_B,
  ZONE_C,
  ZONE_D,
  ZONE_TOKEN,
  bandIndexOf,
  bandLabelOf,
  isBandOn,
  bandTokenOf,
  bandVarOf,
  healthVar,
  oeeVar,
  capVar,
  zoneVar,
  bandTagClass,
  oeeTagClass,
  capTagClass,
  levelBarClass,
  edgeLevelBarClass,
  edgeLevelTagClass,
  isoGradeType,
  asStr,
  asNum,
  trendArrow,
  fmtTime,
  toList,
} from '@/utils/industry40'

/**
 * `src/utils/industry40.ts` 的行为契约。
 *
 * 这些断言测的是 **Industry40.vue 真正调用的那份实现**（组件已改为从本模块 import），
 * 而不是手抄副本 —— 后者只能证明「算法意图」，拦不住组件里的回归。
 */

// ==========================================================================
// 分档（Band）判定
// ==========================================================================

describe('bandIndexOf —— 半开区间 [min, max) 定位', () => {
  it('健康度各档命中', () => {
    expect(bandIndexOf(HEALTH_BANDS, 0)).toBe(0)
    expect(bandIndexOf(HEALTH_BANDS, 30)).toBe(1)
    expect(bandIndexOf(HEALTH_BANDS, 50)).toBe(2)
    expect(bandIndexOf(HEALTH_BANDS, 70)).toBe(3)
    expect(bandIndexOf(HEALTH_BANDS, 95)).toBe(4)
  })

  it('边界值：min 含、max 不含', () => {
    // 20 属「较差」的 min（含）而不是「差」的 max（不含）
    expect(bandIndexOf(HEALTH_BANDS, 20)).toBe(1)
    expect(bandIndexOf(HEALTH_BANDS, 19.99)).toBe(0)
    // 80 属「优秀」的 min
    expect(bandIndexOf(HEALTH_BANDS, 80)).toBe(4)
    expect(bandIndexOf(HEALTH_BANDS, 79.99)).toBe(3)
  })

  it('OEE 世界级线 85（含）', () => {
    expect(bandIndexOf(OEE_BANDS, 85)).toBe(4)
    expect(bandIndexOf(OEE_BANDS, 84.99)).toBe(3)
  })

  it('过程能力 1.0 / 1.33 边界', () => {
    expect(bandIndexOf(CAP_BANDS, 0.9)).toBe(0)
    expect(bandIndexOf(CAP_BANDS, 1.0)).toBe(1)
    expect(bandIndexOf(CAP_BANDS, 1.32)).toBe(1)
    expect(bandIndexOf(CAP_BANDS, 1.33)).toBe(2)
  })

  it('±Infinity 走"非有限数"守卫 → 第 0 档（口径如此，与区间划界的直觉相反）', () => {
    // Number.isFinite(±Infinity) === false，被守卫拦下 → 0，不会落末档
    expect(bandIndexOf(HEALTH_BANDS, -Infinity)).toBe(0)
    expect(bandIndexOf(HEALTH_BANDS, Infinity)).toBe(0)
  })

  it('NaN / 不可解析的输入 → 第 0 档（不抛错，口径如此）', () => {
    expect(bandIndexOf(HEALTH_BANDS, NaN)).toBe(0)
    expect(bandIndexOf(HEALTH_BANDS, 'abc' as unknown as number)).toBe(0)
  })

  it('数字字符串按 Number() 解析', () => {
    expect(bandIndexOf(HEALTH_BANDS, '70' as unknown as number)).toBe(3)
  })

  it('ISO 10816 分区边界：0.71 / 1.8 / 4.5 归入上一档的 min', () => {
    const zones = [ZONE_A, ZONE_B, ZONE_C, ZONE_D]
    expect(bandIndexOf(zones, 0.7)).toBe(0)
    expect(bandIndexOf(zones, 0.71)).toBe(1)
    expect(bandIndexOf(zones, 1.8)).toBe(2)
    expect(bandIndexOf(zones, 4.5)).toBe(3)
  })
})

describe('bandLabelOf / isBandOn / bandTokenOf', () => {
  it('bandLabelOf 返回档位文案', () => {
    expect(bandLabelOf(HEALTH_BANDS, 10)).toBe('差')
    expect(bandLabelOf(HEALTH_BANDS, 90)).toBe('优秀')
    expect(bandLabelOf(OEE_BANDS, 90)).toBe('世界级')
  })

  it('isBandOn 阶梯语义：档位 ≥ i 即为 true', () => {
    expect(isBandOn(HEALTH_BANDS, 10, 0)).toBe(true)
    expect(isBandOn(HEALTH_BANDS, 10, 1)).toBe(false)
    expect(isBandOn(HEALTH_BANDS, 50, 2)).toBe(true)
    expect(isBandOn(HEALTH_BANDS, 50, 3)).toBe(false)
  })

  it('bandTokenOf 返回未解析的令牌名', () => {
    expect(bandTokenOf(HEALTH_BANDS, 90)).toBe('--color-success')
    expect(bandTokenOf(HEALTH_BANDS, 10)).toBe('--color-offline')
    expect(bandTokenOf(CAP_BANDS, 2)).toBe('--color-success')
  })
})

// ==========================================================================
// CSS 变量引用
// ==========================================================================

describe('bandVarOf / healthVar / oeeVar / capVar', () => {
  it('输出 var(...) 引用格式', () => {
    expect(bandVarOf(HEALTH_BANDS, 90)).toBe('var(--color-success)')
    expect(healthVar(90)).toBe('var(--color-success)')
    expect(healthVar(10)).toBe('var(--color-offline)')
    expect(oeeVar(70)).toBe('var(--color-info)')
    expect(oeeVar(90)).toBe('var(--color-success)')
  })

  it('capVar：null / undefined → 第 0 档（danger），口径如此', () => {
    // Number(null)=0、Number(undefined)=NaN，两者都落第 0 档
    expect(capVar(null)).toBe('var(--color-danger)')
    expect(capVar(undefined)).toBe('var(--color-danger)')
  })

  it('capVar：正常值分档', () => {
    expect(capVar(0.9)).toBe('var(--color-danger)')
    expect(capVar(1.1)).toBe('var(--color-warning)')
    expect(capVar(1.5)).toBe('var(--color-success)')
  })
})

describe('zoneVar —— 振动分区字母', () => {
  it('A/B/C/D 映射各自的令牌', () => {
    expect(zoneVar('A')).toBe('var(--color-success)')
    expect(zoneVar('B')).toBe('var(--chart-7)')
    expect(zoneVar('C')).toBe('var(--color-warning)')
    expect(zoneVar('D')).toBe('var(--color-danger)')
  })

  it('未知字母 / undefined → offline 色兜底', () => {
    expect(zoneVar('X')).toBe('var(--color-offline)')
    expect(zoneVar('')).toBe('var(--color-offline)')
    expect(zoneVar()).toBe('var(--color-offline)')
  })
})

// ==========================================================================
// 标签（tag）类名
// ==========================================================================

describe('bandTagClass —— 分档 → tag 类', () => {
  it('success 与 chart-7 都映射为 tag--success（绿）', () => {
    expect(bandTagClass(HEALTH_BANDS, 90)).toBe('tag--success')
    expect(bandTagClass(HEALTH_BANDS, 70)).toBe('tag--success')
  })

  it('danger → tag--danger，warning → tag--warning', () => {
    expect(bandTagClass(HEALTH_BANDS, 30)).toBe('tag--danger')
    expect(bandTagClass(HEALTH_BANDS, 50)).toBe('tag--warning')
  })

  it('离线等其他令牌 → tag--info（蓝）', () => {
    expect(bandTagClass(HEALTH_BANDS, 10)).toBe('tag--info')
  })

  it('oeeTagClass / capTagClass 走同一口径', () => {
    expect(oeeTagClass(90)).toBe('tag--success') // 85+ 世界级 → success
    expect(oeeTagClass(80)).toBe('tag--success') // 75..85 优秀 → chart-7 → success
    expect(oeeTagClass(70)).toBe('tag--info') // 65..75 良好 → info 令牌 → 兜底蓝
    expect(oeeTagClass(60)).toBe('tag--warning')
    expect(capTagClass(1.5)).toBe('tag--success')
    expect(capTagClass(null)).toBe('tag--danger') // Number(null)=0 → CAP 第 0 档「不足」→ danger
  })
})

// ==========================================================================
// 状态等级 → 色条 / 标签
// ==========================================================================

describe('levelBarClass —— 告警等级 → 色条类', () => {
  it('critical / warning 原样，其余归 info', () => {
    expect(levelBarClass('critical')).toBe('level-bar--critical')
    expect(levelBarClass('warning')).toBe('level-bar--warning')
    expect(levelBarClass('info')).toBe('level-bar--info')
    expect(levelBarClass('')).toBe('level-bar--info')
    expect(levelBarClass('Critical')).toBe('level-bar--info') // 大小写敏感，口径如此
  })
})

describe('edgeLevelBarClass / edgeLevelTagClass —— 决策日志按 rule_type 分色', () => {
  it('interlock → critical 色系', () => {
    expect(edgeLevelBarClass('interlock')).toBe('level-bar--critical')
    expect(edgeLevelTagClass('interlock')).toBe('tag--danger')
  })

  it('其余（含 undefined）→ info 色系', () => {
    expect(edgeLevelBarClass('rule')).toBe('level-bar--info')
    expect(edgeLevelBarClass()).toBe('level-bar--info')
    expect(edgeLevelTagClass()).toBe('tag--info')
  })
})

describe('isoGradeType —— ISO 10816 等级 → tag type', () => {
  it('A/B 绿、C 黄、D 红', () => {
    expect(isoGradeType('A')).toBe('success')
    expect(isoGradeType('B')).toBe('success')
    expect(isoGradeType('C')).toBe('warning')
    expect(isoGradeType('D')).toBe('danger')
  })

  it('空 / 未知 → info', () => {
    expect(isoGradeType('')).toBe('info')
    expect(isoGradeType('E')).toBe('info')
  })
})

// ==========================================================================
// 兼容读取
// ==========================================================================

describe('asStr —— unknown → string', () => {
  it('非空字符串原样返回', () => {
    expect(asStr('abc')).toBe('abc')
  })

  it('空串取兜底值（语义等价旧写法 a || b）', () => {
    expect(asStr('')).toBe('')
    expect(asStr('', 'def')).toBe('def')
  })

  it('非字符串一律兜底（含 null / undefined / 数字 / 对象）', () => {
    expect(asStr(null)).toBe('')
    expect(asStr(undefined)).toBe('')
    expect(asStr(123 as unknown)).toBe('')
    expect(asStr({} as unknown)).toBe('')
    expect(asStr(null, 'x')).toBe('x')
  })
})

describe('asNum —— unknown → number | undefined', () => {
  it('数字原样、数字字符串解析', () => {
    expect(asNum(3.14)).toBe(3.14)
    expect(asNum('3.14')).toBe(3.14)
    expect(asNum(0)).toBe(0)
  })

  it('不可解析 / 非有限数 → undefined', () => {
    expect(asNum('abc')).toBe(undefined)
    expect(asNum(NaN)).toBe(undefined)
    expect(asNum(Infinity)).toBe(undefined)
    expect(asNum(null)).toBe(undefined)
    expect(asNum(undefined)).toBe(undefined)
    expect(asNum({} as unknown)).toBe(undefined)
  })
})

describe('trendArrow', () => {
  it('rising ↑ / falling ↓ / 其余 →', () => {
    expect(trendArrow('rising')).toBe('↑')
    expect(trendArrow('falling')).toBe('↓')
    expect(trendArrow('stable')).toBe('→')
    expect(trendArrow('')).toBe('→')
  })
})

describe('fmtTime —— 时间戳 → HH:MM:SS', () => {
  it('缺值 / 空串 → "-"', () => {
    expect(fmtTime()).toBe('-')
    expect(fmtTime('')).toBe('-')
  })

  it('不可解析 → 原样返回输入（不抛错）', () => {
    expect(fmtTime('not-a-date')).toBe('not-a-date')
  })

  it('合法 ISO 时间戳 → HH:MM:SS 形状（不断言具体钟点，避开时区依赖）', () => {
    expect(fmtTime('2026-10-07T15:30:45Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(fmtTime('2026-10-07T00:00:00Z')).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })
})

// ==========================================================================
// 列表归一化
// ==========================================================================

describe('toList —— 字典 / 数组 → 数组', () => {
  it('数组原样返回（同一引用，口径如此）', () => {
    const arr = [{ a: 1 }]
    expect(toList(arr)).toBe(arr)
  })

  it('对象字典展开为数组，键写入 device_id', () => {
    expect(toList<{ v: number }>({ d1: { v: 1 }, d2: { v: 2 } })).toEqual([
      { device_id: 'd1', v: 1 },
      { device_id: 'd2', v: 2 },
    ])
  })

  it('item 自带 device_id 时覆盖生成的键（spread 在后，口径如此）', () => {
    expect(toList({ k: { device_id: 'inner' } })).toEqual([{ device_id: 'inner' }])
  })

  it('null / undefined / 原始值 → []', () => {
    expect(toList(null)).toEqual([])
    expect(toList(undefined)).toEqual([])
    expect(toList(42)).toEqual([])
    expect(toList('abc')).toEqual([])
  })
})

// ==========================================================================
// 常量契约
// ==========================================================================

describe('常量表', () => {
  it('每个 BANDS 首档从 -Infinity 起、末档到 Infinity 止（保证全实数可落档）', () => {
    for (const bands of [HEALTH_BANDS, OEE_BANDS, CAP_BANDS, [ZONE_A, ZONE_B, ZONE_C, ZONE_D]]) {
      expect(bands[0].min).toBe(-Infinity)
      expect(bands[bands.length - 1].max).toBe(Infinity)
      // 相邻档位无缝隙、无重叠：上一档 max === 下一档 min
      for (let i = 1; i < bands.length; i++) {
        expect(bands[i].min).toBe(bands[i - 1].max)
      }
    }
  })

  it('OEE_TARGET = 85（与 OEE_BANDS 世界级线一致）', () => {
    expect(OEE_TARGET).toBe(85)
    expect(OEE_BANDS.find((b) => b.label === '世界级')?.min).toBe(OEE_TARGET)
  })

  it('CAP_KEYS 覆盖四指标且 key 唯一', () => {
    expect(CAP_KEYS.map((k) => k.key)).toEqual(['cp', 'cpk', 'pp', 'ppk'])
  })

  it('ZONE_TOKEN 四个字母齐全', () => {
    expect(Object.keys(ZONE_TOKEN).sort()).toEqual(['A', 'B', 'C', 'D'])
  })
})
