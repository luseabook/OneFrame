# 一帧 OneFrame · 当前状态与「期望最终产品形态」差距（2026-10-26）

> 被评估版本：`git HEAD = 8e25f53`（2026-10-25T22:21:22+08:00，`main`）＋工作区 1 处未提交改动
> 评估时间：2026-10-26 00:30–00:55 (+08:00)｜方法：三路独立实测（门禁 / 代码声明 / 目标层与合规），Lead 复核并汇总
> 配套证据：`_acceptance/_gap/gate-verify-2026-10-26.md`（门禁实测）· `code-claims-verify-2026-10-26.md`（D1–D9 逐条）· `spec-ops-verify-2026-10-26.md`（F1–F10 / EXT / 运维）
> 上一版：`wanxing-gap-to-final-product-2026-10-25.md`（22:55；本版在其实测基础上**新增 8 条事实、修正 4 处口径**，见 §1.4 与 N8）

---

## 0. 一句话结论

**代码侧已经"像"这个产品了（20 页面 / 112 端点 / 29 表 / 参照产品 P1–P10 全部有对应实现），但三件事今天都不成立：**

1. **门禁不可复现**——裸跑 `pnpm -w test` **3/3 确定性红**（14/25 个 api suite 连不上库）；`lint`/`typecheck` 的"绿"是 turbo 缓存回放，本次**没有真正重跑**；且**本地 28 个提交根本没推上去**，README 上那枚"CI 绿"徽章描述的是 **19 小时前的旧提交**。
2. **收钱与出片都还是 mock**——仓库里**连一个 `.env` 都没有**（只有 `.example`），无任何真实供应商 Key / 商户号；8 条 P0 外部资质 **8/8 未启动**，起点 D0（主体/域名/编制）三项 checkbox 全未勾。
3. **Alpha 的核心产出做不出来**——Alpha 的交付物是"流水线漏斗卡点报告"，而**埋点体系与 SSE 命中数为 0**（无事件表、无上报端点、无 `EventSource`）。**就算明天开放注册，也只有 `task_events` 的服务端流水，观测不到任何客户端漏斗环节。**

差距分四类，必须分开看，否则会得出相反结论：

| 类型 | 性质 | 能否靠写代码解决 | 本轮判定的优先级 |
|---|---|---|---|
| **A 证据链与门禁** | 自评不可复现、交付基线失真 | 能，全部是**小时级**工作量 | **最高（先做）** |
| **B 上线硬门槛** | 8 条 P0 外部资质 + D0 决策 | 不能，靠行政/外部 | 最高（**周期最长，今天就要动**） |
| **C 真实化** | mock → real、静默降级口子 | 一半靠代码（部分已修到 P10），一半靠外部 Key | 高 |
| **D/E/F 形态覆盖** | 承诺内打折 / 路线图版本 / 复刻范围 | 靠排期与产品决策，**不是缺陷** | 中（Beta 后） |

---

## 1. 当前状态（实测，可复现）

### 1.1 版本、工作区、运行态

| 项 | 实测 |
|---|---|
| 本地 HEAD | `8e25f53` fix(worker): real 模式出站素材 URI 签名 + 公网可达守卫（P10）· 2026-10-25T22:21:22+08:00 |
| 远程 `origin/main` | **`116eac4`**（2026-10-25T03:19:57+08:00）→ **本地领先 28 个提交未推送**；`main` **未配置 upstream**（`git rev-parse @{u}` → fatal） |
| 远程 CI | GitHub Actions run #60（`116eac4`）success，created `2026-10-24T19:20:08Z`；**其后无任何 run**（API `actions/runs?branch=main`） |
| 未提交改动 | `M app/apps/web/components/Director3D.vue`（+261/−10）；`?? deliverables/software-company/wanxing-gap-to-final-product-2026-10-25.md` |
| 运行态 | api `127.0.0.1:3000`（`dist/main.js`）`/v1/healthz` → 200 `{db:up,redis:up}`，uptime ≈2.7h；web `127.0.0.1:3001`（`.output/server/index.mjs`）→ 200 |
| 配置 | 全仓**无任何真实 `.env`**（glob `app/**/.env*` 仅 5 个 `.example`）；PG 实际 `127.0.0.1:55432`、Redis `6380` |

### 1.2 门禁三态实测（2026-10-26 00:31–00:38）

| 命令 | 次数 | EXIT | 计数 | 结论 |
|---|---|---|---|---|
| `pnpm -w lint` | 1 | 0 | 6/6 tasks，**6 cached，33ms FULL TURBO** | 绿，但**是缓存回放**，未真正重跑 eslint |
| `pnpm -w typecheck` | 1 | 0 | 10/10 tasks，**10 cached，99ms FULL TURBO** | 同上 |
| `pnpm -w test`（裸跑） | **3** | **1 / 1 / 1** | 45 文件 = 30 passed / **14 failed** / 1 skipped；384 用例 = 247 passed / **137 skipped** / 0 failed | **红，3/3 完全一致 → 无抖动，是确定性红** |
| └ `@app/api` | 3 | 1/1/1 | `Test Files 14 failed \| 11 passed (25)`；`Tests 98 passed \| 136 skipped (234)` | 14 个 suite **加载即崩**（非断言失败） |
| 单跑 `test/billing.spec.ts` | 1 | 1 | `1 failed (1)`、8 skipped | 首行 `Error: connect ECONNREFUSED ::1:5432` @ `billing.spec.ts:45:22` |

**根因闭环**：`app/apps/api/src/config/env.ts:23-24` 默认 `DATABASE_URL=…localhost:5432/app`、`REDIS_URL=redis://localhost:6379`；而项目实例跑在 **55432/6380**（`Get-NetTCPConnection` 证实 5432/6379 无监听）。CI 能过是因为 CI 用默认端口，**开发机上标准命令不可复现**。

### 1.3 规模计数（本轮实测，命令见证据文件）

| 维度 | 实测 |
|---|---|
| web 页面路由 | **20** 个（含 `admin/*`、`share/[token]`、`projects/[id]` 两个动态段），无占位页 |
| `.vue` 体量 | 43 个文件；**物理行 17,457**，非空行 16,488（上一版写 16,488，口径=非空行） |
| API 端点 | **112**（`@Get|@Post|@Patch|@Delete|@Put`，全局前缀 `/v1`）；**17** 个 `@Controller` 类（15 文件） |
| 数据库 | **29** 张表 / **13** 个 migration（0000–0012）；schema = `app/packages/db/src/schema.ts` |
| 队列 | 声明 **6** 个，**仅 3 个有生产者**（gen.submit / export.zip / timeline.export） |
| 测试文件 | **45**（api 25 / worker 7 / adapters 7 / storage 3 / shared 2 / db 1 / **web 0**） |
| 参照产品复刻 | P1→P10 十期全部落地（工作台/资产/提取/生图/时间线/四模式/校验页/合成导出/3D/出站签名） |

### 1.4 本轮新增的 8 条事实（上一版报告没有）

| # | 事实 | 证据 |
|---|---|---|
| N1 | **28 个提交未推送**，`main` 无 upstream；CI 徽章描述旧提交 `116eac4` | `git for-each-ref`；GitHub Actions API |
| N2 | `lint`/`typecheck` 的绿**只是 turbo 缓存回放**（本次未做 `--force`） | `gate-verify §1` |
| N3 | **示例环境文件恰好就是危险组合**：`.env.production.example:38-39` = `LLM_MODE=real` + `DEEPSEEK_API_KEY=`（空）；api 生产守卫 `env.ts:222-257` **无任何 LLM 分支** → 生产**静默输出 mock 文案且不报错**（`llm.service.ts:68-75,78-92` 五处 `if (!this.deepseek)` 直接返回 mock） | `code-claims-verify D2` |
| N4 | **F1 行为验证码链路 0 实现**：PRD:38 要求频控返 `429101`，`CAPTCHA_REQUIRED=429101`（`packages/shared/src/errors.ts:22`）**全仓无调用点**（只有错误码单测引用），实际返 `RATE_LIMITED=429100` | `spec-ops-verify §1`；Lead 复核 grep |
| N5 | 死队列的**注释与实现不符**：`queues.ts:4` 写"delayed job（5s 起指数退避 ≤30s）"，实际是 `executor.ts:290-317` 的 job 内 `for(;;)+sleep`，**单 job 最长占 120s 并发槽**、`attempts:1`、并发默认 5 | `code-claims-verify D3` |
| N6 | **标识链路两条策略不一致**：任务结果缺 ffmpeg → 静默降级只写 `explicit_reason`（`label.ts:83-85`）；成片合成缺 ffmpeg → 硬失败 status 4（`timeline-export.ts:333-344`） | `code-claims-verify D9` |
| N7 | web 的 `test` 是 `echo … && exit 0`，被根 `test: turbo run test` **计入"测试通过"**，抬高整体通过率 | `code-claims-verify D1` |
| N8 | 上一版 3 处口径/行号修正：`.vue` 16,488=非空行；`sentry` **1 处命中**（`request-log.ts:19` 注释，无 SDK/DSN，"无埋点"结论不变）；守卫函数实为 `env.ts:222-257` | `code-claims-verify §3` |

---

## 2. 「期望的最终产品形态」到底是哪一层

项目里"最终形态"有三个互不相同的答案，混在一起谈就会各说各话。

| 层 | 定义 | 出处 | 当前完成度 |
|---|---|---|---|
| **① 竞品形态（全量参照）** | ReelMate：短剧工作流 / 无限画布 / 剧本创作 / 创作 Agent(SSE) / 20+ 单点工具 / 团队 / 影视版 / MCP&CLI / 广场与市场 / 活动裂变……去 i18n 前缀 **928 条路由**、`/web/v1` ≈700 端点、46 模型 | `rea-reelmate/REELMATE-逆向分析报告.md:25-42,126,333-334` | 结构性覆盖约 6 个主页面族；工具矩阵/画布/团队/市场/CLI 等**明确列为我方 Non-goals** |
| **② 我方本期承诺（F1–F10 + 版本路线）** | v1.0 = F1 账号 / F2 剧本流水线（旗舰，七环节）/ F3 工具箱 2 入口 / F4 任务 / F5 资产 / F6 积分 / F7 内容安全 / F8 管理后台 / F9 作品库 / F10 新手引导；v1.1 合成+可灵·Vidu+TTS+BYOK+模板；v1.5 画布；v2.0 团队/剪辑器/市场/开放 API | `docs/01-product/PRD.md:34-206,208-214,216-223`；`wbs.md:110-116` | F1–F10 **代码侧均有对应端点/页面**（逐条见 `spec-ops-verify §1`），但 **F1 有实质缺口（N4）**、F2 的 SSE/埋点/K6 三项 DoD 未做 |
| **③ 上线合规形态（LAUNCH gate）** | P0 = 缺一项即不得对外开放注册/生成/支付：EXT-01 主体 / 02 域名实名 / 03 ICP / 05 公安 / 06 生成式 AI 备案 / 07 深度合成 / 08 供应商模型备案 / 15 协议律师审阅 | `docs/06-security-compliance/launch-checklist.md:18,34-48`；`docs/README.md:99-101` | **8/8 全部 ⏳**；代码侧 66 项/25 项验收与 EXT **零交集** |

> ⚠️ 本项目"复刻"的目标**不等于** ①。`reference-alignment-spec.md:913,929` 明确写 11 个无截图路由"**不做臆造，必须重新抓图**"；PRD:208-214 把 ① 的大部分列为 Non-goals。下面的差距要按"对哪一层"来读。

---

## 3. 差距矩阵

### A｜证据链与门禁（**先做，全部是小时级**）

| # | 差距 | 证据 | 影响 |
|---|---|---|---|
| A1 | 裸跑 `pnpm -w test` **确定性红**（3/3），根因是 `env.ts:23-24` 默认端口 5432/6379 | `gate-verify §1,§4-§6` | 标准命令在开发机不可复现，"测试全绿"的说法站不住 |
| A2 | `lint`/`typecheck` 的绿**只是缓存回放**，未真正重跑 | `gate-verify §2` | 门禁证据强度不足 |
| A3 | **web 零静态门禁**：无 `lint`/`typecheck`，`test` 是恒真 no-op；43 个 `.vue`/17,457 行不进门禁 | `app/apps/web/package.json:5-11` | 前端回归只能靠人肉截图；no-op 还抬高通过率 |
| A4 | **28 个提交未推送 + 无 upstream**，CI 徽章是 19 小时前的旧提交 | `git for-each-ref`；Actions API | 对外可查的"绿"与当前代码**不是同一个东西** |
| A5 | README「当前 25/25 项通过」证据是 `2026-10-25T15:08:13`，比 HEAD 早 **7h13m**，中间隔 4~5 个 feat/fix | `README.md:61`；`_acceptance/b-type-acceptance-run.log:3`；`spec-ops-verify §3` | 交付基线失真 |
| A6 | 工作区有未提交的 `Director3D.vue`（+261/−10） | `git status` | 3D 结论对工作区成立，对任何已提交版本不必然成立 |
| A7 | 探针/成片证据未落盘；样例 `timeline-export-sample.mp4` 经像素分析是 lavfi 纯色板（**上一版结论，本轮未复核**） | 上一版 G0-6 | "成片真实"仍无证据 |

### B｜上线硬门槛（**外部，链条一环未启动**）

| # | 差距 | 证据 | 影响 |
|---|---|---|---|
| B1 | **D0 三项未决策**：项目名称/域名、主体公司、团队编制，checkbox 全未勾 | `docs/README.md:99-101`；`wbs.md:17`（0.5 任务被 D0 直接锁死） | 决定**整条链是否启动** |
| B2 | 8 条 P0 外部资质 **8/8 ⏳**；整个 EXT-01~20 表全 ⏳ | `launch-checklist.md:34-48` | Alpha 开放注册的前置 |
| B3 | 最长依赖链：**D0 → EXT-01 营业执照 → EXT-02 域名实名 → EXT-03 ICP → EXT-06/07 AI 双备案 → Alpha**（`wbs.md:121` 记 2~6 周）；支链 EXT-03 → EXT-10 微信商户号 → EXT-16 类目 | `spec-ops-verify §1-2` | Beta 收款按此倒排 |
| B4 | 内容安全词库**仅 8 词**（要求 ≥5000）；ICP 备案号仍是占位串（实际位置 `apps/web/pages/index.vue:187`，checklist:182 引 182） | `launch-checklist.md:179,182`；`moderation.service.ts:7-16` | P0/P1 阻断项 |
| B5 | 上线前 72h 演练 D1–D9：仅 D1/D2/D5 有脚本，**D3/D4/D6/D7/D8 无脚本无回执** | `deployment.md:256-271`；`spec-ops-verify §4` | Beta 前置 |

### C｜真实化（mock → real 的剩余口子）

| # | 差距 | 证据 | 影响 |
|---|---|---|---|
| C1 | **无任何真实 Key / 无 `.env`**，全链路 mock；`STORAGE_S3_*` 公网桶为真实模式前置 | glob `app/**/.env*`；`gate-verify`；上一版 G2-1 | 出片内容真实性**从未被端到端证明** |
| C2 | **LLM 真实模式静默降级**（N3）：`LLM_MODE=real` + 无 Key → 回落确定性 mock 且不报错；api 守卫不覆盖，与 worker"缺 Key 硬失败"策略冲突；**示例环境文件正是这个组合** | `llm.service.ts:68-75`；`env.ts:222-257`；`.env.production.example:38-39` | **生产静默出假内容**，性质等同 worker 明令禁止的"假生成" |
| C3 | 3 个队列是死声明；轮询在 job 内 `for+sleep` 最长 120s、并发 5、`attempts:1`（N5） | `main.ts:229-230`；`executor.ts:290-317` | 批量投递（F2 旗舰路径）在 Alpha 并发下会先撞并发墙；重启丢轮询进度 |
| C4 | 支付通道未配置（`PAYMENT_LIVE=false`、微信 `configured=false`），回调默认 401（行为正确） | `b-type-acceptance-run.log:39` | 真实收款未验证 |
| C5 | 生产部署摩擦：`docker-compose.prod.yml:119` 默认 `ADAPTER_MODE=mock`，而 worker 守卫 `env-guard.ts:29-34` 拒绝 mock → 不显式设该变量 **worker 起不来**；docker 路径本机**无 docker CLI，未验证** | `code-claims-verify D8` | 部署可重复性未证实 |
| C6 | ffmpeg/ffprobe 是宿主依赖；标识链路缺 ffmpeg 时**静默降级为仅隐式**（N6） | `label.ts:70-89` | 合规标识可能静默缺失（仅留 `explicit_reason` 痕） |

### D｜v1.0 承诺内未落地或打折

| # | 差距 | 目标出处 | 现状 |
|---|---|---|---|
| D1 | **SSE 任务推送完全不存在**（WBS P2.4"双通道可切换"） | `wbs.md:59` | `event-stream`/`EventSource`/`@Sse` **0 命中**；进度全靠 17 处 `setInterval` |
| D2 | **埋点体系完全不存在**（metrics.md §3 约 28 个事件 + §5 批量上报端点） | `metrics.md:31-54,64`；`wbs.md:60` | `analytics`/`sendBeacon`/`/v1/events` **0 命中**；无 events 表。→ **Alpha 的核心产出（漏斗卡点报告）目前没有数据源**；管理后台漏斗改从 `task_events`/`credit_flows` 聚合，缺客户端环节 |
| D3 | **k6 压测未做**（轮询风暴/批量投递尖峰/worker 恢复） | `wbs.md:61` | 无任何压测脚本；"轮询 P95<200ms""api P95≤500ms"未测 |
| D4 | Prompt 工程专项未冻结（10 部样例回归集、输出 Schema 零解析失败） | `wbs.md:57`；`wbs.md:124` 列为 v1.1 最大产品风险 | 无回归集产物 |
| D5 | **F1 行为验证码挑战未实现**（N4） | `PRD.md:38` | 频控返 429100，`429101` 无调用点 |
| D6 | 图生视频首帧非 OSS 直传、无进度条 | `PRD.md:80` | 沿用上一版结论（本轮未复核） |
| D7 | 文档内部冲突未收敛：示例作品规模 PRD=2 集/2 角色/0 分镜 vs 增补=3 集/3 角色/10 分镜；"已成片"口径二次冲突 | `PRD.md:197` vs `PRD-supplement…:89` | **代码按 PRD 实现**（`auth.service.ts:44-90`）→ 代码对、文档需改 |
| D8 | 无 APM/告警通道；镜像偏大（api 849MB / worker 1.67GB / web 330MB） | `FINAL-DELIVERY-2026-10-25.md:103-113` | Beta 前需处理 |

### E｜路线图版本承诺

| 版本 | 承诺 | 现状 |
|---|---|---|
| v1.1 | 成片自动合成（拼接 **+BGM+字幕烧制**）、可灵/Vidu 适配器、TTS 配音、BYOK、模板 v0（5 个官方模板） | **只做了** 拼接+统一分辨率帧率+水印+时间线（P7/P4.1）；**BGM/字幕/转场/音轨/多轨/拖动排序、可灵/Vidu、TTS、BYOK、模板全部未做**（现有 real 适配器 = Ark 视频 + Ark 图像 + 通用 HTTP + DeepSeek） |
| v1.5 | 无限画布 X6（script/asset/storyboard 节点、Agent 铺画布、协作锁）；**启动门槛：画布使用率 >30%** | **完成度 0**：设计文档 4 张 `canvas*` 表（`database.md:481-499`）在 29 表中**完全不存在**（`packages/db` 全目录 `canvas` 0 命中） |
| v2.0 | 团队空间 / 剪辑器 / 模板市场 / 开放 API | 无（侧栏"团队管理""影视版"为置灰 span）；且 **v2.0 只在 `PRD.md:223` 出现一行，wbs 无对应章节** |

### F｜形态覆盖（**需产品决策，不是缺陷**）

参照产品有、我方列为 Non-goal：20+ 单点工具、剧本广场/小说市场、影视版协作、MCP & CLI、创作者中心/兑换码/邀请奖励、广告剧、视频转绘、对话式创作 Agent(SSE)。

**要决策的是**：`reference-alignment-spec.md:913,929` 指出 **11 个页面无证据、必须先补抓图**才能做结构级复刻，另有 7 项逐页取证缺口（`reference-reelflow-spec.md:188-196`）。若目标是"看起来就是同一个产品"，这是**最大的可见差距**；若目标是"自己的 A 型自助 SaaS"，它是差异化空间（PRD:26-30 已写明差异化路径）。

---

## 4. 建议的收口顺序

### 48 小时内（把"可信基线"找回来，成本最低收益最大）

1. **修 env 默认端口**（`app/apps/api/src/config/env.ts:23-24` 或让 spec 自带 `?? 55432/6380`）→ 裸跑 `pnpm -w test` 转绿；顺手确认注入 env 后是否只剩 `project-assets.spec.ts` 的偶发。
2. **`--force` 重跑一次 lint/typecheck**，拿到非缓存的绿。
3. **给 web 补 `lint`/`typecheck`**，删掉恒真的 `test` 占位（或明确标注"web 无测试门禁"）。
4. **推送 28 个提交**并给 `main` 配 upstream，让 CI 对当前代码出一次结论。
5. **改 README 的"25/25"** 为带日期的版本引用；**提交或回退** `Director3D.vue` 的 261 行改动。
6. **修 `llm.service.ts:68-75` 的静默降级**（`LLM_MODE=real` 且无 Key ⇒ 启动即失败，与 worker `env-guard.ts` 对齐）；同时把 `.env.production.example:38-39` 改成不会踩坑的示例。

### 2 周内（产品可信度）

7. **埋点最小闭环**：先落 metrics.md §3 的漏斗 9 环 + 北极星 `episode_completed` 的事件表与批量上报端点——**否则 Alpha 无从观测，卡点报告交不出来**（D2 是本阶段最贵的缺口）。
8. **真实链路一次**：至少接一家 Ark（视频）+ DeepSeek，跑通真实出片，产出"真实成片"证据（像素/元数据/水印抽验留档）。
9. 处理 3 个死队列（删声明或补生产者），把轮询改成 delayed job，释放并发槽。
10. **补 F1 验证码挑战**（429101 调用点）——它是 PRD F1 的验收项，也是防刷的唯一手段。

### 30 天内（Beta 前置）

11. 按 **D0 → EXT-01 → 02 → 03 → 05** 最短链推进，并行启动周期最长的 EXT-06/07/15；商户号留 2 周缓冲。
12. **执行 72h 演练 D3/D4/D6/D7/D8**（回调失败、对账补账、容量、值班、未成年人退款）。
13. SSE 推送（P2.4）+ k6 压测（P2.6）。
14. 词库采购到 ≥5000 词；6 个月归档（CODE-H3）。

### Beta 后（形态扩张）

15. v1.1：BGM/字幕/转场 → 可灵/Vidu → TTS → BYOK → 模板 v0。
16. 若走"1:1 复刻"：先**补抓图**（11 个无证据页 + 7 项取证缺口），再做结构级复刻；否则按 PRD Non-goals 维持差异化。
17. v1.5 画布：先落 4 张 `canvas*` 表，并等"画布使用率 >30%"的启动门槛数据。

---

## 5. 需要你（Owner）拍板的三件事

| # | 决策 | 为什么它卡着别人 |
|---|---|---|
| Q1 | **D0：主体公司（个体/有限）、项目名称与域名、团队编制** | 三项未勾 ⇒ 备案链**一环未启动**（B1/B3）。这是整份报告里**唯一用钱也买不到时间**的项，周期 2~6 周，越晚越贵 |
| Q2 | **路线：A 型差异化 vs 1:1 复刻** | 决定 F 类差距是"欠债"还是"设计"。若选复刻，下一步不是写码而是**补抓 11 个页面的图** |
| Q3 | **是否授权用真实 Key 试跑一次**（Ark / DeepSeek，最小额度） | 这是把"C1 出片真实性从未证明"变成"已证明"的唯一动作；否则所有成片证据都停留在 mock 路径 |

---

## 6. 诚实边界（本次**没有**验证的）

| 项 | 原因 |
|---|---|
| 注入 `DATABASE_URL`/`REDIS_URL` 后测试是否转绿 | 本轮按要求只做裸跑；**不得**把"注入后大概能过"当绿灯 |
| `lint`/`typecheck` 无缓存（`--force`）结果 | 未重跑 |
| docker/compose 部署路径 | 本机无 docker CLI |
| 真实供应商出片 / 真实支付回调 | 无任何外部 Key 与商户号，且不得发起外部付费调用 |
| 3D 画面的视觉正确性 | 只能做静态代码与像素统计层面的判断 |
| 上一版报告 16 条声明中的其余条目（成片像素分析、`project-assets.spec.ts` 偶发根因、docker 守卫运行期形态等） | 本轮只复核了 **门禁 + D1–D9 + 目标层/合规层**；未复核者一律按"上一版结论"标注，不代表已独立证实 |

> 本报告对"目标要求"的引用均来自仓库内文档（`文件:行`）；对"现状"的引用来自三份实测证据文件与本轮 Lead 复核（`git`、`Get-NetTCPConnection`、`Invoke-WebRequest`、GitHub Actions API）。

---

## 附：证据文件

| 文件 | 内容 |
|---|---|
| `_acceptance/_gap/gate-verify-2026-10-26.md` | 裸跑三态、3 次重复、单文件复跑、env 默认值、端口实测 |
| `_acceptance/_gap/code-claims-verify-2026-10-26.md` | D1–D9 逐条证实/推翻、可复现命令、与上一版 4 处差异、8 条新增事实 |
| `_acceptance/_gap/spec-ops-verify-2026-10-26.md` | 三层目标基线、F1–F10 对照、EXT P0 状态、D0、D1–D9 演练、文档冲突 |
| `_acceptance/_gap/target-spec.md` / `impl-state.md` / `runtime-verification.md` | 上一轮（2026-10-25 22:40–22:50）的基线三件套 |
| `deliverables/software-company/wanxing-gap-to-final-product-2026-10-25.md` | 上一版差距报告（本版为其增量修订） |
