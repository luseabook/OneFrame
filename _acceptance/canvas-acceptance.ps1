<#
.SYNOPSIS
  画布（canvas）域前端可复跑验收。

.DESCRIPTION
  一条命令跑完四层门禁：
    1) typecheck（web + api）
    2) lint（只对 canvas 相关文件断言 0 error 0 warning）
    3) api 单测（canvas.spec 46 例 + agent.spec 13 例）
    4) 真实浏览器 E2E（68 项断言，含持久化/版本冲突/节点投递/模板/固定组/Agent 面板）

  前置：
    pwsh _acceptance/start-local-stack.ps1      # PG 55432 / Redis 6380
    pwsh _acceptance/start-wanxing-stack.ps1    # api 3002 / web 3003

.EXAMPLE
  pwsh _acceptance/canvas-acceptance.ps1
  pwsh _acceptance/canvas-acceptance.ps1 -SkipE2E     # 只跑静态门禁 + 单测
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

# ── 0. 前置检查 ───────────────────────────────────────────
# 只检查 api。**不检查 web**：web dev 由本脚本在第 4 步自己重启（见那里对 .nuxt
# 被 nuxt prepare 破坏的说明）。若在这里要求 web 已在线，会在"上一次运行把 web
# 起在后台、这次运行前被外部停掉"的场景下误报。
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

# ── 2. lint（只断言 canvas 相关文件）───────────────────────
if (-not $SkipLint) {
  Step "lint（canvas 相关文件必须 0 error 0 warning）" {
    Push-Location $App
    try {
      # 只对本次改动的文件断言；全站 lint 已有 13 条历史 warning 在别人文件里
      $out = & npx eslint apps/web/pages/canvas apps/web/components/canvas apps/web/composables/useCanvasEditor.ts apps/web/composables/useCanvasApi.ts apps/web/composables/useCanvasAgent.ts apps/web/types/canvas.ts apps/web/layouts/blank.vue apps/web/app.vue apps/web/nuxt.config.ts 2>&1
      $code = $LASTEXITCODE
      $text = ($out | Out-String)
      if ($code -ne 0) { throw "eslint 非零退出：`n$text" }
      if ($text -match 'warning|error') { throw "canvas 文件存在 lint 告警：`n$text" }
    } finally { Pop-Location }
  }
}

# ── 3. api 单测（canvas 域）──────────────────────────────
Step "api 单测（canvas.spec 46 例 + agent.spec 13 例）" {
  Push-Location $App
  try {
    # agent.spec 与 canvas.spec 共享 canvas 域夹具（会话挂在画布上），一起跑才覆盖"面板 → 后端"整链
    $out = & pnpm --filter @app/api test -- canvas.spec agent.spec 2>&1
    if ($LASTEXITCODE -ne 0) { throw "canvas/agent 单测失败" }
    $text = ($out | Out-String)
    # 断言两个 spec 都真的跑了（只匹配文件名不够：0 例也会打印 passed）
    if ($text -notmatch 'canvas\.spec\.ts \((\d+) tests?\)') { throw "未找到 canvas.spec 结果行" }
    if ($text -notmatch 'agent\.spec\.ts \((\d+) tests?\)') { throw "未找到 agent.spec 结果行" }
    if ($text -match 'failed') { throw "canvas/agent 单测有失败：`n$($text.Substring([Math]::Max(0,$text.Length-1500)))" }
  } finally { Pop-Location }
}

# ── 4. 浏览器 E2E ────────────────────────────────────────
if (-not $SkipE2E) {
  # 关键坑 1：typecheck 内部会跑 `nuxt prepare`，它重写 .nuxt 目录，而 nuxt dev 正从
  #           .nuxt 提供服务 → dev server 被打坏（页面弹 vite-error-overlay、
  #           `#app-manifest` 解析失败），E2E 会卡在"点登录没反应"。
  #           所以跑 E2E 前必须重启 web dev。
  # 关键坑 2：不能用 Start-Process + 重定向管道启动 nuxt dev —— 它是长寿进程，会一直
  #           持有父进程的 stdout 管道，导致本脚本所在的外层调用永远等不到 EOF
  #           （实测卡死 10 分钟）。必须用 UseShellExecute=$true 完全脱离。
  Step "重启 web dev（干净 .nuxt）" {
    $p = (Get-NetTCPConnection -State Listen -LocalPort 3003 -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
    if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
    Remove-Item -Recurse -Force (Join-Path $App "apps\web\.nuxt") -ErrorAction SilentlyContinue

    $env:NUXT_API_PROXY = "http://127.0.0.1:3002"
    $env:PORT = "3003"
    # UseShellExecute=$true ⇒ 子进程不继承本进程的 stdout/stderr 句柄，彻底脱离。
    Start-Process -FilePath "cmd.exe" `
      -ArgumentList "/c node ./node_modules/nuxt/bin/nuxt.mjs dev --port 3003 --host 127.0.0.1 > `"$Root\_acceptance\web-e2e.log`" 2>&1" `
      -WorkingDirectory (Join-Path $App "apps\web") `
      -WindowStyle Hidden | Out-Null

    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Seconds 2
      if (-not (Get-NetTCPConnection -State Listen -LocalPort 3003 -ErrorAction SilentlyContinue)) { continue }
      try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:3003/canvas" -UseBasicParsing -TimeoutSec 15
        if ($r.StatusCode -eq 200) {
          # 再确认真能拿到编译后的页面（Vite 首轮预构建完成），避免 E2E 首帧 404
          Start-Sleep -Seconds 6
          $r2 = Invoke-WebRequest -Uri "http://127.0.0.1:3003/canvas" -UseBasicParsing -TimeoutSec 15
          if ($r2.StatusCode -eq 200) { $ready = $true; break }
        }
      } catch {}
    }
    if (-not $ready) { throw "web dev 重启后未就绪，见 _acceptance/web-e2e.log" }
  }

  Step "浏览器 E2E（68 项断言，含 Agent 面板）" {
    Push-Location (Join-Path $Root "_acceptance")
    try {
      & node e2e-canvas-editor.cjs
      if ($LASTEXITCODE -ne 0) { throw "E2E 失败（见上方输出与 _acceptance/canvas-e2e/）" }
    } finally { Pop-Location }
  }
}
# ── 汇总 ─────────────────────────────────────────────────
Write-Host ""
Write-Host ("═" * 60) -ForegroundColor DarkGray
Write-Host "画布域验收汇总" -ForegroundColor Cyan
Write-Host ("═" * 60) -ForegroundColor DarkGray
foreach ($k in $results.Keys) {
  Write-Host ("  {0,-46} {1}" -f $k, $results[$k])
}
Write-Host ""
Write-Host "产物：_acceptance/canvas-e2e/（截图 + result.json）" -ForegroundColor DarkGray
Write-Host "✅ 画布域验收全部通过" -ForegroundColor Green









