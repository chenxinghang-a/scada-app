"""时间基准统一。

SCADA 里最经典的隐形炸弹不是「时间不准」，而是**同一个库里存在两个时间基准**：
``CURRENT_TIMESTAMP`` 写的是 UTC，``datetime.now()`` 写的是本地时间，两者在
同一个查询里比较就是错的，而且错得很安静 —— 排序看起来正常、曲线也能画出来，
只有跨表关联（"这条报警对应的那批数据"）才会错开 8 小时。

本模块只做三件事，把"基准"变成一个可被机器检查的东西：

1. :func:`to_utc_naive` —— 把任意 datetime 归一化成 **UTC 朴素时间**，
   与 SQLite ``CURRENT_TIMESTAMP`` 完全同格式（``YYYY-MM-DD HH:MM:SS``）。
   存储层只认这一种。
2. :func:`now_utc` / :func:`now_local` —— 明确区分"记什么"和"给谁看"：
   落库用 UTC，给用户看用本地。
3. :func:`iso_local` —— 输出边界用。带 ``+08:00`` 偏移的 ISO 8601，
   前端 ``new Date()`` 才能正确换算，不会把 UTC 当本地时间显示。

约定（写进 docs/时间基准约定.md，别靠口口相传）：

    存储 = UTC 朴素      传输 = ISO 8601 带偏移      展示 = 浏览器本地时区

为什么要 ``ts_utc`` 而不是直接把 ``timestamp`` 改掉：``timestamp`` 是既有的
"现场本地时间"语义，大量查询与前端直接吃它；贸然改基准会让历史曲线整体位移
8 小时——这类"修复引入的回归"比原来的缺陷更难查。所以采用工业historians
常见做法：**新增权威列 + 双写 + 不变量校验**，存量回填、新数据同时写两列，
用 ``tools/deep-verify.py timebase`` 校验 ``ts_utc`` 与 ``timestamp`` 的差值恒定。
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

#: 本地时区相对 UTC 的偏移（小时）。不用写死 —— 由运行时算，但把算出来的值
#: 暴露成一个常量供审计工具比对，避免"工具和实现各算各的"。
def local_utc_offset_hours(at: datetime | None = None) -> float:
    ref = at or datetime.now()
    if ref.tzinfo is None:
        ref = ref.astimezone()
    return ref.utcoffset().total_seconds() / 3600.0


def to_utc_naive(dt: datetime) -> datetime:
    """把 datetime 归一化为 UTC 朴素时间。

    朴素输入按**本地时区**解释（这正是 ``datetime.now()`` 的语义），
    带时区输入直接换算。返回值与 SQLite ``CURRENT_TIMESTAMP`` 同格式，
    可以直接比较、可以进 ``ORDER BY``。
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.astimezone()          # 朴素 → 按本机时区解释，不猜
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def now_utc() -> datetime:
    """当前 UTC 朴素时间 —— **落库只准用这个**（与 CURRENT_TIMESTAMP 同基准）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def now_local() -> datetime:
    """当前本地时间 —— 只用于对外展示、日志人读，**不要落库**。"""
    return datetime.now()


def iso_local(value: datetime | str | None) -> str | None:
    """把库里的 UTC 值输出成带偏移的 ISO 8601（前端 ``new Date()`` 的朋友）。

    输入接受 ``datetime`` 或库里那种 ``YYYY-MM-DD HH:MM:SS[.ffffff]`` 字符串。
    解析不了就原样返回 —— 展示层不该因为一个坏值把整个响应搞崩。
    """
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            value = datetime.fromisoformat(s.replace('Z', '+00:00'))
        except ValueError:
            return value
    if value.tzinfo is None:
        # 库里的朴素值一律视为 UTC（见模块约定），补上 Z 再转本地
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone().isoformat(timespec='seconds')


def parse_db_time(value) -> datetime | None:
    """解析库里可能出现的时间字符串；解析不了返回 None（不要抛）。"""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    s = str(value).strip()
    for fmt in ('%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%d %H:%M:%S',
                '%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S'):
        try:
            return datetime.strptime(s[:26], fmt)
        except ValueError:
            continue
    return None


def shift_hours(value, hours: float) -> str | None:
    """把时间字符串整体平移若干小时（迁移脚本用），保留原格式精度。"""
    dt = parse_db_time(value)
    if dt is None:
        return None
    out = dt + timedelta(hours=hours)
    return out.strftime('%Y-%m-%d %H:%M:%S.%f') if dt.microsecond else out.strftime('%Y-%m-%d %H:%M:%S')
