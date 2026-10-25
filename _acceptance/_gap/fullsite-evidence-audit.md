# 全站复刻 · 参照证据审计（存量盘点 · 缺口清单）

> **审计人**：evidence-auditor（task-5）
> **审计时间**：2026-10-26 01:17–01:35（Asia/Shanghai）
> **审计范围**：`rea-reelmate/`、`_acceptance/`、`docs/03-frontend/evidence/`、`docs/03-frontend/reference-alignment-spec.md`、`docs/03-frontend/reference-reelflow-spec.md`
> **参照站**：`www.reelmate.cn`（应用 `app.reelmate.cn`）
>
> **铁律遵守声明**：本轮**只审计、不采集**——未发起任何外部网络请求、未启动任何浏览器/抓图脚本、未修改任何源码或文档。唯一写入文件为本文件。
> 所有结论分三级标注：**[实测]** = 本次由文件字节/像素/JSON 直接算出；**[文档]** = 引自规格或 RE 报告原文；**[未验证]** = 无法确认，不得当真。

---

## 0. 结论摘要

| 指标 | 数值 | 依据 |
|---|---|---|
| 存量证据文件（`rea-reelmate/`，排除 `chrome-profile/`） | **1412 个 / 296.4 MB** | [实测] |
| 其中顶层证据文件 | **86 个 / 270.7 MB**（含 20 张 PNG） | [实测] |
| `rea-reelmate/` 中有参照截图证据的参照路由 | **约 18 个路由/状态** | [实测] 见 §1 |
| §9.6 无截图行 | **11 行（展开 13 条路由组）** | [文档] `reference-alignment-spec.md:915–927` |
| §7 未取证项 | **7 条** | [文档] `reference-reelflow-spec.md:190–196` |
| **合并去重后缺口条目** | **18 条**（11+7 去重 2） | §2.3 |
| **涉及参照路由（路由级）** | **29 条**：25 条零截图 + 4 条仅基线缺关键态 | §2.4 |
| **需 Owner 提供登录态/权限/数据** | **7 类，覆盖约 20 条路由** | §3 |
| §12「证据索引」指向不存在文件 | **0 条**（但存在 2 处身份/口径不实，另 1 处漏列） | §4 |
| 本次审计新发现的证据级事实 | **9 条**（含 2 条足以翻转文档结论） | §5 |

**最需要 Owner 注意的三件事**：
1. `reference-alignment-spec.md` §9.6 已**过期**：`/reelflow/edit/:projectId`（剪辑器）**已有截图**（`docs/03-frontend/evidence/reelflow/02-timeline-editor.png`，与 `_acceptance/ref/proj-02-editor.png` 像素完全相同），§9.6 第 922 行「❌ 无截图」与事实不符。
2. §9.6 所列 **`/asset`** 也**已有截图**（`08-asset-workbench.png` ≡ `_acceptance/ref/page-assets.png`）。真正零截图的缺口必须扣除这两项。
3. `routes.txt`（927 条）**不含 `/mcp`**，而 `scenario-explore.json` 实际访问并抓取了 `https://www.reelmate.cn/mcp`（`net-explore.json`，步骤 `mcp`/`mcp-wait`），且 `mcp.png`（1664×955）已存在却**未列入 §12 索引**。按 `routes.txt` 做"全站路由全覆盖"会**漏页**。

---

## 1. 存量证据盘点（`rea-reelmate/` —— 证据 → 覆盖对象）

### 1.0 采样元信息（全部来自目录实测）

- 采集窗口：**2026-10-24 03:13 – 06:45**（PNG/DOM/网络）；CLI 附件 2026-10-23 09:55；画布补采 2026-10-24 04:05–04:16。
- 采集手段（从 `scenario-*.json` 的 `browser` 字段还原，**[实测]**）：
  - CDP `127.0.0.1:9222` = **无头/未登录** Chrome（UA 含 `HeadlessChrome`），用于首页/工具/文生视频/定价/登录弹窗。
  - CDP `127.0.0.1:9223` = **已登录** Chrome（UA 无 Headless），用于登录态首页、文生视频登录态、画布、`/film-creation`+`/cli`+`/mcp`。
  - 可复用登录态载体：`rea-reelmate/chrome-profile/`（**1581 文件 / 246.7 MB**）[实测]。

### 1.1 截图类（20 张 PNG，顶层）

| 文件 | 大小(B) | 尺寸 | 时间 | 覆盖的参照页面/接口 | 证据级别 |
|---|---|---|---|---|---|
| `home.png` | 394795 | 1424×805 | 10-24 03:23:21 | `/`（未登录首页，权威坐标系） | 截图 + `shot-home.json` 摘要哈希一致 [实测] |
| `x6.png` | 656668 | 1664×955 | 10-24 04:12:24 | `/`（最清晰版） | 截图 |
| `loggedin.png` | 612875 | 1664×955 | 10-24 03:37:32 | `/`（**登录态**首页） | 截图 + `shot-loggedin.json` 一致 [实测] |
| `login.png` | 303509 | 1424×805 | 10-24 03:23:29 | `/`（未登录 + 遮罩关系） | 截图 + `shot-login.json` 一致 [实测] |
| `login-modal.png` | 90679 | 1280×720 | 10-24 03:26:34 | 登录弹窗（状态 A） | 截图 |
| `login-modal2.png` | 116763 | 1280×720 | 10-24 03:27:24 | 登录弹窗（状态 B，全登录方式） | 截图 |
| `tools.png` | 115884 | 1424×805 | 10-24 03:23:23 | `/tools` 工具箱 | 截图 + `shot-tools.json` 一致 |
| `t2v.png` | 65593 | 1424×805 | 10-24 03:23:27 | `/create/text-to-video` | 截图 + `shot-t2v.json` 一致 |
| `state.png` | 85012 | 1664×955 | 10-24 03:54:37 | `/create/text-to-video`（**登录态**，含积分消耗行） | 截图 + `shot-state.json` 一致 |
| `flow.png` | 23021 | 1424×805 | 10-24 03:23:31 | `/reelflow/list`（项目列表空态） | 截图 + `shot-flow.json` 一致 |
| `pricing.png` | 59598 | 1424×805 | 10-24 03:22:08 | `/pricing` 骨架 | 截图 + `shot-pricing.json` 一致 |
| `gen-attempt.png` | 349559 | 1280×720 | 10-24 04:01:02 | `/pricing` 完整内容（0 积分生成被拦后跳转态） | 截图 |
| `canvas.png` | 72102 | 1280×720 | 10-24 04:05:21 | `/canvas` 画布空态 | 截图 |
| `node.png` | 72124 | 1280×720 | 10-24 04:08:18 | `/canvas` 节点引导态 | 截图 |
| `cli.png` | 86735 | 1280×720 | 10-24 04:12:24 | `/cli`（CLI/Agent 工具页） | 截图 |
| `fc.png` | 87653 | 1280×720 | 10-24 04:12:24 | 影视版开通弹窗 | 截图 |
| `x4.png` | 219104 | 1664×955 | 10-24 04:12:24 | `/cli`（高分辨率版） | 截图 |
| **`mcp.png`** | 110423 | 1664×955 | 10-24 04:12:24 | **`/mcp`** | 截图 —— **§12 漏列，且 `/mcp` 不在 `routes.txt`** [实测] |
| `x3.png` | 4256 | 1280×720 | 10-24 04:12:24 | 空白/加载态（纯 `#0B0B10`） | 截图 |
| `x5.png` | 10084 | 1280×720 | 10-24 04:12:24 | 404「页面未找到」 | 截图 |

### 1.2 页面 / DOM / 网络采样

| 文件 | 大小(B) | 时间 | 覆盖对象 | 依据 |
|---|---|---|---|---|
| `capture_page.json` | 3239470 | 03:17:13 | `inspect_web_page` @ **`https://www.reelmate.cn/`** | [实测] target_id `B77A04BE…`，正文含 `/` URL |
| `page.json` | 3239548 | 03:17:02 | 同上（`{ok,data}` 包装版） | [实测] |
| `capture.json` | 766546 | 03:14:18 | `analyze_web_bundle` @ 首页 | [实测] 同 target_id |
| `bundle.json` | 598327 | 03:13:59 | 同上（包装版，含 133 chunk 指纹） | [实测] |
| `export.json` | 90909 | 03:17:22 | `export_web_scripts` @ 首页脚本 | [实测] |
| `capture-canvas.json` | 9741926 | 04:10:53 | `inspect_web_page` @ **`/canvas`** | [实测] target_id `B9040F42…` |
| `page-canvas.json` | 9742004 | 04:10:52 | 同上 | [实测] |
| `bundle-canvas.json` | 1207252 | 04:10:20 | `analyze_web_bundle` @ `/canvas` | [实测] |
| `export-canvas.json` | 310779 | 04:11:18 | `export_web_scripts` @ `/canvas` | [实测] |
| `net1.json` | 39881497 | 03:38:38 | `capture_browser_scenario` @ **`/` → `/create/text-to-video` → `/pricing` → `/tools`**（已登录 9223，含 req/res body） | [实测] steps `home>home-wait>t2v>t2v-wait>pricing>pricing-wait>tools>tools-wait` |
| `net1-calls.json` | 2719161 | 03:38:57 | 上者的调用清单投影 | [实测] |
| `net2.json` | 20084551 | 06:45:24 | `@ /create/text-to-video`（fill 提示词 → 点生成 → 等弹窗） | [实测] steps `load>settle>fill-prompt>click-gen>wait-dialog` |
| `net3.json` | 18306257 | 04:01:01 | `@ /create/text-to-video`（0 积分提交 → Insufficient Balance → 跳定价） | [实测] steps `load>settle>fill>click-gen>wait` |
| `net-canvas.json` | 34944624 | 04:05:07 | `@ /canvas` | [实测] steps `load>settle` |
| `net-node.json` | 19110094 | 04:08:17 | `@ /canvas`（点"文本"节点） | [实测] steps `settle>click-text-node>wait-node` |
| `net-explore.json` | 35478857 | 04:12:24 | `@ /film-creation` → **`/cli`** → **`/mcp`** | [实测] steps `film-creation>fc-wait>cli>cli-wait>mcp>mcp-wait`；正文含 `https://www.reelmate.cn/mcp` |
| `scenario-login-out.json` | 10324 | 03:25:05 | 登录弹窗场景 **结果**（第 1 次，3s 等待） | [实测] |
| `scenario-login2-out.json` | 128692 | 03:26:34 | 登录弹窗场景结果（第 2 次） | [实测] |
| `scenario-login3-out.json` | 726567 | 03:27:23 | 登录弹窗场景结果（12s 等待，含 DOM outerHTML） | [实测] |
| `login-modal-dom.txt` | 545555 | 03:27:24 | 登录弹窗打开时的 `/` 整页 outerHTML（含 `loginDialog`、`accounts.wondershare.cn` OAuth iframe、`--app-sidebar-width:240px`） | [实测] |
| `_dom-nodes.json` | 274071 | 10-24 21:06:02 | DOM 节点表 **2053 节点**（`#document`→`html`→`HTML`…，含 H1/H2/TITLE）；页归属 **[未验证]**（同批产物指向首页） | [实测] 节点统计 |
| `_extracted-capture_page.json.html` | 5232 | 21:05:32 | 首页捕获中抽出的 SVG/`__NUXT_DATA__` 片段 | [实测] |
| `api-log.json` | 344330 | 03:39:40 | **110 条请求**：109 条 `app.reelmate.cn` + 1 条 `accounts.wondershare.cn`；前缀 `web/v1/config`(32)、`user`(11)、`buy`(10)、`cam`(10)、`op`(10)、`user-vip-info`(5)、`user-info`(5)、`subject`(5)、`renew`(5)、`msg`(4)、`func-whitelist`(3)、`task`(3)… | [实测] 统计 |
| `api-log-decoded.txt` | 6759 | 04:16:52 | 上者的解码正文（含 `user-info` 原文：uid 267379182 / space 1960443501771751438 / 积分 0） | [实测] |
| `tabids.txt` | 165 | 03:22:59 | 5 个 CDP target_id（首页/工具/文生视频/登录/FAB） | [实测] |
| `tab-explore.txt` | 38 | 04:12:01 | `/film-creation` 的 target_id | [实测] |
| `routes-canvas-new.txt` | **0** | 04:10:35 | 空文件（画布路由抓取失败，无内容） | [实测] |
| `modules.txt` | 4853 | 03:19:23 | chunk 模块名列表（含重复，构建指纹） | [实测] |
| `bundle.err` / `page.err` / `export.err` / `net1.err` / `net2.err` / `net3.err` / `net-canvas.err` / `net-node.err` / `net-explore.err` | **0** | — | 全部为空 = 上述调用均无 stderr 报错 | [实测] |
| `appgraph.err` | 33458 | 03:18:06 | 应用图生成的告警/日志（**非空**，需复核） | [实测] 存在非空 |
| `appgraph.json` | 63133251 | 03:18:07 | 离线 JS 应用图，subject = `E:\wanxing\rea-reelmate\scripts`（**首页 134 脚本**） | [实测] |
| `scenario-login-err.json` | **0** | 03:24:55 | 空 | [实测] |

### 1.3 脚本导出与应用图

| 目录/文件 | 规模 | 时间 | 覆盖对象 |
|---|---|---|---|
| `scripts/` | **134 文件 / 2.67 MB**（含 `manifest.json` 115287 B） | 10-24 03:17 | 首页全量 JS 源码导出 |
| `scripts-canvas/` | **479 文件 / 9.25 MB** | 10-24 04:11 | `/canvas` 编辑器 JS 源码导出 |
| `bundle.json` / `appgraph.json` | — | 03:14 / 03:18 | 首页 bundle 指纹 + 应用图 |
| `bundle-canvas.json` | — | 04:10 | 画布 bundle 指纹 |

### 1.4 CLI / Skill 附件（非 UI，属接口与能力证据）

| 文件/目录 | 规模 | 时间 | 覆盖对象 |
|---|---|---|---|
| `cli-out/model-all.json` | 76619 | 04:42 | **46 个模型目录全量**（`model list --json`） |
| `cli-out/model-video.json` | 58226 | 04:42 | 视频模型目录 |
| `cli-out/model-image.json` | 17880 | 04:42 | 图像模型目录 |
| `cli-out/credits-balance.json` | 179 | 04:42 | 积分余额响应 |
| `cli-out/task-list.json` | 112 | 04:42 | 任务列表响应 |
| `cli-out/canvas-list.json` | 187 | 04:42 | 画布列表响应 |
| `cli-out/credits-balance.err` / `model-video.err` | **0** | 04:42 | 空 |
| `cli-skill/` | **38 命令组 + 8 工作流手册 + 手册 3 篇** | 10-23 09:55 | 官方 Agent Skill 包（`SKILL.md` 7859 B；`commands/episode.md` 30281 B、`resource.md` 46231 B、`novel.md` 35879 B、`storyboard.md` 24683 B；`manual/workflow/_hard-gate.md` 19651 B） |
| `reelmate_cli_skill.zip` | 190073 | 04:14 | 同上压缩包 |
| `model-catalog-summary.json` | 38690 | 04:43 | 46 模型 × 模式 × 端点 × 参数结构化摘要 |
| `REELMATE-逆向分析报告.md` | 28667（364 行） | 04:45 | 业务/接口/计费/鉴权背景，含 §12 运行时实测附录与 §13 附件清单 |

### 1.5 关键完整性验证 [实测]

**`shot-*.json` 是内容寻址的 REA Evidence 包，其 `artifact.sha256` 可与 PNG 文件哈希逐一对齐**——这是本次盘点中最强的溯源证据：

| 证据包 | 指向 PNG | `captured_at`(UTC) | `viewport` | artifact.sha256 == PNG sha256？ |
|---|---|---|---|---|
| `shot-home.json` | `home.png` | 2026-10-23T19:23:21Z | 1424×805 | ✅ YES |
| `shot-tools.json` | `tools.png` | 19:23:23Z | 1424×805 | ✅ YES |
| `shot-t2v.json` | `t2v.png` | 19:23:27Z | 1424×805 | ✅ YES |
| `shot-login.json` | **`login.png`**（非 `login-modal.png`） | 19:23:29Z | 1424×805 | ✅ YES |
| `shot-flow.json` | `flow.png` | 19:23:31Z | 1424×805 | ✅ YES |
| `shot-pricing.json` | `pricing.png` | 19:22:08Z | 1424×805 | ✅ YES |
| `shot-loggedin.json` | `loggedin.png` | 19:37:32Z | 1664×955 | ✅ YES |
| `shot-state.json` | `state.png` | 19:54:37Z | 1664×955 | ✅ YES |

> 8/8 全部一致。`captured_at` 换算为 +08:00 与 PNG mtime **完全吻合**。故 §12 第 1020 行「`shot-*.json` = 截图元数据（viewport / target.url）」的描述 **[实测] 准确**，且比文档说的更强：它们同时携带 `artifact.sha256` 与 `captured_at`。

### 1.6 `_acceptance/` 内的参照站证据（**另一条证据链，规格未登记**）

`_acceptance/ref/`（2026-10-25 17:53–18:09）是**参照站的第二轮抓取**，产出 31 张 PNG + 29 份 HTML + `route-sweep.json` + `measure.json`，脚本为 `ref-*.cjs`（`connectOverCDP("http://127.0.0.1:9222")`）。

**`_acceptance/ref/*.png` 与 `docs/03-frontend/evidence/reelflow/*.png` 是像素级 1:1 同源**（[实测] 全部 11 张，差异 0.000%）：

| `evidence/reelflow/` 正式证据 | ≡ `_acceptance/ref/` 原始产物 | 覆盖路由 |
|---|---|---|
| `01-project-list.png` | `proj-01-list.png` | `/reelflow/list` |
| `02-timeline-editor.png` | `proj-02-editor.png` | **`/reelflow/edit/:projectId`** |
| `03-episode-workspace.png` | `step-00-base.png` | `/series-manage/episode/:id` |
| `04-episode-workspace-2shots.png` | `w-03-addshot.png` | 同上（加镜后） |
| `05-project-assets-panel.png` | `w-04-projasset.png` | 项目资产弹窗 |
| `06-match-asset.png` | `w-05-matchasset.png` | 匹配资产 |
| `07-3d-director.png` | `step-04-3d-director.png` | 3D 导演台 |
| `08-asset-workbench.png` | `page-assets.png` | **`/asset`** |
| `09-asset-confirm.png` | `confirm-base.png`（≡`page-asset-confirm.png`≡`confirm-batch-gen.png`） | `/series-manage/asset-confirm` |
| `10-series-manage.png` | `asset-rail-script.png` | `/series-manage` |
| `11-asset-extract.png` | `page-asset-extract.png` | `/series-manage/asset-extract` |

另有**未进正式证据目录但已存在**的参照产物：`editor-current.png`、`flow-01.png`、`modal-3s.png`（空）、`modal-12s.png`、`page-episode-create.png`、`page-list.png`、`page-script-manage.png`（空）、`probe-create-modal.png`、`probe-list.png`/`probe-list-reload.png`、`proj-03-export-panel.png`、`proj-04-series.png`、`asset-base.png`、`asset-rail-script.png`、`asset-tab-scene.png`、`asset-tab-prop.png`、`step-01-script.png`、`step-03-shots.png`、`w-01-script.png`、`confirm-batch-gen.png` + `route-sweep.json`。

---

## 2. 缺口清单（合并去重）

### 2.1 原始 §9.6「无截图的页面」（`reference-alignment-spec.md:911–931`）

文档原文表行（11 行，`915`–`927`），逐字来源：

| 行 | 路由 | 文档标注 | 文档给的"我们的对应页" |
|---|---|---|---|
| 917 | `/task`（任务中心） | ❌ 无截图 | `pages/tasks.vue` |
| 918 | `/user-center`（个人中心） | ❌ 无截图 | `pages/settings.vue`（近似） |
| 919 | `/team`、`/team/dashboard`、`/team/knowledge-base` | ❌ 无截图 | 无（侧栏「团队管理」置灰） |
| 920 | `/asset`、`/film/assets`（资产库） | ❌ 无截图 | `pages/assets.vue` |
| 921 | `/workflow-canvas` | ❌ 无截图 | 无 |
| 922 | `/reelflow/edit/:projectId`（剪辑器） | ❌ 无截图 | `pages/projects/[id].vue` |
| 923 | `/film`、`/film-creation`、`/film/projects/:id/tasks` | ❌ 无截图 | 无 |
| 924 | `/script-manage`、`/script-view/:id` | ❌ 无截图 | 无 |
| 925 | `/novel-market/:id`、`/novel-to-script-agent/*` | ❌ 无截图 | 无 |
| 926 | `/creator-center/*`、`/ad-drama/*`、`/video-redraw/*` | ❌ 无截图 | 无 |
| 927 | `/pricing` 的 FAQ / 页脚 | ❌ 未滚到底 | 无 |

> 文档第 929 行的处置口径原文：「这些页面若本期要复刻，**必须重新抓图**（登录后逐个页面 `capture_web_screenshot`），不要按"全局设计语言"硬猜具体布局。」

**§9.6 的两处过期（[实测] 修正）**：
- **922 行 `/reelflow/edit/:projectId` —— 已有截图。** `docs/03-frontend/evidence/reelflow/02-timeline-editor.png`（51236 B，10-25 18:05）≡ `_acceptance/ref/proj-02-editor.png`，且 `reference-reelflow-spec.md:77–86` 已给出逐区实测规格（顶栏/左栏 290/中区/底部时间线 150）。**§9.6 此行应删或改为"仅缺导出面板态"**。
- **920 行 `/asset` —— 已有截图。** `08-asset-workbench.png`（163188 B）≡ `_acceptance/ref/page-assets.png`，`reference-reelflow-spec.md:132–139` 已给出完整规格。**此行应收窄为仅 `/film/assets`**。

### 2.2 原始 §7「本轮未取证项」（`reference-reelflow-spec.md:188–196`）

| 序 | 原文（逐字） | 行 |
|---|---|---|
| 7-1 | 分集/剧本编辑页正文（剧本内容编辑器、AI 改稿会话 UI） | 190 |
| 7-2 | 分镜卡的定稿态、素材已上传态、生成结果态 | 191 |
| 7-3 | 5 种生成模式各自的参数区差异 | 192 |
| 7-4 | 资产清单校验有数据时的列表布局（角色/场景/道具分组、勾选、重命名） | 193 |
| 7-5 | 资产提示词审核页 | 194 |
| 7-6 | 导出面板（`时间线导出` 点击后的设置/进度/成品） | 195 |
| 7-7 | 剧本广场 / 小说市场 / 影视版（另一条产品线） | 196 |

### 2.3 合并去重后的缺口清单（**18 条**）

去重规则：§7-6 并入 §9.6 的 `/reelflow/edit/:projectId`；§7-7 并入 §9.6 的 `/film*` 与 `/novel-market`+`/novel-to-script-agent`。故 11 + 7 − 2 = **18**。

| # | 缺口 | 来源 | 参照 URL（`routes.txt` 精确路由 : 行号） | 要采什么 | 建议采法 | 权限/前置 | 优先级 |
|---|---|---|---|---|---|---|---|
| **G01** | 任务中心 | §9.6-L917 | `/task` : **89** | 整页（含列表/筛选/分页/空态）+ DOM + `/web/v1/task` 网络 | `connectOverCDP 9222` → `goto` → `sleep 4500` → `screenshot{fullPage:true}` + `page.content()` + `innerText`，拓 `ref-sweep.cjs` 模式 | 需登录态；**无需特殊权限** | **P0** |
| **G02** | 个人中心 | §9.6-L918 | `/user-center` : **96**（邻近：`/profile` : 70、`/setting` : 86、`/user-settings` : 98） | 整页 + 各 tab + DOM | 同上 | 需登录态 | **P0** |
| **G03** | 团队管理 | §9.6-L919 | `/team` : **90**、`/team/dashboard` : **91**、`/team/knowledge-base` : **92**（邻近 `/film/team` : 58、`/project-members` : 71） | 3 页整页 + 知识库目录树 | 同上 | **需企业/团队空间**（见 §3） | P2 |
| **G04** | 影视版资产库 | §9.6-L920（**已收窄**：`/asset` 已被 `08-asset-workbench.png` 覆盖） | `/film/assets` : **56** | 整页 + 与 `/asset` 的差异对照 | 同上 | **需影视版权限** | P2 |
| **G05** | 无限画布（另一入口） | §9.6-L921 | `/workflow-canvas` : **924** | 整页 + 节点面板（`/canvas` 的 `canvas.png`/`node.png` 是另一入口，不可替代） | 同上 | 需登录态 | P2 |
| **G06** | 剪辑器**导出面板态** | §9.6-L922 ∩ §7-6 | `/reelflow/edit/:projectId` : **74**（`/reelflow/list` : 75、`/reelflow/edit/create` 未登记路由） | **仅缺**：点「时间线导出」后的设置/进度/成品态（基线图已有） | `ref` 模式 + `click` 顶栏「时间线导出」→ 截图；注意 `proj-03-export-panel.png` 已验证**只差顶栏 0.122%**，须确认点开的是真面板而非选中态 | 需登录态 + 已有项目 | P1 |
| **G07** | 影视版 | §9.6-L923 ∪ §7-7 | `/film` : **53**、`/film-creation` : **54**、`/film/projects/:id/tasks` : **57** | 3 页整页 + 任务表格字段系统；`/film-creation` 已有**网络证据**（`net-explore.json`）但**无截图** | 同上 | **需影视版权限（内测申请）** | P2 |
| **G08** | 剧本管理 | §9.6-L924 | `/script-manage` : **79**、`/script-view/:id` : **80** | 整页 + 编辑器 + 版本/审核态 | 同上 | 需登录态 + **需剧本数据** | **P0** |
| **G09** | 剧本广场 / 小说市场 | §9.6-L925 ∪ §7-7 | `/novel-market/:id` : **62**、`/novel-to-script-agent/:id` : **63**、`/novel-to-script-agent/create` : **64**、`/novel-to-script-agent/workbench` : **65**（邻近 `/novel-to-script/:id` : 66、`/series-manage` : 81） | 4 页整页 + 工作台会话 UI | 同上 | 需登录态 + **需已上架小说/剧本条目** | P2 |
| **G10** | 创作者中心 | §9.6-L926 ∪ §7-7 | `/creator-center` : **43**、`/creator-center/:id` : **44**、`/creator-center/earnings` : **45**、`/creator-center/preview/:id` : **46**、`/creator-center/publish` : **47** | 5 页整页 | 同上 | **需创作者资质 + 已上架内容** | P3 |
| **G11** | 广告剧 | §9.6-L926 | `/ad-drama/create` : **11**、`/ad-drama/workspace` : **12** | 2 页整页 + 商品→短剧流程 | 同上 | 需广告剧入口权限 + 商品数据 | P3 |
| **G12** | 视频转绘 | §9.6-L926 | `/video-redraw/create` : **121**、`/video-redraw/workspace` : **122** | 2 页整页 | 同上 | 需登录态 | P3 |
| **G13** | 定价页 FAQ / 页脚 | §9.6-L927 | `/pricing` : **69** | **整页滚动到底**（`pricing.png` 仅 1424×805 视口、`gen-attempt.png` 仅 1280×720） | **零前置**：`goto /pricing` → `screenshot{fullPage:true}`；顺手补 §11-U8 的三态（兑换码/个人订阅/按月购买）与 U9 的第 4 张卡 | **公开可采（免登录）** | **P0** |
| **G14** | 剧本编辑页正文 + AI 改稿会话 UI | §7-1 | `/series-manage/episode/:id` : **85**（邻近 `/episode-list` : 51、`/script-manage` : 79） | 正文编辑器 + AI 会话 diff（apply/reject） | 同 G06 模式；**须带真实剧本**，否则正文区恒为骨架 | 需登录态 + **需剧本数据** | **P0** |
| **G15** | 分镜卡三态 | §7-2 | `/series-manage/episode/:id` : **85** | 定稿态 / 素材已上传态 / **生成结果态** | 前两态成本低；**结果态需 ≥8 积分**（文生视频 5s/720p = 8 积分，见 §12.2） | 定稿态需数据；**结果态需积分充值** | P1 |
| **G16** | 5 种生成模式参数区差异 | §7-3 | `/series-manage/episode/:id` : **85** | `参考生视频 / 首帧生视频 / 文生视频 / 首尾帧生视频 / AI改视频` 各一张右栏 | `ref` 模式 + 逐 mode `click` → 截图（`route-sweep.json` 已确证 5 个 tab 文案） | 需登录态 | P1 |
| **G17** | 资产清单校验「有数据」布局 | §7-4 | `/series-manage/asset-confirm` : **83** | 角色/场景/道具分组 + 勾选 + 重命名 | 同 G06 模式 | 需登录态 + **需提取成功的数据** | P1 |
| **G18** | 资产提示词审核页 | §7-5 | **路由未在 `routes.txt` 确认** [未验证]；疑为 `/series-manage/asset-confirm` : **83** 的下一步 | 提示词列表 + 审核操作 | 先由点击「下一步，自动生成提示词」探路；**注意**：`confirm-batch-gen.png` 已证伪「点下一步即有变化」 | 需登录态 + 数据 | P1 |

**采法通用模板**（现有可复用脚本模式，**[实测] 已验证存在**）：
- **多路由扫描**：`_acceptance/ref-sweep.cjs`（`connectOverCDP 9222` → 逐路由 `goto`/`sleep`/`screenshot`/`content()`/提取 tabs+buttons → 写 JSON）——**本任务所有 G 项的推荐首选**。
- **单页深采 + 量测**：`_acceptance/ref-measure.cjs`（产出 `ref/measure.json`）、`ref-deep.cjs`/`ref-deep2.cjs`、`ref-modal.cjs`/`ref-modal-net.cjs`。
- **状态机点击**：`_acceptance/ref-workspace.states.cjs`、`ref-flow-01.cjs`、`ref-project.cjs`/`ref-project2.cjs`。
- **REA MCP 截图**（§9.6 原文建议）：`capture_web_screenshot`（带 CDP endpoint + target_id，自动写 content-addressed Evidence），对应产物如 `shot-*.json`。
- **本项目实现侧对照**：`_acceptance/shot-align-*.cjs`（打的是 `127.0.0.1:3001` 我们自己的站，**不能用于参照站补抓**，但可作结构模板）。

### 2.4 路由级计数

| 类别 | 条数 | 明细 |
|---|---|---|
| **完全无任何截图** | **25** | G01(1) G02(1) G03(3) G04(1) G05(1) G07(3) G08(2) G09(4) G10(5) G11(2) G12(2) |
| **已有基线图、仅缺关键态** | **4** | G06 `/reelflow/edit/:projectId`、G13 `/pricing`、G14/15/16 共用 `/series-manage/episode/:id`、G17/18 共用 `/series-manage/asset-confirm` |
| **合计需补证据路由** | **29** | 25 + 4 |
| 其中**公开可采（免登录）** | 1 组 | G13 `/pricing` 完整态 |
| 其中**仅需登录态** | 约 8 | G01 `/task`、G02 `/user-center`、G05 `/workflow-canvas`、G06、G12(2)、G16 |
| 其中**需 Owner 提供权限/数据** | 约 20 | 见 §3 |

---

## 3. 登录 / 权限边界

### 3.1 可复用的既有登录态 [实测]

| 资产 | 位置 | 说明 |
|---|---|---|
| 已登录 Chrome Profile | `rea-reelmate/chrome-profile/`（1581 文件 / 246.7 MB） | `reference-reelflow-spec.md:4` 原文：「复用已有登录态 Chrome Profile」 |
| 第二份 Profile | `_acceptance/profiles/user/` | 实测含 Chrome 用户数据 |
| CDP 端点 | `127.0.0.1:9222`（未登录/无头）、`127.0.0.1:9223`（已登录） | [实测] 从 `scenario-*.json` 的 `browser.cdp_endpoint` + UA 反推 |
| 账号事实 | uid `267379182`、space `1960443501771751438`、**积分 0**、`role_code:"master"`、`team_info` 为空 | [文档] `REELMATE-逆向分析报告.md:259–260` + [实测] `api-log-decoded.txt` |
| 凭据文件 | `_acceptance/token.txt`（280 B） | **存在但本轮未读取**（可能含活动 token）。⚠️ 与 `net*.json` 同属敏感物，禁止外传 |

### 3.2 权限边界分级

| 级别 | 判定 | 涉及路由 | 是否需要 Owner |
|---|---|---|---|
| **A. 公开可采（免登录）** | [实测] `x3/x5/x6/x4/cli/mcp/canvas/node/pricing` 等曾在未登录 9222 下抓到 | `/` `/pricing` `/tools` `/canvas` `/cli` `/mcp` `/create/*` 首屏、404、登录弹窗 | ❌ 不需要 |
| **B. 需登录态（普通用户账号即可）** | [文档] §12.1 双 token 续期；几乎所有应用内页 | `G01 /task`、`G02 /user-center`、`G05 /workflow-canvas`、`G06 /reelflow/edit`、`G12 /video-redraw/*`、`G13`(仍免登录)、`G16` | ❌ 不需要（Profile 已有） |
| **C. 需**剧本/项目数据**（非权限，是数据前置）** | [文档] `reference-reelflow-spec.md:20` 原文：「`script-manage` / `script-view/:id` / `film*` / `novel*` ❌ 未取证（**需剧本数据**）」 | `G08 /script-manage` `/script-view/:id`、`G14` 剧本正文、`G17` 资产清单有数据、`G18` 提示词审核、`G09` 小说市场需已上架条目 | ✅ **需 Owner 提供或授权构造数据** |
| **D. 需**积分/付费**（生成结果态）** | [文档] §12.2：0 积分 → `{"code":745701,"msg":"Insufficient Balance"}`；文生视频 5s/720p = **8 积分** | `G15` 分镜生成结果态（§11-U6 同源：`state.png` 从无结果） | ✅ **需 Owner 充值（≥8 积分/次）** |
| **E. 需**影视版权限（内测申请）** | [文档] RE 报告 §1「影视版（内测申请）」；§9.3 影视版开通弹窗 = **扫描二维码联系商务开通** | `G04 /film/assets`、`G07 /film` `/film-creation` `/film/projects/:id/tasks`、`/film/team` : 58 | ✅ **需 Owner 提供已开通影视版的账号** |
| **F. 需**企业/团队空间** | [文档] §12.1 实测 `team_info` 为空（个人空间）→ 团队页无内容 | `G03 /team` `/team/dashboard` `/team/knowledge-base`、`/project-members` : 71 | ✅ **需 Owner 提供团队/企业账号** |
| **G. 需**创作者资质**（投稿/收益/提现）** | [文档] RE 报告 §7：创作者上架小说/剧本 → 预售/协议 → **收益/提现** | `G10 /creator-center/*`（5 路由） | ✅ **需 Owner 提供创作者账号 + 已上架内容** |
| **H. 需**广告主/商品数据** | [文档] RE 报告 §1：广告剧（商品图/卖点 → 广告短剧） | `G11 /ad-drama/create` `/ad-drama/workspace` | ✅ **需 Owner 提供商品数据** |

**需 Owner 提供登录态/权限/数据的类别数 = 6**（C 数据、D 积分、E 影视版、F 团队、G 创作者、H 广告主），覆盖 **约 20 条路由**。若把「剧本数据」并入普通登录态，则最需 Owner 出手的硬权限为 **4 类：影视版(E)、团队(F)、创作者(G)、广告主(H)**。

**已证实的"取证不可能"实例**：
- `/script-manage`（`routes.txt:79`）：`_acceptance/ref/page-script-manage.png` 与 `modal-3s.png` **像素完全相同且为纯 `#0B0B10` 全屏**（非背景像素占比 **0.00%**），`route-sweep.json` 同页 `text` 为空字符串 → **该路由在无数据/无鉴权上下文下渲染为空白，无法作为布局证据** [实测]。
- `/series-manage/asset-extract`（`routes.txt:84`）：`route-sweep.json` 仅得壳层文案「创作手册 商务合作 会员订阅 0」，非背景像素占比 **0.44%** → **需项目上下文**，与 `reference-reelflow-spec.md:38` 原文一致。

---

## 4. `reference-alignment-spec.md` §12「证据索引」核查

### 4.1 逐项存在性（§12 表，行 1001–1023）

核对 §12 表中全部 22 个文件条目 → **指向不存在文件的引用：0 条**。[实测] 全部存在且尺寸/尺寸标注基本吻合：

| §12 声明 | 实测 | 判定 |
|---|---|---|
| `home.png` (1424×805) | 394795 B，1424×805 | ✅ |
| `x6.png` (1664×955) | 656668 B，1664×955 | ✅ |
| `loggedin.png` (1664×955) | 612875 B，1664×955 | ✅ |
| `tools.png` (1424×805) | 115884 B，1424×805 | ✅ |
| `t2v.png` (1424×805) | 65593 B，1424×805 | ✅ |
| `state.png` (1664×955) | 85012 B，1664×955 | ✅ |
| `flow.png` (1424×805) | 23021 B，1424×805 | ✅ |
| `pricing.png` (1424×805) | 59598 B，1424×805 | ✅ |
| `gen-attempt.png` (1280×720) | 349559 B，1280×720 | ✅ |
| `login-modal2.png` (1280×720) | 116763 B，1280×720 | ✅ |
| `login-modal.png` (同尺寸) | 90679 B，1280×720 | ✅ |
| `login-modal-dom.txt` (540KB) | 545555 B（≈532.8 KiB） | ⚠️ 取整口径，非错误 |
| `canvas.png` / `node.png` (1280×720) | 72102 / 72124 B，均 1280×720 | ✅ |
| `x4.png` (1664×955) | 219104 B，1664×955 | ✅ |
| `fc.png` = `cli.png` (1280×720) | 87653 / 86735 B **且像素不同** | ❌ **见 4.2** |
| `x5.png` (1280×720) | 10084 B，1280×720 | ✅ |
| `x3.png` (1280×720) | 4256 B，1280×720 | ✅ |
| `shot-*.json` | 8 个文件；`viewport`/`target.url`/`artifact.sha256`/`captured_at` 均在 | ✅（比文档更强） |
| `routes.txt`（927 条） | 928 行 / **927 条非空** | ⚠️ 计数对，但**漏 `/mcp`**（见 4.3） |
| `model-catalog-summary.json` | 38690 B | ✅ |
| `REELMATE-逆向分析报告.md` | 28667 B / 364 行 | ✅ |

### 4.2 身份不实的引用（**须更正**）

| 位置 | 文档原文 | 实测 | 结论 |
|---|---|---|---|
| `reference-alignment-spec.md:888`、`:1017` | 「`fc.png` = `cli.png`」 | SHA-256 不同（`3185bdec…` vs `e391b193…`）；**像素差 20105/921600 = 2.182%**，差异 bbox `(621,12)–(1280,682)`，最大通道差 88 | ❌ **"`fc.png` = `cli.png`" 不成立（至少非像素等价）**。两图语义（哪张含开通弹窗）**[未验证]**——本会话模型无图像输入能力，无法目视确认，须由具备视觉能力的成员复核后修正文档 |

### 4.3 索引漏列

| 遗漏 | 事实 |
|---|---|
| **`mcp.png`** | 存在（1664×955，110423 B，04:12:24），是 `/mcp` 的**唯一截图证据**，但 §12 表**完全未列**；且 `/mcp` 也不在 `routes.txt` → 双重遗漏 |
| `login.png` | §12 表未列，但 L785 正文引用（「1424×805，未登录首页」）→ 属正文与索引不一致（非悬空引用） |
| `_acceptance/ref/`（31 PNG + 29 HTML + `route-sweep.json` + `measure.json`） | §12 与 §14 引用的是 `_acceptance/align-*.png`，但**未登记 `_acceptance/ref/` 这条参照站证据链**，而 `docs/03-frontend/evidence/reelflow/` 11 张全部由它派生 |

### 4.4 全文档悬空引用扫描（超出 §12 的扩展核查）

对 `reference-alignment-spec.md`（54 个文件名 token）与 `reference-reelflow-spec.md`（61 个，含 `{a,b}` 花括号展开）做全量解析 → **悬空引用 0 条**。唯一"命中"是 `align-pipeline-1..4-*.png` 这类**通配简写**，实际 4 个文件（`align-pipeline-1-outline.png` 等）均存在 → 非悬空。[实测]

---

## 5. 本次审计新发现的证据级事实（供其他成员复核）

以下均为 **[实测]**（Pillow 逐像素 / SHA-256 / JSON 解析），且**不依赖目视**，因此结论稳健：

| # | 发现 | 数据 | 影响 |
|---|---|---|---|
| **N1** | `proj-03-export-panel.png` **并未采到"导出面板"** | 与 `proj-02-editor.png` 仅差 **1403/1146320 像素 = 0.122%**，差异 bbox `(17,13)–(1161,51)` = **仅顶栏一条横带** | **确证 §7-6（导出面板）为真缺口**；`_acceptance/ref/proj-03-export-panel.png` **不能**当作已取证 |
| **N2** | §7-1 / §7-3 亦确证为真缺口 | `step-00-base.png` vs `step-01-script.png` 差 **0.641%**；vs `step-03-shots.png` 差 **0.337%** —— 三图非背景像素占比同为 **90.69%**，正文区未变 | 剧本正文与各生成模式参数区**均未真正取证**；`w-01-script.png`/`step-01-script.png` 不可当作"剧本编辑页证据" |
| **N3** | §7-5（资产提示词审核页）确证为真缺口 | `confirm-base.png` ≡ `confirm-batch-gen.png` ≡ `page-asset-confirm.png`，**三者像素完全相同**（`getbbox() is None`） | 点「下一步」**未产生任何可见变化** → 该状态确实未取证 |
| **N4** | `/script-manage` 参照抓图为**纯空屏** | `page-script-manage.png` 与 `modal-3s.png` 像素相同，全图单一颜色 `rgb(11,11,16)`，非背景像素 **0.00%** | 该路由**不能**作为布局证据；需先解决数据/鉴权前置 |
| **N5** | `modal-3s.png` 是**空屏** | 同上（纯 `#0B0B10`）；`modal-12s.png` 才有内容（与 3s 差 39.98%） | 登录弹窗需 ≥12s 等待；快速采法会得到空图 |
| **N6** | `_acceptance/ref/` 与 `docs/.../evidence/reelflow/` **同源且像素 1:1** | 11/11 张差异 0.000% | 两条证据链**不可重复计数**；正式证据是 `ref/` 的策展副本 |
| **N7** | `fc.png` ≠ `cli.png` | 差 2.182%，bbox `(621,12)–(1280,682)` | 见 §4.2，文档须更正 |
| **N8** | `/asset` 的 tab 切换**确有真实内容变化** | `asset-tab-scene.png` vs `asset-tab-prop.png` 差 **10.304%**；vs `asset-base.png` 差 10.377%；`asset-rail-script.png`（=`/series-manage`）vs `asset-base.png` 差 62.709% | `/asset` 三 tab 证据**可信**，可支撑结构级复刻 |
| **N9** | `routes.txt` **漏 `/mcp`** | `Select-String '^/mcp'` 无命中；`net-explore.json` 前 200KB 内含 `https://www.reelmate.cn/mcp` 与步骤 `mcp`/`mcp-wait` | 「全站路由」基线不完整；`routes.txt` 非权威全集 |

**存量证据"看起来有、实际无效"清单（不得作为布局依据）**：
`page-script-manage.png`（空屏）、`modal-3s.png`（空屏）、`proj-03-export-panel.png`（仅顶栏差）、`step-01-script.png` / `step-03-shots.png` / `w-01-script.png`（正文与 `step-00-base.png` 几乎相同）、`confirm-batch-gen.png`（与 base 完全相同）、`routes-canvas-new.txt`（0 字节）、`scenario-login-err.json`（0 字节）。

---

## 6. 建议补抓顺序（Top 5 + 依据）

排序依据 = **影响面（是否已有对应实现页 / 是否主路径）× 取证成本（权限与数据前置）× 现有证据可复用度**。

| 序 | 缺口 | 为什么排这个位置 | 成本 | 采法 |
|---|---|---|---|---|
| **1** | **G13 `/pricing` FAQ / 页脚完整态** | **零前置**（免登录）、**零成本**（单次 `screenshot{fullPage:true}`）、且我们 `pages/pricing.vue` 已上线 → 采完即可直接做结构级对齐。同时可顺手补 §11-U8 三态与 U9 第 4 卡 | 极低 | `goto /pricing` → `sleep 4000` → `screenshot{fullPage:true}`；再 `click` 三态 tab |
| **2** | **G01 `/task` 任务中心** | 唯一"既有实现页（`pages/tasks.vue`）+ 仅需普通登录态 + 尚零截图"的页面；且 `/web/v1/task` 接口清单已在 `api-log.json`/`net1.json` 中，网络侧可直接对齐 | 低 | `ref-sweep.cjs` 模式 + `fullPage` + `content()` |
| **3** | **G02 `/user-center` 个人中心** | 同上（对应 `pages/settings.vue`）；且 `/web/v1/user-info`、`user-settings`、`user-vip-info` 响应已在 `api-log-decoded.txt` 中，证据闭环成本最低 | 低 | 同 G01 |
| **4** | **G08 `/script-manage` + G14 剧本编辑正文** | **主路径核心**（小说→剧本→分镜流水线起点），当前唯一证据是**空屏**（N4）；`ref/page-script-manage.png` 已证不可用 → 必须重采。合并一次会话完成，边际成本低 | 中（**需 Owner 提供一份剧本数据**） | 先确认「空白是因无数据还是需鉴权」→ 用带数据账号重采；脚本 `script-add` 模式 |
| **5** | **G17 资产清单校验有数据 + G18 资产提示词审核** | §7-4/§7-5 已由 N3 **证伪"已覆盖"**；是 P2/P3 分期（`reference-reelflow-spec.md:180–181`）的直接前置，缺它两期无法验收 | 中（**需提取成功的数据**） | 先跑通一次提取 → 再 `ref-workspace.states.cjs` 模式逐步点击 |

**可并行、不需 Owner 的批次（建议同一次 CDP 会话跑完）**：G13 → G01 → G02 → G05 `/workflow-canvas` → G12 `/video-redraw/*` → G06 导出面板态 → G16 五模式。
**必须等 Owner 授权的批次**：G03/G04/G07（团队+影视版）、G10（创作者）、G11（广告剧）、G15 结果态（积分）。

---

## 7. 未验证项（不得当真）

| # | 事项 | 为什么未验证 |
|---|---|---|
| U1 | `fc.png` 与 `cli.png` 各自的**视觉语义**（哪张是开通弹窗、哪张是 CLI 页） | 已证二者像素不同（N7），但本会话模型**无图像输入能力**，无法目视判定语义 → 须由具视觉能力的成员复核 |
| U2 | `_acceptance/ref/proj-03-export-panel.png` 差异区（顶栏 y13–51）**具体是什么 UI 元素** | 同上（仅知"仅顶栏变化"） |
| U3 | `_dom-nodes.json` 的**页归属** | 文件只含 `index/parent_index/node_type/node_name/attribute_values`，无 URL 字段；同批时间戳指向首页，但未直接证实 |
| U4 | G18「资产提示词审核页」的**精确路由** | `routes.txt` 无对应条目；`/series-manage/asset-confirm` 的下一步可能是同路由内状态而非新路由 |
| U5 | `net-explore.json` 中 `/film-creation`、`/cli`、`/mcp` 各自**具体抓到哪些接口** | 文件 35.5 MB，本轮仅做前 200 KB 的有界抽样（确认了步骤与 URL），未做全量端点归集 |
| U6 | `appgraph.err`（33458 B）**是否含真实失败项** | 未解析内容 |
| U7 | `_acceptance/token.txt`（280 B）内容 | **刻意未读取**（可能含活动凭据）；如需使用请由 Owner 处置 |
| U8 | §9.6 剩下 9 行路由是否也已有被忽略的证据 | 本轮已逐行核对 `rea-reelmate/` 与 `_acceptance/`；但仍可能存在 `_acceptance/` 之外的采集产物 |

---

## 8. 操作建议（交 Lead / Owner 决策）

1. **更正 `reference-alignment-spec.md`**：
   - §9.6 第 922 行删除 `/reelflow/edit/:projectId`（已有 `02-timeline-editor.png`），或改为「缺导出面板态」；
   - §9.6 第 920 行把 `/asset` 收窄为 `/film/assets`（`/asset` 已有 `08-asset-workbench.png`）；
   - 第 888、1017 行「`fc.png` = `cli.png`」须在视觉复核后修正；
   - §12 表补入 `mcp.png`、`login.png`，并登记 `_acceptance/ref/` 证据链。
2. **补全 `routes.txt`**：至少加入 `/mcp`；并核实为何 `/workflow-canvas`（第 924 行）与其余页面路由之间夹着 `/web/v1/*` 端点、以及末尾 925–928 行（`assets`/`members`/`produce`/`tasks`）这类无前缀片段是否为合法路由。
3. **禁止把"文件存在"当"证据成立"**：本次已识别 7 个"存在但无效"的产物（§5 末），建议在补抓流程中加入**自动空白/重复检测**（如"非背景像素占比"与"与同页基线图差异率"阈值门禁）。
4. **补抓前置清单（交 Owner）**：①影视版内测权限账号；②团队/企业空间账号；③创作者资质账号 + 已上架剧本/小说；④≥8 积分用于一次成功生成；⑤一份真实剧本数据用于 `/script-manage`、剧本正文、资产提取链路。

---

*本文件为纯审计产物，未采集任何新证据。所有"实测"结论可由 `_acceptance/` 内现有文件复算（PNG：逐像素差 + SHA-256；JSON：字段统计）。*
