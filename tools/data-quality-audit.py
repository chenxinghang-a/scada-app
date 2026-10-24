#!/usr/bin/env python3
"""数据质量审计：值可不可信，系统自己知道吗？

工业系统的老毛病：传感器坏了、通信超时，UI 仍然显示**最后一次有效值**，
操作员据此决策。OPC UA 用 StatusCode、Modbus 用异常码表达"这个值可不可信"，
真正的问题是**这个信息有没有被存下来、有没有传到人眼看到的地方**。

本脚本只做一件事：把"质量信息在系统里的覆盖率"算清楚。
不评价好坏，只给数字——覆盖率 0% 的地方，事后无法区分真假。

用法：
    python tools/data-quality-audit.py [--db <path>] [--json <out.json>]
默认库：从安装目录自动探测，找不到就用仓库里的 dev 库。
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sqlite3
from collections import Counter
from datetime import datetime

# OPC UA StatusCode 高 2 位（Good=00, Uncertain=01, Bad=10）
# 0xC0 = 192 → 二进制 1100_0000，高两位 11 其实是 "Bad"? 不，OPC UA 的 Good 是 0x00000000，
# 但很多网关用 192(0xC0) 表示 Good。这里按「显著位」解释并给出两种常见约定。
QUALITY_MEANING = {
    0: "Bad（不可用）",
    64: "Uncertain（不确定）",
    192: "Good（192 = 0xC0，网关常用约定）",
}


def find_db() -> str:
    candidates = [
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\smartscada\resources\backend\_internal\data\scada_simulated.db"),
        os.path.join(os.path.dirname(__file__), "..", "backend", "_internal", "data", "scada_simulated.db"),
    ]
    for c in candidates:
        c = os.path.abspath(c)
        if os.path.exists(c):
            return c
    hits = glob.glob(os.path.join(os.path.dirname(__file__), "..", "**", "scada_simulated.db"), recursive=True)
    if hits:
        return os.path.abspath(hits[0])
    raise SystemExit("找不到数据库，请用 --db 指定")


def columns(cur, table: str) -> list[str]:
    try:
        return [r[1] for r in cur.execute(f"PRAGMA table_info({table})")]
    except sqlite3.Error:
        return []


def count(cur, table: str) -> int:
    try:
        return cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    except sqlite3.Error:
        return 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=None)
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    db = args.db or find_db()
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    cur = con.cursor()

    report = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "db": db,
        "tables": {},
        "findings": [],
    }

    # ---- 1. 结构层：每张"存测量值"的表有没有 quality 列 ----
    for t in ("realtime_data", "history_data"):
        cols = columns(cur, t)
        total = count(cur, t)
        has_q = "quality" in cols
        entry = {
            "rows": total,
            "has_quality_column": has_q,
            "columns": cols,
        }
        if has_q and total:
            dist = cur.execute(f"SELECT quality, COUNT(*) FROM {t} GROUP BY quality ORDER BY 2 DESC").fetchall()
            entry["quality_distribution"] = [
                {"code": c, "count": n, "meaning": QUALITY_MEANING.get(c, f"未知码 {c}")} for c, n in dist
            ]
            bad = sum(n for c, n in dist if c not in (192, 0xC0))
            entry["non_good_rows"] = bad
        report["tables"][t] = entry

    # ---- 2. 覆盖率结论 ----
    hist = report["tables"].get("history_data", {})
    rt = report["tables"].get("realtime_data", {})
    if not hist.get("has_quality_column") and hist.get("rows"):
        report["findings"].append({
            "severity": "high",
            "title": "历史数据没有质量列，坏值无法事后追溯",
            "detail": (
                f"history_data 共 {hist['rows']:,} 条，表结构里没有 quality 字段。"
                "意味着历史曲线上的每一个点都无法区分「当时测到的是真值」还是"
                "「通信中断后沿用/插补的旧值」。实时表有 quality 但只在内存窗口里有效，"
                "落盘到历史表时被丢弃。"
            ),
            "impact": "事后回溯事故时，无法回答「当时那个 180°C 是真的吗」",
        })
    if rt.get("has_quality_column") and rt.get("rows"):
        dist = rt.get("quality_distribution") or []
        if len(dist) == 1 and dist[0]["code"] in (192, 0xC0):
            report["findings"].append({
                "severity": "info",
                "title": "实时数据质量全部为 Good——是真实情况，还是没测过坏值",
                "detail": (
                    f"realtime_data 共 {rt['rows']:,} 条，quality 全部是 192/0xC0。"
                    "模拟模式下设备不会真的通信失败，所以这个 100% Good 不构成"
                    "「质量机制有效」的证据，只能说明**还没有被坏数据检验过**。"
                ),
                "impact": "需要一次「注入坏质量」的演练才能证明质量机制真的会起作用",
            })

    # ---- 3. 数值层：物理上不可能的值（NaN、超量程、长期不变） ----
    try:
        bad_vals = cur.execute(
            "SELECT COUNT(*) FROM realtime_data WHERE value IS NULL OR value != value"
        ).fetchone()[0]
        if bad_vals:
            report["findings"].append({
                "severity": "high",
                "title": f"实时数据里有 {bad_vals} 条 NULL/NaN",
                "detail": "NaN 与任何数比较都返回 False，量程校验会放行，必须显式拦截。",
                "impact": "下游算法会把 NaN 当有效值参与计算",
            })
    except sqlite3.Error:
        pass

    # ---- 4. 时间戳新鲜度（数据是不是停更了还显示"在线"） ----
    try:
        row = cur.execute("SELECT MAX(timestamp) FROM realtime_data").fetchone()
        if row and row[0]:
            newest = row[0]
            parsed = None
            for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"):
                try:
                    parsed = datetime.strptime(str(newest)[:26], fmt)
                    break
                except ValueError:
                    continue
            if parsed:
                age = (datetime.now() - parsed).total_seconds()
                report["tables"]["realtime_data"]["newest_timestamp"] = str(newest)
                report["tables"]["realtime_data"]["age_seconds"] = round(age, 1)
                if age > 120:
                    report["findings"].append({
                        "severity": "warn",
                        "title": f"实时数据已 {age/60:.1f} 分钟没有更新",
                        "detail": f"最新一条 timestamp = {newest}。如果此时后端进程还在跑，说明采集停了但没人知道。",
                        "impact": "UI 会继续显示这些旧值，看起来一切正常",
                    })
    except sqlite3.Error:
        pass

    con.close()

    # ---- 输出 ----
    print("=" * 68)
    print("数据质量审计")
    print("=" * 68)
    print(f"库: {report['db']}")
    print(f"时间: {report['generated_at']}\n")
    print(f"{'表':<16}{'行数':>10}  {'有 quality 列':<14}{'非 Good 行数':>12}")
    for t, e in report["tables"].items():
        print(f"{t:<16}{e['rows']:>10,}  {'是' if e.get('has_quality_column') else '否':<14}"
              f"{e.get('non_good_rows', '-'):>12}")
    if report["tables"].get("realtime_data", {}).get("quality_distribution"):
        print("\nrealtime_data 质量码分布:")
        for d in report["tables"]["realtime_data"]["quality_distribution"]:
            print(f"  {d['code']:>4} ({d['code']:#04x})  {d['count']:>6} 条  {d['meaning']}")

    print(f"\n发现 {len(report['findings'])} 项:")
    for i, f in enumerate(report["findings"], 1):
        tag = {"high": "严重", "warn": "注意", "info": "说明"}[f["severity"]]
        print(f"\n[{i}] ({tag}) {f['title']}")
        print(f"    {f['detail']}")
        print(f"    影响: {f['impact']}")
    if not report["findings"]:
        print("  （无）")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(report, fh, ensure_ascii=False, indent=2)
        print(f"\nJSON 已写入 {args.json}")

    # 退出码：有 high 就非 0，方便接 CI
    raise SystemExit(1 if any(f["severity"] == "high" for f in report["findings"]) else 0)


if __name__ == "__main__":
    main()
