/**
 * 共享 Socket.IO 连接 composable
 * 解决多视图各自创建连接导致的资源浪费和token泄露问题
 */
import { ref, onUnmounted } from 'vue'
import { io, Socket } from 'socket.io-client'
import { getAuthToken } from '@/api/request'

let sharedSocket: Socket | null = null
let refCount = 0

export function useSocket() {
  const socket = ref<Socket | null>(null)

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
  }

  // 自动清理
  onUnmounted(() => {
    disconnect()
  })

  return {
    socket,
    connect,
    disconnect,
  }
}
