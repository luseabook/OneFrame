# 项目文档中心

> 项目代号未定（下称"本产品"）。AI 漫剧/短剧一站式生产 SaaS。
> 代码仓库：<https://github.com/luseabook/OneFrame>（仓库根；`docs/` 为本文档体系，`app/` 为 P0 代码脚手架）
> 文档体系版本 v1.3 · 2026-10-24 建立 / 同日 v1.1：**MVP 重定为剧本流水线首发（路线 A）**——工具箱缩为 2 入口、支付移至 Beta、无限画布列为 v1.5 承诺；受影响文档 PRD/旅程/指标/WBS/api-spec/database/system-design/testing 已同步
> v1.2 修订范围：按启动前审查报告（56 项）修订产品侧与计划侧文档，详见下方「变更登记（2026-10-24 修订）」；技术侧文档由架构师并行修订
> v1.3 修订范围：按《逆向一致性审查》（RE-01~RE-20）修订 17 份文档的设计点——模型目录驱动参数、资产定稿门槛、预算/报价语义、导入剧本拆集、导出部分成功、分享契约、对账不变式、AI 标识交付任务等；审查报告 `deliverables/software-company/wanxing-reverse-consistency-review-2026-10-24.md`，证据以 `rea-reelmate/REELMATE-逆向分析报告.md` 及附件为准

## 文档地图与阅读顺序

| # | 文档 | 作用 | 谁读 |
|---|---|---|---|
| 1 | [01-product/PRD.md](01-product/PRD.md) | 产品需求：愿景、用户、功能规格与验收标准 | 全员 |
| 2 | [01-product/user-journeys.md](01-product/user-journeys.md) | 四条核心用户旅程（页面/API 全链路映射；J4 为 v1.5 画布预览） | 产品+前后端 |
| 3 | [01-product/metrics.md](01-product/metrics.md) | 北极星指标、埋点事件表 | 产品+数据 |
| 4 | [02-architecture/system-design.md](02-architecture/system-design.md) | 总体架构、模块边界、关键时序、失败模式 | 全员技术 |
| 5 | [02-architecture/adr.md](02-architecture/adr.md) | 架构决策记录 ADR-001~006（为什么这么做） | 全员技术 |
| 6 | [02-architecture/database.md](02-architecture/database.md) | 完整 DDL、ER 图、索引与数据生命周期 | 后端 |
| 7 | [02-architecture/api-spec.md](02-architecture/api-spec.md) | 全量 API 契约（v1） | 前后端 |
| 8 | [03-frontend/conventions.md](03-frontend/conventions.md) | 前端架构、状态、组件与性能预算 | 前端 |
| 9 | [04-engineering/dev-workflow.md](04-engineering/dev-workflow.md) | Git 流程、提交规范、评审、CI | 全员技术 |
| 10 | [04-engineering/testing.md](04-engineering/testing.md) | 测试策略（金字塔、适配器契约测试、压测） | 全员技术 |
| 11 | [05-ops/deployment.md](05-ops/deployment.md) | 环境矩阵、部署、环境变量、备份回滚 | 后端/运维 |
| 12 | [05-ops/observability.md](05-ops/observability.md) | 日志、指标、告警、值班 | 后端/运维 |
| 13 | [06-security-compliance/security.md](06-security-compliance/security.md) | 威胁模型与安全设计 | 全员技术 |
| 14 | [06-security-compliance/compliance.md](06-security-compliance/compliance.md) | 中国合规清单（备案/标识/PIPL/内容安全） | 创始人+法务 |
| 15 | [07-plan/wbs.md](07-plan/wbs.md) | 工作分解、里程碑 DoD、依赖 | 全员 |

## 与《复刻蓝图》的关系

`E:\wanxing\复刻蓝图.md` 是 v0 决策草案（2026-10-24），其内容已被本体系**吸收并深化**：§0-1 → PRD + system-design；§2 → database.md；§3 → api-spec.md；§4 → system-design + ADR；§5 → frontend/conventions；§6 → wbs；§7 → deployment/security/compliance；§8 → PRD 差异化章节。此后以 docs/ 为唯一事实来源，蓝图仅作历史参考。

竞品证据（ReelMate 逆向报告、46 模型目录等）在 `E:\wanxing\rea-reelmate\`，各文档以〔RM-证据〕标注引用。一致性审查报告见 [wanxing-reverse-consistency-review-2026-10-24.md](../deliverables/software-company/wanxing-reverse-consistency-review-2026-10-24.md)（RE-01~RE-20，逐项含问题定位/原因说明/修正内容）。

## 文档维护规则

1. 改代码的 PR 若影响契约/表结构/协议，**必须同一 PR 改文档**，否则不予合并；
2. ADR 只增不改：推翻旧决策时新增一条并标记旧条 Superseded；
3. 每个里程碑（wbs.md）收尾时做一次文档对账；
4. 文档内不写密钥、内部 IP、账号；
5. **能力与交互以参照站已取证的行为为准**（ADR-013，Owner 2026-10-26 定为标准）：
   取证到的**照做**（含"看着绕"的步骤，如表格导入两步式、拆分资产带 `active_tab`、批量下载要下载单）；
   取证不到的**登记待取证、不臆造替代方案**；偏离必须在 `api-spec` 对应节写"偏离说明"并给理由，
   且只允许"与既有 ADR/不变式冲突"或"照做有安全/正确性风险"两类。
   每个新增端点/交互在 PR 描述里写一句参照证据（`文件:行` 或抓包 transaction）。

## 变更登记（2026-10-24 修订）

按启动前审查报告（`deliverables/software-company/wanxing-doc-review-2026-10-24.md`）修订，对应问题编号如下：

**产品侧（产品经理修订，本次已改）**

| 文档 | 版本 | 对应问题编号（摘要） |
|---|---|---|
| 01-product/PRD.md | v1.2 | P0-01（七处"同 v1.0"展开为自包含规格）、P0-06/P2-12（Alpha 观察口径、完集工程口径）、P1-01/02/04/06（字数/版本标签/预算/邀请码）、P1-14/20（AI 双标识、90 天删除告知）、P2-13/15/16 |
| 01-product/user-journeys.md | v1.2 | P1-01（5 万字口径）、P1-04/05（预算触顶 745703 与余额不足 745701 分支、续投显式新预算）、P1-12（导出异步） |
| 01-product/metrics.md | v1.2 | P0-06（episode_completed 工程口径）、P1-18（export_submit/export_ready/shot_download/asset_promote 事件）、P2-16（30min 人工操作口径）、工具→建项转化率观察指标 |
| 07-plan/wbs.md | v1.2 | P0-08（0.5 前置 D0 注记）、P2-06（百炼适配器 1.6）、P1-12（1'.7 导出 zip）、P1-13（2.1 全页）、M2 DoD 补 PRD F2 六条验收 |
| README.md | v1.2 | P2-17（四条旅程）、P1-19（变更登记）、P0-08（未决事项阻塞注记） |
| 复刻蓝图.md | v1.0（加废弃横幅） | P2-11（标注 Superseded，不得作为实施依据） |

**技术侧（架构师并行修订）**

api-spec / database / system-design / adr / conventions / dev-workflow / testing / deployment / observability / security / compliance——对应 P0-02/03/04/05/07/09/10 及 P1-07/08/10/11/14/15/16/17/21/22/23/24 等技术侧条目，以各文档头部变更说明为准。

## 变更登记（v1.3 · 逆向一致性审查）

按 `deliverables/software-company/wanxing-reverse-consistency-review-2026-10-24.md`（RE-01~RE-20）修订：

| 文档 | 版本 | 对应问题编号（摘要） |
|---|---|---|
| 01-product/PRD.md | v1.3 | RE-01 预算/报价、RE-03 模型目录驱动时长、RE-04 资产定稿、RE-06 导入剧本、RE-08 分享、RE-09 LLM 超时、RE-11 导出部分成功、RE-14 积分口径 |
| 01-product/user-journeys.md | v1.3 | J1 全链路（拆集/定稿/批量报价/导出路径）、J3a-1 逐镜 745703 |
| 01-product/metrics.md | v1.3 | RE-19 assets_finalized 漏斗与事件、credits_hint reason |
| 02-architecture/api-spec.md | v1.3 | RE-01/03/04/05/06/07/08/11/12/13：模型目录字段、批量报价、scene 枚举、split/share/export 契约、错误码来源与 400104~400107；v1.3 与实现同步 audio_video_support |
| 02-architecture/database.md | v1.3 | RE-01~RE-20 全部；v1.3 与 P1.2 实现同步 models 展示字段与 16 表迁移 |
| 02-architecture/system-design.md | v1.1 | RE-07 AI 标识后处理、RE-15 data_center 路由、RE-04 资产校验模块职责 |
| 02-architecture/adr.md | v1.1 | RE-17 交叉引用修正；补 ADR-007（手机号双列）/ADR-008（refresh Cookie） |
| 03-frontend/conventions.md | v1.1 | RE-03 目录驱动参数与批量报价 |
| 04-engineering/testing.md | v1.1 | RE-02 不变式、RE-03/04/05/11 用例、RE-07 冒烟、模型目录快照 |
| 05-ops/deployment.md | v1.1 | RE-07 ffmpeg/水印字体环境、RE-11/15 清理任务、Sentry 境内 |
| 05-ops/observability.md | v1.1 | RE-16 Sentry 境内/自建 |
| 06-security-compliance/security.md | v1.1 | RE-02 不变式、RE-08 分享安全 |
| 06-security-compliance/compliance.md | v1.1 | RE-07/17 AI 标识落地与 F 编号修正 |
| 07-plan/wbs.md | v1.3 | RE-04/06/07/08/11/20：拆集、定稿、AI 标识任务、分享、排期对齐 |
| README.md | v1.3 | 本条变更登记与审查报告索引 |

## 变更登记（v1.4 · 商业化就绪代码侧 · 2026-10-25）

按 B 型「能真实收钱跑业务」目标补齐真实渠道/供应商/合规/可运维代码项，文档同步如下（证据见 `deliverables/software-company/` 下各轮交付物与 `_acceptance/b-type-acceptance.ps1`）：

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| 02-architecture/api-spec.md | v1.4 | §10 支付改写：§10.1 端点（含 `/billing/channels`、pay_params）、§10.2 渠道回调（原始体验签/证书轮换/渠道 ack/真实失败状态码）、§10.3 幂等与安全、§10.4 渠道协议、§10.5 退款（管理端全额/幂等/余额保护/渠道失败回滚） |
| 02-architecture/database.md | v1.4 | orders 增 `pay_params`（0008）与退款五字段（0009）；credit_flows `kind=refund` 与 creditOut 不变式 |
| 02-architecture/system-design.md | v1.2 | §4.1 适配器契约：统一 `VendorError` 错误映射表、Ark 图像（Seedream）协议与 registry 规则、审核拒绝识别与重试边界 |
| 05-ops/deployment.md | v1.2 | §6 健康检查/指标/停机、§7.2 退款 SOP、§7.3 微信平台证书轮换、§8 上线前 72h 演练 D1–D9 |
| 05-ops/observability.md | v1.2 | §1 request_id 规范与 12 字段日志表、告警口径、§7 自检 |
| 06-security-compliance/compliance.md | v1.2 | E3 退款口径精确化；G 节改为引用 launch-checklist（单一事实来源） |
| 06-security-compliance/launch-checklist.md | v1.1（新增） | 上线合规唯一 gate：外部资质 EXT-01~20 + 代码侧 66 项（含退款/证书轮换/生产守卫/验收脚本），`node _acceptance/compliance-check.cjs` 可复跑 |
| README.md（根/app） | v1.4 | 商业化就绪验收命令与状态清单 |
## 变更登记（v1.5 · canvas 前端落地 · 2026-10-26）

**范围**：`/canvas` 从"只有一个空态列表页"做到可用编辑器。证据与实测记录：
`_acceptance/_gap/canvas-frontend-baseline.md`（环境陷阱 / 改造前基线 / 参照站实测结构 / 有意差异）。
验收：`node _acceptance/e2e-canvas-editor.cjs`（23 项，真实浏览器 + API 交叉核对）+ `pnpm --filter @app/api test`（258 例）。

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| 02-architecture/api-spec.md | v2.1 | §14.4.1 补 `commit` 的 `id_map` 语义（本地临时 id → 雪花 id；修正前非数字 id 直接 500，整图提交不可用）；新增 §14.4.2 画布前端已实现能力与"明确不做"清单 |
| 03-frontend/conventions.md | 未改（画布令牌与组件在 `_acceptance/_gap/canvas-frontend-contract.md` 冻结） | — |
| README.md | v1.5 | 本条变更登记 |

**同时修正的代码缺陷（不只是文档）**：
1. `canvas.service.ts` `commit`：非雪花 id 抛 `SyntaxError` → 500。改为"非雪花 id = 新节点"，并回传 `id_map`；补 2 条回归测试。
2. `assets/css/canvas.css` 未被任何地方 import → 所有 `cv-*` 类运行时不存在（typecheck/lint 发现不了）。已在 `nuxt.config.ts` 的 `css` 数组挂载。
## 变更登记（v2.3 · 视频拆解 `video-parse` · 2026-10-26）

**范围**：canvas C6「节点派生任务」里最后一条已取证的派生族。参照站的视频节点上有「拆解」
动作（拉片：从成片里抽角色/场景/道具），我方按 ADR-013 对齐**行为**、协议自研。

| 交付 | 内容 |
|---|---|
| 能力 | `tasks.mode=video_parse`（分析类，按次计价；单价由后台价目表配置） |
| 端点 | POST `…/nodes/{id}/video-parse {object_key?,prompt?,model?}` → `tasks`；GET `…/video-parse/{task_id}` |
| 产出 | JSON `{characters[],scenes[],props[]}`（与「拆分资产」同形）→ 写回 `params.result_text` |
| 前端 | 视频节点检查器「拆解视频」按钮 + 候选列表 + 一键建资产节点 |
| 验收 | `canvas-derive.spec` +2 例、`adapters.spec` mock 形状断言、E2E S20 五项（总计 97） |

**为什么"视频源"要单独判**：节点上没有视频也去拆解，模型会编出一整套角色/场景，
用户以为拆成功了——与 400105（资产未定稿）同一个思路：宁可挡住，不可假装成功。
显式 `object_key` 覆盖"素材库上传的视频"这条路，不让功能只能用于已出片节点。

**取证边界**：`routes.txt:370-371` 只有路径；bundle 的请求体 schema 为空。
所以字段名与响应内层结构是**自研**的（截图/抓包里没有证据），已写进 api-spec §14.4.8，
后续不得把"自研字段"当成参照站的事实引用。真实供应商下的"视频被模型看到"需要抽帧链路，
本轮按 X5 标注为**未真实联调**（mock 产出与真实路径同形）。

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| 02-architecture/api-spec.md | v2.7 | 新增 §14.4.8；§14.4.1「尚未实现」只剩 `pinned-timelines` / `group-recover` |
| README.md | v2.3 | 本条变更登记 |

## 变更登记（v2.2 · 分镜×资产匹配 + 「竞品怎么做我们就怎么做」成文 · 2026-10-26）

**1. 把 Owner 口径写成项目标准（ADR-013）**
"竞品怎么做我们就怎么做"不再只是口头约定：
- `02-architecture/adr.md` 新增 **ADR-013**（已取证即照做 / 未取证不臆造 / 对齐行为不对齐字段名 /
  偏离必须留痕，且只允许"与既有 ADR 冲突"或"照做有安全/正确性风险"两类）；
- `README.md` 维护规则加第 5 条（每个新增端点/交互在 PR 写一句参照证据）；
- `03-frontend/reference-alignment-spec.md` 头部写明这是指导思想。

**2. 按该标准补第四个文本能力：分镜 × 资产匹配（3 条端点）**

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `…/nodes/{id}/storyboard-asset-match` | 把拆分资产的角色/场景/道具按镜头对上去；候选资产可显式指定，默认取本画布全部 asset 节点 |
| POST | `…/storyboard-asset-match/cancel` | **复用 `tasks.cancel`**（终态不可取消 → 400103） |
| POST | `…/storyboard-asset-rematch` | 建**新**任务、不覆盖旧任务（用户要能对比两次匹配） |

- 400105（引用资产未定稿）在此落地：资产没有 `prompt` 就拿去匹配只会得到错配，比直接报错更糟；
- 前端：剧本节点第四个按钮 + 逐镜对照表（镜号/角色/场景/道具）；
- 验收：`canvas-derive.spec` 8 例（+匹配/重跑/取消/400105）；E2E S19 增至 9 项（共 92 项）。

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| 02-architecture/adr.md | — | 新增 ADR-013（项目标准） |
| 02-architecture/api-spec.md | v2.6 | 新增 §14.4.7（匹配四条约约定）；canvas 剩余派生族收敛为 `video-parse` 2 条 |
| README.md | v2.2 | 本条变更登记 |

## 变更登记（v2.1 · 拆分资产 · 2026-10-26）

按"竞品怎么做我们就怎么做"补齐第三个文本能力：**拆分资产**（角色 / 场景 / 道具）。
它与前两个走完全相同的任务脊柱与计价方式，没有引入新概念。

| 交付 | 内容 |
|---|---|
| 目录 | `deepseek-v4-pro.modes` 增 `asset_extraction`（`per_call`）；价目表增对应行（后台可改） |
| 端点 | `POST …/nodes/{id}/asset-extraction {active_tab?}` → `tasks`（`mode=asset_extraction`） |
| 产出 | 可解析 JSON `{characters[],scenes[],props[]}`；前端解析成候选 → 一键建 `asset` 节点（带 prompt） |
| 交互 | `active_tab` 与参照站一致：用户停在哪个 tab 就优先出哪一类，避免一次三屏 JSON |
| 验收 | `canvas-derive.spec` 6 例（含非法 `active_tab` → 400101）；E2E S19 增至 6 项 |

> 顺手把 mock 的资产产出改成**合法 JSON**：返回自由文本会让"解析失败"盖住真正的链路问题。

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| 02-architecture/api-spec.md | v2.6 | §14.4.6 增 `asset-extraction` 一行 + `active_tab` 语义；canvas 剩余派生族收敛为 7 条 |
| README.md | v2.1 | 本条变更登记 |

## 变更登记（v2.0 · 文本类能力 + 后台定价可写 · 2026-10-26）

**范围**：把上一轮标为"卡在定价决策"的文本类派生拆掉——按 owner 的口径：**价格在后台调，代码不写死**。

| 交付 | 内容 | 规模 |
|---|---|---|
| 能力 | `TextMode`（`script_optimization` / `storyboard_parse`）进 `tasks.mode` 枚举；`deepseek-v4-pro` 目录声明这两个 mode（`per_call` 按次计价） | — |
| 后台 | `POST /ops/admin/model-prices`（新增价目）+ `DELETE`，校验 mode/档位合法性 | 2 端点 |
| 画布 | 剧本节点「优化剧本 / 拆解分镜」按钮 → 落 `tasks` → 轮询 → `params.result_text` | 2 端点 |
| 执行 | mock 适配器按**文本模式**返回同步文本（不再返回 `.mp4` 假结果）；worker 回写 `result_text` | — |
| 验收 | `canvas-derive.spec.ts` 5 例 + 适配器 2 例 + E2E S19 四项 | +11 |

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| 02-architecture/api-spec.md | v2.6 | 新增 §14.4.6（文本派生四条约定）；§11 补价目写口与"为什么必须能建" |
| 02-architecture/database.md | v2.3 | `model_prices` 部分唯一索引 + 迁移 0017；§12.5 编号顺延（film → 0018） |
| README.md | v2.0 | 本条变更登记 |

**最关键的断言**（也是owner这句话的验收方式）：改掉 `model_prices` 里的金额后，同一请求的
`credits_estimate` **立刻跟着变**。代码里只要有一处"文本能力固定 N 积分"的常量，这条断言就会挂。

**本批修掉的真实缺陷**：
1. **按次计价的档位可以重复插入**：`uq_model_prices` 含 `duration_s`，而 PostgreSQL 认为 NULL
   彼此不相等 → `duration_s IS NULL`（文本/按次）的同一档位能插任意多行，`credits.price()`
   没排序，**扣多少钱取决于取到哪一行**。补部分唯一索引 `uq_model_prices_per_call`，迁移内含去重。
2. **后台只能改不能建**：加个新模式就得改代码上架价目，"价格后台可调"名不副实。
3. **mock 的文本任务是错的形状**：`deepseek:chat` 在 mock 下走通用异步 mock，剧本优化会返回
   `.mp4` 的 mock 结果——前端要文本却收到视频 URI。改为按**文本模式**返回同步文本。
4. **原文与`prompt`会被混用**：剧本节点原文在 `params.sourceText`，`prompt` 是"额外要求"；
   混起来会导致用户写"镜头少一点"，系统把这句话当剧本送去优化。

## 变更登记（v1.9 · 节点产物批量下载 · 2026-10-26）

**范围**：`canvas` 收尾第二批。产物能生成、能存素材，但**拿不出去**——这是画布作为"生产工具"的
最后一环。本轮补上"打包 → 下载单 → 现签链接"。

| 交付 | 内容 | 规模 |
|---|---|---|
| 表 | `canvas_download_lists`（下载单，迁移 0016） | 1 表 |
| 后端 | `nodes/batch-download`、`download-lists`、`download-lists/{id}/url` | 3 端点 |
| 前端 | 检查器「批量下载」按钮 + 工具栏「下载记录」抽屉（列表 / 取链接 / 下载） | 1 组件 |
| 验收 | `canvas-download.spec.ts` 5 例（含"签名链接真能下到 zip"）+ E2E S18 七项 | +12 |

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| 02-architecture/api-spec.md | v2.5 | 新增 §14.4.5（下载单语义 + 产物两级来源 + manifest）；canvas 剩余项收敛为 3 类 |
| 02-architecture/database.md | v2.2 | §12.1 增 `canvas_download_lists`；§12.5 编号顺延（0016 被 canvas 占用，film 改 0017 起） |
| README.md | v1.9 | 本条变更登记 |

**本批修掉的 3 个真实缺陷（全都是"接口 200、用户用不了"）**：
1. **签名链接指向别人的端口**：`STORAGE_PUBLIC_BASE` 默认 `http://127.0.0.1:3000/v1`，
   而 3000 是另一个项目（`E:\ecpm`）的端口。于是所有资产/下载链接在本地栈里都指向别人的服务。
   接口"成功返回了一个 URL"，测试也只断言"有 URL"，所以一直没被发现。已在启动脚本显式注入，
   并把"链接必须指向本项目 api"写进 E2E 断言。
2. **`.zip` 没有 content-type**：`files/local` 的类型表缺 zip → 退化成 `application/octet-stream`，
   部分浏览器直接内联展示乱码。补齐 zip/音频/视频类型。
3. **下载单不落库就丢文件**：若只返一次性 URL，24h 后同一批产物再也取不到（用户第二天才来下载是常态）。

## 变更登记（v1.8 · 表格节点 Excel 导入 · 2026-10-26）

**范围**：补齐 `canvas` 最后一个"有明显 UX 空白"的节点类型。`table` 节点此前只能手填 JSON
（`sheets` 是自由结构），等于"画布上有这个节点但干不了它的本职"。

| 交付 | 内容 | 规模 |
|---|---|---|
| 后端 | `canvas-table-parser.ts`（按工作表的结构化 xlsx 读取，复用 jszip，**零新依赖**） | — |
| 后端 | `table/import` + `table/confirm-sheet`（两步式；Redis 票据 30min） | 2 端点 |
| 后端 | Fastify `bodyLimit` 1MB → 16MB（见下"修掉的缺陷"#1） | — |
| 前端 | 检查器表格面板：选 .xlsx → 列 Sheet（含行列数）→ 点「使用该表」写节点 | — |
| 验收 | `canvas-table.spec.ts` 8 例（运行时生成真 xlsx）+ E2E S17 八项 | +16 |

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| 02-architecture/api-spec.md | v2.4 | 新增 §14.4.4（两步式语义 + 容量上限 + 为什么解析器不复用剧本域）；§14.4 "尚未实现"清单收敛为 3 族 |
| README.md | v1.8 | 本条变更登记 |

**本批的 3 个判断**：
1. **两步式不是形式主义**：多 Sheet 排期表自动取第一个 = 用户以为导了「镜头表」实际存了「角色表」，
   错得无声无息。第一步只回清单 + 5×8 预览，第二步显式确认。
2. **解析器不复用剧本域的 `parseScriptFile`**：那个产物是扁平制表符文本（服务"把小说读成一段"），
   表格要的是按表按行列的结构。共享的只有 `common/base64.ts`。
3. **容量上限是主路径保护**：≤20 表 / ≤2000 行 × 60 列 / 全簿 ≤6 万单元格。不限量会把 JSONB 参数
   撑到几十 MB，之后每次整图 commit 都要搬它——那是拿画布主路径给导入擦屁股。

**本批修掉的真实缺陷**：
1. Fastify 默认 `bodyLimit` 是 **1MB**，而两条 base64 上传路径（`projects/parse-script`、
   新增的 `table/import`）的解析上限写的是 8MB —— base64 膨胀后 ~11MB，**真实文件永远先被 413 拒掉**，
   文档里的 8MB 形同虚设。已抬到 16MB 并注明依据。
2. `xlsx` 的 Sheet 顺序不能靠文件名猜：Excel 存出来的工作表路径不保证是 `sheetN.xml`，
   必须按 `workbook.xml` 的 `r:id` + `workbook.xml.rels` 解析（本轮实现，并在测试里锁住）。
3. 空单元格会被"挤掉"列：按 `<c r="C3">` 的列号定位而不是按出现顺序，否则空列会导致整行左移。

## 变更登记（v1.7 · agent 对话域落地 · 2026-10-26）

**范围**：按迁移顺序（`cam 0013 → canvas 0014 → agent 0015`）推进到 `agent` 域。
把"画布能出片"再推进一步：**画布内 Agent 对话面板**（参照站右侧那一整块此前缺失）+ 对话式投递。

| 交付 | 内容 | 规模 |
|---|---|---|
| 后端 | 迁移 `0015_agent`（4 表 + `tasks` 两列）、`agent` 域 7 service / 2 controller | 20 端点 |
| 后端 | SSE 通道实装：事件落库 + `last_stream_id` 增量重放 + 心跳 + 任务流自动收尾 | 2 条流 |
| 后端 | `stream-token`（EventSource 无法带头）+ `@SkipEnvelope` 信封闭环 | 1 端点 |
| 前端 | 右侧 dock 改为页签（属性 / Agent）；`CanvasAgentPanel` + `useCanvasAgent` | 3 文件 |
| 验收 | `apps/api/test/agent.spec.ts` 13 例（含真实 SSE 连接断言） | +13 |

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| 02-architecture/api-spec.md | v2.3 | 新增 §14.9（`agent` 本体 9 + C7 族 11，含"未实现与理由"）；§14.6 修正 stream-token 形态 |
| 02-architecture/database.md | v2.1 | §12.2 按实际迁移定稿（3 处增量列 + 去掉 `turn_no/status` 的理由）；§12.5 标 0015 已落地 |
| README.md | v1.7 | 本条变更登记 |

**本批的 4 个设计判断（值得留档）**：
1. **`agent_sessions` 合表**：独立创作 Agent 与画布内对话是同一台对话引擎的两种作用域，
   用 `scope` 区分而不是两套表/两套流式协议——分叉的流式协议最后一定会行为不一致。
2. **SSE 是加速器不是状态存储**（ADR-012）：消息与事件都落库，REST 永远是权威；
   正因如此"消息与事件两次写入"的窗口是可接受的，不必为此把两张表塞进一个事务。
3. **游标语义自己定义**：`after_event_id` 做成不透明游标（=`seq`），保持参数名与参照站对齐，
   同时避免为分页引入映射表；SSE 续传另用真实 `stream_id`。
4. **stream-token 从"一次性"改为"120s 可复用 + 绑定会话"**：一次性会让每次断线重连必然 401，
   与 ADR-012 的"可重连、可降级"直接冲突；偏离处已在 §14.6 写明原因。

**本批修掉的真实缺陷**：
1. `generationRequestSchema` 默认 `resolution: "720p"`（视频档位）→ Agent 投递图像模型必报
   `resolution 720p not supported`；改为**从模型目录纠正档位**（与 canvas 节点任务同一个坑）。
2. `AuthGuard` 加 stream-token 分支时最初把"普通请求缺头"也报成 `missing stream token`，
   会让既有契约文案漂移（已改回 `missing bearer token`）。
3. `agent_message_bindings` 与 docs 定稿名 `agent_message_node_bindings` 不一致 →
   **回滚 0015、按文档名重新生成**（文档是契约源，不能反向将就实现）。
4. HITL 决策按钮最初要求 `content` 非空 → 前端只能伪造一句"同意"写进会话记录；
   改为 `decision` 可单独提交、正文可空。

## 变更登记（v1.6 · canvas 域逐项补齐 · 2026-10-26）

**范围**：把 `/canvas` 从"能摆节点、能保存"推进到"能出片、能复用、能协作"。
四批交付，每批都有 api 单测 + 浏览器 E2E 双门禁。

| 批次 | 内容 | 端点 | 提交 |
|---|---|---:|---|
| 1 | 画布域后端（迁移 0014 + 11 表） | 24 | `d22b2c2` |
| 2 | `commit` 接受本地临时 id + `id_map`（原实现 500，主流程不可用） | 修正 | `6c8cd69` |
| 3 | `/canvas` 前端编辑器（视口/连线/检查器/协作锁） | — | `74d7395` |
| 4 | 验收与环境可复跑（含"3000 端口是别人项目"陷阱留档） | — | `5639b7c` |
| 5 | **节点派生任务**（画布接进生成链路）+ **整画布模板** | 10 | `64badb3` |
| 6 | **素材库** + **画布批注** | 15 | `8abc114` |
| 7 | **固定组** + **节点组模板**（双写一致性有测试锁住） | 10 | `459dda7` |

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| 02-architecture/api-spec.md | v2.2 | 新增 §14.4.3：节点派生任务 4 / 整画布模板 6 / 素材 5 / 批注 10 / 固定组+组模板 10；§14.4.2 前端能力表补 5 行 |
| README.md | v1.6 | 本条变更登记 |

**本批修掉的真实缺陷（不只是补功能）**：
1. `canvas.service.ts` `commit`：非雪花 id 抛 `SyntaxError` → 500，"先加节点再保存"主流程 100% 失败
2. `assets/css/canvas.css` 未被任何地方 import → 所有 `cv-*` 类运行时不存在（typecheck/lint 发现不了）
3. 浮层 chrome 嵌在 `.canvas-stage` 内 → `setPointerCapture` 抢走按钮 click（"点 chip 没反应但按 Tab 能建节点"）
4. 新建节点落在检查器下面 / 连点两次完全重叠（用户点完看不到新节点）
5. worker 从不回写 `canvas_nodes` → 画布永远显示"生成中"
6. 批注层 `pointer-events:auto` 盖住画布 → 批注模式"点哪落哪"永不触发
7. 批注面板 z-index 低于检查器 → 「发送」按钮被拦截（看得见点不到）
8. 套用模板后归组必然失败（`local_` 临时 id 被拦）→ 改为自动保存再归组

**canvas 端点覆盖现状**（契约 73 条本体）：

| 子族 | 契约 | 已实现 |
|---|---:|---:|
| 画布根/节点/连线/锁/分组 | 30 | 27 |
| 整画布模板 | 8 | 6 |
| 节点派生任务 | 9 | 10（含 `video-parse` 2 条，C6 清零） |
| 素材 | 6 | 5 |
| 批注 | 10 | 10 |
| 固定组/组模板 | 13 | 10 |
| 图像编辑 clip/crop | 2 | 走 `sub_mode`，无独立端点 |
| 表格 Excel 导入 | 2 | 2（v1.8，两步式） |
| 画布内对话/SSE | 11 | 11（归 `agent` 域，§14.9） |
## 未决事项（Owner 补充后删除本节）

- [ ] 项目名称/域名（阻塞：备案、落地页文案；**阻塞：W1 0.5 备案**）
- [ ] 团队编制确认（当前假设：1~2 名全栈，见 wbs.md；**阻塞：W1 0.5 备案**）
- [ ] 主体公司（个体/有限公司）与支付主体（阻塞：微信支付申请；**阻塞：W1 0.5 备案**）

