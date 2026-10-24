# F2 收口（自动保存/预算预填/duration_adjusted）+ F6 流水页（2026-10-24）

## F2 大纲自动保存

- `PATCH /projects/:id/episodes/:eid`（title/synopsis/script_text），不改变确认状态；
- Web 大纲输入 600ms 防抖自动保存，提示“已自动保存”；
- API 测试：PATCH 后项目详情读回新值。

## F2 批量预算预填

- 批量投递页新增「按报价预填」：把当前镜头（含角色参考图）组装成请求调用 `POST /credits/quote/batch`，把 `total_credits` 填入预算上限；
- 用户手动改预算后标记 touched（续投预填未实现）。

## F2 duration_adjusted

- 批投递按所选模型 `scene_modes.storyboard_reference_video.durations` 就近取低；
- 任务事件与批次响应 item 携带 `duration_adjusted:{from,to}`；限值仍由 credits.price 最终校验。

## F6 积分流水

- `GET /credits/flows?page&page_size&task_id`：kind/delta/frozen_delta/balance_after/memo/ref_task_id/time；
- Web `/credits`：余额/冻结卡片 + 流水表 + 分页；导航新增「积分」；
- API 测试：注册后 gift +80 出现在流水。

## 验证

- API 测试 **33 项**通过（新增 episode PATCH、flows）；
- Web 生产构建通过；lint/typecheck/build 绿。
