import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "@app/db";
import { creditAccounts, creditFlows, models, orders, skus, spaces, users, tasks } from "@app/db";
import { auditLedger, purgeOldData, reconcileOrders, reviveStuckTasks } from "../src/maintenance";

/**
 * 定时维护任务测试（deployment.md §7）
 * 重点验证资金安全相关：订单对账补账、卡死任务解冻、ledger 不平检测。
 */
const silent = { info: () => {}, warn: () => {}, error: () => {} };

describe("maintenance", () => {
  const handle = createDb(process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app");
  const db = handle.db;
  let spaceId: bigint;
  let userId: bigint;
  let skuId: bigint;
  let modelId: bigint;

  beforeAll(async () => {
    // 造一个独立 space（用随机后缀避免与其它测试冲突）
    const tag = String(Date.now()).slice(-9);
    userId = BigInt(`9${tag}`);
    spaceId = BigInt(`8${tag}`);

    await db.insert(users).values({ id: userId, nickname: `maint-${tag}` });
    await db.insert(spaces).values({ id: spaceId, ownerUserId: userId });
    await db.insert(creditAccounts).values({ spaceId, balance: 0, frozen: 0 });

    // tasks.model_id 外键指向 models（不是 skus）
    const existingModel = await db.select().from(models).limit(1);
    if (existingModel.length === 0) throw new Error("models table empty; run seed first");
    modelId = existingModel[0].id;

    // 保证有 sku
    const existing = await db.select().from(skus).limit(1);
    if (existing.length > 0) {
      skuId = existing[0].id;
    } else {
      skuId = BigInt(`7${tag}`);
      await db.insert(skus).values({
        id: skuId,
        kind: "credits",
        sku: `maint-sku-${tag}`,
        label: "test",
        priceCents: 100,
        credits: 100,
        active: true,
      });
    }
  });

  afterAll(async () => {
    await db.delete(creditFlows).where(eq(creditFlows.spaceId, spaceId));
    await db.delete(orders).where(eq(orders.spaceId, spaceId));
    await db.delete(tasks).where(eq(tasks.spaceId, spaceId));
    await db.delete(creditAccounts).where(eq(creditAccounts.spaceId, spaceId));
    await db.delete(spaces).where(eq(spaces.id, spaceId));
    await db.delete(users).where(eq(users.id, userId));
    await handle.pool.end();
  });

  it("reconciles a paid order that has no credit flow (callback lost)", async () => {
    const orderId = BigInt(`6${String(Date.now()).slice(-9)}`);
    await db.insert(orders).values({
      id: orderId,
      spaceId,
      userId,
      skuId,
      sku: "maint-test",
      amountCents: 5000,
      credits: 500,
      channel: "mock",
      channelOrderId: `cb-${orderId}`,
      status: 2, // 已支付
      paidAt: new Date(),
    });

    const before = await db.select().from(creditAccounts).where(eq(creditAccounts.spaceId, spaceId));
    expect(before[0]?.balance).toBe(0);

    const n = await reconcileOrders(db, silent, 30);
    expect(n).toBeGreaterThanOrEqual(1);

    const after = await db.select().from(creditAccounts).where(eq(creditAccounts.spaceId, spaceId));
    expect(after[0]?.balance).toBe(500);

    // 幂等：再跑一次不应重复入账
    await reconcileOrders(db, silent, 30);
    const again = await db.select().from(creditAccounts).where(eq(creditAccounts.spaceId, spaceId));
    expect(again[0]?.balance).toBe(500);
  });

  it("revives a stuck running task and unfreezes credits", async () => {
    // 初始化：账户 492/8 且与该任务已写入的 freeze 流水一致（freeze -8 / frozen_delta +8）
    await db.update(creditAccounts).set({ balance: 492, frozen: 8 }).where(eq(creditAccounts.spaceId, spaceId));

    const taskId = BigInt(`5${String(Date.now()).slice(-9)}`);
    const old = new Date(Date.now() - 20 * 60_000); // 20 分钟前，超过 10 分钟阈值
    await db.insert(tasks).values({
      id: taskId,
      spaceId,
      userId,
      capability: "video",
      mode: "text2video",
      modelId,
      input: { prompt: "stuck" },
      options: {},
      status: 2, // RUNNING
      creditsFrozen: 8,
      updatedAt: old,
    });
    await db.insert(creditFlows).values({
      id: BigInt(`5${String(Date.now()).slice(-8)}09`),
      spaceId,
      delta: -8,
      frozenDelta: 8,
      kind: "freeze",
      refTaskId: taskId,
      balanceAfter: 492,
      memo: `freeze for ${taskId}`,
    });

    const n = await reviveStuckTasks(db, silent, 10, spaceId);
    expect(n).toBeGreaterThanOrEqual(1);

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(task.status).toBe(4); // FAILED
    expect((task.error as { code?: string })?.code).toBe("watchdog_timeout");

    const [account] = await db.select().from(creditAccounts).where(eq(creditAccounts.spaceId, spaceId));
    expect(account.frozen).toBe(0); // 解冻
    expect(account.balance).toBe(500); // 退回

    // 解冻流水存在
    const flows = await db
      .select()
      .from(creditFlows)
      .where(and(eq(creditFlows.spaceId, spaceId), eq(creditFlows.kind, "unfreeze")));
    expect(flows.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps this space ledger-consistent after revive", async () => {
    const [account] = await db.select().from(creditAccounts).where(eq(creditAccounts.spaceId, spaceId));
    const rows = (await db.execute(sql`
      select coalesce(sum(delta),0)::int as s, coalesce(sum(frozen_delta),0)::int as f
        from credit_flows where space_id = ${spaceId}
    `)) as { rows?: Array<{ s: number; f: number }> };
    const sum = rows.rows?.[0];
    expect(account.balance).toBe(sum?.s ?? 0);
    expect(account.frozen).toBe(sum?.f ?? 0);
    // 全库检测仍可运行（dev 库可能存在其它历史脏数据，此处只验证返回值可用）
    expect(typeof (await auditLedger(db, silent))).toBe("number");
  });

  it("auditLedger detects a deliberate mismatch (count increases by 1)", async () => {
    const before = await auditLedger(db, silent);
    const [accountBefore] = await db.select().from(creditAccounts).where(eq(creditAccounts.spaceId, spaceId));
    await db
      .update(creditAccounts)
      .set({ balance: accountBefore.balance + 12345 })
      .where(eq(creditAccounts.spaceId, spaceId));

    const after = await auditLedger(db, silent);
    expect(after).toBe(before + 1);

    // 还原
    await db.update(creditAccounts).set({ balance: accountBefore.balance }).where(eq(creditAccounts.spaceId, spaceId));
    expect(await auditLedger(db, silent)).toBe(before);
  });

  it("purgeOldData clears 90-day-old task results", async () => {
    const taskId = BigInt(`4${String(Date.now()).slice(-9)}`);
    const old = new Date(Date.now() - 100 * 86_400_000);
    await db.insert(tasks).values({
      id: taskId,
      spaceId,
      userId,
      capability: "video",
      mode: "text2video",
modelId,      input: {},
      options: {},
      status: 3, // SUCCEEDED
      results: [{ uri: "u/old.mp4" }],
      updatedAt: old,
    });

    await purgeOldData(db, silent);

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(Array.isArray(task.results) ? (task.results as unknown[]).length : 0).toBe(0);
  });
});
