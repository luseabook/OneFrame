# 竞品产品逻辑与业务逻辑（REA 逆向，只读）

> 证据来源：本机已捕获的竞品前端产物 + 只读接口日志（**未打开、未登录、未点击竞品**）
> 分析工具：REA（analyze_javascript_application / 语义图）+ 静态提取 + 已捕获 api-log
> 日期 2026-11-02 · 基线 HEAD a150ff3

## 0. 一句话结论

竞品不是"一堆页面"，而是**一条五步流水线 + 一套可编排的 AI 能力矩阵**（并额外做了一个剧本交易市场）：

剧本创作(Script) → 剧集/分镜(Series) → 生成(11 种模式 × 46 个模型) → 素材/资产(Asset/Subject) → 剪辑/导出/分享(ReelFlow/Share)。

侧栏只暴露 6 个主入口 + 团队 2 项 + 底部 4 项，**其余能力都挂在页面内的 tab / 弹窗 / 工作台里**；
每个入口都有明确的隐藏条件（权限 playwriting.view、roleLevel、isAnyAdmin、影视版开通、CLI 开关）。

## 1. 方法与证据

| 项 | 内容 |
|---|---|
| REA 应用图 | REA analyze_javascript_application 于 E:/wanxing/rea-reelmate/scripts（133 个 JS、2.67MB、61,071 findings；evidence ev_e3f9fc29…d148c） |
| 侧栏定义 | C_zfNpOW.js：menuListOrderPc（9 项）+ sidebar-extra（4 项） |
| 路由表 | 从 bundle 提取 1,191 条 path（含 br/en/es/ja 前缀）；349 组 name→path |
| 接口 | api-log-decoded.txt（110 次请求 / 21 个唯一端点）+ net*.json（1,459 条网络） |
| 模型目录 | model-catalog-summary.json（46 个模型 / 11 种模式） |
| 截图 | rea-reelmate/*.png（登录前后）+ 用户提供的竞品剧本创作页截图 |

## 2. 产品逻辑

### 2.1 账号 / 空间 / 权限模型

来自 user-info、cam/permission/user、cam/team/temp-info、func-whitelist：

- 账号：uid + uid 区分的 region/data_center（CN/SZ）+ is_cn_user + invite_passed；
- 会员：vip_info(feature_code / credit_total / expire / team_credit_total)，即**会员与积分两套账**；
- 空间：space_info（空间级额度）+ cam/team/temp-info（团队/临时团队），团队有独立积分池；
- 权限点：**playwriting.view**（剧本创作可见性）等，侧栏按 hasPermission 隐藏；
- 角色：roleLevel（>1 隐藏工具箱）、isAnyAdmin（非管理员看不到团队管理）；
- 灰度：op/abtest/hit 返回 benefits 与 func-whitelist，前端据此开关功能块。

### 2.2 信息架构（PC 侧栏，逐项含隐藏条件）

| 顺序 | i18n key | route name | path | 可见条件（代码原文语义） |
|---:|---|---|---|---|
| 1 | menu.home | Home | / | 恒显示 |
| 2 | menu.filmCreation | FilmCreation | /film-creation | 仅登录 + CN 区 + 影视版已开通 |
| 3 | menu.scriptCreate | Script | /script-manage | 登录且**无 playwriting.view 权限时隐藏**；loginGated |
| 4 | menu.creationAgent | CreationAgent | /creation-agent | 恒显示 |
| 5 | menu.allProjects | Series | /series-manage | 恒显示 |
| 6 | menu.ai_toolbox | Tools | /tools | 登录且 **roleLevel>1 时隐藏**；loginGated |
| 7 | menu.teamSection | （group） | — | 分组标题"团队" |
| 8 | menu.knowledgeBase | TeamKnowledgeBase | /team/knowledge-base | 恒显示 |
| 9 | menu.teamManage | team | /team | 登录且**非管理员时隐藏**；loginGated |

底部 sidebar-extra（同一组件 C_zfNpOW.js）：

| 项 | 行为 | 条件 |
|---|---|---|
| menu.filmEdition 影视版（badge=申请内测） | **按钮**（打开开通/申请弹窗），不是链接 | film 未开通时显示 |
| menu.mcpCli | **按钮**，打开 CLI 能力面板 | isHeaderCliShow 为真 |
| 活动 | 组件（弹层） | 有活动配置时 |
| menu.operationsAssistant 运营助手 | 悬浮弹层（data-testid=sidebar-operations） | 恒显示 |

> 与用户提供的**最新**竞品截图存在一处冲突：截图里"团队"分组是**资产库 + 团队管理**，而 10-24 抓到的 bundle 是**知识库 + 团队管理**。
> 结论：产品在 10-24 之后调整过侧栏；**以最新截图为 IA 事实**，以 bundle 为"实现机制"证据（权限/隐藏条件仍然适用）。资产页 /asset 与 /user-assets 都存在，只是入口位置随版本变化。

### 2.3 路由族（349 组 name→path，节选）

| name | path | 说明 |
|---|---|---|
| Home | / | 首页 |
| Script | /script-manage | 剧本创作（**带 query tab=market 进入剧本广场**） |
| Dfaft / script-view | /script-view/:id() | 剧本正文/改稿 |
| CreationAgent | /creation-agent | 创作 Agent |
| Series | /series-manage | 全部项目（剧集工作台） |
| SeriesDetail | /series-manage/:id() | 项目工作台 |
| Episode | /series-manage/episode/:id() | 单集 |
| AssetExtract / AssetConfirm | /series-manage/asset-extract、/series-manage/asset-confirm | 资产抽取 / 确认 |
| Assets / userAssets | /asset、/user-assets | 资产库 / 我的资产 |
| Tools | /tools | 工具箱 |
| ReelFlowList / ReelFlowEdit | /reelflow/list、/reelflow/edit/:projectId() | 剪辑台列表 / 编辑器 |
| FilmCreation / Film | /film-creation、/film | 影视版 |
| Cli | /cli | MCP & CLI |
| TeamKnowledgeBase | /team/knowledge-base | 团队知识库 |
| team | /team | 团队管理 |

其它页面族：creat/*（17 个单点工具）、canvas、agent(/agent, /agent/editor, /agent/bigscreen)、ad-drama、video-redraw、activities 与 activity/*、channel/education*、creator-center/*、partner*、novel-market/*、视频转绘、refer-video、video-effects。

### 2.4 页面内结构（关键 tab / query）

- /script-manage?tab=market：剧本创作页内切到"剧本广场"（我们的菜单落地页现在是自建 /script，需按这个语义分 tab）；
- /script-manage 的默认 tab 是创作输入（hero + 灵感建议），与"我的剧本"并列；
- /series-manage 内嵌 episode / asset-extract / asset-confirm 三个视图（与我们的 projects/[id].vue 内嵌视图同构）；
- /reelflow/edit 为独立编辑器（时间线 + 发布切片），项目页只做预览。

## 3. 业务逻辑

### 3.1 主流水线（五步）与"首次免费"权益

/web/v1/op/abtest/hit 返回 benefits，恰好对应流水线五步：

| 权益 | 对应步骤 | 说明 |
|---|---|---|
| BENEFIT_CREATE_EPISODE | 建集（剧本 → 剧集） | 首次免费 |
| BENEFIT_EXTRACT_ASSET_LIST | 资产抽取 | 首次免费 |
| BENEFIT_GEN_ASSET_PROMPT | 资产生成提示词 | 首次免费 |
| BENEFIT_MATCH_SUBJECT | 主体/资产匹配 | 首次免费 |
| BENEFIT_SPLIT_SHOT | 拆分镜 | 首次免费 |

即：**竞品的"首次免费"不是营销话术，是 AB 权益位**，五个权益各自可被灰度关闭。我们目前没有等价的服务端权益计数（U5 报告已如实登记）。

### 3.2 计费模型

- 积分账户四桶：total_val / vip_val / recharge_val / give_val（+ expire_soon_val 过期预警），团队另有 team_credit_total / team_assigned_val；
- 报价：POST /web/v1/ai/point-calculate，入参含 alg_code（如 text_to_video）、params（resolution/duration/ratio/qty/add_bgm/ai_model_mark…），返回 points_code（如 tm_text2video_5s_720p）、cost、credit、credit_original / credit_discount；
- 实测样例：text2video、720p、5s、16:9、qty=1 → cost=8；**报价是服务端算的，前端只展示**；
- 会员：GET /buy/df-vip 返回 SKU（示例 200 元/年，renew_price 200），46 个模型里 **20 个 need_vip**；
- 充值：GET /buy/credits（积分包）；GET /renew（续费）。

### 3.3 生成模式矩阵（11 modes → 后端端点）

| 模式 | 端点 | 用途 |
|---|---|---|
| text2video | /ai/text-to-video | 文生视频 |
| image2video | /ai/image-to-video | 图生视频 |
| first_frame | /ai/image-to-video | 首帧生视频 |
| first_last_frame | /ai/image-to-video | 首尾帧 |
| universal_reference | /ai/refer-image-to-video、/ai/refer-media-to-video | 参考生视频（图/媒体） |
| video_edit | /ai/refer-video-to-video | AI 改视频 |
| video_extend | /ai/video-to-video | 视频延长/续写 |
| text2image | /ai/text-to-image | 文生图 |
| studio_asset_image | /ai/text-to-image | 影棚资产图 |
| image2image | /ai/refer-image-to-image | 图生图 |
| multi_reference | /ai/refer-image-to-image | 多参考图 |

每个模型的 modes 里还带 ratios / resolutions / counts / default_resolution，前端参数面板由**模型目录驱动**，不是写死。

### 3.4 任务与异步

- GET /web/v1/task（任务列表/轮询）；生成/导出都是异步任务，前端按 task id 轮询；
- 导出：/reelflow 的 timeline export + 发布切片（转码 status 1→2→3/4）；
- 长轮询：/web/v1/msg/exist-unread 返回 741001 long polling timeout（消息通道）。

### 3.5 资产与主体

- 资产库 /asset 与 /user-assets 并存：前者是"空间资产库"，后者是"我的资产"；
- 主体（subject）：POST /web/v1/subject/resource/list 拉主体库；
- 项目内资产：asset-extract（抽取）→ asset-confirm（确认）→ match-subject（匹配到分镜）。

## 4. 与本项目范围的关系（D5）

D5（2026-11-02 用户拍板）：**本项目只要竞品的创作能力**——把生成能力通过第三方 API 接进我们自己的产品；
**交易域（剧本广场/买断/分成/提现/剧本集市）不做**。因此下文的"8 条产品线"在本项目收敛为 7 条：
短剧主线 / 无限画布 / 影视版 / 广告剧 / 视频转绘 / 单点工具 / 创作 Agent（**去掉剧本市场**）。

## 5. 与我们侧的差异（高层，明细见 menu-map-audit.md）

| 维度 | 竞品 | 我们 |
|---|---|---|
| 侧栏主项 | 6 项（含影视版创作，未开通隐藏） | 5 项（影视版只在底部） |
| 团队分组 | 资产库 + 团队管理（最新截图） | 资产库 + 团队管理 ✅ |
| 知识库 | 旧版在团队组；最新截图未见 | 在"更多创作"折叠组 |
| MCP & CLI | 可点按钮，受 isHeaderCliShow 控制 | 置灰 span，无 /cli 页（台账 #55 ❌） |
| 剧本创作 | /script-manage（hero + 广场 tab + 我的剧本） | /script（U9 新建，结构同构） |
| 首次免费 | 服务端 AB 权益位（5 个 BENEFIT_*） | 无服务端权益计数（U5 登记） |
| 计费报价 | point-calculate 服务端算价 + points_code | /credits/quote/batch（同思路，粒度不同） |
| 模型驱动参数 | 模型目录驱动（modes/ratios/resolutions/counts） | 同样由模型目录驱动（scene_modes），但参数面更窄 |
| 权限隐藏 | playwriting.view / roleLevel / isAnyAdmin | 无等价权限点（团队权限模型不同） |

## 6. 未知项（不猜，保持 ⏳）

1. 各权益（BENEFIT_*）的具体免费次数与触发条件——需要真实账号的计费流水；
2. 侧栏最新版本是否已把"知识库"移出（截图与 10-24 bundle 冲突）；
3. 剧本创作页各 tab 的动态态（生成中、我的剧本有数据、筛选结果）；
4. 移动端/窄屏的侧栏形态（未取证）；
5. /cli 打开后是页面还是弹层（bundle 里是按钮 + isHeaderCliShow，未见路由跳转）。
