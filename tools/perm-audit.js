// 权限矩阵：四个角色 × 六个关键操作，逐个实测而不是看代码推测。
// 预期来自 用户层/auth.py 的 ROLES：
//   admin    read write delete manage_users manage_devices acknowledge_alarms export_data system_config
//   engineer read write acknowledge_alarms export_data manage_devices
//   operator read acknowledge_alarms
//   viewer   read
const B = 'http://127.0.0.1:5000/api'
const PWD = process.env.SCADA_PWD || 'Test@12345'
const NEWPWD = 'Role@2026test'

const OP = [
  { name: '查看用户列表', method: 'GET', path: '/auth/users', expect: { admin: 200, engineer: 403, operator: 403, viewer: 403 } },
  { name: '改系统配置', method: 'PUT', path: '/config', body: { section: 'system', data: {} }, expect: { admin: 200, engineer: 403, operator: 403, viewer: 403 } },
  { name: '写寄存器', method: 'POST', path: '/devices/siemens_1500_01/write-register', body: { address: 0, value: 100 }, expect: { admin: 200, engineer: 200, operator: 403, viewer: 403 } },
  { name: '确认报警', method: 'POST', path: '/alarms/temp_high/acknowledge', body: {}, expect: { admin: 200, engineer: 200, operator: 200, viewer: 403 } },
  { name: '急停', method: 'POST', path: '/control/estop', body: {}, expect: { admin: 200, engineer: 200, operator: 200, viewer: 200 } },
  { name: '控制审计日志', method: 'GET', path: '/control/audit', expect: { admin: 200, engineer: 200, operator: 200, viewer: 200 } },
]

const j = async (r) => { try { return await r.json() } catch { return {} } }

;(async () => {
  // 1. admin 登录，建三个角色账号
  const adm = await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PWD }) }).then(j)
  if (!adm.token) { console.error('admin 登录失败', JSON.stringify(adm).slice(0, 120)); return }
  const AH = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adm.token }

  const roles = ['engineer', 'operator', 'viewer']
  for (const r of roles) {
    const u = 'role_' + r
    await fetch(B + '/auth/register', { method: 'POST', headers: AH, body: JSON.stringify({ username: u, password: NEWPWD, role: r, display_name: r }) }).then(j)
  }

  // 2. 每个角色登录，跑同一组操作
  const tokens = { admin: adm.token }
  for (const r of roles) {
    const res = await fetch(B + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'role_' + r, password: NEWPWD }) }).then(j)
    if (res.must_change_password) {
      const f = await fetch(B + '/auth/force-change-password', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + res.token }, body: JSON.stringify({ username: 'role_' + r, new_password: NEWPWD }) }).then(j)
      tokens[r] = f.token
    } else tokens[r] = res.token
  }

  const rows = []
  for (const op of OP) {
    const line = {}
    for (const role of ['admin', 'engineer', 'operator', 'viewer']) {
      const t = tokens[role]
      if (!t) { line[role] = 'NOLOGIN'; continue }
      const r = await fetch(B + op.path, {
        method: op.method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: op.body ? JSON.stringify(op.body) : undefined,
      })
      line[role] = r.status
    }
    rows.push({ op: op.name, ...line, expect: op.expect })
  }

  console.log('操作'.padEnd(14) + 'admin  engineer operator viewer   判定')
  let issues = 0
  for (const r of rows) {
    const marks = ['admin', 'engineer', 'operator', 'viewer'].map(k => {
      const got = r[k]
      const exp = r.expect[k]
      // 服务端可能用 403 / 401 / 400 表达拒绝，只要不是 2xx 就算「被拒」
      const gotDeny = typeof got === 'number' ? got >= 400 : true
      const expDeny = exp >= 400
      return gotDeny === expDeny ? null : `${k}:期望${exp}实得${got}`
    }).filter(Boolean)
    if (marks.length) issues++
    console.log(
      r.op.padEnd(14) +
      String(r.admin).padEnd(7) + String(r.engineer).padEnd(9) + String(r.operator).padEnd(9) + String(r.viewer).padEnd(10) +
      (marks.length ? '× ' + marks.join(', ') : 'OK')
    )
  }
  console.log(`\n${issues ? issues + ' 项与预期不符' : '全部符合预期'}`)

  // 收尾：复位急停
  await fetch(B + '/control/estop/reset', { method: 'POST', headers: AH, body: '{}' })
})().catch(e => console.error('FATAL', e))
