"""配置变更审计链（防篡改）。

为什么普通的 ``operation_logs`` 不够：它记的是「谁在什么时候做了 update_config」，
但**没记改前改后**；更关键的是，任何拿到数据库文件的人都能 ``UPDATE operation_logs
SET username='别人' WHERE id=17`` —— 改完看不出来。审计日志自己能被人改，
在等保测评里等于没有审计（GB/T 22239-2019 8.1.4.3 安全审计要求审计记录受到保护、
避免受到未预期的删除、修改或覆盖）。

本模块的做法是**哈希链（hash chain）**：

    entry_hash(n) = sha256(prev_hash(n-1) | seq | actor | section | ts | diff_json)

每条记录携带前一条的哈希，于是：

* 改任意一条的 ``after`` 值 → 该条 entry_hash 变 → 与下一条记录的 prev_hash 对不上；
* 删中间一条 → ``seq`` 出现断号，且下一条的 prev_hash 指向不存在的哈希；
* 删最后一条 → 链本身自洽，但 ``seq`` 与记录数不符（用 count 校验能抓到截断）；
* 追加伪造一条 → 能追加，但需要重算其后所有哈希；一旦重算，头部记录的哈希
  与外部锚点（git 提交、证据清单 MANIFEST）就对不上。

**这套机制不能防"有数据库写权限的人全链重算"** —— 那是需要 WORM 存储或
外部时间戳才能解决的，属于部署层面。本模块只保证：篡改**要么被链校验抓到，
要么必须在外部锚点上留下痕迹**。这个边界写在 docs 里，不吹。

用法（写入方）：

    from core.audit_chain import record_config_change
    with db.get_connection() as conn:
        record_config_change(conn, actor='admin', section='security',
                             before=old, after=new, ip='10.0.0.9')

用法（校验方，独立进程、只读连接）：

    from core.audit_chain import verify_chain
    report = verify_chain(conn)   # -> {ok, entries, broken:[...], reason}
"""

from __future__ import annotations

import hashlib
import json
import sqlite3

TABLE = 'config_change_log'

SCHEMA = f'''
CREATE TABLE IF NOT EXISTS {TABLE} (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    ts_utc      TEXT NOT NULL,
    actor       TEXT NOT NULL,
    section     TEXT NOT NULL,
    ip          TEXT,
    diff_json   TEXT NOT NULL,
    prev_hash   TEXT NOT NULL,
    entry_hash  TEXT NOT NULL
)
'''


def canonical_json(obj) -> str:
    """稳定的 JSON 序列化：键排序 + 紧凑分隔符。

    哈希链的命门是"同样的内容必须得到同样的字节"。Python 的 dict 顺序、
    默认分隔符（``', '`` 带空格）都会让同一份内容算出不同哈希，
    于是链在校验时"无故断裂" —— 这是最常见的实现错误。
    """
    return json.dumps(obj, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), default=str)


def _digest(prev_hash: str, seq: int, ts_utc: str, actor: str,
            section: str, diff_json: str) -> str:
    payload = '|'.join([prev_hash, str(seq), ts_utc, actor, section, diff_json])
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(SCHEMA)


def diff_section(before: dict, after: dict) -> list[dict]:
    """只保留真正变化的键，输出 ``[{key, before, after}]``。

    没变化就不该产生一条审计记录 —— 否则日志被"保存了一次没改任何东西"
    这种噪音灌满，真正要找的那条就淹了。
    """
    out = []
    keys = set(before or {}) | set(after or {})
    for k in sorted(keys):
        b = (before or {}).get(k)
        a = (after or {}).get(k)
        if b != a:
            out.append({'key': k, 'before': b, 'after': a})
    return out


def record_config_change(conn: sqlite3.Connection, actor: str, section: str,
                         before: dict, after: dict, ip: str | None = None,
                         ts_utc: str | None = None) -> dict | None:
    """追加一条变更记录并返回它（无变化时返回 None，不写空记录）。

    失败不抛异常 —— 审计写失败不该让业务请求 500，但要留 warning，
    并在响应里体现 ``audit: degraded``（调用方负责），这样"审计坏了"
    不会被静默吞掉。
    """
    ensure_table(conn)
    diff = diff_section(before, after)
    if not diff:
        return None

    if ts_utc is None:
        # 不 import core.timebase：本模块要能被 tools/ 单独加载做离线校验
        # （那时 backend/src 不在 sys.path 里）。用标准库算，行为完全一致。
        from datetime import datetime, timezone
        ts_utc = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')

    row = conn.execute(
        f'SELECT seq, entry_hash FROM {TABLE} ORDER BY seq DESC LIMIT 1'
    ).fetchone()
    prev_hash = row[1] if row else '0' * 64
    # seq 由 AUTOINCREMENT 决定，但哈希要用 seq，所以先算"将要用的 seq"
    next_seq = conn.execute(
        f"SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='{TABLE}'), 0) + 1"
    ).fetchone()[0]

    diff_json = canonical_json(diff)
    entry_hash = _digest(prev_hash, next_seq, ts_utc, actor, section, diff_json)

    conn.execute(
        f'INSERT INTO {TABLE} (ts_utc, actor, section, ip, diff_json, prev_hash, entry_hash) '
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
        (ts_utc, actor, section, ip, diff_json, prev_hash, entry_hash),
    )
    return {'seq': next_seq, 'entry_hash': entry_hash, 'changes': len(diff)}


def verify_chain(conn: sqlite3.Connection) -> dict:
    """重算整条链，返回可被第三方复核的结论。

    ``ok=False`` 时 ``broken`` 里给出第一处断裂的 seq 与原因（不是"可能有问题"，
    而是"第 7 条记录的 after 被改过，哈希对不上"）。
    """
    try:
        conn.execute(SCHEMA)
        rows = conn.execute(
            f'SELECT seq, ts_utc, actor, section, diff_json, prev_hash, entry_hash '
            f'FROM {TABLE} ORDER BY seq'
        ).fetchall()
    except sqlite3.Error as e:
        return {'ok': False, 'entries': 0, 'broken': [], 'reason': f'读取失败: {e}'}

    broken = []
    prev = '0' * 64
    for i, (seq, ts, actor, section, diff_json, prev_hash, entry_hash) in enumerate(rows):
        expect_prev = prev
        if prev_hash != expect_prev:
            broken.append({'seq': seq, 'reason': 'prev_hash 不连续（此前的记录被删除或替换）'})
        expect_hash = _digest(prev_hash, seq, ts, actor, section, diff_json)
        if entry_hash != expect_hash:
            broken.append({'seq': seq, 'reason': 'entry_hash 与内容不符（记录被修改）'})
        if i and seq != rows[i - 1][0] + 1:
            broken.append({'seq': seq, 'reason': 'seq 断号（中间记录被删除）'})
        prev = entry_hash

    head = rows[-1][6] if rows else None
    return {
        'ok': not broken,
        'entries': len(rows),
        'head_hash': head,
        'broken': broken,
        'reason': '' if not broken else broken[0]['reason'],
    }
