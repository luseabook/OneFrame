# `novel` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 6 条命令：可用 5 条、骨架 1 条。

## `novel config`

小说改写配置

```text
oneframe novel config [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无 novel/config 端点；可配置项直接走 `novel create --set key=value`，现有任务用 `novel get <NT_ID>` 查看
- 契约证据：`commands/novel.md:59`

## `novel create`

创建小说改写任务（--set title=… / source_text=…）

```text
oneframe novel create [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST novel`
- 契约证据：`commands/novel.md:84`

## `novel analyze`

触发内容分析（世界/角色/章节）

```text
oneframe novel analyze <NT_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST novel/{nt_id}/content-analysis`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/novel.md:240`

## `novel list`

小说任务列表

```text
oneframe novel list [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET novel/list`
- `--set` 进 query 的白名单键：`page`、`page_size`、`status`、`keyword`
- 契约证据：`commands/novel.md:391`

## `novel get`

小说任务详情

```text
oneframe novel get <NT_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET novel/{nt_id}`
- 契约证据：`commands/novel.md:414`

## `novel finalize`

小说定稿（定稿后才能作为制片工坊拆集源）

```text
oneframe novel finalize <NT_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST novel/{nt_id}/finalize`
- 契约证据：`commands/novel.md:663`
