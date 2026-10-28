# `agent` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 5 条命令：可用 3 条、骨架 2 条。

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

进入交互式会话

```text
oneframe agent enter [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：交互式 REPL 未实现；用 `agent session-create --canvas <ID>` + `POST /v1/canvas/canvases/:id/chat/sessions/:sid/messages`
- 契约证据：`commands/agent.md:93`

## `agent run`

运行一轮对话

```text
oneframe agent run [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：`POST /agent/task/chat` 是 SSE 流（CLI 未接流式）；非交互场景用 canvas chat 的 REST 消息端点
- 契约证据：`commands/agent.md:135`
