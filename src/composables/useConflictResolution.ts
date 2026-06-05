/**
 * 数据冲突解决 Composable
 * 并发编辑时的冲突检测与合并策略。
 *
 * 用法:
 *   const { detectConflict, merge, resolve } = useConflictResolution()
 *   const conflict = detectConflict(localData, serverData, baseData)
 *   if (conflict) { resolve(conflict, 'server') }
 */

import { ref, computed } from 'vue'

interface ConflictField {
  field: string
  localValue: any
  serverValue: any
  baseValue: any
  type: 'modified' | 'deleted' | 'added'
}

interface Conflict {
  id: string
  entityType: string
  entityId: string
  fields: ConflictField[]
  localTimestamp: number
  serverTimestamp: number
}

type MergeStrategy = 'server' | 'local' | 'manual' | 'newest' | 'merge'

export function useConflictResolution() {
  const activeConflicts = ref<Conflict[]>([])
  const hasConflicts = computed(() => activeConflicts.value.length > 0)

  /** 检测冲突 */
  function detectConflict(
    local: Record<string, any>,
    server: Record<string, any>,
    base: Record<string, any>,
    entityType: string = 'unknown',
    entityId: string = ''
  ): Conflict | null {
    const fields: ConflictField[] = []
    const allKeys = new Set([...Object.keys(local), ...Object.keys(server), ...Object.keys(base)])

    for (const key of allKeys) {
      if (key === 'updated_at' || key === 'modified_at') continue

      const localVal = local[key]
      const serverVal = server[key]
      const baseVal = base[key]

      const localChanged = JSON.stringify(localVal) !== JSON.stringify(baseVal)
      const serverChanged = JSON.stringify(serverVal) !== JSON.stringify(baseVal)

      if (localChanged && serverChanged) {
        // 双方都修改了 → 冲突
        let type: 'modified' | 'deleted' | 'added' = 'modified'
        if (localVal === undefined || localVal === null) type = 'deleted'
        else if (baseVal === undefined || baseVal === null) type = 'added'

        fields.push({
          field: key,
          localValue: localVal,
          serverValue: serverVal,
          baseValue: baseVal,
          type,
        })
      }
    }

    if (fields.length === 0) return null

    const conflict: Conflict = {
      id: `${entityType}-${entityId}-${Date.now()}`,
      entityType,
      entityId,
      fields,
      localTimestamp: local.updated_at || Date.now(),
      serverTimestamp: server.updated_at || Date.now(),
    }

    activeConflicts.value.push(conflict)
    return conflict
  }

  /** 合并数据 */
  function merge(
    local: Record<string, any>,
    server: Record<string, any>,
    base: Record<string, any>,
    strategy: MergeStrategy = 'merge'
  ): Record<string, any> {
    switch (strategy) {
      case 'server':
        return { ...server }

      case 'local':
        return { ...local }

      case 'newest':
        const localTime = local.updated_at || 0
        const serverTime = server.updated_at || 0
        return localTime > serverTime ? { ...local } : { ...server }

      case 'merge':
      default:
        return autoMerge(local, server, base)
    }
  }

  /** 自动合并（非冲突字段取各自修改，冲突字段取server） */
  function autoMerge(
    local: Record<string, any>,
    server: Record<string, any>,
    base: Record<string, any>
  ): Record<string, any> {
    const result: Record<string, any> = {}
    const allKeys = new Set([...Object.keys(local), ...Object.keys(server), ...Object.keys(base)])

    for (const key of allKeys) {
      const localVal = local[key]
      const serverVal = server[key]
      const baseVal = base[key]

      const localChanged = JSON.stringify(localVal) !== JSON.stringify(baseVal)
      const serverChanged = JSON.stringify(serverVal) !== JSON.stringify(baseVal)

      if (localChanged && serverChanged) {
        // 双方都修改了 → 优先server
        result[key] = serverVal
      } else if (localChanged) {
        // 只有local修改了
        result[key] = localVal
      } else if (serverChanged) {
        // 只有server修改了
        result[key] = serverVal
      } else {
        // 都没修改
        result[key] = serverVal
      }
    }

    return result
  }

  /** 解决冲突 */
  function resolve(conflictId: string, strategy: MergeStrategy, fieldResolutions?: Record<string, any>): void {
    const index = activeConflicts.value.findIndex(c => c.id === conflictId)
    if (index === -1) return

    activeConflicts.value.splice(index, 1)
  }

  /** 解决所有冲突 */
  function resolveAll(strategy: MergeStrategy): void {
    activeConflicts.value = []
  }

  /** 获取冲突摘要 */
  function getConflictSummary(conflict: Conflict): string {
    const fieldNames = conflict.fields.map(f => f.field).join(', ')
    return `${conflict.entityType} ${conflict.entityId} 的以下字段有冲突: ${fieldNames}`
  }

  return {
    activeConflicts,
    hasConflicts,
    detectConflict,
    merge,
    resolve,
    resolveAll,
    getConflictSummary,
  }
}
