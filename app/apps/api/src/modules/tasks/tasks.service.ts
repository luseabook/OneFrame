import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  freezeCredits,
  taskEvents,
  taskShares,
  tasks,
  unfreezeCredits,
} from "@app/db";
import {
  AppError,
  ErrorCode,
  newId,
  TaskStatus,
  type GenerationInput,
  type GenerationMode,
  type GenerationOptions,
  type GenerationRequest,
  type SceneKey,
} from "@app/shared";
import { db } from "../../db/database";
import { QueueService } from "../../queue/queue.service";
import { StorageService } from "../../storage/storage.service";
import { CreditsService } from "../credits/credits.service";
import { ModelsService } from "../models/models.service";

type TaskRow = typeof tasks.$inferSelect;

export interface TaskDto {
  task_id: string;
  status: number;
  progress: number;
  mode: string;
  capability: string;
  model_id: string;
  scene: string | null;
  results: unknown;
  error: unknown;
  credits_frozen: number;
  credits_settled: number;
  created_at: string;
  finished_at: string | null;
  /** 用户可改的任务名（agent 域 PUT /agent/task/:id） */
  title?: string | null;
  /** 用户反馈 {reaction, comment?} */
  feedback?: unknown;
}

@Injectable()
export class TasksService {
  constructor(
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(ModelsService) private readonly models: ModelsService,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  toDto(row: TaskRow): TaskDto {
    return {
      task_id: String(row.id),
      status: row.status,
      progress: row.progress,
      mode: row.mode,
      capability: row.capability,
      model_id: String(row.modelId),
      scene: row.scene,
      results: row.results,
      error: row.error,
      credits_frozen: row.creditsFrozen,
      credits_settled: row.creditsSettled,
      created_at: row.createdAt.toISOString(),
      finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
      title: row.title ?? null,
      feedback: row.feedback ?? null,
    };
  }

  /**
   * 用户可改的任务元信息（标题 / 反馈）。
   *
   * 为什么必须落在 tasks 服务里而不是让 agent 直接 UPDATE：
   * `tasks` 承载冻结/结算与幂等（ADR-003、system-design §2「禁止跨模块直查表」），
   * 跨模块直写会绕过归属校验；这里统一做 space 归属校验后再写。
   */
  async updateMeta(
    spaceId: string,
    id: string,
    input: { title?: string | null; feedback?: unknown },
  ): Promise<TaskDto> {
    const row = await this.findTask(spaceId, id);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title === null ? null : String(input.title).slice(0, 120);
    if (input.feedback !== undefined) patch.feedback = input.feedback;
    const [updated] = await db.update(tasks).set(patch).where(eq(tasks.id, row.id)).returning();
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "task not found");
    return this.toDto(updated);
  }

  async getMany(spaceId: string, ids: string[]): Promise<TaskDto[]> {
    if (ids.length === 0) return [];
    const parsed = ids.map((id) => {
      try {
        return BigInt(id);
      } catch {
        throw new AppError(ErrorCode.INVALID_PARAM, `invalid task id: ${id}`, { field: "ids" });
      }
    });
    const rows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.spaceId, BigInt(spaceId)), inArray(tasks.id, parsed)));
    return rows.map((row) => this.toDto(row));
  }

  async list(
    spaceId: string,
    query: { page?: number; page_size?: number; status?: number; capability?: string },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20));
    const conditions = [eq(tasks.spaceId, BigInt(spaceId))];
    if (query.status !== undefined) conditions.push(eq(tasks.status, query.status));
    if (query.capability) conditions.push(eq(tasks.capability, query.capability));
    const where = and(...conditions);

    const rows = await db
      .select()
      .from(tasks)
      .where(where)
      .orderBy(desc(tasks.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(tasks).where(where);

    return {
      list: rows.map((row) => this.toDto(row)),
      total: countRow?.count ?? 0,
      page,
      page_size: pageSize,
    };
  }

  async detail(spaceId: string, id: string) {
    const row = await this.findTask(spaceId, id);
    const events = await db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, row.id))
      .orderBy(desc(taskEvents.createdAt));
    return {
      ...this.toDto(row),
      input: row.input,
      options: row.options,
      task_events: events.map((e) => ({
        type: e.type,
        payload: e.payload,
        created_at: e.createdAt.toISOString(),
      })),
    };
  }

  async cancel(spaceId: string, id: string): Promise<TaskDto> {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, BigInt(id)), eq(tasks.spaceId, BigInt(spaceId))))
        .for("update");
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "task not found");
      if (row.status !== TaskStatus.PENDING && row.status !== TaskStatus.RUNNING) {
        throw new AppError(ErrorCode.CANCEL_NOT_ALLOWED, "task already finished");
      }
      if (row.creditsFrozen > 0) {
        await unfreezeCredits(tx, {
          spaceId: row.spaceId,
          cost: row.creditsFrozen,
          taskId: row.id,
          memo: "cancel task",
        });
      }
      const [updated] = await tx
        .update(tasks)
        .set({ status: TaskStatus.CANCELED, finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(tasks.id, row.id))
        .returning();
      await tx.insert(taskEvents).values({
        id: newId(),
        taskId: row.id,
        type: "task.canceled",
        payload: { reason: "user_cancel" },
      });
      return this.toDto(updated ?? row);
    });
  }

  async retry(spaceId: string, id: string): Promise<TaskDto> {
    const origin = await this.findTask(spaceId, id);
    const attemptNo = origin.attemptNo + 1;
    const dedupeKey = `${origin.id}:${attemptNo}`;

    const [existing] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.spaceId, origin.spaceId), eq(tasks.dedupeKey, dedupeKey)));
    if (existing) return this.toDto(existing);

    const model = await this.models.findById(origin.modelId);
    const request: GenerationRequest = {
      mode: origin.mode as GenerationMode,
      model: model.name,
      scene: (origin.scene as SceneKey | null) ?? null,
      input: origin.input as GenerationInput,
      options: origin.options as GenerationOptions,
    };
    const priced = await this.credits.price(request, spaceId);
    if (!priced.sufficient) throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, "Insufficient Balance");

    const taskId = newId();
    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(tasks)
        .values({
          id: taskId,
          spaceId: origin.spaceId,
          userId: origin.userId,
          episodeId: origin.episodeId,
          shotId: origin.shotId,
          attemptNo,
          originTaskId: origin.id,
          capability: origin.capability,
          mode: origin.mode,
          scene: origin.scene,
          modelId: origin.modelId,
          input: origin.input,
          options: origin.options,
          status: TaskStatus.PENDING,
          progress: 0,
          creditsFrozen: priced.credits,
          dedupeKey,
        })
        .returning();
      await freezeCredits(tx, {
        spaceId: origin.spaceId,
        cost: priced.credits,
        taskId,
        memo: "retry freeze",
      });
      await tx.insert(taskEvents).values({
        id: newId(),
        taskId,
        type: "task.retried",
        payload: { origin_task_id: String(origin.id), attempt_no: attemptNo },
      });
      if (!inserted) throw new Error("insert task failed");
      return inserted;
    });

    await this.queue.enqueueTask(String(taskId));
    return this.toDto(row);
  }

  async batchDownload(spaceId: string, taskIds: string[]) {
    if (taskIds.length === 0 || taskIds.length > 50) {
      throw new AppError(ErrorCode.INVALID_PARAM, "task_ids must be 1..50", { field: "task_ids" });
    }
    const ids = taskIds.map((id) => {
      try {
        return BigInt(id);
      } catch {
        throw new AppError(ErrorCode.INVALID_PARAM, "invalid task id", { field: "task_ids" });
      }
    });
    const rows = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.spaceId, BigInt(spaceId)),
          inArray(tasks.id, ids),
          eq(tasks.status, TaskStatus.SUCCEEDED),
        ),
      );
    if (rows.length === 0) throw new AppError(ErrorCode.NOT_FOUND, "no succeeded tasks to download");

    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const manifest: Array<{ task_id: string; files: string[] }> = [];
    let count = 0;
    for (const row of rows) {
      const results = Array.isArray(row.results) ? (row.results as Array<{ uri?: string }>) : [];
      const files: string[] = [];
      for (let i = 0; i < results.length; i += 1) {
        const uri = results[i]?.uri;
        if (!uri) continue;
        try {
          const data = /^https?:\/\//.test(uri)
            ? Buffer.from(await (await fetch(uri)).arrayBuffer())
            : /^[a-z][a-z0-9+.-]*:\/\//i.test(uri)
              ? null
              : await this.storage.read(uri);
          if (!data) continue;
          const ext = uri.split(".").pop()?.toLowerCase() || "bin";
          const name = `task-${row.id}-${i + 1}.${ext}`;
          zip.file(name, data);
          files.push(name);
          count += 1;
        } catch {
          // 单个结果失败不阻断整包
        }
      }
      manifest.push({ task_id: String(row.id), files });
    }
    if (count === 0) throw new AppError(ErrorCode.NOT_FOUND, "no downloadable results");
    zip.file("manifest.json", JSON.stringify({ generated_at: new Date().toISOString(), tasks: manifest }, null, 2));
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const key = `u/${spaceId}/downloads/${newId()}.zip`;
    await this.storage.put(key, buffer, "application/zip");
    const url = await this.storage.signDownload(key, 3600);
    return { url, filename: `tasks-${rows.length}-${count}.zip`, count, expires_in: 3600 };
  }

  async downloadUrl(spaceId: string, id: string, index: number) {
    const row = await this.findTask(spaceId, id);
    const results = Array.isArray(row.results)
      ? (row.results as Array<{ uri?: string }>)
      : [];
    const item = results[index - 1];
    if (!item?.uri) throw new AppError(ErrorCode.NOT_FOUND, "result not found");

    // 存储 key（无协议前缀）→ 预签名；mock/外部 URL 原样返回
    const isStorageKey = !/^[a-z][a-z0-9+.-]*:\/\//i.test(item.uri);
    const url = isStorageKey ? await this.storage.signDownload(item.uri, 86_400) : item.uri;
    const ext = item.uri.split(".").pop()?.toLowerCase() || "bin";
    return { url, filename: `task-${row.id}-${index}.${ext}`, expires_in: 86_400 };
  }

  async createShare(spaceId: string, taskId: string, expiresDays: number) {
    const row = await this.findTask(spaceId, taskId);
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + expiresDays * 24 * 3600 * 1000);
    await db.insert(taskShares).values({
      id: newId(),
      taskId: row.id,
      spaceId: row.spaceId,
      token,
      expiresAt,
    });
    return { token, share_path: `/share/${token}`, expires_at: expiresAt.toISOString() };
  }

  async revokeShare(spaceId: string, taskId: string) {
    const row = await this.findTask(spaceId, taskId);
    await db
      .update(taskShares)
      .set({ revokedAt: new Date() })
      .where(and(eq(taskShares.taskId, row.id), isNull(taskShares.revokedAt)));
    return { ok: true };
  }

  // 公开只读预览：不暴露 space/user/credits（PRD F3）
  async publicShare(token: string) {
    const [share] = await db.select().from(taskShares).where(eq(taskShares.token, token));
    if (!share || share.revokedAt || share.expiresAt.getTime() <= Date.now()) {
      throw new AppError(ErrorCode.NOT_FOUND, "share not found or expired");
    }
    const [row] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, share.taskId), eq(tasks.spaceId, share.spaceId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "task not found");

    const rawResults = Array.isArray(row.results)
      ? (row.results as Array<{
          uri?: string;
          preview_uri?: string;
          text?: string;
          meta?: { ai_label?: unknown };
        }>)
      : [];
    const results: Array<{ url: string; preview_url?: string; text?: string; ai_label?: unknown }> = [];
    for (const item of rawResults) {
      if (!item.uri && !item.text) continue;
      const isStorageKey = item.uri && !/^[a-z][a-z0-9+.-]*:\/\//i.test(item.uri);
      const url = item.uri
        ? isStorageKey
          ? await this.storage.signDownload(item.uri, 3600)
          : item.uri
        : "";
      results.push({
        url,
        ...(item.text ? { text: item.text } : {}),
        ...(item.preview_uri ? { preview_url: item.preview_uri } : {}),
        ...(item.meta?.ai_label ? { ai_label: item.meta.ai_label } : {}),
      });
    }

    return {
      task_id: String(row.id),
      mode: row.mode,
      status: row.status,
      created_at: row.createdAt.toISOString(),
      expires_at: share.expiresAt.toISOString(),
      results,
      error: row.error as { message?: string } | null,
    };
  }

  /**
   * 批量任务结果（对照竞品 `POST /task/result`，`task.md` 的 result 语义）。
   *
   * 与 `GET /tasks?ids=` 的分工：那个是**轮询**通道（ETag + 304 省流量），
   * 这个是**一次性快照**（CLI / 脚本 / 批处理用）——所以：
   *   1. 不做 304，永远返回当前状态；
   *   2. 缺失/越权的 id 进 `missing[]`，不让整批 404（批量接口最怕"一条坏全批废"）；
   *   3. 只返回结果字段，不返回 userId/spaceId 等内部字段（最小暴露面）。
   */
  async resultMany(spaceId: string, taskIds: string[]) {
    if (taskIds.length === 0 || taskIds.length > 100) {
      throw new AppError(ErrorCode.INVALID_PARAM, "task_ids must be 1..100", { field: "task_ids" });
    }
    const ids = taskIds.map((id) => {
      try {
        return BigInt(id);
      } catch {
        throw new AppError(ErrorCode.INVALID_PARAM, `invalid task id: ${id}`, { field: "task_ids" });
      }
    });
    const rows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.spaceId, BigInt(spaceId)), inArray(tasks.id, ids)));

    const byId = new Map(rows.map((row) => [String(row.id), row]));
    const items = taskIds
      .map((id) => byId.get(id))
      .filter((row): row is TaskRow => Boolean(row))
      .map((row) => ({
        task_id: String(row.id),
        status: row.status,
        progress: row.progress,
        mode: row.mode,
        capability: row.capability,
        results: row.results,
        error: row.error,
        finished_at: row.finishedAt?.toISOString() ?? null,
      }));
    const missing = taskIds.filter((id) => !byId.has(id));
    return { items, missing };
  }

  /**
   * 重新生成（对照竞品 `task regenerate`）。
   *
   * 与 `retry` 的语义差别（竞品把两者分得很清楚，我们照做）：
   *   - `retry`：**失败重试**，只允许失败/超时态，attempt_no = 原 +1，同一 dedupe 家族；
   *   - `regenerate`：**同参再来一次**，成功态也允许（"这张不满意，再出一版"），
   *     是新任务的起点（attempt_no=1，origin_task_id 指向原任务，便于"看同一提示词的历史版本"）。
   * 幂等：传 `idempotency_key` 时 dedupe_key = `regen:<origin>:<key>`，重复点只产生一个任务。
   */
  async regenerate(spaceId: string, id: string, idempotencyKey?: string): Promise<TaskDto> {
    const origin = await this.findTask(spaceId, id);
    if (origin.status === TaskStatus.PENDING || origin.status === TaskStatus.RUNNING) {
      throw new AppError(ErrorCode.INVALID_PARAM, "task still running; wait or cancel it first", {
        field: "id",
      });
    }
    const dedupeKey = `regen:${origin.id}:${idempotencyKey?.trim() || newId()}`;
    const [existing] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.spaceId, origin.spaceId), eq(tasks.dedupeKey, dedupeKey)));
    if (existing) return this.toDto(existing);

    const model = await this.models.findById(origin.modelId);
    const request: GenerationRequest = {
      mode: origin.mode as GenerationMode,
      model: model.name,
      scene: (origin.scene as SceneKey | null) ?? null,
      input: origin.input as GenerationInput,
      options: origin.options as GenerationOptions,
    };
    const priced = await this.credits.price(request, spaceId);
    if (!priced.sufficient) throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, "Insufficient Balance");

    const taskId = newId();
    const row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(tasks)
        .values({
          id: taskId,
          spaceId: origin.spaceId,
          userId: origin.userId,
          episodeId: origin.episodeId,
          shotId: origin.shotId,
          attemptNo: 1,
          originTaskId: origin.id,
          capability: origin.capability,
          mode: origin.mode,
          scene: origin.scene,
          modelId: origin.modelId,
          input: origin.input,
          options: origin.options,
          status: TaskStatus.PENDING,
          progress: 0,
          creditsFrozen: priced.credits,
          dedupeKey,
        })
        .returning();
      await freezeCredits(tx, {
        spaceId: origin.spaceId,
        cost: priced.credits,
        taskId,
        memo: "regenerate freeze",
      });
      await tx.insert(taskEvents).values({
        id: newId(),
        taskId,
        type: "task.regenerated",
        payload: { origin_task_id: String(origin.id) },
      });
      if (!inserted) throw new Error("insert task failed");
      return inserted;
    });

    await this.queue.enqueueTask(String(taskId));
    return this.toDto(row);
  }

  /**
   * 结果反馈（对照竞品 `task feedback`）。
   *
   * 双写是**故意的**，两处各有唯一职责：
   *   1. `tasks.feedback`（读侧）：agent 域已在这个 jsonb 上提供写口（`{reaction,comment}`），
   *      页面/agent 读同一列就能拿到"最近一次反馈"，不能再开第二份真相；
   *   2. `task_events`（审计侧）：反馈是事件流里的一条，重复提交要能追溯"改过什么"。
   * 合并而非覆盖 `tasks.feedback`：agent 写的 `reaction` 不会被这里的 `rating` 冲掉。
   */
  async feedback(
    spaceId: string,
    userId: string,
    id: string,
    input: { rating: number; comment?: string; tags?: string[] },
  ) {
    const row = await this.findTask(spaceId, id);
    const payload = {
      rating: input.rating,
      comment: input.comment ?? "",
      tags: input.tags ?? [],
      user_id: userId,
    };
    const existingFeedback =
      row.feedback && typeof row.feedback === "object" ? (row.feedback as Record<string, unknown>) : {};
    await db
      .update(tasks)
      .set({
        feedback: { ...existingFeedback, ...payload },
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, row.id));

    const [previous] = await db
      .select()
      .from(taskEvents)
      .where(and(eq(taskEvents.taskId, row.id), eq(taskEvents.type, "task.feedback")))
      .orderBy(desc(taskEvents.createdAt))
      .limit(1);
    if (previous) {
      const previousPayload =
        previous.payload && typeof previous.payload === "object"
          ? (previous.payload as Record<string, unknown>)
          : {};
      await db
        .update(taskEvents)
        .set({ payload: { ...previousPayload, ...payload }, createdAt: new Date() })
        .where(eq(taskEvents.id, previous.id));
      return { ok: true, updated: true, rating: input.rating };
    }
    await db.insert(taskEvents).values({
      id: newId(),
      taskId: row.id,
      type: "task.feedback",
      payload,
    });
    return { ok: true, updated: false, rating: input.rating };
  }

  private async findTask(spaceId: string, id: string): Promise<TaskRow> {
    let bigId: bigint;
    try {
      bigId = BigInt(id);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid task id", { field: "id" });
    }
    const [row] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, bigId), eq(tasks.spaceId, BigInt(spaceId))));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "task not found");
    return row;
  }

  /**
   * 分享页「打包下载」（模块 #26 收尾）。
   *
   * ## 越权边界（这是本方法唯一需要小心的地方）
   * 请求方是**匿名访客**，只有 token。因此：
   * 1. 绝不接受客户端传 `task_ids`——打包范围**只由 share 行决定**（`share.taskId`）；
   * 2. 取任务时同时校验 `tasks.spaceId === share.spaceId`，防止历史脏数据把
   *    A 空间的 share 指到 B 空间的任务上导致跨租户读取；
   * 3. 返回体只有公开字段（zip 的 manifest 里不含 space_id / user_id / 积分）。
   *
   * 与 `batchDownload` 的关系：这里复用同一条"读存储 → 组 zip → put → 签名"路径，
   * 但**不复用它的入参**（那个版本按 space 鉴权、可传任意 task_ids，两个威胁模型不能混）。
   */
  async publicShareDownload(token: string) {
    const [share] = await db.select().from(taskShares).where(eq(taskShares.token, token));
    if (!share || share.revokedAt || share.expiresAt.getTime() <= Date.now()) {
      throw new AppError(ErrorCode.NOT_FOUND, "share not found or expired");
    }
    const [row] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, share.taskId), eq(tasks.spaceId, share.spaceId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "task not found");

    const results = Array.isArray(row.results) ? (row.results as Array<{ uri?: string }>) : [];
    if (results.length === 0) throw new AppError(ErrorCode.NOT_FOUND, "no downloadable results");

    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const files: string[] = [];
    for (let i = 0; i < results.length; i += 1) {
      const uri = results[i]?.uri;
      if (!uri) continue;
      try {
        const data = /^https?:\/\//.test(uri)
          ? Buffer.from(await (await fetch(uri)).arrayBuffer())
          : /^[a-z][a-z0-9+.-]*:\/\//i.test(uri)
            ? null
            : await this.storage.read(uri);
        if (!data) continue;
        const ext = uri.split(".").pop()?.toLowerCase() || "bin";
        const name = `result-${i + 1}.${ext}`;
        zip.file(name, data);
        files.push(name);
      } catch {
        // 单个产物失败不阻断整包
      }
    }
    if (files.length === 0) throw new AppError(ErrorCode.NOT_FOUND, "no downloadable results");

    zip.file(
      "manifest.json",
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          mode: row.mode,
          task_id: String(row.id),
          files,
        },
        null,
        2,
      ),
    );
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const key = `u/${String(share.spaceId)}/shares/${newId()}.zip`;
    await this.storage.put(key, buffer, "application/zip");
    const url = await this.storage.signDownload(key, 3600);
    return {
      url,
      filename: `share-${String(row.id)}-${files.length}.zip`,
      count: files.length,
      expires_in: 3600,
    };
  }
}
