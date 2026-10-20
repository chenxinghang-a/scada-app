"""把 electron-builder 构建失败详情发成 GitHub Actions annotation。

补充（2026-10-20）：`electron-build` 作业里还有一道**运行时闸门**
（`verify-packaged-runtime.js`：启动要发出去的那只 exe、CDP 探针断言 #app 挂载）。
它失败时 `electron-build.log` 是**成功的**，只发构建日志会把人带偏 ——
所以本脚本还会读 `packaged-runtime.log` 单独发一条 annotation，
两条分开，因为「装不出包」和「包装出来但打不开」是完全不同的故障。

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

#: 打包版运行时探针（第七道闸门）的输出。它失败时 electron-build.log 是**成功的**，
#: 只发构建日志会把人带偏 —— 2026-10-20 实测：该步骤偶发失败、重跑即绿，
#: 而注解里只有 electron-builder 的进度行，看不出探针卡在哪一步。
#: 该文件由 `tools/verify-packaged-runtime.js` 自己写（`.vitest_cache/` 已在 gitignore）。
RUNTIME_LOG = pathlib.Path('.vitest_cache') / 'packaged-runtime.log'

#: 单条 annotation 的字符上限（GitHub 侧还有更严格的总量限制，这里留足余量）
MAX_CHARS = 8000

#: 运行时探针的 annotation 上限（它按行输出结构化日志，尾部最有信息量）
RUNTIME_MAX_CHARS = 6000

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


def _escape(text: str) -> str:
    """GitHub annotation 转义：% → %25，换行 → %0A。"""
    return text.replace('%', '%25').replace('\r', '').replace('\n', '%0A')


def emit_runtime_annotation() -> bool:
    """把打包版运行时探针的输出发成独立 annotation（若该步骤跑过）。

    与构建日志分开两条 annotation，理由是**两者的失败含义完全不同**：
    构建失败 = 装不出包；运行时探针失败 = 包装出来了但用户打不开。
    混在一条里会让人以为是编译问题。

    Returns:
        bool: 是否真的发出了 annotation。
    """
    if not RUNTIME_LOG.exists():
        return False

    text = RUNTIME_LOG.read_text(encoding='utf-8', errors='replace')
    lines = [ln.rstrip() for ln in text.splitlines() if ln.strip()]
    if not lines:
        body = '(packaged-runtime.log 为空 —— 探针可能没启动起来)'
    else:
        # 探针每行都带 `[packaged-runtime]` 前缀，尾部几十行足够定位卡在哪：
        # 找不到 exe / 等不到调试端口 / 挂载超时 / 仪表盘导航失败 / 清理残留。
        body = '\n'.join(lines[-40:])

    print(f'::error title=打包版运行时验证失败::{_escape(body)[:RUNTIME_MAX_CHARS]}')
    return True


def main() -> int:
    emitted_runtime = emit_runtime_annotation()

    if not LOG.exists():
        if emitted_runtime:
            # 构建成功、只有运行时探针失败 —— 这是合法且重要的情形，不要报「找不到构建日志」
            return 0
        print(
            '::error title=electron-builder 失败::未找到 electron-build.log'
            '（构建步骤可能没跑到，或重定向未生效）'
        )
        return 0

    text = LOG.read_text(encoding='utf-8', errors='replace')
    body = '\n'.join(extract(text)) or '(electron-build.log 里没有筛出关键行)'

    print(f'::error title=electron-builder 失败关键行::{_escape(body)[:MAX_CHARS]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
