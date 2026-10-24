#!/usr/bin/env pwsh
# ============================================================================
# 「一帧」B 型商业化就绪 · 可复跑验收
#
# 覆盖目标（除外部资质/密钥外的代码项）：
#   1. 支付闭环：订单 → mock 支付入账 → 幂等/余额（运行态 HTTP，不是单测）
#   2. 真实渠道对接：微信/支付宝回调默认拒绝（真实 HTTP 状态 + 渠道协议体）
#   3. 供应商适配层：Ark/DeepSeek 契约测试（无 Key，假网关）
#   4. 合规上线清单：_acceptance/compliance-check.cjs（代码侧可验证项）
#   5. 部署可运维性：healthz live/ready、metrics、request_id 响应头
#   6. 质量门禁：全量单元/契约/e2e 测试 + typecheck + lint + build
#
# 用法：
#   pwsh _acceptance/b-type-acceptance.ps1                 # 全量（推荐）
#   pwsh _acceptance/b-type-acceptance.ps1 -SkipBuild      # 跳过构建（已构建过）
#   pwsh _acceptance/b-type-acceptance.ps1 -SkipTests      # 只跑运行态/合规/构建
#
# 前置：项目专用 PostgreSQL 127.0.0.1:55432（app/app，trust）与 Redis 127.0.0.1:6380 已运行。
# 说明：本脚本只使用临时端口 3100，不依赖也不干扰 3000/3001 上可能存在的开发进程。
# ============================================================================
param(
  [switch]$SkipTests,
  [switch]$SkipBuild,
  [int]$ApiPort = 3100
)

$ErrorActionPreference = "Continue"
$ProgressPreference = "SilentlyContinue"

$root = Split-Path -Parent $PSScriptRoot      # E:\wanxing
$app = Join-Path $root "app"
$apiDir = Join-Path $app "apps\api"
$psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$apiUrl = "http://127.0.0.1:$ApiPort"
$apiBase = "$apiUrl/v1"

$script:results = @()   # @{ name; ok; detail }

function Write-Section([string]$title) {
  Write-Host ""
  Write-Host ("=" * 78) -ForegroundColor Cyan
  Write-Host " $title" -ForegroundColor Cyan
  Write-Host ("=" * 78) -ForegroundColor Cyan
}

function Check([string]$name, [scriptblock]$body) {
  try {
    $detail = & $body
    $script:results += [pscustomobject]@{ name = $name; ok = $true; detail = [string]$detail }
    Write-Host ("PASS | {0}{1}" -f $name, $(if ($detail) { " | $detail" } else { "" })) -ForegroundColor Green
    return $true
  } catch {
    $script:results += [pscustomobject]@{ name = $name; ok = $false; detail = $_.Exception.Message }
    Write-Host ("FAIL | {0} | {1}" -f $name, $_.Exception.Message) -ForegroundColor Red
    return $false
  }
}

function Skip([string]$name, [string]$reason) {
  $script:results += [pscustomobject]@{ name = $name; ok = $true; detail = "SKIP: $reason" }
  Write-Host ("SKIP | {0} | {1}" -f $name, $reason) -ForegroundColor Yellow
}

function Assert($cond, [string]$msg) {
  # 兼容 -match 在数组上返回匹配数组的情况（非空数组视为真）
  $ok = if ($cond -is [array]) { @($cond | Where-Object { $_ }).Count -gt 0 } else { [bool]$cond }
  if (-not $ok) { throw $msg }
}

function Run-Cmd([string]$exe, [string[]]$arguments, [string]$workdir) {
  Push-Location $workdir
  try {
    $out = & $exe @arguments 2>&1
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  return [pscustomobject]@{ code = $code; out = ($out -join "`n") }
}

function Test-Tcp([string]$hostName, [int]$port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $task = $client.ConnectAsync($hostName, $port)
    if (-not $task.Wait(1500)) { return $false }
    return $client.Connected
  } catch { return $false } finally { $client.Dispose() }
}

# 以临时环境变量运行 node（用于生产启动守卫的正/反例），结束后恢复原值
function Invoke-NodeWithEnv([string]$workdir, [string]$expr, [hashtable]$overrides) {
  $saved = @{}
  foreach ($key in $overrides.Keys) {
    $saved[$key] = [Environment]::GetEnvironmentVariable($key)
    [Environment]::SetEnvironmentVariable($key, [string]$overrides[$key])
  }
  try {
    return Run-Cmd "node" @("-e", $expr) $workdir
  } finally {
    foreach ($key in $saved.Keys) {
      if ($null -eq $saved[$key]) {
        Remove-Item -Path "Env:$key" -ErrorAction SilentlyContinue
      } else {
        [Environment]::SetEnvironmentVariable($key, [string]$saved[$key])
      }
    }
  }
}

function Invoke-Api {
  param(
    [string]$Method = "GET",
    [string]$Path,
    $Body = $null,
    [hashtable]$Headers = @{},
    [string]$ContentType = "application/json"
  )
  $uri = "$apiBase$Path"
  $params = @{
    Uri = $uri; Method = $Method; Headers = $Headers
    SkipHttpErrorCheck = $true; UseBasicParsing = $true; TimeoutSec = 20
  }
  if ($null -ne $Body) {
    $params.ContentType = $ContentType
    $params.Body = if ($Body -is [string]) { $Body } else { ($Body | ConvertTo-Json -Depth 12 -Compress) }
  }
  $resp = Invoke-WebRequest @params
  $text = [string]$resp.Content
  $json = $null
  try { $json = $text | ConvertFrom-Json } catch {}
  return [pscustomobject]@{
    status = [int]$resp.StatusCode
    text = $text
    json = $json
    headers = $resp.Headers
  }
}

function Wait-ApiReady([int]$timeoutSec = 40) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri "$apiBase/healthz/ready" -SkipHttpErrorCheck -UseBasicParsing -TimeoutSec 3
      if ([int]$r.StatusCode -eq 200) { return $true }
    } catch {}
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# ── 统一环境（本机项目专用服务；不要指向系统 PG 5433）──
$env:DATABASE_URL = "postgres://app@127.0.0.1:55432/app"
$env:REDIS_URL = "redis://127.0.0.1:6380"
$env:NODE_ENV = "test"
$env:JWT_SECRET = "acceptance-jwt-secret-0123456789abcdef"
$env:PHONE_HMAC_PEPPER = "acceptance-phone-pepper"
$env:PHONE_ENC_KEY = "acceptance-phone-enc-key"
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "admin12345"
$env:COOKIE_SECURE = "false"
$env:PAYMENT_LIVE = "false"
$env:STORAGE_DRIVER = "local"
$env:STORAGE_DIR = Join-Path $env:TEMP "of-acceptance-storage"
$env:AI_LABEL_ENABLED = "false"
$env:LOG_LEVEL = "warn"

Write-Host ""
Write-Host "一帧 · B 型商业化就绪验收" -ForegroundColor White
Write-Host "工作区: $root   API 临时端口: $ApiPort   时间: $(Get-Date -Format o)"

# ────────────────────────────────────────────────────────────────────────────
Write-Section "0. 前置检查（项目数据库 / Redis / 工具链）"
Check "PostgreSQL 127.0.0.1:55432 可连接" { Assert (Test-Tcp "127.0.0.1" 55432) "端口 55432 不可达（项目 PG 未启动）"; "tcp ok" } | Out-Null
Check "Redis 127.0.0.1:6380 可连接" { Assert (Test-Tcp "127.0.0.1" 6380) "端口 6380 不可达（项目 Redis 未启动）"; "tcp ok" } | Out-Null
Check "数据库 schema 可读" {
  $r = & $psql -h 127.0.0.1 -p 55432 -U app -d app -tAc "select count(*) from information_schema.tables where table_schema='public'" 2>&1
  Assert ($LASTEXITCODE -eq 0) "psql 失败: $($r -join ' ')"
  Assert ([int]($r | Select-Object -First 1) -gt 10) "public schema 表数量异常: $r"
  "tables=$($r | Select-Object -First 1)"
} | Out-Null
Check "Node / pnpm 可用" {
  $node = (& node -v) 2>&1; $pnpm = (& pnpm -v) 2>&1
  Assert ($LASTEXITCODE -eq 0 -and $node -match '^v\d+') "node/pnpm 不可用"
  "node=$node pnpm=$pnpm"
} | Out-Null

# ────────────────────────────────────────────────────────────────────────────
Write-Section "1. 数据库迁移（幂等，验证部署可执行）"
Check "drizzle migrate" {
  $r = Run-Cmd "pnpm" @("--filter", "@app/api", "db:migrate") $app
  Assert ($r.code -eq 0) "migrate 失败: $($r.out.Substring(0, [Math]::Min(400, $r.out.Length)))"
  "exit=0"
} | Out-Null
Check "seed（幂等：SKU/模型/价格）" {
  $r = Run-Cmd "pnpm" @("--filter", "@app/api", "db:seed") $app
  Assert ($r.code -eq 0) "seed 失败: $($r.out.Substring(0, [Math]::Min(400, $r.out.Length)))"
  "exit=0"
} | Out-Null

# ────────────────────────────────────────────────────────────────────────────
Write-Section "2. 质量门禁：全量测试 / typecheck / lint / build"
if ($SkipTests) {
  Skip "全量测试" "-SkipTests"
} else {
  Check "全量单元/契约/e2e 测试（pnpm test）" {
    $r = Run-Cmd "pnpm" @("test") $app
    $summaries = ($r.out -split "`n") | Where-Object { $_ -match 'Tests\s+\d+ passed' } | ForEach-Object { $_.Trim() }
    $failLines = ($r.out -split "`n") | Where-Object { $_ -match 'FAIL |ELIFECYCLE' } | Select-Object -First 3
    Assert ($r.code -eq 0) "测试失败。$($failLines -join ' ; ')`n$(($r.out -split "`n") | Select-Object -Last 25 | Out-String)"
    Assert ($summaries.Count -ge 5) "未解析到各包测试汇总（$($summaries.Count) 条）"
    "packages=$( $summaries.Count ); $(($summaries | ForEach-Object { ($_ -replace '\s+', ' ').Trim() }) -join ' | ')"
  } | Out-Null
}

Check "typecheck（全仓 10 包）" {
  $r = Run-Cmd "pnpm" @("typecheck") $app
  Assert ($r.code -eq 0) "typecheck 失败: $((($r.out -split "`n") | Select-Object -Last 15) -join "`n")"
  "exit=0"
} | Out-Null

Check "lint（全仓 6 包）" {
  $r = Run-Cmd "pnpm" @("lint") $app
  Assert ($r.code -eq 0) "lint 失败: $((($r.out -split "`n") | Select-Object -Last 20) -join "`n")"
  "exit=0"
} | Out-Null

if ($SkipBuild) {
  Skip "构建 api/worker/web" "-SkipBuild"
} else {
  Check "构建 api + worker + web（pnpm build）" {
    $r = Run-Cmd "pnpm" @("build") $app
    Assert ($r.code -eq 0) "构建失败: $((($r.out -split "`n") | Select-Object -Last 25) -join "`n")"
    "exit=0"
  } | Out-Null
}

# ── 生产启动守卫（fail fast：弱默认密钥 / 假生成不得上生产）──
Check "生产守卫：api 带仓库默认密钥 → 拒绝启动" {
  $r = Invoke-NodeWithEnv $apiDir "require('./dist/config/env.js')" @{
    NODE_ENV = "production"; JWT_SECRET = "dev-only-jwt-secret-change-me"
    PHONE_HMAC_PEPPER = "dev-only-phone-pepper"; PHONE_ENC_KEY = "dev-only-phone-enc-key"
    ADMIN_USERNAME = "admin"; ADMIN_PASSWORD = "admin12345"; COOKIE_SECURE = "true"; PAYMENT_LIVE = "false"
  }
  Assert ($r.code -ne 0) "生产守卫未拒绝默认弱密钥配置"
  Assert ($r.out -match "生产环境配置校验失败") "拒绝原因不明确: $(($r.out -split "`n") | Select-Object -Last 8)"
  Assert ($r.out -match "JWT_SECRET") "拒绝信息未列出 JWT_SECRET"
  "rejected with aggregated problems"
} | Out-Null

Check "生产守卫：api 完整安全配置 → 通过" {
  $r = Invoke-NodeWithEnv $apiDir "require('./dist/config/env.js'); console.log('ENV_OK')" @{
    NODE_ENV = "production"; JWT_SECRET = "acceptance-prod-jwt-secret-0123456789abcdef"
    PHONE_HMAC_PEPPER = "acceptance-prod-pepper"; PHONE_ENC_KEY = "acceptance-prod-enc-key"
    ADMIN_USERNAME = "opsadmin"; ADMIN_PASSWORD = "Acceptance-Admin-Pass-1"; COOKIE_SECURE = "true"
    PAYMENT_LIVE = "false"
  }
  Assert ($r.code -eq 0) "完整生产配置被误拒: $(($r.out -split "`n") | Select-Object -Last 8)"
  Assert ($r.out -match "ENV_OK") "env 模块未正常加载"
  "ENV_OK"
} | Out-Null

Check "生产守卫：worker ADAPTER_MODE=mock → 拒绝（禁止假生成）" {
  $r = Invoke-NodeWithEnv (Join-Path $app "apps\worker") `
    "const {assertWorkerEnv}=require('./dist/env-guard.js'); try{assertWorkerEnv({NODE_ENV:'production',ADAPTER_MODE:'mock',ARK_API_KEY:'k'}); console.log('SHOULD_NOT_PASS'); process.exit(0)}catch(e){console.error(e.message); process.exit(3)}" @{}
  Assert ($r.code -eq 3) "worker 生产守卫未拒绝 mock 模式（exit=$($r.code)）: $($r.out)"
  Assert ($r.out -match "ADAPTER_MODE") "拒绝信息不明确: $($r.out)"
  "rejected"
} | Out-Null

Check "生产守卫：worker real + ARK Key → 通过" {
  $r = Invoke-NodeWithEnv (Join-Path $app "apps\worker") `
    "const {assertWorkerEnv}=require('./dist/env-guard.js'); assertWorkerEnv({NODE_ENV:'production',ADAPTER_MODE:'real',ARK_API_KEY:'k'}); console.log('WORKER_ENV_OK')" @{}
  Assert ($r.code -eq 0) "worker 完整生产配置被误拒: $($r.out)"
  Assert ($r.out -match "WORKER_ENV_OK") "守卫未正常执行"
  "WORKER_ENV_OK"
} | Out-Null

# ────────────────────────────────────────────────────────────────────────────
Write-Section "3. 运行态冒烟（真实 HTTP：支付闭环 / 回调默认拒绝 / 可运维性）"
$apiProc = $null
$apiLog = Join-Path $env:TEMP "of-acceptance-api-$ApiPort.log"
try {
  if (-not (Test-Path (Join-Path $apiDir "dist\main.js"))) {
    throw "dist/main.js 不存在，请先运行 pnpm build（或去掉 -SkipBuild）"
  }
  $env:PORT = [string]$ApiPort
  $apiProc = Start-Process -FilePath "node" -ArgumentList "dist/main.js" -WorkingDirectory $apiDir `
    -PassThru -WindowStyle Hidden -RedirectStandardOutput $apiLog -RedirectStandardError "$apiLog.err"

  Check "API 启动并 ready（<=40s）" {
    Assert (Wait-ApiReady 40) ("readiness 未在 40s 内返回 200；退出码=" + $apiProc.ExitCode +
      "；stdout 尾部: " + ((Get-Content $apiLog -Tail 20 -ErrorAction SilentlyContinue) -join ' ') +
      "；stderr 尾部: " + ((Get-Content "$apiLog.err" -Tail 20 -ErrorAction SilentlyContinue) -join ' '))
    "pid=$($apiProc.Id) port=$ApiPort"
  } | Out-Null

  Check "GET /healthz/live → 200（不查依赖）" {
    $r = Invoke-Api -Path "/healthz/live"
    Assert ($r.status -eq 200) "status=$($r.status)"
    Assert ($r.json.data.status -eq "ok") "body=$($r.text)"
    "uptime_s=$($r.json.data.uptime_s)"
  } | Out-Null

  Check "GET /healthz/ready → 200 且 db/redis up" {
    $r = Invoke-Api -Path "/healthz/ready"
    Assert ($r.status -eq 200) "status=$($r.status) body=$($r.text)"
    Assert ($r.json.data.checks.db -eq "up" -and $r.json.data.checks.redis -eq "up") "checks=$($r.text)"
    "checks=up"
  } | Out-Null

  Check "GET /metrics → 200 Prometheus 文本（非信封）" {
    $r = Invoke-Api -Path "/metrics"
    Assert ($r.status -eq 200) "status=$($r.status)"
    Assert (([string]($r.headers["Content-Type"])) -match "text/plain") "content-type=$($r.headers['Content-Type'])"
    Assert ($r.text -match "oneframe_tasks_total") "缺少 oneframe_tasks_total"
    Assert (-not ([string]$r.text).TrimStart().StartsWith("{")) "指标被信封包裹"
    "oneframe_tasks_total present"
  } | Out-Null

  Check "每个响应都带 x-request-id（可追踪）" {
    $r = Invoke-Api -Path "/healthz/live"
    $rid = [string]$r.headers["x-request-id"]
    Assert ($rid.Length -ge 8) "缺少 x-request-id"
    "x-request-id=$rid"
  } | Out-Null

  Check "GET /billing/channels → 渠道清单（未配置时不伪装可用）" {
    $r = Invoke-Api -Path "/billing/channels"
    Assert ($r.status -eq 200) "status=$($r.status)"
    $channels = @($r.json.data.channels)
    Assert ($channels.Count -ge 1) "channels 为空"
    $wechat = $channels | Where-Object { $_.channel -eq "wechat" } | Select-Object -First 1
    Assert ($wechat -and $wechat.configured -eq $false) "PAYMENT_LIVE=false 且无凭据时 wechat.configured 应为 false"
    "live=$($r.json.data.live) wechat.configured=false"
  } | Out-Null

  Check "POST /billing/notify/wechat 未配置公钥 → HTTP 401 + FAIL 体（默认拒绝，真实状态码）" {
    $r = Invoke-Api -Method POST -Path "/billing/notify/wechat" -Body "{}"
    Assert ($r.status -eq 401) "status=$($r.status) body=$($r.text)"
    Assert ($r.text -match '"code":"FAIL"') "响应体不符合微信协议: $($r.text)"
    Assert ([string]$r.headers["content-type"] -match "application/json") "content-type=$($r.headers['Content-Type'])"
    "401 + FAIL"
  } | Out-Null

  Check "POST /billing/notify/alipay 未配置公钥 → HTTP 401 + 纯文本 failure" {
    $r = Invoke-Api -Method POST -Path "/billing/notify/alipay" -Body "" -ContentType "application/x-www-form-urlencoded"
    Assert ($r.status -eq 401) "status=$($r.status) body=$($r.text)"
    Assert ($r.text.Trim() -eq "failure") "响应体不符合支付宝协议: $($r.text)"
    "401 + failure"
  } | Out-Null

  Check "支付闭环（HTTP）：注册 → 下单 → mock 支付 → 入账 +500 → 幂等" {
    $phone = "137" + (Get-Random -Minimum 10000000 -Maximum 99999999)
    $sms = Invoke-Api -Method POST -Path "/auth/sms-code" -Body @{ phone = $phone }
    Assert ($sms.status -in 200, 201) "sms-code status=$($sms.status) body=$($sms.text)"
    Assert ($sms.json.code -eq 0) "sms-code: $($sms.text)"
    $code = [string]$sms.json.data.debug_code
    Assert ($code -match '^\d{6}$') "测试环境 debug_code 不可用: $($sms.text)"

    $login = Invoke-Api -Method POST -Path "/auth/login" -Body @{ phone = $phone; code = $code; age_confirmed = $true }
    Assert ($login.json.code -eq 0) "login: $($login.text)"
    $token = [string]$login.json.data.access_token
    $headers = @{ Authorization = "Bearer $token" }

    $me1 = Invoke-Api -Path "/me" -Headers $headers
    $balance1 = [int]$me1.json.data.credits.balance
    Assert ($balance1 -eq 80) "新人礼包异常 balance=$balance1"

    $skus = Invoke-Api -Path "/billing/skus"
    $sku = @($skus.json.data) | Select-Object -First 1
    Assert ($null -ne $sku) "SKU 为空"

    $order = Invoke-Api -Method POST -Path "/billing/orders" -Body @{ sku = $sku.sku; channel = "mock" } -Headers $headers
    Assert ($order.json.code -eq 0) "下单失败: $($order.text)"
    $orderId = [string]$order.json.data.order_id
    Assert ($order.json.data.status -eq 1) "新订单状态应为待支付"

    $paid = Invoke-Api -Method POST -Path "/billing/orders/$orderId/mock-pay" -Body @{} -Headers $headers
    Assert ($paid.json.code -eq 0 -and $paid.json.data.credited -eq $true) "支付入账失败: $($paid.text)"

    $me2 = Invoke-Api -Path "/me" -Headers $headers
    $balance2 = [int]$me2.json.data.credits.balance
    Assert ($balance2 -eq ($balance1 + [int]$sku.credits)) "余额未按 SKU 入账: $balance1 -> $balance2 (credits=$($sku.credits))"

    # 重复回调/重复确认必须幂等（第二次数值不变、credited=false）
    $again = Invoke-Api -Method POST -Path "/billing/notify/mock" -Body @{ order_id = $orderId; channel_order_id = "acc-$orderId" }
    Assert ($again.json.code -eq 0) "重复回调报错: $($again.text)"
    Assert ($again.json.data.credited -eq $false) "重复回调二次入账（幂等被破坏）"

    $me3 = Invoke-Api -Path "/me" -Headers $headers
    Assert ([int]$me3.json.data.credits.balance -eq $balance2) "重复回调后余额变化（幂等被破坏）"
    $script:payCtx = @{ token = $token; orderId = $orderId; baseline = $balance1; credits = [int]$sku.credits }
    "+$($sku.credits) 且重复回调不重复入账"
  } | Out-Null

  Check "退款闭环（HTTP）：管理员全额退款 → 积分回冲 → 订单已退款 → 幂等" {
    Assert ($null -ne $script:payCtx) "支付闭环未完成，无法验证退款"
    $ctx = $script:payCtx
    $admin = Invoke-Api -Method POST -Path "/ops/admin/login" -Body @{ username = "admin"; password = "admin12345" }
    Assert ($admin.json.code -eq 0) "管理员登录失败: $($admin.text)"
    $adminHeaders = @{ Authorization = "Bearer $([string]$admin.json.data.token)" }

    $refund = Invoke-Api -Method POST -Path "/ops/admin/orders/$($ctx.orderId)/refund" `
      -Body @{ reason = "acceptance-refund" } -Headers $adminHeaders
    Assert ($refund.json.code -eq 0) "退款失败: $($refund.text)"
    Assert ($refund.json.data.status -eq 4) "退款后订单状态应为 4: $($refund.text)"
    Assert ([string]$refund.json.data.refund_no -eq "rf-$($ctx.orderId)") "退款单号应为固定幂等号: $($refund.json.data.refund_no)"
    Assert ($refund.json.data.idempotent -eq $false) "首次退款不应标记 idempotent"

    $meAfter = Invoke-Api -Path "/me" -Headers @{ Authorization = "Bearer $($ctx.token)" }
    $balanceAfter = [int]$meAfter.json.data.credits.balance
    Assert ($balanceAfter -eq $ctx.baseline) "退款未回冲积分: $($balanceAfter) != $($ctx.baseline)"

    # 重复退款：幂等（不再扣积分、不再调渠道）
    $refundAgain = Invoke-Api -Method POST -Path "/ops/admin/orders/$($ctx.orderId)/refund" `
      -Body @{ reason = "acceptance-refund-again" } -Headers $adminHeaders
    Assert ($refundAgain.json.code -eq 0) "重复退款报错: $($refundAgain.text)"
    Assert ($refundAgain.json.data.idempotent -eq $true) "重复退款应幂等返回"
    $meAfter2 = Invoke-Api -Path "/me" -Headers @{ Authorization = "Bearer $($ctx.token)" }
    Assert ([int]$meAfter2.json.data.credits.balance -eq $balanceAfter) "重复退款导致二次扣减"
    "status=4, balance=$balanceAfter, refund_no=rf-$($ctx.orderId), 幂等"
  } | Out-Null

  # 合规检查（服务在跑，运行态条目可验证）
  Check "合规上线清单代码侧检查（compliance-check.cjs）" {
    $env:API_URL = $apiUrl
    $r = Run-Cmd "node" @((Join-Path $root "_acceptance\compliance-check.cjs")) $root
    Assert ($r.code -eq 0) "合规检查未通过（exit=$($r.code)）：`n$((($r.out -split "`n") | Select-Object -Last 30) -join "`n")"
    $summary = ($r.out -split "`n") | Where-Object { $_ -match '(PASS|FAIL|SKIP).*(\d+)' } | Select-Object -Last 2
    (($r.out -split "`n") | Where-Object { $_ -match '\d+\s+(passed|PASS)|合计|总计|通过' } | Select-Object -Last 1)
  } | Out-Null
} catch {
  Write-Host "运行态阶段异常终止: $($_.Exception.Message)" -ForegroundColor Red
  $script:results += [pscustomobject]@{ name = "运行态阶段"; ok = $false; detail = $_.Exception.Message }
} finally {
  if ($apiProc -and -not $apiProc.HasExited) {
    Stop-Process -Id $apiProc.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
  if (Test-Path $apiLog) { Remove-Item $apiLog -Force -ErrorAction SilentlyContinue }
  if (Test-Path "$apiLog.err") { Remove-Item "$apiLog.err" -Force -ErrorAction SilentlyContinue }
}

# ────────────────────────────────────────────────────────────────────────────
Write-Section "4. 验收汇总"
$passed = @($script:results | Where-Object { $_.ok }).Count
$failed = @($script:results | Where-Object { -not $_.ok })
foreach ($f in $failed) { Write-Host ("FAIL | {0} | {1}" -f $f.name, $f.detail) -ForegroundColor Red }
Write-Host ""
Write-Host ("结果: {0}/{1} 通过，{2} 失败" -f $passed, $script:results.Count, $failed.Count) `
  -ForegroundColor $(if ($failed.Count -eq 0) { "Green" } else { "Red" })
Write-Host "说明：外部资质/商户号/真实 Key 不在本脚本范围；见 docs/06-security-compliance/launch-checklist.md"
if ($failed.Count -gt 0) { exit 1 } else { exit 0 }
