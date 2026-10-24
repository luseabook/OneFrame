# 万星文档体系 · 逆向一致性审查与修订报告

> 审查日期：2026-10-24 · 审查人：产品/架构联合审查（以逆向证据为准）
> 审查对象：`docs/` 16 份文档 + `复刻蓝图.md`（历史件）= 17 份
> 判定依据：`rea-reelmate/REELMATE-逆向分析报告.md`（下称「RE 报告」）及附件——
> `cli-out/model-all.json`（46 模型目录）、`cli-out/credits-balance.json`、`routes.txt`、`cli-skill/`（38 命令组 + 工作流手册）、`node.md`/`storyboard.md`/`export.md`/`credits.md`/`model.md`/`task.md`/`file.md`、`net1-calls.json`（point-calculate 实测）、`_stage-machine.md`/`_hard-gate.md`/`_models.md`
> 审查方法：逐份通读 17 份文档 → 对每条带〔RM-证据〕或声称"对齐竞品"的设计点回查原始证据 → 按「一致性 / 逻辑完整性 / 可行性」三项判定 → 就地修订并复验
> 结论：**P0 11 项、P1 9 项、P2 5 项**。P0/P1 共 20 项已全部直接修订落盘；P2 中 RE-21/RE-24 已修、RE-25 加注，RE-22/RE-23 为有意偏离，已在文档内显式声明。

---

## 0. 审查范围、判定口径与证据基线

### 0.1 审查对象（修订前 → 修订后版本）

| # | 文档 | 修订前 | 修订后 | 本次是否改动 |
|---|---|---|---|---|
| 1 | `docs/01-product/PRD.md` | v1.2 | v1.3 | 是 |
| 2 | `docs/01-product/user-journeys.md` | v1.2 | v1.3 | 是 |
| 3 | `docs/01-product/metrics.md` | v1.2 | v1.3 | 是 |
| 4 | `docs/02-architecture/system-design.md` | v1.0 | v1.1 | 是 |
| 5 | `docs/02-architecture/adr.md` | 无版本号 | v1.1（补 ADR-007/008） | 是 |
| 6 | `docs/02-architecture/database.md` | v1.1 | v1.2 | 是 |
| 7 | `docs/02-architecture/api-spec.md` | v1.1 | v1.2 | 是 |
| 8 | `docs/03-frontend/conventions.md` | v1.0 | v1.1 | 是 |
| 9 | `docs/04-engineering/dev-workflow.md` | v1.0 | v1.1 | 是 |
| 10 | `docs/04-engineering/testing.md` | v1.0 | v1.1 | 是 |
| 11 | `docs/05-ops/deployment.md` | v1.0 | v1.1 | 是 |
| 12 | `docs/05-ops/observability.md` | v1.0 | v1.1 | 是 |
| 13 | `docs/06-security-compliance/security.md` | v1.0 | v1.1 | 是 |
| 14 | `docs/06-security-compliance/compliance.md` | v1.0 | v1.1 | 是 |
| 15 | `docs/07-plan/wbs.md` | v1.2 | v1.3 | 是 |
| 16 | `docs/README.md` | v1.2 | v1.3 | 是 |
| 17 | `复刻蓝图.md` | v1.0（Superseded） | v1.0（仅加数值口径注记） | 仅加注 |

### 0.2 判定标准

- **一致**：设计与逆向记录的可验证事实（字段、枚举、流程、错误语义）不冲突；
- **基本一致（有声明）**：主动简化/改进，但文档明确写出偏离点与理由（如自有 JWT、预签名、单端点生成）；
- **冲突**：同一事实在文档与证据之间、或文档之间互相矛盾，导致无法实现/无法验收；
- **不可判定**：文档承诺了能力，但契约/表/任务链缺失，验收无法执行。

### 0.3 逆向证据基线（本次实际回查的关键事实）

| 证据 | 关键事实 |
|---|---|
| RE 报告 §12.2 / `net1-calls.json` | 10 积分=1 元；文生视频 5s/720p = **8 积分**；`point-calculate` 返回 `points_code/cost/credit_original/credit_discount` |
| `cli-out/credits-balance.json` | 余额 7 桶：`expire_soon_val/give_val/recharge_val/team_assigned_val/team_credit_total/total_val/vip_val` |
| `cli-out/model-all.json` | **46 个模型**（30 video + 13 image + 3 file）；每条含 `visible/need_vip/mode_order/supported_modes/params.generation.<mode>`；mode 内 `endpoint/ratios/durations/default_*/resolution_options(label,value)/counts/media_limits`；场景键 `script_to_scene_refer`、`storyboard_reference_video`；`studio_asset_image` 是 image 的一种 generation mode；11 个 model 带 `price_variants`（原价/会员价/限时价） |
| 同上（duration 实测） | 各模型时长集合不同：天幕2.0=仅 5s；可灵2.6=5/10；TS2.0=4/8/12；TV3.1=4/6/8；Vidu Q2=1~8；Seedance 2.5=4~30；`storyboard_reference_video.durations` 另有独立集合 |
| `_stage-machine.md` | 工坊阶段机 `project → script → asset → storyboard → render`；分镜完成判定 `status=2` 且列表非空；缺项回引 |
| `_hard-gate.md` / `storyboard.md` | 拆分镜前硬门 `hitl.asset-ready`（引用资产已定稿）；match-assets 只认**已定稿且有 file_id** 的资产；分镜批量按集一条请求；`duration` 不属于生成接口，按模型规则就近调整 |
| `_models.md` / `model.md` | 资产生图看 `params.studio_asset_image`；分镜规划看 `params.storyboard_reference_video`；剧本拆分镜看 `params.script_to_scene_refer`；按 `mode_order` 排序；**不得假设模型共享时长/分辨率/画幅** |
| `storyboard.md` | 未选模型时参考生视频通用约束 **4~15s**；选中模型后按模型合法档位就近取低 |
| `export.md` | `export merge` 只合并**已定稿**视频，不生成缺失镜；导出成功 `status=2` |
| `task.md` | `retry/regenerate` 会重新下单扣费；有 `task delete`；任务终态映射退出码 |
| `error-codes.md` | 进程退出码 3 鉴权 / 4 任务失败 / 7 积分不足 / 8 审核 / 9 画布版本冲突 / 10 节点锁 |
| `routes.txt` | `/web/v1` 去重 **801** 个端点；其中 `df/*` **466** 个；`/create/*` 17 个 |
| `node.md` | 画布 **11 种**节点：text/image/video/audio/table/script/asset/clip/director/threeDWorld/group；video settings 含 duration/enableSound/mouthDrive/shotType/offPeak/fps |

---

## 1. 结论摘要

| 级别 | 数量 | 含义 | 处理 |
|---|---:|---|---|
| P0 | 11 | 阻断实现或验收、或与逆向事实直接矛盾 | 全部已修订 |
| P1 | 9 | 逻辑不自洽、契约缺字段、可观测/合规冲突 | 全部已修订 |
| P2 | 5 | 表述过强、历史件数值、有意偏离 | 3 项已修，2 项声明保留 |

**最关键的 5 条结论：**

1. **预算触顶在 PRD 是"错误"，在 API 是"部分成功"**——同一交互两套契约，前端无法实现；且"全集报价总和"没有批量报价端点支撑（RE 统一账单是 `line_items/business_count` 形态）。
2. **分镜时长/画幅被写死为 `4/5/6/8/10` 并声称"对齐模型 durations"**——RE 46 模型目录证明这是每模型不同集合（天幕2.0 仅 5s、TS2.0 4/8/12），固定档位在多数模型上会直接报非法参数。
3. **资产没有"定稿"状态，却承诺"references 服务端强制注入"**——RE 的匹配/分镜硬门只认已定稿且有 `file_id` 的资产，未定稿角色无定义路径；场景/道具也没有生成入口。
4. **对账不变式 `balance+frozen == Σ流水` 在新记账口径下数学不成立**——`settle` 行 `delta=0, frozen_delta=-cost` 后，余额 92、Σdelta=-8，等式失败；三份文档仍沿用旧式，日对账会误报。
5. **AI 双标识（合规 P0）没有任何实现任务**——PRD/compliance 要求显式水印+隐式元数据，但 WBS 无任务、worker 仅一句"标识合成"、无 ffmpeg/字体/校验依赖，MVP 无法交付。

---

## 2. 覆盖矩阵（17 份文档 × 13 个关键设计点）

| # | 关键设计点 | 文档落点 | 逆向依据 | 审查前判定 | 修订后 |
|---|---|---|---|---|---|
| 1 | 账号/会话/邀请码 | PRD F1、api §2、security §2、adr-006/008 | 登录方式、双 token、`/renew` 33min、裸 token | 基本一致（有偏离） | 偏离保留并在 ADR 声明 |
| 2 | 模型目录与参数 | database §2、api §4/§5、conventions §3 | 46 目录、`mode_order`、mode/scene、`endpoint`、label/value | **冲突** | 已对齐（RE-05/12） |
| 3 | 计价/积分/对账 | PRD F6、database §4、metrics、testing §2、security §3、api §4 | 8 分实测、7 桶、三价通道、`credit_discount` | **冲突** | 已统一（RE-02/13/14） |
| 4 | 任务生命周期/轮询/重试 | api §6、system-design §3、conventions §3 | 5s 批量、`retry` 扣费、状态机、导出/分享 | 基本一致 | 补 share 与 Non-goals（RE-08/23） |
| 5 | 剧本流水线 | PRD F2、api §8、database §6、journeys J1 | 阶段机五阶段、导入剧本拆集、四环节 | **缺拆集入口** | 已补（RE-06） |
| 6 | 资产与角色一致性 | PRD F2③/F5、database §6、api §8 | 定稿 + `file_id` + match-assets | **不可实现** | 已补定稿门槛（RE-04） |
| 7 | 分镜与批量投递 | PRD F2⑤⑥、api §8、conventions §3 | 按集批量、模型时长、预算/余额 | **冲突** | 已改（RE-01/03） |
| 8 | 导出与分享 | PRD F2⑦/F3、api §6/§8、WBS | `export merge` 只并已定稿、task share | **缺规则/契约** | 已补（RE-08/11） |
| 9 | 无限画布 | database §7、PRD §6、journeys J4 | 11 节点、13 video mode、锁/版本冲突 exit 9/10 | 部分（9 类） | 已补 11 类 + settings（RE-18） |
| 10 | 错误码/风控 | api §1、PRD F1/F7、metrics | 745701/741001 实测；exit 3/4/7/8/9/10 | **来源混淆** | 已标源 + 补码（RE-13） |
| 11 | AI 标识与内容合规 | PRD F7、compliance B3/G、system-design §3.2 | AI 声明/审核/标识 | **无实现任务** | 已补链路（RE-07） |
| 12 | 可观测/部署/测试 | observability、deployment、testing、dev-workflow | Sentry US、data_center 四区、清理任务 | **冲突** | 已对齐（RE-15/16/19） |
| 13 | 计划与排期 | WBS、README、PRD §6 | Beta 后节奏 | **冲突** | 已对齐（RE-20） |

---

## 3. P0 问题（阻断实现/验收，已全部修订）

### RE-01 预算触顶：PRD 返回 745703 vs API 200 部分成功；批量报价缺失

**问题定位**
- `PRD.md` §4 F2⑥ 与验收第 3 条：「预算触顶(745703)→余下镜头标未投递」，「累计冻结≥上限 → 返回 745703」；
- `api-spec.md` §8 `generate-videos`：`← 200 {items:[...]}`，预算触顶只是 `items[].reason`；
- `user-journeys.md` J3a-1：以「745703 → 弹窗」为入口；`metrics.md` `credits_hint{code}` 同。

**原因说明**
同一事件被写成两种互斥契约：信封失败码（`code=745703, data:null`）与 HTTP 200 部分成功（`items[].submitted=false`）。前端无法同时按"整单失败"和"部分成功"实现，验收也无法判定"余镜是否已落未投递状态"。更深一层：PRD 要求预算默认值=「全集报价总和」、续投预填=「已消耗+剩余镜头报价」，但 `POST /credits/quote` 只接受单请求，没有批量报价端点；RE 的统一账单（`credits estimate`）恰恰是 `line_items[] + business_count + total_cost` 形态，单条 quote 无法支撑该交互。

**修正内容**
- 统一为：**批量投递永远 200 部分成功**；每镜 `{shot_id, task_id|null, submitted, code?, reason?}`；预算触顶镜 `code=745703, reason=budget_exceeded`；余额不足才整单 `745701` 且不落任何任务；
- 新增 `POST /credits/quote/batch {items[]}`（≤50）→ `total_credits/line_items/…`，作为预算默认值与续投预填的唯一来源；单条 quote 增 `quote_id/quote_expires_at`，提交可带 `quote_id`，价格变化报 `745702`；批量投递缺报价报 `400107 QUOTE_REQUIRED`；
- PRD F2⑥/验收、journeys J1/J3a-1、metrics `credits_hint`、testing §2-8、WBS 1'.4 全部改为同一语义。

**落点**：PRD §4 F2⑥+验收；api-spec §1 错误码、§4、§8；user-journeys J1/J3a-1；metrics §3；testing §2；wbs 1'.4。

---

### RE-02 对账不变式与新记账口径冲突（三份文档）

**问题定位**
- `PRD.md` F6 验收：「余额+冻结=Σ流水」；
- `testing.md` §2-1：「`balance+frozen == Σ流水`」；
- `security.md` §3-4：「每日校验 `balance+frozen == Σflows`」；
- 而 `database.md` §4 已改为 `delta`（可用余额变动）/`frozen_delta`（冻结额变动）分离。

**原因说明**
按 database 示例（初始 balance=100，任务 cost=8）：freeze 行 `delta=-8, frozen_delta=+8`；settle 行 `delta=0, frozen_delta=-8`。此时 `balance=92, frozen=0`，而 `Σdelta=-8`。旧式 `balance+frozen == Σ流水` 在 settle 后恒不成立（92 ≠ -8），日对账会持续误报；若把 frozen 计入流水又不等于 `Σdelta`，两套口径无法同时成立。这是上一轮修订只改了 database、未传播到产品/测试/安全文档造成的"半修"。

**修正内容**
三处统一为 database §4 的唯一口径：**`balance == Σ delta` 且 `frozen == Σ frozen_delta`**，并给出等价式 `balance+frozen == Σ(delta+frozen_delta)`；属性测试、告警任务、验收条款同文。

**落点**：PRD F6 验收；testing §2-1；security §3-4。（database §4 保持源头。）

---

### RE-03 分镜时长/画幅写死档位，与 46 模型目录冲突

**问题定位**
- `PRD.md` F2⑤：「时长(档位 4/5/6/8/10 秒)」；
- `api-spec.md` §8：`duration_s ∈ {4,5,6,8,10}`、注释「对齐模型 durations」；
- `database.md` storyboards：`duration_s -- 档位 4/5/6/8/10`；
- `blueprint`/`wbs` 同源表述。

**原因说明**
RE 46 模型目录实测：`durations` 是**每模型、每 mode 独立**的枚举——天幕2.0 仅 `[5]`；可灵2.6 `[5,10]`；TS2.0 `[4,8,12]`；TV3.1 `[4,6,8]`；Vidu Q2 `[1..8]`；Seedance 2.5 `[4..30]`；分镜专用 `storyboard_reference_video.durations` 又是另一组。把 `{4,5,6,8,10}` 当成全局档位，在"最优惠"的天幕2.0 上选 4/6/8/10 全部非法；且 RE 的分镜批量接口**不接受 duration**——时长在拆镜阶段按所选模型就近调整。文档的"对齐"声明与证据相反。

**修正内容**
- UI 不写死档位：选项由 `GET /models` 的 `storyboard_reference_video.durations/ratios/resolution_options` 渲染；
- `storyboards.duration_s` 仅存储（默认 5、输入 1~30），`ratio/resolution` 可空；**投递时**按模型枚举校验，不支持则就近取合法低档并回写（记录 `duration_adjusted`），越界参数报 `400101`；
- PRD 验收补"UI 只展示模型枚举 / 就近回写"；conventions ModelPicker 同步；WBS 1'.4 增加"模型枚举校验"；database 去掉固定档位注释。

**落点**：PRD F2⑤+验收；api-spec §8 storyboards generate/PATCH；database storyboards；conventions §3；wbs 1'.4；testing §2-8。

---

### RE-04 资产无"定稿"状态、无场景/道具生成路径 → 一致性注入不可实现

**问题定位**
- `PRD.md` F2③ 只有"定妆图=生成任务→绑定"；F2⑥/验收承诺「references 均含定妆图（服务端保证）」；
- `database.md` `project_assets` 只有 `portrait_asset_id`，无状态/无来源任务；
- `api-spec.md` portrait 只有"生成/换绑"，无定稿；`system-design.md` script 模块未提资产定稿；
- `WBS 1'.3` 只写"生成/改稿/绑定/rebind"。

**原因说明**
RE 的硬门前置是「本次引用的资产图片是否已准备完毕」，分镜匹配只认**已定稿且有 `file_id`** 的资产（`storyboard.md` match-assets；`_hard-gate.md` `hitl.asset-ready`）。文档没有 `status`，也没有"未定稿时怎么办"的分支，于是"服务端保证注入"对未定妆角色无法成立——要么注入空 references（模型 `min_media=1` 会拒绝），要么静默跳过一致性，二者都不可验收。另外 `project_assets.kind` 有 character/scene/prop，但 F2 只定义了角色生成路径，场景/道具无法产出，分镜命中场景参考时同样无解。

**修正内容**
- `project_assets` 增 `status(1草稿 2已定稿)/source_task_id/finalized_at`；资产生图统一 `mode=studio_asset_image`（RE 中仅 TGI 2.5/天幕写实版/TNB 等支持），角色/场景/道具共用；
- portrait 绑定即定稿，另加显式 `POST …/finalize`（幂等）；换绑即重新定稿；
- 批量投递前置校验：引用角色未定稿→该镜 `400105 ASSET_NOT_READY`（不整单失败、不冻结）；参考图数超 `media_limits`→`400101`；
- 矩阵补"紫=待定稿"；`GET episode` 增 `asset_ready/last_reason`；指标漏斗补 `assets_finalized` 事件。

**落点**：PRD F2③/F4/验收；api-spec §1/§8/§6；database project_assets/状态枚举/tasks.scene；system-design §2；metrics §2/§3；wbs 1'.3/1'.4；journeys J1；testing §2-8。

---

### RE-05 模型目录 schema 与 46 模型目录不符；"即其落库形态"不成立

**问题定位**
- `database.md` §2 `models` 仅 `modes/scene_modes`，mode 内只有 ratios/durations/resolutions/counts/defaults/options；`scene_modes` 命名 `asset_image`；文末称「此结构即其 46 模型目录落库形态」；
- `api-spec.md` §4 `/models` 响应缺 `mode_order/endpoint/default_*/media_limits/label`；
- `ADR-003` 称校验依赖 `models.modes`，但字段不足。

**原因说明**
RE 每条模型记录至少还包含：`mode_order`（同模式排序）、`params.generation.<mode>.endpoint`（同模型不同 mode 端点不同）、`default_duration/default_ratio/default_resolution/default_count`、`resolution_options[{label,value}]`（展示与提交分离，如 `720p_sale→"1080P优惠版"`）、`media_limits`、`mouth_drive/off_peak`、`price_variants`（member/time_limited/original 三价）、`tags/promotions/logo/is_new`。缺了这些，`/models` 无法驱动前端，`ADR-003` 的"目录驱动校验"也无从实现；"即其落库形态"是过强声明。

**修正内容**
- `models` 增 `types[]/mode_order`；`modes` 结构补 `endpoint/default_*/resolution_options/media_limits/mouth_drive/off_peak`；`scene_modes` 明确为两个 scene 键（`script_to_scene_refer`、`storyboard_reference_video`），并注明 `studio_asset_image` 是 image 的 **generation mode**、不是 scene 键；
- `model_prices` 增 `member_credits/time_limited_credits`（Beta 启用），并写清 RE 的三价回退链；
- `/models` 响应同步字段；数据库对照语改为「结构对齐、按 MVP 裁剪，不逐字段复制」；
- `ADR-003` 改引用 §5 并写清 mode/scene 两层校验；dev-workflow 增加目录快照契约门禁。

**落点**：database §2；api-spec §4/§5；adr-003/007；conventions §3；dev-workflow §2；testing §3；wbs 1.2。

---

### RE-06 缺"导入已有剧本 → 拆集"入口

**问题定位**
- `PRD.md` F2①：来源仅「粘贴小说 ≤5 万字 / 一句话想法」；
- `database.md` `source_type`：`1novel 2idea 3fission`；
- `api-spec.md` §8 无拆集端点；`WBS 1'.2` 只有 outline/characters/script-draft/storyboards。

**原因说明**
RE 制片工坊主路径是「导入剧本 → 拆集 → 资产 → 拆分镜出片」（`episode split`，拆集不扣积分）；目标用户 P2 小工作室恰恰是"已有剧本"人群。文档只有从零小说/想法两种入口，导致该类用户无法进入旗舰流水线，与"流水线即差异化"的定位相悖；`source_type=3` 还被预留给 Ph3 的 fission。

**修正内容**
- PRD F2① 增「导入已有剧本 ≤5 万字（按集拆分）」；验收补"导入 1 万字剧本"；
- `source_type` 改 `1novel 2idea 3script 4fission(预留)`；新增 `POST /projects/{id}/episodes/split {source_text?}` → episodes，明确**不扣积分**、超 5 万字 `400104`；
- journeys J1 补拆集分支；WBS 1'.2 补该端点与样例验收；api §13 补限流。

**落点**：PRD F2①/验收；api-spec §1/§8/§13；database script_projects；user-journeys J1；wbs 1'.2。

---

### RE-07 AI 双标识（合规 P0）没有实现任务与技术路径

**问题定位**
- `PRD.md` F7 要求所有生成结果「显式水印+隐式元数据」，列入 P0；
- `compliance.md` B3 同要求，G 清单要抽验；
- `system-design.md` §3.2 只有一句"生成 preview + AI 标识合成"；
- `WBS` 无对应任务；`deployment.md` 无 ffmpeg/字体依赖；`testing.md` 无抽验用例；`observability.md` 无失败指标。

**原因说明**
这是合规硬门槛（《AI 生成合成内容标识办法》+ GB 45438），不是"上线后再补"的体验项。没有任务分解、没有运行时依赖（ffmpeg 烧录、mp4 `comment/©too` 元数据、图片剥 EXIF 后写 XMP/tEXt）、没有"后处理失败不得结算/对外"的失败策略，等于把 P0 承诺悬空；一旦上线即面临下架风险。

**修正内容**
- WBS 新增 **1'.8 AI 双标识后处理**（ffmpeg 水印 + 元数据写入 + probe 校验；图片重编码剥 EXIF + 写入标识），M2 DoD 增加第 9 条；
- system-design §3.2 写清 post-process 步骤与"必须成功后才结算"；§4 失败模式增"后处理失败→重试 3 次→FAILED 不结算+告警，禁止无标识产物对外"；
- deployment 增 `FFMPEG_BIN/WATERMARK_FONT_FILE/WATERMARK_TEXT` 与 worker 镜像内置 ffmpeg/中文字体；
- testing §7 冒烟 + compliance G 抽验；observability 增"AI 标识后处理失败率"；PRD F7 补落地路径。

**落点**：PRD F7；system-design §3.2/§4；adr-005；compliance B3/G；wbs 1'.8/M2；deployment §2/§4；testing §7；observability §3。

---

### RE-08 分享：有验收、无契约、无表、无任务

**问题定位**
- `PRD.md` F3：「结果操作：下载、分享（公开只读预览链接）、转存、加入项目」，验收写"四操作均可用"；
- `api-spec.md` §6 无 share 端点；`database.md` 无 share 表；`WBS 1.7` 无 share；`security.md` 无分享安全条款。

**原因说明**
RE 的任务域有 `task/{id}/share`，说明"分享"是真实产品能力；文档把它写进验收，却没有端点、表结构、有效期/撤销策略和越权约束，验收无法执行；且公开链接涉及内容安全与隐私（不得泄露 prompt/uid/空间），必须有安全设计。

**修正内容**
- 新增 `POST /tasks/{id}/share {expires_in?}` → `{share_url, token, expires_at}`；`DELETE /tasks/{id}/share` 撤销；`GET /s/{token}` 公开只读（仅结果元数据+短时预签名，不含 prompt/uid/空间）；
- `task_shares` 表（token ≥128bit 唯一、expires_at、revoked_at）+ 过期清理任务 + 索引；
- 安全条款与合规 G 清单补"公开页含 AI 声明与举报入口，可即时下线"；WBS 1.7/测试冒烟同步。

**落点**：PRD F3/F4/验收；api-spec §6/§13；database task_shares/ER/生命周期/索引；security §5；compliance G；wbs 1.7；testing §7。

---

### RE-09 LLM 超时口径三处不一致（20s vs 30s）

**问题定位**
- `PRD.md` F2②：「DeepSeek 生成 ≤20s」；
- `api-spec.md` §8：「同步端点…30s 上限」；
- `WBS 1.5`：「30s 上限」。

**原因说明**
20s 被写成生成耗时上限，但契约与任务分解都按 30s 实现；1 万字小说的大纲/10 镜分镜在 DeepSeek 上 20s 内不保证完成，按 20s 验收会产生大量误判失败，按 30s 实现又与 PRD 不符。必须把"目标耗时（P95）"和"硬超时/失败语义"分开。

**修正内容**
统一为：**P95 ≤20s（体验目标），硬超时 30s（契约）**；超时返回 `745901 VENDOR_TIMEOUT`，可重试且不扣费；PRD ②/验收、api §8、WBS 1.5 同文。

**落点**：PRD F2②/验收；api-spec §8（既有 30s 保持并补 745901）；wbs 1.5。

---

### RE-10 DDL 执行顺序与前向外键不可执行

**问题定位**
- `database.md` §3 `tasks` 引用 `episodes(id)/storyboards(id)`，但两张表在 §6 才创建；
- `exports.episode_id` 同样前向引用；
- §1.5 `invite_codes.created_by → admin_users`（§8）、`invite_redemptions.flow_id → credit_flows`（§4）均为前向引用。

**原因说明**
按文档从上到下执行 DDL 必然在 `tasks` 建表时报"relation episodes does not exist"；迁移工具按文件顺序跑也会失败。这是"文档可读、不可执行"的典型问题，且会让 P0 建库任务直接阻塞。

**修正内容**
- 文件头新增**迁移执行顺序**（users→积分→admin→invite→models→assets→剧本/分镜→tasks/exports/shares→canvas→configs）；
- `tasks` 节补三条 `ALTER TABLE` 注释（tasks.episode_id/tasks.shot_id/exports.episode_id）；
- invite 节补两条 `ALTER TABLE`（created_by/flow_id），并注明在目标表建好后执行。

**落点**：database 头部、§3、§1.5。

---

### RE-11 导出部分成功规则缺失（验收不可判定）

**问题定位**
- `PRD.md` F2⑦：「异步导出…3 集×10 镜 zip 可下载」；
- `api-spec.md` §8：只有 `status/download_url`，无 included/missing；
- `WBS 1'.7`：「3 集×10 镜打包可下载」。

**原因说明**
流水线必然出现失败镜/未投镜，文档没有定义"部分成功时 zip 里有什么、是否允许导出、缺失镜如何告知"。RE 的 `export merge` 只合并**已定稿视频**、不会为缺失镜补生成，这正说明导出必须允许部分产物并显式标注；否则"3 集×10 镜全部成功"才可导出，与 92% 任务成功率的现实矛盾，验收失败。

**修正内容**
- 导出仅打包 `SUCCEEDED` 镜头 + `manifest.json`（失败/未投镜标注）；成功镜 <80% 拒绝（`400106 EXPORT_INCOMPLETE`）；
- `GET /exports/{id}` 增 `included_shots[]/missing_shots[]`；PRD 验收/ WBS/ testing 同步；"完集"定义（≥80% + 触发导出）与之一致。

**落点**：PRD F2⑦/验收；api-spec §1/§8；wbs 1'.7/M2；testing §2-8/§7；user-journeys J1。

---

## 4. P1 问题（逻辑/契约/合规冲突，已全部修订）

### RE-12 mode 与 scene 混淆、枚举交叉引用错误

**问题定位**：`api-spec` §5 把 `studio_asset_image` 与两个 scene 键并列在"scene 优先"；`database` 缺 `tasks.scene`；`ADR-003` 写"mode 枚举见 api-spec §4"（实为 §5）。
**原因说明**：RE 中 `studio_asset_image` 是 image 的 generation mode（有 endpoint），`script_to_scene_refer`/`storyboard_reference_video` 才是分镜专用参数覆盖键；混用会让资产生图校验走错分支，`tasks` 也无法记录 scene 导致断点续跑/审计丢失。
**修正内容**：api §5 明确两层校验（mode→scene 覆盖），scene 仅两个键、资产用 mode；database 增 `tasks.scene`；ADR-003 改 §5；mode 枚举说明"覆盖 RE 11 个 generation mode，upscale 等为 MVP 后处理子集"。

### RE-13 错误码来源混淆与缺码

**问题定位**：`api-spec` §1 把 745703/7460xx 与 RE 的 745701 并列，未标来源；745702 无使用点；缺 400104/400105/400106。
**原因说明**：RE 只实测 `745701` 与 `741001`；版本冲突/节点锁在 RE 是 CLI 进程退出码 9/10，不是业务码。文档若不标来源，会被误读为"竞品同码"，后续排障按错码表处理；缺码则 RE-04/06/11 的新分支无错误语义。
**修正内容**：错误码表后加"来源与偏离声明"；补 400104/400105/400106/400107；745702 绑定 `quote_id`；746002/746003 标注仅 Ph3 且对应 exit 9/10；741001 声明不用（改用 304+ETag）。

### RE-14 积分 expire 语义内部冲突

**问题定位**：PRD F6 声明"永不过期/无 expire"，database `credit_flows.kind` 却含 `expire`；RE 余额有 `expire_soon_val` 等 7 桶。
**原因说明**：既然 Alpha/Beta 不设有效期，`expire` 流水永远不会产生，保留会诱导实现者写出无来源的过期扣减，破坏对账；RE 的 7 桶是团队+VIP 阶段形态，MVP 简化必须显式声明，避免 FE 按 RE 字段取值时拿到 `undefined`。
**修正内容**：`credit_flows.kind` 去掉 `expire` 并注明"若将来引入有效期，新增 kind 并同步不变式"；`/me` 与 PRD 说明"RE 7 桶为竞品形态，MVP 只暴露 balance/frozen"。

### RE-15 data_center 取值与 domainMap 不符

**问题定位**：`database.users.data_center` 默认 `'cn'`，注释写"预留多区域(竞品 domainMap 思路)"；`system-design §5` 称对标 eus/eop/sgp。
**原因说明**：RE 实测 `data_center:"sz"`，数据面 `domainMap={sz,eus,eop,sgp}`，且 `task/result` 按 `user-info.data_center` 路由。默认 `'cn'` 既不在四区枚举内，也无法直接映射到数据面，出海时会路由失败。
**修正内容**：默认改 `sz`，注释列四区并说明按 `data_center` 路由；system-design §5 同步。

### RE-16 Sentry 境内合规冲突

**问题定位**：`compliance D4` 明确"不用境外 Sentry SaaS"；`observability §5` 只写"前后端共用 DSN"；`deployment` 只列 `SENTRY_DSN`。
**原因说明**：默认接 Sentry US 会直接违反 D4；仅靠合规清单提醒，开发和部署仍可能接境外 DSN，且 Sentry 事件可能携带用户级数据。
**修正内容**：observability 写明 DSN 指境内/自建，未就绪前关闭用户级上报（只报 code/route）；deployment 环境变量注释同口径；compliance D4 与之一致。

### RE-17 交叉引用错误与缺失 ADR

**问题定位**：ADR-004 把"冻结中"文案指向 PRD F5（F5=资产库）；compliance B3 写"MVP F6"（F6=积分）；security 写"api-spec §12"（§12 是版本策略，限流是 §13）；api/database 引用 ADR-007/ADR-008，但 adr.md 只有 001~006。
**原因说明**：编号漂移会让评审/实现按错误章节执行；被引用但不存在的 ADR 说明手机号双列、refresh Cookie 两个关键安全决策没有决策记录，属于逻辑链断裂。
**修正内容**：全部改正编号；补 **ADR-007（手机号 HMAC 等值 + AES-GCM 密文）** 与 **ADR-008（refresh 仅 HttpOnly Cookie + 单设备轮换）**。

### RE-18 画布节点类型 9 vs 11

**问题定位**：`database §7 canvas_nodes.node_type` 仅 9 类；RE `node.md` 为 11 类（含 `director`、`threeDWorld`），且 video settings 有 `duration/enableSound/mouthDrive/shotType/offPeak/fps`。
**原因说明**：虽为 Ph3 占位，但 schema 是后续 v1.5 的契约；少两类会导致节点持久化丢类型，或上线前再做破坏性迁移。
**修正内容**：补 `director/threeDWorld` 与 `name/width/height`，注释 settings 字段与 11 类来源。

### RE-19 漏斗缺资产定稿环节

**问题定位**：`metrics §2` 漏斗从 `characters_generated → portrait_ready` 直接到 `storyboards_generated`；`§3` 无 asset_finalize 事件。
**原因说明**：RE 的资产硬门（`hitl.asset-ready`）是流水线真实卡点；漏斗缺这一环，Alpha 卡点报告无法区分"没做角色图"与"做了未定稿"，也无法验证 RE-04 的门槛是否生效。
**修正内容**：漏斗插入 `assets_finalized`，事件表补 `asset_extract/asset_finalize`；`credits_hint` 增 `reason`。

### RE-20 WBS 交付缺口与排期冲突

**问题定位**：新增契约（拆集/定稿/AI 标识/分享/批量报价）在 WBS 无任务；`v1.1 W13-17` 与 PRD「Beta 后 4~6 周」（W16-18）不符，`v1.5 W16-20` 与「Beta 后 6~8 周」（W18-20）不符。
**原因说明**：WBS 是执行基线，缺任务意味着这些 P0 项不会进入迭代；排期冲突会让"1~2 人"的资源规划失真（v1.1 与 v1.5 重叠 2 周且早于承诺起点）。
**修正内容**：补 1'.2 拆集、1'.3 定稿、1'.4 模型校验/预算、1'.7 分享/导出规则、1'.8 AI 标识；M2 DoD 扩为 9 条；v1.1 改 W16-18、v1.5 改 W18-20；1.2 种子要求含 `mode_order`/scene 键。

---

## 5. P2 与"有意偏离"（不改或仅声明）

| 编号 | 事项 | 判定 | 处理与理由 |
|---|---|---|---|
| RE-21 | 端点命名不一致（journeys 写 `export-zip`，api 写 `export`） | 已修 | J1 改 `POST …/episodes/{eid}/export`；同名端点只保留一处 |
| RE-22 | `Authorization: Bearer <JWT>` vs RE 裸 token | 有意偏离 | 自有 JWT 是 ADR-006 的明确决策（RE 依赖万兴 SSO）；保留，ADR 已说明"改进点" |
| RE-23 | 任务删除/regenerate/feedback、Excel 批量回填、成员评论 | 有意偏离 | RE 有，但 MVP 不做；已写入 PRD §5 Non-goals 与 api §6 声明，避免验收扩散 |
| RE-24 | OSS `object_key` 布局、`sign-url` 用 POST | 有意偏离 | 自有命名空间与预签名实现；已补 `expire` 参数（上限 24h）与 RE 的 86400 对齐 |
| RE-25 | `复刻蓝图.md` 历史数值（如 Seedance 按秒 0.75~2.27 元/秒） | 历史件 | 不改写历史正文；仅在废弃横幅加注"以 RE 报告 0.25~2.27 元/秒为准"，并重申不得作为实施依据 |

---

## 6. 修订清单（可直接按文件核对）

| 文件 | 主要修订点 |
|---|---|
| `PRD.md` | 导入剧本拆集、资产定稿门槛、模型驱动时长、批量报价预算、逐镜 745703、导出 manifest/400106、分享可撤销、LLM 超时双口径、对账不变式、AI 标识落地、任务 Non-goals |
| `user-journeys.md` | J1 全链路（拆集/定稿/mode/scene/批量报价/导出路径/异常码）、J3a-1 部分成功语义 |
| `metrics.md` | 漏斗 `assets_finalized`、事件 `asset_extract/asset_finalize`、`credits_hint.reason` |
| `api-spec.md` | 模型目录字段、批量/单条报价与 `quote_id`、mode/scene 两层校验、split/share/export 契约、400104~400107、码表来源声明、限流与请求头 |
| `database.md` | 迁移顺序与前向外键、models/model_prices 目录字段、project_assets 定稿、tasks.scene、task_shares、credit_flows、data_center、画布 11 类节点、索引 |
| `system-design.md` | AI 标识 post-process 时序与失败模式、script 职责、data_center 路由 |
| `adr.md` | ADR-003/004 引用修正、ADR-007/008 补齐、ADR-005 标识落地 |
| `conventions.md` | 目录驱动 ModelPicker（mode_order/scene/label-value/批量报价）、轮询 reviewing 态 |
| `dev-workflow.md` | PR 自检补模型目录契约快照 |
| `testing.md` | 不变式口径、模型目录快照、批量/定稿/时长/导出/分享用例、AI 标识冒烟 |
| `deployment.md` | ffmpeg/字体/水印 env、worker 镜像、exports/shares 清理任务、Sentry 境内 |
| `observability.md` | Sentry 境内/自建、AI 标识失败率 |
| `security.md` | 不变式口径、分享 token 安全、频控引用改 §13 |
| `compliance.md` | B3 编号与落地、Sentry D4 同口径、分享页举报/下线 |
| `wbs.md` | 1'.2/1'.3/1'.4/1'.7/1'.8、M2 九条、v1.1/v1.5 排期、1.2/1.5 DoD |
| `README.md` | v1.3 变更登记、审查报告索引、文档版本表 |
| `复刻蓝图.md` | 仅加数值口径注记（历史件） |

---

## 7. 复验方法与结果

已执行以下静态复验（在 `docs/` 全目录）：

| 检查 | 结果 |
|---|---|
| `余额+冻结` / `balance+frozen == Σ流水` / `Σflows` 残留 | 0（PRD/testing/security 已统一为 delta/frozen_delta） |
| `4/5/6/8/10` 作为全局时长档位 | 0（仅保留"不做全局固定档位"的否定表述） |
| `asset_image`（旧 scene key） | 0（全部为 `studio_asset_image`，且已标注为 mode） |
| `export-zip` | 0（统一为 `/export`） |
| `PRD F5/F6` 错引、`api-spec §12` 错引 | 0 |
| 被引用但缺失的 ADR-007/008 | 已补齐 |
| 前向外键无 ALTER 说明 | 0（tasks/exports/invite 均有） |
| 预算 745703 语义（PRD/api/journeys/testing/WBS） | 5 处一致：HTTP 200 + `items[].code=745703` |
| 模型目录字段（database/api/conventions） | 三处均含 `mode_order`、`endpoint`、`default_*`、`resolution_options{label,value}`、scene 两键 |

> 说明：本次为文档审查，未执行代码/DB 迁移；DDL 与契约的最终机器验证应在 P0 脚手架建库后由 `testing.md` 的契约测试与 `drizzle-kit` 迁移演练完成。

---

## 8. 残余风险与后续动作

1. **模型目录导入是执行风险最高的动作**：46 → 8~10 行的映射必须保留 `mode_order/endpoint/scene`，建议 P1 先做一次"导入脚本 + 快照契约测试"，否则 UI 会在模型切换时出现非法枚举（已写入 WBS 1.2 与 dev-workflow 门禁）。
2. **AI 标识后处理的性能/成本**：ffmpeg 转码会拉长任务时长并占用 worker CPU，需在 k6/容量模型中补一条（当前 WBS 未单列压测，建议 M2 前补）。
3. **`need_vip` 与三价通道**：MVP 只启用原价+划线，若 Beta 前引入 VIP，需同步 `quote` 的 `discount` 与 `member_credits`，否则 RE 的"会员价"信息在目录中存在但无法结算（已留字段与注释）。
4. **分享的合规下线**：公开页需接入举报入口与"一键撤销该任务全部 token"；这是流程而非纯技术项，建议在 Alpha 运营 SOP 中固化。
5. **历史件（复刻蓝图）不再维护**：数值以 RE 报告为准；若后续有人引用蓝图实施，README 已有"不得作为实施依据"横幅，本次再加数值注记。

---

*本报告与 `docs/` 修订同批落盘；后续任何契约变更请按 README「文档维护规则」在同一 PR 更新文档与契约测试。*
