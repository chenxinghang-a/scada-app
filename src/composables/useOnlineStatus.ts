/**
 * 网络状态检测 Composable
 * 监听浏览器在线/离线状态，自动通知用户。
 *
 * 用法:
 *   const { isOnline, wasOffline } = useOnlineStatus()
 */

import { ref, onMounted, onUnmounted } from 'vue'
import { ElMessage } from 'element-plus'

const isOnline = ref(navigator.onLine)
const wasOffline = ref(false)
let initialized = false

function handleOnline() {
  if (!isOnline.value) {
    isOnline.value = true
    if (wasOffline.value) {
      ElMessage.success('网络已恢复连接')
    }
  }
}

function handleOffline() {
  isOnline.value = false
  wasOffline.value = true
  ElMessage.warning({
    message: '网络连接已断开，部分功能可能不可用',
    duration: 0, // 不自动关闭
    showClose: true,
  })
}

export function useOnlineStatus() {
  onMounted(() => {
    if (!initialized) {
      initialized = true
      window.addEventListener('online', handleOnline)
      window.addEventListener('offline', handleOffline)
    }
  })

  onUnmounted(() => {
    // 不移除全局监听，因为多个组件可能共用
    // 实际场景中这个 composable 应该是全局单例
  })

  return {
    /** 当前是否在线 */
    isOnline,
    /** 是否曾经离线过（用于恢复后重新加载数据） */
    wasOffline,
  }
}
