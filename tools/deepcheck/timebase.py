"""时间基准迁移：给历史数据补上权威 UTC 列。

三个约束决定了写法：

1. **幂等**：跑第二遍不能把已经换算过的数据再减 8 小时。用
   ``_timebase_migrations`` 记录"哪张表按多少偏移、处理了多少行"，
   第二遍直接跳过。
2. **可回滚**：只新增列，不改旧列（``timestamp`` 原地不动）。
   真要回滚，``ALTER TABLE ... DROP COLUMN`` 或直接还原备份即可。
3. **可验证**：迁移完立刻用 ``created_at``（SQLite 独立写入的 UTC）
   交叉校验，差值超容差就报错 —— 不靠"我看了一眼觉得对"。
"""

from __future__ import annotations

import sqlite3
from datetime import datetime

MARKER = '_timebase_migrations'

SCHEMA = f'''
CREATE TABLE IF NOT EXISTS {MARKER} (
    scope        TEXT PRIMARY KEY,
    offset_hours REAL NOT NULL,
    rows_done    INTEGER NOT NULL,
    applied_at   TEXT NOT NULL,
    note         TEXT
)
'''


def system_offset_hours() -> float:
    """本机相对 UTC 的偏移（中国 +8）。由运行时算，不写死。"""
    return datetime.now().astimezone().utcoffset().total_seconds() / 3600.0


def ensure_column(conn: sqlite3.Connection) -> bool:
    cols = {r[1] for r in conn.execute('PRAGMA table_info(history_data)')}
    if 'ts_utc' in cols:
        return False
    conn.execute('ALTER TABLE history_data ADD COLUMN ts_utc DATETIME')
    return True


def already_applied(conn: sqlite3.Connection, scope: str) -> dict | None:
    conn.execute(SCHEMA)
    row = conn.execute(
        f'SELECT scope, offset_hours, rows_done, applied_at FROM {MARKER} WHERE scope = ?',
        (scope,)).fetchone()
    if not row:
        return None
    return {'scope': row[0], 'offset_hours': row[1], 'rows_done': row[2], 'applied_at': row[3]}


def backfill(conn: sqlite3.Connection, offset_hours: float | None = None,
             scope: str = 'history_data.timestamp', force: bool = False) -> dict:
    """把 ``history_data.ts_utc`` 回填为 ``timestamp - 本地偏移``。

    返回 {applied, rows, offset_hours, skipped_reason}。
    """
    offset = system_offset_hours() if offset_hours is None else float(offset_hours)
    added = ensure_column(conn)

    prev = already_applied(conn, scope)
    if prev and not force:
        return {'applied': False, 'rows': 0, 'offset_hours': prev['offset_hours'],
                'skipped_reason': f"已于 {prev['applied_at']} 按 {prev['offset_hours']}h 处理过 "
                                   f"{prev['rows_done']} 行（幂等跳过）"}

    # SQLite 的 datetime 修饰符：本地 = UTC + offset → UTC = 本地 - offset
    modifier = f'{-offset:+g} hours'
    cur = conn.execute(
        f"UPDATE history_data SET ts_utc = datetime(timestamp, ?) "
        f"WHERE ts_utc IS NULL AND timestamp IS NOT NULL", (modifier,))
    rows = cur.rowcount or 0
    conn.execute(
        f'INSERT OR REPLACE INTO {MARKER} (scope, offset_hours, rows_done, applied_at, note) '
        'VALUES (?,?,?,?,?)',
        (scope, offset, rows, datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
         'ts_utc = timestamp 本地时间 - 偏移；timestamp 未改动'))
    conn.commit()
    return {'applied': True, 'rows': rows, 'offset_hours': offset,
            'column_added': added, 'modifier': modifier}


def check_invariant(conn: sqlite3.Connection, tol_seconds: float = 120.0) -> dict:
    """迁移后的自检：ts_utc 必须与 created_at（UTC）落在同一时刻附近。"""
    row = conn.execute('''
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN ts_utc IS NULL THEN 1 ELSE 0 END) AS nulls,
               AVG((julianday(ts_utc) - julianday(created_at)) * 86400) AS mean_s,
               MAX(ABS((julianday(ts_utc) - julianday(created_at)) * 86400)) AS max_s
        FROM history_data
    ''').fetchone()
    total, nulls, mean_s, max_s = row
    ok = bool(total) and (nulls or 0) == 0 and mean_s is not None and abs(mean_s) <= tol_seconds
    return {'ok': ok, 'rows': total, 'nulls': nulls or 0,
            'mean_delta_seconds': round(mean_s, 2) if mean_s is not None else None,
            'max_delta_seconds': round(max_s, 2) if max_s is not None else None,
            'tol_seconds': tol_seconds}
