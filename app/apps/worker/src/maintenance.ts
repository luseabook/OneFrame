import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { DbHandle } from "@app/db";
import { assets, creditAccounts, creditFlows, extractionTasks, orders, taskShares, tasks, timelinePublications } from "@app/db";
import { creditIn } from "@app/db";
import { newId } from "@app/shared";

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
  publicationsRevived: number;
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
 *
 * 记账安全（P0 修复，2026-10-25）：解冻额度**以流水为准**——
 * 只有 `sum(credit_flows.frozen_delta) where ref_task_id = task.id > 0`
 * 才存在「未释放的冻结」，解冻恰好该额度；没有冻结流水（任务从未冻结 /
 * 已 settle / 已 unfreeze）时只标失败，绝不按 tasks.credits_frozen 凭空解冻。
 */
export async function reviveStuckTasks(
  db: Db,
  log: MaintenanceLogger,
  stuckMinutes = 10,
  /** 仅处理指定 space（运维/测试排查用）；省略时全库扫描（生产默认） */
  scopeSpaceId?: bigint,
): Promise<number> {
  const cutoff = new Date(Date.now() - stuckMinutes * MINUTE);

  const stuck = await db
    .select({ id: tasks.id, spaceId: tasks.spaceId, frozen: tasks.creditsFrozen })
    .from(tasks)
    .where(
      and(
        inArray(tasks.status, [1, 2]),
        lt(tasks.updatedAt, cutoff),
        ...(scopeSpaceId ? [eq(tasks.spaceId, scopeSpaceId)] : []),
      ),
    )
    .limit(200);

  let revived = 0;
  for (const t of stuck) {
    try {
      const claimed = await db.transaction(async (tx) => {
        // 1) 以流水为准：该任务仍未释放的冻结额度（freeze +cost / settle -cost / unfreeze -cost）
        const [flowSum] = await tx
          .select({ amount: sql<number>`coalesce(sum(${creditFlows.frozenDelta}), 0)::int` })
          .from(creditFlows)
          .where(eq(creditFlows.refTaskId, t.id));
        const outstanding = Number(flowSum?.amount ?? 0);

        // 2) 抢占状态：仅 PENDING/RUNNING → FAILED；affected=0 说明 executor/其它实例已处理
        const updated = await tx
          .update(tasks)
          .set({
            status: 4,
            error: { code: "watchdog_timeout", message: "task stuck without progress, marked failed" },
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(tasks.id, t.id), inArray(tasks.status, [1, 2])))
          .returning({ id: tasks.id });
        if (updated.length === 0) {
          log.warn(
            { task_id: String(t.id), credits_frozen: t.frozen, flow_frozen_delta: outstanding },
            "stuck task skipped (state already changed by another worker)",
          );
          return false;
        }

        // 3) 没有未释放冻结 → 只标失败：不写流水、不改账户（避免凭空造积分/双释放）
        if (outstanding <= 0) {
          // 流水里没有悬着的钱 → 字段投影也必须是 0（PR-03：该字段此前只增不减，
          // 导致「带冻结不能删任务」等 4 处判据恒真）。这里不动账户、不写流水。
          await tx.update(tasks).set({ creditsFrozen: 0 }).where(eq(tasks.id, t.id));
          log.warn(
            {
              task_id: String(t.id),
              space_id: String(t.spaceId),
              credits_frozen: t.frozen,
              flow_frozen_delta: outstanding,
            },
            "stuck task failed without unfreeze (no outstanding freeze in ledger)",
          );
          return true;
        }

        // 4) 有未释放冻结 → 解冻恰好 outstanding（不是 tasks.credits_frozen）
        const [account] = await tx
          .select()
          .from(creditAccounts)
          .where(eq(creditAccounts.spaceId, t.spaceId))
          .for("update");
        if (!account) {
          log.error(
            { task_id: String(t.id), space_id: String(t.spaceId), flow_frozen_delta: outstanding },
            "stuck task failed but credit account missing; unfreeze skipped",
          );
          return true;
        }
        // 账户值用 Math.max 兜底，流水记「实际生效」变动，保证 balance==Σdelta / frozen==Σfrozen_delta
        const balanceAfter = Math.max(0, account.balance + outstanding);
        const frozenAfter = Math.max(0, account.frozen - outstanding);
        const appliedDelta = balanceAfter - account.balance;
        const appliedFrozenDelta = frozenAfter - account.frozen;
        if (appliedDelta !== 0 || appliedFrozenDelta !== 0) {
          await tx
            .update(creditAccounts)
            .set({ balance: balanceAfter, frozen: frozenAfter, updatedAt: new Date() })
            .where(eq(creditAccounts.spaceId, t.spaceId));
          await tx.insert(creditFlows).values({
            id: newId(),
            spaceId: t.spaceId,
            delta: appliedDelta,
            frozenDelta: appliedFrozenDelta,
            kind: "unfreeze",
            refTaskId: t.id,
            balanceAfter,
            memo: `watchdog unfreeze (ledger outstanding ${outstanding})`,
          });
          // 只在实际写了流水之后归零：没写流水的分支（账户缺失/账户值未变）若也归零，
          // 会让「字段 == Σ frozen_delta」这条不变式反而被打破。
          await tx.update(tasks).set({ creditsFrozen: 0 }).where(eq(tasks.id, t.id));
        }
        log.warn(
          {
            task_id: String(t.id),
            space_id: String(t.spaceId),
            credits_frozen: t.frozen,
            flow_frozen_delta: outstanding,
            unfreezed: appliedDelta,
            balance_after: balanceAfter,
            frozen_after: frozenAfter,
          },
          "stuck task revived and unfrozen from ledger outstanding",
        );
        return true;
      });
      if (claimed) revived += 1;
    } catch (err) {
      log.error({ task_id: String(t.id), err: String(err) }, "revive failed");
    }
  }
  return revived;
}

/**
 * 发布转码看门狗（第 58 批重写判定口径）。
 *
 * ## 它防的是什么
 * 发布记录的转码可能**没有任何执行者**：API 进程在转码中途重启、worker 崩在 job 里、
 * 内联路径的 `void this.scheduleTranscode(...)` 随进程消失。记录会永久停在
 * 1（排队中）/ 2（转码中），用户看到"转码中"永远不结束。
 *
 * ## 第 58 批修掉的坑：看门狗把「队列里还排着的任务」误判成失败
 * 第 57 批把转码下沉到 `publish.transcode` 队列后，出现了这样一条真实链路：
 * worker 停机 20min（发布任务都在 Redis 里正常排队）→ 重启时 `schedule(..., runOnStart=true)`
 * 让本函数**先**跑 → 这些记录 status=1 且 `updated_at` 早已超 15min，被逐条改成 4（失败）；
 * → 随后 BullMQ 把 job 投出来，状态机一看是终态直接 `skipped` → **下沉换来的"重启可重投"
 * 被看门狗全额抵消**，而且错误文案还让用户"重新发布"。
 *
 * 所以判定必须区分三种情况，而不是只看"超时了没有"：
 * 1. **还在队列里**（waiting/delayed/active）→ 有执行者，跳过。排队久不等于坏了，
 *    worker 停机期间积压本来就是队列的正常状态；
 * 2. **不在队列、但能重投**（源产物还在）→ 重新入队，给记录一次真正的重试机会；
 * 3. **不在队列、也重投不了**（源产物已被清理 / 没配队列）→ 才判 4（失败）并写可读原因。
 *
 * 因此本函数不自己拼 SQL 判定"能不能重投"，而是由调用方注入 `hooks`：
 * worker 进程注入真队列 + 真反查（`apps/worker/src/main.ts`），单测注入假实现。
 * 不注入 hooks 时行为退化为第 57 批的原判定（超时即失败），保持既有 spec 与
 * 没有队列的部署形态（`PUBLISH_TRANSCODE_MODE=inline` 且无 worker 时）语义不变。
 */
export interface RevivePublicationHooks {
  /**
   * 一次性取回"仍被队列持有"（waiting / delayed / active / paused）的发布 id 集合。
   *
   * 为什么是整批而不是逐条查：本函数一次最多扫 200 条超时记录，逐条查队列在
   * worker 停机积压时恰好是最坏情形（队列里几百个 job × 每条都要扫一遍），
   * 会把一个 2min 的维护任务拖成分钟级。整批一次 RPC 就够。
   *
   * 抛错按"全部持有"处理 → 本轮直接放弃判定（保守：宁可晚一轮，也不误杀正在排队的）。
   */
  pendingInQueue?: () => Promise<ReadonlySet<string>>;
  /**
   * 重新入队（源 key 由实现方反查）。返回 true 表示已重投，false 表示投不了
   * （源成片已被清理 / slice 里没有 source_export_id）。
   */
  requeue?: (row: { publicationId: string; spaceId: string }) => Promise<boolean>;
}

export async function reviveStuckPublications(
  db: Db,
  log: MaintenanceLogger,
  stuckMinutes = 15,
  /** 仅处理指定 space（运维/测试排查用）；省略时全库扫描 */
  scopeSpaceId?: bigint,
  hooks: RevivePublicationHooks = {},
): Promise<number> {
  const cutoff = new Date(Date.now() - stuckMinutes * MINUTE);
  const stuck = await db
    .select({
      id: timelinePublications.id,
      spaceId: timelinePublications.spaceId,
      status: timelinePublications.status,
    })
    .from(timelinePublications)
    .where(
      and(
        inArray(timelinePublications.status, [1, 2]),
        lt(timelinePublications.updatedAt, cutoff),
        ...(scopeSpaceId ? [eq(timelinePublications.spaceId, scopeSpaceId)] : []),
      ),
    )
    .limit(200);

  // 队列持有情况一次取回。取不到就整轮不判失败 —— Redis 抖动时把正在跑的转码
  // 判成失败是不可接受的（用户会看到"重发"提示，而原任务其实还在跑）。
  let pendingIds: ReadonlySet<string> | null = null;
  if (hooks.pendingInQueue && stuck.length > 0) {
    try {
      pendingIds = await hooks.pendingInQueue();
    } catch (err) {
      log.warn({ err: String(err) }, "publication queue probe failed, skip this round");
      return 0;
    }
  }

  let revived = 0;
  let requeued = 0;
  let pending = 0;
  for (const row of stuck) {
    const publicationId = String(row.id);
    try {
      // ① 还在队列里 → 有执行者，本轮不碰它。排队久不等于坏了：
      //    worker 停机期间任务积压本来就是队列的正常状态。
      if (pendingIds?.has(publicationId)) {
        pending += 1;
        continue;
      }

      // ② 不在队列 → 尝试重投（第 58 批核心：先救，再判死）
      if (hooks.requeue) {
        let requeuedOk = false;
        try {
          requeuedOk = await hooks.requeue({ publicationId, spaceId: String(row.spaceId) });
        } catch (err) {
          log.warn({ publication_id: publicationId, err: String(err) }, "publication requeue failed");
          requeuedOk = false;
        }
        if (requeuedOk) {
          // 重投成功：把 updated_at 推到当前，给新任务一个完整的 stuckMinutes 窗口。
          // 否则下一轮（2min 后）它仍然是"超时"状态，排查时看不出"这一轮已经救过了"；
          // 且新任务自己也可能会被别的维护路径当成陈旧记录。
          await db
            .update(timelinePublications)
            .set({ updatedAt: new Date() })
            .where(
              and(eq(timelinePublications.id, row.id), inArray(timelinePublications.status, [1, 2])),
            );
          requeued += 1;
          continue;
        }
      }

      // ③ 救不了 → 判失败。抢占式更新：只有仍是 1/2 且仍超时的那一行会被改，
      // 避免和正在跑的轮询/发布互相覆盖。
      const updated = await db
        .update(timelinePublications)
        .set({
          status: 4,
          error: {
            code: "transcode_stalled",
            message: hooks.requeue
              ? "转码超时且无法自动重试（源成片可能已被清理）。请在剪辑台重新导出并发布该切片。"
              : "转码未在预期时间内完成（服务可能重启）。请在剪辑台重新发布该切片。",
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(timelinePublications.id, row.id),
            inArray(timelinePublications.status, [1, 2]),
            lt(timelinePublications.updatedAt, cutoff),
          ),
        )
        .returning({ id: timelinePublications.id });
      if (updated.length > 0) revived += 1;
    } catch (err) {
      log.error({ publication_id: publicationId, err: String(err) }, "revive publication failed");
    }
  }
  if (revived > 0) log.warn({ revived }, "stuck publications marked failed");
  if (requeued > 0) log.warn({ requeued }, "stuck publications requeued");
  if (pending > 0) log.info({ pending }, "stuck publications still pending in queue (skipped)");
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
 *
 * 返回**真实不平的空间总数**，而不是"打出来的日志条数"。
 *
 * 为什么改：原实现把 `limit 100` 同时当日志上限和返回值，一旦历史脏数据超过 100 个
 * （dev 库积累测试残留后很容易超过），返回值被钉死在 100 —— 对账口径失真，
 * 运维看到"恰好 100 个"会和"只有 100 个"混淆，告警也就失去意义。
 * 现在拆成两步：先 count 出真实总数，再取前 100 条打日志（日志量大时截断但要说明）。
 */
/** 单次对账最多打多少条明细日志（总数不受此限制） */
const LEDGER_LOG_LIMIT = 100;

export async function auditLedger(
  db: Db,
  log: MaintenanceLogger,
  scope?: { spaceId?: bigint },
): Promise<number> {
  // 可选作用域：定时任务走全库，测试与排障按单个 space 精确对账。
  // 没有作用域时全局统计会被并发写入（同时在跑的另一套 API/worker、dev 库历史残留）干扰，
  // 断言"总数 +1"这类用例因此天然不稳定；带上 spaceId 后同一断言是确定性的。
  const scopeFilter = scope?.spaceId !== undefined ? sql`where a.space_id = ${scope.spaceId}` : sql``;
  const rows = (await db.execute(sql`
    with mismatch as (
      select a.space_id,
             a.balance,
             a.frozen,
             coalesce(sum(f.delta), 0) as sum_delta,
             coalesce(sum(f.frozen_delta), 0) as sum_frozen_delta
        from credit_accounts a
        left join credit_flows f on f.space_id = a.space_id
        ${scopeFilter}
       group by a.space_id, a.balance, a.frozen
      having a.balance <> coalesce(sum(f.delta), 0)
          or a.frozen <> coalesce(sum(f.frozen_delta), 0)
    )
    select *, count(*) over () as total from mismatch order by space_id limit ${LEDGER_LOG_LIMIT}
  `)) as {
    rows?: Array<{
      space_id: string;
      balance: number;
      frozen: number;
      sum_delta: number;
      sum_frozen_delta: number;
      total: string | number;
    }>;
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

  // 没有明细行 = 没有不平；有明细行时 total 是窗口函数算的全量计数
  const total = mismatched.length === 0 ? 0 : Number(mismatched[0]!.total);
  if (total > mismatched.length) {
    log.error(
      { total, logged: mismatched.length, limit: LEDGER_LOG_LIMIT },
      "LEDGER MISMATCH — 明细已截断，实际不平空间数见 total",
    );
  }
  return total;
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

  // 物理清理回收站资产前先断开抽取任务对它的引用：`extraction_tasks.source_asset_id`
  // 是无级联的 RESTRICT 外键，直接删资产会让整轮清理卡在 FK 上（dev 库有历史抽取记录即复现）。
  // 置空而不是删任务：抽取历史仍可追溯（source_uri 尚在）。
  const staleAssetIds = db
    .select({ id: assets.id })
    .from(assets)
    .where(and(isNotNull(assets.deletedAt), lt(assets.deletedAt, new Date(Date.now() - 7 * 86_400_000))));

  await db
    .update(extractionTasks)
    .set({ sourceAssetId: null })
    .where(inArray(extractionTasks.sourceAssetId, staleAssetIds));

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
