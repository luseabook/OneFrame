# 支付闭环实现与验收（B 型可商用 · 支付部分）

> 2026-10-25 · Round 8 · 目标要求 B（能真实收钱跑业务），补齐支付这一块

## 一、背景

用户确认「可商用」= **B（能真实收钱跑业务）**。此前支付按指示未做，本轮补齐。
PRD F6 早已定义 Beta 支付规格（微信 Native/H5、四档 SKU ¥50/100/300/600），api-spec §10 也早有契约，但代码为零。

## 二、实现内容

### 2.1 数据层（迁移 `0007_groovy_christian_walker.sql`）

新增 `orders` 表：

| 字段 | 说明 |
|---|---|
| `id / space_id / user_id / sku_id` | 归属与商品引用 |
| `sku` | SKU 编码快照（防 sku 改名后对不上） |
| `amount_cents` | **金额快照**（分）：下单时冻结，调价不影响已下单订单 |
| `credits` | **积分快照** |
| `channel` | `wechat` / `alipay` / `mock` |
| `channel_order_id` | 渠道侧订单号，`(channel, channel_order_id)` 唯一 → 回调幂等基石 |
| `status` | 1 待支付 / 2 已支付 / 3 已关闭 / 4 已退款 |
| `paid_at / closed_at` | 时序留痕 |
| `pay_token` | 前端轮询凭证（不暴露内部 id 规则） |

索引：`(space_id, created_at desc)`、`(status)`、唯一 `(channel, channel_order_id)`。

复用已有 `skus` 表（kind/sku/label/price_cents/credits/period/active）与 `credit_flows.ref_order_id`。

### 2.2 服务层（`modules/billing`）

| 能力 | 说明 |
|---|---|
| `listSkus` | 只返回上架 SKU，附带 `cents_per_credit` 便于展示"每积分多少钱" |
| `createOrder` | 快照金额/积分；**60s 内同 sku 未支付订单复用**（防双击重复下单）；`PAYMENT_LIVE=false` 时拒绝非 mock 渠道 |
| `getOrder` | 订单查询（含 `expires_at`） |
| `markPaid` | 支付入账，**三重幂等**（见下） |
| `closeOrder` | 关闭待支付订单 |
| `listOrders` | 用户订单历史 |

### 2.3 幂等与安全设计（关键）

**三重幂等**：
1. 只有 `status=1` 才能流转到 `2`，重复回调直接返回 `credited:false`；
2. 行级锁 `SELECT ... FOR UPDATE` 防并发双写；
3. `channel_order_id` 唯一索引兜底。

**金额防篡改**：回调金额必须与下单快照一致，否则 `400101` 拒绝入账。

**防假支付**：`PAYMENT_LIVE=false` 时非 mock 渠道直接拒绝，避免测试环境被误当真实支付。

### 2.4 API 端点

```
GET  /billing/skus                    （公开）SKU 目录
POST /billing/orders                  {sku, channel} → 订单
GET  /billing/orders/:id              订单状态（轮询用）
GET  /billing/orders                  订单历史
POST /billing/orders/:id/close        关闭待支付订单
POST /billing/notify/:channel         渠道回调（服务端到服务端）
POST /billing/orders/:id/mock-pay     mock 渠道确认（仅联调）
```

### 2.5 前端（`/pricing`）

原来 SKU 是硬编码的 4 个数字、按钮 `disabled` 写「Beta 开放购买」。现在：
- SKU 来自 `GET /billing/skus`，展示单价、总积分、「约合 N 条 5s 视频」；
- 点「立即购买」→ 下单 → 支付 → **成功 Toast + 余额实时刷新**；
- 未入账时进入**轮询确认**（3s 一次，最多 60 次 ≈ 3min，符合 api-spec）；
- 待支付订单卡片（订单号/金额/积分 + 关闭按钮）；
- 空态、骨架屏、错误提示、移动端适配。

### 2.6 顺带修复的缺陷

**积分流水页类型映射缺失 `recharge`** —— 后端写的是 `recharge`，前端映射表里只有 `purchase`，导致真实充值记录在流水页显示英文 `recharge`。已补 `recharge` 并保留 `purchase` 兼容。

### 2.7 测试基础设施修复

**多个测试文件并行发码挤占同一 IP 频控桶**（20 条/小时），导致 flow/assets/pipeline/admin 测试集体失败。
修复：把 IP 阈值提为可配置 `SMS_IP_HOURLY_LIMIT`，测试/CI 放宽到 100000。

## 三、验收结果

### 3.1 支付 API 端到端：23/23

```
1    SKU 目录公开可读                    ✅ 4 个
1b   SKU 含价格与积分                    ✅ 5000分/500积分
2    登录（初始余额 80）                 ✅
3    PAYMENT_LIVE=false 拒绝真实渠道      ✅ 防假支付
4    mock 渠道下单成功                    ✅
4b   订单快照金额与积分                   ✅ 5000/500
4c   订单状态待支付                      ✅
5    60s 内重复下单复用同一订单            ✅ 防双击
6    支付前余额未变                      ✅
7    标记支付成功并入账                   ✅
7b   余额 +500                          ✅ 80 → 580
8    重复支付幂等（不重复入账）            ✅ credited=false
9    支付回调重复到达不重复入账            ✅
10   回调金额与订单不符时拒绝入账          ✅ 400101
11   订单查询显示已支付                   ✅
12   订单历史可查                        ✅ total=2
13   流水记录 recharge +500              ✅
14   充值后正常报价                      ✅
15   关闭未支付订单                      ✅
15b  关闭后状态已关闭(3)                  ✅
16   已关闭订单不可支付                   ✅ 400101
17   积分 ledger 不变式（含充值）          ✅ Σdelta=580 balance=580
18   跨空间订单隔离                      ✅ 400102
```

### 3.2 支付 UI 端到端：10/10

```
1. 登录进入工作台          ✅
2. 定价页展示 SKU 套餐      ✅ cards=4
2b 价格来自后端            ✅ ¥50,¥100,¥300,¥600
2c 显示当前余额            ✅ 80
3. 购买按钮可用            ✅
4. 购买成功有 Toast        ✅ "充值成功，+500 积分"
5. 余额 80 → 580          ✅
6. 积分流水含「充值」       ✅
7. 充值后余额够跑整条流水线  ✅ 580 ≥ 88
8. 移动端无横向溢出        ✅ overflow=0
console errors            ✅ none
```

### 3.3 全量回归

```
单元/契约测试：102 项通过（api 59 / adapters 9 / shared 13 / db 11 / worker 4 / storage 6）
其中新增 billing 契约测试 8 项：SKU 目录、渠道拒绝、订单复用、幂等入账、金额篡改、
                              状态机、ledger 不变式、跨空间隔离
lint / typecheck：全绿（--force 全量）
```

## 四、仍未做的事（B 型剩余项）

| 项 | 状态 | 阻塞原因 |
|---|---|---|
| **真实微信/支付宝对接** | 仅 mock 渠道 | 需要商户号、API v3 密钥、证书；`PAYMENT_LIVE=true` 后生效 |
| **真实供应商（视频生成）** | 全程 mock | 需要 ARK / DeepSeek / 百炼 Key |
| **合规备案** | 占位符 | 需企业主体与行政流程 |

> 支付代码已按真实渠道结构实现（`channel` 字段、`channel_order_id` 幂等、`notify` 回调端点、金额校验），
> 接入真实渠道时只需在 `notify` 中补签名校验与证书配置，无需改动订单与入账逻辑。
