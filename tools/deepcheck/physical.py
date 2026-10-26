"""物理与语义域：这个值在物理上可能存在吗？

前面的检查都在问"数据一致吗"（时间对得上、质量戳在、字节序没反），
这一层问的是更根本的问题：**这个数在物理上可能存在吗**。

三条判据，全部来自外部（单位制、量纲、工程语义），不来自我们的代码：

1. **量纲域**：pH 只能 0~14、烟气含氧量 0~21%、功率因数 0~1、频率 45~65Hz。
   超出不是"异常"，是"这个仪表或这条链路错了"。
2. **整数语义**：`program_number` / `alarm_code` / `machine_mode` 这类量
   带小数就是错的 —— 程序号 51.19 不存在。
3. **状态量会变**：`*_status` 若在整段数据里只有一个取值，OEE 的可用率
   就没有输入（分母恒为同一状态）。恒常不是"设备稳定"，是"这个信号是死的"。

这三条能抓住一类特别危险的缺陷：**数值看起来"在范围内"**（因为模拟器
给了 50~150 的均匀分布），但语义上完全不可能。大屏上画得出来，评审一问就露。
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

from .common import FAIL, INSUFFICIENT, PASS, REPO, Finding, Result, connect_ro
from .coverage import _load, _points_of, _window_bounds

DEFAULT_DEVICES = REPO / 'backend' / 'src' / '配置' / 'devices_simulated.yaml'

#: 按单位给出物理可能区间。只写**确定无疑**的边界，宁缺勿滥：
#: 写错一条边界，整条检查的可信度就没了。
UNIT_LIMITS = {
    '°C': (-273.15, 2000.0),
    'MPa': (0.0, 100.0),
    'kPa': (0.0, 100000.0),
    'bar': (0.0, 1000.0),
    'V': (0.0, 1000.0),
    'A': (0.0, 20000.0),
    'kW': (0.0, 1e6),
    # % 的硬上限放到 1000：149% 主轴负载是"过载"，物理上可能，不该判不可能。
    # 0~100 之外另行按"疑似量纲/标定错"给 warning（见 SOFT_RANGE）。
    '%': (0.0, 1000.0),
    'Hz': (45.0, 65.0),
    'mm/s': (0.0, 500.0),
    'm³/h': (0.0, 1e5),
    'm/min': (0.0, 3000.0),
    'mm': (0.0, 1e5),
    'mg/m³': (0.0, 1e6),
    'μS/cm': (0.0, 1e5),
    'NTU': (0.0, 4000.0),
}

#: 名字里带这些词 → 语义上必须是整数
INT_NAMES = re.compile(r'(number|count|quantity|code|_no$|_id$)', re.I)
#: 名字里带这些词 → 枚举量（取值应很少且为整数）
ENUM_NAMES = re.compile(r'(status|state|mode|level_code|fault|alarm_code)', re.I)
#: 状态量（用于"恒常"检查）
STATUS_NAMES = re.compile(r'(status|state)$', re.I)
#: 名字里带这些词 → 有更窄的物理域
#: ⚠️ 这些正则必须用**词边界**。第一版写成子串匹配 `ratio`，
#: 结果把 `vibration_x`（vib-**ratio**-n）判成了"比率超出 0~1.5"——
#: 一次典型的假阳性，也说明"边界写宽了比不写更糟"。
NARROW = [
    (re.compile(r'(oxygen|(^|_)o2($|_))', re.I), (0.0, 21.0),
     '烟气含氧量不可能超过 21%（空气本身只有 20.9%）'),
    (re.compile(r'power_factor|cos_?phi', re.I), (0.0, 1.0), '功率因数定义域 0~1'),
    (re.compile(r'(^|_)ph($|_)|ph_value', re.I), (0.0, 14.0), 'pH 定义域 0~14'),
    (re.compile(r'(^|_)thd($|_)|harmonic', re.I), (0.0, 100.0), '总谐波畸变率按百分比计 0~100'),
    (re.compile(r'(^|_)reflux_ratio$', re.I), (0.0, 10.0), '回流比通常在 0.5~10'),
]

#: 软边界：超出不判"物理不可能"，但值得记为"疑似标定/量纲错"
SOFT_RANGE = [(re.compile(r'.'), (0.0, 100.0), '% 类点位超出 0~100，疑似标定或量纲错')]


def det_physical_domain(db: Path, config_path: Path | None = None,
                        window_minutes: int = 15) -> Result:
    cfg_path = Path(config_path) if config_path else DEFAULT_DEVICES
    points = []
    for dev in (_load(cfg_path).get('devices') or []):
        if not dev.get('enabled', True):
            continue
        for key in ('registers', 'topics', 'endpoints'):
            for p in dev.get(key) or []:
                if isinstance(p, dict) and p.get('name'):
                    points.append({'device': dev['id'], 'name': p['name'],
                                   'unit': (p.get('unit') or '').strip(),
                                   'desc': p.get('description', '')})

    with connect_ro(db) as conn:
        lo, anchor = _window_bounds(conn, window_minutes)
        if lo is None:
            return Result(id='physical_domain', title='物理与语义域', claim='DATA-12',
                          verdict=INSUFFICIENT, metrics={'reason': 'history_data 为空'},
                          ground_truth='单位制 / 量纲 / 工程语义（外部约束）')
        stats = {}
        for r in conn.execute('''
            SELECT register_name, COUNT(*) n, MIN(value) mn, MAX(value) mx,
                   COUNT(DISTINCT value) d
            FROM history_data WHERE created_at >= ? GROUP BY register_name
        ''', (lo,)):
            stats[r['register_name']] = dict(r)

    out_of_domain, non_integer, frozen, suspect_range = [], [], [], []
    checked = 0
    for p in points:
        s = stats.get(p['name'])
        if not s or not s['n']:
            continue
        checked += 1
        mn, mx, unit = s['mn'], s['mx'], p['unit']

        limits, why = None, ''
        for rx, lim, reason in NARROW:
            if rx.search(p['name']):
                limits, why = lim, reason
                break
        if limits is None and unit in UNIT_LIMITS:
            limits, why = UNIT_LIMITS[unit], f'单位 {unit} 的物理可能区间'
        if limits and (mn < limits[0] or mx > limits[1]):
            out_of_domain.append({'device': p['device'], 'point': p['name'],
                                  'unit': unit, 'observed': [round(mn, 3), round(mx, 3)],
                                  'allowed': list(limits), 'why': why})
        elif unit == '%' and (mn < -0.001 or mx > 100.001):
            suspect_range.append({'device': p['device'], 'point': p['name'],
                                  'observed': [round(mn, 3), round(mx, 3)],
                                  'why': '% 类点位实测超出 0~100（过载还是标定错？需要工艺确认）'})

        # 整数语义：程序号/报警码/计数带小数就是错的
        if INT_NAMES.search(p['name']) or ENUM_NAMES.search(p['name']):
            frac = max(abs(mn - round(mn)), abs(mx - round(mx)))
            if frac > 1e-6:
                non_integer.append({'device': p['device'], 'point': p['name'],
                                    'observed': [round(mn, 3), round(mx, 3)],
                                    'distinct': s['d'],
                                    'why': '语义为整数/枚举，实测带小数'})
            elif s['d'] > 16 and ENUM_NAMES.search(p['name']):
                non_integer.append({'device': p['device'], 'point': p['name'],
                                    'observed': [round(mn, 3), round(mx, 3)],
                                    'distinct': s['d'],
                                    'why': f"枚举量出现 {s['d']} 种取值（应 ≤16）"})

        if STATUS_NAMES.search(p['name']) and s['d'] == 1:
            # 窗口内不变**不算**缺陷：设备可能真的稳定运行着。
            # 只有"整段历史里始终一个值、而同设备的过程量一直在变"才是死信号。
            with connect_ro(db) as c2:
                full = c2.execute(
                    'SELECT COUNT(DISTINCT value), COUNT(*) FROM history_data '
                    'WHERE register_name = ?', (p['name'],)).fetchone()
                others = c2.execute(
                    'SELECT COUNT(*) FROM (SELECT register_name, COUNT(DISTINCT value) d '
                    'FROM history_data WHERE device_id = ? AND register_name != ? '
                    'GROUP BY 1 HAVING d > 1)', (p['device'], p['name'])).fetchone()[0]
            if full and full[0] == 1 and others >= 1:
                frozen.append({'device': p['device'], 'point': p['name'],
                               'constant': round(mn, 3),
                               'rows_seen': full[1], 'varying_points_on_device': others})

    findings = []
    if out_of_domain:
        findings.append(Finding(
            'PHYS_OUT_OF_DOMAIN',
            f'{len(out_of_domain)} 个点的取值超出物理可能区间',
            'critical', len(out_of_domain), {'points': out_of_domain[:10]}))
    if non_integer:
        findings.append(Finding(
            'PHYS_NON_INTEGER_ENUM',
            f'{len(non_integer)} 个整数/枚举语义的点出现小数或取值过多',
            'critical', len(non_integer), {'points': non_integer[:10]}))
    if suspect_range:
        findings.append(Finding(
            'PHYS_SUSPECT_RANGE',
            f'{len(suspect_range)} 个百分比点位实测超出 0~100（物理上可能是过载，但更像是标定/量纲错）',
            'warning', len(suspect_range), {'points': suspect_range[:10]}))
    if frozen:
        findings.append(Finding(
            'PHYS_STATUS_FROZEN',
            f'{len(frozen)} 个状态量在整段数据里只有一个取值 —— OEE 可用率没有输入',
            'warning', len(frozen), {'points': frozen[:10]}))

    return Result(
        id='physical_domain', title='物理与语义域（量纲 / 整数语义 / 状态是否在变）',
        claim='DATA-12',
        verdict=FAIL if any(f.severity == 'critical' for f in findings) else PASS,
        metrics={'window_minutes': window_minutes, 'anchor': anchor,
                 'points_checked': checked,
                 'out_of_domain': len(out_of_domain),
                 'suspect_range': len(suspect_range),
                 'non_integer': len(non_integer), 'frozen_status': len(frozen)},
        findings=findings,
        ground_truth='SI 单位制 / 量纲定义 / 工程语义；不依赖项目自身的阈值配置',
        sample=checked,
    )


# ---------------------------------------------------------------- 物料平衡

#: 做质量平衡所需的最小测点组合：(流入, 流出, 存量)
BALANCE_REQUIRED = {
    '锅炉汽包': {'in': ('feed_water_flow', '给水流量'), 'out': ('steam_flow', '蒸汽流量'),
             'stock': ('feed_water_level', '汽包水位')},
}


def det_mass_balance(db: Path) -> Result:
    """物料平衡：**先问仪表够不够，再问平不平衡**。

    这不是"不做"，是"做了，结论是仪表不够"：
    锅炉回路有蒸汽流量、有汽包水位，**没有给水流量计**。
    没有流入侧，质量平衡在数学上无解 —— 不是算法问题，是测点缺失。

    工程上的正确答案是"装表"，而不是"用模拟数据凑一个平衡率"。
    凑出来的数字看起来专业，实际上比没有更糟。
    """
    with connect_ro(db) as conn:
        have = {r[0] for r in conn.execute(
            'SELECT DISTINCT register_name FROM history_data')}

    missing, ok_sets = [], []
    for loop, need in BALANCE_REQUIRED.items():
        lack = [label for key, (col, label) in need.items() if col not in have]
        if lack:
            missing.append({'loop': loop, 'missing': lack,
                            'has': [label for key, (col, label) in need.items()
                                    if col in have]})
        else:
            ok_sets.append(loop)

    findings = [Finding(
        'MASS_BALANCE_INSTRUMENTATION_MISSING',
        f"{missing[0]['loop']}：缺 {('、'.join(missing[0]['missing']))}，"
        f"质量平衡无法计算（这是测点缺失，不是算法问题）",
        'warning', len(missing), {'loops': missing})] if missing else []

    return Result(
        id='mass_balance', title='物料平衡（仪表齐备性）', claim='DATA-13',
        verdict=INSUFFICIENT if missing else PASS,
        metrics={'loops': len(BALANCE_REQUIRED), 'incomplete': len(missing),
                 'complete': ok_sets,
                 'required': {k: {'in': v['in'][1], 'out': v['out'][1],
                                  'stock': v['stock'][1]} for k, v in BALANCE_REQUIRED.items()}},
        findings=findings,
        ground_truth='质量守恒（流入-流出=存量变化）；前提是两侧都有流量计',
        sample=len(have),
    )
