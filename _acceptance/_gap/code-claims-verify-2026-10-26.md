# 代码级声明复核（D1–D9）· 2026-10-26

> 复核人：code-verifier（共享任务 `task-2`）
> 工作区 `E:\wanxing`，代码 `E:\wanxing\app`；被核版本 `git HEAD = 8e25f53`（2026-10-25T22:21:22+08:00），分支 `main`
> 方法：**只读**。全部结论来自本次实际读到的行（`read`/`grep`/单文件静态命令）；未运行 `pnpm -w test`（另一 owner 在跑），未启动任何服务进程，未修改任何源码。
> 对照版本：`deliverables/software-company/wanxing-gap-to-final-product-2026-10-25.md`（205 行，未跟踪文件）

---

## 0. 结论速览

**9 条声明中：7 条证实，1 条部分推翻（D5 的 `sentry` 计数），1 条需修正路径后仍证实（D4）。另有 1 处行号引用可更精确（D2），1 处口径需注明（D1 的 `.vue` 行数）。**

---

## 1. 逐条复核表

| 编号 | 声明 | 结论 | 证据（文件:行） | 备注 |
|---|---|---|---|---|
| **D1** | `app/apps/web/package.json` 无 lint/typecheck，`test` 是 no-op | **证实** | `app/apps/web/package.json:5-11`（scripts 仅 `dev`/`build`/`generate`/`postinstall`/`test`，**无 `lint`、无 `typecheck`**）；`:10` `"test": "echo 'web e2e lands in P2' && exit 0"` | 根 `app/package.json:13` `test: turbo run test` → web 的 no-op 脚本作为独立 turbo 任务**恒成功**，计入"测试通过" |
| D1-b | `.vue` 总行数（web 侧） | **证实（需注明口径）** | 43 个 `.vue` 文件；物理行（`\n` 计数）**17,457**；非空行 **16,488** | 上一版报告的 16,488 = **非空行**口径（`Get-Content \| Measure-Object -Line` 会跳过空行）。与 `wc -l` 口径相差 969 行（空行/纯空白行） |
| **D2** | `LLM_MODE=real` 且缺 `DEEPSEEK_API_KEY` 时回落 mock 且不报错 | **证实** | `app/apps/api/src/modules/script/llm.service.ts:68-75`（三元：`env.LLM_MODE === "real" && env.DEEPSEEK_API_KEY ? new DeepSeekChatAdapter(...) : null`）；`:78-92`、`:102-111`、`:120-132`、`:141-157`、`:179-201` 五处 `if (!this.deepseek)` 直接 `schema.parse(mock 数据)` 返回 | 降级路径**无 throw、无 warn 日志**；只有 `:220`（real 分支内）才抛 "LLM not configured"，而 real+缺 Key 时根本走不到那里 |
| D2-b | `app/apps/api/src/config/env.ts` 生产守卫 **不覆盖** 该组合 | **证实** | `env.ts:222-257`（`collectProductionProblems` 全函数）：`:227-239` JWT_SECRET/PHONE_HMAC_PEPPER/PHONE_ENC_KEY、`:241-249` ADMIN_USERNAME/ADMIN_PASSWORD、`:251-253` COOKIE_SECURE、`:255` `collectPaymentProblems` | 函数体内**无任何 `LLM_MODE` / `DEEPSEEK_API_KEY` 分支**；`app/` 内 `LLM_MODE` 仅 3 处：代码 2 处（`env.ts:106` schema 定义，默认 `mock`；`llm.service.ts:69` 消费它）+ 配置示例 1 处（`.env.production.example:38`）→ 不存在第二道守卫 |
| D2-c | 与 worker"缺 Key 硬失败"策略不一致 | **证实** | worker 侧 `env-guard.ts:36-44`（生产必须至少一种真实供应商，否则拒绝启动）vs api 侧无对应检查 | `.env.production.example:38-39` 恰好就是危险组合：`LLM_MODE=real` + `DEEPSEEK_API_KEY=`（空） |
| **D3** | `worker/src/main.ts` 声明哪些队列 | **证实** | 声明本体在 `app/apps/worker/src/queues.ts:6-13`（`main.ts:9` import，`:207` 遍历消费）：`gen.submit`、`gen.poll`、`result.transfer`、`notify`、`export.zip`、`timeline.export` = **6 个** | api 侧重复了同一份定义：`app/apps/api/src/queue/queue.service.ts:5-12` |
| D3-b | 实际有生产者 **3 个**；`gen.poll`/`result.transfer`/`notify` 无生产者 | **证实** | `queue.service.ts:30-32` 只 `new Queue` 3 个（GEN_SUBMIT/EXPORT/TIMELINE_EXPORT）；`.add(` 仅 `:36`、`:50`、`:64` 三处 | 全仓 `@InjectQueue` **0 命中**；`new Queue(` **3 命中**；`gen.poll`/`result.transfer`/`notify` 字面量在源码中只出现在两份声明里，无任何 `.add(`。worker 消费后落 no-op：`main.ts:229-230`（`log.info(... "job received (no-op)"); return { ok: true }`） |
| D3-c | 轮询在 job 内 for/sleep 占用并发槽 | **证实** | `app/apps/worker/src/executor.ts:290-317`：`:290` `interval = deps.pollIntervalMs ?? 1000`、`:291` `deadline = Date.now() + (deps.maxPollMs ?? 120_000)`、`:292` `for (;;)`、`:316` `await sleep(interval)` | 单 job 最长占用 **120s**（=默认 `maxPollMs`；`main.ts:126` `POLL_MAX_MS ?? 120_000`），期间不释放槽 |
| D3-d | 并发数默认值 | **证实** | `main.ts:234` `concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5)` | 默认 **5**；`worker` 服务同时消费 6 个队列（`main.ts:207-237`），即 6 个 Worker 各自 concurrency=5 |
| D3-e | `attempts` 值 | **证实** | `queue.service.ts:42`（submit）、`:56`（export）、`:69`（timeline-export）均为 `attempts: 1` | 与上一版"重启即丢轮询进度"一致（无重试） |
| D3-f | 注释声称的 delayed job 未实现 | **证实（超出声明但重要）** | `queues.ts:4` 注释"delayed job（5s 起指数退避 ≤30s）" vs `executor.ts:290-317` 实现 | 声明与实现不一致 |
| **D4** | `canvas*` 4 张设计占位表在代码 schema 中是否存在 | **证实"不存在"**；**路径需修正** | 设计侧确有 4 张：`docs/02-architecture/database.md:481` `canvases`、`:485` `canvas_nodes`、`:494` `canvas_edges`、`:499` `canvas_snapshots`。代码侧：`app/packages/db` 全目录 `(?i)canvas` **0 命中**（`schema.ts` 亦然） | ⚠️ **任务书中的 `app/apps/db` 不存在**；schema 实际在 `app/packages/db/src/schema.ts`，migration 在 `app/apps/api/drizzle/` |
| D4-b | 实际表总数 | **证实 = 29** | 13 个 migration 中 `CREATE TABLE "..."` 共 **29** 条；`schema.ts` 中 `pgTable(` 亦 **29** 次 | 29 表名单：admin_users, asset_folders, assets, content_reports, credit_accounts, credit_flows, episodes, exports, idempotency_records, identities, invite_codes, invite_redemptions, model_prices, models, orders, project_assets, project_timelines, script_projects, skus, space_members, spaces, storyboard_assets, storyboards, task_events, task_shares, tasks, timeline_exports, users, waitlist_entries（**无任何 canvas\***） |
| D4-c | migration 数量（0000–00xx） | **证实 = 13 个（0000–0012）** | `app/apps/api/drizzle/0000_large_the_anarchist.sql` … `0012_left_deathbird.sql` | 目录 `app/apps/api/drizzle/`；`packages/db` 下无 migrations 目录（0 文件） |
| **D5** | 全仓搜 `event-stream` / `EventSource` / `analytics` / `sentry` / 事件上报端点 → 命中数 | **部分推翻**（"sentry 0 命中"不成立） | **口径 A（产品代码 `app/`，排除 node_modules/dist/.turbo/.mimosa/.nuxt/.output）**：`event-stream` **0**、`EventSource` **0**、`analytics` **0**、`sendBeacon` **0**、`sentry` **1** = `app/apps/api/src/common/logging/request-log.ts:19` 注释「error 由 exception.filter 与 Sentry 承担，避免重复刷屏」<br>**口径 B（整个 `E:\wanxing`，再排除第三方逆向产物 `rea-reelmate/`、快照 `_acceptance/ref/`、我方报告 `deliverables/`+`_acceptance/_gap/`）**：`event-stream` 0、`EventSource` 0、`analytics` 0、`sendBeacon` 0、**`sentry` 18 次 / 16 行**（`docs/**` 12 行 + `.workbuddy/memory` 1 + `复刻蓝图.md` 1 + `_acceptance/reelmate/index.html` 参照站快照 1 + 产品代码 1）<br>**端点**：`/v1/events` **0**、`@Post("events` **0**、`@Sse`/`text/event-stream` **0** | 上一版 G3-2 写"`analytics`/`sentry` **0 命中**"→ **`sentry` 不成立**：产品代码 1 处、全工作区 17 处（但**无 SDK 依赖、无初始化、无 DSN**，仅注释/文档措辞）→ "无埋点实现"的实质结论**成立**，**计数表述需修正**。⚠️ 若按"只排除 node_modules/dist/.turbo"的字面全仓口径，`sentry`/`analytics`/`sendBeacon` 会被 `rea-reelmate/scripts-canvas/**/vendor-sentry-*.js`（竞品 bundle 逆向副本）与 `chrome-profile` 缓存刷成数百上千命中，**不代表本产品代码** |
| D5-b | 是否存在事件上报端点 | **证实不存在** | api 侧 0 端点；内部事件表 `task_events` 存在并在 4 个服务中写入（`taskEvents` 共 18 处：generations.service.ts 3 / script.service.ts 2 / tasks.service.ts 6 / executor.ts 5 / schema.ts 1 / schema.spec.ts 1） | `task_events` 是**服务端任务流水**，不是客户端埋点上报通道；管理后台漏斗由它聚合 |
| D5-c | 进度"全靠 setInterval" | **证实** | web 侧 17 处 `setInterval` 命中，关键：`components/VideoGenWorkspace.vue:333`、`pages/tasks.vue:159`（5s 轮询）、`pages/projects/[id].vue:297,389,429,1369`、`pages/pricing.vue:218` | 无 `EventSource`，无 SSE 端点 |
| **D6** | 控制器数 | **证实 = 17** | `app/apps/api/src` 下 `@Controller(` **17 行**；`export class *Controller` 亦 **17 行**（15 个文件；`modules/admin/admin.controller.ts:35,50` 与 `modules/tasks/task-share.controller.ts:8,19` 各含 2 个控制器类） | 17 个控制器**类**，分布在 15 个文件 |
| D6-b | 端点/路由数 | **证实 = 112** | `app/apps/api/src` 下 `@(Get\|Post\|Patch\|Delete\|Put)(` = **112 行**（排除 `*.spec.ts` 后同为 112） | 全局前缀 `v1`：`apps/api/src/main.ts:30` `setGlobalPrefix("v1")` → 对外路径为 `/v1/...` |
| D6-c | web 页面路由数 | **证实 = 20** | `app/apps/web/pages` 下 `.vue` = **20 个**（文件即路由）：admin/index, admin/login, assets, create/image-to-video, create/text-to-video, credits, home, index, login, pricing, privacy, projects/[id], projects/index, report, settings, share/[token], tasks, terms, tools, works | index.vue → `/`，其余按路径映射；含 2 个动态路由段 |
| D6-d | 测试文件数 | **证实 = 45** | `*.spec.ts`/`*.test.ts`（排除 node_modules/dist/.turbo）= **45**：api 25 / worker 7 / model-adapters 7 / storage 3 / shared 2 / db 1 / **web 0** | 与上一版分布逐项一致 |
| **D7** | 未提交改动 | **证实** | `git status --porcelain`（2 行）：` M app/apps/web/components/Director3D.vue`、`?? deliverables/software-company/wanxing-gap-to-final-product-2026-10-25.md`；`git diff --stat`：`1 file changed, 261 insertions(+), 10 deletions(-)`；`git log -1 --format='%h %cI'`：`8e25f53 2026-10-25T22:21:22+08:00`；`git diff --cached --stat` 为空（无暂存内容） | 唯一代码改动 = `Director3D.vue` +261/−10，与上一版报告头部的记载**完全一致**；另 1 个未跟踪文件即上一版报告自身 |
| **D8** | `docker-compose.prod.yml` 中 `ADAPTER_MODE` 默认值 | **证实 = `mock`** | `app/docker-compose.prod.yml:119` `ADAPTER_MODE: ${ADAPTER_MODE:-mock}` | 注释性证据：`:117-118` 同段为 `AI_LABEL_*`；`:4` `NODE_ENV: production`（anchor `x-app-env`），`:116` worker `<<: *app-env` → worker 拿到 `NODE_ENV=production` |
| D8-b | worker 是否在 mock 下拒绝启动（守卫代码行） | **证实** | `app/apps/worker/src/env-guard.ts:29-34`：`const adapterMode = (env.ADAPTER_MODE ?? "").trim(); if (adapterMode !== "real") { problems.push("ADAPTER_MODE 必须为 real（当前：…）；生产禁止 mock 生成"); }`；调用点 `main.ts:21` `assertWorkerEnv(process.env)`（import `main.ts:5`）；抛错 `env-guard.ts:49-53` | 第二道守卫：`env-guard.ts:36-44`（至少一种真实供应商 ARK_API_KEY / DEEPSEEK_API_KEY / HTTP_VIDEO_BASE_URL）。**推论**：用默认 compose 起 worker（不显式设 `ADAPTER_MODE`）→ 启动即抛错退出 |
| **D9** | ffmpeg/ffprobe 缺失时 AI 标识是否静默降级 | **证实（降级不报错），但"静默"需限定** | `app/apps/worker/src/label.ts:26-27` 注释「无 ffmpeg 或媒体不可解码时降级为仅隐式标识，并记录 explicit_reason」；`:70-85` 显式水印在 `try` 内，`:83-85` `catch` **只写** `label.explicit_reason`（截断 200 字符）**不 rethrow**；`:56-68` 隐式 sidecar（`<uri>.ai.json`）仍写入；`:88-89` 结果写回 `meta.ai_label` 并 `log?.(...)` | 任务**不失败**：`executor.ts:81-89` 直接使用 `labelResults` 返回值继续落库成功 → 用户侧无感知。**留痕**：`meta.ai_label.explicit_reason` + 日志，所以不是"完全无痕"，但订单/API 响应层无错误。行为已被单测固化：`label.spec.ts:25-31`（`ffmpegPath: "false"` → "degrades explicit"） |
| D9-b | ffprobe 在标识链路中的位置 | **证实（label.ts 不涉及 ffprobe）** | `label.ts` 仅用 `config.ffmpegPath ?? "ffmpeg"`（`:134`），无 ffprobe；ffprobe 仅用于成片合成 `timeline-export.ts:69-80`（`hasVideoStream`，失败返回 `false`）与 `main.ts:136` 配置 | 声明把 "ffmpeg/ffprobe" 合写，实际两条链路不同 |
| D9-c | 成片合成路径**不**静默降级（对照） | **证实** | `timeline-export.ts:301` `await run(ffmpeg, args, ...)`；`:333-344` catch → `status: 4` + `error { code: 500000 }`；单测 `test/timeline-export.spec.ts:177-183`（"fails with a clear error (status 4) when ffmpeg is missing"） | 即"任务结果标识"静默降级、"成片合成导出"硬失败——两条路径策略不同 |

---

## 2. 本次使用的命令（可复现）

```powershell
# D1：web 脚本表
#   直接 read app/apps/web/package.json（5-11 行）
# D1-b：.vue 文件数 + 行数（两种口径）
$f = Get-ChildItem -Path E:\wanxing\app\apps\web -Recurse -Filter *.vue -File |
     Where-Object { $_.FullName -notmatch '\\node_modules\\|\\dist\\|\\.turbo\\' }
"FILES=$($f.Count)"
$nl=0; $nb=0
foreach ($x in $f) { $raw=[IO.File]::ReadAllText($x.FullName)
  $nl += ([regex]::Matches($raw,"`n")).Count
  $nb += ($raw -split "`r?`n" | Where-Object { $_.Trim() -ne '' }).Count }
"PHYSICAL_LINES=$nl  NONBLANK_LINES=$nb"     # → 17457 / 16488

# D2：LLM 守卫覆盖 —— 只扫守卫函数体（env.ts:222-257），确认不含 LLM 判断
Get-Content E:\wanxing\app\apps\api\src\config\env.ts | Select-Object -Skip 221 -First 36 |
  Select-String -Pattern 'LLM_MODE|DEEPSEEK'                                                  # 0 命中
Get-ChildItem E:\wanxing\app -Recurse -File -Include *.ts,*.example |
  Select-String -Pattern 'LLM_MODE'                                                          # 3 处（代码 2 + 示例 1）

# D3：生产者
Get-ChildItem E:\wanxing\app -Recurse -File -Include *.ts | Select-String -Pattern 'new Queue\(|\.add\(|@InjectQueue'
#   → new Queue( ×3（queue.service.ts:30-32）；.add( ×3（:36,:50,:64）；@InjectQueue ×0

# D4：表与 migration
$sql = Get-ChildItem E:\wanxing\app\apps\api\drizzle -File -Filter *.sql
"MIGRATIONS=$($sql.Count)"                                                                   # 13
($sql | Select-String -Pattern 'CREATE TABLE (?:IF NOT EXISTS )?"([^"]+)"' -AllMatches |
  ForEach-Object { $_.Matches } | Measure-Object).Count                                      # 29
Select-String -Path E:\wanxing\app\packages\db\src\schema.ts -Pattern '(?i)canvas'           # 0 命中

# D5：埋点/SSE —— 必须显式定义排除集，否则计数无意义
#   口径 A（产品代码）
$reA = '\\node_modules\\|\\dist\\|\\.turbo\\|\\.mimosa\\|\\.nuxt\\|\\.output\\'
#   口径 B（整个工作区，再排除第三方逆向产物 rea-reelmate/、参照快照 _acceptance/ref/、我方报告）
$reB = $reA + '|\\rea-reelmate\\|_acceptance\\ref\\|deliverables\\|_acceptance\\_gap\\'
foreach ($k in 'event-stream','EventSource','analytics','sentry','sendBeacon') {
  $m = Get-ChildItem E:\wanxing -Recurse -File |
    Where-Object { $_.Extension -in '.ts','.js','.vue','.md','.json','.html' -and $_.FullName -notmatch $reB } |
    Select-String -Pattern $k -AllMatches
  "$k = $($m.Count)"
}                                                                   # → 0,0,0,18,0（sentry 逐处：见第 3 节）
#   端点类
Get-ChildItem E:\wanxing\app -Recurse -File -Include *.ts |
  Select-String -Pattern '@Sse|text/event-stream|/v1/events|@Post\("events'   # 0 命中

# D6：控制器 / 端点 / 页面 / 测试
(Get-ChildItem E:\wanxing\app\apps\api\src -Recurse -File -Filter *.ts |
  Select-String -Pattern '@Controller\(').Count                                              # 17
(Get-ChildItem E:\wanxing\app\apps\api\src -Recurse -File -Filter *.ts |
  Where-Object { $_.Name -notmatch '\.spec\.ts$' } |
  Select-String -Pattern '@(Get|Post|Patch|Delete|Put)\(' -AllMatches |
  ForEach-Object { $_.Matches } | Measure-Object).Count                                      # 112
(Get-ChildItem E:\wanxing\app\apps\web\pages -Recurse -File -Filter *.vue).Count              # 20
(Get-ChildItem E:\wanxing\app -Recurse -File -Include *.ts |
  Where-Object { $_.FullName -notmatch '\\node_modules\\|\\dist\\|\\.turbo\\' -and $_.Name -match '\.(spec|test)\.ts$' }).Count  # 45

# D7：工作区状态
cd E:\wanxing\app; git status --porcelain; git diff --stat; git log -1 --format='%h %cI %s'

# D8：compose 默认值与守卫
Select-String -Path E:\wanxing\app\docker-compose.prod.yml -Pattern 'ADAPTER_MODE|NODE_ENV'
Select-String -Path E:\wanxing\app\apps\worker\src\env-guard.ts -Pattern 'ADAPTER_MODE|real'
```

---

## 3. 与上一版报告（`wanxing-gap-to-final-product-2026-10-25.md`）不一致之处

| # | 上一版位置 | 上一版写法 | 本次实测 | 判定 |
|---|---|---|---|---|
| 1 | `:27`（§1 速览）与 G0-5 | 「`.vue` 共 **16,488** 行」「**16,488 行** `.vue` 不进门禁」 | 非空行 = 16,488 ✔；**物理行 = 17,457** | **口径需注明**（非空行 vs 物理行差 969 行）。数字本身不是错误，但不写口径会与 `wc -l` 对不上 |
| 2 | `:113` G3-2 | 「`analytics`/`sentry`/`埋点` **0 命中**」 | `analytics` 0 ✔（两种口径皆 0）；`sentry` **产品代码 1 行**（`app/apps/api/src/common/logging/request-log.ts:19` 注释）、**全工作区（排除第三方产物）18 次 / 16 行**（`docs/**` 12 + `.workbuddy/memory` 1 + `复刻蓝图.md` 1 + `_acceptance/reelmate/index.html` 快照 1 + 产品代码 1） | **部分推翻 → 需修正表述**：应为"产品代码内无任何埋点实现；Sentry 仅 1 处注释提及（无依赖/初始化/DSN），全工作区另有 15 行文档/快照侧措辞"。G3-2 的实质结论（无埋点体系、无上报端点）**成立** |
| 3 | `:102` G2-2 | 守卫位置写作 `env.ts:227-255` | 守卫函数实际为 **`env.ts:222-257`**（227-255 只覆盖其中"必填密钥/管理员/Cookie/支付"部分，恰好不含任何 LLM 判断） | **行号需修正**（不影响结论：确实不覆盖 LLM 组合） |
| 4 | 任务书 D4 路径 | `app/apps/db` 全量 schema | **该路径不存在**；schema = `app/packages/db/src/schema.ts`，migration = `app/apps/api/drizzle/0000…0012` | **路径需修正**；结论（4 张 `canvas*` 表不存在于 29 表）**仍成立** |
| 5 | — | 其余数字 | 20 页面 / 112 端点 / 17 `@Controller` / 29 表 / 13 migration（0000–0012）/ 6 队列中 3 个有生产者 / 45 测试文件（web 0）/ `Director3D.vue` +261−10 / HEAD `8e25f53` 2026-10-25T22:21:22+08:00 / `ADAPTER_MODE` 默认 `mock` | **全部逐项一致，无差异** |

### 上一版未写、但本次复核新增的事实（建议补入）

1. **D3 注释与实现不符**：`queues.ts:4` 声称 `gen.poll` 是"delayed job（5s 起指数退避 ≤30s）"，实际是 `executor.ts:292-316` 的 job 内同步轮询。
2. **D2 最危险的组合就写在示例环境文件里**：`.env.production.example:38-39` = `LLM_MODE=real` + `DEEPSEEK_API_KEY=`（空）→ 直接命中静默降级路径。
3. **D8 的双重守卫**：除 `ADAPTER_MODE !== "real"` 外，`env-guard.ts:36-44` 还要求至少一种真实供应商 Key；两层都会 fail fast。
4. **D9 两条链路策略不同**：任务结果标识静默降级（`label.ts:83-85`），成片合成导出硬失败 status 4（`timeline-export.ts:333-344`）。
5. **web 的 no-op 测试会拉高"通过率"**：根脚本 `test: turbo run test`（`app/package.json:13`）把 web 的 `echo … && exit 0` 计入成功任务。
6. **全仓 grep 的噪声源（口径必须写明）**：`E:\wanxing` 下有三类非产品代码会污染关键词计数——①`rea-reelmate/scripts-canvas/**` 与 `rea-reelmate/chrome-profile/**`（竞品 bundle 逆向副本 + 浏览器缓存，`vendor-sentry-*.js` 一处就贡献大量 `sentry` 命中）；②`.mimosa/hook-state/**`（源码基线快照，如 `queues.ts`/`queue.service.ts` 副本，使 `gen.poll` 从源码 5 处变 15 处）；③`_acceptance/ref/*.html`（保存的参照页快照，含第三方 analytics/sentry script 标签）。**本次所有"全仓"计数均已显式排除上述目录**，否则同一关键词可相差 2–3 个数量级。

---

## 4. 无法验证的（本次明确未做）

| 项 | 原因 / 边界 |
|---|---|
| 裸跑 `pnpm -w test` 的真实红/绿与抖动 | **按要求未运行**（另一 owner 正在跑，避免互相干扰）。上一版 G0-1/G0-2/G0-4 的门禁结论本次**未复核**，本报告不对其表态 |
| `LLM_MODE=real` 且缺 Key 的**运行期**行为 | 未启动 api 进程；D2 结论是**静态代码路径判定**（`llm.service.ts:68-75` 三元 + 各方法 `if (!this.deepseek)` 分支），非运行时观测 |
| worker 在默认 compose 下**实际**启动失败 | 未执行 docker（本机亦无 docker CLI 记录）；D8 结论是守卫代码路径 + compose 变量解析的静态判定 |
| 无 ffmpeg 环境下 `meta.ai_label` 的最终内容 | 未运行 worker；仅由 `label.spec.ts:25-31` 单测源码与 `label.ts:83-85` 代码路径佐证 |
| `sentry` 是否曾存在于历史提交 | 本次只核当前树（含 `.mimosa` 基线副本）；未做 `git log -S` 历史检索 |
| 5 个适配器数量、`impl-state.md` 其它章节的引用 | 不在 D1–D9 范围，本次未复核 |

---

## 5. 复核边界声明

- 本报告所有结论均可由第 2 节命令复现；行号以本次读取为准（HEAD `8e25f53` + 工作区 `Director3D.vue` 未提交改动；**该改动与 D1–D9 全部证据文件无交集**）。
- 未修改任何被核查源码；本次唯一写入的文件即本文件。
- 对"文档目标值"（`docs/**`、`_acceptance/_gap/**`）只引用其行号作为设计侧对照，不代表已独立核实其业务主张。
