# 自建 GPU 推理接入设计（H3 视频模型 · 租卡路线）

> v0.1 · 2026-11-04 · **状态：提案，待 Owner 决策 D1~D5（§0）**
> 范围：把 `minimax-h3` 从「调 MiniMax 官方 API」改为「租 GPU（如天工云/同类平台）自建推理」，接入现有 generations → worker → model-adapters → 结算链路
> 非目标：训练/微调流水线、自研推理内核、把 2K 成片也搬到本地（**物理上做不到，见 §1.2**）
> 依据：`system-design.md §3.2/§4`、`provider-management.md §2`、`packages/model-adapters/src/{types,http-video,registry}.ts`、`apps/worker/src/{executor,provider-runtime,queues}.ts`

---

## 0. 结论（先看这 6 条）

| # | 结论 | 依据 |
|---|---|---|
| C1 | **能自建的只有 768p 档；2K 必须留在 API。** H3 是三模块架构，只有 `H3-Base` 开源，`Context-IR` 与 `Regenerate-2K` 是 API-only。本地最高画布 1344×768（≈0.98MP） | §1.2 |
| C2 | **路线是混合，不是替换**：本地 768p 出草稿/预览/批量试镜（高频、可丢弃），API 出 2K 成片（低频、要交付）。两者是**同一模型的两个档位**，不是两个供应商 | §1.2、§8 |
| C3 | **边际成本差 5~35 倍（按步数），但真实门槛是 5,000~10,000 条/月**：自建 768p 5s 一条 ¥0.10（8 步）~¥0.61（50 步），API ¥2.9~3.24；含 0.5 人运维后需 170~330 条/天 才回本。你们当前 ≈1,200 条/月，**先按需租卡，不要常驻池** | §8、§11.0 |
| C4 | **不能把 base_url 指到本地就完事**。现有 `http-video` 适配器 + worker「同步轮询 15 分钟」的模型假设的是「供应商队列很深、我方 worker 无限」；自建 GPU 池是**容量有限、会被抢占、冷启动几十秒到几分钟**的自己的资源。必须先改轮询拓扑（§5.4），否则一个 24G 卡会成为全站吞吐天花板 | §2、§5.4 |
| C5 | **GPU 侧不做业务**：网关（控制面）+ 节点代理（数据面）两层，节点只 pull 任务、只往 OSS 写。所有鉴权/计费/合规标识留在现有 API 与 worker | §3、§12 |
| C6 | **许可证是产品约束，不是法务附录**：适用地域排除 EU/英国/韩国/美国；商用须在 UI 显著标注 "MiniMax H3"；**禁止用 H3 输出改进其它模型**（意味着「用出片训自有风格 LoRA」这条路要先拿书面许可）；年营收 >$2000 万需申请 | §1.3 |

**待 Owner 决策**：

- **D1**：是否接受「2K 永久走 API」的分档（影响定价页与前端档位文案）。
- **D2**：GPU 平台选型：天工云（需先确认是否真有 GPU IaaS）vs 国内可比平台（AutoDL/共绩/优云/揽睿），或先用 serverless GPU 做 burst（§13）。
- **D3**：现阶段是否只按需租卡、不上常驻池（按 §11.0，当前月产 ≈1,200 条，建议**先按需**；过 5,000 条/月再议常驻）。
- **D4**：是否把 `gen.poll` 预留队列真正启用（§5.4 的前置改造，约 2~3 人日）。
- **D5**：本地档是否对用户可见（建议只作为「草稿/预览」不单独售卖，避免与 2K 成片混淆）。

> 若考虑「用户自带云账号、我方编排出片」（BYOC），见 [byoc-user-gpu.md](byoc-user-gpu.md)——本文的网关/节点/适配器/队列设计是它的技术底座，只是池的归属从"我方"换成"用户"。

---

## 1. 事实基线（决定架构的三个硬约束）

### 1.1 模型规格

| 项 | 值 | 来源 |
|---|---|---|
| 架构/参数 | H3-Omni-Transformer **33B dense**（非 MoE）；AdaLN 分支约 13B 可预计算、推理不加载 → DiT 常驻约 20B；外挂 H3-Encoder = **Qwen3-VL-32B**（取第 50 层隐状态）→ **推理常驻约 52B** | HF 模型卡 / SGLang cookbook |
| 原生输出 | 2560×1440 / 24fps / 5~15s / 32kHz 立体声 | 官方 |
| 本地最大画布 | 1344×768（0.98MP），短边固定 768、须为 32 的倍数、帧数对齐 `17k+5` | 官方 + 社区实测 |
| 权重体积 | BF16 123.6GB；int8 生产组合 **67GB**（34GB DiT + 27GB 编码器 + VAE）；仓库全量（双 checkpoint + diffusers 副本）= **498GB**；社区 GGUF Q4 11.4 / U16G 15 / Q8 20.2GB | HF 仓库 / 社区 |
| 主机内存 | 24G 卡靠分层 offload 需 **≥64GB**（实测峰值 68GB），否则 OOM 或整机卡死 | 官方实测 |
| 变体 | FL2VA（文/首尾帧）、Ref2VA（参考驱动：9 图 + 3 视频 + 3 音频），均为 **CFG 蒸馏**（非步数蒸馏，所以步数仍要自己降） | 官方 |
| 服务化 | SGLang（首选，OpenAI 兼容 `/v1/videos`）、vLLM、diffusers、ComfyUI；Ulysses / TP / 跨机 Ring / FSDP | SGLang cookbook |
| 许可 | **不是"随便用"**，见 §1.3（地域排除 + UI 署名 + 营收门槛 + 禁止蒸馏） | LICENSE / 许可证 FAQ |

### 1.2 开源边界（这条决定了产品分档）

```
H3-Context-IR      多模态指令理解/改写提示词     ✗ 未开源（API only）
H3-Base            视频+音频联合生成 768p        ✓ 已开源
H3-Regenerate-2K   768p → 2K 再生                ✗ 未开源（API only）
```

即：**租卡自建拿不到 2K**。你们 seed 里 `minimax-h3` 的默认档位是 `2K`（`app/apps/api/src/db/seed.ts:717`），所以「全量自建」在产品上不成立；能自建的是 `768P` 档与 `minimax-h3-sale` 的 720p/1080p 档（后者本地只能出 768p，需在目录里改成 `768P` 或标注「本地档」）。

### 1.3 许可证（工程约束，不是法务附录）

| 条款 | 内容 | 对我们的影响 |
|---|---|---|
| 适用地域 | Applicable Territory = 全球**排除 EU / 英国 / 韩国 / 美国**；在这些地区使用、复制、分发、展示权重均属未授权 | 大陆可用；**出海首发若选欧美，自建路线直接不成立**（API 全球可用） |
| 商用 | 非独占、不可转让、免版税；**年营收 > $2000 万**须先向 `api@minimax.io` 书面申请；**无 MAU 门槛** | 现阶段免费；触发线要进"公司里程碑"清单 |
| 署名 | 商用产品/服务 **UI 上必须显著标注 "MiniMax H3"**；分发须附协议副本 + NOTICE | 前端模型卡片要加固定署名，不能只写"第三方模型" |
| 托管 SaaS | **允许**，但须：合理的技术/组织防护、把同等限制 flow-down 给每个用户、维护举报通道并处置 | 用户协议要加条款；举报入口要落到现有上报链路 |
| 禁止 | ① 不得用 H3 或其输出改进其它 AI 模型（含蒸馏、合成数据训练）；② 不得在适用地域外使用/展示 | 影响 Phase 3 的"风格 LoRA"计划——**用 H3 输出训自有模型属于禁止项**，要先取得书面许可 |
| 准据法 | 香港特别行政区法律 + 香港法院专属管辖 | 合同/主体安排留痕 |

> 编码器 Qwen3-VL-32B 本身是 Apache 2.0，不受上述地域限制。

---

## 2. 为什么这不是「换个 URL」

| 维度 | 现有供应商（API） | 自建 GPU 池 |
|---|---|---|
| 容量 | 弹性，只要付钱 | **固定**：1 卡 = 1 并发（视频模型显存吃满，见 §6.2） |
| 排队 | 对方队列，通常秒级~分钟级 | 我方队列，峰值可到 30~60 分钟（要暴露 queue_position） |
| 失败语义 | 5xx/429 重试 | 抢占中断、OOM、节点掉线、模型加载失败 |
| 冷启动 | 无 | 换卡/重启要加载 **67GB** 权重：本地盘 1.8~2.7 分钟，网络盘最差 11.5 分钟（§6.1/§6.3） |
| 计费 | 按条/按秒，事后可对账 | **按卡时**，空转也烧钱；必须记 GPU 秒数才能算毛利 |
| 限流 | 供应商限你 | **你限自己**；入口不设闸就会把队列堆成事故 |
| 合规标识 | 拿 URL → 转存 → 打标 | 同链路不变，但产物直接落自有桶，转存步骤要改（§7.3） |

`http-video.ts:100-127` 的 `submit` 只发 `prompt/image/reference_images/duration/ratio/resolution/count/client_task_id`，**不带 audio/video 参考、不带 seed/steps/variant**；`poll` 归一化后只认 4 个状态。H3 的 R2V 与可复现性都靠这些字段，所以不要复用 `http-video` 当正式通道（可以临时用它联调）。

---

## 3. 分层架构

```
                    ┌──────────── 现有控制面（不改职责）─────────────┐
Web/API ──► generations ──► tasks(PG) ──► BullMQ gen.submit ──► worker
                                                              │
                                                resolveAdapter("h3:video")
                                                              │
                    ┌─────────────────────────────────────────▼──────────────────────┐
                    │  h3-gateway（我方部署，无 GPU，可水平扩展）                      │
                    │  ·鉴权(内部 token/mTLS) ·准入(并发/配额) ·队列(Redis)            │
                    │  ·调度(变体/显存档/优先级) ·租约 ·进度 ·取消 ·成本记账            │
                    │  ·预分配 OSS key，签发 node 侧 presigned PUT                     │
                    └───────┬──────────────────────────┬────────────────────────────┘
                    pull    │                          │  pull
                    ┌───────▼────────┐        ┌────────▼─────────┐
                    │ GPU node agent │  ...   │ GPU node agent   │   ← 只出站，不开入站端口
                    │ 常驻权重/1并发  │        │                  │
                    │ SGLang worker  │        │                  │
                    └───────┬────────┘        └────────┬─────────┘
                            │ 直传（presigned PUT）     │
                            ▼                          ▼
                      OSS staging/ ──► worker 转存+打标 ──► OSS 私有桶（现有 ADR-005 链路）
```

**分层理由**：GPU 节点是「会被回收的宠物」，网关是「无状态牲畜」。把调度写进 NestJS 会让 API 进程持有 GPU 状态（重启即丢），也违反 `system-design.md §2` 的模块依赖规则。

---

## 4. 契约设计

### 4.1 对外（worker → gateway）：沿用 `ModelAdapter` 三方法

新增 `adapter_code = "h3:video"`（`registry.ts:138` 的 `resolveAdapter` 分支），**不复用** `minimax:video`（后者语义是官方 API，将来还要并存做 2K）。

```
POST /v1/videos/generations
{
  client_task_id: "<tasks.id>",          // 幂等键，重复提交返回同一 job
  model: "minimax-h3",
  variant: "fl2va" | "ref2va",           // 由 mode 推导：universal_reference→ref2va
  prompt, negative_prompt?,
  resolution: "768p", aspect_ratio: "16:9", duration_s: 5,
  seed, steps: 8, guidance: 5.0,
  refs: { images: [{ uri, role: "identity"|"first_frame"|..., }],
          videos: [{ uri, role }], audios: [{ uri, role }] },
  priority: "interactive" | "batch",     // §5.1
  deadline_s?: 600
}
→ 202 { job_id, queue_position, est_wait_s }

GET  /v1/videos/generations/{job_id}
→ { status: queued|running|succeeded|failed|cancelled|review_rejected,
    progress?: 0..1, queue_position?, stage?: "load"|"sample"|"decode"|"upload",
    results?: [{ key, width, height, duration_s, has_audio, sha256 }],
    engine: { model_commit, variant, quant, steps, sampler, torch, cuda, node_id },
    error?: { code, message, retryable } }

POST /v1/videos/generations/{job_id}/cancel      // 尽力而为：running 阶段 kill 子进程
GET  /v1/capacity → { nodes: [{ node_id, gpu, vram_free_mb, variants_loaded, queue }], }
```

`status` 归一化直接对齐 `types.ts:28` 的 `VendorTaskState`，`review_rejected` 必须在归一化前单独识别（`system-design.md:190` 的踩坑约束同样适用）。

### 4.2 对内（gateway → node）：pull + 租约

```
POST /agent/lease      { node_id, capabilities:{gpu,vram,variants_loaded,model_commit}, free_vram }
→ { job | null, lease_s }

POST /agent/jobs/{id}/progress  { stage, progress, vram_peak_mb }
POST /agent/jobs/{id}/complete  { key, sha256, ffprobe:{width,height,duration_s,has_audio} }
POST /agent/jobs/{id}/fail      { code:"oom"|"preempted"|"model_load_failed"|"timeout"|"internal", message }
POST /agent/heartbeat  { gpu_util, vram_used, disk_free, temp, loaded_models }
```

约束：节点**永不接受入站**（NAT/安全组只有一个出站允许列表）；租约 TTL 60s，掉线自动回收；`complete` 必须带 `sha256`，网关 HEAD 校验后才置 succeeded。

### 4.3 任务快照要加引擎字段

现有 `tasks.route_snapshot` 固化 `provider/base_url/remote_model_id`（`provider-runtime.ts:9-19`，D4 决策）。自建必须把 **量化/步数/采样器/模型 commit** 一起固化，否则「同参数两次出片不同」「换了节点画质漂移」无法归因：

```jsonc
// route_snapshot.engine（新增可选块，旧任务缺省不影响）
{ "model_commit":"<sha>", "variant":"ref2va", "quant":"Q8_0", "steps":8,
  "sampler":"res_multistep", "scheduler":"simple", "sage_attention":true,
  "resolution":"768p", "duration_s":5, "node_pool":"prod-a100" }
```

`results.meta` 回写 `engine + gpu_seconds + cost_cents`（§8 的毛利核算依据）。

---

## 5. 调度

### 5.1 优先级与公平

| 优先级 | 来源 | 策略 |
|---|---|---|
| P0 interactive | 单点工具、付费会员点「生成」 | 先到先得 + 60s 老化（防饿死），超 `est_wait_s > 300` 直接提示或回落 API |
| P1 batch | 剧本流水线批量投递、分镜预览 | 打包执行（同 variant/同分辨率连续跑，摊薄加载与预热），可被 P0 抢占排队位但**不中断已运行任务** |
| P2 backfill | 重跑、评测集、影子对比 | 只在队列空时执行，可用竞价卡 |

单用户/单 space 并发上限（如 2），超额返回 `7457xx` 限流码（新增错误码，走 `packages/shared` errors）。

### 5.2 显存分档与变体路由

| 档 | 卡 | 可载 | 用途 |
|---|---|---|---|
| S | 24G（4090/4090D/L4） | Q4_0/U16G 单变体 + 部分 offload（需 64G 系统内存 + NVMe） | 草稿、P2 backfill |
| M | 48G（L40S/A6000/L20） | Q8_0 单变体，无 offload | 主力 768p |
| L | 80G（A100/H800） | int8 全量 **+ 双变体常驻**，可 concurrency=2 | 生产主力 |

同一个 job 只能落在「已加载该 variant 且 VRAM 足够」的节点上；**不要跨变体调度**（换变体 = 重新加载 21GB，等于一次冷启动）。

### 5.3 打包与并发

- 单卡默认 `concurrency = 1`：视频扩散在采样阶段吃满 SM，2 并发吞吐提升通常 <1.4×，但 p95 延迟翻倍。
- 仅 L 档允许 `concurrency = 2`，且只对 P1/P2 开放。
- 打包窗口 30s：凑够同 variant 的 3~5 个 batch job 再派发，减少权重换入换出。

### 5.4 前置改造：轮询拓扑（**这是唯一的阻塞项**）

现状：`runGenerationTask` 在 worker 里**同步循环**轮询，1s 一次，硬上限 `POLL_MAX_MS=15min`（`system-design.md:122-153`）。自建下有两个直接冲突：

1. **队列等待可能 >15 分钟** → 任务被判 `vendor_timeout` 并解冻，GPU 还在跑，钱白烧。
2. **一个 worker 槽位被一条视频占满 15 分钟** → worker 并发数被迫等于 GPU 槽位数，GPU 一扩，worker 也要跟着扩（无意义的成本）。

最小改造（对应 D4）：

```
gen.submit → submit 到 gateway（拿到 job_id）→ 落库 → 投递 gen.poll(delay=3s)
gen.poll   → GET job；非终态 → 重新入队 delay=3~5s（指数退避到 10s）
            → 终态 → 转存/打标/结算（现有 runGenerationTask 后半段原样复用）
            看门狗：updated_at 超时阈值按 route 分档（selfhost 45min，API 15min）
```

`gen.poll` 已经是 `RESERVED_QUEUES` 里的预留名（`queues.ts:19`、`system-design.md:40-45`），启用时同步补处理器并改 `queue-topology.spec.ts` 的守卫——这正是当初留名的目的。工作量约 2~3 人日（含测试）。

**不改的兜底**：若暂不启用 `gen.poll`，则至少把 selfhost 路由的 `POLL_MAX_MS` 提到 45min、轮询间隔提到 5s，并把 worker 并发与 GPU 槽位解耦（worker replicas = GPU 槽位 × 3）。这是能跑的过渡态，但会把「worker 崩溃 → 任务重投 → 重新 submit」的已知缺陷（`system-design.md:163`）放大到 GPU 上。

---

## 6. 节点与运行时

### 6.1 镜像与启动

- 基础镜像固定 `torch==2.x + cuda 12.x`，权重**烘进节点本地 NVMe**（`/models/h3/{variant}/{quant}/`），不要每次从对象存储拉 67GB。
- 24G 卡必须配 **≥64GB 主机内存**（DiT 34GB 靠分层 offload 流式，实测峰值 68GB）；48G/80G 卡才能免 offload。
- 启动序列：`verify sha256 → load weights（本地盘分钟级）→ warmup 固定 shape（5s/1344×768）→ 注册 heartbeat`。参考量级：8×B300 上 `load` 118s + warmup 29~39s（不含下载）；从网络盘拉权重则冷启动 1.8~2.7 分钟，最差 11.5 分钟。
- **不要把 `torch.compile` 当加速开关**：官方明确它会改变数值输出，不能用于一致性基准；要提速用 Spectrum / Cache-DiT / 蒸馏，并各自挂质量门禁（§11.2）。
- 版本锁定：镜像 tag = `h3-<model_commit 前 8 位>-<runtime 版本>`，与 §4.3 的 `engine.model_commit` 强一致；节点上报 `model_commit`，不一致的节点不接单。

### 6.2 运行时选择

| 选项 | 适用 | 说明 |
|---|---|---|
| **SGLang serve** | 生产 | OpenAI 兼容 `/v1/videos`，支持 `--num-gpus/--ulysses-degree` 多卡；网关直接反代即可，少写一层 |
| ComfyUI + GGUF 节点 | 实验/量化矩阵 | Q8_CR/U16G 依赖 ComfyUI-GGUF 节点，换运行时加载不了；只用于基准测试 |
| diffusers 自研脚本 | 不推荐起步 | 显存/并行/quant 全要自己写，收益不明 |

**建议**：生产用 SGLang + int8 剪枝权重（80G 卡全量常驻），实验用 ComfyUI 跑量化矩阵（§11.1）。两条路径的产物**不可直接比性能**（裁剪版与基线版质量不同，社区已明确警告）。

**文本编码器必须做缓存**：32B 编码器占常驻参数一半，**每换一个新提示词多 15~25s**，而它只在提示词完全相同时可复用。漫剧流水线里同一镜头常被批量重跑（改 seed/改时长不改提示词），所以：

- 缓存键 = `sha256(prompt + negative_prompt + encoder 版本)`，值 = encoder 输出的 embeds（落 Redis/本地盘，几 MB 级）；
- 命中缓存直接跳过编码，`engine.text_encoder_cache=true` 进结果元数据；
- 批量投递时按提示词分组（§5.3 打包窗口顺便做），同一组连续跑。

这是自建侧少数「不花算力就能提速 20~30%」的地方，成本几乎为零。

### 6.3 冷启动与常驻策略

| 场景 | 策略 |
|---|---|
| 生产常驻池 | 工作时间（09:00-24:00）保持 N 卡热；夜间缩到 1 卡 |
| 缩容 | 先 drain（拒绝新 lease）→ 等当前 job 完成 → 关机；不要直接 kill（一条 5s 片可能已跑 3 分钟） |
| 急扩 | 竞价/serverless 实例加入 P2 backfill，**不接 P0**（随时被回收） |
| 模型切换 | 双变体都常驻只可能在 80G 档；48G/24G 档按队列预测提前 2 分钟预热 |

---

## 7. 存储与数据流

### 7.1 key 规划

```
staging/gen/{yyyy}/{mm}/{task_id}/{n}.mp4          ← 节点直传（预分配，presigned PUT，限 content-length）
gen/{yyyy}/{mm}/{task_id}/{n}.mp4                  ← worker 转存后的正式 key（现有 ADR-005 语义）
gen/{yyyy}/{mm}/{task_id}/{n}.mp4.ai.json          ← 现有 AI 标识旁车（不变）
```

网关在 submit 时就生成 staging key 并签发 15 分钟 presigned PUT（`Content-Type: video/mp4`，`Content-Length` 上限按档位算：768p/15s ≈ 30~60MB，留 4× 余量）。节点**只拿到自己那一个 key**，拿不到桶的其它权限。

### 7.2 免代理

产物绝不能经网关/worker 中转下载再上传（一条 15s 2K 是几百 MB，会把 API 带宽打爆）。节点直传 staging，worker 用**同 region S3 API** 做 server-side copy + ffmpeg 打标，全程不出内网。

### 7.3 转存步骤改造

现有 `transferResult` 假设「供应商 URL → 下载 → 写自有桶」。自建下产物已在自有桶，改两处：

1. `meta.transfer = "self"`，`transferResult` 直接 `HEAD staging key` + `CopyObject` 到正式 key（幂等）；
2. `findUnlabeledResults` 与 `labelResults` 不变（合规硬门不动），只是输入从「下载的临时文件」变成「staging key 的 presigned GET」。

失败降级：copy 失败 → 保留 staging key + `meta.transfer_failed`（现有降级语义可直接复用，只是 URL 变成我方内部 key，不会 24h 失效——比供应商场景更安全）。

---

## 8. 成本模型（这张表决定做不做）

### 8.1 单价基线（2026-11-04 抓取，rentgpu.link 实时比价 / 网关价目）

| 项 | 价格 |
|---|---|
| API 768p | 官方 $0.08/s ≈ **¥0.58/s**（5s=¥2.9，15s=¥8.7）；网关 $0.09/s ≈ ¥0.65/s（5s=¥3.24） |
| API 2K | $0.13/s ≈ ¥0.94/s（官方口径 ¥0.8/s，5s≈¥4.0~4.7） |
| RTX 4090 24G | ¥0.87~2.20/h（国内按量 ¥1.98 起） |
| A6000 48G | ¥2.38/h（竞价） |
| L40S 48G | ¥4.54/h |
| A100 40G | ¥3.45/h |
| A100 80G | ¥5.15~10.75/h |
| H800 80G | ¥10.50/h |
| H20 96G（竞价） | ¥3.40/h |

### 8.2 单条成本（实测锚点：**步数是最大杠杆**）

SGLang 官方基准，5s / 1344×768 / warm（个别为社区实测）：

| 配置 | 步数 | 单条耗时 | 备注 |
|---|---|---|---|
| 单 4090 24G | 50 | **1008.6s** | 官方最小路径（int8 + 分层 offload），峰值≈18GB |
| 单 4090 + Spectrum | 50 | 285.3s | 3.53× |
| 单 4090 4.61× 加速版 | — | 219s | 社区 |
| 2×5090（TP2） | 50 | 559.7s | 官方"最快 32GB 工作点" |
| 4×H100（TP2 + Ulysses2） | 50 | **13.25s** | 官方最快档 |
| 8×B300 | 50 | 19.04s | FP8 18.03s，峰值 83.6GB/卡 |
| L40S 48G | — | 960×544 ≈ 7.2min | 社区 |
| 4090 Laptop 16G | 20 | 960×540 = 182s | 社区 |

折算 ¥/条（含 10% 重跑系数；8/20 步为按步数线性外推，非实测；A100 为估算）：

| 卡 | 时价 | 8 步 | 20 步 | 50 步 | 50 步 + Spectrum |
|---|---|---|---|---|---|
| 4090 24G | ¥1.98 | ¥0.098（≈161s） | ¥0.245（≈403s） | **¥0.61**（1008s） | ¥0.17（285s） |
| A100 80G | ¥5.15 | ¥0.10（≈64s） | ¥0.26（160s） | ¥0.65（400s） | — |
| 4×H100 | ¥47.9 | — | — | **¥0.18**（13.25s） | — |
| API 768p | — | — | — | **¥3.0~3.24** | — |

**读法**：算力成本是 API 的 1/5~1/30，但**开 50 步时单 4090 一条要 17 分钟**，等于一天最多 43 条/卡。生产默认步数必须先砍到 8~20 步（FastH3/VDN 蒸馏），否则产能比省钱更早成为瓶颈。

### 8.3 盈亏平衡（**含人力后门槛完全变了**）

```
纯算力盈亏平衡 N* = 时价 × 720 / API 单条价
含人力盈亏平衡 N' = (时价 × 720 + 运维人力) / API 单条价
```

| 配置 | 月固定成本（纯算力） | N*（5s 768p @¥3.1） | 月固定成本（+0.5 人 ¥15k） | N'（含人力） |
|---|---|---|---|---|
| 1× 4090 常驻 | ¥1,426 | 460 条/月 | ¥16,426 | **5,300 条/月（≈177/天）** |
| 1× A100 80G 常驻 | ¥3,708 | 1,196 条/月 | ¥18,708 | **6,034 条/月（≈201/天）** |
| 4× H100 常驻 | ¥34,488 | 11,125 条/月 | ¥49,488 | **15,964 条/月（≈532/天）** |
| 按需 4090（每天开 3h） | ¥180 | 58 条/月 | — | 走量时人力仍要出 |

**结论（与 v0.1 初稿不同，按实测修正）**：纯算力意义上 460 条/月就打平，但**你们是 1~2 人团队（ADR-001），加 0.5 人运维的真实门槛是 5,000~10,000 条/月（170~330 条/天）**。低于这个量：按需租卡跑批量（每天开几小时，跑完就关）比常驻划算；再低就纯 API。

### 8.4 与积分定价的关系

现有价目：`1 积分 = ¥0.1`（`¥50/500`，PRD F6）。`hailuo-2.3` 768p/6s = 12 积分 = **¥1.2 收入**；H3 API 768p 6s ≈ ¥3.9 → **每单亏 ¥2.7**。H3 目录里还没有自己的价目行（`seed.ts` 的 75 档覆盖表未含 `minimax-h3`）。

| 路线 | 6s/768p 成本 | 卖 12 积分（¥1.2） | 卖 40 积分（¥4.0） |
|---|---|---|---|
| API | ¥3.9 | −¥2.7 | +¥0.1 |
| 自建 4090（8 步） | ¥0.12 | **+¥1.08（90% 毛利）** | +¥3.88 |
| 自建 4090（50 步） | ¥0.73 | +¥0.47（39% 毛利） | +¥3.27 |

→ 自建不是"省钱优化"，而是**这个模型能不能按现有积分档位上架**的前提；但只有在月产 5k+ 时才值得养池。**阶段建议见 §11.0**。

---

## 9. 可靠性

| 失败 | 检测 | 对策 |
|---|---|---|
| 竞价实例被回收 | 节点心跳消失 / 收到 preemption 通知 | 未开始 → 重新排队；运行中 → 不重试，直接回落 API 路由（§9.1），`engine.fallback=api` 留痕 |
| OOM | agent 捕获 `CUDA out of memory` | 降级重试 1 次：分辨率 768p→640p 或 steps 8→6，`meta.degraded=true` 并在 UI 标注 |
| 模型加载失败 / sha 不符 | 启动期校验 | 节点标记 unhealthy，退出池，告警；不接单 |
| 节点掉线（网络） | lease TTL 60s 过期 | job 回队列，attempt+1；attempt>1 走 API |
| 网关重启 | — | 队列在 Redis（AOF），job 状态机幂等；worker 侧 `gen.poll` 续轮询即可（这就是 §5.4 的价值） |
| 僵尸任务 | job 超 `deadline_s` 仍在 running | 网关 kill 子进程 → failed(`timeout`)；看门狗兜底解冻 |
| 产物丢失 | `complete` 时 HEAD 不到 key | 判 failed，不结算（对齐 `ai_label_failed` 的「不结算」口径） |
| 队列雪崩 | `queue_position > N` 或 `est_wait_s > SLA` | 入口限流（`generations` 层）+ 自动回落 API + 前端提示「排队中」 |

### 9.1 回落链路（建议新增，改动小收益大）

`model_routes` 现在是一条路由一个供应商（D4：任务快照固化）。自建要加**有序回落**：

```
route: minimax-h3@selfhost (priority 0, 768p)
     → route: minimax-h3@minimax-api (priority 1, 768p)   # 队列超时/节点故障时切
```

实现上只需在 adapter 层 catch `SelfhostUnavailable` / 队列超 SLA 时，由 `generations` 重投一条到备用路由（新 task 或同 task 换 route，二选一，建议同 task 换 route + `route_snapshot` 记录切换原因）。**注意**：切换必须发生在 submit 之前，submit 成功后不换（否则 `job_id` 与 `vendor_task_id` 对不上，正是 D4 防的坑）。

---

## 10. 可观测与 SLO

| 指标 | 口径 | 告警阈值 |
|---|---|---|
| `h3_queue_depth` / `h3_wait_p95` | 按 priority 分 | wait_p95 > 300s |
| `h3_exec_p95` | 按 分辨率×时长×卡型 | 超基线 1.5× |
| `h3_fail_rate` | 按 code 分（oom/preempt/timeout） | >5% |
| `h3_gpu_util` / `vram_peak` | 节点上报 | util <40% 持续 2h（= 亏钱） |
| `h3_cost_per_clip` | `cost_cents / 成功条数` | 周环比 +20% |
| `h3_fallback_rate` | 回落 API 占比 | >10% |

现有 `observability.md` 的指标命名沿用 `task_*` 前缀，建议加 `provider=selfhost` 维度而不是新指标体系。

**SLO（草稿档）**：热池内 768p/5s，端到端 p95 ≤ 4 分钟（含排队 ≤ 60s），成功率 ≥ 97%。

---

## 11. 落地路径

### 11.0 先决定「现在做不做」（三条门槛线）

按实测修正后的判断（§8.3）：

| 月产量（768p/5s 当量） | 建议形态 | 理由 |
|---|---|---|
| **< 1,000 条** | **纯 API**（本地只做离线 POC） | 算力省下的钱 < 0.5 人运维成本；2K 反正要 API |
| 1,000 ~ 5,000 条 | **按需租卡 + API 兜底**：每天开 2~4h 批量跑，跑完关机 | 无需常驻；单条含冷启动仍比 API 便宜；不建议自建生产池 |
| > 5,000 条（≈170/天） | **常驻 1~2 卡池**（4090/5090 或 A100 80G）+ 队列化 | 人力和固定成本被摊平；此时边际成本是 API 的 1/5~1/30 |
| > 12,000 条 | 4×H100 甚至更多 | 4 卡单机 13.25s/条，但月固定 ¥34.5k，需 400 条/天摊平 |

**当下（MVP、DAU 500、单集 ~60 镜）**：一个月做 20 集 ≈ 1,200 条，落在「按需租卡」区间——**先不要常驻池**。建议顺序：先用 API 把 H3 档位跑通并定价（§8.4），同时用按需 GPU 跑 §11.1 的基准矩阵；等月产稳定过 5,000 条再上常驻。

### 11.1 阶段 0：基准矩阵（1 周，**先做这个，别先写代码**）

产出 `bench/h3-matrix.md`，24 格：

```
{ 480p, 640p, 768p } × { 5s, 10s, 15s } × { 8 步, 20 步 } × { Q4/U16G/Q8_0/int8 } × 卡
记录：wall time / 峰值 VRAM / 失败率 / 主观质量（盲评 5 分制）
```

必须回答 3 个数：**单条秒数、峰值显存、8 步 vs 20 步的质量差**。§8 的整张表现在都是估算，这三个数一改，结论可能从「划算」变成「不划算」。

### 11.2 阶段 1：影子对比（1~2 周）

同一批 30~50 条固定 prompt（含角色一致性、对白口型、产品特写、运镜四类），**双跑**本地 768p 与官方 API 768p：

- 盲评（不看来源）打分，记录「可接受率」；
- 若本地可接受率 < 80%，先别切流量，先调 prompt/步数/量化档；
- 输出 `bench/h3-parity.md`，作为后续换版本/换量化的回归基线。

### 11.3 阶段 2：切草稿流量（2~3 周）

- 上线 gateway + 1 节点（A100 80G 或 L40S）；
- `gen.poll` 启用（D4）；
- 只切「预览/草稿/分镜试镜」入口，成片档仍走 API；
- 监控 2 周，看 `wait_p95`、`fail_rate`、`cost_per_clip`。

### 11.4 阶段 3：扩池与降本

- 按队列水位自动扩到 N 卡（先手动扩，稳定后再自动）；
- P2 backfill 上竞价卡；
- 试 Turbo LoRA / 蒸馏 / 更激进量化，用阶段 1 的 parity 基线做门禁（质量掉超过阈值不许上线）。

---

## 12. 安全

- 网关与节点全部在**私有子网**，节点安全组只允许出站到 `gateway:443` 与 `oss:443`；不开任何入站端口。
- 节点身份用**短期节点证书**（网关签发，24h 轮换），不用长期静态 token；`node_id` 与 GPU UUID 绑定。
- 用户参考素材（图/视频/音频）走 presigned GET，15 分钟过期，节点不留本地副本（job 结束删工作目录）。
- 产物 key 由网关预分配，节点无法列举/覆盖别的 key（`s3:PutObject` 只授单个前缀）。
- 提示词与产物落库策略沿用现有 `security.md`；节点侧日志**不落 prompt 全文**，只落 hash + 长度（节点可能是第三方托管机）。
- 内容安全：本地推理不经过供应商审核，**必须**在出口补一道：`review_rejected` 目前只来自供应商，自建后要么接自有审核（文本+抽帧），要么明确「自建档不过审、仅草稿可见」。这条要在 D1 里一起定。

---

## 13. 平台选型清单（天工云及同类）

公开信息里「天工云」**没有 GPU 租赁业务**（已核：① 同望科技「天工云」是工程造价数据云；② 天工AI 是云端智能/大数据分析；另需区分昆仑万维「天工」，是大模型不是 IaaS）。所以要么你说的"天工云"是内部/地方性平台（那就按下面问卷要报价），要么直接换家。**不要按名字下单**：

**必须问清的 12 项**

1. 卡型与是否**独占整卡**（共享 vGPU 不能用于扩散模型）；
2. 是否支持**长时间常驻**（很多平台限制 7×24 或空闲自动关机）；
3. 本地盘：NVMe 容量/带宽（单变体 int8 约 67GB，双变体 + diffusers 全量 498GB；读带宽 ≥1GB/s）；
4. 上下行带宽与**流量计费**（产物出网是大头，一条 15s 2K 几百 MB）；
5. 是否允许自定义镜像 / privileged / 挂载（SGLang + CUDA 版本要可控）；
6. 竞价实例：中断通知提前多久、是否保证 1 小时保护期（PPIO 是 1h）；
7. 公网 IP / NAT 出站策略（节点只出站，需能连我方网关）；
8. 是否允许**对外提供生成式 AI 服务**（AUP），是否需要资质；
9. 快照/镜像保存费（每次改环境都要存镜像）；
10. 数据删除与留存策略（用户素材合规）；
11. 发票/合同/对公（走公司账）；
12. 跨区延迟与是否可同区挂 OSS（决定 §7.2 免代理能不能成立）。

**国内可比报价（2026-10-31 ~ 11-04 挂牌/聚合）**：4090 24G ¥1.07~3.49/h、4090 48G 改装版 ¥1.9~5.6/h、5090 ¥2.42~4.17/h、A100 40G ¥2.5~3.45/h、A100 80G ¥4.0~10.7/h（大厂云 7.5~12）、L40S ¥2.35~10.4/h、H100 ¥8~14/h（大厂 18~25）、H800 ¥10.5~19.5/h（稀缺）。竞价再低 30~60%，包月再低 20~40%。

**三条容易被报价单隐藏的成本**：

1. **停机≠停费**：多数平台磁盘/网盘停机后继续计费（权重 67~498GB，长期挂盘是一笔固定支出）。
2. **没有独享公网 IP**：AutoDL 用共享带宽 3~10Gbps、不单独收流量，但对外服务只能走端口映射/自定义服务；要独享 IP 得加钱，且很多平台不提供。
3. **出网流量**：若产物经云对象存储外网下发，腾讯 COS 0.5 元/GB、全球加速 1.25 元/GB、阿里云按流量约 0.8 元/GB。一条 768p/15s 约 30~60MB，1,000 条 ≈ 30~60GB ≈ ¥15~48/月——量级不大，但**2K 档会放大 5~10 倍**。

若天工云报价落在这个区间外，直接换 AutoDL/共绩/优云/揽睿。

**关于 4090 48G 魔改卡**：显存够、单价低，但无 ECC、驱动/散热不稳定，只建议用于 P2 backfill，不进生产池。

---

## 14. 明确不做

- 不自研推理内核/不训 LoRA（阶段 3 之后再评估风格 LoRA）。
- 不把 2K 搬到本地（物理不可行，`Regenerate-2K` 未开源）。
- 不做跨云多平台调度（一套网关 + 一个平台足够，多平台只在阶段 3 做 burst）。
- 不在 GPU 节点上跑内容审核/水印（合规逻辑必须单点，留在 worker）。

---

## 附录 A：新增环境变量（建议）

```
H3_GATEWAY_BASE_URL=https://h3-gw.internal
H3_GATEWAY_TOKEN=<内部 token>
H3_POLL_INTERVAL_MS=3000
H3_MAX_WAIT_MS=2700000
H3_FALLBACK_ROUTE_ID=<备用 API 路由>
H3_STAGING_BUCKET=...
H3_NODE_LEASE_TTL_S=60
```

## 附录 B：待实测清单（未实测前上面所有数字都只能当量级）

- [x] 单 4090 50 步 5s/1344×768 = 1008.6s，峰值 ≈18GB（官方基准）→ 8/20 步仍为线性外推，需实测
- [ ] A100 80G / L40S 上 8 步与 20 步的实测 wall time 与峰值 VRAM
- [ ] 8 步蒸馏 vs 20 步 vs 50 步的可接受率（盲评）
- [ ] int8 剪枝 vs Q8_0 vs FP8 的质量差
- [ ] 冷启动：本地 NVMe 直读 load + warmup 的端到端秒数
- [ ] 文本编码器缓存的命中率（按你们真实批量投递的提示词重复度）
- [ ] concurrency=2 在 80G 上的吞吐/延迟曲线（NVLink vs PCIe）
- [ ] 单集 60 镜批量打包执行的总耗时（验证 §8.3 的日产能力）
- [ ] 官方 2K 再生接口单价（决定「本地草稿 + API 2K」混合路线的成本）
- [ ] 24G 卡 + 64GB 内存的实际稳定性（offload 抖动、整机卡死率）