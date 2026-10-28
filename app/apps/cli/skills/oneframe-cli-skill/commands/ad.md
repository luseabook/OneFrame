# `ad` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 8 条命令：可用 8 条、骨架 0 条。

## `ad info`

广告项目详情 + 五段进度（--workspace 提供项目 ID）

```text
oneframe ad info [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`GET ad-drama/projects/{project_id}`
- 契约证据：`commands/ad.md:33`

## `ad save`

新建/更新广告项目（--set material_name=… material_highlight=… material_image=… style=… ratio=9:16）

```text
oneframe ad save [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST ad-drama/projects`
- 契约证据：`commands/ad.md:49`

## `ad selling-point`

生成商品卖点（`--set count=1..8` 可选）

```text
oneframe ad selling-point [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST ad-drama/projects/{project_id}/selling-point/generate`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/ad.md:77`

## `ad plot`

生成剧情方案候选（`--set count=1..5` 可选）

```text
oneframe ad plot [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST ad-drama/projects/{project_id}/brief/generate`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/ad.md:93`

## `ad script`

按选中方案生成广告脚本（`--set brief_id=`）

```text
oneframe ad script [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST ad-drama/projects/{project_id}/script/generate`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/ad.md:109`

## `ad asset`

抽取广告资产（`--set need_voice=1|2`）

```text
oneframe ad asset [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST ad-drama/projects/{project_id}/asset/extract`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/ad.md:125`

## `ad plan`

生成分镜规划（`--set template_type=1|2`）

```text
oneframe ad plan [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST ad-drama/projects/{project_id}/storyboard/generate`
- 付费命令：先 `--dry-run` 看将发送的请求，再正式执行
- 契约证据：`commands/ad.md:141`

## `ad reset`

重置脚本，回到剧情方案选择

```text
oneframe ad reset [--set KEY=VALUE]... [--dry-run] [--idempotency-key KEY] [--json]
```

- 状态：可用（HTTP 端点已存在）
- 端点：`POST ad-drama/projects/{project_id}/script/reset`
- 契约证据：`commands/ad.md:157`
