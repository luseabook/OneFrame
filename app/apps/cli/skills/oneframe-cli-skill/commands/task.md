# `task` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 8 条命令：可用 7 条、骨架 1 条。

## `task get`

查询任务详情

```text
oneframe task get <TASK_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET tasks/{task_id}`
- 契约证据：`commands/task.md:31`

## `task list`

列出当前空间任务

```text
oneframe task list [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET tasks`
- `--set` 进 query 的白名单键：`page`、`page_size`、`status`、`capability`
- 契约证据：`commands/task.md:52`

## `task wait`

阻塞等待任务终态（客户端轮询 GET /tasks/:id）

```text
oneframe task wait <TASK_ID> [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/task.md:76`

## `task cancel`

取消任务

```text
oneframe task cancel <TASK_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST tasks/{task_id}/cancel`
- 契约证据：`commands/task.md:99`

## `task retry`

重试失败任务（会重复下单扣费）

```text
oneframe task retry <TASK_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST tasks/{task_id}/retry`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/task.md:121`

## `task download`

把任务产物下载到 ./outputs/<task_id>-<n>.<ext>（不输出签名 URL）

```text
oneframe task download <TASK_ID> [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/task.md:165`

## `task regenerate`

用原任务信息重新提交生成（会再次扣费，先 --dry-run）

```text
oneframe task regenerate <TASK_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST tasks/{task_id}/regenerate`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/task.md:143`

## `task delete`

删除任务记录

```text
oneframe task delete [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无删除任务端点；结果按 tasks.expire_at（90 天）自动过期，需要“看不见”请在列表侧过滤
- 契约证据：`commands/task.md:195`
