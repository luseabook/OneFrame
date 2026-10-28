# `pin-group` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 3 条命令：可用 3 条、骨架 0 条。

## `pin-group create`

创建/替换固定组成员（按 slot）

```text
oneframe pin-group create <SLOT> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`PUT canvas/canvases/{canvas_id}/pin-groups/{slot}`
- 契约证据：`commands/pin-group.md:19`

## `pin-group delete`

删除固定组

```text
oneframe pin-group delete <PIN_GROUP_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`DELETE canvas/canvases/{canvas_id}/pin-groups/{slot}`
- 契约证据：`commands/pin-group.md:42`

## `pin-group list`

列出固定组（我方端点，竞品无对应子命令）

```text
oneframe pin-group list [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET canvas/canvases/{canvas_id}/pin-groups`
- 契约证据：`commands/pin-group.md:63`
