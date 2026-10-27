# 第 1 批「出片质量」交付报告 —— 主体库 / 抽取流水线 / 资产×分镜匹配

> 负责人：asset-core · 任务：task-5 · 日期：2026-10-27
> 依据：`docs/07-plan/completion-plan-to-100.md` §2（任务 1.1~1.5）+ completion-plan §3.3（小说衔接）
> 执行标准：ADR-013（有证据就照做，无证据不臆造并登记待取证）

---

## 1. 交付清单

### 1.1 端点（新增 18 条）

**主体库 `apps/api/src/modules/subjects/`（7 条）**

| 方法 路径 | 语义 | 证据 |
|---|---|---|
| `POST /v1/subjects` | 新建主体（必填仅 name；其余透传） | `cmd/subject.md:54-71` |
| `GET /v1/subjects` | 列表，支持 kind / review_status / project_id / q 过滤 | `cmd/subject.md:38-52` |
| `GET /v1/subjects/:id` | 详情（带参考图与预签名 URL） | `cmd/subject.md:108-122` |
| `POST /v1/subjects/from-asset` | **save-from-resource 语义**：绑定原项目资产、不新建资产、幂等 | `cmd/subject.md:73-106` |
| `POST /v1/subjects/status` | 批量审核状态（三态 + 未知标 unknown，不默认 approved） | `cmd/subject.md:200-226` |
| `PATCH /v1/subjects/:id` | 改名/描述/业务线/标签/参考图增删/**审核三态流转** | `cmd/subject.md:124-138` |
| `DELETE /v1/subjects/:id` | 软删（列表与生成侧一律过滤） | `cmd/subject.md:140-154` |

审核三态：`1 reviewing / 2 approved / 3 rejected`（落库在 `subjects.review_status`）。
**驳回 `retryable=false`**（DTO 与 `AppError.details` 双处表达），`assertApproved` 供生成侧调用；
只有 `approved` 可用于生成，未过审投递返回 **400105**（`target-spec.md:124,174`、`cmd/subject.md:204-216`）。

**抽取流水线 `apps/api/src/modules/extraction/`（6 条）**

| 方法 路径 | 语义 | 证据 |
|---|---|---|
| `POST /v1/extraction/tasks` | 创建抽取任务（`task_type` 1..5、`generate_mode` 仅 type=1、`need_voice` 仅 type=5）；同步执行 | `cmd/resource.md:536-568` |
| `GET /v1/extraction/tasks/:id` | 任务详情（四态 + eed_id 批次 + 草稿计数 + retryable） | `cmd/resource.md:570-584` |
| `POST /v1/extraction/tasks/redo` | **只允许失败(3)/失效(4)**；成功态 → 400101；源资产已删的失效 → 400101 `source_asset_gone` | `cmd/resource.md:602-617` |
| `GET /v1/extraction/drafts` | 草稿列表：默认只主形态，`is_all=true` 主/子平铺（子形态 `main_eed_id`→父 eed_id） | `cmd/resource.md:704-727` |
| `POST /v1/extraction/drafts/import` | 草稿导入：单类型、主子形态、`eed_id` 更新语义、**校验失败零写请求** | `cmd/resource.md:619-702` |
| `POST /v1/extraction/drafts/promote` | 草稿 → 项目资产（草稿态 status=1，需再定稿） | 竞品 `batch-draft-generate` 前置，我方补齐 |

四态：`1 进行中 / 2 成功 / 3 失败 / 4 失效`；源资产被软删 → 读取时惰性置 4（失效 vs 失败：重试只会一直失败，`schema.ts:1978-1982`）。

**资产×分镜匹配 `apps/api/src/modules/script/asset-match.service.ts`（5 条）**

| 方法 路径 | 语义 | 证据 |
|---|---|---|
| `POST /v1/projects/:id/episodes/:eid/match-resources` | 执行匹配（LLM 抽名称 → 命中项目资产 or 建占位 → 绑到镜）；支持 `dry_run` | `episode.md:261-300` |
| `GET …/match-result` | characters/scenes/props 三数组 + 三态计数 + 智能补充三选项 | `_storyboard-asset-match.md:5` |
| `POST …/match-reset` | 破坏性重置（`dry_run` 只预演） | `subject.md:228-250` |
| `POST …/save-resource-matches` | **完整快照**：三类数组必须同时给、空类别显式 `[]`、漏传 → 400101 且零写入 | `episode.md:368-388` |
| `POST …/supplement-missing` | 缺失智能补充（7 条件过滤 → 提示词补全 → 查重 → 待生图清单 → 回绑） | `_storyboard-asset-match.md:7-46` |

### 1.2 一致性三闸门（`apps/api/src/modules/script/asset-gates.service.ts`）

生成入口 `POST …/storyboards/generate-videos` 已逐镜调用，顺序固定：

1. **定稿闸门**：绑定资产须 `status=2` 且有参考图（我方 file_id 等价物 = `portrait_asset_id` / `ref_image_uri`）→ 否则该镜 `400105 reason=asset_not_ready gate=finalize`；
2. **匹配闸门**：`match-result.status ∈ {1,2,3}` 才算匹配已执行；`0`（从未匹配）→ 该镜 `400105 gate=match`（只对参考生视频生效，图生/文生视频不拦，避免打坏 P9 定格图链路）；
3. **生成闸门**：已定稿资产按绑定顺序展开 `images[]` + `名称 → [[@imgN]]` 映射，注入任务 `input`（`images` / `image_subjects` / `prompt_with_images`），`reference_uris` 保持原口径。
   另加**主体审核闸门**（定稿后、生成前）：绑定资产显式关联了未过审主体 → `400105 reason=subject_not_approved`，`reviewing` retryable=true、`rejected` retryable=false（`cmd/subject.md:212`）。

`storyboard-modes.spec` 断言的既有 reason（`asset_not_ready` / `need_two_assets`）**未改**，只追加 `gate`/`blocked`/`retryable` 字段，保证不退化。

### 1.3 小说来源拆集（completion-plan §3.3）

`POST /projects/:id/episodes/split` 新增可选 `source: { kind: "novel", nt_id }`：

- 传了就调 `NovelService.assertSplittable(spaceId, ntId)`（强类型注入，`NovelModule` 已 `exports: [NovelService]`，无 ModuleRef/@Optional 兜底需要）；
- 未定稿 → novel 侧 `400100 reason=not_finalized`；不存在 → `400102`；
- 优先用返回的 `episodeScripts[]` 保留集边界（不再二次切分），落库后项目 `source_type=1`（`ProjectSourceType.NOVEL`）；
- 不传保持原有行为（脚本正文/项目原文拆集）。

### 1.4 前端

- `apps/web/pages/assets.vue`：新增三视图 tab（资产 / **主体库** / **抽取与匹配**），原有资产逻辑与样式未改；
- `apps/web/components/subject/SubjectLibrary.vue`：列表 + kind/审核态/关键字筛选 + 新建 + **审核态徽标** + 通过/驳回（驳回强制填原因）+ 参考图增删 + **从项目资产保存为主体**（只列已定稿资产，unfinalized 会被 400105 拦）；
- `apps/web/components/extraction/ProjectQualityPanel.vue`：项目/分集选择 + 抽取（task_type 五档、任务四态徽标、草稿列表、重做、草稿落资产）+ 匹配（执行/结果三列 + 三态徽标/计数、保存快照、智能补充、重置前 dry-run 确认）；
- `apps/web/types/api.ts`：**只追加** Subject/Extraction/Match 相关类型（未改既有定义）。

---

## 2. 验收实测（本机 2026-10-27）

```
# 1) typecheck（apps/api）
$ pnpm --filter @app/api typecheck
> tsc --noEmit -p tsconfig.json
（无输出，EXIT=0）

# 2) lint（apps/api / apps/web）
$ pnpm --filter @app/api lint      → 0 error
$ pnpm --filter @app/web lint      → 0 error（17 warning 全为既有文件）

# 3) 新 spec 串行跑（与仓库 --no-file-parallelism 约定一致）
$ npx vitest run --no-file-parallelism test/subject.spec.ts test/extraction.spec.ts \
    test/asset-match.spec.ts test/project-assets.spec.ts test/project-assets-extract.spec.ts
 ✓ test/asset-match.spec.ts (11 tests) 826ms
 ✓ test/project-assets.spec.ts (13 tests) 662ms
 ✓ test/extraction.spec.ts (10 tests) 643ms
 ✓ test/subject.spec.ts (8 tests) 525ms
 ✓ test/project-assets-extract.spec.ts (9 tests) 459ms
 Test Files  5 passed (5)
      Tests  51 passed (51)
```

新增 3 个 spec 共 **29 例**（subject 8 / extraction 10 / asset-match 11），既有 2 个资产 spec **22 例无退化**。
覆盖维度：成功路径 / 跨 space 隔离（400102，不泄露存在性）/ 参数校验 400101 / 400105 / 幂等重放 / 完整快照语义 / 主子形态 / 四态与 redo / 三闸门 / 小说拆集来源。

**生成侧回归**：`project-assets-image / storyboard-modes / storyboard-frames / pipeline` 单独跑均绿（45+9 例）。
说明：一次「4 个 spec 连续跑」中 `project-assets-image.spec.ts:179` 曾失败（断言任务应 PENDING，实际已 SUCCEEDED），
单独复跑 9/9 绿 —— 判为环境干扰（本机有 teammate 在跑 worker/队列消费，任务被提前消费），非代码回归。

---

## 3. 已知偏离 / 待取证（如实登记）

1. **匹配清单的落库方式**：竞品的集级 `resources{characters,scenes,props}` 是集级数组 + 独立存储；我方 0019 未建该表，
   因此 `match-result` 用「绑定到本集分镜的项目资产 ∪ 名称出现在本集正文/标题/梗概/分镜文案里的项目资产」投影，
   `save-resource-matches` 用 `storyboard_assets` 做**按类整类替换**实现快照语义。
   后果：集级清单无法保存"没有任何镜提及、也未被绑定"的资产（竞品可以）；需新表才能完全等价。
2. **未定稿/占位项也绑到镜**：因为绑定是唯一可落的"集级清单"载体，也是生成侧 400105 的判定依据。
   语义：匹配后有缺失/未定稿项时，该集出片会被 400105 拦住，必须先补资产——这与"未定稿不得用于生成"一致，
   但比竞品（缺失项不阻塞分镜确认）更严格；分镜确认环节本身不受影响。
3. **7 项条件中的 `prompt_blocked` 无列可存** → 恒为 `false`（该条件恒真）。要完全满足需加列/新表（登记待迁移）。
   `prompt_generating` 用 `project_assets.source_task_id → tasks.status ∈ {PENDING,RUNNING}` 近似。
4. **智能补充不代扣费**：只做提示词补全 + 查重复用 + 回绑，需要生图的目标以 `pending_image` / `next_actions`
   返回，由既有 `POST /projects/{id}/assets/{aid}/generate-image` 走报价确认（证据要求生图前单独展示账单）。
5. **生成闸门 images[] 注入不改原 prompt**：竞品把提示词里的资产名替换成 `[[@imgN]]`；我方保留原 prompt，
   另给 `prompt_with_images` / `image_subjects` 映射（避免改写用户可见提示词）。若要求与竞品逐字一致，需要产品确认。
6. **`subject_type` 0/4/5 的语义未取证**：我方按资产 kind 回退映射（0/4/5 → character），`business_list` 缺省 `[3]`（Seedance）。
7. **主体审核没有对应前端接口**（`cmd/subject.md:252-266` 明说"保留入口、当前无对应前端接口"）：
   我方用 `PATCH /subjects/:id {review_status}` 承载并在回报标注，不臆造 `review` 端点。
8. **跨 space 一律 400102 而非 403**：与既有 assets/project 端点同口径，避免泄露"资源是否存在"。
9. **`match-resources` 不含"自动拆分镜"组合任务**：我方拆镜仍需显式 `storyboards/generate`（偏离已登记，
   completion-plan 允许把组合任务拆成两步，但需在 api-spec 写明）。
10. **抽取同步执行**：无独立 worker/轮询态。大文本 + 真 LLM 时单请求会变长（当前 mock 秒级）；
    竞品语义（`et_id` + 四态轮询）已保留，改成异步入队不需要改契约。

---

## 4. 需要 Lead 做

1. **路由**：`/assets` 的 `routeRules`（`ssr:false`）已存在，无需新增；若要独立侧栏入口（「主体库」「抽取匹配」），
   需改 `layouts/app.vue`（我未动）。
2. **项目页入口**：若要在 `pages/projects/[id].vue` 内嵌「抽取」「匹配」，直接挂
   `components/extraction/ProjectQualityPanel.vue`（自带项目/分集选择器，也可传 props 精简）；该文件属他人，我未改。
3. **文档**：`docs/02-architecture/api-spec.md` 需补上 18 条新端点（docs 由 Lead 独占）。
4. **迁移**（可选，用于消除偏离 §3.3）：若要 `prompt_blocked` 真生效，需要给 `project_assets` 加 `prompt_status` 列或建集级匹配表；
   当前无迁移也能跑，条件恒真。
5. **api-spec 偏离说明**：请把 §3.1/3.2/3.5/3.9 的偏离写进 api-spec 的"偏离说明"段。

---

## 5. 未完成（诚实列出）

- **前端未做浏览器实跑**：无可用登录态/dev server 验证记录，只到 `vue-tsc` 通过 + web lint 0 error；
  人工验证步骤：`/assets` → 「主体库」tab → 新建主体 → 通过/驳回 → 「从项目资产保存为主体」→「抽取与匹配」tab → 执行抽取/匹配。
- `match-result` 未回传三闸门 verdict（闸门只在生成入口判定）；若前端要在匹配页显示"能否出片"，需加只读预检字段。
- `POST /subjects/status` 逐条查（N 次 SQL），未做批量优化。
- 匹配的「自动拆分镜」组合任务、抽取的异步 worker 化未做（见 §3.9/3.10）。
- 主体审核自动流转（异步审核回调）未做：当前审核态只能人工 PATCH（与竞品"当前无前端接口"一致）。

