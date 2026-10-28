# `upload` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 1 条命令：可用 1 条、骨架 0 条。

## `upload`

上传并解析剧本文件（txt/md/csv/docx/xlsx）

```text
oneframe upload <PATH> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/parse-script`
- 契约证据：`commands/upload.md:17`
