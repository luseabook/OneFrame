# `storyboard` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 18 条命令：可用 9 条、骨架 9 条。

## `storyboard list`

列出剧集分镜

```text
oneframe storyboard list <EPISODE_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET projects/{project_id}/episodes/{episode_id}`
- 契约证据：`commands/storyboard.md:61`

## `storyboard batch-generate`

AI 拆分镜生成

```text
oneframe storyboard batch-generate <EPISODE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/episodes/{episode_id}/storyboards/generate`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/storyboard.md:411`

## `storyboard batch-generate-video`

批量生视频

```text
oneframe storyboard batch-generate-video <EPISODE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/episodes/{episode_id}/storyboards/generate-videos`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/storyboard.md:389`

## `storyboard edit`

修改分镜

```text
oneframe storyboard edit <EPISODE_ID> <STORYBOARD_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`PATCH projects/{project_id}/episodes/{episode_id}/storyboards/{storyboard_id}`
- 契约证据：`commands/storyboard.md:111`

## `storyboard match-assets`

绑定分镜资产

```text
oneframe storyboard match-assets <EPISODE_ID> <STORYBOARD_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`PUT projects/{project_id}/episodes/{episode_id}/storyboards/{storyboard_id}/assets`
- 契约证据：`commands/storyboard.md:367`

## `storyboard add`

新增分镜（追加到末尾；`--set insert_after=<分镜ID>` 或 `--set shot_no=<号>` 可插队）

```text
oneframe storyboard add <EPISODE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/episodes/{episode_id}/storyboards`
- 契约证据：`commands/storyboard.md:93`

## `storyboard delete`

删除单条分镜

```text
oneframe storyboard delete <EPISODE_ID> <STORYBOARD_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`DELETE projects/{project_id}/episodes/{episode_id}/storyboards/{storyboard_id}`
- 契约证据：`commands/storyboard.md:137`

## `storyboard batch-delete`

批量删除分镜（`--set shot_ids=[id,id]`）

```text
oneframe storyboard batch-delete <EPISODE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/episodes/{episode_id}/storyboards/batch-delete`
- 契约证据：`commands/storyboard.md:153`

## `storyboard num-update`

重排分镜号（不给 shot_ids 则按现有顺序压实；`--set step=10` 可留空号）

```text
oneframe storyboard num-update <EPISODE_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST projects/{project_id}/episodes/{episode_id}/storyboards/num-update`
- 契约证据：`commands/storyboard.md:170`

## `storyboard link-draft`

关联草稿

```text
oneframe storyboard link-draft [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无“分镜草稿”概念（草稿批次未落地、无端点）；分镜即正式数据，直接 `storyboard edit`
- 契约证据：`commands/storyboard.md:186`

## `storyboard ext`

分镜扩展参数

```text
oneframe storyboard ext [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无 ext 端点；扩展字段走 `storyboard edit --set key=value`（PATCH 既有 storyboards）
- 契约证据：`commands/storyboard.md:202`

## `storyboard total-list`

跨集全量分镜

```text
oneframe storyboard total-list [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无跨集全量分镜端点；用 `episode list --workspace <SP>` 拿矩阵（含每集分镜数）再逐集 `storyboard list`
- 契约证据：`commands/storyboard.md:220`

## `storyboard batch-add`

批量新增分镜

```text
oneframe storyboard batch-add [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无批量新增端点；批量来源请走 `node table-import`（表格节点导入）
- 契约证据：`commands/storyboard.md:236`

## `storyboard prompt-template`

生成官方分镜提示词空表

```text
oneframe storyboard prompt-template [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：xlsx 模板导出端点未落地（待取证）；当前直接 `--set` 提交 JSON，或用 `node table-import` 导表
- 契约证据：`commands/storyboard.md:263`

## `storyboard sheet-read`

回读分镜提示词表

```text
oneframe storyboard sheet-read [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：xlsx 回读端点未落地（待取证）；表格数据请走 `node table-import` + `node table-confirm`
- 契约证据：`commands/storyboard.md:281`

## `storyboard draft-import`

导入分镜草稿

```text
oneframe storyboard draft-import [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：分镜草稿批次未落地（我方无草稿表）；直接 `storyboard batch-add` 不适用，改用 AI 生成
- 契约证据：`commands/storyboard.md:302`

## `storyboard draft-delete`

删除分镜草稿

```text
oneframe storyboard draft-delete [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：分镜草稿批次未落地（我方无草稿表、无端点）；无对应操作，正式分镜不提供删除
- 契约证据：`commands/storyboard.md:331`

## `storyboard draft-batch-update`

批量更新分镜草稿

```text
oneframe storyboard draft-batch-update [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：分镜草稿批次未落地；正式分镜用 `storyboard edit` 逐条改
- 契约证据：`commands/storyboard.md:350`
