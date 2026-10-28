# `export` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 4 条命令：可用 3 条、骨架 1 条。

## `export`

导出单集

```text
oneframe export <EPISODE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/episodes/{episode_id}/exports`
- 契约证据：`commands/export.md:23`

## `export get`

查看导出任务

```text
oneframe export get <EPISODE_ID> <EXPORT_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET projects/{project_id}/episodes/{episode_id}/exports/{export_id}`
- 契约证据：`commands/export.md:70`

## `export merge`

合并导出整集

```text
oneframe export merge <EPISODE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/episodes/{episode_id}/timeline/export`
- 契约证据：`commands/export.md:45`

## `export download`

下载导出产物

```text
oneframe export download [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：先 `export merge <EP> --workspace <SP>` 提交，再 `export get <EP> <XID>` 轮询拿产物；无独立下载端点
- 契约证据：`commands/export.md:86`
