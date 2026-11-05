# 供应商接入与模型发现设计（提案）

> 状态：**v0.2 · P0 控制面已实施（2026-11-02）**。已落三张表、Key 加密、供应商 CRUD/测试/发现、后台面板；
> 运行时路由解析、任务路由快照、Ark 专用 connector 仍属后续批次。实施记录见 §14。
> 版本：v0.2 · 2026-11-02
> 范围：OpenAI 兼容供应商 + 火山方舟等私有协议供应商
> 非目标：自动定价、自动上架、任意 URL + JSONPath 的通用连接器

## 0. 结论

当前系统有“模型目录”，但没有“供应商接入”。这两件事不能合成一个页面：

- **模型目录**回答“我们卖什么”：能力、档位、价格、是否上架。
- **供应商接入**回答“请求发到哪里、用哪个 Key、对方模型叫什么”。

建议拆成四层，并用 `model_routes` 连接：

```
管理端
  └─ 供应商接入（model_providers / provider_models）
        └─ 模型路由（model_routes）
              └─ 可售模型（models / model_prices）

运行时
  task → model_routes → model_providers → 解密凭据
       → AdapterRuntimeOptions → resolveAdapter(adapter_code)
```

六个关键决策：

| # | 决策 | 理由 |
|---|---|---|
| D1 | **协议适配器**与**供应商账号**分离 | 同一协议可接多个网关；换账号不复制生成逻辑 |
| D2 | **发现结果**与**可售模型**分离 | 对方模型列表不等于可售商品；不能自动产生无价格/无档位脏数据 |
| D3 | **手工导入是一等公民** | 火山方舟当前适配器依赖 `modelMap` 映射到 `ep-xxx`，不能假设一定有列表 API |
| D4 | 任务提交时**固化路由快照** | 异步任务轮询期间换供应商/改 Base URL 会让 `vendorTaskId` 对不上 |
| D5 | 环境变量保留为兜底 | 避免一次性迁移把现有部署打断 |
| D6 | 不做通用 JSONPath 配置器 | 维护成本和 SSRF 风险都会失控；新协议用一个 connector + 契约测试 |

## 1. 现状与缺口

### 1.1 已存在（事实）

| 能力 | 现状 | 证据 |
|---|---|---|
| 模型目录字段 | `vendor/name/capability/adapter_code/modes/...` 已有 | `app/packages/db/src/schema.ts:333` |
| 模型价格 | `model_prices` 支持 mode/resolution/duration/active | `app/packages/db/src/schema.ts:360` |
| 后台模型管理 | 只有 `GET /ops/admin/models` 与 `PATCH /models/:id`（visible/sort/modes） | `app/apps/api/src/modules/admin/admin.controller.ts:342` |
| 新增模型 | 后台没有 `POST /models`；只有 seed / `tool-catalog` 插入 | `app/apps/api/src/db/seed.ts:1660`、`app/apps/api/src/modules/generations/tool-catalog.ts:1254` |
| 适配器协议 | `deepseek:chat`、`volcengine:video/image`、`http-video`、后处理等 | `app/packages/model-adapters/src/registry.ts:138` |
| Ark 模型映射 | `modelMap` 把我方模型名映射为 `ep-xxx` / 模型 ID | `app/packages/model-adapters/src/ark-video.ts:8` |
| 凭据来源 | 环境变量在 worker 启动时构造全局 `adapterOptions` | `app/apps/worker/src/main.ts:98` |
| 供应商健康探测 | 明确未实现，靠人工置灰 + 指标观察 | `docs/02-architecture/system-design.md:164` |

### 1.2 缺口

1. 没有供应商账号/凭据表；Key 只能进环境变量，改一次要重启。
2. 没有 Base URL / Key 的后台维护入口，也没有 Key 轮换与脱敏回显。
3. 没有模型发现：OpenAI 兼容的 `GET /models` 没有接；Ark 的 endpoint ID 只能靠 `ARK_MODEL_MAP` 手写。
4. 没有“可售模型 → 供应商模型”的路由表，无法表达一个模型多供应商，也无法表达 Ark 的 `ep-xxx`。
5. 无法在后台新增可售模型，只能改已有行。

## 2. 分层设计

### 2.1 控制面与数据面

- **控制面（新增）**：供应商 CRUD、测试连接、发现模型、导入候选、维护路由。
- **数据面（现有）**：任务提交/轮询调用 `resolveAdapter(code, options)`。

控制面不要复制生成逻辑。Connector 只负责“发现/测试/把供应商配置翻译成现有 Adapter 配置”，真正的 submit/poll/cancel 仍由 `packages/model-adapters` 负责。

### 2.2 ProviderConnector 接口

```ts
export type DiscoveryMode = "api" | "manual" | "none";

export interface ProviderContext {
  providerId: string;
  protocol: string;
  baseUrl: string;
  secret: string;
  options: Record<string, unknown>;
}

export interface DiscoveredModel {
  remoteModelId: string;
  displayName?: string;
  raw: unknown;
}

export type ProviderTestResult =
  | { ok: true; latencyMs: number; message?: string }
  | {
      ok: false;
      kind: "auth" | "network" | "timeout" | "unsupported" | "invalid_config";
      message: string;
    };

export interface ProviderConnector {
  protocol: string;
  discovery: DiscoveryMode;
  authTypes: Array<"bearer" | "header">;
  test(ctx: ProviderContext): Promise<ProviderTestResult>;
  discover?(ctx: ProviderContext): Promise<DiscoveredModel[]>;
  buildAdapterOptions(ctx: ProviderContext, remoteModelId: string): unknown;
}
```

约束：

- `discovery: "manual"` 的协议，`discover` 可以不存在；UI 必须展示“手工录入”，不能显示一个永远失败的“拉取”按钮。
- `test()` 只能做协议层真实探测；没有安全探测方式时返回 `unsupported`，不能伪造 `ok:true`。
- `buildAdapterOptions()` 输出必须能被现有 `AdapterRuntimeOptions` 消费，避免出现第二套适配器配置模型。

### 2.3 协议清单

| protocol | 发现方式 | 认证 | 说明 |
|---|---|---|---|
| `openai-compatible` | `api` | Bearer / 自定义 header | `GET {base}/v1/models`；base 已以 `/v1` 结尾时不重复拼接 |
| `ark` | `manual`（待官方取证再评估 `hybrid`） | Bearer | 录入 `ep-xxx` / 模型 ID；当前适配器已支持 `modelMap` |
| `http-video` | `manual` | Bearer 可选 | submit/poll/cancel 路径由供应商配置 |
| `jianying` | `manual` | Bearer（= 网关 `API_KEYS`） | 剪影生图网关：**同步出图**（无 vendor_task_id）、只有 `image` 能力、效果 id 是私有权表；不复用 `openai-compatible`（那条分支按 capability 分 text/video）。见 [jianying-gateway-integration](jianying-gateway-integration.md) |
| `custom:<name>` | 由 connector 声明 | 由 connector 声明 | 新增协议 = 新文件 + fixture 测试，不加数据库字段 |

> Ark 是否存在可用的官方模型列表接口，必须在实施前用官方文档/实测确认。没有证据时，
> 产品上只承诺“手工导入 endpoint”，不承诺“自动拉全量”。

## 3. 数据模型

三张新表；`models` / `model_prices` 不改结构。

```sql
CREATE TABLE model_providers (
  id                    BIGINT PRIMARY KEY,
  code                  TEXT NOT NULL UNIQUE,        -- ark-main / deepseek-main / gw-a
  name                  TEXT NOT NULL,
  protocol              TEXT NOT NULL,               -- openai-compatible | ark | http-video
  base_url              TEXT NOT NULL,
  auth_type             TEXT NOT NULL DEFAULT 'bearer',
  auth_header           TEXT NOT NULL DEFAULT 'Authorization',
  credentials_ciphertext TEXT NOT NULL,             -- base64(iv.tag.ciphertext)
  encryption_key_id     TEXT NOT NULL DEFAULT 'v1',
  credential_version    INTEGER NOT NULL DEFAULT 1,
  key_hint              TEXT NOT NULL DEFAULT '',    -- 仅末 4 位
  key_fingerprint       TEXT NOT NULL DEFAULT '',    -- SHA-256 前 8 位，用于重复检测
  options               JSONB NOT NULL DEFAULT '{}', -- 超时、models_path、默认 header
  status                SMALLINT NOT NULL DEFAULT 1, -- 1 启用 / 0 停用
  last_check_at         TIMESTAMPTZ,
  last_check_status     TEXT,                        -- ok|auth|network|timeout|unsupported
  last_check_message    TEXT,
  created_by            BIGINT REFERENCES admin_users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_model_providers_status ON model_providers(status);

CREATE TABLE provider_models (
  id                BIGINT PRIMARY KEY,
  provider_id       BIGINT NOT NULL REFERENCES model_providers(id) ON DELETE CASCADE,
  remote_model_id   TEXT NOT NULL,
  display_name      TEXT NOT NULL DEFAULT '',
  capability_hint   TEXT,                            -- 仅推测，不作为可售能力
  raw               JSONB NOT NULL DEFAULT '{}',
  status            SMALLINT NOT NULL DEFAULT 1,     -- 1 可见 / 0 对方已下线
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, remote_model_id)
);

CREATE INDEX idx_provider_models_provider ON provider_models(provider_id, status);

CREATE TABLE model_routes (
  id                BIGINT PRIMARY KEY,
  model_id          BIGINT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  provider_id       BIGINT NOT NULL REFERENCES model_providers(id),
  remote_model_id   TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 100,    -- 越小越优先
  weight            INTEGER NOT NULL DEFAULT 100,    -- 预留给灰度/分流
  active            BOOLEAN NOT NULL DEFAULT true,
  options           JSONB NOT NULL DEFAULT '{}',     -- 该路由的额外覆盖
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, provider_id, remote_model_id)
);

CREATE INDEX idx_model_routes_model ON model_routes(model_id, active, priority);
CREATE INDEX idx_model_routes_provider ON model_routes(provider_id, active);
```

### 3.1 为什么不在 `models` 上加 `provider_id`

- 一个可售模型可能有多条路由（主备、灰度、跨区）。
- `models` 是商品，`model_routes` 是供应链；把供应商塞进商品表会让换供应商变成改商品。
- Ark 的 `ep-xxx` 属于路由，不属于商品名。

### 3.2 任务路由快照（实施时必须补）

异步任务的 `vendorTaskId` 只对创建它的供应商有效。若提交后运营改了该模型的 Base URL 或路由，
worker 下次轮询可能用新供应商去查旧任务。因此提交任务时必须固化：

```text
tasks.route_id           -- 选中的 model_routes.id
tasks.route_snapshot     -- {provider_id, protocol, base_url, remote_model_id, options}
```

轮询/取消只认快照；Key 按 `provider_id` 读取最新版本（允许轮换），但 Base URL 和 remote model
不跟随后台修改。`route_snapshot` 不存密钥。表结构落地时优先考虑 `tasks` 增加两列，或新增
`task_routes` 1:1 表，避免把大 JSON 塞进高频查询的 `tasks` 行。

## 4. 管理 API

所有端点走现有 `AdminGuard`，写操作由 `AdminAuditInterceptor` 留痕；Key 明文永不进入响应。

| 方法 | 路径 | 权限 | 行为 |
|---|---|---|---|
| GET | `/ops/admin/providers` | viewer+ | 列表；只回 `key_hint` / `configured` |
| POST | `/ops/admin/providers` | super | 创建；Key 加密后落库 |
| PATCH | `/ops/admin/providers/:id` | super | 改名/改地址/轮换 Key；`key` 省略表示不变 |
| DELETE | `/ops/admin/providers/:id` | super | **软停用**；存在 active 路由时拒绝 |
| POST | `/ops/admin/providers/:id/test` | ops+ | 真实探测；返回结构化 `ok/kind` |
| POST | `/ops/admin/providers/:id/discover` | ops+ | 拉取候选；不自动入库 |
| POST | `/ops/admin/providers/:id/provider-models` | ops+ | 手工批量录入 remote model ID |
| GET | `/ops/admin/provider-models?provider_id=` | viewer+ | 候选列表 |
| GET | `/ops/admin/model-routes?model_id=` | viewer+ | 路由列表 |
| POST | `/ops/admin/model-routes` | ops+ | 新增路由；校验 provider 启用 |
| PATCH | `/ops/admin/model-routes/:id` | ops+ | 改 priority/active/remote id |
| POST | `/ops/admin/models` | ops+ | 新增可售模型草稿（默认 `visible=false`） |

响应示例：

```json
{
  "ok": true,
  "latency_ms": 123,
  "checked_at": "2026-11-02T12:00:00Z"
}
```

```json
{
  "supported": false,
  "reason": "manual_import_required",
  "message": "该协议不提供模型列表接口，请粘贴 endpoint ID"
}
```

```json
{
  "supported": true,
  "models": [
    { "remote_model_id": "gpt-4o-mini", "display_name": "gpt-4o-mini", "raw": {} }
  ],
  "fetched_at": "2026-11-02T12:00:00Z"
}
```

约束：

- `test` / `discover` 是 POST（有副作用、要限流），不能做成可缓存的 GET。
- `discover` 只写 `provider_models` 缓存时可选择“仅预览”，导入必须再次确认。
- `POST /models` 必须要求 capability / adapter_code / modes；价格可空，默认不上架。
- 删除供应商不物理删，保留历史任务与审计可追溯。

## 5. 运行时解析

### 5.1 解析流程

```text
task.model_id
  → 查 model_routes（active，按 priority）
  → 选路由（MVP 取第一条；weight 暂不参与）
  → 读 model_providers
  → 解密 credentials
  → connector.buildAdapterOptions(provider, remote_model_id)
  → resolveAdapter(model.adapter_code, options)
  → adapter.submit/poll/cancel
```

### 5.2 开关与兜底

新增 `PROVIDER_DB_RESOLVE`：

| 值 | 行为 |
|---|---|
| `off` | 完全沿用环境变量（默认，用于回滚） |
| `fallback` | 有路由走数据库；没有路由回落环境变量 |
| `on` | 只走数据库；缺路由/供应商直接失败，不静默 mock |

迁移期建议 `fallback`，验收后切 `on`。`ADAPTER_MODE=mock` 时不解析供应商，保持现有本地/CI 行为。

### 5.3 缓存与失效

- API / worker 进程内缓存 30–60 秒；缓存键 `provider_id + credential_version`。
- 后台更新供应商后发 Redis pub/sub `provider:invalidate`；收不到也会因 TTL 自然失效。
- 解密失败不缓存，直接报 `invalid_config`，避免把错误状态固化。
- **不把 Key 放进 BullMQ job payload**；worker 自己读库解密，减少密钥在队列/日志中的暴露面。

### 5.4 失败语义

- 供应商认证失败：复用 `745900 VENDOR_ERROR`，`details.kind=auth`。
- 供应商超时：`745901 VENDOR_TIMEOUT`。
- 配置缺失/路由不存在：`400101 invalid provider config`，不降级到 mock。
- 轮询阶段使用任务快照；供应商被停用不改变已提交任务，除非人工取消。

## 6. 管理端交互

新增“模型接入”页，放在“模型目录”之前：

```text
供应商列表
  ├─ 名称 / 协议 / Base URL / Key 末四位 / 状态 / 最近测试
  ├─ 新建
  └─ 详情
       ├─ 测试连接
       ├─ 自动发现（仅 discovery=api）
       ├─ 手工录入（discovery=manual）
       └─ 候选模型 → 选择能力/协议 → 导入草稿

模型目录
  └─ 来源 / 路由：provider + remote_model_id
```

交互约束：

- Key 输入框是 write-only；保存后只显示 `sk-****abcd`，不提供“查看明文”。
- 测试失败显示 `kind + message`，不要把供应商原始响应体整段展示（可能含敏感信息）。
- 自动发现结果按 `remote_model_id` 去重；已导入的行标注“已存在”。
- 能力/档位必须运营确认；发现结果不自动创建价格、不自动 `visible=true`。
- Ark 等手工协议提供多行粘贴，每行一个 endpoint ID；导入时统一选 capability。

## 7. 安全

### 7.1 凭据加密

- AES-256-GCM；随机 96-bit IV；AAD 绑定 `provider_id + credential_version`。
- 主密钥来自 `PROVIDER_ENCRYPTION_KEY`（32 bytes base64）或生产 KMS；密钥版本写
  `encryption_key_id`，轮换时保留旧版本解密能力。
- 列表/详情/错误/审计只允许 `key_hint`、`key_fingerprint`；禁止回显密文或明文。
- 审计 before/after 必须脱敏；日志扫描测试要覆盖 `sk-`、长随机串。

### 7.2 SSRF

Base URL 是用户可控出站地址，必须：

- 生产只允许 HTTPS；HTTP 仅本地开发显式开关。
- 解析 DNS 后拒绝 loopback / private / link-local / multicast / IPv4-mapped IPv6。
- 禁止重定向；每次请求重新校验；必要时用自定义 `lookup` 固定解析结果，防 DNS rebinding。
- 连接/响应超时 10s；响应体上限 1 MB；只读取 JSON。
- 测试/发现按管理员限流（例如 10 次/分钟），失败不重试到第三方。

### 7.3 权限

| 角色 | 查看供应商 | 测试/发现 | 新增/改 Key | 删除/停用 |
|---|---|---|---|---|
| viewer | ✅（脱敏） | ❌ | ❌ | ❌ |
| ops | ✅（脱敏） | ✅ | ❌ | ❌ |
| super | ✅（脱敏） | ✅ | ✅ | ✅ |

## 8. 兼容与迁移

1. 新增三张表 + `tasks` 路由快照列（迁移一次完成）。
2. 可选回填脚本：把现有 `ARK_API_KEY` / `DEEPSEEK_API_KEY` / `HTTP_VIDEO_*` 写成
   `ark-main` / `deepseek-main` / `http-video-main`；不自动回填，避免把开发 Key 写进生产。
3. 路由回填规则：
   - `deepseek:chat` → `deepseek-main`，`remote_model_id = models.name`。
   - `volcengine:*` → `ark-main`，`remote_model_id = ARK_MODEL_MAP[name] ?? name`。
   - `http-video` → `http-video-main`，`remote_model_id = models.name`。
4. 先开 `PROVIDER_DB_RESOLVE=fallback`，跑全量任务 E2E 后切 `on`。
5. 回滚：切回 `off` 即恢复纯环境变量；新表保留，不影响旧路径。

## 9. 观测

建议指标：

- `provider_test_total{protocol,result}`
- `provider_discovery_total{protocol,result}`
- `provider_resolve_total{result}`
- `provider_resolve_fallback_total`
- `provider_decrypt_fail_total`
- `provider_route_missing_total`

日志字段：`provider_id`、`protocol`、`route_id`、`task_id`、`result`、`latency_ms`；
**绝不记录** Key、密文、完整供应商响应。

## 10. 测试

- 加密：round-trip、错误 AAD、密钥版本轮换、密文不出现在 API 响应。
- SSRF：私网/回环/重定向/DNS rebinding/超大响应/超时。
- Connector：OpenAI `/models` fixture；Ark manual 不支持发现；未知协议显式报错。
- 路由：同模型多路由取 priority；停用路由不参与；缺路由走 fallback。
- 任务：提交时写快照；轮询使用快照；后台改 Base URL 不影响已提交任务。
- E2E：本地假 OpenAI 服务 → 填地址/Key → 测试 → 发现 → 导入 → 定价 → 生成任务全链路。

## 11. 分批实施

| 批次 | 内容 | 验收 |
|---|---|---|
| P0（约 2 天） | 三表迁移、加密服务、供应商 CRUD/测试、审计、后台列表/表单 | Key 不回显；测试连接有真实结果；无权限绕过 |
| P1（约 2–3 天） | OpenAI 兼容发现、手工导入、`POST /models`、路由、运行时解析、`fallback` | 假 OpenAI 服务全链路；旧环境变量路径不回归 |
| P2（约 2–3 天） | Ark/http-video connector、Key 轮换、任务快照、路由故障切换 | 已提交任务不受配置变更影响；Ark 手工 endpoint 可出片 |

> 工期是主观估算，不含真实供应商联调与商务开通时间。

## 12. 明确不做

- 不做“任意 URL + JSONPath 映射”的通用连接器。
- 不自动给发现到的模型定价、上架或生成档位。
- 不把 Key 存进 `models`、前端 localStorage 或任务 payload。
- 不在没有官方证据时承诺 Ark 自动列模型。
- MVP 不做多路由自动故障切换的复杂权重调度；表结构先支持，运行时先取 priority 第一条。

## 13. 待确认

1. 火山方舟是否有安全、低成本的官方“测试连接/列模型”接口；没有就保持 `manual`。
2. 生产密钥用环境主密钥还是云 KMS；这决定轮换与权限边界。
3. `ops` 是否可以新建供应商，还是只允许 `super` 建、`ops` 只能用。
4. MVP 是否需要多路由故障切换，还是先单路由 + 人工切换。

## 14. 实施状态（2026-11-02）

### 已完成（P0 控制面）

| 项 | 状态 | 证据 |
|---|---|---|
| 三张表 + 迁移 0051 | ✅ | `packages/db/src/schema.ts`、`apps/api/drizzle/0051_dizzy_franklin_richards.sql` |
| AES-256-GCM Key 加密 / 末四位回显 / 指纹 | ✅ | `apps/api/src/modules/admin/provider-crypto.ts` |
| 供应商 CRUD / 软停用 / 有 active 路由时禁止停用 | ✅ | `admin-providers.controller.ts` / `admin-providers.service.ts` |
| 测试连接（OpenAI 兼容） | ✅ | `POST /ops/admin/providers/:id/test` |
| 模型发现（OpenAI 兼容）/ Ark 手工导入 | ✅ | `POST /ops/admin/providers/:id/discover`、`/provider-models` |
| 模型路由 CRUD / 新增可售模型草稿 | ✅ | `/ops/admin/model-routes`、`POST /ops/admin/models` |
| 后台“供应商接入”面板 + 菜单 | ✅ | `apps/web/components/admin/AdminProvidersPanel.vue` |
| API E2E（11 条）+ 浏览器 UI 冒烟 | ✅ | `test/admin-providers.spec.ts`、`test/provider-crypto.spec.ts` |

### 2026-11-03 收口结果

| 项 | 状态 | 证据 |
|---|---|---|
| 运行时路由 | ✅ | `PROVIDER_DB_RESOLVE=off/fallback/on` 同时接入 API 选路与 worker 解析；off 可回滚纯环境变量 |
| 任务路由快照 | ✅ | 迁移 `0052_icy_thena.sql`；`tasks.route_id/route_snapshot`，快照不含 Key |
| 多路由选择 | ✅ | 提交时按 `priority` + 同优先级 `weight` 选路由；不做提交后的盲目自动重投，避免供应商侧重复计费 |
| Key 轮换 UI | ✅ | 后台“供应商接入”面板可直接输入新 Key，明文不回显 |
| SSRF DNS pin（控制面） | ✅ | 测试/发现按校验时解析出的地址建立连接，SNI/Host 仍为原域名 |
| 独立限流 | ✅ | test/discover 按管理员 10 次/分钟 |
| Ark/HTTP 私有协议探针 | ⏳ 外部证据 | 仍明确返回 `unsupported`；没有官方安全探测协议时不伪造成功，只支持手工导入 |

> 诚实边界：worker 的运行态出站仍由既有适配器 `fetch` 发起，控制面包头的 DNS pin
> 不改变第三方适配器内部实现；生产启用数据库路由前仍应完成真实供应商联调。
