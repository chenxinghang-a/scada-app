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


def guard(db: Path, runtime_path: Path | None = None,
          fresh_hours: float = 2.0) -> Result:
    db = Path(db).resolve()
    rts = [(p, _load_rt(p)) for p in _candidates(db)]
    rts = [(p, d) for p, d in rts if d]
    if runtime_path:
        rts = [(Path(runtime_path), _load_rt(Path(runtime_path)))] + rts
        rts = [(p, d) for p, d in rts if d]
    if not rts:
        return Result(id='subject', title='被审对象一致性', claim='DATA-14',
                      verdict=INSUFFICIENT,
                      metrics={'reason': '找不到 runtime.json —— 无法确认应用在写哪个库'},
                      ground_truth='应用自写的 runtime.json（port/pid/mode/started_at）')

    # 最新写入的那份 runtime.json 代表"当前这个实例"
    p_rt, rt = max(rts, key=lambda x: x[0].stat().st_mtime)
    age = datetime.now() - datetime.fromtimestamp(p_rt.stat().st_mtime)
    expected = (p_rt.parent / f"scada_{rt.get('mode', 'simulated')}.db").resolve()
    here = _db_freshness(db)

    metrics = {
        'audited_db': str(db), 'audited_latest': here['latest'], 'audited_rows': here['rows'],
        'runtime_file': str(p_rt), 'runtime_mode': rt.get('mode'),
        'runtime_pid': rt.get('pid'), 'runtime_started_at': rt.get('started_at'),
        'runtime_age_minutes': round(age.total_seconds() / 60, 1),
        'expected_db': str(expected),
    }

    if age > timedelta(hours=fresh_hours):
        return Result(id='subject', title='被审对象一致性', claim='DATA-14',
                      verdict=INSUFFICIENT, metrics={**metrics, 'reason': '最近一次实例启动已过去太久'},
                      ground_truth='应用自写的 runtime.json')

    if expected != db:
        return Result(id='subject', title='被审对象一致性', claim='DATA-14',
                      verdict=FAIL, metrics=metrics,
                      findings=[Finding(
                          'SUBJECT_MISMATCH',
                          f'正在审的库与应用在写的库不是同一个：\n'
                          f'  审的是  {db}\n'
                          f'  写的是  {expected}（mode={rt.get("mode")}, pid={rt.get("pid")}）',
                          'critical', 1,
                          {'audited': str(db), 'expected': str(expected)})],
                      ground_truth='应用自写的 runtime.json')

    return Result(id='subject', title='被审对象一致性', claim='DATA-14',
                  verdict=PASS, metrics=metrics,
                  ground_truth='应用自写的 runtime.json（port/pid/mode/started_at）',
                  sample=here['rows'] or 0)
