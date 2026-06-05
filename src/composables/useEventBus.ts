/**
 * 事件总线 Composable
 * 组件间通信，支持类型安全的事件订阅。
 *
 * 用法:
 *   const { on, off, emit, once } = useEventBus()
 *   on('device-update', (data) => { ... })
 *   emit('device-update', { id: 'pump_001' })
 */

import { onUnmounted, type Ref } from 'vue'

type EventHandler<T = any> = (data: T) => void
type EventMap = Record<string, EventHandler[]>

// 全局事件存储
const events: EventMap = {}
const onceEvents: EventMap = {}

export function useEventBus() {
  const listeners: Array<{ event: string; handler: EventHandler }> = []

  /** 订阅事件 */
  function on<T = any>(event: string, handler: EventHandler<T>): void {
    if (!events[event]) {
      events[event] = []
    }
    events[event].push(handler)
    listeners.push({ event, handler })
  }

  /** 取消订阅 */
  function off<T = any>(event: string, handler?: EventHandler<T>): void {
    if (!events[event]) return

    if (handler) {
      events[event] = events[event].filter(h => h !== handler)
    } else {
      delete events[event]
    }
  }

  /** 一次性订阅 */
  function once<T = any>(event: string, handler: EventHandler<T>): void {
    if (!onceEvents[event]) {
      onceEvents[event] = []
    }
    onceEvents[event].push(handler)
    listeners.push({ event, handler })
  }

  /** 发射事件 */
  function emit<T = any>(event: string, data?: T): void {
    // 触发普通监听器
    const handlers = events[event] || []
    handlers.forEach(handler => {
      try {
        handler(data)
      } catch (e) {
        console.error(`[EventBus] 事件处理器错误 (${event}):`, e)
      }
    })

    // 触发一次性监听器
    const onceHandlers = onceEvents[event] || []
    if (onceHandlers.length > 0) {
      onceHandlers.forEach(handler => {
        try {
          handler(data)
        } catch (e) {
          console.error(`[EventBus] 一次性事件处理器错误 (${event}):`, e)
        }
      })
      delete onceEvents[event]
    }
  }

  /** 清理所有订阅 */
  function clear(): void {
    listeners.forEach(({ event, handler }) => {
      off(event, handler)
    })
    listeners.length = 0
  }

  /** 获取事件监听器数量 */
  function listenerCount(event: string): number {
    return (events[event] || []).length + (onceEvents[event] || []).length
  }

  /** 获取所有事件名 */
  function eventNames(): string[] {
    return [...new Set([...Object.keys(events), ...Object.keys(onceEvents)])]
  }

  // 组件卸载时自动清理
  onUnmounted(() => {
    clear()
  })

  return {
    on,
    off,
    once,
    emit,
    clear,
    listenerCount,
    eventNames,
  }
}

/** 全局事件总线（不随组件销毁） */
export const globalEventBus = {
  on: <T = any>(event: string, handler: EventHandler<T>) => {
    if (!events[event]) events[event] = []
    events[event].push(handler)
  },
  off: <T = any>(event: string, handler?: EventHandler<T>) => {
    if (!events[event]) return
    if (handler) {
      events[event] = events[event].filter(h => h !== handler)
    } else {
      delete events[event]
    }
  },
  emit: <T = any>(event: string, data?: T) => {
    (events[event] || []).forEach(handler => {
      try { handler(data) } catch (e) { console.error(e) }
    })
    (onceEvents[event] || []).forEach(handler => {
      try { handler(data) } catch (e) { console.error(e) }
    })
    delete onceEvents[event]
  },
  once: <T = any>(event: string, handler: EventHandler<T>) => {
    if (!onceEvents[event]) onceEvents[event] = []
    onceEvents[event].push(handler)
  },
}
