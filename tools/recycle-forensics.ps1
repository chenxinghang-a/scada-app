# recycle-forensics.ps1 -- Identify the SOURCE of recycle-bin writes on this box.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File recycle-forensics.ps1 [-Top 15]
#
# Why: on this machine, deletions performed by the AI environments are routinely
#      redirected INTO the recycle bin ("trash-first" / batch-delete protection).
#      When the bin keeps refilling, this script tells you WHERE the deletions come
#      from -- in ~60 seconds -- by parsing $I metadata (original paths).
#
# NOTE (bash trap, verified 2026-10-14): Git Bash CANNOT read C:\$Recycle.Bin --
#      it silently resolves to "No such file or directory", so `ls | wc -l` in
#      bash FALSELY reports 0.  ALWAYS inspect the bin via this script/PowerShell.
#
# Method: $I format -- [0..8) header, [8..16) size, [16..24) FILETIME,
#         [24..28) name length in chars, [28..) UTF-16LE original path.
#         (Verified 2026-10-14: located the pytest tmp writers this way.)
#
# Read-only. Prints newest entries + an aggregate by directory prefix.
param([int]$Top = 15)

$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$buckets = @()
foreach ($d in @('C:', 'D:')) {
    $b = Join-Path ($d + '\$Recycle.Bin') $sid
    if (Test-Path -LiteralPath $b) { $buckets += $b }
}
if ($buckets.Count -eq 0) { Write-Host 'No recycle-bin buckets found.'; exit 0 }

function Get-BinPath([string]$iFile) {
    try {
        $bytes = [System.IO.File]::ReadAllBytes($iFile)
        if ($bytes.Length -lt 28) { return $null }
        $nlen = [BitConverter]::ToUInt32($bytes, 24)
        if ($nlen -le 0 -or $nlen -gt 32767) { return $null }
        return [System.Text.Encoding]::Unicode.GetString($bytes, 28, $nlen * 2).TrimEnd([char]0)
    } catch { return $null }
}

foreach ($b in $buckets) {
    Write-Host ("=== bucket: " + $b + " ===")
    $all = @(Get-ChildItem -LiteralPath $b -Force -ErrorAction SilentlyContinue |
             Where-Object { $_.Name.StartsWith('$I') -and $_.Name -ne 'desktop.ini' } |
             Sort-Object LastWriteTime -Descending)
    Write-Host ("total `$I entries: " + $all.Count)
    if ($all.Count -eq 0) { continue }

    Write-Host ("--- newest " + $Top + " (delete-time | original path) ---")
    $sample = @($all | Select-Object -First ([Math]::Max($Top, 200)))
    $prefixes = @{}
    $shown = 0
    foreach ($it in $sample) {
        $p = Get-BinPath $it.FullName
        if (-not $p) { continue }
        try {
            $ts = [BitConverter]::ToInt64([System.IO.File]::ReadAllBytes($it.FullName), 16)
            $dt = [DateTime]::FromFileTime($ts).ToString('HH:mm:ss')
        } catch { $dt = '??:??:??' }
        if ($shown -lt $Top) {
            Write-Host ($dt + ' | ' + $p)
            $shown++
        }
        # aggregate by first 4 path components (drive + 3 dirs)
        $parts = $p -split '\\'
        $key = ($parts | Select-Object -First 4) -join '\'
        if (-not $prefixes.ContainsKey($key)) { $prefixes[$key] = 0 }
        $prefixes[$key]++
    }
    Write-Host '--- top directory prefixes in sample ---'
    $prefixes.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 8 | ForEach-Object {
        Write-Host ('  ' + $_.Value.ToString().PadLeft(5) + '  ' + $_.Key)
    }
}
Write-Host 'done.'
