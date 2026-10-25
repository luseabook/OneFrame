# 全站复刻范围盘点（fullsite-route-inventory）

> 目标：Owner 已拍板「往参照产品 ReelMate 全站 1:1 复刻走」。本文件给出**模块 × 现状总表**与**单点工具清单**，作为收口计划骨架。
> 只读盘点，未修改任何源码/文档。唯一写入：本文件。
> 盘点日期：2026-10-26。盘点人：route-mapper。

---

## 0. 统计口径（先分清「页面路由」与「API 路径常量」）

`routes.txt` 是**两类内容混在一个文件**的去重清单，直接按行数当路由数会错。分类结果：

| 类别 | 条数 | 行号范围 | 判定规则 |
|---|---|---|---|
| `/web/v1/...` API 路径常量 | **801** | `routes.txt:123-923` | 前缀 `/web/v1/` |
| `/v1/...` API 路径常量（直连后端服务） | **20** | `routes.txt:100-119` | 前缀 `/v1/` |
| **API 常场合计** | **821** | — | 两者相加 |
| 页面路由 | **102** | `:1-99`、`:120-122`、`:924` | 以 `/` 开头且不是 API |
| 裸 token（非路径） | **4** | `:925-928` | `assets` / `members` / `produce` / `tasks` |
| 空行 | 1 | `:926` 前 | — |
| **文件总行数** | **928** | — | — |

校验：927（非空）+ 1（空行）= 928；821（API）+ 102（页面）+ 4（裸 token）= 927。✅

> **与任务书的口径差异（需 Lead 知悉）**：任务书写「约 801 条以 `/v1` 开头的是 API」。实测**恰好 801 条是 `/web/v1/`**，另有 20 条是**不带 `web` 的 `/v1/`**（`rmdfsrv`/`rmaisrv`/`rmadminsrv`/`skymedia` 直连），合计 **821**。两处数字都对，只是分母不同。

### 页面路由第一段直方图（102 条，按首段聚合）

| 首段 | 条数 | 首段 | 条数 |
|---|---|---|---|
| `/create/*` | 17 | `/episode-list`、`/canvas`、`/cli`、`/tools` 等各 1 | 1 各 |
| `/film/*` | 5 | `/ad-drama/*` | 2 |
| `/creator-center/*` | 5 | `/reelflow/*` | 2 |
| `/series-manage/*` | 5 | `/director/*` | 2 |
| `/activity/*` | 4 | `/video-redraw/*` | 2 |
| `/activities/*` | 3 | `/novel-to-script-agent/*` | 3 |
| `/team/*` | 3 | `/channel/*` | 3 |
| `/agent/*` | 3 | 其余 30 个单例首段 | 各 1 |

---

## 1. 模块 × 现状总表

**列义**：`我方现状` 三态 = 已实现（可用）/ 部分（有骨架但覆盖窄）/ 无。
**证据**：`RM:` = `rea-reelmate/REELMATE-逆向分析报告.md`（行号）；`rt:` = `rea-reelmate/routes.txt`（行号）；其余为工作区相对路径。
**量级**：S（≤3 人日）/ M（≤2 周）/ L（1~2 月）/ XL（>2 月，含新后端域或多个子系统）。

### A. RE §1 九大分支

| # | 模块 | 参照代表页面路由 | 参照端点前缀 | 我方现状 | 需新建的后端域 | 证据 | 量级 |
|---|---|---|---|---|---|---|---|
| 1 | **首页工作台** | `/`、`/home`、`/mobile-landing` | `/web/v1/config`、`/user-info`、`/task*`、`/op/abtest/hit`、`/msg/exist-unread` | **已实现**（`/home` 652 行、落地页 `/` 612 行） | 无需新建；补 config 驱动 / 未读长轮询 / AB | `RM:27-40,320-326`；`rt:2,61`；`app/apps/web/pages/home.vue:1`、`pages/index.vue:1` | S |
| 2 | **剧本创作 · 小说改编**（小说→世界观→大纲→角色→剧本） | `/novel-to-script/:id`、`/novel-to-script-agent/create`、`/script-manage`、`/script-view/:id` | `/web/v1/df/novel/*`（86）、`/df/fission_script/*` | **部分**（有项目/大纲/角色/剧本草稿生成，无小说导入分析链、无剧本编辑 Agent 会话） | 扩 `script` 域：小说解析、世界观、章节/分集大纲、剧本版本 finalize | `RM:130-133`；`rt:63-65,79,80`；`app/apps/api/src/modules/script/script.controller.ts:119,130,136` | L |
| 3 | **剧本创作 · 剧集与分镜** | `/episode-list`、`/series-manage/:id`、`/series-manage/episode/:id`、`/series-manage/asset-confirm`、`/series-manage/asset-extract` | `/web/v1/df/episode/*`（57）、`/df/storyboard/*`（12） | **部分**（episodes/storyboards 表 + 生成端点齐全，缺质量检查与合成导出链路） | 扩 `script` 域：质量检查、film-synthesis-export | `RM:133,141`；`rt:51,81-85`；`cli-skill/.../deeplink.md:154,192,229`；`script.controller.ts:84,113,147,188` | M |
| 4 | **创作 Agent（SSE 流式）** | `/creation-agent`、`/novel-to-script-agent/workbench`、`/agent`、`/agent/editor`、`/agent/bigscreen` | `/web/v1/agent/task*`（8）、`/agent/home/*`（3）、SSE `/agent/task/stream` | **无**（全仓 SSE/EventSource 零命中） | **全新 `agent` 域**（会话、流式、STT token） | `RM:100,116-117,312-318`；`rt:14-16,42,64,65`；`_acceptance/_gap/impl-state.md:377` | XL |
| 5 | **全部项目** | `/series-manage`、`/series-manage/:id`、`/reelflow/list`、`/film`、`/short-film/:id` | `/web/v1/df/script_project/*`（41）、`/df/creation-projects/*`（23） | **部分**（`/works` 402 行 + `/projects` 327 行 + GET `/projects`・`/works`，无多形态项目聚合） | 扩 `script` 域：项目总览 tab（workshop/canvas）、多形态筛选 | `RM:32,134`；`rt:75,81,82,88`；`app/apps/web/pages/works.vue:1`、`pages/projects/index.vue:1`；`script.controller.ts:56,62` | M |
| 6 | **工具箱（AI视频/AI图片/AI音频）** | `/tools` + 17 条 `/create/*`（见 §2） | `/web/v1/ai/*`（63） | **部分**：工具箱页已列 8 张卡，**仅 2 张有落地页**（文生视频/图生视频） | 扩 `generations` 域：15 条 `/create/*` 后端能力 + 工具页路由 | `RM:33-35,45,128`；`rt:93,25-41`；`app/apps/web/pages/tools.vue:1`（8 卡仅 2 卡带 `to`） | XL |
| 7 | **团队（资产库/团队管理/积分分配）** | `/team`、`/team/dashboard`、`/team/knowledge-base`、`/project-members`、`/user-assets` | `/web/v1/cam/*`（39：team 28 / user 5 / permission / role） | **无**（仅 `spaces`/`space_members` 表，无 UI 无端点） | **全新 `cam` 域**（团队/分组/成员/角色/团队积分池） | `RM:36,101,181`；`rt:90-92,71,95`；`app/packages/db/src/schema.ts:63,74` | XL |
| 8 | **影视版（任务表格+审核流）** | `/film`、`/film-creation`、`/film/:id`、`/film/assets`、`/film/projects/:id/tasks`、`/film/team` | `/web/v1/film/projects/:id/*`（37：task-tables 27 / canvases / task-templates / exports） | **无** | **全新 `film` 域**（仿多维表格任务表 + 字段自定义 + 审核评论 + 画布绑定） | `RM:37,98,141,204`；`rt:53-58` | XL |
| 9 | **MCP & CLI** | `/cli`、`/implement` | 复用同一 `/web/v1/*`；分发 `reelmate_cli_skill_20438.zip` | **无** | **全新 CLI/Skill 包**（38 命令组，非后端端点） | `RM:38,312-318`；`rt:24,59`；`cli-skill/reelmate-cli-skill/SKILL.md:1-59`、`VERSION`=1.0.5 | L |
| 10 | **活动 / 兑换码 / 邀请奖励 / 创作者中心** | `/activities`、`/activities/:activityKey`、`/creator-center`、`/creator-center/earnings`、`/partner-center`、`/partner/invite` | `/web/v1/op/*`（31）、`/crc/*`（30）、`/campaign/*`（6） | **无**（仅 `invite_codes`/`invite_redemptions`/`waitlist_entries` 表 + POST `/waitlist`） | **全新 `op` + `crc` + `campaign` 三域** | `RM:39,104,143,185`；`rt:4,43-46,67,68`；`schema.ts:101,156,172`；`auth.controller.ts:88` | XL |

### B. 任务书额外要求的模块

| # | 模块 | 参照代表页面路由 | 参照端点前缀 | 我方现状 | 需新建的后端域 | 证据 | 量级 |
|---|---|---|---|---|---|---|---|
| 11 | **无限画布（X6 节点编辑器）** | `/canvas`、`/workflow-canvas` | `/web/v1/df/canvas/*`（79）、`/df/canvas-tpls/*`（2） | **无**（`canvas*` 表零张；最近似的是 `project_timelines`，但那是成片时间线非节点图） | **全新 `canvas` 域 + 4 张表**（canvases/nodes/edges/snapshots）+ 心跳锁协同 | `RM:34,47,116,135,203,295-303`；`rt:20,924`；`_acceptance/_gap/impl-state.md:298` | XL |
| 12 | **剧本广场 / 小说市场** | `/novel-market/:id`、`/novel-to-script-agent/*` | `/web/v1/df/novel_market/*`（29：creator/works/agreement/withdraw/scripts） | **无** | **全新 `novel_market` 域**（上架/预售/协议/收益/提现） | `RM:51,139,184`；`rt:62` | L |
| 13 | **广告剧（商品图→广告短剧）** | `/ad-drama/create`、`/ad-drama/workspace` | `/web/v1/df/script_project/drama_ad/*`（15：brief/selling-point/script/storyboard/asset） | **无** | 扩 `script` 域：`drama_ad` 子域 | `RM:52,134`；`rt:11,12`；`cli-skill/.../commands/ad.md:1-178` | M |
| 14 | **视频转绘** | `/video-redraw/create`、`/video-redraw/workspace` | `/web/v1/df/script_project/video_redraw/*`（8） | **无** | 扩 `script` 域：`video_redraw` 子域 | `RM:53,134`；`rt:121,122` | M |
| 15 | **视频拉片 / 翻译 / 音频后处理** | `/refer-video`、`/video-effects`（对应关系未取证） | `/ai/video-convert`、`/ai/video-subtitle-erase`、`/ai/video-subtitle-voice-edit`、`/ai/video-soundtrack`、`/ai/audio-slicing`、`/ai/audio-timbre-modify` | **无** | 扩 `generations` 域：后处理能力族 | `RM:29,128`；`rt:76,120`；`routes.txt:135-197`（`/web/v1/ai/*` 63 条） | M |
| 16 | **多语言 zh / en / ja / br / es** | `/en`、`/ja`、`/br`、`/es`（**无 `/zh` 前缀，zh 为默认**） | 请求头 `X-Lang`（非路径前缀） | **无**（界面纯中文，无 i18n 基建） | 前端 i18n + `X-Lang` 协商 | `RM:23,172`；`rt:19,50,52,60` | L |

### C. 由 §3 服务前缀表（`RM:92-106`）补齐的域

| # | 模块 | 参照代表页面路由 | 参照端点前缀 | 我方现状 | 需新建的后端域 | 证据 | 量级 |
|---|---|---|---|---|---|---|---|
| 17 | **资产抽取 / 资产库 / 主体** | `/asset`、`/user-assets`、`/projects/:id`（资产页） | `/web/v1/df/extraction/*`（26）、`/df/resources/*`（41）、`/df/subject/*`（8）、`/df/star-subject/*`（4）、`/web/v1/asset/*`（24） | **部分**（`/assets` 361 行 + 9 端点；缺抽取/匹配/主体/批量化） | 扩 `assets` 域：extraction / asset-match / subject / IP 模板 | `RM:96-97,136,138`；`rt:18,95`；`assets.controller.ts:12-83` | L |
| 18 | **团队知识库** | `/team/knowledge-base` | `/web/v1/df/user_knowledge/*`（29：dir/tag/asset） | **无** | 全新（可并入 `cam` 域） | `RM:137,205`；`rt:92` | M |
| 19 | **3D 导演台（姿态预设）** | `/director`、`/director/:projectId` | `/web/v1/df/3d-director/*`（9） | **部分**（`Director3D.vue` 1112 行纯前端可跑，无后端域） | 扩 `script` 域：3d-director 姿态预设 | `RM:138`；`rt:48,49`；`app/apps/web/components/Director3D.vue:1`；`impl-state.md:375` | M |
| 20 | **ReelFlow 剪辑器 / 工作流** | `/reelflow/edit/:projectId`、`/reelflow/list` | `/web/v1/wf/*`（23：project/video/clip/publish/slicing） | **部分**（timeline 表 2 张 + 6 端点 + ffmpeg 合成 worker；缺切片/发布/clip 资产绑定） | 扩 `wf` 域 | `RM:46,99,225`；`rt:74,75`；`schema.ts:530,556`；`script.controller.ts:416,426,448` | L |
| 21 | **数据看板** | `/team/dashboard` | `/web/v1/kds/da/*`（13） | **无** | **全新 `kds` 域** | `RM:103,181`；`rt:91` | M |
| 22 | **账号 / 鉴权 / SSO** | `/profile`、`/setting`、`/user-settings`、`/user-language`、`/user-update`、`/adjust` | `/web/v1/login`、`/logout`、`/renew`、`/user-info`、`/weixin/token`、`/callback/login`、`/email-captcha`、`/mobile-captcha`、`/captcha-check` | **已实现**（`/login` 698 行 + 8 端点；缺微信/QQ/Apple/抖音 SSO 与短信外呼真实渠道） | 扩 `auth` 域：SSO 联合登录、双 token 续期 | `RM:170-174,255-260`；`rt:13,70,86,96-99`；`auth.controller.ts:27-88` | M |
| 23 | **计费 / 定价 / VIP 订阅** | `/pricing` | `/web/v1/buy/*`（4）、`/trade-order/latest`、`/renew`、`/subscribe`、`/user/credits*`、`/ai/point-calculate` | **已实现**（`/pricing` 872 行 + billing 10 端点 + 积分流水）；**缺 VIP/DF-VIP 订阅制与 SKU 动态定价** | 扩 `billing` 域：订阅制、SKU 档位 | `RM:179-183,262-267`；`rt:69`；`billing.controller.ts:58-309`；`credits.controller.ts:16,22` | M |
| 24 | **任务系统（全平台脊柱）** | `/task`（任务中心） | `/web/v1/task`、`/task/:id`、`/task/result`、`/task/:id/cancel\|retry` | **已实现**（`/tasks` 584 行 + 9 端点 + 6 队列声明）；**3 个队列为死声明** | 无需新建；补 `gen.poll` 真异步轮询 | `RM:108-120`；`rt:89`；`tasks.controller.ts:13-69`；`impl-state.md:302-317` | S |
| 25 | **内容安全与合规** | —（无独立页面） | `/web/v1/text-sensidetect`、`/ai/check-language`、腾讯验证码 `X-Captcha-Ticket` | **部分**（`moderation.service` 有提示词校验；无验证码、无模型侧审核状态） | 扩 `moderation` 域 | `RM:173,175`；`rt:887`（text-sensidetect）、`rt:273`（captcha-check）、`rt:148`（check-language）；`app/apps/api/src/modules/moderation/moderation.service.ts` | S |
| 26 | **分享（公开只读）** | `/share-land` | `/web/v1/task/:id/share`、`/ai/publish` | **已实现**（`/share/:token` 275 行 + 3 端点 + 过期清理） | 无需新建 | `RM:114`；`rt:87`；`task-share.controller.ts:13,23,29` | S |
| 27 | **运营后台（平台侧）** | —（管理侧无独立页面路由常量） | `/v1/rmadminsrv/*`（12） | **已实现**（`/admin` 538 行 + 18 端点 + AdminGuard） | 无需新建 | `RM:139,184`；`routes.txt:100-119`；`admin.controller.ts:40-156` | M |
| 28 | **后端直连服务路径** | —（非页面） | `/v1/rmdfsrv/*`(4)、`/v1/rmaisrv/*`(2)、`/v1/skymedia/*`(1) | **无**（我方为单一 NestJS 单体） | 架构决策：单体 or 拆分 | `RM:105-106,159`；`routes.txt:100-119` | S |

**模块数 = 28**（A 组 10 + B 组 6 + C 组 12）。

---

## 2. 单点工具清单

**口径**：以 `routes.txt` 的 `/create/*` 为**一级来源**（17 条，可复现）；再补 `RM:33-35,45` 文字点名但**无 `/create/*` 路由**的工具（5 个），合计 **22**。

### 2.1 `/create/*` 路由抽取（17，`routes.txt:25-41`）

> ⚠️ **名称口径**：下表「工具名」是**路由 slug 的中文直译**，类别来自 `RM:33-35` 的「AI视频 / AI图片 / AI音频」三分法。**参照产品界面上的实际显示名未取证**（截图未做视觉识别），不作为对外文案依据。

| # | 路由 | 工具名（slug 直译） | 类别 | 我方 |
|---|---|---|---|---|
| 1 | `/create/text-to-video` | 文生视频 | AI视频 | ✅ **已实现**（`pages/create/text-to-video.vue:1`，复用 `VideoGenWorkspace.vue` 1380 行） |
| 2 | `/create/image-to-video` | 图生视频 | AI视频 | ✅ **已实现**（`pages/create/image-to-video.vue:1`） |
| 3 | `/create/lip-sync` | 视频对口型 | AI视频 | ❌ 缺（工具箱有卡无页） |
| 4 | `/create/reference-to-video` | 参考生视频 | AI视频 | ❌ 缺 |
| 5 | `/create/video-refer` | 视频参考 | AI视频 | ❌ 缺 |
| 6 | `/create/video-upscale` | 视频超清 | AI视频 | ❌ 缺 |
| 7 | `/create/video-extend` | 视频续写 | AI视频 | ❌ 缺 |
| 8 | `/create/video-edit` | 视频编辑 | AI视频 | ❌ 缺 |
| 9 | `/create/video-effects/effect` | 视频特效 | AI视频 | ❌ 缺 |
| 10 | `/create/image-to-image` | 图生图 | AI图片 | ❌ 缺 |
| 11 | `/create/text-to-image` | 文生图 | AI图片 | ❌ 缺 |
| 12 | `/create/brush-repaint` | 涂抹重绘 | AI图片 | ❌ 缺 |
| 13 | `/create/text-repaint` | 文字重绘 | AI图片 | ❌ 缺 |
| 14 | `/create/text-to-speech` | 文生语音 | AI音频 | ❌ 缺 |
| 15 | `/create/text-to-music` | 文生音乐 | AI音频 | ❌ 缺 |
| 16 | `/create/text-to-sound` | 文生音效 | AI音频 | ❌ 缺 |
| 17 | `/create/auto-bgm` | 自动配乐 | AI音频 | ❌ 缺 |

### 2.2 `RM` 点名但无 `/create/*` 路由（5）

| # | 工具名 | 依据 | 我方 |
|---|---|---|---|
| 18 | 灵感成片（Agent） | `RM:34,45`；工具箱卡（`pages/tools.vue:1` 第 5 卡） | ❌ 缺 |
| 19 | 视频翻译 | `RM:29` | ❌ 缺（疑似后端 `/ai/video-subtitle-voice-edit` + `/ai/check-language`，**页面路由未取证**） |
| 20 | 视频拉片 | `RM:29` | ❌ 缺（疑似 `/wf/video-slicing`，**页面路由未取证**） |
| 21 | 音色修改 | `RM:29` | ❌ 缺（疑似 `/ai/audio-timbre-modify` + `/ai/timbre/*`） |
| 22 | 错字重读 | `RM:29` | ❌ 缺（疑似 `/ai/video-subtitle-voice-edit`） |

> **另有 1 个不在 `/create/*` 的工具**：**视频转绘**（`/video-redraw/create`、`/video-redraw/workspace`，`routes.txt:121-122`），已按模块 #14 单列，未计入本 22。

### 2.3 汇总

| 指标 | 数值 |
|---|---|
| 单点工具总数 | **22**（17 有路由 + 5 仅报告点名） |
| 我方已有 | **2**（文生视频、图生视频） |
| **缺口数** | **20** |
| 工具箱页已展示卡片 | 8（`pages/tools.vue:1`），其中仅 2 张带 `to` 可跳转 |
| 参照产品模型数（旁证，非工具数） | **46**（`model-catalog-summary.json` 数组长度）；去重生成端点仅 **8** 个（`RM:334`） |

---

## 3. 未取证 / 无法确认清单

**明确未取证（本盘点未读、不得据此下结论）：**

1. `appgraph.json`（63MB）、`capture*.json`、`net*.json`、`bundle*.json` — **未打开**，故参照产品的运行时行为/响应体断言不在本文件范围。
2. 参照页面**实际 UI 内容**：`tools.png` 等截图**未做视觉识别**（当前模型无图像输入能力）；`_dom-nodes.json` 只含 `node_value_length` 无文本，无法作为工具名证据。→ **§2 的工具名全部来自路由常量与报告文字，未从界面取证。**
3. `/refer-video`、`/video-effects` 与「视频拉片/视频翻译」的对应关系 — **未取证**。§1 #15 与 §2 #19~#22 的映射为**推测标注**，已在表中显式标出。
4. 「视频翻译 / 视频拉片」是否存在独立页面路由 — `routes.txt` 中**未见同名路由**，仅在 `RM:29` 以文字出现。**未取证。**
5. `routes.txt` 末尾 4 个裸 token（`assets`/`members`/`produce`/`tasks`，`:925-928`）的语义 — 疑似某页面子路由的截断输出，**无法确认**，未计入任何统计。
6. `/adjust`、`/implement`、`/route-permission-map`、`/redirect/:action`、`/redirect-callback/:action`、`/channel/education/*`、`/mobile-landing`、`/share-land`、`/tutorial`、`/user-center`、`/profile`、`/setting` — 仅知其为页面路由，**功能未取证**，未单列模块。
7. 「全部项目」导航项的**唯一目标路由** — `RM:32` 只给了导航名，未给路由；本表按项目总览候选集（`/series-manage` 等）填写并标注为候选。**未取证。**
8. 我方现状的**运行时可用性** — 本文件仅依据代码结构与既有基线 `_acceptance/_gap/impl-state.md`；**未启动任何服务、未跑测试**。
9. 影视版任务表格的字段类型系统、SSE 完整事件表、ReelFlow timeline JSON 完整 schema — 参照产品侧即 **unknown**（`RM:242-246`）。

**合规提醒（引用 `RM:211`）**：以上为行为与架构层面观察；复刻须独立编写代码、自建设计与文案，不复用其前端代码/美术素材/品牌元素。

---

## 4. 本盘点实际执行的命令

> 全部为只读；未发起外部网络请求，未启动浏览器。工作目录 `E:\wanxing`。

```powershell
# ① routes.txt 分类（页面路由 vs /v1 API 常量）
$ne = Get-Content 'rea-reelmate\routes.txt' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
$ne.Count                                                             # 927（非空）
($ne | Where-Object { $_ -like '/web/v1/*' }).Count                   # 801
($ne | Where-Object { $_ -like '/v1/*' }).Count                       # 20
($ne | Where-Object { $_ -like '/v1/*' -or $_ -like '/web/v1/*' }).Count   # 821
($ne | Where-Object { $_ -like '/*' -and $_ -notlike '/v1/*' -and $_ -notlike '/web/v1/*' }).Count  # 102
($ne | Where-Object { $_ -notlike '/*' }).Count                       # 4（裸 token）

# ② API 行号范围 + 服务前缀聚合
Select-String -Path 'rea-reelmate\routes.txt' -Pattern '/web/v1/' | Select-Object -First 1, -Last 1
$v1 | ForEach-Object { ($_ -replace '^/web/v1/','' -replace '^/v1/','') -split '/' | Select-Object -First 1 } |
      Group-Object | Sort-Object Count -Descending      # df 466 / ai 63 / cam 39 / film 37 / op 31 / crc 30 ...

# ③ /create/* 抽取
($ne | Where-Object { $_ -like '/create/*' })           # 17 条

# ④ 页面路由首段直方图
$page | ForEach-Object { ($_ -split '/')[1] } | Group-Object | Sort-Object Count -Descending

# ⑤ 关键页面路由行号
#    （对 routes.txt 逐行比对目标字符串，输出 2/4/11/12/19/20/24/42/43/45/49/50/51/53/57/59/60/61/62/65/67/68/69/70/71/74/75/76/77/78/79/81/86/88/90/91/92/93/94/95/120/121/122/924 等行）
#    结果见 §1 各模块「证据」列的 rt: 行号

# ⑥ CLI 命令组计数
(Get-ChildItem 'rea-reelmate\cli-skill\reelmate-cli-skill\commands' -File).Count   # 38
Get-Content 'rea-reelmate\cli-skill\reelmate-cli-skill\VERSION'                    # 1.0.5

# ⑦ 模型目录条数
(Get-Content 'rea-reelmate\model-catalog-summary.json' -Raw | ConvertFrom-Json).Count   # 46

# ⑧ 我方页面 / 端点 / 表清单
Get-ChildItem 'app\apps\web\pages' -Recurse -File                                  # 20 个页面
Get-ChildItem 'app\apps\api\src' -Recurse -File -Filter *.controller.ts            # 17 个 Controller
Select-String -Path 'app\apps\api\src\**\*.controller.ts' -Pattern '@(Get|Post|Put|Patch|Delete)\('   # 112 个端点
Select-String -Path 'app\packages\db\src\schema.ts' -Pattern 'pgTable\('           # 29 张表
Get-ChildItem 'app\apps\web' -Recurse -File -Filter *.vue | Where-Object { $_.FullName -notmatch 'node_modules' }  # 43 文件 / 16488 行
```

**已读输入文件**（全部只读）：`routes.txt`、`REELMATE-逆向分析报告.md`、`model-catalog-summary.json`、`cli-skill/reelmate-cli-skill/SKILL.md`、`manual/user-guide.md`、`commands/ad.md`、`commands/deeplink.md`、`VERSION`、`modules.txt`，以及我方 `app/` 源码与 `_acceptance/_gap/impl-state.md`。

**未读**：`appgraph.json`、所有 `capture*.json` / `net*.json` / `bundle*.json` / `api-log*.json`（按 Lead 约束）。
