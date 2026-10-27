#!/usr/bin/env python3
"""接口冒烟：169 个路由里有几个会 500？

前 18 个检测器全在"数据/配置/工具"层，**API 层一条都没测过**。
而答辩时老师点开的正是界面背后的接口。一个返回 500 的接口，
在数据检查里完全看不出来。

本脚本做三件事（都是"能不能用"级别，不判业务正确性）：

1. 从源码解析出全部 ``@xxx_bp.route(...)``（含 blueprint 的 url_prefix）
2. 登录拿 JWT，逐个请求；路径参数用库里的真实 ID 填
3. 判据：**不允许出现 5xx**；受保护接口不应返回 401（说明鉴权链路断了）

    python tools/api-smoke.py                      # 需先启动后端（默认 5000）
    python tools/api-smoke.py --base http://127.0.0.1:5000 --user admin --password admin123

为什么不做"全自动列举"：直接读 Flask 的 url_map 需要把整个应用拉起来（依赖数据库、
采集器、SocketIO）。解析源码虽然土，但它只依赖文本，不会因为环境缺件而失效。
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepcheck.common import REPO, say, write_json  # noqa: E402

API_DIR = REPO / 'backend' / 'src' / '展示层' / 'api'


def _server_db(mode: str | None = None) -> Path:
    """后端**真正在用**的库路径 —— 与后端同一真源（`backend/src/paths.py`）。

    为什么不用 `deepcheck.find_db()`：它只认打包产物
    `backend/_internal/data/*.db`。开发态后端读的是 `backend/src/data/*.db`，
    两个库同时存在时 `find_db()` 会安静地指到另一个 —— 临时账号写进去，
    后端永远认不出来（登录 401），而脚本只会说"未拿到 token，按匿名测"。
    """
    src = REPO / 'backend' / 'src'
    if str(src) not in sys.path:
        sys.path.insert(0, str(src))
    import paths as backend_paths
    resolved_mode = backend_paths.resolve_cli_db_mode(mode)
    db = Path(backend_paths.get_db_path(resolved_mode))
    say(f'库：{db}（mode={resolved_mode}）')
    return db
BP_RE = re.compile(r"Blueprint\(\s*['\"][\w]+['\"]\s*,.*?url_prefix\s*=\s*['\"]([^'\"]*)['\"]", re.S)
ROUTE_RE = re.compile(r"@(\w+)\.route\(\s*['\"]([^'\"]+)['\"]"
                      r"(?:\s*,\s*methods\s*=\s*\[([^\]]*)\])?", re.S)


def collect_routes() -> list[dict]:
    out = []
    for f in sorted(API_DIR.glob('*.py')):
        src = f.read_text(encoding='utf-8')
        prefixes = {m.group(0).split('_bp')[0].split('Blueprint')[-1]: None
                    for m in []}  # 占位，真正映射在下面按变量名做
        # 先找每个蓝图变量 -> url_prefix
        var_prefix = {}
        for m in re.finditer(r"(\w+)\s*=\s*Blueprint\(\s*['\"][\w]+['\"]([^)]*)\)", src, re.S):
            var, rest = m.group(1), m.group(2)
            pm = re.search(r"url_prefix\s*=\s*['\"]([^'\"]*)['\"]", rest)
            var_prefix[var] = pm.group(1) if pm else ''
        for m in ROUTE_RE.finditer(src):
            var, rule, methods = m.group(1), m.group(2), m.group(3)
            ms = ['GET'] if not methods else [x.strip().strip("'\"").upper()
                                              for x in methods.split(',') if x.strip()]
            out.append({'file': f.name, 'var': var,
                        'path': (var_prefix.get(var, '') or '') + rule,
                        'methods': ms})
    # 去重（同路径同方法只测一次）
    seen, uniq = set(), []
    for r in out:
        k = (r['path'], tuple(sorted(r['methods'])))
        if k in seen:
            continue
        seen.add(k)
        uniq.append(r)
    return uniq


def fixture_params() -> dict:
    params = {'device_id': 'siemens_1500_01', 'register_name': 'boiler_temperature',
              'username': 'admin', 'role': 'admin', 'id': '1', 'user_id': '1',
              'alarm_id': 'temp_high', 'point_id': '1', 'template_id': '1'}
    try:
        with sqlite3.connect(f'file:{find_db().as_posix()}?mode=ro', uri=True) as c:
            row = c.execute('SELECT device_id, register_name FROM history_data LIMIT 1').fetchone()
            if row:
                params['device_id'], params['register_name'] = row
            row = c.execute('SELECT alarm_id FROM alarm_records LIMIT 1').fetchone()
            if row:
                params['alarm_id'] = row[0]
    except Exception:
        pass
    return params


def fill(path: str, params: dict) -> str | None:
    def sub(m):
        name = m.group(1).split(':')[-1]
        return str(params.get(name, '1'))
    filled = re.sub(r'<([^>]+)>', sub, path)
    return filled


def http(method: str, url: str, token: str | None, timeout: float = 8.0):
    req = urllib.request.Request(url, method=method)
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Content-Type', 'application/json')
    data = b'{}' if method in ('POST', 'PUT', 'PATCH') else None
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
            ctype = r.headers.get('Content-Type', '')
            return r.status, r.read(200).decode('utf-8', 'replace'), ctype
    except urllib.error.HTTPError as e:
        return e.code, e.read(200).decode('utf-8', 'replace'), e.headers.get('Content-Type', '')
    except Exception as e:
        return 0, f'{type(e).__name__}: {e}', ''


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='http://127.0.0.1:5000')
    ap.add_argument('--user', default='admin')
    ap.add_argument('--password', default='admin123')
    ap.add_argument('--provision-user', action='store_true',
                    help='在库里临时建一个测试账号（跑完即删），用于测鉴权后的接口')
    ap.add_argument('--db', default=None,
                    help='临时账号写哪个库（默认与**后端同源**：走 paths.get_db_path()）')
    ap.add_argument('--db-mode', default=None,
                    help='库模式 simulated/real/simulator（默认读 SCADA_DB_MODE，否则 simulated）')
    ap.add_argument('--allow-destructive', action='store_true',
                    help='连 DELETE、登出/改密、预设应用/导入/重置一起测（会改变系统状态）')
    ap.add_argument('--keep-config', action='store_true',
                    help='跑完不改回设备配置文件（默认：一旦发现被冒烟改动就还原并告警）')
    args = ap.parse_args()

    # 冒烟是"看看接口能不能用"，不该顺手把被测系统改造一遍。
    # 实测（round 291）：`/api/simulation/presets/apply` 这类端点一次 POST 就会往
    # devices_simulated.yaml 里加 20 台设备（+650 行）—— 跑一次冒烟，仓库就脏了，
    # 而且没人会把"配置变了"联想到"我跑了冒烟"。
    DESTRUCTIVE_HINTS = ('preset', '/apply', '/import', '/reset', '/seed',
                         '/restore', '/clear', '/reload')

    # 兜底：跑前存一份配置快照。未命中上面清单的写端点若也改了配置，
    # 至少能发现并还原（默认还原，`--keep-config` 可关）。
    config_path = REPO / 'backend' / 'src' / '配置' / 'devices_simulated.yaml'
    config_before = config_path.read_bytes() if config_path.exists() else None

    routes = collect_routes()
    say(f'解析出 {len(routes)} 条路由（{len({r["file"] for r in routes})} 个模块）')

    # 可达性：任一路径能返回 HTTP 状态码就说明服务在（404 也算"在"）
    reach = 0
    for probe in ('/api/health', '/health', '/api/system/status', '/api/version'):
        code, body, _ = http('GET', f'{args.base}{probe}', None, timeout=4)
        if code:
            reach = code
            break
    if not reach:
        say(f'后端不可达（{body}）。先启动：cd backend/src && python run.py')
        return 2

    temp_user = None
    provision_db = None
    if args.provision_user:
        # admin 被"首次登录必须改密"挡住（GB/T 22239），改它等于伪造运维记录。
        # 改为临时建一个 engineer 账号，跑完就删 —— 只增不删别人的东西。
        #
        # ⚠️ 库路径必须与**后端同源**（round 290 踩过的坑）：
        #    原先这里用 `find_db()`，它只认打包产物
        #    `backend/_internal/data/scada_simulated.db`；而开发态后端用的是
        #    `backend/src/data/scada_simulated.db`。两个库同时存在 →
        #    临时账号写进了**后端根本不读的那一个** → 登录 401 → 脚本静默降级成
        #    匿名测试，最后照样印「结论：PASS」（164 次请求里只有 5 次真被验过）。
        #    检测脚本自己静默假绿，比它要检测的缺陷更危险。
        import bcrypt, secrets
        db = Path(args.db) if args.db else _server_db(args.db_mode)
        provision_db = db
        temp_user = f'smoke_{secrets.token_hex(3)}'
        pw = 'Sm0ke!' + secrets.token_urlsafe(9)
        h = bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()
        conn = sqlite3.connect(str(db))
        try:
            conn.execute('''INSERT INTO users
                (username, password_hash, role, display_name, is_active,
                 must_change_password, created_at, updated_at)
                VALUES (?, ?, 'engineer', '接口冒烟临时账号', 1, 0,
                        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)''', (temp_user, h))
            conn.commit()
        finally:
            conn.close()
        args.user, args.password = temp_user, pw
        say(f'临时账号：{temp_user}（engineer，写库 {db}，跑完删除）')

    token = None
    # 登录需要真实口令，用 json body
    req = urllib.request.Request(f'{args.base}/api/auth/login', method='POST',
                                 data=json.dumps({'username': args.user,
                                                  'password': args.password}).encode(),
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            payload = json.loads(r.read().decode('utf-8'))
            token = (payload.get('data') or {}).get('token') or payload.get('token') \
                or payload.get('access_token')
    except Exception as e:
        say(f'登录失败：{type(e).__name__}: {e}')

    if token is None and args.provision_user:
        # 临时账号都建好了，还是登录不上 → 只能是库指错了或鉴权链路断了。
        # 此时继续跑只会得到"匿名请求 164 次、5 个 2xx、结论 PASS"的假绿，
        # 而受保护的那 150+ 个接口**一个都没验过**。宁可红。
        say('临时账号已创建但登录失败 —— 库路径/鉴权链路有问题。'
            '继续跑只会得到"全绿但什么都没测"的结论，中止。')
        return 3

    say(f'登录：{"成功" if token else "未拿到 token（后续请求按匿名测，401 不计失败）"}')

    # ⚠️ 冒烟自己会把会话搞没：/api/auth/logout 会把 token 拉黑，
    # 之后所有请求都 401 —— 第一版就这么"测出 135 个 401"，其实是自己把自己踢了。
    # 破坏性/改状态的端点默认跳过，要测需显式 --allow-destructive。
    SKIP_ALWAYS = ('/auth/logout', '/auth/change-password', '/auth/force-change-password',
                   '/auth/refresh')
    # 慢接口的单独超时（秒）。默认 8s 是"接口该秒回"的判据，但下面这几个是
    # **全表操作**：`PRAGMA integrity_check` 在 97 万行的库上实测 ~24s。
    # 原先一刀切 8s → 它们稳定被判成"5xx/连不上"，把一次真实的全绿染成红，
    # 而且要等到人工核对日志才发现是客户端超时、服务端其实 200。
    SLOW_PATHS = {
        '/api/ops/db/integrity': 120.0,
        '/api/ops/db/analyze': 120.0,
        '/api/ops/db/vacuum': 300.0,
        '/api/ops/db/reindex': 300.0,
        '/api/ops/diagnostics/export': 120.0,
        '/api/ops/cleanup/history': 120.0,
    }
    skips = []
    params = fixture_params()
    bad5xx, timeouts, unexpected401, results = [], [], [], []
    for r in routes:
        path = fill(r['path'], params)
        for m in r['methods']:
            if m not in ('GET', 'POST', 'PUT', 'DELETE', 'PATCH'):
                continue
            if any(k in path for k in SKIP_ALWAYS):
                skips.append(f'{m} {path}')
                continue
            if m == 'DELETE' and not args.allow_destructive:
                skips.append(f'{m} {path}')
                continue
            if (m != 'GET' and not args.allow_destructive
                    and any(h in path.lower() for h in DESTRUCTIVE_HINTS)):
                # 预设应用 / 导入 / 重置 / 重载这类端点：一次调用就能改掉整份设备配置。
                skips.append(f'{m} {path}')
                continue
            code, body, ctype = http(m, f'{args.base}{path}', token,
                                     timeout=SLOW_PATHS.get(path, 8.0))
            results.append({'path': path, 'method': m, 'status': code,
                            'file': r['file'], 'snippet': body[:120].replace('\n', ' ')})
            if code == 0:
                # 超时/连不上：和"服务端 500"是两件事，混在一起会让
                # "慢"看起来像"崩"，也会让真正的 500 被淹没。
                timeouts.append(results[-1])
            elif code >= 500:
                bad5xx.append(results[-1])
            elif code == 401 and token:
                unexpected401.append(results[-1])

    total = len(results)
    ok2xx = sum(1 for r in results if 200 <= r['status'] < 300)
    # 无 token 也能拿到 2xx 的接口 = 公开可达。答辩/等保评审都会问"哪些接口不需要登录"，
    # 这份清单是证据；是否该公开由人判断，工具只负责列出来。
    public = sorted({f"{r['method']} {r['path']}" for r in results
                     if 200 <= r['status'] < 300 and not token and r.get('json')})
    rep = {'base': args.base, 'routes': len(routes), 'requests': total,
           'authenticated': bool(token),
           'skipped': skips, 'public_2xx': public,
           'ok_2xx': ok2xx, 'server_errors': len(bad5xx),
           'timeouts': len(timeouts),
           'unexpected_401': len(unexpected401),
           'errors': bad5xx[:20], 'timeout_detail': timeouts[:10],
           'auth_401': unexpected401[:10]}
    write_json(REPO / 'reports' / 'deep' / 'api-smoke.json', rep)

    say(f'\n请求 {total} 次：2xx {ok2xx}，5xx {len(bad5xx)}，'
        f'超时/连不上 {len(timeouts)}，已登录但 401 {len(unexpected401)}')
    for e in bad5xx[:12]:
        say(f"  5xx {e['method']:<6}{e['path']:<52} {e['status']}  {e['snippet'][:80]}")
    for e in timeouts[:12]:
        say(f"  超时 {e['method']:<6}{e['path']:<52}  {e['snippet'][:60]}")
    # 没登录却全绿 = 受保护接口一个没验过。这种情况不允许给 PASS。
    if not token:
        say('⚠️ 未登录（匿名态）：受保护接口实际未被验证，结论降级为 INCOMPLETE')
    verdict = 'FAIL' if (bad5xx or timeouts or unexpected401) else ('PASS' if token else 'INCOMPLETE')
    say(f'结论：{verdict}')

    # 兜底还原：见上面 DESTRUCTIVE_HINTS 的说明。**必须说出来**，不能悄悄还原 ——
    # 悄悄还原和悄悄改动一样糟：操作者会以为"配置没人动过"。
    if config_before is not None and config_path.exists():
        config_after = config_path.read_bytes()
        if config_after != config_before:
            if args.keep_config:
                say(f'⚠️ 冒烟改动了设备配置（{len(config_after) - len(config_before):+d} 字节），'
                    f'按 --keep-config 保留：{config_path}')
            else:
                config_path.write_bytes(config_before)
                say(f'⚠️ 冒烟改动了设备配置（{len(config_after) - len(config_before):+d} 字节），'
                    f'已按跑前快照还原：{config_path}')

    if temp_user and provision_db is not None:
        conn = sqlite3.connect(str(provision_db))
        try:
            conn.execute('DELETE FROM users WHERE username = ?', (temp_user,))
            conn.commit()
            say(f'临时账号已删除：{temp_user}')
        finally:
            conn.close()
    return 0 if verdict == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
