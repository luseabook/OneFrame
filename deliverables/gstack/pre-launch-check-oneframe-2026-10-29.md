# 一帧 OneFrame 上线前全检报告

**日期**：2026-10-29
**场景**：发布前全检（代码审查 + 安全审计 + QA 测试）
**参与成员**：产品评审员（代码质量）+ 安全官（OWASP/STRIDE）+ QA 门神（门禁实测与链路走查）
**审查对象**：`E:/wanxing`，HEAD `bd4d9cc`，基线 `8e25f53`（2026-10-26 F0 验收）→ HEAD

---

## 📌 TL;DR

- **整体结论：🔴 No-Go（不可上线）**
- 阻塞项 **6 条 P0**，其中 2 条属于"上线即出事"级别：生产编排**根本起不来**、支付通道 **fail-open**（任何人可自助刷积分）
- 另 2 条纯代码资金缺陷无开关可关：**取消任务后积分被二次解冻**、**注销账号永久搁浅冻结积分且对账查不出来**
- 最硬的一条非代码事实：本地 `main` 领先 `origin/main` **149 个提交从未推送**，CI 最后一次验证停在 `d22b2c2`（10-26）——这次上线**没有任何自动化门禁背书**
- 好消息：代码底子明显高于平均线（`any` 仅 3 处、lint 0 error、200 个用例实测全绿、资金账本行锁+双向流水设计严谨），**不需要推倒重来，是"边角状态没接上"**那类问题
- ⚠️ 但这两件事不相抵：**那 200 个全绿用例对 6 条 P0 一条都没覆盖**（全在连库/连队列路径上）。"测试绿"与"能上线"是本次两个独立结论，**不是因果**

---

## 🎯 核心结论卡片

| 项目 | 内容 |
|------|------|
| Go / No-Go | 🔴 **No-Go** |
| 严重度分布 | P0 × 6 / P1 × 17 / P2 × 18 |
| 关键行动项 | 8 条（6 条 P0 级：5 项修复 + 1 项预发实测；2 条 P1 排期） |
| 三位专家结论 | QA：No-Go ｜ 安全官：No-Go ｜ 产品官：修完 P0 后可放行 |
| 建议负责人 | 后端 1 人（资金链路）+ 运维 1 人（编排/密钥）+ QA 1 人（预发复验） |
| 转 Go 预估 | P0 全修 + 预发补测通过，约 2–3 人日 |

---

## 1. 各成员核心结论

### 🔍 产品评审员（代码质量与回归面）

- **核心判断**：骨架可靠，风险集中在"第二路径漏一刀"——主路径写得极细，终态/取消/升级/并发这些边角没接上，**五条里有四条落在钱上**。
- **关键发现**：`executor.fail()` 的终态守卫只挡 `SUCCEEDED|FAILED`，而同一文件的 `succeed()` 挡了三个终态（含 `CANCELED`）——**一墙之隔的不对称，判定为漏写而非设计**。
- **质量基线**：`pnpm -w lint` 0 error / 30 warning；`api build` 通过；`web build` 通过（7.24 MB / 1.68 MB gzip，生成 sitemap+robots）；`any` 仅 3 处、`@ts-ignore` 10 处。
- **特别提醒**：web 端 62k 行**零单测**（`test` 是恒真桩），本轮已修的 3 个 P0/P1 全靠人工 QA 发现——这是比任何单条 P1 都更值得排期的结构性技术债。

### 🛡️ 安全官（OWASP Top 10 + STRIDE）

- **核心判断**：**IDOR/BOLA 覆盖底数是 A+B 共 111/448（24.8%）带参路由的归属校验被逐行或经统一入口证过；余 337/448 仅 grep 形态检查，未证否亦未证有**（controller 50 / 路由 774 / 带参路由 448 / `@Param()` 679）。这条**不能**用来平衡 F-01——覆盖只有四分之一，且 F-01 的洞在"节点 `params` 里的 URL"而非"id 归属"，不同维度。**`sql.raw` 穷举 5 处无注入**（`canvas-group.service.ts:146/158/190/215` + `film.fields.ts:364`）、**无硬编码真实密钥**、**支付验签默认拒绝**——这几项做得比多数同类产品好；但"配置型 fail-open"和"服务端请求伪造"是真空洞。
- **最严重**：canvas 批量下载从用户可写的 `node.params.result_uri` 直接 `fetch(uri)`，无 scheme/host 白名单、无超时、无大小上限 → 云元数据凭据窃取 + 内网探测 + 内存耗尽。
- **放行前提**：`PAYMENT_LIVE` 进守卫、compose 补必填密钥、守卫加占位符黑名单、SSRF 加白名单。
- **诚实边界**：`pnpm audit` 因镜像无 audit 端点**未能执行，未核实任何 CVE**；全部结论为静态推演，无运行时复现。

### ✅ QA 门神（门禁实测 + 链路走查）

- **核心判断**：200 个用例实测全绿（含 ffmpeg 时间线合成、看门狗、支付验签），但**77 个 DB e2e（85%）在本机跑不了**——"lint/build 绿"不能等同于"后端回归通过"。
- **最严重**：`creditsFrozen` 全仓**从插入后再未写回过 0**，导致"是否已释放冻结"这个语义从未被表达，`> 0` 判定恒真；叠加 `fail()` 漏 CANCELED，取消任务必然二次解冻。
- **9 条链路走查（覆盖主业务流水线，⚠️ 盲区必须一起读）**：6 条在我读过的路径内未发现断点（非穷举），2 条有明确断点 ⚠️（生成任务、团队权限），**1 条功能闭环但承载 3 项缺陷**——「导出交付包」同时是 **P0-F01（SSRF）**、**P2-F25（drawtext 注入，生产不可达）**、**P2 纵深防御缺口（`readClipSource` 读任务不带 spaceId，靠写入口拦）** 的载体，故**不计入"未发现断点"，且不得出现任何"导出链路正常"的表述**。
- **⚠️ 覆盖边界（这条比上面更重要）**：这 9 条链路是从**主业务流水线**推出来的（注册→小说→立项→集→分镜→生成→资产→导出→计费→团队→后台），**`canvas` / `tools` / `create` 这一系列创作表面根本不在走查计划里**（canvas 一族就有 73 条带参路由）——而本次**唯一的 P0（PR-04）和 F-25 全都落在 canvas 系**。盲区的形状不是"读了没读完"，是"**根本没排进计划**"。因此"QA 走了 9 条主链路"**不能**被读成对全站的覆盖。
- `/**team** hydration 修复**已真覆盖**；资产上传在 **local 驱动安全、生产 S3 驱动有存储型 XSS 面**。
- **结论翻转**：初判"条件 Go"，复核代码层后**降级 No-Go**，理由是 P0 是纯代码缺陷、无开关可关。

---

## 2. 综合审查发现（去重合并，按严重度）

### 🔴 P0 — 阻塞上线（5 条）

| # | 类别 | 位置 | 问题 | 后果 | 来源 |
|---|------|------|------|------|------|
| **PR-01** | 部署 | `docker-compose.prod.yml`（全文 grep 零命中）+ `apps/api/Dockerfile:16` | 生产编排**未透传** `PHONE_HMAC_PEPPER`/`PHONE_ENC_KEY`，且无 `env_file`，容器只拿到 `NODE_ENV=production` | `env.ts:289-301` 生产守卫直接抛错拒绝启动 → api 容器 CrashLoop，migrate 之后全断。**说明这份 compose 从未被真跑过** | 安全官 F-04（主理人复核） |
| **PR-02** | 资金 | `billing.controller.ts:376-393`、`:82`、`billing.service.ts:640-646`；`.env.production.example:64` | `PAYMENT_LIVE` 默认 false、compose 未传、守卫不检（`env.ts:284-320` 无此项）；`@Public()` 的 `notify/mock` 仅在 `PAYMENT_LIVE=true` 时 403，**无签名、无鉴权、无参数约束**；`amountCents` 仅在 `!== undefined` 时才比对金额 → **请求方直接省略该字段即可完全跳过金额校验**；`markPaid` 按 `id+channel` 查，**无 spaceId** | 按样例部署的生产实例 = **mock 支付敞口**：登录用户下单后自己调匿名端点即入账，卡密/邀请制收费模型被绕过；叠加 P1-14 可替**他人订单**入账且完全静默 | 安全官 F-02 + QA P0-1（主理人复核） |
| **PR-03** | 资金 | `apps/worker/src/executor.ts:270`、`tasks.service.ts:221-234`、`ledger.ts:112` | `fail()` 守卫漏 `CANCELED`；`creditsFrozen` 全仓 **5 处写入全是 insert 初值、0 处归零**，而**解冻点有 8 处**（fail / succeed / cancel / watchdog / 入队失败退款 / 账号注销脱敏 / 广告剧 2 处）——没有一个把余额标记为"已释放"；`unfreezeCredits` 只校验 space 级 `frozen >= cost`，不按 taskId 幂等 | `cancel()` 只放开 PENDING/RUNNING（正是 worker 在跑的任务）→ 取消退一次，120s 后 `fail()` 再退一次。无同 space 冻结时抛 `underflow` 事务回滚 job 崩；有则**静默多退、凭空造积分** | 产品官 P0-1 + QA P0-2/P0-3（主理人复核） |
| **PR-04** | 安全 | `canvas-download.service.ts:246-249`（uri 来自 `canvas.controller.ts:40` `params: z.unknown()`） | `if (/^https?:\/\//i.test(uri)) { await fetch(uri) }` —— 无 host 白名单、无内网 IP 黑名单、无超时、无大小上限，结果打进 zip 可回读 | SSRF：读云元数据凭据 / 探测内网 `api:3000`·`postgres`·`redis` / 单请求全内存 zip 打满 | 安全官 F-01（主理人复核） |
| **PR-05** | 安全 | `.env.production.example:7,9,10,14,24,25`、`env.ts:209-214` | 守卫的 `INSECURE_DEFAULTS` 只认 4 个 `dev-only-*`，样例给的是 `change-me-*` / `minioadmin`，长度全部满足 `min(16)`/`min(8)` → **全部通过守卫**；admin 与用户共用 `JWT_SECRET` | 照抄模板上线 = 公开已知密钥 → 伪造任意用户 token，且可直接伪造 **admin token**；MinIO 口令已知 | 安全官 F-03 |
| **PR-06** | 资金/对账 | `auth.service.ts:369-372`、`maintenance.ts:103`、`:392-403` | 注销时把用户任务置 `status: 5` 但**不调 `unfreezeCredits`**。三重失效：看门狗只扫 `status in (1,2)` → 永不再处理；`frozen` 永久悬着；**`auditLedger` 结构上查不出来**——它的不平判据是 `a.frozen <> Σ(f.frozen_delta)`，而注销只改状态没动流水，`freeze` 的 `+X` 与 `frozen` 里的 X **两边仍相等，被判为平账** | 用户注销后这笔冻结积分永远卡死，"钱消失了"且全库对账全绿 → **对账机制本身失去发现的可能**。修法必须是「先按流水 unfreeze 再归零」，只加一句 `creditsFrozen: 0` 会把"还悬着的钱"这个事实抹掉，流水与字段永久对不上 | 产品官 + QA P0-4 |

> **PR-02 的边界（别误读）**：金额校验这个洞**只存在于 mock 链路**——微信/支付宝的金额来自渠道签名载荷（`billing.controller.ts:358` / `:386`），攻击者无法省略，真实渠道没有这个洞。但"能自助刷积分"这件事**不因之减轻**，因为生产默认就是 mock 渠道（compose 未传 + 样例 false）。

### 🟠 P1 — 建议上线前修复（17 条，按主题归类）

**资金与账务（7 条）**

| # | 位置 | 问题 |
|---|------|------|
| 1 | `tasks.service.ts:269` | `DELETE /tasks/:id` 判据 `creditsFrozen > 0` 恒真 → 任何计价>0 的任务**永久删不掉**。该端点测试覆盖其实是**完整的**（`task-delete.spec.ts` 5 个用例，`:210-215` 明确断言"带冻结必须拒删=400101"是正确行为）；真正的问题是成功态夹具编码了生产永不出现的 `creditsFrozen: 0`（`:78`），用例只在"线上不可能出现的状态"下通过——**比零覆盖更危险，它会教会后来者错误的默认值** |
| 2 | `tasks.service.ts:289-292` | `retry` **无 origin 状态校验**（`regenerate` 在 `:580-584` 有），对 RUNNING 任务重试 = 二次冻结；`dedupeKey` 使连点幂等，只多一次 |
| 3 | `billing.service.ts:395-409` vs `:171-172` | 升级**报价按剩余天数折抵、履约却追加整周期** → 月卡第 1 天升级 = 付差额拿 59 天，权益泄漏 |
| 4 | `ledger.ts:59`、`admin.service.ts:327-341` | `freezeCredits` 无正数整数守卫；`updatePrice` 把 body 裸丢 `.set()` → 负价目可"生成"积分 |
| 5 | `team.service.ts:929-949` vs `:1021-1040` | 分配/回收**锁序相反**（团队→成员 vs 成员→团队）→ Postgres 40P01 死锁 |
| 6 | `team.service.ts:914` + `:993` | `creditsQuota` **事务外读、事务内写** → 并发批量分配丢更新 |
| 7 | `billing.service.ts:656-658` | 关单后收到"支付成功"回调被判 `order not payable`；`reconcileOrders` 只补缺流水的单，不读渠道实际结果 → **用户付钱不到账**，只能人工对账 |

**安全（7 条）**

| # | 位置 | 问题 |
|---|------|------|
| 8 | `auth.service.ts:344-349` | `/auth/renew` **完全跳过 Redis 撤销检查** → 被窃 refresh cookie 可在 14 天内无限续 access，不可撤销 |
| 9 | `auth.guard.ts:37-53`、`stream-token.ts:33-46` | `stream_token` 被当**万能 Bearer** 用 120s（只验 aud 不校路由），且 nginx 日志记录含该参数的完整 URI |
| 10 | `main.ts:15-50`、`deploy/nginx.conf` | 全站**无安全响应头**（无 CSP/X-Frame-Options/HSTS）；nginx `client_max_body_size 12m` 与 API `bodyLimit 48MB` 不一致 |
| 11 | `nginx.conf:16`、compose `:12` | 仅 `listen 80` 无 TLS；`COOKIE_SECURE: ${COOKIE_SECURE:-false}` 让"必须显式设置"的守卫被默认值架空 |
| 12 | `health/metrics.controller.ts:22-24` | `/v1/metrics` `@Public()` 且 nginx 全量反代 → 任务量/失败率/资金异常指标公开 |
| 13 | `admin.controller.ts:84-89`、`admin-auth.service.ts:22-28` | 后台登录**无限流** + `scryptSync` 同步阻塞事件循环 → 爆破 + 低成本 DoS |
| 14 | `billing.controller.ts:376` `@Public()` + `billing.service.ts:640-644` | **mock 通知端点无归属校验**：匿名 `POST /v1/billing/notify/mock` 可把**任意 space** 的 `channel='mock'` 订单标记已付；任意登录用户也可调 `mock-pay` 确认**他人** mock 订单——被攻击者恰好有 pending 订单时即"被替别人付款"。定级 P1 而非 P0 的理由：订单 id 是 snowflake 62 位非自增、无法枚举，需先获得目标 id。修法：`markPaid` 接收 `spaceId` 并对 mock 渠道强制校验 |

**前端与可用性（3 条）**

| # | 位置 | 问题 |
|---|------|------|
| 14 | `nuxt.config.ts`（全文无 `/share`） | `/share/[token]` 声明 `ssr:false` 但缺 routeRule —— 与第 105 批 `/team/**` 同类缺陷；分享页**最容易被匿名直开**，首帧不一致即整页空白 |
| 15 | 6 处 workspace 组件（`VideoGenWorkspace.vue:292` 等） | 幂等键用 `Date.now()+random`，服务端无"同分镜在途任务"兜底 → 双击/双标签**重复建单 + 重复冻结** |
| 16 | `worker/src/main.ts:137` | `POLL_MAX_MS` 默认 **120s**，真实视频生成普遍 2–10 分钟 → 按默认值上线"任务几乎全失败"（不扣费但口碑重创） |

**另有 2 条需产品口径确认（非缺陷）**

- ~~**团队成员默认拥有全部权限**~~ —— **已撤回，是误报**。QA 的错因值得记下：它把 `enforced-permissions.ts:4-9` 的**注释**当成了判权结论，没去确认 `requirePermission` 是否唯一闸门。实际 7 个 `requirePermission` 调用点**全部成对配了 `requirePrivilege`**（`team.controller.ts:174↔176`、`:270↔272`、`:325↔324`、`:349↔348`、`:358↔360`、`:420↔419`、`:436↔435`），而 `team.service.ts:108-113` 的 `hasPrivilege` 只看 `role` 与 `roleCode`、与 power_list 无关 → role=3 普通成员确实拿不到移除成员/分配积分。**替换为真实暴露面（P2）**：`team.service.ts:111` 的 `if (role === 2) return true` 让 admin 无条件短路、power_list 对其完全无效；以及 `roleCode ∈ PRIVILEGED_CODES` 但 power_list 未配置时拿到全部团队权限。
- **项目级成员绑定无隔离效力**：`teamMemberProjects` 只在 `team.service.ts:1391-1444,1613-1631` 读写，项目可见性只看 `spaceId`。若产品口径是"项目级隔离"，这是缺失；若是"空间级"，需写进文档避免客户当成越权。

> 原列于此处的"账号注销搁浅冻结积分"经复核**已升级为 P0**——它不只是漏退款，而是让全库对账**结构上永远查不到**，详见 **PR-06**。

### 🟡 P2 — 可延后（18 条，择要）

队列 `attempts:1` 无重试；3 个队列建了 Worker 但只打 `no-op`；资产上传单请求 base64 无分片；`jwt.verify` 未固定 `algorithms`；OAuth `state` 未绑浏览器；`CAPTCHA_ENFORCE` 默认 0；CI 无依赖/密钥扫描且未声明 `permissions`；5 个超大文件（`pages/projects/[id].vue` 4413 行等）；空 `catch {}` 40+ 处（资金路径已抽查干净）；**`s3.ts:49` 存储 ContentType 客户端可控**（`safeMime` 只在 local 驱动上，S3 驱动直接落客户端值 → 关掉 AI 标注后 SVG 可能被当 `image/svg+xml` 直出，存储型 XSS；`anonymous` 固定非安全值属有意设计，但"依赖客户端传 image/*"这层是虚的）；`maintenance` 物理删任务撞外键 23503 被 `safeRun` 吞掉（取消任务永不清理）；`mock-pay` 不校验订单归属（但 `orders.id` 是 **snowflake 62 位、非自增**，无法枚举，危害降为 P2；`notify/mock` 匿名入账的前提同样是命中雪花位，实际风险 P1 而非 P0）；`waitlist` 返回注册总人数；**`worker/label.ts:94-96` `escapeDrawtext` 转义不足**（按 ffmpeg `av_get_token` 语义，输入 `\'` 可使第三个引号闭合、其后注入 `drawtext` 选项如 `textfile=` 读本地文件并渲染进成片），**但生产不可达**——`mockSegment` 仅在 `adapterMode !== "real"` 时调用（`timeline-export.ts:217,254`），生产由 worker 守卫强制 `ADAPTER_MODE=real`，仅 dev/CI/mock 可达；修法：用户文本不拼进 filter，改临时文件 + `textfile=`（路径我方生成）或 `-filter_complex_script`。

---

## ✅ 行动清单

| # | 行动 | 负责方 | 紧急度 | 期望完成 |
|---|------|--------|--------|---------|
| 1 | compose 补 `PHONE_HMAC_PEPPER`/`PHONE_ENC_KEY` 透传（或加 `env_file`），并在干净机器上真跑一次 `docker compose up` 验证能起 | 运维 | **P0** | 上线前 |
| 2 | `PAYMENT_LIVE` 加入 `collectProductionProblems` 必填项；mock 两端点改为 `NODE_ENV==="production"` **硬拒**（不要拿业务开关当安全开关）；`mock-pay` 补订单归属校验 | 后端 | **P0** | 上线前 |
| 3 | **记账恒真判据（修复优先级最高，且最容易改错，细则见下）**：`executor.fail()` 补 `CANCELED` 守卫；抽 `releaseFrozen(tx, taskId, disposition: "settle" \| "unfreeze")`，额度按 `sum(credit_flows.frozen_delta) where ref_task_id=taskId` 算（口径抄 `maintenance.ts:114-119`），收尾统一把 `creditsFrozen` 置 0。覆盖 8 处写入点，**处置方向必须按下方明细表**，不许一刀切 | 后端 | **P0** | 上线前 |
| 4 | canvas 下载加 host 白名单 + 内网 IP 黑名单 + `AbortSignal.timeout(10s)` + 大小上限；或改为只接受 storage key | 后端 | **P0** | 上线前 |
| 5 | 守卫加占位符黑名单（`/change-me\|dev-only\|minioadmin\|example\|test/i`）+ 熵下限；admin token 与用户 token 拆密钥；**人工确认生产 `.env` 已全量替换三项** | 安全/运维 | **P0** | 上线前 |
| 6 | **预发环境实测（不是"跑一遍测试"，是逐条验伪 P0）**：① 真跑一次 `docker compose -f docker-compose.prod.yml up` 证明 PR-01 能起；② `POST /v1/billing/notify/mock` 打一笔真实订单，确认修完后**不再入账**（证伪 PR-02）；③ 取消一个在跑任务、等满 `POLL_MAX_MS`，看积分是否被多退（证伪 PR-03）；④ 建节点写 `params.result_uri=http://169.254.169.254/...` 走 `batch-download`，确认被拦（证伪 PR-04）；⑤ 补跑 **77 个 DB e2e**（PG16+Redis7+migrate+seed）、`web build`（Linux）、`/share/**` 匿名直开 e2e | QA + 后端 | **P0** | 上线前 |
| 7 | 按 `credit_flows` 口径横向排查**所有**以 `tasks.creditsFrozen` 为判据的位置（已知 4 处：`executor.ts:147/270`、`tasks.service.ts:221/269`、`generations.service.ts:149`） | 后端 | P1 | 上线前 |
| 8 | `/auth/renew` 补撤销校验、`stream_token` 加路由白名单、nginx 加安全响应头与 HTTPS、`/v1/metrics` 限内网（F-05~F-09 同批） | 后端/运维 | P1 | 上线后第一周 |

### 行动 3 实现细则（照此执行，不要自己发挥）

**处置方向表 —— 8 处方向不可混，混了就是新的资金 bug**

| # | 写入点 | 方向 | 备注 |
|---|--------|------|------|
| 1 | `executor.ts:147` 成功路径（已用 `settleCredits`，`kind='settle'`，余额→`balance+Δ`） | **settle**，只补 `creditsFrozen: 0` | ⚠️ **绝不换成 `unfreezeCredits`**：赠送额度是 `delta=0, frozen_delta=−N`，换成就等于白拿 N 积分 |
| 2 | `executor.ts:270` `fail()`：守卫补 `CANCELED`（对齐 `succeed()` 的 `:130-137`） | unfreeze | 本次 P0 的正主 |
| 3 | `tasks.service.ts:221-228` `cancel()` | unfreeze | |
| 4 | `maintenance.ts:114-119` reviveStuckTasks | unfreeze | 金额口径已正确，只差归零 |
| 5 | `worker/src/main.ts` 入队失败退款 | unfreeze | |
| 6 | `admin.service.ts:472-476` 注销脱敏 | unfreeze | 否则 PR-06 的搁浅资金 |
| 7 | `ad-drama.service.ts:768` `TASK_STATUS.DONE` | **settle** | 该文件有自己一套状态常量，按 `TaskStatus` 搜会**整段漏掉**；必须用 `.update(tasks)` 的**结构锚点**穷举，不能按符号名 grep |
| 8 | `ad-drama.service.ts:801` `TASK_STATUS.FAILED` | unfreeze | 同上 |

**穷举校验（8 + 6 = 14 闭合）**：用结构锚点 `update(tasks)` 扫出 **14 个调用点**，其中 8 个是终态写入（上表），另 6 个非终态应排除：`tasks.service.ts:105`(updateMeta) / `:273`(只写 deletedAt) / `:672`(feedback) / `executor.ts:344`(RUNNING) / `:389`(vendorTaskId) / `maintenance.ts:453`(清 results)。**若你数出的不是 14，说明漏了。**

**两个必踩的坑（第二个会让每次生成都免费）**

1. **顺序陷阱 → 修复静默失效**：若保留原 `settleCredits`/`unfreezeCredits` 调用、再调 `releaseFrozen`，helper 按流水算 `outstanding` 会得 0 并直接返回 —— **等于没归零，PR-03 原样保留**，而你以为修好了。必须**删掉原调用**，由 helper 独占收尾。
2. **额度口径陷阱 → 全局免费**：helper 若改按 `tasks.creditsFrozen` 算额度并放开 `allowNegative`，**每次成功生成都会把整笔钱退回去** —— 把"偶发多退"升级成"全局免费"。必须按流水算，`allowNegative` 保持 `false`（它挡住的是逻辑错误，不是保守）。

**三条必须加的守卫测试**
- **随机终态**：任意终态下反复调 `releaseFrozen`，只生效一次，`outstanding` 不重复退。
- **全库不变式（双向）**：随机跑 100 次 freeze/settle/unfreeze/cancel 后，断言 `Σ(credit_accounts.balance) == Σ(credit_flows.delta)` **且** `Σ(frozen) == Σ(frozen_delta)`。
- **字段与流水同向**：断言 `tasks.credits_frozen == Σ(credit_flows.frozen_delta where ref_task_id=task)`——这条专防"有人再加回只归零不 unfreeze"或反之。

**一个不能丢的信息**：成功后原本的 `creditsSettled: fresh.creditsFrozen`（`executor.ts:141`）要保留——它是"这笔实际结算了多少"的唯一记录，归零 `creditsFrozen` 时别把它一起清掉。

**验证口径**：修完必须**真跑带库的那部分测试**（`postgres:16-alpine` service 容器形态）。若靠内存库/mock "证明"绿了，等于重演这个 bug 当初进仓库的路径——它之所以能活到今天，就是因为夹具编码了生产不出现的状态。

---

## 🧭 评审过程与断言纪律（这节比任何单条发现都重要）

本次三位专家各自独立审计同一代码库，**发生了 6 次自我纠错或相互推翻**，全部记录在案：

| # | 谁 | 原断言 | 结果 | 纠正依据（换的锚点） |
|---|----|--------|------|----------------|
| 1 | 产品官 | P1-1 定位 `findTask` | 坐标写错 | 换锚点：重读 `findOne` vs `findTask` |
| 2 | QA | `DELETE /tasks/:id` 零 e2e 覆盖 | **被推翻** | 换锚点：`task-delete.spec.ts` 实有 5 用例 |
| 3 | QA | 团队成员默认拥有全部权限 | **被推翻（误报）** | 换锚点：7 处 `requirePermission` 全成对配 `requirePrivilege` |
| 4 | QA | `notify/mock` 可枚举订单 | **被推翻** | 换锚点：`orders.id` 是 snowflake 62 位非自增 |
| 5 | 产品官 | 抽 `releaseFrozen` 统一解锁+归零 | **自我推翻（危险）** | 换锚点：流水 `outstanding` 语义 → 会致全局免费 |
| 6 | 主理人 | 安全官报"流式端点无归属校验" | **驳回** | 换锚点：`agent-stream.service.ts:65` 有 `eq(tasks.spaceId, ...)` |
| 7 | QA | 链路 6「导出交付包」未发现断点 | **自我推翻** | 换锚点：走查口径只含"功能+越权"，不含"内容取回目标"→ SSRF 在其方法下**结构性不可见**，不是读漏 |

**共同点：每一次纠错都是"换了锚点类型"，而不是"换了一个人再读一遍"。**

由此定下本次审计的判定标准（对**指控类**断言「全/零/必然/可枚举」与**免责类**断言「无 XSS / 无越权 / 无注入」**双向适用**）：

> **同一断言必须在至少两类不同锚点下重算并一致，否则记为「单路径未验证」。**
> 第二条路径必须是**不同锚点**——夹具实际值、结构锚点（`.update(tasks)` 的形状）、类型定义（`pk()`）、调用点（`requirePrivilege`）——**不能是"换个人用同一锚点再读一遍"**。

**这条标准的现实依据**：两个角色各自独立审同一代码库，QA 的 4 条全称量词断言有 **3 条被推翻**；安全官自己的 1 条 P0（F-01 SSRF）**未经二次验证**、另有 1 条"无问题"结论（账本无双花）**只有代码阅读一种锚点，已主动降级为"代码层一致、未运行时验证"**。

> **结论：单人自证通过率不构成放行依据。** 本报告所有"已验证无问题"的结论，强度上限都是"代码层单/双锚点一致"，**没有一条经过运行时验证**。

**一条必须写进合并结论的方法边界**：QA 查的是"**该不该给你**"（权限与归属），安全官查的是"**给了你之后能干什么**"（内容取回目标 / SSRF / XSS）。**这是两类不同问题，不可互相替代**——
- 链路 6「导出交付包」的"未发现断点"**不构成该链路的安全背书**（PR-04 就藏在这条链路的打包环节）；
- 反过来，安全官只覆盖了 24.8% 的归属校验，**也不代表越权已清干净**（那是 C 档 337/448 的"未评估"）。
- 两边都"没查出问题"不等于"没有问题"——本次两个 No-Go 都是被**第三种口径**（记账不变式、配置一致性）抓到的。

---

## ✅ 已证否的怀疑（负结果，同样是结论）

只报问题不报"查过没问题"，会让人误以为面没扫过。以下是**穷举计数后确认成立**的负结果，附锚点：

| # | 怀疑 | 结论 | 锚点 |
|---|------|------|------|
| 1 | 命令注入 | **不成立**：`child_process` 站点全仓 **5 处**，全部 `execFile` + 数组传参、无 `shell:true`、无字符串拼接（`worker/label.ts:9`、`worker/timeline-export.ts:12`、`shared/ffmpeg-trim.ts:8`、`shared/media-capability.ts:4`）；`ffmpeg-trim` 中唯一含用户数据的 argv 是数字化的 `-ss/-to`（`:63-66`） | 穷举 5 处逐个判定 |
| 2 | worker 跨租户取片 | **取数层不成立，但是纵深防御缺口**：`readClipSource`（`timeline-export.ts:49-67`）按 `clip.task_id` 取值**不带 spaceId**，形似越权；实际被写入口拦住——`script.service.ts:3105-3135` 把 `task_id` 限定为"本 space **且** 本集/本镜头"，非法即 400101。→ 记 **P2 建议**（worker 不应信任库内数据，一旦新增写路径不校验就会破），**不计漏洞** | 写入口 + 读出口双锚点 |
| 3 | 动态执行 | **不成立**：`eval` / `new Function` / `vm` **0 处**；`redis.client.eval` 仅 1 处常量 Lua、参数化传参 | 全仓 grep 零命中 |
| 4 | SQL 注入 | **不成立**：`sql.raw` 穷举 5 处逐个判定均为可信来源（`canvas-group.service.ts:146/158/190/215` + `film.fields.ts:364`） | 穷举 5 处 |
| 5 | 团队权限默认全开 | **不成立（误报已撤回）**：7 处 `requirePermission` 全成对配 `requirePrivilege` | 调用点锚点 |

> 口径提醒：上表的"不成立"都只在**已声明的锚点范围内**成立。例如第 2 条是"被写入口拦住"，不是"worker 层安全"；一旦新增一条不校验的写路径，它就变成真漏洞——这正是它仍被记为 P2 建议的原因。

---

## ⚠️ 待完善 / 已知局限（必须与结论一起读）

1. **77 个 api e2e（约 85%）未执行** —— 本机无 Docker/PG(55432)/Redis(6380)。这是本次最大盲区，"lint/build 绿"**不能**等同于后端回归通过。
   **更要紧的一点：本次实测的 200 个全绿用例，对 6 条 P0 一条都没有覆盖**——6 处全部终态写入点、支付的两段 mock 分支、SSRF 抓取链，全部零覆盖。**"测试绿"和"能上线"是本次两个独立结论，不是因果。** 仓库里甚至已有 `coverage_gaps.ts:145` 把"账本测试缺口"记录在案，但记录没有转化为行动。
2. **`web build` 结果存在环境矛盾**：产品评审员本机 `EXIT=0` 成功（7.24 MB 产物），QA 同命令被沙箱 Program Blacklist 拦 `wmic.exe` 而失败。判定为**环境差异非代码问题**，但必须在 Linux CI 复验 `.output/server/` 完整性。
3. **`pnpm audit` 未执行** —— 镜像无 audit 端点，**未核实任何 CVE，不编造编号**。
3b. **本轮 sink 穷举只覆盖"已授权用户能驱动服务器做什么"，不覆盖第三方组件自身漏洞**：ffmpeg 二进制版本与已知 CVE 未核（F-25 的定级依赖 ffmpeg 自身 `av_get_token` 解析行为）、ffmpeg/libx264、S3 SDK、pg 客户端均未做版本审计。
4. **全部 P0/P1 均为代码层确证或静态推演，无运行时复现**（PR-01 需真实 compose 启动、PR-03 需真实 DB 事务 + 队列、PR-04 需内网靶机）。
5. **短信通道疑似根本不存在**：`sms.service.ts:24-26` 只把验证码写 Redis，全仓无供应商集成。若属实则**生产手机号登录不可用**（只能走 OAuth）。**未验证是否存在部署期外挂网关，需产品确认**——这条会影响"上线"本身是否成立。
6. **真实支付/OAuth 未验证**：无沙箱凭据，微信 APIv3 验签与证书轮换、支付宝 form 验签、Apple id_token 真实换票均只有单测覆盖。
7. 安全官未逐行覆盖 `film`/`kds`/`novel`/`extraction`/`campaign` 的深层业务分支（归属校验为抽样 + 全量 grep 模式验证）。
8. **本报告经历过一次结论翻转和一次误判纠正，均保留在案**：QA 初判"条件 Go"，复核代码层后自行降级 No-Go；QA 曾把 `DELETE /tasks/:id` 报成"零 e2e 覆盖"，被产品官用 `task-delete.spec.ts`（5 个用例、`:210-215` 断言）证伪并撤回。这说明**单个成员的结论不可直接采信**——本报告 6 条 P0 均已由主理人独立读取源码原文二次确认，或由另一成员交叉复核。
9. 度量口径已统一：lint 为 **0 error / 30 warning**（api 2 + web 28，以未缓存运行为准；QA 早期记 28 是 turbo 缓存命中缺失了 api 那 2 条）。
10. **IDOR/BOLA 覆盖的三档语义，请勿合并成一句**：A 档（归属入口函数逐行读过）**95/448** + B 档（经统一 `requireMember` helper 间接覆盖）**16/448** = **111/448（24.8%）**被证过；**C 档 337/448 是「未评估」，不是「未发现」**——形态检查只能发现"完全没写过滤"，发现不了"写了但条件可绕过"或"space 来源可被攻击者控制"，**故 C 档不得计入任何"未发现越权"的表述**。另一个信号：A 档 95 条里 script 占 73（77%），说明"逐行读过"是跟着**走查顺序**走的、不是跟着**风险**走的——开口风险更可能在 C 档里业务复杂度高的 canvas（约 73）与 market（约 34），**预发阶段应优先按这两个模块补**。**本次审计自己就是反证**：唯一的 SSRF P0（PR-04）证据在 `canvas/canvas-download.service.ts:102,245-254` + `canvas.controller.ts:40`，而 canvas 的 73 条路由**正落在 C 档**；且它根本不是"归属校验缺失"类缺陷——任何 id-归属形态检查都不可能命中。**把 C 档读成"倾向安全"，会直接漏掉本次唯一的 P0。** 可复现计数命令：`find apps/api/src/modules -name '*.controller.ts' | wc -l`（50）/ `grep -rhoE '@(Get|Post|Put|Patch|Delete)\(' --include=*.controller.ts . | wc -l`（774）/ `grep -rhoE '@Param\(' --include=*.controller.ts . | wc -l`（679）/ `grep -rhoE '@(Get|Post|Put|Patch|Delete)\("[^"]*:' --include=*.controller.ts . | wc -l`（448）；六项分档 script 73 / tasks 13 / assets 4 / billing 3 / voice 2 / team 16 已由 QA 独立复算，算术闭合（A+B=111，C=337）。

---

## 📚 成员产出索引

原始产出由各成员以完整 Markdown 直接回传主理人，关键结论与 `file:line` 证据已全量转述进本报告，未做删减性摘要：

- **gstack-product-reviewer（产品评审员）**：抽样口径与覆盖率声明、P0×1 + P1×8 + P2×7、6 条"值得记下的正确做法"（账本内核 / markPaid 三重幂等 / IdempotencyInterceptor 三态账本 / 看门狗流水口径）、门禁四条实测 EXIT
- **gstack-security-officer（安全官）**：P0×4 + P1×7 + P2×11、STRIDE 简表、**11 项"已验证无问题"清单**（含 IDOR 主链路、支付验签默认拒绝、上传无穿越/XSS、`SMS_IP_HOURLY_LIMIT` 未渗入生产）、6 项未验证边界
- **gstack-qa-lead（QA 门神）**：门禁实测表（200 用例全绿）、9 条核心链路走查、边界场景 10 项、**7 项必须预发补测清单**、结论从"条件 Go"降级 No-Go 的完整理由

---

> 本报告由软件工坊 AI 协作生成（主理人沽思航汇编），关键决策请由工程负责人复核。
> 报告中标注「主理人复核」的条目，均已由主理人独立读取源码原文二次确认，非单纯转述专家结论。
