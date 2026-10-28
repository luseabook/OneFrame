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

