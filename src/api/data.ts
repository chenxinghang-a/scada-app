import api from './request'

export interface RealtimeData {
  device_id: string
  register_name: string
  value: number
  timestamp: string
  /**
   * OPC UA 质量码（int，192=Good / 104=Uncertain / 0=Bad，
   * 另有 4=传感器故障 6=通信故障 8=停用 80=需校准 64=最后可用值）。
   *
   * ⚠️ 历史上这里写成 `quality: string`，但后端 `realtime_data` 表里是
   * INTEGER，且采集层用的是数值码 —— 类型撒谎会导致 `q >= 192` 这类比较
   * 在 TS 侧被放行、在运行时对字符串静默判错。这里已改为 `number | null`
   * （null = 该行没有质量码，调用方应走"无质量信息"的降级分支）。
   */
  quality?: number | null
}

export interface HistoryRecord {
  timestamp: string
  value: number
}

export interface LatestValue {
  value: number
  unit?: string
  timestamp: string
  quality?: number | null
}

/** 不传 register_name 时的返回：{寄存器名: 值对象} */
export type LatestMap = Record<string, LatestValue>

export const dataApi = {
  getRealtime() {
    return api.get('/data/realtime') as Promise<{ data: RealtimeData[] }>
  },

  /**
   * 获取设备最新数据。
   *
   * ⚠️ 后端该接口有**两种返回形态**（`展示层/api/api_data.py:50-59` →
   * `存储层/database.py:472-517`）：
   *   - 不传 `registerName` → `{寄存器名: {…}}` 映射（`LatestMap`）
   *   - 传了 `registerName` → **单条寄存器的平铺 dict**（`LatestValue`，
   *     实际还带 id/device_id/register_name/created_at 等额外字段）
   *
   * 所以返回类型是**联合类型**。此前统一声明成 `Record<string, LatestValue>`，
   * 是对第二种形态的撒谎 —— 调用方按映射去 `Object.entries()` 会拿到
   * id/device_id/value/... 这些字段名当作"寄存器名"，静默跑出错误结果。
   *
   * 这里保留了两个**精确形态**的类型别名供调用方断言：
   *   `getLatestLatestMap` / `getLatestSingle`，配合联合类型做收窄。
   */
  getLatestLatestMap(deviceId: string) {
    return api.get(`/data/latest/${deviceId}`) as Promise<{ data: LatestMap }>
  },

  getLatestSingle(deviceId: string, registerName: string) {
    return api.get(`/data/latest/${deviceId}`, {
      params: { register_name: registerName },
    }) as Promise<{ data: LatestValue }>
  },

  /**
   * 兼容入口：不区分要不要 `register_name`，统一返回联合类型。
   * **新代码请优先用上面两个精确方法**，只有确实要在运行时按参数分支时才用它。
   */
  getLatest(deviceId: string, registerName?: string) {
    return api.get(`/data/latest/${deviceId}`, {
      params: registerName ? { register_name: registerName } : undefined,
    }) as Promise<{ data: LatestMap | LatestValue }>
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
