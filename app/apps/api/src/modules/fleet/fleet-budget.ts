/**
 * 预算闸的纯函数部分（不碰 DB，便于单测）。
 *
 * 设计原则：用户的钱比我们的钱更难花——「忘了关机烧了 800 块」一次客诉就足以让这个功能死掉。
 * 所以三闸（单任务 / 单日 / 月度）都返回**明确原因**，前端要能告诉用户"是哪一闸挡住了"，
 * 而不是笼统的"余额不足"。
 */
export type BudgetBlockReason = "daily" | "monthly";

export interface BudgetCheck {
  allowed: boolean;
  reason?: BudgetBlockReason;
  dailyRemainingCents: number;
  monthlyRemainingCents: number;
}

export function checkBudget(args: {
  spentTodayCents: number;
  spentMonthCents: number;
  dailyBudgetCents: number;
  monthlyBudgetCents: number;
  /** 本次预计花费（分）；0 表示只查余额不预占 */
  estimateCents?: number;
}): BudgetCheck {
  const estimate = Math.max(0, args.estimateCents ?? 0);
  const dailyRemainingCents = Math.max(0, args.dailyBudgetCents - args.spentTodayCents);
  const monthlyRemainingCents = Math.max(0, args.monthlyBudgetCents - args.spentMonthCents);

  if (estimate > 0 && estimate > dailyRemainingCents) {
    return { allowed: false, reason: "daily", dailyRemainingCents, monthlyRemainingCents };
  }
  if (estimate > 0 && estimate > monthlyRemainingCents) {
    return { allowed: false, reason: "monthly", dailyRemainingCents, monthlyRemainingCents };
  }
  return { allowed: true, dailyRemainingCents, monthlyRemainingCents };
}

/** 按小时价与分钟数折算分（向上取整，宁可多算不漏算） */
export function estimateCostCents(hourlyPriceCents: number, minutes: number): number {
  if (hourlyPriceCents <= 0 || minutes <= 0) return 0;
  return Math.ceil((hourlyPriceCents * minutes) / 60);
}

/**
 * 冷启动摊销：一次开机固定花掉 `bootMinutes`，按批内条数摊。
 * 用于「单条随开随关 vs 批量」的提示文案（autodl-integration.md §5.4）。
 */
export function coldStartCostPerClipCents(args: {
  hourlyPriceCents: number;
  bootMinutes: number;
  clipsPerBatch: number;
}): number {
  const batch = Math.max(1, args.clipsPerBatch);
  return Math.ceil(estimateCostCents(args.hourlyPriceCents, args.bootMinutes) / batch);
}