# 剪影生图网关接入（第三方图像供应商）

> v1.0 · 2026-11-05 · 状态：**已实施（adapter + 目录 + UI + sidecar 部署）**
> 上游源码：`E:\jianying-image-gateway-src-v1.2.0\jianying-image-gateway`（v1.2.0），
> 已收录为 `app/services/jianying-gateway/`（Python sidecar，不改其业务代码）。
> 关联：`system-design.md` §4.1（适配器契约）、`provider-management.md`（协议族）、
> ADR-005（不透传供应商 URL）、`06-security-compliance/`（AI 标识硬门）。

## 1. 它是什么，我们怎么定位

网关把剪影 App（`com.mediaeditor.video 5.2.2`）内置的 AI 生图协议包成 **OpenAI Images API**：

```
我方 worker ──► jianying-gateway(:8788, 内网) ──► newapi.jianyingeditor.cn（豆包 Seedream）
              (同步 10–25s/张)                    (RSA+AES 私有协议)
```

**定位：候选/兜底图像通道 + 能力评测，不是计价主链路。** 理由是运维属性而非技术偏好：
上游密钥随 App 版本轮换（`tools/extract_keys.py` 依赖新版 APK），改版即断供。
因此它排在 Ark/Seedream 之后的 `model_routes.priority`，并且必须能一键切走（§7）。

## 2. 三条硬约束（设计输入，不是建议）

| # | 约束 | 后果 | 我方处置 |
|---|---|---|---|
| 1 | 网关**默认擦水印**（`REMOVE_WATERMARK=true`，用上游 inpaint 修补角标） | 与本项目「AI 标识是结算前硬门」直接冲突（`apps/worker/src/label.ts`），且每张多一次上游调用 +4–8s | sidecar `.env.example` 写死 `REMOVE_WATERMARK=false`，compose 里再双保险一次；适配器默认发 `watermark:"keep"` |
| 2 | 上游**按 URL 拉图**（`reference_image` / `/edits`） | 我方预签名 URL 会被转发到剪影服务器 | 适配器只传 URL 字符串（不用文件上传），预签名按**单次短 TTL** 签发；不配 `PUBLIC_BASE_URL`（网关不需要对外） |
| 3 | 同步 10–25s/张，网关内部并发 4 | 适配器 `submit()` 要扛 25s | `timeoutMs=180_000`、`maxRetries=0`（**实测**：网关内部已重试 3 次，上游不可达时整条请求 18s 才回 502；适配器再叠 1 次就是 ~36s 白等，且 502 已归一为不可重试）、`MAX_CONCURRENCY=4` |

## 3. 接线（三层，各一处）

```
model_providers.protocol = "jianying"          ← 协议族新增（admin-providers.*）
        ↓  buildProviderAdapterOptions
AdapterRuntimeOptions.jianyingImage           ← apps/worker/src/provider-runtime.ts
        ↓  resolveAdapter(adapter_code, options)
models.adapter_code = "jianying:image"        ← 目录（apps/api/src/db/seed.ts id=1047n）
        ↓
JianyingImageAdapter                          ← packages/model-adapters/src/jianying-image.ts
```

为什么**不复用** `openai-compatible`：那条分支按 `capability` 分 text/video 且依赖 `GET /models`
发现；剪影是「只有 image + 同步 + 私有效果词表」，套进去会走错分支（同 `h3` 的先例）。

`adapterHint` 命中时**必须清空** `ark`/`h3`/`httpVideo`，否则全局 `ARK_API_KEY` 会把请求抢走
（`provider-runtime.ts` 的既有 P0 教训）。

## 4. 参数映射（适配器内部）

| GenerationRequest | 网关字段 | 说明 |
|---|---|---|
| `input.prompt` | `prompt` | ≤3000（目录里 `max_prompt_length: 3000` 与之对齐） |
| `options.ratio` | `aspect_ratio` | **目录只允许 1:1 / 4:3 / 3:4**（上游仅 3 画布，其余是本地裁切） |
| `options.resolution` | `resolution` | `1K→1k`、`2K→2k` |
| `options.count` | `n` | 夹在 1..4，网关并行出图 |
| `options.effect` | `effect` | **图生图必填**（缺失 → `vendorParamError`，否则网关静默用默认「3D 童话」） |
| `options.style` | `style` | 可选，网关 22 个预设 id（前端本批未上，见 §5） |
| 参考图（`first_frame_uri` 优先，其次 `reference_uris[0]`） | `reference_image` | 有值即走风格迁移，仍走同一 JSON 路径 |
| `options.seed` | — | **不下发**（网关忽略，下发了等于骗用户可复现） |
| `options.mask_uri` / `reference_uris[1]` | — | **本批未接线**：网关的 mask 要 data URL，我方 mask 是 URL，需下载转码（另批）。适配器**显式报错**，不静默丢弃 |

**画幅诚实性**：上游只有 1024²/1152×864/864×1152 三张画布，16:9 之类是裁切产物。
目录里只声明 3 个比例——把 13 个比例列出来等于承诺"能控构图"，实际拿到的是裁切图。
需要 16:9 封面属于**导出/画布层**的二次裁切，不在生成页骗人。

## 5. 前端（目录投影，不改脊柱）

前端不需要新页面：`ImageGenWorkspace.vue` 的档位 pill 全由 `models.modes[mode]` 驱动，
`mode` tab 由 `modes` 的键决定。因此接入工作量是**数据 + 一处组件**：

| 改动 | 文件 |
|---|---|
| 目录档位（3 比例 / 1K2K / 1-4 张 / 3000 字） | `apps/api/src/db/seed.ts`（id 1047n） |
| 效果清单（网关优先 + 静态回落 + 1h 缓存） | `apps/api/src/modules/models/image-effects.ts` + `GET /v1/effects` |
| 风格选择器（图生图必选，禁止默认选中） | `apps/web/components/EffectSelect.vue` + `ImageGenWorkspace.vue` |
| 后台协议下拉 | `apps/web/components/admin/AdminProvidersPanel.vue` |

**效果清单为什么要过 API**：网关在内网（浏览器打不到）、上游 id 不应进入前端契约、
断供时前端不能白屏。`GET /v1/effects` 永远 200：网关在线以其返回为准，否则回落
`IMAGE_EFFECT_FALLBACK`（18 项 + 中文名）。

**UI 上不出现的东西**：去水印开关（合规）、`seed` 输入（网关无视）、
`crop/pad/stretch` 选择（变形/模糊是缺陷不是选项）。

## 6. 部署

```bash
# 1) sidecar 配置（.env 不入库）
cd app/services/jianying-gateway
cp .env.example .env        # 必填 API_KEYS=openssl rand -hex 24

# 2) 起网关（生产：compose 内网，不 publish 端口）
docker compose -f docker-compose.prod.yml up -d jianying-gateway

# 3) 供应商与路由（后台 → 供应商接入）
#    protocol=jianying  base_url=http://jianying-gateway:8788  api_key=<同上 API_KEYS>
#    路由：model=jianying-draw → remote_model_id=jianying-draw

# 4) API 侧效果目录（可选，不带也能跑：回落静态表）
#    apps/api/.env: JIANYING_GATEWAY_BASE_URL=http://jianying-gateway:8788
```

本机开发：`services/jianying-gateway/start.bat` 已移除，直接
`python -m pip install -r requirements.txt && python run.py`（`HOST=127.0.0.1`）。

## 7. 断供与轮换（必须能 1 分钟切走）

| 场景 | 动作 |
|---|---|
| 上游 `406`（拉不到源图） | 参考图不是公网可直链或预签名已过期；检查 TTL |
| `502 upstream_error` | 上游波动；适配器不重试（网关已重试 3 次），任务按 `vendor_error` 失败并解冻 |
| `503 upstream_unavailable` | 网关熔断打开（8 连败/30s）；按 `rate_limited` 语义退避 |
| App 改版导致签名失效 | 后台把 `model_routes` 该条 `active=false`，流量回落 Ark；用 `tools/extract_keys.py` 重新提取，只改 `app/jianying.py` 常量 |
| 长期 | 若最终要转生产主链路，再用 `node:crypto` 把 RSA/AES/X-Sign 内联进 Node（独立批次，同一套契约测试护住），届时 sidecar 可下线 |

## 8. 本批未做（明确边界）

1. **蒙版重绘**（`inpaint`）未接线：需把 mask URL 下载转 data URL，另批；`inpaint` 工具仍走既有 `image-inpaint` 供应商。
2. **22 个预设风格**（`GET /v1/styles`）未上 UI：网关只给 id + 缩略图、**没有名称**，需要运营补中文名后才能做选择器；先上的是 18 个有标题的 `effects`。
3. **多参考图**、`negative_prompt`、`fit` 用户可选：均不做（见 §5）。
4. 网关侧 `qqbot/`、`start.sh`/`.bat`：与本项目无关，未收录。

## 9. 验收

```bash
# 适配器（不启网关，注入 fetch）
pnpm --filter @app/model-adapters test
# API（效果目录 + 部署不变量）
pnpm --filter @app/api exec vitest run src/modules/models/image-effects.spec.ts
# 前端
pnpm --filter @app/web typecheck && pnpm --filter @app/web build
```

端到端（需真网关）：`/create/image-to-image` 选风格 → 出图 → 检查
`tasks/results/credit_flows` 三表 + `results.meta.ai_label.explicit|implicit` 已写入
（标识由 worker 打，网关侧未擦除上游角标）。