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
    };
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
      ? (row.results as Array<{ uri?: string; preview_uri?: string; text?: string }>)
      : [];
    const results: Array<{ url: string; preview_url?: string; text?: string }> = [];
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
}
