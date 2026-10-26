<#
.SYNOPSIS
  启动 E:\wanxing 专属开发栈：api(3002) + web(3003)，指向本地 PG 55432 / Redis 6380。

.DESCRIPTION
  为什么不用 3000/3001：
  - 3000/3001 被另一个项目（E:\ecpm）的常驻进程占着，打进去会看到别人的 API；
  - 本项目 api 通过 `process.env` 读配置（不加载 .env 文件），必须显式注入。

  前置：`pwsh _acceptance/start-local-stack.ps1`（PG/Redis）。

.EXAMPLE
  pwsh _acceptance/start-wanxing-stack.ps1
  pwsh _acceptance/start-wanxing-stack.ps1 -Status
  pwsh _acceptance/start-wanxing-stack.ps1 -Stop
#>
param(
  [switch]$Status,
  [switch]$Stop,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = "E:\wanxing"
$App = Join-Path $Root "app"
$ApiPort = 3002
$WebPort = 3003
$ApiLog = Join-Path $Root "_acceptance\stack-api.log"
$ApiErr = Join-Path $Root "_acceptance\stack-api.err.log"
$WebLog = Join-Path $Root "_acceptance\stack-web.log"

function Test-Port([int]$Port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}
function Get-PortPid([int]$Port) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return $c.OwningProcess }
  return $null
}

if ($Status) {
  [ordered]@{
    api = if (Test-Port $ApiPort) { "up :$ApiPort (pid $(Get-PortPid $ApiPort))" } else { "DOWN :$ApiPort" }
    web = if (Test-Port $WebPort) { "up :$WebPort (pid $(Get-PortPid $WebPort))" } else { "DOWN :$WebPort" }
    pg  = if (Test-Port 55432) { "up :55432" } else { "DOWN :55432" }
    redis = if (Test-Port 6380) { "up :6380" } else { "DOWN :6380" }
  } | ConvertTo-Json
  exit 0
}

if ($Stop) {
  foreach ($port in @($ApiPort, $WebPort)) {
    $procId = Get-PortPid $port
    if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; Write-Output "stopped :$port (pid $procId)" }
  }
  exit 0
}

# ── 依赖检查 ──────────────────────────────────────────────
if (-not (Test-Port 55432)) { throw "PostgreSQL 55432 未监听，先跑：pwsh _acceptance/start-local-stack.ps1" }
if (-not (Test-Port 6380)) { throw "Redis 6380 未监听，先跑：pwsh _acceptance/start-local-stack.ps1" }

# ── 构建（api 走 dist，web 走 .output）────────────────────
if (-not $SkipBuild) {
  Write-Output "building shared/db ..."
  Push-Location $App
  try {
    & pnpm --filter @app/shared build | Out-Null
    & pnpm --filter @app/db build | Out-Null
    Write-Output "building api ..."
    & pnpm --filter @app/api build | Out-Null
  } finally { Pop-Location }
}

# ── api 环境（本项目专属端口，不与 ecpm 冲突）────────────
$apiEnv = @{
  NODE_ENV                = "development"
  PORT                    = "$ApiPort"
  DATABASE_URL            = "postgres://app:app@127.0.0.1:55432/app"
  REDIS_URL               = "redis://127.0.0.1:6380"
  JWT_SECRET              = "wanxing-local-dev-jwt-secret-32bytes"
  PHONE_HMAC_PEPPER       = "wanxing-local-phone-pepper"
  PHONE_ENC_KEY           = "wanxing-local-phone-enc-key"
  COOKIE_SECURE           = "false"
  AUTH_REQUIRE_INVITE     = "false"
  GIFT_CREDITS            = "80"
  SEED_SAMPLE_PROJECT     = "false"
  LLM_MODE                = "mock"
  ADAPTER_MODE            = "mock"
  PAYMENT_LIVE            = "false"
  SMS_IP_HOURLY_LIMIT     = "100000"
}

function Start-Api {
  if (Test-Port $ApiPort) { Write-Output "api :$ApiPort already up"; return }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = "dist/main.js"
  $psi.WorkingDirectory = Join-Path $App "apps\api"
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  foreach ($k in $apiEnv.Keys) { $psi.EnvironmentVariables[$k] = $apiEnv[$k] }
  $p = [System.Diagnostics.Process]::Start($psi)
  $null = $p.StandardOutput.ReadToEndAsync()  # 持续读，避免管道写满阻塞
  $null = $p.StandardError.ReadToEndAsync()
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Port $ApiPort) { break }
  }
  if (-not (Test-Port $ApiPort)) { throw "api 未能监听 $ApiPort（pid $($p.Id)）" }
  Write-Output "api up :$ApiPort (pid $($p.Id))"
}

function Start-Web {
  if (Test-Port $WebPort) { Write-Output "web :$WebPort already up"; return }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "node"
  $psi.Arguments = ".output/server/index.mjs"
  $psi.WorkingDirectory = Join-Path $App "apps\web"
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.EnvironmentVariables["NODE_ENV"] = "development"
  $psi.EnvironmentVariables["PORT"] = "$WebPort"
  $psi.EnvironmentVariables["NITRO_PORT"] = "$WebPort"
  $psi.EnvironmentVariables["NITRO_HOST"] = "127.0.0.1"
  # web 的 /v1 代理目标必须指向本项目的 api
  $psi.EnvironmentVariables["NUXT_API_PROXY"] = "http://127.0.0.1:$ApiPort"
  $p = [System.Diagnostics.Process]::Start($psi)
  $null = $p.StandardOutput.ReadToEndAsync()
  $null = $p.StandardError.ReadToEndAsync()
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Port $WebPort) { break }
  }
  if (-not (Test-Port $WebPort)) { throw "web 未能监听 $WebPort（pid $($p.Id)）" }
  Write-Output "web up :$WebPort (pid $($p.Id))"
}

Start-Api
Start-Web

Write-Output ""
[ordered]@{
  api = "http://127.0.0.1:$ApiPort/v1/healthz"
  web = "http://127.0.0.1:$WebPort"
} | ConvertTo-Json
