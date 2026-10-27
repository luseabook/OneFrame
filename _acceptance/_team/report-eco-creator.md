# 第 6 批 A 交付报告：创作者中心 crc / 运营增长 op / 激励活动 campaign

> 交付人：eco-creator（teammate）· 任务：`task-8` · 日期：2026-10-27
> 竞品基线：万兴剧厂 ReelMate（`rea-reelmate/routes.txt` = `rt:`；`docs/01-product/_parts/d-commerce-account.md`）
> 执行标准：ADR-013（有证据就照做，无证据不臆造并登记待取证）

---

## 1. 交付总览

| 组 | 模块目录 | 路由前缀 | 端点数 | 竞品基线 |
|---|---|---|---:|---|
| 创作者中心 | `apps/api/src/modules/creator/` | `/v1/crc/*` | **32**（竞品 30 + 我方补充 2） | `rt:275-304` |
| 运营增长 | `apps/api/src/modules/op/` | `/v1/op/*`、`/v1/redeem-code/*` | **42**（覆盖竞品 31 行 + 我方补充兑换码/AB/运营位读） | `rt:829-860` |
| 激励活动 | `apps/api/src/modules/campaign/` | `/v1/campaigns/*` | **9**（竞品 6 + 我方补充 3） | `rt:267-272` |
| 前端 | `apps/web/pages/creator-center/index.vue`、`activities.vue`、`invite.vue` | — | 3 页（三态齐全） | `rt:4,43-47,67-68` |
| 测试 | `apps/api/test/{crc,op,campaign}.spec.ts` | — | **41 例，全绿（真实 AppModule）** | — |

代码规模：后端 7 个文件（3 controller / 5 service / 3 module + 1 兑换码独立 controller）、前端 3 页、类型追加 ~170 行。

---

## 2. 创作者中心 `/v1/crc/*`（32 条）

逐条对照（竞品路径 → 我方路径，语义一致）：

| # | 竞品证据 | 我方端点 | 说明 |
|---:|---|---|---|
| 1 | `rt:303` `crc/user/info` | `GET /crc/user/info` | **自动建档**（新用户不报 404）；下发 `can_review` 供前端决定是否渲染审核按钮 |
| 2 | `rt:304` `crc/user/update` | `POST /crc/user/update` | 昵称/简介/头像 |
| 3 | `rt:302` `crc/user/incentive` | `POST /crc/user/incentive` | **只读视图**：`credit_flows` 的 `kind='gift'` 汇总 + 按 memo 归类 |
| 4 | `rt:300` `crc/user/follows` | `POST /crc/user/follows` | 我关注的人 |
| 5 | `rt:299` `crc/user/fans` | `POST /crc/user/fans` | 我的粉丝 |
| 6 | `rt:301` `crc/user/follows/action` | `POST /crc/user/follows/action` | 关注/取关**幂等**（唯一键 `uq_creator_follows`） |
| 7 | `rt:294` `crc/home/list` | `GET /crc/home/list` | 公开信息流，**只 `status=3`** |
| 8 | `rt:298` `crc/resource/list` | `POST /crc/resource/list` | 信息流 + `category` **真过滤**（迁移 0025 组合索引）；`effect` 显式标注未生效 |
| 9 | `rt:297` `crc/resource/info` | `GET /crc/resource/info` | 公开态任何人可看；非公开只有作者/本 space 运营可看，其余 **404 不泄露存在性** |
| 10 | `rt:296` `crc/resource/action/status` | `POST /crc/resource/action/status` | 审核状态机 `submit/resubmit/offline/approve/reject`（见 §5） |
| 11 | `rt:286` `crc/assets/me` | `GET /crc/assets/me` | 我的作品（全状态，可筛 status/kind） |
| 12 | `rt:281` `crc/assets/auditing/list` | `POST /crc/assets/auditing/list` | 我提交的待审 |
| 13 | `rt:280` `crc/assets/auditing/info` | `POST /crc/assets/auditing/info` | 待审详情 + 审核态（不做 SLA 计时器，只披露提交时间） |
| 14 | `rt:279` `crc/assets/audit-fail/del` | `POST /crc/assets/audit-fail/del` | 只允许删"已驳回" |
| 15 | `rt:282` `crc/assets/delete` | `POST /crc/assets/delete` | 软删；**待审中不可删**、已通过须先下架 |
| 16 | `rt:283` `crc/assets/download` | `GET /crc/assets/download` | 只回下载元信息（不代理文件流）；无素材 → `400105` |
| 17 | `rt:289` `crc/assets/share` | `POST /crc/assets/share` | 站内分享路径（不新建短链表） |
| 18 | `rt:284` `crc/assets/likes` | `POST /crc/assets/likes` | 给 `asset_id` = 谁赞了；不给 = 我赞过谁 |
| 19 | `rt:285` `crc/assets/likes/action` | `POST /crc/assets/likes/action` | 点赞/取消**幂等**（唯一键 `uq_creator_likes`，计数用 SQL 自增） |
| 20 | `rt:287` `crc/assets/report` | `POST /crc/assets/report` | 落 `asset_reports`（迁移 0027，`(asset_id, reporter)` 唯一） |
| 21 | `rt:288` `crc/assets/report/config` | `GET /crc/assets/report/config` | 举报原因**服务端下发**（不硬编码在前端，证据 `d-commerce-account.md:389`） |
| 22 | `rt:290` `crc/banner_list` | `GET /crc/banner_list` | 读 `promo_slots(slot=banner/activity/pop_up)`，只返回启用 + 在窗口内 |
| 23 | `rt:295` `crc/pop_up` | `GET /crc/pop_up` | 同上（`slot=pop_up/creator`） |
| 24 | `rt:291` `crc/category/tree` | `GET /crc/category/tree` | 三层树（**结构照做、内容我方自拟**，见 §6 待取证） |
| 25 | `rt:292` `crc/effect/tree` | `GET /crc/effect/tree` | 同上 |
| 26 | `rt:293` `crc/file_preview` | `GET /crc/file_preview` | 预览元信息 |
| 27 | `rt:276` `crc/activity/list` | `POST /crc/activity/list` | 我报名的活动（委托 `CampaignService`，不重复实现口径） |
| 28 | `rt:277` `crc/activity/public` | `POST /crc/activity/public` | 可报名的公开活动 |
| 29 | `rt:275` `crc/activity/info` | `GET /crc/activity/info` | 活动详情（含 `my_signup` / `open_for_signup`） |
| 30 | `rt:278` `crc/activity/resource/list` | `POST /crc/activity/resource/list` | 活动下投稿（只列"已报名 + 作品已通过"） |
| 31 | 竞品无对应（走 `asset/workflows` 资源链 `rt:210-221`） | `POST /crc/assets/create` | **我方补充**：作品创建 |
| 32 | 同上 | `POST /crc/assets/update` | **我方补充**：作品编辑（驳回稿编辑后自动回草稿） |

---

## 3. 运营增长 `/v1/op/*`（42 条）

| # | 竞品证据 | 我方端点 | 关键机制 |
|---:|---|---|---|
| 1-2 | `rt:840` `GET\|POST /op/invite-code` | `GET/POST /op/invite-code` | 个人专属码落 `invite_codes.owner_user_id`（**不是 `created_by`**，后者指向 admin_users）；重复调用返回同一码 |
| 3 | `rt:847` `op/invite-code/check` | `GET /op/invite-code/check` | 只校验不核销；返回 `already_redeemed` 让前端置灰 |
| 4 | `rt:848` `op/invite-code/verify` | `POST /op/invite-code/verify` | 核销：唯一键 `uq_invite_redemptions` 裁决；重放返回 `replayed:true` 不再发分；同时建立单层分销关系 |
| 5 | `rt:856` `op/referral-link` | `POST /op/referral-link` | 由码派生链接（不建短链表） |
| 6 | `rt:838` `op/distributor/overview` | `POST /op/distributor/overview` | 邀请数 / 佣金比例 / 已结算佣金 |
| 7 | `rt:836` `op/distributor/detail` | `POST /op/distributor/detail` | 被邀请人列表（`invitee_type=2` 只留"有已支付订单"） |
| 8 | `rt:837` `op/distributor/income-detail` | `POST /op/distributor/income-detail` | 佣金流水（memo 前缀 `distributor_commission:<uid>`） |
| 9 | `rt:839` `op/distributor/withdrawal-list` | `POST /op/distributor/withdrawal-list` | 复用 `market_withdrawals`（`review_note` 前缀 `distributor:` 区分来源） |
| 10 | `rt:849` `op/invitee/order-records` | `POST /op/invitee/order-records` | 被邀请人订单（按成交分佣的前提数据） |
| 11 | `rt:835` `op/daily-reward` | `POST /op/daily-reward` | **`op_daily_rewards` 唯一键 `(user_id,reward_date)` 裁决并发**；抢到才 `creditIn`；回填 `flow_ref` |
| 12 | `rt:851` `op/points-giveaway` | `POST /op/points-giveaway` | 定向发分（运营特权 + 只发本 space 成员），memo 记操作人与目标人 |
| 13 | `rt:859` `op/rewards-notification` | `POST /op/rewards-notification` | 近 30 天 gift 流水（排除"给空间池"的定向发分） |
| 14 | `rt:850` `op/mobile-captcha` | `POST /op/mobile-captcha` | Redis 验证码，独立命名空间（运营码不能拿去登录） |
| 15 | `rt:829` `op/abtest/hit` | `GET /op/abtest/hit` | **按权重哈希 userId** 选变体 + `ab_hits` 唯一键"一人一变体"；以库为准回读 |
| 16-18 | 无（后台能力） | `GET/POST/PATCH /op/abtest/experiments` | **我方补充**：实验 CRUD（运营特权） |
| 19 | `rt:852` `GET /op/questionnaire` | `GET /op/questionnaire` | 定义（懒种子进 `op_questionnaires`）+ 我的填写状态 |
| 20 | `rt:852` `POST /op/questionnaire` | `POST /op/questionnaire` | 一人一份（`uq_op_questionnaire_responses`），重放返回原答案 |
| 21 | `rt:853` `op/questionnaire/mgr/list` | `GET /op/questionnaire/mgr/list` | **join `space_members` 收窄到本 space**（跨租户泄露修复，见 §7） |
| 22 | `rt:854` `op/questionnaire/mgr/review/:id` | `POST /op/questionnaire/mgr/review/:id` | 审核结论写 `answers._meta.review` |
| 23-24 | `rt:857` / `rt:858` | `POST /op/register-questionnaire`、`GET .../check` | `is_complete:0\|1` 口径对齐 |
| 25-29 | `rt:830-834` | `POST /op/beta-questionnaire`、`-abroad`、`GET /check`、`POST /mobile-verify`、`GET /op/beta-status` | 内测为商务开通制：申请一律 `pending`，不自动开通 |
| 30-35 | `rt:841-846` | `GET .../filled`、`GET .../invite-activity-check`、`GET .../:activity_id`、`POST ...`、`POST .../check`、`POST .../verify` | 邀请活动问卷；`verify` 先校验邀请码再落答案 |
| 36 | `rt:855` `op/redeem-code/info` | `POST /op/redeem-code/info` | **只查不兑**；返回 `valid/reason/remaining_uses/expires_at` |
| 37-40 | 无（后台能力） | `POST/GET/PATCH/DELETE /op/redeem-code(/list/:id)` | **我方补充**：兑换码 CRUD（团队定向码；平台码归 admin 域） |
| 41 | `rt:290/295` 的后台读 | `GET /op/promo-slots` | 空间管理员只读（客服/排障）；**写入口在 admin 域**（见 §7） |
| 42 | `rt:860` `/web/v1/redeem-code/redeem` | `POST /redeem-code/redeem` | 独立控制器（竞品把"查询"与"核销"拆两个服务域，路径即边界） |

### 3.1 兑换码并发正确性（本批最需要证明的一条）

处理顺序刻意**不是**"先查后写"（那样并发必双花）：

1. 校验码（只读，不承担去重）；
2. `INSERT redeem_code_redemptions ... ON CONFLICT DO NOTHING` —— 唯一键 `(code_id,user_id)` 裁决谁赢，输的人立即返回 `replayed`；
3. 条件 `UPDATE used_count = used_count+1 WHERE max_uses=0 OR used_count<max_uses` —— **原子占配额**，抢不到就抛错回滚（连同 ② 的行一起回滚）；
4. 最后才 `creditIn`。

---

## 4. 激励活动 `/v1/campaigns/*`（9 条）

| # | 竞品证据 | 我方端点 | 说明 |
|---:|---|---|---|
| 1 | `rt:269` `campaign/list` | `GET /campaigns` | 默认只给"进行中/已结束"（草稿/下线是运营态） |
| 2 | `rt:268` `campaign/detail` | `GET /campaigns/:id` | **同时接受 id 或可读 `campaign_key`**（竞品双主键 `d-commerce-account.md:431`） |
| 3 | `rt:267` `campaign/awards` | `GET /campaigns/:id/awards` | 以获奖名单承载，`awards_structure_known:false` 显式标注未取证 |
| 4 | `rt:270` `campaign/shortlist` | `GET /campaigns/:id/shortlist` | 入围+获奖，按入围时间倒序 |
| 5 | `rt:271` GET `signup/draft` | `GET /campaigns/:id/signup` | 读草稿（`campaign_signup_drafts`） |
| 6 | `rt:271` POST `signup/draft` | `PUT /campaigns/:id/signup` | 覆盖写草稿，可续填 |
| 7 | `rt:272` `signup/submit` | `POST /campaigns/:id/signup` | 报名；`reward_credits>0` 时**同事务 `creditIn`** 发奖励；重复/取消后重报**不重复发分** |
| 8 | 无 | `DELETE /campaigns/:id/signup` | **我方补充**：取消报名（已入围/获奖不可自行取消） |
| 9 | 无 | `POST /campaigns/:id/signups/:sid/status` | **我方补充**：运营置入围/获奖（否则 shortlist/awards 永远是空的假端点） |

---

## 5. 审核状态机（硬要求）

`1 草稿 → 2 待审 → 3 通过 / 4 驳回 → 5 下架`；`5 → 2` 可重新送审；**`4 → 3` 明确拒绝**（`400101`）。

- **只有 `status=3` 出现在公开列表**（`crc/home/list`、`crc/resource/list`）——单测直接断言"草稿/待审/下架都看不到、通过后能看到"。
- 送审前置校验：无标题或无素材/封面 → `400101`（不让空稿占审核队列）。
- 审核留痕：`approve/reject` 写 `creator_assets.reviewed_by / reviewed_at`（迁移 0025）。
- **运营特权只在作品所属 space 内生效**：任何人都是自己个人空间的 master，若只判 `hasPrivilege`
  就能看别人空间的草稿——这是本轮修掉的越权洞（`isOperatorOf(ctx, assetSpaceId)`）。
- 驳回稿被编辑后自动回草稿（驳回意见针对旧稿，改完必须重新提交）。

---

## 6. 测试与验收（实测输出）

### 6.1 三个 spec（**真实 `AppModule`**）

```
cd E:\wanxing\app\apps\api
npx vitest run test/crc.spec.ts test/op.spec.ts test/campaign.spec.ts

 ✓ test/campaign.spec.ts (9 tests) 1141ms
 ✓ test/crc.spec.ts (15 tests) 1483ms
 ✓ test/op.spec.ts (17 tests) 1544ms

 Test Files  3 passed (3)
      Tests  41 passed (41)
   Duration  5.83s
```

覆盖矩阵（每条都有"为什么这么断言"的注释）：

| spec | 例数 | 覆盖点 |
|---|---:|---|
| `crc.spec.ts` | 15 | 自动建档/资料更新、状态机全链（含 4→3 非法、删除保护）、公开可见性、我的作品与审核中列表、点赞幂等/取消兜底、关注粉丝幂等与自关注、越权 404（详情/编辑/送审）、举报（配置/非法原因/重复覆盖）、下载分享预览、激励读视图、分类过滤、运营位结构与分类树、团队空间隔离、参数校验 |
| `op.spec.ts` | 17 | 每日奖励幂等（余额增量 + 流水只一条）、兑换码两段式/幂等/配额耗尽/跨空间不存在、邀请码幂等生成/核销/重放/单层归因、守卫层租户隔离、运营特权 403、定向发分越权、AB 一人一变体与结束实验、问卷必填/回放、问卷审核权限、内测申请与短信码一次性、运营位创建/停用/写权限、参数校验 |
| `campaign.spec.ts` | 9 | 列表只给进行中/已结束、报名发奖励与幂等、取消后重报不重复发分、草稿续填 + 冒名作品 403、入围/获奖运营动作与 403、取消限制、报名窗口、活动投稿列表与"我报名的"、租户隔离 |

### 6.2 typecheck / lint

```
pnpm --filter @app/api typecheck   → 0 error
pnpm --filter @app/web typecheck   → 0 error（nuxt prepare + vue-tsc）
npx eslint src/modules/{op,campaign,creator} test/{op,crc,campaign}.spec.ts → 0 error
pnpm --filter @app/api lint        → 全仓还剩 2 个 error，均在 modules/market/market.service.ts
                                     （'marketCategories'/'marketTags' defined but never used，非本域）
```

### 6.3 真实 HTTP 链路（dev API `:3002`，curl 等价脚本）

**链路一：发作品 → 审核通过 → 列表可见 → 点赞 → 关注**

```
1) sms      code=0 debug_code=444166
2) login    code=0 space=108399164117139457 user=108399164117139456
3) create   code=0 id=108399164234579968 status=1(草稿)
4) submit   code=0 status=2(待审)
5) approve  code=0 status=3(已通过) published_at=2026-10-27T02:59:34Z reviewed_by=108399164117139456
6) home/list code=0 contains_asset=True
7) like#1   code=0 liked=True  like_count=1
8) like#2   code=0 liked=True  like_count=1        ← 幂等
9) follow#1 code=0 following=True follower_count=1
10) follow#2 code=0 following=True follower_count=1 ← 幂等
11) fans    code=0 count=1
```

**链路二：邀请码 / 分销 / 每日奖励 / 兑换码 / AB**

```
1) user/info   code=0 nickname=用户1746
2) invite-code code=0 mycode=OFEAF2DEDF credits=100 share=/invite?code=OFEAF2DEDF
3) verify      code=0 verified=True credits=100 inviter=108399256630902784
4) verify(重放) code=0 replayed=True credits=0                    ← 幂等
5) distributor/overview code=0 invitee_count=1 commission_bps=0
6) daily-reward#1 code=0 rewarded=True credits=5 balance=185
7) daily-reward#2 code=0 rewarded=False already=True credits=0    ← 幂等
8) 建码        code=0 code=OFBV8FDCLC max_uses=2
9) 建码(另一轮) code=0 code=OFD290X5VK remaining=2
10) redeem#1   code=0 redeemed=True credits=20 balance=100 used=1
11) redeem#2   code=0 replayed=True credits=0                     ← 幂等
12) redeem-info 二次 code=0 valid=False reason=already_redeemed
13) abtest/hit code=0 hit=True benefits={"home_ab_171fadf0":"control", ...}
14) user/incentive code=0 total=185 by_category={"daily_reward":5,"invite":100,"other":80}
```

> 说明：`/op/redeem-code` 建的是**团队定向码**（`space_id` = 建码人空间），用另一个空间的用户兑换
> 会得到 `400101 兑换码不存在`——这是设计（不泄露存在性），上面第 9-12 行是同一用户兑换的成功路径。

### 6.4 前端页面可访问性（`:3003` dev，`routeRules` 已由 Lead 加好）

```
/creator-center => 200
/activities     => 200
/invite         => 200
```

页面本身的**交互**没有跑浏览器 E2E（需要登录态注入），验证手段是三层：
1. `vue-tsc` 通过（含 template 类型检查）——模板写错会在这里红；
2. 三个路由在 dev server 返回 200（路由已注册，不是 404）；
3. 页面调用的每个端点都在 §6.3 的 curl 链路或 41 个 e2e 用例里被真实调用过
   （不存在"页面调了个不存在的接口"的情况）。

三态（加载/空/错误）与禁用态说明：
- 审核按钮按 `can_review` 渲染（无权限不出现，避免"点了 403"）；
- 兑换码已兑换/已用尽 → 按钮禁用并显示 `reason`；
- 每日奖励已领 → 按钮禁用并提示"明天再来"；
- 活动未开放报名 → 提交按钮禁用 + `title` 说明；
- 已入围/获奖的报名 → 取消按钮禁用并说明原因。


---

## 7. 已知偏离 / 待取证（诚实清单）

| # | 项 | 现状 | 原因与后续 |
|---:|---|---|---|
| D1 | `crc/category/tree`、`crc/effect/tree` 内容 | 结构照做（三层树），分类/效果**内容我方自拟** | 竞品树内容未取证（`d-commerce-account.md:376` 只给端点）。待抓包后替换常量 |
| D2 | `crc/resource/list` 的 `effect` 过滤 | 接收并回显，但**不过滤**（`filters.effect_applied=false`） | `creator_assets` 没有 effect 列；显式告知前端，不假装生效 |
| D3 | `campaign/awards` 结构 | 以"获奖名单（status=3）"承载，`awards_structure_known:false` | 竞品奖项层级/名额未取证（`d-commerce-account.md:424` 只有路径） |
| D4 | `campaign_key` | 已支持（迁移 0025 加列），detail/awards/shortlist/signup/draft 均接受 id 或 key | 生成/编辑 campaign 属运营后台（admin 域），本批不做 |
| D5 | 审核人 | 空间管理员（`hasPrivilege`）在本 space 内审核；**个人空间 owner 可自审自发** | 竞品审核在平台运营域（`rmadminsrv`，`rt:107-109`）。我方缺平台审核队列；已加 `reviewed_by` 留痕，后续接 admin 审核队列即可收紧 |
| D6 | 每日奖励 | 我方"每人每天可领"，竞品只在新用户时拉一次（`d-commerce-account.md:456-466`） | 任务口径明确要求每天一次；差异已登记 |
| D7 | 分销佣金 | `commission_bps` 默认 0，**不计佣**；`income-detail`/`withdrawal-list` 走真实查询但当前为空 | 按成交分佣要接订单分账（需结算策略拍板）。空列表是正确结果，不是假端点 |
| D8 | 定向发分 | 发到 **space 池**（ADR-011 只有 space 级账户），memo 记录目标人 | 个人无独立余额；要发到个人需先做个人子账户（本批之外） |
| D9 | 运营位（`promo_slots`） | **写入口在 admin 域** `/ops/admin/promo-slots`（`created_by → admin_users`，迁移 0028）；op 只保留只读 | 我原实现在 op 域用空间 token 写，会撞 `admin_users` 外键；已删重复实现（避免路由冲突与两套鉴权） |
| D10 | 问卷定义 | 常量懒种子进 `op_questionnaires`；**校验仍用常量**（运营改库题目暂不生效） | 题目编辑后台/动态校验属下一轮；已在 service 注释标出唯一改点 |
| D11 | `op_questionnaire_responses.answers` 形状 | `{ <question_id>: value }` + 保留键 `_meta`（channel/activity_id/submitted_at/mobile_verified/review） | 表无审核列；`_meta` 不与题目 id 冲突（题干 id 禁 `_` 前缀），需要按审核态索引时再迁列 |
| D12 | `crc/user/incentive` 口径 | 该 space 的 gift 流入汇总（含 `other=新人礼包`） | 个人级激励明细需 `credit_flows.ref_user_id`（`creditIn` 未暴露该参数，属共享包改造） |

### 7.1 跨租户泄露修复（建议写进 api-spec §16 偏离说明）

`op_questionnaires.qkey` 全局唯一 + `op_questionnaire_responses` 无空间列 ⇒ 定义与答卷都是**平台级**。
若不收窄，任何团队管理员都能翻到别家团队的留资。已在两处加 `join space_members`（`spaceId=当前 space`）：
`GET /op/questionnaire/mgr/list`、`POST /op/questionnaire/mgr/review/:id`（跨空间一律 404，不泄露存在性）。

---

## 8. 需要 Lead 做

1. **前端路由注册**：`nuxt.config.ts` 的 `routeRules` **已由 Lead 加好**（`/creator-center`、
   `/creator-center/**`、`/activities`、`/invite` 均已 `ssr:false`，实测 :3003 三路由 200）——此项已完成，
   无需再动。**仍需**：`layouts/app.vue` 侧栏入口（我不动该文件）：
   `创作者中心 /creator-center`、`活动中心 /activities`、`邀请与兑换 /invite`。
2. **api-spec 同步**（`docs/02-architecture/api-spec.md`）：
   - 新增 `/v1/crc/*`(32)、`/v1/op/*`(41)、`/v1/redeem-code/redeem`、`/v1/campaigns/*`(9)；
   - 偏离说明：§7 的 D1–D12（尤其 D5 审核人、D9 运营位在 admin 域、§7.1 问卷可见性收窄）。
3. **`creditIn` 增加 `flowId` 返回**（`packages/db/src/ledger.ts`，共享包）：目前每日奖励回填 `flow_ref`
   是靠"同 space + 同 memo（含 day+user）+ created_at/id 倒序"取回，语义正确但绕；加返回值后可直接用。
4. 若要更严格的审核分离：admin 域加"创作者作品审核队列"（`creator_assets` 已具备 `status=2` + `reviewed_by`），
   本批的 `approve/reject` 可保留给空间管理员做预审。

---

## 9. 未完成 / 明确不做

- **未做**：创作者中心「作品预览页」`/creator-center/preview/:id`（竞品 `rt:46`）——本批只回分享路径，页面留待前端批次。
- **未做**：`/creator-center/earnings`（竞品 `rt:45`）——收益/提现属集市域（task-9），crc 侧只到 `incentive` 读视图。
- **未做**：`creator_assets` 的 `effect`/标签维度（表无列）。
- **数据层已清**：`op.kv.ts` 已删除，问卷/每日奖励/报名草稿/作品举报/邀请码归属全部落正式表（0025/0027/0028）。
- **不做**：竞品 `crc` 的 `assets/report` 后台处置、`crc/effect/tree` 运营配置后台（属 admin 域）。

