/**
 * 预测性数据预取 Composable
 * 基于用户行为模式预测下一步操作，提前加载数据。
 *
 * 用法:
 *   const { trackAction, predictNext, prefetchPredicted } = usePredictivePrefetch()
 *   trackAction('view_device', { device_id: 'pump_001' })
 *   const predicted = predictNext()
 */

import { ref, computed } from 'vue'

interface ActionRecord {
  action: string
  params: Record<string, any>
  timestamp: number
}

interface Prediction {
  action: string
  confidence: number
  prefetchFn: () => Promise<any>
}

const actionHistory = ref<ActionRecord[]>([])
const MAX_HISTORY = 100

// 动作模式映射：当前动作 -> 可能的下一步动作
const ACTION_PATTERNS: Record<string, string[]> = {
  'view_device': ['view_device_data', 'view_device_alarms', 'control_device'],
  'view_device_data': ['view_device_history', 'export_device_data'],
  'view_alarms': ['acknowledge_alarm', 'view_alarm_details'],
  'view_dashboard': ['view_devices', 'view_alarms', 'view_history'],
  'control_device': ['view_device_data', 'view_device_alarms'],
}

// 预取函数注册表
const prefetchRegistry = new Map<string, () => Promise<any>>()

export function usePredictivePrefetch() {
  /** 记录用户动作 */
  function trackAction(action: string, params: Record<string, any> = {}) {
    actionHistory.value.push({
      action,
      params,
      timestamp: Date.now(),
    })

    // 限制历史长度
    if (actionHistory.value.length > MAX_HISTORY) {
      actionHistory.value = actionHistory.value.slice(-MAX_HISTORY)
    }
  }

  /** 预测下一步动作 */
  function predictNext(): Prediction[] {
    if (actionHistory.value.length === 0) return []

    const lastAction = actionHistory.value[actionHistory.value.length - 1]
    const predictions: Prediction[] = []

    // 基于模式映射预测
    const possibleActions = ACTION_PATTERNS[lastAction.action] || []
    for (const action of possibleActions) {
      const confidence = calculateConfidence(action, lastAction)
      const prefetchFn = prefetchRegistry.get(action)

      if (prefetchFn) {
        predictions.push({ action, confidence, prefetchFn })
      }
    }

    // 按置信度排序
    predictions.sort((a, b) => b.confidence - a.confidence)

    return predictions.slice(0, 3)  // 最多预测3个
  }

  /** 计算预测置信度 */
  function calculateConfidence(action: string, lastAction: ActionRecord): number {
    // 统计历史中该动作序列出现的频率
    let matchCount = 0
    let totalTransitions = 0

    for (let i = 1; i < actionHistory.value.length; i++) {
      const prev = actionHistory.value[i - 1]
      const curr = actionHistory.value[i]

      if (prev.action === lastAction.action) {
        totalTransitions++
        if (curr.action === action) {
          matchCount++
        }
      }
    }

    if (totalTransitions === 0) return 0.3  // 默认置信度
    return Math.min(0.95, matchCount / totalTransitions)
  }

  /** 预取预测的数据 */
  async function prefetchPredicted(): Promise<void> {
    const predictions = predictNext()

    for (const prediction of predictions) {
      if (prediction.confidence > 0.5) {
        try {
          await prediction.prefetchFn()
        } catch {
          // 预取失败不影响正常使用
        }
      }
    }
  }

  /** 注册预取函数 */
  function registerPrefetch(action: string, fn: () => Promise<any>) {
    prefetchRegistry.set(action, fn)
  }

  /** 获取动作历史统计 */
  const actionStats = computed(() => {
    const counts: Record<string, number> = {}
    for (const record of actionHistory.value) {
      counts[record.action] = (counts[record.action] || 0) + 1
    }
    return counts
  })

  return {
    actionHistory,
    actionStats,
    trackAction,
    predictNext,
    prefetchPredicted,
    registerPrefetch,
  }
}
