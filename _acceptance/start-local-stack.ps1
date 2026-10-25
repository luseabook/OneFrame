<#
.SYNOPSIS
  启动/检查项目专用本地依赖：PostgreSQL 55432 + Redis 6380。

.DESCRIPTION
  为什么需要它：本项目的本地实例跑在非默认端口（PG 55432 / Redis 6380，
  见 docs/05-ops/deployment.md §1），而裸跑 `pnpm -w test` 依赖这些实例。
  宿主重启后这两个进程会消失，表现为「测试大面积 ECONNREFUSED」——
  看起来像代码坏了，其实是依赖没起。本脚本幂等：已起则只检查。

  不碰系统 PostgreSQL（那套可能在 5432/5433 上服务其它项目）。

.EXAMPLE
  pwsh _acceptance/start-local-stack.ps1
  pwsh _acceptance/start-local-stack.ps1 -CheckOnly
#>
param(
  [switch]$CheckOnly
)

$ErrorActionPreference = "Stop"
$Root = "E:\wanxing"
$Stack = Join-Path $Root ".localstack"
$PgData = Join-Path $Stack "pgdata"
$PgLog = Join-Path $Stack "pg.log"
$RedisData = Join-Path $Stack "redisdata"
$PgPort = 55432
$RedisPort = 6380
$PgBin = "C:\Program Files\PostgreSQL\18\bin"
$RedisExe = "C:\ProgramData\chocolatey\bin\redis-server.exe"

function Test-Port([int]$Port) {
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

$report = [ordered]@{ pg = $null; redis = $null; actions = @() }

# ── PostgreSQL ────────────────────────────────────────────
if (Test-Port $PgPort) {
  $report.pg = "up (port $PgPort)"
} elseif ($CheckOnly) {
  $report.pg = "DOWN (port $PgPort)"
} else {
  if (-not (Test-Path $PgData)) {
    New-Item -ItemType Directory -Force -Path $PgData | Out-Null
    & "$PgBin\initdb.exe" -D $PgData -U app -A trust -E UTF8 --locale=C | Out-Null
    $conf = Join-Path $PgData "postgresql.conf"
    $c = Get-Content $conf -Raw
    $c = $c -replace "(?m)^\s*#?\s*port\s*=.*$", "port = $PgPort"
    $c = $c -replace "(?m)^\s*#?\s*listen_addresses\s*=.*$", "listen_addresses = '127.0.0.1'"
    Set-Content -Path $conf -Value $c -Encoding UTF8
    $report.actions += "initdb -> $PgData"
  }
  # 用 Start-Process 起，避免 pg_ctl 阻塞当前 shell（也不要放进后台 job，
  # 否则 job 被取消时会连带杀掉 postgres）
  Start-Process -FilePath "$PgBin\pg_ctl.exe" `
    -ArgumentList @('-D', $PgData, '-l', $PgLog, '-o', '"-p 55432"', 'start') `
    -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Port $PgPort) { break }
  }
  if (-not (Test-Port $PgPort)) { throw "PostgreSQL 未能监听 $PgPort，见 $PgLog" }
  $report.actions += "started postgres $PgPort"

  # app 库（幂等）
  $exists = & "$PgBin\psql.exe" -h 127.0.0.1 -p $PgPort -U app -d postgres -tAc "select 1 from pg_database where datname='app'" 2>$null
  if ($exists -notmatch '1') {
    & "$PgBin\createdb.exe" -h 127.0.0.1 -p $PgPort -U app app | Out-Null
    $report.actions += "created database app"
  }
  $report.pg = "up (port $PgPort)"
}

# ── Redis ─────────────────────────────────────────────────
if (Test-Port $RedisPort) {
  $report.redis = "up (port $RedisPort)"
} elseif ($CheckOnly) {
  $report.redis = "DOWN (port $RedisPort)"
} else {
  New-Item -ItemType Directory -Force -Path $RedisData | Out-Null
  Start-Process -FilePath $RedisExe `
    -ArgumentList @('--port', "$RedisPort", '--dir', $RedisData, '--bind', '127.0.0.1', '--appendonly', 'yes') `
    -PassThru -WindowStyle Hidden | Out-Null
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Port $RedisPort) { break }
  }
  if (-not (Test-Port $RedisPort)) { throw "Redis 未能监听 $RedisPort" }
  $report.actions += "started redis $RedisPort"
  $report.redis = "up (port $RedisPort)"
}

$report | ConvertTo-Json -Depth 4
