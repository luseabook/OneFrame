# 合规上线清单可执行化 + request_id 结构化日志收口

> 日期：2026-10-25 · 责任人：compliance-ops（共享任务 task-3 → task-5）
> 范围：`apps/api` 请求日志与 request_id 串联、合规上线清单可执行化、05-ops / 06-security-compliance 文档收口
> 结论：**代码侧合规与可观测项已闭环并可复跑验证**（47/47 PASS）；**外部资质/密钥 20 项待人工办理**，P0 未清零前不得开放注册/生成/真实支付。
>
> ⚠️ **计数以文末「Round 5」章节为准**：清单与脚本已在 Round 5 对齐退款闭环/证书轮换/生产守卫，代码侧检查 **66 项**（无服务 65 PASS+1 SKIP；API 在跑 66 PASS）。本页 §1~§7 记录 Round 4 当时状态，保留作历史。

---

## 1. 本轮结论速览

| 项 | 结果 |
|---|---|
| 代码侧合规检查 | `node _acceptance/compliance-check.cjs` → **PASS 47 / FAIL 0**（另：服务未启动时 46 PASS + 1 SKIP，SKIP 为本地运行态探测，已说明原因） |
| api 单元/集成测试 | 全量 **128/128 通过**（13 个测试文件），其中新增 `test/observability.spec.ts` **12/12**（基线 70 项未回归） |
| 类型检查 / 静态检查 | `pnpm --filter @app/api typecheck`、`lint` 均通过 |
| 文档 | 新增 `launch-checklist.md`（上线唯一状态源）；`compliance.md` G 节改为引用它（消除双清单漂移） |
| 外部阻塞 | ICP 备案、公安备案、生成式 AI 服务备案、深度合成算法备案、供应商备案/DPA、支付商户号与证书、词库采购、发票/退款 SOP 等 **20 项**仍需人工办理 |

---

## 2. 发现的问题（现状 → 判断）

| # | 发现 | 证据 | 影响 |
|---|---|---|---|
| 1 | **request_id 只生成了 id，没有真正串联日志**：`main.ts` 有 `genReqId`，但没有任何中间件把 id 写回响应头或输出结构化请求日志；`observability.md` 仍把该项列为"应做" | 改造前 `apps/api/src/main.ts:17` 仅 `genReqId`；全仓库无 `NestMiddleware`/`configure(consumer)` | 用户报障无法凭响应头定位请求；5xx/慢请求无请求级证据 |
| 2 | **上线合规清单不可执行**：`compliance.md` G 节是 7 条人工勾选，无编号/证据/阻塞级别，也没有脚本复核 | 改造前 `compliance.md` §G | 无法在发布门禁上自动卡住，易"纸面合规" |
| 3 | **年龄声明未落库（真实合规缺口）**：`users.age_declared_at` 列与迁移都在，但建号事务**从不写入**该字段；`compliance.md` 原文却写"并留痕" | `packages/db/src/schema.ts:32`（有列）、`apps/api/src/modules/auth/auth.service.ts`（无写入） | 无法向监管/家长举证"何时确认成年"。已登记 GAP-01（P1），需 auth 模块 owner 补写（不在本任务可改范围） |
| 4 | **复合服务端细节**：Nest + Fastify 下 Nest 中间件拿到的是 Node 原生 req（`@fastify/middie` 注入），而 `AuthGuard` 把 `auth` 挂在 Fastify request 上 —— 直接写中间件**读不到** `user_id/space_id` | 本地探针实测：中间件 `req.constructor.name=IncomingMessage`、`has req.raw=false`；guard 内 `constructor.name=Request`、`has .raw=true` | 若不处理，"鉴权后记录 user_id/space_id"这条要求会静默失效 |
| 5 | 文档口径漂移：`deployment.md §4` 称根 `.env.example` 为"权威版"，实际该文件只有 2 个变量；`§7 定时任务`表格存在错行，把 `exports-cleanup` 挤进 `assets-expire` 一行 | `app/.env.example` 全文 3 行；`deployment.md` §7 表格 | 新环境易漏配（如 `AI_LABEL_ENABLED`、`MODERATION_WORDS`）；文档误导。已修正 |

---

## 3. 实现内容

### 3.1 A. request_id 结构化请求日志（真实实现，非纸面）

新增 `apps/api/src/common/logging/`（6 个文件，零新增依赖）：

| 文件 | 职责 |
|---|---|
| `request-log.ts` | 字段契约（`RequestLogRecord`）、request_id 解析与校验、路径脱敏、手机号掩码、状态→错误码映射、级别判定、记录组装 |
| `log-sink.ts` | `LogSink` 接口 + `REQUEST_LOG_SINK` / `REQUEST_LOG_CLOCK` 注入令牌；默认 sink 写 stdout 单行 JSON |
| `request-logging.middleware.ts` | Nest 中间件：进请求时定 id、回写 `x-request-id`、挂请求级上下文；`finish`/`close` 时输出单行 JSON |
| `request-log.interceptor.ts` | pass-through `APP_INTERCEPTOR`：guard 之后把 `user_id/space_id` 与 `error_code` 补进上下文（**不改响应、不吞异常、不抛异常**） |
| `logging.module.ts` | 提供 sink/clock/中间件/拦截器；导出中间件与令牌（Nest 从宿主模块解析中间件依赖） |
| `index.ts` | 公共出口 |

接线只改 `app.module.ts`（+`imports: [LoggingModule]`、`implements NestModule`、`configure()` 里 `forRoutes("*")`），**未触碰 `main.ts`**。

关键设计决策（均有取舍理由）：

1. **为什么用 interceptor 补鉴权字段**：中间件只拿得到原生 req，guard 把 `auth` 挂在 Fastify request 上，两者只在 `request.raw` 处相通。故中间件把上下文挂在 `raw`，interceptor 在 guard 之后读取 `request.auth` 回填 —— 只读、直传、不改变任何响应或异常语义。
2. **路径用 `originalUrl` 而非 `url`**：middie 会把挂载前缀从 `req.url` 剥掉（实测日志里 `path` 变成 `/`），`originalUrl` 才是完整路径。
3. **查询串一律不记**，并对路径做两级脱敏：32+ 位不透明段（分享 token）记 `:redacted`，手机号掩码 `138****8000`，UUID 保留（排障需要且非凭证）。
4. **探针端点不写日志**（`/v1/healthz*`、`/v1/metrics`）：k8s 每 5–10s 探一次，写日志会把业务请求挤出保留窗口；**响应头仍照常回写**。
5. **级别**：`status >= 500` 或 `duration_ms > 2000` → `warn`，其余 `info`；`error_code` 与信封 code 同源（业务错误取 `AppError.code`，如 745801/745802；HTTP 错误按状态映射）。
6. **aborted 判定以 `finish` 事件为准**（不依赖 `writableFinished`）：首版用 `writableFinished` 时在测试 harness 里**每条日志都误判 `aborted:true`**，被新增测试抓到后改为 `finish` 事件标记 —— 这类假阳性正是"纸面日志"最容易带病上线的地方。

### 3.2 B. 合规上线清单可执行化

- **`docs/06-security-compliance/launch-checklist.md`（新）**：分两大区 ——
  「外部资质/密钥（EXT-01…EXT-20，人工办理）」与「代码侧（PAGE/AGE/MOD/REP/DEL/PIPL/AI/PAY/OPS/LOG/SEC/DOC 共 47 条，脚本逐条验证）」，
  每条含**编号 / 事项 / 类型 / 证据 / 验收方式 / 状态 / 阻塞级别 P0-P2**；另有「需人工/真机抽验」「72h 演练 D1–D9」「已知缺口 GAP-01~06」「一键复核命令」。
- **`_acceptance/compliance-check.cjs`（新）**：纯 Node 内置模块（`fs`/`path`/`http`），**无网络外部依赖、无 npm 依赖**；
  逐条输出 `PASS/FAIL/SKIP` + 证据（`文件:行` / 端点 / 命令）+ 汇总 + 非零退出码。
  覆盖：4 个法务页面与页脚三链路、ICP 占位、年龄门禁（前后端）、745801/745802 双端审核、举报端点与处置留痕、下线即撤销分享、账号注销与 30 天清理、PIPL（隐私政策要素/手机号加密/Cookie 属性）、AI 显隐双标识与生产默认开启、支付回调默认拒绝 + 防重放 + 生产禁 mock、healthz live/ready + /metrics、备份/恢复/校验/回滚脚本、优雅停机、日志脱敏（worker redact + api 字段白名单）、request_id 接线与运行态探测、分享 token 熵与过期、文档一致性（含"外部项不得纸面打勾"的自检）。
  设计要点：字符串 pattern 按**正则**处理（初版按字面量转义导致 24 项假阴性，已修正）；`--quiet` 只打印非 PASS；运行态探测在服务未启动时 SKIP 并说明原因（不计失败）。

### 3.3 C. 文档同步

| 文件 | 变更 |
|---|---|
| `docs/05-ops/observability.md` | 重写 §1：request_id 规范（生成/沿用/回写/一致性/跨服务）、**请求日志字段表**（12 字段含类型/必填/来源）、禁记清单、级别与告警口径、保留与合规；新增 §7「上线前观测自检」（对应 LOG-01~05） |
| `docs/05-ops/deployment.md` | 修正 §4 环境变量模板口径（GAP-03）；修正 §7 定时任务表错行并改号 §7.1（GAP-06）；补 worker 定时任务实现现状；新增 **§8 上线前 72h 运维演练清单 D1–D9**（支付回调失败/对账/回滚/备份恢复/优雅停机/告警/容量/值班/未成年人误充）+ 排障串联说明 |
| `docs/06-security-compliance/compliance.md` | G 节改为**引用** `launch-checklist.md` 并给出当前门槛快照；修正"年龄声明已留痕"的不准确表述，指向 GAP-01；版本号升 v1.2 |

---

## 4. 验收证据（可复跑）

```bash
# 1) 代码侧合规（服务未启动：46 PASS / 0 FAIL / 1 SKIP）
node _acceptance/compliance-check.cjs

# 2) 代码侧合规（api 在跑：47 PASS / 0 FAIL / 0 SKIP）
API_URL=http://127.0.0.1:3000 node _acceptance/compliance-check.cjs

# 3) api 测试（含新增 observability 契约测试）
$env:DATABASE_URL='postgres://app@127.0.0.1:55432/app'; $env:REDIS_URL='redis://127.0.0.1:6380'
$env:NODE_ENV='test'; $env:SMS_IP_HOURLY_LIMIT='100000'
pnpm --filter @app/api test

# 4) 类型检查 / 静态检查
pnpm --filter @app/api typecheck ; pnpm --filter @app/api lint
```

本次实测记录：

- **请求日志（运行态，临时起 `PORT=3099`）**：`GET /v1/ping` → 响应头
  `x-request-id: 86f9c2f6-b8b7-4e0d-8987-c3b50c22a321`，同请求日志
  `{"time":"2026-10-24T20:22:19.713Z","level":"info","msg":"http_request","request_id":"86f9c2f6-…-c3b50c22a321","method":"GET","path":"/v1/ping","status":200,"duration_ms":5}`
  —— 响应头与日志 `request_id` **同值**，未鉴权请求不含 `user_id/space_id`（符合预期）。探针验证后已停止该临时进程（端口已释放）。
- **鉴权后串联**：登录后 `GET /v1/me` 的日志含 `space_id`/`user_id`（测试断言，见 `observability.spec.ts`）。
- **敏感信息**：带 `?phone=13800138000&token=…` 与含 `password`/`Authorization`/`Cookie` 的请求，日志整行 JSON 中均**不出现**这些值，也无 `body/query/authorization/cookie` 字段；路径中手机号被掩码、36 位分享 token 段记 `:redacted`。
- **级别**：单测注入假时钟验证 `2500ms → warn`、`status 500 → warn + error_code 500000`；`finish`/`close` 重复触发只出一条；客户端中断补 `aborted:true`。

---

## 5. 外部阻塞项清单（脚本无法验证，须人工办理）

> 完整字段（证据/验收/状态/级别）见 `launch-checklist.md` §1。**P0 未清零不得对外开放**。

**P0（开放注册/生成/AI 服务前必须全部到位）**
1. EXT-01 公司主体（营业执照经营范围）
2. EXT-02 域名注册与实名（www/app/api/static）
3. EXT-03 ICP 备案号（当前页脚为占位 `京 ICP 备 00000000 号`）
4. EXT-05 公安联网备案号 + 备案图标
5. EXT-06 **生成式人工智能服务备案**（受理回执/编号）
6. EXT-07 **深度合成服务算法备案**
7. EXT-08 供应商模型备案证明（与 `model-adapters` 启用清单逐一对应）
8. EXT-15 用户协议/隐私政策**律师审阅**

**P1（首次真实商业收费前必须）**
9. EXT-04 ICP 经营许可证（EDI）
10. EXT-09 供应商 DPA/委托处理协议
11. EXT-10 微信支付商户号 + APIv3 密钥 + 平台公钥
12. EXT-11 支付宝应用 + 公钥
13. EXT-12 短信签名与模板报备
14. EXT-13 内容安全词库（≥5000 词，当前仅内置 8 词）
15. EXT-14 发票能力（诺诺/百望）或人工开票流程
16. EXT-16 支付类目报备（软件服务/虚拟商品）
17. EXT-19 未成年人误充退款与监护申诉通道

**P2（试运营期内补齐）**
18. EXT-17 等保 2.0（二级）定级备案/测评
19. EXT-18 Sentry 境内/自建部署（禁境外 SaaS）
20. EXT-20 数据出境评估（当前全链路境内，无出境）

---

## 6. 风险与遗留

| 风险 | 说明 | 建议 |
|---|---|---|
| **并发任务导致的测试噪声** | 本轮联调期间全量套件出现过 1 项瞬时失败（`test/billing-notify.spec.ts` 的渠道字段断言，属 billing 任务在写的特性）与一个他人临时文件 `test/tmp-probe2.spec.ts`；**最终复跑 128/128 全绿**。教训：发布门禁必须在无并发改写时执行 | 发布前 `git status` 确认无他人未完成改动，再跑全量套件 |
| GAP-01 年龄留痕未落库 | 需在 `auth.service.login()` 建号事务写 `ageDeclaredAt`，属 auth 模块，不在本任务可改范围 | 指派 auth owner，1 行改动 + 1 条断言 |
| GAP-02 词库规模 | 内置仅 8 词，拦截面窄 | 采购词库 + `MODERATION_WORDS` 注入，抽验 20 条正负样本 |
| 请求日志告警尚未接采集端 | 日志已是单行 JSON 并可 `level=warn` 区分，但告警规则需在 SLS/Loki 侧配置 | 按 `observability.md §1.3` 配 5xx>1%、慢请求两种规则 + 演练 D6 |
| 探针端点不写日志 | 属刻意取舍，若排障需要可临时把 `SKIP_LOG_PATHS` 置空 | 文档已注明；如需开关可后续加环境变量 |
| `error_code` 语义 | 业务错误（HTTP 200 + 信封非 0）通过 interceptor 捕获，`status` 与 `error_code` 会"看起来不匹配"（200 + 745801） | 已在字段表与示例里写明，避免值班误判 |
| **`_acceptance/` 被 .gitignore 忽略** | 仓库根 `.gitignore` 第 35 行忽略整个 `_acceptance/`（历史约定，其余验收脚本同样不在版本库内），因此 `compliance-check.cjs` 不会随提交进入仓库 | 若要把该检查接入 CI 门禁，需在 `.gitignore` 加例外（如 `!_acceptance/compliance-check.cjs`）并把脚本纳入版本控制；本次未改 `.gitignore`（不在本任务可改范围） |

---

## 7. 文件清单

**新增**
- `app/apps/api/src/common/logging/request-log.ts`
- `app/apps/api/src/common/logging/log-sink.ts`
- `app/apps/api/src/common/logging/request-logging.middleware.ts`
- `app/apps/api/src/common/logging/request-log.interceptor.ts`
- `app/apps/api/src/common/logging/logging.module.ts`
- `app/apps/api/src/common/logging/index.ts`
- `app/apps/api/test/observability.spec.ts`（12 项）
- `docs/06-security-compliance/launch-checklist.md`
- `_acceptance/compliance-check.cjs`
- `deliverables/software-company/compliance-launch-and-observability-2026-10-25.md`（本文件）

**修改**
- `app/apps/api/src/app.module.ts`（仅 `imports` + `configure()` 注册日志中间件）
- `docs/05-ops/observability.md`（§1 规范化 + §7 自检）
- `docs/05-ops/deployment.md`（§4、§7 修正；新增 §8 演练清单）
- `docs/06-security-compliance/compliance.md`（G 节改引用 + 年龄留痕表述修正）

**未触碰（他任务范围）**：`apps/api/src/main.ts`、`apps/api/src/config/env.ts`、`apps/api/src/modules/billing/**`、`apps/api/src/db/seed.ts`、`packages/db/**`、`packages/model-adapters/**`、`apps/worker/**`、`apps/web/**`、`pnpm-lock.yaml`、`docs/01-product|02-architecture|07-plan/**`。
未执行任何 git commit/push；未启停 PostgreSQL(55432)/Redis(6380)。

---

# Round 5 · 清单对齐（2026-10-25，task-5）

> 背景：task-1（真实支付渠道/回调/收银台）与 task-4（退款闭环/微信平台证书轮换/生产启动守卫）落地后，
> 原清单与脚本出现漂移（PAY-01 检查已失效 1 项）。本轮只改**文档 + `_acceptance/compliance-check.cjs`**，未改任何业务代码。

## R5.1 漂移修复与 GAP-01 关闭

| 项 | 结果 |
|---|---|
| **PAY-01 漂移（已修）** | 微信回调不再直接读 `WECHAT_PLATFORM_PUBLIC_KEY`，改为 `hasWechatPlatformKeys` → `fail(401, "wechat platform public key not configured")` + 渠道解析 `missing`。脚本 PAY-01 已按新实现重写，并补上"凭据缺失计入 missing"的证据 |
| **GAP-01（CLOSED）** | Lead 已在 `auth/auth.service.ts:120` 建号事务写入 `ageDeclaredAt: new Date()`，`test/flow.spec.ts:71` 增加 `toBeInstanceOf(Date)` 断言。清单 AGE-03 由"仅建表"升级为**字段 + 写入 + 回归断言**三段验证；GAP-01 标记 ✅ 已关闭并保留历史说明 |
| 代码侧条目 | **47 → 66 项**（+19：退款 8、证书轮换 4、生产守卫 4、验收闭环 3） |
| 外部资质项 | 仍为 **20 项**（无新增、无虚构完成；EXT-10 补充"轮换期双证书"要求，EXT-19 指向新 E3 口径） |

## R5.2 新增代码侧条目（与脚本一一对应）

| 段落 | 新增编号 | 覆盖内容 |
|---|---|---|
| 退款闭环 | PAY-05~PAY-12（8 项） | 管理端退款端点（AdminGuard）、仅全额、已退款幂等、余额不足**调渠道前**拒绝（保护 `balance == Σdelta`）、渠道失败事务回滚、`kind=refund` 负向流水（`creditOut`）、迁移 `0009` 退款字段、退款回归测试（`refunds.spec.ts` + `refunds-wechat.spec.ts`） |
| 微信平台证书轮换 | PAY-13~PAY-16（4 项） | `WECHAT_PLATFORM_PUBLIC_KEYS` 多证书映射、按 `Wechatpay-Serial` 精确选公钥、未知 serial → 401、无 serial 兼容回退、轮换回归测试 |
| 生产启动守卫 | OPS-06~OPS-09（4 项） | api `collectProductionProblems`/`buildEnv`（弱默认密钥、缺 `COOKIE_SECURE`、支付凭据半配 → 拒绝启动，聚合报错不含密钥值）+ 测试；worker 禁 `ADAPTER_MODE=mock` 且需真实供应商 + 测试 |
| 全量验收闭环 | ACC-01~ACC-03（3 项） | `_acceptance/b-type-acceptance.ps1` 五阶段齐备、串接本合规检查（单一口径）、覆盖退款闭环与生产守卫正反例 |

清单结构同步更新：新增 §1.1「E3 未成年人误充退款口径」（全额退款 API / 未消耗余额人工 / 发票仍外部 / 异步结果人工对账）、
§6「如何跑验收」（6.1 两分钟离线自查、6.2 全量验收脚本参数与阶段表、6.3 发布闸门顺序）；
D3 演练补充"未知 `Wechatpay-Serial`"手法，D9 演练改为全额退款 API + 幂等判据；
GAP-04 更新（退款 SOP 已有，仅发票/客服外部能力缺）；新增 GAP-07（仅全额、无部分退款）、GAP-08（渠道退款异步结果未自动回收）。

## R5.3 检查结果计数（两种模式自测）

```bash
node _acceptance/compliance-check.cjs                                  # 无服务
API_URL=http://127.0.0.1:3099 node _acceptance/compliance-check.cjs    # api 临时起在 :3099
```

| 模式 | 结果 | 退出码 |
|---|---|---|
| 服务未启动 | **PASS 65 / FAIL 0 / SKIP 1**（共 66；SKIP = LOG-04 运行态探测，已说明原因） | 0 |
| API 在跑（:3099，实测后已杀进程、端口已释放） | **PASS 66 / FAIL 0 / SKIP 0**（共 66） | 0 |

清单与脚本条目**一一对齐**（核对结果：66 条清单行 = 65 条静态 `check()` + 1 条运行态 `LOG-04`，无缺无多）。
外部资质/密钥待办仍为 **20 条**（P0 8 / P1 9 / P2 3），未清零前不得开放注册/生成/真实支付。

## R5.4 仍缺的外部项与已知限制（不虚构）

- **外部资质（20 项全部未完成）**：ICP 备案号仍为页脚占位；生成式 AI 服务备案、深度合成算法备案未受理；供应商模型备案证明与 DPA 未归档；微信/支付宝商户号与证书、短信签名、词库采购、发票能力、支付类目报备、未成年人客服通道均待办理。
- **GAP-07 仅全额退款**：积分已部分消耗时无部分退款 API，只能按未消耗余额人工协商；若商业化需要，需另立"部分退款 + 按比例回冲流水"需求（涉及账单口径与渠道协议）。
- **GAP-08 渠道退款异步结果未自动回收**：微信/支付宝受理后 `refund_status=processing`，需运营在商户平台人工对账确认；建议 Ph2 加退款结果查询任务并纳入 `/metrics`。
- **CODE-H4/H5**：真实渠道 1 分钱全链路（含退款）与对账 24h 连续性验证仍依赖真实商户号与生产流量，脚本只能覆盖 mock 同路径。
- **本文件不构成任何合规完成声明**：外部项与真实渠道验证未完成前，仅代码侧门禁可自动复核。

## R5.5 本轮改动文件

- `docs/06-security-compliance/launch-checklist.md`（v1.0 → v1.1：+19 条、§1.1 E3 口径、§6 验收指南、D3/D9/GAP 更新、GAP-01 CLOSED）
- `_acceptance/compliance-check.cjs`（+19 条检查：PAY-05~16 / OPS-06~09 / ACC-01~03；重写 PAY-01、AGE-03；新增目录迁移文件定位助手 `matchingPath`）
- `docs/06-security-compliance/compliance.md`（E3 口径精确化 + G 节快照计数 47→66、补退款/轮换/守卫）
- `docs/05-ops/deployment.md`（§8 演练表 D3/D9 判据对齐退款与证书轮换；§7.2~7.4 由支付任务提供，未重复造文档）
- `deliverables/software-company/compliance-launch-and-observability-2026-10-25.md`（本 Round 5 章节）

未执行 git commit/push；未启停 PostgreSQL(55432)/Redis(6380)；临时 api 实例（:3099）仅用于运行态校验，已终止。
