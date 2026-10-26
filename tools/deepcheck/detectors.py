"""八个检测器。

每个检测器的契约：
    输入 = 只读的数据库路径（或文件路径），输出 = :class:`Result`
    *不* 读环境变量、不依赖后端在跑、不写被测对象。

``insufficient`` 必须显式给出 —— 样本不够时说"通过"是造假。
"""

from __future__ import annotations

import importlib.util
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from . import coverage, pointtable
from .common import (FAIL, INSUFFICIENT, PASS, REPO, Finding, Result,
                     connect_ro, say)

#: ISA-18.2 阈值（别人定的数字，不是我们拍的）
ALARM_RATE_MAX = 6.0          # 条/小时/操作员
CRITICAL_SHARE_MAX = 0.05     # critical 占比 ≤ 5%
STALE_HOURS = 24
MIN_ALARM_SAMPLE = 30
MIN_POINT_SAMPLE = 10
#: 允许的"采样→入库"延迟上限（秒）。这个 1 小时不是拍脑袋：迁移后实测
#: 315146 行里 99.995% 的 ts_utc 与 created_at 完全同秒，另有 17 行因队列
#: 缓冲晚了最多 628 秒。取 3600 秒 = 实测最大值的 5.7 倍，既不会把正常
#: 缓冲误判成缺陷，又能抓住任何 ≥1 小时量级的基准错误（时区错、符号错）。
LAG_MAX_SEC = 3600
#: ts_utc 晚于 created_at 超过这个秒数 = 物理上不可能（先采样后入库）。
LAG_MIN_SEC = -60
#: 最近写入行的 created_at 与 ts_utc 允许的最大差（写入即时性，不是缓冲）
WRITE_SKEW_MAX_SEC = 600


def _local_now_str() -> str:
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def _hours_ago(h: float) -> str:
    return (datetime.now() - timedelta(hours=h)).strftime('%Y-%m-%d %H:%M:%S')


# ---------------------------------------------------------------- 报警类

def det_alarm_stale(db: Path) -> Result:
    """陈旧报警：未确认且超过 24 小时没人管 → 应为 0。"""
    with connect_ro(db) as conn:
        total = conn.execute('SELECT COUNT(*) FROM alarm_records').fetchone()[0]
        rows = conn.execute('''
            SELECT alarm_id, device_id, COALESCE(last_trigger_time, timestamp) AS ts
            FROM alarm_records
            WHERE COALESCE(acknowledged, 0) = 0
              AND julianday(COALESCE(last_trigger_time, timestamp))
                  < julianday(?)
            ORDER BY ts
        ''', (_hours_ago(STALE_HOURS),)).fetchall()

    findings = []
    if rows:
        findings.append(Finding(
            'STALE_ALARM', f'{len(rows)} 条报警超过 {STALE_HOURS}h 未确认',
            'warning', len(rows),
            {'alarms': [dict(r) for r in rows[:10]]}))

    verdict = PASS if not rows else FAIL
    if total == 0:
        verdict = INSUFFICIENT
    return Result(
        id='alm_stale', title='陈旧报警（ISA-18.2）', claim='ALM-03',
        verdict=verdict,
        metrics={'alarms_total': total, 'stale': len(rows), 'stale_hours': STALE_HOURS},
        findings=findings,
        ground_truth='ANSI/ISA-18.2-2016：陈旧报警数应为 0',
        sample=total,
    )


def det_alarm_priority(db: Path) -> Result:
    """优先级分布：critical 占比 ≤ 5%（全是 critical 等于没有优先级）。"""
    with connect_ro(db) as conn:
        rows = conn.execute('''
            SELECT LOWER(COALESCE(alarm_level, 'unknown')) AS lvl, COUNT(*) AS c
            FROM alarm_records
            WHERE julianday(timestamp) >= julianday(?)
            GROUP BY lvl
        ''', (_hours_ago(24),)).fetchall()

    dist = {r['lvl']: r['c'] for r in rows}
    total = sum(dist.values())
    critical = dist.get('critical', 0)
    share = (critical / total) if total else 0.0
    findings = []
    if total and share > CRITICAL_SHARE_MAX:
        findings.append(Finding(
            'ALM_CRITICAL_SHARE_EXCEEDED',
            f'critical 占比 {share:.1%} 超过 {CRITICAL_SHARE_MAX:.0%}'
            f'（{critical}/{total}）',
            'warning', critical, {'distribution': dist}))

    verdict = PASS if not findings else FAIL
    if total < MIN_ALARM_SAMPLE:
        verdict = INSUFFICIENT
    return Result(
        id='alm_priority', title='报警优先级分布', claim='ALM-01',
        verdict=verdict,
        metrics={'total': total, 'distribution': dist,
                 'critical_share': round(share, 4),
                 'min_sample': MIN_ALARM_SAMPLE},
        findings=findings,
        ground_truth=f'ISA-18.2：critical ≤ {CRITICAL_SHARE_MAX:.0%}；样本 ≥ {MIN_ALARM_SAMPLE}',
        sample=total,
    )


def det_alarm_chattering(db: Path) -> Result:
    """抖动报警：同一报警号在**一小时内**反复触发。

    ``trigger_count`` 是**累计**计数，不是"这一小时触发了几次"。把累计值按
    ``last_trigger_time`` 归到某个小时里，会把「两天里触发 21 次」误判成
    「一小时内 21 次」——这是本检测器第一版真实犯过的错，被现场数据打了出来。
    因此先用 ``last_trigger_time - timestamp`` 把「触发跨度 ≤1 小时」的行
    挑出来，跨度更长的行不能参与小时分桶。
    """
    with connect_ro(db) as conn:
        rows = conn.execute('''
            SELECT alarm_id, hour, rows_in_hour, triggers FROM (
                SELECT alarm_id,
                       strftime('%Y-%m-%d %H', COALESCE(last_trigger_time, timestamp)) AS hour,
                       COUNT(*) AS rows_in_hour,
                       SUM(COALESCE(trigger_count, 1)) AS triggers
                FROM alarm_records
                WHERE (julianday(COALESCE(last_trigger_time, timestamp))
                       - julianday(timestamp)) * 24 <= 1.0
                GROUP BY alarm_id, hour
            )
            WHERE rows_in_hour > 5 OR triggers > 5
            ORDER BY triggers DESC
        ''').fetchall()

    findings = []
    if rows:
        findings.append(Finding(
            'ALARM_CHATTERING',
            f'{len(rows)} 个「报警号 × 小时」组合在一小时内触发过密（>5 次）',
            'warning', len(rows), {'buckets': [dict(r) for r in rows[:10]]}))

    with connect_ro(db) as conn:
        total = conn.execute('SELECT COUNT(*) FROM alarm_records').fetchone()[0]

    # 抖动是"存在性"判断，不是统计量：一条报警在 1 小时内跳 8 次就是缺陷，
    # 不需要"样本 ≥30 条"才敢说。所以这里不套 MIN_ALARM_SAMPLE。
    if rows:
        verdict = FAIL
    elif total == 0:
        verdict = INSUFFICIENT
    else:
        verdict = PASS
    return Result(
        id='alm_chattering', title='抖动报警', claim='ALM-02',
        verdict=verdict,
        metrics={'alarms_total': total, 'chattering_buckets': len(rows),
                 'scope': '触发跨度 ≤1 小时的行参与分桶（累计计数不可按小时摊）'},
        findings=findings,
        ground_truth='ISA-18.2：Top10 频繁报警应 < 总报警的 10%',
        sample=total,
    )


# ---------------------------------------------------------------- 数据类

def det_data_quality(db: Path) -> Result:
    """质量戳：坏值（Bad）与未知（NULL）都必须为 0，且必须能数出来。"""
    with connect_ro(db) as conn:
        rows = conn.execute(
            'SELECT quality, COUNT(*) AS c FROM realtime_data GROUP BY quality').fetchall()
    dist = {('NULL' if r['quality'] is None else int(r['quality'])): r['c'] for r in rows}
    total = sum(dist.values())
    bad = sum(c for q, c in dist.items() if q != 'NULL' and int(q) != 192)
    unknown = dist.get('NULL', 0)
    findings = []
    if bad:
        findings.append(Finding(
            'QUALITY_BAD_PRESENT', f'{bad} 个实时点位质量为非 Good（{bad / total:.1%}）',
            'warning', bad, {'distribution': dist}))
    if unknown:
        findings.append(Finding(
            'QUALITY_UNKNOWN',
            f'{unknown} 个实时点位质量未知（NULL）——无法判断值可不可信',
            'warning', unknown))

    verdict = PASS if not findings else FAIL
    if total < MIN_POINT_SAMPLE:
        verdict = INSUFFICIENT
    return Result(
        id='data_quality', title='数据质量戳覆盖', claim='DATA-01',
        verdict=verdict,
        metrics={'points': total, 'distribution': dist,
                 'bad': bad, 'unknown': unknown,
                 'bad_share': round(bad / total, 4) if total else None},
        findings=findings,
        ground_truth='OPC UA StatusCode：192=Good；坏值必须可数、可见',
        sample=total,
    )


def det_data_time(db: Path) -> Result:
    """时间基准：ts_utc 与「SQLite 自己写的 created_at」必须对得上。

    这是本项目最硬的一条交叉验证：``created_at`` 由 ``CURRENT_TIMESTAMP``（UTC）
    独立写入，``ts_utc`` 由应用换算。两者若能对上，说明换算正确；
    对不上，说明要么换算错了、要么时区搞错了 —— 无论哪种都会抓到。
    """
    with connect_ro(db) as conn:
        cols = {r[1] for r in conn.execute('PRAGMA table_info(history_data)')}
        if 'ts_utc' not in cols:
            return Result(
                id='data_time', title='时间基准一致性', claim='DATA-03',
                verdict=INSUFFICIENT,
                metrics={'reason': 'history_data 没有 ts_utc 列（迁移未执行）'},
                findings=[Finding('TIME_NO_CANONICAL_COLUMN',
                                  'history_data 缺少 ts_utc 权威列', 'critical', 0)],
                ground_truth='存储=UTC 朴素；ts_utc 与 CURRENT_TIMESTAMP 必须一致')

        row = conn.execute('''
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN ts_utc IS NULL THEN 1 ELSE 0 END) AS nulls,
                   AVG(CASE WHEN ts_utc IS NOT NULL
                            THEN (julianday(created_at) - julianday(ts_utc)) * 86400 END) AS lag_s,
                   MIN(CASE WHEN ts_utc IS NOT NULL
                            THEN (julianday(created_at) - julianday(ts_utc)) * 86400 END) AS min_lag_s,
                   MAX(CASE WHEN ts_utc IS NOT NULL
                            THEN (julianday(created_at) - julianday(ts_utc)) * 86400 END) AS max_lag_s,
                   SUM(CASE WHEN ts_utc IS NOT NULL
                             AND (julianday(created_at) - julianday(ts_utc)) * 86400 < ?
                            THEN 1 ELSE 0 END) AS in_future,
                   SUM(CASE WHEN ts_utc IS NOT NULL
                             AND (julianday(created_at) - julianday(ts_utc)) * 86400 > ?
                            THEN 1 ELSE 0 END) AS over_lag,
                   AVG(CASE WHEN ts_utc IS NOT NULL
                            THEN (julianday(timestamp) - julianday(ts_utc)) * 24 END) AS offset_h,
                   SUM(CASE WHEN julianday(COALESCE(ts_utc, timestamp)) > julianday('now') + 300.0/86400
                            THEN 1 ELSE 0 END) AS future
            FROM history_data
        ''', (LAG_MIN_SEC, LAG_MAX_SEC)).fetchone()

    total = row['total'] or 0
    nulls = row['nulls'] or 0
    lag = row['lag_s']
    min_lag = row['min_lag_s']
    max_lag = row['max_lag_s']
    in_future = row['in_future'] or 0
    over_lag = row['over_lag'] or 0
    offset_h = row['offset_h']
    future = row['future'] or 0

    findings = []
    if total == 0:
        return Result(id='data_time', title='时间基准一致性', claim='DATA-03',
                      verdict=INSUFFICIENT, metrics={'reason': 'history_data 为空'},
                      ground_truth='存储=UTC 朴素')
    if nulls:
        findings.append(Finding(
            'TIME_CANONICAL_NULL',
            f'{nulls}/{total} 行（{nulls / total:.1%}）没有 ts_utc —— 这些行无法跨表对齐',
            'critical', nulls))
    # 判据是「入库延迟 lag = created_at - ts_utc」的两个方向，而不是平均差：
    #   ① lag < -60s  → 采样时刻晚于入库时刻，物理上不可能 → 换算符号错了
    #   ② lag > 3600s → 采样时刻比入库早了 1 小时以上 → 少减/多减了一个时区
    # 用平均值会掩盖局部缺陷：2 万行里 500 行偏 1 小时，均值只动 90 秒。
    if in_future:
        findings.append(Finding(
            'TIME_SAMPLED_IN_FUTURE',
            f'{in_future}/{total} 行的 ts_utc 晚于入库时间（最小 lag {min_lag:.0f}s）'
            '—— 采样不可能发生在入库之后，换算方向错了',
            'critical', in_future, {'min_lag_s': round(min_lag, 1)}))
    if over_lag:
        findings.append(Finding(
            'TIME_INSERT_LAG',
            f'{over_lag}/{total} 行的入库延迟超过 {LAG_MAX_SEC}s（最大 {max_lag:.0f}s）'
            '—— 时间基准相差一个时区的典型症状',
            'critical', over_lag, {'max_lag_s': round(max_lag, 1)}))
    if future:
        findings.append(Finding(
            'TIME_FUTURE_TIMESTAMP', f'{future} 行时间戳在未来（时钟跳变/写入错误）',
            'warning', future))

    verdict = PASS if not findings else FAIL
    return Result(
        id='data_time', title='时间基准一致性', claim='DATA-03',
        verdict=verdict,
        metrics={'rows': total, 'ts_utc_null': nulls,
                 'mean_lag_seconds': round(lag, 1) if lag is not None else None,
                 'min_lag_seconds': round(min_lag, 1) if min_lag is not None else None,
                 'max_lag_seconds': round(max_lag, 1) if max_lag is not None else None,
                 'sampled_in_future': in_future,
                 'over_insert_lag': over_lag,
                 'lag_max_seconds': LAG_MAX_SEC,
                 'lag_min_seconds': LAG_MIN_SEC,
                 'local_offset_hours': round(offset_h, 3) if offset_h is not None else None,
                 'future_rows': future},
        findings=findings,
        ground_truth='created_at = SQLite CURRENT_TIMESTAMP(UTC)，与 ts_utc 独立同源',
        sample=total,
    )


def det_data_io(config_path: Path, out_csv: Path | None = None) -> Result:
    """点表一致性（委托给 pointtable 模块，保持单一实现）。"""
    return pointtable.run(Path(config_path), out_csv)


def det_write_path(db: Path, window_minutes: int = 30) -> Result:
    """写入路径体检：**最近写进来的**行，携带的时间对不对。

    为什么必须有这一项：迁移能把历史行回填得很漂亮，但回填掩盖了写入路径的
    真实状态。上一轮我给 history_data 加了 ts_utc 之后，`insert_data_batch`
    的参数从 6 元组变成 7 元组，而 realtime_data 的 INSERT 仍是 6 个占位符——
    系统启动后**每一批写入都失败**（日志里刷 "Incorrect number of bindings"），
    而当时所有检测器都是绿的：因为它们看的是迁移过的旧数据。

    这条检测器只看"最近 N 分钟由应用写入的行"，因此回填无法掩盖它。
    没有近期数据时判 insufficient（而不是 pass）——"没跑"不等于"对"。
    """
    cutoff_minus = window_minutes
    with connect_ro(db) as conn:
        row = conn.execute(f'''
            SELECT COUNT(*) AS recent,
                   SUM(CASE WHEN ts_utc IS NULL THEN 1 ELSE 0 END) AS nulls,
                   SUM(CASE WHEN ts_utc IS NOT NULL
                             AND ABS((julianday(created_at) - julianday(ts_utc)) * 86400) > ?
                            THEN 1 ELSE 0 END) AS skew,
                   MAX(ABS(CASE WHEN ts_utc IS NOT NULL
                                 THEN (julianday(created_at) - julianday(ts_utc)) * 86400 END)) AS max_skew
            FROM history_data
            WHERE julianday(created_at) >= julianday('now') - ? / 1440.0
        ''', (WRITE_SKEW_MAX_SEC, cutoff_minus)).fetchone()

    recent = row['recent'] or 0
    nulls = row['nulls'] or 0
    skew = row['skew'] or 0
    max_skew = row['max_skew']

    findings = []
    if nulls:
        findings.append(Finding(
            'WRITE_PATH_NULL',
            f'最近 {window_minutes} 分钟写入的 {recent} 行里，{nulls} 行没有 ts_utc'
            '—— 写入路径漏了权威时间（迁移回填掩盖不了这一条）',
            'critical', nulls))
    if skew:
        findings.append(Finding(
            'WRITE_PATH_SKEW',
            f'最近写入的 {skew} 行 created_at 与 ts_utc 相差超过 600 秒'
            f'（最大 {max_skew:.0f}s）—— 换算方向或来源错',
            'critical', skew, {'max_skew_s': round(max_skew or 0, 1)}))

    verdict = PASS if not findings else FAIL
    if recent == 0:
        verdict = INSUFFICIENT      # 系统没跑，就不能说写入路径是对的

    return Result(
        id='write_path', title='写入路径体检（最近写入的行）', claim='DATA-03',
        verdict=verdict,
        metrics={'window_minutes': window_minutes, 'recent_rows': recent,
                 'null_ts_utc': nulls, 'skewed_rows': skew,
                 'max_skew_seconds': round(max_skew, 1) if max_skew is not None else None},
        findings=findings,
        ground_truth='回填不可作为写入路径的证据；只看最近 N 分钟由应用写入的行',
        sample=recent,
    )


# ---------------------------------------------------------------- 口径类

def det_timebase_all(db: Path) -> Result:
    """全库时间口径：每张业务表的时间列都必须有 UTC 孪生列，且不漂移。

    与 ``det_data_time`` 的分工：那个查 history_data 一条深的（31 万行 + 第三方
    时间源交叉验证），这个查**广度**——所有表的口径是否都登记、都落实。
    """
    from . import schema_clock
    conn = connect_ro(db)
    try:
        rep = schema_clock.verify(conn)
    finally:
        conn.close()

    findings = []
    for p in rep['problems']:
        code = ('TB_FUTURE' if '在未来' in p else
                'TB_EXPRESSION' if '表达式' in p else
                'TB_DRIFT' if '相差' in p else
                'TB_MISSING_TWIN')
        findings.append(Finding(code, p, 'critical', 1))
    if rep['problems']:
        findings.append(Finding('TB_SUMMARY', f"{len(rep['problems'])} 处口径问题",
                                'critical', len(rep['problems'])))

    return Result(
        id='timebase_all', title='全库时间口径（登记 / 孪生列 / 漂移）', claim='DATA-03',
        verdict=PASS if rep['ok'] else FAIL,
        metrics={'offset_hours': rep['offset_hours'], 'columns_checked': rep['columns_checked'],
                 'registered': len(schema_clock.REGISTRY),
                 'tables': [{k: t[k] for k in ('table', 'column', 'convention', 'status')
                             if k in t} for t in rep['tables']]},
        findings=findings,
        ground_truth='schema_clock.REGISTRY（单一真源）+ 生成列表达式 + 逐行差值',
        sample=rep['columns_checked'],
    )


def det_clock_lint(root: Path | None = None) -> Result:
    """静态口径门禁：新增表/列没登记时间口径，直接失败。"""
    from . import clock_lint as cl
    rep = cl.lint(Path(root) if root else None)
    findings = []
    for v in rep['violations']:
        findings.append(Finding(v['code'], f"{v['file']}:{v['line']} {v['message']}",
                                'critical', 1, {'table': v['table'], 'column': v['column']}))
    return Result(
        id='clock_lint', title='时间口径静态门禁', claim='DATA-03',
        verdict=PASS if rep['ok'] else FAIL,
        metrics={k: rep[k] for k in ('scanned_files', 'registered', 'local', 'utc') },
        findings=findings,
        ground_truth='REGISTRY 单一真源 + 源码扫描（ast 取 SQL 字符串）',
        sample=rep['scanned_files'],
    )


def det_anchor(db: Path, anchor_path: Path | None = None) -> Result:
    """审计链外部锚点：抓"尾部截断"这个哈希链的数学盲区。"""
    from . import anchor as anchor_mod
    conn = sqlite3.connect(str(db), timeout=30)
    try:
        rep = anchor_mod.verify(conn, Path(anchor_path) if anchor_path else anchor_mod.ANCHOR_FILE)
    finally:
        conn.close()

    code = {'UNANCHORED': 'ANCHOR_MISSING', 'TAIL_TRUNCATED': 'ANCHOR_TAIL_TRUNCATED',
            'HISTORY_REWRITTEN': 'ANCHOR_HISTORY_REWRITTEN',
            'ANCHOR_FILE_TAMPERED': 'ANCHOR_FILE_TAMPERED',
            'CHAIN_BROKEN': 'CHAIN_BROKEN'}.get(rep['status'], 'ANCHOR_UNKNOWN')
    findings = [] if rep['ok'] else [Finding(code, rep['reason'], 'critical', 1)]

    verdict = PASS if rep['ok'] else (INSUFFICIENT if rep['status'] == 'UNANCHORED' else FAIL)
    return Result(
        id='anchor', title='审计链外部锚点（防尾部截断）', claim='SEC-03',
        verdict=verdict,
        metrics={'status': rep['status'], 'anchors': rep.get('anchors'),
                 'anchored_entries': rep.get('anchored_entries'),
                 'current_entries': rep.get('current_entries')},
        findings=findings,
        ground_truth='外部锚点（条数 + 链头哈希）随 git 提交；链内自校验无法覆盖截断',
        sample=rep.get('anchors') or 0,
    )


# ---------------------------------------------------------------- 运维类

def det_ops_backup(backup_path: Path, baseline: dict | None = None) -> Result:
    """备份可恢复性：能打开、integrity_check 通过、行数与源库一致。"""
    path = Path(backup_path)
    findings = []
    metrics = {'file': str(path), 'size': path.stat().st_size if path.exists() else 0}
    if not path.exists():
        return Result(id='ops_backup', title='备份可恢复性', claim='DATA-07',
                      verdict=FAIL, metrics=metrics,
                      findings=[Finding('BACKUP_MISSING', '备份文件不存在', 'critical', 1)],
                      ground_truth='恢复演练：文件可打开 + integrity_check + 行数一致')

    try:
        conn = sqlite3.connect(f'file:{path.as_posix()}?mode=ro', uri=True)
        integrity = conn.execute('PRAGMA integrity_check').fetchone()[0]
        counts = {}
        for t in ('history_data', 'realtime_data', 'alarm_records', 'operation_logs'):
            try:
                counts[t] = conn.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]
            except sqlite3.Error:
                counts[t] = None
        conn.close()
    except sqlite3.Error as e:
        return Result(id='ops_backup', title='备份可恢复性', claim='DATA-07',
                      verdict=FAIL, metrics=metrics,
                      findings=[Finding('BACKUP_UNOPENABLE', f'备份打不开: {e}', 'critical', 1)],
                      ground_truth='恢复演练')

    metrics['integrity'] = integrity
    metrics['counts'] = counts
    if integrity != 'ok':
        findings.append(Finding('BACKUP_CORRUPT', f'integrity_check 未通过: {integrity}',
                                'critical', 1))

    if baseline:
        metrics['baseline'] = baseline
        for t, n in baseline.items():
            got = counts.get(t)
            if n is not None and got is not None and got < n:
                findings.append(Finding(
                    'BACKUP_COUNT_MISMATCH',
                    f'{t} 行数 {got} < 源库 {n}（{n - got} 行丢失）',
                    'critical', n - got, {'table': t}))

    # 业务级：备份不只是"能打开"，恢复出来的库还得满足业务不变量。
    # 只做 integrity_check 等于只验了"文件没坏"，不验"时间口径、质量戳是否还成立"。
    try:
        from . import schema_clock
        conn = sqlite3.connect(f'file:{path.as_posix()}?mode=ro', uri=True)
        try:
            schema = schema_clock.verify(conn)
            q = conn.execute('SELECT quality, COUNT(*) FROM realtime_data GROUP BY quality'
                             ).fetchall()
        finally:
            conn.close()
        metrics['schema_ok'] = schema['ok']
        metrics['schema_problems'] = schema['problems'][:5]
        if not schema['ok']:
            findings.append(Finding(
                'BACKUP_SCHEMA_DRIFT',
                f"恢复出的库有 {len(schema['problems'])} 处时间口径问题（口径未随备份一起还原）",
                'critical', len(schema['problems']), {'problems': schema['problems'][:5]}))
        bad_q = sum(c for qv, c in q if qv is not None and int(qv) != 192)
        metrics['quality_bad_points'] = bad_q
        if bad_q:
            findings.append(Finding(
                'BACKUP_QUALITY_BAD',
                f'恢复出的库有 {bad_q} 个点位质量为非 Good（备份时已是坏值）',
                'warning', bad_q))
    except sqlite3.Error as e:
        findings.append(Finding('BACKUP_INVARIANT_ERROR',
                                f'在备份上执行业务不变量时出错: {e}', 'warning', 1))

    return Result(
        id='ops_backup', title='备份可恢复性', claim='DATA-07',
        verdict=PASS if not findings else FAIL,
        metrics=metrics, findings=findings,
        ground_truth='SQLite integrity_check（外部实现）+ 行数比对',
        sample=sum(v for v in counts.values() if v) if counts else 0,
    )


# ---------------------------------------------------------------- 安全类

def _load_audit_chain():
    path = REPO / 'backend' / 'src' / 'core' / 'audit_chain.py'
    spec = importlib.util.spec_from_file_location('_scada_audit_chain', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def det_sec_chain(db: Path) -> Result:
    """审计链：任何一条被改、被删、被插，都必须被发现。"""
    mod = _load_audit_chain()
    conn = sqlite3.connect(str(db), timeout=30)
    try:
        rep = mod.verify_chain(conn)
    finally:
        conn.close()

    findings = []
    if not rep['ok']:
        findings.append(Finding(
            'CHAIN_BROKEN', f'审计链断裂：{rep["reason"]}', 'critical',
            len(rep['broken']), {'broken': rep['broken'][:10]}))
    if rep['entries'] == 0:
        findings.append(Finding(
            'CHAIN_EMPTY', '审计链为空 —— 要么没发生变更，要么变更没被记录',
            'info', 0))

    verdict = PASS if rep['ok'] else FAIL
    if rep['entries'] == 0:
        verdict = INSUFFICIENT
    return Result(
        id='sec_chain', title='配置变更审计链', claim='SEC-03',
        verdict=verdict,
        metrics={'entries': rep['entries'], 'head_hash': rep['head_hash']},
        findings=findings,
        ground_truth='SHA-256 哈希链自校验（密码学，不需要信任实现者）',
        sample=rep['entries'],
    )


#: 名称 → (函数, 输入类型)。矩阵与 CLI 共用这张表，避免"跑的不是同一份"。
REGISTRY = {
    'alm_stale': (det_alarm_stale, 'db'),
    'alm_priority': (det_alarm_priority, 'db'),
    'alm_chattering': (det_alarm_chattering, 'db'),
    'data_quality': (det_data_quality, 'db'),
    'data_time': (det_data_time, 'db'),
    'write_path': (det_write_path, 'db'),
    'point_coverage': (coverage.det_point_coverage, 'db_dev'),
    'alarm_coverage': (coverage.det_alarm_coverage, 'db_alarm'),
    'timebase_all': (det_timebase_all, 'db'),
    'data_io': (det_data_io, 'config'),
    'ops_backup': (det_ops_backup, 'file'),
    'sec_chain': (det_sec_chain, 'db'),
    'anchor': (det_anchor, 'db_anchor'),
    'clock_lint': (det_clock_lint, 'none'),
}
