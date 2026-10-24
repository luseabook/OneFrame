# ReelMate（万兴剧厂 www.reelmate.cn）逆向分析报告

> 分析方式：REA（CDP 被动观察 + bundle 静态分析 + 离线 JavaScript 应用图 + Playwright 场景）
> 分析日期：2026-10-24 · 环境证据：Chrome/156 headless CDP `http://127.0.0.1:9222`
> 主要 Evidence ID：
> - bundle 抓取：`ev_a03dcc6d126d97a743d568edd38785e9c26cc4e5a812507648c0beaf7ee3d754`（capture.json）
> - 页面抓取（含脚本源码）：`ev_9eb316e647e7848a51153941b6f4f06400a9248db46df4cef90bcbfb26dc4226`（capture_page.json）
> - 离线应用图：`ev_faf10b82ede952cba17c6e41c130a843c150256a310ddf2ecc491c8c8508152d`（appgraph.json，20,601 节点 / 30,406 关系 / 133 模块）
> - 登录弹窗场景：`ev_1e6c236ea39fa410b318c3c5bea3cd44d09cef9e000a7244abebf21f36258ce2` 及后续

---

## 0. 一句话结论

**万兴剧厂（ReelMate）是万兴科技（Wondershare）旗下的"AI 漫剧/短剧一站式生产 SaaS"：Nuxt 3 (Vue 3 + Vite) 前端 + `app.reelmate.cn` API 网关 + 多服务后端（剧本/分镜/资产/画布/任务/团队/计费），底层聚合多家第三方大模型（Seedance、Kling、Hailuo、Vidu、Wan、天幕、通义千问、豆包、DeepSeek…），以"异步任务 + 轮询 + SSE"为基本执行模型，商业化以积分（Points）+ VIP 订阅为核心。**

---

## 1. 产品定位与页面结构

- Slogan（SEO title）：`万兴剧厂 - AI驱动的一站式精品漫剧创作平台 影视级规模化生产 小成本成就大爆款`
- 国际/备用域名：`www.tomoviee.cn`（ToMoviee 品牌）、海外 API `app.reelmate.ai`、静态资源 `static.reelmate.cn`
- 多语言：zh（默认）/ en / ja / br / es（路由前缀），支持韩语等错误文案

### 应用信息架构（登录前可见）

```
├─ 首页（工作台）：短剧工作流 / 无限画布 / 工具矩阵（剧本创作、剧本广场、
│   视频转绘、视频翻译、视频拉片、音色修改、错字重读…）
├─ 剧本创作（小说→剧本→分镜流水线）
├─ 创作 Agent（对话式创作，SSE 流式）
├─ 全部项目
├─ 工具箱（AI视频 / AI图片 / AI音频 三类单点工具）
│   文生视频、图生视频、视频对口型、参考生视频、灵感成片(Agent)、
│   视频超清、视频续写、视频编辑…
├─ 团队：资产库 / 团队管理（分组、成员、积分分配）
├─ 影视版（内测申请）：影视级项目协作（任务表格 + 审核流）
├─ MCP & CLI（对外暴露 MCP Server 与 CLI 工具）
└─ 活动 / 兑换码 / 邀请奖励 / 创作者中心（投稿激励 最高8万元/部）
```

### 路由表（去 i18n 前缀后 928 条，含 API 路径常量）

关键页面路由（`routes.txt`）：
- `/create/*`：20+ 单点工具（text-to-video、image-to-video、lip-sync、text-to-music、text-to-speech、video-upscale、video-extend、brush-repaint、auto-bgm、video-edit…）
- `/reelflow/edit/:projectId`、`/reelflow/list`：剪辑器（ReelFlow）
- `/workflow-canvas`、`/canvas`：无限画布工作区
- `/film/*`、`/film-creation`、`/film/projects/:id/tasks`：影视版协作
- `/series-manage/*`、`/episode-list`：剧集/分集管理
- `/script-manage`、`/script-view/:id`：剧本管理
- `/novel-to-script-agent/*`、`/novel-market/:id`：小说改编智能体、剧本集市
- `/ad-drama/create|workspace`：广告剧（商品图/卖点→广告短剧）
- `/video-redraw/*`：视频转绘
- `/creator-center/*`、`/pricing`、`/team/*`、`/user-center`

---

## 2. 前端技术栈

| 层 | 选型 | 证据 |
|---|---|---|
| 框架 | **Nuxt 3 + Vue 3**（SSG 部分页面 + SPA 应用壳） | DOM `data-v-*` 作用域样式、`data-hid`、`data-ssg-inlined-css`、`window.__NUXT__` |
| 构建 | **Vite** | `analyze_web_bundle` 推断 detector `vite-runtime`（多个 chunk 命中） |
| 状态 | **Pinia**（auth store / drive store 等） | bundle 内 `getters:{}…tokenInfo` 模式、pinia 引用 |
| 工具库 | **@vueuse/core**（独立 vendor chunk）、lodash、date 库（dayjs 类）、jszip | chunk 名：`vendor-vueuse-*`、`vendor-lodash-*`、`vendor-date-query-*`、`vendor-jszip-*` |
| 画布/节点编辑器 | **AntV X6** + **AntV G6** + **dagre** 布局 | 源码命中 X6/G6/dagre 多处 |
| 视频播放 | **Vidstack Player** | `vendor-vidstack-*` chunk + 源码引用 |
| UI 组件 | 自建设计系统（`ui-base-*`、`ui-controls-*` chunk + 302KB 内联入口 CSS），基本不用第三方组件库 | chunk 命名 |
| 埋点 | **神策 Sensors Data**（sensorsdata_1.26.6）+ Google Tag Manager | `sensorsdata_1_26_6.min.js`、`googletagmanager` |
| 其他 | Web Vitals 上报、腾讯云验证码、SVG feTurbulence 特效、字体切片（`data-font-slices`） | 源码与 DOM |

打包形态：133 个 chunk，首页共约 2.5MB JS；最大 `core-lib-*.js` 1.1MB（业务核心），次大 `D7aUDXP7.js` 409KB（API SDK 生成代码）。生产构建无 source map（`source_maps.status=unavailable`）。

---

## 3. 后端架构与服务划分

### 网关与域名（运行时配置，core-lib 内明文）

```js
VITE_APP_DOMAIN       = "https://www.reelmate.cn"     // 主站
VITE_APP_DOMAIN_API   = "https://app.reelmate.cn"     // API 网关（国内）
VITE_APP_DOMAIN_SITE  = "https://www.tomoviee.cn"     // 海外品牌站
VITE_APP_DOMAIN_STATIC= "https://static.reelmate.cn"  // 静态资源
VITE_APP_ID  = "20438"
VITE_APP_KEY = "407a3d0d6dab158f790bd3247276164a…"   // 应用标识（/web/v1/env 可复核）
```

`GET /web/v1/env` 返回：`{"code":0,"msg":"","data":{"app_key":"407a…","env":"prd"}}`
→ 统一响应信封 `{code, msg, data}`，`code===0` 为成功（前端 `handleErrorResponse` 据此走 `notifyBusinessError`）。

### 服务前缀（微服务命名规律）

| 前缀 | 职能 |
|---|---|
| `/web/v1/ai/*` | 通用 AI 能力网关（模型聚合调用） |
| `/web/v1/df/*` | **D**rama **F**actory 核心域（剧本/分镜/资产/画布/知识库） |
| `/web/v1/film/*` | 影视版协作（任务表格/审核/画布绑定） |
| `/web/v1/wf/*` | 工作流剪辑（ReelFlow：项目/视频/切片/发布） |
| `/web/v1/agent/*` | 对话式创作 Agent（SSE） |
| `/web/v1/cam/*` | 团队/成员/分组/积分管理（企业版） |
| `/web/v1/crc/*` | 创作者中心（投稿/粉丝/激励/素材审核） |
| `/web/v1/kds/da/*` | 数据看板（积分消耗/成员参与/项目数据） |
| `/web/v1/op/*` | 运营（邀请码/兑换码/问卷/分销/每日奖励） |
| `/v1/rmdfsrv/*`、`/v1/rmaisrv/*`、`/v1/rmadminsrv/*` | 后端服务直连路径（rm = ReelMate） |
| `/v1/skymedia/*` | 天幕（SkyMedia）相关 |

### 异步任务模型（全平台统一）

```
POST /web/v1/ai/<capability>          → 创建任务（返回 task_id；部分入口挂腾讯验证码票据）
GET  /web/v1/task/{task_id}           → 轮询任务状态
GET  /web/v1/task/result              → 批量拉取结果（前端 usePolling 5s 间隔）
POST /web/v1/task/{task_id}/cancel|retry|regenerate|feedback|share
GET  /web/v1/task/workflow/retry      → 工作流级重试
SSE  /web/v1/agent/task/stream、/web/v1/df/canvas/:id/chat/sessions/:sid/stream
     /web/v1/agent/home/resource/sse   → 流式/实时推送
```

前端封装：`usePolling({retryInterval:5000})` + `EnumCancelToken`；任务状态用整数码（如 `[2,1]` 表示进行中，2=成功态判断逻辑见 `useVoiceClonePolling`）。

---

## 4. API 全景（统计与代表性端点）

去重后 **~700 个 `/web/v1` 端点**（完整清单见 `routes.txt`）。代表性分组：

**AI 能力（/web/v1/ai/）**：text-to-video、image-to-video、refer-image-to-video、refer-video-to-video、video-to-video、text-to-image、redraw-to-image、refer-image-to-image、image-super-resolution、image-batch-super-resolution、advanced-lip、text-to-audio、text-to-music、text-to-sfx、text-to-speech(+voice/list)、timbre(-category/list/collect)、voice-clone(+list/rename)、video-audio-separation、video-soundtrack、video-subtitle-erase、video-subtitle-voice-edit、video-super-resolution、video-convert、video-crop、fps-duration-unify、audio-slicing、audio-timbre-modify、face-recognition、identify-face、image-recognition、image-to-text、style-extraction、asset-match、prompt-optimize、check-language、point-calculate、world-generate、ip-template(-to-video)、file-sign-url、chat/completion、chat/session/*

**剧本工厂（/web/v1/df/）**：
- `novel/:nt_id/*`：小说导入→内容分析→世界观→章节大纲→分集大纲→核心角色→剧本生成→剧本编辑 Agent（sessions/apply/reject/apply_all/reject_all、版本 finalize）
- `fission_script/*`：二创裂变剧本（创意→大纲→角色→分集）
- `episode/:ep_id/*`：分集→解析(parse)→分镜(storyboard)→质量检查(quality-check)→合成导出(film-synthesis-export)
- `script_project/*`：剧本项目、广告剧（brief→script→storyboard→selling-point）、视频转绘、AI 短片 agent-start
- `canvas/:canvas_id/*`：无限画布（nodes/edges/groups/comment-nodes/heartbeat 协同锁/模板/批量任务/chat 会话流）
- `extraction/*`、`resources/*`：资产抽取（角色/场景/道具）与资产库、主体(subject)管理、seedance 审核状态
- `user_knowledge/*`：团队知识库（目录/标签/资产）
- `star-subject/*`、`3d-director/*`：IP 主体、3D 导演（姿态预设）
- `novel_market/*`：剧本集市（创作者作品/收益/提现/预售/协议；管理侧 rmadminsrv）

**影视版协作（/web/v1/film/projects/:id/）**：task-tables（可配置字段任务表格，仿多维表格）、cells、review+comments、canvas-bindings、exports、task-templates、notify-assignees

**商业与账号**：login/logout、weixin/token、email-captcha、mobile-captcha、captcha-check、buy/credits|vip|df-vip|sku-price、trade-order/latest、renew、subscribe、user/credits(-dashboard/flows/log)、redeem-code、op/invite-code*、op/daily-reward、op/distributor/*（分销）、op/questionnaire*、campaign/*、user-info、user-vip-info、user-settings、msg/exist-unread、text-sensidetect（内容敏感检测）

---

## 5. AI 模型聚合层（底层供应商映射）

源码中发现的模型标识符（`seedance2-optimize`、`kling_3.0` 等）：

| 能力 | 模型标识（节选） | 供应商 |
|---|---|---|
| 文/图生视频 | `seedance_1.0_pro(_fast)`、`seedance_1.5_pro`、`seedance_1.6(_fast)`、`seedance_2.0_mini`、`seedance_2.5`、`seedance_3.0`、`seedance_overseas_*`、`seedance2-optimize`、`seedance4` | 字节火山引擎 Seedance |
| | `kling_2.1`、`kling_2.5_std/turbo`、`kling_2.6`、`kling_3.0`、`kling_o1` | 快手可灵 |
| | `hailuo_02`、`hailuo_2.3(_fast)` | MiniMax 海螺 |
| | `vidu_q2`、`vidu_q3(_pro)`、`vidu_extend_q2pro` | 生数科技 Vidu |
| | `pixverse_v5` | 爱诗 PixVerse |
| | Wan 3.0（营销 banner："Wan 3.0 & Seedance 2.0 Fast 已接入工作流"）、wanx 字样 | 阿里通义万相 |
| | 天幕 2.0（工具页默认模型，"最优惠"）+ `/v1/skymedia/*` | 天幕 SkyMedia |
| 图像 | `qwen_imageedit2511_multidimensionalcamera`、`qwen_imageedit2511_scenemultiview9` | 阿里通义千问图像编辑 |
| LLM/剧本 | `Doubao18`（豆包 1.8，默认）、`deepSeek`、`sky_media.deepseek` | 字节豆包、DeepSeek |
| 音色 | voice-clone 全流程（采集→克隆→重命名→收藏），timbre 分类 | 多 TTS 厂商聚合 |

**架构启示**：该产品自研的是"生产流水线 + 一致性资产管理 + 编排"，模型层完全可替换（多供应商路由 + 成本/优惠标签 + `X-Model-Ver` 头做版本控制 + `point-calculate` 按模型计价）。

---

## 6. 鉴权与安全

- 登录方式（登录弹窗实测）：**微信扫码 / 手机验证码（默认）/ 密码 / QQ / Apple / 抖音**；可选**邀请码**；勾选协议后才能登录（未注册手机号自动建号）
- Token：`localStore.getTokenInfo()` → `{uid, access_token, master_access_token(团队主账号)}`
- 请求头：`Authorization: <access_token原始值>`（无 Bearer 前缀）+ 动态头 `X-Prod-Id`（产品 20438）、`X-Lang`、`X-Space-Id`（工作区/团队空间）、`X-User-Id`、`X-Prod-Ver`、`X-Model-Ver`、`X-Op-User-Id`、`X-Module-Action`、`X-Client-Sn`
- 风控：生成类端点挂**腾讯云验证码**票据（`X-Captcha-Ticket` + `X-Captcha-Randstr`）；`/web/v1/captcha-check`；内容安全走 `text-sensidetect` + 模型侧审核（seedance-review-status）
- 多标签登录态同步：`ensureAuthBroadcastSetup()`（BroadcastChannel 类机制）
- AI 生成结果页带合规声明"内容由AI生成，请仔细甄别"（生成内容标识合规）

---

## 7. 商业化体系

- **积分（Points/Credits）**：按模型/操作计价（`point-calculate`、`node-point-calc`、`point` 端点遍布各域）；积分流水/看板/团队配额分配与回收（cam/team/points-*）；负债列表（credits-dashboard/debt-list，火山引擎后结算模式 `volc-query`）
- **订阅**：VIP / DF-VIP / 连续包月；"1080P 低至 0.2 元/秒"（按时长计价营销）；sku-price 动态价格
- **兑换码/邀请裂变/每日奖励/分销（distributor）** 全套运营工具
- **剧本集市**：创作者上架小说/剧本 → 预售/协议 → 收益/提现（platform 侧还有 admin 审核流）
- **创作者投稿激励**：奖金池活动（campaign）

---

## 8. 核心业务流程（从端点反推）

### 主流水线：小说 → 漫剧
```
导入小说(split 解析) → 内容分析(世界观/角色卡) → 章节/分集大纲 → 核心角色生成
→ 剧本生成(script-generate) → 剧本编辑Agent(会话式 diff 修改, apply/reject)
→ 分集(episode) → 解析 → 分镜(storyboard, 批量AI生图/生视频)
→ 资产抽取与匹配(extraction/asset-match, 角色/场景/道具一致性)
→ 资源批量生成(resources/batch-generate) → 质量检查(quality-check)
→ 合成导出(film-synthesis-export / storyboard-export) → 成片
```
每一步都有：任务化、重试、版本(versions/restore)、审核(review)、积分扣减。

### 协同与效率
- 无限画布（X6）：节点=生成步骤，chat 会话绑定节点（message→node-binding），心跳锁（heartbeat/lock）做协同编辑，模板/组合复用
- 影视版：仿多维表格任务表 + 字段自定义 + 审核评论 + 画布绑定，面向团队规模化生产
- 知识库：团队级素材/设定沉淀（dir/tag/asset）

---

## 9. 复刻路线图建议（自建同类产品）

> ⚠️ 合规前提：以上为**行为与架构层面的观察**。复刻时必须独立编写代码、自建设计与文案、不复制其前端代码/美术素材/品牌元素，接口协议自行设计；模型调用遵守各供应商商用条款。

### MVP（4~8 周量级）
1. **技术底座**：Nuxt 3 + Vue 3 + Pinia + TailwindCSS/自建组件；API 网关（Node/NestJS 或 Go）+ PostgreSQL + Redis + 对象存储（OSS/S3）
2. **统一任务系统**：`task` 表（type/params/status/progress/result/credits_cost）+ 队列（BullMQ/异步 Worker）+ `GET /task/:id` 轮询 + SSE 推送 —— 这是全产品的脊柱
3. **模型聚合层**：先接 1~2 家视频（如 Seedance/可灵）、1 家图像、1 家 TTS；适配器模式 + 按模型计价表
4. **单点工具箱**：文生视频/图生视频 + 生成历史（我的资产）+ 积分系统
5. **账号**：手机验证码 + 微信扫码；腾讯云验证码防刷

### 第二阶段（差异化）
6. **剧本流水线**：小说解析→大纲→角色→剧本（LLM 编排，结构化中间产物存档）
7. **资产一致性**：角色/场景库 + 参考生图（多图参考）、资产-分镜匹配
8. **分镜与批量生成**：分镜表 + 批量任务 + 失败重试
9. **无限画布**：AntV X6 节点编辑器 + 节点即任务 + 会话绑定节点
10. **剪辑合成**：Vidstack 预览 + 时间线（或接 ffmpeg/云剪辑）+ 配音/字幕/音效

### 第三阶段（商业化与团队）
11. 团队/空间/成员权限 + 团队积分池；影视级任务表格协作
12. VIP 订阅 + 支付（微信/支付宝）；创作者中心与激励
13. 合规：AI 生成内容标识、敏感内容检测、算法备案/深度合成备案、ICP

---

## 10. 遗留未知项（登录后深挖结果见第 12 节）

已解决（详见第 12 节运行时证据附录）：
- ✅ 任务创建请求体/失败响应（12.3）
- ✅ 画布节点类型全集与参数模式（12.5，CLI node.md）
- ✅ 计价体系与 VIP SKU（12.2）
- ✅ MCP/CLI 对外协议（12.7，Agent Skill 包全量文档）

仍未知（需真实消耗积分或更深交互）：
- 生成**成功响应体**结构（task_id 字段名、进度事件格式、结果 URI 结构）——账号积分为 0，创建请求已在服务端校验前被计费拦截；充值后一次成功生成即可补齐
- ReelFlow 剪辑器 `timeline` JSON 的完整 schema（clip 节点参数已有，时间线细节待实操）
- 影视版任务表格的字段类型系统（task-tables fields）
- SSE 流式消息的完整事件类型表（已确认 event:/data: 协议形态）

---

## 12. 运行时证据附录（登录后实测，2026-10-24）

> 以下为登录态下的实测抓包（Playwright scenario + 网络体捕获）与 CLI Skill 包分析。
> ⚠️ `net*.json`、`api-log-decoded.txt` 曾包含本机会话 token，已做 `[REDACTED]` 脱敏；请勿将原始抓包外传。

### 12.1 账号与鉴权（实测）

- 登录走**万兴统一账号 SSO**：`accounts.wondershare.cn/v3/user/oauth-client/authorize` → 回调 `/web/v1/callback/login`。登录方式：微信/手机验证码/密码/QQ/Apple/抖音（弹窗实测）。
- **短效 token 自动续期**：`GET /web/v1/renew` 返回 `{sign_in, uid, access_token, expires_in≈1985s(33min), space_id, master_access_token, master_expires_in, drive_pid:20438}`——双 token（个人/团队主控），前端定时静默续期。
- `GET /web/v1/user-info` → `{uid, nickname, avatar, vip_info{feature_code,credit_total,expire,team_credit_total}, invite_passed, is_cn_user, region:"CN", data_center:"sz", space_id, watermark_cfg, legal_notice}`。
- 团队权限：`GET /web/v1/cam/permission/user` → `role_code:"master", role_level:1, team_info{...}`（个人空间为空团队）。

### 12.2 计费与定价（实测）

- **积分充值（10积分=1元）**：¥50→500 / ¥100→1000 / ¥300→3000 / ¥600→6000（`buy/credits`）。
- **VIP 年卡（df-vip，sku_tag=reelmate-premium）**：¥200→2000分 / ¥1000→10000分 / ¥5000→51000分(+4555赠) / ¥10000→103000分(+赠)；购买走 `store.wondershare.com` checkout（sku_id+verify 签名 URL）；团队档活动价低至 1积分≈0.086元。
- **单次计价**：`POST /web/v1/ai/point-calculate` 请求 `{alg_code:"text_to_video", params:"<JSON字符串>"}`；响应 `{points_code:"tm_text2video_5s_720p", cost:8, credit_original:8, credit_discount:1, ...}`。文生视频 5s/720p = **8积分**。
- 0 积分提交生成：`POST /web/v1/ai/text-to-video` → `{"code":745701,"msg":"Insufficient Balance"}` → 前端跳转 /pricing（团队购买/个人订阅双 tab，Seedance 各档按秒标价 0.25~2.27 元/秒）。

### 12.3 任务创建契约（实测请求体）

```json
POST /web/v1/ai/text-to-video
{
  "idle": 0,
  "track_data": "{\"source\":\"direct link\",\"workplace_type\":\"professional mode\"}",
  "refreshId": 0,
  "prompt": "…", "referencePrompt": "",
  "mirror_control": {"mirror": ""},
  "resolution": "720p", "duration": 5, "ratio": "16:9",
  "qty": 1, "add_bgm": false,
  "currentTag": "ttv", "module": "itv",
  "ai_model_mark": "tomoviee_2.0",
  "user_data": "<表单全量快照JSON字符串，含 mouth_drive 等UI状态>"
}
```
- 请求前先过**腾讯云无感验证码**：`turing.captcha.qcloud.com/cap_union_new_verify` → 票据放入 `X-Captcha-Ticket` + `X-Captcha-Randstr`。
- 五个视频端点（text-to-video / image-to-video / refer-image-to-video / video-to-video / refer-video-to-video）共用此模式。
- 任务列表：`GET /web/v1/task?page=1&page_size=5&request_type=task_list`；未读消息用**长轮询**（`msg/exist-unread`，超时返回 code 741001）。

### 12.4 文件存储（实测）

- 阿里云 OSS：`alisz-reelmate-storage.oss-cn-shenzhen.aliyuncs.com`；object_key 形如 `pcloud/<uid>/<biz>/<yyyymm>/…`。
- 下载走预签名：`POST /web/v1/ai/file-sign-url {object_key, expire:86400}` → `{sign_url}`。

### 12.5 无限画布（实测 + 编辑器源码）

- 画布节点类型（CLI 文档 `node.md`，共 11 种）：`text, image, video, audio, table, script, asset, clip, director, threeDWorld, group`。
- image 节点 `mode`：text2image / image2image / multi_reference / upscale / crop / outpaint / inpaint / erase / panorama / multi_angle_360 / panorama_360 / lighting / multi_camera_grid_9 / story_grid_4|9|25。
- video 节点 `mode`：text2video / image2video / first_frame / first_last_frame / video_reference / universal_reference / video_extend / video_clip / video_upscale / de_subtitle_auto|region / frame_capture / video_edit。
- `settings`: ratio(16:9/9:16/1:1/4:3/3:4), resolution(480p/720p/1080p/2K/4K), duration, enableSound, mouthDrive, shotType, offPeak(错峰), fps。
- audio 节点 `audioKind`: voiceover / music / sfx / ambient；script 节点 `runPhase`: storyboard | asset_match；asset 节点 `activeTab`: character/scene/prop；clip 节点带 `timeline` JSON 与导出设置（canvas/local, mp4/webm）。
- 并发控制：**画布版本冲突**（exit 9）与**节点锁竞争**（exit 10）；写操作支持 `--idempotency-key` 幂等键；心跳锁 API（`nodes/:id/lock|unlock|heartbeat`）。
- 画布 Agent 技能卡（`df/canvas/agent-recommend-cards`）：`{recommend_id, title, description, preset_prompt, skills[{skill_id, skill_name_en:"wuxia-one-line-film-director"…}], tag_label:"一键成片"}`。

### 12.6 模型目录架构（CLI Skill `_models.md`）

- 模型记录含：`visible`、`supported_modes`、`mode_order`、`params.generation.<mode>`（含 ratios/resolution_options/default_resolution）、场景过滤键 `studio_asset_image`（资产生图）、`script_to_scene_refer`（剧本拆分镜）、`storyboard_reference_video`（分镜生视频）。
- 自营模型线：**ToMoviee 2.0**（= SkyMedia 天幕，`tm_` 计价前缀、`sky_media.*` i18n 键），图像线 **TGI 2.x**（如 TGI 2.5 Flare），文本线 **TG Chat 5.5**（画布生剧本专用）。
- 推荐规则：画布视频/分镜推荐 "Seedance 2.0 VIP"；资产生图推荐 "TGI 2"；目录实时查询（`model list/search`），文档不维护静态对照表。
- 分辨率 label 与提交值分离（`720p_sale` → 展示"720P优惠版"）。

### 12.7 MCP & CLI = Agent Skill 包（`/cli` 页面实测 + 包分析）

- 分发：`https://cc-download.wondershare.cc/reelmate_cli_skill_20438.zip`（Claude Code 式 Skill 包，含 SKILL.md 路由协议）。
- **38 个命令组**：account/ad/agent/ai/asset-lib/canvas/clip/credits/deeplink/edge/episode/export/file/group/login/market/material/model/node/novel/pin-group/redraw/resource/script/storyboard/subject/sync-fm/task/team/upload/version/voice/workflow/workspace…
- **两大场景**：制片工坊（四环节：建项目→导入剧本→资产生成→拆分镜出片；支持 Excel 回填：资产提示词表/分镜三列表）与无限画布（一句话生剧本/生图/生视频）。
- 工程协议：`--json` envelope `{ok,data,links}`；进度走 stderr；阶段机+HITL 呈现协议+完成门禁（HARD-GATE）；退出码分类学（3=鉴权 4=任务失败 7=积分不足→deeplink pricing 8=内容审核 9=画布版本冲突 10=节点锁）。
- 剧目类型：国内/海外仿真人剧、2D/3D 动漫；画幅 9:16 / 16:9。

### 12.8 可观测性与基建

- 错误监控：Sentry（`o4506505263644672.ingest.us.sentry.io`）。
- 埋点：万兴自建 `analytics.wondershare.cc:8106`（web_logs + abtest_results，appkey=47hoo7h0phujgyqmgbcvq790）+ 神策 + GTM。
- AB 实验：`GET /web/v1/op/abtest/hit` 返回新用户权益开关（BENEFIT_CREATE_EPISODE/BENEFIT_EXTRACT_ASSET_LIST/BENEFIT_GEN_ASSET_PROMPT/BENEFIT_MATCH_SUBJECT/BENEFIT_SPLIT_SHOT）。
- 团队级模型开关矩阵：`cam/team/temp-info`（seedance_is_support/sd_480p/tsd 等布尔位）。
- 配置中心：`GET /web/v1/config?key=<key>&module_name=<20438|sys|web>&lang=<lang>`（页面初始化、定价头图、模型引导、任务反馈标签等均走此接口）。


### 12.9 官方 CLI 只读命令实测（零积分拿到真实响应）

CLI：`npm i -g @wondershare-plugins/reelmate-cli@1.0.5`（公开 npm 包），`reelmate login` 走万兴 SSO 浏览器授权 + loopback 回调，凭据落盘（credentialStore=file）。

- **模型目录（46 个模型，`model list --json`，76KB 结构化数据，存 `cli-out/model-all.json`）**：每个模型含 `display_name/need_vip/description/logo/mode_order/params.generation.<mode>`；mode 内含 `endpoint`、`ratios`、`durations[4..30]`、`default_duration`、`resolution_options[]`（label 与提交值分离）、`counts`。三大自营线：TG Chat 5.5（文本）、TGI 2.x/天幕写实版/TNB（图像，含 `studio_asset_image` 场景键）、天幕 2.0/2.1 + ToMoviee（视频）；聚合线：Seedance 2.5/2.0 VIP/2.0 mini、Wan 3.0/2.6/2.5、MiniMax H3、Happy Horse 1.0/1.1、可灵 O3/3.0/2.6/2.5/O1/2.1、Vidu Q2/Q3-Pro、即梦 4.0~5.0Pro/3.5Pro、Hailuo 2.0~2.3、TS 2.0、TV 3.1、Gemini 3.1 Pro Preview、DeepSeek V4 Pro。
- **AI 网关去重后仅 8 个生成端点**：text-to-image、text-to-video、image-to-video、refer-image-to-image、refer-image-to-video、refer-media-to-video、video-to-video、refer-video-to-video——模式差异全部通过参数表达，不靠 URL 膨胀。另有场景键 `studio_asset_image`/`script_to_scene_refer`/`storyboard_reference_video` 各自带 endpoint。
- **CLI envelope（真实成功响应）**：`{ok:true, data, links:[]}`；失败 `{ok:false, error:{code, kind:"auth|usage|...", message, hint, raw, retryable}}`。分页 envelope：`{data:{count, count_known, has_more, list, page, page_size}, links, ok}`。
- 积分余额：`credits balance --json` → `{data:{expire_soon_val, give_val, recharge_val, team_assigned_val, team_credit_total, total_val, vip_val}}`。
- 结果拉取走多区域数据面：`domainMap={sz:"https://api-conn.reelmate.cn", eus/eop/sgp:"https://api-conn-*.reelmate.ai"}`（`POST /web/v1/task/result`，按 user-info 的 data_center 路由）。
- 前端轮询引擎（core-lib 反编译）：`useTaskPolling` 5s 间隔批量 `handleTaskResult({task_type, pid, task_ids})`；状态机 pending→running→done/timeout；任务完成后 debounce 刷新积分。

## 13. 附件清单（E:\wanxing\rea-reelmate\）



| 文件 | 内容 |
|---|---|
| `bundle.json` | 首页 bundle 抓取（含 133 个脚本指纹，598KB） |
| `capture_page.json` / `page.json` | 页面完整捕获（含脚本源码，3.2MB） |
| `scripts/` | 导出的 133 个 JS 源文件 + manifest |
| `appgraph.json` | 离线 JavaScript 应用图（63MB） |
| `routes.txt` | 去重路由/端点 928 条 |
| `home.png` / `tools.png` / `t2v.png` / `flow.png` / `pricing.png` | 关键页面截图 |
| `login-modal2.png` | 登录弹窗（全登录方式） |
| `scenario-login*.json` | Playwright 场景证据 |
| `net1.json` / `api-log.json` / `api-log-decoded.txt` | 首页/t2v/定价/工具箱 21 端点抓包（已脱敏） |
| `net3.json` | 任务创建契约抓包（t2v 完整请求体 + Insufficient Balance 响应） |
| `net-canvas.json` / `net-node.json` / `net-explore.json` | 画布/CLI 页抓包（renew 短效 token / file-sign-url / agent-recommend-cards） |
| `scripts-canvas/` | 画布编辑器 473 个源文件（9.8MB） |
| `reelmate_cli_skill.zip` / `cli-skill/` | 官方 Agent Skill 包（SKILL.md + 38 命令组 + 模型目录 + 错误码 + 工作流手册） |
| `canvas.png` / `node.png` / `x4.png` | 画布空态 / 画布引导 / CLI 页截图 |
| `gen-attempt.png` | 0 积分生成跳转定价页截图（含 Seedance 按秒价目） |

> ⚠️ 所有 `net*.json` 抓包文件中的会话 token 已替换为 `[REDACTED]`；如需重新分析原始响应请重新抓取，勿外传旧文件。
| `cli-out/` | CLI 只读命令真实响应（credits-balance / model-all(76KB) / model-video / model-image / task-list / canvas-list） |
| `model-catalog-summary.json` | 46 模型 × 模式 × 端点 × 参数枚举 结构化摘要 |
