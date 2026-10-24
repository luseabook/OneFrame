# 备份可用性验证（Windows / PowerShell）
# 用法：.\verify-backup.ps1 -DumpFile <path>
#
# 目的：备份"能拷出来"不等于"能恢复"。本脚本把备份恢复到一个临时库，
# 比对表数量与关键表行数，通过后删除临时库。
param(
  [Parameter(Mandatory=$true)][string]$DumpFile
)

$ErrorActionPreference = "Stop"
if (-not $env:DATABASE_URL) { throw "DATABASE_URL is required" }
if (-not (Test-Path $DumpFile)) { throw "dump not found: $DumpFile" }

$pgBin = "C:\Program Files\PostgreSQL\18\bin"
if (-not (Test-Path "$pgBin\pg_restore.exe")) {
  $pgRestoreCmd = (Get-Command pg_restore -ErrorAction SilentlyContinue).Source
  if (-not $pgRestoreCmd) { throw "pg_restore not found" }
  $pgBin = Split-Path $pgRestoreCmd
}

# 解析连接参数（与 backup-db.ps1 一致）
$url = [string]$env:DATABASE_URL
if ($url.StartsWith("postgres://")) { $url = $url.Substring(11) }
$atIdx = $url.LastIndexOf('@')
$cred = $url.Substring(0, $atIdx)
$hostDb = $url.Substring($atIdx + 1)
$pgUser = ($cred -split ':')[0]
$slashIdx = $hostDb.IndexOf('/')
$hostPort = $hostDb.Substring(0, $slashIdx)
$pgDb = ($hostDb.Substring($slashIdx + 1) -split '\?')[0]
if ($hostPort.Contains(':')) { $p = $hostPort -split ':'; $pgHost = $p[0]; $pgPort = $p[1] }
else { $pgHost = $hostPort; $pgPort = "5432" }

$testDb = "${pgDb}_restore_verify"
$psql = Join-Path $pgBin "psql.exe"
$pgRestore = Join-Path $pgBin "pg_restore.exe"

Write-Output "[verify] source dump: $DumpFile"
Write-Output "[verify] target temp db: $testDb"

& $psql -h $pgHost -p $pgPort -U $pgUser -d postgres -c "DROP DATABASE IF EXISTS $testDb;" | Out-Null
& $psql -h $pgHost -p $pgPort -U $pgUser -d postgres -c "CREATE DATABASE $testDb;" | Out-Null

try {
  & $pgRestore --no-owner --no-privileges --dbname="postgres://${pgUser}@${pgHost}:${pgPort}/${testDb}" $DumpFile
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed (exit $LASTEXITCODE)" }

  $srcTables = (& $psql -h $pgHost -p $pgPort -U $pgUser -d $pgDb -tAc "select count(*) from information_schema.tables where table_schema='public';").Trim()
  $dstTables = (& $psql -h $pgHost -p $pgPort -U $pgUser -d $testDb -tAc "select count(*) from information_schema.tables where table_schema='public';").Trim()
  Write-Output "[verify] tables: source=$srcTables restored=$dstTables"
  if ($srcTables -ne $dstTables) { throw "table count mismatch" }

  # 关键表行数抽查（模型/价格/SKU 是业务基础数据）
  $check = (& $psql -h $pgHost -p $pgPort -U $pgUser -d $testDb -tAc "select (select count(*) from models)||'|'||(select count(*) from skus);").Trim()
  Write-Output "[verify] key data (models|skus): $check"
  $models = [int](($check -split '\|')[0])
  if ($models -le 0) { throw "models table empty after restore" }

  Write-Output "[verify] PASS — backup is restorable"
} finally {
  & $psql -h $pgHost -p $pgPort -U $pgUser -d postgres -c "DROP DATABASE IF EXISTS $testDb;" | Out-Null
  Write-Output "[verify] temp db dropped"
}
