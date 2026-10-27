/**
 * 剧本集市（novel_market）口径常量 —— 对照竞品 `/web/v1/df/novel_market/*` 29 端点（rt:601-629）
 * 与集市 Admin `/v1/rmadminsrv/novel_market/*` 12 端点（rt:100-111）。
 *
 * 为什么常量集中在这一个文件：集市里有三类"运营会改的数"，改一处就必须全站一致——
 * 抽成比例（结算）、最低提现额（资金出口）、作品状态机（审核）。散落在 service 里
 * 会让"其中一个改了、另一个没改"变成对账事故。
 */

/**
 * 集市抽成比例（basis point，1 bp = 0.01%）。
 *
 * ⚠️ **运营未拍板，2000（= 20%）仅初值**（`completion-plan-to-100.md:264-267` 明确把
 * 「集市抽成比例与结算周期」列为第 6 批开工前必须 Owner 拍板的三件事之一）。
 * 拍板后只改这一处，`market_works.revenue_credits` 的历史值不回算——已成交的协议
 * 按成交时的比例结算，改常量只影响新成交（这就是"只记累计、不重算"的原因）。
 *
 * 竞品证据：`agreement` / `business` 端点（`routes.txt:615`、`:618`）只存在，
 * 具体比例未在路由或产物中取证 → 登记待取证（见回报「已知偏离 / 待取证」）。
 */
export const MARKET_COMMISSION_BPS = 2000;

/** 最低提现额（积分）。竞品提现门槛未取证（`routes.txt:610` 只有端点无参数），100 为初值 */
export const MARKET_MIN_WITHDRAW_CREDITS = 100;

/**
 * 作品状态机（`market_works.status`，schema.ts:2449 已定义取值域）：
 *
 * ```
 * 1 草稿 ──submit──> 2 待审 ──approve──> 3 在售 ──offline──> 5 已下架
 *                     │                  └─(有预售定金)─> 6 预售中
 *                     └─reject──> 4 已驳回 ──submit──> 2 待审
 * ```
 *
 * 不可逆点：
 * - `3/5/6 → 2` **不允许**（在售/下架/预售中的作品不能回退成待审，必须先 offline）；
 * - `4 → 3` **不允许**（驳回只能回到待审，不能直接上架——否则审核形同虚设）。
 * - 重新提交只改 status 与 audit_note 的"最近一次"值，**不删除任何历史行**
 *   （已成交的 agreement / 已产生的 withdrawal 原样保留）。
 */
export const MARKET_WORK_STATUS = {
  DRAFT: 1,
  PENDING: 2,
  ON_SALE: 3,
  REJECTED: 4,
  OFFLINE: 5,
  PREORDER: 6,
} as const;

export const MARKET_WORK_STATUS_LABEL: Record<number, string> = {
  1: "草稿",
  2: "待审核",
  3: "在售",
  4: "已驳回",
  5: "已下架",
  6: "预售中",
};

/**
 * 提现状态机（`market_withdrawals.status`，schema.ts:2505）：
 *
 * ```
 * 1 待审 ──approve──> 2 已通过 ──payout──> 3 已打款
 *   │                    └────reject────> 4 已驳回
 *   └──reject──> 4 已驳回
 * 1 待审 ──user cancel──> 5 已撤销
 * ```
 *
 * **跳步必须拒绝**：`1 → 3`（未审就打款）、`1 → 4` 以外的跳跃（如 `3 → 1`）、
 * `2 → 5`（已进入打款流程后用户不能撤销，避免"撤销后又到账"）都返回 400101。
 *
 * 不可逆：`3 已打款` 是终态（真实打款由运营在渠道侧完成，系统内不再改），
 * `4 已驳回` / `5 已撤销` 也是终态（用户可重新发起一笔**新**申请，历史行不改）。
 */
export const MARKET_WITHDRAW_STATUS = {
  PENDING: 1,
  APPROVED: 2,
  PAID: 3,
  REJECTED: 4,
  CANCELLED: 5,
} as const;

export const MARKET_WITHDRAW_STATUS_LABEL: Record<number, string> = {
  1: "待审核",
  2: "已通过",
  3: "已打款",
  4: "已驳回",
  5: "已撤销",
};

/** 协议类型（`market_agreements.kind`，schema.ts:2481）：1 购买 / 2 预售 / 3 授权 / 4 退款反向 */
export const MARKET_AGREEMENT_KIND = {
  PURCHASE: 1,
  PREORDER: 2,
  LICENSE: 3,
  REFUND: 4,
} as const;

/**
 * 审核留痕动作（`market_review_logs.action`，迁移 0030）。
 *
 * 每一条都与作品 status 的一次迁移严格对应，所以"提交/通过/驳回/下架"是**四类事实**，
 * 不是四个 UI 按钮：客诉时按 `(work_id, created_at desc)` 能还原"谁在什么时候因为什么
 * 把作品打回/下架"。`market_works.audit_note` 只保留"最后一次意见"，不再承担历史。
 */
export const MARKET_REVIEW_ACTION = {
  SUBMIT: 1,
  APPROVE: 2,
  REJECT: 3,
  OFFLINE: 4,
} as const;

export const MARKET_REVIEW_ACTION_LABEL: Record<number, string> = {
  1: "提交审核",
  2: "审核通过",
  3: "审核驳回",
  4: "下架",
};

export const MARKET_AGREEMENT_STATUS = {
  PENDING: 1,
  ACTIVE: 2,
  REFUNDED: 3,
} as const;

/**
 * 平台抽成后的创作者收益。向下取整：宁可我方少收 1 分，也不能让
 * `revenue = price - commission` 出现负数或浮点尾数（积分是整数科目）。
 */
export function commissionOf(priceCredits: number): number {
  return Math.floor((priceCredits * MARKET_COMMISSION_BPS) / 10000);
}

export function revenueOf(priceCredits: number): number {
  return priceCredits - commissionOf(priceCredits);
}
