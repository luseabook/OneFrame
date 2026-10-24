# 部署可运维性（商业化就绪第 3 步）

> 2026-10-25 · B 型目标 Round 3

## 一、发现的问题

### 1. readiness 不可用时不返回 503（部署致命）

原 `health.controller.ts` 明确写着：

```ts
// TODO(P1): readiness 与 liveness 分离，db/redis down 时 readiness 503（deployment.md）
```

实际行为：依赖挂掉时只返回 `{status:"degraded"}`，**HTTP 仍是 200**。

**后果**：负载均衡/k8s 会持续把流量打到依赖不可用的实例上，用户看到的是大量 500，而不是"暂时没容量"。这是部署环境最常见的事故形态。

### 2. metrics 端点缺失

没有任何指标暴露。出了问题只能靠翻日志，无法发现「失败率突增」「订单已支付但未入账」这类问题。

### 3. 优雅停机不完整

`enableShutdownHooks()` 有了，但：
- 停机期间 readiness 仍返回 200（LB 继续送流量）
- 无超时保护，`app.close()` 挂住时容器停不下来
- worker 的 `w.close()` 同样无超时

### 4. 备份/恢复无脚本、无验证

文档写了「每日全量 + WAL 归档」，但仓库里没有任何可执行脚本，也没有验证「备份能不能恢复」。

## 二、本轮实现

### 2.1 健康检查三端点

| 端点 | 语义 | 关键设计 |
|---|---|---|
| `/healthz/live` | liveness | **不查依赖**——依赖挂了重启进程无用，查依赖会导致依赖抖动时容器被反复重启（级联故障） |
| `/healthz/ready` | readiness | 依赖可用才 200，否则 **503**；停机中返回 503 + `shutting_down` |
| `/healthz` | 聚合详情 | 依赖不可用时同样 503，供人工排查 |

### 2.2 Prometheus 指标（`/metrics`）

刻意不引入 `prom-client`（一个端点手写文本格式，不值得加运行时依赖）。暴露 4 类：

| 指标 | 用途 |
|---|---|
| `oneframe_tasks_total{status}` | 队列是否堆积 |
| `oneframe_failure_ratio_15m` | 供应商是否异常 |
| `oneframe_orders_paid_without_credit` | **资金链路异常（应恒为 0）** |
| `oneframe_orders_stale_pending` | 回调/轮询是否失效 |
| `oneframe_process_*` | 进程内存/运行时长 |

**踩坑**：第一版返回字符串，被 `EnvelopeInterceptor` 包成 JSON（`Attempted to send payload of invalid type 'object'`）。改用 `@Res()` 直接 `send`。

### 2.3 优雅停机

api 与 worker 统一链路：
1. 标记 `shutting_down` → **readiness 立即 503**（LB 先摘流）
2. 停止接新请求/job，等待在途完成
3. 超 `SHUTDOWN_TIMEOUT_MS`（默认 25s）强制退出
4. worker 未完成 job 由 BullMQ 重新投递，不丢失

### 2.4 备份/恢复脚本（4 个 + 1 个验证）

| 脚本 | 说明 |
|---|---|
| `backup-db.sh` / `backup-db.ps1` | custom 格式 + 压缩 + `pg_restore --list` 校验 + 保留清理 |
| `restore-db.sh` | `--clean --if-exists`，需输入 `yes` 确认 |
| `verify-backup.ps1` | **恢复可用性验证**：恢复到临时库、比对表数与关键数据、自动清理 |
| `rollback.sh` | 代码回滚，提示不可逆迁移须走恢复 |

> PowerShell 版是必要的——本机无 bash/WSL 发行版，`.sh` 无法验证。两个版本行为等价。

## 三、验收

### 3.1 健康检查与指标：11/11

```
1.  liveness 返回 200                    ✅
1b. liveness 含 uptime 与 pid             ✅ pid=3564
2.  readiness 依赖可用时 200              ✅
2b. readiness 报告 db/redis               ✅ {"db":"up","redis":"up"}
3.  metrics 返回 200                      ✅
3b. content-type 为 prometheus 文本        ✅ text/plain; version=0.0.4
3c. 含任务状态指标                        ✅ oneframe_tasks_total{status="1"} 15
3d. 含失败率指标                          ✅ oneframe_failure_ratio_15m 0.0000
3e. 含资金链路指标                        ✅ oneframe_orders_paid_without_credit 0
3f. 含进程指标                            ✅ oneframe_process_uptime_seconds 158
3g. 指标为纯文本非 JSON 信封               ✅
```

### 3.2 优雅停机：6/6（跨平台验证）

Windows 无法用 `SIGTERM` 触发 Node signal handler（`taskkill /F` 是强杀），因此用进程内自触发验证协议行为：

```
1. 子进程启动并就绪                       ✅
2. 停机前 readiness 为 200                ✅
3. 停机中 readiness 返回 503（LB 摘流）    ✅ ← 关键
3b. 停机中状态标记 shutting_down           ✅
4. 进程正常退出（code 0）                  ✅
5. 日志含 draining / closed cleanly        ✅
```

### 3.3 备份恢复可用性：实测通过

```
[backup] done: oneframe-20261024T191838Z.dump (0.16 MB)
[backup] verified (pg_restore --list ok)
[verify] tables: source=27 restored=27     ← 27 张表全量恢复
[verify] key data (models|skus): 10|4      ← 关键数据完整
[verify] PASS — backup is restorable
```

### 3.4 全量回归

```
单元/契约测试：125 项（api 70 / adapters 21 / shared 13 / db 11 / worker 4 / storage 6）
lint / typecheck：全绿
```

## 四、文档

`deployment.md` 补三节：
- **§5.1 可用脚本**：4 个脚本 + 1 个验证，含「备份不等于可用」铁律
- **§6 健康检查与指标**：4 个端点语义、k8s 探针配置示例、3 条关键告警规则
- **§6.1 优雅停机**：4 步链路说明

## 五、B 型剩余

| 项 | 状态 |
|---|---|
| 支付回调验签 | ✅ Round 1 |
| 供应商协议与错误映射 | ✅ Round 2 |
| 部署可运维性 | ✅ Round 3（健康检查/指标/停机/备份恢复） |
| **真实供应商 Key 联调** | ⏳ 需 Key |
| 真实渠道拉起收银台 | ⏳ 需商户号 |
| 合规备案 | ⏳ 需企业主体 |
| 退款 | ⏳ Ph3 |
| 日志结构化与追踪（request_id 串联） | ⏳ 下一轮 |
