import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "@app/db";
import { creditAccounts, creditFlows, models, spaces, tasks, users } from "@app/db";
import { newId } from "@app/shared";
import { reviveStuckTasks } from "../src/maintenance";

/**
 * 任务看门狗账本安全回归（P0 修复）：
 * 解冻额度必须以 credit_flows 的 sum(frozen_delta) 为准，绝不能按 tasks.credits_frozen 凭空解冻。
 *   - 无冻结流水（从未冻结 / 已 settle / 已 unfreeze）→ 只标失败，不写流水不改账户
 *   - 存在未释放冻结 → 解冻恰好该额度（不是 credits_frozen）
 *   - 并发/已被处理（affected rows = 0）→ 跳过，不重复解冻
 */
const silent = { info: () => {}, warn: () => {}, error: () => {} };

describe("watchdog ledger safety (P0)", () => {
  const handle = createDb(process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app");
  const db = handle.db;
  let spaceId: bigint;
  let userId: bigint;
  let modelId: bigint;

  const OLD = new Date(Date.now() - 20 * 60_000);

  async function createTask(opts: { creditsFrozen: number; status?: number }): Promise<bigint> {
    const id = newId();
    await db.insert(tasks).values({
      id,
      spaceId,
      userId,
      capability: "video",
      mode: "text2video",
      modelId,
      input: { prompt: "stuck" },
      options: {},
      status: opts.status ?? 2,
      creditsFrozen: opts.creditsFrozen,
      updatedAt: OLD,
    });
    return id;
  }

  async function addFlow(opts: {
    delta: number;
    frozenDelta: number;
    kind: "gift" | "freeze" | "settle" | "unfreeze";
    taskId?: bigint;
    balanceAfter: number;
  }) {
    await db.insert(creditFlows).values({
      id: newId(),
      spaceId,
      delta: opts.delta,
      frozenDelta: opts.frozenDelta,
      kind: opts.kind,
      refTaskId: opts.taskId,
      balanceAfter: opts.balanceAfter,
      memo: `test ${opts.kind}`,
    });
  }

  async function account() {
    const [row] = await db.select().from(creditAccounts).where(eq(creditAccounts.spaceId, spaceId));
    return row!;
  }

  async function flowSums() {
    const res = (await db.execute(sql`
      select coalesce(sum(delta),0)::int as s, coalesce(sum(frozen_delta),0)::int as f
        from credit_flows where space_id = ${spaceId}
    `)) as { rows?: Array<{ s: number; f: number }> };
    return { delta: Number(res.rows?.[0]?.s ?? 0), frozen: Number(res.rows?.[0]?.f ?? 0) };
  }

  async function unfreezeCount(taskId: bigint) {
    const rows = await db
      .select()
      .from(creditFlows)
      .where(
        and(
          eq(creditFlows.spaceId, spaceId),
          eq(creditFlows.kind, "unfreeze"),
          eq(creditFlows.refTaskId, taskId),
        ),
      );
    return rows.length;
  }

  async function expectInvariant() {
    const acc = await account();
    const sums = await flowSums();
    expect(acc.balance).toBe(sums.delta);
    expect(acc.frozen).toBe(sums.frozen);
  }

  beforeAll(async () => {
    const tag = String(Date.now()).slice(-9);
    userId = BigInt(`9${tag}`);
    spaceId = BigInt(`8${tag}`);
    await db.insert(users).values({ id: userId, nickname: `watchdog-${tag}` });
    await db.insert(spaces).values({ id: spaceId, ownerUserId: userId });
    await db.insert(creditAccounts).values({ spaceId, balance: 0, frozen: 0 });
    const [model] = await db.select().from(models).limit(1);
    if (!model) throw new Error("models table empty; run seed first");
    modelId = model.id;

    // 基础流水：gift +80，账户与流水一致
    await addFlow({ delta: 80, frozenDelta: 0, kind: "gift", balanceAfter: 80 });
    await db.update(creditAccounts).set({ balance: 80, frozen: 0 }).where(eq(creditAccounts.spaceId, spaceId));
  });

  afterAll(async () => {
    await db.delete(creditFlows).where(eq(creditFlows.spaceId, spaceId));
    await db.delete(tasks).where(eq(tasks.spaceId, spaceId));
    await db.delete(creditAccounts).where(eq(creditAccounts.spaceId, spaceId));
    await db.delete(spaces).where(eq(spaces.id, spaceId));
    await db.delete(users).where(eq(users.id, userId));
    await handle.pool.end();
  });

  it("does not unfreeze a stuck task that never froze (no freeze flow)", async () => {
    const taskId = await createTask({ creditsFrozen: 10 });
    const before = await account();

    const n = await reviveStuckTasks(db, silent, 10, spaceId);
    expect(n).toBeGreaterThanOrEqual(1);

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task.status).toBe(4);
    expect((task.error as { code?: string })?.code).toBe("watchdog_timeout");

    // 账户不变、无 unfreeze 流水、不变式仍成立
    const after = await account();
    expect(after.balance).toBe(before.balance);
    expect(after.frozen).toBe(before.frozen);
    expect(await unfreezeCount(taskId)).toBe(0);
    await expectInvariant();
  });

  it("does not unfreeze twice when the task was already settled before going stuck", async () => {
    // 未释放冻结 = freeze(+6) + settle(-6) = 0
    const taskId = await createTask({ creditsFrozen: 6 });
    await addFlow({ delta: -6, frozenDelta: 6, kind: "freeze", taskId, balanceAfter: 74 });
    await addFlow({ delta: 0, frozenDelta: -6, kind: "settle", taskId, balanceAfter: 74 });
    await db.update(creditAccounts).set({ balance: 74, frozen: 0 }).where(eq(creditAccounts.spaceId, spaceId));

    const n = await reviveStuckTasks(db, silent, 10, spaceId);
    expect(n).toBeGreaterThanOrEqual(1);

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task.status).toBe(4);
    expect(await unfreezeCount(taskId)).toBe(0);

    const after = await account();
    expect(after.balance).toBe(74);
    expect(after.frozen).toBe(0);
    await expectInvariant();
  });

  it("unfreezes exactly the outstanding ledger amount (not credits_frozen)", async () => {
    // 流水未释放 8，而 tasks.credits_frozen 故意写成 20 → 只解冻 8
    const taskId = await createTask({ creditsFrozen: 20 });
    await addFlow({ delta: -8, frozenDelta: 8, kind: "freeze", taskId, balanceAfter: 66 });
    await db.update(creditAccounts).set({ balance: 66, frozen: 8 }).where(eq(creditAccounts.spaceId, spaceId));
    await expectInvariant();

    const n = await reviveStuckTasks(db, silent, 10, spaceId);
    expect(n).toBeGreaterThanOrEqual(1);

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task.status).toBe(4);

    const after = await account();
    expect(after.balance).toBe(74); // 66 + 8
    expect(after.frozen).toBe(0);
    expect(await unfreezeCount(taskId)).toBe(1);

    const [flow] = await db
      .select()
      .from(creditFlows)
      .where(and(eq(creditFlows.spaceId, spaceId), eq(creditFlows.kind, "unfreeze"), eq(creditFlows.refTaskId, taskId)));
    expect(flow.delta).toBe(8);
    expect(flow.frozenDelta).toBe(-8);
    expect(flow.balanceAfter).toBe(74);
    await expectInvariant();
  });

  it("does not double-unfreeze under concurrent watchdog runs (affected rows guard)", async () => {
    const taskId = await createTask({ creditsFrozen: 5 });
    await addFlow({ delta: -5, frozenDelta: 5, kind: "freeze", taskId, balanceAfter: 69 });
    await db.update(creditAccounts).set({ balance: 69, frozen: 5 }).where(eq(creditAccounts.spaceId, spaceId));

    const results = await Promise.all([
      reviveStuckTasks(db, silent, 10, spaceId),
      reviveStuckTasks(db, silent, 10, spaceId),
    ]);
    expect(results.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1);

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task.status).toBe(4);
    expect(await unfreezeCount(taskId)).toBe(1); // 只解冻一次

    const after = await account();
    expect(after.balance).toBe(74);
    expect(after.frozen).toBe(0);
    await expectInvariant();
  });
});
