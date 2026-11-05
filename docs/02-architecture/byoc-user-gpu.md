# BYOC 自带算力设计（用户绑自己的云账号，我方编排出片）

> v0.1 · 2026-11-04 · **状态：提案，待 Owner 决策 B1~B5（§0）**
> 一句话：把「我方租卡」换成「用户在自己的云账号里买卡，我方做算力编排层」——绑账号 → 开卡 → 装环境 → 组池 → 调度 → 出片 → 自动关机 → 账单报告，钱从用户账上直接付给云厂商。
> 关联：[self-hosted-video-inference.md](self-hosted-video-inference.md)（自建池的技术底座，本文复用其网关/节点/适配器设计）
> 非目标：跨用户算力共享/算力交易、境外节点、本地出 2K（见 §1.3）

---

> 本文是产品与架构决策；具体到 AutoDL 的表结构、端点、状态机、页面与文案，见 [autodl-integration.md](autodl-integration.md)。

---

## 0. 结论（先看这 5 条）

| # | 结论 | 说明 |
|---|---|---|
| B1 | **这不是「绑个 Key」，是 IaaS 编排**。绑 API Key 只要 base_url + token；这里要拿用户云账号**开机器、选镜像、注环境、注册节点、管生命周期、对账**。工作量是接 API 的 5~10 倍，支持面也大得多 | §2、§9 |
| B2 | **「随用随开」是可实现的，但要分平台**：**AutoDL 已核实有容器实例 Pro API**（create / power_on / power_off / release / snapshot / save_image，且 `power_on` 支持开机即执行命令）→ 绑一次 Token 就能全自动开关机；阿里云/腾讯云/火山同样可行（RAM 子账号 + STS）；共绩/优云/恒源云等**待逐个取证**，没有 API 的只能走「粘一行命令」 | §4.2、§4.4 |
| B3 | **「组卡」多数是伪需求**。H3 单卡 4090 就能跑（5s/50 步 17 分钟，草稿档）；4×H100 才 13.25s/条，但要求**整机 NVLink 机型**，跨机 Ring 要 RDMA——普通租卡平台的 PCIe 8 卡只有 3.7× 加速。且 AutoDL Pro API 单实例**最多 4 卡**。所以「组卡」= 选对**机型**，不是「把散卡拼起来」 | §5、附录 A |
| B4 | **许可证与开源边界不变**：用户自带卡也只能出 **768p**，2K 仍走我方 API 档（我方仍要付 API 成本 → 定价必须拆「算力」与「平台」两笔）。且适用地域排除 EU/英/韩/美，境外节点不可注册 | §7、§8 |
| B5 | **商业模型要改**：算力从我们的 COGS 变成用户的钱，收入转成「编排 + 流水线 + 素材 + 审核」的平台费。不能再按「积分加价算力」收同一份钱，否则用户会算「我自己有卡凭什么付你这么多」 | §8 |

**待 Owner 决策**：

- **B1**：首发先做 **AutoDL 托管闭环**（已核实有 API，2~3 周），还是先做通用 L1 引导（覆盖更多平台但只能"提醒开关机"）？建议前者。
- **B2**：开放给谁——只对工作室/专业版开放（建议），还是全量用户？
- **B3**：BYOC 档的积分单价怎么定（建议托管档的 1/3，且**不含算力成本**）。
- **B4**：是否允许用户池闲置时「借给平台」跑 P2 backfill 换积分（建议 v1 **不做**，涉及结算与责任）。
- **B5**：用户节点上是否允许跑非 H3 模型（建议 v1 只跑 H3，减少镜像组合与支持面）。

---

## 1. 三种形态（先分清，否则需求会打架）

| | A 托管算力（现状） | B BYOC 引导（L1） | C BYOC 托管（L2） |
|---|---|---|---|
| 谁付云厂商 | 我方 | 用户 | 用户 |
| 谁开机器 | 我方 | **用户**（我们给步骤/深链） | 我方（云 OpenAPI） |
| 用户操作步数 | 0 | 3~5 步（选型→开机→粘命令→等就绪） | 1 步（授权一次） |
| 自动关机 | 不适用（我们的池） | 只能**提醒**，不能代关 | **能**（StopInstance） |
| 自动扩缩 | 能 | 不能（用户自己开） | 能（RunInstances） |
| 覆盖平台 | — | 剩余无实例 API 的平台 | **AutoDL（已验证 Pro API）/阿里云/腾讯云/火山** |
| 凭证风险 | 无 | **低**（只给一次性 join token） | **高**（要云账号授权，必须子账号+STS） |
| 支持成本 | 低 | 中（环境千差万别） | 中高（权限/配额/网络策略） |
| 适合谁 | 个人、试水用户 | 工作室、自带卡团队 | 有云账号的企业客户 |

**建议路线**：L1 先上（2 周可交付，覆盖 80% 平台），L2 只对签了合同的客户做（阿里云/腾讯云二选一）。

---

## 2. 架构：新增 `fleet` 域

```
generations ──► tasks ──► h3:video 适配器 ──► h3-gateway（复用）
                                                    │  job 带 pool_id
                                                    ▼
                                          ┌──────────────────────┐
                                          │ fleet（新域）         │
                                          │ 账号/池/节点/预算/账单 │
                                          └───┬──────────┬───────┘
                                   L1 引导 │          │ L2 OpenAPI
                                          ▼          ▼
                                    用户控制台     阿里云/腾讯云
                                          │          │
                                          └──► node agent（自注册）──► OSS staging
```

**为什么单独一个域而不是塞进 `provider-management`**：供应商是「外部 API + Key」，机队是「可创建/销毁的计算资源 + 计费」，生命周期完全不同；混在一张表里会把 `model_routes` 的路由语义污染（D4 路由快照是给"换供应商"用的，不是给"换机器"用的）。按 `system-design §2` 的依赖规则：`fleet` 可依赖 `tasks`/`models`，被 `generations` 依赖，**不得**直接写 `tasks` 表。

### 2.1 数据模型（4 张表，最小集）

```sql
gpu_accounts    -- 用户绑定的云账号
  id, owner_user_id, space_id?, provider(aliyun|tencent|volc|manual),
  auth_mode(join_token|ram_role), role_arn?, external_id?,
  credential_ciphertext?, credential_version, region, status,
  consent_version, created_at, revoked_at
  -- manual 模式不存任何云凭证，只存 pool 归属

gpu_pools       -- 逻辑池（一个用户/团队一个池）
  id, owner_user_id, space_id, name, provider, allowed_regions[],
  instance_spec jsonb, min_nodes, max_nodes, auto_stop_idle_min,
  budget_daily_cents, budget_month_cents, state, created_at

gpu_nodes       -- 实例
  id, pool_id, provider, provider_instance_id, gpu_type, vram_gb,
  state(pending|booting|ready|busy|draining|stopped|destroyed|error),
  hourly_price_cents, started_at, stopped_at, last_heartbeat,
  agent_version, model_commit, variants_loaded[], note

gpu_jobs        -- job↔node 账
  id, task_id, node_id, pool_id, queued_at, started_at, finished_at,
  gpu_seconds, cost_cents, status, fail_code
```

`gpu_accounts.credential_*` 只有 L2 且有 `ram_role` 时才非空；L1 的 `manual` 模式**永远不存云凭证**——这是把「凭证风险」从产品里彻底摘掉的关键设计。

### 2.2 Provisioner 抽象（两种实现，一套接口）

```ts
export interface CloudProvisioner {
  provider: "autodl" | "aliyun" | "tencent" | "volc" | "manual";
  capabilities: {
    create: boolean; start: boolean; stop: boolean; destroy: boolean;
    describe: boolean; price: boolean; spot: boolean;
  };
  /** 托管模式：创建/开机并返回句柄；manual 直接抛 Unsupported */
  create(spec: InstanceSpec): Promise<InstanceRef>;
  start(ref: InstanceRef, startCommand: string): Promise<void>; // 必须支持"开机即执行引导命令"
  stop(ref: InstanceRef): Promise<void>;
  destroy(ref: InstanceRef): Promise<void>;
  /** 两种模式都要：生成节点自注册命令（start_command 或用户粘贴） */
  bootstrapCommand(poolId: string, joinToken: string): string;
  /** 实际计费（托管模式用 describe 拉，manual 只能估算） */
  price(ref: InstanceRef): Promise<Money>;
}
```

`start(ref, startCommand)` 这个方法是整套「随用随开」的关键：AutoDL `power_on` 与 ECS `RunInstances` 都支持开机后执行一段命令，把 `join.sh` 塞进去，节点起来就自动注册，不需要用户再点一次。

---

## 3. L1 引导模式（先做这个）

### 3.1 用户旅程（5 步，目标 < 6 分钟）

1. 「我的算力」→ 选平台 + 机型（页面直接给当日价格区间与"够不够跑 768p"的判断）。
2. 点「去开机器」→ 深链到该平台控制台，附截图指引（选**按量计费**、选**我们的公共镜像**或系统镜像 + 磁盘 ≥200GB）。
3. 开机后复制一行命令：

```bash
curl -fsSL https://api.example.com/agent/join.sh | bash -s -- \
  --token eyJ... --pool 123 --gateway https://h3-gw.example.com
```

4. 节点自检 → 拉权重（67GB，见 §9.3）→ warmup → 页面上出现「已就绪 1 节点 · 4090 24G · 预计 17min/条」。
5. 点「开始出片」→ 任务进入该池的队列；结束页给「记得关机」+ 一键复制关机链接。

### 3.2 join token 设计

- 一次性、TTL 30 分钟、绑定 `pool_id` + `agent_version` 白名单；
- 服务端验证：token 未用过 + 池存在 + 池未冻结；用后立即失效；
- 节点注册后换发**长期节点证书**（24h 轮换），token 不再可用；
- 泄露影响面：最多让攻击者把自己的机器注册进你的池，不能读别人的 job（§5.3）。

### 3.3 关于「浏览器插件代操作」

原先以为只能靠 RPA，现已核实 **AutoDL 有容器实例 Pro API**（create / power_on / power_off / release / snapshot / 保存镜像），所以**不需要**碰 RPA。仍明确不做插件代操作：平台 ToS 风险 + 页面一改就废 + 凭据要经过插件。没有 API 的平台就老老实实走「粘一行命令」，不为 2 步操作背这个包袱。

---

## 4. L2 托管模式（只对签约客户）

### 4.1 授权方式（**绝对不要长期 AK**）

```
用户在自己云上建 RAM 子账号/角色 → 只授 4 个动作：
  ecs:RunInstances / StopInstance / DescribeInstances / DescribePrice
  资源范围限定：指定 VPC/交换机/安全组/镜像/实例规格族
→ 给我方一个 RoleArn + ExternalId（不是 AccessKey）
→ 我方 STS AssumeRole 换 1 小时临时凭证，用完即弃，不落库
```

落库的只有 `role_arn` / `external_id` / `region` / `consent_version`；`external_id` 由我们生成、用户填进信任策略，防止混淆代理。

### 4.2 生命周期（这就是「随用随开随关」）

```
idle_stopped ──job 到达──► provisioning ──► booting ──► loading(权重+warmup) ──► ready
                              ▲                                                 │
                              │                                                 ▼
                          stopping ◄── draining ◄── idle 超时/批次结束 ◄────── busy
                              │
                              ▼
                         idle_stopped（保留实例与数据盘；只有"销毁"才删盘）
```

| 阶段 | 动作 | 典型耗时 | 用户看到 |
|---|---|---|---|
| provisioning | `create` 或 `power_on` + `start_command` | 30~90s | 「正在启动算力…」 |
| booting | 容器/VM 起来，agent 连网关 | 20~40s | 「节点已上线」 |
| loading | 权重从**本地数据盘**加载（不是重新下载）+ warmup | 2~4min | 「模型加载中 3/4」 |
| ready | 接 lease | — | 「开始出片」 |
| busy | 执行 job | 3~17min | 进度条 |
| draining | 拒绝新 lease，跑完当前 | 0~17min | — |
| stopping | `power_off` | 10~30s | 「已关机」 |

**关键前提**：权重必须落在**保留的数据盘/网盘**上（AutoDL 关机不删数据盘），否则每次开机都要重下 67GB（网络盘 5~12min），「随用随开」立刻变成「随用随等」。

### 4.4 AutoDL 实现细节（已核对官方 Pro API 文档）

| 我们的动作 | AutoDL 接口 | 备注 |
|---|---|---|
| 创建 | `POST /api/v1/dev/instance/pro/create` | `req_gpu_amount 1~4`（**最大 4 卡**）、`gpu_spec_uuid`（`h800`/`v-48g`/`pro6000-p`/`5090-p`/`4090D`/`v-32g-p`）、`image_uuid`、`expand_system_disk_by_gb 0~500`、`start_command` |
| 开机 | `/power_on` `{payload:"gpu", start_command}` | **只支持有卡开机**；`start_command` 就是我们注 `join.sh` 的位置 |
| 关机 | `/power_off` | 关机不释放，数据盘保留 |
| 释放 | `/release` | **必须先关机**，否则可能失败 → 状态机里 stopping 之后才 destroy |
| 状态 | `/status`、`/snapshot` | snapshot 返回 `payg_price`/`origin_pay_price`（分），直接拿来做实时成本 |
| 镜像 | `/image/save`、`/image/private/list` | 私有镜像**账号级**，不能跨用户共享（见下方摩擦点） |

**三个必须提前处理的摩擦点**：

1. **私有镜像不跨账号**：每个用户第一次都要构建一次环境（装 torch/CUDA/SGLang + 拉权重 + `save_image`），首次 20~40 分钟。对策：提供一键 `build.sh` + 进度页，并把这一步算进「首次使用引导」，不隐藏。
2. **不能无卡开机**：`payload` 只支持 `gpu`，意味着"先把环境装好再开机跑"不行，构建镜像期间也在计费（¥2~3/h × 半小时 ≈ ¥1）。要在预检里明示。
3. **实例规格最大 4 卡**：想组 4×H800 要选 `h800` ×4，价格高；4090-48G（`v-48g`）单卡 48G 反而是 H3 的性价比甜点（DiT 34GB 能放下，少 offload）。

**计费与关机**：按量计费在 `power_off` 后停止收 GPU 费，但**数据盘/网盘继续计费**（67GB~498GB 常驻是一笔固定支出）。这条要写进「我的算力」页面，否则用户会以为关机=零成本。

#### 4.4.1 实测校准（2026-11-05，真机跑通）

用真实账号跑完「create → start_command → 关机 → save_image → 用私有镜像再 create → release」，6 处与文档假设不符，代码已按实测修正：

| # | 实测结果 | 影响 / 已修正 |
|---|---|---|
| M1 | `snapshot.payg_price` 单位是**厘**（0.001 元）：4090D 返回 1980 / 1880 ↔ 官网 ¥1.98 / ¥1.88 | `priceCentsFromLi()` 除以 10，否则账单放大 10 倍 |
| M2 | 状态名是 `running` / `shutting_down` / `shutdown`，不是文档示例的 `stopped` | `mapInstanceStatus()` 显式映射；未知值 → `unknown`，绝不当 running |
| M3 | `start_command` 在 **create 与 power_on 都执行**（文件均落盘） | 「开机即自注册」成立，join 脚本就挂这里 |
| M4 | `save_image` **必须先关机**，否则 `InternalError: 保存实例镜像前，请确保实例是关机状态`；差量镜像 44MB、20s 内 finished，`image_uuid` 可立即用于 create | 构建向导顺序固定：装环境 → 关机 → save_image → 记录 uuid |
| M5 | `expand_system_disk_by_gb=0` → **总盘仅 30G**；H3 单变体权重 ≈67GB | 默认扩容改 100G（总 130G），否则装不下 |
| M6 | 下载实测 **10.3MB/s**（HF 镜像 155MB/15s；阿里云 5.2MB/s）→ 67GB ≈ **108 分钟** | **不能开机时下权重**：烤进私有镜像或用保留数据盘 |

**镜像策略（2026-11-05 定）**：v1 直接用 AutoDL **社区/应用广场的 H3 镜像**——用户自己开机器、粘 join 命令，零构建；v2 再自建私有镜像。三条平台约束决定了边界：

1. **不支持导入自定义镜像**：本地构建好传不上去，只能在 AutoDL 实例上构建后 `save_image`；
2. **镜像只含系统盘**：67GB 权重放数据盘（关机不删），不进镜像；
3. **共享是逐用户 ID**，不是公开上架；公开可见走应用广场审核。
   因此**镜像只装环境，node agent 由开机 join 脚本注入**——发布出去不泄逻辑，agent 升级也不用重建镜像。

**应用实例 API（2026-11-05 实测，决定性地改变架构）**：AutoDL 另有一套**应用实例 API**，主机是 `www.autodl.art`、前缀 `/api/v1/adl_dev/dev`，**用同一个开发者 Token**：

```
POST /api/v1/adl_dev/dev/instance/pro/create
{ application_uuid, application_version:"latest", gpu_spec_uuid, req_gpu_amount, expand_system_disk_by_gb, start_command }
→ pro-xxxx    （实测 v-48g ¥2.88/h，snapshot 返回 cg_application_info / SSH / 6006 域名）
```

配套 `snapshot / status / list / power_on / power_off / release` 同前缀。这意味着：

1. **用户零点击**：绑一次 Token，后端直接按 `application_uuid` 开应用实例，不需要人肉点应用广场；
2. **不用自建镜像**：应用自带环境，权重由应用镜像内的**公共模型软链接**提供（`/.autodl/...` 只在应用实例内挂载，普通实例没有该目录——已实测）；
3. **不用企业认证**：应用实例 API 走个人开发者 Token 即可（弹性部署 API 仍要企业认证）。

**社区镜像首选（2026-11-05 调研）**：AutoDL 应用广场的 `MiniMax-H3-ComfyUI-SM89-SM120`（[仓库](https://github.com/zw2029181901/autodl-minimax-h3-comfyui)，manifest 记录 ComfyUI 0.31.1 / PyTorch 2.10+cu130 / SageAttention 2.2.0）。关键点：**权重走 AutoDL 公共模型挂载**，镜像本身不含 67GB 权重 → 开机 30~60s、无需扩系统盘；4090D 已验证 1056×608 / 124 帧 / 16 步通过，峰值显存 21.9GB。它的存在把"首次 2 小时构建"从 v1 路径里彻底去掉了。

**产品口径修正**：首次「构建环境」不是 20~40 分钟，而是 **约 1.5~2 小时**（主要耗在拉 67GB 权重）。向导文案与 `compute.buildTitle` 已同步为"约 1~2 小时"。

**其他实测**：主机内存 503G（24G 卡 offload 够用）、本地盘写 177MB/s、基础镜像 `torch 2.0.0+cu118`（H3 需 2.x+cu12，必须重建）。

### 4.3 必须做的「烧钱闸」

用户的钱比我们的钱更难花——出一次「忘关机烧了 800 块」的客诉，这个功能就死了。

| 闸 | 默认 | 行为 |
|---|---|---|
| 单任务预算 | ¥5 | 预估超限直接拒绝，提示降档 |
| 单日预算 | ¥50 | 触达停发新任务 + 通知 |
| 月度预算 | ¥500 | 触达冻结池（可手动解冻） |
| 空闲关机 | 15min | L2 自动 Stop；L1 只推送提醒（短信/邮件/站内） |
| 僵尸检测 | 30min 无 job | 提醒 + 建议销毁 |
| 开卡预检 | 每次 | 显示「预计开机 3~5min + 冷启动 2min + 出片 X 条 ≈ ¥Y」 |

---

## 5. 调度：从「一个池」变成「联邦池」

### 5.1 池维度

`h3-gateway` 的调度器加 `pool_id` 约束：job 只能落在**同一个 pool** 的节点上。池之间不共享、不借用（B4 决策：v1 不做算力共享）。

### 5.2 池内算法

沿用 self-hosted §5：变体/显存分档/优先级/30s 打包窗口。差别只在「池容量可能为 0」：

```
pool 无 ready 节点
  → 若是 L2：自动 create（受预算闸约束），页面显示「正在为你开机 ~3min」
  → 若是 L1：不自动开机，返回「你的机器已关机」+ 开机指引，任务保持 queued 而非失败
  → 超过 pool.queue_timeout（默认 30min）→ 提示或按用户设置回落我方托管池/API
```

**关键**：机队模式下「机器关机」不能变成任务失败。状态机要新增 `waiting_for_capacity`，与 `vendor_timeout` 区分——这条不做，用户关一次机就会收到一堆"生成失败"。

### 5.4 触发开机的时机（决定「随用随开」到底开多频繁）

| 策略 | 何时开 | 何时关 | 单条摊冷启动 | 适用 |
|---|---|---|---|---|
| **session（默认）** | 队列中出现第 1 个 job | 队列空 + `idle_min`（默认 15~30） | ¥0.1/批次 | 绝大多数场景 |
| on_demand | 每个 job 前 | job 结束立即关 | ¥0.1/条（≈ 单条算力的 15~30%） | 极低频、对成本敏感的用户 |
| always_on | 保持 | 手动 | 0 | 白天连续出片的工作室 |
| scheduled | 每日固定时段 | 时段结束 | 0 | 已知排期（如每晚批量渲染） |

**算过账**：冷启动 ≈ 3~5 分钟，按 ¥2/h 折 ¥0.10~0.17/次。一批 20 条摊下来 ¥0.005/条（可忽略）；单条随开随关则占总成本 15~30%，**但真正的代价是首条要多等 3~5 分钟**——用户感知是"点了半天没反应"，不是"省了几毛钱"。所以默认 `session`，把 `on_demand` 留给明确选了"最省"的用户。

**状态机要点**：job 进入 `provisioning` 时就要给前端一个**可解释的等待**（「预计 4 分钟」「已开机 40%」），不要让用户看一个转圈。

### 5.3 隔离

节点证书绑定 `pool_id`，网关只发本池 job；节点侧无法枚举/拉取他人任务。素材通过 presigned GET（15min）下发，节点不持有桶权限。

---

## 6. 数据流与地域

```
用户素材（我方 OSS） --presigned GET--> 用户节点
用户节点 --presigned PUT--> 我方 OSS staging/ --同区 copy+打标--> 正式桶
```

- 结果**必须回传我方桶**，否则素材库/成片交付/审核链路全断；跨云流量费进预检报价（用户承担，需明示）。
- 节点地域 **v1 只允许中国大陆**：境外节点等于用户素材出境（PIPL），且 H3 许可证排除 EU/英/韩/美。注册时校验 region，不在白名单直接拒绝。
- 节点侧不落 prompt 全文（同 self-hosted §12）；日志只留 hash + 长度。

---

## 7. 合规

| 项 | 处理 |
|---|---|
| 云账号授权 | 独立授权书（版本化 `consent_version`）、随时可撤销、操作审计（谁/何时/用哪个角色开了什么机器） |
| 内容审核 | 本地推理不过审 → 出口必须补：文本审核 + 抽帧审核，或明确「BYOC 档仅草稿、不交付成片」 |
| AI 标识 | 沿用现有 worker 打标硬门（`ai_label_failed` 不结算），节点不参与 |
| 许可证署名 | 商用 UI 显著标注 "MiniMax H3"（self-hosted §1.3），BYOC 档同样适用 |
| 数据出境 | v1 禁止境外节点；后续要做需先过出境评估 |

---

## 8. 商业模型（这次真的要改）

| | 托管档（A） | BYOC 档（B/C） |
|---|---|---|
| 算力成本 | 我方 COGS | 用户直付云厂商 |
| 我方收入 | 积分（含算力加价） | 平台费（编排/流水线/素材/审核） |
| 积分单价 | 现状 | **建议 1/3**，且 quote 里明确「不含算力」 |
| 毛利 | 自建 70~90%，API 档为负 | 近似软件毛利（80%+），但 ARPU 低 |
| 风险 | 空转、抢占、运维 | 支持成本、烧钱客诉、凭证安全 |

`model_prices` 需要加一维 `compute_source ∈ {hosted, byoc}`（或新表 `byoc_prices`），否则同一个模型两个价会撞 `uq_model_prices`。`quote` 返回要能拆分「平台积分」与「算力预估（用户自付）」，前端两个数字分开显示——这也是差异化卖点：**用户第一次能看清一条片子到底花了多少算力钱**（§9.5 的账单报告）。

---

## 9. 支持成本与失败面（最容易被低估）

### 9.1 Top 失败清单

| 现象 | 原因 | 对策 |
|---|---|---|
| join 脚本跑不通 | 无外网/DNS/证书 | doctor 先测 `curl gateway/healthz` |
| 拉权重卡住 | 67GB 走共享带宽（3~10Gbps 但被限速） | 分片 + 断点续传 + 就近 OSS/加速域名，显示进度与预计时间 |
| OOM | 24G 卡没配 64GB 内存 | 预检读 `/proc/meminfo`，不达标直接拒 |
| 磁盘满 | 只给了 50GB 系统盘 | 预检要求 ≥200GB，不足提示扩盘 |
| 驱动/CUDA 不匹配 | 平台镜像版本旧 | 白名单镜像 + 启动时校验 `nvidia-smi`/`torch.cuda` |
| 平台禁止自定义镜像 | 部分平台限制 | L1 支持「系统镜像 + 脚本装环境」兜底路径 |
| 节点注册后秒掉线 | 平台限制长连接/自动休眠 | 心跳 + 自动重连 + 明确"该平台不适合常驻"提示 |

### 9.2 `doctor` 自检（必须做）

一条命令输出结构化 JSON（GPU 型号/显存/驱动/CUDA/内存/磁盘/带宽/到网关 RTT/到 OSS RTT），失败项给可执行的修复建议。支持成本能不能压住，80% 靠这个。

### 9.3 权重分发

67GB（单变体 int8）不能每次从零拉。方案：区域 OSS + 分片（1GB/chunk）+ 断点续传 + sha256 校验；同平台多节点可走内网/共享盘（如果平台支持）。

### 9.4 白名单机型（v1）

只支持 3~5 个机型（如 AutoDL 4090/5090、共绩 A100 80G），其余"尽力支持但不承诺"。这是控制支持成本的唯一办法。

### 9.5 账单报告（差异化）

出片结束给一份：卡时 × 单价 + 冷启动 + 重跑 + 流量 = 本次实际花费；月度汇总对比"如果走 API 要花多少"。用户自己算不清这个，这是 BYOC 档最值得卖的东西。

---

## 10. 分阶段

| 阶段 | 周期 | 交付 | DoD |
|---|---|---|---|
| P0 | 2~3 周 | **AutoDL 托管最小闭环**：绑 Token → create（固定镜像 uuid）→ `power_on` 带 `start_command` 注册 → 出片 → `power_off`；加预算三闸与关机提醒 | 用户绑 Token 一次后，提交任务能自动开机出片并自动关机；全程无需再进控制台 |
| P1 | 4 周 | 池化调度 + `waiting_for_capacity`/`provisioning` 状态 + 账单报告 + 一键 `build.sh` + `save_image` 首次环境构建 | 关机不再产生"失败"；单池 4 节点稳定；首次构建可自助完成 |
| P2 | 6 周+ | 阿里云/腾讯云（RAM 子账号 + STS + 竞价）+ 无 API 平台的 L1 引导 | 无人值守跑 72h 不烧超预算 |
| 不做 | — | 跨用户算力共享/交易、境外节点、本地 2K、RPA 代操作 | — |

> 顺序调整（相对 v0.1）：既然 AutoDL 有 API，**P0 直接做托管模式**，比"粘一行命令"更贴近用户要的「随用随开」；L1 引导降级为 P2 的补充覆盖（服务无 API 的平台）。

---

## 11. 与现有系统的接入点

| 位置 | 改动 |
|---|---|
| `docs/02-architecture/system-design.md §2` | 新增 `fleet` 域与依赖规则（依赖 tasks/models；禁写 tasks 表） |
| `docs/02-architecture/database.md` | 4 张新表（§2.1）+ `model_prices.compute_source` 维度 |
| `packages/model-adapters` | **不改**：`h3:video` 仍指向我方网关，pool 在网关内部 |
| `apps/api` | 新模块 `fleet`（账号/池/节点/预算/账单）；`generations.quote` 支持 `compute_source` |
| `apps/worker` | 不改（仍走 `gen.poll` 队列化，见 ADR-015） |
| 前端 | 新页「我的算力」：绑定、开机向导、节点状态、预算、账单 |
| `06-security-compliance/security.md` | 新增「云账号授权」威胁（混淆代理、凭证泄露、越权开卡） |

---

## 附录 A：「组卡」到底能组成什么（别被销售话术带跑）

| 组合 | 实测/官方 | 结论 |
|---|---|---|
| 单 4090 24G | 5s/1344×768/50 步 = 1008.6s | 能跑，草稿档；日产能 ~43 条/卡 |
| 单 4090 + Spectrum | 285.3s（3.53×） | 草稿档可用 |
| 2×5090（TP2） | 559.7s | 官方"最快 32GB 工作点"，但仍慢 |
| 4×H100（TP2+Ulysses2） | 13.25s | 唯一"接近实时"的组合，需整机 NVLink |
| 8×PCIe（无 NVLink） | all-to-all 占 54% GPU 时间，约 3.7× | **不要把散卡拼成 8 卡**，钱花了拿不到线性 |

**给用户的建议文案**：想快 → 租整机 4×H100（贵，按条摊下来 ¥0.18）；想省 → 单卡 4090 + 8 步蒸馏（慢，¥0.10/条）。**中间档（2 卡、4 卡 PCIe）性价比最差**，不要推荐。

## 附录 B：待确认

- [x] AutoDL 实例管理 API 已核实（Pro API：create/power_on/power_off/release/snapshot/image/save）
- [ ] 共绩 / 优云 / 恒源云 / 天工云（如确有）是否有实例管理 API，逐个取证
- [ ] AutoDL `power_on` 的 `start_command` 执行时限与失败行为（超时是否影响开机）
- [ ] AutoDL 私有镜像能否跨账号共享（决定首次构建能否由我们代做）
- [ ] 各平台的自动关机策略与"停机是否仍计费"
- [ ] 各平台是否允许自定义镜像 / 社区镜像 / cloud-init
- [ ] 用户侧「开机 → 就绪」的真实耗时分布（决定等待文案与超时值）
- [ ] 阿里云/腾讯云 RAM 子账号最小权限策略模板（要能直接贴给用户）
- [ ] BYOC 档的积分定价（需与托管档做价格锚定测试）