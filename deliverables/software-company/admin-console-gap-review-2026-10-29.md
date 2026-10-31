# 管理后台功能缺失审查（2026-10-29）

> 审查对象：运营后台 `/admin`（`app/apps/web/pages/admin/*` + `layouts/admin.vue` + `useAdminMenu`）与其 API（`/ops/admin/*`、`/ops/market/*`、`/ops/agent-skills/*`）。
> 基线：PRD F8（`docs/01-product/PRD.md:155-167`）、api-spec §11（`docs/02-architecture/api-spec.md:657-675`）、WBS 2.3/2.4、compliance B3/C1、deployment §7.2。
> 方法：静态审查（文档 × 路由 × 控制器/服务 × 页面/菜单 × 测试），未启动运行态服务。证据均给到文件与行号。

## 0. 结论

后台**骨架与多数 API 已就绪**（独立鉴权、模型上下架、任务指标/CSV、漏斗、举报、分享、退款、创作者审核、运营位、首页配置都有实现与部分测试），但**运营可操作的后台界面与 PRD F8 验收存在差距**：

- **计价管理只有 API、没有后台界面**（4 个价目端点全有，`/admin` 无入口、无价目表、无改价/建价/下架按钮）。
- **任务看板不能筛选**（无状态/模型筛选控件；`/ops/admin/tasks` 本身也只支持 `status`，且 DTO 不含 `model`/`error`，失败原因在后台看不到）。
- **模型“参数枚举热更”不存在**（PATCH 仅 `visible/sort`；`GET /ops/admin/models` 也不返回 `modes`，与 api-spec 661 行不符）。
- **漏斗缺“耗时/退出率/完集”口径**，且数据是表统计而非 metrics §2 埋点事件（PRD F8 明确要求事件口径）。
- **大量管理 API 没有后台界面**：`/ops/market/*` 23 条、`/ops/agent-skills` 2 条、`/ops/admin/exports`。
- **运维基建缺口**：无管理端操作审计日志（代码注释却声称“审计走 admin 侧操作日志”）、无管理员账号/权限管理、无配置中心 `/ops/config/{key}`、无退款对账单导出。
- **一致性缺陷**：`ensureToolCatalog()` 每次进程启动会用代码内置价覆盖库内工具模型价格/上下架/排序，后台改价对工具模型“重启即回滚”。

因此既有的“F8 ✅ / #27 运营后台 100%”结论应修正为：**API 面基本完成，后台界面与运营闭环仍缺**。

## 1. F8 要求逐条对照

| PRD F8 要求 | 实现现状 | 判定 | 证据 |
|---|---|---|---|
| admin 独立鉴权，普通用户访问 /ops/admin 403 | 独立登录/JWT/AdminGuard；401/403 有测试 | ✅ | `admin-auth.service.ts:49-74`、`admin.guard.ts:10-23`、`test/admin.spec.ts:104-128` |
| 模型上下架 | API + 后台按钮 | ✅ | `admin.controller.ts:230-233`、`admin/index.vue:199-202,505-515` |
| 模型排序热更 | API 支持 `sort`，后台无排序控件 | ⚠️ 部分 | `admin.controller.ts:23-26`、`admin/index.vue:199-202` |
| 模型参数枚举热更 | 无任何 `modes/resolution_options/durations` 写入口；列表也不回传 `modes` | ❌ 缺失 | `admin.service.ts:270-293` vs `api-spec.md:661` |
| 计价热更（model_prices）即时生效 | API 有 GET/POST/PATCH/DELETE，且有“改价→报价生效”测试；**后台无界面** | ⚠️ 仅 API | `admin.controller.ts:235-259`、`test/canvas-derive.spec.ts:348-369` |
| 前端模型目录反映改价 | 报价读 `model_prices` 实库，无缓存 | ✅（报价侧） | `credits.service.ts:98-130` |
| 任务看板：失败率/队列深度/adapter 延迟 | 都有；失败率与延迟在任务页，队列在概览 | ✅ | `admin.service.ts:188-239`、`admin/index.vue:517-538,419-424` |
| 任务看板：任务状态分布 | API 返回 `tasks.by_status`，后台未渲染 | ⚠️ 数据有、界面缺 | `admin.service.ts:176-179` vs `admin/index.vue:411-424` |
| 任务看板：可按状态/模型筛选 | API 只有 `status`；后台零筛选控件；任务行无 model/error | ❌ 缺失 | `admin.controller.ts:261-264`、`admin.service.ts:459-484` |
| 漏斗：建项→大纲→角色→分镜→批量→完集 | 六段有，但末段是“镜头成功”不是“完集”；全表累计、无时间窗 | ⚠️ 口径偏差 | `admin.service.ts:590-626` |
| 漏斗：流失率/耗时/退出率 | 只有相邻转化率；无耗时、无退出率；无埋点事件源 | ❌ 缺失 | 同上；`deliverables/software-company/wanxing-status-and-gap-2026-10-26.md:135`（D2 埋点体系不存在） |
| 验收：调价 1 分钟内 quote 生效 | API 有测试；但后台无界面，且工具模型重启被覆盖（见 §4） | ⚠️ | `test/canvas-derive.spec.ts:348-369`、`tool-catalog.ts:1252-1281` |
| 验收：任务看板可筛选并导出失败清单 | CSV 有；筛选没有 | ⚠️ 半项 | `admin/index.vue:181-197`、`admin.controller.ts:261-264` |
| 验收：漏斗与埋点口径一致 | 表统计口径，与埋点不一致 | ❌ | `admin.service.ts:590-626` |

## 2. P0/P1 功能缺失（按优先级）

### P0-1 计价管理没有后台界面

- API 齐备：`GET/POST/PATCH/DELETE /ops/admin/model-prices`（`admin.controller.ts:235-259`），并有“新增档位合法性校验”（`admin.service.ts:361-445`）与“改价→报价生效”测试（`test/canvas-derive.spec.ts:348-369`）。
- 后台侧全仓 `apps/web` 无一次 `/ops/admin/model-prices` 调用；模型页签只有上下架按钮（`admin/index.vue:505-515`），`useAdminMenu` 无价格菜单（`useAdminMenu.ts:18-27`），i18n `adminUi` 无价格相关 key。
- 运营只能手工 curl 才能改价，与 PRD F8“计价热更”、api-spec“定价可写是硬要求（2026-10-26）”不匹配。
- 附带缺陷：`listPrices` DTO **不返回 `active`**（`admin.service.ts:309-321`），即使补界面也看不到“已下架”档位。

### P0-2 任务看板无法筛选、看不到失败原因

- PRD 160 行要求“可按状态/模型筛选”，验收 167 行要求“可筛选并导出失败任务清单”。
- API：`/ops/admin/tasks` 仅接 `status/page/page_size`（`admin.controller.ts:261-264`）；`listTasks` DTO 只有 `task_id/space_id/mode/status/credits_*`（`admin.service.ts:471-479`），无 `model`、无 `error`。
- 后台：无任何筛选控件，固定取默认第一页（`admin/index.vue:121-150`）；任务指标/CSV 也不带筛选参数（`admin.controller.ts:187-199`）。
- 结果：失败任务只能整表导 CSV 再离线筛，后台无法按模型/状态定位 adapter 与错误码。

### P0-3 模型“参数枚举热更”缺失

- PRD 159 行要求“排序/参数枚举热更”，api-spec 661 行要求 `GET /ops/admin/models` 含 `modes/capabilities`。
- 实现：`listModels` 不回传 `modes`（`admin.service.ts:270-283`）；`PATCH /ops/admin/models/:id` 仅 `visible/sort`（`admin.controller.ts:23-26`）。
- 结果：运营无法维护分辨率/时长档位；而 `POST /model-prices` 又要求 mode 必须已存在于目录（`admin.service.ts:380-411`），新增能力只能等发版/改 seed。

### P0-4 漏斗口径与 PRD 不一致

- 缺“耗时”“退出率”；末段“镜头成功”≠“完集”（`admin.service.ts:610-617`）。
- 全部为当前全表累计，无时间范围/筛选；与 metrics §2 埋点事件口径不一致（埋点体系整体缺失，D2）。
- 验收“各环节数据与埋点口径一致、可定位单环节流失率”不成立。

### P0-5 工具模型价格/上下架会被代码覆盖（热更不持久）

- `ensureToolCatalog()` 在每个 API 进程首次工具请求时执行：已存在模型也 `update(models).set(definition)`（`visible:false`、`sort:900+i`、`modes`，`tool-catalog.ts:1205-1224,1243-1244`），价目存在也强制 `update(modelPrices).set({credits, strikeCredits, active:true})`（`tool-catalog.ts:1247-1282`）。
- 影响：运营在后台对 16 个工具模型的上下架、排序、改价、下架价目，**重启后第一次工具请求即被回滚**；同时代码里写死金额常量（`tool-catalog.ts:188-450`）与 api-spec 1006 行“代码不出现金额常量”相冲突。

### P1-1 三块管理 API 完全没有后台界面

| API | 端点量 | 后台现状 | 证据 |
|---|---|---|---|
| `/ops/market/*` | 23（剧本广场审核/分类/标签/推广位/提现审批） | `apps/web` 零调用 | `market-admin.controller.ts:121-305` |
| `/ops/agent-skills/*` | 2（平台 Skill 首页推荐位） | 零调用 | `agent-skills-admin.controller.ts:51-69` |
| `/ops/admin/exports` | 1（导出任务审计） | 概览只显示总数，无列表页 | `admin.controller.ts:266-269`、`admin/index.vue:121-150` |

### P1-2 无管理端操作审计日志

- 后台页脚声称“所有操作留痕（管理员/时间/处置结论）”（`layouts/admin.vue:75-78`）。
- 实现只有业务表局部留痕：`content_reports.handled_by`、`creator_assets.reviewed_by_admin`、`orders.refund_operator`、`promo_slots.created_by`（`schema.ts:666,2667,3067`）。
- **改价、模型上下架/排序、首页板块保存、运营位编辑/删除均无操作人记录**；`saveHomeConfig` 注释还明确写“审计线索走 admin 侧的操作日志”（`admin.service.ts:802-805`），但仓库无 `admin_operation_logs` 表/服务。
- 与合规 C1“审核记录留存 ≥6 个月”的通用审计预期也有落差。

### P1-3 无管理员账号与权限管理

- `admin_users.role` 只写入 `"ops"`（`admin-auth.service.ts:43-47`），token 里带 `role` 但 **AdminGuard 从不校验角色/权限**（`admin.guard.ts:10-23`）。
- 无管理员 CRUD/停用/改密/角色分配；生产只能靠 `ADMIN_USERNAME/ADMIN_PASSWORD` 引导单账号（`env.ts:303-310`）。
- 无 token 撤销：管理员停用/改密后旧 JWT 仍有效至 TTL（默认 7200s，`env.ts:176`）。
- PRD 158 行“独立登录与权限”只完成了“登录”。

### P1-4 配置中心端点整体缺失

- api-spec §11 明确 `GET /ops/config/{key}`、`PUT /ops/admin/config/{key}`（`api-spec.md:658-659`）；WBS 2.4“配置中心/公告”也未落地。
- 代码中不存在该控制器（`ops/admin` 仅 admin.controller；`ops/config` 无路由）。
- 结果：定价页文案、公告、全站配置类内容无后台维护入口（运营位只覆盖 banner/pop_up/activity/creator）。

### P1-5 退款对账导出缺失

- deployment §7.2 要求“`GET /ops/admin/orders?status=4` 导出退款单，与渠道流水按 `refund_no/refund_amount_cents` 对账”（`deployment.md:179`）。
- 实现只有 JSON 列表 + 单笔退款（`admin.controller.ts:315-333`），无 CSV/导出端点，后台也无导出按钮，且订单列表固定 `page_size=50`、无状态筛选 UI（`admin/index.vue:140,658-691`）。

## 3. 运营闭环/可用性缺口（P2）

1. **全站无分页**：任务/分享/举报/订单/创作者审核都只取第一页（20 或 50 条），API 明明返回 `total/page`。创作者审核固定 `page_size=50`（`admin/index.vue:66`），待审积压超过 50 条就无法处理更早的（测试注释也说明历史数据可超 100，`test/admin-creator-audits.spec.ts` 相关说明见 `docs/07-plan/implement-progress-vs-reelmate.md:761`）。
2. **运营位只能建/启停/删，不能编辑**：PUT 支持 title/image/link/sort/窗口（`admin.controller.ts:303-306`），后台只实现了新建、启停、删除（`admin/index.vue:318-377`）。
3. **运营位/首页配置藏在“概览”页签**：`useAdminMenu` 无对应菜单项（`useAdminMenu.ts:18-27`），新运营找不到入口。
4. **举报/分享/订单无状态或关键字筛选**：举报全部混排（`admin/index.vue:578-598`），订单不传 `status`。
5. **单接口失败会把运营踢下线**：`onMounted` 用 `try { loadAll() } catch { 清 token → /admin/login }`（`admin/index.vue:379-393`），任一接口 500 都会清登录态。
6. **无用户管理/封禁/注销恢复**：PRD-supplement 把“账号注销恢复”列为运营后台唯一人工介入点之一（`PRD-supplement-works-and-onboarding.md:15`），但无对应端点/界面；`auth.guard.ts:54` 有“已注销/封禁”判定，却无管理入口。
7. **等待名单无后台**：只有公开提交 `POST /auth/waitlist`（`auth.controller.ts:238-243`）与 `waitlist_entries` 表（`schema.ts:232-238`），运营无法查看/导出/发放邀请；`invite_codes.created_by` 指向 admin_users，但无运营建码入口。
8. **管理端登录无限流/锁定**：全站无 RateLimitGuard（api-spec §13 有全站限流基线），admin 登录是暴力破解面。
9. **AI 标识审计导出未做**：compliance B3 待办明确“运营后台标识审计导出”（`compliance.md:35`）。

## 4. 其他一致性/健壮性风险

1. `GET /ops/admin/models` 不返回 `modes`，与 api-spec 661 行不符（同 P0-3）。
2. `GET /ops/admin/model-prices` 不返回 `active`，无法表达“已下架价目”（`admin.service.ts:309-321`）。
3. `reports/orders/tasks/shares/exports` 的 page/status 用 `Number()` 直接转，未走 zod；`?page=abc` 会得到 `NaN` 下传 SQL（`admin.controller.ts:206-213,261-269,315-318`）。
4. `resolveReport` 不校验报告当前状态，可对已处置报告重复处置（`admin.service.ts:672-705`）。
5. 后台“任务审计（最近 20）”文案已自认只显示最近 20 条（i18n `adminUi.auditTitle`），与 PRD 的“看板”定位不符。

## 5. 已确认“不是缺失”的能力（避免误伤）

- admin 独立登录/JWT/issuer 隔离、普通用户 token → 403101、无 token → 401101（有测试）。
- 模型上下架、失败率/错误码分布/adapter avg+p95、失败任务 CSV、基础六段漏斗、举报处置（下线自动撤销分享）、分享撤销、订单全额退款（幂等/渠道回滚/积分回冲）、创作者审核状态机、运营位 CRUD、首页板块配置（乐观锁/白名单）。
- 改价→报价即时生效（API 层有集成测试，报价读实库无缓存）。
- 测试覆盖：`admin.spec.ts`、`admin-promo.spec.ts`、`admin-home-config.spec.ts`、`admin-creator-audits.spec.ts`、`canvas-derive.spec.ts`（改价）；浏览器 E2E 仅 `e2e-admin-home-config.cjs`（9/9）与 `e2e-admin-creator-audit.cjs`（6/6）。

## 6. 建议修复顺序

**P0（上线前）**
1. 补“模型 / 价格”页签的价目表：按模型列出档位、`active`、金额，支持改价/新增档位/下架（复用现有 4 个端点与档位校验）。
2. 任务看板补筛选（status + model）与失败原因列：`listTasks` 增加 `model`/`error`/`adapter` 字段，controller 增加 `model_id` 参数与 zod 校验；CSV 导出接受同口径筛选。
3. 修 `ensureToolCatalog` 覆盖策略：只 insert-if-missing，或仅在显式 `CATALOG_SYNC=true` 时同步；金额常量移出代码（对齐 api-spec 1006）。

**P1（上线前/上线后首批）**
4. 模型排序/参数枚举维护（`models.modes` 读写）。
5. 漏斗补“耗时/退出率/完集”，并明确数据口径（若埋点未就绪，先按 `task_events`/`credit_flows` 定义并在文档标注“非埋点口径”）。
6. 管理端操作审计日志（表 + 中间件/服务写入：admin_id、action、target、before/after、ip、时间），替换页脚与注释里的空承诺。
7. 管理员账号与权限：角色（只读/运营/超管）+ 账号 CRUD/停用/改密 + token 撤销（`token_version`）。
8. `/ops/market/*` 与 `/ops/agent-skills` 后台界面（至少审核队列、分类标签、提现审批、Skill 推荐位）。
9. 退款对账 CSV 导出（`status=4`，含 refund_no/金额/时间/操作人）。

**P2**
10. 所有列表分页 + 状态/关键字筛选；运营位编辑；导出任务列表；配置中心 `/ops/config/{key}`；等待名单与邀请码发放；用户封禁/注销恢复；admin 登录限流。

## 7. 文档口径修正建议

- `deliverables/software-company/mvp-acceptance-audit-2026-10-24.md`（F8 全 ✅）与 `docs/07-plan/implement-progress-vs-reelmate.md:212`（#27 100%）应改为：“API 层完成；后台界面缺计价/筛选/排序/参数枚举/审计，F8 验收部分未达成”，否则与代码事实冲突。

## 8. 修复状态（2026-10-29 本批已落地）

> 施工边界与 API 契约见 [admin-console-completion-contract-2026-10-29.md](admin-console-completion-contract-2026-10-29.md)
> 与 [admin-console-p2-contract-2026-10-29.md](admin-console-p2-contract-2026-10-29.md)；
> 变更登记见 [docs/README.md](../../docs/README.md) v6.59 / v6.60。

| 原缺口 | 状态 | 落点 |
|---|---|---|
| P0-1 计价管理无后台界面 | ✅ 已补 | `components/admin/AdminPricePanel.vue`（列表/筛选/行内改价/建档/下架/删除/分页）；API 新增 `active` 筛选与 `active/model_name/updated_at` |
| P0-2 任务看板不能筛选、无失败原因 | ✅ 已补 | `/ops/admin/tasks` 加 `model_id/mode` 与 model/adapter/error 字段；`admin/index.vue` 加状态/模型筛选、分页、错误列、筛选后 CSV |
| P0-3 模型排序/参数枚举不可维护 | ✅ 已补 | `PATCH /ops/admin/models/:id` 支持 `modes`（zod 校验）+ 后台排序保存/档位 JSON 编辑；列表回 `modes/types` |
| P0-4 漏斗缺耗时/退出率/完集、口径不一致 | ✅ 已补（表口径） | 6 段项目维度 + `dropoff_from_previous/avg_hours_from_previous/avg_hours_from_project_created`；仍是业务表时间戳口径，D2 埋点差异未消除 |
| P0-5 工具模型被代码目录覆盖 | ✅ 已修 | `ensureToolCatalog` 不再覆盖 `visible/sort/credits/strike/active`；`CATALOG_SYNC_TOOLS` 开关；补 CI 用例 |
| P1-1 三块管理 API 无界面 | ✅ 已补 | 剧本广场（审核/分类/标签/推广/提现）、Skill 推荐位、导出审计三个面板 |
| P1-2 无操作审计日志 | ✅ 已补 | `admin_audit_logs` + 全局 `AdminAuditInterceptor`（脱敏/≤8KB/失败吞掉）+ 「操作日志」面板 |
| P1-3 无管理员账号/权限 | ✅ 已补 | `admin_users.status/token_version` + 角色 `super/ops/viewer` + 账号 CRUD + 旧 token 立即失效 + 「管理员」面板 |
| P1-4 配置中心缺失 | ✅ 已补 | `app_configs` + `GET /ops/config/:key`（公开）+ `GET/PUT/DELETE /ops/admin/config*` + 「配置中心」面板 |
| P1-5 退款对账导出缺失 | ✅ 已补 | `GET /ops/admin/orders.csv` + 订单页导出按钮 |
| P2 列表分页/筛选/运营位编辑 | ✅ 已补 | 任务/订单/举报/分享/创作者审核/导出审计分页；订单/举报状态筛选；运营位编辑 |
| P2 运营位/首页配置藏在概览 | ✅ 已补 | 新增「运营位」「首页板块」独立页签（原 dashboard 内嵌） |
| P2 admin 登录限流 | ✅ 已补 | 同（用户名+真实 IP）5 分钟 10 次失败 → 429101；Redis 计数、成功清零 |
| P2 等待名单/邀请码发放 | ✅ 已补 | `GET /ops/admin/waitlist`（invited 过滤/hash 前缀）+ `POST /:id/invite`；`GET/POST/PATCH /ops/admin/invite-codes`（批量 1..50、耗尽不可启用）+ 两个页签 |
| P2 用户封禁/注销恢复 | ✅ 已补 | `GET /ops/admin/users`（昵称/ID/手机号哈希、status/deleted、phone_masked）+ `PATCH users/:id` + `POST users/:id/restore` +「用户管理」页签 |
| AI 标识审计导出（compliance B3 待办） | ✅ 已补 | `GET /ops/admin/ai-labels` 与 `.csv`（数据源 `tasks.results[].meta.ai_label`，`only_missing` 抽验）+「AI 标识审计」页签 |
| 剧本广场面板缺看板/详情/重提 | ✅ 已补 | 看板 `dashboard/scripts`、状态筛选 `scripts/list?status`、详情 `scripts/:id`、`POST submit-review`；看板 chip 即筛选器 |
| 配置列表服务端分页 / 审计 CSV | ✅ 已补 | `GET /ops/admin/configs?page&page_size&module&q`；`GET /ops/admin/audit-logs.csv`（同过滤、≤5000 行） |

**验证边界**：本机无 PG/Redis，未跑 DB e2e；已通过 `@app/api` typecheck/lint/build、`@app/web` typecheck/build、`i18n-check`（5 语言一致），以及纯函数单测 36/36（漏斗 13 + 审计脱敏 9 + 邀请码/手机号/AI 标识解析 14）。DB 用例（admin/admin-ops/admin-community/admin-ai-label/tools）需在 CI/本地栈执行。

