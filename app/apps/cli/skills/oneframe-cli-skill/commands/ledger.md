# `ledger` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 3 条命令：可用 3 条、骨架 0 条。

## `ledger list`

列出本地幂等账本条目

```text
oneframe ledger list [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/ledger.md:34`

## `ledger show`

查看单条账本与成因

```text
oneframe ledger show <KEY> [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/ledger.md:58`

## `ledger resolve`

解除一条 in_doubt（人工复核确认未生效后）

```text
oneframe ledger resolve <KEY> [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/ledger.md:76`
