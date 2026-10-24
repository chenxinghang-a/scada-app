#!/usr/bin/env bash
# 崩溃恢复演练（kill -9 → 重启 → 数丢失量）
#
# 为什么必须做：
#   "有 WAL 就不会丢数据" 是一句信念，不是证据。
#   证据是：强制杀进程前后各数一次，看差多少条。
#
# 为什么用 bash 而不是 .ps1：
#   Windows PowerShell 5.1 按 ANSI(GBK) 读 .ps1，UTF-8 中文注释会解析成乱码并报语法错误。
#   这个脚本只需要 bash + python + taskkill，Git Bash 就能跑。
#
# 用法：
#   bash tools/crash-recovery-drill.sh [后端exe路径] [运行秒数]
# 产物：reports/crash-recovery.json
set -u

EXE="${1:-C:/Users/cxx/AppData/Local/Programs/smartscada/resources/backend/scada-backend.exe}"
RUN_SECONDS="${2:-25}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$DIR/reports/crash-recovery.json"
PY="C:/Users/cxx/.workbuddy/binaries/python/envs/scada/Scripts/python.exe"
[ -x "$PY" ] || PY="python"

BACKEND_DIR="$(dirname "$EXE")"
DB=""
for cand in "$BACKEND_DIR/_internal/data/scada_simulated.db" "$BACKEND_DIR/data/scada_simulated.db"; do
  [ -f "$cand" ] && DB="$cand" && break
done
[ -n "$DB" ] || { echo "找不到数据库（找过 $BACKEND_DIR/_internal/data 和 /data）"; exit 2; }

count() {  # $1=table
  "$PY" -c "import sqlite3,sys;c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);print(c.execute('SELECT COUNT(*) FROM '+sys.argv[2]).fetchone()[0]);c.close()" "$DB" "$1" 2>/dev/null || echo 0
}
maxts() {
  "$PY" -c "import sqlite3,sys;c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);r=c.execute('SELECT MAX(timestamp) FROM history_data').fetchone();print(r[0] or '');c.close()" "$DB" 2>/dev/null || echo ""
}
wait_healthy() {
  for _ in $(seq 1 60); do
    curl -s -m 2 -o /dev/null "http://127.0.0.1:5000/api/health/status" && return 0
    sleep 1
  done
  return 1
}

echo "============================================================"
echo " 崩溃恢复演练（kill -9）"
echo "============================================================"
echo "后端: $EXE"
echo "库:   $DB"
echo

# 清场
PID=$(netstat -ano | grep "127.0.0.1:5000" | grep LISTEN | awk '{print $5}' | head -1)
[ -n "$PID" ] && taskkill //F //PID "$PID" >/dev/null 2>&1
sleep 2

B_HIST=$(count history_data); B_RT=$(count realtime_data); B_TS=$(maxts)
echo "[1/5] 演练前: history=$B_HIST  realtime=$B_RT"
echo "      最新时间戳: $B_TS"

echo "[2/5] 启动后端，跑 ${RUN_SECONDS}s 产生新数据 ..."
( cd "$BACKEND_DIR" && ./"$(basename "$EXE")" > /tmp/crash-drill-run.log 2>&1 ) &
if ! wait_healthy; then echo "后端未在 60s 内变健康，中止"; exit 3; fi
sleep "$RUN_SECONDS"

D_HIST=$(count history_data); D_RT=$(count realtime_data)
echo "[3/5] kill 前: history=$D_HIST（新增 $((D_HIST - B_HIST)) 条）"

PID=$(netstat -ano | grep "127.0.0.1:5000" | grep LISTEN | awk '{print $5}' | head -1)
echo "[4/5] 强杀 PID=$PID（taskkill /F，不给清理机会）"
taskkill //F //PID "$PID" >/dev/null 2>&1
sleep 3
K_HIST=$(count history_data)
echo "      强杀后（未重启）: history=$K_HIST"

echo "[5/5] 重启并复查 ..."
( cd "$BACKEND_DIR" && ./"$(basename "$EXE")" > /tmp/crash-drill-restart.log 2>&1 ) &
OK=0; wait_healthy && OK=1
A_HIST=$(count history_data); A_RT=$(count realtime_data); A_TS=$(maxts)

LOST=$((D_HIST - A_HIST)); [ "$LOST" -lt 0 ] && LOST=0
if [ "$LOST" -eq 0 ] && [ "$OK" = 1 ]; then
  VERDICT="PASS：强杀后重启，已写入的数据一条不少，服务自愈"
elif [ "$LOST" -gt 0 ]; then
  VERDICT="FAIL：重启后少了 $LOST 条，WAL 未完整恢复"
else
  VERDICT="WARN：数据没丢，但重启后服务未在 60s 内变健康"
fi

echo
echo "============================================================"
echo "结果"
echo "============================================================"
echo "运行期间写入:   $((D_HIST - B_HIST)) 条"
echo "强杀前行数:     $D_HIST"
echo "强杀后行数:     $K_HIST   （比强杀前多 $((K_HIST - D_HIST)) 条 = 末批已提交 WAL）"
echo "重启后行数:     $A_HIST"
echo "重启后丢失:     $LOST 条"
echo "重启后健康:     $([ "$OK" = 1 ] && echo yes || echo no)"
echo "最新时间戳:     $B_TS → $A_TS"
echo
echo "判定: $VERDICT"

mkdir -p "$(dirname "$OUT")"
cat > "$OUT" <<EOF
{
  "generated_at": "$(date -Iseconds)",
  "backend": "$(echo "$EXE" | sed 's/\\/\\\\/g')",
  "db": "$(echo "$DB" | sed 's/\\/\\\\/g')",
  "run_seconds": $RUN_SECONDS,
  "before":        {"history": $B_HIST, "realtime": $B_RT, "max_timestamp": "$B_TS"},
  "after_run":     {"history": $D_HIST, "realtime": $D_RT},
  "after_kill":    {"history": $K_HIST},
  "after_restart": {"history": $A_HIST, "realtime": $A_RT, "max_timestamp": "$A_TS"},
  "written_during_run": $((D_HIST - B_HIST)),
  "lost_on_restart": $LOST,
  "healthy_after_restart": $([ "$OK" = 1 ] && echo true || echo false),
  "verdict": "$VERDICT"
}
EOF
echo
echo "JSON 已写入 reports/crash-recovery.json"
