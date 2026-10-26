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
  # 为什么用 cmd.exe 重定向到**文件**，而不是 ProcessStartInfo 重定向到**管道**：
  # 管道读取端（ReadToEndAsync）活在本进程里，本进程一退出管道就断，子进程下次
  # 写 stdout 会拿到 EPIPE 直接崩——表现为"启动脚本明明成功，几分钟后 api 不见了"，
  # 而且不会有任何报错。重定向到文件则与父进程生命周期无关。
  # 同理不能给 Start-Process 加 -RedirectStandardOutput 再用管道接走（会挂住调用方）。
  $apiLog = Join-Path $Root "_acceptance\stack-api.log"
  $args = "/c node dist/main.js > `"$apiLog`" 2>&1"
  # 环境变量：cmd 继承本进程环境，所以先设置再启动
  foreach ($k in $apiEnv.Keys) { Set-Item -Path "Env:$k" -Value $apiEnv[$k] }
  Start-Process -FilePath "cmd.exe" -ArgumentList $args `
    -WorkingDirectory (Join-Path $App "apps\api") -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Port $ApiPort) { break }
  }
  if (-not (Test-Port $ApiPort)) {
    $tail = if (Test-Path $apiLog) { (Get-Content $apiLog -Tail 12) -join "`n" } else { "（无日志）" }
    throw "api 未能监听 $ApiPort`n$tail"
  }
  Write-Output "api up :$ApiPort"
}

function Start-Web {
  if (Test-Port $WebPort) { Write-Output "web :$WebPort already up"; return }
  # 同 Start-Api：一律重定向到文件，绝不把长寿进程的 stdout 接到本进程的管道上
  $webLog = Join-Path $Root "_acceptance\stack-web.log"
  $env:NODE_ENV = "development"
  $env:PORT = "$WebPort"
  $env:NITRO_PORT = "$WebPort"
  $env:NITRO_HOST = "127.0.0.1"
  # web 的 /v1 代理目标必须指向本项目的 api（否则会代理到 3000 上别人的结果）
  $env:NUXT_API_PROXY = "http://127.0.0.1:$ApiPort"
  Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c node .output/server/index.mjs > `"$webLog`" 2>&1" `
    -WorkingDirectory (Join-Path $App "apps\web") -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Port $WebPort) { break }
  }
  if (-not (Test-Port $WebPort)) {
    $tail = if (Test-Path $webLog) { (Get-Content $webLog -Tail 12) -join "`n" } else { "（无日志）" }
    throw "web 未能监听 $WebPort`n$tail"
  }
  Write-Output "web up :$WebPort"
}

Start-Api
Start-Web

Write-Output ""
[ordered]@{
  api = "http://127.0.0.1:$ApiPort/v1/healthz"
  web = "http://127.0.0.1:$WebPort"
} | ConvertTo-Json
