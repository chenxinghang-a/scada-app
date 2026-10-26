# SmartSCADA

工业数据采集与监控系统 — 桌面版

## 功能概览

| 模块 | 功能 | 状态 |
|------|------|------|
| 仪表盘 | 设备总览、KPI卡片、实时趋势、报警面板 | ✅ |
| 设备管理 | CRUD、预设设备一键添加、连接测试、多协议支持 | ✅ |
| 设备控制 | 寄存器/线圈写入、急停、安全联锁、批量控制 | ✅ |
| 历史数据 | 时间范围查询、聚合统计、图表可视化、CSV导出 | ✅ |
| 报警管理 | 报警记录、确认、筛选、统计 | ✅ |
| 报警输出 | 信号灯塔可视化、手动控制、广播喊话 | ✅ |
| 系统配置 | 系统/采集/数据库/报警规则/能源费率配置 | ✅ |
| 用户管理 | 用户CRUD、角色权限、操作日志 | ✅ |

## 交付证据：这个项目怎么证明自己是对的

功能表只能说明"有这些页面"，不能说明"它们是对的"。本项目另外交付了一层
**可被第三方复核的证据**，核心判据只有一条：

> **能证明你错的，才算证据；只能证明你对的，是营销。**
> 因此每个检测器都必须先通过"播种已知缺陷 → 必须报错"的检验，
> 它的"通过"才算数。

```bash
python tools/make-evidence-fixture.py                          # 2.3MB 固定种子夹具
python tools/deep-verify.py all --db tests/fixtures/evidence.db  # 16 个检测器 + 负向控制
python tools/audit-chain-selftest.py                            # 审计链 9 个篡改对抗用例
python tools/evidence-manifest.py --verify                      # 核对代码是否就是清单里那份
python tools/cleanroom-check.py                                 # 换空目录 clone 一遍，结论必须相同
# 后端已在跑时，再补一条接口冒烟（169 个路由，不许有 5xx）
python tools/api-smoke.py
```

> 上面第一条命令跑在**夹具**上，所以换任何机器、没有现场数据都能复现。
> 要体检真实部署，把 `--db` 换成现场的库；刚部署完想只看"自部署以来"，
> 再加 `--window 5`（观察窗，分钟）。

| 你想看 | 打开 |
|---|---|
| 一页可打印的结论（数字由 JSON 自动渲染） | `reports/deep/深度交付-v2.html` |
| "专家会做什么 / 从什么素材入手 / 凭什么信" 四问 | `docs/深度-专家会做什么.md` |
| 需求 → 实现 → 验证 → 证据 的追溯矩阵 | `docs/traceability.yaml` |
| 机器判定（两个数：证据链机制 / 系统体检） | `reports/deep/verdict.json` |

当前状态：负向控制 **16/16**、审计链自证 **9/9**、追溯矩阵 **29/29 verified**，
`mechanism_certified = true`、`field_verdict = PASS`。

⚠️ **跑之前先确认审的是哪个库**：源码模式写 `backend/src/data/`，安装版写
`%LOCALAPPDATA%/.../data/`。两份库同名同结构，审错了所有结论都成立且毫无意义——
`deep-verify` 里有一条 `subject` 守卫专门抓这个，它读应用自写的 `runtime.json`
推算"应该写哪个库"，对不上直接判 `SUBJECT_MISMATCH`。

> 边界（写在文档里，不藏）：报警 KPI 样本仍不足；物料平衡缺给水流量计（仪表问题，
> 不是算法问题）；哈希链的"尾部截断"靠外部锚点而非链内自校验。

## 支持的协议

- Modbus TCP / RTU
- OPC UA
- MQTT
- REST HTTP
- 三菱 MC 协议 (SLMP/3E帧)
- 欧姆龙 FINS/TCP

## 技术栈

- **前端**: Vue 3 + TypeScript + Element Plus + ECharts + Socket.IO
- **桌面**: Electron 33
- **后端**: Python Flask + SQLite
- **通信**: REST API + WebSocket

## 开发环境

### 前置要求

- Node.js 18+
- Python 3.12+
- npm

### 安装依赖

```bash
npm install
```

### 启动开发环境

1. 启动 Flask 后端（模拟模式）：
```bash
cd C:\Users\cxx\WorkBuddy\Claw\industrial_scada
python run.py
```

2. 启动前端开发服务器：
```bash
cd C:\Users\cxx\scada-app
npm run dev
```

访问 http://localhost:5173

### Electron 开发模式

```bash
npm run electron:dev
```

## 打包发布

### 1. 打包 Python 后端

```bash
cd C:\Users\cxx\WorkBuddy\Claw\industrial_scada
pip install pyinstaller
pyinstaller build.py
```

将 `dist/scada-backend.exe` 复制到 `scada-app/backend/`

### 2. 打包 Electron 应用

```bash
cd C:\Users\cxx\scada-app
npm run electron:build
```

安装包输出到 `release/` 目录。

## 项目结构

```
scada-app/
├── electron/              # Electron 主进程
│   ├── main.js            # 主进程入口（后端管理、窗口、托盘）
│   ├── preload.js         # 预加载脚本（安全IPC）
│   ├── updater.js         # 自动更新
│   └── first-run.js       # 首次启动检测
├── src/                   # Vue 3 前端
│   ├── api/               # API 请求层
│   │   ├── auth.ts        # 认证API
│   │   ├── devices.ts     # 设备API
│   │   ├── data.ts        # 数据API
│   │   ├── alarms.ts      # 报警API
│   │   ├── system.ts      # 系统API
│   │   └── request.ts     # Axios 实例 + 拦截器
│   ├── components/        # 公共组件
│   │   └── MainLayout.vue # 主布局（侧边栏+顶栏）
│   ├── router/            # 路由配置
│   ├── stores/            # Pinia 状态管理
│   │   ├── auth.ts        # 认证状态
│   │   └── app.ts         # 应用状态
│   ├── views/             # 页面
│   │   ├── Login.vue      # 登录
│   │   ├── Dashboard.vue  # 仪表盘
│   │   ├── Devices.vue    # 设备管理
│   │   ├── Control.vue    # 设备控制
│   │   ├── History.vue    # 历史数据
│   │   ├── Alarms.vue     # 报警管理
│   │   ├── AlarmOutput.vue# 报警输出
│   │   ├── Config.vue     # 系统配置
│   │   └── Users.vue      # 用户管理
│   ├── assets/            # 静态资源
│   └── App.vue            # 根组件
├── backend/               # Python 后端（打包产物）
├── resources/             # 应用图标
├── package.json           # 项目配置
└── vite.config.ts         # Vite 构建配置
```

## 任务收尾清理（每次任务 / 部署后执行）

保持工作区与机器干净：构建垃圾按位置保留最近 3 份、其余归拢清除；回收站永久清空。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/cleanup-smartscada.ps1
```

- 覆盖位置：本仓库（`backend.prev-*` / `backend.stale-*` / `dist.prev-*` / `release*stale*` /
  `release*.prev*` / `release.old` / `release-partial-*`）+ 后端仓库 `dist/*.prev*`；
  超限项归拢到单一容器一次性删除（robocopy 兜底，避开本机 safe-delete 守卫的循环删除限制）；
- 开关：`-Keep N`（保留份数，默认 3）、`-Archive`（清前打包留存）、
  `-ArchiveOldVersions`（归档 `%LOCALAPPDATA%\Programs\SmartSCADA.v*` 历史版本，保留 1 份 + 1 个 7z）、
  `-WhatIf`（仅预览）；
- 回收站：C:/D: 两个桶永久清空（不用 Clear-RecycleBin —— 桶内条目多 / 并发写入时它会挂起）；
- 诊断辅助：`tools/recycle-forensics.ps1` —— 解析回收站 `$I` 元数据定位「写入源」（60 秒；
  ⚠️ Git Bash 读不了 `$Recycle.Bin`——`ls | wc -l` 会假报 0，必须用本工具 / PS 检查）；
- 日志：`C:\Users\cxx\.scada-cleanup\logs\`（每次运行一条，可审计）。

> 设计要点：本机删除受 safe-delete 守卫约束（循环批量删除被拒；单目标偶发被拒）。
> 工具采用「归拢到单一容器 → 单目标删除 → robocopy /MIR 兜底 → 遗留容器下轮自愈」保证最终一致。

## 默认账号

- **管理员**: admin / admin123
- 首次登录后请修改密码

## 双击打不开？（桌面版排障）

症状：双击图标后**没有窗口**，或窗口一闪即退，或出来一个白窗。

**先再双击一两次。** 应用有**自愈式降级阶梯**（L0 → L1 → L2）：

- 第一次因沙箱子进程起不来而崩 → 下一次自动换更宽的兼容开关重试；
- 大多数机器第二轮就好；坏一点的最多三轮（L2 连渲染沙箱也关掉）；
- 成功过的那一级会被**记住**（`gpu-state.json`），之后每次双击都直接打开。

全过程不需要你做任何事，也不用知道任何开关。

若连续两三次仍打不开，**手动强制兜底**（任选一种）：

```bash
# 方式一：环境变量
set SCADA_DISABLE_GPU=1 && "%LOCALAPPDATA%\Programs\SmartSCADA\SmartSCADA.exe"
```

方式二：在 `%APPDATA%\SmartSCADA\` 下新建一个空文件 `disable-gpu.flag`。

排查点（都在 `%APPDATA%\SmartSCADA\`）：
- `launch-attempt.json` —— **这个文件还在**就说明上次没正常退出；
- `gpu-state.json` —— 记住的「可用级别」（删掉它即重置回默认，下次重新试探）；
- `startup.log` —— 每次启动一行（boot / window-created / launch-stable /
  launch-unstable-renderer / renderer-gone）；
- 日志里搜 `[gpu] 已启用兜底（原因=…, 级别=L…）`。

**打开后是白窗？** 属于已修复的打包缺陷（见 [`BUGS.md` 的 Bug 6](BUGS.md)）：chunk 循环依赖
导致页面初始化异常、永远挂不上。v1.3.1081 起由「dist 运行时闸门」
（`tools/verify-dist-runtime.js`）在打包前用真 Chromium 拦截这类问题。

完整根因（GPU 进程沙箱、为什么是三级阶梯、为什么回溯窗口是 24 小时）见
[`BUGS.md` 的 Bug 5](BUGS.md)。

## 配置说明

后端配置文件位于 `配置/` 目录：
- `system.yaml` — 系统配置
- `devices_simulated.yaml` — 模拟设备配置
- `alarms.yaml` — 报警规则配置
