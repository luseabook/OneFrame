# 火山方舟 Ark 图像（Seedream）适配器 + 供应商错误映射统一（2026-10-25）

> 范围：`app/packages/model-adapters`（新增 `src/ark-image.ts`、`src/errors.ts` + 契约测试）、
> `app/apps/worker/src/main.ts`、`app/apps/worker/.env.example`、`docs/02-architecture/system-design.md` §4.1。
>
> 背景：B 型「能真实收钱跑业务」要求真实图像产物（定妆图/分镜图），但真实模式下图像只有通用 HTTP 网关与 mock，
> seed 的图像模型 `adapter_code=tomoviee:image` 在 `ADAPTER_MODE=real` 下直接报错。本轮补齐 Ark 图像适配器并统一
> Ark/DeepSeek 的 HTTP 错误映射。
>
> **无真实 Key**：本轮未做真实供应商调用；协议以火山方舟官方「图片生成 API」（`POST /api/v3/images/generations`，
> 官方文档 `docs.volcengine.com` → Ark → 图片生成 API）字段定义为准，用假 fetch/本地 HTTP server 的契约测试锁定出站
> 报文与错误映射。接 Key 后的验收步骤见 §5。

## 1. 协议依据与字段映射

### 1.1 端点与鉴权

| 项 | 实现 |
|---|---|
| 同步生成 | `POST {ARK_IMAGE_BASE_URL}/api/v3/images/generations` |
| 鉴权 | `Authorization: Bearer {ARK_API_KEY}`；`content-type: application/json` |
| 异步兜底 | 若响应无图但含 `id`/`task_id` → `vendor_task_id`，轮询 `GET /api/v3/contents/generations/tasks/{id}`，取消 `POST .../{id}/cancel` |
| 超时 | `AbortController`，默认 120s（`ARK_IMAGE_TIMEOUT_MS`；图片生成远慢于文本） |
| 重试 | 仅 429 / 5xx / 超时 / 网络，指数退避（默认 2 次、基础 400ms）；4xx 业务错误与审核拒绝不重试 |

### 1.2 请求字段（`buildRequestBody`）

| Ark 字段 | 来源 | 说明 |
|---|---|---|
| `model` | `ARK_IMAGE_MODEL_MAP[model.name] ?? model.name` | 支持接入点 `ep-xxxx` 或模型 ID `doubao-seedream-3-0-t2i-250415` |
| `prompt` | `input.prompt` | 纯提示词（尺寸走 `size` 字段，不再塞 `--resolution` 之类后缀） |
| `size` | `resolution` + `ratio` 映射，见 1.3 | 默认业务值（720p）也会被映射为合法像素尺寸 |
| `response_format` | `ARK_IMAGE_RESPONSE_FORMAT ?? "url"` | 生产固定 `url`（worker 转存自有 OSS，ADR-005） |
| `watermark` | `ARK_IMAGE_WATERMARK ?? true` | AI 标识合规，默认显式水印 |
| `image` | `first_frame_uri` + `reference_uris` 去重 | 图生图/多参考图：单张传字符串，多张传数组；文生图不出现该字段 |
| `seed` | `options.seed` | 仅当业务给出数字（可复现） |
| `guidance_scale` | `ARK_IMAGE_GUIDANCE_SCALE`（配置级） | 模型支持时按需开启 |
| `sequential_image_generation` | `options.count > 1` 时为 `"auto"` + `sequential_image_generation_options.max_images = count` | 一次出多张（count 上限取 10，业务 schema 已限 ≤4） |

### 1.3 `size` 映射（`mapArkImageSize`）

| 业务 options | Ark `size` |
|---|---|
| `resolution=720p` + `9:16` | `720x1280` |
| `720p` + `16:9` / `4:3` / `3:4` / `3:2` / `2:3` / `21:9` / `1:1` | `1280x720` / `1152x864` / `864x1152` / `1248x832` / `832x1248` / `1512x648` / `1024x1024` |
| `1080p` | `2K` |
| `1K` / `2K` / `4K`（大小写不敏感） | 原档位直通（Seedream 4.x 档位） |
| 显式 `1536x1024` / `1536*1024` | 直通规范化 `1536x1024` |
| 未知比例 | 回落 `1024x1024` |

### 1.4 响应与结果归一化

| 响应形态 | 处理 |
|---|---|
| `{data:[{url, size}], usage, model}` | 逐条转 `GenResult{uri, width, height, meta:{vendor, size, usage(首图)}}`，`sync_results` 由 worker 直接转存 |
| `{data:[{b64_json}]}` | 转 `data:image/png;base64,...` 并标 `meta.inline_base64=true`（兜底路径，见 §6 限制） |
| `{id}` / `{task_id}` | 返回 `vendor_task_id`，`poll` 归一化 `queued/pending→pending`、`running/processing→running`、`succeeded/completed→succeeded`、`failed/error/cancelled→failed`、`rejected/audit_failed→review_rejected` |
| 异步结果 | `content[].image_url.url` / `data[].url` 都能解析 |
| 成功但无图 | `vendor_error`（不重试） |

## 2. 统一错误映射（`src/errors.ts`）

`VendorError{kind, retryable, status, vendorCode}`；可重试类为 `RetryableVendorError`（沿用既有类名，`instanceof` 兼容）。
入口：`classifyVendorHttpError(status, bodyText, context)`、`classifyVendorNetworkError(err, context)`；
错误体兼容 `{error:{code,message,type}}`、`{code,message}`（code 可为数字）、`{error:"msg"}`、非 JSON 文本。

| HTTP 状态 / 场景 | kind | 重试 | 上层动作 |
|---|---|---|---|
| 401 / 403 | `auth_error` | 否 | 告警：Key 失效或用例权限不足 |
| 402（DeepSeek 余额） | `quota_exceeded` | 否 | 告警：供应商余额，运营充值 |
| 429 | `rate_limited` | 是 | 指数退避 |
| 400 / 404 / 422 | `invalid_param` | 否 | FAILED + 解冻积分，提示改参数 |
| 5xx | `vendor_error` | 是 | 退避重试，耗尽后 `vendor_timeout`/FAILED |
| 其他 4xx | `vendor_error` | 否 | FAILED |
| 审核信号（`OutputImageSensitiveContentDetected` / `AuditFailed` / `sensitive` / `审核` / `敏感` / `违规` 等） | `output_rejected` | 否 | REVIEW_REJECTED（745802）+ 解冻 + 提示改提示词 |
| 超时 `AbortError` | `timeout` | 是 | 退避，耗尽 → `vendor_timeout`(745901) |
| 网络 `TypeError` / DNS / 连接重置 | `network_error` | 是 | 退避 |
| 2xx 但非 JSON / 缺结构 / 成功无产物 | `vendor_error` | 否 | FAILED（供应商协议异常，重试无益） |

**兼容性约束（已用测试锁死）**：既有报错前缀不变 —— Ark `ark <METHOD> <path> -> <status>: ...`、
DeepSeek `deepseek http <status>: ...`；错误信息只保留截断后（≤300 字符）的供应商 message，完整响应体不入日志。

## 3. registry 与 worker 装配

| 场景 | 解析结果 |
|---|---|
| `ADAPTER_MODE=mock` | `MockAdapter`（不访问供应商） |
| `deepseek:chat` | `DeepSeekChatAdapter`（缺 `DEEPSEEK_API_KEY` 显式报错） |
| `volcengine:image` / `volcengine:seedream` | Ark 已配置 → `ArkImageAdapter`；未配置 → 回退通用网关/原报错（不静默 mock） |
| `ARK_IMAGE_REPLACE_CODES` 列出的既有 code（如 `tomoviee:image`） | 显式映射到 `ArkImageAdapter`；**缺 Ark Key 时硬失败**（配置错误必须暴露） |
| 其他 `volcengine:*`（视频） | `ArkVideoAdapter` |
| 通用网关 | `HTTP_VIDEO_BASE_URL` 配置时走 `HttpVideoAdapter` |
| 其余供应商 code | 显式 `vendor adapter not implemented yet: <code>` |

worker `main.ts` 新增读取：`ARK_IMAGE_MODEL_MAP`、`ARK_IMAGE_BASE_URL`、`ARK_IMAGE_TIMEOUT_MS`、
`ARK_IMAGE_RESPONSE_FORMAT`、`ARK_IMAGE_WATERMARK`、`ARK_IMAGE_REPLACE_CODES`（逗号分隔）；
`ARK_API_KEY` 同时服务视频与图像，图像模型映射可独立覆盖。`.env.example` 已加占位与注释。

## 4. 修掉/发现的缺陷

1. **registry 把图像 code 当视频**：原实现 `code.startsWith("volcengine:")` 一律返回 `ArkVideoAdapter`，
   真实模式下 `volcengine:image` 会把图像请求发到视频任务接口（必然失败且消耗额度）。已按图像优先分流。
2. **Ark/DeepSeek 错误映射缺失**：原来仅按状态码二分（>=500/429 重试、其余不重试），供应商 `code` 直接丢弃，
   审核拒绝在 HTTP 层不可识别、无法区分余额不足/参数错误/Key 失效。已抽 `src/errors.ts` 统一映射并保留 `vendorCode`。
3. **Ark 视频审核失败落 `failed`**：`failed` 任务若带 `OutputImageSensitiveContentDetected` 等审核码，原实现返回
   `failed`，上层不解冻为 745802 分支 → 用户体验与合规口径都不对。已改为 `review_rejected`。
4. **Ark 视频缺 task id 时抛裸 `Error`**：无 `kind`，运营排查只能看字符串。已改为 `vendor_error`（保留原文案）。
5. **DeepSeek 402 无语义**：原实现 4xx 一律裸 Error；现为 `quota_exceeded`，便于告警区分「充值」与「Key 失效」。
6. **DeepSeek 缺 `choices` / 非 JSON 响应**：原来可能被当网络错误重试或直接裸抛；现为明确 `vendor_error`（不重试）。
7. **worker env 解析重复代码**：三处 `JSON.parse` IIFE 抽为 `parseJsonRecord`/`parseCodeList`，解析失败保持原语义（忽略）。
8. **worker `main.ts` 死导入**：`drizzle-orm` 的 `and/eq/isNotNull/lt/sql` 全部未使用（`pnpm --filter @app/worker lint` 原本 5 个 error），
   顺手清理后 worker lint/typecheck/test 全绿。

## 5. 真实 Key 接入步骤（上线前验收）

1. 火山方舟控制台开通「图片生成（Seedream）」，确认模型 ID 或接入点 `ep-xxxx`；申请 API Key。
2. worker 环境：`ADAPTER_MODE=real`、`ARK_API_KEY=...`、`ARK_IMAGE_MODEL_MAP={"seedream-3.0":"doubao-seedream-3-0-t2i-250415"}`
   （或用 `ep-` 接入点）；若要让既有图像模型 code 走 Ark：`ARK_IMAGE_REPLACE_CODES=tomoviee:image`。
3. 冒烟 1（文生图）：创建一条 `mode=text2image` 任务，确认出站 `size/response_format/watermark`、
   响应 `data[].url` 可下载、worker 转存 OSS 成功、任务 SUCCEEDED 且结算一次。
4. 冒烟 2（图生图）：传 1 张与 2 张参考图，确认 `image` 字段为字符串/数组两种形态均被接受。
5. 冒烟 3（审核）：用会触发审核的提示词，确认任务 `REVIEW_REJECTED`、错误码 `output_rejected`、积分解冻（745802）。
6. 冒烟 4（错误分层）：故意用错 Key（401→auth_error 不重试）、把模型名改错（400/404→invalid_param 不重试），
   并检查日志中无完整响应体泄漏。
7. 成本确认：`count>1` 走 `sequential_image_generation`，按实际生成张数计费，需与运营核对报价规则。

## 6. 已知限制 / 未覆盖风险

1. **无真实 Key，未做真实调用**：字段名与响应形态以官方文档为准，接 Key 后必须按 §5 逐项冒烟；若官方字段有变更，
   仅需改 `ark-image.ts` 的 `buildRequestBody`/`parseImageResults`，上层与测试契约同步调整。
2. **`b64_json` 兜底不可直接落地**：worker `transferResult` 只识别 `http(s)` URL，`data:` URI 会被当作「已转存 key」
   直接写入 `tasks.results`（体积巨大且不可下载）。生产**必须保持** `response_format=url`（默认值，`.env.example` 已注明仅调试）。
3. **同步图像路径无取消语义**：`cancel()` 只对异步兜底任务生效；同步请求超时由 AbortController 结束 HTTP，供应商侧可能仍计费。
4. **重试可能重复计费**：Ark 图片接口无幂等键（无 `client_task_id`），5xx 后重试可能重复生成；当前仅在明确可重试错误上重试，
   建议上线后按供应商账单核对。
5. **审核码枚举靠信号匹配**：`CONTENT_REJECTION_PATTERNS` 覆盖常见 code/中英文关键词，供应商新增审核 code 未命中时会落到
   `invalid_param`/`vendor_error`（仍不重试，但任务状态不是 REVIEW_REJECTED）。需持续补充模式。
6. **尺寸映射是启发式**：Seedream 3.0 与 4.x 支持的枚举不同，业务 `resolution/ratio` 组合超出表内比例时回落 `1024x1024`，
   可能不是用户期望比例；建议前端按模型目录限制可选比例。
7. **`guidance_scale` 无业务入口**：当前只能由部署配置统一设置，前端暂无对应选项。
8. **DeepSeek 402 语义为新增 kind**：`quota_exceeded` 为本次新增，若外部有按字符串匹配旧日志的看板需同步。

## 7. 测试计数与验证

| 命令 | 结果 |
|---|---|
| `pnpm --filter @app/model-adapters test` | **87 passed**（基线 21 → +66，测试数只增不减） |
| `pnpm --filter @app/model-adapters typecheck` | 通过 |
| `pnpm --filter @app/worker typecheck` | 通过 |
| `pnpm --filter @app/worker lint` | 通过（顺带清掉 `main.ts` 5 处死导入） |
| `pnpm --filter @app/worker test` | 9 passed（未回归） |
| `pnpm --filter @app/model-adapters lint` | 通过 |

新增/变更测试文件：

| 文件 | 数量 | 覆盖 |
|---|---|---|
| `src/errors.spec.ts` | 25 | 状态码映射表（401/403/402/400/404/422/418/429/5xx）、错误体三种形态、审核信号、截断不泄露、网络/超时归一化、显式 retryable 覆盖 |
| `src/ark-image.spec.ts` | 28 | 出站报文（文生图/图生图/多参考图/seed/guidance/sequential/尺寸映射）、url/b64/多图解析、异步 task 兜底与状态归一化、400/401/429/5xx/网络/超时/审核/无图、registry 6 项 |
| `src/deepseek.spec.ts` | 11 | 401 不重试、402 quota、429 重试后成功、5xx 耗尽、超时/网络→RetryableVendorError、缺 choices、非 JSON、不泄露全文、缺 prompt、鉴权头回归 |
| `src/ark-contract.spec.ts` | 12 → 14 | 新增：审核类失败码→review_rejected；5xx 保留 vendorCode/status |

> 全量测试不依赖外网、不依赖真实 Key、可重复执行（假 fetch / 本地 HTTP server）。
> 说明：`pnpm --filter @app/api typecheck` 本轮受并行任务未完成改动影响（`apps/api/src/modules/billing/channels/channel.service.ts`
> 引用了尚不存在的 `../../config/env`），与本改动无关；api 仅以 `DeepSeekChatAdapter` 的公开方法 `chat/submit/poll/cancel`
> 使用本包，签名未变，registry 变更不影响 api 编译。

## 8. 改动文件

- 新增：`app/packages/model-adapters/src/errors.ts`、`src/ark-image.ts`、`src/errors.spec.ts`、`src/ark-image.spec.ts`、`src/deepseek.spec.ts`
- 修改：`src/ark-video.ts`（错误统一 + 审核码映射，re-export `RetryableVendorError` 保持兼容）、`src/deepseek.ts`（错误分层）、
  `src/registry.ts`（图像优先分流 + `arkImageCodes`）、`src/index.ts`（导出 errors/ark-image）、`src/ark-contract.spec.ts`（+2 测试）
- worker：`apps/worker/src/main.ts`（Ark 图像配置与 env 解析）、`apps/worker/.env.example`（新 env 占位）
- 文档：`docs/02-architecture/system-design.md` §4.1.1（错误映射表）/ §4.1.2（Ark 图像协议与 registry 规则）
- 未改动：`apps/api/src/modules/billing/**`、`apps/api/src/config/env.ts`、`apps/api/src/main.ts`、`apps/api/src/db/seed.ts`、
  `apps/api/test/**`、`apps/web/**`、`docs/05-ops/**`、`docs/06-security-compliance/**`、`_acceptance/**`、`pnpm-lock.yaml`；无新增依赖；未 git commit。
