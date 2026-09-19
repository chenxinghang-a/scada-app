#!/usr/bin/env python3
"""在本机复现 CI 的 electron-builder 构建，带完整日志与超时兜底。

为什么需要这个脚本（而不是 shell 里直接跑）：
    Git Bash 里用 ``(cmd &)`` / ``nohup`` / ``Start-Process`` 起的常驻进程
    会被 WorkBuddy 的会话回收机制连带杀掉，表现为「日志空、进程没了、
    什么都没发生」。必须由**同一个 Python 进程**完成
    「Popen 启动 → 轮询存活 → 收尾杀进程树」，否则拿不到任何输出。

用法：
    python tools/run_electron_build.py [--timeout 900]

退出码：0 成功，1 构建失败，2 超时。
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOG_PATH = ROOT / "electron-build-local.log"


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
    args = ap.parse_args()

    print(f"[build] 工作目录: {ROOT}")
    print(f"[build] 日志文件: {LOG_PATH}")
    print(f"[build] 参数: {args.extra_args}")
    print(f"[build] 超时: {args.timeout}s", flush=True)

    # 直写文件而不是管道：管道会被缓冲区吞掉输出，进程被杀时什么都留不下。
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
    return 0 if rc == 0 else 1


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
