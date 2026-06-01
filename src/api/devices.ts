import api from './request'

// 对齐后端实际返回的数据结构
export interface Device {
  device_id: string
  id?: string
  name: string           // 后端返回 name，不是 device_name
  device_name?: string   // 兼容旧字段
  protocol: string
  host?: string
  port?: number
  slave_id?: number
  enabled?: boolean
  connected?: boolean
  stopped?: boolean
  status?: string        // 'fault' | 'online' | 'offline' | 'running' | 'idle'
  zone?: string
  device_category?: string
  registers?: Register[]
  nodes?: any[]
  topics?: any[]
  endpoints?: any[]
}

export interface Register {
  name: string
  address?: number
  data_type?: string
  scale?: number
  unit?: string
  description?: string
  rw?: string
}

export const devicesApi = {
  getAll() {
    return api.get('/devices') as Promise<{ devices: Device[] }>
  },

  getById(id: string) {
    return api.get(`/devices/${id}`) as Promise<{ device: Device }>
  },

  create(device: Partial<Device>) {
    return api.post('/devices', device)
  },

  update(id: string, device: Partial<Device>) {
    return api.put(`/devices/${id}`, device)
  },

  delete(id: string) {
    return api.delete(`/devices/${id}`)
  },

  test(id: string) {
    return api.post(`/devices/${id}/test`) as Promise<{ success: boolean; message: string }>
  },

  connect(id: string) {
    return api.post(`/devices/${id}/connect`) as Promise<{ success: boolean; message: string }>
  },

  disconnect(id: string) {
    return api.post(`/devices/${id}/disconnect`) as Promise<{ success: boolean; message: string }>
  },

  start(id: string) {
    return api.post(`/devices/${id}/start`) as Promise<{ success: boolean; message: string }>
  },

  stop(id: string) {
    return api.post(`/devices/${id}/stop`) as Promise<{ success: boolean; message: string }>
  },

  getProtocols() {
    return api.get('/devices/protocols') as Promise<{ protocols: string[] }>
  },

  getTemplates() {
    return api.get('/devices/templates') as Promise<{ templates: Record<string, any> }>
  },

  getPresets() {
    return api.get('/devices/presets') as Promise<{ presets: any[] }>
  },

  addPreset(presetId: string) {
    return api.post('/devices/presets/add', { preset_id: presetId })
  },

  getPresetById(presetId: string) {
    return api.get(`/devices/presets/${presetId}`) as Promise<any>
  },

  batchAddPresets(presetIds: string[]) {
    return api.post('/devices/presets/batch-add', { preset_ids: presetIds })
  },

  addAllPresets() {
    return api.post('/devices/presets/add-all')
  },

  injectFault(id: string, fault: any) {
    return api.post(`/devices/${id}/inject-fault`, fault)
  },

  forceState(id: string, state: any) {
    return api.post(`/devices/${id}/force-state`, state)
  },

  getBehavior(id: string) {
    return api.get(`/devices/${id}/behavior`) as Promise<any>
  },
}
