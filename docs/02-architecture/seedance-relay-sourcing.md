# Seedance 中转站采购清单（2026-11-06 实测）

> 数据来源：各站 `/api/status` 与 `/api/pricing` **公开端点**，无需登录，可随时复跑复核。
> 复核命令：`curl https://<域名>/api/status` 与 `curl https://<域名>/api/pricing`
> 关联：[free-compute.md](free-compute.md)（免费算力总策略）、[provider-management.md](provider-management.md)

---

## 0. 一句话结论

官方价 Seedance 2.5 720p = **¥1.51/秒**。中转站卖到 **¥0.55/秒（36%）**，Seedance 2.0 Mini 卖到 **¥0.03~0.05/秒（约官方 1 折）**。
接口是 **OpenAI 兼容的 `POST /v1/videos`**，可直接接进 `model_routes`。

---

## 1. 注册门槛（这是「能不能白嫖」的唯一判据）

全部取自 `/api/status` 的真实字段，非推测：

| 站 | `register_enabled` | `password_register` | `email_verification` | `turnstile_check` | `checkin` | OAuth 限制 |
|---|---|---|---|---|---|---|
| **buliangrenai.com** 不良人AI | ✅ true | ✅ true | **❌ false** | **❌ false** | ❌ | 无 |
| **dragon3api.com** DragonAPI | ✅ true | ✅ true | ⚠️ true | ⚠️ true | ❌ | 无 |
| **link-ai.cc** Link-AI | ✅ true | — | ⚠️ true | ❌ false | ✅ **true** | GitHub 可选 |
| **gzxsy.vip** 星思研 | ✅ true | — | ❌ false | ❌ false | ❌ | **仅 Linux Do** |
| **4zapi.com** 4Z API | ✅ true | — | ⚠️ true | **阿里云滑块** | ❌ | GitHub / LinuxDo |

**结论**：`buliangrenai.com` 是唯一「**纯邮箱/密码注册 + 无邮箱验证 + 无人机验证**」的站。
`dragon3api.com` 要邮箱验证 + Turnstile，但**文档最完整、接口最标准**。
`gzxsy.vip` 单价最低（官方 7.5%），但注册卡在 Linux Do 账号。

---

## 2. 真实单价（`/api/pricing` 原值，2026-11-06）

### dragon3api.com · 分组 `视频`（单位：元/秒）

| model_name | 480p | 720p | 1080p | 4k | 折官方 |
|---|---|---|---|---|---|
| `seedance-2.0-mini` | 0.03 | **0.05** | — | — | **约 1 折** |
| `seedance-2.0-fast` | 0.05 | 0.08 | — | — | 约 1 折 |
| `seedance-2.0` | 0.12 | 0.25 | 0.60 | 1.45 | 约 25% |
| `seedance-2.5` | 0.25 | **0.55** | 1.35 | — | **36%** |
| `seedance-2.5-draft` | 0.25 | — | — | — | 草稿档 |
| `seedance-1.0-fast` | — | 0.02 | 0.06 | — | 兜底 |
| `seedance-1.5-pro` | 0.33 | 0.02 | 1.30 | — | 异常低价 |

按次型号：`seedance-2.0-per-call` ¥4.75/次（5–15s 同价）、`seedance-2.5-per-call` ¥12.50/次、`seedance-2.0-per-call-max` ¥6.25/次。

### buliangrenai.com · 分组 `视频分组`（单位：元/条）

| model_name | 单价 |
|---|---|
| `seedance2.5` | **¥1.5/条** |
| `seedance2.5-933` | ¥2/条 |
| `seedance2.0mini` | ¥1.5/条 |
| `seedance2.0-933` | ¥2/条 |
| `seedance2.0fast-933` | ¥2/条 |
| `seedance2.0-720-满血真人` | ¥6.5/条（10/15s） |
| `minimax-h3` | ¥1.5/条 |

> `group_ratio.视频分组 = 1`，充值比例 `1 元 / $1`，`quota_per_unit = 500000`。
> ¥1.5/条 ≈ **$0.224/条**，比官方 720p 4 秒（¥6）便宜 4 倍。

### 其他站（司南算力 2026-11-06 抓取，官方价比率）

| 站 | Seedance 型号 | 实付 | 占官方 |
|---|---|---|---|
| gzxsy.vip | `seedance2.5` | ¥0.250/次 ≈ $0.037 | **7.5%** |
| dragon3api.com | `seedance-2.5-draft` | ¥0.250/次 | 7.5% |
| link-ai.cc | `Seedance-2.0-720p` | ¥0.650/次 ≈ $0.097 | 8.6% |
| buliangrenai.com | `seedance-2.5-G2` | ¥0.400/次 ≈ $0.060 | 12% |
| omnixai.cn | `doubao-seedance-2-0` | ¥0.099/次 | 21%（**注册已关闭**） |

---

## 3. 接口契约（dragon3api 有正式文档，其余同源 New-API）

```
POST https://newapi.dragon3api.com/v1/videos
Authorization: Bearer sk-xxx
Content-Type: application/json

{
  "model": "seedance-2.5",
  "prompt": "海浪拍打海岸，镜头缓慢推进",
  "seconds": 4,
  "aspect_ratio": "16:9",
  "resolution": "720p"
}
→ { "id": "task_xxx", "model": "...", "status": "queued", "progress": 0 }
```

支持字段：`model` / `prompt` / `seconds` / `resolution` / `aspect_ratio` / `size`（`1280x720` 写法）/ `input_reference`（Grok 本地图）。
任务查询见 `/tasks`。规格不支持时**直接 400，不建任务、不扣费**。

**关键**：`seconds` 不传时按该分辨率**最短时长**计费——对我们反而是好事（草稿档默认最便宜）。
但 `seedance-2.5` 官方 `duration=-1` 会自选 4–30 秒，这里必须显式传 `seconds: 4`。

---

## 4. 「白嫖」的真实机制（没有注册送额度，但有这四条）

这些站是**付费转售**，不是"注册送 $X"型。能免费用的是：

| 机制 | 在哪 | 说明 |
|---|---|---|
| **签到** | `link-ai.cc`（`checkin_enabled: true`） | 每日签到续额度，是唯一"能续"的 |
| **邀请返佣 5%** | `dragon3api.com`（公告 id=6） | 好友充值前 3 次各返 5%，计入「邀请额度」，可转主余额（最低 $1） |
| **兑换码补偿** | `dragon3api.com` 公告 id=7 | 事故补偿码 `MAKEUP0826`（2 额度，已过期）——**盯公告蹲新码** |
| **超低价当白嫖** | 全部 | ¥1 能出 **7~20 条** Seedance（¥1.5/条 或 ¥0.05/秒×4s） |

> **实话说**：不存在"注册送额度 + 纯邮箱 + Seedance 2.5"的站。这类站上游成本就是真金白银，送不起。
> 但把「¥1 = 7 条 2.5」当成免费档用，比找不存在的注册礼实在。

---

## 5. 风险（工程约束）

| 风险 | 后果 | 对策 |
|---|---|---|
| **随时跑路** | 站长公告「已暂停充值，去新站 fanjian.cc」（link-ai.cc 原文） | 只充小额（¥10 级），不囤额度 |
| **模型非官方** | `seedance2.0-933`、`-满血真人`、`G2`、`draft-plus` 全是**站方自命名**，不代表官方版本 | 用 Veridrop / 司南探针跑协议一致性，别信名字 |
| **排队/审核拒** | dragon3api 明说「可能排队较久，提交后不能取消」 | 草稿档跑通再上成片 |
| **计费口径变** | dragon3api 一天内改 3 次倍率（0.5→0.42→0.16→0.12） | 每次批量前重拉 `/api/pricing` |
| **数据出境/留存** | 提示词与素材过第三方 | 只跑合成素材，用户素材不进这条链路 |

---

## 6. 接进项目（最小改动）

`model_routes` 已支持 `protocol` + `base_url` + `priority`：

```
(model_id=seedance-2.5, priority=0,  protocol=openai-video,
 base_url=https://newapi.dragon3api.com, remote_model_id=seedance-2.5)
(model_id=seedance-2.5, priority=100, protocol=ark,
 base_url=https://ark.cn-beijing.volces.com, remote_model_id=ep-xxx)
```

`packages/model-adapters` 需加一个薄适配器（`/v1/videos` + `{id}` 轮询），
或复用 `http-video.ts` 的 `submitPath=/v1/videos`、`pollPath=/v1/videos/{id}`（字段名需映射 `seconds`/`resolution`/`aspect_ratio`）。

`provider_quotas` 表按 §free-compute.md 记账，额度耗尽自动回落 `priority=100`。

---

## 7. 复核脚本（每次采购前跑）

```bash
# 注册门槛
for d in buliangrenai.com dragon3api.com link-ai.cc gzxsy.vip 4zapi.com; do
  echo "== $d"
  curl -s "https://$d/api/status" | jq '{register_enabled, password_register_enabled, email_verification, turnstile_check, checkin_enabled, github_oauth, linuxdo_oauth}'
done

# 视频单价（只看 seedance）
curl -s "https://newapi.dragon3api.com/api/pricing" \
  | jq -r '.data[] | select(.model_name|test("seedance")) | "\(.model_name)\t\(.model_price)\t\(.enable_groups)"'
```
