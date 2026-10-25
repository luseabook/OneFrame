# 登录态参照证据（ref-authed）· 2026-10-26

> 采集方式：复用 `rea-reelmate/chrome-profile/`（2026-10-24 建立的登录态），CDP `127.0.0.1:9223`，
> 脚本 `_acceptance/capture-authed.cjs`（防御式：单页硬超时 / 渲染轮询 / 逐页 finally；不 close 外部浏览器）。
> 登录有效性验证：`POST /web/v1/renew` → `code:0`，`sign_in:true`，`uid:[REDACTED_UID]`，`space_id:[REDACTED_SPACE]`。
> **未使用 Owner 手动登录**——旧会话仍然有效（`expires_in≈3528s`，每次 renew 自动续期）。
> 证据目录：`_acceptance/ref-authed/`（22 页 × 截图 2 张 + HTML + 结构化元数据）

---

## 0. 结论速览

| 项 | 值 |
|---|---|
| 采集页数 | **22**（全部 200，**无重定向**） |
| 新增可用证据 | 22 组（每组：视口图 + 滚底图 + DOM + tabs/buttons/headings 元数据） |
| 其中「空态证据」 | **19**（账号无数据：无项目/无成员/无剧集）——空态结构与文案本身就是复刻必需 |
| 其中「有内容证据」 | 3（`mcp`、`creation-agent`、`team-kb` 有实质内容） |
| 发现的形态级事实 | **11 条**（见 §3），其中 4 条直接修正了此前文档的判断 |

> ⚠️ **重要前提**：本账号 `space_id` 为**个人空间**（`cam/permission/user` 返回 `role_code:master` 但无团队实体），
> 且**无影视版内测权限**（`/film` 只显示空壳「全部影视项目 / 创建项目」，无任务表格）。
> 因此**影视版任务表格、团队积分分配、创作者中心收益**这三块**仍未取证**——需要真正开通这些权限的账号。

---

## 1. 逐页结果（22 页）

标记：`🟢` 有实质内容 ｜ `🟡` 空态（结构可用，无数据） ｜ `🔴` 加载失败/无意义

| # | 页面 | 路由 | 判定 | 正文长度 | 关键结构（tabs / headings） |
|---|---|---|---:|---|
| 1 | 任务中心 | `/task` | 🟡 | 103 | tabs: `全部/视频/图片/音频`+`我的收藏/进行中`；空态「快去生成你的创意吧」 |
| 2 | 个人中心 | `/user-center` | 🟡 | 126 | tabs: `历史创作/Agent项目/历史上传/我的提示词`；空态「快去创作您的创意吧~」 |
| 3 | 设置 | `/setting` | 🟡 | 147 | ⚠️ 实际渲染的是**资产页**（tabs `角色/场景/道具/其他`）→ 说明 `/setting` 非独立页（见 §3-F2） |
| 4 | 个人资料 | `/profile` | 🟡 | 138 | heading「用户名」 |
| 5 | 团队 | `/team` | 🟡 | 311 | tabs: `成员管理/积分管理/规则说明`；表格列 **成员/账号/角色/成员组/参与项目形式/当前积分/状态/备注**；空态「创建成员开始团队协作」+「去开通」 |
| 6 | 团队看板 | `/team/dashboard` | 🟡 | 221 | 无 heading（空看板） |
| 7 | 团队知识库 | `/team/knowledge-base` | 🟢 | 674 | tabs: `官方资产库/团队资产库(团队复用)`；`角色/场景/道具/版权说明`；`全部/最近使用` |
| 8 | 剧本管理 | `/script-manage` | 🟡 | **3747** | tabs: `剧本广场 / 我的剧本(0)`；**5 个创作入口**（见 §3-F5）；题材 15 类 |
| 9 | 剧集列表 | `/episode-list` | 🟡 | 45 | tabs: `剧集/导出历史` |
| 10 | 剧集管理 | `/series-manage` | 🟡 | 88 | heading「好故事一定有市场！」（营销空态） |
| 11 | 画布 | `/canvas` | 🟢 | 232 | 节点工具栏：`文本/表格/图像/视频/音频/视频合成/剧本拆资产/剧本拆分镜`；`新手引导/换一批/Skill`；模型 `DeepSeek V4.1 Flash` |
| 12 | 工作流画布 | `/workflow-canvas` | 🟡 | 103 | 与 `/task` 同壳（空） |
| 13 | 定价 | `/pricing` | 🟡 | 109 | tabs: `订阅会员/积分加购/兑换码` + `连续包月/按月购买` |
| 14 | MCP | `/mcp` | 🟢 | 1949 | **登录态下是首页**（20 headings 全为首页案例区）→ 见 §3-F1 |
| 15 | CLI | `/cli` | 🟢 | 388 | 3 headings：`资产+分镜专家Agent自动执行…`、`智能回填提示词…`、`一句话灵感写剧本` |
| 16 | 影视版开通 | `/film-creation` | 🟡 | 130 | heading「开通 AI 影视创作」 |
| 17 | 影视版 | `/film` | 🟡 | 56 | tabs: `项目/资产库/团队/返回首页`；空态「好故事一定有市场！」+「创建项目」 |
| 18 | 剧本集市 | `/novel-market/1` | 🟡 | 88 | heading「剧本基本信息 / 剧本分集试读 / 剧本总览」；`独家买断`；「暂无剧本概况」 |
| 19 | 创作者中心 | `/creator-center` | 🔴 | 44 | **「加载失败，请重试」**（无权限或无数据） |
| 20 | 创作 Agent | `/creation-agent` | 🟢 | 1593 | tabs: `Skills/收藏/我的`；分类 `精选/热门短剧短片/分镜及视频/图片处理/剧本创作/全部`；**Skill 卡**：`武侠短片全流程 / 萌宠旅行Vlog短片 / 赛博CG动画短片 / 第一人称视频短片 / 废土风格短片 / 柔焦胶片风格图`；`搜索skill / 创建Skill / 使用` |
| 21 | 资产库 | `/asset` | 🟡 | 149 | tabs `角色/场景/道具/其他`；CTA `AI 智能提取资产 / 生成角色 / 导入角色` |
| 22 | ReelFlow 列表 | `/reelflow/list` | 🟡 | 20 | `项目 / 已导出` + 「点击下方创建一个新项目」+「创建项目」 |

---

## 2. 可直接用于复刻的结构事实（有实质价值的部分）

### 2.1 团队（`/team`）—— 表格列定义首次取证

| 列 | 说明 |
|---|---|
| 成员 / 账号 / 角色 / **成员组** / **参与项目形式** / **当前积分** / 状态 / 备注 | 与我方 `space_members` 扩展列 + `credits_quota` 设计**吻合**（ADR-010/011 得到验证） |
| tabs | `成员管理 / 积分管理 / 规则说明` |
| 空态 CTA | 「创建成员账号」+「去开通」（**席位需购买**，佐证 `max_seats` 概念） |

> 验证了 `database.md` §12.3 的列设计方向正确：`role`（角色）/`group_id`（成员组）/`credits_quota`（当前积分）
> 都能在上述列里找到对应。**但「参与项目形式」是新概念**——对应 `team_member_projects`，需在契约中补一个 `participation_type` 语义（见 §4 待补）。

### 2.2 知识库（`/team/knowledge-base`）

`tabs`: `官方资产库` ｜ `团队资产库（团队复用）`；二级 `角色/场景/道具/版权说明`；排序 `全部/最近使用`。
→ 与我方 `canvas_materials` + `assets` 分工一致；**「官方资产库」是平台侧内容**，对应 `canvas_templates(tpl_scope=1官方)` 的思路。

### 2.3 剧本管理（`/script-manage`）—— **5 个创作入口**（此前未取证）

| 入口 | 语义 | 对应我方 |
|---|---|---|
| 从分析开始改编小说 | 小说→分析→改编（主路径） | `source_type=1 novel` + 分析链 |
| 直接开始改编小说 | 跳过分析直改 | 同上，简化分支 |
| 从故事灵感创作剧本 | 一句话想法 | `source_type=2 idea` |
| 从已有剧本进行**创意裂变** | 剧本二创 | `source_type=4 fission`（此前仅"预留"） |
| 从已有剧本**转海外剧本** | 出海改编 | **新能力**（PRD 无此项） |

题材 15 类：`爱情/年代/逆袭/家庭/萌宝/悬疑/恐怖/志怪/古装/玄幻/奇幻/都市/喜剧/科幻/灾难`（另一个截断）。

### 2.4 画布（`/canvas`）—— 节点工具栏实际构成

工具按钮：`文本 / 表格 / 图像 / 视频 / 音频 / 视频合成 / 剧本拆资产 / 剧本拆分镜`
+ `新手引导 / 换一批 / Skill` + 模型选择 `DeepSeek V4.1 Flash`

→ **与契约 §12.1.10 的 11 种 `node_type` 对应关系**：前 5 个直接对应 `text/table/image/video/audio`；
`视频合成`→`clip`；`剧本拆资产`/`剧本拆分镜`→`script` 节点的 `runPhase`(asset_match/storyboard)。
**`director`/`threeDWorld`/`group` 在工具栏未出现**（但 CLI 与 RE §12.5 确认存在）→ 属"不在主工具栏"的节点类型。

### 2.5 创作 Agent（`/creation-agent`）—— Skill 卡实现

`tabs: Skills/收藏/我的`；分类：`精选/热门短剧短片/分镜及视频/图片处理/剧本创作/全部`。
Skill 卡（实测 6 个）：`武侠短片全流程`、`萌宠旅行Vlog短片`、`赛博CG动画短片`、`第一人称视频短片`、`废土风格短片`、`柔焦胶片风格图`。
→ 与 RE §12.5 的 `agent-recommend-cards`（`skill_name_en:"wuxia-one-line-film-director"`）一致；**卡片结构**：`{recommend_id,title,description,preset_prompt,skills[],tag_label}`。

### 2.6 定价（`/pricing`）

`tabs`: `订阅会员 / 积分加购 / 兑换码`；周期 `连续包月 / 按月购买`。
→ **兑换码是 pricing 页的一个 tab**（不是我方独立页），此前计划把它列为独立模块，应改为 tab。

---

## 3. 修正此前判断的 4 条硬事实

| # | 此前判断 | 实测 | 影响 |
|---|---|---|---|
| **F1** | `/mcp` 是独立的 MCP 服务页（因有 `mcp.png`） | **登录态访问 `/mcp` 渲染的是首页**：DOM 里首页案例区块标记 7 处（`爆款案例/ALL EYES ON US/天才机甲师`），MCP/Skill 仅 3 处（疑为导航项）。未登录时 301 回首页 | `/mcp` 很可能是**首页的锚点/弹窗**而非独立页。契约里**不应为 `/mcp` 设计独立页面**，改为"首页内入口"；`mcp.png` 需像素比对后才能定它到底拍的是什么 |
| **F2** | `/setting` 是设置页 | 渲染出的是**资产页**（tabs `角色/场景/道具/其他` + CTA `AI 智能提取资产`） | `/setting` 与 `/user-settings` 的关系需重新取证；我方 `settings.vue` 的对应关系不能照此前假设 |
| **F3** | `/workflow-canvas` 是独立工作流画布 | DOM 指纹：首页案例标记 0 处、MCP 0 处，与 `/task` 的 DOM 大小也不同（50KB vs 115KB）→ **是独立页但空态极简**（正文 103 字），不是重定向 | 可按独立页面复刻，但**空态下几乎无结构可抄**，需有数据或交互后才能取证 |
| **F4** | `/creator-center` 是创作者中心（可复刻） | **「加载失败，请重试」** | 该账号无创作者资质；需有资质账号才能取证，暂列"不可达" |

---

## 4. 仍未取证（需 Owner 提供特定权限账号）

| 项 | 阻塞原因 | 需要什么 |
|---|---|---|
| **影视版任务表格**（`/film/projects/:id/tasks`） | 账号无影视版内测权限；`/film` 只有空壳 | 影视版内测资格账号 |
| **团队积分分配/回收**（`cam/team/points-*`） | 个人空间无团队实体 | 已开通团队且有成员的账号 |
| **创作者中心收益/投稿**（`/creator-center/*`） | 「加载失败」（无资质） | 创作者资质账号 |
| `/setting`、`/user-settings` 的真实形态 | 渲染结果异常（见 F2） | 复采 + 交互探测 |
| `/mcp` 真实形态 | 两次都渲染首页（见 F1） | 像素比对 `mcp.png` / 或交互路径探测 |
| `comment-nodes`/`pin-groups`/`table` 节点的交互态 | 需在画布内造数据 | 可在我们自己的画布实现中验证，不必等参照 |

---

## 5. 证据文件清单

```
_acceptance/ref-authed/
├── capture-report.json          # 22 页结构化元数据（url/status/textLen/headings/tabs/buttons/tables/rows）
├── <page>.png                   # 视口图（1600×1000）
├── <page>-bottom.png            # 滚到底（FAQ/页脚/长表格）
└── <page>.html                  # 完整 DOM
```

页面：`task user-center settings profile team team-dashboard team-kb script-manage episode-list
series-manage canvas workflow-canvas pricing mcp cli film-creation film novel-market creator-center
creation-agent assets reelflow-list`

> 采集脚本 `_acceptance/capture-authed.cjs` 可重跑（`CDP=http://127.0.0.1:9223 node capture-authed.cjs`）。
> 若会话过期，需在 `E:\wanxing\rea-reelmate\chrome-profile` 这个 profile 上手动登录一次，脚本会自动续期。
