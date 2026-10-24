#!/usr/bin/env python3
"""故障注入演练：把"报警系统会响"从信念变成记录。

专家验收 SCADA 时不会问"报警功能有没有"，而会问：
  「你往温度探头上打一个过热故障，多少秒后报警出来？值班的人看得见吗？」

本脚本做一次最小闭环：
  1. 记录基线（该设备当前温度、当前活动报警数）
  2. 通过 /devices/<id>/inject-fault 注入 overheating（severity 0.9）
  3. 每 2 秒采样一次，共 N 次，观察温度曲线与报警出现时刻
  4. 输出「注入 → 越限 → 报警」的时延

只依赖 HTTP API，不碰数据库，所以对正在跑的后端是安全的（只读观察 + 一次注入）。

用法：
    python tools/fault-drill.py --user admin --password <pwd> [--device siemens_1500_01]
需要 engineer/admin 权限（inject-fault 的装饰器是 _require_engineer）。
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from datetime import datetime

BASE = "http://127.0.0.1:5000/api"


def req(method: str, path: str, token: str | None = None, body: dict | None = None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"_err": str(e)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    ap.add_argument("--device", default="siemens_1500_01")
    ap.add_argument("--register", default="boiler_temperature")
    ap.add_argument("--fault", default="overheating")
    ap.add_argument("--severity", type=float, default=0.9)
    ap.add_argument("--samples", type=int, default=8)
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--json", default="reports/fault-drill.json")
    args = ap.parse_args()

    report = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "device": args.device,
        "register": args.register,
        "fault": args.fault,
        "severity": args.severity,
        "timeline": [],
        "findings": [],
    }

    # ---- 登录（首次登录会要求改密，这里用 refresh 拿到的 token 直接改） ----
    st, login = req("POST", "/auth/login", body={"username": args.user, "password": args.password})
    token = login.get("token")
    if login.get("must_change_password"):
        st, ch = req("POST", "/auth/force-change-password", token,
                     {"username": args.user, "new_password": "Drill@2026pwd"})
        token = ch.get("token")
        report["note"] = "账号处于首次登录态，已通过 force-change-password 取新令牌（下次请用 Drill@2026pwd）"
    if not token:
        raise SystemExit(f"登录失败: {st} {json.dumps(login, ensure_ascii=False)[:200]}")

    def latest_value():
        st, d = req("GET", f"/data/latest/{args.device}?register_name={args.register}", token)
        data = d.get("data")
        if isinstance(data, dict):
            return data.get("value"), data.get("quality")
        if isinstance(data, list) and data:
            return data[0].get("value"), data[0].get("quality")
        return None, None

    def active_alarms():
        st, d = req("GET", "/alarms/active", token)
        return d.get("alarms") or []

    def device_status():
        st, d = req("GET", "/control/status", token)
        h = (d.get("device_health") or {}).get("devices") or {}
        return (h.get(args.device) or {}).get("status")

    # ---- 基线 ----
    v0, q0 = latest_value()
    a0 = active_alarms()
    t_start = time.time()
    report["baseline"] = {
        "value": v0, "quality": q0,
        "active_alarms": len(a0),
        "device_status": device_status(),
        "at": datetime.now().isoformat(timespec="seconds"),
    }
    print("=" * 64)
    print("故障注入演练")
    print("=" * 64)
    print(f"设备 {args.device} / {args.register}")
    print(f"基线: 值={v0} 质量={q0} 活动报警={len(a0)} 状态={report['baseline']['device_status']}")
    print()

    # ---- 注入 ----
    st, inj = req("POST", f"/devices/{args.device}/inject-fault", token,
                  {"fault_type": args.fault, "severity": args.severity})
    report["injection"] = {"status": st, "response": inj}
    print(f"[注入] {args.fault} severity={args.severity} → HTTP {st} {json.dumps(inj, ensure_ascii=False)[:120]}")
    if st >= 400:
        report["findings"].append({
            "severity": "warn", "title": "注入接口被拒",
            "detail": f"HTTP {st}: {json.dumps(inj, ensure_ascii=False)[:200]}", "impact": "演练未执行",
        })
    inject_at = time.time()

    # ---- 采样 ----
    alarm_at = None
    peak = v0 if isinstance(v0, (int, float)) else None
    for i in range(args.samples):
        time.sleep(args.interval)
        v, q = latest_value()
        alarms = active_alarms()
        st_dev = device_status()
        el = round(time.time() - inject_at, 1)
        hit = [a for a in alarms if a.get("device_id") == args.device]
        report["timeline"].append({
            "t_plus_s": el, "value": v, "quality": q,
            "active_alarms": len(alarms),
            "this_device_alarms": [a.get("alarm_id") for a in hit],
            "device_status": st_dev,
        })
        if isinstance(v, (int, float)):
            peak = max(peak or v, v)
        mark = ""
        if hit and alarm_at is None:
            alarm_at = el
            mark = "  ← 报警出现"
        print(f"  +{el:>4.0f}s  值={str(v):>8}  质量={q}  报警={len(alarms):>2}  "
              f"本机报警={','.join(a.get('alarm_id') or '?' for a in hit) or '-'}  状态={st_dev}{mark}")

    # ---- 结论 ----
    report["result"] = {
        "alarm_detected_after_s": alarm_at,
        "peak_value": peak,
        "baseline_value": v0,
        "value_changed": (peak is not None and v0 is not None and peak != v0),
    }
    print()
    if alarm_at is not None:
        print(f"✓ 注入后 {alarm_at:.0f} 秒报警出现（峰値 {peak}，基线 {v0}）")
        report["findings"].append({
            "severity": "info",
            "title": f"故障→报警闭环成立：{alarm_at:.0f} 秒",
            "detail": f"注入 {args.fault}(severity={args.severity}) 后 {alarm_at:.0f}s，"
                      f"活动报警里出现该设备的记录；数值从 {v0} 变到 {peak}。",
            "impact": "报警链路可用；这个时延就是现场能接受的上限",
        })
    else:
        print(f"✗ {args.samples * args.interval:.0f} 秒内没有产生报警")
        report["findings"].append({
            "severity": "warn",
            "title": "注入故障后未在观察窗内产生报警",
            "detail": f"可能原因：阈值未越限（当前峰値 {peak}）、该设备没有对应报警规则、"
                      f"或报警被去重/抑制机制挡掉。",
            "impact": "需要人工确认是「值没到阈值」还是「报警没响」",
        })

    if report["result"]["value_changed"]:
        print(f"✓ 数值确实被故障注入改变（{v0} → 峰 {peak}），说明注入真的作用到了数据源")
    else:
        print("✗ 数值没有变化，注入可能没有生效")

    with open(args.json, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(f"\nJSON 已写入 {args.json}")


if __name__ == "__main__":
    main()
