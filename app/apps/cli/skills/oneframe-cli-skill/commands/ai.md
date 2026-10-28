# `ai` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 2 条命令：可用 0 条、骨架 2 条。

## `ai upscale`

AI 放大

```text
oneframe ai upscale [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无 ai 工具独立端点；后处理能力在工具箱：`POST /generations`（mode 取自 GET /generations/tools）
- 契约证据：`commands/ai.md:29`

## `ai subtitle-erase`

去字幕

```text
oneframe ai subtitle-erase [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：用工具箱入口：mode=de_subtitle_auto|de_subtitle_region（`GET /generations/tools` 目录；Web 侧 /create/video-upscale）
- 契约证据：`commands/ai.md:45`
