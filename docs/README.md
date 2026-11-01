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

---

## 变更登记（v6.75 · 配置面三面对齐：声明 ↔ 读取 ↔ `.env.example` · 2026-11-01）

换了一类此前没人用过的审计：不看代码内部，只看配置的三个面是否对齐 —— `envSchema` 的声明、生产代码的 `process.env` 读取、运维真正会复制的那份 `.env.example` 的可见性。起因是 `env.ts` 对 `OAUTH_*` / `CAPTCHA_ENFORCE` / `FILM_NOTIFY_*` 明写「此处登记只为可发现性」，而 `apps/api/.env.example` 里一个都没有；worker 的 10 个运维旋钮也只存在于代码默认值 ——「代码里有」不等于「运维能发现」，后者才是这份文件存在的理由。

| # | 审计发现 | 修复 | 守卫 |
|---|---|---|---|
| 1 | `env.ts` 自称「只为可发现性」登记的 `OAUTH_*` / `CAPTCHA_ENFORCE` / `FILM_NOTIFY_*`，在 `apps/api/.env.example` 里一个都找不到 | 补齐能力开关段：`OAUTH_*` 14 项（含 Apple 私钥 PEM 占位）、`CAPTCHA_ENFORCE` / `CAPTCHA_PROVIDER`、`MODERATION_ENABLED` / `MODERATION_WORDS`、`FILM_NOTIFY_WEBHOOK_URL` / `FILM_NOTIFY_SECRET`（附 `x-of-signature: sha256=<hex>` 校验说明）、`LLM_MODE` + `DEEPSEEK_*`、`AGENT_STT_*` | 本批守卫 ②③ |
| 2 | `envSchema` 的 **88** 个键里有 **35** 个不在任何示例中（只看 api 自己的示例缺 **39**），运维按示例起服务会缺配置 | api 示例补齐鉴权/存储/可观测段（`ADMIN_JWT_SECRET`、`COOKIE_SECURE`、`METRICS_TOKEN`、`MASTER_TTL_S`、`STORAGE_S3_PUBLIC_ENDPOINT`、`SHUTDOWN_TIMEOUT_MS`、`APP_VERSION`、`FFMPEG_PATH` / `FFPROBE_PATH` 等），全部为占位值 | 本批守卫 ① |
| 3 | worker 的 10 个运维旋钮（并发/轮询/看门狗/停机）只在代码里，运维不知道有、也不知道默认值 | `apps/worker/.env.example` 逐个写出并注明不配置时的默认值：`WORKER_CONCURRENCY=5`、`POLL_INTERVAL_MS=1000`、`POLL_MAX_MS=900000`、5 个看门狗/定时任务间隔、`SHUTDOWN_TIMEOUT_MS=25000` | 本批守卫 ② |
| 4 | **22** 个生产读取无任何文档（api 11 / worker 12，并集 22，`SHUTDOWN_TIMEOUT_MS` 两边都读） | 逐条补进各自示例（`APP_VERSION`、`CATALOG_SYNC_TOOLS`、`MASTER_TTL_S`、`FFPROBE_PATH`、`STORAGE_S3_PUBLIC_ENDPOINT`、各轮询/看门狗间隔等）；`WORKER_ID` 在 schema 里声明但 api 不读，照实写 `pid % 1024` 而不是删 schema 条目 | 本批守卫 ② |
| 5 | 手写清单会腐化；示例几乎全是 `# VAR=value`，只匹配裸赋值会得到 100+ 假阳性 | 新增 `apps/api/test/env-example-coverage.spec.ts` **5 例**：schema 全覆盖（带解析器自检 ≥50 键）、**按 app** 判读取而非并集、`packages/*` 覆盖、扫描器读注释行（正反双向自检）、豁免名单不腐化 | 本批守卫 5/5 |
| 6 | 守卫本身要能变红，否则只是装饰 | 删掉 worker 示例里的 `# FFPROBE_PATH=ffprobe` 实测：`1 failed / 4 passed`，报 `FFPROBE_PATH（读于 \apps\worker\src\main.ts）`；加回后 5/5、76ms | 红→绿实测 |

**验证**：api 示例 49 → **93** 个名字（覆盖全部 88 个 schema 键，缺口 0）、worker 42 → **54**；生产读取缺口 22 → **0**、schema 缺口 35 → **0**。门禁四段 `EXIT=0`：build 8/8（8.906s）、typecheck 12/12（8.757s）、lint 7/7（0 errors / 29 条既有 warning：web 27 + api 2）、`pnpm test` 12/12 **1,757 用例通过 + 1 跳过**（3m35.595s；api 1,295 / worker 91 / cli 128 / shared 35 / model-adapters 164 / db 27 / storage 17+1），台账守卫 11/11。端点 801 / controller 63 / 页面 65 / 迁移 50 / 表 115 全部不变（零端点、零迁移、零契约变更）。

**仍未做**：守卫只看**键是否出现**，不看说明写得对不对、默认值是否与代码一致；不覆盖 web 的 `import.meta.env.VITE_*`（构建期注入，与 node 进程 env 语义不同）；不校验动态 `process.env[key]`；示例里只放占位值，支付/短信/供应商 Key 仍走服务器 env 或 CI Secrets。分数不变：202.77/206 = 98.4%，剩余 3.23 全部是外部材料/资质/法务与产品决策，代码侧已无自记缺口。

---

## 变更登记（v6.76 · 迁移链 lockstep：`schema.ts` ↔ 最新快照 ↔ 日志 ↔ `.sql` · 2026-11-01）

又换了一类审计：前 117 批读的都是**代码**，本批读**迁移产物**。`schema.spec.ts` 自己写着「断掉的迁移在 dev 库上不会报错（drizzle 只比对快照），只有新环境重建时才炸」，而仓库里没有任何用例测过它 —— drizzle-kit 的 `generate` 从不读 `.sql`，所以「快照与 `schema.ts` 一致」和「50 个迁移能在空库上建出 115 张表」是两件互不蕴含的事。

| # | 审计发现 | 修复 / 验证 | 守卫 |
|---|---|---|---|
| 1 | `schema.spec.ts` 记的「只有新环境重建时才炸」从无任何用例覆盖；快照对齐 ≠ 迁移可重放 | 临时库 `wf_d118` 从零重放 50 个迁移：`__drizzle_migrations` = 50、表 115 / 115、列 1204（类型比对 1204、默认值比对 514）、索引 186、外键 256（定义不一致 0）、**差异合计 0**；另在副本上 `drizzle-kit generate` → `No schema changes` | 一次性实跑（本批） |
| 2 | 手写「迁移没断」的结论会腐化，而 dev 库上永远看不出来 | 新增 `packages/db/src/migration-lockstep.spec.ts` **6 例**，只读文件不连库：日志 `idx` 连续 + 文件齐全 + `prevId` 链；表集合双向相等；1,204 列的类型/可空/主键/默认值；186 索引 + 6 唯一 + 2 复合主键；256 外键；2 CHECK | 本批守卫 6/6 |
| 3 | 守卫极易假红：PG 标识符 63 字节截断、默认值三种写法、cwd 不确定 | 两侧统一过 `pgName()`（按 UTF-8 回退续字节）；默认值归一（字符串补引号 / SQL 原样 / 空数组按 `text[]` vs `jsonb` 分叉 —— 原型阶段唯一咬到的差异是 `models.tags` / `models.promotions`）；从 `process.cwd()` 向上 8 层定位 `_journal.json`；另加列/索引/外键数 `> 0` 防空转 | 用例内断言 |
| 4 | 守卫要能变红，否则只是装饰 | 6 类定向破坏 → **一条一个映射**全部 `EXIT=1`（journal→①、表→②、列→③ 报 `users.id 可空：schema notNull=true 快照=false`、索引→④、外键→⑤、CHECK→⑥）；还原后 6/6、110ms | 红→绿实测 |

**验证**：门禁四段 `EXIT=0` —— build 8/8（10.81s）、typecheck 12/12（7.976s）、lint 7/7（0 errors / 29 条既有 warning：web 27 + api 2）、`pnpm test` 12/12 **1,763 用例通过 + 1 跳过**（3m48.195s；db 33/2、api 1,295/112、worker 91/12、cli 128/17、shared 35/5、model-adapters 164/14、storage 17+1/3）。端点 801 / controller 63 / 页面 65 / 迁移 50 / 表 115 全部不变（零端点、零迁移、零契约变更）。临时库 `wf_d118` 已 `DROP`。

**仍未做**：守卫**不解析 `.sql`**，断言的是「日志/文件/快照/schema 四者对齐」，不是「SQL 文本与快照等价」—— 后者只在 `wf_d118` 上做过一次性实跑（差异 0），没有变成常驻断言（要 PG，与 CI 无 PG 冲突）；CHECK 只比名字不比表达式文本；索引不比 `where` / `opClass` / `WITH`，不覆盖序列/策略/视图；默认值归一仅覆盖仓库现用形态，非空 JS 数组会响亮地红而不是静默放过；不校验迁移执行顺序的安全性与回滚。分数不变：202.77/206 = 98.4%，剩余 3.23 仍是外部材料/资质/法务与产品决策。

---

## 变更登记（v6.77 · 出站下载的双闸：时间 + 字节，且每一处 `fetch` 都有守卫 · 2026-11-01）

前 118 批里有三批在修「上限」（S3 建连/空闲/总时长、local 存储单次 fs、ffmpeg SIGKILL），但都是**逐点**修的。本批换了个问法：**每一处**出站 `fetch()` 都有时间上限吗？一扫描就发现 3 处裸下载完全无上限、还有 1 处有超时但没有字节上限 —— 而类型检查、lint、构建、总闸全绿：这三处语法完全合法，测试也没覆盖远程分支。

| # | 审计发现 | 修复 / 验证 | 守卫 |
|---|---|---|---|
| 1 | `fetch()` 天生没有超时，`arrayBuffer()` 天生没有大小上限 | 一次性扫描：生产代码 12 处裸 `fetch(`，3 处完全无上限（worker `export.ts` / `timeline-export.ts`、CLI `task download`），1 处只有时间无字节（worker `executor.ts` 转存），其余 8 处原本正确 | 先量后改（扫描脚本） |
| 2 | 同一个语义散落三套实现还漏两处 | 新增 `packages/shared/src/http-bounded.ts`：`downloadBounded` 默认 5 分钟 / 256MiB；content-length 预检、chunked 边读边计数、超限那块即 cancel、非 2xx 不读错误页、任何提前退出都 cancel body；六种 `reason`，非正上限抛 `bad_options` | 单测 10 例 |
| 3 | executor 只有 5 分钟、没有字节闸；CLI 又不能 import shared | executor / export / timeline-export 统一改走双闸并暴露可注入上限；CLI 因零运行时依赖保持内联同语义实现 | 静态守卫 |
| 4 | 「以后每一处都记得」不能靠自觉 | 新增 `outbound-fetch-bounds.spec.ts` 11 例：注释/字符串感知扫描全树，9 处调用点逐文件登记，`arrayBuffer(` = 0，成员 `.fetch(` = 0 | 门禁 |
| 5 | 守卫要能变红，否则只是装饰 | 删 CLI `signal:` → 红在 `runtime.ts:136`；新文件加裸 `fetch` → 双条红，改成有上限后仍红在「未登记」；注释里写 `fetch(` → 全绿 | 红→绿实测 |

**验证**：门禁四段 `EXIT=0` —— build 8/8（13.503s，2 cached）、typecheck 12/12（1.79s）、lint 7/7（0 errors / 29 条既有 warning：web 27 + api 2）、`pnpm test` 12/12 **1,784 用例通过 + 1 跳过**（12.194s 并行墙钟；api 1,306/113、shared 45/6、worker 91/12、cli 128/17、model-adapters 164/14、db 33/2、storage 17+1/3）。端点 801 / controller 63 / 页面 65 / 迁移 50 / 表 115 全部不变（零端点、零迁移、零契约变更，故 `docs/02-architecture/` 未改）。

**仍未做**：JSON / 文本类供应商读取仍只有时间上限、没有字节上限（错误响应要整块 `JSON.parse`，设上限先要回答「一次错误响应多大算合法」，属供应商/产品决策）；守卫只保证「有超时机制」，不校验超时值是否合理，也不覆盖模板字面量 `${...}` 内的调用与手写 `node:http` 请求（当前仓库无此类代码）；CLI 是内联副本而非共享实现，两者一致由静态守卫保证。分数不变：202.77/206 = 98.4%，剩余 3.23 仍是外部材料/资质/法务与产品决策。

---

## 变更登记（v6.74 · ffmpeg 超时后真的会死：SIGTERM → 宽限 → SIGKILL · 2026-11-01）

v6.73 结尾「仍未做」的最后一条：「`execFile` 仍只有 SIGTERM、无 SIGKILL 升级」。上一批审计已确认**每个** ffmpeg/ffprobe 调用从各自功能提交起就带硬超时，但「到点」和「真的死掉」是两件事 —— ffmpeg 解码损坏片源、等网络输入或卡在驱动里时可能不理 SIGTERM，于是「超时错误已经抛出、进程还在跑」，worker 重启也带不走它，最后一条代码侧缺口按此关闭。

| # | 审计发现 | 修复 | 守卫 |
|---|---|---|---|
| 1 | `execFile` 的 `timeout` 到点只发一次默认 `killSignal`（SIGTERM）就返回，不保证退出；子进程忽略信号时 `close` 不来，Promise 照样能挂住 | 新增 `packages/shared/src/exec-bounded.ts` 的 `execFileBounded`：`timeoutMs` 到点先 `SIGTERM`，`killGraceMs`（默认 `DEFAULT_KILL_GRACE_MS = 2_000`，给被杀进程 flush 输出的收尾窗口）后仍未退出就 `SIGKILL`，**并在 SIGKILL 后立刻 reject、不等 `close`** —— 卡在不可中断内核调用里的进程会让 `close` 永不发生 | 永不退出的替身子进程 → `kills === ["SIGTERM","SIGKILL"]`、`escalated === true`、实测 < 2s 落定 |
| 2 | 超时失败形态不统一会与真正的取消/崩溃混淆，原始错误也会丢 | 统一 `name = "TimeoutError"`、`killed = true`、`signal = "SIGTERM"`、`escalated` 区分是否已升级、原始错误挂 `cause`；到点之后才退出（自己退出或被信号杀）对外一律是超时，不把「被杀」当成功 | SIGTERM 后在宽限内退出 → 仍是 TimeoutError、`escalated === false`、`cause instanceof Error`、只 kill 一次 |
| 3 | 参数写错会静默退化成「无上限」，等于把安全网关掉还没人知道 | `timeoutMs` / `killGraceMs` 为负数 / `NaN` / 非有限数时**构造即抛** `invalid timeoutMs: …` / `invalid killGraceMs: …`（与 `S3Config`、`operationTimeoutMs` 同一取舍）；`timeoutMs: 0` 是显式关闭 | 四组非法值构造即抛；默认宽限落在 500–5000ms（不是 0，也不是 10 分钟级） |
| 4 | 换实现不能顺手改掉原有语义 | 成功 → `resolve({ stdout, stderr })`；非零退出 → 原样 `reject(error)`（**不**包装成 TimeoutError，`code` 可读）；`encoding` 默认 utf8；`kill` 自己抛错在定时器回调里兜住，不变成未捕获异常 | 真实 Node 子进程：成功返回 stdout/stderr；`process.exit(7)` 的 `code` 仍是 7 且 `name !== "TimeoutError"`；`kill` 抛错仍只报超时 |
| 5 | 只改库不接线等于没改 | 4 个文件 / 7 处全量替换，**超时值原样保留**：`media-capability.ts` 5s 探测、`ffmpeg-trim.ts` `options.timeoutMs ?? 120_000`、`label.ts` 30s 水印、`timeline-export.ts` ffprobe 30s + `FFMPEG_TIMEOUT_MS`（10 分钟）3 处；可注入的 `BoundedExecImpl` 只给测试，生产一律真 `execFile` | 静态守卫：四个文件都含 `execFileBounded(` 且超时值逐条匹配（timeline 恰好 4 处调用 / 3 处 `FFMPEG_TIMEOUT_MS`），都不许出现 `promisify(execFile)` / `from "node:child_process"`；实现内部顺序必须是 SIGTERM → `timers.kill = setTimeout` → SIGKILL → `settle(reject)` |
| 6 | **排障记录**：worker 定向测试首跑红在 `timeline-export.spec.ts`（expected 3 / received 4） | 根因不是逻辑：`@app/worker` 经 `node_modules/@app/shared` 解析到的是 `packages/shared/dist/index.js`，shared 没重新 build，报 `execFileBounded is not a function`；`pnpm --filter @app/shared build` 后 19/19 通过。全量门禁不受影响（`turbo.json` 的 `^build` 保证顺序），但**定向跑 worker 测试前先 build shared** | 定向 worker 3 文件 / 19 例 `EXIT=0` |

**验证**：shared 定向 `pnpm --filter @app/shared test` **35/35 通过**（5 文件，`EXIT=0`；本批 26→35，+9 例，`exec-bounded.spec.ts` 9 例）。全站门禁：`pnpm test` 12/12、**1,752 用例通过**（3m48.826s；api 段 201.59s / worker 段 11.76s；api 1,290 / worker 91 / cli 128 / shared 35 / model-adapters 164 / db 27 / storage 17，另 1 skipped）、build 8/8（12.838s）、typecheck 12/12（8.881s）、lint 7/7（1.859s，0 error / **29** 条既有 warning：web 27 + api 2，本批无新增），四段 `EXIT=0`，台账守护 11/11；端点 **801** / controller **63** / 页面 **65** / 迁移 **50** / 表 **115** 全部不变（零端点、零迁移、零契约变更）。**分数不变：202.77/206 = 98.4%，剩余 3.23，E 仍 **2.65**、I = 0（B 0.58）** —— 该条从未计入三分类，是 v6.73 自记诚实边界的关闭，不是补分。

**仍未做**：只杀**直接子进程**，不杀进程组 —— 我们始终 `execFile` 直调 ffmpeg/ffprobe（不经过 shell），但部署方若把 `FFMPEG_PATH` 指向包装脚本，脚本派生的孙进程不在此保证内；Windows 没有 POSIX 信号，`kill("SIGTERM")` 已等价 `TerminateProcess`，升级逻辑的价值主要在 Linux/macOS；超时路径**丢弃**已产出的部分 stdout/stderr；SIGKILL 后不等 `close`，不可中断状态下的进程可能残留为孤儿/僵尸；没有可配置的 kill 信号与进程组开关，也没有 env 开关（运维临时调整要发版）；测试用注入替身 + 真 Node 子进程，**没有**起真实「忽略 SIGTERM 的 ffmpeg 卡死」端到端演练，也没有对 SIGKILL 之后孤儿进程的回收做过测量。剩余 3.23 全部是外部材料/资质/法务与产品决策，代码侧已无自记缺口。

---

## 变更登记（v6.73 · local 存储也设上限：fs 调用不再无限挂起 · 2026-11-01）

v6.72 结尾「仍未做」的第 1 条是上一批自己留下的半边：S3 驱动已有建连/空闲/总时长三层上限，但 `LocalStorage` 仍直接 `await mkdir/writeFile/readFile/rename`。`STORAGE_DIR` 落在 NFS/网络盘、挂载点卡死时，转存永远不返回，而流水线心跳（第 113 批）会一直刷新 `updated_at`，看门狗永远不会处置 —— 任务永远 RUNNING。本批把 local 这半边关掉，并顺手更正上一批一条写错的记录。

| # | 审计发现 | 修复 | 守卫 |
|---|---|---|---|
| 1 | local 驱动的四次 fs 调用都没有上限：挂载点卡死时 `put`/`read` 可以挂到进程重启为止，心跳一直续命 | `DEFAULT_OPERATION_TIMEOUT_MS = 5 * 60_000`（与 worker 的转存上限同值 —— 安全网，不是「大文件必失败」的交付约束）；`LocalStorage` 新增 `operationTimeoutMs`（`0` = 显式关闭，与 S3 驱动一致），`StorageOptions` 透传；负数 / NaN 构造时直接抛 `invalid local operationTimeoutMs: …`，不静默退化成「无上限」 | `local.spec.ts` 构造校验 1 例、默认值层次 1 例（≥ 1 分钟且 ≤ 5 分钟） |
| 2 | `readFile`/`writeFile` 支持 signal，但 `mkdir`/`rename` 在 Node 的 fs API 里**没有** signal 参数 —— 只给读写加 abort 会漏掉两步 | `withinDeadline()` 把每一步与同一个 deadline 竞速，任何一步挂住都只报一种失败：`name = "TimeoutError"`、消息 `local put/read timed out after N ms: <key>`；fs 层因 signal 抛的 `AbortError` 挂 `cause` 不丢；竞速落败的底层 Promise 补 no-op catch 防 unhandled rejection | 注入永不返回的 `readFile` → 100ms 内失败且错误形状正确、耗时 < 2s；注入永不返回的 `mkdir` → `put` 同样只报超时；静态守卫 `this.withinDeadline("put"` **恰好 3 处**、`signal ? { signal } : undefined` **恰好 2 处** |
| 3 | 直接写目标 key 时，超时的写入可能已把半截数据落成正式 key，读者会读到坏文件 | `put` 改为先写同目录临时文件 `${target}.tmp-${randomUUID()}` 再 `rename`（POSIX 同目录原子；Windows `MoveFileEx` 覆盖已存在目标）—— 读者只看到完整的旧对象或完整的新对象 | 慢 `writeFile`（先真写临时文件、再拖 300ms）→ `put` 超时失败且目标 key **从未出现**（`access` 反查被拒） |
| 4 | 真实坏盘/挂载点无法在测试里复现 | fs 能力做成可注入的 `LocalFs`（`Pick<typeof import("node:fs/promises"), …>`），生产一律 `node:fs/promises` | 「Promise 永不落定」视为挂死的等价形态，四个阶段各自可钉 |
| 5 | **更正在先**：v6.72「ffmpeg 烧水印卡死不在本批范围」的措辞会被读成「ffmpeg 调用没有上限」 | 复核全部 `execFile` 调用点，**每个从各自功能提交起就带硬超时**：`label.ts:162` 30s、`timeline-export.ts:74`（ffprobe）30s 与 `:121`/`:177`/`:301`（`FFMPEG_TIMEOUT_MS`）10 分钟、`ffmpeg-trim.ts:79`（`timeoutMs ?? 120_000`）、`media-capability.ts:60` 5s。本批**不改 ffmpeg 代码**，只更正记录；真实残留是 `execFile` 的 timeout 只发一次 SIGTERM、**无 SIGKILL 升级** | 调用点逐条列出并复核 |

**验证**：storage 定向 `pnpm --filter @app/storage test` **17/17 通过、1 skipped**（3 文件，`EXIT=0`；本批 11→17，+6 例，`local.spec.ts` 3→9）。全站门禁：`pnpm test` 12/12、**1,743 用例通过**（3m37.041s；api 段 201.53s；api 1,290 / worker 91 / cli 128 / shared 26 / model-adapters 164 / db 27 / storage 17，另 1 skipped）、build 8/8（8.694s）、typecheck 12/12（9.407s）、lint 7/7（1.65s，0 error / **29** 条既有 warning：web 27 + api 2，本批无新增），四段 `EXIT=0`，台账守护 11/11；端点 **801** / controller **63** / 页面 **65** / 迁移 **50** / 表 **115** 全部不变（零端点、零迁移、零契约变更）。**分数不变：202.77/206 = 98.4%，剩余 3.23，E 仍 **2.65**、I = 0（B 0.58）** —— 该条从未计入三分类，是 v6.72 自记诚实边界的关闭，不是补分。

**仍未做**：上限只能让**调用方不再等待** —— 已进入 libuv 线程池的 syscall 无法收回，盘恢复前槽位可能仍被这次调用占着；`mkdir`/`rename` 只能竞速放手，底层调用仍会跑完；失败路径可能留下 `.tmp-<uuid>` 孤儿文件，清理是 fire-and-forget（坏盘上 `unlink` 同样会挂），没有孤儿清扫器；上限只能写在代码里，没有 env 开关（与 `S3Config` / `deps.heartbeatMs` 同一取舍）；测试用注入的「永不落定 Promise」模拟挂死，**没有**对真实 NFS / 挂载点卡死 / 线程池耗尽做过测量；存储端仍无健康探测或熔断；`execFile` 仍只有 SIGTERM、无 SIGKILL 升级。

---

## 变更登记（v6.72 · 存储驱动三层上限与响应体上限：S3 不再无限挂起 · 2026-11-01）

v6.71 结尾「仍未做」的第 1 条：心跳只证明**进程还活着**，不证明供应商/存储还在推进 —— 彻底挂死的存储驱动仍会被续命。本批把「存储驱动」这半边关掉：`S3Storage` 的两个 `S3Client` 既没传 `requestHandler` 也没设 `maxAttempts`，走 smithy 默认的 `NodeHttpHandler`，`put`/`read` 可以挂到进程重启为止，而流水线心跳会一直给它刷 `updated_at`，看门狗永远不会处置。

| # | 审计发现 | 修复 | 守卫 |
|---|---|---|---|
| 1 | 两个 `S3Client` 无 `requestHandler`、无 `maxAttempts`：建连、空闲、总时长三个阶段都没有上限 | 新增 `DEFAULT_CONNECTION_TIMEOUT_MS = 10_000` / `DEFAULT_SOCKET_TIMEOUT_MS = 60_000` / `DEFAULT_REQUEST_TIMEOUT_MS = 15 * 60_000` / `DEFAULT_MAX_ATTEMPTS = 3`，`S3Config` 四项均可覆盖（0 = 显式关闭，与 smithy 语义一致）；负数 / NaN / `maxAttempts < 1` 在构造时直接抛 `invalid s3 …`，不静默退化成「无上限」 | `s3.spec.ts` 配置校验 1 例、默认值层次 1 例（建连 < 空闲 < 总时长，总时长 ≥ 10 分钟 —— 安全网不能变成「大文件必失败」） |
| 2 | smithy 的 `requestTimeout` 默认只打 warning，到点请求继续挂着，等于没设；两个 client 共用一个 handler 会让 agent 池互相牵连 | 每个 client 各持一个 `NodeHttpHandler`，显式 `throwOnRequestTimeout: true`；`maxAttempts` 真正传进 client 基配置（AWS SDK 默认把 ETIMEDOUT 当可重试错误） | 静态守卫断言 `requestHandler: this.createHandler()` **恰好 2 处**、`maxAttempts: this.limits.maxAttempts`、`throwOnRequestTimeout: true` |
| 3 | 只配 handler 不够：读 `@smithy/node-http-handler@4.12.1` 源码确认 `handle()` 在**响应头到达时**就 `resolve()` → `clearTimeouts()`，`requestTimeout` 与（3 秒延迟注册的）`socketTimeout` 一起失效，此后 `transformToByteArray()` 读响应体没有任何时限 | `readBodyWithin()`：同一个 `AbortSignal.timeout(requestTimeoutMs)` 继续守响应体，超时后显式 `body.destroy()` 销毁流避免悬空连接；竞速落败的 reading 补 no-op catch 防 unhandled rejection | 真服务器用例：先回 200 头 + `Content-Length: 1048576`、只写 16 字节再挂住 → `read` 在 400ms 上限内失败，且服务端 `res.on("close")` 2 秒内触发 |
| 4 | 两个定时器（我们的 `AbortSignal` 与 handler 的 `requestTimeout`）谁先到都可能，直接透传只看到 `AbortError: Request aborted`，无法与真正的取消区分 | `bounded()` 按信号状态统一成 `s3 put/read timed out after N ms: <key>` 的 `TimeoutError`，原始错误挂 `cause` 不丢 | PUT 真服务器用例：收下请求永不回应，`maxAttempts: 1` + `socketTimeoutMs: 0`，断言 `/s3 put timed out after 400 ms/`、耗时 < 5s、**请求计数恰为 1**（证明重试上限真的生效） |
| 5 | `@smithy/node-http-handler` 此前只是 `@aws-sdk/client-s3` 的传递依赖，直接 import 后不声明会在依赖提升变化时断 | `package.json` 显式声明 `@smithy/node-http-handler ^4.12.1` | `pnpm install`（`gates-114-install.log`）+ build/typecheck 全绿 |

**验证**：storage 定向 `pnpm --filter @app/storage test` **11/11 通过、1 skipped**（3 文件，`EXIT=0`；本批 6→11，+5 例，`s3.spec.ts` 3→8）。全站门禁：`pnpm test` 12/12、**1,737 用例通过**（3m38s；api 段 203.25s / worker 段 11.11s；api 1,290 / worker 91 / cli 128 / shared 26 / model-adapters 164 / db 27 / storage 11，另 1 skipped）、build 8/8（9.027s）、typecheck 12/12（9.461s）、lint 7/7（1.636s，0 error / **29** 条既有 warning：web 27 + api 2，本批无新增），四段 `EXIT=0`，台账守护 11/11；端点 **801** / controller **63** / 页面 **65** / 迁移 **50** / 表 **115** 全部不变（零端点、零迁移、零契约变更）。**分数不变：202.77/206 = 98.4%，剩余 3.23，E 仍 **2.65**、I = 0（B 0.58）** —— 该条从未计入三分类，是 v6.71 自记诚实边界的关闭，不是补分。

**仍未做**：`LocalStorage` 的 fs 读写同样没有上限（NFS/网络盘挂住仍会把转存挂死、仍会被心跳续命）；ffmpeg 烧水印卡死不在本批范围；超时只让当前任务失败/降级，存储端仍无健康探测或熔断；四项上限只能写在代码里（`S3Config`），没有 env 开关，运维临时放宽/收紧要发版（与第 113 批 `deps.heartbeatMs` / `deps.transferTimeoutMs` 同一取舍）；本批用真本地 HTTP 服务器钉住 PUT 与响应体两个阶段，没有对真实 S3/OSS/MinIO 做过慢链路、半开连接或连接池耗尽的测量。

---

## 变更登记（v6.71 · 重投续接原 vendorTaskId + 整条流水线心跳与下载上限 · 2026-11-01）

v6.70 结尾「仍未做」的前两条是同一处执行链的两个缺口：① BullMQ 把被中断的 job 重投回来时，只要任务还在 PENDING/RUNNING 就**重新 `adapter.submit`** —— 供应商侧多出一个任务（重复计费），原任务的结果永远没人取；② 心跳**只在轮询循环里**，供应商成功后到转存/烧水印/标识/结算之间不再续期，正常跑满 10–15 分钟的长任务后半段又回到看门狗裸奔状态。本批把执行判定改成三分支的返回值、心跳挪到整条流水线，并顺手补上一直缺失的下载上限 —— 否则被心跳续命的挂死转存会让任务永远 RUNNING。

| # | 审计发现 | 修复 | 守卫 |
|---|---|---|---|
| 1 | 重投一个仍为 RUNNING 且已落 `vendorTaskId` 的任务会重新 submit：供应商重复计费，原结果无人取；旧事务只挡 CANCELED 且**不把结论传回外层**，取消后照样 submit | 新导出 `claimTaskForRun`：行锁内给出 `skip`（CANCELED / SUCCEEDED / FAILED 全挡）/ `resume`（RUNNING 且有 vendorTaskId：写 `task.resumed` 后直接轮询，绝不 submit、不改写 vendorTaskId）/ `submit`（PENDING 或 RUNNING 无 vendor id：置 RUNNING、progress 10、写 `task.running`，带上 `previousStatus`），外层按返回值分派 | `test/executor-recovery.spec.ts` 7 例真库：三个终态 skip 且零事件、resume 只写 `task.resumed`、两种 submit 分支的 `previousStatus`、**端到端**重投（submit 一调就抛错、poll 收到原 id、终态 SUCCEEDED、没有第二条 `task.running`）、CANCELED 重投不复活 |
| 2 | 心跳只在轮询循环里，转存/烧水印/标识/结算无续期；看门狗 10 分钟会杀掉这一段 | 抽成 `startTaskHeartbeat`，在 claim 判定**之后**启动、`finally` 里停掉；`DEFAULT_HEARTBEAT_MS = 30_000`（`deps.heartbeatMs` 可覆盖），`WHERE id = ? AND status = RUNNING` 只续 RUNNING，失败只记 `task heartbeat failed`，定时器 `unref()`；删除旧的 `lastBeat` 计数实现 | `executor.spec.ts` 静态守卫：心跳必须在 claim 之后、`lastBeat` 不许回来、RUNNING 条件与日志关键字；`executor-recovery.spec.ts` 真库用例把 `updatedAt` 拨回 1 小时、转存期间反查库仍是 RUNNING 且已续期 |
| 3 | `transferResult` 的 `fetch` 完全无上限：转存挂住会被流水线心跳无限续命，任务永远 RUNNING | `DEFAULT_TRANSFER_TIMEOUT_MS = 5 * 60_000`（`deps.transferTimeoutMs` 可覆盖）+ `AbortSignal.timeout(timeoutMs)`；超时按 ADR-005 降级：不判失败，保留供应商原 URI 并标 `meta.transfer_failed = true`，交人工补转（原 URI 仍只在任务结果里，不直接透出给终端用户） | `executor.spec.ts` 断言常量低于看门狗阈值且 `AbortSignal.timeout` 真接到 fetch；`executor-recovery.spec.ts` 让 fetch 在 abort 时 reject，断言任务 SUCCEEDED、URI 不变、`transfer_failed` 为真 |

**验证**：worker 定向 `pnpm --filter @app/worker test` **91/91 通过**（12 文件，`EXIT=0`；本批 82→91，+9 例：新增 `test/executor-recovery.spec.ts` 7 例真库，`src/executor.spec.ts` 9→11）。全站门禁：`pnpm test` 12/12、**1,732 用例通过**（api 段 205.82s / worker 段 11.28s；api 1,290 / worker 91 / cli 128 / shared 26 / model-adapters 164 / db 27 / storage 6，另 1 skipped）、build 8/8（1.865s，worker 缓存 miss 走 `tsc`）、typecheck 12/12（1.803s）、lint 7/7（1.803s，0 error / **29** 条既有 warning：web 27 + api 2，均 2026-10-29 第 95 批遗留，本批无新增），四段 `EXIT=0`，台账守护 11/11；端点 **801** / controller **63** / 页面 **65** / 迁移 **50** / 表 **115** 全部不变（零端点、零迁移、零契约变更；`task_events.type` 是自由文本，`task.resumed` 不改 schema）。**分数不变：202.77/206 = 98.4%，剩余 3.23，E 仍 **2.65**、I = 0（B 0.58）** —— 该条从未计入三分类，是本批关掉的两条自记诚实边界，不是补分。

**仍未做**：心跳只证明**进程还活着**，不证明供应商/存储还在推进 —— 彻底挂死的存储驱动（或 ffmpeg 烧水印卡死）仍会被续命，本批只给**单次下载**加了上限，极端情况仍要人工介入；resume 只在同一 worker 进程重投时安全，若供应商侧任务已过期，`poll` 会按供应商错误码失败并解冻（不会静默卡住），但「已计费却拿不到结果」的用户补偿仍是人工；预留队列 `gen.poll` / `result.transfer` / `notify` 仍无 dead-letter / 自动重放工具，Redis 丢失仍需人工按任务状态重放；AI 标识**无自动重试**（失败即 FAILED，靠告警人工补）；供应商仍无健康探测/熔断；本批靠**真库用例 + 静态源码守卫**，没有起 Redis + 真 BullMQ 做端到端重投演练，也没有多副本/延迟/连接池耗尽的测量。

---

## 变更登记（v6.70 · 队列孤儿消息审计：预留队列停建消费者 + 轮询心跳 + AI 标识结算硬门 · 2026-11-01）

§5.6 C「定时任务/队列的孤儿消息」此前只是「审过、没改完」：`QUEUES` 目录里的 `gen.poll` / `result.transfer` / `notify` **没有任何生产者**，worker 却给 7 个名字全建了 Worker，误入的消息落进兜底分支 `log.info(..., "job received (no-op)"); return { ok: true };`，被 BullMQ 当作**成功完成**并删除 —— 不失败、不重试、无告警。同批审计还撞出两处更严重的：看门狗的 10 分钟阈值会杀掉正常跑 10–15 分钟的长轮询任务；`system-design.md` 写了、代码里根本没有的 AI 标识结算硬门。本批把这三处一起关掉，并把文档里从未实现的拓扑说法（延时 `gen.poll` 队列、指数退避重入队、`result.transfer` 消息、`notify` 队列、心跳表、transfer 队重试 ×3、健康探测/熔断）逐条改回现状。

| # | 审计发现 | 修复 | 守卫 |
|---|---|---|---|
| 1 | 3 个保留名没有生产者，worker 却为全部 7 个名字建 Worker；兜底 no-op 把误入消息静默完成并删除 | `queues.ts` 拆成 `HANDLED_QUEUES`（4 条实队列）与 `RESERVED_QUEUES`（3 个保留名）；worker 用 `Record<HandledQueueName, JobHandler>` 显式表，只为 handled 建 Worker；删除 no-op 兜底 | `test/queue-topology.spec.ts` 10 例：两侧目录一致、分区不交叠、API 只构造/入队 handled、worker 不给保留名建消费者、无 `Object.values(QUEUES)` 与 `(no-op)` |
| 2 | 看门狗 10 分钟 vs 轮询上限 15 分钟：轮询循环从不刷新 `tasks.updated_at`，正常长任务被判卡死 + 解冻，供应商成功的结果又被终态守卫丢弃 | `DEFAULT_HEARTBEAT_MS = 30_000`，轮询期间以 `WHERE id = ? AND status = RUNNING` 刷新 `updated_at`；心跳失败只记 `task heartbeat failed`，不判任务失败 | `executor.spec.ts` +2 静态守卫（常量比看门狗阈值小一个数量级、RUNNING 守卫、日志关键字）+ `outbound-uri.spec.ts` +1 真库用例（`updatedAt` 拨到 1 小时前，第二次 poll 反查应看到新时间戳） |
| 3 | 文档写「AI 标识是结算前硬门」，代码里没有：无标识产物照常结算 | `isResultLabeled` / `findUnlabeledResults` 在 `succeed()` 结算事务前判定；媒体产物隐式旁车与显式水印两条路径都失败 → `FAILED(ai_label_failed)` + 解冻、不结算；纯文本与 `AI_LABEL_ENABLED=false` 豁免，缺 `ai_label` 字段按未标识；`ExecutorDeps.aiLabel` 从可选改必填（踩到 `outbound-uri.spec.ts` 漏传） | `label.spec.ts` +5（判定口径逐条）+ `executor.spec.ts` +1 静态守卫（`succeed()` 必须调用 `findUnlabeledResults` 且失败走 `ai_label_failed`） |
| 4 | 后台 `GET /ops/admin/queues` 只报 1 条队列（实队列 4 条），保留名混进来会误导告警口径 | `queues()` 改为 4 条实队列（`gen.submit` / `export.zip` / `timeline.export` / `publish.transcode`），每条 `getJobCounts("wait","active","failed","completed","delayed")`；保留名不进后台 | `admin.spec.ts` 断言返回键**恰为** 4 个；`queue-topology.spec.ts` 静态断言 admin 源码只出现 handled 名 |

**验证**：worker 定向 `pnpm --filter @app/worker test` **82/82 通过**（11 文件，`EXIT=0`；本批 63→82，+19 例：`queue-topology.spec.ts` 10、`label.spec.ts` 5、`executor.spec.ts` 3、`outbound-uri.spec.ts` 1 真库）。全站门禁：`pnpm test` 12/12、**1,723 用例通过**（3m38s，api 段 205.8s；api 1,290 / worker 82 / cli 128 / shared 26 / model-adapters 164 / db 27 / storage 6，另 1 skipped）、build 8/8（9.4s）、typecheck 12/12（8.1s）、lint 7/7（12.0s，0 error / 29 条既有 warning：web 27 + api 2，本批无新增），四段 `EXIT=0`，台账守护 11/11；端点 **801** / controller **63** / 页面 **65** / 迁移 **50** / 表 **115** 全部不变（零端点、零迁移、零契约变更）；改动 15 个文件（14 改 + 1 新），`603 insertions(+) / 118 deletions(-)`（含两份变更登记）。**分数不变：202.77/206 = 98.4%，剩余 3.23，E 仍 **2.65**、I = 0（B 0.58）** —— 该条从未计入三分类，是又一条自记诚实边界的关闭，不是补分。

**仍未做**：心跳**只在轮询期间** —— 供应商成功后到转存/烧水印/结算之间不再续期，超大媒体若在这一段超过 10 分钟仍会被看门狗判卡死（彻底解决要把心跳挪到整条流水线）；仍为 RUNNING 且已落 `vendorTaskId` 的重投会**重新 submit**、不会续接原轮询，可能产生供应商侧重复计费；预留队列只是不建消费者，没有 dead-letter / 自动重放工具，Redis 丢失仍需人工按任务状态重放；AI 标识**无自动重试**（失败即 FAILED，靠告警人工补）；供应商仍无健康探测/熔断；本批拓扑靠**静态源码守卫**，没有起 Redis 做真队列端到端验证。

---

## 变更登记（v6.69 · 邀请码多会话并发删除与陈旧快照浏览器 E2E · 2026-11-01）

v6.68 结尾「仍未做」的第 4 条：后台 E2E 仍是**单进程单浏览器**，不覆盖多管理员同时操作同一条码 —— 本批用**两个隔离浏览器上下文**（各自 `localStorage.admin_token`、不共享缓存与页面状态）在真栈上把它变成实测。验收脚本 `_acceptance/e2e-invite-race.cjs`，完整交付报告 `_acceptance/_team/report-invite-race.md`。

| 段落 | 现场 | 断言 |
|---|---|---|
| S1 并发删除 | 两个后台会话都打开 `/admin?tab=invites`，看到同一行 `0/1`、删除可点；`Promise.all` 同时点删除 | 后端**恰好一个成功**；赢家看到含码值的成功条、行移除；输家收到 `400101`/`400102` 业务错误、**保留陈旧行**并出现错误条；点「刷新」后行消失；API 列表不再含该码 |
| S2 陈旧快照 | 后台停在该行的 `0/1` 快照；真实短信用户走完整登录 + `/invite` 前台补填核销 | 用户侧核销成功 + 成功 toast；**后台仍是 `0/1`、删除仍可点**（无轮询/推送）；此时点删除被后端 `400101` 拒绝、错误条给出「已核销，请改用停用」、行不被前端擅自移除；刷新后 `1/1`、状态「已耗尽」、删除禁用且 `title` 为 `deleteUsedHint`；后端 `used_count=1 / status=3` |
| S3 已删除码 | 管理员删除一张未核销码后，用户在前台补填 | 核销接口 `400101` + `msg`「邀请码不存在」，页面弹错误 toast |

**验证**：`node _acceptance/e2e-invite-race.cjs` **28/28 项通过**（`EXIT=0`，2026-11-01T02:03:41Z），全流程无未预期 console / pageerror；脚本自建 3 张码在 `finally` 里按 id 直连开发库清理，`cleanup = {"ids":3,"redemptions":1,"codes":1,"leftCodes":0,"leftRedemptions":0}`（残留 0 码 / 0 核销行）。两次实跑观察到两种输家文案：`400102 invite code not found`（条件删除晚于赢家提交）与 `400101 … has been redeemed, disable it instead of deleting`（预检查仍看到行、条件删除 0 行后复用「已核销」）；两者对「码已经没了」都算正确拒绝，后者措辞不精确但**不视为缺陷**（0 行后无法区分「并发删除」与「被核销」，再查一次存在性会引入新竞态、收益为 0）。冒烟时修了脚本自身两个缺陷（Playwright `Response` 误按旧版 `APIResponse.response()` 解析；短信回显字段是 `data.debug_code`），不是产品缺陷。本批**零产品代码、零测试改动**：api 用例 **1,290**（111 文件）、全站 **1,704**（另 1 skipped）、端点 **801** / controller **63** / 页面 **65** / 迁移 **50** / 表 **115** 均不变；门禁 `pnpm test` 12/12（3m30s，api 段 209s）、build 8/8、typecheck 12/12、lint 7/7（0 error / **29** 条既有 warning：web 27 + api 2，`git blame` 均为 2026-10-29 第 95 批遗留；v6.68 记的 27 只数了 web 段，本批修正口径），四段 `EXIT=0`，台账守护 11/11。数据副作用：每次运行仍留下 **1 个短信测试用户**（`13` + 时间戳后 7 位 + 2 位随机数），与其它 E2E 同口径；未触碰 `admin_users`。**分数不变：202.77/206 = 98.4%，剩余 3.23，E 仍 **2.65**、I = 0（B 0.58）** —— 该条从未计入三分类，是又一条自记诚实边界的关闭，不是补分。

**仍未做**：两个会话是**同一个管理员**在两个浏览器里并发，不是两个 `admin_users`（造号会在开发库永久留痕，角色矩阵仍由接口用例覆盖）；仍是**单 API 进程 + 单 PG 实例**，多副本下的网络延迟、重试、连接池耗尽时序未覆盖，也未做持续压测；S1 每轮只撞一次，不证赢家分布；输家文案可能不精确（见上）；S2/S3 的用户登录走本机开发栈的短信回显，真实短信通道未接入；本机开发库里**此前** E2E 遗留记录仍要手工清理；已核销的码仍只能停用、没有批量删除。

---

## 变更登记（v6.68 · 邀请码删除与核销的并发用例 · 2026-11-01）

v6.67 结尾「仍未做」的第 4 条：删除与核销的并发安全只有「条件删除 + 行锁」推理，接口用例没像团队并发那样起两个真事务去撞 —— 本批把它变成实测。

| # | 并发窗口 | 用例 | 断言 |
|---|---|---|---|
| P1-18a | 核销事务**已把 `used_count` 改成 1、但还没提交**（它先锁邀请码行，再经 `creditIn → lockAccount` 锁积分账户行）。这时删除的预检查在 MVCC 下看到的仍是旧快照（`used_count=0`、无核销行），最容易误删 | 先用一个真事务占住该空间的 `credit_accounts` 行；启动**真的** `OpService.verifyInviteCode`，它停在账户行锁上；再打**真的** `DELETE` 接口 | 用 `pg_stat_activity` 先后观测到两条“`wait_event_type=Lock`”的语句（核销等 `credit_accounts`、删除等 `delete from "invite_codes"`）——不是 sleep 猜时序；放锁后核销提交、删除醒来按 `WHERE id=? AND used_count=0` 重判 0 行 → 接口 `400101`，码行仍在（`used_count=1`、`status=3`）、核销行 1 条、积分 +50 且流水 1 条 |
| P1-18b | 无人工干预的自由竞争：核销与删除同时起跑，谁先拿到锁都可能 | 一次造 6 张 `max_uses=1、credits=0` 的码，每张同时发起真 `DELETE` 与真核销（`Promise.allSettled`） | 每张码**恰好一个赢家**：删除赢 → 核销抛 `AppError 400101`、码行消失、核销行 0；核销赢 → 删除 `400101`、码行留下且 `used_count=1/status=3`、核销行 1。只断言“无半状态”，不假设谁赢或赢家比例 |

**验证**：定向 `vitest run test/admin-community.spec.ts` **13/13 通过**（本批 +2），4.7s，exit 0；日志里删除的阻塞时长分别是 68ms（持锁用例）与 131–237ms（自由竞争组），与“真的在等锁”一致。全量 `pnpm test` **12/12 任务全绿，1,704 用例通过**（api **1,290** / cli 128 / shared 26 / storage 6(+1 skipped) / model-adapters 164 / db 27 / worker 63），3m30s（api 段 209s），exit 0；`build` 8/8（8.9s，7 cached）、typecheck 12/12（7.3s，11 cached）、lint 7/7（4.8s，0 error / 27 条既有 warning），均 exit 0；台账守护 `ledger-consistency.spec.ts` 11/11 通过。用例计数 api 1,288→**1,290**、全站 1,702→**1,704**。端点 / controller / 页面 / 迁移 / 表均不变；台账分数不变（**202.77/206 = 98.4%**，剩余 3.23，E 仍 **2.65**、I = 0（B 0.58））—— 这仍是关闭 v6.67 自己写下的诚实边界，不是补分。

**仍未做**：并发用例是**单进程 + 单 PG 实例**（Nest `app.inject` + 真连接池事务），不是多实例压测；行锁机制跨实例相同，但网络延迟、重试与连接池耗尽的时序没有覆盖；自由竞争只证“每张码一个赢家”，不证赢家分布稳定；后台 E2E 仍是**单进程单浏览器**，不覆盖多管理员同时操作同一条码；已核销的码仍只能停用、没有批量删除；本机开发库里**此前** E2E 遗留的已停用记录仍要手工清理。

---

## 变更登记（v6.67 · 邀请码补删除端点 · 2026-11-01）

v6.66 结尾「仍未做」的第 6 条（也是 v12.8 ⑧ 记的同一件事：邀请码后端只有停用、没有删除，**每跑一次后台 E2E 就在本机开发库留一条已停用记录**）—— 本批清掉它。

| # | 缺陷 | 改法 | 守卫 |
|---|---|---|---|
| P1-17 | 邀请码只有 `PATCH` 停用，没有删除端点。运营在后台「生成错了码」只能停用，记录永远占着列表；E2E 每跑一次也会留一条。而直接加一个裸 DELETE 更危险：已核销的码一旦被删，`invite_redemptions.code_id` 外键会拦（500），即便不拦，核销证据与账实也会一起消失 | 新增 `DELETE /ops/admin/invite-codes/{id}`，**只接受从未核销的码**：判定同时看快照 `used_count > 0` **和** `invite_redemptions` 是否真有该 `code_id` 的行（只信一边会漏掉「快照 0 但有核销行」/「有计数无行」的不一致数据），任一命中 → `400101` 并提示改用停用；删除用**条件删除** `WHERE id=? AND used_count=0`，与核销路径 `SELECT … FOR UPDATE` 的行锁配合，核销提交后条件不再匹配、删 0 行 → 同样 `400101`，不会「刚核销就被删」；外键冲突 `23503` 也翻译成 `400101`，不掉 500。面板每行加「删除」（已核销置灰 + tooltip），`window.confirm` 二次确认，`busy` 键 `${id}:delete` 与状态切换互斥，失败走既有 `handleError`；5 个语言包同位置补 6 个 key。顺带修前端 `isExhausted` 把 `max_uses=0`（不限次）误判为耗尽、禁掉启用按钮的分支 | `admin-community.spec.ts` **+1 例**（11 例）：未核销可删且行消失 / 已核销 `400101` 且行仍在 / 快照 0 + 核销行的幽灵数据也拒绝 / 再删 `400102` / 非数字 id；浏览器侧 E2E 补「删除」一步 |

**验证**：`pnpm test` **12/12 任务全绿，1,702 用例通过**（api 1,288 / cli 128 / shared 26 / storage 6(+1 skipped) / model-adapters 164 / db 27 / worker 63），3m37s（api 段真实重跑 3m35s），exit 0；`build` 8/8（32s）、typecheck 12/12（13s）、lint 7/7（6s，0 error / 27 条既有 warning），均 exit 0。api 的 +1 就是本批新增的删除用例。口径：端点 800→**801**（admin 域 24→**25**）、controller **63** / 页面 **65** / 迁移 **50** / 表 **115** 不变（零迁移；台账表头顺带把陈旧的「49 个迁移」修正为 50）。台账分数不变（**202.77/206 = 98.4%**，剩余 3.23，E 仍 2.65、I = 0，B 0.58）—— 这条从未计入三分类，是 v12.8 自己写下的诚实边界项；本批是「把已写的边界关掉一条」，不是补分。

**后台 10 面板 E2E 真栈重跑**：`_acceptance/e2e-admin-panels.cjs` 由 83 项增至 **85 项**（邀请流程「生成 → 停用 → **删除**」+ 删除后行消失两条断言），本机真栈（api :3002 / web :3003，PG/Redis 在跑）**85/85 通过**，`RESULT panels=10 panelFailures=0 writeFailures=0`，exit 0。本批新建的那条码已被流程自己删掉，不再在开发库留记录。

**仍未做**：**已核销的码仍不能删**（核销行是计费/拉新证据，`code_id` 外键本身就是这条约束），只能停用；没有**批量删除**（逐个删，避免一次误删一批）；本机开发库里**此前** E2E 遗留的已停用记录不会被自动清理，要手工处理；删除与核销的并发安全靠「条件删除 + 行锁」推理，接口用例没有像团队并发那样起两个真事务去撞，属设计论证而非并发实测；E2E 仍是**单进程单浏览器**，不覆盖多管理员同时操作同一条码。

---

## 变更登记（v6.66 · 审计写库有界重试 · 2026-11-01）

v6.65 结尾「仍未做」的第 1 条就是这条：**审计写库失败只记日志、不重试** —— 本批清掉它。
其余 5 条（TLS 真握手、CSP、后台不可逆 / 多角色 E2E、并发是单进程、邀请码无删除端点）保持原状。

| # | 缺陷 | 改法 | 守卫 |
|---|---|---|---|
| P1-16 | `AdminAuditService.record()` 的 `catch {}` **完全静默**：单次写库失败（连接抖动、主备切换）就永久丢掉一条已成功的运营操作审计，而且**一行日志都不留** —— 事故复盘时「操作发生了、审计里没有」，连「曾经试过写」都证明不了 | 有界重试：失败后 50/100ms 指数退避再试 2 次（共 3 次尝试），仍在响应的旁路上；**行对象循环外只构造一次**、重试复用同 id，撞唯一键 `23505`（含 `cause.code`）视为已落库、不插第二条；注入的 `sleep` 抛错被吞，`record()` 永不 reject；恢复记 `admin_audit_write_recovered` warn，用尽记 `admin_audit_write_failed` error（带 `attempts` / `request_id`）；日志字段压平换行并截 200 字符，构造的 `action` 伪造不出第二行日志 | `admin-audit-retry.spec.ts` 7 例（首败后成且同一行对象 / 三次用尽 + 退避 `[50,100]` / `23505` 顶层与 `cause` / `retries:0` / sleep 抛错被吞 / 换行压平），只 mock `db.insert`，本机无 PG 也能跑 |

**验证**：`pnpm test` **12/12 任务全绿，1,701 用例通过**（api 1,287 / cli 128 / shared 26 / storage 6(+1 skipped) / model-adapters 164 / db 27 / worker 63），3m36s（turbo 缓存命中 11/12，api 段真实重跑 3m35s），exit 0；`build` 8/8（9s）、typecheck 12/12（8s）、lint 7/7（5s），均 exit 0。api 的 +7 全是本批新增的 `admin-audit-retry.spec.ts`。口径不变：端点 **800** / controller **63** / 页面 **65** / 迁移 **50** / 表 **115**。台账分数不变（**202.77/206 = 98.4%**，剩余 3.23，E 仍 2.65、I = 0，B 0.58）—— 这条从未计入三分类，是 v12.7 自己写下的诚实边界项；本批是「把已写的边界关掉一条」，不是补分。

**仍未做**：重试是**进程内**的，退避那 150ms 内进程崩溃 / 被 kill 仍会丢这一条（要彻底不丢需持久 outbox 或落盘补写）；3 次 / 100ms 是为连接抖动调的，分钟级故障无能为力；日志标记不等于告警，接监控仍待部署侧配置；TLS 未在 Docker / 部署机做真实握手（本机无 Docker，只有静态断言）；CSP 仍注释；后台 E2E 不覆盖不可逆操作与多角色权限矩阵、价格面板不写；并发用例是**单进程多事务**而非多实例压测；邀请码后端无删除端点，**每跑一次 E2E 在本机开发库留一条已停用记录**。

---

## 变更登记（v6.65 · TLS 终止 + 后台 10 面板浏览器 E2E + 团队并发用例 + #12 许可范围 · 2026-11-01）

v6.64 结尾列的「仍未做」4 条里，本批清掉 3 条（`prod compose` 的 TLS、后台面板浏览器 E2E、团队并发用例）；
只剩「审计写库失败只记日志、不重试」。顺带把 #12「买断后二次改编许可」从口径落成实现（迁移 0049）。

| # | 缺陷 | 改法 | 守卫 |
|---|---|---|---|
| P1-13 | `prod compose` 的 nginx 只有 `listen 80` —— 生产要么明文，要么指望外部 LB 而容器内无 ssl；配合上一批的 `COOKIE_SECURE=true`，没有 HTTPS 就连登录 Cookie 都发不出去 | `nginx.conf` → `nginx.conf.template`（官方镜像 entrypoint 用 envsubst 渲染），compose 内**终止 TLS**：`listen 443 ssl` 是唯一业务入口，80 只留 ACME HTTP-01 与 `return 308 https://${TLS_SERVER_NAME}$request_uri`（**不用 `$host`**：拿 Host 头拼跳转目标 = 开放重定向）；`TLS_SERVER_NAME` 用 `${...:?}` 强制必填；证书只读挂载、私钥不入库；HSTS 由注释改**启用**，CSP 仍注释（Nuxt hydration 要内联脚本、未接 nonce） | `deploy-tls.spec.ts` 18 例静态断言（443 / HSTS / 跳转目标不是 `$host` / CSP 仍注释 / 模板与证书挂载 / compose 必填 / 证书被 git 忽略 / `rollback.sh` 走 https）。⚠️ **本机无 Docker**，`docker compose config` / `up` 与真实握手**没跑过** |
| P1-14 | 9（第 106 批拆完是 10）个后台面板只有接口 e2e，**没有一次在浏览器里真打开过** —— 数字输入崩溃、反代 404 这类缺陷 typecheck / lint / build 全绿看不见（本批真踩到两个，见下） | 10 面板真栈 E2E `_acceptance/e2e-admin-panels.cjs`（83 项）：真登录 + 未登录守卫 + 每面板「侧栏高亮 / 标题 / h2 / 首屏列表 `code=0` / 一次只读刷新 / 控制台 0 error」+ 两条可逆写流程（邀请码「生成→停用」、配置中心「新建→搜索→删除」） | 83/83，`RESULT panels=10 panelFailures=0 writeFailures=0`；报告 `_acceptance/_team/report-admin-panels.md`。明确不做：不可逆操作 / 多管理员权限矩阵 / 价格面板写 |
| P1-15 | 上一批把团队锁序改成按 `spaceId` 升序、配额改 SQL 自增，但**没有并发用例**，等于「按代码形状相信」 | — | 新增 `team-credits-concurrency.spec.ts` 4 例（真 PG 并发事务）：分配 / 回收不再 `40P01`、`creditsQuota` 自增不丢更新、Σ 守恒、失败整笔回滚 |
| #12 | 买断协议只记「购买 / 预售 / 授权」，**二次改编许可没有字段** —— 竞品把「仅使用 / 可改编」作为协议属性展示 | `market_agreements.license_scope`（迁移 0049，`smallint not null default 1`）：**1 可改编（禁止原样再发布）/ 2 仅使用**；`kind`→`scope` 默认映射（购买 / 预售→1、授权→2）、白名单校验（未知 `400101` + `details.field`）、**退款沿用原 scope**（不按当前模板重算）、作品页显示**协议行上**的 `license_scope_name`、5 语言文案 | `market.spec.ts` +1；`api-spec §16.6` 同步。只认领已实现的 0.10 |

**E2E 先踩出的两个「全绿缺陷」（都在这批修掉）**：
1. `<input type="number">` 上的裸 `v-model` 由 Vue 自动 looseToNumber → 运营一填数字，入参从 `""` 变成 number，而 `parseIntField(raw: string)` 调 `raw.trim()` → 抛 `trim is not a function` → **POST 根本发不出去**。`AdminInviteCodesPanel` / `AdminPricePanel` 两个解析器同形状。修法：签名改 `string | number` + `String(raw).trim()`；静态守卫 `admin-numeric-inputs.spec.ts` 7 例（含全目录扫描：裸绑定数字输入必须同时出现 `String(` 与 `Number.isInteger(`）。
2. web→api 反代目标 `routeRules["/v1/**"].proxy` 是**构建期**常量（Nitro 烤进 `.output`），运行期设 `NUXT_API_PROXY` 无效 → 本地栈 web 产物烤着默认 `127.0.0.1:3000`（本机是另一个项目的端口），10 个面板**全部正常渲染、`/v1/**` 全 404**。修法：启动脚本 build web 前注入 `:3002` + 启动前 `Assert-WebBuiltFor` 校验产物 + 就绪判据改成「经反代 `/v1/healthz/live` 拿 200」；守卫 `web-api-proxy.spec.ts` 10 例（含 Dockerfile `ARG`/`ENV` 顺序与 compose `build.args`）。

**验证**：`pnpm test` **12/12 任务全绿，1,694 用例通过**（api 1,280 / cli 128 / shared 26 / storage 6(+1 skipped) / model-adapters 164 / db 27 / worker 63），4m3s，exit 0；`build` 8/8（35s）、typecheck、lint 均 exit 0。api 的 +40 例 = `deploy-tls` 18 + `web-api-proxy` 10 + `admin-numeric-inputs` 7 + `team-credits-concurrency` 4 + `market` 1。口径：端点 **800** / controller **63** / 页面 **65** 不变（本批零新端点），迁移 49→**50**，表 115（只加列）。台账：#12 剧本广场 92%→**93.25%**（7.36→7.46）→ 全站 202.67→**202.77**（98.4% 不变）、生态 94.89→**94.99**、剩余 3.33→**3.23**、B 类 0.68→**0.58**；首发口径 130.68/133 = 98.3% 不变。

**仍未做**：审计写库失败只记日志、不重试；TLS 未在 Docker / 部署机做真实握手（本机无 Docker，只有静态断言）；CSP 仍注释；后台 E2E 不覆盖不可逆操作与多角色权限矩阵、价格面板不写；并发用例是**单进程多事务**而非多实例压测；邀请码后端无删除端点，**每跑一次 E2E 在本机开发库留一条已停用记录**。

---

## 变更登记（v6.64 · 上线前 P1 收尾 6 条 + 运营后台整批落库 · 2026-11-01）

v6.63 结尾列的「P1 剩余 12 条」里，本批清掉 6 条（只剩 `prod compose` 的 TLS）；
另外把已写好但没提交的运营后台一整批（9 个面板 + 角色 / 审计 / 配置中心）落库。

| # | 缺陷 | 改法 | 守卫 |
|---|---|---|---|
| P1-12 | `/v1/metrics` 是 `@Public`，nginx 又全量反代 → 任务量 / 失败率 / **资金指标**对外可读 | 改 Bearer：`METRICS_TOKEN`（≥16 位）进生产必填；比较用 `timingSafeEqual`，长度不等直接 false（不抛异常、不泄露长度） | `metrics-auth.spec.ts` 5 例：完全匹配才放行 / **未配置令牌时一律拒绝**（不能因为缺配置而敞开）/ 拒缺失·空·非 Bearer / 错误令牌不抛异常 / 不把前后缀当匹配 |
| P1-5/6 | 团队「分配」锁 `team → personal`、「回收」锁 `personal → team`，并发即 `40P01` 死锁；且 `creditsQuota` 是读-改-写，并发丢更新 | 新增 `lockCreditAccountPair(tx, a, b)`：**按 spaceId 升序**锁两个账户，分配 / 回收共用；配额改由 SQL 表达式 `creditsQuota + n` 原子完成 | ⚠️ **无并发用例**：`team.spec.ts` 只覆盖守恒 / 上限 / 越权 / 批量 / CSV。锁序与自增靠代码形状 + PG 语义，**未压测** |
| P1-3 | 升级「报价按天折抵、履约追加整周期」：折抵按剩余天数算价，但新周期从 `max(now, 旧 endAt)` 起 → 白送旧周期剩余天数 | `isUpgrade = paidAmountCents < listPriceCents`；升级的新周期一律从 `now` 起算（非升级续费仍是 `max(now, endAt)`） | `billing-subscription.spec.ts:178`「升级换档：折抵后新周期从今天起算，不叠加旧周期剩余天数」 |
| P1-9 | `?stream_token=` 一旦带上就**对所有受保护路由生效**，等价于把 SSE 短令牌变成万能 Bearer；而 query 里的 token 会进 nginx 访问日志 | 新增 `@AllowStreamToken()`，只在 4 个 SSE 处理器上开放；其余路由的 query token 一律忽略 | `agent.spec.ts:302` 先证明同一枚短令牌能开 SSE，再拿它打 `/me?stream_token=` **必须 401** |
| P1-10 | refresh 轮换「先读再删」有并发竞态：两请求同时带同一枚 token 都可能成功 | 改成 Lua `delIfCurrent`：**比对当前值后再删**，原子完成；守卫值不匹配时一个键都不删（不误删新会话） | `token-refresh-rotation.spec.ts` 4 例：同一枚只能消费一次 / 并发恰好一个成功 / 已被新会话覆盖的旧 token 不能消费 / 守卫值不匹配时零删除 |
| P1-11 | `COOKIE_SECURE` 有默认值 → 生产「忘记设置」会静默降级成非 Secure Cookie | 与 `METRICS_TOKEN` 一起进 `env.ts` 生产必填清单，缺失即启动失败并给出明确文案 | `env-production-guard.spec.ts` 16 例（含逐 key 缺失矩阵与 `COOKIE_SECURE` 文案断言） |

**运营后台整批（9 个面板）**：角色 `super/ops/viewer` + `token_version` 即时踢下线；`admin_audit_logs` 由全局拦截器统一记录
（只记 `/v1/ops/` 的写操作、**成功才记**、键名打码、URL 不带 query、8KB 截断、fire-and-forget 不阻塞业务）；
配置中心 `(key, module)` 唯一键 + `module@lang` 语言回退；等待名单 / 邀请码 / 用户封禁与注销恢复 / AI 标识审计 + CSV /
漏斗 / 模型档位 `modes` 热改 / 首页配置版本化 / 画布 SSRF 守卫 / 登录限流。

**验证**：`pnpm -r test` **12/12 任务全绿，1,654 用例通过**（api 1,240 / cli 128 / shared 26 / storage 6(+1 skipped) / model-adapters 164 / db 27 / worker 63），4m7s，exit 0；typecheck / lint 0 error。运营后台的两个 DB e2e（`admin-community.spec.ts`、`admin-ai-label.spec.ts`）在真实 PG + Redis 下随全量套件跑通（v6.60 当时因本机无 PG/Redis 未跑）。同时把口径更新为：端点 780→**800**、controller 54→**63**、迁移 47→**49**、表 113→**115**、页面 65 不变。

**仍未做**：`prod compose` 的 TLS（仍只有 `listen 80`）；9 个后台面板**无浏览器 E2E**；团队锁序与配额自增**无并发用例**；审计写库失败只记日志、不重试。

---

## 变更登记（v6.63 · P1 第二批两条：任务删除判据改流水口径 / 轮询上限默认值 · 2026-10-30）

| # | 缺陷 | 改法 | 守卫 |
|---|---|---|---|
| P1-1 | `DELETE /tasks/{id}` 用 `tasks.credits_frozen > 0` 判「还带着冻结」→ 该字段在 PR-03 前从不归零、**恒真**，等于「任何计价 > 0 的任务永久删不掉」；反过来历史脏行（字段非 0、流水已结清）会被误拒 | `tasks.service.remove()` 改为事务内锁任务行 + `taskOutstandingFrozen(tx, id)`（= `Σ frozen_delta`）；拒绝时返回 `400101 + credits_frozen=outstanding` | `task-delete.spec.ts` 两条：①**造真实 freeze 流水**才判拒（旧夹具只写字段，是"线上不存在的状态"）；②字段残留但流水已结清 → **允许删除**（新增用例，专防回退）。`remove()` 与 `releaseFrozen()` 从此共用同一把尺子 |
| P1-16 | `POLL_MAX_MS` 默认 **120s**，而真实视频生成 2–10 分钟 → 按默认配置上线「绝大多数视频任务超时判失败」（不扣费但口碑重创 + 污染失败率告警） | `executor.ts` 导出 `DEFAULT_MAX_POLL_MS = 15min`，`main.ts` 与 `executor` 内部 deadline 都用它（此前两处各写一个 `120_000`） | `executor.spec.ts` 新增 2 例：常量 ≥10min；`main.ts` 必须引用常量且**不许再内联 `120_000`**（源码级守卫，防"改了常量但入口还写死"） |

**验证**：`apps/api` 全量 **104 文件 / 1227 用例**、`apps/worker` **63/63**，均 exit 0；typecheck/lint 0 error。

**仍未做（P1 剩余 12 条，按风险排序）**：`/v1/metrics` 公开（`@Public` + nginx 全量反代）→ 任务量/失败率/资金指标对外可读；团队分配/回收锁序相反（`40P01` 死锁）；升级「报价按天折抵、履约追加整周期」（权益泄漏）；`stream_token` 当万能 Bearer 且进 nginx 访问日志；`COOKIE_SECURE` 默认值架空"必须显式设置"的守卫；`refresh` 轮换的并发竞态；`prod compose` 的 TLS（仍只有 `listen 80`）。

---

## 变更登记（v6.62 · P1 首批三条：分享页 routeRules / renew 撤销校验 / 网关安全头 · 2026-10-30）

上线前全检报告把 P1 十七条排到「上线后第一周」，但其中三条是**改一行就能清掉、且清不掉会白屏或不可撤销**的，
这批先把它们做掉；其余十四条不动（README 与报告口径保持一致，不假装整批完成）。

| # | 缺陷 | 改法 | 守卫 |
|---|---|---|---|
| P1-14 | `/share/[token]` 声明 `ssr:false` 但 `nuxt.config` 缺 `routeRules`（与第 105 批 `/team/**` 同类）：**匿名直开的分享链接首帧不一致 → 整页空白** | `nuxt.config.ts` 补 `/share`、`/share/**` | 新增 `apps/api/test/web-route-rules.spec.ts`（4 例）：`pages/` 下**每个顶层路由**都必须在 routeRules 里声明 `ssr:false`，且根路由 `/` 必须**不**被切成 SPA。这是第一次把「新增页面必须同步配置」变成红/绿判据 |
| P1-8 | `/auth/renew` 的 **Cookie 降级通道**只验签不查撤销：登出/改密/踢下线之后，被窃的 refresh cookie 仍可在 14 天内无限续 access（**不可撤销的长期凭据**） | `token.service.ts` 新增 `assertRefreshActive()`（只读不消费，避免续期互相作废）；`renew()` 的 cookie 分支补撤销校验 + 账号停用校验 | `auth-oauth.spec.ts` 新增 1 例三步判据：Cookie 续成功 → 登出 → 再续 `401101`。**已反向验证**：注释掉该校验，该例立刻红（`expected 0 to be 401101`） |
| P1-10 / 11（部分） | 网关无任何安全响应头；`client_max_body_size 12m` 与 API `bodyLimit 48MB` 不一致（大图 base64 被网关先 413，应用日志里查不到） | `deploy/nginx.conf`：加 `X-Content-Type-Options` / `X-Frame-Options: SAMEORIGIN` / `Referrer-Policy` / `Permissions-Policy` / `COOP: same-origin-allow-popups`（OAuth 弹窗必须）/ `CORP: same-site`；body 上限对齐 48m | 无自动化（需真起网关）；HSTS 与 CSP **保持注释状态**并写明前置条件（HSTS 要等 TLS；CSP 要先接 nonce），不拿"看起来有"充数 |

**验证**：`apps/api` 全量套件在真实 PG+Redis 下 **104 文件 / 1226 用例全绿**；`web build` 通过（routeRules 语法生效）。

**仍未做（这批的边界）**：P1 余下 14 条（`POLL_MAX_MS=120s`、`/v1/metrics` 公开、`/tasks/:id` 删不掉、团队锁序死锁、升级权益泄漏、`stream_token` 万能 Bearer、`COOKIE_SECURE` 默认值架空守卫…）；nginx 仍只有 `listen 80`，TLS 由外层终止；CSP/HSTS 未启用。

---

## 变更登记（v6.61 · 上线前全检 P0 六条落地 · 2026-10-30）

### 一、这批补的是「能不能上线」，不是「像不像竞品」

`deliverables/gstack/pre-launch-check-oneframe-2026-10-29.md` 判 **No-Go（P0×6 / P1×17 / P2×18）**。
台账口径的 98.4% 与这份结论**不矛盾也不相抵**：前者量的是「竞品有的我们有没有」，
后者量的是「照样例部署会不会出事」。这批只做 P0 六条。

| # | 缺陷 | 落点 | 关闭判据 |
|---|---|---|---|
| PR-01 | 生产编排起不来（`PHONE_*` 未透传、无 `env_file`、默认值可过守卫） | `app/docker-compose.prod.yml`、`app/.env.production.example` | **未关闭**：代码已改，但本机无 Docker，`docker compose up` 仍待真跑一次 |
| PR-02 | 支付 fail-open（`PAYMENT_LIVE` 不在守卫、mock 端点无鉴权、`amountCents` 可省略） | `billing.controller.ts`（生产**硬拒** mock）、`billing.service.ts`（归属校验 + mock 金额必填 + `toBigId`）、`env.ts`（`PAYMENT_LIVE` 进必填） | ✅ 单测 + 真库直调 |
| PR-03 | 记账恒真判据（`credits_frozen` 从不归零 + `fail()` 漏 `CANCELED` → 取消后二次退款） | 新增 `@app/db releaseFrozen()` 唯一收尾入口，替换 7 处写入点（executor×2 / tasks.cancel / generations 入队失败 / ad-drama×2 / auth 注销），看门狗按流水归零 | ✅ `ledger-release.spec.ts` 4 例 + 全量套件 |
| PR-04 | canvas 批量下载 SSRF | 新增 `canvas-download.guard.ts`（协议/凭据/host 白名单/内网黑名单/解析后校验/超时/体积/重定向逐跳复检/可信 origin 豁免），并复用到 `tasks` 的两处同类裸 `fetch` | ✅ `canvas-download-ssrf.spec.ts` 91 例 |
| PR-05 | 占位密钥盲区 + admin 与用户共用 `JWT_SECRET` | `env.ts`（占位符黑名单 + 强度下限 + `ADMIN_JWT_SECRET`）、`admin-auth.service.ts`（签发/校验改用独立密钥） | ✅ 单测 19 例 |
| PR-06 | 注销搁浅冻结，且 `auditLedger` 结构上查不出 | `auth.service.ts deleteAccount`：**先按流水 unfreeze 再置 status=5** | ✅ 双向不变式用例 |

### 二、顺手修掉的两个「让测试永远红」的既有缺陷（都不在 6 条 P0 里，但挡着 CI）

1. `common/admin-audit.interceptor.ts`：只靠构造参数类型注入 `AdminAuditService`。vitest 用 esbuild 转译**不产出
   `design:paramtypes`**，Nest 于是零参构造 → `this.audit` undefined → 每次运营写操作后 `setImmediate` 抛
   `Cannot read properties of undefined (reading 'record')`。**它不让任何断言变红，只把 `pnpm test` 退出码拖成 1**
   （全量套件曾累计 101 条 uncaught error）。改显式 `@Inject(AdminAuditService)`。
2. `admin-ai-label.service.ts` 列表 `orderBy(desc(finished_at))`：PostgreSQL 的 `DESC` 默认 **NULLS FIRST**，
   历史脏数据（status=3 但 `finished_at` 为空）把最近完成的任务挤出首屏；5000 行扫描上限一满，新行永远查不到。
   改 `desc nulls last`。

### 三、验证（本机真跑，DB 已起）

本机此前无 PG/Redis，这批首次把 `start-local-stack.ps1` 起起来并把迁移打到 0048、seed 46 模型：

| 命令 | 结果 |
|---|---|
| `pnpm --filter @app/api test`（真实 PG + Redis，`--no-file-parallelism`） | **103 文件 / 1221 用例全绿，exit 0**（此前从未跑过：77 个连库 e2e 一律跳过） |
| `pnpm --filter @app/worker test` | 61/61（含 watchdog、maintenance 账本一致） |
| `typecheck`（api/worker/db）+ `lint`（0 error，2 条既有 warning） + `build`（api/worker/db） | 全绿 |

### 四、仍未做（这批的诚实边界）

- **PR-01 的关闭证据**（`docker compose up` 真跑 + 生产 `NODE_ENV=production` 下 mock 端点活体 403）本机无 Docker，未做；
- **P1 17 条一条未动**（`/share` 缺 routeRule、`POLL_MAX_MS=120s`、nginx 仅 80 无安全头、`/auth/renew` 无撤销校验、
  `/v1/metrics` 公开、`/tasks/:id` 删不掉、团队锁序死锁…），按报告行动 7/8 排在上线后第一周；
- **DNS 与 fetch 之间的 TOCTOU** 仍在（先校验后请求），要彻底钉死需自建 dispatcher 固定 IP；
- `notify/mock` 的 `space_id` 是「传了就强校验」而非必填（生产已一律 403，敞口只剩开发机）；
- 真实供应商出片抽验（AI 标识 CODE-H1）、EXT-01~20 外部资质、D1–D9 演练仍全部 ⏳。

---

## 变更登记（v6.60 · 运营后台第二批：等待名单 / 邀请码 / 用户管理 / AI 标识审计 / 广场面板 · 2026-10-30）

### 一、这批补的是审查报告里"仍未做"的最后几项

| 缺口 | 落点 |
|---|---|
| 等待名单只有用户提交、后台不可见 | `GET /ops/admin/waitlist`（invited 过滤、只回 `phone_hash_prefix`）+ `POST /:id/invite` 幂等标记；「等待名单」页签 |
| 无运营发码入口（`invite_codes.created_by` 一直空） | `GET/POST/PATCH /ops/admin/invite-codes`（批量 1..50、8 位无歧义码、耗尽不可启用）+「邀请码」页签 |
| 无用户管理/封禁/注销恢复 | `GET /ops/admin/users`（昵称/ID/手机号哈希、status/deleted 过滤、`phone_masked`）、`PATCH users/:id`、`POST users/:id/restore` +「用户管理」页签 |
| AI 标识审计导出（compliance B3 待办） | `GET /ops/admin/ai-labels` 与 `.csv`（数据源 `tasks.results[].meta.ai_label`，`only_missing` 抽验"成功但没打标"）+「AI 标识审计」页签 |
| 剧本广场面板缺看板/详情/重提 | `AdminMarketPanel` 接 `GET /ops/market/dashboard/scripts`、`scripts/list?status`、`scripts/:id`、`POST scripts/:id/submit-review`；看板 chip 即状态筛选 |
| 配置列表无服务端分页 / 审计无导出 | `GET /ops/admin/configs?page&page_size&module&q`；`GET /ops/admin/audit-logs.csv`（同过滤、≤5000 行） |

### 二、口径（写进 api-spec §11）

- `users` 只回打码手机号；注销恢复不还原被匿名化的昵称/头像（可传新昵称）。
- `waitlist` 只有 HMAC，平台发不了短信；`invite` 只是"线下已邀请"的标记。
- `invite-codes.status=3`（耗尽）是派生值（`status=1 且 used_count>=max_uses`），列表过滤按同一口径翻译。
- `ai-labels` 不建第二套埋点表、不做回填；`has_ai_label` 与 `enabled` 分开看；单次扫描 ≤5000 行。

### 三、验证

- `@app/api` typecheck/lint/build 通过；`@app/web` typecheck/build 通过；`i18n-check` 5 语言一致（本批新增 220 key）。
- 纯函数单测 36/36：漏斗 13 + 审计脱敏 9 + 邀请码/手机号打码/AI 标识解析 14。
- **当时未跑 DB e2e**（本机无 PG/Redis）：`admin-community.spec.ts`、`admin-ai-label.spec.ts` 需 CI 执行 —— v6.64 已在真实 PG+Redis 的全量套件里补跑并通过。

### 四、仍未做

- 剧本广场未接 `source-original-script` / `save-draft` / `tag_ids` 归类；`keyword` 只搜标题。
- AI 标识列表 total 在 5000 行上限处是被截断的上限（未回 `truncated` 标记）。
- 等待名单无法直接发短信/发码（数据模型只存 HMAC，需产品决定是否补联系方式字段）。

---


## 变更登记（v6.59 · 运营后台补齐：计价/任务筛选/模型档位/漏斗/审计/管理员/配置中心/广场面板 · 2026-10-29）

### 一、为什么做

2026-10-29 对 `/admin` 做了一次功能缺失审查（[报告](../deliverables/software-company/admin-console-gap-review-2026-10-29.md)），确认后台"API 多、可操作界面少"：

- 计价只有 API、后台无价目界面；任务看板不能筛选、看不到失败原因；
- 模型只能上下架，排序/参数枚举不可维护；
- 漏斗只有计数与转化率，缺耗时/退出率/完集口径，且与埋点口径不一致；
- 大量管理 API 没有后台入口（`/ops/market/*` 23 条、`/ops/agent-skills` 2 条、`/ops/admin/exports`）；
- 无操作审计日志、无管理员账号/权限管理、无配置中心、无退款对账导出；
- 工具模型改价/上下架在进程重启后被代码目录覆盖。

### 二、这批落了什么

| 层 | 内容 |
|---|---|
| 后台页面 | 新增「价格管理」「剧本广场」「Skill 推荐位」「操作日志」「管理员」「配置中心」「导出审计」7 个页签/面板；模型页签加排序与 `modes` JSON 热更；任务页签加状态/模型筛选、分页、失败原因列、筛选后 CSV；漏斗展示流失率/平均耗时；订单加状态筛选、分页与退款单 CSV；举报/分享/创作者审核分页；运营位支持编辑；概览渲染任务状态分布 |
| API | `GET /ops/admin/models` 回 `modes/types`；`PATCH models/:id` 支持 `modes`（1..20 键、≤32KB、档位校验）；价目列表加 `active` 筛选与 `model_name/active/updated_at`；`GET tasks` 加 `model_id/mode` 与 model/adapter/error 字段；`task-metrics`、`failed-tasks.csv` 共用 `model_id/from/to` 筛选；漏斗改为 6 段项目维度（建项→大纲→角色→分镜→批量→完集）+ `dropoff_from_previous/avg_hours_*`；新增管理员账号 CRUD（super-only）、操作审计 `audit-logs`、配置中心 `configs`/`config/:key`、`orders.csv` |
| 数据 | 迁移 `0047_fair_sphinx`：`admin_audit_logs`、`app_configs`、`admin_users.status/token_version/last_login_at/password_updated_at`，并把存量首个管理员提升为 `super`；迁移 `0048_amusing_mandarin`：配置唯一键改 `(key,module)`，让多语言覆盖可并存 |
| 鉴权 | 角色 `super/ops/viewer`；`AdminGuard` 每请求读库校验 `status/token_version`，改密/停用后旧 JWT 立即失效；viewer 只读；`admin_users` 管理仅 super |
| 一致性修复 | `ensureToolCatalog` 不再覆盖运营改过的 `visible/sort/credits/strike/active`，只补缺失行；`CATALOG_SYNC_TOOLS=true` 才强制同步（测试/应急） |

### 三、验证与边界

- `@app/api` typecheck/lint/build 通过；`@app/web` typecheck 通过；`i18n-check` 5 语言包一致（新增 356 key）。
- 纯函数单测：漏斗合并/算术 13 例、审计脱敏 9 例通过。
- **未在本机跑 DB e2e**（本机无 PG/Redis）：`admin.spec.ts`、`admin-core-funnel.spec.ts`、`admin-ops-*.spec.ts` 需 CI/本地栈执行；`db:migrate` 也未执行。
- 相关文档：api-spec §10.5/§11 已同步、database §8 已同步；契约与施工边界见 [admin-console-completion-contract-2026-10-29](../deliverables/software-company/admin-console-completion-contract-2026-10-29.md)。

### 四、仍未做（下一批）

- 等待名单查看/发放邀请码、用户封禁/注销恢复（运营人工介入点）；AI 标识审计导出；
- 剧本广场面板未接 `submit-review`/作品详情/看板徽标；配置列表无服务端分页；审计日志无 CSV 导出。

> 本批已补：admin 登录限流（同用户名+IP 5 分钟 10 次失败 → 429）；运营位/首页板块从「概览」
> 拆成独立页签（原先是藏在 dashboard 里，运营找不到）。

---


## 变更登记（v6.58 · 第 104 批：收尾 —— 把「剩下 3.33 卡在谁手上」写成具名清单 · 2026-10-29）

### 一、这批要解决的问题

前几批我反复说「98.81% 是真实天花板、99% 算术不可达」，但这只是**一句判断**。这批把它变成**可核对的出处**。

> ⚠️ **并且这个数字要下调到 98.71%**：`(202.67 + 0.68) / 206 = 98.71%`。
> 第 97/98 批真做掉了 0.09（#23/#17 加分），但第 102 批把 #4 的 0.20 从 **B 改 E**
> （`is_home_recommend` 机制已补、剩下的是运营填内容）—— **它不再能靠一句产品拍板拿到**，
> 所以上界反而降了 0.10。这是「把分类改准」的代价，我认为值得：
> 一个诚实的 98.71% 比一个虚高的 98.81% 有用。

台账新增 **§5.6「剩下 3.33 的具名阻塞清单」**：

| 分类 | 权重 | 条数 | 写法 |
| --- | ---: | ---: | --- |
| **B 类** | **0.68** | 7 | 每条写「缺什么 / **谁能解** / 解开后我做什么」 |
| **E 类** | **2.65** | 14 | 每条写「缺什么 / **凭据或证据来源**」 |
| I 类 | 0 | — | 见第四节（这条需要打折读） |

**关键结论：没有任何一项写着「等排期」。** 每一分都指得到一个具体的人、凭据或证据。

### 二、B 类 0.68 逐条（7 条）

| 模块 | 权重 | 卡在谁 |
| --- | ---: | --- |
| #12 二次改编许可 | 0.20 | **法务 + 商务**（授权语义，不是产品能单独定的） |
| #2 买断/协作 12 条 | 0.16 | 产品（要不要为「买断权」「本子级协作」各建一套模型） |
| #11 画布 4 条小能力 | 0.10 | 产品（画布内剪辑/裁剪/组回收站是否本期范围） |
| #7 子账号密码 | 0.10 | 产品 —— 但我**明确建议「不做」**（见下） |
| #5 影视版合流 | 0.09 | 产品 |
| #22 账号合并 | 0.02 | 产品（涉及账号安全与客服成本） |
| #24 结果文件夹 | 0.01 | 产品 |

**关于 #7 的判断**：我们团队是「手机号邀请的**真实用户**」，没有子账号体系。竞品的
`member/:id/password` 若照做，就是**只存哈希却没有登录路径的死代码** —— 这不是「等产品」，
而是**技术上就是错的**（死代码 + 安全负债）。所以 §5.6 里写的是「**建议不做**」。

### 三、E 类 2.65 的分布

最大三块：ASR 凭据 0.60、供应商 Key 0.60、真实打款 0.44 —— 全是**商务/财务**能解的。
其余是竞品取证（quality-check 0.13、STAGE 值域 0.09、结局分支 0.08、切片语义 0.08）、
渠道测试号 0.04、法务文案 0.01 等。

其中 **#4 推荐位内容 0.20 已从「产品口径」降级为「运营内容」** —— 因为第 102 批把机制补齐了
（`/ops/agent-skills` 可编排 + 前端「★ 推荐位」筛选），现在只差运营挑卡。

### 四、必须打折读的一句：「I 类 = 0」

台账长期写「代码侧已无『不需要外部输入、只是没排期』的项」（I 类 = 0）。

**第 102 批证伪过一次**：`agent_skills.is_home_recommend` 有读无写、`plaza?is_home_recommend=1`
是永远返回空的死分支 —— 那是**标准的 I 类**，却一直记在 B 类 0.20 里。

所以这批把措辞改准：**「I = 0」只能读作「当前未发现」，不是「不存在」。** 并列出三种**尚未做过**的检查：

| 已做 | 方法 |
| --- | --- |
| 99/101 批 | 跨层一致性（算价↔扣费、校验↔写入、token↔读取） |
| 102 批 | 「谁生产数据 / 谁消费数据」 |
| 103 批 | 全库扫「有读无写」的列（974 列，41 可疑，逐个核后全是误报） |
| **未做** | 「**写入了但没人读**」（反向）、「**端点注册了但没客户端调**」、「**队列孤儿消息**」 |

### 五、顺带修的 6 处分类合计漂移

第 97（#23 −0.015）、98（#17 −0.08）、102（#4 的 0.20 从 B 改 E）三批**改了模块行，忘了改分类合计**：

| 位置 | 写着 | 真值 |
| --- | --- | --- |
| §5.3 / §5.5 三分类 | E = 2.45、B = 0.975（合计 **3.425**） | **E = 2.65、B = 0.68**（合计 3.33） |
| 表 A #4 行 | `E 0.60 + B 0.20`、「只有接口形状」 | `E 0.60 + **E 0.20**`、「机制已补、只剩运营挑卡」 |

> 第 103 批的守卫**查不到**这一类 —— 它校验「模块行 → 汇总」，但分类合计是另一套数。
> 所以这批给守卫**加了第 8 例**：「三分类合计必须等于剩余，且多处表述必须一致」。

### 六、验证与数字

| 项 | 数字 |
| --- | --- |
| 守卫 | 7 → **8 例** |
| api 测试 | 1022 → **1023**（总 1,435） |
| 门禁 | **12/12 全绿** |
| 反向验证 | §5.5 改回 E=2.45/B=0.975 → **1 红**（`合计 3.43 应等于 3.33`），restore 后 8 绿 |
| 端点 | 780 不变 |
| 分数 | **202.67 / 剩余 3.33 不变** |

### 七、诚实边界

1. **本批零产品代码变动** —— 全是台账口径与结构，所以分数不动。
2. **§5.6 里「谁能解」是我按模块性质推断的**（例如 #12 判给法务而非产品）。**实际组织分工可能不同** —— 这份清单的用途是「指给人」，不是「替人决定」。
3. **「没有一项写着等排期」这句话的强度**：见第四节。它是**「没查到」**，不是**「不存在」**。
4. **B 类 0.68 里我唯一给建议的是 #7**（建议不做）。其余 6 条不该由我替产品拍板。


## 变更登记（v6.57 · 第 103 批：把「台账数字会漂」做成守卫 —— 一次抓出 6 处过期数字 · 2026-10-29）

### 一、怎么发现的

第 102 批结尾我判断「剩余 3.33 里 B 0.88 都是真产品口径」。这批按「**谁生产数据**」复核，顺手核了台账自身 —— 发现：

**模块行已经重算到 202.67，但 §0 结论、§3.4 汇总表、§5 缺口表还写着 202.58。**

第 97 批（#23 +0.01）和第 98 批（#17 +0.08）都**只改了模块行，忘了改三处汇总**。

### 二、这是一类反复出现的问题

| 批次 | 发现的台账问题 | 性质 |
| --- | --- | --- |
| 84 | #12「竞品 29+12 全覆盖」是**重复记账** | 口径错 |
| 98 | #17 的 0.08 是**记账过期**（早已实现且有测试） | 口径错 |
| **103** | **模块行 202.67，汇总还写 202.58** | **算术漂移** |

前两次是「口径错」，这次是「算术漂移」—— 后者**最适合用测试钉住**：模块行是唯一事实源，其余汇总必须能由它重算。

### 三、新增守卫：`ledger-consistency.spec.ts`（7 例）

| 断言 | 防什么 |
| --- | --- |
| 28 行 / Σ权重 206 / 编号 1..28 无缺无重 | 漏行、重复记 |
| 每行 `加权得分 = 权重 × 完成度`（±0.011） | 手算错 |
| §3.4 三组数字**可由模块行重算** | 汇总漂移 |
| 剩余 = §0 结论 = §3.4 脚注 | 三处互相对不上 |
| **§5 逐条剩余 = 对应模块「权重×(1−完成)」** | §5 落后于模块行 |
| §5 合计 = 全站剩余 | 合计笔误 |
| 每个未满 100% 的行必须有非空「主要缺口」 | 没有出处的扣分 |

### 四、守卫首跑抓到的 6 处真漂移（全部修掉）

| 位置 | 写着 | 真值 |
| --- | --- | --- |
| §0 一句话结论 | 202.58 / 剩余 3.42 / 首发 130.59 / 核心 97.9% | **202.67 / 3.33 / 130.68 / 98.0%** |
| §0 口径表（全站/首发/核心三行） | 同上 | 同上 |
| §0 事实 2、3 | 剩余 3.42、核心 97.9%、首发 98.2% | **3.33 / 98.0% / 98.3%** |
| §3.4 汇总表 3 行 + 2 处脚注 | 107.69 / 94.85 / 202.58 / 130.59 | **107.78 / 94.89 / 202.67 / 130.68** |
| **§5 第 11 行（#17）** | 剩余 **0.08** | **0**（模块行已 100%） |
| **§5 后处理/计费/多语言** | 剩余 **0.055** | **0.04**（#23 已 100%，真值 0.03+0+0.008） |
| **§5 合计** | **3.42** | **3.33** |

后三行是**上两批我漏改的**，守卫一跑就暴露了。

### 五、写守卫时自己踩的两个坑

1. **`~~0.08~~ → **0**` 的取数**：台账「已清零」写法是删除线 + 箭头。直接取第一个数字会拿到**过期旧值 0.08**，于是守卫误报「§5 还写 0.08」——其实已经改了。
   修法：`currentNumber()` 有 `→` 时取**箭头之后**的数。
2. **§5「合计」行要排除逐条比对、单独校验**：否则合计被算两遍（得到 6.74 而不是 3.41）。

### 六、验证与数字

| 项 | 数字 |
| --- | --- |
| 新增守卫 | **7 例** |
| api 测试 | 1015 → **1022**（总 1,434） |
| 门禁 | **12/12 全绿** |
| 反向验证 | §3.4 改回 202.58 → **1 红**（报错写明「全站应记 202.67」），restore 后 7 绿 |
| 端点 / 表 / 迁移 | 780 / 113 / 47 均不变 |
| 分数 | **202.67 / 剩余 3.33 不变** |

### 七、诚实边界

1. **本批零产品代码变动** —— 改的全是台账数字 + 一个只读守卫。所以分数不动。
2. **守卫只校验算术与交叉引用，不校验「完成度是否公允」。** 那需要人读代码，是 §5.5 逐项核账的活，测试替代不了。
3. **守卫跑在 api 的 test 里但读的是仓库外层的 `docs/`** —— 这是有意的（`competitor-route-parity.spec.ts` 同样读源码文件，已有先例）。副作用：**如果有人只把 `app/` 目录拷出去跑测试，这个 spec 会报「找不到台账」**。我选择让它**失败**而不是 skip —— 分数线不一致比测试报错更危险。
4. **§5.5 那句「I 类 = 0」已被第 102 批证伪**（`is_home_recommend` 其实是内部可做但没排期的工作）。本批没改那句，登记在此待后续处理。


## 变更登记（v6.56 · 第 102 批：#4 的「运营位内容」里藏着一个工程缺口 —— `is_home_recommend` 有读无写 · 2026-10-29）

### 一、怎么发现的

第 101 批我判断「剩余 3.33 里 B 0.88 都是真产品口径」。这批按「**谁生产数据**」逐条复核，核到 #4 的 0.20 时发现不对劲。

全仓搜索 `isHomeRecommend`，只有**两处**：

| 位置 | 作用 |
| --- | --- |
| `agent-skills.service.ts:296` | `page()` 里的**读过滤** |
| `agent-skills.service.ts:691` | `toDto()` 里的**投影** |

**没有任何赋值。** 也就是说这一列**有读无写**。

### 二、后果是可验证的死分支

1. 33 张平台卡的 `is_home_recommend` 永远是建表默认值 `false`；
2. 所以 `GET /agent-skills/plaza?is_home_recommend=1` **永远返回空数组** —— 竞品这个筛选项在我方是一条死分支；
3. 更关键：C 端的 `PUT /agent-skills` **也改不了它** —— 那条路要求 `requireOwned(spaceId, userId, id)`，而平台卡的 `space_id` / `owner_user_id` 都是 `NULL`（`seedCatalog()` 种入），**没有任何用户「拥有」平台卡**。

### 三、铁证：测试自己记录了这个缺口

既有用例 `agent-skills.spec.ts:650` 标记推荐位用的是：

```ts
await db.update(agentSkills).set({ isHomeRecommend: true }).where(...)
```

**直接写库** —— 因为当时确实没有 API 可调。而且 `:649` 还断言「推荐位默认 0 张」。

**测试被迫绕过 API 直接改库，本身就是「缺一个写入口」的证据。**

### 四、补了什么

| 位置 | 改动 |
| --- | --- |
| `agent-skills-admin.controller.ts`（新） | `GET /ops/agent-skills`（平台卡列表）+ `PATCH /ops/agent-skills/:id`（设置推荐位），走 `AdminGuard`，与 `/ops/market/*` 同模式 |
| `agent-skills.service.ts` | `adminListPlatformSkills` / `adminSetHomeRecommend`：**只允许平台卡**、幂等（重复设置返回 `changed:false`）、列表按 `is_home_recommend desc, use_count desc` 排序 |
| `AgentSkillDrawer.vue` | 新增「★ 推荐位」筛选（只在广场页出现，切 tab 自动清除） |
| `agent.module.ts` | `imports: [AdminModule]` —— 见下节 |

### 五、踩了一个会让全仓 e2e 归零的坑

新控制器注入 `AdminGuard`，而 `AdminGuard` 依赖 `AdminAuthService` —— **只有 `AdminModule` 才 `exports` 它**。

`AgentModule` 没 import 它，于是 `NestFactory.create(AppModule)` **DI 失败**，vitest 表现为：

```
Error: Worker exited unexpectedly
```

**不是一条用例红，是全仓 e2e 归零。** 补 `imports: [AdminModule]` 后恢复。

这个坑 `market.module.ts` 的注释里早就写过（「漏注册会直接让 DI 失败，不只是一个 spec 红」），我这次还是踩了 —— 说明注释救不了人，**降低踩坑成本的应该是测试**（这次 `Worker exited unexpectedly` 的报错信息确实足够定位）。

### 六、验证与数字

| 项 | 数字 |
| --- | --- |
| `agent-skills.spec.ts` | 11 → **13 例**（新增：运营编排推荐位含幂等/广场可见/下架；只允许平台卡 + 不存在 400102） |
| 反向验证 | 把写入注掉 → **1 红**；restore 后 13 绿 |
| 门禁 | **12/12 全绿** |
| 端点 / controller | 778 → **780** / 53 → **54** |
| 用例 | 1,425 → **1,427**（api 1013 → **1015**） |
| 分数 | **202.67 / 剩余 3.33 不变** |

### 七、为什么分数不动（以及我改了什么）

**#4 那 0.20 原记「Skill 市场运营位内容（产品口径 B）」。**

我补的是**机制**，不是**内容**：

- ✅ 运营现在可以编排推荐位了（此前完全不能）
- ✅ 用户可以在抽屉里按推荐位筛选了（此前这个筛选永远空）
- ❌ **首页至今没有推荐区** —— `is_home_recommend` 只在抽屉里当筛选项

所以「首页推荐位」这个能力**没有闭环**，我不认领分数。

但**分类改了**：那 0.20 从 **B（产品口径）改为 E（运营内容）** —— 剩下的不再需要产品拍板，只需要运营在这个新入口里挑几张卡。

> 顺带修正一个之前的判断：这项其实**不是 B 类**。B 的定义是「产品一句话就能做」，而这项在补之前**即使产品说了也做不了**（没有写入口）。它本该是 **I 类（内部可做、只是没排期）** —— 而台账一直声称「I 类 = 0」。这说明那句「代码侧已无不需要外部输入的项」是**过于乐观**的。

### 八、诚实边界

1. **首页仍无推荐区**，能力未闭环，这是不认领分数的直接原因。
2. **「只允许平台卡」是我方判断**：运营不给团队自建卡背书（既越权又不可控质量）。竞品侧无对应证据 —— 竞品可能允许运营推任何卡。
3. **不做「推荐位人工排序」**：现在按 `is_home_recommend desc, use_count desc` 排。真要做人工排序应加独立列，而不是复用 `use_count`（那是真实使用量，当权重会失真）。
4. **`is_home_recommend` 的默认值仍是 `false`**：33 张卡出厂都不推荐，需要运营显式挑。这是刻意的（不替运营做决定），但也意味着**上线后首页推荐位是空的**，直到有人填。


## 变更登记（v6.55 · 第 101 批：用更严格方法复核第 99 批的 4 个方向 —— 全部仍成立，并补上一条缺守卫的隐式约定 · 2026-10-29）

### 一、为什么重做第 99 批

第 100 批证明我的静态检索会把**注释里的字符串**当代码（`insert(spaceMembers)` 误报 6→4 处、
`\{\s*code:` 漏读一条声明）。

既然方法本身有偏差，第 99 批那句「5 个方向全干净」就只能算**「没查到」，不能算「已证明」**。所以这批重做：

- 扫描前**先剥注释**（块注释 + 行注释，保留行号）；
- 要求**真实调用形态**（`xxx.method(` 而非裸标识符）。

### 二、复核结果：4 个方向全部仍成立

| 方向 | 严格复核的覆盖 | 结论 |
| --- | --- | --- |
| 算价 vs 冻结/结算 | `freezeCredits` **5 处**真实调用、`settleCredits` **2 处** | ✅ 成立 |
| 席位校验 | 真实 `insert(spaceMembers)` **4 处**（第 99 批粗正则误报 6 处） | ✅ 成立 |
| share token 范围 | `publicShare` 的 where 同时限定 `taskId` **和** `spaceId` | ✅ 成立 |
| i18n | 3094 引用 key vs 3217 定义 key，缺失 0 | ✅ 成立 |

### 三、深挖方向 2 时发现的真隐患

`settleCredits` 只有**两个调用点**，代表两条**互斥**的结算路径：

| 路径 | 触发 | 结算金额来自 |
| --- | --- | --- |
| worker `executor.ts` | 消费队列 | `tasks.creditsFrozen`（冻结快照，不重算） |
| `ad-drama.service.ts` | API 进程内**同步**跑完 | 同一次请求内的 `priced.credits` |

**它们为什么不会重复结算？** 靠一个**隐式约定**：

- ad-drama 建任务时 status = `RUNNING(2)`，且**从不入队**；
- 走队列的链路 status = `PENDING(1)` + `enqueueTask(...)`。

**这个约定此前没有任何断言。**

风险很具体：如果哪天有人把 ad-drama 改成 `PENDING`（看起来更"标准"），或者给它加一句 `enqueueTask`，
同一笔冻结就会被结算两次 —— 表现为 `settleCredits` 的 `frozen balance underflow`，或者账目对不上。
而这类问题**在单测里很难自然暴露**（要 worker 与 API 同时跑同一批任务）。

### 四、补的守卫：`settle-paths.spec.ts`（4 例）

| 用例 | 断言 |
| --- | --- |
| ad-drama 必须是 RUNNING | `status: TASK_STATUS.RUNNING`、**不出现** `PENDING`、自己调 `settleCredits`、**绝不** `enqueueTask` |
| 队列链路必须 PENDING + 入队 | `generations` / `script` 分镜批量两条抽样 |
| worker 不扫表取任务 | executor 里不出现 `eq(tasks.status, PENDING)` 的拾取语义 |
| 结算调用点恰好两个文件 | 新增第三条路径必须重新论证互斥性 |

### 五、写这例时踩的两个坑（都修了）

1. **`generations.service.ts` 的 status 写的是字面量 `1`**，不是 `TaskStatus.PENDING` 枚举。
   断言只认枚举会把「写法差异」误判成「约定被破坏」→ 改成两种都认。
2. **守卫自身也必须先剥注释再匹配**，否则我在 ad-drama 里加的说明文字会把 `not.toMatch(/enqueueTask/)` 撞红。

### 六、验证与数字

| 项 | 数字 |
| --- | --- |
| api 测试 | 1009 → **1013**（总 1,425） |
| 门禁 | **12/12 全绿** |
| 反向验证 | ad-drama 改成 `PENDING` → **1 红**，restore 后 4 绿 |
| 端点 | 778 不变 |
| 分数 | **202.67 / 剩余 3.33 不变** |

### 七、诚实边界

1. **这条守卫守的是「源码形态」**（status 取值 + 是否入队），**不是运行时行为**。
   真要证明「不会双重结算」，得让 worker 与 API 同时跑同一批任务 —— 需要起完整栈，
   成本高且容易 flaky，本批没做。
2. **这批不涨分**：补的是「未来可能踩的坑」的守卫，不是已发生的缺陷。
3. **第 99 批的 4 个方向现在可以说「已证明」了吗？** 比之前可信（方法更严），但仍是**静态读码**。
   准确说法：**「用去注释+真实调用的方法查过，没发现问题」**。
4. **#5 i18n 那条仍是简单匹配**：只比对 key 集合，没验证「翻译内容是否正确」「占位符是否一致」
   —— 后者在 `i18n-check.cjs` 的计划里，但本批没跑。


## 变更登记（v6.54 · 第 100 批：复核第 99 批自己的结论 —— 一处误报 + 一处「后端算了前端从没用」· 2026-10-29）

### 一、先认错

第 99 批我在台账里写「反向还查出 **3 处**调了但未登记」。这批复核发现**是误报**。

错因很具体：`enforced-permissions.ts` 里 `member.create` 那一条**前面有一行注释**：

```ts
{
  // 任务书写的 `team.member` 在权限目录里不存在；`member.create` 才是"新增/邀请成员"的码，
  code: "member.create",
  ...
}
```

我的解析正则 `\{\s*code:` 匹配不到「`{` + 注释 + `code:`」这种形状，于是**少读了一条声明**，
进而把已经登记过的端点误判成「未登记」。

重数后真值：

| 项 | 第 99 批写法 | 实际 |
| --- | --- | --- |
| 声明表条数 | 5 | **6** |
| controller 调用点 | — | **7** |
| 已登记 | 5 | **6** |
| 真未登记 | 「3 处」 | **1 处**（`batch-points-allocation`） |

另外 `/cam/permissions` 不是「未登记」—— 它是**只读目录端点**，本来就不该拦。
台账里那句话已就地更正。

### 二、真发现：`enforced` 后端算好了，前端从来没用

`GET /cam/permissions` 一直返回：

```json
{
  "list": [...], "groups": [...], "total": 70,
  "enforced": [{ "code": "team.edit", "method": "PATCH", "endpoint": "/v1/cam/team/info", "note": "…" }, ...],
  "enforced_count": 6
}
```

但 `TeamPermissionMatrix.vue` 从头到尾只用了 `list` / `groups` / `total` —— **`enforced` 一次没渲染**，
前端 DTO 里也根本没有这两个字段。

**又一个「后端算好了没人用」**，和第 97 批 #23（报价算了折抵、下单按全额）同族。

### 三、连带：页面文案已经过期

该页面顶部写着：

> 说明：本批权限矩阵只负责**目录与角色绑定存储**，**尚未接入接口级拦截**；
> 勾选结果不会立刻改变成员实际可访问的接口。

**这句话早就错了**。`team.edit` / `member.remove` / `member.edit` 等 6 个码真的会 403101
（`team-permissions.spec.ts` 有逐条越权用例：取消勾选 → 403101，加回 → 200）。

笼统免责 + 不标已生效，结果是运营**既不敢用**（不知道哪些真生效）、**又会误判**（以为全部没生效）。

### 四、修了什么

| 位置 | 改动 |
| --- | --- |
| `types/api.ts` | `TeamPermissionCatalogDto` 补 `enforced` / `enforced_count`；`TeamPermissionItemDto` 补 `enforced?` |
| `TeamPermissionMatrix.vue` | 顶部说明改成「N 个码已接入接口级拦截，其余只存不生效」+ 列出已生效码；每个码旁打「已生效」标（`note` 作 tooltip） |
| 测试 | +1 例，只守既有用例**没覆盖**的那面（`note` 非空 + 两种读法全量自洽） |

### 五、一次事故（也记下来）

写测试时我用字符串拼接往文件里插代码，**误删了 296 行**（含 `setupTeamWithMember` 等公共 helper），
一次性导致 10 个用例失败。

处理：`git checkout` 回滚 → 改用**精确唯一锚点**（三段连续文本 + `assert count == 1`）重做，
最终 diff 是 **+36 行 / 0 删除**。

教训与踩坑清单第 3 条同源：**改代码文件用 `edit` 而不是脚本拼接**；脚本只用于文档。

### 六、验证与数字

| 项 | 数字 |
| --- | --- |
| api 测试 | 1008 → **1009**（总 1,421） |
| 门禁 | **12/12 全绿** |
| 反向验证 | `enforced_count` 写死 5 → **2 红**；restore 后 18 绿 |
| 端点 | 778 不变 |
| 分数 | **202.67 / 剩余 3.33 不变** |

### 七、诚实边界

1. **这批不涨分**：修的是「元数据没人用 + 文案过期」，不是能力，也不是会多收钱/越权的缺陷。
2. **`batch-points-allocation` 未登记本批没修**：改声明表要同步「声明 + controller + spec」三处，
   且它**不影响拦截**（照拦），只影响后端自记账完整性。
3. **「前端没消费」是静态检索结论**（`enforced` 在 web 目录出现 0 次、模板里没有），
   **没有跑真浏览器**确认渲染效果。
4. **这批是我自己复核自己**，所以更该说明：「第 99 批有误报」这件事本身就证明，
   前几批那些「全部干净」的结论也应当被同样地质疑一次 —— 下批如果继续，我会优先复核
   第 99 批另外 4 个方向的判定是否也踩了类似的正则/检索陷阱。


## 变更登记（v6.53 · 第 99 批：跨层一致性审计 5 个方向 —— 全部干净，没找到第二个 #23 · 2026-10-29）

### 一、为什么换查法

第 97 批的 #23 是「报价算对了、下单却按全额收钱」—— 这类**跨层不一致**，扫竞品形状永远发现不了：两个层各自都对，只是没接上。

所以这批不查竞品，改对**最容易出事的 5 条链路**做上下游交叉核对，看还有没有同族缺陷。

### 二、5 个方向的结果

| 方向 | 覆盖 | 结论 |
| --- | --- | --- |
| **权限**：声明已拦截 vs 真调 `requirePermission` | `enforced-permissions.ts` 6 条声明，逐条对 controller 方法体 | ✅ **5 条路由全部真拦截、码一致，无假声明** |
| **金额**：算价 vs 冻结/结算 | generations / 分镜批量 / ad-drama / tasks 四条生成链 | ✅ 全部 `creditsFrozen: priced.credits` 与 `freezeCredits(cost: priced.credits)` **同源** |
| **席位**：`max_seats` 校验 vs 实际写入 | 精确匹配到 4 处 `insert(spaceMembers)` | ✅ team 两处有校验；auth 两处是个人空间自插入，不占额外席位 |
| **越权**：share token 范围 vs 产物读取 | `GET /share/:token`、`/stream`、`POST /batch-download` | ✅ `publicShare` 同时限定 `taskId` **和** `spaceId`；batch-download 不接受 `task_ids` |
| **i18n**：页面引用 key vs 语言包 | 3094 个引用 key × 3217 个定义 key × 5 语言 | ✅ **缺失 0**，5 个包 key 集完全一致 |

### 三、两个过程中的修正（值得记）

1. **粗正则误报**：第一次用 `insert(spaceMembers)` 搜到 6 处，其中 2 处是**注释里提到这个字符串**（我在第 95 批写的注释里就有「两处 `insert(spaceMembers)` 都不带它」）。改成精确匹配 `(tx|db).insert(spaceMembers)` 且跳过注释行后，真实写入只有 **4 处**。
2. **`/cam/permissions` 的反向命中是误报**：它方法体里含 `requirePermission` 字样（注释在讲"真正判权在 TeamService.requirePermission"），但它是只读目录端点，不需要拦截。

### 四、结论对目标意味着什么

**这批没有找到第二个 #23。** 这个"没找到"是有价值的：

- 那 5 条最容易出问题的链路**已经查过且干净**，下一批不必重做；
- 结合前几批的结论：B 类 0.88 已逐条核过是真产品口径、E 类 2.45 是真外部输入 —— **98.81% 的天花板是真实的，不是"还有活没干"**。

### 五、验证与数字

| 项 | 数字 |
| --- | --- |
| 代码 | **不改**（纯审计） |
| 端点 / 用例 | 778 / 1,420 均不变 |
| 分数 | **202.67/206、剩余 3.33 均不变** |
| 门禁 | 12/12 全绿 |

### 六、诚实边界

1. **只查了这 5 个方向，不能证明全站没有第三处跨层缺陷。** 「没找到」只等于「这 5 条链路干净」。
2. **全部是静态读码**，没有跑真实时序场景（例如「下单后改价目表、再结算」这种跨时间的漂移）。要验那类要造真实流水，成本高且易 flaky。
3. **权限的反向发现（3 处调了未登记）本批没修** —— 它只影响 `GET /cam/permissions` 的 `enforced` 标记（前端矩阵少了「生效中」标签），不影响真实拦截，属展示层小瑕疵。已登记在台账。

**下一步**：如果目标是「继续涨分」，B 类 0.88 与 E 类 2.45 都已核到尽头，涨分空间只剩**发现新缺陷**这种不确定收益；如果目标是「诚实收口」，现在已经有足够证据宣布：**98.81% 是真实天花板，剩余全部有具名阻塞项**。


## 变更登记（v6.52 · 第 98 批：#17 的 0.08 是纯记账过期 —— 两项声称的缺口都已实现且有测试 · 2026-10-29）

### 一、承接上一批留下的那一笔

第 97 批核 #23 时顺带发现 `#17 prompt_inject_mode=replace` 也已实现，但当时刻意**没改它的分**，留给这批。现在把 #17 那 0.08 的**两个**声称都核一遍。

### 二、第一项 `prompt_inject_mode=replace`：三项齐全

| 环节 | 证据 |
| --- | --- |
| 实现 | `script.service.ts:2286` — `injectMode === "replace"` 时把 `prompt_with_images` 当 prompt |
| 接收 | `script.controller.ts:88` — `z.enum(["append","replace"])` |
| 测试 | `asset-match.spec.ts:544` — append 不改写 / replace 生效 / 非法值 400101 |

### 三、第二项 `prompt_blocked`：差点被 TSV 误导

我一开始按 `competitor_endpoints.tsv` 搜，**出现 0 次**，差点判成「竞品没有这个字段、我方不需要做」。

但它的证据是**字段级**的 —— 竞品抓包分析写在 `_storyboard-asset-match.md:9`，**不在端点表里**。

而代码侧早就落地了：

| 环节 | 证据 |
| --- | --- |
| DTO | `asset-match.service.ts:118` — `prompt_blocked: boolean` |
| 判据 | `:453` — 「`prompt_blocked` 不为真 = `prompt_status !== 3`（内容安全拦截）」 |
| 输出 | `:722` — 随条目返回 |
| 测试 | `asset-match.spec.ts:341` — `expect(blockedEntry?.prompt_blocked).toBe(true)` |

**这条如果只看 TSV 会误判。** 这是本批最重要的教训：

> **「端点表里没有」≠「竞品没有这个字段」。** 字段级证据的另一半在产品文档（`_storyboard-asset-match.md`、`d-pipeline.md` 等）里，端点表只覆盖 METHOD + path + query。

### 四、顺带改清 §5.4 第 2 条的措辞

原文担心「`replace` 覆盖整段会让风格前缀失效，与页面文案矛盾」。

核实后：**不会**。风格前缀由 `injectImagesWithTemplates` 在标记文本**末尾追加**（`asset-gates.service.ts:234-236`，还带去重判断），与 `replace` 互不干扰。所以那条「确认项」从一开始就不成立。

### 五、其余 B 类逐条核过：确认真 B，不硬做

| 条目 | 权重 | 核账结论 |
| --- | ---: | --- |
| #12 二次改编许可 | 0.20 | schema 无 `license_scope` 列；属**法律/商务语义**，工程不能单方面定 |
| #7 子账号密码 | 0.10 | `team.service.ts:1944` 明写无子账号密码；**做了即死代码** |
| #22 账号合并 | 0.02 | `mergeSettings` 是**设置**合并不是账号合并 |
| #24 `result/folder` | 0.01 | 无 `task_folders` 表 |
| #11 四条小能力 | 0.10 | clip/crop/group-recover 均无表 |
| #5 FILM 档合流 | 0.09 | 产品口径 |

这些确实是「要一句话」或「要外部输入」，不是漏做。

### 六、验证与数字

| 项 | 数字 |
| --- | --- |
| 代码 | **本批不改代码**（纯改账；端点 778 不变、用例 1,420 不变） |
| **分数** | **#17 99% → 100%**（7.92 → 8.00）⇒ 全站 **202.59 → 202.67**、剩余 **3.41 → 3.33** |
| 核心 / 首发 | 107.70 → **107.78** / 130.60 → **130.68** |
| B / E | B 0.96 → **0.88**；E 2.45 不变 |

### 七、诚实边界

1. **本批涨分全部来自改账，不是写代码。** 这类涨分有明确上限 —— 它只是把「已经做过的」补记回来，不会再产生新能力。真正值得继续挖的是**「会多收钱 / 会静默丢参数」**这类缺陷（如第 97 批的 #23）。
2. **99% 仍不可达**，且这次改账后天花板**没变**：B 全清 = 203.550/206 = **98.81%**，而 99% 要 203.94。改账只是把 3.41 的构成换成 3.33，天花板仍是 98.81%。
3. **`prompt_blocked` 的「已实现」是我按代码 + 测试判定的**，没有跑竞品的真实响应做字段对齐（竞品侧无该端点的响应体证据，只有字段名与语义说明）。
4. **#17 现在记 100%，但它的「模板渲染为自建口径」仍在** —— 竞品无该部分证据，按第 67 批口径不算缺口（自建不等于缺）。这一句留在模块行里，没有删。


## 变更登记（v6.51 · 第 97 批：B 类核账 —— 查出 #23「待确认」是过期措辞，真缺陷是「报价算折抵、下单按全额」· 2026-10-29）

### 一、为什么换方向

第 94–96 批（#12 → #7 → #2）累计补了 **17 个 query 参数，分数一分没涨**。继续扫形状的边际收益已经归零，所以这批回头验一件更根本的事：

**B 类 0.975 是不是被我们自己的保守口径高估了 —— 里面有多少其实是「该做的工程缺口」，被记成了「等产品一句话」？**

### 二、先算算术：99% 不可达

| 口径 | 数值 |
| --- | ---: |
| 当前 | 202.58 / 206 = **98.34%** |
| 99% 门槛 | 203.94 分（缺 1.36） |
| B 类全清 | 203.555 / 206 = **98.81%** |
| E 类（外部输入） | 2.45 |

**即使把 B 类 0.975 全部做完，上限也只有 98.81%** —— 「≥99%」在当前权重口径下**不可达**。目标函数本身需要修正，这条必须先说清，否则后面每批都在追一个不存在的数。

### 三、判据换成「代码已实现? + 有测试?」

用这条判据逐条核 B 类，查出**两处台账过期**：

| 条目 | 台账原话 | 实际 |
| --- | --- | --- |
| #23 升级补差价 proration | §5.4 第 1 条「确认后我会做」 | **早已实现**：`billing.service.ts:395-409` 按天折算 + 7 例测试 |
| #17 `prompt_inject_mode=replace` | §5.4 第 2 条「确认后我会做」 | **早已实现**：`script.service.ts:2286` + `asset-match.spec.ts:544` |

两条都写在「待确认」栏里，实际代码早就做完了。

### 四、深化核 #23 时找到真缺陷

核到 `createOrder()` 时发现：

```ts
amountCents: sku.priceCents,   // 全额
```

**它完全不读 `quoteUpgrade()` 已经算好的 `payable_cents`。** 于是：

- `GET /billing/upgrade-quote` 老实算出「补 ¥160」→ 前端照报价显示；
- `POST /billing/orders` 按 ¥199 全额下单 → **用户实付 ¥199**。

报价与下单两套算法并存。这**不是**「口径待确认」—— 按天折算的口径已由报价侧定死，**是纯工程缺口**。

### 五、顺带修掉的连带缺陷

修复时把 `amountCents` 提到「复用/新建」分支之前，暴露出第二个 bug：

**60 秒内的未支付订单会被复用（防双击），而它带着下单时刻的价格。** 如果这一分钟里订阅状态变了（到期 / 刚买过月卡），旧单会**以过期价格被支付**。

修法：金额不一致 → **关闭旧单、按新价重开**。不改旧单价格，因为真实渠道那边已按旧金额创建过支付单，改价会让渠道侧与本地不一致。

### 六、验证与数字

| 项 | 数字 |
| --- | --- |
| 测试 | `billing-upgrade-quote.spec.ts` 6 → **9 例**（新增：下单折抵生效 / 无订阅不折抵 / 同档续费不折抵） |
| 反向验证 | 折抵改回全额 → **1 红，报错正是 19900 vs 16000**；restore 后 9 绿 |
| 门禁 | **12/12 全绿** |
| api 用例 | 1005 → **1008**；总 1,417 → **1,420** |
| **分数** | **#23 99.5% → 100%**（2.99 → 3.00）⇒ 全站 **202.58 → 202.59**、剩余 **3.42 → 3.41** |

**这是第 94 批以来第一次真正涨分**，因为这次补的不是形状，是一处会**多收用户钱**的缺陷。

### 七、诚实边界

1. **`#17 prompt_inject_mode=replace` 已核实是台账过期，但本批不改它的分** —— 留到下一批与 §5.4 第 2 条一起改，避免一批里改两处口径说不清。这是刻意的节奏控制，不是遗漏。
2. **B 类余下 0.96 里，#12（0.20）与 #7（0.10）已确证是「无 `license_scope` 列」「无子账号体系」** —— 属**设计选择**，不是漏做。这两项确认过、不再重查。
3. **99% 不可达这个结论是算术事实，不是悲观判断**：`202.58 + 0.975 = 203.555 < 203.94`。除非权重口径或 E 类判定变化，否则追不到。
4. **折抵不另存快照列**：`orders.amount_cents` 已记实付额，`sku.price_cents` 是可查标价，「为什么少收」= 两者之差，口径由 `quoteUpgrade()` 一元定义。若将来要审计留痕，应加 `orders.credit_applied_cents` 列而不是 jsonb 影子数据。
5. **真实渠道未联调**：本批只验证了 mock 渠道的金额正确性；真实渠道 `createPayment` 收到的金额同样是 `amountCents`（代码同一处），但没有渠道测试号可跑。


## 变更登记（v6.50 · 第 96 批：先修扫描器的假盲区，再落 #2 小说字段级 —— 唯一真缺口是章节闭区间 · 2026-10-29）

### 一、这批先修了上一批的一个工具 bug

第 95 批结尾写了「另有 **98 条未映射**、字段级完全没查」。这批要处理这块盲区，第一步是**复核扫描器本身** —— 结果发现问题：

`_r95_scan.py` 的 `PAIR_RE` 只匹配**双引号**数组：

```python
r'\[\s*"((?:GET|...)\s+/[^"]+)"\s*,\s*"((?:GET|...)\s+/[^"]+)"\s*,'
```

而守卫里的 `PAIRS` 有**两种写法**：第 84 批起用双引号，**第 90 批起用单引号**。于是那 90 条登记全部失效，被当成「未映射」。

修好后：

| 指标 | 修前 | 修后 |
| --- | ---: | ---: |
| 守卫 PAIRS 识别数 | 223 | **395** |
| 映射成功 | 55 | **76** |
| 静默丢弃 | 28 | **47** |
| 盲区 | 98 | **77** |

**这个 bug 不改代码行为，但它让「还剩多少没查」这个数字一直是错的** —— 而那个数字正是后续每批的选题依据。

### 二、选题：#2 小说改编链（0.24）

盲区里按剩余权重取最大的未完成模块。102 条 `/df/novel/*` 里只有 **5 条**带 QUERY（字段级证据本来就薄），逐条核完：

| 竞品端点 | QUERY | 结论 |
| --- | --- | --- |
| `novel/{}/download` | `only_episodes` | ✅ 第 90 批已接（本批复验行为） |
| `novel/{}/novel_chapters/list` | `start_chat_num`、`end_chat_num` | ❌ **被静默丢弃 → 本批补** |
| `novel/{}/point` | `step`、`episode_count`、`chapter_start/end`、`is_retry` | 映射到我方 `POST /credits/quote` —— **body 传参不是 query**，属映射口径 |
| `novel/distribute/list` | `script_name`、`page`、`page_size` | 我方没有分发列表资源（B 类豁免） |
| `script_edit_agent/sessions/{}` | `id` | id 已在路径里，query 冗余 |

所以 #2 的字段级只有 **1 处**真缺口。

### 三、补法里的三个判断

1. **`start > end` → `400101`**，不静默返回空列表 —— 空列表会让调用方以为「这本书没章节」，比报错更难查。
2. **`total` 用筛选后的条数**：全书 200 章、只查 10-20 章时，`total` 必须是区间内条数，否则「共 200 章」与列出的 0 条自相矛盾。
3. **响应新增 `range: {start, end}` 回显**：客户端能确认筛选**真被接住了**，而不是被静默丢弃后又猜一遍。

同时保留竞品原名 `start_chat_num`（历史拼写不是 `chapter`），另收我方别名 `start_chapter_no` —— 照竞品写的调用方只会用前一个。

### 四、反向验证踩到一次假绿（值得记下来）

第一次跑 `_r96_break.py break` 时：

```
❯ test/novel-query-parity.spec.ts (1 failed)
❯ test/competitor-route-parity.spec.ts      ← 守卫没红！
```

原因是守卫写的是 `expect(novelSchemas).toContain("start_chat_num")`，而改名后是 `start_chat_num_BROKEN` —— **子串仍然匹配**。

改成带冒号的正则：

```ts
expect(novelSchemas).toMatch(/^\s*start_chat_num\s*:\s*z\./m);
```

再跑才变红。「改名测试」正是最容易撞上子串匹配的场合，所以这条教训写进了注释。

### 五、验证与数字

| 项 | 数字 |
| --- | --- |
| api 测试 | **92 文件 1005 例全绿**（原 1002：+2 `novel-query-parity.spec.ts`、+1 守卫） |
| 总用例 | **1,417**（api 1005 + adapters 164 + cli 128 + worker 61 + db 27 + shared 26 + storage 6） |
| 端点 | **778 不变** |
| 表 / 迁移 | 113 / 47 不变 |
| 门禁 | `verify-round.ps1` **12/12 全绿** |
| 竞品覆盖守卫 | 十九组 685 条 / **25 例**（原 24） |
| 分数 | **202.58/206 = 98.3%**，剩余 **3.42**；**#2 仍 97%** |

**为什么不加分**：#2 的 0.24 = B 0.16（买断/协作 12 条无模型端点）+ E 0.08（结局分支字段取证）。5 个 query 参数里没有一条能让它们变成代码活。

### 六、诚实边界

1. **`point` 那条「body 不是 query」是读我方实现得出的**（`POST /credits/quote` 收 body）。竞品到底把 `step` 放 query 还是 body，**没有请求体证据** —— 如果它其实也用 body，那我方本来就对；如果两边用法不同，这条要重新判。
2. **扫描器依然只比 query**，body 一律未验。
3. **剩下 47 条静默丢弃仍未处理**，其中 df 19 条（episode/storyboard/canvas 族）最多。
4. **`start_chat_num` 这个名字保留了竞品的拼写错误**（`chat` 而非 `chapter`）。改漂亮会让照竞品写的客户端接不上；所以只加别名、不改名。
5. 区间语义是**闭区间**（含首尾）。竞品是否闭区间无证据 —— 我按「章节 1..N 的自然读法」定，并在 `range` 里回显让调用方自证。


## 变更登记（v6.49 · 第 95 批：把「query 字段级对账」做成全站扫描器，先落 #7 团队 —— 50 个竞品参数接上 12 个 · 2026-10-28）

### 一、这批在回答什么问题

第 94 批在 #12 上发现一类守卫**看不见**的缺口：端点全在、方法全对，但 query 参数被 zod 静默 strip —— 请求返回 **200 + code 0 + 未过滤全集**，客户端以为筛选生效了。

一个问题随之而来：**这是 #12 的个案，还是全站现象？**

与其一个模块一个模块手动查，这批先把方法**通用化**，然后只落一个模块（#7 团队，因为它凑巧是参数最多、且模型全都支持的那一块）。

### 二、扫描器怎么做的（`_r95_scan.py`）

| 步骤 | 做法 |
| --- | --- |
| 1. 取有证据的行 | TSV 的 `QUERY` 列非空 → 904 条里有 **153 条**带参数 |
| 2. 映射到我方路由 | 复用守卫已登记的 **223 条 `PAIRS`**（竞品形状 → 我方形状），没登记的走「剥 `/web/v1` 后同形」直配 |
| 3. 抽我方实际接受的键 | 从 controller 源码取 `z.object({…})` 顶层键 + `@Query("x")` + 顶层 schema 常量（`pageQuery`/`listScriptsQuery` 等 169 个） |
| 4. 差集 | 竞品有、我方没接 ⇒ **静默丢弃** |

**结果：全站 28 条静默丢弃**，分布是 cam 5 / op 6 / kds 4 / df 3 / v1 3 / asset 2 / crc 2 / ai 1 / callback 1 / trade-order 1。

这批只落 **#7 团队**（一个模块一批），其余 23 条登记给后续批次。

### 三、#7 团队：50 个参数，26 → 38

竞品 `/web/v1/cam/*` 有 9 条端点带 QUERY、合计 **50 个参数**。我方此前只接 **26 个**。

| 端点 | 竞品参数 | 此前接 | 现在接 |
| --- | ---: | ---: | ---: |
| `team/points-flow/list` | 10 | 6 | **8** |
| `team/points-flow/export` | 8 | 4 | **6** |
| `project-points-flow/list` | 5 | 4 | 4 |
| `project-points-flow/export` | 5 | 2 | **4** |
| `team/:id/members` | 11 | 5 | **9** |
| `team/:id/member/export` | 9 | 5 | **7** |
| `role/list`、`team/:id/groups` | 2 | 0 | 0（结构性偏离） |
| **合计** | **50** | **26（52%）** | **38（76%）** |

补的 12 个：

- **时间范围** `create_time_start/end` → `gte/lte(credit_flows.created_at)`（原来只能拉全量再自己筛）
- **`op_type`** → 它就是 `credit_flows.kind` 的**第二个名字**；两个都给且冲突时 `400101`，不静默取其一
- **人名** `op_user_name`（join `users.nickname`）、`target_user_name`（join `space_members.nickname` 快照 —— 两者是不同来源，测试里专门造了「users 昵称 ≠ 成员快照昵称」来钉住）
- **成员** `nick` / `remark` / `role_ids` / `has_group`
- **`include_descendants`** → BFS 展开分组子树，10 层上限防环
- **`page`/`page_size`**（项目流水导出）

### 四、顺带修好一个更坏的缺陷

**成员导出此前写死了 `listMembers(spaceId, 1, 100)`** —— 既忽略竞品那 11 个参数，又硬截 100 行。

后果：运营「筛出这批人 → 点导出」拿到的是**和屏幕上不一样的文件**（要么超 100 人被截，要么筛选根本没生效）。现在导出与列表走同一组筛选、上限 5000 行，并由测试断言「列表 total=1 ⇒ CSV 恰好 1 行数据 + 表头」。

### 五、明确不接的 12 个参数（每条都有理由）

| 参数 | 处数 | 为什么不接 |
| --- | ---: | --- |
| `op_user_account` / `target_user_account` / `account` | 6 | **`space_members.account` 是一列从未被写入的死列** —— 两处 `insert(spaceMembers)` 都不带它；且手机号只存 `phone_hash`(HMAC) + `phone_cipher`(AES-GCM)，**无法模糊检索** |
| `sp_ids` | 2 | 要 join `team_member_projects` 再聚合，属跨表新口径 |
| `team_id` | 1 | 我方一人一团队，team 从 token 取（第 92 批已登记的结构性偏离） |
| `view` | 1 | `groups?view=` 在我方只有一种视图 |

接一个恒空的账号搜索，比不接更坏 —— 这条判据与第 94 批 #12 的 `parent_id` 完全一致。

### 六、守卫与反向验证

守卫生成 23 → **24 例**：「#7 的 50 个竞品 query 参数 = 38 已接 + 12 有意不接」，断言三件事：

1. 每个 handler 真的 `@Query("x")` 到那些键（**逐 handler 切片断言**，不是全文 grep）；
2. service 层把参数落成真 SQL（`ilike(users.nickname`、`gte(creditFlows.createdAt`…）；
3. 死列**不许**被接 —— `expect(teamSvc).not.toMatch(/insert\(spaceMembers\)\.values\(\{[^}]*account:/)`。

反向验证 `_r95_break.py break|restore` 把 `op_user_name` 改名：

```
BROKEN: points-flow/list 的 op_user_name 已改名为 op_user_name_BROKEN
 ❯ test/competitor-route-parity.spec.ts (24 tests | 1 failed)
 ❯ test/team-query-parity.spec.ts (5 tests | 1 failed)
 Tests  2 failed | 27 passed (29)
```

恢复后 **29 passed**。两个红来自不同文件（守卫 + 功能各一）。

### 七、验证与数字

| 项 | 数字 |
| --- | --- |
| api 测试 | **90 文件 1002 例全绿**（原 996：+5 `team-query-parity.spec.ts`、+1 守卫） |
| 总用例 | **1,414**（api 1002 + adapters 164 + cli 128 + worker 61 + db 27 + shared 26 + storage 6） |
| 端点 | **778 不变** —— 改的是参数，不是路由 |
| 表 / 迁移 | 113 / 47 不变（用到的列全都已存在） |
| 门禁 | `verify-round.ps1` **12/12 全绿**（`结论：全绿`） |
| 竞品覆盖守卫 | 十九组 685 条 / **24 例**（原 23） |
| 分数 | **202.58/206 = 98.3%**，剩余 **3.42**；**#7 仍 99.5%** |

**为什么这批不加分**：#7 的 0.10 一直是「子账号密码 2 条端点未实现」，而我方团队是**手机号邀请的真实用户**，没有子账号体系 —— 只存哈希而无登录路径就是死代码。50 个 query 参数里没有任何一条能让这 0.10 变成代码活。

### 八、诚实边界

1. **扫描器只覆盖了 55 条映射成功的**，另有 **98 条未映射**（`/df/*` 前缀族为主，因为它们的等价物没登记在 `PAIRS` 里）。那部分字段级**完全没查** —— 所以「全站只有 28 条」这个数字只对映射成功的那 55 条成立。
2. **只比 query，body 一律未验**。`POST` 系列（`batch-points-allocation`、`member/batch/status` 等）的请求体没有任何竞品证据。
3. **`account` 是死列这个结论是读代码得出的**（两处 `insert(spaceMembers)` 都不带它），不是运行时验证；如果将来邀请流程开始写这一列，这条豁免要立刻改成「可做」并补实现。
4. **`include_descendants` 的 10 层上限是我方口径**。竞品是否限制层级、超深树怎么处理，无证据。
5. **`op_type` 与 `kind` 的冲突策略（400101）是我方定的**。竞品只有一个名字，不存在冲突场景；我选择显式报错而不是静默取其一，理由是静默会让调用方以为筛的是另一个类型。
6. **导出分页（`page/page_size`）语义是我方定的**：对筛选后的集合开窗，不传 = 全量（仍受 5000 上限）。

**下一步**：剩下 23 条静默丢弃里，`op` 6 条与 `kds` 4 条最多，且都在非满分模块周边；但**是否值得补要看模型支不支持**（本批证明：模型不支持时正确做法是登记，不是硬接）。


## 变更登记（v6.48 · 第 94 批：审计 #12 剧本广场 —— 29 条路由一条不缺，但 4 处 query 参数被静默丢弃 · 2026-10-28）

### 一、这批在回答什么问题

#12 剧本广场是全站两个 92% 模块之一（权重 8、剩余 0.64），也是**台账可信度最低的一块**：第 84 批已经查出它那句「竞品 29+12 全覆盖」是重复记账（管理侧 18 行其实归 #27）。它的缺口栏从那以后只写两句话 —— 「真实打款（商户资质）」与「买断后二次改编许可范围」——**两句都没被竞品全集验过**。

所以这批做两件事：先验那两句话，再换一层验 **路由栏看不见的东西**。

### 二、竞品面：57 行切成 29 + 18 + 10

`_r94_slice.py` 从 TSV 切出含 `novel_market` 的 47 行，`_r94_audit.py` 按前缀拆开：

| 归属 | 条数 | 前缀 | 本批是否处理 |
| --- | ---: | --- | --- |
| **#12 消费侧** | **29** | `/web/v1/df/novel_market/*` | 逐条对 |
| #27 运营后台 | 18 | `/v1/rmadminsrv/novel_market/*` | 第 83 批已对过，只做归属确认（管理侧另有 3 处 query 缺口，见第五节，**代码已修但归 #27 记账**） |

**路由层结论：29/29 全部 PAIR，0 缺口。** 归一化只剥 `/web/v1`、不剥 `/df`（剥了会把前缀差异抹平成假同形），所以这 29 条全部走 `DEVIATIONS` 登记 —— 方法全一致、尾段一一对应，另多 5 条自建能力（`buy`、`parse`、`creator/withdraw`、`creator/withdrawals`、`withdrawals/{}/cancel`）。

也就是说：#12 的 0.64 **不是缺端点**，第 84 批的结论在全集复核下依然成立。

### 三、换一层：端点收了参数，但静默丢掉

路由全在，不代表能力在。TSV 有 `QUERY` 列，29 条里只有 **4 条**带 query；`_r94_query_all.py` 把每个参数对我方 zod schema：

| 竞品端点 | 竞品 query | 我方 schema | 结果 |
| --- | --- | --- | --- |
| `GET /scripts` | `tag_ids/category_id/keyword/page/page_size` | 全有 | ✅ |
| `GET /scripts/{nm_id}/episodes` | `start_episode_no/end_episode_no` | 全有 | ✅ |
| `GET /creator/works` | `status/**keyword**/page/page_size` | **缺 `keyword`** | ❌ |
| `GET /creator/revenues` | `status/page/page_size` | 全有 | ✅ |

**为什么「缺一个参数」比「400」更坏**：zod 默认 `strip` 未知键，所以带 `keyword` 的请求不会报错，而是返回 **200 + code 0 + 未过滤的全集**。实测（临时 spec，验证完即删）：

```
GET /v1/market/creator/works?keyword=Alpha   →  200, code 0, titles = ["BetaScript","AlphaScript"]
```

客户端以为搜过了。这类故障，**守卫（只比 METHOD + path）看不见，端点存在性检查也看不见** —— 它是"字段级"的。

管理侧连带查出 3 处同类问题（引号内为实测后果）：

| 端点 | 被丢弃的参数 | 后果 |
| --- | --- | --- |
| `GET /ops/market/categories` | `keyword` | 运营搜分类，拿到全量 |
| `GET /ops/market/tags` | `keyword` | 同上 |
| `GET /ops/market/promotions` | `enabled` | 勾了"只看启用的"，仍拿到含停用的全量 |
| `GET /ops/market/promotions` | `slot` **缺省时硬编码 `?? "market"`** | 运营根本查不到别的位（如 `home`） |

### 四、补了什么，以及**有意不补**什么

补齐的 4 处都在 service 层落成真 SQL，不是只在 schema 里挂个名字：

| 位置 | 改动 | 落点 |
| --- | --- | --- |
| `creator/works` | 补 `keyword` | 标题 + 简介 `ilike`（与集市列表 `listScripts` 同口径 —— 创作者"记得一句话、不记得标题"时也能搜到） |
| `adminCategories` | 补 `keyword` + 返回 `total` | 名字模糊 |
| `adminTags` | 补 `keyword` + 返回 `total` | 名字模糊 |
| `adminPromotions` | 补 `enabled`，去掉隐式 `slot="market"` | `promo_slots.status` 过滤；不指定 slot = 全部位 |

**明确不补的两处**（接了恒空过滤器比不接更坏，两条都写进注释并由守卫钉住）：

1. **`categories` 的 `parent_id`**：`market_categories` 是平表，没有该列。竞品是树形分类，我方不是。造一个恒空的 `parent_id` 只会让客户端以为能筛层级。
2. **`tags` 的 `status`**：`market_tags` 只有 `name` 一列（`schema.ts:3367-3375`），`listTags()` 返回的 `status: 1` 是**常量投影**。接 `?status=2` 会恒空。要做就得先加列 + 迁移 + 决定"停用标签是否还参与作品筛选"，那是产品口径。

前端同时接线：「我的作品」此前一次性拉 `page_size=50` 全量、**没有任何筛选入口** —— 光有后端参数等于能力不可达（第 65/66 批踩过的坑）。补搜索框 + 状态下拉 + 重置 + 「显示 N / 共 M」截断提示，14 个新 key × 5 语种。

### 五、守卫与反向验证

守卫新增一例：**「#12 竞品 4 条带 query 的端点，参数必须被 schema 真接住（防静默丢弃）」**，纯读源码断言 + 行为侧由 `market.spec.ts` 兜底，两边都缺才会漏。

写这一例时踩了个坑并修掉：`market.controller.ts` 里 `listScriptsQuery` **也有一个 `keyword`**（集市列表那条一直是对的），全局正则会撞上它而**假绿**。所以断言必须**限定在 `@Get("creator/works")` 到 `@Post("creator/works")` 之间**：

```ts
const worksHandler = marketCtrl.slice(
  marketCtrl.indexOf('@Get("creator/works")'),
  marketCtrl.indexOf('@Post("creator/works")'),
);
expect(worksHandler).toMatch(/keyword:\s*z\.string\(\)/);
```

反向验证 `_r94_break.py break|restore` 把 `keyword` 改名成 `keyword_BROKEN`：

```
BROKEN: creator/works 的 keyword 已改名为 keyword_BROKEN
 ❯ test/competitor-route-parity.spec.ts (23 tests | 1 failed)
 ❯ test/market.spec.ts (21 tests | 1 failed)
 Tests  2 failed | 42 passed (44)
```

恢复后 **44 passed**。**2 红来自两个不同文件**，说明守卫测的是真东西、功能测试也测的是真东西。

### 六、验证与数字

| 项 | 数字 |
| --- | --- |
| api 测试 | **89 文件 996 例全绿**（原 993：+2 `market.spec.ts`、+1 守卫） |
| 总用例 | **1,408**（api 996 + adapters 164 + cli 128 + worker 61 + db 27 + shared 26 + storage 6） |
| 端点 | **778 不变** —— 本批改的是**参数**，不是路由 |
| 表 / 迁移 | 113 / 47 不变（没有新建表：命中的列全都已存在） |
| 门禁 | `verify-round.ps1` **12/12 全绿**（`结论：全绿`） |
| 竞品覆盖守卫 | 十九组 **685 条 / 23 例**（原 22 例，+1 字段级用例） |
| 分数 | **202.58/206 = 98.3%**，剩余 **3.42**；**#12 仍 92%** |

**为什么这批不加分**：#12 的 0.64 = 0.44（E 类，真实打款需商户资质与分账签约）+ 0.20（B 类，买断后二次改编许可范围）。29 条路由、4 个 query 参数里**没有任何一条能证明这两项缺的是代码** —— 补形状解决不了取证与资质问题。这批的产出是"把 92% 背后的字段事实钉住"，不是分数。

### 七、诚实边界

1. **27 条不带 query 的端点没有字段级证据**。TSV 的 `QUERY` 是空数组，这只说明**抓取时没记到参数**，不代表竞品真没有参数。所以"字段级已对齐"这句话的准确范围是：**4 条有证据的端点已对齐，其余 25 条无从比较**。
2. **只比 query，body 一律未验**。`POST /creator/works/save` 到底收哪些字段、`preorder` 有没有附带参数，全都没有竞品请求体证据。
3. **管理侧那 3 处的修复按 #27 记账**。代码改了、守卫没动 #27 那组（那组的断言只锁 METHOD+path），所以 #27 的 100% 与本批无关；如果将来要给它做字段级守卫，得单独开一例。
4. **`total` 是新返回字段**，老客户端会忽略它，不构成破坏性变更；但**分页仍不发** —— 分类/标签/推广位都是运营维护的小目录，强行分页会让"一次拉全量建下拉框"这个唯一用法多一轮请求。量级变了再改（与第 93 批 `voice_favorites` 不做物化列同一判断）。
5. **`keyword` 的匹配语义是 `ilike '%kw%'`**，用的是 PG 默认大小写不敏感。竞品是否支持分词、是否搜正文，无证据 —— 我方**不搜正文**（集市正文要购买后才可见，进搜索索引等于绕开内容闸门）。


## 变更登记（v6.47 · 第 93 批：审计 #4 创作 Agent + #6 工具箱 —— #4 一条端点都不缺，#6 那 0.10 是真的能补的 · 2026-10-28）

### 一、这批在回答什么问题

第 92 批结束后，剩余权重表（3.42）最靠前的两项是 **#4 创作 Agent（0.80）** 与 **#6 工具箱（0.70）** —— 合计 1.50，占剩余的 43%。但看两块缺口栏，性质完全不同：

- **#4**：只写着两句话 —— 「真实 ASR 凭据（现 `available:false`）」与「Skill 市场运营位内容」。两句听起来都像外部依赖，但**都没被竞品全集验过**（前十三批已反复证明缺口栏自己会写错）。
- **#6**：缺口栏里混着一条「音色库 5 条形状无落点（B 类）」—— 那是**工程能补的**，却被和「真实供应商 Key」写在一起。

所以这批先做一件分类的事：**把「确实补不了的」和「只是没做的」分开**。否则下一轮还会把 #4 当工程缺口重查一遍、把 #6 那 0.10 当产品口径继续挂着。

### 二、#4 创作 Agent：一条端点都不缺

竞品 `/web/v1/agent/*` 在 TSV 里共 25 行命中，先排掉不属于 #4 的：

| 归属 | 条数 | 举例 |
| --- | ---: | --- |
| 属 #11 无限画布 | 10 | `/df/canvas/agent-skills/*` 9 条、`/df/canvas/agent-recommend-cards` |
| 属 workflow 组 | 2 | `wf/agent-task`、`wf/agent-project` |
| 属 #5 全部项目 | 1 | `/df/script_project/ai-short-film/agent-start` |
| **属 #4** | **12** | 见下表 |

12 条与我方 31 条 agent 路由逐条比：

| 归类 | 条数 | 明细 |
| --- | ---: | --- |
| 同形 | **10** | `task/create`、`task/create-check`、`task/chat`、`task/chat-end`、`task/stream`（GET + POST 两条形状）、`task/batch-download`、`PUT task/{id}`、`GET task/{id}`、`stt-token` |
| 无响应体证据豁免 | 3 | `/agent/home/resource/recommend`、`/info`、`/sse` —— 第 84 批已登记，竞品只给端点名，`requestDataJsonSchema`/`responseDataJsonSchema` 均为 `{}` |

**结论：#4 那 0.80 的构成是「真实 ASR 凭据 0.60（E 类）+ Skill 市场运营位内容 0.20（产品口径）」，没有任何一条是「端点没做」。** 这也解释了为什么它连续 60 多批都停在 96% —— 不是没动，是动不了。

顺带核清一处容易混淆的相邻项：`GET /agent/stt-token`（我方已有，无 Key 时返回 200 + `available:false`）与 `POST /agent/stt/transcribe`（`@Public()`，凭 token 换转写）**代码侧是完整的**，缺的只是一个真实的语音服务账号 —— 这属于商务，不属于本批。

### 三、#6 工具箱：音色库 8 条形状怎么落

竞品音色相关 9 条形状（`text-to-speech/voice/list` 1 + `voice-clone*` 5 + `timbre*` 3），此前全在守卫的 `AI_WAIVED` 里，理由是「无 `voice_clones` / `timbre_favorites` 表」。本批复核后判定**这个理由不成立**。

#### 3.1 克隆记录不该新建表，它就是 `tasks` 的投影

一次声音克隆的产物就是一条生成任务：`tasks` 里已有 `mode`、`title`、`deletedAt`、`results`、`capability='speech'`，还带冻结/结算的账。再建一张 `voice_clones` 就是把同一份状态写两处 —— 改名要写两处、软删要写两处、任务重试会产生「表里有行但任务已换 id」的悬空记录。

所以「我的音色」= `tasks WHERE capability='speech' AND mode='voice_clone' AND deleted_at IS NULL`：

| 竞品形状 | 落点 |
| --- | --- |
| `GET /ai/voice-clone-list` | `GET /v1/ai/voice-clone-list`（投影 `tasks` + 收藏标记） |
| `GET /ai/voice-clone/{task_id}` | `GET /v1/ai/voice-clone/{task_id}`（复用 `TasksService.detail`，只多一层 `mode` 校验） |
| `POST /ai/voice-clone/rename` | `POST /v1/ai/voice-clone/rename` → 写 **`tasks.title`**（与 `PUT /agent/task/:id` 同一列） |
| `DELETE /ai/voice-clone/{task_id}` | `DELETE /v1/ai/voice-clone/{task_id}` → 走 **`tasks.deletedAt` 软删**（与 `DELETE /tasks/:id` 同一套前置：运行中拒删、有冻结积分拒删） |
| `POST /ai/voice-clone`（提交） | **不新开路由**：走 `POST /v1/generations` 的 `mode=voice_clone`（ADR-003：差异在参数不在端点） |

#### 3.2 只有「收藏」需要一张新表

收藏对象既可能是内置音色（`TTS_VOICES` / `TIMBRE_PRESETS`，在数据库里没有行），也可能是别人的克隆（`tasks` 里的行）。所以：

```
voice_favorites(
  id, space_id, user_id,
  timbre_key,      -- 'builtin:<voice_id>' 或 'clone:<task_id>'
  created_at
) — unique(space_id, user_id, timbre_key)
```

三个决定：

1. **`timbre_key` 用字符串、不设外键**。设外键就写不进内置音色（库里没有那一行）。
2. **不拆成 `builtin_key` + `task_id` 两列**。PG 的 `unique` 默认 `NULLS DISTINCT`，两列拼键在「只有一边非空」时形同虚设 —— 同一个人能把同一个内置音色收藏无限次。
3. **不复用 `agent_skill_favorites`**。它的 `skill_id` 外键指向 `agent_skills`，音色既没有那一行、也不该进 Skill 广场的 `favorite_count` 统计。

#### 3.3 只补列表不补生产者，列表永远是空的

这是**竞品证据逼出来的判断**：它同时有 `/ai/voice-clone`（提交）与 `/ai/voice-clone-list`（列表）。如果我方只加列表，`mode=voice_clone` 在工具目录里没有任何一张卡 —— 用户根本发不起克隆，列表将永远为空，四条端点全是空壳。

所以同批补：第 16 个工具 mode `voice_clone`（`toolbox-voice-clone`、按次计价 12 积分、参考音频 + 朗读文本两个槽位）、第 20 张卡「声音克隆」（`/create/voice-clone`）、`VoiceCloneAdapter`（`/v1/voice/clone/tasks` 提交、`/v1/voice/clone/tasks/{id}` 轮询，mock 下产 `.mp3`）、以及 5 个语种的页面标题。

### 四、顺手修掉一个被新能力暴露的真 bug

`app/apps/api/src/modules/credits/credits.service.ts` 的 `validateOptions` 里，参考输入上限是这么写的：

```ts
if (limits && refs.length > (limits.image ?? 0)) { ... }
```

历史所有模式都把上限写在 `media_limits.image` 上，所以这个写法一直没出问题。但声音克隆声明的是 `{ audio: 1 }` —— `limits.image` 是 `undefined`，`?? 0` 把它变成「上限 0」，于是**任何一条参考音频都投不进来**，报错还写着 `too many reference images (max undefined)`。

改成按 `image → reference → audio → video` 取首个声明值，报错文案从「reference images」改成「reference inputs」。

**这个 bug 值得单独写一笔**：它由「新增一个用法不同的能力」暴露出来，而旧测试永远测不到（因为旧模式从没声明过非 `image` 的键）。盲点不在被测代码里，在**测试的用例分布**里。

### 五、守卫：#6 那组从「0 同形」变成「8 同形」

`AI_WAIVED` 17 → **12**（音色 5 条迁出）、`AI_MODULE_PAIRS` 19 → **16**（三条音色不再「由 `GET /models` 承接」—— 那本来就是权宜说法）、`AI_IN_SCOPE_GAPS` 整段换成 `AI_IMPLEMENTED`（8 条）。

新用例断言：

```
#6 工具箱：64 条里 8 条同形（第 93 批音色库）+ 44 条结构性偏离 + 12 条范围外
  ✓ exact.length === 8，且与 AI_IMPLEMENTED 逐条深等
  ✓ 8 条都真在 ROUTES 里
  ✓ 8 条不能同时挂在 WAIVED 或 DEVIATIONS 上
  ✓ deviated === 44 / waived === 12
  ✓ 12 条豁免必须以「范围外」开头，不许再出现「B 类」
```

最后一条是**防回归的关键**：豁免表要随实现收缩，否则做过的事还挂在缺口里，分数永远收不回来 —— 第 87 批 #11 就是这么被坑的（措辞是「无证据」，其实大半是记账错误）。

反向验证 `_acceptance/_r93_break.py` 把 `@Get("timbre/list")` 改名成 `timbre/list-BROKEN`：

```
FAIL  test/competitor-route-parity.spec.ts > #6 工具箱（64 条）
FAIL  test/voice-library.spec.ts > 音色目录：内置 + 我的克隆合并分页
  AssertionError: Cannot GET /v1/ai/timbre/list?page=1&page_size=100: expected 400102 to be +0
Tests  2 failed | 31 passed
```

恢复后 **22 parity + 11 voice-library + 15 tools = 48 passed**。

### 六、验证与数字

| 项 | 数字 |
| --- | --- |
| api 测试 | **89 文件 993 例全绿**（原 88/982：+11 `voice-library.spec.ts`） |
| db 契约 | **27 例**（原 26：+1 `voice_favorites`） |
| 总用例 | **1,405**（api 993 + adapters 164 + cli 128 + worker 61 + db 27 + shared 26 + storage 6） |
| 端点 | 770 → **778**（新 `voice` 模块 8 条） |
| 表 / 迁移 | 112 → **113** / 46 → **47**（`0046_uneven_prodigy.sql`） |
| 门禁 | `verify-round.ps1` **12/12 全绿** |
| 竞品覆盖守卫 | 十九组 **685 条 / 22 例**（#6 那组口径重划，总数不变） |
| 分数 | **202.58/206 = 98.3%**，剩余 **3.42**；**#6 96.5% → 97%** |

**为什么这批能加分而上一批不能**：#6 的 0.10 在缺口栏里的写法是「音色库 5 条形状无落点」，落点补上了就是补上了 —— 8 条竞品形状全部同形，不靠任何外部输入。而 #5/#7/#4 剩的都是「要不要做某个东西」的产品决定。**判断标准只有一条：能不能只靠代码 + 竞品证据做完。能，就是工程缺口；不能，才是外部依赖。**

### 七、诚实边界

1. **#4 的 3 条运营位豁免没有响应体证据**，只是「竞品有这个端点名」。所以「一条都不缺」这句话的准确含义是：**在现有证据下没有一条能证明我方缺**。要是哪天拿到竞品的首页推荐编排结构，这 0.20 还得重算。
2. **`voice_favorites` 没有做「收藏数」的物化列**。`collect_count` 每次 `count(*)` 重算 —— 音色收藏的量级远低于 Skill 广场，物化列带来的「计数漂移」风险不值得。量级变了再改。
3. **`VoiceCloneAdapter` 的供应商协议是推断的**，不是实测：`/v1/voice/clone/tasks` + `POST {model, text, reference_audio, voice_name, speed, format, sample_rate}`。真实供应商的字段名几乎肯定不同 —— 但这与其它 15 个后处理适配器同性质（全 mock，等 Key）。**`ADAPTER_MODE=mock` 下不校验协议，所以本批没有引入新的「假通过」。**
4. **音色目录把两组内置音色拼在一起**：`TTS_VOICES`（5 条，能直接塞进 TTS 的 `voice` 参数）与 `TIMBRE_PRESETS`（5 条，是「音色改造」的预设，塞进 TTS 会被供应商拒）。目录里都展示，但 `GET /ai/text-to-speech/voice/list` **只出前者** —— 这是刻意的，不能让前端拿到一个用不了的值。
5. **克隆音色的「试听」只在任务成功时才有**，排队/处理中一律 `preview_url: null`，不做假链接。


## 变更登记（v6.46 · 第 92 批：审计 #5 全部项目 + #7 团队 —— 两个「只差一句话」的缺口栏都没有竞品证据，补 2 条项目级导出日志 · 2026-10-28）

### 一、这批在回答什么问题

到第 91 批为止，全站剩余权重表（3.52）里还剩两个模块，缺口栏各自只有一句话：

- **#5 全部项目**（0.09）：「影视版 FILM 档是否合流到 `/works`；五档 tab 是否替代形态 tab」
- **#7 团队**（0.10）：「子账号密码 2 条未实现」

这两句话本身可能是对的——但**都没有被竞品全集验过**。而前十二批已经反复证明：缺口栏自己会写错（第 87 批 #11 的「4 个具名能力」大半是记账错误、第 91 批 #3 的 72 条里 3 条其实该补、第 84 批 #12 是重复记账）。所以这批做同一件事：把两个模块的竞品面切出来，逐条对。

### 二、两个模块的竞品面

| 模块 | 竞品前缀 | 条数 | 归一化后同形 |
| --- | --- | ---: | ---: |
| #5 全部项目 | `/web/v1/df/script_project/*` | 21 | **0** |
| #7 团队 | `/web/v1/cam/team/*` | 29 | **10** |

**#5 的 0 同形是结构性的**：竞品把项目挂在 `/df/script_project/*`，我方按 ADR-009 收敛到 `/projects/*`；守卫的 `normalize()` 只剥 `/web/v1`、不剥 `/df` —— 与第 90 批 #2（`/df/novel/*`）、第 91 批 #3（`/df/episode/*`）同一原因。测试里专门断言「21 条里同形的恰好是 0 条」，防止有人给 `normalize()` 加一条 `s|^/df||` 把 21 条静默变成「全覆盖」。

**#7 的 10 同形是真的**：竞品团队域和我方同名同前缀（`/cam/team/*`），`points-allocation`、`points-recovery`、`points-flow/{list,export}`、`project-points-flow/{list,export}`、`project-points-ranking`、`member/batch/status`、`batch-points-allocation`、`member/change-group` 这 10 条形状完全一致。**#7 是本轮唯一同形不为 0 的模块。**

### 三、#5 的 21 条怎么归属

| 归类 | 条数 | 例子 |
| --- | ---: | --- |
| 纯前缀偏离 | 9 | `GET /df/script_project/list` → `GET /works`；`POST /df/script_project/add` → `POST /projects` |
| 方法/入口偏离 | 3 | `POST …/edit` → `PATCH /projects/{id}`；`POST …/{}/split-delete` → `POST …/episodes/batch-delete` |
| **本批补（列在、入口不在）** | **2** | `GET …/export-log` → `GET /projects/{id}/exports`；`GET …/export-log/{}` → `GET /projects/{id}/exports/{export_id}` |
| 无模型 / 外部依赖 | 9 | `source_scripts` 一族 6 条、`process_status` 1 条、导出记录备注列 1 条、广告剧 agent 1 条 |

**对账纠出的记账错误**：`export-log` 一族 3 条此前被当成「episode 级导出就够了」（我方本来就有 `GET /projects/{id}/episodes/{eid}/exports/{xid}`）。但竞品的 `export-log` 是**项目级**的，query 里带 `sp_id`（项目）、`scene_type`、`scene_id` 三个过滤维度 —— 也就是说「一个项目下所有集的导出记录，可按集筛」，这是项目详情页要用的视图，不是集详情页。而我方 `exports`（分镜 zip）与 `timeline_exports`（成片）**两张表都能按 project 反查**（前者经 `episodes.project_id`，后者自带 `project_id`），属于典型的「列在、入口不在」。

### 四、补的 2 条：项目级导出日志

| 端点 | 说明 |
| --- | --- |
| `GET /v1/projects/{id}/exports` | 把两张导出表合成一条按项目分页的日志。返回 `scene_types: ["storyboard","timeline"]`、`truncated`、`total`、`list[]` |
| `GET /v1/projects/{id}/exports/{export_id}` | 单条。`?kind=storyboard\|timeline` 可选 |

设计上的三个决定：

1. **不建新表**。`exports` 经 `episodes.project_id` 反查、`timeline_exports` 自带 `project_id`，只读投影即可。建一张「项目导出日志表」意味着同一次导出要在两处写状态，是纯粹的写放大。
2. **撞号不猜**。两张表 id 各自自增，`id=42` 可能同时是分镜导出与成片导出。单条查询若两边都命中 → `400101 export id is ambiguous; pass kind`，必须显式传 `?kind=` 消歧。猜一条会让排查的人拿到**别人的**记录。
3. **上限诚实**。任一侧命中 500 行上限就置 `truncated: true`，不静默截断。
4. **`sp_id` 与路径 id 冲突就报错**。竞品把项目 id 放在 query（`sp_id`），前端两种写法都可能出现，所以也接受 query 形式；但两处都给且不一致时抛 `400101 sp_id conflicts with path id` —— 静默采用其中一边会让「查 A 项目的导出」悄悄变成「查 B 项目的导出」。

分镜行带 `episode_no`/`expires_at`/`error`，成片行额外带 `clip_count`/`skipped`/`duration_s`/`watermarked`；`status===3` 且有 `file_uri` 时才签 1 小时下载链接（`signDownload`）。

### 五、#7 的 29 条怎么归属

| 归类 | 条数 | 说明 |
| --- | ---: | --- |
| 同形 | 10 | 见上表 |
| 方法/路径偏离 | 17 | `POST :team_id/edit`→`PATCH /cam/team/info`、`POST :team_id/group`→`POST /cam/team/group`、`POST :team_id/group/:gid/delete`→`DELETE`、`GET :team_id/groups`→`GET /cam/team/groups` 等；全部登记在守卫 `TEAM_PAIRS` |
| 无模型豁免 | 2 | `PUT …/member/:member_id/password`、`POST …/member/batch/change-password` —— 无子账号体系 |

**又一处记账错误**：`account-points-ranking` 一直记成同形，实际竞品是 **POST**、我方是 **GET**。对账时才由脚本打出来（`POST /cam/team/account-points-ranking` 不在我方 769 条路由里）。

**结论：#7 的缺口栏是准确的** —— 29 条里唯一真缺的就是那 2 条子账号密码，其余全是形状差异。这与 #11 那批「缺口栏大半写错」形成对照：缺口栏有时对、有时错，只能逐条验。

### 六、守卫十九组 685 条 + 反向验证

`app/apps/api/test/competitor-route-parity.spec.ts` 从 **十七组 635 条 / 20 例**扩到 **十九组 685 条 / 22 例**（+21 #5、+29 #7），新增 `PROJECT_PAIRS`(12) / `PROJECT_WAIVED`(9) / `PROJECT_IMPLEMENTED`(2) / `TEAM_EXACT`(10) / `TEAM_PAIRS`(17) / `TEAM_WAIVED`(2)。

```
#5 全部项目：21 条竞品形状 = 0 同形 + 12 结构性偏离 + 9 条无模型/外部豁免（本批补 2 条形状）
  ✓ PROJECT_SHAPES.length === 21
  ✓ 同形数组为 []（/df 前缀使同形必为 0）
  ✓ missing() === []
  ✓ deviated 12 / waived 9，两者相加 21
  ✓ 2 条 PROJECT_IMPLEMENTED 都在 ROUTES 里
  ✓ 9 条豁免理由都 > 20 字，且以「B 类：」/「外部：」开头

#7 团队：29 条竞品形状 = 10 同形 + 17 结构性偏离 + 2 条无模型豁免
  ✓ TEAM_SHAPES.length === 29
  ✓ 同形的恰好 10 条，且与 TEAM_EXACT 逐条深等
  ✓ missing() === []
  ✓ deviated 17 / waived 2，两者相加 19
  ✓ 17 条偏离理由都 > 15 字
  ✓ 2 条豁免都点名「子账号」
```

反向验证 `_acceptance/_r92_break.py` 把 `@Get("projects/:id/exports/:xid")` 改名成 `:xid-BROKEN`：

```
FAIL  test/competitor-route-parity.spec.ts > 注册表与后端路由一致
  deviation target missing: GET /df/script_project/export-log/{} → GET /projects/{}/exports/{}
FAIL  test/competitor-route-parity.spec.ts > #5 全部项目（21 条）
FAIL  test/project-exports.spec.ts > 单条导出（撞号需消歧）
FAIL  test/project-exports.spec.ts > 单条导出（跨链/跨项目）
Tests  4 failed | 26 passed
```

恢复后 **22 parity + 9 project-exports = 31 passed**。

### 七、验证与数字

| 项 | 数字 |
| --- | --- |
| api 测试 | **88 文件 982 例全绿**（原 87/971：+9 `project-exports.spec.ts` +2 parity） |
| 总用例 | **1,393**（api 982 + adapters 164 + cli 128 + worker 61 + db 26 + shared 26 + storage 6） |
| 端点 | 768 → **770** |
| 门禁 | `verify-round.ps1` **12/12 全绿** |
| 竞品覆盖守卫 | 十九组 **685 条 / 22 例** |
| 分数 | **202.48/206 = 98.3%，剩余 3.52 不变**（本批不加分） |

**为什么本批不加分**：#5 剩的 0.09 是「FILM 档（`project_category=3`）要不要合流到 `/works`」与「五档 tab 要不要替代形态 tab」，#7 剩的 0.10 是「要不要做子账号体系」。这三件事都是**产品口径**，21 + 29 条竞品形状里没有一条给出答案（竞品那 2 条密码接口的 `requestDataJsonSchema` 都是 `{}`）。补 2 条端点让形状更贴近竞品，但不改变任何模块的完成度判断。

### 八、诚实边界

1. 只比了**方法 + 路径 + 参数名**。竞品这 50 条的 `requestDataJsonSchema`/`responseDataJsonSchema` 里，#5 的 `export-log` 两个 schema 有 query 字段证据（`sp_id`/`scene_type`/`scene_id`），但响应体字段仍然为空。
2. 合并两条导出链到一个列表里，意味着**两边的 `status` 枚举被原样输出**（都是 1/2/3/4 但语义不同：分镜是 PENDING/PACKAGING/SUCCEEDED/FAILED，成片是 排队/处理中/完成/失败）。前端靠 `kind` 区分。这是有意的：把两个枚举翻译成一个会隐藏差异。
3. 500 行上限是**未做分页下沉**的临时口径：两个表各取 500 行后在内存合并排序再切片，因此超过 500 行时 `total` 是「真实 total 的下界」而非精确值，靠 `truncated: true` 诚实标注。要精确需给两张表都加 `(space_id, project_id, created_at)` 索引后写 UNION 查询——那是下一批的事，本批不做。
4. `account-points-ranking` 的 POST/GET 差异只登记、不改方法：改成 POST 会让已有调用方 404，而竞品那条的 `requestDataJsonSchema` 是 `{}`，没有字段证据说明 POST body 该收什么。


## 变更登记（v6.45 · 第 91 批：审计 #3 剧集与分镜 —— 竞品 72 条 `/df/episode/*` 里 0 条同形，3 条单点/批量形状补上 · 2026-10-28）

### 一、这批在回答什么问题

`#3 剧集与分镜` 的台账分数是 **95.7%**、缺口 0.13，缺口栏从第 77 批起只有一句话：「`quality-check` 评分口径**自建**（竞品只有路由、无字段证据）」。这句话本身没问题——但它意味着**从来没有拿竞品全集来量过 #3**。

所以这批做三件事：

1. 从 905 行竞品端点表里把 **`#3` 的面**切出来：`^/web/v1/df//?episode/` 与 `^/web/v1/df/storyboard/` 共 **72 条**（另 34 行含 `episode`/`storyboard` 字样但属 `#2` 小说 8 行、`#17` 提取 7 行、`#11` 画布 4 行、`#12` 剧本广场 1 行、`#13/#14` 广告剧/转绘 3 行、`#18` 资源 1 行——**必须先按前缀排除**，否则计数虚高）。
2. 与我方 `app/apps/api/src/modules/script/script.controller.ts` 的 **68 条**（现 71 条）`/projects/*` 路由双向 diff。
3. 把「同能力缺单个对象形状」的补上，把「真没有模型」的如实记下来，然后把这个对账固化成守卫。

### 二、72 条怎么归属

| 归类 | 条数 | 例子 | 处理 |
| --- | --- | --- | --- |
| 纯前缀偏离 | 41 | `GET /df/episode/list` → `GET /projects/{project_id}`（项目详情里带 episodes） | 登记 `DEVIATIONS`，不补别名 |
| 方法/入口偏离 | 8 | `POST /df/episode/batch-create` → `POST /projects/{project_id}/episodes/batch` | 同上 |
| **同能力缺单点形状（本批补）** | **3** | 单条分镜、批量建分镜、批量删剧集 | 补真端点 |
| 无模型 / 外部依赖 | 23 | 分镜评论 3、标签组 5、`script_draft` 6、`process-status` 2、`parse-result`/`result-sync` 2、`epext`/`storyboard-ext` 2、`info-confirm` 1、`batch resources`/`storyboard-export` 2 | 登记 `WAIVED`，理由点名缺哪张表 |

**同形（完全一致）= 0**。原因和第 90 批的 `#2` 一样：竞品把剧集挂在 `/df/episode/*` 下，我方是 `/projects/{project_id}/episodes/*` —— 守卫的 `normalize()` 只剥 `/web/v1`、**不剥 `/df`**，所以这一组的「同形」在结构上必然为 0，覆盖只能靠显式登记（这也是为什么新用例里专门断言 `prefixOnly === 41`：如果哪天有人给 normalize 加了剥 `/df`，这个数字会跳，测试会红，提醒「把 72 条静默变成全覆盖」这件事不能被当成胜利）。

### 三、补的 3 条形状 + 1 条补字段

| 竞品形状 | 我方新端点 | 为什么这么定 |
| --- | --- | --- |
| `POST /df/storyboard/{storyboard_id}/info/batch-add` | `POST /projects/{project_id}/episodes/{episode_id}/storyboards/batch-add` | 竞品的「info」是分镜下的信息层（一条分镜挂多条 info），我方没有这一层 → 语义对齐为**按序追加镜头**；**不接受 `shot_no`/`insert_after`**（批量带序号中途撞号会造成部分成功污染整集序号），由服务端从 `max(shot_no)+1` 起连号 |
| `POST /df/episode/batch-delete` | `POST /projects/{project_id}/episodes/batch-delete` | 整批一个事务：先按 `storyboards.episode_id in (...)` 取 shotIds 清 `storyboard_assets`，再清 storyboards / episode_resources / export_jobs / project_timelines / timeline_exports / extraction_tasks / director_scenes / timeline_publications → episodes；**任一条不存在就整批 400102**（不留部分成功），**且不重排 `ep_no`**（重排会让前端缓存的集号漂移） |
| `GET /df/episode/{episode_id}/storyboard/{storyboard_id}/info` | `GET /projects/{project_id}/episodes/{episode_id}/storyboards/{storyboard_id}` | 单条分镜详情，**与整集详情里的同一行完全同形**（同一 `storyboardDtoWithUrls`，连 `Object.keys().sort()` 都相等），只多一个直属读取入口 |

另外 `POST /df/episode/status`（竞品用于改「草稿/确认」）→ 我方没有新端点，而是给 `PATCH /projects/{id}/episodes/{episode_id}` 补了 `status` 字段：`episodes.status` 列第 71 批就存在（1 草稿 / 2 确认），只是 `episodePatchSchema` 一直只收 `title`/`synopsis`/`script_text`。**只接受 `1`/`2`**，因为 3 及以上是分镜侧的生成流水状态，由 worker 写，人不能改。

### 四、23 条豁免：为什么硬补不了

- **分镜评论 3 条**（`send-comment` / `edit-comment` / `comment-list`）：我方没有 `storyboard_comments` 表，评论也没有归属与已读模型。
- **分镜标签组 5 条**：`storyboard_tag_groups` / `storyboard_tag_links` 不存在；`storyboards` 只有一个 `shot_desc` 文本。
- **`script_draft` 6 条**（含 `link-draft`、`esd detail`）：我方剧本只有 `script_text` 一列，没有草稿版本表——第 82 批判 `#24` 时也是同一原因（`#24` 的 4 条里就有草稿）。
- **`process-status` 2 条**：竞品把「解析/生成进度」做成独立可编辑实体，我方进度由 `extraction_tasks.status` 与 `storyboards.status` 表达，没有可编辑的进度记录。
- **`parse-result` / `result-sync` 2 条**：我方 `parse` 是同步事务、先备份再覆盖，没有「解析结果暂存区」这一层。
- **`epext` / `storyboard-ext` 2 条**：竞品有扩展字段（自定义列），我方没有扩展字段表。
- **`info-confirm` 1 条**：竞品分镜 info 有「确认」态，我方分镜直接落库可用，没有中间确认态。
- **`batch resources` / `storyboard-export` 2 条**：批量资源绑定在 `match-resources` 里已覆盖（`episode_resources` 整批替换），`storyboard-export` 与 `#3` 已有的 `film-synthesis-export` 是两件事（前者导出分镜表、后者合成视频）→ 记 B 类。

**这 23 条一条都没有硬造。** 造一张没有写入方的评论表、或一个永远返回空数组的「解析结果暂存区」，比缺这个接口更坏——它会让调用方以为能力在，实际只是把「没有」包装成「有」。

### 五、守卫十七组 635 条 + 反向验证

`app/apps/api/test/competitor-route-parity.spec.ts` 从 **十六组 563 条**扩到 **十七组 635 条**（+72），新增 `EPISODE_SHAPES`(72) / `EPISODE_PAIRS`(49) / `EPISODE_WAIVED`(23) / `EPISODE_IMPLEMENTED`(3)，并加用例：

```
#3 剧集与分镜：72 条竞品形状 = 0 同形 + 49 结构性偏离 + 23 条无模型/外部豁免（本批补 3 条形状）
  ✓ EPISODE_SHAPES.length === 72
  ✓ 同形数组为 []（/df 前缀使同形必为 0）
  ✓ missing() === []
  ✓ deviated 49 / waived 23，两者相加 72
  ✓ 3 条 EPISODE_IMPLEMENTED 都在 ROUTES 里
  ✓ 23 条豁免理由都 > 20 字，且以「B 类：」/「外部：」开头
```

反向验证 `_acceptance/_r91_break.py` 把单条分镜路由改名成 `-BROKEN` 后：

```
FAIL  test/competitor-route-parity.spec.ts > 注册表与后端路由一致
  deviation target missing: GET /df/episode/{}/storyboard/{}/info → GET /projects/{}/episodes/{}/storyboards/{}
FAIL  test/competitor-route-parity.spec.ts > #3 剧集与分镜（72 条）
FAIL  test/episode-shapes.spec.ts > 单条分镜详情
Tests  3 failed | 22 passed
```

恢复后 **20 parity + 5 episode-shapes = 25 passed**。

### 六、验证与数字

| 项 | 数字 |
| --- | --- |
| api 测试 | **87 文件 971 例全绿**（原 86/965：+5 `episode-shapes.spec.ts` +1 parity） |
| 总用例 | **1,382**（api 971 + adapters 164 + cli 128 + worker 61 + db 26 + shared 26 + storage 6） |
| 端点 | 765 → **768** |
| 门禁 | `verify-round.ps1` **12/12 全绿** |
| 竞品覆盖守卫 | 十七组 **635 条** |
| 分数 | **202.48/206 = 98.3%，剩余 3.52 不变**（本批不加分） |

**为什么本批不加分**：`#3` 的 0.13 缺口是 `quality-check` 的**五维评分口径**——竞品 72 条里没有任何一条给出评分字段、权重或分级规则（`quality-check` 本身只在端点表里有一行 `POST /df/episode/:ep_id/quality-check`，`requestDataJsonSchema` 与 `responseDataJsonSchema` 都是 `{}`）。本批补的 3 条是「单点读取/批量写入」的**形状**，没有改变评分口径自建这件事，所以分数不动。

### 七、诚实边界

1. 只比了**方法 + 路径 + 参数名**。竞品 72 条的 `requestDataJsonSchema`/`responseDataJsonSchema` 全为 `{}`，字段级语义仍然没有证据。
2. 「补 3 条」的判据是「同能力已有集合级入口、只缺单个对象入口」。若某条同时缺集合级和单点级（如评论），一律记豁免而不是补一半。
3. 批量建分镜的 `shot_no` 由服务端连号，与竞品「客户端可指定序号」不同——这是有意收敛，理由写在 §17.48。
4. 批量删剧集不回滚已删的分镜产物文件（对象存储里的物理文件不动），与单删一致。
5. `episodes.status=2`（已确认）目前不阻断任何写操作；竞品是否用它做闸门没有证据，未擅自加锁。

## 变更登记（v6.44 · 第 90 批：#2 小说改编链 —— 竞品 102 条 `/df/novel/*` 里 0 条同形，13 条是「该有的单点形状」、12 条连模型都没有 · 2026-10-28）

### 一、这批在回答什么问题

`#2 小说改编链` 记 98%、权重 8，缺口栏从第 62 批起只有两句：「`original_script/characters/*` 5 条有意不单列」「结局分支字段取证」。**它从来没有用竞品全集验过** —— 而前几批已经反复证明：缺口栏本身会写错（第 87 批证伪了 #11 两条「具名能力」、第 84 批发现 #12 的「竞品 29+12」重复记账）。

本批把竞品 `/web/v1/df/novel/*` 的形状逐条对。第一个坑是**范围**：`/df/novel` 子串会连带捕到 `/df/novel_market/*`（剧本广场，29 条，第 84 批已归 #12）——不排除就会把别人的缺口算到 #2 头上。排除后是 **102 条**。

第二个坑是**归一化**：竞品把小说链挂在 `/df/novel/:nt_id/...`，我方按 ADR-009 直接 `/novel/:ntId/...`；守卫的 `normalize()` 只剥 `/web/v1`、不剥 `/df`，所以这一组的「同形」**必然是 0**。0 同形不等于「全缺」——前缀差异本身就是一条必须登记的偏离。

### 二、102 条怎么分

| 分类 | 条数 | 处理 |
|---|---:|---|
| 「剥掉 `/df` 就同形」的纯前缀偏离 | **58** | 登记 `NOVEL_PAIRS`，`ours` 逐条写过 |
| 结构性偏离（方法/命名/入口不同） | **32** | 21 条登记偏离；**13 条按竞品形状补成真端点**（见下节） |
| **无数据模型豁免** | **12** | 不造假接口，记为 `B 类`（见第四节） |

方法级偏离的典型：竞品 `POST :nt_id/delete` → 我方 `DELETE /novel/:ntId`；竞品 `POST :nt_id/summary` → 我方 `GET /novel/:ntId/summary`；竞品 `PUT …/episodes_outline/:neo_id` → 我方 `PATCH /novel/:ntId/original_script/episodes_outline/:neoId`（PUT→PATCH 一族共 10 条）；竞品 `GET :nt_id/point` → 我方 `POST /credits/quote`（它有 `step`/`episode_count`/`chapter_start` 等预估参数，本质是报价）。

### 三、13 条「该有的单点形状」

旧缺口栏把那 5 条 `characters/*` 写成「有意不单列」——但竞品确实有单点读/删/改名，前端做角色卡编辑时不需要拿整张列表。这批按竞品形状补齐：

| 端点 | 与竞品的关系 |
|---|---|
| `GET /novel/:ntId/download?only_episodes=` | 竞品同路径；返回 **markdown**（`text/markdown` + `filename*=UTF-8''`） |
| `GET /novel/:ntId/script_edit_agent` | 竞品同路径；只读探针，无会话回 `active:false` 而不是 400 |
| `GET|POST /novel/:ntId/original_script/materials` | 素材单点读 + 手工建（`manual:true`，与 LLM 抽取区分） |
| `GET /novel/:ntId/original_script/materials/:nmId` | 单条详情，形状与列表行逐字段相同 |
| `GET /novel/:ntId/original_script/characters/:ncId` | 单条角色卡 |
| `POST …/characters/:ncId/delete` | 竞品是 POST delete（我方 `novel_characters` 无软删列 → 硬删） |
| `POST …/characters/batch-rename` | 竞品同路径；只改 `name`（唯一不引起下游重生成的字段） |
| `GET|PATCH /novel/:ntId/fission_script/summary_outline` | 总纲读写；`beats` 不可改（它是 `episode_outline/generate` 的输入） |
| `POST /novel/:ntId/fission_script/idea` | 重生成 3 条创意，同 `nonce` 复现同一批（可测） |
| `PATCH …/fission_script/idea/:niId` | 单条改 `title/logline/genre/tone`，不动 `ni_id`/`angle` |
| `PATCH …/fission_script/characters/:ncId` | 裂变链角色卡改 |
| `PATCH …/original_script/episodes_outline/:neoId` | 原创链集纲单点编辑 |

### 四、12 条豁免为什么硬补不了

| 族 | 条数 | 为什么 |
|---|---:|---|
| `buy/*`（买断/授权） | 7 | 没有「买断记录」这个概念的表：`schema.ts` 里没有 buy 表，`novel_chapters`/`novel_characters` 也没有 buyer 维度。竞品这 7 条的两个 schema 都是 `{}`，连字段形状都没给 |
| 本子级协作组/权限/分发 | 5 | 我方团队协作是**团队级**（`team.controller.ts` 的 `/cam/permissions`），分发只有运营侧 `/op/distributor/*`；没有「单个小说本的成员组」模型 |

这 12 条是**能力不在**，不是**形状不同**。造一个 `GET /novel/:id/buy/detail` 返回空对象比缺接口更坏：调用方会以为买断功能存在。

### 五、为什么分数是往下调

#2 从 **98% → 97%**（7.84 → 7.76，缺口 0.16 → 0.24）：

- **+0.16 归 B 类**：那 12 条无模型端点。这不是「没排期」，是「要不要建 buy/协作组表」的产品口径；
- **0.08 留 E 类**：结局分支字段仍需竞品响应体证据（102 条里没有这条）；
- 旧缺口栏里「`characters/*` 5 条有意不单列」这条**作废**（已补成单点形状）。

全站 202.56 → **202.48**、剩余 3.44 → **3.52**、核心 107.67 → **107.59（97.8%）**、首发 130.57 → **130.49（98.1%）**、E 2.53 → **2.45**、B 0.915 → **1.075**。

### 六、守卫与验证

- 守卫从十五组 461 条扩到**十六组 563 条 / 19 例**：`NOVEL_SHAPES`(102) + `NOVEL_PAIRS`(90) + `NOVEL_WAIVED`(12)，并断言「剥掉 `/df` 后同形的恰好 58 条」——这防止以后有人把 `/df` 前缀归一化掉、让 102 条静默变成「同形全覆盖」。
- 新功能测试 `novel-shapes.spec.ts` **8 例**：导出节结构、探针三态、详情与列表行 `Object.keys` 深等、批量改名整批拒（未知 id 不做半批）、素材手建 `manual:true`、总纲 `beats` 不可改、同 nonce 幂等、主链本子重生成回 **400100**。
- 反向验证：把 `@Get(":ntId/download")` 改名 → parity **2 红**（`deviation target missing: GET /df/novel/{}/download → GET /novel/{}/download`）+ 功能 **1 红**；restore 后 27 绿。
- 门禁 12/12；api **86 文件 965 例**、总用例 **1,376**；端点 **765**（+13）。

### 七、诚实边界

1. 守卫只比 METHOD + path，**不校验 query / body 语义**：导出的 markdown 层级、批量改名是否触发下游重算都不在守卫里。
2. 12 条豁免是「没有模型」——一旦产品决定建 buy/协作表，这批要立刻从 `WAIVED` 改成 `PAIRS` 并补实现，不能长期挂着。
3. 58 条前缀偏离只是**命名口径**：竞品调用方把 base path 从 `/df` 去掉还要改 `:nt_id` 的大小写习惯，不是零成本。
4. `download` 返回 markdown 而不是竞品的压缩包/文件流（竞品 `responseBodyType` 无证据）；`only_episodes` 只接受 `1/true/yes`。
5. 批量改名只允许改 `name`：竞品 schema 是 `{}`，其余字段（roleType/prompt/description）改名会牵动角色卡重生成，不该跟批处理走。
6. 这批没有动前端页面：13 条新端点的 UI 接法留待页面批次（角色卡刚需的「单点读」已具备）。

## 变更登记（v6.43 · 第 89 批：#9 CLI 骨架逐条复查 —— 40 条里 7 条是「后端早就有、CLI 没接」 · 2026-10-28）

### 一、这批在回答什么问题

#9 CLI/MCP 的缺口栏从第 74 批起就写着「40 条骨架命令（卡在后端未落地的端点）」，权重 0.22。但这句话混了两种完全不同的东西：

1. **真缺后端**：竞品有这条路由、我方没有对应能力或形状（33 条，如 `material get`、`group execute`、`novel config`）；
2. **后端早就有、只是 CLI 没接**：端点已在 752 条路由里，`registry.ts` 里却还挂着一条 `todo()`（7 条）。

第 78 批的 `agent enter`/`run` 就属于第 2 类（reason 写着「REPL 未实现 / SSE 未接」，而 `POST /agent/task/chat` 与画布会话 SSE 早已就绪）。本批把 40 条逐条对着真实路由复查一遍，把第 2 类全部接线 —— 因为**把客户端工作量记成后端能力缺口，会让「还差什么」这件事失真**。

### 二、40 条怎么分成两类

| 分类 | 条数 | 例子 | 处理 |
|---|---:|---|---|
| 后端已有、CLI 没接 | **7** | `asset-lib get`（第 88 批刚补 `GET /assets/:id`，reason 已过期）、`asset-lib move`/`tag-add`（`PATCH /assets/:id` 早支持 `folder_id`/`tags`）、`ai upscale`/`subtitle-erase`（工具箱 `POST /generations` 的 `video_upscale`/`de_subtitle_*` mode）、`voice list`（`GET /models?capability=speech`）、`resource extract-wait`（`GET /extraction/tasks/:id` 轮询） | **本批全部接线成真命令** |
| 确实还没有端点 | **33** | `model price`、`subject batch-details`/`reset`、`storyboard` 草稿族 4 条、xlsx 模板 4 条、`material get`/`batch-add`、`group execute`/`template-get`、`file object`、`sync-fm`、`clip create`/`crop` … | 保留骨架，reason 不再写「组合即可」这种含糊话 |

所以本批**没有新增任何后端端点**（端点仍是 752），改的是客户端能力：**骨架 40→33、ready 164→171、命令总数 204 不变**。

### 三、7 条怎么接的

| 命令 | 后端 | 关键形状 |
|---|---|---|
| `asset-lib get <ID>` | `GET /assets/:id` | 与列表同一形状（第 88 批刚补），此前 reason 说「我方无此端点」已过期 |
| `asset-lib move <ID> <FOLDER_ID>` | `PATCH /assets/:id` | body `{folder_id}`；`--set folder_id=null` 传 JSON `null` = 移出目录 |
| `asset-lib tag-add <ID> --set 'tags=[a,b]'` | `PATCH /assets/:id` | body `{tags}`，整体替换（≤20 个） |
| `ai upscale <VIDEO_URI>` | `POST /generations` | `mode=video_upscale`、`model=toolbox-video-upscale`、`options.resolution=1080p`（2K/4K 用 `--set resolution=2k`） |
| `ai subtitle-erase <VIDEO_URI>` | `POST /generations` | 默认 `de_subtitle_auto`；框选区域 `--set mode=de_subtitle_region --set model=toolbox-de-subtitle-region` |
| `voice list` | `GET /models` | 固定 `capability=speech`（`--set visible=1` 追加过滤） |
| `resource extract-wait <ET_ID>` | `GET /extraction/tasks/:id` | 客户端轮询到终态；`--timeout` 超时、失败/失效映射退出码 |

### 四、四个通用扩展点（这是本批真正的工程价值）

1. **`fixedQuery`**：命令可以声明「永远带上的 query」（`voice list` 的 `capability=speech`），`--set` 仍可覆盖同一键 —— 避免为一条命令写一个特例函数。
2. **`as: "reference_uri"`**：工具箱的唯一入参形态是 `input.reference_uris[]`，位置参数 `<VIDEO_URI>` 用这个新类型塞进去，**不再需要 `--set 'input={...}'` 手写 JSON**。
3. **`autoIdempotency`**：`POST /generations` 强制要求 `Idempotency-Key` 头，缺了就 400。CLI 对声明了该标记的写命令自动 `randomUUID()` 生成键（用户仍可 `--idempotency-key` 指定）。**这是最容易踩的坑**：手写 curl 的人会在第一次调用就撞 400。
4. **内置轮询命令 `resource-extract-wait`**：把 `taskWait` 的模式复用为「按提取任务四态（1 进行中 / 2 成功 / 3 失败 / 4 失效）轮询到终态」，非 `--json` 时每轮往 stderr 打一行进度。

顺带修掉一条基线缺陷：`buildQuery` 对**写命令**也会返回「该命令不接受 `--set`」警告，而写命令的 `--set` 本来就该进 body —— 也就是说**此前所有写命令都在误报**。本批在 `buildQuery` 里对 `write === true` 直接返回。

### 五、验证

- 新增 `app/apps/cli/test/cli-wiring.spec.ts` **10 例**：骨架数=33 且 7 条无 reason；`asset-lib get 7` → `GET /v1/assets/7`；`move 7 12` → body `{folder_id:"12"}` 且 `--set folder_id=null` 精确为 `null`、stderr 不含「不接受 --set」；`tag-add` 的 tags 数组；`ai upscale` 的完整 body + 自动幂等键非空；`ai subtitle-erase` 默认/覆盖两种 mode；`voice list` 的 `capability=speech`；`extract-wait` 的 1→2 成功、3 失败、超时三种收尾。
- **两次反向验证**：把 `capability: "speech"` 改坏 → 1 红；把 `generations` 路径改坏 → `registry-routes.spec.ts`（跨包静态校验）与功能例共 2 红。均已 restore。
- cli 全量 **17 文件 128 例**（原 118）、`tsc --noEmit` 干净、`eslint` 退出 0；门禁 **12/12 全绿**；api 956 例不变。

### 六、数字

| 项 | 改前 | 改后 |
|---|---:|---:|
| #9 CLI/MCP 缺口 | 0.22 | **0.18** |
| #9 完成度 | 97.25% | **97.75%** |
| 骨架命令 | 40 | **33** |
| ready 命令 | 164 | **171** |
| cli 用例 | 118 | **128** |
| 总用例 | 1,357 | **1,367** |
| 全站 | 202.52 / 98.3% | **202.56 / 98.3%** |
| 剩余权重 | 3.48 | **3.44** |
| 生态组 | 94.85 / 98.8% | **94.89 / 98.8%** |
| E 类 | 2.57 | **2.53** |
| 端点 | 752 | 752（不变） |

### 七、诚实边界

1. **只接线了 7 条**，剩余 33 条一条没动 —— 它们背后确实没有端点形状，不是「没排期」。
2. `voice list` 的「音色」= 模型目录里 `capability=speech` 的条目；竞品那个「我的音色库」（列表/详情/改名/删除 + 收藏）需要 `voice_clones`/`timbre_favorites` 表，**仍记在 #6 的 B 类 0.10 里**，本批没有假装它被解决了。
3. `resource extract-wait` 复用 `GET /extraction/tasks/:id` 的四态，没有新端点，也没有改提取服务端的行为。
4. 骨架的 reason 文案本批动了 7 条（换成真命令），其余 33 条**没有逐条重写 reason** —— 只把明显过期的（`asset-lib get`）清掉了；reason 与新证据的一致性仍是后续批次的事。
5. 分数只上调 0.04（#9 97.25%→97.75%），因为减少的是**客户端待办**，不是后端能力缺口；把 7 条骨架的消失当成「后端补了 7 个端点」是错的。


## 变更登记（v6.42 · 第 88 批：审计 #17 资产/主体 —— 36 条竞品形状里 0 条同形，但只有 1 条是真缺口 · 2026-10-28）

### 一、这批在回答什么问题

第 79–87 批把一个个「自证 100%（或 99%）」的模块用竞品路由钉了一遍。剩下没被钉过的里面，#17 资产/主体（99%，缺 0.08）最可疑：它的缺口栏写的全是**字段级**问题（`prompt_blocked` 没有列、`prompt_inject_mode=replace` 语义待确认），从没有人验过「竞品那些资产库/角色库/工作流路由，在我方到底有没有可打的路径」。

竞品 `/asset/*` 与 `/subject/*` 家族在 905 行端点表里共 62 行。逐条分域后属 #17 的是 **36 条**：

| 竞品路径族 | 条数 | 我方等价物 |
| --- | --- | --- |
| `/web/v1/asset/resource/*` | 7 | `/assets` 家族（1 条真缺：单资源详情） |
| `/web/v1/asset/prompts/*` | 4 | `/agent-skills`（可带参数/可收藏/可分享的 Skill 卡） |
| `/web/v1/asset/actor/*` | 4 | `/subjects`（kind=character 就是演员） |
| `/web/v1/asset/workflows/*` | 13 | 画布模板族 + 节点任务族 |
| `/web/v1/subject/resource/*` | 8 | `/subjects` |

另 26 行不属 #17：知识库资产 11 条（#18）、抽取/剧集资产 9 条（#3）、广告剧与转绘 3 条（#13/#14）、资源目录 batch-move 1 条。

### 二、逐条归属：0 同形 + 34 结构性偏离 + 2 外部输入豁免，0 缺口

- **`/asset/prompts` 4 条 → `agent-skills`**：我方把提示词库做成「Skill 卡」——可声明参数、可收藏、可分享给团队；竞品是「提示词标签 + 文本块」。同一件事，两种建模。
- **`/asset/actor` 4 条 → `/subjects`**：`subjects.controller.ts` 头注释早就写明「竞品用 `df/subject/resource*` 与 `asset/actor/list` 两套 ID，不混用」，我方把角色/演员合流为 subject（`kind=character`）。
- **`/asset/workflows` 13 条 → 画布模板族**：list→`GET /canvas/templates`、detail→`GET /canvas/templates/:id`、create/PUT→`POST /canvas/canvases/:id/tpls`、copy→`GET /canvas/templates/:id/instantiate`、runs→`POST /canvas/canvases/:id/batch-node-tasks`、run-list→`GET …/running-nodes`、node-runs→`POST …/nodes/:id/generate`、run→`GET …/nodes/:id/task/:task_id`、node-point-calc→`POST /credits/quote`。**模板=快照，改=另存**，所以没有「PUT 模板」。
- **`/subject/resource` 8 条 → `/subjects`**：竞品连查询/删除/更新都做 POST，我方是 GET/DELETE/PATCH。
- **2 条外部输入豁免**：`vidu-subjects` 的注册与反查需要供应商凭据。

### 三、唯一一条真缺口：单素材详情

竞品有 `GET /web/v1/asset/resource/:category/:res_id`，我方只有列表 `GET /assets` —— 想按「点开一张图」的调用习惯打过来，是 404。本批补：

```text
GET /assets/:id            （复用列表的 toDto，形状完全一致）
  → 200 { id, kind, url, thumbnail_url, width, height, bytes, task_id, folder_id, created_at, … }
  → 400101 invalid asset id          （路径参数不是数字）
  → 400102 asset not found           （不存在 / 不属于本空间 / 已软删）
```

`category` 参数**没有实现**：竞品用 `category` 做前端分栏（图片/视频/音频），我方用 `kind` + 文件夹表达；造一个被忽略的参数比不造更坏。

测试里有一条不太一样的断言：**详情与列表同一行的 `Object.keys()` 深等** —— 保证「同一个资源从两个入口看到的是同一个形状」，以后谁给详情加字段就会红。

### 四、为什么本批不加分

那 0.08 的两条缺口是：

1. `prompt_blocked` 没有列 —— 需要竞品的字段证据（我们连字段名都只有 `cmd/` 里的转述）；
2. `prompt_inject_mode=replace` 是「替换占位符」还是「整段替换」—— 需要产品一句话。

两者都与路由形状无关。把「路由对过账」当成「缺口已消失」是不诚实的，所以 #17 仍是 **99% / 7.92**。

### 五、守卫：十五组 461 条

`apps/api/test/competitor-route-parity.spec.ts` 新增 `ASSET_SHAPES`（36）、`ASSET_PAIRS`（34 条登记，reason 按 prompts/actor/workflows/subject/resource 五类复用）、`ASSET_WAIVED`（2 条外部输入），并把总形状数从 **425 推到 461**。新用例断言：exact 0、deviated 34、waived 2、三者相加 36；`GET /asset/resource/:category/:res_id` 的 ours 必须是 `GET /assets/{}`；两条豁免 reason 必须以「外部」开头。

反向验证（把 `@Get("assets/:id")` 改名成 `-BROKEN`）：parity 2 例红（`deviation target missing: GET /asset/resource/{}/{} → GET /assets/{}`）+ assets 1 例红，共 3 红；恢复后 26 绿。

一个踩坑值得记：给求和断言加项时写成 `CANVAS_SHAPES.length, ASSET_SHAPES.length` —— 第二个参数被当成 `expect()` 的 message，报错是 `36: expected 425 to be 461`（数字跑到前面去了）。改成 `+` 才对。

### 六、验证与数字

| 项目 | 结果 |
| --- | --- |
| `test/assets.spec.ts` | 7 → **8 例** |
| `test/competitor-route-parity.spec.ts` | 17 → **18 例**（十五组 461 条） |
| api 全量 | **85 文件 956 例**（原 954） |
| 门禁 | **12/12 全绿** |
| 端点 | 751 → **752** |
| 迁移 / 表 | 46 / 112（不变） |
| 用例总数 | 1,355 → **1,357** |
| 全站 / 剩余 | **202.52 / 206 = 98.3% / 3.48**（不变） |

### 七、诚实边界

1. 只比 METHOD+path，不比 query/body 语义；`/asset/resource` 的 `category` 与 `res_id` 的真实语义（是资产 id 还是「分类下的序号」）没有证据。
2. 「提示词库 = 可带参数 Skill 卡」是我方自建口径，与竞品字段形状可能不一致。
3. `/asset/workflows` 13 条里的删除/改名，翻译成模板快照语义是合理推断，不是逐字等价。
4. 两条 `vidu-subjects` 豁免是因为缺供应商凭据，不是判定「不需要」。
5. 本批没有触碰 #17 那 0.08 的两条字段级缺口 —— 它们仍然是 B 类。

## 变更登记（v6.41 · 第 87 批：审计 #11 无限画布 —— 台账那句「4 个具名能力无证据」大半是记账错误 · 2026-10-28）

### 一、这批在回答什么问题

第 86 批收尾时留下的清单是：#11 无限画布（XL(20)，0.20）的缺口栏写着「4 个具名能力（`pinned-timelines` 4 条、`group execute`、`group template-get`、`material batch-add`）都无竞品响应体证据 → 不实现」。

这句话有**两处可疑**：

1. 它把「没有响应体证据」当成了「不实现」的理由——但第 79–86 批反复确认过：**响应体证据缺失不等于能力缺失**，真正该判的是「这个能力我们要不要」；
2. 它是一句**结论**，而不是一条可复核的账——谁也说不清 `group execute` 具体是哪条路由。

所以这批的任务：拿竞品端点表逐条对，把这句话拆成可复核的行。

### 二、竞品 114 条 canvas 形状怎么归属

竞品 `/canvas` 家族在 905 行端点表里共 **114 条** METHOD+path。逐条对完的结构：

| 分类 | 条数 | 说明 |
|---|---:|---|
| 同形 | **10** | film 的画布绑定 9 条（`canvases/visible`、`canvas-bindings` 的 GET/POST/DELETE/PUT、`task-bindings`、`task-panel`、`submit-result`）+ 看板的 `canvas/total-point-consume` |
| 结构性偏离 | **100** | 竞品把画布 id 挂在域根（`/web/v1/df/canvas/:canvas_id/...`），我方是集合式（`/canvas/canvases/:canvas_id/...`）；另有命名、方法（`PUT`↔`PATCH`）、任务操作位置（`/tasks/*`）、会话辅助（`/canvas/chat/*` 不带 canvas_id）等 |
| 真能力缺口 | **4** | 见下一节 |

**这一步不能自动化**：用字符串 diff 会得到 104 条「未匹配」，其中 100 条是前缀/命名差异——第 65 批那次 canvas 比对（`_r65_canvas_cmp.py`）之所以被登记为「不可用」，就是同一个原因。

### 三、那句缺口栏：两条不存在、两条是等价物

| 台账原话 | 复核结果 |
|---|---|
| `group execute`（整组节点一起提交生成） | **竞品端点表里根本不存在**。`grep execute` 在 905 行里 0 命中 |
| `material batch-add`（一次加多个素材） | **也不存在**。`batch-add` 只有 `df/storyboard/:id/info/batch-add` 与 `df/user_knowledge/dir/asset/batch-add-tags`，都与画布素材无关 |
| `pinned-timelines` ×4（GET/POST/DELETE 单条/DELETE 全部） | **等价于我方的 pin-groups**（7 槽位、成员整体替换、与 `canvas_nodes.group_ids` 同事务双写）——是命名与粒度的差异，不是能力缺口 |
| `group template-get`（单个组模板详情） | **等价于我方的画布级 `GET /group-templates`**（可按 `group_id` 过滤） |

所以台账那 0.20 里，**没有一条真的对应「竞品有、我方没有」的具名能力**——除了下面这四条小能力。

### 四、真正的 4 条缺口（B 类，仍不实现）

| 竞品形状 | 我方为什么没有 |
|---|---|
| `POST /df/canvas/{}/clip`（画布内切视频） | 剪辑是编辑动作，我方由 generation 的 `video_slicing` 承接；没有「画布内剪辑片段」这个实体 |
| `POST /df/canvas/{}/crop`（画布内裁剪） | 同上，没有 crop 实体 |
| `POST /df/canvas/{}/group-recover`（组回收站） | `deleteGroup` 是硬删（`db.delete`），`canvas_groups` 有 `status` 列但没有软删语义——造一个 recover 只会永远返回空 |
| `POST /df/canvas/{}/tpls/{}/elements/batch-create`（模板元素批量建） | 整画布模板元素存在 `canvas_templates.payload` jsonb 里，**没有元素表**可批量插；竞品两个 schema 都是 `{}` |

四条**都要先建数据模型**，属于「产品一句话决定建不建」，所以判 **B 类**，不是 E 类（外部输入）。这也是本批把 #11 的 0.20 从 E 改判 B 的依据。

### 五、顺手补的 3 条客户端形状（不是别名）

审计时发现三处「我方只有列表/整体，没有单点」：

| 竞品 | 我方之前 | 本批补 |
|---|---|---|
| `GET /df/canvas/{}/nodes/{node_id}` | 只有 `GET …/nodes`（列表） | `GET /canvas/canvases/:canvas_id/nodes/:node_id` |
| `GET /df/canvas/{}/nodes/{node_id}/lock` | 只有 `POST …/lock` 与 `/unlock` | `GET …/nodes/:node_id/lock`（**必须回 Redis 读**：锁只在 Redis 的 `lockKey` 里，`heartbeat` 只返回整画布锁列表） |
| `DELETE /df/canvas/{}/pinned-node` | 只有 `PUT …/pinned-node`（body 传 `node_id: null`） | `DELETE …/pinned-node`（无 body，等价语义） |

按竞品形状写的客户端此前会 404/405。三条都不是「别名」，是**同一个能力缺了一种调用形状**。

### 六、守卫与验证

- 守卫从 **311 → 425 条**（十四组）：`CANVAS_SHAPES`(114) + `CANVAS_PAIRS`(100，逐条登记 ours 与理由) + `CANVAS_WAIVED`(4，理由必须以 `B 类：` 开头——含糊写「暂未实现」会红)。
- 两个解析坑被记录进脚本：① 只正则 `@Controller("x")` 会漏掉 `@Controller()`（空前缀）的 30+ 条路由；② `DEVIATIONS` 的键必须过 `shapeOf()` 归一化，否则 `{tag_id}` 与 `:tag_id` 对不上。
- 反向验证：把三条新端点改名成 `-BROKEN` → 守卫 2 例红 + 功能测试 1 例红（`expected 400102 to be +0`）；还原后全绿。
- 数字：api **954 例**（85 文件，+1 功能 +1 守卫）、控制器 52、**端点 748 → 751**、迁移 46、用例总数 **1,355**；门禁 **12/12 全绿**；`scoreboard.py` 复核 **202.52 / 206 = 98.3%**、剩余 **3.48**、核心 **107.67（97.9%）**、首发 **130.57（98.2%）**、E **2.57** + B **0.915**。

### 七、诚实边界

1. 守卫只比 METHOD + path，**不比 query/body 语义**——114 条里没有一条验证过字段。
2. 4 条小能力仍是「不实现」，只是把理由从「无证据」改成「无模型」——改的是**记账**，不是能力。
3 . `pinned-timelines` 判成偏离的依据是「pin-groups 是同一件事」，这需要人读代码，测试锁不住。
4. 画布那 97 项 E2E 是逐条核过的既有资产，本批没有新增 E2E（补的是 1 例契约测试）。
5. 这批**提高了**一个模块的分数（99 → 99.5）——这是第 79 批以来第一次上调，理由不是「又做了东西」，而是**旧缺口栏把等价物和不存在的能力写成了缺口**。

## 变更登记（v6.40 · 第 86 批：审计 #6 工具箱 —— 竞品 64 条 `/ai/*` 里，5 条「该有但没有」 · 2026-10-28）

### 一、这批在回答什么问题

第 79–85 批把「满分模块」逐个用竞品路由钉住、又把 #22 账号从 95% 补到 98% 之后，台账里最没底的一行是 **#6 工具箱（97%，0.60）**——它的缺口栏只有一句话：

> 真实供应商 Key（全 mock，外部依赖）

这句话可能对，也可能掩盖了别的东西：**竞品工具箱面到底有多少条路由，从没逐条对过**。本批就是把这 64 条 `/web/v1/ai/*` 全部落到「我方哪条路由 / 为什么不落 / 属不属于我们的产品面」上。

### 二、竞品 `/ai/*` 64 条的归属

| 归属 | 条数 | 例子 |
|---|---:|---|
| **收敛到 `POST /generations`**（能力由 body 的 `capability`+`mode` 决定） | **27** | `text-to-video`、`image-to-video`、`refer-image-to-video`、`video-to-video`、`video-crop`、`video-convert`、`video-super-resolution`、`video-audio-separation`、`fps-duration-unify`、`text-to-image`、`redraw-to-image`、`image-batch-super-resolution`、`text-to-music`、`text-to-sfx`、`text-to-speech`、`voice-clone`、`prompt-optimize` … |
| **由别的模块承接** | **20** | 对话 8 条（`chat/completion`→`POST /agent/task/chat`、`chat/abort`→`POST /agent/task/chat-end`、会话 CRUD→`/canvas/canvases/{}/chat/sessions`、`chat-msg-list`→`…/messages`）；素材匹配 3 条→画布节点动作；`point-calculate`→`POST /credits/quote`；`file-sign-url`→`POST /assets/upload`；`publish`→剧集时间轴 publish；`ip-template/*`→`/subjects/templates` + `/subjects/{}/apply-template`；`task/strategy-info`→`GET /tasks/{}`；音色/分类列表→`GET /models` |
| **没有等价物** | **17** | 见下节，再拆「该有但没有 5 条」+「范围外 12 条」 |

**关键事实：我方一条 `/ai/*` 路由都没有，这不是漏了，而是 ADR-003「差异在参数不在端点」。** 工具箱对外只有两条路由：

- `GET /v1/generations/tools` —— 目录（19 张卡 + 15 个工具 mode 的接线声明）
- `POST /v1/generations` —— 一条生成端点，能力由 body 里的 `capability` + `mode` 决定（35 个 mode）

所以 27 条竞品路由指向同一个我方形状，是**设计**，不是记账技巧：参数面板由目录驱动，新增一个工具只加一层 mode 声明，不加一条路由。

### 三、那 17 条：5 条「该有但没有」+ 12 条「范围外」

| 类 | 条数 | 具体 | 为什么 |
|---|---:|---|---|
| **B 类：该有但没有** | **5** | `GET /ai/voice-clone-list`、`GET /ai/voice-clone/{task_id}`、`DELETE /ai/voice-clone/{task_id}`、`POST /ai/voice-clone/rename`、`POST /ai/timbre/collect` | `voice_clone` 只把参数**透传给供应商**、不落库，所以「我的音色」没有可查、可改、可删的对象；收藏同理。要补得先建 `voice_clones` / `timbre_favorites` 表，而竞品这 5 条的 `requestDataJsonSchema` / `responseDataJsonSchema` **都是 `{}`** —— 字段形状无证据 |
| **范围外：不是我们的产品面** | **12** | `image-recognition`、`face-recognition`、`identify-face`、`style-extraction`、`image-to-text`、`world-generate`、`check-language`、`audio-slicing`、`video-subtitle-voice-edit`、`video-process-session/{create,detail,update-edit}` | 人脸识别 / 身份识别 / 世界模型 / 图像理解 / 音频切片 / 逐句字幕配音 / 视频处理会话，属竞品其它产品面，不在「影视创作工具箱」范围内 |

**为什么 5 条不硬补**：建表要有字段，字段要有证据；把猜测固化成 schema 比缺 5 条接口更坏（同一口径见第 82 批 #24 那 4 条豁免）。所以它们进 `WAIVED`，理由以 `B 类：` 开头，并且 `AI_IN_SCOPE_GAPS` 精确锁住「该有的必须正好是这 5 条」——下一批想扩或缩记账，必须改断言。

### 四、守住「97% → 96.5%」这件事

守卫 `apps/api/test/competitor-route-parity.spec.ts` 新增：

- `AI_SHAPES`（64 条完整竞品形状）
- `AI_GENERIC_TOOLS`（27 条 → `POST /generations`）
- `AI_MODULE_PAIRS`（20 条 `[竞品形状, 我方路由, 理由]` 成对登记）
- `AI_WAIVED`（17 条，前缀区分 `B 类：` / `范围外：`）
- `AI_IN_SCOPE_GAPS`（5 条，反向锁）

新增用例 `#6 工具箱：64 条里 47 条结构性偏离 + 17 条豁免（5 条该有、12 条范围外）` 断言：`exact === []`、`deviated === 47`、`waived === 17`、三者相加 = 64、`POST /generations` 恰好承接 27 条、其余 20 条理由长度 > 10、5 条 B 类豁免以 `B 类` 开头、12 条范围外以 `范围外` 开头。总形状从 **247 → 311（十三组）**。

### 五、验证与数字

| 项 | 结果 |
|---|---|
| `competitor-route-parity.spec.ts` | **16 passed**（原 15） |
| api 全量 | **85 文件 952 例**（原 951，+1） |
| 门禁 `verify-round.ps1` | **12/12 全绿** |
| 端点 | **748**（不变 —— 本批没加路由，只是把「没有 `/ai/*`」这件事说清楚） |
| 用例总数 | **1,353**（api 952 + adapters 164 + cli 118 + worker 61 + db 26 + shared 26 + storage 6） |
| **#6 工具箱** | **97% → 96.5%**（19.40 → **19.30**），缺口 0.60 → **0.70 = E 0.60 + B 0.10** |
| 全站 | **202.52 → 202.42**（98.3%），剩余 **3.48 → 3.58** |
| 核心 / 首发 | 核心 107.67 → **107.57（97.8%）**；首发 130.57 → **130.47（98.1%）** |

### 六、四条诚实边界

1. **只比形状，不比字段**：27 条指向同一个 `POST /generations`，具体每个 mode 的参数是否覆盖竞品的每个 query/body 字段，不在本批判据内。
2. **12 条「范围外」是产品范围判断，不是「以后可能做」**：如果产品决定做视频处理会话，这 12 条要重新进缺口表。
3. **5 条 B 类仍是缺口**：它们被记账、被锁住，但确实没有实现 —— 客户端按竞品形状调「我的音色」会 404。
4. **`/ai/*` 一条都没有是设计，但客户端不会自动适配**：按竞品路径写死的客户端在我方会 404，必须读 `GET /generations/tools` 的目录。这条差异已写进 api-spec §17.43。


## 变更登记（v6.39 · 第 85 批：拿竞品形状去量自己的「95%」—— #22 账号/鉴权 28 条里 9 条真缺 · 2026-10-28）

### 一、这批在回答什么问题

第 79–84 批把「自己写 100%」的模块逐个用竞品路由钉住了（#7 还被据实下调到 99.5%、#24 下调到 99%）。钉完之后剩下的问题反过来：**那些自己写 95% 的模块，缺口栏是不是也不完整？**

第一个挑 #22 账号/鉴权不是随手 —— 它有 0.15 权重（M(3)），同时落在**核心组**（创作闭环）与**首发口径**（「Beta 可对外收钱出片」）两条线上，而且它的缺口栏只写了两个词：真实渠道联调、OAuth↔手机号合并。**没有一条是「接口形状」层面的**，这本身就是可疑信号。

### 二、竞品账号域长什么样

它没有 `/web/v1/account` 这种域。28 条 METHOD+path 散在 15 个零散前缀下：

| 前缀 | 条数 | 例子 |
|---|---:|---|
| `/web/v1/login` `/logout` `/renew` `/callback/login` | 4 | 登录/登出/续期/OAuth 回调 |
| `/web/v1/user-info` | 2 | `GET`（读自己）+ `POST`（改昵称头像） |
| `/web/v1/user-settings` | 2 | `GET ?scope_type=&keys=` + `PUT` |
| `/web/v1/user/*` | 6 | `ip`、`credits`、`credits-log?page&page_size&event_type`、`credits-dashboard`(+`/flows?tab`、`/debt-list`)、`volc-query` |
| `/web/v1/buy` `/subscribe` `/trade-order` `/user-vip-info` | 4 | `POST sku-price`、活动升级、最近订单、VIP 信息 |
| `/web/v1/{env,config,captcha-check,email-captcha,text-sensidetect,weixin/token,user/language/report}` | 7 | 环境变量、运行时配置、验证码、邮箱验证码 ×2、敏感词、微信签名、i18n 上报 |
| `/api/user/logout` | 1 | 另一个前缀的登出（历史遗留） |

证据强度与第 79/82 批一致：`method` / `paramNames` / `queryNames` 有，**两个 `jsonSchema` 全是 `{}`** —— 所以只能对齐「调用形状」，字段语义只能按我方既有 DTO 自定并在下面写清楚。

### 三、三类结论

**A. 9 条我方原先没有（本批全部落地）**

| 竞品形状 | 我方新增 | 说明 |
|---|---|---|
| `POST /web/v1/user-info` | `POST /user-info` | 改昵称/头像；`avatar_uri:null` 清空；两字段都不给 → 400101 |
| `GET /web/v1/user-settings?scope_type&keys` | `GET /user-settings` | 按 scope 分组返回，`keys` 逗号分隔只回命中键 |
| `PUT /web/v1/user-settings` | `PUT /user-settings` | 合并写（不是整袋替换）；接受 `settings` / `patch` / 顶层平铺三种写法 |
| `GET /web/v1/user/ip` | `GET /user/ip` | 取 `x-forwarded-for` 首跳（`trustProxy` 已开） |
| `GET /web/v1/user/credits` | `GET /user/credits` | `{balance, frozen, available, debt_supported:false}` |
| `GET /web/v1/user/credits-log?event_type` | `GET /user/credits-log` | `event_type` → `credit_flows.kind` 映射 |
| `GET /web/v1/user/credits-dashboard` | `GET /user/credits-dashboard` | 消耗/充值/流水数/最近时间 + `by_kind[]` |
| `GET /web/v1/user/credits-dashboard/flows?tab` | `GET /user/credits-dashboard/flows` | 看板页签，复用流水查询 |
| `POST /web/v1/buy/sku-price` | `POST /buy/sku-price` | **竞品是 POST、我方原先只有 GET** —— 按竞品形状发请求会 404 |

**B. 11 条形状偏离（能力在，只登记不补别名）**

`POST /login`→`POST /auth/login`；`GET /logout` 与 `GET /api/user/logout`→`POST /auth/logout`（GET 注销会被浏览器/代理预取）；`GET /renew`→`POST /auth/renew`；`GET /callback/login`→`POST /auth/oauth/:provider/callback`；`GET /captcha-check`→`POST /moderation/captcha/verify`；`GET /user-info`→`GET /me`；`GET /user-vip-info`→`GET /billing/subscription`；`GET /trade-order/latest`→`GET /billing/orders`；`POST /subscribe/activity-upgrade/upgrade`→`POST /billing/subscribe`（+ `GET /billing/upgrade-quote` 报价）；`POST /text-sensidetect`→`POST /moderation/text-detect`。

**C. 8 条豁免（能力不在，不造假）**

邮箱验证码 ×2（我方只有手机号 + 4 渠道 SSO，没有邮箱注册通道）；`credits-dashboard/debt-list`（`credit_accounts.balance` 有 `check(balance >= 0)`，**没有欠费模型**，未结算用 `frozen` 表达）；`credits-dashboard/volc-query`（火山引擎外部用量，需供应商凭据）；`weixin/token`（微信 JS-SDK 签名，需公众号 appid+secret）；`user/language/report`（i18n 缺陷上报，没有落库表，前端走工单）；`env` + `config`（我方配置是**构建期** `NUXT_PUBLIC_*` 注入 + `/meta/capabilities`，没有运行时下发需求）。

### 四、为什么这 9 条要补、那 11 条只登记

分界线沿用第 81 批 kds 那条：**别名是给「改不动调用方」的**。

- `POST /buy/sku-price` 属 kds 那类 —— 竞品就写 POST，客户端按参照站写死，我方只给 GET 就是 404，所以补 POST 别名（body 优先、query 兜底）。
- `POST /login`、`GET /logout`、`GET /renew` 这些是「方法不同的同义动作」：客户端改一行 `auth/login` 就能对上，而且我方把 login/logout/renew 统一成 POST 有安全理由（GET 注销被判预取是真实事故类型），所以只登记偏离。
- 9 条真缺里也没有一条是「别名」—— 都是我方原先确实没有的能力（设置、客户端 IP、积分看板、sku 取价）。

### 五、实现细节

1. **账号设置不建 `user_settings` 表**，给 `users` 加 `settings jsonb`（迁移 `0045_wise_steve_rogers.sql`）。理由：设置是**客户端自己的键值对**，服务端不做任何查询，建表等于把私有 schema 固化进库、以后每加一个前端开关都要迁移。一层 `scope_type`（`default`/`workspace`/…）只为对上竞品的 `GET ?scope_type=&keys=`。
2. **合并写不是整袋替换**：`PUT /user-settings` 只覆盖传入的键，未传的保留 —— 否则「保存某一个 tab 的开关」会静默清掉其它键。
3. **`credit_flows.kind` ↔ `event_type` 映射放在 controller 侧**（`flowKinds()`），不进 service：这是对外的命名口径，不该污染内部查询语法。`consume|spend|settle → ["settle"]`、`recharge → ["recharge","gift","refund","adjust"]`、`freeze → ["freeze","unfreeze"]`，未知值 400101。
4. **`GET /user/ip` 取 `x-forwarded-for` 首跳**（不是整串、不是最后一跳）：`trustProxy: true` 已开，首跳是客户端可达地址。

### 六、守卫与验证

- `app/apps/api/test/competitor-route-parity.spec.ts` 新增 `ACCOUNT_SHAPES`（28）+ `ACCOUNT_DEVIATIONS`（11）+ `WAIVED` 增 8 条；总形状 **219 → 247**。新用例断言 exact 9 / deviated 11 / waived 8、三者相加 = 28，并锚定 `GET /user-info`→`GET /me`、`POST /login`→`POST /auth/login`。
- 新增 `app/apps/api/test/account-shapes.spec.ts` **6 例**：改昵称头像（含 `avatar_uri:null` 清空）、设置读写/合并/`keys` 过滤/非法 scope/超大值、`clientIp` 首跳、credits 三件套（含真实 mock-pay 充值 1000 后余额与看板同步）、`POST /buy/sku-price` 与 GET 深等、未登录 8 条全 401101。
- **反向验证**：把 `@Put("user-settings")` 改名 `-BROKEN` → parity + account 共 **4 例红**（guard 报 `+ Array ["PUT /user-settings"]`）；restore 后 21/21 绿。
- api 全量 **85 文件 951 例**、门禁 **12/12**、迁移 **46**（0000–0045）、端点 **748**、用例 **1,352**。
- 分数：**#22 95% → 98%**（2.85→2.94），全站 202.43→**202.52**、剩余 3.57→**3.48**；核心 107.58→**107.67**（97.9%）、首发 130.48→**130.57**（98.2%）；§5.5 表 A 里 #22 从 0.15（E 0.10+B 0.05）改 **0.06（E 0.04+B 0.02）**，故 E 2.83→2.77、B 0.745→0.715。

### 七、诚实边界

1. 只比 METHOD + path + 参数名，**不比 body/响应语义**（竞品两个 schema 都是 `{}`）；字段形状是我方自定并已写进 api-spec §17.42。
2. 11 条偏离**仍然是偏离**：按竞品形状写死的客户端打到 `/web/v1/login` 上还是 404。只是这类「改一行可对上」不值得为它维护第二套别名。
3. 8 条豁免没有一条是「以后可能做」：邮箱通道、欠费模型、火山凭据、公众号签名、i18n 落库表、运行时配置下发，都是模型/凭据层面不存在。
4. 真实渠道联调（Apple/微信/支付宝测试号）与 OAuth↔手机号账号合并**仍未做**，所以 #22 是 98% 不是 100%。
5. 守卫是快照式的：竞品或我方改路由都要人工同步这两张表（`DEVIATIONS` / `WAIVED`），测试会抓死条目但抓不到「双方一起改」。

## 变更登记（v6.38 · 第 84 批：#12 剧本广场的「竞品 29+12」是重复记账、#4 创作 Agent 有一条「只登记没实现」）

**一、这批在回答什么问题**

第 83 批发现「竞品端点列」本身会记错（#27 写的 12 条其实是 18 条）。于是本批继续验剩下两个 XL(20) 里最没底的：
#12 剧本广场（台账自称「竞品 29+12 全覆盖」）与 #4 创作 Agent（12 条竞品路由，0.80 是当时剩余里最大的一项）。
要回答的不是「有没有做」，而是「那 29+12 和那 12 到底是哪几条、我方的对应物在哪、差的是形状还是能力」。

**二、47 行怎么拆（记账错误的来历）**

| 侧 | 前缀 | 行数 | 归属 |
|---|---|---:|---|
| 消费侧 | `/web/v1/df/novel_market/*` | 29 | #12 剧本广场 |
| 管理侧 | `/v1/rmadminsrv/novel_market/*` | 18 | #27 运营后台（第 83 批已归） |

所以 #12 的「+12」就是管理侧那批行 —— 同一批行被 #27 与 #12 各算了一次。这不是「少做了 12 条」，是**把别人的 12 条算进自己的覆盖率里**，属于记账错误；本批把它修成「消费侧 29 条全覆盖」。

**三、#12 消费侧 29 条：零缺口，只差前缀**

逐条对完：**29 条全部有等价物**，差的是前缀 `df/novel_market` → `market`，方法全一致、尾段一一对应（`scripts` / `scripts/:id/detail` / `scripts/config` / `scripts/promotions` / `creator/works` / `creator/withdraw*` 等）。我方另多 7 条自建能力：买断（`POST /market/scripts/:id/buy`）、解析（`POST /market/scripts/:id/parse`）、创作者作品增改（`POST/PATCH /market/creator/works*`）、提现三件（申请 / 列表 / 撤销）。多出来的不算缺口，只是口径更宽。

**四、#4 创作 Agent 12 条：8 同形 + 1 偏离 + 3 豁免**

| 分类 | 条数 | 具体 |
|---|---:|---|
| 同形 | 8 | `task/create`、`task/create-check`、`task/chat`、`task/chat-end`、`PUT task/{id}`、`POST task/stream`（本批补齐）、`POST task/batch-download`、`GET stt-token` |
| 偏离 | 1 | `GET task/share/{share_id}/sse` → 我方 `GET /share/{token}/stream`（token 替代 share_id，第 83 批已为 #26 登记过一次） |
| 豁免 | 3 | `GET home/resource/{recommend,info,sse}` —— 竞品只有端点名、无响应体，依赖内容运营表，属「为可能不存在的内容模型设计表」，`api-spec.md §14.9.3` 早已登记「有意不做」 |

**五、唯一真补：`POST /agent/task/stream`**

竞品这条是 `POST + json body + query task_id`（bundle 里 `requestDataJsonSchema` 为空，只有方法/形状有证据），我方原先只有 `GET ?task_id=`。有意思的是 GET 那段的 JSDoc 里**早就写了「差异已登记」** —— 但登记不等于实现，按竞品形状发 POST 的客户端拿到的仍是 404。本批抽 `pipeTaskStream(req, taskId, reply)` 给两条共用（鉴权、缺参校验、错误码只有一份实现），入参优先级 **`query` > `body`**，两条都走 `@SkipEnvelope()` + SSE。

**六、顺带纠正一个旧说法：`GET /agent/stt-token` 是已实现的**

它一直躺在 #4 的缺口栏里，看起来像「端点不存在」。实测 `agent-stt.controller.ts` 早就有它：无 Key 时 `200 + available:false`（不暴露空壳），另有 `POST /agent/stt/transcribe` 中继（`@Public` + 票据 `aud=agent-stt`）。缺的是**真实凭据**，不是端点。本批用 `expect(ROUTES.has("GET /agent/stt-token")).toBe(true)` 把这条事实锁进守卫。

**七、守卫从九组 178 条扩到十一组 219 条**

- `NOVEL_MARKET_PAIRS`(29)：成对登记「竞品形状 → 我方等价物 + 理由」，避免只改一边导致白名单指向不存在的路径；
- `AGENT_SHAPES`(12)：8/1/3 三类分别断言条数，偏离必须是那一条、豁免必须都在；
- `WAIVED` 作用域从「⊆ `TASK_SHAPES`」显式扩成「⊆ `TASK_SHAPES ∪ AGENT_SHAPES`」——注释写明「开这个口子必须改这条断言」，避免以后随便往豁免里塞东西；
- 反向验证：把 `@Post("task/stream")` 改名 `-BROKEN` → **3 例红**（parity 自检锚点、`#4` 分类例、agent 的 POST 别名功能例），改回后 28/28 绿。

**八、验证与数字**

| 项 | 改前 | 改后 |
|---|---:|---:|
| 守卫形状（`competitor-route-parity.spec.ts`） | 178 条 / 12 例 | **219 条 / 14 例** |
| `agent.spec.ts` | 13 例 | **14 例** |
| api 全量 | 84 文件 941 例 | **84 文件 944 例** |
| 用例总数 | 1,342 | **1,345** |
| 端点（`-ScaleOnly`） | 738 | **739** |
| 12 项门禁 | 12/12 | **12/12**（`_acceptance/out_gate_r84.txt`） |
| scoreboard | 202.43 / 剩余 3.57 | **202.43 / 剩余 3.57（不变）** |

**九、诚实边界**

1. 守卫只比 METHOD + path，不比 query/body 语义；`task/stream` 的「query 优先」是我方口径，竞品 body 里到底放什么**无证据**；
2. `/agent/home/resource/*` 仍是「有意不做」而不是「做到了」——豁免是「允许缺」，不是「已经补上」；
3. #12 的 0.64（真实打款/资质合规、买断后二次改编、作品解析产出未取证）与 #4 的 0.80（真实 ASR 凭据、Skill 运营位内容）**本批一分未清**，只把背后的路由事实钉住；
4. 管理侧那 18 行仍按 #27 记账，本批没有改它的分数；
5. 豁免与偏离都是快照式登记：竞品改路由、我方改命名，都要人工同步这三张表，测试只能保证「今天登记的和今天实现的对得上」。


## 变更登记（v6.37 · 第 83 批：审计完剩下的三个满分模块 —— #27 的「竞品 12 条」是记账错误，实际 18 条且在别的域下 · 2026-10-28）

### 一、这批要回答的问题

第 80–82 批把 #8 影视版、#10 活动/创作者、#21 数据看板、#24 任务系统的 100% 都用竞品路由钉住了。
台账上还没被钉过的满分模块只剩四个：**#1 首页工作台（S(1)）、#26 分享（S(1)）、#27 运营后台（M(3)）、#28 架构（S(1)）**。

这批要回答的是：**这四个 100% 里，还有没有「凭我方自己的端点自证」的？**

答案分两半：

- **#28 架构**：竞品侧**一条对应端点都没有**（它不是一个功能域，是「模块化单体 + 4 个包」的主动决策）。没有可对账的形状，
  本批只在文档里说明它为什么不入守卫 —— 这不是漏查。
- **#1 / #26 / #27**：三块都能找到竞品形状，而且**找的过程本身暴露了一个记账错误**（见第三节）。

### 二、这三块竞品路由是怎么「归属」出来的

竞品（ReelMate）的接口清单里**没有** `/web/v1/home`、`/web/v1/share`、`/web/v1/ops` 这些域。所以不能按域名 grep，
只能按语义往回找。实际归属结果（来自 `_acceptance/competitor_endpoints.tsv` 的 905 行）：

| 模块 | 竞品路由在哪 | 条数 |
|---|---|---:|
| #1 首页工作台 | `crc/home_list`、`crc/banner_list`、`crc/pop_up`、`op/abtest/hit`、`msg/exist-unread`（散在 3 个域） | 5 |
| #26 分享 | `task/{id}/share`、`task/share/{id}/info`、`task/share/{id}/batch-download`、`crc/assets/share`、`agent/task/share/{id}/sse` | 5 |
| #27 运营后台 | **`/v1/rmadminsrv/novel_market/*`**（不是 `/web/v1` 前缀，也不是我方 `/ops/admin/*` 的对账对象） | 18 |

`/v1/rmadminsrv` 这个前缀是这批的关键发现：它一共 18 行，全部是剧本广场的**内容管理面**（6 scripts + 4 tags + 4 categories
+ 4 promotions，`requestDataJsonSchema` / `responseDataJsonSchema` 全空）。这 18 行与我方 `/ops/market/*` 对应；
台账此前写的「#27 竞品 12 条」既**少算了 6 条**，又把它当成了我方 `/ops/admin/*` 24 端点的对账对象 ——
那批行其实属「剧本广场内容审核」，与 #12 的 admin 12 是同一批行，属**重复记账**。

### 三、逐条对账结果

**#1 首页 5 条**（4 同形 + 1 偏离，0 缺口）：

| 竞品 | 我方 | 结论 |
|---|---|---|
| `GET /crc/home/list` | `GET /crc/home/list` | 同形 |
| `GET /crc/banner_list?type=&scene=` | `GET /crc/banner_list`（zod 就要 `type`/`scene`） | 同形（含 query 名） |
| `GET /crc/pop_up?type=` | `GET /crc/pop_up` | 同形 |
| `GET /op/abtest/hit?wsid=&op_user_id=` | `GET /op/abtest/hit` | **方法+路径同形、query 名不同**（我方要 `key`） |
| `GET /msg/exist-unread` | `GET /home/unread`（长轮询） | **偏离**：立即探针 `?since=<iso>&timeout_ms=1` |

最后两条要特别说：竞品 `exist-unread` 是「查一次就返回」，我方 `/home/unread` 是长轮询（`HOME_UNREAD_TIMEOUT_MS` 上限 25s）。
两者的**等价调用**是 `?since=<当前游标>&timeout_ms=1` —— `home.service.ts` 在 `timeoutMsRaw > 0` 时按它截断，1ms 即返回
`timed_out: true`。这条等价关系不是猜测，`home-config.spec.ts` 的「没有增量时挂到 timeout_ms 才返回 timed_out」用例就在守它。

**#26 分享 5 条**（1 同形 + 4 偏离，0 缺口）：同形的是 `POST /crc/assets/share`；4 条偏离里 3 条是**任务分享**
（创建/详情/批量下载，竞品用 server 生成的 `share_id`，我方用 24 字节不可猜 token），第 4 条是**分享页 SSE**
（竞品挂在 `agent/task/share/{id}/sse`，我方挂在 `/share/{token}/stream` —— 分享是匿名语义，不能挂到要登录态的 agent 命名空间下）。
前 3 条**第 82 批已经登记过**（#24 的 `DEVIATIONS`），这批只是复用。

**#27 运营后台 18 条**（12 同方法 + 6 方法偏离，0 缺口）：

| 方法偏离的 6 条（竞品 → 我方） | 为什么 |
|---|---|
| `POST dashboard/scripts` → `GET /ops/market/dashboard/scripts` | 只读看板用 GET，读端点不该有副作用 |
| `POST scripts/list` → `GET /ops/market/scripts/list` | 同上 |
| `GET scripts/{id}/review-result` → `POST /ops/market/scripts/:id/review-result` | 审核结果要落审计日志，是写动作 |
| `PUT tags/{id}` → `PATCH /ops/market/tags/:id` | 局部更新统一 PATCH（且这条**我方原先真的没有**） |
| `PUT categories/{id}` → `PATCH /ops/market/categories/:id` | 同上 |
| `PUT promotions/{id}` → `PATCH /ops/market/promotions/:id` | 同上 |

其余 12 条（save-draft / source-original-script / submit-review / tags GET+POST+DELETE / categories GET+POST+DELETE /
promotions GET+POST+DELETE）方法与路径尾段都对得上，只是前缀不同。

### 四、这批唯一真补的东西：标签改名

`market_tags` 一直只有「建 / 删」两个入口（`POST /ops/market/tags` 靠 `onConflictDoNothing(name)` 做同名幂等、
`DELETE` 是物理删 + 从所有作品 `tag_ids` 里 `array_remove`）。竞品有 `PUT …/tags/{tag_id}`，我方没有 —— 这是真缺口，不是口径。

补的是 `PATCH /ops/market/tags/:id`，三个决定：

1. **只改名字**：`market_tags` 只有 `name` 一处可改（`status` 恒 1、没有排序/图标列），竞品那两条 schema 都是 `{}` ——
   没有字段证据就不造空壳字段；
2. **改名必须查重**：名字是全局唯一键（建标签靠 `onConflictDoNothing(name)` 兜住）。若不查重会出现两条同名标签，
   `POST /ops/market/tags` 的「回车即建」幂等语义立刻失效。查重要**排除自身**，否则前端重复提交会莫名 400；
3. **错误码与其它管理端点同族**：重名 `400101 tag name already exists`、不存在 `400102`、id 非法 `400101`、空名 `400101`。

### 五、为什么这 8 条偏离不补别名（和第 81 批 kds 的分界线）

第 81 批给数据看板补了 8 条 POST 别名，这批 8 条偏离却一条别名都不补。分界线是**客户端能不能自己改通**：

- **kds**：竞品调 `POST`、我方只有 `GET`。客户端按竞品形状发请求会拿到 **404**，把方法改成 GET 之外没有别的办法，
  所以补别名是**降低对接成本**；
- **本批**：差的不是「方法导致的 404」，而是命名/语义（复数 vs 单数、`token` vs `share_id`、读用 GET / 全量 PUT 改局部 PATCH）。
  客户端改一行路径就能通，而给 8 条都加别名会把 `/ops/market/*` 变成竞品形状的复印机，还多 8 条要长期维护的兼容路径。

一句话：**别名是给「改不动」的调用方的，不是给「名字不同」的调用方的。**

### 六、守卫从 150 条扩到 178 条

`apps/api/test/competitor-route-parity.spec.ts` 新增三组：

- `HOME_SHAPES`(5)、`SHARE_SHAPES`(5) —— 普通数组，偏离逐条写进 `DEVIATIONS`；
- `OPS_MARKET_SHAPES`(18) —— 用 **`NOVEL_ADMIN_PAIRS` 成对登记** `[竞品形状, 我方形状, 理由]`，再 `map` 出形状数组、
  循环灌进 `DEVIATIONS`。成对写的原因是：形状和等价物必须一起改，分开放迟早漂移成「登记了形状、指向一个不存在的路径」。
  这里还踩了一个小坑：`DEVIATIONS` 的键必须是 **`shapeOf()` 归一化后**的形状（`{tag_id}` / `:tag_id` 都会折成 `{}`），
  最初直接把原始字符串当键，死条目检查立刻报了 9 条。

继承的三条断言：组内无重复形状、登记表无死条目、`WAIVED` 的键必须 ⊆ `TASK_SHAPES`（豁免只对 #24 开过口子）。
新增 3 例用例：#1「5 条里 4 同形 + 1 偏离」、#26「1 同形 + 4 偏离」（并断言偏离指向 `GET /share/{}/stream`）、
#27「18 条全部登记等价物、12 同方法 + 6 方法偏离」。

反向验证：把 `@Patch("tags/:id")` 改成 `@Patch("tags/:id-BROKEN")` →

```
deviation target missing: PUT /v1/rmadminsrv/novel_market/tags/{} → PATCH /ops/market/tags/{}: expected false to be true
Tests  3 failed | 28 passed (31)
```

改回即 31/31 绿。功能用例另补 1 例（改名生效 / 重名 400101 / 不存在 400102 / 坏 id 400101 / 空名 400101 / 改回自己名字幂等）。

### 七、验证与数字

| 项 | 结果 |
|---|---|
| api typecheck | 干净 |
| eslint src | 退出 0 |
| `competitor-route-parity.spec.ts` | **12 例**（原 9） |
| `market.spec.ts` | **19 例**（原 18） |
| api 全量 | **84 文件 941 例**（原 937） |
| 门禁 `verify-round.ps1` | **12/12 全绿**（api 真跑 941，166s） |
| 端点 | 737 → **738**（+`PATCH /ops/market/tags/:id`） |
| 用例总数 | 1,338 → **1,342** |
| 分数 | **202.43 / 98.3% / 剩余 3.57 —— 不变** |

分数不变是诚实的结论：#1/#26/#27 三块能力都在，本批补的是「那个 100% 现在有守卫」+ 1 条漏记的端点。
#27 的竞品端点列从 12 改成 18 是**修正记账**，不是加能力。

### 八、诚实边界

1. 守卫只比**方法 + 路径形状**，不比 query / body：#1 里 `op/abtest/hit` 的 query 名差异（我方 `key` vs 竞品 `wsid`/`op_user_id`）
   守卫看不出来，只能靠文档记录；
2. #27 的 18 条竞品 schema 全空，除「标签改名」外的字段语义仍**无证据** —— 这批没有去猜它们；
3. #28 架构仍是「竞品 0 条对应端点」，属主动决策，**不是已对账**；
4. 我方的额外端点（如 `/ops/admin/*` 24 条、`/crm` 等）不在守卫范围内 —— 多给的能力不扣分，也不证明对齐；
5. 守卫是快照式：竞品新增 `/v1/rmadminsrv/*` 路由时需要人工加进 `NOVEL_ADMIN_PAIRS`。


## 变更登记（v6.36 · 第 82 批：审计「满分」模块 #24 任务系统 —— 17 条竞品路由里，1 条是真缺、12 条只是换了名字、4 条连模型都没有 · 2026-10-28）

### 一、这批在回答什么问题

第 79~81 批连着查出三件事：#7 团队的「100%」是按 33 条算的（竞品 40 条）、#8 影视版只差一种方法、
#21 数据看板 13 条里有 8 条方法不对。于是还剩 6 个满分模块没被这样对过，这批挑 **#24 任务系统**
（`S(1)`，权重 1，台账里写「10 端点 + 3 队列 + ETag，11 例，缺口：多区域数据面」）。

问题：**竞品 `/web/v1/task/*` 一共 17 条 METHOD+path，我方 `tasks` 家族 14 条 —— 差的那 5 条，是缺能力还是缺名字？**

答案是「三者都有」，而且这三类的处理方式**必须不同**：

| 类别 | 条数 | 处理方式 | 为什么 |
|---|---|---|---|
| 真能力缺口 | 1 | 补实现 | 客户端要的能力我方根本给不出，且给得出 |
| 命名/形状偏离 | 12 | **不补别名**，登记进守卫 | 换个路径就能通，补别名等于同一能力两个入口 |
| 无数据模型 | 4 | 登记进**豁免表**，不造假接口 | 库里连表/列都没有，硬造接口就是骗自己 |

### 二、逐条对账（17 条）

| 竞品形状 | 我方现状 | 判定 |
|---|---|---|
| `DELETE /task/{task_id}` | `DELETE /tasks/:id`（软删） | 偏离（复数） |
| `GET /task`（8 个筛选 query） | `GET /tasks` | 偏离（复数） |
| `GET /task/{task_id}` | `GET /tasks/:id` | 偏离（复数） |
| `POST /task/{task_id}/cancel` | `POST /tasks/:id/cancel` | 偏离（复数） |
| `POST /task/{task_id}/retry` | `POST /tasks/:id/retry` | 偏离（复数） |
| `POST /task/{task_id}/regenerate` | `POST /tasks/:id/regenerate` | 偏离（复数） |
| `POST /task/{task_id}/feedback` | `POST /tasks/:id/feedback` | 偏离（复数） |
| `POST /task/{task_id}/share` | `POST /tasks/:id/share` | 偏离（复数） |
| `POST /task/result` | `POST /task/result` | ✅ 同形 |
| `POST /task/result/batch-download` | `POST /tasks/batch-download` | 偏离（复数） |
| **`POST /task/{task_id}/download`** | 只有 `GET /tasks/:id/results/:n/download-url` | **❌ 真缺口** |
| `GET /task/share/{share_id}/info` | `GET /share/{token}` | 偏离（token 不用 share_id） |
| `POST /task/share/{share_id}/batch-download` | `POST /share/{token}/batch-download` | 偏离（token） |
| `GET /task/is_first/interact` | 无 | **豁免**（无 user 维度） |
| `POST /task/result/folder` | 无 | **豁免**（无文件夹模型） |
| `POST /task/result/interact` | 无 | **豁免**（无互动模型） |
| `POST /task/workflow/retry` | 无 | **豁免**（无 workflow 实体） |

3 + 12 + 1 + 1 = 17，账对得上。

### 三、那 1 条真缺口：`POST /task/{task_id}/download`

竞品这条是 `Method.POST` + `paramNames: ["task_id"]` + `responseBodyType: json` + 两个 schema 全 `{}`。
`json` 响应说明**它不回文件流**，回的是「下载地址」—— 也就是「一次拿这个任务全部结果的地址」。
我方原先只有 `GET /tasks/:id/results/:n/download-url`：要拿 3 个结果就得发 3 次请求，还得先知道有几条。

新增 `POST /tasks/:id/download`，响应：

```json
{
  "task_id": "1087...",
  "count": 2,
  "skipped": 1,
  "items": [
    { "index": 1, "url": "http://.../v1/files/...&sig=...", "filename": "task-1087...-1.png", "expires_in": 86400 },
    { "index": 2, "url": "https://cdn.example.test/remote.mp4", "filename": "task-1087...-2.mp4", "expires_in": 86400 }
  ],
  "expires_in": 86400
}
```

两个取舍值得写下来：

1. **空槽进 `skipped`，不是整单 404。** 一个任务的结果数组可能有三槽而只有两槽真的生成了
   （第三槽只有 `preview_uri`、没有 `uri`）。单条接口可以报「这条结果不存在」，
   批量接口不行 —— 一个空槽把整单打进 404，等于「部分成功」这件事表达不出来。
2. **每个 URL 独立 24h，与单条同口径。** 不为了批量改成更短或更长；
   `expires_in` 同时出现在顶层与每条里，客户端任取其一都不会错。

### 四、为什么那 12 条不补别名（与第 81 批的区别）

第 81 批给 kds 补了 8 条 POST 别名，这批却明确**不**给 `/task/*` 补单数别名。区别在「差的是什么」：

- kds 差的是 **METHOD**：`POST` 打到只有 `GET` 的路径上是 404，客户端**改不了**（它是按竞品 SDK 生成的）；
- task 差的是 **命名**：`/task/{id}` 换 `/tasks/{id}` 就能通，路径在客户端是配置项。

所以第 81 批补别名、这批登记偏离。守卫测试里两者对应两个不同的表：`DEVIATIONS`（有能力、形状不同，
必须给出 `ours` 指向真实存在的路由）与这批新加的 `WAIVED`（能力不在，必须写清缺哪个模型）。

**`WAIVED` 的设计约束**（不写清就退回补代码）：

```ts
const WAIVED: Record<string, string> = {
  "GET /task/is_first/interact":
    "no result-interaction model: task_events has no user_id column, so \"first interact of this user\" is not computable",
  "POST /task/result/folder": "tasks has no folder_id column and there is no task folder table",
  ...
};
```

守卫里断言：每条豁免的 reason **长度 > 20**、豁免的键**必须 ⊆ `TASK_SHAPES`**（豁免只对 #24 开放，
以后要扩域必须显式改这条断言）、且豁免与偏离不能重复登记同一条。

### 五、守卫与反向验证

`competitor-route-parity.spec.ts` 从「五组 133 条」扩到 **六组 150 条**（48 + 30 + 35 + 7 + 13 + 17），
新增用例断言 #24 的三分类恰好是 **1 同形 / 12 偏离 / 4 豁免**，三者相加等于 17。

反向验证（`_acceptance/_r82_break.py break|restore`）：把 `@Post("tasks/:id/download")` 改名成
`@Post("tasks/:id/download-BROKEN")`，立刻 **2 例红**，其中一条打印

```
deviation target missing: POST /task/{}/download → POST /tasks/{}/download: expected false to be true
```

—— 即「偏离表里登记的我方路由必须真实存在」这句话是活的，不是注释。改回即绿。

### 六、验证与数字

| 项 | 结果 |
|---|---|
| api typecheck / eslint | 干净 / 退出 0 |
| `competitor-route-parity.spec.ts` | 9 passed（+1 例 #24 三分类，+1 例死条目扩到豁免表） |
| `tasks-batch.spec.ts` | **14 passed**（原 11，+3 例 download） |
| api 全量 | **84 文件 937 例**（原 933） |
| 门禁 `verify-round.ps1` | **12/12 全绿**（api 真跑 169.90s，worker 61） |
| 端点 | 736 → **737** |
| 用例总数 | 1,334 → **1,338** |
| 全站 | 202.44 → **202.43**（剩余 3.56 → **3.57**） |
| B 类 | 0.735 → **0.745** |

### 七、诚实边界

1. **4 条豁免仍然是「没有的能力」**，只是记了账、不会被忘掉；它们要产品一句话决定「建不建模型」；
2. **12 条命名偏离不算缺口**，但客户端确实要按我方路径接（ADR-009 定的是命名权，不是兼容层）；
3. `GET /task` 的 `folder_id` / `is_star` / `request_type` 三个筛选项我方没有 —— 与豁免同源（依赖文件夹/收藏模型）；
4 守卫仍是**快照式**：竞品新增第 18 条 task 路由时，要人手动加进 `TASK_SHAPES`；
5. 本批**据实下调** #24 100% → 99%：99% 表示「能力面已经对完，差的是要决策的 0.01」，不是「做不下去了」。

---

## 变更登记（v6.35 · 第 81 批：审计「满分」模块 #21 数据看板 —— 13 条竞品路由里 8 条调的是 POST · 2026-10-28）

### 一、这批在回答什么问题

第 79、80 批把 #7 团队、#8 影视版、#10 活动/创作者三块 XL(20) 的「100%」都用竞品路由逐条对过了。
第 81 批继续查剩下的满分模块，先挑 **#21 数据看板**（`M(3)`，13 个端点）。问题很朴素：

> 我方 `kds.controller.ts` 有 13 条路由，竞品 `/web/v1/kds/da/*` 也有 13 条 —— 条数一样，是不是就等价？

不是。条数一样只说明**资源覆盖一样**，不说明**调用形状一样**。逐条对下来：

| 竞品形状 | 我方原状 | 判定 |
|---|---|---|
| `GET /kds/da/team/:team_id/basic-info` | `GET` 同路径 | ✅ |
| `GET /kds/da/team/:team_id/point-consume-rank` | `GET` 同路径 | ✅ |
| `GET /kds/da/team/:team_id/project-data/basic-info` | `GET` 同路径 | ✅ |
| `GET /kds/da/team/member/:op_user_id/point-consume-detail` | `GET` 同路径 | ✅ |
| `GET /kds/da/team/member/:op_user_id/point-quota-detail` | `GET` 同路径 | ✅ |
| `POST /kds/da/canvas/total-point-consume` | 只有 `GET` | ❌ 方法缺口 |
| `POST /kds/da/team/:team_id/member-participate-detail` | 只有 `GET` | ❌ |
| `POST /kds/da/team/:team_id/point-manage-flow` | 只有 `GET` | ❌ |
| `POST /kds/da/team/:team_id/project-data/query` | 只有 `GET` | ❌ |
| `POST /kds/da/team/:team_id/project-data/export` | 只有 `GET` | ❌ |
| `POST /kds/da/team/:team_id/project-member-point-detail` | 只有 `GET` | ❌ |
| `POST /kds/da/team/:team_id/query` | 只有 `GET` | ❌ |
| `POST /kds/da/team/:team_id/query/export` | 只有 `GET` | ❌ |

**8 条「竞品 POST / 我方 GET」。** 对按竞品形状写的客户端来说，`POST` 打到只有 `GET` 的路径上是 **404**
（Nest 的路由匹配含方法），不是「参数没传对」那种软失败 —— 看板页会直接白屏。

### 二、证据（为什么这不是风格差异）

竞品这 8 条在 `core-lib-CKH7gQsw.js` 里是逐字这样写的：

```js
ApiKdsDaCanvasTotalPointConsumePostRequestConfig = {
  path: "/web/v1/kds/da/canvas/total-point-consume",
  method: Method.POST,
  requestHeaders: {},
  requestBodyType: RequestBodyType.json,
  responseBodyType: ResponseBodyType.json,
  paramNames: [],
  queryNames: [],
  requestDataOptional: !1,
  requestDataJsonSchema: {},
  responseDataJsonSchema: {},
  requestFunctionName: "ApiKdsDaCanvasTotalPointConsumePOST",
}
```

三个细节决定了改法：

1. `method: Method.POST` + `requestDataOptional: !1` —— **必须发 POST，且必须带 body**；
2. `requestDataJsonSchema: {}` —— 形状**没有证据**，只能按「与 query 同构」自定（这一点写进 api-spec §17.38 的边界）；
3. 两条导出的 `responseBodyType: ResponseBodyType.raw` —— 返回的是**文件**，不是 JSON 信封，所以别名**不解析 body**。

### 三、改了什么（8 条别名，GET 全部保留）

| 别名 | 实现方式 |
|---|---|
| `POST canvas/total-point-consume` | body → `rangeQuery` → 同一个 service |
| `POST team/:team_id/member-participate-detail` | body → `rangePageQuery` |
| `POST team/:team_id/point-manage-flow` | body → `pageQuery` |
| `POST team/:team_id/project-data/query` | 抽出 `private projectDataQueryImpl(req, teamId, input)`，GET/POST 共用 |
| `POST team/:team_id/project-member-point-detail` | 抽出 `private projectMemberPointImpl(...)`，共用 |
| `POST team/:team_id/query` | 抽出 `private teamQueryImpl(...)`，共用 |
| `POST team/:team_id/query/export` | `@Res()` + `sendCsv`，**不解析 body** |
| `POST team/:team_id/project-data/export` | 同上 |

三个不显然的决定：

1. **不复制实现**。三条同名 GET/POST 的差异只在「输入从哪儿来」（`@Query()` 还是 `@Body()`），
   所以把查询体抽成 private 方法，两边都调它 —— 复制一遍 zod 与查询，下一次改字段就会漂移。
2. **`sendCsv` 里加 `reply.code(200)`**。Nest 对 `@Post` 默认回 **201**，导出会变成
   「201 Created + 一个 CSV」——同一个文件看起来像被「创建」了。导出永远是「取一份文件」。
3. **导出别名不解析 body**。竞品 body 形状无证据，且返回是 raw 文件；如果我去校验一个没人能证明的形状，
   只会在真实客户端传空 `{}` 时把导出打成 400101。

### 四、守卫：把「13 条」也钉进测试

`apps/api/test/competitor-route-parity.spec.ts` 原来内联四组 120 条（film 48 / crc 30 / op 35 / campaign 7），
本批新增 `KDS_SHAPES`（13 条）→ **五组 133 条**，并新增两条断言：

- `#21 数据看板：13 条全部覆盖（5 GET + 8 POST 别名，0 缺口、0 偏离）`；
- 首例里加两个锚点：`GET /kds/da/team/{}/query` 与 `POST /kds/da/team/{}/query` **都必须存在**（同路径双方法）。

反向验证：把 `@Post("team/:team_id/query")` 改名成 `team/:team_id/query-BROKEN` →
**2 例立刻红**并打印 `expected [ 'POST /kds/da/team/{}/query' ] to deeply equal []`；restore 后 8/8 绿。

### 五、功能用例（别名不能只是「路由存在」）

`apps/api/test/kds.spec.ts` 新增 1 例，验证四件事：

1. **GET 与 POST 返回同一份数据**：`canvas/total-point-consume`、`member-participate-detail`、
   `point-manage-flow`、`project-data/query`、`team query` 五组逐一 `toEqual`（POST 走 Nest 默认 201，契约以信封 `code` 为准）；
2. **校验共用**：`POST team/{}/query` 带 `{from:"not-a-timestamp"}` → 仍是 **400101**（不是「POST 就不校验」）；
3. **导出**：两条 POST 都返回 `content-type: text/csv`、`content-disposition` 指向正确文件名、body 以 BOM 开头；
4. **空间校验**：`team_id` 与 token 活动空间不一致 → 仍 **403101**。

### 六、验证与数字

| 项 | 结果 |
|---|---|
| `pnpm --filter @app/api typecheck` | 干净 |
| `npx eslint src`（api） | 退出 0 |
| `test/competitor-route-parity.spec.ts` | **8 passed**（原 7） |
| `test/kds.spec.ts` | **7 passed**（原 6） |
| api 全量 | **84 文件 933 例**（原 931） |
| 门禁 12 项 | **12/12 全绿**（api 真跑 163.97s） |
| 端点 | 728 → **736**（+8 别名） |
| 用例总数 | 1,332 → **1,334** |
| 分数 | **202.44 / 98.3% / 剩余 3.56 不变** |

### 七、诚实边界

1. **只补方法形状**，body 字段语义仍是「与 query 同构」的自定口径 —— 竞品 `requestDataJsonSchema` 是 `{}`，没有字段证据；
2. `project-data/query` 的**筛选参数依旧待取证**（竞品只给路由，没有 query/body 的名字）；
3. **本批不加分**：#21 本来就记 100%，这批的价值是「那个 100% 现在带守卫、且客户端形状真的能通」；
4. 剩下的满分模块（#1 首页、#24 任务、#26 分享、#27 运营后台、#28 架构）**尚未审计**；
5. 守卫仍是**快照式**：竞品新增第 14 条 kds 路由时，得有人手动把它加进 `KDS_SHAPES`，测试不会自己去拉。

---

## 变更登记（v6.34 · 第 80 批：把「100%」用 120 条竞品路由逐条对过，并固化成测试 · 2026-10-28）

### 一、这批要回答的问题

上一批（v6.33）审计 #7 团队时得出一个判断：**「100%」只应出现在「竞品路由逐条对过、一条不缺」的地方**。三个 XL(20) 里只查了一个，剩下 **#8 影视版** 与 **#10 活动/创作者** 仍是自证的 100%。这批把它们也逐条对一遍，而且不接受「对过一遍、写进文档、以后靠人记得」——**把对照固化成测试**。

### 二、对账结果（120 条 METHOD+path）

竞品来源 `_acceptance/competitor_endpoints.tsv`（904 行），四组：

| 组 | 竞品条数 | 我方 | 结论 |
|---|---:|---|---|
| `film` | 48（37 路径 / 48 操作） | `film.controller.ts` 50 + func-whitelist 1 | **只差 1 条**：竞品 `POST …/task-tables/:table_id/tasks/query`，我方只有同路径 GET |
| `crc` | 30 | `creator.controller.ts` 32 | 差 3 条，**全是方法差异**：`POST user/info`、`POST assets/me`、`POST file_preview`（竞品把查询写成 POST） |
| `op` | 35 | `op.controller.ts` 42 | 差 2 条 GET：`register-questionnaire`（我方 `GET /op/questionnaire` 是等价物）、**`beta-questionnaire`（真缺口）** |
| `campaign` | 7 | `campaign.controller.ts` 9 | **全部是命名偏离**：竞品单数 `campaign` 且不带资源 id，我方 `campaigns` + `:id`（ADR-009 已登记） |

**`GET /op/beta-questionnaire` 是本批唯一的真能力缺口**：我方只有「提交内测申请表」（`POST beta-questionnaire`）和「是否已填」（`GET beta-questionnaire/check`），却没有「取内测申请表的题目定义」。前端要渲染这张表，只能把题目**写死在页面里**——题目一改就得发版，而且 `beta-questionnaire-abroad` 的题面与国内不同，写死等于两份真相。

### 三、补了什么（6 条别名）

| 域 | 新增 | 怎么实现 |
|---|---|---|
| film | `POST …/task-tables/:table_id/tasks/query` | body 直接是 `{filters, sorts, roots_only, page, page_size}`，不需要 GET 那层把 `filters`/`sorts` 当 **JSON 字符串**塞进 query 转义；两条走同一个 `filmTaskQuerySchema` |
| crc | `POST user/info` | body 忽略，直接 `profileInfo(ctx)` |
| crc | `POST assets/me` | GET 与 POST **复用同一个 `myAssetsSchema`**（注释写明：复制一份 zod 之后两边必然漂移） |
| crc | `POST file_preview` | `body.id ?? query.id`，两条都缺仍然 400101 |
| op | `GET register-questionnaire` | `survey.view(ctx, "register")`，与旧 `GET /op/questionnaire` 同构（不删旧路径，外部已有调用方） |
| op | `GET beta-questionnaire` | `survey.view(ctx, "beta")` —— **真缺口** |

端点 722 → **728**。

### 四、为什么把对照做成测试，而不是再写一遍文档

文档会漂移，测试不会。新增 `apps/api/test/competitor-route-parity.spec.ts`（**7 例**）：

1. 路由表 > 600 且 6 个锚点存在（含本批新增的 4 条）；
2. 四组条数与台账口径一致（48 / 30 / 35 / 7，合计 120，且**组内无重复形状**）；
3–5. film / crc / op 三组**零缺口**；
6. campaign 的 7 条全部落在偏离表里，且每条理由长度 > 10；
7. **偏离表无死条目**。

其中最关键的一条设计：偏离表登记的是「竞品形状 → 我方形状」，测试除了断言「这条竞品形状允许缺失」，还断言 **`ours` 那条形状必须真的存在**。否则白名单会变成万能橡皮擦——写一句「这是命名偏离」，就能让任何缺失消失。

### 五、反向验证

把 `op.controller.ts` 的 `@Get("beta-questionnaire")` 改名成 `@Get("beta-questionnaire-BROKEN")` → **2 例立刻红**，打印 `expected [ 'GET /op/beta-questionnaire' ] to deeply equal []`；改回即绿。这说明守卫真的在盯路由，而不是盯一个常量。

功能层面另加 2 例（不是「路由存在」就算过）：
- `crc.spec.ts`：GET 与 POST 三组返回**深等**（`user/info`、`assets/me?page=1&page_size=10` vs body、`file_preview?id=` vs `{id}`），POST 空 body 仍 400101；
- `op.spec.ts`：`GET register-questionnaire` 与旧 `GET questionnaire` 深等；`GET beta-questionnaire` 的 `questionnaire.id === "beta"` 且 `questions` 非空。

### 六、验证

| 项 | 结果 |
|---|---|
| `crc.spec.ts` + `op.spec.ts` | 17 + 18 = **35 passed** |
| api 全量 | **84 文件 931 例**（原 83 / 922；+7 守卫 +1 crc +1 op） |
| 用例总数 | 1,323 → **1,332** |
| 门禁 12 项 | **12/12 全绿**（api 真跑 170.83s，其余 11 cached） |
| `-ScaleOnly` | endpoints **728**、controller 52、迁移 45、cli 204（38 组）不变 |
| `scoreboard.py` | **202.44 / 206 = 98.3% / 剩余 3.56 —— 不变** |

### 七、诚实边界

1. **只比 METHOD + path，不比 query/body 语义**。同一条路径、两边字段名不同，这套测试看不见——它抓到的是「路由层缺失」，不是「契约层不一致」。
2. **campaign 的 7 条仍是形状偏离**，只是「已登记且登记项必须自证」，不是「已对齐」。要不要真的加 `/campaign/*` 单数别名，属 API 风格决策（ADR-009），本批不改。
3. **本批不加分**。#8 与 #10 原本就记 100%，这批的价值是让那个 100% 从「自证」变成「可复跑的对账」；唯一的真能力缺口（`GET beta-questionnaire`）落在本来就计满的模块里，按现行权重表表达不出来——**这正是权重粒度的问题，不是分数的诚实性问题**，已在 §5.5 记录。
4. 守卫测试内联了 120 条竞品形状。竞品更新后这批常量会变成**过期快照**——它保证「不比昨天差」，不保证「和今天的竞品一样」。真正的对账仍需重跑 `competitor_endpoints.tsv` 的抽取脚本。


## 变更登记（v6.33 · 第 79 批：审计「满分」模块 —— #7 团队的 100% 是拿自己的 33 条当全集 · 2026-10-28）

> 这一批不补缺口，**怀疑自己的账**。上一批收尾时提过一个疑点：11 个模块标着 100%，其中三个 XL(20)（团队 #7 / 影视版 #8 / 活动创作者 #10）占了 60 权重。100% 只应出现在「竞品路由逐条对过、一条不缺」的地方——那就去对。

### 一、怎么查的，以及为什么「跑个 diff」不管用

先试机械比对（`_acceptance/_r79_cam_diff.py`，把竞品 `/web/v1/cam/*` 的 40 条路径与我方 `team.controller.ts` 的 33 条按归一化路径比）：

| 做法 | 结果 | 为什么不行 |
|---|---|---|
| 归一 `:param` 后比路径 | **40 条全判成缺失** | 竞品路径带 `team/:team_id` 前缀、参数叫 `member_id`；我方是扁平路径 + 叫 `user_id`。命名体系不同，机械比对只会给出 100% 假阳性 |

所以改成**逐条人工对照**（40 条竞品路由 × 我方 33 条端点，一条一条读语义）。结论：**12 条确实没有**。

| 类别 | 条数 | 竞品路由 |
|---|---:|---|
| BYOK 第三方 Key | 5 | `GET/POST /cam/user/third/key/{list,add}`、`GET/PUT/DELETE /cam/user/third/key/:id/{info,update,delete}` |
| 项目关联用户 | 1 | `GET /cam/linked-users?sp_id` |
| 项目维度积分 | 3 | `GET /cam/team/project-points-flow/{list,export}`、`POST /cam/team/project-points-ranking` |
| 子账号密码 / 凭据 | 3 | `PUT /cam/team/:team_id/member/:member_id/password`、`POST .../member/batch/change-password`、`GET .../member/:member_id/credential` |

证据强度也要说清：这 12 条在竞品 bundle（`core-lib-CKH7gQsw.js`，1,100,087 B）里都能找到 `requestConfig`，但 **`requestDataJsonSchema:{}` / `responseDataJsonSchema:{}` 全空**——只有路由与 query 名，没有字段形状。与我方第 73/75 批的处理口径一致：形状自定、在 api-spec 登记。

### 二、补的 10 条：两条「有表没入口」的发现

- **BYOK 5 条 —— 表早就建好了，只是没人写过**：`packages/db/src/schema.ts:889` 的 `userThirdKeys`（`provider`/`label`/`keyCipher`/`keyHash`/`status`）在**迁移 0013** 就建了表，`team.service.ts:14` 也 import 了它，但全仓**只有 `tempInfo` 读过一次**（`count(*)` 用来派发 `api_key_white` 权益）。有表、无写入口——正是「看起来支持 BYOK，其实只能看数量」的典型。
- **成员凭据 1 条 —— 诚实实现而不是造一个假的**：竞品的 `credential` 配合子账号密码体系才有意义。我方返回 `{login_methods:[{provider, account_masked}], has_password:false, can_reset_password:false, note:"members sign in with their own phone number; this build has no sub-account password"}`——**显式说没有**，而不是回一个空密码字段让人以为能改。

### 三、三个不显然的决定

| 决定 | 反面 | 理由 |
|---|---|---|
| BYOK **明文永不回传**（`api_key_masked` 由解密后打码得出，解密失败退 `******`） | 回传明文最省事 | 凭据一旦能读出，前端 XSS 就等于拿到密钥；打码足够让用户认出「是哪一把 key」 |
| BYOK **只能看自己的**（`and(spaceId, userId)`），团队管理员也不行 | 管理员能导出团队成员的 key 便于排障 | 排障需求可以由「成员自己看」满足；让管理员能导出等于把「个人凭据」变成「团队资产」 |
| BYOK **硬删**（`DELETE` 真删行） | 软删保留审计 | 注释写在这里：「这是凭据，软删等于密文还在库里；要停用请 PUT status=2」。停用与删除是两件事 |

另外两条口径：

- **项目维度积分只算 `settle`**：`credit_flows` 里有 `recharge/gift/freeze/settle/unfreeze/adjust/refund`，项目维度的「消耗」只应含 `settle`；冻结/解冻是过程量，算进去会重复计。
- **归不上项目的行保留 `project_id:null`，不丢**：`credit_flows.ref_task_id → tasks.episode_id → episodes.project_id`，任务可能已被删或从未关联剧集。**如果按 join 过滤掉，账目合计会少于真实消耗**——所以列表里保留这些行并标 null，前端可以单列「未归属」。

### 四、留的 2 条：为什么是「产品口径」而不是「没做」

竞品的子账号密码（`member/:id/password`、`member/batch/change-password`）背后是「一个账号下多个子账号」的模型。我方团队模型是**手机号邀请真实用户**（`addMembers` 按 `identities.phoneHash` 查人，默认 `role_code="project_executor"`），没有子账号体系——只存一个密码哈希而无登录路径就是**死代码**，做了也不会被用到。所以判 **B 类（产品一句话）0.10**，而不是硬凑一个端点。

### 五、分数据实下调（这一批唯一动分数的地方，而且是往下）

| 项 | 之前 | 现在 | 说明 |
|---|---:|---:|---|
| #7 团队 | 100% / 20.00 | **99.5% / 19.90** | 12 条缺失里补了 10 条，留 2 条 B 类 |
| 生态组 | 94.95 | **94.85** | #7 属生态组（权重 96，10 个模块） |
| 全站 | 202.54 | **202.44** | 权重 206 |
| 剩余 | 3.46 | **3.56** | 98.3% → 98.3%（四舍五入不变） |
| 首发口径 | 130.59 / 98.2% | **130.49 / 98.1%** | #7 保留在首发口径内 |
| B 类总额 | 0.635 | **0.735** | E 仍 2.83、I 仍 0 |

**为什么不「补完 10 条就当 100%」**：剩下 2 条是真缺口，只是解法要产品先定。把 100% 留着会让台账在最需要准确的地方撒谎——*发现缺口就据实降分*，这是这份台账唯一的价值。

### 六、验证

| 项 | 结果 |
|---|---|
| `app/apps/api/test/team-byok-points.spec.ts` | **6 例全绿**（BYOK 全链含打码/查重/跨用户不可见/硬删；linked-users；成员凭据；项目维度积分筛选与分页；排行聚合与 limit；CSV 导出） |
| 反向验证 | `_r79_break.py break` 在 DTO 里塞 `leaked_plain` → **1 例红**（`expected true to be false`）；`restore` 后 6/6 绿 |
| api 全量 | 83 文件 **922 例**（原 82/916）；总用例 1,317 → **1,323** |
| 规模 | endpoints **712 → 722**；controllers 52 / migrations 45 / tables 112 / cli 204 不变 |
| 门禁 | `pwsh _acceptance\verify-round.ps1` → **12/12 全绿**（`Cached: 11 cached`，只有 cli 真跑） |

### 七、诚实边界

1. 竞品这 12 条的响应体形状**全部无证据**（`requestDataJsonSchema` 是 `{}`），字段是我方自定的，已在 api-spec §17.36 逐条登记；
2. **只审计了 #7**。同为 XL(20) 的**影视版 #8（100%）与活动/创作者 #10（100%）尚未做同样的逐条审计**——按本批的发现方式，它们同样可能把「我实现的条数」当成全集。这是下一批的活。
3. 子账号密码 2 条未实现（B 类），成员凭据因此显式 `has_password:false`；
4. 项目维度积分的 `project_title` 依赖 `script_projects.title`，影视版项目（`project_kind=2`）不在 `team_member_projects` 的脚本口径内，`linked-users` 默认只列 `project_kind=1`；
5. `sp_type` 这类字段仍是「只透传不解释」。


## 变更登记（v6.32 · 第 78 批：#9 的 `agent enter`/`run` —— 「SSE 未接」不是缺能力，是缺客户端 · 2026-10-28）

**一句话**：CLI 有两条骨架命令的 reason 写着「交互式 REPL 未实现」「`POST /agent/task/chat` 是 SSE 流（CLI 未接流式）」，但后端这两个端点早就在；
这一批补的是**客户端**，并且顺手抓到一个只在真实网络下才暴露的 bug：拿到终态后不切断 SSE，Node 进程会挂着不退。

### 一、缺口长什么样

| 命令 | 骨架 reason 原文 | 实际情况 |
|---|---|---|
| `agent enter SESSION_ID` | 「交互式 REPL 未实现；用 `agent session-create` + `POST …/messages`」 | 会话事件流 `GET /canvas/chat/sessions/{sid}/stream` 一直在；缺的是「读一行 → 发一条 → 跟流」的循环 |
| `agent run SESSION_ID` | 「`POST /agent/task/chat` 是 SSE 流（CLI 未接流式）；非交互场景用 canvas chat 的 REST 消息端点」 | `POST /agent/task/chat` 投递即返回 `{message_id, stream_id, queued}`，回合在后台跑；事件从上面那条 SSE 出来 |

竞品 `commands/agent.md` 有五个动词（session create/list/delete、`enter`、`exit`、`run --follow`）；我方 `enter`/`run` 是骨架，`exit`（= `POST agent/task/chat-end`）压根没登记。

### 二、为什么不能复用现有的 `Transport`

`apps/cli/src/http.ts` 的传输层刻意只回 `{status, body:string}` ——**一次读完、再 JSON.parse**，因为除 SSE 外所有端点都是「一个信封」。
把它改成流式会让 200 多个命令都变成「先拼完再解析」，那正是这批要修的问题的反面。所以新增的是**另一条通道**：

| 关注点 | `Transport`（既有） | `StreamHandle`（本批新增） |
|---|---|---|
| 返回 | `{status, body}` | `{status, chunks: AsyncIterable<string>, cancel?}` |
| 生命周期 | 请求-响应即结束 | 长连接，直到终态/超时/断开 |
| 谁负责解析 | `ApiClient.call()` 直接 `JSON.parse` | `SseDecoder` 按 `\n\n` 切帧 |
| 测试注入 | `harness({transport})` | `harness({stream, lines})` |

### 三、改了什么

1. `runtime.ts`：`StreamHandle` / `StreamOpener` + `readLine()` 两个注入点（`fetch` + `getReader` + `TextDecoder(stream:true)`；`createInterface({crlfDelay: Infinity})` 让 Windows 的 `\r\n` 只当一个换行）。
2. `http.ts`：`ApiClient.streamRequest()` —— **只拼 URL 与头，不发请求**（`accept: text/event-stream`、`authorization`、`x-space-id`），交给 `runtime.openStream`。
3. 新文件 `apps/cli/src/agent.ts`：
   - `SseDecoder`：缓冲到 `\n\n` 才派发（网络分块与帧边界无关）；多行 `data` 用换行拼；`: 注释` 与「无 data 的帧」跳过；`JSON.parse` 失败给 `json:null` 而不抛（非 JSON 的 data 仍能把原文展示给用户）。
   - `followSession()`：`Promise.race([iterator.next(), timeout])`；终态四选一 **`agent_message` / `error` / `timeout` / `closed`**；`ping` 记帧但不影响终态（否则 15s 心跳会被误当响应）。
4. `builtins.ts`：`agentRun`（`--set content=`/`prompt=`；无 `--follow` 只投递并回 `followed:false` + `hint`；有则跟流，`error`→退出码 4、`timeout`→退出码 6）+ `agentEnter`（最小 REPL：`/exit`|`/quit`、`/help`、`/session`；逐帧进度与提示全走 stderr，stdout 仍只出**一个**信封）。
5. `registry.ts`：两条 `todo`→`local`，并补竞品有而我方缺的 `agent exit` → `POST agent/task/chat-end`。命令 203→**204**、ready 161→**164**、骨架 42→**40**。

### 四、抓到的真 bug：信封打完了，进程不退

拿到 `agent_message` 后，`followSession` 只是「不再读」那条连接。真实环境里 `reader.read()` 仍挂在 socket 上，Node 因此不退出 ——
症状是**命令把 JSON 打到 stdout 了，shell 却一直不回来**（第一版实测 180s 没退）。单元测试里注入的是「立刻 EOF 的流」，压根碰不到这条路径。

修法：
- `StreamHandle.cancel?: () => void`，默认实现用 `AbortController` 传给 `fetch`，`iterate()` 里把 `AbortError` 当正常收尾吞掉；
- `followSession` 的 `finally` **先 `cancel()`**，再 fire-and-forget `iterator.return()`（**不 await**：挂起的 read 会让 `await` 永不返回，正好把「到点超时」变成「一直等下去」）；
- 补一例回归断言：每条跟随用例都必须 `streamCancels === 1`。

### 五、验证

| 层 | 结果 |
|---|---|
| `SseDecoder` | 4 例：跨块拼接 / 一块多帧 + CRLF / 多行 data + 注释 + 无 data 不派发 / `flush` 兜底 |
| `agent run` | 5 例：只投递（断言 body `{session_id, content}`）/ `--follow` 拿到 `agent_message` 与帧序列、URL 带 `last_stream_id`、stderr 有 `[thinking]`/`[reply]` / `error` 事件→退出码 **4** / `--timeout 30ms` 挂死流→退出码 **6** / 缺 content→退出码 **2** 且零请求 |
| `agent enter` | 3 例：REPL 一轮（`/session`、`/help`、`/exit`）+ 只出一个信封 / EOF 也算正常退出 / 缺 SESSION_ID→2 |
| `followSession` 直调 | 1 例：立刻 EOF→`closed`，不编造 reply |
| 反向验证 | 去掉 `cancel()`→「进程不退出」的断言红；`error` 分支退出码改回 0→对应用例红 |
| cli 总量 | 105→**118** 例；`registry-routes.spec.ts` 仍绿（三条新路径都对上后端 controller） |
| 总闸 | 12/12 全绿；`_r65_cli_audit.py` ready 路径缺 0；`_r66_web_audit.py` 408/408 |
| 真链路 | 起 3002 栈 → 真登录 → 建画布+会话 → `agent run --follow` 收到 `model_step`+`agent_message` 且**进程正常退出**；REPL 一轮问答；`agent exit` 后 `session list` 显示 `status=2` |

### 六、诚实边界

- REPL 只做「一行一句 + 三个命令」，不做历史翻阅/编辑 —— 再加就会变成半个 TUI，而 Skill 的用途是让 agent 调命令行；
- `--ndjson` 目前只是 `--json` 的别名（没有真正的逐行 NDJSON 输出）；
- 不做自动重连：`last_stream_id` 支持游标续传，但连接断了要用户重跑；
- 额度/模型错误被服务端当 `error` 事件推，CLI 统一映射到退出码 4（`task_failed`），不细分；
- 测的是 mock LLM 的回合（`LLM_MODE=mock`）；真实模型下「一轮多久」取决于上游，`--timeout` 默认 120s 可能偏短。

## 变更登记（v6.31 · 第 77 批：#3 剧集分镜「真 ffmpeg 切片裁剪」—— zip 包里写的时长，从来不是包里视频的时长 · 2026-10-28）

### 一、缺口长什么样（台账原话）

`docs/07-plan/implement-progress-vs-reelmate.md` 的 #3 行缺口栏、以及 §5.5 表 A 的判据栏，写的是同一句话：

> `quality-check` 评分口径自建（竞品只有路由、无响应字段证据）；**真 ffmpeg 切片裁剪待 worker handler**。

第二句被判成 **I 类（内部可做、只是没排期）**，占 #3 剩余 0.15 里的 0.02。

### 二、为什么「要新增 handler」这个判断不准

这句话是我自己写的，复核时发现它把两件不同的事当成了同一件：

| 通道 | 谁在裁 | 状态 |
|---|---|---|
| **成片合成**（`app/apps/worker/src/timeline-export.ts:82-130`） | `normalizeSegment` 用 `-t String(durationS)` 真裁，`mockSegment` 用 lavfi 造对应时长 | 早就裁了 |
| **切片发布**（#20，第 57 批） | `publish.transcode` 异步下沉 worker，`PUBLISH_TRANSCODE_MODE` | 早就裁了 |
| **整集导出 zip**（`app/apps/worker/src/export.ts`） | `zip.file(fileName, await readResult(...))` —— **原样复制** | 没裁 |

第三条才是真缺口，而且它比「没裁」更难受：`manifest.json` 里每个镜头一直写着 `duration_s: shot.durationS`，
可那个 mp4 文件是生成模型的原始产物，长度是模型自己定的。于是**「包里写的时长」和「包里视频的实际时长」
是两回事** —— 下游拿到 zip 后按 manifest 拼片，会得到一段对不齐的片子，而且没有任何地方看得出「这包没裁」。

### 三、改了什么

新增 `trimShotBuffer(source, durationS)`（`app/apps/worker/src/export.ts`）：

| 输入 | 行为 | manifest 记什么 |
|---|---|---|
| `durationS` 为空 / 非有限 / ≤0 | **不裁**，原样写入 | `mode:"copy"`、`reason:"storyboard has no authored duration to trim to"` |
| `1..30` 秒（与 `storyboards.duration_s` 契约一致） | `trimVideoBuffer(source, 0, authored*1000)` | 成功 `mode:"ffmpeg"`、`file_duration_s: authored`；失败 `mode:"copy"` + ffmpeg 给的原因 |
| 超出 1..30 | 先 `clamp(round(x), 1, 30)` 再裁 | 同上（`file_duration_s` 记钳位后的值） |

manifest 新增两层留痕（都是**追加字段**，老消费者不受影响）：

- 汇总：`clip_trim: { mode: "ffmpeg" | "copy" | "mixed", trimmed, copied, reasons[] }`
- 逐镜：`file_duration_s`、`file_duration_mode`、`trim_reason`、`source_bytes`、`file_bytes`

另外 `app/apps/worker/src/main.ts` 新增 `episodeExportDeps`（含 `ffmpegPath: process.env.FFMPEG_PATH`）——
此前 zip 通道的 deps 只有 `db/storage/log`，**根本拿不到 ffmpeg 路径**，这也是它一直只复制的原因之一。

### 四、三个不显然的决定

1. **不猜时长**：分镜表没写时长的镜头，宁可原样交付也不裁 1 秒。猜出来的时长会**静默截短用户的片子**，
   而「包里多了 3 秒」比「内容被砍掉」容易发现得多。
2. **失败不失败**：与 #20 的切片发布同一套诚实降级口径 —— 部署机没有 ffmpeg 时导出仍要能出包（复制），
   但必须让人从 manifest 的 `clip_trim.mode` 看出「这一包没裁」。`runExport` 不会因为裁剪失败而转 FAILED。
3. **注入点**：`ExportDeps.trim` 是给测试用的，让「裁 / 不裁 / 降级」三条分支都能在**没有 ffmpeg 的机器**上测，
   真 ffmpeg 的两例才 `skipIf`。否则这类逻辑在 CI 里只能测到「复制」一条路。

### 五、验证

| 项 | 结果 |
|---|---|
| `apps/worker/test/export-trim.spec.ts` | **9 例全绿**（4 例 `trimShotBuffer` 注入点 + 5 例 DB 端到端，其中 2 例真 ffmpeg） |
| 真 ffmpeg 端到端 | 源 5s → 分镜 2s → zip 内文件 ffprobe ≈2s（断言 1.5–2.6s） |
| 反向验证 | 把 `trimShotBuffer` 强制返回 copy → **7 例红**（`expected 'copy' to be 'ffmpeg'`），改回即绿 |
| worker 全量 | 10 文件 **61 例**（原 9 文件 52 例） |
| 总闸 | `pwsh _acceptance/verify-round.ps1` → **12/12 全绿** |
| 规模 | endpoints 712 / migrations 45 / tables 112 均不变；用例合计 1,295 → **1,304** |

### 六、诚实边界

- 只改**整集导出 zip 通道的文件内容**；`quality-check` 评分口径（竞品 `ApiDfEpisodeEpIdQualityCheckPostRequestConfig`
  的 `requestDataJsonSchema` 是空对象）仍是 **E 类 0.13**，本批不动。
- 裁的是**首尾对齐**的前 N 秒（`-ss 0 -to N`），不做智能选段 / 场景检测。
- `file_duration_s` 表达的是「我们要求裁到多久」；ffmpeg 输出受帧对齐影响有毫秒级差异，所以测试按区间断言而不是等值。
- 本批**加分 0.02**（#3 95% → 95.7%，全站 202.52/206），来源是「缺口栏里那条 I 类真的消失了」，
  不是把权重或完成度四舍五入。

## 变更登记（v6.30 · 第 76 批：#19 3D 导演台「真实双人协同」—— 两个真浏览器，不是 Redis 里的一行心跳 · 2026-10-28）

### 一、缺口长什么样

第 74 批核账把 #19 的 0.03 判成 **I（内部可做、只是没排期）**，缺口栏原文：

> 真实双人协同（只验单浏览器+Redis 造第二人）

换言之：**产品能力是有的、接口是有的、前端是有的**，但"两个人在同一个场景里同时编辑"这件事，
从来没在真浏览器里跑过一遍。这种缺口最容易被误当成"已完成"，因为所有单项测试都是绿的。

### 二、为什么「单浏览器 + Redis 造第二人」不算

既有 `_acceptance/e2e-director.cjs`（17 项断言，已入库）确实验了冲突与协作者，但手法是：

| 要验的东西 | 旧脚本怎么造 | 造得出来的部分 | 造不出来的部分 |
|---|---|---|---|
| 版本冲突 | 用 API 直接把服务端推到 v2，再在同一个页面保存 | 前端拿到 746002 后弹冲突条、两个按钮可用 | 真实两个人的两个页面是否都处于"同一个场景" |
| 谁在线 | 用 Redis 写一条别人的心跳 | 心跳接口的读取与过滤逻辑 | 心跳是否真的由另一个**登录用户**发出、成员关系与活动空间是否成立 |

两次都是"我造了服务端状态，再看前端反应"，**没有人真的以第二个人身份在线**。
最可能坏的地方恰好被绕过了：成员有没有真的加进空间、第二个人有没有真的切到同一个空间、
两个页面看到的是不是同一条场景。

### 三、这条链路上真正可能坏的五件事

1. **成员加入**：`POST /cam/team/member/batch`（`apps/api/src/modules/team/team.service.ts:247`）
   —— 按手机号查 `identities.phoneHash`，未注册返回 `phone not registered`；已在空间返回 `already a member`。
2. **活动空间切换**：服务端 `apps/api/src/common/auth.guard.ts:63-94` 用请求头 `X-Space-Id` 校验
   `space_members.status=1` 且空间未停用，不合法 403 `not_member`/`space_disabled`；
   前端 `apps/web/composables/useActiveSpace.ts` 把活动空间存 `localStorage["active_space_id"]`，
   由 `apps/web/plugins/active-space.client.ts` 启动时同步进 `useState`。
   —— 这两半只要有一半不生效，第二个人看到的就是"项目不存在"。
3. **双向心跳**：`director:hb:<sceneId>` 一个场景一个 Redis HASH（field = user_id，TTL 60s+1），
   响应给 `last_seen_ms`（距今毫秒，客户端不必处理时钟偏差）；**A 看见 B、B 看见 A 都要成立**。
4. **乐观锁**：`PUT /director/scenes/:id` 版本不符 → `746002`，msg `scene version conflict: current=N`。
5. **覆盖后的版本**：前端 `overwriteConflict()` 先 `GET` 取服务端版本、把本地 version 改成服务端值再保存
   —— 所以"覆盖服务端"之后服务端版本是 **v+1（v3）**，不是 v2。这条是时序细节，写错就会误判成 bug。

### 四、两个真问题（都是我脚本写错，不是产品缺陷）

| # | 现象 | 真相 | 教训 |
|---|---|---|---|
| 1 | `GET /v1/auth/me` 返回 `404 {"code":400102,"msg":"Cannot GET /v1/auth/me"}`，且 `me()` 无 auth 时返回 `null` → 「登录成功但拿不到 user/space」 | 端点是 **`GET /v1/me`**（`AuthController` 是 `@Controller()`，无 `auth/` 前缀，`auth.controller.ts:120`） | 客户端/脚本要拿"我是谁"，别按模块名猜路径；已写进 api-spec §17.33 的契约表 |
| 2 | A 先开导演台、B 后开，A 的协作者浮层一直是空的 | `syncFromServer()` 里 `heartbeat()` 在 `loadLatest()` **之后**，而 `heartbeat()` 开头是 `if (!sceneId.value) return;` —— **首次打开时场景还不存在**，心跳安静返回 | "打开即心跳"只在**场景已存在**时成立；E2E 必须让 A **关闭再打开**（触发新一跳心跳），不能等 30s 定时器 |

### 五、验证

新增 `_acceptance/e2e-director-collab.cjs`（已入 `.gitignore` 白名单，是仓库产物）：两个真账号、
两个隔离 `browser.newContext()`，**23 项断言全绿**。

| 段 | 验的东西 | 断言数 |
|---|---|---:|
| S1 | 两个账号、两个隔离上下文、`/v1/me` 的 user/space 两两不同 | 2 |
| S2 | A 建项目 + 拉 B 进空间；**反证** B 不带 `X-Space-Id` 读不到该项目（400102）；B 前端写 `localStorage` 后能打开同一项目页 | 5 |
| S3 | A 打开导演台保存 → UI「已保存 v1」，API 交叉核对 `version=1` 且 payload 形状正确 | 4 |
| S4 | B 读到 v1；A 重开后 UI 出现「👥 1 人在编辑」+「用户XXXX（Ns 前）」；**双向** API 心跳互见 | 5 |
| S5 | B 推到 v2；A 用旧版本保存 → 冲突条提示 v2；点「覆盖服务端」→「已保存 v3」、冲突条消失、API `version=3` | 6 |
| S6 | 两个页面控制台无未预期错误 | 1 |

运行方式（栈 = api:3002 / web:3003）：

```powershell
pwsh _acceptance/start-wanxing-stack.ps1
node _acceptance/e2e-director-collab.cjs
```

产物：`_acceptance/director-collab-e2e/result.json` + 4 张截图（A 存 v1 / A 看见 B / A 撞冲突 / A 覆盖为 v3）。
`_acceptance/_team/report-director.md` 追加 §6 记录本次补做。

### 六、诚实边界

- **本轮不动任何产品源码**（无迁移、无端点变化、无前端改动）——补的是"证明"，不是"能力"。
  因此门禁 12/12 全绿、且 12 个任务全部命中缓存是正确的（`Cached: 12 cached, 12 total`）。
- 分数会动（#19 99% → 100%、全站 202.47 → 202.50，剩余 3.50），原因不是"又写了一个功能"，
  而是**第 74 批已判定"代码侧不缺、缺的是证明"的那一格被证明掉了**。
- 3D 视觉仍不做像素级比对（验收口径是"结构等价 + 关键对象计数"，第 53 批已定并保留）；
  骨骼/位姿的真实动画观感不在自动断言范围内。
- 脚本依赖 `_acceptance/node_modules/playwright-core`（未进任何 `package.json`）与固定 Chromium 路径，
  属于本地验收工具链；换机器需先装这两样才能复跑。


## 变更登记（v6.29 · 第 75 批：#18 知识库「条目级字段」—— 证据是竞品自己的 payload builder · 2026-10-28）

> 上一批（第 74 批）核账之后，代码侧「不需要任何外部输入、只是没排期」的只剩 **0.085**：#18 知识库条目级字段 0.015、#19 双浏览器 E2E 0.03、#3 真 ffmpeg 切片 0.02、#9 agent REPL/SSE 0.02。
> 本批先清掉其中**证据最硬的一块**——知识库条目级字段 0.015，让 #18 从 99.5% 到 100%。

### 一、证据不是「猜字段名」，是竞品自己拼请求的那段代码

`knowledge_assets` 原来只有 `title`/`content`/`tags`/`sourceType`/`scene` 这些「我方想得到」的字段。竞品条目到底还有什么？去它的前端 bundle 里找**组装请求的那段函数**，比找 schema 靠谱：

```js
// ArT8U6Tg.js（3,668 B）里的 payload builder，逐字
const L = (e) => ({
  uk_id: e.uk_id || "",
  scene: O(i) ? i : o.Style,
  status: N(e.status) ? e.status : h.Enabled,
  use_type: e.use_type === g.Team ? g.Team : g.Official,
  sp_type: e.sp_type || 0,
  prompt_template: e.prompt_template || "",
  cover_file: k || y[0] || "",          // ← 没有人工封面就取首图
  image_files: y, origin_image_files: I,
  orgin_cover_file: b,                  // ← 竞品自己把 origin 拼错了，两处兜底
  meta_data: F,                         // ← 网络上是 JSON 字符串
  sort: e.sort || 0, ... })
```

两个枚举在 `0zWWdXb_.js`（6,097 B）里：`status = {Enabled:1, Disabled:2}`、`use_type = {Official:1, Team:2}`。
顺带**纠正台账一处笔误**：第 74 批把 `Official/Team` 记成了 `status` 的取值，实际它是 `use_type`（`ArT8U6Tg.js` 里两个字段同时出现，且新建默认 `use_type: u.Team`）。

### 二、改了哪 8 列，以及三个不显然的决定

| 列 | 对应竞品 | 我方决定 |
|---|---|---|
| `cover_asset_id` | `cover_file` | 存 **asset id** 不存 URL（外键 `ON DELETE set null`；存 URL 的话签名过期就是死链） |
| `image_asset_ids bigint[]` | `image_files` | **不建关联表**：竞品就是一个有序 id 列表、图片没有条目级属性；代价是元素无外键 |
| `use_type` / `status` / `sp_type` / `res_type` | 同名 | 默认值取竞品语义：`use_type=2`(Team)、`status=1`(Enabled) |
| `meta_data jsonb` | `meta_data`（字符串） | **刻意偏离**：库里存 jsonb（可查可索引），出参给对象；竞品发字符串只是因为前端懒 |
| `sort` | `sort` | 列表默认 `sort asc, created_at desc`；全 0 时行为与旧版一致 |

三个不显然的决定：
1. **封面回落放进 shared，不放进 service**：`knowledgeCoverAssetId()` 复刻 `cover_file: k||y[0]||""`，DTO 额外给 `cover_is_fallback`——让前端知道「这张封面是兜底来的」，将来要做「换封面」时不会误以为用户设过。
2. **封面/配图校验跨空间返 400102，不返 400101**：400101 会告诉调用方「这个 id 格式对但不存在于本空间」，配合「在别处存在」就能探测别人的资产 id；400102 只说「找不到」。
3. **`patchAsset` 的封面必填校验拿「合并后的值」**：只改标题时如果只看入参，`cover_asset_id` 是 `undefined`，会被 scene 3/4 的必填规则误判——这类 bug 只有「先 PATCH 一次标题」的用例能抓到。

### 三、为什么 `res_type` 是补账时才发现的

主台账 #18 缺口栏原文列了 6 个字段，其中 `res_type` 我方一直没落。用 token 扫 607 个 bundle 文件（30 处命中）确认它确实是**条目级**字段：竞品列表请求带 `res_type: t.type || void 0`、条目映射 `res_type: Number(je.res_type ?? 0)`、白名单 `["generate_image_type","res_type","style_templete",…]`。
→ 迁移 **0044** 单独补这一列。**教训与第 73 批同一条**：缺口清单里的字段名要逐个对着证据核一遍，不能「看到清单就以为齐了」。

### 四、验证

| 项 | 结果 |
|---|---|
| 新用例外 | `knowledge.spec.ts` 21 → **24 例**（全链路 8 字段 + 封面回落；封面必填只对 scene 3/4 且配图可替代；跨空间/坏 id/21 张） |
| api | **82 文件 916 例** 全绿 |
| 全站用例 | 1,292 → **1,295**（api 916 / adapters 164 / cli 105 / worker 52 / db 26 / shared 26 / storage 6） |
| 门禁 | `pwsh _acceptance\verify-round.ps1` → **12/12 全绿**（跑两次：加 `res_type` 前后各一次） |
| 前端 | `knowledge` 列表渲染封面 + 「官方 / 已停用」徽标；5 语言各 +2 key，`i18n-check` 通过；typecheck/lint/build 干净 |
| 规模 | 迁移 43 → **45**、端点 712 不变、web .vue 54,678 → 54,720 行 |
| 分数 | **#18 99.5% → 100%（+0.015）**；全站 **202.45 → 202.47/206 = 98.3%**，剩余 3.55 → **3.53**；生态组 94.92 → **94.93** |

### 五、诚实边界

- `res_type`/`sp_type` **只透传不解释**：语义只到「资源类型 id / 业务分区 id」这一层，竞品没给值域，我方不自造含义。
- 图片 id 无外键：删资产后 `image_asset_ids` 里会留死 id，读时靠签名失败退占位图；要彻底干净得建关联表，代价是每次增删都要维护顺序，本批按竞品原始形状走。
- `?sp_type=1,2` 的逗号串是我方方言（竞品是数组参数），两种写法都支持，但「多值语义」本身是我方推断。
- 本批只清掉 I 类 0.085 里的 0.015，剩下 **0.07**（#19 双浏览器 E2E 0.03 / #3 真 ffmpeg 切片 0.02 / #9 agent REPL 与 SSE 0.02）仍是「不等人、只等排期」。

---


## 变更登记（v6.28 · 第 74 批：核账 —— 每个没满 100% 的格子，到底卡在谁身上 · 2026-10-28）

前一批结尾我说下一批做「核账」。这一批没有一行代码，动的是台账本身 —— 因为 98.3% 这个位置最容易出现
**没有出处的扣分**：缺口栏写「无」但完成度是 99%、写「权重已计入各模块」却不说哪几条、写「待取证」却不说是哪一份证据。
这三种写法都会让人以为「还有活没干」，实际可能是账错了，也可能是自己发明的缺口。

### 一、判据只有三类，ceiling 先定死

| 判据 | 含义 | 判定门槛 |
|---|---|---|
| **E 外部输入** | 等凭据 / 资质 / 渠道测试号 / 竞品响应体证据 / 法务文案 | 必须能指到**具体的**那份输入（`PAYMENT_LIVE=false` 的注释、`available:false` 的返回、竞品空 schema） |
| **B 产品一句话** | 口径二选一，确认即可实现 | 已单列在 §5.4，共四条 ≈0.26 |
| **I 内部可做** | 不需要任何外部输入，只是没排期 | 必须能说出「明天就能开工」的动作 |

**核账结果（19 个未满 100% 的行逐条对着代码/配置/竞品清单核）**：
**E = 2.83、B = 0.635、I = 0.085、测量缺陷 = 0**（合计 3.55）。
→ **分数没有记错，错的是两处措辞**，本批改掉：

- **#11 无限画布的 0.20，缺口栏原来写着「~~无~~」**。现在写成 4 个具名能力：竞品 `pinned-timelines` 的 4 条形状、
  `group execute`、`group template-get`、`material batch-add` —— 四项都**没有竞品响应体证据**（只有路由）。
  一个 99% 的格子写「无缺口」等于说「那 1% 是随机的」，这次把它钉到具体能力上。
- **#9 CLI/MCP 的 0.24，原来写「42 条骨架…权重已计入各模块」**。逐条核完**只有 21 条成立**：
  另 21 条只在 #9 记账（`model price`、`subject batch-details`/`reset`、`asset-lib get`/`search`/`batch-delete`、
  `agent enter`/`run`、`file object`、`sync-fm` 等）。所以 0.24 **不构成重复计**，但措辞必须改成 21/21 分账。

### 二、42 条 CLI 骨架不是 42 个能力缺口

这是核账里最有价值的一条：把 42 条骨架按「缺口记在哪」分三堆 ——

| 归属 | 条数 | 例子 |
|---|---:|---|
| 已在其它主模块的缺口栏里（不重复扣） | 21 | `material get`/`group execute` → #11；`novel config` → #2；xlsx 模板 4 条 → 各自主模块 |
| **只在 #9 记账** | 21 | 上段列的 11 类 |
| 组合可达（根本不是缺口，只是没有单命令） | 见上两堆 | `asset-lib tag-add`/`move` 用 `PATCH /assets/:id` 的 `tags`/`folder_id`；`file metadata` 在 `task get` 的 results 里 |

### 三、核账之后能说的那句话

98.3%（202.45/206）里：

- **代码侧只剩 0.085 是「不需要任何外部输入、只是没排期」**：#18 知识库条目级字段（0.015，证据已有）、
  #19 双浏览器上下文 E2E（0.03）、#3 真 ffmpeg 切片进 worker handler（0.02）、#9 的 REPL 与 SSE 流式（0.02）；
- **B 类 0.635 需要产品一句话**（其中 §5.4 那四条 0.26 拍完我立刻能做）；
- **E 类 2.83 必须等外部输入**。

### 四、诚实边界

- 这次核账**不产生任何分数变化**：没有发现「测量缺陷」（即没有哪一行的扣分找不到出处到需要改分），
  改的只是**两处措辞**。如果非要为核账加一次分，那才是这本书里最不该有的加分。
- 表 A 的 E/B/I 拆分带**判断成分**：例如 #4 的「推荐位编排 0.20」我判成 B（产品给口径），
  也可以判成 E（运营给内容）——两种判法都不改总分，标出来以免读者以为是实测。
- 第 73 批结尾我还怀疑过「#9 的 0.24 是否与各模块重复计了一次」。核完的答案是**不重复**（21 条别处有账、21 条只在这里），
  这条怀疑现在是结论**否定**，一并登记以免下轮重新纠结。
## 变更登记（v6.27 · 第 73 批：批量接口的「读宽松 / 写严格」—— 同一组 id，两个端点必须有两种反应 · 2026-10-28）

> 这一批的起点还是同一种账：**CLI 骨架命令的 reason 写着「我方没有」，而竞品不但有，还给了 CLI 动词**。

### 一、缺口长什么样

`apps/cli/src/registry.ts` 里有两条 `todo(...)`：

| 命令 | reason 原文 | 竞品事实 |
|---|---|---|
| `resource get`（`:532`） | 我方无单资源详情端点；用 `resource generate-list`（候选）或 `resource list --set kind=scene` | `GET /web/v1/df/resources/:sp_id/:resource_id/info`（单条详情）；`commands/resource.md:92` `reelmate resource get` |
| `resource batch-confirm`（`:554`） | 我方无批量确认端点；逐条 `resource confirm <SP> <RES>`（PATCH status=2） | `POST /web/v1/df/resources/batch-confirm`；`commands/resource.md:100` `reelmate resource batch-confirm` |

还有一条我方**连命令都没有**：竞品 `commands/resource.md:96` 有 `resource batch-info`（批量查详情），
后端是 `POST /web/v1/df/resources/batch-info`。

这三条都落在「项目资产」上（角色/场景/道具，`projects/{id}/assets`）——我方原本只有列表、创建、按 id 的
`PATCH`/`DELETE`、以及候选图三条，**没有单条读、也没有任何批量读/批量写**。

### 二、这一批最核心的一个设计：同样一组 id，两个批量端点必须有两种反应

`batch-info`（读）与 `batch-confirm`（写）接收的是同一个 `asset_ids` 数组，但对「数组里混了个不存在的 id」
必须**相反**处理：

| | `POST …/assets/batch-info`（读） | `POST …/assets/batch-confirm`（写） |
|---|---|---|
| 遇到不存在的 id | **不报错**，进 `missing: ["<id>"]`，其余正常返回 | **整批 400102**，一条都不落库 |
| 理由 | 批量查询的用途是「一次渲染一屏」。一个已失效的 id 不该让整屏变成错误页——用户想看到的是「这 7 条还在、那 1 条没了」 | 批量写若部分成功，调用方无法从一次响应里判断到底改了哪些，只能重新查一遍；而且它拿不到「失败的为什么失败」 |
| 实现 | 查出来的行映射成 `list`，入参与命中的差集即 `missing` | 先按 `project_id + id in (…)` 查命中数，`命中 ≠ 入参` 就抛，校验在写之前 |

这不是「一致性」问题，是**两种操作对失败的正确反应本就不同**。把它写进 `api-spec §17.31.3`，因为下一次再有人
加批量接口（竞品还有 `batch-delete`/`batch-unconfirm`/`batch-update`），会直接沿用这个判据。

### 三、四个不显然的决定

| 决定 | 为什么不能反过来 |
|---|---|
| 定稿**幂等**：重复 `batch-confirm` 不刷新 `finalized_at`（`coalesce(finalized_at, now)`） | 与既有 `PATCH …/assets/:assetId {status:2}` 同一条规则：`finalized_at` 是「第一次定稿的时刻」，被重复调用冲掉就成了「最后一次点了按钮的时刻」，对账口径立刻变形 |
| `asset_ids` 上限 **100**、空数组**不是**「全部」 | 空数组当「全部」是危险的隐含语义：调用方漏传一个变量就会批量改掉整个项目。上限 100 与竞品批量接口的分片习惯一致 |
| zod 的 `min/max` **自写 message** | zod 默认文案是 `Array must contain at least 1 element(s)`，不带字段名；CLI/agent 收到 400101 后无法判断是哪个参数错。改成 `asset_ids must contain at least 1 id` |
| 竞品是 `resources/{sp_id}/{resource_id}/info`，我方是 `assets/:assetId`（`project_id` 在路径里） | 沿用我方既有集合风格（`projects/:id/assets/:assetId` 与 `PATCH`/`DELETE` 同形）；契约差异登记在 `api-spec §17.31.2` |

### 四、顺手校准了一条自己写错的数字

第 72 批把骨架数从 46 减到 44，文档里却写成「48→46」。这一批对着 `dist/registry.js` 数出来才发现：
**202 命令 / 158 ready / 44 骨架**（不是 46）。本批变更后是 **203 / 161 / 42**。
已把 §2.1、§3.3 #9、§3.4 分布解读、§5、§5.3、§7 口径表里所有「46 骨架」「48→46」改成 46→44→42 的真实序列。
**教训**：骨架数这类「从产物读出来的数字」每批都要重读一次产物，不能从上一版文档往下减。

### 五、验证

| 项 | 结果 |
|---|---|
| 新 spec `test/project-asset-batch.spec.ts` | **5 例全绿**（详情/跨空间/批量读的 missing/批量写的整批失败/跨项目串号） |
| api | 82 文件 **913 例**（原 908，+5）；typecheck / `npx eslint src` 干净 |
| cli | 15 文件 **105 例**；`dist/registry.js` = 203 命令 / 38 组 / 161 ready / 42 骨架；`[gen-skill]` 重写 3 个文件 |
| 跨包守卫 | `registry-routes.spec.ts` 通过（新路径都被后端路由接住）；`_r65_cli_audit.py` → ready 161 条里 **0 条**缺路由；`_r66_web_audit.py` → 408/408 ok |
| 12 项总闸 | **全绿**（结论「全绿」） |
| 规模 | 端点 709→**712**、用例 1,287→**1,292**、迁移 43 / 表 112 / 页面 64 不变 |

### 六、诚实边界

- **不加分**：这两条骨架的减少落在 #9 的 1% 粒度以下（0.24 = 8×3%），分数仍 202.45/206 = 98.3%。
- 竞品还有 `resources/batch-delete`、`batch-unconfirm`、`batch-update`、`batch-download` —— 我方这一批**没做**：
  删除侧我方是单条硬删（`DELETE …/assets/:assetId` 还要先解 `storyboard_assets` 绑定），批量删要先定「部分成功怎么算」，
  没有竞品字段级证据前不凭形状造语义。仍记在 #9 的 42 条骨架里。
- `bound_shot_count` 是自建口径（数 `storyboard_assets` 绑定行），与竞品「被多少分镜引用」是否同义**未取证**。

## 变更登记（v6.26 · 第 72 批：任务「删了但还在跑」不能发生 —— 软删 + 五条读路径同时收口 · 2026-10-28）

> 这一批补的是 CLI 骨架里两条「reason 写着没有、其实竞品有」的记录（第 70 批的 ad/redraw 是同一类），
> 但真正值得写下来的是**为什么删一条任务记录不是一句 `DELETE`**。

### 一、缺口还是「reason 写着没有、其实竞品有」

`apps/cli/src/registry.ts` 里两条骨架的 reason 原文：

- `task delete`：「我方无删除任务端点；结果按 `tasks.expire_at`（90 天）自动过期…」
- `credits log`：「我方只有一套带符号 `points` 的口径 `GET /credits/flows`，没有 log 的无符号口径」

竞品证据（`_acceptance/reelmate_cli_skill/reelmate-cli-skill/commands/`）：

| 命令 | 文档位置 | 后端 | 关键语义 |
|---|---|---|---|
| `task delete TASK_ID` | `task.md:195` | `DELETE /web/v1/task/{task_id}` | 支持 `--dry-run`、`--idempotency-key` |
| `credits log` | `credits.md:68` | `GET /web/v1/user/credits-log` | `event_type` 1 获取 / 2 消耗 + **无符号 `val`** |
| `credits flows` | `credits.md:68` | `GET /web/v1/user/credits-dashboard/flows` | 带符号 `points` + `section` + `rm_task_id`/`volc_task_id` |

**`credits.md:68` 明确写这两个积分接口「语义不同、不能混用」**——这决定了本批的做法（见下）。

### 二、为什么删除是软删

`tasks` 表被这些地方引用 / 依赖：

- `canvas_nodes.task_id`（画布节点指向任务，硬删会被外键拒绝）
- `assets.source_task_id`（任务产物素材，硬删会剪断产物归属）
- `credit_flows.ref_task_id`（积分流水指向任务，是**对账依据**，硬删会让一笔钱的去向失去凭证）

所以迁移 `0042_worthless_mentor.sql` 只加一列 `tasks.deleted_at`，删除 = 打时间戳；**结果行、`credits_settled`、
`results` JSON 全部保留**，只是读不到。这不是「实现偷懒」，是让「用户看到没了」与「账能对上」同时成立。

### 三、四个不显然的决定

| 决定 | 为什么 |
|---|---|
| 软删，且**只影响读** | 见上：外键与对账链要求行必须存在；90 天过期清理是另一条生命周期，两者不能混 |
| 仍在跑（PENDING/RUNNING/REVIEWING）→ **400101** | 否则「记录删了但后台还在生成」，用户会以为没扣钱/没产出；先 `cancel` 再删 |
| `credits_frozen > 0` → **400101** | 冻结中的积分必须有归属任务才能解冻/结算，删了任务那笔钱就永远悬着 |
| `credits log` **不新增后端端点** | 竞品两接口语义不同、不能混用；我方只有带符号 `delta` 一份真相，第二份真相同步必然漂移 → 由 CLI `transforms.ts` 派生旧口径字段 |

派生规则（`apps/cli/src/transforms.ts` 的 `creditsLog`）：`event_type = delta >= 0 ? 1 : 2`、`val = Math.abs(delta)`；
`delta === 0`（冻结/解冻行）按 1（获取）归类并保留 `kind`，让调用方仍能区分。

### 四、读路径必须**一起**改，只改一处等于没改

`apps/api/src/modules/tasks/tasks.service.ts` 里加 `isNull(tasks.deletedAt)` 的位置：

- `list()` / `getMany()`（列表与 `?ids=`）
- `findTask()`（详情、`regenerate`、`feedback`、`retry`、`downloadUrl`、`createShare`/`revokeShare` 共用）
- `batchDownload()` / `resultMany()`（`/tasks/batch-download`、`/task/result`）
- `publicShare()` / `publicShareDownload()`（分享与公开下载，任务删了链接也必须失效）

E2E 断言就按这条写：删成功之后，**五条读路径全部失效**、但 DB 行/结果/结算字段仍在。

### 五、验证

| 项 | 结果 |
|---|---|
| `apps/api/test/task-delete.spec.ts` | **5 例**（软删后 5 条读路径失效、分享自毁、运行中三态、冻结积分、坏 id/不存在/重复删/跨空间） |
| `apps/cli/test/transforms.spec.ts` | +1 例（`creditsLog` 把 +80/−12/0 派生为 `[[1,80],[2,12],[1,0]]`） |
| api 全量 | **81 文件 908 例**（原 80/903） |
| cli 全量 | **15 文件 105 例**（原 15/104） |
| 总闸 | `_acceptance/verify-round.ps1` **12/12 全绿** |
| 规模 | 端点 **709**、迁移 **43**（0000–0042）、用例 **1,287** |

### 六、诚实边界

- **本批不加分**：这两条能力此前只记在 #9 的「骨架命令」缺口里，而 #9 台账是 1% 整数粒度（0.24 = 8×3%），
  48→46 表达不出来；全站仍 **98.3%（202.45/206，剩余 3.55）**。
- `task delete` **未实现 `--dry-run` / `--idempotency-key`**：竞品文档有这两个旗标，但我方写接口目前没有幂等键体系
  （不是这一个端点的事），硬造一个只对本端点有效的幂等键会与其他写接口不一致 → 登记为已知差异。
- `credits log` 的派生只保证**旧的三个字段**（`event_type`/`val`/`created_at`）可用；`section` 与
  `income/consume/transfer` 的 tab 语义属新接口，派生不出来，也不假装有。

## 变更登记（v6.25 · 第 71 批：删掉一集要连带清 8 张表 —— 漏一张就是 500 · 2026-10-28）

> 主台账见 `docs/07-plan/implement-progress-vs-reelmate.md` §9 **v9.4**（同一批；本文件与主台账各有一套编号，勿混）。

**这一批补的是两条被 CLI 骨架钉住的后端缺口。** 用户面差别一句话：以前 `oneframe episode delete <ID>` 回的是「我方无 DELETE episodes；不要的集用 PATCH 清空内容」，`episode batch-create` 回的是「我方只支持按数量新增」——现在两条都能真的用，而且删得干净、建得可控。

### 一、缺口是「reason 写着没有，竞品其实有」

`apps/cli/src/registry.ts` 里这两条骨架的 `reason` 是唯一对外信息（骨架命令没有 `path`，所以第 65/66/67 批那套「路径 ↔ 后端路由」门禁**管不到它们**）：

| 命令 | 原 reason（逐字） | 竞品证据 |
|---|---|---|
| `episode delete` | 我方无 DELETE episodes；不要的集用 PATCH /projects/:id/episodes/:eid 清空内容，整项目用 workspace delete（归档） | `ApiDfEpisodeDeletePOST`；CLI `commands/episode.md:21` `reelmate episode delete EPISODE_ID` |
| `episode batch-create` | 我方只支持按数量新增：`--set count=N`（无逐集标题载荷端点） | `ApiDfEpisodeBatchCreatePOST`；CLI `commands/episode.md:142` `batch-create --set @episodes.json`，items 每项 `{"sort":1,"name":"第1集","s_script_id":"…"}` |

两个竞品端点的 `requestDataJsonSchema` 都是**空对象** —— 也就是只有路由形状、没有字段证据。所以入参字段名是我方自定的，已在 `packages/shared/src/schemas/pipeline.ts` 与 `api-spec §17.29` 里登记「待取证」。

### 二、删集为什么不是一句 `DELETE`

指向 `episodes.id` 的外键一共 **8 张表，全部 RESTRICT** —— 不先清子表，删集会被数据库直接挡下（表现是 500）。更麻烦的是层级：`storyboard_assets` 引用的是 `storyboards.id`，不是 `episodes.id`。

| 顺序 | 表 | 引用目标 | 备注 |
|---:|---|---|---|
| 1 | `storyboard_assets` | `storyboards.id` | 必须先按本集的分镜 id 删 |
| 2 | `storyboards` | `episodes.id` | |
| 3 | `episode_resources` | `episodes.id` | 此前没有任何删除路径 |
| 4 | `export_jobs` | `episodes.id` | 同上 |
| 5 | `project_timelines` | `episodes.id` | 另有 `uq_project_timelines_episode` |
| 6 | `timeline_exports` | `episodes.id` | |
| 7 | `extraction_tasks` | `episodes.id` | |
| 8 | `director_scenes` | `episodes.id` | |
| 9 | `timeline_publications` | `episodes.id` | |
| 10 | `episodes` | — | 最后才删本体 |

整段在一个事务里（`db.transaction`），并 touch `script_projects.updated_at`；返回体里如实上报 `cleared.storyboards`，让调用方能判断「删的是不是我以为的那一集」。

### 三、两个不显然的决定

| 决定 | 怎么做 | 为什么 |
|---|---|---|
| **删集不重排集号** | 删第 2 集后，剩下的仍是 1、3、4…，留下空洞 | 竞品文档只说「删除该集」，**没有重排证据**；重排会让外部已引用的「第 N 集」漂移，属于破坏性副作用 |
| **建集不回收空洞** | 不给 `sort` 就排到当前最大集号之后（不留的空洞不填） | 与「不重排」同一套口径，否则「删了第 2 集 → 下次建集默默占 2 号」，外部引用会指向另一集 |
| **`sort` 撞号必须 400101** | 显式报错，不静默改号 | 静默改号 = 用户以为建在第 5 集，实际是第 6 集 |
| **`s_script_id` 不接收** | zod 只声明 `name`/`sort`/`synopsis` | 竞品该字段是「拆解结果 ID」，我方拆集结果直接落 `episodes`，没有这个实体；造一个只为对齐字段名的空实体是假实现 |

竞品 `batch-create` 返回 `succeeded`/`failed`/`unconfirmed`（异步时 `succeeded[]` 只含已确认项，未确认进 `unconfirmed[]`）。我方是**同步**实现：整批落库或整体抛错，没有「未确认」这种中间态 —— 这个差异也写进了 `api-spec §17.29`，没有伪装成竞品的三态。

### 四、验证

| 项 | 结果 |
|---|---|
| 新 spec `apps/api/test/episode-edit.spec.ts` | **6 例**：级联清理（分镜/分镜资产关联/剧集资源）、不重排、空洞不回收、撞号/空数组/超上限/空白标题 400101、重复删 `abc` 不存在 id 跨空间 |
| api 测试 | **80 文件 903 例**（原 79/897） |
| 全库用例 | 1,275 → **1,281**（api 903 / adapters 164 / cli 104 / worker 52 / db 26 / shared 26 / storage 6） |
| 端点 | 706 → **708** |
| CLI | 命令 202 不变；ready **154 → 156**、骨架 **48 → 46** |
| 门禁 | `verify-round.ps1` **12/12 全绿** |

### 五、诚实边界

**这批不加分**（全站仍 202.45/206 = 98.3%，剩余 3.55）。原因不是「做得不够」，而是这两条能力此前只被记在 #9 的「48 条骨架命令」里，而 #9 的分档是 1% 整数粒度（0.24 = 8×3%），48→46 在台账上表达不出来。同理 #3 剧集分镜的 0.15 缺口是 `quality-check` 评分口径（竞品只给路由、无字段证据），本批补的删集/建集不在那 0.15 里 —— 所以也没有借它调高 #3。

真要说口径上的收益：**「宣称可用、其实没有」这类账已经清干净了**。第 65 批修的是 path 写错（36 条 404）、第 70 批修的是 reason 过期（5 条）、第 71 批修的是「我方确实没有，但竞品有且证据充分」的 2 条 —— 46 条骨架现在每一条的 reason 都指向一个真的还不存在的后端端点（见主台账 §5 第 4 行），而不是又一批过期记录。

---


## 变更登记（v6.24 · 第 70 批：ad/redraw 两组命令写着「当前无端点」，其实端点早就在 —— 接线并补齐到竞品同款，顺手修 `--set` 大整数 id 失真 · 2026-10-28）

> 主台账见 `docs/07-plan/implement-progress-vs-reelmate.md` §9 **v9.3**（同一批；本文件与主台账各有一套编号，勿混）。

**这一批修的是两类「代码看起来对、实际不对」的东西。** 用户面差别有两句：

1. 以前 `oneframe ad save` / `ad info` / `redraw create` 会直接回「该能力未实现（我方无端点）」——**但后端两个模块早在册**
   （`@Controller("ad-drama")` 12 条、`@Controller("video-redraw")` 9 条）。现在 ad 的 8 个动作与 redraw 的 2 个动作都能跑。
2. 以前 `--set brief_id=108760275629637632` 这条最普通的写法会**把 id 的最后几位改掉**，然后服务端回
   `400101 Expected string, received number`；现在会原样保住。

分数不动（仍 98.3% / 202.45 / 剩余 3.55）——骨架 48 条仍卡在后端未落地的端点，本批只是把「明明有端点却对外说没有」这种
**比缺能力更有害**的状态清掉。

### 一、两类缺陷与两种发现方式

| 缺陷 | 怎么发现的 | 为什么平时的门禁抓不到 |
|---|---|---|
| 5 条命令的 `reason` 是**过期记录**（写「当前无端点」，实际早已上线） | 把 `registry.ts` 里每条 `todo(...)` 的 reason 当**断言**逐条去 grep 后端 controller —— 这次直接命中 `ad-drama.controller.ts` 与 `redraw.controller.ts` | 骨架命令**不参与** `registry-routes.spec.ts` 的路径比对（它没有 `path` 字段），typecheck/lint 也不会怀疑一句说明文字 |
| `--set` 把 18 位 id 变成浮点 | **真 CLI 打真 API** 才暴露：`ad script --set brief_id=…` 一路 400101 | registry 里字段名/位置全对，`args.spec.ts` 只测了「JSON 能解析」，没测「解析后还是原来的值」 |

一句话概括这两类：**说明文字与类型推断都不在任何门禁的断言范围内**，所以只能靠「读一条命令的 reason 就去 grep 一次」和
「用真二进制跑一条真链路」。

### 二、接线清单（10 条，全部指向已存在的端点）

| 组 | 动词 | method + path | 标记 |
|---|---|---|---|
| ad | `info` | `GET ad-drama/projects/{project_id}` | — |
| ad | `save` | `POST ad-drama/projects` | write |
| ad | `selling-point` | `POST ad-drama/projects/{project_id}/selling-point/generate` | write · paid |
| ad | `plot` | `POST …/brief/generate` | write · paid |
| ad | `script` | `POST …/script/generate` | write · paid |
| ad | `asset` | `POST …/asset/extract` | write · paid |
| ad | `plan` | `POST …/storyboard/generate` | write · paid |
| ad | `reset` | `POST …/script/reset` | write |
| redraw | `info` | `GET video-redraw/projects/{project_id}` | — |
| redraw | `create` | `POST video-redraw/projects` | write |

`paid` 不是猜的：`ad-drama.service.ts` 里 `:225`/`:272`/`:340`/`:442`/`:515`/`:569` 六处逐个调 `credits.price()`，
五个生成类动作各对应一处（`reset` 不计费）。

### 三、为什么 ad 补到 8 个动词、redraw 只补 2 个

竞品 `commands/ad.md:22-31` 列了 8 个动词（`info`/`save`/`selling-point`/`plot`/`script`/`asset`/`plan`/`reset`），
而竞品 `commands/redraw.md` 自己写明 `create`/`episode`/`bind`/`asset`/`plan` 是「流程待接入」——**只有 `info` 是它声称可用的**。
所以：ad 补齐到 8（我方后端正好都有对应端点），redraw 只接 `info` 与 `create`（`create` 有真实入参证据：
`redraw.controller.ts:21-30` 的 `createBody` + `redraw.service.ts:53` 的 `REDRAW_STYLES`），
其余四条**不凭空造**。

### 四、`--set` 的 id 保真：规则比「都当字符串」复杂

改动只在 `apps/cli/src/args.ts` 的 `coerceScalar`：

```ts
// 修前：整串直接 JSON.parse —— 18 位裸整数一定失真
// 修后：只给「超过 MAX_SAFE_INTEGER 的裸整数」加引号，其余不动
const BIG_INT_RUN = /(?<![\w."-])(\d{16,})(?![\d."])/g;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const guarded = text.replace(BIG_INT_RUN, (run) => (BigInt(run) > MAX_SAFE ? `"${run}"` : run));
return JSON.parse(guarded) as unknown;
```

| `--set` 输入 | 结果 | 理由 |
|---|---|---|
| `count=2` | number `2` | 短数字照旧，别把「数量」变成字符串 |
| `n=9007199254740991` | number（安全整数） | 能被 JS 精确表示就不必改类型 |
| `brief_id=108760275629637632` | string `"108760275629637632"` | 超过安全整数，转数字必然失真 |
| `shot_ids=[1087…,1087…]` | string 数组 | 数组内裸 id 同样受保护；已带引号的不二次加引号 |

### 五、验证（真跑，不是只看 registry）

| 项目 | 结果 |
|---|---|
| `pnpm --filter @app/cli build` | `[gen-skill] 写入 4 个、未变 39 个（共 43）` → 再跑 `写入 0 个、未变 43 个`（内容幂等） |
| `dist/registry.js` | **202 命令 / 38 组 / 154 ready / 48 skeleton**（原 197 / 144 / 53） |
| cli 单测 | **15 文件 104 例全绿**（原 14/99；`args.spec.ts` +1、新增 `ad-redraw-parity.spec.ts` 4 例） |
| 真 CLI 打真 API | ad 全链 `save`→`info`→`selling-point`(2 条)→`plot`(2 条)→`script`(带真实 brief_id)→`asset`(4 条)→`plan`(3 shot)→`reset`→`info`（末态 `stage=4`/`shots=3`）；redraw `create` 回 `project_mode:3`、`info` 回 `video_redraw_stage:"episode"` |
| 总闸 | `pwsh _acceptance/verify-round.ps1` → **12/12 全绿** |

### 六、诚实边界

- **不加分**：48 条骨架仍卡在后端未落地的端点（各自权重已计入对应模块），本批清掉的是「过期说明」与「命令层类型失真」，不是新能力。
- `ad`/`redraw` 两组的**响应字段**仍是「我方 DTO 形状」——竞品 CLI 文档只给用法与输出键名（`SP_ID`/`STAGE`/`video_redraw_stage` 等），没有字段级 JSON schema；已有字段对齐是我方与竞品语义对得上，不是逐字段取证。
- redraw 的 `episode`/`bind`/`asset`/`plan` 四条命令仍是骨架，因为竞品自己也没写清流程；等它给证据再做，不猜。


## 变更登记（v6.23 · 第 69 批：路径里的 id 写错时不再返回 500 —— 248 条 GET 探针抓出的 18 条 · 2026-10-28）

> 主台账见 `docs/07-plan/implement-progress-vs-reelmate.md` §9 **v9.2**（同一批；本文件与主台账各有一套编号，勿混）。

**这一批不是补功能，是修一类会持续制造 5xx 的实现缺陷。** 用户面差别只有一句话：
以前把 URL 里的 id 拼错（`/canvas/canvases/abc/materials`）会看到「服务器内部错误」，现在看到的是
`400101 invalid canvas_id`；对监控来说，客户端拼错参数不再计入 5xx。**分数不动（仍 98.3% / 202.45 / 剩余 3.55）**。

### 一、怎么发现的：把每个 GET 的 `:param` 换成 `abc`

不靠读代码猜，靠跑一遍。两步（脚本都在 `_acceptance/`，可复跑）：

1. `_r69_routes.py`：扫 52 个 `*.controller.ts`，抽出全部 `@Get(...)` 的完整路径（拼上 `@Controller` 前缀），
   把路径里的 `:param` 一律替换成 `abc` → **248 条唯一 GET 路径**（`_acceptance/out_get_routes.json`）。
2. `_r69_probe.js`：`POST /v1/auth/sms-code` 取 `debug_code` → `POST /v1/auth/login` 拿 token →
   带 `authorization` + `x-space-id` 逐条 GET，只记录 HTTP ≥ 500 的。

结果（**修前**）：

```
probed: 248  internal(500): 18
```

18 条里有 12 条在 canvas 家族，另有计费、团队、KDS。响应是
`{"code":500000,"msg":"Internal Server Error"}` + HTTP 500 —— 也就是**用户拼错 URL 被报成我们的故障**。
（同类探针第 65 批用在 CLI 路径上、第 66/67 批用在前端路径上；这一批复用同一套「机械一跑」的手法。）

### 二、为什么 `BigInt("abc")` 会变成 500

`BigInt("abc")` 抛的是 **`SyntaxError`**，不是我们自己的 `AppError`。而 `AllExceptionsFilter` 只把
`isAppError(exception)` 映射成「HTTP 200 + 业务 code」，其余非 `HttpException` 一律走末尾的
「未知异常」分支（`apps/api/src/common/http/exception.filter.ts:45`）：`res.status(500).send(fail(INTERNAL, "Internal Server Error"))`。
所以这类错误的**形态就不对**：它既不是业务错误（400101），也不该是服务端故障（5xx）。

### 三、修法：一个入口函数，不做全局 pipe

新增 `app/apps/api/src/common/bigid.ts`：

```ts
export function toBigId(raw: unknown, field = "id"): bigint {
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" ? String(raw) : "";
  if (!/^\d{1,20}$/.test(text)) throw new AppError(ErrorCode.INVALID_PARAM, `invalid ${field}`, { field });
  const value = BigInt(text);
  if (value <= 0n) throw new AppError(ErrorCode.INVALID_PARAM, `invalid ${field}`, { field });
  return value;
}
```

**为什么不是全局 `APP_PIPE` / 全局拦截器**：那要靠「参数名长得像不像 id」来判定，而实际的路由参数名里有
`chapterNo`、`n`、`provider`、`slot`、`token`、`version` 这些**不是 id** 的；误判的代价是把合法请求打成 400101 ——
比现在的 500 更难查。定向替换点少、语义清楚、每处都能对应到具体路由，风险小得多。

**为什么不在 zod 层统一做**：zod 校验的是 body/query，路径参数不经 zod（`@Param` 直接是字符串），
而这一批 18 条里绝大多数错误来自**路径参数**。

### 四、改了哪些地方（8 个 service）

| 文件 | 位置 | 覆盖到的路由 |
|---|---|---|
| `canvas-group.service.ts` | `private mustGetCanvas` | `pin-groups`、`group-templates` 等 |
| `canvas-material.service.ts` | `mustGetCanvas` + 6 处 `cnId` + `q.node_id`/`q.uid` | `materials`、`comment-nodes`、`comment-nodes/:cn/comments` |
| `canvas-node-tasks.service.ts` | `mustGetCanvasAndNode`（canvas_id + node_id） | `running-nodes`、`nodes/:n/task/:t`、`nodes/:n/video-parse/:t` |
| `canvas-download.service.ts` | `list` | `canvases/:id/download-lists` |
| `canvas-template.service.ts` | `private getVisible` | `templates/:id`、`templates/:id/instantiate` |
| `kds.service.ts` | 4 处 `opUserId` | `team/member/:u/point-consume-detail`、`point-quota-detail` |
| `team.service.ts` | `groupStats`、`getRolePermissions`、`memberDetail` | `team/group/:g/stats`、`roles/:r/permissions`、`team/member/:u` |
| `billing.service.ts` | `getOrder` | `billing/orders/:id` |

两个**本来就没中**的，可作为写法参照：`canvas.service.ts` 的 `mustGetCanvas`/`mustGetNode`、
`canvas-derive.service.ts` 的 `requireNode` 早就自己 try/catch 了。复跑探针：`probed: 248  internal(500): 0`。

### 五、测试：6 例，把 18 条路径钉住

`app/apps/api/test/bigid-path-params.spec.ts`：

| 用例 | 断言什么 |
|---|---|
| 「修前 500 的 18 条 GET」 | 逐条 `code === 400101`，且 `msg` 里的字段名对得上（`invalid canvas_id` 之类）—— 字段名不对说明是在别的层被打回来的，不算修好 |
| 「第二层 id」 | 先造一张**真**画布，再让 `cn_id`/`node_id` 非法 → 仍 400101（不造真画布测不到这一层：`abc` 同时充当所有 param 时先炸的总是 `canvas_id`） |
| 「不再出现 500000」 | 22 条 URL 全扫，回归锚点 |
| `toBigId` 边界 ×3 | 12 个非法输入（空串/空格/`12abc`/`-1`/`0`/`1.5`/`1e3`/`0x10`/全角数字/换行）、21 位超长数字、合法值去空格 |

（顺带发现：`listComments(spaceId, cnId)` 的签名里没有 canvas，它不校验 canvas 归属 ——
所以那条 URL 的错是 `cn_id` 报的，不是 `canvas_id`。）

### 六、诚实边界

这一批**只收了「路径参数」这一层**。同一类形态在**写接口 body** 里还有约 **80 处** `BigInt(input.x)`
（`team` 的成员改派 / `market` 的 `novel_id` / `knowledge` 的 `dir_id` / `subject` 的 `asset_id` 等），
传非数字仍然是 500。没一次改完的理由是它们都在写路径上、每处都要单独判断「该不该在 zod 层就拒」。
已用 `grep 'BigInt\((q|input|body|params)\.'` 定位并写进主台账 §5 表下附注，留作后续批次逐模块收口。
**不计分**：这是修实现缺陷，不是补缺口；全站仍 98.3%、剩余 3.55。

## 变更登记（v6.22 · 第 68 批：分镜手动增删改 —— 唯一索引逼出来的两段式改号 · 2026-10-28）

> 主台账见 `docs/07-plan/implement-progress-vs-reelmate.md` §9 **v9.1**（同一批；本文件与主台账各有一套编号，勿混）。
> **这批不加分**：下面这 4 条能力此前没被记进任何模块的扣分项（#3 的 0.15 记的是 `quality-check` 口径自建与真 ffmpeg 切片），补上它们不等于原有扣分项消失。

### 一、起点是一条「挂了很久」的 CLI 骨架

`apps/cli` 的 `storyboard` 组里有 4 条命令一直是 `todo(...)`，reason 写得很具体：

```
todo("storyboard", "add",          …, "我方无单条新增分镜；用 storyboard batch-generate（AI 生成）或 node table-import 导表")
todo("storyboard", "delete",       …, "我方无删除分镜端点（storyboard 目前只可改不可删）")
todo("storyboard", "batch-delete", …, "我方无批量删除分镜端点")
todo("storyboard", "num-update",   …, "我方无分镜号重排端点；编号随 shot_no 生成")
```

竞品侧的三个形状是取得到的（`_acceptance/competitor_endpoints.tsv`）：

| 竞品端点 | params | 说明 |
|---|---|---|
| `POST /web/v1/df/episode/:ep_id/storyboard-add` | `ep_id` | 单条新增 |
| `POST /web/v1/df//episode/:ep_id/storyboard/delete` | `ep_id` | **竞品路径自身有两个斜杠的笔误**，分镜 id 只能进 body |
| `POST /web/v1/df/episode/:ep_id/storyboard/num-update` | `ep_id` | 重排分镜号 |

但三者 `requestDataJsonSchema` 都是**空对象** —— 字段名没有证据。所以这 4 条端点的入参口径是**我方自定**的
（`packages/shared/src/schemas/pipeline.ts` 里逐条注明「待取证」，不自称对齐）。

### 二、真正的工作量不在端点，在一个唯一索引

`storyboards` 上有 `uq_storyboards_episode_shot (episode_id, shot_no)`。它让「插队 / 重排」不能逐条改成目标号：
把第 1 条改成 2 号时，2 号还占着位，直接撞约束。逐条 `+1` 也一样（顺序不管怎么排都会踩到前一个）。

做法是**两段式改号**：先把整集改成负数腾空正数区间，再写终值 —— 负号段本身也唯一，任一步都不违反约束。

```ts
// apps/api/src/modules/script/script.service.ts  applyShotOrder
for (let index = 0; index < ordered.length; index += 1) {
  await tx.update(storyboards).set({ shotNo: -(index + 1) }).where(eq(storyboards.id, ordered[index]!));
}
for (let index = 0; index < ordered.length; index += 1) {
  await tx.update(storyboards).set({ shotNo: step * (index + 1) }).where(eq(storyboards.id, ordered[index]!));
}
```

代价是 `2N` 次 `UPDATE`（N = 该集分镜数，接口上限 500）。只在**显式插队或重排**时才走；
最常见路径「追加到末尾」直接取 `max(shot_no) + 1`，一次 insert，不重排。

### 三、三个不显然的决定

| 决定 | 为什么 |
|---|---|
| 追加不重排（`max+1`） | 追加是最常见路径，为它付 `2N` 次更新不值得；顺带也避免把「只是加一条」变成「整集的分镜号都变」（下游若按 shot_no 记录过什么，编号无谓变动就是噪音） |
| 跨集 id 删除返回 `deleted: 0`，不报 400 | 「批量删除」的语义是「把这些 id 从这个剧集里删掉」，别的集里的 id 本来就不在这个集合里；报 400 会让前端处理「部分失效」变得很别扭。真正的错误（id 不是数字）才 400101 |
| 删除顺序：先 `storyboard_assets` 再 `storyboards`；已投递任务不回收 | `storyboard_assets` 是**唯一**引用 `storyboards.id` 的外键，顺序反了就是外键错（与 `parse.service` 重新解析时的清理顺序一致）。`image_task_id` / `video_task_id` 指向的 tasks 有自己的生命周期（可能还在跑），删分镜不该连锁杀任务 |

### 四、验证

| 层 | 覆盖 |
|---|---|
| `apps/api/test/storyboard-edit.spec.ts`（新增 8 例） | 追加序列 / 插队顺延 / 撞号 400101 / `shot_no`+`insert_after` 互斥 400101 / `insert_after` 指向别的集 400102 / 跨集批量删 `deleted:0` / 重排按给定顺序 + `step=10` 留空号 / 漏项、重复、跨集重排均 400101 |
| `apps/api/test/` 全量 | 77 文件 **891 例**（原 883，+8） |
| `apps/cli` | 4 条 `todo(...)` → `http(...)`；build 触发 `gen-skill` 重写 3 个文件；**ready 140 → 144、骨架 57 → 53**；`registry-routes.spec.ts`（读 `apps/api` controller 源码建路由表逐条比对）复跑仍绿 |
| 总闸 | `pwsh _acceptance/verify-round.ps1` → 12/12 全绿 |

规模：端点 **702 → 706**、controller 52 不变、迁移 **42** 不变（`uq_storyboards_episode_shot` 是既有约束，本批不需要迁移）、表 112 不变；用例 **1,256 → 1,264**。

### 五、诚实边界

- **字段名是自定的**：竞品只给路径与方法，`requestDataJsonSchema` 为空对象。`shot_desc`/`insert_after`/`shot_ids`/`step` 这些名字没有竞品证据，已在 schema 注释里登记「待取证」。
- **不加分**：全站仍是 **202.45/206 = 98.3%**、剩余 **3.55**。先前的 95%/97% 不是按「有没有这 4 条命令」打的，所以补上也不该动分数。
- **重排必须覆盖全集**：只传一部分 id 会 400101 —— 否则「没被点到的那条」会被挤到末尾，等于静默改数据。

## 变更登记（v6.21 · 第 67 批：把前端路由门禁的覆盖面补满 —— 408 → 544 条、未解析 0 · 2026-10-28）

> 批次台账见 `docs/07-plan/implement-progress-vs-reelmate.md` §9 的 **v9.0**（同一批，编号体系不同，勿混）。
>
> **这批不加分**：`202.45/206 = 98.3%`、剩余 `3.55` 全部不变。它修的是**门禁本身**的覆盖漏洞——
> 上一批刚建立的守卫有个盲区，盲区里正好是路径最容易拼错的那一类代码。

### 一、上一批的守卫漏了什么

第 66 批的 `apps/api/test/web-api-contract.spec.ts` 只解析「首参就是字符串/模板字面量」的调用：

```ts
// 能抓到（第 66 批的真缺陷就在这里）
await api.get("/team/groups");

// 抓不到 —— 整片跳过
const base = (canvasId: string) => `/canvas/canvases/${encodeURIComponent(canvasId)}`;
await api.get(base(canvasId));
await api.post(`${base(canvasId)}/commit`, payload);
```

`useCanvasApi.ts` / `useAgentChat.ts` / `useCanvasAgent.ts` 这些 composable 全是这种写法。
**风险最高的一类（把模块前缀写错、把资源名写错）反而在门禁之外**——第 66 批能抓到 `works.vue`，
是因为那条路径恰好写成了字面量，属于运气，不是方法成立。

### 二、补了哪四类解析

| 形态 | 例子 | 处理 |
|---|---|---|
| helper 调用 | `api.get(base(canvasId))` | 取 `base` 声明处的模板字面量（或普通字符串）作前缀 |
| helper 前缀模板 | ``api.post(`${base(id)}/commit`)`` | `expandHelperPrefix()` 展开 `${helper(...)}` 再接尾巴 |
| 局部变量 | `const path = mode === "mine" ? "/crc/activity/list" : "/crc/activity/public"; api.post(path, …)` | 取该变量**同一语句内**所有以 `/` 开头的字面量（三元两分支都进） |
| 兜底表达式 | `api.post(x?.y ?? "/agent/stt/transcribe", …)` | 取表达式片段内的字面量 |

关键的两个坑（都是我自己先踩出来的）：

1. **局部变量切片必须在 `;` 处截断**。最初取声明后 400 字符，会把**下一条调用**的字面量算进来，
   于是 `api.post(path, …)` 被错配成 `POST /crc/assets/me` ——这个误报差点被当成真缺陷去改代码。
2. **helper 的返回值可能是普通字符串而不是模板字面量**：`const base = () => "/agent/sessions"`。
   只认模板字面量会让 `useAgentChat.ts` 的 8 条调用继续落在盲区里。

### 三、门禁本身加了两条防退步断言

- 静态可解析调用数 **> 500**（原 > 300）：如果哪天解析器失效，先在这里红，而不是"少扫一点也绿"。
- 未解析数 **≤ `UNRESOLVED_MAX`(0)** 且每一条都必须落在 `UNRESOLVED_ALLOWLIST`（当前为空）里：
  将来真出现「首参前缀来自运行时数据」的调用，必须显式登记并写明原因，不能悄悄扩大盲区。

### 四、反向验证（证明守卫真的会红）

把 `apps/web/composables/useCanvasApi.ts` 里的 `/canvas/canvases` 改成 `canvasBROKEN`：

```
× 所有静态可解析路径都能在后端路由表里找到
GET /canvas/canvasBROKEN/{} ← composables\useCanvasApi.ts:34
PATCH /canvas/canvasBROKEN/{} ← composables\useCanvasApi.ts:38
DELETE /canvas/canvasBROKEN/{} ← composables\useCanvasApi.ts:40
POST /canvas/canvasBROKEN/{}/commit ← composables\useCanvasApi.ts:55
GET /canvas/canvasBROKEN/{}/snapshots ← composables\useCanvasApi.ts:58
```

6 例中 2 例立刻红，改回即绿。

### 五、数字与边界

| 项 | 第 66 批 | 第 67 批 |
|---|---:|---:|
| 后端路由 | 701 | **702** |
| web 可静态解析调用 | 408 | **544**（+136） |
| 未解析（被跳过/白名单） | 133 处跳过 + 4 处白名单 | **0** |
| api 用例 | 881 | **883** |
| 总用例 | 1,254 | **1,256** |
| 全站进度 | 202.45 / 98.3% | **202.45 / 98.3%（不变）** |

诚实边界：这道门禁只保证「路径形状能对上」，**不校验 query / body 语义**，也**不校验方法语义**
（`POST /x` 与 `GET /x` 各算各的，不会互相顶替）。它拦的是「把路径写错」，拦不住「把参数写错」。

## 变更登记（v6.20 · 第 66 批：前端把分组接口写成了 `/team/groups`，而 `catch` 把 404 吞成「没有分组」 · 2026-10-28）

> 批次台账见 [implement-progress-vs-reelmate.md](07-plan/implement-progress-vs-reelmate.md) §9 **v8.9**（同一批；本文件与主台账各有一套编号，勿混）。**这批不加分**：修的是第 63 批已计分功能的实现缺陷，不是新增能力。

### 一、用户会看到什么差别

- **之前**：作品页（`/works`）顶部的「分组」筛选下拉**从来不出现**；每张工坊卡片也不会显示所属分组。团队明明建过分组，页面上就是没有。
- **现在**：进页面就会拉团队分组，下拉可选「全部 / 未分组 / 具体组」，卡片上显示「分组：运营一组」，还能在卡片上就地换组。

### 二、缺陷本体

```ts
// apps/web/pages/works.vue（第 63 批写的）
const data = await api.get<...>("/team/groups");
//                                   ^^^^^^^^^^^^ 后端没有这条路由
```

后端的分组接口在 `TeamController` 上，而它的 `@Controller("cam")` —— 真实路径是 **`/cam/team/groups`**：

```ts
@Controller("cam")
export class TeamController {
  @Get("team/groups")
  async groups(@Req() req: AuthedRequest) { ... }
}
```

同一份代码库里，`apps/web/pages/team/index.vue:202` 写的就是 `"/cam/team/groups"` ——**只有作品页写错了**。

### 三、为什么活了一整批（四道关全都没拦住）

| 关卡 | 为什么没拦住 |
| --- | --- |
| TypeScript | 路径是字符串，类型系统不参与 |
| ESLint | 不校验 URL 与后端契约 |
| 构建（`nuxt build`） | 静态构建不请求后端 |
| 总闸 `verify-round.ps1` | 12 项里没有「前端路径 ↔ 后端路由」这一项；E2E 只测 i18n 与页面内容 smoke，不断言业务数据 |
| 页面自身 | `loadGroups()` 的 `catch` 把异常吞成 `groups.value = []` ——**404 的表现是「没有分组」，不是报错** |

这就是它和第 65 批那 36 条 CLI 死链的同一个根因：**没有契约守卫，就没人会发现**。

### 四、同一批修掉的两个「审计自身」错误

这两个坑比缺陷本身更值得记，因为它们会制造**假缺陷**：

1. **一个 `*.controller.ts` 里可以有两个 `@Controller` 类**（`admin` / `agent-stt` / `novel-variant` / `op` / `task-share` 共 5 个文件如此）。只取第一个会把第二个控制器的路由错挂到前一个的 base 上：`RedeemCodeController`（`@Controller("redeem-code")`，就在 `op.controller.ts` 下半部分）因此被算成 `/op/redeem-code/redeem`，于是 `apps/web/pages/invite.vue` 里的 `/redeem-code/redeem` 被误报成缺陷——**它其实是对的**，我差点去「修」一段正确的代码。
2. **首参正则必须锚定在动词之后**。写成搜索式（不带 `^`）时，遇到 `api.post(path, {...})`（首参是变量）会向后跳过、把**下一条**调用的字面量错配给上一条动词——实测把 `api.get("/crc/assets/me?status=3")` 报成了 `POST /crc/assets/me`。

### 五、守卫：`apps/api/test/web-api-contract.spec.ts`（4 例）

| 用例 | 断言 |
| --- | --- |
| 后端路由量 | `> 600`（防解析失败导致集合为空时假绿） |
| web 调用量 | `> 300`（防正则失效导致"0 处可比"时假绿） |
| 全量匹配 | 408 处可静态解析的 `api.<verb>(<字面量>)` 全部能在后端路由表里找到（两侧占位符互为通配：web 的 `${kind}` 是 `"buy" \| "preorder"` 这种字面量联合，静态拿不到值） |
| 回归锚点 | `GET /cam/team/groups` 在路由表里、`GET /team/groups` 不在 |

**反向验证**（证明不是假绿）：`_acceptance/_r66_flip.py break` 把 `works.vue` 的路径改回缺陷值 → 测试立刻红并打印 `GET /team/groups ← pages\works.vue:105 raw=/team/groups`；`restore` 后复绿。

同时把第 65 批 `apps/cli/test/registry-routes.spec.ts` 的 `backendRoutes()` 也改成逐段解析全部控制器（同一处缺陷），复跑 CLI 审计：`backend routes: 701 / ready-with-http: 109 / missing: 0`。

### 六、验证与数字

- `npx vitest run test/web-api-contract.spec.ts` → **4/4 绿**；反向验证红→绿各一次
- cli `npx vitest run` → 14 文件 **99 例**绿；api 全量 → 77 文件 **881 例**（原 877，+4）
- `pnpm --filter @app/{api,web} typecheck` 干净；`web lint` 0 errors / 28 warnings（既有）；`pnpm --filter @app/web build` Σ 7.23 MB
- 总闸 `pwsh _acceptance\verify-round.ps1` → **12/12 全绿**
- 规模：端点 702 / 迁移 42 / 表 112 / cli 197（38 组）；web `.vue` 54,678 行；用例 1,250 → **1,254**
- 评分：全站 **202.45/206 = 98.3%**、剩余 **3.55**、核心 107.53（97.8%）、生态 94.92（98.9%）、首发 130.53（98.1%）——**不变**

### 七、诚实边界

- 只覆盖**静态可解析**的调用（408 处）。另有 **133 处**首参是变量或拼接前缀（集中在 `useCanvasApi.ts` 的 `canvasBase()` 这类 composable），静态无法解析，**故意不扫**——扫了只会制造假红。这类要靠"路径构造函数只有一个出口"的写法约束，不是靠正则。
- 守卫保证的是「路径形状对得上」，**不校验 query 名与 body 语义**（那需要后端 schema 反射或契约文件）。
- 本批只抓到 1 条真缺陷，但这不等于"前端只有 1 个问题"：结论的边界是"**在 408 处可静态解析的调用里只有 1 处路径不存在**"。

## 变更登记（v6.19 · 第 65 批：审计出 36 条「宣称可用的 CLI 命令」实际全 404，并补上跨包守卫 · 2026-10-28）

> 批次台账见 `07-plan/implement-progress-vs-reelmate.md` §9 v8.8（同一批；本文件与主台账各有一套编号，勿混）。
> **这批加分**：202.37 → **202.45/206 = 98.3%**，剩余 3.63 → **3.55**（#9 CLI/MCP 96% → 97%，+0.08）。

### 一、这批不是「加功能」，是原计划的取证失败后转做可证伪的事

原本要补 #11 画布里竞品有、我方没有的 `pinned-timelines`。竞品 4 条形状是清楚的（`type` 与路径都从 `core-lib-CKH7gQsw.js` 取到）：

| 方法 | 路径 | 请求形态 |
|---|---|---|
| POST | `/web/v1/df/canvas/:canvas_id/pinned-timelines` | `json` |
| GET | `/web/v1/df/canvas/:canvas_id/pinned-timelines` | `query` |
| DELETE | `/web/v1/df/canvas/:canvas_id/pinned-timelines/:node_id` | `form` |
| DELETE | `/web/v1/df/canvas/:canvas_id/pinned-timelines` | `form` |

但把两个 bundle 目录（133 + 473 个 js）扫干净后，`pinned-timelines` 只命中**端点配置对象本身**；`pinnedTimelines`/`pinned_timelines` 0 命中；
`timeline_id` 的 3 处命中全是**会话时间线事件**（`t.type === "timeline"` 且 `t.update_mode ∈ {append, replace}`，另有一处 `upsertTimelineEvent`），与画布固定时间线无关。
**没有 body/响应字段、没有客户端消费代码** → 造出来就是自建语义。于是放弃，转去做一件可以机械证伪的事：

> **CLI 里那些 `ready: true` 的命令，真的指向后端存在的路由吗？**

### 二、答案是「有 36 条不指向」

写 `_acceptance/_r65_cli_audit.py`：解析 52 个 controller 的 `@Controller` + 方法装饰器建路由表（把 `:id` 与 `{id}` 双向归一成 `{}`），与 `apps/cli` 的 197 条命令逐条比对。

结果：**140 条 `ready` 里 36 条不匹配**，且**全部集中在 canvas 家族**六个组（`canvas` / `node` / `group` / `pin-group` / `material` / `script`）：

```
canvas create            POST   /canvases                         ← 写成 canvases...
canvas template-list     GET    /templates                        ← 写成 templates...
node generate            POST   /canvases/{}/nodes/{}/generate    ← 少了 canvas/ 前缀
script storyboard        POST   /canvases/{}/nodes/{}/storyboard-parse
...
```

根因一句话：这些后端路由都挂在 `@Controller("canvas")` 下（`apps/api/src/modules/canvas/*.controller.ts` 与 `modules/agent/canvas-chat.controller.ts`），
真实路径是 `/v1/canvas/canvases/...`、`/v1/canvas/templates/...`；而 `registry.ts` 里写的是 `canvases/...`、`templates/...`——**漏了 `canvas/` 模块前缀**。

**运行时钉死（不是靠读代码猜）**：把 api 起在 3002 后直接打两条路径

```
GET /v1/canvases        → 404  {"code":400102,"msg":"Cannot GET /v1/canvases"}
GET /v1/canvas/canvases → 200  {"code":401101,"msg":"missing bearer token"}   ← 路由存在，只是没带 token
GET /v1/templates       → 404
GET /v1/canvas/templates→ 200  {"code":401101,...}
```

即这 36 条命令**对外宣称可用、实际一条都调不通**。

### 三、为什么这类缺陷能活 4 批

- 原有 CLI 单测（97 例）只校验**参数解析与响应转换**，从不断言「URL 是否等于后端真实路由」；
- 总闸 `verify-round.ps1` 只跑 api / worker 的测试，**CLI 侧没有跨包一致性检查**；
- 每条命令的 `ready: true` 是人工判断"后端有这个能力"，而 `path` 是手写的字符串——**两者之间没有任何机器校验**。

于是「140 条 ready」这个数字一直好看，但它统计的是"我打算实现多少"，不是"实际能调通多少"。

### 四、修法与守卫

1. `apps/cli/src/registry.ts`：36 条 path 统一补 `canvas/` 前缀。
   **为什么说这是漏改而不是设计**：同一个文件里 `agent` 组的命令本来就写成 `canvas/canvases/{canvas_id}/chat/sessions`——
   正确的写法在仓库里已经存在，只是 canvas 家族没跟上。
2. `apps/cli/test/registry-routes.spec.ts`（**新增，2 例**）：
   - 例 1：**只读地读 `apps/api` 的 controller 源码**建路由表，与本包所有 `ready` 且走 HTTP 的命令逐条比对（找不到 api 源码则 skip）；
   - 例 2：canvas 家族的命令必须带 `canvas/` 前缀。
   - 还做了**反向验证**：把 `canvas list` 的 path 改成坏值 → 两例立刻红；再改回 → 绿。并用 `routes.size > 600` 兜住"解析失败 → 空集合 → 全绿"这种假绿。
3. `apps/cli` 的 build 尾部 `gen-skill` 重生成随包 Skill：canvas / node / group / pin-group / material / script 六篇 `commands/*.md` 随路径更新（43 文件里改了 6 个）。

### 五、验证与数字

| 项 | 结果 |
|---|---|
| `_r65_cli_audit.py` 复跑 | `ready 140 / 不匹配 **0**` |
| `apps/cli` 单测 | 13 文件 **97 → 14 文件 99 例** 全绿（新增 2 例） |
| 反向验证 | 改坏 1 条 path → 2 例立刻红；改回 → 绿 |
| 总闸 `verify-round.ps1` | **12/12 全绿** |

规模与分数：#9 CLI/MCP **96% → 97%（+0.08）**；全站 **202.37 → 202.45/206 = 98.3%**，剩余 **3.63 → 3.55**；
核心 107.53（97.8%，#9 不在核心组故不变）、生态 **94.84 → 94.92（98.9%）**、首发 130.53（98.1%，#9 属剔除模块）；用例 **1,248 → 1,250**（cli 97 → 99）。
端点 702 / 迁移 42 / 表 112 / 命令 197（38 组）均不变。

### 六、诚实边界

- 这批**修的是可用性缺陷，不是新增能力**：57 条骨架命令仍缺后端端点，所以 #9 只到 97%，剩余 0.24 如实记在 §5 第 4 行；
- 顺带判定了 #11 画布的一处文档不自洽：缺口栏原文写「无」却只给 99%。查清那 1% 的真实出处是竞品有 `pinned-timelines` 4 条形状而我方没有，
  但**竞品前端不消费该响应、无字段级证据** → 不凭空造，据实记为 0.20 待外部证据（**分数不变**：不能因为"找到了一个缺口"就扣分，也不能因为"补不了"就加分）；
- 守卫测试的价值边界：它保证**路径形状**一致，不校验 query 参数名、body 字段与权限语义——那三类仍然只能靠逐批人工比对竞品 bundle 与集成测试。

---

## 变更登记（v6.18 · 第 64 批：#4 Agent 的 Skill 市场按竞品 9 条形状补齐，顺手纠正一条挂了 60 批的错误归因 · 2026-10-28）

> 批次台账见 `07-plan/implement-progress-vs-reelmate.md` §9 v8.7（同一批；本文件与主台账各有一套编号，勿混）。
> **这批加分**：202.17 → **202.37/206 = 98.2%**，剩余 3.83 → **3.63**（#4 95% → 96%，+0.20）。

### 一、缺口栏写错了一个前提

`implement-progress-vs-reelmate.md` 里 #4 Agent 的缺口，从第 4 批起就写成两句：「真实 ASR 凭据」+「**平台 Skill 档位与竞品对齐需竞品清单**」。

第二句把一半分数挂在"还没拿到的清单"上。这批先去确认清单到底存不存在——`_acceptance/competitor_endpoints.tsv`（从 `core-lib-CKH7gQsw.js` 的 934 个端点配置对象去重导出，**904 条唯一端点**）里，`canvas/agent-skills` 一共 **9 条**，而且**每条都带查询参数名**：

```
GET    /web/v1/df/canvas/agent-skills/plaza      query=["category","name","page","page_size","is_home_recommend"]
GET    /web/v1/df/canvas/agent-skills/favorites  query=["page","page_size"]
GET    /web/v1/df/canvas/agent-skills/mine       query=["status","page","page_size"]
GET    /web/v1/df/canvas/agent-skills/details    query=["skill_id","owner_type"]
POST   /web/v1/df/canvas/agent-skills
PUT    /web/v1/df/canvas/agent-skills            ← paramNames / queryNames 全空
DELETE /web/v1/df/canvas/agent-skills/:skill_id  params=["skill_id"]
POST   /web/v1/df/canvas/agent-skills/:skill_id/favorite   params=["skill_id"]
DELETE /web/v1/df/canvas/agent-skills/:skill_id/favorite   params=["skill_id"]
```

**清单一直在，只是没人去取。** 我方此前 9 条端点形状对得上，缺的是参数与字段：

| 缺口 | 竞品证据 | 后果 |
|---|---|---|
| 没有更新端点 | `PUT /canvas/agent-skills`（params/query 全空 ⇒ 目标卡只能从 body 带） | 卡片改名只能"删了重建"，收藏数会归零 |
| 四个筛选参数未接 | `plaza`:`name`/`is_home_recommend`、`mine`:`status`、`details`:`owner_type` | 前端按名字查、按推荐位筛、看下架卡，全都做不到 |
| DTO 缺 `name_en`/`owner_type`/`is_home_recommend` | `we.name_en?.trim()===t.trim()`；`d.owner_type===1\|\|d.owner_type===2` | 前端要靠猜 |

### 二、`name_en` 不是包装，是真缺陷

竞品把英文名当**一等字段**用：

```js
// 精确查重（不是模糊匹配）
we.name_en?.trim() === t.trim()
lookupPlazaSkillByNameEn(...)
Vr.addSkillRef({ skill_id, name, name_en, owner_type })
```

我方只把它塞在 `config.slug` 这个 JSON 里。`config` 是 jsonb，写进去就：

- **不能建索引**——按英文名查要全表扫 `config->>'slug'`；
- **不能在 SQL 层查重**——两张卡的斜杠指令名撞车时，只能靠**前端第一次匹配到谁**，谁先谁生效；
- **不能在列表里稳定排序/筛选**。

所以迁移 `0041_lyrical_darkhawk.sql` 把它提成列，并且**手工追加了第 4 条回填**（前 3 条是 `drizzle-kit generate` 生成的，回填是我加的）：

```sql
ALTER TABLE "agent_skills" ADD COLUMN "name_en" text DEFAULT '' NOT NULL;
ALTER TABLE "agent_skills" ADD COLUMN "is_home_recommend" boolean DEFAULT false NOT NULL;
CREATE INDEX "idx_agent_skills_home" ON "agent_skills" USING btree ("is_home_recommend","use_count" DESC NULLS LAST);
-- 手工追加：只加列不回填，等于把已有的斜杠指令名留在 JSON 里继续飘
UPDATE "agent_skills" SET "name_en" = COALESCE("config"->>'slug', '') WHERE "name_en" = '';
```

实测：33 张平台卡，`with_name_en = 33`（全部有值）。迁移 41 → **42**。

### 三、四个不显然的决定

| 决定 | 内容 | 为什么 |
|---|---|---|
| 改 `name_en` 要同步三个派生态 | 列 + `config.name_en` + `config.slug` + `config.slash` 一起改 | 老前端还在读 `config`；只改列会让新旧两处指令名分裂 |
| `name` ≠ `q` | `name` → `or(ilike(name), ilike(nameEn))`；`q` → 全文（含 prompt） | 全文会把 prompt 里偶然提到该词的卡一起返回，按名字查的用户会以为筛错了 |
| `is_home_recommend=0` 是「排除」，不是「全部」 | 三元：不传=不过滤、`1`=只推荐位、`0`=排除推荐位 | 与 `status` 的语义保持一致；把 `0` 当"全部"是最常见的参数误读 |
| `mine?status` 不能写死 1 | `mine` 用 `eq(status, query.status ?? 1)`，去掉 `alive()` | 运营下架的卡要能在「我的」里被看见并恢复，写死就永远捞不回来 |
| `owner_type` 只做收敛、不做探测 | 类型不符一律 400102 | 否则调用方可拿它反查某个 id 是平台卡还是团队卡 |

### 四、`PUT` 的权限矩阵

新增 `PUT /agent-skills`（`updateSchema = createSchema.partial().extend({ skill_id })`），校验顺序是**先归属、再权限、后字段**：

| 场景 | 结果 |
|---|---|
| 平台卡（`space_id is null`）| `403101 platform skill cannot be edited`，reason `platform_skill` |
| 别的空间 | `400102` |
| 本空间但不是创建人 | `403101 only the creator can edit this skill` |
| `name_en` 撞同空间已有卡 | `400101 name_en already exists in this space`，`field: "name_en"`（更新时 `ne()` 排除自己）|
| `name_en` 不是 `[a-z0-9-]` | `400101`（zod 正则）|
| `skill_id` 缺失 / 非数字 / 不存在 | `400101` / `400101` / `400102` |

### 五、验证

| 用例 | 覆盖 |
|---|---|
| 更新卡片：仅创建人可改、`name_en` 查重、平台卡 403、他人不可见 | 权限矩阵 4 种；`config.slug`/`name_en`/`slash` 三处同步；7 种非法入参 |
| 竞品形状：`name` / `is_home_recommend` / `mine?status` / `details?owner_type` 都能筛 | 四个参数各自生效；`is_home_recommend=0` 排除语义；下架卡只在 `mine?status=2` 出现；`owner_type=3` → 400101，`details?owner_type=2` 查平台卡 → 400102 |

`apps/api/test/agent-skills.spec.ts` 9 → **11 例**；api 875 → **877 例**，总 **1,248 例**。`apps/api` typecheck / lint / build 全干净，`_acceptance/verify-round.ps1` **12/12 全绿**。

规模：**702 端点 / 42 迁移 / 112 表 / 1,248 用例 / web 54,672 行 `.vue`**。

### 六、诚实边界：为什么只到 96%

竞品只给了**接口形状 + 字段名**，没有给**广场卡内容**与**首页推荐位编排**的数据证据（`is_home_recommend` 在 bundle 里只作为筛选参数出现，没有任何"哪些卡该上推荐位"的规则或默认值）。所以：

- `is_home_recommend` 默认全 `false`，推荐位策略仍按自建口径（运营后台勾选）；
- #4 从 95% → **96%**，剩 **0.80** = 真实 ASR 凭据约 **0.60**（现诚实返回 `available:false`，不假造转写结果）+ 运营位内容约 **0.20**。

「0.60 / 0.20」是**判断而非实测**，两个数都已写进 §5 第 1 行。这批的净收益不是那 0.20 权重，而是**把一条错误归因改成了一条真实的能力缺口**：前者只能等一份不存在的清单，后者运营配一次就能验。

---


## 变更登记（v6.17 · 第 63 批：#5 项目归属组 + 竞品两级分类投影，A 类缺口清零 · 2026-10-28）

> 批次台账见 `07-plan/implement-progress-vs-reelmate.md` §9 v8.6（同一批；本文件与主台账各有一套编号，勿混）。
> **这批加分**：202.08 → **202.17/206 = 98.1%**，剩余 3.92 → **3.83**（#5 94% → 97%，+0.09）。

### 一、先把语义搞对：竞品的「分组」是"项目归属组"，不是"项目文件夹"

上一批把「项目分组 + 五档分类」记成「证据已拿到、待排期」，其实只拿到了**参数名**，没拿到**语义**。这批先把语义钉死：

```
// Cp3a6_yk.js —— 换组动作
g.open("project-change-group", { sp_id, old_group_id: t.group_id ?? "0", old_group_name })

// DDLTpMu7.js —— 文案 key（关键判据）
project.groupOwnership.changeModal.title
project.groupOwnership.tooltip.noPermission
data-testid="home-film-project-change-group"   // 按钮，由 canChangeGroup 控制 disabled
```

`groupOwnership` 这三个字说明它不是「文件夹」，而是**归属关系**。再往下一层验证：分组本身的 CRUD 根本不在 `script_project` 域，而在**团队域**（`D7aUDXP7.js` 的「端点→权限码」映射表）：

```
POST /web/v1/cam/team/:team_id/group              → group.create
POST /web/v1/cam/team/:team_id/group/:group_id/edit → group.edit
POST /web/v1/cam/team/:team_id/group/:group_id/delete → group.delete
GET  /web/v1/cam/team/:team_id/groups             → group.view
POST /web/v1/cam/team/member/change-group         → group.member_change
```

而 `script_project` 域自己**只有两个** group 端点：`list` 的一个 `group_id` 查询参数，和 `POST /script_project/:sp_id/group/edit`。**没有分组 CRUD。**

### 二、所以不建第二套分组表

我方已经有 `team_groups`（含负责人、排序、启用/停用）与它的 CRUD。再建一套「项目分组」就会出现两套分组、两套权限、两套计数，且用户会在两个地方看到"分组"却互不相通。做法：

| 决定 | 内容 | 为什么 |
|---|---|---|
| 复用 | 迁移 `0040_stiff_tyrannus.sql`：`script_projects.group_id` → `team_groups.id` | 竞品的分组 CRUD 在团队域，归属关系才是项目侧的事 |
| 外键语义 | `on delete set null` | 组被删时项目**退回未分组**，而不是悬空或跟着组一起消失 |
| 取消分组 | 接 `null` / `"0"` / `""`，内部一律写 `null` | 写 `0` 会留下悬空外键 |
| 校验 | 跨空间组 400102、停用组 400101、非数字 400101 | 三条缺一条都会让"归属"说谎 |
| 端点 | `POST /script/projects/:id/group` | 对齐竞品 `POST /script_project/:sp_id/group/edit` 的语义 |

### 三、分类：把竞品口径当「视图」，不当「真相」

竞品有两套分类：`project_category`（SHORT_FILM=1 / DRAMA=2 / FILM=3）与 `project_subcategory`（ALL=0 / AI_SHORT_FILM=1 / AI_AD_DRAMA=2 / AI_DRAMA=3 / VIDEO_REDRAW=4），UI 上是五档 tab。我方已有 `kind`（workshop/canvas）+ `project_mode`（1 普通 / 2 广告剧 / 3 转绘）。

**不给项目加第二套分类列**——两套分类同时落库，必然出现「改了 `project_mode` 忘改 `project_category`」的漂移。做法是 `packages/shared/src/project-category.ts` 里的**双向映射**：

```
AI 剧 DRAMA_WORKFLOW   category 2 / subcategory 3  →  workshop, mode 1
画布 CANVAS            category 1 / subcategory 1  →  canvas
广告剧 AD_DRAMA        category 1 / subcategory 2  →  workshop, mode 2
视频转绘 VIDEO_REDRAW  category 2 / subcategory 4  →  workshop, mode 3
影视版 FILM            category 3 / subcategory 0  →  无对应 → 400101
```

- **反方向也下发**：`/works` 每行都带 `project_category`/`project_subcategory`，调用方两边都能读。
- **FILM 明确拒收**，msg 写清「由影视模块承接」——假装支持会让调用方以为筛过了。
- **只给 `project_category=1` 是二义**（画布 vs 广告剧）→ 也 400101，要求补 `project_subcategory`。
- `project_categories`（逗号多选）逐个翻译，**任一不支持即整体拒绝**，不做部分筛选。

### 四、跑测试才暴露的真 bug：`canvasFilterable`

`tab=all` 时画布和工坊两路各自过滤后内存归并，而画布那路的 `canvasFilterable` 只看 `kind`/`keyword`/时间段，**不吃 `group_id`/`projectMode`**——于是「按组筛选」的结果里会混进**所有画布**。两条都补上：设了 `projectMode` 直接排除画布；`groupId` 非空且非 `"0"` 时也排除（画布没有分组概念）。

这个 bug 靠读代码很难发现（两路过滤逻辑分居两个函数），是新增的「按组过滤只回该项目」断言把它逼出来的。顺带记一个夹具坑：该测试空间的登录会自动带一条示例作品「示例：雨夜来信」（`is_sample=1`），凡是"只回我造的项目"的断言都必须按 `stamp` 过滤。

### 五、验证与数字

| 用例 | 覆盖的不变量 |
|---|---|
| 赋组 / 列出 `group_id`+`group_name` / 按组过滤 | 归属写入与投影一致；未分组回 `"0"` |
| `"0"`、`null`、`group_id=0` 三种取消写法 | 三种入口都不留悬空外键 |
| 跨空间组 400102 / `"abc"` 400101 / 不存在组 400102 | 归属不能跨空间，也不能指向停用组 |
| 两级分类投影（画布 1/1、剧本 2/3） | 双向映射两边一致 |
| FILM / 只给 category=1 / subcategory=9 / `categories=2,3` → 400101 | 不支持的就报错，不静默筛空 |

规模：`works-aggregate.spec.ts` **9 → 11 例**，api 全量 **875 例**；迁移 40 → **41**、端点 700 → **701**；`verify-round.ps1` **12/12 全绿**。

**诚实边界**：`sp_source`/`sp_type` 仍**拒收**（我方无对应维度，不硬凑）；FILM 档不假装支持；五档 tab 的**列表 UI** 未做（我方 tab 是形态维度：工坊/画布/全部）。所以 #5 只到 **97%**，剩 0.09 如实记在 §5 第 5 行——**A 类缺口至此清零，代码侧不再有"排一轮就能加分"的整块**。

---

## 变更登记（v6.16 · 第 62 批：#5 全部项目补「画布封面」，并把「项目分组/分类」从"卡证据"改记为"待排期" · 2026-10-28）

> 批次台账见 `07-plan/implement-progress-vs-reelmate.md` §9 v8.5（同一批；本文件与主台账各有一套编号，勿混）。
> **这批加分**：201.96 → **202.08/206 = 98.1%**，剩余 3.92（#5 90% → 94%，+0.12）。

### 一、这批补的是真缺口：画布项目「永远没有封面」

用户面上最直观的差别在这里——竞品的「全部项目」列表里，每个画布项目都有缩略图；我方的画布卡片**只渲染一个空占位**。不是样式没写，是**后端根本不给**：

```ts
// works.service.ts（本批前）queryCanvas 的 CTE 只统计三个数
merge_row.node_count, merge_row.running_nodes, merge_row.failed_nodes
// DTO 里直接写死
cover_uri: null,
```

竞品证据（Vite 产物，`_acceptance/competitor_endpoints.tsv` 与两个 mapper 文件）：

```
GET  /web/v1/df/script_project/list
     queryNames = page, page_size, name, group_id, process_status, sp_source,
                  sp_type, project_category, project_subcategory, project_categories
     响应字段  = sp_id, name, cover, covers[], updated_at, created_at, creator_nick,
                  group_id, group_name, sp_source, sp_type, project_category, project_subcategory
Cp3a6_yk.js  function q(e){ const a=e.cover||""; return a || U(e)[0] || "" }   // cover || covers[0]
Cp3a6_yk.js  设封面 = POST /df/script_project/edit { cover: <file_id>, sp_id }
```

注意 `cover` 是 **file_id**，不是 URL。这一条决定了落库形状。

### 二、三个不显然的设计决定

| 决定 | 为什么不能图省事 |
|---|---|
| 存 `cover_asset_id`（外键 `on delete set null`），不存 URL | URL 里带签名/对象 key，素材被删或存储换域名后就是死链；外键 `set null` 让"人工指定的封面没了"自动退回自动兜底，而不是留一个 404 的 `img` |
| 三档取值：人工 `asset_id` → 节点 `node_id` → 自动兜底 | 竞品只有一档（显式 file_id）。我方画布是节点图，"这张图画布当封面"最自然的动作是**在检查器里对当前节点点一下**，所以支持 `node_id`；不传任何参数=清除，清除后回落到"画布内最近一次图片节点产物"，而不是变空白 |
| 独立端点 `POST /canvas/canvases/:id/cover`，不塞进 `PATCH canvases/:id` | `PATCH` 改名要带乐观锁 `version`（并发编辑冲突检测）。封面与画布内容无关，塞进去会让"只想换个封面"也必须提交版本号，冲突条误触发 |

自动兜底的 SQL 只有一个 join 方向：`canvas_nodes.task_id` → `assets.source_task_id`（产物是任务写的，不是节点写的）。`works.service.ts` 里则是同一逻辑的 CTE 子查询，且 **`order by (a.id = c.cover_asset_id) desc, a.id desc`** —— 人工封面永远排第一。

### 三、顺手补齐的竞品参数名（以及**明确拒绝**的 6 个）

竞品叫 `name`，我方叫 `keyword`；竞品用 `process_status=-1` 表示"全部"，我方是 `status=all`。两个都当别名接住了，并有用例钉死。

剩下 6 个（`group_id`/`sp_source`/`sp_type`/`project_category`/`project_subcategory`/`project_categories`）**没有接**：我方项目没有"分组"和"分类"维度。处理方式不是"静默忽略"，而是 **zod 直接拒绝**：

> 静默忽略比报错更危险——调用方会以为筛过了，拿到的是没筛的全集。

### 四、验证

| 层 | 内容 |
|---|---|
| api 测试（`works-aggregate.spec.ts` 6 → 9 例） | ① 画布无人工封面时自动取最近图片节点产物，`/works` 返回**签名后**的 `cover_uri` 且 `covers` 恰为 `[cover_uri]`；② 人工指定 → 优先；节点指定 → 解析到该节点产物；`{}` 清除 → 回落自动；跨 space → 400102；非法 id → 400101；③ 参数别名 `name`/`process_status=-1` 生效、`process_status=1` → 400101 |
| 手工核对 | `node_count` 从 2 变 3（新增一个产物节点）后，原有跨域投影断言与 SQL count 断言**同步改 3**，不放过"顺手放宽断言" |
| 全站总闸 | `pwsh _acceptance/verify-round.ps1` → 12/12 全绿 |

### 五、诚实边界：这批**没有**打到 100%

- 工坊项目没有"创建人"字段 → `creator_nick` 明确返回 `null`，**不拿空间 owner 冒充项目创建人**。
- 项目分组（`group_id`/`group_name` + `POST /df/script_project/:sp_id/group/edit`）与五档分类（`project_category`/`project_subcategory`，两项枚举原文已取到）**本批没做**。所以 #5 只从 90% → **94%**；同时把这些从"卡竞品证据"**据实改记**为 A 类"待排期 0.18"（§3.5），因为这批证明证据已经在手、不卡任何人。

---

## 变更登记（v6.15 · 第 61 批：#9 CLI/MCP 补 Agent 分发通道 `skill-path` + 随包 Skill，并纠正一条写错多轮的「MCP 缺口」· 2026-10-28）

> 批次台账见 `07-plan/implement-progress-vs-reelmate.md` §9 v8.4（同一批；本文件与主台账各有一套编号，勿混）。
> **这批加分**：201.64 → **201.96/206 = 98.0%**，剩余 4.04（#9 92% → 96%，+0.32）。

### 一、这批修的不是"缺个命令"，是"Agent 拿不到任何使用说明"

竞品把 CLI 接进各类 Agent 的**唯一**方式，是把 Skill 包随 npm 包一起分发、再让宿主整目录拷走。证据是它自己文档里的三句话（`_acceptance/reelmate_cli_skill/`，从 `rea-reelmate/reelmate_cli_skill.zip` 解出，63 个文件）：

```
INSTALL.md:17  reelmate skill-path  →  打印「已安装 npm 包内」的 Skill 目录
INSTALL.md:44  Skill 留在 npm 包内。要给某个 Agent 用时，把 skill-path 的目录整份拷到该宿主的 Skill 目录
INSTALL.md:44  若已有同名 reelmate-cli-skill 先「整目录删除」再拷入（禁止与旧文件合并）
SKILL.md:41    升级时用它整目录替换当前宿主 Skill，不要只跑 npm，不要落地 zip 解压出的 Skill
```

我方逐项对照：

| 竞品有 | 我方（本批前） |
|---|---|
| `reelmate skill-path` 打印包内 Skill 目录 | **没有**（`git grep skill-path` 在 `apps/cli/src` 零命中） |
| Skill 包随 npm 包分发（43 个文件：`SKILL.md` / `INSTALL.md` / `manual/*` / `commands/*`） | **没有**（连 `skills/` 目录都不存在） |
| `package.json` 的 `files` 覆盖 Skill 目录 | **没有 `files` 字段** → 发版产物里根本带不出 Skill |

**后果**：Agent 装上 `oneframe` 后，只能靠 `--help` 猜；197 条命令的**契约、退出码、哪些命令是骨架（`ready:false`）** 全在源码里，宿主 skill 拿不到。这不是"少了个便利命令"，是**分发通道缺失**。

### 二、做法：命令文档一律生成，绝不手写

```
apps/cli/src/skill.ts            renderAllFiles() → 43 个文件（纯函数，无 I/O）
apps/cli/scripts/gen-skill.cjs   build 尾部调用；内容没变就不写盘（不弄脏 git）
apps/cli/skills/oneframe-cli-skill/
  SKILL.md                 手写的「行为约束」：frontmatter + <HARD-GATE> 8 条 + 10 行路由表 + 契约 + 升级段
  INSTALL.md               手写的 9 步 Agent 安装流程
  VERSION                  生成的（取 CLI_VERSION）
  manual/user-guide.md     生成的
  manual/error-codes.md    生成的：退出码 0..10 全表 + error.kind→退出码 + BUSINESS_CODE_MAP 全表
  commands/<group>.md ×38  生成的：每篇由 registry 里该组的 summary/syntax/evidence/ready 拼出
```

`SKILL.md` 里手写的只有**永远不会从代码推出来的东西**（路由表、`<HARD-GATE>` 行为约束）；凡是"命令有哪些、怎么拼、哪些还没实现"一律从 `registry.ts` 渲染——**手写 197 条命令文档必然与代码漂移，而漂移的文档比没有文档更糟**（Agent 会照着已改的语法调用）。

`oneframe skill path --json` 实际输出：

```json
{"skill":"oneframe-cli-skill","path":"…/apps/cli/skills/oneframe-cli-skill","installed":true,
 "version":"0.1.0","groups":38,"commands":197,"files":43,"note":"把整个目录整份拷入宿主 Skill 目录…"}
```

`installed` 以包内**是否真有 `SKILL.md`** 判定；目录不完整时 `note` 明确提示先 `pnpm --filter @app/cli build`——否则宿主会拷走一个空目录且毫无察觉。

### 三、顺手修的真缺陷：`747007` 在 CLI 侧没有退出码映射

第 60 批给后端加了「知识库重名」专用码 `747007`（竞品前端就是 `Number(r.code)===747007` 判重名）。但 `apps/cli/src/exit-codes.ts` 的 `BUSINESS_CODE_MAP` 没跟：任何未映射的业务码都落进 `internal` → **进程退出码 1**，于是调用方的重试逻辑会把"改个名字就能过"当成服务故障去重试。

```ts
// 第 61 批：知识库重名。第 60 批只加了后端码，CLI 侧缺映射会落进 internal/1 让脚本重试。
747007: { kind: "usage", exit: EXIT.USAGE },
```

### 四、纠正一条写错多轮的结论：「MCP 0 行，等竞品给工具清单」

`07-plan` 里 #9 的缺口栏写了好几轮：「**MCP 0 行**（竞品未公开工具清单 → 唯一真实缺口，待取证后再做）」。第 61 批把竞品两个 bundle 目录的 **606 个 js** 全量扫 `mcp`，只有 **3 处命中**：

| 命中 | 内容 | 含义 |
|---|---|---|
| `C_zfNpOW.js` | `O("MCP_CLI")` + `menu.mcpCli` | 侧栏一个 **flag 门控入口** |
| `D7aUDXP7.js` | `integration_type ∈ {plugin, mcp}` | 埋点归因参数 |
| `D7aUDXP7.js` | `client_source ∈ {cli, web}` | 埋点归因参数 |

**竞品不存在 MCP server、没有工具清单、没有 scope 定义、没有一个 `tools/list`**。也就是说「等竞品给工具清单」这个假设本身不成立——继续挂着它，等于把一个**不存在的依赖**写成"待取证"，读者会误以为补上是时间问题。

改判为：MCP 端**不实现**（无形状可对齐，自造一套 MCP server 反而是伪对齐）；#9 剩余 0.32 **全部来自 57 条骨架命令**（每条卡在对应后端端点未落地，权重已计入各模块，不重复计）。同批校正的规模口径：旧文档写「196 命令 / 37 组 / 118 可用 + 78 骨架」，实测已是 **197 命令 / 38 组 / 140 可用 + 57 骨架**。

### 五、验证

| 层 | 用例 | 钉住的到底是什么 |
|---|---|---|
| `apps/cli/test/skill.spec.ts` ① | 磁盘产物 vs `renderAllFiles()` **双向逐字节**一致 | 少一个=忘了生成、多一个=旧版残留，**两个方向都红** |
| ② | `SKILL.md` frontmatter + `VERSION` == `CLI_VERSION` | 版本号不会与包版本脱钩 |
| ③ | 每条 registry 命令都出现在某个 `commands/<group>.md` 的 `## \`id\`` | 新加命令不写文档 = 红 |
| ④ | `error-codes.md` 覆盖退出码全集 + `747007` + 「退出码是 1 不是 3」 | 退出码语义 |
| ⑤ | `skill path --json`：`installed:true`、**`calls` 为空**（不发任何请求） | 纯本地命令不许碰网络 |
| ⑥ | `commandSyntax` 恰为 `oneframe skill path [--json]`；`--help` 走纯文本分支 | 语法与 `--json` 契约 |

- `pnpm --filter @app/cli typecheck` 干净；`node scripts/gen-skill.cjs` → 写入 43 个文件；cli 单测 91 → **97 例**（+6）。
- `node -e '…registry…'` → **197 命令 / 38 组 / 140 ready + 57 skeleton**。
- 全站测试总量 1,232 → **1,241 例**（api 870 / adapters 164 / cli 97 / worker 52 / db 26 / shared 26 / storage 6）。
- `_acceptance/verify-round.ps1` 12/12 全绿。

### 六、边界（写在代码注释里，也写在这里）

1. **宿主 Skill 目录探测不做**：竞品 `INSTALL.md:18` 明确「不要扫描其他工具的配置目录」——靠用户或宿主规则给出路径，猜错会往无关目录里拷文件。
2. **MCP 端不实现**：无形状可对齐，理由见第四节。
3. **`skill path` 只报路径不替用户拷**：拷贝动作由用户在宿主侧执行，符合竞品契约（它也只打印路径）。

### 七、涉及文件

| 文件 | 性质 |
|---|---|
| `apps/cli/src/skill.ts` | **新增**：43 个文件的渲染器（纯函数） |
| `apps/cli/scripts/gen-skill.cjs` | **新增**：build 尾部生成，内容不变不写盘 |
| `apps/cli/skills/oneframe-cli-skill/**`（43 个） | **新增**：随包 Skill 产物 |
| `apps/cli/test/skill.spec.ts` | **新增**：6 例（含双向防漂移） |
| `apps/cli/src/registry.ts` | 加 `skill-path` builtin + `skill` 组 |
| `apps/cli/src/builtins.ts` | 加 `case "skill-path"` |
| `apps/cli/src/exit-codes.ts` | 加 `747007 → usage/1` |
| `apps/cli/package.json` | 加 `files: ["dist","skills"]` + `gen:skill` |
| `docs/07-plan/implement-progress-vs-reelmate.md` | §0 / §2.1 / §2.2 / §2.4 / §3.3 / §3.4 / §3.5 / §5 / §5.1 / §5.2 / §5.3 / §6.1 / §9 v8.4 |
| `docs/README.md` | 本条变更登记 |
| `docs/02-architecture/api-spec.md` | §17.20 |
## 变更登记（v6.14 · 第 60 批：#18 知识库补「模板场景」维度 —— 第一次从竞品前端 bundle 拿到字段级证据 · 2026-10-28）

> 批次台账见 `07-plan/implement-progress-vs-reelmate.md` §9 **v8.3**（同一批；本文件与主台账各有一套编号，勿混）。
> **这批加分**：201.63 → **201.64/206 = 97.9%**，剩余 4.37 → **4.36**；#18 `99% → 99.5%`（**只上调半格**，理由见末节）。

### 1. 这次承认一个方法错误：证据一直都在

此前从第 40 批起，每一轮在知识库/画布/Agent 这几处都写「竞品只给路由清单、没有响应体/字段证据，所以标待取证」。
第 60 批复核发现**是取证方法不到位**：竞品把 Vite 产物完整留在了本机——

```
rea-reelmate/scripts/files/origins/<hash>/assets/         133 个 js
rea-reelmate/scripts-canvas/files/origins/<hash>/assets/  473 个 js   ← 更全，知识库枚举只在这里
（<hash> = 2bdb9ddf0f70fcf8b6132b5151e837cc859b269e34db5a79cba8d0134474e75e）
```

两段原文直接改变了结论：

| 文件 | 大小 | 拿到了什么 |
|---|---:|---|
| `core-lib-CKH7gQsw.js` | 1.1 MB | **每个端点**的配置对象 `{path, method:Method.XXX, paramNames, queryNames, requestDataOptional, requestBodyType, responseBodyType}`。`requestDataJsonSchema` 是空对象 → 只有形状、没有字段级 schema |
| `0zWWdXb_.js` | 6 KB | 知识库**全部枚举 + 每类字段规则 + 10 条 tab 定义**（含真实表头列名） |

顺带产出了两份可复跑的取证产物（`_acceptance/` 被 gitignore，不进提交）：
`dump_competitor_endpoints.py` → `competitor_endpoints.tsv`（**904 条唯一端点**，METHOD/PATH/PARAMS/QUERY/OPTIONAL/FN），
以及 `our_endpoints.tsv` + `compare_endpoints.py`（我方 76 个 controller 的 **699 端点**）。
⚠️ 注意：按路径字符串比对的 `both=63 / only_comp=757 / only_ours=530` **说明不了覆盖率**——我方路径命名体系与竞品完全不同
（我方 `/knowledge/dirs` vs 竞品 `/user_knowledge/dir/list`）。**这个数字不能用来写"缺口 757 条"**，那会是虚报。

### 2. 由此发现的真缺口：竞品知识库是按「场景」分树的

`core-lib-CKH7gQsw.js` 里三个读接口的 `queryNames` 原文：

| 端点 | method | queryNames |
|---|---|---|
| `/web/v1/df/user_knowledge/dir/list` | GET | `["scene","parent_ukd_id"]` |
| `/web/v1/df/user_knowledge/tag/list` | GET | `["scene","query"]` |
| `/web/v1/df/user_knowledge/asset/search` | GET | `["scene","query","scopes","ukd_id","page","page_size","order"]` |

`scene` 是**第一个参数**，贯穿目录树、标签、资产三层 → 一个场景一棵目录树、一套标签。
而我方三张表（`knowledge_dirs`/`knowledge_tags`/`knowledge_assets`）**都没有 scene 列**：
「风格库」和「音色库」的目录会混在同一棵树里，标签也是全局一份（`uq_knowledge_tags(space_id,name)`）。
这不是"少一个筛选条件"，是**库的组织方式不同**。

### 3. 做了什么

1. **迁移 0038**（`smiling_inertia`）：三表各加 `scene smallint not null default 0`；
   标签唯一索引 `uq_knowledge_tags` 从 `(space_id, name)` 改为 **`(space_id, scene, name)`**；
   补 `idx_knowledge_dirs_scene`、`idx_knowledge_assets_scene`。迁移总数 38 → **39**。
2. **`packages/shared/src/knowledge-scene.ts`（新增）**：16 值 `KNOWLEDGE_SCENE` 枚举、业务串映射、
   `KNOWLEDGE_SCENE_RULES`（每类场景的名称上限/prompt 必填与上限/封面必填/是否有 prompt 列/是否首期）、
   `KNOWLEDGE_SCENE_TABS`（10 条，`columns` 与竞品表头**逐字一致**）、`validateKnowledgeSceneFields()`。
3. **错误码 `ErrorCode.KNOWLEDGE_NAME_EXISTS = 747007`** + 竞品原文文案 `knowledge name already exists`。
4. **服务层**：`dirTree`/`listTags`/`listAssets`/`searchAssets`/`flatList`/`info` 全部支持 `scene`；
   `createDir` 子目录跟随父场景；`createAsset`/`patchAsset` 按场景校验且**不允许跨场景挂目录**；
   `renameTag`/`deleteTag` 只改同场景条目；`info` 增 `asset_by_scene`。
5. **`/knowledge` 页面**：加场景 tab 条（16 个 tab + 条数角标，条数来自 `info.asset_by_scene`、不额外请求），
   切 tab 清目录选中并重载，新建条目带当前场景；i18n 新增 `knowledge.scene.*` 17 key × 5 语言。

关键代码（规则只维护一份，前端不抄第二份 —— 规则随条目下发）：

```
// apps/api/src/modules/knowledge/knowledge.service.ts（toAssetDto）
const rule = knowledgeSceneRule(row.scene);
return {
  scene: row.scene,
  scene_slug: row.scene === 0 ? "" : (KNOWLEDGE_SCENE_SLUG[row.scene] ?? ""),
  scene_name_max_length: rule.nameMaxLength,
  scene_prompt_required: rule.promptRequired,
  scene_prompt_max_length: rule.promptMaxLength,
  scene_prompt_column: rule.promptColumn,
  …
};
```

### 4. 三个不显然的决定

1. **枚举值照抄「不连续」的竞品编号**：竞品是 `1/2/3/4/5/6/7/9/11/14/15/16/17/18/20`（缺 8/10/12/13/19）。
   我本可以重排成 1..15 更"整齐"，但那样会让**同一个 scene 在两边是不同数字**，将来对日志、对埋点、
   对竞品接口都要多一层翻译。宁可留洞。
2. **枚举名与业务串不同名，四处都要照抄**：`Genre→theme`、`Voice→tone`、`ScreenplayNovel→novel_to_script`、
   `Composition→storyboard`。抄错就会与竞品的筛选口径不一致，而这类错**测试抓不到**（都是合法字符串）。
3. **规则不放前端**：前端本来可以自己维护一份"哪些场景要 prompt"，但那就成了第二份真相。
   现在由 `toAssetDto` 下发 `scene_prompt_column` 等四个字段，前端只读不判断。
   代价是 DTO 变大一点，收益是改规则只改一个文件。

### 5. 验证

| 层 | 结果 |
|---|---|
| `apps/api/test/knowledge.spec.ts` | **18 → 21 例**：场景隔离与同名共存 / 每类字段规则与非法场景值 / 条目跨场景被拒 + 三处读接口过滤 + 按场景计数 |
| `pnpm --filter @app/api typecheck` + `lint` | 干净 |
| `pnpm --filter @app/web typecheck` | 干净 |
| `node _acceptance/i18n-check.cjs` | 通过（5 语言 key 一致、无中文残留、占位符一致、页面 key 齐全） |
| `pnpm --filter @app/web build` | 通过 |
| `python _acceptance/scoreboard.py` | 201.64/206 = **97.9%**，剩余 **4.36**（核心 107.12 / 生态 94.52 / 首发 130.12） |

**踩坑两处**（都已修）：
① `t(\`knowledge.scene.${k}\`)` 这种模板字符串 key 会被 `i18n-check.cjs` 当成字面量 `"..."` 从而误报缺键 ——
改成常量数组里存**完整 key**、`computed` 里 `t(item.key)`；
② 改 `assertDirNameFree` 签名后调用点漏改（`moveDir` 仍传旧参数位）导致 `TS2345`，两次 typecheck 才干净。

### 6. 诚实边界（为什么只给 99.5%）

- **有证据、可对齐的**：`scene` 数值与业务串、每类字段规则、tab 表头列名、错误码 `747007`、`dir/list·tag/list·asset/search` 的 query 形状。
- **没有证据、标「待考证」的**：`SeeDance2` / `Camera` / `Palette` / `Expression` 四类**竞品没有对应文案**
  （8 个 `phase1` tab 才有 i18nKey），我方中文译名是自拟的。
- **有证据但本批没落库的**：条目级字段 `cover_file`（竞品是**逗号分隔多值**，取首图当封面）、`image_files`、
  `origin_cover_file`（竞品还有个拼错的历史别名 `orgin_cover_file` 并存）、`status`(Enabled=1/Disabled=2)、
  `sp_type` / `res_type` / `meta_data`、`user_knowledge_info_items`（一个条目挂多条知识，对应 `list` 的
  `show_user_knowledge_info_list` 参数）。
  → 这些是**扩展能力**，不属于"和竞品对齐"的必需项，所以 #18 只从 99% 到 **99.5%**，不写成"已对齐"。

---

## 变更登记（v6.13 · 第 59 批：#18 知识库实体 —— 把"产品定义不做"改判为实现 · 2026-10-28）

> 批次台账见 [implement-progress-vs-reelmate.md](07-plan/implement-progress-vs-reelmate.md) **§9 v8.2**（同一批；本文件与主台账各有一套编号，勿混）。
> **这批加分**：#18 **92% → 99%**（2.76 → 2.97），全站 **201.42 → 201.63/206 = 97.9%**、剩余 **4.58 → 4.37**。

### 先纠正一条被写进文档多轮的"结论"

本仓文档（主台账 §3.5 D 类、§5 第 7 行、`knowledge.service.ts` 文件头）此前一致写：

> 竞品有 4 条"知识库实体 CRUD"，我方是「一 space 一库」，**产品定义如此，不做**。

第 59 批复核竞品路由清单（`rea-reelmate/routes.txt` 第 737–765 行，`user_knowledge` 共 29 条）后发现**这个理由站不住**：

| 竞品端点 | 路径参数 |
|---|---|
| `dir`(:741) / `dir/list`(:755) / `dir/{ukd_id}/move`(:756) | 带 `ukd_id`（目录） |
| `asset/{uk_id}` 系（:742 等） | 带 `uk_id`（资产） |
| **`create`(:739) / `delete`(:740) / `info`(:757) / `info/update`(:758) / `update`(:765)** | **一个参数都没有** |

同一批端点里，凡是对"某一个具体对象"动手的都带 id，唯独这 5 条不带。**路由形状本身就是证据：只有一个库，
动作才不需要目标 id**。所以缺的不是"产品定义"，而是**我方连这一个库的元数据都没落库**——`knowledge_dirs` /
`knowledge_assets` / `knowledge_tags` 三张表都在，就是没有承载 name/description 的那一层。

> 教训与 v7.6（集级 resources）、v7.7（Apple form_post 会 415）同类：**"文档结论"会随时间变成"过时事实"**，
> 而"竞品没给字段"和"竞品路由形状反证了我们的实现口径"是两件完全不同的事——后者恰恰是**支持实现的证据**。

### 做了什么

| 层 | 改动 |
|---|---|
| 表 | 迁移 **0037** 新增 `knowledge_bases`：`space_id` / `name`（默认「团队知识库」）/ `description` / `cover_uri` / `note` / `created_by` / `deleted_at` / 时间戳 |
| 索引 | `uq_knowledge_bases_space` 是**偏唯一**（`where deleted_at is null`）：一空间一活库，但软删后可以重建 |
| 端点 | 5 条：`GET /knowledge/base`（我方自加）+ `POST /knowledge/base` + `POST /knowledge/base/update` + `POST /knowledge/base/info/update` + `POST /knowledge/base/delete` |
| 读路径 | `GET /knowledge/info` 直接带 `base` 实体块（省一次请求），删掉原「我方为一 space 一库…」那句已过时的 `note` |
| 前端 | `/knowledge` 页头从"死标题 + 统计"改成实体编辑；删库/清空两个不可逆动作的确认框**写清影响量** |
| i18n | `knowledge.*` **20 key × 5 语言**（78 → 98） |

### 三个不显然的设计决定

**1. 用偏唯一索引，而不是硬唯一 — 且 `onConflictDoNothing` 不能带 target**

一空间只能有一个活库，但"删掉重建"必须能走通，所以索引带 `where deleted_at is null`。

踩坑（记在这里免得下轮重犯）：一旦用了偏索引，**`onConflictDoNothing({ target: knowledgeBases.spaceId })`
在 PostgreSQL 上必抛**

```
42P10  there is no unique or exclusion constraint matching the ON CONFLICT specification
```

因为偏索引不是全表唯一约束，PG 无法用它做冲突仲裁（用 psql 直接跑 `insert … on conflict (space_id) do nothing`
同样报错，不是驱动层的问题）。必须写成**不带 target** 的 `.onConflictDoNothing()`——它走"任意冲突"语义，能命中偏索引。
首版 4 个新用例全 500，就是这一行。

**2. 改名与改简介分成两个端点**

- `POST /knowledge/base/update { name }` —— **只改名**
- `POST /knowledge/base/info/update { description?, cover_uri?, note? }` —— **传了才改**

如果合成一条 patch："页头就地改名 → 只想改 1 个字 → 请求体里没带 description → 服务端当成清空"。
这类事故不会在测试里报错，只会静默丢掉用户写的简介。分开两条端点把"高频小动作"和"低频大编辑"隔开，
查询成本是一次多几十字节的路由匹配，值得。

**3. 删库默认不动内容，`purge` 才级联；且标签走物理删**

| 动作 | 请求 | 结果 |
|---|---|---|
| 删库 | `POST /knowledge/base/delete`（空 body） | 只软删库行；目录/资产/标签**原地保留**，`info` 的计数不变，库名回到默认 |
| 删库并清空 | `POST /knowledge/base/delete {"purge":true}` | 软删全部目录与资产 + **物理删**标签 |

为什么 `purge` 要显式写进 body：级联不可逆，不能由"没传参数"默认触发。

为什么标签是物理删而不是软删：`uq_knowledge_tags(space_id, name)` 是**硬唯一索引**，如果标签也软删，
下次 "删库 → 重建 → 建同名标签" 会直接撞唯一键，用户看到的是 500 而不是"标签已存在"。
目录/资产没有这种唯一约束，所以保留软删（可追溯）。

### 验证：18 例（原 14 + 新 4）

| 用例 | 覆盖的那条不变量 |
|---|---|
| 懒初始化与幂等 | 老空间第一次 `GET /base` 自动建行且两次拿到同一个 id；`POST /base` 已存在时 `created:false` 且**不覆盖**现有名称 |
| 改名与改概览互不清空 | 先写 description/cover/note 再只改名 → 三字段保留；只改 note → 名称不变；空名与 61 字名 → 400101 |
| 删库默认保留内容 vs `purge` 级联 | 默认 `deleted:true / purged:false` 且 `dir_count`/`asset_count` 不变、`base.id` 已换；`purge` 后 `dirs:1 / assets:1 / tags:1` 且 info 三项归零 |
| 跨 space 隔离 | 每个 space 只看到自己的库名；冒用 `X-Space-Id` 改库名 → **403101** 且原名未变 |

### 诚实边界

**字段名是我方口径，标注「待取证」**。竞品侧我们只有路由清单——`capture.json` 里 29 处 `user_knowledge` 命中全是
URL 与导航组件串（`route:"TeamKnowledgeBase"` / `titleKey:"menu.knowledgeBase"`），**没有任何响应体**。
所以 `name` / `description` / `cover_uri` / `note` 这四个名字是照"产品最常识的划分"定的，不是"已对齐竞品 schema"。
这一项按红线**不能**写成已对齐，对应 §5 里仍留 **0.03** 权重（#18 99% 而非 100%）。

## 变更登记（v6.12 · 第 58 批：修第 57 批自己引入的回归 —— 看门狗误杀队列中任务 + 无条件 markTranscoding · 2026-10-28）

> 批次台账见 [implement-progress-vs-reelmate.md](07-plan/implement-progress-vs-reelmate.md) **§9 v8.1**（同一批；本文件与主台账各有一套编号，勿混）。
> **这批不加分**：修的是上一批自己造的回归，全站仍 **201.42/206 = 97.8%**、剩余 **4.58**，28 个模块分一个没动。

### 缺陷一：看门狗把「队列里还排着的任务」判成失败

第 57 批把转码下沉到 `publish.transcode` 之后，`reviveStuckPublications` 的判定口径没跟着改，还是「超时即失败」。于是出现一条把下沉收益**全额抵消**的链路：

```
worker 停机 20min（发布任务都在 Redis 里正常排队）
  → 重启时 schedule("publications-watchdog", …, runOnStart = true) 让看门狗先跑
  → 这些记录 status=1 且 updated_at 已超 15min，被逐条改成 status=4（失败）
  → 随后 BullMQ 把 job 投出来，runPublishTranscode 一看是终态 → 直接 skipped
  → 「重启可重投」等于没做；文案还让用户「在剪辑台重新发布」= 让用户自己再造一条记录
```

修法是**三分类**，而不是「加个 try/catch 或者把阈值调大」：

| 情况 | 判定 | 为什么 |
|---|---|---|
| **还在队列里**（wait / waiting / delayed / active / paused） | 跳过，本轮不碰 | 排队久 ≠ 坏了。worker 停机期间任务积压本来就是队列的正常状态 |
| **不在队列、但源还在** | **重新入队** | 这才叫重投。源 key 顺 `slice.source_export_id` → `timeline_exports.file_uri` 反查 |
| **不在队列、也投不了** | 判 `status=4` | 源成片已被清理时才真的救不了，此时文案与事实一致 |

```ts
// apps/worker/src/maintenance.ts —— 探针一次取回整批，而不是逐条查
export interface RevivePublicationHooks {
  pendingInQueue?: () => Promise<ReadonlySet<string>>;
  requeue?: (row: { publicationId: string; spaceId: string }) => Promise<boolean>;
}
```

两个容易写错的点：
1. **探针一次取集合**。逐条查队列在最坏情形是「200 条超时记录 × 队列里数百 job」，会把一个 2min 的维护任务拖成分钟级。
2. **探针抛错时整轮放弃判定**（`return 0`）。Redis 抖动时把正在跑的转码判失败，用户会看到「重发」提示，而原任务其实还在跑——宁可晚一轮。

重投的 jobId 必须带时间戳：`publish-transcode-retry-<id>-<ts>`。BullMQ 对同名 jobId 会去重，用固定 id 重投会**静默变成 no-op**。

### 缺陷二：`markTranscoding` 无条件写，两个执行者会互相覆盖

api 侧（`publish.service.ts` 的 `transcodeDeps()`）与 worker 侧（`apps/worker/src/publish-transcode.ts`）原先都是：

```ts
await db.update(timelinePublications).set({ status: 2, ... }).where(eq(timelinePublications.id, id));
```

不看当前状态。两个执行者并发转同一片源时，后写者会覆盖先写者的中间态（包括 shareToken）。改为**抢占式条件更新**并返回是否抢到：

```ts
const claimed = await db.update(timelinePublications).set({ status: PUB_STATUS.TRANSCODING, ... })
  .where(and(eq(id), or(
    eq(status, PUB_STATUS.QUEUED),                                        // 正常排队
    and(eq(status, PUB_STATUS.TRANSCODING),
        lt(updatedAt, cutoff)),                                            // 接管已死的执行者
  )))
  .returning({ id });
// 抢不到 → runPublishTranscode 直接 skipped，不读源、不写产物
```

**不能只认 `status=1`**：worker 崩溃后 BullMQ 重投的 job，面对的是停在 `status=2` 的孤儿记录；只认 1 就等于永远放弃它。故引入 `PUB_TRANSCODE_STALE_MINUTES = 15`（与看门狗同源）作为「接管」窗口。状态机契约由此补上第 4 条不变量：**单执行者**（原三条：终态不覆盖 / 降级留痕 / 失败不抛）。

### 顺带对齐的一处不对称

`markReady` / `markFailed` 的 `inArray(status, [QUEUED, TRANSCODING])` 守卫此前**只有 worker 侧有**，内联路径缺——同一份状态机两条路径守卫不一致。已逐字对齐。

### 验证

| 层 | 例数 | 覆盖 |
|---|---:|---|
| shared 状态机 | 7（+1） | 新增「没抢到转码权 → skipped，且不读源、不写产物」 |
| worker 看门狗 | 8（+4） | 仍在队列 → `revived=0` 且 status 保持 2 / 不在队列且 requeue 成功 → status **保持 2** 且 `updated_at` 推到当前 / requeue 返回 false → status=4 且 error 含「无法自动重试」/ 探针抛错 → 整轮放弃 |
| worker 抢占与反查 | 11（+7） | 两个并发 job → 结果集恰为 `["ready","skipped"]` 且 skipped 的 reason 含 `claimed`、源只被读一次 / `status=2` 且 `updated_at` 1 小时前 → 能救回 / `status=2` 但 `updated_at` 很新 → skipped 且 status 仍 2 / 反查正常 / 三种 null 分支不抛 |

测试总量 **1,216 → 1,228**（worker 41 → 52、shared 25 → 26）；`verify-round.ps1` **12/12 全绿**（api 76 文件 863 例）。

**为什么不加分**：#20 的 0.08 只剩「切片业务语义的竞品字段证据」，这批代码不落在任何模块的扣分项上。修 bug 不等于补缺口——把这两件事混起来才是不诚实的开始。

## 变更登记（v6.11 · 第 57 批：#20 切片转码异步下沉 worker · 2026-10-28）

> 批次台账见 [implement-progress-vs-reelmate.md](07-plan/implement-progress-vs-reelmate.md) **§9 v8.0**（同一批；本文件与主台账各有一套编号，勿混）。

### 修的不是"架构改良"，是一个会毁数据的缺陷

`apps/api/src/modules/script/publish.service.ts` 原先是这样触发转码的：

```ts
void this.transcode(spaceId, String(id), exportRow.fileUri); // fire-and-forget，活在 API 进程里
```

只要 API 进程在转码完成前死掉（发布 OOM、发版滚动、单机 dev 重启），这条发布记录就永远停在 `status=1/2`；
15 分钟后看门狗 `reviveStuckPublications` 把它标成失败，**而且不重跑** —— 用户每次看到"转码失败"，
重新发布也救不回那条记录。转码任务只存在于一个进程的调用栈里，进程没了任务就没了。

下沉到 BullMQ 后，任务在 Redis 里，worker 重启会重投。

### 关键设计：状态机只有一份

新增 `packages/shared/src/publish-transcode.ts`，`runPublishTranscode(deps, {publicationId, spaceId, sourceKey})`
是唯一实现，**API 内联与 worker 队列共用**。两条路径各写一遍必然漂移，会出现"队列里成功、内联路径失败"
这种只在生产复现的问题。函数契约里写死三条不变量：

| 不变量 | 具体做法 | 为什么 |
|---|---|---|
| **终态不覆盖** | `PUB_TERMINAL_STATUSES = [3,4,5]` 命中即 `skipped` | 重投/重复消费不能把已发布、已下架、已失败的记录打回中间态 |
| **降级留痕** | `transcode_mode` + `transcode_reason` 落库 | 裁剪不可用时降级为复制，但**绝不"悄悄复制却说裁过"** |
| **失败不抛** | 落 `status=4` + `error{code: VENDOR_ERROR}`，函数正常返回 | worker 不因一条坏任务反复重试；失败必须变成可查询的状态而不是日志 |

`trimVideoBuffer` 一并从 `apps/api/src/modules/script/ffmpeg-trim.ts` 迁进 `packages/shared/src/ffmpeg-trim.ts`，
api 侧只留再导出薄壳：

```ts
export { trimVideoBuffer, type TrimResult } from "@app/shared";
```

这样既有的 import 与 4 例 spec 一行不用改（薄壳的代价是"两个文件"，但它换来"迁移不碰调用点"）。

### 三种运行模式

新增 `PUBLISH_TRANSCODE_MODE: z.enum(["inline","worker"]).default("inline")`：

| 值 | 行为 | 用途 |
|---|---|---|
| `inline`（默认） | API 进程内直接跑状态机 | dev / 测试：不必起常驻 worker，行为与改造前完全一致 |
| `worker` | 只入队 `publish.transcode`（jobId `publish-transcode-<id>`，同 id 天然去重） | 生产：任务可重投，API 重启不丢 |

**入队失败会回落内联** —— 这不是"兜底好看"，而是必须：Redis 抖一下就把记录永远停在 `status=1`，
比不用队列更糟。worker 侧 `markReady`/`markFailed` 全部带条件更新

```ts
inArray(timelinePublications.status, [PUB_STATUS_QUEUED, PUB_STATUS_TRANSCODING])
```

防多实例消费同一 job 的竞态（谁先写谁生效，后到的不覆盖）。

### 验证：10 例

| 层 | 例数 | 覆盖 |
|---|---:|---|
| `packages/shared/src/publish-transcode.spec.ts` | 6 | 成功 / 裁剪失败降级 copy 且带 reason / 终态 skipped / 记录不存在 skipped / 源为空落失败且不抛 / `putFile` 抛错落失败 |
| `apps/worker/test/publish-transcode.spec.ts`（真库 + 真 `LocalStorage`） | 4 | 源缺失 → `status=4` 且 `error.message` 含 `publication transcode failed` 且不抛 / 已 READY 重投 → skipped 且 `fileUri`+`shareToken`+`publishedAt` 全不变 / 记录不存在 → skipped / 正常路径 → 产物落 `u/<space>/publications/<id>.mp4`、`status=3`、`shareToken` 非空、`storage.read` 读回 >0 字节 |
| api 回归 `test/ffmpeg-trim.spec.ts` + `test/reelflow-publish.spec.ts` | 18 | 默认 inline 模式行为与改造前**完全一致** |

### 数字

- #20 ReelFlow **97% → 99%**（7.76 → 7.92，**没给满**：真实转码质量与供应商依赖仍在外部）
- 全站 **201.26 → 201.42/206 = 97.8%**，剩余 **4.74 → 4.58**；首发口径 **130.12/133 = 97.8%**
- 测试 **1,216**（api 863 / adapters 164 / cli 91 / worker 41 / db 26 / shared 25 / storage 6）——
  顺手纠正一处长期口径错误：此处原记 1,195，但把各包相加实为 1,210，说明那是某一轮的累计快照没随各包增长重算
- 复现：`pwsh _acceptance/verify-round.ps1`（12 门禁全绿）

## 变更登记（v8.2 · 第 53 批：代码事实 vs 文档缺口对齐 · 2026-10-29）

- **背景**：进度文档里的「缺口」是历轮手写的，代码却在持续前进 → 出现"缺口栏写着做不到、代码里其实早做了"的漂移。
  本轮按"每条缺口去代码里找实现证据"复核，一次清了 3 条。
- **#17 资产/主体 98% → 99%**：`episode_resources`（**迁移 0031**）早已是集级一等公民——
  `match-resources`/`save-resource-matches` 写入即本集权威快照、读路径直接命中，分镜绑定只在"历史项目从未写过快照"时回落
  （`apps/api/src/modules/script/asset-match.service.ts:632` 注释即此口径）。旧文档写"只能用绑定∪提及投影"，是迁移前的描述。
- **#19 3D 验收口径落地**：像素级比对对显卡驱动/DPR 敏感、跨机必 flaky，改用 `shapeOf()` **结构指纹**
  （类型/键集/数组长度/数值有限性）+ 关键对象计数 + 复制场景逐层等价，并用「多一个机位必须被检出」**反证断言非恒真**；
  `director.spec.ts` **13 → 16 例**。
- **修三处文档自相矛盾**：#16 行 99%×8=7.92 与得分 7.99 不符（→ 99.9%）；#27 缺口栏残留已完成的 `home_configs` 写入口
  （第 40 批做了 `GET/POST /ops/admin/home-config`）；§3.4 分布表与 §5 缺口表按 28 行逐项重算（旧表还写着"100%×8""剩余 11.7 权重"）。
- **数字**：全站 **201.17/206 = 97.7%**（剩余 **4.83**）；首发口径 **129.88/133 = 97.7%**；api 测试 **840 → 843**。
- 复现：`pwsh _acceptance/verify-round.ps1`（12 门禁全绿）。

## 变更登记（v8.1 · 第 52 批：按秒计价转译层 · 2026-10-29）

### 修的是一个真会赔钱的缺陷

价目表按"时长档"建模（5s = 100 积分，10s = 180 积分）。旧逻辑遇到**枚举允许但价目表没有的时长**时
"就近取低档"——请求 20s 而价目只有 5s/10s，就按 10s 收 180 积分。

**请求越长越亏，而长视频正是主力场景。**

### 做什么

命中价目缺失时按秒线性外推：`credits = ceil(秒 × 每秒单价)`，每秒单价取最高档比例（180/10 = 18）。

新增 `pricingBasis` 字段，让"为什么收这个数"可解释：

| 值 | 含义 |
|---|---|
| `tier` | 命中真实时长档 |
| `tier_lower` | 低于最低档，按最低档收（**宁多收不漏收**，且与 PRD F2「就近取低档」一致） |
| `seconds` | 高于最高档，按秒外推 |

### 关键边界：外推 ≠ 放宽校验

`durations` 枚举仍是合法性边界 —— 不在枚举内的时长直接 `400101`，外推只作用于
"枚举允许但价目表缺行"。这两件事混在一起会变成"任何秒数都收"，等于取消产品定义。

### 验证：4 例

| 场景 | 期望 |
|---|---|
| 10s（有档） | 180 |
| 2s（低于最低档，枚举允许） | 100（按 5s 档收） |
| 20s（高于最高档） | 360，且**严格 > 180** |
| 15s | 270，且必须是整数积分 |

api 测试 **836 → 840**；全量 **1,186 例**（api 843 / adapters 164 / cli 91 / worker 37 / db 26 / shared 19 / storage 6）；gate 全绿（12/12）。
#23 **99.3% → 99.5%**（2.98 → 2.99）。**进度**：全站 **201.02/206 = 97.6%**，剩余 **4.98**。

## 变更登记（v8.0 · 第 51 批：升级补差价报价 · 2026-10-29）

### 缺口

#23 计费长期停在 99%，唯一缺口是"升级按比例补差价（待取证）"。竞品 ReelMate 有升级入口，
但**折算规则无证据可取证** —— 所以这不是"照着抄"，而是必须自己定口径（已登记 §5.4 第 1 条）。

### 做法：先报价，不动钱

`GET /billing/upgrade-quote?sku=` 返回 `is_upgrade` / `days_left` / `credit_cents` / `payable_cents`。

口径：`折抵 = 当前档有效价 × 剩余天数 / 当前档周期天数`（天数向上取整，对用户有利），
`应付 = max(0, 目标价 − 折抵)`。

**为什么按"当前档有效价"而不是"用户实付"**：`subscriptions` 不存实付金额，
`orders` 上"哪一单支撑了当前订阅"在有改价/退款时无法无歧义回溯。用档位有效价可复现、可对账，
代价是活动价买入的用户会少折抵一点 —— 这点已写进代码注释，不藏。

**为什么只报价不下单**："补差价换档"本身是策略问题（是否允许、是否影响已发积分、退款怎么算），
动钱路径不能在口径未定时接。报价让前端/运维能先拿到明确数字，且**不改任何账目**。

### 四条会赔钱的边界，各有测试

| 情况 | 期望 | 不这样会怎样 |
|---|---|---|
| 无生效订阅 | `is_upgrade:false`，折抵 0，应付 = 全价 | 没买过的人也能抵，等于白送 |
| 同档 | `same_plan`，折抵 0 | 反复调接口把价格抵到 0 |
| 降价（目标价 ≤ 当前价） | `not_an_upgrade`，折抵 0 | 变相退款；需求里没有退款语义，降级应走到期自然生效 |
| 剩 15 天/整月 | 折抵恰好一半（1950/3900） | 折算虚高或按"剩余秒数"算成 0 |

### 验证

api 测试新增 `billing-upgrade-quote.spec` **6 例**；api **830 → 836**；全量 **1,186 例**（api 843 / adapters 164 / cli 91 / worker 37 / db 26 / shared 19 / storage 6）；
gate 全绿（12/12）。`billing` 端点 15 → 16；#23 **99% → 99.3%**（2.97 → 2.98 权重）。
**进度**：全站 **201.01/206 = 97.6%**，剩余 **4.99**。

### 未做（等口径）

- 定价页展示"升级需补 ¥X"：**故意没做**。在折抵没接进下单前，给用户看一个他不会真付的价格，
  比不显示更糟。
- 折抵接入 `createOrder`：待 §5.4 #1 确认。

## 变更登记（v7.9 · 第 50 批：裁剪状态贯通三处 + B 类确认单 · 2026-10-29）

### 1. 裁剪状态：库里留痕 → 接口透出 → 前端可见

上一批给发布加了 `transcode_mode`（`ffmpeg`/`copy`），但**只在库里**——等于没人会发现
"我以为是 30s 切片，其实是整片复制"。本轮贯通三处：

| 层 | 改动 |
|---|---|
| API | `pubDto` 透出 `transcode_mode` / `transcode_reason` |
| Web 类型 | [types/api.ts](app/apps/web/types/api.ts) 补两个可选字段（带注释说明用途） |
| 编辑器 | 发布列表加**裁剪状态徽标**：`已按区间裁剪` / `未裁剪（复制整片）`，hover 显示降级原因；**仅 status=3 显示**（转码前还没决定方式）；`editor` 命名空间 +3 key ×5 |

### 2. CLI 一条命令看到媒体能力

`oneframe env info` 现在会调 `GET /meta/capabilities` 并透出 `media.ffmpeg`。
排障时最常见的问题是"为什么我的切片时长不对/没有水印"——答案往往在这台机器的 ffmpeg 上。
关键设计：**能力接口失败不影响 `env info` 成功**（`media:null` + `media_error` 有值），
排障工具不能因为一个可选能力探测失败就整体打红。

顺手清掉 `cli.ts` 里两个未使用导入（既有 lint 债务，gate 的 lint 门禁会拦）。

### 3. 新增 §5.4「B 类一句话确认单」

把剩下 7 条需要口径的缺口做成表，每条都给出**我的默认判断 + 依据 + 确认后我会做什么 + 权重**，
合计 ≈0.44。建议先确认成本最低的四条：

| # | 口径 | 我的默认判断 | 权重 |
|---:|---|---|---:|
| 1 | #23 升级补差价 | 按天折算（剩余天数/周期天数 × 新档价 − 已付未用） | 0.06 |
| 2 | #23 秒级计价 | `ceil(秒 × 单价)`，最小 1 积分 | 0.06 |
| 4 | #17 `prompt_inject_mode=replace` | 替换模板占位符（保留前缀/后缀），不覆盖整段 | 0.08 |
| 6 | #19 3D 像素级验收 | 不做像素比对，改"快照结构等价 + 对象计数一致"（像素比对跨机器必然 flaky） | 0.02 |

另指出一条 C 类但**可先实现后联调**的：**#22 Apple `form_post` + JWKS**（≈0.12）——
纯代码可写，只是无法真机联调；若你认可"先按规范实现、标注未联调"，我可以直接做。

**验证**：cli `env-info-media.spec` **2/2**；cli **89 → 91**；api 830、worker 37、db 26、shared 19；
全量 **1,170 例**；`i18n-check` 全绿；gate 全绿（12/12）。
**进度**：全站 **201.00/206 = 97.6%**，剩余 **5.00**。

## 变更登记（v7.8 · 第 49 批：#20 真 ffmpeg 裁剪落地 · 2026-10-29）

### 上一批发现本机就有 ffmpeg，这一批把裁剪真正接上

[`apps/api/src/modules/script/ffmpeg-trim.ts`](app/apps/api/src/modules/script/ffmpeg-trim.ts)：

| 取舍 | 原因 |
|---|---|
| `-ss/-to` 放在 `-i` **之后**（解码后裁） | 放在前面是"关键帧前跳"，快但不精确；对外发布的切片时长必须准 |
| **不用 `-c copy`** | copy 按关键帧对齐会把尾巴带进来（看着像对、实际多几帧） |
| 重编码 `libx264 + aac + faststart` | 精确到帧 + 便于边下边播 |
| 失败**不抛异常**，返回 `{ok:false, reason}` | 没装 ffmpeg / 片源不可解码 / 区间过短都是正常情况，不能把发布打成 500 |

### 降级必须留痕（迁移 0036）

`timeline_publications` 新增 `transcode_mode`（`ffmpeg` / `copy`）与 `transcode_reason`。
**理由**：不能"悄悄复制"却对外说裁过——审计与前端都要能看出来这一次到底是裁了还是只复制了。

### 验证：证明"真的裁了"，而不是"没报错"

| 测试 | 断言 |
|---|---|
| [ffmpeg-trim.spec.ts](app/apps/api/test/ffmpeg-trim.spec.ts) 4 例 | 5s 源裁 1s–3s → 产物时长 **≈2s**（另用 ffprobe 独立复核得 **2.000000**）；区间 <200ms 拒绝并给原因；空 buffer 拒绝；不可解码字节返回 `ok:false` **不抛** |
| 既有 `reelflow-publish.spec` 14 例 | 其 fixture 上传的是不可解码字节 → 走**降级复制**路径，仍全绿（说明降级不破坏契约） |

**验证**：api **826 → 830**、worker 37、db 26、shared 19；全量 **1,168 例**；gate 全绿（12/12）。
**进度**：全站 **201.00/206 = 97.6%**，剩余 **5.00**。#20 的功能性缺口到此清空，§3.5 的 **E 类（环境依赖）也清零**。

## 变更登记（v7.7 · 第 48 批：ffmpeg 改为运行时能力探测（E 类自助解锁）· 2026-10-29）

### 问题：能力被"写死"成假设

`ffmpeg` 是**部署环境决定**的能力，不是产品开关。但过去的代码里是"假设没有"——
于是环境装了 ffmpeg，也要**改代码**才能用上（#20 的"真 ffmpeg 裁剪"就卡在这），
运维也无法判断"这台机器到底走了哪条路（真裁剪 vs 复制降级）"。

### 改法：探测 + 透出 + 诚实降级

| 层 | 改动 |
|---|---|
| shared | 新增 [`media-capability.ts`](app/packages/shared/src/media-capability.ts)：`probeFfmpeg()` —— 5s 超时、**失败不抛异常**（探测失败是正常结果）、ENOENT/权限/超时分别给可读 `reason`、进程内 **5min 缓存**且支持 `force` 重探 |
| api | 新增公开只读 **`GET /v1/meta/capabilities`**：只透出 `available / path / version / reason / checked_at`，**不泄露**密钥与内部地址 |
| worker | 启动即探测并打日志：可用 → `info` 带版本；不可用 → `warn` 带可读原因 |

### 意外收获：本机其实装了 ffmpeg 8.1.1

接口返回 `{"available":true,"version":"8.1.1-full_build-www.gyan.dev"}`——
**此前一直按"没有 ffmpeg"降级**，这正说明"探测"比"假设"可靠。
于是 E 类从"需要部署环境配合"变成"已自助解锁"：剩下的只是把裁剪接到发布链（下一批）。

### 测试

- shared [`media-capability.spec.ts`](app/packages/shared/src/media-capability.spec.ts) **5 例**：版本解析容错（含发行版后缀/非 ffmpeg 文本）、存在但非 ffmpeg、ENOENT「未找到」、缓存与 `force`、默认 PATH 不抛错
- api [`meta-capabilities.spec.ts`](app/apps/api/test/meta-capabilities.spec.ts) **2 例**：公开可读且结构稳定（可用必有版本、不可用必有原因）、**不泄露敏感字段**

**验证**：shared **14 → 19**、api **824 → 826**、worker 37、db 26；全量 **1,164 例**；gate 全绿（12/12）。
**进度**：全站 **201.00/206 = 97.6%**，剩余 **5.00**（本批是能力可视化，模块分不变；但 #20 最后一项从"需环境"变成"可实现"）。

## 变更登记（v7.6 · 第 47 批：首页板块配置浏览器验收 9/9 + 修两个真问题 · 2026-10-29）

### 起因

上一批（第 40 批）给 `home_configs` 补了写入口，API 有 5 例 spec，但**页面从没被浏览器点过**。
补 E2E [e2e-admin-home-config.cjs](_acceptance/e2e-admin-home-config.cjs) 时抓到两个真 bug：

| # | Bug | 表现 | 根因 |
|---|---|---|---|
| 1 | **UI 位置错** | 打开后台完全看不到「首页板块」 | 上一批把整块插进了 `tab === 'models'` 的 section **内部** —— 只有切到「模型」页签才渲染；已改为独立的 `tab === 'dashboard'` section |
| 2 | **运行中的 API 是旧构建** | `GET /ops/admin/home-config` 在 :3002 返回 **404** | 代码里路由存在，但 `dist/main.js` 是几小时前启动、从未重编；重编重启后立即 200 |

第 2 条特别值得记：**"代码写了" ≠ "服务在跑"**。排查时我先怀疑路由写错、又怀疑鉴权，最后才发现
浏览器请求的就是 404 —— 服务端跑的是旧产物。以后 E2E 报 404 时，先确认 `dist` 与源码同步。

### E2E 覆盖（9/9）

卡片渲染 / 六个内置板块齐（hero·workflow·canvas·tools·banner·recent）/ 勾选框可操作 /
保存成功提示 / 服务端 `visible=false` 且 `version` 递增 / **刷新后仍保持未勾选**（这一条才证明
是写库而不是只改了本地 ref）/ 控制台无未预期错误 / 测试后还原配置（不污染开发库首页）。

**验证**：`e2e-admin-home-config.cjs` **9/9**；api **824**、worker 37、db 26；全量 **1,160 例**；gate 全绿（12/12）。
**进度**：全站 **201.00/206 = 97.6%**，剩余 **5.00**（验收补齐，模块分不变）。

## 变更登记（v7.5 · 第 45 批：#4 分享侧只读实时流 · 2026-10-28）

### 补的是什么

分享链接（`/share/:token`）此前只有"读一次快照"：观看者得**手动刷新**才知道任务跑完没有。
对"把进度分享给客户看"这个场景，静态快照等于不可用。

新增公开只读 SSE **`GET /share/:token/stream`**：

| 设计点 | 做法 |
|---|---|
| 六类帧 | `open` / `status`（状态或进度变化时）/ `task_event`（增量事件，只给 type+时间）/ `ping`（15s 心跳）/ `done`（任务到终态）/ `closed`（带 reason） |
| 安全边界 | **只认 token**，不接受 `task_id` 入参；**不推** storage key、积分、space/user；撤销或过期立即 `closed{reason:"revoked"}` 断开 |
| 生命周期 | 任务进入 3/4/5 终态 → 推 `done` 后自关；`timeout_ms` 限连接寿命（默认 10min），避免浏览器挂着永不结束的 SSE |
| 诚实标注 | 本仓无跨进程事件总线，SSE 由**轮询 task 行 + task_events 增量**喂（1s），注释写明"真正的发布订阅要等 Redis Pub/Sub，届时只换 `pollOnce`" |

前端 [share/[token].vue](app/apps/web/pages/share/[token].vue)：未到终态时用 `EventSource` 订阅，
收到 `done`/`closed`/`error` 主动 close（防浏览器自动重连成永动机），异常静默降级为静态快照。

### 一个 `EventSource` 的硬约束

`EventSource` **不能带 `Authorization` 头**——这是它和 `fetch` 的关键差异。所以这个端点**必须公开**，
服务端也就只认 token（与 `GET /share/:token` 同级别的信任模型）。

### 测试抓到一个真 bug

`finish()` 原本先置 `closed = true` 再写收尾帧，而 `write()` 在 `closed` 为真时会**丢弃写入**——
表现是"客户端永远收不到 `closed`，只能等超时"。`share-stream.spec.ts` 的 done 断言当场抓到，
已修并把这个顺序原因写进注释。

**验证**：`share-stream.spec.ts` **4/4**（有效 token 收 open+status 且不侧漏内部字段 / 终态推 done+closed /
已撤销 404 / 非法形状 404 不打库）；api 测试 **820 → 824**；全量 **1,160 例**；gate 全绿。
**进度**：全站 **201.00/206 = 97.6%**，剩余 **5.00**（#4 的 A 类两项已完成其一，另一项 `/agent/home/resource/*` 仍待做）。

## 变更登记（v7.4 · 第 44 批：缺口全面复核 + §3.5 分类表 · 2026-10-28）

### 为什么要做这件事

最近三轮（#19 删除 UI、#20 转码异步、#2/#9/#15）连续发现**文档缺口栏写着"缺"，代码里其实已经有了**——
只是缺验收证据。这种漂移会让"还差 5.00"这个数字逐渐失去可信度，所以这轮做一次**逐条 grep 复核**。

### 复核结果：19 个未满 100% 模块，**改判 4 条**

| 模块 | 原缺口描述 | 代码事实 |
|---|---|---|
| #2 | 原创 `idea/:ni_id` 详情/编辑 | **已实现**：[NovelOriginalChain.vue:143-170](app/apps/web/components/novel/NovelOriginalChain.vue) 调 `GET/PATCH /novel/original/idea/:ni_id`（含 downstream_stale 回显） |
| #9 | 浏览器 handoff 登录 | **已实现**：[builtins.ts](app/apps/cli/src/builtins.ts) `loginViaHandoff`：loopback HTTP + state nonce + 120s 超时 + CORS 预检（浏览器跨端口 POST 到 127.0.0.1） |
| #15 | 区域拖拽无多框/撤销 | **已实现**：`regions[]` 多框 + `undoRegion`/`deleteRegion`/`selectRegion`；真正卡点是**后端 `normalizeToolOptions` 只归一单框**（UI 已诚实标注"仅选中框生效"） |
| #4 | 分享侧实时流、`/agent/home/resource/*` | **确认确实缺失**（全仓 controller 搜索无对应路由）→ 保留为真缺口 |

### 新增 §3.5「缺口分类表」

把剩下的缺口按**"谁能解锁"**分五类，让 5.00 变得可决策：

| 类型 | 权重 | 说明 |
|---|---:|---|
| A. 可独立实现 | ≈0.3 | #4 分享侧 SSE + `/agent/home/resource/*`（下批直接做）；#23 秒级计价转译层 |
| B. 需一句话拍板 | ≈0.4 | #17 replace 语义与集级 resources 等价性、#12 二次改编许可、#23 升级补差口径、#19 像素级验收、#16 韩语 |
| C. 需外部输入 | ≈3.6 | MCP 证据、供应商 Key、商户打款资质、Apple 账号、审核供应商 |
| D. 明确不做 | 0 | #2 `characters/*`（免第二份真相）、#18 知识库实体 CRUD（一 space 一库） |
| E. 环境依赖 | — | #20 真 ffmpeg 裁剪 |

**验证**：本轮无代码改动，仅文档；`i18n-check` / `e2e-i18n-pages` / gate 与上一轮一致全绿。
**进度**：全站 **201.00/206 = 97.6%**，剩余 **5.00**（改判不改分——因为改判的是"描述"，被改判的功能本来就没算进"还差"里）。

## 变更登记（v7.3 · 第 43 批：发布转码卡死看门狗 · 2026-10-28）

### 先纠正一个不准确的缺口描述

文档一直写着 #20 的缺口是「切片转码异步化」。审查后发现**转码早就异步**：
`PublishService.publish()` 用 `void this.transcode(...)` 做进程内 fire-and-forget
（好处是 API 不依赖 worker 也能跑通）。

**真正的缺口是**：API 在转码中途重启/崩溃时，记录**永久停在 `status=2`（转码中）**——
用户看到"永远转码中"，也没有任务可重试。这是"异步的代价"，不是"没做异步"。

### 本轮补的：与 `reviveStuckTasks` 同构的看门狗

| 层 | 改动 |
|---|---|
| worker | 新增 [`reviveStuckPublications`](app/apps/worker/src/maintenance.ts)：超 **15min** 仍停在 1（排队）/2（转码中）的记录 → 置 **4（失败）** 并写 `error = { code: "transcode_stalled", ... }` 可读原因 |
| 调度 | 挂 `publications-watchdog`，默认 **2min** 周期，可用 `PUBLICATIONS_WATCHDOG_INTERVAL_MS` 关闭 |
| Test | [maintenance-publications.spec.ts](app/apps/worker/src/maintenance-publications.spec.ts) **4 例**：超时置失败+原因、未超时不误杀、三种终态（3/4/5）不改写、幂等再跑为 0 |

### 一个刻意的设计选择：**不自动重跑**

源产物可能已被 retention 清理，静默重试会把"可诊断的失败"变成"无声的积分与时间消耗"。
看门狗只把状态推到终态并给出可读原因，让创作者决定是否重新发布。理由写进了函数注释，
避免以后有人"顺手"加上自动重试。

**验证**：worker **33 → 37 例**全绿；全量 **1,156 例**；`e2e-i18n-pages` 138/138；gate 全绿。
**进度**：全站 **201.00/206 = 97.6%**，剩余 **5.00**（健壮性补齐，模块分不变）。

## 变更登记（v7.2 · 第 42 批：发布播放页 `/watch/:token` 浏览器验收 · 2026-10-28）

### 补的是"只验了服务端、没验用户看到什么"

`/watch/:token` 的读接口与播放计数在 `reelflow-publish.spec.ts` 有 6 例单测，
但**页面本身从来没有被真浏览器打开过**——发布链最后一公里（点开分享链接看到什么）没有任何证据。

新增 [e2e-watch.cjs](_acceptance/e2e-watch.cjs) **19/19**：

| 场景 | 断言 |
|---|---|
| 可播放态（status=3） | 标题、`第 N 集`、`N 次播放`、复制分享链接、品牌行、`document.title` 含片名、`video` 播放器存在 |
| 转码中（status=1） | 「视频正在转码」+ 重试出口 |
| 已下架（status=5） | 「该视频已下架」+ 返回首页 |
| 失效 token | 「链接无效或已失效」（不白屏、不 404）+ 返回首页 |
| 播放计数 | 进页面计 1 次；**同一访客重复 `/view` 被 5 分钟去重不再累加** |
| 英文态 | `?lang=en` 显示英文、无中文残留 |
| 控制台 | 无未预期错误 |

### 三个有普适价值的坑

1.​ **`share_token` 形状校验**：服务端 `publicWatch` 先用 `/^[0-9a-f]{32}$/` 卡形状，不合法**直接判 not_found 不打库**。
我第一版用 `pl<timestamp>` 作 token，页面全显示"链接无效"，排查半天才发现根本没查库。
2.​ **psql 的 `INSERT ... RETURNING` 在 `-t -A` 下仍输出 `INSERT 0 1`**：trim 后拼进下一条 SQL 就是语法错误。需要按行过滤命令标签。
3.​ **断言写反了**：第一版写"再打一次 `/view` 应该 +1"，实际**去重才是产品语义**（防刷）。已把这条语义写进注释，防止以后有人"修回去"。

**验证**：`e2e-watch.cjs` **19/19**；全量 **1,152 例**全绿；`e2e-i18n-pages` **138/138**；gate 全绿。
**进度**：全站 **201.00/206 = 97.6%**，剩余 **5.00**（取证轮，分数不变；#20 缺口去掉"发布播放页"）。

## 变更登记（v7.1 · 第 41 批：3D 删除场景取证 + 文档缺口栏纠错 · 2026-10-28）

### 这轮不加功能，只补"证据缺口"

逐条审查 19 个未满 100% 模块的「缺口」栏时发现 **#19 3D 导演台的"删除 UI"是过时描述**：
`useDirectorPersistence.removeScene()` 与 `.d3-ops` 里的「删除场景」按钮**早就存在**，
但**从来没有验收证据**（3D E2E 只覆盖保存/重开/冲突/载入最新），文档却一直按"缺失"记着。

于是本轮做两件事：

| 动作 | 内容 |
|---|---|
| 补证据 | [e2e-director.cjs](_acceptance/e2e-director.cjs) 新增 **S6 段 4 条**：按钮渲染、删除后回到「尚未保存」态（防"删完又建回来"）、服务端 `total` 减 1（软删生效）、读已删场景 `400102`。3D E2E **13 → 17 项**全通过 |
| 纠错 | #19 缺口栏去掉"删除 UI"、注明已补证据；#16 缺口栏更新为真实状态（用户面 41/43，仅剩法务 2 页 + 韩语未排期） |

### 一个 E2E 陷阱

`window.confirm` 在 Playwright 里**默认被驳回**（不弹窗、直接 false），所以"点删除"什么都不会发生、
但断言可能因为页面没变化而"看起来通过"。必须先 `page.on("dialog", (d) => void d.accept())`。
这类"默认行为让断言假通过"的坑，比失败更危险——写进来提醒以后别省这一步。

**验证**：`e2e-director.cjs` **17/17**；全量 **1,152 例**全绿；`e2e-i18n-pages.cjs` 138/138；`i18n-check` 全绿；gate 全绿。
**进度**：全站 **201.00/206 = 97.6%**，剩余 **5.00**（模块分数不变——本轮是取证，不是补齐）。

## 变更登记（v7.0 · 第 40 批：`home_configs` 后台写入口 → 首页模块 100% · 2026-10-28）

### 补的是"只有读、没有写"的最后一个缺口

`GET /home/config` 早就支持「space 覆盖 > global > 内置默认」，但**全仓没有任何写入入口**——
运营永远只能看到 `source=default`，首页板块实际上不可配。本轮补齐：

| 层 | 改动 |
|---|---|
| API | `GET /ops/admin/home-config`（读 global；无行时返回 6 个内置板块 + `source=default`）<br>`POST /ops/admin/home-config`：**全量覆盖** `sections`（增量无法表达"删掉一个板块"）、**白名单**只允许 `hero/workflow/canvas/tools/banner/recent`（未知 key → 400101）、**去重**（重复 key → 400101）、**乐观锁**（version 不匹配 → 746002） |
| Web | [admin/index.vue](app/apps/web/pages/admin/index.vue) 新增「首页板块」卡片：显隐勾选 + 排序输入 + 来源徽标（`已配置 · vN` / `内置默认`）+ 冲突提示；复用现有多语言词条（`adminUi.home*` 19 key × 5） |
| Test | [admin-home-config.spec.ts](app/apps/api/test/admin-home-config.spec.ts) **5 例**：默认 6 板块、写入后 `source=db` 且表内容一致、版本推进与 746002 冲突、未知/重复 key 400101、非管理员拒绝 |

### 一个熟悉的坑

`home_configs.created_by` 外键指向 `users.id`，而运营 admin 存在**独立的 `admin_users` 表**——
把 admin id 写进这一列直接撞 FK，接口返回 500/500000（与早前 cli-build 撞的是同一个外键）。
处理方式：不写 `created_by`，并在代码注释里写明"审计线索走 admin 侧操作日志，不在业务表里塞假 user id"。

**验证**：`admin-home-config.spec` 5/5；全量 **1,152 例**（api 820 + adapters 164 + cli 89 + worker 33 + db 26 + shared 14 + storage 6）全绿；
`i18n-check.cjs` 全绿；`e2e-i18n-pages.cjs` **138/138**；`pnpm lint` 0 error。

**进度**：首页模块 **99% → 100%**；全站 **201.00/206 = 97.6%**，剩余 **5.00**。

## 变更登记（v6.10 · 多语言第 55–56 批：壳层 + `/create/*` 收尾 → 用户面可译页 100% · 2026-10-29）

**口径变更（故登记在此，不只记进度文档 §9）**：前端 i18n 的「页面完成度」改为**按文件数残留中文行**判定
（新增 `_acceptance/i18n-residual.py`，排除注释与行尾注释，豁免文件单列），不再以「页头翻译完」推断整页完成。

| 口径 | 分母 | 已迁 |
|---|---:|---:|
| 用户面可译页（64 − admin 2 − `/create/*` 19 − 法务 2） | 41 | **41（100%）** |
| 法务文本页 privacy / terms（原则性不机翻） | 2 | 0（豁免，待法务） |
| 运营后台（内部系统） | 2 | 2 |
| `/create/*` 工具落地页 | 19 | 19 |
| 全部页面 | 64 | 62（97%） |
| 语言包 | — | **3,153 key × 5 语言**（50 命名空间） |

**本批改动**：
1. **壳层**（第 55 批）：`layouts/app.vue`（侧栏 12 项 + 顶栏订阅/积分 pill + 语言切换）、`layouts/default.vue`、
   `layouts/tool.vue` 页头原来整块硬编码中文——**任何英文界面里都挂着中文导航**，是「页面迁完」后最刺眼的残留。
   新增 `shell` 命名空间 35 key ×5；`toolTitle` 从中文标题改为 **i18n key**（19 张 create 页统一改传
   `shell.toolTitles.*`）。顺带修首页工具卡角标：`data-kind` 从中文类名改语义键（`soon`/`member`），
   否则切语言后渐变配色丢失。
2. **`/create/*` 收尾 + 一处虚报纠正**（第 56 批）：此前文档写「`/create/*` 19/19 = 100%」，
   实为把布局统一翻译的页头当成整页；19 张里 18 张确为 10~13 行薄壳，`video-upscale` 是唯一 609 行
   自包含实现、正文另有 34 处中文，本批迁完（`toolUpscale` 41 key，含 7 个任务状态文案——
   状态表须从 setup 常量改 `computed`，否则切语言不生效）。
3. **`ad-drama/create` 的 `style` 值改 ASCII key**（`live/anime/cartoon3d/cyber/guofeng`）+ 旧中文值兼容映射：
   原来「中文环境提交一次、英文环境再提交一次」同一需求会在库里存两种值。这是「业务值存中文」类缺陷中
   **唯一能纯前端闭环**的一条（后端 `style` 是自由字符串、不校验枚举），故从「待改造」降为已修。
4. 清扫 `team/index` 4 处（成员选择提示/充值按钮/表头「成员」/未分组）与 `admin/index` 表头「积分」。

**验证**：`i18n-check.cjs` 全绿（**43 页 + 17 组件 / 3,153 key ×5**）；`e2e-i18n-pages.cjs` **158/158**
（新增 `video-upscale` 中英 7 例）；`page-content-smoke.cjs` **49/49**；`verify-round.ps1` 全绿
（12/12；**1,195** 用例，api 863）。全站 **97.7%（201.26/206，剩余 4.74）**，#16 多语言 **99.9%** 不变
（最后 0.1% 卡在法务译文与韩语排期，工程侧无法闭环）。

## 变更登记（v6.9 · 多语言第 39 批：语言偏好持久到账号 · 2026-10-28）

补掉 §5.3 第 7 行里最后一个"代码侧可做"的项：**语言偏好从"只在本设备 cookie"升级为"跟随账号"**。

| 层 | 改动 |
|---|---|
| DB | 迁移 **0035**：`users.preferred_locale text not null default ''`（`''` = 从未显式选择） |
| API | `POST /me/locale`（`setPreferredLocale`）：只接受 `zh-CN/en/ja/pt-BR/es` + 空串（清除），其它值 **400101 且不落库**；`GET /me` 返回 `user.preferred_locale` |
| Web | `setLocale()` **best-effort 写账号**（未登录/网络失败静默吞掉，绝不让"切语言"因为接口失败而回滚）；`plugins/i18n.ts` 建立**四层优先级**：<br>`?lang=` > 本设备 cookie > 账号偏好 > 浏览器 → `zh-CN` |
| Test | 新增 [account-locale.spec.ts](app/apps/api/test/account-locale.spec.ts) **5 例**：默认空串、存读幂等、空串清除、非法值 400101 且不落库、未登录 401101 |

### 为什么优先级要这样排

如果简单"账号偏好永远优先"，会出现：我在自己电脑上选了英文，结果登录后被我另一台设备设的日文顶掉；
反过来"cookie 永远优先"，换设备就丢了账号设置。所以采用：**本设备显式选择（cookie）> 账号偏好**，
账号偏好只在本设备"从没选过"时生效。这条语义写进了插件注释，避免以后被"图省事"改成单向覆盖。

### 两个环境坑（都是跑起来才暴露）

1. `ErrorCode.PARAM_ERROR` 在本仓**不存在**，正确值是 `INVALID_PARAM`（`400101`）；
2. 本仓**没有 `refresh_tokens` 表**（refresh token 存 Redis），我照抄其他 spec 的清理语句直接报错 →
   改成与 `auth-oauth.spec` 一致：只关连接池，不删测试用户。

### 第三个坑（不是本轮代码引起的，但值得记）

第一次跑 gate 时有 4 个用例假失败（canvas `sync-tasks`、timeline 导出 ×2、project-assets-image）——
原因是**上一轮遗留的 worker 进程还在消费队列**，把测试里"任务停在 pending"的前置条件破坏掉。
停掉 worker 后 815/815 全绿。这类"看起来是我改坏了、其实是环境残留"的失败，最容易诱发错误修复，
所以 gate 脚本里停 worker 的那一步不能省。

**验证**：`account-locale.spec` 5/5；`i18n-check.cjs` 全绿（2947 key / 43 页 + 20 组件）；
`e2e-i18n-pages.cjs` **138/138**；`pnpm lint` 0 error；全量 **1,147 例**（api 815 + adapters 164 + cli 89 + worker 33 + db 26 + shared 14 + storage 6）全绿。

## 变更登记（v6.8 · 多语言第 38 批：watch 播放页 + 覆盖率口径修正 + 外部依赖清单 · 2026-10-28）

### 1. watch 分享播放页（最后一个非页面文案缺口）

[watch/[token].vue](app/apps/web/pages/watch/[token].vue) 原本自带一份**只覆盖 zh-CN / en 的页面词典**，
其余 3 语言（ja / pt-BR / es）直接回落中文，标题也硬编码 `一帧`。改为共享 `watchPage`（**21 key** × 5）：

- 七种页面态（加载 / 转码中 / 已下架 / 链接失效 / 转码失败 / 加载失败 / 正常）全部 5 语言；
- `第 N 集`、`发布于`、`N 次播放`、`由一帧 AI 漫剧工作台生成`、复制分享链接与失败兜底；
- 标题走 `watchPage.metaTitle` / `metaTitleWith`（`{title} · OneFrame`）。

一个容易踩的点：我一开始加了 `w("key")` 中间层，**i18n-check 靠 `t("ns.key")` 字面量扫 key，间接调用等于没查**，
于是改回字面量 `t("watchPage.key")` 并删掉包装函数。

### 2. 覆盖率口径修正（重要）

审计 `pages/**/*.vue` 后发现有 **64 页**，其中 `/create/*` 是 **19 页**（此前一直按 17 计），
因此"用户面"分母应为 **43 = 64 − admin 2 − create 19**，而不是 45。修正后：

| 指标 | 旧（错） | 新（正确） |
|---|---:|---:|
| 用户面已迁移 | 41/45 = 91% | **41/43 = 95%** |
| 全部页面 | 43/64 = 67% | **45/64 = 70%** |
| 语言包 key | 2926 | **2947** |

即：**用户面只剩 2 页**（privacy / terms，按原则不机翻）。

### 3. 新增 §5.3「外部依赖清单」

把剩余 **5.01** 权重逐行拆成"谁提供什么 → 解锁多少"（详见
[implement-progress-vs-reelmate.md](docs/07-plan/implement-progress-vs-reelmate.md) §5.3）。要点：

- 仅 **≈1.4** 可由代码侧继续清（其中 1.0 是竞品口径确认，需要一句话拍板）；
- **≈3.6 必须外部输入**：竞品 MCP 工具清单 0.80、真实供应商 Key 0.60、商户分账资质 0.64、
  多知识库/Apple 登录/升级补差/ffmpeg/3D 协同等产品与账号项 ≈1.60、内容安全审计 0.08；
- 结论：**97.6% → 100% 的最后一公里是输入问题，不是实现问题**。

**验证**：`i18n-check.cjs` 全绿（2947 key / 43 页 + 20 组件）；`e2e-i18n-pages.cjs` **138/138**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v6.7 · 多语言第 37 批：admin 运营后台 2 页 · 2026-10-28）

`adminUi`（**109 key** × 5 语言）；**运营后台 2/2 = 100%**，全部页面 **43/64 = 67%**。

| 页面 | 迁移内容 |
|---|---|
| [admin/index.vue](app/apps/web/pages/admin/index.vue) | 六项 KPI；**运营位**（`GET /crc/banner_list` 读取条件说明、四种类型、六列表头、生效两态、启停与删除确认）；模型上下架；任务指标（失败率、成功/失败/取消、下载失败 CSV、`N 样本`/`N 次`）；任务审计；分享管理（已撤销/至某日/下线）；流水线漏斗（转化率）；举报处置（三态 + 下线/驳回 + 两条处置 note）；**创作者审核**（"只有待审可审、只有已通过可下架，不允许跳步"、四态、通过/驳回/下架、驳回理由）；**订单与全额退款**（"仅已支付可退、接口幂等、余额不足返回 400101 需人工"、四态、退款确认含金额与积分） |
| [admin/login.vue](app/apps/web/pages/admin/login.vue) | 凭据校验、登录失败码、标题与副标题、用户名/密码与占位、登录中、脚注"生产必须配置 ADMIN_USERNAME/ADMIN_PASSWORD" |

### 三处修复（都是"只有真跑才发现"的）

1. **第 8 次变量遮蔽/命名撞车**：E2E 里 `adZh/adEn` 与已有的 `AD1..AD4`（广告剧）重名 → 改 `admZh/admEn` 并换 ID 前缀。
2. **`/admin` 的 routeRules 不含子路径**：`/admin/login` 没有 `ssr:false` → 实测 `Hydration completed but contains mismatches`
   → 在 [nuxt.config.ts](app/apps/web/nuxt.config.ts) 补 `"/admin/**": { ssr: false }`（与 `/team`、`/canvas/**` 同类问题的第 3 次）。
3. **E2E 主 page 被上一个页面的 beforeunload 守卫挡住 goto**：广告剧页有离开守卫，导致后台登录页在同一个 page 上永远跳不过去
   （body 仍是广告剧）→ 后台登录页改用 **`page.context().newPage()`** 独立验证。

**验证**：`i18n-check.cjs` 全绿（2926 key / 43 页 + 20 组件）；`e2e-i18n-pages.cjs` **138/138**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v6.6 · 多语言第 36 批：canvas 七个面板 → **canvas 模块完成** · 2026-10-28）

页面覆盖 **40 → 41/64**；**用户面 41/45 = 91%**；`canvasUi` 扩到 **513 key**。canvas 模块 5 轮收口。

| 面板 | 迁移内容 |
|---|---|
| [CanvasAgentPanel](app/apps/web/components/canvas/CanvasAgentPanel.vue) | 新会话/结束会话/选择会话、**降级轮询提示 + 重试实时连接**、历史产出（N 节点 + 创建）、四态输入区（连接中/轮询/发送中/只读）、空态两套、同意/拒绝、将要创建的节点、赞/踩、模型由服务端路由的诚实说明、已引用 N 个节点 |
| [CanvasMaterialPanel](app/apps/web/components/canvas/CanvasMaterialPanel.vue) | 三种来源（上传/节点产出/资产库）、四种类型、移除确认、**"把选中节点结果存入"**、object_key 复制、**"只登记 object_key 不存直链"**说明 |
| [CanvasTemplatePanel](app/apps/web/components/canvas/CanvasTemplatePanel.vue) | 三种 scope（官方/团队/我的）、存为模板与命名、全部/我的、搜索、两种空态、套用、**"套用只加本地，点保存后才写库（走版本校验）"** |
| [CanvasDock](app/apps/web/components/canvas/CanvasDock.vue) | 选择/抓手/小地图/整理画布/适配视图/缩小/放大/重置百分比，全部 data-tip + aria |
| [CanvasPinBar](app/apps/web/components/canvas/CanvasPinBar.vue) | 槽位上限提示、空分组、存为分组、清空/删除两条确认、槽位菜单（替换/清空成员/删除/取消） |
| [CanvasCommentLayer](app/apps/web/components/canvas/CanvasCommentLayer.vue) | 两条校验、删除确认、批注点 aria（含已解决）、放置提示两态、回复（Ctrl+Enter）、重新打开/标记已解决 |
| [CanvasDownloadPanel](app/apps/web/components/canvas/CanvasDownloadPanel.vue) | 取链接（24h 有效）、空态、N 节点/N 文件、分页提示 |

### 两处工程细节

1. **第 7 次变量遮蔽**：`typeLabel(t: string)` 的参数名 `t` 遮蔽翻译函数 → 改名 `materialType`。
2. **把组件纳入 i18n-check**：`PAGES` 从 40 → **50**（新增 10 个 canvas 组件），立刻查出 `canvasUi.cancel` 漏建
   （有 3 个语言缺键）——这类"只在组件里用到"的键以前没人查，现在自动覆盖。

**验证**：`i18n-check.cjs` 全绿（2817 key / 41 页 + 20 组件）；`e2e-i18n-pages.cjs` **134/134**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v6.5 · 多语言第 35 批：CanvasInspector 收尾 → 检查器 100% · 2026-10-28）

`canvasUi` 扩到 **356 key**（本轮 +**56**）——**`CanvasInspector`（2921 行、全站最大单文件）已 100% 迁移**。

| 本轮区块 | 内容 |
|---|---|
| 资产面板 | 资产类别 activeTab、抽取原文与占位、抽取额度 + "留 0 表示不额外限制" |
| 剪辑面板 | 镜头顺序（+**"勾选顺序即镜头顺序，取消再勾会排到末尾"**）、无可用节点空态、导出目标、分辨率、封装格式、时间线 JSON（+"结构复杂且后端未枚举，保留 JSON 编辑"）、预览倍速 |
| 导演台 | **"没有专属生成参数，只有通用参考字段；机位/定格状态存在节点自身的 3D 场景里"**、作为参考素材、参考角色（camera/pose 占位）、参考标签（镜头编排占位） |
| 分组面板 | 标题、颜色、包含节点、组宽/组高（+**"与上方基础里的节点宽度是两个字段"**）、折叠、锁定（组内不可拖动）、服务端分组 ID（+回填占位） |
| 未知类型 | `未知节点类型「{type}」` + **"现有 params 会原样保留并随保存提交，不会丢字段"** |
| 连线区 | `出 / 入` 方向、删除 aria、**"删除连线只断开数据流，不会删除节点"** |
| 生成区 | need-mode / need-model 两条前置提示、上次失败原因、最近一次生成结果、生成中/已完成、**"未保存的新节点不能投递"** |
| 底部 | 退出连线/连线模式、已钉住/钉住、复制、删除节点 + "删除只改本地，保存后才会同步" |

**验证**：`i18n-check.cjs` 全绿（2659 key / 40 页 + 11 组件 / canvas 进行中）；`e2e-i18n-pages.cjs` **134/134**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v6.4 · 多语言第 34 批：CanvasInspector 模板层主干 · 2026-10-28）

`canvasUi` 扩到 **300 key**（本轮 +**139**，两批合并提交）——把 `CanvasInspector` 的模板主干做完：

| 区块 | 内容 |
|---|---|
| 批量操作 | 改状态（+"状态只是进度标记，不参与生成"）、**六向对齐**（+外接框基准说明）、批量生成（可投递计数、逐条独立说明）、批量下载（**最多 50 个 + manifest.json 说明**）、删除选中 N 个 |
| 画布概览 | 节点/连线/分组三统计、已钉住、类型分布、**五条操作提示**（双击建文本 / 单击编辑 + Shift 多选 / 连线模式 / Ctrl+Z·Y·S / 参数只改本地） |
| 基础区 | 名称、宽度（含"自动"占位）、Z 序、状态、分组归属（空态）、节点 ID、`{类型}参数` |
| 生成参数 | 文本（prompt/model/count/富文本格式 + hint）、图像（mode/prompt/model/count/ratio/quality/imageQuality/width/height + 三条 hint）、**3D 世界**（全景开关 + 等距柱状说明）、视频（mode/prompt/model/count/ratio/duration/fps/shotType/enableSound/mouthDrive/offPeak + 两条 hint） |
| 派生与拆解 | 视频拆解（按次计价/拆解/候选/一键建资产/正在拆解）、文本派生四动作（优化剧本/拆解分镜/拆分资产/匹配资产）、派生结果与资产候选、匹配结果（`镜N`） |
| 音频 | audioKind/prompt/model/duration/count + **voice 音色七项**（voiceId/voiceName/tone/speed/pitch/volume/previewPlaybackRate）+ 三档时长说明 + 取值范围说明 |
| Excel 导入 | **两步流**（导入 → Sheet 列表 → 确认 Sheet，明确"不会自动选第一个"）、解析中/写入中、工作表计数与行列元信息、数据来源、`sheet_selection_required` |
| 高级 JSON | sheets/columns 的 JSON 编辑与"后端未给字段级定义"的诚实说明 |

剩余：检查器尾部 **110 处**（下载/3D 资产/更多参数）+ 七个面板（约 150 处），canvas 模块再 2 轮完成。

**验证**：`i18n-check.cjs` 全绿（2603 key / 40 页 + 11 组件 / canvas 进行中）；`e2e-i18n-pages.cjs` **134/134**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v6.3 · 多语言第 33 批：canvas 节点摘要 + 检查器脚本层 · 2026-10-28）

`canvasUi` 扩到 **161 key**（本轮 +**90**）：

| 文件 | 迁移内容 |
|---|---|
| [CanvasNode.vue](app/apps/web/components/canvas/CanvasNode.vue) | 五类节点摘要（表格 Sheet/来源、剧本拆资产或拆分镜 + 镜数、视频段数与分辨率格式、机位定格、分组与成员数）、三态标签（生成中/已完成）、他人编辑锁定提示、生成中、任务与分组角标 |
| [CanvasInspector.vue](app/apps/web/components/canvas/CanvasInspector.vue)（脚本层） | 检查器标题五态（检查器/载入失败/已选 N 个节点/未命名节点/画布概览/批量操作/未命名画布）、**选项表全部翻译**：3 状态、**17 图像模式**（文生图…故事板 25）、**13 视频模式**（文生视频…AI 改视频）、4 音频、2 剧本、3 资产类型、3 表格来源、2 下载目标、富文本纯文本、5 语气；音频时长说明三档、JSON 校验三种、单/多节点删除确认、表导入四条提示与成功 toast、打包成功/失败、资产节点创建、状态回退 |

### 两处类型/命名修复

1. **第 6 次变量遮蔽**：`summary` computed 里原有 `const t = props.node.node_type`，加 `useI18n()` 后 6 处 `t(...)` 报 `TS2349` → 改名 `nodeType`，并再次在注释里建议加 lint 规则（这已是第 6 次，人工发现已经不可靠）。
2. **插值类型**：`t()` 的变量表收到 `{}`（`sheets`/`src`/`es.resolution` 等 `unknown`）→ 用 `String()` 显式兜底，避免 `TS2322`。

**验证**：`i18n-check.cjs` 全绿（2464 key / 40 页 + 11 组件 / canvas 进行中）；`e2e-i18n-pages.cjs` **134/134**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v6.2 · 多语言第 32 批：canvas 模块第一批 · 2026-10-28）

`canvasUi`（**71 key** × 5 语言）——无限画布模块的第一批（模块共 **14 个文件、约 500 处**文案，记"进行中"）：

| 文件 | 迁移内容 |
|---|---|
| [canvas/[id].vue](app/apps/web/pages/canvas/[id].vue) | 载入与错误态（正在载入/重试/返回画布列表）、10 条 toast（连线起点/已连线/连线已存在/整理画布/已创建 N 节点/重命名/版本冲突/重命名失败/历史读取失败/恢复）、恢复与离开确认、历史版本抽屉（标题/读取中/空态/载入）、dock 页签与三处 aria、两个"待接入"诚实提示（新手引导、图层树） |
| [CanvasTopBar.vue](app/apps/web/components/canvas/CanvasTopBar.vue) | `未命名画布` 回退、返回/返回画布列表、重命名提示、画布标题 aria、版本与未保存标记、撤销/重做/重新载入/历史四个 data-tip + aria、保存中/保存 |
| [CanvasToolbar.vue](app/apps/web/components/canvas/CanvasToolbar.vue) | 添加节点、连线（模式提示）、图层、模板库、素材库、下载记录、批注（全部 data-tip + aria）、菜单 aria 与标题 |
| [CanvasEmptyGuide.vue](app/apps/web/components/canvas/CanvasEmptyGuide.vue) | 8 个节点类型标签（文本/表格/图像/视频/音频/视频合成/剧本拆资产/剧本拆分镜）、3 条教程（添加/连接/快捷键）、引导标题与副标题、工具栏 aria、新手引导 chip |
| [CanvasMinimap.vue](app/apps/web/components/canvas/CanvasMinimap.vue) | 小地图 aria、`暂无节点` 空态 |

### 两处工程细节

1. **第 5 次撞到变量遮蔽**：`onRename` 里原有 `const t = next.trim()`，加 `useI18n()` 后 `t(...)` 直接 `TS2349`；
   已改名 `nextTitle` 并在注释里记"本项目第 5 次踩同类"。
2. **E2E fixture 契约**：创建画布返回 `{ id, version }`（不是 `{ canvas: {...} }`）；而且真实画布用例受
   `X-Space-Id` 空间上下文影响（前端会带 localStorage 里的团队空间）→ 改为断言**不存在的画布**的稳定错误态，
   这恰好覆盖本轮新迁移的错误态文案 + `document.title`。

**验证**：`i18n-check.cjs` 全绿（2373 key / 40 页 + 9 组件 / canvas 进行中）；`e2e-i18n-pages.cjs` **134/134**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v6.1 · 多语言第 31 批：`projects/[id]` 收尾 → 该页完成 · 2026-10-28）

页面覆盖 **39 → 40/64**；**用户面 40/45 = 89%**；全站 **97.6%** / 首发 **97.6%**。

`projectDetail.ui` 扩到 **202 key**（本轮新增 **144**），把全站最大单页（4357 行、约 270 处文案）做完：

| 本轮范围 | 内容 |
|---|---|
| 分镜工作台·左（分镜条） | AI拆分镜 + 首次免费、`分镜(N)`、三态（已投递/已定稿/未定稿）、加镜禁用说明、空态、分镜描述占位、素材区两条空态、本地/模型时长说明、空态标题与说明、生成分镜 |
| 分镜工作台·中（素材与出片） | 移出本镜、两条空态与提示、已投递标签 |
| 分镜工作台·右（生成台） | 图片/视频两个页签、首帧（已设/未设/3D 定格/清空）、模型、**幂等复用长说明**、选择素材、3D 导演台、素材上限计数、项目资产/更多素材源、提示词与两个禁用说明、提示词占位、AI 生成免责、秒/1个、立即生成、图片生成未接入说明 |
| 导出视图 | 标题与副标题、批量投递 N 镜、模型/预算上限/按报价预填、提交中/导出 zip、下载 zip、排队/打包/失败、重试、**三条 banner**（预算触顶/余额不足/角色未定稿）、分镜矩阵四态图例与 `第N集`、镜状态 tooltip（含任务后缀）、投递结果、空态 |
| 时间线视图 | 剧集资产、筛选（全部/已出片）、`分镜 N`、已出片/未出片、空态、更新气泡、无视频、选择提示、更新分镜、播放/暂停、片段数、缩放、合成导出、下载 mp4、左移/右移/移除、空轨道、**ffmpeg 水印说明** |
| 资产校验视图 | 两个子页签、搜索、重新提取、上下集、统计行、选中缺图/全选/取消全选、五列表头、`N 镜`、两处空态、删除勾选、取消定稿/批量定稿、下一步、提交生成 |
| 抽屉与弹窗 | 项目资产抽屉（搜索/勾选说明/已选计数/未搜到/取消/应用/保存中）、编辑资产四字段与四占位、选择参考图、选择定妆图、两处候选图与空态 |

### 三处"容易漏"的地方

1. **`:title` 模板字符串**：`镜${shot.shot_no} · 状态${shot.status}${task…}` 必须整体换成 `t()` 并**嵌套一个 task 后缀 key**；
2. **键名撞车**：导出视图里也有 `<option value="all">全部</option>`，但与资产筛选语义不同 → 复用 `assetFilters.all` 而不是新建；
3. `filterAll` 一度新建后又被删除（重复键），`i18n-check` 的"缺少页面用到的 key"立刻报出来。

**验证**：`i18n-check.cjs` 全绿（2302 key / 40 页 + 5 组件）；`e2e-i18n-pages.cjs` **130/130**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v6.0 · 多语言第 30 批：`projects/[id]` 模板层第一批 · 2026-10-28）

`projectDetail.ui`（约 **58 key** × 5 语言）——把该页从"仅脚本层"推进到"脚本层 + 顶栏/剧本/资产三个视图"。

| 迁移范围 | 内容 |
|---|---|
| 顶栏 | 返回项目列表、项目名回退、三种来源徽标（小说改编/导入剧本/一句话想法）、`ratio · 集数 · 角色数`、3D 导演台、保存 |
| 剧本视图 | 标题与副标题、重新生成/生成大纲、确认大纲、集 chip 与两态（已确认/草稿）、两个占位、进入分镜、**空态标题与说明** |
| 资产视图 | 标题与计数、新建{类型}/定妆图/`N 张`/生成角色、**AI 提取两块 CTA 与说明**（含"后端链路建设中"的诚实标注）、待定稿横幅与一键定稿、角色卡三态与四个动作（生成/重新生成/候选图/转通用资产）、空态三卡（提取/生成/导入）、资产卡备注与六个动作（生成图/候选图/编辑/定稿/取消定稿/删除）、导入说明与上传中 |

### 进度状态

该页仍记为**进行中**：模板层还剩 **138 处**（分镜工作台三列、导出视图、时间线、资产校验、四个弹窗）。
下一轮（第 31 批）做完这些即转为"完成"，用户面届时 **40/45 = 89%**。

**验证**：`i18n-check.cjs` 全绿（2158 key / 39 页 + 5 组件 / 1 页进行中）；`e2e-i18n-pages.cjs` **130/130**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v6.0 · 第 54 批：Apple `id_token` JWKS 验签 · 2026-10-29）

> **台账口径变更**：从第 30 批起，逐批变更登记以
> [implement-progress-vs-reelmate.md §9](07-plan/implement-progress-vs-reelmate.md) 为**唯一台账**（那里每条都带
> 基线 HEAD、模块完成度变化与测试数量变化）。README 只登记"改动契约/开发规范/全局口径"的批次，
> 避免两处各写一半导致读者看到互相矛盾的版本号（v5.x 期间就出现过：README 停在 v5.9，进度文档已到 v7.x）。

**本批改动（契约相关，故登记在此）**：`POST /v1/auth/oauth/apple/callback` 的 `id_token` 处理从"只 base64 解码取 `sub`"改为**完整验签 + claims 校验**。

| 项 | 改动 |
|---|---|
| 新增模块 | `apps/api/src/modules/auth/apple-id-token.ts`（`verifyAppleIdToken`）：alg 白名单 RS256/ES256（`none`/`HS256` 一律拒）、`kid` 定位公钥、`iss`/`aud`/`exp`/`iat` 校验、JWKS 5 分钟缓存 + `kid` 未命中强制刷新 |
| 行为变化 | 验签失败不再"信任解码结果"，一律 `400101` 且 `details.oauth_error=id_token_invalid` + `details.reason∈{bad_alg,missing_kid,unknown_kid,bad_signature,bad_issuer,bad_audience,expired,issued_in_future,jwks_unavailable,bad_nonce,malformed}`；**不回显 token** |
| 对客户端的影响 | 无（Apple 回调路径本来只有浏览器跳转；错误体形状仍是统一信封） |
| 测试 | `apple-id-token.spec.ts` **19 例**（本地 RSA/EC 密钥对 + stub JWKS，零网络）；`auth-oauth.spec.ts` 新增 **1 例** `form_post` 表单回调（表单 POST + 真实 state 登录成功、伪造 state → `400101 state_invalid`） |
| 一并纠正的错误结论 | 此前把「Apple `form_post` 回调会 415」列为缺口——实测前提不成立（Nest `FastifyAdapter` 自 v10 起默认注册 urlencoded 解析器），故未引入任何额外解析器，计划中的 `form-body.ts` 未落地 |

**验证**：`verify-round.ps1` 全绿（12/12；**1,195** 用例，其中 api 863 / adapters 164 / cli 89 / worker 33 / db 26 / shared 14 / storage 6）；`pnpm --filter @app/api typecheck` + `lint` 干净。
全站进度 **97.7%（201.26/206，剩余 4.74）**，#22 账号 **92% → 95%**。

## 变更登记（v5.9 · 多语言第 29 批：`projects/[id]` 第一阶段（脚本层）· 2026-10-28）

**口径更新**：`projects/[id]` 记为 **进行中**（不计入"已迁移页面"分子）；用户面仍是 39/45 完成 + 1 进行中。

[projects/[id].vue](app/apps/web/pages/projects/[id].vue)（4357 行、约 270 处文案，全站最大单页）新增 `projectDetail`
（含 `views`/`viewCards`/`assetTabs`/`assetFilters`/`mediaModes`/`batchReasons`/`kindLabel`/`tlExportStatus` 八组嵌套，约 **100 key** × 5 语言）：

| 迁移范围（本轮=脚本层） | 内容 |
|---|---|
| 视图与视图卡 | 四个视图（大纲/角色/分镜/投递）、六个视图卡（剧本/资产/分镜/导出/时间线导出/资产校验）及各自说明 |
| 资产与筛选 | 四个资产子页签（角色/场景/道具/其他）、三档素材筛选（全部/图片/视频） |
| 媒体模式 | 五种（参考生视频/首帧/首尾帧/文生/ AI改视频）+ 各自 hint + **三种"当前不能选"的拦截原因** |
| 状态与原因 | 投递失败四态（资产未定稿/超预算/余额不足/未提交）、时间线导出四态、资产 kind 四态 |
| 单集标识 | `第N集` / `本集` / `未命名` / 自动集标题 |
| 反馈文案 | **60+ 条** info/error：大纲生成确认、批量报价（含续投预算算式）、转存通用资产、定妆图、剧本/分镜生成、批量投递（未就绪/超预算两种整批失败 + 跳过统计）、导出与合成、时间线保存与重建、资产保存/定稿/删除/导入/生成候选/采用参考图、批量定稿/生成/删除 |

### 为什么分三阶段

这一页 4357 行、模板层还有 212 处文案，一次性迁移风险高（而且中途一定会出现"半页英文半页中文"）。
因此按 **脚本层 → 模板层一（视图骨架/分镜条/素材区）→ 模板层二（弹窗与生成台）** 三阶段推进，
并在进度文档里明确"进行中页面不计入完成分子"。

### E2E 的一个发现

首次进入该页（新项目还没有分集）时，**视图条不渲染**，只能看到当前视图名与"先出大纲"提示——
所以断言改为两条稳定信号：中文「分镜 + 先出大纲提示」、英文 `document.title`。

**验证**：`i18n-check.cjs` 全绿（2100 key / 39 页 + 5 组件 / `projects/[id]` 进行中）；`e2e-i18n-pages.cjs` **130/130**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v5.8 · 多语言第 28 批：团队管理 · 2026-10-28）

页面覆盖 **38 → 39/64**；**用户面 39/45 = 87%**；全站 **97.6%** / 首发 **97.6%**。

[team/index.vue](app/apps/web/pages/team/index.vue) 新增 `teamPage`（约 **130 key** × 5 语言，含 `tabs`/`rules`/`flowTypes` 三组嵌套）：

| 区块 | 迁移内容 |
|---|---|
| 页头 | 团队管理、`{团队} · 席位 x/y · 团队积分池 N`（含冻结与个人空间徽标）、空间切换（团队/个人后缀）、七个动作按钮、只读成员提示、数据看板入口 |
| 成员表 | 批量工具条（已选 N 人/启用/停用/批量分配/移到分组/取消选择）、八列表头、状态三态、编辑、空态 |
| 积分管理 | 团队积分池与充值说明、**分配规则长文案**、分配/回收两表单（成员/积分/备注/确认）、可选成员带"已分配额度"、流水五列与空态、导出流水、排行、分组统计与空态 |
| 团队模型开关 | 四项开关（影视版/Agent 白名单/BYOK/Seedance）与**"未取证"诚实标注**、派生来源说明 |
| 规则说明 | 六条（池/额度/成对记账/消耗来源/角色/席位），术语精确（"当前积分是已分配额度，不是余额"） |
| 五个弹窗 | 编辑成员（角色/分组/昵称/备注/状态）、邀请成员（手机号/角色/分组/逐条结果行）、新建分组、团队设置（名称/席位上限与下限提示/两个开关）、批量分配、创建团队 |

冲突处理：页面原本就有 `myTeams.map((t) => ...)`，加 `const { t } = useI18n()` 后与翻译函数重名 → 映射变量改 `item`；
`kindLabel` 从常量改为 computed（流水类型四态）。

**验证**：`i18n-check.cjs` 全绿（2003 key / 39 页 + 5 组件）；`e2e-i18n-pages.cjs` **126/126**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v5.7 · 多语言第 27 批：剪辑台时间线导出 · 2026-10-28）

页面覆盖 **37 → 38/64**；**用户面 38/45 = 84%**；全站 **97.6%** / 首发 **97.6%**。

[reelflow/edit/[id].vue](app/apps/web/pages/reelflow/edit/[id].vue) 新增 `editor`（约 **115 key** × 5 语言）：

| 区块 | 迁移内容 |
|---|---|
| 顶栏 | 返回分镜创作、时间线导出、保存、项目名回退、未保存标记、集数切换、下载 mp4、切片发布、导出/合成中 |
| 左栏素材 | 剧集资产、素材筛选（已定稿/全部）、"只列已定稿…"提示、"共 N / M 个镜头"、每条的已定稿/未定稿两态与 tooltip、空态两种文案、更新分镜、轨道 N 段 |
| 播放器 | 回到分镜预览、片段无视频、mock 占位说明、选择资产提示、更新说明、合成完成条（播放成片/下载）、播放/暂停、`N 段 · 共计 Ns` |
| 时间线轨道 | 片段资产入口、缩放三件套（aria）、片段 aria（名称+秒）、移除、拖动调时长、空轨道提示 |
| 切片发布 modal | 标题/开始/结束/发布、"发布是**对外作品**…"长说明、下载/复制 token/分享页/下架、空态 |
| 片段资产 modal | "快照语义…整体替换"说明、绑定镜头产物、清空绑定、空态、从已定稿资产中选择 |
| 状态与提示 | `EXPORT_LABEL` / `PUB_STATUS` 两组状态改 computed（含 `0: ""`），30+ 条 toast·confirm |

两处细节：① `EXPORT_LABEL` 原先含 `0: ""`，改 computed 时保留空串；② 迁移后中文出现 **"共 共 0 / 0 个镜头"**
（模板原有「共」+ key 里也有）——E2E 直接打印页面文本一眼看出，已删多余字。

**验证**：`i18n-check.cjs` 全绿（1904 key / 38 页 + 5 组件）；`e2e-i18n-pages.cjs` **122/122**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v5.6 · 多语言第 26 批：我的集市作品 · 2026-10-28）

页面覆盖 **36 → 37/64**；**用户面 37/45 = 82%**；全站 **97.6%** / 首发 **97.6%**。

[novel-market/manage.vue](app/apps/web/pages/novel-market/manage.vue) 新增 `marketManage`（约 **89 key** × 5 语言）：

| 区块 | 迁移内容 |
|---|---|
| 页头与 KPI | 标题、`上架 · 审核 · 收益 · 提现（平台抽成 x%，运营未拍板）`、去集市/刷新；五张 KPI |
| 上架表单 | 本子 ID（含"解析本子"按钮与解析中态）、**解析结果一行**（章/字/角色/集 + 已定稿/未定稿两态）、标题与简介占位、售价、预售定金（留空=直接在售）、分类、标签多选、保存草稿与"存草稿后去列表提审"提示 |
| 作品表 | 六列表头、审核意见、提交审核/下架两个动作、**两种无动作说明**（审核中不可操作 / 暂无可执行动作） |
| 提现 | 金额（带最低值）、渠道三选、收款账号（"仅落库不做真实打款"）、提交、"同一时间只能 1 笔待审"提示、记录六列、撤销 |
| 成交明细 | 七列表头（作品/类型/成交价/平台抽成/我的收益/状态/时间）、空态 |
| 校验与提示 | 20 条 toast 与 confirm（解析/保存/提交/下架/提现/撤销） |

另外 `fmtTime()` 与解析字数都改用**当前 locale** 的数字/时间格式（原本写死 `zh-CN`）。

**验证**：`i18n-check.cjs` 全绿（1806 key / 37 页 + 5 组件）；`e2e-i18n-pages.cjs` **118/118**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v5.5 · 多语言第 25 批：创作者作品详情 · 2026-10-28）

页面覆盖 **35 → 36/64**；**用户面 36/45 = 80%**；全站 **97.6%** / 首发 **97.6%**。

[creator-center/[id].vue](app/apps/web/pages/creator-center/[id].vue) 新增 `workDetail`（约 **87 key** × 5 语言）：

| 区块 | 迁移内容 |
|---|---|
| 页头 | 作品详情回退、`· 售出 N 笔 · 累计收益 N 积分`、预览/收益/返回三个入口 |
| 状态机 | 六态（草稿/待审核/在售/已驳回/已下架/预售中）由常量改 computed |
| 审核与前置条件 | 审核意见、`还不能提审：` 后按 `readiness` 逐条列「售价需 > 0」「关联本子未定稿」 |
| 基本信息 | 查看/编辑两态：标题、售价、预售定金（0=不开）、简介；四项 `dl`（售价/预售定金/内容结构 `N 章/集 · N 字`/发布时间/简介） |
| 操作区 | 提交审核 / 重新提审 / 下架三态按钮 + "待审核/在售不能改价，先下架→编辑→重新提审"的说明 |
| 校验与提示 | 标题必填、保存成功/失败、下架确认、提审/下架成功、操作失败 |

### 本轮的新坑：`locale` 在模板里会被自动解包

`useI18n().locale` 是 `ComputedRef<Locale>`，**脚本里必须 `.value`，模板里会自动解包**。
我在模板里写了 `toLocaleString(locale.value)` → `TS2551: Property 'value' does not exist on type ...`。
正确写法：脚本 `locale.value`、模板 `locale`。（与"`v-for` 变量叫 `t`"并列，已归入同一类"i18n 上下文变量"注意事项。）

**验证**：`i18n-check.cjs` 全绿（1717 key / 36 页 + 5 组件）；`e2e-i18n-pages.cjs` **114/114**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v5.4 · 多语言第 24 批：团队知识库 · 2026-10-28）

页面覆盖 **34 → 35/64**；**用户面 35/45 = 78%**；全站 **97.6%** / 首发 **97.6%**。

[knowledge/index.vue](app/apps/web/pages/knowledge/index.vue) 新增 `knowledge`（约 **87 key** × 5 语言）：

| 区块 | 迁移内容 |
|---|---|
| 页头 | 标题、`目录 N · 条目 N · 标签 N · 最多 N 层目录`、刷新、加载与重试 |
| 目录树 | 目录/全部、空态、新建（顶层/子目录两种占位）、重命名选中目录、**级联删除确认**（说明"子目录与条目一并软删、可恢复"）、保存 |
| 条目工具栏 | 搜索（跨目录）、含子目录、全部标签筛选 |
| 新建条目 | 标题/正文两处占位、标签 chips（含选中态）、"标签需先创建"提示 |
| 从资产库导入 | ID 占位、不指定目录、导入、"只能导入本空间（跨团队 403）"说明 |
| 条目列表 | `条目（N）`、移到…、批量移动/删除、空态、未分类、`引用资产：…（kind）`、导出到资产库、删除、分页 |
| 标签管理 | 新建、空态、未使用标记、删除确认（`会从 N 条资产上移除`）、改名/删除的影响说明 |
| 校验与提示 | 30+ 条 toast 与 confirm（目录/标签/条目/导入/导出/批量） |

### 第四次撞到同一个坑：`v-for="t in tags"` 遮蔽 i18n 的 `t`

`knowledge/index.vue` 里有 **4 处** `v-for="t in tags"`，加 `const { t } = useI18n()` 后类型全错
（`Property 'id' does not exist on type 'TranslateFn'`）。改名 `tag` 后一次变绿。
这已是同类问题的第 4 次（前面分别是 `v-for="t in config.tags"`、`canvas` 的 `relativeTime()` 局部 `t`、`film` 页签循环），
**建议加一条 lint 规则**（或 DO 文档红线）而不是继续靠人工发现。

另修一处自己造成的误报：注释里写了 `t("...")` 被 `i18n-check` 当成真实 key 判缺失——注释已改写。

**验证**：`i18n-check.cjs` 全绿（1630 key / 35 页 + 5 组件）；`e2e-i18n-pages.cjs` **110/110**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v5.3 · 多语言第 23 批：剧本工厂工作台 + 步进器 · 2026-10-28）

页面覆盖 **33 → 34/64**；**用户面 34/45 = 76%**；全站 **97.6%** / 首发 **97.6%**。

[novel/[id].vue](app/apps/web/pages/novel/[id].vue) + [NovelStepper.vue](app/apps/web/components/novel/NovelStepper.vue)
新增 `novelStudio`（约 **100 key** × 5 语言），这是**单页最大的一次迁移**：

| 区块 | 迁移内容 |
|---|---|
| 页头 | 返回剧本工厂、标题、定稿/草稿徽标（含 `status=16/1`）、画幅、`mock 模式（无 Key，确定性输出）`/`真实模型`、定稿按钮 |
| 七 tab | 章节 / 内容分析 / 章节大纲 / 分集大纲 / 核心角色 / 分集剧本 / 编辑 Agent（+ 原创链） |
| 各 tab | 分章（章数占位/重新分章/空态）、内容分析（世界观三字段 + 关系 + 角色卡列表 + 角色卡弹窗七字段）、章纲/集纲（提示与保存）、核心角色（提示与空态）、分集剧本（集 chip/已选提示/正文编辑/确认） |
| 状态与校验 | 20+ 条 toast（分章、分析、保存世界观、角色卡、章纲、集纲、核心角色、剧本生成含`还缺第 X 集`、保存版本号、确认、定稿幂等）+ 角色三态（主角/配角/反派） |

### 一个被 E2E 精确定位的"数据 vs 页面"边界

迁完后英文页仍有中文。E2E 把中文行打出来，来源很清楚：

- `steps[].hint`（如「2 章已解析」「生成世界观与角色卡（内容分析）」）是**后端返回的中文**；
- 章节标题与正文是**用户数据**。

所以 NV4 改为只断言"页面自身文案"（tab 与页面按钮全为英文），并把后端 `steps[].hint` 与影视 `film_tables` 预置表名
一起列进"**两类后端中文数据待改造**"（正确修法：后端返回 `hint_key` + 参数，前端按 key 翻译）。

**验证**：`i18n-check.cjs` 全绿（1543 key / 34 页 + 5 组件）；`e2e-i18n-pages.cjs` **106/106**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v5.2 · 多语言第 22 批：收益页 · 2026-10-28）

页面覆盖 **32 → 33/64**；**用户面 33/45 = 73%**；全站 **97.6%** / 首发 **97.6%**。

[creator-center/earnings.vue](app/apps/web/pages/creator-center/earnings.vue) 新增 `earnings`（约 **84 key** × 5 语言）：

| 区块 | 迁移内容 |
|---|---|
| 总览 | 累计收益 / 可提现 / 提现中三张卡（含「成交 N 笔 · 平台抽成 x.xx%」「已扣除未终结提现」「已打款累计」三条说明）、结算说明 |
| 提现表单 | 金额（含最低/最高提示）、收款渠道（支付宝/微信/银行卡）、收款账号与占位、收款人（选填）、待审警告、提交与"前端不改余额"说明 |
| 提现记录 | 六列表头、五个状态文案、撤销动作与确认框、空态 |
| 收益明细 | 四列表头、空态、`共 N 条（本页显示最近 20 条）` |
| 校验与提示 | 金额必填/低于最低/超过可提现/账号必填，提交成功与失败、撤销成功与失败 |

两处顺带修掉的"隐式中文"：

1. `money()` 里写死 `toLocaleString()` + 「积分」后缀 → 改为 `t("earnings.creditUnit", { value })` + 当前 locale 数字格式；
2. `fmtTime()` 写死 `toLocaleString()`（默认中文格式）→ 改为 `toLocaleString(locale.value)`。

**验证**：`i18n-check.cjs` 全绿（1458 key / 33 页 + 4 组件）；`e2e-i18n-pages.cjs` **101/101**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v5.1 · 多语言第 21 批：影视版任务表 · 2026-10-28）

页面覆盖 **31 → 32/64**；**用户面 32/45 = 71%**；全站 **97.6%** / 首发 **97.6%**。

[film/[id].vue](app/apps/web/pages/film/[id].vue) 新增 `filmDetail`（约 **84 key** × 5 语言）：

| 区块 | 迁移内容 |
|---|---|
| 页头 | 返回影视版、项目名回退、`项目 xxxxxxxx`、`N 条任务 · 待审 N · 定稿 N`、导出/新建列/新建行 |
| 门禁 | 「影视版尚未开通」标题与开通指引（商务开通制） |
| 表页签 | 预置角标、`＋ 新表` |
| 工具条 | 已选 N 行、成员 ID 占位、批量派工、批量删除、列设置 |
| 任务网格 | 空态引导、系统列 tooltip、状态/操作表头、行内审核·画布·删除、子行审核、分页 |
| 两个弹窗 | 新建列（列名/类型/九种类型/系统列说明/取消·创建）、绑定画布（标题带行名、空态、保存） |
| 契约值不动 | `FIELD_TYPES` 与 `STATUS_OPTIONS` 的 **value 保持原值**（后端契约），只把 label 改 computed + i18n |

### E2E 首次给影视版造出完整 fixture（并踩两坑）

1. **`film_enabled` 是 smallint**：SQL 写 `= true` 直接报类型错；要写 `= 1`。
2. **活动空间污染**：前面看板用例把 `active_space_id` 设成了团队空间，后续请求带 `X-Space-Id`，
   白名单查的是**团队空间**的开关——所以表页一直显示"尚未开通"。E2E 在影视段前先清掉 localStorage。

### 一处诚实缺口（已记录，不在本轮修）

预置表名「分镜任务表 / 资产需求表」是**后端种子数据**，英文界面下仍是中文。
正确修法是后端给 `film_tables` 加 `preset_key`，前端按 key 翻译；本轮只在文档标注（前端按中文名硬映射会很脆）。

**验证**：`i18n-check.cjs` 全绿（1374 key / 32 页 + 4 组件）；`e2e-i18n-pages.cjs` **97/97**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v5.0 · 多语言第 20 批：广告剧 + 视频转绘全流程 4 页 · 2026-10-28）

页面覆盖 **27 → 31/64**；**用户面 31/45 = 69%**；全站 **97.6%** / 首发 **97.6%**。

| 页面 | namespace | 迁移内容 |
|---|---|---|
| [ad-drama/create.vue](app/apps/web/pages/ad-drama/create.vue) | `adDrama.create` | 商品素材（上传/预览/名称/亮点）、生成设置（画幅/风格/主题/项目名）、创建动作、顺序提示、12 条校验与 toast；画幅与风格标签改 computed，**风格值仍保留后端认的字符串** |
| [ad-drama/workspace.vue](app/apps/web/pages/ad-drama/workspace.vue) | `adDrama.workspace` | 五段（卖点/剧情方案/剧本/分镜/资产）标题、按钮与空态、剧本重置与保存、急速/至尊模板、含配音/不含配音、提示词建议、消耗表、`actions.*` 动作名与"完成，消耗 N 积分" |
| [video-redraw/create.vue](app/apps/web/pages/video-redraw/create.vue) | `redraw.create` | 源视频（上传/资产库/已选提示）、风格与强度、比例三档、最近项目、创建动作；风格改 computed + 13 条校验与 toast |
| [video-redraw/workspace.vue](app/apps/web/pages/video-redraw/workspace.vue) | `redraw.workspace` | 四阶段名、切集（单集/批量/等分集数/每集时长/集 chip）、分镜计划（单镜时长/覆盖式说明/四列表头/已绑数）、重绘生成（参考图/视频/报价说明）、绑定（快照语义） |

### 四个实现要点

1. **"值"与"标签"分离**：`ad-drama` 的风格值是中文（后端按字符串存），`video-redraw` 的风格值是英文 key；
   两处都改成 `computed` 标签 + 值不动，避免改翻译就改坏已有数据。
2. **阶段常量改 computed**：两个 workspace 的 `STAGES` 原本是模块级常量，切语言不会更新。
3. **两处英文空态缺空格**：`No ad drama projects yet.` 直接拼 `<NuxtLink>` → `yet.Create`，E2E 文本对比一眼看出，已修。
4. `i18n-check` 仍会报 `ad-drama` 风格值里的中文字面量（5 处）——那是**发给后端的数据**，不是 UI 文案，属预期保留。

**验证**：`i18n-check.cjs` 全绿（1290 key / 31 页 + 4 组件）；`e2e-i18n-pages.cjs` **91/91**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v4.9 · 多语言第 19 批：举报 / 发布作品 / 作品预览 + 新口径 · 2026-10-28）

页面覆盖 **24 → 27/64**；**用户面页面 27/45 = 60%**（新口径）；全站 **97.6%** / 首发 **97.6%**。

| 页面 | namespace | 迁移内容 |
|---|---|---|
| [report.vue](app/apps/web/pages/report.vue) | `report`（21 key） | 标题与说明、token/类型（6 种）/补充/联系方式四字段、提交与提交中、缺 token 与成功/失败提示、脚注、返回首页 |
| [creator-center/publish.vue](app/apps/web/pages/creator-center/publish.vue) | `publish`（34 key） | 三步表单（选本子/基本信息/价格）、`KIND_OPTIONS` 改 computed、六处占位与校验、missing 列表、草稿与提审两个动作、四条 toast |
| [creator-center/preview/[id].vue](app/apps/web/pages/creator-center/preview/[id].vue) | `preview`（22 key） | 标题回退、元信息（类型/积分/状态/审核意见）、编辑与复制链接、三类媒体占位（含「剧本以文本预览」）、内容结构（章节回退与字数）、分享链接、买家视角、复制成功/失败 |

### 新增口径：用户面页面覆盖（§2.2.1）

模块 #16 用整数百分比记分，而 i18n 剩余工作是可数的**页面数**——只看分数会以为「三轮没动」。因此新增：

| 口径 | 分母 | 已迁 | 覆盖率 |
|---|---:|---:|---:|
| 用户面页面（排除 admin 2 页 + `/create/*` 17 页） | 45 | 27 | **60%** |
| 全部页面 | 64 | 27 | 42% |

### 一条明确的范围决定：法务文本不机翻

`privacy` / `terms` 两页**不进入 i18n 翻译队列**：法律文本的译文需要法务审定，机翻会引入责任风险。
已在文档中单列说明（待法务确认后人工翻译），而不是默默留在「未迁列表」里。

**验证**：`i18n-check.cjs` 全绿（1114 key / 27 页 + 4 组件）；`e2e-i18n-pages.cjs` **81/81**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v4.8 · 多语言第 18 批：创作者中心 · 2026-10-28）

页面覆盖 **23 → 24/64**；全站 **97.6%** / 首发 **97.6%**（#16 保持 99%）。

[creator-center/index.vue](app/apps/web/pages/creator-center/index.vue) 新增 `creatorCenter`（**87 key** × 5 语言），
这是目前**单个页面 key 最多**的一次迁移：

| 区块 | 迁移内容 |
|---|---|
| 头部 | 标题、在岗式副标题（`{name} · 作品 A/T 已通过 · 粉丝 N`）、刷新 |
| 五个 tab | 我的作品 / 作品广场 / 我的资料 / 粉丝·关注 / 我的激励 |
| 我的作品 | 投稿卡（标题/素材地址/简介三个占位、创建草稿、创建中）、六个状态筛选、空态、卡片元信息、审核意见、六个动作（送审/重新送审/通过/驳回+原因/下架/删除） |
| 作品广场 | 只读说明、空态、卡片元信息、点赞/已赞、关注作者 |
| 资料 | 对外资料说明、两个占位、保存/保存中、六项统计 |
| 粉丝/关注 | 两个标题（带参）、两处空态、回关、粉丝数、取消关注 |
| 激励 | 只读视图说明（长文案，说明数据来自账本 gift 流入）、四个 KPI、空态、表头四列 |
| toast/确认 | 加载失败、操作失败、标题必填、草稿已存、驳回须填原因、四种状态提示、已删除、取消点赞、关注/取关、昵称必填、资料已更新、两种删除确认 |

**验证**：`i18n-check.cjs` 全绿（1024 key / 24 页 + 4 组件）；`e2e-i18n-pages.cjs` **69/69**（新增创作者中心中英对照）；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

> 说明：#16 仍记 99%——剩余 40 页里既有用户可见页（集市管理、合集详情、创作详情、ReelFlow 编辑…），
> 也有内部/技术页（admin、create 工具参数页）。等**用户可见主干页面**全部迁完再看是否给 100%。

## 变更登记（v4.7 · 多语言第 17 批：剪辑台列表 + 无限画布列表 · 2026-10-28）

页面覆盖 **21 → 23/64**；全站 **97.6%** / 首发 **97.6%**（#16 保持 99%，剩余 0.08 权重对应约 5 页）。

| 页面 | namespace | 迁移内容 |
|---|---|---|
| [reelflow/list.vue](app/apps/web/pages/reelflow/list.vue) | `reelflow`（28 key） | 顶栏（返回工作台/剪辑台/全部项目）、两个 tab（项目 N / 已导出）、按日分组四档（今天/昨天/最近 7 天/更早）、卡片（剧型/集数/时长/最后编辑/四态徽标/已出片进度/示例角标）、两处空态与底部"创建项目"胶囊 |
| [canvas/index.vue](app/apps/web/pages/canvas/index.vue) | `canvas`（29 key） | 顶栏（工作台/品牌/新建画布）、错误态与重试、空态标题与引导、卡片（打开/重命名/删除的 aria 与 title、节点数、相对时间四档）、分页、删除确认弹窗（标题/正文/软删除说明/取消/删除）与 4 条 toast |

### 三个值得记的点

1. **变量遮蔽 i18n 的 `t`**：`canvas/index.vue` 的 `relativeTime()` 里原本有 `const t = new Date(iso).getTime()`，
   加 `const { t } = useI18n()` 后 `t(...)` 直接报 `TS2349: Type 'Number' has no call signatures`。
   已把本地变量改名 `ts` 并加注释。这是本项目**第二次**踩同类遮蔽（第一次是 `v-for="t in tags"`），已列为迁移检查项。
2. **同义文案复用而不是再造**：`reelflow/list.vue` 的剧型标签（国内仿真人剧/海外/2D-3D 动漫）与首页同一套枚举，
   直接复用 `home.dramaType.*`，避免两处翻译各自漂移。
3. **两处 `<Button>新建画布</Button>` 文本相同**：批量替换必须按 class 区分（`.canvas-create` 顶栏 / `.canvas-create-cta` 空态），
   否则会漏一处（i18n-check 的"疑似未迁移中文字面量"正好把漏掉的那处报出来了）。

**验证**：`i18n-check.cjs` 全绿（937 key / 23 页 + 4 组件）；`e2e-i18n-pages.cjs` **65/65**（新增剪辑台与画布中英对照）；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v4.6 · 多语言第 16 批：集市作品详情 · 2026-10-28）

**#16 多语言保持 99%**（页面覆盖 20 → **21/64**）；全站 **97.6%** / 首发 **97.6%**。

| 文件 | namespace | 迁移内容 |
|---|---|---|
| [novel-market/[id].vue](app/apps/web/pages/novel-market/[id].vue) | `marketDetail`（56 key） | 返回集市、加载/错误/重试、作者与已售、价格与预售定金、买断/付定金/不可购买三态、三个 tab（作品信息/内容结构/协议条款）、四类计数、审核意见、商务条款（抽成/实收/最低提现带参）、内容闸门文案、章节与角色卡、协议三签与自动生成说明、购买确认与 8 条 toast |

- 语言包 **824 → 880 key**。
- **E2E 补上了动态路由的 fixture**：这一页需要真实作品 id，所以断言里现场跑完整上架链路
  （`save → submit → ops approve`）再进页面，中英各检查一遍（**57/57**）。这也让 `page-content-smoke` 之外
  的动态页面有了第一个"真数据 + 真浏览器"的先例。

### 写 E2E 又踩到一个 HTTP 细节（值得记）

`POST /market/creator/works/:id/submit` 是**无 body** 的端点；如果请求带了
`content-type: application/json` 而不带 body，Fastify 直接 400100
（`Body cannot be empty when content-type is set to 'application/json'`）。
E2E 里统一改成"有 body 才带 content-type"，否则上架链路会在 submit 一步静默失败、
后面 approve 再报 `work is not pending review (status=1)`——两个错误叠起来很像"页面坏了"。

**验证**：`i18n-check.cjs` 全绿（880 key / 21 页 + 4 组件）；`e2e-i18n-pages.cjs` **57/57**；
`page-content-smoke.cjs` 49/49；`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v4.5 · 多语言第 15 批：创作 Agent + 新增全站页面内容冒烟 · 2026-10-28）

**#16 多语言 98% → 99%**；全站 **97.6%** / 首发 **97.6%**。

### 1. 创作 Agent i18n（`agent` 40 key × 5 语言）

迁移 [agent.vue](app/apps/web/pages/agent.vue)：侧栏（创作会话/新会话/空态/会话卡三行/删除确认）、
顶部（当前会话名/渠道状态四态/重试实时连接/结束会话与确认）、消息流（加载/空态标题与示例/思考中/等待回复）、
输入区（Skill chip 移除、已结束提示、两种 placeholder、Skill 卡按钮、发送/发送中、五行状态提示）。

### 2. 新增 `_acceptance/page-content-smoke.cjs`：全站页面内容冒烟 **49/49**

本轮把上一轮的教训固化成脚本：**以"渲染后的主内容区文本"为判据**，逐页断言
「内容非空（>12 字）+ 命中该页标记词 + 不是错误页 + 无 5xx」，覆盖 31 个固定路由 + 17 个 `/create/*` 工具落地页。

- 这类检查专门抓"HTTP 200 但页面坏了"：`/team/dashboard` 的路由冲突就是这种形态（状态码永远 200）。
- 写的两个坑都值得记：
  1. **不要按"能力名"猜路由**——我一开始把 `de-subtitle` / `video-slicing` 也列进 `/create/*`，
     实测"页面未找到"；它们其实是「视频超清」页的 tab（竞品侧也没有独立路由）。清单错 ≠ 页面坏。
  2. **错误页判据不能只匹配裸 `404`**——`/team` 页面的成员 id（如 `108568742720405504`）里含有 `040`，
     早期正则会误判成错误页。改为只认完整短语（页面不存在/出错了/Internal Server Error）。

**验证**：`i18n-check.cjs` 全绿（824 key / 20 页 + 4 组件）；`e2e-i18n-pages.cjs` **52/52**；
`page-content-smoke.cjs` **49/49**；`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v4.4 · 多语言第 14 批：团队数据看板 + 修 3 个真实前端 bug · 2026-10-28）

**#16 多语言 97% → 98%**；全站 **97.5%** / 首发 **97.6%**。

### 1. 数据看板 i18n（`teamDashboard` 49 key × 5 语言）

迁移 [team/dashboard.vue](app/apps/web/pages/team/dashboard.vue)：标题与在岗副标题、时间范围三档、KPI 四卡（含
"积分 · 本月 / 含全部状态 / 共 N 席位 / 冻结 N"）、积分消耗排名（含条形与"任务数"）、成员参与明细表头七列与分页、
项目数据表头六列、画布消耗说明与两项 KPI、空态与导出 toast。已迁移 **19/64 页 + 1 组件**，语言包 **784 key**。

### 2. E2E 顺带抓出的 3 个真实前端 bug（都不是文案问题）

| # | Bug | 为什么难发现 | 修法 |
|---|---|---|---|
| 1 | `pages/team.vue` + `pages/team/dashboard.vue` 构成 Nuxt **父子路由**，而父级没有 `<NuxtPage/>` → `/team/dashboard` 渲染的是「团队管理」，**看板整页打不开** | HTTP 仍返回 **200**（SSR 壳层正常），"页面 200" 这类弱证据完全看不出来 | 改为 `pages/team/index.vue`，两个页面成为同级路由；文件头留了"不要再改回 team.vue"的注释 |
| 2 | `useActiveSpaceId()` 用 `useState` + `localStorage` 初始化，但**带 SSR 时 hydration 不重跑 initializer** → 硬刷新后活动空间丢失，团队页提示"请先去团队管理选团队" | 只有"刷新/换设备/深链接"才复现；开发时先访问过团队管理就一直正常 | 新增 `plugins/active-space.client.ts`，客户端启动时把持久值同步进 state |
| 3 | 深链接兜底取 `/cam/teams/mine` 的 `list[0]`，而**个人空间排在团队前面** → 看板显示个人消耗、X-Space-Id 也不是团队 | 页面"有数据"、不报错，只有对比口径才发现数字全错 | 新增 `composables/useEnsureTeamSpace.ts`：优先 `type=2`（团队），没有团队才回落 |

**E2E 也因此升级**：不再手动写 `active_space_id`（那会把 bug 2/3 遮住），改为断言
「深链接能自解析团队空间」+「副标题必须是团队名，不能是"我的空间"」。

**验证**：`i18n-check.cjs` 全绿（784 key / 19 页 + 4 组件）；`e2e-i18n-pages.cjs` **47/47**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v4.3 · 多语言第 13 批：活动中心 · 2026-10-28）

**#16 多语言 96% → 97%**；全站 **97.5%** / 首发 **97.6%**。

| 文件 | namespace | 迁移内容 |
|---|---|---|
| [activities.vue](app/apps/web/pages/activities.vue) | `activities`（67 key） | 标题/副标题、两个 tab（可报名 / 我报名的）、加载与空态、活动卡（说明/奖励与时间窗/标识/我的报名/已提交作品）、详情面板（报名奖励/窗口/已报名/已入围）、报名表单（作品选择、渠道、草稿、提交、未开放）、入围与获奖名单、活动状态机四态、13 条 toast 与确认框 |

- 已迁移 **18 / 64 页 + 1 组件**，语言包 **668 → 735 key**。
- 两处"常量数组"再中同一类坑：`MODES`（tab 文案）与 `statusLabel()`（活动状态）原本都是硬编码中文/常量，
  迁移时同样改成 `computed` / `t()` ——这是本项目 i18n 迁移里**最高频**的返工点（目前已在前 3 批各遇到一次）。
- 一处类型坑：`my_signup.status_label` 是 `string | null`，vue-i18n 插值不接受 `null`，已加 `?? ""` 兜底（两处）。

**验证**：`i18n-check.cjs` 全绿（735 key / 18 页 + 4 组件）；`e2e-i18n-pages.cjs` **40/40**（新增活动中心中英 + tab/空态）；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v4.2 · 多语言第 12 批：首页 + 新手引导条 · 2026-10-28）

**#16 多语言 95% → 96%**；全站 **97.5%** / 首发 **97.6%**。

| 文件 | namespace | 迁移内容 |
|---|---|---|
| [home.vue](app/apps/web/pages/home.vue) | `home`（46 key） | 主标题、未读徽标（带参）、AB 位 CTA（两变体）、双入口卡（短剧工作流/无限画布）、**工具矩阵 7 张卡**（label/desc/tag 三组嵌套 key）、**轮播 3 条**（title/sub）、剧型标签（3 种）、最近项目区（标题/查看全部/空态/创建按钮）、轮播 aria-label |
| [OnboardingBar.vue](app/apps/web/components/OnboardingBar.vue) | `onboarding`（10 key） | 引导条标题、3 个步骤（title/desc）、开始创建、不再提示 |

- 已迁移 **17 / 64 页 + 1 组件**，语言包 **596 → 668 key**。
- **一处真实缺口是被 E2E 抓出来的**：首页本身迁完后英文页仍出现中文——来源是 `OnboardingBar` 组件（独立组件、不在页面里）。
  把断言从"主标题/最近项目/空态"扩到"新手引导条"后才暴露；组件迁完断言转绿。
- 两处数据数组的迁移手法：`tools` 与 `banners` 从常量改 `computed`（常量在 setup 期固化，切语言不更新）；
  但 `banners.length` 在 **script** 里要写 `banners.value.length`（模板里自动解包，script 里不会）——这是本轮唯一一次类型报错。

**验证**：`i18n-check.cjs` 全绿（668 key / 17 页 + 4 组件 key 齐全）；`e2e-i18n-pages.cjs` **36/36**；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v4.1 · 多语言第 10–11 批：剧本工厂 + 邀请与兑换 · 2026-10-28）

**#16 多语言 94% → 95%**；全站 **97.4%** / 首发 **97.6%**。

| 页面 | namespace | 迁移内容 |
|---|---|---|
| [novel/index.vue](app/apps/web/pages/novel/index.vue) | `novel`（48 key） | 列表标题/副标题、三个 tab、`STATUS_LABEL`/`SOURCE_LABEL` 常量改函数、空态、卡片（集数/归档时间）、新建弹窗（模式切换、剧本名、画面比例、上传、正文/灵感两种占位与提示、提交按钮）、8 条 toast |
| [invite.vue](app/apps/web/pages/invite.vue) | `invite`（60 key） | 邀请码卡片、补填邀请码、每日奖励、分销概览、兑换码两段式（查询/兑换/面额/剩余次数/有效期）、5 种不可兑换原因、17 条 toast |

- 已迁移页面 **14 → 16 / 64**，语言包 **488 → 596 key**。
- 两处"常量→函数"的改法值得记住：`STATUS_LABEL`、`SOURCE_LABEL`、`redeemReasonLabel` 若保留常量/`switch` 返回硬编码中文，
  **语言切换后不会更新**（常量在 setup 期算一次）。统一改成 `t()` 调用，代价是多一次函数调用，收益是切语言立即生效。
- 一处类型坑：`t("invite.resultSuccess", { credits, balance: redeemResult.balance_after })` ——
  `balance_after` 是 `number | undefined`，vue-i18n 的插值参数不允许 undefined，已改为 `?? 0`（真实成功路径必有值，兜底只为类型）。

**验证**：`i18n-check.cjs` 全绿（5 语言 key 一致 596 / 无空值 / 无中文残留 / 占位符一致 / 16 个页面 key 齐全）；
`e2e-i18n-pages.cjs` 扩到 **30/30**（新增剧本工厂中英对照 + 新建弹窗英文、邀请页中英对照）；
`verify-round.ps1` 全绿（12/12；1,142 用例）。

## 变更登记（v4.0 · CLI `task download` 补测试 + 资产库 i18n · 2026-10-27）

**#9 CLI/MCP 90% → 92%、#16 多语言 93% → 94%**；全站 **97.4%** / 首发 **97.6%**。

### 1. `task download`：实现早就有，测试一直没有

进度文档里写着"`task download` 不落盘"——**这是过期描述**。读代码后发现 `outputs/<task_id>-<n>.<ext>`
的落盘逻辑早就写了，但没有任何测试，所以谁也不敢说它是对的（"没测过"在台账里和"没做"同罪）。
本轮补 `apps/cli/test/task-download.spec.ts` **6 例**，钉住四件事：

| 断言 | 为什么必须测 |
|---|---|
| 文件真的写在 `outputs/`，内容 = 下载到的字节 | 只看"命令退出 0"无法区分"写了文件"和"什么都没做" |
| 扩展名优先取服务端 `filename`，其次 `uri`，兜底 `bin` | 产物是 `.png/.mp4`，落成 `.bin` 用户打不开 |
| **签名 URL 不出现在 stdout/stderr**，但确实发生了下载 | `download-url` 是限时凭据（`error-codes.md:23` 同一条红线）；否定断言必须配"下载真的发生了"（`binaryCalls`） |
| 部分失败不阻断整包；全失败才 `not_found`；缺参 `usage(2)` | 对齐 `batchDownload` 的"部分成功"语义 |

顺带扩展 CLI 测试脚手架：`harness()` 现在支持注入 `fetchBinary` 并暴露 `binaryCalls`（此前只能注入 JSON transport）。

### 2. 资产库页面 i18n（第 9 批）

- 新增 `assets` namespace（28 key × 5 语言），迁移 [assets.vue](app/apps/web/pages/assets.vue)：
  三视图 tab、回收站/资产库标题、上传/新建目录按钮、筛选提示、空态、删除确认、五条错误文案。
- `TABS` 从 `as const` 常量改为 `computed`——**否则语言切换后 tab 文案不变**（常量在 setup 期只算一次）。
- `e2e-i18n-pages.cjs` 扩到 **20/20**：新增资产库中英对照 + **三视图 tab 可切换**（computed 改动最容易回归的点）。
- 已迁移页面 **14 / 64**，语言包 **488 key**；`i18n-check.cjs` 仍全绿。

### 3. 验证

`pwsh _acceptance/verify-round.ps1` → **结论：全绿**（12/12；API 810 + CLI **89** + adapters 164 + worker 33 + db 26 + shared 14 + storage 6 = **1,142 用例**）。

## 变更登记（v3.9 · 多语言第 8 批页面迁移（影视版/集市/积分） · 2026-10-27）

**#16 多语言 92% → 93%**；全站 **97.3%** / 首发 **97.6%**。

| 项 | 内容 |
|---|---|
| 新增 namespace | `film`（30 key）、`market`（26 key）、`credits`（18 key + 嵌套 `kinds.*` 9 个），各 5 语言（zh-CN / en / ja / pt-BR / es） |
| 迁移页面 | [film/index.vue](app/apps/web/pages/film/index.vue)（影视版列表 + 新建弹窗）、[novel-market/index.vue](app/apps/web/pages/novel-market/index.vue)（集市筛选/卡片/分页）、[credits.vue](app/apps/web/pages/credits.vue)（余额概览 + 流水表 + 类型标签） |
| 已迁移页面 | **13 / 64**（此前 10 页），语言包 key **460** |
| 静态校验 | `node _acceptance/i18n-check.cjs` → 5 语言 key 一致、无空值、无中文残留（ja 用简体专用字表）、占位符一致、页面 key 齐全 ✅ |
| 浏览器验收 | `node _acceptance/e2e-i18n-pages.cjs` → **15/15**（影视版/集市/积分 × 中英对照：无 key 残留、英文无中文残留、控制台清洁） |

**迁移中修掉/规避的两个真实坑**：

1. `novel-market/index.vue` 原本用 `v-for="t in config.tags"` 循环标签——与 `const { t } = useI18n()` **同名冲突**。
   不改名的话模板里的 `t` 会指到标签对象，`{{ t.name }}` 直接渲染 `undefined`。已改名为 `tag`，并在 E2E 里加了
   "标签按钮仍可渲染（数量/文案来自库）"这条回归断言（避免以后有人再撞）。
2. `credits.vue` 的流水类型是 `KIND_META` 常量表里的中文——直接照搬会绕过 i18n。
   已改为 `credits.kinds.*` 查表，并把后端历史值 `purchase` 映射到 `recharge` 的文案
   （否则 `t("credits.kinds.purchase")` 会渲染出 key 本身）。

**顺带修掉一处测试数据污染**：`e2e-i18n-pages.cjs` 一开始用 `悬疑-${Date.now()}` 这种每次不同的标签名，
每跑一次就往 `market_tags` 多插两行（真实集市页面会多出脏标签）。已改为固定名 `E2E-悬疑`/`E2E-都市` +
结束时删除，并清掉了历史累积行。

## 变更登记（v3.8 · 平台运营创作者审核队列 + SSR 500 修复 · 2026-10-27）

**#10 活动/创作者 99% → 100%**；全站 **97.2%** / 首发 **97.6%**。

1. **平台运营审核队列**：创作者作品此前**只有空间管理员能审**（`POST /crc/assets/audit`），平台运营域看不到队列、
   无法处置 —— "内容安全"最该有人管的环节反而没人管。本轮补齐：
   - 迁移 0034：`creator_assets.reviewed_by_admin`（→ `admin_users`）+ `reviewed_by_kind`（1 空间管理员 / 2 平台运营），
     与既有的 `reviewed_by`（→ `users`）**分域留痕**，两条审核路径各自可追溯；
   - `GET /ops/admin/creator-audits`（状态过滤 + 标题搜索 + FIFO 排序）与
     `POST /ops/admin/creator-audits/:id/review`（通过写 `published_at`、驳回写理由、已通过可下架）；
     状态机与创作者域一致，**不接受跳步**（待审直接下架 / 已通过再通过都 400101）；
   - 运营后台新增第八个页签「创作者审核」，含搜索框与三动作按钮。
2. **E2E 抓出一个 SSR 500**：`plugins/i18n.ts` 把 `useRequestHeaders()` 放在 `computed` 体内懒取，
   head 在请求上下文销毁后才求值 → `[nuxt] instance unavailable`，`/admin/login` 直接 **500**。
   已改为在插件 setup（请求上下文内）立即捕获 headers。这类"只在 SSR 首屏才炸"的 bug，单元测试与 API 测试都发现不了。
3. **验证**：`test/admin-creator-audits.spec.ts` 6 例（队列过滤 / 通过留痕与 published_at / 驳回理由 /
   跳步拒绝 / 用户 token 越权 403 / 清理前置）；`_acceptance/e2e-admin-creator-audit.cjs` **6/6**（真实浏览器）。
   全仓门禁 12/12 全绿（1,136 用例）。

## 变更登记（v3.7 · 权限拦截扩到 6 码 + 验证码接入登录入口 · 2026-10-27）

**#7 团队 99% → 100%、#25 内容安全 85% → 92%**；全站 **97.1%** / 首发 **97.6%**。

1. **权限入口拦截 3 → 6 个码**：新增 `member.remove`（移除成员）、`member.edit`（改成员角色/资料）、
   `member.points`（分配/批量分配积分）。`GET /cam/permissions` 的 `enforced_count` 同步为 6，
   前端角色矩阵自动对 6 个码显示"生效中"。spec 从"正好 3 个"改为逐码断言，并新增
   "缺码 → 三个端点各自 403101（msg 带缺失码）+ owner(master) 短路可分配"。
2. **验证码接入业务入口（开关式）**：`/auth/sms-code` 与 `/auth/login` 现在支持 `captcha_ticket`/`captcha_answer`；
   `CAPTCHA_ENFORCE=1` 时强制校验（缺失 400101 `captcha_required`；答错 400101 `wrong_answer` 且票据作废；
   答对放行），默认 0 = 关闭以保零回归。`CaptchaService` 从 @Global 的 ModerationModule 导出。
   新增 `test/auth-captcha-gate.spec.ts` 5 例覆盖两态与四条拒绝/放行路径。
3. **为什么默认关而不是默认开**：本地只有算术题模式（无第三方 Key），强制校验会把"机器人防护"变成
   "用户多答一道题"，且现有 13 套 e2e 与真机验收全走无码路径；开关让"能力就绪"与"运营决定"分离。

## 变更登记（v3.6 · 三套浏览器 E2E 收尾（广告剧/转绘/模板 UI） · 2026-10-27）

**#13 广告剧 90% → 97%、#14 视频转绘 90% → 97%**；全站 **97.0%** / 首发 **97.4%**。

| 脚本 | 结果 | 覆盖 |
|---|---|---|
| `_acceptance/e2e-ad-drama.cjs` | **12/12** | 登录 → 创建页上传商品图 → 建项目 → 五段进度 → 卖点 5 条 → brief 3 条 → 选定 → 剧本 478 字 → 编辑保存后刷新仍在 → 分镜 3 行 → 资产 6 张 → 控制台清洁 |
| `_acceptance/e2e-video-redraw.cjs` | **11/11** | 创建页 → 四段进度 → 批量切 3 集 → 切集 → 切镜 14 行 → 产出 14 资产 → **绑定 14/14 镜** → 控制台清洁 |
| `_acceptance/e2e-subject-template.cjs` | **8/8** | 主体库模板下拉 4 条（服务端目录）→ 未选禁用 → 选中可用 → 应用成功且提示"风格前缀已追加、原描述不变" → 控制台清洁 |

**E2E 抓出并修掉的 3 个页面真 bug**（端点/spec 全绿但用户点了不对）：
1. 广告剧上传传 `name` 而契约要 `filename` → 400 后预览永不出现；
2. 转绘"绑定"用分镜上空的 `asset_ids` → `bound=0`（"绑定成功"但一个没绑），改用 `resources/generate` 响应的 storyboard↔asset 配对，重跑得 **14/14**；
3. 模板应用区误置于 `<p>` 内导致 `vue/no-parsing-error`，已移到 `<p>` 外。

**环境修正**：web 的 `/v1` 代理目标由 **build 时** `NUXT_API_PROXY` 烘焙，此前构建未带该变量 → `.output` 指向 :3000，页面能开但数据请求全 404（此前的"页面 200"是弱证据）。已按正确变量重建并验证 `:3003/v1/healthz` 透传。

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

