"""静态口径门禁：让"某个写入路径用了另一个钟"变成编译期可见。

生成列解决了"孪生列会不会漂移"，但解决不了"新代码又引入第二种口径"：
有人加一张表、写一列 ``created_at``（以为是本地时间），或者把
``CURRENT_TIMESTAMP`` 塞进一个本地口径的列——两者都不会报错，
只会在半年后对账时差 8 小时。

本模块用两条规则把这两种情况挡在提交前：

    R1 CLOCK_UNREGISTERED_COLUMN  源码里出现的 (表, 时间列) 没在 schema_clock.REGISTRY 登记
    R2 CLOCK_WRONG_DEFAULT        本地口径的列被显式赋值为 CURRENT_TIMESTAMP

R1 的杀伤力在"新增"：以后谁加表忘了登记时间口径，`deep-verify` 直接红。
"""
from __future__ import annotations

import ast
import re
from pathlib import Path

from .common import REPO
from .schema_clock import LOCAL, REGISTRY, UTC

CREATE_RE = re.compile(
    r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\((.*?)\)\s*(?:;|$)', re.S | re.I)
TIME_COL_RE = re.compile(r'(timestamp|_at$|_time$|_date$)', re.I)


def _sql_literals(path: Path):
    """取出源码里所有字符串常量及其起始行号（SQL 都写在字符串里）。"""
    try:
        tree = ast.parse(path.read_text(encoding='utf-8'))
    except (SyntaxError, UnicodeDecodeError):
        return
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            if node.value.upper().lstrip().startswith(('CREATE', 'INSERT', 'UPDATE', 'ALTER')):
                yield node.value, getattr(node, 'lineno', 0)


def _parse_create(sql: str):
    for m in CREATE_RE.finditer(sql):
        table = m.group(1)
        cols = []
        for line in m.group(2).split(','):
            parts = line.strip().split()
            if len(parts) >= 2:
                name = parts[0].strip('"`')
                if TIME_COL_RE.search(name) and not re.match(
                        r'(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)', name, re.I):
                    cols.append(name)
        if cols:
            yield table, cols


def lint(root: Path | None = None) -> dict:
    root = root or (REPO / 'backend' / 'src')
    violations = []
    scanned = 0

    for path in sorted(root.rglob('*.py')):
        scanned += 1
        try:
            rel = path.relative_to(root).as_posix()
        except ValueError:      # 扫描根可能在仓库外（负向控制就是把 src 复制到临时目录）
            rel = path.as_posix()
        for sql, lineno in _sql_literals(path):
            up = sql.upper()
            if up.lstrip().startswith('CREATE'):
                for table, cols in _parse_create(sql):
                    for col in cols:
                        if (table, col) not in REGISTRY:
                            violations.append({
                                'code': 'CLOCK_UNREGISTERED_COLUMN',
                                'file': 'src/' + rel,
                                'line': lineno, 'table': table, 'column': col,
                                'message': f'{table}.{col} 未在 schema_clock.REGISTRY 登记时间口径',
                            })
            # R2：本地口径的列被写成 CURRENT_TIMESTAMP
            for (table, col), (conv, _n) in REGISTRY.items():
                if conv != LOCAL:
                    continue
                if re.search(rf'INSERT\s+INTO\s+["`]?{re.escape(table)}["`]?', up) or \
                   re.search(rf'UPDATE\s+["`]?{re.escape(table)}["`]?\s+SET', up):
                    if re.search(rf'{re.escape(col)}\s*[,)]?\s*.*CURRENT_TIMESTAMP', up) or \
                       re.search(rf'{re.escape(col)}\s*=\s*CURRENT_TIMESTAMP', up):
                        violations.append({
                            'code': 'CLOCK_WRONG_DEFAULT',
                            'file': 'src/' + rel,
                            'line': lineno, 'table': table, 'column': col,
                            'message': f'{table}.{col} 是本地口径，却被赋值为 CURRENT_TIMESTAMP(UTC)',
                        })

    # 去重（同一条 SQL 在同一文件里被多次引用）
    uniq, seen = [], set()
    for v in violations:
        k = (v['code'], v['file'], v['table'], v['column'])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(v)

    return {
        'ok': not uniq,
        'scanned_files': scanned,
        'registered': len(REGISTRY),
        'local': sum(1 for c, _ in REGISTRY.values() if c == LOCAL),
        'utc': sum(1 for c, _ in REGISTRY.values() if c == UTC),
        'violations': uniq,
        'rules': ['CLOCK_UNREGISTERED_COLUMN', 'CLOCK_WRONG_DEFAULT'],
    }
