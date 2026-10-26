"""深度校验基础设施：路径、快照、结论结构。

设计约束（这三条决定了后面所有代码怎么写）：

1. **检测器必须是纯函数**：输入一个数据库/文件路径，输出一个结论。
   不依赖 Flask、不依赖后端在跑、不写自己的状态。否则"通过"没法被别人复现。
2. **结论必须带 finding code**：只报 ``pass/fail`` 的检测器没法被检验 ——
   "失败"可能是因为查错了表。负向控制要断言的是**具体哪条 finding 出现了**。
3. **insufficient 是一等公民**：样本不足时不许给 pass。工业上最常见的假证据，
   就是拿 3 条记录算出"占比 0%，达标"。
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
import tempfile
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT_DIR = REPO / 'reports' / 'deep'

PASS, FAIL, INSUFFICIENT = 'pass', 'fail', 'insufficient'
_SEV_ORDER = {'critical': 0, 'warning': 1, 'info': 2}

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass


def say(msg: str = '') -> None:
    """统一输出（Windows 控制台编码不总是 UTF-8，抛错比乱码更糟）。"""
    try:
        print(msg)
    except UnicodeEncodeError:
        print(msg.encode('utf-8', 'replace').decode('utf-8', 'replace'))


@dataclass
class Finding:
    code: str
    message: str
    severity: str = 'warning'
    count: int = 0
    detail: dict = field(default_factory=dict)


@dataclass
class Result:
    id: str
    title: str
    claim: str            # 它支撑哪条需求（追溯矩阵 ID）
    verdict: str
    metrics: dict = field(default_factory=dict)
    findings: list = field(default_factory=list)
    ground_truth: str = ''
    sample: int = 0

    def codes(self) -> set[str]:
        return {f.code for f in self.findings}

    def to_dict(self) -> dict:
        d = asdict(self)
        d['findings'] = [asdict(f) if not isinstance(f, dict) else f for f in self.findings]
        return d


def find_db(explicit: str | None = None) -> Path:
    cands = [explicit] if explicit else []
    cands += [
        os.path.expandvars(r'%LOCALAPPDATA%\Programs\smartscada\resources\backend\_internal\data\scada_simulated.db'),
        str(REPO / 'backend' / '_internal' / 'data' / 'scada_simulated.db'),
    ]
    for c in cands:
        if c and os.path.exists(c):
            return Path(c).resolve()
    raise FileNotFoundError('找不到数据库，用 --db 指定')


def connect_ro(db: Path) -> sqlite3.Connection:
    """只读连接：检测器绝不会改被测对象。

    只读模式会忽略 WAL 里未 checkpoint 的数据 —— 这是**故意**的：
    检测的应当是"已提交落盘的数据"，读 WAL 缓冲区会让结果依赖谁先打开文件。
    """
    conn = sqlite3.connect(f'file:{db.as_posix()}?mode=ro', uri=True, timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def snapshot(src: Path, dst: Path) -> Path:
    """生成一致快照（VACUUM INTO 而不是 copy 文件）。

    直接拷 ``.db`` 会漏掉 ``-wal`` 里已提交但未 checkpoint 的数据，
    拿到的是"撕裂"的库：张三查 308306 行、李四查 306000 行，
    然后争论工具不准。VACUUM INTO 走 SQLite 自己的读事务，快照一致。
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()
    src_conn = connect_ro(src)
    try:
        src_conn.execute('VACUUM INTO ?', (str(dst),))
    finally:
        src_conn.close()
    return dst


def connect_rw(db: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db), timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def write_json(path: Path, obj) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, default=str),
                    encoding='utf-8')
    return path


def read_json(path: Path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def tmp_dir(tag: str) -> Path:
    d = Path(tempfile.mkdtemp(prefix=f'scada-{tag}-'))
    return d


def cleanup(d: Path) -> None:
    shutil.rmtree(d, ignore_errors=True)


def now_utc_str() -> str:
    return datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')


def summarize(results: list[Result]) -> dict:
    counts = {PASS: 0, FAIL: 0, INSUFFICIENT: 0}
    for r in results:
        counts[r.verdict] = counts.get(r.verdict, 0) + 1
    return counts
