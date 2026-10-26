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


def seed_time_twin_drop(conn: sqlite3.Connection) -> dict:
    """删掉 device_status 的孪生列 —— 模拟"某张表没执行迁移" 。"""
    conn.execute('ALTER TABLE device_status DROP COLUMN ts_utc')
    conn.commit()
    cols = {r[1] for r in conn.execute('PRAGMA table_info(device_status)')}
    return {'seeded': 'device_status.ts_utc 被删除', 'columns': sorted(cols)}


def seed_lint_unregistered(root: Path) -> dict:
    """往扫描根塞一个"新表用了时间列但没登记口径"的文件。"""
    p = root / '新增_未登记时间口径.py'
    p.write_text(
        "DDL = '''\n"
        "CREATE TABLE IF NOT EXISTS batch_runs (\n"
        "    id INTEGER PRIMARY KEY,\n"
        "    batch_no TEXT,\n"
        "    finished_at DATETIME,\n"
        "    created_at DATETIME DEFAULT CURRENT_TIMESTAMP\n"
        ")\n"
        "'''\n", encoding='utf-8')
    return {'seeded': f'新增 {p.name}（batch_runs.finished_at 未登记）'}


def seed_anchor_truncate(conn: sqlite3.Connection) -> dict:
    """删掉链的最后两条 —— 链内自洽，只有外部锚点能发现。

    必须按 seq 删，不能按 count 删：``DELETE`` 之后 AUTOINCREMENT 不回落，
    第 N 条记录的 seq 可能远大于 N。第一版按 count 删，删错了行还自以为对。
    """
    seqs = [r[0] for r in conn.execute(
        'SELECT seq FROM config_change_log ORDER BY seq').fetchall()]
    if len(seqs) < 3:
        return {'seeded': '链太短，无法播种'}
    victims = seqs[-2:]
    conn.executemany('DELETE FROM config_change_log WHERE seq = ?', [(s,) for s in victims])
    conn.commit()
    left = conn.execute('SELECT COUNT(*) FROM config_change_log').fetchone()[0]
    return {'seeded': f'删除 seq={victims}，剩 {left} 条'}


def seed_write_path_null(conn: sqlite3.Connection) -> dict:
    """插入一条"应用刚写下、但漏了 ts_utc"的行 —— 模拟写入路径少传一个字段。

    这正是我上一轮真实制造过的缺陷：insert_data_batch 的参数从 6 元组变 7 元组，
    realtime 的 INSERT 仍写 6 个占位符，导致每一批写入都失败。回填过的历史数据
    让所有检测器都绿着，只有"看最近写入的行"才能发现。
    """
    now = datetime.now()
    conn.execute('''
        INSERT INTO history_data (device_id, register_name, value, unit, timestamp, ts_utc, created_at)
        VALUES ('seed_dev', 'seed_reg', 1.0, 'x', ?, NULL, ?)
    ''', (now.strftime('%Y-%m-%d %H:%M:%S.%f'),
           (now - timedelta(hours=8)).strftime('%Y-%m-%d %H:%M:%S')))
    conn.commit()
    return {'seeded': '新增 1 行 ts_utc 为 NULL 的近期数据'}


def _prep_recent_rows(db: Path, ctx: dict) -> dict:
    """造几条"刚刚写入且 ts_utc 正确"的行，让写入路径体检有东西可看。"""
    conn = connect_rw(db)
    try:
        now = datetime.now()
        rows = [(f'dev_{i:02d}', 'boiler_temperature', 100.0 + i, '°C',
                 now.strftime('%Y-%m-%d %H:%M:%S.%f'),
                 (now - timedelta(hours=8)).strftime('%Y-%m-%d %H:%M:%S.%f'),
                 (now - timedelta(hours=8)).strftime('%Y-%m-%d %H:%M:%S'))
                for i in range(5)]
        conn.executemany('''
            INSERT INTO history_data (device_id, register_name, value, unit, timestamp, ts_utc, created_at)
            VALUES (?,?,?,?,?,?,?)
        ''', rows)
        conn.commit()
        return {'recent_rows': len(rows)}
    finally:
        conn.close()


def _write_recent(conn, rows):
    """rows: [(device, register, value)] → 以"现在"为时间写入 history_data。"""
    now = datetime.now()
    utc = now - timedelta(hours=8)
    conn.executemany('''
        INSERT INTO history_data (device_id, register_name, value, unit, timestamp, ts_utc, created_at)
        VALUES (?,?,?,?,?,?,?)
    ''', [(d, r, v, 'x', now.strftime('%Y-%m-%d %H:%M:%S.%f'),
            utc.strftime('%Y-%m-%d %H:%M:%S.%f'), utc.strftime('%Y-%m-%d %H:%M:%S'))
           for d, r, v in rows])
    conn.commit()


def _prep_coverage_cfg(db: Path, ctx: dict) -> dict:
    import yaml
    devs = {'devices': [
        {'id': f'cov_dev{i}', 'protocol': 'modbus_tcp', 'enabled': True,
         'registers': [{'name': f'r{i}a'}, {'name': f'r{i}b'}]} for i in range(3)]}
    cfg = ctx['dir'] / 'devices_cov.yaml'
    cfg.write_text(yaml.safe_dump(devs, allow_unicode=True, sort_keys=False), encoding='utf-8')
    conn = connect_rw(db)
    try:
        _write_recent(conn, [(f'cov_dev{i}', f'r{i}{s}', 1.0)
                             for i in range(3) for s in ('a', 'b')])
        # 另给 cov_dev0 补一条**历史**行：播种时只清"最近窗口"，
        # 它仍然"历史上出现过"，于是能判出"在采但采不全"，而不是"没部署"。
        old = datetime.now() - timedelta(days=1)
        old_utc = old - timedelta(hours=8)
        conn.execute('''
            INSERT INTO history_data (device_id, register_name, value, unit, timestamp, ts_utc, created_at)
            VALUES ('cov_dev0','r0a',1.0,'x',?,?,?)
        ''', (old.strftime('%Y-%m-%d %H:%M:%S.%f'),
              old_utc.strftime('%Y-%m-%d %H:%M:%S'), old_utc.strftime('%Y-%m-%d %H:%M:%S')))
        conn.commit()
    finally:
        conn.close()
    ctx['devices_cfg'] = cfg
    return {'devices_cfg': str(cfg), 'points': 6}


def seed_coverage_gap(conn: sqlite3.Connection) -> dict:
    """删掉一台设备的全部近期数据 —— 模拟"这台设备只采到第一个点"。"""
    # 只清"最近窗口内"的数据：设备历史上出现过、但最近一轮没采上来，
    # 这才是"采不全"。整台设备删干净会让它变成"没部署"，反而判不出来。
    conn.execute("DELETE FROM history_data WHERE device_id = 'cov_dev0' "
                 "AND created_at >= datetime((SELECT MAX(created_at) FROM history_data), "
                 "'-10 minutes')")
    conn.commit()
    left = conn.execute("SELECT COUNT(DISTINCT register_name) FROM history_data "
                        "WHERE device_id='cov_dev0'").fetchone()[0]
    return {'seeded': 'cov_dev0 最近窗口内的 2 个点被清空（历史保留）', 'left': left}


def _prep_alarm_cfg(db: Path, ctx: dict) -> dict:
    import yaml
    alarms = {'alarm_rules': [
        {'id': 'cov_rule', 'device_id': 'cov_dev0', 'register_name': 'r0a',
         'condition': 'greater_than', 'threshold': 100.0,
         'level': 'warning', 'enabled': True, 'description': '负向控制夹具'}]}
    cfg = ctx['dir'] / 'alarms_cov.yaml'
    cfg.write_text(yaml.safe_dump(alarms, allow_unicode=True, sort_keys=False), encoding='utf-8')
    conn = connect_rw(db)
    try:
        _write_recent(conn, [('cov_dev0', 'r0a', 150.0)])     # 越限：150 > 100
        now = datetime.now()
        conn.execute("DELETE FROM alarm_records WHERE alarm_id='cov_rule'")
        conn.execute('''
            INSERT INTO alarm_records
            (alarm_id, device_id, register_name, alarm_level, alarm_message, threshold,
             actual_value, timestamp, trigger_count, last_trigger_time, last_value,
             acknowledged)
            VALUES ('cov_rule','cov_dev0','r0a','warning','夹具',100.0,150.0,?,1,?,150.0,0)
        ''', (now.strftime('%Y-%m-%d %H:%M:%S'), now.strftime('%Y-%m-%d %H:%M:%S')))
        conn.commit()
    finally:
        conn.close()
    ctx['alarms_cfg'] = cfg
    return {'alarms_cfg': str(cfg), 'data': 'cov_dev0/r0a = 150 (阈值 100)', 'alarm_seeded': True}


def seed_alarm_missed(conn: sqlite3.Connection) -> dict:
    """删掉那条报警记录 —— 数据仍然越限，但报警没了 = 漏报。"""
    conn.execute("DELETE FROM alarm_records WHERE alarm_id='cov_rule'")
    conn.commit()
    n = conn.execute("SELECT COUNT(*) FROM alarm_records").fetchone()[0]
    return {'seeded': 'cov_rule 报警记录被删除（数据仍越限）', 'alarms_left': n}


def _prep_physical_cfg(db: Path, ctx: dict) -> dict:
    """两条点位：o2_content（单位 %，物理域 0~21）、mode_code（枚举，须整数）。"""
    import yaml
    devs = {'devices': [{
        'id': 'phys_dev', 'protocol': 'rest', 'enabled': True,
        'endpoints': [
            {'name': 'o2_content', 'unit': '%', 'description': '烟气含氧量'},
            {'name': 'mode_code', 'unit': '', 'description': '运行模式'},
        ]}]}
    cfg = ctx['dir'] / 'devices_phys.yaml'
    cfg.write_text(yaml.safe_dump(devs, allow_unicode=True, sort_keys=False), encoding='utf-8')
    conn = connect_rw(db)
    try:
        now = datetime.now()
        utc = now - timedelta(hours=8)
        rows = [('phys_dev', 'o2_content', 6.5), ('phys_dev', 'o2_content', 7.1),
                ('phys_dev', 'mode_code', 1.0), ('phys_dev', 'mode_code', 2.0)]
        conn.executemany('''
            INSERT INTO history_data (device_id, register_name, value, unit, timestamp, ts_utc, created_at)
            VALUES (?,?,?,?,?,?,?)
        ''', [(d, r, v, 'x', now.strftime('%Y-%m-%d %H:%M:%S.%f'),
                utc.strftime('%Y-%m-%d %H:%M:%S.%f'), utc.strftime('%Y-%m-%d %H:%M:%S'))
               for d, r, v in rows])
        conn.commit()
    finally:
        conn.close()
    ctx['devices_cfg'] = cfg
    return {'devices_cfg': str(cfg), 'o2': [6.5, 7.1], 'mode_code': [1, 2]}


def seed_physical_domain(conn: sqlite3.Connection) -> dict:
    """插一个含氧量 45% 的样本 —— 空气里只有 20.9% 氧气，45% 物理上不可能。"""
    now = datetime.now()
    utc = now - timedelta(hours=8)
    conn.execute('''
        INSERT INTO history_data (device_id, register_name, value, unit, timestamp, ts_utc, created_at)
        VALUES ('phys_dev','o2_content',45.0,'%',?,?,?)
    ''', (now.strftime('%Y-%m-%d %H:%M:%S.%f'),
           utc.strftime('%Y-%m-%d %H:%M:%S.%f'), utc.strftime('%Y-%m-%d %H:%M:%S')))
    conn.commit()
    return {'seeded': 'o2_content = 45%（物理上限 21%）'}


def _prep_subject_fixture(db: Path, ctx: dict) -> dict:
    """在库里放一份"与库匹配"的 runtime.json —— 应用自写的就是这种形状。"""
    import json, shutil
    d = ctx['dir'] / 'subject'
    d.mkdir(parents=True, exist_ok=True)
    target = d / 'scada_simulated.db'
    shutil.copy2(db, target)
    # 真开一个监听端口：守卫用"端口是否在监听"判断实例死活，
    # 造一份假的 runtime.json 但端口没人听，会一律判"实例未运行"。
    import socket
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    sock.listen(1)
    ctx['subj_sock'] = sock
    rt = {'port': sock.getsockname()[1], 'host': '127.0.0.1', 'pid': 4242,
          'mode': 'simulated',
          'started_at': datetime.now().isoformat(timespec='seconds')}
    (d / 'runtime.json').write_text(json.dumps(rt, ensure_ascii=False), encoding='utf-8')
    ctx['subject_db'] = target
    return {'runtime': str(d / 'runtime.json'), 'db': str(target)}


def seed_subject_mismatch(ctx: dict) -> dict:
    """把 runtime.json 的 mode 改成 real —— 应用写到别的库去了。"""
    import json
    p = Path(ctx['subject_db']).parent / 'runtime.json'
    rt = json.loads(p.read_text(encoding='utf-8'))
    rt['mode'] = 'real'
    p.write_text(json.dumps(rt, ensure_ascii=False), encoding='utf-8')
    return {'seeded': 'runtime.json mode: simulated -> real（应写的库变成 scada_real.db）'}


def _prep_ui_tree(db: Path, ctx: dict) -> dict:
    """把前端两个关键文件复制到临时目录，作为静态扫描根。"""
    import shutil
    d = ctx['dir'] / 'ui'
    (d / 'views').mkdir(parents=True, exist_ok=True)
    (d / 'utils').mkdir(parents=True, exist_ok=True)
    shutil.copy2(REPO / 'src' / 'views' / 'Dashboard.vue', d / 'views' / 'Dashboard.vue')
    shutil.copy2(REPO / 'src' / 'utils' / 'dashboard.ts', d / 'utils' / 'dashboard.ts')
    ctx['ui_root'] = d
    return {'ui_root': str(d)}


def seed_ui_level_dropped(ctx: dict) -> dict:
    """删掉 Bad 那一档的样式 —— 质量退化成"好/不确定/未知"三档，坏的看不见了。"""
    p = Path(ctx['ui_root']) / 'views' / 'Dashboard.vue'
    lines = p.read_text(encoding='utf-8').splitlines(keepends=True)
    kept = [l for l in lines if 'quality-dot--bad' not in l or ':class' in l]
    p.write_text(''.join(kept), encoding='utf-8')
    return {'seeded': '删掉 .quality-dot--bad 样式（Bad 与其它档无法区分）'}


def seed_ui_value_not_degraded(ctx: dict) -> dict:
    """把"坏值显示 ?? "删掉 —— 数字照常显示，只剩一个红点。"""
    p = Path(ctx['ui_root']) / 'utils' / 'dashboard.ts'
    src = p.read_text(encoding='utf-8')
    # 删掉所有含 '??' 的行（即坏值占位分支）
    kept = [l for l in src.splitlines(keepends=True) if "'??'" not in l]
    p.write_text(''.join(kept), encoding='utf-8')
    return {'seeded': "删除 displayValue 里的 '??' 分支（坏值恢复显示数字）"}


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
    {
        'detector': 'write_path',
        'defect': '写入路径漏了 ts_utc（近期行没有权威时间）',
        'expect_code': 'WRITE_PATH_NULL',
        'prepare': 'recent_rows',
        'seed': 'db',
        'seed_fn': seed_write_path_null,
    },
    {
        'detector': 'point_coverage',
        'defect': '一台设备配了 2 个点却只采到 0 个（历史上的"只入库第一个点"）',
        'expect_code': 'POINT_COVERAGE_GAP',
        'prepare': 'coverage_cfg',
        'seed': 'db',
        'seed_fn': seed_coverage_gap,
    },
    {
        'detector': 'alarm_coverage',
        'defect': '数据越限但报警表里没有对应记录（漏报）',
        'expect_code': 'ALARM_MISSED',
        'prepare': 'alarm_cfg',
        'seed': 'db',
        'seed_fn': seed_alarm_missed,
    },
    {
        'detector': 'physical_domain',
        'defect': '烟气含氧量 45%（空气只有 20.9%，物理不可能）',
        'expect_code': 'PHYS_OUT_OF_DOMAIN',
        'prepare': 'physical_cfg',
        'seed': 'db',
        'seed_fn': seed_physical_domain,
    },
    {
        'detector': 'ui_quality',
        'defect': 'Bad 质量档的样式被删（坏的看不出来）',
        'expect_code': 'UI_QUALITY_LEVELS_MISSING',
        'prepare': 'ui_tree',
        'seed': 'ctx',
        'seed_fn': seed_ui_level_dropped,
    },
    {
        'detector': 'ui_quality',
        'defect': "坏值恢复显示数字（'??' 分支被删）",
        'expect_code': 'UI_VALUE_NOT_DEGRADED',
        'prepare': 'ui_tree',
        'seed': 'ctx',
        'seed_fn': seed_ui_value_not_degraded,
    },
    {
        'detector': 'subject',
        'defect': 'runtime.json 指向另一个库（审错对象）',
        'expect_code': 'SUBJECT_MISMATCH',
        'prepare': 'subject_fixture',
        'seed': 'ctx',
        'seed_fn': seed_subject_mismatch,
    },
    {
        'detector': 'timebase_all',
        'defect': '某张表没执行迁移（孪生列被删）',
        'expect_code': 'TB_MISSING_TWIN',
        'prepare': 'timebase_twins',
        'seed': 'db',
        'seed_fn': seed_time_twin_drop,
    },
    {
        'detector': 'clock_lint',
        'defect': '新增一张表用了 finished_at，但没登记时间口径',
        'expect_code': 'CLOCK_UNREGISTERED_COLUMN',
        'prepare': 'lint_tree',
        'seed': 'lint_root',
        'seed_fn': seed_lint_unregistered,
    },
    {
        'detector': 'anchor',
        'defect': '删掉审计链最后两条（链内自洽，只有锚点能发现）',
        'expect_code': 'ANCHOR_TAIL_TRUNCATED',
        'prepare': 'chain_fixture',
        'seed': 'db',
        'seed_fn': seed_anchor_truncate,
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
        # 顺手钉一个外部锚点（防尾部截断靠它）
        from . import anchor as anchor_mod
        apath = ctx['dir'] / 'audit-anchors.json'
        anch = anchor_mod.make(conn, apath, note='负向控制夹具')
        ctx['anchor_path'] = apath
        return {'entries': rep['entries'], 'ok': rep['ok'], 'head': rep['head_hash'],
                'anchor': anch.get('anchor', {}).get('anchor_hash', '')[:12]}
    finally:
        conn.close()


def _prep_timebase_twins(db: Path, ctx: dict) -> dict:
    from . import schema_clock
    conn = connect_rw(db)
    try:
        return schema_clock.install(conn)
    finally:
        conn.close()


def _prep_lint_tree(db: Path, ctx: dict) -> dict:
    """复制一份 backend/src 作为静态检查的扫描根（播种时往里加坏文件）。"""
    src = REPO / 'backend' / 'src'
    dst = ctx['dir'] / 'src_copy'
    if not dst.exists():
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    ctx['lint_root'] = dst
    return {'scanned_root': str(dst)}


PREPARES = {
    'alarm_fixture': _prep_alarm_fixture,
    'timebase_migrate': _prep_timebase_migrate,
    'timebase_twins': _prep_timebase_twins,
    'lint_tree': _prep_lint_tree,
    'recent_rows': _prep_recent_rows,
    'coverage_cfg': _prep_coverage_cfg,
    'alarm_cfg': _prep_alarm_cfg,
    'physical_cfg': _prep_physical_cfg,
    'subject_fixture': _prep_subject_fixture,
    'ui_tree': _prep_ui_tree,
    'backup_fixture': _prep_backup_fixture,
    'chain_fixture': _prep_chain_fixture,
}


# ---------------------------------------------------------------- 执行

def _run_detector(name: str, ctx: dict):
    fn, kind = detectors.REGISTRY[name]
    if kind == 'ui_root':
        return fn(ctx.get('ui_root'))
    if kind == 'db_subject':
        return fn(ctx.get('subject_db') or ctx['db'])
    if kind == 'db':
        return fn(ctx['db'])
    if kind == 'config':
        return fn(ctx['config'])
    if kind == 'file':
        return fn(ctx['backup_path'], ctx.get('backup_baseline'))
    if kind == 'db_anchor':
        return fn(ctx['db'], ctx.get('anchor_path'))
    if kind == 'none':
        return fn(ctx.get('lint_root'))
    if kind == 'db_dev':
        return fn(ctx['db'], ctx.get('devices_cfg'))
    if kind == 'ui_root':
        return fn(ctx.get('ui_root'))
    if kind == 'db_subject':
        return fn(ctx.get('subject_db') or ctx['db'])
    if kind == 'db_alarm':
        return fn(ctx['db'], ctx.get('alarms_cfg'))
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
        elif case['seed'] == 'ctx':
            seed_info = case['seed_fn'](ctx)
        elif case['seed'] == 'lint_root':
            seed_info = case['seed_fn'](ctx['lint_root'])

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
