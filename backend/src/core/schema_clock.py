"""时间口径注册表：把"哪张表的哪一列用哪个时钟"变成一份可校验的声明。

问题不在"时间存错了"，而在**没人知道每列用的是哪个钟**。这个库的现状是：

    history_data.timestamp   业务代码 datetime.now()      → 本地
    realtime_data.timestamp  同上                          → 本地
    alarm_records.timestamp  同上                          → 本地
    operation_logs.timestamp SQLite CURRENT_TIMESTAMP      → UTC
    users.created_at         同上                          → UTC
    device_status.timestamp  无写入路径（死表）             → 未定义

五种列、两种口径、一种未定义。任何跨表关联都在赌运气。

本模块做三件事，把"赌运气"变成"查表"：

1. **声明**：``REGISTRY`` 是唯一的真源，写清每列的约定（local / utc / exempt）。
2. **派生**：``install()`` 为每列建一个 ``*_utc`` 孪生列。local 列用
   **生成列**（GENERATED ALWAYS AS）由 SQLite 自己算，因此**不可能漂移、
   不可能漏写**——代码里不存在"第二条写入路径"这回事。
3. **校验**：``verify()`` 对着活库检查孪生列存在、表达式正确、数据不在未来。

为什么生成列而不是双写：双写依赖"每个写入点都记得写两列"，而写入点会增长。
生成列把这件事从"纪律"变成"结构"——纪律会松，结构不会。

为什么放在应用层（core/）而不是 tools/：应用每次启动都要 ``install()``。
否则全新安装的库没有孪生列，"修好了"只在这台机器上成立。
"""

from __future__ import annotations

import sqlite3
from datetime import datetime

#: 时间口径
LOCAL = 'local'      # 现场本地时间（业务代码 datetime.now() 的产物）
UTC = 'utc'          # 协调世界时（SQLite CURRENT_TIMESTAMP 的产物）
EXEMPT = 'exempt'    # 不参与跨表关联，保持原样并说明原因

META_TABLE = '_timebase_meta'

#: (表, 列) → (口径, 说明)。**新增时间列必须在这里登记，否则 clock_lint 失败。**
REGISTRY = {
    ('history_data', 'timestamp'): (LOCAL, '采样时刻；已有实体 ts_utc 列（31 万行已回填）'),
    ('realtime_data', 'timestamp'): (LOCAL, '最后一帧采样时刻（UPSERT 覆盖）'),
    ('alarm_records', 'timestamp'): (LOCAL, '报警首次触发时刻'),
    ('alarm_records', 'last_trigger_time'): (LOCAL, '报警最近触发时刻；陈旧判定基于它'),
    ('alarm_records', 'acknowledged_at'): (LOCAL, '确认时刻；MTTA 计算基于它'),
    ('operation_logs', 'timestamp'): (UTC, 'SQLite CURRENT_TIMESTAMP 默认值，已是 UTC'),
    ('device_status', 'timestamp'): (LOCAL, '当前无写入路径（死表），按运行库其余表约定登记'),
    ('users', 'created_at'): (EXEMPT, '账号簿记，不参与工艺时间关联'),
    ('users', 'updated_at'): (EXEMPT, '同上'),
    ('users', 'last_login'): (EXEMPT, '同上'),
    ('users', 'locked_until'): (EXEMPT, '鉴权用相对时间，不参与关联'),
    ('jwt_blacklist', 'blacklisted_at'): (EXEMPT, '令牌回收簿记'),
    ('history_archive', 'archive_date'): (EXEMPT, '聚合日期（DATE，非时刻）'),
    # 以下由 clock_lint 从源码扫描出来，逐个登记 —— 避免"没登记也没人发现"
    ('history_data', 'created_at'): (EXEMPT, '行入库时间（UTC），在 DATA-03 中充当独立第三方时间源'),
    ('realtime_data', 'created_at'): (EXEMPT, '行首次入库时间（UTC），UPSERT 不更新'),
    ('alarm_records', 'created_at'): (EXEMPT, '行入库时间（UTC），不参与报警业务时间'),
    ('device_status', 'created_at'): (EXEMPT, '行入库时间（UTC）'),
    ('cache', 'created_at'): (EXEMPT, '独立 cache.db 的 TTL 缓存，与工艺时间无关'),
    ('cache', 'expires_at'): (EXEMPT, '同上'),
    ('schema_migrations', 'applied_at'): (EXEMPT, '迁移簿记（本工具自己写，UTC）'),
}

#: 已实体化的孪生列（非生成列，由迁移脚本回填）。其余 local 列用生成列。
ENTITY_TWINS = {('history_data', 'timestamp'): 'ts_utc'}


def offset_hours(conn: sqlite3.Connection | None = None) -> float:
    """本地相对 UTC 的偏移。

    优先取库里登记的 ``local_offset_hours``（迁移当时用的值），没有则按系统时区算。
    **不能各算各的**：检测器与生成列必须用同一个数，否则不变量恒假。
    """
    if conn is not None:
        try:
            row = conn.execute(f"SELECT value FROM {META_TABLE} WHERE key='local_offset_hours'"
                               ).fetchone()
            if row:
                return float(row[0])
        except sqlite3.Error:
            pass
    return datetime.now().astimezone().utcoffset().total_seconds() / 3600.0


def twin_name(table: str, column: str) -> str:
    if (table, column) in ENTITY_TWINS:
        return ENTITY_TWINS[(table, column)]
    return 'ts_utc' if column == 'timestamp' else f'{column}_utc'


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    # 必须用 table_xinfo：PRAGMA table_info **不返回生成列**（它们算 hidden column）。
    # 用 table_info 会让"已经装好的孪生列"看起来不存在，安装脚本于是每次重装。
    return {r[1] for r in conn.execute(f'PRAGMA table_xinfo("{table}")')}


def _ddl_of(conn: sqlite3.Connection, table: str, column: str) -> str:
    # table_info 查不到生成列，补一次 table_xinfo（第 2 列是类型，第 6 列是 hidden 标记）
    for r in conn.execute(f'PRAGMA table_info("{table}")'):
        if r[1] == column:
            return r[2] or ''
    for r in conn.execute(f'PRAGMA table_xinfo("{table}")'):
        if r[1] == column:
            return str(r[2] or '')
    return ''


def ensure_meta(conn: sqlite3.Connection, offset: float) -> None:
    conn.execute(f'CREATE TABLE IF NOT EXISTS {META_TABLE} (key TEXT PRIMARY KEY, value TEXT)')
    conn.execute(f"INSERT OR REPLACE INTO {META_TABLE}(key, value) VALUES ('local_offset_hours', ?)",
                 (str(offset),))
    conn.execute(f"INSERT OR REPLACE INTO {META_TABLE}(key, value) VALUES ('canonical', 'UTC')")
    conn.execute(f"INSERT OR REPLACE INTO {META_TABLE}(key, value) VALUES "
                 f"('compat_note', 'timestamp 列保留现场本地语义，*_utc 为权威')")


def install(conn: sqlite3.Connection, offset: float | None = None,
            dry_run: bool = False) -> dict:
    """为所有 local 列建 ``*_utc`` 生成列（幂等）。

    生成列表达式：``datetime(<col>, '<-offset> hours')``。
    offset 在迁移当时确定并写入 ``_timebase_meta``，之后检测器用同一个值校验。
    """
    off = offset_hours(conn) if offset is None else float(offset)
    if not dry_run:
        ensure_meta(conn, off)
    modifier = f'{-off:+g} hours'

    added, skipped = [], []
    for (table, column), (conv, _note) in REGISTRY.items():
        if conv != LOCAL:
            continue
        try:
            cols = _columns(conn, table)
        except sqlite3.Error:
            skipped.append({'table': table, 'column': column, 'reason': '表不存在'})
            continue
        if column not in cols:
            skipped.append({'table': table, 'column': column, 'reason': '列不存在'})
            continue
        twin = twin_name(table, column)
        if twin in cols:
            skipped.append({'table': table, 'column': f'{column}→{twin}', 'reason': '已存在'})
            continue
        ddl = (f'ALTER TABLE "{table}" ADD COLUMN "{twin}" TEXT '
               f"GENERATED ALWAYS AS (datetime(\"{column}\", '{modifier}')) VIRTUAL")
        if dry_run:
            added.append({'table': table, 'column': f'{column}→{twin}', 'ddl': ddl,
                          'dry_run': True})
            continue
        conn.execute(ddl)
        added.append({'table': table, 'column': f'{column}→{twin}', 'modifier': modifier})

    if not dry_run:
        conn.commit()
    return {'offset_hours': off, 'modifier': modifier,
            'added': added, 'skipped': skipped}


def ensure_columns(conn: sqlite3.Connection) -> dict:
    """应用启动时调用：把孪生列补齐（幂等、绝不让启动失败）。"""
    try:
        return install(conn)
    except Exception as e:      # 启动路径：装不上也要能跑，但必须留痕
        return {'ok': False, 'error': f'{type(e).__name__}: {e}'}


def verify(conn: sqlite3.Connection) -> dict:
    """对着活库检查：孪生列都在、表达式对、值不在未来。"""
    off = offset_hours(conn)
    modifier = f'{-off:+g} hours'
    rows, problems = [], []

    for (table, column), (conv, note) in REGISTRY.items():
        item = {'table': table, 'column': column, 'convention': conv, 'note': note}
        try:
            cols = _columns(conn, table)
        except sqlite3.Error:
            rows.append({**item, 'status': 'MISSING_TABLE'})
            problems.append(f'{table} 不存在')
            continue
        if conv == EXEMPT:
            rows.append({**item, 'status': 'EXEMPT'})
            continue
        if column not in cols:
            # 表还没建（如 operation_logs 由认证模块首次登录时创建）或该列已改名。
            # 这不构成"口径错误"——登记表描述的是"存在时必须遵守"，不是"必须存在"。
            rows.append({**item, 'status': 'ABSENT'})
            continue
        if conv == UTC:
            # UTC 口径的列本身就是权威值，不需要孪生列；只查"值不在未来"。
            try:
                r = conn.execute(f'''
                    SELECT COUNT(*) AS total,
                           SUM(CASE WHEN julianday("{column}") > julianday('now') + 300.0/86400
                                    THEN 1 ELSE 0 END) AS future
                    FROM "{table}" WHERE "{column}" IS NOT NULL
                ''').fetchone()
            except sqlite3.Error as e:
                problems.append(f'{table}.{column} 统计失败: {e}')
                continue
            total, future = r
            item.update({'rows': total, 'future': future or 0, 'twin': None})
            if (future or 0) > 0:
                problems.append(f'{table}.{column} 有 {future} 行时间在未来')
            item['status'] = 'FUTURE' if (future or 0) else 'OK'
            rows.append(item)
            continue

        twin = twin_name(table, column)
        if twin not in cols:
            rows.append({**item, 'twin': twin, 'status': 'MISSING_TWIN'})
            problems.append(f'{table}.{column} 缺孪生列 {twin}')
            continue

        is_generated = 'GENERATED' in _ddl_of(conn, table, twin).upper()
        item.update({'twin': twin, 'generated': is_generated})

        # 表达式核对（生成列）：必须用登记的那个偏移，否则口径与登记不符
        if is_generated:
            sql = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
                               (table,)).fetchone()
            expr_ok = bool(sql) and modifier.replace(' ', '') in (sql[0] or '').replace(' ', '')
            item['expression_ok'] = expr_ok
            if not expr_ok:
                problems.append(f'{table}.{twin} 生成表达式未使用登记的偏移 {modifier}')

        try:
            r = conn.execute(f'''
                SELECT COUNT(*) AS total,
                       SUM(CASE WHEN "{twin}" IS NULL THEN 1 ELSE 0 END) AS nulls,
                       SUM(CASE WHEN julianday("{twin}") > julianday('now') + 300.0/86400
                                THEN 1 ELSE 0 END) AS future,
                       MIN((julianday("{column}") - julianday("{twin}")) * 24) AS min_gap_h,
                       MAX((julianday("{column}") - julianday("{twin}")) * 24) AS max_gap_h
                FROM "{table}"
                WHERE "{column}" IS NOT NULL
            ''').fetchone()
        except sqlite3.Error as e:
            problems.append(f'{table}.{column} 统计失败: {e}')
            continue

        total, nulls, future, min_gap, max_gap = r
        expected_gap = off if conv == LOCAL else 0.0
        item.update({'rows': total, 'nulls': nulls or 0, 'future': future or 0,
                     'gap_min_h': round(min_gap, 4) if min_gap is not None else None,
                     'gap_max_h': round(max_gap, 4) if max_gap is not None else None,
                     'gap_expected_h': expected_gap})

        bad_gap = False
        if total and max_gap is not None:
            bad_gap = (abs(max_gap - expected_gap) > 1 / 3600.0
                       or abs(min_gap - expected_gap) > 1 / 3600.0)
        if bad_gap:
            problems.append(f'{table}.{column} 与孪生列相差 {min_gap:.3f}…{max_gap:.3f} 小时，'
                            f'登记口径要求恒为 {expected_gap:+.3f}')
        if (future or 0) > 0:
            problems.append(f'{table}.{column} 有 {future} 行时间在未来（时钟跳变/写入错误）')
        if total and (nulls or 0) > 0:
            problems.append(f'{table}.{twin} 有 {nulls} 行为空')

        item['status'] = ('DRIFT' if bad_gap else 'FUTURE' if (future or 0) else 'OK')
        rows.append(item)

    return {'ok': not problems, 'offset_hours': off, 'modifier': modifier,
            'tables': rows, 'problems': problems,
            'columns_checked': len([r for r in rows if r['status'] != 'EXEMPT'])}
