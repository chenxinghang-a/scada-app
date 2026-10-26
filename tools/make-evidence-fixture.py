#!/usr/bin/env python3
"""生成"证据夹具"数据库（可复现的最小数据集）。

为什么需要它：运行库被 ``.gitignore`` 排除（``backend/_internal/``），
所以任何人克隆仓库后**没有任何数据**。检测器再正确也跑不起来 ——
"请你自己去装一遍应用、跑三天、再来验证我" 不是可复现，是推脱。

本脚本用固定随机种子生成一个结构完全相同、规模小两个数量级的库：

    python tools/make-evidence-fixture.py            # 生成 tests/fixtures/evidence.db
    python tools/deep-verify.py all --db tests/fixtures/evidence.db

它证明的是"**工具在已知真值上给出正确结论**"，不是"现场数据健康"。
两者分级不同，报告里分开写。
"""

from __future__ import annotations

import argparse
import random
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepcheck import fixtures  # noqa: E402
from deepcheck.common import REPO, say  # noqa: E402

N_HISTORY = 20000
DEVICES = [f'dev_{i:02d}' for i in range(1, 11)]
REGISTERS = [('boiler_temperature', '°C'), ('boiler_pressure', 'MPa'),
             ('steam_flow', 't/h'), ('feed_water_level', 'mm'),
             ('flue_gas_temperature', '°C')]

#: 固定基准时刻：夹具不跟着"今天"走，否则每次生成的字节都不同，
#: 哈希清单就没法比对。报警的"陈旧"判断仍按当前时间算（那才是被测语义）。
BASE = datetime(2026, 10, 24, 0, 0, 0)


def create_schema(conn: sqlite3.Connection, source: Path | None) -> list[str]:
    """优先从真实库复制 DDL —— 夹具的结构必须等于运行库，不能靠手抄。"""
    if source and source.exists():
        src = sqlite3.connect(f'file:{source.as_posix()}?mode=ro', uri=True)
        try:
            ddl = [r[0] for r in src.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL "
                "AND name NOT LIKE 'sqlite_%'")]
        finally:
            src.close()
        for stmt in ddl:
            try:
                conn.execute(stmt)
            except sqlite3.Error as e:
                say(f'  ! 建表跳过（{e}）: {stmt.splitlines()[0][:60]}')
    else:
        # 没有源库时的兜底 DDL（与 存储层/database.py 保持一致的最小子集）
        conn.executescript('''
            CREATE TABLE history_data (id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL, register_name TEXT NOT NULL, value REAL,
                unit TEXT, timestamp DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP, ts_utc DATETIME);
            CREATE TABLE realtime_data (id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_id TEXT NOT NULL, register_name TEXT NOT NULL, value REAL,
                unit TEXT, timestamp DATETIME NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                quality INTEGER DEFAULT 192, UNIQUE(device_id, register_name));
            CREATE TABLE alarm_records (id INTEGER PRIMARY KEY AUTOINCREMENT,
                alarm_id TEXT NOT NULL, device_id TEXT NOT NULL,
                register_name TEXT NOT NULL, alarm_level TEXT NOT NULL,
                alarm_message TEXT, threshold REAL, actual_value REAL,
                timestamp DATETIME NOT NULL, trigger_count INTEGER DEFAULT 1,
                last_trigger_time DATETIME, last_value REAL,
                acknowledged BOOLEAN DEFAULT 0, acknowledged_at DATETIME,
                acknowledged_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE operation_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL, action TEXT NOT NULL, target TEXT,
                detail TEXT, ip_address TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP);
        ''')

    # ts_utc 是时间基准统一的产物；源库若还没来得及迁移，夹具也要有这一列
    cols = {r[1] for r in conn.execute('PRAGMA table_info(history_data)')}
    if 'ts_utc' not in cols:
        conn.execute('ALTER TABLE history_data ADD COLUMN ts_utc DATETIME')

    return sorted(r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%'"))


def build(out: Path, source: Path | None, offset_hours: float = 8.0, seed: int = 20261026):
    if out.exists():
        out.unlink()
    out.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(out))
    rnd = random.Random(seed)

    tables = create_schema(conn, source)

    rows = []
    for i in range(N_HISTORY):
        dev = DEVICES[i % len(DEVICES)]
        reg, unit = REGISTERS[(i // len(DEVICES)) % len(REGISTERS)]
        # 本地时间按 5 秒等间隔推进；ts_utc = 本地 - 偏移（与运行库语义一致）
        local = BASE + timedelta(seconds=5 * i)
        utc = local - timedelta(hours=offset_hours)
        value = round(rnd.uniform(60, 190), 3)
        rows.append((dev, reg, value, unit,
                     local.strftime('%Y-%m-%d %H:%M:%S.%f'),
                     utc.strftime('%Y-%m-%d %H:%M:%S'),
                     utc.strftime('%Y-%m-%d %H:%M:%S')))
    conn.executemany('INSERT INTO history_data '
                     '(device_id, register_name, value, unit, timestamp, ts_utc, created_at) '
                     'VALUES (?,?,?,?,?,?,?)', rows)

    rt = []
    for dev in DEVICES:
        for reg, unit in REGISTERS:
            ts = BASE + timedelta(seconds=5 * (N_HISTORY - 1))
            rt.append((dev, reg, round(rnd.uniform(60, 190), 3), unit,
                       ts.strftime('%Y-%m-%d %H:%M:%S.%f'), 192))
    conn.executemany('INSERT INTO realtime_data '
                     '(device_id, register_name, value, unit, timestamp, quality) '
                     'VALUES (?,?,?,?,?,?)', rt)

    truth = fixtures.build_alarm_population(conn, seed=seed)

    ops = [(rnd.choice(['admin', 'engineer', 'operator']), 'login', 'web',
            '夹具样本', '127.0.0.1') for _ in range(20)]
    conn.executemany('INSERT INTO operation_logs (username, action, target, detail, ip_address) '
                     'VALUES (?,?,?,?,?)', ops)

    # 一个合法的审计链（供 sec_chain 检测器有东西可验）
    from deepcheck import detectors as _d
    mod = _d._load_audit_chain()
    mod.ensure_table(conn)
    samples = [
        ('admin', 'security', {'max_login_attempts': 5}, {'max_login_attempts': 8}),
        ('engineer', 'system', {'collect_interval': 5}, {'collect_interval': 2}),
        ('admin', 'web', {'port': 5000}, {'port': 8080}),
        ('engineer', 'security', {'session_timeout': 30}, {'session_timeout': 15}),
        ('admin', 'system', {'log_level': 'INFO'}, {'log_level': 'DEBUG'}),
    ]
    for actor, section, before, after in samples:
        mod.record_config_change(conn, actor, section, before, after, ip='127.0.0.1')
    conn.commit()

    counts = {t: conn.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in tables}
    conn.close()
    return {'out': str(out), 'size_kb': round(out.stat().st_size / 1024, 1),
            'tables': tables, 'counts': counts, 'alarm_truth': truth,
            'offset_hours': offset_hours, 'seed': seed}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(REPO / 'tests' / 'fixtures' / 'evidence.db'))
    ap.add_argument('--source', default=None,
                    help='从哪个真实库复制表结构（默认自动找运行库）')
    args = ap.parse_args()

    source = Path(args.source) if args.source else None
    if source is None:
        for cand in (Path.home() / 'AppData/Local/Programs/SmartSCADA/resources/backend/'
                                     '_internal/data/scada_simulated.db',
                     REPO / 'backend/_internal/data/scada_simulated.db'):
            if cand.exists():
                source = cand
                break

    info = build(Path(args.out), source)
    say(f"夹具已生成：{info['out']}（{info['size_kb']} KB）")
    say(f"  表：{', '.join(info['tables'])}")
    say(f"  行数：{info['counts']}")
    say(f"  报警真值：{info['alarm_truth']}")


if __name__ == '__main__':
    main()
