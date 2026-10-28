# `team` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 2 条命令：可用 2 条、骨架 0 条。

## `team info`

团队信息

```text
oneframe team info [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET cam/team/info`
- 契约证据：`commands/team.md:19`

## `team permission`

当前成员权限上下文

```text
oneframe team permission [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET cam/permission/user`
- 契约证据：`commands/team.md:41`
