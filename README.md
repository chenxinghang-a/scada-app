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
