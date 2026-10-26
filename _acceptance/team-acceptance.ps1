<#
.SYNOPSIS
  团队管理（cam 域 v2.6 收口）可复跑验收。

.DESCRIPTION
  一条命令跑完四层门禁：
    1) typecheck（web + api）
    2) lint（团队页相关文件断言 0 error 0 warning）
    3) api 单测（team.spec：设置/统计/改名/批量分配/导出 + 原有成对记账与守恒）
    4) 真实浏览器 E2E（16 项断言：建团队/团队设置/分组统计/批量分配失败路径/流水导出空态）

  前置：
    pwsh _acceptance/start-local-stack.ps1      # PG 55432 / Redis 6380
    pwsh _acceptance/start-wanxing-stack.ps1    # api 3002 / web 3003

.EXAMPLE
  pwsh _acceptance/team-acceptance.ps1
  pwsh _acceptance/team-acceptance.ps1 -SkipE2E     # 只跑静态门禁 + 单测
#>
param(
  [switch]$SkipE2E,
  [switch]$SkipLint
)

$ErrorActionPreference = "Stop"
$Root = "E:\wanxing"
$App = Join-Path $Root "app"
$results = [ordered]@{}

function Step([string]$Name, [scriptblock]$Action) {
  Write-Host ""
  Write-Host "── $Name " -NoNewline -ForegroundColor Cyan
  Write-Host ("─" * [Math]::Max(0, 56 - $Name.Length)) -ForegroundColor DarkGray
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  & $Action
  $sw.Stop()
  $results[$Name] = "PASS ($([int]$sw.Elapsed.TotalSeconds)s)"
  Write-Host "   ✅ $Name PASS" -ForegroundColor Green
}

Step "前置：api:3002 在线" {
  $apiOk = $false
  try {
    $h = Invoke-WebRequest -Uri "http://127.0.0.1:3002/v1/healthz" -UseBasicParsing -TimeoutSec 10
    $apiOk = ($h.Content -match '"code":0')
  } catch {}
  if (-not $apiOk) { throw "api :3002 不可用。先跑 pwsh _acceptance/start-wanxing-stack.ps1" }
}

Step "typecheck（web + api）" {
  Push-Location $App
  try {
    & pnpm --filter @app/web typecheck 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "web typecheck 失败" }
    & pnpm --filter @app/api typecheck 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "api typecheck 失败" }
  } finally { Pop-Location }
}

if (-not $SkipLint) {
  Step "lint（团队页/团队模块文件必须 0 error 0 warning）" {
    Push-Location $App
    try {
      $out = & npx eslint apps/web/pages/team.vue apps/api/src/modules/team apps/api/src/storage/files.controller.ts 2>&1
      $code = $LASTEXITCODE
      $text = ($out | Out-String)
      if ($code -ne 0) { throw "eslint 非零退出：`n$text" }
      if ($text -match 'warning|error') { throw "团队相关文件存在 lint 告警：`n$text" }
    } finally { Pop-Location }
  }
}

Step "api 单测（team.spec 10 例）" {
  Push-Location $App
  try {
    $out = & pnpm --filter @app/api test -- team.spec 2>&1
    if ($LASTEXITCODE -ne 0) { throw "team.spec 单测失败" }
    $text = ($out | Out-String)
    if ($text -notmatch 'team\.spec\.ts \((\d+) tests?\)') { throw "未找到 team.spec 结果行" }
    if ($text -match 'failed') { throw "team.spec 有失败：`n$($text.Substring([Math]::Max(0,$text.Length-1500)))" }
  } finally { Pop-Location }
}

if (-not $SkipE2E) {
  # typecheck 内部会跑 `nuxt prepare`，它重写 .nuxt，而 nuxt dev 正从 .nuxt 提供服务
  # → dev server 被打坏（页面只剩空壳），E2E 会看到白屏。跑 E2E 前必须重启 web dev。
  Step "重启 web dev（干净 .nuxt）" {
    $p = (Get-NetTCPConnection -State Listen -LocalPort 3003 -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
    if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
    Remove-Item -Recurse -Force (Join-Path $App "apps\web\.nuxt") -ErrorAction SilentlyContinue

    $env:NUXT_API_PROXY = "http://127.0.0.1:3002"
    $env:PORT = "3003"
    Start-Process -FilePath "cmd.exe" `
      -ArgumentList "/c node ./node_modules/nuxt/bin/nuxt.mjs dev --port 3003 --host 127.0.0.1 > `"$Root\_acceptance\web-e2e.log`" 2>&1" `
      -WorkingDirectory (Join-Path $App "apps\web") `
      -WindowStyle Hidden | Out-Null

    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Seconds 2
      if (-not (Get-NetTCPConnection -State Listen -LocalPort 3003 -ErrorAction SilentlyContinue)) { continue }
      try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:3003/team" -UseBasicParsing -TimeoutSec 15
        if ($r.StatusCode -eq 200) {
          Start-Sleep -Seconds 6
          $r2 = Invoke-WebRequest -Uri "http://127.0.0.1:3003/team" -UseBasicParsing -TimeoutSec 15
          if ($r2.StatusCode -eq 200) { $ready = $true; break }
        }
      } catch {}
    }
    if (-not $ready) { throw "web dev 重启后未就绪，见 _acceptance/web-e2e.log" }
  }

  Step "浏览器 E2E（16 项断言，团队设置/分组统计/批量分配/导出）" {
    Push-Location (Join-Path $Root "_acceptance")
    try {
      & node e2e-team.cjs
      if ($LASTEXITCODE -ne 0) { throw "E2E 失败（见上方输出与 _acceptance/team-e2e/）" }
    } finally { Pop-Location }
  }
}

Write-Host ""
Write-Host ("═" * 60) -ForegroundColor DarkGray
Write-Host "团队管理验收汇总" -ForegroundColor Cyan
Write-Host ("═" * 60) -ForegroundColor DarkGray
foreach ($k in $results.Keys) {
  Write-Host ("  {0,-46} {1}" -f $k, $results[$k])
}
Write-Host ""
Write-Host "产物：_acceptance/team-e2e/（截图 + result.json）" -ForegroundColor DarkGray
Write-Host "✅ 团队管理验收全部通过" -ForegroundColor Green

