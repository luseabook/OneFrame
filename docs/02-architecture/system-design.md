# 系统设计文档

> v1.1 · 2026-10-24 · 从复刻蓝图 §1/§4 深化；模块边界参考竞品微服务前缀划分〔RM-证据：路由表 df/ai/task/cam/crc/op 前缀族〕
> v1.1 变更：AI 标识后处理（RE-07）、data_center 四区路由（RE-15）、script 模块职责补拆集与定稿校验（RE-04/06）

## 1. 系统拓扑

```
                ┌────────────── CDN(静态资源/落地页SSG) ─────────────┐
用户浏览器 ────►│  apps/web Nuxt3 (SSR API代理层可选, MVP直连API域名)  │
                └────────────────────────────────────────────────────┘
                          │ HTTPS /api.example.com
                          ▼
              ┌───────────────────────────┐
              │ NestJS API (apps/api)     │  无状态,水平扩展
              │ modules: auth·spaces·     │
              │  models·generations·tasks │
              │  billing·assets·files·ops │
              └───┬──────────┬─────────┬──┘
                  │          │         │
        ┌─────────▼──┐ ┌────▼────┐ ┌──▼───────────────┐
        │ PostgreSQL │ │ Redis   │ │ BullMQ queues    │
        │ (业务主库) │ │ 缓存/锁 │ │ gen.submit      │
        └────────────┘ │ 会话    │ │ gen.poll        │
                       └─────────┘ │ result.transfer │
                                   │ notify          │
                                   └───┬───────────────┘
                                       ▼
                          ┌────────────────────────┐
                          │ Worker (apps/worker)   │
                          │ packages/model-        │
                          │ adapters: 火山/百炼/    │
                          │ 可灵/Vidu/DeepSeek...  │
                          └───────┬────────────────┘
                                  │ 结果转存
                                  ▼
                          对象存储 OSS(私有桶) + CDN 预签名
```

## 2. 模块职责与依赖规则

| 模块 | 职责 | 可依赖 | 禁止依赖 |
|---|---|---|---|
| auth | 手机号登录/JWT/发码频控 | spaces | 其他业务模块 |
| spaces | 个人空间(自动)/成员(Ph3) | — | — |
| models | 模型目录/计价表/quote | billing(读余额估算) | adapters |
| generations | 参数校验/风控/入队/幂等 | models, billing, files | adapters |
| tasks | 状态机/轮询/取消重试/事件 | models, billing | adapters |
| billing | 积分账户/流水/订单/支付回调 | — | 业务模块(只被依赖) |
| script | 剧本项目/导入剧本拆集/大纲/角色定稿/分镜编排（MVP 旗舰）：LLM 同步步骤(硬超时 30s)+批量投递编排（预算/定稿/模型枚举校验） | models, tasks, assets, files, billing | adapters |
| assets | 资产/目录/标签/回收站 | files, tasks(读) | — |
| files | STS 直传/预签名/上传校验 | — | — |
| ops | 配置中心/AB/公告/后台 | 全部(只读) | — |

**依赖方向单向：API 模块 → billing/models 基础域**；模块间调用走内部 service 接口，禁止跨模块直查表（为未来拆服务留缝）。

## 3. 关键时序

### 3.1 任务创建（冻结 → 入队）

```
Web            API(generations)        Redis/PG          BullMQ
 │ POST /v1/generations │                │                 │
 │─────────────────────►│ ① Idempotency-Key 查重(Redis SETNX) │
 │                      │ ② 参数校验(对照 models.modes 枚举)  │
 │                      │ ③ quote: model_prices 查价          │
 │                      │ ④ 事务: tasks(INSERT PENDING)       │
 │                      │   + credit_accounts.frozen+=cost    │
 │                      │   + credit_flows(freeze)            │
 │                      │ ⑤ gen.submit.add(task_id) ───────►│
 │◄─ 200 {task_id,...} ─│                                    │
```

失败路径：④ 余额不足抛 745701（不落任务）；⑤ 入队失败回滚事务；幂等重放返回原任务。

### 3.2 Worker 执行（submit → poll → transfer）

```
Worker                 Adapter(火山…)          OSS            PG/Redis
 │ gen.submit 领取 │                        │               │
 │ submit(req) ──────► vendor_task_id          │               │
 │ 状态→RUNNING(2) ──────────────────────────────────────────► │
 │ gen.poll 加入延时队列(5s起,指数退避≤30s,上限=模型超时) ───► │
 │   poll(vendor_task_id) ─► {SUCCEEDED, uris}│               │
 │   ├─ 未终态: 重新延时入队                    │               │
 │   └─ 终态:                                │               │
 │       a) 内容审核拦截 → REVIEW_REJECTED + 解冻               │
 │       b) 失败 → FAILED + 解冻 + error{vendor_code}          │
 │       c) 成功 → result.transfer                          │
 │            下载 uri ────────────────────────► 转存私有桶    │
 │            post-process(必须成功后才结算)：                 │
 │              视频：ffmpeg 烧录"AI生成"水印 + 写 mp4 元数据   │
 │                    (comment/©too：task_id/model/生成时间)   │
 │              图片：重编码(剥 EXIF)+写 XMP/PNG tEXt AI 标识   │
 │              probe 校验(可解码 + 标识可读)                  │
 │            results 写回 + 结算(frozen-=,balance-=,consume)  │
 │            notify(SSE推送/到期推送)                       │
```

**超时兜底**：poll 总时长 > 模型 P99×2 → 标记 FAILED(kind=vendor_timeout) 并解冻；vendor 查询接口 5xx 连续 5 次 → 告警并继续退避（不轻易判死，供应商偶发抖动）。

### 3.3 结果下载（预签名）

`GET /v1/tasks/{id}/results/{n}/download-url` → 校验属主 → `sign_url(私有桶key, 24h)` 返回。**任何场景不透传供应商 URL**（ADR-005）。

## 4. 失败模式与对策

| 失败 | 检测 | 对策 |
|---|---|---|
| Worker 崩溃（任务卡 RUNNING） | 心跳表 + 看门狗扫描 RUNNING>10min | 重新入 poll 队；供应商侧幂等（vendor_task_id 去重） |
| 供应商全面不可用 | adapter 健康探测(探针任务/错误率) | 熔断该模型：目录置灰 + 前端提示切换 |
| 供应商 5xx / 429 / 网络抖动 | adapter 内建重试（指数退避） | 默认重试 2 次（`maxRetries`），4xx 业务错误不重试 |
| OSS 转存失败 | transfer 队重试 3 次 | 降级：直接引用供应商 URL（24h 内）+ 告警人工补转 |
| AI 标识后处理失败 | probe/水印断言 | 重试 3 次；仍失败→FAILED 且不结算 + 告警；禁止无标识产物对外（合规硬门） |
| 支付回调丢失 | 对账任务每 5min 查未终态订单 | 主动查单补账 |
| 支付回调被伪造 | 渠道签名验签（默认拒绝） | 微信 RSA-SHA256 + 5min 时间戳容差；支付宝 RSA2；未配公钥一律 401101 |
| Redis 队列丢失(灾备) | 队列镜像/持久化(AOF) | PG tasks 表是事实来源，可重放入队 |
| 秒级重复提交 | 幂等键 | 5min 内同键返回原任务 |

### 4.1 供应商适配器契约（`packages/model-adapters`）

所有适配器实现统一接口 `ModelAdapter`（`submit` / `poll` / `cancel`），**状态与错误码归一化**，上层不感知供应商差异。

| 归一化状态 | 供应商原始状态示例 | 上层动作 |
|---|---|---|
| `pending` | `queued` / `pending` | 继续轮询 |
| `running` | `running` / `processing` | 继续轮询 |
| `succeeded` | `succeeded` / `success` | 转存 OSS → 结算 |
| `failed` | `failed` / `error` / `cancelled` | 置 FAILED → 解冻积分 |
| `review_rejected` | `rejected` / `review_rejected` / `audit_failed` | 置 REVIEW_REJECTED → 解冻 + 745802 |

**错误码统一**（与 `packages/shared` errors 对齐）：
- 内容审核驳回 → `output_rejected`（任务码 **745802**）
- 供应商执行失败/无结果 → `vendor_error`（任务码 **745900**）
- 超时 → `vendor_timeout`（**745901**）

> **实现约束（踩过的坑）**：`review_rejected` 必须在状态归一化**之前**单独识别，
> 否则会落入 `unknown → running` 分支造成**无限轮询、积分永久冻结**（已加契约测试锁死）。

**重试策略**：仅重试「网络错误 / 超时 / 5xx / 429」，指数退避（默认 2 次，基础 400~500ms）；4xx 业务错误不重试。

#### 4.1.1 供应商错误映射（`src/errors.ts`，Ark/DeepSeek 共用）

所有适配器抛出的错误统一为 `VendorError`（含 `kind` / `retryable` / `status` / `vendorCode`），
可重试类为 `RetryableVendorError`。`classifyVendorHttpError(status, bodyText, context)` 负责映射，
错误体兼容 `{error:{code,message,type}}`、`{code,message}`、`{error:"msg"}` 三种形态：

| HTTP 状态 | kind | 是否重试 | 上层动作 |
|---|---|---|---|
| 401 / 403 | `auth_error` | 否 | 告警（Key 失效/权限），提示切换模型 |
| 402 | `quota_exceeded` | 否 | 告警（供应商余额），运营充值 |
| 429 | `rate_limited` | 是 | 指数退避 |
| 400 / 404 / 422 | `invalid_param` | 否 | 置 FAILED，解冻积分，提示改参数 |
| 5xx | `vendor_error` | 是 | 指数退避，耗尽后置 FAILED |
| 其他 4xx | `vendor_error` | 否 | 置 FAILED |
| 任意状态 + 审核信号（`*SensitiveContentDetected` / `audit` / `审核` / `敏感` 等） | `output_rejected` | 否 | REVIEW_REJECTED（745802），解冻 + 提示改提示词 |
| 超时（`AbortError`） | `timeout` | 是 | 指数退避，耗尽后 `vendor_timeout` |
| 网络层错误（`TypeError`） | `network_error` | 是 | 指数退避 |

**错误文案约束**：仅保留截断后的供应商 message（≤300 字符），完整响应体不入日志/错误信息（防 Key/隐私泄漏）。
既有前缀保持兼容：Ark 为 `ark <METHOD> <path> -> <status>: ...`，DeepSeek 为 `deepseek http <status>: ...`。

#### 4.1.2 图像生成协议（火山方舟 Ark / Seedream，`src/ark-image.ts`）

| 项 | 约定 |
|---|---|
| 端点 | `POST {ARK_IMAGE_BASE_URL}/api/v3/images/generations`（同步）；若响应含 `id`/`task_id` 则降级为异步：`GET /api/v3/contents/generations/tasks/{id}` + `POST .../cancel` |
| 鉴权 | `Authorization: Bearer {ARK_API_KEY}` |
| 请求字段 | `model`（经 `ARK_IMAGE_MODEL_MAP` 映射）、`prompt`、`size`、`response_format`（默认 `url`）、`watermark`（默认 `true`，AI 标识合规）、`seed`、`guidance_scale`、`image`（图生图：单图字符串 / 多图数组，取 `first_frame_uri` + `reference_uris` 去重）、`sequential_image_generation`（`count>1` 时 `auto` + `max_images`） |
| 尺寸映射 | `resolution=720p` 按 `ratio` 映射到 Seedream 支持尺寸（`9:16→720x1280`、`16:9→1280x720`、`1:1→1024x1024`、`4:3→1152x864`、`3:4→864x1152`、`3:2→1248x832`、`2:3→832x1248`、`21:9→1512x648`）；`1080p→2K`；`1K/2K/4K` 直通；显式 `WxH` 直通；未知比例回落 `1024x1024` |
| 响应解析 | `data[].url`（主）或 `data[].b64_json`（兜底，转 data URI 并标 `inline_base64`）；异步任务从 `content[].image_url` 提取；多图按 `data[]` 顺序全部返回 |
| 结果语义 | 同步返回 `sync_results`（worker 直接转存 OSS，ADR-005）；异步返回 `vendor_task_id` 走统一轮询；成功但无图 → `vendor_error` |

**registry 选择规则**（`src/registry.ts`）：`ADAPTER_MODE=mock` 一律 mock；真实模式按序：
`deepseek:chat` → **Ark 图像**（`volcengine:image` / `volcengine:seedream`，或 `ARK_IMAGE_REPLACE_CODES` 显式列出的既有 code，如 `tomoviee:image`）→ Ark 视频（其余 `volcengine:*`）→ 通用 HTTP 网关 → 显式「未实现」报错。
`ARK_IMAGE_REPLACE_CODES` 命中但缺少 Ark Key 时**硬失败**（配置错误必须暴露），绝不静默回落 mock；
未列入时 `tomoviee:image` 仍按原样报「not implemented yet」。

## 5. 容量与扩展路径

**MVP 假设**：DAU 500，人均 3 任务/日，视频占 40%；峰值 QPS：创建 ~5，轮询 ~100（500 活跃页 × 5s 间隔 / 平均页面停留），轮询接口 Redis 缓存 3s 直接扛。

| 里程碑 | 动作 |
|---|---|
| DAU 5k | API ×2 + Worker ×3；轮询改 SSE 推送为主 |
| DAU 50k | PG 读写分离；tasks 表按月分区；拆 generations/tasks 独立服务 |
| 出海 | `users.data_center` 取 `sz|eus|eop|sgp`（默认 sz，对齐竞品 domainMap 四区〔RM-证据：domainMap 反编译〕）；OSS 跨区 + 供应商国际线路按 data_center 路由（RE 的 task/result 即按 user-info.data_center 路由） |

## 6. 技术债登记

- [ ] MVP 轮询为主，SSE 通道 Phase 2 补（Agent 对话也依赖它）；
- [ ] 供应商 Webhook（部分支持回调）MVP 不接，统一轮询，Phase 2 按家评估；
- [ ] tasks.results 的 meta 无 schema 校验（JSONB 直存），Phase 2 出 JSON Schema。
