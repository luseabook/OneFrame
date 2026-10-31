# 运营后台补齐 · P2 实施契约（2026-10-29 第二批）

> 前置：`admin-console-completion-contract-2026-10-29.md`（P0/P1）、
> `admin-console-gap-review-2026-10-29.md`（缺口清单）。本批只做审查报告里"仍未做"的 P2。
> 规则沿用上一份契约 §0：只改自己 ownership 内文件、不跑 DB e2e、中文注释写"为什么"、
> 新增文案写 `app/apps/web/i18n/pending-admin/<name>.json`（Lead 统一合并）、不改 `docs/**`。

## 1. 文件所有权

| 角色 | 可写文件 |
|---|---|
| Lead | `useAdminMenu.ts`、`pages/admin/index.vue`（占位区块）、`i18n/pending-admin/**`、`docs/**`、本文件、审查报告 |
| api-p2 | 新增 `app/apps/api/src/modules/admin/admin-community.controller.ts`、`admin-community.service.ts`、`admin-ai-label.service.ts`；修改 `admin-ops.controller.ts`、`admin-audit.service.ts`、`admin-config.service.ts`、`admin.module.ts`；新增 `app/apps/api/test/admin-community.spec.ts`、`admin-ai-label.spec.ts`、`admin-invite-code.unit.spec.ts` |
| web-p2 | `components/admin/AdminUsersPanel.vue`、`AdminWaitlistPanel.vue`、`AdminInviteCodesPanel.vue`、`AdminAiLabelPanel.vue`（整体替换占位）；修改 `AdminConfigPanel.vue`、`AdminAuditPanel.vue`；写 `i18n/pending-admin/p2.json` |
| web-market-p2 | 只改 `components/admin/AdminMarketPanel.vue`；写 `i18n/pending-admin/market-p2.json` |

> 本批**不需要迁移**：`users.status/deleted_at`、`waitlist_entries`、`invite_codes` 都已存在。

## 2. API 合同（api-p2）

所有端点前缀 `/v1/ops/admin`，`@Public()` + `@UseGuards(AdminGuard)`（沿用）。viewer 只读由 guard 兜住；
写操作角色 `ops|super`。分页参数统一 `page≥1`、`page_size≤100`，空串按"未传"处理（`emptyToUndefined`）。
时间参数 ISO（`Date.parse` 可解析），非法 → 400101。

### 2.1 用户管理

`GET /ops/admin/users?q=&status=&deleted=&page=&page_size=`

- `q`：
  - `/^1\d{10}$/` → `hashPhone(q)` 查 `identities.phone_hash`（provider=phone）拿到 user_ids，再按 id 过滤；
  - `/^\d+$/` → `users.id` 精确；
  - 其它 → `users.nickname ilike %q%`。
- `status`：1/2；`deleted`：0（未注销）/1（已注销），不传=全部。
- list 项：
  ```ts
  {
    id, nickname, avatar_uri, status, deleted_at, last_login_at, created_at,
    phone_masked: string | null,   // decryptPhone(phone_cipher) 后 138****1234；解密失败 null
    space_id: string | null        // spaces.owner_user_id = users.id（个人空间）
  }
  ```
- 按 `created_at desc`；`{list,total,page,page_size}`。
- 手机号只出**打码**，绝不出明文；`phone_cipher` 解密失败不能让整个列表 500（单条 null）。

`PATCH /ops/admin/users/:id` body `{status: 1|2}`

- 已注销（`deleted_at != null`）不能改状态 → 400101（提示先 restore）。
- 停用（2）/解封（1）；返回 2.1 的单行 DTO。
- 不需要手动 revoke token：`AuthGuard` 每请求校验 `users.status/deleted_at`，下一次请求即 401。

`POST /ops/admin/users/:id/restore` body `{nickname?: string}`

- 仅对 `deleted_at != null` 生效；未注销 → 400101。
- 置 `status=1, deleted_at=null, updated_at=now`；`nickname` 传了才覆盖。
- 说明：注销时昵称/头像已被匿名化（`已注销用户`/null），原值不可恢复；运营可传新昵称。
- 返回单行 DTO。

### 2.2 等待名单

`GET /ops/admin/waitlist?invited=0|1&page=&page_size=`

- `invited`：1=`invited_at is not null`，0=空，不传=全部。
- list 项：`{id, phone_hash_prefix, source, invited_at, created_at}`。
  `phone_hash_prefix` = `phone_hash.slice(0,10) + "…"`（等待名单只存 HMAC，平台没有明文手机号；
  不要伪造"手机号"字段）。
- 按 `created_at desc`；返回分页信封。

`POST /ops/admin/waitlist/:id/invite`

- 标记 `invited_at=now()`；已标记则幂等返回原时间。
- 返回 `{id, invited_at, idempotent}`；不存在 400102。

### 2.3 邀请码（运营发码）

`GET /ops/admin/invite-codes?status=&page=&page_size=`

- list 项：`{id, code, credits, max_uses, used_count, expires_at, status, created_by, created_at}`；
  `created_by` 是 admin_users.id 字符串（可能 null）。
- 按 `created_at desc`。

`POST /ops/admin/invite-codes` body：

```ts
{ credits?: int 0..100000 (默认 0),
  max_uses?: int 1..1000 (默认 1),
  expires_at?: ISO | null,
  count?: int 1..50 (默认 1) }
```

- 返回 `{codes: InviteCodeDto[]}`（批量生成）。
- 码格式：8 位，字母表 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（去掉 0/O/1/I 等易混字符），
  `crypto.randomInt` 生成；唯一冲突重试最多 5 次；`created_by=当前 admin id`。
- 把码生成抽成**纯函数**（如 `generateInviteCode()`）导出，供无 DB 单测。

`PATCH /ops/admin/invite-codes/:id` body `{status: 1|2}`

- 停用/启用；`used_count >= max_uses`（已耗尽）的码不能重新启用 → 400101。
- 返回单行 DTO。

### 2.4 AI 标识审计

数据源：`tasks.results`（JSONB 数组）里每条 result 的 `meta.ai_label`（worker `label.ts` 写入：
`{enabled, ai_generated, standard, explicit, implicit, explicit_reason?}`）。**不新建表**。

`GET /ops/admin/ai-labels?from=&to=&only_missing=0|1&page=&page_size=`

- 基集：`tasks.status=3`（成功）、`results is not null`、`finished_at` 在 `[from,to]`。
- 按 `finished_at desc` 取最多 5000 行，在 JS 里解析 `ai_label`（取第一条 result 的 meta.ai_label）；
  `only_missing=1` 只保留没有 `ai_label` 的行。
- list 项：
  ```ts
  {
    task_id, space_id, model_id, model_name, mode, status,
    has_ai_label: boolean,
    enabled: boolean | null,
    explicit: boolean | null,
    implicit: boolean | null,
    explicit_reason: string | null,
    result_count: number,
    finished_at: string | null,
    created_at: string
  }
  ```
- 内存分页后返回 `{list,total,page,page_size}`（total=过滤后的总数）。

`GET /ops/admin/ai-labels.csv?from=&to=&only_missing=`

- 同口径，≤5000 行，表头固定：
  `task_id,space_id,model,mode,status,has_ai_label,enabled,explicit,implicit,explicit_reason,result_count,finished_at`
- CSV 转义（逗号/引号/换行），`text/csv; charset=utf-8`。

### 2.5 配置列表分页（改现有）

`GET /ops/admin/configs?page=&page_size=&module=&q=` → `{list,total,page,page_size}`。

- `module` 精确；`q` 对 `key` ilike。
- `AdminConfigService.list(opts)` 改造；旧调用不传参数时保持"前 20 条"语义即可。
- 前端 `AdminConfigPanel` 同步改成服务端分页（web-p2）。

### 2.6 审计日志 CSV（改现有）

`GET /ops/admin/audit-logs.csv?admin_id=&action=&from=&to=`

- 与 `GET audit-logs` 同过滤（admin_id 精确、action ilike、时间范围），按时间倒序 ≤5000 行。
- 表头：`id,admin_id,admin_username,method,path,action,status_code,ok,ip,request_id,created_at,payload`
- `payload` 用 `JSON.stringify` 后按 CSV 规则转义；`text/csv; charset=utf-8`。
- 在 `AdminAuditService` 加 `exportCsv(filters)`（复用 list 的 where 构造，避免两份过滤口径）。

## 3. 前端合同

### 3.1 新面板（web-p2）

- `AdminUsersPanel.vue`
  - 筛选：`q`（昵称/用户 ID/手机号，回车搜索）、状态（全部/正常/封禁）、注销（全部/未注销/已注销）、page_size。
  - 表格：ID、昵称、手机号（打码）、状态、注销时间、最近登录、注册时间、空间 ID、操作。
  - 操作：封禁/解封（PATCH status）、注销恢复（`window.prompt` 可选新昵称 → POST restore）。
  - 分页、三态、busy；401101 回登录、403 就地提示。
- `AdminWaitlistPanel.vue`
  - 筛选：已邀请/未邀请；表格：hash 前缀、source、invited_at、created_at；操作「标记已邀请」；分页。
  - 顶部说明：等待名单只存 HMAC，平台看不到明文手机号（别做"发短信"按钮）。
- `AdminInviteCodesPanel.vue`
  - 创建表单：credits、max_uses、expires_at（datetime-local→ISO）、count（1..50）；创建后展示生成的码列表（可复制）。
  - 列表：code、credits、用量 `used/max`、状态（1 有效/2 停用/3 耗尽）、到期、创建人、时间；操作停用/启用。
  - 分页、三态、busy。
- `AdminAiLabelPanel.vue`
  - 筛选：from/to（datetime-local→ISO）、`only_missing` 开关；表格：task、model、mode、has_label、explicit、implicit、enabled、explicit_reason、result_count、finished_at。
  - 「导出 CSV」走 `downloadAdminCsv("/ops/admin/ai-labels.csv?...")`；分页；三态。
  - 顶部说明：数据源是 `tasks.results[].meta.ai_label`（worker 写入），不是第二套埋点表。

### 3.2 改现有面板（web-p2）

- `AdminConfigPanel.vue`：`GET /ops/admin/configs?page&page_size&q&module`；加分页与 key 搜索（module 过滤可选）；保持新建/编辑/删除与 JSON 校验。
- `AdminAuditPanel.vue`：加「导出 CSV」按钮，带当前 admin_id/action/from/to（`downloadAdminCsv`）。

### 3.3 剧本广场面板补齐（web-market-p2，只改 `AdminMarketPanel.vue`）

先读真实控制器/DTO，不要臆造：
- 顶部看板：`GET /ops/market/dashboard/scripts` → 展示 `works_by_status` 计数、`agreements/gross`、`pending_withdrawals`（按实际 DTO 字段）。
- 审核列表：从「只拉 pending」扩展为状态筛选（`GET /ops/market/scripts/list?status=&keyword=&page=&page_size`，status 1..6）；
  保留待审队列快捷入口。
- 详情：点击行 → `GET /ops/market/scripts/:id`，展示作者、计数、`review.auditable/rejected_can_resubmit/last_audit_note`、`review_logs`（时间/动作/操作人/备注）。
- 重新提审：`review.rejected_can_resubmit=true` 时显示按钮 → `POST /ops/market/scripts/:id/submit-review`，成功后刷新列表+详情。
- 审核动作沿用现有 `review-result` 实现（已对齐 `{result,audit_note,category_id}`）。

## 4. i18n pending 格式

同上一份契约 §5：`namespace → key → [中文, English]`，最多两层。
web-p2 写 `p2.json`（namespace：`adminUsers` / `adminWaitlist` / `adminInvites` / `adminAiLabel`，config/audit 的增量 key 可放 `adminConfig`/`adminAudit`）；
web-market-p2 写 `market-p2.json`（namespace：`adminMarket`，只写新增 key）。

## 5. 验证（本机无 DB，不要跑 e2e）

```powershell
cd E:\wanxing\app
pnpm --filter @app/db build          # 若 schema 未变可跳过
pnpm --filter @app/api typecheck
pnpm --filter @app/api lint
pnpm --filter @app/web typecheck
```

- 纯函数测试可跑：`pnpm --filter @app/api exec vitest run test/admin-invite-code.unit.spec.ts`
- 需要 DB 的 `admin-community.spec.ts` / `admin-ai-label.spec.ts` 只写、不跑（CI 验证）。
- 完成后向 Lead 汇报：文件、端点/字段、typecheck/lint 结果、未做项。
