# 万星项目 · 启动前文档审查报告

> 审查对象：`E:\wanxing` 全部项目文档（16 份 `docs/` + 1 份根级蓝图）
> 审查时点：2026-10-24（文档体系 v1.1 定稿当日）
> 审查角色：交付总监（主理人）统筹，产品经理复核产品侧、架构师复核技术侧
> 审查方法：纵向链路闭合检查（需求 → 旅程 → API → 表结构 → 测试 → 排期）+ 横向数字/术语比对 + 文档↔已落地 P0 代码比对
> 结论：**有条件放行（Conditional No-Go）** —— 文档覆盖面与深度高于同阶段项目平均水平，但存在 **10 项 P0 阻塞**，其中 4 项属"按现有文档写代码必然返工"级别，必须在开工前修订。

---

## 0. 结论摘要

| 项 | 结果 |
|---|---|
| 审查文档数 | 17 份（`docs/` 16 + `复刻蓝图.md` 1） |
| 发现问题 | **56 项**：P0 10 项 / P1 23 项 / P2 23 项 |
| 覆盖完整性 | 产品、架构、前端、工程、运维、安全合规、计划 7 个域齐全；**缺 8 类配套文档**（见 §2.2） |
| 内部一致性 | 任务状态机、部署拓扑、错误码分段设计自洽；计费两阶段模型成立但**记账口径未定**（P0-09）；数字口径与引用存在系统性漂移（见附录 A） |
| 文档↔代码 | P0 脚手架已落地，但错误码、字段命名、限额与文档存在 4 处实质偏差 |
| 放行判断 | 修订 P0-01～P0-08 后可开工；P1 允许在 W1 内并行补齐，但不允许越过 M1 |

**一句话结论**：这不是"文档写得不够多"的问题，而是**四处地基没浇完**——需求基线没有独立可判定的版本、鉴权数据模型无法落地、Alpha 运营与"完集"指标所依赖的能力在数据层与接口层均不存在、资金流水的记账口径无法支撑对账。这四处不修，W2 就会开始返工，W4 出现对不上账。

---

## 1. 审查范围与判定标准

### 1.1 覆盖范围

| 域 | 文档 | 版本头 |
|---|---|---|
| 总览 | `docs/README.md` | v1.1 |
| 产品 | `01-product/PRD.md`、`user-journeys.md`、`metrics.md` | v1.1 |
| 架构 | `02-architecture/system-design.md`、`adr.md`、`database.md`、`api-spec.md` | v1.0 |
| 前端 | `03-frontend/conventions.md` | v1.0 |
| 工程 | `04-engineering/dev-workflow.md`、`testing.md` | v1.0 |
| 运维 | `05-ops/deployment.md`、`observability.md` | v1.0 |
| 安全合规 | `06-security-compliance/security.md`、`compliance.md` | v1.0 |
| 计划 | `07-plan/wbs.md` | v1.1 |
| 历史 | `复刻蓝图.md` | v1.0（声明为历史参考） |
| 代码（交叉验证用） | `app/packages/shared/src/{errors,constants,envelope}.ts`、`schemas/{auth,project,generation}.ts`、`app/apps/*/.env.example` | — |

### 1.2 严重程度定义

| 级别 | 判定标准 | 处置要求 |
|---|---|---|
| **P0** | 按现文档实施必然返工，或直接阻塞 Alpha/Beta 门槛，或存在资金/合规硬风险 | 启动前必须修订并复评 |
| **P1** | 不阻塞开工，但会导致口径分歧、验收争议或上线后事故 | M1 前定稿 |
| **P2** | 表述、引用、细节精度问题，不影响正确性 | 随文档维护规则滚动修正 |

### 1.3 未覆盖说明

- 竞品证据目录 `rea-reelmate/`（1914 文件）仅抽查引用一致性，未做全文复核；
- 本报告非法律意见，`compliance.md` 的资质判断仍需代理机构确认。

---

## 2. 文档完整性与成熟度评估

### 2.1 逐份评估

| 文档 | 完整性 | 主要缺口 |
|---|---|---|
| `README.md` | 中 | 文档地图缺 v1.0 基线；"三条核心旅程"实为四条；未决事项直接阻塞 W1 |
| `PRD.md` | **低（结构性）** | 增量式写法，7 处验收标准外引不存在的 v1.0；无页面清单；F7/F8 无旅程与埋点 |
| `user-journeys.md` | 中 | 缺 F7 内容安全、F8 后台旅程；J3 缺"预算触顶"与"余额不足"分支区分 |
| `metrics.md` | 中 | 北极星判定所需"导出/下载"事件缺失；WCE 单位口径未定义 |
| `system-design.md` | 中高 | 拓扑图缺 script 模块；导出打包与 LLM 同步步骤缺失败/超时设计 |
| `adr.md` | 中 | 6 条决策清晰；交叉引用 2 处错章节；无 Superseded 示例印证"只增不改" |
| `database.md` | 中 | ER 图缺流水线 5 表；缺邀请/等待名单；缺任务↔分镜归属；`skus` 列与接口不符 |
| `api-spec.md` | 中 | 缺 Alpha 运营端点、导出异步化；批量投递语义不完整；1 处非法 HTTP 用法 |
| `conventions.md` | **低** | 无页面清单且误引 PRD §5；旗舰流水线 6 个页面无落点 |
| `dev-workflow.md` | 高 | — |
| `testing.md` | 中高 | 缺导出/打包、Alpha 运营测试；适配器清单与排期不符 |
| `deployment.md` | 中高 | 环境变量"权威版"声明失实；可观测组件无部署落点 |
| `observability.md` | 中 | Sentry 方案与合规冲突；缺 LLM 步骤与导出指标 |
| `security.md` | 中 | 手机号加密与唯一索引冲突（P0）；Cookie 方案与接口契约冲突 |
| `compliance.md` | 中 | 与 PRD 功能条目脱节（年龄门禁、AI 双标识、举报入口均无功能承接） |
| `复刻蓝图.md` | — | 未标注 Superseded，且 5 处结论与现行文档相反 |

### 2.2 应有而完全缺失的文档（8 类）

| # | 缺失文档 | 为什么必须有 | 关联文档 |
|---|---|---|---|
| 1 | **页面清单 / 信息架构（IA）** | `conventions.md` 声称"与 PRD §5 页面清单一一对应"，但该章节不存在；旗舰流水线的建项/大纲/角色/剧本/分镜/项目矩阵 6 页无任何页面级规格 | PRD §4 F2、conventions §1 |
| 2 | **错误码 → 用户文案映射表** | `conventions.md` 要求"错误码→文案映射表"，`dev-workflow.md` 要求"错误文案走映射表"，但映射表本身不存在 | conventions §2、dev-workflow §2 |
| 3 | **用户协议 / 隐私政策 / 举报投诉流程文本** | 合规 G 组上线硬门槛（三链路上线），当前仅有清单条目，无文本来源与责任人 | compliance D1、C2 |
| 4 | **定价与成本测算表** | PRD 承诺"价格透明：公示直连价与积分换算"，但 `model_prices` 人工维护、SKU 档位仅散见于 PRD 一句 | PRD §3、database §2 |
| 5 | **OpenAPI 基线产物** | `api-spec.md` 声称"实现用 OpenAPI 生成 + 人工对账"，仓库内无任何 OpenAPI 文件，契约测试无比对基准 | api-spec 前言、testing §3 |
| 6 | **技术上线检查单 + 回滚演练模板** | `compliance.md` G 组是合规侧检查单，技术侧无对应清单（发布前冒烟仅 4 条） | deployment §6、testing §7 |
| 7 | **客服 / 退款 / 投诉 SOP** | J3a 等待名单、E3 未成年人误充退款、C2 举报处置均承诺 7×24 受理，无流程与时限定义 | compliance C2/E3、journeys J3 |
| 8 | **LLM 步骤规格（Prompt + 输出 Schema）** | 大纲/角色/分镜三类生成是旗舰核心，排期有"Prompt 工程专项"，但无任何字段级输出契约与解析失败处理约定 | wbs 2.2、api-spec §8 |

---

## 3. P0 阻塞项（10 项，启动前必须解决）

### P0-01 需求基线缺失：PRD 是"增量补丁"，验收标准全部外引不存在的 v1.0

- **证据**：`PRD.md:3` 标注 v1.1；`PRD.md:32`「同 v1.0…验收标准不变」；`PRD.md:57`「规格同 v1.0 F2…验收标准同 v1.0」；`PRD.md:61`「v1.0 基础上增加」；`PRD.md:64`「v1.0 资产库全部功能」；`PRD.md:69`「同 v1.0」；`PRD.md:75`「v1.0 全部要求」；`PRD.md:79`「v1.0 全部」。而 `README.md:8-24` 的文档地图中**不存在任何 v1.0 PRD 文件**，仓库内也无其他版本。
- **影响**：F1 登录、F3 工具箱（AI 标识/分享/预估交互）、F4 任务历史、F5 资产库、F6 积分展示、F7 内容安全、F8 后台——**七个模块的验收标准在当前仓库内不可判定**。QA 无法写用例，工程师无法判断"做完没有"，`wbs.md:38/42` 的 DoD（"PRD F3 验收过""PRD F5 验收"）指向空集。
- **建议**：二选一——(a) 补齐 v1.0 PRD 并纳入 docs/（作为附录归档）；(b) **推荐**：把 v1.1 改写为自包含基线，将 7 处外引展开为具体条目与验收标准。这是本次审查中唯一"不修就无法验收"的问题。

### P0-02 手机号加密方案与登录查询索引直接冲突，鉴权链路无法实现

- **证据**：`security.md:42`「手机号：AES-GCM 字段加密存（密钥 KMS/环境分离）」；`database.md:43-44` `external_id TEXT NOT NULL -- 手机号或开放平台 unionid` + `UNIQUE (provider, external_id)`。手机号即登录标识，登录必须按 `phone` 等值查询 `identities`。
- **影响**：AES-GCM 使用随机 IV 时同一手机号每次密文不同，**等值查询与唯一索引同时失效**——登录查不到用户、注册去重失效、同号可重复建号。用确定性加密（SIV/固定 IV）则丧失语义安全。这是"安全要求"与"数据模型"两个文档各自正确、合起来不可实现。
- **建议**：手机号改为 **`phone_hash`（HMAC-SHA256，带密钥）+ `phone_cipher`（AES-GCM，展示/发送用）双列**，唯一索引建在 `(provider, phone_hash)`。需同步修订 `database.md §1`、`security.md §5`，并在 `testing.md §2` 增加"同号注册唯一性"用例。

### P0-03 任务与分镜的关联模型缺失，旗舰"分镜矩阵/断点续跑"无法实现

- **证据**：`database.md:105-125` `tasks` 表只有 `space_id/user_id/capability/mode/model_id`，**无 `project_id/episode_id/shot_id`**；`database.md:211-216` `storyboards` 仅 `image_task_id`、`video_task_id` 两个**单值**字段；`api-spec.md:157-161` 批量投递返回 `{task_ids[]}`，`GET …/episodes/{eid}` 要返回"分镜+任务矩阵"。
- **影响**：三重不可实现——① N 个镜 → N 个任务后，返回的是扁平 `task_ids[]`，**没有 task→shot 的映射**，前端无法把状态回填到行；② `video_task_id` 单值意味着一次重试就覆盖旧任务，`tasks.retry`（`api-spec.md:112`）产生的历史任务**永久失去归属**，PRD `PRD.md:45` 要求的"失败镜一键重试 + 断点续跑"无法展示"这个镜重试过几次"；③ 任务写入 `storyboards.video_task_id` 时，批量 30 镜并发 UPDATE 存在竞态且无事务边界定义。
- **建议**：`tasks` 表增加 `biz_type/biz_id`（或直接 `episode_id` + `shot_id`），并把 `storyboards.video_task_id` 改为通过 `tasks.shot_id` 反查、保留"当前生效任务"指针；批量投递响应改为 `{items:[{shot_id, task_id|null, status, reason}]}`（同时解决 P1-10 的未投递表达）。

### P0-04 批量投递的幂等键模型与唯一索引冲突

- **证据**：`api-spec.md:24`「Idempotency-Key 创建类必填，UUIDv4，5min 内重放返回原结果」；`api-spec.md:157-159` 一次 `generate-videos` 请求创建**多个**任务；`database.md:126-127` `CREATE UNIQUE INDEX uq_tasks_idem ON tasks(idempotency_key, space_id)`。
- **影响**：一个请求 30 个镜 = 30 条 tasks，但只有 1 个 `Idempotency-Key`，唯一索引在第 2 条插入时即冲突，**批量投递必然失败**；若改为每镜派生键（`key:shot_id`），则重放语义与"5min 内同键返回原结果"的接口承诺不一致，且文档未定义派生规则。
- **建议**：明确**请求级幂等表**（`idempotency_records(key, space_id, request_hash, response_body, expire_at)`）与**任务级去重键**（`tasks.dedupe_key = f(request_key, shot_id)`）分离；在 `api-spec.md §1` 补"批量接口的幂等语义"小节。

### P0-05 Alpha 核心运营能力（邀请码 / 等待名单）在三层均不存在

- **证据**：需求侧 `PRD.md:70`「Alpha 期：邀请制…邀请码可加额度」、`user-journeys.md:49-50`「等待名单表单 + 邀请码激活通道」、`metrics.md:45` 埋点 `waitlist_submit`、`wbs.md:63` A.2「留资入库」；技术侧：`api-spec.md` 全文**无任何 invite/waitlist 端点**，`database.md` 全文**无对应表**，`packages/shared` 无 schema。
- **影响**：W9 Alpha 的准入机制、以及"额度用尽→等待名单"这条唯一留存回路上线即缺功能。且邀请码"可加额度"意味着需要发放/核销/额度记账三件事，均无设计。
- **建议**：补 `invite_codes(code, credits, max_uses, used_count, expires_at, status)`、`invite_redemptions`、`waitlist_entries(phone_hash, source, created_at)` 三表 + 4 个端点（校验/核销/留资/余量）；同步补 `api-spec §2.1` 与 `testing` 用例。

### P0-06 "完集"指标依赖尚不存在的成片能力，Alpha/Beta 核心指标不可采集

- **证据**：`PRD.md:8` 愿景「30 分钟内产出一集**可发布**的漫剧/短剧视频」；`PRD.md:46` 导出仅"逐镜下载/全集打包 zip"，「成片合成拼接→ v1.1」；`PRD.md:101` Alpha 成功指标「首周**完集成片**用户占比 ≥40%」；`metrics.md:9` 北极星 `episode_completed` 要求"触发过导出/下载"；`PRD.md:103` GA 又以"v1.1 合成导出上线"为前提。
- **影响**：**北极星指标在 Alpha/Beta 阶段无法定义**——没有成片，用户"完集"只能等同"30 个镜头逐个下载"，`episode_completed` 的事件口径与用户真实价值脱节；同时 GA 门槛"v1.1 合成上线"与 Alpha 指标"完集成片"自相矛盾。整个增长度量体系建立在一个 v1.1 才有的能力上。
- **建议**：明确 Alpha 期"完集"定义为**工程口径**（≥80% 镜头 SUCCEEDED 且触发过全集打包下载），并在 PRD §7 与 metrics 同步写明；把"成片"从愿景表述中剥离到 v1.1 承诺，避免愿景与 MVP 验收错位。

### P0-07 合规硬项"年龄/实名门禁"无任何功能承接

- **证据**：`compliance.md:32` C3「实名+年龄提示；**不向未满 18 提供深度合成服务**（注册协议声明+支付人脸复核可选）」；`compliance.md:66` G 组列为 Alpha gate；而 `PRD.md:32` F1 仅"手机验证码一码通用、未注册自动建号"，`api-spec.md:46-51` 登录链路无年龄/实名字段，`database.md:30-58` 无实名信息表，`wbs.md` 无对应任务。
- **影响**：Alpha gate 的 G 清单有一项**没有任何实现路径**——既是合规风险（深度合成服务对象限制），也会在 Alpha 上线检查时直接卡住。
- **建议**：Alpha 期最小落地=注册协议勾选"已满 18"强校验 + `users.age_declared_at` 留痕 + 未成年人投诉下架 SOP；若要求"实名"，则必须新增实名核验供应商与成本项，需在 W1 决定（影响预算与排期）。

### P0-08 未决事项与 W1 时间线直接冲突，第一周就会卡住

- **证据**：`README.md:41-44` 未决事项包括"项目名称/域名（阻塞：备案、落地页文案）""主体公司（个体/有限公司）与支付主体（阻塞：微信支付申请）""团队编制确认（当前假设 1~2 名全栈）"；而 `wbs.md:15` 0.5「域名/ICP 备案提交/AI 双备案启动/短信签名/火山+DeepSeek 开通」排在 **W1**，DoD 是"全部受理回执"；`wbs.md:91` 微信支付商户号 W8 申请。
- **影响**：域名未定 → 备案无法提交 → `compliance.md:12-13` A3/A4 顺延 → B1/B2 AI 备案顺延（2~6 周）→ **W9 Alpha 硬门槛必然击穿**；主体未定 → 短信签名与供应商企业认证均无法办理。这是"计划假设了一个尚未做出的决定"，不是文案问题。
- **建议**：把域名/主体/编制三项定为 **D0（T+3 日内）决策项**并写入 README 顶部，未决期间 wbs 的 W1 标记为"不可开工"；若坚持 W1 启动，则先以临时主体+二级域名跑通技术链路，但需明确备案倒排时间。

### P0-09 对账不变式的记账口径未定义，资金类测试门禁无法通过

- **证据**：`database.md:147` `delta INT NOT NULL -- 冻结记负的可用额度视角见 memo`（一行注释两种可能含义，且 `memo` 无解释）；`security.md:28`「对账任务每日校验 `balance+frozen == Σflows`」；`testing.md:18`「任意状态序列下 `balance+frozen == Σ流水`（属性测试随机状态转移 1000 次）」。
- **影响**：不变式与 `delta` 的语义强耦合——若 `freeze` 记为负数，则 `Σflows` 已包含冻结额，再与 `balance+frozen` 相加必然双重计算，**对账永远不平**；若 `freeze` 记 0 只作事件留痕，则冻结动作在流水中不可见，纠纷时无法举证。二义性直接导致 W2-3 的 P1.3 任务（`wbs.md:25` DoD 含 `testing §2 1/2/7`）无法验收，且这是"钱"的不变式，写错一次就是资金事故。
- **建议**：确定唯一口径并写死——推荐 **`delta` 统一为"可用余额变动"**（`freeze` 记 `-cost`、`settle` 记 0 并把实际扣减体现在 `frozen` 减少、`unfreeze` 记 `+cost`），另加 `frozen_delta` 列，使不变式变为 `balance == Σ delta` 且 `frozen == Σ frozen_delta`；同步改 security §3、testing §2-1。

### P0-10 refresh token 载体三处冲突，鉴权实现必须二选一

- **证据**：`security.md:45`「浏览器端不存 token 于 localStorage（refresh 用 SameSite=Strict HttpOnly Cookie，access 内存态）」；`api-spec.md:52` `POST /auth/refresh {refresh_token}`（请求体）；`schemas/auth.ts:12` `refreshRequestSchema = z.object({ refresh_token })`；`conventions.md:32`「401 静默 refresh 单飞」。
- **影响**：两条路径不能同时成立——Cookie 方案下前端拿不到 token、请求体无从填写；body 方案下 refresh token 必须落在前端可读位置，**与"不存 localStorage"的安全基线冲突**（XSS 即可长驻）。这不是文案分歧：登录模块是 P1 第一件事（`wbs.md:23`），选错会在 W3 前后引发一次鉴权重写，若上线后才发现则是安全问题。
- **建议**：**定为 HttpOnly Cookie 方案**（安全基线优先）：`/auth/refresh` 无请求体、响应 `Set-Cookie`；`login` 的 `refresh_token` 从响应体移除；补 CSRF 策略（SameSite=Strict + 自定义头双保险）。需同步 `api-spec §2`、`schemas/auth.ts`、`conventions §2`、`security §2` 四处。

---

## 4. P1 高风险项（23 项，M1 前定稿）

### 4.1 需求与口径

| # | 问题 | 证据 | 影响 | 建议 |
|---|---|---|---|---|
| P1-01 | 小说输入上限三处不一致：≤5 万字 / 8000 字 / 1 万字 | `PRD.md:40`、`user-journeys.md:9`、`PRD.md:49`；代码 `constants.ts:81` = 50000 | 验收用例与前端提示、后端校验三方打架 | 统一为 5 万字，旅程示例改"8000 字样例"，验收写"1 万字小说（≤5 万上限内）" |
| P1-02 | 首发版本标签混乱：标题 v1.1 / §4「MVP 范围（v2）」/ §5「Non-goals（v1.0 首发）」/ §6「v1.0 MVP」 | `PRD.md:3/28/81/92` | 无法回答"首发到底是 v1.0 还是 v2"，路线图与 WBS 的版本锚点失效 | 全库统一为"v1.0 = 路线 A 首发"，删除 v2 字样 |
| P1-03 | 大纲"自动保存"与"仅 PUT 落库"冲突 | `PRD.md:41`「自动保存」vs `api-spec.md:134/141-142`「草稿态，编辑后 PUT 落库」 | 用户刷新丢稿；且 `characters/generate` 依赖大纲是否已落库，链路可能读空 | 明确：generate 即落草稿版本，PUT 提交确认；或定义自动保存节流策略 |
| P1-04 | 预算上限默认值两处矛盾，且"续投"逻辑死锁 | `PRD.md:45`「默认=报价总和」vs `PRD.md:108`「建议按全集报价×80%」；`user-journeys.md:58`「原预算参数保留」 | 按现值实现：预算触顶→用户充值→"继续投递"仍带已达上限的预算→立即再次停投，形成死循环 | 默认值定为"全集报价×100%"，续投时允许显式提高上限；把 §8 开放问题 2 关闭 |
| P1-05 | 745701 一码两义：余额不足与"预算上限不足"共用 | `user-journeys.md:48`「预算上限不足/余额不足(745701)」 | 前端无法区分"去充值"与"提高预算"，引导必错一种 | 新增 `745703 BUDGET_EXCEEDED`（或 `7457xx` 子码），并登记到 api-spec 与 `errors.ts` |
| P1-06 | Alpha"邀请制"与"未注册自动建号+送 80 分"互斥 | `PRD.md:70` vs `PRD.md:32`、`api-spec.md:49-50`、`wbs.md:23`「新人礼包」 | 邀请制形同虚设，任何人可注册领 80 分 → Alpha 期模型成本失控 | 明确 Alpha 期注册需邀请码（`code` 必填或有资格标记），未持码者只能进等待名单 |

### 4.2 契约与数据模型

> 原 P1-09（refresh token 载体冲突）已升级为 **P0-10**；编号保留空位以便追溯。

| # | 问题 | 证据 | 影响 | 建议 |
|---|---|---|---|---|
| P1-07 | 分镜时长 2~15s 与视频生成下限 4s 不兼容 | `schemas/project.ts:30`（2..15）vs `constants.ts:85-86`（4..30）、`database.md:80`（durations 4,5,6,8,10） | 用户把镜头设成 2~3s 时批量投递必然参数越界，且无提示 | 分镜时长枚举对齐模型 `durations`，或投递时按最近档位取整并在 UI 提示 |
| P1-08 | 定妆图绑定字段三处不一致 | `api-spec.md:148`（自动绑定 `resource_asset_id`）、`database.md:209`（`resource_asset_id`）、`schemas/project.ts:21`（`portrait_asset_id`） | 一方按文档写 DTO、一方按 schema 写，联调即错；一致性机制是核心卖点，字段不能含糊 | 统一为 `portrait_asset_id`（语义更准），同步 database 列名与 api-spec |
| P1-10 | 批量投递不返回"未投递"结果，且无并发控制定义 | `api-spec.md:157-159` 仅 `{task_ids[]}`；`PRD.md:51` 要求"余下镜头标未投递" | 预算触顶后前端拿不到"哪些镜没投、为什么没投"，无法渲染灰态；并发投递下"累计冻结≥上限"判定无锁策略 | 响应改 `{items:[...]}`；明确投递按镜串行冻结（单事务内逐镜 `SELECT … FOR UPDATE`） |
| P1-11 | 积分有效期规则整库缺失 | `api-spec.md:61` 返回 `credits.expire_soon`；`database.md:139-152` 无过期字段/批次；PRD 全文未定义积分是否过期 | 计费规则缺口：直接涉及退款、投诉、财务口径，上线后无法补救 | 补"积分批次"模型（`credit_batches(expire_at, remaining)`）或明确"永不过期"并删除 `expire_soon` |
| P1-12 | 导出 zip 无异步化设计 | `api-spec.md:162` 同步返回 `{download_url}`；`system-design.md` 无导出任务/队列 | 30 个镜头、数百 MB 的打包同步 HTTP 必超时；失败无重试、无进度 | 改为异步导出任务（复用 tasks 或独立 `exports` 表 + 队列 + SSE/轮询） |
| P1-22 | 任务重试的幂等键派生规则缺失 | `api-spec.md:112`「新任务复制原参（`idempotency_key` **换新**）」vs `database.md:126-127` 唯一索引；`user-journeys.md:27`「失败镜一键重试（幂等）」 | 若"换新"由前端生成，用户超时重按一次就产生第二个任务并二次冻结——`testing.md:25` 要求的"重试幂等不重复扣费"无法通过；且旧任务被 `storyboards.video_task_id` 覆盖（见 P0-03） | 明确重试幂等键由**服务端**按 `(原 task_id, attempt_no)` 派生，前端不参与；补 `attempt_no` 字段 |
| P1-23 | "OSS 转存失败降级直引供应商 URL"推翻 ADR-005 并绕过 AI 标识 | `system-design.md:107`（降级直引供应商 URL 24h）vs `adr.md:44-45`（必转存、合规留档、标识在转存时合成）vs `compliance.md:22`（显式+隐式双标识）vs `system-design.md:90`（标识合成只在转存成功后） | 降级路径下**输出无 AI 标识、无自有留档**，正好踩中合规硬项；且用户会拿到 24h 后失效的链接 | 降级改为"转存到临时桶并照常合成标识"，或失败即 `FAILED+解冻`；删除直引供应商 URL 的表述 |
| P1-24 | 错误码全集未登记，且 400102 一码两义；新账号首日限额未进契约 | `api-spec.md:26`「完整语义见 security.md §7」（§7 实为"输入与文件安全"，死链）；`errors.ts:8` `NOT_FOUND=400102` vs `api-spec.md:111`「终态报 **400102**」（语义应为"不可取消"）；`security.md:35`「新账号首日 20 次/日」未出现在 `api-spec.md:204-214` 限流表 | 前端错误文案映射会取错分支（"资源不存在" vs "无法取消"）；首日限额只写在安全文档里，实现与测试都容易漏 | 以 `api-spec §1` 为唯一码表（补齐 745702/746003/429100/500000/400102），新增 `400103 CANCEL_NOT_ALLOWED`；首日限额入 §13 |

### 4.3 前端与工程

| # | 问题 | 证据 | 影响 | 建议 |
|---|---|---|---|---|
| P1-13 | 前端规范无旗舰流水线页面落点，且误引不存在的"PRD §5 页面清单" | `conventions.md:11`（PRD §5 实为 Non-goals）；目录 `conventions.md:12-14` 仅 index/create/tasks/assets/pricing/settings，**无 projects/** | 旗舰功能（6 个页面）在前端规范中完全缺位，UI 工作量未进入任何文档；`wbs.md:49` 2.1 才提"四页"，与 F2 的 7 个环节不匹配 | 补 `pages/projects/[id]/{outline,characters,episodes,storyboards}.vue` 与项目列表页，并把页面清单独立成文档 |
| P1-14 | 合规要求的"AI 双标识"在 PRD 无功能条目，且 compliance 指向错误模块 | `compliance.md:22`「显式水印+隐式元数据」标注"MVP **F6**"（F6 是积分，内容安全是 F7）；`PRD.md:73-75` F7 只写"审核"，未写"标识" | 隐式标识（元数据/水印嵌入）无需求、无验收、无测试 → G 组"双标识抽验通过"无依据 | PRD F7 增"标识"子项与验收标准；compliance B3 改指 F7；testing 增加标识抽验用例 |
| P1-15 | 微信支付商户号与 ICP 经营许可证存在循环依赖 | `compliance.md:49`「E1 商户号需 A1+A4」；`compliance.md:13`「A4 涉及在线充值(经营性)后 90 日内办理」；`wbs.md:91` 商户号 W8 申请 | 未充值不构成经营→无 A4；无 A4→商户号申请受限。支付上线路径未闭环，P2' 可能整体顺延 | W1 即向属地通管局确认"先证后营/先营后证"口径；准备"虚拟商品/软件服务"类目备选通道 |
| P1-16 | Sentry（境外 SaaS）被 4 份文档当既定方案，但合规明令禁止 | `observability.md:3/43-47`、`deployment.md:55`（`SENTRY_DSN`）、`dev-workflow.md:70` vs `compliance.md:42`「不用境外 Sentry SaaS」、`compliance.md:69` G 组 | Alpha gate 的一项，却同时是运维基线；上线前换方案意味着错误聚合、sourcemap、告警全部返工 | **D0 决策**：选国内 APM（如 ARMS/观测云）或 self-host Sentry，并回写 observability §5 |
| P1-17 | 任务成功率目标 92% 与告警线 85% 之间存在监控盲区 | `metrics.md:12`（≥92%）vs `observability.md:29`（<85% 告警、<70% 降级） | 成功率长期停在 86~91% 时**既不达标也不告警**，指标形同虚设 | 告警线对齐目标：<92% 即 P2、<88% 升 P1 |
| P1-18 | 北极星判定所需"导出/逐镜下载"事件缺失 | `metrics.md:9`（要求"触发过导出/下载"）vs `metrics.md:42-43` 事件表无 `export_zip`/`shot_download`，仅有 `asset_download` | 北极星与激活率无法准确计算，Alpha 卡点报告失真 | 补 `export_submit/export_ready/shot_download` 三个事件 |
| P1-19 | README 声称 8 份文档"已同步"，但版本头仍为 v1.0，同步结果不可验证 | `README.md:4` vs `system-design/api-spec/database/testing` 头部 v1.0 | 无法判断 v1.1 变更是否真的落到技术文档（抽查已发现多处未同步，如无 VIP、无 canvas 端点） | 建立"变更登记表"（文档 × 变更条目 × 状态），或强制每次改动 bump 版本 |

### 4.4 运维与法务

| # | 问题 | 证据 | 影响 | 建议 |
|---|---|---|---|---|
| P1-20 | 生成结果 90 天自动删除，但 PRD/用户协议无任何告知 | `database.md:124/274`、`deployment.md:80`；PRD 全文未提 | 用户作品静默消失 → 客诉/退款争议；PIPL 要求告知处理规则 | 写入用户协议与项目页提示；提供"到期前 7 天"站内信 |
| P1-21 | 账号注销（30 天物理清）与"任务记录永久保留"未对齐 | `security.md:44` vs `database.md:275` | 注销后任务记录仍含关联 `user_id`，与删除权承诺冲突 | 明确注销时对 `tasks` 做不可逆脱敏（清 `user_id`）并写进 security §5 |

---

## 5. P2 改进项（23 项）

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| P2-01 | ER 图未包含流水线 5 张表（`script_projects/episodes/project_assets/storyboards/storyboard_assets`）；`script_projects.status`、`episodes.status`、`storyboards.status` 均无枚举注释 | `database.md:8-25`、`database.md:198/203/214` | 补 ER 与状态注释；状态枚举集中到 §3 一处 |
| P2-02 | `skus` 表缺 `sku` 编码列与 `label` 展示名，接口却返回二者 | `api-spec.md:179` vs `database.md:155-159` | 加列或改接口字段 |
| P2-03 | `GET /billing/refund`、`GET /files/sign-url {object_key}` 均用 GET 携带请求体，属非法/不可实现用法 | `api-spec.md:184`、`api-spec.md:127` | 改 `POST /billing/refunds`、`POST /files/sign-url` |
| P2-04 | 交叉引用漂移 5 处 | `adr.md:28`（mode 枚举实为 api-spec §5）、`adr.md:38`（积分实为 PRD F6）、`compliance.md:22`（实为 F7）、`conventions.md:11`（PRD 无 §5 页面清单）、`security.md:20`（限流实为 api-spec §13） | 全库引用改为"文档名+标题锚点"，避免章节号漂移 |
| P2-05 | 系统拓扑图模块列表缺 `script`，与 §2 模块表不一致 | `system-design.md:16-17` vs `system-design.md:49` | 补模块 |
| P2-06 | "三适配器"三处口径不同：排期只列 2 个、代码注册表是 3 个、测试 fixtures 又是另一组 | `wbs.md:19`（"三适配器"）vs `wbs.md:26-27`（仅火山、DeepSeek）；`model-adapters/src/registry.ts:6-10`（volcengine/aliyun/deepseek 桩）；`testing.md:36-37`（volcengine/aliyun/**kling**） | 统一为"火山视频+图像、百炼图像、DeepSeek LLM"，补百炼适配器任务与 fixtures |
| P2-07 | 环境变量"`.env.example` 为权威版"声明失实；变量名漂移；P1 双密钥未进配置校验 | `deployment.md:41` vs `apps/api/.env.example:1-7`、`apps/worker/.env.example:1-6`；`ALIYUN_DASHSCOPE_KEY`（deployment:51）vs `DASHSCOPE_KEY`（worker:6）；`apps/api/src/config/env.ts:4-10` 仅校验 5 项，无 `JWT_SECRET/REFRESH_SECRET` | 以 `deployment.md §4` 为权威补全 `.env.example`；统一变量命名；P1 把双密钥纳入 zod 校验 |
| P2-08 | 分镜数只有范围无默认值（PRD 说默认 8~20，接口只写 4..30） | `PRD.md:44` vs `api-spec.md:153` | 接口补 `default: 10` |
| P2-09 | 压测目标比容量假设高一个量级且无依据说明 | `system-design.md:114`（轮询 ~100 QPS、创建 ~5）vs `testing.md:46-47`（1000 连接、创建 50 RPS） | 标注"按 10× 余量设计"的理由，或下调压测基线 |
| P2-10 | 可观测性依赖 Prometheus，但部署清单无对应组件 | `observability.md:12` vs `deployment.md:25-39` | 补 Prometheus/Grafana（或云监控）部署项与保留期 |
| P2-11 | 旧蓝图未标 Superseded，5 处结论与现行文档相反却被保留为"历史参考" | `复刻蓝图.md:5`（v1.0 定稿）、`:27`（明确不做剧本流水线）、`:236`（错误码 400xxx）、`:354`（送 60~100 积分）、`:390`（P3 才做流水线） | 文件头加"**已废弃，以 docs/ 为准**"横幅，并在关键冲突处标注替代文档 |
| P2-12 | Alpha 成功指标 40% 在 20~50 人样本上无统计意义，且与激活率口径重叠 | `PRD.md:101` vs `metrics.md:10` | Alpha 阶段以"漏斗卡点定位"为主，指标改为观察项 |
| P2-13 | 单人执行 Beta 顺延至 W14，但 PRD 仍写 W12，未同步 | `wbs.md:95` vs `PRD.md:102` | PRD 增加"单人执行 = W14"备注 |
| P2-14 | `source_type` 残留 `3fission` 枚举（产品与接口只定义 2 种） | `database.md:197`（1novel 2idea 3fission）vs `api-spec.md:135` | 删除或标注"预留" |
| P2-15 | 无限画布同时出现在 Non-goals 与"v1.5 承诺" | `PRD.md:83/94` | 改为"Non-goals（v1.0），路线图中列为 v1.5 承诺" |
| P2-16 | 三个时长口径并存：愿景 30min、护栏 40min、验收 2h | `PRD.md:8/49`、`metrics.md:11` | 明确定义（人工操作时长 / 含排队端到端），避免对外表述混乱 |
| P2-17 | README 称"三条核心用户旅程"，实为 J1~J4 四条 | `README.md:11` vs `user-journeys.md` | 改为四条并补 J4 说明 |
| P2-18 | 号称 OpenAPI 生成 + 对账，仓库无 OpenAPI 产物与错误文案映射表 | `api-spec.md:4`、`conventions.md:32`、`dev-workflow.md:33` | 在 P0 0.3 任务 DoD 中产出 `openapi.json` 与 `error-messages.ts` |
| P2-19 | `tasks.expire_at` 被 §9 引为清理依据，但 DDL 未建索引 | `database.md:270` vs `database.md:105-125` | 补 `INDEX idx_tasks_expire ON tasks(expire_at)` |
| P2-20 | 预览/抽帧、AI 标识合成的耗时与失败处理未纳入任务状态机 | `system-design.md:90` vs `database.md:114-115` 状态枚举 | 明确 transfer 阶段失败时的降级（已定义）与"标识合成失败"是否阻断成功 |
| P2-21 | 端点 `portrait:rebind` 使用冒号语法，违反团队自定的"API 路径 kebab-case" | `api-spec.md:149` vs `dev-workflow.md:44` | 改为 `POST …/portrait/rebind` 或 `PATCH …/characters/{cid}` |
| P2-22 | CI 门禁缺安全扫描，但 PR 自检清单要求"无密钥残留" | `dev-workflow.md:50-51`（lint→typecheck→unit→integration→build→bundle-size）vs `dev-workflow.md:32`、`security.md:50`（gitleaks 扫描 CI） | CI 补 `pnpm audit --prod` 与 gitleaks，作为合并硬门禁 |
| P2-23 | 角色卡上限"≤10 张"只写在 PRD，未进共享常量与校验 | `PRD.md:42` vs `constants.ts:79-88`（无 `CHARACTER_MAX`） | 补 `CHARACTER_MAX=10` 并用于 `characters/generate` 校验 |

---

## 6. 跨文档数字一致性对照表（本次审查核心证据）

| 参数 | 文档 A | 文档 B | 文档 C | 代码 | 判定 |
|---|---|---|---|---|---|
| 小说输入上限 | PRD `:40` ≤5 万字 | 旅程 `:9` 8000 字 | PRD `:49` 1 万字 | `constants.ts:81` 50000 | **冲突（P1-01）** |
| 分镜数 | PRD `:44` 默认 8~20 | api-spec `:153` 4~30 | — | `SHOT_COUNT_MAX 30` | 缺默认值（P2-08） |
| 分镜时长 | — | api-spec 无约束 | DB `:80` 4/5/6/8/10 | schema 2~15 / 生成 4~30 | **冲突（P1-07）** |
| 注册赠分 | PRD `:32` 80 | api-spec `:50` +80 | 蓝图 `:354` 60~100 | — | 蓝图过时（P2-11） |
| 预算默认值 | PRD `:45` = 报价总和 | PRD `:108` ×80% | — | — | **冲突（P1-04）** |
| 错误码 745901 | api-spec `:37` 供应商错误 | errors.ts `:24-25` VENDOR_ERROR=745900 / TIMEOUT=745901 | 蓝图 `:236` 400xxx 段 | — | **冲突（P1-10）** |
| 待办任务成功率 | metrics `:12` ≥92% | observability `:29` 告警<85% | — | — | 盲区（P1-17） |
| Beta 周次 | PRD `:102` W12 | wbs `:76` M4 W12 / `:95` 单人 W14 | — | — | 单人未同步（P2-13） |
| 版本锚点 | PRD `:3` v1.1 | PRD `:28` v2 / `:81` v1.0 / `:92` v1.0 | README `:4` v1.1 | — | **冲突（P1-02）** |

---

## 7. 风险登记（按后果排序）

| 风险 | 触发条件 | 后果 | 等级 | 对应问题 |
|---|---|---|---|---|
| **验收不可判定** | 直接开工 | QA 无法出用例，工程师按各自理解实现，M2 验收会变成"扯皮会" | 高 | P0-01 |
| **鉴权返工** | 按 database.md 建表 | 登录查不到用户/重复注册，需改表+改加密方案+数据迁移 | 高 | P0-02 |
| **旗舰功能重做** | 分镜矩阵开发时 | 需给 tasks 加归属字段并回填，批量投递与断点续跑整体重写 | 高 | P0-03/04 |
| **Alpha 无法上线** | W9 | 邀请制无发码/核销/留资，G 组合规项缺项 | 高 | P0-05/07/08 |
| **指标体系失效** | Alpha 首周 | 北极星无法计算，"完集"定义与用户体验脱节 | 中高 | P0-06、P1-18 |
| **对账永远不平** | W4 起 | 冻结/解冻流水口径二义，`balance+frozen == Σflows` 无法成立，资金纠纷无法举证 | 高 | P0-09 |
| **资金/合规事故** | 上线后 | 积分过期无规则、支付路径未闭环、降级路径无 AI 标识 | 中高 | P1-11/15/20/23 |
| **联调阻塞** | W3 联调 | 字段名/错误码不一致，前后端各按一份文档实现 | 中 | P1-08/22/24 |
| **监控盲区** | 运营期 | 成功率 86~91% 长期不告警 | 中 | P1-17 |

---

## 8. 改进建议与行动顺序

### 第一阶段：D0~D+3（不开工，只定稿）

1. **关闭决策项**：域名/主体/编制/积分是否过期/Sentry 选型——五项由创始人拍板，写入 README 顶部（对应 P0-08、P1-11、P1-16）；
2. **PRD 自包含化**：消灭 7 处"同 v1.0"，补页面清单章节（P0-01、P1-13）；
3. **数据模型修订**：`identities` 双列（P0-02）、`tasks` 归属字段（P0-03）、幂等表（P0-04）、邀请码三表（P0-05）、流水账 `delta`/`frozen_delta` 双列（P0-09）；
4. **契约统一**：定妆图字段、refresh 载体（P0-10）、错误码段、分镜时长——四处一次性对齐文档与 `packages/shared`（P1-07/08/24）。

### 第二阶段：W1（与脚手架并行，不阻塞开工）

5. 补 `openapi.json` 与错误文案映射表（P2-18、缺失文档 2/5）；
6. 补 invitations/waitlist/export 三类端点与测试用例（P0-05、P1-12）；
7. 把合规硬项翻译成功能条目与验收标准（P1-14、P0-07）；
8. 旧蓝图加废弃横幅（P2-11）。

### 第三阶段：M1~M2（随里程碑对账会清理）

9. 引用漂移、数字口径、版本头统一（P2 全量 + P1-19）；
10. 建立"文档变更登记表"，把 README 维护规则 3 的"文档对账"落成可勾选清单。

---

## 9. 审查结论

- **完整性**：7 个域齐全、16 份文档成体系，明显优于同类项目"只有一份 PRD"的起点；但缺 8 类配套文档，其中"页面清单"与"OpenAPI 基线"属开工即用。
- **一致性**：任务状态机、部署拓扑、错误码分段设计三条主干自洽；计费两阶段**模型成立但记账口径未定**（P0-09）；其余问题集中在**版本演进留下的数字与引用漂移**（v1.1 改范围但未回写技术文档），属可批量修正。
- **准确性**：文档↔代码已有 4 处实质偏差（错误码、字段名、限额、环境变量），说明"文档即事实来源"的规则尚未落到 CI。
- **放行建议**：**Conditional Go** —— 完成第一阶段 4 项后即可开工 P0/P1 技术任务；`P0-05`（Alpha 运营）可延至 W2，但不得晚于 W6；`P0-07/P0-08` 属外部依赖，需 D0 立即启动。

---

## 附录 A：引用漂移与过时内容清单

| 位置 | 原文指向 | 实际内容 | 处置 |
|---|---|---|---|
| `adr.md:28` | api-spec §4 | mode 枚举在 §5 | 改锚点 |
| `adr.md:38` | PRD F5（冻结中文案） | 积分为 F6 | 改 F6 |
| `compliance.md:22` | MVP F6（AI 标识） | 内容安全为 F7 | 改 F7 |
| `conventions.md:11` | PRD §5 页面清单 | §5 是 Non-goals | 补页面清单文档 |
| `security.md:20` | api-spec §12（限流） | 限流在 §13，§12 是版本废弃 | 改 §13 |
| `README.md:11` | 三条核心旅程 | 实为四条 | 改四条 |
| `复刻蓝图.md` 全文 | v1.0 定稿 | 已被 docs/ 取代但未标注 | 加废弃横幅 |

## 附录 B：待决策事项（建议 D0 关闭）

| # | 决策项 | 影响面 | 建议选项 |
|---|---|---|---|
| 1 | 项目名称 / 域名 | 备案、落地页、品牌 | 3 日内定，优先 `.com` + `.cn` |
| 2 | 主体（个体/有限公司） | 支付、短信签名、备案 | 有限公司（支付与类目更顺） |
| 3 | 积分是否过期 | 计费模型、财务、退款 | Alpha 期永不过期，Beta 前再定批次 |
| 4 | Sentry 替代方案 | 可观测性、合规 gate | 国内 APM 或 self-host |
| 5 | 年龄门禁强度 | 合规、转化率 | Alpha 期"协议声明+留痕"最小实现 |
| 6 | 第三个适配器 | W2-3 工作量 | 百炼图像（补齐图生图能力） |
| 7 | 分镜时长档位 | 参数校验、批量投递成功率 | 对齐模型 `durations`（4/5/6/8/10），删去 2~3s |

---

*本报告基于 2026-10-24 仓库快照。文档修订后建议对 P0 项做一次 30 分钟复评。*
