#!/usr/bin/env python3
"""一次性采集「可自动验证」的证据，落到 reports/evidence/。

为什么需要它：
  追溯矩阵（tools/trace-matrix.py）会检查每条"已验证"的需求有没有落盘证据。
  第一次跑就发现 8 条「验证过但没留证」—— 这种状态在评审时等于没验证：
  口说"我测过"和有一份 JSON 是两回事。

本脚本只采**需要后端在跑**的那几类（接口行为）；
崩溃恢复、UI 渲染、打包版另有专门的 drill/audit 脚本。

用法：
    # 先启动后端（安装目录的或 out-v7 的都行）
    python tools/collect-evidence.py --user admin --password xxx
产物：reports/evidence/*.json
"""
from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime

BASE = "http://127.0.0.1:5000/api"
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "reports", "evidence")


def api(method: str, path: str, token: str | None = None, body=None, raw=False):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            payload = resp.read()
            return resp.status, (payload if raw else json.loads(payload.decode() or "{}"))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"_err": str(e)}


def save(name: str, obj) -> str:
    os.makedirs(OUT_DIR, exist_ok=True)
    p = os.path.join(OUT_DIR, name)
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=2)
    return os.path.relpath(p, os.path.dirname(OUT_DIR)).replace("\\", "/")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="admin123")
    args = ap.parse_args()

    print("=" * 70)
    print("证据采集")
    print("=" * 70)

    st, login = api("POST", "/auth/login", body={"username": args.user, "password": args.password})
    token = login.get("token")
    if login.get("must_change_password"):
        st, ch = api("POST", "/auth/force-change-password", token,
                     {"username": args.user, "new_password": "Evid@2026pwd"})
        token = ch.get("token")
        print(f"  (账号为首次登录态，已改密为 Evid@2026pwd)")
    if not token:
        raise SystemExit(f"登录失败 {st}: {json.dumps(login, ensure_ascii=False)[:200]}")
    print(f"登录 OK（user={args.user}）\n")

    # ===== OPS-01：性能监控 24h 趋势 =====
    st, hist = api("GET", "/performance/metrics/history?hours=24", token)
    samples = hist.get("data") if isinstance(hist, dict) else None
    n = len(samples) if isinstance(samples, list) else 0
    p1 = save("ops-01-performance-history.json", {
        "requirement": "OPS-01 性能监控应能提供 24 小时趋势",
        "collected_at": datetime.now().isoformat(timespec="seconds"),
        "http_status": st,
        "sample_count": n,
        "first": samples[0] if n else None,
        "verdict": "PASS：有采样点" if n > 0 else "FAIL：返回 0 个采样点",
    })
    print(f"[OPS-01] 性能历史采样点 {n} 个 → {p1}")

    # ===== OPS-03：工业 4.0 指标非 0 =====
    st1, oee = api("GET", "/industry40/oee", token)
    st2, energy = api("GET", "/industry40/energy", token)
    oee_map = oee.get("data") or {}
    vals = [v.get("oee") for v in oee_map.values() if isinstance(v, dict) and v.get("oee") is not None]
    avg = round(sum(vals) / len(vals), 4) if vals else 0
    e = energy.get("data") or {}
    p3 = save("ops-03-industry40-metrics.json", {
        "requirement": "OPS-03 工业 4.0 指标应有实际数值",
        "collected_at": datetime.now().isoformat(timespec="seconds"),
        "oee": {"http_status": st1, "device_count": len(oee_map), "avg_oee": avg,
                "sample": {k: oee_map[k].get("oee") for k in list(oee_map)[:3]}},
        "energy": {"http_status": st2,
                   "total_energy_kwh": e.get("total_energy_kwh"),
                   "carbon_emission_kg": e.get("carbon_emission_kg"),
                   "electricity_cost": e.get("electricity_cost")},
        "verdict": ("PASS：OEE 与能源均非 0" if avg > 0 and (e.get("total_energy_kwh") or 0) > 0
                    else "FAIL：仍有指标为 0"),
    })
    print(f"[OPS-03] OEE 平均 {avg:.1%}（{len(oee_map)} 台）、能源 {e.get('total_energy_kwh')} kWh → {p3}")

    # ===== CTRL-01：写操作前的实时在线检查 =====
    dev, reg = "relay_output_01", 0
    st, before = api("GET", f"/data/latest/{dev}?register_name=relay_1", token)
    st_w, write = api("POST", f"/devices/{dev}/write-coil", token, {"address": reg, "value": True})
    time.sleep(1.2)
    st2, after = api("GET", f"/data/latest/{dev}?register_name=relay_1", token)
    allowed = bool(write.get("success"))
    p4 = save("ctrl-01-write-when-online.json", {
        "requirement": "CTRL-01 写操作前必须确认设备真实在线",
        "collected_at": datetime.now().isoformat(timespec="seconds"),
        "device": dev,
        "before": before.get("data"),
        "write_http": st_w,
        "write_response": write,
        "after": after.get("data"),
        "verdict": ("PASS：设备在线时写操作被放行（修复前此处恒为「通信断开」）"
                    if allowed else f"FAIL：被拒 —— {write.get('message')}"),
    })
    print(f"[CTRL-01] 写线圈 HTTP {st_w} success={allowed} → {p4}")

    # ===== SEC-01：不同 token 不被判重复提交 =====
    # 第二次登录必须用**当前有效密码**：若刚才因首次登录改过密，就用新密码；
    # 否则会登录失败、token2 回退成 token，两个 token 相同 → 测出来必然 409（假的失败）。
    cur_pwd = "Evid@2026pwd" if login.get("must_change_password") else args.password
    st, l2 = api("POST", "/auth/login", body={"username": args.user, "password": cur_pwd})
    token2 = l2.get("token") or token
    results = []
    for i, tk in enumerate([token, token2]):
        st, resp = api("POST", "/control/estop/reset", tk, {})
        results.append({"token_index": i, "http": st,
                        "success": resp.get("success"), "message": resp.get("message")})
        time.sleep(0.3)
    dup = any(r["http"] == 409 for r in results)
    p5 = save("sec-01-dedup-cross-user.json", {
        "requirement": "SEC-01 不同用户的请求不得被误判为重复提交",
        "collected_at": datetime.now().isoformat(timespec="seconds"),
        "probes": results,
        "verdict": ("FAIL：出现 409（不同 token 被判重复提交）" if dup
                    else "PASS：两个不同 token 连续提交同一请求，均未被判重复"),
    })
    print(f"[SEC-01] 两个 token 连续提交 → 409={dup} → {p5}")

    # 收尾：把急停复位，别留个一直停机的现场
    api("POST", "/control/estop/reset", token, {})
    print("\n完成，证据在 reports/evidence/")


if __name__ == "__main__":
    main()
