"""模拟值的语义兜底：不知道这个点是什么，也要生成"物理上说得过去"的数。

背景：模拟客户端对未建模的点位用了 ``50 + 30 * time.time() % 100`` ——
于是同一台 REST 设备的 10 个点（程序号、报警码、刀具号、主轴转速、负载……）
值域完全一样，全是 54.75~149.0。程序号出现 51.19 就是这么来的。

凡是"不知道就撒一把均匀随机"的模拟器，都会产出**看起来有数、实际不可用**的数据：
大屏能画，SPC/OEE 能算，评审一问"程序号 51.19 是什么意思"就完了。

这里按 **单位 + 名字** 推一个合理值域，比均匀随机强得多，且不假装精确：
它只保证"这个数物理上可能存在"，不保证"符合这台设备的真实工况"。
"""
from __future__ import annotations

import math
import random
import re
import time

INT_RE = re.compile(r'(count|quantity|number|code|shot|total|program)', re.I)
ENUM_RE = re.compile(r'(status|state|mode|level_code|fault)', re.I)
ID_RE = re.compile(r'(tool|program_number|current_tool)', re.I)

#: 单位 → (下限, 上限)。与 tools/deepcheck/physical.py 的硬边界**故意不同**：
#: 那里判"物理不可能"，这里生成"正常工况"，所以这里更窄。
UNIT_BAND = {
    '°C': (15.0, 95.0),
    'MPa': (0.3, 1.2),
    'kPa': (90.0, 120.0),
    'bar': (3.0, 12.0),
    'V': (215.0, 235.0),
    'A': (5.0, 30.0),
    'kW': (3.0, 60.0),
    '%': (30.0, 95.0),
    'Hz': (49.8, 50.2),
    'mm/s': (0.4, 2.6),
    'm³/h': (4.0, 60.0),
    'm/min': (8.0, 45.0),
    'mm': (120.0, 760.0),
    'mg/m³': (5.0, 90.0),
    'μS/cm': (400.0, 700.0),
    'NTU': (2.0, 12.0),
    '个': (0.0, 500.0),
}

#: 名字里带这些词 → 有自己更具体的工况带（覆盖单位带）
NAME_BAND = [
    (re.compile(r'sealing|热封', re.I), (160.0, 220.0)),
    (re.compile(r'boiler|锅炉', re.I), (170.0, 200.0)),
    (re.compile(r'dryer|烘干', re.I), (60.0, 110.0)),
    (re.compile(r'distill|蒸馏', re.I), (70.0, 100.0)),
    (re.compile(r'flue|排烟', re.I), (120.0, 180.0)),
    (re.compile(r'oxygen|含氧', re.I), (3.0, 9.0)),
    (re.compile(r'(^|_)ph($|_)|ph_value', re.I), (6.8, 7.4)),
    (re.compile(r'power_factor|cos_?phi', re.I), (0.82, 0.97)),
    (re.compile(r'vibration|振动', re.I), (0.4, 2.6)),
    (re.compile(r'tool_life|刀具寿命', re.I), (5.0, 95.0)),
    (re.compile(r'spindle_load|主轴负载', re.I), (20.0, 85.0)),
    (re.compile(r'feed_override|进给', re.I), (60.0, 120.0)),
]


def plausible(name: str, unit: str = '', seed_phase: float | None = None):
    """给一个"物理上说得过去"的模拟值。

    * 枚举/状态 → 0..3 的整数（**不是连续量**，否则 OEE 的状态跟踪没有输入）
    * 计数/编号 → 非负整数
    * 有单位 → 按单位/名字的工况带内做缓慢漂移（不是每拍独立随机，
      避免曲线像噪波）
    """
    n = name or ''
    phase = time.time() / 30.0 if seed_phase is None else seed_phase
    wobble = 0.5 + 0.5 * math.sin(phase + (abs(hash(n)) % 100) / 100.0 * math.tau)

    if ENUM_RE.search(n):
        # 枚举量必须**会变**（否则状态跟踪的分母恒定，OEE 可用率没有输入），
        # 但又不能每拍都变（那是抖动）。按 ~3 分钟一个台阶切换。
        step = int(phase // 6)
        return int((abs(hash(n)) // 7 + step) % 4)
    if INT_RE.search(n) or ID_RE.search(n):
        lo, hi = 1.0, 999.0
        for rx, band in NAME_BAND:
            if rx.search(n):
                lo, hi = band
                break
        return int(lo + (hi - lo) * wobble)

    lo, hi = None, None
    for rx, band in NAME_BAND:
        if rx.search(n):
            lo, hi = band
            break
    if lo is None:
        lo, hi = UNIT_BAND.get((unit or '').strip(), (40.0, 80.0))

    return round(lo + (hi - lo) * wobble, 2)
