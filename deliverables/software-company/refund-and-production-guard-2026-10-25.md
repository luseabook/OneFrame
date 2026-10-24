# 退款业务闭环 + 微信平台证书轮换 + 生产启动配置守卫

- 日期：2026-10-25
- 任务：`task-4`（task-1 渠道适配层的收口项）
- 目标：补齐 B 型「能真实收钱跑业务」剩下的代码项（除外部资质/密钥外）
- 结论：三项全部落地并通过全量验证；工作区 **299 passed / 1 skipped**（task-1 验收基线 256 → 新增 43），
  `typecheck / lint / build`（api、worker、web）全绿；生产守卫在真实 dist 进程上做了正/反例 smoke。

---

## 1. 退款业务闭环（核心）

### 1.1 数据模型（迁移 `0009_funny_rage.sql`，已本地执行）

`orders` 新增：

| 列 | 说明 |
|---|---|
| `refund_no TEXT` | 我方幂等退款单号，固定 `rf-{order_id}`（渠道侧同号去重） |
| `refund_status TEXT` | `processing`（渠道异步处理中）/ `succeeded` |
| `refund_amount_cents INT` | 本期仅全额，恒等于 `amount_cents`（显式列便于对账） |
| `refunded_at TIMESTAMPTZ` | 退款发起时间 |
| `refund_reason TEXT` / `refund_operator TEXT` | 工单/审批说明与操作人（审计留痕） |

账本：`credit_flows.kind` 新增 `refund`，`delta = -credits`（负向流水），`ref_order_id` 指回订单。
`packages/db/src/ledger.ts` 新增 `creditOut()`（先锁账户、校验 `balance >= amount`，否则
`InsufficientBalanceError`，绝不产生负余额，保持 `balance == Σdelta`）与 `lockCreditAccount()`。
> `credit_flows` 没有 `ref_order_id` 唯一索引（同一订单会有 recharge + refund 两条流水），
> 退款幂等由「订单状态机 + 事务行锁 + 固定 refund_no」保证，见 §1.2。

### 1.2 `BillingService.refundOrder`（`apps/api/src/modules/billing/billing.service.ts`）

调用链：`POST /ops/admin/orders/:id/refund` → `BillingService.refundOrder`：

1. **事务 + `SELECT ... FOR UPDATE`** 锁订单：并发退款串行化；`status=4` 直接幂等返回 `{idempotent:true}`（不重复扣积分、不重复调渠道）；
2. `status≠2` → `400101 order not refundable`（未支付/已关闭不可退）；
3. **仅全额**：body 传 `amount_cents` 且不等于订单金额 → `400101 partial refund is not supported`；
4. **先锁积分账户并校验余额**（`balance >= credits`）：不足 → `400101`，message 内含
   `balance=…, credits=…`（信封响应不携带 details，运营必须一眼看到差额），**在调渠道之前拒绝**；
5. **渠道退款在事务内调用**（幂等单号 `rf-{orderId}`）：失败抛错 → 整事务回滚 → 订单保持已支付、积分不冲正，
   对外返回 `745900 VENDOR_ERROR` / `745901 VENDOR_TIMEOUT`，运营可按原单重试（渠道幂等去重）；
6. **成功后**：`creditOut(kind=refund)` + 订单 `status=4` 与退款字段落库；
   渠道返回 `PROCESSING` 时 `refund_status=processing`（订单仍转 4，等对账/渠道结果）。

`mock` 渠道：不走网络，直接本地退款成功（联调/测试路径）。
DTO（订单详情/历史/管理端列表）统一返回 `refund_no/refund_status/refund_amount_cents/refunded_at/refund_reason`。

### 1.3 管理端与运营 UI

- `GET /ops/admin/orders?status=&page=&page_size=`：运营查单（含退款留痕字段、操作人）。
- `POST /ops/admin/orders/:id/refund {reason?, amount_cents?}`（AdminGuard：无凭证 401101，普通用户 token 403101）。
- `apps/web/pages/admin.vue` 新增「订单/退款」tab：列表 + 全额退款按钮（强制填写工单号，展示 `refund_no/refund_status`），web build 通过。

### 1.4 退款 SOP（已写入 `docs/05-ops/deployment.md §7.2`，D9 判据同步）

受理（工单/订单号/材料）→ 审批（金额+事由+审批人）→ 管理端执行（`reason`=工单号）→ 对账
（`status=4` 列表 vs 渠道退款流水；`credit_flows` 恰好一条 `kind=refund`；`balance == Σdelta`）→
余额不足（积分已消耗）时**不得**直接退款，按未消耗余额人工处理（E3 未成年人误充口径，本期不支持部分退款 API）。

### 1.5 测试证据

`test/refunds.spec.ts`（8 tests，mock 渠道）：

- 成功退款：`status=4`、`refund_no=rf-{id}`、`refund_status=succeeded`、余额回到充值前、流水一条 `kind=refund delta=-credits` 且 **Σdelta == balance**；
- 重复退款：`idempotent=true`，余额不再变化，refund 流水仍只有 1 条；
- 未支付订单拒绝（400101）；部分退款拒绝（400101）；普通用户 403101；无 admin token 401101；
- 余额不足（模拟积分已消耗）：400101 且 message 含 `balance=/credits=`，订单保持已支付、无 refund 流水；
- 管理端订单列表返回退款留痕字段（含 operator）。

`test/refunds-wechat.spec.ts`（4 tests，PAYMENT_LIVE=true + 本地假微信网关）：

- 渠道退款成功：假网关收到 `POST /v3/refund/domestic/refunds`，`out_refund_no=rf-{id}`、
  `amount={refund,total}`，Authorization 签名可被商户公钥验证；本地 `refund_status=succeeded`、`channel_refund_id` 返回；
- 重复退款：渠道只被调用一次；
- **渠道退款失败（假网关 500）**：返回 `745900`，事务回滚 → 订单仍 `status=2`、`refund_no=null`、无 refund 流水；
  渠道恢复后原单重试成功（幂等单号不变）；
- 未支付 wechat 订单退款拒绝，且不触发渠道请求。

---

## 2. 微信平台证书轮换

- 新增 env：`WECHAT_PLATFORM_PUBLIC_KEYS`（JSON `{serial_no: PEM}`）或 `WECHAT_PLATFORM_PUBLIC_KEYS_PATH`（JSON 文件）。
- 回调验签按请求头 **`Wechatpay-Serial`** 精确选择公钥：
  - 命中 → 用对应 PEM 验签；
  - **未知 serial → HTTP 401 `{"code":"FAIL","message":"unknown wechat platform certificate serial"}`（默认拒绝）**；
  - 未带 serial → 回退 `WECHAT_PLATFORM_PUBLIC_KEY`（仅单证书部署；map 只有一张证书时直接使用）；
  - 轮换期新旧证书可同时在线；仅配置单公钥（历史部署）时忽略 serial、行为兼容。
- 平台公钥来源（`*_KEY` / `*_KEY_PATH` / `*_KEYS` / `*_KEYS_PATH`）任一即可满足渠道"已配置"判定；
  生产守卫也认可 `WECHAT_PLATFORM_PUBLIC_KEYS`。
- 轮换操作步骤写入 `docs/05-ops/deployment.md §7.3`（保留旧证书 → 滚动重启 → 观察 24h 401 比例 → 摘旧证书）。

测试证据：

- `test/channels-factory.spec.ts` 新增 7 个纯函数契约（解析映射、按 serial 精确取、未知 serial 拒绝、无 serial 回退、
  单证书映射直接使用、单公钥历史兼容、`WECHAT_PLATFORM_PUBLIC_KEYS` 作为完整凭据来源）；
- `test/billing-notify-cert-rotation.spec.ts`（6 tests，e2e）：NEW serial 正确签名 → 200 + 精确 SUCCESS + 积分到账；
  OLD serial（轮换期旧证书）→ 200；未知 serial → 401 FAIL 不入账；无 serial + 回退公钥 → 200；
  无 serial + 非回退密钥 → 401；有效 serial + 篡改签名 → 401。

---

## 3. 生产启动配置守卫（fail fast）

### 3.1 api（`apps/api/src/config/env.ts`）

重构为可单测纯函数 `buildEnv(raw)` + `collectProductionProblems(raw)`（`env` 在 import 时执行；非 production 行为不变）：

`NODE_ENV=production` 时必须满足，否则**聚合列出全部问题**后拒绝启动（错误信息只含变量名/原因，不含任何值）：

- `JWT_SECRET` / `PHONE_HMAC_PEPPER` / `PHONE_ENC_KEY`：显式配置且 != 仓库默认值；
- `ADMIN_USERNAME` / `ADMIN_PASSWORD`：显式配置，密码不能是开发默认 `admin12345`；
- `COOKIE_SECURE`：必须显式设置（HTTPS=true / 内网 HTTP=false）；
- `PAYMENT_LIVE=true` 时：**至少一个渠道凭据齐全**；任何"已配置但缺项"的渠道会列出缺失变量名
  （如微信缺 `WECHAT_APP_ID`、支付宝缺 `ALIPAY_APP_PRIVATE_KEY`）并拒绝启动——避免"以为配好了，线上回调验不过"。

真实 dist 进程 smoke（已执行）：

```text
# 带默认弱密钥/缺管理员/Cookie 未显式
Error: 生产环境配置校验失败（6 项，拒绝启动）：
 - JWT_SECRET 仍是仓库默认值，生产必须替换
 - PHONE_HMAC_PEPPER 仍是仓库默认值，生产必须替换
 - PHONE_ENC_KEY 仍是仓库默认值，生产必须替换
 - ADMIN_USERNAME 必须显式配置（生产不允许默认管理员）
 - ADMIN_PASSWORD 必须显式配置（生产不允许默认管理员）
 - COOKIE_SECURE 必须显式设置（HTTPS 部署为 true；内网 HTTP 需显式 false）

# 完整配置（PAYMENT_LIVE=false）
READY status=200 {"code":0,...,"status":"ok","checks":{"db":"up","redis":"up"}}
[api] listening on :3113 (production)

# PAYMENT_LIVE=true + 半配微信
Error: 生产环境配置校验失败（1 项，拒绝启动）：
 - PAYMENT_LIVE=true 但没有任何支付渠道凭据齐全：至少完整配置微信（缺少 WECHAT_MCH_SERIAL_NO, WECHAT_API_V3_KEY,
   WECHAT_NOTIFY_URL, WECHAT_PLATFORM_PUBLIC_KEY）或支付宝（缺少 ...）
```

### 3.2 worker（`apps/worker/src/env-guard.ts` + `main.ts` 启动即调用）

`NODE_ENV=production` 时：

- `ADAPTER_MODE` 必须为 `real`（`mock`/未设置 → 拒绝启动，防止生产假生成）；
- 至少一种真实供应商：`ARK_API_KEY` / `DEEPSEEK_API_KEY` / `HTTP_VIDEO_BASE_URL`（空白视为未配置）；
- 错误聚合且不含密钥值。真实 dist smoke：`ADAPTER_MODE=mock` → 拒绝；`real` 但无供应商 → 拒绝。

### 3.3 单测

- `test/env-production-guard.spec.ts`（12 tests）：test/dev 不受影响、prod 缺失/默认值/聚合报错且不泄露值、
  完整配置通过、PAYMENT_LIVE 无渠道/半配/完整/`*_KEYS` 场景、生产外不强制支付凭据；
- `apps/worker/src/env-guard.spec.ts`（6 tests）：dev/test 不受影响、mock 拒绝、无供应商拒绝、任一供应商通过、空白值处理、错误不泄露值。

---

## 4. 测试与构建结果

| 包 | 测试 | 说明 |
|---|---|---|
| api | **167 passed / 18 files** | 本任务 +37（env guard 12 / refunds 8 / refunds-wechat 4 / cert rotation 6 / 渠道工厂 +7） |
| worker | **15 passed / 4 files** | 本任务 +6（env-guard） |
| model-adapters | 87 passed / 7 files | 未改动 |
| shared | 13 passed / 2 files | 未改动 |
| db | 11 passed / 1 file | 未改动（`creditOut` 由 api e2e 覆盖） |
| storage | 6 passed + 1 skipped / 3 files | 未改动 |
| **合计** | **299 passed / 1 skipped（11 turbo tasks 全绿）** | 验收基线 256 → +43 |

命令（全部通过）：

```powershell
$env:DATABASE_URL='postgres://app@127.0.0.1:55432/app'; $env:REDIS_URL='redis://127.0.0.1:6380'; $env:NODE_ENV='test'
cd E:\wanxing\app
pnpm test        # 11 tasks successful（299 passed / 1 skipped）
pnpm typecheck   # 10 tasks successful
pnpm lint        # 6 tasks successful
pnpm build       # 7 tasks successful（api / worker / web 等）
```

迁移：`pnpm --filter @app/api db:generate`（`0009_funny_rage.sql`）→ `db:migrate` 已在 127.0.0.1:55432 执行。

---

## 5. 未完成 / 风险

1. **部分退款未实现**：仅全额退款；E3 未成年人误充按"未消耗余额"人工处理（工单留痕），
   接口在积分已消耗时明确 400101 并给出 balance/credits，避免负余额破坏 ledger 不变式；
2. **渠道异步退款结果回收**：`refund_status=processing` 目前需运营在渠道后台确认/对账后人工核对，
   尚未接入渠道退款结果回调或定时查询任务（建议下一步：worker 定时按 `rf-*` 查退款/对账）；
3. **微信平台证书仍未自动下载**：本轮支持多证书按 serial 选择 + 手工轮换；自动下载/更新任务待后续（需 mTLS 拉取证书接口）；
4. **支付宝响应/退款对账**：未做对账单下载与自动对账，仍按管理端列表 + 渠道后台人工对账；
5. 生产守卫会拒绝**带仓库默认密钥**的启动：本地/演示环境如以 `NODE_ENV=production` 起服务需先补齐 Secrets
   （这是预期行为；`.env.production.example` 由 Lead 维护，未改动）。

---

## 6. 改动文件

新增：

```
app/apps/api/drizzle/0009_funny_rage.sql (+ meta/0009_snapshot.json, _journal.json)
app/apps/api/test/refunds.spec.ts
app/apps/api/test/refunds-wechat.spec.ts
app/apps/api/test/billing-notify-cert-rotation.spec.ts
app/apps/api/test/env-production-guard.spec.ts
app/apps/worker/src/env-guard.ts
app/apps/worker/src/env-guard.spec.ts
deliverables/software-company/refund-and-production-guard-2026-10-25.md
```

修改：

```
app/packages/db/src/schema.ts                         # orders 退款列 + credit_flows kind 注释
app/packages/db/src/ledger.ts                         # creditOut / lockCreditAccount
app/apps/api/src/modules/billing/billing.service.ts   # refundOrder + DTO + 退款状态映射
app/apps/api/src/modules/billing/billing.controller.ts# 平台证书按 serial 选择
app/apps/api/src/modules/billing/channels/channel.service.ts  # keyring 解析/选择 + 配置判定
app/apps/api/src/modules/admin/{admin.controller,admin.service,admin.module}.ts # 退款端点/订单列表
app/apps/api/src/config/env.ts                        # buildEnv + 生产守卫 + *_KEYS env
app/apps/api/src/main.ts                              # （task-1 已有 rawBody；未改）
app/apps/worker/src/main.ts                           # 启动即 assertWorkerEnv
app/apps/web/pages/admin.vue                          # 订单/退款 tab + 全额退款入口
app/apps/api/.env.example                             # 证书轮换 + 生产守卫占位说明
app/apps/api/test/channels-factory.spec.ts            # 证书轮换纯函数契约
app/apps/api/test/channels-test-utils.ts              # 微信加密回调/请求头构造 helper
docs/02-architecture/api-spec.md                      # §10.5 退款 / §10.6 守卫 / §10.7 未实现 / 轮换
docs/02-architecture/database.md                      # orders 退款列 + refund 流水口径
docs/05-ops/deployment.md                             # §7.2 退款 SOP / §7.3 证书轮换 / §7.4 启动守卫
```

> 未改动（按约束）：`app/.env.production.example`、`_acceptance/**`、`docs/05-ops/observability.md`、
> `docs/06-security-compliance/launch-checklist.md`（E3 对应关系由 Lead 同步）。
> `apps/worker/src/env-guard.ts` 为 writeScope（`main.ts`）外新增的必要纯函数文件（便于单测），已在汇报中标注。
