"""点表一致性：差分测试 + IO List 导出。

这是整个项目里**最容易静默错**的一环。字节序配错不会报错、不会崩溃、
不会报警 —— 它只会让 25.3°C 变成 1.6e-41 或者 -3.4e38，然后曲线看上去
"有点怪"。操作员据此判断锅炉超温，是真实事故的起点。

所以这里不做"读一遍配置看着对"，而是做**差分测试**：

    同一组寄存器，用两套互相独立的实现解码，结果必须一致。
    一套是项目里的 ``ByteOrderCapableDecoder``（被测对象），
    另一套是本文件里按 Modbus 规范重写的 ``decode_words``（参考实现）。
    两套如果都错成一样，概率极低 —— 因为它们不是同一个人按同一个思路写的。

再加一层**真值检验**：哨兵值经过"设备按手册编码 → 系统按配置解码"后必须
原样回来。哨兵值挑的是字节不对称的（1.0 / 0.1 / 25.3 / -273.15 / 1234.5678），
因为 0x00000000 和 0xFFFFFFFF 这类值在任何字节序下都一样，测不出错位 ——
用它们做测试等于没测。
"""

from __future__ import annotations

import csv
import importlib.util
import math
import struct
from pathlib import Path

from .common import FAIL, INSUFFICIENT, PASS, REPO, Finding, Result

ORDERS = ('ABCD', 'BADC', 'CDAB', 'DCBA')

#: 哨兵值：每个都满足"四字节不全相同 + 字不对称"，任何一种错位都会变成别的数。
SENTINELS = (
    ('1.0', 1.0),
    ('0.1', 0.1),
    ('25.3', 25.3),
    ('-273.15', -273.15),
    ('1234.5678', 1234.5678),
    ('-0.0625', -0.0625),
)

TYPE_WORDS = {
    'float32': 2, 'int32': 2, 'uint32': 2, 'float64': 4,
    'int16': 1, 'uint16': 1,
}


def _bytes_of(value: float) -> list[int]:
    return list(struct.pack('>f', value))


def encode_words(value: float, order: str) -> tuple[int, int]:
    """把工程值按 ``order`` 编成"设备会发出来的两个寄存器"。

    与 ``decode_words`` 互为逆运算；用来模拟现场设备，不依赖被测代码。
    """
    b = _bytes_of(value)
    if order == 'ABCD':
        return (b[0] << 8) | b[1], (b[2] << 8) | b[3]
    if order == 'BADC':
        return (b[1] << 8) | b[0], (b[3] << 8) | b[2]
    if order == 'CDAB':
        return (b[2] << 8) | b[3], (b[0] << 8) | b[1]
    if order == 'DCBA':
        return (b[3] << 8) | b[2], (b[1] << 8) | b[0]
    raise ValueError(order)


def decode_words(regs, order: str) -> float:
    """参考实现：按 Modbus 规范从寄存器还原 float32。

    刻意**不复用**被测代码的任何函数 —— 复用就失去差分意义了。
    """
    w1, w2 = regs[0] & 0xFFFF, regs[1] & 0xFFFF
    if order == 'ABCD':
        b = [w1 >> 8, w1 & 0xFF, w2 >> 8, w2 & 0xFF]
    elif order == 'BADC':
        b = [w1 & 0xFF, w1 >> 8, w2 & 0xFF, w2 >> 8]
    elif order == 'CDAB':
        b = [w2 >> 8, w2 & 0xFF, w1 >> 8, w1 & 0xFF]
    elif order == 'DCBA':
        b = [w2 & 0xFF, w2 >> 8, w1 & 0xFF, w1 >> 8]
    else:
        raise ValueError(order)
    return struct.unpack('>f', bytes(b))[0]


def load_app_decoder():
    """直接加载被测模块（不启动 Flask，不连数据库）。

    采集层 ``base_client`` 只依赖标准库，所以可以单独 import。
    这样测的是**真正在跑的那份代码**，不是为测试另写一份。
    """
    path = REPO / 'backend' / 'src' / '采集层' / 'base_client.py'
    spec = importlib.util.spec_from_file_location('_scada_base_client', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    class _Probe(mod.ByteOrderCapableDecoder):
        def __init__(self, byte_order: str):
            self.config = {'byte_order': byte_order}

    return _Probe


def load_config(config_path: Path) -> dict:
    import yaml
    with open(config_path, encoding='utf-8') as f:
        return yaml.safe_load(f) or {}


def iter_points(cfg: dict):
    """遍历所有带寄存器表的设备，产出规范化后的点。"""
    manual_order = str(cfg.get('byte_order', 'ABCD')).upper()
    for dev in cfg.get('devices') or []:
        if str(dev.get('protocol', '')).startswith('modbus') is False and 'registers' not in dev:
            continue
        order = str(dev.get('byte_order', manual_order)).upper()
        for reg in dev.get('registers') or []:
            yield {
                'device_id': dev.get('id'),
                'device_name': dev.get('name', ''),
                'device_model': dev.get('device_model', ''),
                'protocol': dev.get('protocol', ''),
                'byte_order': order,
                'manual_order': manual_order,
                'address': reg.get('address'),
                'length': reg.get('length'),
                'name': reg.get('name', ''),
                'description': reg.get('description', ''),
                'data_type': reg.get('data_type', 'uint16'),
                'unit': reg.get('unit', ''),
                'scale': reg.get('scale', 1),
                'offset': reg.get('offset', 0),
                'register': reg,
            }


def run(config_path: Path, out_csv: Path | None = None) -> Result:
    Probe = load_app_decoder()
    cfg = load_config(config_path)
    points = list(iter_points(cfg))

    findings: list[Finding] = []
    rows = []
    decoder_diverge = []
    order_mismatch = []
    overlap = []
    length_bad = []
    unit_missing = []
    scale_suspect = []
    dup = []
    special_bad = []

    # ---------- 1. 差分测试：参考实现 vs 被测实现（四种字节序） ----------
    for order in ORDERS:
        app = Probe(order)
        for label, value in SENTINELS:
            regs = list(encode_words(value, order))
            ref = decode_words(regs, order)
            got = app.decode_float32(regs)
            agree = (got is not None and math.isclose(got, ref, rel_tol=1e-6, abs_tol=1e-9))
            if not agree:
                decoder_diverge.append({'order': order, 'value': label,
                                        'reference': ref, 'app': got, 'regs': regs})

    # 特殊值：NaN/Inf 必须被判定为"不可用"，不能当数字返回
    for label, value in (('+Inf', float('inf')), ('NaN', float('nan'))):
        regs = list(encode_words(value, 'ABCD'))
        got = Probe('ABCD').decode_float32(regs)
        if got is not None:
            special_bad.append({'value': label, 'app': got})

    if decoder_diverge:
        findings.append(Finding(
            'IO_DECODER_DIVERGENCE',
            f'{len(decoder_diverge)} 组「参考实现 vs 被测实现」解码结果不一致'
            '（说明有字节序分支与 Modbus 规范不符）',
            'critical', len(decoder_diverge), {'cases': decoder_diverge[:6]}))
    if special_bad:
        findings.append(Finding(
            'IO_SPECIAL_NOT_REJECTED',
            f'{len(special_bad)} 个 NaN/Inf 被当成正常数值返回（应判质量坏）',
            'critical', len(special_bad), {'cases': special_bad}))

    # ---------- 2. 真值检验：设备按手册编码 → 系统按配置解码 ----------
    seen_addr = []
    seen_name = {}
    for p in points:
        dt = str(p['data_type']).lower()
        need = TYPE_WORDS.get(dt)
        app = Probe(p['byte_order'])

        # 2a. 字节序：设备按手册（manual_order）编码，系统按配置（byte_order）解码
        if dt == 'float32':
            for label, value in SENTINELS:
                regs = list(encode_words(value, p['manual_order']))
                got = app.decode_float32(regs)
                ok = got is not None and math.isclose(got, value, rel_tol=1e-6, abs_tol=1e-9)
                if not ok:
                    order_mismatch.append({
                        'device_id': p['device_id'], 'register': p['name'],
                        'configured': p['byte_order'], 'manual': p['manual_order'],
                        'expect': value, 'actual': got})
                    break

        # 2b. 长度 vs 数据类型
        if need is not None and p['length'] is not None and int(p['length']) != need:
            length_bad.append({'device_id': p['device_id'], 'register': p['name'],
                               'data_type': dt, 'expect_length': need,
                               'configured_length': p['length']})

        # 2c. 地址重叠：两个点落在同一段寄存器上 = 后写的覆盖先写的
        if p['address'] is not None:
            span = int(p['length'] or need or 1)
            cur_start, cur_end = int(p['address']), int(p['address']) + span
            for (dev, a_start, a_end, other) in seen_addr:
                if dev == p['device_id'] and not (cur_end <= a_start or cur_start >= a_end):
                    overlap.append({
                        'device_id': dev, 'a': other, 'b': p['name'],
                        'a_span': [a_start, a_end], 'b_span': [cur_start, cur_end]})
            seen_addr.append((p['device_id'], cur_start, cur_end, p['name']))

        # 2d. 单位缺失 / 量纲为零
        #     规则要区分两类量：模拟量（float/int32）必须有单位，**无量纲也要显式写 '1'**
        #     或 '-'；开关量（uint16/int16）本来就是 0/1 状态，不要求单位。
        #     不区分的后果是：pH、功率因数、回流比这类无量纲量被误报，
        #     真缺单位的点反而淹没在噪音里。
        analog = dt in ('float32', 'float64', 'int32', 'uint32')
        if analog and not str(p['unit']).strip():
            unit_missing.append({'device_id': p['device_id'], 'register': p['name'],
                                 'data_type': dt})
        try:
            if float(p['scale'] or 0) == 0:
                scale_suspect.append({'device_id': p['device_id'], 'register': p['name']})
        except (TypeError, ValueError):
            scale_suspect.append({'device_id': p['device_id'], 'register': p['name'],
                                  'reason': 'scale 非数值'})

        key = (p['device_id'], p['name'])
        if key in seen_name:
            dup.append({'device_id': p['device_id'], 'register': p['name']})
        seen_name[key] = True

        rows.append({
            'device_id': p['device_id'], 'device_name': p['device_name'],
            'device_model': p['device_model'], 'protocol': p['protocol'],
            'address': p['address'], 'length': p['length'] or need,
            'register': p['name'], 'description': p['description'],
            'data_type': dt, 'unit': p['unit'], 'scale': p['scale'],
            'offset': p['offset'], 'byte_order': p['byte_order'],
            'manual_order': p['manual_order'],
            'conform': 'FAIL' if any(
                m['device_id'] == p['device_id'] and m['register'] == p['name']
                for m in order_mismatch) else 'PASS',
        })

    if order_mismatch:
        findings.append(Finding(
            'IO_BYTE_ORDER_MISMATCH',
            f'{len(order_mismatch)} 个点的字节序与设备手册不符（值会整体错位）',
            'critical', len(order_mismatch), {'points': order_mismatch[:8]}))
    if length_bad:
        findings.append(Finding(
            'IO_LENGTH_MISMATCH',
            f'{len(length_bad)} 个点的寄存器长度与数据类型不匹配（会读到邻点数据）',
            'critical', len(length_bad), {'points': length_bad[:8]}))
    if overlap:
        findings.append(Finding(
            'IO_ADDRESS_OVERLAP',
            f'{len(overlap)} 处寄存器地址重叠（后写的点会覆盖先写的点）',
            'critical', len(overlap), {'cases': overlap[:8]}))
    if dup:
        findings.append(Finding(
            'IO_DUPLICATE_POINT',
            f'{len(dup)} 个重复点（同设备同寄存器名，只会留下一条）',
            'warning', len(dup), {'points': dup[:8]}))
    if unit_missing:
        findings.append(Finding(
            'IO_MISSING_UNIT',
            f'{len(unit_missing)} 个点没有单位（曲线无法判读，仪表读数不可用）',
            'warning', len(unit_missing), {'points': unit_missing[:8]}))
    if scale_suspect:
        findings.append(Finding(
            'IO_SCALE_ZERO',
            f'{len(scale_suspect)} 个点 scale 为 0 或非数值（所有值会被压成 0 或偏移）',
            'critical', len(scale_suspect), {'points': scale_suspect[:8]}))

    verdict = PASS if not findings else FAIL
    if not points:
        verdict = INSUFFICIENT

    if out_csv and rows:
        out_csv.parent.mkdir(parents=True, exist_ok=True)
        with open(out_csv, 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)

    devices = {p['device_id'] for p in points}
    return Result(
        id='data_io', title='点表一致性（字节序 / 长度 / 地址 / 单位）',
        claim='DATA-06',
        verdict=verdict,
        metrics={
            'points': len(points), 'devices': len(devices),
            'orders_tested': list(ORDERS), 'sentinels': [s[0] for s in SENTINELS],
            'decoder_cases': len(ORDERS) * len(SENTINELS),
            'order_mismatch': len(order_mismatch),
            'decoder_divergence': len(decoder_diverge),
            'address_overlap': len(overlap),
            'length_mismatch': len(length_bad),
            'missing_unit': len(unit_missing),
            'duplicate': len(dup),
            'io_list': str(out_csv) if out_csv else None,
        },
        findings=findings,
        ground_truth='IPC-4 字节序定义 + 设备手册（devices_modbus_sim.yaml 声明 ABCD）+ 参考实现独立复算',
        sample=len(points),
    )
