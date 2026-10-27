# OneFrame 补齐计划（以竞品为 100% 基线）

> 编制日期：2026-10-27 · 配套文档：[implement-progress-vs-reelmate.md](implement-progress-vs-reelmate.md)（进度基线）· [reelmate-feature-map.md](../01-product/reelmate-feature-map.md)（竞品基准）
> 目标：把 28 模块实现进度从 **35.4%**（首发口径 54.4%）推进到**尽量接近 100%**
> 执行标准：ADR-013「竞品怎么做我们就怎么做」——已取证即照做，未取证不臆造、登记待取证

---

## 0. 本计划的三个前提（先对齐，否则会反复返工）

### 0.1 「100%」的定义

**100% = 竞品 28 个模块的端点与交互逐条有对应实现**，不是"功能看起来差不多"。

判定用三条硬标准（缺一不算完成）：

| 标准 | 内容 |
|---|---|
| **端点** | 竞品该域每条端点在我方有对应端点，语义/参数/状态码可逐条对上（协议自研，行为对齐） |
| **界面** | 竞品该页面在我方有可用页面，关键交互步数一致（含"看着绕"的两步式、下载单等） |
| **证据** | 有单测或 E2E 覆盖，且 PR 描述写了参照证据（`文件:行` 或抓包 transaction） |

**不允许用"我方更简洁"合并或简化**（ADR-013 决策 1）。允许的偏离只有两类：与既有 ADR 冲突、或照做有安全/正确性风险，且必须写进 `api-spec` 的偏离说明。

### 0.2 批次划分原则

不按"权重从大到小"，按**依赖顺序 + 能否并行**：

```
第 0 批（前置）     数据层 + 共享 schema + 目录     ← 所有后续批次的地基
第 1 批（质量）     资产主体 + 抽取 + 匹配           ← 决定出片一致性
第 2 批（内容）     小说改编链                       ← 决定产品定位
第 3 批（能力）     工具箱补全 + 后处理族            ← 决定单点竞争力
第 4 批（入口）     Agent 收口 + ReelFlow 页面       ← 决定人机交互完整度
第 5 批（规模化）   影视版                           ← 权重最高但有底座可复用
第 6 批（生态）     创作者中心 + 集市 + 运营增长      ← 需要运营策略先行
第 7 批（外延）     CLI/MCP + 多语言                 ← 最后做，依赖主流程稳定
```

### 0.3 每批的完成定义（DoD）

每批收口必须同时满足，否则不算完成：

1. `pnpm typecheck` + `pnpm lint` + `pnpm test` 全绿（**不许用 turbo 缓存冒充**，须 `--force` 重跑一次）；
2. 新增端点有对应 spec（至少覆盖：成功路径、权限拒绝、幂等重放、参数校验）；
3. 新增页面有 E2E 或人工验收截图，落在 `_acceptance/`；
4. `docs/02-architecture/api-spec.md` 同步（契约变更同 PR）；
5. 更新 [implement-progress-vs-reelmate.md](implement-progress-vs-reelmate.md) 的 §3 逐条完成度与 §9 变更登记。

### 0.4 批次状态（2026-10-27 第 2 轮收口后）

| 批次 | 状态 | 证据 |
|---|---|---|
| 第 0 批 地基 | ✅ **完成** | 迁移 0018–0030（110 表）；模型目录 46 条；适配器 7 类（164 例）；幂等账本三态（7 例） |
| 第 1 批 出片质量 | ✅ **完成** | 主体库 7 / 抽取 6 / 匹配 5 端点 + 三闸门；29 例 |
| 第 2 批 小说链 | ✅ **完成（角色卡 5 条薄路径走既有 content-analysis）** | 90 路由（含原创链 20）+ reopen 两级判据；40 例 + 51 项 E2E |
| 第 3 批 工具箱 | ✅ **完成（真实 Key 除外）** | 19 卡全可点 + 15 mode 接线；15 例 + 164 适配器例 + 19 项 E2E |
| 第 4 批 入口收口 | ✅ **完成（MCP 除外）** | `/agent` 页 + 12 端点；22 例 + 29 项 E2E |
| 第 5 批 影视版 | ✅ **完成（xlsx/离线通知/WS 除外）** | 49 操作 + 2 页面；47 例 + 18 项 E2E |
| 第 6 批 生态 | ✅ **完成** | 创作者 83 + 集市 58 + 知识库 29 + 运营位；73 例；运营策略项以"可配置常量 + 待定注释"落地 |
| 第 7 批 CLI/MCP | ⚠️ **CLI 完成，MCP 待取证** | 196 命令/37 组 + `workflow detect`；87 例 |
| 附加：首发补全 | ✅ **完成** | 剧集子链 / 项目聚合 / ReelFlow 发布 / 3D 导演台 / 账号 SSO / 团队权限；共 60+ 例 |
| 附加：收尾与多语言 | ✅ **完成（i18n 路径前缀除外）** | 首页/运营位/内容安全/分享批量/画布恢复（60 例）+ 5 语言 312 key（`i18n-check` 全绿） |

> 结论：**首发口径 93.0%（v1.0 为 54.4%，v2.0 为 83.0%），全站 88.5%**。
> 整块未做的只剩 **广告剧（15 端点）** 与 **视频转绘（8 端点）**（合计 6 权重），二者都需要产品定义与供应商选型；
> 其余 17.6 权重分散在 12 个模块的"最后一项"（多为取证/接 Key/加 UI 级别）。

## 1. 第 0 批：地基（阻断后续所有批次）

> 权重：不计入 28 模块（属横切），但**不完成则后续全部返工**。

| # | 任务 | 内容 | 影响批次 |
|---:|---|---|---|
| 0.1 | **数据层** | 新增表：`novels` / `novel_chapters` / `novel_worldviews` / `novel_characters` / `novel_episode_outlines` / `novel_script_versions` / `novel_edit_sessions` / `subjects` / `subject_files` / `extraction_tasks` / `extraction_drafts` / `film_tables` / `film_fields` / `film_tasks` / `film_cells` / `film_reviews` / `film_review_versions` / `clip_objects` / `wf_projects` / `wf_videos` / `knowledge_dirs` / `knowledge_assets` / `market_works` / `market_agreements` / `creator_profiles` / `creator_assets` / `campaigns` / `campaign_signups` / `distributor_relations` / `redeem_codes` / `ab_experiments` / `ab_hits` | 1–7 |
| 0.2 | **共享 schema** | 每张表对应 Zod schema（`packages/shared/src/schemas/`），含 LLM 结构化输出的强约束（novel 链的输出 schema 是 prompt 工程的锚） | 1–7 |
| 0.3 | **模型目录扩面** | `seed.ts` 从 10 条扩到 46 条（含 `mode_order`、5 个场景键、`price_variants`、`supported_modes`），照 `cli-out/model-all.json` 结构 | 1、3 |
| 0.4 | **适配器体系** | `model-adapters` 增加：TTS（火山/MiniMax）、音乐、音效、lip-sync、超分、去字幕、切片；每个适配器带契约测试（mock 形状 + 真实沙箱） | 3 |
| 0.5 | **阶段机基座** | `workflow detect` 的服务端实现（studio/canvas 双作用域、5 阶段、`missing[].goto_stage`）——CLI 与前端共用 | 4、7 |
| 0.6 | **幂等账本** | 已有 `idempotency_records` 表，补 `in_doubt` 三态与 `ledger` 语义（供 CLI 用） | 7 |

**判据**：`pnpm --filter @app/api db:migrate` 跑通；新增表全部有 schema 与 spec；模型目录 46 条可 `GET /models` 返回且场景键筛选正确。

---

## 2. 第 1 批：出片质量（权重 6.4，影响每一集的质量）

> 对应模块 #17 资产/主体（现 20%）。**这是「角色一致性」的真正载体**，不做则所有出片都是"看起来像但每镜不一样"。

| # | 任务 | 竞品证据 | 我方交付 |
|---:|---|---|---|
| 1.1 | `subject` 主体库 | `cmd/subject.md:3`（「生成模型按 subject_id 保持同一角色」）；`business_list=[3]` 为 Seedance 主体 | `subjects` / `subject_files` 表 + 6 端点：`POST /subjects`、`GET /subjects`、`GET /subjects/:id`、`POST /subjects/from-asset`（`save-from-resource` 语义）、`PATCH /subjects/:id`、`DELETE /subjects/:id`；审核三态 `reviewing/approved/rejected`（驳回 `retryable=false`，禁止自动重试） |
| 1.2 | `extraction` 抽取流水线 | `cmd/resource.md:552-556`（`task_type=1`..`5`）；`rt:489-514`（26 端点） | 抽取任务 4 态（1 进行中/2 成功/3 失败/4 失效）+ 草稿 `eed_id` + 主子形态 `parent_state_id`；端点：`POST /extraction/tasks`、`GET /extraction/tasks/:id`、`GET /extraction/drafts`、`POST /extraction/drafts/import`、`POST /extraction/tasks/redo` |
| 1.3 | `asset-match` 资产×分镜匹配 | `episode.md:265`（组合任务：匹配完成自动拆分镜）、`_storyboard-asset-match.md:5-40` | `POST /projects/:id/episodes/:eid/match-resources`、`GET .../match-result`、`POST .../match-reset`、`POST .../save-resource-matches`（**完整快照语义**，空类别显式传 `[]`） |
| 1.4 | 一致性三闸门落地 | `resource.md:207`、`storyboard.md:308-310` | 定稿闸门（`status=2` + `file_id`）→ 匹配闸门（`match-result.status` 1/2/3）→ 生成闸门（`images[]` 注入）；未定稿投递返回 `400105` |
| 1.5 | 缺失资产智能补充 | `_storyboard-asset-match.md:9-17` | 判定条件 7 项全满足才可补；三选项（补/重匹配/保持现状，默认第三）；执行顺序 `prompt-complete` → 轮询 → 查重 → `add`/`generate` → `save-resource-matches` |

**判据**：一个 3 集项目，角色 A 在 10 镜里的 reference 均指向同一 `subject_id`；未定稿角色投递返回 400105；`match-result` 三态统计与实际一致。

---

## 3. 第 2 批：小说改编链（权重 8，决定产品定位）

> 对应模块 #2（现 0%）。竞品 `df/novel` 86 端点，是 `df` 域最大的一块，也是「从 0 产出剧本」的唯一入口。

### 3.1 子链与端点数

| 子链 | 端点数 | 关键点 |
|---|---:|---|
| `split` 分章解析 | 3 | ✅ 已有（`POST /projects/parse-script`），需补 `GET /novels/:id/chapters` |
| `content-analysis` 内容分析 | 6 | 世界观 `worldview` + 角色卡 `novel_character_cards`（含 `ncc_id`） |
| `chapter_outline` 章节大纲 | 3 | 生成/编辑/列表，`nco_id` |
| `episode_outline` 分集大纲 | 3 | 生成/编辑，`neo_id` |
| `core_character` 核心角色 | 4 | 生成/列表/编辑 |
| `script-generate` 剧本生成 | 2 | 多集批量 |
| **`script_edit_agent` 剧本编辑 Agent** | **13** | **⭐ 差异点**：会话式 diff |
| `fission_script` 创意裂变 | 9 | idea/characters/episodes_outline/summary_outline |
| `original_script` 原创链 | 14 | idea/materials/outline/chapter/episode/script/finalize |
| `overseas` 海外改编 | 2 | — |
| 其它（`point`/`permission`/`group`/`adjust`/`import`） | 8 | — |

### 3.2 `script_edit_agent` 是这批的核心（13 端点）

> 证据：`rt:570-600`、`cmd/novel.md` 的 `script_edit_agent` 段。这是竞品最精妙的设计——**用户说「把第 3 集改成悲剧结局」→ 生成 pending 变更 → 逐集 apply/reject → 版本 finalize**。

```
POST   /novels/:nt_id/script_edit_agent/enter            进入编辑态
POST   .../exit                                          退出
POST   .../heartbeat                                     会话心跳
GET    .../sessions                                      会话列表
POST   .../sessions                                      新建会话
POST   .../sessions/switch                               切换会话
GET    .../sessions/:sid                                 会话详情
POST   .../sessions/:sid/chat                            对话（生成 pending diff）
POST   .../sessions/:sid/abort                           中止
GET    .../sessions/:sid/episodes/:eid/pending           查看某集待确认变更
POST   .../sessions/:sid/episodes/:eid/apply             应用某集
POST   .../sessions/:sid/episodes/:eid/reject            驳回某集
POST   .../sessions/:sid/apply_all                       ／ apply_all
POST   .../sessions/:sid/reject_all                      ／ reject_all
DELETE .../version/:vid/delete                           删除版本
POST   .../version/:vid/finalize                         版本定稿
```

**实现要点**：
- `pending` 返回的是**逐集 diff**（原始文本 + 建议文本 + 变更说明），不是整篇重写；
- `apply` 写入 `novels.episodes[].script_text` 并记录到 `novel_script_versions`；
- `finalize` 后该 `NT_ID` 才能作为 `episode split` 的源（这是 §3.3 衔接契约）；
- 无 LLM 时 mock 模式必须能跑通（确定性 diff，便于 CI）。

### 3.3 与制片工坊的衔接（竞品未明写，我们须定契约）

竞品里「已定稿剧本 → 拆集成剧集」是隐式的（`episode.md:168` 的 `episode split --set nt_id=`）。我们要**显式定义**：

`novel.finalize` → `NT_ID.status=16`（已定稿）→ `POST /projects/:id/episodes/split {source: {kind: 'novel', nt_id}}` 允许该来源，否则 400。

**判据**：粘贴 3 万字小说 → 内容分析 → 分集大纲 → 角色 → 剧本 → 用编辑 Agent 改 2 集 → finalize → 拆集成剧集 → 进入制片工坊四环节，全链人工干预 ≤5 次。

---

## 4. 第 3 批：能力补全（权重 13.6 + 2.1）

> 对应模块 #6 工具箱（32%）与 #15 后处理族（30%）。**这决定单点工具的竞争力**。

### 4.1 10 张静默态卡 → 可用

| 工具 | 需接能力 | 供应商候选 |
|---|---|---|
| 视频对口型 | `advanced-lip` | 火山 / 可灵 |
| 灵感成片（Agent） | 复用 `agent/task/create` | 内部编排 |
| 视频超清 | `video-super-resolution` | 火山 / 阿里 |
| 视频特效 | `effects` | 自建模板 + ffmpeg |
| 涂抹重绘 | `inpaint`（画布已有，补页面） | 复用 |
| 文字重绘 | `brush-repaint` / `text-repaint` | 阿里千问图像编辑 |
| 文生语音 | `text-to-speech` + `voice/list` | 火山 TTS / MiniMax |
| 文生音乐 | `text-to-music` | MiniMax / 自建 |
| 文生音效 | `text-to-sfx` | 同 上 |
| 自动配乐 | `auto-bgm` | 自建（音乐库 + 匹配） |

### 4.2 后处理族补齐

去字幕×2（`de_subtitle_auto` / `de_subtitle_region`）、视频切片（`video-slicing`）、帧率时长统一（`fps-duration-unify`）、音画分离（`video-audio-separation`）、音色修改（`audio-timbre-modify`）。

> 注意：`generations` 端点目前是 1 个端点承载所有 mode（ADR-003），**不新增端点**，只扩 mode 枚举与适配器分派。这是与竞品「8 个生成端点」的对齐点。

**判据**：19 张卡全部可点进；每张卡能提交任务并拿到结果；`node.md` 的 28 种 mode 全部可用（补 `video_upscale`）。

---

## 5. 第 4 批：入口收口（权重 10 + 4.8）

| # | 任务 | 竞品证据 | 交付 |
|---:|---|---|---|
| 4.1 | `/agent` 页面 | `rt:14-16`、`rt:42`、`rt:123-134`；`报告 §1` | 对话式创作页：消息流 + SSE 消费（复用已有 `useCanvasAgent` 的流解析）+ 任务卡 + 分享 |
| 4.2 | Skill 卡市场 | `rt:378-385`（`agent-skills` 8 端点） | `agent_skills` 表 + 8 端点（list/mine/plaza/favorites/favorite/details/create/delete）+ 卡片 UI；33 张卡的运营位（竞品实测 33 张） |
| 4.3 | STT 语音输入 | `rt:126`（`agent/stt-token`） | token 端点 + 前端录音组件 |
| 4.4 | `/reelflow/list` + `/reelflow/edit/:id` | `rt:74-75`；`FLOW:77-86` | 左栏剧集资产（只列已定稿）/ 中播放器 / 底部时间线；「更新分镜」**显式同步**（不自动） |

**判据**：`/agent` 能完整跑一轮对话并产出任务；Skill 卡可收藏与使用；ReelFlow 能把 3 个已定稿分镜拖进时间线并导出 mp4。

---

## 6. 第 5 批：影视版（权重 20，最高单块）

> 对应模块 #8（现 0%）。**技术上有底座可复用**：12 张画布表 + 86 端点已经证明"节点图"这种编排皮可行，影视版是第三种皮。

### 6.1 数据模型（照竞品 9 种字段类型）

```
film_table  { table_id, project_id, name, is_preset, sort, version }
  └ film_field { field_id, table_id, key, name, field_type, is_system,
                 is_unique_type, sort, config_json, hidden, width }
       field_type ∈ { text, date, user, select, multi_select, number, link,
                      canvas_ref, asset_ref, review_ref, points_ro }
       # is_unique_type 语义 = 「该 type 每表至多一个」，不是值唯一
  └ film_task  { task_id, table_id, title, status, sort, version, parent_id }
       status ∈ { not_started, in_progress, pending_review, rejected, done }
  └ film_cell  { task_id, field_id, value_json }   # 稀疏 map
```

### 6.2 端点（37 路径 / 48 操作）

| 子域 | 端点数 | 关键端点 |
|---|---:|---|
| 任务表本体 | 8 | `task-tables` CRUD + `apply-template` + `ensure-presets` + `import` + `reorder` |
| 字段 | 6 | `fields` CRUD + `reorder` + `batch-restore` |
| 表视图偏好 | 2 | `pref` GET/PUT |
| 行（任务） | 12 | `tasks` CRUD + `cells` + `children` + `status` + `notify-assignees` + `query` + `reorder` + `title-matches` + `unbound-query` + `batch-delete` + `batch-restore` |
| 审核 | 3 | `review` GET + `review/comments` + `review/read` |
| 行↔画布绑定 | 4 | `tasks/:task_id/canvas-bindings` GET/POST/PUT/DELETE |
| 画布侧 | 5 | `canvases/visible` + `task-panel` + `task-bindings` + `submit-result` + DELETE canvas |
| 任务模板 | 3 | `task-templates` GET/POST/DELETE |
| 导出 | 2 | `exports` GET/POST |
| 最近打开 | 2 | `recent-open` GET/POST |
| 统计 | 1 | `tasks/stats` |

### 6.3 三个关键机制

1. **审核版本链**：每次提交产生不可变 `version_no`（V01/V02…），评论挂版本、已读回执按版本记。**行 status 与版本 status 双轨**（竞品自己也缺 `review/approve` 端点，我们用 `POST .../status` 承载决策，并在 api-spec 写偏离说明）；
2. **`submit-result` 是唯一自动化衔接点**：画布节点产物 → 登记为审核版本 → 行状态推 `pending_review` → 发通知。**没有它影视版就是外挂 Excel**；
3. **协同用 WebSocket 广播 + `client_id` 回声抑制**（不用画布的悲观锁）——两种协同模型并存是竞品的既有事实，我们照做（ADR-013），并在 api-spec 注明"与 canvas 的锁模型不同，这是有意为之"。

### 6.4 准入

`GET /func-whitelist?scene=ai_film` → `{check: bool}`。竞品是**商务开通制**（不是自助订阅），我方沿用：`spaces.film_enabled` 已有字段，加白名单端点与页面引导（"联系商务开通"）。

**判据**：能建表 → 自定义 3 种字段 → 建 10 行任务 → 派工给成员 → 绑定画布 → 画布提交后自动进 pending_review → 审核通过 → 导出 xlsx。

---

## 7. 第 6 批：创作者生态（权重 19.4 + 8）

> 对应模块 #10 活动/创作者（3%）、#12 剧本广场（0%）、#18 知识库（0%）、#21 数据看板（15%）。
> **前置**：需要先定运营策略（抽成比例、审核流、结算周期）——这些是产品决策不是技术决策，**开工前须 Owner 拍板**。

| 子域 | 端点数 | 内容 |
|---|---:|---|
| 创作者中心 `crc` | 30 | 投稿/审核/资产/点赞/关注粉丝/激励/活动/banner/pop_up |
| 剧本集市 `novel_market` | 29 | 上架/预售/协议/收益/提现/作品解析 |
| 集市 Admin | 12 | 审核流/分类/标签/推广位 |
| 运营增长 `op` | 31 | 邀请码/分销/兑换码/每日奖励/问卷/AB/定向发分 |
| 激励 `campaign` | 6 | 报名/提名/入围/获奖 |
| 团队知识库 | 29 | 目录/标签/资产三层 + 与资产库双向导入 |
| 数据看板 `kds` | 13 | 团队积分消耗排名/成员参与明细/项目数据导出 |

**开工前必须定的三件事**（否则会返工）：
1. 集市抽成比例与结算周期；
2. 投稿审核是人工还是机审，SLA 多少；
3. 分销层级是否允许多级（涉及合规）。

---

## 8. 第 7 批：外延（权重 16）

| # | 任务 | 关键点 |
|---:|---|---|
| 7.1 | **CLI 38 命令组** | 照 `cmd/*.md` 逐组实现；`{ok,data,links}` envelope；12 档退出码；`--dry-run` + `--idempotency-key`；`workflow detect` 阶段机；`ledger` 三态 |
| 7.2 | **Skill 包分发** | `SKILL.md` 路由协议（一次只选一个场景）+ 共享协议手册 + `npm i -g` 版本钉死 |
| 7.3 | **MCP Server** | ⚠️ 竞品只有宣传、无工具清单（证据缺口）。我们**先做 CLI，MCP 留到有明确需求时定**——不臆造（ADR-013 决策 2） |
| 7.4 | **多语言** | Nuxt i18n + 5 语言包（zh/en/ja/br/es）+ `X-Lang` 协商；文案自建不照抄 |

---

## 9. 批次排期与进度预测

以首发口径（133 权重）为分母：

| 批次 | 权重 | 累计完成 | 全站进度 | 首发口径 |
|---|---:|---:|---:|---:|
| 起点 | — | 72.9 | 35.4% | 54.4% |
| 第 0 批（地基） | 0 | 72.9 | 35.4% | 54.4% |
| 第 1 批（出片质量） | 6.4 | 79.3 | 38.5% | 59.6% |
| 第 2 批（小说链） | 8.0 | 87.3 | 42.4% | 65.6% |
| 第 3 批（能力） | 15.7 | 103.0 | 50.0% | 77.4% |
| 第 4 批（入口） | 14.8 | 117.8 | 57.2% | 88.6% |
| 第 5 批（影视版） | 20.0 | 137.8 | 66.9% | — |
| 第 6 批（生态） | 27.4 | 165.2 | 80.2% | — |
| 第 7 批（外延） | 16.0 | 181.2 | 88.0% | — |
| 收尾（横切补齐） | 24.7 | 205.9 | **≈100%** | — |

> 数字口径：权重来自竞品侧 T 恤码（S=1/M=3/L=8/XL=20），完成度按端点/界面/证据三维取最低。收尾项含：订阅制 0.8、SSO 1.3、内容安全 0.7、数据看板剩余 2.5、ReelFlow 剩余、团队剩余 4.6、杂项。

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| **竞品证据不足** | 影视版/集市/MCP 的部分行为未取证 | 按 ADR-013 决策 2：登记待取证、不臆造；最多做"入口 + 说明"。**不为了凑 100% 造假可用** |
| **外部资质未办**（ICP/AI 双备案/商户号） | 功能做完也不能对外商用 | 与开发并行推进，不阻塞代码；`launch-checklist.md` 跟踪 |
| **真实供应商 Key 缺失** | 只能 mock，无法证明真能出片 | 第 0.4 批的适配器契约测试用 mock 形状 + 沙箱真跑双轨；Key 到位后打一轮真链路 |
| **权重口径漂移** | 进度数字前后不可比 | 变更登记追加式；每次重算必须同口径（模块加权 + 三维取最低） |
| **一次铺太宽** | 每块都半成品 | 严格按批次收口，**每批 DoD 未过不进下一批** |
| **超范围**（竞品 821 端点全做） | 永远做不完 | 100% 的判定是**28 模块**，不是 821 端点全等。端点复用（如 generations 单端点承载多 mode）是 ADR-003 的既定设计 |

---

## 11. 不在本计划范围内（明确不做）

| 项 | 理由 |
|---|---|
| 照抄竞品前端代码/美术素材/品牌元素 | `报告 §9` 合规前提；ADR-013 决策 3（对齐行为不抄实现） |
| 竞品内部请求头（`X-Prod-Id`/`X-Module-Action` 等） | ADR-009：协议自研，保留我方 `Bearer` + `{code,msg,data}` |
| 竞品的微服务拆分（12 服务前缀） | ADR-002：模块化单体；域边界按资源所有权划（ADR-009） |
| 竞品的供应商私有语义（`seedance-review-status` 等） | 用我方统一审核态替代，api-spec 写偏离说明 |
| MCP Server（无证据） | 待取证；先做 CLI |

---

## 12. 变更登记

| 日期 | 版本 | 变更 |
|---|---|---|
| 2026-10-27 | v1.0 | 首版：8 批次划分 + 每批 DoD + 排期预测 + 风险对策 |
