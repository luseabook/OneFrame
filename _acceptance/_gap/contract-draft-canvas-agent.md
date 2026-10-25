# 契约草案 A：canvas 画布域 + agent 对话式创作域

> 状态：**草案（F1，未落码）** · 拟稿：contract-canvas-agent · 2026-10-26
> 唯一写入：本文件。**未修改 docs/ 与任何源码**。
> 目标：为 Lead 合并进 `docs/02-architecture/{database,api-spec,system-design}.md` 提供可审材料。
> 铁律遵循声明：本文每条关键设计均给 `文件:行`；事实与假设严格分离（见 §6）；不新增未登记错误码（待新增码集中 §6.4）。

---

## 0. 结论摘要（给 Lead）

| 项 | 值 |
|---|---|
| 两域端点（routes.txt 去重路径数） | **93**（canvas 81 + agent 12） |
| 其中「方法×路径」对 | **112**（canvas 100 + agent 12；15 个路径承载多方法，见 §1.0） |
| 本文起草表 | **13 张**（canvas 9 + agent 4） |
| 其中基于 database.md §7 占位补齐 | 4 张（`canvases`/`canvas_nodes`/`canvas_edges`/`canvas_snapshots`） |
| 新增表（本节新提，非 §7 占位） | 9 张（canvas 5 + agent 4） |
| 待新增错误码 | **2 条**（746004、746005，均在 7460xx 段） |
| 待取证 / 假设项 | **17 条**（§6.2 SSE 事件与结构 5 条 + §6.3 语义 13 条，其中 A-05 与 G-12 同源合并计 1） |
| 复用现有任务表 | **是**，媒体/LLM 生成一律落 `tasks`（database.md §3），零新增任务表 |
| 空间隔离 | 全部落 `space_id`（含子表冗余，理由见 §2.1） |

---

## 1. 端点盘点

### 1.0 盘点方法与可信度分层

`routes.txt` 是**前端路由常量表**（928 行），同时混有页面路由与 API 路径常量，因此单凭它无法区分「后端端点」与「页面/CLI 侧路径」。本节采用三方交叉核验：

| 证据源 | 含义 | 可信度 |
|---|---|---|
| `rea-reelmate/routes.txt` | 路由常量全集 | 路径存在性 = 事实 |
| `rea-reelmate/capture-canvas.json` 内联 bundle 的请求配置对象（`path:…,method:Method.X,queryNames:[…],requestBodyType:…`） | 前端 API 客户端的**编译产物定义** | 方法/查询参数/body 类型 = 事实 |
| `rea-reelmate/net-canvas.json` / `net-node.json` 抓包（`capture_browser_scenario`，authority=`controlled-replay`，confidence=`observed`） | 运行时实际发出的请求 | 实发 URL = 事实；响应体因未捕获 `network.response_body` 而**未知** |

**机械核验结果（可复现）**：把 routes.txt 中 `:param` 归一为 `{param}` 后，与 bundle 请求配置做集合差，
canvas 族 **81 条完全一致**（唯一差异只是 `{a}` 与 `:a` 的占位符写法），agent 族 **12 条完全一致**。
→ 结论：**这 93 条都是真实后端端点，不是页面路由**。

**方法计数（可复现）**：从 bundle 请求配置中正则提取 `path:"…" … method:Method.X`，去重后得
**112 个 (path, method) 对**，覆盖 93 个不同路径；即 **15 个路径承载多方法**（如 `nodes/:node_id` 有 GET/PUT/DELETE，
`pinned-timelines` 有 GET/POST/DELETE）。分布：canvas 100 对 / 81 路径；agent 12 对 / 12 路径。
各端点的具体方法已逐条标注于 §1.1 表（canvas）与 §1.2 表（agent），**不在 routes.txt 内**（routes.txt 只有路径，无方法）。

> **页面/CLI 侧路径（非本域后端端点，不计入 93）**：`routes.txt:20` `/canvas`、`:24` `/cli`、`:14-16` `/agent`、`/agent/bigscreen`、`/agent/editor`、`:924` `/workflow-canvas`、`:42` `/creation-agent`。这些是 Web 页面路由。
> CLI 侧不是独立路径族，而是映射到本域后端端点（`canvas.md`/`node.md`/`agent.md` 中「路径 `…`」的说明）。

### 1.1 canvas 域（routes.txt:322–402，共 81 条，13 个子族）

| # | 子族 | 条数 | routes.txt 行号 |
|---|---|---:|---|
| C1 | 画布根 | 2 | 322, 325 |
| C2 | 整画布模板 `canvas-tpls` / `canvas/:id/tpls` | 8 | 323, 324, 375, 376, 392, 393, 394, 395 |
| C3 | 节点 | 7 | 327, 329, 358, 359, 360, 386, 391 |
| C4 | 连线 | 4 | 326, 328, 349, 350 |
| C5 | 节点锁/心跳 | 4 | 355, 362, 363, 369 |
| C6 | 节点派生任务（LLM/媒体） | 9 | 330, 361, 364, 365, 366, 367, 368, 370, 371 |
| C7 | 画布内对话（Agent 会话） | 11 | 331–341 |
| C8 | 评论 | 5 | 343–347 |
| C9 | 组/固定组/钉住 | 13 | 351–354, 372–374, 387, 396, 399–402 |
| C10 | 素材 | 6 | 356, 357, 377, 388–390 |
| C11 | 图像编辑（裁剪/裁切） | 2 | 342, 348 |
| C12 | 表格节点 | 2 | 397, 398 |
| C13 | Agent 技能卡 | 8 | 378–385 |

合计 2+8+7+4+4+9+11+5+13+6+2+2+8 = **81** ✓

逐条清单（行号 → 路径 → 方法，方法取自 bundle 请求配置）：

| 行 | 路径（去掉 `/web/v1`） | 方法 |
|---:|---|---|
| 322 | `/df/canvas` | POST |
| 323 | `/df/canvas-tpls` | GET |
| 324 | `/df/canvas-tpls/:template_id` | GET |
| 325 | `/df/canvas/:canvas_id` | GET / PUT |
| 326 | `/df/canvas/:canvas_id/batch-del-edges` | POST |
| 327 | `/df/canvas/:canvas_id/batch-del-nodes` | POST |
| 328 | `/df/canvas/:canvas_id/batch-edges` | POST |
| 329 | `/df/canvas/:canvas_id/batch-edit-nodes` | POST |
| 330 | `/df/canvas/:canvas_id/batch-node-tasks` | POST |
| 331 | `/df/canvas/:canvas_id/chat/sessions` | GET / POST |
| 332 | `/df/canvas/:canvas_id/chat/sessions/:session_id` | PATCH / DELETE |
| 333 | `…/messages` | GET（q: `after_event_id,page_size`）/ POST |
| 334 | `…/messages/:message_id/node-binding` | POST |
| 335 | `…/messages/:message_id/reaction` | POST |
| 336 | `…/sessions/:session_id/read` | POST |
| 337 | `…/sessions/:session_id/stream` | GET（q: `last_stream_id`，**SSE**） |
| 338 | `…/tasks/:task_id/cancel` | POST |
| 339 | `…/tasks/:task_id/feedback` | POST |
| 340 | `…/tasks/:task_id/interrupt` | POST |
| 341 | `/df/canvas/:canvas_id/chat/writing-outputs` | GET |
| 342 | `/df/canvas/:canvas_id/clip` | POST |
| 343 | `/df/canvas/:canvas_id/comment-nodes` | GET（q: `scope,resolved,order,page,page_size,uid`）/ POST |
| 344 | `…/comment-nodes/:comment_node_id` | GET / PUT / DELETE |
| 345 | `…/comment-nodes/:id/comments` | POST |
| 346 | `…/comment-nodes/:id/comments/:comment_id` | PUT / DELETE |
| 347 | `…/comment-nodes/:id/resolve` | POST |
| 348 | `/df/canvas/:canvas_id/crop` | POST |
| 349 | `/df/canvas/:canvas_id/edges` | POST |
| 350 | `/df/canvas/:canvas_id/edges/:edge_id` | DELETE |
| 351 | `/df/canvas/:canvas_id/group-recover` | POST |
| 352 | `/df/canvas/:canvas_id/groups/:group_id` | DELETE |
| 353 | `…/groups/:group_id/templates` | GET / POST |
| 354 | `…/groups/:group_id/templates/:template_id` | PUT |
| 355 | `/df/canvas/:canvas_id/heartbeat` | POST |
| 356 | `/df/canvas/:canvas_id/materials` | GET（q: `page,page_size,material_type,source,node_id`）/ POST |
| 357 | `…/materials/batch-delete` | POST |
| 358 | `/df/canvas/:canvas_id/nodes-asset?node_type=image` | GET |
| 359 | `/df/canvas/:canvas_id/nodes-recover` | POST |
| 360 | `/df/canvas/:canvas_id/nodes/:node_id` | GET / PUT / DELETE |
| 361 | `…/nodes/:node_id/asset-extraction` | POST |
| 362 | `…/nodes/:node_id/lock` | GET（q: `project_id`）/ POST |
| 363 | `…/nodes/:node_id/renew` | POST |
| 364 | `…/nodes/:node_id/script-optimization` | POST |
| 365 | `…/nodes/:node_id/storyboard-asset-match` | POST |
| 366 | `…/nodes/:node_id/storyboard-asset-match/cancel` | POST |
| 367 | `…/nodes/:node_id/storyboard-asset-rematch` | POST |
| 368 | `…/nodes/:node_id/storyboard-parse` | POST |
| 369 | `…/nodes/:node_id/unlock` | POST |
| 370 | `…/nodes/:node_id/video-parse` | POST |
| 371 | `…/nodes/:node_id/video-parse/:task_id` | GET |
| 372 | `/df/canvas/:canvas_id/pin-groups/members` | DELETE |
| 373 | `/df/canvas/:canvas_id/pinned-timelines` | GET / POST / DELETE |
| 374 | `/df/canvas/:canvas_id/pinned-timelines/:node_id` | DELETE |
| 375 | `/df/canvas/:canvas_id/tpls` | POST |
| 376 | `/df/canvas/:canvas_id/tpls/:template_id/elements/batch-create` | POST |
| 377 | `/df/canvas/:canvas_id/upload-file` | POST |
| 378 | `/df/canvas/agent-recommend-cards` | GET |
| 379 | `/df/canvas/agent-skills` | POST / PUT |
| 380 | `/df/canvas/agent-skills/:skill_id` | DELETE |
| 381 | `/df/canvas/agent-skills/:skill_id/favorite` | POST / DELETE |
| 382 | `/df/canvas/agent-skills/details` | GET（q: `skill_id,owner_type`） |
| 383 | `/df/canvas/agent-skills/favorites` | GET（q: `page,page_size`） |
| 384 | `/df/canvas/agent-skills/mine` | GET（q: `status,page,page_size`） |
| 385 | `/df/canvas/agent-skills/plaza` | GET（q: `category,name,page,page_size,is_home_recommend`） |
| 386 | `/df/canvas/batch-nodes` | POST |
| 387 | `/df/canvas/groups` | POST |
| 388 | `/df/canvas/node/batch-download` | POST |
| 389 | `/df/canvas/node/batch-download/list` | GET（q: `page,page_size,canvas_id`） |
| 390 | `/df/canvas/node/batch-download/url` | POST |
| 391 | `/df/canvas/nodes` | POST |
| 392 | `/df/canvas/templates/:template_id` | GET |
| 393 | `/df/canvas/templates/:template_id/sync-team` | POST |
| 394 | `/df/canvas/templates/personal` | GET（q: `query`） |
| 395 | `/df/canvas/templates/personal/:template_id` | DELETE |
| 396 | `/df/canvas/{canvas_id}/nodes/{node_id}/pin-groups` | PUT |
| 397 | `/df/canvas/{canvas_id}/nodes/{node_id}/table/confirm-sheet` | POST |
| 398 | `/df/canvas/{canvas_id}/nodes/{node_id}/table/import` | POST |
| 399 | `/df/canvas/{canvas_id}/pin-groups` | GET |
| 400 | `/df/canvas/{canvas_id}/pin-groups/{group_id}` | PUT |
| 401 | `/df/canvas/{canvas_id}/pin-groups/{group_id}/members` | DELETE |
| 402 | `/df/canvas/{canvas_id}/pinned-node` | GET / PUT / DELETE |

> **注**：`{canvas_id}` 与 `:canvas_id` 混用是 RE 原始路由表的写法差异，非两个端点（bundle 另有一份 `{}` 版本，同上）。合并时统一为 `:canvas_id`。

### 1.2 agent 域（routes.txt:123–134，共 12 条）

| 行 | 路径（去掉 `/web/v1`） | 方法 | 查询参数 | body 类型 | SSE |
|---:|---|---|---|---|---|
| 123 | `/agent/home/resource/info` | GET | `id` | query | — |
| 124 | `/agent/home/resource/recommend` | GET | — | query | — |
| 125 | `/agent/home/resource/sse` | GET | `id` | query | **是** |
| 126 | `/agent/stt-token` | GET | — | query | — |
| 127 | `/agent/task/batch-download` | POST | — | json | — |
| 128 | `/agent/task/chat` | POST | — | json | — |
| 129 | `/agent/task/chat-end` | POST | — | json | — |
| 130 | `/agent/task/create` | POST | — | json | — |
| 131 | `/agent/task/create-check` | POST | — | json | — |
| 132 | `/agent/task/share/{share_id}/sse` | GET | — | query | **是** |
| 133 | `/agent/task/stream` | POST | `task_id` | raw | **是** |
| 134 | `/agent/task/{task_id}` | **GET + PUT** | `task_id` | — / json | — |

子族：首页资源 3、语音票据 1、任务 8。

### 1.3 两域相邻但**不属于**本域的画布族（边界声明）

以下三族名字含 canvas，但分属其他服务前缀，**不纳入**本草案（避免与流水线/影视版域重复设计）：

| 位置 | 族 | 归属 |
|---|---|---|
| `routes.txt:315-318` | `/web/v1/df/anu/canvas/:canvas_id/{batch-download,batch-file-thumb,batch-nodes-details,canvas-info}` | `anu` 服务（AI 网关侧） |
| `routes.txt:775-779` | `/web/v1/film/projects/:project_id/canvases/*` | 影视版（`film`）项目域 |
| `routes.txt:792` | `/web/v1/film/.../canvas-bindings` | 影视版任务表绑定 |
| `routes.txt:813` | `/web/v1/kds/da/canvas/total-point-consume` | 计费域 |

### 1.4 与 routes.txt **不一致**的观测（重要，单列）

**事实**：抓包 `net-canvas.json` / `net-node.json` 中实际发出 `GET /web/v1/df/canvas/canvas-scaffold`（transaction `request-560` / `request-1192`，HTTP **400**，响应体未捕获）。
该路径**既不在 routes.txt，也不在 bundle 请求配置**里。
→ 说明存在一个「画布脚手架」端点，其契约与语义**完全未知**；400 可能是缺必填参数（例如缺 canvas 上下文），不能据此判定其为废弃端点。
处置：列入 §6.3 待取证（G-01），本草案**不为其设计契约**。

---

## 2. 表设计草案（DDL）

### 2.0 遵循的现有约定（逐条给依据）

| 约定 | 依据 |
|---|---|
| PostgreSQL 16；主键统一雪花 `BIGINT`，应用层生成 | `docs/02-architecture/database.md:3` |
| 表/字段 snake_case 复数；内含 `created_at`/`updated_at` 默认省略书写 | `database.md:3-4` |
| 枚举用 `smallint` + 应用层常量（避免 PG enum 迁移痛） | `database.md:4` |
| JSONB 存半结构参数；读取侧 `jsonb_path_query`，禁止在 WHERE 对大 JSONB 做非索引过滤 | `database.md:491`（`params JSONB`）、`database.md:524` |
| 画布 4 表已有占位定义，本草案**基于其补齐** | `database.md:478-503` |
| `node_locks` **走 Redis（TTL 30s 心跳续期），不落库** | `database.md:498` |
| 画布节点类型 **11 种**，注释已列全 | `database.md:487-488` |
| 迁移执行顺序：`§7 canvas_*` 位于 `§3 tasks` 之后 | `database.md:13` |
| 迁移工具 drizzle-orm/drizzle-kit，迁移文件入 git，破坏性变更走双写/灰度 | `database.md:541-542` |

**一处刻意的约定偏离（须 Lead 确认）**：`canvas_nodes.node_type` 沿用 §7 的 `TEXT` 而非 `smallint`。
理由：① §7 已明确写死 `TEXT`（`database.md:487`）；② 该值是**对外契约值**，CLI 以位置参数直接传 11 个字符串（`cli-skill/reelmate-cli-skill/commands/node.md:45`），Web/CLI 均以字符串交互，转 smallint 会在边界反复映射且无收益。
**规则化表述**：*对外契约枚举用 TEXT（值集合固定、有外部文档）；纯内部状态用 smallint。* 同类判断亦适用于 `mode`（镜像模型目录 46 模型的字符串 key，见 `database.md:143-154`）与 `edge.semantic`。
内部状态（如任务状态、节点生成态）仍用 `smallint`，与 `tasks.status` 一致（`database.md:199-200`）。

### 2.1 空间隔离策略（为什么子表冗余 `space_id`）

顶层表 `canvases`/`agent_sessions` 持 `space_id`；其下所有子表**冗余一列 `space_id`**。理由：
1. 所有端点的权限前置校验都是「资源是否属当前 `X-Space-Id`」，`api-spec.md:25` 定义该头为多空间接口必填；若子表无 `space_id`，每次校验都要 JOIN 父表；
2. 冗余列可直接落复合索引与行级过滤，避免热路径 JOIN；
3. 写路径以 `(id, space_id)` 双条件更新，天然防跨空间越权写入（越权 → 影响 0 行 → 403101）。
父表 `space_id` 为权威源，子表值在**同一事务内**由服务端从父表回填，不接受客户端传入。

### 2.2 画布域 DDL（9 张）

#### 2.2.1 `canvases`（补齐 §7 占位）

§7 原占位仅有 `id/space_id/title/version`（`database.md:481-484`），缺口：无所有权、无软删、无剧集映射、无钉住节点、缺时间戳。

```sql
CREATE TABLE canvases (
  id              BIGINT PRIMARY KEY,
  space_id        BIGINT NOT NULL REFERENCES spaces(id),
  title           TEXT NOT NULL DEFAULT '未命名画布',   -- §7 默认值沿用
  version         INT NOT NULL DEFAULT 1,               -- §7；乐观锁版本，冲突→746002
  creation_mode   SMALLINT NOT NULL DEFAULT 2,          -- 1制片工坊 2无限画布
  episode_id      BIGINT REFERENCES episodes(id),       -- 可为 NULL；前向外键，迁移末尾 ALTER 补加
  owner_user_id   BIGINT NOT NULL REFERENCES users(id),
  pinned_node_id  BIGINT,                               -- 「钉住节点」单选，替代独立表（见 §2.4）
  last_edited_at  TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,                          -- 软删；删除画布≠删剧集（见 §6.3 G-04）
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_canvases_space ON canvases(space_id, updated_at DESC) WHERE deleted_at IS NULL;
```

依据：
- `creation_mode` 语义（1=制片工坊、2=无限画布）：`cli-skill/reelmate-cli-skill/commands/canvas.md:222`（事实：CLI 明写该枚举）。
- `episode_id`：CLI `canvas create` 返回 `canvas_id` **与 `episode_id`**（`canvas.md:48`）；`canvas delete` 语义是「删除画布对应的剧集容器」（`canvas.md:27`）。→ 画布与剧集存在映射，但映射方向/生命周期语义**未取证**（§6.3 G-04），故列可空且不加级联。
- `pinned_node_id`：`GET/PUT/DELETE /{canvas_id}/pinned-node`（`routes.txt:402`）为单值语义，无需独立表。

#### 2.2.2 `canvas_nodes`（补齐 §7 占位）

§7 原占位（`database.md:485-493`）已含 `node_type/name/x/y/width/height/params/task_id/version`。缺口：`space_id`、软删（`nodes-recover` 需要）、节点生成态、`group_ids`（固定组成员）、`z_index`。

```sql
CREATE TABLE canvas_nodes (
  id          BIGINT PRIMARY KEY,
  space_id    BIGINT NOT NULL REFERENCES spaces(id),
  canvas_id   BIGINT NOT NULL REFERENCES canvases(id),
  node_type   TEXT NOT NULL,          -- 11 种，见下方枚举注释（§7 原样）
  name        TEXT NOT NULL DEFAULT '',
  x           INT NOT NULL, y INT NOT NULL,
  width       INT, height INT,
  z_index     INT NOT NULL DEFAULT 0,
  params      JSONB NOT NULL DEFAULT '{}',   -- 类型专属参数，见 §2.5
  task_id     BIGINT REFERENCES tasks(id),   -- 复用现有 tasks，绝不另造任务表
  status      SMALLINT NOT NULL DEFAULT 1,   -- 1就绪 2生成中 3失败
  group_ids   BIGINT[] NOT NULL DEFAULT '{}',-- 固定组（pin-group）成员，见 §2.2.7
  version     INT NOT NULL DEFAULT 1,        -- 节点级乐观锁
  deleted_at  TIMESTAMPTZ,                   -- nodes-recover 依据（routes.txt:359）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- node_type 取值（RE 11 种，database.md:487-488 + node.md:45 完全一致）：
--   text|image|video|audio|table|script|asset|clip|director|threeDWorld|group
CREATE INDEX idx_canvas_nodes_canvas ON canvas_nodes(canvas_id, z_index) WHERE deleted_at IS NULL;
CREATE INDEX idx_canvas_nodes_task   ON canvas_nodes(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX idx_canvas_nodes_type   ON canvas_nodes(canvas_id, node_type) WHERE deleted_at IS NULL;
CREATE INDEX idx_canvas_nodes_space  ON canvas_nodes(space_id, updated_at DESC);
```

依据：
- 11 种类型：`database.md:487-488`（注释「勿只建 9 种」）与 `cli-skill/.../node.md:45` 逐字一致（事实）。
- `task_id` 复用：`database.md:492` 原占位即 `task_id BIGINT`；任务须来自 `tasks` 表（`database.md:184-212`）。
- `group_ids`：CLI 固定组逻辑明写「逐节点更新完整的 `group_ids`，在加入目标组的同时保留节点已有固定组」（`cli-skill/.../pin-group.md:23`，事实）。
- `status` 2=生成中：bundle 里创建节点时存在 `status:"ai_generating"` 与 `source:"agent"`（`capture-canvas.json` 内联 bundle，`adopt` 路径）。⚠️ 这是**前端节点态**，服务端是否需要持久化该态属推断（§6.3 G-05）。
- `deleted_at`：`POST /nodes-recover`（`routes.txt:359`）的存在证明删除是可逆的。

#### 2.2.3 `canvas_edges`（补齐 §7 占位）

§7 占位只有 `id/canvas_id/src_node_id/dst_node_id`（`database.md:494-497`）。缺口：`space_id`、`semantic`（连线语义）、唯一约束（幂等）。

```sql
CREATE TABLE canvas_edges (
  id          BIGINT PRIMARY KEY,
  space_id    BIGINT NOT NULL REFERENCES spaces(id),
  canvas_id   BIGINT NOT NULL REFERENCES canvases(id),
  src_node_id BIGINT NOT NULL REFERENCES canvas_nodes(id),
  dst_node_id BIGINT NOT NULL REFERENCES canvas_nodes(id),
  semantic    TEXT NOT NULL DEFAULT 'pipeline', -- pipeline|reference|sequence
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_canvas_edges UNIQUE (canvas_id, src_node_id, dst_node_id, semantic)
);
CREATE INDEX idx_canvas_edges_src ON canvas_edges(src_node_id);
CREATE INDEX idx_canvas_edges_dst ON canvas_edges(dst_node_id);
```

依据：
- `semantic` 三值：`cli-skill/.../node.md:366` — `--semantic pipeline|reference|sequence`，默认 `pipeline`（事实）。
- 唯一约束：CLI `--left/--right` 语义是「**确保**连线存在」（`node.md:358`），即重复调用须幂等 → 唯一索引兜底。这与 api-spec 的幂等双层语义同构（`api-spec.md:63-65`）。

#### 2.2.4 `canvas_snapshots`（补齐 §7 占位）

```sql
CREATE TABLE canvas_snapshots (
  id         BIGINT PRIMARY KEY,
  space_id   BIGINT NOT NULL REFERENCES spaces(id),
  canvas_id  BIGINT NOT NULL REFERENCES canvases(id),
  version    INT NOT NULL,
  kind       SMALLINT NOT NULL DEFAULT 1,   -- 1自动(每次提交) 2手动(显式快照)
  payload    JSONB NOT NULL,                -- 全画布快照：{nodes:[…],edges:[…],groups:[…]}
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_canvas_snapshots UNIQUE (canvas_id, version)
);
```

依据：`database.md:498-502` —「`canvas_snapshots` 存 JSONB 快照按版本」（事实）。`kind` 为推断扩展（§6.3 G-06）。

#### 2.2.5 `canvas_templates`（新增，覆盖 8 条模板端点）

```sql
CREATE TABLE canvas_templates (
  id          BIGINT PRIMARY KEY,
  space_id    BIGINT REFERENCES spaces(id),      -- 官方模板为 NULL（全局可见）
  tpl_scope   SMALLINT NOT NULL,                 -- 1官方 2团队 3个人
  tpl_type    SMALLINT NOT NULL DEFAULT 2,       -- 1新手引导 2官方画布模块 3从剧本到成片
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_uri   TEXT,
  payload     JSONB NOT NULL,                    -- 画布元素集合（结构待取证，§6.2 A-02）
  status      SMALLINT NOT NULL DEFAULT 1,       -- 1草稿 2已发布 3已下架
  sort        INT NOT NULL DEFAULT 100,
  created_by  BIGINT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_canvas_templates_list ON canvas_templates(tpl_scope, tpl_type, status, sort);
```

依据：
- `tpl_type` 三值与默认 2：`cli-skill/.../canvas.md:171` —「`tpl_type` 是必填参数，默认 `2`（官方画布模块）…`1` 取新手引导模板（Web 另有 `3` 表示「从剧本到成片」引导）」（事实）。
- 「整画布模板与 group template（节点组模板）是两回事，不要混用」：`canvas.md:150`（事实）→ 故 **不** 用同一张表承载 `groups/:group_id/templates`（403 行）。
- 端点：`routes.txt:323,324,375,376,392,393,394,395`。
- `payload` 结构**未取证**（`canvas.md:148,169,189,206` 均标 `[YApi] 待实测`）。

#### 2.2.6 `canvas_materials`（新增，覆盖 6 条素材端点）

```sql
CREATE TABLE canvas_materials (
  id            BIGINT PRIMARY KEY,
  space_id      BIGINT NOT NULL REFERENCES spaces(id),
  canvas_id     BIGINT NOT NULL REFERENCES canvases(id),
  material_type TEXT NOT NULL,            -- image|video|audio|file（推测同 node_type 子集）
  source        SMALLINT NOT NULL DEFAULT 1, -- 1上传 2节点产出 3资产库引用
  node_id       BIGINT REFERENCES canvas_nodes(id),
  name          TEXT NOT NULL DEFAULT '',
  object_key    TEXT,                     -- OSS object_key（files 域约定，api-spec.md:198）
  meta          JSONB NOT NULL DEFAULT '{}',
  deleted_at    TIMESTAMPTZ,              -- batch-delete 语义见 §6.3 G-07
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_canvas_materials ON canvas_materials(canvas_id, material_type, created_at DESC);
```

依据：`routes.txt:356`（查询参数 `material_type,source,node_id` 直接映射三列）、`:357`、`:377`（`upload-file`）。

#### 2.2.7 `canvas_pin_groups`（新增，覆盖 8 条固定组端点）

```sql
CREATE TABLE canvas_pin_groups (
  id         BIGINT PRIMARY KEY,
  space_id   BIGINT NOT NULL REFERENCES spaces(id),
  canvas_id  BIGINT NOT NULL REFERENCES canvases(id),
  name       TEXT,                       -- 预置组可为 NULL（未命名）
  color      TEXT,
  slot       SMALLINT NOT NULL,          -- 预置槽位 1..7
  node_ids   BIGINT[] NOT NULL DEFAULT '{}', -- 成员，整体替换语义
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_canvas_pin_groups UNIQUE (canvas_id, slot)
);
```

依据：
- **每画布 7 个预置颜色组**，`create` 复用同名组、否则占用未命名槽位，全命名后报错且不覆盖：`cli-skill/.../pin-group.md:3,43`（事实）→ `slot` + `UK(canvas_id,slot)` 直接建模该约束。
- 成员「整体替换」而非增量：`pin-group.md:23,66`（事实）→ `node_ids BIGINT[]` 而非 join 表，避免 2 张表。
- `canvas_nodes.group_ids` 为其反向冗余（同一事实两处存，须同事务双写；已在 §4.3 标注为一致性风险）。

#### 2.2.8 `canvas_comment_nodes` + 2.2.9 `canvas_comments`（新增，覆盖 5 条评论端点）

```sql
CREATE TABLE canvas_comment_nodes (
  id          BIGINT PRIMARY KEY,
  space_id    BIGINT NOT NULL REFERENCES spaces(id),
  canvas_id   BIGINT NOT NULL REFERENCES canvases(id),
  anchor_x    INT NOT NULL, anchor_y INT NOT NULL,   -- 画布坐标锚点
  node_id     BIGINT REFERENCES canvas_nodes(id),    -- 可空：画布空白处批注
  scope       TEXT NOT NULL DEFAULT 'canvas',        -- canvas|node（对应查询参数 scope）
  resolved    BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by BIGINT REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_by  BIGINT NOT NULL REFERENCES users(id),
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_canvas_comment_nodes ON canvas_comment_nodes(canvas_id, resolved, created_at DESC);

CREATE TABLE canvas_comments (
  id               BIGINT PRIMARY KEY,
  space_id         BIGINT NOT NULL REFERENCES spaces(id),
  comment_node_id  BIGINT NOT NULL REFERENCES canvas_comment_nodes(id),
  content          TEXT NOT NULL,
  mentions         BIGINT[] NOT NULL DEFAULT '{}',
  created_by       BIGINT NOT NULL REFERENCES users(id),
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_canvas_comments ON canvas_comments(comment_node_id, created_at);
```

依据：`routes.txt:343-347`；查询参数 `scope,resolved,order,page,page_size,uid`（bundle 请求配置）→ `scope`/`resolved`/`created_by` 三列。`anchor_x/anchor_y` 为推断（评论锚定画布坐标是 X6 图表批注的常规做法，**未取证**，§6.3 G-08）。

> **不复用 `content_reports`**：后者是公开内容举报（`database.md:255-268`），语义与协作评论无关。

### 2.3 agent 域 DDL（4 张）

#### 2.3.0 设计取舍：为什么 agent 会话与画布会话合表

`/web/v1/agent/task/*`（`routes.txt:127-134`）与 `/web/v1/df/canvas/:canvas_id/chat/sessions/*`（`routes.txt:331-341`）在语义上是**同一台对话引擎的两种作用域**：前者是独立的创作 Agent（可无画布），后者绑定某个画布。证据：CLI 把画布 Agent 直接实现为 session（`cli-skill/.../agent.md:8,20` — `agent session create NAME [--canvas CANVAS_ID]`，`--canvas` 可选），且画布内对话的流式端点与 agent 任务流式端点并存。
→ **合为一张 `agent_sessions`，用 `scope` 区分**，`canvas_id` 可空。理由：消息/事件/绑定三张子表可完全共享，避免两套并行实现；副作用是 agent 侧查询必须带 `scope` 过滤（已在索引体现）。

#### 2.3.1 `agent_sessions`

```sql
CREATE TABLE agent_sessions (
  id           BIGINT PRIMARY KEY,
  space_id     BIGINT NOT NULL REFERENCES spaces(id),
  scope        SMALLINT NOT NULL DEFAULT 1,   -- 1独立创作Agent 2画布内对话
  canvas_id    BIGINT REFERENCES canvases(id),-- scope=2 必填（应用层校验）
  title        TEXT NOT NULL DEFAULT '',
  status       SMALLINT NOT NULL DEFAULT 1,   -- 1活跃 2已结束 3已归档
  created_by   BIGINT NOT NULL REFERENCES users(id),
  last_active_at TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_sessions_space  ON agent_sessions(space_id, scope, last_active_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_agent_sessions_canvas ON agent_sessions(canvas_id, last_active_at DESC) WHERE canvas_id IS NOT NULL;
```

依据：`routes.txt:331-332`（画布会话 CRUD）、`agent.md:8-25`（session create/list/delete/enter/exit/run）。

#### 2.3.2 `agent_messages`

```sql
CREATE TABLE agent_messages (
  id           BIGINT PRIMARY KEY,
  space_id     BIGINT NOT NULL REFERENCES spaces(id),
  session_id   BIGINT NOT NULL REFERENCES agent_sessions(id),
  role         SMALLINT NOT NULL,        -- 1user 2assistant 3system
  content      TEXT NOT NULL DEFAULT '',
  content_type SMALLINT NOT NULL DEFAULT 1, -- 1text 2card 3plan 4hitl
  payload      JSONB NOT NULL DEFAULT '{}', -- 卡片/计划/HITL 结构
  task_id      BIGINT REFERENCES tasks(id), -- 消息触发的生成任务，复用 tasks
  seq          INT NOT NULL,                -- 会话内单调序号，供分页游标
  created_by   BIGINT REFERENCES users(id), -- assistant/system 为空
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_agent_messages_seq UNIQUE (session_id, seq)
);
CREATE INDEX idx_agent_messages_session ON agent_messages(session_id, seq);
```

依据：`routes.txt:333`（`GET …/messages`，查询参数 `after_event_id,page_size` → 游标式分页，非 page 分页）；`routes.txt:335`（`reaction`）；`db` 里 `tasks` 复用（`database.md:184`）。
> 注意：`after_event_id` 的命名指向**事件**而非消息，故游标字段落在 `agent_events`（§2.3.3）；`agent_messages.seq` 为展示序。

#### 2.3.3 `agent_events`（SSE 事件日志 —— 续传的唯一依据）

```sql
CREATE TABLE agent_events (
  id          BIGINT PRIMARY KEY,
  space_id    BIGINT NOT NULL REFERENCES spaces(id),
  session_id  BIGINT NOT NULL REFERENCES agent_sessions(id),
  stream_id   TEXT NOT NULL,          -- SSE 帧 id:，客户端回传 last_stream_id 的比对值
  seq         BIGINT NOT NULL,        -- 会话内单调递增，续传按 > seq 重放
  type        TEXT NOT NULL,          -- 事件名（取值集合 §4.4）
  payload     JSONB NOT NULL DEFAULT '{}',
  task_id     BIGINT REFERENCES tasks(id),
  expires_at  TIMESTAMPTZ NOT NULL,   -- 与 §10 数据生命周期对齐（见下）
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_agent_events_stream UNIQUE (session_id, stream_id)
);
CREATE INDEX idx_agent_events_replay ON agent_events(session_id, seq);
CREATE INDEX idx_agent_events_expire ON agent_events(expires_at);
```

依据（本文最关键的取证点）：
- 续传机制为客户端发送 `?last_stream_id=`：`capture-canvas.json` 内联 bundle `DBe()` 中
  `` `${…}/chat/sessions/${n}/stream`${l?`?last_stream_id=${encodeURIComponent(l)}`:""}` ``；
  且 bundle 请求配置显式声明 `queryNames:["last_stream_id"]`（`apiDfCanvasCanvasIdChatSessionsSessionIdStreamGetRequestConfig`）。
- 帧结构为 `{id, payload, type?}`：同函数 `d(k)` 解析 `JSON.parse(k)` 后取 `E.id`、`E.payload`，`payload.type` 或 `E.type` 兜底。
- → **没有事件落库就无法实现续传**；这是新增本表的硬理由。
- `expires_at`：需与 `docs/02-architecture/database.md:529-537`（§10 数据生命周期）对齐，建议 7 天（与分享 token 同级，`database.md:537`）。⚠️ 保留期属**本草案建议值**，非既有事实。

#### 2.3.4 `agent_message_bindings`（消息 ↔ 画布节点）

```sql
CREATE TABLE agent_message_bindings (
  id          BIGINT PRIMARY KEY,
  space_id    BIGINT NOT NULL REFERENCES spaces(id),
  message_id  BIGINT NOT NULL REFERENCES agent_messages(id),
  node_id     BIGINT NOT NULL REFERENCES canvas_nodes(id),
  binding_kind SMALLINT NOT NULL DEFAULT 1, -- 1产出 2引用 3修改
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_agent_msg_binding UNIQUE (message_id, node_id)
);
CREATE INDEX idx_agent_bindings_node ON agent_message_bindings(node_id);
```

依据：`routes.txt:334` — `POST …/messages/:message_id/node-binding`（专用绑定端点，非消息体内联）。
> 为何不把 `node_ids BIGINT[]` 放 `agent_messages`：绑定需要区分 `binding_kind` 且要能按 `node_id` 反查「该节点由哪条消息产出」；数组列无法高效反向索引。

### 2.4 明确**不建**的表（并说明替代）

| 候选表 | 处置 | 理由 |
|---|---|---|
| `node_locks` | **不建** | `database.md:498` 明确「走 Redis(TTL 30s 心跳续期)，不落库」。详见 §4.1 |
| `pinned_timelines` | 暂不建 | `routes.txt:373-374` 为画布级时间线钉住；结构未取证（§6.3 G-09）。当前用 `canvases` 侧扩展列或 JSONB 承载，方案待取证后定 |
| `canvas_groups` | 暂不建 | `group` 已是 `node_type` 之一（`database.md:488`、`node.md:88`），`/groups`（`routes.txt:387`）可能是 group 节点的别名端点，而非独立实体（§6.3 G-03） |
| `canvas_agent_skills` + favorites | 暂不建 | `routes.txt:378-385` 8 条属技能市场（广场/我的/收藏），是内容运营域，建议归 `ops`/独立 Phase。列 §6.3 G-10 |
| `group_templates`（节点组模板） | 暂不建 | `routes.txt:353-354`；与整画布模板不同（`canvas.md:150`），本草案不混用；结构待取证 |
| `agent_tasks` | **禁止** | 生成任务一律 `tasks`（`database.md:181-212`、`api-spec.md:172-192`）。Agent 的「任务」= `tasks` 行 + `agent_events.task_id` 关联 |
| `canvas_node_tasks` | **禁止** | 节点与任务为 1:1（`canvas_nodes.task_id`，`database.md:492`）；批量投递（`routes.txt:330`）产生 N 个 `tasks` 行，由 `tasks.shot_id`/`dedupe_key` 承担去重（`database.md:208-214`） |

### 2.5 `canvas_nodes.params` 结构（11 种类型）

`params` 是 JSONB 半结构；以下为各类型的键（**事实来源**：`cli-skill/reelmate-cli-skill/commands/node.md:76-88` 的表格，与 `REELMATE-逆向分析报告.md:297-301` 一致）。仅列出**列外**字段；`x/y/width/height/name` 已上提为列。

| # | `node_type` | `params` 键 | 依据 |
|---:|---|---|---|
| 1 | `text` | `prompt, model, count, richText{format: plain\|markdown}, referenceAssets[], upstreamRefs[]` | `node.md:78` |
| 2 | `image` | `mode`(16 值), `prompt, model, count, settings{ratio,quality,imageQuality,width,height}, creativeSetting, editConfig, referenceAssets[], upstreamRefs[]` | `node.md:79`、`RE:298` |
| 3 | `video` | `mode`(13 值), `prompt, model, count, settings{ratio,resolution,duration,enableSound,mouthDrive,shotType,offPeak,fps}, editConfig, referenceAssets[], upstreamRefs[]` | `node.md:80`、`RE:299-300` |
| 4 | `audio` | `audioKind(voiceover\|music\|sfx\|ambient), prompt, model, duration, count, voice{voiceId,voiceName,coverUrl,gender,language,tone,speed,pitch,volume,loop}, previewPlaybackRate` | `node.md:81,90-97`、`RE:301` |
| 5 | `table` | `table{active_sheet_id, sheet_selection_required, source{type: manual\|excel_import\|project_episode_import}, sheets[]}` | `node.md:82` |
| 6 | `script` | `runPhase(storyboard\|asset_match), prompt, sourceText, model, shotCount, columns, spawnConfig, upstreamRefs[]` | `node.md:83`、`RE:301` |
| 7 | `asset` | `sourceText, model, extractCredits, activeTab(character\|scene\|prop), spawnConfig, upstreamRefs[]` | `node.md:84`、`RE:301` |
| 8 | `clip` | `shotOrder[]`(节点 ID 数组), `exportSettings{exportTarget: canvas\|local, resolution: 480p\|720p\|1080p, format: mp4\|webm}, timeline, previewPlaybackRate` | `node.md:85`、`RE:301` |
| 9 | `director` | 无专属业务参数；仅通用参考字段 `isReference, referenceRole, referenceLabel` | `node.md:86` |
| 10 | `threeDWorld` | 复用 image 结构 + `worldInputIsPano: boolean` | `node.md:87` |
| 11 | `group` | `title, color, childNodeIds[], width, height, collapsed, locked, serverGroupId` | `node.md:88` |

**`mode` 与现有 `tasks.mode` 的关系（关键复用点）**：
canvas 节点的 `image.mode`/`video.mode` 取值**必须收敛到 `tasks.mode` 的既有枚举**，不得新增 mode。映射见 §3.4。
依据：`api-spec.md:169` 已枚举 video/image 的 mode 全集，并明确「upscale/outpaint/inpaint/erase 为 MVP 额外后处理子集（**RE 以 canvas mode 提供**）」——这句话正是为本草案准备的桥。

---

## 3. 端点契约草案

### 3.0 通用约定（全部沿用，不另立）

| 项 | 约定 | 依据 |
|---|---|---|
| 信封 | `{code,msg,data}`；成功 `code=0` | `api-spec.md:13-18` |
| 鉴权头 | `Authorization: Bearer <access_jwt>`（登录接口外全必填） | `api-spec.md:24` |
| 空间头 | `X-Space-Id` 必填；缺省个人空间 | `api-spec.md:25` |
| CSRF | `X-Requested-With: XMLHttpRequest`（全部非 GET 必填） | `api-spec.md:29` |
| 幂等头 | `Idempotency-Key: UUIDv4`；5min 内重放返回原结果 | `api-spec.md:27` |
| 分页 | `?page=&page_size=` → `data:{list,total,page,page_size}` | `api-spec.md:67` |
| 时间/ID | ISO8601 UTC；**ID 一律字符串化雪花** | `api-spec.md:68` |
| 版本冲突 | 746002（画布版本）/ 746003（节点被锁） | `api-spec.md:57-58` |
| 重放 | 746001 | `api-spec.md:56` |

**权限记号**（本节表格「权限」列）：`U`=登录 · `S`=空间隔离（`space_id` 校验，越权 403101） · `W`=画布写权（需持节点锁，见 §4.1） · `P`=公开（免登录，凭不可猜 token，参照 `task_shares` 语义 `database.md:245-252`）。

**幂等记号**：`I`=必须带 `Idempotency-Key`（创建/产生副作用） · `N`=天然幂等（GET/PUT/DELETE 语义，或唯一索引兜底） · `—`=无需。

**限流记号**：数值均为**本草案建议值**，须并入 `api-spec.md:625-637` §13 表；基线为「其余 GET 120/分、IP 600/分」（`api-spec.md:637`）。

### 3.1 canvas 画布根与模板（C1/C2）

| 方法 | 路径（前缀 `/v1/canvas`） | 权限 | 请求 | 响应 | codes | 幂等 | 限流 |
|---|---|---|---|---|---|---|---|
| POST | `/canvases` | U,S | `{title?, creation_mode?(1\|2), episode_id?}` | `{canvas:{canvas_id,title,version,creation_mode,episode_id}, episode_id?}` | 0/400100/400101/401101/403101 | I | 30/分 |
| GET | `/canvases/:id` | U,S | — （可选 `?with=nodes,edges,groups`） | `{canvas, nodes[], edges[], pin_groups[], version, locked_nodes[]}` | 0/400102/401101/403101 | N | 240/分 |
| PUT | `/canvases/:id` | U,S,W | `{title?, version_expected}` | `{canvas}` | 0/400102/**746002**/401101/403101 | N | 120/分 |
| GET | `/canvas-tpls` | U,S | `?tpl_type=1\|2\|3&page=&page_size=` | `{list,total,page,page_size}` | 0/400101/401101 | N | 120/分 |
| GET | `/canvas-tpls/:template_id` | U,S | — | `{template}` | 0/400102/401101 | N | 120/分 |
| POST | `/canvases/:id/tpls` | U,S,W | `{name, tpl_scope:2\|3, description?, cover_uri?}` | `{template_id}` | 0/400100/400102/401101/403101 | I | 5/分 |
| POST | `/canvases/:id/tpls/:template_id/elements/batch-create` | U,S,W | `{node_ids?:[], mode?:"merge"}` | `{created:number, items:[{node_id}], version}` | 0/400101/400102/**746002**/401101/403101 | I | 10/分 |
| GET | `/canvas-templates/:template_id` | U,S | — | `{template}` | 0/400102/401101 | N | 120/分 |
| POST | `/canvas-templates/:template_id/sync-team` | U,S | `{team_space_id}` | `{template_id}` | 0/400102/401101/403101 | I | 5/分 |
| GET | `/canvas-templates/personal` | U,S | `?query=&page=&page_size=` | `{list,total,page,page_size}` | 0/401101 | N | 120/分 |
| DELETE | `/canvas-templates/personal/:template_id` | U,S | — | `{ok:true}` | 0/400102/401101/403101 | N | 30/分 |

> 路径归一说明：RE 把模板分成三组前缀（`canvas-tpls`、`canvas/:id/tpls`、`canvas/templates/*`）。合并时建议**统一到 `/canvas-templates`** 一个名词，理由：`api-spec.md` 现有风格是资源复数名词（`/projects`、`/assets`、`/task-templates` 风格一致性），且 `canvas-tpls` 与 `templates` 指同一实体会造成两套权限中间件。**此归一为建议，需 Lead 裁决**（是否保留 RE 原形以利对齐测试）。

### 3.2 canvas 节点 / 连线 / 批量（C3/C4）

| 方法 | 路径 | 权限 | 请求 | 响应 | codes | 幂等 | 限流 |
|---|---|---|---|---|---|---|---|
| POST | `/canvases/:id/nodes` | U,S,W | `{node_type, name?, position{x,y}, width?, height?, params?}` | `{node_id, node:{…}, version}` | 0/400100/**400101**(node_type/mode 越界，附 field)/400102/**746002**/**746003**/401101/403101 | I | 120/分 |
| POST | `/nodes` (batch) | U,S,W | `{canvas_id, nodes:[{node_type,node_name?,position?,params?}]}` **≤100** | `{created, items:[{node_id}], version}` | 同上 + 745703 式部分成功 | I | 10/分 |
| GET | `/canvases/:id/nodes/:node_id` | U,S | — | `{node, lock?}` | 0/400102/401101 | N | 240/分 |
| PUT | `/canvases/:id/nodes/:node_id` | U,S,W | `{name?, position?, width?, height?, params?, version_expected}` | `{node, version}` | 0/400100/400102/**746002**/**746003**/401101/403101 | N | 120/分 |
| DELETE | `/canvases/:id/nodes/:node_id` | U,S,W | `{version_expected?}` | `{ok:true}` | 0/400102/**746002**/**746003**/401101/403101 | N | 120/分 |
| POST | `/canvases/:id/nodes/batch-edit` | U,S,W | `{edits:[{node_id, patch, version_expected}]}` | `{updated, items[]}` | 0/400102/**746002**/**746003** | I | 30/分 |
| POST | `/canvases/:id/nodes/batch-delete` | U,S,W | `{node_ids:[]}` | `{deleted, skipped[]}` | 同上 | I | 30/分 |
| POST | `/canvases/:id/nodes/recover` | U,S,W | `{node_ids:[]}` | `{recovered, skipped[]}` | 0/400102/401101 | I | 30/分 |
| GET | `/canvases/:id/nodes-asset?node_type=` | U,S | `?node_type=image\|video\|audio` | `{list:[{node_id,name,asset_uri}]}` | 0/400101/400102 | N | 120/分 |
| POST | `/canvases/:id/edges` | U,S,W | `{src_node_id, dst_node_id, semantic?}` | `{edge_id}` | 0/400100/400102/**746003**/**746002** | **N**(唯一约束兜底，重复→返回既有 edge) | 240/分 |
| POST | `/canvases/:id/edges/batch` | U,S,W | `{edges:[{src,dst,semantic?}]}` | `{created, items[]}` | 同上 | N | 60/分 |
| DELETE | `/canvases/:id/edges/:edge_id` | U,S,W | — | `{ok:true}` | 0/400102/401101 | N | 240/分 |
| POST | `/canvases/:id/edges/batch-delete` | U,S,W | `{edge_ids:[]}` | `{deleted}` | 同上 | N | 60/分 |

**「确保存在」语义（重要）**：`POST /edges` 当边已存在时**返回 200 + 既有 edge**，不报错。
依据：CLI 语义为「`--left`/`--right` 是**确保**连线存在，`--left-add`/`--left-rm` 才是增量增加或删除入边」（`cli-skill/.../node.md:358`）。这与 `api-spec.md:64` 的「同键重放返回原响应」精神一致。

### 3.3 canvas 会话 / 锁 / 心跳（C5/C7）

| 方法 | 路径 | 权限 | 请求 | 响应 | codes | 幂等 | 限流 |
|---|---|---|---|---|---|---|---|
| POST | `/canvases/:id/heartbeat` | U,S | `{client_id, editing_node_id?}` | `{server_time, held_locks:[{node_id,expires_at}], edit_arbitration}` | 0/400102/401101 | N | **30/分**（TTL 30s，客户端 10~15s 一次） |
| GET | `/canvases/:id/nodes/:node_id/lock` | U,S | `?project_id=` | `{locked, owner_user_id?, expires_at?}` | 0/400102/401101 | N | 240/分 |
| POST | `/canvases/:id/nodes/:node_id/lock` | U,S | `{ttl_s?=30}` | `{node_id, expires_at, token}` | 0/400102/**746003**(他端持有)/401101/403101 | I | 120/分 |
| POST | `/canvases/:id/nodes/:node_id/renew` | U,S | `{token}` | `{expires_at}` | 0/400102/**746003**(token 失效)/401101 | N | 60/分 |
| POST | `/canvases/:id/nodes/:node_id/unlock` | U,S | `{token}` | `{ok:true}` | 0/400102/401101 | N | 120/分 |
| GET | `/canvases/:id/chat/sessions` | U,S | `?page=&page_size=` | `{list,total,page,page_size}` | 0/400102/401101 | N | 120/分 |
| POST | `/canvases/:id/chat/sessions` | U,S | `{title?}` | `{session:{session_id,title,status}}` | 0/400100/400102/401101 | I | 10/分 |
| PATCH | `/canvases/:id/chat/sessions/:session_id` | U,S | `{title?, status?}` | `{session}` | 0/400102/401101/403101 | N | 60/分 |
| DELETE | `/canvases/:id/chat/sessions/:session_id` | U,S | — | `{ok:true}` | 0/400102/401101/403101 | N | 30/分 |
| GET | `/canvases/:id/chat/sessions/:session_id/messages` | U,S | `?after_event_id=&page_size=` | `{list, next_event_id, has_more}` | 0/400102/401101 | N | 240/分 |
| POST | `/canvases/:id/chat/sessions/:session_id/messages` | U,S | `{content, content_type?, reference_node_ids?[], decision?{interrupt_id,decision:approve\|reject,edits?}}` | `{message_id, stream_id, task_id?}` | 0/400100/400102/**745701**/**745703**/**745801**/401101/403101 | I | **10/分** |
| POST | `/chat/sessions/:session_id/read` | U,S | `{last_read_seq}` | `{unread_count}` | 0/400102/401101 | N | 240/分 |
| GET | `/chat/sessions/:session_id/stream` | U,S | `?last_stream_id=` | **`text/event-stream`**（协议 §4.4） | 0/400102/**746004**/401101 | N | 连接 10/分 |
| GET | `/canvases/:id/chat/writing-outputs` | U,S | `?page=&page_size=` | `{list,total,page,page_size}` | 0/400102/401101 | N | 120/分 |
| POST | `/chat/sessions/:session_id/messages/:message_id/reaction` | U,S | `{reaction: like\|dislike\|none}` | `{ok:true}` | 0/400102/401101 | N | 60/分 |
| POST | `/chat/sessions/:session_id/messages/:message_id/node-binding` | U,S | `{node_ids:[], binding_kind?}` | `{bound}` | 0/400102/401101 | I | 30/分 |

### 3.4 canvas 节点派生任务（C6）—— **一律复用 `tasks`**

这是「必须复用现有体系」的核心落点。约定：

**① 所有生成类端点只做「创建 `tasks` 行 + 回写 `canvas_nodes.task_id`」，不新建任何任务表。**
**② 请求体形态统一为 `generations` 的子集**，遵循 `api-spec.md:147-162` 的 `{mode, model, scene, input, options, quote_id}` 结构；canvas 只是把「节点参数」映射成该结构。
**③ 冻结结算完全沿用 tasks 既有语义**：`credits_frozen`/`credits_settled`/`dedupe_key`（`database.md:205-209`），预算/余额错误码沿用 745701/745702/745703。

| 方法 | 路径 | 权限 | 请求 | 响应 | codes | 幂等 | 限流 |
|---|---|---|---|---|---|---|---|
| POST | `/canvases/:id/nodes/:node_id/generate` | U,S,W | `{mode, model, scene?, input, options, quote_id?, write_back?:true}` | `{task_id, status:1, credits_estimate, node:{…}}` | 0/400101/**400105**/**745701**/**745702**/**745703**/**745801**/429101/401101/403101 | I | **10/分**（对齐 `api-spec.md:630` generations 10/分） |
| POST | `/canvases/:id/batch-node-tasks` | U,S,W | `{items:[{node_id, mode, model, scene?, input, options}], quote_id?}` ≤50 | `{submitted, results:[{node_id,task_id?,submitted,codes?}], total_credits}` | 0/**400107**/400101/**745701**/745703 逐项 | I | **3/分**（对齐 `api-spec.md:632` 批量投递 3/分） |
| POST | `/canvases/:id/nodes/:node_id/script-optimization` | U,S,W | `{prompt, source_text≤50000, model, node_id}` | `{task_id, node_id}` | 0/**400104**/**745701**/400101 | I | 6/分（LLM 步骤，对齐 `api-spec.md:631`） |
| POST | `/canvases/:id/nodes/:node_id/storyboard-parse` | U,S,W | `{source_text≤50000, model, shot_count?:4..30}` | `{task_id, node_id}` | 0/**400104**/400101/**745701** | I | 6/分 |
| POST | `/canvases/:id/nodes/:node_id/asset-extraction` | U,S,W | `{source_text≤50000, model, active_tab}` | `{task_id, node_id}` | 0/**400104**/400101/745701 | I | 6/分 |
| POST | `/canvases/:id/nodes/:node_id/storyboard-asset-match` | U,S,W | `{storyboard_node_id, scene_node_ids?[], character_node_ids?[]}` | `{task_id}` | 0/**400105**/**745701**/400101 | I | 6/分 |
| POST | `…/storyboard-asset-match/cancel` | U,S,W | `{task_id}` | `{ok:true}` | 0/**400103**/400102 | N | 30/分 |
| POST | `…/storyboard-asset-rematch` | U,S,W | `{task_id?}` | `{task_id}` | 0/400105/745701 | I | 6/分 |
| POST | `/canvases/:id/nodes/:node_id/video-parse` | U,S,W | `{object_key, mode}` | `{task_id}` | 0/400101/400102/745701 | I | 10/分 |
| GET | `…/video-parse/:task_id` | U,S | — | `{task:{task_id,status,progress,results?,error?}}` | 0/400102/401101 | N | 240/分 |
| POST | `/canvases/:id/clip` | U,S,W | `{clip_node_id, export_settings{exportTarget,resolution,format}}` | `{task_id, node_id}` | 0/400101/**400106**（成功镜<80%）/745701 | I | 3/分 |
| POST | `/canvases/:id/crop` | U,S,W | `{node_id, crop:{x,y,w,h}}` | `{task_id}` | 0/400101/400102 | I | 30/分 |

**canvas `mode` → `tasks.mode` 收敛映射（不得新增 mode）**：

| canvas 节点 mode（`node.md:79-80`） | 现有 `tasks.mode` | 依据 |
|---|---|---|
| `text2image` | `text2image` | `api-spec.md:169` |
| `image2image` | `image2image` | 同上 |
| `multi_reference` | `multi_reference` | 同上 |
| `upscale` | `upscale` | 同上（原文明示「RE 以 canvas mode 提供」） |
| `outpaint`/`inpaint`/`erase` | `outpaint`/`inpaint`/`erase` | 同上 |
| `crop` | `crop` ❗**现有枚举缺** | 见 §6.4「待新增值（非错误码）」 |
| `panorama`/`multi_angle_360`/`panorama_360`/`lighting`/`multi_camera_grid_9`/`story_grid_4\|9\|25` | ❗**现有枚举缺** | Ph3 后处理能力；建议先按 `text2image` + `options.sub_mode` 承载，或扩 mode 枚举（需 Lead 裁决） |
| `text2video` | `text2video` | `api-spec.md:169` |
| `image2video` | `image2video` | 同上 |
| `first_frame` | `first_frame` | 同上 |
| `first_last_frame` | `first_last_frame` | 同上 |
| `universal_reference` | `universal_reference` | 同上 |
| `video_extend` | `video_extend` | 同上 |
| `video_clip` / `video_edit` | `video_edit`（推测同一能力） | ⚠️ 推断，§6.3 G-11 |
| `video_reference` | `universal_reference`（推测） | ⚠️ 推断，§6.3 G-11 |
| `video_upscale` | ❗现有枚举明确不在 MVP（`api-spec.md:169`「video_upscale 等走独立能力（Ph2）」） | Ph2 |
| `de_subtitle_auto`/`de_subtitle_region`/`frame_capture` | ❗现有枚举缺 | 建议 `video_edit` + `options.op`，或扩枚举 |

**`scene` 的用法**：canvas 节点任务**不带** `scene`（`scene` 专用于流水线：`script_to_scene_refer`/`storyboard_reference_video`，见 `api-spec.md:170`）；唯 `asset-extraction` 节点若复用资产生图能力，用 `mode=studio_asset_image`（`api-spec.md:170`）。

### 3.5 canvas 杂项（C8/C9/C10/C11/C12/C13）

| 方法 | 路径 | 权限 | 请求 | 响应 | codes | 幂等 | 限流 |
|---|---|---|---|---|---|---|---|
| GET | `/canvases/:id/materials` | U,S | `?page=&page_size=&material_type=&source=&node_id=` | `{list,total,page,page_size}` | 0/400102/401101 | N | 120/分 |
| POST | `/canvases/:id/materials` | U,S,W | `{object_key, material_type, name?, node_id?}` | `{material_id}` | 0/400100/400102/401101 | I | 60/分 |
| POST | `/canvases/:id/materials/batch-delete` | U,S,W | `{material_ids:[]}` | `{deleted}` | 0/400102/401101 | N | 30/分 |
| POST | `/canvases/:id/upload-file` | U,S,W | `{object_key}` 或 multipart | `{file_id, uri}` | 0/400100/400101/401101 | I | 60/分 |
| GET | `/canvases/:id/comment-nodes` | U,S | `?scope=&resolved=&order=&page=&page_size=&uid=` | `{list,total,page,page_size}` | 0/400102/401101 | N | 120/分 |
| POST | `/canvases/:id/comment-nodes` | U,S | `{anchor{x,y}, node_id?, scope?, content}` | `{comment_node_id}` | 0/400100/400102/401101 | I | 60/分 |
| GET/PUT/DELETE | `/canvases/:id/comment-nodes/:cn_id` | U,S | `{anchor?, content?}` | `{comment_node}` / `{ok:true}` | 0/400102/401101/403101 | N | 60/分 |
| POST | `/comment-nodes/:cn_id/comments` | U,S | `{content, mentions?[]}` | `{comment_id}` | 0/400100/400102/401101 | I | 60/分 |
| PUT/DELETE | `/comment-nodes/:cn_id/comments/:comment_id` | U,S | `{content}` | `{comment}` / `{ok:true}` | 0/400102/401101/403101 | N | 60/分 |
| POST | `/comment-nodes/:cn_id/resolve` | U,S | `{resolved:bool}` | `{comment_node}` | 0/400102/401101 | N | 60/分 |
| POST | `/canvases/groups` | U,S,W | `{canvas_id, group_node_ids:[], params?}` | `{group_id}` | 0/400101/400102 | I | 30/分 |
| DELETE | `/canvases/:id/groups/:group_id` | U,S,W | — | `{ok:true}` | 0/400102/401101 | N | 30/分 |
| POST | `/canvases/:id/group-recover` | U,S,W | `{group_ids:[]}` | `{recovered}` | 0/400102/401101 | I | 30/分 |
| GET/POST | `/canvases/:id/groups/:group_id/templates` | U,S,W | `{name, payload}` | `{list}` / `{template_id}` | 0/400101/400102 | I | 30/分 |
| PUT | `…/groups/:group_id/templates/:template_id` | U,S,W | `{name?, payload?}` | `{template}` | 0/400102/401101/403101 | N | 30/分 |
| GET | `/canvases/:id/pin-groups` | U,S | — | `{list:[{group_id,name,color,slot,node_ids[]}]}` | 0/400102/401101 | N | 120/分 |
| PUT | `/canvases/:id/pin-groups/:group_id` | U,S | `{name?, color?, node_ids:[]}` | `{pin_group, replaced:true}` | 0/400102/401101 | **N**(整体替换) | 60/分 |
| DELETE | `/canvases/:id/pin-groups/:group_id/members` | U,S | `{node_ids:[]}` | `{group_id, cleared}` | 0/400102/401101 | N | 60/分 |
| PUT | `/canvases/:id/nodes/:node_id/pin-groups` | U,S | `{group_ids:[]}` | `{node_id, group_ids}` | 0/400102/401101 | N | 60/分 |
| GET/PUT/DELETE | `/canvases/:id/pinned-node` | U,S | `{node_id}` | `{pinned_node_id}` / `{ok:true}` | 0/400102/401101 | N | 120/分 |
| GET/POST/DELETE | `/canvases/:id/pinned-timelines` | U,S | `{node_ids:[]}` | `{list}` / `{ok:true}` | 0/400102/401101 | I | 60/分 |
| DELETE | `/canvases/:id/pinned-timelines/:node_id` | U,S | — | `{ok:true}` | 0/400102/401101 | N | 60/分 |
| POST | `/canvases/node/batch-download` | U,S | `{node_ids:[]}` ≤50 | `{download_list_id}` | 0/400100/400101 | I | 5/分 |
| GET | `/canvases/node/batch-download/list` | U,S | `?page=&page_size=&canvas_id=` | `{list,total,page,page_size}` | 0/400102/401101 | N | 120/分 |
| POST | `/canvases/node/batch-download/url` | U,S | `{download_list_id}` | `{url(预签名24h), filename}` | 0/400102/401101 | N | 60/分 |
| POST | `/nodes/:node_id/table/import` | U,S,W | `{file_id}` | `{sheets:[{sheet_id,name}], raw}` | 0/400100/400101/400102 | I | 10/分 |
| POST | `/nodes/:node_id/table/confirm-sheet` | U,S,W | `{sheet_id}`（必填，不自动选第一个） | `{node, sheet}` | 0/400100/400102 | I | 10/分 |

**表格节点两步式（事实）**：`import` 后先返回 Sheet 列表，再 `confirm-sheet` 显式指定 `sheet_id`，「不会自动选第一个 Sheet」。依据：`cli-skill/.../node.md:392`。

**固定组 7 槽位约束（事实）**：每画布仅 7 个预置颜色组；无同名组且全部已命名 → 报错而非覆盖。依据：`pin-group.md:3,65`。→ 该场景用 **400101**（参数越界/资源不可用）承载，不新增码。

**批量下载上限**：`≤50` 项，对齐 `api-spec.md:184`（`POST /tasks/batch-download {task_ids:[]} // ≤50项`）。

### 3.6 agent 域端点

| 方法 | 路径（前缀 `/v1/agent`） | 权限 | 请求 | 响应 | codes | 幂等 | 限流 |
|---|---|---|---|---|---|---|---|
| GET | `/home/resource/info` | U,S | `?id=` | `{id, title, blocks[]}` | 0/400102/401101 | N | 120/分 |
| GET | `/home/resource/recommend` | U,S | — | `{list:[{recommend_id,title,description,preset_prompt,skills[]}]}` | 0/401101 | N | 120/分 |
| GET | `/home/resource/sse` | U,S | `?id=` | **`text/event-stream`**（§4.4 同一协议） | 0/400102/**746004**/401101 | N | 连接 10/分 |
| GET | `/stt-token` | U,S | — | `{provider, token, expires_at}` | 0/401101/745900 | N | 30/分 |
| POST | `/task/create-check` | U,S | `{mode, model, scene?, input, options}` | `{ok, credits_estimate, blockers?:[{code,field,msg}]}` | 0/400101/**745701**/**745703**/**745801** | **N**（只校验不落库、不冻结） | 20/分 |
| POST | `/task/create` | U,S | 同 `generations`（`api-spec.md:147-162`）+ `{session_id?}` | `{task_id, status:1, credits_estimate, session_id?}` | 0/400100/400101/**400105**/**745701**/**745702**/**745703**/**745801**/429101/401101 | I | 10/分 |
| GET | `/task/{task_id}` | U,S | — | `{task:{task_id,status,progress,results?,error?}}` | 0/400102/401101 | N | 240/分 |
| PUT | `/task/{task_id}` | U,S | `{title?}` 或 `{feedback:{reaction,comment?}}` | `{task}` | 0/400102/400103/401101/403101 | N | 60/分 |
| POST | `/task/chat` | U,S | `{session_id, content, content_type?, attachments?[]}` | `{message_id, stream_id, task_id?}` | 0/400100/400102/**745701**/**745801**/401101 | I | 10/分 |
| POST | `/task/chat-end` | U,S | `{session_id}` | `{ok:true, session:{status:2}}` | 0/400102/401101/403101 | N | 30/分 |
| GET | `/task/stream`⚠️ | U,S | `?task_id=` + raw body | **`text/event-stream`** | 0/400102/**746004**/401101 | N | 连接 10/分 |
| GET | `/task/share/{share_id}/sse` | **P** | — | **`text/event-stream`** | 0/400102/401101 | N | 连接 30/分（按 IP 计） |
| POST | `/task/batch-download` | U,S | `{task_ids:[]}` ≤50 | `{download_url}` | 0/400100/400101 | I | 5/分 |

**注意 `GET /task/stream` 的怪异性**：bundle 声明为 `method:Method.POST, requestBodyType:raw, queryNames:["task_id"]`（`apiAgentTaskStreamPostRequestConfig`），即 **POST + raw body + query 带 task_id**，但返回 SSE。本草案建议**统一改为 `GET ?task_id=`**（SSE 应是 GET，且 GET 更利于浏览器断线重连与 `Last-Event-ID` 语义）；`raw` body 的内容**未取证**（§6.3 G-12）。
> 若需保留 POST-SSE 以对齐 RE 抓包，则须在 api-spec 显式记录例外，并说明 `EventSource`/`fetch` 两种客户端的差异。

---

## 4. 协作与并发设计

### 4.1 节点锁：Redis，不落库（含 TTL 与心跳）

**决策**：`node_locks` **绝不建表**，一律 Redis。依据：`docs/02-architecture/database.md:498` 原文「`node_locks` 走 Redis(TTL 30s 心跳续期)，不落库」。

| 项 | 值 | 说明 |
|---|---|---|
| Key | `canvas:lock:{canvas_id}:{node_id}` | 带 canvas 前缀便于按画布批量清理 |
| Value | `{user_id, client_id, token, acquired_at}` | `token` 为解锁/续期的凭据（防误释放他人锁） |
| TTL | **30s** | 对齐 RE 心跳锁语义（`REELMATE-逆向分析报告.md:302`「心跳锁 API（`nodes/:id/lock\|unlock\|heartbeat`）」+ `database.md:498`） |
| 续期 | `POST …/renew` 或 `POST /canvases/:id/heartbeat` | 客户端 10~15s 一次（TTL 的 1/3~1/2），限流 30/分 |
| 获取失败 | **746003 NODE_LOCKED** | `api-spec.md:58`（既有码，现即定义为「Ph3 画布节点被他端锁定」） |
| 释放 | `unlock` + `pagehide`/断连兜底 | 异常断连由 TTL 自然过期，**不依赖客户端 unlock** |
| 读锁 | 不加锁 | 只读端点不校验锁；`GET …/lock` 仅查询状态 |

**为什么 Redis 而非表（3 条硬理由，写入文档以绝后患）**：
1. 已有明文约定（`database.md:498`）；
2. 锁是**高频、短命、强时效**数据（30s TTL），落库会产生巨量 UPDATE 与清理扫描，污染 `tasks` 同级热路径（`database.md:521` 明确「轮询热路径只碰 idx_tasks_polling」，说明该库对热路径极敏感）；
3. 锁的正确性依赖「过期即失效」，Redis TTL 原生提供；PG 需定时任务扫描，故障时留下永久僵尸锁。

**代价（须在 ADR 记录）**：Redis 不可用 → 画布降级为「无锁只读」，写操作返回 745900 VENDOR_ERROR？**不行**——这是内部依赖，不是供应商。处置：返回 500000 INTERNAL（`api-spec.md:59`），并在前端提示「协作功能暂不可用，已切换只读」。**不新增码**。

### 4.2 版本冲突：复用 746002

| 层级 | 版本字段 | 冲突行为 | 依据 |
|---|---|---|---|
| 画布级 | `canvases.version` | 写操作带 `version_expected`，不符 → **746002** | `api-spec.md:57`（既有码，注释即「Ph3 画布」）；`database.md:483` |
| 节点级 | `canvas_nodes.version` | `PUT /nodes/:id` 带 `version_expected`，不符 → **746002** | `database.md:492` |
| 快照 | `canvas_snapshots.version` | `UK(canvas_id,version)` 兜底 | 本草案 §2.2.4 |

**语义边界（必须写清，否则实现会打架）**：
- **746002 = 版本号不匹配**（乐观锁失败，客户端应 `GET` 最新后重组）。
- **746003 = 节点被他人持有锁**（协作互斥，客户端应等待释放或改操作其它节点）。
- 两者可同时发生：先检查锁（746003）再检查版本（746002）？**顺序建议：锁优先**。理由：锁冲突是暂时的、可重试的；版本冲突需要客户端重新拉取数据。先报 746003 可避免客户端做无用的全量重拉。
- RE 侧对应的是 **CLI 进程退出码 9/10**，**不是业务码**（`cli-skill/.../manual/error-codes.md:16-17`；`api-spec.md:61` 已明确「不得声称竞品对齐」）。→ 我们的 746002/746003 是自造码，此定性已在 api-spec 写明，本草案不重复发明。

**自动快照**：每次成功写事务后写一条 `canvas_snapshots`（`kind=1`）。依据：`database.md:498`「存 JSONB 快照按版本」。用途：冲突时给客户端 `diff` 基准与「恢复到此版本」。

### 4.3 一致性风险（自评，须人力确认）

| 风险 | 描述 | 建议 |
|---|---|---|
| R1 | `canvas_nodes.group_ids` 与 `canvas_pin_groups.node_ids` 存同一事实 | 同事务双写；以 `canvas_pin_groups.node_ids` 为权威，`group_ids` 为读优化冗余；每日对账任务 |
| R2 | `canvases.version` 与 `canvas_snapshots.version` | 快照 version 必须 = 画布 version，同事务写入；`UK(canvas_id,version)` 冲突即事务回滚 |
| R3 | `canvas_nodes.task_id` 与 `tasks` 状态回写 | 只允许 worker 回写 `tasks`；节点侧 `status` 由读 `tasks.status` 派生（避免双写不同步）→ **建议取消 `canvas_nodes.status` 的写路径，改为查询时派生** |

### 4.4 SSE 协议（本域最需定死的部分）

#### 4.4.1 传输与帧格式

**事实（bundle 实证）**：

| 项 | 事实 | 出处 |
|---|---|---|
| 客户端库 | **不是原生 `EventSource`**，是 `fetch` + 手写 SSE 解析器（`text/event-stream`，支持请求头、`AbortController`、`Last-Event-ID`、`retry:`） | `capture-canvas.json` 内联 bundle，`j="text/event-stream"`、`T="last-event-id"`、函数 `N(r,t)`（约 offset 8024432） |
| 使用方式 | `jQ(k,{method:"GET",headers:H,credentials:"include",openWhenHidden:!0,signal,onopen,onmessage,onerror,onclose})` | 同 bundle `DBe()` 内 `C()` |
| 必带头 | `Authorization: Bearer …`、`credentials:"include"`、**以及从 `GET /renew` 类接口动态获取的 `X-Space-Id`**；若 `X-Space-Id` 为空或 `"0"` → 等待 1s 后重试 | 同 `C()`：`const D=M["X-Space-Id"]?.trim(); if(!D||D==="0"){y();return}` |
| 跨区路由 | 按 `userInfo.data_center` 选 base：`sz/alisz→app.reelmate.cn`，`eus/eop/sgp→conn-agent-{zone}.reelmate.ai` | 同 bundle `RBe` 常量 |
| 心跳 | `ping` 与 `heartbeat` 两种 event 名，客户端**直接忽略** | 同 `onmessage`：`j.event==="ping"||j.event==="heartbeat"` → 跳过 |
| 非 event 帧 | 客户端不强制 `event:` 字段：`j.data && g(j.data, j.id)` —— **只有 `data:` + `id:` 也合法** | 同上 |

**帧（data）结构（事实）**：客户端解析 `JSON.parse(data)` 后取 `E.id`（字符串）与 `E.payload`（对象）；
若 `payload.type` 缺失则用外层 `E.type`；另一形态允许 `E.type` + `E.data`。
```
data: {"id":"<stream_id>","type":"<event_type>","payload":{...}}
id: <stream_id>
event: <event_type>        ← 可选
```
> ⚠️ 注意 `payload.type` 会被**提升为**事件类型：客户端 `H.type==null && typeof E.type==="string"` 时用外层 type 回填。
> 出处：`capture-canvas.json` 内联 bundle `d(k)` 函数（约 offset 1898486）。

#### 4.4.2 续传与断线重连（事实 + 明确设计）

| 项 | 设计 | 事实/推断 |
|---|---|---|
| 首次连接 | `GET /chat/sessions/:session_id/stream` 无参 | 事实（bundle 三元式） |
| 续传游标 | `?last_stream_id=<上一帧 id>` | **事实**（bundle URL 拼接 + `queryNames:["last_stream_id"]`） |
| 游标推进 | 每收到一帧若 `id` 非空则更新本地游标，并通过 `onStreamId` 回调外部持久化 | 事实（`M&&(l=M,o?.(M))`） |
| 服务端重放 | 按 `agent_events(session_id, seq > cursor.seq)` 顺序重放，**重放时仍下发原 `id:`** | **推断**（客户端只发参数，重放行为服务端实现）→ §6.2 A-03 |
| 重连退避 | `maxAttempts=5`，`baseDelay=1000ms`，`maxDelay=30000ms`，指数退避 `min(1000·2^n, 30000)`；`onopen` 重置计数 | **事实**（`cw={maxAttempts:5,baseDelay:1e3,maxDelay:3e4}`） |
| `onclose` | 触发退避重连 | 事实 |
| `onerror` | 抛错 → 走同一退避 | 事实 |
| 页面隐藏 | `openWhenHidden: true` → **后台标签页不主动断开** | 事实 |
| 页面卸载 | `pagehide` 事件（非 `persisted`）→ 主动 `close()` | 事实（`x(k){k.persisted||I()}`） |
| 游标失效 | 若 `last_stream_id` 已被清理（`agent_events` 过期）→ **746004 STREAM_CURSOR_EXPIRED**（待新增） | 推断（需新码，见 §6.4） |

#### 4.4.3 SSE 与「5s 轮询」的降级兼容（硬要求 3）

**现状（事实）**：现有产品用 **5s 轮询**：`useTaskPolling` 每 5s 批量调 `handleTaskResult({task_type,pid,task_ids})`；状态机 `pending→running→done/timeout`；完成后 debounce 刷新积分。依据：`REELMATE-逆向分析报告.md:338`。
我们的 `tasks` 契约已有 `ETag`/304 优化（`api-spec.md:191`）。

**设计原则（一句话）**：**SSE 是通知加速器，不是状态存储；所有状态必须能从 REST 幂等读回。**

| 通道 | 承载内容 | 断线后的兜底 |
|---|---|---|
| **任务进度**（媒体生成本身） | `agent_events` 里只放**引用**（`task_id` + 状态摘要），**不承载结果体** | 无条件回退 `GET /tasks?ids=` 轮询（`api-spec.md:175`）；结果以 `tasks.results` 为准 |
| **对话内容**（消息文本/卡片/HITL） | 必须落 `agent_messages` + `agent_events` | `GET …/messages?after_event_id=` 补齐（`routes.txt:333`）；**不能只靠 SSE，否则丢消息** |
| **SSE 通道不可用** | 服务端 5xx / 网络不通 / 网关不支持流 | 客户端降级为 **5s 轮询** `GET /tasks?ids=` + `GET …/messages?after_event_id=`，行为与 SSE 前一致 |

**降级判定（建议实现）**：
1. 首次 `GET …/stream` 返回非 `200` 或 `Content-Type != text/event-stream` → 记 `stream_unavailable=true`（会话级，不重试）；
2. 连续 5 次退避失败（`maxAttempts`）→ 切轮询；
3. 轮询期间每 60s 试连一次 SSE（轻量）；
4. **积分/余额类事件不依赖 SSE**：745701/745703 必须以 REST 响应码为准（SSE 只做提示）。

**明确不做**：不引入 WebSocket。理由：现有 `system-design.md:22-27` 的队列拓扑（BullMQ `gen.submit/gen.poll/result.transfer/notify`）已足够；SSE 单向推送匹配「服务端 → 客户端」的单向需求；且 RE 用 SSE（`text/event-stream` 事实），保持对齐利于 F2 页面 1:1。

#### 4.4.4 事件表（**事实层 / 假设层 严格分开**）

**A. 已见字面量（事实，但**不保证**是全集）**

| event / type | 证据 | 语义（据代码上下文） |
|---|---|---|
| `ping` | bundle `onmessage`：`j.event==="ping"` | 心跳，客户端忽略 |
| `heartbeat` | 同上 | 心跳别名，客户端忽略 |
| `user_message` | `iFe()`：`a==="user_message"\|\|e.event==="user_message"` → 取 `n.text/n.content` | 用户发言回显 |
| `hitl_required` | `iFe()`：`a==="hitl_required"\|\|e.event==="hitl_required"` → 取 `n.question/n.message` | **人机协同中断**（需用户决策） |
| `model_step`（及 `model_step.*` 前缀） | `iFe()`：`a==="model_step"\|\|a.startsWith("model_step.")\|\|step_type==="llm_output"` | 模型中间步骤/流式输出 |
| `skill_status`（及 `skill_status.*` 前缀） | `sFe()`：`t==="skill_status"\|\|t.startsWith("skill_status")` | 技能执行态（被消息列表**过滤掉**，不显示为消息） |

出处统一为 `capture-canvas.json` 内联 bundle（`E6`/`iFe`/`sFe`，约 offset 1849450-1849730）。`REELMATE-逆向分析报告.md:246` 亦明确「SSE 流式消息的完整事件类型表」仍为未知。

**B. HITL 载荷字段（事实）**

从 bundle 的 HITL 卡片组件可确证以下键：
`interrupt_id`（`payload.interrupt_id`，缺失时降级为字面量 `"hitl-readonly"`）、`question`、`message`、`content`、`agent_message{content, tool_calls[]}`、`allowed_decisions[]`（据 `includes("approve")`/`includes("reject")` 推断取值含 `approve`/`reject`）、`payload.nodes\|steps\|plan_steps\|actions`、`payload.display_text\|goal\|objective\|description\|summary\|title`、`completion_requirement ∈ {optional_text, required_text, input_assets, none}`、`selection_mode ∈ {single, multi}`、`scope ∈ {node, batch, clarification}`、`estimated_credits` / `credits` / `credit_cost`、`interaction_mode ∈ {choice, instruction}`。
出处：`capture-canvas.json` bundle 约 offset 1939416–2004408（`vze`/`mze`/`D6`/`WI` 等函数）。
**决策回传**：`POST /chat/sessions/:session_id/messages` 带 `decision{interrupt_id, decision, edits}`；或 `POST …/tasks/:task_id/interrupt`（`routes.txt:340`）。**两条路径的差异未取证**（§6.3 G-13）。

**C. 建议事件表（⚠️ 假设，待取证 —— 不得当作事实写入正式契约）**

见 §6.2 A-01。此处不复述，避免被误引为事实。

---

## 5. 接入点与迁移顺序

### 5.1 模块依赖方向（遵循 system-design §2）

`system-design.md:42-55` 规定：模块可依赖/禁止依赖表 + 「依赖方向单向：API 模块 → billing/models 基础域；模块间调用走内部 service 接口，**禁止跨模块直查表**」。

新增两个模块，须在该表补两行（本草案只建议，不修改原文件）：

| 模块 | 职责 | 可依赖 | 禁止依赖 |
|---|---|---|---|
| `canvas` | 画布/节点/连线/快照/协作锁/评论/固定组/模板；节点参数校验与派生任务编排 | `spaces, tasks, models, assets, files, agent`（agent 用于会话绑定；**通过 service 接口**） | `adapters`、`billing`（**不得直连**，扣费经 `tasks` 间接发生） |
| `agent` | 会话/消息/事件流/SSE/技能；对话编排与工具调用 | `spaces, tasks, models, canvas(读节点), files` | `adapters`、`billing` |

**关键约束（写死在契约里）**：
1. `canvas`/`agent` **不得**直接 `INSERT INTO tasks`，必须调 `tasks` 模块的创建接口（`system-design.md:55`）。理由：`tasks` 承载冻结/结算与 `dedupe_key` 派生（`database.md:205-214`）、`idempotency_records`（`database.md:227-235`），跨模块直写会绕过幂等与冻结。
2. `canvas`/`agent` **不得**直接读写 `credit_accounts`/`credit_flows`。扣费只经 `tasks`。
3. `agent` 对 `canvas` 只读节点（生成绑定），节点写入仍由 `canvas` 拥有。

### 5.2 迁移编号与顺序

现状：迁移已至 **0005**，共 26 表（`database.md:11`）。`database.md:13` 规定执行顺序为 `§3 tasks → §7 canvas_* → §8 configs`。

**建议拆 3 个迁移**（便于单步回滚，符合 `database.md:542`「每次迁移在 staging 演练并在 PR 附回滚 SQL」）：

| 编号 | 内容 | 依赖 | 回滚 |
|---|---|---|---|
| `0006_canvas_core` | `canvases`, `canvas_nodes`, `canvas_edges`, `canvas_snapshots` | `spaces`, `users`, `tasks`（均已存在） | DROP 4 表（先删子表） |
| `0007_canvas_collab` | `canvas_templates`, `canvas_materials`, `canvas_pin_groups`, `canvas_comment_nodes`, `canvas_comments` | `0006` | DROP 5 表 |
| `0008_agent` | `agent_sessions`, `agent_messages`, `agent_events`, `agent_message_bindings` | `0006`（`canvas_id`/`node_id`）、`tasks` | DROP 4 表 |

**前向外键处理**（遵循 `database.md:13,219-222` 的既有做法）：
- `canvases.episode_id → episodes(id)`：`episodes` 在 `§6` 已先建，但仍建议**末尾 `ALTER TABLE` 补加**，与其他前向外键写法一致：
  ```sql
  ALTER TABLE canvases ADD CONSTRAINT fk_canvases_episode
    FOREIGN KEY (episode_id) REFERENCES episodes(id);
  ```
- `canvas_nodes.task_id → tasks(id)`：`tasks` 在 `§3`，先于 `§7`，**可直接内联 REFERENCES**（无需 ALTER）。
- `agent_events.task_id` / `agent_messages.task_id → tasks(id)`：同上，内联。
- `agent_sessions.canvas_id → canvases(id)`、`agent_message_bindings.node_id → canvas_nodes(id)`：依赖 `0006`，故 `agent` 迁移必须在其后。

**迁移编号冲突提示**：若有其他并行草案也在抢 `0006`，请 Lead 统一分配；本草案的**相对顺序**（canvas_core → canvas_collab → agent）比绝对编号重要。

### 5.3 与既有域的数据流（单向）

```
用户操作
  │
  ├─ canvas 写（节点/连线/参数） ──► canvases/canvas_nodes/canvas_edges/canvas_snapshots
  │        │                           （version+1，写快照）
  │        └─ 需要生成 ─┐
  │                     ▼
  └─ agent 对话 ──► agent_sessions/agent_messages/agent_events
                        │
                        ▼
                 【tasks 模块】创建任务（capability/mode/scene + 冻结 + dedupe_key）
                        │
                        ▼
                 BullMQ gen.submit → worker → adapters → OSS
                        │
                        ▼
                 tasks.results 回写 ──► canvas_nodes.task_id 关联；SSE/轮询通知
                        │
                        ▼
                 用户转存 ──► assets（/assets/from-task，api-spec.md:451）
```

**依据**：任务创建时序 `system-design.md:57-` §3.1；队列拓扑 `system-design.md:22-27`；结果转存 `api-spec.md:451`；轮询 `api-spec.md:175,191`。

### 5.4 前端接入点（1:1 复刻视角）

| 页面/入口 | 依赖端点族 | 备注 |
|---|---|---|
| `/canvas`（`routes.txt:20`） | C1–C13 全部；SSE `C7` | X6 画布；11 种节点渲染 |
| 画布内 Agent 面板 | C7 + C13 + `agent/*` | HITL 卡片、计划预览、技能推荐 |
| `/agent`、`/agent/bigscreen`、`/agent/editor`（`routes.txt:14-16`） | `agent/*`（123–134） | 独立创作 Agent |
| CLI（`routes.txt:24` `/cli`） | 经 CLI 映射到 C1/C2/C3/C10 + `agent/*` | `canvas.md`/`node.md`/`agent.md` 定义的命令组 |

---

## 6. 假设与待取证清单

### 6.1 本章使用规则

- **事实（Fact）**：有 `文件:行` 或 bundle 代码字面量支撑。
- **推断（Inference）**：由多条事实推导，未经运行时验证。
- **假设（Assumption，待取证）**：RE 明确 unknown，或本草案为实现可行性而补的默认值。**这些项在正式契约中必须带 `[待取证]` 标记，不得写成既成事实。**
- 每条给出「取证方法」，便于 F2 阶段一次性关闭。

### 6.2 假设项 A：SSE 事件表与结构（5 条）

| ID | 假设内容（**待取证**） | 现状证据 | 取证方法 |
|---|---|---|---|
| **A-01** | **SSE 完整事件类型表**。建议初版集合：`session_opened, user_message, agent_message, model_step(.*), skill_status(.*), tool_call, plan_preview, hitl_required, node_created, node_updated, task_progress, generation_submitted, generation_succeeded, generation_failed, error, done, ping, heartbeat` | 仅 6 个已见字面量（§4.4.4 A）+ `REELMATE-逆向分析报告.md:246` 明示未知 | F2 用真实账号跑一次完整画布 Agent 会话，抓 `text/event-stream` 原始流 |
| **A-02** | 画布模板 `payload` 结构（`canvas_templates.payload` / `canvas-tpls` 响应体） | `canvas.md:148,169,189,206` 四处标注 **`[YApi] 待实测`**；`routes.txt:376` 存在 `elements/batch-create` 暗示模板含 elements 数组 | 调 `GET /web/v1/df/canvas-tpls?tpl_type=2` 与 `GET canvas-tpls/:id` |
| **A-03** | 服务端按 `last_stream_id` 重放的行为细节：是否保序、是否补发 `id:`、游标过期阈值 | 客户端代码只证明会**发送**该参数；重放语义未见 | 断网 30s 后重连，比对重放边界 |
| **A-04** | 事件是否需要 `event:` 字段（还是只靠 `data.payload.type`） | bundle 显示客户端两者都兼容，且 `ping`/`heartbeat` 用 `event:` 判别 → 说明至少心跳用 `event:` | 抓原始帧文本确认 |
| **A-05** | `agent/task/stream` 的 `raw` body 内容与为何用 POST（§3.6 已建议改 GET） | bundle 仅声明 `requestBodyType:raw`，内容未捕获 | 抓该请求的 request body |

### 6.3 假设项 G：语义与结构（7 条）

| ID | 假设内容（**待取证**） | 现状证据 | 取证方法 |
|---|---|---|---|
| **G-01** | `GET /df/canvas/canvas-scaffold` 的契约与用途（**routes.txt 与 bundle 均无，但运行时实发且返回 400**） | `net-canvas.json` transaction `request-560`/`request-1192`，HTTP 400，响应体未捕获 | 补齐参数后重放；或从 bundle 搜 `canvas-scaffold` 字面量 |
| **G-02** | `canvas-scaffold` 是否等价于「新建画布的默认节点布局」 | 同上 | 同上 |
| **G-03** | `/df/canvas/groups`（`routes.txt:387`）是独立实体还是 `node_type=group` 行的别名 | `group` 已是 11 种 node_type 之一（`database.md:488`、`node.md:88`）；`groups/:id` 与 `nodes/:id` 并存 | 对比两族响应结构 |
| **G-04** | 画布 ↔ 剧集映射：`canvas create` 返回 `episode_id`，`canvas delete` 称「删除画布对应的剧集容器」——是 1:1？删除是否级联删剧集？ | `canvas.md:27,48` | 建画布后查 `episodes`；删画布后查剧集是否消失 |
| **G-05** | 节点生成态（`status:"ai_generating"`）是前端态还是服务端持久态 | bundle `adopt` 路径造节点时带该值 → 可能纯前端 | 生成中刷新页面，看服务端是否回显 |
| **G-06** | `canvas_snapshots` 是否有「手动快照」概念（`kind=2`），还是纯自动 | `database.md:498` 只说「按版本」 | 查是否存在显式快照端点（当前清单无，故偏向纯自动） |
| **G-07** | `materials/batch-delete` 是软删还是物理删（影响 `deleted_at`） | `routes.txt:357`；`nodes-recover` 存在但无 `materials-recover` → 偏向物理删 | 删后查库/再 GET |
| **G-08** | 评论节点锚点结构（`anchor{x,y}` 是否成立；是否还有 `scale/zoom`） | 无任何 RE 证据，纯推断 | 抓 `POST /comment-nodes` 请求体 |
| **G-09** | `pinned-timelines` 结构（画布级 vs 节点级；为何同时有 `/{node_id}` 删除） | `routes.txt:373-374` | 抓请求/响应 |
| **G-10** | `agent-skills` 8 条端点是否属于本域（vs `ops` 内容运营域） | `routes.txt:378-385`，含 plaza/mine/favorites → 像市场 | 由 Lead 裁决归属 |
| **G-11** | `video_clip`/`video_reference`/`de_subtitle_*`/`frame_capture` 与 `tasks.mode` 的映射（§3.4 表内已标 ⚠️） | `node.md:80` 列 13 个 video mode；`api-spec.md:169` 只列 7 个 | 逐个提交验证，或查 model 目录 `params.generation.<mode>` |
| **G-12** | `agent/task/stream` 用 POST+raw 的原因（鉴权? body 带 cursor?） | 同 A-05 | 同 A-05 |
| **G-13** | HITL 决策回传的两条路径（`POST messages` 带 `decision` vs `POST …/interrupt`）的差异 | `routes.txt:340` 与 bundle 的 decision 卡片并存 | 各跑一次比对服务端效果 |

> **计数（权威）**：A 类 5 条（A-01..A-05）+ G 类 13 条（G-01..G-13）= 18 项；
> 其中 **A-05 与 G-12 是同一问题**（`agent/task/stream` 为何 POST+raw、body 是什么），合并计 1 项；
> → **去重后独立待取证项 = 17 条**（其中 4 条 A-01..A-04 为 SSE 协议层，A-05/G-12 合并后归入该层，故 SSE 相关共 5 项）。
> §0 摘要的「17 条」即此数。若 Lead 将 `agent-skills`（G-10）判归 `ops` 域，则本域待取证降为 16 条。

### 6.4 待新增错误码（**仅 2 条，均在 7460xx 段**）

**段位依据**：`api-spec.md:56-58` 中 `7460xx` 段现承载「幂等/并发」语义（746001 幂等重放、746002 版本冲突、746003 节点锁）。下列两条同属该语义族，故落 7460xx，**不侵占 4001xx/7457xx/7458xx/7459xx/5xxxxx**。

| 建议码 | 常量名 | 语义 | 触发场景 | 为何必须新增（不能复用既有码） |
|---|---|---|---|---|
| **746004** | `STREAM_CURSOR_EXPIRED` | SSE 续传游标已失效，无法增量重放，客户端须全量重建 | `GET …/stream?last_stream_id=X` 且 `agent_events` 中该游标已被清理（超出 `expires_at`） | 不能复用 400102：游标不是「资源」，会话本身仍存在；前端需区分「会话没了（该退出）」与「游标过期（该拉全量消息后重连）」。也不能复用 746001：非幂等重放语义 |
| **746005** | `AGENT_TURN_IN_FLIGHT` | 同一会话已有在途 Agent 轮次 | `POST …/messages` 时该 `session_id` 存在未终结轮次 | 不能复用 746003（那是节点锁，非会话）；不能复用 429100（那是频控，需 `Retry-After` 且不表达「等待上一轮」） |

**条件性提示（须 Lead 裁决）**：若会话改为**排队语义**（新消息入队等上一轮结束），则 **746005 不需要**；此时待新增码降为 1 条。
**明确不做的事**：本草案**未**新增任何其他码；§3 各表出现的 `400100/400101/400102/400103/400104/400105/400106/400107/401101/401102/403101/429100/429101/745701/745702/745703/745801/745802/745900/745901/746001/746002/746003/500000` **全部来自 `api-spec.md:31-59` 既有码表**。

**附：待新增「枚举值」而非错误码（单列，避免与码表混淆）**

| 枚举 | 缺失值 | 处置建议 |
|---|---|---|
| `tasks.mode`（`api-spec.md:169`） | canvas 侧 `crop`、`panorama`、`multi_angle_360`、`panorama_360`、`lighting`、`multi_camera_grid_9`、`story_grid_4\|9\|25`、`de_subtitle_auto\|region`、`frame_capture`、`video_upscale` | 二选一：①扩 `tasks.mode` 枚举（需 Lead 裁决并同步 `models.modes`）；②用 `options.op`/`options.sub_mode` 承载子模式（不污染 mode 维度的计价）。**建议 ②**，因 `model_prices` 按 `(model_id, mode, resolution, duration_s)` 定价（`database.md:161-173`），每加一个 mode 都要补价 |
| `canvases.creation_mode` | 1/2（RE 事实，`canvas.md:222`） | 直接采用，无需新增 |
| `canvas_templates.tpl_type` | 1/2/3（RE 事实，`canvas.md:171`） | 直接采用，无需新增 |

---

## 7. 自检清单（提交前已逐项核对）

| 硬性要求 | 自检结果 |
|---|---|
| 1. 复用 `tasks`（capability/mode/scene + 冻结结算），不另造任务表 | ✅ §2.4 明列 2 张「禁止」表；§3.4 全部走 `tasks`；§5.1 约束不得直连 billing |
| 1. 空间隔离 `space_id` | ✅ 13 表全含 `space_id`；§2.1 说明冗余理由与回填规则 |
| 1. 信封/错误码/幂等/分页/ID 字符串化遵循 api-spec §1 | ✅ §3.0 逐条给依据 `api-spec.md:13-68` |
| 2. canvas 4 表基于 §7 补齐（非另起一套） | ✅ §2.2.1–2.2.4 保留 §7 全部字段与默认值；仅新增必要列；`node_locks` 不落库 |
| 2. 11 种节点类型 | ✅ §2.2.2 注释 + §2.5 逐类型参数（`node.md:78-88`） |
| 2. 锁走 Redis 不落库 | ✅ §4.1（依据 `database.md:498`） |
| 2. 版本冲突用 746002/746003 | ✅ §4.2（依据 `api-spec.md:57-58`） |
| 3. SSE 协议写清 event/data/重连/与轮询关系/降级 | ✅ §4.4.1–4.4.4（含退避参数、游标、`pagehide`、`ping`/`heartbeat`） |
| 4. 事实与假设分离，RE unknown 单列 | ✅ §6.2/§6.3 两张表，共 17 项（A 5 + G 13，A-05≡G-12 合并），均带取证方法 |
| 5. 每条关键设计给 `文件:行` | ✅ 全文 80+ 处引用 |
| 6. 不新增未登记错误码；需要时单列「待新增码」+ 段位 | ✅ §6.4（仅 746004/746005，段位论证 + 条件性提示 + 枚举值另表） |

---

## 附：证伪与边界声明

1. 本文所有「事实」均可由 `rea-reelmate/capture-canvas.json`（内联 bundle）与 `rea-reelmate/routes.txt` 复核；`net-*.json` 的响应体**未捕获**，故凡涉及响应结构的陈述一律降级为推断或假设。
2. 本文**未**修改 `docs/02-architecture/*`、未修改任何源码。路径归一建议（`canvas-tpls` → `/canvas-templates`）、迁移编号（0006–0008）、限流数值、`agent_events.expires_at=7d` 均为**本草案建议值**，需 Lead 裁决后写入正式契约。
3. 本文不声称与竞品契约 1:1 等价：RE 侧版本冲突/节点锁是 **CLI 进程退出码 9/10**（`cli-skill/.../manual/error-codes.md:16-17`），业务码 746002/746003 是本产品自造，`api-spec.md:61` 已就此定性。
