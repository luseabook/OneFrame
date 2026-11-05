import { eq, inArray, lt, and } from "drizzle-orm";
import { gpuAccounts, gpuNodes, gpuPools } from "@app/db";
import { db } from "../../db/database";
import { decryptSecret } from "../admin/provider-crypto";
import { AutodlProvisioner } from "./providers/autodl.provisioner";

/**
 * 孤儿实例对账（docs/02-architecture/autodl-integration.md §2.2）。
 *
 * 两种脏数据都会让用户白花钱，必须能自动收敛：
 * 1. **平台有、库没有**：create 成功但落库失败（进程崩/网络断）→ 实例在跑、我们不知道；
 * 2. **库里在 provisioning/booting/loading 超过 TTL 且无心跳**：节点其实已经挂了/被回收。
 *
 * 只处理 `oneframe-p{poolId}-` 前缀的实例——用户账号下可能有他自己的机器，绝不能碰。
 */
export interface ReconcileResult {
  checked: number;
  orphansPoweredOff: string[];
  staleMarked: number;
}

const STALE_MINUTES = 15;

export class FleetReconcileService {
  private provisioner(token: string): AutodlProvisioner {
    return new AutodlProvisioner(token);
  }

  async reconcilePool(poolId: bigint): Promise<ReconcileResult> {
    const [pool] = await db.select().from(gpuPools).where(eq(gpuPools.id, poolId)).limit(1);
    if (!pool) return { checked: 0, orphansPoweredOff: [], staleMarked: 0 };

    const [account] = await db.select().from(gpuAccounts).where(eq(gpuAccounts.id, pool.accountId)).limit(1);
    if (!account || account.status !== 1) return { checked: 0, orphansPoweredOff: [], staleMarked: 0 };

    const token = decryptSecret(account.tokenCiphertext, `gpu:${String(account.userId)}:autodl`);
    const provider = this.provisioner(token);
    const instances = await provider.listInstances(100);
    const prefix = `oneframe-p${String(pool.id)}-`;
    const mine = instances.filter((i) => i.name.startsWith(prefix));

    const dbRows = await db.select({ uuid: gpuNodes.providerInstanceId }).from(gpuNodes).where(eq(gpuNodes.poolId, pool.id));
    const known = new Set(dbRows.map((r) => r.uuid));

    const orphansPoweredOff: string[] = [];
    for (const inst of mine) {
      if (known.has(inst.uuid)) continue;
      if (!["running", "starting", "pending"].includes(inst.status)) continue;
      try {
        await provider.powerOff(inst.uuid);
        orphansPoweredOff.push(inst.uuid);
      } catch {
        // 对账是尽力而为：单台失败不能中断整轮，下一轮会再试
      }
    }

    const cutoff = new Date(Date.now() - STALE_MINUTES * 60_000);
    const stale = await db
      .update(gpuNodes)
      .set({ state: "error", errorCode: "stale_no_heartbeat", updatedAt: new Date() })
      .where(
        and(
          eq(gpuNodes.poolId, pool.id),
          inArray(gpuNodes.state, ["provisioning", "booting", "loading"]),
          lt(gpuNodes.updatedAt, cutoff),
        ),
      )
      .returning({ id: gpuNodes.id });

    return { checked: mine.length, orphansPoweredOff, staleMarked: stale.length };
  }

  /** 运营/定时任务入口：逐池对账 */
  async reconcileAll(limit = 50): Promise<{ pools: number; orphans: number; stale: number }> {
    const pools = await db.select({ id: gpuPools.id }).from(gpuPools).limit(limit);
    let orphans = 0;
    let stale = 0;
    for (const p of pools) {
      const r = await this.reconcilePool(p.id);
      orphans += r.orphansPoweredOff.length;
      stale += r.staleMarked;
    }
    return { pools: pools.length, orphans, stale };
  }
}