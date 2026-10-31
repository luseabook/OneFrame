/**
 * 运营漏斗口径（**纯计算，不 import 任何 db / nest 依赖**）。
 *
 * ## 为什么单独一个文件
 *
 * 漏斗最容易错的地方全在纯算术上：按项目取"最早时间"、只在上一环节也有时间的项目上
 * 算转化与时差、上一环节为空时的除零、时间戳倒挂……这些用连库 e2e 覆盖成本极高
 * （本仓约定本机没有 PG，e2e 跑不起来），而它们的输入输出都是普通 `Map<string, number>`。
 * 所以把取数（SQL）留在 `admin.service.ts`，把合并与算术放在这里，单测即可穷举边界。
 *
 * ## 口径（契约 §2.9）
 *
 * 6 个环节，每个环节对每个 `script_projects.id` 只保留**一个**时间戳
 * （outlines/characters/storyboards/batch 取最早，completed 取最晚），
 * 于是"这个项目有没有走到第 N 步"和"走到了但拖了多久"可以用同一份数据回答。
 * `count` = 该环节有时间的项目数；转化率/流失率/时差只在**上一环节也有时间**的项目上算，
 * 否则"直接跳到第 4 步"的项目会污染第 3→4 步的转化率。
 */

/** 环节顺序即响应数组顺序（前端按序渲染，现有测试依赖 `toHaveLength(6)`） */
export const FUNNEL_STAGE_KEYS = [
  "projects",
  "outlines",
  "characters",
  "storyboards",
  "batch",
  "completed",
] as const;

export type FunnelStageKey = (typeof FUNNEL_STAGE_KEYS)[number];

/**
 * 环节文案。
 *
 * 末段从旧的「镜头成功」改成「完集」：旧口径数的是**成功的任务条数**（与前面 5 段的
 * "项目数"不同量纲，6 段拼在一起看会得出"转化率 300%"这种荒谬数字）。
 * 新口径统一到项目维度，语义是"至少一集全部出片"。
 */
export const FUNNEL_STAGE_LABELS: Record<FunnelStageKey, string> = {
  projects: "建项",
  outlines: "大纲确认",
  characters: "角色定稿",
  storyboards: "分镜确认",
  batch: "批量投递",
  completed: "完集",
};

/** 每个环节的「项目 id → 到达该环节的时间（epoch ms）」 */
export type FunnelStageTimestamps = Record<FunnelStageKey, Map<string, number>>;

export interface FunnelStageItem {
  key: FunnelStageKey;
  label: string;
  /** 到达该环节的项目数（distinct project） */
  count: number;
  /** 相对上一环节的转化率（百分比，1 位小数）；首段无上一环节 → null */
  conversion_from_previous: number | null;
  /** 相对上一环节的流失率（百分比，1 位小数）= 100 - 转化率；首段 → null */
  dropoff_from_previous: number | null;
  /** 从上一环节到达本环节的平均耗时（小时，1 位小数）；首段或交集为空 → null */
  avg_hours_from_previous: number | null;
  /** 从建项到本环节的平均耗时（小时，1 位小数）；建项段本身为 0，无项目 → null */
  avg_hours_from_project_created: number | null;
}

const HOUR_MS = 3_600_000;

/** 空的时间戳集合（service 侧查完再用 merge* 填，避免每段都写一遍初始化） */
export function emptyFunnelStageTimestamps(): FunnelStageTimestamps {
  return {
    projects: new Map<string, number>(),
    outlines: new Map<string, number>(),
    characters: new Map<string, number>(),
    storyboards: new Map<string, number>(),
    batch: new Map<string, number>(),
    completed: new Map<string, number>(),
  };
}

/**
 * 把任意数据库时间值归一成 epoch ms。
 *
 * 为什么要容错：`min()`/`max()` 走的是原生 SQL，`pg` 对 `timestamptz` 会解析成 Date，
 * 但聚合结果在某些驱动/类型下会以字符串回来；这里统一收口，避免"某个环节全是 null"这种
 * 静默错（值为 null 的环节会在漏斗里直接消失成 0，很难从页面上看出是解析问题）。
 */
export function toEpochMs(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 同一项目同一环节只保留**最早**时间（"第一次到达"才是该环节的到达时刻） */
export function mergeEarliest(target: Map<string, number>, projectId: string, ms: number | null): void {
  if (ms === null) return;
  const current = target.get(projectId);
  if (current === undefined || ms < current) target.set(projectId, ms);
}

/** 同上，保留**最晚**时间（完集取"最后一集出片"的时刻） */
export function mergeLatest(target: Map<string, number>, projectId: string, ms: number | null): void {
  if (ms === null) return;
  const current = target.get(projectId);
  if (current === undefined || ms > current) target.set(projectId, ms);
}

/** 保留 1 位小数；`-0` 归一成 `0`（否则 JSON 里会出现 `-0`，前端显示成怪值） */
function round1(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** 平均小时数；样本为空 → null（不是 0，0 会把"没有共同项目"伪装成"瞬时完成"） */
function averageHours(diffs: number[]): number | null {
  if (diffs.length === 0) return null;
  const total = diffs.reduce((sum, diff) => sum + diff, 0);
  return round1(total / diffs.length / HOUR_MS);
}

/** 两个环节都到达过的项目，其时间差（ms）列表 */
function pairwiseDiffs(
  current: Map<string, number>,
  previous: Map<string, number>,
): number[] {
  const diffs: number[] = [];
  for (const [projectId, currentMs] of current) {
    const previousMs = previous.get(projectId);
    if (previousMs === undefined) continue;
    diffs.push(currentMs - previousMs);
  }
  return diffs;
}

/**
 * 把 6 段「项目 → 时间」合并成响应数组。
 *
 * 注意：负数时差**不夹到 0**。时间戳倒挂（例如 `episodes.updated_at` 被后续编辑刷新到
 * 比下游环节更晚）是真实的数据问题，夹成 0 会让它看起来"很健康"，反而查不出来；
 * 保留负值，运营/研发一眼就知道该看哪一段。
 */
export function computeFunnel(stages: FunnelStageTimestamps): FunnelStageItem[] {
  const created = stages.projects;
  return FUNNEL_STAGE_KEYS.map((key, index) => {
    const current = stages[key];
    const count = current.size;
    const previousKey = index === 0 ? null : FUNNEL_STAGE_KEYS[index - 1];
    const previous = previousKey === null ? null : stages[previousKey];

    // 首段没有"上一环节"：转化率/流失率/上一环节时差都无意义 → null（前端显示 "-"）
    if (previous === null) {
      return {
        key,
        label: FUNNEL_STAGE_LABELS[key],
        count,
        conversion_from_previous: null,
        dropoff_from_previous: null,
        avg_hours_from_previous: null,
        // 建项段"距建项"就是 0；没有任何项目时无值可算 → null
        avg_hours_from_project_created: count > 0 ? 0 : null,
      };
    }

    /**
     * 上一环节为 0 时旧实现返回 0（不是 100 也不是 null），这里**保持旧语义**：
     * 该字段既有前端页面与测试都在用，改成 null 会让"上一环节空"与"本环节空"混在一起。
     */
    const previousCount = previous.size;
    const conversion = previousCount > 0 ? round1((count / previousCount) * 100) : 0;

    return {
      key,
      label: FUNNEL_STAGE_LABELS[key],
      count,
      conversion_from_previous: conversion,
      dropoff_from_previous: round1(100 - conversion),
      avg_hours_from_previous: averageHours(pairwiseDiffs(current, previous)),
      avg_hours_from_project_created: averageHours(pairwiseDiffs(current, created)),
    };
  });
}
