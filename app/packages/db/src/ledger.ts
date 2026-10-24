import { eq } from "drizzle-orm";
import { newId } from "@app/shared";
import type { Tx } from "./client";
import { creditAccounts, creditFlows } from "./schema";

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
  input: { spaceId: bigint; amount: number; kind: "refund"; orderId?: bigint; memo?: string },
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
