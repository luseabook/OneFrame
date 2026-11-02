# 分镜/任务 状态矩阵（我方实现 × 竞品证据状态）

> 目的：把"分镜卡每种状态长什么样、怎么判定"写成一张可核对的表。
> 竞品列只写真有证据的部分；没证据的一律 ⏳，不用"应该如此"补。
> 日期 2026-11-02 · 不花钱、不生成任何内容。

## 0. 为什么不再建议花钱取证

竞品账号最便宜 99/月，而我们要的只是"分镜卡在定稿/在途/失败/出图时分别怎么显示"。
这类信息有三条更便宜的来源，优先级从高到低：

1. **前端代码**（本地已有 bundle）：状态枚举、条件渲染、i18n key 都能读出来；
2. **接口契约**（已捕获 api-log）：`status` 值域、任务状态、导出状态；
3. **我方 mock 渲染**：用我们自己的数据把每种状态跑出来，作为"我方行为证据"。

竞品截图只能补"视觉层"（颜色/间距/文案），而这一层**不影响我们实现是否正确**；
没有它就把对应单元格标 ⏳，比花 99 元买一张截图划算。

## 1. 分镜状态（storyboards.status）

| status | 含义（schema 权威） | 我方 UI 判定函数 | 我方文案 | 可进时间线 | 竞品同状态证据 |
|---:|---|---|---|---|---|
| 1 | 草稿 | shotStage=draft | 未定稿 | 否 | ⏳ |
| 2 | 确认 | shotStage=confirmed | 未定稿 | 否 | ⏳ |
| 3 | 已投递 | isShotInFlight | 已投递 | 否 | ⏳ |
| 4 | 出图 | shotStage=image | 未定稿（视频未出） | 否 | ⏳ |
| 5 | 出片 | isShotRendered / isShotFinalized | 已定稿 | 是（需 video_task_id） | ⏳ |

关键不变量（代码保证，不是推测）：
- `video_task_id` 只表示"投递过一次"，失败回滚到 2 时不清空 → **不能**用它判已出片；
- 已定稿 = `status===5 && video_task_id`；在途 = `status===3`；
- 失败重试（2 + 旧 task id）算"未定稿"，预算按待投计。

## 2. 任务状态（tasks.status）

| status | 含义 | 我方展示 | 竞品同状态证据 |
|---:|---|---|---|
| 1 | PENDING | 排队中 | ⏳ |
| 2 | RUNNING | 生成中 | ⏳ |
| 3 | SUCCEEDED | 已完成 | ⏳ |
| 4 | FAILED | 失败 | ⏳ |
| 5 | CANCELED | 已取消 | ⏳ |
| 6 | REVIEWING | 审核中 | ⏳ |
| 7 | REVIEW_REJECTED | 审核未过 | ⏳ |

## 3. 导出/发布状态

| 状态 | 我方 | 竞品证据 |
|---|---|---|
| 分镜 zip 导出：排队/处理/完成/失败 | 项目页导出记录用 `GET /projects/:id/exports` 的 status | ⏳（账号无导出记录） |
| 切片发布：1 排队 / 2 转码 / 3 可播 / 4 失败 / 5 下线 | 编辑器发布列表 `PUB_STATUS` | ⏳ |

## 4. 竞品侧能从代码确认的（不是猜）

从 bundle 可读到但**还没展开分析**的线索：
- `storyboard.view / storyboard.edit / storyboard.create / storyboard.confirm / storyboard.delete` 权限键；
- `project.export`、`exportlist`、`exportSuccess` 文案键；
- `film.tasks.status.*` 五态（notStarted / inProgress / pendingReview / rejected / done）。

下一步（不花钱）：用 REA 把这些 key 对应的组件分支拉出来，能确认的状态枚举补进本表；
真正需要"看颜色/间距"的部分，等免费机会（试用/同事截图）再补，期间的单元格保持 ⏳。
