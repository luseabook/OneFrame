# 流水线资产 + 批量投递验证记录（2026-10-24）

> 目标：验证 F2「角色定妆 → 分镜引用 → 批量出片」闭环（mock 适配器 + local storage）。
> 环境：PostgreSQL 18(55432) + Redis 8(6380) + api(3000) + worker(`ADAPTER_MODE=mock`)。

## 实测流程（手机号 13500135003）

| 步骤 | 结果 |
|---|---|
| 建项 + 大纲 + 确认 + 2 角色 | project/episode/character 正常 |
| 生成 4 分镜 | 每镜 `character_ids` 绑定首个角色（storyboard_assets） |
| 角色定妆图任务（`studio_asset_image`，2 积分） | task SUCCEEDED；worker 自动建 `assets` 行、`project_assets.status=2`、`portrait_asset_id`/`ref_image_uri` 回写 |
| 批量投递（wan-3.0，universal_reference + storyboard_reference_video，预算 1000） | 4/4 submitted，每镜 8 积分冻结 |
| worker 执行 | 4 任务全部 SUCCEEDED，结算 32 积分 |
| 账户 | 80 − 2（定妆）− 32（视频）= **46**，冻结 0 |
| 分镜状态 | 4 镜 `status=3`（已投递），`video_task_id` 回写 |

## 资产门槛验证

- 未定稿角色时批量投递：4 镜全部返回 `400105 asset_not_ready`，不冻结、不建任务（API 测试覆盖）；
- 仅定稿被引用的角色后才允许投递；其他未定稿角色不影响该集（按引用判定）。

## 关键实现

- `POST /projects/:id/characters/:cid/portrait` 复用 generations 链路（报价/冻结/队列）；
- worker 成功回调：若任务 capability=image 且 `project_assets.source_task_id` 命中，自动资产化并置定稿；
- 批量投递：预算上限（超出部分 745703，部分成功）、dedupe_key 防重复、余额不足整单 745701、逐镜事务冻结；
- 分镜角色绑定：LLM 输出 `character_names` → 名称映射 project_assets → `storyboard_assets`；引用图由定稿 `ref_image_uri` 注入 `reference_uris`。

## 后续

- 候选定妆图（count>1）选择/重绑 UI 与端点已预留 rebind，待前端；
- 批量投递的 poll/结果回写分镜 status=4/5 尚未做；导出 zip 未做。
