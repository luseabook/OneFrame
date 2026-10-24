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
