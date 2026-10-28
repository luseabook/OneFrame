# `episode` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 15 条命令：可用 13 条、骨架 2 条。

## `episode list`

列出项目剧集与分镜矩阵

```text
oneframe episode list [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET projects/{project_id}/matrix`
- 契约证据：`commands/episode.md:57`

## `episode create`

新增空集（我方按 count 批量）

```text
oneframe episode create [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/episodes`
- 契约证据：`commands/episode.md:78`

## `episode get`

剧集详情（含分镜）

```text
oneframe episode get <EPISODE_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET projects/{project_id}/episodes/{episode_id}`
- 契约证据：`commands/episode.md:94`

## `episode edit`

修改剧集

```text
oneframe episode edit <EPISODE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`PATCH projects/{project_id}/episodes/{episode_id}`
- 契约证据：`commands/episode.md:110`

## `episode split`

按剧本文本拆集

```text
oneframe episode split [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/episodes/split`
- 契约证据：`commands/episode.md:160`

## `episode delete`

删除剧集（连同该集的分镜、时间线、导出与资源引用一起删；不重排集号）

```text
oneframe episode delete <EPISODE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`DELETE projects/{project_id}/episodes/{episode_id}`
- 契约证据：`commands/episode.md:126`

## `episode batch-create`

批量建集，逐集给标题/集号（`--set @episodes.json`，items 每项 name/sort/synopsis）

```text
oneframe episode batch-create [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/episodes/batch`
- 契约证据：`commands/episode.md:142`

## `episode split-list`

查看拆集结果（= 项目剧集矩阵，拆集结果直接落 episodes）

```text
oneframe episode split-list [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET projects/{project_id}/matrix`
- 契约证据：`commands/episode.md:176`

## `episode split-delete`

删除拆集结果

```text
oneframe episode split-delete [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：拆集结果直接落 episodes，没有独立的“拆集结果”实体（我方无该端点）；要删请 PATCH 单集，整项目用 workspace delete（归档）
- 契约证据：`commands/episode.md:195`

## `episode prompt-templates`

提示词模板目录

```text
oneframe episode prompt-templates [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无提示词模板目录端点（模板批次未落地）；当前用 `--set prompt_type=` / `--set prompt_ukid=` 直接传模板标识
- 契约证据：`commands/episode.md:211`

## `episode match-resources`

提交资产匹配组合任务（异步，返回 task_id）

```text
oneframe episode match-resources <EPISODE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/episodes/{episode_id}/match-resources`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/episode.md:261`

## `episode save-resource-matches`

保存资产匹配结果

```text
oneframe episode save-resource-matches <EPISODE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/episodes/{episode_id}/save-resource-matches`
- 契约证据：`commands/episode.md:368`

## `episode parse`

逐集解析角色/场景/道具（项目级，异步）

```text
oneframe episode parse [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/episodes/parse`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/episode.md:389`

## `episode parse-retry`

重试解析

```text
oneframe episode parse-retry [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/episodes/parse-retry`
- 契约证据：`commands/episode.md:407`

## `episode parse-result`

查看解析/匹配结果

```text
oneframe episode parse-result <EPISODE_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET projects/{project_id}/episodes/{episode_id}/match-result`
- 契约证据：`commands/episode.md:429`
