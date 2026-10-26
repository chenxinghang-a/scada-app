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

from deepcheck.common import REPO, find_db, say, write_json  # noqa: E402

API_DIR = REPO / 'backend' / 'src' / '展示层' / 'api'
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
    args = ap.parse_args()

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
    say(f'登录：{"成功" if token else "未拿到 token（后续请求按匿名测，401 不计失败）"}')

    params = fixture_params()
    bad5xx, unexpected401, results = [], [], []
    for r in routes:
        path = fill(r['path'], params)
        for m in r['methods']:
            if m not in ('GET', 'POST', 'PUT', 'DELETE', 'PATCH'):
                continue
            code, body, ctype = http(m, f'{args.base}{path}', token)
            results.append({'path': path, 'method': m, 'status': code,
                            'file': r['file'], 'snippet': body[:120].replace('\n', ' ')})
            if code >= 500 or code == 0:
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
           'public_2xx': public,
           'ok_2xx': ok2xx, 'server_errors': len(bad5xx),
           'unexpected_401': len(unexpected401),
           'errors': bad5xx[:20], 'auth_401': unexpected401[:10]}
    write_json(REPO / 'reports' / 'deep' / 'api-smoke.json', rep)

    say(f'\n请求 {total} 次：2xx {ok2xx}，5xx/连不上 {len(bad5xx)}，已登录但 401 {len(unexpected401)}')
    for e in bad5xx[:12]:
        say(f"  5xx {e['method']:<6}{e['path']:<52} {e['status']}  {e['snippet'][:80]}")
    verdict = 'PASS' if not bad5xx and not unexpected401 else 'FAIL'
    say(f'结论：{verdict}')
    return 0 if verdict == 'PASS' else 1


if __name__ == '__main__':
    sys.exit(main())
