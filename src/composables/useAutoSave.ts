/**
 * 表单自动保存 Composable
 * 定期保存表单草稿，页面刷新后可恢复。
 *
 * 用法:
 *   const { startAutoSave, stopAutoSave, restoreDraft, clearDraft, hasDraft } = useAutoSave('form-id')
 *   startAutoSave(formData, 5000) // 每5秒保存一次
 *   const draft = restoreDraft() // 恢复草稿
 */

import { ref, watch, onUnmounted, type Ref } from 'vue'

interface DraftEntry {
  data: any
  timestamp: number
  formId: string
}

const DRAFT_PREFIX = 'scada-draft:'
const MAX_DRAFT_AGE = 7 * 24 * 60 * 60 * 1000 // 7天

export function useAutoSave(formId: string) {
  let autoSaveTimer: ReturnType<typeof setInterval> | null = null
  let lastSavedData: string = ''
  const isSaving = ref(false)
  const lastSaveTime = ref<number | null>(null)

  /** 保存草稿 */
  function saveDraft(data: any): boolean {
    try {
      const serialized = JSON.stringify(data)
      if (serialized === lastSavedData) return false

      const entry: DraftEntry = {
        data,
        timestamp: Date.now(),
        formId,
      }

      localStorage.setItem(DRAFT_PREFIX + formId, JSON.stringify(entry))
      lastSavedData = serialized
      lastSaveTime.value = Date.now()
      return true
    } catch (e) {
      console.warn('[AutoSave] 保存草稿失败:', e)
      return false
    }
  }

  /** 恢复草稿 */
  function restoreDraft<T = any>(): T | null {
    try {
      const stored = localStorage.getItem(DRAFT_PREFIX + formId)
      if (!stored) return null

      const entry: DraftEntry = JSON.parse(stored)

      // 检查过期
      if (Date.now() - entry.timestamp > MAX_DRAFT_AGE) {
        clearDraft()
        return null
      }

      return entry.data as T
    } catch (e) {
      console.warn('[AutoSave] 恢复草稿失败:', e)
      return null
    }
  }

  /** 清除草稿 */
  function clearDraft(): void {
    localStorage.removeItem(DRAFT_PREFIX + formId)
    lastSavedData = ''
    lastSaveTime.value = null
  }

  /** 是否有草稿 */
  function hasDraft(): boolean {
    return localStorage.getItem(DRAFT_PREFIX + formId) !== null
  }

  /** 获取草稿时间 */
  function getDraftTimestamp(): number | null {
    try {
      const stored = localStorage.getItem(DRAFT_PREFIX + formId)
      if (!stored) return null
      const entry: DraftEntry = JSON.parse(stored)
      return entry.timestamp
    } catch {
      return null
    }
  }

  /** 启动自动保存 */
  function startAutoSave(dataRef: Ref<any>, interval: number = 5000) {
    stopAutoSave()

    autoSaveTimer = setInterval(() => {
      if (dataRef.value) {
        isSaving.value = true
        saveDraft(dataRef.value)
        isSaving.value = false
      }
    }, interval)
  }

  /** 停止自动保存 */
  function stopAutoSave() {
    if (autoSaveTimer) {
      clearInterval(autoSaveTimer)
      autoSaveTimer = null
    }
  }

  /** 手动触发保存 */
  function saveNow(data: any): boolean {
    isSaving.value = true
    const result = saveDraft(data)
    isSaving.value = false
    return result
  }

  onUnmounted(() => {
    stopAutoSave()
  })

  return {
    isSaving,
    lastSaveTime,
    saveDraft,
    restoreDraft,
    clearDraft,
    hasDraft,
    getDraftTimestamp,
    startAutoSave,
    stopAutoSave,
    saveNow,
  }
}

/** 清除所有草稿 */
export function clearAllDrafts() {
  const keys = Object.keys(localStorage)
  keys.filter(k => k.startsWith(DRAFT_PREFIX)).forEach(k => localStorage.removeItem(k))
}

/** 获取所有草稿信息 */
export function getAllDrafts(): Array<{ formId: string; timestamp: number }> {
  const keys = Object.keys(localStorage)
  return keys
    .filter(k => k.startsWith(DRAFT_PREFIX))
    .map(k => {
      try {
        const entry: DraftEntry = JSON.parse(localStorage.getItem(k)!)
        return { formId: entry.formId, timestamp: entry.timestamp }
      } catch {
        return null
      }
    })
    .filter(Boolean) as Array<{ formId: string; timestamp: number }>
}
