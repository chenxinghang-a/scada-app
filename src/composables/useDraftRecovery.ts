/**
 * 表单草稿自动恢复 Composable
 * 页面刷新/意外关闭后自动恢复表单数据。
 *
 * 用法:
 *   const { draft, saveDraft, clearDraft, hasDraft, restoreDraft } = useDraftRecovery('device-form')
 *   // 自动监听表单变化并保存
 *   watch(formData, (val) => saveDraft(val), { deep: true })
 *   // 页面加载时检查是否有草稿
 *   if (hasDraft.value) { formData.value = restoreDraft() }
 */

import { ref, onMounted, onUnmounted, watch } from 'vue'

interface DraftOptions {
  /** 保存防抖间隔（ms） */
  debounceMs?: number
  /** 草稿过期时间（ms，默认24小时） */
  expiryMs?: number
  /** 最大保存大小（bytes） */
  maxSize?: number
  /** 排除的字段 */
  excludeFields?: string[]
}

interface DraftEntry<T> {
  data: T
  timestamp: number
  formId: string
  version: number
}

const STORAGE_PREFIX = 'scada-draft:'
const DEFAULT_EXPIRY = 24 * 60 * 60 * 1000 // 24 hours
const DEFAULT_MAX_SIZE = 512 * 1024 // 512KB

export function useDraftRecovery<T extends Record<string, any>>(
  formId: string,
  options: DraftOptions = {}
) {
  const {
    debounceMs = 1000,
    expiryMs = DEFAULT_EXPIRY,
    maxSize = DEFAULT_MAX_SIZE,
    excludeFields = [],
  } = options

  const storageKey = `${STORAGE_PREFIX}${formId}`
  const hasDraft = ref(false)
  const draftTimestamp = ref<number | null>(null)
  const isSaving = ref(false)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let version = 0

  /** 过滤排除字段 */
  function filterData(data: T): Partial<T> {
    if (excludeFields.length === 0) return data
    const filtered = { ...data }
    for (const field of excludeFields) {
      delete filtered[field]
    }
    return filtered
  }

  /** 保存草稿 */
  function saveDraft(data: T): void {
    if (debounceTimer) clearTimeout(debounceTimer)

    debounceTimer = setTimeout(() => {
      try {
        isSaving.value = true
        const filtered = filterData(data)
        const serialized = JSON.stringify(filtered)

        // 检查大小
        if (serialized.length > maxSize) {
          console.warn(`[DraftRecovery] 草稿数据过大 (${serialized.length} > ${maxSize})，跳过保存`)
          return
        }

        const entry: DraftEntry<string> = {
          data: serialized,
          timestamp: Date.now(),
          formId,
          version: ++version,
        }

        localStorage.setItem(storageKey, JSON.stringify(entry))
        hasDraft.value = true
        draftTimestamp.value = entry.timestamp
      } catch (e) {
        console.warn('[DraftRecovery] 保存草稿失败:', e)
      } finally {
        isSaving.value = false
      }
    }, debounceMs)
  }

  /** 恢复草稿 */
  function restoreDraft(): T | null {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return null

      const entry: DraftEntry<string> = JSON.parse(raw)

      // 检查过期
      if (Date.now() - entry.timestamp > expiryMs) {
        clearDraft()
        return null
      }

      return JSON.parse(entry.data)
    } catch (e) {
      console.warn('[DraftRecovery] 恢复草稿失败:', e)
      return null
    }
  }

  /** 清除草稿 */
  function clearDraft(): void {
    localStorage.removeItem(storageKey)
    hasDraft.value = false
    draftTimestamp.value = null
  }

  /** 检查草稿是否存在 */
  function checkDraft(): boolean {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return false

      const entry: DraftEntry<string> = JSON.parse(raw)

      // 检查过期
      if (Date.now() - entry.timestamp > expiryMs) {
        clearDraft()
        return false
      }

      hasDraft.value = true
      draftTimestamp.value = entry.timestamp
      return true
    } catch {
      return false
    }
  }

  /** 获取草稿年龄（秒） */
  const draftAge = computed(() => {
    if (!draftTimestamp.value) return null
    return Math.floor((Date.now() - draftTimestamp.value) / 1000)
  })

  /** 格式化草稿时间 */
  const draftTimeFormatted = computed(() => {
    if (!draftTimestamp.value) return ''
    const date = new Date(draftTimestamp.value)
    return date.toLocaleString()
  })

  /** 清除所有草稿 */
  function clearAllDrafts(): void {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(STORAGE_PREFIX))
    keys.forEach(k => localStorage.removeItem(k))
  }

  onMounted(() => {
    checkDraft()
  })

  onUnmounted(() => {
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  return {
    hasDraft,
    draftTimestamp,
    draftAge,
    draftTimeFormatted,
    isSaving,
    saveDraft,
    restoreDraft,
    clearDraft,
    checkDraft,
    clearAllDrafts,
  }
}