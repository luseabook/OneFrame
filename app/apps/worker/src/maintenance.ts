import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { DbHandle } from "@app/db";
import { assets, creditAccounts, creditFlows, orders, taskShares, tasks } from "@app/db";
import { creditIn } from "@app/db";

type Db = DbHandle["db"];

export interface MaintenanceLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}

export interface MaintenanceResult {
  reconciled: number;
  revived: number;
  sharesExpired: number;
  ledgerMismatch: number;
  assetsPurged: number;
  usersPurged: number;
  resultsPurged: number;
}

const MINUTE = 60_000;

/**
 * 订单对账：支付回调可能丢失（网络/渠道重试耗尽），
 * 未终态订单超过阈值后主动查单补账。
 *
 * 这里没有渠道查单 API（需商户号），因此做**本地补偿**：
 * 已标记 PAID 但缺充值流水的订单 → 补入账（幂等，靠 credit_flows.ref_order_id 去重）。
 * 真实渠道查单接入后，在 `reconcileOrders` 内增加远端查询即可。
 */
export async function reconcileOrders(db: Db, log: MaintenanceLogger, staleMinutes = 30): Promise<number> {
  const cutoff = new Date(Date.now() - staleMinutes * MINUTE);
  // 已支付但无充值流水 → 补入账
  const rows = (await db.execute(sql`
    select o.id, o.space_id, o.credits, o.sku
      from orders o
     where o.status = 2
       and not exists (select 1 from credit_flows f where f.ref_order_id = o.id)
     limit 100
  `)) as { rows?: Array<{ id: string; space_id: string; credits: number; sku: string }> };

  let reconciled = 0;
  for (const row of rows.rows ?? []) {
    try {
      await db.transaction(async (tx) => {
        await creditIn(tx, {
          spaceId: BigInt(row.space_id),
          amount: Number(row.credits),
          kind: "recharge",
          orderId: BigInt(row.id),
          memo: `reconcile ${row.sku}`,
        });
      });
      reconciled += 1;
      log.warn({ order_id: row.id, credits: row.credits }, "order reconciled (paid without credit flow)");
    } catch (err) {
      log.error({ order_id: row.id, err: String(err) }, "order reconcile failed");
    }
  }

  // 待支付超时 → 关闭（避免永久挂着）
  const closed = await db
    .update(orders)
    .set({ status: 3, closedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(orders.status, 1), lt(orders.createdAt, cutoff)))
    .returning({ id: orders.id });
  if (closed.length > 0) {
    log.info({ closed: closed.length }, "stale pending orders closed");
  }
  return reconciled;
}

/**
 * 任务看门狗：RUNNING/PENDING 超时无进展 → 置失败并解冻积分。
 *
 * 防的是「任务卡死 → 积分永久冻结」：worker 崩溃或供应商无响应时，
 * 任务停在 RUNNING，用户积分既不结算也不解冻。
 */
export async function reviveStuckTasks(db: Db, log: MaintenanceLogger, stuckMinutes = 10): Promise<number> {
  const cutoff = new Date(Date.now() - stuckMinutes * MINUTE);

  const stuck = await db
    .select({ id: tasks.id, spaceId: tasks.spaceId, frozen: tasks.creditsFrozen })
    .from(tasks)
    .where(and(inArray(tasks.status, [1, 2]), lt(tasks.updatedAt, cutoff)))
    .limit(200);

  let revived = 0;
  for (const t of stuck) {
    try {
      await db.transaction(async (tx) => {
        // 置失败
        await tx
          .update(tasks)
          .set({
            status: 4,
            error: { code: "watchdog_timeout", message: "task stuck without progress, marked failed" },
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(tasks.id, t.id), inArray(tasks.status, [1, 2])));

        // 解冻积分（frozen_delta = -cost，delta = +cost）
        if (t.frozen > 0) {
          const [account] = await tx
            .select()
            .from(creditAccounts)
            .where(eq(creditAccounts.spaceId, t.spaceId))
            .for("update");
          if (account) {
            const frozenAfter = Math.max(0, account.frozen - t.frozen);
            const balanceAfter = account.balance + t.frozen;
            await tx
              .update(creditAccounts)
              .set({ balance: balanceAfter, frozen: frozenAfter, updatedAt: new Date() })
              .where(eq(creditAccounts.spaceId, t.spaceId));
            await tx.insert(creditFlows).values({
              id: BigInt(Date.now()) * 1000n + BigInt(revived % 1000),
              spaceId: t.spaceId,
              delta: t.frozen,
              frozenDelta: -t.frozen,
              kind: "unfreeze",
              refTaskId: t.id,
              balanceAfter,
              memo: "watchdog unfreeze",
            });
          }
        }
      });
      revived += 1;
      log.warn({ task_id: String(t.id), frozen: t.frozen }, "stuck task revived");
    } catch (err) {
      log.error({ task_id: String(t.id), err: String(err) }, "revive failed");
    }
  }
  return revived;
}

/** 清理过期分享（默认 7 天过期后删除；已撤销的也一并清） */
export async function expireShares(db: Db, log: MaintenanceLogger): Promise<number> {
  const deleted = await db
    .delete(taskShares)
    .where(lt(taskShares.expiresAt, new Date()))
    .returning({ id: taskShares.id });
  if (deleted.length > 0) log.info({ expired: deleted.length }, "share tokens expired");
  return deleted.length;
}

/**
 * 资金对账：balance == Σdelta、frozen == Σfrozen_delta（PRD F6 不变式）。
 * 不平即为严重故障（资金账目错乱），必须告警。
 */
export async function auditLedger(db: Db, log: MaintenanceLogger): Promise<number> {
  const rows = (await db.execute(sql`
    select a.space_id,
           a.balance,
           a.frozen,
           coalesce(sum(f.delta), 0) as sum_delta,
           coalesce(sum(f.frozen_delta), 0) as sum_frozen_delta
      from credit_accounts a
      left join credit_flows f on f.space_id = a.space_id
     group by a.space_id, a.balance, a.frozen
    having a.balance <> coalesce(sum(f.delta), 0)
        or a.frozen <> coalesce(sum(f.frozen_delta), 0)
     limit 100
  `)) as {
    rows?: Array<{ space_id: string; balance: number; frozen: number; sum_delta: number; sum_frozen_delta: number }>;
  };

  const mismatched = rows.rows ?? [];
  for (const m of mismatched) {
    log.error(
      {
        space_id: m.space_id,
        balance: m.balance,
        sum_delta: Number(m.sum_delta),
        frozen: m.frozen,
        sum_frozen_delta: Number(m.sum_frozen_delta),
      },
      "LEDGER MISMATCH — balance/frozen does not equal flow sums",
    );
  }
  return mismatched.length;
}

/** 结果文件 90 天清理 + 回收站 7 天物理删 + 注销 30 天物理清理 */
export async function purgeOldData(db: Db, log: MaintenanceLogger): Promise<{
  resultsPurged: number;
  assetsPurged: number;
  usersPurged: number;
}> {
  const resultCutoff = new Date(Date.now() - 90 * 86_400_000);
  const cleared = await db
    .update(tasks)
    .set({ results: [], updatedAt: new Date() })
    .where(and(eq(tasks.status, 3), lt(tasks.updatedAt, resultCutoff), sql`jsonb_array_length(${tasks.results}) > 0`))
    .returning({ id: tasks.id });

  const deletedAssets = await db
    .delete(assets)
    .where(and(isNotNull(assets.deletedAt), lt(assets.deletedAt, new Date(Date.now() - 7 * 86_400_000))))
    .returning({ id: assets.id });

  const purgedUsers = await db
    .delete(tasks)
    .where(and(eq(tasks.status, 5), isNull(tasks.finishedAt), lt(tasks.updatedAt, resultCutoff)))
    .returning({ id: tasks.id });

  if (cleared.length + deletedAssets.length + purgedUsers.length > 0) {
    log.info(
      {
        results_purged: cleared.length,
        assets_purged: deletedAssets.length,
        cancelled_purged: purgedUsers.length,
      },
      "retention purge done",
    );
  }
  return { resultsPurged: cleared.length, assetsPurged: deletedAssets.length, usersPurged: purgedUsers.length };
}
