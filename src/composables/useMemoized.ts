/**
 * 组件记忆化 Composable
 * 缓存昂贵的计算结果，避免重复计算。
 *
 * 用法:
 *   const { memoize, clearMemo } = useMemoized()
 *   const expensiveResult = memoize('key', () => heavyCalculation(data))
 */

import { ref, computed, watch, type Ref } from 'vue'

interface MemoEntry {
  value: any
  timestamp: number
  deps: string
}

const memoCache = new Map<string, MemoEntry>()

export function useMemoized() {
  /**
   * 记忆化计算
   * @param key 缓存键
   * @param fn 计算函数
   * @param deps 依赖值（变化时重新计算）
   * @param ttl 缓存有效期（ms，默认5分钟）
   */
  function memoize<T>(
    key: string,
    fn: () => T,
    deps?: any,
    ttl: number = 300000
  ): T {
    const depsStr = deps !== undefined ? JSON.stringify(deps) : ''
    const cached = memoCache.get(key)

    // 缓存命中
    if (cached && cached.deps === depsStr && Date.now() - cached.timestamp < ttl) {
      return cached.value
    }

    // 重新计算
    const value = fn()
    memoCache.set(key, { value, timestamp: Date.now(), deps: depsStr })
    return value
  }

  /**
   * 创建记忆化的computed
   */
  function memoComputed<T>(key: string, fn: () => T, ttl: number = 300000) {
    return computed(() => memoize(key, fn, undefined, ttl))
  }

  /**
   * 清除缓存
   */
  function clearMemo(key?: string) {
    if (key) {
      memoCache.delete(key)
    } else {
      memoCache.clear()
    }
  }

  /**
   * 缓存大小
   */
  const cacheSize = computed(() => memoCache.size)

  return {
    memoize,
    memoComputed,
    clearMemo,
    cacheSize,
  }
}

/**
 * 格式化数字记忆化（避免重复格式化）
 */
export function useMemoizedFormat() {
  const { memoize } = useMemoized()

  function formatNumber(value: number, decimals: number = 2): string {
    return memoize(
      `fmt:num:${value}:${decimals}`,
      () => value.toFixed(decimals),
      `${value}:${decimals}`
    )
  }

  function formatPercent(value: number, decimals: number = 1): string {
    return memoize(
      `fmt:pct:${value}:${decimals}`,
      () => `${value.toFixed(decimals)}%`,
      `${value}:${decimals}`
    )
  }

  function formatBytes(bytes: number): string {
    return memoize(
      `fmt:bytes:${bytes}`,
      () => {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
      },
      bytes
    )
  }

  function formatDuration(seconds: number): string {
    return memoize(
      `fmt:dur:${seconds}`,
      () => {
        if (seconds < 60) return `${seconds}秒`
        if (seconds < 3600) return `${Math.floor(seconds / 60)}分${seconds % 60}秒`
        const h = Math.floor(seconds / 3600)
        const m = Math.floor((seconds % 3600) / 60)
        return `${h}时${m}分`
      },
      seconds
    )
  }

  return {
    formatNumber,
    formatPercent,
    formatBytes,
    formatDuration,
  }
}
