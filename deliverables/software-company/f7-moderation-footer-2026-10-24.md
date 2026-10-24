# F7 输入审核 + 页脚举报入口（2026-10-24）

## 敏感词审核（MVP）

- `ModerationService`：内置高风险词 + `MODERATION_WORDS`（逗号分隔）；
- 开关 `MODERATION_ENABLED`（默认 true）；
- 拦截点：
  - `POST /generations` 的 prompt（冻结前，745801，不产生任务/积分流水）；
  - 建项 source_text、大纲 source_text、角色 context、分镜 script_text；
- 错误返回 `745801` + `field/keyword`，前端直接展示。

测试：flow 新增“赌博推广视频”生成返回 745801，余额/冻结不变（80/0）。

## 页脚举报

- 全站 footer 增加「举报 / 投诉」mailto 入口（占位邮箱，上线替换为正式通道）；
- 分享页举报 + 运营后台下线闭环此前已完成。

## 仍待

- 供应商内容审核/审核回调（输出审核 745802）；
- 敏感词库运营维护（≥5000 词）与审核日志留存；
- 举报工单系统与 7×24 处置 SLA。

测试：API **34 项**通过。
