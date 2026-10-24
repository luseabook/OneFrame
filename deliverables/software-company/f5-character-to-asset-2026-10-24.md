# F5 定妆图转通用资产（2026-10-24）

## 能力

- `POST /projects/:id/characters/:cid/to-asset`：把已定稿角色的定妆图提升为**通用资产**：
  - 资产名改为角色名；
  - 标签合并去重并追加 `#<角色名>`（上限 20 个标签）；
  - `meta.promoted_to_general_asset=true`，记录来源 project/project_asset；
  - 幂等：重复调用只覆盖同名标签，不产生重复资产。
- 资产库 `GET /assets?tag=#角色名` 可检索到该资产 → 满足「跨项目复用并作为参考使用」。
- Web 项目页角色卡片新增「转通用资产」按钮，成功后提示标签。

## 测试

- pipeline 新增：构造已定稿角色+资产 → 调用 to-asset → 断言返回含 `#角色名` 标签 → `GET /assets?tag=...` 命中；
- 全量 API **44 项**通过；Web 构建通过。
