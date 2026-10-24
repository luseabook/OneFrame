# 供应商适配层契约化与真实 HTTP 联调（商业化就绪第 2 步）

> 2026-10-25 · B 型目标 Round 2

## 一、发现并修复的真实缺陷（3 个）

### 1. 审核驳回被误判为 `running` → 无限轮询 + 积分永久冻结（严重）

Ark 适配器的状态归一化顺序有 bug：

```ts
// 修复前
const status = rawStatus === "failed" ? "failed" : ... : "running";  // rejected 落到 running
if (status === "failed") {
  const rejected = rawStatus === "rejected";   // 永远进不来（status 是 running）
  ...
}
```

实测确认：`rejected` / `review_rejected` 都被归一化为 `running`。

**后果**：内容审核驳回的任务永远不会终止，worker 无限轮询，用户积分被永久冻结（既不结算也不解冻）。这在真实供应商下必然发生——审核驳回是最常见的失败类型之一。

**修复**：把 `review_rejected` 的识别提到归一化**之前**，并加契约测试锁死。

### 2. 错误码与全站口径不一致

| 位置 | 修复前 | 修复后 |
|---|---|---|
| 审核驳回 | `output_rejected`（但走不到） | `output_rejected` ✓ |
| 执行失败 | `ark_failed` | `vendor_error` |
| 无结果 | `ark_no_result` | `vendor_error` |

统一后 worker 的 `fail()` 才能正确映射到 745802 / 745900。

### 3. 无重试机制

网络抖动、5xx、429 一律直接失败。视频生成是高成本操作，一次抖动就让用户任务失败。
**修复**：指数退避重试（默认 2 次，基础 400~500ms），仅重试「网络/超时/5xx/429」，4xx 业务错误不重试（避免无效重试扣费）。

DeepSeek 适配器同样补齐（LLM 步骤失败虽不扣费，但用户会看到"生成大纲失败"）。

## 二、验收：12/12（真实 HTTP 协议级）

起了本地假 Ark 供应商（实现真实 Ark 协议），走完整 HTTP 调用：

```
1.  提交返回 vendor task id            ✅
2.  请求带 Bearer 鉴权                  ✅ Bearer test-key
3.  请求 body 含 model                 ✅ seedance-2.5
4.  content 含 text 项且带镜头参数       ✅ "雨夜街道… --resolution 720p --ratio 9:16 --duration 5"
5.  content 含参考图 image_url          ✅ 1 项，URL 正确
6.  首次轮询为 running                  ✅
7.  二次轮询成功并带结果 URI             ✅ http://…/v.mp4
8.  审核驳回映射为 review_rejected       ✅ ← 修复的 bug
9.  驳回错误码为 output_rejected         ✅ ← 修复的 bug
10. 失败映射为 failed                   ✅
11. 失败错误码为 vendor_error            ✅ ← 修复的 bug
12. 5xx 后重试成功                      ✅ ← 新增能力
```

## 三、契约测试：21/21（adapters 从 9 增至 21）

新增 `ark-contract.spec.ts` 12 项，用假 fetch 覆盖：
- 提交协议字段（model / content 结构 / 参考图）
- 5 种状态映射（queued/processing/rejected/audit_failed/failed/unknown）
- 3 种结果 URI 提取路径（content[0] / data / output）
- succeeded 但无 URL 的降级
- 重试：5xx 重试成功 / 4xx 不重试 / 网络错误重试 → RetryableVendorError / 429 重试

## 四、全量回归

```
单元/契约测试：125 项（api 70 / adapters 21 / shared 13 / db 11 / worker 4 / storage 6）
供应商联调：12/12（真实 HTTP）
lint / typecheck：全绿
```

## 五、文档同步

`system-design §4` 补：
- 失败模式表新增「供应商 5xx/429/网络抖动 → adapter 重试」「支付回调被伪造 → 验签默认拒绝」
- 新增 **§4.1 供应商适配器契约**：归一化状态表（5 态 + 原始状态映射）、错误码统一表（745802/745900/745901）、**踩坑说明**（rejected 必须先识别）、重试策略

## 六、B 型剩余

| 项 | 状态 |
|---|---|
| 支付回调验签 | ✅ Round 1 |
| 供应商协议与错误映射 | ✅ Round 2（真实 HTTP 协议级验证） |
| **真实供应商 Key 联调** | ⏳ 需 ARK / DEEPSEEK_API_KEY |
| 真实渠道拉起收银台 | ⏳ 需商户号 |
| 合规备案 | ⏳ 需企业主体 |
| 退款 | ⏳ Ph3 |
| 部署可运维性（监控/告警/备份） | ⏳ 下一轮 |
