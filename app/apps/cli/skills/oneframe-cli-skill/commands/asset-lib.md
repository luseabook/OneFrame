# `asset-lib` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 12 条命令：可用 9 条、骨架 3 条。

## `asset-lib list`

列出空间资产

```text
oneframe asset-lib list [--set KEY=VALUE]... [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET assets`
- `--set` 进 query 的白名单键：`page`、`page_size`、`kind`
- 契约证据：`commands/asset-lib.md:105`

## `asset-lib dir-list`

列出资产目录

```text
oneframe asset-lib dir-list [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET asset-folders`
- 契约证据：`commands/asset-lib.md:57`

## `asset-lib rename`

重命名资产

```text
oneframe asset-lib rename <ASSET_ID> [NAME] [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`PATCH assets/{asset_id}`
- 契约证据：`commands/asset-lib.md:153`

## `asset-lib delete`

删除资产

```text
oneframe asset-lib delete <ASSET_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`DELETE assets/{asset_id}`
- 契约证据：`commands/asset-lib.md:169`

## `asset-lib dir-create`

创建资产目录

```text
oneframe asset-lib dir-create [NAME] [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST asset-folders`
- 契约证据：`commands/asset-lib.md:41`

## `asset-lib get`

查看资产详情（第 88 批补的单个资源端点，与列表同一形状）

```text
oneframe asset-lib get <ASSET_ID> [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET assets/{asset_id}`
- 契约证据：`commands/asset-lib.md:121`

## `asset-lib import`

从生成任务导入资产（= 素材入库）

```text
oneframe asset-lib import <TASK_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST assets/from-task`
- 契约证据：`commands/asset-lib.md:137`

## `asset-lib search`

搜索资产

```text
oneframe asset-lib search [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方素材列表无 q 参数；知识库侧有搜索：`GET /v1/knowledge/assets/search`（CLI 尚未建组，见回报）
- 契约证据：`commands/asset-lib.md:185`

## `asset-lib resource-list`

asset-lib resource list

```text
oneframe asset-lib resource-list [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：“资源”语义在我方分两处：项目资产用 `resource list --workspace <SP>`，素材用 `asset-lib list`
- 契约证据：`commands/asset-lib.md:201`

## `asset-lib tag-add`

设置资产标签（`--set 'tags=[a,b]'`，我方 tags 是整体替换的数组字段）

```text
oneframe asset-lib tag-add <ASSET_ID> [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`PATCH assets/{asset_id}`
- 契约证据：`commands/asset-lib.md:249`

## `asset-lib move`

移动资产到目录（`--set folder_id=null` 表示移出目录）

```text
oneframe asset-lib move <ASSET_ID> [FOLDER_ID] [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`PATCH assets/{asset_id}`
- 契约证据：`commands/asset-lib.md:281`

## `asset-lib batch-delete`

批量删除资产

```text
oneframe asset-lib batch-delete [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：我方无批量删除；逐条 `asset-lib delete <ID>`（DELETE /assets/:id 是软删，可用 `POST /assets/:id/restore` 找回）
- 契约证据：`commands/asset-lib.md:297`
