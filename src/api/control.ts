import api from './request'

export const controlApi = {
  // 安全状态
  getStatus() {
    return api.get('/control/status') as Promise<any>
  },

  // 紧急停机
  eStop() {
    return api.post('/control/estop') as Promise<{ success: boolean }>
  },

  eStopReset() {
    return api.post('/control/estop/reset') as Promise<{ success: boolean }>
  },

  eStopStatus() {
    return api.get('/control/estop/status') as Promise<any>
  },

  // 安全联锁
  getInterlocks() {
    return api.get('/control/interlocks') as Promise<any>
  },

  bypassInterlock(ruleId: string) {
    return api.post(`/control/interlocks/${ruleId}/bypass`) as Promise<{ success: boolean }>
  },

  restoreInterlock(ruleId: string) {
    return api.post(`/control/interlocks/${ruleId}/restore`) as Promise<{ success: boolean }>
  },

  // 联锁旁路审批流程
  requestBypass(ruleId: string, reason: string) {
    return api.post('/control/interlocks/bypass-request', { rule_id: ruleId, reason }) as Promise<any>
  },

  approveBypass(requestId: string) {
    return api.post('/control/interlocks/bypass-approve', { request_id: requestId }) as Promise<any>
  },

  rejectBypass(requestId: string) {
    return api.post('/control/interlocks/bypass-reject', { request_id: requestId }) as Promise<any>
  },

  getPendingBypasses() {
    return api.get('/control/interlocks/bypass-pending') as Promise<any>
  },

  // 设备写入
  writeRegister(deviceId: string, registerName: string, value: number) {
    return api.post(`/devices/${deviceId}/write-register`, { register_name: registerName, value }) as Promise<any>
  },

  writeCoil(deviceId: string, coilName: string, value: boolean) {
    return api.post(`/devices/${deviceId}/write-coil`, { coil_name: coilName, value }) as Promise<any>
  },

  adjustDevice(deviceId: string, params: any) {
    return api.post(`/devices/${deviceId}/adjust`, params) as Promise<any>
  },

  // 批量控制
  batchControl(action: string, deviceIds?: string[]) {
    return api.post('/control/batch', { action, device_ids: deviceIds }) as Promise<any>
  },

  // 设备健康
  getDeviceHealth() {
    return api.get('/control/health') as Promise<any>
  },

  // 操作日志
  getLogs(params?: { page?: number; per_page?: number }) {
    return api.get('/control/logs', { params }) as Promise<any>
  },

  getAuditLog() {
    return api.get('/control/audit') as Promise<any>
  },

  // 配方控制
  getRecipes() {
    return api.get('/control/recipe/list') as Promise<any>
  },

  startRecipe(recipeId: string) {
    return api.post('/control/recipe/start', { recipe_id: recipeId }) as Promise<any>
  },

  stopRecipe() {
    return api.post('/control/recipe/stop') as Promise<any>
  },

  getRecipeStatus() {
    return api.get('/control/recipe/status') as Promise<any>
  },
}
