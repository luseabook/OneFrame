import { Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { gpuAccounts, gpuJobs, gpuNodes, gpuPools, users } from "@app/db";
import { db } from "../../db/database";
import { FleetReconcileService } from "../fleet/fleet-reconcile.service";
import { FleetService } from "../fleet/fleet.service";
import { AdminGuard } from "./admin.guard";

/**
 * 运营侧机队视图（只读 + 强制关机）。
 *
 * 运营真正需要的只有三件：谁在用、花了多少、哪台机器在烧钱还没关。
 * 「代开机器」不给运营做——那是用户自己的钱，误操作成本太高。
 */
@Controller("ops/admin/compute")
@UseGuards(AdminGuard)
export class AdminFleetController {
  constructor(
    @Inject(FleetService) private readonly fleet: FleetService,
    @Inject(FleetReconcileService) private readonly reconcile: FleetReconcileService,
  ) {}

  @Get("pools")
  async pools() {
    const rows = await db
      .select({
        poolId: gpuPools.id,
        userId: gpuPools.userId,
        nickname: users.nickname,
        gpuSpec: gpuPools.gpuSpec,
        state: gpuPools.state,
        lifecycle: gpuPools.lifecycle,
        imageReady: sql<boolean>`${gpuPools.imageUuid} is not null`,
        accountStatus: gpuAccounts.status,
        tokenHint: gpuAccounts.tokenHint,
        nodes: sql<number>`(select count(*)::int from gpu_nodes n where n.pool_id = ${gpuPools.id} and n.state not in ('stopped','destroyed'))`,
        spendCents: sql<number>`(select coalesce(sum(j.cost_cents),0)::int from gpu_jobs j where j.pool_id = ${gpuPools.id})`,
      })
      .from(gpuPools)
      .innerJoin(gpuAccounts, eq(gpuAccounts.id, gpuPools.accountId))
      .leftJoin(users, eq(users.id, gpuPools.userId))
      .orderBy(desc(gpuPools.updatedAt))
      .limit(200);

    return {
      list: rows.map((r) => ({
        pool_id: String(r.poolId),
        user_id: String(r.userId),
        nickname: r.nickname ?? "",
        gpu_spec: r.gpuSpec,
        state: r.state,
        lifecycle: r.lifecycle,
        image_ready: r.imageReady,
        account_status: r.accountStatus,
        token_hint: r.tokenHint,
        active_nodes: r.nodes,
        spend_cents: r.spendCents,
      })),
    };
  }

  @Get("nodes")
  async nodes(@Query("state") state?: string) {
    const rows = await db
      .select({
        id: gpuNodes.id,
        poolId: gpuNodes.poolId,
        providerInstanceId: gpuNodes.providerInstanceId,
        state: gpuNodes.state,
        gpuSpec: gpuNodes.gpuSpec,
        costCents: gpuNodes.costAccruedCents,
        startedAt: gpuNodes.startedAt,
        lastHeartbeat: gpuNodes.lastHeartbeat,
        errorCode: gpuNodes.errorCode,
      })
      .from(gpuNodes)
      .where(state ? and(eq(gpuNodes.state, state)) : undefined)
      .orderBy(desc(gpuNodes.updatedAt))
      .limit(200);

    return {
      list: rows.map((r) => ({
        id: String(r.id),
        pool_id: String(r.poolId),
        provider_instance_id: r.providerInstanceId,
        state: r.state,
        gpu_spec: r.gpuSpec,
        cost_cents: r.costCents,
        started_at: r.startedAt ? r.startedAt.toISOString() : null,
        last_heartbeat: r.lastHeartbeat ? r.lastHeartbeat.toISOString() : null,
        error_code: r.errorCode,
      })),
    };
  }

  /** 强制关机（运营兜底；不代删实例，避免动到用户资产） */
  @Post("nodes/:id/stop")
  async stop(@Param("id") id: string) {
    const [node] = await db.select().from(gpuNodes).where(eq(gpuNodes.id, BigInt(id))).limit(1);
    if (!node) return { ok: false, reason: "not_found" };
    const [pool] = await db.select().from(gpuPools).where(eq(gpuPools.id, node.poolId)).limit(1);
    if (!pool) return { ok: false, reason: "not_found" };
    await this.fleet.stopNode(String(pool.userId), id);
    return { ok: true };
  }

  /** 孤儿实例对账：平台有、库无 → 关机；假活节点 → 标 error */
  @Post("reconcile")
  async reconcileAll() {
    return this.reconcile.reconcileAll();
  }

  @Get("spend")
  async spend() {
    const [row] = await db
      .select({
        totalCents: sql<number>`coalesce(sum(${gpuJobs.costCents}),0)::int`,
        jobs: sql<number>`count(*)::int`,
        gpuSeconds: sql<number>`coalesce(sum(${gpuJobs.gpuSeconds}),0)::int`,
      })
      .from(gpuJobs);
    return { total_cents: row?.totalCents ?? 0, jobs: row?.jobs ?? 0, gpu_seconds: row?.gpuSeconds ?? 0 };
  }
}