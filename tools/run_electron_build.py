#!/usr/bin/env python3
"""在本机复现 CI 的 electron-builder 构建，带完整日志与超时兜底。

为什么需要这个脚本（而不是 shell 里直接跑）：
    Git Bash 里用 ``(cmd &)`` / ``nohup`` / ``Start-Process`` 起的常驻进程
    会被 WorkBuddy 的会话回收机制连带杀掉，表现为「日志空、进程没了、
    什么都没发生」。必须由**同一个 Python 进程**完成
    「Popen 启动 → 轮询存活 → 收尾杀进程树」，否则拿不到任何输出。

双时刻工作区断言（第八道闸门，2026-10-11 补）
--------------------------------------------
    本机构建与 CI 有一个本质差别：**CI 是全新 clone，本机的工作区是共享的**。
    2026-10-10 实测事故：本机跑 electron:build 期间，另一个 AI 会话往后端仓库
    落了 round 210 的改动 —— PyInstaller 收的是**工作区快照**、不是 git HEAD，
    于是「改了一半的源码」被冻结进产物，而七道闸门**全部放行**
    （它们只管产物内部的一致性，不管构建过程有没有被污染）。

    本脚本因此在构建前后各拍一次工作区指纹（复用 tools/verify-workspace-frozen.js）：
      * 构建**开始前**记录基线（``--pre``）；
      * 构建**结束后**比对（``--post``），不一致则**本次构建判负**（exit 3），
        并明确要求重新构建 —— 产物不可信，不要把它拿去部署。
      * 用 ``--no-freeze`` 可关掉（应急用；关掉时会在日志里显式留痕）。

用法：
    python tools/run_electron_build.py [--timeout 900] [--no-freeze]

退出码：0 成功，1 构建失败，2 超时，3 构建成功但工作区被污染（产物不可信）。
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG_PATH = ROOT / "electron-build-local.log"
FROZEN_SCRIPT = ROOT / "tools" / "verify-workspace-frozen.js"


def _frozen(phase: str) -> tuple[int, str]:
    """调用第八道闸门（双时刻工作区断言）。

    @param phase ``"pre"`` 或 ``"post"``
    @return ``(returncode, 输出文本)``
    """
    try:
        r = subprocess.run(
            ["node", str(FROZEN_SCRIPT), f"--{phase}"],
            capture_output=True,
            text=True,
            errors="replace",
            cwd=str(ROOT),
        )
    except Exception as e:  # node 不在 PATH / 脚本丢了
        return (127, f"无法执行 {FROZEN_SCRIPT}: {e}")
    return (r.returncode, (r.stdout or "") + (r.stderr or ""))


def _terminate_tree(proc: subprocess.Popen) -> None:
    """结束整个进程树。

    electron-builder 会派生 node 子进程，只 kill 父进程会留下孤儿 node，
    下次构建时与新进程抢 ``release/`` 目录，表现为随机卡死。
    ``/T`` 终止树，``/F`` 强制。
    """
    subprocess.run(
        ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
        capture_output=True,
        text=True,
        errors="replace",
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="本机跑 electron-builder 并完整留日志")
    ap.add_argument("--timeout", type=int, default=900, help="超时秒数（默认 900）")
    ap.add_argument("--extra-args", default="--win --publish never",
                    help="传给 electron-builder 的额外参数")
    ap.add_argument("--no-freeze", action="store_true",
                    help="跳过双时刻工作区断言（应急用；产物可信度自负）")
    args = ap.parse_args()

    print(f"[build] 工作目录: {ROOT}")
    print(f"[build] 日志文件: {LOG_PATH}")
    print(f"[build] 参数: {args.extra_args}")
    print(f"[build] 超时: {args.timeout}s", flush=True)

    # ---- 第八道闸门 · 时刻 ①：构建前拍基线 ----
    #
    # ⚠️ 必须在**启动 electron-builder 之前**、且在**同一进程**里做 —— 交给
    #    外层 shell 分两条命令跑的话，中间一旦有别的会话落盘就抓不到了。
    if args.no_freeze:
        print("[build] ⚠️ --no-freeze：跳过双时刻工作区断言（本次产物不校验构建窗口污染）",
              flush=True)
    else:
        rc_pre, out_pre = _frozen("pre")
        print(f"[build] [frozen/pre] {out_pre.strip()}", flush=True)
        if rc_pre != 0:
            print(f"[build] 基线记录失败（rc={rc_pre}）—— 不继续构建，避免产出无凭据的包", flush=True)
            return 1

    with open(LOG_PATH, "w", encoding="utf-8", errors="replace") as log:
        proc = subprocess.Popen(
            f"npx electron-builder {args.extra_args}",
            shell=True,
            stdout=log,
            stderr=subprocess.STDOUT,
            cwd=str(ROOT),
        )
        print(f"[build] PID={proc.pid}", flush=True)

        start = time.monotonic()
        timed_out = False
        while True:
            rc = proc.poll()
            if rc is not None:
                break
            elapsed = time.monotonic() - start
            if elapsed > args.timeout:
                timed_out = True
                break
            # 每 10 秒报一次进度：把日志末尾几行带出来，
            # 这样即使本次仍然卡住，也能看到"卡在哪一步"。
            if int(elapsed) % 10 < 1:
                tail = _tail(LOG_PATH, 3)
                print(f"[build] +{int(elapsed):4d}s | {tail}", flush=True)
            time.sleep(1)

        if timed_out:
            print(f"[build] 超时 {args.timeout}s，强制终止进程树", flush=True)
            _terminate_tree(proc)
            proc.wait(timeout=30)

    rc = proc.returncode
    elapsed = time.monotonic() - start
    print(f"\n[build] 结束: rc={rc} 用时={elapsed:.0f}s 超时={timed_out}")
    print("[build] === 日志末尾 40 行 ===")
    print(_tail(LOG_PATH, 40))

    if timed_out:
        return 2

    # ---- 第八道闸门 · 时刻 ②：构建后比对 ----
    #
    # 顺序很关键：**先比对、再返回**。哪怕构建失败（rc != 0）也要比对 ——
    # 「构建窗口内有人落盘」这件事与本次构建成不成功无关，
    # 而且失败时更需要知道是不是被污染干扰的。
    frozen_failed = False
    if not args.no_freeze:
        rc_post, out_post = _frozen("post")
        print(f"[build] [frozen/post] {out_post.strip()}", flush=True)
        if rc_post != 0:
            frozen_failed = True

    if rc != 0:
        return 1
    if frozen_failed:
        print(
            "[build] ❌ 构建产出了包，但**构建窗口内工作区被改动** —— 产物不可信，请勿部署。\n"
            "         两个仓库都冻结到干净状态后重新构建。",
            flush=True,
        )
        return 3
    return 0


def _tail(path: Path, n: int) -> str:
    """返回文件末尾 n 个非空行（用 utf-8 + replace 容错读取）。"""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return "(日志不可读)"
    lines = [ln for ln in text.splitlines() if ln.strip()]
    return " / ".join(lines[-n:]) if lines else "(日志暂无输出)"


if __name__ == "__main__":
    sys.exit(main())
