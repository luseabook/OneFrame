# 商业化就绪（B 型「能真实收钱跑业务」）代码侧验收报告

- 日期：2026-10-25
- 范围：在已验收的支付 mock 闭环基础上，补齐**真实渠道对接、真实供应商协议层、退款闭环、生产守卫、合规上线清单、可运维性**，并交付可复跑验收。
- 结论：**除外部资质与密钥外的代码项已完成**；全仓 299 passed / 1 skipped，`_acceptance/b-type-acceptance.ps1` 25/25 通过，合规代码侧 66/66（服务运行时）通过。
- 不外推：真实 Key/商户号未到位，未做真实扣款；20 项外部资质/密钥仍待人工办理（见 §6，脚本不伪装完成）。

---

## 1. 本轮交付总览（5 个任务，3 个并行工作流 + 2 个收口）

| # | 交付 | 关键结果 | 详细证据 |
|---|---|---|---|
| 1 | 真实支付渠道适配层 + 回调正确性 + 前端收银台 | 微信 APIv3 Native/H5/JSAPI（含前端 paySign）、查单/关单/退款；支付宝 precreate/page.pay/query/close/refund；回调原始体验签、渠道 ack、金额防篡改；`/billing/channels`；pricing 页真实收银台 | `payment-channel-adapter-2026-10-25.md` |
| 2 | 供应商协议层（Ark/DeepSeek 错误映射 + 契约测试） | 新增 Ark 图像（Seedream 文生图/图生图）；统一 `VendorError` 映射（auth/quota/invalid_param/rate_limited/output_rejected/timeout/network）；修掉「审核驳回被当 running」「图像 code 走视频接口」等真实缺陷；adapters 测试 21 → 87 | `vendor-ark-image-2026-10-25.md` |
| 3 | 合规清单可执行化 + request_id 可观测性 | `launch-checklist.md`（外部 20 项 / 代码侧 66 项）；`compliance-check.cjs` 可复跑；request_id 单行 JSON 日志 + `x-request-id` + 慢请求/5xx 告警 + 敏感字段脱敏 | `compliance-launch-and-observability-2026-10-25.md` |
| 4 | 退款闭环 + 微信平台证书轮换 + 生产启动守卫 | 管理端全额退款（幂等/余额保护/渠道失败回滚/负向流水）；`Wechatpay-Serial` 多证书选择；api/worker 生产 fail-fast 守卫 | `refund-and-production-guard-2026-10-25.md` |
| 5 | 清单与检查脚本对齐（收口） | 清单加 19 条（退款/证书轮换/守卫/验收）、关闭 GAP-01；修复 PAY-01 漂移；两种模式复跑 | 本报告 §5 + 清单 v1.1 |

### 1.1 修掉的真实生产缺陷（先复现后修）

| 缺陷 | 后果 | 修复 |
|---|---|---|
| 微信回调验签使用 `JSON.stringify(解析后 body)` | 带缩进/空白的真实回调必然验签失败 → 渠道重试、**用户付钱不到账** | `rawBody: true` + 原始字节验签；拿不到原始体 401 默认拒绝 |
| 支付宝 urlencoded 通知依赖框架默认解析 | 一旦解析器配置变化即静默失败、回调全 401 | `req.rawBody + node:querystring` 自解析，`@Body()` 兜底 |
| 回调响应被统一信封包裹 | 微信/支付宝只认 `{"code":"SUCCESS","message":"成功"}` / 纯文本 `success`，否则**无限重试** | notify 全 `@Res()` 直写；成功 ack、失败真实 401/400/404 + 渠道失败体 |
| Ark 审核驳回状态归一化为 running | worker 无限轮询、积分永久冻结 | 审核拒绝优先识别 → `review_rejected` → 745802 |
| registry 把 `volcengine:image` 当视频 | 图像任务发到视频接口，必失败且耗额度 | 图像优先分流 + `ARK_IMAGE_REPLACE_CODES` 显式映射 |
| mock 端点在 `PAYMENT_LIVE=true` 仍返回 200 | 生产可绕过真实支付白拿积分 | 真实 HTTP 403 + 403101 |
| `NODE_ENV=test` 短信 IP 频控默认 20 | 连续复跑 e2e 大面积失败（不可复跑） | test 环境默认 100000，生产仍 20 |
| `users.age_declared_at` 从不写入 | 无法举证成年确认（合规缺口） | 建号事务写入 + e2e 断言（GAP-01 CLOSED） |
| worker 生产可跑 `ADAPTER_MODE=mock` | 「假生成」上线，用户看到假成功 | 启动守卫拒绝；必须至少一种真实供应商 |

---

## 2. 可复跑验收（核心交付物）

```powershell
# 前置：项目专用 PostgreSQL 127.0.0.1:55432（app/app）与 Redis 127.0.0.1:6380 已运行
cd E:\wanxing
pwsh _acceptance/b-type-acceptance.ps1
```

脚本五阶段（本轮实测 25/25）：

| 阶段 | 内容 | 实测 |
|---|---|---|
| 0 | PG/Redis/psql/node/pnpm 前置检查 | 4/4 |
| 1 | drizzle migrate + seed（幂等，证明部署步骤可执行） | 2/2 |
| 2 | `pnpm test`（全仓）+ typecheck(10) + lint(6) + build(7) + **生产守卫正反例 4 项** | 全绿 |
| 3 | 真实 HTTP：healthz live/ready、metrics、x-request-id、`/billing/channels`、**微信/支付宝回调默认拒绝（401 + 渠道协议体）**、**支付闭环（注册→下单→mock 支付→+500→重复回调幂等）**、**退款闭环（管理员退款→积分回冲→status=4→重复退款幂等）**、合规检查 | 12/12 |
| 4 | 汇总（退出码非 0 即失败） | 25/25，exit 0 |

单独运行合规检查：

```powershell
node _acceptance/compliance-check.cjs            # 未起服务：65 PASS / 0 FAIL / 1 SKIP
$env:API_URL='http://127.0.0.1:3000'; node _acceptance/compliance-check.cjs   # 服务在跑：66/66
```

---

## 3. 测试与质量门禁（本轮最终态，独立复跑）

| 范围 | 结果 |
|---|---|
| 全仓测试（11 turbo tasks） | **299 passed / 1 skipped**：api 167（18 files）、model-adapters 87（7）、worker 15（4）、shared 13（2）、db 11（1）、storage 6 + 1 skipped |
| typecheck | 10/10 包通过 |
| lint | 6/6 包通过 |
| build | 7/7（api / worker / web，含 admin 退款 UI 与 pricing 收银台） |
| 合规检查 | 66/66（服务运行时）；离线 65/0/1（运行态 SKIP 有说明） |
| B 型验收 | **25/25** |

运行态实测摘录：

```text
支付闭环   balance 80 → 580（+500），重复回调 credited=false、余额不变
退款闭环   status=4, balance 580 → 80, refund_no=rf-<orderId>, 重复退款 idempotent=true
回调拒绝   wechat: HTTP 401 {"code":"FAIL",...}；alipay: HTTP 401 text/plain "failure"
可观测     x-request-id=<uuid>（响应头与日志同值）；metrics 为 Prometheus 纯文本
生产守卫   api 弱默认密钥 → 拒绝启动（聚合列出变量名）；完整配置 → ENV_OK
           worker mock/无供应商 → 拒绝；real + ARK Key → WORKER_ENV_OK
```

---

## 4. 上线切换（真实渠道/供应商）

完整 env 清单见 `payment-channel-adapter-2026-10-25.md` §4 与 `app/.env.production.example`。要点：

1. 注入凭据（服务器 env / CI Secrets / 容器 secret 挂载，禁止入仓）：
   - 支付：`PAYMENT_LIVE=true` + 微信（`WECHAT_APP_ID/MCH_ID/MCH_SERIAL_NO/MCH_PRIVATE_KEY_PATH/API_V3_KEY/PLATFORM_PUBLIC_KEY(_PATH)/NOTIFY_URL`）+ 支付宝（`ALIPAY_APP_ID/APP_PRIVATE_KEY_PATH/PUBLIC_KEY_PATH/NOTIFY_URL`）；
   - 供应商：`ADAPTER_MODE=real`、`LLM_MODE=real`、`ARK_API_KEY`（视频+图像）、`DEEPSEEK_API_KEY`，按需 `ARK_MODEL_MAP/ARK_IMAGE_MODEL_MAP/ARK_IMAGE_REPLACE_CODES`。
2. 渠道后台把两个 `*_NOTIFY_URL` 报备为公网 HTTPS（路径必须 `/v1/billing/notify/{wechat|alipay}`）。
3. `curl /v1/billing/channels` 应返回 `live:true` 且对应 `configured:true`（缺项会列 `missing`）。
4. 走 **1 分钱真单**：下单 → 收银台支付 → 回调入账 → `orders.status=2`、`channel_order_id`、`credit_flows recharge`；再走一次退款验证 `status=4` 与余额回冲。
5. 观察：回调 401/400 比例、`VENDOR_ERROR/VENDOR_TIMEOUT` 计数、`oneframe_orders_paid_without_credit`（应恒为 0）。
6. 生产启动守卫会拒绝默认密钥/假模式/半配渠道；若启动失败，按报错列出的变量名补齐。

---

## 5. 合规状态（单一事实来源：`docs/06-security-compliance/launch-checklist.md`）

- **代码侧 66 项全部 PASS**（服务运行时），脚本可复跑、逐条给证据（文件:行 / 端点）。
- **外部资质/密钥 20 项全部待办**（P0 8 / P1 9 / P2 3），EXT 行打勾数 = 0，未虚构完成：
  - P0：营业执照主体、域名实名、ICP 备案号（页脚仍占位）、公安备案、生成式 AI 服务备案、深度合成算法备案、供应商模型备案证明、协议/隐私律师审阅；
  - P1：ICP 经营许可（EDI）、供应商 DPA、微信商户号/APIv3/平台公钥、支付宝应用/公钥、短信签名模板、内容安全词库（≥5000）、发票能力、支付类目报备、未成年人误充客服通道；
  - P2：等保二级、境内/自建 APM、数据出境评估（当前无出境）。
- 退款口径（E3）：积分未消耗 → 全额退款 API（幂等 `rf-{order_id}`）；已消耗 → 不直接退，按未消耗余额人工协商；发票仍为外部能力。

---

## 6. 已知限制（不影响本轮验收结论，需真实运营数据后迭代）

1. 仅支持全额退款，无部分退款 API（GAP-07；E3 按人工口径处理）。
2. 渠道异步退款结果（`refund_status=processing`）未自动回收，需人工对账（GAP-08）；建议后续 worker 定时查退款单。
3. 微信平台证书手工轮换已可用，未做证书自动下载。
4. 支付宝对账单自动对账未做；当前账户级对账依赖 worker `reconcileOrders` + 人工。
5. 真实 Key/商户号未到位：未做真实扣款/真实生成；接 Key 后须按 §4 走 1 分钱真单与供应商冒烟。
6. Web 端未接入 JSAPI 调起（无公众号/小程序容器；Native/H5 已覆盖 Web）；Ark 图像 `b64_json` 与 worker 转存不兼容，生产必须保持默认 `response_format=url`。

---

## 7. 改动清单（本轮合并范围）

- **api**：`modules/billing/channels/*`（微信/支付宝/工厂/http 重试/错误码）、billing.controller/service（渠道下单、pay_params、关单、退款、回调 ack）、payment-signature（证书轮换/支付宝拼法兼容）、admin orders/refund、auth age_declared、config/env（支付/供应商/生产守卫/SMS 测试默认）、main（rawBody）、common/logging/*、drizzle 0008/0009、test 新增 10 个 spec。
- **worker**：env-guard（生产守卫）、adapterOptions（arkImage/arkImageCodes）。
- **packages**：db schema/ledger（pay_params、退款字段、creditOut/lockCreditAccount）、model-adapters（ark-image、errors、ark-video/deepseek 统一映射、registry、87 测试）。
- **web**：pricing 真实收银台（渠道选择/二维码/H5/收银台跳转）、admin 订单/退款 tab。
- **docs**：api-spec §10、database、system-design §4.1、deployment §6/§7.2/§7.3/§8、observability §1、compliance E3/G、新增 launch-checklist v1.1、根/app README。
- **acceptance**：`_acceptance/b-type-acceptance.ps1`（新增，可入库）、`_acceptance/compliance-check.cjs`（新增，可入库）、`.gitignore` 例外。

---

## 8. 结论

按 B 型「能真实收钱跑业务」标准：**支付渠道适配层、回调验签/解密/ack、退款闭环、供应商协议层与错误映射、生产启动守卫、合规清单与可运维性、可复跑验收均已代码侧完成并实测通过**。剩余阻塞仅为外部资质与密钥（20 项），以及 6 项已记录的产品化限制；前者办理完成并按 §4 切换配置后即可真实收款。
