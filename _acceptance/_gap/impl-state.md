# 实现现状基线（impl-state）：app/ 代码侧实际能力盘点

- 盘点对象：`E:\wanxing`，代码在 `app/`（pnpm + turbo monorepo）
- 盘点方式：只读。路径引用均相对工作区根 `E:\wanxing`，格式 `文件:行`
- 关键口径：**"代码里存在" ≠ "能真实跑"**。本文对每条能力都标注了「存在 / 需外部前置 / 实测」三态，并在 §9 集中列差异
- 本文件为唯一产出物；未修改任何代码/测试/配置

---

## 0. 关键数字一览

| 指标 | 数值 | 直接证据 |
|---|---|---|
| workspace 数量 | 7（3 apps + 4 packages） | `app/pnpm-workspace.yaml:1-3` |
| web 页面路由数 | 20 | `app/apps/web/pages/**`（§2 全表） |
| API 端点数 | 112 | §3 全表，逐条对应路由装饰器（`Select-String '@(Get\|Post\|Put\|Patch\|Delete)\('` = 112，`@Controller` = 17） |
| 其中无鉴权端点 | 18 | §3.10 |
| 数据库表数 | 29 | `app/packages/db/src/schema.ts`（29 处 `pgTable(`）+ 13 个 migration |
| migration 数 | 13（0000–0012） | `app/apps/api/drizzle/meta/_journal.json:5-88` |
| 队列数（声明/实际有生产者） | 6 / 3 | `app/apps/worker/src/queues.ts:6-13`、`app/apps/api/src/queue/queue.service.ts:30-32` |
| 定时维护任务数 | 5 | `app/apps/worker/src/main.ts:164-205` |
| 适配器实现数 | 5（1 mock + 4 real 协议） | `app/packages/model-adapters/src/registry.ts:48-92` |
| 测试文件数 | 45 | `git ls-files app \| grep -E '\.(spec\|test)\.ts$'` |
| 最近一次全量测试（历史证据） | 299 passed / 1 skipped | `_acceptance/b-type-acceptance-run.log:22` |
| 本次单包实测 | model-adapters 87 passed | 见 §8.4 |

---

## 1. 结构与职责

| 单元 | 职责（代码注释口径） | 证据 |
|---|---|---|
| `apps/api` | NestJS 模块化单体：auth/models/credits/quote/generations/tasks/assets/billing/admin/script/reports/health | `app/apps/api/src/app.module.ts:24-44` |
| `apps/worker` | BullMQ Worker：生成执行器、导出 zip、成片合成、定时维护（对账/看门狗/清理） | `app/apps/worker/src/main.ts:1-12,207-237` |
| `apps/web` | Nuxt3 前端（SSR + 客户端轮询），`/v1/**` 反代到 api | `app/apps/web/nuxt.config.ts:15-38` |
| `packages/shared` | 信封/错误码/雪花 ID/领域枚举/Zod schema | `app/packages/shared/src/index.ts` |
| `packages/db` | drizzle schema + ledger 记账 | `app/packages/db/src/schema.ts`、`app/packages/db/src/ledger.ts` |
| `packages/storage` | local / S3 双驱动 + 预签名 URL | `app/packages/storage/src/local.ts`、`app/packages/storage/src/s3.ts` |
| `packages/model-adapters` | 供应商适配器（mock / DeepSeek / Ark 视频 / Ark 图像 / 通用 HTTP） | `app/packages/model-adapters/src/registry.ts:48-92` |
| 根脚本 | `dev/build/typecheck/lint/test` 全部走 turbo | `app/package.json:9-15`、`app/turbo.json:11-33` |

> 注意：`apps/web` **只定义 `dev/build/generate/postinstall/test`**（`app/apps/web/package.json:5-11`），没有 `typecheck`、没有 `lint`，且 `test` 是 `echo 'web e2e lands in P2' && exit 0`（同文件 :10）。因此全仓 `pnpm typecheck` / `pnpm lint` 覆盖 6/7 个包，`.vue` 文件不进门禁。

---

## 2. 【路由表】web 页面（20 条）

Nuxt 文件路由，无 `server/` 目录 → **web 侧不存在 Nitro 服务端接口**，全部数据来自 `apps/api`（`app/apps/web/composables/useApi.ts:27`）。

| # | 路由 | 文件:行 | 布局 | 鉴权 | 实现状态 | 体量(行) |
|---|---|---|---|---|---|---|
| 1 | `/` | `app/apps/web/pages/index.vue:1` | default | 公开 | 整页实现（落地页） | 612 |
| 2 | `/home` | `app/apps/web/pages/home.vue:1` | app | requiresAuth | 整页实现 | 652 |
| 3 | `/login` | `app/apps/web/pages/login.vue:1` | default | 公开 | 整页实现（短信+邀请码+微信扫码） | 698 |
| 4 | `/pricing` | `app/apps/web/pages/pricing.vue:1` | app | requiresAuth | 整页实现 | 872 |
| 5 | `/works` | `app/apps/web/pages/works.vue:1` | app | requiresAuth | 整页实现 | 402 |
| 6 | `/tasks` | `app/apps/web/pages/tasks.vue:1` | app | requiresAuth | 整页实现（轮询/ETag/批量下载） | 584 |
| 7 | `/assets` | `app/apps/web/pages/assets.vue:1` | app | requiresAuth | 整页实现（上传/标签/回收站） | 361 |
| 8 | `/credits` | `app/apps/web/pages/credits.vue:1` | app | requiresAuth | 整页实现（积分流水） | 244 |
| 9 | `/settings` | `app/apps/web/pages/settings.vue:1` | app | requiresAuth | 整页实现（含注销入口） | 165 |
| 10 | `/tools` | `app/apps/web/pages/tools.vue:1` | app | requiresAuth | 整页实现（工具箱入口） | 242 |
| 11 | `/projects` | `app/apps/web/pages/projects/index.vue:1` | app | requiresAuth | 整页实现 | 327 |
| 12 | `/projects/:id` | `app/apps/web/pages/projects/[id].vue:1` | app | requiresAuth | 整页实现（流水线全流程+3D 导演台） | 4190 |
| 13 | `/create/text-to-video` | `app/apps/web/pages/create/text-to-video.vue:1-9` | tool | requiresAuth | 薄壳（复用 `VideoGenWorkspace`，非占位） | 8 |
| 14 | `/create/image-to-video` | `app/apps/web/pages/create/image-to-video.vue:1-8` | tool | requiresAuth | 薄壳（复用 `VideoGenWorkspace`） | 8 |
| 15 | `/share/:token` | `app/apps/web/pages/share/[token].vue:1` | default | 公开 | 整页实现（公开只读） | 275 |
| 16 | `/report` | `app/apps/web/pages/report.vue:1` | default | 公开 | 整页实现（举报通道） | 186 |
| 17 | `/terms` | `app/apps/web/pages/terms.vue:1` | default | 公开 | 整页实现 | 137 |
| 18 | `/privacy` | `app/apps/web/pages/privacy.vue:1` | default | 公开 | 整页实现 | 147 |
| 19 | `/admin/login` | `app/apps/web/pages/admin/login.vue:1` | admin-login | 公开 | 整页实现（独立登录页） | 141 |
| 20 | `/admin` | `app/apps/web/pages/admin/index.vue:1` | admin | admin-auth 中间件 | 整页实现（7 个运营面板，query 驱动） | 538 |

**布局 / 中间件 / 组件**

| 项 | 数量 | 证据 |
|---|---|---|
| layouts | 5：`default/app/admin/admin-login/tool` | `app/apps/web/layouts/{default,app,admin,admin-login,tool}.vue` |
| middleware | 2：`auth.global.ts`（requiresAuth→跳登录）、`admin-auth.ts`（admin_token→跳 /admin/login） | `app/apps/web/middleware/auth.global.ts:1-9`、`app/apps/web/middleware/admin-auth.ts:4-8` |
| 组件 | 16 个（含 `Director3D.vue` 1112 行、`VideoGenWorkspace.vue` 1380 行、`CreateProjectModal.vue` 678 行） | `app/apps/web/components/` |
| `.vue` 总代码量 | 16488 行 | `Get-ChildItem apps/web -Recurse -Filter *.vue` 求和 |

**占位页检查**：全量搜索 `占位|TODO|施工中|待实现|coming soon` 后，web 页面内**没有任何整页占位**；5 处命中均为业务文案或 3D 兜底（`app/apps/web/pages/projects/[id].vue:966,2156`、`app/apps/web/components/Director3D.vue:224,277,717`）。

---

## 3. 【端点表】API（112 条）

全局前缀 `v1`（`app/apps/api/src/main.ts:30`）；全局 `AuthGuard` 作为 `APP_GUARD`（`app/apps/api/src/app.module.ts:43`），`@Public()` 跳过（`app/apps/api/src/common/auth.guard.ts:19-23`）。下列路径均**不含** `/v1` 前缀，实际对外为 `/v1<path>`。

### 3.1 基础 / 可运维（6）
| Method | Path | 证据 |
|---|---|---|
| GET | `/ping` | `app/apps/api/src/app.controller.ts:8` |
| GET | `/healthz/live` | `app/apps/api/src/health/health.controller.ts:19` |
| GET | `/healthz/ready` | `app/apps/api/src/health/health.controller.ts:26` |
| GET | `/healthz` | `app/apps/api/src/health/health.controller.ts:43` |
| GET | `/metrics` | `app/apps/api/src/health/metrics.controller.ts:21` |
| GET | `/files/local` | `app/apps/api/src/storage/files.controller.ts:22` |

### 3.2 auth / me（8）
| Method | Path | 鉴权 | 证据 |
|---|---|---|---|
| POST | `/auth/sms-code` | Public | `app/apps/api/src/modules/auth/auth.controller.ts:27`（Public :26） |
| POST | `/auth/login` | Public | `...auth.controller.ts:34`（Public :33） |
| POST | `/auth/refresh` | Public | `...auth.controller.ts:44`（Public :43） |
| POST | `/auth/logout` | Bearer | `...auth.controller.ts:53` |
| GET | `/me` | Bearer | `...auth.controller.ts:62` |
| POST | `/me/onboarded` | Bearer | `...auth.controller.ts:70` |
| POST | `/me/delete` | Bearer | `...auth.controller.ts:78` |
| POST | `/waitlist` | Public | `...auth.controller.ts:88`（Public :87） |

### 3.3 models / credits / generations（5）
| Method | Path | 证据 |
|---|---|---|
| GET | `/models` | `app/apps/api/src/modules/models/models.controller.ts:8` |
| POST | `/credits/quote` | `app/apps/api/src/modules/credits/credits.controller.ts:16` |
| POST | `/credits/quote/batch` | `...credits.controller.ts:32` |
| GET | `/credits/flows` | `...credits.controller.ts:22` |
| POST | `/generations` | `app/apps/api/src/modules/generations/generations.controller.ts:11` |

### 3.4 tasks / share（9）
| Method | Path | 鉴权 | 证据 |
|---|---|---|---|
| GET | `/tasks` | Bearer | `app/apps/api/src/modules/tasks/tasks.controller.ts:13` |
| POST | `/tasks/batch-download` | Bearer | `...tasks.controller.ts:45` |
| GET | `/tasks/:id` | Bearer | `...tasks.controller.ts:54` |
| POST | `/tasks/:id/cancel` | Bearer | `...tasks.controller.ts:59` |
| POST | `/tasks/:id/retry` | Bearer | `...tasks.controller.ts:64` |
| GET | `/tasks/:id/results/:n/download-url` | Bearer | `...tasks.controller.ts:69` |
| GET | `/share/:token` | Public | `app/apps/api/src/modules/tasks/task-share.controller.ts:13`（Public :12） |
| POST | `/tasks/:id/share` | Bearer | `...task-share.controller.ts:23` |
| DELETE | `/tasks/:id/share` | Bearer | `...task-share.controller.ts:29` |

### 3.5 assets（9）
| Method | Path | 证据 |
|---|---|---|
| GET | `/assets` | `app/apps/api/src/modules/assets/assets.controller.ts:12` |
| GET | `/assets/expiring-tasks` | `...assets.controller.ts:31` |
| GET | `/asset-folders` | `...assets.controller.ts:36` |
| POST | `/asset-folders` | `...assets.controller.ts:41` |
| PATCH | `/assets/:id` | `...assets.controller.ts:50` |
| POST | `/assets/from-task` | `...assets.controller.ts:63` |
| POST | `/assets/:id/restore` | `...assets.controller.ts:72` |
| POST | `/assets/upload` | `...assets.controller.ts:77` |
| DELETE | `/assets/:id` | `...assets.controller.ts:83` |

### 3.6 billing（10）
| Method | Path | 鉴权 | 证据 |
|---|---|---|---|
| GET | `/billing/skus` | Public | `app/apps/api/src/modules/billing/billing.controller.ts:58`（Public :57） |
| GET | `/billing/channels` | Public | `...billing.controller.ts:65`（Public :64） |
| POST | `/billing/orders` | Bearer | `...billing.controller.ts:71` |
| GET | `/billing/orders` | Bearer | `...billing.controller.ts:108` |
| GET | `/billing/orders/:id` | Bearer | `...billing.controller.ts:102` |
| POST | `/billing/orders/:id/close` | Bearer | `...billing.controller.ts:114` |
| POST | `/billing/notify/wechat` | Public | `...billing.controller.ts:131`（Public :130） |
| POST | `/billing/notify/alipay` | Public | `...billing.controller.ts:225`（Public :224） |
| POST | `/billing/notify/mock` | Public | `...billing.controller.ts:282`（Public :281） |
| POST | `/billing/orders/:id/mock-pay` | Bearer | `...billing.controller.ts:309` |

> `notify/mock` 与 `mock-pay` 是 mock 渠道专用端点；`PAYMENT_LIVE=true` 时**代码内显式** 403：`app/apps/api/src/modules/billing/billing.controller.ts:284-286`（notify/mock）与 :311-313（mock-pay）。

### 3.7 ops/admin（18，独立 AdminGuard）
`app/apps/api/src/modules/admin/admin.controller.ts`

| Method | Path | 证据 |
|---|---|---|
| POST | `/ops/admin/login` | :40（`@Public()` :39，AdminAuthController） |
| GET | `/ops/admin/dashboard` | :57 |
| GET | `/ops/admin/queues` | :62 |
| GET | `/ops/admin/task-metrics` | :67 |
| GET | `/ops/admin/failed-tasks.csv` | :72 |
| GET | `/ops/admin/funnel` | :81 |
| GET | `/ops/admin/reports` | :86 |
| POST | `/ops/admin/reports/:id/resolve` | :95 |
| GET | `/ops/admin/models` | :105 |
| PATCH | `/ops/admin/models/:id` | :110 |
| GET | `/ops/admin/model-prices` | :115 |
| PATCH | `/ops/admin/model-prices/:id` | :124 |
| GET | `/ops/admin/tasks` | :129 |
| GET | `/ops/admin/exports` | :134 |
| GET | `/ops/admin/shares` | :139 |
| POST | `/ops/admin/shares/:id/revoke` | :144 |
| GET | `/ops/admin/orders` | :151 |
| POST | `/ops/admin/orders/:id/refund` | :156 |

类级 `@Public() + @UseGuards(AdminGuard)`（:48-50）→ 跳过用户 AuthGuard，改由 AdminGuard 独立校验（`app/apps/api/src/modules/admin/admin.guard.ts:10-22`）。注意 admin JWT 复用同一 `JWT_SECRET`，仅靠 `typ:"admin"` 声明区分（`app/apps/api/src/modules/admin/admin-auth.service.ts:54`）。

### 3.8 script / pipeline（46）
`app/apps/api/src/modules/script/script.controller.ts`

| Method | Path | 行 |
|---|---|---|
| POST | `/projects` | :43 |
| POST | `/projects/parse-script` | :50 |
| GET | `/projects` | :56 |
| GET | `/works` | :62 |
| POST | `/projects/:id/archive` | :77 |
| POST | `/projects/:id/episodes` | :84 |
| POST | `/projects/:id/duplicate` | :91 |
| GET | `/projects/:id` | :96 |
| PATCH | `/projects/:id` | :101 |
| DELETE | `/projects/:id` | :107 |
| POST | `/projects/:id/episodes/split` | :113 |
| POST | `/projects/:id/outline/generate` | :119 |
| PUT | `/projects/:id/outline` | :124 |
| POST | `/projects/:id/characters/generate` | :130 |
| POST | `/projects/:id/episodes/:eid/script-draft/generate` | :136 |
| POST | `/projects/:id/episodes/:eid/storyboards/generate` | :147 |
| POST | `/projects/:id/characters/:cid/to-asset` | :158 |
| GET | `/projects/:id/shot-materials` | :167 |
| POST | `/projects/:id/shot-materials` | :172 |
| GET | `/projects/:id/matrix` | :178 |
| GET | `/projects/:id/episodes/:eid` | :183 |
| PATCH | `/projects/:id/episodes/:eid` | :188 |
| PATCH | `/projects/:id/episodes/:eid/storyboards/:sid` | :198 |
| POST | `/projects/:id/characters/:cid/portrait` | :210 |
| POST | `/projects/:id/characters/:cid/portrait/rebind` | :227 |
| GET | `/projects/:id/characters/:cid/portrait/candidates` | :238 |
| POST | `/projects/:id/characters/:cid/portrait/select` | :243 |
| POST | `/projects/:id/characters/:cid/finalize` | :254 |
| GET | `/projects/:id/assets` | :262 |
| POST | `/projects/:id/assets` | :273 |
| POST | `/projects/:id/assets/extract` | :284 |
| POST | `/projects/:id/assets/:assetId/generate-image` | :297 |
| GET | `/projects/:id/assets/:assetId/candidates` | :315 |
| POST | `/projects/:id/assets/:assetId/select` | :325 |
| PATCH | `/projects/:id/assets/:assetId` | :337 |
| DELETE | `/projects/:id/assets/:assetId` | :349 |
| PUT | `/projects/:id/episodes/:eid/storyboards/:sid/assets` | :359 |
| POST | `/projects/:id/episodes/:eid/exports` | :371 |
| GET | `/projects/:id/episodes/:eid/exports/:xid` | :376 |
| POST | `/projects/:id/episodes/:eid/exports/:xid/retry` | :386 |
| POST | `/projects/:id/episodes/:eid/storyboards/generate-videos` | :396 |
| GET | `/projects/:id/episodes/:eid/timeline` | :416 |
| PUT | `/projects/:id/episodes/:eid/timeline` | :426 |
| DELETE | `/projects/:id/episodes/:eid/timeline` | :438 |
| POST | `/projects/:id/episodes/:eid/timeline/export` | :448 |
| GET | `/projects/:id/episodes/:eid/timeline/export/:exportId` | :458 |

### 3.9 reports（1）
| Method | Path | 鉴权 | 证据 |
|---|---|---|---|
| POST | `/share/:token/report` | Public | `app/apps/api/src/modules/reports/reports.controller.ts:14`（Public :13） |

### 3.10 端点小结（实测计数）
| 项 | 数值 | 口径 |
|---|---|---|
| 路由装饰器总数 | 112 | `@(Get\|Post\|Put\|Patch\|Delete)(` 命中 112；`@Controller(` 命中 17 |
| 无鉴权端点（`@Public()` 且无 AdminGuard） | 18 | 由 17 处 `@Public()` 覆盖：`health.controller.ts:15` 类级覆盖 3 个端点 + 15 处方法级各 1 个（含 `ops/admin/login`） |
| 需 admin Bearer（AdminGuard） | 17 | `admin.controller.ts:48` 类级 `@Public()+@UseGuards(AdminGuard)` 覆盖除 login 外全部 17 个 |
| 需用户 Bearer（全局 AuthGuard） | 77 | 112 − 18 − 17 |

无鉴权端点明细（18）：`/ping`、`/healthz`、`/healthz/live`、`/healthz/ready`、`/metrics`、`/files/local`、`/auth/sms-code`、`/auth/login`、`/auth/refresh`、`/waitlist`、`/share/:token`、`/billing/skus`、`/billing/channels`、`/billing/notify/wechat`、`/billing/notify/alipay`、`/billing/notify/mock`、`/share/:token/report`、`/ops/admin/login`。

---

## 4. 【表清单】数据库（29 表 / 13 migration）

Schema 定义：`app/packages/db/src/schema.ts`；DDL：`app/apps/api/drizzle/*.sql`（drizzle-kit 生成，journal 13 条：`app/apps/api/drizzle/meta/_journal.json:5-88`）。

| 表 | schema.ts 行 | 建表 migration |
|---|---|---|
| users | :25 | 0000 |
| identities | :42 | 0000 |
| spaces | :63 | 0000 |
| space_members | :74 | 0000 |
| admin_users | :92 | 0000 |
| invite_codes | :101 | 0000 |
| credit_accounts | :119 | 0000 |
| credit_flows | :135 | 0000 |
| invite_redemptions | :156 | 0000 |
| waitlist_entries | :172 | 0000 |
| models | :181 | 0000 |
| model_prices | :208 | 0000 |
| tasks | :233 | 0000 |
| task_events | :282 | 0000 |
| idempotency_records | :296 | 0000 |
| asset_folders | :316 | 0001 |
| assets | :331 | 0001 |
| script_projects | :357 | 0001 |
| episodes | :383 | 0001 |
| project_assets | :401 | 0001 |
| storyboards | :423 | 0001 |
| storyboard_assets | :448 | 0001 |
| exports | :509（`exportJobs`） | 0002 |
| task_shares | :462 | 0003 |
| content_reports | :481 | 0004 |
| orders | :607 | 0007 |
| project_timelines | :530 | 0011 |
| timeline_exports | :556 | 0011 |
| skus | :589 | 0000 |

> 29 处 `pgTable(` 与 29 条 `CREATE TABLE` 一一对应，无「代码有表、迁移缺表」或反向的缺口。

**增量 migration（非建表）**：0005 users.deleted_at、0006、0008 orders.pay_params、0009 退款相关、0010 script_projects.source_file_name + drama_type 回填、0012 storyboards.first_frame_uri/last_frame_uri。

**画布/canvas 缺口（明确缺失）**：设计文档 §7 定义了 4 张占位表 —— `canvases` / `canvas_nodes` / `canvas_edges` / `canvas_snapshots`（`docs/02-architecture/database.md:478-501`，标题即「## 7. 画布（Ph3，占位）」）。代码侧 **29 表中不存在任何 `canvas*` 表**；与画布最接近的是时间线/合成表 `project_timelines`（`app/packages/db/src/schema.ts:530`）与 `timeline_exports`（:556），二者是「成片时间线」而非自由画布节点图。

---

## 5. 【队列表】BullMQ（6 声明 / 3 有生产者）

声明处两处硬编码同一份常量：`app/apps/worker/src/queues.ts:6-13` 与 `app/apps/api/src/queue/queue.service.ts:5-12`。

| 队列名 | 声明 | 生产者 | 消费者实现 | 真实可用 |
|---|---|---|---|---|
| `gen.submit` | queues.ts:7 | ✅ api 下单后入队（`queue.service.ts:35-47`） | ✅ `runGenerationTask`（`worker/src/main.ts:211-216`） | **是** |
| `export.zip` | queues.ts:11 | ✅ `enqueueExport`（`queue.service.ts:49-61`） | ✅ `runExport` → JSZip（`worker/src/main.ts:217-222`、`export.ts:1,52`） | **是** |
| `timeline.export` | queues.ts:12 | ✅ `enqueueTimelineExport`（`queue.service.ts:63-74`） | ✅ `runTimelineExport` → ffmpeg（`worker/src/main.ts:223-228`、`timeline-export.ts:213-214`） | **是** |
| `gen.poll` | queues.ts:8 | ❌ 无任何 `add()` 调用 | ❌ 落到 no-op 分支（`worker/src/main.ts:229-230`） | **否（死声明）** |
| `result.transfer` | queues.ts:9 | ❌ 无 | ❌ no-op | **否（死声明）** |
| `notify` | queues.ts:10 | ❌ 无 | ❌ no-op | **否（死声明）** |

- api 侧只实例化 3 个 `Queue` 对象（`app/apps/api/src/queue/queue.service.ts:30-32`）。
- 轮询没有走 `gen.poll` delayed job，而是**在单个 job 内同步 sleep 轮询**：`for(;;) { adapter.poll(); if (Date.now()>deadline) fail; await sleep(interval) }`（`app/apps/worker/src/executor.ts:290-317`），默认 1s 间隔、120s 上限（`worker/src/main.ts:125-126`）。注释声称的「delayed job 5s 起指数退避」未实现。
- 后果（需注意）：长任务占用 worker 并发槽（默认 `WORKER_CONCURRENCY=5`，`worker/src/main.ts:234`），且进程重启即丢失轮询进度（`attempts:1`，`queue.service.ts:42`）。

**定时维护 5 项**（`app/apps/worker/src/main.ts:164-205`）：

| 任务 | 周期 | 函数 | 证据 |
|---|---|---|---|
| orders-reconcile 订单对账 | 5min | `reconcileOrders` | `main.ts:164-172`、`maintenance.ts:35-75` |
| tasks-watchdog 卡死任务看门狗 | 1min | `reviveStuckTasks` | `main.ts:175-183`、`maintenance.ts:88-207` |
| shares-expire 分享过期 | 1h | `expireShares` | `main.ts:186`、`maintenance.ts:210-217` |
| flows-audit 资金对账 | 24h | `auditLedger` | `main.ts:189-197`、`maintenance.ts:223-254` |
| retention-purge 保留清理 | 6h | `purgeOldData` | `main.ts:200-205`、`maintenance.ts:257-290` |

看门狗解冻**以流水为准**（只有 `sum(credit_flows.frozen_delta) > 0` 才解冻该额度），避免凭空造积分：`app/apps/worker/src/maintenance.ts:112-151`。对账为**本地补偿**，无渠道查单（注释自陈：`maintenance.ts:27-34`）。

---

## 6. 【适配器表】

实现：`app/packages/model-adapters/src/`；解析入口 `resolveAdapter`（`registry.ts:48-92`）。

| 适配器 | 类型 | 类定义 | 协议要点 | 真实模式前置 |
|---|---|---|---|---|
| `MockAdapter` | mock | `mock.ts:10` | 内存任务表 + 1.2s 延时后返回 `mock://` URI；可模拟 fail/review_rejected（`mock.ts:27-51`） | 无（`ADAPTER_MODE=mock`） |
| `DeepSeekChatAdapter` | real | `deepseek.ts:33` | OpenAI 兼容，Bearer 鉴权（`deepseek.ts:64,73`），错误分层/重试/超时 | `DEEPSEEK_API_KEY` |
| `ArkVideoAdapter` | real | `ark-video.ts:36` | 火山方舟内容生成异步任务 submit/query；默认 `https://ark.cn-beijing.volces.com`（`ark-video.ts:46,181-185`） | `ARK_API_KEY` |
| `ArkImageAdapter` | real | `ark-image.ts:186` | Seedream 同步接口、尺寸映射、异步兜底（`ark-image.ts:196,332-336`） | `ARK_API_KEY`（或 ARK_IMAGE_* 覆盖） |
| `HttpVideoAdapter` | real | `http-video.ts:69` | 通用 HTTP 网关，submit/poll/cancel 路径 + model 映射可配（`http-video.ts:134-138`） | `HTTP_VIDEO_BASE_URL` |

**mock/real 分支决定处（唯一）**：

| 位置 | 逻辑 | 证据 |
|---|---|---|
| worker 适配器模式 | `mode: process.env.ADAPTER_MODE === "real" ? "real" : "mock"`（**默认 mock**） | `app/apps/worker/src/main.ts:67` |
| 解析分支 | `if (options.mode === "mock") return sharedMock;`（mock 短路全部 code） | `app/packages/model-adapters/src/registry.ts:49` |
| 未实现 code | 显式抛错，绝不静默 mock | `registry.ts:89,91` |
| LLM 步骤模式 | `env.LLM_MODE === "real" && env.DEEPSEEK_API_KEY ? 真 : null`；`null` 即走确定性 mock 文案 | `app/apps/api/src/modules/script/llm.service.ts:68-75,78,102` |
| storage 驱动 | `STORAGE_DRIVER = local \| s3`（默认 local） | `app/apps/api/src/config/env.ts:124`、`app/apps/api/src/storage/storage.service.ts:10-28` |
| 支付渠道 | `PAYMENT_LIVE`；凭据不全 → `NotConfigured`，不静默 mock | `app/apps/api/src/config/env.ts:59-62`、`app/apps/api/src/modules/billing/channels/channel.service.ts:160-202` |

**真实模式所需环境变量（仅变量名，未读取任何 `.env` 值）**

- 供应商：`ADAPTER_MODE`、`LLM_MODE`、`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`ARK_API_KEY`、`ARK_BASE_URL`、`ARK_MODEL_MAP`、`ARK_IMAGE_BASE_URL`、`ARK_IMAGE_MODEL_MAP`、`ARK_IMAGE_REPLACE_CODES`、`ARK_IMAGE_RESPONSE_FORMAT`、`ARK_IMAGE_WATERMARK`、`ARK_IMAGE_TIMEOUT_MS`、`HTTP_VIDEO_BASE_URL`、`HTTP_VIDEO_API_KEY`、`HTTP_VIDEO_SUBMIT_PATH`、`HTTP_VIDEO_POLL_PATH`、`HTTP_VIDEO_CANCEL_PATH`、`HTTP_VIDEO_MODEL_MAP`（`app/apps/worker/src/main.ts:64-108`、`app/.env.production.example`）
- 支付：`PAYMENT_LIVE`、`WECHAT_APP_ID`、`WECHAT_MCH_ID`、`WECHAT_MCH_SERIAL_NO`、`WECHAT_MCH_PRIVATE_KEY(_PATH)`、`WECHAT_API_V3_KEY`、`WECHAT_PLATFORM_PUBLIC_KEY(_PATH)`、`WECHAT_PLATFORM_PUBLIC_KEYS(_PATH)`、`WECHAT_NOTIFY_URL`、`ALIPAY_APP_ID`、`ALIPAY_APP_PRIVATE_KEY(_PATH)`、`ALIPAY_PUBLIC_KEY(_PATH)`、`ALIPAY_GATEWAY`、`ALIPAY_NOTIFY_URL`（`app/apps/api/src/config/env.ts:65-103`）
- 基础设施：`DATABASE_URL`、`REDIS_URL`、`JWT_SECRET`、`PHONE_HMAC_PEPPER`、`PHONE_ENC_KEY`、`COOKIE_SECURE`、`ADMIN_USERNAME`、`ADMIN_PASSWORD`、`STORAGE_DRIVER`、`STORAGE_S3_*`（`app/apps/api/src/config/env.ts:21-139`、`app/apps/worker/src/main.ts:23-44`）
- 媒体：`FFMPEG_PATH`、`FFPROBE_PATH`、`AI_LABEL_ENABLED`、`AI_LABEL_TEXT`、`AI_LABEL_FONT_PATH`（`app/apps/worker/src/main.ts:111-116,135-136`）
- web：`NUXT_PUBLIC_API_BASE`、`NUXT_API_PROXY`（`app/apps/web/.env.example:3-4`）

**生产启动守卫（fail fast）**：
- api：仓库默认密钥/未显式 `COOKIE_SECURE`/`PAYMENT_LIVE=true` 但渠道凭据不全 → 拒绝启动，聚合报错且不含密钥值（`app/apps/api/src/config/env.ts:222-257,264-271`）
- worker：`NODE_ENV=production` 时 `ADAPTER_MODE!=="real"` 或三类供应商 Key 全缺 → 拒绝启动（`app/apps/worker/src/env-guard.ts:24-53`，调用点 `worker/src/main.ts:21`）
- **守卫未覆盖点**：`LLM_MODE=real` 但缺 `DEEPSEEK_API_KEY` 时不在守卫检查列表内（守卫仅校验 JWT/PHONE/ADMIN/COOKIE/支付，见 `env.ts:227-255`），会静默降级为 mock 文案。

---

## 7. 【前端能力表】

| 能力 | 是否在代码中落地 | 证据 | 真实可用性说明 |
|---|---|---|---|
| three.js | ✅ 真实现 | 依赖 `three ^0.186.1`（`app/apps/web/package.json:15`）；`import * as THREE from "three"`（`Director3D.vue:8`）；`new THREE.WebGLRenderer`（`:318`）、CapsuleGeometry 角色体（`:252-254`）、双机位 `PerspectiveCamera`（`:39-41`）、CanvasTexture/Sprite 标签（`:217-219`）；页面挂载点 `projects/[id].vue:1965,2361` | 纯前端，浏览器可跑；不依赖 API |
| ffmpeg | ✅ 真实现，**仅在 worker**（web 无 ffmpeg） | 显式水印 `label.ts:134`（`run(ffmpeg, args)`，超时 30s）；成片合成 `timeline-export.ts:213-214,248-263,301`（10min 超时 + ffprobe 探测视频流 `:69-84`） | 需宿主安装 ffmpeg/ffprobe（或 `FFMPEG_PATH`/`FFPROBE_PATH`）；不可用时显式标识降级为仅隐式并记录原因（`label.ts:27`） |
| SSE / 流式推送 | ❌ **完全不存在** | 全仓（apps/packages，排除 node_modules/dist）搜索 `event-stream`、`EventSource`、`sendBeacon` → 0 命中 | 进度靠 HTTP 轮询：web `setInterval`（`projects/[id].vue:294-465,1333-1369`、`home.vue:45`）；下载链接走预签名 URL |
| 埋点 / 前端监控 | ❌ **完全不存在** | 搜索 `analytics`、`sentry`、`posthog`、`umami`、`埋点` → 0 命中 | 无页面浏览/行为埋点，无前端错误上报；服务端有 request_id 日志与 `/metrics`（`app/apps/api/src/health/metrics.controller.ts:21`） |
| 轮询 / ETag | ✅ | `tasks.vue` 轮询 + `tasks/:id` ETag/304（README:78 声明；web 侧轮询见 `projects/[id].vue:389`） | 可跑 |
| 3D 导演台 UI | ✅ | `Director3D.vue` 1112 行；页面开关 `projects/[id].vue:973` | 可跑（客户端渲染 `ssr:false`） |
| 视频工作台 | ✅ | `VideoGenWorkspace.vue` 1380 行，被 2 个 create 页复用（`create/text-to-video.vue:8`） | 可跑 |
| SSR 策略 | ✅ 显式配置 | 工作台类路由全部 `ssr:false`，`/v1/**` 反代并透传真实 IP | `app/apps/web/nuxt.config.ts:19-38` |

---

## 8. 【测试与门禁表】

### 8.1 测试文件分布（45 个，`git ls-files` 口径）

| 包 | 文件数 | 说明 |
|---|---|---|
| `apps/api` | 25 | `src/**` 2 + `test/**` 23（含 billing/refund/channels/admin/pipeline/timeline/observability 等 e2e 级） |
| `apps/worker` | 7 | `src/**` 3（env-guard/executor/label）+ `test/**` 4（maintenance/outbound-uri/timeline-export/watchdog） |
| `packages/model-adapters` | 7 | 契约测试为主 |
| `packages/storage` | 3 | 含 `s3.integration.spec.ts`（CI 可 skip） |
| `packages/shared` | 2 | schemas/snowflake |
| `packages/db` | 1 | schema |
| `apps/web` | 0 | **无任何测试**；`test` 脚本为空操作（`app/apps/web/package.json:12`） |

### 8.2 门禁脚本

| 脚本 | 定义 | 覆盖 |
|---|---|---|
| `pnpm lint` | `turbo run lint`（`app/package.json:13`） | 6 包（无 web）；ESLint flat config 仅作用于 TS（`app/eslint.config.mjs:1-21`） |
| `pnpm typecheck` | `turbo run typecheck`（`app/package.json:12`） | 6 包（无 web，`.vue` 不做 tsc 校验） |
| `pnpm test` | `turbo run test`（`app/package.json:14`） | 6 包（web 空操作） |
| `pnpm build` | `turbo run build`（`app/package.json:11`） | api/worker tsc + web `nuxt build` |
| CI | `.github/workflows/ci.yml` | PG16 + Redis7 service → migrate → seed → lint → typecheck → test → build（`ci.yml:47-60`） |

> 门禁缺口：`apps/web` 既无 `lint` 也无 `typecheck`，`.vue`（16488 行）不进入任何静态检查；`web e2e lands in P2` 说明前端端到端测试尚未纳入 CI。

### 8.3 最近一次全量结果（历史证据，非本次执行）

`_acceptance/b-type-acceptance-run.log`（2026-10-25 15:08 运行）：

| 项 | 结果 | 证据行 |
|---|---|---|
| 全量测试 | storage 6 passed / 1 skipped、shared 13、model-adapters 87、db 11、api 167、worker 15 → **299 passed / 1 skipped** | `:22` |
| typecheck | exit=0 | `:23` |
| lint | exit=0 | `:24` |
| build（api+worker+web） | exit=0 | `:25` |
| 生产守卫正反例 | 4 项 PASS | `:26-29` |
| 运行态冒烟（HTTP） | 25/25 通过 | `:50` |

> 该日志 §0 前置检查记录 `tables=27`（`:10`）。本次代码侧核对为 29 张表；差 2 张恰为 migration 0011 新建的 `project_timelines`/`timeline_exports`，而日志 §0 在 §1 执行迁移**之前**采集，属预期而非矛盾（此推断基于日志节序，未复跑数据库）。

### 8.4 本次单包实测（我在本任务内实际执行）

```
命令：cd E:\wanxing\app; pnpm --filter @app/model-adapters test
结果：Test Files 7 passed (7) / Tests 87 passed (87) / Duration 2.48s / exit code 0
```

未运行全量构建或跨包测试（遵守任务约束）。

---

## 9. 「代码里存在」vs「能真实跑」差异清单

| # | 能力 | 代码里存在 | 能真实跑？ | 阻塞条件 | 证据 |
|---|---|---|---|---|---|
| 1 | 真实供应商生成 | 4 个 real 适配器 | ❌ 当前环境 | `ARK_API_KEY` / `DEEPSEEK_API_KEY` / `HTTP_VIDEO_BASE_URL` 至少一个；否则生产守卫拒绝启动，开发默认回落 mock | `registry.ts:48-92`、`env-guard.ts:36-45` |
| 2 | LLM 流水线（大纲/角色/剧本/分镜/提资产） | mock + DeepSeek 双实现 | ⚠️ 仅 mock | `LLM_MODE=real` 且 `DEEPSEEK_API_KEY`；**缺 Key 会静默走 mock 而不报错**（与 worker 行为不一致） | `llm.service.ts:68-75,78,102` |
| 3 | 真实支付 | 微信 APIv3 + 支付宝 RSA2 + 渠道工厂 | ❌ 当前环境 | 商户号/证书/应用；凭据不全 → `NotConfigured`，绝不静默 mock（这是正确行为） | `channel.service.ts:160-202` |
| 4 | 3 个队列（gen.poll / result.transfer / notify） | 声明存在 | ❌ 死代码 | 无生产者，worker 落 no-op；轮询改为 job 内 sleep | `queues.ts:8-10`、`queue.service.ts:30-32`、`main.ts:229-230` |
| 5 | 成片合成/水印（ffmpeg） | 完整实现 | ⚠️ 需宿主 ffmpeg | 宿主安装 ffmpeg/ffprobe 或配 `FFMPEG_PATH`/`FFPROBE_PATH`；缺失时降级 | `timeline-export.ts:213-214`、`label.ts:27,134` |
| 6 | S3/OSS 存储 | local + s3 双驱动 | ⚠️ 默认 local | `STORAGE_DRIVER=s3` + `STORAGE_S3_*`；compose 已做 `S3_* → STORAGE_S3_*` 映射 | `storage.service.ts:10-28`、`docker-compose.prod.yml:13-20` |
| 7 | 生产部署（compose） | Dockerfile×3 + compose.prod | ⚠️ 需显式 env | `docker-compose.prod.yml:119` 默认 `ADAPTER_MODE=mock`，而 worker 生产守卫拒绝 mock → **不设该变量则 worker 起不来**（属"安全默认导致的部署摩擦"） | `docker-compose.prod.yml:119`、`env-guard.ts:30-34` |
| 8 | 前端静态质量门禁 | 无 | ❌ | web 无 lint/typecheck/test 脚本 | `apps/web/package.json:7-13` |
| 9 | 画布（canvas_* 4 表） | ❌ 不存在 | ❌ | 设计文档 §7 仍为占位，代码完成度为 0 | `docs/02-architecture/database.md:478-501` |
| 10 | SSE / 埋点 | ❌ 不存在 | ❌ | 进度靠轮询；无前端监控 | §7 搜索 0 命中 |
| 11 | api e2e 测试 | 存在 | ⚠️ 需 PG+Redis | CI 通过 service 容器提供；本地需 127.0.0.1:55432 与 6380（README:42） | `.github/workflows/ci.yml:20-45` |
| 12 | admin 独立鉴权 | 独立 guard + 独立登录页 + 独立 token 存储 | ✅ 可跑 | 复用了 `JWT_SECRET`，仅 `typ:"admin"` 区分；生产必须显式设 `ADMIN_USERNAME/PASSWORD` | `admin.guard.ts:10-22`、`admin-auth.service.ts:38-39,54` |

---

## 10. 证据与限制

- **已实际读取/执行**：上述所有 `文件:行` 均来自本次会话的 read/grep/Select-String 结果；§8.4 的单包测试为本次实际执行。
- **未做**：未读取任何 `.env` 值（仅读 `.env.example` 与代码中的变量名）；未运行数据库迁移、未连数据库/Redis、未启动 api/worker/web、未运行全量构建（遵守任务约束）。
- **未验证（属"存在但未证实可跑"）**：
  - 端点的运行时行为（仅确认路由注册与守卫声明）；
  - 表结构与数据库实际状态的一致性（仅比对 schema.ts 与 migration DDL）；
  - `PAYMENT_LIVE=true` 下 mock 端点 403、回调验签等运行态断言（依赖 §8.3 的历史日志，未复跑）；
  - README 中「生产构建已浏览器验证」「compose 全链路冒烟通过」等声明（本次不涉及，建议由 verify-runtime 复核）。
- **计数口径**：端点=路由装饰器数（112）；表=`pgTable` 定义数（29）并与 migration `CREATE TABLE`（29）交叉核对；队列=常量声明数（6）并区分是否真有生产者（3）。
