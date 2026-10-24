# 支付渠道适配层 + 回调正确性 + 前端真实收银台

- 日期：2026-10-25
- 任务：`task-1`（真实支付渠道适配层 / 微信 APIv3 + 支付宝）
- 目标：把支付从「mock 闭环」推进到「换真实商户号/证书即可上线收款」
- 结论：渠道适配层、订单链路、回调协议、前端收银台全部落地；api 全量测试 130/130 通过，真实 HTTP 端到端（下单 → 加密回调 → 积分到账）已验证

---

## 1. 修掉的生产级缺陷（含复现证据）

### 缺陷 1：微信 APIv3 回调验签用了「重新序列化后的 body」

- **旧实现**：`billing.controller.ts` 里 `verifyWechatSignature({ body: JSON.stringify(body) })`。
- **协议要求**：签名串是 `timestamp\nnonce\n<原始请求体字节>\n`。微信在 body 里带缩进/空白的 JSON 很常见，`JSON.stringify(JSON.parse(raw))` 会丢掉这些字节，验签必然失败 → 回调 401 → 渠道持续重试 → **用户已付款但积分永远不到账**。
- **修复**：`NestFactory.create(..., { rawBody: true })`，Fastify content-type parser 把原始 `Buffer` 挂到 `req.rawBody`；notify 直接用 `rawBody.toString("utf8")` 验签（拿不到原始体时 401 默认拒绝，绝不降级）。
- **复现证据**：
  - 新 e2e 用 **带 2 空格缩进的 JSON** 发回调，并显式断言「旧做法（`JSON.stringify(JSON.parse(raw))`）验签结果必须是 false」；
  - 临时回滚 `main.ts` + `billing.controller.ts` 到修复前版本后跑新 e2e：**9 failed / 3 passed**，其中
    `expected '{"code":401101,"msg":"wechat signatur…' to be '{"code":"SUCCESS","message":"成功"}'`。

### 缺陷 2：支付宝异步通知的请求体解析

- 事实核查：本仓库用 Nest 11 + Fastify，Nest 默认已注册 `application/x-www-form-urlencoded` 解析器（`fast-querystring`），任务描述中「Fastify 默认不解析」在 Nest 11 下不成立。
- 但仍有真实风险：解析行为依赖框架默认配置（一旦 `bodyParser:false`、自定义 parser 或换适配器就会静默失效，回调全部验签失败）。
- **修复**：notify/alipay 不再依赖 `@Body()`，用 **`req.rawBody` + `node:querystring`** 自行解析（不新增依赖），并在解析为空时回退 `@Body()`。支付宝 RSA2 待签串为「按 key 升序、排除 sign、兼容 sign_type 的两种官方拼法」。
- **复现证据**：新 e2e 用真实 `application/x-www-form-urlencoded` 报文 + 本地 RSA2 签名，断言 200 + 纯文本 `success` + 积分到账；回滚修复前版本该用例失败（`expected 201 to be 200`，响应被信封包裹）。

### 缺陷 3：回调响应体/状态码不符合渠道协议（渠道无限重试）

- **旧实现**：notify 正常返回走全局 `EnvelopeInterceptor` → `{code:0,data:...}`；失败走 `AllExceptionsFilter` → **HTTP 200 + 信封** `{code:401101,...}`。微信只认 `{"code":"SUCCESS","message":"成功"}`（失败 `{"code":"FAIL","message":...}`），支付宝只认纯文本 `success`/`failure`；否则视为未收到，按策略重复推送。
- **修复**：
  - `@Post("billing/notify/wechat")` / `notify/alipay` 使用 `@Res()` 直写，绕过信封与全局异常过滤器；
  - 成功：微信 `HTTP 200` + 精确 `{"code":"SUCCESS","message":"成功"}`；支付宝 `HTTP 200` + `text/plain` `success`；
  - 失败：**真实 HTTP 状态**（未配置密钥/验签失败 401、解密/字段/金额不合法 400、订单不存在 404）+ 渠道失败体（微信 `{"code":"FAIL","message":...}`、支付宝 `failure`）；
  - 响应头补 `x-request-id`（`@Res` 直写路径不绕过排障链路，与全局日志中间件的 request_id 一致）。
- **复现证据**：在 dist 起的真实进程上（修复前）`POST /v1/billing/notify/wechat`（未配置公钥）返回 **HTTP 200 + `{"code":401101,...}`**；修复后真实 HTTP 验证：
  ```text
  HTTP/1.1 401 Unauthorized
  x-request-id: dbe2658c-...
  content-type: application/json; charset=utf-8
  {"code":"FAIL","message":"wechat platform public key not configured"}

  HTTP/1.1 401 Unauthorized
  content-type: text/plain; charset=utf-8
  failure
  ```

### 缺陷 4：`NODE_ENV=test` 下短信 IP 频控默认 20，连续复跑 e2e 必挂

- **根因**：e2e 每个 spec 都新建用户发验证码，共用代理 IP `127.0.0.1`；`sms:ip:*` 计数 TTL 1 小时且跨进程保留。默认阈值 20 → 第二次复跑大面积 `429100/401101`。
- **修复**：`env.ts` 增加 `smsIpHourlyLimitDefault(nodeEnv)`：`test` → `100000`，其它（含 production/development）保持 **20**；`.default()` 惰性求值，未显式设置才生效。
- **复现证据**：把 Redis 计数置为 25 后、不带 `SMS_IP_HOURLY_LIMIT` 跑全量 → **13 failed / 26 passed / 31 skipped**；修复后同样条件（计数仍 25+）→ **130 passed**。现在测试命令不再需要设置 `SMS_IP_HOURLY_LIMIT`。

---

## 2. 新增能力

### 2.1 渠道适配层 `apps/api/src/modules/billing/channels/`

| 文件 | 职责 |
|---|---|
| `types.ts` | 渠道无关的 `PaymentChannelAdapter` / `CreatePaymentInput` / `payParams` 契约、金额换算 |
| `errors.ts` | `ChannelError{code,retryable,httpStatus,vendorCode}` + `CHANNEL_NOT_CONFIGURED` 等 11 类错误码 |
| `http.ts` | 可注入 `fetch` + 指数退避重试（网络/超时/429/5xx 重试；4xx 不重试）、超时 Abort |
| `wechat-pay.adapter.ts` | APIv3 请求签名（`METHOD\nURL\nTIMESTAMP\nNONCE\nBODY\n` + `Authorization: WECHATPAY2-SHA256-RSA2048 ...`）、Native/H5/JSAPI 下单、JSAPI 前端 `paySign`、查单/关单/退款 |
| `alipay.adapter.ts` | RSA2 排序拼串签名、`precreate`/`page.pay`/`query`/`close`/`refund`、网关可配置（生产/沙箱）、响应节点原文验签 |
| `channel.service.ts` | 渠道工厂：从 env 解析凭据（PEM 内联或文件路径）→ 适配器；`NotConfigured` 默认拒绝；`available()` 供前端 |

- 未配置凭据时 `get()` 抛 `CHANNEL_NOT_CONFIGURED`，**绝不静默 mock**；`GET /billing/channels` 返回 `missing` 列表便于部署排障（不含密钥值）。
- 重试边界：默认 2 次重试；支付宝业务码 `20000/20001` 视为可重试（HTTP 200 但服务不可用）。
- 错误统一映射到业务错误码：`745900 VENDOR_ERROR` / `745901 VENDOR_TIMEOUT`（`details` 只带 `channel/channel_code/vendor_code/retryable`，不透出报文与凭据）。

### 2.2 订单链路

- `orders` 新增 `pay_params JSONB`（迁移 `0008_worried_lady_deathstrike.sql`，本地已执行）。
- `POST /billing/orders {sku, channel, mode?, openid?}`：
  - `PAYMENT_LIVE=false` → 非 mock 渠道拒绝（沿用 `400101`）；
  - `PAYMENT_LIVE=true` → 调渠道下单，落库 `pay_params` 并在 DTO 返回；
  - 渠道失败 → 订单置为已关闭（绝不进入可支付状态）+ 明确错误；
  - 60s 内同 sku + 同渠道未支付订单复用并回放 `pay_params`（缺参数时补下单）；不同渠道不再误复用 mock 订单。
- `POST /billing/orders/{id}/close`：本地关单后 best-effort 调渠道关单（渠道失败不影响用户关单）。
- 新增公开端点 `GET /billing/channels` → `{live, channels:[{channel,configured,modes,missing?,reason?}]}`。
- `PAYMENT_LIVE=true` 时 mock 端点（`mock-pay` / `notify/mock`）返回 **真实 HTTP 403 + `403101`**。

### 2.3 前端真实收银台 `apps/web/pages/pricing.vue`

- 启动读取 `/billing/channels`：`PAYMENT_LIVE=false` 时只有「模拟支付（联调）」；`true` 时按渠道配置展示微信/支付宝。
- 微信 Native：本地渲染二维码（`qrcode` → dataURL，`pnpm --filter @app/web add qrcode` + `@types/qrcode`）；移动端自动走 H5（`h5_url` 跳转）；支付宝 `page.pay` 新窗口收银台、`precreate` 扫码。
- 下单后 3s/次轮询订单状态（≤3min），支付成功自动刷新余额；关闭订单逻辑保持（并调用渠道关单）。
- web `pnpm --filter @app/web build` 通过。

### 2.4 配置与文档

- `env.ts` 新增：`WECHAT_APP_ID`、`WECHAT_MCH_SERIAL_NO`、`WECHAT_MCH_PRIVATE_KEY(_PATH)`、`WECHAT_API_V3_KEY`、`WECHAT_PLATFORM_PUBLIC_KEY(_PATH)`、`WECHAT_API_BASE`、`WECHAT_NOTIFY_URL`、`ALIPAY_APP_PRIVATE_KEY(_PATH)`、`ALIPAY_PUBLIC_KEY(_PATH)`、`ALIPAY_GATEWAY`、`ALIPAY_NOTIFY_URL`、`ALIPAY_SIGN_TYPE`。
- `apps/api/.env.example`：只放占位；`docs/02-architecture/api-spec.md §10`、`docs/02-architecture/database.md` 已同步。

---

## 3. 测试与验证

### 3.1 测试计数

| 范围 | 数量 |
|---|---|
| 基线（改动前） | 70 tests / 8 files |
| 本任务新增 | **48 tests / 5 files** |
| 其中：`test/channels-wechat.spec.ts` | 15 |
| 其中：`test/channels-alipay.spec.ts` | 13 |
| 其中：`test/channels-factory.spec.ts` | 6 |
| 其中：`test/billing-notify.spec.ts` | 12 |
| 其中：`test/env.spec.ts` | 2 |
| 全量（含并行任务的 observability 12） | **130 tests / 14 files 全绿** |

新增测试覆盖：

- **渠道契约（假 fetch）**：出站签名串可被本地生成公钥验证（微信 Authorization 五字段 / 支付宝 RSA2 排序串）、Native/H5/JSAPI/precreate/page.pay 请求字段、查单/关单/退款字段、4xx 不重试、5xx/429/网络重试后失败、超时、非 JSON 响应、缺 `code_url`/`qr_code`、401 → AUTH_ERROR、支付宝响应节点验签成功/被篡改。
- **回调 e2e（本地假网关 + 真实签名，动态导入 AppModule 前注入测试密钥）**：微信加密回调（带缩进的原始体）→ HTTP 200 精确 `SUCCESS` JSON + `x-request-id` + 积分到账；重复回调只入账一次；篡改签名 → 401 `FAIL` 不入账；金额不符 → 400；支付宝 urlencoded 正确签名 → 200 纯文本 `success` + 到账；重复通知幂等；篡改金额/缺签名 → 401 `failure`；`PAYMENT_LIVE=true` 时 mock 端点 403；渠道下单签名可被假网关侧验证；订单复用不重复打渠道；关单同步渠道。
- **工厂/配置**：凭据缺失逐项 `missing`、NotConfigured 默认拒绝、PEM 内联（`\n` 转义）与文件路径、不可读路径报错、渠道清单（live/联调两种形态）。
- **复跑性**：SMS IP 频控默认值（test 放宽、生产保持 20）。

### 3.2 命令（全部通过）

```powershell
$env:DATABASE_URL='postgres://app@127.0.0.1:55432/app'; $env:REDIS_URL='redis://127.0.0.1:6380'; $env:NODE_ENV='test'
cd E:\wanxing\app
pnpm --filter @app/api typecheck     # ✓
pnpm --filter @app/api lint          # ✓
pnpm --filter @app/api build         # ✓
pnpm --filter @app/api test          # ✓ 130 passed (14 files)，无需 SMS_IP_HOURLY_LIMIT
pnpm --filter @app/web build         # ✓
```

### 3.3 真实 HTTP 端到端验证（dist + 假微信网关，非 inject）

用 `node dist/main.js` 起真实进程，假微信网关（本地 HTTP server）返回 `code_url`，然后带缩进的加密回调：

```text
ORDER  {"order_id":"107577529682165760","amount_cents":5000,
        "pay_params":{"mode":"native","channel":"wechat","code_url":"weixin://wxpay/bizpayurl?pr=realhttp",...}}
OUTBOUND_SIGNATURE_VERIFIED true          # 假网关用商户公钥验证了 Authorization 签名串
NOTIFY 200 "{\"code\":\"SUCCESS\",\"message\":\"成功\"}" x-request-id=4e9b44a8-...
BALANCE 580                                # 新人 80 + 充值 500
ORDER_STATUS 2
```

---

## 4. 切换到真实商户号需要配置的 env（精确清单）

前置：已备案域名 + HTTPS（渠道回调必须公网可达）、微信商户平台/支付宝开放平台已签约产品（Native/H5/JSAPI 或 电脑网站支付/当面付）。

```bash
# 总开关（生产必须为 true；否则只允许 mock）
PAYMENT_LIVE=true
ORDER_TTL_S=900

# ── 微信支付 APIv3 ──
WECHAT_APP_ID=<公众号/小程序 AppID，JSAPI/H5 必需>
WECHAT_MCH_ID=<商户号>
WECHAT_MCH_SERIAL_NO=<商户 API 证书序列号>
# 二选一：内联 PEM（支持 \n 转义）或挂载文件路径（生产推荐 path）
WECHAT_MCH_PRIVATE_KEY_PATH=/run/secrets/wechat_mch_private_key.pem
# WECHAT_MCH_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
WECHAT_API_V3_KEY=<APIv3 密钥，32 字符>
# 平台证书公钥（回调验签，二选一）
WECHAT_PLATFORM_PUBLIC_KEY_PATH=/run/secrets/wechat_platform_public_key.pem
# WECHAT_PLATFORM_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
WECHAT_NOTIFY_URL=https://<域名>/v1/billing/notify/wechat
# 可选：默认 https://api.mch.weixin.qq.com
# WECHAT_API_BASE=https://api.mch.weixin.qq.com

# ── 支付宝（RSA2）──
ALIPAY_APP_ID=<应用 AppID>
ALIPAY_APP_PRIVATE_KEY_PATH=/run/secrets/alipay_app_private_key.pem   # 应用私钥（请求签名）
ALIPAY_PUBLIC_KEY_PATH=/run/secrets/alipay_public_key.pem             # 支付宝公钥（回调/响应验签）
ALIPAY_NOTIFY_URL=https://<域名>/v1/billing/notify/alipay
# 默认生产网关；沙箱必须显式覆盖（沙箱网关不接受生产密钥）
# ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
# ALIPAY_SIGN_TYPE=RSA2
```

上线步骤：

1. 把上述 env 注入 api 服务（服务器 env / CI Secrets / 容器 secret 挂载），**不要提交到仓库**；
2. 在微信商户平台、支付宝开放平台把 `*_NOTIFY_URL` 报备为可公网访问的 HTTPS 地址（路径必须与上表一致）；
3. `GET /v1/billing/channels` 应返回 `live:true` 且 `wechat/alipay.configured=true`（若为 false，`missing` 会明确指出缺哪个变量）；
4. 分别用 1 分钱/最小额真单走「下单 → 收银台支付 → 回调入账 → 余额到账」，检查 `orders.status=2`、`orders.channel_order_id`、`credit_flows`；
5. 关闭 `PAYMENT_LIVE` 以外的 mock 入口（`PAYMENT_LIVE=true` 已自动 403）；监控回调 401/400 比例与 `VENDOR_ERROR` 计数。

---

## 5. 未完成 / 风险

1. **退款公开端点未做**：适配器已实现 `refund()`（微信 `/v3/refund/domestic/refunds`、支付宝 `alipay.trade.refund`，均带幂等单号），但退款审批 SOP、部分退款校验、对账未接入（`POST /billing/refund` 仍为 Ph3）。
2. **平台证书轮换**：仅配置单张微信平台公钥，未按 `Wechatpay-Serial` 做多证书选择/自动下载（生产长期运行需补；过期会导致回调 401）。
3. **支付宝验签 `sign_type` 兼容**：同时接受「排除 sign+sign_type」与「仅排除 sign」两种官方拼法（任一通过即成功）；真实联调时建议抓一条生产通知确认实际规则并收敛。
4. **响应验签为可选**：未配置支付宝公钥时跳过响应验签（但通道凭据一致性检查会要求配置公钥才算 configured，因此生产路径实际会验签）。
5. **前端未做 JSAPI 调起**：适配器已返回 `prepay_id + pay_sign`，但 Web 端没有公众号/小程序容器，UI 走 Native/H5；JSAPI 待小程序场景接入。
6. 真实渠道联调需要商户资质与真实金额，本轮用本地生成的 RSA 密钥 + 假网关完成协议级验证；上线前必须按 §4 走 1 分钱真单验收。

---

## 6. 改动文件

新增：

```
app/apps/api/src/modules/billing/channels/{types,errors,http,wechat-pay.adapter,alipay.adapter,channel.service,index}.ts
app/apps/api/drizzle/0008_worried_lady_deathstrike.sql (+ meta/0008_snapshot.json, _journal.json)
app/apps/api/test/{channels-wechat,channels-alipay,channels-factory,billing-notify,env}.spec.ts
app/apps/api/test/channels-test-utils.ts
```

修改：

```
app/apps/api/src/config/env.ts                     # 支付 env + SMS 测试默认放宽
app/apps/api/src/main.ts                           # rawBody: true
app/apps/api/src/modules/billing/billing.controller.ts  # 渠道端点/回调协议/订单入参
app/apps/api/src/modules/billing/billing.service.ts     # 渠道下单/复用/关单/错误映射
app/apps/api/src/modules/billing/billing.module.ts      # ChannelService provider
app/apps/api/src/modules/billing/payment-signature.ts   # 支付宝 sign_type 双拼法兼容
app/apps/api/.env.example
app/packages/db/src/schema.ts                      # orders.pay_params
app/apps/web/pages/pricing.vue                     # 真实收银台
app/apps/web/package.json + app/pnpm-lock.yaml     # qrcode / @types/qrcode
docs/02-architecture/api-spec.md (§10) / database.md
```
