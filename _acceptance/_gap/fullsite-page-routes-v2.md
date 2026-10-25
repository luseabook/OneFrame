# 页面路由清单 v2（参照产品 ReelMate 全站）

> 2026-10-26（F0.6）。用途：**全站 1:1 的覆盖核对表**。
> 依据：`rea-reelmate/routes.txt` 逐行解析（102 条页面路由，行号已核对）＋ `rea-reelmate/net-explore.json`（实测访问 `/mcp`）＋ `rea-reelmate/REELMATE-逆向分析报告.md:27-54`。
> ⚠️ **`routes.txt` 不完整**：不含 `/mcp`（但 `mcp.png` 存在、`net-explore.json` 有 `mcp`/`mcp-wait` 步骤）。仅按它做覆盖会漏页（详见 §3）。

## 0. 口径与总数

| 项 | 数 | 说明 |
|---|---|---|
| `routes.txt` 非空行 | **927** | 另有 1 空行 → 文件 928 行 |
| API 路径常量 | **821** | 801 `/web/v1/*` + 20 `/v1/*`（直连 rmdfsrv/rmaisrv/rmadminsrv/skymedia） |
| **页面路由** | **102** | 行号：2–99（98 条）+ 120–122（3 条）+ 924（1 条） |
| 裸 token | 4 | `assets`/`members`/`produce`/`tasks`（疑似截断产物，语义未确认，不计入） |
| 手工补录 | **+1** | `/mcp`（实测存在但未收录） |
| **复刻核对总数** | **103** | 102 + 1 |

## 1. 按模块分组（102 条，行号可回溯）

标记：`✅` 我方已有对应实现 ｜ `🔶` 有近似实现但形态/语义不同 ｜ `❌` 无 ｜ `❓` 参照侧功能未取证

### 1.1 根与工具性路由（10）

| 路由 | 行 | 我方 |
|---|---|---|
| `/` | 2 | ✅ `pages/index.vue`（未登录落地）/ 登录后工作台亦在此 |
| `/:path(.*)*` | 3 | ✅ Nuxt 兜底 |
| `/register/public-beta-invite` | 77 | ❓ 公测邀请注册 |
| `/redirect/:action()` | 73 | ❓ |
| `/redirect-callback/:action()` | 72 | ❓ |
| `/route-permission-map` | 78 | ❓ |
| `/api/user/logout` | 17 | 🔶 我方 `POST /v1/auth/logout` |
| `/tutorial` | 94 | ❓ |
| `/mobile-landing` | 61 | ❓ 移动端落地 |
| `/share-land` | 87 | 🔶 我方 `pages/share/[token].vue` |

### 1.2 账号与设置（7） — 全部无截图

| 路由 | 行 | 我方 |
|---|---|---|
| `/profile` | 70 | 🔶 `pages/settings.vue` |
| `/setting` | 86 | 🔶 同上 |
| `/user-center` | 96 | 🔶 同上 |
| `/user-settings` | 98 | 🔶 同上 |
| `/user-language` | 97 | ❌（多语言，F6） |
| `/user-update` | 99 | ❓ |
| `/adjust` | 13 | ❓ |

### 1.3 定价（1）

| 路由 | 行 | 我方 |
|---|---|---|
| `/pricing` | 69 | ✅ `pages/pricing.vue`（FAQ/页脚未取证） |

### 1.4 工具箱 `/create/*`（17）— 我方仅 2

| 路由 | 行 | 工具（slug 直译，界面名未取证） | 我方 |
|---|---|---|---|
| `/create/text-to-video` | 36 | 文生视频 | ✅ |
| `/create/image-to-video` | 28 | 图生视频 | ✅ |
| `/create/lip-sync` | 29 | 视频对口型 | ❌ |
| `/create/reference-to-video` | 30 | 参考生视频 | ❌ |
| `/create/video-refer` | 40 | 视频参考 | ❌ |
| `/create/video-upscale` | 41 | 视频超清 | ❌ |
| `/create/video-extend` | 39 | 视频续写 | ❌ |
| `/create/video-edit` | 37 | 视频编辑 | ❌ |
| `/create/video-effects/effect` | 38 | 视频特效 | ❌ |
| `/create/image-to-image` | 27 | 图生图 | ❌ |
| `/create/text-to-image` | 32 | 文生图 | ❌ |
| `/create/brush-repaint` | 26 | 涂抹重绘 | ❌ |
| `/create/text-repaint` | 31 | 文字重绘 | ❌ |
| `/create/text-to-speech` | 35 | 文生语音 | ❌ |
| `/create/text-to-music` | 33 | 文生音乐 | ❌ |
| `/create/text-to-sound` | 34 | 文生音效 | ❌ |
| `/create/auto-bgm` | 25 | 自动配乐 | ❌ |

### 1.5 项目 / 剧集 / 剧本（9）

| 路由 | 行 | 我方 |
|---|---|---|
| `/series-manage` | 81 | 🔶 `pages/works.vue`（项目总览，形态不同） |
| `/series-manage/:id()` | 82 | 🔶 `pages/projects/[id].vue` |
| `/series-manage/episode/:id()` | 85 | ✅ 单集分镜工作台（P1 已复刻，内嵌于 `projects/[id]`） |
| `/series-manage/asset-confirm` | 83 | ✅ 资产校验页（P6，内嵌） |
| `/series-manage/asset-extract` | 84 | ✅ AI 提取资产（P3，内嵌） |
| `/episode-list` | 51 | ❌ 未取证 |
| `/script-manage` | 79 | ❌ 抓图为空屏 |
| `/script-view/:id()` | 80 | ❌ 未取证 |
| `/short-film/:id()` | 88 | ❓ 未取证 |

### 1.6 小说改编 / 创作 Agent（9）

| 路由 | 行 | 我方 |
|---|---|---|
| `/novel-market/:id()` | 62 | ❌ 剧本集市（novel_market 域） |
| `/novel-to-script/:id()` | 66 | ❌ |
| `/novel-to-script-agent/:id()` | 63 | ❌ |
| `/novel-to-script-agent/create` | 64 | ❌ |
| `/novel-to-script-agent/workbench` | 65 | ❌ |
| `/creation-agent` | 42 | ❌ 对话式创作（SSE） |
| `/agent` | 14 | ❌ |
| `/agent/bigscreen` | 15 | ❌ |
| `/agent/editor` | 16 | ❌ |

### 1.7 剪辑 / 画布 / 3D / CLI（9）

| 路由 | 行 | 我方 |
|---|---|---|
| `/reelflow/list` | 75 | ✅ `pages/projects/index.vue`（已对齐） |
| `/reelflow/edit/:projectId()` | 74 | ✅ 时间线编辑器（P4.1/P7，内嵌于 `projects/[id]`） |
| `/canvas` | 20 | ❌ 仅空态截图；`canvas*` 表 0 张 |
| `/workflow-canvas` | 924 | ❌ 未单独取证 |
| `/director` | 48 | 🔶 `Director3D.vue`（组件，非独立页；无后端域） |
| `/director/:projectId()` | 49 | 🔶 同上 |
| `/cli` | 24 | ❌（有截图 `cli.png`/`x4.png`） |
| `/implement` | 59 | ❌ 未取证 |
| `/tools` | 93 | ✅ `pages/tools.vue`（8 卡仅 2 卡可跳） |

### 1.8 资产与团队（6）

| 路由 | 行 | 我方 |
|---|---|---|
| `/asset` | 18 | ✅ `pages/assets.vue`（**2026-10-26 更正：已有截图**） |
| `/user-assets` | 95 | ✅ 同上（语义可能不同） |
| `/team` | 90 | ❌ 团队域（cam） |
| `/team/dashboard` | 91 | ❌ |
| `/team/knowledge-base` | 92 | ❌ 团队知识库 |
| `/project-members` | 71 | ❌ |

### 1.9 影视版（6）

| 路由 | 行 | 我方 |
|---|---|---|
| `/film` | 53 | ❌ |
| `/film-creation` | 54 | ❌ 仅开通弹窗有截图（`fc.png`） |
| `/film/:id()` | 55 | ❌ |
| `/film/assets` | 56 | ❌ |
| `/film/projects/:id()/tasks` | 57 | ❌ 任务表格 + 审核流 |
| `/film/team` | 58 | ❌ |

### 1.10 创作者中心与伙伴（7）

| 路由 | 行 | 我方 |
|---|---|---|
| `/creator-center` | 43 | ❌ |
| `/creator-center/:id()` | 44 | ❌ |
| `/creator-center/earnings` | 45 | ❌ 收益/提现 |
| `/creator-center/preview/:id()` | 46 | ❌ |
| `/creator-center/publish` | 47 | ❌ 投稿 |
| `/partner-center` | 67 | ❌ |
| `/partner/invite` | 68 | ❌ 分销/邀请 |

### 1.11 广告剧 / 视频转绘 / 视频后处理（6）

| 路由 | 行 | 我方 |
|---|---|---|
| `/ad-drama/create` | 11 | ❌ |
| `/ad-drama/workspace` | 12 | ❌ |
| `/video-redraw/create` | 121 | ❌ |
| `/video-redraw/workspace` | 122 | ❌ |
| `/refer-video` | 76 | ❌ 与"拉片/翻译"的对应关系未取证 |
| `/video-effects` | 120 | ❌ 未取证 |

### 1.12 活动（7）

| 路由 | 行 | 我方 |
|---|---|---|
| `/activities` | 4 | ❌ |
| `/activities/:activityKey()` | 5 | ❌ |
| `/activities/wanju-vc/submission` | 6 | ❌ |
| `/activity/jushuoyuelu/jushuoyuelu-contest-apply` | 7 | ❌ |
| `/activity/jushuoyuelu/jushuoyuelu-contest-apply.:html()` | 8 | ❌ |
| `/activity/jushuoyuelu/jushuoyuelu-contest-mvp-creator-apply` | 9 | ❌ |
| `/activity/jushuoyuelu/jushuoyuelu-contest-mvp-creator-apply.:html()` | 10 | ❌ |

### 1.13 教育与渠道（3）

| 路由 | 行 | 我方 |
|---|---|---|
| `/channel/education` | 21 | ❌ |
| `/channel/education/buy` | 22 | ❌ |
| `/channel/education/invite` | 23 | ❌ |

### 1.14 多语言前缀（4）

| 路由 | 行 | 我方 |
|---|---|---|
| `/en` | 50 | ❌ 无 i18n |
| `/ja` | 60 | ❌ |
| `/br` | 19 | ❌ |
| `/es` | 52 | ❌ |

### 1.15 任务中心（1）

| 路由 | 行 | 我方 |
|---|---|---|
| `/task` | 89 | ✅ `pages/tasks.vue` |

> **分组校验**：10+7+1+17+9+9+9+6+6+7+6+7+3+4+1 = **102** ✅

## 2. 我方页面与参照路由的对应关系（反查）

我方 20 个页面：

| 我方页面 | 参照对应 |
|---|---|
| `index.vue`（`/`） | ✅ `/`（落地/工作台） |
| `home.vue` | ⚠️ **参照无 `/home`**——参照登录后工作台仍在 `/` |
| `login.vue` | ⚠️ **参照无 `/login` 页**——参照是 `/` 上的**弹窗** |
| `pricing.vue` | ✅ `/pricing` |
| `tools.vue` | ✅ `/tools` |
| `create/text-to-video.vue` | ✅ `/create/text-to-video` |
| `create/image-to-video.vue` | ✅ `/create/image-to-video` |
| `projects/index.vue` | ✅ `/reelflow/list` |
| `projects/[id].vue` | ✅ `/series-manage/episode/:id`（+ `/reelflow/edit`、`asset-confirm`、`asset-extract` 内嵌） |
| `works.vue` | 🔶 `/series-manage`（形态不同） |
| `tasks.vue` | ✅ `/task` |
| `assets.vue` | ✅ `/asset`、`/user-assets` |
| `settings.vue` | 🔶 `/user-center`、`/profile`、`/setting` |
| `credits.vue` | ⚠️ 参照积分页在 `/pricing` 内（无独立路由） |
| `share/[token].vue` | 🔶 `/share-land`（语义待确认） |
| `report.vue` | ⚠️ 参照举报在页面内，无独立路由 |
| `terms.vue` / `privacy.vue` | ⚠️ 参照为弹窗/静态页，未取证 |
| `admin/index.vue` / `admin/login.vue` | ⚠️ 参照管理侧走 `/v1/rmadminsrv/*`，无页面路由 |

**结论**：我方 20 页里 **11 页有参照对应**、**4 页是"形态差异"**（`/home`、`/login` 弹窗、`/credits`、`/report`）、**5 页为自有设计**（`/admin/*`、`/terms`、`/privacy`、`/share`）。

## 3. 补录与"漏页"（routes.txt 之外）

| 页 | 证据 | 说明 |
|---|---|---|
| **`/mcp`** | `rea-reelmate/mcp.png`（1664×955）＋ `net-explore.json` 的 `mcp`/`mcp-wait` 步骤 | **不在 routes.txt**；`§12` 证据索引亦漏列。全站复刻必须纳入（MCP & CLI 分支） |

> 排查方法：`routes.txt` 与实测场景步骤（`scenario-*.json` / `net-*.json`）**交叉比对**，而不是只看路由表。已知其余场景步骤（home/t2v/pricing/tools/canvas/node/film-creation/cli/mcp）均能在 routes.txt 或补录中找到对应。

## 4. 未取证与需重抓

| 类 | 页面 | 动作 |
|---|---|---|
| **空屏作废** | `/script-manage`（`_acceptance/ref/page-script-manage.png` ≡ `modal-3s.png`，纯 `rgb(11,11,16)`，5247B） | 重抓 |
| **伪证据** | `/reelflow/edit` 的导出面板（`proj-03-export-panel.png` 与基线仅差 0.122%，只差顶栏） | 重抓面板 |
| **零截图** | `/task`、`/user-center`、`/team*`、`/film*`、`/novel-market*`、`/creator-center*`、`/agent*`、`/canvas`（仅空态）、`/pricing` FAQ、`/mcp`（有图未入册） | F0.4 Top5 起补 |
| **需权限** | 影视版内测、团队空间、创作者资质、广告主商品（4 类硬权限，约 20 条路由） | 需 Owner 提供账号 |

## 5. 与旧口径的差异

| 项 | 旧 | 本清单 |
|---|---|---|
| 「928 条路由」 | 把 API 常量与页面路由混算 | **102 页面 + 821 API + 4 裸 token + 1 空行 = 928 行** |
| `/mcp` | 未列 | 已补录 |
| `§9.6` 证据状态 | 全标"无截图" | 已按字节比对更正 2 条并补登 2 条第二证据链（见 `reference-alignment-spec.md:911-933` 与 `§12`） |
