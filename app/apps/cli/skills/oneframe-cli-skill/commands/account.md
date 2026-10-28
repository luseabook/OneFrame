# `account` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 2 条命令：可用 2 条、骨架 0 条。

## `account info`

查看当前账号与空间（不含 token）

```text
oneframe account info [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/account.md:19`

## `account use`

切换本地当前账号（不发远端请求）

```text
oneframe account use <UID> [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/account.md:47`
