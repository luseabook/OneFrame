# D7 · 无限画布 / 节点能力矩阵 / Agent / CLI-MCP 外延

> 竞品：万兴剧厂 ReelMate（www.reelmate.cn）。本文只做竞品侧抽取，不含 OneFrame 规划。
> **证据口径**（下文简称）：`SKILL.md`、`cmd/*.md`、`wf/_*.md`、`manual/*.md` 均指 `rea-reelmate\cli-skill\reelmate-cli-skill\` 下同名文件，行号即该文件行号；`报告 §N` 指 `rea-reelmate\REELMATE-逆向分析报告.md`；`core-lib@N`、`CpJ9@N`、`BYjR@N`、`B7V@N` 指 `rea-reelmate\scripts-canvas\files\origins\2bdb…475e\assets\` 下的 `core-lib-CKH7gQsw.js` / `CpJ9ea8-.js` / `BYjRnvS6.js` / `B7V80eWF.js`，N 为**字符偏移**（文件为单行压缩包，无行号）；`model-all` 指 `rea-reelmate\cli-out\model-all.json`。
> **标「推断」的条目为工程判断，非文档或源码直述。**

---

## 1. 域定位

一句话：**无限画布是 ReelMate 的「节点即任务」编排场——用户（或 Agent）在 X6 画布上摆节点、连边、打组，每个节点自身就是一张可重复下单、可回写状态、可被他人只读跟随的生成工单；CLI/MCP 则是把这套画布与制片工坊的全部写操作，外化成一套带阶段机、硬门与幂等账本的机器可调用契约。**

三条产品事实支撑该定位：

| 事实 | 说明 | 证据 |
|---|---|---|
| 画布是**项目内**的容器，不是独立工具 | 画布挂在 workspace 下；`creation_mode=1` 制片工坊 / `=2` 无限画布；同一项目可同时承载两类剧集（`canvas_id` 空或 `"0"` 才是工坊侧） | `cmd/canvas.md:3`、`:222`；`wf/_bootstrap.md:28`；`wf/_stage-machine.md:32` |
| 节点是**可执行单元**，不是画布元素 | 文档原话「节点是画布中的可执行单元」；`node generate` 独立于 `node create`，是扣费下单动作 | `cmd/node.md:3`、`:287-291` |
| 对外只有**一个**机器入口，双场景分派 | 路由表一次只选一个场景文档；未选定前不跑写命令；不匹配就问「制片工坊还是无限画布」 | `SKILL.md:22`、`:24-35`、`wf/_hard-gate.md:7` |

画布与制片工坊的关系（重要，别混）：

```text
workspace(项目, creation_mode)  ──┬── 工坊剧集(EP, canvas_id 空/"0")  → 四环节量产流水线（D4）
                                  └── 画布剧集(EP, canvas_id>0) ── canvas ── node/edge/group
                                                                      └─ 画布内可"交接"进四环节
```

- 画布剧本节点可**交接**进制片四环节：剧本正文落 `outputs/script.txt` → `upload` → `episode split` → `episode batch-create`，且**沿用同一个 WORKSPACE_ID**，禁止另建 `creation_mode=1` 项目（`wf/generate-script.md:96-116`）。
- 反之，制片工坊项目**不能**当画布用：「已绑定制片工坊项目不能拿来写无限画布」（`wf/_bootstrap.md:31`、`wf/generate-image.md:54`）。

---

## 2. 画布功能清单

| # | 能力 | 说明 | 参数/枚举 | 证据 |
|---|---|---|---|---|
| 1 | 建/查/改/删画布 | 画布是工作区内的内容容器，节点/连线/组都归属画布 | `canvas create NAME`、`list`、`get`、`edit`；返回 `canvas_id` + `episode_id` | `cmd/canvas.md:3`、`:33-54` |
| 2 | 节点 CRUD | 创建的是**节点外壳**，其余 `--set` 写入 `params` | 11 种 `NODE_TYPE`；`--set`/`--update` 分流 | `cmd/node.md:39`、`:45`、`:237-248` |
| 3 | 节点批量创建 | 每批 ≤100 个，超出自动拆请求；未给坐标者按每行 5 个、间距 56px 自动网格排布 | `--set 'nodes=[...]'`；`position`、`measured`、`width`、`height`、`params` | `cmd/node.md:165`、`:174` |
| 4 | 自动排布 | 未传 `position_x/y` 时读一次画布已有节点包围盒，放到右侧、间距 180px；空画布落 `0,0`。只传一个坐标也算显式 | `position_x`/`positionX`、`position_y`/`positionY` | `cmd/node.md:68` |
| 5 | 节点连线 | 不带子命令时管理有向边；三种边语义 | `--left/--right`（确保存在）、`--left-add`/`--left-rm`（增量）；`--semantic pipeline\|reference\|sequence`（默认 `pipeline`） | `cmd/node.md:354-370`；`cmd/edge.md:3` |
| 6 | 提交生成任务 | 可只下单，也可指定 `--node` 先合并写回参数再下单，成功后回写 `task_info` | `image`/`video`/`audio`/`text`；图片指定 `--node` 会自动读入边上游 `result.items[].fileId` 合并 `referenceAssets` | `cmd/node.md:287-303`、`:327` |
| 7 | 生成预演 | 「本命令会扣费，提交前先跑一次预演」；不发请求，输出 `dry_run=true` 与 `items[0]` | `--dry-run`；核对模型展示名、`resolution`、`radio_ui`、`qty`、自动算出的 `width/height` | `cmd/node.md:301` |
| 8 | 组（执行组） | 建组实体 + 画布组容器 + 绑定成员；按**依赖拓扑分层**执行 | `group create/execute/delete`；`concurrency`、`max_cycle_layers`、`max_retries`、`timeout` | `cmd/group.md:21`、`:57-69` |
| 9 | 固定组（pin-group） | 每画布**预置 7 个颜色组**，只为"钉颜色/收藏"，与执行组不同 | 7 色 = `red/orange/yellow/green/blue/purple/gray`；`create --name`、`delete` 只清成员 | `cmd/pin-group.md:3`、`:65`；`CpJ9@752495`（`rC=["red",…,"gray"]`） |
| 10 | 画布模板 | 整画布模板（`canvas-tpls`），与 group 模板是**两回事** | `publish/list/get/apply`；`tpl_type` 默认 `2`（官方模块）、`1` 新手引导、Web 另有 `3` | `cmd/canvas.md:144-218`（均标 [YApi] 待实测） |
| 11 | 组模板 | 把一组节点存成模板复用 | `group template save/list/get`；`description`、`cover_file_id`、`sync_to_team`、`folder_id` | `cmd/group.md:110-176` |
| 12 | 表格节点导入 Excel | 两步必须分开：`import` 后先看 Sheet 列表，再 `confirm-sheet` **显式指定** `sheet_id`，不自动选第一个 | `--set file_id` / `--set sheet_id`；标 [YApi] 待实测 | `cmd/node.md:386-392` |
| 13 | 画布脚本流水线 | 作用在**画布脚本节点**上：拆分镜、抽资产、匹配/重匹配、取消、优化剧本 | 6 条写命令，均异步返回 `task_id` | `cmd/script.md:20-39` |
| 14 | 整画布合成/裁剪 | 与 `node create clip` 不同：本组提交**合成任务**，不建节点 | `clip create --set shot_order=[...]`（顺序即成片顺序，提交前对照 `node_list` 校验）；`clip crop` | `cmd/clip.md:3`、`:34`、`:70` |
| 15 | 画布 Agent 会话 | 创建/查询/删除 session，可 `enter/exit`，`run --follow` 持续消费事件 | `agent session create/list/delete`、`agent enter/exit/run`；`--follow`、`--ndjson` | `cmd/agent.md:3`、`:8-14` |
| 16 | 画布内 Agent 面板 | Web 侧：技能卡/推荐卡、消息气泡、素材气泡、HITL 中断卡、思考计时 | `interrupt_id`、`card_type`、`answers`、`selected_solution_id`、`scope` | `CpJ9@` 多处（见 §8） |
| 17 | 协同编辑 | 心跳 5s 取 `editable/status`；节点级 `lock/unlock/renew`；版本冲突与锁竞争有独立退出码 | `heartbeat`、`lock`、`unlock`、`renew`；exit 9 / 10 | `manual/error-codes.md:16-17`；`CpJ9@` 心跳段；`core-lib@708432` 等 |
| 18 | 评论节点 | 画布可挂评论线程并 resolve（节点级评审） | `comment-nodes`、`.../comments`、`.../resolve` | `core-lib@`（`/comment-nodes` 系列 9 条） |
| 19 | 画布内素材 | 局部素材挂到节点，与工坊 `storyboard_info` 是不同实体 | `material --canvas --node`；`material_type`(1–5) + `source` | `cmd/material.md:5-10` |
| 20 | 深链交付 | 画布页深链离线生成，不带 token | `deeplink canvas --canvas --episode --navigation-source` | `cmd/deeplink.md:37-60` |

---

## 3. 节点类型矩阵（11 类，逐类列全 mode）

> 总表口径：`cmd/node.md:76-88`（CLI 契约）；`CpJ9@106771` 的 Web「添加节点」菜单只暴露 10 类（text/table/image/video/audio/clip/script/asset/director/threeDWorld）——**`group` 不在加节点菜单里，它由框选建组产生**（`CpJ9@` 存在 `groupSelection`/`regroup`/`ungroup`）。

### 3.1 总表

| # | `NODE_TYPE` | 菜单可见 | mode 维度 | mode 数量 | 关键 settings / 专有字段 |
|---|---|---:|---|---:|---|
| 1 | `text` | ✅ | 无 mode | 0 | `prompt`、`model`、`count`、`richText`(format=plain\|markdown)、`referenceAssets`、`upstreamRefs` |
| 2 | `image` | ✅ | `mode` | **16** | `settings`(ratio/quality/imageQuality/width/height)、`creativeSetting`、`editConfig`、`referenceAssets` |
| 3 | `video` | ✅ | `mode` | **13** | `settings`(ratio/resolution/duration/enableSound/mouthDrive/shotType/offPeak/fps)、`editConfig` |
| 4 | `audio` | ✅ | `audioKind` | **4** | `duration`(秒)、`voice`{voiceId,tone,speed,pitch,volume,loop}、`previewPlaybackRate` |
| 5 | `table` | ✅ | 无 mode（有 `source.type` 3 值） | 0 | `table`{active_sheet_id, sheet_selection_required, source.type=manual\|excel_import\|project_episode_import, sheets} |
| 6 | `script` | ✅ | `runPhase` | **2** | `sourceText`、`shotCount`、`columns`、`spawnConfig`、`upstreamRefs` |
| 7 | `asset` | ✅ | `activeTab` | **3** | `sourceText`、`extractCredits`、`spawnConfig`、`upstreamRefs` |
| 8 | `clip` | ✅ | 无 mode（有 `exportSettings.exportTarget` 2 值） | 0 | `shotOrder`(节点 ID 数组)、`exportSettings`、`timeline`、`previewPlaybackRate` |
| 9 | `director` | ✅ | 无 mode | 0 | 无专属业务参数；只用通用参考字段 `isReference`/`referenceRole`/`referenceLabel` |
| 10 | `threeDWorld` | ✅ | 复用图片 mode 结构 | (同 image) | `worldInputIsPano` 布尔；`mode`/`prompt`/`settings`/`editConfig` |
| 11 | `group` | ❌（框选建组） | 无 mode | 0 | `title`、`color`、`childNodeIds`、`width/height`、`collapsed`、`locked`、`serverGroupId` |

证据：`cmd/node.md:78-88`（逐类字段）；`cmd/node.md:45`（11 类枚举）；`CpJ9@106771`（菜单 10 类 + `allowedActions` 过滤）。

### 3.2 `image` 节点：16 个 mode 分两族

CLI 原文枚举：`cmd/node.md:79`。

| 族 | mode | 产品语义 | 是否在模型 `supported_modes` 里 |
|---|---|---|---:|
| 生成 | `text2image` | 文生图 | ✅ 9/46 |
| 生成 | `image2image` | 单图参考改图 | ✅ 9/46 |
| 生成 | `multi_reference` | 多图参考 | ✅ 2/46 |
| 编辑算子 | `upscale` | 超清 | ❌ |
| 编辑算子 | `crop` | 裁剪 | ❌ |
| 编辑算子 | `outpaint` | 扩图 | ❌ |
| 编辑算子 | `inpaint` | 区域重绘 | ❌ |
| 编辑算子 | `erase` | 擦除 | ❌ |
| 编辑算子 | `panorama` | 全景 | ❌ |
| 编辑算子 | `panorama_360` | 360 全景 | ❌ |
| 编辑算子 | `multi_angle_360` | 多角度 | ❌ |
| 编辑算子 | `lighting` | 打光 | ❌ |
| 编辑算子 | `multi_camera_grid_9` | 九宫格机位 | ❌（**前端源码未见该字面量**，见 §11 未知项） |
| 编辑算子 | `story_grid_4` / `story_grid_9` / `story_grid_25` | 剧情推演 4/9/25 格 | ❌ |

**产品含义（重要）**：16 个 mode 里只有 3 个是"模型生成模式"（走 8 个 AI 网关端点之一），其余 13 个是**无模型的图像后处理算子**——它们在 `model-all.json` 的 `supported_modes` / `params.generation.<mode>` 里完全不存在（统计见 §11）。也就是说 image 节点是一个**统一入口**：前端用同一个节点壳承接"生成"与"编辑"两类动作，用户不需要区分"这是模型能力还是滤镜"。

前端佐证：图像后处理菜单按 `kind` 分组，`ai_edit`（`inpaint`/`outpaint`/`erase`）、`multi_angle`（`kind:"angle_editor"`）、`story`（`kind:"story_editor"`）、`palette`、`panoCapture`、`ultraClear`、`splitGrid`（`split4`/`split9`/`split16`/`split25`）、`crop`、`lighting`、`annotate`（`B7V@` 图像后处理菜单段 + `canvas.imagePost.*` i18n 键全表）。
注意：前端 `split16` 与 CLI `story_grid_4/9/25` 的编号体系不一致（前端 4/9/16/25 四档，CLI 只有 4/9/25 三档）→ 推断前端 `split16` 未进 CLI 契约。

焦点模式清单（含 5 个 mode）在客户端被单独处理：`panorama`/`multi_angle_360`/`story_grid_4`/`story_grid_9`/`story_grid_25` 走「只允许 1 张参考图」的限额组（`B7V@4677` 附近 `Ge=new Set([...])`）。

### 3.3 `video` 节点：13 个 mode 分两族

CLI 原文枚举：`cmd/node.md:80`；接口映射原文：`cmd/node.md:305`。

| 族 | mode | 产品语义 | 接口 | 是否在模型 `supported_modes` 里 |
|---|---|---|---|---:|
| 生成 | `text2video` | 文生视频 | `/ai/text-to-video` | ✅ 7/46 |
| 生成 | `image2video` | 图生视频 | `/ai/image-to-video` | ✅ 16/46 |
| 生成 | `first_frame` | 首帧 | 同图生视频 | ✅ 16/46 |
| 生成 | `first_last_frame` | 首尾帧 | 同图生视频 | ✅ 8/46 |
| 生成 | `video_reference` | 视频参考 | `/ai/refer-video-to-video` | ❌（目录里无此键） |
| 生成 | `universal_reference` | 多素材参考 | `/ai/refer-media-to-video` | ✅ 10/46 |
| 生成 | `video_edit` | AI 改视频 | `/ai/video-to-video` | ✅ 6/46 |
| 生成 | `video_extend` | 视频续写 | 同改视频 | ✅ 2/46 |
| 编辑算子 | `video_clip` | 切片 | — | ❌ |
| 编辑算子 | `video_upscale` | 视频超清 | — | ❌ |
| 编辑算子 | `de_subtitle_auto` | 自动去字幕 | — | ❌ |
| 编辑算子 | `de_subtitle_region` | 区域去字幕 | — | ❌ |
| 编辑算子 | `frame_capture` | 截帧（产物是**图片**） | — | ❌ |

`settings` 枚举（`cmd/node.md:80`）：
- `ratio`：`16:9` / `9:16` / `1:1` / `4:3` / `3:4`
- `resolution`：`480p` / `720p` / `1080p` / `2K` / `4K`
- 另有 `duration`、`enableSound`、`mouthDrive`、`shotType`、`offPeak`（错峰）、`fps`

**产品含义**：`frame_capture` 的 `targetType` 在前端被强制映射成 `image`（`B7V@` `h(a,n)`：`a===K?("frame_capture")?"image":…"video"`）——即"从视频里截一帧"会生成一个**图片节点**，这是节点类型间的隐式产物转换，不是同类型 fanout。

模型目录实际可达的 `resolution` 展示名（`model-all` 全量去重，共 10 档）：`720P`/`768P`/`1080P`/`1080P全高清版`/`1080P优惠版`/`1K`/`2K`/`2K超清版`/`3K`/`4K`——**注意 46 个模型里没有任何一档叫 `480P`**，CLI 文档的 `480p` 在真实目录中不可达；`ratios` 13 档（`1:1`/`1:2`/`2:1`/`2:3`/`3:2`/`3:4`/`4:3`/`4:5`/`5:4`/`9:16`/`16:9`/`9:21`/`21:9`）。CLI 文档里的 5 档 `ratio` 与 5 档 `resolution` 只是**画布节点壳的兜底枚举**，真实合法值必须现查模型（`wf/_models.md:3`、`cmd/node.md:303`）→ 推断：文档枚举是"最小公共集"，不是完整集。

### 3.4 其余 9 类逐类

| `NODE_TYPE` | mode/枚举维度 | 全部取值 | 关键字段 | 证据 |
|---|---|---|---|---|
| `audio` | `audioKind` | `voiceover` / `music` / `sfx` / `ambient` | `duration` 规则随 kind 变：`music`/`ambient` 支持 `10/30/60`（默认 30）；`sfx` 支持 `5/10/15`（默认 5）；`voiceover` **不提交时长** | `cmd/node.md:81`、`:320` |
| | `voice` | `tone`=`Neutral/Happy/Sad/Surprise/Angry` 等；`speed` 0.5–2；`pitch` -12–12；`volume` 画布倍率 0.02–2 或接口值 1–100；`loop` 布尔 | `voiceover` 必含 `voiceId`；音频**不选模型**，CLI 会移除误传的 `ai_model_mark`/`model` | `cmd/node.md:90-97`、`:321-323` |
| `script` | `runPhase` | `storyboard` / `asset_match` | `prompt`、`sourceText`、`model`、`shotCount`、`columns`、`spawnConfig` | `cmd/node.md:83` |
| `asset` | `activeTab` | `character` / `scene` / `prop` | `sourceText`、`model`、`extractCredits`、`spawnConfig` | `cmd/node.md:84` |
| `table` | `source.type` | `manual` / `excel_import` / `project_episode_import` | `active_sheet_id`、`sheet_selection_required`、`sheets` | `cmd/node.md:82` |
| `clip` | `exportSettings.exportTarget` | `canvas` / `local` | `shotOrder`（节点 ID 数组，顺序即成片顺序）、`resolution`(480p/720p/1080p)、`format`(mp4/webm)、`timeline`、`previewPlaybackRate` | `cmd/node.md:85` |
| `director` | — | — | 无专属业务参数，只用 `isReference`/`referenceRole`/`referenceLabel` | `cmd/node.md:86` |
| `threeDWorld` | 复用 image 的 `mode` | 同 §3.2 | 额外 `worldInputIsPano` 布尔 | `cmd/node.md:87` |
| `group` | — | — | `title`、`color`、`childNodeIds`、`width/height`、`collapsed`、`locked`、`serverGroupId` | `cmd/node.md:88` |

`clip` 的**两处枚举不一致**（需注意）：CLI 契约写 `resolution`=`480p/720p/1080p`、`format`=`mp4/webm`（`cmd/node.md:85`），而 Web 导出菜单实际是 `target`=`local|canvas`、`resolution`=`720p/1080p/2k/4k`（`CpJ9@` `ClipTimelineExportMenu`：`n=["local","canvas"]`、`a=["720p","1080p","2k","4k"]`）→ **推断**：CLI 文档落后于前端，前端已扩到 2K/4K 且以 `target` 命名。

`director` 在 Web 后端是独立子系统：`/df/3d-director/{save,info,list,heartbeat}` + `pose_preset` 官方/自定义姿势库（`core-lib@` 9 条 3d-director 路径）——即「3D 导演台」是一个有独立持久化与心跳的编辑会话，节点只是它的入口（**推断**：`director` 节点的 `params` 空，是因为状态都存 3d-director 侧）。

---

## 4. 节点即任务：任务如何被承载、组织与回收

### 4.1 一个节点的四段状态

```text
params(参数快照)  →  task_info(任务句柄)  →  result.items[]  →  node_mode(展示态)
      ↑ 写回                 ↑ 下单后回写          ↑ 轮询/SSE 回填        ↑ 派生
```

| 段 | 字段 | 写入时机 | 证据 |
|---|---|---|---|
| 参数快照 | `params.*` | `node create --set` / `node edit --set` / `node generate --node` **先合并写回再下单**；写回失败即中止生成 | `cmd/node.md:296`、`:327` |
| 任务句柄 | `task_info={task_id, status, task_type, phase, progressPercent}` | 任务创建成功后回写；`script asset-extract` 会先把 `node_mode` 置 `ai_generating` | `cmd/node.md:327`、`cmd/script.md:24-26` |
| 产物 | `result.items[]`（`fileId`/`url`/`poster`/`selectedIndex`） | 终态成功后回填 | `BYjR@` 轮询回填段；`wf/generate-image.md:126` |
| 展示态 | `node_mode` ∈ `empty / queued / ai_generating / compiling / ready / failed / manual` | 由 `task_info.status` + 产物有无派生 | `BYjR@` `Po()` 状态派生函数 |

`node_mode` 派生规则（源码直读，`BYjR@` `Po`）：
1. `task_info.status=success` → `ready`
2. `failure|failed|error` → `failed`
3. 有 `task_id` 且当前不是 `queued/ai_generating/compiling` → 一律归 `ai_generating`（并给出 `progressPercent`：status=0 → 20，其余 → 50）
4. 无任务：按节点类型判"是否已有内容"（image/video/audio/threeDWorld 看 `result.items`，text 看文本，asset 看 `characters/scenes/props`，clip 看 `shots`/`compiledVideo`，script 看对象非空）→ 有→保留原态，无→`manual`（若是 `*_resource` 类）或 `ready`

**产品含义**：`node_mode` 是一个**七态的、与后端任务状态机解耦的前端展示态**。它把"后端只有 queued/processing/success/failure 四态"翻译成"用户能看懂的七种节点外观"，且专门留了 `manual`（手工上传的素材资源）与 `compiling`（clip 合成中）两个非模型态 → 节点能同时容纳"AI 生成物"和"人工上传物"，这是画布能当"工作台"而不是"生成器"的关键。

### 4.2 批量与组执行：两种不同的并发模型

| 维度 | 单节点 `node generate` | 组执行 `group execute` |
|---|---|---|
| 返回 | `task_id`，调用方自己 `task wait` | 整组执行摘要，**不返回单个 TASK_ID**，不再交给 `task wait` |
| 并发 | 由调用方串行/并行 | 按依赖拓扑分层，`concurrency` 控制同层最大并发 |
| 失败 | 单任务重试 | 节点级 `max_retries`；环检测 `max_cycle_layers` |
| 预演 | `--dry-run` 输出 `items[0]` | `--dry-run` 输出**每层的 `layer/kind/count/node_ids/node_types`**——即"将要逐个下单的节点清单" |
| 中断 | — | 积分不足/权限失败/超时/取消时**停止创建新任务**，摘要保留已完成与失败计数 |

证据：`cmd/group.md:57`、`:69`、`:73`；`cmd/node.md:301`。
文档明确规定「整组执行是最贵的写操作」（`cmd/group.md:69`）——**推断**：这是产品把"一次点击批量生成 N 个付费任务"的风险显式化的做法，预演即"报价单"。

分诊规则（无限画布，`wf/generate-image.md:42-50`、`wf/generate-video.md:38-45`）：
- 清单 ≥2 条 → `group create` + `group execute`，**禁止逐条 `node generate`**
- 只钉颜色 → `pin-group create`，**不许把 pin id 交给 `group execute`**
- 单张重跑 → `node generate --node`
- 改参数 → `node edit`（「编辑不会自动提交生成」，`wf/generate-video.md:41`）

### 4.3 fanout：节点级"派生新节点"

前端存在 `node_fanout` 机制（`CpJ9@` 12 处）：在源节点下方按固定间距创建子节点、`connectNodes`、立即 `run()`，并把 `source:"node_fanout"` 写进节点来源；计费走 `consumeReasonFanout` 估算器（`B7V@` `Zt()`）。图像后处理、多角度、剧情推演、`panorama_360` 全部走这条路。

**产品含义**：一次"编辑"在数据上不是原地修改，而是**新建一个派生节点并保留下游血缘**。所以画布天然是"版本树"，用户可回看每一步的中间产物——这也是为什么 `clip` 能用 `shotOrder` 直接引用任意历史节点做时间线。

### 4.4 恢复能力的真实边界

| 能力 | 后端接口 | CLI 状态 |
|---|---|---|
| 恢复节点 | `POST /df/canvas/:id/nodes-recover` | **不可用**：「`node recover` 当前暂不可用；需要恢复请用 `node create` 重新建立」（`cmd/node.md:433`） |
| 恢复组 | `POST /df/canvas/:id/group-recover` | **不可用**：「`group recover` 当前暂不可用」（`cmd/group.md:184`） |
| 软删除组 | — | 「组删除是软删除，超过保留窗口后无法恢复」（`cmd/group.md:183`） |

→ **推断**：Web 有回收站，CLI 没有暴露。这是"对外契约"与"对内能力"的第一处已知落差。

---

## 5. 协作与并发：四道闸

| 闸 | 机制 | 触发/返回 | 证据 |
|---|---|---|---|
| 1 会话心跳 | 前端每 **5s** POST `canvas/:id/heartbeat`，返回 `{editable, status}`，据此改只读态 | status 三值 `canvas_occupied` / `session_replaced` / `session_idle_expired`；非 `editable` 时提示「只读」 | `CpJ9@` `Qat=5e3` + `Jat()`；`core-lib@708432` |
| 2 画布版本 | 写操作走「心跳→加锁→版本→写入→回读」链路，版本不符报冲突 | **exit 9**「画布版本冲突」→ `canvas get` 读最新版本后重排写入 | `manual/error-codes.md:16`；`cmd/script.md:20`；`BYjR@` `ANU_VERSION_CONFLICT` |
| 3 节点锁 | 节点级 `lock`(GET/POST) / `unlock`(POST) / `renew`(POST) | **exit 10**「节点锁竞争」→ 等待协作者释放或稍后重试 | `manual/error-codes.md:17`；`core-lib@728690`/`729511`/`730340` |
| 4 幂等键 | 写操作 `--idempotency-key`；回包 `idempotent_replay=true` 表示 key **已打到服务端**，禁止换新 key 重打，改用回包 `task_id` 去 `task wait` | 本地账本三态：`pending`(exit 9 占用) / `in_doubt`(**exit 11**，请求已发出结果未知) / `applied`(短路重放) | `wf/_hard-gate.md:32`；`cmd/ledger.md:5-15` |

**只读可关心跳、写操作不可关**（`cmd/node.md:432`）：`--no-heartbeat` 仅 `list`/`get` 可用。
`in_doubt` 是唯一需要人介入的一档，标准处置：`ledger list --in-doubt` → `ledger show KEY` → 用只读命令复核 → 确认未生效才 `ledger resolve` 或 `--force-replay`（`cmd/ledger.md:125`）。文档明确警告「`ledger resolve` 是在放开一道重复扣费的闸门」（`cmd/ledger.md:82`）。

批处理接口（前端 SDK 层，`core-lib@` 全表）：
`batch-nodes`、`batch-edit-nodes`、`batch-del-nodes`、`batch-edges`、`batch-del-edges`、`batch-node-tasks`、`batch-nodes-details`、`batch-download`、`batch-file-thumb`。
→ **推断**：`batch-node-tasks` 是"批量下单"的服务端原语，CLI 的 `group execute` 大概率构建在它之上（CLI 未直接暴露该接口）。

实时协同的传输层：`yjs` 被打进 `CDTYuSrS.js`（Yjs 完整 CRDT 实现），画布协作有 `followingClientId` / `selfPresentingSince` / `pendingInvite` / `currentPresenter`（跟随与演示模式），另有 `BroadcastChannel`。→ **推断**：Yjs 用于画布内**富文本/文本节点**的多人同时编辑，节点图本身走「独占编辑权 + 版本号」而非 CRDT（因为存在 exit 9/10 与 `editable` 只读态，与 CRDT 语义冲突）。

---

## 6. 三种"组"别搞混

| 概念 | 实体 | 用途 | 能否执行 | 关键约束 |
|---|---|---|---|---|
| `group`（执行组） | 组实体 `GROUP_ID` + 画布组容器 `NODE_ID` | 批量生成的编排单元，按拓扑分层下单 | ✅ `group execute` | `GROUP_ID` ≠ 组容器 `NODE_ID`，后续组操作用 `GROUP_ID`；必须先绑成员与 `serverGroupId`，Web 才能重建分组效果 |
| `pin-group`（固定组） | 每画布**预置 7 个**颜色组 | 只做颜色标记/收藏 | ❌ 禁止交给 `group execute` | 预置组不能删只能清空成员；无同名组且 7 个都已命名时 `create` 报错、**不覆盖**其他名称 |
| `group template` | `TEMPLATE_ID` | 把一组节点存成可复用模板 | — | 与整画布模板 `canvas-tpls` 是**两回事**，不可混用 |
| `team-group` | — | — | — | 「`team-group` 当前未注册」（`wf/generate-image.md:7`） |

证据：`cmd/group.md:20-26`、`:180-184`；`cmd/pin-group.md:3`、`:65-67`；`cmd/canvas.md:150`。
7 个预置颜色：`red / orange / yellow / green / blue / purple / gray`（`CpJ9@752495`）。
节点侧落的是 `params.group_ids`（数组，一个节点可同时属多个 pin-group），CLI 会「先从预置组成员列表重建节点当前的完整 `group_ids`，再加入目标组」（`cmd/pin-group.md:66`）——即 pin-group 是**多对多**，不是归属覆盖。

> 注意 `group` 节点自己也带 `color`、`title`、`collapsed`、`locked`（`cmd/node.md:88`）——它是**画布上的可视容器**，与 pin-group 的"颜色标签"是两套完全不同的组织维度：一个管几何与执行，一个管检索与配色。

---

## 7. `clip` 节点：时间线与导出的承接点

### 7.1 数据模型

`clip` 节点 = `shotOrder`（有序节点 ID）+ `timeline`（JSON）+ `exportSettings`。
真正的剪辑数据在前端是 `params.clips[]`，每项：

| 字段 | 含义 |
|---|---|
| `clipId` | 片段 ID |
| `sourceNodeId` | 指向某个 **video 节点** |
| `trimStartMs` / `trimEndMs` | 入点/出点（毫秒） |

源码 `w6(params, sequenceEdges, getNode)`（`CpJ9@`）：
1. 取所有 `type==="video"` 的 `sequence` 入边为候选源；
2. 用 `params.clips` 过滤（源节点存在即保留）；
3. **未出现在 clips 里的入边视频自动补一条 `{trimStartMs:0, trimEndMs:null}`** → 返回 `{clips, migrated}`，`migrated=!params.clips`。

**产品含义**：`clip` 节点对"上游新增了一条视频边"是**自动追加片段**的语义——用户连线即入轨。这让"时间线"不是独立编辑器，而是节点图的**投影**：节点图是真相，时间线是视图。

### 7.2 时间线钉选（pinned timeline）

底部时间线栏 `CanvasPinnedTimelineBar`（`CpJ9@1663453`）：
- 每画布一个 `pinned` 列表 + `active` + `collapsed`；
- 列表元素是**被钉住的 clip 节点**（`o(k)=getNodeById(k)?.type==="clip"` 做类型校验）；
- 排序字段 `pin_order`（`ctt()` 按 `pin_order` 升序去重）；
- 折叠态高度 40px / 展开 192px / 轨道最小宽 360px；
- 持久化：服务端 `pinned-timelines`（POST/GET/DELETE + `/:node_id`）+ 本地 `canvas_timeline_pins_<canvasId>` 双写。

→ 即"时间线"是一个**跨画布的钉选栏**，用户可以把多个 clip 节点钉在底部快速切换；不是全局唯一时间线。

### 7.3 两条导出路径（互相替代，别混用）

| 路径 | 命令 | 语义 | 产物 |
|---|---|---|---|
| 节点内导出 | `node create clip --set exportSettings=...` | clip **节点自身**的导出设置（`exportTarget`=canvas/local） | 节点参数 |
| 整画布合成 | `clip create --canvas --set 'shot_order=[...]'` | 提交**整画布视频合成任务**，不建节点 | 异步 `task_id` |
| 整画布裁剪 | `clip crop --canvas` | 提交裁剪任务 | 异步 `task_id` |
| 剧集成片 | `export merge EPISODE_ID` | 按分镜顺序合并**已定稿**视频；`task_id` 同时也是 `EXPORT_ID` | `file_id` → `export download` |

`clip create` 的 `shot_order` 校验：空数组、空 ID、画布上不存在的节点 ID 都会被挡住（`cmd/clip.md:34`、`:70`）。
`export merge` 明确「只合并剧集当前已定稿的视频，不会生成缺失的分镜视频」（`cmd/export.md:107`）；默认 `1920x1080`、`mp4`（`:53`）。
`export download` 只接受 `status=2` 且带 `file_id` 的记录，先写同目录临时文件再**原子改名**，目标已存在默认拒绝覆盖（`cmd/export.md:94`）。

---

## 8. 画布内 Agent：会话 → 消息 → 节点绑定

### 8.1 后端契约链（源码全量）

```text
chat/sessions                    POST/GET      建/列会话
chat/sessions/:sid               PATCH/DELETE  改/删会话
chat/sessions/:sid/messages      GET/POST      消息流
chat/sessions/:sid/stream        GET           SSE 流
chat/sessions/:sid/read          POST          已读
chat/sessions/:sid/tasks/:tid/cancel    POST  取消
chat/sessions/:sid/tasks/:tid/interrupt POST  中断（HITL 回复）
chat/sessions/:sid/tasks/:tid/feedback  POST  反馈
chat/sessions/:sid/messages/:mid/node-binding  POST  ★ 消息→节点绑定
chat/sessions/:sid/messages/:mid/reaction      POST  点赞/点踩
chat/writing-outputs             GET           写作产出
```

证据：`core-lib@972198`（`node-binding` 端点定义）、`core-lib@` chat 系列 14 条路径 + method 全表。

**`node-binding` 是"节点即任务"的另一半**：消息（一次 Agent 对话轮次）可以绑定到画布节点，即"这句话产生了那个节点"。这解释了为什么 Agent 面板能对某条消息"回滚/重生成"——它绑定的是节点而不是文本。

### 8.2 Agent 产物的"暂存—采纳"两段式（关键产品逻辑）

源码 `CpJ9@` 的 Agent 采纳流程：

1. 产物先落 **staging**：`stagedProducts[]`（22 处引用），每条带 `localId`、`status`（含 `generating`）、`asset{asset_type,file_id,preview_file_id,metadata}`、`params`、`lineage{sourceNodeId, displayOrder, hitlBatchIndex}`；
2. 排序：`Uq()` 先按 `asset_type==="video"?1:0` 再按 lineage 键，保证视频在后；
3. **采纳**时才真正建节点：`createNodesAtomic()` → `persistNodesInitialData()` → 按 `lineage` 逐条 `connectNodes()` → 生成中的节点置 `ai_generating`；
4. 失败有两条独立文案：`canvas.agent.adopt_failed_readonly`（整体只读失败）、`canvas.agent.adopt_failed_partial`（部分失败，带 count）；
5. 自动布局：先尝试"围绕上次采纳游标"（`Ky`），失败回退到"视口最近空位"`resolveNearestFreeFootprints`，避免遮挡已有节点。

**产品含义**：Agent 不是"直接往画布写节点"，而是"先在一个临时产物区攒结果，用户点采纳才落地"。这是把"Agent 可能一次产出 20 个节点"的破坏性风险关进笼子的做法——落不了地（只读/冲突）时只会在对话里留一条系统消息，画布不受污染。

### 8.3 推荐卡 / 技能卡

| 项 | 结构 | 证据 |
|---|---|---|
| 接口 | `GET /df/canvas/agent-recommend-cards`（无参数） | `core-lib@982025` |
| 卡片字段 | `recommend_id`、`title`、`description`、`preset_prompt`、`tag`、`tag_label`、`skills[{skill_id, skill_name, skill_name_en}]`、`cover_file_id` | `CpJ9@` `zXe()` 解析函数 |
| `tag` 枚举 | `1`=批量生图、`2`=视频制作、`3`=剧本创作、`4`=skill、`5`=自定义（用 `tag_label`） | `CpJ9@` `jc={BATCH_IMAGE:1,VIDEO:2,SCRIPT:3,SKILL:4,CUSTOM:5}`，缺省标签「推荐」 |
| 图标映射 | 1→image、2→video、3→text、4→skill、5→skill | `BXe` |
| 兜底卡（远端为空时） | 4 张硬编码：`video_oneshot`「一键成片」、`character_multiview`「人物多视角」、`first_person_short`「第一人称短片」、`wuxia_short`「武侠短片」 | `CpJ9@` `HXe=[...]` |
| 技能广场 | `agent-skills/plaza`、`/favorites`、`/mine`、`/details`、`/:id/favorite`、`PUT/POST/DELETE` | `core-lib@` 9 条 |

卡片 prompt 里带**斜杠指令**：`/character-multiview-sheet`、`/first-person-immersive-video`、`/wuxia-one-line-film-director`（`CpJ9@` `HXe`）。前端另有 `OXe()` 用正则 `^\/([A-Za-z0-9_-]+)` 把输入框首词解析成 `{nameEn, text}` → **推断**：斜杠技能是"预置 prompt 模板 + 英文技能名"的轻量 DSL，技能本体由服务端 `agent-skills` 提供，前端只做路由。

### 8.4 画布内 HITL 卡（与 CLI 的 HITL 是两套实现）

前端中断卡字段（`CpJ9@` `uD()`）：`interrupt_id`、`decision`、`card_type`、`scope`、`selected_solution_id`、`raw_feedback`、`answers[]`、`edited_payload`。
`card_type` 实际取值：`option_card`、`solution_card`、`decision_card`（各 1–3 处）。
UI 上有 `agent-dock-panel__hitl-item`、`__hitl-batch-error`、`__hitl-clarification`、`__hitl-title`、`__hitl-message`、`__hitl-assets-tip` 六种渲染位（`CpJ9@`）。

→ **产品含义**：画布 Agent 的"人在环内"是**结构化卡片**（选项卡/方案卡/决策卡 + 批量错误 + 澄清），CLI 的"人在环内"是**文末列表**（`_hitl-present.md` 的 `(N) 展示名 · …`）。同一产品语义，两个宿主、两种呈现——因为 CLI 不能弹窗（`wf/_hitl-present.md:5`：「Skill zip 不能自带弹窗」）。

---

## 9. CLI / MCP 作为产品外延

### 9.1 形态与分发

| 项 | 事实 | 证据 |
|---|---|---|
| 分发物 | 一个 Agent **Skill 包** zip（`reelmate_cli_skill_20438.zip`），含 `SKILL.md` 路由协议 + 38 个命令组文档 + 共享协议手册 | `报告 §12.7`、`INSTALL.md:3` |
| 版本钉死 | CLI 必须 `npm i -g @wondershare-plugins/reelmate-cli@1.0.5`；**禁止 `@latest`**；zip 内的 Skill 只是引导，必须用 `reelmate skill-path` 指向的 npm 包内目录整目录替换 | `INSTALL.md:5-6`、`:38-40` |
| 登录 | CLI 自己开浏览器做 SSO + loopback 回调，凭据落盘（`credentialStore`）；**Agent 必须亲自执行 login，不许甩给用户** | `INSTALL.md:44-56` |
| MCP | 产品页以「MCP & CLI」并列入对外能力；但**本次证据基座里没有 MCP Server 的工具清单**，只有 CLI Skill 包 | `报告 §12.7`；见 §11 未知项 |

### 9.2 38 个命令组归类

| 类 | 组 | 数量 |
|---|---|---:|
| 身份·作用域·运维 | `account` `login` `logout` `team` `workspace` `env` `version` `cache` `ledger` | 9 |
| 画布内核 | `canvas` `node` `edge` `group` `pin-group` `script` `clip` | 7 |
| 内容生产 | `novel` `episode` `resource` `subject` `asset-lib` `storyboard` `material` `market` `ad` `redraw` | 10 |
| 生成·任务·计费·音色 | `ai` `task` `model` `credits` `voice` | 5 |
| 交付与互操作 | `deeplink` `export` `sync-fm` | 3 |
| 编排与 Agent | `workflow` `agent` | 2 |
| 文件传输 | `upload` `file` | 2 |
| **合计** | | **38** |

（组名清单与计数：`cmd/` 目录 38 个 `.md`；与 `报告 §12.7` 的 38 组一致。）

### 9.3 envelope 与 I/O 契约

| 项 | 契约 | 证据 |
|---|---|---|
| 成功 | `{ok:true, data, links:[]}` | `SKILL.md:43`；`报告 §12.9` |
| 失败 | `{ok:false, error:{code, kind, message, hint, raw, retryable}}` | `报告 §12.9`；`cli-out/canvas-list.json` 真实样本 |
| 分页 | `{count, count_known, has_more, list, page, page_size, next_page}`；**默认只取第一页**，`has_more=true` 时不得当全量 | `cmd/task.md:58`；`报告 §12.9` |
| 流分离 | **stdout 只放数据，stderr 放进度/重试/诊断**；不要 `2>&1` | `manual/pipes/README.md:3`、`:24` |
| 流式 | `--ndjson` 每行一个事件/记录，适合 Agent 持续消费 | `manual/pipes/README.md:14` |
| 落盘 | `--out PATH` 成功后**原子落盘**，失败不覆盖旧文件 | `manual/pipes/README.md:24` |
| 凭据 | token 只能经 `--token-file` / `--token-file -` / 环境变量注入；`--verbose` 脱敏 | `manual/pipes/README.md:29` |

### 9.4 退出码分类学（13 档，含 2 个厂商扩展）

| 码 | 含义 | 脚本动作 | 证据 |
|---:|---|---|---|
| 0 | 成功 | 继续 | `manual/error-codes.md:7` |
| 1 | 一般失败（**含 `kind=permission`**） | 检查 stderr；permission 须原样回显后停止，**不是**去 login | `:8`、`:21` |
| 2 | 参数错误 | 修正命令 | `:9` |
| 3 | 鉴权失败 | `reelmate login` | `:10` |
| 4 | 任务失败 | 看详情；仅 `retryable=true` 才重试 | `:11` |
| 5 | 任务取消（含 Ctrl-C） | 确认原因后重提 | `:12`、`:19` |
| 6 | 等待超时 | 增大 `--timeout` 或 `task get` | `:13` |
| 7 | **积分不足** | `credits balance`；充值入口 `deeplink pricing`；Agent 续跑 | `:14` |
| 8 | 内容审核未通过 | 换/改素材，**不要自动重试** | `:15` |
| 9 | **画布版本冲突**（兼幂等账本 `pending` 占用） | `canvas get` 读最新版本后重排写 | `:16`；`cmd/ledger.md:10` |
| 10 | **节点锁竞争** | 等协作者释放锁 | `:17` |
| 11 | **幂等账本 `in_doubt`** | 只读复核 → `ledger resolve` / `--force-replay` | `cmd/ledger.md:11` |
| — | 未知错误/输出失败 | 统一退 1 | `:19` |

### 9.5 场景路由：一次只选一个场景

```text
① 咨询（怎么用/功能/教程）→ user-guide.md，原样全量返回，0 命令
② 画布已有文本节点 + 要拆资产/拆分镜/上传剧本/出片 → generate-script.md 交接段
③ 一句话写剧本 / 一键生成剧本（未点名工坊）→ 默认无限画布 + generate-script.md，不问
④ 画布 + 图片提示词/图片节点 → generate-image.md
⑤ 画布 + 视频提示词/视频节点 → generate-video.md
⑥ 画布 + 分镜 Excel 要生视频 → 无场景，停止并说明缺口
⑦ 工坊 + 资产提示词表生图 → gui-backfill-asset-prompt.md
⑧ 工坊 + 已有资产图片包 → gui-backfill-asset-image.md
⑨ 工坊 + 分镜 Excel 生视频 → gui-backfill-shot-video.md
⑩ 工坊 + 有剧本出片/进度不明/中间续跑 → gui-script-video.md（先 detect，只加载当前阶段文件）
```

证据：`SKILL.md:24-35`。
关键产品决策：**「一句话生成剧本」默认走无限画布且不问**，只有对不上路由才问「制片工坊还是无限画布」（`SKILL.md:22`）——即把最高频的冷启动路径做成零决策，把歧义留给低频路径。

### 9.6 阶段机：把"做到哪一步"变成可探测状态

| 项 | 事实 | 证据 |
|---|---|---|
| 五阶段 | `project → script → asset → storyboard → render`，`stage` = **第一个未完成**阶段 | `wf/_stage-machine.md:30`；`cmd/workflow.md:92` |
| 双作用域 | `--scope studio`（工坊）/ `--scope canvas`（画布）；studio 只认 `canvas_id` 空或 `"0"` 的剧集 | `wf/_stage-machine.md:32` |
| canvas 完成条件极简 | script=已有文本节点；asset=已有拆资产或图片节点；storyboard=已有拆分镜或表格节点 | `wf/_stage-machine.md:34-40` |
| studio 完成条件严格 | storyboard 须**每个正式剧集**的拆解结果 `status=2` 且列表非空 | `wf/_stage-machine.md:39` |
| 只读探测 | 只发 GET；**探不到也退 0**，缺项走 `data.missing`；只有网络/鉴权失败才走错误 envelope | `cmd/workflow.md:27`、`:154` |
| `missing[].goto_stage` | 每个缺项都带回到哪一档；回引后必须重新探测 | `cmd/workflow.md:131-139` |
| `resume --from` | **只记录意图，不证明前置条件已满足**；实时探测发现缺项必须回引 | `wf/_stage-machine.md:97` |
| `status.local_record` | 「上次执行到哪一档」的本地备忘，**不参与阶段判定** | `cmd/workflow.md:157` |
| `next_command` | 只是给调用方看的字符串，**只给建议不自动执行** | `cmd/workflow.md:155` |

**产品含义**：阶段机不是进度条，而是**能力路由表**。它把"用户说继续"翻译成"从哪一档、加载哪个文件、分母是几"，从而保证 Agent 每次都只读一个阶段文档（`wf/gui-script-video.md:20-27`：`project`=1 步、`script`=1 步、`asset`=4 步、`storyboard`=3 步）。这直接解决了 LLM 长上下文下的"临时发明计划"问题——**进度分母不许临场发明**（`wf/_hard-gate.md:9`）。

画布生图/生视频**明确不走阶段机**（`wf/generate-image.md:40`、`wf/_hard-gate.md:21`），改用"当前包三选一"：`create-blank` / `edit-existing` / `regenerate`（`wf/generate-image.md:11-15`）。

### 9.7 硬门（HARD-GATE）：把"可交付"写死成契约

| 门 | 规则 | 产品含义 |
|---|---|---|
| 入口门 | 先按路由表选**恰好一个**场景文档；未选定前不跑写命令；无 contract 时依次查 `--help`，仍未定义则**停止并说明缺口**，不改走语义相近的命令 | 禁止"猜 API" |
| 进度门 | 分母取场景文档写死的步骤表；对用户写 `进度 n/m：动作`；**禁止**把四环节写成 `环节 n/4` | 进度可核对 |
| ID 门 | 所有 ID 只取上一跳 `--json` 的 `data`；`needs_input=true` 时只按 `missing[]` 追问 | 禁止编 ID |
| 写入门 | 批量/付费写先 `--dry-run --json` → 唯一 `--idempotency-key` → 异步查终态 → 部分失败只重跑 `failed[]` → 远端已前进不得拉回旧阶段 | 幂等 + 不倒退 |
| 权限门 | 进入付费参数 HITL **之前**先 `team permission --require <code>`；`kind=permission` 时把 `message` **原样**写入可见回复后停止，禁止重试/换号/`login` | 失败可解释 |
| 完成门 | 场景 `done_when` 全满足才报完成；报告完成必须输出**固定完成总结**七行；缺必填行不算完成 | 交付可验收 |
| 积分门 | 「积分消耗」仅当 **T≥1 且 M=T**（本轮全部生成 `task_id` 都匹配到消耗流水 `rm_task_id`）时输出；否则**整行不输出**，禁止写"预估" | 账目不许编 |
| 余额门 | 积分不足时用户可见回复只含四件：原因(N/B)、充值入口、进度/产物深链、固定续跑句；**禁止**贴 shell、内部 ID、`--idempotency-key` | 不泄露内部契约 |

证据：`wf/_hard-gate.md:7-9`、`:14-15`、`:31-35`、`:39-50`、`:52-67`、`:69`、`:98-113`。
固定完成总结七行：`结果` / `剧厂项目链接` / `参数`（只写展示名） / `产物` / `积分消耗`（条件行） / `积分明细`（**始终保留**） / `未做`（`wf/_hard-gate.md:59-67`）。

**这三件套（阶段机 + 硬门 + 幂等账本）的组合，就是"把 AI 生成流程产品化成可交付流水线"的核心机制**：
1. 阶段机回答「现在在哪、下一步是什么、分母几」；
2. 硬门回答「什么算做完了、什么绝不能做（编数字/贴 ID/猜 API/自动重试）」；
3. 账本回答「这次写到底生效没有」。
三者共同把"生成"这种概率性动作，包成**可复现、可审计、可交接**的工单 —— 其真正交付物不是视频，而是**每一条都能对上账的生成请求 + 一份固定格式的完成总结**。

### 9.8 HITL 呈现协议（宿主无关）

| 规则 | 内容 | 证据 |
|---|---|---|
| 探测顺序 | ① 用户本轮已用序号/展示名答完 → 直接采用，不弹窗不铺列表；② 有结构化多选题工具且未反馈不可见 → **只走弹窗**；③ 否则回退列表 | `wf/_hitl-present.md:9-13` |
| 交付物 | 深链与摘要必须写在**用户可见的最终回复正文**里，与确认问句同一条消息；禁止只放选择器题干/工具结果/推理/折叠块；缺交付物不得提问 | `:17` |
| 不写提交标识 | `id`/`ai_model_mark`/`uk_id`/`generate_image_type`/模板 ID 一律不给用户看 | `:23` |
| 列全 | 长目录（风格/题材）必须仍列全；超限时只把**该确认项**改回退或拆页（两页合起来仍覆盖全部），禁止丢选项、禁止收成「是否使用默认配置」 | `:39` |
| 单选项 | 只剩 1 个有效项时复述该展示名请确认，**不伪造第二项凑数** | `:29` |
| 分步 | 上游会改下游枚举时必须分步：先上游，确认后再列下游；改选上游即丢弃旧下游 | `:27`、`wf/_hard-gate.md:127` |
| 回退格式 | `(N) 展示名`，同一确认项全部选项写同一行、用 `· ` 分隔；推荐只在名称后加 `（推荐）`；禁 Markdown 列表 | `:47`、`:55-57` |

### 9.9 模型目录：只给展示名、现查不写死

| 规则 | 内容 | 证据 |
|---|---|---|
| 现查 | 「模型展示名、可见性、模式、合法参数都以当次命令返回为准。不要在文档或记忆里维护对照表」 | `wf/_models.md:3` |
| 关键字段 | `visible`、`supported_modes`、`mode_order`、`params.generation.<mode>`（含 `ratios`/`resolution_options`/`durations`/`counts`/`max_images`）、场景键 `studio_asset_image`/`script_to_scene_refer`/`storyboard_reference_video` | `cmd/model.md:40-60`；`wf/_models.md:25-28` |
| 排序 | 按 `mode_order[目标模式]` **升序**，缺键者排后；**禁止**按 mark 字母序/展示名字母序重排 | `wf/_models.md:33` |
| 分辨率 | 只按 `resolution_options` 原序列 `label`；提交值≠展示值（`720p_sale` → 「720P优惠版」） | `wf/_models.md:35` |
| 推荐 | 图片含 `TGI 2` 推荐；视频含 `Seedance 2.0 VIP` 推荐；**禁止把列表第一项当默认** | `wf/_models.md:41-43` |
| 目标模式由素材决定 | 无图→`text2image`；单图→`image2image`；多图→`multi_reference`；无图视频→`text2video`；一图→`image2video`（首帧语义 `first_frame`）；首尾→`first_last_frame`；多素材→`universal_reference` | `wf/_models.md:31` |
| 同音歧义 | 目录可能有两条同名记录（如 Vidu Q2、Happy Horse 1.0），筛完仍全列；**禁止**因 CLI 报"不唯一"就删候选或改推 | `wf/_models.md:18` |

`cmd/model.md:28` 披露了模型目录的构建方式：CLI 内置目录**迁移自 Web 画布的 `useCanvasModels.ts` / `modelConfig.ts` / `configs/*.ts` 与中文模型文案**，在线结果再合并 `page_init` 可见性、团队模型能力、项目类型与定价 → 即**前端配置是模型的单一真相源**。

---

## 10. 与外部的互操作

| 通道 | 能力 | 关键约束 | 证据 |
|---|---|---|---|
| `deeplink` | 11 条深链：`canvas`/`task`/`pricing`/`credits`/`project`/`episode`/`asset`/`asset-lib`/`asset-confirm`/`asset-extract`/`asset-result` | **离线生成、不读凭据、不发请求**；URL 不含 token 与语言前缀；缺必填上下文时返回 `raw.needs_input=true` + `missing[]`，**不生成半成品 URL** | `cmd/deeplink.md:3`、`:105`、`:262` |
| `deeplink project` | `/series-manage/<sp_id>?tab=workshop\|canvas` | `creation_mode=1`→`tab=workshop`，`2`→`tab=canvas`；显式 `tab` 优先；**禁止手拼 tab** | `cmd/deeplink.md:128-132` |
| `deeplink pricing` | 站点根 + `action=open_pricing_popup&device_id&client_source=cli&integration_type=plugin&plugin_ver` | 参数顺序固定不重排；设备号读不到就失败 | `cmd/deeplink.md:88-97` |
| `deeplink credits` | 打开 `/home`（Web 积分明细是顶栏弹窗，**无独立消耗页**） | 禁止用 `deeplink pricing` 冒充扣除明细 | `cmd/deeplink.md:111` |
| `export` | `merge` 合成成片（`task_id`=`EXPORT_ID`）、`get` 查记录、`download` 下载 | `merge` 默认 1920x1080/mp4；`get` 不输出短期签名 URL；`download` 仅 `status=2`、原子改名、默认拒覆盖 | `cmd/export.md:53`、`:78`、`:94` |
| `upload` | 本地文件→云存储，算指纹**优先秒传**，大文件分片 + 本地断点；上传后**内容审核** | 审核未通过不返回可继续的成功态；checkpoint 是本地恢复数据不得入库 | `cmd/upload.md:3`、`:43` |
| `file` | `metadata`/`object`/`sign-url` 反查云盘 | 走 **Drive API**，与主站 API 的 header/token 不同；签名地址只短期用 | `cmd/file.md:3`、`:52` |
| `sync-fm` | 把剧集同步到已关联的**喵影（Filmora）** 账号 | 省略 `uid` 时查项目关联账号取首个；无可用账号则本地提示不发请求 | `cmd/sync-fm.md:3`、`:31` |
| 画布文件面 | `canvas/:id/upload-file`、`batch-download`、`batch-file-thumb`、`node/batch-download/{list,url}` | 前端 SDK 层 | `core-lib@` 路径表 |
| 存储 | 阿里云 OSS `alisz-reelmate-storage`，`object_key = pcloud/<uid>/<biz>/<yyyymm>/…`；下载走预签名（`expire=86400`） | — | `报告 §12.4` |

---

## 11. 模型目录统计（只做能力矩阵，不逐条列）

来源：`cli-out/model-all.json`（`model list --json` 真实响应，`ok=true`、`links=[]`）。

| 维度 | 结果 |
|---|---|
| 记录数 | **46**（`data` 为数组，`metadata_missing` 全为 `false`） |
| 供应商（11 家） | `tomoviee` 13、`jimeng` 8、`kling` 7、`hailuo` 5、`happy-horse` 3、`vidu` 3、`wan` 3、`deepseek` 1、`google` 1、`midjourney` 1、`openai` 1 |
| 类型 | `video` 30、`image` 13、`file` 3（文本/文件型） |
| 会员标记 | `need_vip=true` **20**，`false` 26 |
| `supported_modes` 出现次数 | `image2video` 16、`first_frame` 16、`universal_reference` 10、`text2image` 9、`image2image` 9、`first_last_frame` 8、`text2video` 7、`video_edit` 6、`studio_asset_image` 4、`video_extend` 2、`multi_reference` 2（共 **11 种**模式键） |
| `params` 顶层键 | `generation` 43、`storyboard_reference_video` 10、`script_to_scene_refer` 4 |
| 场景键覆盖 | 资产生图 `studio_asset_image` 仅 **4** 个模型；剧本拆分镜 `script_to_scene_refer` 仅 **4** 个；分镜生视频 `storyboard_reference_video` **10** 个 |
| `resolution` 展示名（去重 10 档） | `720P`、`768P`、`1080P`、`1080P全高清版`、`1080P优惠版`、`1K`、`2K`、`2K超清版`、`3K`、`4K` |
| `ratios`（去重 13 档） | `1:1`、`1:2`、`2:1`、`2:3`、`3:2`、`3:4`、`4:3`、`4:5`、`5:4`、`9:16`、`16:9`、`9:21`、`21:9` |
| `durations` | 1–30 秒整数逐档（默认档各不相同，必须现读 `default_duration`） |
| AI 网关端点（去重 **8** 个） | `text-to-image`、`text-to-video`、`image-to-video`、`refer-image-to-image`、`refer-image-to-video`、`refer-media-to-video`、`video-to-video`、`refer-video-to-video` |

三个可直接用于产品决策的读数：

1. **模式差异全部靠参数表达，不靠 URL 膨胀**：46 个模型 × 11 种模式，只落到 8 个端点（`报告 §12.9` 同结论）。→ 复刻时的模型聚合层应是"适配器 + 参数矩阵"，不是"一模型一端点"。
2. **画布与工坊的模型池不是同一套**：工坊资产生图只认 `studio_asset_image`（仅 4 个模型），剧本拆分镜只认 `script_to_scene_refer`（4 个），而画布生图用 `text2image`（9 个）。`wf/_models.md:26-28` 明确「本场景 0 条时**停止**，不改走画布 `text2image` 清单」。→ 场景键是**硬隔离**，不是软过滤。
3. **`video_reference` 是个"孤儿 mode"**：CLI `node.md` 列了它（`:80`），前端也认（`"video_reference"` 命中 3 个文件），但 46 个模型的 `supported_modes` 里**一次都没出现**。→ 推断：该模式依赖白名单/灰度，或仅在特定项目类型下由服务端临时放开。

---

## 12. 未知项 / 证据缺口（15 项）

| # | 未知项 | 现有线索 | 影响 |
|---:|---|---|---|
| 1 | MCP Server 的工具清单、传输方式、鉴权模型 | 产品页只写「MCP & CLI」并列；证据基座只有 CLI Skill 包，`SKILL.md`/`INSTALL.md` 全文无 MCP 字样 | **高**——若要对标"AI 可直接调用"，这是缺失的另一半 |
| 2 | 画布 Agent SSE 的完整事件类型表 | 仅知 `GET .../stream` 端点、`interrupt_id`/`card_type` 三类卡、`answers[]`/`selected_solution_id` 字段 | 高——决定能否复刻"边生成边落节点"的流式体验 |
| 3 | `clip` 的 `timeline` JSON 完整 schema | 报告 §10 已列为未知；前端只见 `params.clips[]`（`clipId`/`sourceNodeId`/`trimStartMs`/`trimEndMs`） | 中——时间线是差异化功能 |
| 4 | 画布版本冲突的自动合并策略 | 只知 exit 9 + `ANU_VERSION_CONFLICT`；写链路「心跳→加锁→版本→写入→回读」 | 中——决定多人协作的上限 |
| 5 | `nodes-recover` / `group-recover` 的真实恢复语义 | 后端接口存在，CLI 明确"暂不可用" | 低——但说明 Web 有回收站 |
| 6 | 画布侧资产（`script asset-extract`）与工坊 `resource` 是否互通 | `cmd/script.md:146` 原话「是否互通尚未确认，不要声称可以互相转换」 | 高——决定两条线能否共享资产库 |
| 7 | `node table import` / `confirm-sheet` 真实契约 | 两处均标 **[YApi] 待实测**；`cmd/node.md:390` 要求「不得声称已验证」 | 中——Excel 是制片侧主力输入 |
| 8 | 整画布模板 4 个子命令真实契约 | `cmd/canvas.md:148-218` 全部标 **[YApi] 待实测** | 中——模板是冷启动能力 |
| 9 | `clip create` / `clip crop` 真实字段 | `cmd/clip.md:5`、`:69` 标待实测；`crop` 字段"未登记字段不得猜测" | 中 |
| 10 | `clip` 导出枚举的真相 | CLI 写 `480p/720p/1080p` + `mp4/webm`；前端写 `720p/1080p/2k/4k` + `target=local\|canvas` | 低——但说明文档落后 |
| 11 | `multi_camera_grid_9` 是否已上线 | CLI `node.md:79` 列出；前端 473 个源文件**零命中**该字面量 | 低——疑似灰度/预留 |
| 12 | 生成**成功响应体**结构（`task_id` 字段名、进度事件格式、结果 URI 结构） | 报告 §10 列为未知（账号 0 积分，创建请求在计费前被拦） | **高**——CLI 的 `task wait`/`result.items[]` 到底长什么样未直接观测 |
| 13 | 远端 `agent-recommend-cards` 的实际 tag 分布 | 本地只有 4 张硬编码兜底卡（全是 `video`/`skill` 两类） | 低 |
| 14 | 7 个预置 pin 组在 Web 端是否可改名/换色 | CLI 可 `--name` 命名；前端有 `renamePinGroup`；颜色数组硬编码 7 色 | 低 |
| 15 | Yjs / BroadcastChannel 具体服务哪些对象 | Yjs 完整实现被打包（`CDTYuSrS.js` 88KB）；画布同时有 `editable` 只读态 + exit 9/10 | 中——推断为文本类协同，未证实 |

补一条口径提醒：`报告 §12.9` 的 `credits balance` 实测返回 `total_val=0`，本仓库 `cli-out/canvas-list.json` 也是**失败样本**（`{"ok":false,"error":{"kind":"usage","message":"未确定生效工作区…"}}`）——所以本域**所有涉及"真实计费成功后产物形态"的结论都没有一手证据**，凡涉及此处的表述均已标「推断」或列入上表。
