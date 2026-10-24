# 崩溃恢复演练（kill -9 → 重启 → 数丢失量）
#
# 为什么必须做：
#   "有 WAL 就不会丢数据" 是一句**信念**，不是证据。
#   证据是：强制杀进程前后各数一次，看差多少条。
#   没做过恢复演练的备份，等于没有备份；没被 kill -9 过的事务库，等于没验证过持久性。
#
# 做法：
#   1. 记录演练前的行数（history_data / realtime_data）
#   2. 让后端跑 T 秒，产生新数据，记录"应该写入"的量
#   3. taskkill /F（相当于拔电源，不给 Flask 任何清理机会）
#   4. 重启，等健康
#   5. 再数一次：丢了哪些、丢了多久（用 timestamp 断档判断）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File tools/crash-recovery-drill.ps1
#   -BackendExe <path>  -RunSeconds 30

param(
    [string]$BackendExe = "$env:LOCALAPPDATA\Programs\smartscada\resources\backend\scada-backend.exe",
    [int]$RunSeconds = 30,
    [string]$OutJson = "reports/crash-recovery.json"
)

$ErrorActionPreference = "Stop"
$backendDir = Split-Path $BackendExe -Parent
$dbCandidates = @(
    (Join-Path $backendDir "_internal\data\scada_simulated.db"),
    (Join-Path $backendDir "data\scada_simulated.db")
)
$db = $dbCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $db) { throw "找不到数据库：$($dbCandidates -join ', ')" }

function Get-TableCount([string]$table) {
    # 用 System.Data.SQLite 不一定装了，改用 python（项目 venv 自带）
    $py = "C:\Users\cxx\.workbuddy\binaries\python\envs\scada\Scripts\python.exe"
    if (-not (Test-Path $py)) { $py = "python" }
    $code = "import sqlite3,sys;c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);" +
            "print(c.execute('SELECT COUNT(*) FROM $table').fetchone()[0]);c.close()"
    return [int](& $py -c $code $db)
}

function Get-MaxTimestamp {
    $py = "C:\Users\cxx\.workbuddy\binaries\python\envs\scada\Scripts\python.exe"
    if (-not (Test-Path $py)) { $py = "python" }
    $code = "import sqlite3,sys;c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);" +
            "r=c.execute('SELECT MAX(timestamp) FROM history_data').fetchone();print(r[0] or '');c.close()"
    return (& $py -c $code $db)
}

function Wait-Healthy([int]$timeoutSec = 60) {
    for ($i = 0; $i -lt $timeoutSec; $i++) {
        try {
            $r = Invoke-WebRequest -Uri "http://127.0.0.1:5000/api/health/status" -TimeoutSec 2 -UseBasicParsing
            if ($r.StatusCode -eq 200) { return $true }
        } catch { }
        Start-Sleep -Seconds 1
    }
    return $false
}

Write-Host "=" * 62
Write-Host " 崩溃恢复演练（kill -9）"
Write-Host "=" * 62
Write-Host "后端: $BackendExe"
Write-Host "数据库: $db"
Write-Host ""

# 清理遗留进程
Get-Process scada-backend -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$before = @{
    history = Get-TableCount "history_data"
    realtime = Get-TableCount "realtime_data"
    maxTs = Get-MaxTimestamp
}
Write-Host "[1/5] 演练前: history=$($before.history)  realtime=$($before.realtime)"
Write-Host "      最新时间戳: $($before.maxTs)"

Write-Host "[2/5] 启动后端，跑 $RunSeconds 秒产生新数据 ..."
$proc = Start-Process -FilePath $BackendExe -WorkingDirectory $backendDir -PassThru
if (-not (Wait-Healthy)) { throw "后端没有在 60 秒内变健康，无法继续" }
$t0 = Get-Date
Start-Sleep -Seconds $RunSeconds
$t1 = Get-Date
Write-Host "      运行时长 $([math]::Round(($t1-$t0).TotalSeconds,1))s"

$during = @{
    history = Get-TableCount "history_data"
    realtime = Get-TableCount "realtime_data"
}
Write-Host "[3/5] kill -9 前: history=$($during.history)（新增 $($during.history - $before.history) 条）"

Write-Host "[4/5] 强杀进程（taskkill /F，不给任何清理机会）..."
taskkill /F /PID $proc.Id /T 2>&1 | Out-Null
Start-Sleep -Seconds 3
$stillUp = Get-Process scada-backend -ErrorAction SilentlyContinue
if ($stillUp) { $stillUp | Stop-Process -Force; Start-Sleep -Seconds 2 }
Write-Host "      进程已终止"

$afterKill = @{
    history = Get-TableCount "history_data"
}
Write-Host "[5/5] 重启并复查 ..."
$proc2 = Start-Process -FilePath $BackendExe -WorkingDirectory $backendDir -PassThru
$ok = Wait-Healthy
$afterRestart = @{
    history = Get-TableCount "history_data"
    realtime = Get-TableCount "realtime_data"
    maxTs = Get-MaxTimestamp
}

$result = [ordered]@{
    generated_at = (Get-Date).ToString("s")
    backend = $BackendExe
    db = $db
    run_seconds = $RunSeconds
    before = $before
    before_kill = $during
    after_kill = $afterKill
    after_restart = $afterRestart
    healthy_after_restart = $ok
    lost_rows_on_restart = [math]::Max(0, $during.history - $afterRestart.history)
    written_during_run = [math]::Max(0, $during.history - $before.history)
    verdict = ""
}

# 判定：重启后行数不应少于强杀前（WAL 应已落盘）
if ($result.lost_rows_on_restart -eq 0 -and $ok) {
    $result.verdict = "PASS：强杀后重启，已写入的数据一条不少，服务自愈"
} elseif ($result.lost_rows_on_restart -gt 0) {
    $result.verdict = "FAIL：重启后少了 $($result.lost_rows_on_restart) 条，WAL 未完整恢复"
} else {
    $result.verdict = "WARN：数据没丢，但重启后服务未在 60 秒内变健康"
}

Write-Host ""
Write-Host "=" * 62
Write-Host "结果"
Write-Host "=" * 62
Write-Host "运行期间写入:        $($result.written_during_run) 条"
Write-Host "强杀前总行数:        $($during.history)"
Write-Host "重启后总行数:        $($afterRestart.history)"
Write-Host "重启后丢失:          $($result.lost_rows_on_restart) 条"
Write-Host "重启后健康:          $ok"
Write-Host "最新时间戳(前/后):   $($before.maxTs)  →  $($afterRestart.maxTs)"
Write-Host ""
Write-Host "判定: $($result.verdict)"

$dir = Split-Path $OutJson -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$result | ConvertTo-Json -Depth 5 | Set-Content -Path $OutJson -Encoding UTF8
Write-Host "JSON 已写入 $OutJson"

# 收尾：把重启的后端留着跑，别让用户下次打不开
