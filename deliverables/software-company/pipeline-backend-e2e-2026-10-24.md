# 剧本流水线后端验证记录（2026-10-24）

> 目标：验证 PRD F2 后端核心链路（建项 → 拆集/大纲 → 角色 → 剧本草稿 → 分镜）可运行、可契约测试。
> 环境：PostgreSQL 18(55432) + Redis 8(6380) + API（LLM_MODE=mock）；迁移 0000 + 0001。

## 覆盖端点

| 端点 | 结果 |
|---|---|
| `POST /projects` | 新建项目（novel/script 两种来源） |
| `POST /projects/:id/outline/generate` | 生成 3 集大纲（mock；real 走 DeepSeek + Zod 强校验） |
| `PUT /projects/:id/outline` | 确认大纲，episodes.status=2 |
| `POST /projects/:id/characters/generate` | 生成 3 个角色卡（project_assets kind=character） |
| `POST /projects/:id/episodes/:eid/script-draft/generate` | 生成一集剧本，落 `script_text` |
| `POST /projects/:id/episodes/:eid/storyboards/generate` | 生成 10 镜，`storyboards` 落库 |
| `PATCH /projects/:id/episodes/:eid/storyboards/:sid` | 行内改时长/提示词 |
| `POST /projects/:id/episodes/split` | 导入剧本文本拆集（source_type=3） |

## 验证结果

- API 测试：`pipeline.spec.ts` 6/6 通过；连同 auth/task/files 共 14 项 API 测试通过，CI 内含 PG/Redis。
- 数据库：`script_projects` / `episodes` / `project_assets` / `storyboards` 按迁移 0001 落表；`episodes` 唯一 `(project_id, ep_no)`，`storyboards` 唯一 `(episode_id, shot_no)`。
- LLM 输出统一经 `outlineSchema/charactersSchema/scriptDraftSchema/storyboardsSchema`（Zod）校验后才写库；mock 与 DeepSeek 共用同一 schema（WBS 2.2 零解析失败）。

## 后续

- 定妆图任务链（mode=studio_asset_image）与资产定稿（status=2）尚未接入，下一步实现；
- 批量投递（预算报价 + 定稿门槛 + 逐镜部分成功）与导出 zip 未实现；
- 流水线前端页面（建项/大纲/角色/分镜/矩阵）待做。
