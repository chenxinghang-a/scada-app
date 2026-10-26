"""薄壳：口径登记表的实现在 ``backend/src/core/schema_clock.py``。

为什么放在应用层：应用每次启动都要 ``install()``，否则**全新安装**的库
不会有 *_utc 孪生列 —— 那样"修好了"只在这台机器上成立，换台机器又退回去。
工具层只负责"检查"，实现必须跟着应用走。
"""
from __future__ import annotations

import importlib.util

from .common import REPO

_PATH = REPO / 'backend' / 'src' / 'core' / 'schema_clock.py'
_spec = importlib.util.spec_from_file_location('_scada_schema_clock', _PATH)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

# 原样导出：调用方（detectors / negative_control / migrate-timebase）不必改 import
for _k in dir(_mod):
    if not _k.startswith('__'):
        globals()[_k] = getattr(_mod, _k)
