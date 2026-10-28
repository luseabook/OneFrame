# `workspace` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 7 条命令：可用 7 条、骨架 0 条。

## `workspace create`

创建工作区（我方 = 项目）

```text
oneframe workspace create [NAME] [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects`
- 契约证据：`commands/workspace.md:29`

## `workspace list`

列出当前空间工作区

```text
oneframe workspace list [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET projects`
- `--set` 进 query 的白名单键：`page`、`page_size`
- 契约证据：`commands/workspace.md:58`

## `workspace info`

工作区详情

```text
oneframe workspace info <WORKSPACE_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET projects/{project_id}`
- 契约证据：`commands/workspace.md:82`

## `workspace edit`

修改工作区名称

```text
oneframe workspace edit <WORKSPACE_ID> [NAME] [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`PATCH projects/{project_id}`
- 契约证据：`commands/workspace.md:106`

## `workspace delete`

删除工作区（我方为归档）

```text
oneframe workspace delete <WORKSPACE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`DELETE projects/{project_id}`
- 契约证据：`commands/workspace.md:128`

## `workspace use`

绑定当前工作区

```text
oneframe workspace use <WORKSPACE_ID> [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/workspace.md:149`

## `workspace show`

查看当前绑定

```text
oneframe workspace show [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/workspace.md:171`
