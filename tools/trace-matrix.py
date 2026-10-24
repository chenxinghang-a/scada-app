#!/usr/bin/env python3
"""把 docs/traceability.yaml 渲染成可打印的追溯矩阵，并做一致性检查。

三个检查（这才是这个脚本的价值，单纯渲染表格没意义）：
  1. status=designed —— 声称做了但没有独立验证。**这种最危险**，评审一问就露。
  2. evidence 指向的文件不存在 / 为空 —— 说有证据但证据不在。
  3. status=verified 但 verification 为空 —— 说验证过但没说怎么验。

用法：
    python tools/trace-matrix.py            # 渲染 + 检查
    python tools/trace-matrix.py --html reports/trace-matrix.html
    python tools/trace-matrix.py --csv reports/trace-matrix.csv
退出码：有 designed 或 证据缺失 → 1（可接 CI）
"""
from __future__ import annotations

import argparse
import csv
import html
import os
import sys
from datetime import datetime

try:
    import yaml
except ImportError:
    raise SystemExit("需要 pyyaml：pip install pyyaml")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_YAML = os.path.join(ROOT, "docs", "traceability.yaml")

STATUS_LABEL = {
    "verified": ("已验证", "ok"),
    "partial": ("部分", "part"),
    "designed": ("未验证", "no"),
    "not_done": ("不做", "skip"),
}


def load(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def check(data: dict) -> list[dict]:
    issues = []
    for r in data.get("requirements", []):
        rid = r.get("id", "?")
        st = r.get("status", "")
        ev = (r.get("evidence") or "").strip()
        ver = (r.get("verification") or "").strip()

        if st == "designed":
            issues.append({"id": rid, "level": "high",
                           "msg": "声称已实现但没有独立验证（status=designed）"})
        if st == "verified":
            if not ver:
                issues.append({"id": rid, "level": "warn",
                               "msg": "标了已验证，但没写验证方法"})
            if not ev:
                issues.append({"id": rid, "level": "warn",
                               "msg": "标了已验证，但没有落盘证据文件"})
            elif not os.path.exists(os.path.join(ROOT, ev)):
                issues.append({"id": rid, "level": "high",
                               "msg": f"证据文件不存在：{ev}"})
        if st == "not_done" and not (r.get("note") or "").strip():
            issues.append({"id": rid, "level": "warn",
                           "msg": "标为不做，但没写理由"})
    return issues


def to_html(data: dict, issues: list[dict]) -> str:
    meta = data.get("meta", {})
    reqs = data.get("requirements", [])
    counts = {}
    for r in reqs:
        counts[r.get("status")] = counts.get(r.get("status"), 0) + 1

    rows = []
    for r in reqs:
        label, cls = STATUS_LABEL.get(r.get("status"), ("?", "skip"))
        ev = (r.get("evidence") or "").strip()
        ev_html = f"<code>{html.escape(ev)}</code>" if ev else "<span class='dim'>—</span>"
        ver = (r.get("verification") or "").strip()
        ver_html = f"<code>{html.escape(ver)}</code>" if ver else "<span class='dim'>—</span>"
        note = (r.get("note") or "").strip()
        rows.append(f"""
      <tr>
        <td class="id">{html.escape(r.get('id',''))}</td>
        <td><span class="cat">{html.escape(r.get('category',''))}</span></td>
        <td>{html.escape(r.get('requirement',''))}
            {f'<div class="src">依据：{html.escape(r.get("source",""))}</div>' if r.get('source') else ''}
        </td>
        <td class="mono-sm">{html.escape(r.get('implementation','') or '—')}</td>
        <td>{ver_html}</td>
        <td>{ev_html}</td>
        <td><span class="tag {cls}">{label}</span></td>
      </tr>""")
        if note:
            rows.append(f"""
      <tr class="note-row"><td></td><td colspan="6">↳ {html.escape(note)}</td></tr>""")

    issue_html = ""
    if issues:
        items = "".join(
            f"<li class='{'bad' if i['level']=='high' else 'warn'}'>"
            f"<strong>{html.escape(i['id'])}</strong> — {html.escape(i['msg'])}</li>"
            for i in issues)
        issue_html = f"""
  <div class="note {'red' if any(i['level']=='high' for i in issues) else ''}">
    <strong>一致性检查发现 {len(issues)} 项问题</strong>
    <ul>{items}</ul>
  </div>"""
    else:
        issue_html = """
  <div class="note green"><strong>一致性检查通过</strong>：没有「声称做了但没验证」的条目，证据文件都在。</div>"""

    return f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>需求可追溯矩阵 · {html.escape(meta.get('project',''))}</title>
<style>
 :root{{--bg:#f6f7f9;--card:#fff;--ink:#1b1f24;--ink2:#59636e;--ink3:#8b949e;--line:#e2e5ea;
        --red:#cf222e;--green:#1a7f37;--amber:#9a6700;--blue:#0969da}}
 *{{box-sizing:border-box}}
 body{{margin:0;padding:34px 22px 70px;background:var(--bg);color:var(--ink);
      font:13px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}}
 .wrap{{max-width:1240px;margin:0 auto}}
 h1{{font-size:23px;margin:0 0 6px;letter-spacing:-.3px}}
 .sub{{color:var(--ink2);margin:0 0 22px;font-size:13px}}
 .cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}}
 .card{{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 15px}}
 .card .k{{font-size:12px;color:var(--ink3)}}
 .card .v{{font-size:20px;font-weight:650;font-variant-numeric:tabular-nums;margin-top:3px}}
 table{{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);
        border-radius:8px;overflow:hidden;font-size:12.5px}}
 th,td{{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}}
 th{{background:#fbfcfd;font-weight:600;color:var(--ink2);font-size:11.5px;position:sticky;top:0}}
 tr:last-child td{{border-bottom:none}}
 td.id{{font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}}
 .cat{{display:inline-block;padding:1px 7px;border-radius:9px;background:#eef1f4;color:var(--ink2);font-size:11px}}
 .src{{color:var(--ink3);font-size:11.5px;margin-top:2px}}
 code{{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;background:#eef1f4;
       padding:1px 5px;border-radius:4px;word-break:break-all}}
 .dim{{color:var(--ink3)}}
 .mono-sm{{font-size:11.5px;color:var(--ink2);word-break:break-word}}
 .tag{{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;white-space:nowrap}}
 .tag.ok{{background:#dafbe1;color:#1a7f37}}
 .tag.part{{background:#fff8c5;color:#9a6700}}
 .tag.no{{background:#ffebe9;color:#cf222e}}
 .tag.skip{{background:#eef1f4;color:#59636e}}
 tr.note-row td{{background:#fcfcfd;color:var(--ink2);font-size:11.5px;border-bottom:1px solid var(--line)}}
 .note{{background:#fff8e6;border:1px solid #f0d9a8;border-radius:8px;padding:12px 16px;margin:14px 0;font-size:12.5px;color:#6b5316}}
 .note.green{{background:#edf9f0;border-color:#bfe6c8;color:#155724}}
 .note.red{{background:#fff0f0;border-color:#f5c2c2;color:#8b1a1a}}
 .note ul{{margin:8px 0 0;padding-left:20px}}
 .bad{{color:var(--red)}} .warn{{color:var(--amber)}}
 footer{{margin-top:36px;padding-top:13px;border-top:1px solid var(--line);color:var(--ink3);font-size:11.5px}}
 @media print{{body{{background:#fff;padding:0}} tr,table{{break-inside:avoid}} th{{position:static}}}}
</style></head><body><div class="wrap">
 <h1>需求可追溯矩阵</h1>
 <p class="sub">{html.escape(meta.get('project',''))} · v{html.escape(str(meta.get('version','')))} ·
    {html.escape(str(meta.get('date','')))} · {html.escape(str(meta.get('author','')))}<br>
    每条需求都能回答：谁要求的 → 在哪儿实现 → 怎么验 → 证据是哪份文件。
    <strong>评审可以随机挑一条，当场跑验证命令。</strong></p>

 <div class="cards">
   <div class="card"><div class="k">需求条目</div><div class="v">{len(reqs)}</div></div>
   <div class="card"><div class="k">已验证</div><div class="v" style="color:var(--green)">{counts.get('verified',0)}</div></div>
   <div class="card"><div class="k">部分覆盖</div><div class="v" style="color:var(--amber)">{counts.get('partial',0)}</div></div>
   <div class="card"><div class="k">明确不做</div><div class="v" style="color:var(--ink3)">{counts.get('not_done',0)}</div></div>
 </div>
{issue_html}
 <table>
  <thead><tr>
    <th style="width:8%">ID</th><th style="width:6%">类别</th><th style="width:27%">需求</th>
    <th style="width:20%">实现位置</th><th style="width:17%">验证方法</th><th style="width:12%">证据</th><th style="width:10%">状态</th>
  </tr></thead>
  <tbody>{''.join(rows)}</tbody>
 </table>

 <footer>
  范围：{html.escape(str(meta.get('scope','')))} · 生成于 {datetime.now().strftime('%Y-%m-%d %H:%M')}<br>
  由 <code>tools/trace-matrix.py</code> 从 <code>docs/traceability.yaml</code> 生成，改需求请改 yaml
 </footer>
</div></body></html>"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yaml", default=DEFAULT_YAML)
    ap.add_argument("--html", default=None)
    ap.add_argument("--csv", default=None)
    args = ap.parse_args()

    data = load(args.yaml)
    reqs = data.get("requirements", [])
    issues = check(data)

    print("=" * 72)
    print("需求可追溯矩阵")
    print("=" * 72)
    print(f"{'ID':<10}{'类别':<8}{'状态':<8}需求")
    for r in reqs:
        label, _ = STATUS_LABEL.get(r.get("status"), ("?", ""))
        print(f"{r.get('id',''):<10}{r.get('category',''):<8}{label:<8}{r.get('requirement','')[:44]}")

    counts = {}
    for r in reqs:
        counts[r.get("status")] = counts.get(r.get("status"), 0) + 1
    print(f"\n合计 {len(reqs)} 条：已验证 {counts.get('verified',0)} / "
          f"部分 {counts.get('partial',0)} / 未验证 {counts.get('designed',0)} / 不做 {counts.get('not_done',0)}")

    if issues:
        print(f"\n一致性检查：{len(issues)} 项问题")
        for i in issues:
            tag = "严重" if i["level"] == "high" else "注意"
            print(f"  [{tag}] {i['id']}: {i['msg']}")
    else:
        print("\n一致性检查：通过（没有「声称做了但没验证」的条目）")

    if args.html:
        with open(args.html, "w", encoding="utf-8") as fh:
            fh.write(to_html(data, issues))
        print(f"\nHTML 已写入 {args.html}")

    if args.csv:
        with open(args.csv, "w", encoding="utf-8-sig", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["ID", "类别", "需求", "依据", "实现位置", "验证方法", "证据", "状态", "备注"])
            for r in reqs:
                w.writerow([r.get("id", ""), r.get("category", ""), r.get("requirement", ""),
                            r.get("source", ""), r.get("implementation", ""), r.get("verification", ""),
                            r.get("evidence", ""), r.get("status", ""), r.get("note", "")])
        print(f"CSV 已写入 {args.csv}")

    raise SystemExit(1 if any(i["level"] == "high" for i in issues) else 0)


if __name__ == "__main__":
    main()
