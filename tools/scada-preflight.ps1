# scada-preflight.ps1 —— SCADA 开工实况核对（清单 P2-6「硬规则 14」落地）
#
# 用途：两个 AI 开工前 / 收尾时，一把核对两仓实况，避免"队列陈旧 4 次"那类问题。
# 特性：默认纯本地只读；-Online 时用 10808 代理核对远端 sha 一致性。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scada-preflight.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scada-preflight.ps1 -Online

param([switch]$Online)

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$repos = @(
    @{ name = '前端 scada-app';          path = 'C:\Users\cxx\scada-app' },
    @{ name = '后端 industrial_scada';   path = 'C:\Users\cxx\WorkBuddy\Claw\industrial_scada' }
)

Write-Host ('SCADA 开工实况核对  ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + $(if ($Online) { '  (含远端)' } else { '  (本地)' }))
Write-Host ('=' * 60)

foreach ($r in $repos) {
    Write-Host ('[' + $r.name + ']')
    if (-not (Test-Path -LiteralPath $r.path)) { Write-Host '  目录不存在'; Write-Host ''; continue }
    Push-Location $r.path
    try {
        $branch = (& git branch --show-current 2>$null) -join ''
        $headFull = (& git rev-parse HEAD 2>$null) -join ''
        $head = (& git log -1 --format='%h %s' 2>$null) -join ''
        $dirty = @(& git status --porcelain 2>$null)

        Write-Host ('  分支 : ' + $branch)
        Write-Host ('  HEAD : ' + $head)
        if ($dirty.Count -eq 0) {
            Write-Host '  工作区: 干净'
        } else {
            Write-Host ('  工作区: ' + $dirty.Count + ' 个未提交项')
            foreach ($d in $dirty) { Write-Host ('     ' + $d) }
        }

        $ab = (& git rev-list --left-right --count ("origin/" + $branch + "..." + $branch) 2>$null) -join ''
        if ($ab) { Write-Host ('  与 origin/' + $branch + ' (behind|ahead): ' + $ab) }

        if ($Online) {
            $remoteLine = (& git -c http.proxy=http://127.0.0.1:10808 -c https.proxy=http://127.0.0.1:10808 ls-remote origin $branch 2>$null) | Select-Object -First 1
            if ($remoteLine) {
                $remoteSha = ($remoteLine -split "`t")[0]
                Write-Host ('  远端 : ' + $remoteSha.Substring(0, [Math]::Min(12, $remoteSha.Length)))
                if ($remoteSha -eq $headFull) { Write-Host '  ✅ 远端与本地一致' }
                else { Write-Host '  ⚠️ 远端与本地不一致（需 fetch / push 处理）' }
            } else {
                Write-Host '  远端 : (获取失败——检查代理 10808)'
            }
        }
    } finally { Pop-Location }
    Write-Host ''
}

Write-Host '提示：开工先跑本工具；与消息桥最新 sha 口径对表（避免陈旧）。'
