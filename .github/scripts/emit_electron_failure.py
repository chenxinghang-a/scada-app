"""把 electron-builder 构建失败详情发成 GitHub Actions annotation。

为什么需要它
------------
与前端的 `build-and-test` 不同，`electron-build` 只在 **windows-latest** 上跑，
而失败发生在 `npx electron-builder --win` 这一步 —— 本机复现不了（本机能成功
产出 150 MB 的 NSIS 安装包），所以**只能靠远端日志定位**。

但远端日志恰恰拿不到：

- `GET /actions/jobs/{id}/logs` **需要仓库管理员权限**，只读访问返回
  `403 Must have admin rights to Repository`；
- `$GITHUB_STEP_SUMMARY` 不会出现在 check-runs API 的 `output.summary` 里；
- artifact 下载同样需要认证。

唯一**公开可读**的通道是 annotation：
`GET /repos/{owner}/{repo}/check-runs/{id}/annotations`

于是把构建输出落到文件、筛出关键行、发成 annotation —— 这样"CI 为什么红"
在远端也能查到，而不是只有一句 exit code 1。

为什么要"筛关键行"而不是截末尾
------------------------------
electron-builder 正常输出里也有大量 `• packaging` / `• building target=...`
这类进度行；直接截末尾会把真正的错误淹掉。同时 GitHub 对单条 annotation
有长度限制，超长会被截断，反而丢掉错误信息。
"""

import pathlib
import re
import sys

LOG = pathlib.Path('electron-build.log')

#: 单条 annotation 的字符上限（GitHub 侧还有更严格的总量限制，这里留足余量）
MAX_CHARS = 8000

#: 值得保留的行：错误信息 + electron-builder 的阶段行（用于定位卡在哪一步）
_PATTERNS = (
    # electron-builder / node 的错误
    re.compile(r'^\s*⨯'),                        # electron-builder 的错误标记
    re.compile(r'^\s*•\s*(packaging|building|signing|updating|loaded configuration)'),
    re.compile(r'\bError\b'),
    re.compile(r'\bERROR\b'),
    re.compile(r'ERR_[A-Z_]+'),                  # 如 ERR_ELECTRON_BUILDER_CANNOT_EXECUTE
    re.compile(r'exit code[: ]+\d+'),
    re.compile(r'command failed', re.I),
    re.compile(r'Cannot find', re.I),
    re.compile(r'ENOENT|EACCES|EPERM|EEXIST'),
    re.compile(r'file(s)? missing', re.I),
    re.compile(r'ENOSPC'),                       # runner 磁盘满
    # 常见 Windows / NSIS 专属失败
    re.compile(r'nsis', re.I),
    re.compile(r'signtool', re.I),
    re.compile(r'makensis', re.I),
    re.compile(r'failed to', re.I),
    # 中文报错（本项目脚本里有抛中文错误）
    re.compile(r'失败|错误|缺失|无法'),
    # node 堆栈
    re.compile(r'^\s+at\s+\S+'),                 # 栈帧
    re.compile(r'^Traceback \(most recent call last\)'),
)


def extract(text: str) -> list[str]:
    """筛出有信息量的行；一条都没筛到时退回最后 40 行。"""
    lines = text.splitlines()
    picked = [ln for ln in lines if any(p.search(ln) for p in _PATTERNS)]

    # 去重但保持顺序
    seen: set[str] = set()
    unique = [ln.rstrip() for ln in picked if not (ln in seen or seen.add(ln))]

    result = unique[:80]
    if not result:
        # 完全没有关键行：说明失败方式超出预期，此时原始末尾就是唯一线索
        result = [ln.rstrip() for ln in lines[-40:]]
    else:
        # 补上原始末尾做兜底（真正的错误常紧跟在最后一行）
        for ln in lines[-15:]:
            ln = ln.rstrip()
            if ln and ln not in result:
                result.append(ln)
    return result


def main() -> int:
    if not LOG.exists():
        print(
            '::error title=electron-builder 失败::未找到 electron-build.log'
            '（构建步骤可能没跑到，或重定向未生效）'
        )
        return 0

    text = LOG.read_text(encoding='utf-8', errors='replace')
    body = '\n'.join(extract(text)) or '(electron-build.log 里没有筛出关键行)'

    # GitHub annotation 转义：% → %25，换行 → %0A
    escaped = body.replace('%', '%25').replace('\r', '').replace('\n', '%0A')

    print(f'::error title=electron-builder 失败关键行::{escaped[:MAX_CHARS]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
