# `redraw` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 2 条命令：可用 0 条、骨架 2 条。

## `redraw info`

重绘信息

```text
oneframe redraw info [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：redraw 域本轮由队友落地（modules/redraw）；CLI 接线放下一轮，当前无端点
- 契约证据：`commands/redraw.md:27`

## `redraw create`

创建重绘

```text
oneframe redraw create [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：同上：modules/redraw 落地后接；当前无端点
- 契约证据：`commands/redraw.md:68`
