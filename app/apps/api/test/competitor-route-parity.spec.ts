import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 门禁：把「竞品有这个端点，我方有没有」从人工判断变成可复跑的断言。
 *
 * 为什么需要它：第 79 批审计 #7 团队时发现，台账上写着「100% / 无缺口」的模块，
 * 拿竞品 40 条 cam 路由逐条对照后其实有 12 条我方根本没有（BYOK 第三方 Key、
 * 项目维度积分、项目关联用户、子账号密码）。「100%」此前来自「照我方的 33 条
 * 自评」，而不是「拿竞品的全集对过一遍」——**自己的全集证明不了自己没有缺口**。
 *
 * 本文件把竞品的九组路由逐条内联进来（film 48 / crc 30 / op 35 / campaign 7 / kds 13 /
 * task 17 / home 5 / share 5 / ops_market 18，共 178 条，来自
 * `_acceptance/competitor_endpoints.tsv` 的 METHOD + path，归一化去参数名），
 * 然后解析我方 controller 源码建路由表逐条比对。三种结局：
 *   1. 同 METHOD 同路径 → 覆盖；
 *   2. 在 `DEVIATIONS` 里显式登记了「我方等价形状 + 理由」→ 覆盖（且被登记的形状
 *      必须真的存在于我方路由表，改名改路径会让本测试红，避免白名单变垃圾场）；
 *   3. 其余 → 缺口，测试红并在报错里逐条列出缺失的 METHOD+path。
 *
 * 覆盖边界（诚实说明）：只比对「方法 + 路径形状」，**不比对 query / body / 语义**。
 * 参数改名（如竞品 `member_id`、我方 `user_id`）不会被本测试发现；语义等价
 * 依旧要靠人读契约（第 79 批就是这么读出「只存哈希没有登录路径 = 死代码」的）。
 * 也不覆盖我方的额外端点（多给的能力不扣分）。
 *
 * 数字口径：九组共 178 条竞品操作。改这些数组就得同步改
 * `docs/07-plan/implement-progress-vs-reelmate.md` 里 #1 / #8 / #10 / #21 / #24 / #26 / #27 七行的
 * 「逐条对照」说法。
 */

const API_SRC = join(__dirname, "..", "src");
const WILDCARD = "{}";

/** 影视版：竞品 `/web/v1/film/*` 37 路径 / 48 操作 */
const FILM_SHAPES = [
  "DELETE /web/v1/film/projects/:project_id/canvases/:canvas_id",
  "POST /web/v1/film/projects/:project_id/canvases/:canvas_id/submit-result",
  "GET /web/v1/film/projects/:project_id/canvases/:canvas_id/task-bindings",
  "GET /web/v1/film/projects/:project_id/canvases/:canvas_id/task-panel",
  "GET /web/v1/film/projects/:project_id/canvases/visible",
  "GET /web/v1/film/projects/:project_id/exports",
  "POST /web/v1/film/projects/:project_id/exports",
  "GET /web/v1/film/projects/:project_id/recent-open",
  "POST /web/v1/film/projects/:project_id/recent-open",
  "GET /web/v1/film/projects/:project_id/task-tables",
  "POST /web/v1/film/projects/:project_id/task-tables",
  "DELETE /web/v1/film/projects/:project_id/task-tables/:table_id",
  "PATCH /web/v1/film/projects/:project_id/task-tables/:table_id",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/apply-template",
  "GET /web/v1/film/projects/:project_id/task-tables/:table_id/fields",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/fields",
  "DELETE /web/v1/film/projects/:project_id/task-tables/:table_id/fields/:field_id",
  "PATCH /web/v1/film/projects/:project_id/task-tables/:table_id/fields/:field_id",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/fields/batch-restore",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/fields/reorder",
  "GET /web/v1/film/projects/:project_id/task-tables/:table_id/pref",
  "PUT /web/v1/film/projects/:project_id/task-tables/:table_id/pref",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/tasks",
  "DELETE /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/:task_id",
  "DELETE /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/:task_id/canvas-bindings",
  "GET /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/:task_id/canvas-bindings",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/:task_id/canvas-bindings",
  "PUT /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/:task_id/canvas-bindings",
  "PUT /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/:task_id/cells",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/:task_id/children",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/:task_id/notify-assignees",
  "GET /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/:task_id/review",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/:task_id/review/comments",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/:task_id/review/read",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/:task_id/status",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/batch-delete",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/batch-restore",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/query",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/reorder",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/title-matches",
  "POST /web/v1/film/projects/:project_id/task-tables/:table_id/tasks/unbound-query",
  "POST /web/v1/film/projects/:project_id/task-tables/ensure-presets",
  "POST /web/v1/film/projects/:project_id/task-tables/import",
  "POST /web/v1/film/projects/:project_id/task-tables/reorder",
  "GET /web/v1/film/projects/:project_id/task-templates",
  "POST /web/v1/film/projects/:project_id/task-templates",
  "DELETE /web/v1/film/projects/:project_id/task-templates/:template_id",
  "GET /web/v1/film/projects/:project_id/tasks/stats",
];

/** 创作者中心：竞品 `/web/v1/crc/*` 30 条 */
const CRC_SHAPES = [
  "GET /web/v1/crc/activity/info",
  "POST /web/v1/crc/activity/list",
  "POST /web/v1/crc/activity/public",
  "POST /web/v1/crc/activity/resource/list",
  "POST /web/v1/crc/assets/audit-fail/del",
  "POST /web/v1/crc/assets/auditing/info",
  "POST /web/v1/crc/assets/auditing/list",
  "POST /web/v1/crc/assets/delete",
  "GET /web/v1/crc/assets/download",
  "POST /web/v1/crc/assets/likes",
  "POST /web/v1/crc/assets/likes/action",
  "POST /web/v1/crc/assets/me",
  "POST /web/v1/crc/assets/report",
  "GET /web/v1/crc/assets/report/config",
  "POST /web/v1/crc/assets/share",
  "GET /web/v1/crc/banner_list",
  "GET /web/v1/crc/category/tree",
  "GET /web/v1/crc/effect/tree",
  "POST /web/v1/crc/file_preview",
  "GET /web/v1/crc/home/list",
  "GET /web/v1/crc/pop_up",
  "POST /web/v1/crc/resource/action/status",
  "GET /web/v1/crc/resource/info",
  "POST /web/v1/crc/resource/list",
  "POST /web/v1/crc/user/fans",
  "POST /web/v1/crc/user/follows",
  "POST /web/v1/crc/user/follows/action",
  "POST /web/v1/crc/user/incentive",
  "POST /web/v1/crc/user/info",
  "POST /web/v1/crc/user/update",
];

/** 运营（问卷 / 邀请 / 分销 / 内测申请）：竞品 `/web/v1/op/*` 35 条 */
const OP_SHAPES = [
  "GET /web/v1/op/abtest/hit",
  "GET /web/v1/op/beta-questionnaire",
  "POST /web/v1/op/beta-questionnaire",
  "POST /web/v1/op/beta-questionnaire-abroad",
  "GET /web/v1/op/beta-questionnaire/check",
  "POST /web/v1/op/beta-questionnaire/mobile-verify",
  "GET /web/v1/op/beta-status",
  "POST /web/v1/op/daily-reward",
  "POST /web/v1/op/distributor/detail",
  "POST /web/v1/op/distributor/income-detail",
  "POST /web/v1/op/distributor/overview",
  "POST /web/v1/op/distributor/withdrawal-list",
  "GET /web/v1/op/invite-code",
  "POST /web/v1/op/invite-code",
  "POST /web/v1/op/invite-code-questionnaire",
  "GET /web/v1/op/invite-code-questionnaire/:activity_id",
  "POST /web/v1/op/invite-code-questionnaire/check",
  "GET /web/v1/op/invite-code-questionnaire/filled",
  "GET /web/v1/op/invite-code-questionnaire/invite-activity-check",
  "POST /web/v1/op/invite-code-questionnaire/verify",
  "GET /web/v1/op/invite-code/check",
  "POST /web/v1/op/invite-code/verify",
  "POST /web/v1/op/invitee/order-records",
  "POST /web/v1/op/mobile-captcha",
  "POST /web/v1/op/points-giveaway",
  "GET /web/v1/op/questionnaire",
  "POST /web/v1/op/questionnaire",
  "GET /web/v1/op/questionnaire/mgr/list",
  "POST /web/v1/op/questionnaire/mgr/review/:id",
  "POST /web/v1/op/redeem-code/info",
  "POST /web/v1/op/referral-link",
  "GET /web/v1/op/register-questionnaire",
  "POST /web/v1/op/register-questionnaire",
  "GET /web/v1/op/register-questionnaire/check",
  "POST /web/v1/op/rewards-notification",
];

/** 激励活动：竞品 `/web/v1/campaign/*` 7 条 */
const CAMPAIGN_SHAPES = [
  "GET /web/v1/campaign/awards",
  "GET /web/v1/campaign/detail",
  "GET /web/v1/campaign/list",
  "GET /web/v1/campaign/shortlist",
  "GET /web/v1/campaign/signup/draft",
  "POST /web/v1/campaign/signup/draft",
  "POST /web/v1/campaign/signup/submit",
];

/**
 * 数据看板：竞品 `/web/v1/kds/da/*` 13 条（5 GET + 8 POST）
 *
 * 第 81 批审计出来的形状缺口：这 8 条在 `core-lib-CKH7gQsw.js` 里都是
 * `method: Method.POST` + `requestBodyType: json`，而我方原先只有 GET + query。
 * 对按竞品形状写的客户端来说，POST 打到只有 GET 的路径上是 404 —— 这是真实缺陷，
 * 不是风格差异，所以按竞品形状补了 POST 别名（GET 保留，两者共用同一段逻辑）。
 */
const KDS_SHAPES = [
  "GET /web/v1/kds/da/team/:team_id/basic-info",
  "GET /web/v1/kds/da/team/:team_id/point-consume-rank",
  "GET /web/v1/kds/da/team/:team_id/project-data/basic-info",
  "GET /web/v1/kds/da/team/member/:op_user_id/point-consume-detail",
  "GET /web/v1/kds/da/team/member/:op_user_id/point-quota-detail",
  "POST /web/v1/kds/da/canvas/total-point-consume",
  "POST /web/v1/kds/da/team/:team_id/member-participate-detail",
  "POST /web/v1/kds/da/team/:team_id/point-manage-flow",
  "POST /web/v1/kds/da/team/:team_id/project-data/export",
  "POST /web/v1/kds/da/team/:team_id/project-data/query",
  "POST /web/v1/kds/da/team/:team_id/project-member-point-detail",
  "POST /web/v1/kds/da/team/:team_id/query",
  "POST /web/v1/kds/da/team/:team_id/query/export",
];

/**
 * 任务系统：竞品 `/web/v1/task/*` 17 条（第 82 批审计）
 *
 * 这批的形状证据比前几批更薄：`_acceptance/out_r82_task_evidence.txt` 里能拿到的只有
 * `method` / `path` / `paramNames` / `queryNames` / `requestBodyType` / `responseBodyType` /
 * `requestDataOptional`，**两个 json schema 全是 `{}`**。所以：
 *
 * - 1 条按竞品形状补了别名：`POST /task/{task_id}/download`（我方原先只有按结果下标的
 *   `GET /tasks/:id/results/:n/download-url`，一次拿全部要走 N 次，这是真的能力缺口）；
 * - 3 条是「能力在、形状不同」（复数前缀 / 分享用 token 不用 share_id），登记进 DEVIATIONS；
 * - 4 条**没有对应数据模型**，登记进 WAIVED 而不是硬造接口 —— 造假接口比缺接口更坏。
 */
const TASK_SHAPES = [
  "DELETE /web/v1/task/:task_id",
  "GET /web/v1/task",
  "GET /web/v1/task/:task_id",
  "GET /web/v1/task/is_first/interact",
  "GET /web/v1/task/share/:share_id/info",
  "POST /web/v1/task/:task_id/cancel",
  "POST /web/v1/task/:task_id/download",
  "POST /web/v1/task/:task_id/feedback",
  "POST /web/v1/task/:task_id/regenerate",
  "POST /web/v1/task/:task_id/retry",
  "POST /web/v1/task/:task_id/share",
  "POST /web/v1/task/result",
  "POST /web/v1/task/result/batch-download",
  "POST /web/v1/task/result/folder",
  "POST /web/v1/task/result/interact",
  "POST /web/v1/task/share/:share_id/batch-download",
  "POST /web/v1/task/workflow/retry",
];

/**
 * 无等价物豁免：竞品有这条路由，但我方**连数据模型都不存在**，补一个空壳接口只会让人以为
 * 能力已经在了。每条都必须写清「缺的是哪个模型」，并在台账 §5.5 里作为 B 类记账。
 *
 * 与 DEVIATIONS 的区别：DEVIATIONS 是「能力在、形状不同」（有 ours 可指向）；
 * WAIVED 是「能力不在」（没有 ours）。
 */

/** 首页工作台：竞品 5 条（第 83 批）——竞品没有 `/web/v1/home` 域，这 5 条散在 crc / op / msg 三个域里 */
const HOME_SHAPES = [
  "GET /web/v1/crc/home/list",
  "GET /web/v1/crc/banner_list",
  "GET /web/v1/crc/pop_up",
  "GET /web/v1/op/abtest/hit",
  "GET /web/v1/msg/exist-unread",
];

/** 分享：竞品 5 条（第 83 批）——3 条任务分享、1 条作品分享、1 条分享页 SSE */
const SHARE_SHAPES = [
  "POST /web/v1/task/:task_id/share",
  "GET /web/v1/task/share/:share_id/info",
  "POST /web/v1/task/share/:share_id/batch-download",
  "POST /web/v1/crc/assets/share",
  "GET /web/v1/agent/task/share/:share_id/sse",
];

/**
 * 运营后台（剧本广场管理面）：竞品 `/v1/rmadminsrv/novel_market/*` 18 条（第 83 批）。
 *
 * 这一批的竞品路由**不是** `/web/v1` 前缀，`normalize()` 不会剥掉它，所以 18 条全部要登记
 * 「我方等价形状」。用 PAIRS 成对写而不是手写 18 条 DEVIATIONS：形状和等价物必须一起改，
 * 分开放迟早漂移成「登记了形状、指向一个不存在的路径」。
 */
const NOVEL_ADMIN_PAIRS: Array<[shape: string, ours: string, reason: string]> = [
  [
    "POST /v1/rmadminsrv/novel_market/dashboard/scripts",
    "GET /ops/market/dashboard/scripts",
    "只读看板用 GET：竞品把查询一律写成 POST，我方按 REST 语义保证读端点无副作用（ADR-009）",
  ],
  [
    "POST /v1/rmadminsrv/novel_market/scripts/list",
    "GET /ops/market/scripts/list",
    "同上：作品列表是读操作",
  ],
  [
    "POST /v1/rmadminsrv/novel_market/scripts/save-draft",
    "POST /ops/market/scripts/save-draft",
    "同为 POST（保存草稿有副作用）",
  ],
  [
    "GET /v1/rmadminsrv/novel_market/scripts/{nm_id}/source-original-script",
    "GET /ops/market/scripts/{}/source-original-script",
    "同为 GET；路径参数名 nm_id → id，形状同构",
  ],
  [
    "POST /v1/rmadminsrv/novel_market/scripts/{nm_id}/submit-review",
    "POST /ops/market/scripts/{}/submit-review",
    "同为 POST",
  ],
  [
    "GET /v1/rmadminsrv/novel_market/scripts/{nm_id}/review-result",
    "POST /ops/market/scripts/{}/review-result",
    "竞品用 GET 读审核结果，我方用 POST：审核结果是要落审计日志的写动作（第 83 批核对后保留该差异，不为了对齐形状把它改成读）",
  ],
  [
    "GET /v1/rmadminsrv/novel_market/tags",
    "GET /ops/market/tags",
    "同为 GET",
  ],
  [
    "POST /v1/rmadminsrv/novel_market/tags",
    "POST /ops/market/tags",
    "同为 POST（建标签，同名幂等）",
  ],
  [
    "PUT /v1/rmadminsrv/novel_market/tags/{tag_id}",
    "PATCH /ops/market/tags/{}",
    "第 83 批新增能力：标签改名（竞品用 PUT 全量替换，我方统一 PATCH 局部更新）",
  ],
  [
    "DELETE /v1/rmadminsrv/novel_market/tags/{tag_id}",
    "DELETE /ops/market/tags/{}",
    "同为 DELETE（物理删 + 从作品 tag_ids 摘除）",
  ],
  [
    "GET /v1/rmadminsrv/novel_market/categories",
    "GET /ops/market/categories",
    "同为 GET",
  ],
  [
    "POST /v1/rmadminsrv/novel_market/categories",
    "POST /ops/market/categories",
    "同为 POST",
  ],
  [
    "PUT /v1/rmadminsrv/novel_market/categories/{category_id}",
    "PATCH /ops/market/categories/{}",
    "局部更新统一 PATCH（竞品 PUT）",
  ],
  [
    "DELETE /v1/rmadminsrv/novel_market/categories/{category_id}",
    "DELETE /ops/market/categories/{}",
    "同为 DELETE（我方是停用 status=2，不物理删）",
  ],
  [
    "GET /v1/rmadminsrv/novel_market/promotions",
    "GET /ops/market/promotions",
    "同为 GET",
  ],
  [
    "POST /v1/rmadminsrv/novel_market/promotions",
    "POST /ops/market/promotions",
    "同为 POST",
  ],
  [
    "PUT /v1/rmadminsrv/novel_market/promotions/{promotion_id}",
    "PATCH /ops/market/promotions/{}",
    "局部更新统一 PATCH（竞品 PUT）",
  ],
  [
    "DELETE /v1/rmadminsrv/novel_market/promotions/{promotion_id}",
    "DELETE /ops/market/promotions/{}",
    "同为 DELETE（我方软停，保留投放历史）",
  ],
];
const OPS_MARKET_SHAPES = NOVEL_ADMIN_PAIRS.map(([shape]) => shape);

const WAIVED: Record<string, string> = {
  "GET /task/is_first/interact":
    "我方没有「结果互动」概念，`task_events` 也没有 user_id 列 —— 算不出「这个人的首次互动」，硬回一个 true 就是假数据",
  "POST /task/result/folder":
    "我方任务没有文件夹模型（`tasks` 表无 folder_id，`GET /task` 也没有 folder 维度），建文件夹表超出本批范围",
  "POST /task/result/interact":
    "同上：结果互动需要「谁在什么时候对哪条结果做了什么」的落库模型，`task_events` 缺 user_id，补了也不能去重",
  "POST /task/workflow/retry":
    "我方 Capability 只有 video/image/text/speech/music，没有 workflow 任务实体；workflow 在我方是画布/agent 编排，条目不同",
};

/**
 * 显式登记的形状偏离：竞品形状 → 我方等价形状（同 METHOD 同路径，归一化后）。
 *
 * 只允许登记「能力已经在、只是形状不同」的偏离。能力缺失必须补代码，不能登记到这张表里
 * —— 第 79 批的教训就是「把缺的能力写进文档说成口径差异」等于自欺。
 * 每条都要写清依据，读的人不需要再问。
 */
const DEVIATIONS: Record<string, { ours: string; reason: string }> = {
  "GET /campaign/list": {
    ours: "GET /campaigns",
    reason: "ADR-009：竞品用单数 `campaign`，我方按资源所有权用复数 `campaigns`（campaign.controller.ts 文件头已登记）",
  },
  "GET /campaign/detail": {
    ours: "GET /campaigns/{}",
    reason: "同上：单复数差异 + 活动 id 走路径而不是 query",
  },
  "GET /campaign/awards": {
    ours: "GET /campaigns/{}/awards",
    reason: "同上：单复数差异 + 活动 id 走路径",
  },
  "GET /campaign/shortlist": {
    ours: "GET /campaigns/{}/shortlist",
    reason: "同上：单复数差异 + 活动 id 走路径",
  },
  "GET /campaign/signup/draft": {
    ours: "GET /campaigns/{}/signup",
    reason: "同上：`signup/draft` 折叠成资源子路径 `/signup`（GET 读草稿）",
  },
  "POST /campaign/signup/draft": {
    ours: "PUT /campaigns/{}/signup",
    reason: "同上：草稿保存语义是「整体替换」故用 PUT；竞品用 POST 是它的风格，不是我方的缺口",
  },
  "POST /campaign/signup/submit": {
    ours: "POST /campaigns/{}/signup",
    reason: "同上：报名提交与草稿共用 `/signup`，靠 body 里的字段区分（我方在契约里写明）",
  },
  // ---- 第 82 批：#24 任务系统，能力在、形状不同 ----
  // 竞品任务域用**单数** `/task/*`（除 `POST /task/result` 外），我方资源一律复数 `/tasks/*`。
  // 这是 ADR-009 的命名风格差异，不是能力缺口，故统一登记而不加单数别名
  // （第 81 批给 kds 加别名是因为那里差的是 METHOD，按竞品形状发请求会 404 而不是「换个路径」）。
  "DELETE /task/{}": { ours: "DELETE /tasks/{}", reason: "ADR-009：竞品单数 `/task/*`，我方复数 `/tasks/*`" },
  "GET /task": { ours: "GET /tasks", reason: "同上：列表在 `/tasks`（我方复数风格）" },
  "GET /task/{}": { ours: "GET /tasks/{}", reason: "同上：单条详情" },
  "POST /task/{}/cancel": {
    ours: "POST /tasks/{}/cancel",
    reason: "同上：任务动作都挂在 `/tasks/{id}/*` 下（cancel/retry/regenerate/feedback/share 同族）",
  },
  "POST /task/{}/feedback": { ours: "POST /tasks/{}/feedback", reason: "同上：反馈挂在任务资源下" },
  "POST /task/{}/regenerate": { ours: "POST /tasks/{}/regenerate", reason: "同上：再生成与 retry 分属两条（语义不同）" },
  "POST /task/{}/retry": { ours: "POST /tasks/{}/retry", reason: "同上：重试只对失败态" },
  "POST /task/{}/share": { ours: "POST /tasks/{}/share", reason: "同上：创建分享挂在任务资源下" },
  "POST /task/{}/download": {
    ours: "POST /tasks/{}/download",
    reason:
      "第 82 批**新增的能力**（一次拿全部结果 URL）：路径按我方复数风格落在 `/tasks/{id}/download`，单复数差异同上",
  },
  "POST /task/result/batch-download": {
    ours: "POST /tasks/batch-download",
    reason: "我方批量下载是 `/tasks/batch-download`（复数前缀）；竞品把 `result` 折进 `task/result/*` 命名空间",
  },
  "GET /task/share/{}/info": {
    ours: "GET /share/{}",
    reason:
      "分享是独立资源：竞品用 server 生成的 `share_id`，我方用不可猜测的 `token`（`task_shares.token`，24 字节 base64url），都只用于匿名读取",
  },
  "POST /task/share/{}/batch-download": {
    ours: "POST /share/{}/batch-download",
    reason: "同上：匿名分享走 `/share/{token}/*`，不能挂到需要登录态的任务路径下",
  },
};

// 第 83 批：#27 运营后台 18 条（前缀是 `/v1/rmadminsrv`，全部登记我方 `/ops/market/*` 等价物）
for (const [shape, ours, reason] of NOVEL_ADMIN_PAIRS) DEVIATIONS[shapeOf(shape)] = { ours, reason };

// 第 83 批：#1 首页 1 条 —— 能力在、形状不同（竞品是「查一次有没有未读」，我方是长轮询）
DEVIATIONS["GET /msg/exist-unread"] = {
  ours: "GET /home/unread",
  reason:
    "竞品 `exist-unread` 是查一次就返回；我方 `/home/unread` 是长轮询（`since` + `timeout_ms`，默认挂到 25s 上限）。" +
    "立即探针 `?since=<iso>&timeout_ms=1` 就是等价调用：`home.service.ts` 在 `timeoutMsRaw>0` 时按它截断，1ms 即返回 `timed_out:true`，" +
    "等价性由 `home-config.spec.ts` 的 timeout 语义用例守着",
};

// 第 83 批：#26 分享 1 条 —— 分享页 SSE 挂在 `/share/{token}/stream`（匿名、只读），不挂在 agent 命名空间下
DEVIATIONS["GET /agent/task/share/{}/sse"] = {
  ours: "GET /share/{}/stream",
  reason:
    "#4 的分享页实时流是自建口径：匿名 token 直接映射 `/share/{token}/stream`（只读 SSE），" +
    "不跟竞品一样把分享挂在 `agent/task/share/...` 下 —— 那条路径要求登录态，与分享的匿名语义冲突",
};

const EXPECTED_COUNTS: Record<string, number> = {
  film: FILM_SHAPES.length,
  crc: CRC_SHAPES.length,
  op: OP_SHAPES.length,
  campaign: CAMPAIGN_SHAPES.length,
  kds: KDS_SHAPES.length,
  task: TASK_SHAPES.length,
  home: HOME_SHAPES.length,
  share: SHARE_SHAPES.length,
  ops_market: OPS_MARKET_SHAPES.length,
};

function walk(dir: string, accept: (name: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(full, accept, out);
    } else if (accept(name)) {
      out.push(full);
    }
  }
  return out;
}

function normalize(path: string): string {
  let p = path.trim().split("?")[0]!.split("#")[0]!;
  p = p.replace(/^https?:\/\/[^/]+/, "");
  // 竞品路由都带 `/web/v1` 前缀；我方网关就是 `/v1`，去掉前缀后两侧同构
  p = p.replace(/^\/web\/v1/, "");
  p = `/${p}`.replace(/^\/+/, "/");
  p = p.replace(/:([A-Za-z0-9_]+)/g, WILDCARD).replace(/\{[^}]*\}/g, WILDCARD);
  p = p.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return p || "/";
}

function shapeOf(raw: string): string {
  const [method, ...rest] = raw.trim().split(/\s+/);
  return `${method!.toUpperCase()} ${normalize(rest.join(" "))}`;
}

function ourRoutes(): Set<string> {
  const routes = new Set<string>();
  const controllerRe = /@Controller\(\s*(?:"([^"]*)"\s*)?\)/g;
  const methodRe = /@(Get|Post|Put|Patch|Delete)\(\s*(?:"([^"]*)")?\s*\)/g;
  for (const file of walk(API_SRC, (name) => name.endsWith(".controller.ts"))) {
    const text = readFileSync(file, "utf8");
    const marks = [...text.matchAll(controllerRe)];
    for (let i = 0; i < marks.length; i += 1) {
      const base = marks[i]![1] ?? "";
      const from = (marks[i]!.index ?? 0) + marks[i]![0].length;
      const to = i + 1 < marks.length ? (marks[i + 1]!.index ?? text.length) : text.length;
      for (const m of text.slice(from, to).matchAll(methodRe)) {
        const sub = m[2] ?? "";
        routes.add(`${m[1]!.toUpperCase()} ${normalize(sub ? `/${base}/${sub}` : `/${base}`)}`);
      }
    }
  }
  return routes;
}

const ROUTES = ourRoutes();
const DEVIATED = new Set(Object.keys(DEVIATIONS));
const WAIVED_SHAPES = new Set(Object.keys(WAIVED));

function missing(shapes: string[]): string[] {
  const gaps: string[] = [];
  for (const raw of shapes) {
    const shape = shapeOf(raw);
    if (ROUTES.has(shape)) continue;
    const deviation = DEVIATIONS[shape];
    if (deviation) {
      // 白名单不能自证：登记的我方形状必须真的存在，否则改路径会静默通过
      expect(ROUTES.has(deviation.ours), `deviation target missing: ${shape} → ${deviation.ours}`).toBe(true);
      continue;
    }
    // 豁免也要自证：必须写清缺哪个模型，且不能与偏离表重叠
    const waiver = WAIVED[shape];
    if (waiver) {
      expect(waiver.length, `waiver reason too short: ${shape}`).toBeGreaterThan(20);
      expect(DEVIATED.has(shape), `shape both deviated and waived: ${shape}`).toBe(false);
      continue;
    }
    gaps.push(shape);
  }
  return gaps;
}

describe("竞品路由逐条对照（第 80 批：「100%」必须有守卫）", () => {
  it("我方路由表解析出足够多的路由（防止解析器坏掉后全绿）", () => {
    expect(ROUTES.size).toBeGreaterThan(600);
    // 四个被审计域的关键锚点必须在表里，否则说明 controller 被改名/挪走了
    expect(ROUTES.has("GET /film/projects/{}/task-tables/{}/tasks/query")).toBe(true);
    expect(ROUTES.has("POST /film/projects/{}/task-tables/{}/tasks/query")).toBe(true);
    expect(ROUTES.has("GET /crc/user/info")).toBe(true);
    expect(ROUTES.has("POST /crc/user/info")).toBe(true);
    expect(ROUTES.has("GET /op/beta-questionnaire")).toBe(true);
    expect(ROUTES.has("GET /campaigns/{}/signup")).toBe(true);
    // 第 81 批：数据看板的同名 GET/POST 双形状（竞品 POST，我方补别名后两者都在）
    expect(ROUTES.has("GET /kds/da/team/{}/query")).toBe(true);
    expect(ROUTES.has("POST /kds/da/team/{}/query")).toBe(true);
    // 第 82 批：任务结果批量下载（新增能力；竞品形状是单数 `/task/{id}/download`，登记在 DEVIATIONS）
    expect(ROUTES.has("POST /tasks/{}/download")).toBe(true);
    expect(ROUTES.has("POST /tasks/batch-download")).toBe(true);
    // 第 83 批：运营后台标签改名（竞品 PUT → 我方 PATCH）、首页长轮询、分享页 SSE
    expect(ROUTES.has("PATCH /ops/market/tags/{}")).toBe(true);
    expect(ROUTES.has("GET /home/unread")).toBe(true);
    expect(ROUTES.has("GET /share/{}/stream")).toBe(true);
  });

  it("竞品九组路由条数与台账口径一致（film 48 / crc 30 / op 35 / campaign 7 / kds 13 / task 17 / home 5 / share 5 / ops 18）", () => {
    expect(EXPECTED_COUNTS).toEqual({
      film: 48,
      crc: 30,
      op: 35,
      campaign: 7,
      kds: 13,
      task: 17,
      home: 5,
      share: 5,
      ops_market: 18,
    });
    expect(
      FILM_SHAPES.length +
        CRC_SHAPES.length +
        OP_SHAPES.length +
        CAMPAIGN_SHAPES.length +
        KDS_SHAPES.length +
        TASK_SHAPES.length +
        HOME_SHAPES.length +
        SHARE_SHAPES.length +
        OPS_MARKET_SHAPES.length,
    ).toBe(178);
    // 去重后再数一遍：数组里不该有重复写两遍的形状（会虚增覆盖数）
    for (const [name, shapes] of Object.entries({
      film: FILM_SHAPES,
      crc: CRC_SHAPES,
      op: OP_SHAPES,
      campaign: CAMPAIGN_SHAPES,
      kds: KDS_SHAPES,
      task: TASK_SHAPES,
      home: HOME_SHAPES,
      share: SHARE_SHAPES,
      ops_market: OPS_MARKET_SHAPES,
    })) {
      const unique = new Set(shapes.map(shapeOf));
      expect(unique.size, `${name} has duplicated shapes`).toBe(shapes.length);
    }
  });

  it("#8 影视版：竞品 48 条全部覆盖（0 缺口、0 偏离）", () => {
    expect(missing(FILM_SHAPES)).toEqual([]);
    expect(FILM_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)))).toEqual([]);
  });

  it("#10 创作者中心：竞品 30 条全部覆盖（0 缺口、0 偏离）", () => {
    expect(missing(CRC_SHAPES)).toEqual([]);
    expect(CRC_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)))).toEqual([]);
  });

  it("#10 运营：竞品 35 条全部覆盖（0 缺口、0 偏离）", () => {
    expect(missing(OP_SHAPES)).toEqual([]);
    expect(OP_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)))).toEqual([]);
  });

  it("#10 激励活动：7 条全部覆盖，且每条偏离都显式登记过（ADR-009 单复数）", () => {
    expect(missing(CAMPAIGN_SHAPES)).toEqual([]);
    const recorded = CAMPAIGN_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)));
    expect(recorded.length).toBe(7);
    for (const raw of recorded) {
      expect(DEVIATIONS[shapeOf(raw)]!.reason.length).toBeGreaterThan(10);
    }
  });

  it("#21 数据看板：13 条全部覆盖（5 GET + 8 POST 别名，0 缺口、0 偏离）", () => {
    expect(KDS_SHAPES.length).toBe(13);
    expect(missing(KDS_SHAPES)).toEqual([]);
    expect(KDS_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)))).toEqual([]);
  });

  it("#24 任务系统：17 条里 1 条同形 + 12 条命名偏离 + 4 条无模型豁免", () => {
    expect(TASK_SHAPES.length).toBe(17);
    expect(missing(TASK_SHAPES)).toEqual([]);
    const deviated = TASK_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)));
    const waived = TASK_SHAPES.filter((raw) => WAIVED_SHAPES.has(shapeOf(raw)));
    const exact = TASK_SHAPES.filter((raw) => ROUTES.has(shapeOf(raw)));
    // 三条数加起来必须正好等于 17：不多不少，漏一条或重复登记都会红
    expect(exact.length).toBe(1); // POST /task/result（我方本来就是同名路径）
    expect(deviated.length).toBe(12);
    expect(waived.length).toBe(4);
    expect(exact.length + deviated.length + waived.length).toBe(TASK_SHAPES.length);
    // 豁免项必须点名「缺的是哪个模型/哪张表」，写不清楚就退回去补代码
    for (const raw of waived) {
      expect(WAIVED[shapeOf(raw)]!.length, `waiver too vague: ${raw}`).toBeGreaterThan(20);
    }
  });


  it("#1 首页工作台：5 条里 4 条同形 + 1 条偏离（msg/exist-unread → /home/unread）", () => {
    expect(HOME_SHAPES.length).toBe(5);
    expect(missing(HOME_SHAPES)).toEqual([]);
    const deviated = HOME_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)));
    expect(deviated).toEqual(["GET /web/v1/msg/exist-unread"]);
    // 偏离必须写清「等价调用长什么样」，否则下一批又会当成缺口重查一遍
    expect(DEVIATIONS["GET /msg/exist-unread"]!.reason).toContain("timeout_ms=1");
  });

  it("#26 分享：5 条里 1 条同形 + 4 条偏离（token 而非 share_id），0 缺口", () => {
    expect(SHARE_SHAPES.length).toBe(5);
    expect(missing(SHARE_SHAPES)).toEqual([]);
    const exact = SHARE_SHAPES.filter((raw) => ROUTES.has(shapeOf(raw)));
    const deviated = SHARE_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)));
    expect(exact).toEqual(["POST /web/v1/crc/assets/share"]);
    expect(deviated.length).toBe(4);
    // 其中 3 条是 #24 已经登记过的任务分享形状，这里只是复用；第 4 条是分享页 SSE
    expect(DEVIATIONS["GET /agent/task/share/{}/sse"]!.ours).toBe("GET /share/{}/stream");
  });

  it("#27 运营后台：18 条全部登记等价物（12 条同方法 + 6 条方法偏离），0 缺口", () => {
    expect(OPS_MARKET_SHAPES.length).toBe(18);
    expect(missing(OPS_MARKET_SHAPES)).toEqual([]);
    // 前缀不同（/v1/rmadminsrv vs /ops/market），所以 18 条全走 DEVIATIONS；
    // 其中 12 条方法与竞品一致，6 条是「读改 GET / 全量改局部」的方法偏离
    const deviated = OPS_MARKET_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)));
    expect(deviated.length).toBe(18);
    const sameMethod = OPS_MARKET_SHAPES.filter((raw) => {
      const shape = shapeOf(raw);
      return DEVIATIONS[shape]!.ours.startsWith(`${shape.split(" ")[0]} `);
    });
    expect(sameMethod.length).toBe(12);
    expect(OPS_MARKET_SHAPES.length - sameMethod.length).toBe(6);
  });
  it("偏离与豁免登记表都没有死条目（每条都对应竞品真实形状）", () => {
    const all = new Set(
      [
        ...FILM_SHAPES,
        ...CRC_SHAPES,
        ...OP_SHAPES,
        ...CAMPAIGN_SHAPES,
        ...KDS_SHAPES,
        ...TASK_SHAPES,
        ...HOME_SHAPES,
        ...SHARE_SHAPES,
        ...OPS_MARKET_SHAPES,
      ].map(shapeOf),
    );
    expect(Object.keys(DEVIATIONS).filter((shape) => !all.has(shape))).toEqual([]);
    expect(Object.keys(WAIVED).filter((shape) => !all.has(shape))).toEqual([]);
    // 豁免只给 #24 开过口子：以后想给别的域用，必须显式改这条断言并在台账记账
    const taskShapes = new Set(TASK_SHAPES.map(shapeOf));
    expect(Object.keys(WAIVED).filter((shape) => !taskShapes.has(shape))).toEqual([]);
  });
});
