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
    return api.get(`/data/history/${deviceId}/${register}`, {
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
}
