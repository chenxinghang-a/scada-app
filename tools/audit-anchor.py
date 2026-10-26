#!/usr/bin/env python3
"""审计链外部锚点：钉一个锚 / 校验锚。

    python tools/audit-anchor.py                 # 看当前锚点与库是否一致
    python tools/audit-anchor.py --pin           # 把当前链头钉成新锚点（写文件）
    python tools/audit-anchor.py --pin --json x

为什么需要它：哈希链抓不到**尾部截断**（删掉最后几条，链内仍自洽）。
把 ``(条数, 最大 seq, 链头哈希)`` 钉到仓库文件里并随 git 提交，
截断/重写就会在下次校验时暴露。

生产建议：每日一次 ``--pin`` 并提交，锚点文件进版本库 → 真正的不可抵赖
来自 git 历史。**边界**：能重写整个仓库历史的人仍可伪造，
那一类只能靠 WORM 存储或外部时间戳，本工具不假装能覆盖。
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepcheck import anchor as anchor_mod  # noqa: E402
from deepcheck.common import find_db, say, write_json  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=None)
    ap.add_argument('--pin', action='store_true', help='把当前链头钉成新锚点')
    ap.add_argument('--note', default='', help='锚点备注（会写进文件）')
    ap.add_argument('--file', default=str(anchor_mod.ANCHOR_FILE))
    ap.add_argument('--json', default=None)
    args = ap.parse_args()

    db = find_db(args.db)
    path = Path(args.file)
    conn = sqlite3.connect(f'file:{db.as_posix()}?mode=ro', uri=True)
    try:
        if args.pin:
            print_conn = sqlite3.connect(str(db))
            try:
                res = anchor_mod.make(print_conn, path, note=args.note)
            finally:
                print_conn.close()
            if not res['ok']:
                say(f'未锚定：{res["reason"]}')
                sys.exit(2)
            a = res['anchor']
            say(f"{'锚点已存在（链头未变）' if res.get('unchanged') else '已钉新锚点'}："
                f"entries={a['entries']} last_seq={a['last_seq']} "
                f"head={a['head_hash'][:12]}")
        rep = anchor_mod.verify(conn, path)
    finally:
        conn.close()

    say(f"状态       {rep['status']}")
    say(f"说明       {rep['reason']}")
    say(f"锚点数     {rep.get('anchors')}")
    if rep.get('anchored_entries') is not None:
        say(f"锚定条数   {rep['anchored_entries']}（当前库 {rep.get('current_entries')}）")
    if args.json:
        write_json(Path(args.json), rep)
    if not rep['ok'] and rep['status'] != 'UNANCHORED':
        sys.exit(2)


if __name__ == '__main__':
    main()
