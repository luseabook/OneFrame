# 一帧 OneFrame · 「期望最终产品形态」差距报告

> 2026-10-25 22:55 · 工作区 `E:\wanxing` · 被评估版本 `git HEAD = 8e25f53`（2026-10-25 22:21:22）+ 1 个未提交修改（`app/apps/web/components/Director3D.vue`，+261/−10）
> 方法：三条基线交叉 + 独立证伪。**目标基线**只写"要求是什么"，**实现基线**只写"代码里有什么"，**运行验证**负责推翻自评。
> 证据文件：`_acceptance/_gap/target-spec.md`（401 行）· `_acceptance/_gap/impl-state.md`（466 行）· `_acceptance/_gap/runtime-verification.md`（595 行）

---

## 0. 一句话结论

**代码侧已经"像一个产品"了（20 个页面 / 112 个端点 / 29 张表 / 参照产品 P1–P9 全部有对应实现），但它现在既不能真实收钱跑业务（8 条 P0 外部资质全未到位、无任何真实供应商 Key），也没有通过完整门禁（裸跑 `pnpm -w test` 确定性红、README 的"25/25"是 7 小时前的过期快照）。**

真正的差距分三类，必须先分开看，否则会得出相反结论：

| 差距类型 | 性质 | 能不能靠写代码解决 |
|---|---|---|
| **A. 证据链与门禁** | 自评不可复现，交付基线失真 | 能，且是**最省成本的下一步** |
| **B. 真实化与合规** | mock → real、备案、商户号 | 一半靠代码（真实链路坑已修到 P10），一半靠行政/外部 |
| **C. 形态覆盖** | 参照产品的完整形态 ≫ 我方本期承诺范围 | 靠产品决策 + 排期，不是"缺陷" |

---

## 1. 现状速览（可核对的数字）

| 维度 | 实测值 | 证据 |
|---|---|---|
| web 页面路由 | **20 条**，全部整页实现，无占位页；`.vue` 共 16,488 行 | `impl-state.md §2` |
| API 端点 | **112 个**（17 个 `@Controller`） | `impl-state.md §3` |
| 数据库 | **29 张表 / 13 个 migration**（0000–0012），`pgTable` 与 `CREATE TABLE` 一一对应 | `impl-state.md §4` |
| 队列 | 声明 6 个，**仅 3 个有生产者**（gen.submit / export.zip / timeline.export） | `impl-state.md §5` |
| 适配器 | 5 个（Mock + DeepSeek + Ark 视频 + Ark 图像 + 通用 HTTP） | `impl-state.md §6` |
| 测试文件 | 45 个（api 25 / worker 7 / adapters 7 / storage 3 / shared 2 / db 1 / **web 0**） | `impl-state.md §8.1` |
| 参照短剧工作流复刻 | P1→P10 十期全部落地（工作台/资产/提取/生图/时间线/四模式/校验页/合成导出/3D/出站签名） | `docs/03-frontend/reference-reelflow-spec.md §8–§19` |
| 对外可见的"完成"证据 | `_acceptance/b-type-acceptance-run.log` **25/25**（**2026-10-25 15:09**） | 该日志 `:50` |

**关键时间差**：HEAD 提交时间 22:21，验收日志 15:09 —— 中间隔着 **P1–P10 共 10 个提交（18:14 → 22:21）**。也就是说，README 里那句"当前 25/25 项通过"（`README.md:61`）**不是对当前代码的陈述**。

---

## 2. "期望的最终产品形态"到底是什么：三层定义

这是回答本题的前提。项目里"最终形态"有三个互不相同的答案，混在一起谈就会各说各话。

### 第 1 层｜竞品形态（ReelMate，全量参照物）

`rea-reelmate/REELMATE-逆向分析报告.md:27-54` 记录的参照站信息架构：

```
首页（短剧工作流 / 无限画布 / 工具矩阵）· 剧本创作 · 创作 Agent（SSE 流式）
· 全部项目 · 工具箱（AI视频/AI图片/AI音频 三类，20+ 单点工具）· 团队（资产库/团队管理/积分分配）
· 影视版（内测申请，任务表格+审核流）· MCP & CLI（对外协议）· 活动/兑换码/邀请奖励/创作者中心
· 剧本广场/小说市场 · 广告短剧 · 视频转绘 · 视频拉片/翻译/音色修改
```
—— 去 i18n 前缀后 **928 条路由**（`REELMATE-逆向分析报告.md:42`）。

### 第 2 层｜我方本期承诺形态（PRD v1.0 + v1.1 + v1.5 + v2.0）

- **v1.0 MVP（= F1–F10）**：A 型纯 SaaS 自助，`docs/01-product/PRD.md:32-206`。旗舰是 **F2 剧本流水线七环节**（建项→大纲→角色定妆定稿→集剧本→分镜→批量投递→导出），另有工具箱 2 入口、任务、资产库、积分、内容安全、管理后台、作品库、新手引导。
- **v1.1**：成片自动合成（拼接+BGM+字幕）、可灵/Vidu 适配器、TTS 配音、BYOK、模板 v0（`PRD.md:221`、`wbs.md:112`）。
- **v1.5**：无限画布（**启动门槛**：画布使用率 >30% 的种子群验证，`wbs.md:116`）。
- **v2.0**：团队空间、剪辑器、模板市场、开放 API（`PRD.md:223`）。
- **明确的 Non-goals**（`PRD.md:208-214`）：无限画布本期不做、任务删除/regenerate、成员协作评论、Excel 批量回填、手动剪辑、团队/多空间、TTS/音乐工具、微信登录、多语言、兑换码裂变、创作者分成、开放 API、移动端、Alpha 期支付。

### 第 3 层｜上线合规形态（LAUNCH gate）

`docs/06-security-compliance/launch-checklist.md:18`：**P0 = 缺一项即不得对外开放注册/生成/支付**。这一层不是"功能"，但是"最终产品"能否对外的前置条件。

> ⚠️ 本项目"复刻"的目标**不等于**第 1 层全量。`reference-alignment-spec.md:913,929` 明确写了 §9.6 的 11 个无截图路由"**不做臆造**，必须重新抓图"；`PRD.md:208-214` 也把参照站的大部分能力列为 Non-goals。所以下文的差距要按"对哪一层"来读。

---

## 3. 差距矩阵

### G0｜证据链断裂与门禁（最高优先级：它决定其他结论是否可信）

| # | 差距 | 证据 | 影响 |
|---|---|---|---|
| G0-1 | **裸跑 `pnpm -w test` 确定性红**：4/4 次失败。多个 api spec 未自带 `DATABASE_URL`/`REDIS_URL`，回落到库默认 **5432/6379**，而项目跑在 **55432/6380**（`app/apps/api/src/config/env.ts:24` 默认 `redis://localhost:6379`） | `runtime-verification.md §3.2`；Lead 独立复现：`pnpm exec vitest run test/admin.spec.ts` → `connect ECONNREFUSED ::1:6379`，EXIT=1 | CI 能过是因为 CI 用默认端口；**开发机上标准命令不可复现**，任何"测试全绿"的说法都站不住 |
| G0-2 | **注入 env 后仍是抖动绿**：8 次观测中 3 次红，均为 `project-assets.spec.ts` 同 2 例；同一单文件命令 6 次中 1 次失败 | `runtime-verification.md §3.2` 表 E/F/G/H/I | 门禁不是"绿"，是"条件性且不稳定" |
| G0-3 | **README「25/25」已过期**：日志 15:09 早于 HEAD 22:21，中间 10 个提交；测试数 api 167→**234**、worker 15→**31**、shared 13→14 | `runtime-verification.md §3.3-3.4` | 对外交付基线失真 |
| G0-4 | **提交自述被推翻**：`32aa80a` 与 `docs/05-ops/deployment.md §7.6` 称"单文件 13/13、串行后稳定"，在**已串行**的现树上单跑复现 `2 failed \| 11 passed (13)` | `runtime-verification.md §3.5` | 关并行没消除根因（共享 dev DB 污染） |
| G0-5 | **web 侧零静态门禁**：`apps/web/package.json` 无 `lint`、无 `typecheck`，`test` 是 `echo ... && exit 0`；16,488 行 `.vue` 不进门禁 | `impl-state.md §1,§8.2`；`impl-state.md §9 行 8` | 前端回归只能靠人肉截图 |
| G0-6 | **探针证据未留档**：`_acceptance/probe-3d-pixels.cjs` 的输出全仓无任何持久化文件；「成片真实」的样例 `_acceptance/timeline-export-sample.mp4` 经像素级分析是 **lavfi 纯色色板 `0x14161d`**（平坦区 YAVG 实测 35.0 vs 理论 35.07），零运动、无场景切换 | `runtime-verification.md §4b,§5b` | 该样例**不能**作为"成片内容真实"的证据，它证明的是 mock 回退路径 |
| G0-7 | **工作区有未提交改动**（`Director3D.vue` +261/−10） | `git status`；`runtime-verification.md §7.2` | 3D 结论对工作区成立，对任何已提交版本不必然成立 |

> **有真实成立的**：`pnpm -w lint` 6/6 绿、`pnpm -w typecheck` 10/10 绿、`compliance-check.cjs` 独立复跑 **66 PASS / 0 FAIL**、生产守卫 4 组探针全部符合预期（含正反例）——这些是可靠的地基。

### G1｜上线硬门槛（外部依赖，8 条 P0 全未到位）

`launch-checklist.md:34-53`，P0 项 = **EXT-01** 公司主体、**EXT-02** 域名实名、**EXT-03** ICP 备案、**EXT-05** 公安备案、**EXT-06** 生成式 AI 备案、**EXT-07** 深度合成算法备案、**EXT-08** 供应商模型备案、**EXT-15** 协议律师审阅 —— 状态**全部 ⏳**。

- ICP 备案号仍是**占位串**，被判 **P0 阻断**（`launch-checklist.md:182` GAP-05）。
- 最上游是 **D0 未决**：项目名称/域名、主体公司、团队编制三条 checkbox 全未勾（`docs/README.md:97-101`），而 `wbs.md:17` 明确"**D0 未决前 0.5 任务不可开工**"。
- 收费前阻塞（P1）：EXT-04 EDI、EXT-09 DPA、EXT-10/11 微信/支付宝凭据、EXT-12 短信签名、EXT-13 词库≥5000（现状**仅内置 8 词**，`launch-checklist.md:179` GAP-02）、EXT-14 发票、EXT-16 类目、EXT-19 未成年人退款通道。
- 代码侧仍需人工抽验 6 项 CODE-H1~H6（真实成片水印抽验、归档 ≥6 个月、真实渠道 1 分钱全链路、对账 SOP 24h 等，`launch-checklist.md:149-154`）。

### G2｜真实化：mock → real 的剩余坑

| # | 差距 | 证据 | 影响 |
|---|---|---|---|
| G2-1 | **无任何真实供应商 Key**，全程 mock；真实模式另有 `STORAGE_S3_*` 公网桶前置（守卫只能静态拦 loopback，私网需运维保证） | `reference-reelflow-spec.md §19.6:671-673`；`runtime-verification.md §6c` | 出片内容真实性**从未被端到端证明** |
| G2-2 | **LLM 真实模式静默降级**：`LLM_MODE=real` 但缺 `DEEPSEEK_API_KEY` 时回落确定性 mock 文案且不报错；api 生产守卫（`env.ts:227-255`）不检查该组合，与 worker"缺 Key 硬失败"策略不一致 | `app/apps/api/src/modules/script/llm.service.ts:68-75,78`（Lead 已复核） | **生产静默出假内容**的口子，性质等同 worker 明令禁止的"假生成" |
| G2-3 | **3 个队列是死声明**：`gen.poll` / `result.transfer` / `notify` 无生产者，worker 落 no-op；轮询实为 job 内 `for(;;) sleep` | `app/apps/worker/src/main.ts:229-230`（Lead 已复核）、`executor.ts:290-317` | 长任务占满并发槽（默认 5）、`attempts:1` 重启即丢轮询进度 |
| G2-4 | **支付通道未配置**：`live=False`、`wechat.configured=false`，回调默认 401 拒绝（这是正确行为），但真实收款链路未验证 | `_acceptance/b-type-acceptance-run.log:39`；`launch-checklist.md:56` | Beta 商业化未启动 |
| G2-5 | **生产部署摩擦**：`docker-compose.prod.yml:119` 默认 `ADAPTER_MODE=mock`，而 worker 守卫拒绝 mock → 不显式设该变量 worker 起不来；且 docker 路径本次**完全未验证**（本机无 docker CLI） | `impl-state.md §9 行 7`；`runtime-verification.md §1.2` | 部署可重复性未经证实 |
| G2-6 | ffmpeg/ffprobe 为宿主依赖，缺失时 AI 标识降级为仅隐式 | `impl-state.md §9 行 5`；`app/apps/worker/src/label.ts:27` | 合规标识可能静默缺失 |

### G3｜v1.0 承诺内未落地或打折

| # | 差距 | 目标出处 | 现状证据 |
|---|---|---|---|
| G3-1 | **SSE 任务推送完全不存在**（WBS P2.4 要求"双通道可切换"） | `wbs.md:59` | 全仓 `event-stream`/`EventSource` **0 命中**；进度全靠 `setInterval`（`impl-state.md §7`） |
| G3-2 | **埋点体系完全不存在**：metrics.md §3 登记约 28 个事件、§5 要求批量上报端点 | `metrics.md:31-54,64`；`wbs.md:60` | `analytics`/`sentry`/`埋点` **0 命中**；无 events 表；管理后台漏斗改从 `task_events`/`credit_flows` 聚合（`admin.service.ts:73`）→ **北极星 WCE、激活率、漏斗各环节流失率目前无数据源** |
| G3-3 | **k6 压测未做**（WBS P2.6：轮询风暴/批量投递尖峰/worker 恢复） | `wbs.md:61` | 无任何 k6/压测脚本；「轮询 P95<200ms」「api P95≤500ms」均未测（`deployment.md:269` D7） |
| G3-4 | **图生视频首帧非 OSS 直传、无进度条** | `PRD.md:80` | `mvp-acceptance-audit-2026-10-24.md:36`（base64 资产库上传可用） |
| G3-5 | **Prompt 工程专项未冻结**（10 部样例小说回归集、输出 Schema 零解析失败） | `wbs.md:57` | 无回归集产物；LLM 质量被列为"v1.1 最大产品风险"（`wbs.md:124`） |
| G3-6 | **文档目标值内部冲突未收敛**：示例作品规模 PRD 写"2 集+2 角色、无分镜"，SUPP 写"3 集大纲+3 角色+10 分镜" | `PRD.md:197` vs `PRD-supplement-works-and-onboarding.md:89` | 代码按 PRD 实现（`auth.service.ts:45-65`，Lead 已复核）→ **代码对、文档需改** |
| G3-7 | 上线前 72h 演练 D1–D9 未执行（备份恢复/回滚/回调失败/对账补账/优雅停机/告警/容量/值班/未成年人退款） | `deployment.md:256-271` | 仅 D5 优雅停机有脚本与单测证据 |
| G3-8 | 无 APM/告警通道；镜像偏大（api 849MB / worker 1.67GB / web 330MB） | `FINAL-DELIVERY-2026-10-25.md:103-113` | 后置项，但 Beta 前需处理 |

### G4｜路线图承诺（v1.1 / v1.5 / v2.0）

| 版本 | 承诺 | 现状 | 证据 |
|---|---|---|---|
| v1.1 | 成片自动合成（拼接 **+BGM+字幕烧制**） | 拼接+统一分辨率帧率+水印**已做**（P7）；**BGM/字幕/转场/音轨/多轨/拖动排序全未做** | `reference-reelflow-spec.md §16.7:537-539,§13.4:410-415` |
| v1.1 | 可灵 / Vidu 适配器 | 有 Ark 视频 + 通用 HTTP 两个 real 适配器；可灵/Vidu 未接 | `impl-state.md §6` |
| v1.1 | TTS 配音进流水线 | 无 | — |
| v1.1 | BYOK 模式 | 无 | — |
| v1.1 | 模板 v0（官方 5 个） | 无（只有 1 个内置示例作品） | `auth.service.ts:48` |
| v1.5 | 无限画布 X6（script/asset/storyboard 节点、Agent 铺画布、协作锁） | **完成度 0**：设计文档 §7 的 4 张 `canvas*` 占位表在 29 表中**完全不存在** | `docs/02-architecture/database.md:478-501`；`impl-state.md §4` |
| v2.0 | 团队空间 / 剪辑器 / 模板市场 / 开放 API | 无（侧栏"团队管理""影视版"为置灰 span） | `reference-alignment-spec.md:897,919` |

### G5｜参照产品有、我方列为 Non-goal（需产品决策，不是缺陷）

`REELMATE-逆向分析报告.md:27-54` 的 20+ 单点工具、剧本广场/小说市场、影视版协作、MCP & CLI、创作者中心/兑换码/邀请奖励、广告剧、视频转绘、对话式创作 Agent（SSE）—— 在 `PRD.md:208-214` 里明确"首发不做"。

**这里需要你决策的是**：`reference-alignment-spec.md §13:1038-1039` 建议把 404/画布空态/影视版弹窗/CLI 页列为 P3、其余 12+ 无证据页面"必须先补抓图"。若目标是"看起来就是同一个产品"，这部分是最大的可见差距；若目标是"自己的 A 型 SaaS"，它是差异化空间。

### G6｜逐页复刻的剩余细节（P1–P10 的已知"未做"）

| 期 | 剩余 |
|---|---|
| P1 工作台 | 空白分镜端点、其余 4 种生成模式参数区、图像生成 tab 需模型进 registry、3D 导演台、分镜多版本/镜头评论/标签分组 |
| P2/P3 资产 | 资产提示词审核页、"仅展示主体"开关、独立资产清单校验路由、"按出现集数筛选"缺聚合数据 |
| P4/P7 时间线 | trim 微调/转场/音轨/字幕轨、多轨、拖拽排序、mock 下 `<video>` 不能真播 |
| P8 3D 导演台 | 视口内拖拽角色（raycast）、姿势预设、角色定妆图贴图、多机位 |
| 全局 | **11 个无证据页面必须重新抓图**才能做结构级复刻（`reference-alignment-spec.md:913,929`）；7 项逐页取证缺口（`reference-reelflow-spec.md §7:188-196`） |

---

## 4. 建议的收口顺序

### 48 小时内（成本最低、收益最大：把"可信基线"找回来）

1. **补 spec 的 env 默认值**：让 `app/apps/api/src/config/env.ts:24` 一类的默认端口与项目一致（或让全部 spec 自带 `?? 55432/6380`）→ 裸跑 `pnpm -w test` 转绿。
2. **定位 `project-assets.spec.ts` 那 2 例的共享 dev DB 污染根因**（每例独立 schema/事务隔离或随机化数据），把"抖动绿"变成"稳定绿"。
3. **重跑 `_acceptance/b-type-acceptance.ps1` 并落新日志**，README 的"25/25"改成带日期的版本引用。
4. **修 `llm.service.ts:68-75` 的静默降级**（`LLM_MODE=real` 且无 Key 必须启动即失败，与 worker 守卫对齐）。
5. **把 `compliance-check.cjs` 之后的探针输出落盘**（PIXELS 结果、导出成片指标），让"已完成"有可核对的存档。
6. 提交或回退 `Director3D.vue` 的 261 行未提交改动。

### 2 周内（产品可信度）

7. 补 web 的 `lint`/`typecheck`（16,488 行 `.vue` 目前零检查）。
8. 用真实 Key（哪怕只配 Ark 一种）跑一次端到端真实出片 + 1 分钱真实支付，产出"真实链路"证据。
9. **埋点最小闭环**：先实现 metrics.md §3 里漏斗 9 环 + 北极星 `episode_completed` 的事件落库与批量上报端点——否则 Alpha 无从观测。
10. 处理 3 个死队列（删声明或补生产者），并把轮询改成 delayed job 以释放并发槽。

### 30 天内（Beta 前置）

11. 按 EXT-01→02→03→05 最短备案链推进，并行 EXT-15/06/07（周期最长）；商户号 W8 申请留 2 周缓冲。
12. 执行 72h 演练 D1–D9（`deployment.md:256-271`），至少覆盖备份恢复、回滚、回调失败、对账补账。
13. SSE 推送（P2.4）+ k6 压测（P2.6）。
14. 词库采购到 ≥5000 词（EXT-13）与 6 个月归档（CODE-H3）。

### Beta 后（形态扩张）

15. v1.1：BGM/字幕/转场 → 可灵/Vidu 适配器 → TTS → BYOK → 模板 v0。
16. 若走"1:1 复刻"路线：先**补抓图**（11 个无证据页 + 7 项取证缺口），再做结构级复刻；否则按 `PRD.md:208-214` 的 Non-goals 维持差异化。
17. v1.5 画布：先把 4 张 `canvas*` 表落库，并等"画布使用率 >30%"的启动门槛数据。

---

## 5. 诚实边界（本次**无法**验证的）

| 项 | 原因 |
|---|---|
| docker/compose 容器化部署路径 | 本机未安装 docker CLI |
| 真实供应商端到端出片 | 无任何外部 Key，且不得发起外部付费调用；仅验证到守卫层 |
| 真实支付回调 | 无商户号/密钥，`PAYMENT_LIVE=false` |
| 3D 画面的"视觉正确性" | 本会话模型不支持图像输入，只能给像素统计（非背景 71.2%、色阶 103） |
| `b-type-acceptance.ps1` 端到端重跑 | 为控时只复核其组成步骤与 env 依赖点（已确认绿/红的条件） |
| `real + 无 Key` 的运行期失败形态 | 未启动长跑 worker，仅静态推断（adapter 未注册） |

> 本文对"目标要求"的引用均来自仓库内文档（`文件:行`）；对"现状"的引用来自代码读取与两次独立实测（本报告作者 + `runtime-verification.md`）。凡引用上游文档原文之处，不代表已独立核实其业务主张。

---

## 附：配套证据文件

| 文件 | 内容 |
|---|---|
| `_acceptance/_gap/target-spec.md` | 「要求是什么」——页面清单（ALIGN 12 项 / FLOW P1–P9 / 无证据 11 项）、F1–F10 与版本承诺、EXT-01~20、文档自认的未取证项 |
| `_acceptance/_gap/impl-state.md` | 「代码里有什么」——20 路由 / 112 端点 / 29 表 / 6 队列 / 5 适配器 / 45 测试文件，逐行带 `文件:行` |
| `_acceptance/_gap/runtime-verification.md` | 「自评是否成立」——16 条声明逐条 证实/推翻/无法验证，含 8 次门禁观测与像素级成片分析 |
