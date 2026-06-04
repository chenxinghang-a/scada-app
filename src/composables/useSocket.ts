/**
 * 共享 Socket.IO 连接 composable
 * 解决多视图各自创建连接导致的资源浪费和token泄露问题
 */
import { ref, onUnmounted } from 'vue'
import { io, Socket } from 'socket.io-client'
import { ElMessage } from 'element-plus'
import { getAuthToken } from '@/api/request'

let sharedSocket: Socket | null = null
let refCount = 0

export function useSocket() {
  const socket = ref<Socket | null>(null)
  const connected = ref(false)
  const error = ref<string | null>(null)

  function connect(): Socket {
    refCount++
    if (!sharedSocket || sharedSocket.disconnected) {
      const token = getAuthToken()
      const baseUrl = import.meta.env.DEV
        ? `${window.location.protocol}//${window.location.hostname}:${window.location.port}`
        : 'http://localhost:5000'
      sharedSocket = io(baseUrl, {
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 3000,
        reconnectionAttempts: 10,
      })

      // 连接成功
      sharedSocket.on('connect', () => {
        connected.value = true
        error.value = null
      })

      // 连接断开
      sharedSocket.on('disconnect', () => {
        connected.value = false
      })

      // 连接错误
      sharedSocket.on('connect_error', (err: Error) => {
        error.value = err.message
        console.error('[Socket.IO] 连接错误:', err.message)
        // 静默处理，不弹窗打扰用户
      })

      // 认证错误
      sharedSocket.on('error', (err: any) => {
        error.value = typeof err === 'string' ? err : err?.message || '未知错误'
        console.error('[Socket.IO] 错误:', err)
      })
    }
    socket.value = sharedSocket
    return sharedSocket
  }

  function disconnect() {
    refCount--
    if (refCount <= 0 && sharedSocket) {
      sharedSocket.disconnect()
      sharedSocket = null
      refCount = 0
    }
    socket.value = null
    connected.value = false
  }

  // 自动清理
  onUnmounted(() => {
    disconnect()
  })

  return {
    socket,
    connected,
    error,
    connect,
    disconnect,
  }
}
