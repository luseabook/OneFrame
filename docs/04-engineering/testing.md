# 测试策略

> v1.1 · 2026-10-24 · 测试金字塔按"钱在哪、痛在哪"分配：计费与任务状态机最重
> v1.1 变更：对账不变式改 database §4 口径（RE-02）；补模型目录快照、逐镜预算 200、定稿门槛、时长收敛、导出 400106、AI 标识冒烟（RE-01/03/04/07/11）

## 1. 金字塔与覆盖目标

| 层 | 工具 | 覆盖目标 | 重点 |
|---|---|---|---|
| 单元 | vitest | 纯逻辑 80%+ | 计价(quote)、冻结结算、状态机迁移、mode 枚举校验、错误码映射 |
| 集成 | vitest + testcontainers(PG/Redis) | 模块service+repo | 事务性(任务+流水同成败)、幂等重放、限流、轮询 ETag |
| 契约 | supertest + 本仓 fixtures | **api-spec.md 全端点** | 实现↔文档一致性,CI 强制 |
| 适配器 | nock/msw 回放 fixtures | 全部 adapter | 供应商响应归一化/超时/5xx 重试/降级 |
| E2E | Playwright(staging) | 5 条主干 | J1 旗舰(小说→完集)/J2/J3 旅程冒烟 |
| 压测 | k6 | 轮询+创建 | 见 §5 |

## 2. 必测清单（合并门禁）

1. **两阶段扣费不变式**：任意状态序列下 `balance == Σ delta` 且 `frozen == Σ frozen_delta`（等价 `balance+frozen == Σ(delta+frozen_delta)`，database §4 唯一口径；属性测试随机状态转移 1000 次）；
2. 幂等：同键并发 10 提交 → 恰 1 任务、9 个返回同 task_id；
3. 状态机非法迁移全部拒绝（如 SUCCEEDED→CANCELED）；
4. 供应商 5xx/超时 → 重试上限 → FAILED+解冻+error.kind 正确；
5. 越权：A 空间访问 B 空间任务/资产 → 403101；
6. 上传：伪造 content_type(exe 改 jpg) 被 complete 阶段拒绝；
7. 余额边界：balance-cost=0 恰可通过；= -1 拒 745701；
8. **流水线批量**：预算上限到达→该镜 `code:745703` 且 HTTP 200（余镜标未投递）；批量报价 total 与逐镜求和一致；断点续跑重试幂等不重复扣费；未定稿角色投递→400105 且不落任务/不冻结；参考图数超模型 media_limits→400101；时长不在模型 durations→就近低档回写（记录 duration_adjusted）且不报错；角色定妆图换绑后仅新任务使用新图（旧任务 results 不变）；LLM 步骤失败/超时零半写状态；导入剧本拆集不扣积分；导出成功镜 <80% → 400106。

## 3. 契约测试（文档即测试）

- `packages/shared` 定义 Zod schema（= api-spec 的机器可读版）；
- 模型目录快照测试：导入的 8~10 行必须含 `mode_order` 与两个 scene 键（`script_to_scene_refer`/`storyboard_reference_video`），且至少一行含 `modes.studio_asset_image`；对每个可见模型断言 `durations/ratios/resolution_options` 非空且与 fixtures 一致（取自 46 模型目录子集），防止"所有模型共享同一档位"的假设回潮；
- CI 步骤：① schema 生成 OpenAPI → 与手写 spec diff（破坏性变更需 PR 显式确认）；② 全端点 supertest 断言响应符合 schema。

## 4. 适配器测试（核心资产防护）

```
fixtures/
  volcengine/submit.json · poll_succeeded.json · poll_review_rejected.json · error_quota.json
  aliyun/… · kling/…
```
- 每个 adapter：正常/失败/审核/限流 4 类回放，断言归一化输出一致；并断言 `models.modes[*].endpoint` 到 adapter 内部路由的映射（同一模型多 mode 不同 endpoint，见 RE 目录：image2video/universal_reference/video_edit 端点各异）；
- 供应商升级验证：月度任务用真实沙箱跑探针任务对比（记录进 05-ops 看板）。

## 5. 压测场景与通过线

| 场景 | 负载 | 通过线 |
|---|---|---|
| 轮询风暴 | 1000 连接 × 5s 批量 | API P95<200ms(缓存命中)；DB 连接池 <80% |
| 创建尖峰 | 50 RPS × 1min | 队列堆积<200；冻结事务无死锁 |
| Worker 恢复 | 杀掉 worker 30s | 重启后 100% 任务恢复推进，0 双扣费 |

## 6. 测试数据策略

- staging 用脱敏生成的假手机号+供应商 mock（**不用生产供应商 Key 做回归**，防计费事故）；
- 种子数据脚本 `pnpm seed`（模型目录 10 行/测试用户/示例任务）；
- E2E 账号固定 3 个（未登录/新人/余额耗尽）。

## 7. 发布前冒烟（staging, 每次发布）

1. 登录→quote→生成(mock 供应商)→轮询到成功→下载；
2. 余额不足弹窗；
3. 资产入库→标签→回收站；
4. 管理后台改价→quote 立即生效（热更验证）；
5. 分享链接创建→公开预览→撤销→404；导出含 manifest，缺失镜有标注；
6. 抽验视频/图片：显式水印可见 + 元数据含 AI 标识字段（缺一即阻断发布）。
