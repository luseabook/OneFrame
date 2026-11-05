# 架构决策记录（ADR）

> v1.1 · 2026-10-24 · 状态值：Proposed / Accepted / Superseded。只增不改；推翻旧决策新增条目并在此标记。
> v1.1 变更：修正 ADR-003/004 引用（mode/scene 与 F 编号）；补 ADR-007（手机号 HMAC+AES-GCM 双列）、ADR-008（refresh 仅 HttpOnly Cookie）

---

## ADR-001 全栈 TypeScript（Nuxt3 + NestJS）

- **状态**：Accepted 2026-10-24
- **背景**：团队规模 1~2 人；前端确定 Vue 系（竞品同构且其模式已验证〔RM-证据：前端技术栈章节〕）；后端需在 NestJS(TS) 与 Go 之间选择。
- **决策**：前后端同用 TypeScript，共享 `packages/shared`（DTO/枚举/信封类型）。
- **理由**：单人/小团队下单语言最大化产出；DTO 前后端零漂移（契约改一处全链路类型报错）；招聘池充足。
- **代价**：极端轮询 QPS 下性能弱于 Go；缓解：轮询接口走 Redis 缓存，必要时该路由单独优化。
- **备选**：Go+Kratos（性能优、双语言维护成本高）；Supabase/BaaS（任务编排/队列能力不足）。

## ADR-002 模块化单体，不微服务起步

- **状态**：Accepted 2026-10-24
- **背景**：竞品按 df/ai/film/wf/agent/cam/crc/op 拆了约 9 个服务〔RM-证据：路由前缀〕，但那是规模期产物。
- **决策**：单 NestJS 应用内按 system-design §2 模块边界组织；模块间仅 service 接口调用，禁跨模块查表；队列/缓存/DB 独立部署。
- **理由**：MVP 期部署/调试/事务（任务+扣费同事务）成本最低；边界纪律保证 DAU 50k 前可平滑拆分。
- **退出条件**：某模块需独立伸缩（预期首个是 worker 侧 generations）。

## ADR-003 生成收敛为单端点 + mode 枚举

- **状态**：Accepted 2026-10-24
- **背景**：竞品 700+ 端点中生成类仅 8 个且差异全在参数〔RM-证据：CLI model 目录 endpoint 字段 + 12.9 节〕；其每新增模型/模式基本不动路由。
- **决策**：`POST /v1/generations`（mode + model + input + options）单端点；mode 枚举见 api-spec §5，且区分 mode 与两个 scene 键（`script_to_scene_refer`/`storyboard_reference_video`；`studio_asset_image` 是 image 的 mode），参数校验以模型目录为准。
- **理由**：幂等/风控/计费/审计只做一处；新增供应商只改注册表与适配器。
- **代价**：参数校验依赖模型目录元数据（models.modes），目录错误会导致校验漏洞 → 用契约测试锁定目录 schema。

## ADR-004 积分两阶段扣费（冻结-结算）

- **状态**：Accepted 2026-10-24
- **背景**：生成是异步长任务，供应商真实计费在完成时才确定（部分按时长/分辨率）；竞品有 strike/discount/credit_original 等结算字段〔RM-证据：point-calculate 响应〕。
- **决策**：提交时按 quote 冻结（balance-frozen>=cost 校验），成功按实际结算（多冻退还），失败/取消/审核拒全额解冻；`credit_flows` 全程留痕。
- **理由**：防超支（并发提交不穿透余额）；对用户公平（失败不扣费）；对账清晰。
- **代价**：账户表需 frozen 字段+行锁；文案需教育用户"冻结中"概念（PRD F6 积分；F5 是资产库，原引用笔误）。

## ADR-005 结果资产自持（转存私有 OSS）

- **状态**：Accepted 2026-10-24
- **背景**：供应商结果 URL 短时效（通常 24h）；竞品全部转存自有桶 `alisz-reelmate-storage` 并用预签名下发〔RM-证据：file-sign-url 响应〕。
- **决策**：Worker 成功后必转存自有 OSS 私有桶，下载/预览一律预签名；转存失败降级直引供应商 URL（24h）并告警。
- **理由**：链接长效可控、带宽/成本自主、离供应商化解耦、合规留档（AI 内容标识在转存后处理阶段由 worker ffmpeg 合成，见 system-design §3.2 / WBS 1'.8）。

## ADR-006 认证用自有 JWT（access 2h + refresh 14d），MVP 不接 OAuth

- **状态**：Accepted 2026-10-24
- **背景**：竞品走万兴统一账号 OAuth（accounts.wondershare.cn）+33min 短效 token 静默 renew〔RM-证据：/renew 响应〕——因为它有集团账号体系；我们没有。
- **决策**：手机验证码登录自有 JWT；access 2h + refresh 14d（refresh 单设备轮换）；微信扫码 Phase 2 再接（微信开放平台需企业主体）。
- **理由**：MVP 主体审核快（短信签名只需企业/个体资质）；无第三方依赖。
- **修正记录**：若最终选择出海首发，改为 Email+OTP 或 Google 登录（届时 Superseded 本条）。

## ADR-007 手机号双列：HMAC 等值查询 + AES-GCM 密文展示

- **状态**：Accepted 2026-10-24
- **背景**：手机号是登录唯一标识，需要等值查询与唯一约束（`UNIQUE(provider, phone_hash)`），同时合规要求不可明文落库；单列 AES-GCM 因随机 IV 无法等值查询（启动前审查 P0-02 曾判定鉴权不可实现）。
- **决策**：`identities` 同时存 `phone_hash = HMAC-SHA256(phone, PEPPER)`（等值/唯一）与 `phone_cipher = AES-GCM(phone)`（展示/发码解密）；两者由同一 service 写入，禁止业务侧直连。
- **理由**：等值查询走确定性 HMAC（列唯一索引可用），密文只用于解密展示；PEPPER 与 KMS 密钥分离，泄库不等于可枚举。
- **代价**：双写一致性由单一 service 保证；换 PEPPER 需全表重算（版本字段/停机窗口预案见 deployment §5）。

## ADR-008 refresh token 仅 HttpOnly Cookie + 单设备轮换

- **状态**：Accepted 2026-10-24
- **背景**：access token 短效（2h），refresh 14 天；若 refresh 放 localStorage 会被 XSS 窃取。
- **决策**：refresh_token 只经 `Set-Cookie: HttpOnly; Secure; SameSite=Strict; Path=/v1/auth` 下发，响应体不返回；每次 refresh 轮换旧 token 并失效（重放检测→全家下线）；access 只存内存。
- **理由**：XSS 拿不到 refresh；SameSite=Strict + 自定义头 `X-Requested-With` 双保险防 CSRF。
- **代价**：移动端/跨域场景需同站部署或 BFF；登出需 Redis 黑名单 access。

---

## ADR-009 四域按"资源所有权"划分，不按参照产品的微服务前缀照搬

- **状态**：Accepted 2026-10-26（F1）
- **背景**：全站 1:1 复刻（D-2026-10-26-01）引入 `canvas`/`agent`/`cam`/`film` 四域。参照产品用 `/df/*`(466 端点)、`/cam/*`、`/film/*`、`/agent/*` 做**服务前缀**（微服务拆分），我方是模块化单体（ADR-002）。
- **决策**：**保留域名划分**（与资源所有权/权限边界一致），但**不拆服务**——四域是单一 NestJS 应用内的 4 个 module。同时把参照的 `df` 域拆为我方 `script`(既有) + `canvas`(新) + `novel_market`(F3)，因为三者权限模型与生命周期完全不同。
- **理由**：域边界对齐参照便于 1:1 覆盖核对（本次核心诉求）；不拆服务保留 ADR-002 的运维简单性。
- **代价**：单体内 module 边界靠约定与 code review 维持；若未来真拆，`canvas`/`film` 因共享 `tasks` 会成为拆分难点。

## ADR-010 团队不另建表：`spaces(type=2)` 是团队唯一载体

- **状态**：Accepted 2026-10-26（F1）
- **背景**：既有 `spaces.type`(1个人/2团队) + `space_members`(role/credits_quota) 已是团队雏形但 MVP 只落 owner 一行；参照产品是独立 `cam/team/*` 体系 + `role_code:master`/`role_level:1`。
- **决策**：**扩展 `spaces`/`space_members`，不新建 `teams` 表**。RE 的 `team_id` 映射为 `space_id`，`wsid` 映射为 `user_id`。`cam` 只是"团队的一组端点"，数据仍落 spaces 体系。
- **理由**：一旦 `teams` 与 `spaces` 并存，所有 `space_id` 隔离的既有逻辑（112 端点绝大多数）都要双写判断，成本远大于收益。
- **代价**：`space_members` 列会变多（10 列）；`role`(1/2/3) 与 `role_code`(11 级) 双轨并存，靠回填 UPDATE 与"之后只改 role_code"维持一致。

## ADR-011 积分只有一本账：团队积分池 = space 级 `credit_accounts`，禁止双账本

- **状态**：Accepted 2026-10-26（F1）
- **背景**：参照产品有 `points-allocation`/`points-recovery`/`points-flow` 与 `team_credit_total`，看似"团队另有账本"。
- **决策**：**团队积分池就是该 team-space 的 `credit_accounts(space_id)`**。分配=团队 space → 成员 space，写成对流水 `team_allocate_out`/`team_allocate_in`；回收=反向 `team_recover_out`/`team_recover_in`。团队总额不是一个字段，就是该 space 的 `balance`。
- **补充（B 草案发现）**：`credit_flows` 必须同时加 4 列 `ref_space_id`/`ref_user_id`/`op_user_id`/`group_id`，否则 `points-flow` 的 8 个筛选参数无处可查。
- **理由**：保持 `balance == Σdelta` 且 `frozen == Σ frozen_delta` 双不变式；任何双账都会破坏它且无法对账闭环。
- **代价**：分配/回收必须成对写入（单边会让 Σ 漂移），需事务 + 单测强制；`credits_quota` 被"激活"为未回收分配额上限，但**不是余额**，不参与不变式。

## ADR-012 SSE 是"新增通道"，轮询永远是降级基线

- **状态**：Accepted 2026-10-26（F1）
- **背景**：现有产品全靠 5s 批量轮询 + ETag；参照产品有 `agent/task/stream`、`canvas/:id/chat/sessions/:sid/stream`、`agent/home/resource/sse`。
- **决策**：SSE 作为**独立只读通道**新增，**不替代**轮询；断线/不支持时回落 5s 轮询，语义等价。SSE 只推状态变更与结果指针，**不推二进制、不做计费动作**；鉴权用短时效 stream-token（`POST /stream-tokens`，≤60s 一次性）。
- **理由**：客户端/代理对 SSE 支持不一致（参照自己也保留轮询）；WBS P2.4 要求"双通道可切换"。
- **代价**：`agent_events` 必须落库（否则 `?last_stream_id=` 续传无法实现），增加写放大与保留期清理成本（建议 7 天）；两套通道需保证语义等价，测试成本翻倍。

## ADR-013 能力与交互以参照站已取证的行为为准（"竞品怎么做我们就怎么做"）

- **状态**：Accepted 2026-10-26（Owner 指令，作为项目标准执行）
- **背景**：F1 四域复刻过程中反复出现同一类分歧——我方觉得"更合理"的设计 vs 参照站实际行为。
  例如：表格导入为什么必须两步、拆分资产为什么要带 `active_tab`、批量下载为什么要一张"下载单"。
  这些设计单独看都显得绕，但它们是**用户已经在用的产品**的真实行为；按我方偏好重设计，
  等于把一个已验证的交互换成未验证的，而且覆盖核对会失去一一对应关系。
- **决策**（四条，按优先级）：
  1. **已取证即照做**：端点语义、交互步数、参数含义一律以参照站已取证的行为为准，
     不因为"我们可以更简洁"而合并或简化（裁决 D1 的"模板三族不合并"就是同一原则的体现）。
  2. **未取证不臆造**：只有端点名、没有响应体/交互证据的，登记进待取证清单（`api-spec §14.8`），
     最多留"入口 + 说明"，**不实现替代方案**，也不做假数据。
  3. **对齐的是行为，不是字段名**：协议仍自研（ADR-009 不变）——不照抄其前端状态快照字段、
     内部头（`X-Prod-Id`/`X-Module-Action`）与供应商私有语义；保留我方 `Bearer` + `{code,msg,data}`。
  4. **偏离必须留痕**：与本标准不一致的实现，必须在 `api-spec` 对应小节写"偏离说明"并给理由；
     只允许两类偏离：(a) 与既有 ADR/不变式冲突（如"一次性 stream-token"会与 ADR-012 的
     "可重连、可降级"冲突，故改为短 TTL 可复用）；(b) 取证不到且照做会有安全或正确性风险。
- **理由**：
  - 本项目的核心目标是"全站 1:1 复刻"，覆盖核对靠**端点/交互逐条对上**；自创设计会让核对退化成人工映射表，而映射表一定会腐坏。
  - 参照站的这些"绕"设计背后通常是真实约束（多 Sheet 自动选错、资产分 tab、链接过期仍需重取），只是没写在他们文档里。
- **代价**：
  - 需要更多取证工作（登录态抓包、bundle 逆向），且有时要接受"看着别扭"的设计；
  - 取证不到的功能会**长期挂着不实现**（如 `pinned-timelines`），这是有意的：留空比造假可用。
- **执行要求**：
  - 每个新端点/新交互在 PR 描述里写一句"参照证据"（文件:行 或 抓包 transaction）；
  - 没有证据的，写"待取证 + 为何不阻塞"；
  - 评审时把"这是我的偏好"当作需要证据的信号。

---

## ADR-014 视频模型自建推理用「网关 + 节点代理」两层，GPU 侧不承载业务逻辑

- **状态**：Proposed 2026-11-04（待 Owner 决策，详见 [self-hosted-video-inference.md](self-hosted-video-inference.md) §0 D1~D5）
- **背景**：计划租 GPU（天工云/同类）自建部署 MiniMax H3 开源权重以替代按秒计费的 API。三个硬约束：① H3 三模块中只有 `H3-Base` 开源（768p + 立体声），`Context-IR` 与 `Regenerate-2K` 为 API-only → **本地拿不到 2K**；② 许可证适用地域**排除 EU/英国/韩国/美国**（需单独申请），年营收 >2000 万美元须书面授权，商用须在 UI 显著标注 "MiniMax H3"，且**禁止用其输出改进其它 AI 模型**；③ GPU 池是固定容量、可被抢占、冷启动 1.8~2.7 分钟的自有资源，与"弹性供应商"语义不同。
- **决策**：
  1. 自建走**两层**：无状态 `h3-gateway`（鉴权/准入/队列/调度/租约/成本记账/预签 OSS key）+ 有状态 **node agent**（只 pull、只出站、只写自己那一个 key）；不把调度写进 NestJS 进程。
  2. 新增 `adapter_code = h3:video`，**不复用** `http-video`（后者缺 audio/video 参考、seed/steps、variant，且 poll 语义只认 4 态）。
  3. 产品分档：**本地 768p 草稿 + API 2K 成片**；本地档不作为独立售卖的成片档。
  4. `route_snapshot` 增加 `engine` 块（model_commit/variant/quant/steps/sampler），保证可复现与画质归因。
  5. 产物由节点直传 `staging/`，worker 同 region server-side copy + 打标；**不经网关中转字节**。
- **理由**：GPU 节点是"会被回收的宠物"，网关是"无状态牲畜"；字节走直传避免 API 带宽成为瓶颈；引擎快照缺失会让"同参数不同结果"无法归因（对比 D4 的路由快照同源问题）。
- **代价**：多一个服务要部署；需新增 `gpu_usage` 成本记账与节点清单；本地档的合规审核需自建（供应商审核链路不覆盖）。

## ADR-015 自建长任务的轮询从「worker 同步循环」改为 `gen.poll` 延时队列

- **状态**：Proposed 2026-11-04（前置改造，见 self-hosted-video-inference.md §5.4）
- **背景**：现有生成流水线在 `runGenerationTask` 内同步轮询，1s 间隔、硬上限 15 分钟（system-design §3.2）。自建 GPU 池的排队等待可超 15 分钟（会被误判 `vendor_timeout` + 解冻），且单条任务占满一个 worker 槽位，迫使 worker 并发被动等于 GPU 槽位数。
- **决策**：submit 成功后投递 `gen.poll`（delay 3s），非终态按 3~5s（退避至 10s）重新入队；终态后在同一处理器里完成转存/打标/结算；看门狗超时阈值按路由分档（selfhost 45min / API 15min）。
- **理由**：`gen.poll` 本就是 `RESERVED_QUEUES` 预留名（queues.ts:19），启用它是当初留名的目的；队列化后 worker 崩溃不再触发"重新 submit"（system-design §4 已知缺陷），GPU 侧 job_id 可续接。
- **代价**：需同时补处理器与 `queue-topology.spec.ts` 守卫；轮询频率上升会放大 Redis 压力，靠退避与批量轮询控制。

---

## ADR-016 自带算力（BYOC）走「用户云账号 + 我方编排」，凭证不落库

- **状态**：Accepted 2026-11-04（P0/P1 已落地：迁移 `0058_fleet`、`fleet` 模块、`/v1/compute/*`、`/compute` 页面；详见 [autodl-integration.md](autodl-integration.md) §9）
- **背景**：希望让用户绑定自己的 GPU 云账号（天工云/同类）自行充值，我方按实际情况开卡、组池、全自动出片。已核实：**AutoDL 有容器实例 Pro API**（create / power_on / power_off / release / snapshot / save_image，`power_on` 可带开机执行命令），阿里云/腾讯云/火山有 OpenAPI + RAM 子账号；其余租卡平台待逐个取证。「散卡组多卡」在无 NVLink 的 PCIe 机器上加速比仅约 3.7×，不等于线性扩容，且 AutoDL Pro API 单实例最多 4 卡。
- **决策**：
  1. 新增 `fleet` 域（gpu_accounts / gpu_pools / gpu_nodes / gpu_jobs），与 `provider-management` 的「供应商 + Key」模型**分开**——一个是被调用的外部 API，一个是可创建/销毁的计算资源。
  2. 两种模式同一套接口：**L1 引导**（用户自己开机，粘一行 join 命令自注册；**不存任何云凭证**）与 **L2 托管**（云 RAM 子账号 + `ExternalId` + STS 临时凭证，用完即弃，只落 RoleArn）。
  3. join token 一次性、TTL 30min、绑定 pool；注册后换发 24h 轮换的节点证书；节点只能拉本池 job。
  4. 池容量为 0 时新增 `waiting_for_capacity` 状态，**不得**判 `vendor_timeout`（用户关机会变成"生成失败"）。
  5. `model_prices` 增加 `compute_source ∈ {hosted, byoc}`：BYOC 档只收平台费，算力由用户直付云厂商。
  6. 机器来源默认走 **AutoDL 应用实例 API**（`autodl.art/api/v1/adl_dev`，`application_uuid` + `latest`），因为它用同一开发者 Token、用户零点击、权重由应用内公共模型软链接提供；私有镜像（`image_source=private`）保留给将来服务化自建。node agent 始终由开机 `start_command` 注入，不进镜像。
- **理由**：把凭证风险从产品里摘掉（L1 根本不碰云凭证）；把"全自动"限定在有 API 的平台上，避免承诺做不到的事；算力与平台费分离，才能在 BYOC 档维持软件毛利而非负毛利。
- **代价**：支持成本显著上升（驱动/镜像/磁盘/带宽/平台限制），必须靠白名单机型 + `doctor` 自检 + 官方镜像压住；BYOC 档 ARPU 低于托管档，只适合工作室/专业版。
