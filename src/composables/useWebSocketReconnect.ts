/**
 * WebSocket重连策略增强 Composable
 * 指数退避+抖动+最大重试+连接状态管理。
 *
 * 用法:
 *   const { connect, disconnect, status, onMessage } = useWebSocketReconnect(url, {
 *     maxRetries: 10,
 *     onMessage: (data) => handleMessage(data),
 *   })
 */

import { ref, computed, onUnmounted } from 'vue'

interface ReconnectOptions {
  maxRetries?: number
  baseDelay?: number
  maxDelay?: number
  jitterFactor?: number
  heartbeatInterval?: number
  onMessage?: (data: any) => void
  onConnect?: () => void
  onDisconnect?: () => void
  onError?: (error: Event) => void
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export function useWebSocketReconnect(url: string, options: ReconnectOptions = {}) {
  const {
    maxRetries = 10,
    baseDelay = 1000,
    maxDelay = 30000,
    jitterFactor = 0.3,
    heartbeatInterval = 30000,
    onMessage,
    onConnect,
    onDisconnect,
    onError,
  } = options

  const status = ref<ConnectionStatus>('disconnected')
  const retryCount = ref(0)
  const lastError = ref<string | null>(null)
  const latency = ref(0)

  let ws: WebSocket | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let manualClose = false

  function connect() {
    if (ws?.readyState === WebSocket.OPEN) return
    manualClose = false
    status.value = 'connecting'

    try {
      ws = new WebSocket(url)

      ws.onopen = () => {
        status.value = 'connected'
        retryCount.value = 0
        lastError.value = null
        startHeartbeat()
        onConnect?.()
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'pong') {
            latency.value = Date.now() - (data.timestamp || 0)
            return
          }
          onMessage?.(data)
        } catch {
          onMessage?.(event.data)
        }
      }

      ws.onclose = (event) => {
        stopHeartbeat()
        if (!manualClose) {
          scheduleReconnect()
        }
        onDisconnect?.()
      }

      ws.onerror = (event) => {
        lastError.value = 'WebSocket error'
        onError?.(event)
      }
    } catch (err: any) {
      lastError.value = err.message
      scheduleReconnect()
    }
  }

  function disconnect() {
    manualClose = true
    stopHeartbeat()
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.close()
      ws = null
    }
    status.value = 'disconnected'
  }

  function scheduleReconnect() {
    if (manualClose || retryCount.value >= maxRetries) {
      status.value = 'disconnected'
      return
    }

    status.value = 'reconnecting'
    retryCount.value++

    // 指数退避 + 随机抖动
    const delay = Math.min(baseDelay * Math.pow(2, retryCount.value - 1), maxDelay)
    const jitter = delay * jitterFactor * (Math.random() * 2 - 1)
    const actualDelay = Math.max(0, delay + jitter)

    reconnectTimer = setTimeout(() => {
      connect()
    }, actualDelay)
  }

  function startHeartbeat() {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }))
      }
    }, heartbeatInterval)
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  function send(data: any): boolean {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(typeof data === 'string' ? data : JSON.stringify(data))
      return true
    }
    return false
  }

  const isConnected = computed(() => status.value === 'connected')
  const isReconnecting = computed(() => status.value === 'reconnecting')

  onUnmounted(() => {
    disconnect()
  })

  return {
    status,
    retryCount,
    lastError,
    latency,
    isConnected,
    isReconnecting,
    connect,
    disconnect,
    send,
  }
}
