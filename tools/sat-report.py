#!/usr/bin/env python3
"""SAT（现场验收测试）记录表 —— 实际结果从证据文件自动读取，不手填。

为什么要有它：
  追溯矩阵回答「谁要求/在哪儿实现/怎么验」，SAT 回答更直接的问题：
  **「什么时候跑的、跑出什么结果、谁签的字」**。
  评审看 SAT 时最反感的是「结论：通过」四个字 —— 没有数据支撑的通过没有意义。
  本脚本把每条测试的实际结果从 reports/ 里的证据文件里抠出来，
  连同采集时间一起印在表里。跑过就是跑过，没跑就是「未采集」，不美化。

用法：
    python tools/sat-report.py --html reports/SAT-验收测试记录.html
"""
from __future__ import annotations

import argparse
import html
import json
import os
from datetime import datetime

try:
    import yaml
except ImportError:
    raise SystemExit("需要 pyyaml")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATUS_MARK = {"verified": ("通过", "ok"), "partial": ("部分通过", "part"),
               "designed": ("未验证", "no"), "not_done": ("不适用", "skip")}


def load_json(p: str):
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def extract_actual(ev_rel: str) -> tuple[str, str, str]:
    """返回 (实际结果摘要, 执行时间, 结论)。

    优先读 JSON 里的 verdict；日志类证据取末尾关键行。
    """
    if not ev_rel:
        return ("未采集证据", "—", "未覆盖")
    path = os.path.join(ROOT, ev_rel)
    if not os.path.exists(path):
        return (f"证据文件缺失：{ev_rel}", "—", "未覆盖")

    if path.endswith(".json"):
        d = load_json(path)
        if not isinstance(d, dict):
            return ("证据文件无法解析", "—", "未覆盖")
        verdict = str(d.get("verdict") or "").strip()
        ts = str(d.get("collected_at") or d.get("generated_at") or "").strip() or "—"
        if not verdict:
            # 没有 verdict 的（如 isa18 / clock / quality）用关键数字拼一句
            bits = []
            if "kpi" in d:
                rate = (d["kpi"].get("alarm_rate") or {})
                bits.append(f"报警率 {rate.get('avg_per_hour')} 条/小时")
                bits.append(f"陈旧报警 {d['kpi'].get('stale_alarms', {}).get('count')} 条")
            if "checks" in d:
                c1 = (d["checks"].get("timestamp_vs_created_at") or {})
                hist = c1.get("delta_hours_histogram") or {}
                if hist:
                    top = max(hist.items(), key=lambda kv: kv[1])
                    bits.append(f"时间字段差值 {top[0]} 小时占 {top[1]} 行")
            if "findings" in d:
                bits.append(f"{len(d['findings'])} 项发现")
            if "tables" in d:
                h = d["tables"].get("history_data") or {}
                bits.append(f"history_data 有 quality 列={h.get('has_quality_column')}")
            if "result" in d:
                r = d["result"]
                bits.append(f"报警时延 {r.get('alarm_detected_after_s')}s，峰值 {r.get('peak_value')}")
            if "lost_on_restart" in d:
                bits.append(f"重启后丢失 {d['lost_on_restart']} 条，健康={d.get('healthy_after_restart')}")
            verdict = "；".join(bits) if bits else "（证据里没有结论字段）"
            _hi = [f for f in (d.get("findings") or []) if isinstance(f, dict) and f.get("severity") == "high"]
            if _hi:
                # 功能是通的，但审计本身查出了 high 级问题 —— 两者要分开说，不能混成一句「通过」
                verdict = f"功能正常；但审计发现 {len(_hi)} 项严重问题：" + "；".join(str(x.get("title")) for x in _hi[:2])
        low = verdict.lower()
        if "fail" in low:
            concl = "不通过"
        elif verdict.startswith("PASS") or "通过" in verdict[:6]:
            concl = "通过"
        elif isinstance(d, dict) and d.get("findings"):
            # 没有 verdict 的证据（kpi / clock / quality / fault-drill）按 findings 定级：
            # 有 high 才算异常，全是 warn/info 视为通过 —— 这样才不会把
            # 「发现 3 项说明」也标成红。
            sev = [f.get("severity") for f in d["findings"] if isinstance(f, dict)]
            concl = "有异常" if "high" in sev else "通过"
        else:
            concl = "见实际结果"
        return (verdict, ts, concl)

    # 日志类
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            lines = [l.rstrip() for l in fh if l.strip()]
    except Exception:
        return ("日志读取失败", "—", "未覆盖")
    tail = lines[-6:]
    # 只把「真正的失败」当异常：favicon 404、浏览器 "Failed to load resource" 这类噪音要排除掉，
    # 否则每个页面都会因为缺个图标被标成"有异常"。
    def is_real_failure(l: str) -> bool:
        low = l.lower()
        if "favicon" in low:
            return False
        if "failed to load resource" in low and "404" in low:
            return False
        return ("429" in l) or (" 500 " in l) or ("HTTP 500" in l) or ("traceback" in low) or ("✗" in l) or ("FAIL：" in l)
    errs = [l for l in lines if is_real_failure(l)]
    if errs:
        return ("；".join(errs[:2]), "—", "有异常")
    return (" | ".join(tail[-2:])[:220], "—", "通过")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yaml", default=os.path.join(ROOT, "docs", "traceability.yaml"))
    ap.add_argument("--html", default=None)
    args = ap.parse_args()

    with open(args.yaml, encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    reqs = data.get("requirements", [])
    meta = data.get("meta", {})

    rows = []
    counts = {"通过": 0, "部分通过": 0, "不通过": 0, "有异常": 0, "未覆盖": 0, "不适用": 0, "见实际结果": 0}
    for i, r in enumerate(reqs, 1):
        rid = r.get("id", "")
        actual, ts, concl = extract_actual(r.get("evidence") or "")
        label, cls = STATUS_MARK.get(r.get("status"), ("?", "skip"))
        if r.get("status") == "not_done":
            concl = "不适用"
        counts[concl] = counts.get(concl, 0) + 1
        rows.append({
            "no": f"SAT-{i:02d}", "id": rid, "cat": r.get("category", ""),
            "item": r.get("requirement", ""), "method": r.get("verification", "") or "—",
            "actual": actual, "ts": ts, "concl": concl,
            "evidence": r.get("evidence", ""), "status_label": label, "status_cls": cls,
        })

    tr = []
    for x in rows:
        c_cls = {"通过": "ok", "部分通过": "part", "不通过": "no", "有异常": "no",
                 "未覆盖": "skip", "不适用": "skip", "见实际结果": "part"}.get(x["concl"], "skip")
        tr.append(f"""
      <tr>
        <td class="no">{x['no']}</td>
        <td class="rid">{html.escape(x['id'])}</td>
        <td>{html.escape(x['item'])}
            <div class="cat">{html.escape(x['cat'])}</div></td>
        <td class="mono-sm">{html.escape(x['method'])}</td>
        <td class="actual">{html.escape(x['actual'])}</td>
        <td class="ts">{html.escape(x['ts'])}</td>
        <td><span class="tag {c_cls}">{x['concl']}</span></td>
        <td class="ev">{html.escape(x['evidence'] or '—')}</td>
      </tr>""")

    summary = " · ".join(f"{k} {v}" for k, v in counts.items() if v)

    doc = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>SAT 验收测试记录 · SmartSCADA</title>
<style>
 :root{{--bg:#f6f7f9;--card:#fff;--ink:#1b1f24;--ink2:#59636e;--ink3:#8b949e;--line:#e2e5ea;
        --red:#cf222e;--green:#1a7f37;--amber:#9a6700;--blue:#0969da}}
 *{{box-sizing:border-box}}
 body{{margin:0;padding:32px 20px 64px;background:var(--bg);color:var(--ink);
      font:12.5px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}}
 .wrap{{max-width:1320px;margin:0 auto}}
 h1{{font-size:22px;margin:0 0 6px}}
 .sub{{color:var(--ink2);margin:0 0 8px;font-size:12.5px}}
 .sum{{color:var(--ink2);font-size:12px;margin:0 0 18px}}
 table{{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);
        border-radius:8px;overflow:hidden;font-size:11.5px}}
 th,td{{padding:7px 9px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}}
 th{{background:#fbfcfd;font-weight:600;color:var(--ink2);font-size:11px}}
 td.no{{font-variant-numeric:tabular-nums;color:var(--ink3);white-space:nowrap}}
 td.rid{{font-weight:600;white-space:nowrap}}
 td.actual{{max-width:400px;word-break:break-word}}
 td.ts{{white-space:nowrap;color:var(--ink2);font-variant-numeric:tabular-nums;font-size:11px}}
 td.ev{{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;color:var(--ink2);word-break:break-all}}
 .cat{{color:var(--ink3);font-size:10.5px}}
 .mono-sm{{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;color:var(--ink2);max-width:170px;word-break:break-all}}
 .tag{{display:inline-block;padding:1px 8px;border-radius:9px;font-size:10.5px;font-weight:600;white-space:nowrap}}
 .tag.ok{{background:#dafbe1;color:#1a7f37}} .tag.part{{background:#fff8c5;color:#9a6700}}
 .tag.no{{background:#ffebe9;color:#cf222e}} .tag.skip{{background:#eef1f4;color:#59636e}}
 .sign{{margin-top:26px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:18px 20px}}
 .sign h3{{margin:0 0 14px;font-size:13px}}
 .sign-grid{{display:grid;grid-template-columns:repeat(4,1fr);gap:22px}}
 .sign-item{{border-bottom:1px solid #bbb;padding-bottom:26px;font-size:11px;color:var(--ink3)}}
 .sign-item span{{display:block;margin-bottom:2px}}
 .note{{background:#eef5ff;border:1px solid #c7ddff;border-radius:8px;padding:11px 15px;
        font-size:12px;color:#14417a;margin:14px 0}}
 footer{{margin-top:26px;color:var(--ink3);font-size:11px}}
 @media print{{body{{background:#fff;padding:0}} tr{{break-inside:avoid}}}}
</style></head><body><div class="wrap">
 <h1>SAT 现场验收测试记录</h1>
 <p class="sub">{html.escape(str(meta.get('project','')))} · v{html.escape(str(meta.get('version','')))}
    · 测试日期 {html.escape(str(meta.get('date','')))}
    · 测试环境：{html.escape(str(meta.get('scope','')))}</p>
 <p class="sum">共 {len(rows)} 项 · {summary}</p>

 <div class="note">
   <strong>这张表的读法：</strong>「实际结果」一栏的数字/结论不是手写的，
   由 <code>tools/sat-report.py</code> 从 <code>reports/</code> 下的证据文件读取，
   连「执行时间」也是证据生成时自己打的时间戳。
   想质疑任何一条，按「证据」列打开文件即可 —— 也可以跑「验证方法」里的命令重来一遍。
 </div>

 <table>
  <thead><tr>
    <th style="width:6%">编号</th><th style="width:7%">需求</th><th style="width:22%">测试项</th>
    <th style="width:15%">验证方法</th><th style="width:26%">实际结果（来自证据文件）</th>
    <th style="width:9%">执行时间</th><th style="width:6%">结论</th><th style="width:9%">证据</th>
  </tr></thead>
  <tbody>{''.join(tr)}</tbody>
 </table>

 <div class="sign">
   <h3>签署</h3>
   <div class="sign-grid">
     <div class="sign-item"><span>测试人</span></div>
     <div class="sign-item"><span>复核人</span></div>
     <div class="sign-item"><span>使用方确认</span></div>
     <div class="sign-item"><span>日期</span></div>
   </div>
 </div>

 <footer>由 tools/sat-report.py 从 docs/traceability.yaml + reports/ 生成 ·
   {datetime.now().strftime('%Y-%m-%d %H:%M')}</footer>
</div></body></html>"""

    if args.html:
        with open(args.html, "w", encoding="utf-8") as fh:
            fh.write(doc)
        print(f"SAT 表已写入 {args.html}")

    print("=" * 70)
    print(f"{'编号':<10}{'需求':<10}{'结论':<10}测试项")
    for x in rows:
        print(f"{x['no']:<10}{x['id']:<10}{x['concl']:<10}{x['item'][:40]}")
    print(f"\n{summary}")


if __name__ == "__main__":
    main()
