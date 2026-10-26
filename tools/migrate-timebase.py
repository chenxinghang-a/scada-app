#!/usr/bin/env python3
"""时间基准迁移：给 history_data 补 ts_utc（权威 UTC）并回填存量。

    python tools/migrate-timebase.py            # 只出计划，不动数据（默认）
    python tools/migrate-timebase.py --apply    # 先备份，再迁移，再自检

为什么默认不写：这个脚本会改 30 万行的时间列。默认 dry-run、要求显式
``--apply``、并且**先做全库备份再动**，是因为"修时间"这类操作一旦方向搞反
（+8 写成 -8），数据看起来完全正常，只有对账时才会发现全错。

幂等：处理过一次后 ``_timebase_migrations`` 有记录，第二遍直接跳过。
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepcheck import timebase  # noqa: E402
from deepcheck.common import REPO, find_db, say, write_json  # noqa: E402


def backup(db: Path) -> Path:
    """备份三件套（db + wal + shm）：只拷 .db 会丢 WAL 里已提交的数据。"""
    dst_dir = db.parent / 'backups'
    dst_dir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    dst = dst_dir / f'{db.stem}-before-timebase-{stamp}.db'
    src_conn = sqlite3.connect(f'file:{db.as_posix()}?mode=ro', uri=True)
    dst_conn = sqlite3.connect(str(dst))
    try:
        src_conn.backup(dst_conn)
        dst_conn.commit()
        check = dst_conn.execute('PRAGMA integrity_check').fetchone()[0]
    finally:
        dst_conn.close()
        src_conn.close()
    if check != 'ok':
        raise RuntimeError(f'备份完整性检查失败: {check}')
    say(f'备份完成：{dst}（integrity_check=ok，'
        f'{dst.stat().st_size / 1048576:.1f} MB）')
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=None)
    ap.add_argument('--apply', action='store_true', help='真正写入（默认只出计划）')
    ap.add_argument('--offset-hours', type=float, default=None,
                    help='本地相对 UTC 的偏移；默认由系统时区算出')
    ap.add_argument('--json', default=str(REPO / 'reports' / 'deep' / 'timebase-migration.json'))
    args = ap.parse_args()

    db = find_db(args.db)
    offset = timebase.system_offset_hours() if args.offset_hours is None else args.offset_hours

    conn = sqlite3.connect(f'file:{db.as_posix()}?mode=ro', uri=True)
    try:
        cols = {r[1] for r in conn.execute('PRAGMA table_info(history_data)')}
        total = conn.execute('SELECT COUNT(*) FROM history_data').fetchone()[0]
        nulls = (conn.execute('SELECT COUNT(*) FROM history_data WHERE ts_utc IS NULL').fetchone()[0]
                 if 'ts_utc' in cols else total)
        try:
            done = timebase.already_applied(conn, 'history_data.timestamp')
        except sqlite3.Error:
            done = None
    finally:
        conn.close()

    plan = {
        'db': str(db),
        'rows_total': total,
        'rows_missing_ts_utc': nulls,
        'column_exists': 'ts_utc' in cols,
        'offset_hours': offset,
        'modifier': f'{-offset:+g} hours',
        'already_applied': done,
        'apply': args.apply,
    }
    say('迁移计划：')
    say(f"  库         {db}")
    say(f"  行数       {total}（缺 ts_utc 的 {nulls}）")
    say(f"  本地偏移   {offset:+g}h → 修饰符 {plan['modifier']}")
    say(f"  已迁移过   {done or '否'}")
    if done:
        say('  幂等跳过：本次不会重复换算（如需强制，用 --force 逻辑另行处理）')

    if not args.apply:
        say('\n这是 dry-run。加 --apply 才会写入（会先自动备份）。')
        write_json(Path(args.json), plan)
        return

    bak = backup(db)
    plan['backup'] = str(bak)

    conn = sqlite3.connect(str(db))
    try:
        rep = timebase.backfill(conn, offset_hours=offset)
        inv = timebase.check_invariant(conn)
    finally:
        conn.close()

    plan['migration'] = rep
    plan['invariant'] = inv
    write_json(Path(args.json), plan)

    say(f"\n写入 {rep['rows']} 行，ts_utc 已补全")
    say(f"自检：ts_utc 与 created_at 平均相差 {inv['mean_delta_seconds']} 秒"
        f"（最大 {inv['max_delta_seconds']} 秒，容差 {inv['tol_seconds']}）")
    say('结论：' + ('通过 —— 两条独立来源的 UTC 时间对得上' if inv['ok'] else '未通过 —— 见 json'))
    if not inv['ok']:
        sys.exit(2)


if __name__ == '__main__':
    main()
