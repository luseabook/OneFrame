/**
 * 「全部项目」的竞品分类口径（第 63 批）。
 *
 * ## 为什么要这一层
 *
 * 竞品 `GET /web/v1/df/script_project/list` 的分类不是"我方 kind"这种粗粒度形态，而是
 * **两级枚举**（`project_category` + `project_subcategory`），页面 tab 由这两级的组合反推。
 * 我方没有这两列（也不该有：我方用 `kind` + `project_mode` 表达同样的信息），
 * 但如果 API 直接拒收这两个参数，竞品形状的调用方（迁移脚本、第三方集成）就没法把
 * 筛选条件带过来。所以这里做一层**双向映射**，把两个体系对齐到一张表上。
 *
 * ## 竞品原文（`_acceptance` 外的 Vite 产物，逐字）
 *
 * `BMnzEdEX.js`（len=465）：
 * ```js
 * r = { SHORT_FILM: 1, DRAMA: 2, FILM: 3 }                       // project_category
 * R = { ALL: 0, AI_SHORT_FILM: 1, AI_AD_DRAMA: 2, AI_DRAMA: 3, VIDEO_REDRAW: 4 }  // project_subcategory
 * i = { 1: "shortFilm", 2: "drama", 3: "film" }                   // slug
 * ```
 * `D7aUDXP7.js` 的 tab 定义（每个 tab 就是一个 `category + subcategory` 组合）：
 * ```js
 * { key: DRAMA_WORKFLOW, category: DRAMA(2),        subcategory: AI_DRAMA(3) }
 * { key: CANVAS,         category: SHORT_FILM(1),   subcategory: AI_SHORT_FILM(1) }
 * { key: FILM,           category: FILM(3),         subcategory: ALL(0) }
 * { key: VIDEO_REDRAW,   category: DRAMA(2),        subcategory: VIDEO_REDRAW(4) }
 * { key: AD_DRAMA,       category: SHORT_FILM(1),   subcategory: AI_AD_DRAMA(2) }
 * ```
 * `Cp3a6_yk.js` 的 kind 推断（四条优先级）：先按 `project_category` 查
 * `{CANVAS:canvas, AI_DRAMA:drama, VIDEO_REDRAW:redraw, AD_DRAMA:ad}`，再按 `sp_source`，
 * 再按 `project_subcategory`，最后按 `project_category`。
 *
 * ## 我方对应（一张表说清）
 *
 * | 竞品 tab | category | subcategory | 我方 `kind` | 我方 `project_mode` |
 * |---|---|---|---|---|
 * | AI 剧 `DRAMA_WORKFLOW` | 2 DRAMA | 3 AI_DRAMA | workshop | 1 普通剧本 |
 * | 画布 `CANVAS` | 1 SHORT_FILM | 1 AI_SHORT_FILM | canvas | —（画布无 mode） |
 * | 广告剧 `AD_DRAMA` | 1 SHORT_FILM | 2 AI_AD_DRAMA | workshop | 2 广告剧 |
 * | 视频转绘 `VIDEO_REDRAW` | 2 DRAMA | 4 VIDEO_REDRAW | workshop | 3 视频转绘 |
 * | 影视版 `FILM` | 3 FILM | 0 ALL | **无对应** | — |
 *
 * `FILM` 档**明确不支持**：我方"影视版"是独立模块（`/film*` 端点 + 独立页面），
 * 不在 `/works` 的聚合口径里。这里返回"不可用"而不是静默忽略 —— 静默忽略会让调用方
 * 以为筛过了影视版，实际拿到的是没筛过的全集（第 62 批同一条教训）。
 */

/** 竞品 `project_category` 枚举（逐字） */
export const PROJECT_CATEGORY = {
  SHORT_FILM: 1,
  DRAMA: 2,
  FILM: 3,
} as const;

/** 竞品 `project_subcategory` 枚举（逐字） */
export const PROJECT_SUBCATEGORY = {
  ALL: 0,
  AI_SHORT_FILM: 1,
  AI_AD_DRAMA: 2,
  AI_DRAMA: 3,
  VIDEO_REDRAW: 4,
} as const;

export const PROJECT_CATEGORY_VALUES: number[] = Object.values(PROJECT_CATEGORY);
export const PROJECT_SUBCATEGORY_VALUES: number[] = Object.values(PROJECT_SUBCATEGORY);

/** category → 竞品 slug（`BMnzEdEX.js` 的 `i`） */
export const PROJECT_CATEGORY_SLUG: Record<number, string> = {
  [PROJECT_CATEGORY.SHORT_FILM]: "shortFilm",
  [PROJECT_CATEGORY.DRAMA]: "drama",
  [PROJECT_CATEGORY.FILM]: "film",
};

export function isProjectCategory(v: unknown): v is number {
  return typeof v === "number" && PROJECT_CATEGORY_VALUES.includes(v);
}

export function isProjectSubcategory(v: unknown): v is number {
  return typeof v === "number" && PROJECT_SUBCATEGORY_VALUES.includes(v);
}

/** 我方形态 + 编排模式（`script_projects.project_mode`） */
export interface WorkShape {
  kind: "workshop" | "canvas";
  /** 仅 workshop 有：1 普通剧本 / 2 广告剧 / 3 视频转绘 */
  projectMode?: number | null;
}

/**
 * 我方 → 竞品分类（写进 `/works` 每行的投影字段）。
 *
 * 画布恒为 `SHORT_FILM / AI_SHORT_FILM`（竞品 CANVAS tab 就是这个组合）；
 * 工坊按 `project_mode` 分三档；未知 mode 一律落到 AI 剧档（1 是 default，历史数据 mode 全是 1）。
 */
export function workCategoryOf(shape: WorkShape): { category: number; subcategory: number } {
  if (shape.kind === "canvas") {
    return { category: PROJECT_CATEGORY.SHORT_FILM, subcategory: PROJECT_SUBCATEGORY.AI_SHORT_FILM };
  }
  switch (Number(shape.projectMode ?? 1)) {
    case 2:
      return { category: PROJECT_CATEGORY.SHORT_FILM, subcategory: PROJECT_SUBCATEGORY.AI_AD_DRAMA };
    case 3:
      return { category: PROJECT_CATEGORY.DRAMA, subcategory: PROJECT_SUBCATEGORY.VIDEO_REDRAW };
    default:
      return { category: PROJECT_CATEGORY.DRAMA, subcategory: PROJECT_SUBCATEGORY.AI_DRAMA };
  }
}

/** 映射结果三态：可用 / 需要拒收（FILM 或非法组合） */
export type WorkCategoryFilter =
  | { ok: true; kind?: "workshop" | "canvas"; projectMode?: number }
  | { ok: false; reason: string };

/**
 * 竞品分类 → 我方筛选条件（不动数据，只把参数翻译成 `kind` / `project_mode`）。
 *
 * `subcategory` 缺省时按 `category` 推：`category=1` 到底是画布还是广告剧分不出来
 * （两者都是 SHORT_FILM）→ 只按 `kind=workshop` 之外**不加** subcategory 约束会漏画布，
 * 所以这时返回"需要 subcategory"而不是猜一个。
 */
export function workFilterOfCategory(
  category?: number,
  subcategory?: number,
): WorkCategoryFilter {
  if (category !== undefined && !isProjectCategory(category)) {
    return { ok: false, reason: `unknown project_category ${category}` };
  }
  if (subcategory !== undefined && !isProjectSubcategory(subcategory)) {
    return { ok: false, reason: `unknown project_subcategory ${subcategory}` };
  }
  if (category === PROJECT_CATEGORY.FILM) {
    return {
      ok: false,
      reason:
        "project_category=3 (FILM) has no equivalent in /works; the film module is served by the film endpoints",
    };
  }
  if (subcategory === PROJECT_SUBCATEGORY.ALL && category !== undefined) {
    // 竞品 FLIM tab 用 ALL；其他 category + ALL 等于"该大类全部"，我方只能按 kind 粗筛
    return category === PROJECT_CATEGORY.SHORT_FILM ? { ok: true, kind: "workshop" } : { ok: true };
  }
  if (subcategory !== undefined) {
    switch (subcategory) {
      case PROJECT_SUBCATEGORY.AI_SHORT_FILM:
        return { ok: true, kind: "canvas" };
      case PROJECT_SUBCATEGORY.AI_AD_DRAMA:
        return { ok: true, kind: "workshop", projectMode: 2 };
      case PROJECT_SUBCATEGORY.VIDEO_REDRAW:
        return { ok: true, kind: "workshop", projectMode: 3 };
      case PROJECT_SUBCATEGORY.AI_DRAMA:
        return { ok: true, kind: "workshop", projectMode: 1 };
      default:
        return { ok: false, reason: `unsupported project_subcategory ${subcategory}` };
    }
  }
  if (category === PROJECT_CATEGORY.SHORT_FILM) {
    // 不含 subcategory 的 SHORT_FILM 同时涵盖画布与广告剧，我方只能给"不筛"并让调用方补参数
    return {
      ok: false,
      reason: "project_category=1 alone is ambiguous (canvas vs ad drama); pass project_subcategory",
    };
  }
  if (category === PROJECT_CATEGORY.DRAMA) {
    // DRAMA 涵盖 AI 剧与视频转绘
    return { ok: true, kind: "workshop" };
  }
  return { ok: true };
}
