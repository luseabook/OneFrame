# `workflow` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 3 条命令：可用 3 条、骨架 0 条。

## `workflow detect`

只读探测当前阶段（服务端 GET /workflow/detect）

```text
oneframe workflow detect [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/workflow.md:23`

## `workflow status`

同 detect，另附本地上次执行位置

```text
oneframe workflow status [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/workflow.md:45`

## `workflow resume`

以 --from 阶段为起点重算待办并记录位置

```text
oneframe workflow resume [--json]
```

- 状态：可用（纯客户端，不发请求）
- 契约证据：`commands/workflow.md:61`
