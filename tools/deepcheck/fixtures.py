"""已知真值的测试样本。

为什么需要它：现场库里只有 **1 条报警记录**。拿 1 条记录算「critical 占比 0%、
达标」，不是验证，是巧合 —— 样本量 1 时任何占比都只能取 0% 或 100%。

所以负向控制不用现场数据，用**真值已知的合成样本**。这有个必须讲清楚的边界：

    它检验的是「检测器有没有分辨力」，不是「系统健不健康」。
    前者可以靠合成样本证明，后者只能靠连续运行 30 天。

两者的区别写在报告的"证据分级"里，不混着算。
"""

from __future__ import annotations

import random
import sqlite3
from datetime import datetime, timedelta

#: 合成样本规模。200 条足够让 5% 阈值有分辨力（5% × 200 = 10 条），
#: 又不会让负向控制跑得慢。
N_ALARMS = 200
N_CRITICAL = 4          # 2.0% —— 低于 5% 阈值，属"合格"
N_UNACK = 10            # 未确认，但都在 24h 内 → 不算陈旧

ALARM_IDS = [f'ALM{i:03d}' for i in range(1, 21)]
DEVICES = [f'dev_{i:02d}' for i in range(1, 31)]
LEVELS = ['info'] * 156 + ['warning'] * 40 + ['critical'] * N_CRITICAL


def build_alarm_population(conn: sqlite3.Connection, seed: int = 20261026) -> dict:
    """重建一张真值已知的报警表（仅在快照上执行）。

    真值：总数 200 / critical 4（2.0%）/ 未确认 10 但都新鲜 / 无抖动 / 无陈旧。
    """
    rnd = random.Random(seed)
    conn.execute('DELETE FROM alarm_records')
    now = datetime.now()
    levels = LEVELS[:]
    rnd.shuffle(levels)

    rows = []
    for i in range(N_ALARMS):
        # 时间按「槽位」排开：每轮 20 条（覆盖 20 个报警号）占 2 小时，
        # 同号最多每小时 1 条。若像第一版那样随机撒在 20 小时里，
        # 就会出现某个号偶然挤进同一小时 ≥6 条 —— 抖动检测器报"抖动"，
        # 而那是合成样本的取样偏差，不是被测系统的缺陷。夹具本身不能制造假阳性。
        slot = i // len(ALARM_IDS)
        ts = now - timedelta(hours=slot * 2 + 1, minutes=rnd.randint(0, 50))
        ack = i >= N_UNACK
        ack_at = (ts + timedelta(minutes=rnd.randint(1, 9))) if ack else None
        rows.append((
            ALARM_IDS[i % len(ALARM_IDS)],
            DEVICES[i % len(DEVICES)],
            rnd.choice(['boiler_temperature', 'boiler_pressure', 'steam_flow']),
            levels[i],
            f'合成样本报警 #{i}',
            180.0,
            180.0 + rnd.random() * 20,
            ts.strftime('%Y-%m-%d %H:%M:%S.%f'),
            rnd.randint(1, 3),
            ts.strftime('%Y-%m-%d %H:%M:%S.%f'),
            180.0 + rnd.random() * 20,
            1 if ack else 0,
            ack_at.strftime('%Y-%m-%d %H:%M:%S.%f') if ack_at else None,
            'tester' if ack else None,
        ))

    conn.executemany('''
        INSERT INTO alarm_records
        (alarm_id, device_id, register_name, alarm_level, alarm_message, threshold,
         actual_value, timestamp, trigger_count, last_trigger_time, last_value,
         acknowledged, acknowledged_at, acknowledged_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ''', rows)
    conn.commit()
    return {'total': N_ALARMS, 'critical': N_CRITICAL,
            'critical_share': N_CRITICAL / N_ALARMS,
            'unacknowledged': N_UNACK, 'stale': 0, 'chattering': 0}


def build_backup(src_db, dst_file) -> dict:
    """用 SQLite 自己的备份 API 生成备份（不是拷文件）。"""
    import sqlite3 as s
    src = s.connect(str(src_db))
    dst = s.connect(str(dst_file))
    try:
        src.backup(dst)
        dst.commit()
        integrity = dst.execute('PRAGMA integrity_check').fetchone()[0]
        counts = {}
        for t in ('history_data', 'realtime_data', 'alarm_records', 'operation_logs'):
            try:
                counts[t] = dst.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
            except s.Error:
                counts[t] = None
    finally:
        dst.close()
        src.close()
    return {'integrity': integrity, 'counts': counts}
