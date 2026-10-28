# `node` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 10 条命令：可用 10 条、骨架 0 条。

## `node create`

创建节点

```text
oneframe node create <NODE_TYPE> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvas/canvases/{canvas_id}/nodes`
- 契约证据：`commands/node.md:35`

## `node batch-create`

批量创建节点

```text
oneframe node batch-create [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvas/canvases/{canvas_id}/nodes/batch`
- 契约证据：`commands/node.md:161`

## `node list`

列出画布节点

```text
oneframe node list [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET canvas/canvases/{canvas_id}/nodes`
- `--set` 进 query 的白名单键：`page`、`page_size`
- 契约证据：`commands/node.md:188`

## `node get`

查看单个节点（客户端按 --node/位置参数过滤）

```text
oneframe node get <NODE_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET canvas/canvases/{canvas_id}/nodes`
- 契约证据：`commands/node.md:210`

## `node edit`

修改节点

```text
oneframe node edit <NODE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`PATCH canvas/canvases/{canvas_id}/nodes/{node_id}`
- 契约证据：`commands/node.md:233`

## `node delete`

删除节点

```text
oneframe node delete <NODE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`DELETE canvas/canvases/{canvas_id}/nodes/{node_id}`
- 契约证据：`commands/node.md:264`

## `node generate`

节点生成（图/视频/文本，付费）

```text
oneframe node generate <NODE_TYPE> [NODE_ID] [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvas/canvases/{canvas_id}/nodes/{node_id}/generate`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/node.md:287`

## `node table-import`

表格节点导入文件

```text
oneframe node table-import <NODE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvas/canvases/{canvas_id}/nodes/{node_id}/table/import`
- 契约证据：`commands/node.md:386`

## `node table-confirm`

表格节点确认工作表

```text
oneframe node table-confirm <NODE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvas/canvases/{canvas_id}/nodes/{node_id}/table/confirm-sheet`
- 契约证据：`commands/node.md:408`

## `node edge`

建立连线（--left / --right）

```text
oneframe node edge [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvas/canvases/{canvas_id}/edges`
- 契约证据：`commands/edge.md:8`
