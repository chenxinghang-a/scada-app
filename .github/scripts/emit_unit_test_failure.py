"""把 `npm test` 的失败详情发成 GitHub Actions annotation。

为什么需要它
------------
2026-10-11 实测：`electron-build`（windows-latest）在步骤 12 `Unit tests` 连红 5 笔，
而 `build-and-test`（ubuntu）恒绿 —— 排查时**看不到是哪条用例挂了**：

- `GET /actions/jobs/{id}/logs` **需要管理员权限**，匿名/只读访问返回
  `403 Must have admin rights to Repository`；
- vitest 默认 reporter 把失败用例名折进汇总块，远端只看到一句 exit 1；
- 那次最终是靠**带 token 的 REST API** 才捞到确切用例名。

把测试输出落盘 + 筛关键行 + 发成 annotation，是唯一**公开可读**的通道
（`GET /repos/{owner}/{repo}/check-runs/{id}/annotations`），
这样"CI 为什么红"在远端能一眼看清，不用再靠猜或每次去换 token。

为什么要"筛关键行"而不是截末尾
------------------------------
vitest 的正常输出里也有大量 `✓ ...` 通过行；直接截末尾会把失败用例淹掉。
同时 GitHub 对单条 annotation 有长度限制，超长会被截断，反而丢掉错误信息。
"""

import pathlib
import re
import sys

LOG = pathlib.Path('unit-tests.log')

#: 单条 annotation 的字符上限（GitHub 侧还有更严格的总量限制，这里留足余量）
MAX_CHARS = 8000

#: 值得保留的行：失败用例、断言消息、汇总统计
_PATTERNS = (
    # vitest 的失败标记（verbose reporter 与默认 reporter 都会出现）
    re.compile(r'^\s*(×|✗|FAIL|❯)\s'),           # × 失败用例 / FAIL 文件 / ❯ 文件行
    re.compile(r'^\s*Failed Tests\b'),
    re.compile(r'^\s*Failed Suites\b'),
    re.compile(r'^\s*FAIL\b'),
    # 断言消息（vitest 用 → 引导）
    re.compile(r'^\s*→\s'),
    re.compile(r'AssertionError'),
    re.compile(r'\bexpected\b.*\bto be\b'),
    # 超时 / 进程异常 —— 本仓库历史假红的主要形状
    re.compile(r'Test timed out', re.I),
    re.compile(r'\bTimeout\b'),
    re.compile(r'Unhandled (Error|Rejection)'),
    # 汇总统计（行数能反映规模）
    re.compile(r'^\s*Tests\s+\d+\s+failed'),
    re.compile(r'^\s*Test Files\s+\d+\s+failed'),
    # 依赖/环境类
    re.compile(r'Cannot find module', re.I),
    re.compile(r'ERR_MODULE_NOT_FOUND'),
    re.compile(r'Error:'),
    # 中文报错（本项目脚本里有抛中文错误）
    re.compile(r'失败|错误|污染|超时'),
)


def extract(text: str) -> list[str]:
    """筛出有信息量的行；一条都没筛到时退回最后 60 行。"""
    lines = text.splitlines()
    picked = [ln for ln in lines if any(p.search(ln) for p in _PATTERNS)]

    # 去重但保持顺序
    seen: set[str] = set()
    unique = [ln.rstrip() for ln in picked if not (ln in seen or seen.add(ln))]

    result = unique[:120]
    if not result:
        # 完全没有关键行：说明失败方式超出预期，此时原始末尾就是唯一线索
        result = [ln.rstrip() for ln in lines[-60:]]
    return result


def main() -> int:
    if not LOG.exists():
        print(
            '::error title=单元测试失败::未找到 unit-tests.log'
            '（测试步骤可能没跑到，或重定向未生效）'
        )
        return 0

    text = LOG.read_text(encoding='utf-8', errors='replace')
    body = '\n'.join(extract(text)) or '(unit-tests.log 里没有筛出关键行)'

    # GitHub annotation 转义：% → %25，换行 → %0A
    escaped = body.replace('%', '%25').replace('\r', '').replace('\n', '%0A')

    print(f'::error title=单元测试失败关键行::{escaped[:MAX_CHARS]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
