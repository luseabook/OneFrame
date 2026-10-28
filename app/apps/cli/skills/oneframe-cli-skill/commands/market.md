# `market` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 3 条命令：可用 3 条、骨架 0 条。

## `market list`

市场剧本列表

```text
oneframe market list [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET market/scripts`
- `--set` 进 query 的白名单键：`page`、`page_size`、`keyword`、`category_id`、`sort`
- 契约证据：`commands/market.md:27`

## `market get`

市场剧本详情

```text
oneframe market get <NM_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET market/scripts/{nm_id}/detail`
- 契约证据：`commands/market.md:51`

## `market mine`

我的上架作品

```text
oneframe market mine [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET market/creator/works`
- `--set` 进 query 的白名单键：`page`、`page_size`、`status`
- 契约证据：`commands/market.md:99`
