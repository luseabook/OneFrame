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
 * 本文件把竞品的四组路由逐条内联进来（film 48 / crc 30 / op 35 / campaign 7，
 * 来自 `_acceptance/competitor_endpoints.tsv` 的 METHOD + path，归一化去参数名），
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
 * 数字口径：四组共 120 条竞品操作。改这些数组就得同步改
 * `docs/07-plan/implement-progress-vs-reelmate.md` 里 #8 / #10 两行的「逐条对照」说法。
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
};

const EXPECTED_COUNTS: Record<string, number> = {
  film: FILM_SHAPES.length,
  crc: CRC_SHAPES.length,
  op: OP_SHAPES.length,
  campaign: CAMPAIGN_SHAPES.length,
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
  });

  it("竞品四组路由条数与台账口径一致（film 48 / crc 30 / op 35 / campaign 7）", () => {
    expect(EXPECTED_COUNTS).toEqual({ film: 48, crc: 30, op: 35, campaign: 7 });
    expect(FILM_SHAPES.length + CRC_SHAPES.length + OP_SHAPES.length + CAMPAIGN_SHAPES.length).toBe(120);
    // 去重后再数一遍：数组里不该有重复写两遍的形状（会虚增覆盖数）
    for (const [name, shapes] of Object.entries({ film: FILM_SHAPES, crc: CRC_SHAPES, op: OP_SHAPES, campaign: CAMPAIGN_SHAPES })) {
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

  it("偏离登记表没有死条目（每条都对应竞品真实形状）", () => {
    const all = new Set(
      [...FILM_SHAPES, ...CRC_SHAPES, ...OP_SHAPES, ...CAMPAIGN_SHAPES].map(shapeOf),
    );
    const dead = Object.keys(DEVIATIONS).filter((shape) => !all.has(shape));
    expect(dead).toEqual([]);
  });
});
