<#
.SYNOPSIS
  只重启本项目的 api（:3002），不动 web。

.DESCRIPTION
  为什么单独一个脚本：改后端代码后要频繁重启 api，但 web 的 nuxt dev 启动慢（40s+），
  每次都重启整个栈会浪费大量时间。env 必须显式注入（api 不读 .env，见
  _acceptance/_gap/canvas-frontend-baseline.md §1）。
#>
param([switch]$SkipBuild)

$ErrorActionPreference = "Stop"
$App = "E:\wanxing\app"
$ApiPort = 3002

$old = (Get-NetTCPConnection -State Listen -LocalPort $ApiPort -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
if ($old) {
  Stop-Process -Id $old -Force -ErrorAction SilentlyContinue
  Write-Output "stopped old api pid $old"
  Start-Sleep -Seconds 2
}

if (-not $SkipBuild) {
  Push-Location $App
  try { & pnpm --filter @app/api build | Out-Null } finally { Pop-Location }
}

$env:NODE_ENV = "development"; $env:PORT = "$ApiPort"
$env:DATABASE_URL = "postgres://app:app@127.0.0.1:55432/app"
$env:REDIS_URL = "redis://127.0.0.1:6380"
$env:JWT_SECRET = "wanxing-local-dev-jwt-secret-32bytes"
$env:PHONE_HMAC_PEPPER = "wanxing-local-phone-pepper"
$env:PHONE_ENC_KEY = "wanxing-local-phone-enc-key"
$env:COOKIE_SECURE = "false"; $env:AUTH_REQUIRE_INVITE = "false"; $env:GIFT_CREDITS = "80"
$env:SEED_SAMPLE_PROJECT = "false"; $env:LLM_MODE = "mock"; $env:ADAPTER_MODE = "mock"
$env:PAYMENT_LIVE = "false"; $env:SMS_IP_HOURLY_LIMIT = "100000"
# 签名链接基址必须指向本项目 api（默认 3000 是另一个项目的端口）
$env:STORAGE_PUBLIC_BASE = "http://127.0.0.1:$ApiPort/v1"

Start-Process -FilePath "node" -ArgumentList "dist/main.js" `
  -WorkingDirectory (Join-Path $App "apps\api") `
  -RedirectStandardOutput "E:\wanxing\_acceptance\stack-api.log" `
  -RedirectStandardError "E:\wanxing\_acceptance\stack-api.err.log" `
  -WindowStyle Hidden

for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  if (Get-NetTCPConnection -State Listen -LocalPort $ApiPort -ErrorAction SilentlyContinue) { break }
}
if (-not (Get-NetTCPConnection -State Listen -LocalPort $ApiPort -ErrorAction SilentlyContinue)) {
  throw "api 未起来，看 _acceptance/stack-api.err.log"
}
try { (Invoke-WebRequest -Uri "http://127.0.0.1:$ApiPort/v1/healthz" -UseBasicParsing -TimeoutSec 10).Content }
catch { throw "api 健康检查失败：$($_.Exception.Message)" }
