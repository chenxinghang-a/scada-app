"""负向控制：证明"检查"是会失败的。

一条检查如果永远不会失败，它的"通过"就没有信息量。工业软件交付里最常见的
假证据，不是数据造假，而是**检测器从来没有被验证过它能报错**——
于是现场真出问题时，它照样显示绿色。

本模块对每个检测器做三件事：

    ① 在"合格状态"的快照上跑 → 必须 PASS（否则检测器自己有问题，判 INSTRUMENT_BROKEN）
    ② 播种一个**已知的、具体的**缺陷 → 必须变 FAIL
    ③ 而且必须报出**预期的那条 finding code**（不是"随便报个错"）

三件事全过，才叫"这条检测器有分辨力"。矩阵结果落 reports/deep/negative-control.json，
任何人重跑都应该得到同一张表。
"""

from __future__ import annotations

import shutil
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from . import detectors, fixtures, pointtable, timebase
from .common import (FAIL, INSUFFICIENT, PASS, REPO, cleanup, connect_rw,
                     read_json, say, snapshot, tmp_dir, write_json)


# ---------------------------------------------------------------- 播种器

def seed_stale(conn: sqlite3.Connection) -> dict:
    """把一条已确认的报警改回"未确认 + 48 小时前触发"。"""
    ts = (datetime.now() - timedelta(hours=48)).strftime('%Y-%m-%d %H:%M:%S')
    row = conn.execute('SELECT id FROM alarm_records ORDER BY id LIMIT 1').fetchone()
    conn.execute('UPDATE alarm_records SET acknowledged = 0, acknowledged_at = NULL, '
                 'last_trigger_time = ? WHERE id = ?', (ts, row[0]))
    conn.commit()
    return {'seeded': '1 条报警改为未确认且 48h 前触发', 'id': row[0]}


def seed_priority(conn: sqlite3.Connection) -> dict:
    """把 60 条非 critical 改成 critical（30% >> 5% 阈值）。"""
    conn.execute('''
        UPDATE alarm_records SET alarm_level = 'critical'
        WHERE id IN (SELECT id FROM alarm_records WHERE alarm_level != 'critical' LIMIT 60)
    ''')
    conn.commit()
    n = conn.execute("SELECT COUNT(*) FROM alarm_records WHERE alarm_level='critical'").fetchone()[0]
    return {'seeded': 'critical 占比抬到 30% 以上', 'critical_now': n}


def seed_chattering(conn: sqlite3.Connection) -> dict:
    """同一报警号在同一个小时内插入 8 行。"""
    aid = conn.execute('SELECT alarm_id FROM alarm_records LIMIT 1').fetchone()[0]
    base = datetime.now().replace(minute=5, second=0, microsecond=0)
    dev = conn.execute('SELECT device_id FROM alarm_records LIMIT 1').fetchone()[0]
    rows = [(aid, dev, 'boiler_temperature', 'warning', '抖动样本',
             180.0, 200.0, (base + timedelta(seconds=30 * i)).strftime('%Y-%m-%d %H:%M:%S'),
             1, (base + timedelta(seconds=30 * i)).strftime('%Y-%m-%d %H:%M:%S'),
             200.0, 1, None, None) for i in range(8)]
    conn.executemany('''
        INSERT INTO alarm_records
        (alarm_id, device_id, register_name, alarm_level, alarm_message, threshold,
         actual_value, timestamp, trigger_count, last_trigger_time, last_value,
         acknowledged, acknowledged_at, acknowledged_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ''', rows)
    conn.commit()
    return {'seeded': f'{aid} 在 1 小时内新增 8 行'}


def seed_quality(conn: sqlite3.Connection) -> dict:
    """把 20% 的实时点质量改成 Bad(0)。"""
    conn.execute('''
        UPDATE realtime_data SET quality = 0
        WHERE id IN (SELECT id FROM realtime_data ORDER BY id LIMIT
                     (SELECT MAX(1, COUNT(*) / 5) FROM realtime_data))
    ''')
    conn.commit()
    bad = conn.execute('SELECT COUNT(*) FROM realtime_data WHERE quality != 192').fetchone()[0]
    return {'seeded': '20% 实时点质量置为 Bad(0)', 'bad_now': bad}


def seed_time(conn: sqlite3.Connection) -> dict:
    """把 500 行的 ts_utc 整体多减 2 小时（模拟换算符号错/多减一个时区）。"""
    conn.execute('''
        UPDATE history_data SET ts_utc = datetime(ts_utc, '-2 hours')
        WHERE id IN (SELECT id FROM history_data ORDER BY id DESC LIMIT 500)
    ''')
    conn.commit()
    n = conn.execute("SELECT COUNT(*) FROM history_data WHERE "
                     "(julianday(created_at)-julianday(ts_utc))*86400 > 3600").fetchone()[0]
    return {'seeded': '500 行 ts_utc 多减 2 小时', 'over_lag_rows': n}


def seed_io(cfg: dict) -> dict:
    """把第一个设备的字节序从 ABCD 改成 BADC（现场最常见的一种配错）。"""
    for dev in cfg.get('devices') or []:
        if dev.get('registers'):
            old = dev.get('byte_order')
            dev['byte_order'] = 'BADC'
            return {'seeded': f"{dev.get('id')} byte_order {old or '继承全局'} -> BADC"}
    return {'seeded': '没有寄存器设备，无法播种'}


def seed_backup(path: Path) -> dict:
    """在备份文件中部写入垃圾字节 —— 模拟磁盘坏道/拷贝错位。

    为什么不直接截断：截断会让文件打不开，检测器报"打不开"，
    这只能证明我们会判断"文件存在与否"。真正危险的是**能打开、能 count、
    却已损坏**的备份 —— 恢复时才发现，那时原库已经没了。
    """
    size = path.stat().st_size
    with open(path, 'r+b') as f:
        f.seek(int(size * 0.5))
        f.write(b'\xde\xad\xbe\xef' * 128)
    return {'seeded': '备份文件中部 512 字节被写坏（文件仍可打开）',
            'size': size, 'offset': int(size * 0.5)}


def seed_chain(conn: sqlite3.Connection) -> dict:
    """改掉链中间一条记录的 diff 内容（模拟"事后修改审计日志"）。"""
    row = conn.execute('SELECT seq, diff_json FROM config_change_log ORDER BY seq '
                       'LIMIT 1 OFFSET 2').fetchone()
    if not row:
        return {'seeded': '链为空，无法播种'}
    tampered = row[1].replace('"after":', '"after":"TAMPERED",')
    conn.execute('UPDATE config_change_log SET diff_json = ? WHERE seq = ?',
                 (tampered, row[0]))
    conn.commit()
    return {'seeded': f'篡改 seq={row[0]} 的 diff_json（after 值被改写）'}


# ---------------------------------------------------------------- 用例表

CASES = [
    {
        'detector': 'alm_stale',
        'defect': '一条报警未确认且搁置 48 小时',
        'expect_code': 'STALE_ALARM',
        'prepare': 'alarm_fixture',
        'seed': 'db',
        'seed_fn': seed_stale,
    },
    {
        'detector': 'alm_priority',
        'defect': 'critical 占比从 2% 抬到 30%',
        'expect_code': 'ALM_CRITICAL_SHARE_EXCEEDED',
        'prepare': 'alarm_fixture',
        'seed': 'db',
        'seed_fn': seed_priority,
    },
    {
        'detector': 'alm_chattering',
        'defect': '同一报警号 1 小时内触发 8 次',
        'expect_code': 'ALARM_CHATTERING',
        'prepare': 'alarm_fixture',
        'seed': 'db',
        'seed_fn': seed_chattering,
    },
    {
        'detector': 'data_quality',
        'defect': '20% 实时点质量为 Bad',
        'expect_code': 'QUALITY_BAD_PRESENT',
        'prepare': None,
        'seed': 'db',
        'seed_fn': seed_quality,
    },
    {
        'detector': 'data_time',
        'defect': '500 行 ts_utc 偏移 1 小时（写入路径漏换算）',
        'expect_code': 'TIME_INSERT_LAG',
        'prepare': 'timebase_migrate',
        'seed': 'db',
        'seed_fn': seed_time,
    },
    {
        'detector': 'data_io',
        'defect': '设备字节序配错（ABCD → BADC）',
        'expect_code': 'IO_BYTE_ORDER_MISMATCH',
        'prepare': None,
        'seed': 'config',
        'seed_fn': seed_io,
    },
    {
        'detector': 'ops_backup',
        'defect': '备份中部 512 字节被写坏（可打开、可 count，但页已损坏）',
        'expect_code': 'BACKUP_CORRUPT',
        'prepare': 'backup_fixture',
        'seed': 'file',
        'seed_fn': seed_backup,
    },
    {
        'detector': 'sec_chain',
        'defect': '事后篡改审计日志中间一条',
        'expect_code': 'CHAIN_BROKEN',
        'prepare': 'chain_fixture',
        'seed': 'db',
        'seed_fn': seed_chain,
    },
]


# ---------------------------------------------------------------- 夹具

def _prep_alarm_fixture(db: Path, ctx: dict) -> dict:
    conn = connect_rw(db)
    try:
        return fixtures.build_alarm_population(conn)
    finally:
        conn.close()


def _prep_timebase_migrate(db: Path, ctx: dict) -> dict:
    conn = connect_rw(db)
    try:
        rep = timebase.backfill(conn)
        rep['invariant'] = timebase.check_invariant(conn)
        return rep
    finally:
        conn.close()


def _prep_backup_fixture(db: Path, ctx: dict) -> dict:
    bpath = ctx['dir'] / 'backup.db'
    info = fixtures.build_backup(db, bpath)
    ctx['backup_path'] = bpath
    ctx['backup_baseline'] = info['counts']
    return {'backup': str(bpath), 'counts': info['counts'], 'integrity': info['integrity']}


def _prep_chain_fixture(db: Path, ctx: dict) -> dict:
    mod = detectors._load_audit_chain()
    conn = connect_rw(db)
    try:
        mod.ensure_table(conn)
        conn.execute('DELETE FROM config_change_log')
        conn.commit()
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
        rep = mod.verify_chain(conn)
        return {'entries': rep['entries'], 'ok': rep['ok'], 'head': rep['head_hash']}
    finally:
        conn.close()


PREPARES = {
    'alarm_fixture': _prep_alarm_fixture,
    'timebase_migrate': _prep_timebase_migrate,
    'backup_fixture': _prep_backup_fixture,
    'chain_fixture': _prep_chain_fixture,
}


# ---------------------------------------------------------------- 执行

def _run_detector(name: str, ctx: dict):
    fn, kind = detectors.REGISTRY[name]
    if kind == 'db':
        return fn(ctx['db'])
    if kind == 'config':
        return fn(ctx['config'])
    if kind == 'file':
        return fn(ctx['backup_path'], ctx.get('backup_baseline'))
    raise ValueError(name)


def run(src_db: Path, config_path: Path, out_json: Path, keep_dir: bool = False) -> dict:
    out_json = Path(out_json)
    work = tmp_dir('negctl')
    say(f'快照源库 → {work}')
    base = snapshot(Path(src_db), work / 'base.db')
    base_size = base.stat().st_size
    say(f'快照完成：{base_size / 1048576:.1f} MB')

    rows = []
    for i, case in enumerate(CASES, 1):
        name = case['detector']
        cdir = work / name
        cdir.mkdir(parents=True, exist_ok=True)
        db = cdir / 'work.db'
        shutil.copy2(base, db)
        cfg = cdir / 'device_config.yaml'
        shutil.copy2(config_path, cfg)

        ctx = {'db': db, 'config': cfg, 'dir': cdir, 'backup_path': None,
               'backup_baseline': None}

        prep_info = None
        if case['prepare']:
            prep_info = PREPARES[case['prepare']](db, ctx)

        clean = _run_detector(name, ctx)
        seed_info = None
        if case['seed'] == 'db':
            conn = connect_rw(db)
            try:
                seed_info = case['seed_fn'](conn)
            finally:
                conn.close()
        elif case['seed'] == 'config':
            cfgdata = pointtable.load_config(cfg)
            seed_info = case['seed_fn'](cfgdata)
            import yaml
            cfg.write_text(yaml.safe_dump(cfgdata, allow_unicode=True, sort_keys=False),
                           encoding='utf-8')
        elif case['seed'] == 'file':
            seed_info = case['seed_fn'](ctx['backup_path'])

        seeded = _run_detector(name, ctx)

        clean_ok = clean.verdict == PASS
        caught = seeded.verdict == FAIL and case['expect_code'] in seeded.codes()
        row = {
            'detector': name,
            'title': clean.title,
            'claim': clean.claim,
            'defect': case['defect'],
            'expect_code': case['expect_code'],
            'clean_verdict': clean.verdict,
            'clean_codes': sorted(clean.codes()),
            'clean_sample': clean.sample,
            'seeded_verdict': seeded.verdict,
            'seeded_codes': sorted(seeded.codes()),
            'seeded_metrics': seeded.metrics,
            'prepare': prep_info,
            'seed': seed_info,
            'discriminating': bool(clean_ok and caught),
            'verdict': ('OK' if clean_ok and caught
                        else 'INSTRUMENT_BROKEN' if not clean_ok
                        else 'BLIND_SPOT'),
        }
        rows.append(row)
        mark = 'OK  ' if row['verdict'] == 'OK' else '!!  '
        say(f"{mark}[{i}/{len(CASES)}] {name}: clean={clean.verdict} "
            f"seeded={seeded.verdict} {sorted(seeded.codes())}")

    ok = sum(1 for r in rows if r['verdict'] == 'OK')
    report = {
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'source_db': str(src_db),
        'snapshot_size_mb': round(base_size / 1048576, 1),
        'cases': len(rows),
        'discriminating': ok,
        'all_ok': ok == len(rows),
        'principle': '检测器未能在播种后报错 = 该检测器的"通过"无效',
        'rows': rows,
    }
    write_json(out_json, report)
    say(f'\n矩阵：{ok}/{len(rows)} 个检测器具备分辨力 → {out_json}')

    if not keep_dir:
        cleanup(work)
    else:
        say(f'工作目录保留：{work}')
    return report
