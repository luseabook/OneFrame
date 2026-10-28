# `file` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 3 条命令：可用 0 条、骨架 3 条。

## `file metadata`

查看文件元数据

```text
oneframe file metadata [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无独立文件端点；产物元数据在 `task get <ID>` 的 results 里（含 size/content_type）
- 契约证据：`commands/file.md:21`

## `file object`

查看对象

```text
oneframe file object [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无对象存储浏览端点（key 由服务端生成，不对外枚举）
- 契约证据：`commands/file.md:43`

## `file sign-url`

获取文件签名 URL

```text
oneframe file sign-url [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：签名 URL 内嵌在 `GET /tasks/:id/results/:n/download-url`；用 `task download <ID>` 一步落盘
- 契约证据：`commands/file.md:65`
