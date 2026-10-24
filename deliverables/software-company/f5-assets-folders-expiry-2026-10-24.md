# F5 资产目录/标签 + 90 天到期（2026-10-24）

## 目录与标签

- `GET/POST /asset-folders`：目录列表/创建（支持 parent_id 数据模型）；
- `PATCH /assets/:id {folder_id,tags,name}`：归档与标签；
- `GET /assets?folder_id=&tag=&deleted=`：按目录/标签筛选；
- Web 资产页：目录下拉筛选、新建目录、回收站切换。

## 90 天到期

- `GET /assets/expiring-tasks`：SUCCEEDED 且结果未转存、完成超过 83 天（即 7 天内到期）的任务，返回 `days_left`；
- Web 任务页顶部横幅：“N 个结果将在 7 天内到期，请转存资产库”；
- worker `runMaintenance`（启动 + 每 6h）：
  - 任务结果超过 90 天 → `results=[]`；
  - 软删资产超过 7 天 → 物理删除行（对象存储生命周期另行配置）。

## 测试

- assets 6 项：新建目录→资产打标签→按目录筛选；插入 85 天前任务→到期列表命中；
- 全量 API **38 项**通过；Web 构建通过。
