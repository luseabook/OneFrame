# `group` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 6 条命令：可用 4 条、骨架 2 条。

## `group create`

创建组

```text
oneframe group create [NAME] [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvases/{canvas_id}/groups`
- 契约证据：`commands/group.md:27`

## `group delete`

删除组

```text
oneframe group delete <GROUP_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`DELETE canvases/{canvas_id}/groups/{group_id}`
- 契约证据：`commands/group.md:86`

## `group template-save`

把组存成模板

```text
oneframe group template-save <GROUP_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvases/{canvas_id}/groups/{group_id}/templates`
- 契约证据：`commands/group.md:110`

## `group template-list`

列出组模板

```text
oneframe group template-list [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET canvases/{canvas_id}/group-templates`
- 契约证据：`commands/group.md:136`

## `group execute`

组执行（整组跑生成）

```text
oneframe group execute [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：canvas 域无 group execute 端点；逐节点 `node generate <TYPE> <NODE_ID>` 提交
- 契约证据：`commands/group.md:53`

## `group template-get`

查看单个组模板

```text
oneframe group template-get [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方只有 `group template-list`（GET /canvas/canvases/:id/group-templates 列表），无单模板端点
- 契约证据：`commands/group.md:157`
