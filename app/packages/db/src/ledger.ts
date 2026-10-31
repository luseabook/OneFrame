import { eq, sql } from "drizzle-orm";
import { newId } from "@app/shared";
import type { Tx } from "./client";
import { creditAccounts, creditFlows, tasks } from "./schema";

// 记账口径（docs/02-architecture/database.md §4）：
//   delta = 可用余额变动；frozen_delta = 冻结额变动
//   balance == Σdelta 且 frozen == Σfrozen_delta
// freeze: delta=-cost, frozen_delta=+cost
// settle: delta=0,    frozen_delta=-cost
// unfreeze: delta=+cost, frozen_delta=-cost

export class InsufficientBalanceError extends Error {
  constructor() {
    super("Insufficient Balance");
    this.name = "InsufficientBalanceError";
  }
}

export class CreditAccountMissingError extends Error {
  constructor() {
    super("Credit account missing");
    this.name = "CreditAccountMissingError";
  }
}

async function lockAccount(tx: Tx, spaceId: bigint) {
  const rows = await tx
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.spaceId, spaceId))
    .for("update");
  const account = rows[0];
  if (!account) throw new CreditAccountMissingError();
  return account;
}

/**
 * 显式加锁读取积分账户（REFUND §10.5）：
 * 退款流程需要「先校验余额充足，再调渠道，最后扣减」——只有在事务最前面锁住账户行，
 * 才能避免「渠道已退款、扣减时余额不足」的不可逆不一致。
 */
export async function lockCreditAccount(tx: Tx, spaceId: bigint) {
  return lockAccount(tx, spaceId);
}

export interface LedgerRef {
  taskId?: bigint;
  orderId?: bigint;
  codeId?: bigint;
  memo?: string;
}

export async function freezeCredits(
  tx: Tx,
  input: { spaceId: bigint; cost: number; taskId: bigint } & LedgerRef,
): Promise<{ balanceAfter: number; frozenAfter: number }> {
  const account = await lockAccount(tx, input.spaceId);
  if (account.balance < input.cost) throw new InsufficientBalanceError();

  const balanceAfter = account.balance - input.cost;
  const frozenAfter = account.frozen + input.cost;

  await tx
    .update(creditAccounts)
    .set({ balance: balanceAfter, frozen: frozenAfter, updatedAt: new Date() })
    .where(eq(creditAccounts.spaceId, input.spaceId));
  await tx.insert(creditFlows).values({
    id: newId(),
    spaceId: input.spaceId,
    delta: -input.cost,
    frozenDelta: input.cost,
    kind: "freeze",
    refTaskId: input.taskId,
    refOrderId: input.orderId,
    refCodeId: input.codeId,
    balanceAfter,
    memo: input.memo,
  });
  return { balanceAfter, frozenAfter };
}

export async function settleCredits(
  tx: Tx,
  input: { spaceId: bigint; cost: number; taskId: bigint; memo?: string },
): Promise<{ balanceAfter: number; frozenAfter: number }> {
  const account = await lockAccount(tx, input.spaceId);
  if (account.frozen < input.cost) throw new Error("frozen balance underflow");

  const frozenAfter = account.frozen - input.cost;
  await tx
    .update(creditAccounts)
    .set({ frozen: frozenAfter, updatedAt: new Date() })
    .where(eq(creditAccounts.spaceId, input.spaceId));
  await tx.insert(creditFlows).values({
    id: newId(),
    spaceId: input.spaceId,
    delta: 0,
    frozenDelta: -input.cost,
    kind: "settle",
    refTaskId: input.taskId,
    balanceAfter: account.balance,
    memo: input.memo,
  });
  return { balanceAfter: account.balance, frozenAfter };
}

export async function unfreezeCredits(
  tx: Tx,
  input: { spaceId: bigint; cost: number; taskId: bigint; memo?: string },
): Promise<{ balanceAfter: number; frozenAfter: number }> {
  const account = await lockAccount(tx, input.spaceId);
  if (account.frozen < input.cost) throw new Error("frozen balance underflow");

  const balanceAfter = account.balance + input.cost;
  const frozenAfter = account.frozen - input.cost;
  await tx
    .update(creditAccounts)
    .set({ balance: balanceAfter, frozen: frozenAfter, updatedAt: new Date() })
    .where(eq(creditAccounts.spaceId, input.spaceId));
  await tx.insert(creditFlows).values({
    id: newId(),
    spaceId: input.spaceId,
    delta: input.cost,
    frozenDelta: -input.cost,
    kind: "unfreeze",
    refTaskId: input.taskId,
    balanceAfter,
    memo: input.memo,
  });
  return { balanceAfter, frozenAfter };
}

/**
 * 某任务**尚未释放**的冻结额度（口径唯一来源：流水，不是 `tasks.credits_frozen`）。
 *
 * `frozen_delta` 的符号约定：freeze 为 +cost，settle / unfreeze 为 −cost，
 * 所以 `Σ frozen_delta where ref_task_id = taskId` 恰好等于「还悬着多少」。
 */
export async function taskOutstandingFrozen(tx: Tx, taskId: bigint): Promise<number> {
  const [row] = await tx
    .select({ amount: sql<number>`coalesce(sum(${creditFlows.frozenDelta}), 0)::int` })
    .from(creditFlows)
    .where(eq(creditFlows.refTaskId, taskId));
  return Number(row?.amount ?? 0);
}

export type FrozenReleaseDisposition = "settle" | "unfreeze";

/**
 * 任务终态的**唯一**冻结收尾入口（PR-03）。
 *
 * 为什么必须是一个函数：原实现有 8 处「解冻/结算」写入点，每处各自读 `tasks.creditsFrozen`
 * 决定退多少，而 `creditsFrozen` 从插入后再没被写回过 0 —— 于是「是否已释放」这个语义
 * 从未被表达，`creditsFrozen > 0` 恒真。取消过的任务会被 worker 的 `fail()` 再退一次，
 * 凭空造积分；注销账号则让冻结永久悬空且对账查不出来。
 *
 * 三条硬约束（改动前请先读完）：
 * 1. **额度按流水算，不按 `tasks.creditsFrozen` 算**。按字段算会让「已经 settle 过的任务」
 *    再退一次；极端情况下等于每次成功生成都全额退款。
 * 2. **成功后是 settle 不是 unfreeze**。赠送额度的流水是 `delta=0, frozen_delta=−N`，
 *    换成 unfreeze 会返回 `+N` 可用余额 —— 等于白拿。
 * 3. **幂等**：同一任务重复调用只生效一次（`outstanding <= 0` 时只归零字段、不写流水）。
 *    调用方因此可以无条件调用，不需要自己判断 `creditsFrozen > 0`。
 *
 * 收尾同时把 `tasks.credits_frozen` 置 0：字段的语义从此是「当前还冻结着多少」，
 * 而不是「当初冻结了多少」（后者由 `credit_flows` 与 `tasks.credits_settled` 表达）。
 * `credits_settled` 不在这里改 —— 它是「这笔实际结算了多少」的唯一记录。
 */
export async function releaseFrozen(
  tx: Tx,
  input: {
    spaceId: bigint;
    taskId: bigint;
    disposition: FrozenReleaseDisposition;
    memo?: string;
  },
): Promise<{ released: number; disposition: FrozenReleaseDisposition }> {
  const outstanding = await taskOutstandingFrozen(tx, input.taskId);

  if (outstanding > 0) {
    if (input.disposition === "settle") {
      await settleCredits(tx, {
        spaceId: input.spaceId,
        cost: outstanding,
        taskId: input.taskId,
        memo: input.memo,
      });
    } else {
      await unfreezeCredits(tx, {
        spaceId: input.spaceId,
        cost: outstanding,
        taskId: input.taskId,
        memo: input.memo,
      });
    }
  }

  // 无论是否真的退了钱，字段都要归零：outstanding<=0 表示"没有悬着的钱"，
  // 此时字段若还留着旧值，就会让 4 处 `creditsFrozen > 0` 判据继续恒真。
  await tx
    .update(tasks)
    .set({ creditsFrozen: 0, updatedAt: new Date() })
    .where(eq(tasks.id, input.taskId));

  return { released: outstanding > 0 ? outstanding : 0, disposition: input.disposition };
}

export async function creditIn(
  tx: Tx,
  input: {
    spaceId: bigint;
    amount: number;
    kind: "gift" | "recharge" | "adjust";
    orderId?: bigint;
    codeId?: bigint;
    memo?: string;
  },
): Promise<{ balanceAfter: number }> {
  const account = await lockAccount(tx, input.spaceId);
  const balanceAfter = account.balance + input.amount;
  await tx
    .update(creditAccounts)
    .set({ balance: balanceAfter, updatedAt: new Date() })
    .where(eq(creditAccounts.spaceId, input.spaceId));
  await tx.insert(creditFlows).values({
    id: newId(),
    spaceId: input.spaceId,
    delta: input.amount,
    frozenDelta: 0,
    kind: input.kind,
    refOrderId: input.orderId,
    refCodeId: input.codeId,
    balanceAfter,
    memo: input.memo,
  });
  return { balanceAfter };
}

/**
 * 扣减可用积分（负向流水，kind=refund）。用于全额退款回冲。
 *
 * 安全约束（api-spec §10.5 / database.md §4 对账不变式）：
 * - 扣减前必须在**同一事务**内锁账户并校验 `balance >= amount`，否则拒绝，
 *   绝不允许出现负余额（`credit_accounts.balance` 有 CHECK >= 0，硬失败）；
 * - 只追加流水，不更新历史流水；`balance_after` 保证链条连续。
 */
export async function creditOut(
  tx: Tx,
  input: {
    spaceId: bigint;
    amount: number;
    /**
     * 负向流水的业务来源：
     * - `refund`：退款回冲（订单/集市退款）
     * - `consume`：直接消耗（集市购买等，不经任务冻结）
     * 两者语义不同但都是"扣可用余额"，共用一个函数；**不要**把 `consume` 记成 `refund`，
     * 否则财务对账时"退款金额"会虚高。
     */
    kind: "refund" | "consume";
    orderId?: bigint;
    memo?: string;
  },
): Promise<{ balanceAfter: number }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new Error("creditOut amount must be a positive integer");
  }
  const account = await lockAccount(tx, input.spaceId);
  if (account.balance < input.amount) throw new InsufficientBalanceError();
  const balanceAfter = account.balance - input.amount;
  await tx
    .update(creditAccounts)
    .set({ balance: balanceAfter, updatedAt: new Date() })
    .where(eq(creditAccounts.spaceId, input.spaceId));
  await tx.insert(creditFlows).values({
    id: newId(),
    spaceId: input.spaceId,
    delta: -input.amount,
    frozenDelta: 0,
    kind: input.kind,
    refOrderId: input.orderId,
    balanceAfter,
    memo: input.memo,
  });
  return { balanceAfter };
}

export async function getAccount(tx: Tx, spaceId: bigint) {
  const rows = await tx.select().from(creditAccounts).where(eq(creditAccounts.spaceId, spaceId));
  return rows[0] ?? null;
}
