#!/usr/bin/env python3
"""时钟一致性审计：一条记录里的几个时间字段，说的是不是同一个时刻？

工业现场的时间问题比互联网严重：采集端时钟、服务器时钟、数据库时间、前端显示，
是**四个**时间源。常见的三个坑：
  1. 同一条记录里 `timestamp`（业务时间，本地）和 `created_at`（SQLite CURRENT_TIMESTAMP，UTC）
     差了 8 小时——单看哪个都对，放在一起就是错的；
  2. 时间回退：后写入的记录时间戳比前一条更早（NTP 校正、夏令时、时区切换）；
  3. 时间戳重复：同一设备同一寄存器同一时刻写入多条，聚合时会重复计数。

本脚本只测量，不判断业务对错。差值分布是最硬的证据。

用法：
    python tools/clock-audit.py [--db <path>] [--table history_data] [--json out.json]
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sqlite3
from collections import Counter
from datetime import datetime

FMT_CANDIDATES = (
    "%Y-%m-%d %H:%M:%S.%f",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S.%f",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M:%S.%f%z",
    "%a, %d %b %Y %H:%M:%S GMT",
)


def parse_ts(v):
    if v is None:
        return None
    s = str(v).strip()
    for fmt in FMT_CANDIDATES:
        try:
            return datetime.strptime(s[:32], fmt)
        except ValueError:
            continue
    return None


def find_db() -> str:
    cands = [
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\smartscada\resources\backend\_internal\data\scada_simulated.db"),
        os.path.join(os.path.dirname(__file__), "..", "backend", "_internal", "data", "scada_simulated.db"),
    ]
    for c in cands:
        if os.path.exists(os.path.abspath(c)):
            return os.path.abspath(c)
    hits = glob.glob(os.path.join(os.path.dirname(__file__), "..", "**", "scada_simulated.db"), recursive=True)
    if hits:
        return os.path.abspath(hits[0])
    raise SystemExit("找不到数据库，请用 --db 指定")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=None)
    ap.add_argument("--table", default="history_data")
    ap.add_argument("--limit", type=int, default=200000, help="最多扫多少行（默认 20 万）")
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    db = args.db or find_db()
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    cur = con.cursor()
    table = args.table
    cols = [r[1] for r in cur.execute(f"PRAGMA table_info({table})")]
    if "timestamp" not in cols:
        raise SystemExit(f"{table} 没有 timestamp 列，实际列：{cols}")

    report = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "db": db,
        "table": table,
        "columns": cols,
        "checks": {},
        "findings": [],
    }

    # ---- 1. timestamp vs created_at 的偏差分布（最硬的一条） ----
    if "created_at" in cols:
        rows = cur.execute(
            f"SELECT timestamp, created_at FROM {table} "
            f"WHERE timestamp IS NOT NULL AND created_at IS NOT NULL LIMIT ?", (args.limit,)
        ).fetchall()
        diffs = Counter()
        unparsed = 0
        for ts, ca in rows:
            a, b = parse_ts(ts), parse_ts(ca)
            if a is None or b is None:
                unparsed += 1
                continue
            # 按小时取整归类，避免毫秒抖动把分布打散
            delta_h = round((a - b).total_seconds() / 3600)
            diffs[delta_h] += 1
        report["checks"]["timestamp_vs_created_at"] = {
            "sampled": len(rows),
            "unparsed": unparsed,
            "delta_hours_histogram": {str(k): v for k, v in sorted(diffs.items())},
        }
        if diffs:
            top_h, top_n = diffs.most_common(1)[0]
            share = top_n / max(1, sum(diffs.values()))
            if top_h != 0:
                report["findings"].append({
                    "severity": "high",
                    "title": f"同一行内两个时间字段系统性相差 {top_h:+d} 小时（占 {share:.1%}）",
                    "detail": (
                        f"{table}.timestamp 与 created_at 的差值中位落在 {top_h:+d} 小时。"
                        "典型成因是「一个用本地时间、一个用 SQLite CURRENT_TIMESTAMP（UTC）」。"
                        "单看任一字段都合理，放在一起就会让「这条数据是什么时候的」失去唯一答案。"
                    ),
                    "impact": "跨表关联、按时段聚合、事后追溯都会整体偏移 8 小时",
                })
            else:
                report["findings"].append({
                    "severity": "info",
                    "title": "timestamp 与 created_at 一致（差值 0）",
                    "detail": f"{top_n}/{sum(diffs.values())} 行差值为 0 小时。",
                    "impact": "无",
                })
    else:
        report["findings"].append({
            "severity": "warn",
            "title": f"{table} 没有 created_at，无法做入库时间比对",
            "detail": "只能做单列的顺序检查。",
            "impact": "无法验证「事件时间」和「入库时间」是否一致",
        })

    # ---- 2. 时间回退：同一设备+寄存器，后一行的时间早于前一行 ----
    try:
        rows = cur.execute(
            f"SELECT device_id, register_name, timestamp FROM {table} "
            f"WHERE timestamp IS NOT NULL ORDER BY device_id, register_name, id LIMIT ?", (args.limit,)
        ).fetchall()
        back_steps = 0
        worst = 0.0
        examples = []
        prev_key, prev_ts = None, None
        for dev, reg, ts in rows:
            key = (dev, reg)
            t = parse_ts(ts)
            if t is None:
                continue
            if key == prev_key and prev_ts is not None and t < prev_ts:
                back_steps += 1
                gap = (prev_ts - t).total_seconds()
                worst = max(worst, gap)
                if len(examples) < 3:
                    examples.append({
                        "device": dev, "register": reg,
                        "prev": prev_ts.isoformat(sep=" "), "curr": t.isoformat(sep=" "),
                        "back_seconds": round(gap, 1),
                    })
            prev_key, prev_ts = key, t
        report["checks"]["time_backwards"] = {
            "scanned": len(rows), "back_steps": back_steps,
            "worst_back_seconds": round(worst, 1), "examples": examples,
        }
        if back_steps:
            report["findings"].append({
                "severity": "warn",
                "title": f"检测到 {back_steps} 次时间回退（最大 {worst:.0f} 秒）",
                "detail": "同一测点后写入的数据时间戳早于前一条。画曲线会出现回折，聚合会重复计数。",
                "impact": "趋势图异常、统计失真",
                "examples": examples,
            })
        else:
            report["findings"].append({
                "severity": "info",
                "title": "无时间回退",
                "detail": f"扫描 {len(rows):,} 行，同一测点时间戳单调不减。",
                "impact": "无",
            })
    except sqlite3.Error as e:
        report["findings"].append({"severity": "warn", "title": "时间回退检查跳过", "detail": str(e), "impact": "-"})

    # ---- 3. 重复时间戳（同测点同秒多条） ----
    try:
        dup = cur.execute(
            f"SELECT COUNT(*) FROM ("
            f"  SELECT device_id, register_name, substr(timestamp,1,19) s, COUNT(*) c "
            f"  FROM {table} GROUP BY 1,2,3 HAVING c > 1 LIMIT 1)", ()
        ).fetchone()[0]
        total_dups = cur.execute(
            f"SELECT COALESCE(SUM(c-1),0) FROM ("
            f"  SELECT COUNT(*) c FROM {table} "
            f"  GROUP BY device_id, register_name, substr(timestamp,1,19) HAVING c > 1)", ()
        ).fetchone()[0]
        report["checks"]["duplicate_timestamps"] = {"extra_rows": int(total_dups or 0)}
        if total_dups:
            report["findings"].append({
                "severity": "info",
                "title": f"同测点同秒存在 {total_dups} 条重复记录",
                "detail": "采集周期小于 1 秒时属正常；若采集周期远大于 1 秒则说明重复入库。",
                "impact": "按秒聚合时会被重复计数",
            })
    except sqlite3.Error:
        pass

    con.close()

    print("=" * 68)
    print("时钟一致性审计")
    print("=" * 68)
    print(f"库: {report['db']}\n表: {table}\n时间: {report['generated_at']}\n")
    c1 = report["checks"].get("timestamp_vs_created_at")
    if c1:
        print(f"timestamp vs created_at（采样 {c1['sampled']:,} 行，无法解析 {c1['unparsed']}）:")
        for h, n in c1["delta_hours_histogram"].items():
            print(f"  差值 {int(h):+3d} 小时 : {n:>7,} 行")
        print()
    c2 = report["checks"].get("time_backwards")
    if c2:
        print(f"时间回退: {c2['back_steps']} 次（扫描 {c2['scanned']:,} 行，最大回退 {c2['worst_back_seconds']} 秒）")
        for ex in c2.get("examples", []):
            print(f"   {ex['device']}/{ex['register']}: {ex['prev']} → {ex['curr']}（-{ex['back_seconds']}s）")
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
