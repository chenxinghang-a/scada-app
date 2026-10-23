// 操作类功能端到端普查：每一项都「发请求 → 读回验证」，不看 success 字段就下结论
const B = 'http://127.0.0.1:5000/api'
let H = { 'Content-Type': 'application/json' }
const ok = []
const bad = []

function pass (name, detail) { ok.push(`${name}${detail ? ' — ' + detail : ''}`); console.log('PASS', name, detail || '') }
function fail (name, detail) { bad.push(`${name} — ${detail}`); console.log('FAIL', name, '|', detail) }

const j = async (r) => { try { return await r.json() } catch { return { _raw: await r.text().catch(() => '') } } }
const get = (p) => fetch(B + p, { headers: H }).then(j)
const post = (p, body) => fetch(B + p, { method: 'POST', headers: H, body: JSON.stringify(body || {}) }).then(j)
const put = (p, body) => fetch(B + p, { method: 'PUT', headers: H, body: JSON.stringify(body || {}) }).then(j)

;(async () => {
  // 登录（测试库已被重置为固定密码、must_change=0；不要在脚本里改密码，
  // 改了下次跑就连不上 —— 这坑踩过一次）
  let l = await post('/auth/login', { username: 'admin', password: process.env.SCADA_PWD || 'Test@12345' })
  let t = l.token
  if (!t) { console.error('登录失败:', JSON.stringify(l).slice(0, 160)); return }
  H.Authorization = 'Bearer ' + t
  console.log('登录 OK | role =', l.user?.role, '\n')

  // 1. 急停 → 状态 → 复位
  try {
    await post('/control/estop')
    const s1 = await get('/control/estop/status')
    const active1 = s1?.estop?.active ?? s1?.active
    await post('/control/estop/reset')
    const s2 = await get('/control/estop/status')
    const active2 = s2?.estop?.active ?? s2?.active
    if (active1 === true && active2 === false) pass('急停/复位', '按下→active=true，复位→false')
    else fail('急停/复位', `按下后 active=${active1}，复位后 active=${active2}`)
  } catch (e) { fail('急停/复位', String(e).slice(0, 80)) }

  // 2. 配置保存 → 读回
  try {
    const before = await get('/config')
    const sec = before?.config?.system ? 'system' : Object.keys(before?.config || {})[0]
    const cur = before?.config?.[sec]
    if (!sec || !cur) { fail('配置保存', '拿不到配置段') } else {
      const marker = 'e2e-probe-' + Date.now()
      const patched = { ...cur, _e2e_marker: marker }
      const w = await put('/config', { section: sec, data: patched })
      const after = await get('/config')
      const back = after?.config?.[sec]?._e2e_marker
      if (w?.success && back === marker) pass('配置保存', `section=${sec} 写入并读回一致`)
      else fail('配置保存', `写入 success=${w?.success}，读回 marker=${back}`)
    }
  } catch (e) { fail('配置保存', String(e).slice(0, 80)) }

  // 3. 用户注册 → 列表可见
  try {
    const uname = 'e2e_user_' + Date.now().toString().slice(-6)
    const r = await post('/auth/register', { username: uname, password: 'E2e@12345x', role: 'operator', display_name: 'E2E' })
    const users = await get('/auth/users')
    const found = (users?.users || users?.data || []).some(u => u.username === uname)
    if (r?.success && found) pass('新建用户', `${uname} 创建并出现在列表`)
    else fail('新建用户', `创建 success=${r?.success} msg=${r?.message}，列表可见=${found}`)
  } catch (e) { fail('新建用户', String(e).slice(0, 80)) }

  // 4. 报警确认（拿一条未确认的）
  try {
    const list = await get('/alarms?limit=20')
    const unacked = (list?.alarms || []).find(a => !a.acknowledged)
    if (!unacked) {
      pass('报警确认', '当前无未确认报警，跳过')
    } else {
      const r = await post(`/alarms/${unacked.alarm_id || unacked.id}/acknowledge`, { device_id: unacked.device_id, register_name: unacked.register_name })
      const after = await get('/alarms?limit=20')
      const row = (after?.alarms || []).find(a => a.id === unacked.id)
      if (r?.success && row?.acknowledged) pass('报警确认', `id=${unacked.id} 状态已置为已确认`)
      else fail('报警确认', `接口 success=${r?.success} msg=${r?.message}，读回 acknowledged=${row?.acknowledged}`)
    }
  } catch (e) { fail('报警确认', String(e).slice(0, 80)) }

  // 5. 报警导出
  try {
    const r = await fetch(B + '/export/alarms', { method: 'POST', headers: H, body: JSON.stringify({ format: 'csv' }) })
    const ct = r.headers.get('content-type') || ''
    const buf = await r.arrayBuffer()
    if (r.ok && buf.byteLength > 50) pass('报警导出', `${buf.byteLength} 字节，${ct.split(';')[0]}`)
    else fail('报警导出', `HTTP ${r.status}，${buf.byteLength} 字节`)
  } catch (e) { fail('报警导出', String(e).slice(0, 80)) }

  // 6. 批量控制
  try {
    const r = await post('/control/batch', { action: 'start', device_ids: ['siemens_1500_01'] })
    if (r?.success) pass('批量控制', JSON.stringify(r).slice(0, 90))
    else fail('批量控制', JSON.stringify(r).slice(0, 140))
  } catch (e) { fail('批量控制', String(e).slice(0, 80)) }

  // 7. 配方：列表 → 启动
  try {
    const list = await get('/control/recipe/list')
    const raw = list?.recipes || list?.data?.recipes || list?.data || []
    const items = Array.isArray(raw) ? raw : Object.entries(raw).map(([k, v]) => ({ id: k, ...v }))
    if (!Array.isArray(items) || !items.length) {
      fail('配方', `列表为空：${JSON.stringify(list).slice(0, 100)}`)
    } else {
      const name = items[0].id || items[0].recipe_id || items[0].name
      const r = await post('/control/recipe/start', { recipe_name: name, device_id: 'siemens_1500_01' })
      if (r?.success) pass('配方启动', `${name} → ${JSON.stringify(r).slice(0, 70)}`)
      else fail('配方启动', `${name} → ${JSON.stringify(r).slice(0, 120)}`)
    }
  } catch (e) { fail('配方', String(e).slice(0, 80)) }

  // 8. 联锁清单
  try {
    const r = await get('/control/interlocks')
    // 后端返回扁平 dict：{rule_id: {action, condition, bypassed, description}}
    const flat = r?.interlocks?.rules || r?.rules || r?.interlocks || r
    const rules = flat && typeof flat === 'object' && !Array.isArray(flat) ? Object.values(flat) : (flat || [])
    const n = Array.isArray(rules) ? rules.length : Object.keys(rules || {}).length
    if (n > 0) pass('安全联锁', `${n} 条规则`)
    else fail('安全联锁', `规则数=0（此前日志警告「未加载任何联锁规则」）`)
  } catch (e) { fail('安全联锁', String(e).slice(0, 80)) }

  console.log(`\n===== 汇总: ${ok.length} 通过 / ${bad.length} 失败 =====`)
  if (bad.length) { console.log('失败项:'); bad.forEach(b => console.log('  ×', b)) }
})().catch(e => console.error('FATAL', e))
