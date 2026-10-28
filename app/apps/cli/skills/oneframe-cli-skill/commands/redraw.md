# `redraw` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 2 条命令：可用 2 条、骨架 0 条。

## `redraw info`

转绘项目四段进度（`video_redraw_stage` / `video_redraw_stage_status`）

```text
oneframe redraw info [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET video-redraw/projects/{project_id}`
- 契约证据：`commands/redraw.md:27`

## `redraw create`

创建转绘项目（--set title=… source_uri=… 可选 redraw_strength=0..100 / style=anime|ghibli|ink|comic|cyberpunk）

```text
oneframe redraw create [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST video-redraw/projects`
- 契约证据：`commands/redraw.md:68`
