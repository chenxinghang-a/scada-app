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

## Bug 7: 首次登录被 403「强改密契约」卡死 🔴 严重

**现象**: 全新安装后，登录页输入 admin / admin123 → 弹「登录失败，请检查用户名和密码」
（看起来像密码错）。实测：**用户根本无法进入系统**。

**根因**: 后端对"首次登录强改密"**有意**返回 **403 + 成功体**
（`status='must_change_password'` + token / refresh_token / user ——
设计如此，让前端拿着令牌去走改密页）。
而 `src/api/request.ts` 的响应拦截器把**所有** 403 一律吞成
「权限不足」并 reject。于是 `authStore` 的归一化、`Login.vue` 的跳转分支、
`/force-change-password` 路由与改密页 —— **全都写好了，却全部接不到**。
（典型「接线断在中间层」：两端都实现了契约，中间一层把它翻译成了错误。）

**修复**: 拦截器对「403 + must_change_password 标记」**原样透传**（返回响应体）；
其余 403 维持原行为（「权限不足」+ reject）。

**守卫**: `tests/api/request.test.ts` 新增回归（403 透传 + 不误报 + 不跳登录）；
原有「403 统一提示权限不足」用例继续钉住普通 403。

**实测**: 真机 CDP 全流程 —— 登录 → 强改密页 → 改密 → 新密码重登 → **仪表盘** ✓。

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

### 事故②（同日第二轮）：socket.io ⇄ vendor-other 的**懒加载时序**白屏

**现象**: 事故①修完后，打包版**仍然**灰白屏（窗口正常、页面永远挂不上），
而开发/测试环境用**同一份字节**反复验证却全绿 —— 一度看起来像"环境玄学"。

**根因**（用打包版故障实例 + CDP 探针抓堆栈实锤）:
- `vendor-socketio` 是被**懒加载视图**（Login/Dashboard/… 都会 import）引入的，
  而 `vendor-other` 由入口 chunk 引入 —— 两者的初始化顺序**随加载时序浮动**；
- 两个 chunk 之间存在**双向依赖**（other→socketio：`Emitter`；
  socketio→other：工具函数）；
- 坏顺序下，TS 编译产物里的 `__extends(Foo, Base)` 拿到 undefined 的 `Base`：

      TypeError: Class extends value undefined is not a constructor or null
      at mt (vendor-other-*.js)      ← mt = TypeScript 的 __extends 帮助函数

- → Vue 应用挂载失败 → 灰白屏。

**修复**: manualChunks 里把 `socket.io` / `engine.io` **并入 `vendor-other`** ——
循环收进 chunk **内部**，由 rollup 保证顺序，任何加载时序都安全。
构建后 chunk 引用图**零环**。

**守卫的诚实说明**: `verify:dist-runtime` 在**开发上下文**里对这类
"懒加载时序"问题**不敏感**（同一份字节：闸门里通过、打包版里必现）——
本次靠"打包版故障实例 + CDP 探针堆栈"才定位。
**补上了**：新增第七道闸门 `verify:packaged-runtime`（`tools/verify-packaged-runtime.js`）
—— 用一次性 userData（不碰 `%APPDATA%`）启动 **`release/win-unpacked/SmartSCADA.exe` 本体**，
CDP 探针断言 `#app` 挂载 + 无渲染层致命错误；已接入 `verify:packaged` 链与 CI。
事故后自检：对修复版 PASS、对"事故期产物"这一类问题可判红（判据覆盖
`Uncaught / TypeError / Class extends / before initialization`）。

**触发条件的补充实测（同日更晚）**: 崩溃与**用户数据状态**强相关 ——
同一份 1082 产物：旧用户数据 → 打包版必崩（`#app=0`）；
清理用户数据后 → 稳定渲染 4/4。中途的清理动作破坏了两组对照样本，
**确切触发项未能最终定位**，证据指向「陈旧缓存参与的加载时序」。

**防御性收口（同轮追加）**: `electron/main.js` 增加**白屏自愈** ——
窗口创建 8 秒后探测 `#app` 是否挂载；没挂上 → `session.clearCodeCaches()`
+ **重载一次**（单次，不循环）；无论成败都写 `startup.log`
（`mount-failed` / `mount-failed-persist`）。就算还有没归零的时序边角，
用户也不会再看到「永远灰白的屏」——而且证据完整可查。

### 事故③（同日第三轮）：echarts 的 charts ⇄ core 循环 —— **登录之后进不了仪表盘**

**现象**: 修复①②④之后，全新安装里：页面正常、登录接口返回 200、会话已落盘、
`ElMessage` 弹出「登录成功」—— 然后 **URL 一动不动**，界面留在登录页，
**最终用户永远进不去系统**（且没有任何可见的报错）。

**定位**（CDP 钩子抓 unhandled rejection）:
- `router.push('/dashboard')` → 仪表盘视图的**懒加载 chunk 链**开始加载；
- 该链里 `vendor-echarts-charts` 与 `vendor-echarts-core` **互相 import**
  （manualChunks 把它们拆开，而图表类型模块与核心模块本来就双向依赖）；
- 懒加载那一刻触发 `__extends` 基类 undefined → unhandled rejection →
  **vue-router 静默中止导航** → URL 不变、无错误提示。

**修复**: `echarts` 与 **`zrender`**（后者路径不含 'echarts'，原会掉进
vendor-other 再被拆一次）全部并入同一个 `vendor-echarts` chunk。
构建后 chunk 图**零环**。

**守卫升级**: `verify:dist-runtime` / `verify:packaged-runtime` **各增加
「仪表盘导航烟测」**：塞一个假会话（路由守卫只看存在性与角色）→ 真跳
`#/dashboard` → 断言导航期间无 `Class extends / Uncaught` 且页面出现
「仪表盘」内容。事故③只发生在**这一步**，只测登录页的闸门对它完全瞎。
（升级后的闸门对"修复前产物"实测判红：`#app=1` 但导航 ok=false。）

---

## Bug 8: 实时数据通道从未连上（socket.io transports 顺序）🟠 中危（功能面）

**现象**: 性能监控页显示「未连接」、数据大屏全 0/0、报警输出停在「同步中」——
实时推送类功能**全部不可用**（页面本身能打开，HTTP 轮询的数据照常显示，所以一直没被注意）。
发现于 2026-10-10 全菜单巡检的副观察项——**三个症状同一根因**。

**根因**: 三处 `io(url, { transports: ['websocket', 'polling'] })`（websocket 优先）。
socket.io-client 会**直奔 websocket**；而本后端（Werkzeug + engine.io threading）
要求**先 polling 握手拿 sid、再升级**，直连 websocket 被服务端 **400
（`Invalid websocket upgrade`）**；且 **client 不降级**（不会退到数组第二个
polling）→ 重连循环里反复 400。

**实测证据**: E2E 全程 socket 请求 = **6 次全 `transport=websocket`+400、0 次 polling**；
`curl` 直接对同一后端做 polling 握手 = **200**（`upgrades:["websocket"]`）——服务端
polling 路径完好，问题在客户端配置。

**修复**: 三处改回 **polling 优先**（`['polling','websocket']` = socket.io 默认顺序；
`Dashboard.vue` / `Screen.vue` / `AlarmOutput.vue`），并注释「别优化回 websocket 优先」。

**守卫**: `tests/socket-transport-order.test.ts` —— 静态扫描 `src` 全部 `transports:`
数组，断言**首位不得是 websocket**；+ 三视图正向对照（存在、有 io(、polling 开头）。
变异验证：任一改回 websocket 优先 → 2 例全红（精确报出文件与值）。

**实测（修复后）**: dist 探针（真实前端 + reload 携带会话）→ 部署版后端日志出现完整
序列：`polling 握手 200 → 数据帧 POST 200 → 长轮询 GET 200 → …` —— **实时通道建立** ✓
（功能面完整复核（订阅数据显示）并入 1084 的 E2E + 全菜单巡检。）

**观察项（后端侧，非本缺陷）**: polling 稳定后未观察到 websocket 升级请求
（可能被服务端拒绝后静默保持 polling——功能等价，不影响可用性；`simple-websocket`
是否在 frozen 环境真正生效值得二号机侧看一眼）。

---

## Bug 9: 构建窗口内工作区被改动 → 污染产物（**闸门体系盲区**）🔴 严重（信任链）

**现象**: v1083 打包产物里混进了**后端 round 210 的部分改动**——
`config_manager.py` / `system.yaml` 是新版、`data_collector.py` 却是 HEAD 旧版。
即同一批改动「一半进了一半没进」，产物处于**源码任意中间态**。

**根因**: `PyInstaller` / `electron-builder` 收的是**工作区快照**、**不是 git HEAD**。
本机 `npm run electron:build` 期间（约 5 分钟窗口），**另一个 AI 会话往后端仓库落盘了** →
冻结的就是那个瞬间的工作区。

**为什么七道闸门一道都没拦住**: 它们全部只管「**产物内部**的一致性 / 可用性」——
`verify:staging`（暂存是不是后端源码的产物）、`verify:dist`（dist 引用完整性）、
`verify:asar`、`verify:version`（前后端版本一致）、`verify:backend-runtime`（产物能否跑）、
`verify:packaged-runtime`（打包版能否挂载）。
**没有一道管「构建过程本身有没有被污染」** —— 这是一个体系级的盲区，
不是某道门写漏了。

**实测证据**: `.vitest_cache/` 下逐文件 `diff -q` 对账 —— 三个文件里一个旧两个新，
最终判定「功能安全」（新版那两处是死代码 / 零读取点，行为等价 HEAD），但**结论靠人工**。

**修复（第八道闸门，2026-10-11）**: `tools/verify-workspace-frozen.js` ——
**双时刻工作区断言**：构建**前**拍基线、构建**后**比对，三条判据各自独立：

| 判据 | 命令 | 抓什么 |
|---|---|---|
| ① HEAD 变化 | `git rev-parse HEAD` | 构建窗口内提交 / 切分支 |
| ② 文件清单变化 | `git status --porcelain` | **未跟踪新文件** / 新增删除 / 重命名 |
| ③ 正文哈希变化 | `git diff HEAD` 的 sha256 | **porcelain 行不变、只有内容被改**（本次事故的精确形态） |

**⚠️ ②③ 必须同时存在** —— 这是本闸门自测时实锤发现的：
`git diff HEAD` **只看已跟踪文件**，未跟踪的 `??` 完全不出现，
只比哈希会**漏掉「构建中新建一个 .py」**（而 PyInstaller 恰恰会收它）；
只比 porcelain 则漏掉「改一个已修改文件的正文」（行仍是 ` M`）。

**接线**: 三处，覆盖本机两个入口 + CI（2026-10-11 补 CI 一处）：
- `npm run electron:build:frozen`（pre → 原链 → post）；**原 `electron:build` 不动**，不打断既有用法
- 本机脚本 `tools/run_electron_build.py` 构建前后调闸门，污染时**退出码 3**
  （区别于「构建失败 1」）—— 包已产出但**不可信，禁止部署**
- **CI**（`.github/workflows/ci.yml` 的 `electron-build` job）：`--pre` 放在
  backend checkout 之后、`--post` **紧跟 `Build NSIS installer`**。
  CI 虽是全新 clone，但该 job 从 checkout 到打包之间有约 10 个步骤
  （PyInstaller、两次 `npm ci`、build、三组测试、dist 验证……），
  任何一步意外改了被跟踪源码，都会让**打包进去的源码 ≠ checkout 出来的源码**，
  而下游七道闸门同样看不见。有守卫测试断言 pre/post **夹住**打包步骤、
  且 post 不带 `continue-on-error` / `if:`（防退化成"只打日志的提醒"）。

**守卫**: `tests/tools/verify-workspace-frozen.test.ts`（17 例，含 2 例自指污染 +
候选列表与 `verify-staging.js` 的一致性绑定 + 3 例接线守卫）。
变异验证：① 去掉 porcelain 判据 → 未跟踪文件用例精确红；② 去掉自产物剔除 → 自指用例红；
③ 把 CI 的 post 移到打包之前 → 「夹住」用例精确红。

**自指污染（首版缺陷，自测抓出）**: 首版闸门把自己的基线文件
（`.vitest_cache/workspace-frozen-state.json`）当成了「新出现的污染文件」——
`--pre` 写基线那一刻才建出该目录，`--post` 就多出一行 `?? .vitest_cache/`。
真实仓库靠 `.gitignore` 恰好盖住，但**闸门的正确性不该外包给别人的配置文件** →
已在源头按路径前缀剔除（只剔 `.vitest_cache/`，其它未跟踪文件照抓）。

**基线时效检查（2026-10-11 补，防「过期参照物给出误导性判词」）**:
`--pre` 与 `--post` 本该只隔一次构建（几分钟）。若基线是几小时前的，
说明那次构建**没跑成**（崩了/被中断/忘了配对），此刻的 `--post` 是在拿**过期参照物**比对。
实测：`--pre` 后有人提交了一个**合理**的新 commit，旧版判词是
「**构建窗口内**有人提交/切换了分支」——而真实原因是「基线是上一次的」。
**错误的报因比没有报因更贵**：它会让人去查一个不存在的问题。

- 基线超阈值（默认 30 分钟，`SCADA_FROZEN_MAX_AGE_MS` 可覆盖）**且检测到差异** →
  判负，但判词改为「基线**已过期** —— 本次比对**结论不可信**」，
  并明确区分「可能只是工作区自然演进了」，不冒充「窗口内污染」的结论。
- 基线超阈值**但两边恰好一致** → 放行，但**显式留痕**「基线较旧，保证弱于新鲜基线」，不静默通过。

**已明确的盲区（写在脚本注释里，不假装能防住一切）**:
`.gitignore` 覆盖的文件被改 → 指纹不变；构建工具自写的中间产物（`dist/` / `release/`）
不参与指纹（**必须**如此，否则每次必红）；探测不到后端仓库时**显式降级**并留痕；
**中间污染又还原**（改完再改回来）原理上抓不到 —— 这是所有快照法的固有限制。

---

## Bug 10: 闸门自己把产物弄脏 —— 打包探针从不清理、冒烟留空壳自洽循环 🔴 严重（发布面）

**现象**: `release/win-unpacked/resources/backend/_internal/data/` 里出现
`scada_simulated.db`(180KB) + `.db-shm` + `.db-wal`(873KB) + `runtime.json`
+ `diagnostics/` + `queue/`，其中还有一个 `scada_simulated.db.navtest-copy-20261010`。
**这些是探针跑出来的运行期垃圾，不是构建产物。**

**为什么危险**: 该目录**会被 electron-builder 打进安装包** ——
`package.json` 的 `extraResources` 是 `from: backend/ → to: backend/`，
filter 只排了 `*.log` / `logs` / `exports` / `__pycache__` / `*.pyc`，
**没有排除 `data/`**，而 electron-builder **不看 `.gitignore`**。
所以「模拟数据库 + WAL + 上一次的端口文件」会**装到用户机器上**。

**根因（两条同族缺陷，都属「闸门报 PASS 但产物被弄脏」）**:

1. **打包探针 `verify-packaged-runtime` 完全没有清理机制**（对照：冒烟闸门有
   `snapshotTree` / `cleanupCreated` / `cleanupUntilClean` 一整套）。
   它真启动 `release/win-unpacked/SmartSCADA.exe`，而后端把自己的运行期状态
   写在 **exe 旁边**（`electron/main.js` 用 `spawn(exe, [], {cwd: dirname(exe)})`，
   后端 `paths.py` 取 `_BASE = exe_dir/_internal`）。
   构建链顺序是「electron-builder → verify:packaged-runtime」→
   **下一次打包会带上上一次探针跑出来的垃圾**。

   ⚠️ **`--user-data-dir` 隔离救不了这条**：那是 **Electron 的口径**，管的是
   应用的 userData；后端是**独立进程**，它比的是 `exe_dir/_internal`。二者的
   隔离边界根本不是同一个东西 —— 这一条是最容易误判的地方。

2. **冒烟闸门自己留空壳，形成自洽循环**。清理纪律「只删本次新建的」本身**正确**
   （哪天发布配置真的随包带预置 `data/`，按名字硬删会误伤产物）。但它有个循环洞：
   第一次冒烟把文件删干净后会**留下空目录**（这一轮它已算「既有」），
   下一轮它在 `before` 快照里 → **永远不再被清除**。
   而 `runtimeNewFiles` **只统计文件**，空目录对 `leftover` 判据是**隐形**的
   → 闸门照样报 `[PASS]`，空壳随着安装包发出去。

**实测复现**:
- 删掉 `release/win-unpacked/.../data/` 后跑一次打包探针 →
  它带着 `scada_simulated.db`(4096B) + WAL + `runtime.json` **原地重建**。
- 冒烟闸门：**从干净基线**跑一次 → 跑完目录不存在（干净）；
  但只要 `backend/_internal/data/` 空壳**存在过一次**，往后每轮都留着它。
- 反向核对：用 7-Zip 拆开已发布的 `smartscada-Setup-1.3.1083.exe`，
  内层 `app-64.7z` 里 `resources/backend/_internal/data` **条目数为 0** ——
  说明 1083 那一次是**人工清理过**的，不是链路保证的。**这就是缺陷的本质：靠人。**

**修复（2026-10-11）**:
- 打包探针接入冒烟闸门那套「快照求差 → 只删本次新建 → 独立复核」，
  在 `finally` 里执行；**清理不干净 → `process.exitCode = 1`（fail-closed）**。
  跑前不存在的目录，跑完必须**整个消失**（连空壳都不留）；
  跑前存在的内容（预置文件）**原样保留**。
  新增 `--keep-artifacts`（仅供排查，默认永不保留）。
- 冒烟闸门新增 `removeEmptyRuntimeDirShells()`：对**已知会被后端接管**的
  运行期目录（`_internal/data`）在**确认为空**时删壳。
  **非空一律不碰** —— 那要么是预置内容，要么是删不掉的残留（后者交给 `leftover` 判据）。

**守卫**: `verify-packaged-runtime.test.ts` 14 → **18 例**；
`verify-backend-runtime.test.ts` 39 → **42 例**。
变异验证三态齐全（绿 → 红 → 绿，两处各一轮）。

**⚠️ 一条方法论教训（本轮实锤）**: 打包探针的第一版守卫**只做「源码里有这几个字」的
文本断言**（`expect(CMD).toContain('cleanupUntilClean')`）——
把 `cleanupUntilClean(...)` 调用换成常量 `{leftover: []}` 后**变异存活**：
文本断言照样全绿，而缺陷一点没被拦住。
**「函数名出现在源码里」不等于「它会被调用」更不等于「调用是有效的」。**
凡断言的是「某种行为」，就必须**真建树、真调函数、真断言结果**。

**第四个落点（同日自查发现，提交 `c461f13`）**: 顺着「探针不得在机器上留痕」
这条线把**所有闸门**做了一遍对称性审计（`spawn` 数 vs `cleanup` 数），发现
`verify-dist-runtime` 也是「起进程但不清理」——**但性质不同**：

它 `loadFile(dist/index.html)`，**从不启动后端**，所以不会碰 `_internal/data/`
（产物面是干净的）。真正的问题是另一条：它为做仪表盘导航烟测会往 localStorage
塞假会话（`auth_token` / `scada_user`），而它**从未定向 userData** ——
该检查脚本也没有 `app.setName()`，于是 Electron 用默认名，把这些写进
**共享的** `%APPDATA%/Electron`（实测存在，2.6MB，含 `Local Storage` /
`Session Storage`）。

危害两条：① 污染开发机（非交付面，但每次跑都往同一个共享 profile 里塞东西）；
② **运行不孤立** —— 上次残留的 localStorage 会影响下次判定，
正是本仓库最忌的「跑第一次绿第二次红」。

修法：加 `--user-data-dir`，每次跑用独立的
`.vitest_cache/dist-runtime/userdata/run-<ts>-<pid>`（与 `packaged-runtime` 对齐）。
实测：跑一次后 `%APPDATA%/Electron/Local Storage` 的 mtime **完全未变**。

⚠️ **同一个坑又踩了一次**：这里第一版守卫还是 `toContain('--user-data-dir')` ——
而那个字符串在**注释**里也出现 → 删掉真实用法后**变异存活**（全绿）。
改为把断言**限定在 `spawnSync` 的实参列表内**（`--user-data-dir=${userDataDir}`）
后变异精确红。**教训升级版：即便断言的是「用法」，也必须限定在「它真被用的那个位置」，
不能是「文件里出现过」。**

**审计结论**（三道起进程的闸门全部对齐）：
| 闸门 | 起进程 | 产物面清理 | userData 隔离 |
|---|---|---|---|
| `verify-backend-runtime` | ✅ | ✅（含空壳） | n/a（不起 Electron） |
| `verify-packaged-runtime` | ✅ | ✅（本次新增） | ✅ |
| `verify-dist-runtime` | ✅ | n/a（不启后端） | ✅（本次新增） |

---

## Bug 11: 守卫把「构建链路的合法产物」误判成「测试污染」🔴 严重（CI 发布链阻断）

**现象**（2026-10-11）: `electron-build`（windows-latest）**连续 5 笔红**，
而 `build-and-test`（ubuntu-latest）**恒绿**；失败恒在第 12 步 `Unit tests`（exit 1），
导致后面 13–20 步（含版本一致性闸门、asar 校验、打包探针）**全部 skipped**
→ **v1087 打不了包**。

**排查（关键突破 = 不再靠猜）**: 匿名拿 job log 是 403，改用
`git credential fill` 取 40 字符 token → GitHub REST API 拉 run/job/log，一次拿到确切用例名：

```
× 测试自身不得污染真实仓库（首版就是这样被自己污染的）
  > 真实仓库的 .vitest_cache 下不该留基线文件（测试跑完必须干净）
  → 测试污染了真实仓库：D:\a\scada-app\scada-app\.vitest_cache\workspace-frozen-state.json 应不存在
```

**根因**: `tests/tools/verify-workspace-frozen.test.ts:515` 的守卫断言
「真实仓库 `.vitest_cache/workspace-frozen-state.json` **必须不存在**」。
但 CI 的 `electron-build` **步骤 3** 就跑 `verify-workspace-frozen.js --pre`
（`ci.yml:93`）—— 它**合法地**创建了这个基线文件；测试在**步骤 12** 才跑。
**此时文件存在是对的。我的断言把「文件在不在」等同于「测试污不污染」，等式不成立。**

同一套件两个 job 结果不同 → 差异**只可能在 job 前置步骤**（这个线索是对的），
但「ubuntu vs windows 差异」「裸 require 在 ESM 下失效」两条假设**实测被证伪**。
真正的差异是：**只有 `electron-build` 在测试之前跑过 `--pre`**。

**修法**: 把判据从「文件此刻在不在」改为「**测试**有没有让它从无到有 / 有没有改过它」——
导入期记录 `realStateExistedBefore` + `realStateMtimeBefore`，守卫分两支：
① 之前不存在 → 跑完必须仍不存在；② 之前已存在 → 跑完不得消失、**mtime 必须未变**。

**变异验证三态齐全**（两轮，都精确红到对应分支的报错文本）：
* 变异 ①（测试真往真实仓库写基线文件）→ 红：`被从无到有创建了`
* 变异 ②（测试改写既有基线文件）→ 红：`mtime 由 ... 变为 ...`
* 还原后 → 绿。另单独模拟「CI 场景：state 文件预先存在」→ **24/24 全绿**。

⚠️ **踩坑**：变异 ② 第一版用 `appendFileSync(..., "")`（空内容）——
Node 在 Windows 上写空内容**不更新 mtime** → 变异**存活**（假绿）。
换成 `writeFileSync` 真内容才红。**教训：变异本身也要确认它真的改变了被测的行为**。

**方法论教训（本族第 3 次）**：判据与意图之间隔一层，是**已经成型的缺陷类别**——
* Bug 10：判「有文件残留」，真意图是「产物目录干净」→ 空壳目录隐形
* Bug 10 支线：判「函数名在源码里出现」，真意图是「函数真被调用」→ 文本断言变异存活
* **Bug 11（本条）**：判「文件不存在」，真意图是「测试没制造污染」→ 合法产物被误判

**守卫**: 用例从「断言状态」升级为「断言**因果**」：
不再问「现在存在吗」，而是问「**是测试让它变的吗**」。

**后续（同日，可观测性补强）**: 本轮排查的最大摩擦是「**CI 红了看不到是哪条**」——
匿名拿 job log 是 403、vitest 默认 reporter 又把失败用例名折进汇总，只能靠猜。
两处补强（提交与 Bug 11 同批）：
1. `Unit tests` 改 `npm test -- --reporter=verbose 2>&1 | tee unit-tests.log`
   （`set -o pipefail` 保留 fail-closed，`tee` 不吞退出码）；
2. 新增 `.github/scripts/emit_unit_test_failure.py` + `if: failure()` 步骤，
   把失败用例名 / 断言消息发成 **annotation**（与 electron-builder 那步同款，
   公开可读、无需 admin）。

**⚠️ 补强里又踩了同一个坑（第 4 次）**：`gate-parity.test.ts` 的守卫首版写
`expect(text).toContain('--reporter=verbose')` —— 而该字符串**在上方注释里也出现**，
删掉真实用法后**文本断言照样绿**（变异实测）。改为把断言**限定在 `run:` 命令行**后精确红。
四条变异全部精确捕获（去 verbose / 去 pipefail / 去 `if: failure()` / 破坏换行转义）。
**本族已 4 次**：凡文本断言，都要问「这串字符会不会在**别处**也出现导致假绿」。

---

## Bug 12: 真起子进程的用例吃默认 5s 超时（CI 2 核满载假红）🟠 中危（测试基础设施）

**发现（2026-10-12）**：`verify-staging.test.ts` 里 **10 个**真起 node 子进程的
用例**全部没有显式超时** → 吃 vitest 默认 5s。本机（4 核）单用例实测
334~877ms —— 而 **CI runner 只有 2 核**，并行满载时耗时 2~3 倍 → 逼近甚至
超过 5s。表现为**偶发假红**（不确定、难复现、每次都要人肉排查）。

**为什么本地永远绿**：
CI runner 只有 2 核这一事实**在任何本地运行里都看不见** —— 本地 4 核跑得
飞起、CI 2 核才崩。这类缺陷**只在 CI 偶发**，且复现困难，是最耗人的一类。

**这是本族第 3 次**（每次同一个形状）：
1. `cleanupUntilClean` 满载并行超 5s；
2. 批量给 12 个起子进程的用例补 30s；
3. 本轮 `verify-staging.test.ts` 又是默认 5s（且 `verify-version-coherence.test.ts`
   也扫出 8 个）。

**修法（两层）**：
1. **补数据**：给 `verify-staging`（10 个）+ `verify-version-coherence`（8 个）
   的真起进程用例加 `}, 30000)`；
2. **根治**：新增 **元守卫** `tests/tools/timeout-discipline.test.ts` ——
   扫**全仓** `tests/**/*.test.{ts,js}`，凡 `it` 块内出现"真起进程"调用
   （`spawn(`/`spawnSync(`/`execFile(`/`execFileSync(`/`execSync(`/`child_process`/
   `await run(`/`await runWithEnv(`/`await runCmd(`）**必须**带显式超时参数。
   这样**新增用例的人不用再"记得加"** —— 不加就红。

**元守卫自身的两个坑（实现时踩）**：
- **超时判据的位置**：超时数字落在 `it(...)` 参数内容的**尾部**（`matchParen`
  从 `it(` 配对到整个调用的右括号），不是 `closeParen` **之后**。
  第一版写成 `tailAfterCall` → 全部用例被判"无超时"（含已加超时的）→ 34 条假阳性。
- **自指假阳性**：守卫用**合成夹具**测自己的判别力，夹具把被测源码写成**模板
  字符串**（含 `await run(` 形状）→ 扫自己时把夹具误判成违规。
  修法：① `spawnsProcess` **先剥字符串字面量**（真实代码的 `spawn` 在字符串**外**，
  剥了不影响）；② 扫描时**排除自身文件**（守卫自己的代码不产生"真起进程的用例"）。

**变异验证（三态）**：把 `verify-staging` 某个用例的 `, 30000` 去掉 →
元守卫**精确红**到那一条；还原 → 全绿。判别力自检另含 6 例合成夹具对照
（起进程+无超时→报 / 起进程+有超时→不报 / 不起进程→不报 / 注释里的 spawn→不报 /
本地包装→报 / 字符串里的括号不破坏解析）。

---

## Bug 13: 闸门体系缺「实时通道」这一层的验证（健康绿 ⇒ 不出发通道绿）🟠 中危（闸门盲区）

**发现（2026-10-12）**：八道闸门里，**没有任何一道**在打包产物上验过
**socket.io / engine.io 握手**。`verify-backend-runtime.js` 只探
`/api/health/status`（普通 HTTP 路由），`verify:packaged-runtime` 只验窗口/页面。
而这两条路径**读的是两份不同配置**：

| 路径 | 走哪 | 读哪份配置 |
|---|---|---|
| `/api/health/status` | 普通 HTTP 路由 | Flask-CORS |
| 实时通道 | socket.io / engine.io | `web.cors.origins`（`展示层/websocket.py::_load_cors_origins()`）|

**历史证据（这层出过两次事，两次健康端点全程绿）**：
- **Bug 8**：transports 顺序 → 实时通道从未连上；
- **1087 头号缺陷**：origins 不含 `file://` → 打包版（file:// 上下文）握手被拒 400，
  而**健康端点照样 healthy、页面照样挂载** → 前端**静默无实时数据**
  （性能监控 / 数据大屏 / 报警输出全废）。

**危害形状**：这是典型的 fail-open 盲区 —— 「健康绿 + 页面挂载绿」被当成
「能用」的充分条件，但它**推不出**实时通道可用。用户界面上看不出异常
（除非盯着数值不动）。

**修法**：`verify-backend-runtime.js` 新增**阶段二点五** —— 对打包产物发一次
真握手：
- **①** `Origin: file://` → 必须 HTTP 200（无 `"not an accepted origin"`）；
- **② 反向对照**：非白名单 `Origin: http://evil.example.com` → 必须被拒
  （HTTP 400 / 带拒绝串）。

**为什么 ② 缺一不可**：没有它，①的"通过"可能只是 **CORS 被全开** ——
那是把闸门**拆掉**，不是修好。②是①的判别力保证。

**测试夹具的坑（关键）**：原先的假后端是个**对任何路径、任何 Origin 都回
同一 payload** 的纯 HTTP server。新探测一装上就**必然误伤** ——
即使把白名单模拟对了，只要夹具对 evil Origin 也回 200，反向对照就恒红。
更隐蔽的是反面：这种夹具会让「白名单被改成全开」这个**真缺陷**测不出来。
修法：夹具按真后端契约实现 Origin 白名单（默认 `file://,localhost,127.0.0.1`，
`FAKE_SOCKET_ORIGINS=*` 可模拟全开）。

**变异验证（三态，`.vitest_cache/mut-socket-probe.cjs`）**：
- 架空 ①（`if (false && …)`）→ 「白名单缺 file://」例**精确红**；
- 架空 ② → 「全开 `*`」例**精确红**；
- 还原 → 45/45 绿。**两条判据各自承重、互不掩护。**

**范围**：新增 3 例 + 修 4 例被误伤的既有用例（夹具忠实模拟后自愈）；
全量 673 passed（38 files）。

**残留（交给后端仓库）**：本闸门只验「打包产物侧」的握手形态；
`web.cors.origins` **配置本身**的正确性（默认值是否含 `file://`）由后端仓库的
`tests/test_websocket_cors_origins.py` 守 —— 两边互补，不重复。

**⚠️ 还原失误（值得记）**：变异后我用 `git checkout -- <file>` 还原，
但这个文件的超时添加**还没 commit** → `git checkout` 直接回退到 **HEAD 版**，
把 10 处超时全丢了。教训：**未提交的工作区改动，不要用 `git checkout --` 还原
变异** —— 要么先 commit，要么用"反变异脚本"（把改动再改回去）。

---

## Bug 14: `tools/` 下的闸门脚本没有任何「可达性」守卫（**死闸门盲区**）🟠 中危（闸门体系自身）

### 现象
仓里已有 `api-wiring` / `component-wiring` / `ipc-wiring` 三族接线守卫，
**但它们只覆盖 `src/api`、`src`、`electron/`**。`tools/` 目录下那 8 道
`verify-*.js` 闸门脚本 **零守卫**：

- 把 `electron:build` 链上某个 `node tools/verify-xxx.js` 步骤删掉 →
  测试全绿、CI 全绿，**没人发现这道闸门已经不上线了**；
- 新写一道 `tools/verify-yyy.js` 却忘了挂进 `package.json` →
  **写了等于没写**（死闸门），同样无人报警。

### 根因
测试体系盘点是靠**人工分析**确认"8 道闸门都接线且 CI 可达"的结论 ——
**结论正确，但没有自动化守卫把这条纪律钉死**。任何一次重构改动
`package.json` / workflow 都可能静默摘掉一道闸门。

### 修复
新增 `tests/tools/gate-wiring.test.ts`（**10 例**），五条判据：

| 判据 | 内容 |
|---|---|
| ① | `tools/` 下每个 `verify-*.js` 都必须能从 `electron:build` 链**走到**（递归解析 `&&` 串接的 `node tools/*.js` 与 `npm run` 嵌套） |
| ② | 本地可达的闸门，**CI workflow 也必须可达**（防「本地测得上线漏」，与 `gate-parity.test.ts` 的 CI→本地方向互补） |
| ③ | **判别力自检**：合成一道孤立闸门 → 必须判「不可达」（防守卫自身恒绿） |
| ④ | **反向完整性**：链上引用的每个 `node tools/*.js` 都**必须真实存在**（查「链→文件」方向）—— 见下方「④ 的由来」 |
| ⑤ | **孤儿脚本**：脚本位置（根目录 / `scripts/` / `.github/scripts/`）下每个脚本都必须被某处引用（npm script / CI / 测试 / 源码），或列入 `ONE_SHOT_GENERATORS` 豁免表 —— 见下方「⑤ 的由来」 |

### ④ 的由来（自我发现：① 装好后仍有一处盲区）
① 只回答「**存在的** `verify-*.js` 有没有人跑」，**查不出**「链上引用的文件在不在」。
实测：把 `verify:dist` 改成 `node tools/verify-dist.js && node tools/verify-typo-does-not-exist.js`
（原有 8 道全在，只多一条悬空引用）→ **判据①装好后仍 5/5 全绿**。
这意味着「文件名写错 / 文件被改名后忘了同步 `package.json`」这类**引用落空**
是①的盲区。故补 ④：递归展开链取**全部** `node tools/*.js` 引用（不限 `verify-` 前缀），
逐个断言文件存在，不存在的精确点名；并配 ④b 判别力自检（合成真闸门 + 悬空引用
→ 必须两条都收进来、悬空那条必须判 missing）。

### ⑤ 的由来（同一盲区的另一半：`scripts/` 及其它脚本位置）
①~④ 全部只覆盖 `tools/`。`scripts/` 目录**没有任何可达性守卫** ——
跟踪在册、看着像"工具"、却没人调用的脚本，不但是死代码，还会**误导后人以为它在生效**。

**实测命中**：`scripts/generate-api.ts`（round 53 引入，4+ 个月前，自称"自动生成 API 客户端"）：
- 输出 `src/api/auto-generated.ts` —— 该文件**从未被提交、也不在 `.gitignore`**（生成过又删了？还是从没跑过？）；
- `src/` 与 `tests/` 里**零引用**；
- 连它自己文档写的 `npx ts-node scripts/generate-api.ts` 都**跑不起来**（`ts-node` 不在任何依赖里）；
- 硬编码的端点清单**早于**现有 `src/api/*.ts` 手写类型层。

→ 死代码生成脚本。按本仓纪律**删除文件**（`git rm`），而不是登记成"已知孤儿"。

**广义化（第二轮）**：⑤ 首版只扫 `scripts/`，同一盲区漏了一半 ——
根目录的 `generate_icons.py`（跟踪在册、零引用）与 `.github/scripts/` 都没覆盖。
故把扫描位置扩到 **根目录 + `scripts/` + `.github/scripts/`**。

⚠️ **广义化踩到的第一个坑（假阳性）**：根目录若也认 `.ts/.js`，会把
`vite.config.ts` / `vitest.config.ts` 当"脚本"报孤儿 —— 它们是**工具配置**
（由 vite/vitest **隐式加载**，没有任何地方按名字引用）。修法：**根目录只认
`.py/.sh/.bat/.cjs/.mjs`**；子目录才认 `.ts/.js`。这也是一条通用启发：
**"是否被引用"这个判据，对"被约定隐式加载的配置文件"不成立** —— 判据要按资产类别裁剪。

**一次性生成器豁免表（`ONE_SHOT_GENERATORS`）**：`generate_icons.py` 与 `generate-api.ts`
不同 —— 它的产物 `resources/icon.ico` 等**确实入库且在生效**，脚本本身是
"改图标设计时手工重跑一次"的工具。删掉它反而丢失"怎么重新生成图标"的知识。
故增设窄例外：豁免条目**必须写 `why`**（说清为何无需被引用），且 **⑤c 守表本身**
（不得含已不存在的文件 —— 防豁免表积累成垃圾场）。

### ⚠️ ⑤ 实现中自己踩到并修掉的一个真陷阱
首版 ⑤ 装好后**竟然 9/9 全绿**（假绿！）—— 排查发现 **`generate-api.ts` 没被报出来**。
根因：**审计工具的说明文字会回喂给它自己的判据** ——
本守卫的注释里写了"本仓实测发现 `scripts/generate-api.ts`"，而 ⑤ 的"引用者文本"
扫描了 `tests/` 目录（含本守卫文件），于是**它自己把自己的点名当成了"有人引用"**
→ 真孤儿被静默放过。
修法：`collectSourceText` **排除本守卫文件自身**。

> **通用纪律**：审计/守卫工具**不得把自己的输出或说明回喂进自己的判据** ——
> 否则"我提到了它"会被误判成"它被引用了"，正是二号机 #99 说的
> **「通过得不是因为它对」**的同族。这条与「自指污染」（第八道闸门基线把自己写的
> 文件当成污染）是**镜像关系**：一个是"把自产物当污染"，一个是"把自叙述当引用"。

### 变异三态验证
| 变异 | 结果 |
|---|---|
| 塞入合成死闸门 `tools/verify-deadgate-mut.js` | **①精确红**并点名该文件（其余仍绿，定向） |
| 链上多串 `node tools/verify-typo-does-not-exist.js` | **④精确红**并点名（其余仍绿，定向） |
| 塞入合成孤儿 `scripts/orphan-mut-probe.ts` | **⑤精确红**并点名（其余仍绿，定向） |
| 根目录塞 `orphan_root_probe.py` | **⑤精确红**并点名（广义化生效） |
| 清空豁免表 | **⑤报出 `generate_icons.py`**（证明豁免承重、⑤真能识别它） |
| 豁免表加悬空项 `ghost-does-not-exist.py` | **⑤c精确红**（⑤b 顺带也红） |
| 全部还原 | 10/10 绿 |

全量 **683 passed / 39 files**（673 → 680 → 682 → 683）；`npx vue-tsc --noEmit` 干净；
前序 `6b989fe` 双 CI job 均 success。

### 教训
**「守卫」本身也要有守卫。** 接线守卫家族只覆盖了三个已知目录，就默认
"其余目录不需要"——这是把**枚举式覆盖**当成了**完备性证明**。
凡是新出现一类需要"必须被某链引用"的资产（闸门脚本、迁移脚本、
hook、workflow 步骤），就应当有一道对应方向的 wiring 守卫，
而不是靠人工盘点一次就放心。

**补**：① 装好后我**没有立刻收工**，而是主动追问"① 的反方向是什么"，
才挖出 ④；④ 装好后继续追问"还有哪个目录是同类盲区"，才挖出 ⑤；
⑤ 装好后继续追问"`scripts/` 之外还有哪些脚本位置"，才挖出广义化与豁免表。
**单方向守卫会给人"已覆盖"的错觉** —— 一个关系的守卫要
同时测两个方向（"谁引用它" + "它引用谁"）才算闭合。这也印证了二号机
#99 那条纪律：**「没报出来」和「报对了」在断言层面长得一样**。

---

## 迁移计划

将 `industrial_scada` (Flask + Jinja2) 后端整合到 `scada-app` (Vue 3 + Electron)：

1. **保留 Flask 后端** — 已稳定运行，45/45 测试通过
2. **替换前端** — Jinja2 模板 → Vue 3 SPA
3. **API 适配** — 确保 Vue 前端能调用 Flask API
4. **WebSocket 适配** — Vue 前端用 socket.io-client 连接
5. **Electron 打包** — 生产模式直连 localhost:5000

仓库: https://github.com/chenxinghang-a/scada-app
