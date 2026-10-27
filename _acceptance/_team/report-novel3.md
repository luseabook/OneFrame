# 小说原创链薄路径补齐（task-23）交付报告

> 执行人：teammate `novel-api` · 任务：`task-23`（模块 #2 95%→99%，权重 8）
> 前序：改编链 64 路由（`report-novel.md`）→ 原创链 20 路由 + reopen + 4 薄路径（`report-novel2.md`）
> 本轮：`original_script/characters/*` 5 条 + 原创 `idea/:ni_id` 详情/编辑 2 条 + 前端接线
> 日期：2026-10-27

---

## 1. 交付

### 1.1 novel 域路由：**90 → 97 条**（新增 7）

| 路由 | 竞品证据 | 实现 | 说明 |
|---|---|---|---|
| `GET /novel/:nt/original_script/characters` | `routes.txt:549`（`original_script/characters`） | **别名** → `NovelService.listCharacters` | 与 `content-analysis/detail` 的 characters 同一份查询 |
| `POST .../characters/generate` | `routes.txt:549` 的写动作 + `novel.md:482-502`（`novel character NT_ID` 触发原创核心角色生成） | **别名** → `NovelService.generateCharacters` | 与 `novel_character_cards/generate` 同一实现 |
| `POST .../characters` | `routes.txt:552`（`characters/add`） | **别名** → `NovelService.createCharacter` | 同名即覆盖 → 幂等（`replayed`） |
| `PATCH .../characters/:nc_id` | `routes.txt:550`（`characters/:nc_id`） | **别名** → `NovelService.patchCharacter` | 同一行、同一字段集 |
| `POST .../characters/:nc_id/confirm` | 竞品无同名路径；语义取 `routes.txt:523-525`（`core_character`）与 `episode/:ne_id/confirm` 的"确认"口径 | **别名** → `NovelService.confirmCharacter` | 置 `is_core=true`，重复确认幂等 |
| `GET /novel/:nt/original_script/idea/:ni_id` | `routes.txt:558` | `NovelOriginalService.getIdea` | 读 `novels.meta.original.ideas[]` |
| `PATCH .../idea/:ni_id` | `routes.txt:558`（同路径写动作） | `NovelOriginalService.patchIdea` | 改标题/卖点/题材/基调；下游已生成时回显 `downstream_stale` |

**为什么是"别名"而不是复制一套逻辑（写在代码注释里、这里复述判断依据）**：

竞品把原创链单列这 5 条，是因为它的原创/改编是两套独立工程。我方两条链共用**同一张
`novel_characters` 表**、同一套 `is_core` 语义、同一套"同名合并/幂等覆盖"规则。
如果在这 5 条路径上再实现一遍生成/确认，会出现第二份真相：
同一张卡在两个入口表现不同、`is_core` 互相打架、用户改一处另一处不刷新。

所以本轮只加**前缀转发**：
- 列表三个入口现在都走 `NovelService.listCharacters`（**本轮把 `analysisDetail` 也改成调用它**，消掉重复查询）；
- 生成/新增/编辑直接复用 `generateCharacters` / `createCharacter` / `patchCharacter`；
- 确认新增 `NovelService.confirmCharacter`（**唯一实现**：置 `is_core`），原创链与 `core_character` 都指向它。
- 请求 schema 也复用既有 `charactersGenerateSchema` / `novelCharacterCreateSchema` / `novelCharacterPatchSchema`（不新增第三套校验口径）。

**`confirm` 落在 `is_core` 的理由**：`novel_characters` 只有 `is_core` 一列
（`packages/db/src/schema.ts`），没有 status 列且本轮不改 schema；业务上"确认这张卡"要表达的
正是"进入核心角色集合（可用于资产一致性）"，因此它与 `core_character` 子链是同一字段的两次入口，不做第二套状态机。

**`idea/:ni_id` 的存储位置**：`novels.meta.original.ideas[]`（上轮落点，`novel-original.service.ts` 是唯一写者）。
不存在 → `400102`；空 body → `400101`；已选中也可编辑（用户就是想改措辞），但下游（素材/总纲）已生成时
返回 `downstream_stale: true` **提示而不自动级联重置**（删掉用户已改过的总纲比留个提示更糟）。

### 1.2 前端（复用 `NovelOriginalChain.vue`，未重写）

- **新增「② 角色卡」区块**（竞品顺序：方案 → 角色 → 素材 → 总纲…，`novel.md:437-661`）：列表、生成、确认（出现「核心」标记）、编辑（内联表单）、新增（姓名 + 类型 + 描述）。
  区块内注明"与内容分析/核心角色是同一份数据"，避免用户以为是两套角色卡。
- **创意方案卡片加「编辑」**：点击先 `GET idea/:ni_id` 拉最新值再进编辑（列表可能是几分钟前拉的），保存走 `PATCH`；后端提示 `downstream_stale` 时 Toast 明确告知"下游素材/总纲仍是旧方案的"。
- 章节编号随插入调整为 ①方案 ②角色卡 ③素材 ④总纲 ⑤分卡章纲 ⑥集纲 ⑦分集剧本 ⑧定稿。

---

## 2. 测试

### 2.1 新增 2 例（`apps/api/test/novel-original.spec.ts`：15 → **17 例**）

**例 1 `idea/:ni_id`**：详情（含 `selected=false`、`total`、`user_input`）→ 编辑（标题/卖点/基调生效，其它方案不受影响）
→ 选中后详情回显 `selected=true`（证明读写同一份 meta，不是两份状态）→ 已选中仍可编辑、且下游已生成时 `downstream_stale=true`
→ 不存在 `400102` / 空 body `400101` / 跨 space `403`。

**例 2 characters 5 条薄路径**：
生成 2 张（`count:2`）→ 列表包含同一批 id → 新增（`replayed=false`）→ 同名再新增（`replayed=true`，id 不变，不产生第二张卡）
→ 编辑描述 → 确认（`is_core=true, replayed=false`）→ 重复确认（`replayed=true`）
→ **跨路径一致性**：`GET /novel/:nt/core_character/list` 读到**同一条**（同 id、同修改后描述）；
`GET /novel/:nt/content-analysis/detail` 的条数 = 薄路径列表数 + 1（新增那张），不存在"影子表"
→ `404`（编辑/确认不存在的 nc_id）、`400101`（空 body、非法 nc_id）、`400100`（改编本子走原创链）、`403`（跨 space 两条）。

> 跨路径一致性这条是本次的核心断言：**写薄路径 → 走 `core_character` 读到同一条**，
> 才证明是别名而不是副本（若哪天有人复制一套逻辑，这条会红）。

### 2.2 实测（`app\apps\api`）

```
npx tsc --noEmit -p tsconfig.json 2>&1 | Select-String 'modules/novel'   → 空（0 错）
npx eslint src/modules/novel                                              → 0 errors

npx vitest run test/novel.spec.ts test/novel-original.spec.ts
 ✓ test/novel-original.spec.ts (17 tests) 1005ms
 ✓ test/novel.spec.ts (25 tests) 1186ms
 Test Files  2 passed (2)
      Tests  42 passed (42)
```

**稳定性**：连跑 3 次均 42/42（run1/run2/run3 全绿；既有 40 例无退化）。
**web**：`npx eslint pages/novel components/novel types/api.ts` → 0 错；
`npx vue-tsc --noEmit -p tsconfig.typecheck.json | Select-String 'pages/novel|components/novel|types/api'` → 空。

### 2.3 页面验收：**本轮未能跑通（环境原因，非代码）**

两次尝试与结论：

1. **共享 `:3003` 是预构建产物，不是 dev**：进程命令行是 `node .output/server/index.mjs`
   （preview/build 输出），因此本轮对 `components/novel/*` 的修改**不可能**出现在该实例上。
   实测：新建原创本子后页面里没有「② 角色卡」、方案卡没有「编辑」入口（说明拿到的是上轮编译产物）。
2. **我另起隔离 dev 实例（`:3103`）也没有跑通**：Nuxt dev 起来了（日志显示 `Local: http://localhost:3103/`），
   但对**所有** HTTP/1.1 请求（含 `/`、`/novel`、加 `Accept: text/html`、`curl --http1.1`、`--http2`）一律返回
   `426 Upgrade Required`（`content-type: text/plain`，16 字节），浏览器侧无法渲染。属该环境 dev server 的可达性问题。

**因此页面层结论**：代码层（`eslint` + `vue-tsc`）0 错，API 层 42 例覆盖了这 7 条路径的全部语义与跨路径一致性；
**"点击可用"没有本轮实测证据**。复验步骤（需 web 侧重新构建/重启，属共享基础设施，我没动）：
```
cd E:\wanxing\app; pnpm --filter @app/web build        # 重新产出 .output
# 重启 web（当前是 node .output/server/index.mjs）
# 手工点：/novel → 新建原创剧本 → 工作台「原创链」→ 生成创意方案 → 选定一个
#        → ② 角色卡：生成角色卡 / 确认（出现「核心」）/ 编辑 → 保存 / 新增角色
#        → ① 创意方案卡片「编辑」→ 改标题 → 保存方案（回显新标题）
```

---

## 3. 已知偏离 / 待取证

1. **`POST .../characters/:nc_id/confirm` 是竞品没有的路径**（我方语义：确认 = 置 `is_core`）。
   依据是 `core_character`（`routes.txt:523-525`）与既有 `episode/:ne_id/confirm` 的确认口径；已在代码注释写明。
2. **竞品 `routes.txt:551`（`characters/:nc_id/delete`）与 `:553`（`characters/batch-rename`）仍未实现**：
   删除角色卡在改编链已有 `DELETE /content-analysis/novel_character_cards/:ncc_id`；批量改名是运营向能力
   （原创链当前 UI 无批量入口），为避免"为凑路径数加无入口的端点"本轮不做 —— 需要时再补 2 条薄路由。
3. **`idea/:ni_id` 的编辑不做级联重置**：只回显 `downstream_stale`。级联会毁掉用户已编辑的下游产物。
4. `confirm` 的幂等语义是"已是核心角色则 `replayed:true`"，不是"写入失败"。

---

## 4. 需要 Lead 做

1. **web 侧重新构建/重启**后才能做页面层点验（见 §2.3 步骤）。当前 `:3003` 是上轮编译产物。
2. 不在我域内的门禁红（本轮实测）：`api tsc` → `modules/ad/ad-drama.service.ts(827,11) TS2741`、
   `modules/tasks/tasks.service.ts(638/641/642) Cannot find name 'MAX_SHARE_PACK_FILES'`；
   （按你上轮分派，`home.service` lint 与 `captcha` tsc 已由 cli-build 处理，本轮未见它们再报错。）

---

## 5. 未完成（诚实清单）

1. 竞品 `characters/:nc_id/delete`、`characters/batch-rename` 两条薄路径（理由见 §3.2）。
2. **页面层实测证据缺失**（环境：`:3003` 为编译产物、隔离 dev 实例 426；代码层 lint/typecheck 已 0 错，API 层 42 例覆盖）。
3. 原创 `idea` 的"新增/删除方案"未做（竞品 `idea` 只有 list / set / select-op，没有增删）。

---

## 6. 文件清单

改动（均在授权范围）：
- `apps/api/src/modules/novel/novel.service.ts`：新增 `listCharacters`（唯一查询）+ `confirmCharacter`（唯一确认实现）；`analysisDetail` 改为复用 `listCharacters`
- `apps/api/src/modules/novel/novel-original.service.ts`：`getIdea` / `patchIdea` + 5 个角色卡别名方法
- `apps/api/src/modules/novel/novel-original.controller.ts`：+7 路由（`characters` 5、`idea/:niId` 2）
- `apps/api/src/modules/novel/novel.schemas.ts`：+`originalIdeaPatchSchema`（角色卡生成/新增/编辑复用既有 schema，未新增）
- `apps/api/test/novel-original.spec.ts`：+2 例（15→17）
- `apps/web/components/novel/NovelOriginalChain.vue`：+角色卡区块（生成/列表/新增/编辑/确认）、+方案编辑、章节重编号
- `apps/web/types/api.ts`：**本轮未改**（`NovelCharacterDto` / `NovelOriginalIdeaDto` 上轮已存在，直接复用）

未改动：`packages/db/src/schema.ts`、迁移、`app.module.ts`、`docs/**`、`layouts/app.vue`、`nuxt.config.ts`、
`modules/script`、`pages/home|team|assets|works`、其他域模块与 spec。
