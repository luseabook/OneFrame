# `canvas` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 10 条命令：可用 10 条、骨架 0 条。

## `canvas create`

创建画布

```text
oneframe canvas create [NAME] [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvases`
- 契约证据：`commands/canvas.md:33`

## `canvas list`

列出画布

```text
oneframe canvas list [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET canvases`
- `--set` 进 query 的白名单键：`page`、`page_size`
- 契约证据：`commands/canvas.md:56`

## `canvas get`

画布详情（含 node_list）

```text
oneframe canvas get <CANVAS_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET canvases/{canvas_id}`
- 契约证据：`commands/canvas.md:78`

## `canvas edit`

修改画布

```text
oneframe canvas edit <CANVAS_ID> [NAME] [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`PATCH canvases/{canvas_id}`
- 契约证据：`commands/canvas.md:100`

## `canvas delete`

删除画布

```text
oneframe canvas delete <CANVAS_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`DELETE canvases/{canvas_id}`
- 契约证据：`commands/canvas.md:122`

## `canvas template-publish`

把画布发布成模板

```text
oneframe canvas template-publish [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvases/{canvas_id}/tpls`
- 契约证据：`commands/canvas.md:144`

## `canvas template-list`

列出模板

```text
oneframe canvas template-list [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET templates`
- `--set` 进 query 的白名单键：`page`、`page_size`
- 契约证据：`commands/canvas.md:165`

## `canvas template-get`

模板详情

```text
oneframe canvas template-get <TEMPLATE_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET templates/{template_id}`
- 契约证据：`commands/canvas.md:185`

## `canvas template-apply`

实例化模板到画布

```text
oneframe canvas template-apply <TEMPLATE_ID> [--set KEY=VALUE]... [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET templates/{template_id}/instantiate`
- `--set` 进 query 的白名单键：`canvas_id`
- 契约证据：`commands/canvas.md:202`

## `canvas snapshots`

列出画布快照（我方端点，竞品无对应子命令）

```text
oneframe canvas snapshots [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET canvases/{canvas_id}/snapshots`
- `--set` 进 query 的白名单键：`page`、`page_size`
- 契约证据：`commands/canvas.md:220`
