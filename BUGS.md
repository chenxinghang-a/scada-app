# SCADA Bug 记录

来源：`industrial_scada` (Flask + Jinja2) 版本
日期：2026-05-31

---

## Bug 1: 登录死循环 🔴 严重

**现象**: 登录后页面频繁刷新，浏览器转圈，反复跳转 login ↔ dashboard

**根因**: cookie 过期后，login 页面验证 localStorage token 成功 → 跳 dashboard → dashboard 的 `check_page_auth` 发现没有 cookie → 跳回 login → 死循环

**位置**:
- `模板/login.html` 第 196-213 行（verify 成功后没设 cookie）
- `展示层/routes.py` 第 111-145 行（`check_page_auth` 检查 cookie）

**修复**:
```javascript
// login.html - verify 成功后刷新 cookie
if (data.valid) {
    document.cookie = `token=${token}; path=/; SameSite=Lax`;  // ← 缺这行
    window.location.href = '/dashboard';
}
```

**关联问题**:
- `.catch()` 中网络错误也清 token → 应该只在服务端明确返回 invalid 时才清
- `connect_error` 事件中 `error.message.includes('401')` 误匹配 → 删除

---

## Bug 2: 设备卡片"网络丢失" 🟡 中等

**现象**: 仪表盘设备卡片显示离线/无数据，WebSocket 状态显示断开

**根因**: 多个 API 请求函数没有 try-catch，网络错误直接崩溃 → 清 token → 跳登录

**位置**:
- `静态资源/js/main.js` — `apiRequest()` 无 try-catch
- `静态资源/js/dashboard.js` — `apiFetch()` 无 try-catch
- `静态资源/js/main.js` — `connect_error` handler 误清 token

**修复**:
```javascript
// main.js + dashboard.js - 加 try-catch
async function apiFetch(url) {
    let r;
    try {
        r = await fetch('/api' + url, { headers: h });
    } catch (e) {
        console.error('Network error:', url, e);
        return null;  // 不清 token，不跳转
    }
    // ...
}
```

---

## Bug 3: WebSocket 推送线程数据库锁竞争 🟡 中等

**现象**: 系统整体卡顿，API 响应慢

**根因**: WebSocket 推送线程每 2 秒对每个设备单独查数据库（N+1 问题），与数据采集器争抢 SQLite 写锁

**位置**:
- `展示层/websocket.py` — `start_data_push_thread()`
- `存储层/database.py` — 所有查询都用 `get_connection()`（会 commit，争写锁）

**修复**:
1. 新增 `get_read_connection()` 方法（不 commit，不争写锁）
2. 新增 `get_all_latest_data()` 批量查询（1 次查询替代 N 次）
3. 所有 SELECT 方法改用 `get_read_connection()`

---

## Bug 4: 401 连锁跳转 🟡 中等

**现象**: 多个 API 同时返回 401 → 多次清 token → 多次跳转 login

**位置**:
- `静态资源/js/main.js` — `apiRequest()` 每次 401 都跳转

**修复**: 加 `isRedirectingToLogin` 防抖标记，2 秒内只跳转一次

---

## Bug 5: 双击图标**打不开**（无窗口 / 闪一下就没了）🔴 严重

**现象**: 双击桌面快捷方式后**什么也没发生**，或窗口一闪即退；
进程退出码是 `0xC0000005` / `-1073741819`（访问冲突）。
`npm run electron:dev` 也一样。

**位置**: `electron/main.js` —— Electron/Chromium 的 **GPU 进程起不来**

**根因**（逐条排除后确认）:

| 试过的做法 | 结果 |
|---|---|
| 什么都不加 | ❌ 崩 |
| `app.disableHardwareAcceleration()` | ❌ **仍然崩**（只关硬件加速不够） |
| `--no-sandbox` | ✅ 有效，但**把整个 Chromium 沙箱都关了**，范围过大 |
| `--in-process-gpu` | ✅ 有效，但改变了渲染架构 |
| **`--disable-gpu-sandbox`** | ✅ **有效且范围最小** → 采用 |

根因是 **GPU 进程的沙箱在该环境里起不来**（受限会话 / 安全策略拦子进程），
不是显卡驱动问题。日志里会出现
`FATAL:gpu_data_manager_impl_private.cc(423) GPU process isn't usable. Goodbye.`

**修复**: **自愈式降级**（`electron/main.js` 顶层，必须在 `app.whenReady()` 之前）

1. 每次启动在 userData 写一个 `launch-attempt.json` 标记；
2. **启动成功**（窗口建好 15 秒后，或正常退出时）删掉它；
3. 下次启动若发现标记**还在**（且是 **24 小时**内的）→
   说明上一次**崩在启动阶段** → **自动**启用 `--disable-gpu-sandbox` + 软渲染。

> ⚠️ 回溯窗口是 **24 小时**，不是几十秒。
> 第一版用 60 秒，结果「今天崩、明天再双击」时标记已过期，
> **自愈在最需要它的时候失效**。正常退出会清标记，
> 所以「标记还在」确实意味着上次没走完正常流程。

**用户不需要知道任何开关：第一次崩，第二次自己就好了。**

### 手动强制兜底（自愈没生效时）

任选一种，**只要存在就强制走软渲染**（原因会打进日志）：

| 方式 | 怎么做 |
|---|---|
| 环境变量 | 设 `SCADA_DISABLE_GPU=1` 再启动 |
| 标记文件 | 在 `%APPDATA%\SmartSCADA\` 下新建空文件 `disable-gpu.flag` |

排查时先看这两个位置：
- 启动标记 `%APPDATA%\SmartSCADA\launch-attempt.json`（**还在 = 上次没正常退出**）
- 主进程控制台输出里的 `[gpu] 已启用兜底（原因=…）`

**相关测试**: `tests/electron/gpu-fallback.test.ts`（9 例）

---

## 迁移计划

将 `industrial_scada` (Flask + Jinja2) 后端整合到 `scada-app` (Vue 3 + Electron)：

1. **保留 Flask 后端** — 已稳定运行，45/45 测试通过
2. **替换前端** — Jinja2 模板 → Vue 3 SPA
3. **API 适配** — 确保 Vue 前端能调用 Flask API
4. **WebSocket 适配** — Vue 前端用 socket.io-client 连接
5. **Electron 打包** — 生产模式直连 localhost:5000

仓库: https://github.com/chenxinghang-a/scada-app
