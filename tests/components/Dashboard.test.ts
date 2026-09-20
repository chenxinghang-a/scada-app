/**
 * Dashboard 组件测试
 *
 * ⚠️ 现状说明（不要被文件名误导）：
 *   本文件测的是 **Dashboard.vue 里同名逻辑的手抄副本**，不是组件本身。
 *   `mount(Dashboard)` 在 jsdom 下需要连锁 mock echarts / socket.io-client /
 *   element-plus / @/api / auth store，且 1912 行的 SFC 里真正有价值的是
 *   数据契约与权限分支 —— 那部分已由 tests/api/*、tests/router/*、
 *   tests/stores/* 用真实模块覆盖。
 *   保留本文件是为了**不删已有测试**（零删除原则），同时把其中
 *   "手抄 escCSV 再断言手抄实现" 这类零价值断言换成真实实现。
 *
 *   TODO(建议)：若后续要加强组件层覆盖，正确做法是把 Dashboard.vue 里的
 *   设备状态分类 / WebSocket 报文解析抽成 `src/utils/dashboard.ts` 纯函数，
 *   再对纯函数写测试；在组件树里测这些逻辑收益极低且脆弱。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { escCSV } from '@/utils/export'

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
      // 原来这里内联了一份 escCSV 再断言它自己，等于什么都没测。
      // 改为直接验证真实实现（组件导出 CSV 时走的就是这个函数）。
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

  // 注意：下面两条同样是手抄副本（组件内的 socket 处理逻辑没有被导出），
  // 属于"文档性质"的断言，只能证明算法意图、拦不住组件里的回归。
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
