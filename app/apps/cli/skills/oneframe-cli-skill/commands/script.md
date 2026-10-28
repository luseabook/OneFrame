# `script` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 6 条命令：可用 6 条、骨架 0 条。

## `script storyboard`

从文本节点拆分镜

```text
oneframe script storyboard [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvas/canvases/{canvas_id}/nodes/{node_id}/storyboard-parse`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/script.md:41`

## `script asset-extract`

从文本节点提取资产

```text
oneframe script asset-extract [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvas/canvases/{canvas_id}/nodes/{node_id}/asset-extraction`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/script.md:64`

## `script asset-match`

分镜资产匹配

```text
oneframe script asset-match [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvas/canvases/{canvas_id}/nodes/{node_id}/storyboard-asset-match`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/script.md:80`

## `script rematch`

重新匹配

```text
oneframe script rematch [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvas/canvases/{canvas_id}/nodes/{node_id}/storyboard-asset-rematch`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/script.md:96`

## `script cancel`

取消匹配

```text
oneframe script cancel [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvas/canvases/{canvas_id}/nodes/{node_id}/storyboard-asset-match/cancel`
- 契约证据：`commands/script.md:112`

## `script optimize`

脚本优化

```text
oneframe script optimize [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvas/canvases/{canvas_id}/nodes/{node_id}/script-optimization`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/script.md:128`
