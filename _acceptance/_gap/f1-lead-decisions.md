# F1 裁决记录（Lead，2026-10-26）

> 契约草案 A（`contract-draft-canvas-agent.md`）抛出 3 个必须由 Lead 拍的裁决点；B（`contract-draft-cam-film.md`）待交付后追加。
> 裁决依据：①是否符合既有 ADR/不变式；②是否破坏"1:1 覆盖核对"能力；③是否引入不可逆成本。

---

## 裁决 D1｜路径归一：`canvas-tpls` / `templates` / `canvas/:id/tpls` 三族是否合并

**结论：不合并，保留参照原形三族并列。**

| 方案 | 判断 |
|---|---|
| 合并为 `/canvas-templates` | ❌ 否决 |
| 保留三族 | ✅ 采用 |

**理由（按权重）**：
1. **覆盖核对优先**：本次目标是"全站 1:1"，覆盖核对靠"端点名逐条对上"。合并后 routes.txt 里 8 条模板端点会失去一一对应关系，未来做进度核对时要靠人工映射表，而映射表一定会腐坏。
2. **三族本身语义不同**（草案 §1.1 C2 已列）：`canvas-tpls`(2) 是**整画布模板库**；`canvas/:id/tpls`(2) 是**画布内实例化模板**；`templates/personal`(2) + `templates/:id/sync-team`(1) + `groups/:id/templates`(2) 是**个人模板与团队同步**。合并会把"模板库/实例/团队同步"三种生命周期压成一个资源，反而更难实现。
3. **代价可接受**：命名不优雅，但 API 路径不是给用户看的（前端有封装层），而为对账保留可追溯性价值更高。

**附带要求**：契约正文必须为三族各写一句"边界说明"，避免实现时把三者混成一个 controller 方法。

---

## 裁决 D2｜canvas 独有 mode（crop/panorama/story_grid/de_subtitle/frame_capture…）如何承载

**结论：采用草案建议 ② —— 走 `options.sub_mode`，不扩 `tasks.mode` 枚举。**

**理由**：
1. **计价维度不可污染**：`model_prices` 按 `(model_id, mode, resolution, duration_s)` 定价（`database.md:161-173`）。每加一个 mode 都要给所有相关模型补价行，而 crop/panorama 这类是**同一能力的参数变体**，不该有独立价目。
2. **`mode` 是跨端共识的粗粒度**：`api-spec.md` §5 generations 的 mode 枚举是前端模型选择器、供应商适配器路由、计价三者共用的键。扩大它 = 三处同时改，且历史任务数据的 mode 语义漂移。
3. **`scene` 已经证明这套模式可行**：现有 `scene=storyboard_reference_video` 就是"同 mode 不同场景"的成熟先例（`database.md:194`）。

**约束（必须写进契约）**：
- `options.sub_mode` 必须在所选模型的 `modes.<mode>.sub_modes` 白名单内，否则 **400101**（附 field）；
- 供应商适配器**不得**读 `sub_mode` 做路由决策，只做参数转换——否则适配器要跟着画布演进；
- 若将来某个 sub_mode 确实需要独立定价，再单独立 mode 并补价，**不在本次一次性展开**。

**遗留**：`video_upscale` 在现有 `api-spec` 里已是独立 mode（`api-spec.md:252` 提到 `video_edit → 400101`，说明 mode 边界已存在争议）。本次不动既有 mode，只在 canvas 域新增的变体走 sub_mode。

---

## 裁决 D3｜`agent-skills`（8 条）归属

**结论：归 `ops` 域（配置/内容运营），不归 `canvas`/`agent` 域。**

**理由**：
1. **它是内容而非能力**：`agent-recommend-cards` + `agent-skills`（含 plaza/favorite/mine/details）= 推荐卡与技能卡**内容库**，其生命周期是运营侧上下架，不是用户创作过程。
2. **与现有 `ops` 语义一致**：`ops` 域现有职责是"配置中心/AB/公告/后台"（`system-design.md:53`），技能卡属于同类。
3. **归 canvas 会制造反向依赖**：技能卡要被 canvas、agent、甚至未来首页共用；挂在 canvas 下会让 agent 依赖 canvas 才能读技能卡。

**实现要求**：
- 表落 `agent_skills` / `agent_skill_favorites`（沿用草案 §2 DDL，但迁移归到 ops 批次）；
- 读接口公开（登录即可），写接口仅 admin（复用 `/ops/admin/*` 的 AdminGuard，见 `admin.controller.ts:40-156`）；
- **`agent-skills` 的 8 条端点不计入 canvas 域覆盖率**，改计入 ops 域（需同步修正本文 §0 与契约正文的归属表）。

> ⚠️ 连带影响：A 草案把 canvas 记为 81 条，其中含 agent-skills 8 条。裁决后 **canvas 本体 = 73 条，ops 增 8 条**。这个数字必须写进最终契约，否则覆盖率分母会错。

---

## 裁决 D4｜`GET /df/canvas/canvas-scaffold`（契约盲区）

**结论：登记为待取证项，本次**不**为它设计契约，也不实现。**

- 事实：运行时实发（HTTP 400）但 routes.txt 与 bundle 均无（草案 G-01）。
- 处置：写入契约的「待取证清单」，并加一条**取证方法**（登录态下用 CDP 抓该请求的完整 request/response）。
- 理由：为"可能不存在的端点"设计契约 = 凭空造 API，比留空更危险。

---

## 裁决 D5｜错误码：接受 2 条新增，但改语义边界

| 码 | 草案建议 | Lead 裁决 |
|---|---|---|
| 746004 `STREAM_CURSOR_EXPIRED` | SSE 游标失效 | ✅ **接受**，落 7460xx（并发/状态族）。理由：游标不是资源，不能复用 400102；前端必须能区分"会话没了"与"游标过期" |
| 746005 `AGENT_TURN_IN_FLIGHT` | 同会话有在途轮次 | ✅ **接受**，但**定义收窄**：仅当客户端显式要求"同步等待本轮结束"时返回；默认语义为**排队**（新消息入队，200 返回 queued），不返回该码 |

**收窄理由**：如果默认就报"在途"错误，用户体验是"我打字发不出去"；参照产品用 HITL（`hitl_required` 事件，草案 §4.4 已逆出）本质上也是"排队 + 交互"语义。故默认排队，仅在显式 `?wait=1` 时用 746005。

---

## 待 B 草案交付后补充

- cam 的 `role` 三层是否与 `space_members.role`（1owner/2admin/3member）兼容
- film 的字段类型系统（RE unknown）保守方案是否可接受
- 团队积分池的配对记账 kind 是否足够（`team_allocate_out/in` + `team_recover_out/in`）

---

## 裁决对契约正文的连带修改清单

| # | 修改 | 影响文件 |
|---|---|---|
| 1 | `agent-skills` 8 条从 canvas 域移到 ops 域 → canvas 本体 73 条 | 契约正文、覆盖率表 |
| 2 | 模板三族各加"边界说明" | api-spec §canvas-templates |
| 3 | `options.sub_mode` 白名单校验 + 400101 + 适配器不得路由 | api-spec §generations、system-design §4.1 |
| 4 | 746004 新增、746005 收窄为 `?wait=1` 语义 | api-spec §1 码表 |
| 5 | `canvas-scaffold` 入待取证清单（不设计契约） | 契约 §6 待取证 |
| 6 | SSE 事件表：只有 6 个已见字面量是事实，其余标假设 | 契约 §4.4 / §6.2 |
