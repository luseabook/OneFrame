import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import {
  adminUsers,
  contentReports,
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
import { computeFunnel, emptyFunnelStageTimestamps, mergeEarliest, mergeLatest, toEpochMs } from "./admin-funnel";

function pageArgs(page?: number, pageSize?: number) {
  const p = Math.max(1, page ?? 1);
  const ps = Math.min(100, Math.max(1, pageSize ?? 20));
  return { page: p, pageSize: ps, offset: (p - 1) * ps };
}

@Injectable()
export class AdminService {
  constructor(@Inject(QueueService) private readonly queue: QueueService) {}

  /**
   * 队列积压面板（第 112 批扩到 4 条活队列）。
   *
   * 口径：只报「有生产者、worker 有真实处理器」的队列。`gen.poll` / `result.transfer` /
   * `notify` 是预留名（轮询与转存在 executor 内联，通知渠道未接），没有生产者，
   * 把它们列出来只会让运维盯着一排恒为 0 的卡片，掩盖真正需要看的积压。
   * `timeline.export` 与 `publish.transcode` 各自有看门狗重投，漏报等于让「卡住但没重投」
   * 的状态在后台不可见——这正是本批补上的观测盲区。
   */
  async queues() {
    const counts = (queue: QueueService["submitQueue"]) =>
      queue.getJobCounts("wait", "active", "failed", "completed", "delayed");
    const [submit, exportJobsQueue, timelineExport, publishTranscode] = await Promise.all([
      counts(this.queue.submitQueue),
      counts(this.queue.exportQueue),
      counts(this.queue.timelineExportQueue),
      counts(this.queue.publishTranscodeQueue),
    ]);
    return {
      "gen.submit": submit,
      "export.zip": exportJobsQueue,
      "timeline.export": timelineExport,
      "publish.transcode": publishTranscode,
    };
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

  /**
   * 任务筛选条件（契约 §2.7/§2.8 共用）。
   *
   * 为什么用 `sql` 片段而不是 drizzle 的 `eq()`：adapter 延迟那段是**原生 SQL**
   * （要 `percentile_cont ... within group`，drizzle 查询构造器表达不了），两处必须是
   * **同一份条件**，否则会出现"总览按模型筛了、延迟没筛"的自相矛盾报表。
   * 列名用 `${tasks.xxx}` 插值（渲染成 `"tasks"."xxx"`），原生 SQL 那边表名也不加别名，
   * 于是同一份片段在两个世界里都成立。
   */
  private taskFilterClauses(filters: TaskFilterInput): SQL[] {
    const clauses: SQL[] = [];
    if (filters.modelId !== undefined) clauses.push(sql`${tasks.modelId} = ${filters.modelId}`);
    // 契约明确按 `tasks.created_at` 过滤：报表要回答"这段时间**产生**了什么"，
    // 按 updated_at 筛会把"三个月前建、今天才失败"的老任务算进今天的失败率。
    if (filters.from) clauses.push(sql`${tasks.createdAt} >= ${filters.from}`);
    if (filters.to) clauses.push(sql`${tasks.createdAt} <= ${filters.to}`);
    return clauses;
  }

  /**
   * 任务指标（PRD F8）：失败率 + adapter 延迟（task.running → task.succeeded/failed）。
   *
   * 筛选（model_id / from / to）必须同时作用于**全部**聚合口径（总览计数、错误码分布、
   * adapter 延迟），否则运营按模型筛完看到"总览 3 条、错误码分布 900 条"会直接失去信任。
   */
  async taskMetrics(filters: TaskFilterInput = {}) {
    const clauses = this.taskFilterClauses(filters);

    const [total] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(clauses.length > 0 ? and(...clauses) : undefined);
    const [succeeded] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.status, 3), ...clauses));
    const [failed] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(sql`${tasks.status} in (4, 7)`, ...clauses));
    const [canceled] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.status, 5), ...clauses));
    const finished = (succeeded?.count ?? 0) + (failed?.count ?? 0);

    // adapter 延迟：按 adapter_code 聚合 created_at→finished_at 的平均耗时
    const latencyResult = await db.execute(sql`
      select models.adapter_code as adapter,
             count(*)::int as samples,
             round(avg(extract(epoch from (tasks.finished_at - tasks.created_at))) * 1000)::int as avg_ms,
             round(percentile_cont(0.95) within group (order by extract(epoch from (tasks.finished_at - tasks.created_at))) * 1000)::int as p95_ms
      from tasks
      join models on models.id = tasks.model_id
      where tasks.finished_at is not null
      ${clauses.length > 0 ? sql`and ${sql.join(clauses, sql` and `)}` : sql``}
      group by models.adapter_code
      order by avg_ms desc
    `);
    const latencyRows = (latencyResult as unknown as { rows?: Array<Record<string, unknown>> }).rows ?? [];

    const errorCodeExpr = sql<string>`coalesce(${tasks.error}->>'code','unknown')`;
    const errorByCode = await db
      .select({ code: errorCodeExpr, count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(sql`${tasks.status} in (4, 7)`, ...clauses))
      .groupBy(errorCodeExpr)
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
      // 回显生效的筛选，页面才能在"指标卡片"上标出当前口径（null = 未筛）
      filters: {
        model_id: filters.modelId === undefined ? null : String(filters.modelId),
        from: filters.from ? filters.from.toISOString() : null,
        to: filters.to ? filters.to.toISOString() : null,
      },
    };
  }

  /**
   * 失败任务清单导出（CSV）。
   *
   * 表头**保留前缀** `task_id,space_id,model,mode,status`：既有页面与测试按这个前缀对齐列序，
   * 改顺序等于把导出表格的结构改掉；契约要求的新列一律**追加在末尾**。
   * 仍限制 ≤1000 行（一次导出不该把运营的 Excel 打死），仍做 CSV 转义。
   */
  async failedTasksCsv(filters: TaskFilterInput = {}) {
    const clauses = this.taskFilterClauses(filters);
    const rows = await db
      .select({
        id: tasks.id,
        spaceId: tasks.spaceId,
        modelId: tasks.modelId,
        mode: tasks.mode,
        status: tasks.status,
        error: tasks.error,
        createdAt: tasks.createdAt,
        finishedAt: tasks.finishedAt,
        // model 列仍是 model_id（前缀契约），人可读名字单独占一列追加在后面
        modelName: models.name,
        adapterCode: models.adapterCode,
      })
      .from(tasks)
      .innerJoin(models, eq(models.id, tasks.modelId))
      .where(and(sql`${tasks.status} in (4, 7)`, ...clauses))
      .orderBy(desc(tasks.updatedAt))
      .limit(1000);
    const header =
      "task_id,space_id,model,mode,status,model_name,adapter_code,error_code,error_message,created_at,finished_at";
    const escape = (value: unknown): string => {
      const text = value === null || value === undefined ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = rows.map((row) => {
      const error = (row.error ?? null) as { code?: unknown; message?: unknown } | null;
      return [
        String(row.id),
        String(row.spaceId),
        String(row.modelId),
        escape(row.mode),
        row.status,
        escape(row.modelName),
        escape(row.adapterCode),
        escape(jsonText(error?.code)),
        escape(jsonText(error?.message)),
        row.createdAt.toISOString(),
        row.finishedAt ? row.finishedAt.toISOString() : "",
      ].join(",");
    });
    return `${header}\n${lines.join("\n")}\n`;
  }

  /**
   * 模型目录的运营视图。
   *
   * `modes`/`types` 是契约 §2.1 新增的：`modes` 决定"这个模型能选哪些分辨率/时长档位"，
   * 是计价与参数面板的共同上游；之前后台看不到它，运营只能靠改价试探。
   * `modes` 原样返回（可能是 `{}`），不做归一，避免后台"看到的"与计价读到的不是同一份。
   */
  private modelDto(row: typeof models.$inferSelect) {
    return {
      id: String(row.id),
      name: row.name,
      display_name: row.displayName,
      vendor: row.vendor,
      capability: row.capability,
      visible: row.visible,
      sort: row.sort,
      adapter_code: row.adapterCode,
      vip: row.needVip,
      modes: row.modes,
      types: row.types,
    };
  }

  async listModels() {
    const rows = await db.select().from(models).orderBy(models.sort);
    return rows.map((row) => this.modelDto(row));
  }

  /**
   * 改模型运营字段（可见/排序/档位）。
   *
   * `modes` 是**整体替换**而不是深合并：深合并无法表达"删掉某个分辨率档位"这种运营动作
   * （合并只能加不能减），而档位是计价的支点，删不掉就等于上线了一个永远报不出价的黑档。
   * 校验（键数/键长/体积/每档字段）全部在 controller 的 zod 层做，这里只负责落库。
   */
  async updateModel(id: string, input: { visible?: boolean; sort?: number; modes?: Record<string, unknown> }) {
    const targetId = idBigint(id);
    const [existing] = await db.select({ name: models.name }).from(models).where(eq(models.id, targetId));
    if (!existing) throw new AppError(ErrorCode.NOT_FOUND, "model not found");
    /**
     * 工具模型（`toolbox-*`）的 `modes` 由 `tool-catalog.ts` 的 `TOOL_MODES` 定义，
     * 每进程首次目录请求都会把定义同步回库（代码负责参数枚举，DB 负责运营字段）。
     *
     * 所以后台改这类模型的 modes 会被下一次同步覆盖 —— 与其让运营"改了没生效"且无报错，
     * 不如在这里明确拒绝：要改工具档位请改目录定义（发版），后台只负责上下架/排序/价格。
     */
    if (input.modes !== undefined && existing.name.startsWith("toolbox-")) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        "tool models' parameter catalog is code-managed (tool-catalog.ts); edit the catalog itself instead",
        { field: "modes", model: existing.name },
      );
    }
    const patch: Partial<typeof models.$inferInsert> = { updatedAt: new Date() };
    if (input.visible !== undefined) patch.visible = input.visible;
    if (input.sort !== undefined) patch.sort = input.sort;
    if (input.modes !== undefined) patch.modes = input.modes;
    const [row] = await db
      .update(models)
      .set(patch)
      // 非法 id 走 400101 而不是 BigInt() 抛错冒成 500
      .where(eq(models.id, targetId))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "model not found");
    return this.modelDto(row);
  }

  /**
   * 价目运营视图（契约 §2.3/§2.4/§2.5 统一形状）。
   *
   * 为什么把 `model_name` 一起带出来：价目表是按 `model_id` 外键组织的，运营在页面上
   * 看到一串雪花 id 根本没法判断"这条价是不是我要改的那个模型"。名字来自 join，
   * 不缓存，避免模型改名后价目表显示旧名。
   */
  private priceDto(row: typeof modelPrices.$inferSelect, modelName: string) {
    return {
      id: String(row.id),
      model_id: String(row.modelId),
      model_name: modelName,
      mode: row.mode,
      resolution: row.resolution,
      duration_s: row.durationS,
      credits: row.credits,
      strike_credits: row.strikeCredits,
      member_credits: row.memberCredits,
      time_limited_credits: row.timeLimitedCredits,
      active: row.active,
      updated_at: row.updatedAt.toISOString(),
    };
  }

  /** 按 id 取模型名（价目写操作的返回要带 model_name；模型行是 FK 保证存在的） */
  private async modelNameOf(modelId: bigint): Promise<string> {
    const [row] = await db.select({ name: models.name }).from(models).where(eq(models.id, modelId));
    return row?.name ?? "";
  }

  async listPrices(opts: { modelId?: string; active?: boolean; page?: number; pageSize?: number } = {}) {
    const { page: p, pageSize: ps, offset } = pageArgs(opts.page, opts.pageSize);
    const conds: SQL[] = [];
    if (opts.modelId) conds.push(eq(modelPrices.modelId, BigInt(opts.modelId)));
    // `active=false` 的档位不能删（保留对账追溯），所以列表必须能显式筛出来看
    if (opts.active !== undefined) conds.push(eq(modelPrices.active, opts.active));
    const where = conds.length > 0 ? and(...conds) : undefined;
    const rows = await db
      .select({ price: modelPrices, modelName: models.name })
      .from(modelPrices)
      .innerJoin(models, eq(models.id, modelPrices.modelId))
      .where(where)
      .orderBy(modelPrices.modelId, modelPrices.mode)
      .limit(ps)
      .offset(offset);
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(modelPrices)
      .where(where);
    return {
      list: rows.map((row) => this.priceDto(row.price, row.modelName)),
      total: countRow?.count ?? 0,
      page: p,
      page_size: ps,
    };
  }

  /**
   * 改价目。
   *
   * 返回**补全后的完整档位**（而不是只回显改动字段）：运营改完一次价，页面要用返回体
   * 就地刷新整行；只回 4 个字段的话前端还得再发一次列表请求，且并发下可能读到别人的改动。
   */
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
      .set({ ...input, updatedAt: new Date() })
      .where(eq(modelPrices.id, idBigint(id)))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "price not found");
    return this.priceDto(row, await this.modelNameOf(row.modelId));
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
    /** 契约 §2.4：默认上架；运营要"先建价、后放量"时可传 false */
    active?: boolean;
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
          active: input.active ?? true,
        })
        .returning();
      // 返回补全后的档位（含 model_name/active）：契约 §2.4 要求前端拿到就能就地渲染新行
      return this.priceDto(row!, model.name);
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

  /**
   * 任务列表（契约 §2.6）。
   *
   * DTO 从"只有 task_id/mode/status/金额"扩到运营真正需要的字段：
   * - `model_name`/`adapter_code`：判断"是这个模型的问题还是这个适配器的问题"——只看
   *   `model_id` 定位不到适配器（同一适配器服务多个模型，故障时整族一起挂）；
   * - `error_code`/`error_message`：从 `tasks.error` JSON 摊平，否则前端只能显示"失败"；
   * - `finished_at`：配 `created_at` 才能算单条耗时，也是失败排查的时间锚点。
   */
  async listTasks(
    opts: { page?: number; pageSize?: number; status?: number; modelId?: string; mode?: string } = {},
  ) {
    const { page: p, pageSize: ps, offset } = pageArgs(opts.page, opts.pageSize);
    const conds: SQL[] = [];
    if (opts.status !== undefined) conds.push(eq(tasks.status, opts.status));
    if (opts.modelId) conds.push(eq(tasks.modelId, BigInt(opts.modelId)));
    if (opts.mode) conds.push(eq(tasks.mode, opts.mode));
    const where = conds.length > 0 ? and(...conds) : undefined;
    const rows = await db
      .select({
        id: tasks.id,
        spaceId: tasks.spaceId,
        modelId: tasks.modelId,
        mode: tasks.mode,
        status: tasks.status,
        error: tasks.error,
        creditsFrozen: tasks.creditsFrozen,
        creditsSettled: tasks.creditsSettled,
        createdAt: tasks.createdAt,
        finishedAt: tasks.finishedAt,
        modelName: models.name,
        adapterCode: models.adapterCode,
      })
      .from(tasks)
      // tasks.model_id 是 NOT NULL + FK，innerJoin 不会丢行；宁可让"模型行缺失"这种
      // 数据损坏暴露成 0 行，也不要静默返回 model_name=null 让运营以为模型没名字
      .innerJoin(models, eq(models.id, tasks.modelId))
      .where(where)
      .orderBy(desc(tasks.createdAt))
      .limit(ps)
      .offset(offset);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(tasks).where(where);
    return {
      list: rows.map((row) => {
        const error = (row.error ?? null) as { code?: unknown; message?: unknown } | null;
        return {
          task_id: String(row.id),
          space_id: String(row.spaceId),
          model_id: String(row.modelId),
          model_name: row.modelName,
          adapter_code: row.adapterCode,
          mode: row.mode,
          status: row.status,
          error_code: jsonText(error?.code),
          error_message: jsonText(error?.message),
          credits_frozen: row.creditsFrozen,
          credits_settled: row.creditsSettled,
          created_at: row.createdAt.toISOString(),
          finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
        };
      }),
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

  /**
   * 流水线漏斗（PRD F8；口径见契约 §2.9）。
   *
   * ## 为什么全部改成"项目维度 + 时间戳"
   *
   * 旧实现每段各写一个 `count(*)`，混了三种量纲：项目数（建项/大纲/角色）、分镜**条数**
   * （storyboards）、任务条数（批量/成功）。6 段拼起来看会出现"转化率 300%"这种数字，
   * 运营看不出到底哪一步在漏。新实现每段都回答同一个问题——**有多少个项目走到了这里**，
   * 于是转化率/流失率/耗时才有意义。
   *
   * ## 取数方式
   *
   * 分 6 条聚合查询（每条只吐 `project_id + 时间`），在 JS 里按项目合并。
   * 不写巨型 CTE 的原因：这些表各自被大量索引服务，单条聚合都能走索引；一个 6 段 JOIN
   * 的 CTE 反而会把执行计划打散，且出错时无法定位是哪一段。项目量级对运营后台完全够用。
   *
   * 每个环节取"该项目**最早**到达时间"，只有完集取"最晚"（最后一集出片才算完集）。
   */
  async funnel() {
    const stages = emptyFunnelStageTimestamps();
    const [projectRows, outlineRows, characterRows, storyboardRows, batchRows, completedEpisodeRows] =
      await Promise.all([
        // 建项：全部项目
        db.select({ projectId: scriptProjects.id, ts: scriptProjects.createdAt }).from(scriptProjects),
        // 大纲确认：episodes.status=2
        db
          .select({ projectId: episodes.projectId, ts: sql<Date>`min(${episodes.updatedAt})` })
          .from(episodes)
          .where(eq(episodes.status, 2))
          .groupBy(episodes.projectId),
        // 角色定稿：project_assets.kind='character' 且 status=2；finalized_at 为空的先排除，
        // 否则"定稿了但没写时间"会被 min() 忽略后整组消失，运营看到的定稿数偏少
        db
          .select({ projectId: projectAssets.projectId, ts: sql<Date>`min(${projectAssets.finalizedAt})` })
          .from(projectAssets)
          .where(
            and(
              eq(projectAssets.kind, "character"),
              eq(projectAssets.status, 2),
              isNotNull(projectAssets.finalizedAt),
            ),
          )
          .groupBy(projectAssets.projectId),
        // 分镜确认：存在 status>=2 的分镜（join episodes 才能拿到 project_id）
        db
          .select({ projectId: episodes.projectId, ts: sql<Date>`min(${storyboards.updatedAt})` })
          .from(storyboards)
          .innerJoin(episodes, eq(episodes.id, storyboards.episodeId))
          .where(gte(storyboards.status, 2))
          .groupBy(episodes.projectId),
        // 批量投递：mode=universal_reference 且挂在集上的任务（innerJoin 天然排除 episode_id is null）
        db
          .select({ projectId: episodes.projectId, ts: sql<Date>`min(${tasks.createdAt})` })
          .from(tasks)
          .innerJoin(episodes, eq(episodes.id, tasks.episodeId))
          .where(eq(tasks.mode, "universal_reference"))
          .groupBy(episodes.projectId),
        // 完集：以**集**为单位判断——该集有分镜且不存在 status<>5 的分镜
        // （having 里 `count(*)` 由分组本身保证 ≥1）
        db
          .select({ projectId: episodes.projectId, ts: sql<Date>`max(${storyboards.updatedAt})` })
          .from(storyboards)
          .innerJoin(episodes, eq(episodes.id, storyboards.episodeId))
          .groupBy(episodes.projectId, episodes.id)
          .having(sql`count(*) filter (where ${storyboards.status} <> 5) = 0`),
      ]);

    for (const row of projectRows) mergeEarliest(stages.projects, String(row.projectId), toEpochMs(row.ts));
    for (const row of outlineRows) mergeEarliest(stages.outlines, String(row.projectId), toEpochMs(row.ts));
    for (const row of characterRows) mergeEarliest(stages.characters, String(row.projectId), toEpochMs(row.ts));
    for (const row of storyboardRows) mergeEarliest(stages.storyboards, String(row.projectId), toEpochMs(row.ts));
    for (const row of batchRows) mergeEarliest(stages.batch, String(row.projectId), toEpochMs(row.ts));
    // 完集取最晚：一个项目可能有 3 集，只有最后一集也出完片才算"完集"
    for (const row of completedEpisodeRows) mergeLatest(stages.completed, String(row.projectId), toEpochMs(row.ts));

    // 顶层仍是数组（既有页面与测试依赖 `toHaveLength(6)`），纯计算在 admin-funnel.ts 里单测
    return computeFunnel(stages);
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

/**
 * 任务报表的筛选入参（契约 §2.7/§2.8 共用）。
 *
 * 时间用 `Date` 而不是原始字符串：zod 层已把非法 ISO 挡成 400101，再 `Date.parse` 一次
 * 只会让"哪一层负责校验"变模糊；传 `Date` 给 `>= created_at` 也能正常走 timestamptz 索引。
 */
export interface TaskFilterInput {
  modelId?: bigint;
  from?: Date;
  to?: Date;
}

/**
 * `tasks.error` JSON 里的可展示文本。
 *
 * 只接受标量：`code` 有时被写成数字，`String()` 后仍可读；对象/数组强行 `String`
 * 会得到 "[object Object]"，那比 null 更误导（运营会以为错误码就叫这个）。
 */
function jsonText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
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
