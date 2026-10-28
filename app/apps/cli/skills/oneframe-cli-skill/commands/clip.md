# `clip` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 2 条命令：可用 0 条、骨架 2 条。

## `clip create`

创建剪辑

```text
oneframe clip create [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：clip 无独立端点（画布有 clip 节点与 timeline clips）；用 `node create clip` + `PUT .../timeline`
- 契约证据：`commands/clip.md:23`

## `clip crop`

裁剪

```text
oneframe clip crop [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：同上：无独立裁剪端点，走画布节点/timeline
- 契约证据：`commands/clip.md:45`
