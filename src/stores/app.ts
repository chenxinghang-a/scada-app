import { defineStore } from 'pinia'
import { ref } from 'vue'
import { systemApi, type SystemStatus } from '@/api'
import { logLoadError } from '@/utils/error'

export const useAppStore = defineStore('app', () => {
  const sidebarCollapsed = ref(false)
  const systemStatus = ref<SystemStatus | null>(null)
  const simulationMode = ref(false)
  const activeAlarmCount = ref(0)
  const backendOnline = ref(true)
  const backendFirstCheck = ref(false)
  const connectionRetries = ref(0)

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  async function fetchSystemStatus() {
    try {
      systemStatus.value = await systemApi.getStatus()
      simulationMode.value = systemStatus.value.simulation_mode
      activeAlarmCount.value = systemStatus.value.alarms?.total_active_alarms || 0
      backendOnline.value = true
      backendFirstCheck.value = true
      connectionRetries.value = 0
    } catch (e: any) {
      connectionRetries.value++
      backendOnline.value = false
      logLoadError('系统状态', e)
      if (connectionRetries.value > 2) {
        backendFirstCheck.value = true
      }
    }
  }

  async function fetchSimulationMode() {
    try {
      const data = await systemApi.getSimulationMode()
      simulationMode.value = data.simulation_mode
      backendOnline.value = true
    } catch (e: any) {
      backendOnline.value = false
      logLoadError('模拟模式', e)
    }
  }

  return {
    sidebarCollapsed,
    systemStatus,
    simulationMode,
    activeAlarmCount,
    backendOnline,
    backendFirstCheck,
    connectionRetries,
    toggleSidebar,
    fetchSystemStatus,
    fetchSimulationMode,
  }
})
