# 可观测性

> v1.1 · 2026-10-24 · Sentry + 结构化日志 + Prometheus 指标 + 业务看板（竞品同用 Sentry〔RM-证据：sentry ingest 域名〕）
> v1.1 变更：Sentry 改境内/自建（compliance D4，RE-16）；新增 AI 标识后处理失败率指标（RE-07）

## 1. 日志规范

- 库：pino（JSON 行）；每请求注入 `request_id`（响应头同号回传，用户报障可查）；
- 必记字段：`level, time, request_id, uid, space_id, module, event`；
- 任务全生命周期：`task.submitted / task.vendor_submitted / task.poll / task.transferred / task.settled / task.failed`（含 vendor_task_id、credits）；
- **禁记**：完整提示词（记长度+哈希前 8 位）、token、手机号全量（掩码 138****1234）、签名 URL。

## 2. 技术指标（Prometheus, /metrics）

RED 三件套/API 路由 + 队列 + 供应商：

```
http_request_duration_seconds{route,method,status}   # P50/P95
http_request_total{route,method,status}
queue_depth{queue} · queue_age_seconds{queue}         # gen.submit/poll/transfer
task_status_total{from,to}                            # 状态机迁移计数
vendor_request_duration{vendor,op} · vendor_error_total{vendor,code}
credits_frozen / credits_settled / credits_unfrozen (counter)
```

## 3. 业务指标（竞品式供给看板，metrics.md §4 数据源）

| 指标 | 定义 | 告警阈值 |
|---|---|---|
| 任务成功率(1h 窗) | SUCCEEDED/(S+FAILED) | <85% 告警, <70% 页面降级提示 |
| 供应商 P95 延迟(提交→终态) | 按 vendor | > 模型 P99×1.5 告警 |
| 单任务均成本 | 结算积分↔供应商成本 | 毛利率 <25% 告警(定价复核) |
| 队列积压 | depth+age | age>5min 告警 |
| 审核拦截率 | REVIEW_REJECTED/全部 | >5% 告警(内容安全复盘) |
| AI 标识后处理失败率 | post-process 失败/成功转存 | >0.5% 告警；>0 即检查 ffmpeg/字体/磁盘 |

## 4. 告警路由

| 级别 | 条件 | 通道 | 响应 |
|---|---|---|---|
| P0 | API 5xx>1% / DB 不可达 / 支付回调失败 | 电话+IM | 立即, 止血优先 |
| P1 | 任务成功率<85% / 队列 age>5min / 余额对账不平 | IM 群@值班 | 1h 内 |
| P2 | 毛利率漂移 / 探针失败 / 证书 14 天到期 | IM 群 | 当日 |

## 5. Sentry 配置

- DSN 指向**境内/自建** Sentry（compliance D4 禁境外 SaaS）；未就绪前关闭用户级上报，只报 code/route；前后端共用 DSN，`release=git sha`；sourcemap CI 上传；
- 归则：错误按 route+code 聚合；`task_id/vendor_task_id` 作为 tag 便于串查；
- 前端把信封错误码非 0 的响应上报为 message（含 code，不含用户提示词）。

## 6. 状态页

MVP 用静态页(手动更新)：api / 生成服务 / 支付 三组件；P0 事故 15min 内更新。
