#!/usr/bin/env python3
"""审计链自证：用攻击者的方式测试哈希链。

一个"防篡改"机制如果只证明"没被篡改时校验通过"，那它什么都没证明。
本脚本逐条模拟**篡改手法**，看链能不能抓到，抓不到的就如实标成已知局限
（不装作能抓）。

    python tools/audit-chain-selftest.py            # 跑全部用例
    python tools/audit-chain-selftest.py --json x.json
"""

from __future__ import annotations

import argparse
import ast
import importlib.util
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepcheck.common import REPO, say, write_json  # noqa: E402


def load_chain():
    path = REPO / 'backend' / 'src' / 'core' / 'audit_chain.py'
    spec = importlib.util.spec_from_file_location('_ac', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


AC = load_chain()

#: 用例库文件放这里；每次运行用唯一文件名，不做删除（见 fresh_db 说明）
tmp_dir = REPO / 'tests' / 'fixtures' / '_chain_cases'


def fresh_db(tag: str, n: int = 5) -> sqlite3.Connection:
    """每个用例一个全新库文件。

    不复用同一个文件名：Windows 下删文件可能被安全软件/句柄占用挡掉，
    一旦删失败就会读到上一轮的残留记录，导致"调换两条"这类用例
    因为两条内容恰好相同而假通过。用唯一文件名规避整类问题。
    """
    import uuid
    path = tmp_dir / f'{tag}-{uuid.uuid4().hex[:8]}.db'
    conn = sqlite3.connect(str(path))
    AC.ensure_table(conn)
    for i in range(n):
        AC.record_config_change(
            conn, actor=f'user{i}', section='security',
            before={'threshold': 180 + i}, after={'threshold': 190 + i},
            ip='10.0.0.1')
    conn.commit()
    return conn


def case(name: str, expect_detected: bool, fn) -> dict:
    try:
        detected, reason = fn()
    except Exception as e:                       # 用例自身抛错也算失败
        return {'case': name, 'detected': False, 'expected': expect_detected,
                'ok': False, 'reason': f'用例异常: {type(e).__name__}: {e}'}
    return {'case': name, 'detected': detected, 'expected': expect_detected,
            'ok': detected == expect_detected, 'reason': reason}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--json', default=str(REPO / 'reports' / 'deep' / 'audit-chain-selftest.json'))
    args = ap.parse_args()

    tmp_dir.mkdir(parents=True, exist_ok=True)
    out = []

    # 1. 未篡改：必须通过
    def c_clean():
        conn = fresh_db('c1')
        rep = AC.verify_chain(conn)
        conn.close()
        return (rep['ok'], f"entries={rep['entries']}, head={rep['head_hash'][:12]}")
    out.append(case('未篡改：链应通过', True, c_clean))

    # 2. 改内容：必须抓到
    def c_tamper_value():
        conn = fresh_db('c2')
        # 最"轻"的篡改：只追加一个空格。内容语义几乎没变，
        # 但哈希必须变 —— 否则改一位数字也能混过去。
        conn.execute("UPDATE config_change_log SET diff_json = diff_json || ' ' WHERE seq = 2")
        conn.commit()
        rep = AC.verify_chain(conn)
        conn.close()
        return (not rep['ok'], rep['reason'] or '（未报错 —— 篡改漏检）')
    out.append(case('篡改第 2 条的值（仅追加一个空格）：应报「记录被修改」', True, c_tamper_value))

    # 3. 改操作人：必须抓到（这是"定责"的关键字段）
    def c_tamper_actor():
        conn = fresh_db('c3')
        conn.execute("UPDATE config_change_log SET actor = 'someone_else' WHERE seq = 3")
        conn.commit()
        rep = AC.verify_chain(conn)
        conn.close()
        return (not rep['ok'], rep['reason'])
    out.append(case('篡改第 3 条的操作人：应被抓到', True, c_tamper_actor))

    # 4. 删中间一条：必须抓到（断号 + 前哈希对不上）
    def c_delete_middle():
        conn = fresh_db('c4')
        conn.execute('DELETE FROM config_change_log WHERE seq = 3')
        conn.commit()
        rep = AC.verify_chain(conn)
        conn.close()
        return (not rep['ok'], rep['reason'])
    out.append(case('删除中间一条：应报断号/前哈希不连续', True, c_delete_middle))

    # 5. 调换顺序：必须抓到
    def c_reorder():
        conn = fresh_db('c5')
        rows = conn.execute('SELECT seq, ts_utc, actor, section, diff_json FROM '
                            'config_change_log ORDER BY seq').fetchall()
        a, b = rows[1], rows[2]
        conn.execute('UPDATE config_change_log SET actor=?, diff_json=? WHERE seq=?',
                     (b[2], b[4], a[0]))
        conn.execute('UPDATE config_change_log SET actor=?, diff_json=? WHERE seq=?',
                     (a[2], a[4], b[0]))
        conn.commit()
        rep = AC.verify_chain(conn)
        conn.close()
        return (not rep['ok'], rep['reason'])
    out.append(case('调换两条的内容：应被抓到', True, c_reorder))

    # 6. 截断尾部：**抓不到** —— 如实标注（需要外部锚点）
    def c_truncate_tail():
        conn = fresh_db('c6')
        before = AC.verify_chain(conn)
        conn.execute('DELETE FROM config_change_log WHERE seq >= 4')
        conn.commit()
        rep = AC.verify_chain(conn)
        conn.close()
        caught_by_chain = not rep['ok']
        return (caught_by_chain,
                f"链内自洽={rep['ok']}（所以链自己抓不到）；"
                f"head 从 {before['head_hash'][:12]} 变为 {rep['head_hash'][:12]}，"
                f"头部哈希变化只能被 git/MANIFEST 这类外部锚点发现")
    out.append(case('截断最后两条：链内**抓不到**（已知局限，靠外部锚点）',
                    False, c_truncate_tail))

    # 7. 序列化稳定性：键序不同必须同哈希
    def c_canonical():
        a = AC.canonical_json({'b': 1, 'a': [1, 2], 'c': {'y': 2, 'x': 1}})
        b = AC.canonical_json({'c': {'x': 1, 'y': 2}, 'a': [1, 2], 'b': 1})
        return (a == b, f'两种键序输出一致={a == b}')
    out.append(case('canonical_json 键序无关（否则链会无故断裂）', True, c_canonical))

    # 8. 无变化不写空记录
    def c_no_change():
        conn = fresh_db('c8', n=0)
        rec = AC.record_config_change(conn, 'u', 'security', {'a': 1}, {'a': 1})
        n = conn.execute('SELECT COUNT(*) FROM config_change_log').fetchone()[0]
        conn.close()
        return (rec is None and n == 0, f'写入={n} 条（应为 0）')
    out.append(case('同一内容重复保存不产生审计噪音', True, c_no_change))

    # 9. 静态契约：接口里确实调用了审计记录（防止有人把调用删掉）
    def c_contract():
        src = (REPO / 'backend/src/展示层/api/api_system.py').read_text(encoding='utf-8')
        tree = ast.parse(src)
        hits = []
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == 'update_config':
                for sub in ast.walk(node):
                    if (isinstance(sub, ast.Call) and isinstance(sub.func, ast.Name)
                            and sub.func.id == 'record_config_change'):
                        kw = {k.arg for k in sub.keywords}
                        hits.append(kw)
        ok = any({'before', 'after'} <= kw for kw in hits)
        return (ok, f'update_config 中 record_config_change 调用参数: {hits}')
    out.append(case('PUT /api/config 确实带 before/after 调用了审计记录', True, c_contract))

    passed = sum(1 for r in out if r['ok'])
    report = {
        'generated_at': datetime.now().isoformat(timespec='seconds'),
        'cases': len(out),
        'passed': passed,
        'all_ok': passed == len(out),
        'known_limitation': '尾部截断在链内自洽 —— 必须靠外部锚点（git / MANIFEST）发现',
        'rows': out,
    }
    write_json(Path(args.json), report)

    for r in out:
        mark = 'OK  ' if r['ok'] else '!!  '
        say(f"{mark}{r['case']}")
        say(f"     {r['reason']}")
    say(f'\n{passed}/{len(out)} 通过 → {args.json}')
    if not report['all_ok']:
        sys.exit(1)


if __name__ == '__main__':
    main()
