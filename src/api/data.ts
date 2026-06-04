import api from './request'

export interface RealtimeData {
  device_id: string
  register_name: string
  value: number
  timestamp: string
  quality: string
}

export interface HistoryRecord {
  timestamp: string
  value: number
}

export const dataApi = {
  getRealtime() {
    return api.get('/data/realtime') as Promise<{ data: RealtimeData[] }>
  },

  getLatest(deviceId: string) {
    return api.get(`/data/latest/${deviceId}`) as Promise<{ data: RealtimeData[] }>
  },

  getHistory(
    deviceId: string,
    register: string,
    params?: {
      start?: string
      end?: string
      interval?: string
      limit?: number
    }
  ) {
    // register='*' 表示查询全部寄存器，需URL编码
    const encodedRegister = encodeURIComponent(register)
    return api.get(`/data/history/${deviceId}/${encodedRegister}`, {
      params,
    }) as Promise<{ data: HistoryRecord[] }>
  },

  exportDevice(deviceId: string, params?: { format?: string; start_time?: string; end_time?: string }) {
    return api.post(
      `/export/device/${deviceId}`,
      { format: 'csv', ...params },
      { responseType: 'blob' }
    )
  },

  exportDeviceExcel(deviceId: string, params?: { start_time?: string; end_time?: string }) {
    return api.post(
      `/export/device/${deviceId}`,
      { format: 'excel', ...params },
      { responseType: 'blob' }
    )
  },

  exportDevicePDF(deviceId: string, params?: { start_time?: string; end_time?: string }) {
    return api.post(
      `/export/device/${deviceId}`,
      { format: 'pdf', ...params },
      { responseType: 'blob' }
    )
  },

  exportAlarms(params?: { format?: string; start_time?: string; end_time?: string }) {
    return api.post(
      '/export/alarms',
      { format: 'csv', ...params },
      { responseType: 'blob' }
    )
  },

  exportAlarmsExcel(params?: { start_time?: string; end_time?: string }) {
    return api.post(
      '/export/alarms',
      { format: 'excel', ...params },
      { responseType: 'blob' }
    )
  },
}
