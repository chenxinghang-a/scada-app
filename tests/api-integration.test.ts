/**
 * API集成测试脚本
 * 测试前后端API契约对齐
 * 运行: npx ts-node tests/api-integration.test.ts
 */

const BASE_URL = 'http://localhost:5000/api'

interface TestResult {
  name: string
  passed: boolean
  message: string
}

const results: TestResult[] = []

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    results.push({ name, passed: true, message: 'OK' })
    console.log(`  ✅ ${name}`)
  } catch (e: any) {
    results.push({ name, passed: false, message: e.message })
    console.log(`  ❌ ${name}: ${e.message}`)
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message)
}

async function fetchJSON(path: string, options?: RequestInit) {
  const resp = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  return { status: resp.status, data: await resp.json() }
}

// ========== 测试套件 ==========

async function testHealthEndpoints() {
  console.log('\n📋 Health Endpoints')

  await test('GET /health/status returns success envelope', async () => {
    const { status, data } = await fetchJSON('/health/status')
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.success === true, 'Missing success field')
    assert(data.data !== undefined, 'Missing data field')
  })

  await test('GET /health/modules returns module list', async () => {
    const { status, data } = await fetchJSON('/health/modules')
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.success === true, 'Missing success field')
  })
}

async function testDeviceEndpoints() {
  console.log('\n📋 Device Endpoints')

  await test('GET /devices returns device list', async () => {
    const { status, data } = await fetchJSON('/devices')
    assert(status === 200, `Expected 200, got ${status}`)
    assert(Array.isArray(data.devices), 'Missing devices array')
  })

  await test('GET /devices/protocols returns protocol list', async () => {
    const { status, data } = await fetchJSON('/devices/protocols')
    assert(status === 200, `Expected 200, got ${status}`)
    assert(Array.isArray(data.protocols), 'Missing protocols array')
    assert(data.protocols.length > 0, 'Empty protocols list')
    // 验证协议对象结构
    const proto = data.protocols[0]
    assert(proto.id !== undefined, 'Missing protocol id')
    assert(proto.name !== undefined, 'Missing protocol name')
  })
}

async function testDataEndpoints() {
  console.log('\n📋 Data Endpoints')

  await test('GET /data/realtime returns data array', async () => {
    const { status, data } = await fetchJSON('/data/realtime')
    assert(status === 200, `Expected 200, got ${status}`)
    assert(Array.isArray(data.data), 'Missing data array')
  })
}

async function testSystemEndpoints() {
  console.log('\n📋 System Endpoints')

  await test('GET /system/status returns system status', async () => {
    const { status, data } = await fetchJSON('/system/status')
    assert(status === 200, `Expected 200, got ${status}`)
  })

  await test('GET /system/database returns database stats', async () => {
    const { status, data } = await fetchJSON('/system/database')
    assert(status === 200, `Expected 200, got ${status}`)
    assert(data.database_size_mb !== undefined, 'Missing database_size_mb')
    assert(data.total_records !== undefined, 'Missing total_records')
  })
}

async function testAlarmEndpoints() {
  console.log('\n📋 Alarm Endpoints')

  await test('GET /alarms returns alarm list', async () => {
    const { status, data } = await fetchJSON('/alarms')
    assert(status === 200, `Expected 200, got ${status}`)
    assert(Array.isArray(data.alarms), 'Missing alarms array')
  })

  await test('GET /alarms/active returns active alarms', async () => {
    const { status, data } = await fetchJSON('/alarms/active')
    assert(status === 200, `Expected 200, got ${status}`)
    assert(Array.isArray(data.alarms), 'Missing alarms array')
  })
}

async function testControlEndpoints() {
  console.log('\n📋 Control Endpoints')

  await test('GET /control/status returns control status', async () => {
    const { status, data } = await fetchJSON('/control/status')
    assert(status === 200, `Expected 200, got ${status}`)
  })
}

// ========== 运行测试 ==========

async function runAllTests() {
  console.log('🚀 SCADA API集成测试')
  console.log(`目标: ${BASE_URL}`)
  console.log('='.repeat(50))

  const startTime = Date.now()

  await testHealthEndpoints()
  await testDeviceEndpoints()
  await testDataEndpoints()
  await testSystemEndpoints()
  await testAlarmEndpoints()
  await testControlEndpoints()

  const duration = Date.now() - startTime
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length

  console.log('\n' + '='.repeat(50))
  console.log(`📊 测试结果: ${passed} 通过, ${failed} 失败, 耗时 ${duration}ms`)

  if (failed > 0) {
    console.log('\n❌ 失败的测试:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.name}: ${r.message}`)
    })
    process.exit(1)
  } else {
    console.log('\n✅ 所有测试通过!')
    process.exit(0)
  }
}

runAllTests().catch(e => {
  console.error('测试运行失败:', e)
  process.exit(1)
})
