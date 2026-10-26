#!/usr/bin/env python3
"""CI 判定：**证据链本身**是否成立。

只判一件事：检测器还打不打得翻自己。
系统体检的结论（field_verdict）只打印，不阻断——"系统有缺陷"是业务事实，
应该在报告里被看见；而"检查失灵"才是工程事故，必须红。

    python tools/check-mechanism.py            # 失败时退出码 1
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

VERDICT = Path(__file__).resolve().parent.parent / 'reports' / 'deep' / 'verdict.json'


def main() -> int:
    if not VERDICT.exists():
        print('::error::找不到 reports/deep/verdict.json —— 没跑 deep-verify？')
        return 1
    d = json.loads(VERDICT.read_text(encoding='utf-8'))
    mech = bool(d.get('mechanism_certified'))
    field = d.get('field_verdict')
    print(f"mechanism_certified = {mech}")
    print(f"field_verdict       = {field}  {d.get('field_failed_checks') or ''}")
    print(f"负向控制            = {d.get('negative_control_discriminating')}"
          f"/{d.get('negative_control_total')}")
    print(f"审计链自证          = {d.get('audit_chain_selftest')}")

    if not mech:
        print('::error::证据链不成立：有检测器打不翻自己，或审计链自证未通过')
        return 1
    if field != 'PASS':
        # 用 warning 而不是 error：业务缺陷不该让 CI 替它下结论
        print(f"::warning::系统体检未通过：{d.get('field_failed_checks')}（不阻断 CI，见报告）")
    print('证据链成立。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
