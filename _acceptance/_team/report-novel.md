# 第 2 批 · 小说改编链（novel 域）交付报告

> 执行人：teammate `novel-api` · 任务：`task-2`（权重 8）
> 对照基线：`docs/07-plan/completion-plan-to-100.md:85-141` §3、`rea-reelmate/routes.txt:515-600`、`cmd/novel.md`
> 日期：2026-10-27

---

## 1. 交付

### 1.1 端点：**64 条路由**（`/v1/novel/*`）

前缀决策：竞品是 `/web/v1/df/novel/*`；按 **ADR-009**（`_acceptance/_gap/f1-domain-contract-overview.md:37-40`：`df` 域不整体照搬，拆成 `script` / `canvas` / `novel`），并由既有 `canvas` 控制器（竞品 `df/canvas` → 我方 `/v1/canvas`）的同类归一做法，落到 `/v1/novel/*`。子路径保持竞品形状，便于逐条核对。

**主链 37 条**（`apps/api/src/modules/novel/novel.controller.ts`）

| 子链 | 路由 |
|---|---|
| 本子 CRUD | `POST /novel`、`GET /novel/list`、`GET /novel/:nt`、`PATCH /novel/:nt`、`DELETE /novel/:nt`（归档） |
| 1 分章解析 | `POST /novel/:nt/split`、`GET /novel/:nt/chapters`、`GET /novel/:nt/chapters/:chapter_no` |
| 2 内容分析 | `POST /novel/:nt/content-analysis`、`GET .../content-analysis/detail`、`GET .../worldview`、`PUT .../worldview`、`POST .../novel_character_cards/generate`、`POST .../novel_character_cards/confirm`、`POST .../novel_character_cards`、`PATCH .../novel_character_cards/:ncc_id`、`DELETE .../novel_character_cards/:ncc_id` |
| 3 章节大纲 | `POST /novel/:nt/chapter_outline/generate`、`GET .../list`、`POST /novel/:nt/chapter_outline`、`PATCH .../:nco_id` |
| 4 分集大纲 | `POST /novel/:nt/episode_outline/generate`、`GET .../list`、`POST /novel/:nt/episode_outline`、`PATCH .../:neo_id` |
| 5 核心角色 | `POST /novel/:nt/core_character/generate`、`GET .../list`、`POST /novel/:nt/core_character`、`PATCH .../:ncc_id` |
| 6 剧本生成 | `POST /novel/:nt/script-generate`、`GET /novel/:nt/episode/list`、`GET .../episode/:ne_id`、`PATCH .../episode/:ne_id`、`POST .../episode/:ne_id/confirm` |
| 汇总/定稿/版本 | `GET /novel/:nt/summary`、`POST /novel/:nt/finalize`、`GET /novel/:nt/version/list` |

**7 剧本编辑 Agent 16 条**（`novel-agent.controller.ts`，语义 13 项）

`POST .../script_edit_agent/enter`、`/exit`、`/heartbeat`、`GET /sessions`、`POST /sessions`、`POST /sessions/switch`、`GET /sessions/:sid`、`POST /sessions/:sid/chat`、`POST /sessions/:sid/abort`、`GET /sessions/:sid/episodes/:ne_id/pending`、`POST .../apply`、`POST .../reject`、`POST /sessions/:sid/apply_all`、`POST /sessions/:sid/reject_all`、`POST .../version/:vid/finalize`、`DELETE .../version/:vid/delete`

**8 创意裂变 9 条**：`POST /novel/:nt/fission_script`、`GET .../idea`、`POST .../idea/select-op`、`GET/POST .../characters`、`POST .../summary_outline`、`GET/POST .../episodes_outline`、`POST .../episodes`
**9 海外改编 2 条**：`POST /novel/:nt/overseas`、`GET /novel/:nt/overseas`

**10 与制片工坊衔接**：`NovelService.assertSplittable(spaceId, ntId)` 已按 Lead 追加契约实现并在 `NovelModule.exports` 导出（`asset-core` 可直接注入）；`split` 侧由 asset-core 负责（其 `script.controller.ts` 的 `splitWithSourceSchema` 已就绪）。

### 1.2 前端页面

| 路由 | 文件 | 状态 |
|---|---|---|
| `/novel` 列表 | `apps/web/pages/novel/index.vue` | ✅ 空/加载/错误三态；粘贴 + 上传（txt/md/docx，复用 `/projects/parse-script`）；tab 全部/草稿/已定稿/已归档 |
| `/novel/[id]` 工作台 | `apps/web/pages/novel/[id].vue` | ✅ 步进器 + 7 个 tab（章节/内容分析/章节大纲/分集大纲/核心角色/分集剧本/编辑 Agent），逐项可编辑可保存 |
| 步进器 | `components/novel/NovelStepper.vue` | ✅ 七步进度 + 未完成项待办文案 + 点击跳 tab |
| 逐集 diff 对照 | `components/novel/NovelPendingDiff.vue` | ✅ 原文/建议文双栏 + 变更说明 + 逐集 apply/reject |
| 编辑 Agent 面板 | `components/novel/NovelAgentChat.vue` | ✅ enter/exit/heartbeat(30s)/chat/逐集与批量决定/abort，746005 与 400100 显式展示 |
| 类型 | `apps/web/types/api.ts`（文件末尾追加 20 个 novel 类型） | ✅ 未改动他人已追加内容 |

### 1.3 测试

`apps/api/test/novel.spec.ts` —— **25 例，全绿**（真实 PG + 真实 AppModule，e2e 风格与 `test/kds.spec.ts` 一致）。

实测输出（`cd app/apps/api; npx vitest run test/novel.spec.ts`）：

```
 ✓ test/novel.spec.ts (25 tests) 1045ms
 Test Files  1 passed (1)
      Tests  25 passed (25)
```

覆盖矩阵（每例注释里写了"为什么这么断言"）：创建/同名冲突/空 title、列表+搜索+分页校验、详情/章节列表/单章、重新分章幂等（id 稳定）、内容分析（含关系边不自指、重跑不产生重复卡）、世界观 GET/PUT、角色卡 CRUD+重生成+confirm(overwrite=false 跳过)、章节大纲（生成/编辑/整体替换+删多余）、分集大纲、核心角色（is_core 自动标记）、剧本生成（缺席回显/非法集号 400101/空数组 400101）、单集 PATCH 产生新版本、确认幂等、summary 步进、finalize→16 + 重放幂等、**定稿后 4 类写操作全被拒**、`assertSplittable` 三态（400100/403101/400102）、跨 space 403（5 条路由）+ 非法 id 400101 + 未登录 401101、编辑 Agent 全链（enter 幂等/heartbeat/会话 CRUD/switch/详情/chat 逐集 diff 三件套/chat 不改正文/apply 写正文+落版本/重复 apply 746002/reject 正文零改动/apply_all 与 reject_all/abort 显式回显/version finalize 幂等 + delete）、**同会话并发 chat 一成一败(746005)**、exit 作废未确认 diff + 退出后 chat 400100、裂变 9 端点全通（含"未选方案就生成总纲 400101"顺序闸门）、海外 2 端点（幂等键 = 源本+lang+region）、归档/取消归档。

### 1.4 端到端脚本

`_acceptance/e2e-novel.cjs`（真实 HTTP + 真实浏览器，照 `e2e-team.cjs` 的 harness；把 `**/v1/**` 拦截改写到指定 API 实例，使共享 web 也能打到源码实例的 novel API）。

实测：**API 段 41/41 PASS**（`_acceptance/novel-e2e/result.json`），关键行：

```
PASS POST /novel 创建本子        {"id":"108359656...","status":1}
PASS 创建即分章 = 3 章           chapter_count=3
PASS 同名 400100（幂等/冲突语义）  code=400100
PASS POST content-analysis       era=架空仙侠世界，九洲灵脉渐次枯竭
PASS POST sessions/:sid/chat 产出逐集 diff  pending=2
     └ diff ep1: original 197 字 / proposed 265 字 / 按"把第 1 集结尾改成悲剧结局"调整本集：补对手戏、补动机
PASS chat 不改正文（apply 前原文不变）  version=1
PASS POST apply 写正文 + 落版本    version=2
PASS 重复 apply → 746002（不重写正文） code=746002
PASS POST reject 只改 pending、正文不动   version=2
PASS POST finalize → status=16      snapshot=108359656597045248
PASS 定稿后写正文被拒（400100）     code=400100
PASS overseas 幂等（replayed）
PASS 跨 space → 403101
```

**浏览器段 10/10 PASS**（真实 chromium + 真实登录页 + 真实 API，`/v1/**` 拦截改写到源码实例）：

```
PASS 登录页拿到开发环境验证码 — 482844
PASS 浏览器登录成功（离开 /login） — http://127.0.0.1:3003/home
PASS GET /novel 空态渲染（「剧本工厂」+「还没有剧本项目」）
PASS 创建后跳到工作台 /novel/:id — http://127.0.0.1:3003/novel/108361245378428928
PASS 工作台渲染步进器（分章/内容分析/定稿）
PASS 粘贴即分章：章节列表出现第 1 章
PASS 工作台为草稿态（status=1）
PASS 内容分析后出现世界观与角色卡
PASS 编辑 Agent tab 可打开（含「进入编辑态」）
PASS 进入编辑态后出现会话与待确认面板
PASS 浏览器控制台无报错

=== 51/51 PASS ===
```

截图（`_acceptance/novel-e2e/`）：`01-novel-list-empty.png`（空态）、`02-novel-workbench.png`（步进器 + 章节目录 + 正文）、`03-novel-analysis.png`（世界观/角色卡）、`04-novel-agent.png`（编辑 Agent 会话 + 逐集待确认面板）。`result.json` 为逐条断言结果。

> 过程中踩到一次环境坑并已解决（留档备查）：共享 web dev 若在 `pages/novel/` 创建**之前**启动，Nuxt 不会为新增 pages 子目录补路由（实测 `GET /novel` → 404 `Page not found`，`stack-web.log` 反复 `No match found`）。重启 web dev 后即恢复；脚本本身无需改动。
---

## 2. 证据

| 交付项 | 竞品证据 |
|---|---|
| 链序（分章→分析→章纲→集纲→角色→剧本→编辑 Agent→定稿） | `docs/01-product/reelmate-feature-map.md:261`；`docs/07-plan/completion-plan-to-100.md:89-103`；`rea-reelmate/routes.txt:515-580` |
| 剧本编辑 Agent 13 语义端点 / 16 路由（enter, exit, heartbeat, sessions CRUD, switch, chat, abort, pending, apply, reject, apply_all, reject_all, version finalize/delete） | `rea-reelmate/routes.txt:570-600`；`docs/07-plan/completion-plan-to-100.md:105-132` |
| pending 是**逐集 diff**（原文/建议文/变更说明），不是整篇重写 | `docs/07-plan/completion-plan-to-100.md:129`；schema 设计 `packages/db/src/schema.ts:1546-1552` |
| apply 写正文 + 落版本；finalize 后 status=16 才能作拆集源 | `docs/07-plan/completion-plan-to-100.md:130-132,138`；`cli-skill/commands/novel.md:663-683`（`novel finalize` = 状态 16）、`:300-347`（derive 只接受已定稿源） |
| 同名剧本冲突（竞品 748201） | `cli-skill/commands/novel.md:706` |
| 删除不可恢复 → 我方改归档（保留可追溯） | `cli-skill/commands/novel.md:728-730` |
| 上传即拆解（analyze 入口 task_type=4） | `cli-skill/commands/novel.md:240-259` |
| 核心角色 = 从角色卡中挑（不是另一套角色） | `cli-skill/commands/novel.md:482-502`；`routes.txt:523-525` |
| 裂变顺序闸门（选定方案后才能生成角色/总纲） | `cli-skill/commands/novel.md:437-455,482-486` |
| 海外改编入口 + 目标语言/区域语义 | `cli-skill/commands/novel.md:349-374` |
| 8 个固定产出配置项（`ai_noval_overseas_adaptation` 等） | `cli-skill/commands/novel.md:59-82`（我方用 `meta` 承接自由字段，见 §3） |

---

## 3. 已知偏离 / 待取证

1. **路由前缀 `/v1/novel/*` 而非 `/v1/df/novel/*`**：依据 ADR-009（`df` 域拆分）与 `canvas` 既有归一做法；子路径与竞品一致，便于逐条核对。
2. **`fission_script/create` 挂在本子级**（`POST /novel/:nt/fission_script`）而不是竞品的集合级（`POST /df/novel/fission_script/create`）：来源是必填语义，放集合级会让来源在两处都能指定。
3. **`novels.meta` 承接三个自由字段**（数据层不多建表）：`source_text`（原文副本，因 `novels` 无该列而分章需要它）、`fission.*`（创意方案/总纲，第 2 批数据层未给表）、`overseas.*`（幂等键 + 语言/区域）。均为 jsonb 自由字段的正当用途，但**未取证竞品同名结构**，属我方实现细节。
4. **删除 = 归档**（软删），未做物理删除：定稿本子可能被剧集引用，硬删会留悬空来源。竞品是硬删不可恢复 → 已登记，需要时再加 `purge`。
5. **撤回定稿（reopen）未实现**：定稿后写正文一律 400100。竞品有 `version restore`，我方只做了 `version/:vid/finalize|delete`。**这是已知能力缺口**（见 §6）。
6. **`reject` 的 reason 不落库**：`novel_edit_pendings` 无 reason 列（不改 schema），原因落 `novel_edit_sessions.context.decisions[]`（审计用途，上限 50 条）。响应里原样回显。
7. **`abort` 无在途轮次时返回 `aborted:false, reason:"no_turn_in_flight"`（code 0）**，而不是错误码：这是"明确告知没有东西被中止"，不是静默成功。真正需要状态码的并发场景走 746005（`AGENT_TURN_IN_FLIGHT`，与 `agent` 域同码）。
8. **`GET .../episodes/:eid/pending` 无未决 diff 时返回 `{pending:null}`（不是 404）**：前端不该把"这集没事"渲染成错误。
9. **`original_script/*`（14 端点）与 `point/permission/group/adjust/import`（8 端点）不在本批必做子链内**（task-2 §必做子链 1→10 未列），未实现。
10. **未取证项**：竞品 `content-analysis` 的具体响应字段名、`heartbeat` 的 body 形状、`sessions/switch` 的 body 形状 —— 我方按合理语义自定（`dirty`、`session_id`），已在 schema 注释标注。
11. **mock 确定性**：无 Key 时全部步骤输出由"内容文本稳定哈希 → 固定候选池"派生，同输入同输出；真实模式走既有 `DeepSeekChatAdapter`（复用 `@app/model-adapters`，未新建 HTTP 客户端），输出经共享 `*ResultSchema` 强约束，schema 不符抛 745900。

---

## 4. 顺手发现的问题（未擅自修）

1. `apps/api/src/modules/script/asset-match.service.ts:373` —— `'kind' is assigned a value but never used`，导致 `pnpm --filter @app/api lint` 非 0（**asset-core 的文件**）。
2. **全队踩坑（已告知 Lead）**：本仓库 e2e 走 esbuild，**不实现 `emitDecoratorMetadata`**，Nest 构造函数必须显式 `@Inject(...)`；隐式类型注入在测试里拿到 `undefined`（表现为全端点 500）。我最初三个 service 踩过，已改。
3. 共享栈 `:3002` 跑的是 `node dist/main.js`（编译产物），novel 模块落地前构建 → `GET /v1/novel/list` 返回 400102。需要重建 dist，或按 §5 用源码实例（`:3102`）。

---

## 5. 需要 Lead 做

1. **`apps/web/nuxt.config.ts` 的 `routeRules` 追加两条**（我不能改公共文件）：
   ```ts
   "/novel": { ssr: false },
   "/novel/**": { ssr: false },
   ```
2. **`apps/web/layouts/app.vue` 侧栏加入口**（建议放在「剪辑台」附近）：`/novel` → 「剧本工厂」。
3. **web dev 已重启过，`/novel` 现在可访问**（我实测 51/51 PASS）。但请留意：以后**新增 pages 子目录后必须重启 web dev**（Nuxt 启动后不补路由）。复跑验收的命令：
   ```powershell
   # 一、起一个跑源码的 API（：3102，源码实例，novel 端点只在源码/新 dist 里）
   cd E:\wanxing\app\apps\api; $env:PORT="3102"; $env:DATABASE_URL="postgres://app:app@127.0.0.1:55432/app";
   $env:REDIS_URL="redis://127.0.0.1:6380"; $env:LLM_MODE="mock"; $env:SMS_IP_HOURLY_LIMIT="1000000"; npx tsx src/main.ts
   # 二、跑验收（浏览器段默认打 :3003，`/v1/**` 会被拦截改写到 :3102）
   cd E:\wanxing; node _acceptance/e2e-novel.cjs
   # 只跑 API 段：WEB=skip node _acceptance/e2e-novel.cjs
   ```
4. **重建 API dist**（重启共享栈前）：共享 `:3002` 跑的是 `node dist/main.js`，是 novel 模块落地前的构建，`:3002` 上 novel 端点仍会 400102。
5. 告知 `asset-core`：`NovelModule` 已 `exports: [NovelService]`，`assertSplittable(spaceId, ntId)` 可用；错误码：**未定稿 = `400100 BAD_REQUEST` + `details.reason="not_finalized"`**、跨 space = `403101`、本子不存在 = `400102`；返回 `{ title, sourceText, episodeCount, episodeScripts:[{epNo,title,text}] }`。

---

## 6. 未完成（诚实清单）

1. ~~页面浏览器验收未跑通~~ → **已跑通**：`node _acceptance/e2e-novel.cjs` 51/51 PASS（API 41 + 浏览器 10），截图见 `_acceptance/novel-e2e/`。`eslint`（5 个前端文件）与 `vue-tsc`（`pages/novel/**`、`components/novel/**`、`types/api.ts`）均 0 错。
2. **撤销定稿（reopen / version restore）** 未实现 —— 定稿后只能读、不能改正文。
3. **`original_script/*` 原创链 14 端点**、`point/permission/group/adjust/import` 8 端点未实现（不在本批必做子链）。
4. **`GET /novel/:nt/content-analysis/novel_character_cards`（角色卡列表单独端点）** 未单列：列表由 `content-analysis/detail` 一并返回（竞品也只有 detail + 单卡路径，无独立列表端点 —— 这是照做而非缺失）。
5. **`fission_script/chapters_outline`、`fission_script/idea/:ni_id`、`fission_script/characters/:nc_id`、`fission_script/episodes_outline/:neo_id`** 四个竞品路径未单列（我方以 `GET characters` / `GET episodes_outline` + `POST idea/select-op` 覆盖同一语义；若要求路径级 1:1，需再补 4 条薄路由）。
6. 并发锁是**进程内**互斥（多副本 API 时跨进程不互斥）。当前部署形态是单实例（ADR-002），已在代码注释登记；多副本时需换 Redis 锁。

---

## 7. 文件清单（本次新增/改动）

新增：
- `apps/api/src/modules/novel/{novel.module,novel.controller,novel.service,novel-agent.controller,novel-agent.service,novel-variant.controller,novel-variant.service,novel-llm.service,novel.dto,novel.schemas}.ts`
- `apps/api/test/novel.spec.ts`
- `apps/web/pages/novel/index.vue`、`apps/web/pages/novel/[id].vue`
- `apps/web/components/novel/{NovelStepper,NovelPendingDiff,NovelAgentChat}.vue`
- `_acceptance/e2e-novel.cjs`

改动（都在授权范围）：
- `apps/api/src/app.module.ts`：`import { NovelModule }` + `imports: [..., NovelModule, ...]`（锚 `KdsModule`，共 2 行）
- `apps/web/types/api.ts`：末尾追加 novel 类型段（未动他人内容）
- `_acceptance/_team/report-novel.md`：本文件

未改动：`packages/db/src/schema.ts`、迁移、`docs/**`、`layouts/app.vue`、`nuxt.config.ts`、其他模块与 spec。
