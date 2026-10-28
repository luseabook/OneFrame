# `ai` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 2 条命令：可用 2 条、骨架 0 条。

## `ai upscale`

AI 放大（工具箱 video_upscale：1080p/2K/4K 按档计费）

```text
oneframe ai upscale <VIDEO_URI> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST generations`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/ai.md:29`

## `ai subtitle-erase`

去字幕（默认自动检测；框选区域用 `--set mode=de_subtitle_region --set model=toolbox-de-subtitle-region`）

```text
oneframe ai subtitle-erase <VIDEO_URI> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST generations`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/ai.md:45`
