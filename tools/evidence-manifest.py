#!/usr/bin/env python3
"""证据清单：把"这次交付到底包含什么"变成一个可校验的哈希清单。

要解决的问题：报告里写"我测过了"，评审怎么知道**我测的那份代码**
就是**他手上这份代码**？中间被改过一个常量、一个阈值、一个分支，
所有结论就都失效了，而且看不出来。

做法：对源码与配置文件逐个算 SHA-256，连同 git HEAD 一起写进
``reports/evidence/MANIFEST.json``。第三方拿到仓库后：

    python tools/evidence-manifest.py --verify

任何文件对不上就报 MISMATCH（并指出是哪一个）。

**边界**：这防的是"事后修改"，防不了"从头到尾都在骗"。后者只有
独立复现（换人、换机器、重跑）才能发现，所以复现命令也写进清单。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepcheck.common import REPO, say, write_json  # noqa: E402

#: 参与哈希的范围：**能改变结论的东西**。文档本身也算 ——
#: 报告里的数字若与代码不符，同样是缺陷。
INCLUDE = [
    'backend/src/core/timebase.py',
    'backend/src/core/audit_chain.py',
    'backend/src/存储层/database.py',
    'backend/src/展示层/api/api_system.py',
    'backend/src/采集层/base_client.py',
    'backend/src/采集层/enhanced_simulated_client.py',
    'backend/src/采集层/sim_semantics.py',
    'backend/src/用户层/auth.py',
    'backend/src/配置/devices_modbus_sim.yaml',
    'tools/deep-verify.py',
    'tools/make-evidence-fixture.py',
    'tools/migrate-timebase.py',
    'tools/audit-chain-selftest.py',
    'tools/audit-anchor.py',
    'tools/write-readback-check.py',
    'tools/check-mechanism.py',
    '.github/workflows/deep-verify.yml',
    'tools/make-deep-report.py',
    'tools/deepcheck/anchor.py',
    'tools/deepcheck/clock_lint.py',
    'tools/deepcheck/common.py',
    'tools/deepcheck/coverage.py',
    'tools/deepcheck/detectors.py',
    'tools/deepcheck/fixtures.py',
    'tools/deepcheck/negative_control.py',
    'tools/deepcheck/physical.py',
    'tools/deepcheck/pointtable.py',
    'tools/deepcheck/schema_clock.py',
    'tools/deepcheck/subject.py',
    'tools/deepcheck/ui_contract.py',
    'tools/deepcheck/timebase.py',
    'docs/traceability.yaml',
    'docs/深度-专家会做什么.md',
]

REPRO = [
    'python tools/make-evidence-fixture.py',
    'python tools/deep-verify.py all',
    'python tools/audit-chain-selftest.py',
    'python tools/fresh-install-check.py',
    'python tools/migrate-timebase.py            # 只出计划',
    'python tools/evidence-manifest.py --verify',
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def git(*args) -> str:
    try:
        out = subprocess.run(['git', *args], cwd=str(REPO), capture_output=True,
                             text=True, encoding='utf-8', errors='replace')
        return (out.stdout or '').strip()
    except OSError:
        return ''


def build() -> dict:
    files = {}
    for rel in INCLUDE:
        p = REPO / rel
        files[rel] = {'sha256': sha256(p), 'size': p.stat().st_size} if p.exists() \
            else {'sha256': None, 'size': None, 'missing': True}
    return {
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'git_head': git('rev-parse', 'HEAD'),
        'git_dirty': bool(git('status', '--porcelain')),
        'python': sys.version.split()[0],
        'platform': sys.platform,
        'files': files,
        'file_count': len(files),
        'missing': [k for k, v in files.items() if v.get('missing')],
        'reproduce': REPRO,
        'scope_note': '清单锚定「代码+配置+文档」；运行库与产物不入清单（每次运行都会变）',
    }


def verify(manifest_path: Path) -> int:
    man = json.loads(manifest_path.read_text(encoding='utf-8'))
    diffs = []
    for rel, rec in man['files'].items():
        p = REPO / rel
        now = sha256(p) if p.exists() else None
        if now != rec['sha256']:
            diffs.append({'file': rel, 'expected': rec['sha256'], 'actual': now})
    head_now = git('rev-parse', 'HEAD')
    say(f"清单时间   {man['generated_at']}")
    say(f"清单 HEAD  {man['git_head'][:12]}")
    say(f"当前 HEAD  {head_now[:12]}")
    say(f"文件数     {man['file_count']}")
    if diffs:
        say(f'\nMISMATCH：{len(diffs)} 个文件与清单不一致')
        for d in diffs:
            say(f"  - {d['file']}  期望 {str(d['expected'])[:12]} 实际 {str(d['actual'])[:12]}")
        verdict = 'MISMATCH'
    else:
        say('\n所有文件哈希一致 —— 这份代码就是清单描述的那份')
        verdict = 'OK'

    if head_now and man['git_head'] and head_now != man['git_head']:
        say(f'注意：HEAD 与清单不同（{man["git_head"][:12]} → {head_now[:12]}），'
            f'可能是清单生成后又提交过；以文件哈希为准')
    return 0 if verdict == 'OK' else 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--verify', action='store_true', help='校验模式：重算哈希并比对')
    ap.add_argument('--out', default=str(REPO / 'reports' / 'evidence' / 'MANIFEST.json'))
    args = ap.parse_args()

    if args.verify:
        p = Path(args.out)
        if not p.exists():
            say(f'找不到清单：{p}')
            sys.exit(2)
        sys.exit(verify(p))

    man = build()
    write_json(Path(args.out), man)
    say(f"清单已生成：{args.out}")
    say(f"  文件 {man['file_count']} 个，HEAD {man['git_head'][:12] or '(未提交)'}，"
        f"工作区{'有' if man['git_dirty'] else '无'}未提交改动")
    if man['missing']:
        say(f"  ! 缺失文件：{man['missing']}")


if __name__ == '__main__':
    main()
