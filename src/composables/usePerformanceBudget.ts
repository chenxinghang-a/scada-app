/**
 * 组件性能预算 Composable
 * 设定渲染性能阈值，超限时自动告警。
 *
 * 用法:
 *   const { checkBudget, getBudgetStatus } = usePerformanceBudget()
 *   checkBudget('MyComponent', renderTime)
 */

import { ref, computed } from 'vue'

interface BudgetConfig {
  /** 最大渲染时间（ms） */
  maxRenderTime: number
  /** 最大DOM节点数 */
  maxDomNodes?: number
  /** 最大内存使用（MB） */
  maxMemoryMB?: number
}

interface BudgetViolation {
  component: string
  metric: string
  actual: number
  budget: number
  timestamp: number
}

const DEFAULT_BUDGETS: Record<string, BudgetConfig> = {
  Dashboard: { maxRenderTime: 100, maxDomNodes: 500 },
  Alarms: { maxRenderTime: 150, maxDomNodes: 1000 },
  History: { maxRenderTime: 200, maxDomNodes: 2000 },
  Control: { maxRenderTime: 100, maxDomNodes: 500 },
  Devices: { maxRenderTime: 100, maxDomNodes: 500 },
  default: { maxRenderTime: 50, maxDomNodes: 500 },
}

const violations = ref<BudgetViolation[]>([])
const MAX_VIOLATIONS = 100

export function usePerformanceBudget() {
  /** 检查渲染时间是否超预算 */
  function checkRenderTime(component: string, renderTimeMs: number): boolean {
    const budget = DEFAULT_BUDGETS[component] || DEFAULT_BUDGETS.default
    const exceeded = renderTimeMs > budget.maxRenderTime

    if (exceeded) {
      addViolation(component, 'renderTime', renderTimeMs, budget.maxRenderTime)
    }

    return !exceeded
  }

  /** 检查DOM节点数是否超预算 */
  function checkDomNodes(component: string, nodeCount: number): boolean {
    const budget = DEFAULT_BUDGETS[component] || DEFAULT_BUDGETS.default
    if (!budget.maxDomNodes) return true

    const exceeded = nodeCount > budget.maxDomNodes
    if (exceeded) {
      addViolation(component, 'domNodes', nodeCount, budget.maxDomNodes)
    }

    return !exceeded
  }

  /** 检查内存使用是否超预算 */
  function checkMemory(component: string, memoryMB: number): boolean {
    const budget = DEFAULT_BUDGETS[component] || DEFAULT_BUDGETS.default
    if (!budget.maxMemoryMB) return true

    const exceeded = memoryMB > budget.maxMemoryMB
    if (exceeded) {
      addViolation(component, 'memory', memoryMB, budget.maxMemoryMB)
    }

    return !exceeded
  }

  /** 添加违规记录 */
  function addViolation(component: string, metric: string, actual: number, budget: number) {
    violations.value.push({
      component,
      metric,
      actual,
      budget,
      timestamp: Date.now(),
    })

    // 限制记录数量
    if (violations.value.length > MAX_VIOLATIONS) {
      violations.value.shift()
    }

    console.warn(
      `[PerformanceBudget] ${component} 超预算: ${metric}=${actual.toFixed(1)}, 预算=${budget}`
    )
  }

  /** 获取预算违规统计 */
  const violationStats = computed(() => {
    const byComponent: Record<string, number> = {}
    for (const v of violations.value) {
      byComponent[v.component] = (byComponent[v.component] || 0) + 1
    }
    return {
      total: violations.value.length,
      byComponent,
      recent: violations.value.slice(-10),
    }
  })

  /** 清除违规记录 */
  function clearViolations() {
    violations.value = []
  }

  /** 获取组件预算配置 */
  function getBudget(component: string): BudgetConfig {
    return DEFAULT_BUDGETS[component] || DEFAULT_BUDGETS.default
  }

  return {
    violations,
    violationStats,
    checkRenderTime,
    checkDomNodes,
    checkMemory,
    getBudget,
    clearViolations,
  }
}
