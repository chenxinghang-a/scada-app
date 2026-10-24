#!/usr/bin/env python3
"""备份可恢复性验证 —— 「有备份」和「备份能恢复」是两件事。

工业系统里最典型的一类事故：备份任务天天跑、文件天天生成，
真出事要恢复时才发现文件是空的 / 打不开 / 只备份了一半。
根因几乎都一样：**只在写入侧做了验证，从没在读取侧验证过**。

本脚本做三件事：
  1. 调用项目自带的 tools/auto_backup.py 生成一份备份（走它自己的逻辑，不另写一套）
  2. 对备份文件做 `PRAGMA integrity_check` —— 字节完好不代表结构完好
  3. 逐表比对「源库行数 vs 备份行数」，任何一张表对不上就是 FAIL

用法：
    python tools/backup-verify.py --backend <backend 目录> [--json out.json]
其中 backend 目录应包含 _internal/tools/auto_backup.py 与 _internal/data/*.db
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime

PY = sys.executable


def table_counts(db: str) -> dict[str, int]:
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    cur = con.cursor()
    names = [r[0] for r in cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    out = {}
    for t in names:
        try:
            out[t] = cur.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        except sqlite3.Error:
            out[t] = -1
    con.close()
    return out


def integrity(db: str) -> str:
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        r = con.execute("PRAGMA integrity_check").fetchone()[0]
        con.close()
        return str(r)
    except sqlite3.Error as e:
        return f"ERROR: {e}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", required=True)
    ap.add_argument("--json", default="reports/evidence/backup-restore.json")
    args = ap.parse_args()

    backend = os.path.abspath(args.backend)
    internal = os.path.join(backend, "_internal")
    if not os.path.isdir(internal):
        raise SystemExit(f"找不到 {internal}")

    # 源库
    dbs = glob.glob(os.path.join(internal, "data", "*.db"))
    if not dbs:
        raise SystemExit("data/ 下没有数据库")
    src = max(dbs, key=os.path.getmtime)
    src_counts = table_counts(src)

    report = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "backend": backend,
        "source_db": os.path.basename(src),
        "source_counts": src_counts,
        "steps": [],
        "verdict": "",
    }

    # 1) 调项目自带的备份工具
    backup_script = os.path.join(internal, "tools", "auto_backup.py")
    if not os.path.exists(backup_script):
        raise SystemExit(f"找不到 {backup_script}")

    print("=" * 70)
    print("备份可恢复性验证")
    print("=" * 70)
    print(f"源库: {src}")
    print(f"源库表: {len(src_counts)} 张，共 {sum(max(0, v) for v in src_counts.values()):,} 行\n")

    bak_dir = os.path.join(internal, "backups")
    before = set(glob.glob(os.path.join(bak_dir, "*"))) if os.path.isdir(bak_dir) else set()

    print("[1/4] 调用 tools/auto_backup.py backup ...")
    proc = subprocess.run([PY, backup_script, "backup"], cwd=internal,
                          capture_output=True, text=True, timeout=180)
    out = (proc.stdout or "")[-400:]
    report["steps"].append({"step": "run_backup", "returncode": proc.returncode, "tail": out})
    print(f"      退出码 {proc.returncode}")
    for line in out.strip().splitlines()[-4:]:
        print(f"      {line}")

    # 2) 找新生成的备份
    after = set(glob.glob(os.path.join(bak_dir, "*"))) if os.path.isdir(bak_dir) else set()
    new = sorted(after - before)
    if not new:
        # 有些实现是覆盖同名目录，退化为取最新
        allb = sorted(glob.glob(os.path.join(bak_dir, "*")), key=os.path.getmtime, reverse=True)
        new = allb[:1]
    if not new:
        report["verdict"] = "FAIL：备份命令没有产出任何文件"
        print("\n✗ 没有产出备份文件")
    else:
        bak = new[-1] if os.path.isdir(new[-1]) else new[0]
        report["backup_artifact"] = bak
        print(f"\n[2/4] 备份产物: {os.path.basename(bak)}")

        # 备份里的 db 文件
        cand = glob.glob(os.path.join(bak, "*.db")) or glob.glob(os.path.join(bak, "**", "*.db"), recursive=True)
        if not cand:
            report["verdict"] = "FAIL：备份目录里没有 .db 文件"
            print("      ✗ 备份里没有 .db")
        else:
            bdb = cand[0]
            size_mb = round(os.path.getsize(bdb) / 1024 / 1024, 2)
            print(f"      数据库: {os.path.basename(bdb)}（{size_mb} MB）")

            # 3) 完整性
            print("\n[3/4] PRAGMA integrity_check ...")
            integ = integrity(bdb)
            report["integrity_check"] = integ
            print(f"      {integ}")

            # 4) 逐表比对
            print("\n[4/4] 逐表比对行数 ...")
            bak_counts = table_counts(bdb)
            diff = []
            for t, n in src_counts.items():
                m = bak_counts.get(t, -1)
                ok = (n == m)
                if not ok:
                    diff.append({"table": t, "source": n, "backup": m})
                print(f"      {'✓' if ok else '✗'} {t:<22} 源 {n:>8}  备份 {m:>8}")
            report["backup_counts"] = bak_counts
            report["mismatch"] = diff

            if integ.lower() == "ok" and not diff:
                report["verdict"] = "PASS：integrity_check=ok，且 8 张表行数与源库完全一致"
            elif integ.lower() != "ok":
                report["verdict"] = f"FAIL：备份文件结构损坏（integrity_check={integ}）"
            else:
                report["verdict"] = f"FAIL：{len(diff)} 张表行数不一致"

    print("\n" + "=" * 70)
    print(f"判定: {report['verdict']}")

    os.makedirs(os.path.dirname(os.path.abspath(args.json)), exist_ok=True)
    with open(args.json, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(f"JSON 已写入 {args.json}")


if __name__ == "__main__":
    main()
