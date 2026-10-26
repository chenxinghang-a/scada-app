#!/usr/bin/env python3
"""写入→回读验证：模拟客户端到底能不能“写进去再读出来”。

CTRL-02 一直卡在 partial：验证逻辑本身是对的，但**模拟模式下写入值会被
行为模拟器覆盖**，于是"回读"读到的是模型值而不是写入值，整条
"写入后回读确认"的安全链路在模拟环境里根本测不了。

修法是让 span 读取认写入值（真实 PLC 的行为：写进去就是它，直到程序改掉）。
本脚本是那条修复的可复核证据：

    python tools/write-readback-check.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deepcheck.common import REPO, say, write_json  # noqa: E402

SRC = REPO / 'backend' / 'src'


def main() -> int:
    sys.path.insert(0, str(SRC))
    cwd = os.getcwd()
    os.chdir(SRC)
    try:
        import paths
        paths.setup()
        from 采集层.enhanced_simulated_client import EnhancedSimulatedModbusClient

        cfg = {
            'id': 'wr_check', 'name': '写入回读校验', 'protocol': 'modbus_tcp',
            'byte_order': 'ABCD',
            'registers': [
                {'address': 0, 'name': 'relay_1', 'data_type': 'uint16', 'scale': 1.0, 'unit': ''},
                {'address': 1, 'name': 'relay_2', 'data_type': 'uint16', 'scale': 1.0, 'unit': ''},
                {'address': 2, 'name': 'relay_3', 'data_type': 'uint16', 'scale': 1.0, 'unit': ''},
            ],
        }
        client = EnhancedSimulatedModbusClient(cfg)
        client.connect()
        client.connected = True
        try:
            before = client.read_holding_registers(0, 3)
            wrote = client.write_single_register(0, 1234)
            after = client.read_holding_registers(0, 3)
            wrote2 = client.write_single_register(2, 77)
            after2 = client.read_holding_registers(0, 3)
        finally:
            client.disconnect()

        ok = bool(wrote and wrote2 and after and after2
                  and after[0] == 1234 and after2[2] == 77)
        rep = {'ok': ok, 'before': before, 'after_write_addr0': after,
               'after_write_addr2': after2, 'write_returned_true': bool(wrote and wrote2),
               'claim': '写入后回读必须读到写入值，而不是模型值'}
        write_json(REPO / 'reports' / 'deep' / 'write-readback.json', rep)
        say(f"写前            {before}")
        say(f"写 addr0=1234 后 {after}")
        say(f"写 addr2=77 后   {after2}")
        say('结论：' + ('通过 —— 回读到的就是写入值' if ok else '未通过 —— 回读被模型值覆盖'))
        return 0 if ok else 2
    finally:
        os.chdir(cwd)


if __name__ == '__main__':
    sys.exit(main())
