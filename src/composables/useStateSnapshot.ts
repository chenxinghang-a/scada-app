/**
 * 组件状态快照 Composable
 * 调试用状态导出，支持快照对比和回放。
 *
 * 用法:
 *   const { snapshot, restore, compare, exportSnapshots } = useStateSnapshot('MyComponent')
 *   snapshot() // 保存当前状态
 *   const diff = compare(snapshot1, snapshot2)
 */

import { ref, reactive, onMounted, onUnmounted, watch } from 'vue'

interface StateSnapshot {
  id: string
  component: string
  timestamp: number
  state: Record<string, any>
  props?: Record<string, any>
}

interface SnapshotDiff {
  added: string[]
  removed: string[]
  changed: Array<{ key: string; old: any; new: any }>
}

const MAX_SNAPSHOTS = 50

export function useStateSnapshot(componentName: string) {
  const snapshots = ref<StateSnapshot[]>([])
  let snapshotCounter = 0

  /** 创建快照 */
  function snapshot(stateRef?: Record<string, any>, propsRef?: Record<string, any>): StateSnapshot {
    snapshotCounter++
    const snap: StateSnapshot = {
      id: `${componentName}-${snapshotCounter}-${Date.now()}`,
      component: componentName,
      timestamp: Date.now(),
      state: stateRef ? deepClone(stateRef) : {},
      props: propsRef ? deepClone(propsRef) : undefined,
    }

    snapshots.value.push(snap)
    if (snapshots.value.length > MAX_SNAPSHOTS) {
      snapshots.value.shift()
    }

    return snap
  }

  /** 恢复快照 */
  function restore(snapshotId: string): Record<string, any> | null {
    const snap = snapshots.value.find(s => s.id === snapshotId)
    return snap ? deepClone(snap.state) : null
  }

  /** 对比两个快照 */
  function compare(snap1: StateSnapshot, snap2: StateSnapshot): SnapshotDiff {
    const keys1 = new Set(Object.keys(snap1.state))
    const keys2 = new Set(Object.keys(snap2.state))

    const added = [...keys2].filter(k => !keys1.has(k))
    const removed = [...keys1].filter(k => !keys2.has(k))
    const changed: Array<{ key: string; old: any; new: any }> = []

    for (const key of keys1) {
      if (keys2.has(key)) {
        const oldVal = JSON.stringify(snap1.state[key])
        const newVal = JSON.stringify(snap2.state[key])
        if (oldVal !== newVal) {
          changed.push({
            key,
            old: snap1.state[key],
            new: snap2.state[key],
          })
        }
      }
    }

    return { added, removed, changed }
  }

  /** 导出快照为JSON */
  function exportSnapshots(): string {
    return JSON.stringify(snapshots.value, null, 2)
  }

  /** 导入快照 */
  function importSnapshots(json: string): boolean {
    try {
      const data = JSON.parse(json)
      if (Array.isArray(data)) {
        snapshots.value = data.slice(-MAX_SNAPSHOTS)
        return true
      }
      return false
    } catch {
      return false
  }

  /** 获取快照摘要 */
  function getSummary(): Array<{ id: string; timestamp: number; stateKeys: string[] }> {
    return snapshots.value.map(s => ({
      id: s.id,
      timestamp: s.timestamp,
      stateKeys: Object.keys(s.state),
    }))
  }

  /** 清除所有快照 */
  function clear() {
    snapshots.value = []
    snapshotCounter = 0
  }

  return {
    snapshots,
    snapshot,
    restore,
    compare,
    exportSnapshots,
    importSnapshots,
    getSummary,
    clear,
  }
}

/** 深拷贝 */
function deepClone(obj: any): any {
  if (obj === null || typeof obj !== 'object') return obj
  if (obj instanceof Date) return new Date(obj.getTime())
  if (obj instanceof RegExp) return new RegExp(obj)
  if (Array.isArray(obj)) return obj.map(item => deepClone(item))

  const cloned: Record<string, any> = {}
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key])
    }
  }
  return cloned
}
