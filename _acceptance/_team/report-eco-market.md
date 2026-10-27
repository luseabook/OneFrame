# 第 6 批 B：剧本集市 novel_market + 集市 Admin + 团队知识库（模块 #12 / #18）

> 执行人：teammate `eco-market` · 日期：2026-10-27 · 任务：`task-9`
> 执行标准：ADR-013「竞品怎么做我们就怎么做」——有证据照做，无证据不臆造并登记待取证
> 代码位置：`app/apps/api/src/modules/market/**`、`app/apps/api/src/modules/knowledge/**`、
> `app/apps/api/test/market.spec.ts`、`app/apps/api/test/knowledge.spec.ts`、
> `app/apps/web/pages/novel-market/**`、`app/apps/web/pages/knowledge/**`
> 数据层：**迁移 0030 已落地**（`market_categories` / `market_tags` / `market_review_logs` /
> `market_works.category_id|tag_ids` / `market_withdrawals.work_id`；`creditOut.kind` 放宽为
> `"refund" | "consume"`）。本文档已按 0030 后的实现重写。

---

## 1. 交付总览

| 项 | 数量 | 说明 |
|---|---:|---|
| 集市 C 端 + 创作者侧 `GET/POST/PATCH/DELETE /v1/market/*` | **36** | 竞品 `df/novel_market` 29 端点全覆盖，另补「买断」「账户维度提现」「提现列表/撤销」7 条 |
| 集市 Admin `/v1/ops/market/*` | **22** | 竞品 `rmadminsrv/novel_market` 12 端点全覆盖，另补提现审核状态机 3 条、待审别名 1 条、作品详情 1 条 |
| 团队知识库 `/v1/knowledge/*` | **29** | 竞品 `df/user_knowledge` 29 端点中 25 条 1:1 对应，4 条（知识库实体 CRUD）**明确不做**并说明理由 |
| 前端页面 | **4** | `/novel-market`、`/novel-market/:id`、`/novel-market/manage`、`/knowledge` |
| 后端测试 | **32 例** | `market.spec.ts` 18 例 + `knowledge.spec.ts` 14 例，全绿且**可重复运行** |
| 迁移 0030 收口 | **4 项** | 分类/标签真表、审核留痕、提现作品归属、扣分 kind 语义 |

### 1.1 集市（`/v1/market`，36 端点）

浏览与详情（公开可看，正文另需购买凭据）：

```
GET    /market/scripts                          列表/搜索/分类/标签/分页   (rt:614)
GET    /market/scripts/config                   集市配置（分类·标签·抽成·提现门槛） (rt:620)
GET    /market/scripts/promotions               推广位（读 promo_slots） (rt:621)
GET    /market/scripts/:id/detail               作品详情 (rt:625)
GET    /market/scripts/:id/timestamp            增量时间戳 (rt:629，语义待取证)
GET    /market/scripts/:id/author               作者 (rt:617)
GET    /market/scripts/:id/business             商务条款 (rt:618)
GET    /market/scripts/:id/creator              创作者资料 (rt:619)
GET    /market/scripts/:id/agreement            协议正文（购买/预售/授权三类） (rt:615)
GET    /market/scripts/:id/agreement-file       协议附件下载（text/plain） (rt:616)
```

内容读取（**需已购凭据**，无凭据 403101 `reason=not_purchased`）：

```
GET    /market/scripts/:id/content-tree         章节/分集大纲/分集剧本结构树 (rt:624)
GET    /market/scripts/:id/characters           角色卡 (rt:623)
GET    /market/scripts/:id/episodes             分集剧本（闭区间） (rt:627)
GET    /market/scripts/:id/download             下载已购正文（text/markdown） (rt:626)
POST   /market/scripts/:id/parse                已购作品只读解析（不写库）
```

交易（**钱只走账本**）：

```
POST   /market/scripts/:id/buy                  立即买断 → creditOut(kind=consume)
POST   /market/scripts/:id/preorder             预售定金 → creditOut(kind=consume)  (rt:628)
POST   /market/scripts/:id/cancelorder          取消预售并退定金 → creditIn(adjust)  (rt:622)
```

创作者侧：

```
GET    /market/creator/profile                                   (rt:601)
GET    /market/creator/works                                     (rt:604 GET)
POST   /market/creator/works                                     上架（可直接 submit）
POST   /market/creator/works/save                                存草稿（强制留 draft） (rt:612)
POST   /market/creator/works/parse                               本子→上架表单建议值 (rt:611)
GET    /market/creator/works/stats                               创作者数据 (rt:613)
GET    /market/creator/works/:id                                 (rt:605)
PATCH  /market/creator/works/:id                                 编辑（含改分类/标签）
POST   /market/creator/works/:id/submit                          提交审核 (rt:609) + 留痕
POST   /market/creator/works/:id/offline                         下架 (rt:608) + 留痕
GET    /market/creator/works/:id/agreement                       创作者视角协议 (rt:606)
GET    /market/creator/works/:id/content-tree                    创作者视角内容树 (rt:607)
GET    /market/creator/revenues                                  收益明细 (rt:602)
GET    /market/creator/revenues/overview                         收益总览 (rt:603)
POST   /market/creator/works/:id/withdraw                        以某作品收益名义提现（落 work_id 列） (rt:610)
POST   /market/creator/withdraw                                  账户维度提现（我方补）
GET    /market/creator/withdrawals                               我的提现列表（我方补）
POST   /market/creator/withdrawals/:id/cancel                    撤销（状态机 1→5）
```

### 1.2 集市 Admin（`/v1/ops/market`，22 端点，AdminGuard 隔离）

```
GET    /ops/market/scripts/list                 作品列表（默认待审） (rt:105)
GET    /ops/market/scripts/pending              待审列表别名
GET    /ops/market/scripts/:id                  作品详情（运营视角，**含 review_logs 审核轨迹**）
POST   /ops/market/scripts/:id/submit-review    双段式第一段：送审（记 operator_admin_id） (rt:109)
POST   /ops/market/scripts/:id/review-result    双段式第二段：通过/驳回（audit_note 必填于驳回） (rt:107)
GET    /ops/market/scripts/:id/source-original-script   原始剧本溯源 (rt:108)
POST   /ops/market/scripts/save-draft           运营代存草稿 (rt:106)
GET    /ops/market/dashboard/scripts            集市看板 (rt:102)
GET|POST|PATCH|DELETE /ops/market/categories(/:id)      分类 CRUD（**删除=停用 status=2**） (rt:100-101)
GET|POST|DELETE /ops/market/tags(/:id)                  标签 CRUD（删除=物理删+摘除作品引用） (rt:110-111)
GET|POST|PATCH|DELETE /ops/market/promotions(/:id)      推广位 CRUD（写 promo_slots） (rt:103-104)
GET    /ops/market/withdrawals                  提现列表（我方补）
POST   /ops/market/withdrawals/:id/review       提现审核 1→2 / 1|2→4
POST   /ops/market/withdrawals/:id/payout       打款回填 2→3（跳步 400101）
```

### 1.3 团队知识库（`/v1/knowledge`，29 端点）

```
GET    /knowledge/dirs                  目录树（扁平 list + 嵌套 tree + 每节点直属资产数） (rt:755)
POST   /knowledge/dirs                  建目录（深度 ≤5） (rt:741)
PATCH  /knowledge/dirs/:id              改名 (rt:750)
POST   /knowledge/dirs/:id/move         移动（拒成环、拒超深） (rt:756)
DELETE /knowledge/dirs/:id              删目录（**级联软删**子树 + 子树内资产） (rt:749)
GET    /knowledge/tags                  标签列表（带使用计数/僵尸标记） (rt:762)
POST   /knowledge/tags                  建标签（同名幂等） (rt:761)
PATCH  /knowledge/tags/:id              改名（**同步改写资产标签文本**） (rt:764)
DELETE /knowledge/tags/:id              删（**同步从资产数组摘除**） (rt:763)
GET    /knowledge/tags/:id/assets       按标签查资产（我方补）
GET    /knowledge/assets                资产列表（目录/含子目录/标签/类型/分页） (rt:746)
GET    /knowledge/assets/search         跨目录搜索（标题+正文） (rt:737)
POST   /knowledge/assets                新建文本/链接条目 (rt:745)
GET    /knowledge/assets/:id            单条详情
PATCH  /knowledge/assets/:id            编辑 (rt:743)
DELETE /knowledge/assets/:id            软删 (rt:742)
PATCH  /knowledge/assets/:id/tags       设置标签（整体替换） (rt:738)
POST   /knowledge/assets/:id/move       单条移动
POST   /knowledge/assets/batch-add-tags      (rt:751)
POST   /knowledge/assets/batch-remove-tags   (rt:754)
POST   /knowledge/assets/batch-move          (rt:753)
POST   /knowledge/assets/batch-delete        (rt:752)
POST   /knowledge/assets/import-from-asset   从资产库导入（**同 space 校验**） (rt:744-745)
POST   /knowledge/assets/:id/to-asset        导出到资产库（复制独立条目） (rt:748)
POST   /knowledge/assets/:id/resource/import 挂/换资产引用 (rt:744)
DELETE /knowledge/assets/:id/resource        解除引用（降级回文本） (rt:747)
GET    /knowledge/info                  知识库概览（三表聚合） (rt:757)
GET    /knowledge/list                  跨目录平铺列表 (rt:759)
GET    /knowledge/scriptwriter/list     按创建人聚合 (rt:760)
```

### 1.4 前端页面（4 个，均可真实点击）

| 路由 | 内容 | 关键交互 |
|---|---|---|
| `/novel-market` | 集市列表 | 关键词搜索、分类下拉、标签多选、分页、作者实收（按后端下发的抽成比例算）、复制详情链接、三态（加载/空/错误） |
| `/novel-market/:id` | 作品详情 | 买断 / 付定金（按 status 切换按钮，点错会被后端拒）、内容结构（未购显示"需先购买 + 购买按钮"）、角色卡、协议三 tab、正文下载（fetch blob） |
| `/novel-market/manage` | 上架管理 | 本子解析→自动填表、存草稿、提交审核、下架、收益 KPI、提现申请、提现状态机记录、成交明细 |
| `/knowledge` | 团队知识库 | 目录树（建/改名/级联删，含计数）、条目 CRUD、标签池勾选、按目录/标签/关键词筛选、从资产库导入、导出到资产库、批量移动/删除、标签管理（含"未使用"标记） |

页面遵守：`definePageMeta({ ssr:false, requiresAuth:true, layout:"app" })`、请求全走 `useApi()`、
金额用 `toLocaleString()`、颜色/间距/圆角**只用 `assets/css/tokens.css` 已有令牌**（未新造令牌）、
三态齐全（无"点了没反应"的按钮）。

---

## 2. 验收实测（贴关键输出）

### 2.1 后端测试（真实 AppModule + 真 dev 库 PG 55432）

```
$ cd app/apps/api; npx vitest run --no-file-parallelism test/market.spec.ts test/knowledge.spec.ts
 ✓ test/market.spec.ts (18 tests) 1206ms
 ✓ test/knowledge.spec.ts (14 tests) 742ms
 Test Files  2 passed (2)
      Tests  32 passed (32)
   Duration  6.63s
```

**可重复性**（这是上一轮 Lead 复跑失败的原因，已修）：连跑两遍均 18/18——

```
=== RUN 1 ===  Tests 18 passed (18)
=== RUN 2 ===  Tests 18 passed (18)
```

覆盖分布（逐端点语义，非凑数）：

| spec | 例数 | 覆盖 |
|---|---:|---|
| `market.spec.ts` | 18 | 上架全链 **+ 审核留痕(review_logs 提交/通过各一条、运营 id/作者 id 归属正确)** / 提交前置 / 审核不可逆 / 驳回留痕与重提 / 购买扣分与 20% 抽成 / 购买幂等 / 余额不足 745701 且零副作用 / 自购与未上架拒买 / 内容闸门 403 / 预售落"预售中" / 定金退款与收益减回 / 买断不可退 / 收益总览与提现门槛 / **同用户仅 1 笔待审** / **跳步打款 400101** / 正序 待审→通过→打款 **+ work_id 落列** / 撤销提现边界 / 分类标签筛选 **+ 标签删除摘引用 + 分类删除=停用** / 推广位上下线 / admin 鉴权 403+401 / 跨 space 403 / 协议三类与附件 |
| `knowledge.spec.ts` | 14 | 目录树嵌套与 asset_count（**树节点也要有**）/ 深度上限 5 / 同名与成环 / 级联软删（含计数） / 标签改名同步资产 / 删标签摘除 / 未知标签 400101 / 资产 CRUD+搜索 / 标签"且"语义+分页 / 批量四动作 / 导入同 space + 跨 space 403 / 导出与解除引用 / 概览口径一致 / 多租户隔离 / 参数校验 |

### 2.2 静态门禁

```
$ pnpm --filter @app/api typecheck
> tsc --noEmit -p tsconfig.json        # 0 error（exit 0）

$ pnpm --filter @app/api lint
> eslint src                            # 0 error（exit 0）

$ pnpm --filter @app/web typecheck
> nuxt prepare && vue-tsc --noEmit -p tsconfig.typecheck.json   # 0 error（exit 0）

$ pnpm --filter @app/web lint
> eslint .                              # 0 error（12 warning 全在他人存量页面；我的 4 个页面 0 warning）
```

### 2.3 curl 走查（真服务 `:3021`，`/v1` 前缀；作者/买家/访客三个独立账号）

```
STEP0 author_space=108390258081611777 buyer_space=108390258354241537
STEP1 save_draft   code=0 status=1/草稿 price=1000
STEP2 submit       code=0 status=2/待审核                    ← 写 review_logs(action=1)
STEP3 admin_approve code=0 status=3/在售 published_at=...    ← 写 review_logs(action=2)
STEP4 create_order/mock_pay code=0 credits=1200              ← 买家余额从账本入口进
STEP5 buy          code=0 price=1000 commission=200 revenue=800 balance_after=280 idempotent=False
STEP6 buy_again    code=0 idempotent=True balance_after=     ← 幂等：未再扣分
STEP7 revenue_overview code=0 revenue=800 available=800 locked=0 commission_bps=2000
STEP8 withdraw_apply   code=0 amount=500 status=1/待审核
STEP9 payout_skip_step code=400101 msg=withdrawal must be approved before payout (status=1)   ← 跳步拒绝
STEP10 withdraw_approve code=0 status=2/已通过
STEP11 payout          code=0 status=3/已打款 paid_at=...
STEP12 market_list     code=0 in_list=True status_name=在售
STEP12 content_tree(outsider) code=403101 msg=purchase required to read this work's content
```

知识库 curl 走查：

```
K2 create_dir            code=0 depth=1
K3 create_child          code=0 depth=2
K4 create_tag            code=0
K5 create_asset          code=0 source_type=文本
K7 dir_tree              code=0 count=2
K8 info                  code=0 dirs=2 assets=1 tags=1 max_depth=5
K9 delete_dir_cascade    code=0 dirs=2 assets=1        ← 级联软删
K10 assets_after_cascade code=0 total=0
K11 cross_space_spoof    code=403101 msg=not a member of requested space
```

> 说明：`content_tree(buyer)` 在走查里返回 400102 是因为那次用的是**外部投稿**（未关联本子）；
> 关联本子的内容树/角色/正文下载在 `market.spec.ts`「内容闸门」用例里用真实本子+章节验证通过
> （`chapter_count=2`、`total_word_count=6`、`download` 返回 `text/markdown` 且含"第一章"）。

---

## 3. 竞品证据对照（ADR-013）

| 我方能力 | 竞品证据 |
|---|---|
| 集市 29 端点全集与子链切分（浏览/详情/协议/交易/创作者侧） | `_parts/d-commerce-account.md:391-402`（§6.2 表）、`routes.txt:601-629` |
| 详情/内容树/角色/分集/时间戳 | `routes.txt:623-629` |
| 作者/商务/创作者三元资料 | `routes.txt:617-619` |
| 协议（购买/预售/授权）与协议附件 | `routes.txt:615-616`；`d-commerce-account.md:414-417`（§6.4：agreement 出现 4 次构成合规件） |
| 预售 `preorder` / 取消 `cancelorder` / 下载 `download` | `routes.txt:628`、`:622`、`:626` |
| 集市配置 / 推广位 | `routes.txt:620-621` |
| 创作者侧 上架/编辑/存草稿/解析/统计/上下架 | `routes.txt:604-613` |
| 收益明细 / 收益总览 / 提现（按作品） | `routes.txt:602-603`、`:610` |
| **收益不进积分余额、按作品分账** | `d-commerce-account.md:415-417`、`schema.ts:2425-2427`（迁移 0030 后由 `market_withdrawals.work_id` 真列承载） |
| Admin 双段式审核（submit-review → review-result） | `routes.txt:109`、`:107`；`d-commerce-account.md:404-412`（§6.3） |
| Admin 是独立服务域、与 C 端物理隔离 | `d-commerce-account.md:412` |
| Admin 分类/标签/推广位 CRUD | `routes.txt:100-104`、`:110-111` |
| 原始剧本溯源（平台持有上游原始剧本） | `routes.txt:108`、`d-commerce-account.md:412` |
| 知识库三层（目录/标签/资产）+ 与项目资产互通 | `routes.txt:737-765`；`d-commerce-account.md:357-361`（§5.7） |
| 知识库 4 个批量动作 | `routes.txt:751-754` |
| 知识库权限码 knowledge.view/create/edit/delete | `d-commerce-account.md:279`（§5.2 权限码表） |
| 集市在竞品里是内容供给入口（与创作者中心是两套体系） | `d-commerce-account.md:365-371`（§6 首表）、`reelmate-feature-map.md:341` |

---

## 4. 关键设计（为什么这么写）

### 4.1 钱：一条路，可对账

- **收**（买家付出）：`creditOut(kind="consume")` 在**事务内**锁账户 → 校验余额 → 写负向流水 → 更新余额。
  `kind` 用 `consume` 而不是 `refund`：`ledger.ts:178-184` 明确"把 consume 记成 refund 会让财务对账的
  退款金额虚高"，两者共用一个函数但语义不同。
- 余额不足抛 `INSUFFICIENT_BALANCE=745701`，**整个事务回滚**（余额、协议、销量、收益都不留痕）。
- **退**（预售定金取消）：`creditIn(kind='adjust')` 正向回冲 + 写反向协议行（`kind=4`）+ 收益同额减回。
- **不变量**：`revenue_credits == Σ(已生效协议价 − 抽成)`——购买/预售 `+=`，取消 `-=`，同源
  `revenueOf(price)`，因此恒等（用例验证 800 → 0）。
- **钱不进 `credit_accounts`**：`revenue_credits` 只累计，提现走 `market_withdrawals` 人工审核。
  **没有任何代码直接改 `balance`**。
- 抽成：常量 `MARKET_COMMISSION_BPS=2000`（`market.constants.ts`），文件头写明
  「运营未拍板，仅初值」，并由 `GET /market/scripts/config` 下发给前端；已成交协议不回算。

### 4.2 状态机：不可逆与跳步

作品 `1 草稿 → 2 待审 → 3 在售 / 6 预售中`，`2 → 4 已驳回`，`3|6 → 5 已下架`：
- `3/5/6 → 2` 拒绝（必须先 offline）；`4 → 3` 拒绝；`非 2` 出审核结论一律 400101。
- 驳回必须带 `audit_note`；驳回后可重新提交成新待审，历史行不改。
- **每次状态迁移都写 `market_review_logs`**（1 提交 / 2 通过 / 3 驳回 / 4 下架），
  与状态变更**同事务**：失败一起回滚，不会出现"状态变了但没留痕"。

提现 `1 待审 → 2 已通过 → 3 已打款`，`1|2 → 4 已驳回`，`1 → 5 已撤销`：
- **`1 → 3` 拒绝**（`withdrawal must be approved before payout`），有专门用例。
- **同一用户同时只能 1 笔待审**：`pg_advisory_xact_lock(hashtext('market_withdraw:<uid>'))`
  在事务里串行化"查+插"（行锁锁不住还不存在的行）。
- 终态（3/4/5）再审 400101；`2 → 5`（已通过后用户撤销）拒绝，避免"撤销后又到账"。

### 4.3 内容闸门：凭据而不是同空间

买家与作者**不在同一 space**，所以不能复用 `NovelService`（它按 `novels.space_id` 判权）。
集市自带查询 + `assertEntitled`：作者本人 or 存在**已生效**购买/预售协议，否则 403 `reason=not_purchased`
（前端据此弹"去购买"而不是报错）。

### 4.4 知识库：级联软删（二选一已写明）

删目录 = **级联软删**整棵子树 + 子树内资产（`deleted_at` 打点，行保留可恢复），返回 `{dirs, assets}` 计数。
理由：竞品目录/资产本身就是软删语义（`schema.ts:2235-2237`），拒绝删除会把"整理目录"变成逐层清空的苦活。

配套一致性规则：
- **标签改名/删除要同步改写资产上的标签文本**（`array_replace` / `array_remove`）；
- **深度 ≤5 与成环**只能靠服务层拦（`knowledge_dirs.parent_id` 无自引用外键）。

### 4.5 双向导入的同 space 红线

`import-from-asset` / `to-asset` / `resource/import` 三处都校验 `assets.space_id == 当前 space`，
跨团队返回**403**（不是 404）：这是"存在但你不能用"，前端要能区分"素材已删"与"没权限"。

### 4.6 分类/标签：真表 + 两种"删除"语义不同

迁移 0030 落地后（`market_categories` / `market_tags` / `market_works.category_id|tag_ids`）：
- 列表筛选是**纯 SQL**：分类等值、标签 `arrayContains`（「且」语义），走 `idx_market_works_category`。
- **删分类 = 停用（`status=2`）**，不物理删：`market_works.category_id` 没有反向级联，
  物理删会让历史作品的分类变悬空指针，按该分类筛选直接漏数据（schema.ts:3052-3056 记录了取舍）。
  用例断言：停用后 `config` 不再下发该分类，但作品仍挂着它。
- **删标签 = 物理删 + 从所有作品 `tag_ids` 摘除**（`array_remove`），返回受影响作品数；
  否则筛选会命中"已经不存在的标签 id"。
- 引用校验（`resolveRefs`）与写入**同一事务**：否则"分类刚被停用"与"作品写进去"之间会漏一个窗口。

---

## 5. 已知偏离 / 待取证

### ① 分类/标签已从"借用配置表"收口为真表（**已清零**）

迁移 0030 之前，分类/标签与"作品↔分类"归属曾塞进 `home_configs(scope='market.taxonomy')` 一行 JSON
（因为没有列，又不能让筛选变成假接口）。0030 落地后：`market-taxonomy.store.ts` **已删除**，
换成 `market-taxonomy.service.ts`（`market_categories` / `market_tags` / `market_works` 两列），
`providers` 已注册（不注册会让 `NestFactory.create(AppModule)` DI 直接失败、全仓 e2e 归零）。

### ② 审核历史已独立成表（**已落地**）

`market_review_logs(work_id, action, operator_admin_id, operator_user_id, note, created_at)`
承载完整轨迹；`market_works.audit_note` 退化为"最后一次意见"。
运营侧 `GET /ops/market/scripts/:id` 直接返回 `review_logs`。

### ③ 提现的作品归属已提为真列（**已落地**）

`market_withdrawals.work_id`（可空 = 账户级，非空 = 按作品结算）。新写入走列；
`workAvailable()` 同时认 `work_id` 列与旧的 `account_info.work_id`（否则迁移前写入的旧行
会让同一笔收益被重复申请）。

### ④ 竞品把"下单"收敛在一个 `preorder`，我方拆成 `buy` + `preorder`

`routes.txt:628` 只有 `preorder` 一个下单端点。我方拆两路，理由：定金可退、全款不可退，
同一端点无法在流水里区分两种账务（对账会互相污染）。这是**功能拆分不是合并**，端点覆盖不减。

### ⑤ 知识库 4 条端点明确不做（不造假）

竞品有 `user_knowledge/create|delete|update|info/update`（`routes.txt:739-740`、`:758`、`:765`）4 条
**知识库实体** CRUD → 说明"知识库"是独立实体（一个空间可建多个）。我方只有 `knowledge_dirs/tags/assets`
三表，语义是**「一 space 一知识库」**（实体即 space）。这 4 条**没有实现**；`info` 用三表聚合、
`list` 用跨目录平铺。要照做需 `knowledge_bases` 表 + `knowledge_dirs.base_id`。

### ⑥ 待取证（竞品行为未取证，不臆造）

| # | 项 | 我方口径 |
|---|---|---|
| U1 | **抽成比例**具体数值（`agreement`/`business` 只有端点存在，无参数/响应体） | 2000bps 初值，常量 + 文件头写明"运营未拍板"；`config` 下发 |
| U2 | **提现门槛** | `MARKET_MIN_WITHDRAW_CREDITS=100` 初值 |
| U3 | `scripts/:id/timestamp`（`routes.txt:629`）语义 | 定义为"内容版本时间戳"：`work_updated_at_ms`/`novel_updated_at_ms`/`server_time_ms` |
| U4 | `tag_ids` 多选是"且"还是"或" | 取"且"（同时带全部选中标签） |
| U5 | 目录树**深度上限**（竞品无任何痕迹） | 5 层（task 给定口径） |
| U6 | `asset/{uk_id}/tag`（`routes.txt:738`）是追加还是替换 | 定义为**整体替换**（`PATCH .../tags`） |
| U7 | `scriptwriter/list`（`routes.txt:760`）的"编剧"实体 | 我方无该角色枚举，实现为**按创建人聚合**，字段名保留以便前端 1:1 对照 |
| U8 | 作品解析"买断后能否二次改编/再发布" | `parsePurchased` **只读不写库**（`writable:false`），需产品先定许可范围 |

### ⑦ 其它工程偏离（均已注释说明）

- **真实打款不做**：`payout` 只回填运营在渠道侧打完款的凭证（`channel_refund_no` + `paid_at`），
  不接资金通道（合规/资质）。
- 推广位"删除"是**停用**（`status=2`），保留投放历史与曝光/点击计数。
- 预售退款用 `creditIn(kind='adjust')`：`creditIn` 的 kind 域是 `gift|recharge|adjust`（无 refund），
  正向回冲记 `adjust` + memo 写清 `market preorder refund`；若要严格语义化需给 `creditIn`
  加 `"refund"`（不在本批范围，登记）。

---

## 6. 修掉的三个真 bug（都被断言/走查抓到）

| # | 现象 | 根因 | 修法 |
|---|---|---|---|
| ① | 知识库目录树里每个节点 `asset_count` 恒为 0 | `dirTree` 先 clone 出树、再对**扁平 list** 补 `asset_count`，树节点是 clone 的旧对象拿不到新字段 | 把 `asset_count` 挪到**建树之前**写进节点；补断言 `tree[0].children[0].asset_count === 1` |
| ② | 建分类/标签后立刻读回来是空的 | taxonomy `mutate` 写成 `mutateFn(clone) ?? current`——调用方"就地 push 不返回"时 `??` 选回**未改动的 current**，就地修改被整丢 | `const next = mutateFn(draft) ?? draft`；随真表落地该文件已删除 |
| ③ | `market.spec` 第二次运行必挂"admin 建分类 400101" | 分类/标签是**平台级唯一名**且测试没清理，第二次运行撞唯一键（看起来像接口坏了） | 测试用随机后缀 + `afterAll` 按 id 硬删分类/标签；顺带修 `afterAll` 的**外键顺序**（`market_review_logs`/`market_withdrawals`/`market_agreements` 必须先于作品删）。连跑两遍验证 |

---

## 7. 需要 Lead 做

1. **`nuxt.config.ts` 加 `routeRules`**（我没有写权限）：
   ```ts
   "/novel-market": { ssr: false },
   "/novel-market/**": { ssr: false },
   "/knowledge": { ssr: false },
   ```
2. **`layouts/app.vue` 侧栏加入口**：`{ key:"market", to:"/novel-market", label:"剧本集市", icon:"script" }`、
   `{ key:"knowledge", to:"/knowledge", label:"团队知识库", icon:"folder" }`
3. **`docs/02-architecture/api-spec.md` 同步**（我没有写权限）：新增 87 个端点 + §4 的口径
   （抽成常量、提现状态机、级联软删、内容闸门、分类=停用/标签=摘除）。
4. （可选）`creditIn` 的 kind 加 `"refund"`，预售退款就能与"人工调账"区分开。

> `app.module.ts` 我只加了 4 行（2 个 import + 2 个 imports 数组项，锚点 `CampaignModule`/`CreatorModule`）。
> 迁移 0030 涉及的 `packages/db` 改动全部由 Lead 完成，我未改 `schema.ts`。

---

## 8. 未完成（诚实列出）

| 项 | 状态 | 原因 |
|---|---|---|
| **真实打款** | ❌ 未做 | 不接资金通道（需支付资质/合规）。`payout` 只做"运营线下打款后回填凭证 + 推进终态 + 留 `paid_at`" |
| **买断后二次改编/再发布** | ❌ 未做 | 产品未拍板许可范围（§5-U8）。`parsePurchased` 只读结构、`writable:false`，不复制进我方 `novel` 域 |
| **作品解析=语义级解析** | ⚠️ 半成品 | 只做"结构解析 + 上架表单建议值"（章节/字数/角色/集数/摘要），**不含语义级解析**（体裁/卖点/受众）。竞品 `creator/works/parse` 产出未取证，不臆造 |
| **多知识库实体** | ❌ 未做 | 缺 `knowledge_bases` 表（§5⑤），我方是"一 space 一知识库" |
| **集市订单退款（买断）** | ❌ 不做 | 竞品无买断退款路由（`:622` 只有预售 `cancelorder`），内容已可下载，退款等于白拿 |
| **`GET /scripts/:id/episodes` 区间语义** | ⚠️ 待取证 | 已照做闭区间；"超区间返回空还是报错"未取证，我方返回空列表 |
| **端到端浏览器 E2E/截图** | ❌ 未做 | 页面已过 vue-tsc + lint；浏览器级 E2E 需 Lead 统一跑（无 E2E harness 授权） |
| **真实 AppModule 的 curl 复跑** | ⚠️ 未复跑 | 上一轮复跑时撞 `modules/op/op.kv` 在途删除；随后全组修复、我的 spec 已用真实 AppModule 跑通（§2.1）。如需再走一遍 curl 我可立刻补 |
