# AutoDL 接入实施设计（BYOC · 随用随开）

> v0.1 · 2026-11-04 · **状态：P0/P1 后端已落地（2026-11-04），前端 `/compute` 已上线；管理后台与真实环境构建向导待补** · 上游决策：[byoc-user-gpu.md](byoc-user-gpu.md)、[ADR-016](adr.md)
> 范围：在现有 `apps/api`（NestJS）+ `apps/web`（Nuxt3）+ `apps/worker` + `packages/db`（drizzle）里新增 `fleet` 域，接 AutoDL 容器实例 Pro API，实现「绑一次 Token → 提交任务自动开机 → 出片 → 自动关机」。
> 不改：`packages/model-adapters` 的 `h3:video` 适配器（仍指向我方网关）；生成/结算/打标主链路（只加一个状态来源）。

---

## 0. 结论与边界

| # | 决策 | 理由 |
|---|---|---|
| F1 | 新增 `fleet` 域（`apps/api/src/modules/fleet`），**不塞进 `admin`/`models`** | 与"供应商 API"语义不同：这是可创建/销毁的计算资源 + 用户自己的钱 |
| F2 | 平台侧只认 **AutoDL Pro API**（`https://api.autodl.com`），用**用户自己的开发者 Token** | 不碰用户密码、不做 RPA；Token 加密存，可吊销 |
| F3 | 调度仍是 `h3-gateway`，`fleet` 只负责"让节点在位" | 不把 GPU 状态塞进 NestJS 请求进程 |
| F4 | 任务新增 `provisioning / booting / loading` 三个**子阶段**（不改主状态枚举，用 `tasks.progress` + `tasks.error` 之外的 `meta`） | 主状态机（1~7）已被结算/看门狗依赖，动它风险大；子阶段只影响 UI 文案 |
| F5 | 计划开关 `FLEET_ENABLED=off/shadow/on`，默认 off | 先影子跑，不切真实流量 |
| F6 | 首版**只允许 1 个池 / 1 个机型**（`4090-48G` 或 `4090D`），不做多机型混排 | 支持成本 |
| F7 | **走应用实例 API**（`image_source=app`，`application_uuid` + `application_version`），同一 Token、零点击；`private` 模式保留给将来自建镜像 | 应用实例 API 实测可用，权重走公共模型软链接，既不用下载也不用扩盘 |

**不做**：多平台同时接、跨用户共享、竞价实例、境外节点、2K 本地出片。

---

## 1. 数据模型（迁移 `0058_fleet`）

### 1.1 drizzle schema（`packages/db/src/schema.ts` 追加）

```ts
// ── 机队（设计见 docs/02-architecture/autodl-integration.md）──
// 用户自带云账号：Token 只存密文（AES-256-GCM，复用 provider-crypto 口径）
export const gpuAccounts = pgTable(
  "gpu_accounts",
  {
    id: pk(),
    userId: bigint("user_id", { mode: "bigint" }).notNull().references(() => users.id),
    spaceId: bigint("space_id", { mode: "bigint" }).references(() => spaces.id),
    provider: text("provider").notNull().default("autodl"), // autodl
    tokenCiphertext: text("token_ciphertext").notNull(),
    encryptionKeyId: text("encryption_key_id").notNull().default("v1"),
    credentialVersion: integer("credential_version").notNull().default(1),
    tokenHint: text("token_hint").notNull().default(""), // 末 4 位，仅展示
    status: smallint("status").notNull().default(1), // 1 有效 / 0 已吊销
    lastCheckAt: timestamp("last_check_at", { withTimezone: true }),
    lastCheckStatus: text("last_check_status"),
    consentVersion: text("consent_version").notNull().default("v1"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_gpu_accounts_user").on(t.userId, t.provider)],
);

export const gpuPools = pgTable(
  "gpu_pools",
  {
    id: pk(),
    accountId: bigint("account_id", { mode: "bigint" }).notNull().references(() => gpuAccounts.id, { onDelete: "cascade" }),
    userId: bigint("user_id", { mode: "bigint" }).notNull().references(() => users.id),
    name: text("name").notNull(),
    gpuSpec: text("gpu_spec").notNull().default("v-48g"), // AutoDL gpu_spec_uuid
    gpuCount: integer("gpu_count").notNull().default(1), // 1~4
    imageUuid: text("image_uuid"), // 空 = 还没构建过环境
    systemDiskGb: integer("system_disk_gb").notNull().default(50),
    lifecycle: text("lifecycle").notNull().default("session"), // session|on_demand|always_on|scheduled
    idleMinutes: integer("idle_minutes").notNull().default(15),
    budgetDailyCents: integer("budget_daily_cents").notNull().default(5000),
    budgetMonthCents: integer("budget_month_cents").notNull().default(50000),
    state: text("state").notNull().default("idle"), // idle|provisioning|ready|frozen
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_gpu_pools_user").on(t.userId)],
);

export const gpuNodes = pgTable(
  "gpu_nodes",
  {
    id: pk(),
    poolId: bigint("pool_id", { mode: "bigint" }).notNull().references(() => gpuPools.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("autodl"),
    providerInstanceId: text("provider_instance_id").notNull().unique(), // pro-xxxx
    instanceName: text("instance_name").notNull().default(""), // 我方可读名，用于对账
    gpuSpec: text("gpu_spec").notNull(),
    vramGb: integer("vram_gb").notNull().default(48),
    state: text("state").notNull().default("provisioning"),
    // provisioning|booting|loading|ready|busy|draining|stopping|stopped|destroyed|error
    hourlyPriceCents: integer("hourly_price_cents").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
    agentVersion: text("agent_version"),
    modelCommit: text("model_commit"),
    variantsLoaded: text("variants_loaded").array().notNull().default(sql`'{}'::text[]`),
    costAccruedCents: integer("cost_accrued_cents").notNull().default(0),
    errorCode: text("error_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_gpu_nodes_pool_state").on(t.poolId, t.state)],
);

export const gpuJobs = pgTable(
  "gpu_jobs",
  {
    id: pk(),
    taskId: bigint("task_id", { mode: "bigint" }).notNull().references(() => tasks.id, { onDelete: "cascade" }),
    poolId: bigint("pool_id", { mode: "bigint" }).notNull().references(() => gpuPools.id, { onDelete: "cascade" }),
    nodeId: bigint("node_id", { mode: "bigint" }).references(() => gpuNodes.id, { onDelete: "set null" }),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    gpuSeconds: integer("gpu_seconds").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    status: text("status").notNull().default("queued"), // queued|running|succeeded|failed|cancelled
    failCode: text("fail_code"),
    createdAt: createdAt(),
  },
  (t) => [index("idx_gpu_jobs_task").on(t.taskId), index("idx_gpu_jobs_pool_time").on(t.poolId, t.createdAt)],
);
```

`model_prices` 加一列（BYOC 与托管分价）：

```ts
computeSource: text("compute_source").notNull().default("hosted"), // hosted|byoc
```

> ⚠ 迁移必须**先 drop 再建**两个唯一索引（`uq_model_prices` 含新列）：`DROP INDEX uq_model_prices; DROP INDEX uq_model_prices_per_call;` 然后按新列重建。历史行默认 `hosted`，不影响现有价目。

### 1.2 迁移脚本（`apps/api/drizzle/0058_fleet.sql`）要点

```sql
CREATE TABLE gpu_accounts (...);
CREATE TABLE gpu_pools (...);
CREATE TABLE gpu_nodes (...);
CREATE TABLE gpu_jobs (...);
ALTER TABLE model_prices ADD COLUMN compute_source text NOT NULL DEFAULT 'hosted';
DROP INDEX IF EXISTS uq_model_prices;
DROP INDEX IF EXISTS uq_model_prices_per_call;
CREATE UNIQUE INDEX uq_model_prices ON model_prices (model_id, mode, resolution, duration_s, compute_source);
CREATE UNIQUE INDEX uq_model_prices_per_call ON model_prices (model_id, mode, resolution, compute_source) WHERE duration_s IS NULL;
```

按仓库惯例：`drizzle-kit generate` 出 SQL + `meta/0058_snapshot.json`，再手改索引顺序。

---

## 2. 后端设计

### 2.1 模块结构（`apps/api/src/modules/fleet/`）

```
fleet.module.ts
fleet.controller.ts        # 用户侧 /v1/compute/*
fleet.service.ts           # 账号/池/节点编排
fleet-budget.service.ts    # 预算闸与花费累计
fleet-reconcile.service.ts # 对账：孤儿实例、失联节点、超预算
providers/
  cloud-provisioner.ts     # 接口（见 byoc §2.2）
  autodl.provisioner.ts    # AutoDL Pro API 实现
  autodl.provisioner.spec.ts
dto/
  bind-account.dto.ts
  pool-settings.dto.ts
```

在 `app.module.ts` 注册；`admin.module.ts` 加只读/干预接口。

### 2.2 AutoDL 客户端（关键 4 个方法）

```ts
const AUTODL_BASE = "https://api.autodl.com";
type Json = Record<string, unknown>;

async function autodl(token: string, method: "GET" | "POST", path: string, body?: Json): Promise<Json> {
  const res = await fetch(`${AUTODL_BASE}${path}`, {
    method,
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new VendorError(...); // 复用 errors.ts 的分类
  const data = (await res.json()) as { code: string; data: unknown; msg: string; request_id: string };
  if (data.code !== "Success") throw new AppError(ErrorCode.FLEET_PROVIDER_ERROR, data.msg || data.code, { requestId: data.request_id });
  return data.data as Json;
}
```

| 方法 | 调用 | 备注 |
|---|---|---|
| `create(token, {spec, count, imageUuid, diskGb, startCommand})` | `POST /api/v1/dev/instance/pro/create` | 返回 `pro-xxxx`；`req_gpu_amount ≤ 4` |
| `powerOn(token, uuid, startCommand)` | `POST .../power_on` `{payload:"gpu", start_command}` | **只支持有卡开机** |
| `powerOff(token, uuid)` | `POST .../power_off` | 关机不释放，数据盘保留 |
| `release(token, uuid)` | `POST .../release` | **先关机**，否则可能失败 |
| `status(token, uuid)` / `snapshot(token, uuid)` | `/status`、`/snapshot` | snapshot 给 `payg_price`（分）→ 实时成本 |
| `listImages(token)` | `POST .../image/private/list` | 建池后确认 `image_uuid` 可用 |

**幂等与孤儿**：`instance_name` 用 `oneframe-p{poolId}-{base36(now)}`；create 重试前先 `list` 查同名实例；对账任务每 10 分钟扫"provider 有、库里 destroyed 无"的实例 → 标记 orphan 并 `release`（防止用户被扣钱，这是我们最不能出的错）。

### 2.3 状态机（节点侧）

```
idle ──job 到达──► provisioning ──create/power_on ok──► booting ──agent 注册──► loading ──warmup ok──► ready
                      │                                    │                      │
                      └─失败/超时(180s)──► error ◄─────────┴──────────────────────┘
ready ──lease──► busy ──job done──► ready ──队列空+idle──► draining ──► stopping ──► stopped
```

超时值：provisioning 180s、booting 120s、loading 300s（权重加载 2~4min）。任一阶段超时 → `gpu_nodes.state=error` + `tasks.error.kind=fleet_*` + **解冻积分**（沿用现有失败路径）。

### 2.4 任务与队列（最小侵入）

- `generations` 在 quote 时按 `compute_source` 选价；BYOC 只扣"平台积分"。
- `tasks.route_snapshot` 加 `engine.pool_id`（沿用 ADR-014 的 engine 块）。
- worker 侧：`runGenerationTask` 的 submit 前多一步 `ensureCapacity(poolId)`（同步等待 provisioning 最多 180s，超时置 `waiting_for_capacity` 并投 `gen.poll` 延时 10s），**不改主状态枚举**。
- 进度回写：`tasks.progress` 复用 0~100；子阶段文案由 `tasks.route_snapshot.engine.stage` 驱动（`provisioning|booting|loading|sampling|uploading`）。

> 为什么不做新主状态：`tasks.status`（1~7）被结算、看门狗、SSE、前端筛选共同依赖；加值等于全链路回归。子阶段放 `route_snapshot.engine.stage` 成本最低。

### 2.5 API（用户侧）

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/v1/compute/summary` | 池状态、节点、今日花费、预算余量、是否已绑 |
| `POST` | `/v1/compute/account` | 绑定 AutoDL Token `{token}`；返回 `{hint, lastCheckStatus}`；**Token 不回显** |
| `DELETE` | `/v1/compute/account` | 吊销（停发任务；不代删实例，提示用户自行释放） |
| `POST` | `/v1/compute/account/test` | 调 `/list` 验证 Token 有效 |
| `GET` | `/v1/compute/pool` / `PATCH` | 机型、lifecycle、idle、预算 |
| `POST` | `/v1/compute/pool/image` | 触发"构建环境"：create 基础镜像实例 → 跑 `build.sh` → `save_image` → 回填 `image_uuid`（异步，返回 job id） |
| `POST` | `/v1/compute/nodes/{id}/start` / `stop` | 手动开关机 |
| `GET` | `/v1/compute/bills?limit=20` | 账单：任务、卡时、金额、估算 API 对比 |
| `GET` | `/v1/compute/readiness` | 轮询：`{state, stage, etaSeconds, detail}` 供前端等待页 |

约束：全部走现有鉴权（`JwtAuthGuard`）+ `X-Space-Id` 校验；写操作限流（`assertOutboundRate` 的同类实现）。

### 2.6 错误码（`packages/shared/src/errors.ts` 新增 7462 段）

```ts
// 7462xx：机队/自带算力
FLEET_TOKEN_INVALID: 746201,      // Token 失效/无权限
FLEET_TOKEN_REQUIRED: 746202,     // 未绑定却选 BYOC 档
FLEET_QUOTA_EXCEEDED: 746203,     // 平台配额/库存不足
FLEET_PROVISION_FAILED: 746204,   // 创建/开机失败
FLEET_NODE_TIMEOUT: 746205,       // 无法在时限内就绪
FLEET_BUDGET_EXCEEDED: 746206,    // 用户自设预算触顶
FLEET_IMAGE_NOT_READY: 746207,    // 环境未构建
FLEET_PROVIDER_ERROR: 746208,     // AutoDL 返回非 Success
```

同步更新 `api-spec §1` 码表与 `schemas.spec.ts` 断言。

### 2.7 模型级算力来源路由（**不是全局开关**）

需求是「同一个站点里，Seedance 2.5 走 OpenAI 兼容 API，H3 走自带 GPU」。所以算力来源必须挂在**模型/价目/路由**上，而不是环境变量。

**三处加字段**：

```ts
// models：默认来源（目录级）
computeSource: text("compute_source").notNull().default("hosted"), // hosted|byoc|either

// model_prices：同一模型不同档位可不同来源（H3 的 2K 只能 hosted，768p 可 byoc）
computeSource: text("compute_source").notNull().default("hosted"),

// model_routes：一条路由对应一种来源
computeSource: text("compute_source").notNull().default("hosted"),
```

**解析顺序**（`generations` 提交时）：

```
1. quote 阶段按 (model, mode, resolution, duration, compute_source) 查价
   → 该档位只有 hosted 价 → 强制 hosted；只有 byoc 价 → 强制 byoc；
   → 两个都有 → 用用户选择（默认 hosted，UI 显示差价）
2. resolveRoute(model_id, compute_source) → model_routes 里该来源下 priority 最小且启用的路由
3. byoc 路由 → adapter h3:video（我方网关 + fleet）；hosted 路由 → 供应商 API
4. 路由快照固化 compute_source + pool_id（沿用 D4/ADR-014）
```

**必须先修的一个隐患（否则多模型分源会串）**：
`registry.ts:138` 的 `resolveAdapter` 是**按 adapter_code 前缀**选适配器，而不是按路由协议。当前逻辑里 `volcengine:*` + 全局 `ARK_API_KEY` 存在时会**先命中 Ark**——即使这条任务的路由是 OpenAI 兼容网关（`provider-runtime.ts` 只往 options 里塞 `httpVideo`，不会清掉全局 `ark`）。于是「Seedance 走三方网关」会被静默打回火山方舟。

修法（二选一，建议前者）：

```ts
// A. 路由协议优先：buildProviderAdapterOptions 里显式清空未选中的适配器配置
if (snapshot.protocol === "http-video") { next.ark = undefined; next.httpVideo = {...}; }
// B. resolveAdapter 增加 adapterHint 参数（"ark" | "http-video" | "h3"），由路由快照传入
```

**这不是本次新增的 bug，是既有代码的隐含耦合**；只要开始「同模型多来源」，它就会变成线上事故。列进里程碑第 0 项。

## 3. 前端设计（Nuxt3）

### 3.1 路由与导航

| 位置 | 改动 |
|---|---|
| 新页 `/compute` | `apps/web/pages/compute.vue`，`definePageMeta({ ssr:false, requiresAuth:true, layout:"app" })` |
| 顶部导航 | `layouts/app.vue` 在头像菜单加 `我的算力`（`t("shell.myCompute")`），与 `/settings` 同级 |
| 设置页 | `settings.vue` 加一块「算力」卡片，链到 `/compute` |
| 任务卡片 | `/tasks` 与生成结果卡片：按 `engine.stage` 显示子阶段文案 |

### 3.2 页面结构（一屏四块）

```
┌ 状态卡 ─────────────────────────────────────────────┐
│ 未绑定 → [绑定 AutoDL]  已绑定 → 节点: 已关机/就绪     │
│ 今日 ¥3.20 / 预算 ¥50  [▓▓░░░░░░]  剩余 ¥46.80      │
└──────────────────────────────────────────────────────┘
┌ 绑定 / 构建向导（未完成时占满）──────────────────────┐
│ ① 粘贴 Token（链接到 AutoDL 设置页）→ ② 验证 →        │
│ ③ 构建环境（首次约 1~2h，主要耗在 67GB 权重下载）      │
└──────────────────────────────────────────────────────┘
┌ 节点 ────────────────────────────────────────────────┐
│ 4090-48G · 运行中 · 本次 12 条 · ¥1.80  [关机]        │
└──────────────────────────────────────────────────────┘
┌ 策略 + 账单 ─────────────────────────────────────────┐
│ 生命周期[会话/按需/常开] 空闲[15]分 日预算[50]元      │
│ 最近 20 条：时间/模型/耗时/卡时/¥/对比 API ¥          │
└──────────────────────────────────────────────────────┘
```

### 3.3 关键文案（中文原文，其余语言走 i18n）

| key | 文案 |
|---|---|
| `compute.title` | 我的算力 |
| `compute.bind.title` | 绑定 AutoDL 账号 |
| `compute.bind.hint` | 只读取开发者 Token，不接触你的账号密码；Token 加密存储，可随时吊销 |
| `compute.bind.step1` | 1. 打开 AutoDL 控制台 → 设置 → 开发者 Token，复制 |
| `compute.bind.step2` | 2. 粘贴到这里（只显示末 4 位） |
| `compute.bind.step3` | 3. 验证并保存 |
| `compute.build.title` | 首次使用需要构建运行环境（约 1~2 小时，主要耗在下载模型权重） |
| `compute.build.costNote` | 构建期间会按量计费，约 ¥2~4；构建完成后再开机不会重复构建 |
| `compute.node.stopped` | 已关机（数据盘保留，不会重复下载模型） |
| `compute.node.ready` | 就绪 · 预计 3 分钟/条 |
| `compute.budget.over` | 已达今日预算，已停止派发新任务 |
| `compute.bill.vsApi` | 同样一条走官方 API 约 ¥{api}，本次 ¥{self} |
| `task.stage.provisioning` | 正在启动你的算力（约 1 分钟） |
| `task.stage.booting` | 算力已开机，正在连接 |
| `task.stage.loading` | 正在加载模型（首次约 3 分钟） |
| `task.stage.sampling` | 正在生成 |
| `task.stage.uploading` | 正在回传成片 |
| `compute.waitingCapacity` | 你的机器已关机。开机后会自动继续，预计等待 4 分钟 |

### 3.4 页面骨架（`pages/compute.vue` 关键片段）

```vue
<script setup lang="ts">
definePageMeta({ ssr: false, requiresAuth: true, layout: "app" });
const { t } = useI18n();
const api = useApi();
const toast = useToast();

const summary = ref<null | {
  bound: boolean; tokenHint?: string; pool: { lifecycle: string; idleMinutes: number;
  gpuSpec: string; imageReady: boolean }; todayCents: number; budgetCents: number;
  nodes: Array<{ id: string; state: string; gpuSpec: string; costCents: number }>;
}>(null);
const token = ref("");
const busy = ref(false);
const readiness = ref<{ state: string; stage?: string; etaSeconds?: number } | null>(null);

async function load() { summary.value = await api.get("/compute/summary"); }
async function bind() {
  busy.value = true;
  try { await api.post("/compute/account", { token: token.value }); token.value = ""; await load(); }
  catch (e) { toast.error((e as Error).message); } finally { busy.value = false; }
}
onMounted(load);
// 节点启动中每 3s 轮询 readiness，进入 ready 后停
</script>
```

组件拆分：`components/compute/BindCard.vue`、`NodeCard.vue`、`BudgetBar.vue`、`BillTable.vue`、`BuildWizard.vue`。

### 3.5 任务卡片的 UI 变化

| 现有 | 新增 |
|---|---|
| 「排队中 / 生成中 45%」 | 前面插入 `provisioning / booting / loading` 三段，带**可解释 ETA** |
| 失败提示 | 新增文案映射：`fleet_provider_failed / fleet_node_timeout / fleet_budget_exceeded`，并给「去我的算力处理」按钮 |

**不要**把"开机中"做成转圈——用户会以为卡死。必须给秒数。

### 3.6 与现有 UI 的兼容矩阵（**默认路径零改动**）

| 现有界面 | 是否改 | 改动性质 | 说明 |
|---|---|---|---|
| 模型选择器（`/tools`、`/create`、`/film`、剧本流水线） | 加字段 | **纯附加** | `GET /models` 响应多一个可选 `compute_source`；卡片只在 `byoc` 时加一个小徽标「自带算力」 |
| 参数面板（时长/比例/分辨率） | 基本不改 | 档位过滤 | 选了 byoc 来源时，分辨率只列 `768P/720P`（本地能力），2K 置灰并提示「2K 需平台算力」 |
| 报价/确认弹层 | 加一行 | 附加 | 展示「平台算力 ¥X」vs「我的算力（自付云厂商 ~¥Y）」两个数字；只有双价模型才出现 |
| 任务卡片（`/tasks`、作品页、画布节点） | 加子阶段 | **仅在 byoc 任务出现** | hosted 任务渲染逻辑完全不动，现有快照测试不用改 |
| 任务详情/失败态 | 加按钮 | 附加 | `fleet_*` 错误码 → 「去我的算力处理」 |
| 设置页 `/settings` | 加一块 | 附加 | 「算力」卡片 → 链到 `/compute` |
| 顶部导航 | 加一项 | 附加 | 头像菜单里「我的算力」 |
| `/compute` | **新页** | 新增 | 只在用户主动进入或首次选 byoc 时到达 |

**结论**：现有 UI 的**默认路径（选 hosted 模型 → 提交 → 看卡片）一行都不用改**；所有新 UI 都挂在"用户选了自带算力"这条支路上。这既是兼容性，也是灰度策略——`FLEET_ENABLED=off` 时前端拿不到 `compute_source=byoc` 的模型，界面与今天完全一致。

### 3.7 多模型分源示例（你要的那条路）

| 模型 | 入口 | 路由 | 算力来源 | 用户看到 |
|---|---|---|---|---|
| Seedance 2.5 | 现有 `volcengine:video` 或三方 OpenAI 兼容网关 | `openai-compatible` + `http-video` | hosted（我们付） | 与今天一致，无徽标 |
| Seedance 2.0 / 2.0 mini | 同上 | 同上 | hosted | 同上 |
| MiniMax H3 · 768P | 模型卡片徽标「自带算力」 | `h3:video` → `h3-gateway` → fleet | **byoc（用户付）** | 首次提示绑定；任务卡显示开机/加载阶段 |
| MiniMax H3 · 2K | 分辨率切 2K 时自动回落 | `minimax:video`（官方 API） | hosted | 提示「2K 由平台算力完成」 |

这样"SD/Seedance 走 API、H3 走组 GPU"就是**目录里两行配置**，不是两套系统。

---

## 4. 管理后台（`/admin/compute`）

| 区块 | 内容 |
|---|---|
| 账号 | 用户、平台、Token 末 4 位、最后校验、吊销 |
| 节点 | 状态、实例 ID、卡时、累计花费、强制关机/释放 |
| 异常 | 孤儿实例（provider 有/库无）、失联节点、连续失败用户 |
| 全局 | 开关 `FLEET_ENABLED`、单用户默认预算上限、白名单机型 |

---

## 5. 环境变量

```
FLEET_ENABLED=off                # off|shadow|on
FLEET_PROVIDER=autodl
FLEET_TOKEN_ENC_KEY=<32B base64> # 与 provider 的 key 分离
FLEET_DEFAULT_GPU_SPEC=v-48g
FLEET_MAX_GPU_COUNT=4
FLEET_IDLE_MINUTES=15
FLEET_PROVISION_TIMEOUT_S=180
FLEET_LOAD_TIMEOUT_S=300
FLEET_RECONCILE_INTERVAL_S=600
```

---

## 6. 测试

| 层 | 用例 |
|---|---|
| 单测 | `autodl.provisioner.spec.ts`：Success/非 Success/401/timeout/限流；`create` 重试不产生两个实例（同名查询） |
| 状态机 | provisioning 超时 → error + 解冻；booting 无心跳 → error；loading 超时 → error；draining 期间新 job 不派发 |
| 预算 | 单任务/单日/月度三闸；触顶后任务停在 `queued` 而非失败 |
| 契约 | `api-spec` 新增 9 个端点的 envelope 与错误码；`schemas.spec.ts` 加 7462xx 断言 |
| E2E | mock AutoDL（本地 HTTP fixture）：绑 Token → 提交 → 自动开机 → 出片 → 自动关机 |

---

## 7. 里程碑与文件清单

| # | 任务 | 文件 | 估时 |
|---|---|---|---|
| **0** | **前置：适配器优先级修复 + `compute_source` 字段**（`resolveAdapter` 不再被全局 `ARK_API_KEY` 抢占） | `packages/model-adapters/src/registry.ts`、`apps/worker/src/provider-runtime.ts`、`models`/`model_routes` 加列 | 0.5d |
| 1 | 迁移 + schema | `packages/db/src/schema.ts`、`apps/api/drizzle/0058_fleet.*` | 0.5d |
| 2 | Provisioner + 单测 | `modules/fleet/providers/autodl.provisioner.ts(.spec)` | 1.5d |
| 3 | fleet service/controller + 预算 | `modules/fleet/*`、`packages/shared/src/errors.ts` | 2d |
| 4 | 对账与孤儿清理 | `fleet-reconcile.service.ts` + 定时任务 | 1d |
| 5 | 任务接入（ensureCapacity + stage 回写 + 按来源选路由） | `apps/worker/src/executor.ts`、`generations` quote/route | 1.5d |
| 6 | `/compute` 页面 + 组件 + i18n | `pages/compute.vue`、`components/compute/*`、`i18n/locales/*` | 2.5d |
| 7 | 模型卡片徽标 + 双价展示 + 任务卡片子阶段 | `pages/tasks.vue`、模型选择组件、生成弹层 | 1d |
| 8 | 管理后台 | `pages/admin/compute.vue` + admin controller | 1d |
| 9 | 文档同步 | `api-spec §1/§5`、`database.md`、`README.md` 地图 | 0.5d |

合计 ≈ 12 人日（单人）；先做 0→5 可跑通后端，6→8 出界面。

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 用户 Token 权限过大（能开 4 卡烧钱） | 单卡默认、日/月预算硬闸、开卡前二次确认、可一键吊销 |
| AutoDL 无 webhook，状态靠轮询 | 5s 轮询 + 本地状态机兜底；失败重试 2 次后置 error |
| 用户关机后任务堆积 | `waiting_for_capacity` + 明确文案 + 30min 后可选回落 API |
| 私有镜像不跨账号 | 首次构建做成向导，明示耗时与费用 |
| 平台改 API | 版本化 provisioner + 契约测试（mock fixture 固定响应） |
| **全局 ARK Key 抢占三方网关路由** | 里程碑 0 修 `resolveAdapter` 优先级；加契约测试：同一 `adapter_code` 走两种 protocol 必须命中不同适配器 |
| 同模型双价撞唯一索引 | 迁移里重建 `uq_model_prices`（含 `compute_source`），先 drop 后建 |
---

## 9. 落地记录（2026-11-04）

| 项 | 状态 | 位置 |
|---|---|---|
| 迁移 `0058_fleet`（4 表 + 3 列 + 重建价目唯一索引） | ✅ 已生成并应用 | `apps/api/drizzle/0058_fleet.sql` |
| 错误码 7462xx | ✅ | `packages/shared/src/errors.ts` |
| `resolveAdapter` 路由优先级修复 + `h3:video` 适配器 | ✅ 含单测 | `packages/model-adapters/src/{registry,h3-gateway}.ts` |
| AutoDL Provisioner（create/power_on/power_off/release/list/snapshot） | ✅ 含单测 | `apps/api/src/modules/fleet/providers/autodl.provisioner.ts` |
| 预算三闸纯函数 | ✅ 含单测 | `fleet-budget.ts` |
| 孤儿实例对账（前缀匹配 + 假活节点判定） | ✅ | `fleet-reconcile.service.ts`、`POST /ops/admin/compute/reconcile` |
| 账号/池/节点/账单服务与 `/v1/compute/*` | ✅ | `fleet.service.ts`、`fleet.controller.ts` |
| `options.compute_source` 与按来源查价 | ✅ | `packages/shared/src/schemas/generation.ts`、`credits.service.ts` |
| `/compute` 页面 + 导航 + 5 语言文案 | ✅ | `apps/web/pages/compute.vue`、`i18n/locales/*` |
| 「首次构建环境」实际 build 流程（`build.sh` + `save_image`） | ⬜ 待补 | 需要真实 AutoDL 账号跑一次 |
| 管理后台（API） | ✅ | `apps/api/src/modules/admin/admin-fleet.controller.ts`：池/节点/花费只读 + 强制关机 |
| 管理后台（前端页） | ⬜ 待补 | 需要在 `pages/admin/index.vue` 的 tab 体系里加一块 |
| 任务卡片子阶段文案（`engine.stage`） | ⬜ 待补 | 需要网关侧先回写 stage |
| 平台契约联调（create/power_on/save_image/镜像回灌/release） | ✅ 2026-11-05 真机 | 见 [byoc-user-gpu.md](byoc-user-gpu.md) §4.4.1 |
| 真实出片联调（社区镜像 + join → 出片） | ⬜ 待补 | 需要 H3 社区镜像的 image_uuid |

> 附带修复：`purgeOldData` 物理删回收站资产前先置空 `extraction_tasks.source_asset_id`，
> 否则 RESTRICT 外键会让整轮清理失败（`apps/worker/src/maintenance.ts`）。
