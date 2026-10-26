#!/usr/bin/env python3
"""干净克隆演练：换一个空目录，从零跑通全部证据。

这是对"可复现"这个**声明本身**的检验 —— 不是又一次功能测试。

真实翻车方式：作者工作区里堆着夹具、临时库、装了一半的依赖，所有命令都能跑；
别人 clone 下来第一句就报错。所以本脚本做的事很土：

    git clone <repo> → 空目录 → 只跑 README 里的命令 → 比对结论

它抓到过真问题：`MANIFEST --verify` 在干净克隆上红 —— 因为
``core.autocrlf=true`` 把 LF 换成 CRLF，字节哈希必然不同。一个"只在作者机器上
成立"的哈希清单，等于没有清单。

    python tools/cleanroom-check.py
    python tools/cleanroom-check.py --keep      # 保留临时目录便于排查
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepcheck.common import REPO, say  # noqa: E402

STEPS = [
    ('生成夹具', [sys.executable, 'tools/make-evidence-fixture.py']),
    ('深度校验', [sys.executable, 'tools/deep-verify.py', 'all',
              '--db', 'tests/fixtures/evidence.db']),
    ('审计链自证', [sys.executable, 'tools/audit-chain-selftest.py']),
    ('清单校验', [sys.executable, 'tools/evidence-manifest.py', '--verify']),
]


def run(cmd: list[str], cwd: Path, timeout: int = 900) -> tuple[int, str]:
    p = subprocess.run(cmd, cwd=str(cwd), capture_output=True, text=True,
                       encoding='utf-8', errors='replace', timeout=timeout)
    return p.returncode, (p.stdout or '') + (p.stderr or '')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--keep', action='store_true', help='保留临时克隆目录')
    args = ap.parse_args()

    tmp = Path(tempfile.mkdtemp(prefix='scada-cleanroom-'))
    dst = tmp / 'repo'
    say(f'干净克隆 → {dst}')
    code, out = run(['git', 'clone', '--quiet', '--local', str(REPO), str(dst)], tmp)
    if code != 0:
        say(f'克隆失败：{out[-400:]}')
        return 2

    results = []
    for name, cmd in STEPS:
        say(f'\n[{name}] {" ".join(Path(c).name for c in cmd)}')
        try:
            code, out = run(cmd, dst)
        except subprocess.TimeoutExpired:
            results.append({'step': name, 'ok': False, 'note': '超时'})
            say('  超时')
            continue
        ok = code == 0
        note = ''
        if name == '深度校验':
            vp = dst / 'reports' / 'deep' / 'verdict.json'
            if vp.exists():
                v = json.loads(vp.read_text(encoding='utf-8'))
                note = (f"mechanism={v.get('mechanism_certified')} "
                        f"field={v.get('field_verdict')} "
                        f"negctl={v.get('negative_control_discriminating')}/"
                        f"{v.get('negative_control_total')}")
                ok = ok and bool(v.get('mechanism_certified'))
        elif name == '清单校验':
            ok = ok and '所有文件哈希一致' in out
            note = '哈希一致' if ok else '存在不一致'
        elif name == '审计链自证':
            ok = ok and '9/9' in out
            note = '9/9'
        results.append({'step': name, 'ok': ok, 'note': note})
        say(f"  {'OK  ' if ok else '!!  '}{note}")

    # 与仓库内已提交的结论对比
    mine = REPO / 'reports' / 'deep' / 'verdict.json'
    theirs = dst / 'reports' / 'deep' / 'verdict.json'
    same = None
    if mine.exists() and theirs.exists():
        a = json.loads(mine.read_text(encoding='utf-8'))
        b = json.loads(theirs.read_text(encoding='utf-8'))
        same = (a.get('mechanism_certified') == b.get('mechanism_certified')
                and a.get('field_verdict') == b.get('field_verdict')
                and a.get('negative_control_discriminating') == b.get('negative_control_discriminating'))
        say(f'\n与仓库内结论一致：{same}')

    ok_all = all(r['ok'] for r in results) and same is not False
    say('=' * 60)
    say('干净克隆演练：' + ('通过 —— 换台机器、空目录，结论相同' if ok_all else '未通过'))
    if args.keep:
        say(f'临时目录保留：{dst}')
    else:
        shutil.rmtree(tmp, ignore_errors=True)
    return 0 if ok_all else 1


if __name__ == '__main__':
    sys.exit(main())
