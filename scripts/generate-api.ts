/**
 * API客户端自动生成脚本
 * 从后端API定义生成TypeScript客户端
 *
 * 使用方法:
 * npx ts-node scripts/generate-api.ts
 */

import * as fs from 'fs'
import * as path from 'path'

// API定义接口
interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  summary: string
  parameters?: Array<{
    name: string
    in: 'query' | 'path' | 'body'
    type: string
    required: boolean
    description: string
  }>
  response?: string
}

// 从后端API文件解析端点
function parseApiEndpoints(): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = []

  // 设备API
  endpoints.push(
    { method: 'GET', path: '/devices', summary: '获取所有设备' },
    { method: 'GET', path: '/devices/{id}', summary: '获取单个设备' },
    { method: 'POST', path: '/devices', summary: '添加设备' },
    { method: 'PUT', path: '/devices/{id}', summary: '更新设备' },
    { method: 'DELETE', path: '/devices/{id}', summary: '删除设备' },
    { method: 'GET', path: '/devices/protocols', summary: '获取支持的协议' },
    { method: 'POST', path: '/devices/{id}/test', summary: '测试设备连接' },
    { method: 'POST', path: '/devices/{id}/write-register', summary: '写入寄存器' },
    { method: 'POST', path: '/devices/{id}/write-coil', summary: '写入线圈' },
  )

  // 数据API
  endpoints.push(
    { method: 'GET', path: '/data/realtime', summary: '获取实时数据' },
    { method: 'GET', path: '/data/latest/{device_id}', summary: '获取设备最新数据' },
    { method: 'GET', path: '/data/history/{device_id}/{register}', summary: '获取历史数据' },
    { method: 'POST', path: '/export/device/{device_id}', summary: '导出设备数据' },
    { method: 'POST', path: '/export/alarms', summary: '导出报警数据' },
  )

  // 报警API
  endpoints.push(
    { method: 'GET', path: '/alarms', summary: '获取报警列表' },
    { method: 'GET', path: '/alarms/active', summary: '获取活动报警' },
    { method: 'POST', path: '/alarms/{id}/acknowledge', summary: '确认报警' },
    { method: 'GET', path: '/alarms/statistics', summary: '获取报警统计' },
  )

  // 系统API
  endpoints.push(
    { method: 'GET', path: '/system/status', summary: '获取系统状态' },
    { method: 'GET', path: '/system/database', summary: '获取数据库统计' },
    { method: 'GET', path: '/system/simulation-mode', summary: '获取模拟模式状态' },
    { method: 'POST', path: '/system/simulation-mode', summary: '切换模拟模式' },
    { method: 'GET', path: '/config', summary: '获取系统配置' },
    { method: 'PUT', path: '/config', summary: '更新系统配置' },
  )

  // 控制API
  endpoints.push(
    { method: 'POST', path: '/control/estop', summary: '紧急停机' },
    { method: 'POST', path: '/control/estop/reset', summary: '复位急停' },
    { method: 'GET', path: '/control/interlocks', summary: '获取安全联锁列表' },
    { method: 'POST', path: '/control/interlocks/{id}/bypass', summary: '旁路联锁' },
    { method: 'POST', path: '/control/batch', summary: '批量控制' },
  )

  // 工业4.0 API
  endpoints.push(
    { method: 'GET', path: '/industry40/health', summary: '获取设备健康评分' },
    { method: 'GET', path: '/industry40/oee', summary: '获取OEE数据' },
    { method: 'GET', path: '/industry40/spc/{device_id}/{register}', summary: '获取SPC控制图' },
    { method: 'GET', path: '/industry40/energy', summary: '获取能源数据' },
  )

  return endpoints
}

// 生成TypeScript客户端代码
function generateTypeScriptClient(endpoints: ApiEndpoint[]): string {
  let code = `/**
 * 自动生成的API客户端
 * 请勿手动修改此文件
 * 生成时间: ${new Date().toISOString()}
 */

import api from './request'

// 类型定义
export interface ApiResponse<T> {
  data: T
  success?: boolean
  message?: string
}

// API客户端
export const apiClient = {
`

  // 按模块分组
  const modules: Record<string, ApiEndpoint[]> = {}
  endpoints.forEach(ep => {
    const module = ep.path.split('/')[1] || 'root'
    if (!modules[module]) modules[module] = []
    modules[module].push(ep)
  })

  // 生成每个模块的方法
  Object.entries(modules).forEach(([module, eps]) => {
    code += `  // ${module} API\n`

    eps.forEach(ep => {
      const methodName = generateMethodName(ep)
      const pathTemplate = generatePathTemplate(ep.path)
      const params = generateParameters(ep)

      code += `  /**
   * ${ep.summary}
   */
  ${methodName}(${params}): Promise<any> {
    return api.${ep.method.toLowerCase()}(\`${pathTemplate}\`${ep.method !== 'GET' ? ', data' : ''})
  },
\n`
    })
  })

  code += `}
`
  return code
}

// 生成方法名
function generateMethodName(ep: ApiEndpoint): string {
  const parts = ep.path.split('/').filter(p => p && !p.startsWith('{'))
  const method = ep.method.toLowerCase()

  // 特殊映射
  const specialMappings: Record<string, string> = {
    'get /devices': 'getDevices',
    'get /devices/{id}': 'getDevice',
    'post /devices': 'createDevice',
    'put /devices/{id}': 'updateDevice',
    'delete /devices/{id}': 'deleteDevice',
    'get /data/realtime': 'getRealtimeData',
    'get /data/latest/{device_id}': 'getLatestData',
    'get /data/history/{device_id}/{register}': 'getHistoryData',
    'get /alarms': 'getAlarms',
    'get /alarms/active': 'getActiveAlarms',
    'post /alarms/{id}/acknowledge': 'acknowledgeAlarm',
    'get /system/status': 'getSystemStatus',
    'post /control/estop': 'emergencyStop',
    'post /control/estop/reset': 'resetEmergencyStop',
  }

  const key = `${method} ${ep.path}`
  if (specialMappings[key]) return specialMappings[key]

  // 默认命名规则
  const prefix = method === 'get' ? 'get' : method === 'post' ? 'create' : method === 'put' ? 'update' : 'delete'
  const suffix = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('')
  return `${prefix}${suffix}`
}

// 生成路径模板
function generatePathTemplate(path: string): string {
  return path.replace(/\{(\w+)\}/g, '${$1}')
}

// 生成参数
function generateParameters(ep: ApiEndpoint): string {
  const pathParams = ep.path.match(/\{(\w+)\}/g)?.map(p => p.slice(1, -1)) || []
  const params = pathParams.map(p => `${p}: string`)

  if (ep.method !== 'GET') {
    params.push('data?: any')
  }

  return params.join(', ')
}

// 主函数
function main() {
  console.log('开始生成API客户端...')

  const endpoints = parseApiEndpoints()
  console.log(`解析到 ${endpoints.length} 个API端点`)

  const code = generateTypeScriptClient(endpoints)

  const outputPath = path.join(__dirname, '..', 'src', 'api', 'auto-generated.ts')
  fs.writeFileSync(outputPath, code, 'utf-8')

  console.log(`API客户端已生成: ${outputPath}`)
}

// 运行
if (require.main === module) {
  main()
}

export { parseApiEndpoints, generateTypeScriptClient }
