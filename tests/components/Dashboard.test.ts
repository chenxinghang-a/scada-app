import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import fs from 'node:fs'
import path from 'node:path'
import { escCSV } from '@/utils/export'
import { deviceStateOf, deviceStateText, countDeviceStates, aggregateAlarmsByDevice } from '@/utils/dashboard'

/**
 * Dashboard 组件层测试。
 *
 * ⚠️ 这个文件曾经是「**手抄副本测试**」：把 Dashboard.vue 里的逻辑抄一份到测试里，
 * 再断言抄件。那种测试只能证明「算法意图」，**拦不住组件里的回归** ——
 * 组件改错、抄件没改，测试照样绿。文件头当时自己写明了这一点。
 *
 * round 176 已把那些逻辑抽成纯函数（`src/utils/dashboard.ts`），
 * 逻辑测试搬到 `tests/utils/dashboard.test.ts`（60 例，测**真实现**）。
 * 本文件保留两件事：
 *   ① 少数仍在组件层的真实断言（CSV 转义）
 *   ② **接线守卫** —— 防止有人把逻辑重新内联回组件，
 *      那样 `tests/utils/dashboard.test.ts` 会退化成又一份手抄副本
 *      （它测的函数还在，但组件已经不用它了 —— 最隐蔽的一类假绿）。
 *
 * `mount(Dashboard)` 在 jsdom 下需要连锁 mock echarts / socket.io-client /
 * element-plus / @/api / auth store，而 1912 行 SFC 里真正有价值的是
 * 数据契约与权限分支 —— 那部分已由 tests/api/*、tests/router/*、tests/stores/*
 * 用真实模块覆盖。所以这里不挂载组件，只做上面两件事。
 */

const REPO = process.cwd()
const DASHBOARD_VUE = path.join(REPO, 'src', 'views', 'Dashboard.vue')

/**
 * 去掉注释后再做「不得出现」断言。
 *
 * 为什么必须去注释：本轮在组件里留了多处解释性注释，**里面恰好会引用旧实现的样子**
 * （例如「原来这里是 `while (dataBuffers[key].length > cap)`」）。
 * 不去注释的话守卫会被自己的说明文字假红 —— 而**假红的守卫早晚被人关掉**。
 */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')      // HTML 注释
    .replace(/\/\*[\s\S]*?\*\//g, '')     // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // 行注释（避开 https:// 这类）
}

const RAW = fs.readFileSync(DASHBOARD_VUE, 'utf8')
const CODE = stripComments(RAW)

describe('Dashboard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('数据处理（真实实现）', () => {
    it('CSV转义正确处理逗号', () => {
      // 组件导出 CSV 时走的就是这个函数
      expect(escCSV('hello')).toBe('hello')
      expect(escCSV('hello,world')).toBe('"hello,world"')
      expect(escCSV('say "hi"')).toBe('"say ""hi"""')
      expect(escCSV('line1\nline2')).toBe('"line1\nline2"')
    })

    it('设备状态分类走真实现（不再是手抄副本）', () => {
      const alarmMap = aggregateAlarmsByDevice([{ device_id: 'dev3', alarm_level: 'critical' }])
      const devices = [
        { device_id: 'dev1', connected: true },
        { device_id: 'dev2', connected: false },
        { device_id: 'dev3', connected: true },
      ]
      // 台数：fault 口径是「有活动报警的设备数」
      expect(countDeviceStates(devices, alarmMap)).toMatchObject({ total: 3, online: 2, offline: 1, fault: 1 })
      // 状态分类：dev3 有 critical 报警 → fault
      expect(deviceStateOf(devices[2], alarmMap.dev3)).toBe('fault')
      expect(deviceStateOf(devices[1], null)).toBe('offline')
      expect(deviceStateText(devices[0], null)).toBe('运行中')
    })
  })

  describe('接线守卫 —— 逻辑必须留在纯函数层', () => {
    it('Dashboard.vue 确实导入了 @/utils/dashboard', () => {
      expect(CODE).toContain("from '@/utils/dashboard'")
    })

    it.each([
      ['等级归一化', /function\s+levelKey\s*\(/],
      ['质量码归一化', /function\s+normalizeQuality\s*\(/],
      ['桶键构造', /function\s+bufferKey\s*\([^)]*\)\s*\{\s*return\s*`\$\{/],
      ['WS 单对象判定', /data\.device_id\s*&&\s*data\.register_name/],
      ['趋势缓冲裁剪', /while\s*\(\s*dataBuffers\[key\]\.length\s*>/],
      ['设备状态分类分支', /if\s*\(\s*!d\.connected\s*\)\s*return\s*'offline'/],
      ['告警聚合循环', /alarms\.value\.forEach/],
      ['设备台数统计', /allDeviceList\.value\.filter\(/],
    ])('不得把「%s」重新内联进组件', (_label, pattern) => {
      // 这些逻辑一旦被抄回组件，tests/utils/dashboard.test.ts 就变成
      // 「测一个组件已经不用的函数」—— 测试还在、还在绿，但毫无意义。
      expect(CODE).not.toMatch(pattern)
    })

    it('守卫本身有效：把旧实现塞回去必须被抓住（防假绿）', () => {
      // 元守卫：证明上面那组断言真的在扫代码，而不是因为 stripComments 把一切都删空了
      const poisoned = `${CODE}\nfunction levelKey(level: string): 'critical' | 'warning' | 'info' {\n  return 'info'\n}\n`
      expect(stripComments(poisoned)).toMatch(/function\s+levelKey\s*\(/)
      expect(CODE).not.toMatch(/function\s+levelKey\s*\(/)
    })

    it('守卫不会被自己的注释假红：注释里提到旧写法不算违规（防假红）', () => {
      const withComment = `${CODE}\n// 原来这里是 while (dataBuffers[key].length > cap) dataBuffers[key].shift()\n`
      expect(stripComments(withComment)).not.toMatch(/while\s*\(\s*dataBuffers\[key\]\.length\s*>/)
    })
  })
})
