# 部署与运维

> v1.1 · 2026-10-24 · MVP 双机起步，全容器化
> v1.1 变更：worker 内置 ffmpeg/中文字体与水印环境变量（RE-07）；补 exports-cleanup/shares-expire 定时任务（RE-11/08）；Sentry 境内口径

## 1. 环境矩阵

| 环境 | 用途 | 数据 | 供应商 | 部署方式 |
|---|---|---|---|---|
| local | 开发 | docker(PG/Redis/MinIO) | mock fixtures | pnpm dev |
| staging | 验收/E2E | 隔离库+种子 | 供应商**沙箱/小额Key** | main 自动部署 |
| prod | 生产 | 独立库 | 正式 Key | 手动批准蓝绿 |

域名：`www.`(落地页SSG, CDN) · `app.`(前端 SPA) · `api.`(后端) · `static.`(OSS+CDN)。全部 HTTPS(泛域名证书)。

## 2. 生产拓扑（MVP）

```
机器A 4C8G: nginx(入口/TLS) + api(×2容器) + web(node SSR 可选/静态托管)
机器B 2C4G: worker(×2容器, 内置 ffmpeg/中文字体，独立供应商出口) + 定时任务(对账/清理/看板)
托管:   PG 16(4C16G 起步, 主从 Ph2) · Redis 7(1G AOF) · OSS(私有桶×2: 源文件/生成结果) · CDN
```

扩容路径见 system-design §5。

## 3. docker-compose（prod 骨架）

> 实现参考：`app/docker-compose.prod.yml`（已落地并通过全栈冒烟：postgres/redis/minio/minio-init/migrate/api/worker/web/nginx；
> 镜像见 `app/apps/{api,worker,web}/Dockerfile`；nginx 同源反代见 `app/deploy/nginx.conf`；env 模板见 `app/.env.production.example`）。

```yaml
services:
  api:
    image: ghcr.io/<org>/api:${TAG}
    env_file: /etc/app/api.env
    deploy: { replicas: 2, resources: { limits: { cpus: "2", memory: 2G } } }
    healthcheck: [CMD, curl, -f, http://localhost:3000/healthz]
  worker:
    image: ghcr.io/<org>/worker:${TAG}
    env_file: /etc/app/worker.env
    deploy: { replicas: 2 }
  nginx: { ports: ["443:443"], volumes: [./nginx.conf] }
```

## 4. 环境变量清单（模板：`apps/api/.env.example`、`apps/worker/.env.example`、`.env.production.example`；本节为摘要）

> 注：仓库根 `app/.env.example` 只含 `DATABASE_URL`/`REDIS_URL` 两项（本地速用），**不是**权威全集。
> 生产/联调请以 `app/.env.production.example` 与各 app 自己的 `.env.example` 为准（`launch-checklist.md` GAP-03 已记录此口径）。

```
# 通用
NODE_ENV / APP_DOMAIN / DATABASE_URL / REDIS_URL
JWT_SECRET / REFRESH_SECRET
# 存储（S3 兼容：OSS / MinIO；ADR-005）
STORAGE_DRIVER=local|s3
STORAGE_DIR / STORAGE_PUBLIC_BASE / STORAGE_SIGN_SECRET
STORAGE_S3_BUCKET / STORAGE_S3_REGION / STORAGE_S3_ENDPOINT
STORAGE_S3_PUBLIC_ENDPOINT   # 预签名 URL 的对外地址（内网 SDK 与公网下载分离）
STORAGE_S3_ACCESS_KEY_ID / STORAGE_S3_SECRET_ACCESS_KEY / STORAGE_S3_FORCE_PATH_STYLE
# 供应商（仅 worker.env）
VOLC_AK / VOLC_SK / VOLC_MODEL_ENDPOINT
ARK_API_KEY / ARK_BASE_URL / ARK_MODEL_MAP     # 火山方舟专用适配器（volcengine:* 任务）
HTTP_VIDEO_BASE_URL / HTTP_VIDEO_API_KEY / HTTP_VIDEO_MODEL_MAP  # 通用 HTTP 视频网关
ALIYUN_DASHSCOPE_KEY / KLING_AK / KLING_SK / VIDU_KEY / DEEPSEEK_KEY
# 三方
SMS_PROVIDER=aliyun / SMS_AK / SMS_SK / SMS_SIGN_NAME / SMS_TEMPLATE_CODE
CAPTCHA_PROVIDER=tencent / CAPTCHA_SID / CAPTCHA_SECRET
SENTRY_DSN                      # 境内/自建，禁境外 SaaS（compliance D4）
PAY_WECHAT_MCH_ID / PAY_WECHAT_API_V3_KEY / PAY_WECHAT_SERIAL
# 支付（api-spec §10.4；生产开启 PAYMENT_LIVE=true 前必须齐全，否则启动守卫拒绝启动）
PAYMENT_LIVE=true
WECHAT_APP_ID / WECHAT_MCH_ID / WECHAT_MCH_SERIAL_NO / WECHAT_API_V3_KEY
WECHAT_MCH_PRIVATE_KEY（或 _PATH） / WECHAT_PLATFORM_PUBLIC_KEY（或 _PATH）
# 平台证书轮换（推荐）：JSON {serial:PEM}，可同时配置新旧证书
WECHAT_PLATFORM_PUBLIC_KEYS（或 _PATH） / WECHAT_API_BASE / WECHAT_NOTIFY_URL
ALIPAY_APP_ID / ALIPAY_APP_PRIVATE_KEY（或 _PATH） / ALIPAY_PUBLIC_KEY（或 _PATH）
ALIPAY_GATEWAY / ALIPAY_NOTIFY_URL
# AI 标识后处理（worker 镜像内置 ffmpeg + fonts-noto-cjk）
FFMPEG_PATH=/usr/bin/ffmpeg
AI_LABEL_FONT_PATH=/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc
AI_LABEL_ENABLED=true / AI_LABEL_TEXT=AI生成
# 内容审核（PRD F7）
MODERATION_ENABLED=true / MODERATION_WORDS=词1,词2
# 维护任务（worker 内置，PR 周期）
MAINTENANCE_INTERVAL_MS=21600000
ADMIN_BOOTSTRAP_PASSWORD   # 首次启动建号后改密并移除
```

## 5. 备份与灾备

| 项 | 策略 | 恢复目标 |
|---|---|---|
| PG | 每日全量 + WAL 连续归档(OSS, 保留 14 天) | RPO≤5min / RTO≤1h，季度演练 |
| Redis | AOF everysec（仅队列/缓存，可重建） | 丢 1s 内任务由 PG 对账补投 |
| OSS | 版本控制开启 + 跨区复制(Ph2) | 误删可恢复 30 天 |
| 配置 | 全部在 git（密钥除外，放 CI Secrets + 服务器 env 双份） | — |

### 5.1 可用脚本（`app/deploy/`）

| 脚本 | 用途 |
|---|---|
| `backup-db.sh` / `backup-db.ps1` | 全量备份（custom 格式 + 压缩 + `pg_restore --list` 校验 + 14 天保留清理） |
| `restore-db.sh` | 恢复（`--clean --if-exists`，需输入 `yes` 二次确认） |
| `verify-backup.ps1` | **备份可用性验证**：恢复到临时库、比对表数与关键数据、自动删临时库 |
| `rollback.sh` | 代码回滚到指定 tag（不改数据库，提示不可逆迁移需走恢复） |

> **运维铁律**：备份不等于可用。每次备份后跑 `verify-backup.ps1`，只有能恢复的备份才算备份。
> 已验证：27 张表全量恢复、关键表数据完整。

## 6. 健康检查与指标（`/v1`）

| 端点 | 语义 | 行为 |
|---|---|---|
| `GET /healthz/live` | **liveness** | 进程活着就 200，**不查依赖**（依赖抖动时不该重启容器） |
| `GET /healthz/ready` | **readiness** | db+redis 都可用才 200；否则 **503**；停机中返回 503（`shutting_down`） |
| `GET /healthz` | 聚合详情 | 依赖不可用时同样 503，供人工排查 |
| `GET /metrics` | Prometheus 文本 | 任务状态分布 / 15min 失败率 / 待支付超时 / **已支付未入账**（应恒为 0）/ 进程指标 |

**探针配置建议**：
```yaml
livenessProbe:  { httpGet: { path: /v1/healthz/live,  port: 3000 }, periodSeconds: 10, failureThreshold: 3 }
readinessProbe: { httpGet: { path: /v1/healthz/ready, port: 3000 }, periodSeconds: 5,  failureThreshold: 2 }
```
**关键告警**（基于 `/metrics`）：
- `oneframe_orders_paid_without_credit > 0` → 资金链路异常，立即排查（用户付了钱没到账）
- `oneframe_failure_ratio_15m > 0.3` → 供应商异常，考虑熔断
- `oneframe_orders_stale_pending > 10` → 回调/轮询异常

## 6.1 优雅停机

`SIGTERM` 处理链路（api 与 worker 一致）：
1. 标记 `shutting_down` → **readiness 立即 503**（LB 摘流）；
2. 停止接收新请求/新 job，等待在途完成；
3. 超过 `SHUTDOWN_TIMEOUT_MS`（默认 25s）强制退出，避免容器停不下来；
4. worker 的未完成 job 由 BullMQ 重新投递，不丢失。

> 已验证：停机中 readiness 返回 503，进程退出码 0，日志含 `draining` / `closed cleanly`。

## 7. 发布与回滚

- 流程见 dev-workflow §4：staging 冒烟 → 手动批准 → 蓝绿切流（nginx upstream 切换）；
- 回滚：`./deploy/rollback.sh <上一tag>` ≤2min；DB 迁移必须向后兼容（先加后用），禁止发布依赖不可回滚迁移；
  脚本会提示：若含不可逆迁移（drop/rename），改用备份恢复而非代码回滚；
- 灰度：新版本先 10% 流量（nginx weight）观察错误率 10min。

## 7.1 定时任务（worker 机）

| 任务 | 频率 | 说明 |
|---|---|---|
| orders-reconcile | 5min | 未终态订单主动查单 |
| tasks-watchdog | 1min | RUNNING>10min 无心跳 → 重入队/告警 |
| assets-expire | 1h | 90 天结果清理 + 回收站物理删 |
| exports-cleanup | 1h | 导出 zip 7 天清理（database §10） |
| shares-expire | 1h | 过期/撤销分享 token 清理 |
| flows-audit | 每日 | balance/frozen 与流水对账，不平告警 |
| vendor-probe | 6h | 各 adapter 探针任务(沙箱)健康度 |
| backup-verify | 每周 | 恢复演练(拉最新备份到临时库跑校验) |
| accounts-purge | 6h | 已注销满 30 天账号物理清理（PRD F1，worker 内置 runMaintenance） |

> v1.0 实现现状：worker 内置 `runMaintenance`（启动 + 每 `MAINTENANCE_INTERVAL_MS`，默认 6h）已覆盖
> **90 天结果清理 / 回收站 7 天物理删 / 注销 30 天账号清理** 三项；
> 其余定时任务（对账、分享清理、备份校验、供应商探针）为运维侧待接入项。
>
> 说明：`orders-reconcile` / `tasks-watchdog` / `shares-expire` / `flows-audit` 已在 `apps/worker/src/main.ts` 用独立定时器接入
> （频率可用 `ORDERS_RECONCILE_INTERVAL_MS` 等环境变量覆盖）；`vendor-probe` / `backup-verify` 仍需运维侧接入。

## 7.2 退款 SOP（全额 · 运营审批后执行）

接口：`POST /ops/admin/orders/{id}/refund {reason}`（AdminGuard；api-spec §10.5）。仅全额、仅已支付订单。

**流程（E3 未成年人误充同一口径）**：

1. **受理**：客服建工单，记录申诉人、订单号（`orders.order_id`）、原因；核对 `orders.status=2`（已支付）。
2. **审批**：运营负责人审批（金额 + 事由），在工单写审批人/时间；未成年人误充需监护关系材料。
3. **执行**：管理端调用退款接口（`reason` 填工单号）。成功判据：响应 `status=4`、`refund_no=rf-{order_id}`；
   微信/支付宝渠道异步处理中时 `refund_status=processing`，按渠道退款结果后续转 `succeeded`。
4. **对账**：`GET /ops/admin/orders?status=4` 导出退款单，与渠道商户平台退款流水按 `refund_no`/`refund_amount_cents` 对账；
   `credit_flows` 中应存在且仅存在一条 `kind=refund, delta=-credits, ref_order_id=该订单`，且 `balance == Σdelta`。
5. **人工例外**：接口拒绝 `400101 insufficient credits to roll back (balance=…, credits=…)` 表示积分已被消耗，
   此时**不得**直接退款；按未消耗余额与用户协商，走线下/渠道人工退款并备注工单（本期不支持部分退款 API）。

> 渠道退款失败时接口返回 `745900/745901`，事务已回滚（订单仍为已支付、积分未冲正）；
> 用同一订单重试即可，渠道按幂等号 `rf-{order_id}` 去重，不会重复退钱。

## 7.3 微信支付平台证书轮换

1. 商户平台下载新平台证书 → 导出公钥 PEM；
2. 更新 `WECHAT_PLATFORM_PUBLIC_KEYS`（JSON `{"<serial_no>":"<PEM>"}`）或 `*_KEYS_PATH` 文件，**保留旧证书**（轮换期双证书并存）；
3. 滚动重启 api（回调按 `Wechatpay-Serial` 精确选公钥；未知 serial → 401 拒绝，不会误放行）；
4. 观察 24h 回调 401 比例，确认新 serial 命中后移除旧证书，再次滚动重启；
5. 未带 serial 的兼容场景回退 `WECHAT_PLATFORM_PUBLIC_KEY`（仅单证书部署）；生产建议配置 `*_KEYS` 映射。

## 7.4 生产启动守卫（fail fast）

- api：`NODE_ENV=production` 时启动即校验（`apps/api/src/config/env.ts::buildEnv`）：默认弱密钥、
  未显式 `COOKIE_SECURE`、`PAYMENT_LIVE=true` 但渠道凭据不全/半配 → **拒绝启动** 并聚合列出缺失变量名（不打印值）。
- worker：`NODE_ENV=production` 时 `ADAPTER_MODE` 必须 `real` 且至少一种真实供应商 Key，否则拒绝启动。
- 部署自检：`docker compose logs api | grep "配置校验失败"` 为空；容器启动即崩溃时优先按错误里列出的变量名补齐 Secrets。

## 8. 上线前 72 小时运维演练清单

与 `docs/06-security-compliance/launch-checklist.md` 的 D1–D9 一一对应；**任一项不通过不得发布**，
演练结论（通过/不通过 + 实际耗时 + 执行人）回填发布单。

| 编号 | 演练 | 操作步骤 | 通过判据 |
|---|---|---|---|
| D1 | 备份可恢复性 | `pwsh -File deploy/verify-backup.ps1`（拉最新备份 → 临时库恢复 → 比对表数与关键数据 → 删临时库） | 全表恢复成功、关键表行数一致、临时库已清理 |
| D2 | 回滚 | `./deploy/rollback.sh <上一tag>` | ≤2min 完成；`curl -f http://127.0.0.1:8080/v1/healthz/ready` 返回 200；核心接口冒烟通过 |
| D3 | 支付回调失败 | 临时清空 `WECHAT_PLATFORM_PUBLIC_KEY` 后重启 api，构造一条回调 | 回调被拒（验签不过不入账）；`oneframe_orders_paid_without_credit` 不增长；告警触发 |
| D4 | 对账补账 | `PAYMENT_LIVE=false` 时用 `POST /v1/billing/notify/mock` 制造"已支付未入账" | 5min 内 `orders-reconcile` 补账，指标归零 |
| D5 | 优雅停机 | 向 api 进程发 `SIGTERM` | readiness 立刻 503 → 在途请求完成 → 退出码 0；日志含 `draining` / `closed cleanly` |
| D6 | 告警链路 | 人为制造 5xx 与 >2s 慢请求 | 请求日志 `level=warn`（observability §1.3）且命中告警通道（P0 电话 + IM） |
| D7 | 容量与限流 | 压测下单/任务查询 30min | api P95 ≤500ms；队列 age ≤5min；CPU/磁盘水位 <70% |
| D8 | 值班与升级 | 排班表 + P0 15min 响应演练 | 值班到人、电话可达、升级路径明确 |
| D9 | 未成年人误充退款 | 模拟监护人申诉 → 审批 → 按未消耗余额退款（流程见 §7.2） | 工单、审批、退款记录三件留痕；`status=4`、`refund_no`、refund 流水齐全且 ledger 平 |

**排障串联**：每个 HTTP 响应都带 `x-request-id`，请求日志 `request_id` 与之同值（observability §1.1）——
用户报障时先要响应头，即可在日志系统一次捞全该请求的鉴权身份、状态码、耗时与错误码。
