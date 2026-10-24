# F7 输出审核（745802）（2026-10-24）

## 供应商审核拒绝 → 745802

- 通用 HTTP 适配器：`review_rejected` / `rejected` / `audit_failed` 状态 → `status=review_rejected`，错误码 `output_rejected`；
- 火山 Ark 适配器：`status=rejected` → 同样映射为 `review_rejected` + `output_rejected`；
- worker `fail()`：审核拒绝或 `output_rejected` → 任务状态 **REVIEW_REJECTED(7)**，错误码 **745802**；其余失败 → 745901；
- 审核拒绝不扣费（冻结解冻），视频镜头退回「确认」允许改写后重投。

## LLM 输出审核

- `LlmService.complete()` 在 schema 校验后对结构化结果做敏感词审核，命中 → `AppError(745802)`；
- 审核发生在写库之前 → **不落半写状态**（大纲/角色/分镜/剧本均覆盖）；
- 输入与输出共用同一词表（内置词 + `MODERATION_WORDS`），可统一运营。

## 测试

- adapters：`review_rejected` → `error.code=output_rejected`（HTTP 适配器用例）；
- API：含敏感词的建项请求返回 **745801**（输入侧）；
- 全量 API **45 项**、adapters **9 项**通过；Web 构建通过。

## 仍待

- 真实供应商审核回调/人工复审队列（当前按任务终态呈现）；
- 敏感词库运营（≥5000 词）与审核日志留存报表。
