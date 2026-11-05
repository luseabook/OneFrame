import { describe, expect, it } from "vitest";
import { checkBudget, coldStartCostPerClipCents, estimateCostCents } from "./fleet-budget";

describe("fleet-budget：三闸", () => {
  it("在预算内放行，并给出两条剩余额度", () => {
    const out = checkBudget({
      spentTodayCents: 1200,
      spentMonthCents: 4000,
      dailyBudgetCents: 5000,
      monthlyBudgetCents: 50000,
      estimateCents: 300,
    });
    expect(out.allowed).toBe(true);
    expect(out.dailyRemainingCents).toBe(3800);
    expect(out.monthlyRemainingCents).toBe(46000);
  });

  it("日预算触顶返回 daily，而不是笼统的余额不足", () => {
    const out = checkBudget({
      spentTodayCents: 4950,
      spentMonthCents: 5000,
      dailyBudgetCents: 5000,
      monthlyBudgetCents: 50000,
      estimateCents: 200,
    });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe("daily");
  });

  it("月预算先于日预算触顶时返回 monthly", () => {
    const out = checkBudget({
      spentTodayCents: 0,
      spentMonthCents: 49_900,
      dailyBudgetCents: 5000,
      monthlyBudgetCents: 50_000,
      estimateCents: 500,
    });
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe("monthly");
  });

  it("estimate 为 0 时只查余额不预占（用于首页展示）", () => {
    const out = checkBudget({
      spentTodayCents: 5000,
      spentMonthCents: 0,
      dailyBudgetCents: 5000,
      monthlyBudgetCents: 50000,
    });
    expect(out.allowed).toBe(true);
    expect(out.dailyRemainingCents).toBe(0);
  });
});

describe("fleet-budget：成本换算", () => {
  it("按小时价折算分钟，向上取整", () => {
    expect(estimateCostCents(198, 5)).toBe(17); // ¥1.98/h × 5min ≈ ¥0.165
    expect(estimateCostCents(198, 0)).toBe(0);
    expect(estimateCostCents(0, 30)).toBe(0);
  });

  it("冷启动按批摊：一批 20 条时几乎可忽略", () => {
    const perClip = coldStartCostPerClipCents({ hourlyPriceCents: 198, bootMinutes: 5, clipsPerBatch: 20 });
    expect(perClip).toBe(1); // 17 分 ÷ 20 → 1 分/条
  });
});