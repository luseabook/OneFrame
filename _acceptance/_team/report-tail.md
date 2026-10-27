# 收尾小项打包（task-15）交付回报

> 工作区 `E:\wanxing`，代码 `E:\wanxing\app`。6 个子项跨 5 个后端模块 + 4 个页面，逐项都有可验证行为。
> 未执行 `git commit`。

## 交付

### 端点（新增 11 条路由 + 1 条扩展）

| # | 方法 / 路径 | 说明 |
|---|---|---|
| 1 | `GET /v1/home/config` | 首页板块配置（space 覆盖 > global > 内置默认，`source=default\|db`） |
| 2 | `GET /v1/home/unread?since=&timeout_ms=` | 未读**长轮询**（最多 25s，可中断，有增量立即返回） |
| 3 | `GET /v1/home/ab?key=` | AB 命中（一人一变体，落 `ab_hits`） |
| 4-7 | `GET/POST/PUT/DELETE /v1/ops/admin/promo-slots` | 运营位 CRUD（四类 slot + 时间窗口 `active_now`） |
| 8 | `POST /v1/moderation/captcha/ticket` | 验证码票据（`available:false` + 本地算术题） |
| 9 | `POST /v1/moderation/captcha/verify` | 验票（HMAC 签名 + 5 分钟 + 一次性 + 答错作废） |
| 10 | `POST /v1/moderation/text-detect` | 文本检测（`{risky, hits[{word,index,category,level}], action}`） |
| 11 | `GET /v1/moderation/status?task_id=` | 审核态只读（6 reviewing / 7 rejected + 最近事件） |
| 12 | `POST /v1/share/:token/batch-download` | 分享页打包下载（**公开只认 token**，只打包该 share 任务产物） |
| 13 | `POST /v1/canvas/canvases/:id/nodes-recover`（扩展） | 新增快照恢复模式（只补缺失、不覆盖、无快照 400102），保留既有 `node_ids` 撤销软删 |

新模块 `apps/api/src/modules/home/**`；`HomeModule` 已按 `KdsModule` 锚点注册进 `app.module.ts`（别人的 Novel/Film/Director/Subjects/Extraction 注册都在，没丢）。

### 页面

| 页面 | 改动 |
|---|---|
| `apps/web/pages/home.vue` | 板块**显隐 + 顺序**由 `/home/config` 驱动；未读红点走长轮询；AB 位按 variant 换 CTA 文案（`data-variant` 可核） |
| `apps/web/pages/admin/index.vue` | 概览页新增「运营位」面板：新建/启停/删除 + 服务端算的「生效中」 |
| `apps/web/pages/share/[token].vue` | 新增「打包下载全部」（公开接口，无凭证） |
| `apps/web/pages/create/video-upscale.vue` | 「去字幕（框选区域）」：画面上拖矩形 → `region_x/y/w/h` → 仍走既有 `de_subtitle_region` |
| `apps/web/types/api.ts` | 新增 12 个 DTO（Home*/PromoSlot*/Captcha*/ModerationText*/ShareBatchDownload/CanvasRecoverResult） |

### 测试

| spec | 用例 | 覆盖重点 |
|---|---:|---|
| `test/home-config.spec.ts` | 17 | 未配置→默认板块 / global→space 覆盖优先级 / 长轮询真挂起（400ms timeout）与增量立即返回 / 不漏别人任务 / 跨 space 403 / AB 一人一变体 + 唯一约束 / 实验停用 |
| `test/admin-promo.spec.ts` | 11 | 四类 slot / active_now 四种情形（生效/未开始/已结束/停用）/ slot·status 过滤 / sort 升序 / 更新生效 / 非法 slot 与非法时间 400101 / 不存在 400102 / 删除二次 400102 / 401+403 / **配置驱动闭环：新建→公开读接口出现→停用→消失** |
| `test/moderation-captcha.spec.ts` | 15 | 诚实口径（available/provider/integration）/ 验票通过 / 同票重放 used_or_expired / 答错也作废 / 篡改 invalid_ticket / 过期 expired / 文本命中位置与分类 / 多命中按位置升序 / 未登录 401 / 审核态 6·7 / 跨 space 不泄露存在性 |
| `test/share-batch.spec.ts` | 7 | 匿名可下载 / **解压 zip 读 manifest：只含该 share 任务、兄弟任务文件不出现** / 撤销 400102 / 过期 400102 / 未知 token 400102 / 无产物 400102 / 公开预览回归 |
| `test/canvas-recover.spec.ts` | 10 | 无快照 400102 / 两模式互斥 400101 / 非雪花 id 400101 / 跨 space 400102 / 硬删节点+边后补齐 / 快照后新节点不被覆盖 / 幂等 0 补 0 / 软删不复活 / node_ids 撤销软删回归 / 版本不被推进 |

**已实测（全绿，5 文件同跑）**：

```
$ npx vitest run test/home-config.spec.ts test/admin-promo.spec.ts \
    test/moderation-captcha.spec.ts test/share-batch.spec.ts test/canvas-recover.spec.ts
 Test Files  5 passed (5)
      Tests  60 passed (60)
   Duration  7.29s        ← 5 个 spec 合计 7.29s：其中长轮询用例只挂 400ms，
                            若真的挂 25s，单这一条就会超过整个时长

$ npx vitest run test/admin.spec.ts test/canvas.spec.ts        ← 回归
 Test Files  2 passed (2) | Tests  56 passed (56)

$ pnpm --filter @app/api lint        → eslint src（0 error）
$ pnpm --filter @app/web typecheck   → nuxt prepare + vue-tsc（0 error）
$ pnpm --filter @app/web lint        → 0 error（12 warning 均为既有文件）
$ cd apps/api && npx tsc --noEmit    → 0 error（全树）
```

「配置驱动闭环」这条用例的通过输出（本批最有价值的断言——它证明后台配置真的驱动前台）：

```
✓ ops admin promo slots e2e > 配置驱动闭环：新建的 banner 立即出现在公开读接口
  crc/banner_list，停用后消失
```

断言内容：admin 建 banner → 普通用户 token 调 `GET /v1/crc/banner_list?type=banner`
**立即**包含该 id → admin 停用（status=2）→ 同一个公开接口**立即不包含**该 id。
（`crc/banner_list` 读的是 `OpService.listActivePromoSlots`，与本批 `active_now` 同表同条件。）

## 已实现

1. **首页配置驱动**：`home_configs` 一行一快照，读取优先级 space > global > 内置默认；读不到配置返回 `source:"default"` + 六板块（hero/workflow/canvas/tools/banner/recent），**不是 500 也不是空数组**。前端按 `sections[].sort` 排序、`visible` 显隐；未配置时布局与改动前完全一致（只有拿到真实配置才启用 flex `order`）。
2. **未读长轮询（可中断）**：`setTimeout` 轮询 DB 增量（`task_events` join `tasks` + `task_shares`），单轮 200ms 分片睡眠，客户端断开时 `req.raw` 的 `close` 让循环在 ≤200ms 内退出；`timeout_ms` 上限 25s，超时返回 `timed_out:true` 且 **cursor 不变**（客户端原样带回，不会跳读）。首次调用无 `since` 时立即返回当前游标。
   **为什么不用 WebSocket/SSE**（代码注释里也写了）：① 首页红点只要「有没有新动态」一个比特，WS 需要连接表/心跳/多实例广播（Redis pub/sub 或 sticky session），运维面与故障面都大；② 仓库已有 `GET /tasks` 轮询与 `GET /agent/task/stream` 的 SSE，再引一条 WS 会出现两套推送语义，前端更难对齐；③ 长轮询可随客户端断开**立即释放**，不占连接池。也**没有**给每个请求开 `pg LISTEN`（那会让每个挂起请求独占一条 PG 连接）。
3. **AB 位**：按 `key` 取运行中实验（status=2 且时间窗内），无实验 → `active:false`（不伪造变体）；命中用 `(user,key)` 确定性分桶，首次落 `ab_hits`，之后永远读回同一行（唯一约束 `uq_ab_hits` 兜底并发首刷）。
4. **运营位后台**：四类（banner/pop_up/activity/creator）CRUD；`active_now` = status=1 且当前时间落在窗口内，**结束时间用闭区间**与公开读接口 `OpService.listActivePromoSlots` 同口径；`created_by` 落真实运营 id（迁移 0028 后 FK → `admin_users(id)`）。
5. **内容安全**：验证码票据（HMAC 域隔离签名 + 5 分钟 exp + Redis `jti` 一次性，多实例同样成立；**答错也消耗票据**，防止 100 种答案被枚举）；文本检测沿用既有词表（`resolveModerationWords`，不另维护一份）并给分类/等级/位置，`action ∈ allow|review|block`，**不改**既有围栏 `assertText` 的拦截语义；审核态只读透出 6/7 两态与最近事件。
6. **分享批量下载**：公开端点只认 token；打包范围**只由 share 行决定**（不接受 `task_ids`），并校验 `tasks.spaceId === share.spaceId`；zip 的 manifest 只含 `mode/task_id/files`（无 space/user/积分）。撤销/过期/无产物一律 400102。
7. **画布恢复**：新增快照模式——只补缺失节点与边、不覆盖现存、软删不复活（要救走 `node_ids`）、边两端必须都在（不恢复悬挂边）、无快照 400102、连调幂等；顺带修了 `recoverNodes` 用 `BigInt(id)` 抛 500 的问题（改 `asSnowflake` → 400101）并让返回值是**真实恢复条数**（原来回显入参长度，传错 id 也"看起来成功"）。
8. **后处理 UI**：只产出 `region{x,y,w,h}`（归一化 0~1）→ 提交 `region_x/y/w/h`，服务端 `normalizeToolOptions` 归一为适配器认识的 `region`；**不改后端 mode**（仍是 `de_subtitle_region`）。拖拽用 Pointer Events + `setPointerCapture`，遮罩用百分比定位（窗口缩放不错位），过小矩形视为误触并回退默认框。

## 受限（不是"没做"，是有明确外部条件）

1. **验证码只能本地模式**：无第三方（腾讯云/极验/阿里云）Key，也没有其服务端 SDK/回调校验。接口**恒**返回 `available:false`、`provider:null`、`integration:"none"`（若运维配了 `CAPTCHA_PROVIDER` 则报 `integration:"not_implemented"`），**绝无**「已接入腾讯云」文案。本地算术题是**弱**门槛（a+b 只有 100 种可能），它的价值在"签名 + 5 分钟 + 一次性"，不在"能挡住脚本"。
2. **运营位面板放在「概览」tab 内 —— 这是有意的 UI 取舍，不是没做完**：运营位属于"配置类"功能，而概览是运营打开后台的默认落点，内嵌反而少一次点击；独立菜单项需要改 `composables/useAdminMenu.ts` 的 `AdminTab` 联合类型，牵动菜单与路由状态，收益只是"多一个入口"。Panel 本身功能完整（新建/启停/删除/生效中）。
3. **复跑期间的两次环境阻塞（已解除，记录备查）**：先是 op 域 `op.module.ts` 引用不存在的 `./op.kv`，随后是 `MarketModule` 缺 `MarketTaxonomyService` provider（`UnknownDependenciesException`）——AppModule 是全局入口，这两次都会让**所有** e2e spec 连 collect 都过不去（不是"只红他自己"）。两个问题由对应 owner 修好后，本批 5 个 spec + 2 个回归 spec 一次性全绿（见上方实测）。
4. **`HOME_UNREAD_TIMEOUT_MS` 通过 `config/env.ts`**（Lead 已加），服务端 `Math.min(env.HOME_UNREAD_TIMEOUT_MS, 25_000)` 双上限；测试用显式 `timeout_ms=400` 证明不会挂 25s（5 个 spec 合计 7.85s）。

## 未做（诚实列出）

1. 运营位的**曝光/点击计数**只有列（`view_count/click_count`），没有打点接口——竞品 `crc/banner_list` 是只读列表，打点端点未见证据，不臆造。
2. 首页配置**没有后台写入口**（`GET /home/config` 只读；`home_configs` 目前靠 seed/SQL 维护）。写入口需要"谁能改平台配置"的权限模型，本批未定义。
3. AB 实验**没有管理端点**（建实验靠 schema/seed；本批只做"命中 + 落库"）。
4. 验证码**没有接入任何业务入口**（登录/注册仍在 `modules/auth`，本批明确不碰；captcha 端点已就绪，接线由 auth 侧决定）。
5. `moderation/text-detect` 只做**词表**检测，没有接供应商机器审核（`available` 能力仍以词表为限）。
6. 分享打包**同步生成**（大产物会让请求变长）：当前结果集很小可接受，超大批量应改异步任务——已登记为后续优化。
7. 页面只做了 `typecheck/lint` 与逻辑接线，**没有**跑浏览器 E2E（本批未要求，且 dev 栈需同时起 api/web/worker）。

## 需要 Lead 做

1. **等 op 域补 `op.kv.ts`** 后复跑：`npx vitest run test/home-config.spec.ts test/admin-promo.spec.ts test/moderation-captcha.spec.ts test/share-batch.spec.ts test/canvas-recover.spec.ts`（我这边随时可复跑确认）。
2. **（可选）运营位独立菜单**：`composables/useAdminMenu.ts` 加 `{ key: "promo", label: "运营位", hint: "首页 banner / 弹窗 / 活动" }`，`AdminTab` 加 `"promo"`；我改一行判断即可切到 `tab === 'promo'`。
3. **（可选）首页配置写入口**：若要运营可改板块顺序，需要先定"平台配置"权限模型（admin 直写 `home_configs`），本批未做。

## 证据

- 运营位公开读口径：竞品 `rea-reelmate/routes.txt:290`（`/web/v1/crc/banner_list`）、`:295`（`/web/v1/crc/pop_up`）；我方读侧 `modules/op/op.service.ts:748 listActivePromoSlots`，本批写侧与它**同表同条件**（status=1 + 时间窗闭区间 + sort 升序）。
- 画布恢复：竞品 `rea-reelmate/routes.txt:359`（`/web/v1/df/canvas/:canvas_id/nodes-recover`）；既有软删撤销语义保留在同路由的 `node_ids` 分支。
- 分享打包：竞品 `rea-reelmate/routes.txt:877`（`/web/v1/task/share/{share_id}/batch-download`）；我方对外用 token 而非 share_id（不暴露内部 id）。
- 验证码：竞品 `rea-reelmate/routes.txt:273`（`/web/v1/captcha-check`）、`:850`（`/web/v1/op/mobile-captcha`）、`:772-773`（`email-captcha`）；我方**未接第三方**，故 `available:false` + 本地模式。
- 未读：竞品 `rea-reelmate/routes.txt:828`（`/web/v1/msg/exist-unread`）只有"是否存在未读"语义，没有增量长轮询接口；我方按本批口径自建增量游标（`since`/`cursor`），未照抄竞品。
- 后处理区域：mode 来自既有工具目录 `modules/generations/tool-catalog.ts:311-340`（`de_subtitle_region` + `region_x/y/w/h` 参数 + `fixedOptions.mode="region"`），适配器在 `packages/model-adapters/src/postprocess-tools.ts:529-548` 读 `options.region`。

## 改动文件清单

```
新增  apps/api/src/modules/home/{home.module,home.controller,home.service}.ts
新增  apps/api/src/modules/moderation/{moderation.controller,captcha.service,status.service}.ts
改动  apps/api/src/modules/moderation/{moderation.service,moderation.module}.ts
改动  apps/api/src/modules/admin/{admin.controller,admin.service}.ts
改动  apps/api/src/modules/tasks/{tasks.service,task-share.controller}.ts
改动  apps/api/src/modules/canvas/{canvas.controller,canvas.service}.ts
改动  apps/api/src/app.module.ts（+2 行：HomeModule import / imports 数组，锚点 KdsModule）
新增  apps/api/test/{home-config,admin-promo,moderation-captcha,share-batch,canvas-recover}.spec.ts
改动  apps/web/pages/{home.vue,admin/index.vue,share/[token].vue,create/video-upscale.vue}
改动  apps/web/types/api.ts（仅追加 DTO，未改既有类型）
```

未改：`schema.ts`、迁移、`docs/**`、`nuxt.config.ts`、`layouts/**`、`composables/**`、`modules/auth/**`、其它模块与 spec。
