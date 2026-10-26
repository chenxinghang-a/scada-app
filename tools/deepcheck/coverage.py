"""覆盖类检查：点位有没有真的采上来、报警规则能不能响。

这两个检测器回答的是上一轮完全没问的问题：

* **点位覆盖率** —— 配置里写了 201 个点，数据库里到底有几个**在建动**？
  实测（修复前）只有 55 个（27%）：所有 Modbus 设备只入库第一个点。
  根因是模拟客户端的 ``read_holding_registers`` 忽略 ``count``，只返回起始
  那一个寄存器；采集器按"切片不足就跳过"的处理，把其余点静默丢了。
  这类缺陷不会报错、不会告警，只会让大屏上大部分点是空的。

* **报警规则有效性** —— 10 条启用规则里，有几条的阈值是当前工况永远碰不到的？
  碰不到不一定是错（保护性阈值本来就该远），但**必须能说清是"保护"还是"拍脑袋"**，
  并且必须有一条检查能发现"数据越限了但报警没产生"（漏报）。

判据都写在代码里，不靠人记。
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from .common import FAIL, INSUFFICIENT, PASS, REPO, Finding, Result, connect_ro

DEFAULT_DEVICES = REPO / 'backend' / 'src' / '配置' / 'devices_simulated.yaml'
DEFAULT_ALARMS = REPO / 'backend' / 'src' / '配置' / 'alarms.yaml'

#: 覆盖率下限。低于它说明"配了但没采"，不是个别点抖动。
COVERAGE_MIN = 0.90


def _load(path: Path) -> dict:
    import yaml
    with open(path, encoding='utf-8') as f:
        return yaml.safe_load(f) or {}


def _points_of(dev: dict) -> list[str]:
    names = []
    for key in ('registers', 'topics', 'endpoints'):
        for p in dev.get(key) or []:
            if isinstance(p, dict) and p.get('name'):
                names.append(p['name'])
    return names


def _window_bounds(conn: sqlite3.Connection, window_minutes: int):
    """以"库里最新一行"为锚点取窗口，而不是以墙钟。

    为什么：拿墙钟当锚点的话，系统没跑时窗口是空的，覆盖率会变成 0% 的假红；
    以最新数据为锚点，语义是"**最近一轮采集**里配的点到了几个"，
    对离线库和在线库都成立。
    """
    row = conn.execute('SELECT MAX(created_at) FROM history_data').fetchone()
    if not row or not row[0]:
        return None, None
    anchor = row[0]
    lo = conn.execute("SELECT datetime(?, ?)", (anchor, f'-{window_minutes} minutes')).fetchone()[0]
    return lo, anchor


def det_point_coverage(db: Path, config_path: Path | None = None,
                       window_minutes: int = 10) -> Result:
    cfg_path = Path(config_path) if config_path else DEFAULT_DEVICES
    cfg = _load(cfg_path)
    devices = [d for d in (cfg.get('devices') or []) if d.get('enabled', True)]

    with connect_ro(db) as conn:
        lo, anchor = _window_bounds(conn, window_minutes)
        if lo is None:
            return Result(id='point_coverage', title='点位采集覆盖率', claim='DATA-11',
                          verdict=INSUFFICIENT, metrics={'reason': 'history_data 为空'},
                          ground_truth='配置点位 vs 最近窗口实际入库点位')
        rows = conn.execute('''
            SELECT device_id, register_name
            FROM history_data WHERE created_at >= ? GROUP BY device_id, register_name
        ''', (lo,)).fetchall()
    present: dict[str, set] = {}
    for r in rows:
        present.setdefault(r['device_id'], set()).add(r['register_name'])

    gaps, per_dev = [], []
    cfg_total = got_total = 0
    for dev in devices:
        want = _points_of(dev)
        if not want:
            continue
        have = present.get(dev['id'], set())
        hit = [n for n in want if n in have]
        cfg_total += len(want)
        got_total += len(hit)
        ratio = len(hit) / len(want)
        per_dev.append({'device': dev['id'], 'protocol': dev.get('protocol'),
                        'configured': len(want), 'collected': len(hit),
                        'ratio': round(ratio, 3)})
        if ratio < COVERAGE_MIN:
            gaps.append({'device': dev['id'], 'protocol': dev.get('protocol'),
                         'configured': len(want), 'collected': len(hit),
                         'missing': [n for n in want if n not in have][:12],
                         'ratio': round(ratio, 3)})

    overall = (got_total / cfg_total) if cfg_total else 0.0
    findings = []
    if gaps:
        findings.append(Finding(
            'POINT_COVERAGE_GAP',
            f'{len(gaps)} 台设备的点位覆盖率低于 {COVERAGE_MIN:.0%}（整体 {overall:.0%}）'
            '—— 配了但没采上来',
            'critical', len(gaps), {'devices': gaps[:8]}))

    return Result(
        id='point_coverage', title='点位采集覆盖率（配置 vs 实际入库）', claim='DATA-11',
        verdict=PASS if not findings else FAIL,
        metrics={'window_minutes': window_minutes, 'anchor': anchor,
                 'devices': len(per_dev), 'configured_points': cfg_total,
                 'collected_points': got_total,
                 'coverage': round(overall, 4), 'min_ratio': COVERAGE_MIN,
                 'by_device': per_dev},
        findings=findings,
        ground_truth='设备配置的 point 列表 × history_data 最近窗口的 distinct(device,register)',
        sample=cfg_total,
    )


def det_alarm_coverage(db: Path, alarms_path: Path | None = None,
                       window_minutes: int = 30) -> Result:
    """报警规则有效性：能不能响、有没有漏报、阈值离工况多远。"""
    cfg_path = Path(alarms_path) if alarms_path else DEFAULT_ALARMS
    rules = [r for r in (_load(cfg_path).get('alarm_rules') or []) if r.get('enabled', True)]

    no_data, missed, unreachable, alive = [], [], [], []
    with connect_ro(db) as conn:
        lo, anchor = _window_bounds(conn, window_minutes)
        if lo is None:
            return Result(id='alarm_coverage', title='报警规则有效性', claim='ALM-06',
                          verdict=INSUFFICIENT, metrics={'reason': 'history_data 为空'},
                          ground_truth='alarms.yaml 规则 × history_data 值域 × alarm_records')
        alarms = {r[0] for r in conn.execute('SELECT DISTINCT alarm_id FROM alarm_records')}

        for r in rules:
            row = conn.execute('''
                SELECT COUNT(*) AS n, MIN(value) AS mn, MAX(value) AS mx
                FROM history_data WHERE device_id = ? AND register_name = ? AND created_at >= ?
            ''', (r['device_id'], r['register_name'], lo)).fetchone()
            if not row or not row['n']:
                no_data.append({'rule': r['id'], 'point': f"{r['device_id']}/{r['register_name']}"})
                continue

            mn, mx, th = row['mn'], row['mx'], float(r['threshold'])
            crossed = (mx > th) if r['condition'] == 'greater_than' else (mn < th)
            if crossed:
                if r['id'] in alarms:
                    alive.append({'rule': r['id'], 'amplitude': round(mx - th, 3)})
                else:
                    missed.append({'rule': r['id'], 'threshold': th,
                                   'observed': [round(mn, 2), round(mx, 2)],
                                   'condition': r['condition']})
            else:
                # 阈值离当前包络有多远：以"包络跨度"为单位，>1 表示永远碰不到
                span = max(mx - mn, 1e-9)
                gap = (th - mx) if r['condition'] == 'greater_than' else (mn - th)
                unreachable.append({'rule': r['id'], 'threshold': th,
                                    'envelope': [round(mn, 2), round(mx, 2)],
                                    'gap_in_spans': round(gap / span, 1),
                                    'level': r.get('level')})

    findings = []
    if missed:
        findings.append(Finding(
            'ALARM_MISSED',
            f"{len(missed)} 条规则的数据已越限，但报警表里没有对应记录 —— 漏报",
            'critical', len(missed), {'rules': missed}))
    if no_data:
        findings.append(Finding(
            'ALARM_RULE_NO_DATA',
            f"{len(no_data)} 条规则指向的点在窗口内没有数据 —— 规则永远不会被评估",
            'critical', len(no_data), {'rules': no_data}))
    if unreachable:
        findings.append(Finding(
            'ALARM_RULE_UNREACHABLE',
            f"{len(unreachable)} 条规则的阈值在窗口内从未触及（最远 {unreachable[0]['gap_in_spans']} 倍包络）"
            '—— 需要工艺依据说明是"保护性阈值"还是"拍的"',
            'warning', len(unreachable), {'rules': unreachable}))

    # 漏报是必须为零的硬指标；"不可达"只要求登记，不判失败
    verdict = PASS
    if any(f.severity == 'critical' for f in findings):
        verdict = FAIL
    elif findings:
        verdict = PASS      # 仅有 warning：记录但不否定

    return Result(
        id='alarm_coverage', title='报警规则有效性（能响 / 漏报 / 不可达）', claim='ALM-06',
        verdict=verdict,
        metrics={'window_minutes': window_minutes, 'anchor': anchor,
                 'rules': len(rules), 'alive': len(alive), 'missed': len(missed),
                 'no_data': len(no_data), 'unreachable': len(unreachable),
                 'alive_rules': [a['rule'] for a in alive],
                 'unreachable_rules': [u['rule'] for u in unreachable]},
        findings=findings,
        ground_truth='alarms.yaml 阈值 × history_data 值域 × alarm_records 是否存在',
        sample=len(rules),
    )
