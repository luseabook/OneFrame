# 本轮验收一键复跑（只读，不改任何代码/数据）
#
# 用途：`docs/07-plan/implement-progress-vs-reelmate.md` §8.2 的复现命令与
# 每轮收口的三道门禁（typecheck / lint / test）+ 规模口径（端点/页面/表/模型）。
#
# 用法：在仓库根 `E:\wanxing` 执行
#   pwsh _acceptance/verify-round.ps1            # 全量（约 2~3 分钟）
#   pwsh _acceptance/verify-round.ps1 -ScaleOnly # 只出规模口径（秒级）
#
# 注意：
# 1) 跑之前请确认 dev 栈里**没有** worker/API 在消费共享 dev 库
#    （有 worker 时 `task.status` 会被提前推进，时序类断言会假红）；
# 2) 本脚本不启动/不停止任何服务，也不做 git 操作。

param(
  [switch]$ScaleOnly,
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root "app"

function Write-Section($text) {
  Write-Host ""
  Write-Host ("=" * 60)
  Write-Host $text
  Write-Host ("=" * 60)
}

Write-Section "规模口径（scale）"

$controllers = @(Get-ChildItem (Join-Path $app "apps/api/src") -Recurse -File -Filter "*.controller.ts")
$endpoints = 0
foreach ($file in $controllers) {
  $raw = Get-Content -LiteralPath $file.FullName -Raw
  # 同时统计 `@Get("path")` 与无参 `@Get()` 两种写法
  $endpoints += ([regex]::Matches($raw, '@(Get|Post|Put|Patch|Delete)\s*\(')).Count
}
$pages = @(Get-ChildItem (Join-Path $app "apps/web/pages") -Recurse -File -Filter "*.vue").Count
$tables = (Select-String -Path (Join-Path $app "packages/db/src/schema.ts") -Pattern "pgTable\(").Count
$migrations = @(Get-ChildItem (Join-Path $app "apps/api/drizzle") -File -Filter "00*.sql").Count
$models = (Select-String -Path (Join-Path $app "apps/api/src/db/seed.ts") -Pattern 'displayName: "').Count
$cliCommands = "n/a"
$cliGroups = "n/a"
$cliDist = Join-Path $app "apps/cli/dist/registry.js"
if (Test-Path $cliDist) {
  # 命令表是「按组展开的数组」，正则数不准；直接从构建产物里读真实长度
  $cliCounts = & node -e "const m=require(process.argv[1]); console.log((m.COMMANDS||[]).length + ' ' + (m.GROUP_ORDER||[]).length);" $cliDist 2>$null
  if ($cliCounts) {
    $parts = ($cliCounts -split "\s+")
    $cliCommands = $parts[0]
    $cliGroups = $parts[1]
  }
}
$webVueLines = (Get-ChildItem (Join-Path $app "apps/web") -Recurse -File -Filter "*.vue" |
  Where-Object { $_.FullName -notmatch "node_modules|\.nuxt|\.output|dist" } |
  ForEach-Object { (Get-Content -LiteralPath $_.FullName).Count } | Measure-Object -Sum).Sum
$apiTsFiles = @(Get-ChildItem (Join-Path $app "apps/api/src") -Recurse -File -Filter "*.ts").Count

Write-Host ("controllers      = {0}" -f $controllers.Count)
Write-Host ("endpoints        = {0}" -f $endpoints)
Write-Host ("web pages        = {0}" -f $pages)
Write-Host ("db tables        = {0}" -f $tables)
Write-Host ("migrations       = {0}" -f $migrations)
Write-Host ("seed models      = {0}" -f $models)
Write-Host ("cli commands     = {0}（{1} 组）" -f $cliCommands, $cliGroups)
Write-Host ("web .vue lines   = {0}" -f $webVueLines)
Write-Host ("api .ts files    = {0}" -f $apiTsFiles)

if ($ScaleOnly) { return }

Write-Section "门禁 1/3：typecheck（全包）"
Push-Location $app
try {
  & pnpm typecheck
  if ($LASTEXITCODE -ne 0) { throw "typecheck failed" }

  Write-Section "门禁 2/3：lint（api / web / cli / packages）"
  & pnpm lint
  if ($LASTEXITCODE -ne 0) { throw "lint failed" }

  if (-not $SkipTests) {
    Write-Section "门禁 3/3：test（全包，串行）"
    & pnpm test
    if ($LASTEXITCODE -ne 0) { throw "tests failed" }
  }
} finally {
  Pop-Location
}

Write-Section "结论：全绿"
