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
| EXT-12 | 短信签名与模板报备 | 外部 | 签名、模板 ID | 配到 `SMS_SIGN_NAME / SMS_TEMPLATE_CODE`，通过运营商审核 | N/A | — |
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

命令：`node _acceptance/compliance-check.cjs`（本地无依赖、不联网；**共 69 项**，`LOG-04` 为本地运行态探测，服务未起即 SKIP）。
服务未启动：**68 PASS / 0 FAIL / 1 SKIP**（`SEC-04` 已实现，闸门转绿）（SKIP 只允许 `LOG-04`；2026-11-03 把 i18n 引用纳入证据后不再因多语言化假红）；
`API_URL` 指向在跑的 api 时为 **67 PASS / 0 FAIL / 0 SKIP**（`b-type-acceptance.ps1` 即走此路）。

> 2026-11-03 判据收紧两处：① `LOG-04` 从「有 `x-request-id` 头即 PASS」改为「**200 + `pong:true` + 头**」，
> 因为实测本机 3000 端口被陌生进程占用时它对 `/v1/ping` 返回 404 却自带该头，旧判据会假绿；
> ② 新增 `PAGE-07`：SiteLegal 空串时**整段不渲染且不报错**，忘配 env 等于「静默无备案号」，属 P0。
>
> 2026-11-03 二次修正（Ops 在真实部署上发现）：`pong` 在全局信封的 **`data.pong`** 里，只认顶层会让
> 「服务在线也永远 SKIP」。判据改为同时接受 `pong` 与 `data.pong`；桩服务实测 `67 PASS / 0 FAIL / 0 SKIP`。
>
> **`--runtime-only`**：部署机通常只有构建产物（无 `docs/`、`_acceptance/*.ps1`、部分源文件）。
> 加该参数后，`DOC-*`/`ACC-*` 与「本机无该源文件」的静态判据一律降为 SKIP 并写明原因；
> **文件在但内容不符仍 FAIL**（诚实降级，不是放宽）。部署后自检用：
> `API_URL=http://127.0.0.1:3000 node _acceptance/compliance-check.cjs --runtime-only`
> （仓库全量 68 PASS / 0 FAIL / 1 SKIP；运行态模式 60 PASS / 8 SKIP。）

| 编号 | 事项 | 证据（脚本输出 文件:行） | 验收方式 | 状态 | 阻塞级别 |
|---|---|---|---|---|---|
| PAGE-01 | 用户协议页 `/terms` | `apps/web/pages/terms.vue:7` | 脚本 PAGE-01 | ✅ | P0 |
| PAGE-02 | 隐私政策页 `/privacy` | `apps/web/pages/privacy.vue:7` | 脚本 PAGE-02 | ✅ | P0 |
| PAGE-03 | 举报投诉页 `/report` | `apps/web/pages/report.vue` | 脚本 PAGE-03 | ✅ | P0 |
| PAGE-04 | 公开分享页 `/share/:token`（含 AI 声明 + 举报入口） | `apps/web/pages/share/[token].vue:77` | 脚本 PAGE-04 | ✅ | P0 |
| PAGE-05 | 页脚三链路入口（协议/隐私/举报） | `layouts/default.vue:37`、`layouts/app.vue:134`、`pages/index.vue:175` | 脚本 PAGE-05 | ✅ | P0 |
| PAGE-06 | ICP 备案号展示：唯一来源 + 两处页脚挂载 + 5 语言标签齐备（号段已从语言包抽出，走 `runtimeConfig.public.icpBeian`） | `apps/web/components/SiteLegal.vue:10`、`apps/web/nuxt.config.ts:39`、`pages/index.vue:174`、`layouts/default.vue:48` | 脚本 PAGE-06（含占位串残留检查） | ✅ | P0 |
| PAGE-07 | **生产未配 `NUXT_PUBLIC_ICP_BEIAN` 即拒绝启动**（空串静默不渲染 = 上线后全站无备案号） | `apps/web/server/plugins/icp-guard.ts`（Nitro 启动守卫：`throw` 阻断 + 逃生舱 `ONEFRAME_ALLOW_MISSING_ICP` 每次启动 WARN）；判据位置从 `nuxt.config` 改为进程启动期，因部署链是「构建产物 → systemd 注入 env」 | 脚本 PAGE-07 + `apps/web/server/utils/icp-format.spec.ts` **22 例**（空白归一化 3 / 真号 6 含 2 个排版变体 / 占位与错形 11 / 判据自检 2） | ✅ | P0 |
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
| **AI-05** | **产物级 mock 标记**（与 AI-01~04 同属标识体系，但对象是**文本产物**）：列 `episodes.llm_mock`、大纲 insert 与正文 update **两处**打标、`episodeDto.llm_mock` 进 API、导出 `manifest.json` 带 `llm_mock` | **语义分界（不可互相替代）**：`/v1/me.llm_mode` = **进程级**（这台机器在跑什么）；`episode.llm_mock` = **产物级**（**这份大纲是不是假的**）。切到 `real` 后 `llm_mode` 立刻变 `real`，而库里 mock 期生成的产物**依然是假的** —— 所以两个都必须有。契约 `api-spec.md:3548`；代码 `script.service.ts:122`、`worker/src/export.ts:144`；用例 `llm-mock-escape.spec.ts` 4 例（含按形态匹配 `llm_mock:\s*row\.llmMock`）+ `export-trim.spec.ts` 11 例 | ✅ 代码侧 + 部署侧均成立（2026-11-03 实测：`N12_EVIDENCE {"real":false,"mock":true,"ai_label_real":true,"ai_label_mock":true}`，临时库 `oneframe_verify` 跑真实 spec，业务库零写入） | P1 |
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
| OPS-12 | **对外前必须清除 mock 声明**：`ONEFRAME_ALLOW_MOCK_LLM` 不得存在，且 `/v1/healthz/ready` 的 `mockAllowed` 为 false、`llmMode` 为 `real` | 决策记录见 `07-plan/launch-gap-2026-11-03.md` §8；**端点优先、env 回退**，端点缺字段记为 SKIP 并说明（不得静默算通过） | `07-verify.sh` `STRICT=1` | ⏳（**机器可判定已成立**：`ready` 返回 `llmMode=mock`/`mockAllowed=true`，`/v1/metrics` 出两个 gauge；对外前清理仍待办） | P0（对外前） |
| OPS-14a | **mock 声明的「数据 + 产物」级**：`/v1/me` 根部返回 `llm_mode`；线上 JS 产物内含 `data-env-banner` 组件字面量 | 2026-11-03 实测：`/v1/me` → `llm_mode:"mock"`；线上 JS 产物命中 `data-env-banner`（**chunk 文件名随构建哈希变化，不写死**；以运行时查询为准，例：`cdSvCOk-.js` 是 06:52 那次构建的值）。**注意 curl 到此为止**：`/home` 是 `ssr:false`（`nuxt.config.ts:56`），匿名 HTML 命中恒为 0 | `07-verify.sh` ⑨ | ✅ | P1 |
| OPS-14b | **mock 声明的「渲染」级**（用户到底看不看得见）：登录态 `/home` 渲染后 DOM 出现 `[data-env-banner]`；不可关闭；375px 仍可见；`mock→real` 后消失；登出后消失 | 2026-11-03 实跑 **7/7 PASS**（真 Chrome + `playwright-core`，`_acceptance/_check-env-banner.cjs`）：登录横幅 1 个、关闭控件 0 个、375px 高 65px、`mock→real` 消失**（CDP 拦截注入，已标注）**、解除拦截后恢复、登出后消失。**模式=桩栈**（`_stub-api.cjs` 复刻信封与根部 `llm_mode`），不是真后端 | 真实浏览器 e2e | ✅（桩栈） | P1 |
| OPS-14c | **备案后对真实栈复跑 14b**：同一脚本换 `WEB`/`REDIS`（去掉 `SMS_CODE_CMD` 桩） | 桩栈验的是渲染逻辑，不能替代真后端联调；脚本已支持两模式，届时不改断言 | `_acceptance/_check-env-banner.cjs` | ⏳ | P1 |
| OPS-13 | ✅ **已通过（2026-11-03）**：登录 → refresh 往返 `http=201`，Cookie 被回传。判据从 `== 200` 改为 2xx（Nest 对 POST 返回 201；**过窄与过宽同样有害**） | **refresh Cookie 真实客户端回归**：`curl -c jar` 登录 → `curl -b jar -X POST /v1/auth/refresh` 必须 200；返回 401 说明 Cookie 未被回传（`Secure` 与 HTTP 不匹配） | `auth.controller.ts:332-341`：生产未显式设 `COOKIE_SECURE` 时默认 Secure → 纯 HTTP 下表现为「登录成功、刷新掉登录」。grep 配置值看不出这个 | 脚本化到 `07` | ⏳ | P1 |
| OPS-15 | **四产物新鲜度（含内部包）**：`api` / `web` / `worker` / **`packages/db`** 各自 ①内容 sha256 与本地构建基准双向核对 ②本次改动的可辨识标记；**时间戳只作提示，不作判据**；基准须绑定 commit sha，不一致即判红 | 2026-11-03 实测 `EXIT=0`：`api c7179506469fe0dc…(498)` / `worker 4a85e57bcbfc53e5…(26)` / `db 77834f2071675b7d…(12)` / `web a98505a0ff6c0fca…(947)` 全部 `ALL_MATCH`；摘要不跳过 `node_modules`。**过程中发现本地与线上不是同一次构建**（947 文件数相同、185 仅本地/185 仅线上、5 个内容不同）—— 处理方式是**重新构建并发布**让线上与本地一致，不是改基准迁就现状 | `07-verify.sh` `⑩` | ✅ | P1 |
| OPS-16 | **限流可用性可观测**（P2 观察项）：`/v1/metrics` 增加「限流计数不可用」计数器（如 `oneframe_rate_limit_unavailable_total`，在 `incrWithTtl` 的 catch 里自增） | 现状：`/v1/metrics` 共 9 条指标，`rate_limit\|ratelimit\|limit_fail\|redis_` 命中 **0**。`SEC-04` 的计数是 **fail-open**（Redis 抖动退化为不限流、但绝不拒绝正确密码）——设计正确，代价是**Redis 挂掉时这层防护静默消失，且当前无任何指标可观测**。**来源标注**：fail-open 行为是**读代码结论**，未做实测（Ops 不在共享机上停 Redis 做实验）。攻击者最省事的路径恰是先打挂 Redis，故需可观测 | `curl /v1/metrics` 见该计数器；模拟计数失败（如临时改 key 前缀）后数值增长 | ⏳ | P2 |
| OPS-10 | **部署后自检 7 条断言**（新构建 / 依赖清单 / APP_VERSION / lang 三断言 / `<loc>` 条数 / `compliance-check` 0 FAIL） | 2026-11-03 验收机实跑 **EXIT=0**：`/terms` 48174B + 标题命中、依赖 `PASS 24`（220 递归/16 顶层/0 符号链接）、`APP_VERSION` 一致、`/terms` 恒 `zh-CN`、`/report` 跟随 `Accept-Language`、sitemap `/terms` 仅 1 条 `<loc>`、`--runtime-only` 0 FAIL 且 `LOG-04` PASS | `app/deploy/verify-deploy.sh` | ✅ | P1 |
| LOG-01 | worker 日志脱敏（`access_token` redact） | `apps/worker/src/main.ts:15` | 脚本 LOG-01 | ✅ | P0 |
| LOG-02 | api 请求日志脱敏（不落 body/查询串/token；手机号掩码） | `common/logging/request-log.ts`（字段白名单 + `sanitizePath` + `maskPhoneLike`） | 脚本 LOG-02 + 测试 LOG-05 | ✅ | P0 |
| LOG-03 | request_id 中间件接入 AppModule 并回写响应头 | `app.module.ts`（`configure` → `RequestLoggingMiddleware`）、`request-logging.middleware.ts` | 脚本 LOG-03 | ✅ | P0 |
| LOG-04 | 响应头 `x-request-id` 与日志字段一致（运行态；判据 = **200 + `data.pong:true` + 头**，信封为 `{code,msg,data}`） | 2026-10-25 本地实测：`GET /v1/ping` → 响应头 `x-request-id: 86f9c2f6-…-c3b50c22a321`，同请求日志 `request_id` 同值、`status=200`、`duration_ms=5` | `node _acceptance/compliance-check.cjs`（服务未启动时该条 SKIP 并说明，不计失败） | ✅ | P0 |
| LOG-05 | 观测契约有测试守护（头=日志、脱敏、慢请求 WARN） | `apps/api/test/observability.spec.ts`（12 项） | `pnpm --filter @app/api test` | ✅ | P1 |
| SEC-01 | 运营后台口令 scrypt 加盐哈希 | `modules/admin/admin-auth.service.ts:1` | 脚本 SEC-01 | ✅ | P0 |
| SEC-02 | 分享 token 高熵随机 + 过期 | `modules/tasks/tasks.service.ts:313`（`randomBytes(24)`） | 脚本 SEC-02 | ✅ | P0 |
| SEC-03 | **生产产物不得出现默认口令字样，且默认口令不可作为凭据**（三档判据） | ① **客户端产物** `.output/public/_nuxt/*.js`：107 个 chunk，非零 **0**；② **SSR 产物** `.output/server`：`grep -ro` 命中 **0**；③ **服务端侧查“不可用作凭据”**：`POST /v1/ops/admin/login {admin, admin12345}` → `{"code":401101,"msg":"invalid username or password","data":null}`（按 `code==401101 && data===null` 判，**不看 HTTP 状态码**：该端点失败是 `200+401101`、成功才 201）；且 `NODE_ENV=production` 无 `ADMIN_PASSWORD` 时进程拒绝启动（部署树实测 11 项拒绝，`ADMIN_PASSWORD=admin12345` 时仍 11 项，真口令降到 10 项，差值正是该项） | **渲染级回归**（真浏览器，重发后重跑）：无障碍树仍有 `Ops console login` / `Username` / `Sign in to the ops console`，而 `Non-production defaults to admin / admin12345…` 段落**已消失**，a11y 文本 608B → 485B。**范围说明（重要）**：本条只覆盖 **web 客户端**；`apps/api` 全仓另有 **39 处**（3 处结构必需：`env.ts:288` 守卫对照值 + `admin-auth.service.ts:71` 注释 / `:74` 非生产兜底；17 处测试夹具 / 15 个文件）**是刻意保留、不是漏改** —— 审计时用仓库级 `grep -r` 会得到 39 而非 0，若顺手“统一清理”会同时打坏启动守卫与 15 个 spec | 部署侧 ①②③ + 离线守卫 `SEC-03`（5 语言包与登录页不得复现该字面量） | ✅ | P0 |
| SEC-04 | **密码登录失败限流** —— **P0 · 上线闸门，不随后补**（Chief 2026-11-03 明示）：`POST /v1/auth/login/password` 连续失败必须进入冷却 | ✅ **已实现**（`auth.service.ts:369-400`）：键 `auth:login:fail:<标识符哈希>:<ip>` **双维度**（只按账号可被用来锁死他人、只按 IP 可被僵尸网络绕过）；key 用哈希不用邮箱明文（Redis 常被 dump）；计数为**旁路 fail-open**（Redis 抖动退化为不限流，但绝不因此拒绝一次正确密码）；超限抛 `RATE_LIMITED`。参照口径 `admin-auth.service.ts:105` | 机器判据（脚本 `SEC-04`，**已收窄到 `loginWithPassword` 函数体**）+ **真栈已验**（2026-11-03）：连续错密码 #01–#10 → `401101`，**#11 → `429100`「登录失败次数过多，请稍后再试」**（阈值 10 / TTL 300s，键 = 标识符哈希 + IP；浏览器经 nginx 拿真实 IP，不会互相锁） | ✅ 代码侧 + 真栈 | P0 · 上线闸门 |
| SEC-05 | **邮件验证与密码找回**（P1，Chief 已定「找回密码」入口先不放，连灰按钮也不放）：注册发验证信、`reset-request` + `reset`（token 一次性且有时效） | **方案（Architect 2026-11-03 批准）**：先做**不绑厂商的发信抽象** `MailGateway.send(to, subject, text)`，CI 用本地假 SMTP 跑通链路，Key 到位只换 env（`MAIL_*`）——这样「忘密码即永久失号」在代码侧不是死路，且不引入外部依赖。**四条约束**：① 发信失败必须**显式报错**（不许静默成功），但对外统一回执「若该邮箱已注册，我们会发送」——**不泄露邮箱是否存在**；② 必须有**发信频控**（按邮箱 + 按 IP），否则接口会被当发信机；③ reset token 一次性、有时效、用后即失效；④ 发信故障**不得影响登录**（登录路径不依赖邮件通道）。**入口开放条件**：端点可用 + 假 SMTP 用例通过 + 频控生效，三者同时成立才可放出 UI 入口 | 假 SMTP 端到端：注册收验证信、reset 链接可用一次、二次使用被拒、同邮箱连续请求触发频控 | ⏳ | P1 |
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
| GAP-05 | ~~ICP 备案号为占位串、散落在 5 个语言包~~ → **已改为 env 驱动（2026-11-03，Frontend）** | 历史：占位串在 `i18n/locales/{zh-CN,en,ja,pt-BR,es}.json` 的 `landing.footerNote`（5 份，换号必漏）；**现状**：号段走 `runtimeConfig.public.icpBeian/icpPolice`（`nuxt.config.ts:39`）→ `components/SiteLegal.vue`，语言包里只留标签；运维下发 env 即可，无需重建 | 占位-漂移风险已消除 | EXT-03 取得后由 Ops 注入 `NUXT_PUBLIC_ICP_BEIAN`；守卫见 PAGE-07 | P0 |
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

---

## 7. 附录 A · 部署自检逐断言证据索引（2026-11-03 06:52 实跑；`rc=0`）

> 来源：验收机 `app/deploy/server/07-verify.sh`（20 PASS / 2 SKIP）。**一行一条：命令 + 判定值 + 结果**。
> 两处 SKIP 含义不同，**SKIP 不等于通过**：④ 是“验收机不对外、本项不适用”；⑧ 是“已显式声明在 mock、机器可判定但不得对外”。

| 断言 | 命令 | 判定值 | 结果 |
|---|---|---|---|
| ① 构建判别 | `curl -H 'Host: oneframe.zltik.top' http://127.0.0.1/terms` | `48349B` + `<title>用户协议·一帧</title>` | PASS |
| ① 路由差异 | 同上 `/pricing` | `40113B`（≠`/terms`，路由级渲染生效） | PASS |
| ① 正文 SSR | 同上 `\| grep '一、服务内容'` | 命中 1 | PASS |
| ① sitemap | `curl .../sitemap.xml` | `14069B(<16000)`、`terms_loc=1`、`terms_hreflang=1` | PASS |
| ② 存活 | `curl -o /dev/null -w %{http_code} / 与 /v1/ping` | `200 / 200` | PASS |
| ② LOG-04 | `curl -D - .../v1/ping` | `x-request-id` 存在 · `data.pong=true` | PASS |
| ③ 版本一致 | `diff api.env:APP_VERSION vs .release` | `staging-20261103` == 同值 | PASS |
| ④ 备案守卫 | `grep 逃生舱/备案号 web.env`（`STRICT` 未设） | 逃生舱=1、真号=0 | SKIP（预期） |
| ⑤ 合规门禁 | `API_URL=… node _acceptance/compliance-check.cjs --runtime-only` | `PASS 58 / FAIL 0 / SKIP 9`；`LOG-04=PASS` | PASS |
| ⑥ 依赖清单 | `node -e` 比对 `.output/server/package.json` | `PASS 24`；220 递归 / 16 顶层 / 0 符号链接 | PASS |
| ⑦ 语言钉死 | `curl -H 'Accept-Language: en-US\|ja-JP' /terms` | 均 `lang=zh-CN` | PASS |
| ⑦ 语言跟随 | 同上 `/report` | `en-US→en`、`ja-JP→ja` | PASS |
| ⑦ 权威提示 | `curl -H 'Accept-Language: en-US' /terms` | `authoritative legal text` 命中 1 | PASS |
| ⑦ sitemap 语言 | `curl .../sitemap.xml` | `/terms` 只 1 条 `<loc>` | PASS |
| ⑧ mock 判定 | `curl .../v1/healthz/ready` | `llmMode=mock mockAllowed=true`（来源=端点） | SKIP（预期：已显式声明） |
| ⑧ 登录 | `POST /v1/auth/sms-code` → Redis 取码 → `POST /v1/auth/login` | `access_token` 取得 | PASS |
| ⑧ Cookie 往返 | `curl -c jar` 登录 → `curl -b jar -X POST /v1/auth/refresh` | `http=201` 且 body 含 `access_token` | PASS |
| ⑨ 数据链 | `curl -H 'Authorization: Bearer …' /v1/me` | 根部 `llm_mode=mock` | PASS |
| ⑨ 组件已发布 | 运行时查询 chunk 后 `grep data-env-banner` | 命中 | PASS |
| ⑩ 基准来源 | `python3 compare_artifacts.py .artifacts.json` | `commit=5835575`、`generated_at=2026-11-03T06:50:25+0800` | PASS |
| ⑩ 四产物内容 | 同上 | `api c7179506…(498)` / `worker 4a85e57b…(26)` / `db 77834f20…(12)` / `web a98505a0…(947)` `ALL_MATCH` | PASS |
| ⑩ 可辨标记 | `grep dist` | api `ONEFRAME_ALLOW_MOCK_LLM`×6 + `listen(env.HOST)`；web `data-env-banner`；worker `llm_mock`×2 | PASS |

**使用说明**：本索引是 `OPS-10/12/13/14a/15` 的统一证据出处；外部项（EXT-）不受此覆盖，仍需回执/归档。
断言变更时**同时改表**，否则索引会与脚本漂移——这条与文档维护规则 3（里程碑对账）同源。
