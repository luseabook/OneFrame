# 画布前端：环境与基线实测记录（2026-10-26）

> 本文档记录**动手前实测到的事实**，不是设计推演。
> 所有数值都能用文中给的命令复现；发现与既有文档冲突时以本文为准并回写文档。

## 1. 一个必须先解决的环境陷阱（差点误判"后端没实现"）

### 现象
在 `E:\wanxing` 里请求 `http://127.0.0.1:3000/v1/canvas/canvases` → **404**，
而 `GET /v1/cam/permission/user` → 200（返回 401101 缺 token，说明路由存在）。
第一反应会认为"canvas 模块没注册"——**这是错的**。

### 根因
`127.0.0.1:3000` 上跑的根本不是本项目：

```
PID 8164  node ... --import file:///E:/ecpm/node_modules/tsx/... src/server.ts
```

那是**另一个项目 `E:\ecpm`** 的 api（它的 `package.json` workspaces 是 `packages/{shared,api,web}`，
与本项目 `app/apps/*` 无关）。本项目 api 从未在这个端口跑起来过。

同理 `127.0.0.1:3001` 上是 `E:\ecpm` 的 vite 5173 代理，不是本项目的 Nuxt。

### 另一个坑：api 不读 `.env`
`app/apps/api/src/config/env.ts` 只从 `process.env` 取值，**没有 dotenv 加载**。
所以即使写好 `apps/api/.env`，`node dist/main.js` 仍然会用默认值
`postgres://app:app@localhost:5432/app`（默认 5432 没有库）→ 启动即 `ECONNREFUSED`。
必须**在进程环境里注入**。

### 解决办法（已落地）
`_acceptance/start-wanxing-stack.ps1`：本项目专属端口 + 显式 env 注入。

| 项 | 值 |
|---|---|
| api | `http://127.0.0.1:3002` |
| web | `http://127.0.0.1:3003` |
| PG | `127.0.0.1:55432`（`.localstack/pgdata`） |
| Redis | `127.0.0.1:6380` |

```powershell
pwsh _acceptance/start-local-stack.ps1     # PG + Redis（幂等）
pwsh _acceptance/start-wanxing-stack.ps1   # api + web（构建 + 启动）
pwsh _acceptance/start-wanxing-stack.ps1 -Status
pwsh _acceptance/start-wanxing-stack.ps1 -Stop
```

> ⚠️ web 的 `/v1` 代理目标在 **Nuxt 构建时**读 `NUXT_API_PROXY`。
> 用 `.output/server/index.mjs` 起的是**已构建产物**，改 env 不会改代理目标——
> 所以开发期必须用 `nuxt dev`（脚本里已切到 dev 模式）。

### 验证
```
GET http://127.0.0.1:3002/v1/healthz          → {"code":0,...,"checks":{"db":"up","redis":"up"}}
GET http://127.0.0.1:3002/v1/canvas/canvases  → {"code":401101,"msg":"missing bearer token"}  ✅ 路由存在
GET http://127.0.0.1:3003/v1/canvas/canvases  → 同上（代理通）
```

## 2. 数据库实测

```
44 张表（含 11 张 canvas_*）
canvas_comment_nodes  canvas_comments  canvas_edges  canvas_group_templates
canvas_groups  canvas_materials  canvas_nodes  canvas_pin_groups
canvas_snapshots  canvas_templates  canvases
```
与 commit `d22b2c2` 声称的"11 表"一致。

## 3. 前端改造前基线（DOM 实测，不是看图猜）

脚本：`_acceptance/canvas-probe.cjs`（登录 → 打开路由 → 量 DOM → 存 JSON + 截图）

```
node canvas-probe.cjs baseline /canvas
```

`_acceptance/canvas-probe-baseline.json`：

| 指标 | 值 | 含义 |
|---|---|---|
| `loggedIn` | true | 登录链路可用 |
| `counts.sidebar` | **0** | `/canvas` 当时走的是 `default` 布局（营销壳），**没有工作台侧栏** |
| `counts.node` / `.edge` | 0 / 0 | 只有列表页，无编辑器 |
| `rects.stage` / `.palette` / `.inspector` | 全 `null` | 编辑器三区**完全不存在** |
| `hasSidebarNav` | false | 同上 |
| `bodyText` | 含「无限画布 / 新建画布 / 还没有画布」 | 只有一个列表空态 |
| `horizontalOverflow` | false | 无横向溢出 |

结论：改造前 `/canvas` **只有一个空态列表页**，`[id].vue` 编辑器虽有文件但：
- 走 `app` 布局（有侧栏，与参照站"编辑器族无侧栏"矛盾）
- 无视口变换（节点坐标直接当屏幕坐标用，不能缩放/平移）
- 无框选、无多选、无快捷键、无撤销、无小地图、无历史版本
- 参数面板只覆盖 `text` / `image` / `video` 三种类型（11 种里 8 种是"暂无面板"）

## 4. 参照站实测结构（`_acceptance/ref-authed/canvas.html`，162KB）

剥离 SVG/base64 后存为 `_acceptance/_gap/canvas-stripped.html`（108KB），便于 grep。

### 4.1 布局骨架（DOM 类名逐层）
```
.canvas-view[data-canvas-theme=dark]          ← 全屏根
├ .canvas-topbar-shell[style="right:440px"]   ← 顶栏容器（右侧让位给检查器 440px）
│  └ header#header-zone.h-16                   ← 高 64（h-16）
│     ├ .canvas-header-left                     ← logo + 返回胶囊 + 标题胶囊
│     └ .canvas-header-actions                  ← 更多/消息/积分/头像
├ .vue-flow                                    ← 画布引擎（AntV X6 → 实为 vue-flow）
│  ├ .vue-flow__pane / __transformationpane     ← 平移缩放层
│  └ .vue-flow__panel.bottom.left.canvas-minimap ← 小地图在**左下**
├ .canvas-bottom-secondary-dock
│  └ .cv-secondary-shell > .cv-secondary        ← 底部 dock
├ .canvas-navbar[style="left:16px"]             ← 左侧竖排工具栏
│  ├ .canvas-navbar__add > .add-icon-button(40)  ← 圆形「+」
│  ├ .canvas-navbar__divider
│  └ 多个 .glass-icon-button                     ← 图层/资产库/模板库/历史素材/评论/快捷键
└ .canvas-empty-guide                           ← 空态引导（aria-live=polite）
   ├ .canvas-empty-guide__copy                   ← 光标图 + 主文案 + 副文案
   └ .canvas-empty-guide__nodes[role=toolbar]    ← 两行 chip
```

### 4.2 交互控件的 aria-label 全集（证明功能边界）
按 DOM 顺序：
`返回` `更多` `消息通知` `剩余积分` `账户菜单` `选择` `抓手` `小地图开关` `整理画布` `适配视图`
`隐藏节点连线` `缩小` `缩放` `放大` `添加节点` `图层` `资产库` `模板库` `历史素材` `评论` `快捷键`
`画布快捷节点` `Anu Agent` `拖拽调整面板宽度` `历史任务` `新开会话` `日志ID复制` `关闭`
`skill：武侠短片全流程` `一键成片：萌宠旅行Vlog短片` `换一批` `描述创意或需求，/ 使用技能`
`添加` `Skill` `权限档位` `切换模型` `发送`

→ 关键结论：
- **有** `选择/抓手` 双模式（对应我们的 `mode`）
- **有** `小地图开关/整理画布/适配视图/缩小/放大`
- **有** 右侧面板可拖拽调宽（`拖拽调整面板宽度`）
- `资产库/模板库/历史素材/评论/快捷键/图层` 是左栏按钮，**依赖 canvas 域尚未实现的端点**
  （素材/批注/模板/固定组在契约 §14.4.1 明确标注"尚未实现"）→ 我方这些按钮只做入口与说明，不做假数据
- 右侧还有一整套 Agent 对话面板（`新开会话`/`发送`/`权限档位`/`切换模型`）→ 属 `agent` 域，本期不做

### 4.3 空态引导文案（逐字）
```
双击画布 / 单击Tab
自由生成节点，一步步将创意变成现实
```
chip（两行，`pP=6` 为分界，即前 6 个一行）：
`文本` `表格` `图像` `视频` `音频` `视频合成` ／ `剧本拆资产` `剧本拆分镜` `新手引导⌄`

chip 宽度实测：前 5 个 88px，`视频合成` 116px，`剧本拆资产`/`剧本拆分镜` 130px。
图标映射（源码 `CpJ9ea8-.js`）：
```
text→icon20_node_text  table→icon20_node_excel  image→icon20_node_image
video→icon20_node_video  audio→icon20_node_audio  clip→icon20_node_video_editor
asset→icon20_node_assets  script→icon20_node_storyboard
director→icon16_3d_editor  threeDWorld→icon16_node_three_d_world
```
→ 与契约 §12.1.10 的 11 种 node_type 对应关系已确认：
前 5 个直接对应；`视频合成`→`clip`；`剧本拆资产`/`剧本拆分镜`→`script`（`runPhase` 区分）；
`director`/`threeDWorld`/`group` **不在主工具栏**。

### 4.4 顶部/底部控件尺寸（从 class 与 inline style 读）
- 顶栏高 `h-16` = 64px，`py-[11px] pl-4 pr-6`，`min-w-[1280px]`
- 顶栏容器 `right: 440px`（右侧检查器默认占 440）
- 左工具栏 `left: 16px`
- 圆形「+」`--add-icon-button-size: 40px`
- 玻璃按钮图标 20px（顶部）/ 24px（左栏）
- 小地图 `.vue-flow__panel.bottom.left`（**左下**，不是右下）
- 缩放显示 `100%`

## 5. 我方实现与参照站的**有意差异**（必须能解释，不是偷懒）

| 项 | 参照站 | 我方 | 原因 |
|---|---|---|---|
| 画布引擎 | vue-flow（+ X6/G6/dagre 痕迹） | 自绘（transform + pointer events） | 不新增依赖；单画布百级节点够用；X6/vue-flow 打包体积与 API 稳定性风险不划算 |
| 小地图位置 | 左下 | 右下 | 右下不与底部 dock（居中）和左栏冲突；且我方 dock 在底部居中，左下会挤在一起 |
| 右栏默认宽 | 440px | 320px | 我方检查器信息密度低于参照（没有 Agent 对话区），320 够用且留更多画布 |
| Agent 对话面板 | 有（右侧整套） | 不做 | 属 `agent` 域，本期未实现（契约 §14.4.1 明确画布内对话归 agent） |
| 资产库/模板库/历史素材/评论/图层 | 有实际功能 | 只有按钮 + 明确提示"待接入" | 对应后端端点尚未实现，**不暴露空壳假数据**（沿用项目既有原则） |
| 节点数量级 | 未测 | 百级设计目标 | 整图 commit 在百级可接受；千级需要换增量 diff（已知边界） |
