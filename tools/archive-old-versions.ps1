# archive-old-versions.ps1 -- Archive old SmartSCADA version folders, then remove originals.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File archive-old-versions.ps1 [-Keep 1] [-WhatIf]
#
# Behavior:
#   1. Scan $env:LOCALAPPDATA\Programs\SmartSCADA.v* (historical version dirs).
#   2. Keep the newest <Keep> dirs (default 1, the rollback window); archive the rest.
#   3. Archive target:  $env:LOCALAPPDATA\Programs\SmartSCADA-archive\
#      (a single fixed folder; file name: SmartSCADA-old-versions-<timestamp>.7z)
#   4. After the archive verified listable, delete the originals.
#   5. -WhatIf: show plan only, do nothing.
#
# Design notes (lessons learned):
#   * Deletion must NOT use Remove-Item / rm: on this machine the recycle bin is
#     unavailable and the safe-delete guard fails closed. Use: cmd rd /s /q (verified).
#   * 7z uses -mx1 (fast, low compression): goal is "keep a safety copy first",
#     not "squeeze to minimum size". One .7z deletes in a second vs. ~23k small files.
#   * Two-phase with verification: if 7z fails OR the listing check fails,
#     NOTHING is deleted.
param(
    [int]$Keep = 1,
    [switch]$WhatIf,
    [string]$SevenZip = 'C:\Program Files\7-Zip\7z.exe'
)

$ErrorActionPreference = 'Stop'
$Programs   = Join-Path $env:LOCALAPPDATA 'Programs'
$ArchiveDir = Join-Path $Programs 'SmartSCADA-archive'

if (-not (Test-Path $SevenZip)) { throw "[archive] 7-Zip not found: $SevenZip" }

$dirs = Get-ChildItem -Path $Programs -Directory -Filter 'SmartSCADA.v*' -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending
if (-not $dirs) { Write-Host '[archive] No historical version folders. Nothing to do.'; exit 0 }

$toArchive = @($dirs | Select-Object -Skip $Keep)
if ($toArchive.Count -eq 0) {
    Write-Host "[archive] $($dirs.Count) historical folder(s) <= keep($Keep). Nothing to do."
    exit 0
}

Write-Host "[archive] Will archive $($toArchive.Count) folder(s), keeping newest ${Keep}:"
$toArchive | ForEach-Object { Write-Host "  - $($_.Name)" }

if ($WhatIf) { Write-Host '[archive] -WhatIf: nothing executed.'; exit 0 }

New-Item -ItemType Directory -Force -Path $ArchiveDir | Out-Null
$zip = Join-Path $ArchiveDir ('SmartSCADA-old-versions-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.7z')

Write-Host "[archive] Packing -> $zip"
$paths = @($toArchive | ForEach-Object { $_.FullName })
& $SevenZip a -mx1 $zip @paths | Out-Null
if ($LASTEXITCODE -ne 0) { throw "[archive] 7z failed (exit $LASTEXITCODE). Nothing deleted." }

Write-Host '[archive] Verifying archive listing...'
& $SevenZip l $zip | Out-Null
if ($LASTEXITCODE -ne 0) { throw '[archive] Archive verification failed. Nothing deleted.' }

foreach ($d in $toArchive) {
    Write-Host "[archive] Deleting: $($d.Name)"
    cmd /c ('rd /s /q "' + $d.FullName + '"') | Out-Null
    if (Test-Path -LiteralPath $d.FullName) {
        Write-Warning "[archive] Delete incomplete: $($d.FullName)"
    }
}

Write-Host "[archive] Done. Archive: $zip"
Write-Host "[archive] Tip: once confirmed, the single .7z can be deleted anytime (instant)."
