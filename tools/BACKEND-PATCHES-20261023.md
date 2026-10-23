# 后端补丁：已应用并打包装机（2026-10-23 21:51）

## 结果

后端主仓 `C:/Users/cxx/WorkBuddy/Claw/industrial_scada` 的 **HEAD（be1041d，round 255）**
导出副本 + 下列 6 项补丁 → PyInstaller onedir → 已部署到
`%LOCALAPPDATA%\Programs\smartscada\resources\backend\`，版本 1.3.1091。

**主仓工作区一个字节没动**（那里有另一个实例在活跃开发，当时 5 个文件未提交）。

## 复现步骤

```bash
# 1. 导出主仓 HEAD（不碰工作区）
git -C "C:/Users/cxx/WorkBuddy/Claw/industrial_scada" archive HEAD -o head.tar
mkdir back && tar -xf head.tar -C back

# 2. 打补丁（12 处，锚点未命中会报错退出）
node tools/apply-backend-patches.js back

# 3. 用主仓自带配方打包
printf '1.3.1091' > back/VERSION      # 与 scada-app/package.json 对齐
<venv>/pyinstaller --noconfirm --distpath out/dist --workpath out/work back/scada-backend.spec

# 4. 部署：只覆盖代码，保留 _internal/{data,logs,exports,metrics,配置}
```

venv：`C:/Users/cxx/.workbuddy/binaries/python/envs/scada`（Python 3.13 + 后端依赖 + pyinstaller）。
**不要装 eventlet** —— 两侧统一 `async_mode=threading`。

## 6 项补丁

| # | 文件 | 问题 | 修法 |
|---|---|---|---|
| 1 | `展示层/routes.py` | 本地 naive datetime 被 Flask 序列化成 `... GMT`，前端按 UTC 解析 → 东八区 +8h（报警时间显示成未来） | 自定义 `_ScadaJSONProvider`，输出带偏移 ISO8601 |
| 2 | `智能层/oee_calculator.py` | 预置产量却没记运行时间 → 可用率≈0 → OEE 恒 0.07% | 新增 `seed_run_time()` |
| 3 | `智能层/energy_manager.py` | 单次功率读数只建积分基线 → 累计量恒 0（总用电 0/碳排放 0） | 新增 `seed_accumulated()` |
| 4 | `core/simulation_initializer.py` | `initialize_all()` 只打日志，配置加载的 30 台设备从不初始化 OEE/能源 | 遍历设备按预设参数初始化；产量与运行时间同口径（5.5–7.2h） |
| 5 | `core/request_dedup.py` | Socket.IO polling 的 POST 指纹相同，2s 内被 409 拦 → 实时通道反复重连 | `skip_paths` 增加 `/socket.io` |
| 6 | `用户层/auth.py` | 操作日志 `timestamp` 是 SQLite UTC，前端当本地显示 → 早 8 小时 | 返回前转本地带偏移 |
| 7 | `智能层/device_control.py` | **设备控制完全不可用**：写操作一律被拒「通信断开」，而设备在线、数据在流 | 写前以 `device_manager.get_client().connected` 为准，不信过期缓存 |
| 8 | `core/request_dedup.py` | 去重指纹取 `Authorization[:50]`，不同用户 token 前 50 字符相同 → **不同人互相撞车，409 假「重复提交」** | 改用完整 token 的 sha256 摘要 |

另：`配置/system.yaml` 的 CORS 白名单加 `localhost:5173`（dev server 用；生产走 `file://` 不受影响）。

## 装机验证（2026-10-23 21:52）

| 项 | 结果 |
|---|---|
| `/api/health/status` | 200，version 1.3.1091，4 模块 initialized |
| 智能层初始化 | 日志 `新初始化 30 台` |
| OEE | 22 台设备，平均 70.2%（原 0.07%） |
| 能源 | 2649.13 kWh / ¥3178.95 / 1539.14 kg 碳（原全 0） |
| 登出 | 200 `{"success":true}`（round 255 的修复在） |
| Socket.IO | `Origin: file://` → 200 握手 |
| 操作日志 | 返回带偏移 ISO，不再是裸 UTC |
| 线圈写入 | 修复前 100% 被拒「设备 relay_output_01 通信断开」；修复后 `{"success":true,"verified":true}` |

## 待主仓确认的权限设计（未擅自改）

`PUT /api/config` 的装饰器是 `@role_required('admin', 'engineer')`，即**工程师能改系统配置**；
但 `用户层/auth.py` 的 `ROLES` 里 engineer 的权限只有
`read/write/acknowledge_alarms/export_data/manage_devices`，**没有 `system_config`**。
两者口径不一致。若按 ROLES 的设计意图，应改为 `@role_required('admin')`，
或把配置按 section 分权（工程师可改采集/报警/能源，系统/数据库/日志仅 admin）。
实测矩阵（`tools/perm-audit.js`，4 角色 × 6 操作）当前结果：

| 操作 | admin | engineer | operator | viewer |
|---|---|---|---|---|
| 查看用户列表 | 200 | 403 | 403 | 403 |
| 改系统配置 | 200 | **200（存疑）** | 403 | 403 |
| 写寄存器 | 200 | 200 | 403 | 403 |
| 确认报警 | 200 | 200 | 200 | 403 |
| 急停 | 200 | 200 | 200 | 200 |
| 控制审计日志 | 200 | 200 | 200 | 200 |

## 已知限制（模拟模式，未修）

1. **写入的值会被模拟数据覆盖**：模拟客户端把写入记在 `behavior_simulator._written_coils`，
   但采集链路按 Modbus 寄存器重新打包生成值，`/data/latest` 读到的仍是模拟器产出的值。
   写线圈 1 之后读回可能是 0，几秒后变成 `16256`（0x3F80 = float32 1.0 的高 16 位）——
   uint16 寄存器被 float 位型污染，属模拟器编解码问题。
   **真实设备（Modbus RTU/TCP）不走这条路径，不受影响。**
2. 模拟模式下写操作仍然会改设备状态（线圈 0 = 启停），只是数值回读不可信。


## 维护注意

- 补丁按**锚点**定位。主仓一旦把某处改在别的行/改写措辞，`apply-backend-patches.js`
  会报「锚点缺失」并退出 —— 说明主仓可能已经自己修了那一项，此时删掉对应 patch 段即可。
- `scada-app/backend/src/` 是从 1.3.1089 产物反推的旧快照，**只作参考**，不要用它覆盖主仓。
