import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  adminUsers,
  contentReports,
  episodes,
  exportJobs,
  modelPrices,
  models,
  orders,
  projectAssets,
  scriptProjects,
  storyboards,
  taskShares,
  tasks,
  users,
} from "@app/db";
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
    const [pendingReports] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(contentReports)
      .where(eq(contentReports.status, 1));

    return {
      users: userCount?.count ?? 0,
      admins: adminCount?.count ?? 0,
      tasks: {
        total: taskCount?.count ?? 0,
        by_status: Object.fromEntries(taskByStatus.map((row) => [String(row.status), row.count])),
      },
      exports: exportCount?.count ?? 0,
      active_shares: activeShares?.count ?? 0,
      pending_reports: pendingReports?.count ?? 0,
      queues: await this.queues(),
    };
  }

  // 任务指标（PRD F8）：失败率 + adapter 延迟（task.running → task.succeeded/failed）
  async taskMetrics() {
    const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(tasks);
    const [succeeded] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.status, 3));
    const [failed] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(sql`${tasks.status} in (4, 7)`);
    const [canceled] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.status, 5));
    const finished = (succeeded?.count ?? 0) + (failed?.count ?? 0);

    // adapter 延迟：按 adapter_code 聚合 created_at→finished_at 的平均耗时
    const latencyResult = await db.execute(sql`
      select m.adapter_code as adapter,
             count(*)::int as samples,
             round(avg(extract(epoch from (t.finished_at - t.created_at))) * 1000)::int as avg_ms,
             round(percentile_cont(0.95) within group (order by extract(epoch from (t.finished_at - t.created_at))) * 1000)::int as p95_ms
      from tasks t
      join models m on m.id = t.model_id
      where t.finished_at is not null
      group by m.adapter_code
      order by avg_ms desc
    `);
    const latencyRows = (latencyResult as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? [];

    const errorByCode = await db
      .select({ code: sql<string>`coalesce(${tasks.error}->>'code','unknown')`, count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(sql`${tasks.status} in (4, 7)`)
      .groupBy(sql`coalesce(${tasks.error}->>'code','unknown')`)
      .orderBy(desc(sql`count(*)`));

    return {
      total: total?.count ?? 0,
      succeeded: succeeded?.count ?? 0,
      failed: failed?.count ?? 0,
      canceled: canceled?.count ?? 0,
      failure_rate: finished > 0 ? Math.round((failed!.count / finished) * 1000) / 10 : 0,
      adapter_latency: latencyRows.map((row) => ({
        adapter: String(row.adapter ?? ""),
        samples: Number(row.samples ?? 0),
        avg_ms: Number(row.avg_ms ?? 0),
        p95_ms: Number(row.p95_ms ?? 0),
      })),
      errors_by_code: errorByCode.map((row) => ({ code: row.code, count: row.count })),
    };
  }

  // 失败任务清单导出（CSV）
  async failedTasksCsv() {
    const rows = await db
      .select()
      .from(tasks)
      .where(sql`${tasks.status} in (4, 7)`)
      .orderBy(desc(tasks.updatedAt))
      .limit(1000);
    const header = "task_id,space_id,model,mode,status,error_code,error_message,created_at,finished_at";
    const escape = (value: unknown): string => {
      const text = value === null || value === undefined ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = rows.map((row) =>
      [
        String(row.id),
        String(row.spaceId),
        String(row.modelId),
        row.mode,
        row.status,
        escape((row.error as { code?: unknown } | null)?.code ?? ""),
        escape((row.error as { message?: unknown } | null)?.message ?? ""),
        row.createdAt.toISOString(),
        row.finishedAt ? row.finishedAt.toISOString() : "",
      ].join(","),
    );
    return `${header}\n${lines.join("\n")}\n`;
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

  /** 订单列表（api-spec §10.5）：运营按状态查单、核对退款留痕 */
  async listOrders(page?: number, pageSize?: number, status?: number) {
    const { page: p, pageSize: ps, offset } = pageArgs(page, pageSize);
    const where = status !== undefined ? eq(orders.status, status) : undefined;
    const rows = await db
      .select()
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(ps)
      .offset(offset);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(orders).where(where);
    return {
      list: rows.map((row) => ({
        order_id: String(row.id),
        space_id: String(row.spaceId),
        user_id: String(row.userId),
        sku: row.sku,
        amount_cents: row.amountCents,
        credits: row.credits,
        channel: row.channel,
        status: row.status,
        paid_at: row.paidAt?.toISOString() ?? null,
        refund_no: row.refundNo,
        refund_status: row.refundStatus,
        refund_amount_cents: row.refundAmountCents,
        refunded_at: row.refundedAt?.toISOString() ?? null,
        refund_reason: row.refundReason,
        refund_operator: row.refundOperator,
        created_at: row.createdAt.toISOString(),
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

  // 流水线漏斗（PRD F8）：建项→大纲→角色定稿→分镜→批量→成功
  async funnel() {
    const [projects] = await db.select({ count: sql<number>`count(*)::int` }).from(scriptProjects);
    const [outlines] = await db
      .select({ count: sql<number>`count(distinct ${episodes.projectId})::int` })
      .from(episodes)
      .where(eq(episodes.status, 2));
    const [characters] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(projectAssets)
      .where(and(eq(projectAssets.kind, "character"), eq(projectAssets.status, 2)));
    const [shots] = await db.select({ count: sql<number>`count(*)::int` }).from(storyboards);
    const [batch] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.mode, "universal_reference"));
    const [succeeded] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(eq(tasks.status, 3));
    const stages = [
      { key: "projects", label: "建项", count: projects?.count ?? 0 },
      { key: "outlines", label: "大纲确认", count: outlines?.count ?? 0 },
      { key: "characters", label: "角色定稿", count: characters?.count ?? 0 },
      { key: "storyboards", label: "分镜生成", count: shots?.count ?? 0 },
      { key: "batch", label: "批量投递", count: batch?.count ?? 0 },
      { key: "succeeded", label: "镜头成功", count: succeeded?.count ?? 0 },
    ];
    return stages.map((stage, index) => ({
      ...stage,
      conversion_from_previous:
        index === 0
          ? null
          : stages[index - 1]!.count > 0
            ? Math.round((stage.count / stages[index - 1]!.count) * 1000) / 10
            : 0,
    }));
  }

  async listReports(page?: number, pageSize?: number, status?: number) {
    const { page: p, pageSize: ps, offset } = pageArgs(page, pageSize);
    const where = status !== undefined ? eq(contentReports.status, status) : undefined;
    const rows = await db
      .select({
        id: contentReports.id,
        task_id: contentReports.taskId,
        share_id: contentReports.shareId,
        space_id: contentReports.spaceId,
        reason: contentReports.reason,
        detail: contentReports.detail,
        contact: contentReports.contact,
        status: contentReports.status,
        resolution: contentReports.resolution,
        handled_at: contentReports.handledAt,
        created_at: contentReports.createdAt,
      })
      .from(contentReports)
      .where(where)
      .orderBy(desc(contentReports.createdAt))
      .limit(ps)
      .offset(offset);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(contentReports).where(where);
    return {
      list: rows.map((row) => ({
        id: String(row.id),
        task_id: String(row.task_id),
        share_id: row.share_id ? String(row.share_id) : null,
        space_id: String(row.space_id),
        reason: row.reason,
        detail: row.detail,
        contact: row.contact,
        status: row.status,
        resolution: row.resolution,
        handled_at: row.handled_at?.toISOString() ?? null,
        created_at: row.created_at.toISOString(),
      })),
      total: countRow?.count ?? 0,
      page: p,
      page_size: ps,
    };
  }

  async resolveReport(id: string, adminId: string, action: "takedown" | "dismiss", note?: string) {
    let reportId: bigint;
    try {
      reportId = BigInt(id);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid report id", { field: "id" });
    }
    const [report] = await db.select().from(contentReports).where(eq(contentReports.id, reportId));
    if (!report) throw new AppError(ErrorCode.NOT_FOUND, "report not found");
    let handledBy: bigint | null = null;
    try {
      if (adminId) handledBy = BigInt(adminId);
    } catch {
      handledBy = null;
    }
    await db
      .update(contentReports)
      .set({
        status: action === "takedown" ? 2 : 3,
        handledBy,
        handledAt: new Date(),
        resolution: note ?? (action === "takedown" ? "内容已下线" : "举报不成立"),
        updatedAt: new Date(),
      })
      .where(eq(contentReports.id, reportId));

    if (action === "takedown" && report.shareId) {
      await db
        .update(taskShares)
        .set({ revokedAt: new Date() })
        .where(eq(taskShares.id, report.shareId));
    }
    return { ok: true, status: action === "takedown" ? 2 : 3 };
  }
}
