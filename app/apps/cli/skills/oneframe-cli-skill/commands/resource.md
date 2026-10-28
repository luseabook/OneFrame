# `resource` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 17 条命令：可用 15 条、骨架 2 条。

## `resource list`

列出项目资产（角色/场景/道具）

```text
oneframe resource list [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET projects/{project_id}/assets`
- `--set` 进 query 的白名单键：`kind`
- 契约证据：`commands/resource.md:190`

## `resource extract`

创建资产提取任务（异步，返回 et_id）

```text
oneframe resource extract [SP_ID] [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST extraction/tasks`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/resource.md:536`

## `resource extract-status`

查询提取任务状态（1 进行中/2 成功/3 失败/4 失效）

```text
oneframe resource extract-status <ET_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET extraction/tasks/{task_id}`
- 契约证据：`commands/resource.md:570`

## `resource extract-redo`

重做失败/失效的提取任务

```text
oneframe resource extract-redo [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST extraction/tasks/redo`
- 契约证据：`commands/resource.md:602`

## `resource draft-list`

列出提取草稿

```text
oneframe resource draft-list [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET extraction/drafts`
- `--set` 进 query 的白名单键：`task_id`、`eed_id`、`kind`、`state`、`is_all`、`episode_id`、`project_id`、`page`、`page_size`
- 契约证据：`commands/resource.md:704`

## `resource draft-import`

导入/更新提取草稿（返回 eed_id）

```text
oneframe resource draft-import [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST extraction/drafts/import`
- 契约证据：`commands/resource.md:619`

## `resource generate-list`

查看资产生成候选

```text
oneframe resource generate-list <RESOURCE_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET projects/{project_id}/assets/{asset_id}/candidates`
- 契约证据：`commands/resource.md:341`

## `resource get`

查看单个资源（项目资产详情）

```text
oneframe resource get <RESOURCE_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET projects/{project_id}/assets/{asset_id}`
- 契约证据：`commands/resource.md:223`

## `resource add`

新增项目资产（kind=scene|prop|other，角色走 characters）

```text
oneframe resource add [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/assets`
- 契约证据：`commands/resource.md:255`

## `resource generate`

生成资产参考图（异步，返回 task_id）

```text
oneframe resource generate <RESOURCE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/assets/{asset_id}/generate-image`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/resource.md:317`

## `resource confirm`

确认资产（status=2 定稿）

```text
oneframe resource confirm <RESOURCE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`PATCH projects/{project_id}/assets/{asset_id}`
- 契约证据：`commands/resource.md:359`

## `resource unconfirm`

取消确认（status=1 退回草稿）

```text
oneframe resource unconfirm <RESOURCE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`PATCH projects/{project_id}/assets/{asset_id}`
- 契约证据：`commands/resource.md:406`

## `resource batch-confirm`

批量确认（`--set asset_ids=[id,id]` 定稿；任一 id 不属于本项目则整批失败）

```text
oneframe resource batch-confirm [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/assets/batch-confirm`
- 契约证据：`commands/resource.md:422`

## `resource batch-info`

批量查询资产详情（`--set asset_ids=[id,id]`；查不到的进 missing，不整体报错）

```text
oneframe resource batch-info [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/assets/batch-info`
- 契约证据：`commands/resource.md:96`

## `resource extract-wait`

阻塞等待提取任务到终态（客户端轮询 GET /extraction/tasks/:id）

```text
oneframe resource extract-wait <ET_ID> [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/resource.md:586`

## `resource prompt-template`

生成官方资产提示词空表

```text
oneframe resource prompt-template [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：xlsx 模板导出端点未落地（待取证）；当前 `--set` 直接提交 JSON
- 契约证据：`commands/resource.md:145`

## `resource prompt-sheet-read`

回读资产提示词表

```text
oneframe resource prompt-sheet-read [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：xlsx 回读端点未落地（待取证）；批量导入用 `resource draft-import --set @assets.json`
- 契约证据：`commands/resource.md:163`
