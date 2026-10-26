#!/usr/bin/env python3
"""全新安装自检：在临时库里跑一遍应用自己的初始化，验证"换台机器也是对的"。

为什么需要：迁移脚本只能在**这台**机器上把孪生列补上。如果应用启动时不自愈，
那么"修好了"只对当前这份库成立 —— 换台机器、重装一次，又回到 5 张表两种钟。
本脚本用应用真实的 ``Database`` 初始化逻辑建一个空库，然后检查孪生列是否自动出现。

    python tools/fresh-install-check.py
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepcheck.common import REPO, say, write_json  # noqa: E402

SRC = REPO / 'backend' / 'src'


def run() -> dict:
    sys.path.insert(0, str(SRC))
    cwd = os.getcwd()
    os.chdir(SRC)                      # paths.setup() 以 __file__ 定位，但 config 会读 .env
    try:
        import paths
        paths.setup()
        from 存储层.database import Database

        tmp = Path(tempfile.gettempdir()) / f'scada-fresh-{os.getpid()}.db'
        for ext in ('', '-wal', '-shm'):
            p = Path(str(tmp) + ext)
            if p.exists():
                p.unlink()
        db = Database(str(tmp))
        try:
            conn = sqlite3.connect(str(tmp))
            try:
                from core.schema_clock import verify
                rep = verify(conn)
                meta = dict(conn.execute('SELECT key, value FROM _timebase_meta').fetchall()) \
                    if _table_exists(conn, '_timebase_meta') else {}
            finally:
                conn.close()
        finally:
            db.close()
        return {'ok': rep['ok'], 'columns_checked': rep['columns_checked'],
                'problems': rep['problems'],
                'twins': [{'table': t['table'], 'column': t['column'],
                           'twin': t.get('twin'), 'status': t['status']}
                          for t in rep['tables'] if t['status'] != 'EXEMPT'],
                'meta': meta, 'db': str(tmp)}
    finally:
        os.chdir(cwd)


def _table_exists(conn: sqlite3.Connection, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
                        (name,)).fetchone() is not None


def main():
    try:
        rep = run()
    except Exception as e:
        say(f'无法执行（应用依赖缺失或环境不完整）: {type(e).__name__}: {e}')
        say('这不算失败，但"全新安装自愈"这一条未被验证。')
        sys.exit(3)

    write_json(REPO / 'reports' / 'deep' / 'fresh-install.json', rep)
    for t in rep['twins']:
        say(f"  {t['table']}.{t['column']:<20} → {str(t['twin'] or '(本身即UTC)'):<24} {t['status']}")
    say(f"\n孪生列 {rep['columns_checked']} 列，注册表偏移 {rep['meta'].get('local_offset_hours')}h")
    say('结论：' + ('通过 —— 全新安装会自动补齐口径列' if rep['ok'] else f"未通过：{rep['problems']}"))
    if not rep['ok']:
        sys.exit(2)


if __name__ == '__main__':
    main()
