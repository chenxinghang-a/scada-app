"""审计链外部锚点：补上"尾部截断抓不到"这个已知局限。

哈希链的盲区是**截断尾部**：删掉最后几条，剩下的链自己还是自洽的，
``verify_chain`` 会说 ok。这不是实现缺陷，是哈希链的数学性质——
链内校验只能证明"已存在的记录没被改"，不能证明"没有记录被拿走"。

解决办法是外部锚点：定期把 ``(条数, 链头哈希)`` 记到仓库里的一个文件，
再随代码一起提交。之后：

* 库里条数 **少于** 锚点条数 → 尾部被删；
* 同一条数但链头不同 → 整条链被重写；
* 条数更多（锚点之后又有新记录）→ 合法，但要回头核对**锚点那一条**的
  哈希是否还是原来的——否则就是"保留条数、替换内容"。

锚点文件自己也串成一条链（``prev_anchor``），单点篡改会断在下一环；
而它进 git，真正的不可抵赖来自提交历史。**边界**：能重写整个仓库历史的人
仍可伪造，这一类只能靠 WORM 存储/外部时间戳，写在这里不藏。
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .common import REPO

ANCHOR_FILE = REPO / 'reports' / 'evidence' / 'audit-anchors.json'


def _canon(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def _digest(entry: dict) -> str:
    # last_seq 与 entries 必须分开：seq 是自增主键，删除过记录后 count ≠ max(seq)。
    # 第一版把两者当成一个数，结果任何"删过再插"的链都会被误判成被重写。
    return hashlib.sha256(_canon({k: entry[k] for k in
                                  ('last_seq', 'entries', 'head_hash', 'at', 'prev_anchor')}
                                 ).encode()).hexdigest()


def load(path: Path) -> dict:
    p = Path(path)
    if not p.exists():
        return {'version': 1, 'anchors': []}
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except json.JSONDecodeError:
        return {'version': 1, 'anchors': [], 'corrupt': True}


def make(conn: sqlite3.Connection, path: Path = ANCHOR_FILE,
         note: str = '') -> dict:
    """把当前链头钉成一个锚点（幂等：链头没变就不重复写）。"""
    from . import detectors
    mod = detectors._load_audit_chain()
    rep = mod.verify_chain(conn)
    if not rep['ok']:
        return {'ok': False, 'reason': f'链本身不通过，拒绝锚定：{rep["reason"]}'}
    if rep['entries'] == 0:
        return {'ok': False, 'reason': '链为空，没有可锚定的内容'}

    data = load(path)
    anchors = data.get('anchors', [])
    if anchors and anchors[-1]['head_hash'] == rep['head_hash']:
        return {'ok': True, 'unchanged': True, 'anchor': anchors[-1]}

    last_seq = conn.execute('SELECT MAX(seq) FROM config_change_log').fetchone()[0] or 0
    entry = {
        'last_seq': last_seq,
        'entries': rep['entries'],
        'head_hash': rep['head_hash'],
        'at': datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
        'prev_anchor': anchors[-1]['anchor_hash'] if anchors else '0' * 64,
        'note': note,
    }
    entry['anchor_hash'] = _digest(entry)
    anchors.append(entry)
    data.update({'version': 1, 'anchors': anchors, 'canonical': 'UTC',
                 'scope_note': '锚点证明"截至该条数，链未被截断/重写"；自身进 git 后不可抵赖'})
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    return {'ok': True, 'unchanged': False, 'anchor': entry}


def verify(conn: sqlite3.Connection, path: Path = ANCHOR_FILE) -> dict:
    """对着库校验锚点：截断 / 重写 / 合法增长 三种结论。"""
    from . import detectors
    mod = detectors._load_audit_chain()
    rep = mod.verify_chain(conn)
    data = load(path)
    anchors = data.get('anchors', [])
    if not anchors:
        return {'ok': False, 'status': 'UNANCHORED', 'anchors': 0,
                'reason': '没有锚点：尾部截断无法被发现（跑 tools/audit-anchor.py 生成）'}

    # 锚点文件自身的链完整性
    prev = '0' * 64
    for a in anchors:
        if a.get('prev_anchor') != prev:
            return {'ok': False, 'status': 'ANCHOR_FILE_TAMPERED', 'anchors': len(anchors),
                    'reason': f'锚点 last_seq={a.get("last_seq")} 的 prev_anchor 不连续'}
        if _digest(a) != a.get('anchor_hash'):
            return {'ok': False, 'status': 'ANCHOR_FILE_TAMPERED', 'anchors': len(anchors),
                    'reason': f'锚点 last_seq={a.get("last_seq")} 自身哈希不符'}
        prev = a['anchor_hash']

    last = anchors[-1]
    if not rep['ok']:
        return {'ok': False, 'status': 'CHAIN_BROKEN', 'anchors': len(anchors),
                'reason': rep['reason']}
    if rep['entries'] < last['entries']:
        return {'ok': False, 'status': 'TAIL_TRUNCATED', 'anchors': len(anchors),
                'reason': f"库中只剩 {rep['entries']} 条，锚点记录的是 {last['entries']} 条"
                          '—— 尾部记录被删除（链内自洽，只有锚点能发现）'}

    # 锚点之后可能有新增记录；回头核对锚点那一条是否还是原来的哈希。
    # 必须按 SEQ 查，不能按"第 N 条"查 —— 自增主键在删除后不连续。
    row = conn.execute('SELECT entry_hash FROM config_change_log WHERE seq = ?',
                       (last['last_seq'],)).fetchone()
    if row is None or row[0] != last['head_hash']:
        return {'ok': False, 'status': 'HISTORY_REWRITTEN', 'anchors': len(anchors),
                'reason': f'seq={last["last_seq"]} 的哈希与锚点不符 —— 锚点之前的记录被替换'}

    return {'ok': True, 'status': 'OK' if rep['entries'] == last['entries'] else 'GREW',
            'anchors': len(anchors), 'anchored_entries': last['entries'],
            'current_entries': rep['entries'], 'head_hash': rep['head_hash'],
            'reason': '锚点覆盖的记录未被截断或重写'
                      + ('' if rep['entries'] == last['entries']
                         else f'（锚点后又新增 {rep["entries"] - last["entries"]} 条）')}
