# F1 账号注销 + 协议页面 + 举报页（2026-10-24）

## 账号注销（PRD F1）

- `POST /v1/me/delete`：
  - 身份解绑（`identities.phone_hash/cipher/external_id` 置空 → 同手机号可重新注册）；
  - 账号停用（`users.status=2`、`nickname=已注销用户`、`deleted_at=now`）；
  - **任务记录脱敏**：`input={redacted:true}`、`results=[]`、状态置为已取消，保留计数用于对账；
  - 解除空间成员关系；
  - 返回 `purge_after`（注销 + 30 天）。
- 物理清理：worker `runMaintenance` 每 6h 删除 `deleted_at` 超过 30 天的用户行。
- **Token 即时失效**：`AuthGuard` 增加账号状态校验，注销/封禁账号的既有 access token 立即返回 401101。
- Web `/settings`：账号信息、协议入口、注销按钮（二次确认）。
- 迁移：`0005` 为 `users` 增加 `deleted_at`；schema 契约测试同步断言。

## 协议与举报页面

| 页面 | 内容 |
|---|---|
| `/terms` | 用户协议 1.0：服务内容、账号与年龄、生成内容与 AI 标识、积分与计费、内容规范、知识产权、免责、联系方式 |
| `/privacy` | 隐私政策 1.0：收集范围、使用目的、存储与保留（结果 90 天/回收站 7 天/注销 30 天）、共享披露、信息安全、用户权利、未成年人保护 |
| `/report` | 全站举报/投诉表单：类型/说明/联系方式 + token，提交进入运营后台处置队列 |

页脚已串联：举报/投诉、用户协议、隐私政策、举报邮箱。

## 测试

- flow 新增：注销返回 `purge_after` 且原 token 立即失效；
- schema 契约：`users` 断言含 `status/age_declared_at/deleted_at`；
- 全量 API **46 项**通过；lint/typecheck/build 绿。
