// 把 6 项后端修复打到**主仓 HEAD 的导出副本**上（绝不碰主仓工作区）。
//
// 为什么是「导出副本」而不是直接改主仓：后端主仓
// C:/Users/cxx/WorkBuddy/Claw/industrial_scada 有另一个实例在活跃开发，
// 工作区常有未提交改动，直接改就是踩别人的脚。
//
// 用法：
//   git -C <主仓> archive HEAD -o head.tar
//   mkdir back && tar -xf head.tar -C back
//   node tools/apply-backend-patches.js back
//   <venv>/pyinstaller --noconfirm --distpath out/dist --workpath out/work back/scada-backend.spec
//
// 每处替换都**断言锚点存在**，锚点没命中会报错退出（绝不静默跳过）—— 
// 主仓代码一旦改动位置，这里必须重新对锚点，否则补丁会悄悄不生效。
const fs = require('fs')
const _arg = (process.argv[2] || '').split('\\').join('/')
const ROOT = _arg ? _arg.replace(/\/+$/, '') + '/' : ''
if (!ROOT) { console.error('用法: node tools/apply-backend-patches.js <主仓 HEAD 导出目录>'); process.exit(2) }
const rd = (f) => fs.readFileSync(ROOT + f, 'utf8').split('\r\n').join('\n')
const wr = (f, s) => fs.writeFileSync(ROOT + f, s)

let bad = 0
function patch (file, anchor, repl, mode, desc) {
  let s = rd(file)
  if (!s.includes(anchor)) { console.error('!! 锚点缺失:', desc, '@', file); bad++; return }
  if (mode === 'after') s = s.replace(anchor, anchor + repl)
  else if (mode === 'before') s = s.replace(anchor, repl + anchor)
  else s = s.replace(anchor, repl)
  wr(file, s)
  console.log('OK ', desc)
}

// ---- 1. JSON provider：时间字段带时区偏移 ----
patch('展示层/routes.py',
  'from flask import Flask, render_template, jsonify, request, redirect, url_for, g, current_app',
  '\nfrom flask.json.provider import DefaultJSONProvider\nfrom datetime import datetime as _dt, date as _date',
  'after', 'routes.py import')

patch('展示层/routes.py',
  'logger = logging.getLogger(__name__)',
  `

class _ScadaJSONProvider(DefaultJSONProvider):
    """时间序列化统一口径：datetime 一律输出**带时区偏移**的 ISO8601。

    后端大量使用 naive datetime（值 = 本地时间，无 tzinfo），Flask 默认 provider
    按 HTTP-date 输出成 \`Fri, 23 Oct 2026 18:41:52 GMT\` —— 把本地时间谎报成 UTC。
    前端 new Date() 按 UTC 解析后转本地，东八区凭空 +8 小时：仪表盘报警时间显示成
    "未来"、历史窗口与曲线对不上。这里给 naive 补上系统时区再输出
    \`2026-10-23T18:41:52+08:00\`，任何解析方式都得到同一时刻。
    """

    def default(self, o):
        if isinstance(o, _dt):
            if o.tzinfo is None:
                o = o.astimezone()
            return o.isoformat()
        if isinstance(o, _date):
            return o.isoformat()
        return super().default(o)`,
  'after', 'routes.py JSONProvider 定义')

patch('展示层/routes.py',
  "    app.config['SECRET_KEY'] = FlaskConfig.SECRET_KEY",
  '\n\n    # 时间序列化口径（见 _ScadaJSONProvider 注释）\n    app.json = _ScadaJSONProvider(app)',
  'after', 'routes.py 绑定 provider')

// ---- 2. OEE：补记运行时间 ----
patch('智能层/oee_calculator.py',
  '    def set_theoretical_rate(self, device_id: str, rate: float):',
  `    def seed_run_time(self, device_id: str, seconds: float) -> None:
        """补记「班次开始以来已运行时长」（模拟模式预热用）。

        模拟初始化按「已跑 N 小时」预置产量，但运行时间计数器仍从 0 起算。
        可用率 = 实际运行时间 / 计划生产时间，于是 A≈0 → OEE≈0.07%，
        页面上就是「OEE 0%，未达标」。产量与运行时间必须同口径预置。
        """
        with self._lock:
            sd = self.shift_data.get(device_id)
            if sd is not None:
                sd['actual_run_time'] = max(sd.get('actual_run_time', 0), float(seconds))

`,
  'before', 'oee_calculator.seed_run_time')

// ---- 3. 能源：预置今日累计 ----
patch('智能层/energy_manager.py',
  '    def get_energy_summary(self, device_id: str | None = None) -> dict[str, Any]:',
  `    def seed_accumulated(self, device_id: str, energy_kwh: float,
                         timestamp: datetime | None = None) -> None:
        """预置累计电量（模拟模式预热用）。

        feed_power_data 的功率积分需要**两次**采样才有增量，进程刚起来时第一次读数
        只建基线 → energy_accumulated 恒为 0 → 页面显示「总用电 0 kWh / 电费 ¥0 /
        碳排放 0 kg」，看起来就是能源模块没做完。按当前时刻折算今日已用电量预置，
        与 OEE 预置「已生产 N 件」口径一致。
        """
        if energy_kwh <= 0:
            return
        now = timestamp or datetime.now()
        tariff_type = self._get_tariff_type(now.hour)
        with self._lock:
            self.energy_accumulated[device_id]['energy_kwh'] += energy_kwh
            self.energy_accumulated[device_id][f'{tariff_type}_kwh'] += energy_kwh

`,
  'before', 'energy_manager.seed_accumulated')

// ---- 4. 智能层初始化：配置加载的设备也要有 OEE / 能源数据 ----
patch('core/simulation_initializer.py',
  `    def initialize_all(self):
        """
        兼容旧接口 — 不再预设设备，仅记录日志
        """
        device_count = len(self.device_manager.get_all_devices())
        logger.info(f"模拟模式启动完成: 当前设备数量={device_count}")
        if device_count == 0:
            logger.info("  提示: 设备数量为0，请通过前端添加预设设备或自定义设备")`,
  `    def _default_sim_params(self, device_config: dict, device_id: str) -> dict:
        """给「没有对应预设」的设备派生一套稳定的模拟参数。

        用 device_id 的字符和派生，保证同一设备每次启动拿到同一组基线
        （否则每次重启 OEE/能耗都乱跳，看起来像数据不可信）。
        """
        seed = sum(ord(c) for c in str(device_id)) if device_id else 0
        registers = device_config.get('registers') or device_config.get('nodes') or []
        base_values, noise_levels = {}, {}
        for reg in registers:
            name = reg.get('name')
            if not name:
                continue
            bv = reg.get('sim_base', reg.get('base_value'))
            if bv is None:
                bv = 50.0
            base_values[name] = float(bv)
            noise_levels[name] = max(0.5, abs(float(bv)) * 0.05)
        return {
            'theoretical_rate': 60 + (seed % 7) * 20,   # 60~180 件/小时
            'energy_baseline': 80 + (seed % 9) * 15,    # 80~200 kWh 基线
            'base_values': base_values,
            'noise_levels': noise_levels,
        }

    def initialize_all(self):
        """为「配置里已有、但没走过添加流程」的设备补齐 OEE / 能源数据。

        本方法曾被重写成只打日志，理由是「设备改为通过前端动态添加」。但模拟模式下
        设备是 SimulatedDeviceManager 直接读 配置/devices*.yaml 加载的，**从不经过
        add_preset_device** → _init_device_data 永不被调用 → OEE 全 0%、能源全 0、
        「总功率 0kW / 碳排放 0kg」，而页面上没有任何报错。
        """
        devices = self.device_manager.get_all_devices()
        device_count = len(devices)
        logger.info(f"模拟模式启动完成: 当前设备数量={device_count}")
        if device_count == 0:
            logger.info("  提示: 设备数量为0，请通过前端添加预设设备或自定义设备")
            return

        preset_by_device = {}
        for p in self.presets:
            did = (p.get('device_config') or {}).get('id')
            if did:
                preset_by_device[did] = p

        inited = skipped = 0
        for device_id, device_config in devices.items():
            preset = preset_by_device.get(device_id)
            sim_params = dict(preset.get('simulation_params') or {}) if preset else {}
            if not sim_params:
                sim_params = self._default_sim_params(device_config, device_id)
            self.device_sim_params.setdefault(device_id, sim_params)

            if self.oee_calculator is not None and device_id in self.oee_calculator.shift_data:
                skipped += 1
                continue

            try:
                self._init_single_oee(device_id, sim_params)
            except Exception as e:
                logger.error(f"  ✗ {device_id} OEE初始化失败: {e}")
            try:
                self._init_single_energy(device_id, sim_params)
            except Exception as e:
                logger.error(f"  ✗ {device_id} 能源初始化失败: {e}")
            inited += 1

        logger.info(f"智能层数据初始化完成: 新初始化 {inited} 台, 已有数据跳过 {skipped} 台")`,
  'replace', 'simulation_initializer.initialize_all')

// 4b. 班次进度 + 运行时间同口径
patch('core/simulation_initializer.py',
  `        # 模拟2小时产量
        hours_running = 2.0
        expected_count = int(theoretical_rate * hours_running)`,
  `        # 模拟班次进度：固定 2 小时会让可用率恒为 2/8=25%，OEE 永远「需改进」。
        # 按 8 小时班的中后段取值，A/P/Q 才落在可解释的区间。
        hours_running = round(random.uniform(5.5, 7.2), 2)
        expected_count = int(theoretical_rate * hours_running)`,
  'replace', 'simulation_initializer.hours_running')

patch('core/simulation_initializer.py',
  "        self.oee_calculator.record_production(device_id, count=actual_count, good_count=good_count)",
  '\n        # 运行时间与产量同口径预置，否则可用率≈0 → OEE 恒 0.07%\n        self.oee_calculator.seed_run_time(device_id, hours_running * 3600)',
  'after', 'simulation_initializer.seed_run_time')

patch('core/simulation_initializer.py',
  "        self.energy_manager.feed_power_data(device_id, current_power)",
  `\n\n        # 预置「今日已累计电量」：单次 feed_power_data 只建积分基线，累计量从 0 起，
        # 页面上就是「总用电 0 kWh、碳排放 0 kg」。按当前时刻折算今日已用电量。
        now = datetime.now()
        hours_today = now.hour + now.minute / 60.0
        self.energy_manager.seed_accumulated(device_id, (baseline / 24.0) * hours_today * 0.9)`,
  'after', 'simulation_initializer.seed_accumulated')

// ---- 5. 去重跳过 Socket.IO ----
patch('core/request_dedup.py',
  "            '/api/auth/logout',",
  `
            # Socket.IO 的 polling 传输天然会在同一秒内对同一路径连发多个 POST
            # （握手、订阅、心跳），且 body 是 text/plain —— 指纹只由「方法+路径+token」
            # 构成，两次请求必然撞车。不排除就会回 409，客户端判为传输失败 → 反复重连
            # → 实时通道整条不可用。幂等性由 Socket.IO 自身的 sid 会话保证。
            '/socket.io',`,
  'after', 'request_dedup.skip socket.io')

// ---- 6. CORS 白名单补 dev server ----
patch('配置/system.yaml',
  "    - 'http://127.0.0.1:5000'",
  `
    # 本地开发（vite dev server）。缺这两条时 engine.io 对 dev 页面回
    # 400 "Not an accepted origin."，实时通道在开发环境永远连不上。
    # 生产版走 file://，不受影响。
    - 'http://localhost:5173'
    - 'http://127.0.0.1:5173'`,
  'after', 'system.yaml CORS 5173')

// ---- 6. 操作日志时间：SQLite UTC → 本地带偏移 ----
patch('用户层/auth.py',
  `            return [dict(row) for row in cursor.fetchall()]

    def _generate_token(self, user: dict[str, Any]) -> str:`,
  `            rows = [dict(row) for row in cursor.fetchall()]

        # operation_logs.timestamp 由 SQLite 的 CURRENT_TIMESTAMP 写入，是 **UTC** 字符串
        # （如 2026-10-23 13:48:42 实为本地 21:48:42）。直接返给前端会被当本地时间，
        # 东八区整体早 8 小时。统一转成带偏移的 ISO8601。
        for r in rows:
            ts = r.get('timestamp')
            if isinstance(ts, str) and ts:
                try:
                    dt = datetime.strptime(ts, '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
                    r['timestamp'] = dt.astimezone().isoformat()
                except ValueError:
                    pass
        return rows

    def _generate_token(self, user: dict[str, Any]) -> str:`,
  'replace', 'operation_logs 时区')

// ---- 7. 写操作前的设备连接检查：别信过期缓存 ----
patch('智能层/device_control.py',
  `        # 2. 设备健康检查
        health = self._device_health.get(device_id, {})
        if health.get('status') == 'disconnected':
            result['allowed'] = False
            result['reason'] = f'设备 {device_id} 通信断开，无法执行写操作'
            return result`,
  `        # 2. 设备健康检查
        #
        #    缓存里的 status 只在 _init_device_health() 里算过一次，而那次发生在
        #    设备**连接之前** → 所有设备永远是 disconnected → 写操作一律被拒
        #    （"通信断开，无法执行写操作"），而同一时刻 /control/status、实时数据、
        #    设备列表全都显示在线。update_device_health() 虽然存在，但全仓库没有
        #    任何调用方，所以这份缓存永远不会被刷新。
        #    写闸门不能信可能过期的缓存：以设备管理器的实时连接状态为准。
        health_status = self._device_health.get(device_id, {}).get('status')
        if self.device_manager is not None:
            try:
                _client = self.device_manager.get_client(device_id)
                if _client is not None:
                    health_status = 'connected' if getattr(_client, 'connected', False) else 'disconnected'
            except Exception as _e:
                logger.warning("写前读取设备 %s 实时连接状态失败，沿用缓存: %s", device_id, _e)
        if health_status == 'disconnected':
            result['allowed'] = False
            result['reason'] = f'设备 {device_id} 通信断开，无法执行写操作'
            return result`,
  'replace', 'device_control 写前实时连接检查')

// ---- 8. 去重指纹：别用 Authorization 前 50 字符 ----
patch('core/request_dedup.py',
  `    parts = [
        request.method,
        request.path,
        request.headers.get('Authorization', '')[:50],
    ]`,
  `    # ⚠️ 原来取 Authorization[:50] —— JWT 的 header 段完全相同（{"alg":"HS256","typ":"JWT"}），
    #    payload 开头也都是 {"username":"...，不同用户的 token 前 50 字符**可能一模一样**。
    #    结果：A 用户刚提交的动作，B 用户在同一 2 秒窗口内提交同样请求会被判「重复提交」返回 409
    #    （实测：四个角色依次调同一接口，后三个全 409，看起来像没权限，其实是去重误伤）。
    #    改用完整 token 的摘要：长度固定、不会撞，也看不出令牌内容。
    _auth = request.headers.get('Authorization', '')
    parts = [
        request.method,
        request.path,
        hashlib.sha256(_auth.encode()).hexdigest()[:16] if _auth else '',
    ]`,
  'replace', 'request_dedup 指纹不再截断 token')

console.log(bad ? `\n有 ${bad} 处锚点未命中` : '\n全部补丁应用成功')
process.exit(bad ? 1 : 0)
