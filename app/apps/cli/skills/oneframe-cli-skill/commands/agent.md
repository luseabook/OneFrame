# `agent` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 6 条命令：可用 6 条、骨架 0 条。

## `agent session-create`

创建智能体会话

```text
oneframe agent session-create [NAME] [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvas/canvases/{canvas_id}/chat/sessions`
- 契约证据：`commands/agent.md:27`

## `agent session-list`

列出智能体会话

```text
oneframe agent session-list [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET canvas/canvases/{canvas_id}/chat/sessions`
- `--set` 进 query 的白名单键：`page`、`page_size`
- 契约证据：`commands/agent.md:50`

## `agent session-delete`

删除智能体会话

```text
oneframe agent session-delete <SESSION_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`DELETE canvas/canvases/{canvas_id}/chat/sessions/{session_id}`
- 契约证据：`commands/agent.md:71`

## `agent enter`

进入交互式会话（REPL：逐行发送并实时消费 SSE 事件）

```text
oneframe agent enter <SESSION_ID> [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/agent.md:93`

## `agent run`

跑一轮对话（--set content="…"；加 --follow 消费 SSE 到本轮有结论）

```text
oneframe agent run <SESSION_ID> [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/agent.md:135`

## `agent exit`

结束会话（服务端把 status 置 2，之后发言会被拒）

```text
oneframe agent exit <SESSION_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST agent/task/chat-end`
- 契约证据：`commands/agent.md:113`
