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
# web 的 /v1 代理目标是 **构建期** 常量：Nitro 把 routeRules["/v1/**"].proxy 编译进
# .output/server/chunks/_/nitro.mjs，**运行期再设 NUXT_API_PROXY 不会生效**。
# 本脚本原来只 build api、web 直接 `node .output/server/index.mjs`，于是本地 .output
# 里烤着默认的 127.0.0.1:3000 —— 那是 E:\ecpm 的端口。表现极具迷惑性：
# 后台 10 个面板标题/侧栏/按钮全部正常渲染，只有 /v1/** 数据全 404，
# typecheck / lint / build 全绿（第 107 批排查运营后台 E2E 时踩到）。
$apiProxyTarget = "http://127.0.0.1:$ApiPort"
if (-not $SkipBuild) {
  Write-Output "building shared/db ..."
  Push-Location $App
  try {
    & pnpm --filter @app/shared build | Out-Null
    & pnpm --filter @app/db build | Out-Null
    Write-Output "building api ..."
    & pnpm --filter @app/api build | Out-Null
    $env:NUXT_API_PROXY = $apiProxyTarget
    Write-Output "building web (NUXT_API_PROXY=$apiProxyTarget) ..."
    & pnpm --filter @app/web build | Out-Null
  } finally { Pop-Location }
}

# 产物里的代理目标必须与本次启动的 api 端口一致，否则宁可拒绝启动：
# 直接 `node .output` 起来只会得到一个"页面能开、数据全 404"的假栈。
function Assert-WebBuiltFor([string]$Target) {
  $nitro = Join-Path $App "apps\web\.output\server\chunks\_\nitro.mjs"
  if (-not (Test-Path $nitro)) {
    throw "web .output 不存在（$nitro）。先不带 -SkipBuild 跑一次本脚本。"
  }
  if (Select-String -Path $nitro -Pattern ([regex]::Escape($Target)) -Quiet) { return }
  $found = @(Select-String -Path $nitro -Pattern '127\.0\.0\.1:\d+' -AllMatches |
    ForEach-Object { $_.Matches.Value } | Sort-Object -Unique)
  $shown = if ($found.Count -gt 0) { $found -join ", " } else { "未找到任何 127.0.0.1:端口" }
  throw ("web .output 的 /v1 代理目标不是 $Target（实际：$shown）。" +
    "代理目标在**构建期**写死，-SkipBuild 沿用旧产物必然 404 —— 去掉 -SkipBuild 重建。")
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
  # 存储签名链接的对外基址。**必须显式指到本项目 api**：
  # 默认值是 http://127.0.0.1:3000/v1，而 3000 是另一个项目（E:\ecpm）的端口，
  # 于是资产/下载链接全指向别人的服务（点开 404 或拿到别的响应），
  # 而接口本身"成功返回了一个 URL"，测试也看不出来。
  STORAGE_PUBLIC_BASE     = "http://127.0.0.1:$ApiPort/v1"
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

# 经 web 的 /v1 反代打一次本项目 api 的探针：这才是"栈起来了"的判据
function Test-WebApiProxy([int]$Port) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/v1/healthz/live" -TimeoutSec 5 -SkipHttpErrorCheck
    return [int]$r.StatusCode -eq 200
  } catch { return $false }
}

function Start-Web {
  if (Test-Port $WebPort) {
    if (Test-WebApiProxy $WebPort) { Write-Output "web :$WebPort already up (proxy ok)"; return }
    # 端口在听但反代不通：几乎必然是旧产物烤着别人的目标（本脚本第 107 批修过这个坑）。
    # 只验端口会把这种"页面能开、数据全 404"的假栈当成已就绪，后面要花几十个断言才发现。
    $stalePid = Get-PortPid $WebPort
    Write-Output "web :$WebPort 在跑但 /v1 反代不通，重启（旧 pid=$stalePid）"
    if ($stalePid) { Stop-Process -Id $stalePid -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
  }
  Assert-WebBuiltFor $apiProxyTarget
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
  for ($i = 0; $i -lt 20; $i++) {
    if (Test-WebApiProxy $WebPort) { Write-Output "web up :$WebPort (proxy -> $apiProxyTarget)"; return }
    Start-Sleep -Milliseconds 500
  }
  throw ("web 已监听 $WebPort，但 /v1/healthz/live 经反代拿不到 200 —— 它的代理目标不是 $apiProxyTarget。" +
    "这是**构建期**常量，`-SkipBuild` 沿用旧产物必然是这样；去掉 -SkipBuild 重建再启。")
}

Start-Api
Start-Web

Write-Output ""
[ordered]@{
  api = "http://127.0.0.1:$ApiPort/v1/healthz"
  web = "http://127.0.0.1:$WebPort"
} | ConvertTo-Json
