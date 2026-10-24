# 支付渠道对接与回调验签（商业化就绪第 1 步）

> 2026-10-25 · B 型目标 Round 1

## 一、本轮做了什么

上一轮支付只做到「mock 渠道下单 → 标记支付 → 入账」，回调端点只接了一个 `signature` 字段但**从未校验**——真实渠道上线时会变成任何人都能伪造回调免费充值。本轮补齐：

### 1. 回调验签（`payment-signature.ts`）

| 算法 | 实现 |
|---|---|
| 微信 APIv3 验签 | RSA-SHA256，签名串 `timestamp\nnonce\nbody\n`，**时间戳容差 5 分钟**（防重放） |
| 微信资源解密 | AEAD_AES_256_GCM，校验 `apiV3Key` 必须 32 字符，鉴权 tag 校验 |
| 支付宝验签 | RSA2/RSA1，非 `sign`/`sign_type` 参数按 key 升序拼 `k=v&k=v` |
| 常时序比较 | `timingSafeEqual` 封装，防时序攻击 |

**核心策略：默认拒绝。** 未配置平台公钥时，任何微信/支付宝回调直接 `401101`，不存在"跳过验签"路径。这样即使生产环境漏配密钥，最坏结果是支付无法入账（可发现、可修复），而不是被免费充值（不可逆）。

### 2. 回调端点

```
POST /billing/notify/wechat   读 header: wechatpay-timestamp/nonce/signature
                              验签 → 解密 resource → 取 out_trade_no/transaction_id/amount.total → 入账
POST /billing/notify/alipay   验签 → 校验 trade_status ∈ {TRADE_SUCCESS, TRADE_FINISHED} → 元转分 → 入账
POST /billing/notify/mock     仅联调；PAYMENT_LIVE=true 时 403
```

### 3. 生产防绕过

`POST /billing/orders/{id}/mock-pay` 在 `PAYMENT_LIVE=true` 时返回 403，防止生产环境被直接调 mock 接口白拿积分。

## 二、发现并修复的缺陷

**重写控制器时误删了 `/billing/notify/mock` 端点**，导致：
- 该端点返回 404（`Cannot POST /v1/billing/notify/mock`）
- 上一轮的金额篡改回归测试直接失败

这个缺陷是跑回归测试才发现的——如果我只看新写的验签代码通过就收工，会漏掉。已恢复并加注释说明其用途（联调 + 幂等链路验证）。

## 三、验收结果

### 3.1 验签契约测试：11/11（新增）

用真实 RSA 密钥对与 AES-GCM 构造回调，覆盖：

```
wechat:
  ✓ 正确签名通过
  ✓ 篡改 body 拒绝
  ✓ 时间戳过期（10 分钟前）拒绝 —— 防重放
  ✓ 未配置公钥拒绝 —— 默认拒绝策略
  ✓ AEAD_AES_256_GCM 资源解密正确
  ✓ 错误 apiV3Key 解密失败
alipay:
  ✓ 正确签名通过
  ✓ 篡改金额拒绝
  ✓ 未配置公钥拒绝
  ✓ 忽略 sign/sign_type 拼接待签串
helpers:
  ✓ safeEqual 常时序比较
```

### 3.2 回调安全端到端：6/6

```
1. 微信回调未配置公钥时拒绝          ✅ 401101
2. 支付宝回调未配置公钥时拒绝        ✅ 401101
3. 伪造回调未导致入账（余额不变）     ✅ 80 → 80
4. mock-pay 在非生产模式下可用       ✅ credited=true
5. 金额篡改被拒（回归）              ✅ 400101
6. 前置 mock 订单创建               ✅
```

### 3.3 全量回归

```
单元/契约测试：113 项通过（api 70 / adapters 9 / shared 13 / db 11 / worker 4 / storage 6）
支付端到端：23/23（回归无破坏）
lint / typecheck：全绿
```

## 四、文档同步

`api-spec §10` 从原来的 6 行伪代码扩写为四节：
- §10.1 端点（含响应字段）
- §10.2 渠道回调（3 个）
- §10.3 幂等与安全（7 条实现约束，逐条对应代码）
- §10.4 未实现（退款、Native 下单，依赖商户号）

## 五、B 型剩余

| 项 | 状态 |
|---|---|
| 支付回调验签 | ✅ 本轮完成（含解密与防重放） |
| 真实渠道下单（拉起收银台） | ⏳ 需商户号与证书 |
| 真实视频供应商 | ⏳ 需 ARK/DeepSeek Key（适配器与错误映射已就绪） |
| 合规备案 | ⏳ 需企业主体 |
| 退款 | ⏳ Ph3 |
