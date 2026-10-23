# -*- mode: python ; coding: utf-8 -*-
"""打包 spec —— 把 backend/_internal 里的业务源码重新打成 scada-backend.exe。

背景（2026-10-23）：后端原本**只有打包产物**（_internal/*.py 是 datas 副本），
改 .py 不生效（PYZ 优先），也没人知道怎么重新打包，导致后端 bug 改不动。
这份 spec 把"能改能重打"这条链补回来。
"""
import os
from PyInstaller.utils.hooks import collect_submodules

SRC = r'C:\Users\cxx\scada-app\backend\src'

# 业务包 + 资源目录：既作为 datas 落盘（模板/配置/静态资源要能被按路径打开），
# 也通过 hiddenimports 编进 PYZ（模块要能被 import）。
DIRS = [
    'core', 'timeseries', 'tools',
    '存储层', '展示层', '报警层', '智能层', '用户层', '采集层',
    '模板', '配置', '静态资源',
]
FILES = ['run.py', 'config.py', 'paths.py']

datas = [(os.path.join(SRC, d), d) for d in DIRS]
datas += [(os.path.join(SRC, f), '.') for f in FILES]

hiddenimports = [
    'run', 'config', 'paths',
    'flask_socketio', 'flask_limiter', 'flask_restx',
    'pymodbus', 'paho.mqtt.client', 'asyncua',
    'bcrypt', 'jwt', 'yaml', 'psutil', 'apscheduler',
    'engineio.async_drivers.threading', 'socketio',
    'sqlite3', 'jinja2', 'markupsafe', 'werkzeug',
]
for pkg in ('存储层', '展示层', '报警层', '智能层', '用户层', '采集层', 'core', 'timeseries', 'tools'):
    hiddenimports += collect_submodules(pkg)

a = Analysis(
    [r'C:\Users\cxx\scada-app\backend\build_entry.py'],
    pathex=[SRC],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'PyQt5', 'PySide6', 'IPython', 'notebook'],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='scada-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='scada-backend-out',
)
