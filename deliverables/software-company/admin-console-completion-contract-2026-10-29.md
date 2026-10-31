# 运营后台补齐 · 实施契约（2026-10-29）

> 本文件是并行施工的唯一契约：**先读本文件再动代码**。评审依据见
> `deliverables/software-company/admin-console-gap-review-2026-10-29.md`。
> 目标：补齐 `/admin` 后台在 PRD F8 / api-spec §11 下的功能缺失，P0 → P1 → P2 分批。

## 0. 硬性规则

1. **只改自己 ownership 内的文件**；需要改别人的文件时，停下来发消息给 Lead，不要直接改。
2. **不要改 `app/apps/web/i18n/locales/*.json`**：新增文案写到自己负责的
   `app/apps/web/i18n/pending-admin/<name>.json`，Lead 统一合并（格式见 §5）。
3. **不要跑** `pnpm test` / `pnpm --filter @app/api test`：本机没有 PG/Redis（55432/6380 均未启动），
   e2e 必红。验证只用 `typecheck` / `lint` / `build`（见 §6）。
4. 注释用中文并写清「为什么」（本仓约定），不要写「// TODO」占位交付。
5. 契约/表结构变更必须在同一批里同步文档；文档由 Lead 统一改，不要自己改 `docs/**`。
6. 所有 API 入参必须 zod 校验（`parseOrThrow`），错误用 `AppError(ErrorCode.INVALID_PARAM, ...)`。
7. 不改既有响应字段名（只增不改），避免打断现网页面/测试。

## 1. 文件所有权（本批）

| 角色 | 可写文件 |
|---|---|
| Lead | `app/apps/web/composables/useAdminApi.ts`、`useAdminMenu.ts`、`layouts/admin.vue`、`components/admin/Admin*Panel.vue`（骨架）、`pages/admin/index.vue`（仅占位区块，交给 web-core 后不再改）、`i18n/pending-admin/**`、`_acceptance/merge-admin-i18n.cjs`、`docs/**`、本文件 |
| api-core | `app/apps/api/src/modules/admin/admin.controller.ts`、`admin.service.ts`、`app/apps/api/src/modules/generations/tool-catalog.ts`、`app/apps/api/test/admin.spec.ts`、`app/apps/api/test/tools.spec.ts`、新增 `app/apps/api/test/admin-core-*.spec.ts` |
| api-ops | `app/packages/db/src/schema.ts`、`app/apps/api/drizzle/**`、`app/apps/api/src/modules/admin/admin-ops.controller.ts`、`admin-accounts.service.ts`、`admin-audit.service.ts`、`admin-config.service.ts`、`admin.guard.ts`、`admin-auth.service.ts`、`admin.module.ts`、`app.module.ts`、`app/apps/api/src/common/admin-audit.interceptor.ts`、`app/apps/api/test/admin-ops-*.spec.ts` |
| web-core | `app/apps/web/pages/admin/index.vue`、`app/apps/web/types/api.ts`（admin 段）、`i18n/pending-admin/core.json` |
| web-prices | `app/apps/web/components/admin/AdminPricePanel.vue`、`i18n/pending-admin/prices.json` |
| web-ops-ui | `app/apps/web/components/admin/AdminAuditPanel.vue`、`AdminAdminsPanel.vue`、`AdminConfigPanel.vue`、`i18n/pending-admin/ops-ui.json` |
| web-market | `app/apps/web/components/admin/AdminMarketPanel.vue`、`AdminSkillsPanel.vue`、`i18n/pending-admin/market.json` |

> 组件命名：`components/admin/AdminPricePanel.vue` 在模板里是 `<AdminPricePanel>`（`pathPrefix: false`，名字=basename）。

## 2. P0 API 合同（api-core）

### 2.1 `GET /ops/admin/models`

在现有 DTO 上**新增** `modes`（原样返回 `models.modes` JSON，可能是 `{}`）与 `types`（数组，可空）。
其余字段不变：`id,name,display_name,vendor,capability,visible,sort,adapter_code,vip`。

### 2.2 `PATCH /ops/admin/models/:id`

`modelPatchSchema` 扩展：

```ts
{
  visible?: boolean,
  sort?: int 0..9999,
  // 参数枚举热更：整体替换 models.modes（不是深合并，避免"删档位"不可表达）
  modes?: Record<string, {
    resolution_options?: Array<{ value: string; label?: string }>,
    durations?: number[],
    default_resolution?: string,
    // 其余运营字段原样保留（不校验未知键）
  }>
}
```

校验：`modes` 为普通对象、键数 1..20、键长 ≤64、序列化 ≤32KB；每个 mode 的
`resolution_options` ≤20 项、`value` 1..32 字符；`durations` ≤20 个整数 1..600；
`default_resolution` ≤32 字符。非法 → `400101`。只更新传了的字段，返回 2.1 的完整模型 DTO。

### 2.3 `GET /ops/admin/model-prices`

- query 新增 `active?: 1|0`；保留 `model_id/page/page_size`（`page_size ≤100`）。
- list 项**新增** `model_name`（join `models.name`）、`active`、`updated_at`。
- 响应仍为 `{list,total,page,page_size}`。

### 2.4 `POST /ops/admin/model-prices`

- body 新增 `active?: boolean`（默认 `true`）。
- 返回项新增 `model_name`、`active`。
- 其余档位校验保持不变。

### 2.5 `PATCH /ops/admin/model-prices/:id`

返回项补充 `model_id, model_name, mode, resolution, duration_s, credits, strike_credits, active`。

### 2.6 `GET /ops/admin/tasks`

- query：`status?`、`model_id?`、`mode?`、`page?`、`page_size?`（≤100）。
- list 项改为：

```ts
{
  task_id: string, space_id: string,
  model_id: string, model_name: string, adapter_code: string,
  mode: string, status: number,
  error_code: string | null, error_message: string | null,
  credits_frozen: number, credits_settled: number,
  created_at: string, finished_at: string | null
}
```

`model_name`/`adapter_code` 来自 join `models`；`error_*` 来自 `tasks.error` JSON（`code`/`message`）。

### 2.7 `GET /ops/admin/task-metrics`

- query 新增 `model_id?`、`from?`、`to?`（ISO 时间，按 `tasks.created_at` 过滤；非法时间 → 400101）。
- 过滤同时作用于总览计数、错误码分布、adapter 延迟聚合。
- 响应结构不变（可新增 `filters` 回显）。

### 2.8 `GET /ops/admin/failed-tasks.csv`

- query 新增 `model_id?`、`from?`、`to?`。
- CSV 头**保留前缀** `task_id,space_id,model,mode,status`（测试依赖），其后追加
  `,model_name,adapter_code,error_code,error_message,created_at,finished_at`。
- 仍限制 ≤1000 行、仍做字段转义。

### 2.9 `GET /ops/admin/funnel`（口径重做）

改为**按项目合并时间戳**计算，返回 6 段：

```ts
Array<{
  key: "projects"|"outlines"|"characters"|"storyboards"|"batch"|"completed",
  label: string,                       // 建项/大纲确认/角色定稿/分镜确认/批量投递/完集
  count: number,                       // 到达该环节的项目数（distinct project）
  conversion_from_previous: number|null, // 保留旧字段
  dropoff_from_previous: number|null,    // 新增：100 - conversion
  avg_hours_from_previous: number|null,  // 新增：与上一环节的时间差均值（小时，1 位小数）
  avg_hours_from_project_created: number|null // 新增：距建项的均值（小时，1 位小数）
}>
```

取数（每个 project 取该环节**最早**时间，全部用现有表，不新建埋点表）：

| 环节 | 判定 | 时间 |
|---|---|---|
| projects | 全部 `script_projects` | `script_projects.created_at` |
| outlines | `episodes.status=2` | `min(episodes.updated_at)` |
| characters | `project_assets.kind='character' and status=2` | `min(project_assets.finalized_at)` |
| storyboards | 存在 `storyboards.status>=2`（join episodes） | `min(storyboards.updated_at)` |
| batch | 存在 `tasks.mode='universal_reference' and episode_id is not null`（join episodes） | `min(tasks.created_at)` |
| completed | 该集存在 ≥1 分镜且**不存在** `status<>5` 的分镜 | `max(storyboards.updated_at)` |

实现建议：分别查询「project_id + 时间」后在 JS 合并（项目量级是运营后台可接受范围），不要写巨型 CTE。
`count` = 有该环节时间的项目数；`conversion`/`dropoff`/`avg_hours` 只在上一环节也有时间的项目上计算。
响应可新增 `source: "tables"` 与 `generated_at`，但顶层仍是**数组**（现有测试 `data).toHaveLength(6)` 依赖数组）。

### 2.10 `ensureToolCatalog` 覆盖修复

- 已存在 model：仍同步 `vendor/display_name/description/capability/types/adapter_code/audio_video_support/modes/scene_modes/mode_order/updated_at`，
  但**不再覆盖运营字段 `visible`、`sort`**。
- 已存在 price：**只保留现有行，不再 update `credits/strike_credits/active`**；只 insert 缺失档位。
- 新增 env 开关 `CATALOG_SYNC_TOOLS=true`（`env.ts` 由 api-ops 改；api-core 先用
  `process.env.CATALOG_SYNC_TOOLS === "true"` 读取，避免跨文件依赖）：为 true 时恢复旧的“全量覆盖”行为。
- 同步更新 `test/tools.spec.ts` 里「报价金额等于目录初始价」的断言：改为读取 DB 当前价
  （`model_prices`）或 `GET /generations/tools` 返回的目录价，不要再依赖代码常量。
- 代码里的 `TOOL_MODES[].prices` 保留为**首次落库默认值**，注释写明「只在行不存在时使用，运营改价不覆盖」。

## 3. P1 API 合同（api-ops）

### 3.1 新表（`packages/db/src/schema.ts` + drizzle migration 0047）

```ts
adminAuditLogs = pgTable("admin_audit_logs", {
  id: pk(),
  adminId: bigint("admin_id", { mode: "bigint" }).references(() => adminUsers.id),
  adminUsername: text("admin_username").notNull().default(""),
  method: text("method").notNull(),
  path: text("path").notNull(),
  action: text("action").notNull().default(""), // 路由模板，如 "PATCH /ops/admin/model-prices/:id"
  statusCode: integer("status_code").notNull().default(200),
  ok: boolean("ok").notNull().default(true),
  ip: text("ip"),
  requestId: text("request_id"),
  payload: jsonb("payload"), // 脱敏后的入参（≤8KB）
  createdAt: createdAt(),
}, indexes: created_at desc, (admin_id, created_at desc), (action, created_at desc))

appConfigs = pgTable("app_configs", {
  id: pk(),
  key: text("key").notNull().unique(),
  module: text("module").notNull().default(""),
  value: jsonb("value").notNull().default(sql`'{}'::jsonb`),
  description: text("description"),
  updatedBy: bigint("updated_by", { mode: "bigint" }).references(() => adminUsers.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})
```

`admin_users` 增列：`status smallint not null default 1`（1 启用/2 停用）、`tokenVersion integer not null default 1`、
`lastLoginAt timestamp`、`passwordUpdatedAt timestamp`。

迁移：`cd app && pnpm --filter @app/api db:generate` 生成 `0047_*.sql` 与 `meta/_journal.json`（不要手写）。

### 3.2 鉴权/角色（改 `admin-auth.service.ts` / `admin.guard.ts`）

- 角色：`super`（管管理员+全量）、`ops`（运营写）、`viewer`（只读）。
- 登录：校验 `status=1`；JWT 增加 `ver: admin.tokenVersion`；登录成功更新 `last_login_at`。
- `AdminGuard` 改 async：验签后按 `sub` 读库，校验存在、`status=1`、`tokenVersion===payload.ver`；
  失败 → 401101；`viewer` 角色对非 GET 请求 → 403101。
- bootstrap 默认角色改 `super`（生产首账号）。
- 管理员 CRUD 端点仅 `super` 可调（控制器内判断，403101）。

### 3.3 管理员账号端点（`admin-ops.controller.ts`，`@Controller("ops/admin")`）

- `GET admins` → `{list:[{id,username,role,status,created_at,last_login_at}]}`
- `POST admins {username,password,role}` → 201 语义（信封 code 0）；密码 ≥8；重名 400101。
- `PATCH admins/:id {role?,status?,password?}` → 角色/启停/改密；改密或启停时 `tokenVersion++`；
  不允许把最后一个 `super` 降级/停用（400101）；不能停用自己（400101）。
- `DELETE admins/:id` 不做物理删除（软停用走 PATCH）。

### 3.4 审计日志

- 新增 `AdminAuditInterceptor`（全局 `APP_INTERCEPTOR`，`app.module.ts` 注册）：
  仅记录 `req.adminAuth` 存在、路径以 `/v1/ops/` 开头、方法非 GET 的请求；
  成功后异步写 `admin_audit_logs`（失败吞掉，不影响业务）；脱敏 `password/token/secret/authorization`，payload ≤8KB。
  `action` 用 `method + (req.routeOptions?.url ?? req.routerPath ?? req.url)`。
- `GET audit-logs?page&page_size&admin_id&action&from&to` → `{list,total,page,page_size}`，按时间倒序。

### 3.5 配置中心

- 公开：`GET /ops/config/:key?module=&lang=`（`@Controller("ops")` + `@Public()`）→
  `{key, module, value, exists, updated_at}`（不存在时 200 + `exists:false,value:null`）。
- 管理：`GET /ops/admin/configs`（列表）、`PUT /ops/admin/config/:key {value,module?,description?}`（upsert）、
  `DELETE /ops/admin/config/:key`。`key` 1..64，`value` 任意 JSON（≤64KB）。

### 3.6 订单对账导出

`GET /ops/admin/orders.csv?status=&from=&to=`（AdminGuard）→ CSV：
`order_id,space_id,user_id,sku,amount_cents,credits,channel,status,paid_at,refund_no,refund_status,refund_amount_cents,refunded_at,refund_reason,refund_operator,created_at`，
字段转义，≤5000 行，`content-type: text/csv; charset=utf-8`。

## 4. 前端合同

### 4.1 新增页签（`useAdminMenu.ts`，Lead 已加）

`prices`（价格）、`market`（剧本广场）、`skills`（Skill 推荐位）、`audit`（操作日志）、
`admins`（管理员）、`config`（配置中心）、`exports`（导出审计）。
`pages/admin/index.vue` 已放占位：`<AdminPricePanel v-if="tab==='prices'" />` 等。

### 4.2 共享 API 客户端（Lead 已建）

`app/apps/web/composables/useAdminApi.ts`：

```ts
adminApi<T>(path, { method?, body? }): Promise<T>   // 自动带 /v1 前缀 + Bearer admin_token + 信封解包
adminApiBlob(path): Promise<{blob, filename}>
adminErrorCode(e): number | undefined
adminLoginPath(): "/admin/login"
```

错误对象 `AdminApiError { code, message }`；401101/403101 由调用方决定回登录页。

### 4.3 面板组件要求

- 全部 `<script setup lang="ts">`，使用 `adminApi`，自己拉数据，不依赖 `index.vue` 的 `loadAll`。
- 文案用 `t("adminXxx.key")`；`t` 来自 `useI18n()`；缺 key 时 i18n 会显示 key 本身，所以 pending 文件必须齐。
- 表格/表单风格复用 `admin/index.vue` 的 `.card/.row/.mini/.input` 风格（scoped 复制即可，不要引全局新样式）。
- 每个面板要有：加载态、空态、错误行；写操作后刷新自身数据。
- 不改 `index.vue`（除 web-core）。

### 4.4 web-core 在 index.vue 的具体改动

1. 模型页签：每行加「排序」数字输入 + 保存；加「编辑档位」展开 textarea（JSON，`modes`），保存走
   `PATCH /ops/admin/models/:id {modes}`；新增 `modes` 回显。
2. 任务页签：筛选（状态下拉、模型下拉、任务 ID 前缀可选）+ 分页；表格列：task/model/mode/status/credits/error/时间；
   CSV 按钮把当前 `model_id/from/to` 带上；指标卡片随筛选刷新。
3. 漏斗：显示 `dropoff_from_previous`、`avg_hours_from_previous`（无值显示 `-`）。
4. 订单：状态下拉 + 分页 + 「导出退款单 CSV」按钮（`/ops/admin/orders.csv`）。
5. 举报/分享/创作者审核：分页 + 状态筛选（举报/订单）；创作者审核分页保留搜索。
6. 运营位：加「编辑」按钮，回填表单，`PUT` 保存。
7. 导出审计：`GET /ops/admin/exports` 列表 + 分页（tab `exports`）。
8. `dashboard`：渲染 `tasks.by_status` 状态分布。
9. 修 `onMounted`：只有 `401101/403101` 才清 token 跳登录；其它错误显示在页面。
10. 概览页的运营位/首页配置保留在 dashboard（不迁移菜单），避免行为变化。

## 5. i18n pending 文件格式

每个 owner 写一个文件：`app/apps/web/i18n/pending-admin/<name>.json`：

```json
{
  "adminPrices": {
    "title": ["价格管理", "Pricing"],
    "colModel": ["模型", "Model"]
  }
}
```

- 叶子必须是 `[中文, English]` 两元数组；合并脚本会写入 `zh-CN`=中文，`en/ja/pt-BR/es`=English。
- 不要写嵌套超过 2 层（namespace → key）。
- Lead 合并命令：`node _acceptance/merge-admin-i18n.cjs`。
- 合并后必须跑：`node _acceptance/i18n-check.cjs`（若脚本支持）。

## 6. 验证命令（本机无 DB，不要跑测试）

```powershell
cd E:\wanxing\app
pnpm --filter @app/api typecheck
pnpm --filter @app/api lint
pnpm --filter @app/web typecheck   # nuxt prepare + vue-tsc，较慢
```

- 若 web typecheck 因 `.nuxt` 缓存报错，先 `pnpm --filter @app/web exec nuxt prepare`。
- 不许用 `any` 绕过类型；不许删既有测试来变绿。
- 完成后向 Lead 汇报：改了哪些文件、新增端点/字段、验证结果、未做项。

## 7. 交付顺序

1. **P0**：api-core + web-core + web-prices → Lead 合并 i18n → typecheck/lint。
2. **P1**：api-ops + web-ops-ui + web-market → Lead 合并 → 迁移检查 → typecheck/lint/build。
3. **P2**：分页/筛选/运营位编辑/等待名单/邀请码/用户封禁/登录限流（按剩余预算）。
