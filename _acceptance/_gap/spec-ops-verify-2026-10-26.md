# 目标层 / 合规层 / 运维前置 现状核查（spec-ops-verify）

- 核查对象：`E:\wanxing`（文档 `docs/`、竞品证据 `rea-reelmate/`、代码 `app/`、验收 `_acceptance/`）
- 核查方式：**只读**。未修改任何文件；未运行安装/构建/测试。唯一写入物 = 本文件
- 所有路径相对工作区根 `E:\wanxing`；格式 `文件:行`
- 代码事实以 grep/read 实际读到的行号为准（不是文档里写的行号）；发现文档行号漂移处已单列

---

## 1. 三层目标基线（竞品层 / 承诺层 / 合规层）

### 1.1 竞品层：ReelMate 逆向基线

| 项 | 要求出处 文件:行 | 现状 | 结论 |
|---|---|---|---|
| 应用信息架构（登录前 9 大板块） | `rea-reelmate/REELMATE-逆向分析报告.md:25-40` | 已给出：首页工作台/剧本创作/创作 Agent/全部项目/工具箱/团队/影视版/MCP&CLI/活动兑换邀请 | 成立 |
| 路由表总量 | `rea-reelmate/REELMATE-逆向分析报告.md:42`（「去 i18n 前缀后 928 条，含 API 路径常量」） | 928 条；附件 `routes.txt` | 成立 |
| `/web/v1` 端点总数 | `rea-reelmate/REELMATE-逆向分析报告.md:126`（「去重后 ~700 个」） | ~700 个 | 成立 |
| AI 网关收敛后的生成端点数 | `rea-reelmate/REELMATE-逆向分析报告.md:334`（「仅 8 个生成端点」） | 8 个（模式靠参数表达） | 成立 |
| 模型目录规模 | `rea-reelmate/REELMATE-逆向分析报告.md:333`（46 个模型）、`:363`（`model-catalog-summary.json`） | 46 模型 × 模式 × 端点 × 参数枚举 | 成立 |
| 自身对照口径 | `docs/01-product/PRD.md:14`（「竞品 700+ 端点中 df/* 剧本工厂占半壁江山」） | 与报告 928 路由 / ~700 端点一致 | 成立（PRD 引用的是 ~700 端点口径） |
| 差异：本仓库 web 页面路由数 | 对照 `app/apps/web/pages/**`（20 个 `.vue` 页面） | 竞品 928 路由 vs 本仓库 20 页 | **量级差距已固化，属路线 A 主动收敛，非缺陷** |

### 1.2 承诺层：PRD F1–F10（`docs/01-product/PRD.md`）

出处均为「验收标准」段落所在行；「代码对应实现」为本次实际读到的端点/页面（端点前缀 `/v1`，见 `app/apps/api/src/modules/*/*.controller.ts`）。

| 项 | 要求出处 文件:行 | 代码里是否有可核查的对应实现 | 结论 |
|---|---|---|---|
| F1 账号与登录（P0） | `docs/01-product/PRD.md:34-48`（规格 34-42，验收 44-48） | 有：`POST /auth/sms-code`（`app/apps/api/src/modules/auth/auth.controller.ts:27`）、`POST /auth/login`（`:34`）、`POST /auth/refresh`（`:44`）、`POST /auth/logout`（`:53`）、`GET /me`（`:62`）、`POST /me/delete`（`:78`）、`POST /waitlist`（`:88`）、`app/apps/web/pages/login.vue` | **部分**：发码频控 1/60s、5/日、IP 20/h 已实现（`app/apps/api/src/modules/auth/sms.service.ts:15-22`，`app/apps/api/src/config/env.ts:5,49`）；验证码 6 位/5 分钟/错 5 次作废已实现（`sms.service.ts:7-8,24,33-36`）；邀请码 + 80 积分 + 年龄门禁 + 注销已实现。**缺口**：频控/风控返回的是 `RATE_LIMITED=429100`（`app/packages/shared/src/errors.ts:21`），**不是 PRD 要求的 429101 行为验证码挑战**；`CAPTCHA_REQUIRED=429101`（`errors.ts:22`）在全仓仅被错误码单测引用（`app/packages/shared/src/schemas.spec.ts:117`），**无任何调用点、无 CAPTCHA_PROVIDER 实现**（grep `CAPTCHA_REQUIRED\|CAPTCHA_PROVIDER\|captcha` 仅 2 处命中，均在 shared 包） |
| F2 剧本流水线（旗舰，P0） | `docs/01-product/PRD.md:50-72`（表格 54-62，验收 64-72） | 有：`POST /projects`（`script.controller.ts:43`）、`/projects/parse-script`（`:50`）、`/projects/:id/episodes/split`（`:113`）、`/outline/generate`（`:119`）、`PUT /outline`（`:124`）、`/characters/generate`（`:130`）、`/script-draft/generate`（`:136`）、`/storyboards/generate`（`:147`）、`/portrait`（`:210`）+`/finalize`（`:254`）、`/storyboards/generate-videos`（`:396`，含 745703 部分成功）、`/exports`（`:371`，含 400106）、`/matrix`（`:178`）；页面 `app/apps/web/pages/projects/[id].vue` | **有**（骨架完整）。注：PRD:57 的「LLM 输出 745802」已实现（`app/apps/api/src/modules/script/llm.service.ts:242-247`） |
| F3 工具箱（2 入口，P1） | `docs/01-product/PRD.md:74-91`（规格 76-84，验收 86-91） | 有：`app/apps/web/pages/create/text-to-video.vue`、`.../image-to-video.vue`、`.../tools.vue`；quote 走 `POST /credits/quote`（`credits.controller.ts:16`）；分享 `POST /tasks/:id/share`（`task-share.controller.ts:23`）、`DELETE /tasks/:id/share`（`:29`）、`GET /share/:token`（`:13`） | **有** |
| F4 任务与历史（P0） | `docs/01-product/PRD.md:93-107`（规格 95-100，验收 102-107） | 有：`GET /tasks`（`tasks.controller.ts:13`）、`POST /tasks/batch-download`（`:45`）、`/tasks/:id/cancel`（`:59`）、`/tasks/:id/retry`（`:64`）、`/tasks/:id/results/:n/download-url`（`:69`）；分镜矩阵 `GET /projects/:id/matrix`（`script.controller.ts:178`）；页面 `app/apps/web/pages/tasks.vue` | **有** |
| F5 资产库 + 角色资产（P1） | `docs/01-product/PRD.md:109-122`（规格 111-116，验收 118-122） | 有：`GET /assets`（`assets.controller.ts:12`）、`/assets/expiring-tasks`（`:31`）、`/asset-folders`（`:36`）、`POST /assets/from-task`（`:63`）、`/assets/:id/restore`（`:72`）、`DELETE /assets/:id`（`:83`）；页面 `app/apps/web/pages/assets.vue` | **有**：回收站软删 + 7 天可恢复（`app/apps/api/src/modules/assets/assets.service.ts:201-214`）、90 天到期 + 前 7 天提醒（`assets.service.ts:139,163-167`） |
| F6 积分（P0 只读 / Beta 支付） | `docs/01-product/PRD.md:124-136`（规格 126-130，验收 132-136） | 有：`GET /credits/flows`（`credits.controller.ts:22`）、`POST /credits/quote/batch`（`:32`）；`GET /me` 返回余额（`auth.controller.ts:62`）；页面 `app/apps/web/pages/credits.vue`、`pricing.vue`；支付端点 `billing.controller.ts:58-309` | **有**（Beta 真实渠道依赖 EXT-10/11/16） |
| F7 内容安全与合规展示（P0） | `docs/01-product/PRD.md:138-153`（规格 140-146，验收 148-153） | 有：输入审核 `app/apps/api/src/modules/moderation/moderation.service.ts:38-48`（745801）；LLM 输出审核 `llm.service.ts:242-247`（745802）；AI 双标识 `app/apps/worker/src/label.ts:58,97`；页脚举报 `app/apps/web/layouts/app.vue:171`、`layouts/default.vue:44`、`pages/index.vue:182`；分享页声明 `pages/share/[token].vue:77`；年龄门禁 `pages/login.vue` + `auth.service.ts:109-111` | **有**（但见 EXT-13：词库规模不足，`moderation.service.ts:7-16` 仅 8 词） |
| F8 管理后台（最小，P1） | `docs/01-product/PRD.md:155-167`（规格 157-161，验收 163-167） | 有：`app/apps/api/src/modules/admin/admin.controller.ts:40`（独立 admin 登录）、`:105,110`（模型上下架/热更）、`:115,124`（计价热更）、`:57,62,67,72`（看板/队列/失败率）、`:81`（漏斗）、`:72`（失败清单 CSV）；页面 `app/apps/web/pages/admin/login.vue`、`admin/index.vue`、`layouts/admin.vue:3`（用户端与管理端分离） | **有** |
| F9 作品库与二次创作（P0） | `docs/01-product/PRD.md:169-188`（规格 174-182，验收 184-188） | 有：`GET /works`（`script.controller.ts:62`）、`POST /projects/:id/archive`（`:77`）、`POST /projects/:id/episodes`（`:84`）、`POST /projects/:id/duplicate`（`:91`）；页面 `app/apps/web/pages/works.vue`；四态聚合 `app/apps/api/src/modules/script/script.service.ts:227-229,306`；软标记 `app/packages/db/src/schema.ts:374`（`archived_at`） | **有**（一处与增补文档冲突，见第 5 节） |
| F10 新手引导（P0） | `docs/01-product/PRD.md:190-206`（规格 194-200，验收 202-206） | 有：`GET /me` 返回 `onboarded`（`auth.service.ts:245`）、`POST /me/onboarded`（`auth.controller.ts:70-71`，幂等）：`auth.service.ts:250-255`；持久化字段 `app/packages/db/src/schema.ts:37`（`onboarded_at`）；示例项目 `auth.service.ts:48-90`（`isSample:1`）+ `schema.ts:376`；复制 `script.service.ts:366-379`；页面 `app/apps/web/pages/home.vue`、`works.vue` | **有**（示例作品规模与增补文档冲突，见第 5 节） |

**Non-goals 清单**：`docs/01-product/PRD.md:208-214`（5 条，含 210 无限画布 v1.0 不做 / 211 任务删除·regenerate·feedback·协作评论·Excel 回填 / 212 成片剪辑器 / 213 团队·多空间·TTS·微信登录·多语言·兑换码·分成·开放 API·移动端 / 214 支付 Alpha 不开）。

**版本承诺**：

| 版本 | 要求出处 文件:行 | 内容 | 结论 |
|---|---|---|---|
| v1.1 | `docs/01-product/PRD.md:221`；`docs/07-plan/wbs.md:110-112` | 成片自动合成(拼接+BGM+字幕)、可灵/Vidu 适配器、TTS 配音进流水线、BYOK；wbs 另加「模板 v0（官方 5 个）」 | 承诺一致 |
| v1.5 | `docs/01-product/PRD.md:222`；`docs/07-plan/wbs.md:114-116` | 无限画布(X6) 节点视图 + Agent 铺画布 + 协作锁；wbs 附启动门槛「画布视图使用率 >30%」 | 承诺一致 |
| v2.0 | `docs/01-product/PRD.md:223` | 团队空间、剪辑器、模板市场、开放 API（视 v1.5 数据） | **`docs/07-plan/wbs.md` 无 v2.0 章节**（全文件仅 v1.1/v1.5 两节，`:110,114`）→ v2.0 只有 PRD 单一出处，无计划分解 |
| 已提前落地的 v1.1 项 | `docs/01-product/PRD.md:221` vs 代码 | 成片自动合成（时间线 ffmpeg 合成 + AI 水印）已实现：`docs/05-ops/deployment.md:282-314`、`script.controller.ts:448,458` | 实际进度超前于 wbs 排期（排期未回填） |

### 1.3 合规层：`docs/06-security-compliance/launch-checklist.md` P0 外部项

| 项 | 要求出处 文件:行 | 现状 | 结论 |
|---|---|---|---|
| EXT-01 公司主体（营业执照） | `docs/06-security-compliance/launch-checklist.md:34` | 状态列 **⏳ P0** | **未到位** |
| EXT-02 域名注册与实名（www/app/api/static） | `launch-checklist.md:35` | 状态列 **⏳ P0** | **未到位** |
| EXT-03 ICP 备案 | `launch-checklist.md:36` | 状态列 **⏳ P0**；页脚仍为占位串 | **未到位** |
| EXT-05 公安联网备案 | `launch-checklist.md:38` | 状态列 **⏳ P0** | **未到位** |
| EXT-06 生成式人工智能服务备案 | `launch-checklist.md:39` | 状态列 **⏳ P0** | **未到位** |
| EXT-07 深度合成服务算法备案 | `launch-checklist.md:40` | 状态列 **⏳ P0** | **未到位** |
| EXT-08 供应商模型备案证明（火山方舟/百炼/可灵等） | `launch-checklist.md:41` | 状态列 **⏳ P0** | **未到位** |
| EXT-15 用户协议/隐私政策律师审阅 | `launch-checklist.md:48` | 状态列 **⏳ P0** | **未到位** |
| P0 外部项合计 | `launch-checklist.md:18`（「P0 缺一项即不得对外开放注册/生成/支付」）、`:234`（「EXT- P0 项全部清零，否则不得开放注册/生成/真实支付」） | 逐项 read 确认：**8/8 全部 ⏳，无一项 ✅** | **「P0 全未到位」属实** |
| 反纸面打勾规则 | `launch-checklist.md:21`、`:138`（DOC-04「外部项 ✅ 须附回执或归档位置」） | §1 表内 EXT-01~20 **全部 20 项均为 ⏳**（`:34-53`） | 自洽，无纸面打勾 |
| 代码侧对照 | `launch-checklist.md:71-72`（66 项：服务未起 65 PASS/0 FAIL/1 SKIP；API 在跑 66 PASS） | 仅代表**代码侧**可复跑，**不覆盖任何 EXT 项** | 代码侧绿 ≠ 合规 P0 到位 |
| GAP-02 敏感词库仅 8 词 | `launch-checklist.md:179`（引 `moderation.service.ts:7`） | 实测 `app/apps/api/src/modules/moderation/moderation.service.ts:7-16` = 8 词（赌博/毒品/枪支/恐怖主义/色情/诈骗教程/制毒/爆炸物） | **成立，行号准确** |
| GAP-05 ICP 占位串 | `launch-checklist.md:182`（引 `apps/web/pages/index.vue:182`） | 实测占位串在 `app/apps/web/pages/index.vue:187`（`内容由 AI 生成，请仔细甄别 · 京 ICP 备 00000000 号（上线前替换）`）；`:182` 是「举报 / 投诉」链接 | **GAP 成立，但 checklist 引用的行号漂移 5 行** |

---

## 2. D0 未决项（`docs/README.md`）

| 项 | 要求出处 文件:行 | 现状 | 结论 |
|---|---|---|---|
| 项目名称/域名 | `docs/README.md:99` | `- [ ]` 未勾选（原文含「阻塞：备案、落地页文案；阻塞：W1 0.5 备案」） | **未决** |
| 团队编制确认 | `docs/README.md:100` | `- [ ]` 未勾选（当前假设 1~2 名全栈） | **未决** |
| 主体公司（个体/有限公司）与支付主体 | `docs/README.md:101` | `- [ ]` 未勾选（阻塞：微信支付申请；阻塞：W1 0.5 备案） | **未决** |
| 章节性质 | `docs/README.md:97`（「未决事项（Owner 补充后删除本节）」） | 0/3 已勾选 | 该节仍待 Owner 补充，**3 项全未决** |
| 连带影响 | `docs/07-plan/wbs.md:17`（0.5「D0 未决（域名/主体）前本任务不可开工」）、`docs/01-product/PRD.md:240`（第 4 条开放问题，明确 D0 阻塞 W1 备案） | wbs P0 首个任务即被锁死 | **D0 未决 = 关键路径起点不可开工** |

---

## 3. 交付基线失真核查（25/25 与 git 时间）

| 项 | 要求出处 文件:行 | 现状 | 结论 |
|---|---|---|---|
| 「25/25」原文 | `README.md:61` | `pwsh _acceptance/b-type-acceptance.ps1        # 全量可复跑验收（当前 25/25 项通过）` | **基线声明成立但时点滞后** |
| 验收日志日期/时间 | `_acceptance/b-type-acceptance-run.log:3` | `工作区: E:\wanxing   API 临时端口: 3100   时间: 2026-10-25T15:08:13.9113779+08:00` | 日志时点 = **2026-10-25 15:08:13 (+08:00)** |
| 验收结论行 | `_acceptance/b-type-acceptance-run.log:50` | `结果: 25/25 通过，0 失败` | 与 README 数字一致 |
| 覆盖项数校验 | `_acceptance/b-type-acceptance-run.log:22` | `Tests 6+13+87+11+167+15` = 299 passed / 1 skipped（PASS 行逐条） | 与 impl-state 记录一致 |
| 最近提交时间 | `git log -1 --format='%h %cI'` → **`8e25f53 2026-10-25T22:21:22+08:00`** | 主题：`fix(worker): real 模式出站素材 URI 签名 + 公网可达守卫（P10 真实上线门槛）` | 提交时点 = **2026-10-25 22:21:22 (+08:00)** |
| 两者先后关系 | — | 07:13:08 时间差；**日志（15:08）早于最近提交（22:21）** | **失真成立**：`README.md:61` 的「当前 25/25」证据链停留在 22:21 提交之前约 7.2 小时；此后至少 4 个 feat/fix 提交（`32aa80a 21:03`→`1974cda 21:33`→`2af6281 21:42`→`35fdb44 21:56`→`8e25f53 22:21`）**未被任何验收证据覆盖**。`25/25` 描述的是历史快照，不是 HEAD 的通过结论 |
| 仓库污染佐证 | `git status --porcelain` | `M app/apps/web/components/Director3D.vue`（未提交修改）+ `?? deliverables/software-company/wanxing-gap-to-final-product-2026-10-25.md`（未跟踪） | 工作树并非与 HEAD 一致，进一步削弱「25/25 = 当前状态」的表述 |

---

## 4. 上线前 72h 演练 D1–D9（`docs/05-ops/deployment.md:256-271`）

| 项 | 要求出处 文件:行 | 是否有对应脚本/证据（路径或「无」） | 结论 |
|---|---|---|---|
| D1 备份可恢复性 | `docs/05-ops/deployment.md:263`；同项 `launch-checklist.md:162` | **有**：`app/deploy/verify-backup.ps1`、`app/deploy/backup-db.sh`、`backup-db.ps1`、`restore-db.sh`；演练结论回执**无**（`launch-checklist.md:162` 状态 ⏳） | 工具齐备，**演练未执行/无回执** |
| D2 回滚 | `deployment.md:264`；`launch-checklist.md:163` | **有**：`app/deploy/rollback.sh`（`rollback.sh:13` 含 readiness 校验，见 `launch-checklist.md:122`）；演练回执**无**（⏳） | 工具齐备，**演练未执行** |
| D3 支付回调失败 | `deployment.md:265`；`launch-checklist.md:164` | **部分有**：`_acceptance/b-type-acceptance.ps1` 阶段 3 覆盖「回调未配公钥 → 401」；`_acceptance/compliance-check.cjs` 覆盖 PAY-01/02/13/14 静态判定。**专项演练脚本无**；双手法中的「未知 `Wechatpay-Serial`」仅由 `PAY-14` 静态检查覆盖 | **无专项脚本/无回执** |
| D4 对账补账 | `deployment.md:266`；`launch-checklist.md:165` | **无**（无 mock notify 制造「已支付未入账」+ 等 5min 观察补账的演练脚本）；相关能力由 worker 定时任务 `orders-reconcile` 承载（`deployment.md:152`，已接入 `apps/worker/src/main.ts`，见 `deployment.md:166`） | **无脚本/无回执** |
| D5 优雅停机 | `deployment.md:267`；`launch-checklist.md:166` | **有**：`_acceptance/graceful-shutdown.cjs`（`graceful-shutdown.cjs:9,47,117` 断言日志含 `draining`/`closed cleanly`，6/6）；`_acceptance/ops-acceptance.cjs:43-45` 注明由前者覆盖 | 有可复跑脚本；**发布单回执仍 ⏳** |
| D6 告警链路 | `deployment.md:268`；`launch-checklist.md:167` | **无**（无「人为制造 5xx/慢请求 → 落到电话+IM 告警通道」的可复跑脚本；`_acceptance/compliance-check.cjs:537` 的 LOG-05 只验证日志契约、不验证外发通道）；告警口径分散在 `docs/05-ops/observability.md`（无稳定行号可引） | **无脚本/无回执** |
| D7 容量与限流 | `deployment.md:269`；`launch-checklist.md:168` | **无**（无压测脚本；`_acceptance/` 下无 k6/autocannon 类产物；grep `压测\|限流` 仅命中合规检查的文档字面匹配） | **无脚本** |
| D8 值班与升级 | `deployment.md:270`；`launch-checklist.md:169` | **无**（排班表、P0 15min 响应演练均无仓库内产物） | **无**（纯外部组织项） |
| D9 未成年人误充退款 | `deployment.md:271`；`launch-checklist.md:170`；口径 `launch-checklist.md:58-65` | **有（代码/接口层）**：`POST /v1/ops/admin/orders/{id}/refund`（`app/apps/api/src/modules/admin/admin.controller.ts:156`，`AdminGuard` 于 `:49`）、`app/apps/api/src/modules/billing/billing.service.ts:415`（仅全额）、退款流水 `packages/db/src/ledger.ts:173-175`；`_acceptance/b-type-acceptance.ps1` 覆盖「退款闭环（HTTP）」；`compliance-check.cjs` 覆盖 PAY-05~12。**客服工单/审批链/监护人申诉演练回执无**（EXT-19 见 `launch-checklist.md:52`） | **接口侧可复跑；业务侧演练与工单留痕无** |

---

## 5. 文档内部冲突：示例作品规模

| 项 | 要求出处 文件:行 | 现状 | 结论 |
|---|---|---|---|
| PRD 口径 | `docs/01-product/PRD.md:197` | 示例项目 `is_sample=1`，**2 集已确认大纲 + 2 个角色，无分镜**；`:203` 呼应「注册后 30 秒内可见」 | PRD = 2 集 / 2 角色 / 0 分镜 |
| PRD 增补口径 | `docs/01-product/PRD-supplement-works-and-onboarding.md:89` | 「提供 1 个只读示例作品（已带 **3 集大纲 + 3 角色 + 10 分镜**，未投递）」 | 增补 = 3 集 / 3 角色 / 10 分镜 |
| 冲突性质 | 两处行号如上 | 集数 2 vs 3、角色 2 vs 3、分镜 0 vs 10 —— **三处数值全部冲突** | **文档内部冲突成立，未标注优先级** |
| 代码按哪个实现 | `app/apps/api/src/modules/auth/auth.service.ts:44-90` | 注释 `:45` 明确写「**示例作品（PRD 增补 §3.2）：带 2 集大纲与 2 个角色，无分镜**」；`samples` 数组 `:62-65` = 2 集；`chars` 数组 `:76-79` = 2 角色；**全程无分镜插入** | **代码按 PRD 主文档口径实现（2/2/0），并主动引用了冲突的增补文档号**；增补文档的 3/3/10 为**未实现** |
| 落库开关 | `app/apps/api/src/config/env.ts:51-54`（`SEED_SAMPLE_PROJECT` 默认 `"true"`）；`auth.service.ts:185-187` | 默认开启，但 `createSampleProject` 失败被 `.catch(() => undefined)` 吞掉 | 实现路径存在，**失败静默**（无告警/无埋点） |
| 关联冲突 | `docs/01-product/PRD.md:175` vs `PRD-supplement-works-and-onboarding.md:40` | PRD「已成片 = **全部**镜头成功」；增补「**至少 1 集**全部镜头成功」 | **二次口径冲突**（代码 `script.service.ts:306` 按 `archivedAt` 判归档，成片态判定口径需人工裁定） |

---

## 6. 需人工/外部推进、无法由代码验证的项

以下各项**不存在任何代码可判定路径**，必须由法务/财务/创始人/Owner 推进；代码侧全绿（66 项）与验收脚本 25/25 对它们**零覆盖**。

| # | 项 | 出处 文件:行 | 阻塞级别 | 为何无法由代码验证 |
|---|---|---|---|---|
| 1 | **D0 三项决策**：项目名称/域名、主体公司（含支付主体）、团队编制 | `docs/README.md:99-101`；`docs/07-plan/wbs.md:17` | **最高（一切外部链的起点）** | 属创始人决策；未决则 wbs 0.5 不可开工 |
| 2 | EXT-01 公司主体营业执照（经营范围含互联网信息服务/软件开发） | `launch-checklist.md:34` | P0 | 需工商登记回执 |
| 3 | EXT-02 域名注册与实名（4 个子域） | `launch-checklist.md:35` | P0 | 需域名证书 + 实名信息 |
| 4 | EXT-03 ICP 备案（非经营性） | `launch-checklist.md:36`；占位串 `app/apps/web/pages/index.vue:187` | P0 | 需备案系统受理回执；代码只能替换字符串，无法取得备案 |
| 5 | EXT-05 公安联网备案 | `launch-checklist.md:38` | P0 | 需备案号 + 备案图标回执 |
| 6 | EXT-06 生成式人工智能服务备案 | `launch-checklist.md:39` | P0 | 需网信部门受理回执 |
| 7 | EXT-07 深度合成服务算法备案 | `launch-checklist.md:40` | P0 | 需算法备案系统截图 |
| 8 | EXT-08 供应商模型备案证明（火山方舟/百炼/可灵等） | `launch-checklist.md:41` | P0 | 需各家备案截图 + 合同附件 |
| 9 | EXT-15 用户协议/隐私政策律师审阅 | `launch-checklist.md:48`；页面 `app/apps/web/pages/terms.vue`、`pages/privacy.vue` | P0 | 需审阅意见书 |
| 10 | EXT-13 内容安全词库采购（≥5000 词） | `launch-checklist.md:46`；GAP-02 `:179`；代码 `moderation.service.ts:7-16`（现 8 词） | P1（但为内容安全兜底） | 词库属外部采购许可 |
| 11 | EXT-04 ICP 经营许可证（EDI） | `launch-checklist.md:37` | P1 | 涉及在线充值即属经营性 |
| 12 | EXT-09 供应商 DPA / 委托处理协议 | `launch-checklist.md:42` | P1 | 需签署版合同 |
| 13 | EXT-10 微信支付商户号 + APIv3 密钥 + 平台证书 | `launch-checklist.md:43`；env 见 `app/apps/api/src/config/env.ts:67` 起 | P1 | 需商户平台开通；代码仅能「未配即 401 拒绝」 |
| 14 | EXT-11 支付宝应用 + 公钥 | `launch-checklist.md:44` | P1 | 同上 |
| 15 | EXT-12 短信签名与模板报备 | `launch-checklist.md:45`；代码 `sms.service.ts` 仅有频控/校验 | P1 | 需运营商审核 |
| 16 | EXT-14 发票能力（或人工月度开票） | `launch-checklist.md:47` | P1 | 需税控/服务合同 |
| 17 | EXT-16 支付类目报备 + 类目审核 | `launch-checklist.md:49` | P1 | 需商户平台类目截图 |
| 18 | EXT-19 未成年人误充退款客服通道（工单/话术/审批链） | `launch-checklist.md:52`；代码侧仅退款 API `admin.controller.ts:156` | P1 | 需客服工单流程与模拟监护人申诉演练 |
| 19 | EXT-17 等保 2.0（二级）定级备案/测评 | `launch-checklist.md:50` | P2 | 需测评报告 |
| 20 | EXT-18 Sentry 境内/自建部署 | `launch-checklist.md:51`；口径见 `docs/05-ops/observability.md`（§5，无稳定行号） | P2 | 需自建 DSN 内网地址（禁境外 SaaS） |
| 21 | EXT-20 数据出境评估 | `launch-checklist.md:53` | P2 | 需评估结论（当前全链路境内） |
| 22 | CODE-H1 显式水印真实成片抽验 | `launch-checklist.md:149` | P0 | 需真实供应商出片 + ffmpeg 渲染人眼抽验 |
| 23 | CODE-H2 词库规模 ≥5000 + 定期更新 | `launch-checklist.md:150` | P1 | 同 EXT-13 |
| 24 | CODE-H3 审核/举报记录 6 个月归档到 OSS | `launch-checklist.md:151` | P1 | 需生产对象存储配置 + 生命周期规则截图 |
| 25 | CODE-H4 真实渠道 1 分钱全链路联调 | `launch-checklist.md:152` | P1 | 需真实商户号 |
| 26 | CODE-H5 对账 SOP 连续 24h 验证 | `launch-checklist.md:153` | P1 | 需生产流量 |
| 27 | CODE-H6 `AI_LABEL_ENABLED=false` 策略评审 | `launch-checklist.md:154` | P2 | 属风控决策 |
| 28 | D4 对账补账演练、D6 告警链路、D7 容量与限流、D8 值班与升级 | `deployment.md:266,268,269,270` | P0/P1 | 仓库内无脚本/无回执（见第 4 节） |
| 29 | v2.0 无 wbs 分解 | `docs/01-product/PRD.md:223`（对照 `docs/07-plan/wbs.md` 仅 v1.1/v1.5） | 计划缺口 | 需产品/Owner 补计划 |
| 30 | 示例作品规模冲突裁定（PRD 2/2/0 vs 增补 3/3/10）；作品四态口径冲突（PRD:175 全部镜头 vs 增补:40 至少 1 集） | 见第 5 节 | 文档一致性 | 需产品裁定并统一；代码当前忠实地实现了 PRD 主文档口径，但引用了冲突的增补文档号 |

### 6.1 最长外部依赖链（结论）

```
D0 决策（主体公司 + 域名 + 编制）                      ← 全部未决，任何外部流程均无法启动
  └─► EXT-01 营业执照（经营范围含互联网信息服务/软件开发）
        └─► EXT-02 域名注册与实名（www/app/api/static）
              └─► EXT-03 ICP 备案（非经营性）            ← 2~6 周量级，见 wbs.md:121
                    ├─► EXT-05 公安联网备案
                    ├─► EXT-06 生成式 AI 服务备案  ┐
                    ├─► EXT-07 深度合成算法备案    ├─ 周期最长，wbs.md:121 记为 Alpha 硬门槛
                    │                              ┘
                    ├─► EXT-10 微信支付商户号 ──► EXT-16 支付类目报备
                    └─► (P1) EXT-04 EDI 经营许可证

并行最短路径：EXT-01 → EXT-02 → EXT-03 → EXT-05（launch-checklist.md:55 明示「备案链最短路径」）
最长链：D0 → EXT-01 → EXT-02 → EXT-03 → EXT-06 / EXT-07（AI 双备案）→ Alpha 硬门槛
```

- 链条依据：`docs/07-plan/wbs.md:121`（「ICP+AI 双备案(2-6 周) ──► Alpha 硬门槛（W1 提交，前置 D0 域名/主体决策）」）、`:123`（「微信支付商户号(依赖 ICP+主体) ──► P2'（W8 申请, 留 2 周缓冲）」）、`docs/06-security-compliance/launch-checklist.md:55`（外部项推进顺序建议）
- **关键结论**：外部链的**起点是 D0 决策**，而 D0 三项在 `docs/README.md:99-101` 全部未勾选 → 最长外部依赖链当前**完全未启动**，且代码侧 66 项 / 25 项验收对链条上的任何一环都无判定能力。
