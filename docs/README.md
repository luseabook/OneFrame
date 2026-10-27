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
| — | [01-product/reelmate-feature-map.md](01-product/reelmate-feature-map.md) | **竞品功能地图**（万兴剧厂 ReelMate 全站 7 域 / 三种编排皮 / 三份协议 / 商业闭环 / 攻击面）；分域深挖附录在 [_parts/](01-product/_parts/) | 产品+架构（对标依据） |
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
| — | [07-plan/implement-progress-vs-reelmate.md](07-plan/implement-progress-vs-reelmate.md) | **以竞品为标准的实现进度对照**（28 模块逐条 / 三口径进度 / 缺口排序 / 可复现命令）；排期与投入优先级的事实基线 | 产品+架构 |
| — | [07-plan/completion-plan-to-100.md](07-plan/completion-plan-to-100.md) | **补齐计划（8 批次）**：从 35.4% 到 100% 的分批执行路径、每批 DoD、排期预测、风险与明确不做项 | 全员 |

## 与《复刻蓝图》的关系

`E:\wanxing\复刻蓝图.md` 是 v0 决策草案（2026-10-24），其内容已被本体系**吸收并深化**：§0-1 → PRD + system-design；§2 → database.md；§3 → api-spec.md；§4 → system-design + ADR；§5 → frontend/conventions；§6 → wbs；§7 → deployment/security/compliance；§8 → PRD 差异化章节。此后以 docs/ 为唯一事实来源，蓝图仅作历史参考。

竞品证据（ReelMate 逆向报告、46 模型目录等）在 `E:\wanxing\rea-reelmate\`，各文档以〔RM-证据〕标注引用。一致性审查报告见 [wanxing-reverse-consistency-review-2026-10-24.md](../deliverables/software-company/wanxing-reverse-consistency-review-2026-10-24.md)（RE-01~RE-20，逐项含问题定位/原因说明/修正内容）。

**竞品功能地图（2026-10-27 新增）**：[reelmate-feature-map.md](01-product/reelmate-feature-map.md) 是竞品侧的**全站功能地图 + 产品逻辑图解**，用于"参照产品怎么做"这一标准的落地依据；其分域深挖附录（流水线 / 模型任务 / 画布 Agent / 商业化 / 影视版）在 [01-product/_parts/](01-product/_parts/)。数字口径与复跑命令见该文附录 A/C。

**实现进度对照（2026-10-27 新增）**：[implement-progress-vs-reelmate.md](07-plan/implement-progress-vs-reelmate.md) 把竞品 28 个模块逐条对照我方现状，给出三口径进度（模块加权 **35.4%** / 首发口径 **54.4%** / 核心闭环 **51.3%**）、剩余 133 权重的缺口排序与建议推进顺序。**口径是估算，引用须带文档内标注的基线 HEAD。**

**补齐计划（2026-10-27 新增）**：[completion-plan-to-100.md](07-plan/completion-plan-to-100.md) 是到 100% 的执行路径——8 个批次（地基 → 出片质量 → 小说链 → 能力 → 入口 → 影视版 → 生态 → 外延），每批有 DoD、判据与排期预测。**每批 DoD 未过不进下一批**。

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
## 变更登记（v3.5 · 创作者效果标签落地 + 主体模板 UI · 2026-10-27）

**#10 活动/创作者 98% → 99%**，**#17 资产/主体 96% → 98%**（全站 96.8% / 首发 97.4%）。

1. **`creator_assets.effect`（迁移 0033）**：对照 `crc/effect/tree` 的 6 个叶子（anime/realistic/ink/push/pan/handheld），
   `crc/resource/list` 的 `effect` 从"透传但不过滤（`effect_applied:false`）"变成**真过滤**（组合索引 `(status,effect,published_at desc)`）。
   创建/更新入参走白名单枚举；未知值 `400101` 并给出合法集合——避免"选筛选却查不到"的静默失配。
   更新时 `effect:null` 可清空，但沿用既有状态机（已通过作品需先下架才能编辑）。
2. **主体库模板 UI**：`SubjectLibrary` 接 `GET /subjects/templates` 目录下拉 + `POST /subjects/:id/apply-template`，
   提示"已追加风格前缀，原描述不变"；与自由填写的归类键 `template_key` 明确区分（两个动作、两种语义）。
3. **验证**：`crc.spec` 新增效果过滤用例（3 件作品 → 只命中 anime 那件；未知值 400101；草稿可清空；已通过拒绝编辑），
   共 16 例；全仓门禁 12/12 全绿（1,122 用例）。
## 变更登记（v3.4 · 资产/主体 IP 模板套用 + 进度数字重算 · 2026-10-27）

**模块 #17 资产/主体 92% → 96%**。竞品模板语义**未取证**，本轮按"自建口径但明确标注"落地：

- 新增 `modules/subjects/subject-templates.ts`：4 个预置模板（`ip-anime`/`ip-realistic`/`ip-3d`/`ip-guofeng`），
  每个含 `prompt_prefix` 与 `negative_prompt`；文件头写明「竞品证据不足 → 自建口径」，并明确不做"模板即换模型"的承诺。
- `GET /subjects/templates`（目录）与 `POST /subjects/:id/apply-template`（应用）：
  **只落 `template_key`，不改写用户的主体描述**——描述是用户的语义资产，模板前缀由生成侧派生
  （`prompt_template = desc + 前缀`），避免用户描述被越写越长且分不清哪句是自己写的。
- 生成链生效：`asset-gates.injectImagesWithTemplates()` 对已定稿资产关联的主体取模板前缀，
  追加到 `prompt_with_images` **末尾**（顺序：主体描述 → `[[@imgN]]` 标记 → 风格前缀），去重幂等。
- 验证：`test/subject-templates.spec.ts` 7 例（目录完整性/未知键/追加不覆盖/幂等/空描述/无模板零回归/逗号不重复）；
  `_acceptance/smoke-subject-template2.ps1` 真实 HTTP 四步（目录 4 条 → 应用后 `desc` 不变而 `prompt_template` 变长 →
  未知模板 400101 → 详情回显 + 列表按 `template_key` 过滤命中 1 条）。

**同时修正进度文档的算术漂移**：§3.4 汇总改为**从 28 行模块表直接重算**（core 106.54/110=96.9%、eco 92.48/96=96.3%、
全站 199.02/206=**96.6%**、首发 129.34/133=**97.2%**、剩余 **6.98**）。上一版把首发口径写成 99.3% 是逐轮手工加减累计出的错误。

## 变更登记（v3.3 · 工具箱图片链路修复：任务详情补签 URL + mock 产物改为真 PNG · 2026-10-27）

**模块 #6 工具箱 90% → 97%**。表面看是"补证据"，实际查出并修掉两个**真 bug**：

1. **`GET /tasks/:id` 不返回产物签名地址**：结果里只有 storage key（`u/<space>/tasks/<id>/r0.png`），
   前端把它直接当 `<img src>` → 浏览器按当前域请求该相对路径 → **裂图**（"裂图"与"生成失败"在界面上无法区分）。
   修法：`tasks.service.detail()` 对**已完成**任务为每个产物现签 1h URL（最多 8 张，轮询期不签，避免轮询成本）；
   `uri` 保留兼容；前端 `ImageGenWorkspace` 改为优先用 `url`（含历史缩略图）。
2. **mock 适配器把文本写进 `.png`**：`mock result for task ...` 43 字节文本存成 `r0.png`，解码必然失败。
   修法：新增 `apps/worker/src/mock-media.ts`（纯 Node 生成 64×64 真 PNG：IHDR/IDAT/IEND + CRC32，
   颜色由 taskId 派生），图片类 mock 产物现在是**可渲染的真图**；音视频 mock 保留文本占位并打 `mock_placeholder` 标记。

**验证**：`_acceptance/smoke-image-chain.ps1`（真实 API+worker）：
提交 `text2image` → 任务 succeeded → `results[0].url` 为现签地址 → 下载 **1174B、magic `89504e470d0a1a0a`、64×64 可解码 PNG**（已用图片查看器确认）；
`executor.spec` 新增 2 例（PNG magic / 非图片 placeholder 标记），worker 33 例全绿。

**进度**：全站 95.8% → **96.5%**；首发口径 98.2% → **99.3%**；剩余 7.90（工具箱只剩"真实供应商 Key"这一外部依赖）。

## 变更登记（v3.2 · 影视版离线通知 webhook，模块 #8 达 100% · 2026-10-27）

- 新增 `modules/film/film-notify.service.ts`：把 `task.notified` 等事件投递到**可配置 webhook**
  （企业微信/飞书/客户网关），`x-of-signature: sha256=<hex>` HMAC 签名 + 3 次指数退避（80/240/720ms）+ 2s 超时。
  未配置 URL → `delivery:"stored"`（事件仍在广播面/库中），**绝不假装推送成功**。
- `notifyAssignees` 响应新增 `delivery` / `delivery_attempts`；投递失败不阻塞主流程。
- `config/env.ts` 登记 `FILM_NOTIFY_WEBHOOK_URL` / `FILM_NOTIFY_SECRET`（均可选；服务内调用时读 process.env 便于测试切态）。
- 验证：`test/film-notify.spec.ts` **5 例**（未配置不发请求 / 真投递且签名可复算 / 500 重试 3 次后 failed /
  先 500 后 200 第 2 次成功 / 无密钥不发签名头）——用真实本地 HTTP 接收端，不是 mock fetch。

**模块 #8 影视版：95% → 100%**（xlsx 真导出 + 离线通知均完成；WS 真传输属网关部署项）。
**进度**：全站 95.5% → **95.8%**；首发口径 97.8% → **98.2%**；剩余 8.70。

## 变更登记（v3.1 · 影视版真 xlsx 导出 · 2026-10-27）

**模块 #8 影视版 95% → 97%**（权重 20）：`format="xlsx"` 不再是"给 CSV/ZIP 并诚实标注"，而是**真 OOXML xlsx**。

- 新增 `modules/film/xlsx-writer.ts`：用已有 `jszip` 拼 OOXML（**不引 exceljs/sheetjs**），支持多 sheet、inlineStr 文本、数字/布尔、表头加粗；
  不支持公式/合并单元格/图片（已在文件头写清）。
- `film.exports.service.ts`：CSV 与 XLSX 共用 `tableToMatrix()`（避免两种格式内容不一致）；`format=csv` 路径零回归；
  `delivered_format="xlsx"`、`file_uri=tables.xlsx`、正确 `content_type`。
- 安全：与 CSV 同口径的公式注入防护（`= + - @` 前缀单引号）。
- 验证：`test/film-xlsx.spec.ts` **9 例**；`_acceptance/verify-film-xlsx.cjs` **15/15** 真实 HTTP（登录→开 film_enabled→建两表→导出 2988B xlsx→jszip 解出 7 部件 + 两个 sheet 名）。

**进度**：全站 95.3% → **95.5%**；首发口径 97.5% → **97.8%**；剩余 9.30。

## 变更登记（v3.0 · 创作者中心 5 条路由补齐 · 2026-10-27）

**规模**：页面 60 → **64**（端点/表/迁移不变，复用既有 API）；进度文档全站 **94.3% → 95.3%**、首发口径 **96.0% → 97.5%**。

| 交付 | 内容 | 证据 |
|---|---|---|
| `/creator-center/[id]` | 作品详情：`readiness` 前置条件逐条展示、编辑（**`work_id`**）、提审/重新提审、下架 | `smoke-creator.ps1`：草稿→编辑→提审(2 待审核) |
| `/creator-center/earnings` | 收益总览（累计/可提/提现中/已打款）+ 提现申请 + 提现记录（含撤销）+ 收益明细 | 提现越界被拒 `400101 amount exceeds available balance`；两张表 total 回读 |
| `/creator-center/preview/[id]` | 视频/图片/文本三态预览 + 内容结构 + 复制站内预览链接 | 页面 200 + 详情/内容树端点 |
| `/creator-center/publish` | 表单 → 存草稿 / 提交审核；`readiness` 缺失项原样展示 | `POST works/save` → `POST works`(submit) |
| `script.projects` DTO | 透出 `project_mode`（1 普通/2 广告剧/3 视频转绘） | 修掉"前端无法区分广告剧/转绘项目"的真缺口 |

**三条口径**：收益不是积分余额（前端不复算可提额度）；提审前置条件由后端 `readiness` 一次给全；作品更新必须用 `work_id`（传 `id` 会被当成新建，已实测踩到并注释）。

| 文档 | 版本 | 变更 |
|---|---|---|
| 02-architecture/api-spec.md | §17.7 新增 | 创作者中心 5 路由映射 + 三条口径 + `project_mode` 修复 |
| 07-plan/implement-progress-vs-reelmate.md | **v2.3** | §0/§2/§3(#10 98%)/§3.4/§5(剩余 9.70)/§7/§9 重算 |
| README.md | v3.0 | 本条 |

## 变更登记（v2.9 · 补掉最后两个 0% 模块 + 8 个模块收尾 · 2026-10-27）

**规模**：端点 648 → **683**、页面 55 → **60**、表 110 → **111**（迁移 0031/0032）、测试 1,044 → **1,100 全绿**；
进度文档全站 **88.5% → 94.3%**、首发口径 **93.0% → 96.0%**。**全站已无 0% 模块。**

| 批次 | 交付 | 验收 |
|---|---|---|
| #13 广告剧（0%→90%） | 12 端点（五段：卖点/brief/剧本/分镜/资产）+ `/ad-drama/create`、`/workspace` + 13 例 | 真实链路：卖点 5 → brief 3 → 剧本 483 字 → 编辑 496 → 分镜 → 资产 → `stage 5/5` |
| #14 视频转绘（0%→90%） | 9 端点（8 竞品 + 1 列表）+ `/video-redraw/workspace` + 14 例 | 真实链路：切 3 集 → 20 镜 → 20 任务 → 绑定 20 → `stage done` |
| #20 ReelFlow（92%→97%） | `/watch/[token]` 公开播放页 + `GET/POST watch` + `view_count` 持久化（迁移 0032）+ 13 例 | 五态不白屏；非法 token 400102 |
| #17 资产（65%→92%） | `episode_resources` 集级快照（消除上轮"投影"偏离）+ `prompt_status` 7 条件 + 星标/IP 模板 + images 注入口径 + extraction 3 补面 | 相关 8 spec 共 104 例全绿 |
| #16 多语言（75%→92%） | 路径前缀中间件 + hreflang/x-default + sitemap/robots + 4 页迁移 | `x-default` 类型修复；web typecheck 0 错 |
| #9 CLI（75%→90%）/#7 团队（95%→99%） | CLI 骨架接通 + 计数单测断言；`requirePermission` 默认放行 + `enforced` 标记 | cli 83 例全绿；team 10 例无退化 |
| #2 小说（95%→98%） | characters 5 条**路径别名** + idea 详情/编辑 | 42 例连跑 3 次稳定；跨路径一致性断言（别名非副本） |
| 收尾零头 | 3D 删除 UI、后处理多框+撤销、首页运营位打点、quality-check 口径版本、分享打包上限 | 5 个 spec + 回归全绿 |

**三条判断仍然成立**（写进注释，防后续"优化"掉）：
1. **钱的红线**：所有生成/计费动作走 `credits/quote` + `tasks` 记账；广告剧每步回显消耗；播放量只做去重不刷量。
2. **待取证不臆造**：广告剧 `STAGE/STATUS` 值域、视频转绘 `redraw_strength` 可见效果、IP 模板渲染语义 —— 全部标"待取证/自建口径"，不写"已对齐竞品"。
3. **不假装**：视频转绘真实能力（无 Key → mock）、广告剧页面只有 HTTP 链路验证（缺浏览器点击 E2E）、权限拦截只落 3 个示范端点 —— 都在报告与本表里明写。

**顺手修掉的真缺陷**：4 个测试/隔离缺陷（worker 并行撞主键、market 脏数据、cli help 断言失效、`AssetDto` 重复声明）+ 2 个类型错（`x-default` hreflang 数组类型、`STORAGE_KEY` 未调用）。

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| 02-architecture/api-spec.md | **§17 新增** | 广告剧 12/视频转绘 9/播放 2 端点契约、资产快照口径、多语言路由口径、迁移 0031–0032 |
| 07-plan/implement-progress-vs-reelmate.md | **v2.2** | §0/§2/§3/§3.4/§5/§7/§8.3/§9 全量重算（全站 94.3% / 首发 96.0%；无 0% 模块，剩余 11.70 全部为外部依赖或取证） |
| 07-plan/completion-plan-to-100.md | v1.3 | §0.4 批次状态（第 3 轮完成，剩余项全部转"外部依赖清单"） |
| README.md | v2.9 | 本条变更登记 |
| _acceptance/_team/report-round3-lead.md | 新增 | 第 3 轮 Lead 复核记录（逐模块证据 + 诚实未完成清单） |

## 变更登记（v2.8 · 生态/收尾/外延轮次：创作者生态 + 集市 + 知识库 + 首发补全 + 多语言 · 2026-10-27）

**范围**：一轮推完第 6 批生态（创作者中心/运营增长/活动/集市/知识库）、首发补全（剧集子链/项目聚合/ReelFlow 发布/3D 导演台/账号 SSO/团队权限）、
收尾小项（首页配置/运营位/内容安全/分享批量/画布恢复）与多语言。**规模**：端点 414 → **648**、页面 48 → **55**、表 96 → **110**（迁移 0024–0030）、
测试 844 → **1,044 全绿**；进度文档全站 **66.0% → 88.5%**、首发口径 **83.0% → 93.0%**。

| 批次 | 交付 | 验收 |
|---|---|---|
| 生态 A 创作者 | `crc` 32 + `op` 42 + `campaign` 9 = **83 端点** + `/creator-center`、`/activities`、`/invite`；审核状态机、发分全走账本、兑换码唯一键并发、AB 一人一变体 | 41 例 + 真实 HTTP 8 步 |
| 生态 B 集市/知识库 | `market` 36 + `market-admin` 22 + `knowledge` 29；购买 `creditOut(consume)` 事务内、提现状态机不可跳步、审核留痕、内容树购买后可读 | 32 例 + curl 12 步（建→审→买→收益→提现→打款） |
| 小说链补完 | `original_script` 20 路由 + `reopen`（两级引用判据）+ 5 条薄路径 + Redis 会话锁 | 40 例 + 51 项 E2E |
| 首发补全 | 剧集 `quality-check`/`film-synthesis-export`/`parse` 子链、`/works` 三形态聚合、ReelFlow 切片发布 + 片段资产、3D 导演台 9 端点、账号 4 渠道 SSO + 双 token、团队权限码 70 条 | 各批 6~24 例；director 另 13 项浏览器 E2E |
| 收尾小项 | 首页 config/未读长轮询/AB、运营位 CRUD、captcha + text-detect、分享批量下载、画布 `nodes-recover` | 60 例（含"配置驱动闭环"断言） |
| 多语言 | 自建 i18n：312 key × 5 语言 + `X-Lang` + 6 页 + 壳层导航 | `i18n-check.cjs` 静态 + 浏览器 30 组合全绿 |
| 数据层 | 迁移 0024–0030（7 张新表组 + 若干列）；`creditOut.kind` 放宽为 `refund\|consume` | db 26 例 |

**三条判断（写进代码注释，防止后续"优化"掉）**：
1. **钱的红线**：所有发分/扣分走 `creditIn`/`creditOut` 记账；`refund`（退款）与 `consume`（消耗）分开记，混记会让对账的退款金额虚高；提现状态机不可跳步，并发靠唯一键 / `pg_advisory_xact_lock`。
2. **权限先目录后拦截**：团队权限码只做"目录 + 角色绑定存储"，不做接口级拦截——存量 13 个 e2e 的成员角色假设未先对齐，贸然拦截必红。
3. **生态域不必等拍板**：抽成比例/奖励额度/审核 SLA 全部落成**可配置常量 + 注释写明待定**，把"运营决策"与"技术实现"解耦。

**顺手修掉的真缺陷**：
1. **跨租户泄露**：`op_questionnaires.qkey` 全局唯一 + 答卷无 space 列 ⇒ 答卷是平台级；运营后台问卷列表/审核未收窄 → 任何团队管理员可翻别家团队留资。已加 `join space_members` 收窄，跨空间 404。
2. **运营特权越权**：创作者审核特权原来"任何人在自己个人空间都是 master"，能看别人空间草稿 → 收紧为"只在作品所属 space 内生效"。
3. **外键与身份混用**：`promo_slots.created_by` 原指向 `users`，运营 token 的 admin id 写进去 500 → 改指 `admin_users`（迁移 0028，迁移内先清空非法值）；`invite_codes` 同理新增 `owner_user_id` 与 `created_by` 分离。
4. **测试隔离**：worker test 脚本缺 `--no-file-parallelism`（并行撞 `users_pkey`）、`market.spec` 固定分类名 + cleanup 外键顺序错、`team.spec` 全库 Σdelta 断言仅串行成立——均已修/标注。

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| 02-architecture/api-spec.md | **§16 新增** | 第 2 轮端点总则、三处全局口径（details 不出网 / 双 token / 幂等沿用）、各批契约与偏离、迁移 0024–0030 |
| 07-plan/implement-progress-vs-reelmate.md | **v2.1** | §0/§2/§3/§4/§5/§7/§8 全量重算 + §9 变更登记（全站 88.5% / 首发 93.0%） |
| 07-plan/completion-plan-to-100.md | v1.2 | §0.4 批次状态（第 6 批完成；只剩广告剧/视频转绘整块） |
| README.md | v2.8 | 本条变更登记 |

## 变更登记（v2.7 · 六批次并行收口：小说链 / 影视版 / 工具箱 / Agent / 资产主体 / CLI · 2026-10-27）

**范围**：一轮把 `docs/07-plan/completion-plan-to-100.md` 的第 1/2/3/4/5/7 批全部落地，并补齐三个横切件
（数据层收尾、幂等账本、订阅制）。**规模**：端点 236 → **414**、页面 29 → **48**、表 49 → **96**（迁移 0018–0023）、
测试 488 → **844 全绿**；进度文档全站 **36.4% → 66.0%**、首发口径 **55.9% → 83.0%**。

| 批次 | 交付 | 验收 |
|---|---|---|
| 第 1 批 资产主体 | 主体库 7 + 抽取 6 + 匹配 5 端点；一致性三闸门（定稿→匹配→生成 `images[]` 注入）；`/assets` 三 tab | 29 例；project-assets 13 例不退化 |
| 第 2 批 小说链 | **64 路由 `/v1/novel/*`**（主链 37 + 剧本编辑 Agent 16 + 裂变 9 + 海外 2）+ `/novel`、`/novel/[id]` 七步工作台 | 25 例 + 51 项浏览器 E2E |
| 第 3 批 工具箱 | `GET /generations/tools` 目录驱动 **19 卡全可点**；15 个工具 mode 接线（不新增生成端点）；11 个新落地页；画布补 `video_upscale` | tools 15 例 + adapters 164 例 + 19 项 E2E |
| 第 4 批 Agent | Skill 卡市场 9 + STT 2 + 推荐卡 1 + 会话 8 端点；`/agent` 对话页（SSE 续传/降级轮询）；33 张平台卡幂等 upsert | 22 例 + 29 项 E2E |
| 第 5 批 影视版 | **49 操作 `/v1/film/*`**：任务表/字段/行/稀疏单元格/审核版本链 V01/画布绑定/`submit-result`/模板/导出/最近/统计 + `/film`、`/film/[id]` 表格视图 | 47 例 + 18 项 E2E |
| 第 7 批 CLI | 新包 `app/apps/cli`：**196 命令 / 37 组**（118 可用 + 78 骨架）、退出码 0..10、`--dry-run`/`--idempotency-key`、`workflow detect` 双作用域阶段机 | cli 83 例 + workflow 12 例 |
| 横切 | 迁移 0019–0023（22 张域表 + film 二等表 4 + 订阅 2 + 幂等三态列 + `storyboard_assets.sort`）；幂等账本三态；13 档订阅 + 动态价；`/task/result`/`regenerate`/`feedback` | db 26 例 / idempotency 7 例 / subscription 12 例 / tasks-batch 11 例 |

**三条判断（写进代码注释，防止后续"优化"掉）**：
1. **`generations` 仍是 1 个端点承载多 mode**（ADR-003）：工具扩面只扩 mode 枚举 + 分派 + 报价，不新增生成端点。
2. **`models` 单表承载两种语义**：竞品对齐目录 46 条（`visible=true`）+ 内部能力行 15 条（`visible=false`）。规则收敛为一句：**列表看 `visible`，按名查找不看 `visible`**。
3. **幂等必须服务端做**：客户端账本只能证明"我没收到响应"，不能证明"服务端没执行"；`idempotency_records` 三态（处理中/已完成/状态不明）+ `x-force-replay` 人工确认。

**顺手修掉的真缺陷**：
1. `app.vue` 的 `workspacePaths` 白名单漏了 `/team`（v2.6 起 `/team` 一直套在营销壳里）；本轮补 `/team`/`/novel`/`/agent`/`/film`，并把「三处齐改」写成约定。
2. `storyboard_assets` 无顺序列 → "保留绑定顺序"靠堆序，实测两次读取顺序不同（影响 `images[]` 的 `[[@imgN]]` 编号）。补 `sort` 列（迁移 0023）+ 读取处显式 `ORDER BY`。
3. `auditLedger` 全局计数在 dev 库有历史脏数据 + 并发写时必红 → 增加 space 作用域参数。
4. `/generations` 的 `options` 默认值被工具箱的 schema 扩展覆盖掉（老客户端/CLI 缺 `options` 直接 400101）→ `.default({})` 补回。

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| 02-architecture/api-spec.md | **§15 新增** | 六批次 + 三横切件端点总则、契约要点、偏离与待取证（§15.0–§15.10） |
| 07-plan/implement-progress-vs-reelmate.md | **v2.0** | §0/§2/§3/§4/§5/§7/§8 全量重算 + §9 变更登记 |
| 07-plan/completion-plan-to-100.md | v1.1 | §0.4 批次状态表（哪批已完成、哪批待运营策略） |
| 04-engineering/testing.md | — | 待补：`verify-round.ps1` 一键门禁与 flake 处置（下一轮） |
| README.md | v2.7 | 本条变更登记 |

## 变更登记（v2.6 · cam 团队管理收口 · 2026-10-27）

**范围**：F1 四域里的 `cam` 收口。参照 `cam` 39 条，我方此前 19 条；本批补齐**可落地**的 6 条，
剩余为项目维度流水（需先定项目↔流水的映射口径）与待取证项（BYOK/temp-info）。

| 交付 | 内容 |
|---|---|
| 端点 | `PATCH /cam/team/info`（改名/席位/开关）、`GET group/{id}/stats`、`GET member/{id}`、`PATCH member/{id}/name`、`POST batch-points-allocation`、`GET points-flow/export`（CSV 现签链接） |
| 前端 | [team.vue](app/apps/web/pages/team.vue)：团队设置弹窗、选中成员后「批量分配」、流水「导出流水」、积分页「分组统计」表 |
| 基础设施 | `files/local` 补 `csv` content-type（缺了会退化成 octet-stream：浏览器内联乱码或另存成 `.csv.txt`） |
| 验收 | `team.spec` 8 → **10 例**；新增 [e2e-team.cjs](_acceptance/e2e-team.cjs)（16 项）+ [team-acceptance.ps1](_acceptance/team-acceptance.ps1) 一键复跑 |

**三条判断**：
1. **席位不得低于现有成员数**：否则下一次邀请会被自己的配置锁死，且列表出现"已用 4 / 上限 3"。
2. **批量分配逐条独立**：与画布 `batch-node-tasks` 同一判断——包事务会让"第 12 条余额不足 →
   前 11 条全部回滚"，与"能分的都分出去"相反；失败项带回 `code` 让前端能逐条说明。
3. **昵称与角色/状态分两个端点**：混在一起会让"我只想改个名字"也要求管理员权限。

**顺手修掉的同类缺陷**：`/team`（以及 `/login`、`/pricing`、`/report`、`/privacy`、`/terms`）
同样只写了 `definePageMeta({ssr:false})` 而 `routeRules` 没关 SSR → 直接打开会 hydration mismatch
（v2.4 修 `/create/*` 时只补了工具页）。本轮按"meta 已声明 ssr:false 的页面清单"统一补齐。

**为什么浏览器 E2E 只覆盖分配的失败路径**：E2E 里无法正当构造"团队池有余额"（只能直接写库或走
支付回调）。分配成功的成对记账/守恒由 `team.spec`（直接调 service、可造余额）覆盖；
浏览器侧只验"接线与守卫"，不把 E2E 变成一半靠 DB 夹具的假验收。

**不适用项**：`member/:id/password`、`member/batch/change-password`、`member/:id/credential`——
我方账号是手机号+短信验证码，没有密码/一次性凭证语义；为对齐造一个假密码只会多一条攻击面。

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| 02-architecture/api-spec.md | v2.8 | §14.5.1 补 6 行；未实现清单收敛为项目维度流水 + 待取证项；新增"不适用项"与理由 |
| README.md | v2.6 | 本条变更登记 |
| 04-engineering/testing.md | — | 冒烟第 8 条补团队设置/批量分配/流水导出 |

## 变更登记（v2.5 · 视频后期工具（续写/编辑/参考）+ 视频上传基座 · 2026-10-27）

**范围**：F2 第二刀。上一批把图片工具与参考生视频接通后，参照站 `/create/*` 里还剩三类
**必须以视频为源**的工具（`video-extend` / `video-edit` / `video-refer`）——它们卡在
「上传只收图片」这个基座上，本批先把基座补上，再把三个工具接通（可用工具 5 → 8）。

| 交付 | 内容 |
|---|---|
| 上传基座 | `POST /assets/upload` 支持视频（mp4/mov/webm，≤32MB）；`kind` 按内容写 `video`；Fastify bodyLimit 16MB → 48MB |
| 工具页 | 新增 `/create/video-extend`、`/create/video-edit`、`/create/video-refer` |
| 组件 | `MediaGenWorkspace.vue`：源视频上传 + 提示词 + 模型 + 比例/清晰度/时长 + 报价 + 提交 + 轮询 + 结果/历史 |
| 工具箱 | 视频参考/视频续写/视频编辑三张卡接上落地页（18 张卡中 8 张可用） |
| 验收 | `_acceptance/e2e-tools.cjs` 20 → **26 项**（新增 S5：上传源视频 → 任务 `mode=video_extend` 且 `reference_uris` 非空） |

**为什么视频源要卡在提交前**：没有源视频时「续写」没有前文、「编辑」没有对象，模型只能凭空编；
前端直接挡住（`请先上传源视频`），后端也不接受空 `reference_uris`（`universal_reference` 校验）。

**已知偏离（技术，非竞品对齐）**：视频也走 base64 JSON 上传是 **MVP 临时方案**——
单请求内存会到几十 MB。真实生产应换 OSS 预签名直传（`api-spec §9` 已登记）。
32MB 上限覆盖 10~30s 的 720p 片段，再大的素材请走资产库/画布产物。

**验证**：`pwsh _acceptance/tools-acceptance.ps1` 全绿（typecheck / lint / adapters 89 例 /
E2E 26/26）；`assets.spec` 新增「上传视频 kind=video + 用其 URL 报价 video_extend」1 例。

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| 02-architecture/api-spec.md | §9 | 补 `/assets/upload` 契约（图片 8MB / 视频 32MB、kind 判定）与 base64 MVP 偏离说明 |
| README.md | v2.5 | 本条变更登记 |
| 03-frontend/reference-alignment-spec.md | — | §5.4 T7 更新为"8/18 张可点" |
| 04-engineering/testing.md | — | 冒烟第 7 条补视频工具 |

## 变更登记（v2.4 · 工具箱扩面：图片工具 + 参考生视频 · 2026-10-27）

**范围**：F2「工具箱扩面」第一刀。参照站工具箱有 17 条 `/create/*` + 「灵感成片」，
我方此前只有 2 个可用落地页（文生视频/图生视频），**AI图片 / AI音频 Tab 点进去是空态**。

| 交付 | 内容 |
|---|---|
| 工具页 | 新增 `/create/text-to-image`、`/create/image-to-image`、`/create/reference-to-video`（可用工具 2 → 5） |
| 组件 | `ImageGenWorkspace.vue`：提示词 / 参考图上传 / 模型 / 比例 / 清晰度 / 张数 + 报价 + 提交 + 轮询 + 历史；协议**零新增端点**（`/credits/quote` → `/generations` → `/tasks`，ADR-003） |
| 工具箱 | 卡片集对齐参照站：18 张（AI视频 10 / AI图片 4 / AI音频 4）；未落地卡片点击提示"开发中"，**不做空壳页** |
| 验收 | `_acceptance/e2e-tools.cjs` 20 项（真实浏览器 + API 交叉核对：任务 `mode` 与 `reference_uris`）+ `_acceptance/tools-acceptance.ps1` 一键复跑 |

**本批修掉的 2 个真实缺陷（都是"接口/页面看起来正常、用户其实用不了"）**：

1. **`/create/*` 直接打开是白屏**：这些页面只写了 `definePageMeta({ ssr: false })`，
   而**直接访问/刷新 URL 仍走 SSR** → 服务端（未登录）首帧与客户端不一致 → hydration 失败后
   整页空白（实测直接访问 `/create/text-to-video`：`#__nuxt` 不存在、body 仅 356 字节）。
   已在 `nuxt.config.ts` 的 `routeRules` 补 `/create/**`（与 `/canvas/**`、`/tools` 同一机制）。
   **这个 bug 在文生视频/图生视频页早就存在**，只是此前只从工具箱点进来（SPA 跳转不走 SSR）才没暴露。
2. **mock 的图像任务返回 `.mp4`**：图片工具把结果塞进 `<img src>`，`.mp4` 就是裂图，
   而"裂图"与"生成失败"在界面上几乎无法区分。mock 现在按能力给扩展名
   （图像 `png` / 视频 `mp4`），并在 `adapters.spec` 用断言锁住。

**参照证据**（ADR-013：已取证即照做）：
- 卡片集与 Tab 文案：`tools.png` + `reference-alignment-spec.md` §5（`全部/AI视频/AI图片/AI音频`）；
- 17 条 `/create/*` 路由：`rea-reelmate/routes.txt:25-41`；
- 图片工具页无独立截图 → 视觉按 `/create/text-to-video` 同一骨架自建（结构 1:1、视觉自建）。

**没做的部分（明确登记，不放假页面）**：涂抹重绘/文字重绘需要蒙版交互；视频超清按契约属 Ph2
（`video_upscale` 不在 MVP）；对口型/视频参考/续写/编辑/特效需要媒体上传与各自参数面板；
音频四件套没有真实音频适配器（`tts`/`voice_clone` 仅枚举，无供应商实现）。

| 文档 | 版本 | 变更摘要 |
|---|---|---|
| README.md | v2.4 | 本条变更登记 |
| 03-frontend/reference-alignment-spec.md | — | §5.4 T1 标为已对齐、T7 按"不做空壳页"更新现状与处置 |

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

