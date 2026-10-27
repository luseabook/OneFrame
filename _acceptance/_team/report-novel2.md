# 小说链补完（task-13）交付报告

> 执行人：teammate `novel-api` · 任务：`task-13`（模块 #2 小说链补完，权重 8）
> 基线：HEAD `4a309bf`；上一轮已交付改编链 64 路由（`_acceptance/_team/report-novel.md`）
> 本轮目标：`original_script` 原创链 14 端点 + 撤回定稿 `reopen` + 4 条薄路径 + 并发锁换 Redis + 工作台原创入口
> 日期：2026-10-27

---

## 1. 交付

### 1.1 novel 域路由总量：**64 → 90 条**（`/v1/novel/*`）

| 控制器 | 路由数 | 本轮变化 |
|---|---:|---|
| `novel.controller.ts`（改编主链） | 38 | +1 `POST /:nt/reopen` |
| `novel-original.controller.ts`（原创链，**新增文件**） | 20 | 全新 |
| `novel-variant.controller.ts`（裂变/海外 + 薄路径） | 16 | +5 薄路径 |
| `novel-agent.controller.ts`（剧本编辑 Agent） | 16 | 0（改内部锁实现） |
| **合计** | **90** | +26 |

### 1.2 原创剧本链 `/v1/novel/:nt/original_script/*`（20 路由）

对照竞品 CLI 文档 `_acceptance/_gap/cli-skill/reelmate-cli-skill/commands/novel.md`
（原文同一份在 `rea-reelmate/cli-skill/reelmate-cli-skill/commands/novel.md`）与
`rea-reelmate/routes.txt:547-564` 的 18 条 `original_script` 路由。

| # | 路由 | 竞品证据 |
|---:|---|---|
| 1 | `POST /original_script/idea` 生成创意方案 | `novel.md:84-88`（create 即启动创意规划方案生成）、`:433-455` |
| 2 | `GET /original_script/idea` 方案列表 | `novel.md:433-455` |
| 3 | `POST /original_script/idea/select-op` 选定方案 | `novel.md:457-480`（只提交 ni_id + selected=true） |
| 4 | `POST /original_script/materials/generate` 生成素材 | `novel.md:504-526` |
| 5 | `GET /original_script/materials` 素材列表 | `novel.md:528-548`（标题即「素材1/素材2」） |
| 6 | `POST /original_script/materials/select-op` 勾选素材 | `novel.md:550-573`（**加法语义**，不取消其它） |
| 7 | `PATCH /original_script/materials/:nm_id` 编辑素材 | `routes.txt:561` |
| 8 | `POST /original_script/summary_outline` 总纲生成 | `novel.md:575-595` |
| 9 | `GET /original_script/summary_outline` 总纲读取 | `routes.txt:564` |
| 10 | `PATCH /original_script/summary_outline` 总纲编辑 | 同上（编辑口径） |
| 11 | `POST /original_script/chapters_outline` 分卡章纲生成 | `novel.md:597-617` |
| 12 | `GET /original_script/chapters_outline` 章纲列表 | `routes.txt:547` |
| 13 | `PATCH /original_script/chapters_outline/:nco_id` 章纲编辑 | `routes.txt:548` |
| 14 | `POST /original_script/episodes_outline` 集纲生成 | `novel.md:619-639` |
| 15 | `GET /original_script/episodes_outline` 集纲列表 | `routes.txt:555` |
| 16 | `POST /original_script/episodes` 分集剧本生成 | `novel.md:641-661` |
| 17 | `PATCH /original_script/episodes/:ne_id` 剧本编辑 | `routes.txt:554` |
| 18 | `POST /original_script/episodes/:ne_id/confirm` 剧本确认 | 同上（状态 2） |
| 19 | `POST /original_script/finalize` 定稿 → status=16 | `novel.md:663-683` |
| 20 | `GET /original_script/state` 链状态（八步进度） | 我方补充（前端一次渲染，不打八次） |

**与裂变链的区别（实现上必须分清，所以写在这里）**

| | 裂变 `fission_script/*` | 原创 `original_script/*` |
|---|---|---|
| 来源 | 必须有一个 **已定稿（16）** 的源本子 | **不需要任何源本子**，入口是一句创作灵感 |
| `source_type` | 4 | **2（IDEA）** |
| 存档位 | `novels.meta.fission` | `novels.meta.original` |
| 起点 | 从源本子剧本派生方案 | 从 `meta.source_text`（user_input）生成方案 |

不新增表、不改 `schema.ts`：创意方案/素材/总纲是"生成过程快照"，存 `novels.meta.original` 的 jsonb 自由字段；
分卡章纲 / 集纲 / 分集剧本全部复用既有 `novel_chapter_outlines` / `novel_episode_outlines` / `novel_episodes`
（含 `novel_script_versions` 版本不变式 `episode.version == max(version_no)`）。

### 1.3 撤回定稿 `POST /v1/novel/:nt/reopen`

- `status 16 → 1`，写 `meta.reopen_memo` / `meta.reopened_at`（审计"为什么又改了"）。
- **未定稿时**：`400100` + `reason=not_finalized`（不静默 `ok:true`）。
- **已被拆集引用时**：**`400105`** + `reason=referenced_by_split` + `projects[]`（引用它的制片工坊项目），**状态一个字节都不动**。
- 不删版本、不动正文：整本/单集快照继续保留，随时可对比"定稿那一稿"。

**判据（迁移 0026 之后，两级）**：
1. **精确**：`script_projects.source_novel_id = 本子 id`（拆集时由 script 域写入的来源外键）。
   即使项目正文后来被人工改写，也能认出"这个本子被拆走了"。返回项带 `matched_by: "source_novel_id"`。
2. **回落：正文快照比对**（一条精确命中都没有时才跑，兼容 0026 之前拆出的历史项目）：
   项目里任一集正文（去空白后）与本子某集正文完全相同 → 认定被引用，`matched_by: "text_snapshot"`。
   已知边界：历史项目正文被改写后识别不到 —— 这只影响"迁移前"的老数据，新拆集都有外键。

### 1.4 4 条薄路径（路径级 1:1，共 5 路由）

| 路由 | 竞品 | 说明 |
|---|---|---|
| `GET /:nt/fission_script/chapters_outline` | `routes.txt:535` | 有真实 `novel_chapter_outlines` 行则返回；无则由 `meta.fission.summary_outline.beats` 派生**只读投影**（`id:null, readonly:true, derived_from`）并给 hint |
| `GET /:nt/fission_script/idea/:ni_id` | `routes.txt:542` | 方案详情 + `selected` |
| `GET /:nt/fission_script/characters/:nc_id` | `routes.txt:537` | 单角色详情（`nc_id` = `novel_characters.id`） |
| `GET /:nt/fission_script/episodes_outline/:neo_id` | `routes.txt:540` | 单条集纲 |
| `PATCH /:nt/fission_script/episodes_outline/:neo_id` | `routes.txt:556` 同形 | 单条集纲编辑（与其它大纲编辑同口径） |

### 1.5 并发锁换 Redis（`novel-agent.service.ts`）

- 由进程内 `Set` 改为 **Redis `SET NX` + TTL 60s**（`RedisService.setNx`；`RedisModule` 是 `@Global`，直接注入）。
- 释放用 **Lua 比较删除**（`if get==token then del`）——否则"A 的锁超时后 B 抢到，A 的 finally 删掉 B 的锁"。
- 锁值带持有者 token（`pid-ts-rand`），可断言"不是常量"。
- **`746005 AGENT_TURN_IN_FLIGHT` 语义完全保留**；中止标记也从进程内 `Set` 改为 Redis key（跨副本可见）。
- 顺序也改了：先做本子/会话/活跃态校验（精确错误），再原子抢锁 —— `SET NX` 本身是原子的，
  不再需要"先占位再校验"（那是进程内 Set 时代的前提）。

### 1.6 前端

| 文件 | 变化 |
|---|---|
| `pages/novel/index.vue` | 新建弹窗加**模式切换**：`小说改编`（粘贴/上传 → 自动分章）/`纯原创`（一句创作灵感 → `source_type=2`）；头部与空态各有「新建原创剧本」入口 |
| `pages/novel/[id].vue` | `source_type=2` 的本子在最前面多一个 **「原创链」tab** 并默认落在它；改编七步步进器对原创本子隐藏（步骤名对不上），由原创链自带的八步代替 |
| `components/novel/NovelOriginalChain.vue`（新增） | 原创链面板：创意方案（生成/选定）→ 素材（生成/勾选/编辑）→ 总纲（生成/编辑节拍）→ 分卡章纲（生成/编辑）→ 集纲（生成）→ 分集剧本（生成/编辑/确认）→ 定稿；每步有前置禁用与明确提示 |
| `components/novel/NovelStepper.vue` | 加 `items` prop（默认仍是改编七步），原创链复用同一组件换成八步；网格改 `auto-fit` 以容纳 7/8 步 |
| `types/api.ts` | 只追加：`NovelOriginalIdeaDto / NovelOriginalMaterialDto / NovelOriginalBeatDto / NovelOriginalOutlineDto / NovelOriginalStateDto` |

---

## 2. 测试与实测输出

### 2.1 新增 spec：`apps/api/test/novel-original.spec.ts` —— **15 例**

覆盖（每例注释里写了"为什么这么断言"）：
创建原创本子（source_type=2、灵感不分章）/ state 八步 / 改编本子走原创链 400100 / 无灵感 400101 + 传 user_input 救回 /
idea 生成（id 稳定）/ 列表 / select-op（404 + 空 body 400101）/ 未选定就生成素材·总纲·章纲·集纲全部 400101 /
素材生成（标题素材N）/ 列表 / **勾选加法语义** / 编辑 / 404 / 空 body / 总纲生成 + 读 + 编辑（含节拍覆盖）+ 无总纲 PATCH 400101 /
分卡章纲派生（章号对齐、derived_from）/ 列表 / 编辑 / 404 / 空 body / 集纲 3 集 / 剧本生成 / 只改标题不升版本 / 改正文升版本 /
确认幂等 / 404 / finalize→16 / 定稿后写正文 400100 / **reopen 16→1** / 再 reopen 400100 / 重定稿往返 /
**reopen 被拆集引用 → 400105 + details.reason=referenced_by_split + projects[]，且 status 未变** /
**reopen 精确判据（0026）**：`source_novel_id` 命中（正文已被改写）→ 400105 且 `matched_by="source_novel_id"`；
无引用 → 允许 16→1 且 `references=[]` /
4 条薄路径（正常 + 404 + 非法 id 400101）/ **Redis 锁**（别的副本持锁 → 746005；释放后可继续；轮次中锁可见且带 token；结束即释放）/
跨 space 403（原创链 4 条 + 薄路径 2 条）。

### 2.2 门禁实测（`app\apps\api`）

```
npx tsc --noEmit -p tsconfig.json 2>&1 | Select-String 'modules/novel'   → 空（0 错）
npx eslint src/modules/novel                                              → 0 errors

npx vitest run test/novel.spec.ts test/novel-original.spec.ts
 ✓ test/novel-original.spec.ts (15 tests) 1227ms
 ✓ test/novel.spec.ts (25 tests) 1481ms
 Test Files  2 passed (2)
      Tests  40 passed (40)
```

**稳定性**：连续跑 3 次均 40/40（`run 1/2/3: Tests 40 passed`）。

**web 侧**（`app\apps\web`）：
```
npx eslint pages/novel components/novel types/api.ts                         → 0 errors
npx vue-tsc --noEmit -p tsconfig.typecheck.json | Select-String pages/novel|components/novel|types/api  → 空
```

### 2.3 页面真机验收（真实 chromium + 真实登录页 + 真实 API，`/v1/**` 拦截到源码实例）

`=== 15/15 PASS ===`

```
PASS 登录页拿到验证码 / 登录成功
PASS 列表页出现「新建原创剧本」入口
PASS 弹窗切到原创模式（创作灵感）
PASS 创建后进入工作台 — /novel/108388881649565696
PASS 工作台默认打开「原创链」tab
PASS 原创链显示八步（含选定方案/分卡章纲）
PASS 生成创意方案后出现可选方案 → PASS 选定方案后出现「已选定」
PASS 素材生成（素材1/素材2 可见）
PASS 总纲生成（出现保存总纲/节拍）
PASS 分卡章纲生成 → PASS 集纲生成（第 1 集）
PASS 分集剧本生成（出现剧本正文编辑器）
PASS 浏览器控制台无报错
```

截图（`_acceptance/novel-e2e/`）：`05-original-entry.png`（原创入口 + 八步链）、`06-original-chain.png`（跑完六步后的整页）、
`original-chain-ui-result.json`（逐条断言）。DB 抽查：该本子 `novel_episode_outlines` 1..12、`novel_episodes` 1..12 各 version=1。

---

## 3. 已知偏离 / 待取证

1. **`original_script/characters/*` 5 条竞品路由未单列**（`routes.txt:549-553`：list/add/`:nc_id`/delete/batch-rename）：
   原创本子的角色卡走既有 `POST /novel/:nt/content-analysis`（世界观+角色卡）与 `/core_character/*` ——
   那两条链对 `source_type=2` 同样成立（上下文回落到 `meta.source_text` 的创作灵感），重复实现等于出现第二份
   "角色卡怎么生成"的真相。**若要求路径级 1:1，我再补 5 条薄路由（约 60 行）。**
2. **分卡章纲由总纲节拍派生**，不单独调一次 LLM：竞品 CLI 只说"触发分卡章纲生成"（`novel.md:597-617`），
   未取证输出形状；节拍本身就是分卡边界，派生能保证"章纲与总纲永远一致"，且省一次模型抖动。可再逐条人工编辑。
3. **原创链 3 个 LLM 输出 schema 暂放模块内**（`novel-llm.service.ts` 的 `originalIdeas/originalMaterials/originalSummaryOutline`）：
   共享 `packages/shared/src/schemas/novel.ts` 归 Lead 维护，等"原创链是否对外暴露契约"定下来再上移。
4. ~~`reopen` 的引用检测只能用正文快照~~ → **已升级**（迁移 0026）：先按 `script_projects.source_novel_id` 精确命中，
   查不到再回落快照比对；命中仍返回 `400105` + `projects[]`（带 `matched_by` 说明依据）。
5. **原创本子的 `source_text` 不再自动分章**（改 `NovelService.create`：只对 `source_type=1` 分章）。
   竞品原创入口的 `user_input` 是灵感而非正文；切章会让工作台"分章"步骤假完成。这是**行为变更**，但只影响新建的原创本子（老数据不受影响）。
6. 竞品 `material set` 的"不取消其它"语义已照做；`properties` 里未取证字段（如 `is_select` 是否可单独取消）按"显式传 `selected:false` 才取消"实现。

---

## 4. 顺手修掉的既有缺陷（不在任务描述里，但会挡门禁）

`apps/api/test/novel.spec.ts` 的 `apply_all / reject_all` 用例**本身是偶发假红**：mock 每轮产出 1~2 集 diff 由内容哈希决定，
`apply_all` 有可能把唯一一集应用掉，随后 `reject_all` 的 `rejected >= 1` 就失败（同一份代码跑两次结果不同）。
已在 reject_all 前补"若已无 pending 就再产一轮"的前置，断言语义不变。**连跑 3 次 40/40 稳定。**

> 说明（Lead 要求留档）：该处改动**只补前置、不改断言**——`reject_all` 仍然断言 `rejected ≥ 1` 且 `remaining === 0`；
> 补的是一轮 chat 以保证"确实有可驳回的 pending"这个前提成立。若不补，断言就变成"依赖 mock 恰好产出 2 集 diff"，
> 那是测试对实现细节的过度假设（mock 每轮 1~2 集由内容哈希决定），不是产品契约。

---

## 5. 需要 Lead 做

1. ~~加列 `script_projects.source_novel_id`~~ → **已完成**（Lead 迁移 0026 + `@app/db` 已构建），
   我已把 `reopen` 改成"精确外键优先、快照回落"，并补 1 条 spec（见 §2.1）。
   `script` 侧（写入该列 + 项目 DTO 透出）由 asset-core 负责，我只读不写。
2. **不在我域内的两条门禁红**（本轮实测）：
   - `pnpm --filter @app/api lint` → `src/modules/home/home.service.ts(1,10) 'Inject' is defined but never used` +
     `(302,9) prefer-const 'cursor'`（home 域 owner 修；我这边 `eslint src/modules/novel` = 0）。
   - `tsc` 全树 → `src/modules/moderation/captcha.service.ts(77,5): TS2322 NonSharedBuffer → string`。
3. `runtime` 提示：新增 pages **子目录**后必须重启 web dev（Nuxt 启动后不补路由）；本轮只改既有文件，HMR 正常，
   但 `components/novel/NovelOriginalChain.vue` 是新增**文件**（目录已存在）→ 实测无需重启即可加载。
4. 若要我补 `original_script/characters/*` 5 条路径，或把原创链 3 个 schema 上移到 `packages/shared`，说一声即可。

---

## 6. 未完成（诚实清单）

1. `original_script/characters/*` 5 条竞品路径（见 §3.1，理由是"能力已有、不重复造真相"）。
2. 原创链的 `idea/:ni_id` 单条详情与编辑（竞品 `routes.txt:558`）：目前由 `GET idea` 列表 + `select-op` 覆盖；
   本轮 4 条薄路径只针对裂变，未扩到原创（**如需要可补 2 条**）。
3. ~~`reopen` 的精确引用判断~~ → **已接**（迁移 0026 + 快照回落），见 §1.3 / §2.1。
4. 原创链的"素材勾选 → 总纲使用"目前是"已勾选优先，否则用全部"；竞品未明写这一步的取舍，属我方语义（已注释）。

---

## 7. 文件清单

新增：
- `apps/api/src/modules/novel/novel-original.service.ts`、`novel-original.controller.ts`
- `apps/api/test/novel-original.spec.ts`
- `apps/web/components/novel/NovelOriginalChain.vue`

改动（均在授权范围）：
- `apps/api/src/modules/novel/novel.service.ts`：`reopen` / `findSplitReferences` / create 只对 source_type=1 分章
- `apps/api/src/modules/novel/novel-agent.service.ts`：Redis 轮次锁（`SET NX` + Lua 释放）+ 中止标记
- `apps/api/src/modules/novel/novel-variant.service.ts` / `novel-variant.controller.ts`：4 条薄路径（5 路由）
- `apps/api/src/modules/novel/novel.controller.ts`：`POST /:nt/reopen`
- `apps/api/src/modules/novel/novel-llm.service.ts`：原创链 3 个 LLM 步骤 + 3 个模块内 schema
- `apps/api/src/modules/novel/novel.schemas.ts`：原创链 9 个请求 schema + `reopenSchema`
- `apps/api/src/modules/novel/novel.module.ts`：注册 `NovelOriginalController` / `NovelOriginalService`
- `apps/web/pages/novel/index.vue`、`pages/novel/[id].vue`、`components/novel/NovelStepper.vue`
- `apps/web/types/api.ts`（只追加 5 个类型）
- `apps/api/test/novel.spec.ts`（**仅**修既有偶发假红的前置，断言语义不变）

未改动：`packages/db/src/schema.ts`、迁移、`docs/**`、`app.module.ts`、`layouts/app.vue`、`nuxt.config.ts`、其他域模块与 spec。
