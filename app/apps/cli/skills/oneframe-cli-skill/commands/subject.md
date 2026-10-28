# `subject` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 10 条命令：可用 7 条、骨架 3 条。

## `subject list`

主体列表

```text
oneframe subject list [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET subjects`
- `--set` 进 query 的白名单键：`kind`、`review_status`、`project_id`、`q`、`page`、`page_size`
- 契约证据：`commands/subject.md:38`

## `subject get`

主体详情

```text
oneframe subject get <SUBJECT_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET subjects/{subject_id}`
- 契约证据：`commands/subject.md:108`

## `subject create`

创建主体（必填 name）

```text
oneframe subject create [NAME] [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST subjects`
- 契约证据：`commands/subject.md:54`

## `subject edit`

修改主体（审核态也走这里）

```text
oneframe subject edit <SUBJECT_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`PATCH subjects/{subject_id}`
- 契约证据：`commands/subject.md:124`

## `subject delete`

删除主体（软删）

```text
oneframe subject delete <SUBJECT_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`DELETE subjects/{subject_id}`
- 契约证据：`commands/subject.md:140`

## `subject status`

批量查询审核状态（三态，未知不默认通过）

```text
oneframe subject status [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST subjects/status`
- 契约证据：`commands/subject.md:200`

## `subject save-from-resource`

从项目资产保存为主体（同资产幂等）

```text
oneframe subject save-from-resource [SP_ID] [RESOURCE_ID] [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST subjects/from-asset`
- 契约证据：`commands/subject.md:73`

## `subject batch-details`

批量主体详情

```text
oneframe subject batch-details [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无批量详情端点；用 `subject status --set 'subject_ids=[…]'` 拿逐条审核态，或 `subject get` 逐条
- 契约证据：`commands/subject.md:156`

## `subject from-resource`

从资源创建主体（含 confirm 流程）

```text
oneframe subject from-resource [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方只有 `subject save-from-resource`（POST /subjects/from-asset，从项目资产保存、同资产幂等）；无 type+confirm 二次流程
- 契约证据：`commands/subject.md:172`

## `subject reset`

重置解析/匹配状态

```text
oneframe subject reset [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无 reset 端点（ep_id+kind 维度状态重置未实现）；重跑解析用 `episode parse-retry`
- 契约证据：`commands/subject.md:228`
