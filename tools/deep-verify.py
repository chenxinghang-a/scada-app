#!/usr/bin/env python3
"""深度校验统一入口 —— 这个文件本身就是"可复现"的定义。

    python tools/deep-verify.py all              # 全部跑一遍，输出报告
    python tools/deep-verify.py negative-control # 只跑负向控制矩阵
    python tools/deep-verify.py timebase         # 时间基准
    python tools/deep-verify.py pointtable       # 点表 + 导出 IO List
    python tools/deep-verify.py auditchain       # 配置变更审计链

判定口径（写死在这儿，不给解释留空间）：

* 每条检测器的结论取自**只读连接**，不启动后端、不依赖 Windows 服务；
* 负向控制不通过（检测器打不翻自己）→ 整体判 UNCERTIFIED，
  即使其他条目全绿也不算数 —— 因为它证明不了自己会红；
* 输出里的每个数字都能被第三方用同一份仓库重算。
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepcheck import detectors, negative_control, pointtable  # noqa: E402
from deepcheck.common import (FAIL, INSUFFICIENT, OUT_DIR, PASS, REPO,  # noqa: E402
                              find_db, read_json, say, summarize, write_json)


def _matrix_db(args) -> Path:
    """负向控制用哪个库：默认用夹具，不用运行库。

    原因不是"运行库太大"，而是**负向控制的结论必须与现场数据无关**：
    矩阵要回答的是"检测器有没有分辨力"，这个问题的答案不该随现场数据变化。
    用夹具 → 任何人在任何机器上重跑都得到同一张表。
    """
    if getattr(args, 'matrix_db', None):
        return Path(args.matrix_db)
    fx = REPO / 'tests' / 'fixtures' / 'evidence.db'
    if not fx.exists():
        say('夹具不存在，生成中…')
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            '_mkfix', REPO / 'tools' / 'make-evidence-fixture.py')
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.build(fx, None)
    return fx


def cmd_negative_control(args) -> dict:
    db = _matrix_db(args)
    say(f'负向控制矩阵基于：{db}')
    rep = negative_control.run(db, Path(args.config), OUT_DIR / 'negative-control.json',
                               keep_dir=args.keep)
    return {'negative_control': rep}


def cmd_timebase(args) -> dict:
    db = find_db(args.db)
    res = detectors.det_data_time(db)
    say(f"[时间基准] {res.verdict.upper()}  {json.dumps(res.metrics, ensure_ascii=False)}")
    for f in res.findings:
        say(f'  - {f.code}: {f.message}')
    write_json(OUT_DIR / 'timebase.json', res.to_dict())
    return {'timebase': res.to_dict()}


def cmd_pointtable(args) -> dict:
    res = detectors.det_data_io(Path(args.config), OUT_DIR / 'io-list.csv')
    say(f"[点表] {res.verdict.upper()}  {json.dumps(res.metrics, ensure_ascii=False)}")
    for f in res.findings:
        say(f'  - {f.code}: {f.message}')
    write_json(OUT_DIR / 'pointtable.json', res.to_dict())
    return {'pointtable': res.to_dict()}


def cmd_auditchain(args) -> dict:
    db = find_db(args.db)
    res = detectors.det_sec_chain(db)
    say(f"[审计链] {res.verdict.upper()}  {json.dumps(res.metrics, ensure_ascii=False)}")
    for f in res.findings:
        say(f'  - {f.code}: {f.message}')
    write_json(OUT_DIR / 'auditchain.json', res.to_dict())
    return {'auditchain': res.to_dict()}


def cmd_selftest(args) -> dict:
    """审计链自证：9 个篡改手法的对抗测试（独立进程跑，避免污染本进程）。"""
    import subprocess
    script = REPO / 'tools' / 'audit-chain-selftest.py'
    out_json = OUT_DIR / 'audit-chain-selftest.json'
    proc = subprocess.run([sys.executable, str(script), '--json', str(out_json)],
                          capture_output=True, text=True, encoding='utf-8', errors='replace')
    rep = read_json(out_json) if out_json.exists() else {'all_ok': False, 'passed': 0, 'cases': 0}
    say(f"[审计链自证] {'PASS' if rep.get('all_ok') else 'FAIL'}  "
        f"{rep.get('passed')}/{rep.get('cases')} 个篡改用例")
    if proc.returncode not in (0, 1):
        say(f'  ! 脚本返回 {proc.returncode}: {(proc.stderr or "")[-300:]}')
    return {'audit_chain_selftest': rep}


def cmd_all(args) -> dict:
    say('=' * 72)
    say('SmartSCADA 深度校验')
    say('=' * 72)

    out = {}
    out.update(cmd_timebase(args))
    say()
    out.update(cmd_pointtable(args))
    say()
    out.update(cmd_auditchain(args))
    say()
    out.update(cmd_selftest(args))
    say()

    db = find_db(args.db)
    for name, (fn, kind) in detectors.REGISTRY.items():
        if kind != 'db' or name in ('data_time', 'sec_chain'):
            continue
        res = fn(db)
        say(f'[{name}] {res.verdict.upper()}  {json.dumps(res.metrics, ensure_ascii=False)[:160]}')
        out[name] = res.to_dict()

    sy = out['timebase']
    io = out['pointtable']
    ch = out['auditchain']
    st = out['audit_chain_selftest']
    n_ok = sum(1 for r in (sy, io) if r['verdict'] == PASS)

    say()
    if not args.skip_negctl:
        out.update(cmd_negative_control(args))
        nc = out['negative_control']
    else:
        nc = read_json(OUT_DIR / 'negative-control.json') if (OUT_DIR / 'negative-control.json').exists() else None

    verdict = {
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'checks': {k: v.get('verdict') for k, v in out.items()
                   if isinstance(v, dict) and 'verdict' in v},
        'field_checks_pass': n_ok,
        'audit_chain_selftest': f"{st.get('passed')}/{st.get('cases')}",
        'audit_chain_field_entries': ch.get('metrics', {}).get('entries'),
        'negative_control_discriminating': (nc or {}).get('discriminating'),
        'negative_control_total': (nc or {}).get('cases'),
    }
    # 认证口径（写死，不留解释空间）：
    #   ① 现场检查（时间基准 + 点表）必须 PASS
    #   ② 负向控制必须 8/8（否则检测器的"通过"没有意义）
    #   ③ 审计链自证必须 9/9；现场链为空（还没人改过配置）标 INSUFFICIENT 但不阻断，
    #      因为"没有变更"不是缺陷 —— 机制的有效性由 ③ 的对抗测试承担
    certified = bool(nc and nc.get('all_ok')
                     and st.get('all_ok')
                     and all(v['verdict'] == PASS for v in (sy, io)))
    verdict['certification'] = 'CERTIFIED' if certified else 'UNCERTIFIED'
    # 认证的是**证据链**，不是"现场零缺陷"。两者混在一起说的后果是：
    # 为了让报告好看，把真实存在的小缺陷藏起来 —— 那正好毁掉认证的意义。
    verdict['open_findings'] = [
        {'check': k, 'verdict': v.get('verdict'),
         'codes': [f['code'] if isinstance(f, dict) else f.code for f in v.get('findings', [])]}
        for k, v in out.items()
        if isinstance(v, dict) and v.get('verdict') in (FAIL, INSUFFICIENT)
        and k in ('alm_stale', 'alm_priority', 'alm_chattering', 'data_quality',
                  'auditchain', 'sec_chain')
    ]
    verdict['reason'] = ('现场检查全部通过，负向控制证明每个检测器都能失败，'
                        '审计链通过全部篡改对抗用例'
                        if certified else
                        '存在打不翻自己的检测器、或现场检查未通过 —— 见明细')
    write_json(OUT_DIR / 'verdict.json', verdict)

    say('=' * 72)
    say(f"结论：{verdict['certification']}")
    say(f"负向控制：{(nc or {}).get('discriminating')}/{(nc or {}).get('cases')} 个检测器有分辨力")
    say('=' * 72)
    out['verdict'] = verdict
    return out


def main():
    ap = argparse.ArgumentParser(description='SmartSCADA 深度校验')
    ap.add_argument('command', choices=['all', 'negative-control', 'timebase',
                                        'pointtable', 'auditchain'])
    ap.add_argument('--db', default=None)
    ap.add_argument('--matrix-db', default=None,
                    help='负向控制矩阵用的库（默认 tests/fixtures/evidence.db）')
    ap.add_argument('--config', default=str(REPO / 'backend' / 'src' / '配置' /
                                            'devices_modbus_sim.yaml'))
    ap.add_argument('--keep', action='store_true', help='保留负向控制的工作目录')
    ap.add_argument('--skip-negctl', action='store_true',
                    help='all 时跳过负向控制（复用上次结果）')
    ap.add_argument('--json', default=None)
    args = ap.parse_args()

    fn = {'all': cmd_all, 'negative-control': cmd_negative_control,
          'timebase': cmd_timebase, 'pointtable': cmd_pointtable,
          'auditchain': cmd_auditchain}[args.command]
    out = fn(args)
    if args.json:
        write_json(Path(args.json), out)


if __name__ == '__main__':
    main()
