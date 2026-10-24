# 可观测性

> v1.2 · 2026-10-25 · Sentry + 结构化请求日志（request_id 串联）+ Prometheus 指标 + 业务看板
> v1.2 变更：**request_id 结构化请求日志落地**（`apps/api/src/common/logging`），补齐字段表、脱敏规则与告警口径；
> 与 `docs/06-security-compliance/launch-checklist.md` 的 LOG-01~LOG-05 条目一一对应。
> v1.1 变更：Sentry 改境内/自建（compliance D4，RE-16）；新增 AI 标识后处理失败率指标（RE-07）

## 1. 日志规范

- 库：worker 用 pino（JSON 行）；api 用**零依赖结构化请求日志**（`process.stdout` 单行 JSON），
  统一被日志采集器（Vector/Filebeat/阿里云 SLS）收口；
- 每请求注入 `request_id`：**响应头 `x-request-id` 同号回传**，用户报障贴头即可定位全部日志；
- 任务全生命周期（worker）：`task.submitted / task.vendor_submitted / task.poll / task.transferred / task.settled / task.failed`（含 vendor_task_id、credits）；
- **禁记**：完整提示词（记长度+哈希前 8 位）、token、手机号全量（掩码 `138****8000`）、签名 URL、请求体、Authorization、Cookie。

### 1.1 request_id 规范（api）

| 项 | 规则 |
|---|---|
| 生成 | Fastify `genReqId` 生成 UUID v4（`apps/api/src/main.ts`），容器内全局唯一 |
| 上游沿用 | 请求头带 `x-request-id` 且匹配 `^[A-Za-z0-9._:-]{8,128}$` 时沿用（网关/前端串联）；不匹配（含空格、换行、超长、控制字符）一律丢弃并回退服务端 uuid —— 防日志注入与响应头污染 |
| 回写 | 无条件写响应头 `x-request-id`（含 `/healthz/*`、`/metrics` 探针，便于排障串联）；响应头已发出则跳过 |
| 一致性 | 日志字段 `request_id` **恒等于**响应头值（`apps/api/test/observability.spec.ts` 有断言守护） |
| 跨服务传递 | 前端/网关 → api 透传该头；api 调外部供应商时不透传（避免泄漏内部 id） |

实现位置：`apps/api/src/common/logging/`
（`request-logging.middleware.ts` 建上下文并回写头；`request-log.interceptor.ts` 在鉴权后补 `user_id/space_id` 与 `error_code`；`request-log.ts` 定义字段与脱敏；`logging.module.ts` 通过 `REQUEST_LOG_SINK`/`REQUEST_LOG_CLOCK` 支持测试注入）。

### 1.2 请求日志字段表（单行 JSON，字段顺序固定）

| 字段 | 类型 | 必填 | 说明 | 来源 |
|---|---|---|---|---|
| `time` | string(ISO8601) | 是 | 请求完成时刻（UTC） | 服务端 |
| `level` | `info`\|`warn` | 是 | `5xx` 或 `duration_ms > 2000` → `warn`；其余 `info` | 服务端 |
| `msg` | string | 是 | 固定 `http_request`（便于按事件过滤） | 服务端 |
| `request_id` | string | 是 | 与响应头 `x-request-id` 同值 | genReqId / 上游头 |
| `method` | string | 是 | 大写 HTTP 方法 | 请求 |
| `path` | string | 是 | **去掉查询串与 hash** 的路径；32+ 位不透明段（分享 token）记 `:redacted`；手机号掩码 | 请求 |
| `status` | number | 是 | HTTP 状态码 | 响应 |
| `duration_ms` | number | 是 | 处理耗时（整数毫秒） | 服务端计时 |
| `space_id` | string | 否 | 鉴权后才有（`AuthGuard` → `request.auth.spaceId`），未鉴权请求不输出 | 鉴权上下文 |
| `user_id` | string | 否 | 鉴权后才有，同上 | 鉴权上下文 |
| `error_code` | number | 否 | 与信封 `code` 同源：业务错误取 `AppError.code`（如 `745801`/`745802`），HTTP 错误按状态映射（401→401101、404→400102、5xx→500000）；全 0 成功不输出 | interceptor / 状态映射 |
| `aborted` | `true` | 否 | 客户端中断（连接 close 且未 finish）时出现 | 服务端 |

**刻意不记录的字段**（合规硬约束，测试守护）：请求体、查询串、`authorization`、`cookie`、`user-agent` 原文、提示词正文、手机号全量、支付签名。

示例：

```json
{"time":"2026-10-25T03:58:20.115Z","level":"info","msg":"http_request","request_id":"6a1f0f0a-4c2f-4f0e-9a0e-1b2c3d4e5f60","method":"POST","path":"/v1/generations","status":200,"duration_ms":42,"space_id":"107571865183174657","user_id":"107571865183174656","error_code":745801}
{"time":"2026-10-25T03:59:02.004Z","level":"warn","msg":"http_request","request_id":"b2c3d4e5-1111-2222-3333-444455556666","method":"GET","path":"/v1/tasks","status":200,"duration_ms":2413,"space_id":"107571865183174657","user_id":"107571865183174656"}
```

哪些请求不写日志：`/v1/healthz/live`、`/v1/healthz/ready`、`/v1/healthz`、`/v1/metrics`
（探针每 5–10s 一次，写日志会把业务请求挤出保留窗口；**响应头仍照常回写**）。

### 1.3 日志级别与告警口径

| 触发条件 | 级别 | 告警/动作 |
|---|---|---|
| 任一请求 `status >= 500` | `warn` | P0：5xx 比例 >1% 立即电话（见 §4） |
| 任一请求 `duration_ms > 2000` | `warn` | P1：连续 5min 出现慢请求 → 查供应商/DB 慢查询 |
| `error_code in (745801, 745802)` 突增 | `info` | P1：审核拦截率 >5% 触发内容安全复盘（§3） |
| `aborted = true` 占比突增 | `info` | P2：客户端/网关超时或 LB 过早断开排查 |
| 业务成功请求 | `info` | 仅留痕，不告警 |

### 1.4 保留与合规

- 请求日志保留 **30 天**（排障窗口）；
- 审核与举报相关记录（`task_events`、`content_reports`）**≥6 个月**，由数据库留存、不受日志轮转影响（`launch-checklist.md` MOD-04）；
- 日志采集端必须与生产同区域（境内），禁止把含用户标识的日志投递到境外 SaaS（compliance D4）。

## 2. 技术指标（Prometheus, /metrics）

RED 三件套/API 路由 + 队列 + 供应商：

```
http_request_duration_seconds{route,method,status}   # P50/P95（由请求日志 duration_ms 聚合）
http_request_total{route,method,status}
queue_depth{queue} · queue_age_seconds{queue}         # gen.submit/poll/transfer
task_status_total{from,to}                            # 状态机迁移计数
vendor_request_duration{vendor,op} · vendor_error_total{vendor,code}
credits_frozen / credits_settled / credits_unfrozen (counter)
```

> 现状：`/v1/metrics` 已暴露任务状态分布、15min 失败率、待支付超时、**已支付未入账**、进程指标；
> 路由级 RED（`http_request_*`）当前由请求日志在采集端聚合，如需服务端直出另行接入（P2）。

## 3. 业务指标（竞品式供给看板，metrics.md §4 数据源）

| 指标 | 定义 | 告警阈值 |
|---|---|---|
| 任务成功率(1h 窗) | SUCCEEDED/(S+FAILED) | <85% 告警, <70% 页面降级提示 |
| 供应商 P95 延迟(提交→终态) | 按 vendor | > 模型 P99×1.5 告警 |
| 单任务均成本 | 结算积分↔供应商成本 | 毛利率 <25% 告警(定价复核) |
| 队列积压 | depth+age | age>5min 告警 |
| 审核拦截率 | REVIEW_REJECTED/全部 | >5% 告警(内容安全复盘) |
| AI 标识后处理失败率 | post-process 失败/成功转存 | >0.5% 告警；>0 即检查 ffmpeg/字体/磁盘 |
| 已支付未入账 | `oneframe_orders_paid_without_credit` | >0 立即 P0（用户付了钱没到账） |

## 4. 告警路由

| 级别 | 条件 | 通道 | 响应 |
|---|---|---|---|
| P0 | API 5xx>1% / DB 不可达 / 支付回调失败 / `paid_without_credit>0` | 电话+IM | 立即, 止血优先 |
| P1 | 任务成功率<85% / 队列 age>5min / 余额对账不平 / 慢请求持续 5min | IM 群@值班 | 1h 内 |
| P2 | 毛利率漂移 / 探针失败 / 证书 14 天到期 / `aborted` 占比突增 | IM 群 | 当日 |

## 5. Sentry 配置

- DSN 指向**境内/自建** Sentry（compliance D4 禁境外 SaaS）；未就绪前关闭用户级上报，只报 code/route；前后端共用 DSN，`release=git sha`；sourcemap CI 上传；
- 归则：错误按 route+code 聚合；`task_id/vendor_task_id` 作为 tag 便于串查；
- 前端把信封错误码非 0 的响应上报为 message（含 code，不含用户提示词）。

## 6. 状态页

MVP 用静态页(手动更新)：api / 生成服务 / 支付 三组件；P0 事故 15min 内更新。

## 7. 上线前观测自检（对应 `launch-checklist.md`）

| 检查 | 命令/方式 | 通过判据 |
|---|---|---|
| LOG-01 worker 脱敏 | `grep redact apps/worker/src/main.ts` | 含 `access_token` 脱敏规则 |
| LOG-02 api 脱敏 | `node _acceptance/compliance-check.cjs` | LOG-02 PASS（字段白名单 + 手机号掩码） |
| LOG-03 接线 | 同上 | LOG-03 PASS（AppModule `configure` 注册中间件） |
| LOG-04 运行态 | `curl -sD- -o/dev/null http://127.0.0.1:3000/v1/ping \| grep -i x-request-id` | 返回头与日志 `request_id` 同值 |
| LOG-05 契约测试 | `pnpm --filter @app/api test` | `test/observability.spec.ts` 12 项全绿 |
