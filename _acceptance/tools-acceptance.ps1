<#
.SYNOPSIS
  工具箱（`/tools` + `/create/*` 单点工具）前端可复跑验收。

.DESCRIPTION
  一条命令跑完四层门禁：
    1) typecheck（web + api）
    2) lint（工具箱/工具页相关文件断言 0 error 0 warning）
    3) model-adapters 单测（mock 结果形状：图像 png / 视频 mp4 / 文本同步）
    4) 真实浏览器 E2E（20 项断言：Tab 文案/卡片集/文生图/图生图/参考生视频）

  前置：
    pwsh _acceptance/start-local-stack.ps1      # PG 55432 / Redis 6380
    pwsh _acceptance/start-wanxing-stack.ps1    # api 3002 / web 3003

.EXAMPLE
  pwsh _acceptance/tools-acceptance.ps1
  pwsh _acceptance/tools-acceptance.ps1 -SkipE2E     # 只跑静态门禁 + 单测
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

# ── 1. typecheck ─────────────────────────────────────────
Step "typecheck（web + api）" {
  Push-Location $App
  try {
    & pnpm --filter @app/web typecheck 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "web typecheck 失败" }
    & pnpm --filter @app/api typecheck 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "api typecheck 失败" }
  } finally { Pop-Location }
}

# ── 2. lint（只断言本次改动的文件）─────────────────────────
if (-not $SkipLint) {
  Step "lint（工具箱/工具页文件必须 0 error 0 warning）" {
    Push-Location $App
    try {
      $out = & npx eslint apps/web/pages/tools.vue apps/web/pages/create apps/web/components/ImageGenWorkspace.vue apps/web/components/VideoGenWorkspace.vue apps/web/nuxt.config.ts 2>&1
      $code = $LASTEXITCODE
      $text = ($out | Out-String)
      if ($code -ne 0) { throw "eslint 非零退出：`n$text" }
      if ($text -match 'warning|error') { throw "工具页相关文件存在 lint 告警：`n$text" }
    } finally { Pop-Location }
  }
}

# ── 3. model-adapters 单测（mock 形状）────────────────────
Step "model-adapters 单测（mock 形状与同步文本分支）" {
  Push-Location $App
  try {
    $out = & pnpm --filter @app/model-adapters test 2>&1
    if ($LASTEXITCODE -ne 0) { throw "model-adapters 单测失败" }
    $text = ($out | Out-String)
    if ($text -notmatch 'adapters\.spec\.ts \((\d+) tests?\)') { throw "未找到 adapters.spec 结果行" }
    if ($text -match 'failed') { throw "model-adapters 单测有失败：`n$($text.Substring([Math]::Max(0,$text.Length-1200)))" }
  } finally { Pop-Location }
}

# ── 4. 浏览器 E2E ────────────────────────────────────────
if (-not $SkipE2E) {
  # typecheck 内部会跑 `nuxt prepare`，它重写 .nuxt，而 nuxt dev 正从 .nuxt 提供服务
  # → dev server 被打坏（`#app-manifest` 解析失败、页面只剩 356 字节的空壳），
  # E2E 会看到"页面白屏"。所以跑 E2E 前必须重启 web dev（与 canvas 验收同一个坑）。
  Step "重启 web dev（干净 .nuxt）" {
    $p = (Get-NetTCPConnection -State Listen -LocalPort 3003 -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
    if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
    Remove-Item -Recurse -Force (Join-Path $App "apps\web\.nuxt") -ErrorAction SilentlyContinue

    $env:NUXT_API_PROXY = "http://127.0.0.1:3002"
    $env:PORT = "3003"
    # 长寿进程必须完全脱离本进程的 stdout 管道（UseShellExecute=$true），
    # 否则外层调用会一直等 EOF（canvas 验收已踩过，卡死 10 分钟）。
    Start-Process -FilePath "cmd.exe" `
      -ArgumentList "/c node ./node_modules/nuxt/bin/nuxt.mjs dev --port 3003 --host 127.0.0.1 > `"$Root\_acceptance\web-e2e.log`" 2>&1" `
      -WorkingDirectory (Join-Path $App "apps\web") `
      -WindowStyle Hidden | Out-Null

    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Seconds 2
      if (-not (Get-NetTCPConnection -State Listen -LocalPort 3003 -ErrorAction SilentlyContinue)) { continue }
      try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:3003/tools" -UseBasicParsing -TimeoutSec 15
        if ($r.StatusCode -eq 200) {
          Start-Sleep -Seconds 6
          $r2 = Invoke-WebRequest -Uri "http://127.0.0.1:3003/tools" -UseBasicParsing -TimeoutSec 15
          if ($r2.StatusCode -eq 200) { $ready = $true; break }
        }
      } catch {}
    }
    if (-not $ready) { throw "web dev 重启后未就绪，见 _acceptance/web-e2e.log" }
  }

  Step "浏览器 E2E（20 项断言，含 Tab/卡片集/文生图/图生图/参考生视频）" {
    Push-Location (Join-Path $Root "_acceptance")
    try {
      & node e2e-tools.cjs
      if ($LASTEXITCODE -ne 0) { throw "E2E 失败（见上方输出与 _acceptance/tools-e2e/）" }
    } finally { Pop-Location }
  }
}

# ── 汇总 ─────────────────────────────────────────────────
Write-Host ""
Write-Host ("═" * 60) -ForegroundColor DarkGray
Write-Host "工具箱验收汇总" -ForegroundColor Cyan
Write-Host ("═" * 60) -ForegroundColor DarkGray
foreach ($k in $results.Keys) {
  Write-Host ("  {0,-46} {1}" -f $k, $results[$k])
}
Write-Host ""
Write-Host "产物：_acceptance/tools-e2e/（截图 + result.json）" -ForegroundColor DarkGray
Write-Host "✅ 工具箱验收全部通过" -ForegroundColor Green
