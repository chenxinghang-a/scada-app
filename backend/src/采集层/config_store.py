# -*- coding: utf-8 -*-
"""设备配置文件的统一落盘：原子替换 + 保留注释。

为什么需要这个模块（round 291）
==============================

三个管理器（`device_manager` / `simulated_device_manager` /
`real_device_manager`）各自抄了一遍 `_save_config()`，核心都是：

    yaml.dump({'devices': list(self.devices.values())}, f)

三份实现还互不一致（一份原子、两份不原子），而且**每一份都丢注释**：

`配置/devices_simulated.yaml` 开头的凭据规范（`${VAR}` 占位、禁止明文入库、
192.168.x 是 RFC1918 示例地址）在跑过一次设备增删之后整块消失。文件看起来
"还是那个文件"，git diff 里却少了一段运维必须遵守的约定 —— 而 `yaml.dump`
不保留注释这件事本身不带任何报错。

另外两份实现直接 `open('w')` 覆盖：写到一半崩溃或磁盘满，被跟踪的配置文件
就变成半截 YAML，下次启动直接读不出来，而且损坏的是**版本库里的那份**。

本模块把"怎么落盘"收口成一处：保留原文件开头的注释块 + 临时文件原子替换。
`tools/config-write-check.py` 会扫源码，禁止任何管理器再自己 `yaml.dump`。

⚠️ 关于 `_simulation_params`（本轮差点改错的地方）
------------------------------------------------
`_` 前缀的键里，`_simulation_params` 是**合法配置**：3 台设备在仓库里就手写着
基础参数（锅炉/涂装线/水处理）。所以这里**不能**按前缀一律剔除 —— 那会把
运维写好的参数删掉。

真正的缺陷在注入侧：`DeviceBehaviorSimulator.inject_simulation_params()` 原先
`self.device_config['_simulation_params'] = sim_params`，而 `device_config`
与管理器的设备 dict 是**同一个对象**（别名）。于是运行期算出来的仿真参数被写进
配置对象，下一次保存就落盘（实测 +861 行），下次启动又被当配置读回来。
修法在 `采集层/device_behavior_simulator.py`：注入的参数存在模拟器自己的实例上，
不碰共享的配置 dict。本模块因此不需要做任何"键过滤"。
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Iterable, Mapping

import yaml

logger = logging.getLogger(__name__)


def _read_prefix(config_file: Path) -> tuple[bytes, str]:
    """返回 (原文件开头"注释/空行"部分的**原始字节**, 该文件的换行风格)。

    整段前缀按字节原样带过去，而不是"读出注释行再拼回去"：
    这样连换行符（本仓库的配置文件是 CRLF）和"注释块后有没有空行"这种细节
    都不会被悄悄改掉 —— 否则一次保存就让 git 把整个文件标成改动。
    """
    try:
        data = config_file.read_bytes()
    except OSError as e:        # 读不到就退化为"没有前缀"，但不能静默
        logger.warning("读取配置文件前缀失败(将不保留注释): %s: %s", config_file, e)
        return b'', '\n'
    newline = '\r\n' if b'\r\n' in data else '\n'
    pos = 0
    for line in data.splitlines(keepends=True):
        stripped = line.strip()
        if stripped == b'' or stripped.startswith(b'#'):
            pos += len(line)
            continue
        break
    return data[:pos], newline


def render_devices_config(config_file: Path,
                          devices: Iterable[Mapping[str, Any]]) -> tuple[bytes, int]:
    """生成要写入的**完整字节**（原始注释前缀 + YAML 正体）与设备条数。

    抽成纯函数便于不落盘也能量测（`tools/config-write-check.py` 用它做逐字节回放）。
    """
    snapshot = [dict(d) for d in devices]
    # `sort_keys=False`：保持设备与字段的**原有顺序**（内存里的 dict 顺序来自
    # 加载时的 YAML 顺序）。排序看似更"整齐"，实际后果是每次保存都把整个文件
    # 重排一遍 —— 只改了某台设备，git diff 却是几百行。
    body = yaml.dump({'devices': snapshot}, allow_unicode=True,
                     default_flow_style=False, sort_keys=False)
    prefix, newline = _read_prefix(config_file)
    if newline != '\n':
        body = body.replace('\n', newline)
    return prefix + body.encode('utf-8'), len(snapshot)


def save_devices_config(config_file: Path | str,
                        devices: Iterable[Mapping[str, Any]]) -> int:
    """原子地写回设备配置，返回写出的设备数。

    Args:
        config_file: 目标文件（调用方已用 `paths.resolve()` 解析过）。
        devices: 设备配置字典的可迭代对象（建议调用方在锁内取快照）。

    Returns:
        实际写入的设备条数。

    Raises:
        OSError: 写临时文件或替换失败（**原文件保持原样**）。
    """
    config_file = Path(config_file)
    config_file.parent.mkdir(parents=True, exist_ok=True)
    payload, count = render_devices_config(config_file, devices)

    tmp_file = config_file.with_name(config_file.name + '.tmp')
    try:
        with open(tmp_file, 'wb') as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())        # 先落盘再改名：断电也不会只剩空文件
        os.replace(tmp_file, config_file)
    except OSError:
        # 失败时不要留半截临时文件（它会以未跟踪文件的形式污染 git status）
        try:
            if tmp_file.exists():
                tmp_file.unlink()
        except OSError as cleanup_err:      # noqa: BLE001 —— 清理失败不能盖住原始错误
            logger.debug("清理配置临时文件失败: %s: %s", tmp_file, cleanup_err)
        raise
    logger.info("设备配置已保存: %s（%d 台设备）", config_file, count)
    return count
