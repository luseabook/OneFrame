# 产品形态补齐：作品库 / 二次创作 / 新手引导（阶段记录）

> 2026-10-25 · 形态确认：**纯 SaaS 自助（A 型）** · 产品逻辑对齐竞品 ReelMate · 验证期不做支付

## 一、为什么补这三块

A 型自助 SaaS 的留存完全取决于两件事：**第一次能否自己出成片**、**是否会回来做第二集**。
v1.3 PRD 的 F1–F8 覆盖了「能出片」，但缺「成果可见」与「再来一次」，用户出完的片子散落在任务列表中，不成体系 → 无法形成留存闭环。

补齐内容见 `docs/01-product/PRD-supplement-works-and-onboarding.md`。

## 二、本阶段实现

### 数据层（迁移 `0006_smiling_wendell_vaughn.sql`）
| 变更 | 用途 |
|---|---|
| `script_projects.archived_at` | 作品归档（软标记，作品=项目） |
| `script_projects.is_sample` | 示例作品（只读模板，可复制） |
| `users.onboarded_at` | 新手引导是否已看（激活口径） |

> 不新增 `works` 表：作品与项目 1:1，避免双写不一致。

### API（4 个新端点）
| 端点 | 说明 |
|---|---|
| `GET /works` | 作品库聚合视图：集数、分镜数、已出片数、封面、**四态**（draft/producing/ready/archived）；支持 `status=archived` 过滤与分页 |
| `POST /projects/{id}/archive` | 归档 / 恢复（`{archived:bool}`） |
| `POST /projects/{id}/episodes` | **二次创作**：新增空集（≤10），复用已定稿角色，不复制分镜 |
| `POST /projects/{id}/duplicate` | 复制为我的项目（示例作品体验），复制骨架+角色，不复制分镜与任务 |

实现要点：`GET /works` 用单条 SQL 聚合（子查询统计 episodes/storyboards/tasks），封面取最新成功任务的 `results[0].uri`，避免 N+1。

### 前端（`/works` 作品库）
- 筛选条：全部 / 制作中 / 已成片 / 已归档 + 总数；
- 卡片：4:3 封面（hover 微缩放）、状态角标、标题、`已出片/总镜数`、进度条、创建日期；
- 操作：续做一集（→ 直接进流水线）、归档/恢复；
- 空态引导 + 骨架屏 + 分页；
- 侧边导航新增「我的作品」（首页 → 我的作品 → 全部项目 → 工具箱）。

## 三、验证

```
构建：✓ web / api 均通过
静态检查：✓ lint（6 任务）✓ typecheck（10 任务，--force）
测试：✓ 93 项全通过（api 50 / adapters 9 / shared 13 / db 11 / worker 4 / storage 6）
接口实测：
  GET /works       → total=2，两条作品分别 state=producing(ep3/shot10) 与 draft
  POST /episodes   → created=2
  POST /archive    → archived=true / false 往返正常
UI 实测（/works）：
  2 张卡片，状态标签 ["制作中","草稿"]，标签页 4 个，总数「共 2 部」
  筛选「已成片」→ 0 张（当前无成片作品，符合数据）
  续做一集 → 跳转 /projects/:id
  导航含「我的作品」；overflow=0；移动端 390px overflow=0；console issues=0
```

## 四、下一步（按留存闭环优先级）

1. **新手引导**：首次进工作台引导条 + 示例作品一键复制体验；
2. **任务中心 / 资产库 / 积分页换新组件**（仍是旧表格）；
3. **落地页深色 Hero**（当前首页已对齐竞品结构，落地页仍待重做）；
4. 全局 Toast / 骨架屏统一接入。
