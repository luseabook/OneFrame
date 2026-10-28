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
 * 本文件把竞品的十九组路由逐条内联进来（film 48 / crc 30 / op 35 / campaign 7 / kds 13 /
 * task 17 / home 5 / share 5 / ops_market 18 / novel_market 29 / agent 12 / account 28 / ai 64 / canvas 114 /
 * asset 36 / novel 102 / episode 72 / project 21 / team 29，共 685 条，来自
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
 * 数字口径：十九组共 685 条竞品操作（各组独立计数；分享类的几条同时出现在 #4/#24/#26 三组的视角里，
 * 属于「同一个形状被三个模块引用」，不是重复记账）。改这些数组就得同步改
 * `docs/07-plan/implement-progress-vs-reelmate.md` 里 #1 / #2 / #3 / #4 / #5 / #6 / #7 / #8 / #10 / #11 / #12 / #21 / #22 / #24 / #26 / #27 十六行的
 * 「逐条对照」说法。
 *
 * 第 86 批（#6 工具箱）的特殊之处：竞品是「一个工具一条 `/ai/*` 路由」（64 条），我方是
 * ADR-003「差异在参数不在端点」——只有 `GET /generations/tools`（目录）+ `POST /generations`
 * （body 里 `capability` + `mode`）。所以这一组的 44 条覆盖是**结构性偏离**（多条竞品形状
 * 指向同一个我方形状）。
 *
 * 第 93 批补齐了「我的音色」这一族：`/ai/voice-clone*` 4 条 + `/ai/timbre*` 3 条 +
 * `/ai/text-to-speech/voice/list` 共 8 条**从豁免变成同形**（我方也长在 `/ai` 下 —— 这
 * 8 条操作的对象是「用户自己的音色资产」，不是生成任务，硬塞进 `POST /generations`
 * 反而会让「改名」「删除」两个动作无处表达）。剩下 12 条按「产品范围外」豁免。
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

/**
 * #12 剧本广场（消费侧）：竞品 29 条，前缀 `/web/v1/df/novel_market/*`（第 84 批）。
 *
 * 竞品把剧本广场挂在 `df`（剧本文件域）下，我方是独立资源 `/market/*`；`normalize()` 只剥 `/web/v1`，
 * 所以 29 条全部要登记「我方等价形状」。逐条核过：**方法一致、路径尾段一一对应**，
 * 差异只有「挂在哪个前缀下」这一层，没有一条需要补别名或补能力。
 * 管理面 18 条不在这里 —— 它们是 #27 运营后台的对账对象（`NOVEL_ADMIN_PAIRS`），
 * 此前台账把两边写在一起（「竞品 29+12 全覆盖」）导致同一批行被记了两次，第 84 批已拆开。
 */
const NOVEL_MARKET_PAIRS: Array<[shape: string, ours: string, reason: string]> = [
  ["GET /web/v1/df/novel_market/scripts", "GET /market/scripts", "竞品消费侧前缀 `df/novel_market`，我方独立资源 `/market/*`；方法一致、尾段同构"],
  ["GET /web/v1/df/novel_market/scripts/config", "GET /market/scripts/config", "同上：广场配置页"],
  ["GET /web/v1/df/novel_market/scripts/promotions", "GET /market/scripts/promotions", "同上：推广位列表"],
  ["GET /web/v1/df/novel_market/scripts/:nm_id/detail", "GET /market/scripts/{}/detail", "同上：作品详情（参数名 nm_id → id，形状同构）"],
  ["GET /web/v1/df/novel_market/scripts/:nm_id/characters", "GET /market/scripts/{}/characters", "同上：角色表"],
  ["GET /web/v1/df/novel_market/scripts/:nm_id/episodes", "GET /market/scripts/{}/episodes", "同上：分集表"],
  ["GET /web/v1/df/novel_market/scripts/:nm_id/timestamp", "GET /market/scripts/{}/timestamp", "同上：时间轴"],
  ["POST /web/v1/df/novel_market/scripts/:nm_id/preorder", "POST /market/scripts/{}/preorder", "同上：预约（写动作，方法一致）"],
  ["GET /web/v1/df/novel_market/scripts/:nm_id/download", "GET /market/scripts/{}/download", "同上：下载（购买后）"],
  ["GET /web/v1/df/novel_market/scripts/:nm_id/author", "GET /market/scripts/{}/author", "同上：作者信息"],
  ["GET /web/v1/df/novel_market/scripts/:nm_id/business", "GET /market/scripts/{}/business", "同上：商务信息"],
  ["POST /web/v1/df/novel_market/scripts/:nm_id/cancelorder", "POST /market/scripts/{}/cancelorder", "同上：取消预约"],
  ["GET /web/v1/df/novel_market/scripts/:nm_id/content-tree", "GET /market/scripts/{}/content-tree", "同上：内容树（购买后可读）"],
  ["GET /web/v1/df/novel_market/scripts/:nm_id/creator", "GET /market/scripts/{}/creator", "同上：作者简介（广场视角）"],
  ["GET /web/v1/df/novel_market/scripts/:nm_id/agreement", "GET /market/scripts/{}/agreement", "同上：授权协议"],
  ["GET /web/v1/df/novel_market/scripts/:nm_id/agreement-file", "GET /market/scripts/{}/agreement-file", "同上：协议文件"],
  ["GET /web/v1/df/novel_market/creator/profile", "GET /market/creator/profile", "同上：创作者资料"],
  ["GET /web/v1/df/novel_market/creator/works", "GET /market/creator/works", "同上：我的作品列表"],
  ["POST /web/v1/df/novel_market/creator/works/save", "POST /market/creator/works/save", "同上：保存作品草稿"],
  ["POST /web/v1/df/novel_market/creator/works/:nm_id/submit", "POST /market/creator/works/{}/submit", "同上：提交审核"],
  ["POST /web/v1/df/novel_market/creator/works/:nm_id/withdraw", "POST /market/creator/works/{}/withdraw", "同上：撤回投稿"],
  ["POST /web/v1/df/novel_market/creator/works/:nm_id/offline", "POST /market/creator/works/{}/offline", "同上：下架"],
  ["GET /web/v1/df/novel_market/creator/revenues", "GET /market/creator/revenues", "同上：收益明细"],
  ["GET /web/v1/df/novel_market/creator/revenues/overview", "GET /market/creator/revenues/overview", "同上：收益概览"],
  ["GET /web/v1/df/novel_market/creator/works/stats", "GET /market/creator/works/stats", "同上：作品数据"],
  ["GET /web/v1/df/novel_market/creator/works/:nm_id", "GET /market/creator/works/{}", "同上：作品详情（创作者视角）"],
  ["GET /web/v1/df/novel_market/creator/works/:nm_id/agreement", "GET /market/creator/works/{}/agreement", "同上：作品的授权协议"],
  ["GET /web/v1/df/novel_market/creator/works/:nm_id/content-tree", "GET /market/creator/works/{}/content-tree", "同上：作品内容树"],
  ["POST /web/v1/df/novel_market/creator/works/parse", "POST /market/creator/works/parse", "同上：解析作品（上传剧本 → 结构解析）"],
];
const NOVEL_MARKET_SHAPES = NOVEL_MARKET_PAIRS.map(([shape]) => shape);

/**
 * #4 创作 Agent：竞品 `/web/v1/agent/*` 12 条（第 84 批）。
 *
 * 12 条里 7 条同形（其中 `POST /agent/task/stream` 是本批补的别名：竞品是 POST + json body +
 * query task_id，我方原先只有 GET）、1 条偏离（分享页 SSE）、4 条豁免（`/agent/home/resource/*`
 * 三条是「有意不做」：竞品只有端点名、无响应体，依赖内容运营表，为"可能不存在的内容模型"设计表
 * = 凭空造数据；`stt-token` 需要语音服务凭据，属外部输入）。
 */
const AGENT_SHAPES = [
  "POST /web/v1/agent/task/create",
  "POST /web/v1/agent/task/create-check",
  "POST /web/v1/agent/task/chat",
  "POST /web/v1/agent/task/chat-end",
  "PUT /web/v1/agent/task/:task_id",
  "POST /web/v1/agent/task/stream",
  "POST /web/v1/agent/task/batch-download",
  "GET /web/v1/agent/task/share/:share_id/sse",
  "GET /web/v1/agent/stt-token",
  "GET /web/v1/agent/home/resource/recommend",
  "GET /web/v1/agent/home/resource/info",
  "GET /web/v1/agent/home/resource/sse",
];


/**
 * #22 账号/鉴权：竞品散落在 `/web/v1/{login,logout,renew,callback,user*,env,config,...}` 的 28 条（第 85 批）。
 *
 * 为什么这 28 条没有统一前缀也能算一个域：竞品自己也没有 `/web/v1/account/*` 域，
 * 这些路径全是"跟这个人有关"的零散端点（登录态、资料、设置、积分、订阅、内容安全）。
 * 判定结果：9 条同形（本批补齐）、11 条能力在但形状不同（登录改用 `/auth/*`、注销用 POST、
 * 积分看板用 space 钱包…）、8 条豁免（邮箱验证码通道、欠费模型、火山用量、微信 JS-SDK 签名、
 * i18n 上报、运行时 env/config —— 都是"我方没有这个模型/这个外部依赖"）。
 */
const ACCOUNT_SHAPES = [
  "POST /web/v1/login",
  "GET /web/v1/logout",
  "GET /api/user/logout",
  "GET /web/v1/renew",
  "GET /web/v1/callback/login",
  "POST /web/v1/email-captcha",
  "POST /web/v1/email-captcha/validate",
  "GET /web/v1/captcha-check",
  "GET /web/v1/user-info",
  "POST /web/v1/user-info",
  "GET /web/v1/user-settings",
  "PUT /web/v1/user-settings",
  "GET /web/v1/user/ip",
  "GET /web/v1/user/credits",
  "GET /web/v1/user/credits-log",
  "GET /web/v1/user/credits-dashboard",
  "GET /web/v1/user/credits-dashboard/flows",
  "GET /web/v1/user/credits-dashboard/debt-list",
  "POST /web/v1/user/credits-dashboard/volc-query",
  "GET /web/v1/user-vip-info",
  "GET /web/v1/trade-order/latest",
  "POST /web/v1/buy/sku-price",
  "POST /web/v1/subscribe/activity-upgrade/upgrade",
  "GET /web/v1/weixin/token",
  "POST /web/v1/text-sensidetect",
  "POST /web/v1/user/language/report",
  "GET /web/v1/env",
  "GET /web/v1/config",
];

/**
 * 工具箱：竞品 `/web/v1/ai/*` 64 操作（ADR-003：竞品一工具一路由，我方一条 `POST /generations` + mode）
 *
 * 证据只到「方法 + 路径」（两个 schema 全空）。所以这里的判断不是「像不像」，而是
 * 「这个工具背后的能力，我方有没有对应的 mode / 模块」。
 */
const AI_SHAPES = [
  "POST /web/v1/ai/ip-template-to-video",
  "POST /web/v1/ai/ip-template/list",
  "GET /web/v1/ai/task/strategy-info",
  "POST /web/v1/ai/prompt-optimize",
  "GET /web/v1/ai/chat-msg-list",
  "GET /web/v1/ai/chat-sess-list",
  "POST /web/v1/ai/chat/completion",
  "POST /web/v1/ai/chat/abort",
  "POST /web/v1/ai/chat/session/create",
  "POST /web/v1/ai/chat/session/list",
  "POST /web/v1/ai/chat/session/clean",
  "POST /web/v1/ai/asset-match",
  "POST /web/v1/ai/asset-match/result",
  "POST /web/v1/ai/asset-match/{task_id}/cancel",
  "POST /web/v1/ai/text-to-video",
  "POST /web/v1/ai/image-to-video",
  "POST /web/v1/ai/refer-image-to-video",
  "POST /web/v1/ai/refer-video-to-video",
  "POST /web/v1/ai/refer-media-to-video",
  "POST /web/v1/ai/video-to-video",
  "POST /web/v1/ai/video-crop",
  "POST /web/v1/ai/video-convert",
  "POST /web/v1/ai/video-soundtrack",
  "POST /web/v1/ai/video-audio-separation",
  "POST /web/v1/ai/video-subtitle-erase",
  "POST /web/v1/ai/video-subtitle-voice-edit",
  "POST /web/v1/ai/video-super-resolution",
  "POST /web/v1/ai/fps-duration-unify",
  "POST /web/v1/ai/effect",
  "POST /web/v1/ai/advanced-lip",
  "POST /web/v1/ai/audio-timbre-modify",
  "POST /web/v1/ai/audio-slicing",
  "POST /web/v1/ai/text-to-image",
  "POST /web/v1/ai/refer-image-to-image",
  "POST /web/v1/ai/redraw-to-image",
  "POST /web/v1/ai/image-super-resolution",
  "POST /web/v1/ai/image-batch-super-resolution",
  "POST /web/v1/ai/text-to-audio",
  "POST /web/v1/ai/text-to-music",
  "POST /web/v1/ai/text-to-sfx",
  "POST /web/v1/ai/text-to-speech",
  "POST /web/v1/ai/voice-clone",
  "GET /web/v1/ai/text-to-speech/voice/list",
  "GET /web/v1/ai/voice-clone-list",
  "GET /web/v1/ai/voice-clone/{task_id}",
  "DELETE /web/v1/ai/voice-clone/{task_id}",
  "POST /web/v1/ai/voice-clone/rename",
  "GET /web/v1/ai/timbre-category/list",
  "GET /web/v1/ai/timbre/list",
  "POST /web/v1/ai/timbre/collect",
  "POST /web/v1/ai/check-language",
  "POST /web/v1/ai/world-generate",
  "POST /web/v1/ai/image-recognition",
  "POST /web/v1/ai/image-to-text",
  "POST /web/v1/ai/face-recognition",
  "POST /web/v1/ai/identify-face",
  "POST /web/v1/ai/style-extraction",
  "POST /web/v1/ai/file-sign-url",
  "POST /web/v1/ai/point-calculate",
  "POST /web/v1/ai/publish",
  "POST /web/v1/ai/text-to-text",
  "POST /web/v1/ai/video-process-session/create",
  "POST /web/v1/ai/video-process-session/detail",
  "POST /web/v1/ai/video-process-session/update-edit",
];

const WAIVED: Record<string, string> = {
  "GET /task/is_first/interact":
    "我方没有「结果互动」概念，`task_events` 也没有 user_id 列 —— 算不出「这个人的首次互动」，硬回一个 true 就是假数据",
  "POST /task/result/folder":
    "我方任务没有文件夹模型（`tasks` 表无 folder_id，`GET /task` 也没有 folder 维度），建文件夹表超出本批范围",
  "POST /task/result/interact":
    "同上：结果互动需要「谁在什么时候对哪条结果做了什么」的落库模型，`task_events` 缺 user_id，补了也不能去重",
  "POST /task/workflow/retry":
    "我方 Capability 只有 video/image/text/speech/music，没有 workflow 任务实体；workflow 在我方是画布/agent 编排，条目不同",
  // ---- 第 84 批：#4 创作 Agent 的 4 条 ----
  "GET /agent/home/resource/recommend":
    "有意不做（api-spec §14.9.3）：竞品只给了端点名、无响应体证据，推荐位内容是运营依赖；为「可能不存在的内容模型」建表 = 凭空造数据",
  "GET /agent/home/resource/info":
    "同上：资源详情同属 agent 首页运营位，缺响应体证据。我方 agent 首页的推荐位按自建口径（`is_home_recommend` 默认全 false）",
  "GET /agent/home/resource/sse":
    "同上：运营位实时流；我方分享/会话两条 SSE 已覆盖实时需求，这条没有可复现的帧语义",
  // ---- 第 85 批：#22 账号/鉴权的 8 条（能力不在，且不造假）----
  "POST /email-captcha":
    "我方没有邮箱注册/登录通道：账号体系只有手机号短信 + 4 渠道 SSO（wx/apple/google/wechat），做邮箱发码等于新增一条没人维护的登录路径",
  "POST /email-captcha/validate":
    "同上：没有邮箱验证码，就不存在「校验它」的端点；补一个恒回 true 的校验是最坏的那种假接口",
  "GET /user/credits-dashboard/debt-list":
    "我方没有欠费模型：`credit_accounts` 有 `check(balance >= 0)` 约束，余额不可能为负，「待补缴」用 `frozen`（预留）表达，没有可列的欠费单",
  "POST /user/credits-dashboard/volc-query":
    "火山引擎用量是外部供应商数据，需要 volc AK/SK；本仓没有该凭据，也不该为了一个查询端点引入供应商 SDK",
  "GET /weixin/token":
    "微信 JS-SDK 的 jsapi_ticket 签名需要公众号 appid/secret（外部输入）；且它只服务于微信内网页分享，我方分享页走的是自建 token，不依赖 JS-SDK",
  "POST /user/language/report":
    "i18n 缺陷上报没有落库模型（也不需要：这是运营反馈，前端走控制台/工单）；建一张只写不读的表等于把工单系统抄一遍",
  "GET /env":
    "我方配置是构建期注入（`NUXT_PUBLIC_*`）+ 运行期能力表 `/meta/capabilities`，没有「运行时下发环境变量」的需求；给客户端下发 env 还会把部署细节暴露到前端",
  "GET /config":
    "同上：竞品的 `config?module_name&key&lang` 是运营配置下发；我方的等价物是构建期常量与 `/meta/capabilities`，没有可复现的配置项清单可对",
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

// 第 84 批：#12 剧本广场消费侧 29 条（前缀 `/df/novel_market` → 我方 `/market/*`）
for (const [shape, ours, reason] of NOVEL_MARKET_PAIRS) DEVIATIONS[shapeOf(shape)] = { ours, reason };

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

// ---- 第 85 批：#22 账号/鉴权 —— 能力都在，但竞品的调用形状与我方资源模型不同 ----
// 这一组全是「登录态/资料/积分/订阅」的等价物：判定依据是**能力有对应实现**，
// 不是"路径像"。每条 ours 都会被 `missing()` 断言真实存在，指着空气会红。
const ACCOUNT_DEVIATIONS: Array<[string, string, string]> = [
  ["POST /web/v1/login", "POST /auth/login", "登录在我方是 `/auth/*` 命名空间（短信发码 + 校验两步），竞品把 login 放在根路径；两者语义一致"],
  ["GET /web/v1/logout", "POST /auth/logout", "注销是写操作，我方用 POST（GET 注销会让浏览器预取/爬虫把用户登出）"],
  ["GET /api/user/logout", "POST /auth/logout", "同上：竞品有两条注销（web 与 api 前缀），我方只有一条 POST /auth/logout"],
  ["GET /web/v1/renew", "POST /auth/renew", "续期要带 master_token 做凭据校验，必须是 POST；GET 会把长 token 写进 URL/日志"],
  ["GET /web/v1/callback/login", "POST /auth/oauth/{}/callback", "OAuth 回调我方按 provider 分段（`/auth/oauth/:provider/callback`）并用 POST 提交授权码"],
  ["GET /web/v1/captcha-check", "POST /moderation/captcha/verify", "行为验证码校验要提交票据/答案，我方在 `/moderation/captcha/verify`（POST）"],
  ["GET /web/v1/user-info", "GET /me", "当前登录者的资料读 `/me`（同时带 space 与 credits，是一个聚合视图，比只回 user 更有用）"],
  ["GET /web/v1/user-vip-info", "GET /billing/subscription", "VIP 信息就是订阅状态：`/billing/subscription` 无订阅返回 null（不是 404），与前端「未订阅」展示一致"],
  ["GET /web/v1/trade-order/latest", "GET /billing/orders", "最近订单从订单列表取（`/billing/orders` 按时间倒序，分页第 1 页即最近），没有单独 latest 端点"],
  ["POST /web/v1/subscribe/activity-upgrade/upgrade", "POST /billing/subscribe", "订阅/升级都走 `/billing/subscribe`（升级差价另有只读报价 `GET /billing/upgrade-quote`），我方不把「活动升级」单独建模"],
  ["POST /web/v1/text-sensidetect", "POST /moderation/text-detect", "内容安全检测在 `/moderation/text-detect`（同一个 provider，命名按我方模块）"],
];
for (const [shape, ours, reason] of ACCOUNT_DEVIATIONS) {
  DEVIATIONS[shapeOf(shape)] = { ours, reason };
}

/**
 * 工具箱里「一个工具一条路由」的那些工具：我方统一由 `POST /generations` 承接，
 * 具体是哪条能力由 body 的 `capability` + `mode` 决定（ADR-003）。
 *
 * 27 条全部指向同一个我方形状 —— 这不是「一条覆盖 27 条」的偷懒记账，而是
 * 我方**有意**把 27 个入口收敛成一条生成端点：参数面板由 `GET /generations/tools`
 * 的目录驱动，前端不需要为每个工具写一套请求代码。
 */
const AI_GENERIC_TOOLS = [
  "text-to-video",
  "image-to-video",
  "refer-image-to-video",
  "refer-video-to-video",
  "refer-media-to-video",
  "video-to-video",
  "video-crop",
  "video-convert",
  "video-soundtrack",
  "video-audio-separation",
  "video-subtitle-erase",
  "video-super-resolution",
  "fps-duration-unify",
  "effect",
  "advanced-lip",
  "audio-timbre-modify",
  "text-to-image",
  "refer-image-to-image",
  "redraw-to-image",
  "image-super-resolution",
  "image-batch-super-resolution",
  "text-to-audio",
  "text-to-music",
  "text-to-sfx",
  "text-to-speech",
  "voice-clone",
  "prompt-optimize",
];

/** 工具箱里由**别的模块**承接的工具/查询（形状不同，能力在） */
const AI_MODULE_PAIRS: Array<[shape: string, ours: string, reason: string]> = [
  ["POST /web/v1/ai/chat/completion", "POST /agent/task/chat", "对话回合由创作 Agent 承接（流式走 GET/POST /agent/task/stream）"],
  ["POST /web/v1/ai/text-to-text", "POST /agent/task/chat", "没有独立的「文本到文本」工具，文案类对话走创作 Agent"],
  ["POST /web/v1/ai/chat/abort", "POST /agent/task/chat-end", "中止一轮对话 = 结束会话（chat.end），我方把 abort 与会话收尾合并"],
  ["POST /web/v1/ai/chat/session/create", "POST /canvas/canvases/{}/chat/sessions", "会话挂在画布下（会话是画布的对话记录）"],
  ["POST /web/v1/ai/chat/session/list", "GET /canvas/canvases/{}/chat/sessions", "列表用 GET（竞品用 POST 传分页，属方法偏离）"],
  ["POST /web/v1/ai/chat/session/clean", "DELETE /canvas/canvases/{}/chat/sessions/{}", "清空 = 删除该会话（我方没有「保留会话但清消息」的第二态）"],
  ["GET /web/v1/ai/chat-msg-list", "GET /canvas/canvases/{}/chat/sessions/{}/messages", "消息列表挂在会话下，路径多两级归属"],
  ["GET /web/v1/ai/chat-sess-list", "GET /canvas/canvases/{}/chat/sessions", "与 session/list 同一个我方形状（竞品有两条重复列表端点）"],
  ["POST /web/v1/ai/asset-match", "POST /canvas/canvases/{}/nodes/{}/storyboard-asset-match", "素材匹配是画布节点动作（需要节点上下文才能落结果）"],
  ["POST /web/v1/ai/asset-match/result", "GET /canvas/canvases/{}/nodes/{}/task/{}", "匹配结果按任务 id 查（竞品另一条 POST 也是按 task_id 取）"],
  ["POST /web/v1/ai/asset-match/{task_id}/cancel", "POST /canvas/canvases/{}/nodes/{}/storyboard-asset-match/cancel", "取消挂在节点动作下（需要节点归属才能校验）"],
  ["POST /web/v1/ai/point-calculate", "POST /credits/quote", "算价入口是报价单（返回 line_items + 余额校验），不是单点数字"],
  ["POST /web/v1/ai/file-sign-url", "POST /assets/upload", "签发上传凭据是资产上传的第一步；我方返回资产 id + 直传信息"],
  ["POST /web/v1/ai/publish", "POST /projects/{}/episodes/{}/timeline/publish", "发布是剧集时间轴动作（要发布的是某一集的成片）"],
  ["POST /web/v1/ai/ip-template/list", "GET /subjects/templates", "IP 模板 = 主体模板库（subjects.templates）"],
  ["POST /web/v1/ai/ip-template-to-video", "POST /subjects/{}/apply-template", "模板生视频 = 把模板套到主体上再走生成"],
  ["GET /web/v1/ai/task/strategy-info", "GET /tasks/{}", "任务详情里带 model/options/strategy —— 策略不是独立资源，是任务的字段"],
];

/**
 * 工具箱这一组里**没有等价物**的 12 条，全部是竞品的**其它产品面**
 * （人脸识别、世界模型、音频切片、视频处理会话…），不在我方「影视创作工具箱」范围内
 * → 属范围外，不计入缺口。
 *
 * 第 93 批之前这里还有 5 条「该有但没有」的音色库形状（记 B 类、台账据实降分）。
 * 那 5 条已落地成本组的同形路由，于是不再豁免 —— 豁免表要随实现收缩，
 * 否则「豁免」会变成「做过的事还挂在缺口里」，分数永远收不回来。
 */
const AI_WAIVED: Record<string, string> = {
  "POST /web/v1/ai/video-subtitle-voice-edit":
    "范围外：逐句字幕配音重录需要字幕级时间轴编辑器；我方去字幕只做擦除（de_subtitle_auto/region），不做重配音",
  "POST /web/v1/ai/audio-slicing":
    "范围外：音频切片需要独立音频时间轴；我方 video_slicing 只切视频轨",
  "POST /web/v1/ai/image-recognition":
    "范围外：图像理解不在工具箱口径内 —— 我方分析能力只有 video_parse（分析视频），没有 image_parse 模式，也没有对应工具箱卡",
  "POST /web/v1/ai/image-to-text":
    "范围外：同上，图像到文本没有 mode、没有卡、没有产品入口",
  "POST /web/v1/ai/face-recognition":
    "范围外：人脸识别是竞品独立工具面（人脸库 + 检索）；我方产品范围是影视创作，不做人脸资产库",
  "POST /web/v1/ai/identify-face":
    "范围外：同 face-recognition —— 没有人脸库就没有「识别这个人是谁」的落点",
  "POST /web/v1/ai/style-extraction":
    "范围外：风格提取是竞品的风格资产化工作流；我方 multi_reference 只做参考图生图，不产出可复用风格资产",
  "POST /web/v1/ai/world-generate":
    "范围外：世界模型生成是竞品另一条产品线，我方不做",
  "POST /web/v1/ai/check-language":
    "范围外：提示词语言校验是竞品独立工具；我方 moderation/text-detect 只做敏感词，不做语言判定",
  "POST /web/v1/ai/video-process-session/create":
    "范围外：视频处理会话是多步处理的上下文对象；我方用任务链（task → task）表达，没有独立会话资源",
  "POST /web/v1/ai/video-process-session/detail":
    "范围外：同上 —— 没有会话对象就没有详情",
  "POST /web/v1/ai/video-process-session/update-edit":
    "范围外：同上 —— 编辑状态挂在任务结果上，不挂在会话上",
};

for (const tool of AI_GENERIC_TOOLS) {
  DEVIATIONS[shapeOf(`POST /web/v1/ai/${tool}`)] = {
    ours: "POST /generations",
    reason: "ADR-003：竞品一工具一条路由，我方收敛成一条生成端点（body 的 capability + mode 决定能力；目录见 GET /generations/tools）",
  };
}
for (const [shape, ours, reason] of AI_MODULE_PAIRS) {
  DEVIATIONS[shapeOf(shape)] = { ours, reason };
}
for (const [shape, reason] of Object.entries(AI_WAIVED)) {
  WAIVED[shapeOf(shape)] = reason;
}

/**
 * 第 93 批落地的 8 条音色库形状（#6 工具箱最后一块 B 类支撑面）。
 *
 * 为什么它们长在 `/ai/` 下而不是走 `POST /generations`：生成端点的语义是「投一个任务」，
 * 而这 8 条操作的是**用户自己的音色资产**（列表 / 详情 / 改名 / 删除 / 收藏 / 目录）。
 * 把「改名」表达成「投一个改名任务」是荒谬的，把「删除」表达成任务更是无处落库。
 *
 * 这 8 条全部是**同形**（不是偏离）：竞品的形状恰好就是「资产增删改查」的通用形状，
 * 我方直接照形状实现，比另造一套路径更省沟通成本。
 */
const AI_IMPLEMENTED = [
  "GET /web/v1/ai/text-to-speech/voice/list",
  "GET /web/v1/ai/voice-clone-list",
  "GET /web/v1/ai/voice-clone/{task_id}",
  "DELETE /web/v1/ai/voice-clone/{task_id}",
  "POST /web/v1/ai/voice-clone/rename",
  "GET /web/v1/ai/timbre-category/list",
  "GET /web/v1/ai/timbre/list",
  "POST /web/v1/ai/timbre/collect",
];

// ── #11 无限画布（第 87 批）────────────────────────────────────────────
// 竞品 `/web/v1/df/canvas/*` 共 114 个 METHOD+path（另有 film 绑定、kds 积分两条在各自组里）。
// 逐条对完的结构是：10 条同形（film 的画布绑定）、100 条结构性偏离、
// 4 条能力缺口（clip / crop / group-recover / tpls 元素批量建）。台账据此把 #11 的剩余
// 从 0.20（E 类「无响应体证据」）改成 0.10（B 类四条小能力），分数 99% → 99.5%。
const CANVAS_SHAPES = [
  "DELETE /df/canvas/agent-skills/{}",
  "DELETE /df/canvas/agent-skills/{}/favorite",
  "DELETE /df/canvas/templates/personal/{}",
  "DELETE /df/canvas/{}/chat/sessions/{}",
  "DELETE /df/canvas/{}/comment-nodes/{}",
  "DELETE /df/canvas/{}/comment-nodes/{}/comments/{}",
  "DELETE /df/canvas/{}/edges/{}",
  "DELETE /df/canvas/{}/groups/{}",
  "DELETE /df/canvas/{}/nodes/{}",
  "DELETE /df/canvas/{}/pin-groups/members",
  "DELETE /df/canvas/{}/pin-groups/{}/members",
  "DELETE /df/canvas/{}/pinned-node",
  "DELETE /df/canvas/{}/pinned-timelines",
  "DELETE /df/canvas/{}/pinned-timelines/{}",
  "DELETE /film/projects/{}/canvases/{}",
  "DELETE /film/projects/{}/task-tables/{}/tasks/{}/canvas-bindings",
  "GET /df/anu/canvas/{}/canvas-info",
  "GET /df/canvas-tpls",
  "GET /df/canvas-tpls/{}",
  "GET /df/canvas/agent-recommend-cards",
  "GET /df/canvas/agent-skills/details",
  "GET /df/canvas/agent-skills/favorites",
  "GET /df/canvas/agent-skills/mine",
  "GET /df/canvas/agent-skills/plaza",
  "GET /df/canvas/node/batch-download/list",
  "GET /df/canvas/templates/personal",
  "GET /df/canvas/templates/{}",
  "GET /df/canvas/{}",
  "GET /df/canvas/{}/chat/sessions",
  "GET /df/canvas/{}/chat/sessions/{}/messages",
  "GET /df/canvas/{}/chat/sessions/{}/stream",
  "GET /df/canvas/{}/chat/writing-outputs",
  "GET /df/canvas/{}/comment-nodes",
  "GET /df/canvas/{}/comment-nodes/{}",
  "GET /df/canvas/{}/groups/{}/templates",
  "GET /df/canvas/{}/materials",
  "GET /df/canvas/{}/nodes-asset",
  "GET /df/canvas/{}/nodes/{}",
  "GET /df/canvas/{}/nodes/{}/lock",
  "GET /df/canvas/{}/nodes/{}/video-parse/{}",
  "GET /df/canvas/{}/pin-groups",
  "GET /df/canvas/{}/pinned-node",
  "GET /df/canvas/{}/pinned-timelines",
  "GET /film/projects/{}/canvases/visible",
  "GET /film/projects/{}/canvases/{}/task-bindings",
  "GET /film/projects/{}/canvases/{}/task-panel",
  "GET /film/projects/{}/task-tables/{}/tasks/{}/canvas-bindings",
  "PATCH /df/canvas/{}/chat/sessions/{}",
  "POST /df/anu/canvas/{}/batch-download",
  "POST /df/anu/canvas/{}/batch-file-thumb",
  "POST /df/anu/canvas/{}/batch-nodes-details",
  "POST /df/canvas",
  "POST /df/canvas/agent-skills",
  "POST /df/canvas/agent-skills/{}/favorite",
  "POST /df/canvas/batch-nodes",
  "POST /df/canvas/groups",
  "POST /df/canvas/node/batch-download",
  "POST /df/canvas/node/batch-download/url",
  "POST /df/canvas/nodes",
  "POST /df/canvas/templates/{}/sync-team",
  "POST /df/canvas/{}/batch-del-edges",
  "POST /df/canvas/{}/batch-del-nodes",
  "POST /df/canvas/{}/batch-edges",
  "POST /df/canvas/{}/batch-edit-nodes",
  "POST /df/canvas/{}/batch-node-tasks",
  "POST /df/canvas/{}/chat/sessions",
  "POST /df/canvas/{}/chat/sessions/{}/messages",
  "POST /df/canvas/{}/chat/sessions/{}/messages/{}/node-binding",
  "POST /df/canvas/{}/chat/sessions/{}/messages/{}/reaction",
  "POST /df/canvas/{}/chat/sessions/{}/read",
  "POST /df/canvas/{}/chat/sessions/{}/tasks/{}/cancel",
  "POST /df/canvas/{}/chat/sessions/{}/tasks/{}/feedback",
  "POST /df/canvas/{}/chat/sessions/{}/tasks/{}/interrupt",
  "POST /df/canvas/{}/clip",
  "POST /df/canvas/{}/comment-nodes",
  "POST /df/canvas/{}/comment-nodes/{}/comments",
  "POST /df/canvas/{}/comment-nodes/{}/resolve",
  "POST /df/canvas/{}/crop",
  "POST /df/canvas/{}/edges",
  "POST /df/canvas/{}/group-recover",
  "POST /df/canvas/{}/groups/{}/templates",
  "POST /df/canvas/{}/heartbeat",
  "POST /df/canvas/{}/materials",
  "POST /df/canvas/{}/materials/batch-delete",
  "POST /df/canvas/{}/nodes-recover",
  "POST /df/canvas/{}/nodes/{}/asset-extraction",
  "POST /df/canvas/{}/nodes/{}/lock",
  "POST /df/canvas/{}/nodes/{}/renew",
  "POST /df/canvas/{}/nodes/{}/script-optimization",
  "POST /df/canvas/{}/nodes/{}/storyboard-asset-match",
  "POST /df/canvas/{}/nodes/{}/storyboard-asset-match/cancel",
  "POST /df/canvas/{}/nodes/{}/storyboard-asset-rematch",
  "POST /df/canvas/{}/nodes/{}/storyboard-parse",
  "POST /df/canvas/{}/nodes/{}/table/confirm-sheet",
  "POST /df/canvas/{}/nodes/{}/table/import",
  "POST /df/canvas/{}/nodes/{}/unlock",
  "POST /df/canvas/{}/nodes/{}/video-parse",
  "POST /df/canvas/{}/pinned-timelines",
  "POST /df/canvas/{}/tpls",
  "POST /df/canvas/{}/tpls/{}/elements/batch-create",
  "POST /df/canvas/{}/upload-file",
  "POST /film/projects/{}/canvases/{}/submit-result",
  "POST /film/projects/{}/task-tables/{}/tasks/{}/canvas-bindings",
  "POST /kds/da/canvas/total-point-consume",
  "PUT /df/canvas/agent-skills",
  "PUT /df/canvas/{}",
  "PUT /df/canvas/{}/comment-nodes/{}",
  "PUT /df/canvas/{}/comment-nodes/{}/comments/{}",
  "PUT /df/canvas/{}/groups/{}/templates/{}",
  "PUT /df/canvas/{}/nodes/{}",
  "PUT /df/canvas/{}/nodes/{}/pin-groups",
  "PUT /df/canvas/{}/pin-groups/{}",
  "PUT /df/canvas/{}/pinned-node",
  "PUT /film/projects/{}/task-tables/{}/tasks/{}/canvas-bindings",
];

const CANVAS_PAIRS: Array<[shape: string, ours: string, reason: string]> = [
  ["DELETE /df/canvas/agent-skills/{}", "DELETE /agent-skills/{}", "Skill 卡市场在我方 /agent-skills*（第 64 批已按竞品 9 条形状逐条对过）"],
  ["DELETE /df/canvas/agent-skills/{}/favorite", "POST /agent-skills/{}/favorite", "Skill 卡市场在我方 /agent-skills*（第 64 批已按竞品 9 条形状逐条对过）"],
  ["DELETE /df/canvas/templates/personal/{}", "DELETE /canvas/templates/personal/{}", "整画布模板库在我方 /canvas/templates*（tpl_scope / tpl_type 表达官方·团队·个人）"],
  ["DELETE /df/canvas/{}/chat/sessions/{}", "DELETE /canvas/canvases/{}/chat/sessions/{}", "会话辅助操作在我方是 /canvas/chat/*（会话 id 全局唯一，不再重复带 canvas_id）"],
  ["DELETE /df/canvas/{}/comment-nodes/{}", "DELETE /canvas/canvases/{}/comment-nodes/{}", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["DELETE /df/canvas/{}/comment-nodes/{}/comments/{}", "DELETE /canvas/canvases/{}/comment-nodes/{}/comments/{}", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["DELETE /df/canvas/{}/edges/{}", "DELETE /canvas/canvases/{}/edges/{}", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["DELETE /df/canvas/{}/groups/{}", "DELETE /canvas/canvases/{}/groups/{}", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["DELETE /df/canvas/{}/nodes/{}", "DELETE /canvas/canvases/{}/nodes/{}", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["DELETE /df/canvas/{}/pin-groups/members", "DELETE /canvas/canvases/{}/pin-groups/{}/members", "固定组一律按「槽位」寻址（/pin-groups/:slot），竞品按 group_id 或裸 members 寻址"],
  ["DELETE /df/canvas/{}/pin-groups/{}/members", "DELETE /canvas/canvases/{}/pin-groups/{}/members", "固定组一律按「槽位」寻址（/pin-groups/:slot），竞品按 group_id 或裸 members 寻址"],
  ["DELETE /df/canvas/{}/pinned-node", "DELETE /canvas/canvases/{}/pinned-node", "画布详情（GET /canvas/canvases/:id）里带 pinned_node_id，不需要单独的查询路由"],
  ["DELETE /df/canvas/{}/pinned-timelines", "DELETE /canvas/canvases/{}/pin-groups/{}", "竞品的 pinned-timelines 就是我们的 pin-groups：7 个槽位、成员整体替换、与 canvas_nodes.group_ids 同事务双写"],
  ["DELETE /df/canvas/{}/pinned-timelines/{}", "PUT /canvas/canvases/{}/nodes/{}/pin-groups", "竞品的 pinned-timelines 就是我们的 pin-groups：7 个槽位、成员整体替换、与 canvas_nodes.group_ids 同事务双写"],
  ["GET /df/anu/canvas/{}/canvas-info", "GET /canvas/canvases/{}", "竞品 anu 前缀是它 Agent 新 UI 的辅助端点，对应能力在我方 canvas 既有端点里"],
  ["GET /df/canvas-tpls", "GET /canvas/templates", "整画布模板库在我方 /canvas/templates*（tpl_scope / tpl_type 表达官方·团队·个人）"],
  ["GET /df/canvas-tpls/{}", "GET /canvas/templates/{}", "整画布模板库在我方 /canvas/templates*（tpl_scope / tpl_type 表达官方·团队·个人）"],
  ["GET /df/canvas/agent-recommend-cards", "GET /agent-recommend-cards", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["GET /df/canvas/agent-skills/details", "GET /agent-skills/details", "Skill 卡市场在我方 /agent-skills*（第 64 批已按竞品 9 条形状逐条对过）"],
  ["GET /df/canvas/agent-skills/favorites", "GET /agent-skills/favorites", "Skill 卡市场在我方 /agent-skills*（第 64 批已按竞品 9 条形状逐条对过）"],
  ["GET /df/canvas/agent-skills/mine", "GET /agent-skills/mine", "Skill 卡市场在我方 /agent-skills*（第 64 批已按竞品 9 条形状逐条对过）"],
  ["GET /df/canvas/agent-skills/plaza", "GET /agent-skills/plaza", "Skill 卡市场在我方 /agent-skills*（第 64 批已按竞品 9 条形状逐条对过）"],
  ["GET /df/canvas/node/batch-download/list", "GET /canvas/canvases/{}/download-lists", "批量操作命名不同（竞品 batch-del-nodes ↔ 我方 nodes/batch-delete 等），行为一致"],
  ["GET /df/canvas/templates/personal", "GET /canvas/templates/personal", "整画布模板库在我方 /canvas/templates*（tpl_scope / tpl_type 表达官方·团队·个人）"],
  ["GET /df/canvas/templates/{}", "GET /canvas/templates/{}", "整画布模板库在我方 /canvas/templates*（tpl_scope / tpl_type 表达官方·团队·个人）"],
  ["GET /df/canvas/{}", "GET /canvas/canvases/{}", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["GET /df/canvas/{}/chat/sessions", "GET /canvas/canvases/{}/chat/sessions", "会话辅助操作在我方是 /canvas/chat/*（会话 id 全局唯一，不再重复带 canvas_id）"],
  ["GET /df/canvas/{}/chat/sessions/{}/messages", "GET /canvas/canvases/{}/chat/sessions/{}/messages", "会话辅助操作在我方是 /canvas/chat/*（会话 id 全局唯一，不再重复带 canvas_id）"],
  ["GET /df/canvas/{}/chat/sessions/{}/stream", "GET /canvas/chat/sessions/{}/stream", "会话辅助操作在我方是 /canvas/chat/*（会话 id 全局唯一，不再重复带 canvas_id）"],
  ["GET /df/canvas/{}/chat/writing-outputs", "GET /canvas/canvases/{}/chat/writing-outputs", "会话辅助操作在我方是 /canvas/chat/*（会话 id 全局唯一，不再重复带 canvas_id）"],
  ["GET /df/canvas/{}/comment-nodes", "GET /canvas/canvases/{}/comment-nodes", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["GET /df/canvas/{}/comment-nodes/{}", "GET /canvas/canvases/{}/comment-nodes/{}", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["GET /df/canvas/{}/groups/{}/templates", "GET /canvas/canvases/{}/group-templates", "组模板在我方是画布级的 /group-templates（可按 group_id 过滤），竞品嵌在 /groups/:group_id/templates 下"],
  ["GET /df/canvas/{}/materials", "GET /canvas/canvases/{}/materials", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["GET /df/canvas/{}/nodes-asset", "GET /canvas/canvases/{}/nodes", "资产面板 = GET nodes?node_type=image（同一份节点列表按类型过滤）"],
  ["GET /df/canvas/{}/nodes/{}", "GET /canvas/canvases/{}/nodes/{}", "上一批（第 87 批）按竞品形状补的别名：GET nodes/:node_id、GET nodes/:node_id/lock、DELETE pinned-node"],
  ["GET /df/canvas/{}/nodes/{}/lock", "GET /canvas/canvases/{}/nodes/{}/lock", "上一批（第 87 批）按竞品形状补的别名：GET nodes/:node_id、GET nodes/:node_id/lock、DELETE pinned-node"],
  ["GET /df/canvas/{}/nodes/{}/video-parse/{}", "GET /canvas/canvases/{}/nodes/{}/video-parse/{}", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["GET /df/canvas/{}/pin-groups", "GET /canvas/canvases/{}/pin-groups", "固定组一律按「槽位」寻址（/pin-groups/:slot），竞品按 group_id 或裸 members 寻址"],
  ["GET /df/canvas/{}/pinned-node", "GET /canvas/canvases/{}", "画布详情（GET /canvas/canvases/:id）里带 pinned_node_id，不需要单独的查询路由"],
  ["GET /df/canvas/{}/pinned-timelines", "GET /canvas/canvases/{}/pin-groups", "竞品的 pinned-timelines 就是我们的 pin-groups：7 个槽位、成员整体替换、与 canvas_nodes.group_ids 同事务双写"],
  ["PATCH /df/canvas/{}/chat/sessions/{}", "PATCH /canvas/canvases/{}/chat/sessions/{}", "会话辅助操作在我方是 /canvas/chat/*（会话 id 全局唯一，不再重复带 canvas_id）"],
  ["POST /df/anu/canvas/{}/batch-download", "POST /canvas/canvases/{}/nodes/batch-download", "竞品 anu 前缀是它 Agent 新 UI 的辅助端点，对应能力在我方 canvas 既有端点里"],
  ["POST /df/anu/canvas/{}/batch-file-thumb", "GET /canvas/canvases/{}/nodes", "竞品 anu 前缀是它 Agent 新 UI 的辅助端点，对应能力在我方 canvas 既有端点里"],
  ["POST /df/anu/canvas/{}/batch-nodes-details", "GET /canvas/canvases/{}/nodes", "竞品 anu 前缀是它 Agent 新 UI 的辅助端点，对应能力在我方 canvas 既有端点里"],
  ["POST /df/canvas", "POST /canvas/canvases", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/agent-skills", "POST /agent-skills", "Skill 卡市场在我方 /agent-skills*（第 64 批已按竞品 9 条形状逐条对过）"],
  ["POST /df/canvas/agent-skills/{}/favorite", "POST /agent-skills/{}/favorite", "Skill 卡市场在我方 /agent-skills*（第 64 批已按竞品 9 条形状逐条对过）"],
  ["POST /df/canvas/batch-nodes", "POST /canvas/canvases/{}/nodes/batch", "批量操作命名不同（竞品 batch-del-nodes ↔ 我方 nodes/batch-delete 等），行为一致"],
  ["POST /df/canvas/groups", "POST /canvas/canvases/{}/groups", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/node/batch-download", "POST /canvas/canvases/{}/nodes/batch-download", "批量操作命名不同（竞品 batch-del-nodes ↔ 我方 nodes/batch-delete 等），行为一致"],
  ["POST /df/canvas/node/batch-download/url", "POST /canvas/canvases/{}/download-lists/{}/url", "批量操作命名不同（竞品 batch-del-nodes ↔ 我方 nodes/batch-delete 等），行为一致"],
  ["POST /df/canvas/nodes", "POST /canvas/canvases/{}/nodes", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/templates/{}/sync-team", "POST /canvas/templates/{}/sync-team", "整画布模板库在我方 /canvas/templates*（tpl_scope / tpl_type 表达官方·团队·个人）"],
  ["POST /df/canvas/{}/batch-del-edges", "POST /canvas/canvases/{}/edges/batch-delete", "批量操作命名不同（竞品 batch-del-nodes ↔ 我方 nodes/batch-delete 等），行为一致"],
  ["POST /df/canvas/{}/batch-del-nodes", "POST /canvas/canvases/{}/nodes/batch-delete", "批量操作命名不同（竞品 batch-del-nodes ↔ 我方 nodes/batch-delete 等），行为一致"],
  ["POST /df/canvas/{}/batch-edges", "POST /canvas/canvases/{}/edges/batch", "批量操作命名不同（竞品 batch-del-nodes ↔ 我方 nodes/batch-delete 等），行为一致"],
  ["POST /df/canvas/{}/batch-edit-nodes", "POST /canvas/canvases/{}/nodes/batch-edit", "批量操作命名不同（竞品 batch-del-nodes ↔ 我方 nodes/batch-delete 等），行为一致"],
  ["POST /df/canvas/{}/batch-node-tasks", "POST /canvas/canvases/{}/batch-node-tasks", "批量操作命名不同（竞品 batch-del-nodes ↔ 我方 nodes/batch-delete 等），行为一致"],
  ["POST /df/canvas/{}/chat/sessions", "POST /canvas/canvases/{}/chat/sessions", "会话辅助操作在我方是 /canvas/chat/*（会话 id 全局唯一，不再重复带 canvas_id）"],
  ["POST /df/canvas/{}/chat/sessions/{}/messages", "POST /canvas/canvases/{}/chat/sessions/{}/messages", "会话辅助操作在我方是 /canvas/chat/*（会话 id 全局唯一，不再重复带 canvas_id）"],
  ["POST /df/canvas/{}/chat/sessions/{}/messages/{}/node-binding", "POST /canvas/chat/sessions/{}/messages/{}/node-binding", "会话辅助操作在我方是 /canvas/chat/*（会话 id 全局唯一，不再重复带 canvas_id）"],
  ["POST /df/canvas/{}/chat/sessions/{}/messages/{}/reaction", "POST /canvas/chat/sessions/{}/messages/{}/reaction", "会话辅助操作在我方是 /canvas/chat/*（会话 id 全局唯一，不再重复带 canvas_id）"],
  ["POST /df/canvas/{}/chat/sessions/{}/read", "POST /canvas/chat/sessions/{}/read", "会话辅助操作在我方是 /canvas/chat/*（会话 id 全局唯一，不再重复带 canvas_id）"],
  ["POST /df/canvas/{}/chat/sessions/{}/tasks/{}/cancel", "POST /tasks/{}/cancel", "画布会话里的任务操作复用任务域的 /tasks/:id/{cancel,feedback}（同一个 task 行，不另造一套）"],
  ["POST /df/canvas/{}/chat/sessions/{}/tasks/{}/feedback", "POST /tasks/{}/feedback", "画布会话里的任务操作复用任务域的 /tasks/:id/{cancel,feedback}（同一个 task 行，不另造一套）"],
  ["POST /df/canvas/{}/chat/sessions/{}/tasks/{}/interrupt", "POST /tasks/{}/cancel", "画布会话里的任务操作复用任务域的 /tasks/:id/{cancel,feedback}（同一个 task 行，不另造一套）"],
  ["POST /df/canvas/{}/comment-nodes", "POST /canvas/canvases/{}/comment-nodes", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/comment-nodes/{}/comments", "POST /canvas/canvases/{}/comment-nodes/{}/comments", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/comment-nodes/{}/resolve", "POST /canvas/canvases/{}/comment-nodes/{}/resolve", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/edges", "POST /canvas/canvases/{}/edges", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/groups/{}/templates", "POST /canvas/canvases/{}/groups/{}/templates", "组模板在我方是画布级的 /group-templates（可按 group_id 过滤），竞品嵌在 /groups/:group_id/templates 下"],
  ["POST /df/canvas/{}/heartbeat", "POST /canvas/canvases/{}/heartbeat", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/materials", "POST /canvas/canvases/{}/materials", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/materials/batch-delete", "POST /canvas/canvases/{}/materials/batch-delete", "批量操作命名不同（竞品 batch-del-nodes ↔ 我方 nodes/batch-delete 等），行为一致"],
  ["POST /df/canvas/{}/nodes-recover", "POST /canvas/canvases/{}/nodes-recover", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/nodes/{}/asset-extraction", "POST /canvas/canvases/{}/nodes/{}/asset-extraction", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/nodes/{}/lock", "POST /canvas/canvases/{}/nodes/{}/lock", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/nodes/{}/renew", "POST /canvas/canvases/{}/nodes/{}/renew", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/nodes/{}/script-optimization", "POST /canvas/canvases/{}/nodes/{}/script-optimization", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/nodes/{}/storyboard-asset-match", "POST /canvas/canvases/{}/nodes/{}/storyboard-asset-match", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/nodes/{}/storyboard-asset-match/cancel", "POST /canvas/canvases/{}/nodes/{}/storyboard-asset-match/cancel", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/nodes/{}/storyboard-asset-rematch", "POST /canvas/canvases/{}/nodes/{}/storyboard-asset-rematch", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/nodes/{}/storyboard-parse", "POST /canvas/canvases/{}/nodes/{}/storyboard-parse", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/nodes/{}/table/confirm-sheet", "POST /canvas/canvases/{}/nodes/{}/table/confirm-sheet", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/nodes/{}/table/import", "POST /canvas/canvases/{}/nodes/{}/table/import", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/nodes/{}/unlock", "POST /canvas/canvases/{}/nodes/{}/unlock", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/nodes/{}/video-parse", "POST /canvas/canvases/{}/nodes/{}/video-parse", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/pinned-timelines", "PUT /canvas/canvases/{}/pin-groups/{}", "竞品的 pinned-timelines 就是我们的 pin-groups：7 个槽位、成员整体替换、与 canvas_nodes.group_ids 同事务双写"],
  ["POST /df/canvas/{}/tpls", "POST /canvas/canvases/{}/tpls", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["POST /df/canvas/{}/upload-file", "POST /canvas/canvases/{}/upload-file", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["PUT /df/canvas/agent-skills", "PUT /agent-skills", "Skill 卡市场在我方 /agent-skills*（第 64 批已按竞品 9 条形状逐条对过）"],
  ["PUT /df/canvas/{}", "PATCH /canvas/canvases/{}", "更新一律用 PATCH（部分更新），竞品用 PUT"],
  ["PUT /df/canvas/{}/comment-nodes/{}", "PUT /canvas/canvases/{}/comment-nodes/{}", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["PUT /df/canvas/{}/comment-nodes/{}/comments/{}", "PUT /canvas/canvases/{}/comment-nodes/{}/comments/{}", "竞品把 canvas id 直接接在 /df/canvas/:canvas_id 后面，我方统一在 /canvas/canvases/:canvas_id（ADR-009 已登记的前缀偏离，尾段同构）"],
  ["PUT /df/canvas/{}/groups/{}/templates/{}", "PUT /canvas/canvases/{}/group-templates/{}", "组模板在我方是画布级的 /group-templates（可按 group_id 过滤），竞品嵌在 /groups/:group_id/templates 下"],
  ["PUT /df/canvas/{}/nodes/{}", "PATCH /canvas/canvases/{}/nodes/{}", "更新一律用 PATCH（部分更新），竞品用 PUT"],
  ["PUT /df/canvas/{}/nodes/{}/pin-groups", "PUT /canvas/canvases/{}/nodes/{}/pin-groups", "固定组一律按「槽位」寻址（/pin-groups/:slot），竞品按 group_id 或裸 members 寻址"],
  ["PUT /df/canvas/{}/pin-groups/{}", "PUT /canvas/canvases/{}/pin-groups/{}", "固定组一律按「槽位」寻址（/pin-groups/:slot），竞品按 group_id 或裸 members 寻址"],
  ["PUT /df/canvas/{}/pinned-node", "PUT /canvas/canvases/{}/pinned-node", "画布详情（GET /canvas/canvases/:id）里带 pinned_node_id，不需要单独的查询路由"],
];

// 4 条真正缺失的能力：都不硬造接口（造假接口比缺接口更坏），但要逐条记账。
const CANVAS_WAIVED: Record<string, string> = {
  "POST /df/canvas/{}/clip": "B 类：画布内「切一段视频」是编辑动作，我方由 generation 的 video_slicing 工具承接，画布上没有独立剪辑模型",
  "POST /df/canvas/{}/crop": "B 类：画布内裁剪同理，我方没有 image/video crop 的独立模型（只有工具侧的重绘/扩图）",
  "POST /df/canvas/{}/group-recover": "B 类：分组是硬删（canvas_groups 有 status 列但删除走 db.delete），没有回收站语义；硬造 recover 只会返回永远空的结果",
  "POST /df/canvas/{}/tpls/{}/elements/batch-create": "B 类：整画布模板的元素存在 canvas_templates.payload(jsonb) 里，没有元素表可批量插；竞品这条两个 schema 都是 {}",
};

for (const [shape, ours, reason] of CANVAS_PAIRS) {
  DEVIATIONS[shapeOf(shape)] = { ours, reason };
}
for (const [shape, reason] of Object.entries(CANVAS_WAIVED)) {
  WAIVED[shapeOf(shape)] = reason;
}

// ── #17 资产/主体（第 88 批）──────────────────────────────────────────────
// 竞品面 = `/asset/*` 28 条 + `/subject/*` 8 条 = 36 条（`_acceptance/competitor_endpoints.tsv`）。
// 我方一条 `/asset/*`、`/subject/*` 都没有：素材在 `/assets`，主体在 `/subjects`，
// 提示词库做成 Agent Skill 卡，工作流 = 画布模板 + 画布节点任务。所以这里全是「结构性偏离」，
// 只有 2 条 vidu 供应商主体注册属外部输入。
const ASSET_SHAPES = [
  "POST /asset/resource",
  "POST /asset/resource/list",
  "POST /asset/resource/delete",
  "PUT /asset/resource/{}",
  "POST /asset/resource/vidu-subjects/add",
  "GET /asset/resource/{}/{}",
  "GET /asset/resource/vidu-subjects/{}",
  "POST /asset/prompts",
  "POST /asset/prompts/list",
  "POST /asset/prompts/delete",
  "PUT /asset/prompts/{}",
  "POST /asset/actor",
  "POST /asset/actor/list",
  "POST /asset/actor/delete",
  "PUT /asset/actor/{}",
  "GET /asset/workflows",
  "POST /asset/workflows",
  "POST /asset/workflows/rename-check",
  "GET /asset/workflows/{}",
  "PUT /asset/workflows/{}",
  "DELETE /asset/workflows/{}",
  "POST /asset/workflows/{}/copy",
  "POST /asset/workflows/{}/runs",
  "GET /asset/workflows/{}/runs",
  "POST /asset/workflows/{}/nodes/{}/runs",
  "GET /asset/workflows/{}/runs/{}",
  "GET /asset/workflows/{}/runs/{}/nodes/{}/output",
  "POST /asset/workflows/node-point-calc",
  "POST /subject/resource",
  "PUT /subject/resource/{}",
  "POST /subject/resource/list",
  "POST /subject/resource/delete",
  "GET /subject/resource/{}",
  "POST /subject/resource/batch",
  "POST /subject/resource/update",
  "POST /subject/resource/batch-details",
];

const ASSET_PAIRS: Array<[shape: string, ours: string, reason: string]> = [
  ["POST /asset/resource", "POST /assets/upload", "竞品把素材放在 /asset/resource，我方在 /assets（ADR-009 已登记的前缀偏离）；竞品的 `category` 只是前端分栏，我方用 kind + 文件夹表达，不额外造一个假路径参数"],
  ["POST /asset/resource/list", "GET /assets", "竞品把素材放在 /asset/resource，我方在 /assets（ADR-009 已登记的前缀偏离）；竞品的 `category` 只是前端分栏，我方用 kind + 文件夹表达，不额外造一个假路径参数"],
  ["POST /asset/resource/delete", "DELETE /assets/{}", "竞品把素材放在 /asset/resource，我方在 /assets（ADR-009 已登记的前缀偏离）；竞品的 `category` 只是前端分栏，我方用 kind + 文件夹表达，不额外造一个假路径参数"],
  ["PUT /asset/resource/{}", "PATCH /assets/{}", "竞品把素材放在 /asset/resource，我方在 /assets（ADR-009 已登记的前缀偏离）；竞品的 `category` 只是前端分栏，我方用 kind + 文件夹表达，不额外造一个假路径参数"],
  ["GET /asset/resource/{}/{}", "GET /assets/{}", "竞品把素材放在 /asset/resource，我方在 /assets（ADR-009 已登记的前缀偏离）；竞品的 `category` 只是前端分栏，我方用 kind + 文件夹表达，不额外造一个假路径参数"],
  ["POST /asset/prompts", "POST /agent-skills", "竞品的「提示词库」是纯 title+content 的 CRUD；我方把它做成可带参数、可分享、可收藏的 Agent Skill 卡（agent_skills.prompt_template + config），四个形状都落在 /agent-skills 上"],
  ["POST /asset/prompts/list", "GET /agent-skills", "竞品的「提示词库」是纯 title+content 的 CRUD；我方把它做成可带参数、可分享、可收藏的 Agent Skill 卡（agent_skills.prompt_template + config），四个形状都落在 /agent-skills 上"],
  ["POST /asset/prompts/delete", "DELETE /agent-skills/{}", "竞品的「提示词库」是纯 title+content 的 CRUD；我方把它做成可带参数、可分享、可收藏的 Agent Skill 卡（agent_skills.prompt_template + config），四个形状都落在 /agent-skills 上"],
  ["PUT /asset/prompts/{}", "PUT /agent-skills", "竞品的「提示词库」是纯 title+content 的 CRUD；我方把它做成可带参数、可分享、可收藏的 Agent Skill 卡（agent_skills.prompt_template + config），四个形状都落在 /agent-skills 上"],
  ["POST /asset/actor", "POST /subjects", "竞品把「演员」单独做成 /asset/actor，我方与主体库合流：/subjects 的 kind=character 就是演员，files 里带角色参考图；两套 ID 不混用这一条在 subjects.controller.ts 头注释里已写明"],
  ["POST /asset/actor/list", "GET /subjects", "竞品把「演员」单独做成 /asset/actor，我方与主体库合流：/subjects 的 kind=character 就是演员，files 里带角色参考图；两套 ID 不混用这一条在 subjects.controller.ts 头注释里已写明"],
  ["POST /asset/actor/delete", "DELETE /subjects/{}", "竞品把「演员」单独做成 /asset/actor，我方与主体库合流：/subjects 的 kind=character 就是演员，files 里带角色参考图；两套 ID 不混用这一条在 subjects.controller.ts 头注释里已写明"],
  ["PUT /asset/actor/{}", "PATCH /subjects/{}", "竞品把「演员」单独做成 /asset/actor，我方与主体库合流：/subjects 的 kind=character 就是演员，files 里带角色参考图；两套 ID 不混用这一条在 subjects.controller.ts 头注释里已写明"],
  ["GET /asset/workflows", "GET /canvas/templates", "我方没有独立的「工作流资产」表：工作流 = 画布模板（/canvas/templates 快照）+ 画布节点任务（/canvas/canvases/:id/nodes/:node_id/generate 等就是一次节点运行，输出在任务结果里）"],
  ["POST /asset/workflows", "POST /canvas/canvases/{}/tpls", "我方没有独立的「工作流资产」表：工作流 = 画布模板（/canvas/templates 快照）+ 画布节点任务（/canvas/canvases/:id/nodes/:node_id/generate 等就是一次节点运行，输出在任务结果里）"],
  ["POST /asset/workflows/rename-check", "GET /canvas/templates", "我方没有独立的「工作流资产」表：工作流 = 画布模板（/canvas/templates 快照）+ 画布节点任务（/canvas/canvases/:id/nodes/:node_id/generate 等就是一次节点运行，输出在任务结果里）"],
  ["GET /asset/workflows/{}", "GET /canvas/templates/{}", "我方没有独立的「工作流资产」表：工作流 = 画布模板（/canvas/templates 快照）+ 画布节点任务（/canvas/canvases/:id/nodes/:node_id/generate 等就是一次节点运行，输出在任务结果里）"],
  ["PUT /asset/workflows/{}", "POST /canvas/canvases/{}/tpls", "我方没有独立的「工作流资产」表：工作流 = 画布模板（/canvas/templates 快照）+ 画布节点任务（/canvas/canvases/:id/nodes/:node_id/generate 等就是一次节点运行，输出在任务结果里）"],
  ["DELETE /asset/workflows/{}", "DELETE /canvas/templates/personal/{}", "我方没有独立的「工作流资产」表：工作流 = 画布模板（/canvas/templates 快照）+ 画布节点任务（/canvas/canvases/:id/nodes/:node_id/generate 等就是一次节点运行，输出在任务结果里）"],
  ["POST /asset/workflows/{}/copy", "GET /canvas/templates/{}/instantiate", "我方没有独立的「工作流资产」表：工作流 = 画布模板（/canvas/templates 快照）+ 画布节点任务（/canvas/canvases/:id/nodes/:node_id/generate 等就是一次节点运行，输出在任务结果里）"],
  ["POST /asset/workflows/{}/runs", "POST /canvas/canvases/{}/batch-node-tasks", "我方没有独立的「工作流资产」表：工作流 = 画布模板（/canvas/templates 快照）+ 画布节点任务（/canvas/canvases/:id/nodes/:node_id/generate 等就是一次节点运行，输出在任务结果里）"],
  ["GET /asset/workflows/{}/runs", "GET /canvas/canvases/{}/running-nodes", "我方没有独立的「工作流资产」表：工作流 = 画布模板（/canvas/templates 快照）+ 画布节点任务（/canvas/canvases/:id/nodes/:node_id/generate 等就是一次节点运行，输出在任务结果里）"],
  ["POST /asset/workflows/{}/nodes/{}/runs", "POST /canvas/canvases/{}/nodes/{}/generate", "我方没有独立的「工作流资产」表：工作流 = 画布模板（/canvas/templates 快照）+ 画布节点任务（/canvas/canvases/:id/nodes/:node_id/generate 等就是一次节点运行，输出在任务结果里）"],
  ["GET /asset/workflows/{}/runs/{}", "GET /canvas/canvases/{}/nodes/{}/task/{}", "我方没有独立的「工作流资产」表：工作流 = 画布模板（/canvas/templates 快照）+ 画布节点任务（/canvas/canvases/:id/nodes/:node_id/generate 等就是一次节点运行，输出在任务结果里）"],
  ["GET /asset/workflows/{}/runs/{}/nodes/{}/output", "GET /canvas/canvases/{}/nodes/{}/task/{}", "我方没有独立的「工作流资产」表：工作流 = 画布模板（/canvas/templates 快照）+ 画布节点任务（/canvas/canvases/:id/nodes/:node_id/generate 等就是一次节点运行，输出在任务结果里）"],
  ["POST /asset/workflows/node-point-calc", "POST /credits/quote", "我方没有独立的「工作流资产」表：工作流 = 画布模板（/canvas/templates 快照）+ 画布节点任务（/canvas/canvases/:id/nodes/:node_id/generate 等就是一次节点运行，输出在任务结果里）"],
  ["POST /subject/resource", "POST /subjects", "竞品主体库在 /subject/resource，我方在 /subjects（ADR-009 前缀 + 方法偏离：竞品把 list/delete/update 都做成 POST，我方用 GET/DELETE/PATCH）"],
  ["PUT /subject/resource/{}", "PATCH /subjects/{}", "竞品主体库在 /subject/resource，我方在 /subjects（ADR-009 前缀 + 方法偏离：竞品把 list/delete/update 都做成 POST，我方用 GET/DELETE/PATCH）"],
  ["POST /subject/resource/list", "GET /subjects", "竞品主体库在 /subject/resource，我方在 /subjects（ADR-009 前缀 + 方法偏离：竞品把 list/delete/update 都做成 POST，我方用 GET/DELETE/PATCH）"],
  ["POST /subject/resource/delete", "DELETE /subjects/{}", "竞品主体库在 /subject/resource，我方在 /subjects（ADR-009 前缀 + 方法偏离：竞品把 list/delete/update 都做成 POST，我方用 GET/DELETE/PATCH）"],
  ["GET /subject/resource/{}", "GET /subjects/{}", "竞品主体库在 /subject/resource，我方在 /subjects（ADR-009 前缀 + 方法偏离：竞品把 list/delete/update 都做成 POST，我方用 GET/DELETE/PATCH）"],
  ["POST /subject/resource/update", "PATCH /subjects/{}", "竞品主体库在 /subject/resource，我方在 /subjects（ADR-009 前缀 + 方法偏离：竞品把 list/delete/update 都做成 POST，我方用 GET/DELETE/PATCH）"],
  ["POST /subject/resource/batch", "POST /subjects", "竞品主体库在 /subject/resource，我方在 /subjects（ADR-009 前缀 + 方法偏离：竞品把 list/delete/update 都做成 POST，我方用 GET/DELETE/PATCH）"],
  ["POST /subject/resource/batch-details", "GET /subjects", "竞品主体库在 /subject/resource，我方在 /subjects（ADR-009 前缀 + 方法偏离：竞品把 list/delete/update 都做成 POST，我方用 GET/DELETE/PATCH）"],
];

const ASSET_WAIVED: Record<string, string> = {
  "POST /asset/resource/vidu-subjects/add": "外部：Vidu 主体注册（把本地主体登记到供应商换 business_id），我方适配器全 mock、不产生真 business_id，造这个端点只能返回假 id",
  "GET /asset/resource/vidu-subjects/{}": "外部：同上——按供应商 business_id 反查主体，没有真实供应商就没有可查的对象",
};

for (const [shape, ours, reason] of ASSET_PAIRS) {
  DEVIATIONS[shapeOf(shape)] = { ours, reason };
}
for (const [shape, reason] of Object.entries(ASSET_WAIVED)) {
  WAIVED[shapeOf(shape)] = reason;
}

// #2 小说改编链：竞品 102 条形状全部挂在 `/df/novel/*` 下。
// `/df` 是竞品的域分层（`/df/novel_market` 是剧本广场 #12，不属本组），不是我方的能力差异；
// 我方按 ADR-009 直接是 `/novel/*`。守卫的 normalize() 只剥 `/web/v1`，所以这一组「同形」必然是 0：
// 前缀差异本身就是一条显式偏离（登记在 NOVEL_PAIRS），不是「没对账」。
const NOVEL_SHAPES: string[] = [
  'GET /df/novel/{}/buy/detail',
  'PUT /df/novel/{}/buy/edit',
  'GET /df/novel/{}/buy/characters',
  'PUT /df/novel/{}/buy/characters/{}',
  'GET /df/novel/{}/buy/episodes',
  'PUT /df/novel/{}/buy/chapters/{}',
  'GET /df/novel/{}/buy/content-tree',
  'POST /df/novel/{}',
  'POST /df/novel/{}/summary',
  'POST /df/novel/list',
  'PUT /df/novel/{}/adjust',
  'GET /df/novel/{}',
  'POST /df/novel/{}/delete',
  'GET /df/novel/{}/chapter_outline/list',
  'POST /df/novel/split',
  'GET /df/novel/split/{}',
  'PUT /df/novel/{}/chapter_outline/{}',
  'POST /df/novel/{}/episode_outline/generate',
  'PUT /df/novel/{}/episode_outline/{}',
  'POST /df/novel/{}/core_character/generate',
  'GET /df/novel/{}/core_character/list',
  'PUT /df/novel/{}/core_character/{}',
  'POST /df/novel/{}/episode/generate',
  'GET /df/novel/{}/episode/list',
  'PUT /df/novel/{}/episode/{}',
  'POST /df/novel/{}/finalize',
  'GET /df/novel/{}/download',
  'GET /df/novel/{}/novel_chapters/list',
  'GET /df/novel/{}/point',
  'POST /df/novel/{}/content-analysis',
  'POST /df/novel/{}/script-analysis',
  'POST /df/novel/{}/script-generate',
  'GET /df/novel/{}/content-analysis/detail',
  'PUT /df/novel/{}/content-analysis/worldview',
  'PUT /df/novel/{}/content-analysis/novel_character_cards/{}',
  'PUT /df/novel/{}/script-analysis/novel_storyline/{}',
  'POST /df/novel/original_script/idea',
  'POST /df/novel/{}/original_script/characters',
  'POST /df/novel/{}/original_script/materials',
  'POST /df/novel/{}/original_script/summary_outline',
  'POST /df/novel/{}/original_script/chapters_outline',
  'POST /df/novel/{}/original_script/episodes_outline',
  'POST /df/novel/{}/original_script/episodes',
  'GET /df/novel/{}/original_script/idea',
  'GET /df/novel/{}/original_script/idea/{}',
  'PUT /df/novel/{}/original_script/idea/{}',
  'POST /df/novel/{}/original_script/idea/select-op',
  'GET /df/novel/{}/original_script/characters',
  'GET /df/novel/{}/original_script/characters/{}',
  'PUT /df/novel/{}/original_script/characters/{}',
  'POST /df/novel/{}/original_script/characters/{}/delete',
  'POST /df/novel/{}/original_script/characters/add',
  'GET /df/novel/{}/original_script/materials',
  'POST /df/novel/{}/original_script/materials/select-op',
  'GET /df/novel/{}/original_script/materials/{}',
  'PUT /df/novel/{}/original_script/materials/{}',
  'POST /df/novel/{}/original_script/materials/generate',
  'GET /df/novel/{}/original_script/summary_outline',
  'PUT /df/novel/{}/original_script/summary_outline',
  'GET /df/novel/{}/original_script/chapters_outline',
  'PUT /df/novel/{}/original_script/chapters_outline/{}',
  'PUT /df/novel/{}/original_script/episodes_outline/{}',
  'GET /df/novel/member-groups',
  'POST /df/novel/{}/group',
  'GET /df/novel/{}/permission',
  'GET /df/novel/distribute/list',
  'POST /df/novel/{}/permission',
  'POST /df/novel/{}/original_script/characters/batch-rename',
  'POST /df/novel/{}/script_edit_agent/enter',
  'POST /df/novel/{}/script_edit_agent/heartbeat',
  'POST /df/novel/{}/script_edit_agent/exit',
  'GET /df/novel/{}/script_edit_agent/sessions',
  'POST /df/novel/{}/script_edit_agent/sessions',
  'POST /df/novel/{}/script_edit_agent/sessions/switch',
  'GET /df/novel/{}/script_edit_agent/sessions/{}',
  'POST /df/novel/{}/script_edit_agent/sessions/{}/chat',
  'POST /df/novel/{}/script_edit_agent/sessions/{}/abort',
  'PUT /df/novel/{}/script_edit_agent/sessions/{}/episodes/{}/pending',
  'POST /df/novel/{}/script_edit_agent/sessions/{}/episodes/{}/apply',
  'POST /df/novel/{}/script_edit_agent/sessions/{}/episodes/{}/reject',
  'POST /df/novel/{}/script_edit_agent/sessions/{}/apply_all',
  'POST /df/novel/{}/script_edit_agent/sessions/{}/reject_all',
  'GET /df/novel/{}/script_edit_agent',
  'POST /df/novel/{}/script_edit_agent/version/{}/finalize',
  'POST /df/novel/{}/script_edit_agent/version/{}/delete',
  'POST /df/novel/{}/fission_script',
  'POST /df/novel/{}/fission_script/idea',
  'POST /df/novel/{}/fission_script/idea/select-op',
  'GET /df/novel/{}/fission_script/idea',
  'PUT /df/novel/{}/fission_script/idea/{}',
  'GET /df/novel/{}/fission_script/idea/{}',
  'POST /df/novel/{}/fission_script/summary_outline',
  'PUT /df/novel/{}/fission_script/summary_outline',
  'GET /df/novel/{}/fission_script/summary_outline',
  'POST /df/novel/{}/fission_script/episodes_outline',
  'PUT /df/novel/{}/fission_script/episodes_outline/{}',
  'POST /df/novel/{}/fission_script/episodes',
  'GET /df/novel/{}/fission_script/characters',
  'GET /df/novel/{}/fission_script/characters/{}',
  'PUT /df/novel/{}/fission_script/characters/{}',
  'GET /df/novel/{}/fission_script/chapters_outline',
  'POST /df/novel/fission_script/create',
];

// 90 条 = 58 条「剥掉 /df 就同形」的前缀偏离 + 32 条结构性偏离（方法/命名/入口不同）。
// 后者里 13 条是本批按竞品形状补的单点形状（能力早就在，只是缺「单个对象」入口）。
const NOVEL_PAIRS: Array<[string, string, string]> = [
  ['POST /df/novel/{}', 'POST /novel', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/{}/summary', 'GET /novel/{}/summary', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/list', 'GET /novel/list', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['PUT /df/novel/{}/adjust', 'PATCH /novel/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['GET /df/novel/{}', 'GET /novel/{}', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/delete', 'DELETE /novel/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['GET /df/novel/{}/chapter_outline/list', 'GET /novel/{}/chapter_outline/list', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/split', 'POST /novel/{}/split', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['GET /df/novel/split/{}', 'GET /novel/{}/chapters', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['PUT /df/novel/{}/chapter_outline/{}', 'PATCH /novel/{}/chapter_outline/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/{}/episode_outline/generate', 'POST /novel/{}/episode_outline/generate', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['PUT /df/novel/{}/episode_outline/{}', 'PATCH /novel/{}/episode_outline/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/{}/core_character/generate', 'POST /novel/{}/core_character/generate', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/core_character/list', 'GET /novel/{}/core_character/list', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['PUT /df/novel/{}/core_character/{}', 'PATCH /novel/{}/core_character/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/{}/episode/generate', 'POST /novel/{}/script-generate', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['GET /df/novel/{}/episode/list', 'GET /novel/{}/episode/list', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['PUT /df/novel/{}/episode/{}', 'PATCH /novel/{}/episode/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/{}/finalize', 'POST /novel/{}/finalize', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/download', 'GET /novel/{}/download', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/novel_chapters/list', 'GET /novel/{}/chapters', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['GET /df/novel/{}/point', 'POST /credits/quote', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/{}/content-analysis', 'POST /novel/{}/content-analysis', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/script-analysis', 'POST /novel/{}/content-analysis', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/{}/script-generate', 'POST /novel/{}/script-generate', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/content-analysis/detail', 'GET /novel/{}/content-analysis/detail', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['PUT /df/novel/{}/content-analysis/worldview', 'PUT /novel/{}/content-analysis/worldview', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['PUT /df/novel/{}/content-analysis/novel_character_cards/{}', 'PATCH /novel/{}/content-analysis/novel_character_cards/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['PUT /df/novel/{}/script-analysis/novel_storyline/{}', 'PATCH /novel/{}/chapter_outline/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/original_script/idea', 'POST /novel/{}/original_script/idea', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/{}/original_script/characters', 'POST /novel/{}/original_script/characters', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/original_script/materials', 'POST /novel/{}/original_script/materials', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/original_script/summary_outline', 'POST /novel/{}/original_script/summary_outline', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/original_script/chapters_outline', 'POST /novel/{}/original_script/chapters_outline', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/original_script/episodes_outline', 'POST /novel/{}/original_script/episodes_outline', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/original_script/episodes', 'POST /novel/{}/original_script/episodes', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/original_script/idea', 'GET /novel/{}/original_script/idea', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/original_script/idea/{}', 'GET /novel/{}/original_script/idea/{}', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['PUT /df/novel/{}/original_script/idea/{}', 'PATCH /novel/{}/original_script/idea/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/{}/original_script/idea/select-op', 'POST /novel/{}/original_script/idea/select-op', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/original_script/characters', 'GET /novel/{}/original_script/characters', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/original_script/characters/{}', 'GET /novel/{}/original_script/characters/{}', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['PUT /df/novel/{}/original_script/characters/{}', 'PATCH /novel/{}/original_script/characters/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/{}/original_script/characters/{}/delete', 'POST /novel/{}/original_script/characters/{}/delete', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/original_script/characters/add', 'POST /novel/{}/original_script/characters', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['GET /df/novel/{}/original_script/materials', 'GET /novel/{}/original_script/materials', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/original_script/materials/select-op', 'POST /novel/{}/original_script/materials/select-op', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/original_script/materials/{}', 'GET /novel/{}/original_script/materials/{}', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['PUT /df/novel/{}/original_script/materials/{}', 'PATCH /novel/{}/original_script/materials/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/{}/original_script/materials/generate', 'POST /novel/{}/original_script/materials/generate', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/original_script/summary_outline', 'GET /novel/{}/original_script/summary_outline', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['PUT /df/novel/{}/original_script/summary_outline', 'PATCH /novel/{}/original_script/summary_outline', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['GET /df/novel/{}/original_script/chapters_outline', 'GET /novel/{}/original_script/chapters_outline', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['PUT /df/novel/{}/original_script/chapters_outline/{}', 'PATCH /novel/{}/original_script/chapters_outline/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['PUT /df/novel/{}/original_script/episodes_outline/{}', 'PATCH /novel/{}/original_script/episodes_outline/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/{}/original_script/characters/batch-rename', 'POST /novel/{}/original_script/characters/batch-rename', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/script_edit_agent/enter', 'POST /novel/{}/script_edit_agent/enter', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/script_edit_agent/heartbeat', 'POST /novel/{}/script_edit_agent/heartbeat', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/script_edit_agent/exit', 'POST /novel/{}/script_edit_agent/exit', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/script_edit_agent/sessions', 'GET /novel/{}/script_edit_agent/sessions', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/script_edit_agent/sessions', 'POST /novel/{}/script_edit_agent/sessions', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/script_edit_agent/sessions/switch', 'POST /novel/{}/script_edit_agent/sessions/switch', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/script_edit_agent/sessions/{}', 'GET /novel/{}/script_edit_agent/sessions/{}', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/script_edit_agent/sessions/{}/chat', 'POST /novel/{}/script_edit_agent/sessions/{}/chat', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/script_edit_agent/sessions/{}/abort', 'POST /novel/{}/script_edit_agent/sessions/{}/abort', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['PUT /df/novel/{}/script_edit_agent/sessions/{}/episodes/{}/pending', 'GET /novel/{}/script_edit_agent/sessions/{}/episodes/{}/pending', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/{}/script_edit_agent/sessions/{}/episodes/{}/apply', 'POST /novel/{}/script_edit_agent/sessions/{}/episodes/{}/apply', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/script_edit_agent/sessions/{}/episodes/{}/reject', 'POST /novel/{}/script_edit_agent/sessions/{}/episodes/{}/reject', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/script_edit_agent/sessions/{}/apply_all', 'POST /novel/{}/script_edit_agent/sessions/{}/apply_all', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/script_edit_agent/sessions/{}/reject_all', 'POST /novel/{}/script_edit_agent/sessions/{}/reject_all', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/script_edit_agent', 'GET /novel/{}/script_edit_agent', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/script_edit_agent/version/{}/finalize', 'POST /novel/{}/script_edit_agent/version/{}/finalize', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/script_edit_agent/version/{}/delete', 'DELETE /novel/{}/script_edit_agent/version/{}/delete', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/{}/fission_script', 'POST /novel/{}/fission_script', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/fission_script/idea', 'POST /novel/{}/fission_script/idea', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/fission_script/idea/select-op', 'POST /novel/{}/fission_script/idea/select-op', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/fission_script/idea', 'GET /novel/{}/fission_script/idea', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['PUT /df/novel/{}/fission_script/idea/{}', 'PATCH /novel/{}/fission_script/idea/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['GET /df/novel/{}/fission_script/idea/{}', 'GET /novel/{}/fission_script/idea/{}', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/fission_script/summary_outline', 'POST /novel/{}/fission_script/summary_outline', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['PUT /df/novel/{}/fission_script/summary_outline', 'PATCH /novel/{}/fission_script/summary_outline', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['GET /df/novel/{}/fission_script/summary_outline', 'GET /novel/{}/fission_script/summary_outline', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/{}/fission_script/episodes_outline', 'POST /novel/{}/fission_script/episodes_outline', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['PUT /df/novel/{}/fission_script/episodes_outline/{}', 'PATCH /novel/{}/fission_script/episodes_outline/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['POST /df/novel/{}/fission_script/episodes', 'POST /novel/{}/fission_script/episodes', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/fission_script/characters', 'GET /novel/{}/fission_script/characters', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/novel/{}/fission_script/characters/{}', 'GET /novel/{}/fission_script/characters/{}', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['PUT /df/novel/{}/fission_script/characters/{}', 'PATCH /novel/{}/fission_script/characters/{}', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
  ['GET /df/novel/{}/fission_script/chapters_outline', 'GET /novel/{}/fission_script/chapters_outline', '前缀偏离：竞品把小说改编链挂在 `/df/novel/*`，我方按 ADR-009 直接是 `/novel/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/novel/fission_script/create', 'POST /novel/{}/fission_script', '结构性偏离：能力在，方法/命名/入口不同（ADR-009）'],
];

// 12 条豁免 = 买断/授权 7 条 + 本子级协作组/权限/分发 5 条：我方连模型都没有（不是没做，是没建表）。
const NOVEL_WAIVED: Record<string, string> = {
  'GET /df/novel/{}/buy/detail': 'B 类：我方没有「买断/授权」模型（`novels` 只有 owner 与协作关系，没有 buy 记录表），买断详情无处可查',
  'PUT /df/novel/{}/buy/edit': 'B 类：同上——没有买断记录，就没有可改的买断条款',
  'GET /df/novel/{}/buy/characters': 'B 类：买断角色表是我方没有的第二套角色归属（`novel_characters` 只有 `novel_id`，没有 buyer 维度）',
  'PUT /df/novel/{}/buy/characters/{}': 'B 类：同上——买断角色没有可写的记录，`novel_characters` 也没有 buyer 维度',
  'GET /df/novel/{}/buy/episodes': 'B 类：买断分集清单同理，`novel_episodes` 没有 buyer 维度',
  'PUT /df/novel/{}/buy/chapters/{}': 'B 类：买断章节写能力同理——没有 buy 记录表，`novel_chapters` 也没有 buyer 维度，写进去只能造假',
  'GET /df/novel/{}/buy/content-tree': 'B 类：买断内容树是「买方视角」的目录，我方没有买方模型，算不出这棵树',
  'GET /df/novel/member-groups': 'B 类：我方没有「本子级协作组」模型（团队权限在 `/cam/permissions`，不是 novel 维度）',
  'POST /df/novel/{}/group': 'B 类：同上——没有 novel 维度的成员组表可写',
  'GET /df/novel/{}/permission': 'B 类：本子级权限矩阵没有落库（权限在团队/空间层），读不出单本权限',
  'GET /df/novel/distribute/list': 'B 类：分发列表是发行侧数据（我方只有运营侧 `/op/distributor/*` 的配置，没有作者侧分发记录）',
  'POST /df/novel/{}/permission': 'B 类：同上——没有本子级权限表，写只能造假',
};

// 本批按竞品形状补的 13 条我方路由（断言它们真实存在，防止以后被改名后覆盖数仍虚高）
const NOVEL_IMPLEMENTED: string[] = [
  'GET /novel/{}/download',
  'GET /novel/{}/script_edit_agent',
  'POST /novel/{}/original_script/materials',
  'GET /novel/{}/original_script/materials/{}',
  'GET /novel/{}/original_script/characters/{}',
  'POST /novel/{}/original_script/characters/{}/delete',
  'POST /novel/{}/original_script/characters/batch-rename',
  'GET /novel/{}/fission_script/summary_outline',
  'PATCH /novel/{}/fission_script/summary_outline',
  'POST /novel/{}/fission_script/idea',
  'PATCH /novel/{}/fission_script/idea/{}',
  'PATCH /novel/{}/fission_script/characters/{}',
  'PATCH /novel/{}/original_script/episodes_outline/{}',
];

for (const [shape, ours, reason] of NOVEL_PAIRS) {
  DEVIATIONS[shapeOf(shape)] = { ours, reason };
}
for (const [shape, reason] of Object.entries(NOVEL_WAIVED)) {
  WAIVED[shapeOf(shape)] = reason;
}

// 72 条 = #3 剧集与分镜的竞品全集（`/df/episode/*` 与 `/df/storyboard/*`，来自 TSV 的 METHOD+path）。
// 与 #2 小说同因：竞品带 `/df` 域分层、我方按 ADR-009 收敛到 `/projects/*`，所以这一组的「同形」必然为 0，
// 覆盖必须靠显式登记（49 条偏离 + 23 条豁免），不允许靠 normalize 把 `/df` 抹掉凑数。
const EPISODE_SHAPES: string[] = [
  'POST /df/episode/{}/storyboard-add',
  'POST /df/episode/{}/storyboard/{}/edit',
  'POST /df/storyboard/{}/info-confirm',
  'GET /df/episode/list',
  'GET /df/episode/assets_list',
  'POST /df/episode/add',
  'POST /df/episode/{}/storyboard/num-update',
  'GET /df/episode/info',
  'GET /df/episode/{}/storyboard/{}/info',
  'GET /df/episode/{}/storyboard-list',
  'GET /df/storyboard/{}/info-list',
  'POST /df/episode/{}/storyboard/delete',
  'POST /df/episode/edit',
  'POST /df/episode/delete',
  'GET /df/episode/{}/material-list',
  'POST /df/storyboard/{}/info-delete',
  'GET /df/storyboard/{}/info/{}/detail',
  'POST /df/episode/{}/storyboard-export',
  'POST /df/storyboard/batch-ai-generate',
  'POST /df/storyboard/batch-ai-generate-video',
  'POST /df/episode/batch-create',
  'POST /df/episode/edit-epext',
  'GET /df/episode/storyboard-total-list',
  'PUT /df/episode/{}/storyboard/storyboard-ext',
  'POST /df/episode/{}/resources',
  'GET /df/episode/{}/resources',
  'PUT /df/episode/{}/resources',
  'POST /df/episode/{}/parse',
  'GET /df/episode/{}/parse-result',
  'POST /df/episode/script_draft/batch_update',
  'POST /df/episode/{}/script_draft/add',
  'POST /df/episode/script_draft/{}/edit',
  'POST /df/episode/script_draft/{}/delete',
  'POST /df/storyboard/{}/info/add',
  'GET /df/episode/{}/storyboard/{}/link-draft',
  'POST /df/episode/{}/parse-reset',
  'POST /df/episode/{}/parse-retry',
  'POST /df/episode/{}/parse/result-sync',
  'POST /df/episode/{}/storyboard-export-retry',
  'POST /df/episode/batch/resources',
  'POST /df/episode/batch-storyboard-export',
  'POST /df/episode/process-status/edit',
  'GET /df/episode/process-status/logs',
  'POST /df/episode/{}/quality-check',
  'POST /df/storyboard/send-comment',
  'GET /df/storyboard/comment-list',
  'POST /df/storyboard/edit-comment',
  'GET /df/episode/{}/{}/detail',
  'POST /df/episode/batch-delete',
  'POST /df/episode/optimization',
  'POST /df/episode/optimization_edit',
  'POST /df/storyboard/{}/info/batch-add',
  'POST /df/episode/{}/resources/match-reset',
  'GET /df/episode/{}/storyboard-tag-groups',
  'PUT /df/storyboard/{}/info/{}/tag-groups',
  'PUT /df/episode/{}/storyboard-tag-groups/{}',
  'DELETE /df/episode/{}/storyboard-tag-groups/{}/members',
  'DELETE /df/episode/{}/storyboard-tag-groups/members',
  'POST /df/episode/status',
  'PUT /df/episode/edit-project',
  'POST /df/episode/{}/film-synthesis-export',
  'POST /df/episode/{}/film-synthesis-export-retry',
  'POST /df/episode/{}/process/parse',
  'GET /df/episode/{}/process/parse-list',
  'POST /df/episode/{}/process/parse/delete',
  'PUT /df/episode/{}/process/parse',
  'POST /df/episode/{}/process/parse/info',
  'POST /df/episode/{}/process/parse/generate',
  'POST /df/episode/{}/process/parse/confirm',
  'POST /df/episode/{}/process/parse/upload',
  'PUT /df/episode/shot/delete',
  'GET /df/episode/{}/shot',
];

// 49 条结构性偏离：41 条纯前缀差异（剥掉 `/df` 后尾段同构）+ 8 条方法/入口不同。
// 其中 3 条是本批按竞品形状补的真端点（单条分镜、集批量删、分镜批量追加）+ 1 条是给 PATCH 补 `status`。
const EPISODE_PAIRS: Array<[string, string, string]> = [
  ['POST /df/episode/{}/storyboard-add', 'POST /projects/{}/episodes/{}/storyboards', '前缀偏离：竞品把剧集/分镜挂在 `/df/episode/*` 与 `/df/storyboard/*`，我方按 ADR-009 收敛到 `/projects/{}/episodes/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/episode/{}/storyboard/{}/edit', 'PATCH /projects/{}/episodes/{}/storyboards/{}', '前缀偏离：竞品把剧集/分镜挂在 `/df/episode/*` 与 `/df/storyboard/*`，我方按 ADR-009 收敛到 `/projects/{}/episodes/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/episode/list', 'GET /projects/{}', '竞品把 id 放 query（`sp_id`）列集；我方是「读项目详情，里面带 episodes[]」'],
  ['GET /df/episode/assets_list', 'GET /projects/{}/assets', '前缀偏离：竞品把剧集/分镜挂在 `/df/episode/*` 与 `/df/storyboard/*`，我方按 ADR-009 收敛到 `/projects/{}/episodes/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/episode/add', 'POST /projects/{}/episodes', '前缀偏离：竞品把剧集/分镜挂在 `/df/episode/*` 与 `/df/storyboard/*`，我方按 ADR-009 收敛到 `/projects/{}/episodes/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/episode/{}/storyboard/num-update', 'POST /projects/{}/episodes/{}/storyboards/num-update', '前缀偏离：竞品把剧集/分镜挂在 `/df/episode/*` 与 `/df/storyboard/*`，我方按 ADR-009 收敛到 `/projects/{}/episodes/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/episode/info', 'GET /projects/{}/episodes/{}', '竞品把 `ep_id` 放 query；我方放路径（REST）'],
  ['GET /df/episode/{}/storyboard/{}/info', 'GET /projects/{}/episodes/{}/storyboards/{}', '第 91 批新增的单条分镜读；竞品路径里没有 `ep_id` 之外的定位'],
  ['GET /df/episode/{}/storyboard-list', 'GET /projects/{}/episodes/{}', '我方整集详情直接带 `storyboards[]`，不需要单独列表端点'],
  ['GET /df/storyboard/{}/info-list', 'GET /projects/{}/episodes/{}', '同上：竞品的 storyboard/info 两层在我方合并成「一集 → 分镜[]」'],
  ['POST /df/episode/{}/storyboard/delete', 'POST /projects/{}/episodes/{}/storyboards/batch-delete', '竞品路径里有双斜杠笔误，且 id 只在 body'],
  ['POST /df/episode/edit', 'PATCH /projects/{}/episodes/{}', '竞品用 POST 改集；我方用 PATCH'],
  ['POST /df/episode/delete', 'DELETE /projects/{}/episodes/{}', '竞品把 id 放 body；我方按 REST 放路径'],
  ['GET /df/episode/{}/material-list', 'GET /projects/{}/episodes/{}/match-result', '素材匹配结果在 `episode_resources`，按集读'],
  ['POST /df/storyboard/{}/info-delete', 'DELETE /projects/{}/episodes/{}/storyboards/{}', '前缀偏离：竞品把剧集/分镜挂在 `/df/episode/*` 与 `/df/storyboard/*`，我方按 ADR-009 收敛到 `/projects/{}/episodes/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['GET /df/storyboard/{}/info/{}/detail', 'GET /projects/{}/episodes/{}/storyboards/{}', '第 91 批新增的单条分镜读（同一行）'],
  ['POST /df/episode/{}/storyboard-export', 'POST /projects/{}/episodes/{}/exports', '导出作业落 `export_jobs`，按集创建/查询/重试'],
  ['POST /df/storyboard/batch-ai-generate', 'POST /projects/{}/episodes/{}/storyboards/generate', '竞品按 storyboard 批量出图；我方按集批量'],
  ['POST /df/storyboard/batch-ai-generate-video', 'POST /projects/{}/episodes/{}/storyboards/generate-videos', '同上，出片通道'],
  ['POST /df/episode/batch-create', 'POST /projects/{}/episodes/batch', '竞品 `batch-create`；我方 `batch`（第 71 批）'],
  ['GET /df/episode/storyboard-total-list', 'GET /projects/{}/matrix', '跨集分镜总览 = 我方项目矩阵（episodes × storyboards）'],
  ['POST /df/episode/{}/resources', 'POST /projects/{}/episodes/{}/match-resources', '触发素材匹配'],
  ['GET /df/episode/{}/resources', 'GET /projects/{}/episodes/{}/match-result', '读匹配结果'],
  ['PUT /df/episode/{}/resources', 'POST /projects/{}/episodes/{}/save-resource-matches', '写入人工选择；竞品用 PUT'],
  ['POST /df/episode/{}/parse', 'POST /projects/{}/episodes/parse', '解析入口在项目级（可指定集），竞品在集级'],
  ['POST /df/episode/{}/script_draft/add', 'POST /projects/{}/episodes/{}/script-draft/generate', '我方生成即落 episode（不做草稿表）'],
  ['POST /df/storyboard/{}/info/add', 'POST /projects/{}/episodes/{}/storyboards', '前缀偏离：竞品把剧集/分镜挂在 `/df/episode/*` 与 `/df/storyboard/*`，我方按 ADR-009 收敛到 `/projects/{}/episodes/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/episode/{}/parse-reset', 'POST /projects/{}/episodes/parse-reset', '前缀偏离：竞品把剧集/分镜挂在 `/df/episode/*` 与 `/df/storyboard/*`，我方按 ADR-009 收敛到 `/projects/{}/episodes/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/episode/{}/parse-retry', 'POST /projects/{}/episodes/parse-retry', '前缀偏离：竞品把剧集/分镜挂在 `/df/episode/*` 与 `/df/storyboard/*`，我方按 ADR-009 收敛到 `/projects/{}/episodes/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/episode/{}/storyboard-export-retry', 'POST /projects/{}/episodes/{}/exports/{}/retry', '前缀偏离：竞品把剧集/分镜挂在 `/df/episode/*` 与 `/df/storyboard/*`，我方按 ADR-009 收敛到 `/projects/{}/episodes/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/episode/{}/quality-check', 'POST /projects/{}/episodes/{}/quality-check', '前缀偏离：竞品把剧集/分镜挂在 `/df/episode/*` 与 `/df/storyboard/*`，我方按 ADR-009 收敛到 `/projects/{}/episodes/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/episode/batch-delete', 'POST /projects/{}/episodes/batch-delete', '第 91 批新增；竞品 ids 只在 body'],
  ['POST /df/episode/optimization', 'POST /projects/{}/episodes/{}/script-draft/generate', '优化 = 带 instructions 重写剧本'],
  ['POST /df/episode/optimization_edit', 'PATCH /projects/{}/episodes/{}', '采用优化结果 = 写回 `script_text`'],
  ['POST /df/storyboard/{}/info/batch-add', 'POST /projects/{}/episodes/{}/storyboards/batch-add', '第 91 批新增；只在末尾追加'],
  ['POST /df/episode/{}/resources/match-reset', 'POST /projects/{}/episodes/{}/match-reset', '前缀偏离：竞品把剧集/分镜挂在 `/df/episode/*` 与 `/df/storyboard/*`，我方按 ADR-009 收敛到 `/projects/{}/episodes/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/episode/status', 'PATCH /projects/{}/episodes/{}', '第 91 批把 `status`(1|2) 加进 PATCH；竞品是独立端点'],
  ['PUT /df/episode/edit-project', 'PATCH /projects/{}', '改项目属性；竞品用 PUT'],
  ['POST /df/episode/{}/film-synthesis-export', 'POST /projects/{}/episodes/{}/film-synthesis-export', '前缀偏离：竞品把剧集/分镜挂在 `/df/episode/*` 与 `/df/storyboard/*`，我方按 ADR-009 收敛到 `/projects/{}/episodes/*`（`/df` 是竞品的域分层，不是能力差异）'],
  ['POST /df/episode/{}/process/parse', 'POST /projects/{}/assets/extract', '竞品的「流程解析」= 我方从分镜/剧本抽资产'],
  ['GET /df/episode/{}/process/parse-list', 'GET /projects/{}/assets', '解析产物列表 = 项目资产列表'],
  ['POST /df/episode/{}/process/parse/delete', 'DELETE /projects/{}/assets/{}', '竞品把 id 放 body；我方放路径'],
  ['PUT /df/episode/{}/process/parse', 'PATCH /projects/{}/assets/{}', '改资产；竞品用 PUT'],
  ['POST /df/episode/{}/process/parse/info', 'GET /projects/{}/assets/{}', '单条资产详情；竞品用 POST 读'],
  ['POST /df/episode/{}/process/parse/generate', 'POST /projects/{}/assets/extract', '生成 = 再跑一次抽取'],
  ['POST /df/episode/{}/process/parse/confirm', 'POST /projects/{}/assets/batch-confirm', '确认 = 批量定稿资产'],
  ['POST /df/episode/{}/process/parse/upload', 'POST /projects/{}/assets', '上传 = 手工建资产'],
  ['PUT /df/episode/shot/delete', 'DELETE /projects/{}/episodes/{}/storyboards/{}', 'shot 与 storyboard 在我方是同一条记录；竞品用 PUT 删'],
  ['GET /df/episode/{}/shot', 'GET /projects/{}/episodes/{}', '镜头列表 = 整集详情里的 `storyboards[]`'],
];

// 23 条豁免 = 缺模型/缺外部依赖（不是「没做」）：分镜评论 3、分镜标签组 5、剧本草稿 6、
// 制作流程状态 2、集/分镜扩展字段 2、异步解析结果 2、跨集批量 2、成片合成重试 1。
const EPISODE_WAIVED: Record<string, string> = {
  'POST /df/storyboard/{}/info-confirm': 'B 类：竞品有「手动确认单条分镜」；我方 `storyboards.status` 由生成流水推进（image/video task + status 列），PATCH 不暴露 status，无竞品字段证据不敢造状态机',
  'POST /df/episode/edit-epext': 'B 类：竞品有集级扩展字段桶（epext）；我方 `episodes` 是固定列（title/synopsis/script_text/status），未知字段一律 400101，不造空壳扩展字段',
  'PUT /df/episode/{}/storyboard/storyboard-ext': 'B 类：同上，分镜也没有扩展字段桶；我方 `storyboards` 的列是固定契约',
  'GET /df/episode/{}/parse-result': '外部：解析是同步事务（`parse.service` 在事务里落 episodes/storyboards 并直接返回结果），没有异步任务可拉；结果读 `GET …/episodes/{}` 即可',
  'POST /df/episode/script_draft/batch_update': 'B 类：竞品有独立「剧本草稿」表（esd_id）；我方生成即写入 episode，没有草稿实体可批量更新',
  'POST /df/episode/script_draft/{}/edit': 'B 类：同上，无草稿表（我方编辑走 PATCH episode 的 `script_text`）',
  'POST /df/episode/script_draft/{}/delete': 'B 类：我方没有剧本草稿表（生成即落 `episodes.script_text`），没有草稿记录可删；要动剧本走 `PATCH …/episodes/{}`',
  'GET /df/episode/{}/storyboard/{}/link-draft': 'B 类：草稿不存在（同脚本草稿三条），没有「分镜→草稿」的关联可查',
  'POST /df/episode/{}/parse/result-sync': '外部：解析同步返回，不需要「把结果同步回来」这一步；先备份再覆盖由 `parse-retry` 承担',
  'POST /df/episode/batch/resources': '外部：素材匹配按集触发；跨集批量由调用方循环，未做跨集批量端点（竞品也无入参形状证据）',
  'POST /df/episode/batch-storyboard-export': '外部：导出按集创建作业；跨集批量由调用方循环，避免半批失败时的作业对账问题',
  'POST /df/episode/process-status/edit': 'B 类：竞品有独立的制作流程状态实体与流水；我方没有 process 模型（集有 status 1/2，分镜有 1–5，没有「流程节点」）',
  'GET /df/episode/process-status/logs': 'B 类：我方没有独立的制作流程状态实体与流水表（集只有 1/2 草稿-确认，分镜只有 1–5 生成状态），没有日志可读',
  'POST /df/storyboard/send-comment': 'B 类：分镜评论模型不存在（画布侧有节点评论，但那是 canvas 域，不共用）',
  'GET /df/storyboard/comment-list': 'B 类：分镜评论模型不存在（画布侧节点评论是 canvas 域的 `canvas_comment_nodes`，不跨域复用），没有评论可列',
  'POST /df/storyboard/edit-comment': 'B 类：同上——分镜没有评论表，也就没有可编辑的评论；画布评论走 canvas 域自己的端点',
  'GET /df/episode/{}/{}/detail': 'B 类：竞品第二段是剧本草稿 id（esd）；我方无草稿表，该 id 无对象可指',
  'GET /df/episode/{}/storyboard-tag-groups': 'B 类：分镜标签组模型不存在（`storyboards` 只有 shot_no/描述/时长/比例/状态，无标签维度）',
  'PUT /df/storyboard/{}/info/{}/tag-groups': 'B 类：分镜标签组模型不存在（`storyboards` 只有镜头序号/描述/时长/比例/状态，没有标签维度），没有组可写',
  'PUT /df/episode/{}/storyboard-tag-groups/{}': 'B 类：同上——没有分镜标签组实体，写标签组只能造假表',
  'DELETE /df/episode/{}/storyboard-tag-groups/{}/members': 'B 类：同上——没有分镜标签组，也没有成员关系表，删成员无对象可删',
  'DELETE /df/episode/{}/storyboard-tag-groups/members': 'B 类：同上——没有分镜标签组与成员关系，批量删成员无对象',
  'POST /df/episode/{}/film-synthesis-export-retry': '外部：成片合成是同步 80% 闸门（不足直接 400106），没有异步任务可重试；时间线导出才有 `exports/{}/retry`',
};

// 本批按竞品形状补的 3 条我方路由（断言真实存在，防止改名后覆盖数虚高）。
// 第 4 条「改集状态」不是新路由，是给 `PATCH /projects/{}/episodes/{}` 加 `status`(1|2)。
const EPISODE_IMPLEMENTED: string[] = [
  'GET /projects/{}/episodes/{}/storyboards/{}',
  'POST /projects/{}/episodes/batch-delete',
  'POST /projects/{}/episodes/{}/storyboards/batch-add',
];

for (const [shape, ours, reason] of EPISODE_PAIRS) {
  DEVIATIONS[shapeOf(shape)] = { ours, reason };
}
for (const [shape, reason] of Object.entries(EPISODE_WAIVED)) {
  WAIVED[shapeOf(shape)] = reason;
}

// ── #5 全部项目：竞品 `/df/script_project/*` 21 条 ──────────────────────────
// 与 #2/#3 同因：竞品在 `/web/v1/df/` 下，我方是 `/projects/*`，前缀不同使同形必然为 0，
// 覆盖只能靠显式登记。本批补了项目级导出日志 2 条（读取型投影，不建新表）。
const PROJECT_PAIRS: Array<[string, string, string]> = [
  ['POST /df/script_project/add', 'POST /projects', '竞品把创建做成 add 动词，我方按资源语义 POST /projects；入参（title/source_type/source_text）同义'],
  ['POST /df/script_project/edit', 'PATCH /projects/{}', '竞品用 POST 做局部改；我方 PATCH /projects/{}，改的是同一批字段'],
  ['GET /df/script_project/list', 'GET /works', '竞品列表只管工坊项目；我方 /works 是跨域只读投影（工坊 + 画布），筛选参数已按竞品语义翻译（name≡keyword、process_status=-1≡status=all）'],
  ['GET /df/script_project/info', 'GET /projects/{}', '竞品用 query ?sp_id= 传主键；我方把 id 放路径段'],
  ['GET /df/script_project/resource_lib_list', 'GET /projects/{}/assets', '竞品的资源库列表是项目下资产；我方独立端点 GET /projects/{}/assets（角色/场景/道具同表按 kind 分隔）'],
  ['POST /df/script_project/delete', 'DELETE /projects/{}', '竞品 POST + 空体删除；我方 DELETE（且是软删：写 status=2/archived_at，历史分集与任务保留）'],
  ['GET /df/script_project/export-log', 'GET /projects/{}/exports', '第 92 批补：竞品项目级导出日志；我方做只读投影（分镜导出按 episode 反查 + 成片合成自带的 project_id 合并），不建新表'],
  ['GET /df/script_project/export-log/{}', 'GET /projects/{}/exports/{}', '第 92 批补：单条导出记录；两张表 id 撞号时返回 400101 要求 ?kind=storyboard|timeline，不猜'],
  ['GET /df/script_project/{}/split-list', 'GET /projects/{}', '竞品单列分集清单；我方项目详情 GET /projects/{} 已内含 episodes 数组（另有 GET /projects/{}/matrix 做跨集矩阵），不另开重复端点'],
  ['POST /df/script_project/split', 'POST /projects/{}/episodes/split', '拆集入口语义相同；我方带「已有确认集则 400101」与 source_text 不超 5 万字两道闸'],
  ['POST /df/script_project/{}/split-delete', 'POST /projects/{}/episodes/batch-delete', '第 91 批补的批量删集：竞品是「按项目批量删」，我方收显式 id 列表（任一 id 不属于该项目整批 400102，不半删）'],
  ['POST /df/script_project/{}/group/edit', 'POST /projects/{}/group', '归档到分组是项目级动作；竞品把 group_id 放路径，我方放 body'],
];

const PROJECT_WAIVED: Record<string, string> = {
  'POST /df/script_project/export-log/{}/edit': 'B 类：竞品给导出记录可写备注/场景字段；我方 exports 与 timeline_exports 只有 status/file_uri/error/expires_at 等产物列，没有备注列',
  'POST /df/script_project/process-status/edit': 'B 类：竞品有独立的制作流水状态实体；我方 script_projects 只有 status(1 进行中 / 2 已归档)，没有可写的流水节点',
  'POST /df/script_project/ai-short-film/agent-start': '外部：竞品广告剧 agent 的启动入口；我方创作 agent 在 /agent/* 域，广告剧模板属另一产品的编排，不在项目域承接',
  'POST /df/script_project/{}/source-scripts': 'B 类：竞品有独立「原稿」实体（source_script）；我方拆集直接落 episodes，没有 source_scripts 表，没有原稿记录可建',
  'GET /df/script_project/{}/source-scripts': 'B 类：同上——无 source_scripts 表，没有原稿版本可列；分集本身用 GET /projects/{} 读',
  'GET /df/script_project/{}/source-scripts/{}/splits': 'B 类：原稿的「拆分产物」在我方就是 episodes 行，没有原稿 id 这一层，也就没有按原稿查其拆分的路径',
  'PATCH /df/script_project/{}/source-scripts/{}': 'B 类：无原稿实体（拆集直接写 episodes），没有原稿正文可改；要改文本走 PATCH /projects/{} 的 source_text',
  'DELETE /df/script_project/{}/source-scripts/{}': 'B 类：无 source_scripts 表；重复导入的原稿在竞品可单独删，我方以「重新拆集」覆盖，没有原稿记录可删',
  'GET /df/script_project/{}/source-scripts/{}/split-contents': 'B 类：竞品按 split_ids 取原稿拆出的正文块；我方正文直接存 episodes.script_text，没有「原稿-拆分块」两层表',
};

// 本批按竞品形状补的 2 条我方路由（断言真实存在，防止改名后覆盖数虚高）
const PROJECT_IMPLEMENTED: string[] = ['GET /projects/{}/exports', 'GET /projects/{}/exports/{}'];

const PROJECT_SHAPES: string[] = [
  ...PROJECT_PAIRS.map(([shape]) => shape),
  ...Object.keys(PROJECT_WAIVED),
];

// ── #7 团队：竞品 `/cam/team/*` 29 条 ──────────────────────────────────────
// 本组是唯一「同形率很高」的域（10 条完全同形）：双方都把团队挂在 `cam` 下、
// 都用 `team/*` 子路径。剩下 17 条是「team_id 谁给」的问题——竞品放在路径里，
// 我方从 token 取（一个用户只有一个团队，路径段是冗余的），另有 4 条方法偏离（POST↔PATCH/DELETE）。
const TEAM_EXACT: string[] = [
  'POST /cam/team/points-allocation',
  'POST /cam/team/points-recovery',
  'GET /cam/team/points-flow/list',
  'GET /cam/team/points-flow/export',
  'GET /cam/team/project-points-flow/list',
  'GET /cam/team/project-points-flow/export',
  'POST /cam/team/project-points-ranking',
  'POST /cam/team/member/batch/status',
  'POST /cam/team/batch-points-allocation',
  'POST /cam/team/member/change-group',
];

const TEAM_PAIRS: Array<[string, string, string]> = [
  ['GET /cam/team/temp-info', 'GET /cam/temp-info', '临时会话信息（团队上下文 + 未读）；我方挂在 cam 根下，语义同一份'],
  ['GET /cam/team/{}/info', 'GET /cam/team/info', '团队信息按 token 里的 team_id 取，路径不再带 team 段（同一用户无多团队可选）'],
  ['POST /cam/team/{}/edit', 'PATCH /cam/team/info', '竞品 POST 改团队信息；我方 PATCH，字段同名'],
  ['POST /cam/team/{}/member/batch', 'POST /cam/team/member/batch', '批量加成员；team_id 从 token 取，不重复放在路径里'],
  ['GET /cam/team/{}/members', 'GET /cam/team/members', '成员列表；query（role_ids/nick/status/page/page_size/group_id/has_group）按竞品语义翻译到同一端点'],
  ['POST /cam/team/{}/member/{}/delete', 'DELETE /cam/team/member/{}', '删成员；竞品 POST、我方 DELETE，都是移出团队（不动真实用户）'],
  ['PUT /cam/team/{}/member/{}', 'PATCH /cam/team/member/{}', '改成员角色/分组；竞品 PUT 全量、我方 PATCH 局部，字段同名'],
  ['GET /cam/team/{}/member/{}', 'GET /cam/team/member/{}', '成员详情；team 段从 token 取'],
  ['POST /cam/team/account-points-ranking', 'GET /cam/team/account-points-ranking', '积分排行是只读查询，竞品用 POST 传筛选体；我方 GET + query（同样支持 group_id/period）'],
  ['GET /cam/team/{}/member/export', 'GET /cam/team/member/export', '成员导出；team 段从 token 取，返回现签 1h 的 CSV 链接'],
  ['PUT /cam/team/{}/member/{}/name', 'PATCH /cam/team/member/{}/name', '改成员备注名；竞品 PUT、我方 PATCH'],
  ['POST /cam/team/{}/group', 'POST /cam/team/group', '建分组；team_id 从 token 取'],
  ['POST /cam/team/{}/group/{}/delete', 'DELETE /cam/team/group/{}', '删分组；竞品 POST、我方 DELETE；组内成员回到未分组而不是被删'],
  ['GET /cam/team/{}/groups', 'GET /cam/team/groups', '分组列表；竞品的 ?view= 在本域没有第二种视图，参数忽略（不影响返回形状）'],
  ['POST /cam/team/{}/group/{}/edit', 'PATCH /cam/team/group/{}', '改分组名/配额；竞品 POST、我方 PATCH'],
  ['GET /cam/team/{}/group/{}/stats', 'GET /cam/team/group/{}/stats', '分组统计（人数/积分余额）；数值字段同名'],
  ['GET /cam/team/{}/member/{}/credential', 'GET /cam/team/member/{}/credential', '成员登录凭据（给客户端拉起登录用）；team 段从 token 取'],
];

const TEAM_WAIVED: Record<string, string> = {
  'PUT /cam/team/{}/member/{}/password': 'B 类：竞品团队是「子账号」体系（管理员设密码、下属用账号密码登录）；我方团队是手机号邀请的真实用户，没有子账号也没有本地密码登录路径，只存哈希就是死代码',
  'POST /cam/team/member/batch/change-password': 'B 类：同上——无子账号密码体系，批量改密无对象；等产品口径（是否引入子账号）再定',
};

const TEAM_SHAPES: string[] = [
  ...TEAM_EXACT,
  ...TEAM_PAIRS.map(([shape]) => shape),
  ...Object.keys(TEAM_WAIVED),
];

for (const [shape, ours, reason] of PROJECT_PAIRS) {
  DEVIATIONS[shapeOf(shape)] = { ours, reason };
}
for (const [shape, reason] of Object.entries(PROJECT_WAIVED)) {
  WAIVED[shapeOf(shape)] = reason;
}
for (const [shape, ours, reason] of TEAM_PAIRS) {
  DEVIATIONS[shapeOf(shape)] = { ours, reason };
}
for (const [shape, reason] of Object.entries(TEAM_WAIVED)) {
  WAIVED[shapeOf(shape)] = reason;
}

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
  novel_market: NOVEL_MARKET_SHAPES.length,
  agent: AGENT_SHAPES.length,
  account: ACCOUNT_SHAPES.length,
  ai: AI_SHAPES.length,
  canvas: CANVAS_SHAPES.length,
  asset: ASSET_SHAPES.length,
  novel: NOVEL_SHAPES.length,
  episode: EPISODE_SHAPES.length,
  project: PROJECT_SHAPES.length,
  team: TEAM_SHAPES.length,
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
    // 第 84 批：剧本广场消费侧（`/market/*`）与 agent 任务流的两条形状（GET 保留 + POST 别名）
    expect(ROUTES.has("GET /market/scripts/config")).toBe(true);
    expect(ROUTES.has("GET /market/creator/works/{}")).toBe(true);
    expect(ROUTES.has("GET /agent/task/stream")).toBe(true);
    expect(ROUTES.has("POST /agent/task/stream")).toBe(true);
    // 第 85 批：账号/鉴权本批新补的 9 条客户端形状
    expect(ROUTES.has("POST /user-info")).toBe(true);
    expect(ROUTES.has("GET /user-settings")).toBe(true);
    expect(ROUTES.has("PUT /user-settings")).toBe(true);
    expect(ROUTES.has("GET /user/ip")).toBe(true);
    expect(ROUTES.has("GET /user/credits")).toBe(true);
    expect(ROUTES.has("GET /user/credits-log")).toBe(true);
    expect(ROUTES.has("GET /user/credits-dashboard")).toBe(true);
    expect(ROUTES.has("GET /user/credits-dashboard/flows")).toBe(true);
    expect(ROUTES.has("POST /buy/sku-price")).toBe(true);
    // 第 86 批：工具箱的 47 条覆盖全部落在这 7 个我方形状上（少一个就会有一批偏离报「ours 不存在」）
    expect(ROUTES.has("GET /generations/tools")).toBe(true);
    expect(ROUTES.has("POST /generations")).toBe(true);
    expect(ROUTES.has("GET /models")).toBe(true);
    expect(ROUTES.has("POST /assets/upload")).toBe(true);
    expect(ROUTES.has("GET /subjects/templates")).toBe(true);
    expect(ROUTES.has("POST /canvas/canvases/{}/nodes/{}/storyboard-asset-match")).toBe(true);
    expect(ROUTES.has("POST /projects/{}/episodes/{}/timeline/publish")).toBe(true);
    // 第 87 批：画布按竞品形状补的三条（单节点 / 单节点锁 / 取消钉住）
    expect(ROUTES.has("GET /canvas/canvases/{}/nodes/{}")).toBe(true);
    expect(ROUTES.has("GET /canvas/canvases/{}/nodes/{}/lock")).toBe(true);
    expect(ROUTES.has("DELETE /canvas/canvases/{}/pinned-node")).toBe(true);
    // 固定组是 pinned-timelines 的等价物（7 槽位、整体替换）
    expect(ROUTES.has("GET /canvas/canvases/{}/pin-groups")).toBe(true);
    expect(ROUTES.has("PUT /canvas/canvases/{}/pin-groups/{}")).toBe(true);
    // 第 88 批：#17 资产/主体按竞品形状补的单资源详情（其余 35 条都是结构性偏离）
    expect(ROUTES.has("GET /assets/{}")).toBe(true);
    expect(ROUTES.has("GET /subjects")).toBe(true);
    expect(ROUTES.has("GET /agent-skills")).toBe(true);
    expect(ROUTES.has("GET /canvas/templates")).toBe(true);
    // 第 90 批：#2 小说改编链按竞品形状补的 13 条单点入口（其余 89 条是前缀/结构性偏离）
    expect(ROUTES.has("GET /novel/{}/download")).toBe(true);
    expect(ROUTES.has("GET /novel/{}/script_edit_agent")).toBe(true);
    expect(ROUTES.has("POST /novel/{}/original_script/materials")).toBe(true);
    expect(ROUTES.has("GET /novel/{}/original_script/materials/{}")).toBe(true);
    expect(ROUTES.has("GET /novel/{}/original_script/characters/{}")).toBe(true);
    expect(ROUTES.has("POST /novel/{}/original_script/characters/{}/delete")).toBe(true);
    expect(ROUTES.has("POST /novel/{}/original_script/characters/batch-rename")).toBe(true);
    expect(ROUTES.has("GET /novel/{}/fission_script/summary_outline")).toBe(true);
    expect(ROUTES.has("PATCH /novel/{}/fission_script/summary_outline")).toBe(true);
    expect(ROUTES.has("POST /novel/{}/fission_script/idea")).toBe(true);
    expect(ROUTES.has("PATCH /novel/{}/fission_script/idea/{}")).toBe(true);
    expect(ROUTES.has("PATCH /novel/{}/fission_script/characters/{}")).toBe(true);
    expect(ROUTES.has("PATCH /novel/{}/original_script/episodes_outline/{}")).toBe(true);
    // 第 91 批：#3 剧集与分镜按竞品形状补的 3 条（其余 72 条里 49 条偏离、23 条无模型豁免）
    expect(ROUTES.has("GET /projects/{}/episodes/{}/storyboards/{}")).toBe(true);
    expect(ROUTES.has("POST /projects/{}/episodes/batch-delete")).toBe(true);
    expect(ROUTES.has("POST /projects/{}/episodes/{}/storyboards/batch-add")).toBe(true);
    // 第 92 批：#5 项目级导出日志两条（读取型投影，不建新表）
    expect(ROUTES.has("GET /projects/{}/exports")).toBe(true);
    expect(ROUTES.has("GET /projects/{}/exports/{}")).toBe(true);
    // #7 团队的 10 条同形形状：这几条是本组唯一「路径与竞品逐字相同」的部分，
    // 任何一条被挪走都会让 team 组的 exact 数从 10 掉下来
    expect(ROUTES.has("POST /cam/team/points-allocation")).toBe(true);
    expect(ROUTES.has("POST /cam/team/points-recovery")).toBe(true);
    expect(ROUTES.has("GET /cam/team/points-flow/list")).toBe(true);
    expect(ROUTES.has("GET /cam/team/points-flow/export")).toBe(true);
    expect(ROUTES.has("GET /cam/team/project-points-flow/list")).toBe(true);
    expect(ROUTES.has("GET /cam/team/project-points-flow/export")).toBe(true);
    expect(ROUTES.has("POST /cam/team/project-points-ranking")).toBe(true);
    expect(ROUTES.has("POST /cam/team/member/batch/status")).toBe(true);
    expect(ROUTES.has("POST /cam/team/batch-points-allocation")).toBe(true);
    expect(ROUTES.has("POST /cam/team/member/change-group")).toBe(true);
  });

  it("竞品十九组路由条数与台账口径一致（film 48 / crc 30 / op 35 / campaign 7 / kds 13 / task 17 / home 5 / share 5 / ops 18 / novel_market 29 / agent 12 / account 28 / ai 64 / canvas 114 / asset 36 / novel 102 / episode 72 / project 21 / team 29）", () => {
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
      novel_market: 29,
      agent: 12,
      account: 28,
      ai: 64,
      canvas: 114,
      asset: 36,
      novel: 102,
      episode: 72,
      project: 21,
      team: 29,
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
        OPS_MARKET_SHAPES.length +
        NOVEL_MARKET_SHAPES.length +
        AGENT_SHAPES.length +
        ACCOUNT_SHAPES.length +
        AI_SHAPES.length +
        CANVAS_SHAPES.length +
        ASSET_SHAPES.length +
        NOVEL_SHAPES.length +
        EPISODE_SHAPES.length +
        PROJECT_SHAPES.length +
        TEAM_SHAPES.length,
    ).toBe(685);
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
      novel_market: NOVEL_MARKET_SHAPES,
      agent: AGENT_SHAPES,
      account: ACCOUNT_SHAPES,
      ai: AI_SHAPES,
      canvas: CANVAS_SHAPES,
      asset: ASSET_SHAPES,
      novel: NOVEL_SHAPES,
      episode: EPISODE_SHAPES,
      project: PROJECT_SHAPES,
      team: TEAM_SHAPES,
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
  it("#12 剧本广场（消费侧）：29 条全部有等价物（前缀 df/novel_market → 我方 /market，0 缺口）", () => {
    expect(NOVEL_MARKET_SHAPES.length).toBe(29);
    expect(missing(NOVEL_MARKET_SHAPES)).toEqual([]);
    // 前缀不同，29 条全走 DEVIATIONS；但方法必须与竞品一致（这一组没有方法偏离）
    const deviated = NOVEL_MARKET_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)));
    expect(deviated.length).toBe(29);
    const sameMethod = NOVEL_MARKET_SHAPES.filter((raw) => {
      const shape = shapeOf(raw);
      return DEVIATIONS[shape]!.ours.startsWith(`${shape.split(" ")[0]} `);
    });
    expect(sameMethod.length).toBe(29);
  });

  /**
   * 第 94 批：**字段级**（query）对账。
   *
   * 为什么单列一例：本文件此前只比 METHOD + path，所以「端点全在、参数被静默丢弃」
   * 这一类故障它一个字都看不见。真实证据是 `_r94_query_all.py` 把竞品
   * `competitor_endpoints.tsv` 的 QUERY 列逐条对到我方 zod schema：
   * 消费侧 29 条里只有 **4 条带 query**，其中 `creator/works` 的 `keyword`
   * 竞品有、我方 zod 没声明 → zod 默认 strip → 返回 200 + code 0 + **未过滤全集**。
   * 管理侧同病两处（`categories`/`tags` 的 `keyword`、`promotions` 的 `enabled`）。
   *
   * 这里用**源码断言**钉住 schema 声明（守卫是纯读源码的，不起服务），
   * 行为侧由 `market.spec.ts` 的 2 例功能用例兜底 —— 两边都缺才会漏。
   */
  it("#12 剧本广场：竞品 4 条带 query 的端点，参数必须被 schema 真接住（防静默丢弃）", () => {
    const marketCtrl = readFileSync(join(API_SRC, "modules", "market", "market.controller.ts"), "utf8");
    const adminCtrl = readFileSync(join(API_SRC, "modules", "market", "market-admin.controller.ts"), "utf8");

    // ── 消费侧：`GET /creator/works` 的 keyword（第 94 批补的那一条）──
    // 注意要**限定在 works 处理器内**断言：`listScriptsQuery` 里也有一个 `keyword`，
    // 全局正则会误判通过（集市列表的 keyword 一直是对的，坏的只有创作者侧这条）。
    expect(marketCtrl).toContain("creatorWorks");
    const worksHandler = marketCtrl.slice(
      marketCtrl.indexOf("@Get(\"creator/works\")"),
      marketCtrl.indexOf("@Post(\"creator/works\")"),
    );
    expect(worksHandler.length).toBeGreaterThan(0);
    expect(worksHandler).toMatch(/keyword:\s*z\.string\(\)/);
    // 服务层必须真的把它变成 SQL 条件，而不是收了不用
    const marketSvc = readFileSync(join(API_SRC, "modules", "market", "market.service.ts"), "utf8");
    const creatorWorksBlock = marketSvc.slice(
      marketSvc.indexOf("async creatorWorks"),
      marketSvc.indexOf("async creatorWorkDetail"),
    );
    expect(creatorWorksBlock.length).toBeGreaterThan(0);
    expect(creatorWorksBlock).toContain("query.keyword");
    expect(creatorWorksBlock).toContain("ilike");

    // ── 管理侧：categories / tags 的 keyword、promotions 的 enabled ──
    expect(adminCtrl).toMatch(/categories\(@Query\(\) query: unknown\)/);
    expect(adminCtrl).toMatch(/tags\(@Query\(\) query: unknown\)/);
    expect(adminCtrl).toMatch(/promotions\(@Query\(\) query: unknown\)/);
    expect(adminCtrl).toMatch(/enabled:\s*z\.coerce\.number\(\)/);

    // `slot` 缺省时**不许**再隐式选 "market"（旧实现 `?? "market"` 让别的位查不到）
    const promotionsBlock = adminCtrl.slice(
      adminCtrl.indexOf("promotions(@Query()"),
      adminCtrl.indexOf("createPromotion("),
    );
    expect(promotionsBlock).not.toContain('"market"');

    // 推广位服务层：两个过滤条件都得变成 SQL
    const promotionsSvc = marketSvc.slice(
      marketSvc.indexOf("async adminPromotions"),
      marketSvc.indexOf("async adminCreatePromotion"),
    );
    expect(promotionsSvc).toContain("promoSlots.slot");
    expect(promotionsSvc).toContain("promoSlots.status");
    expect(promotionsSvc).toContain("query.enabled");

    /**
     * 有意**不接**的两个竞品参数，必须留在明面上（防止下一批误以为是漏接又删掉注释）：
     * - `categories` 的 `parent_id`：`market_categories` 是平表，没有该列；
     * - `tags` 的 `status`：`market_tags` 只有 name，`listTags()` 的 status 是常量投影。
     */
    expect(marketSvc).toContain("parent_id");
    expect(marketSvc).toContain("没有 `status` 列");
  });

  it("#4 创作 Agent：12 条里 8 条同形 + 1 条偏离 + 3 条豁免", () => {
    expect(AGENT_SHAPES.length).toBe(12);
    expect(missing(AGENT_SHAPES)).toEqual([]);
    const exact = AGENT_SHAPES.filter((raw) => ROUTES.has(shapeOf(raw)));
    const deviated = AGENT_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)));
    const waived = AGENT_SHAPES.filter((raw) => WAIVED_SHAPES.has(shapeOf(raw)));
    expect(exact.length).toBe(8);
    expect(deviated).toEqual(["GET /web/v1/agent/task/share/:share_id/sse"]);
    expect(waived.length).toBe(3);
    expect(exact.length + deviated.length + waived.length).toBe(AGENT_SHAPES.length);
    // `stt-token` 是**已实现**的（无 Key 时 200 + available:false），不能算豁免 —— 缺的是真实凭据，不是端点
    expect(ROUTES.has("GET /agent/stt-token")).toBe(true);
    // 那条偏离指向分享页的匿名 SSE（同一形状第 83 批已为 #26 登记过）
    expect(DEVIATIONS["GET /agent/task/share/{}/sse"]!.ours).toBe("GET /share/{}/stream");
  });

  it("#22 账号/鉴权：28 条里 9 条同形 + 11 条偏离 + 8 条豁免", () => {
    expect(ACCOUNT_SHAPES.length).toBe(28);
    expect(missing(ACCOUNT_SHAPES)).toEqual([]);
    const exact = ACCOUNT_SHAPES.filter((raw) => ROUTES.has(shapeOf(raw)));
    const deviated = ACCOUNT_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)));
    const waived = ACCOUNT_SHAPES.filter((raw) => WAIVED_SHAPES.has(shapeOf(raw)));
    expect(exact.length).toBe(9);
    expect(deviated.length).toBe(11);
    expect(waived.length).toBe(8);
    expect(exact.length + deviated.length + waived.length).toBe(ACCOUNT_SHAPES.length);
    // 同形的 9 条就是本批补的客户端形状（不是"恰好撞上"）
    expect(exact.sort()).toEqual(
      [
        "GET /web/v1/user-settings",
        "GET /web/v1/user/credits",
        "GET /web/v1/user/credits-dashboard",
        "GET /web/v1/user/credits-dashboard/flows",
        "GET /web/v1/user/credits-log",
        "GET /web/v1/user/ip",
        "POST /web/v1/buy/sku-price",
        "POST /web/v1/user-info",
        "PUT /web/v1/user-settings",
      ].sort(),
    );
    // 积分相关三条都指向空间钱包（本产品钱包挂 space，不挂 user）
    expect(DEVIATIONS[shapeOf("GET /web/v1/user-info")]!.ours).toBe("GET /me");
    expect(DEVIATIONS[shapeOf("POST /web/v1/login")]!.ours).toBe("POST /auth/login");
    // 豁免里必须是"模型/外部依赖不存在"，而不是"没做"
    expect(WAIVED[shapeOf("GET /web/v1/user/credits-dashboard/debt-list")]).toContain("balance >= 0");
    expect(WAIVED[shapeOf("GET /web/v1/weixin/token")]).toContain("appid");
  });


  it("#6 工具箱：64 条里 8 条同形（第 93 批音色库）+ 44 条结构性偏离 + 12 条范围外", () => {
    expect(AI_SHAPES.length).toBe(64);
    expect(missing(AI_SHAPES)).toEqual([]);
    const exact = AI_SHAPES.filter((raw) => ROUTES.has(shapeOf(raw)));
    const deviated = AI_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)));
    const waived = AI_SHAPES.filter((raw) => WAIVED_SHAPES.has(shapeOf(raw)));
    // 同形恰好是第 93 批落地的那 8 条音色库形状（其余 56 条仍然不是同形：
    // 生成类收敛到 POST /generations，对话/画布类由别的模块承接）
    expect(exact.map((raw) => shapeOf(raw)).sort()).toEqual(AI_IMPLEMENTED.map((raw) => shapeOf(raw)).sort());
    expect(exact.length).toBe(8);
    expect(deviated.length).toBe(44);
    expect(waived.length).toBe(12);
    expect(exact.length + deviated.length + waived.length).toBe(AI_SHAPES.length);
    // 27 条「一个工具一条路由」全部收敛到同一条生成端点
    const generic = AI_SHAPES.filter((raw) => {
      const d = DEVIATIONS[shapeOf(raw)];
      return d?.ours === "POST /generations";
    });
    expect(generic.length).toBe(27);
    // 其余 17 条由别的模块承接，且每条都要写清「为什么是那个模块」
    // （第 93 批之前是 20 条 —— 其中 3 条音色目录条目现在已经是同形真路由，见 AI_IMPLEMENTED）
    const moduleCovered = AI_SHAPES.filter((raw) => {
      const d = DEVIATIONS[shapeOf(raw)];
      return d !== undefined && d.ours !== "POST /generations";
    });
    expect(moduleCovered.length).toBe(17);
    for (const raw of moduleCovered) {
      expect(DEVIATIONS[shapeOf(raw)]!.reason.length, `reason too short: ${raw}`).toBeGreaterThan(10);
    }
    // 第 93 批落地的 8 条必须**真的**在我方路由表里，且不能再挂在豁免表上 ——
    // 只改豁免不改实现（或反之）都会让这里红
    for (const raw of AI_IMPLEMENTED) {
      expect(ROUTES.has(shapeOf(raw)), `implemented shape missing from routes: ${raw}`).toBe(true);
      expect(WAIVED[shapeOf(raw)], `implemented shape still waived: ${raw}`).toBeUndefined();
      expect(DEVIATIONS[shapeOf(raw)], `implemented shape still a deviation: ${raw}`).toBeUndefined();
    }
    // 剩下 12 条必须显式写「范围外」，而不是含糊的「暂未实现」；
    // 也不许再出现「B 类」（该我方做的都做完了，剩下的都是不该做的）
    expect(waived.length).toBe(12);
    for (const raw of waived) {
      expect(WAIVED[shapeOf(raw)]!.startsWith("范围外"), `out-of-scope gap must say so: ${raw}`).toBe(true);
    }
  });

  it("#11 无限画布：114 条里 11 条同形 + 99 条结构性偏离 + 4 条能力缺口（B 类）", () => {
    expect(CANVAS_SHAPES.length).toBe(114);
    expect(missing(CANVAS_SHAPES)).toEqual([]);
    const exact = CANVAS_SHAPES.filter((raw) => ROUTES.has(shapeOf(raw)));
    const deviated = CANVAS_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)));
    const waived = CANVAS_SHAPES.filter((raw) => WAIVED_SHAPES.has(shapeOf(raw)));
    expect(exact.length).toBe(10);
    expect(deviated.length).toBe(100);
    expect(waived.length).toBe(4);
    expect(exact.length + deviated.length + waived.length).toBe(CANVAS_SHAPES.length);
    // 同形的 10 条 = film 的 9 条画布绑定 + 数据看板的 canvas 积分（都是同名形状，不需要别名）
    expect(exact.filter((raw) => raw.includes("/film/"))).toHaveLength(9);
    expect(exact).toContain("POST /kds/da/canvas/total-point-consume");
    // 推荐卡在竞品挂在 df/canvas 前缀下，我方是 /agent-recommend-cards（登记为偏离）
    expect(DEVIATIONS["GET /df/canvas/agent-recommend-cards"]!.ours).toBe("GET /agent-recommend-cards");
    // 第 87 批按竞品形状补的三条必须真的存在（否则对应的三条偏离会报「ours 不存在」）
    for (const shape of [
      "GET /canvas/canvases/{}/nodes/{}",
      "GET /canvas/canvases/{}/nodes/{}/lock",
      "DELETE /canvas/canvases/{}/pinned-node",
    ]) {
      expect(ROUTES.has(shape), `batch 87 alias missing: ${shape}`).toBe(true);
    }
    // 四条缺口必须写「B 类」——它们是台账把 #11 从 99% 降到 99.5% 的唯一理由
    for (const raw of waived) {
      expect(WAIVED[shapeOf(raw)]!.startsWith("B 类"), `canvas gap must be honest: ${raw}`).toBe(true);
    }
    expect(waived).toEqual(
      expect.arrayContaining([
        "POST /df/canvas/{}/clip",
        "POST /df/canvas/{}/crop",
        "POST /df/canvas/{}/group-recover",
        "POST /df/canvas/{}/tpls/{}/elements/batch-create",
      ]),
    );
  });

  it("#17 资产/主体：36 条里 34 条结构性偏离 + 2 条外部输入豁免（0 缺口）", () => {
    expect(ASSET_SHAPES.length).toBe(36);
    expect(missing(ASSET_SHAPES)).toEqual([]);
    expect(ASSET_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw))).length).toBe(34);
    expect(ASSET_SHAPES.filter((raw) => WAIVED_SHAPES.has(shapeOf(raw))).length).toBe(2);
    // 本批唯一真的「按竞品形状补」的一条：单素材详情
    expect(DEVIATIONS[shapeOf("GET /asset/resource/{}/{}")]!.ours).toBe("GET /assets/{}");
    expect(ROUTES.has("GET /assets/{}")).toBe(true);
    // 两条豁免必须说清是外部输入，不能含混成「不做了」
    for (const raw of [
      "POST /asset/resource/vidu-subjects/add",
      "GET /asset/resource/vidu-subjects/{}",
    ]) {
      expect(WAIVED[shapeOf(raw)]!.startsWith("外部"), `must say external: ${raw}`).toBe(true);
    }
    // 提示词库/工作流资产这两块都不在新造端点，而是显式指向既有子系统
    expect(DEVIATIONS[shapeOf("POST /asset/prompts")]!.ours).toBe("POST /agent-skills");
    expect(DEVIATIONS[shapeOf("GET /asset/workflows")]!.ours).toBe("GET /canvas/templates");
  });

  it("#2 小说改编链：102 条竞品形状 = 0 同形 + 90 结构性偏离 + 12 条无模型豁免（本批补 13 条单点形状）", () => {
    expect(NOVEL_SHAPES.length).toBe(102);
    // 竞品 novel 全挂在 `/df/novel/*`，我方是 `/novel/*`：前缀差异本身就是一条显式偏离
    expect(NOVEL_SHAPES.filter((raw) => ROUTES.has(shapeOf(raw)))).toEqual([]);
    expect(missing(NOVEL_SHAPES)).toEqual([]);
    expect(NOVEL_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw))).length).toBe(90);
    expect(NOVEL_SHAPES.filter((raw) => WAIVED_SHAPES.has(shapeOf(raw))).length).toBe(12);
    // 90 条里有 58 条是「剥掉 /df 就同形」的纯前缀偏离，剩下的才是方法/命名/入口不同
    const prefixOnly = NOVEL_SHAPES.filter((raw) => {
      const [method, path] = shapeOf(raw).split(" ");
      return ROUTES.has(`${method} ${path!.replace(/^\/df\//, "/")}`);
    });
    expect(prefixOnly.length).toBe(58);
    // 本批补的 13 条单点形状必须真的在路由表里
    for (const ours of NOVEL_IMPLEMENTED) {
      expect(ROUTES.has(ours), `implemented shape missing: ${ours}`).toBe(true);
    }
    // 豁免必须点名缺的是哪个模型；买断/授权这一族要能一眼认出
    for (const shape of Object.keys(NOVEL_WAIVED)) {
      expect(WAIVED[shapeOf(shape)]!.length, `waiver too short: ${shape}`).toBeGreaterThan(20);
    }
    for (const shape of Object.keys(NOVEL_WAIVED).filter((s) => s.includes("/buy/"))) {
      expect(WAIVED[shapeOf(shape)]!.startsWith("B 类"), `must say B 类: ${shape}`).toBe(true);
    }
  });

  it("#3 剧集与分镜：72 条竞品形状 = 0 同形 + 49 结构性偏离 + 23 条无模型/外部豁免（本批补 3 条形状）", () => {
    expect(EPISODE_SHAPES.length).toBe(72);
    // 竞品在 `/df/episode/*`、我方在 `/projects/*`：前缀差异本身就是显式偏离，不允许 normalize 掉
    expect(EPISODE_SHAPES.filter((raw) => ROUTES.has(shapeOf(raw)))).toEqual([]);
    expect(missing(EPISODE_SHAPES)).toEqual([]);
    expect(EPISODE_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw))).length).toBe(49);
    expect(EPISODE_SHAPES.filter((raw) => WAIVED_SHAPES.has(shapeOf(raw))).length).toBe(23);
    // 本批补的 3 条形状必须真的在路由表里
    for (const ours of EPISODE_IMPLEMENTED) {
      expect(ROUTES.has(ours), `implemented shape missing: ${ours}`).toBe(true);
    }
    // 豁免只能是「缺模型」或「缺外部依赖」，且要写清是哪一类
    for (const [shape, reason] of Object.entries(EPISODE_WAIVED)) {
      expect(WAIVED[shapeOf(shape)]!.length, `waiver too short: ${shape}`).toBeGreaterThan(20);
      expect(/^(B 类|外部)：/.test(reason), `waiver must say B 类/外部: ${shape}`).toBe(true);
    }
  });

  it("#5 全部项目：21 条竞品形状 = 0 同形 + 12 结构性偏离 + 9 条无模型/外部豁免（本批补 2 条导出日志）", () => {
    expect(PROJECT_SHAPES.length).toBe(21);
    // `/df` 前缀使同形必然为 0；这条断言是防止有人给 normalize() 加 `s|^/df||`
    // 把 21 条静默变成「全覆盖」——那样 #5 会凭空满分，而代码一行没动
    expect(PROJECT_SHAPES.filter((raw) => ROUTES.has(shapeOf(raw)))).toEqual([]);
    expect(missing(PROJECT_SHAPES)).toEqual([]);
    const deviated = PROJECT_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)));
    const waived = PROJECT_SHAPES.filter((raw) => WAIVED_SHAPES.has(shapeOf(raw)));
    expect(deviated.length).toBe(12);
    expect(waived.length).toBe(9);
    // 本批补的两条必须在路由表里（不是只写在登记表里）
    for (const ours of PROJECT_IMPLEMENTED) {
      expect(ROUTES.has(ours), `implemented route missing: ${ours}`).toBe(true);
    }
    // 9 条豁免里有 6 条同一个根因（没有 source_scripts 原稿表），
    // 这条断言保证理由都点名了缺的模型，而不是「同上」两个字
    for (const raw of waived) {
      const reason = WAIVED[shapeOf(raw)]!;
      expect(reason.length, `waiver reason too short: ${raw}`).toBeGreaterThan(20);
      expect(reason).toMatch(/^(B 类|外部)：/);
    }
  });

  it("#7 团队：29 条竞品形状 = 10 同形 + 17 结构性偏离（team_id 由 token 提供）+ 2 条子账号豁免", () => {
    expect(TEAM_SHAPES.length).toBe(29);
    expect(missing(TEAM_SHAPES)).toEqual([]);
    const exact = TEAM_SHAPES.filter((raw) => ROUTES.has(shapeOf(raw)));
    const deviated = TEAM_SHAPES.filter((raw) => DEVIATED.has(shapeOf(raw)));
    const waived = TEAM_SHAPES.filter((raw) => WAIVED_SHAPES.has(shapeOf(raw)));
    // 三条数加起来正好 29：漏一条或重复登记都会红
    expect(exact.length).toBe(10);
    expect(deviated.length).toBe(17);
    expect(waived.length).toBe(2);
    // 同形的 10 条必须与 TEAM_EXACT 完全一致（顺序无关），
    // 否则说明「同形」是碰巧命中的，而不是真的逐字相同
    expect(exact.map(shapeOf).sort()).toEqual(TEAM_EXACT.map(shapeOf).sort());
    // 17 条偏离的理由都要说清「team_id 谁给」或方法差异，不能只写「前缀不同」
    for (const raw of deviated) {
      const reason = DEVIATIONS[shapeOf(raw)]!.reason;
      expect(reason.length, `deviation reason too short: ${raw}`).toBeGreaterThan(15);
    }
    // 2 条豁免是本域唯一的真缺口（子账号密码体系），必须点名「子账号」
    for (const raw of waived) {
      expect(WAIVED[shapeOf(raw)]!).toContain("子账号");
    }
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
        ...NOVEL_MARKET_SHAPES,
        ...AGENT_SHAPES,
        ...ACCOUNT_SHAPES,
        ...AI_SHAPES,
        ...CANVAS_SHAPES,
        ...ASSET_SHAPES,
        ...NOVEL_SHAPES,
        ...EPISODE_SHAPES,
        ...PROJECT_SHAPES,
        ...TEAM_SHAPES,
      ].map(shapeOf),
    );
    expect(Object.keys(DEVIATIONS).filter((shape) => !all.has(shape))).toEqual([]);
    expect(Object.keys(WAIVED).filter((shape) => !all.has(shape))).toEqual([]);
    // 豁免只在八个域开过口子：#24 任务（缺数据模型）、#4 Agent（有意不做 + 外部凭据）、
    // #22 账号（缺模型/外部依赖：邮箱通道、欠费模型、火山用量、微信签名、运行时 config）、
    // #6 工具箱（5 条音色库支撑面 + 12 条竞品其它产品面）、#2 小说（买断授权 7 + 本子级协作/权限/分发 5）、
    // #3 剧集与分镜（评论 3 + 标签组 5 + 剧本草稿 6 + 制作流程 2 + 扩展字段 2 + 异步解析 2 + 跨集批量 2 + 合成重试 1）、
    // #5 全部项目（原稿 source-scripts 一族 6 + 导出备注 1 + 制作流水 1 + 广告剧 agent 1）、
    // #7 团队（子账号密码 2：我方是手机号邀请的真实用户，无子账号体系）。
    // 以后想给别的域用，必须显式改这条断言并在台账记账。
    const waiverScope = new Set(
      [
        ...TASK_SHAPES,
        ...AGENT_SHAPES,
        ...ACCOUNT_SHAPES,
        ...AI_SHAPES,
        ...CANVAS_SHAPES,
        ...ASSET_SHAPES,
        ...NOVEL_SHAPES,
        ...EPISODE_SHAPES,
        ...PROJECT_SHAPES,
        ...TEAM_SHAPES,
      ].map(shapeOf),
    );
    expect(Object.keys(WAIVED).filter((shape) => !waiverScope.has(shape))).toEqual([]);
  });
});
