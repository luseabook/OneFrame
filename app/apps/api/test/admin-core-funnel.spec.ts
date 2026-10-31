import { describe, expect, it } from "vitest";
import {
  FUNNEL_STAGE_KEYS,
  FUNNEL_STAGE_LABELS,
  computeFunnel,
  emptyFunnelStageTimestamps,
  mergeEarliest,
  mergeLatest,
  toEpochMs,
  type FunnelStageKey,
} from "../src/modules/admin/admin-funnel";

/**
 * 运营漏斗的**纯算术**单测（契约 §2.9）。
 *
 * 这组用例刻意不连 PG/Redis：漏斗最容易错的点全在"按项目合并 + 只在上游也到达的项目上算
 * 时差/转化"这类纯逻辑上，而连库 e2e 在本机跑不起来（没有 PG）。取数（SQL）由
 * `admin.service.funnel()` 负责，它只做查询 + 调这里的函数，因此这一层能被完整覆盖：
 * 除零、交集为空、首段无上游、1 位小数、时间戳倒挂（负时差）都不能靠"看 SQL"保证。
 */
const HOUR = 3_600_000;

/** 用「项目 id → 相对建项的毫秒」构造 6 段输入；只填用得到的段，其余留空 Map */
function stagesOf(entries: Partial<Record<FunnelStageKey, Record<string, number>>>) {
  const stages = emptyFunnelStageTimestamps();
  for (const key of FUNNEL_STAGE_KEYS) {
    for (const [projectId, ms] of Object.entries(entries[key] ?? {})) {
      stages[key].set(projectId, ms);
    }
  }
  return stages;
}

describe("漏斗时间戳解析", () => {
  it("接受 Date / ISO 字符串 / 数字，拒绝空值与非法串", () => {
    const date = new Date("2026-10-29T00:00:00.000Z");
    expect(toEpochMs(date)).toBe(date.getTime());
    expect(toEpochMs("2026-10-29T00:00:00.000Z")).toBe(date.getTime());
    expect(toEpochMs(1234)).toBe(1234);
    // 聚合结果为 null（例如角色定稿但没有 finalized_at）必须落成 null 而不是 0，
    // 0 会被当成"1970 年到达"，把平均耗时算成天文数字
    expect(toEpochMs(null)).toBeNull();
    expect(toEpochMs(undefined)).toBeNull();
    expect(toEpochMs("not-a-date")).toBeNull();
    expect(toEpochMs(new Date("invalid"))).toBeNull();
    expect(toEpochMs(Number.NaN)).toBeNull();
  });

  it("mergeEarliest 留最早、mergeLatest 留最晚，null 不写入", () => {
    const earliest = new Map<string, number>();
    mergeEarliest(earliest, "p1", 500);
    mergeEarliest(earliest, "p1", 300);
    mergeEarliest(earliest, "p1", 900);
    expect(earliest.get("p1")).toBe(300);
    mergeEarliest(earliest, "p2", null);
    expect(earliest.has("p2")).toBe(false);

    const latest = new Map<string, number>();
    mergeLatest(latest, "p1", 500);
    mergeLatest(latest, "p1", 900);
    mergeLatest(latest, "p1", 700);
    expect(latest.get("p1")).toBe(900);
    mergeLatest(latest, "p2", null);
    expect(latest.has("p2")).toBe(false);
  });
});

describe("漏斗 6 段结构", () => {
  it("顺序固定、label 与 key 对齐（顶层仍是数组，前端/既有测试依赖 6 项）", () => {
    const result = computeFunnel(emptyFunnelStageTimestamps());
    expect(result).toHaveLength(6);
    expect(result.map((item) => item.key)).toEqual([...FUNNEL_STAGE_KEYS]);
    expect(result.map((item) => item.label)).toEqual(FUNNEL_STAGE_KEYS.map((key) => FUNNEL_STAGE_LABELS[key]));
    // 末段从旧的「镜头成功」改成「完集」：旧口径数的是任务条数，与前面 5 段的项目数量纲不同
    expect(result[5]!.label).toBe("完集");
  });

  it("首段：count=项目数，转化/流失/上一环节时差为 null，距建项为 0", () => {
    const [projects] = computeFunnel(stagesOf({ projects: { p1: 0, p2: HOUR } }));
    expect(projects!.count).toBe(2);
    expect(projects!.conversion_from_previous).toBeNull();
    expect(projects!.dropoff_from_previous).toBeNull();
    expect(projects!.avg_hours_from_previous).toBeNull();
    expect(projects!.avg_hours_from_project_created).toBe(0);
  });

  it("没有任何项目时，首段「距建项」是 null 而不是 0（0 会被读成「瞬时完成」）", () => {
    const [projects] = computeFunnel(emptyFunnelStageTimestamps());
    expect(projects!.count).toBe(0);
    expect(projects!.avg_hours_from_project_created).toBeNull();
  });
});

describe("漏斗转化/流失/耗时口径", () => {
  it("转化率与流失率互补，且只在上一环节也有时间的项目上算时差", () => {
    const result = computeFunnel(
      stagesOf({
        // 4 个项目建项
        projects: { p1: 0, p2: 0, p3: 0, p4: 0 },
        // 2 个项目完成大纲（p1/p2，各 +2h）
        outlines: { p1: 2 * HOUR, p2: 2 * HOUR },
        // 1 个项目定稿角色（p1，+4h → 距建项 4h，距大纲 2h）
        characters: { p1: 4 * HOUR },
      }),
    );

    const [, outlines, characters] = result;
    expect(outlines!.count).toBe(2);
    expect(outlines!.conversion_from_previous).toBe(50);
    expect(outlines!.dropoff_from_previous).toBe(50);
    expect(outlines!.avg_hours_from_previous).toBe(2);
    expect(outlines!.avg_hours_from_project_created).toBe(2);

    expect(characters!.count).toBe(1);
    // 1/2 → 50%：p2 没定稿角色，所以不是 100%
    expect(characters!.conversion_from_previous).toBe(50);
    expect(characters!.dropoff_from_previous).toBe(50);
    expect(characters!.avg_hours_from_previous).toBe(2);
    expect(characters!.avg_hours_from_project_created).toBe(4);
  });

  it("时差均值保留 1 位小数（1.25h → 1.3h）", () => {
    const result = computeFunnel(
      stagesOf({
        projects: { p1: 0 },
        outlines: { p1: 1.25 * HOUR },
      }),
    );
    expect(result[1]!.avg_hours_from_previous).toBe(1.3);
    expect(result[1]!.avg_hours_from_project_created).toBe(1.3);
  });

  it("转化为小数时同样保留 1 位（1/3 → 33.3%）", () => {
    const result = computeFunnel(
      stagesOf({
        projects: { p1: 0, p2: 0, p3: 0 },
        outlines: { p1: HOUR },
      }),
    );
    expect(result[1]!.count).toBe(1);
    expect(result[1]!.conversion_from_previous).toBe(33.3);
    expect(result[1]!.dropoff_from_previous).toBe(66.7);
  });

  it("上一环节为空：转化率保持旧语义 0、流失率 100，时差为 null（不是 0）", () => {
    const result = computeFunnel(
      stagesOf({
        projects: {},
        outlines: { p1: HOUR },
      }),
    );
    // 旧实现上一环节 count=0 时返回 0，本批不改这个既有语义（页面与测试都在用）
    expect(result[1]!.conversion_from_previous).toBe(0);
    expect(result[1]!.dropoff_from_previous).toBe(100);
    // 没有任何项目同时到达两端 → 无样本，必须 null
    expect(result[1]!.avg_hours_from_previous).toBeNull();
  });

  it("上下游没有共同项目：计数照算，但时差为 null（不能拿不同项目相减）", () => {
    const result = computeFunnel(
      stagesOf({
        projects: { p1: 0 },
        outlines: { p2: 3 * HOUR },
      }),
    );
    expect(result[1]!.count).toBe(1);
    expect(result[1]!.avg_hours_from_previous).toBeNull();
    // p2 没有建项时间，所以「距建项」也无样本
    expect(result[1]!.avg_hours_from_project_created).toBeNull();
  });

  it("时间戳倒挂保留负值（夹成 0 会把数据问题伪装成健康）", () => {
    const result = computeFunnel(
      stagesOf({
        projects: { p1: 10 * HOUR },
        outlines: { p1: 5 * HOUR },
      }),
    );
    expect(result[1]!.avg_hours_from_previous).toBe(-5);
    expect(result[1]!.avg_hours_from_project_created).toBe(-5);
  });

  it("平均按「项目」而非「集」：多集项目只出一次时间差样本", () => {
    const result = computeFunnel(
      stagesOf({
        projects: { p1: 0, p2: 0 },
        // p1 两集都在 +1h 到达，合并后仍只算一次
        outlines: { p1: HOUR, p2: 3 * HOUR },
      }),
    );
    // (1 + 3) / 2 = 2 小时
    expect(result[1]!.avg_hours_from_previous).toBe(2);
  });

  it("完集段用最新时间（最后一集出片才算完集）", () => {
    const stages = stagesOf({
      projects: { p1: 0 },
      completed: { p1: 6 * HOUR },
    });
    const result = computeFunnel(stages);
    expect(result[5]!.count).toBe(1);
    expect(result[5]!.avg_hours_from_project_created).toBe(6);
    // 完集段的上一环节是"批量投递"，它为空 → 转化率 0
    expect(result[5]!.conversion_from_previous).toBe(0);
  });
});
