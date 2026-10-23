# 后端修复待合并清单（2026-10-23）

> 背景：`scada-app` 里的 `backend/src/` 是**从 1.3.1089 打包产物反推的源码快照**（原 `_internal/*.py`），
> 不是后端主仓。真正的后端源码仓库是 `C:/Users/cxx/WorkBuddy/Claw/industrial_scada`
> （活跃开发中，round 248→255）。
> 下面这 5 项是**在主仓当前代码里还没修**的问题，当天在快照上验证过；
> 合并时请以主仓为准，不要直接拿 `backend/src/` 覆盖。

勾选状态请对照主仓当前代码复核，主仓可能已被其他轮次修掉。

---

## 1. JSON 时间序列化：本地时间被谎报成 GMT（+8 小时）

**文件**：`展示层/routes.py`

**现象**：接口返回 `"last_trigger_time": "Fri, 23 Oct 2026 18:41:52 GMT"`，
前端 `new Date()` 按 UTC 解析后转本地 → 东八区显示 02:41（次日，未来 8 小时）。
仪表盘「实时报警」、大屏、报警输出全都因此错位。

**根因**：后端大量使用 naive `datetime`（值 = 本地时间，无 tzinfo），
Flask 默认 JSON provider 走 HTTP-date，把它当成 UTC 输出。

**改法**（在 `create_app` 里，紧接 `app.config['SECRET_KEY'] = ...` 之后）：

```python
from datetime import datetime as _datetime, date as _date
from flask.json.provider import DefaultJSONProvider

class _ScadaJSONProvider(DefaultJSONProvider):
    def default(self, o):
        if isinstance(o, _datetime):
            if o.tzinfo is None:
                o = o.astimezone()          # naive 视为本地时间，补出真实偏移
            return o.isoformat()            # 2026-10-23T18:41:52+08:00
        if isinstance(o, _date):
            return o.isoformat()
        return super().default(o)

# create_app 内：
app.json = _ScadaJSONProvider(app)
```

**验收**：`GET /api/alarms/active` 的时间字段应形如 `...+08:00`，不再是 `GMT`。

---

## 2. OEE 恒 0.07%：智能层初始化被架空

**文件**：`core/simulation_initializer.py`

**现象**：工业 4.0 页 OEE 全 0 / 0.1%，「需改进」；能源 0 kWh；碳排放 0 kg。

**根因**：
- `initialize_all()` 被重写成只打日志（注释「设备改为通过前端动态添加」），
  但模拟模式下 30 台设备是 `SimulatedDeviceManager` 直接读 `配置/devices*.yaml` 加载的，
  **从不经过 `add_preset_device`** → `_init_device_data` 永不被调用。
- 即使补了产量，`_init_single_oee` 只 `record_production`、不记运行时间 →
  `availability = actual_run_time / planned` ≈ 0 → OEE ≈ 0.07%。

**改法**：
- `initialize_all()` 遍历 `device_manager.get_all_devices()`，按预设 id 取 `simulation_params`
  （没有预设的用派生默认值 `_default_sim_params`），逐个调 `_init_single_oee` / `_init_single_energy`；
  已在 `oee_calculator.shift_data` 里的设备跳过。
- `_init_single_oee` 里产量与运行时间同口径：
  `hours_running = random.uniform(5.5, 7.2)`（8 小时班的中后段，避免恒 25%），
  并在 `record_production` 后调 `oee_calculator.seed_run_time(device_id, hours_running * 3600)`。

**验收**：启动日志出现「智能层数据初始化完成: 新初始化 30 台」，
`/api/industry40/oee` 平均 OEE 落在 65–80%。

---

## 3. 能源 / 碳排放恒 0

**文件**：`智能层/energy_manager.py`、`core/simulation_initializer.py`

**根因**：`feed_power_data` 的功率积分需要**两次**采样才有增量，进程刚起来时第一次读数只建基线，
`energy_accumulated` 恒为 0 → 「总用电 0 kWh / 电费 ¥0 / 碳排放 0 kg」。

**改法**：
- `EnergyManager` 新增 `seed_accumulated(device_id, energy_kwh, timestamp=None)`，
  按当前电价时段累加进 `energy_accumulated`。
- `_init_single_energy` 末尾按「今日已过小时数」预置：
  `seed_accumulated(device_id, baseline / 24 * hours_today * 0.9)`。

**验收**：`/api/industry40/energy` 的 `total_energy_kwh`、`carbon_emission_kg` 非 0。

---

## 4. Socket.IO 被请求去重中间件误伤

**文件**：`core/request_dedup.py`

**根因**：`_make_fingerprint()` 只在 `request.is_json` 时读 body；
Socket.IO polling 的 POST 是 `text/plain`，指纹退化成「方法+路径+token」完全一致，
2 秒窗口内第二次 POST 必被 409 拦 → 客户端判为传输失败 → 反复重连。

**改法**：`skip_paths` 增加 `'/socket.io'`（幂等由 Socket.IO 自身的 sid 会话保证）。

**验收**：浏览器 Network 面板 `/socket.io/` 无 409；性能监控「已连接」稳定不掉。

---

## 5. dev 环境 CORS 白名单缺 5173

**文件**：`配置/system.yaml` + `展示层/websocket.py` 的 `_load_cors_origins()` 兜底列表

**现象**：vite dev server（5173）页面连 socket 时 engine.io 回
`400 "Not an accepted origin."`，开发环境实时通道永远连不上（生产走 `file://`，不受影响）。

**改法**：origins 增加 `http://localhost:5173`、`http://127.0.0.1:5173`。
（该文件当前有在途改动，合并前先确认。）

---

## 主仓已修、无需重复的项

| 问题 | 主仓修复 |
|---|---|
| 历史查询 UTC/本地错位（选 1 小时永远空） | `展示层/api/api_data.py::_parse_time` 已统一转本机 naive |
| 性能监控 24h 趋势永远空 | `api_performance.append_sample`（round 252） |
| 登出 500 / 预设接口 500 / 6 个指标恒 0 | round 255（be1041d） |
