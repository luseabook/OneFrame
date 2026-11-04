# UI 对齐台账（93 条可比路由）

> 基线：2026-11-02 · HEAD `a150ff3` · 竞品证据截至 2026-10-25/26 的只读取证
> 配套：[ui-ux-parity-execution-plan.md](../../07-plan/ui-ux-parity-execution-plan.md) · [competitor-ui-comparison.md](../competitor-ui-comparison.md)
> 口径：竞品 102 条页面路由 − 9 条不可比路由 = **93 条**。不可比：`/:path(.*)*`、`/redirect/:action()`、`/redirect-callback/:action()`、`/route-permission-map`、`/api/user/logout`、`/en`、`/ja`、`/br`、`/es`。
> 我方当前 **77 个页面文件**（2026-11-04 实测；含本批 4 条路由承接）；一个页面可承载竞品多个路由，项目工作台、资产确认、资产提取、时间线编辑是 `projects/[id].vue` 的内嵌视图，不另建路由。

> **2026-11-04 复核（重要口径修正）**：u8 报告的 26 条 ❌ 中 **6 条已闭合**（37/47/48/67/69 已建页、68 为等价视图），真 ❌ 曾为 **20 条**。补 38/44/63/68、39 短剧、55 CLI 后，创作类已无“无入口”项。
>
> **2026-11-04 范围裁定（D6）**：本项目只做**创作功能**，不做营销/运营。活动、渠道、合作、推荐裂变、创作者社区等 **9 条**统一标 `范围外（D6）`，不计入创作台账分母；`D1 的 93 条 1:1` 在营销域上作废。
>
> **2026-11-04 收尾（第 134 批）**：创作/基础页最后 6 条（`/tutorial`、`/user-language`、`/user-update`、`/adjust`、`/implement`、`/refer-video`）已全部落地（3 个真实页 + 3 个有据承接），**真 ❌ = 0**。剩下的 9 条营销行是 `范围外（D6）`，不是缺口。

## 0. 标记与判定

| 标记 | L0 入口 | L1 视觉 / 同状态 | L2 交互 / 步数 | L3 数据 / 行为 | 证据 |
|---|---|---|---|---|---|
| 🟢 | 直接路由 | 同状态已逐项测量且无未闭差异 | 步数已逐条核对 | 真实接口 / 状态 / 计费已验证 | 可用 |
| 🟡 | 页面内视图 / 形态不同 | 只测了部分状态，差异见缺陷列 | 只有代码级初审，未录屏 | 只有端点测试，未验证 UI 行为 | 部分 |
| ⏳ | 未实现 / 未取证 | 未测或竞品动态状态无证据 | 未测 | 未测 | 缺口 |
| ❌ | 无对应入口 | — | — | — | — |

**D1 + D4 读法**：93 条全部建行、全部尝试 L1+L2；竞品动态状态没有录屏的，只能 `⏳`，不能写成 `✅`。`⏳` 不进通过分子，也不等于失败。

**A 层深审 20 条**：`/`、`/pricing`、`/tools`、`/create/text-to-video`、`/create/image-to-video`、`/series-manage`、`/series-manage/:id()`、`/series-manage/episode/:id()`、`/series-manage/asset-confirm`、`/series-manage/asset-extract`、`/reelflow/list`、`/reelflow/edit/:projectId()`、`/asset`、`/user-assets`、`/task`、`/profile`、`/canvas`、`/director`、`/film`、`/film/:id()`。

## 1. 根与工具性路由（5）

| # | 竞品路由 | 层 | L0 | L1 | L2 | L3 | 竞品证据 | 我方证据 | 未闭缺陷 | 批次 |
|---:|---|:--:|:--:|:--:|:--:|:--:|---|---|---|---|
| 1 | `/` | A | 🟢 `pages/index.vue` | 🟡 01-home | 🟡 核心链初审 | ⏳ | 🟢 同状态截图 | 🟢 截图 + 代码 | 首页功能卡与落地页分工仍需按竞品复核 | U6 |
| 2 | `/register/public-beta-invite` | B | 🔶 `pages/login.vue` 内注册 | ⏳ | ⏳ | ⏳ | ⏳ 未取证 | 🟡 代码 | 公测邀请注册无独立页 | U6 |
| 3 | `/tutorial` | B | 🟢 `pages/tutorial.vue` | ⏳ 竞品无截图 | 🟡 代码初审 | 🟡 静态内容（三步 + FAQ，链真实页面） | ⏳ 未取证 | 🟢 代码 | 竞品无响应体证据；按我方主链路写，不造功能 | 134 |
| 4 | `/mobile-landing` | C | 🔶 `/` 响应式 | ⏳ | ⏳ | ⏳ | ⏳ 未取证 | 🟡 代码 | 无移动端专用落地 | U7 |
| 5 | `/share-land` | B | 🔶 `pages/share/[token].vue`、`watch/[token].vue` | ⏳ | ⏳ | ⏳ | ⏳ 未取证 | 🟡 代码 | 公开分享落地语义待竞品确认 | U3 |

## 2. 账号与设置（7）

| # | 竞品路由 | 层 | L0 | L1 | L2 | L3 | 竞品证据 | 我方证据 | 未闭缺陷 | 批次 |
|---:|---|:--:|:--:|:--:|:--:|:--:|---|---|---|---|
| 6 | `/profile` | A | 🔶 `pages/settings.vue` | ⏳ | ⏳ | ⏳ | ⏳ 零截图 | 🟡 代码 | 竞品无截图，不能宣称形态对齐 | U6 |
| 7 | `/setting` | B | 🔶 `pages/settings.vue` | ⏳ | ⏳ | ⏳ | ⏳ 零截图 | 🟡 代码 | 同上 | U6 |
| 8 | `/user-center` | B | 🔶 `pages/settings.vue` | ⏳ | ⏳ | ⏳ | ⏳ 零截图 | 🟡 代码 | 同上 | U6 |
| 9 | `/user-settings` | B | 🔶 `pages/settings.vue` | ⏳ | ⏳ | ⏳ | ⏳ 零截图 | 🟡 代码 | 同上 | U6 |
| 10 | `/user-language` | C | 🟢 `pages/user-language.vue` | ⏳ | 🟢 真机切换实测（e2e-new-pages） | 🟡 cookie 即时切换（`of_lang`） | ⏳ 未取证 | 🟢 代码 | 账号级语言同步未接入；页面注明“本设备生效” | 134 |
| 11 | `/user-update` | C | 🟢 `pages/user-update.vue` | ⏳ | 🟡 代码初审 | 🟢 真机保存+刷新实测（e2e-new-pages） | ⏳ 未取证 | 🟢 代码 | 头像仅 URL，无上传链路（不伪造上传按钮） | 134 |
| 12 | `/adjust` | C | 🟢 `pages/adjust.vue`（别名→`/settings`） | ⏳ | 🟢 真机跳转实测（e2e-new-pages） | 🟡 账号设置页 | ⏳ 未取证 | 🟢 代码 | 竞品语义未取证；按账号调整承接，不复制设置逻辑 | 134 |

## 3. 定价（1）

| # | 竞品路由 | 层 | L0 | L1 | L2 | L3 | 竞品证据 | 我方证据 | 未闭缺陷 | 批次 |
|---:|---|:--:|:--:|:--:|:--:|:--:|---|---|---|---|
| 13 | `/pricing` | A | 🟢 `pages/pricing.vue` | 🟡 截图，FAQ 缺 | ⏳ | 🟡 端点测试 | 🟡 静态截图 | 🟢 截图 + 代码 | FAQ / 页脚未取证 | U6 |

## 4. 工具箱 `/create/*`（17）

| # | 竞品路由 | 层 | L0 | L1 | L2 | L3 | 竞品证据 | 我方证据 | 未闭缺陷 | 批次 |
|---:|---|:--:|:--:|:--:|:--:|:--:|---|---|---|---|
| 14 | `/create/text-to-video` | A | 🟢 `create/text-to-video.vue` | 🟡 静态截图 | 🟡 代码初审 | 🟡 mock 端点 | 🟡 静态截图 | 🟢 截图 + 代码 | 步数未按竞品录屏核对 | U6 |
| 15 | `/create/image-to-video` | A | 🟢 `create/image-to-video.vue` | 🟡 静态截图 | 🟡 代码初审 | 🟡 mock 端点 | 🟡 静态截图 | 🟢 截图 + 代码 | 同上 | U6 |
| 16 | `/create/lip-sync` | B | 🟢 `create/lip-sync.vue` | ⏳ | 🟡 代码初审 | 🟡 mock 端点 | ⏳ 未取证 | 🟡 代码 | 无竞品同状态证据 | U6 |
| 17 | `/create/reference-to-video` | B | 🟢 `create/reference-to-video.vue` | ⏳ | 🟡 代码初审 | 🟡 mock 端点 | ⏳ 未取证 | 🟡 代码 | 同上 | U6 |
| 18 | `/create/video-refer` | B | 🟢 `create/video-refer.vue` | ⏳ | 🟡 代码初审 | 🟡 mock 端点 | ⏳ 未取证 | 🟡 代码 | 同上 | U6 |
| 19 | `/create/video-upscale` | B | 🟢 `create/video-upscale.vue` | ⏳ | 🟡 代码初审 | 🟡 mock 端点 | ⏳ 未取证 | 🟡 代码 | 同上 | U6 |
| 20 | `/create/video-extend` | B | 🟢 `create/video-extend.vue` | ⏳ | 🟡 代码初审 | 🟡 mock 端点 | ⏳ 未取证 | 🟡 代码 | 同上 | U6 |
| 21 | `/create/video-edit` | B | 🟢 `create/video-edit.vue` | ⏳ | 🟡 代码初审 | 🟡 mock 端点 | ⏳ 未取证 | 🟡 代码 | 同上 | U6 |
| 22 | `/create/video-effects/effect` | B | 🔶 `create/video-effects.vue` | ⏳ | 🟡 代码初审 | 🟡 mock 端点 | ⏳ 未取证 | 🟡 代码 | 我方路径少 `/effect` 段 | U6 |
| 23 | `/create/image-to-image` | B | 🟢 `create/image-to-image.vue` | ⏳ | 🟡 代码初审 | 🟡 mock 端点 | ⏳ 未取证 | 🟡 代码 | 无竞品同状态证据 | U6 |
| 24 | `/create/text-to-image` | B | 🟢 `create/text-to-image.vue` | ⏳ | 🟡 代码初审 | 🟡 mock 端点 | ⏳ 未取证 | 🟡 代码 | 同上 | U6 |
| 25 | `/create/brush-repaint` | B | 🟢 `create/brush-repaint.vue` | ⏳ | 🟡 代码初审 | 🟡 mock 端点 | ⏳ 未取证 | 🟡 代码 | 同上 | U6 |
| 26 | `/create/text-repaint` | B | 🟢 `create/text-repaint.vue` | ⏳ | 🟡 代码初审 | 🟡 mock 端点 | ⏳ 未取证 | 🟡 代码 | 同上 | U6 |
| 27 | `/create/text-to-speech` | B | 🟢 `create/text-to-speech.vue` | ⏳ | 🟡 代码初审 | 🟡 mock 端点 | ⏳ 未取证 | 🟡 代码 | 同上 | U6 |
| 28 | `/create/text-to-music` | B | 🟢 `create/text-to-music.vue` | ⏳ | 🟡 代码初审 | 🟡 mock 端点 | ⏳ 未取证 | 🟡 代码 | 同上 | U6 |
| 29 | `/create/text-to-sound` | B | 🟢 `create/text-to-sound.vue` | ⏳ | 🟡 代码初审 | 🟡 mock 端点 | ⏳ 未取证 | 🟡 代码 | 同上 | U6 |
| 30 | `/create/auto-bgm` | B | 🟢 `create/auto-bgm.vue` | ⏳ | 🟡 代码初审 | 🟡 mock 端点 | ⏳ 未取证 | 🟡 代码 | 同上 | U6 |

## 5. 项目 / 剧集 / 剧本（9）

| # | 竞品路由 | 层 | L0 | L1 | L2 | L3 | 竞品证据 | 我方证据 | 未闭缺陷 | 批次 |
|---:|---|:--:|:--:|:--:|:--:|:--:|---|---|---|---|
| 31 | `/series-manage` | A | 🔶 `pages/works.vue` / `projects/index.vue` | 🟡 02-project-list | 🟡 代码初审 | 🟡 端点测试 | 🟢 同状态截图 | 🟢 截图 + 代码 | 列表「已剪辑」不是真实导出历史；形态待 1:1 | U3 |
| 32 | `/series-manage/:id()` | A | 🟢 `pages/projects/[id].vue` | 🟡 03-episode-workspace | 🟡 核心链初审 | 🟡 端点测试 | 🟢 同状态截图 | 🟢 截图 + 代码 | 批量缺 `mode`；两套「已出片」；匹配资产按钮禁用；添加分镜禁用 | U1/U2 |
| 33 | `/series-manage/episode/:id()` | A | 🔶 `projects/[id].vue` 内嵌 | 🟡 03/08 | 🟡 核心链初审 | 🟡 端点测试 | 🟢 同状态截图 | 🟢 截图 + 代码 | 两套时间线；项目页时间线仍可编辑 | U1/U3 |
| 34 | `/series-manage/asset-confirm` | A | 🔶 `projects/[id].vue` 资产确认视图 | 🟡 06-asset-confirm | 🟡 代码初审 | 🟡 端点测试 | 🟢 同状态截图 | 🟢 截图 + 代码 | 抽屉搜索无 `v-model`；重复计数文案 | U2 |
| 35 | `/series-manage/asset-extract` | A | 🔶 `projects/[id].vue` AI 提取视图 | 🟡 04-project-assets | 🟡 代码初审 | 🟡 端点测试 | 🟡 静态截图 | 🟢 截图 + 代码 | 大卡点击无反馈 | U2 |
| 36 | `/episode-list` | C | 🔶 项目页剧集栏 | ⏳ | ⏳ | ⏳ | ⏳ 未取证 | 🟡 代码 | 无独立剧集列表页 | U8 |
| 37 | `/script-manage` | C | 🟢 `pages/script/index.vue`（U9 新建） | 🟡 首屏结构对齐（用户提供的竞品截图） | 🟡 代码初审 | 🟡 端点测试 | 🟡 仅 1 张用户提供截图 | 🟢 `evidence/ui-audit/u9/u9-script-1424.png` | 竞品该页动态态（生成中/我的剧本有数据）仍未取证 | U9 |
| 38 | `/script-view/:id()` | C | 🟢 `pages/script-view/[id].vue` | ⏳ 竞品无截图 | 🟡 代码初审 | 🟡 双形态（项目优先，失败回落小说章节） | ⏳ 未取证 | 🟢 代码 | `:id` 语义无证据但不阻塞：先 `GET /projects/:id`，失败再 `GET /novel/:id`+章节；两条都通、互斥只读 | 132 |
| 39 | `/short-film/:id()` | C | 🟢 `pages/short-film/[id].vue`（别名→`/projects/:id`） | ⏳ | 🟡 代码初审 | 🟡 端点（项目工作台） | ⏳ 未取证 | 🟢 代码 | **竞品语义未取证**；按“短剧=脚本项目”做别名承接，外部深链不再 404；若证据表明是独立形态再升级 | 132 |

## 6. 小说改编 / 创作 Agent（9）

| # | 竞品路由 | 层 | L0 | L1 | L2 | L3 | 竞品证据 | 我方证据 | 未闭缺陷 | 批次 |
|---:|---|:--:|:--:|:--:|:--:|:--:|---|---|---|---|
| 40 | `/novel-market/:id()` | B | 🟢 `novel-market/[id].vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 零截图 | 🟡 代码 | **范围外（D5）：剧本交易域不做**；页面保留，不参与对齐判定 | U6 |
| 41 | `/novel-to-script/:id()` | B | 🔶 `novel/[id].vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 未取证 | 🟡 代码 | 形态差异 | U6 |
| 42 | `/novel-to-script-agent/:id()` | B | 🔶 `novel/[id].vue` + Agent | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 未取证 | 🟡 代码 | 未按竞品工作台拆分 | U6 |
| 43 | `/novel-to-script-agent/create` | C | 🔶 `novel/index.vue` | ⏳ | ⏳ | ⏳ | ⏳ 未取证 | 🟡 代码 | 无独立创建页 | U8 |
| 44 | `/novel-to-script-agent/workbench` | C | 🟢 `pages/novel-to-script-agent/workbench.vue` → `/novel` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 未取证 | 🟢 代码 | 别名承接；工作台本体是 `/novel`（本子列表 + 改编入口） | 132 |
| 45 | `/creation-agent` | B | 🔶 `pages/agent/index.vue`（同一对话页） | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 未取证 | 🟡 代码 | 对话式创作与 Agent 分工待定 | U6 |
| 46 | `/agent` | B | 🟢 `pages/agent/index.vue`（U20 迁移，修子路由嵌套） | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 零截图 | 🟡 代码 | 竞品零截图 | U6 |
| 47 | `/agent/bigscreen` | C | 🟢 `pages/agent/bigscreen.vue`（U20 新建） | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 未取证 | 🟢 裸壳大屏截图 | 推荐场景/技能墙/会话三块，Esc 退出；L1 无竞品证据 | U20 |
| 48 | `/agent/editor` | C | 🟢 `pages/agent/editor.vue`（U20 新建） | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 未取证 | 🟢 编辑态截图 | 会话→草稿（本地存、复制、导出 .md）；L1 无竞品证据 | U20 |

## 7. 剪辑 / 画布 / 3D / CLI（9）

| # | 竞品路由 | 层 | L0 | L1 | L2 | L3 | 竞品证据 | 我方证据 | 未闭缺陷 | 批次 |
|---:|---|:--:|:--:|:--:|:--:|:--:|---|---|---|---|
| 49 | `/reelflow/list` | A | 🟢 `pages/reelflow/list.vue` | 🟡 02-project-list | 🟡 代码初审 | 🟡 端点测试 | 🟢 同状态截图 | 🟢 截图 + 代码 | 「已剪辑」口径不是导出记录 | U3 |
| 50 | `/reelflow/edit/:projectId()` | A | 🟢 `pages/reelflow/edit/[id].vue` | 🟡 07-timeline-editor | 🟡 核心链初审 | 🟡 端点测试 | 🟢 同状态截图 | 🟢 截图 + 代码 | 左栏 298 / 时间线 1102×164 / 顶栏 64 已达标（U4 实测差 0）；删除撤销 / unmount flush / 切片越界 / 弹窗 a11y 已闭（U1）；剩余：播放器画面 884×497 无竞品证据 | U4 |
| 51 | `/canvas` | A | 🟢 `pages/canvas/index.vue` | 🟡 仅空态 | 🟡 代码初审 | 🟡 端点测试 | 🟡 仅空态截图 | 🟡 代码 | 竞品有数据态无证据；分享端点未逐条核 | U6 |
| 52 | `/workflow-canvas` | B | 🔶 `canvas/[id].vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 未取证 | 🟡 代码 | 与无限画布是否同形态待确认 | U6 |
| 53 | `/director` | A | 🔶 `Director3D.vue` 覆盖层 | 🟡 09-3d-director | 🟡 代码初审 | 🟡 端点测试 | 🟢 同状态截图 | 🟢 截图 + 组件 | 默认值已复测（359/704/359、300%/50°/0,1.2,0）；**直链 `/director` 仍 404**（仅覆盖层），深链不可用 | U4 |
| 54 | `/director/:projectId()` | B | 🔶 同上 | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 未取证 | 🟡 代码 | 无独立路由 | U4 |
| 55 | `/cli` | C | 🟢 `pages/cli.vue` | 🟡 按 `x4.png` 结构复刻，未逐项测量 | 🟡 代码初审 | 🟡 静态目录快照（38 组 / 204 条 / 171 已落地，来自 `registry.ts`） | 🟢 `cli.png` + `x4.png` + CLI Skill 包 | 🟢 `cli-catalog.json` | Agent 分发 URL 需部署期注入 `NUXT_PUBLIC_CLI_SKILL_URL`；未做像素级测量 | 133 |
| 56 | `/implement` | C | 🟢 `pages/implement.vue`（别名→`/cli`） | ⏳ | 🟢 真机跳转实测（e2e-new-pages） | 🟡 CLI/Skill 页 | ⏳ 未取证 | 🟢 代码 | 竞品同属 MCP & CLI 模块（`ImplementList`，无后端端点）；承接 `/cli` | 134 |
| 57 | `/tools` | A | 🟢 `pages/tools.vue` | 🟡 静态截图 | 🟡 代码初审 | 🟡 端点测试 | 🟡 静态截图 | 🟢 截图 + 代码 | 8 卡仅 2 卡可跳；禁用卡无反馈 | U6 |

## 8. 资产与团队（6）

| # | 竞品路由 | 层 | L0 | L1 | L2 | L3 | 竞品证据 | 我方证据 | 未闭缺陷 | 批次 |
|---:|---|:--:|:--:|:--:|:--:|:--:|---|---|---|---|
| 58 | `/asset` | A | 🟢 `pages/assets.vue` | 🟡 05-asset-library | 🟡 代码初审 | 🟡 端点测试 | 🟢 同状态截图 | 🟢 截图 + 代码 | 原生 `prompt()` → 页内 modal、首帧骨架、配额部分接服务端（视频/音频已用量无字段）已闭（U5）；剩余：角色批量生成走定妆图链路 | U5 |
| 59 | `/user-assets` | A | 🔶 `pages/assets.vue` 另一视图 | 🟡 05-asset-library | 🟡 代码初审 | 🟡 端点测试 | 🟡 语义可能不同 | 🟡 代码 | 与 `/asset` 语义未拆分 | U5 |
| 60 | `/team` | B | 🟢 `pages/team/index.vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 零截图 | 🟡 代码 | 竞品零截图 | U6 |
| 61 | `/team/dashboard` | B | 🟢 `pages/team/dashboard.vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 零截图 | 🟡 代码 | 同上 | U6 |
| 62 | `/team/knowledge-base` | B | 🔶 `pages/knowledge/index.vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 零截图 | 🟡 代码 | 团队知识库与全局知识库关系待定 | U6 |
| 63 | `/project-members` | C | 🟢 `pages/project-members.vue` | ⏳ | 🟡 代码初审 | 🟢 e2e（`apps/api/test/project-members.spec.ts`：绑定→可见→解绑、幂等、跨空间拒绝） | ⏳ 未取证 | 🟢 代码 | 竞品截图缺；页面与后端绑定闭环已验证；`bind` 的 `project_id` 必填误设已修正 | 132 |

## 9. 影视版（6）

| # | 竞品路由 | 层 | L0 | L1 | L2 | L3 | 竞品证据 | 我方证据 | 未闭缺陷 | 批次 |
|---:|---|:--:|:--:|:--:|:--:|:--:|---|---|---|---|
| 64 | `/film` | A | 🟢 `pages/film/index.vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 零截图 | 🟡 代码 | 竞品零截图 | U6 |
| 65 | `/film-creation` | B | 🟢 `pages/film-creation.vue`（U19 新建） | ⏳ | 🟡 代码初审 | 🟡 端点测试 | 🟡 仅开通弹窗 | 🟡 代码 | U19 已补独立创建页（名称+预置表+团队前置）；L1 无竞品证据（无内测权限） | U19 |
| 66 | `/film/:id()` | A | 🟢 `pages/film/[id].vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 零截图 | 🟡 代码 | 竞品零截图 | U6 |
| 67 | `/film/assets` | B | 🟢 `pages/film/assets.vue`（U19 新建） | ⏳ | ⏳ | ⏳ | ⏳ 零截图 | 🟢 资产需求汇总表 | 修复动态路由吞吃（原先报 500）；L1 无竞品证据 | U19 |
| 68 | `/film/projects/:id()/tasks` | C | 🟢 `pages/film/projects/[id]/tasks.vue`（别名→`/film/:id`） | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 零截图 | 🟡 代码 | 独立路由为别名，任务表本体仍内嵌 `/film/:id` | 132 |
| 69 | `/film/team` | C | 🟢 `pages/film/team.vue`（U19 新建） | ⏳ | ⏳ | ⏳ | ⏳ 零截图 | 🟢 资产需求汇总表 | 修复动态路由吞吃（原先报 500）；L1 无竞品证据 | U19 |

## 10. 创作者中心与伙伴（7）

| # | 竞品路由 | 层 | L0 | L1 | L2 | L3 | 竞品证据 | 我方证据 | 未闭缺陷 | 批次 |
|---:|---|:--:|:--:|:--:|:--:|:--:|---|---|---|---|
| 70 | `/creator-center` | B | 🟢 `creator-center/index.vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 零截图 | 🟡 代码 | 竞品零截图 | U6 |
| 71 | `/creator-center/:id()` | B | 🟢 `creator-center/[id].vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 零截图 | 🟡 代码 | 同上 | U6 |
| 72 | `/creator-center/earnings` | B | 🟢 `creator-center/earnings.vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 零截图 | 🟡 代码 | 真实打款仍需商户资质 | U6 |
| 73 | `/creator-center/preview/:id()` | C | 🟢 `creator-center/preview/[id].vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 零截图 | 🟡 代码 | 同上 | U6 |
| 74 | `/creator-center/publish` | C | 🟢 `creator-center/publish.vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 零截图 | 🟡 代码 | 同上 | U6 |
| 75 | `/partner-center` | C | ❌ 范围外（D6） | — | — | — | — | — | 营销/运营路由，按 2026-11-04 D6 不排期、不计分 | 范围外 |
| 76 | `/partner/invite` | B | 🔶 `pages/invite.vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 未取证 | 🟡 代码 | 分销/邀请形态待确认 | U6 |

## 11. 广告剧 / 视频转绘 / 后处理（6）

| # | 竞品路由 | 层 | L0 | L1 | L2 | L3 | 竞品证据 | 我方证据 | 未闭缺陷 | 批次 |
|---:|---|:--:|:--:|:--:|:--:|:--:|---|---|---|---|
| 77 | `/ad-drama/create` | B | 🟢 `ad-drama/create.vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 未取证 | 🟡 代码 | STAGE/STATUS 值域无证据 | U6 |
| 78 | `/ad-drama/workspace` | B | 🟢 `ad-drama/workspace.vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 未取证 | 🟡 代码 | 同上 | U6 |
| 79 | `/video-redraw/create` | B | 🟢 `video-redraw/create.vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 未取证 | 🟡 代码 | mock 下强度无可见差异 | U6 |
| 80 | `/video-redraw/workspace` | B | 🟢 `video-redraw/workspace.vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 未取证 | 🟡 代码 | 同上 | U6 |
| 81 | `/refer-video` | C | 🟢 `pages/refer-video.vue` | ⏳ | 🟡 代码初审 | 🟢 真机上传+列表实测（e2e-new-pages） | ⏳ 未取证 | 🟢 代码 | 竞品“拉片/翻译”映射未取证；按参考素材入口落地，链参考生视频/转绘 | 134 |
| 82 | `/video-effects` | C | 🔶 `create/video-effects.vue` | ⏳ | ⏳ | ⏳ | ⏳ 未取证 | 🟡 代码 | 与 `/create/video-effects/effect` 重复 | U8 |

## 12. 活动（7）

| # | 竞品路由 | 层 | L0 | L1 | L2 | L3 | 竞品证据 | 我方证据 | 未闭缺陷 | 批次 |
|---:|---|:--:|:--:|:--:|:--:|:--:|---|---|---|---|
| 83 | `/activities` | B | 🟢 `pages/activities.vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 未取证 | 🟡 代码 | 活动内容与竞品未对照 | U6 |
| 84 | `/activities/:activityKey()` | C | 🔶 活动页动态视图 | ⏳ | ⏳ | ⏳ | ⏳ 未取证 | 🟡 代码 | 无独立动态路由 | U8 |
| 85 | `/activities/wanju-vc/submission` | C | ❌ 范围外（D6） | — | — | — | — | — | 营销/运营路由，按 2026-11-04 D6 不排期、不计分 | 范围外 |
| 86 | `/activity/jushuoyuelu/jushuoyuelu-contest-apply` | C | ❌ 范围外（D6） | — | — | — | — | — | 营销/运营路由，按 2026-11-04 D6 不排期、不计分 | 范围外 |
| 87 | `/activity/jushuoyuelu/jushuoyuelu-contest-apply.:html()` | C | ❌ 范围外（D6） | — | — | — | — | — | 营销/运营路由，按 2026-11-04 D6 不排期、不计分 | 范围外 |
| 88 | `/activity/jushuoyuelu/jushuoyuelu-contest-mvp-creator-apply` | C | ❌ 范围外（D6） | — | — | — | — | — | 营销/运营路由，按 2026-11-04 D6 不排期、不计分 | 范围外 |
| 89 | `/activity/jushuoyuelu/jushuoyuelu-contest-mvp-creator-apply.:html()` | C | ❌ 范围外（D6） | — | — | — | — | — | 营销/运营路由，按 2026-11-04 D6 不排期、不计分 | 范围外 |

## 13. 教育与渠道（3）

| # | 竞品路由 | 层 | L0 | L1 | L2 | L3 | 竞品证据 | 我方证据 | 未闭缺陷 | 批次 |
|---:|---|:--:|:--:|:--:|:--:|:--:|---|---|---|---|
| 90 | `/channel/education` | C | ❌ 范围外（D6） | — | — | — | — | — | 营销/运营路由，按 2026-11-04 D6 不排期、不计分 | 范围外 |
| 91 | `/channel/education/buy` | C | ❌ 范围外（D6） | — | — | — | — | — | 营销/运营路由，按 2026-11-04 D6 不排期、不计分 | 范围外 |
| 92 | `/channel/education/invite` | C | ❌ 范围外（D6） | — | — | — | — | — | 营销/运营路由，按 2026-11-04 D6 不排期、不计分 | 范围外 |

## 14. 任务中心（1）

| # | 竞品路由 | 层 | L0 | L1 | L2 | L3 | 竞品证据 | 我方证据 | 未闭缺陷 | 批次 |
|---:|---|:--:|:--:|:--:|:--:|:--:|---|---|---|---|
| 93 | `/task` | A | 🟢 `pages/tasks.vue` | ⏳ | 🟡 代码初审 | 🟡 端点测试 | ⏳ 零截图 | 🟡 代码 | 静默轮询未修（U8 登记）；竞品零截图 → ⏳ | U6 |

## 15. 汇总与完成口径

| 项 | 数 | 说明 |
|---|---:|---|
| 台账总行 | **93** | 无空白行；每行有 L0 与证据状态 |
| L0 直接路由 / 页面内视图 / 无入口 | 41 / 26 / 26 | 以本表逐行标记为准；无入口不等于本轮必须新建页面 |
| A 层深审 | **20** | 逐条记录 L1–L3 初始状态 |
| L1 有部分同状态证据 | **16 / 20 条 A 层路由** | 9 组截图；其余 4 条（`/profile`、`/film`、`/film/:id()`、`/task`）为 `⏳` |
| L2 有代码级初审 | **18 / 20 条 A 层路由** | 竞品 Web 步数无录屏，不能写 ✅ |
| L3 有端点级初审 | **18 / 20 条 A 层路由** | 端点测试不等于 UI 行为已验证 |
| 竞品动态证据缺口 | **⏳ 待补** | 逐行标 `⏳`；不写“已对齐” |

### 15.1 证据清单（只读证据，截至 2026-10-25/26）

竞品截图均为 1424×805（部分 1664×955），0 积分账号，未触发生成/导出/分享/购买/删除。
文件位于 `docs/03-frontend/evidence/ui-compare/`。

| 证据 | 覆盖的竞品路由 | 能证明 | 不能证明 |
|---|---|---|---|
| `01-home.png` | `/` | 首页首屏、主行动、卡片层级 | hover、滚动后、登录前后差异 |
| `02-project-list.png` | `/series-manage`；`/reelflow/list` 仅形态参考 | 列表卡、双 tab、FAB | `已导出` tab 内容、空态、加载态 |
| `03-episode-workspace.png` | `/series-manage/:id()` | 160/592/640 三栏、顶栏、分镜卡静态态 | 定稿/生成中/失败/400105 等动态态 |
| `04-project-assets.png` | `/series-manage/asset-extract`；项目资产抽屉部分 | 资产视图静态结构 | 有数据列表、勾选态、`仅展示主体` |
| `05-asset-library.png` | `/asset`；`/user-assets` 仅形态参考 | 主体库首屏、卡片网格 | 两路由语义拆分、搜索/筛选态 |
| `06-asset-confirm.png` | `/series-manage/asset-confirm` | 校验视图静态结构、底部行动 | 匹配结果 UI（截图只有 toast） |
| `07-timeline-editor.png` | `/reelflow/edit/:projectId()` | 298 左栏、1102×164 时间线、轨道/气泡 | 拖拽中、裁剪中、导出中/完成/下载 |
| `08-timeline-inproject.png` | `/series-manage/episode/:id()` | 项目页内嵌时间线形态 | 编辑态、保存反馈、导出联动 |
| `09-3d-director.png` | `/director` | 全屏覆盖、359/704/359 三栏、默认视角 | 拖拽相机、场景缩放、退出确认 |
| `ref-coachmark-2026-10-25.png` | `/`（新手引导） | 三步 coach-mark 的第 1 步样式 | 第 2/3 步、跳过/完成路径 |

竞品动态证据缺口（10 条，全部保持 `⏳`，不猜）：

| # | 缺口 | 影响的路由 / 判定 |
|---:|---|---|
| 1 | 剧本正文编辑器与 AI 改稿会话 | `/script-manage`、`/script-view/:id()` 的 L1/L2 |
| 2 | 分镜卡定稿 / 有素材 / 生成中 / 失败态 | `/series-manage/:id()` 的 L1/L2 |
| 3 | 资产匹配结果 UI（只有 toast） | `/series-manage/asset-confirm` 的 L2 |
| 4 | 项目资产抽屉有数据态（列表/勾选/`仅展示主体`） | `/series-manage/asset-extract` 的 L1/L2 |
| 5 | 5 种生成模式各自的参数区差异 | `/series-manage/:id()`、生成台 L2 |
| 6 | 导出面板 / 进度 / 下载页；`已导出` tab 内容 | `/series-manage`、`/series-manage/episode/:id()` 的 L1/L2/L3 |
| 7 | `⋮` 菜单、`未开始 ▾`、时间线 `全部 ▾` 选项 | 列表与编辑器 L2 |
| 8 | 提示词库 / 提示词优化助手 | 生成台 L1/L2 |
| 9 | 移动端（`innerWidth<720` 跳 mobile-landing） | `/mobile-landing` 与窄屏 L2 |
| 10 | 「首次免费」额度与条件 | 计费文案 L3 |

> 补充方式已登记为「需要一次有积分账号的只读录屏」，但 D4 未授权；在拿到之前，以上缺口不得写成通过。

我方证据（2026-10-29，1424×805，本机登录态）：

| 证据 | 覆盖的我方页面 | 缺口 |
|---|---|---|
| `ours-2026-10-29/01-home.png` | `/` | 登录后首页功能卡未覆盖 |
| `ours-2026-10-29/02-reelflow-list.png` | `/reelflow/list` | `已导出` / `已剪辑` 口径未截图 |
| `ours-2026-10-29/03-project-storyboards.png` | `/projects/[id]` 分镜视图 | 生成中 / 失败 / 400105 态 |
| `ours-2026-10-29/13-reelflow-editor.png` | `/reelflow/edit/[id]` | 拖拽 / 裁剪 / 导出中 |
| `ours-2026-10-29/14-assets-library.png` | `/assets` | 抽取/匹配 tab、有数据勾选态 |
| `ours-2026-10-29/15-tasks.png` | `/tasks` | 轮询失败 / 空态 |
| `ours-2026-10-29/16–20-view-*.png` | 项目页 outline / characters / batch / timeline / confirm | 资产抽屉、候选弹窗 |
| `ours-2026-10-29/22-regen-confirm.png` | 重生成确认 | — |
| `ours-2026-10-29/23-editor-click-add.png` | 编辑器单击入轨 | — |

复测脚本：`_acceptance/_ui-parity-baseline.cjs`（本批新增，已通过 `node --check`，`playwright-core` 从 `_acceptance/node_modules` 解析）。它只打我方，不接触竞品；
输出每路由的 DOM 盒、计算样式、可见/禁用控件、控制台错误、可选截图，供 L1/L2 逐条比对。

```bash
node _acceptance/_ui-parity-baseline.cjs --routes=/,/projects,/assets --wait=5000
```

采集需要 Web `3011` + API + Redis `6380` 同时在线；未在线时脚本只做语法校验，不产出证据。

UI 对齐度（D1 口径）：

```text
通过 L1 + L2（数据页同时通过 L3）的可比路由数 / 93
```

`⏳` 不进分子。当前不计算总百分比——L1/L2 尚未全量测量，任何百分比都会虚报。U8 收口时按本表逐行给出。

## 16. 下一步（U1 起）

1. **U1**：`/series-manage/:id()`、`/series-manage/episode/:id()`——批量 `mode`、统一「已出片」selector、编辑器数据安全。
2. **U2**：`/series-manage/asset-confirm`、`/series-manage/asset-extract`——接通 `match-resources` + 616px 抽屉 + 预选结果。
3. **U3**：`/series-manage`、`/series-manage/episode/:id()`、`/reelflow/list`——项目页「去剪辑台」、真实导出记录、列表口径。
4. **U4**：`/reelflow/edit/:projectId()`、`/director`——空间、保存、删除/撤销、切片、弹窗键盘。
5. **U5–U8**：资产、壳层、i18n/窄屏、全量 93 条审计。

## 17. U8 收口（2026-11-02）

> 执行计划 §5 U8 要求「按台账扫 A/B/C 全部 93 条」。本节只登记**结果与指针**，逐条判定正文在
> [ui-parity-report-u8.md](ui-parity-report-u8.md)（93 行总表 + 缺口清单 + 下一步）。

| 项 | 数 |
|---|---:|
| 台账行数 | **93** |
| ✅ 对齐（L1 + L2；数据页另加 L3） | **0** |
| 🟡 部分 | **12** |
| ⏳ 待证据 | **55** |
| ❌ 无对应入口 | **26** |
| **UI 对齐度（严格口径）** | **0 / 93 = 0.0%** |

**为什么是 0**：L2 的判定需要「操作步骤 / 交互与竞品一致」的竞品证据，而竞品 Web 步数证据从计划 §2.3 起就明确不存在（D4 已确认拿不到录屏）。没有证据就不能判 ✅，所以分子为 0 是口径如实执行的结果。L1 侧只有 #32 / #50 / #53 三行做到与竞品实测数值逐项相等（≤2px），其余行等 1424 视口的竞品测量。

本轮新增证据（每行都可打开）：

- 全量 DOM/截图基线：`docs/03-frontend/evidence/ui-audit/baseline-2026-11-01T20-10-43.json` + `ours-2026-11-02/`（36 条路由，1424×805）
- 单元证据：`evidence/ui-audit/u1…u7/`（U1–U7 共 7 组截图 + `*-result.json`）
- 单元 e2e 合计 **311 条断言全过**（26 / 58 / 41 / 58 / 37 / 51 / 40）；U7 有 3 条首页 CTA 断言因文案未匹配而跳过，不计为通过

本轮由采集新发现、已登记未修的两条：

1. `GET /director` → **404**（3D 导演台只有覆盖层，没有承接路由）→ 影响 #53 的深链；
2. `/reelflow/list` 每次访问探测 `GET /v1/exports` → 404（空间级导出日志端点本期不存在，D3 已定不做）→ 影响 #31/#49 的 tab 语义。

已闭合、可从「未闭缺陷」列删除的项：U1（批量 mode、四处状态、删除撤销、flush、切片越界、弹窗 a11y）、U2（匹配入口、抽屉 616px、搜索 v-model）、U3（单时间线、真实导出记录、列表口径）、U4（298 / 1102×164 / 3D 默认值）、U5（原生 prompt、首帧空态、配额接口）、U6（死点击、toast 位置、引导）、U7（五语言 key 一致、硬编码中文增量 0、窄屏无裁切）。
