# 首发补全 A 交付报告 —— 剧集 quality-check/合成/parse 子链 + 全部项目聚合 + ReelFlow 切片发布

> 负责人：asset-core · 任务：task-10（模块 #3 剧集与分镜 / #5 全部项目 / #20 ReelFlow）
> 日期：2026-10-27 · 代码：`app/apps/api/src/modules/script/**`、`app/apps/web/pages/{works.vue,reelflow/edit/[id].vue}`、`types/api.ts`
> 标准：ADR-013（有证据照做，无证据不臆造并登记待取证）

---

## 1. 交付清单

### 1.1 端点（新增 9 条 + 扩展 1 条 = 10）

**#3 剧集/分镜子链**

| 方法 路径 | 语义 | 证据 |
|---|---|---|
| `POST /v1/projects/:id/episodes/:eid/quality-check` | 质量检查：**只读**，`issues[]` + 加权 `score`（5 维度，权重写死并有理由） | 端点存在 `rea-reelmate/routes.txt:445`；口径来自 `target-spec.md:124,174` |
| `POST /v1/projects/:id/episodes/:eid/film-synthesis-export` | 分集合成导出：同步判 80% 闸门（不足 → **400106**），通过后下发 zip 包 + 成片 mp4 两个 job | `target-spec.md:124,174`（仅打包成功镜 / <80% 拒 / 异步导出） |
| `POST /v1/projects/:id/episodes/parse` | 贴表 → 解析成 storyboards（`replace`/`merge`，**先备份再覆盖**） | `routes.txt:440-444`（`process/parse/generate`）、`cmd/storyboard.md:302-330`（按 shot_no 更新不重复新增） |
| `POST /v1/projects/:id/episodes/parse-reset` | 恢复到最近一次解析前快照（分镜 + 绑定都还原，**保留原始 id**） | `routes.txt:444`（`process/parse/delete`） |
| `POST /v1/projects/:id/episodes/parse-retry` | 按最近一次输入原样重跑；无历史 → 400101 `no_previous_parse` | `cmd/episode.md:407-429`（retry 与 parse 是两个端点、不能互相替代） |

**#5 全部项目聚合**

| 方法 路径 | 语义 | 证据 |
|---|---|---|
| `GET /v1/works`（扩展） | `tab=workshop\|canvas\|all` + `kind` + `status`（归档维度） + `state`（四态） + `keyword` + `from/to` + 分页 + `has_more` + `tabs{workshop,canvas}`；画布为**跨域只读投影**（node_count/running_nodes/failed_nodes） | `_acceptance/_gap/fullsite-route-inventory.md:81` |

**#20 ReelFlow 剩余**

| 方法 路径 | 语义 | 证据 |
|---|---|---|
| `POST /v1/projects/:id/episodes/:eid/timeline/publish` | 切片发布：写 `timeline_publications`，异步转码 **1 排队 → 2 转码中 → 3 可播放（发 shareToken）/ 4 失败（落 error）** | `routes.txt:917`（`wf/publish`）、`:923`（`wf/video-slicing`） |
| `GET /v1/projects/:id/episodes/:eid/timeline/publications` | 发布列表（状态筛选 + 分页 + 签名下载地址；下架项不再返回 token） | 同上 |
| `DELETE /v1/projects/:id/episodes/:eid/publications/:pubId` | 下架 → `status=5`，重复下架 400102 | `routes.txt:911`（`wf/del-video`） |
| `POST /v1/projects/:id/episodes/:eid/timeline/clips/:clipId/assets` | 片段资产绑定（空间资产 / 项目资产 / 镜头产物；快照语义，`clear` 清空） | `routes.txt:906`（`wf/clip-bind-asset`） |

### 1.2 关键实现决定（都写进了代码注释）

- **quality-check 只读**：只做 select，不写 storyboards / project_assets / timeline。评分口径：
  `shots 30 / prompt 25 / assets 25 / duration 10 / timeline 10`；每维 `score = 通过项/总项×100`，
  总分 = Σ(score×weight/100)；有 error → `fail`，只有 warn → `warn`。理由见 §3。
- **film-synthesis-export 双通道**：`exportJobs`（zip，四态，worker `runExport` 已有 80% 闸门与 manifest）
  + `timelineExports`（成片 mp4，worker `runTimelineExport` 已做统一分辨率/30fps/h264/「AI生成」水印）。
  API 侧先**同步**判 80%，不足直接 400106 并返回 `shots_total/shots_ready/missing_shots`（不让用户等异步失败）。
  没有时间线时按"已出片镜头"自动摊一条（不覆盖用户已有剪辑）。
- **parse 先备份再覆盖**：每次覆盖前把 `storyboards + storyboard_assets + 本次输入` 写两份 JSON 到 storage
  （`u/<space>/parse-backups/<episode>/<ts>.json` 不可变审计 + `latest.json` 指针）；
  `parse-reset` 用**原始 id** 还原（否则绑定与时间线片段会指向已删除的行 = 假恢复）；
  `parse-retry` 读 `latest.json` 的 `last_input` 原样重放。
- **publish 不是导出**：产物复制到 `u/<space>/publications/<id>.mp4` 单独维护状态，删导出文件不影响已发布作品
  （与 `timeline_publications` 表注释同因）；`shareToken` 16 字节随机 + 唯一索引 + 冲突重试 3 次。
  前置：本集必须已有一次成功成片（`timeline_exports.status=3`），否则 **400105**（否则发布记录只能永远失败）。
- **clip 资产绑定**：存在 `project_timelines.clips[].assets`（可选字段，**只在有绑定时出现**，保住既有
  `timeline.spec` 对 clip 键集合的断言）；`PUT timeline` 整体覆盖时按 `clip_id` 保留绑定
  （否则用户保存一次剪辑就把绑定清掉）。
- **`/works` 聚合**：筛选全部下沉到 SQL（含 `work_state` 的 CASE 表达式），保证 `total` 与 `list` 自洽；
  `tab=all` 两种形态各自取到页末再按 `updated_at` 归并；画布只读 `canvases/canvas_nodes`，不 import CanvasModule。

### 1.3 前端

- `pages/works.vue`：标题改「全部项目」，三个形态 tab（工坊项目 / 画布项目 / 全部，带各自计数），
  二级筛选（未归档/已归档/全部状态、四态、时间范围、关键词、重置），画布卡片（节点数/画布类型/失败节点）
  跳 `/canvas/:id`，分页保留；工坊卡片沿用既有骨架（示例模板复制、续做一集、归档/恢复）。
- `pages/reelflow/edit/[id].vue`：顶栏新增「切片发布」（面板：标题 + 起止秒 + 发布按钮 + 发布记录列表，
  每条含状态徽标/区间/下载/复制 shareToken/分享页/下架；未终态自动 2s 轮询，5 分钟超时明确提示）；
  时间线工具栏新增「片段资产」（对当前选中片段：绑定镜头产物、从项目已定稿资产里挑、清空、展示当前绑定）。
- `types/api.ts`：`WorkDto` 扩 `kind/node_count/creation_mode/running_nodes/failed_nodes` 与 `work_state:"canvas"`，
  新增 `WorksListDto`、`QualityCheckDto`、`FilmSynthesisDto`、`EpisodeParseDto`、
  `TimelinePublicationDto/ListDto`、`TimelineClipAssetDto`。

---

## 2. 验收实测（本机 2026-10-27，无 worker 运行时）

```
# 新增 3 个 spec + 既有 3 个回归，串行跑（--no-file-parallelism，与仓库门禁一致）
$ npx vitest run --no-file-parallelism \
    test/episode-quality.spec.ts test/works-aggregate.spec.ts test/reelflow-publish.spec.ts \
    test/timeline.spec.ts test/pipeline.spec.ts test/storyboard-modes.spec.ts
 ✓ test/episode-quality.spec.ts (10 tests) 644ms
 ✓ test/reelflow-publish.spec.ts (8 tests) 682ms
 ✓ test/pipeline.spec.ts (17 tests) 1351ms
 ✓ test/timeline.spec.ts (10 tests) 713ms
 ✓ test/storyboard-modes.spec.ts (11 tests) 1098ms
 ✓ test/works-aggregate.spec.ts (6 tests) 937ms
 Test Files  6 passed (6)
      Tests  62 passed (62)
```

- 新增 spec 共 **24 例**：episode-quality 10 / works-aggregate 6 / reelflow-publish 8；
  覆盖 成功路径 / 跨 space 隔离（400102）/ 参数校验 400101 / 400105（无成片就发布）/
  400106（<80% 拒）/ 状态机（1→3、下架 5 与不可重复下架）/ 只读断言（行级 equal）/ 快照语义与幂等。
- 既有回归 38 例全绿（timeline 10 / pipeline 17 / storyboard-modes 11）。
- typecheck / lint：
  - `pnpm --filter @app/worker typecheck` → **0 错**
  - `pnpm --filter @app/api typecheck` → 我范围 0 错；整树仅剩 1 个他人文件错误：
    `src/modules/campaign/campaign.service.ts(329,45): Cannot find name 'id'`
  - `pnpm --filter @app/web typecheck` → 我范围 0 错；整树仅剩 1 个他人文件错误：
    `pages/novel-market/manage.vue(216,53): Type 'String' has no call signatures`
  - `pnpm --filter @app/api lint` → 我范围 0 错；整树仅剩 2 个他人文件错误（`modules/home/home.service.ts`：
    未用 `Inject`、`cursor` 应 const）
- **中断修复**（Lead 报的阻断）：`ScriptModule.providers` 补注册 WorksService/QualityCheckService/
  FilmSynthesisService/ParseService/PublishService → Nest 初始化恢复；`film-synthesis.service.ts` 的
  `sum: unknown` 与 `works.service.ts` 的 `db.execute` 结果转类型已按 `as unknown as` 修正；
  boot 实测 `test/subject.spec.ts` 8/8 通过。

---

## 3. 证据（逐条）

- quality-check 端点存在 ← `rea-reelmate/routes.txt:445`
  （`/web/v1/df/episode/:ep_id/quality-check`）；**字段与评分口径全文档未记载** → 自建口径（见下"偏离"）
- 导出 80% 闸门 / 仅成功镜 / 异步任务 ← `_acceptance/_gap/target-spec.md:124`（PRD F2⑦）；
  400106 = 导出成功镜 <80% ← `target-spec.md:174`
- 解析子链四通道 ← `routes.txt:440-444`（`process/parse/{delete,generate,info,upload}`）；
  按 `shot_no` 更新不重复新增 ← `cmd/storyboard.md:302-330`
- `parse-retry` 是独立端点、不能替代 `parse` ← `cmd/episode.md:407-429`
- 发布 / 切片 / 片段绑资产 / 删视频 ← `routes.txt:917 / 923 / 906 / 911`；
  我方差距明确记为「缺切片/发布/clip 资产绑定」← `_acceptance/_gap/fullsite-route-inventory.md:81`
- 作品清单含工坊与画布两类 ← `fullsite-route-inventory.md:81`

---

## 4. 已知偏离 / 待取证（如实登记）

1. **quality-check 评分口径是自建**：竞品只有路由（`rt:445`），无字段/公式文档。
   我方权重 `30/25/25/10/10` 的理由写在 service 头注释（分镜完整性最高、按镜逐项判；
   时长/成片就绪可自动纠正故权重低）。若后续抓到竞品真实返回，需按它校准维度与权重。
2. **film-synthesis-export 不是"纯复用 exports 表"**：zip 通道确实复用 `exports`（四态 + worker exporter），
   但"整集 mp4 + watermark"必须走 `timeline_exports` + worker 合成器（zip 通道产不出 mp4，worker 不在本轮写权限）。
   两条通道都用**既有表**，没有新增表；四态语义一致（1 排队 / 2 处理中 / 3 完成 / 4 失败）。
3. **切片转码在 API 内实现**：worker 目前只有 `timeline.export` 处理器，没有 publication 处理器；
   本轮 worker 不在写权限内，所以状态机（1→2→3/4、error 落库、shareToken 唯一）在 API 内同构实现，
   "转码"= 复制已合成的成片产物。**真正按 `slice.start_ms/end_ms` 用 ffmpeg 裁剪需要 worker 新增 handler**
   （复用它既有的 ffmpeg 代码与 `timeline.export` 队列即可），API 契约不会因此改变。
4. **发布前置**：必须先有一次成功成片（`timeline_exports.status=3`），否则 400105。
   竞品 `wf/publish` 是否自带合成没有取证；我方选择"先导出再发布"，避免发布记录长期停在失败态。
5. **分享落地页未做**：只发 `share_token`，没有 `/publish/:token` 播放页（竞品有独立发布页，路由未取证）；
   现有 `/share/[token]` 是任务分享的 token 空间，不能混用。
6. **clip assets 是 `clips[].assets` 可选字段**：既有 `timeline.spec` 断言了 clip 的键集合，
   恒有字段会破坏契约；因此"没有绑定就不出现该字段"。这是为了零回归做的取舍。
7. **parse 备份存 storage 而不是新表**：本轮 schema/迁移由 Lead 独占；备份是一次解析的完整产物，
   放对象存储天然合适。若后续要按集查历史，把 `latest.json` 的索引落表即可（契约不变）。
8. **`/works` 的画布侧无封面/缩略图**：只读投影只给节点统计（画布表没有封面列）；不臆造。
9. **parse 与竞品语义差异**：竞品 `episode parse` 是"AI 拆解提示词成草稿"，我方 `storyboards/generate`
   已覆盖该能力；本轮的 `parse` 按任务书定义为"贴分镜表 → storyboards"，两者不冲突但**路径语义不同**，
   已在 api-spec 待补说明。

---

## 5. 需要 Lead 做

1. **worker 新增 publication handler**（可选但建议）：复用 `timeline.export` 队列与既有 ffmpeg 工具，
   按 `slice.start_ms/end_ms` 真裁剪并把状态写回 `timeline_publications`；API 侧现在这段逻辑可直接改调 queue。
2. **api-spec 文档**：补 10 条端点 + §4 的偏离说明（docs 归 Lead）。
3. **迁移/表**：`prompt_blocked`（上轮遗留）与本轮无新增表需求；若要发布页/解析历史，需要
   `publication_share_pages` 或 `parse_backup_index` 之类的新表（当前都不阻塞）。
4. **前端浏览器实跑**：`/works`（三 tab + 筛选）与 `/reelflow/edit/:id`（切片发布 / 片段资产面板）
   需要登录态页面验证；我这边只到 `vue-tsc` 通过 + lint 0 error。
5. **文档口径**：quality-check 的"无竞品字段证据"需要在 api-spec 的"待取证"清单里留痕。

---

## 6. 未完成（诚实列出）

- **前端未做浏览器实跑**：无可用登录态截图/E2E；人工步骤：
  `/works` → 切「画布项目」→ 关键词筛选 → 回「工坊项目」；`/reelflow/edit/:id` → 顶栏「切片发布」→ 发布 →
  等状态到「可播放」→ 复制 token / 下架；时间线选片段 → 「片段资产」→ 绑定镜头产物/项目资产。
- **切片真裁剪未做**（见 §4.3）：当前转码是产物复制，`slice.start_ms/end_ms` 只记录不裁剪。
- **发布分享播放页未做**（见 §4.5）。
- **quality-check 未接进生成入口**：按任务要求"只读"，仅作投递前预检；若要阻断投递需另接入
  `batchGenerateVideos`（本轮未做，避免改变既有 400105 逐镜语义）。
- **`/works` 画布侧无封面**（见 §4.8）。
- 未跑全仓 `pnpm test`（多人并行会互相干扰，按约定由 Lead 统一跑）；本轮只跑了任务要求的 6 个 spec。

---

## 7. 追加小单：`script_projects.source_novel_id` 接线（迁移 0026）

**背景**：novel 侧 `reopen` 靠"正文快照比对"判断"这本有没有被拆集"，项目正文被改写后会漏判。
Lead 加列 `script_projects.source_novel_id bigint null`（FK novels.id，索引 `idx_script_projects_source_novel`）。
本轮把它接上线（**未改 novel 模块**）。

### 7.1 改动

1. `splitEpisodes` 的 `source.kind='novel'` 分支：在**同一事务**里 `update script_projects set source_novel_id = nt_id`，
   且**已存在不覆盖**（`project.sourceNovelId !== null` 时跳过）——一个项目先后被两个本子拆过时，
   保留最初来源才与"这本被拆过"的判据一致；覆盖会让 novel 侧判错本子。
   非 novel 来源（脚本正文/项目原文拆集）不写该列，保持 `null`。
2. `projectDto` 透出 `source_novel_id: string | null`（`GET /projects/:id` 可见，novel 侧与前端可直接查）。
3. 前端 `types/api.ts` 的 `ProjectDto` 追加可选 `source_novel_id?: string | null`。

### 7.2 新增/加强的 spec（`test/asset-match.spec.ts`，11 → 12 例）

- 既有 split 用例加强：
  - 非 novel 来源拆集后 `GET /projects/:id` → `source_novel_id === null`；
  - 未定稿本子被拒（400100）时**不得写入** `source_novel_id`（否则 novel 侧会误判已被拆集）；
  - novel 来源拆集成功后 → `source_novel_id === ntId`。
- 新增用例「二次拆集保留首个来源」：先用本子 A 拆集 → 写入 A；再用已定稿的本子 B 重拆同一项目（集未确认，允许）→
  `source_novel_id` 仍为 A（不覆盖）。

### 7.3 实测

```
$ npx vitest run --no-file-parallelism test/asset-match.spec.ts
 ✓ test/asset-match.spec.ts (12 tests)  Test Files 1 passed (1) · Tests 12 passed (12)

# 受 projectDto 形状影响的回归（串行）
$ npx vitest run --no-file-parallelism test/pipeline.spec.ts test/works-aggregate.spec.ts \
    test/flow.spec.ts test/episode-quality.spec.ts test/reelflow-publish.spec.ts \
    test/timeline.spec.ts test/project-assets.spec.ts
 ✓ 7 files / 76 tests passed

$ pnpm --filter @app/api lint      → 0 error（整包绿）
$ pnpm --filter @app/web typecheck → 0 error（整包绿）
$ npx tsc --noEmit -p tsconfig.json | Select-String 'modules/(script|subjects|extraction)' → 无输出（我的模块 0 错）
```

### 7.4 待 Lead 注意

- `source_novel_id` 是外键（`references novels.id`，无 ON DELETE）：**删除本子前**必须先清掉引用它的
  `script_projects.source_novel_id`（或在迁移里改成 `on delete set null`），否则 novel 删除会被外键拒绝。
  当前 novel 侧删除路径不在我范围内，请 novel-api/数据层统一口径。
- 该列只在 novel 分支写一次；若要支持"改绑来源本子"，需要显式端点（本轮未做，避免臆造语义）。
