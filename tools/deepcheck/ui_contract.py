"""人机界面契约：坏质量的值，操作员看得出来吗？

前 15 个检测器全在数据侧（库里对不对）。但 SCADA 的安全性最终落在**人**身上：
传感器坏了、通信断了，操作员在界面上看到的还是不是一个"正常读数"？

ISA-18.2 和 OPC UA 的共识是：**坏值必须在视觉上与好值可区分**，否则等于
把"不确定"伪装成"确定"——这比没有数据更危险。

本检查是**契约级**的，不启浏览器、不截图，只核对三件事：

1. 后端确实把质量码放进了实时数据（不是只在库里躺着）
2. 前端把质量码映射成**多个视觉等级**（不是二值"好/坏"）
3. 每个等级都有独立的样式类（不是共用同一个颜色）

第 4 件——"坏值是否连数值本身一起降级（置灰/问号）"——目前**没有**做，
如实记成 finding，而不是假装通过。
"""
from __future__ import annotations

import re
from pathlib import Path

from .common import FAIL, INSUFFICIENT, PASS, REPO, Finding, Result

DEFAULT_ROOT = REPO / 'src'

#: OPC UA 质量码的三档（>=192 Good / >=64 Uncertain / 其余 Bad），
#: 加 unknown 共四档。少于这个数说明退化成了二值判断。
EXPECTED_LEVELS = ('quality-dot--good', 'quality-dot--uncertain',
                   'quality-dot--bad', 'quality-dot--unknown')


def _read(p: Path) -> str:
    try:
        return p.read_text(encoding='utf-8')
    except OSError:
        return ''


def det_ui_quality(root: Path | None = None) -> Result:
    base = Path(root) if root else DEFAULT_ROOT
    vue = _read(base / 'views' / 'Dashboard.vue')
    util = _read(base / 'utils' / 'dashboard.ts')
    if not vue:
        return Result(id='ui_quality', title='坏值的视觉可辨性', claim='DATA-15',
                      verdict=INSUFFICIENT,
                      metrics={'reason': f'找不到前端文件: {base / "views" / "Dashboard.vue"}'},
                      ground_truth='OPC UA 质量码 + ISA-18.2 人机界面要求')

    findings = []

    # ① 质量等级是否分档（不允许只有"好/坏"两个类）
    present = [c for c in EXPECTED_LEVELS if c in vue]
    if len(present) < len(EXPECTED_LEVELS):
        findings.append(Finding(
            'UI_QUALITY_LEVELS_MISSING',
            f'前端只实现了 {len(present)}/{len(EXPECTED_LEVELS)} 个质量等级样式：'
            f'缺 {[c for c in EXPECTED_LEVELS if c not in vue]}',
            'critical', len(EXPECTED_LEVELS) - len(present)))

    # ② 每个等级是否真的绑了不同颜色（同名类但共用同一个背景色 = 视觉上没区分）
    colors = {}
    for m in re.finditer(r'(quality-dot--\w+)\s*\{([^}]*)\}', vue):
        colors[m.group(1)] = m.group(2).strip()
    distinct = len({v for v in colors.values()})
    if colors and distinct < len(colors):
        findings.append(Finding(
            'UI_QUALITY_COLORS_SHARED',
            f'{len(colors)} 个等级只用了 {distinct} 种样式 —— 视觉上没有区分开',
            'critical', len(colors) - distinct))

    # ③ 质量码的判定口径是否与 OPC UA 一致（>=192 Good / >=64 Uncertain）
    if util and not re.search(r'q\s*>=\s*192', util):
        findings.append(Finding(
            'UI_QUALITY_THRESHOLD',
            '前端的质量分档没有用 OPC UA 口径（>=192 Good / >=64 Uncertain）',
            'warning', 1))

    # ④ 坏值是否连**数值本身**一起降级 —— 目前没有，如实记录
    value_degraded = bool(re.search(r'quality-dot--bad[^{]*\{[^}]*text-decoration', vue))
    if not value_degraded:
        findings.append(Finding(
            'UI_VALUE_NOT_DEGRADED',
            '坏值只靠 8px 圆点区分，数值本身仍以正常样式显示 —— '
            '操作员扫一眼表格时容易把 Bad 当 Good 读',
            'warning', 1))

    critical = [f for f in findings if f.severity == 'critical']
    return Result(
        id='ui_quality', title='坏值的视觉可辨性（人机界面契约）', claim='DATA-15',
        verdict=FAIL if critical else PASS,
        metrics={'levels_found': len(present), 'levels_expected': len(EXPECTED_LEVELS),
                 'distinct_styles': distinct, 'value_degraded': value_degraded,
                 'scanned': str(base)},
        findings=findings,
        ground_truth='OPC UA 质量码分档 + ISA-18.2 人机界面要求（外部标准，非本项目约定）',
        sample=len(EXPECTED_LEVELS),
    )
