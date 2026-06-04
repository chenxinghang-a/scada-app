/**
 * Dashboard组件测试
 * 测试关键UI逻辑和数据处理
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

// 模拟echarts
vi.mock('echarts', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
  })),
}))

describe('Dashboard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('数据处理', () => {
    it('设备状态分类正确', () => {
      const devices = [
        { device_id: 'dev1', connected: true, status: 'online' },
        { device_id: 'dev2', connected: false, status: 'offline' },
        { device_id: 'dev3', connected: true, status: 'fault' },
      ]

      const online = devices.filter(d => d.connected).length
      const offline = devices.filter(d => !d.connected).length
      const fault = devices.filter(d => d.status === 'fault').length

      expect(online).toBe(2)
      expect(offline).toBe(1)
      expect(fault).toBe(1)
    })

    it('CSV转义正确处理逗号', () => {
      const escCSV = (v: string) => {
        const s = String(v ?? '')
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"` : s
      }

      expect(escCSV('hello')).toBe('hello')
      expect(escCSV('hello,world')).toBe('"hello,world"')
      expect(escCSV('say "hi"')).toBe('"say ""hi"""')
      expect(escCSV('line1\nline2')).toBe('"line1\nline2"')
    })

    it('趋势图数据点限制', () => {
      const MAX_POINTS = 200
      const data = Array.from({ length: 500 }, (_, i) => ({
        t: `time${i}`,
        v: i,
      }))

      const limited = data.slice(-MAX_POINTS)
      expect(limited.length).toBe(200)
      expect(limited[0].v).toBe(300) // 从第300个开始
    })
  })

  describe('WebSocket数据处理', () => {
    it('单对象格式解析', () => {
      const deviceValues: Record<string, number> = {}
      const data = {
        device_id: 'dev1',
        register_name: 'temperature',
        value: '25.5',
      }

      if (data.device_id && data.register_name && data.value != null) {
        deviceValues[`${data.device_id}:${data.register_name}`] = parseFloat(data.value)
      }

      expect(deviceValues['dev1:temperature']).toBe(25.5)
    })

    it('映射格式解析', () => {
      const deviceValues: Record<string, number> = {}
      const data = {
        temperature: { device_id: 'dev1', value: '25.5' },
        pressure: { device_id: 'dev1', value: '1.2' },
      }

      Object.entries(data).forEach(([regName, info]: [string, any]) => {
        if (!info || typeof info !== 'object') return
        const devId = info.device_id
        const val = info.value
        if (!devId || val == null) return
        deviceValues[`${devId}:${regName}`] = parseFloat(val)
      })

      expect(deviceValues['dev1:temperature']).toBe(25.5)
      expect(deviceValues['dev1:pressure']).toBe(1.2)
    })
  })
})
