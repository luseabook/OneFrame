import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import {
  adminUsers,
  contentReports,
  creatorAssets,
  episodes,
  exportJobs,
  homeConfigs,
  modelPrices,
  models,
  orders,
  projectAssets,
  promoSlots,
  scriptProjects,
  storyboards,
  taskShares,
  tasks,
  users,
} from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
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

  /**
   * 平台运营侧的创作者审核队列（模块 #10 收尾）。
   *
   * 背景：创作者作品此前**只有空间管理员能审**（`POST /crc/assets/audit`），平台运营域看不到队列。
   * 竞品侧创作者内容是平台内容池的一部分，运营必须能直接处置（审/驳/下架），否则"内容安全"这条线
   * 在最该有人管的地方没有人管。
   *
   * 口径：
   * - 只读列表按状态过滤（默认 2=待审），带作者名便于运营判断；
   * - 状态机复用创作者域同一套：2→3（通过，写 published_at）、2→4（驳回，写 review_note）、
   *   3→5（下架）；不允许 1/4/5 直接过审（跳步会绕过审核记录）；
   * - 审核人写 `reviewed_by_admin` + `reviewed_by_kind=2`，与空间管理员（`reviewed_by`）分开留痕。
   */
  async creatorAudits(opts: { status?: number; q?: string; page?: number; pageSize?: number } = {}) {
    const status = opts.status ?? 2;
    const page = opts.page ?? 1;
    const pageSize = Math.min(opts.pageSize ?? 20, 100);
    const conds = [eq(creatorAssets.status, status), sql`${creatorAssets.deletedAt} is null`];
    // 标题搜索：审核队列按 FIFO（最早待审在前）翻页时，运营经常"只找某个作品"，
    // 没有搜索就只能一页页翻（55 条待审时体验极差）。
    if (opts.q && opts.q.trim()) conds.push(ilike(creatorAssets.title, `%${opts.q.trim()}%`));
    const rows = await db
      .select({
        id: creatorAssets.id,
        title: creatorAssets.title,
        summary: creatorAssets.summary,
        kind: creatorAssets.kind,
        category: creatorAssets.category,
        effect: creatorAssets.effect,
        status: creatorAssets.status,
        cover_uri: creatorAssets.coverUri,
        uri: creatorAssets.uri,
        creator_user_id: creatorAssets.creatorUserId,
        space_id: creatorAssets.spaceId,
        review_note: creatorAssets.reviewNote,
        created_at: creatorAssets.createdAt,
        published_at: creatorAssets.publishedAt,
      })
      .from(creatorAssets)
      .where(and(...conds))
      .orderBy(asc(creatorAssets.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [agg] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(creatorAssets)
      .where(and(...conds));
    return {
      list: rows.map((row) => ({
        ...row,
        id: String(row.id),
        creator_user_id: String(row.creator_user_id),
        space_id: String(row.space_id),
        created_at: row.created_at?.toISOString?.() ?? row.created_at,
        published_at: row.published_at?.toISOString?.() ?? row.published_at,
      })),
      total: Number(agg?.n ?? 0),
      page,
      page_size: pageSize,
      status,
    };
  }

  /** 平台运营处置一件创作者作品（通过/驳回/下架）；返回处置后的状态与留痕字段 */
  async reviewCreatorAudit(
    adminId: string,
    assetId: string,
    input: { action: "approve" | "reject" | "offline"; note?: string },
  ) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(creatorAssets)
        .where(and(eq(creatorAssets.id, BigInt(assetId)), sql`${creatorAssets.deletedAt} is null`))
        .for("update");
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
      const from = row.status;
      if (input.action === "approve" || input.action === "reject") {
        if (from !== 2) {
          throw new AppError(ErrorCode.INVALID_PARAM, "只有待审作品可以审核", {
            field: "action",
            status: from,
          });
        }
      } else if (from !== 3) {
        throw new AppError(ErrorCode.INVALID_PARAM, "只有已通过作品可以下架", { field: "action", status: from });
      }
      const to = input.action === "approve" ? 3 : input.action === "reject" ? 4 : 5;
      const [updated] = await tx
        .update(creatorAssets)
        .set({
          status: to,
          reviewNote: input.action === "reject" ? (input.note ?? "内容不符合规范") : row.reviewNote,
          reviewedAt: new Date(),
          reviewedByAdmin: BigInt(adminId),
          reviewedByKind: 2,
          ...(input.action === "approve" ? { publishedAt: new Date() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(creatorAssets.id, row.id))
        .returning();
      return {
        asset_id: String(updated!.id),
        from_status: from,
        status: updated!.status,
        review_note: updated!.reviewNote,
        reviewed_by_kind: 2,
        published_at: updated!.publishedAt,
      };
    });
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
    input: {
      credits?: number;
      strikeCredits?: number;
      memberCredits?: number | null;
      timeLimitedCredits?: number | null;
      active?: boolean;
    },
  ) {
    const [row] = await db
      .update(modelPrices)
      .set(input)
      .where(eq(modelPrices.id, BigInt(id)))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "price not found");
    return {
      id: String(row.id),
      credits: row.credits,
      strike_credits: row.strikeCredits,
      active: row.active,
    };
  }

  /**
   * 新增价目。
   *
   * 只校验**档位合法性**，金额完全由运营定（"价格后台可调、不写死"的落点）：
   * - `mode` 必须在该模型的 `modes` 目录里，否则会造出"一调用就失败"的价目；
   * - mode 声明了 `resolution_options` 时，resolution 必须取自其中；
   * - mode 声明了 `durations` 时，duration_s 必须落在档位内（按秒计价的视频）；
   * - 按次计价的模式（如文本类）不允许带 duration_s，否则会凭空多出"5s 文本"档。
   * 同 (model, mode, resolution, duration) 已存在 → 400101（唯一键冲突不该冒成 500）。
   */
  async createPrice(input: {
    model_id: string;
    mode: string;
    resolution: string;
    duration_s?: number | null;
    credits: number;
    strikeCredits?: number;
    memberCredits?: number | null;
    timeLimitedCredits?: number | null;
  }) {
    let modelId: bigint;
    try {
      modelId = BigInt(input.model_id);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid model_id", { field: "model_id" });
    }
    const [model] = await db.select().from(models).where(eq(models.id, modelId));
    if (!model) throw new AppError(ErrorCode.NOT_FOUND, "model not found", { model_id: input.model_id });

    const modes = (model.modes ?? {}) as Record<
      string,
      { resolution_options?: Array<{ value: string }>; durations?: number[] }
    >;
    const modeCfg = modes[input.mode];
    if (!modeCfg) {
      throw new AppError(ErrorCode.INVALID_PARAM, `model ${model.name} has no mode ${input.mode}`, {
        field: "mode",
      });
    }
    const allowedResolutions = (modeCfg.resolution_options ?? []).map((item) => item.value);
    if (allowedResolutions.length > 0 && !allowedResolutions.includes(input.resolution)) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        `resolution must be one of ${allowedResolutions.join(",")}`,
        { field: "resolution" },
      );
    }
    const durations = modeCfg.durations ?? [];
    if (durations.length > 0) {
      if (input.duration_s == null || !durations.includes(input.duration_s)) {
        throw new AppError(ErrorCode.INVALID_PARAM, `duration_s must be one of ${durations.join(",")}`, {
          field: "duration_s",
        });
      }
    } else if (input.duration_s != null) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        `mode ${input.mode} is priced per call, duration_s must be null`,
        { field: "duration_s" },
      );
    }

    try {
      const [row] = await db
        .insert(modelPrices)
        .values({
          id: newId(),
          modelId,
          mode: input.mode,
          resolution: input.resolution,
          durationS: input.duration_s ?? null,
          credits: input.credits,
          strikeCredits: input.strikeCredits ?? null,
          memberCredits: input.memberCredits ?? null,
          timeLimitedCredits: input.timeLimitedCredits ?? null,
        })
        .returning();
      return {
        id: String(row!.id),
        model_id: String(row!.modelId),
        mode: row!.mode,
        resolution: row!.resolution,
        duration_s: row!.durationS,
        credits: row!.credits,
      };
    } catch (error) {
      // Postgres 唯一键冲突（23505）：同一档位重复定价，属于参数问题而不是 500
      if ((error as { code?: string }).code === "23505") {
        throw new AppError(ErrorCode.INVALID_PARAM, "price for this tier already exists", {
          field: "mode",
        });
      }
      throw error;
    }
  }

  async deletePrice(id: string) {
    let priceId: bigint;
    try {
      priceId = BigInt(id);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid price id", { field: "id" });
    }
    const [row] = await db.delete(modelPrices).where(eq(modelPrices.id, priceId)).returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "price not found");
    return { ok: true, id: String(row.id) };
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

  // ── 运营位（模块 #27 收尾；promo_slots 见迁移 0024）────────────────────
  //
  // 三个语义必须分清（运营后台最容易配错的就是这里）：
  //   status     = 素材本身的启用/停用（软态，保留历史投放记录）
  //   active_now = status 启用 **且** 当前时间落在 [starts_at, ends_at] 内
  //   sort       = 同一 slot 内的展示顺序（升序，数字小的在前）
  // 列表把 `active_now` 一并算好返回，运营不必自己拿当前时间比时间戳。

  // ── 首页板块配置（home_configs）──────────────────────────
  //
  // 背景：`GET /home/config` 早就支持「space 覆盖 > global > 内置默认」，但**没有任何写入入口**，
  // 等于运营永远只能看到内置默认（source=default）。这里补平台侧写入，语义与读侧严格对齐：
  //   · 只写 `scope='global'`（space 覆盖属于团队空间运营，不在平台后台职责内）；
  //   · `version` 乐观锁：不匹配 → 746002，避免两个运营互相覆盖；
  //   · `sections` 全量覆盖（不做增量合并）：前端要的就是"这一版首页长什么样"，
  //     增量语义会让"删掉一个板块"变成不可表达；
  //   · `key` 只允许内置集合内的值——写进未知 key 会让前端静默忽略，属于脏数据。

  /** 首页板块的内置 key 集合（与 home.service 的 DEFAULT_SECTIONS 保持一致） */
  private static readonly HOME_SECTION_KEYS = ["hero", "workflow", "canvas", "tools", "banner", "recent"] as const;

  /** 读 global 配置；没有行时返回 source=default（与读侧同义） */
  async homeConfig(): Promise<{
    version: number | null;
    source: "db" | "default";
    sections: Array<{ key: string; visible: boolean; sort: number }>;
    updated_at: string | null;
  }> {
    const [row] = await db
      .select()
      .from(homeConfigs)
      .where(and(eq(homeConfigs.scope, "global"), isNull(homeConfigs.spaceId)));
    if (!row) {
      return {
        version: null,
        source: "default",
        sections: AdminService.HOME_SECTION_KEYS.map((key, i) => ({
          key,
          visible: true,
          sort: (i + 1) * 10,
        })),
        updated_at: null,
      };
    }
    const payload = (row.payload ?? {}) as { sections?: unknown };
    const sections = Array.isArray(payload.sections)
      ? (payload.sections as Array<{ key?: unknown; visible?: unknown; sort?: unknown }>)
          .filter((s) => typeof s?.key === "string")
          .map((s) => ({
            key: String(s.key),
            visible: s.visible !== false,
            sort: Number.isFinite(Number(s.sort)) ? Number(s.sort) : 0,
          }))
      : AdminService.HOME_SECTION_KEYS.map((key, i) => ({ key, visible: true, sort: (i + 1) * 10 }));
    return {
      version: row.version,
      source: "db",
      sections,
      updated_at: row.updatedAt.toISOString(),
    };
  }

  /** 全量覆盖 global 首页板块配置（乐观锁 + 白名单校验） */
  async saveHomeConfig(
    adminId: string,
    input: {
      version?: number;
      sections: Array<{ key: string; visible: boolean; sort: number }>;
    },
  ): Promise<{ version: number }> {
    // 白名单：未知 key 直接拒绝（前端会静默忽略，属于脏数据）
    const allowed = new Set<string>(AdminService.HOME_SECTION_KEYS);
    for (const s of input.sections) {
      if (!allowed.has(s.key)) throw new AppError(ErrorCode.INVALID_PARAM, `unknown section key: ${s.key}`);
    }
    // 去重：同一 key 出现两次会让前端渲染重复板块
    const keys = new Set<string>();
    for (const s of input.sections) {
      if (keys.has(s.key)) throw new AppError(ErrorCode.INVALID_PARAM, `duplicate section key: ${s.key}`);
      keys.add(s.key);
    }

    const [row] = await db
      .select()
      .from(homeConfigs)
      .where(and(eq(homeConfigs.scope, "global"), isNull(homeConfigs.spaceId)));

    if (!row) {
      await db.insert(homeConfigs).values({
        // home_configs.id 没有默认值：与全仓一致用 newId() 生成雪花 id
        id: newId(),
        scope: "global",
        spaceId: null,
        payload: { sections: input.sections },
        version: 1,
        // created_by 外键指向 users.id，而运营 admin 是**独立的** admin_users 表，
        // 写进来会直接撞 FK（cli-build 时踩过一次，表现为 500/500000）。
        // 所以这里不写 created_by：审计线索走 admin 侧的操作日志，而不是在业务表里塞假 user id。
        createdBy: null,
      });
      return { version: 1 };
    }

    if (input.version !== undefined && input.version !== row.version) {
      throw new AppError(ErrorCode.VERSION_CONFLICT, "home config version conflict");
    }
    const nextVersion = row.version + 1;
    await db
      .update(homeConfigs)
      .set({
        payload: { ...(row.payload as Record<string, unknown>), sections: input.sections },
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(homeConfigs.id, row.id));
    return { version: nextVersion };
  }

  private promoSlotDto(row: typeof promoSlots.$inferSelect, now = new Date()) {
    const startsOk = row.startsAt === null || row.startsAt.getTime() <= now.getTime();
    // 结束时间用**闭区间**（>=）：与公开读接口 `OpService.listActivePromoSlots` 的口径一致，
    // 否则运营看到 active_now=true、用户端却已经下线，排查时互相扯皮。
    const endsOk = row.endsAt === null || row.endsAt.getTime() >= now.getTime();
    return {
      id: String(row.id),
      slot: row.slot,
      title: row.title,
      image_uri: row.imageUri,
      link_uri: row.linkUri,
      sort: row.sort,
      status: row.status,
      starts_at: row.startsAt ? row.startsAt.toISOString() : null,
      ends_at: row.endsAt ? row.endsAt.toISOString() : null,
      view_count: row.viewCount,
      click_count: row.clickCount,
      created_by: row.createdBy === null ? null : String(row.createdBy),
      active_now: row.status === 1 && startsOk && endsOk,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  async listPromoSlots(filters: { slot?: string; status?: number } = {}) {
    const conds = [];
    if (filters.slot) conds.push(eq(promoSlots.slot, filters.slot));
    if (filters.status !== undefined) conds.push(eq(promoSlots.status, filters.status));
    const rows = await db
      .select()
      .from(promoSlots)
      .where(conds.length > 0 ? and(...conds) : undefined)
      // 同 slot 按 sort 升序；跨 slot 按 slot 名稳定排序（运营列表要可预期）
      .orderBy(asc(promoSlots.slot), asc(promoSlots.sort), asc(promoSlots.id));
    const now = new Date();
    const list = rows.map((row) => this.promoSlotDto(row, now));
    return {
      list,
      count: list.length,
      active_count: list.filter((item) => item.active_now).length,
      slots: PROMO_SLOT_KINDS,
    };
  }

  async createPromoSlot(adminId: string, input: PromoSlotInput) {
    const id = newId();
    const [row] = await db
      .insert(promoSlots)
      .values({
        id,
        slot: input.slot ?? "banner",
        title: input.title ?? "",
        imageUri: input.image_uri ?? null,
        linkUri: input.link_uri ?? null,
        sort: input.sort ?? 0,
        status: input.status ?? 1,
        startsAt: parseOptionalDate(input.starts_at, "starts_at"),
        endsAt: parseOptionalDate(input.ends_at, "ends_at"),
        // 迁移 0028 起 `promo_slots.created_by` 的外键指向 `admin_users(id)`（与
        // `content_reports.handled_by` 同口径），运营 token 的 adminId 可直接落库留痕。
        createdBy: adminIdBigint(adminId),
      })
      .returning();
    return this.promoSlotDto(row);
  }

  async updatePromoSlot(id: string, input: PromoSlotInput) {
    const patch: Partial<typeof promoSlots.$inferInsert> = { updatedAt: new Date() };
    if (input.slot !== undefined) patch.slot = input.slot;
    if (input.title !== undefined) patch.title = input.title;
    if (input.image_uri !== undefined) patch.imageUri = input.image_uri;
    if (input.link_uri !== undefined) patch.linkUri = input.link_uri;
    if (input.sort !== undefined) patch.sort = input.sort;
    if (input.status !== undefined) patch.status = input.status;
    if (input.starts_at !== undefined) patch.startsAt = parseOptionalDate(input.starts_at, "starts_at");
    if (input.ends_at !== undefined) patch.endsAt = parseOptionalDate(input.ends_at, "ends_at");
    const [row] = await db.update(promoSlots).set(patch).where(eq(promoSlots.id, idBigint(id))).returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "promo slot not found");
    return this.promoSlotDto(row);
  }

  /** 物理删除：运营位只是投放素材，无业务外键引用；效果计数随行一起消失（误删需重建） */
  async deletePromoSlot(id: string) {
    const [row] = await db.delete(promoSlots).where(eq(promoSlots.id, idBigint(id))).returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "promo slot not found");
    return { ok: true, id: String(row.id) };
  }
}

/** 运营位四类（schema:`promo_slots.slot` 注释口径） */
export const PROMO_SLOT_KINDS = ["banner", "pop_up", "activity", "creator"] as const;

export interface PromoSlotInput {
  slot?: string;
  title?: string;
  image_uri?: string | null;
  link_uri?: string | null;
  sort?: number;
  status?: number;
  starts_at?: string | null;
  ends_at?: string | null;
}

function idBigint(id: string): bigint {
  try {
    return BigInt(id);
  } catch {
    throw new AppError(ErrorCode.INVALID_PARAM, "invalid id", { field: "id" });
  }
}

/** 运营身份 id → bigint；非数字（历史脏 token）时退化为不落操作人，而不是 500 */
function adminIdBigint(adminId: string): bigint | null {
  if (!adminId) return null;
  try {
    return BigInt(adminId);
  } catch {
    return null;
  }
}

function parseOptionalDate(raw: string | null | undefined, field: string): Date | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    throw new AppError(ErrorCode.INVALID_PARAM, `${field} must be ISO datetime`, { field });
  }
  return new Date(parsed);
}
