# 文本 / 视频音轨两条通道（2026-11-05 批次）

> v1.0 · 2026-11-05 · 状态：**已实施（文本通道 + H3 音轨接线）**
> 关联：`system-design.md` §4.1（适配器契约）、`provider-management.md`（协议族）、
> `jianying-gateway-integration.md`（图像通道）、`self-hosted-video-inference.md`（H3 能力边界）、
> `01-product/PRD.md`（音频能力排在 v1.1）

## 1. 一页结论

| 通道 | 用什么 | 落点 | 首发必需 |
|---|---|---|---|
文本（拆集/分镜解析/角色抽取/剧本改写） | 任意 OpenAI 兼容 Chat 网关（当前：OpenCode Zen Go） | `openai:chat` → `DeepSeekChatAdapter` | ✅ |
图像（文生图/风格迁移） | 剪影生图网关 | `jianying:image` | ✅ |
视频 + **音轨** | 自建 H3（H3-Base：视频+音频联合生成） | `h3:video` | ✅ |
配音 TTS / 配乐 BGM / 对口型 / 成片合成 | **不接** | `postprocess` 族保持未配置 | ❌ 按 PRD 是 **v1.1** |

依据（不是偏好）：`PRD.md:225` 把「成片自动合成(拼接+BGM+字幕)、TTS 配音进流水线」列为 **v1.1**；
`PRD.md:16`/`:66` 首发导出形态是**逐镜下载 / 全集 zip**。所以首发**不需要**独立语音供应商——
H3 自带音轨已经覆盖"有声音的视频"，缺的只是"可控的台词重录"，那是 v1.1 的活。

## 2. 文本通道：OpenAI 兼容 + 供应商私有头

### 2.1 为什么用 `openai:chat` 而不是 `deepseek:chat`

适配器实现是同一个通用 OpenAI Chat 客户端，但 `adapter_code` 是**对外契约**：
模型 vendor 不是 DeepSeek 时不该背 DeepSeek 的名字（运营换供应商只看 code）。
`registry.ts` 里 `openai:chat` 与 `deepseek:chat` 走同一个实现，缺 Key 都硬失败、绝不静默 mock。

### 2.2 供应商私有要求从配置注入，不写进代码

OpenCode Zen Go 在 OpenAI 协议之外**强制**一个会话头，缺了直接：

```json
400 {"type":"error","error":{"type":"MissingSessionID",
 "message":"Request is missing x-opencode-session and cannot be routed efficiently."}}
```

两个端点都一样（`https://opencode.ai/zen/go/v1` 与文档给的
`https://opencode.ai/inference/go/openai/v1`）。这类要求是**供应商局部**的，因此：

```json
// model_providers.options（后台"供应商接入" → 高级选项）
{
  "headers": { "user-agent": "oneframe-worker/1.0" },
  "session_header": "x-opencode-session"
}
```

- `headers`：静态头。Zen 的文档还要求客户端**自报 UA**（不要用通用 SDK/HTTP 库 UA）。
- `session_header`：需要「每会话稳定」的活值。`provider-runtime` 用 **task.space_id** 填
  （`buildProviderAdapterOptions(..., sessionContext)`）——同一空间内稳定，才能吃到 prompt cache；
  一次一换等于把缓存全废。
- 合并顺序：`extraHeaders` 先铺，`authorization` 最后写 —— 配置里塞同名头也顶不掉鉴权。

### 2.3 容量与计费（先算清再用）

Zen Go 是**订阅额度制**（$10/月 Go 档），不是按 token 付费；模型级月限额差异极大：

| 模型 | 5h 请求 | 月请求 |
|---|---|---|
`deepseek-v4.1-flash` | 43,330 | 216,670 |
`glm-5.3-flash` | 6,320 | 31,580 |
`glm-5.3` | 220 | 1,080 |
`qwen3.8-max` | 160 | 810 |

→ 批量步骤（拆集/分镜解析）用 flash 档，贵模型只留"导演级定稿"。5 小时窗口只有月额度 20%，
**高峰期会撞墙**，必须限流。
我方定价口径：文本 `per_call`，**2 积分/次**（`seed.ts` 文本分支写死；
`model-catalog.spec.ts` 有断言锁住，改动需同步）。

### 2.4 通道边界（写进选型记录）

Zen Go 的条款明确是给 **coding agent** 用的（要求自报 UA、发 coding 类流量、监控滥用）。
我们跑的是剧本/分镜，不是 coding 流量。**结论：当开发期/评测期通道用**；生产文本建议走
DeepSeek 官方或火山方舟——同样一条 `openai-compatible` provider 就能切，换供应商不改代码。

## 3. H3 音轨：之前"有开关但没人读"

### 3.1 现状修正

| 事实 | 位置 |
|---|---|
H3-Base 是**视频+音频联合生成**（768p） | `self-hosted-video-inference.md:52` |
目录里 `minimax-h3` 就标着「音频生成 / 口型同步」、`audioVideoSupport: true` | `seed.ts:710-722` |
前端按 `audio_video_support` 发 `enable_audio` | `VideoGenWorkspace.vue:265` |
**但没有任何适配器读过它** | 本批修复前 `grep enable_audio packages/` 零命中 |

于是"面板上关掉音效"是静默无操作：H3 照样出带音轨的视频（多花算力、用户改不了）。

### 3.2 本批接线

```ts
// h3-gateway.ts buildBody
audio: options.enable_audio ?? true,              // 开关真下发；缺省 true（联合生成不静默静音）
refs: { images, videos: [], audios: audioReferences(options) },  // Ref2VA 最多 3 条音频参考
```

- 音频参考走 `options.audio_uris`（`toolOptionsSchema` 已登记，`max(3)`）。**必须登记**：
  zod 默认剥掉未声明键，不登记等于前端发上来就被丢，症状是「传了音频但模型没听」。
- 结果侧 `meta.has_audio` 已有（`h3-gateway.ts:115`、`:73`），前端可据此显示"含音轨"。

## 4. H3 分辨率天花板：不许静默降级

自建 H3 最高 **1344×768**（`H3-Base`；`Regenerate-2K` 是 API-only、未开源）。
而目录里 `minimax-h3` 默认档位是 **2K**。若把 2K 请求路由到自建网关，**静默返回 768p**
= 用户按 2K 付钱拿到 768p，账实不符且不可见。

本批口径：**显式失败**

```ts
assertH3LocalResolution("1080p" | "2K" | "4K" | "1920x1080")  // → vendorParamError，任务 FAILED + 解冻
// 运营确认这条路由只做草稿/试镜时，provider.options 打开 allowResolutionDowngrade 放行
```

三条出路（按场景选，不要混）：
1. 目录档位改成 `768P` 并标注「本地档」——诚实但"成片"看起来低；
2. 2K/1080p 走 MiniMax 官方 API（`minimax:video` 已有 adapter 位，只缺 Key）；
3. H3 只做**草稿/试镜**，成片档位置灰并引导 —— 与 `self-hosted-video-inference.md` §C2
   「混合路线，不是替换」一致（**推荐**）。

## 5. 后台接线步骤（三个通道一致）

```
① 供应商接入（/ops/admin/providers）
   文本：protocol=openai-compatible  base_url=https://opencode.ai/inference/go/openai/v1
         api_key=oc_sk_…  options={"headers":{"user-agent":"oneframe-worker/1.0"},"session_header":"x-opencode-session"}
   图像：protocol=jianying           base_url=http://jianying-gateway:8788  api_key=<网关 API_KEYS>
   视频：protocol=h3                 base_url=<H3 网关地址>  api_key=<网关 key>
         options={"allowResolutionDowngrade":false}
② 模型路由（model_routes）：我方模型名 → remote_model_id（zen 用官方模型 id，如 deepseek-v4.1-flash）
③ 目录可见性：后台置 visible；价目表已有（文本 2 积分/次、图像与视频按档位）
```

`PROVIDER_DB_RESOLVE=on` 时 worker 只认路由快照（任务提交即固化），轮询期间改供应商不影响在途任务。

## 6. 本批未做（明确边界）

1. **TTS / 配乐 / 对口型 / BGM 合成**：按 PRD 属 v1.1；`postprocess` 族保持"未配置即显式报错"
   （`requires apiKey in real mode`），不做假实现。
2. **音频参考的素材上传链路**：`audio_uris` 接受我方 OSS key/预签名 URL，但前端还没有音频上传入口
   （`/create/*` 现在只传图/视频），属 UI 批次。
3. **多会话 prompt cache 粒度**：会话键取 `space_id`（稳定优先）。若将来要精确到"项目级会话"，
   需要在 tasks 表带 `project_id` 时改用 project——那是一次数据层改动。
4. **Zen 之外的文本供应商**：同一 adapter 可接，只需后台加 provider；不做多供应商自动故障转移
   （`model_routes.priority` 已具备排序，切换仍是人工置灰）。