# 数据库备份（Windows / PowerShell 版本）
# 用法：.\backup-db.ps1 [-OutDir <dir>]
# 与 deploy/backup-db.sh 行为等价，供无 bash 的 Windows 环境使用
param(
  [string]$OutDir = ".\backups"
)

$ErrorActionPreference = "Stop"

if (-not $env:DATABASE_URL) { throw "DATABASE_URL is required" }

# 解析 postgres://[user[:pass]@]host[:port]/db  —— 手工解析，避免正则兼容问题
$url = [string]$env:DATABASE_URL
if ($url.StartsWith("postgres://")) { $url = $url.Substring(11) }
$atIdx = $url.LastIndexOf('@')
if ($atIdx -lt 0) { throw "DATABASE_URL missing '@': $($env:DATABASE_URL)" }
$cred = $url.Substring(0, $atIdx)
$hostDb = $url.Substring($atIdx + 1)
$pgUser = ($cred -split ':')[0]

$slashIdx = $hostDb.IndexOf('/')
if ($slashIdx -lt 0) { throw "DATABASE_URL missing '/db': $($env:DATABASE_URL)" }
$hostPort = $hostDb.Substring(0, $slashIdx)
$pgDb = $hostDb.Substring($slashIdx + 1)
$pgDb = ($pgDb -split '\?')[0]

if ($hostPort.Contains(':')) {
  $parts = $hostPort -split ':'
  $pgHost = $parts[0]
  $pgPort = $parts[1]
} else {
  $pgHost = $hostPort
  $pgPort = "5432"
}

# 定位 pg_dump
$pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
if (-not $pgDump) {
  $candidates = @(
    "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe",
    "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe",
    "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe"
  )
  $pgDump = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $pgDump) { throw "pg_dump not found; add PostgreSQL bin to PATH" }
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$file = Join-Path $OutDir "oneframe-$stamp.dump"

Write-Output "[backup] user=$pgUser host=$pgHost port=$pgPort db=$pgDb"
Write-Output "[backup] dumping to $file"
& $pgDump --format=custom --compress=6 --no-owner --no-privileges --file=$file `
  --host=$pgHost --port=$pgPort --username=$pgUser --dbname=$pgDb
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit $LASTEXITCODE" }

$size = "{0:N2} MB" -f ((Get-Item $file).Length / 1MB)
Write-Output "[backup] done: $file ($size)"

# 校验：pg_restore --list 能读出归档目录
$pgRestore = Join-Path (Split-Path $pgDump) "pg_restore.exe"
& $pgRestore --list $file | Out-Null
if ($LASTEXITCODE -ne 0) { throw "backup verification failed (pg_restore --list)" }
Write-Output "[backup] verified (pg_restore --list ok)"

# 保留策略
$retention = if ($env:BACKUP_RETENTION_DAYS) { [int]$env:BACKUP_RETENTION_DAYS } else { 14 }
$cutoff = (Get-Date).AddDays(-$retention)
Get-ChildItem $OutDir -Filter "oneframe-*.dump" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  ForEach-Object { Write-Output "[backup] prune $($_.Name)"; Remove-Item $_.FullName -Force }
Write-Output "[backup] pruned files older than $retention days"
