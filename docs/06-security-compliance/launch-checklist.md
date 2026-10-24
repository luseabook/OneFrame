# 上线合规检查单（Launch Checklist）

> v1.1 · 2026-10-25（Round 5 对齐）· **本文件是上线合规状态的唯一事实来源**
> v1.1 变更：对齐 task-1/task-4 新实现——新增退款闭环（PAY-05~12）、微信平台证书轮换（PAY-13~16）、
> 生产启动守卫（OPS-06~09）、全量验收闭环（ACC-01~03）；**GAP-01（年龄留痕）已 CLOSED**；
> 代码侧检查项 47 → **66 项**。
> 自动核查：`node _acceptance/compliance-check.cjs`（代码侧条目全部可复跑；外部资质项由法务/财务人工办理）
> 免责声明：非法律意见。正式办理前须由代理/律师确认口径（尤其 AI 双备案的属地要求）。

## 0. 怎么用这份清单

| 概念 | 规则 |
|---|---|
| 两大区 | **外部资质/密钥（EXT-）** = 只能人工办理，脚本无法验证；**代码侧（PAGE-/AGE-/MOD-/REP-/DEL-/PIPL-/AI-/PAY-/OPS-/LOG-/SEC-/DOC-/ACC-）** = 脚本逐条验证并给证据 |
| ✅ | 已完成，且证据可复跑（脚本 PASS，或附回执/归档位置） |
| ⏳ | 进行中，或有外部前置依赖（未受理/未签署） |
| ❌ | 未开始 |
| P0 | **缺一项即不得对外开放注册/生成/支付** |
| P1 | 首次真实商业收费（真实微信/支付宝渠道）前必须完成 |
| P2 | 试运营期内补齐，不阻断内测 |
| 反纸面完成 | 外部项标 ✅ 必须同时附**回执号或归档位置**；`DOC-04` 检查会拦截只打勾不给证据的行 |

与其它文档的关系：`compliance.md` 给义务全景（A–G 段，法规依据与背景），**上线 gate 只认本清单**；
`docs/05-ops/deployment.md` 给部署/演练操作细节（退款 SOP §7.2、证书轮换 §7.3、生产守卫 §7.4、演练 §8）；
`docs/05-ops/observability.md` 给日志与告警口径。全量验收见本文件 §6。两分钟单跑本清单：
`node _acceptance/compliance-check.cjs`（离线可用）。

---

## 1. 外部资质与密钥（EXT，人工办理，脚本不可验证）

| 编号 | 事项 | 类型 | 证据/办理物 | 验收方式 | 状态 | 阻塞级别 |
|---|---|---|---|---|---|---|
| EXT-01 | 公司主体（营业执照，经营范围含互联网信息服务/软件开发） | 外部 | 营业执照、统一社会信用代码 | 主体信息可回填到 `/terms`、`/privacy` 与支付商户资质 | ⏳ | P0 |
| EXT-02 | 域名注册与实名（www/app/api/static） | 外部 | 域名证书、实名信息 | 四域 HTTPS 可访问、证书主体一致 | ⏳ | P0 |
| EXT-03 | **ICP 备案**（非经营性，主体+域名） | 外部 | 备案号（形如 京ICP备XXXXXXXX号-1Y） | 备案系统截图 + 页脚替换 `index.vue` 占位号（现为占位） | ⏳ | P0 |
| EXT-04 | ICP 经营许可证（EDI，在线数据处理与交易） | 外部 | 许可证编号 | 涉及在线充值即属经营性，取得后在页脚/协议披露 | ⏳ | P1 |
| EXT-05 | 公安联网备案 | 外部 | 公安备案号 + 备案图标 | 页脚展示 + 备案系统回执 | ⏳ | P0 |
| EXT-06 | **生成式人工智能服务备案** | 外部 | 网信部门受理回执/备案编号 | 回执留存；应用备案与实际模型清单一致 | ⏳ | P0 |
| EXT-07 | **深度合成服务算法备案** | 外部 | 算法备案号 | 算法备案系统截图；算法名称与产品调用一致 | ⏳ | P0 |
| EXT-08 | 供应商模型备案证明（火山方舟/百炼/可灵等） | 外部 | 各家备案截图、合同附件 | 与 `packages/model-adapters` 实际启用模型逐一对应 | ⏳ | P0 |
| EXT-09 | 供应商 DPA/委托处理协议 | 外部 | 签署版合同/在线条款留存 | 覆盖输入素材与输出结果的委托处理、留存期限 | ⏳ | P1 |
| EXT-10 | 微信支付商户号 + APIv3 密钥 + 平台公钥证书（**含轮换期双证书**） | 外部 | 商户号、证书序列号、平台公钥 PEM（单证书）或 `{"serial":"PEM"}` 映射 | 配到 `WECHAT_MCH_ID / WECHAT_API_V3_KEY / WECHAT_PLATFORM_PUBLIC_KEY`（或 `WECHAT_PLATFORM_PUBLIC_KEYS` 轮换映射）；未配时回调按设计 401 拒绝（PAY-01/PAY-13~16，运维步骤见 deployment §7.3） | ⏳ | P1 |
| EXT-11 | 支付宝应用 + 支付宝公钥 | 外部 | APPID、支付宝公钥 PEM | 配到 `ALIPAY_APP_ID / ALIPAY_PUBLIC_KEY`（PAY-02） | ⏳ | P1 |
| EXT-12 | 短信签名与模板报备 | 外部 | 签名、模板 ID | 配到 `SMS_SIGN_NAME / SMS_TEMPLATE_CODE`，通过运营商审核 | ⏳ | P1 |
| EXT-13 | 内容安全词库订阅/采购（≥5000 词，含政治/暴恐/色情/侵权 IP） | 外部 | 词库许可、更新记录 | 注入 `MODERATION_WORDS` 并抽验拦截（当前仅内置 8 词，见 GAP-02） | ⏳ | P1 |
| EXT-14 | 发票能力（诺诺/百望等）或人工月度开票流程 | 外部 | 服务合同、开票账号 | 订单页可采集开票信息 + 首张发票开出 | ⏳ | P1 |
| EXT-15 | 用户协议/隐私政策律师审阅（含虚拟商品不退、未成年人、AI 声明） | 外部 | 审阅意见书 | 意见回改到 `/terms`、`/privacy` 后发布 | ⏳ | P0 |
| EXT-16 | 支付类目报备（软件服务/虚拟商品）+ 类目审核通过 | 外部 | 商户平台类目截图 | 类目与实际售卖内容一致，避免被风控拦截 | ⏳ | P1 |
| EXT-17 | 等保 2.0（二级）定级备案/测评 | 外部 | 测评报告 | Ph2 完成；MVP 先做自查（见 security.md） | ⏳ | P2 |
| EXT-18 | Sentry 境内/自建部署（**禁境外 SaaS**） | 外部 | 自建 DSN 内网地址 | 前后端 DSN 指向境内实例，用户级数据不上报（observability §5） | ⏳ | P2 |
| EXT-19 | 未成年人误充退款与监护申诉客服通道 | 外部 | 客服工单流程、话术、退款审批链 | 模拟监护人申诉走通一次（D9）；**退款执行口径见下方「E3 口径」**（全额退款 API + 未消耗余额人工） | ⏳ | P1 |
| EXT-20 | 数据出境评估（若后续接入境外模型/云） | 外部 | 评估结论/自评估报告 | 当前全链路境内（compliance D4），无出境 | ⏳ | P2 |

> 外部项推进顺序建议：EXT-01 → EXT-02 → EXT-03 → EXT-05（备案链最短路径）并行 EXT-15/EXT-06/EXT-07（周期最长）；
> 支付类（EXT-10/11/16）与 EXT-04 同步推进，全部到位前保持 `PAYMENT_LIVE=false`（代码已默认拒绝真实渠道）。

### 1.1 E3（未成年人误充退款）当前口径

| 场景 | 处理方式 | 依据 |
|---|---|---|
| 订单已支付且**积分未消耗**（`balance >= credits`） | 运营审批后用**全额退款 API** `POST /v1/ops/admin/orders/{id}/refund`（管理端，AdminGuard 保护）：订单置已退款、积分回冲、写 `kind=refund` 负向流水，`refund_no=rf-{order_id}` 天然幂等 | 代码 PAY-05~12；运维步骤 deployment §7.2 |
| 积分**已部分/全部消耗**（余额不足） | 接口拒绝 `400101 insufficient credits to roll back`，**不得**直接调用退款；按未消耗余额与监护人协商，走渠道/线下人工退款并备注工单（本期无部分退款 API） | deployment §7.2 第 5 步；GAP-07 |
| 发票 | **仍为外部项**：开票服务/税控资质未就位前不支持自助开票（EXT-14） | EXT-14 |
| 渠道退款异步结果 | 微信/支付宝受理后可能 `refund_status=processing`，当前需运营按渠道商户平台结果人工对账确认（无自动回收任务） | GAP-08；CODE-H5 |

---

## 2. 代码侧可验证项（脚本逐条 PASS/FAIL/SKIP）

命令：`node _acceptance/compliance-check.cjs`（本地无依赖、不联网；**共 66 项**，`LOG-04` 为本地运行态探测，服务未起即 SKIP）。
服务未启动：**65 PASS / 0 FAIL / 1 SKIP**；`API_URL` 指向在跑的 api：**66 PASS / 0 FAIL / 0 SKIP**。

| 编号 | 事项 | 证据（脚本输出 文件:行） | 验收方式 | 状态 | 阻塞级别 |
|---|---|---|---|---|---|
| PAGE-01 | 用户协议页 `/terms` | `apps/web/pages/terms.vue:7` | 脚本 PAGE-01 | ✅ | P0 |
| PAGE-02 | 隐私政策页 `/privacy` | `apps/web/pages/privacy.vue:7` | 脚本 PAGE-02 | ✅ | P0 |
| PAGE-03 | 举报投诉页 `/report` | `apps/web/pages/report.vue` | 脚本 PAGE-03 | ✅ | P0 |
| PAGE-04 | 公开分享页 `/share/:token`（含 AI 声明 + 举报入口） | `apps/web/pages/share/[token].vue:77` | 脚本 PAGE-04 | ✅ | P0 |
| PAGE-05 | 页脚三链路入口（协议/隐私/举报） | `layouts/default.vue:37`、`layouts/app.vue:134`、`pages/index.vue:175` | 脚本 PAGE-05 | ✅ | P0 |
| PAGE-06 | ICP 备案号展示位（占位待替换） | `apps/web/pages/index.vue:182` | 脚本 PAGE-06 + 目视 | ✅ | P0 |
| AGE-01 | 注册勾选「已满 18 周岁」 | `apps/web/pages/login.vue:54`（门禁）+`:91`（勾选框） | 脚本 AGE-01 | ✅ | P0 |
| AGE-02 | 后端强制校验，未确认拒绝建号 | `apps/api/src/modules/auth/auth.service.ts:110` | 脚本 AGE-02 | ✅ | P0 |
| AGE-03 | 年龄声明留痕：字段 + 建号事务写入 + 回归断言（**GAP-01 已关闭**） | `packages/db/src/schema.ts:32`（`users.age_declared_at`）、`auth/auth.service.ts:120`（`ageDeclaredAt: new Date()`）、`apps/api/test/flow.spec.ts:71`（断言为 Date） | 脚本 AGE-03 | ✅ | P0 |
| MOD-01 | 输入审核：命中敏感词返回 745801 | `packages/shared/src/errors.ts:28`、`moderation.service.ts:43` | 脚本 MOD-01 | ✅ | P0 |
| MOD-02 | 输出审核：违规结果 745802 + 任务状态 7 | `errors.ts:29`、`script/llm.service.ts:154`、`worker/src/executor.ts:193` | 脚本 MOD-02 | ✅ | P0 |
| MOD-03 | 生成入口先审后发 | `modules/generations/generations.service.ts:32` | 脚本 MOD-03 | ✅ | P0 |
| MOD-04 | 审核/举报记录留存 ≥6 个月（retention 不清理） | `worker/src/maintenance.ts`（无 `task_events`/`content_reports` 清理）、`schema.ts:476` | 脚本 MOD-04 + 生产归档（CODE-H3） | ✅ | P0 |
| MOD-05 | 词表/开关可运维（env 注入，无需改码） | `moderation.service.ts:22`（`MODERATION_WORDS`） | 脚本 MOD-05 | ✅ | P1 |
| REP-01 | 公开举报端点 `POST /v1/share/:token/report` | `modules/reports/reports.controller.ts:14` | 脚本 REP-01 | ✅ | P0 |
| REP-02 | 运营处置端点 `POST /v1/ops/admin/reports/:id/resolve` | `modules/admin/admin.controller.ts:85` | 脚本 REP-02 | ✅ | P0 |
| REP-03 | 处置留痕：处理人/时间/结论 | `modules/admin/admin.service.ts:414`（`handledBy/handledAt/resolution`） | 脚本 REP-03 | ✅ | P0 |
| REP-04 | 下线即时撤销分享 token | `admin.service.ts:419`（`revokedAt`） | 脚本 REP-04 | ✅ | P0 |
| DEL-01 | 账号注销端点 `POST /v1/me/delete` | `modules/auth/auth.controller.ts:78` | 脚本 DEL-01 | ✅ | P0 |
| DEL-02 | 注销后 token 失效 + 30 天物理清理 | `auth.service.ts:199`、`worker/src/maintenance.ts:207` | 脚本 DEL-02 | ✅ | P0 |
| PIPL-01 | 隐私政策覆盖收集/保留/共享/用户权利 | `apps/web/pages/privacy.vue` | 脚本 PIPL-01 + EXT-15 审阅 | ✅ | P0 |
| PIPL-02 | 手机号 HMAC + AES-256-GCM 存储 | `modules/auth/crypto.ts:1`、`crypto.ts:15` | 脚本 PIPL-02 | ✅ | P0 |
| PIPL-03 | refresh_token 仅 HttpOnly + SameSite=Strict | `auth.controller.ts:94` | 脚本 PIPL-03 | ✅ | P0 |
| AI-01 | 显式标识：成片水印（ffmpeg drawtext） | `apps/worker/src/label.ts:97` | 脚本 AI-01 + CODE-H1 真实抽验 | ✅ | P0 |
| AI-02 | 隐式标识：旁车 `.ai.json` + 容器 metadata | `apps/worker/src/label.ts:58` | 脚本 AI-02 | ✅ | P0 |
| AI-03 | 生产默认开启标识 | `worker/src/main.ts:107`、`.env.production.example`（`AI_LABEL_ENABLED=true`） | 脚本 AI-03 | ✅ | P0 |
| AI-04 | 页面/协议披露双重标识 | `pages/terms.vue:30`、`pages/share/[token].vue:77` | 脚本 AI-04 | ✅ | P0 |
| PAY-01 | 微信回调默认拒绝（未配平台公钥即 401） | `billing/billing.controller.ts`（`hasWechatPlatformKeys` → `fail(401, "wechat platform public key not configured")`）、`payment-signature.ts:34`、`channels/channel.service.ts`（凭据缺失计入 `missing`） | 脚本 PAY-01 | ✅ | P0 |
| PAY-02 | 支付宝回调默认拒绝（未配公钥即拒） | `billing.controller.ts`（`ALIPAY_PUBLIC_KEY`） | 脚本 PAY-02 | ✅ | P0 |
| PAY-03 | 生产禁 mock 渠道（防"假支付"上线） | `billing.controller.ts`（`PAYMENT_LIVE` 三处拒绝） | 脚本 PAY-03 | ✅ | P0 |
| PAY-04 | 回调防重放（±5min）+ 验签回归测试 | `payment-signature.ts:38`、`apps/api/test/payment-signature.spec.ts` | 脚本 PAY-04 | ✅ | P1 |
| PAY-05 | 退款端点仅管理端可用 | `admin/admin.controller.ts:156`（`@Post("orders/:id/refund")`）+ `:49`（`@UseGuards(AdminGuard)`） | 脚本 PAY-05 | ✅ | P1 |
| PAY-06 | 退款仅支持全额（部分退款显式拒绝） | `billing/billing.service.ts:415`（`partial refund is not supported`） | 脚本 PAY-06 | ✅ | P1 |
| PAY-07 | 已退款幂等：不重复扣积分、不重复调渠道 | `billing.service.ts:405`（`status === REFUNDED` → `idempotent: true`） | 脚本 PAY-07 | ✅ | P1 |
| PAY-08 | 余额不足在调渠道**之前**拒绝（保护 `balance == Σdelta`） | `billing.service.ts`（`lockCreditAccount` + `insufficient credits to roll back`） | 脚本 PAY-08 | ✅ | P1 |
| PAY-09 | 渠道退款失败即回滚事务（订单仍已支付、积分不冲正） | `billing.service.ts`（`db.transaction` + `toChannelAppError` + 事务回滚注释） | 脚本 PAY-09 | ✅ | P1 |
| PAY-10 | 退款写负向流水 `kind=refund`（可审计、可对账） | `packages/db/src/ledger.ts:173`（`creditOut`）、`:175`（`kind: "refund"`）、`billing.service.ts:481`（调用点） | 脚本 PAY-10 | ✅ | P1 |
| PAY-11 | 退款字段迁移 `0009`（`refund_no/status/amount/reason/operator`） | `apps/api/drizzle/0009_*.sql` | 脚本 PAY-11 | ✅ | P1 |
| PAY-12 | 退款回归测试（全额/幂等/余额不足/渠道失败回滚） | `apps/api/test/refunds.spec.ts`、`refunds-wechat.spec.ts` | 脚本 PAY-12 | ✅ | P1 |
| PAY-13 | 微信平台证书轮换：多证书映射 + 按 `Wechatpay-Serial` 选公钥 | `config/env.ts`（`WECHAT_PLATFORM_PUBLIC_KEYS`）、`channels/channel.service.ts:100`（`selectWechatPlatformPublicKey`/`bySerial`）、`billing.controller.ts:138/150` | 脚本 PAY-13 | ✅ | P1 |
| PAY-14 | 未知 serial 一律 401（轮换期不误放行） | `billing.controller.ts:152`（`unknown wechat platform certificate serial`） | 脚本 PAY-14 | ✅ | P1 |
| PAY-15 | 无 serial 兼容回退（单证书老部署不受影响） | `channel.service.ts:109-114`（无 serial 单证书可用 / 回退 `keyring.fallback`） | 脚本 PAY-15 | ✅ | P1 |
| PAY-16 | 证书轮换回归测试（双证书/未知 serial/回退） | `apps/api/test/billing-notify-cert-rotation.spec.ts` | 脚本 PAY-16 | ✅ | P1 |
| OPS-01 | 健康检查 live/ready 语义分离 | `apps/api/src/health/health.controller.ts:19`（503 逻辑） | 脚本 OPS-01 | ✅ | P0 |
| OPS-02 | Prometheus `/v1/metrics`（含已支付未入账） | `health/metrics.controller.ts:19`、`:86` | 脚本 OPS-02 | ✅ | P1 |
| OPS-03 | 备份/恢复/校验/回滚脚本齐备 | `app/deploy/{backup-db.sh,restore-db.sh,verify-backup.ps1,rollback.sh}` | 脚本 OPS-03 + 演练 D1/D2 | ✅ | P0 |
| OPS-04 | 回滚含 readiness 校验 + 不可逆迁移提示 | `app/deploy/rollback.sh:13` | 脚本 OPS-04 | ✅ | P0 |
| OPS-05 | 优雅停机：先摘流再等在途，超时强杀 | `health.controller.ts:29`、`deployment.md` §6.1 | 脚本 OPS-05 + 演练 D5 | ✅ | P0 |
| OPS-06 | **生产启动守卫（api）**：仓库默认弱密钥/缺 `COOKIE_SECURE`/支付凭据半配 → 拒绝启动，聚合报错**不含密钥值** | `config/env.ts:222`（`collectProductionProblems`）、`:264`（`buildEnv`）、`:269`（聚合报错）；deployment §7.4 | 脚本 OPS-06 | ✅ | P0 |
| OPS-07 | api 生产守卫回归测试（正反例 + 不泄漏密钥值） | `apps/api/test/env-production-guard.spec.ts` | 脚本 OPS-07 | ✅ | P1 |
| OPS-08 | **生产启动守卫（worker）**：禁 `ADAPTER_MODE=mock`（假生成）且至少一种真实供应商 | `apps/worker/src/env-guard.ts:24/49`；deployment §7.4 | 脚本 OPS-08 | ✅ | P0 |
| OPS-09 | worker 生产守卫回归测试 | `apps/worker/src/env-guard.spec.ts` | 脚本 OPS-09 | ✅ | P1 |
| LOG-01 | worker 日志脱敏（`access_token` redact） | `apps/worker/src/main.ts:15` | 脚本 LOG-01 | ✅ | P0 |
| LOG-02 | api 请求日志脱敏（不落 body/查询串/token；手机号掩码） | `common/logging/request-log.ts`（字段白名单 + `sanitizePath` + `maskPhoneLike`） | 脚本 LOG-02 + 测试 LOG-05 | ✅ | P0 |
| LOG-03 | request_id 中间件接入 AppModule 并回写响应头 | `app.module.ts`（`configure` → `RequestLoggingMiddleware`）、`request-logging.middleware.ts` | 脚本 LOG-03 | ✅ | P0 |
| LOG-04 | 响应头 `x-request-id` 与日志字段一致（运行态） | 2026-10-25 本地实测：`GET /v1/ping` → 响应头 `x-request-id: 86f9c2f6-…-c3b50c22a321`，同请求日志 `request_id` 同值、`status=200`、`duration_ms=5` | `node _acceptance/compliance-check.cjs`（服务未启动时该条 SKIP 并说明，不计失败） | ✅ | P0 |
| LOG-05 | 观测契约有测试守护（头=日志、脱敏、慢请求 WARN） | `apps/api/test/observability.spec.ts`（12 项） | `pnpm --filter @app/api test` | ✅ | P1 |
| SEC-01 | 运营后台口令 scrypt 加盐哈希 | `modules/admin/admin-auth.service.ts:1` | 脚本 SEC-01 | ✅ | P0 |
| SEC-02 | 分享 token 高熵随机 + 过期 | `modules/tasks/tasks.service.ts:313`（`randomBytes(24)`） | 脚本 SEC-02 | ✅ | P0 |
| DOC-01 | 本清单存在且分外部/代码区、带 P0-P2 | 本文件 | 脚本 DOC-01 | ✅ | P1 |
| DOC-02 | `compliance.md` G 节引用本清单（防漂移） | `docs/06-security-compliance/compliance.md` §G | 脚本 DOC-02 | ✅ | P1 |
| DOC-03 | `observability.md` 含 request_id 字段表与告警 | `docs/05-ops/observability.md` §1 | 脚本 DOC-03 | ✅ | P1 |
| DOC-04 | 外部项不得纸面打勾（✅ 须附回执/归档） | 本文件 §1（全部 ⏳） | 脚本 DOC-04 | ✅ | P1 |
| ACC-01 | **全量验收脚本**存在且含五阶段（前置检查→迁移→质量门禁→运行态→汇总） | `_acceptance/b-type-acceptance.ps1` | 脚本 ACC-01 | ✅ | P1 |
| ACC-02 | 全量验收串接本合规检查（单一口径，不维护两套） | `b-type-acceptance.ps1`（调用 `compliance-check.cjs`） | 脚本 ACC-02 | ✅ | P1 |
| ACC-03 | 全量验收覆盖退款闭环与生产守卫**正反例**（运行态 HTTP，非纯静态） | `b-type-acceptance.ps1`（「退款闭环（HTTP）」/「生产守卫」段） | 脚本 ACC-03 | ✅ | P1 |

---

## 3. 代码侧但需人工/真机抽验（脚本不判定）

| 编号 | 事项 | 为什么脚本判不了 | 验收方式 | 状态 | 级别 |
|---|---|---|---|---|---|
| CODE-H1 | 显式水印真实成片抽验 | 需真实供应商出片 + ffmpeg 渲染 | 图片/视频各 1 条，肉眼确认水印 + `ffprobe` 读 `artist/comment`，旁车 `.ai.json` 存在 | ⏳ | P0 |
| CODE-H2 | 敏感词库规模 ≥5000 且定期更新 | 词库属外部采购 | `MODERATION_WORDS` 注入后抽验 20 条正/负样本 | ⏳ | P1 |
| CODE-H3 | 审核/举报记录 6 个月归档策略 | 生产对象存储归档配置 | `task_events`/`content_reports` 归档到 OSS + 生命周期规则截图 | ⏳ | P1 |
| CODE-H4 | 真实渠道小额联调（1 分钱全链路） | 需真实商户号 | 下单→支付→回调验签→入账→**全额退款→渠道退款结果回收**，`orders_paid_without_credit` 保持 0（mock 链路的同路径已由 ACC-03 自动覆盖） | ⏳ | P1 |
| CODE-H5 | 对账 SOP 连续 24h 验证 | 需生产流量 | `flows-audit` 每日无告警、`oneframe_orders_paid_without_credit=0` | ⏳ | P1 |
| CODE-H6 | `AI_LABEL_ENABLED=false` 是否允许上线的策略评审 | 属风控决策 | 结论写入本清单；默认生产模板已置 `true` | ⏳ | P2 |

---

## 4. 上线前 72 小时运维演练（详细操作见 `docs/05-ops/deployment.md` §8）

| 编号 | 演练 | 操作 | 通过判据 | 状态 |
|---|---|---|---|---|
| D1 | 备份可恢复性 | `app/deploy/verify-backup.ps1`（恢复到临时库比对表数与关键数据） | 全表恢复成功、关键表行数一致、临时库已清理 | ⏳ |
| D2 | 回滚 | `app/deploy/rollback.sh <上一 tag>` | ≤2min 完成，`/v1/healthz/ready` 200，核心接口冒烟通过 | ⏳ |
| D3 | 支付回调失败 | **两种手法**：①置空 `WECHAT_PLATFORM_PUBLIC_KEY` 与 `WECHAT_PLATFORM_PUBLIC_KEYS`（未配公钥）；②保留映射但用**未知 `Wechatpay-Serial`** 打回调（轮换期误配场景） | 两种都返回 **401 拒绝**、不入账、`paid_without_credit` 无增长、告警触发（证书轮换口径见 deployment §7.3） | ⏳ |
| D4 | 对账补账 | mock notify 制造"已支付未入账" → 等 `orders-reconcile` | 5min 内补账，指标归零 | ⏳ |
| D5 | 优雅停机 | 向 api 发 `SIGTERM` | ready 立即 503 → 在途请求完成 → 退出码 0，日志含 `draining`/`closed cleanly` | ⏳ |
| D6 | 告警链路 | 人为制造 5xx/慢请求 | 日志 `level=warn` 且落到告警通道（P0 电话 + IM） | ⏳ |
| D7 | 容量与限流 | 压测下单/生成查询 | api P95 ≤ 500ms，队列 age ≤ 5min，带宽/磁盘水位 < 70% | ⏳ |
| D8 | 值班与升级 | 排班表 + 升级路径评审 | P0 15min 内响应，值班表确认到人 | ⏳ |
| D9 | 未成年人误充退款 | 模拟监护人申诉 → 审批 → **全额退款 API**（积分未消耗场景，见 §1.1 与 deployment §7.2） | 有工单、有审批记录；响应 `status=4`、`refund_no=rf-{order_id}`、`kind=refund` 流水齐全且 `balance == Σdelta`；重复调用幂等（不二次扣减） | ⏳ |

---

## 5. 本次复核发现的缺口（GAP）

| 编号 | 缺口 | 证据 | 影响 | 修复建议 | 级别 |
|---|---|---|---|---|---|
| GAP-01 | ~~年龄声明未落库：`users.age_declared_at` 列存在但无写入逻辑~~ → **CLOSED（2026-10-25，Lead 修复）** | 历史：`schema.ts:32` 有列而建号事务未写；**现状**：`auth/auth.service.ts:120` 建号事务写 `ageDeclaredAt: new Date()`，`apps/api/test/flow.spec.ts:71` 断言为 Date，脚本 AGE-03 覆盖 | 已消除"无法举证成年确认时间"的合规风险 | 无需再修；回归由 AGE-03 + flow.spec 守护 | ✅ 已关闭 |
| GAP-02 | 敏感词库仅 8 条内置词 | `moderation.service.ts:7`（`BUILTIN_WORDS`） | 拦截率不足，内容安全兜底弱 | 采购词库 + `MODERATION_WORDS` 注入（EXT-13） | P1 |
| GAP-03 | 根 `.env.example` 与 `deployment.md §4` 口径不一致（后者称其为权威版，实际仅 2 个变量） | `app/.env.example` 仅 `DATABASE_URL`/`REDIS_URL`；真实模板在 `apps/*/.env.example`、`.env.production.example` | 新环境搭建易漏配（如 `AI_LABEL_ENABLED`、`MODERATION_WORDS`） | 已在 Round 4 修正 `deployment.md` §4 表述（指向真实模板文件） | P2 |
| GAP-04 | 发票能力与客服话术未落地（**退款 SOP 已有**：deployment §7.2 + 全额退款 API） | EXT-14（发票）、EXT-19（客服通道） | 商业化后开票/客诉处理仍缺外部能力 | 发票走 EXT-14；客服话术随 EXT-19 一并交付并培训 | P1 |
| GAP-05 | ICP 备案号为占位串 | `apps/web/pages/index.vue:182`（`京 ICP 备 00000000 号（上线前替换）`） | 备案号未上线即违规 | EXT-03 取得后替换（P0 阻断） | P0 |
| GAP-06 | `deployment.md` 定时任务表存在错行（`exports-cleanup` 挤进 `assets-expire` 行） | `docs/05-ops/deployment.md` §7 | 阅读误导 | 已在 Round 4 修复（§7.1） | P2 |
| GAP-07 | **退款仅支持全额**：积分已部分消耗时无部分退款 API | `billing.service.ts:415`（`partial refund is not supported`）；余额不足时不调渠道直接拒绝（PAY-08） | 部分消耗订单只能人工按未消耗余额协商退款，客服成本高 | 若商业化需要，另立"部分退款 + 按比例回冲流水"需求（涉及账单口径与渠道协议，PRD 级决策） | P1 |
| GAP-08 | **渠道退款异步结果未自动回收**：微信/支付宝受理后可能 `refund_status=processing`，当前依赖运营在商户平台人工对账确认 | `billing.service.ts`（`mapChannelRefundStatus` 仅映射状态）、deployment §7.2 第 4 步 | 极端情况下"渠道已退款但本地仍 processing"需人工发现 | Ph2 增加退款结果查询任务（定时查单→回写 succeeded/failed），并纳入 `/metrics` 退款异常指标 | P2 |

---

## 6. 如何跑验收

### 6.1 两分钟：只跑合规清单（离线，日常自检）

```bash
# 代码侧 66 项检查（PASS/FAIL/SKIP + 每条证据）
node _acceptance/compliance-check.cjs

# 只看非 PASS 项
node _acceptance/compliance-check.cjs --quiet

# 附带运行态校验（api 已在跑时才把 LOG-04 计入 PASS）
API_URL=http://127.0.0.1:3000 node _acceptance/compliance-check.cjs
```

判据：**FAIL 必须为 0**；SKIP 只允许本地运行态探测（`LOG-04`）且服务未启动。

### 6.2 完整：全量验收脚本（发布前 / 交付验收，推荐）

```powershell
pwsh _acceptance/b-type-acceptance.ps1                 # 全量（推荐）
pwsh _acceptance/b-type-acceptance.ps1 -SkipBuild      # 已 build 过：跳过构建
pwsh _acceptance/b-type-acceptance.ps1 -SkipTests      # 只跑运行态/合规/构建
pwsh _acceptance/b-type-acceptance.ps1 -ApiPort 3101   # 换临时端口（默认 3100）
```

脚本阶段（与 `ACC-01` 对应）：

| 阶段 | 内容 | 覆盖清单条目 |
|---|---|---|
| 0. 前置检查 | 项目专用 PostgreSQL `127.0.0.1:55432` / Redis `127.0.0.1:6380` / 工具链 | OPS-01 前提 |
| 1. 数据库迁移 | `db:migrate`（幂等）+ `db:seed`（SKU/模型/价格） | PAY-11（迁移 0009） |
| 2. 质量门禁 | 全仓 `pnpm test`、`typecheck`、`lint`、`build`；**生产守卫正反例**（api 弱默认密钥应拒绝/完整配置应通过；worker `ADAPTER_MODE=mock` 应拒绝/`real`+真实 Key 应通过） | OPS-06~09、LOG-05、PAY-12/16 |
| 3. 运行态冒烟（临时端口，不干扰 3000/3001） | healthz live/ready、`/metrics`、`x-request-id`、`/billing/channels`、回调默认拒绝（401 + 渠道协议体）、**支付闭环**（下单→mock 支付→入账→幂等）、**退款闭环**（管理员全额退款→积分回冲→`status=4`→重复调用幂等）、最后串接 `compliance-check.cjs` | LOG-04、PAY-01~16、ACC-02/03 |
| 4. 汇总 | `结果: X/Y 通过，Z 失败`；有失败 `exit 1` | — |

前置条件：Node/pnpm 可用；`app/apps/api/dist` 存在（或不要加 `-SkipBuild`）；PG/Redis 已按项目端口运行。
脚本只使用临时端口并自行清理进程与日志，不启停数据库。
**注意**：脚本中"生产守卫"用故意错误的配置启动，属预期失败路径（不是环境异常）。

### 6.3 发布闸门顺序建议

1. `node _acceptance/compliance-check.cjs`（0 FAIL）
2. `pwsh _acceptance/b-type-acceptance.ps1`（全绿）
3. 演练 D1/D2/D3/D5（备份恢复 / 回滚 / 回调拒绝 / 优雅停机），结果回填发布单
4. `EXT-` P0 项全部清零（否则不得开放注册/生成/真实支付）
