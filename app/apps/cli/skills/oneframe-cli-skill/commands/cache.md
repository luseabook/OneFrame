# `cache` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 2 条命令：可用 2 条、骨架 0 条。

## `cache info`

查看本地可重建缓存

```text
oneframe cache info [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/cache.md:19`

## `cache clear`

清理缓存范围 --scope models|env|uploads

```text
oneframe cache clear [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/cache.md:39`
