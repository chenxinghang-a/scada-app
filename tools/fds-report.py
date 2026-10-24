#!/usr/bin/env python3
"""FDS（功能设计规格）生成器 —— 从代码和数据库里提取，不手写。

为什么这么做：
  手写的设计文档，三个月后一定和代码对不上，评审一比对就露。
  这里把能自动提取的都提出来（端点、表结构、模块清单、配置项），
  只把「为什么这么设计」留给人工补。文档跟着代码走，改完重跑一次就同步。

数据来源（都可指定）：
  - API 端点：扫描 `展示层/api/*.py` 里的 @xxx_bp.route 装饰器
  - 数据模型：读实际 SQLite 库的 PRAGMA table_info
  - 模块清单：扫业务目录 + 抓 __init__.py 的模块级 docstring
  - 配置项：扫 配置/*.yaml 的顶层键

用法：
    python tools/fds-report.py [--src <源码目录>] [--db <库>] [--html out.html]
"""
from __future__ import annotations

import argparse
import glob
import html
import os
import re
import sqlite3
from collections import OrderedDict
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ROUTE_RE = re.compile(r"@(\w+?)_bp\.route\(\s*['\"]([^'\"]+)['\"]([^)]*)\)")
METHOD_RE = re.compile(r"methods\s*=\s*\[([^\]]+)\]")
FUNC_RE = re.compile(r"^def\s+(\w+)\s*\(", re.M)


def find_src(explicit: str | None) -> str:
    for c in (explicit, os.path.join(ROOT, "backend", "src")):
        if c and os.path.isdir(os.path.join(c, "展示层", "api")):
            return os.path.abspath(c)
    raise SystemExit("找不到源码目录（需要含 展示层/api），用 --src 指定")


def find_db(explicit: str | None) -> str | None:
    cands = [explicit] if explicit else []
    cands += [
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\smartscada\resources\backend\_internal\data\scada_simulated.db"),
        os.path.join(ROOT, "backend", "_internal", "data", "scada_simulated.db"),
    ]
    for c in cands:
        if c and os.path.exists(c):
            return os.path.abspath(c)
    hits = glob.glob(os.path.join(ROOT, "backend", "**", "scada_simulated.db"), recursive=True)
    return os.path.abspath(hits[0]) if hits else None


def scan_routes(src: str) -> "OrderedDict[str, list[dict]]":
    by_file: OrderedDict[str, list[dict]] = OrderedDict()
    for f in sorted(glob.glob(os.path.join(src, "展示层", "api", "*.py"))):
        text = open(f, encoding="utf-8", errors="replace").read()
        items = []
        for m in ROUTE_RE.finditer(text):
            path = m.group(2)
            tail = m.group(3) or ""
            mm = METHOD_RE.search(tail)
            methods = [x.strip().strip("'\"").upper() for x in mm.group(1).split(",")] if mm else ["GET"]
            # 找紧跟其后的函数名
            after = text[m.end():m.end() + 500]
            fm = FUNC_RE.search(after)
            items.append({"path": path, "methods": methods, "func": fm.group(1) if fm else "?"})
        if items:
            by_file[os.path.basename(f)] = items
    return by_file


def scan_schema(db: str | None) -> list[dict]:
    if not db or not os.path.exists(db):
        return []
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    except sqlite3.Error:
        return []
    cur = con.cursor()
    out = []
    tables = [r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    for t in tables:
        # 每张表独立 try：一张表的 PRAGMA 失败（锁/损坏）不该让整份 FDS 只剩一张表
        try:
            cols = [{"name": r[1], "type": r[2], "notnull": bool(r[3]), "pk": bool(r[5])}
                    for r in cur.execute(f'PRAGMA table_info("{t}")')]
        except sqlite3.Error as e:
            cols = [{"name": f"(PRAGMA 失败: {e})", "type": "", "notnull": False, "pk": False}]
        try:
            n = cur.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        except sqlite3.Error:
            n = -1
        try:
            idx = [r[1] for r in cur.execute(f'PRAGMA index_list("{t}")')]
        except sqlite3.Error:
            idx = []
        out.append({"table": t, "rows": n, "columns": cols, "indexes": idx})
    con.close()
    return out


def scan_modules(src: str) -> list[dict]:
    out = []
    for name in sorted(os.listdir(src)):
        d = os.path.join(src, name)
        if not os.path.isdir(d) or name.startswith((".", "_")) or "dist-info" in name:
            continue
        py = glob.glob(os.path.join(d, "*.py"))
        if not py:
            continue
        doc = ""
        init = os.path.join(d, "__init__.py")
        if os.path.exists(init):
            txt = open(init, encoding="utf-8", errors="replace").read()
            m = re.match(r'\s*"""(.+?)"""', txt, re.S)
            if m:
                doc = m.group(1).strip().split("\n")[0][:80]
        out.append({"name": name, "files": len(py), "doc": doc})
    return out


def scan_config(src: str) -> list[dict]:
    out = []
    cfg_dir = os.path.join(src, "配置")
    if not os.path.isdir(cfg_dir):
        return out
    try:
        import yaml
    except ImportError:
        return out
    for f in sorted(glob.glob(os.path.join(cfg_dir, "*.yaml"))):
        try:
            d = yaml.safe_load(open(f, encoding="utf-8")) or {}
        except Exception:
            continue
        keys = list(d.keys()) if isinstance(d, dict) else []
        out.append({"file": os.path.basename(f), "keys": keys})
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=None)
    ap.add_argument("--db", default=None)
    ap.add_argument("--html", default=None)
    args = ap.parse_args()

    src = find_src(args.src)
    db = find_db(args.db)
    routes = scan_routes(src)
    schema = scan_schema(db)
    modules = scan_modules(src)
    configs = scan_config(src)
    total_ep = sum(len(v) for v in routes.values())

    print("=" * 70)
    print("FDS 提取结果")
    print("=" * 70)
    print(f"源码 : {src}")
    print(f"库   : {db or '(未找到)'}")
    print(f"端点 : {total_ep} 个 / {len(routes)} 个模块")
    print(f"表   : {len(schema)} 张，共 {sum(max(0, t['rows']) for t in schema):,} 行")
    print(f"模块 : {len(modules)} 个业务包")
    print(f"配置 : {len(configs)} 份 yaml")
    for f, items in routes.items():
        print(f"  {f:<24} {len(items):>3} 端点")

    if not args.html:
        return

    # ---------- 渲染 ----------
    route_html = []
    for f, items in routes.items():
        rows = "".join(
            f"<tr><td class='m'>{'/'.join(i['methods'])}</td>"
            f"<td class='p'>{html.escape(i['path'])}</td>"
            f"<td class='f'>{html.escape(i['func'])}</td></tr>" for i in items)
        route_html.append(f"""
      <details><summary><strong>{html.escape(f)}</strong> · {len(items)} 个端点</summary>
        <table class="inner"><thead><tr><th style="width:14%">方法</th><th style="width:56%">路径</th><th>处理函数</th></tr></thead>
        <tbody>{rows}</tbody></table></details>""")

    schema_html = []
    for t in schema:
        cols = "".join(
            f"<tr><td class='p'>{html.escape(c['name'])}</td><td class='f'>{html.escape(c['type'] or '—')}</td>"
            f"<td>{'PK' if c['pk'] else ''}{' NOT NULL' if c['notnull'] and not c['pk'] else ''}</td></tr>"
            for c in t["columns"])
        schema_html.append(f"""
      <div class="tbl">
        <div class="tbl-head"><strong>{html.escape(t['table'])}</strong>
          <span class="dim">{t['rows']:,} 行 · {len(t['columns'])} 列{(' · 索引 ' + str(len(t['indexes']))) if t['indexes'] else ''}</span></div>
        <table class="inner"><thead><tr><th style="width:32%">列</th><th style="width:26%">类型</th><th>约束</th></tr></thead>
        <tbody>{cols}</tbody></table>
      </div>""")

    module_html = "".join(
        f"<tr><td class='p'>{html.escape(m['name'])}</td><td class='n'>{m['files']}</td>"
        f"<td>{html.escape(m['doc'] or '—')}</td></tr>" for m in modules)

    config_html = "".join(
        f"<tr><td class='p'>{html.escape(c['file'])}</td>"
        f"<td>{html.escape(', '.join(map(str, c['keys'])) or '—')}</td></tr>" for c in configs)

    doc = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>FDS 功能设计规格 · SmartSCADA</title>
<style>
 :root{{--bg:#f6f7f9;--card:#fff;--ink:#1b1f24;--ink2:#59636e;--ink3:#8b949e;--line:#e2e5ea;--blue:#0969da}}
 *{{box-sizing:border-box}}
 body{{margin:0;padding:34px 22px 70px;background:var(--bg);color:var(--ink);
      font:13px/1.7 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}}
 .wrap{{max-width:1180px;margin:0 auto}}
 h1{{font-size:24px;margin:0 0 6px}}
 .sub{{color:var(--ink2);margin:0 0 26px;font-size:12.5px}}
 h2{{font-size:16px;margin:34px 0 12px;padding-bottom:8px;border-bottom:2px solid var(--line)}}
 h2 .n{{color:var(--ink3);font-weight:500;margin-right:8px}}
 table{{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);
        border-radius:8px;overflow:hidden;font-size:12px}}
 table.inner{{margin:8px 0 14px;font-size:11.5px}}
 th,td{{padding:7px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}}
 th{{background:#fbfcfd;font-weight:600;color:var(--ink2);font-size:11px}}
 tr:last-child td{{border-bottom:none}}
 td.m{{font-weight:600;color:var(--blue);white-space:nowrap}}
 td.p{{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;word-break:break-all}}
 td.f{{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--ink2)}}
 td.n{{text-align:right;font-variant-numeric:tabular-nums;color:var(--ink2)}}
 .dim{{color:var(--ink3);font-weight:400;font-size:11.5px;margin-left:8px}}
 details{{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin:8px 0}}
 summary{{cursor:pointer;font-size:12.5px}}
 .tbl{{margin:12px 0}}
 .tbl-head{{padding:8px 12px;background:#fbfcfd;border:1px solid var(--line);border-bottom:none;border-radius:8px 8px 0 0;font-size:12.5px}}
 .tbl-head + table{{border-radius:0 0 8px 8px}}
 .cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}}
 .card{{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 15px}}
 .card .k{{font-size:11.5px;color:var(--ink3)}}
 .card .v{{font-size:19px;font-weight:650;font-variant-numeric:tabular-nums;margin-top:3px}}
 .arch{{background:#0d1117;color:#c9d1d9;padding:16px 20px;border-radius:8px;font-family:ui-monospace,Consolas,monospace;
        font-size:12px;line-height:1.75;overflow-x:auto;white-space:pre}}
 .note{{background:#eef5ff;border:1px solid #c7ddff;border-radius:8px;padding:12px 16px;font-size:12.5px;color:#14417a;margin:14px 0}}
 footer{{margin-top:38px;padding-top:13px;border-top:1px solid var(--line);color:var(--ink3);font-size:11.5px}}
 @media print{{body{{background:#fff;padding:0}} details{{break-inside:avoid}} details[open]{{}}}}
</style></head><body><div class="wrap">

 <h1>FDS 功能设计规格</h1>
 <p class="sub">SmartSCADA 工业数据采集与监控系统 · v1.3.1091 · {datetime.now().strftime('%Y-%m-%d')}<br>
 本文件由 <code>tools/fds-report.py</code> 从源码与数据库提取生成 ——
 <strong>代码改了重跑一次即同步</strong>，不存在「文档和实现对不上」。</p>

 <div class="cards">
   <div class="card"><div class="k">API 端点</div><div class="v">{total_ep}</div></div>
   <div class="card"><div class="k">数据表</div><div class="v">{len(schema)}</div></div>
   <div class="card"><div class="k">业务包</div><div class="v">{len(modules)}</div></div>
   <div class="card"><div class="k">配置文件</div><div class="v">{len(configs)}</div></div>
 </div>

 <h2><span class="n">1</span>系统结构</h2>
 <div class="arch">前端 (Vue 3 + Element Plus)
   ├─ 视图层：仪表盘 / 设备 / 控制 / 历史 / 报警 / 工业4.0 / 数据大屏 / 配置
   ├─ 传输：REST (axios, Bearer JWT) + WebSocket (socket.io, polling 优先)
   └─ 打包：Electron 33，页面走 file://，后端由主进程 spawn

后端 (Flask 3.1 + SocketIO/threading)
   ├─ 展示层 ── 12 个 API 蓝图（{total_ep} 个端点）+ 页面认证 + 错误处理
   ├─ 采集层 ── 设备管理器（30 台模拟/真实设备）、数据采集器、行为模拟器
   ├─ 存储层 ── SQLite（WAL 模式），{len(schema)} 张表
   ├─ 报警层 ── 规则引擎、去重/抑制、洪水检测、升级、输出（塔灯/广播）
   ├─ 智能层 ── OEE、预测维护、SPC、能源、边缘决策、设备控制（联锁/急停）
   └─ core   ── 健康检查、熔断、限流、降级、缓存、审计、调度

进程：单后端进程（5000 端口，模拟模式）+ Electron 主进程
部署：托盘常驻，前端与后端同机</div>

 <h2><span class="n">2</span>数据模型（{len(schema)} 张表）</h2>
 <p class="sub" style="margin-bottom:10px">从实际库的 PRAGMA 提取，含当前行数。行数为 0 的表表示有结构但尚无数据。</p>
 {''.join(schema_html)}

 <h2><span class="n">3</span>接口规格（{total_ep} 个端点 / {len(routes)} 个蓝图）</h2>
 <p class="sub" style="margin-bottom:10px">点开每个蓝图查看端点明细。路径即 REST 契约，处理函数名可直接在源码中检索。</p>
 {''.join(route_html)}

 <h2><span class="n">4</span>业务包（{len(modules)} 个）</h2>
 <table><thead><tr><th style="width:22%">包名</th><th style="width:10%">.py 数</th><th>职责（取自包 docstring 首行）</th></tr></thead>
 <tbody>{module_html}</tbody></table>

 <h2><span class="n">5</span>配置项（{len(configs)} 份 yaml）</h2>
 <table><thead><tr><th style="width:30%">文件</th><th>顶层键</th></tr></thead><tbody>{config_html}</tbody></table>

 <h2><span class="n">6</span>关键设计决策（人工补充，非自动生成）</h2>
 <div class="note">
  <strong>为什么时间序列化要自定义 JSON Provider</strong>：后端大量用 naive datetime（本地时间），
  Flask 默认按 HTTP-date 输出成 <code>... GMT</code>，把本地时间谎报成 UTC，前端解析后 +8 小时。
  统一输出带偏移的 ISO8601 是唯一不会错的做法。
 </div>
 <div class="note">
  <strong>为什么采集用「线程 + 批量事务」而不是每点一事务</strong>：30 台设备 × 2 秒周期会产生
  十几点/秒的写入，逐条提交在 SQLite 上会把 WAL 撑大且拖慢；批量提交 + WAL 才能在 kill -9 时不丢数据
  （已由 crash-recovery 演练证实）。
 </div>
 <div class="note">
  <strong>为什么状态量（*_status / *_state）必须离散化</strong>：OEE 的可用率依赖设备状态码（0–5），
  连续浮点会被采集器整体丢弃，实时状态跟踪等于空转。这条在模拟器和采集器两侧都要拦。
 </div>

 <footer>由 tools/fds-report.py 生成 · 源码 {html.escape(src)} · 库 {html.escape(db or '未找到')} ·
  {datetime.now().strftime('%Y-%m-%d %H:%M')}</footer>
</div></body></html>"""

    with open(args.html, "w", encoding="utf-8") as fh:
        fh.write(doc)
    print(f"\nFDS 已写入 {args.html}")


if __name__ == "__main__":
    main()
