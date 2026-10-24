#!/usr/bin/env python3
"""ISA-18.2 报警系统 KPI 报告。

标准出处：ANSI/ISA-18.2-2016《Management of Alarm Systems for the Process Industries》。
它规定的不是"要有报警"，而是**报警系统本身的健康度**要用数字说话。

本脚本算这 6 个指标（都能从 alarm_records 表直接算出来，不依赖后端在跑）：

  1. 报警率        条/小时。标准建议稳态 ≤6/小时/操作员，峰值 ≤12
  2. 优先级分布    critical 占比建议 ≤5%（全是 critical 等于没有优先级）
  3. Top N 频繁   同一条报警反复触发（chattering），是操作员最痛的点
  4. 陈旧报警      未确认且最后触发超过 24h
  5. MTTA          平均确认时长 = acknowledged_at - first_trigger_time
  6. 抖动          同一 alarm_id 在 1 小时内触发 > 5 次

用法：
    python tools/isa18-kpi.py [--db <path>] [--hours 24] [--json out.json]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timedelta

FMT = ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S")


def parse_ts(v):
    if v is None:
        return None
    s = str(v).strip()
    for f in FMT:
        try:
            return datetime.strptime(s[:26], f)
        except ValueError:
            continue
    return None


def find_db() -> str:
    for c in (
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\smartscada\resources\backend\_internal\data\scada_simulated.db"),
        os.path.join(os.path.dirname(__file__), "..", "backend", "_internal", "data", "scada_simulated.db"),
    ):
        if os.path.exists(os.path.abspath(c)):
            return os.path.abspath(c)
    hits = glob.glob(os.path.join(os.path.dirname(__file__), "..", "**", "scada_simulated.db"), recursive=True)
    if hits:
        return os.path.abspath(hits[0])
    raise SystemExit("找不到数据库，请用 --db 指定")


def grade_rate(v: float, ok: float, bad: float) -> str:
    if v <= ok:
        return "达标"
    if v <= bad:
        return "偏高"
    return "超标"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=None)
    ap.add_argument("--hours", type=int, default=24, help="统计时间窗（小时），默认 24")
    ap.add_argument("--json", default=None)
    ap.add_argument("--html", default=None)
    args = ap.parse_args()

    db = args.db or find_db()
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    rows = [dict(r) for r in cur.execute("SELECT * FROM alarm_records").fetchall()]
    con.close()

    now = datetime.now()
    window_start = now - timedelta(hours=args.hours)

    # 每条报警的"最近一次触发时刻"：优先 last_trigger_time，退回 timestamp
    def last_ts(a):
        return parse_ts(a.get("last_trigger_time")) or parse_ts(a.get("timestamp"))

    in_window = [a for a in rows if (last_ts(a) or window_start) >= window_start]

    # ⚠️ ISA-18.2 说的「报警次数」是**发生次数**，不是报警记录条数。
    #    alarm_records 对同一条报警是去重的（同一 alarm_id 反复触发只累加 trigger_count，
    #    不新增行），所以直接数行会把「1 小时触发 300 次」算成「1 条」。
    #    这里统一用 trigger_count 之和作为次数口径。
    def trip_count(a):
        try:
            return max(1, int(a.get('trigger_count') or 1))
        except (TypeError, ValueError):
            return 1
    total_trips = sum(trip_count(a) for a in in_window)

    report = {
        "generated_at": now.isoformat(timespec="seconds"),
        "db": db,
        "window_hours": args.hours,
        "total_records": len(rows),
        "records_in_window": len(in_window),
        "trips_in_window": total_trips,
        "kpi": {},
        "findings": [],
        "data_sufficiency": "sufficient",
    }

    # 样本量判定：<20 条时 KPI 的统计意义有限，必须明说
    if len(in_window) < 20:
        report["data_sufficiency"] = "insufficient"
        report["findings"].append({
            "severity": "warn",
            "title": f"窗口内只有 {len(in_window)} 条报警，KPI 仅作口径演示",
            "detail": (
                "ISA-18.2 的报警率、优先级占比都是**统计量**，样本太小时波动极大。"
                "本报告的数字算法正确，但不足以支撑「系统报警健康」的结论。"
                "要拿到有意义的数字，需要一段连续运行（工业现场通常取 30 天）。"
            ),
            "impact": "可以证明口径对，不能证明系统好",
        })

    # ---- 1. 报警率 ----
    by_hour = Counter()
    for a in in_window:
        t = last_ts(a)
        if t:
            by_hour[t.strftime("%Y-%m-%d %H:00")] += trip_count(a)
    peak = max(by_hour.values()) if by_hour else 0
    avg_rate = total_trips / max(1, args.hours)
    report["kpi"]["alarm_rate"] = {
        "avg_per_hour": round(avg_rate, 2),
        "peak_per_hour": peak,
        "standard": {"steady_max": 6, "peak_max": 12},
        "verdict": grade_rate(avg_rate, 6, 12),
        "hourly": dict(sorted(by_hour.items())),
    }
    if avg_rate > 6:
        report["findings"].append({
            "severity": "high",
            "title": f"平均报警率 {avg_rate:.1f} 条/小时，超过 ISA-18.2 的 6 条/小时",
            "detail": "报警率过高会让操作员开始忽略报警（alarm flood 的前兆）。",
            "impact": "关键报警可能被淹没",
        })

    # ---- 2. 优先级分布 ----
    lv = Counter((a.get("alarm_level") or "unknown").lower() for a in in_window)
    total = sum(lv.values()) or 1
    crit_share = lv.get("critical", 0) / total
    report["kpi"]["priority_distribution"] = {
        "counts": dict(lv),
        "critical_share": round(crit_share, 3),
        "standard": {"critical_max_share": 0.05},
        "verdict": "达标" if crit_share <= 0.05 else "超标",
    }
    if crit_share > 0.05:
        report["findings"].append({
            "severity": "warn",
            "title": f"高优先级（critical）占 {crit_share:.0%}，标准建议 ≤5%",
            "detail": "HIGH/CRIT 过多意味着优先级分层失效——所有报警都重要 = 没有重要的。",
            "impact": "操作员的注意力被平均分配，真正的严重事件不突出",
        })

    # ---- 3. Top N 频繁报警 ----
    freq = Counter(a.get("alarm_id") or "?" for a in in_window)
    top = freq.most_common(10)
    report["kpi"]["top_alarms"] = [{"alarm_id": k, "count": v} for k, v in top]
    if top and total >= 20:
        top1_share = top[0][1] / total
        if top1_share > 0.1:
            report["findings"].append({
                "severity": "warn",
                "title": f"单条报警「{top[0][0]}」占全部报警的 {top1_share:.0%}",
                "detail": "ISA-18.2 要求 Top 10 报警合计不超过总数 10%。单条超 10% 属于典型的 chattering（抖动）。",
                "impact": "这条报警会持续占用操作员注意力，掩盖真正的异常",
            })

    # ---- 4. 陈旧报警 ----
    stale = []
    for a in rows:
        if a.get("acknowledged"):
            continue
        t = last_ts(a)
        if t and (now - t).total_seconds() > 24 * 3600:
            stale.append({
                "alarm_id": a.get("alarm_id"),
                "device_id": a.get("device_id"),
                "last": t.isoformat(sep=" "),
                "age_hours": round((now - t).total_seconds() / 3600, 1),
            })
    report["kpi"]["stale_alarms"] = {"count": len(stale), "items": stale[:20]}
    if stale:
        report["findings"].append({
            "severity": "warn",
            "title": f"{len(stale)} 条报警超过 24 小时未确认",
            "detail": "ISA-18.2 要求陈旧报警数为 0：要么它该被处理，要么它根本不该存在于报警列表里。",
            "impact": "报警列表被无意义项占据，新报警不显眼",
        })

    # ---- 5. MTTA ----
    mttas = []
    for a in rows:
        if not a.get("acknowledged"):
            continue
        t0 = parse_ts(a.get("timestamp"))
        t1 = parse_ts(a.get("acknowledged_at"))
        if t0 and t1 and t1 >= t0:
            mttas.append((t1 - t0).total_seconds())
    if mttas:
        mttas.sort()
        report["kpi"]["mtta_seconds"] = {
            "count": len(mttas),
            "avg": round(sum(mttas) / len(mttas), 1),
            "p50": round(mttas[len(mttas) // 2], 1),
            "max": round(mttas[-1], 1),
        }
    else:
        report["kpi"]["mtta_seconds"] = {"count": 0, "note": "没有「已确认」的报警，无法计算"}

    # ---- 6. 抖动 ----
    by_id_hour = defaultdict(Counter)
    for a in in_window:
        t = last_ts(a)
        if t:
            by_id_hour[a.get("alarm_id") or "?"][t.strftime("%Y-%m-%d %H")] += 1
    chatter = []
    for aid, hours in by_id_hour.items():
        worst_h, worst_n = hours.most_common(1)[0]
        if worst_n > 5:
            chatter.append({"alarm_id": aid, "hour": worst_h, "count": worst_n})
    report["kpi"]["chattering"] = {"count": len(chatter), "items": chatter}

    # ---- 输出 ----
    print("=" * 70)
    print("ISA-18.2 报警系统 KPI")
    print("=" * 70)
    print(f"库: {report['db']}")
    print(f"统计窗口: 最近 {args.hours} 小时   记录总数: {len(rows)}   窗口内: {len(in_window)}")
    print(f"样本量: {'充足' if report['data_sufficiency'] == 'sufficient' else '不足（仅演示口径）'}\n")

    r = report["kpi"]["alarm_rate"]
    print(f"1. 报警率        {r['avg_per_hour']:>6.2f} 条/小时   峰值 {r['peak_per_hour']:>3}/小时   "
          f"标准 ≤6/{r['verdict']}")
    p = report["kpi"]["priority_distribution"]
    print(f"2. 优先级分布    critical {p['counts'].get('critical',0)} / warning {p['counts'].get('warning',0)}"
          f" / 其他 {sum(v for k,v in p['counts'].items() if k not in ('critical','warning'))}"
          f"   critical 占比 {p['critical_share']:.1%}  标准 ≤5%/{p['verdict']}")
    print("3. Top 频繁报警  " + (", ".join(f"{x[0]}×{x[1]}" for x in top[:5]) or "（无）"))
    print(f"4. 陈旧报警      {report['kpi']['stale_alarms']['count']} 条（>24h 未确认）")
    m = report["kpi"]["mtta_seconds"]
    print(f"5. MTTA          " + (f"均值 {m['avg']}s / P50 {m['p50']}s / 最大 {m['max']}s（n={m['count']}）"
                                if m.get("count") else m.get("note", "-")))
    print(f"6. 抖动          {report['kpi']['chattering']['count']} 条（单小时 >5 次）")

    print(f"\n发现 {len(report['findings'])} 项:")
    for i, f in enumerate(report["findings"], 1):
        tag = {"high": "严重", "warn": "注意", "info": "说明"}[f["severity"]]
        print(f"\n[{i}] ({tag}) {f['title']}")
        print(f"    {f['detail']}")
        print(f"    影响: {f['impact']}")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=2)
        print(f"\nJSON 已写入 {args.json}")


if __name__ == "__main__":
    main()
