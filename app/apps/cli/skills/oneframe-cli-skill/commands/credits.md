# `credits` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 4 条命令：可用 3 条、骨架 1 条。

## `credits balance`

查询积分余额

```text
oneframe credits balance [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET me`
- 契约证据：`commands/credits.md:23`

## `credits flows`

查询积分流水（带符号 points）

```text
oneframe credits flows [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET credits/flows`
- `--set` 进 query 的白名单键：`page`、`page_size`、`task_id`
- 契约证据：`commands/credits.md:64`

## `credits estimate`

生成前试算消耗（不扣费）

```text
oneframe credits estimate [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST credits/quote`
- 契约证据：`commands/credits.md:96`

## `credits log`

查询积分流水（旧接口语义：无符号 val + event_type）

```text
oneframe credits log [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方只有一套带符号 points 的口径 GET /credits/flows，没有 log 的无符号口径；请用 credits flows
- 契约证据：`commands/credits.md:43`
