# 首发补全 C 交付报告：3D 导演台后端持久化 + 心跳 + 组件接线（task-12 / tools-impl）

> 日期：2026-10-27 · 模块 #19 3D 导演台（45% → 可用）· 迁移 0024 的两张表
> 约束遵循：payload 不重新设计（按 `Director3D.vue` 现有状态落盘）· 乐观锁 746002 · 心跳不落库

---

## 1. 交付

### 1.1 端点（新模块 `apps/api/src/modules/director/`）

| # | 方法 路径 | 说明 |
|---|---|---|
| 1 | `POST /director/scenes` | 保存整份场景快照，返回 `version=1`；`project_id`/`episode_id` 做 space 与父子归属校验 |
| 2 | `GET /director/scenes/:id` | 读单个场景（软删/跨 space 均 404） |
| 3 | `GET /director/scenes?project_id=&episode_id=&page=&page_size=` | 列表，**最近编辑优先**（前端"打开项目即载入最近场景"依赖此顺序），带缩略图（storage key → 读时签名） |
| 4 | `PUT /director/scenes/:id` | 乐观锁：`version` 不匹配 → **746002**，`msg` 带 `current=N`（统一信封不暴露 details，详见 §2.2） |
| 5 | `DELETE /director/scenes/:id` | 软删（`deleted_at`）；顺手清该场景心跳 hash |
| 6 | `POST /director/scenes/:id/duplicate` | 复制为新场景（`version=1`，名字默认"… 副本"，快照与缩略图一并复制） |
| 7a | `POST /director/pose-presets` | 保存姿态预设（`scope` 1 个人 / 2 团队） |
| 7b | `GET /director/pose-presets?scope=` | 列表：**团队共享 + 我的个人预设**；别人的个人预设不返回 |
| 8 | `POST /director/heartbeat` | 编辑心跳：Redis HASH（整 hash TTL 61s）+ 读取时按 60s 时间戳过滤；返回除自己外的协作者（昵称 + `last_seen_ms`） |

合计 9 条路由（任务书里的"8 端点"把姿态预设的 POST/GET 算作一条）。权限：全局 `AuthGuard` + `TeamService.requireMember`（非成员 **403**），全部按 space 隔离。

**payload 契约（服务端不解析语义）**
- 入参：任意 JSON **对象**，序列化 > **512KB** → `400101 payload too large`（防止把图片 base64 塞进场景）；
- 落库：整份 jsonb；读出原样返回。为什么这样定见 `director.service.ts` 顶部注释（编辑器加字段不该发后端版）；
- 前端实际落盘形状（与组件现有状态一致）：
  ```json
  {"schema_version":1,
   "camPos":{...},"camTarget":{...},"fov":50,"groundOpacity":0.4,
   "positions":[{"id","name","x","z","rot","pose","image"}],
   "cameras":[{"id","name","pos","target","fov"}],"activeCamIndex":0,
   "settings":{"viewMode","gridSnap","showLabels","sceneScale","sceneRot"}}
  ```
- 姿态预设 payload 是**快照子集**（`positions` / `cameras` / `activeCamIndex`）。数据库列注释里写的是 `{bones,camera}`，但当前编辑器没有骨骼概念（位姿是 `pose` 枚举 + 位置），按"以组件现有状态为准"落成站位/机位子集——**这是与 schema 注释的已知差异**，见 §4.3。

### 1.2 前端接线

- 新增 `apps/web/components/director/useDirectorPersistence.ts`（协议层：载入/保存/冲突/预设/心跳，可单测的纯逻辑）；
- `apps/web/components/Director3D.vue`（**只加不改既有行为**）：
  - 新 props `projectId` / `episodeId`；有项目时走服务端，无项目保持原 localStorage 行为（独立导演台不受影响）；
  - 打开：本地存档先上图（秒开）→ `GET /director/scenes?project_id=…` 载入最近场景并覆盖（服务端为准），顺手镜像回 localStorage；
  - 保存：顶栏「保存」+ **30s 自动保存**（仅有改动时）+ **30s 心跳**；关闭面板时若有未保存改动先 flush；
  - 冲突：出现冲突条「场景已被他人更新到 v2」+ 「覆盖服务端」/「载入最新」两个动作；
  - 姿态预设：左栏「姿态预设」下拉（应用）+ 预设名/个人·团队/「存为预设」；
  - 缩略图：`capture()` 定格时把 PNG 经 `/assets/upload` 上传，存 **storage key**（不存签名 URL，避免过期）→ 列表返回时后端签名；
  - 协作者：顶栏「👥 N 人在编辑」（hover 显示昵称与秒数）。
- `apps/web/types/api.ts`：仅追加 `DirectorSceneDto` / `DirectorPosePresetDto` / `DirectorHeartbeatDto`。
- **项目页挂载（最小改动，3 处）** `apps/web/pages/projects/[id].vue`：
  1. script：`directorOpen` + `directorActors`（复用 `characters` 的 id/名字/参考图）；
  2. 顶栏右侧：新增一个 `Button`「3D 导演台」（放在「保存」按钮左边，未重排页面结构）；
  3. template 末尾：`<Director3D :open="directorOpen" :project-id projectId :episode-id :actors @close>`。
  如需换入口位置（例如挪进某个 tab 或工具栏），删这三处即可，组件本身不依赖它们。

### 1.3 测试与验收

**API spec `apps/api/test/director.spec.ts`：13/13 通过**
```
npx vitest run test/director.spec.ts    ✓ 13 passed
```
逐条覆盖（DoD 要求的成功 / 403 / 版本冲突 / 软删后不可读 全在）：

| 用例 | 覆盖点 |
|---|---|
| 保存返回 v1 + 读回 payload 逐层一致（含 `editorExtras` 这类编辑器未来字段） | 成功路径 + **不解析≠清洗** |
| 列表按项目筛、最近编辑优先、带签名缩略图 | 成功路径 |
| payload 非对象 / 超 512KB / episode_id 缺 project_id / 别人项目的 project_id | 参数校验 + 隔离 |
| PUT 旧 version → **746002** 且 msg 含 `current=2`；服务端数据未被旧版本覆盖 | **版本冲突** |
| 只改 name/thumbnail 不动 payload；缺 version → 参数错误 | 局部更新 |
| 复制：新 id、v1、快照一致、名字"… 副本" | 成功路径 |
| **软删后 GET/PUT/duplicate 全 404、列表不再出现** | **软删后不可读** |
| 跨 space 读别人的场景 → 404（不泄漏存在性） | 隔离 |
| 个人预设保存 + `mine=true`；scope 非法 → 参数错误 | 预设成功/校验 |
| 团队预设（scope=2）对我可见且 `mine=false`；**别人的个人预设不可见** | 预设可见性规则 |
| 心跳 ttl=60、自己不计入协作者、别人在线能列昵称与 `last_seen_ms`、超时 field 被清理、**版本号不动（证明未落库）** | 心跳 |
| 心跳对不存在场景 → 404 | 心跳隔离 |
| 被移出 space 的用户 → **403** | **403** |

**HTTP 级验收（真实栈，非 inject）`_acceptance/verify-director.cjs`**
```
[1] 保存: code=0 id=… version=1
[2] 重开: 列表 total=1 最近=curl 场景 → payload 与提交逐字节一致=true
[3] 更新: code=0 version=2 fov=35
[4] 旧版本覆盖: code=746002（期望 746002）msg="scene version conflict: current=2"
[5] 复制: code=0 新 id=… version=1 名字=curl 场景 v2 副本
[6] 预设: 保存 code=0 scope=2; 团队列表 total=1
[7] 心跳: code=0 ttl_s=60 协作者=0
[8] 软删: delete code=0; 删后读 code=400102（期望 400102）
```
> 注：`[2]` 用**规范化键序**比较——PostgreSQL jsonb 会重排对象键，字节序比较必然不等，语义（`toEqual`）一致，spec 里用的就是深比较。

**真实浏览器 E2E `_acceptance/e2e-director.cjs`：13/13 通过**（截图 `_acceptance/director-e2e/`）
```
S1.3 项目页有「3D 导演台」入口          ✅
S1.4 点击后打开导演台遮罩（.d3 出现）    ✅
S1.5 首次打开显示「尚未保存」            ✅
S2.1 保存后状态条「已保存 v1 · 10:24:45」 ✅
S2.2 API 里出现该项目场景（快照含相机/机位/角色）✅ total=1 version=1
S3.1 关闭后遮罩消失                      ✅
S3.2 重开后读回服务端版本（显示 vN）      ✅
S4.1 服务端更新成功（v1 → v2）           ✅
S4.2 出现版本冲突条并提示服务端 v2        ✅
S4.3 点「载入最新」后冲突条消失           ✅
S5.1 无未预期控制台错误                  ✅ clean
```

**门禁**
```
pnpm --filter @app/api typecheck     ✓ 0 error
pnpm --filter @app/worker typecheck  ✓ 0 error
pnpm --filter @app/web typecheck     ✓ 0 error
npx eslint src/modules/director test/director.spec.ts  ✓ 0 error / 0 warning
```
> 全仓 `pnpm --filter @app/api lint` 当前有 **3 个错误，全部在 `src/modules/script/quality-check.service.ts`（未使用 import，属他人本轮在途文件）**，与本批无关；我的文件 eslint 0。typecheck 全绿说明这些文件已能编译（lint 只是未清 import）。

### 1.4 涉及文件

```
新增  apps/api/src/modules/director/{director.controller.ts, director.service.ts, director.module.ts}
新增  apps/api/test/director.spec.ts
改    apps/api/src/app.module.ts                     （仅 import + imports 两行，锚点 KdsModule 附近）
新增  apps/web/components/director/useDirectorPersistence.ts
改    apps/web/components/Director3D.vue             （加 props / 顶栏状态 / 冲突条 / 预设区 / 自动保存与心跳；既有渲染与本地存档行为保留）
改    apps/web/pages/projects/[id].vue               （最小改动 3 处：state 2 行 + 顶栏按钮 + 组件挂载）
改    apps/web/types/api.ts                          （只追加 3 个 interface）
新增  _acceptance/e2e-director.cjs、_acceptance/verify-director.cjs
```
未改：迁移/schema（0024 已由 Lead 建好）、`docs/**`、其他模块文件。

---

## 2. 关键设计决定（含踩到的坑）

### 2.1 心跳：**每场景一个 HASH**，不是"每人一个 key + SCAN"
最初按"每用户一个 key（`director:hb:<scene>:<user>`，TTL 60s）+ `SCAN MATCH` 汇总"实现，实测在 dev 库（keyspace 已万级）**首轮 `SCAN COUNT 100` 返回空**，20 轮也命中不到该场景的 key → 协作者永远 0。心跳是每次打开导演台都会调的接口，不能依赖"扫到为止"。
改为：`HSET director:hb:<scene> <user_id> '{"at":…}'` + `EXPIRE 61s`；读取 `HGETALL`（O(协作者数)，与库大小无关），按 `at` 过滤超 60s 的残留并 `HDEL`。既满足"Redis + TTL 60s、不落库"，也不受 keyspace 规模影响。

### 2.2 版本冲突要把"服务端当前版本"传出去
统一信封 `{code,msg,data}` 不含 `details`（`AllExceptionsFilter` 只 `fail(code,msg)`），所以冲突信息分两处给：
- `msg` 里带可解析文本 `scene version conflict: current=2`（**前端就是从这句拿 v2 的**，`useDirectorPersistence` 用 `/current=(\d+)/`）；取不到时再 `GET` 一次兜底；
- `AppError.details` 同时给结构化 `{field,expected,current}`（与 film 表级乐观锁写法一致，供服务端日志/后续过滤器用）。

### 2.3 "未保存修改"标志必须用 `flush: "sync"` 的深 watch
组件状态 ↔ payload 的映射集中在 `sceneSnapshot()/applySceneSnapshot()`。载入远端快照时会赋值一堆响应式字段；若 watcher 用默认 pre-flush，这些赋值被攒到下一轮，那时 `applyingRemote` 已复位 → **一载入就显示"有未保存修改"、30s 后自动回存一遍**（实测 E2E 首轮就是这样：S1.5/S2.1/S3.2 全红，且关闭面板触发了一次多余 PUT，把版本推到 v2 导致后续 746002 用例前置失败）。
修法：watcher `{deep:true, flush:"sync"}` + `applyingRemote` 同步复位 + 打开/应用快照后 200ms 抑制窗口；保存/载入在 `await nextTick()` 之后才清/设 dirty。

### 2.4 场景快照的缩略图存 storage key
`/assets/upload` 返回的 `url` 是**签名 URL**（会过期），存进 `thumbnail_uri` 第二天就 403。所以存 `asset.uri`（storage key），读时由后端 `StorageService.signDownload` 现签；已是完整 URL 的值原样返回（兼容外部图）。

---

## 3. 证据

| 交付项 | 依据 |
|---|---|
| director 域 8 个操作（save/info/list/update/delete/duplicate/pose-preset/heartbeat） | `docs/07-plan/completion-plan-to-100.md` 首发补全清单；`packages/db/src/schema.ts:2770-2818` 的列与注释（`version` 乐观锁、scope 1/2） |
| 746002 版本冲突码 | `packages/shared/src/errors.ts:36`（`VERSION_CONFLICT: 746002`，"Ph3 画布；对应 RE CLI exit 9"），与影视版同码 |
| 心跳 60s / 不落库 | 任务书约束；`RedisService`（ioredis）既有封装 |
| 快照字段集 | `Director3D.vue` 的 `loadState()/saveState()`（camPos/camTarget/fov/groundOpacity/positions/cameras/activeCamIndex）+ 组件其它编辑状态（放在 `settings`） |
| 403 语义 | `TeamService.requireMember`（kds/film 同款守卫） |

---

## 4. 已知偏离 / 待取证

1. **`pages/projects/[id].vue` 我改了三处**（任务书允许"最小改动"，但该页本轮无 owner、随时可能被他人改）。若发生冲突：保留 `Director3D.vue` + `components/director/*` 即可，挂载点等价替换为任何 `<Director3D :open :project-id />`；三处锚点在 §1.2 写明。
2. **服务端不解析 payload**：只校验"对象 + ≤512KB"。这意味着 payload 里塞非法字段（例如 `fov:"abc"`）也能存进去，由前端 `applySceneSnapshot` 做防御式清洗（读到非数字回落默认）。这是刻意选择（编辑器演进不该发后端版），代价是"坏快照"不会被服务端拒绝。
3. **姿态预设 payload 形状与 schema 注释不一致**：列注释写 `{bones,camera}`，实际存 `{positions,cameras,activeCamIndex}`——当前编辑器没有骨骼概念（位姿是 `pose` 枚举）。若后续接骨骼，只改前端映射，后端不用动。
4. **协作只验到"单浏览器 + Redis 造第二人"**：真实双浏览器同时拖同一场景没有做（需要两个登录态并行）。已验：自己不计入、别人的心跳能列出昵称/秒数、超时清 field、心跳不写库。
5. **删除没有 UI 入口**：`DELETE` 端点有 spec 覆盖（软删后不可读），但导演台面板没放"删除场景"按钮（避免误删；个人/团队场景的删除确认交互待产品定）。
6. **WebGL 渲染本身未在 E2E 断言**：headless Chromium 的 three.js 画布不做像素比对，E2E 只验"遮罩打开 + 保存/重开/冲突链路"与控制台清洁；3D 场景视觉效果需人工验收。
7. **缩略图上传路径只在 spec 里走"签名读"**：E2E 未点「定格截图」（会触发浏览器下载，headless 下无意义），`/assets/upload` → `thumbnail_uri` → 签名列表已由 spec 覆盖。

---

## 5. 需要 Lead 做

1. **确认项目页入口位置**：目前是顶栏「3D 导演台」按钮（保存在按钮左侧）。若产品希望放到某个 tab（如"分镜"面板内）或侧栏，请指定，我按新锚点挪一次即可。
2. **api-spec 同步**（`docs/**` 不在我权限）：新增 `/v1/director/*` 9 条路由、payload 上限 512KB、746002 的 `current=N` 响应约定、心跳响应结构（`ttl_s` / `collaborators[].last_seen_ms`）。
3. **进度文档**：模块 #19 从 45% → 可用；"删除 UI / 真实双人协同 / 骨骼位姿"记为剩余缺口。
4. 运行环境提醒：本轮期间 `team.service.ts` / `script.quality-check.service.ts` 等他人文件曾在途（一度导致 `AppModule` 无法初始化、`pnpm --filter @app/api lint` 红）；我交付时的状态：typecheck 全绿、spec 全绿、我的文件 lint 0。
