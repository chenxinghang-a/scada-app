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

## 迁移计划

将 `industrial_scada` (Flask + Jinja2) 后端整合到 `scada-app` (Vue 3 + Electron)：

1. **保留 Flask 后端** — 已稳定运行，45/45 测试通过
2. **替换前端** — Jinja2 模板 → Vue 3 SPA
3. **API 适配** — 确保 Vue 前端能调用 Flask API
4. **WebSocket 适配** — Vue 前端用 socket.io-client 连接
5. **Electron 打包** — 生产模式直连 localhost:5000

仓库: https://github.com/chenxinghang-a/scada-app
