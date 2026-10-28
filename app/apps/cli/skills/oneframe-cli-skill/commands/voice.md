# `voice` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 1 条命令：可用 0 条、骨架 1 条。

## `voice list`

音色列表

```text
oneframe voice list [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：voice 端点未落地；音色相关在 /op 与 resource voice-*（两者均未落地），待取证
- 契约证据：`commands/voice.md:17`
