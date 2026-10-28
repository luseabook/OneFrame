# `model` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 4 条命令：可用 3 条、骨架 1 条。

## `model list`

列出可用模型目录

```text
oneframe model list [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET models`
- `--set` 进 query 的白名单键：`capability`、`mode`、`visible`
- 契约证据：`commands/model.md:24`

## `model search`

按关键词筛选模型（客户端过滤展示名/说明）

```text
oneframe model search <KEYWORD> [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET models`
- `--set` 进 query 的白名单键：`capability`、`mode`、`visible`
- 契约证据：`commands/model.md:71`

## `model params`

查看某模型的各生成模式参数规则

```text
oneframe model params <TYPE> <MODEL_NAME> [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET models`
- `--set` 进 query 的白名单键：`capability`、`mode`、`visible`
- 契约证据：`commands/model.md:115`

## `model price`

查看模型定价

```text
oneframe model price [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无模型定价只读端点（model_prices 仅运营侧 /v1/ops/admin/model-prices，admin.controller.ts:137）
- 契约证据：`commands/model.md:92`
