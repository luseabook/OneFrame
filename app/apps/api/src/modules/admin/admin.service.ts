import { Inject, Injectable } from "@nestjs/common";
import { desc, eq, sql } from "drizzle-orm";
import { adminUsers, exportJobs, modelPrices, models, taskShares, tasks, users } from "@app/db";
import { AppError, ErrorCode } from "@app/shared";
import { db } from "../../db/database";
import { QueueService } from "../../queue/queue.service";

function pageArgs(page?: number, pageSize?: number) {
  const p = Math.max(1, page ?? 1);
  const ps = Math.min(100, Math.max(1, pageSize ?? 20));
  return { page: p, pageSize: ps, offset: (p - 1) * ps };
}

@Injectable()
export class AdminService {
  constructor(@Inject(QueueService) private readonly queue: QueueService) {}

  async queues() {
    const [submit, exportJobsQueue] = await Promise.all([
      this.queue.submitQueue.getJobCounts("wait", "active", "failed", "completed", "delayed"),
      this.queue.exportQueue.getJobCounts("wait", "active", "failed", "completed", "delayed"),
    ]);
    return { "gen.submit": submit, "export.zip": exportJobsQueue };
  }

  async dashboard() {
    const [userCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    const [taskCount] = await db.select({ count: sql<number>`count(*)::int` }).from(tasks);
    const taskByStatus = await db
      .select({ status: tasks.status, count: sql<number>`count(*)::int` })
      .from(tasks)
      .groupBy(tasks.status);
    const [exportCount] = await db.select({ count: sql<number>`count(*)::int` }).from(exportJobs);
    const [activeShares] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(taskShares)
      .where(sql`${taskShares.revokedAt} is null and ${taskShares.expiresAt} > now()`);
    const [adminCount] = await db.select({ count: sql<number>`count(*)::int` }).from(adminUsers);

    return {
      users: userCount?.count ?? 0,
      admins: adminCount?.count ?? 0,
      tasks: {
        total: taskCount?.count ?? 0,
        by_status: Object.fromEntries(taskByStatus.map((row) => [String(row.status), row.count])),
      },
      exports: exportCount?.count ?? 0,
      active_shares: activeShares?.count ?? 0,
      queues: await this.queues(),
    };
  }

  async listModels() {
    const rows = await db.select().from(models).orderBy(models.sort);
    return rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      display_name: row.displayName,
      vendor: row.vendor,
      capability: row.capability,
      visible: row.visible,
      sort: row.sort,
      adapter_code: row.adapterCode,
      vip: row.needVip,
    }));
  }

  async updateModel(id: string, input: { visible?: boolean; sort?: number }) {
    const [row] = await db
      .update(models)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(models.id, BigInt(id)))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "model not found");
    return { id: String(row.id), visible: row.visible, sort: row.sort };
  }

  async listPrices(modelId?: string, page?: number, pageSize?: number) {
    const { page: p, pageSize: ps, offset } = pageArgs(page, pageSize);
    const where = modelId ? eq(modelPrices.modelId, BigInt(modelId)) : undefined;
    const rows = await db
      .select()
      .from(modelPrices)
      .where(where)
      .orderBy(modelPrices.modelId, modelPrices.mode)
      .limit(ps)
      .offset(offset);
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(modelPrices)
      .where(where);
    return {
      list: rows.map((row) => ({
        id: String(row.id),
        model_id: String(row.modelId),
        mode: row.mode,
        resolution: row.resolution,
        duration_s: row.durationS,
        credits: row.credits,
        strike_credits: row.strikeCredits,
        member_credits: row.memberCredits,
        time_limited_credits: row.timeLimitedCredits,
      })),
      total: countRow?.count ?? 0,
      page: p,
      page_size: ps,
    };
  }

  async updatePrice(
    id: string,
    input: { credits?: number; strikeCredits?: number; memberCredits?: number | null; timeLimitedCredits?: number | null },
  ) {
    const [row] = await db
      .update(modelPrices)
      .set(input)
      .where(eq(modelPrices.id, BigInt(id)))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "price not found");
    return { id: String(row.id), credits: row.credits, strike_credits: row.strikeCredits };
  }

  async listTasks(page?: number, pageSize?: number, status?: number) {
    const { page: p, pageSize: ps, offset } = pageArgs(page, pageSize);
    const where = status !== undefined ? eq(tasks.status, status) : undefined;
    const rows = await db
      .select()
      .from(tasks)
      .where(where)
      .orderBy(desc(tasks.createdAt))
      .limit(ps)
      .offset(offset);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(tasks).where(where);
    return {
      list: rows.map((row) => ({
        task_id: String(row.id),
        space_id: String(row.spaceId),
        mode: row.mode,
        status: row.status,
        credits_frozen: row.creditsFrozen,
        credits_settled: row.creditsSettled,
        created_at: row.createdAt.toISOString(),
      })),
      total: countRow?.count ?? 0,
      page: p,
      page_size: ps,
    };
  }

  async listExports(page?: number, pageSize?: number) {
    const { page: p, pageSize: ps, offset } = pageArgs(page, pageSize);
    const rows = await db
      .select()
      .from(exportJobs)
      .orderBy(desc(exportJobs.createdAt))
      .limit(ps)
      .offset(offset);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(exportJobs);
    return {
      list: rows.map((row) => ({
        export_id: String(row.id),
        space_id: String(row.spaceId),
        episode_id: String(row.episodeId),
        status: row.status,
        created_at: row.createdAt.toISOString(),
        expires_at: row.expiresAt?.toISOString() ?? null,
      })),
      total: countRow?.count ?? 0,
      page: p,
      page_size: ps,
    };
  }

  async listShares(page?: number, pageSize?: number) {
    const { page: p, pageSize: ps, offset } = pageArgs(page, pageSize);
    const rows = await db
      .select({
        id: taskShares.id,
        token: taskShares.token,
        task_id: taskShares.taskId,
        space_id: taskShares.spaceId,
        expires_at: taskShares.expiresAt,
        revoked_at: taskShares.revokedAt,
        created_at: taskShares.createdAt,
      })
      .from(taskShares)
      .orderBy(desc(taskShares.createdAt))
      .limit(ps)
      .offset(offset);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(taskShares);
    return {
      list: rows.map((row) => ({
        id: String(row.id),
        token: row.token,
        task_id: String(row.task_id),
        space_id: String(row.space_id),
        expires_at: row.expires_at.toISOString(),
        revoked_at: row.revoked_at?.toISOString() ?? null,
        created_at: row.created_at.toISOString(),
      })),
      total: countRow?.count ?? 0,
      page: p,
      page_size: ps,
    };
  }

  async revokeShare(id: string) {
    const [row] = await db
      .update(taskShares)
      .set({ revokedAt: new Date() })
      .where(eq(taskShares.id, BigInt(id)))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "share not found");
    return { ok: true };
  }
}
