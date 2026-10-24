# F3 加入项目分镜素材 + F8 流水线漏斗（2026-10-28）

## F3 加入项目当分镜素材

- `POST /projects/:id/shot-materials {task_id}`：校验任务属于当前空间且 SUCCEEDED；
  - 同任务幂等（已存在返回原 project_asset）；
  - 写 `assets`（kind=video/image，tags=`shot-material`）+ `project_assets`（kind=`shot_material`，ref_image_uri=结果 uri，portrait_asset_id=资产 id）。
- `GET /projects/:id/shot-materials`：返回项目分镜素材列表（含预签名 URL）。
- Web：任务详情「加入项目」下拉选择项目 → 提交；项目批量页展示「分镜素材」缩略图网格。

## F8 流水线漏斗

- `GET /ops/admin/funnel`：六段漏斗
  1. 建项（script_projects）
  2. 大纲确认（有 status=2 集的项目数）
  3. 角色定稿（project_assets kind=character status=2）
  4. 分镜生成（storyboards）
  5. 批量投递（tasks mode=universal_reference）
  6. 镜头成功（tasks status=3）
  - 每段给出相对上一环节的转化率（%）。
- Web `/admin` 新增「流水线漏斗」页签，展示各环节计数与转化率。

## 测试

- pipeline 新增：插入 SUCCEEDED 任务 → 加入项目分镜素材 → 列表可见且带签名 URL；
- admin 新增：漏斗返回 6 段、计数为数字；
- 全量 API **40 项**通过；Web 构建通过。
