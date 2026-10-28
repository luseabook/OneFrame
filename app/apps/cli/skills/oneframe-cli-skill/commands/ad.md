# `ad` 命令组

> 本文件由 `apps/cli/scripts/gen-skill.cjs` 从 `src/registry.ts` 生成，**不要手改**；改命令请改 registry 后重跑 `pnpm --filter @app/cli build`。

共 3 条命令：可用 0 条、骨架 3 条。

## `ad info`

广告信息

```text
oneframe ad info [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：ad 域本轮由队友落地（modules/ad）；CLI 接线放下一轮，当前无端点
- 契约证据：`commands/ad.md:33`

## `ad save`

保存广告素材

```text
oneframe ad save [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：同上：modules/ad 落地后接；当前无端点
- 契约证据：`commands/ad.md:49`

## `ad plan`

广告方案

```text
oneframe ad plan [--json]
```

- 状态：骨架（执行会明确报未接入，不伪造成功）
- 未接入原因：同上：modules/ad 落地后接；当前无端点
- 契约证据：`commands/ad.md:141`
