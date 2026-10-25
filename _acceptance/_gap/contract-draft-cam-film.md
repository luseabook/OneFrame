# 契约草案 B：`cam` 团队域 + `film` 影视版域（F1 · 文档，不写码）

> 产物：表 DDL 草案 + 端点契约草案。**唯一写入本文件**；未改 `docs/`、未改任何源码。
> 上游总纲：`_acceptance/_gap/f1-domain-contract-overview.md`（ADR-009~012、跨域依赖、迁移编号）。
> 口径纪律：本文件每条关键设计给 `文件:行`。凡未经取证的推断一律标记 **【假设】** 并进入 §7 清单。
> 端点分母口径：**精确前缀**（`/web/v1/cam/` 与 `/web/v1/film/projects/`），不含 `campaign/*`、不含 `/df/*`。

---

## 0. 结论速览（给 Lead 的合并要点）

| 项 | 结论 |
|---|---|
| `cam` 端点 | **39 路径 / 40 操作**，`routes.txt:228-266`（连续块，无夹杂） |
| `film` 端点 | **37 路径 / 48 操作**，`routes.txt:775-811`（连续块，无夹杂） |
| 新增表 | **17 张**（cam 4 + film 13）；另**扩展** 3 张既有表（`spaces`、`space_members`、`credit_flows`） |
| 团队载体 | 复用 `spaces(type=2)` + `space_members`（`database.md:72-84`），**不新建 `teams`**；`team_id` ≡ `space_id` |
| 账本 | 只有一本：`credit_accounts(space_id)` + `credit_flows`（`database.md:287-305`）。团队积分池 = 团队 space 的 `balance`；分配/回收 = **成对跨 space 流水**，`balance == Σdelta` 全库不变（`database.md:321`） |
| 权限层级 | 三层：**user(JWT) → space(team, `space_members`) → film project(`team_member_projects`)**；**11 级 role 阶梯，`role_level` 非单调特权轴**（见 §3.1，这是本次最重要的权限结论） |
| `film` 字段类型 | 枚举**已从客户端 bundle 实证**（9 种），但 `RM:242-246` 的服务端契约仍 unknown → **仍整体标【假设】**，给保守裁剪方案（§7 A1） |
| 待新增错误码 | **1 个**：`400108 TEAM_SEAT_EXCEEDED`（4001xx 段）；其余全部复用既有码 |
| 待取证项 | **15 项**（§7） |
| 迁移编号 | `0015_cam_*.sql` → `0016_film_*.sql`（对齐总纲 §3 的 canvas 0013 → agent 0014 → cam 0015 → film 0016） |

### 0.1 对 Lead 裁决 `f1-lead-decisions.md` 的三个待答项（**直接结论，可直接并入裁决记录**）

Lead 在 `f1-lead-decisions.md:83-87` 留了三条"待 B 交付后补充"。逐条答：

**① `cam` 的 role 三层是否与 `space_members.role`（1owner/2admin/3member）兼容？**

> **结论：不兼容，但可无损并存——不要试图把 11 级压进 3 值。**

- `space_members.role`（`database.md:81`）是 **MVP 期的空间归属枚举**，3 值，语义是"这个 space 里你的身份"；
- RE 的 11 级 `role_code/role_level` 是**团队业务岗位**（导演/动画师/编剧/剪辑师/制片/制作），
  且 §3.1 已证明 `role_level` **不是**特权单调轴（level 11 的特权 > level 4）。
- 硬压会出两种错：(a) 把 `film_producer(10)/film_maker(11)` 映射成 `member(3)` → 制片**失去审核权**；
  (b) 把 `group_admin(3)` 映射成 `admin(2)` → 组管理员**获得全团队 admin 权限**，越权。
- **方案**：`role` 保留作"空间归属"（决定能否进这个 space、是否算 owner），
  `role_code/role_id/role_level` 独立承载业务岗位（§2.1.2 已加 3 列）。
  判定优先级：`role=1(owner)` ⇒ 等价 `master`；否则一律走 `role_code` + `power_list`。
  `role` 与 `role_code` 的一致性由 0015 的回填 UPDATE 保证（§5.3 第 4 条：1→master / 2→admin / 3→project_executor），
  之后只允许 `team_roles` 改 `role_code`，**不再改 `role`**（`role` 退化为历史字段）。

**② `film` 的字段类型系统（RE unknown）保守方案是否可接受？**

> **结论：可接受，且比原判断更强——本次已把"unknown"缩小到只剩 `config_json`。**

`RM:245` 说字段类型系统 unknown。本轮从客户端 bundle `D7aUDXP7.js` 实证拿到**枚举全集 9 种**
（`b=["text","asset_ref","link","user","date","canvas_ref","task_status","review_ref","points_ro"]`），
以及每种的 `encodeCell/decodeCell/filterOps/defaultWidth/isUnique` 行为。
所以保守方案（§7 A1）是：**只实现这 9 种 + 服务端不解析 `config_json` 语义**。
剩余真正的 unknown 只有 `config_json` 的 schema 与"唯一性在哪一层执行"，已标注。
⚠️ 必须提醒实现方的一个反直觉点：`is_unique_type` 实测语义是**"该 field_type 每表至多一个"**，
**不是"值唯一"**（`_e(t,e)` = 扫其它字段是否已有同 type），按"值唯一"实现会直接错。

**③ 团队积分池的配对记账 kind 是否足够？**

> **结论：足够，唯一补丁是 `credit_flows` 需要 4 个新列（不加表）。**

4 个 kind（`team_allocate_out/in`、`team_recover_out/in`）能覆盖分配/回收，
且每对在全系统层面 Σ=0，`balance == Σdelta` 与 `frozen == Σ frozen_delta` **双不变式都不破**（§4.2）。
但**必须**同时加列，否则无法回答"这笔钱从哪个 space 转到哪个 space、谁操作的、当时在哪个组"：
`ref_space_id` / `ref_user_id` / `op_user_id` / `group_id`（§2.1.3）。
**若只加 kind 不加列**，`points-flow/list` 与 `points-flow/export` 的 8 个筛选参数
（`op_user_name/op_user_account/target_user_name/target_user_account/group_id/…`，`routes.txt:254-255`）
将**无处可查** —— 这是本轮发现的、原总纲 ADR-011 未覆盖的一个缺口。

---

## 1. 端点盘点

### 1.1 方法（可复现）

```powershell
# 条数（行号区间）
$r = Get-Content E:\wanxing\rea-reelmate\routes.txt
(228..266 | Where-Object { $r[$_-1] -match '/web/v1/cam/' }).Count      # → 39
(775..811 | Where-Object { $r[$_-1] -match '/web/v1/film/projects/' }).Count  # → 37
```

**HTTP 方法来源**（`routes.txt` 只有路径，没有方法）：
`rea-reelmate/capture-canvas.json` 内嵌了自动生成的 OpenAPI 客户端（源脚本
`https://www.reelmate.cn/assets/core-lib-CKH7gQsw.js`），每个端点的
`path / method / requestBodyType / paramNames / queryNames` 均为明文常量。
抽取正则（已验证 cam 39 + film 37 与 `routes.txt` **双向零差集**）：

```powershell
$u = (Get-Content -Raw -Encoding UTF8 E:\wanxing\rea-reelmate\capture-canvas.json) -replace '\\"','"'
[regex]::Matches($u,'path:"(/web/v1/[^"]+)",method:Method\.([A-Z]+)') |
  ForEach-Object { "$($_.Groups[2].Value) $($_.Groups[1].Value)" } | Sort-Object -Unique
```

> **交叉校验（已做）**：`routes.txt` 的 film 37 条 vs OpenAPI 客户端 37 条，**无缺无多**；
> cam 39 条同样**无缺无多**（`routes.txt:261` 用 `{team_id}` 花括号写法，其余用 `:team_id`，
> 归一化后一致——这是路由表的写法不一致，不是两个端点）。

### 1.2 `cam` 端点族（39 路径 / 40 操作）

| # | 方法 | 路径 | 行 | 权限码（实测映射） | 子域 |
|---|---|---|---|---|---|
| 1 | GET | `/cam/permission/user` | 229 | **（无映射）** | 权限上下文 |
| 2 | GET | `/cam/linked-users?sp_id=` | 228 | **（无映射）** | 权限上下文 |
| 3 | GET | `/cam/role/list?team_id=` | 233 | `member.edit` | 权限上下文 |
| 4 | GET | `/cam/team/temp-info` | 260 | **（无映射）** | 权限上下文 |
| 5 | GET | `/cam/team/:team_id/info` | 239 | `team.view` | 团队本体 |
| 6 | POST | `/cam/team/:team_id/edit` | 234 | `team.edit` | 团队本体 |
| 7 | GET | `/cam/team/:team_id/groups?view=` | 238 | `group.view` | 分组 |
| 8 | POST | `/cam/team/:team_id/group` | 235 | `group.create` | 分组 |
| 9 | POST | `/cam/team/:team_id/group/:group_id/edit` | 237 | `group.edit` | 分组 |
| 10 | POST | `/cam/team/:team_id/group/:group_id/delete` | 236 | `group.delete` | 分组 |
| 11 | GET | `/cam/team/{team_id}/group/{group_id}/stats` | 261 | **（无映射）** | 分组 |
| 12 | GET | `/cam/team/:team_id/members` | 247 | `member.view` | 成员 |
| 13 | GET | `/cam/team/:team_id/member/:member_id` | 240 | `member.view` | 成员 |
| 14 | PUT | `/cam/team/:team_id/member/:member_id` | 240 | `member.edit` | 成员 |
| 15 | PUT | `/cam/team/:team_id/member/:member_id/name` | 243 | **（无映射）** | 成员 |
| 16 | PUT | `/cam/team/:team_id/member/:member_id/password` | 244 | `member.edit` | 成员 |
| 17 | GET | `/cam/team/:team_id/member/:member_id/credential` | 241 | **（无映射）** | 成员 |
| 18 | POST | `/cam/team/:team_id/member/:member_id/delete` | 242 | `member.remove` | 成员 |
| 19 | POST | `/cam/team/:team_id/member/batch` | 245 | `member.create` | 成员 |
| 20 | GET | `/cam/team/:team_id/member/export` | 246 | `member.download` | 成员 |
| 21 | POST | `/cam/team/member/batch/change-password` | 250 | `member.edit` | 成员（批） |
| 22 | POST | `/cam/team/member/batch/status` | 251 | `member.edit` | 成员（批） |
| 23 | POST | `/cam/team/member/change-group` | 252 | `group.member_change` | 成员（批） |
| 24 | GET | `/cam/project/:project_id/members` | 230 | `member.edit` ⚠️ | 项目成员 |
| 25 | POST | `/cam/project/:project_id/members/bind` | 231 | `project.member` | 项目成员 |
| 26 | POST | `/cam/project/:project_id/members/delete` | 232 | `member.edit` | 项目成员 |
| 27 | POST | `/cam/team/points-allocation` | 253 | `member.points` | 积分池 |
| 28 | POST | `/cam/team/points-recovery` | 256 | `member.points` | 积分池 |
| 29 | POST | `/cam/team/batch-points-allocation` | 249 | `member.edit` ⚠️ | 积分池 |
| 30 | GET | `/cam/team/points-flow/list` | 255 | `team.view` | 积分池 |
| 31 | GET | `/cam/team/points-flow/export` | 254 | `team.download` | 积分池 |
| 32 | GET | `/cam/team/project-points-flow/list` | 258 | `team.view` | 积分池 |
| 33 | GET | `/cam/team/project-points-flow/export` | 257 | `team.download` | 积分池 |
| 34 | POST | `/cam/team/account-points-ranking` | 248 | `team.view` | 积分池 |
| 35 | POST | `/cam/team/project-points-ranking` | 259 | `team.view` | 积分池 |
| 36 | GET | `/cam/user/third/key/list` | 266 | **（无映射）** | 第三方 Key |
| 37 | POST | `/cam/user/third/key/add` | 265 | **（无映射）** | 第三方 Key |
| 38 | GET | `/cam/user/third/key/:id/info` | 263 | **（无映射）** | 第三方 Key |
| 39 | PUT | `/cam/user/third/key/:id/update` | 264 | **（无映射）** | 第三方 Key |
| 40 | DELETE | `/cam/user/third/key/:id/delete` | 262 | **（无映射）** | 第三方 Key |

> ⚠️ 三处**映射可疑，按实测记录不臆改**（详见 §7 A2）：
> (a) `#24 GET .../project/:project_id/members` 要 `member.edit` 而读成员却要写权限；
> (b) `#29 batch-points-allocation` 要 `member.edit`，而单条分配要 `member.points`；
> (c) `#11 group stats`、`#15 name`、`#17 credential`、`#4 temp-info`、`#1/#2/#36-40` 共 9 条**在权限映射表中缺失**。
> 缺失 ≠ 免鉴权；本草案对缺失项统一要求**登录 + 空间成员**，再按 §3.2 的兜底规则判权。

### 1.3 `film` 端点族（37 路径 / 48 操作）

| # | 方法 | 路径（前缀 `/film/projects/:project_id`） | 行 | 子域 |
|---|---|---|---|---|
| 1 | GET | `/canvases/visible?tab=` | 779 | 画布绑定 |
| 2 | GET | `/canvases/:canvas_id/task-bindings` | 777 | 画布绑定 |
| 3 | GET | `/canvases/:canvas_id/task-panel` | 778 | 画布绑定 |
| 4 | POST | `/canvases/:canvas_id/submit-result` | 776 | 画布绑定 |
| 5 | DELETE | `/canvases/:canvas_id` | 775 | 画布绑定 |
| 6 | GET | `/task-tables` | 782 | 任务表 |
| 7 | POST | `/task-tables` | 782 | 任务表 |
| 8 | PATCH | `/task-tables/:table_id` | 783 | 任务表 |
| 9 | DELETE | `/task-tables/:table_id` | 783 | 任务表 |
| 10 | POST | `/task-tables/:table_id/apply-template` | 784 | 任务表 |
| 11 | POST | `/task-tables/reorder` | 808 | 任务表 |
| 12 | POST | `/task-tables/ensure-presets` | 806 | 任务表 |
| 13 | POST | `/task-tables/import` | 807 | 任务表 |
| 14 | GET | `/task-tables/:table_id/fields` | 785 | 字段 |
| 15 | POST | `/task-tables/:table_id/fields` | 785 | 字段 |
| 16 | PATCH | `/task-tables/:table_id/fields/:field_id` | 786 | 字段 |
| 17 | DELETE | `/task-tables/:table_id/fields/:field_id` | 786 | 字段 |
| 18 | POST | `/task-tables/:table_id/fields/reorder` | 788 | 字段 |
| 19 | POST | `/task-tables/:table_id/fields/batch-restore` | 787 | 字段 |
| 20 | GET | `/task-tables/:table_id/pref` | 789 | 表视图偏好 |
| 21 | PUT | `/task-tables/:table_id/pref` | 789 | 表视图偏好 |
| 22 | GET | `/task-tables/:table_id/tasks/query` | 802 | 行（任务） |
| 23 | POST | `/task-tables/:table_id/tasks` | 790 | 行（任务） |
| 24 | POST | `/task-tables/:table_id/tasks/unbound-query` | 805 | 行（任务） |
| 25 | POST | `/task-tables/:table_id/tasks/title-matches` | 804 | 行（任务） |
| 26 | POST | `/task-tables/:table_id/tasks/reorder` | 803 | 行（任务） |
| 27 | POST | `/task-tables/:table_id/tasks/batch-delete` | 800 | 行（任务） |
| 28 | POST | `/task-tables/:table_id/tasks/batch-restore` | 801 | 行（任务） |
| 29 | DELETE | `/task-tables/:table_id/tasks/:task_id` | 791 | 行（任务） |
| 30 | PUT | `/task-tables/:table_id/tasks/:task_id/cells` | 793 | 行（任务） |
| 31 | POST | `/task-tables/:table_id/tasks/:task_id/children` | 794 | 行（任务） |
| 32 | POST | `/task-tables/:table_id/tasks/:task_id/status` | 799 | 行（任务） |
| 33 | POST | `/task-tables/:table_id/tasks/:task_id/notify-assignees` | 795 | 行（任务） |
| 34 | GET | `/task-tables/:table_id/tasks/:task_id/canvas-bindings` | 792 | 行↔画布 |
| 35 | POST | `/task-tables/:table_id/tasks/:task_id/canvas-bindings` | 792 | 行↔画布 |
| 36 | PUT | `/task-tables/:table_id/tasks/:task_id/canvas-bindings` | 792 | 行↔画布 |
| 37 | DELETE | `/task-tables/:table_id/tasks/:task_id/canvas-bindings` | 792 | 行↔画布 |
| 38 | GET | `/task-tables/:table_id/tasks/:task_id/review` | 796 | 审核 |
| 39 | POST | `/task-tables/:table_id/tasks/:task_id/review/comments` | 797 | 审核 |
| 40 | POST | `/task-tables/:table_id/tasks/:task_id/review/read` | 798 | 审核 |
| 41 | GET | `/task-templates?scope=` | 809 | 模板 |
| 42 | POST | `/task-templates` | 809 | 模板 |
| 43 | DELETE | `/task-templates/:template_id` | 810 | 模板 |
| 44 | GET | `/exports` | 780 | 导出 |
| 45 | POST | `/exports` | 780 | 导出 |
| 46 | GET | `/recent-open` | 781 | 最近打开 |
| 47 | POST | `/recent-open` | 781 | 最近打开 |
| 48 | GET | `/tasks/stats` | 811 | 统计 |

**`film` 无权限映射**：156 条 route→permission 映射里 **0 条** `/film/*`（可复现：
`[regex]::Matches($u,'"/web/v1/film/[^"]+"\s*:\s*"[^"]+"')` → 0）。说明参照产品对影视版
**另有一套开关**（影视版白名单），见下条。

**影视版准入门禁（实测）**：`GET /web/v1/func-whitelist?scene=ai_film` → `{check:bool}`，
前端用 `checkFilmWhitelist()` 判定影视版是否对该用户/团队开放
（源脚本 `Dso67aSD.js`，`capture_page.json`，检索 `scene:"ai_film"`）。
> 结论：`film` 域在**三层权限之外还有第 0 层"功能准入"**。本草案把它落成 space 级开关
> （§3.2 第 0 层），不复用 `cam` 权限码。

**`film` 另有一个未进 `routes.txt` 的传输通道（重要）**：
```js
// 源脚本 D9zvpvCB.js（capture-canvas.json），任务表协同
function ee(e,t){return `film_table_${e}_${t}`}      // channel key = film_table_{wsid}_{tableId}
`/v1/rmwebsocket/film/tables/${tableId}/collab/${encodeURIComponent(j)}
   ?project_id=&session_id=&client_id=&mode=&t1={wsid}&t2={opUserId}`
```
→ 任务表是**协同编辑**（WebSocket 广播），且所有写请求体都自动带上 `client_id`
（该文件 `function c(e){...client_id:t...}`）用于**回声抑制**。
本草案契约里把它记为「**可选传输**」：写接口是权威路径，WS 只是广播加速；断线必须回落
（沿用总纲 ADR-012「轮询/HTTP 为降级基线」）。

### 1.4 批处理上限（实测常量，直接进契约）

源脚本 `D9zvpvCB.js`：`var k=100,f=100`。
- `tasks/batch-delete` 分片 **≤100**/请求（超过前端自行切分，见 `batchDeleteTasks` 循环）；
- `tasks/batch-restore`、`fields/batch-restore` 分片 **≤100**；
- `POST .../tasks`（建行）`count` 服务端夹取区间 **1..100**（`Math.max(1,Math.min(100,...))`）；
- `tasks/query` 与 `unbound-query` 默认 `page_size=200`。

---

## 2. 表设计草案

> 公约（`database.md:3-4`）：主键统一雪花 `BIGINT`（应用层生成）；表/字段 snake_case 复数；
> 枚举 `smallint` + 应用层常量（不建 PG enum）；结构化数据 `JSONB`；均含 `created_at`/`updated_at`。
> 下列 DDL 省略重复的 `created_at/updated_at`，仅首次出现时标注。
> 迁移顺序与外键处理见 §6。

### 2.1 复用与扩展（**不新建 teams / 不新建账本**）

#### 2.1.1 `spaces`（扩展，`database.md:72-77`）

现有：`id / owner_user_id / type(1个人 2团队) / name`。团队域需要 4 个团队属性，
**加列复用**，不另起表：

```sql
ALTER TABLE spaces
  ADD COLUMN max_seats     INT NOT NULL DEFAULT 5,        -- 席位数上限（订阅档位决定，见 A13）
  ADD COLUMN status        SMALLINT NOT NULL DEFAULT 1,   -- 1正常 2停用 3欠费冻结
  ADD COLUMN agent_whitelist SMALLINT NOT NULL DEFAULT 0, -- 对齐 RE team_info.agent_whitelist（0/1）
  ADD COLUMN film_enabled  SMALLINT NOT NULL DEFAULT 0;   -- 影视版功能准入（§3.2 第 0 层；对齐 func-whitelist?scene=ai_film）
```
依据：`team_info{team_name, seat, agent_whitelist, team_statistics{master_wsid_points}}`
（源脚本 `Dso67aSD.js`，`capture_page.json` 检索 `team_statistics`）；
`cam/team/temp-info` 返回的模型开关矩阵见 `RM:325` 与 §3.5。
> `type=2` 的判定是**唯一**团队判据；`team_id` 一律就是 `space_id`（ADR-010）。契约里遇到
> RE 的 `team_id` 字段，映射为 `space_id`；遇到 `wsid`（万兴全域用户 ID）映射为 `user_id`。

#### 2.1.2 `space_members`（扩展，`database.md:78-84`）

现有：`space_id / user_id / role(smallint 1owner 2admin 3member) / credits_quota`，主键
`(space_id, user_id)`。**保留 `role` 不动**（个人空间与 MVP 语义），新增团队域所需的角色与分组：

```sql
ALTER TABLE space_members
  ADD COLUMN role_id     BIGINT,                            -- → team_roles.id（团队自定义角色，可空=用 role 兜底）
  ADD COLUMN role_code   TEXT,                              -- master|admin|group_admin|project_manager_download|...（§3.1）
  ADD COLUMN role_level  SMALLINT,                          -- 1..11，**仅用于展示与排序，不作特权判据**（§3.1）
  ADD COLUMN group_id    BIGINT,                            -- → team_groups.id（可空=未分组）
  ADD COLUMN status      SMALLINT NOT NULL DEFAULT 1,        -- 1正常 2停用 3待激活
  ADD COLUMN nickname    TEXT,                               -- 对齐 cam member.nick
  ADD COLUMN account     TEXT,                               -- 对齐 cam member.account（登录账号）
  ADD COLUMN remark      TEXT,                               -- 对齐 cam member.remark
  ADD COLUMN invited_at  TIMESTAMPTZ,
  ADD COLUMN joined_at   TIMESTAMPTZ;
CREATE INDEX idx_space_members_group ON space_members(space_id, group_id);
CREATE INDEX idx_space_members_role  ON space_members(space_id, role_code);
```
> `credits_quota`（既有列，`database.md:82`，一直未启用）在本域**激活**为
> 「该成员未回收的已分配额上限」，语义与算法见 §4.3。**它不是一个余额**，不参与任何
> `balance == Σdelta` 计算——这是避免双账本的关键。

#### 2.1.3 `credit_flows`（扩展，`database.md:292-305`）


现有列：`id / space_id / delta / frozen_delta / kind / ref_task_id / ref_order_id /
ref_code_id / balance_after / memo`。团队积分池要在同一张表上表达"谁转给谁"，缺 3 列：

```sql
ALTER TABLE credit_flows
  ADD COLUMN ref_space_id BIGINT,   -- 对手方 space（分配/回收必填；其它 kind 为 NULL）
  ADD COLUMN ref_user_id  BIGINT,   -- 目标成员 user（分配/回收必填；= 对手方 space 的 owner）
  ADD COLUMN op_user_id   BIGINT,   -- 操作者 user（审计：谁点的分配）
  ADD COLUMN group_id     BIGINT;   -- 快照当时成员所属分组（对齐 points-flow/list 的 group_id 过滤）
CREATE INDEX idx_flows_space_kind ON credit_flows(space_id, kind, created_at DESC);
CREATE INDEX idx_flows_ref_space  ON credit_flows(ref_space_id, created_at DESC);
```
> 为什么是"加列"而不是"新建 `team_points_flows`"：一旦新表，团队流水与个人流水就有两套
> 记账路径，`balance == Σdelta` 无法在全库层面单条 SQL 校验（`database.md:321`、`security §3`、
> `testing §2-1` 三处同文的不变式会立刻破）。加列是纯附加，历史行为零变更。

### 2.2 `cam` 新增表（4 张）

```sql
-- ① 分组：树形（parent_id 自引用），对齐 cam/team/:team_id/groups?view=、group/:id/stats
CREATE TABLE team_groups (
  id          BIGINT PRIMARY KEY,
  space_id    BIGINT NOT NULL REFERENCES spaces(id),
  parent_id   BIGINT REFERENCES team_groups(id),   -- NULL=根分组
  name        TEXT NOT NULL,
  leader_user_id BIGINT REFERENCES users(id),      -- 组管理员（role_code=group_admin 的成员）
  sort        INT NOT NULL DEFAULT 0,
  status      SMALLINT NOT NULL DEFAULT 1,         -- 1正常 2停用
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_team_groups_space ON team_groups(space_id, parent_id, sort);
-- 注：禁止跨 space 的 parent，写入时校验 parent.space_id == space_id（否则 400101）

-- ② 团队自定义角色：对齐 cam/role/list?team_id=（返回 data.list，见 Dso67aSD.js `_fetchRolesWithGeneration`）
CREATE TABLE team_roles (
  id          BIGINT PRIMARY KEY,
  space_id    BIGINT NOT NULL REFERENCES spaces(id),
  role_code   TEXT NOT NULL,               -- 内置 11 个 + 自定义（§3.1）
  role_name   TEXT NOT NULL,               -- 如「管理员」「导演」「动画师」
  role_level  SMALLINT NOT NULL,           -- 1..11（展示/排序用）
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  power_list  JSONB NOT NULL DEFAULT '[]', -- [{module,action,permission_code}]，对齐 permissionContext.power_list
  module_id_list JSONB NOT NULL DEFAULT '{"module":"","module_ids":[]}',
  status      SMALLINT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (space_id, role_code)
);

-- ③ 成员↔项目 作用域：对齐 cam/project/:project_id/members(|/bind|/delete)、member 查询的 sp_ids
--    project_kind: 1=剧本项目(script_projects, 即 RE 的 sp_ids) 2=影视版项目(film_projects)
--    ⚠️ 故意**不建**指向 film_projects/script_projects 的外键：cam 模块禁止依赖 film/script 业务表
--       （system-design.md:44-55「禁止跨模块直查表」），由被依赖方 service 接口校验存在性。
CREATE TABLE team_member_projects (
  id           BIGINT PRIMARY KEY,
  space_id     BIGINT NOT NULL REFERENCES spaces(id),
  user_id      BIGINT NOT NULL REFERENCES users(id),
  project_kind SMALLINT NOT NULL DEFAULT 1,   -- 1脚本 2影视版
  project_id   BIGINT NOT NULL,               -- 不透明 ID，无 FK（见上）
  granted_by   BIGINT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (space_id, user_id, project_kind, project_id)
);
CREATE INDEX idx_tmp_space_project ON team_member_projects(space_id, project_kind, project_id);

-- ④ 第三方 Key（BYOK 雏形；A6 未取证，保守落最小面）
CREATE TABLE user_third_keys (
  id          BIGINT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  space_id    BIGINT REFERENCES spaces(id),        -- 团队级 Key 时填；个人 Key 为 NULL
  provider    TEXT NOT NULL,                       -- 供应商标识（A6）
  label       TEXT NOT NULL DEFAULT '',
  key_cipher  TEXT NOT NULL,                       -- AES-GCM 密文；对齐 identities.phone_cipher 口径（database.md:65）
  key_hash    TEXT,                                -- 便于等值查重（不存明文）
  status      SMALLINT NOT NULL DEFAULT 1,         -- 1启用 2停用
  last_used_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_user_third_keys_user ON user_third_keys(user_id, provider);
```
> 明文 Key 一律不下发、不进日志、不进响应（只回 `label` + 掩码尾 4 位）。这是安全底线，
> 不是假设。

### 2.3 `film` 新增表（13 张）

```sql
-- ① 影视版项目（本体端点未观测，A2；保守自成表 + 可选挂接剧本项目）
CREATE TABLE film_projects (
  id                     BIGINT PRIMARY KEY,
  space_id               BIGINT NOT NULL REFERENCES spaces(id),
  title                  TEXT NOT NULL DEFAULT '未命名影视项目',
  source_script_project_id BIGINT REFERENCES script_projects(id), -- 可空：从剧本项目派生时填
  status                 SMALLINT NOT NULL DEFAULT 1,   -- 1进行中 2归档
  created_by             BIGINT NOT NULL REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_film_projects_space ON film_projects(space_id, created_at DESC);

-- ② 任务表（对齐 `p(e)`：table_id/project_id/name/is_preset/sort/version）
CREATE TABLE film_task_tables (
  id         BIGINT PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES film_projects(id),
  space_id   BIGINT NOT NULL REFERENCES spaces(id),      -- 冗余隔离列（所有 film 表都带）
  name       TEXT NOT NULL DEFAULT '任务表',
  is_preset  SMALLINT NOT NULL DEFAULT 0,                -- 预置表标记（ensure-presets 生成）
  sort       INT NOT NULL DEFAULT 0,
  version    INT NOT NULL DEFAULT 0,                     -- 表级乐观锁
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_film_tables_project ON film_task_tables(project_id, sort);

-- ③ 字段（对齐 `b(e)`：field_id/table_id/key/name/field_type/is_system/is_unique_type/
--    sort/config_json/hidden/width）
CREATE TABLE film_fields (
  id             BIGINT PRIMARY KEY,
  table_id       BIGINT NOT NULL REFERENCES film_task_tables(id),
  space_id       BIGINT NOT NULL REFERENCES spaces(id),
  key            TEXT NOT NULL,                 -- 稳定键：系统字段为 title/assignees/produce/task_status/review/points
  name           TEXT NOT NULL,
  field_type     TEXT NOT NULL DEFAULT 'text',  -- 9 种，见 §7 A1（【假设】服务端可选集）
  is_system      BOOLEAN NOT NULL DEFAULT FALSE,
  is_unique_type BOOLEAN NOT NULL DEFAULT FALSE, -- ⚠️ 语义=「该 field_type 每表至多一个」，**不是值唯一**（§7 A1）
  sort           INT NOT NULL DEFAULT 0,
  config_json    JSONB NOT NULL DEFAULT '{}',   -- 【假设】各类型 schema 未取证
  hidden         BOOLEAN NOT NULL DEFAULT FALSE,
  width          INT,
  deleted_at     TIMESTAMPTZ,                   -- 软删：支持 fields/batch-restore 恢复
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (table_id, key)
);
CREATE INDEX idx_film_fields_table ON film_fields(table_id, sort);

-- ④ 行（= 任务行；对齐 `_(e)`：task_id/table_id/parent_id/sort/version/created_by/cells/
--    produce{canvas_ids}/review{latest_version_no,version_id,thumb_file_id,unread}/children）
CREATE TABLE film_tasks (
  id            BIGINT PRIMARY KEY,
  table_id      BIGINT NOT NULL REFERENCES film_task_tables(id),
  space_id      BIGINT NOT NULL REFERENCES spaces(id),
  parent_id     BIGINT REFERENCES film_tasks(id),   -- NULL=根行（RE 用 "0" 表示根，落库归一为 NULL）
  sort          INT NOT NULL DEFAULT 0,
  version       INT NOT NULL DEFAULT 1,             -- 行级乐观锁；PUT cells 必带（§3.3）
  status        SMALLINT NOT NULL DEFAULT 1,        -- 1 not_started 2 in_progress 3 pending_review 4 rejected 5 done
  title         TEXT NOT NULL DEFAULT '',           -- 系统字段 title 的冗余快照（仅为排序/搜索/唯一标题校验）
  review_version_no INT NOT NULL DEFAULT 0,         -- = review.latest_version_no
  created_by    BIGINT REFERENCES users(id),
  deleted_at    TIMESTAMPTZ,                        -- 软删：batch-delete/batch-restore
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_film_tasks_table ON film_tasks(table_id, parent_id, sort);
CREATE INDEX idx_film_tasks_status ON film_tasks(table_id, status);
CREATE INDEX idx_film_tasks_title ON film_tasks(table_id, lower(title));

-- ⑤ 单元格（归一化；API 仍以 {field_id:value} 映射返回，见 §3.3）
CREATE TABLE film_cells (
  id        BIGINT PRIMARY KEY,
  task_id   BIGINT NOT NULL REFERENCES film_tasks(id),
  field_id  BIGINT NOT NULL REFERENCES film_fields(id),
  space_id  BIGINT NOT NULL REFERENCES spaces(id),
  value     JSONB,                                -- 各类型 encodeCell 后的规范形（§7 A1）
  updated_by BIGINT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, field_id)
);
CREATE INDEX idx_film_cells_field ON film_cells(field_id);
-- 稀疏：无值 = 无行（RE 的 cells 是稀疏 map）。"清空"= DELETE 行，不是写 null。

-- ⑥ 表视图偏好（对齐 `u(e)`：hidden_field_ids/filter[]/ui{row_height,column_widths,sorts}）
--    共享口径：per (table, user)；RE 未明确是共享还是个人 → 保守取个人（A10）
CREATE TABLE film_table_prefs (
  id               BIGINT PRIMARY KEY,
  table_id         BIGINT NOT NULL REFERENCES film_task_tables(id),
  space_id         BIGINT NOT NULL REFERENCES spaces(id),
  user_id          BIGINT NOT NULL REFERENCES users(id),
  hidden_field_ids JSONB NOT NULL DEFAULT '[]',
  filter           JSONB NOT NULL DEFAULT '[]',   -- [{field_key,op,value}]
  ui               JSONB NOT NULL DEFAULT '{}',   -- {row_height, column_widths:{field_id:px}, sorts:[{field_id,order}]}
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (table_id, user_id)
);

-- ⑦ 审核（版本化；对齐 review{latest_version_no,version_id,thumb_file_id,unread}）
CREATE TABLE film_task_reviews (
  id             BIGINT PRIMARY KEY,
  task_id        BIGINT NOT NULL REFERENCES film_tasks(id),
  space_id       BIGINT NOT NULL REFERENCES spaces(id),
  version_no     INT NOT NULL,                  -- 第几版提交
  version_id     BIGINT REFERENCES assets(id),   -- 版本指针（A3：RE 用 version_id 字符串）
  thumb_file_id  TEXT,                          -- 缩略图 storage key
  status         SMALLINT NOT NULL DEFAULT 1,   -- 1待审 2通过 3驳回（**枚举为假设** A3）
  submitted_by   BIGINT NOT NULL REFERENCES users(id),
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by     BIGINT REFERENCES users(id),
  decided_at     TIMESTAMPTZ,
  decision_comment TEXT,
  UNIQUE (task_id, version_no)
);
CREATE INDEX idx_film_reviews_task ON film_task_reviews(task_id, version_no DESC);

-- ⑧ 审核评论（对齐 review/comments POST）
CREATE TABLE film_review_comments (
  id          BIGINT PRIMARY KEY,
  task_id     BIGINT NOT NULL REFERENCES film_tasks(id),
  review_id   BIGINT REFERENCES film_task_reviews(id),
  space_id    BIGINT NOT NULL REFERENCES spaces(id),
  author_id   BIGINT NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  mentions    JSONB NOT NULL DEFAULT '[]',      -- [user_id...]（notify-assignees 复用）
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_film_review_comments ON film_review_comments(task_id, created_at);

-- ⑨ 审核已读回执（对齐 review/read POST；A15：语义未取证）
CREATE TABLE film_review_reads (
  task_id     BIGINT NOT NULL REFERENCES film_tasks(id),
  user_id     BIGINT NOT NULL REFERENCES users(id),
  space_id    BIGINT NOT NULL REFERENCES spaces(id),
  last_read_version_no INT NOT NULL DEFAULT 0,
  read_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

-- ⑩ 行↔画布绑定（对齐 canvases/:id/task-bindings 与 tasks/:id/canvas-bindings；
--    对齐 `te(e)` 的 produce.canvas_ids 与 `Be/U` 的 {canvas_id,name,cover,created_at}）
CREATE TABLE film_canvas_bindings (
  id         BIGINT PRIMARY KEY,
  task_id    BIGINT NOT NULL REFERENCES film_tasks(id),
  canvas_id  BIGINT NOT NULL REFERENCES canvases(id),  -- canvases 在 0013 建（database.md:481-484）
  space_id   BIGINT NOT NULL REFERENCES spaces(id),
  bound_by   BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, canvas_id)
);
CREATE INDEX idx_film_bindings_canvas ON film_canvas_bindings(canvas_id);

-- ⑪ 任务模板（对齐 task-templates GET(?scope=)/POST/DELETE + apply-template）
CREATE TABLE film_task_templates (
  id         BIGINT PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES film_projects(id),
  space_id   BIGINT NOT NULL REFERENCES spaces(id),
  name       TEXT NOT NULL,
  scope      SMALLINT NOT NULL DEFAULT 1,        -- 1个人 2团队（A10；对齐 ?scope=）
  owner_id   BIGINT NOT NULL REFERENCES users(id),
  payload    JSONB NOT NULL DEFAULT '{}',        -- 【假设】模板体结构未取证：{fields:[],tasks:[],pref:{}}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_film_templates_project ON film_task_templates(project_id, scope);

-- ⑫ 导出（对齐 exports GET/POST；**不复用** exports 表，因 exports.episode_id NOT NULL，database.md:239）
CREATE TABLE film_exports (
  id          BIGINT PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES film_projects(id),
  space_id    BIGINT NOT NULL REFERENCES spaces(id),
  table_ids   JSONB NOT NULL DEFAULT '[]',       -- 多表打包
  format      TEXT NOT NULL DEFAULT 'xlsx',      -- 【假设】A12
  status      SMALLINT NOT NULL DEFAULT 1,       -- 1排队 2处理中 3完成 4失败（沿用 database.md:282 语义）
  file_uri    TEXT,                              -- storage key（签 1h URL，不落会过期的签名 URL）
  expires_at  TIMESTAMPTZ,                       -- 成功后 7 天清理（database.md:532）
  error       JSONB,
  created_by  BIGINT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_film_exports_project ON film_exports(project_id, created_at DESC);

-- ⑬ 最近打开（对齐 recent-open GET/POST）
CREATE TABLE film_recent_opens (
  project_id  BIGINT NOT NULL REFERENCES film_projects(id),
  user_id     BIGINT NOT NULL REFERENCES users(id),
  space_id    BIGINT NOT NULL REFERENCES spaces(id),
  table_id    BIGINT,                            -- 最近停留的表（可空）
  opened_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
```
**表数复核**：cam 4（`team_groups` / `team_roles` / `team_member_projects` / `user_third_keys`）
+ film 13（上 ①~⑬）= **17 张**；另扩展 `spaces`、`space_members`、`credit_flows` 3 张既有表。

---

## 3. 端点契约草案

### 3.1 权限模型：11 级 role 阶梯（**`role_level` 不是单调特权轴**）

实测枚举（源脚本 `Dso67aSD.js`，`capture_page.json` 检索 `PROJECT_MANAGER_DOWNLOAD`）：

| level | role_code | 中文名 | 关键特权 |
|---|---|---|---|
| 1 | `master` | 团长/超管 | 拥有全部权限（`isOwner` 短路为全通过） |
| 2 | `admin` | 管理员 | 除 `team.add_admin`/`member.edit_admin`/`member.disable_admin` 外全部 |
| 3 | `group_admin` | 组管理员 | 本组范围内管理（可分配"当前组积分"） |
| 4 | `project_manager_download` | 导演（可下载） | 项目/分集/分镜/资源 |
| 5 | `project_manager` | 导演 | 同上（无下载） |
| 6 | `project_executor_download` | 动画师（可下载） | 分镜/资源 |
| 7 | `project_executor` | 动画师 | 同上（无下载） |
| 8 | `project_screenwriter` | 编剧 | 剧本类 |
| 9 | `project_video_editor` | 剪辑师 | 剪辑类 |
| 10 | `film_producer` | 制片 | **审核特权**（见下） |
| 11 | `film_maker` | 制作 | **审核特权**（见下） |

**⚠️ 关键结论（必须写进正式契约，否则实现必错）**：参照产品把 level 10/11 的「制片/制作」
放进了**独立特权集合**，与 level 高低无关：

```js
var p = new Set(["producer","maker","film_producer","film_maker"]);   // 影视版特权集
function k(e){ return e ? e.level===10 || p.has(e.code??"") : !1 }    // 制片判定
var D = new Set(["master","admin","group_admin"]);                     // 管理集
function J(e){ return D.has(e??"") || p.has(e??"") }                   // 管理∪制片 = 可批准
```
→ 因此：**不得**用 `role_level <= N` 实现特权判定。`level=11 (film_maker)` 的权限**高于**
`level=4 (导演)`，虽然数字更大。我们的实现必须照抄这个"**码集 ∪ 单点**"判据，而不是序列判据。

另外三条实测公理：
1. `isOwner = (role_code === "master")`；`isAdmin = {"master","admin","group_admin"}`；
2. `isChild = roleLevel !== 1`（非团长即"子账号"）；
3. 可达额度：`allocatableCredits = isGroupAdmin ? currentGroupPoints : masterPoints`
   （组管理员只能分配"本组积分"，团长/管理员可分配"主账号积分"）——**这条直接约束 §4 的分配上限**。

### 3.2 三层（实为四层）鉴权闸门

所有 `cam`/`film` 端点按以下顺序校验，任一层失败即返回指定码，**不泄露下层存在性**：

| 层 | 校验 | 失败码 |
|---|---|---|
| **L0 功能准入** | `spaces.film_enabled=1`（仅 `film` 域；对齐 `func-whitelist?scene=ai_film`） | `403101`，`data.reason="film_not_enabled"` |
| **L1 用户** | `Authorization: Bearer` 有效（`api-spec.md:24`） | `401101` / `401102` |
| **L2 空间(团队)** | `X-Space-Id` 存在、`spaces.type=2`、`space_members(space_id,user_id)` 存在且 `status=1` | 缺成员 → `403101` `reason="not_member"`；非团队空间 → `400101` `field="X-Space-Id"` |
| **L3 权限码** | `role_code=master` 短路通过；否则 `team_roles.power_list` 含所需 `permission_code` | `403101` `reason="role_insufficient"`（附 `required`） |
| **L4 项目作用域** | 目标 `:project_id` 属于本 space；若成员有 `team_member_projects` 限定，则须命中 | 跨 space → `400102`（不泄露存在性，对齐 `api-spec.md:407`）；未授权项目 → `403101` `reason="project_scope_denied"` |

> 复用 **403101**、不新造码（`api-spec.md:46`）；用 `data.reason` 区分四种情形，
> 与总纲 §4.1 的决策一致（`f1-domain-contract-overview.md:107`）。
> L4 的"跨 space 一律 400102"沿用既有流水线口径（`api-spec.md:414`），不要改成 403。

**`cam` 权限码全集（62 个，实测）**——可在正式契约里作为常量表落地：
`project(.view/.create/.edit/.delete/.export/.member)`、`episode(.view/.create/.edit/.delete/.download)`、
`storyboard(.view/.create/.edit/.delete/.confirm)`、`resource(.view/.upload/.edit/.delete/.download)`、
`member(.view/.edit/.remove/.edit_admin/.disable_admin/.create/.points/.download)`、
`team(.view/.edit/.download/.add_admin)`、`knowledge(.view/.create/.edit/.delete)`、
`knowaistoryboard(.view/.create/.edit/.delete)`、`playwriting(.view/.edit/.upload/.download/.delete/.member)`、
`group(.view/.create/.edit/.delete/.download/.member_change)`，
外加 10 个**仅模块名的粗粒度码**（`project`、`episode`、`storyboard`、`resource`、`member`、`team`、
`knowledge`、`playwriting`、`group`）——粗码与细码并存，`hasPermission` 按精确串匹配，
所以两者都要落库（`team_roles.power_list` 原样存字符串）。
复现：`[regex]::Matches($u,'permission_code:"([^"]+)"')`（`capture_page.json`，`Cr` 数组，62 条）。

### 3.3 `film` 接口的三条硬约束（与多维表格语义强耦合）

1. **行写入是"整行版本 CAS"**：`PUT .../tasks/:task_id/cells` 请求体
   `{version, cells:[{field_id, value} | {field_id, clear:true}]}`（源脚本 `putCells`）。
   `version` 与 `film_tasks.version` 不等 → **746002 VERSION_CONFLICT**（`api-spec.md:57`，
   现有注释写"Ph3 画布"，本域扩展其适用范围，码不变）。成功 `version+1`。
2. **响应仍用稀疏 map**：API 返回 `cells:{<field_id>: value}`（对齐 `_(e)` 的
   `cells:e.cells&&typeof e.cells=="object"?e.cells:{}`），**内部归一化为 `film_cells` 行**。
   契约面不暴露 `film_cells` 的行结构——这是内外有别，必须写清以免实现方按表结构暴露 API。
3. **`points_ro` 严格只读**：实测源码直接抛错
   `encodeCell:()=>{throw new Error("points_ro is read-only: 积分由画布消耗结算，禁止前端写 cell")}`。
   → 对 `field_type='points_ro'` 的 `value` 写入一律 `400101`（`field=field_id`）；
   该列的值只能由服务端从任务/账本聚合（A14）。

### 3.4 `cam` 端点契约

> 通用列说明：**权限**= §3.2 L3 的 `permission_code`（`—` = 映射缺失，按 §3.2 兜底：登录+成员+`master/admin`）；
> **幂等**：`IK`=`Idempotency-Key` 必填（`api-spec.md:27`），`—`=不要求；
> **限流**：用户级/分钟（未列者用 `api-spec.md:637` 基线 GET 120 / 非 GET 30）。

| 方法 | 路径 | 权限 | 请求 | 响应 | codes | 幂等 | 限流 |
|---|---|---|---|---|---|---|---|
| GET | `/cam/permission/user` | — | — | `{power_list:[{module,action,permission_code}], module_id_list:{module,module_ids[]}, role_id, role_name, role_code, role_level, team_info:{team_id,wsid,team_name,seat,agent_whitelist,team_statistics:{master_wsid_points},current_group_points}}` | 401 | — | 120 |
| GET | `/cam/linked-users` | — | `?sp_id=` | `{list:[{user_id,nick,account,role_code}]}`（A2） | 400101,403101 | — | 120 |
| GET | `/cam/role/list` | `member.edit` | `?team_id=` | `{list:[{role_id,role_code,role_name,role_level,is_system,power_list}]}` | 403101 | — | 120 |
| GET | `/cam/team/temp-info` | — | — | `{api_key_white,is_lingman_wsid,is_sd_discount_black,is_support,name, sd_480p_is_support,sd_is_support,seedance_is_support,tsd_is_support}`（实测原样） | 401 | — | 120 |
| GET | `/cam/team/:team_id/info` | `team.view` | — | `{team_id,name,seat,max_seats,status,agent_whitelist,film_enabled,owner_user_id, member_count,group_count, pool:{balance,frozen}}` | 400102,403101 | — | 120 |
| POST | `/cam/team/:team_id/edit` | `team.edit` | `{name?,max_seats?,agent_whitelist?,film_enabled?}` | `{ok:true}` | 400101,403101 | IK | 20 |
| GET | `/cam/team/:team_id/groups` | `group.view` | `?view=`(tree/flat) | `{list:[{group_id,parent_id,name,leader_user_id,sort,member_count}]}` | 400102,403101 | — | 120 |
| POST | `/cam/team/:team_id/group` | `group.create` | `{name,parent_id?,leader_user_id?}` | `{group_id}` | 400101,403101 | IK | 20 |
| POST | `/cam/team/:team_id/group/:group_id/edit` | `group.edit` | `{name?,parent_id?,leader_user_id?,sort?}` | `{ok:true}` | 400101,400102,403101 | IK | 20 |
| POST | `/cam/team/:team_id/group/:group_id/delete` | `group.delete` | `{reassign_to?}` | `{ok:true,moved_members}` | 400101,400102,403101 | IK | 20 |
| GET | `/cam/team/:team_id/group/:group_id/stats` | — | — | `{member_count,task_count,points_used,points_allocated}`（A2） | 400102,403101 | — | 120 |
| GET | `/cam/team/:team_id/members` | `member.view` | `?role_ids&nick&sp_ids&account&remark&status&page&page_size&group_id&has_group&include_descendants` | 标准分页 `{list:[{user_id,nick,account,role_code,role_level,group_id,status,remark,project_names[],points_allocated}],total,page,page_size}` | 400101,403101 | — | 120 |
| GET | `/cam/team/:team_id/member/:member_id` | `member.view` | — | 单成员同上 | 400102,403101 | — | 120 |
| PUT | `/cam/team/:team_id/member/:member_id` | `member.edit` | `{role_id?,group_id?,status?,remark?}` | `{ok:true}` | 400101,400102,403101 | IK | 20 |
| PUT | `/cam/team/:team_id/member/:member_id/name` | — | `{nickname}` | `{ok:true}` | 400101,400102,403101 | IK | 20 |
| PUT | `/cam/team/:team_id/member/:member_id/password` | `member.edit` | `{password}`（强度校验） | `{ok:true}` | 400101,400102,403101 | IK | 5 |
| GET | `/cam/team/:team_id/member/:member_id/credential` | — | — | `{account, one_time_secret?, expires_at}`（A7） | 400102,403101 | — | 5 |
| POST | `/cam/team/:team_id/member/:member_id/delete` | `member.remove` | `{recover_points?:bool}` | `{ok:true,recovered_points}` | 400101,400102,403101 | IK | 20 |
| POST | `/cam/team/:team_id/member/batch` | `member.create` | `{members:[{account,nickname,role_id?,group_id?}]}`（≤100） | `{created:[{user_id,account}],failed:[{account,code}]}` | 400101,**400108**,403101 | IK | 5 |
| GET | `/cam/team/:team_id/member/export` | `member.download` | 同 members 筛选 | `{file_uri,expires_at}`（CSV/xlsx） | 400101,403101 | — | 3 |
| POST | `/cam/team/member/batch/change-password` | `member.edit` | `{member_ids:[],password}` | `{ok:true,updated}` | 400101,403101 | IK | 5 |
| POST | `/cam/team/member/batch/status` | `member.edit` | `{member_ids:[],status}` | `{ok:true,updated}` | 400101,403101 | IK | 5 |
| POST | `/cam/team/member/change-group` | `group.member_change` | `{member_ids:[],group_id}` | `{ok:true,moved}` | 400101,400102,403101 | IK | 10 |
| GET | `/cam/project/:project_id/members` | `member.edit` ⚠️ | `?project_kind=&page=&page_size=` | 分页 `{list:[{user_id,nick,role_code}]}` | 400102,403101 | — | 120 |
| POST | `/cam/project/:project_id/members/bind` | `project.member` | `{project_kind,user_ids:[]}` | `{ok:true,bound}` | 400101,400102,403101 | IK | 20 |
| POST | `/cam/project/:project_id/members/delete` | `member.edit` | `{project_kind,user_ids:[]}` | `{ok:true,removed}` | 400101,400102,403101 | IK | 20 |
| POST | `/cam/team/points-allocation` | `member.points` | `{target_user_id,amount,memo?}` | `{flow_id,balance_after,target_balance_after}` | **400101**,745701,403101,**746001** | **IK 必填** | 10 |
| POST | `/cam/team/points-recovery` | `member.points` | `{target_user_id,amount,memo?}` | `{flow_id,balance_after,target_balance_after}` | 400101,745701,403101,746001 | **IK 必填** | 10 |
| POST | `/cam/team/batch-points-allocation` | `member.edit` ⚠️ | `{items:[{target_user_id,amount}],memo?}`（≤50） | `{items:[{user_id,ok,code?,flow_id?}],total_allocated}`（**部分成功**，逐项码） | 400101,745701,403101,746001 | **IK 必填** | 5 |
| GET | `/cam/team/points-flow/list` | `team.view` | `?page&page_size&create_time_start&create_time_end&op_type&op_user_name&op_user_account&target_user_name&target_user_account&group_id` | 分页 `{list:[{id,kind,delta,balance_after,op_type,op_user:{id,name,account},target_user:{id,name,account},group_id,memo,created_at}],total,page,page_size}` | 400101,403101 | — | 120 |
| GET | `/cam/team/points-flow/export` | `team.download` | 同上筛选 | `{file_uri,expires_at}` | 400101,403101 | — | 3 |
| GET | `/cam/team/project-points-flow/list` | `team.view` | `?page&page_size&create_time_start&create_time_end&op_user_name&op_user_account` | 分页（按项目维度聚合：`project_id/project_name/points`） | 400101,403101 | — | 120 |
| GET | `/cam/team/project-points-flow/export` | `team.download` | 同上 | `{file_uri,expires_at}` | 400101,403101 | — | 3 |
| POST | `/cam/team/account-points-ranking` | `team.view` | `{create_time_start?,create_time_end?,page?,page_size?}`（A5） | `{list:[{user_id,nick,account,points_used,rank}]}` | 400101,403101 | — | 60 |
| POST | `/cam/team/project-points-ranking` | `team.view` | `{create_time_start?,create_time_end?,page?,page_size?}`（A5） | `{list:[{project_id,project_name,points_used,rank}]}` | 400101,403101 | — | 60 |
| GET | `/cam/user/third/key/list` | — | — | `{list:[{id,provider,label,masked,status,last_used_at}]}`（A6） | 401 | — | 60 |
| POST | `/cam/user/third/key/add` | — | `{provider,label,key}` | `{id,masked}` | 400101 | IK | 10 |
| GET | `/cam/user/third/key/:id/info` | — | — | `{id,provider,label,masked,status}` | 400102 | — | 60 |
| PUT | `/cam/user/third/key/:id/update` | — | `{label?,key?,status?}` | `{ok:true}` | 400101,400102 | IK | 10 |
| DELETE | `/cam/user/third/key/:id/delete` | — | — | `{ok:true}` | 400102 | — | 10 |

**`cam` 响应/责任边界注**：
- 所有列表统一 `data:{list,total,page,page_size}`（`api-spec.md:67`）。
- 所有 ID 字符串化（`api-spec.md:68`）；本草案表里写 `user_id/flow_id` 均为字符串。
- 时间 ISO8601 UTC（`api-spec.md:68`）。
- `POST` 类创建/改状态一律要求 `Idempotency-Key`（`api-spec.md:27`）；资金类（分配/回收/批量分配）
  额外要求**同键同体重放原响应**（`api-spec.md:64`），并在 `idempotency_records` 留痕。

### 3.5 `film` 端点契约

> `film` 的 L4 项目作用域先于一切；下表"权限"列给 **L3 建议码**。因为参照产品对 film
> **没有** permission_code 映射（§1.3），下列码是**本草案提议**，需 Lead 决定是
> (a) 复用 `cam` 的 `storyboard.*`/`project.*` 码，还是 (b) 新增 `film.*` 码族。
> **本草案取 (a) 复用**——理由：不扩码表、且影视版任务表在语义上就是"分镜/任务"的表格视图，
> `storyboard.edit` 已覆盖。此点为【假设 A4】。

| 方法 | 路径（前缀 `/film/projects/:project_id`） | 权限(建议) | 请求 | 响应 | codes | 幂等 | 限流 |
|---|---|---|---|---|---|---|---|
| GET | `/canvases/visible` | `storyboard.view` | `?tab=` | `{list:[{canvas_id,name,cover,created_at}]}` | 400102,403101 | — | 120 |
| GET | `/canvases/:canvas_id/task-bindings` | `storyboard.view` | — | `{list:[{task_id,title,status}]}` | 400102,403101 | — | 120 |
| GET | `/canvases/:canvas_id/task-panel` | `storyboard.view` | — | `{canvas_id,tasks:[...]}`（A8） | 400102,403101 | — | 120 |
| POST | `/canvases/:canvas_id/submit-result` | `storyboard.edit` | `{task_id,version_no,thumb_file_id}`（A8） | `{ok:true}` | 400101,400102,746002 | IK | 20 |
| DELETE | `/canvases/:canvas_id` | `storyboard.delete` | — | `{ok:true}` | 400102,403101 | — | 20 |
| GET | `/task-tables` | `storyboard.view` | — | `{list:[{table_id,project_id,name,is_preset,sort,version}]}` | 400102 | — | 120 |
| POST | `/task-tables` | `storyboard.create` | `{name}` | `{table_id,project_id,name,is_preset,sort,version}` | 400101,400107? | IK | 10 |
| PATCH | `/task-tables/:table_id` | `storyboard.edit` | `{name}` | 同上 | 400101,400102 | IK | 20 |
| DELETE | `/task-tables/:table_id` | `storyboard.delete` | — | `{ok:true}` | 400102 | IK | 10 |
| POST | `/task-tables/:table_id/apply-template` | `storyboard.edit` | `{template_id,replace?}` | `{table_id,fields_created}` | 400101,400102,746002 | IK | 10 |
| POST | `/task-tables/reorder` | `storyboard.edit` | `{table_ids:[]}` | `{ok:true}` | 400101,400102 | IK | 20 |
| POST | `/task-tables/ensure-presets` | `storyboard.edit` | —（form） | `{ok:true,table_ids:[],created}` | 400102 | IK | 5 |
| POST | `/task-tables/import` | `storyboard.edit` | `{file_id,file_name,mode,table_id?,sheet_name?,is_append?}` | `{job_id,status,table_ids:[]}`（A11） | 400101,400102,400104 | IK | 3 |
| GET | `/task-tables/:table_id/fields` | `storyboard.view` | — | `{list:[{field_id,table_id,key,name,field_type,is_system,is_unique_type,sort,config_json?,hidden,width}]}` | 400102 | — | 120 |
| POST | `/task-tables/:table_id/fields` | `storyboard.edit` | `{name,field_type,config_json?}` | 单个 field 对象 | **400101**（类型不在 9 种内 / 唯一类型冲突） | IK | 20 |
| PATCH | `/task-tables/:table_id/fields/:field_id` | `storyboard.edit` | `{name,field_type,config_json?,confirm_clear?}` | 单个 field 对象 | 400101,400102,746002 | IK | 20 |
| DELETE | `/task-tables/:table_id/fields/:field_id` | `storyboard.delete` | — | `{ok:true}`（软删） | 400102 | IK | 20 |
| POST | `/task-tables/:table_id/fields/reorder` | `storyboard.edit` | `{field_ids:[]}` | `{ok:true}` | 400101,400102 | IK | 20 |
| POST | `/task-tables/:table_id/fields/batch-restore` | `storyboard.edit` | `{field_ids:[]}`（≤100/片） | `{restored_field_ids:[]}` | 400101,400102 | IK | 10 |
| GET | `/task-tables/:table_id/pref` | `storyboard.view` | — | `{hidden_field_ids:[],filter:[{field_key,op,value}],ui:{row_height,column_widths,sorts}}` | 400102 | — | 180 |
| PUT | `/task-tables/:table_id/pref` | `storyboard.view` | 同上三键 | 同上（回显归一化后值） | 400101,400102 | IK | 180 |
| GET | `/task-tables/:table_id/tasks/query` | `storyboard.view` | `?page=&page_size=200&filter[]` | `{table,fields:[],tasks:[{task_id,parent_id,sort,version,created_by,cells:{},produce:{canvas_ids:[]},review:{latest_version_no,version_id,thumb_file_id,unread},children[]}],pref,page:{page,page_size,total_main}}` | 400101,400102 | — | 60 |
| POST | `/task-tables/:table_id/tasks` | `storyboard.edit` | `{count:1..100,after_task_id?}` | `{list:[<task>]}` | 400101,400102,**745703**? | IK | 20 |
| POST | `/task-tables/:table_id/tasks/unbound-query` | `storyboard.view` | `{page,page_size}` | `{fields:[],rows:[],page:{...}}` | 400101,400102 | — | 60 |
| POST | `/task-tables/:table_id/tasks/title-matches` | `storyboard.view` | `{title,exclude_task_id?}` | `{list:[{task_id,title}]}`（重名校验） | 400101 | — | 60 |
| POST | `/task-tables/:table_id/tasks/reorder` | `storyboard.edit` | `{task_ids:[]}` | `{ok:true}` | 400101,400102 | IK | 20 |
| POST | `/task-tables/:table_id/tasks/batch-delete` | `storyboard.delete` | `{task_ids:[]}`（≤100/片） | `{deleted_task_ids:[]}` | 400101,400102 | IK | 10 |
| POST | `/task-tables/:table_id/tasks/batch-restore` | `storyboard.edit` | `{task_ids:[]}`（≤100/片） | `{restored_task_ids:[]}` | 400101,400102 | IK | 10 |
| DELETE | `/task-tables/:table_id/tasks/:task_id` | `storyboard.delete` | —（form） | `{ok:true}` | 400102 | IK | 20 |
| PUT | `/task-tables/:table_id/tasks/:task_id/cells` | `storyboard.edit` | `{version,client_id?,cells:[{field_id,value}\|{field_id,clear:true}]}` | `<task>`（新 `version`） | 400101,400102,**746002**,**400105**? | IK | 240 |
| POST | `/task-tables/:table_id/tasks/:task_id/children` | `storyboard.edit` | —（form） | `<task>`（子行） | 400101,400102 | IK | 20 |
| POST | `/task-tables/:table_id/tasks/:task_id/status` | `storyboard.edit` | `{status}`（5 值枚举） | `{status}` | 400101,400102 | IK | 60 |
| POST | `/task-tables/:table_id/tasks/:task_id/notify-assignees` | `storyboard.edit` | `{op_user_ids:[]}` | `{ok:true,notified}` | 400101,400102,429100 | IK | 5 |
| GET | `/task-tables/:table_id/tasks/:task_id/canvas-bindings` | `storyboard.view` | — | `{canvas_ids:[]}` | 400102 | — | 120 |
| POST | `…/canvas-bindings` | `storyboard.edit` | `{canvas_ids:[]}` | `{canvas_ids:[]}` | 400101,400102,746002 | IK | 20 |
| PUT | `…/canvas-bindings` | `storyboard.edit` | `{canvas_ids:[]}`（全量替换） | `{canvas_ids:[]}` | 400101,400102,746002 | IK | 20 |
| DELETE | `…/canvas-bindings` | `storyboard.edit` | `{canvas_ids:[]}` | `{canvas_ids:[]}` | 400101,400102 | IK | 20 |
| GET | `/task-tables/:table_id/tasks/:task_id/review` | `storyboard.view` | — | `{task_id,latest_version_no,version_id,thumb_file_id,unread,versions:[{version_no,status,submitted_by,submitted_at}]}` | 400102 | — | 120 |
| POST | `/task-tables/:table_id/tasks/:task_id/review/comments` | `storyboard.edit` | `{body,mentions?:[],review_id?}` | `{comment_id}` | 400101,400102,745801 | IK | 30 |
| POST | `/task-tables/:table_id/tasks/:task_id/review/read` | `storyboard.view` | —（form） | `{ok:true}` | 400102 | IK | 120 |
| GET | `/task-templates` | `storyboard.view` | `?scope=` | `{list:[{template_id,name,scope,owner_id,payload?}]}` | 400102 | — | 120 |
| POST | `/task-templates` | `storyboard.edit` | `{name,scope,payload}` | `{template_id}` | 400101,400102 | IK | 20 |
| DELETE | `/task-templates/:template_id` | `storyboard.delete` | —（form） | `{ok:true}` | 400102,403101 | IK | 20 |
| GET | `/exports` | `project.export` | — | `{list:[{export_id,status,format,file_uri?,expires_at?,created_at}]}` | 400102 | — | 120 |
| POST | `/exports` | `project.export` | `{table_ids:[],format?}` | `{export_id,status}` | 400101,400102,**400106** | IK | 3 |
| GET | `/recent-open` | `storyboard.view` | — | `{list:[{project_id,table_id,opened_at}]}` | — | — | 180 |
| POST | `/recent-open` | `storyboard.view` | `{table_id?}` | `{ok:true}` | 400101 | IK | 180 |
| GET | `/tasks/stats` | `storyboard.view` | — | `{not_started,in_progress,pending_review,rejected,done, total,by_assignee:[...]}` | 400102 | — | 60 |

**状态枚举（实测，直接落 `film_tasks.status` smallint）**：
`1 not_started`(未开始) / `2 in_progress`(制作中) / `3 pending_review`(提交审核) /
`4 rejected`(驳回修改) / `5 done`(定稿完成)。
依据：源脚本 `D7aUDXP7.js`
`G=["not_started","in_progress","pending_review","rejected","done"]`，
中文映射 `ht={not_started:"未开始",in_progress:"制作中",pending_review:"提交审核",rejected:"驳回修改",done:"定稿完成"}`。
另有两个派生集合：`_t=["not_started","in_progress"]`（可编辑态）、
`gt=new Set(G)`（合法全集）——契约里 `POST .../status` 必须用 `gt` 校验，非法值 `400101`。

**过滤算子（实测，`pref.filter[].op` 与 `tasks/query` 的 filter 共用）**：
`eq / neq / contains / notContains / empty / notEmpty`（文本、链接、状态、人员）；
`date` 额外 `lt / gt / lte / gte`（映射为"早于/晚于"）；
`points_ro` 额外 `gt / lt / gte / lte`（数值比较）。
超出算子集 → `400101`（`field="filter[i].op"`）。

### 3.6 待新增错误码（**仅 1 个**，其余复用）

| 段 | 码 | 名称 | 语义 | 为什么必须新增 |
|---|---|---|---|---|
| 4001xx | **400108** | `TEAM_SEAT_EXCEEDED` | 团队席位数已达 `spaces.max_seats` 上限（创建/邀请成员时） | 现有 4001xx 无容量类码：400101「参数越界」语义是**入参**错，而这里是**资源容量**状态，前端文案与引导完全不同（引导"升级席位"而非"改参数"）。放 4001xx 而非 7457xx，因为它不是计费余额问题 |

**明确「不新增」的（复用既有码，逐一给理由）**：

| 场景 | 复用 | 理由 |
|---|---|---|
| 团队/空间越权、非成员、角色不足、项目作用域拒绝 | `403101` + `data.reason` | 码表已覆盖越权（`api-spec.md:46`）；4 种情形用 reason 区分 |
| 跨 space 访问资源 | `400102` | 既有口径统一"不存在"，不泄露存在性（`api-spec.md:407,414`） |
| 字段类型非法 / 唯一类型冲突 / 过滤算子非法 / points_ro 写入 | `400101` + `field` | 参数校验语义已覆盖 |
| 行版本 CAS 冲突、表版本冲突、绑定并发 | `746002` | 码表已有 VERSION_CONFLICT（`api-spec.md:57`）；本域**扩展适用范围**，码不改 |
| 幂等重放 | `746001` | `api-spec.md:56` |
| 分配/回收超出团队池余额 | `745701` | 语义即余额不足（`api-spec.md:49`）；团队池就是 space 余额 |
| 回收超出成员可用余额 | `400101` + `details{field:"amount",available}` | 不是"余额不足"（会员自己没在付款动作里），属参数越界 |
| 导出任务行不完整（<80%） | `400106` | `api-spec.md:42` |
| 导入文件过大/超 5 万字 | `400104` | `api-spec.md:40` |
| 批量通知触顶 | `429100` + `Retry-After` | `api-spec.md:47` |
| 评论命中内容安全 | `745801` | `api-spec.md:52` |

> 若 Lead 要求 **零新码**：把 400108 降级为 `400101` + `details{field:"max_seats",max_seats}`。
> 本草案推荐保留 400108，因为前端需要区分"改参数"与"买席位"两条引导路径。

---

## 4. 与 billing 的接口（团队积分池）

### 4.1 唯一账本与口径（不新建表、不新建账本）

- **团队积分池 ≡ 该团队 space 的 `credit_accounts.balance`**（`database.md:287-291`）。
  RE 的 `team_credit_total` 映射到这里，**不是一个新字段**。
- **分配** = 团队 space → 成员个人 space 的**真实转账**，两条流水一个事务；
  **回收** = 反向。团队内部消耗走既有 `freeze`/`settle` 两阶段（`database.md:307-315`、
  `ledger.ts:54-133`），**完全不变**。
- 全库不变式保持不变：`balance == Σdelta` 且 `frozen == Σ frozen_delta`（`database.md:321`）。

### 4.2 `credit_flows.kind` 枚举扩展（4 个，**必须成对**）

现有 kind：`recharge|gift|freeze|settle|unfreeze|adjust|refund`（`database.md:297`、
`schema.ts:145`）。新增 4 个：

| kind | 记账在哪个 space | delta | frozen_delta | 配对 |
|---|---|---|---|---|
| `team_allocate_out` | 团队 space | **−X** | 0 | 与 `team_allocate_in` 同事务 |
| `team_allocate_in` | 成员个人 space | **+X** | 0 | 同上 |
| `team_recover_out` | 成员个人 space | **−X** | 0 | 与 `team_recover_in` 同事务 |
| `team_recover_in` | 团队 space | **+X** | 0 | 同上 |

**对账影响（必须写进 `security §3` / `testing §2-1` 的同文段落）**：

1. `Σ_all_spaces delta` 对上述每一对恒为 **0** → **全系统总积分守恒**（新增一条对账断言：
   `SUM(credit_accounts.balance) == SUM(credit_flows.delta)` 跨 space 成立）；
2. 单 space 的 `balance == Σdelta` **不受影响**（每笔 delta 都已落到各自 space）；
3. 新增两条"孤儿检测"巡检 SQL（必须进每日对账，`database.md:522` 已要求每日核对）：
   - `team_allocate_out` 无对应 `team_allocate_in`（以 `ref_space_id + delta 相反 + 同事务时间窗`匹配）；
   - `team_recover_out` 无对应 `team_recover_in`；
4. `points-flow/list` **不需要新查询引擎**：它就是
   `SELECT ... FROM credit_flows WHERE (space_id = :team_space OR ref_space_id = :team_space) AND kind IN (...)`
   的过滤视图（新索引 `idx_flows_space_kind` 支撑）。

**成对写入的并发约束**（写进实现约束，与 `billing.service.ts:425` 的 `lockCreditAccount` 一致）：
一个事务内按 `space_id` **升序**依次 `SELECT ... FOR UPDATE` 锁两个账户，避免 A↔B 与 B↔A 死锁；
任一账户 `balance < X` 立即抛 `745701` 并整体回滚（不留半笔）。

### 4.3 `credits_quota` 的语义（配额但**不是余额**）

`space_members.credits_quota`（既有列，`database.md:82`）定义为：

```
outstanding(member) = Σ(该成员 space 上 team_allocate_in 的 delta)
                    + Σ(该成员 space 上 team_recover_out 的 delta)   -- 注意 recover_out 是负值
约束：outstanding(member) ≤ space_members.credits_quota
```
- 它**不落任何余额字段**，每次分配时聚合计算（走新索引），因此**不构成第二本账**；
- 若为性能担心：允许加 Redis 缓存作为**只读加速**，但**禁止**把它当作权威余额
  （写入路径仍必须回表聚合/校验）；
- `0` 的语义：`credits_quota = 0` 时按"不限额"处理（避免历史数据把所有人锁死）——这条要
  在正式契约写明，否则存量 0 值会全量拒绝分配。【假设 A5-adjacent】

### 4.4 与 `billing` 模块的边界

| 动作 | 归属模块 | 说明 |
|---|---|---|
| 充值/退款/订单 | `billing`（既有） | 不动 |
| 团队池余额读取 | `billing` 只读接口 | `cam` 不直查 `credit_accounts`（`system-design.md:55`） |
| 分配/回收的转账原语 | **`billing` 新增内部方法** `transferBetweenSpaces(tx,{from,to,amount,kindPair,ref})` | `cam` 只调它，不自己拼流水 |
| 消耗（freeze/settle） | `tasks`/`generations`（既有） | 完全不动 |

> 这一条是对 `system-design.md:44-55` 的**最小必要扩展**：`billing` 新增一个内部转账方法，
> 依赖方向仍是 `cam → billing`（单向），不引入回环。

### 4.5 消费主体与 `X-Space-Id` 的关系（必须讲清）

参照产品的成员在团队 space 下工作（`X-Space-Id` = 团队 space），此时消耗直接用**团队池**
（freeze→settle 落在团队 space）。而"分配"把额度**转移**到成员个人 space。
两者并存，语义分别是：
- **未分配**：团队池直接承担消耗（无需分配即可干活）；
- **已分配**：额度已转到个人 space，消耗发生在个人 space。

这与 RE 的 `team_credit_total`（团队池）+ `team_assigned_val`（已分配）双视图吻合。
但"RE 究竟是转账还是仅圈额"**未被取证** → 见 §7 A5。若取证结果是"仅圈额、余额从不搬动"，
则本设计的 4 个 kind 应退化为 2 个「圈额/解圈」kind（**且必须另设限额视图，绝不新增余额列**），
切换点只在 `ledger` 的内部方法，契约面（端点/字段）不变——这是有意留的适配缝。

---

## 5. 接入点与迁移顺序

### 5.1 依赖方向（补 `system-design.md:42-53`）

| 模块 | 可依赖 | 禁止依赖 | 本草案新增的内部接口 |
|---|---|---|---|
| `cam` | `spaces`(核心)、`billing`(转账)、`auth` | `canvas`/`film`/`script` **业务表** | ← `permission.resolve(space_id,user_id) → {role_code,role_level,permission_codes,module_scopes}` |
| `film` | `tasks`(建任务/读状态)、`assets`、`canvas`(绑定)、`cam`(成员/权限)、`files` | `storyboards`（影视版任务表与分镜表**不混用**） | ← `film.project.assertExists(space_id,project_id)`（供 `cam` 的 `team_member_projects` 校验） |

**铁律复述**（`f1-domain-contract-overview.md:80`）：`film` 要以 `tasks` 建任务时**不得直写 `tasks` 表**，
走 `tasks` 模块 service。本草案的 `film_cells.points_ro` 也只读聚合，不写账本。

### 5.2 迁移顺序（既有 0000~0012，下一号 0013）

实际迁移现状（`app/apps/api/drizzle/`，`meta/_journal.json` 13 条）：
`0000…0012_left_deathbird.sql`（最新 `0012` 只给 `storyboards` 加 `first_frame_uri/last_frame_uri`）。

| 顺序 | 迁移 | 内容 | 依赖 |
|---|---|---|---|
| 0013 | `canvas`（他人负责） | `canvases`/`canvas_nodes`/… | 既有 `spaces`/`tasks`/`assets` |
| 0014 | `agent`（他人负责） | `agent_*` | 0013 |
| **0015** | **`0015_cam_team.sql`**（本草案） | 4 新表 + `ALTER spaces` / `ALTER space_members` / `ALTER credit_flows` | 仅 `spaces`/`users`/`credit_flows` |
| **0016** | **`0016_film_core.sql`**（本草案） | `film_projects`/`film_task_tables`/`film_fields`/`film_tasks`/`film_cells`/`film_table_prefs` | 0013(`canvases`)、`assets` |
| **0017** | **`0017_film_review_ops.sql`**（建议拆分） | `film_task_reviews`/`film_review_comments`/`film_review_reads`/`film_canvas_bindings`/`film_task_templates`/`film_exports`/`film_recent_opens` + 复查约束 | 0016 |

> 拆 0016/0017 的理由：0016 是**被高频读写**的核心表（改错代价高），0017 是配角表；
> 分两笔便于 staging 演练与回滚（`database.md:542` 要求 PR 附回滚 SQL）。
> 若 Lead 要与总纲 `film(0016)` 单号对齐，合并成一笔也可，本草案的 DDL 无跨笔依赖问题。

### 5.3 前向外键与执行顺序（严格按 `database.md:13` 的做法）

1. `ALTER TABLE` 一律**在目标表建好之后**执行，禁止按文件从上到下直跑；
2. 本草案的跨表指针只有两处需要延后：
   - `film_canvas_bindings.canvas_id → canvases(id)`：`canvases` 在 0013，本域 0016/0017 在其后 → **可直接内联 FK**，无需 ALTER；
   - `film_projects.source_script_project_id → script_projects(id)`：`script_projects` 在 0001 已建 → 可直接内联；
3. **故意不加的外键**（写进 migrate 注释，防后人误加）：
   - `team_member_projects.project_id`：**不建 FK**（cam 不得依赖 film/script 业务表，见 §2.2③）；
   - `film_tasks.parent_id`：**自引用 FK 保留**，但删除走软删（`deleted_at`），物理删除由清理任务按"子行先删"顺序执行；
4. 回填：`spaces.agent_whitelist/film_enabled/max_seats` 有默认值，存量行零回填；
   `space_members.role_code` 为 NULL 时按 `role` 兜底映射（1→`master`，2→`admin`，3→`project_executor`），
   建议在 0015 里直接用一条 `UPDATE` 完成（幂等：`WHERE role_code IS NULL`）。

### 5.4 接入点（按调用链，给"先做哪一步"）

| 序 | 接入点 | 文件/位置 | 说明 |
|---|---|---|---|
| 1 | `billing.transferBetweenSpaces()` | `app/apps/api/src/modules/billing/billing.service.ts`（对照 `:425` 的锁账户写法） | 转账原语；先写单测覆盖"成对+守恒+并发死锁序" |
| 2 | `cam` 鉴权守卫 | 新 `app/apps/api/src/modules/cam/`，对照既有 `common/auth.types.ts` | L1~L4 闸门；`403101` + reason |
| 3 | `cam` 表落地 | `app/packages/db/src/schema.ts`（对照 `:63-89` 的 `spaces`/`spaceMembers` 写法）+ 0015 | drizzle schema 为结构源（`database.md:541`） |
| 4 | `film` 权限复用 | 调 `cam.permission.resolve` | film 不自建权限表 |
| 5 | `film` 表 + 端点 | `app/packages/db/src/schema.ts` + 0016/0017 | 先 `task-tables`/`fields`/`tasks`/`cells`，再 review/export |
| 6 | `tasks` 建任务桥 | `film` → `tasks` service | `canvas-bindings`/`submit-result` 才真正建任务（A8） |
| 7 | 前端 `func-whitelist` 对齐 | 复用 `GET /func-whitelist?scene=ai_film` | 与 `spaces.film_enabled` 同源 |

---

## 6. 与"1:1 复刻"的边界（本域特别声明）

1. **端点名对齐、协议自研**：路径按 RE 命名（便于覆盖核对），但
   - 不带 RE 的 `client_id`/`session_id`/`wsid`/`t1`/`t2` 等内部协同参数进公开契约
     （`client_id` 只在 `PUT cells` 作为可选的**回声抑制**提示，且服务端可忽略）；
   - 不用 RE 的 `{code,msg,data}` 之外的信封差异——我方信封一致（`api-spec.md:13-18`）；
   - 不用 RE 的 `X-Prod-Id`/`X-Module-Action`/`X-Op-User-Id` 内部头（`RM:172`）；
     我方统一 `Authorization: Bearer` + `X-Space-Id`（`api-spec.md:24-25`）。
2. **`team_id` ≡ `space_id`、`wsid` ≡ `user_id`、`member_id` ≡ `user_id`** 三个映射必须写进契约，
   否则前端会把它们当成 4 个不同 ID（`f1-domain-contract-overview.md:49` 已提同样的坑）。
3. **不复刻前端"状态快照字段"**：RE 的 `cells` 里塞 `snapshot`/`parsePaste` 这类纯前端逻辑
   （`D7aUDXP7.js` 的 `snapshot:`/`parsePaste:`）不进后端契约，只作为**值编码约定**参考。

---

## 7. 未取证 / 假设清单（**不得当事实使用**）

> 处理原则沿用总纲 §5：能推断就给**保守方案 + 标注假设**；不能推断就留 `TODO(取证)` 且
> "不实现不阻塞"。

| # | 项 | 现状（证据） | 为什么是假设 | 本草案的保守方案 |
|---|---|---|---|---|
| **A1** | **`film` 字段类型系统的服务端契约** | `RM:245` 明确列为 unknown。本次在客户端 bundle（`D7aUDXP7.js`，`capture-canvas.json`）补到**枚举 9 种** + 每种的 `encodeCell/decodeCell/filterOps/defaultWidth/isUnique` 实现；但 `config_json` 的 schema、服务端校验强度、唯一性执行位置**仍无证据** | 客户端实现 ≠ 服务端契约；`config_json` 完全是黑盒 | **只实现 9 种已观测类型**：`text / asset_ref / link / user / date / canvas_ref / task_status / review_ref / points_ro`（其中 `points_ro` 只读、系统占位，用户可建的 8 种）。`config_json` 存 JSONB 但**服务端不做语义校验**（只做类型白名单 + 长度上限），并把"未知 config 字段原样透传"写进契约以避免前端假设崩塌。**⚠️ `is_unique_type` 的实测语义是"该 field_type 每表至多一个"，不是"值唯一"**（`_e/dn` 函数），实现若按"值唯一"做会直接错 |
| **A2** | `cam` 9 条端点无 permission_code 映射；`#24/#29` 映射与语义不符 | route→perm 表 156 条，缺失项已列举（§1.2 注） | 可缺失 ≠ 免鉴权；映射本身是客户端实现 | 缺失项一律「登录 + 空间成员 + `master/admin` 或对应子系统管理员」兜底；`#24` 按 `member.view` 实现（记录 RE 原值 `member.edit` 作为差异项，待 Lead 决断是否照抄） |
| **A3** | `film` **审核决策流**（谁批准/驳回、如何落状态） | `routes.txt` 全量无 `film/*review/approve\|reject`；只有 `review`(GET)、`review/comments`(POST)、`review/read`(POST)；**`review_ref` 字段类型存在但无写端点** | 决策可能走 `POST .../status` + `review` 侧写，也可能在别的前端路径 | 本草案**不给审核决策端点**（不臆造），`film_task_reviews.status` 定义为 3 值但标注"枚举与写入路径均待取证"；`review` GET 只读返回版本链 |
| **A4** | `film` 的 L3 权限码选型 | RE 对 film **零** permission_code 映射，改用 `func-whitelist?scene=ai_film` 把关 | 无证据表明 film 复用 `storyboard.*` | 建议复用 `storyboard.view/edit/delete` + `project.export`；若 Lead 决定新建 `film.*` 码族，需同步扩 §3.2 的 62 码表 |
| **A5** | `points-allocation` 是**转账**还是**仅圈额** | `RM:181` 只说"团队配额分配与回收"；`team_assigned_val`/`team_credit_total` 双字段存在（`api-log-decoded.txt` 的 `user/credits`） | 无法从端点名判断余额是否搬动 | 取**转账**（§4.2，4 个 kind），并留 §4.5 的退化缝（2 个 kind + 限额视图），契约面不变 |
| **A6** | `cam/user/third/key/*`（5 端点的 body/语义） | 仅知路径与 `byok` 相关（`RM` 无专门章节） | 疑为 BYOK 雏形，字段未知 | 落 `user_third_keys` 最小面（provider/label/密文/状态），**路由仅在 `cam` 域内**、不改 `models` 计费链；不实现不阻塞 |
| **A7** | `cam/team/:team_id/member/:member_id/credential` 语义 | 仅知路径 | 可能是"下发初始密码/一次性登录链接"，也可能是"读取当前凭据" | 定义为**一次性发放**（`one_time_secret` + `expires_at`，不落库明文），一次有效 |
| **A8** | `film` 的 `canvas_id` 与 `canvas` 域的关系、`submit-result`/`task-panel` 语义 | 端点存在；`produce.canvas_ids` 字段名实测；`DELETE /canvases/:canvas_id` 也存在（说明 film 可"移除"画布，不一定是删画布本体） | 语义可能是"解绑"而非"删除画布" | `DELETE` 实现为**解绑**（删 `film_canvas_bindings`），**绝不删 `canvases` 行**；`submit-result` 定义为"把画布产物回填为该行的 review 版本"（待取证） |
| **A9** | `film` WebSocket 协同帧协议 | 只拿到 URL 模板与 channel 命名 `film_table_{wsid}_{tableId}`（`D9zvpvCB.js`） | 帧格式、消息类型全未知 | **不进本期契约**：HTTP 写接口为权威，WS 仅作可选广播；服务端先只做 `client_id` 回声抑制字段（可忽略） |
| **A10** | `task-templates` 的 `scope` 与模板体结构 | `?scope=` 查询参数存在；`payload` 结构完全未知 | 无任何模板样本 | `scope` 取 1个人/2团队；`payload` 存 JSONB 但**不做 schema 校验**，只做大小上限与"可被 apply-template 消费"的自洽校验 |
| **A11** | `task-tables/import` 的 job 生命周期 | 响应 `{job_id,status,table_ids[]}` 实测；**轮询端点未在 routes 中出现** | 导入是异步的，但状态查询入口未知 | 返回 `job_id` + `status`，并约定用**既有** `GET /tasks/{id}` 风格另开 `GET /film/imports/{job_id}`；若 Lead 不允许新增端点，则退化为**同步导入**（上限 2000 行）并标注性能风险 |
| **A12** | `film` 导出的产物格式与异步形态 | `exports` GET/POST 存在 | 格式（xlsx/csv/zip）、是否异步未知 | 默认 `xlsx` 异步（`status` 4 值沿用 `database.md:282`），`file_uri` 7 天清理（`database.md:532`） |
| **A13** | 团队 `seat` 上限来源 | `team_info.seat` 实测；定价页有 `team_seat` 与 `dyn:"members"` | 是订阅档位、还是独立配额字段，未知 | `spaces.max_seats` 独立列，默认 5；订阅到期不改列，由 `billing` 在续费/降级时写回 |
| **A14** | `points_ro` 的结算口径（行级 points 从哪来） | 源码只说明"由画布消耗结算"并禁止前端写 | 哪一层结算、是否含未成功任务，未知 | 定义**只读聚合**：该行绑定的 `canvas_ids` 下所有任务的 `credit_flows` 之和（只统计 `settle` 已结算的），**不落列、不缓存**；返回 `null` 表示未结算（不返回假 0，对齐 `api-spec.md:103` 的"不得静默返回假 0"） |
| **A15** | `review/read` 的语义 | 端点存在，`form` 编码 | 是"审核已读回执"还是"标记该行评论已读"，未知 | 落 `film_review_reads.last_read_version_no` + `read_at`，按"读到第几版"建模（可同时满足两种解释） |

**另外 3 条"取证方法已定但本轮未做"的（不计入 15 项，供 F2 前置）**：
1. 用真实登录态请求 `cam/permission/user`，采集 `power_list` 真实长度与 `module_id_list` 真实形状；
2. 用真实团队调用 `cam/team/points-allocation` 一次，观测响应体与 `credit_flows` 落库形态（A5 一次定案）；
3. 影视版需要 `film_enabled` 白名单账号才能进——**取证阻塞在账号权限上**（需 Owner 提供企业/影视版权限），这是本轮 15 项里**唯一有外部阻塞**的子项。

---

## 8. 覆盖率自查

| 检查项 | 结果 |
|---|---|
| `cam` 端点覆盖 | 39/39 路径（40/40 操作）全部进 §3.4 ✅ |
| `film` 端点覆盖 | 37/37 路径（48/48 操作）全部进 §3.5 ✅ |
| 表覆盖 vs 端点需求 | `cam` 39 端点 → 4 新表 + 3 扩展；`film` 37 端点 → 13 新表。无"端点无表"、无"表无端点" |
| 错误码 | 复用 12 类既有码；新增 1 个（400108）已单列 ✅ |
| 幂等 | 所有 POST/PUT/PATCH/DELETE 标 `IK`（`api-spec.md:27`）✅ |
| 分页 | 所有列表端点统一 `page/page_size → {list,total,page,page_size}`（`api-spec.md:67`）✅ |
| ID/时间 | 全部字符串化雪花 + ISO8601 UTC（`api-spec.md:68`）✅ |
| 限流 | 每端点给值，未列者回落基线（`api-spec.md:637`）✅ |
| 假设 | 15 项全部带"证据 / 为什么是假设 / 保守方案"三要素 ✅ |
