# F1 总纲：四个全新后端域的划分、依赖与跨域决策（2026-10-26）

> 目的：F1 要为 `canvas` / `agent` / `cam` / `film` 四个新域定契约。**本文件定"跨域规则"和"我拍板的部分"**；
> 各域的表与端点细则见两份草案：`contract-draft-canvas-agent.md`、`contract-draft-cam-film.md`。
> 契约最终归宿：`docs/02-architecture/api-spec.md` + `database.md`（同 PR 更新，见 `docs/README.md` 维护规则 1）。

---

## 0. 端点盘点（Lead 实测，可复现）

命令：对 `rea-reelmate/routes.txt` 按前缀匹配并逐行输出（行号见下）。

| 域 | 端点条数（本体） | 附 | routes.txt 行号区间 | 说明 |
|---|---|---|---|---|
| `canvas`（画布） | **79** | +2 `canvas-tpls` | 322–402 | 节点/边批量、chat 会话与 SSE、节点锁/续期、分组、模板、素材、pin-groups |
| `agent`（对话式创作） | **12** | — | 123–134 | `task/stream`、`share/{id}/sse`、`stt-token`、chat/chat-end |
| `cam`（团队） | **39** | +6 `campaign`（活动，属 op 体系） | 228–266（campaign 267–272） | 团队/分组/成员/角色/积分分配回收/流水排行/第三方 Key |
| `film`（影视版） | **37** | — | 775–811 | 任务表/字段/单元格/审核评论/画布绑定/任务模板/导出/统计 |
| **四域本体合计** | **167** | 另 8 条附属（canvas-tpls 2 + campaign 6） | — | — |

> ⚠️ **口径陷阱（已实测，别用错分母）**：
> `-like '/web/v1/cam*'` 会连 `campaign/*` 一起命中 → 45；`-like '/web/v1/df/canvas*'` 会连 `canvas-tpls/*` 一起命中 → 81。
> 精确的 `cam` = 39、`df/canvas` = 79、`canvas-tpls` = 2、`campaign` = 6。**做分母时必须说清用哪种口径**——旧文档"928 条路由"就是把 API 常量与页面路由混算的同类错误。

**与现有规模的对照**：我方目前 112 端点 / 29 表。四个新域本体一次性引入 **167 个端点**（超过现有全量 1.5 倍），加上附属 8 条共 175 —— 这是 F1 为什么必须先契约、后编码。

---

## 1. 跨域决策（ADR 草案，待并入 `docs/02-architecture/adr.md`）

> 现有 ADR 到 008（`adr.md:8-70`）。以下 4 条是 F1 必须同时定下的"不可回退"决策。

### ADR-009｜四域按"资源所有权"划分，不按参照产品的微服务前缀照搬

| 项 | 决策 |
|---|---|
| 背景 | 参照产品用 `/df/*`（Drama Factory，466 端点）、`/cam/*`、`/film/*`、`/agent/*` 做服务前缀（`RM:92-106`）。我方是模块化单体（ADR-002）。 |
| 决策 | **保留域名划分**（`canvas`/`agent`/`cam`/`film`），因为它与资源所有权和权限边界一致；但**不拆服务**，仍是单一 NestJS 应用内的 4 个 module（依赖方向见 §2）。 |
| 理由 | 域边界对齐参照产品便于"1:1 对齐"时做覆盖核对（这是本次全站复刻的核心诉求）；不拆服务则保留 ADR-002 的运维简单性。 |
| 后果 | `df` 域不整体照搬——我们把 `df` 拆成 `script`(已有) + `canvas`(新) + `novel_market`(后续 F3)，因为它们的权限模型与生命周期完全不同。 |

### ADR-010｜团队不另建表：`spaces(type=2)` 是团队的唯一载体

| 项 | 决策 |
|---|---|
| 背景 | 现有 `spaces.type`（1个人 2团队）+ `space_members`（role/credits_quota）已是团队雏形（`database.md:72-84`），但 MVP 只落了 owner 一行。参照产品是独立 `cam/team/*` 体系 + `role_code:master` / `role_level:1`（`RM:260`）。 |
| 决策 | **扩展 `spaces`/`space_members`，不新建 `teams` 表**。新增 `team_groups`、`team_group_members`、`team_points_flows`(读视图或复用 credit_flows)、`user_third_keys`。`cam` 域只是"团队的一组端点"，数据仍落在 spaces 体系上。 |
| 理由 | 一旦有 `teams` 与 `spaces` 两张表，所有 `space_id` 隔离的既有逻辑（112 端点里绝大多数）都要双写判断，成本远大于收益；且违反 ADR-002 的模块边界简洁性。 |
| 后果 | `X-Space-Id` 请求头语义天然覆盖团队（`api-spec.md:25`）；团队切换=切 space_id。参照产品的 `team_id` 在我方映射为 `space_id`，需在契约里注明这一映射（复刻时容易误解为两个 ID）。 |

### ADR-011｜积分只有一本账：团队积分池 = space 级 `credit_accounts`，禁止双账本

| 项 | 决策 |
|---|---|
| 背景 | 参照产品有 `cam/team/points-allocation`、`points-recovery`、`points-flow/list`、`team_credit_total`（`RM:181,248-259`），看起来像"团队另有一本积分账"。 |
| 决策 | **团队积分池就是该 team-space 的 `credit_accounts(space_id)`**。分配=从团队 space 转给成员个人 space（`credit_flows` 两个 kind：`team_allocate_out` / `team_allocate_in`）；回收=反向。个人空间的消耗照旧。 |
| 理由 | 保持 `balance == Σ delta` 且 `frozen == Σ frozen_delta` 的既有不变式（`PRD.md:133`、`database.md` §4）；任何"团队总额 + 成员余额"的双账都会破坏它，且对账无法闭环。 |
| 后果 | `team_credit_total` 不是一个字段，而是团队 space 的 `balance`；`points-flow/list` 是 `credit_flows` 按 space 过滤的视图。需要新增 kind 枚举（见 §4 待新增码/枚举）。 |

### ADR-012｜SSE 是"新增通道"，轮询永远是降级基线

| 项 | 决策 |
|---|---|
| 背景 | 现有产品全靠 5s 批量轮询 + ETag（`api-spec.md` §6、`conventions.md:63`）；参照产品有 `agent/task/stream`、`canvas/:id/chat/sessions/:sid/stream`、`agent/home/resource/sse`（`routes.txt:125,133,337`）。 |
| 决策 | SSE 作为**独立只读通道**新增，**不替代**轮询：SSE 断线/不支持时前端回落到 5s 轮询，语义等价。SSE 只推"状态变更与结果指针"，不推二进制；鉴权复用 Bearer（EventSource 不支持自定义头 → 用**短时效 stream-token 查询参数**换取）。 |
| 理由 | 客户端/代理对 SSE 支持不一致（参照产品自己也保留了轮询）；把轮询留作降级是"双通道可切换"的 WBS 要求（`wbs.md:59`）。 |
| 后果 | 需要新增 `POST /stream-tokens`（短时效，一次性）——见 §4；SSE 不得承载计费/扣费动作，避免断线导致账目不一致。 |

---

## 2. 域职责与依赖方向（新增部分，接 `system-design.md:42-55` 的表）

| 模块 | 职责 | 可依赖 | 禁止依赖 |
|---|---|---|---|
| `canvas` | 画布/节点/边/分组/模板/快照；节点→任务绑定；节点锁与版本冲突 | `tasks`(建任务)、`assets`(素材)、`files`(上传)、`models`(枚举校验) | `script`（画布不得直接改剧本表；跨域需经 service 接口）、adapters |
| `agent` | 会话/消息/流式；会话→节点绑定；STT token | `canvas`(节点绑定，经接口)、`tasks`(读状态)、`models` | `billing` 的写操作（SSE 不得扣费） |
| `cam` | 团队/分组/成员/角色；团队积分分配回收 | `spaces`(核心)、`billing`(转账流水) | `canvas`/`film` 的业务表 |
| `film` | 影视版任务表/字段/单元格/审核评论/画布绑定/模板/导出 | `tasks`(建任务)、`assets`、`canvas`(绑定)、`cam`(成员/权限) | 直接查 `storyboards`（影视版任务表是独立模型，不与分镜表混用） |

**铁律**：`canvas` 与 `film` 都要"绑定任务"，但**都不得直接写 `tasks` 表**——统一走 `tasks` 模块的 service 接口（`system-design.md:55` "禁止跨模块直查表"）。

---

## 3. 表清单（待两份草案合并后定稿）

| 域 | 表 | 状态 |
|---|---|---|
| canvas | `canvases` `canvas_nodes` `canvas_edges` `canvas_snapshots` | **已有占位定义**（`database.md:481-502`），按 11 节点类型补齐即可 |
| canvas | `canvas_groups` `canvas_templates` `canvas_comment_nodes` `canvas_comments` `canvas_materials` `canvas_pin_groups` | 新增（对应 routes 的 groups/templates/comment-nodes/materials/pin-groups） |
| canvas | 节点锁 | **不落库**：Redis TTL 30s + 心跳续期（沿用 `database.md:498` 的既定决策） |
| agent | `agent_sessions` `agent_messages` `agent_message_node_bindings` | 新增 |
| cam | `team_groups` `team_group_members` `user_third_keys` | 新增；团队本体复用 `spaces`/`space_members` |
| film | `film_projects` `film_task_tables` `film_fields` `film_rows` `film_cells` `film_reviews` `film_review_comments` `film_canvas_bindings` `film_task_templates` `film_exports` | 新增（字段类型系统待定，见 §5） |

> 迁移顺序建议：`canvas`(0013) → `agent`(0014) → `cam`(0015) → `film`(0016)。理由：canvas/agent 只依赖既有 tasks/assets/spaces；cam 只依赖 spaces/billing；film 依赖前三个（canvas 绑定 + cam 成员 + tasks）。

---

## 4. 待新增错误码 / 枚举（必须显式登记，不许散落）

### 4.1 错误码

| 场景 | 建议 | 理由 |
|---|---|---|
| 画布版本冲突 | **复用 746002** | 已在码表（`api-spec.md:57`） |
| 画布节点被锁 | **复用 746003** | 已在码表（`:58`） |
| 团队权限不足 | **复用 403101 越权**，`data.reason` 区分 `not_member` / `role_insufficient` | 不新增码；403 段语义已覆盖 |
| 影视版字段类型/校验失败 | **复用 400101**（附 field） | 参数越界语义已覆盖 |
| SSE token 失效 | 建议**新增 401103 `STREAM_TOKEN_INVALID`**（4011xx 段） | 与 access token 失效区分，前端才能决定"重新换 token 再连"而不是"重新登录" |

### 4.2 枚举扩展（`credit_flows.kind`）

现有 kind：`recharge|gift|consume|unfreeze_refund|expire|adjust`（`database.md` §4，已去 expire 流水）。
新增 2 个，**必须成对出现**才守恒：

| kind | 语义 | 对账影响 |
|---|---|---|
| `team_allocate_out` | 团队 space 扣减（转给成员） | 团队 balance −，成员 balance +，全系统 Σ 不变 |
| `team_allocate_in` | 成员 space 增加（团队转入） | 同上（配对） |
| `team_recover_out` / `team_recover_in` | 回收（反向） | 同上 |

> 若不做成对记账，"团队额度"与"成员余额"会各自漂移，`balance == Σ delta` 立刻破。这是 ADR-011 的直接约束。

---

## 5. 必须标为"假设，待取证"的项（禁止写成事实）

| # | 项 | 为什么是假设 |
|---|---|---|
| A1 | 影视版任务表的**字段类型系统** | RE 侧即 unknown（`RM:242-246` 明确列为未解决） |
| A2 | SSE 的**完整事件类型表** | RE 只确认了 `event:/data:` 协议形态与 3 个 stream 端点，事件名清单未取证 |
| A3 | 画布**模板/prefab 的结构** | 仅知 `canvas-tpls`、`templates/personal`、`groups/:id/templates` 端点存在 |
| A4 | `comment-nodes` 与 `pin-groups` 的产品语义 | 仅有端点名，无 UI 证据 |
| A5 | `agent/home/resource/*`（信息流？推荐？） | 仅有端点名；`sse` 变体暗示是首页资源流，未取证 |
| A6 | `cam/user/third/key/*`（第三方 Key） | 疑为 BYOK 雏形，未取证 |

> 处理原则：**能推断就给保守方案 + 标注假设；不能推断就留 `TODO(取证)` 并明确"不实现不阻塞"**。参照 `reference-alignment-spec.md:929` 的既定规则："不要按全局设计语言硬猜具体布局"。

---

## 6. F1 交付判据（DoD）

1. 四域的表与端点写入 `database.md` / `api-spec.md`（含 ER 图更新、错误码表更新、迁移编号）；
2. 4 条 ADR 并入 `adr.md`（只增不改，标记旧条不动）；
3. 所有"假设项"在契约中显式标注，且 F1 不实现它们；
4. 端点总数与 routes.txt 的对照表可核对（本文件 §0）；
5. **不写业务代码**——F1 的产物只有文档；编码在 F2+ 按域推进。

---

## 7. 与"1:1 复刻"的边界再确认

四个域的端点名可以对齐（便于覆盖核对），但**协议自研**：
- 不照抄参照产品的请求体字段名（其 `track_data`/`user_data`/`refreshed` 这类"前端状态快照"字段是它自己的债，见 `RM:271-284`）；
- 不照抄其 `X-Prod-Id`/`X-Module-Action` 等内部头；
- 保留我方 `Authorization: Bearer`（ADR-006）与 `{code,msg,data}` 信封。
