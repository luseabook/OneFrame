# F3/F5 资产转存与回收站 + F8 403（2026-10-24）

## 任务结果转存资产

- `POST /assets/from-task {task_id,index}`：校验任务属于当前空间且 SUCCEEDED；同一 task+uri 幂等复用；生成资产（kind/tags `from-task`/source_task_id）；
- 任务详情页「转存资产」按钮；
- 测试：插入一个 SUCCEEDED 任务（本地存储对象）→ 转存成功 → 软删 → 回收站可见 → 恢复 → 正常列表可见。

## 资产回收站

- `GET /assets?deleted=true` 回收站列表；
- `POST /assets/:id/restore` 恢复；
- Web 资产页「回收站/返回资产库」切换 + 恢复按钮；
- 7 天物理清理定时任务未做（字段/接口已就绪）。

## F8 403

- AdminGuard：无 Authorization → 401101；携带普通用户 token（校验失败）→ 403101；
- 测试覆盖普通用户 token 访问 `/ops/admin/dashboard` 返回 403101。

## 验证

- API 测试 **36 项**通过（assets 4、admin 7 等）；
- Web 构建通过。
