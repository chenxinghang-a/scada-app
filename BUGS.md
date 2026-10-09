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

**修复**: **自愈式降级阶梯**（`electron/main.js` 顶层，必须在 `app.whenReady()` 之前）

受限环境里的崩溃是一整条谱系，逐级升级（2026-10-09 实测补全）：

| 级别 | 开关 | 实测结果 |
|---|---|---|
| L0 | （默认） | GPU 连崩 9 次（0xC0000005）→ FATAL 秒退 |
| L1 | `--disable-gpu-sandbox` + 软渲染 | GPU 不崩了，但**渲染进程**崩 ×2 → 白窗（还是打不开！） |
| L2 | L1 + `--no-sandbox` | 全链路 0 崩溃 ✅ |

> ⚠️ 只到 L1 是不够的：「窗口建出来 + 主进程活 15 秒」**不等于能用**（页面可以是死的）。

1. 每次启动在 userData 写 `launch-attempt.json`（含**本次级别**）；
2. **启动成功**后删掉它。⚠️ 成功的判据 = 窗口建好 + 稳定 15 秒 +
   **渲染进程没有死在启动阶段**（`render-process-gone` 在稳定窗口内发生 → 不算成功）；
3. 下次启动若发现标记**还在**（且是 **24 小时**内的）→ 说明上次没走完正常流程
   → 在它用的级别上**加一级**重试（0 → 1 → 2）；
4. 某级别成功过一次 → 记进 `gpu-state.json`（**粘性**）→ 之后的启动**直接从该级起**，
   不再重复「崩一轮」。

> ⚠️ 回溯窗口是 **24 小时**，不是几十秒。
> 第一版用 60 秒，结果「今天崩、明天再双击」时标记已过期，
> **自愈在最需要它的时候失效**。正常退出会清标记，
> 所以「标记还在」确实意味着上次没走完正常流程。

**用户不需要知道任何开关：崩过的机器最多经历「崩 → 白窗 → 成功」一轮，之后每次双击都能直接打开。**

> 想回到默认（L0）重新验证：删掉 `%APPDATA%\SmartSCADA\` 下的
> `gpu-state.json` 与 `launch-attempt.json`。

### 手动强制兜底（自愈没生效时）

任选一种，**只要存在就强制至少 L1**（`--disable-gpu-sandbox` + 软渲染；原因会打进日志）：

| 方式 | 怎么做 |
|---|---|
| 环境变量 | 设 `SCADA_DISABLE_GPU=1` 再启动 |
| 标记文件 | 在 `%APPDATA%\SmartSCADA\` 下新建空文件 `disable-gpu.flag` |

排查时先看这几个位置（都在 `%APPDATA%\SmartSCADA\`）：
- `launch-attempt.json` —— **还在 = 上次没正常退出**（内含上次用的级别）
- `gpu-state.json` —— 记住的「可用级别」（删掉它即重置回默认 L0）
- `startup.log` —— 每次启动一行：`boot` / `window-created` / `launch-stable` /
  `launch-unstable-renderer`（渲染死在启动阶段）/ `renderer-gone`（渲染崩溃详情）
- 主进程控制台输出里的 `[gpu] 已启用兜底（原因=…, 级别=L…）`

**相关测试**: `tests/electron/gpu-fallback.test.ts`（16 例，含阶梯与渲染门守卫）、
`tests/electron/gpu-policy.test.ts`（12 例，纯决策层）。

---

## Bug 6: 打包后**白屏**（页面永远挂不上）🔴 严重

**现象**: 应用能打开、窗口标题正确，但**页面全白**，等多久都不出来。
（人眼排查「打不开」时，这最容易被当成「还在加载」而放过。）

**根因**（2026-10-09 用运行时闸门 + 未压缩构建实锤）:
`vite.config.ts` 的 manualChunks 里，`'vue/'` 规则排在 `'element-plus'` 规则**前面** ——
而 element-plus 内部有 `es/utils/vue/**` 这类路径，会被 `'vue/'` 子串截走：

| chunk | 内容 |
|---|---|
| `vendor-vue` | vue 核心 + **element-plus 的 es/utils/vue/\*\*（被误分）** |
| `vendor-element` | element-plus 其余部分 |

→ 两个 chunk **互相 import**（循环依赖）。初始化顺序随之错乱：element 的组件在
**顶层**调用 `defineComponent` 时，vue 的 `isFunction`（`const`，还没执行到声明处）
处于 TDZ：

    Uncaught ReferenceError: Cannot access 'isFunction' before initialization
    (vendor-vue-*.js)

→ Vue 应用初始化抛异常 → `#app` 永远挂不上 → **白屏**。

**修复**: manualChunks 里把 `element-plus` 判断**提到 `vue/` 之前**。
（同类「子串匹配误分」以后照这个思路排查 —— **规则的顺序就是分类的优先级**。）

**守卫**: `tools/verify-dist-runtime.js` —— 用仓库自带 Electron **真跑** dist 页面，
断言 `#app` 挂载成功、无未捕获异常 / 渲染崩溃 / 加载失败。
已接入 `electron:build` 链与 CI（第五道闸门）。
⚠️ 这是本项目**第一道"看像素"的闸门**：verify:dist / verify:asar / 全部单测
可以同时全绿而页面是白的 —— **只有把页面真跑起来才知道**。

---

## 迁移计划

将 `industrial_scada` (Flask + Jinja2) 后端整合到 `scada-app` (Vue 3 + Electron)：

1. **保留 Flask 后端** — 已稳定运行，45/45 测试通过
2. **替换前端** — Jinja2 模板 → Vue 3 SPA
3. **API 适配** — 确保 Vue 前端能调用 Flask API
4. **WebSocket 适配** — Vue 前端用 socket.io-client 连接
5. **Electron 打包** — 生产模式直连 localhost:5000

仓库: https://github.com/chenxinghang-a/scada-app
