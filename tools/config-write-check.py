#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""设备配置落盘的三条红线（round 291）。

为什么要有这个检查
------------------
`_save_config()` 原先在三个管理器里各有一份，都长这样：

    yaml.dump({'devices': list(self.devices.values())}, f)

跑一次接口冒烟（它会 add/remove 设备）之后，`配置/devices_simulated.yaml` 就变了样：
开头那段凭据规范（`${VAR}` 占位、禁止明文入库）**整块消失**，末尾多出 861 行
`_simulation_params`（运行期注入的随机仿真参数）。没有任何报错 —— 文件"还是那个文件"。

本脚本把当时肉眼发现的三件事钉成可执行判据：

1. **注释必须保留**：保存前后，文件开头的注释块逐行相同；
2. **运行期键不许落盘**：`_` 前缀的键（`_simulation_params` 等）不得出现在文件里；
3. **失败不得破坏原文件**：写临时文件/替换过程中抛异常，原文件必须**逐字节不变**，
   且不留 `.tmp` 残留（它会以未跟踪文件的形式污染 git status）。

另加一条结构性守卫：三个管理器源码里**不许再出现 `yaml.dump(`** ——
否则下一次有人图省事就地抄一遍，上面三条又只对新代码生效。

    python tools/config-write-check.py            # 全部通过 exit 0
    python tools/config-write-check.py --verbose
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepcheck.common import REPO, say, write_json  # noqa: E402

BACKEND_SRC = REPO / 'backend' / 'src'
CONFIG_STORE = BACKEND_SRC / '采集层' / 'config_store.py'
MANAGERS = [
    BACKEND_SRC / '采集层' / 'device_manager.py',
    BACKEND_SRC / '采集层' / 'simulated_device_manager.py',
    BACKEND_SRC / '采集层' / 'real_device_manager.py',
]
TARGET_CONFIG = REPO / 'backend' / 'src' / '配置' / 'devices_simulated.yaml'

HEADER = (
    "# =============================================================================\n"
    "# 仿真设备清单（检查用夹具）\n"
    "# - 凭据字段一律使用 ${VAR} 环境变量占位，禁止明文入库\n"
    "# =============================================================================\n"
)


def _load_config_store():
    if str(BACKEND_SRC) not in sys.path:
        sys.path.insert(0, str(BACKEND_SRC))
    import importlib
    import 采集层.config_store as cs
    return importlib.reload(cs)


def check_header_preserved(cs, verbose: bool) -> tuple[bool, str]:
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / 'devices.yaml'
        f.write_text(HEADER + "devices:\n- id: d1\n  protocol: modbus_tcp\n", encoding='utf-8')
        cs.save_devices_config(f, [{'id': 'd1', 'protocol': 'modbus_tcp'}])
        text = f.read_text(encoding='utf-8')
        if verbose:
            say(f'  保存后前 3 行：{text.splitlines()[:3]}')
        missing = [ln for ln in HEADER.strip().splitlines() if ln not in text]
        if missing:
            return False, f'保存后丢失注释 {len(missing)} 行，例如：{missing[0][:60]}'
        return True, f'注释块 {len(HEADER.strip().splitlines())} 行全部保留'


def check_injection_does_not_pollute_config(_cs, verbose: bool) -> tuple[bool, str]:
    """运行期注入的仿真参数**不许**落进配置对象。

    这正是当时那 +861 行的来源：`inject_simulation_params()` 写
    `self.device_config['_simulation_params']`，而 `device_config` 与管理器的
    设备 dict 是同一个对象 → 下一次保存就落盘。

    注意别把它做成"保存时按 `_` 前缀过滤"：`_simulation_params` 本身是**合法配置**
    （仓库里有 3 台设备手写着基础参数），过滤会把它们删掉。要修的是注入侧。
    """
    if str(BACKEND_SRC) not in sys.path:
        sys.path.insert(0, str(BACKEND_SRC))
    from 采集层.device_behavior_simulator import DeviceBehaviorSimulator

    cfg = {
        'id': 'chk_01', 'name': '检查用设备', 'protocol': 'modbus_tcp',
        'device_type': 'motor',
        'registers': [{'name': 'temperature', 'address': 0, 'data_type': 'float32'}],
    }
    sim = DeviceBehaviorSimulator(device_id='chk_01', device_config=cfg)
    sim.inject_simulation_params({'base_values': {'temperature': 88}})

    if verbose:
        say(f'  注入后配置对象的键：{sorted(cfg.keys())}')
    if '_simulation_params' in cfg:
        return False, ('注入的参数写进了共享的设备配置 dict —— '
                       '下一次保存就会落盘，下次启动又被当配置读回来')
    if sim._injected_sim_params.get('base_values', {}).get('temperature') != 88:
        return False, '注入的参数没落到模拟器实例上 —— 参数实际没生效'
    return True, '注入只写实例属性，配置对象零改动'


def check_atomic_on_failure(cs, verbose: bool) -> tuple[bool, str]:
    """两条都要过：dump 抛异常 / 替换失败，原文件都必须逐字节不变。

    只测"dump 抛异常"是不够的 —— 那时候还没打开文件，任何实现都不会损坏原文。
    真正区分"原子"与"直接覆盖"的是**替换那一刻失败**：临时文件已经写好，
    还没换上去。所以这里 monkeypatch `os.replace` 让它抛错，并确认：
    ① 异常真的传出去了（不能被吞成一行日志）；② 原文件不变；③ 不留 .tmp。
    """
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / 'devices.yaml'
        original = HEADER + "devices:\n- id: d1\n  protocol: modbus_tcp\n"
        f.write_text(original, encoding='utf-8')

        # ① dump 阶段失败
        real_dump = cs.yaml.dump

        def boom_dump(*_a, **_kw):
            raise OSError('模拟序列化失败')

        cs.yaml.dump = boom_dump
        try:
            cs.save_devices_config(f, [{'id': 'd2', 'protocol': 'modbus_tcp'}])
        except OSError:
            pass
        else:
            return False, '写入失败时没有抛异常 —— 调用方会以为保存成功了'
        finally:
            cs.yaml.dump = real_dump
        if f.read_text(encoding='utf-8') != original:
            return False, '序列化失败后原文件被改动'

        # ② 替换阶段失败（这一段才真正区分原子与直接覆盖）
        real_replace = cs.os.replace

        def boom_replace(*_a, **_kw):
            raise OSError('模拟替换失败')

        cs.os.replace = boom_replace
        try:
            cs.save_devices_config(f, [{'id': 'd3', 'protocol': 'modbus_tcp'}])
        except OSError:
            pass
        else:
            cs.os.replace = real_replace
            return False, ('替换失败却没有任何异常 —— 实现没有走"临时文件 + 原子替换"，'
                           '直接覆盖时崩溃就会留下半截 YAML')
        finally:
            cs.os.replace = real_replace

        if f.read_text(encoding='utf-8') != original:
            return False, '替换失败后原文件被改动 —— 半截 YAML 会让下次启动读不出来'
        leftovers = list(Path(td).glob('*.tmp'))
        if leftovers:
            return False, f'失败后留下临时文件：{[p.name for p in leftovers]}'
        return True, '序列化/替换任一失败：原文件逐字节不变，且无 .tmp 残留'


def _dumps_yaml(path: Path) -> bool:
    """AST 判据：文件里是否真的**调用**了 `<任意别名>.dump()/.safe_dump()`。

    不用字符串搜索：注释和文档字符串里合法地会提到 `yaml.dump(`（本轮的修复说明
    就写在 docstring 里），字符串搜索会把"解释缺陷的文字"当成缺陷本身。

    也不用"只认 `yaml.dump`"：`import yaml as _y; _y.dump(...)` 能整条绕过 ——
    变异验证时实测过（MUTATION-B 别名调用，守卫没红）。所以这里只认
    "属性名叫 dump/safe_dump 的调用"，不看接收者叫什么。
    """
    import ast
    tree = ast.parse(path.read_text(encoding='utf-8'))
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            if node.func.attr in ('dump', 'safe_dump'):
                return True
    return False


def check_single_implementation(verbose: bool) -> tuple[bool, str]:
    offenders = [m.name for m in MANAGERS if _dumps_yaml(m)]
    if verbose:
        say(f'  扫描 {len(MANAGERS)} 个管理器，命中 {offenders}')
    if offenders:
        return False, (f'这些管理器仍在自己 dump YAML：{offenders} —— '
                       '应走 采集层/config_store.save_devices_config()')
    if not _dumps_yaml(CONFIG_STORE):
        return False, 'config_store 里没有 dump 实现 —— 守卫与被测对象脱节了'
    return True, '三个管理器都不再自己 dump，唯一实现在 config_store'


def check_real_config_roundtrip(cs, verbose: bool) -> tuple[bool, str]:
    """用 git HEAD 里那份**真实配置**回放：保存后必须逐字不变。

    "逐字不变"同时否掉两种隐性破坏：注释被抹掉、以及 `sort_keys=True` 那种
    每次保存都把整个文件重排一遍的 diff 噪音。
    """
    try:
        raw = subprocess.run(['git', 'show', 'HEAD:backend/src/配置/devices_simulated.yaml'],
                             cwd=str(REPO), capture_output=True, text=True,
                             encoding='utf-8', timeout=30)
    except (OSError, subprocess.SubprocessError) as e:
        return True, f'跳过（读不到 git HEAD 版本：{e}）'
    if raw.returncode != 0 or not raw.stdout.strip():
        return True, '跳过（git 中暂无该文件）'
    original = raw.stdout
    with tempfile.TemporaryDirectory() as td:
        f = Path(td) / 'devices_simulated.yaml'
        f.write_text(original, encoding='utf-8')
        import yaml as _yaml
        devices = (_yaml.safe_load(original) or {}).get('devices') or []
        cs.save_devices_config(f, devices)
        text = f.read_text(encoding='utf-8')
    if text != original:
        head_first = next((ln for ln in original.splitlines() if ln.strip()), '')
        if head_first.startswith('#') and head_first not in text:
            return False, '真实配置文件保存后丢失了开头的注释'
        import difflib
        diff = list(difflib.unified_diff(original.splitlines(), text.splitlines(),
                                         lineterm='', n=0))[:6]
        if verbose:
            say('  首个差异片段：\n   ' + '\n   '.join(diff))
        return False, f'真实配置保存后与原文不一致（{len(devices)} 台设备）—— 会持续产生 diff 噪音'
    return True, f'真实配置（{len(devices)} 台设备）保存后逐字不变'


CHECKS = [
    ('header_preserved', '注释必须保留', check_header_preserved),
    ('injection_not_persisted', '运行期注入不许污染配置', check_injection_does_not_pollute_config),
    ('atomic_on_failure', '写失败不得破坏原文件', check_atomic_on_failure),
    ('single_implementation', '唯一实现（禁止各管理器自己 dump）', lambda cs, v: check_single_implementation(v)),
    ('real_config_roundtrip', '真实配置文件保存后逐字不变', check_real_config_roundtrip),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args()

    cs = _load_config_store()
    results, failed = [], []
    for key, title, fn in CHECKS:
        ok, detail = fn(cs, args.verbose)
        results.append({'check': key, 'title': title, 'pass': ok, 'detail': detail})
        say(f"{'✅' if ok else '❌'} {title}：{detail}")
        if not ok:
            failed.append(key)

    write_json(REPO / 'reports' / 'deep' / 'config-write.json',
               {'checks': results, 'passed': len(results) - len(failed), 'total': len(results)})
    say(f'\n{len(results) - len(failed)}/{len(results)} 通过')
    return 0 if not failed else 1


if __name__ == '__main__':
    sys.exit(main())
