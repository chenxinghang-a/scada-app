/**
 * 智能数据刷新 Composable
 * Tab不可见时暂停刷新，恢复时立即刷新一次。
 * 避免后台无意义的API请求，节省服务器资源。
 *
 * 用法:
 *   const { start, stop, isActive } = useSmartRefresh(() => fetchData(), 5000)
 */

import { ref, onMounted, onUnmounted, watch } from 'vue'

export function useSmartRefresh(
  callback: () => void | Promise<void>,
  interval: number = 5000,
  options: {
    /** 是否在Tab不可见时暂停 */
    pauseWhenHidden?: boolean
    /** 恢复可见时是否立即刷新 */
    refreshOnResume?: boolean
    /** 是否在组件挂载时自动启动 */
    autoStart?: boolean
  } = {}
) {
  const {
    pauseWhenHidden = true,
    refreshOnResume = true,
    autoStart = true,
  } = options

  const isActive = ref(false)
  const isPaused = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  function doRefresh() {
    try {
      const result = callback()
      if (result instanceof Promise) {
        result.catch(e => console.warn('[SmartRefresh] 刷新失败:', e))
      }
    } catch (e) {
      console.warn('[SmartRefresh] 刷新失败:', e)
    }
  }

  function start() {
    if (timer) return
    isActive.value = true
    isPaused.value = false
    timer = setInterval(() => {
      if (!isPaused.value) {
        doRefresh()
      }
    }, interval)
  }

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    isActive.value = false
    isPaused.value = false
  }

  function pause() {
    isPaused.value = true
  }

  function resume() {
    if (isPaused.value) {
      isPaused.value = false
      if (refreshOnResume) {
        doRefresh()
      }
    }
  }

  // 监听页面可见性变化
  function handleVisibilityChange() {
    if (!pauseWhenHidden) return
    if (document.hidden) {
      pause()
    } else {
      resume()
    }
  }

  onMounted(() => {
    if (pauseWhenHidden) {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }
    if (autoStart) {
      start()
    }
  })

  onUnmounted(() => {
    stop()
    if (pauseWhenHidden) {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  })

  return {
    /** 是否正在运行 */
    isActive,
    /** 是否暂停（Tab不可见） */
    isPaused,
    /** 启动刷新 */
    start,
    /** 停止刷新 */
    stop,
    /** 暂停刷新 */
    pause,
    /** 恢复刷新 */
    resume,
    /** 手动触发一次刷新 */
    refresh: doRefresh,
  }
}
