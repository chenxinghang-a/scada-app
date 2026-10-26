"""被审对象守卫：你审的库，是不是应用正在写的那个库？

这是**整条证据链最容易断、又最不容易被发现**的一环。真实的翻车方式：

1. 从源码跑一遍 → 应用写 ``backend/src/data/scada_simulated.db``
2. 检查工具按默认路径读 ``%LOCALAPPDATA%/.../data/scada_simulated.db``
3. 两份库同名、同结构、字段全对 —— **所有检查都通过**，但它们看的是另一份数据

本项目就真的踩到了：后端起在 ``backend/src/data``，检测器读 AppData，
AppData 那份停在 04:51，而应用一直在往 src/data 写。两边都"有数据、很干净"，
差异只有一行日志（``运维清理工具已接线: ...\\src\\data\\...``）。
**没人会去看那一行。**

所以判据必须是机器可查的：拿着应用自己写的 ``runtime.json``（里面有
port/pid/mode/started_at）算出它"应该"在写哪个库，再和正在审的库比。

    PASS         审的就是应用在写的那个库
    FAIL         审的是另一个库（附两边路径与最新数据时间）
    INSUFFICIENT 没有正在运行的实例（此时任何"现场结论"都不成立）
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from .common import FAIL, INSUFFICIENT, PASS, REPO, Finding, Result, connect_ro

#: runtime.json 在这场部署里可能出现的位置（按项目约定，不是硬编码某个人的机器）
def _candidates(db: Path) -> list[Path]:
    out = [Path(db).parent / 'runtime.json',
           REPO / 'backend' / 'src' / 'data' / 'runtime.json',
           REPO / 'backend' / '_internal' / 'data' / 'runtime.json']
    seen, uniq = set(), []
    for p in out:
        k = str(p).lower()
        if k not in seen:
            seen.add(k)
            uniq.append(p)
    return uniq


def _load_rt(p: Path) -> dict | None:
    import json
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def _db_freshness(db: Path) -> dict:
    try:
        with connect_ro(db) as conn:
            row = conn.execute('SELECT COUNT(*), MAX(created_at) FROM history_data').fetchone()
        return {'rows': row[0], 'latest': row[1]}
    except sqlite3.Error:
        return {'rows': None, 'latest': None}


def _port_open(port, timeout: float = 0.35) -> bool:
    """端口是否在监听 —— 用来判断"这个实例还活着吗"。

    不用 psutil / tasklist：工具要保持零依赖，且要跨平台。
    """
    import socket
    try:
        with socket.create_connection(('127.0.0.1', int(port)), timeout=timeout):
            return True
    except (OSError, ValueError):
        return False


def _other_runtimes(db: Path) -> list[tuple[Path, dict]]:
    out = []
    for p in _candidates(db):
        if p.parent == Path(db).parent:
            continue
        d = _load_rt(p)
        if d:
            out.append((p, d))
    return out


def guard(db: Path, runtime_path: Path | None = None) -> Result:
    """判定"被审库"与"活实例在写的库"是否一致。

    范围是刻意收窄的：**只有当被审库位于某个实例的数据目录里（同级有 runtime.json）
    时，才做对象判定**。否则（夹具、离线副本、别人拷来的一份）判 INSUFFICIENT ——
    拿离线副本去比对一个活实例，只会制造假警报。
    """
    db = Path(db).resolve()
    own_rt = Path(runtime_path) if runtime_path else (db.parent / 'runtime.json')
    if not own_rt.exists():
        return Result(id='subject', title='被审对象一致性', claim='DATA-14',
                      verdict=INSUFFICIENT,
                      metrics={'audited_db': str(db),
                               'reason': '被审库不在实例的数据目录下（夹具/离线副本），不做对象判定'},
                      ground_truth='应用自写的 runtime.json（port/pid/mode）')

    own = _load_rt(own_rt) or {}
    expected = (db.parent / f"scada_{own.get('mode', 'simulated')}.db").resolve()
    metrics = {
        'audited_db': str(db), 'audited_latest': _db_freshness(db)['latest'],
        'runtime_file': str(own_rt), 'runtime_mode': own.get('mode'),
        'runtime_pid': own.get('pid'), 'runtime_port': own.get('port'),
        'expected_db': str(expected),
    }

    # ① 同目录的 runtime.json 说该写别的库 —— 目录被改过/拷错了
    if expected != db:
        return Result(id='subject', title='被审对象一致性', claim='DATA-14',
                      verdict=FAIL, metrics=metrics,
                      findings=[Finding('SUBJECT_MISMATCH',
                                        f'同一数据目录里的 runtime.json 表明应写 {expected.name}，'
                                        f'实际在审 {db.name}', 'critical', 1)],
                      ground_truth='应用自写的 runtime.json')

    # ② 本实例还活着（端口在监听）→ 审的就是它
    if _port_open(own.get('port')):
        return Result(id='subject', title='被审对象一致性', claim='DATA-14',
                      verdict=PASS, metrics={**metrics, 'live': True},
                      ground_truth='应用自写的 runtime.json', sample=0)

    # ③ 本实例已停：如果别处有活实例，说明你在审一份停掉的库
    for p2, d2 in _other_runtimes(db):
        if _port_open(d2.get('port')):
            other = (p2.parent / f"scada_{d2.get('mode', 'simulated')}.db").resolve()
            return Result(id='subject', title='被审对象一致性', claim='DATA-14',
                          verdict=FAIL, metrics={**metrics, 'live': False,
                                                 'live_instance_db': str(other)},
                          findings=[Finding('SUBJECT_MISMATCH',
                                            f'正在审的库属于一个已停机的实例；'
                                            f'审的是 {db}；'
                                            f'另有活实例在写 {other}（{p2}）',
                                            'critical', 1)],
                          ground_truth='应用自写的 runtime.json')

    return Result(id='subject', title='被审对象一致性', claim='DATA-14',
                  verdict=INSUFFICIENT,
                  metrics={**metrics, 'live': False,
                           'reason': '本实例未运行，也没有其他活实例 —— 此时不做对象判定'},
                  ground_truth='应用自写的 runtime.json')
