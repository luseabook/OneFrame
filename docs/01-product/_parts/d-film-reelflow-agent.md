# D8 · 影视版协作 / ReelFlow 剪辑 / 创作 Agent（团队规模化第三线）

> 竞品：万兴剧厂 ReelMate（www.reelmate.cn）。本文只做竞品侧抽取，不含 OneFrame 规划。
> **证据口径**：
> - `routes.txt:N` → `rea-reelmate\routes.txt` 第 N 行（页面路由 + API 路径常量，共 928 行）。
> - `bundle:<模块名>` → `rea-reelmate\capture-canvas.json` 内联的前端编译产物；正文标注模块文件名（`D9zvpvCB.js` = film 任务表客户端；`D7aUDXP7.js` = film 字段类型系统；`Dso67aSD.js` = 团队角色/影视版白名单；`apiAgent*` = agent 域 OpenAPI 客户端）。
> - `报告 §N` → `rea-reelmate\REELMATE-逆向分析报告.md` 章节。
> - `CM:N` → `_acceptance\_gap\contract-draft-cam-film.md` 行；`CA:N` → `_acceptance\_gap\contract-draft-canvas-agent.md` 行；`AE:N` → `_acceptance\_gap\authed-evidence-2026-10-26.md` 行。
> - `FLOW:N` → `docs\03-frontend\reference-reelflow-spec.md`（登录态逐页实测）；`report.json:<page>` → `_acceptance\ref-authed\capture-report.json`。
> - 命令文档行号均为 `rea-reelmate\cli-skill\reelmate-cli-skill\` 下同名文件。
> **标「推断」的条目为工程判断，非文档/代码直述。** 端点方法（GET/POST/…）来自 `bundle:capture-canvas.json` 的 OpenAPI 客户端编译常量，非 `routes.txt`（后者只有路径）。

---

## 1. 域定位

三条线共用同一个账号/空间体系，但**服务对象不同**：

| 子域 | 服务对象 | 一句话定位 | 与主流水线的关系 |
|---|---|---|---|
| **影视版 `film`**（`/web/v1/film/*`） | 团队 / 影视剧组 | 把「一集一镜」的活拆成**可派工的任务表格**（仿多维表格），用工单+审核+画布绑定把个人工具变成**团队排产系统** | 不接管流水线，而是**在流水线之上再包一层管理壳**：一行任务通过 `canvas-bindings` 挂一块画布，画布产物经 `submit-result` 回填为该行的一个**审核版本** |
| **ReelFlow `wf`**（`/web/v1/wf/*`） | 单项目剪辑者 | 独立的**剪辑器数据面**：项目 → 视频 → 切片 → 片段对象（clip，以 `uuid` 标识）→ 资产绑定 → 发布 | **承接**前序产物（成片/分镜视频作为素材进入时间线），是流水线「出片」之后的**时间线编辑与导出**环节 |
| **创作 Agent `agent`**（`/web/v1/agent/*`） | 个人 / 团队统一入口 | 对话式创作 + **Skill 卡（一键成片技能）** 的统一入口，SSE 流式 | 它是**第三条入口**：不新建流水线，而是复用同一套生成任务与模型层；Skill 卡本质是「预编排的提示词+节点计划」 |

三者合起来才是竞品"slogan 的第二半句"（`报告 §1`：`影视级规模化生产 小成本成就大爆款`）——前两条线解决"能不能做出来"，这条线解决"**多少人一起、多大规模、谁审谁改**"。

**这份抽取的实施意义**：本仓已拍板「全站 1:1 复刻」（`docs\02-architecture\adr.md:77` 记 `D-2026-10-26-01` 引入 `canvas`/`agent`/`cam`/`film` 四域；`adr.md:125` 记「覆盖核对靠端点/交互逐条对上」）。原先 `PRD.md:208-214` 把无限画布、协作评论、成片剪辑器、团队/多空间列为 Non-goals（`target-spec.md:149` 引述），四域被改判为必做后，**本文的端点分母与字段口径直接决定 0016_film / 0014_agent 两条迁移和 F2 页面 1:1 能对到什么粒度**。因此本文对"未取证"一律显式登记而不填猜测值。

**本文覆盖的端点分母**（`routes.txt` 连续块，可复现）：`film` 37 路径 / 48 操作（`:775-811`）、`wf` 23 路径 / 26 操作（`:901-923`）、`agent` 12 路径 / 12 操作（`:123-134`）。
> ⚠️ 口径订正：任务书写「agent 约 11 条」，实测 `:123-134` 是 **12 行**，`bundle` 侧也是 12 个 (path,method) 对（`CA:39` 同结论）。`film` 的 37 路径 vs 48 操作来自多方法复用同一路径（如 `canvas-bindings` 一张路径 4 个方法）。

---

## 2. 影视版 `film`：把「个人工具」升级成「团队排产系统」

### 2.1 端点盘点（按子域）

| 子域 | 路径数 | 操作数 | 代表路径（含方法） | 行号 |
|---|---:|---:|---|---|
| 任务表本体 | 6 | 8 | `task-tables`(GET/POST)、`task-tables/:table_id`(PATCH/DELETE)、`apply-template`、`ensure-presets`、`import`、`reorder` | `:782-784`、`:806-808` |
| 字段（列） | 4 | 6 | `fields`(GET/POST)、`fields/:field_id`(PATCH/DELETE)、`fields/reorder`、`fields/batch-restore` | `:785-788` |
| 表视图偏好 | 1 | 2 | `pref`(GET/PUT) | `:789` |
| 行（任务） | 12 | 12 | `tasks`、`tasks/:task_id`、`cells`、`children`、`status`、`notify-assignees`、`tasks/query`、`tasks/reorder`、`tasks/title-matches`、`tasks/unbound-query`、`tasks/batch-delete`、`tasks/batch-restore` | `:790-791`、`:793-794`、`:799-805` |
| 审核 | 3 | 3 | `review`(GET)、`review/comments`、`review/read`（均 POST） | `:796-798` |
| 行 ↔ 画布绑定 | 1 | 4 | `tasks/:task_id/canvas-bindings`(GET/POST/PUT/DELETE) | `:792` |
| 画布侧绑定/面板 | 5 | 5 | `canvases/visible?tab=`、`canvases/:canvas_id/task-panel`、`task-bindings`、`submit-result`、`DELETE canvases/:canvas_id` | `:775-779` |
| 任务模板 | 2 | 3 | `task-templates?scope=`(GET/POST)、`task-templates/:template_id`(DELETE) | `:809-810` |
| 导出 | 1 | 2 | `exports`(GET/POST) | `:780` |
| 最近打开 | 1 | 2 | `recent-open`(GET/POST) | `:781` |
| 统计 | 1 | 1 | `tasks/stats`(GET) | `:811` |
| **合计** | **37** | **48** | 6+4+1+12+3+1+5+2+1+1+1=37；8+6+2+12+3+4+5+3+2+2+1=48 | — |

**准入是一条独立闸门**：`film` 域在 156 条 route→permission 映射里 **0 条命中**（`CM:201-203`），改用功能白名单 `GET /web/v1/func-whitelist?scene=ai_film` → `{check:bool}`（`bundle:Dso67aSD.js` 的 `checkFilmWhitelist()`；路径见 `routes.txt:812`）。
→ 产品含义：影视版是**商务开通制**（页面实测：`/film-creation` 文案「开通 AI 影视创作 / 扫描上方二维码，联系商务，开通影视创作权限」，`report.json:film-creation`、`ALIGN §9.3`），不是自助订阅。

### 2.2 任务表格数据模型：`table → fields → tasks → cells`

```
project_id (film 项目)
 └ task_table   {table_id, project_id, name, is_preset, sort, version}
    ├ field      {field_id, table_id, key, name, field_type, is_system,
    │             is_unique_type, sort, config_json, hidden, width}   ← 列定义
    ├ task(行)   {task_id, table_id, parent_id("0"=根), sort, version,
    │             created_by, cells{field_id→value}, produce{canvas_ids[]},
    │             review{latest_version_no, version_id, thumb_file_id, unread},
    │             children[]}                                        ← 可树形（子任务）
    │  ├ cell    {field_id, value}                                   ← 稀疏 map，"清空"=缺键
    │  ├ review  {version_no, version_id, submitted_by, submitted_at,
    │  │          assets[{id,file_id,name,media_type,sort}], comments[], unread}
    │  └ canvas_binding {canvas_id}                                  ← 行 ↔ 画布
    ├ table_pref {hidden_field_ids[], filter[{field_key,op,value}],
    │             ui{row_height, column_widths{field_id:px}, sorts[{field_id,order}]}}
    └ template   {template_id, name, scope, owner, fields[]}
```

归一化函数逐字段实证（`bundle:D9zvpvCB.js` 的 `p/b/te/se/_/u`）：
- 表：`is_preset` 归一为 `0|1`，`version` 是**表级乐观锁初值**。
- 行：`parent_id` 缺省补 `"0"`；`version` 缺省 `1`；`cells` 非对象时补 `{}`；`produce.canvas_ids` 一定回数组；`review` 只在服务端返回时才出现。
- 偏好：`ui.row_height` 归一为字符串，`column_widths` 只保留正整数，`sorts` 只保留 `asc|desc`。

**行高枚举（实测常量）**：`{compact:56, medium:56, loose:72, xlarge:96}`（`bundle:D7aUDXP7.js`）。

### 2.3 字段类型系统：客户端 9 种已实证，服务端契约仍 unknown

> 报告 `§10:245` 明确把「影视版任务表格的字段类型系统」列为**遗留未知**。本轮从客户端编译产物把口径缩小到「只剩 `config_json` 未取证」，但**服务端校验强度与唯一性执行位置仍是 unknown**（`CM:53-54`、`CM:975`）。

`bundle:D7aUDXP7.js`：`b=["text","asset_ref","link","user","date","canvas_ref","task_status","review_ref","points_ro"]`（9 种）；用户可建 8 种（`points_ro` 被 `Ie(t)=>t!=="points_ro"` 排除）。

| # | `field_type` | i18n key | 默认宽 | `isUnique` | 空值（`emptyValue`） | `filterValueKind` | 编辑约束 |
|---|---|---:|---|---|---|---|---|
| 1 | `text` | `fieldTypes.text` | 180 | 否 | `""` | `textSuggest` | 自由文本 |
| 2 | `asset_ref` | `fieldTypes.assetRef` | 200 | 否 | `[]` | `none` | 素材引用（图/视/音）；`fromExcel` 按扩展名判 `image|video`，可从列名/内容识别为素材列 |
| 3 | `link` | `fieldTypes.link` | 220 | 否 | `null` | `text` | `{title,url}`；`detectExcelColumn` 认 `链接/url/link` 列名或 `https?://` 内容 |
| 4 | `user` | `fieldTypes.user` | 200 | **是** | `[]` | `person` | 人员 id 数组；`encodeCell` 走 JSON 字符串，`decodeCell` 兼容 JSON 与逗号分隔 |
| 5 | `date` | `fieldTypes.date` | 140 | 否 | `""` | `date` | `YYYY-MM-DD`；`fromExcel` 取 trim；非法日期 `zt()` 判空 |
| 6 | `canvas_ref` | `fieldTypes.canvasRef` | 140 | **是** | `[]` | `none` | `canvas_ids[]`（行 ↔ 画布） |
| 7 | `task_status` | `fieldTypes.taskStatus` | 128 | **是** | `"not_started"` | `status` | 只允许 5 值枚举（见 §2.5） |
| 8 | `review_ref` | `fieldTypes.reviewRef` | 180 | **是** | `[]` | `none` | 审核版本只读投影 |
| 9 | `points_ro` | `fieldTypes.pointsRo` | 120 | **是** | `0` | `number` | **只读**：`encodeCell` 直接 `throw new Error("points_ro is read-only: 积分由画布消耗结算，禁止前端写 cell")` |

**过滤算子集**（实测，`pref.filter[].op` 与 `tasks/query` 的 filter 共用；`CM:783-787` 同结论）：
- `text / link / user / task_status` 共用一套：`eq / neq / contains / notContains / empty / notEmpty`
- `date` 用 `Jt` 集：`eq / lt / gt / lte / gte / notEmpty / empty`（`lt/gt/lte/gte` 的 i18n label 分别是 `before/after/beforeOrEq/afterOrEq`）
- `points_ro` 用 `re` 集：`eq / neq / gt / lt / gte / lte / empty / notEmpty`（纯数值比较）
- `asset_ref / canvas_ref / review_ref` 的 `filterValueKind` 是 `none`（无值级过滤语义，只能按空/非空）

> 客户端每类各自的 `filterOps` 变量已逐一实证（`bundle:D7aUDXP7.js`：`text→L`、`link→L`、`user→L`、`task_status→L`、`date→Jt`、`points_ro→re`、`asset_ref/canvas_ref/review_ref→W`）。

**⚠️ `is_unique_type` 的语义是「该 field_type 每表至多一个」，不是「值唯一」**：
`_e(t,e)` 收集其它字段里 `isUnique` 且 type≠e 的 type 集合，`dn(t,e)` 返回 `!集合.has(e)` —— 判断的是"能不能再加一个这种类型的列"，与单元格取值无关（`bundle:D7aUDXP7.js`；`CM:53-54` 已把这条列为「必须提醒实现方的反直觉点」）。

**仍 unknown（登记为缺口，不得臆造）**：`config_json` 的 schema（各类型各自存什么）、服务端是否做类型白名单外的校验、唯一性在哪一层执行、`is_system` 的服务端语义（客户端只用来禁止改名/删除：`cn(t)=>!t.is_system`）。

### 2.4 默认列与系统列（新建表的"出厂形态"）

系统列 6 个（`bundle:D7aUDXP7.js` 的 `o={Title:"title",Assignees:"assignees",Produce:"produce",TaskStatus:"task_status",Review:"review",Points:"points"}`）：

| key | 显示名 | type | 说明 |
|---|---|---|---|
| `title` | 任务名称 | `text` | 行标题，另有 `tasks/title-matches` 做重名校验 |
| `assignees` | 人员 | `user` | 派工对象，配 `notify-assignees` 通知 |
| `produce` | 内容制作 | `canvas_ref` | 指向画布，即"这一行的活在哪儿干" |
| `task_status` | 任务状态 | `task_status` | 5 值状态机 |
| `review` | 结果审核 | `review_ref` | 审核版本投影 |
| `points` | 积分结算 | `points_ro` | 只读，由画布消耗聚合 |

默认 10 列（`un()`）：任务名称 / 任务描述 / 人员 / 参考素材 / 开始日期 / 截至日期 / 内容制作 / 任务状态 / 结果审核 / 积分结算。
→ 产品含义：这套默认列**就是一张"影视剧组派工单"**——名称+描述（干什么）、人员（谁干）、参考素材（拿什么干）、起止日期（什么时候干完）、内容制作（在哪干）、状态/审核/积分（干完怎么验收怎么结账）。

### 2.5 行写入契约：整行版本 CAS + 稀疏 map + 只读列

| 约束 | 内容 | 证据 |
|---|---|---|
| 整行 CAS | `PUT .../tasks/:task_id/cells` 带 `version`，与行 `version` 不等即冲突（客户端按业务码抛错），成功 `version+1` | `bundle:D9zvpvCB.js` `putCells`（`{version, cells:[{field_id,value}\|{field_id,clear:true}]}`）；码表见 `CM:649-650` |
| 稀疏 map | 响应是 `cells:{<field_id>: value}`；无值=无键，"清空"用 `clear:true` 而不是写 `null` | `bundle:D9zvpvCB.js` `_(e)`；`CM:459`、`CM:651-653` |
| 只读列 | `points_ro` 前端直接抛错，值只能服务端聚合 | `bundle:D7aUDXP7.js` |
| 批量分片 | 删/恢复按 **100** 分片（`var k=100,f=100`），建行 `count` 被夹取到 **1..100**，`tasks/query` 默认 `page_size=200` | `bundle:D9zvpvCB.js` `batchDeleteTasks`/`batchCreateTasks`；`CM:223-229` |
| 行内并发 | 所有写请求体自动注入 `client_id`（回声抑制，`function c(e){const t=Y();return t?{...e,client_id:t}:e}`） | `bundle:D9zvpvCB.js` |

**5 值状态机**（`bundle:D7aUDXP7.js`，中文映射同文件 `ht`）：

| 值 | 枚举 | 中文 | 可编辑态 |
|---|---|---|---|
| 1 | `not_started` | 未开始 | ✅（`_t=["not_started","in_progress"]`，`yt` 集合判定 `Le()`） |
| 2 | `in_progress` | 制作中 | ✅ |
| 3 | `pending_review` | 提交审核 | ❌ |
| 4 | `rejected` | 驳回修改 | ❌ |
| 5 | `done` | 定稿完成 | ❌（`Pe(t)=>t==="done"`） |

另有中文入参别名表 `Tt`（`待审核→pending_review`、`已驳回→rejected`、`已完成→done`），非法值回落 `not_started` —— **导入/批量场景的容错设计**。
派生集合：`_t`（可编辑态）、`gt=new Set(G)`（合法全集，`POST .../status` 用它校验）。

### 2.6 审核流：版本链 + 评论 + 已读回执

```
行(task) ──提交──▶ review version_no=N（V01, V02…，label = "V"+padStart(2,"0")）
              ├ assets[]  {id, file_id, name, media_type(image|video), sort}
              ├ comments[] {comment_id, asset_id?, content, author_wsid, created_at}
              └ unread     ← review/read 标记后清空
```

| 环节 | 端点 | 已取证语义 |
|---|---|---|
| 拉版本链 | `GET .../tasks/:task_id/review` | 返回 `{versions[], unread}`；每个 version 含 `version_no/version_id/submitted_by/submitted_at/assets[]/comments[]`；客户端按 `submitted_at` 倒序、同秒再按 `version_no` 倒序（`bundle:D9zvpvCB.js` 的 `l(a)`） |
| 发表评论 | `POST .../review/comments` | 支持挂在具体版本、可选挂具体素材（`asset_id`） |
| 标已读 | `POST .../review/read` | 客户端 `markRead(versionId)` 后本地清 `unread` |
| **决策入口** | **未观测** | `routes.txt` 全量无 `review/approve\|reject`；审核决策疑似走 `POST .../tasks/:task_id/status`（把行状态推到 `done`/`rejected`）——**推断**，`CM:977` 已列为 A3 假设 |

**画布提交即触发审核**（`bundle` 实证的状态跳转上报）：画布侧 `submit-result` 成功返回后，前端对每个被提交的行上报
`{change_source:"canvas_submit", from_status:<原状态>, to_status:"pending_review", project_id, task_id, status:"success"}`，并逐个 `review.invalidate(taskId)` 使审核缓存失效、刷新任务面板与字段（`bundle:D7aUDXP7.js` 的 `d()`）。
→ 这是三线中**唯一"产物自动进入审核"的通道**：画布干完活，被绑定的行自动变「提交审核」，不需要人去手改状态。
> 说明：`from_status/to_status` 的上报是**前端埋点式**（同一函数里另有 `FA({...submit_version, asset_count, status})` 遥测），服务端是否同步落 `status=3` 需以响应体为准——**推断**：服务端在 `submit-result` 内完成状态推进，前端埋点只是镜像。未取得响应体，登记于 §7 #3。

### 2.7 画布绑定：三种绑定 + 一个回填

| 绑定方向 | 端点 | 参数（实测） |
|---|---|---|
| 行 → 画布 | `.../tasks/:task_id/canvas-bindings` GET/POST/PUT/DELETE | POST `{canvas_id}`；PUT 全量替换 `{from_canvas_id, canvas_id}`；另有"新建并绑定"（`createAndBind`，body 多一个 `name`） |
| 画布 → 行（面板） | `GET canvases/:canvas_id/task-panel` | 返回 `tabs:[{task_id, table_id, title, task_status}]`，即"这块画布上挂着哪几行活" |
| 画布 → 行（绑定列表） | `GET canvases/:canvas_id/task-bindings` | `{list:[{task_id, table_id}]}` |
| 画布产物回填 | `POST canvases/:canvas_id/submit-result` | `{request_id, task_ids[], nodes:[{node_id,file_id,name,media_type,sort}], version_id?}`（`bundle:D9zvpvCB.js` `submitResult`） |

`canvases/visible?tab=` 的 `tab` 实测常量是 `"all"`，`recent` 走 `recent-open`（`bundle:D9zvpvCB.js` 的 `Q="all"`、`Ut="recent"`）——即画布选择器有 **全部 / 最近** 两个来源。
`DELETE canvases/:canvas_id` 存在但**语义存疑**：更像"从影视版移除这块画布"而非删画布本体（`CM:982` A8，推断）。

### 2.8 任务模板与导出

| 能力 | 端点 | 已知结构 |
|---|---|---|
| 模板列表 | `GET task-templates?scope=` | `queryNames:["scope"]` |
| 模板存 | `POST task-templates` | 客户端字段形态 `{name, scope, fields[], previewUrl?}`，`scope` 取值 `official/team`（**来自前端 fixture，非服务端契约**，`bundle:D7aUDXP7.js` `Be()` 带 `__fixture:true`） |
| 模板删 | `DELETE task-templates/:template_id` | — |
| 应用模板 | `POST task-tables/:table_id/apply-template` | `{template_id, replace?}` 形态；返回以"新增了几个字段"计（`CM:734`） |
| 导入表 | `POST task-tables/import` | `{file_id, file_name, mode, table_id?, sheet_name?, is_append?}` → `{job_id, status, table_ids[]}`（异步，**轮询端点未观测**，`CM:985` A11） |
| 导出 | `GET/POST exports` | POST `{table_ids:[], format?}`；`file_uri` 为 storage key，签名 URL 短效（**格式/是否异步未取证**，`CM:986` A12） |
| 预置表 | `POST task-tables/ensure-presets` | form 编码，`paramNames:["project_id"]` |

### 2.9 协同：任务表是 WebSocket 广播式协同编辑

`bundle:D9zvpvCB.js`：
```js
channel = `film_table_${wsid}_${tableId}`
ws = `/v1/rmwebsocket/film/tables/${tableId}/collab/${channel}
       ?project_id=&session_id=&client_id=&mode=&t1={wsid}&t2={opUserId}`
```
- 结论：任务表**不是"加锁-独占"模型**（对比画布的 `nodes/:id/lock|heartbeat`，`报告 §12.5:302`），而是**广播 + `client_id` 回声抑制**的乐观协同。
- 帧协议完全未知（`CM:983` A9）；契约上只把 HTTP 写接口当权威路径，WS 作可选加速。

### 2.10 目标用户与使用场景

| 维度 | 结论 | 证据 |
|---|---|---|
| 用户 | 影视剧组/工作室，需商务开通 | `report.json:film-creation`「联系商务，开通影视创作权限」 |
| 页面矩阵 | `/film`（项目列表+资产库+团队 tab）、`/film-creation`（开通）、`/film/:id`、`/film/assets`、`/film/team`、`/film/projects/:id/tasks`（任务表格） | `routes.txt:53-58`；`report.json:film` 导航为 `项目/资产库/团队/返回首页`；`AE:49` |
| 与"短剧工作流"的差别 | 短剧线是「一集一镜」的自助生产；影视版是**多岗位分工 + 审核 + 结算**的管理面 | 11 级角色里专设 `film_producer(10)`/`film_maker(11)`（`bundle:Dso67aSD.js`） |
| 实测限制 | 本轮账号**无影视版内测权限**，`/film` 只渲染空壳（`全部影视项目 / 好故事一定有市场！ / 创建项目`），任务表格 DOM 未取到 | `report.json:film`、`AE:22`、`AE:125` |

---

## 3. ReelFlow `wf`：剪辑器的数据面

### 3.1 端点盘点（23 路径 / 26 操作，含方法与查询参数）

| # | 方法 | 路径（去 `/web/v1`） | body | 关键参数 | 行号 |
|---:|---|---|---|---|---:|
| 1 | POST | `/wf/project` | json | （建项目，**实测可用**：`{"project_name":"证据项目"}` 未扣积分） | 914 |
| 2 | GET | `/wf/project` | query | `page,page_size,sort_direction,status` | 914 |
| 3 | GET | `/wf/project/:id` | query | — | 915 |
| 4 | PUT | `/wf/project/:id` | json | — | 915 |
| 5 | DELETE | `/wf/project/{id}` | json | （**实测 200**，`FLOW:17,23`） | 916 |
| 6 | POST | `/wf/video` | json | 建视频/素材条目 | 918 |
| 7 | GET | `/wf/video-list` | query | `page,page_size` | 920 |
| 8 | GET | `/wf/video-detail` | query | `task_id` | 919 |
| 9 | GET | `/wf/video-project` | query | `project_id` | 921 |
| 10 | POST | `/wf/video-slicing` | json | 切片/拆条 | 923 |
| 11 | POST | `/wf/video-retry` | json | 重试 | 922 |
| 12 | POST | `/wf/del-video` | json | 删视频 | 911 |
| 13 | GET | `/wf/clip-object` | query | `project_id, uuid` | 909 |
| 14 | POST | `/wf/clip-bind-asset` | json | 片段绑资产 | 906 |
| 15 | POST | `/wf/clip-bind-uuid` | json | 片段绑 uuid | 907 |
| 16 | PUT | `/wf/clip-bind-uuid` | json | 改绑 | 907 |
| 17 | GET | `/wf/clip-generate-record` | query | `project_id, uuid, status` | 908 |
| 18 | PUT | `/wf/del-clip-gen-record` | json | 删生成记录 | 910 |
| 19 | POST | `/wf/asset` | json | 注册资产 | 903 |
| 20 | POST | `/wf/asset-detail` | json | 资产详情 | 904 |
| 21 | GET | `/wf/object-file` | query | `project_id, uuid` | 913 |
| 22 | POST | `/wf/file-metadata` | json | 文件元信息 | 912 |
| 23 | POST | `/wf/batch-download` | json | 批量下载 | 905 |
| 24 | POST | `/wf/publish` | json | **发布** | 917 |
| 25 | POST | `/wf/agent-project` | json | Agent 建项目（推断：AI 侧入口） | 901 |
| 26 | POST | `/wf/agent-task` | json | Agent 建任务（推断） | 902 |

（方法/查询参数全部来自 `bundle:capture-canvas.json` 的 `apiWf*RequestConfig` 常量；`routes.txt` 只给路径。）

### 3.2 产品闭环

```
建项目(POST wf/project)
   → 导入/生成视频(POST wf/video, wf/video-slicing 切片)
   → 视频列表(GET wf/video-list / wf/video-project / wf/video-detail)
   → 片段对象(clip, uuid) ← 绑定资产(clip-bind-asset) / 绑 uuid(clip-bind-uuid)
   → 片段生成记录(clip-generate-record) 可删(del-clip-gen-record)
   → 预览/取文件(object-file, file-metadata, asset, asset-detail)
   → 发布(publish) → 批量下载(batch-download)
```

### 3.3 界面侧已取证的部分（一手实测）

| 区域 | 实测结论 | 证据 |
|---|---|---|
| 项目列表 `/reelflow/list` | 顶部仅两 tab：`项目 (N)` / `已导出`；空态「点击下方创建一个新项目」+ 底部悬浮胶囊「创建项目」；卡片 ≈330×250（缩略图 310×140 + 标题 + `最后编辑于 …` + `⋮`） | `FLOW §4.1:66-75`（tab 实测见 `:68`）；`report.json:reelflow-list` |
| 剪辑器 `/reelflow/edit/:projectId` | 顶栏 64h（`返回分镜创作` / `时间线导出` 选中态 / `保存`）；**左栏「剧集资产」宽 290**（`全部` 下拉 + `已定稿` 复选 + 分镜分组 + 空态`暂无素材`）；中区播放器 + 提示「请在左侧选择分镜资产加入至时间线」；右下紫色气泡「更新分镜」；**底部时间线 ≈150 高**（播放/`00:00:00 / 00:00:00`/缩放 `- ──●── +`/按 1 分钟一格的刻度尺） | `FLOW §4.2:77-86` |
| 时间线语义 | 「时间线材料**不会自动更新**，点击"更新分镜"将同步分镜创作页的全部定稿素材」 | `FLOW:85` |
| 页面互跳 | `/reelflow/edit/:id` ↔（返回分镜创作）`/series-manage/episode/:id` | `FLOW:42-43` |

### 3.4 已取证 vs 未知

| 项 | 状态 |
|---|---|
| 项目 CRUD / 列表分页与排序 | ✅ 实测（`FLOW:17,23` + bundle 方法参数） |
| 视频 / 切片 / clip-object / 资产绑定 / 发布 / 批量下载 | ✅ 端点与方法已确认；❌ **请求体字段与响应结构未取证** |
| 时间线数据模型 | ❌ `report §10:244` 明确「ReelFlow 剪辑器 `timeline` JSON 的完整 schema」未知；只知画布 `clip` 节点带 `timeline` JSON 与 `exportSettings`（`node.md:85`），**但那是画布节点参数，不是 wf 时间线** |
| `wf/publish` 的"发布"到哪 | ❌ 未知（推断：成片交付/上架，与 `已导出` tab 对应） |
| `wf/agent-*` 与 `/web/v1/agent/*` 的关系 | ❌ 未知（推断：ReelFlow 侧的 Agent 入口，非创作 Agent 主链路） |
| CLI 是否覆盖 wf | ❌ **不覆盖**：38 命令组里无 `wf`/`reelflow`/`timeline`（`clip.md` 的 `clip create/crop` 挂的是 `canvas/:canvas_id/clip|crop`，`clip.md:3,20-21`，与 `wf/*` 无关） |

> ⚠️ 高频误读：`reelmate clip create` **不是** ReelFlow 剪辑，是「整画布视频合成」（`clip.md:3`）；真正的 `wf` 剪辑域**没有 CLI 命令面**。

---

## 4. 创作 Agent `agent`：对话 + Skill 卡

### 4.1 端点（12 路径 / 12 操作）

| 行 | 路径（去 `/web/v1/agent`） | 方法 | body/query | 作用 |
|---:|---|---|---|---|
| 123 | `/home/resource/info` | GET | `id` | 首页资源详情 |
| 124 | `/home/resource/recommend` | GET | — | 首页资源推荐（卡片列表） |
| 125 | `/home/resource/sse` | GET | `id` | 同上的 **SSE 变体** |
| 126 | `/stt-token` | GET | — | 语音输入票据（第三方 STT 临时凭证） |
| 127 | `/task/batch-download` | POST | json | 批量下载会话产物 |
| 128 | `/task/chat` | POST | json | 发一条对话消息 |
| 129 | `/task/chat-end` | POST | json | 结束会话 |
| 130 | `/task/create` | POST | json | 建任务（真正下单） |
| 131 | `/task/create-check` | POST | json | **下单前预检** |
| 132 | `/task/share/{share_id}/sse` | GET | — | **公开分享会话的 SSE**（无需登录态推断） |
| 133 | `/task/stream` | POST | `task_id` + **raw body** | SSE 主通道 |
| 134 | `/task/{task_id}` | PUT | json | 更新任务（**推断**：改名或反馈；`routes.txt:134` 未标方法，bundle 仅见 PUT；`CA:760` 给的草案形状是 `{title?}` 或 `{feedback:{reaction,comment?}}`） |

> 关键怪点：`/task/stream` 是 **POST + `RequestBodyType.raw` + query 带 `task_id`，响应却是 SSE**（`bundle:apiAgentTaskStreamPOST`）。这是与画布会话 SSE（`GET .../stream`，`CA:848`）的**不一致点**——同一产品里两套 SSE 动词。`CA:767` 已把 `raw` body 内容列为未知（G-12）。
> 另注：`/task/{task_id}` 在 `routes.txt:134` 是单行，但 bundle 里**只有 PUT** 没有 GET（`apiAgentTaskTaskIdPutRequestConfig` 唯一命中）——GET 是否真实存在**存疑**，登记为缺口。

### 4.2 会话模型

| 实体 | 已知字段 | 证据 |
|---|---|---|
| 会话 | `task_id`（即会话 id，Agent 侧"会话=任务"合体） | `/task/{task_id}`、`stream?task_id=` |
| 消息 | 至少 `content`；客户端有 `message_id` 概念 | `bundle` 中 `message_id` 19 处 |
| 会话生命周期 | `create` → `chat`×N → `chat-end`（显式结束） | `:128-130` |
| 与画布会话的关系 | CLI 把画布内 Agent 实现为 session（`agent session create NAME [--canvas ID]`，`--canvas` **可选**）→ 推断：Agent 会话可脱离画布存在 | `agent.md:8,20,36` |
| 客户端的"未实现"自述 | 「当前稳定入口是 `agent session create`，其它 session/SSE 操作是否可用以后续版本为准」；「当前部署不支持的操作会返回明确的不可用错误，不会伪造成功」 | `agent.md:3`、`:63`、`:85` |

> 产品含义：Agent 在竞品里是**双层形态**——Web 端有完整对话 UI（见 §4.6），CLI 端只开放了会话创建，**其余能力尚未对外开放**。这是"Agent 能力比界面更晚成熟"的典型过渡态。

### 4.3 SSE 协议形态（画布 Agent 已实测，创作 Agent 推断同构）

已证实的事实（`CA:823-843`，源 `capture-canvas.json` 内联 bundle）：
- 客户端**不用原生 `EventSource`**，而是 `fetch` + 手写 SSE 解析（`text/event-stream`、`Last-Event-ID`、`retry:`、`AbortController`）——因为要带 `Authorization` 头。
- 必带头：`Authorization: Bearer …` + `X-Space-Id`（为空或 `"0"` 时**等 1s 重连**）。
- 心跳两种名：`ping` / `heartbeat`，客户端直接忽略。
- 帧体：`data: {"id":"<stream_id>","type":"<event_type>","payload":{...}}`；`event:` 字段**可省**（只有 `data:`+`id:` 也合法）；`payload.type` 会被提升为事件类型。
- 续传：`?last_stream_id=<上一帧 id>`。
- 退避：`maxAttempts=5`、`baseDelay=1000`、`maxDelay=30000`、`openWhenHidden=true`。
- 已见事件字面量（**不保证全集**）：`user_message`、`hitl_required`、`model_step`（含 `model_step.*` 前缀）、`skill_status`（含前缀，被消息列表过滤不显示）。
- 完整事件表 **仍是未知**（`报告 §10:246`）。

创作 Agent（`/web/v1/agent/task/stream`）的帧格式**未直接取证**，推断与上述同构——依据：同一前端、同一 `text/event-stream` 常量（bundle 内 3 处 `text/event-stream`）、`share/{id}/sse` 与 `home/resource/sse` 都是 SSE 变体。

### 4.4 `create` / `create-check` 两步创建

| 步骤 | 端点 | 推断的语义 | 依据 |
|---|---|---|---|
| ① 预检 | `POST /agent/task/create-check` | 只校验不落库：检查积分/审核/参数，返回能否下单 | 命名 + 与 `POST /task/create` 成对出现；**推断** |
| ② 下单 | `POST /agent/task/create` | 真正创建生成任务，返回 `task_id` | 同上 |
| ③ 观察 | `POST /agent/task/stream?task_id=` | 同一条 SSE 通道既推**对话**也推**任务进度** | `CA:868-870` 的分层设计（进度只放引用，结果回 REST） |

> 为什么值得关注：竞品在"对话式下单"这类**不可撤销**动作上做了显式两步（先 check 再 create），避免"用户说了句话就被扣费"。这是对话式产品的必要防御，不是冗余。

### 4.5 STT 语音输入

`GET /agent/stt-token` 返回**临时票据**而非直接上传——推断为第三方 STT（长连接或直传）的短效凭证模式（`CA:756` 给了 `{provider, token, expires_at}` 的草案形状，**未实测**）。产品含义：Agent 输入支持"说一句话"而不是打字，这对移动端/大屏形态（`/agent/bigscreen`，`routes.txt:15`）尤其必要。

### 4.6 页面矩阵

| 路由 | 页面 | 实测状态 | 证据 |
|---|---|---|---|
| `/creation-agent` | **创作 Agent 主入口（Skill 卡市场）** | 🟢 实测 1593 字：tabs `Skills/收藏/我的`，分类 `精选/热门短剧短片/分镜及视频/图片处理/剧本创作/全部`，`搜索skill`/`创建Skill`/`使用`；首屏 6 张 Skill 卡（`武侠短片全流程`、`萌宠旅行Vlog短片`、`赛博CG动画短片`、`第一人称视频短片`、`废土风格短片`、`柔焦胶片风格图`）；全页 **33 个「使用」按钮 = 33 张 Skill 卡**（含 `选角`、`九宫格电影分镜图`、`一键提取画面色卡`、`电影感海报生成`、`是枝裕和导演风格图`…）；顶部模型选择器 `DeepSeek V4.1 Flash` | `report.json:creation-agent`；`AE:52,97-101`；卡数由 `ref-authed/creation-agent.html` 正文「使用」计数复算 |
| `/agent` | Agent 工作台 | ❌ 未取证（页面路由存在） | `routes.txt:14`；`AE` 未列 |
| `/agent/editor` | Agent 编辑器 | ❌ 未取证；有独立 CSS chunk `AgentEditor.DX2qM_5Y.css` | `routes.txt:16`；`bundle` |
| `/agent/bigscreen` | **大屏形态** | ❌ 未取证；有独立 CSS chunk `bigscreen.BHDRZbU3.css` + 特殊布局豁免（`pathIncludes:"/agent/bigscreen"` 走无壳层布局） | `routes.txt:15`；`bundle` |
| `/novel-to-script-agent/:id`、`/create`、`/workbench` | 小说改编智能体（独立子产品） | ❌ 未取证 | `routes.txt:63-65`；`AE:97-99` |

**Skill 卡结构**（`bundle:capture-canvas.json` 的 `zXe()`，与 `报告 §12.5:303` 一致）：
```
{recommend_id, title, description, preset_prompt,
 skills:[{skill_id, skill_name, skill_name_en}],   // 如 skill_name_en:"wuxia-one-line-film-director"
 tag: 1|2|3|4|5,                                   // BATCH_IMAGE|VIDEO|SCRIPT|SKILL|CUSTOM
 tag_label}                                        // tag=CUSTOM 时用自定义标签，否则用默认表
```
默认分类名：`1 批量生图`、`2 视频制作`、`3 剧本创作`、`4 skill`、`5 推荐`（`FXe`）。
→ 产品含义：Skill 卡 = **可复用的"创作剧本杀"**，把"提示词工程 + 节点编排 + 模型选择"打包成一个可下单的按钮。它同时是**内容运营对象**（可上下架、可收藏、可分精选/热门），Lead 裁决已把这 8 条技能端点归 `ops` 域（`f1-lead-decisions.md:44-58`）。

### 4.7 首页资源推荐（`home/resource/*`）

`info` / `recommend` / `sse` 三件套 + `id` 参数 → 推断为"运营位信息流"：`recommend` 出卡片列表，`info` 出单条详情，`sse` 是其流式变体（`CA:753-755`）。语义**未取证**（`CA:996` 列为假设），只能确定它是 Agent 页的**运营内容源**，不是创作能力。

---

## 5. 三者的协同关系

```
                         ┌──────────── 创作 Agent（统一入口 / 对话 + Skill 卡）
                         │  用户说一句 → create-check → create → stream 观察
                         ▼
  剧本/资产/分镜（主流水线） ──产物──▶ 影视版任务表（film）
                                        │  一行 = 一份工单（人员 / 起止 / 画布 / 状态 / 审核 / 积分）
                                        │  canvas-bindings: 行 → 画布（这活在哪干）
                                        ▼
                                     无限画布（canvas） ← 干活
                                        │  submit-result（节点产物回填）
                                        ▼
                                   行状态 → pending_review（自动进入审核）
                                        │  review/comments + review/read（审核往返）
                                        ▼
                                   定稿 done → 导出（exports） / 交付
                                        │
                                        ▼
                              ReelFlow（wf）：项目 → 视频 → 切片 → clip 对象 → 绑资产 → 发布
```

| 协同点 | 机制 | 证据 |
|---|---|---|
| 影视版 **如何把表格变成排产工具** | 三件事叠加：① 可自定义列的工单（9 种类型覆盖"人/素材/时间/产物/状态/结算"）；② 行挂画布（`canvas-bindings`）让"派工"直接落到生产工具上；③ 交付物走版本化审核（`review`）而不是口头确认 | `routes.txt:782-811`；`bundle:D7aUDXP7.js`、`D9zvpvCB.js` |
| **谁在干活** | 8 种可建字段里 `user`（人员）+ `canvas_ref`（内容制作）构成"谁·在哪"的最小派工对；`notify-assignees` 负责催办 | `:795` |
| **成本如何进表** | `points_ro` 只读列，值由画布消耗聚合，**禁止前端写** | `bundle:D7aUDXP7.js` |
| ReelFlow **如何承接前序产物** | 左栏「剧集资产」列出"已定稿"分镜素材，点选加入时间线；「更新分镜」显式同步（**不自动同步**） | `FLOW:84-85` |
| Agent **如何作为统一入口** | Skill 卡把"要做什么"预编排成 `preset_prompt + skills[]`；`create-check`→`create`→`stream` 三段把对话变成可观测任务 | `:128-133`；`bundle:zXe()` |
| 三者共同的底座 | 同一 `task` 体系（`/web/v1/task*`）+ 同一积分账本 + 同一空间隔离（`X-Space-Id`） | `报告 §3:108-120`、`§12.7` |

**三线不重合的证据**：`film` 有零 permission_code 映射 + 独立 `ai_film` 白名单；`wf` 在 CLI 38 命令组里**完全缺席**；`agent` 的 CLI 只开了 `session create`。→ 三条线的开放度是 **画布 > 主流水线 > Agent > 影视版**（按对外可编程程度排序，推断）。

---

## 6. 该域产品逻辑要点

1. **把"创作工具"卖成"生产排产系统"，靠的是一张表格而不是一套新引擎。** 影视版没有新增任何生成能力（字段类型里 `asset_ref/canvas_ref/review_ref` 全是**指向既有资产的引用**），它新增的只有：派工（user）、排期（date）、验收（review 版本链）、结算（points_ro 只读聚合）。这是"用管理壳包住既有产能"的典型做法，也是它能快速上线的原因。

2. **审核被设计成"版本链"而不是"状态位"。** 每次提交产生一个不可变的 `version_no`（V01/V02…），评论挂在版本上、已读回执按版本记。好处是"第 3 版被驳回"这件事有据可查；代价是行的 `status` 与版本的 `status` 必须双轨（行级 5 值 + 版本级独立），这是竞品自己也留了缺口的地方（`review/approve` 端点不存在，`CM:977`）。

3. **"画布提交即进审核"是全产品唯一的自动化衔接点。** `submit-result` 一次调用同时做三件事：把节点产物登记成一个审核版本、把行状态推到 `pending_review`、发通知。这一条把"创作"和"管理"缝在了一起——没有它，影视版就只是一张外挂 Excel。

4. **协同选型暴露了产品成熟度差异。** 画布用**悲观锁 + 心跳**（`nodes/:id/lock|unlock|heartbeat`，`报告 §12.5:302`），任务表用**广播 + 回声抑制**（`client_id`）。前者适合"一个节点只能一个人改"，后者适合"一行数据多人同时填不同列"。两种模型并存说明它们是**两个团队、两个时期**做的。

5. **Agent 是"入口的入口"，不是第四个创作引擎。** 它的产物仍然是 `task`（同一套生成端点、同一套计费），它真正新增的是：Skill 卡市场（把编排变成可运营内容）、`create-check` 预检（防误扣费）、SSE + HITL（把"等结果"变成"可干预"）。所以**它的护城河在运营侧不在技术侧**——卡的数量与质量决定留存。

---

## 7. 未知项 / 证据缺口

| # | 未知项 | 类型 | 已知边界 | 复核方式 |
|---:|---|---|---|---|
| 1 | **`film` 字段类型系统的服务端契约** | 报告明确未知 | 客户端实证 9 种枚举 + 每种的 `encodeCell/decodeCell/filterOps/defaultWidth/isUnique` 行为（`bundle:D7aUDXP7.js`）；`config_json` schema、服务端校验强度、唯一性执行层**全黑** | 需影视版内测账号 + 真实建列请求抓包 |
| 2 | **`film` 项目本体端点未观测** | 端点缺口 | 只有 `/film/projects/:project_id/*`（带 project_id 的子资源），**没有** `POST /film/projects`、`GET /film/projects` 列表；`/film` 页面却有「创建项目」按钮 | 同上；`CM:377` 已标 A2 |
| 3 | **`film` 审核决策端点（approve/reject）不存在于路由表** | 端点缺口 | 只有 `review`(GET)、`review/comments`(POST)、`review/read`(POST)；`review_ref` 字段存在但无写端点。决策疑似借 `POST .../status` | 同上；`CM:977` A3 |
| 4 | **`film` WebSocket 协同帧协议** | 协议未知 | 只拿到 URL 模板与 channel 命名 `film_table_{wsid}_{tableId}`；帧格式/消息类型全未知 | 需 CDP 抓 WS 帧；`CM:983` A9 |
| 5 | **ReelFlow `timeline` JSON 完整 schema** | 报告明确未知 | `报告 §10:244` 原文列为遗留；只知**画布** clip 节点有 `timeline`/`shotOrder`/`exportSettings`（`node.md:85`），与 wf 是否同构未知 | 需进剪辑器实操 + 抓 `wf/clip-object` 响应 |
| 6 | **`wf/*` 全部请求体与响应结构** | 结构未知 | 只有 method/body 类型/query 名（bundle 常量）；无一条响应体样本 | 需 `POST /wf/project` 后逐端点只读探测（该账号可建空项目，`FLOW:17`） |
| 7 | **`wf/publish` 的"发布"目标** | 语义未知 | 端点存在；页面只有 `已导出` tab（`FLOW:71`）；与 `已导出` 是否同一概念未知 | 同上 |
| 8 | **`wf/agent-project` / `wf/agent-task` 的归属** | 语义未知 | 仅路径与 POST 方法；推断为 ReelFlow 侧 Agent 入口，与 `/web/v1/agent/*` 关系未知 | 同上 |
| 9 | **创作 Agent 的 SSE 完整事件表** | 报告明确未知 | 画布 Agent 已见 4 个业务事件 + 2 心跳（`CA:882-893`）；创作 Agent 的帧格式**未直接取证**，仅推断同构；`/agent/task/stream` 的 `raw` body 内容未知 | 需真实会话抓流；`报告 §10:246` |
| 10 | **`GET /agent/task/{task_id}` 是否存在** | 端点存疑 | `routes.txt:134` 单行未标方法；bundle 只找到 PUT 配置（`apiAgentTaskTaskIdPutRequestConfig`），**零 GET 命中** | 需实测 GET 该路径 |
| 11 | **`create-check` / `create` 的请求体与响应** | 结构未知 | 只有端点名与方法；`CA:757-758` 给的是草案形状 | 需真实调用（会消耗积分，需 Owner 授权） |
| 12 | **`/agent`、`/agent/editor`、`/agent/bigscreen` 三页形态** | 页面零截图 | 路由存在（`routes.txt:14-16`）+ 有独立 CSS chunk（`bigscreen.BHDRZbU3.css`、`AgentEditor.DX2qM_5Y.css`）+ `bigscreen` 走无壳层布局；**无任何 DOM/截图证据** | `fullsite-page-routes-v2.md:101-103,242` 列「零截图」；需补采 |
| 13 | **`task-templates` 的 `scope` 取值与模板体结构** | 结构未知 | `queryNames:["scope"]` 已确认；`official/team` 只见于前端 fixture（带 `__fixture:true`），**不可当契约** | `CM:984` A10 |
| 14 | **`task-tables/import` 的 job 生命周期** | 端点缺口 | 返回 `{job_id,status,table_ids[]}`，但**轮询端点不在 routes.txt** | `CM:985` A11 |
| 15 | **`film` 导出的格式与异步形态** | 结构未知 | `exports` GET/POST 存在；格式（xlsx/csv/zip）、是否异步未知 | `CM:986` A12 |
| 16 | **`points_ro` 的结算口径** | 语义未知 | 源码只说"由画布消耗结算"并禁写；聚合哪一层、是否含失败任务未知 | `CM:988` A14 |
| 17 | **影视版与团队域的权限耦合** | 权限未知 | 11 级角色含 `film_producer(10)`/`film_maker(11)`（`bundle:Dso67aSD.js`），但 `film` 零 permission_code 映射；是谁授权"审核"未取到 | `CM:976,978`；角色本体归 task-3（cam 域） |
| 18 | **`film` 任务表与主流水线分镜的数据关系** | 架构未知 | 两端各自独立建模（`f1-domain-contract-overview.md:78` 判定"影视版任务表是独立模型，不与分镜表混用"）；但 `submit-result` 的 `nodes[].file_id` 是否可能来自流水线分镜未验证 | 需有数据的影视版项目 |
| 19 | **`/film/assets` 与 `/asset`（剧集资产）是否同一套数据** | 语义未知 | `/film/assets` 为影视版资产库（`report.json:film` 导航含 `资产库` tab）；与 `/asset` 的关系无证据 | 需影视版权限账号 |
| 20 | **ReelFlow 的"切片"产品语义** | 语义未知 | `wf/video-slicing` 存在；`fullsite-route-inventory.md:129` 推测对应「视频拉片」工具，但**页面路由未取证** | 需 `/create` 系列或工具页交叉验证 |

> 合计 **20 项**。其中 3 项是**报告已明示的遗留未知**（#1 字段类型系统、#5 `timeline` schema、#9 SSE 事件表，对应 `报告 §10:245/244/246`），其余 17 项为本轮新增登记。最大单一阻塞点是**影视版内测权限账号**（`AE:125`）：它直接卡住 #1~#4、#17~#19 共 8 项；其余缺口（#5~#16、#20）靠登录态只读探测与 CDP 抓流即可补齐，不需要购买/消耗积分。

---

### 附：本域高频 ID / 名词混淆清单

| 易混 | 正确区分 |
|---|---|
| `film` 的 `task_id` vs 全局 `tasks` 的 `task_id` | **不同实体**。film 行是 `film_tasks`（工单行），生成任务是 `tasks`（异步任务）。两者都叫 task，但一个是"活"、一个是"跑" |
| film 的 `version` vs review 的 `version_no` | `task.version` 是**乐观锁计数**（每次写 +1）；`version_no` 是**审核版本序号**（每次提交 +1）。二者不同步 |
| `produce` vs `canvas_ref` | `produce` 是**系统字段 key**，其 `field_type` 是 `canvas_ref`。key≠type |
| `points` vs `points_ro` | 系统字段 `key="points"`，`field_type="points_ro"`。同上 |
| `wf` 的 `uuid` vs `clip` 节点 | `wf` 用 `uuid` 标识片段对象（`clip-object?project_id&uuid`）；画布的 `clip` 是**节点类型**（`node.md:85`），两者无关 |
| `reelmate clip create` vs ReelFlow | 前者是**画布合成**（`canvas/:canvas_id/clip`），后者是 `wf/*`。同名不同物（`clip.md:3`） |
| Agent 的 `/task/{task_id}` vs `/web/v1/task/{task_id}` | 前者在 `/agent` 前缀下（Agent 会话/任务），后者是全局任务中心。前缀不同即不同实体 |
