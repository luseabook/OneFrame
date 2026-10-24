# F8 任务指标 + F2 重投幂等与续投预算（2026-10-24）

## F8 任务指标与失败导出

- `GET /ops/admin/task-metrics`：
  - 总数/成功/失败/取消/**失败率**（失败 ÷ (成功+失败)）；
  - `adapter_latency`：按 `adapter_code` 聚合 `created_at → finished_at` 的 avg 与 P95（毫秒）；
  - `errors_by_code`：失败任务的错误码分布。
- `GET /ops/admin/failed-tasks.csv`：失败/审核拒绝任务清单（task_id, space_id, model, mode, status, error_code, error_message, created_at, finished_at），最多 1000 行，CSV 字段转义。
- Web `/admin` 任务审计页顶部展示失败率、adapter 延迟表、错误码分布与「下载失败任务 CSV」。

## F2 分镜重投幂等

批量投递（`generate-videos`）按 **shot 维度**取该镜最近一次任务：

| 最近任务状态 | 行为 | 扣费 |
|---|---|---|
| SUCCEEDED / PENDING / RUNNING | 复用原任务（返回同一 task_id） | 不重复扣费 |
| FAILED / CANCELED | 新一轮 attempt（dedupe `shot:<id>:a<n>`，`attempt_no` 递增） | 按报价冻结一次 |

此前实现用固定 `shot:<id>:v1` 去重，失败后无法重投；现按 attempt 号生成去重键。

## F2 续投预算预填

批量页「按报价预填」区分首次投递与续投：

- 首次：全部镜头报价 → 预算上限；
- 续投：**已消耗（本集已投递镜头的冻结/结算积分）+ 剩余镜头报价** → 预算上限，并提示明细。

## 修复：价格表未覆盖时长时的计费

`model_prices` 只覆盖部分时长档（如 wan-3.0 仅 5s/10s），请求 6s 时原本 400101「no price」。现按 PRD「就近低档」取最大 ≤ 请求时长的价格档计费，并把实际计费时长回写为 `duration_adjusted{from,to}`（任务事件 + 批次响应）。

## 测试

- admin：task-metrics 字段校验 + CSV 头校验；
- pipeline：在途任务重投返回同一 task_id 且不重复扣费；
- 全量 API **43 项**通过；Web 构建通过。
