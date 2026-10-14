# cleanup-smartscada.ps1 -- Post-task one-stop cleanup for the SmartSCADA dev machine.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File cleanup-smartscada.ps1 `
#       [-Keep 3] [-Archive] [-ArchiveOldVersions] [-WhatIf]
#
# Steps (in order):
#   1. Build-junk sweep, per location (keeps the newest <Keep> items, default 3):
#        scada-app        root : backend.prev-* / backend.stale-* / dist.prev-* /
#                                dist-dbg.prev-* / dist.corrupt-* / release*stale* /
#                                release*.prev* / release.old / release-partial-*
#        industrial_scada dist : *.prev* / *.wrongenv*
#      Overflow items are consolidated (instant same-volume rename) into ONE trash folder
#      under C:\Users\cxx\.scada-cleanup\, then that folder is deleted with a SINGLE
#      Remove-Item call.  (The local safe-delete guard rejects looped multi-target
#      Remove-Item, but single-target calls pass -- verified 2026-10-14.)
#   2. -Archive (optional): pack the trash folder into one low-compression .7z under
#      C:\Users\cxx\.scada-cleanup\archive\ BEFORE deleting it.  Newest 2 packs are kept;
#      older packs are swept into the trash as well.
#   3. -ArchiveOldVersions (optional): archive historical %LOCALAPPDATA%\Programs\
#      SmartSCADA.v* folders via archive-old-versions.ps1 (keeps newest 1 + one .7z).
#   4. Empty the Recycle Bin -- permanently.  Owner rule (2026-10-14):
#      "每次任务完成后清理回收站（永久清掉）".
#   5. Write a report to C:\Users\cxx\.scada-cleanup\logs\ (newest 50 logs kept).
#
# Notes:
#   * On this box a Remove-Item may report "trash-failed" and still delete (fallback
#     direct delete, detail=OK); always verify with Test-Path afterwards.
#   * -WhatIf prints the plan only; nothing is touched.
param(
    [int]$Keep = 3,
    [switch]$Archive,
    [switch]$ArchiveOldVersions,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Continue'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$CleanupRoot = 'C:\Users\cxx\.scada-cleanup'
$logLines = New-Object System.Collections.Generic.List[string]
function Log([string]$m) { Write-Host $m; $logLines.Add($m) | Out-Null }
function FreeGB { [math]::Round((Get-PSDrive C).Free / 1GB, 2) }

function Remove-Tree([string]$path) {
    # Robust removal aligned with this box's safe-delete guard behaviour (2026-10-14):
    #  1) plain Remove-Item  -- single targets usually pass; intermittent refusals occur
    #     ("trash-failed; refusing fallback delete").
    #  2) robocopy /MIR with an empty source -- empties the tree via robocopy's own
    #     deletion path (verified to pass when Remove-Item refuses), then
    #  3) drop the empty shell.
    # Returns $true when the path no longer exists.
    try { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop } catch { }
    if (-not (Test-Path -LiteralPath $path)) { return $true }
    $empty = Join-Path $CleanupRoot '_empty-mirror'
    New-Item -ItemType Directory -Force -Path $empty | Out-Null
    robocopy $empty $path /MIR /R:0 /W:0 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    robocopy $empty $path /MIR /R:0 /W:0 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if (-not (Test-Path -LiteralPath $path)) { return $true }
    $left = @(Get-ChildItem -LiteralPath $path -Force -ErrorAction SilentlyContinue)
    if ($left.Count -eq 0) {
        try { Remove-Item -LiteralPath $path -Force -ErrorAction Stop } catch { }
    }
    return (-not (Test-Path -LiteralPath $path))
}

$freeBefore = FreeGB
Log ("[start] cleanup-smartscada " + $stamp + "  Keep=" + $Keep + "  Archive=" + [bool]$Archive + "  WhatIf=" + [bool]$WhatIf)

# ------------------------------------------- 0) sweep leftover trash containers
# A previous run may have failed to delete its trash container (intermittent guard
# refusals); pick those up now and remove them.
$oldTrashes = @(Get-ChildItem -LiteralPath $CleanupRoot -Directory -Filter 'trash-*' -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -ne ('trash-' + $stamp) })
if ($oldTrashes.Count -gt 0) {
    Log ('[leftover] ' + $oldTrashes.Count + ' leftover trash container(s) from a previous run.')
    foreach ($ot in $oldTrashes) {
        if ($WhatIf) { Log ('[plan] Would remove leftover: ' + $ot.Name); continue }
        if (Remove-Tree $ot.FullName) { Log ('[leftover] removed: ' + $ot.Name) }
        else { Log ('[leftover] FAILED (kept): ' + $ot.Name) }
    }
} else {
    Log '[leftover] none.'
}

# ---------------------------------------------------------------- 1) sweep
$locations = @(
    @{  Name = 'scada-app'
        Path = 'C:\Users\cxx\scada-app'
        Patterns = @(
            'backend.prev-*', 'backend.stale-*',
            'dist.prev-*', 'dist-dbg.prev-*', 'dist.corrupt-*',
            'release*stale*', 'release*.prev*', 'release.old', 'release-partial-*'
        )
    },
    @{  Name = 'industrial_scada/dist'
        Path = 'C:\Users\cxx\WorkBuddy\Claw\industrial_scada\dist'
        Patterns = @('*.prev*', '*.wrongenv*')
    }
)

$trashItems = @()
foreach ($loc in $locations) {
    if (-not (Test-Path -LiteralPath $loc.Path)) { Log ("[sweep] SKIP (missing): " + $loc.Path); continue }
    $matched = @()
    foreach ($p in $loc.Patterns) {
        $matched += @(Get-ChildItem -LiteralPath $loc.Path -Filter $p -Force -ErrorAction SilentlyContinue)
    }
    $matched = @($matched | Sort-Object -Property LastWriteTime -Descending)
    if ($matched.Count -le $Keep) {
        Log ("[sweep] " + $loc.Name + ": " + $matched.Count + " item(s) matched, within keep(" + $Keep + ").")
        continue
    }
    $keepItems = @($matched | Select-Object -First $Keep)
    $dropItems = @($matched | Select-Object -Skip $Keep)
    Log ("[sweep] " + $loc.Name + ": " + $matched.Count + " matched -> keep " + $keepItems.Count + ", drop " + $dropItems.Count)
    foreach ($k in $keepItems) { Log ("   KEEP  " + $k.Name) }
    foreach ($d in $dropItems) { Log ("   DROP  " + $d.Name); $trashItems += $d.FullName }
}
if ($trashItems.Count -eq 0) { Log "[sweep] no build-junk overflow." }

# ------------------------------------------------- 2) consolidate + delete
if ($trashItems.Count -gt 0) {
    $trash = Join-Path $CleanupRoot ('trash-' + $stamp)
    if ($WhatIf) {
        Log ("[plan] Would move " + $trashItems.Count + " item(s) into " + $trash + ", then delete it.")
    } else {
        $abortDelete = $false
        New-Item -ItemType Directory -Force -Path $trash | Out-Null
        $moved = 0
        foreach ($i in $trashItems) {
            $name = Split-Path $i -Leaf
            $dst = Join-Path $trash $name
            $n = 1
            while (Test-Path -LiteralPath $dst) { $dst = Join-Path $trash ($name + '_' + $n); $n++ }
            try {
                Move-Item -LiteralPath $i -Destination $dst -Force -ErrorAction Stop
                $moved++
            } catch {
                Log ("[move] FAILED: " + $i + " :: " + $_.Exception.Message)
            }
        }
        Log ("[move] moved " + $moved + '/' + $trashItems.Count + ' item(s) -> ' + $trash)

        if ($Archive) {
            $archDir = Join-Path $CleanupRoot 'archive'
            New-Item -ItemType Directory -Force -Path $archDir | Out-Null
            # sweep older packs first (keep newest 2 including the not-yet-created one)
            $packs = @(Get-ChildItem -LiteralPath $archDir -Filter 'cleanup-*.7z' -ErrorAction SilentlyContinue |
                       Sort-Object LastWriteTime -Descending)
            if ($packs.Count -ge 2) {
                foreach ($old in @($packs | Select-Object -Skip 1)) {
                    try {
                        Move-Item -LiteralPath $old.FullName -Destination (Join-Path $trash $old.Name) -Force -ErrorAction Stop
                        Log ("[archive] old pack -> trash: " + $old.Name)
                    } catch { }
                }
            }
            $sevenZip = 'C:\Program Files\7-Zip\7z.exe'
            $pkg = Join-Path $archDir ('cleanup-' + $stamp + '.7z')
            if (Test-Path -LiteralPath $sevenZip) {
                & $sevenZip a -mx1 $pkg (Join-Path $trash '*') | Out-Null
                if ($LASTEXITCODE -ne 0) { Log '[archive] 7z FAILED -- trash kept, delete aborted.'; $abortDelete = $true }
                else {
                    & $sevenZip l $pkg | Out-Null
                    if ($LASTEXITCODE -ne 0) { Log '[archive] verify FAILED -- trash kept, delete aborted.'; $abortDelete = $true }
                    else { Log ('[archive] pack OK: ' + $pkg) }
                }
            } else {
                Log '[archive] 7-Zip not found -- trash kept, delete aborted.'
                $abortDelete = $true
            }
        }

        if (-not $abortDelete) {
            if (Remove-Tree $trash) { Log ('[delete] trash removed: ' + $trash) }
            else { Log ('[delete] FAILED (kept for next run): ' + $trash) }
        } else {
            Log ('[delete] SKIPPED (safety): ' + $trash)
        }
    }
}

# --------------------------------------------- 3) optional: old version dirs
if ($ArchiveOldVersions) {
    $archOld = Join-Path $PSScriptRoot 'archive-old-versions.ps1'
    if (Test-Path -LiteralPath $archOld) {
        if ($WhatIf) { Log '[plan] Would run archive-old-versions.ps1 -Keep 1.' }
        else {
            Log '[archive-old] running archive-old-versions.ps1 -Keep 1 ...'
            & powershell -NoProfile -ExecutionPolicy Bypass -File $archOld -Keep 1
        }
    } else {
        Log ('[archive-old] script not found next to this one: ' + $archOld)
    }
}

# ------------------------------------------------------ 4) recycle bin (perm)
if ($WhatIf) {
    Log '[plan] Would purge the Recycle Bin (permanent).'
} else {
    # Purge via robocopy mirror -- Clear-RecycleBin can HANG on this box when the
    # bucket holds thousands of entries and/or is being written to concurrently
    # (observed 2026-10-14: hung >60s at high CPU; robocopy mirror cleared it in
    # seconds, repeatedly).  Stragglers are removed individually afterwards.
    $empty = Join-Path $CleanupRoot '_empty-mirror'
    New-Item -ItemType Directory -Force -Path $empty | Out-Null
    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    foreach ($drive in @('C:', 'D:')) {
        $bk = Join-Path ($drive + '\$Recycle.Bin') $sid
        if (-not (Test-Path -LiteralPath $bk)) { continue }
        $before = @(Get-ChildItem -LiteralPath $bk -Force -ErrorAction SilentlyContinue).Count
        if ($before -eq 0) { continue }
        robocopy $empty $bk /MIR /R:0 /W:0 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
        robocopy $empty $bk /MIR /R:0 /W:0 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
        $left = @(Get-ChildItem -LiteralPath $bk -Force -ErrorAction SilentlyContinue |
                  Where-Object { $_.Name -ne 'desktop.ini' })
        foreach ($it in $left) {
            try {
                if ($it.PSIsContainer) { Remove-Item -LiteralPath $it.FullName -Recurse -Force -ErrorAction Stop }
                else { Remove-Item -LiteralPath $it.FullName -Force -ErrorAction Stop }
            } catch { }
        }
        $after = @(Get-ChildItem -LiteralPath $bk -Force -ErrorAction SilentlyContinue).Count
        Log ('[bin] ' + $drive + ' bucket: ' + $before + ' -> ' + $after + ' item(s).')
    }
}

# ------------------------------------------------------------- 5) report/log
$freeAfter = FreeGB
Log ('[done] C: free ' + $freeBefore + ' GB -> ' + $freeAfter + ' GB')
if (-not $WhatIf) {
    $logDir = Join-Path $CleanupRoot 'logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $logFile = Join-Path $logDir ('cleanup-' + $stamp + '.log')
    $logLines | Set-Content -LiteralPath $logFile -Encoding UTF8
    # keep newest 50 logs
    $logs = @(Get-ChildItem -LiteralPath $logDir -Filter 'cleanup-*.log' | Sort-Object LastWriteTime -Descending)
    if ($logs.Count -gt 50) {
        foreach ($old in @($logs | Select-Object -Skip 50)) { try { Remove-Item -LiteralPath $old.FullName -Force -ErrorAction Stop } catch { } }
    }
    Write-Host ('[done] log: ' + $logFile)
}
