# `material` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 6 条命令：可用 3 条、骨架 3 条。

## `material add`

添加画布素材

```text
oneframe material add <FILE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvases/{canvas_id}/materials`
- 契约证据：`commands/material.md:39`

## `material list`

列出画布素材

```text
oneframe material list [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET canvases/{canvas_id}/materials`
- `--set` 进 query 的白名单键：`page`、`page_size`
- 契约证据：`commands/material.md:113`

## `material delete`

批量删除素材

```text
oneframe material delete [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST canvases/{canvas_id}/materials/batch-delete`
- 契约证据：`commands/material.md:149`

## `material batch-add`

批量添加素材

```text
oneframe material batch-add [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无批量加素材端点；用 `node batch-create` 或循环 `material add`
- 契约证据：`commands/material.md:86`

## `material get`

查看素材信息

```text
oneframe material get [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无单条素材端点；用 `material list --canvas <ID> --set page=1` 过滤
- 契约证据：`commands/material.md:131`

## `material confirm`

确认素材

```text
oneframe material confirm [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方素材无确认态（POST /canvas/.../materials 落库即用）
- 契约证据：`commands/material.md:167`
