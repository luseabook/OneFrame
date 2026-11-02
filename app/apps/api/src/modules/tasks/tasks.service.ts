import { randomBytes } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  freezeCredits,
  releaseFrozen,
  taskFolders,
  taskEvents,
  taskOutstandingFrozen,
  taskShares,
  tasks,
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
import { toBigId } from "../../common/bigid";
import { QueueService } from "../../queue/queue.service";
import { StorageService } from "../../storage/storage.service";
import { env } from "../../config/env";
import { CreditsService } from "../credits/credits.service";
import { ModelsService } from "../models/models.service";
import {
  fetchGuarded,
  resolveDownloadLimits,
  resolveUriPolicy,
  safeUriForLog,
  type CanvasDownloadPolicy,
  type DownloadLimits,
} from "../canvas/canvas-download.guard";

type TaskRow = typeof tasks.$inferSelect;

/**
 * 任务产物 URI 的拉取策略（PR-04 同源收口）。
 *
 * `batchDownload` 与匿名 `publicShareDownload` 都会把 `tasks.results[].uri` 交给服务端
 * 去读，而这个字段和 canvas 的 `params.result_uri` 一样是"用户可达的任意 URI"：
 * 原来两处都是裸 `fetch(uri)` + `arrayBuffer()`（无白名单/无超时/无上限，产物还能
 * 从 zip 里回读）。这里复用 `canvas/canvas-download.guard` 的同一套判定与限额，
 * **不复制第二套逻辑**（两份判定必然漂移，漂移的那一份就是下一个洞）。
 */
const URI_POLICY: CanvasDownloadPolicy = resolveUriPolicy(env);
const DOWNLOAD_LIMITS: DownloadLimits = resolveDownloadLimits(env);

/**
 * 分享页「打包下载」的同步打包上限（产物文件数）。
 *
 * 该端点是**匿名公开**的，每次请求都要把产物读进内存再 zip：不设上限时一个
 * 100+ 产物的分享就能吃满进程内存，且没有用户态可供异步任务回查。
 * 详见 `publicShareDownload` 的注释。
 */
const MAX_SHARE_PACK_FILES = 100;

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
  folder_id?: string | null;
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger("tasks.download");

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
      folder_id: row.folderId ? String(row.folderId) : null,
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
      .where(and(eq(tasks.spaceId, BigInt(spaceId)), inArray(tasks.id, parsed), isNull(tasks.deletedAt)));
    return rows.map((row) => this.toDto(row));
  }

  async list(
    spaceId: string,
    query: {
      page?: number;
      page_size?: number;
      status?: number;
      capability?: string;
      mode?: string;
      folder_id?: string | null;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20));
    const conditions = [eq(tasks.spaceId, BigInt(spaceId)), isNull(tasks.deletedAt)];
    if (query.status !== undefined) conditions.push(eq(tasks.status, query.status));
    if (query.capability) conditions.push(eq(tasks.capability, query.capability));
    /**
     * `mode` 过滤（第 93 批加）：`capability=speech` 下面既有 tts 也有 voice_clone，
     * 「我的音色」只认后者。做成服务级参数而**不**给 `GET /tasks` 开放 `mode` 查询参数：
     * 对外暴露会让「按能力筛」和「按工具筛」两套语义在同一个端点上打架，
     * 而这张表的读接口必须留在 TasksService 里（ADR：禁止跨模块直查 tasks）。
     */
    if (query.mode) conditions.push(eq(tasks.mode, query.mode));
    if (query.folder_id === null) {
      conditions.push(isNull(tasks.folderId));
    } else if (query.folder_id !== undefined) {
      let folderId: bigint;
      try {
        folderId = BigInt(query.folder_id);
      } catch {
        throw new AppError(ErrorCode.INVALID_PARAM, "invalid folder_id", { field: "folder_id" });
      }
      const [folder] = await db
        .select({ id: taskFolders.id })
        .from(taskFolders)
        .where(and(eq(taskFolders.id, folderId), eq(taskFolders.spaceId, BigInt(spaceId))));
      if (!folder) throw new AppError(ErrorCode.NOT_FOUND, "task folder not found");
      conditions.push(eq(tasks.folderId, folderId));
    }
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

  async listFolders(spaceId: string) {
    const rows = await db
      .select({
        id: taskFolders.id,
        name: taskFolders.name,
        created_at: taskFolders.createdAt,
        task_count: sql<number>`(select count(*)::int from tasks t where t.folder_id = task_folders.id and t.deleted_at is null)`,
      })
      .from(taskFolders)
      .where(eq(taskFolders.spaceId, BigInt(spaceId)))
      .orderBy(asc(taskFolders.createdAt));
    return {
      list: rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        task_count: row.task_count,
        created_at: row.created_at.toISOString(),
      })),
    };
  }

  async createFolder(spaceId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new AppError(ErrorCode.INVALID_PARAM, "folder name is required", { field: "name" });
    try {
      const [row] = await db
        .insert(taskFolders)
        .values({ id: newId(), spaceId: BigInt(spaceId), name: trimmed.slice(0, 80) })
        .returning();
      return { id: String(row!.id), name: row!.name, task_count: 0, created_at: row!.createdAt.toISOString() };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new AppError(ErrorCode.INVALID_PARAM, "folder name already exists", { field: "name" });
      }
      throw error;
    }
  }

  async renameFolder(spaceId: string, folderId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new AppError(ErrorCode.INVALID_PARAM, "folder name is required", { field: "name" });
    try {
      const [row] = await db
        .update(taskFolders)
        .set({ name: trimmed.slice(0, 80), updatedAt: new Date() })
        .where(and(eq(taskFolders.id, toBigId(folderId, "folder_id")), eq(taskFolders.spaceId, BigInt(spaceId))))
        .returning();
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "task folder not found");
      return { id: String(row.id), name: row.name };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new AppError(ErrorCode.INVALID_PARAM, "folder name already exists", { field: "name" });
      }
      throw error;
    }
  }

  async deleteFolder(spaceId: string, folderId: string) {
    const id = toBigId(folderId, "folder_id");
    return db.transaction(async (tx) => {
      const [folder] = await tx
        .select({ id: taskFolders.id })
        .from(taskFolders)
        .where(and(eq(taskFolders.id, id), eq(taskFolders.spaceId, BigInt(spaceId))))
        .for("update");
      if (!folder) throw new AppError(ErrorCode.NOT_FOUND, "task folder not found");
      await tx
        .update(tasks)
        .set({ folderId: null, updatedAt: new Date() })
        .where(and(eq(tasks.spaceId, BigInt(spaceId)), eq(tasks.folderId, id)));
      await tx.delete(taskFolders).where(eq(taskFolders.id, id));
      return { ok: true };
    });
  }

  async assignFolder(spaceId: string, taskId: string, folderIdRaw: string | null) {
    const task = await this.findTask(spaceId, taskId);
    let folderId: bigint | null = null;
    if (folderIdRaw !== null) {
      folderId = toBigId(folderIdRaw, "folder_id");
      const [folder] = await db
        .select({ id: taskFolders.id })
        .from(taskFolders)
        .where(and(eq(taskFolders.id, folderId), eq(taskFolders.spaceId, BigInt(spaceId))));
      if (!folder) throw new AppError(ErrorCode.NOT_FOUND, "task folder not found");
    }
    const [updated] = await db
      .update(tasks)
      .set({ folderId, updatedAt: new Date() })
      .where(and(eq(tasks.id, task.id), eq(tasks.spaceId, BigInt(spaceId))))
      .returning();
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "task not found");
    return this.toDto(updated);
  }

  async detail(spaceId: string, id: string) {
    const row = await this.findTask(spaceId, id);
    const events = await db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, row.id))
      .orderBy(desc(taskEvents.createdAt));
    /**
     * 成功态给每个产物补**现签 URL**（结果在库里只存 storage key：`u/<space>/tasks/<id>/r0.png`）。
     *
     * 为什么在这里签而不是让前端逐张调 `/tasks/:id/results/:n/download-url`：
     * 结果页要**直接渲染图片**，逐张签名意味着 N 次请求 + N 次往返；而轮询期（1/2 态）
     * 结果为空、不会产生额外签名开销。只为**已完成**的任务签，且最多签 8 张——
     * 防止极端批量任务把一次详情请求变成几十次对象存储调用。
     *
     * `uri` 仍原样保留（CLI/脚本与旧前端在用），新增 `url` 是纯增量。
     */
    const rawResults = Array.isArray(row.results) ? (row.results as Array<{ uri?: string; text?: string }>) : [];
    const shouldSign = row.status === TaskStatus.SUCCEEDED;
    const results = rawResults.length
      ? await Promise.all(
          rawResults.map(async (item, index) => {
            if (!item.uri) return item;
            const isStorageKey = !/^[a-z][a-z0-9+.-]*:\/\//i.test(item.uri);
            if (!shouldSign || !isStorageKey || index >= 8) return item;
            try {
              return {
                ...item,
                url: await this.storage.signDownload(spaceId, item.uri, 3600),
              };
            } catch {
              // 签名失败不影响详情可用性（前端可退化为 download-url 接口）
              return item;
            }
          }),
        )
      : rawResults;
    return {
      ...this.toDto(row),
      results,
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
        .where(
          and(eq(tasks.id, toBigId(id, "id")), eq(tasks.spaceId, BigInt(spaceId)), isNull(tasks.deletedAt)),
        )
        .for("update");
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "task not found");
      if (row.status !== TaskStatus.PENDING && row.status !== TaskStatus.RUNNING) {
        throw new AppError(ErrorCode.CANCEL_NOT_ALLOWED, "task already finished");
      }
      // 取消 = unfreeze（PR-03）：不再用 `creditsFrozen > 0` 判据（那字段曾经只增不减、
      // 恒真），改由 ledger 的流水口径算额度，并顺带把字段归零。
      // 归零之后 worker 的 fail() 再进来时 outstanding 已为 0 —— 只标状态、不再退钱。
      await releaseFrozen(tx, {
        spaceId: row.spaceId,
        taskId: row.id,
        disposition: "unfreeze",
        memo: "cancel task",
      });
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

  /**
   * 删除任务记录（软删；第 72 批）。
   *
   * 竞品：`DELETE /web/v1/task/{task_id}`（`commands/task.md:195`「删除任务记录」，支持 `--dry-run` /
   * `--idempotency-key`）。
   *
   * 三条判断，缺一条就会变成「删了不该删的」：
   * 1. **只允许终态**（3 成功 / 4 失败 / 5 取消 / 7 驳回）：1 排队、2 运行、6 审核中还在飞 —— 删记录
   *    不会停止上游生成，用户以为删掉了、后台还在跑还会回写结果。想删就先用 `task cancel`。
   * 2. **不允许带着冻结积分**：终态理论上已结算或已解冻，但历史脏数据可能存在；带冻结就删会让那笔钱永远悬着。
   *    ⚠️ 判据必须取**流水口径**（`Σ frozen_delta where ref_task_id`），不能取 `tasks.credits_frozen`：
   *    那个字段在 PR-03 之前从未被写回过 0，于是 `creditsFrozen > 0` 恒真 ——
   *    「任何计价 > 0 的任务永久删不掉」。反过来，历史脏行可能字段非 0 而流水早已结清，
   *    按字段判会继续误拒。两条都只有按流水判才是对的。
   * 3. **软删而不是物理删**：`canvas_nodes.task_id`、`assets.source_task_id` 有外键，
   *    `credit_flows.ref_task_id` 是对账依据 —— 物理删要么被外键拒绝，要么把「这张图是哪次生成出来的」
   *    这条链剪断。软删只影响**读**（列表 / 详情 / 下载 / 公开分享都不再返回它）。
   */
  async remove(spaceId: string, id: string) {
    const row = await this.findTask(spaceId, id);
    const running =
      row.status === TaskStatus.PENDING ||
      row.status === TaskStatus.RUNNING ||
      row.status === TaskStatus.REVIEWING;
    if (running) {
      throw new AppError(ErrorCode.INVALID_PARAM, "task is still running; cancel it before deleting", {
        field: "id",
      });
    }
    // 与释放共用同一把尺子（ledger.ts 的 taskOutstandingFrozen），并在事务里复查一遍：
    // 判定与软删之间若有人刚好解冻/再冻结，按事务外读到的值删就会删错。
    const [updated, outstanding] = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(tasks).where(eq(tasks.id, row.id)).for("update");
      if (!locked) return [null, 0] as const;
      const pending = await taskOutstandingFrozen(tx, row.id);
      if (pending > 0) return [null, pending] as const;
      const rows = await tx
        .update(tasks)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(tasks.id, row.id))
        .returning();
      return [rows[0] ?? null, 0] as const;
    });
    if (outstanding > 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "task still holds frozen credits", {
        field: "id",
        credits_frozen: outstanding,
      });
    }
    return { deleted: true, task_id: String(row.id), status: (updated ?? row).status };
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

  /**
   * 读取一条任务产物（PR-04 同源收口）。
   *
   * http(s) 一律走共用守卫：协议白名单 → host 白名单（未配置=仅存储 host）
   * → IP/DNS 内网黑名单（存储自身 origin 例外）→ 10s 超时 → 流式大小上限
   * → 3xx 逐跳复检。
   * `mock://` 这类假协议返回 null（沿用既有语义：不是真实文件，跳过）；
   * 无协议的相对 key 是自有存储对象，走 `storage.read`（不经过网络）。
   *
   * 返回值语义与收口前一致（null = 这条结果没有可打包内容），**不把拒绝抛给上层**：
   * 批量下载的合同是"单个结果失败不阻断整包"，一条坏 uri 不能把整包打成 400101。
   * 拒绝原因进结构化日志（见 `logResultSkip`），不留静默吞掉的路径。
   */
  private async readResultUri(spaceId: string, uri: string): Promise<Buffer | null> {
    if (/^https?:\/\//i.test(uri)) return fetchGuarded(uri, URI_POLICY, DOWNLOAD_LIMITS);
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return null;
    return this.storage.read(spaceId, uri);
  }

  /**
   * 跳过单个产物的结构化日志：`task_id` / `reason` / `host` / `status`。
   * 只写去掉 query 的 URI —— 签名参数（`X-Amz-Signature`/`sig`）不能进日志。
   */
  private logResultSkip(taskId: bigint, uri: string, error: unknown): void {
    const base = { msg: "tasks.download.skip", task_id: String(taskId), uri: safeUriForLog(uri) };
    if (error instanceof AppError) {
      const details = (error.details ?? {}) as { reason?: unknown; host?: unknown; status?: unknown };
      this.logger.warn(
        JSON.stringify({
          ...base,
          code: error.code,
          reason: typeof details.reason === "string" ? details.reason : "unknown",
          host: typeof details.host === "string" ? details.host : null,
          ...(typeof details.status === "number" ? { status: details.status } : {}),
        }),
      );
      return;
    }
    this.logger.warn(
      JSON.stringify({
        ...base,
        reason: "read_failed",
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
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
          isNull(tasks.deletedAt),
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
          const data = await this.readResultUri(spaceId, uri);
          if (!data) continue;
          const ext = uri.split(".").pop()?.toLowerCase() || "bin";
          const name = `task-${row.id}-${i + 1}.${ext}`;
          zip.file(name, data);
          files.push(name);
          count += 1;
        } catch (error) {
          // 单个结果失败不阻断整包（沿用既有语义）；但被守卫拒绝必须留痕，
          // 否则"有人在拿批量下载探测内网"这件事永远不可见。
          this.logResultSkip(row.id, uri, error);
        }
      }
      manifest.push({ task_id: String(row.id), files });
    }
    if (count === 0) throw new AppError(ErrorCode.NOT_FOUND, "no downloadable results");
    zip.file("manifest.json", JSON.stringify({ generated_at: new Date().toISOString(), tasks: manifest }, null, 2));
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const key = `u/${spaceId}/downloads/${newId()}.zip`;
    await this.storage.put(spaceId, key, buffer, "application/zip");
    const url = await this.storage.signDownload(spaceId, key, 3600);
    return { url, filename: `tasks-${rows.length}-${count}.zip`, count, expires_in: 3600 };
  }

  async downloadUrl(spaceId: string, id: string, index: number) {
    const row = await this.findTask(spaceId, id);
    const results = Array.isArray(row.results)
      ? (row.results as Array<{ uri?: string }>)
      : [];
    const item = results[index - 1];
    if (!item?.uri) throw new AppError(ErrorCode.NOT_FOUND, "result not found");
    const signed = await this.signResult(spaceId, row.id, index, item.uri);
    if (!signed.url) throw new AppError(ErrorCode.NOT_FOUND, "result object not found");
    return signed;
  }

  /**
   * 一次拿回该任务**全部结果**的下载地址（竞品 `POST /task/{task_id}/download` 的形状）。
   *
   * 为什么不是 zip：竞品这条 `responseBodyType: json`（不是 `raw`），所以它回的是 URL 列表；
   * 打包下载是另一条 `POST /task/result/batch-download`（我方已有 `POST /tasks/batch-download`）。
   *
   * 两个取舍：
   * - **空槽跳过并计数**（`results[i]` 只有 `preview_uri` 没有 `uri` 的情形），不让一个坏槽
   *   把整单打进 404 —— 单条接口可以报「这条结果不存在」，批量接口不能。
   * - 每个 URL 独立 24h（与单条同口径），一致而不是「iOS 一份、批量一份」。
   */
  async downloadUrls(spaceId: string, id: string) {
    const row = await this.findTask(spaceId, id);
    const results = Array.isArray(row.results)
      ? (row.results as Array<{ uri?: string }>)
      : [];
    const items: Array<{ index: number; url: string; filename: string; expires_in: number }> = [];
    let skipped = 0;
    for (let i = 0; i < results.length; i += 1) {
      const uri = results[i]?.uri;
      if (!uri) {
        skipped += 1;
        continue;
      }
      const signed = await this.signResult(spaceId, row.id, i + 1, uri);
      if (!signed.url) {
        skipped += 1;
        continue;
      }
      items.push({
        index: i + 1,
        url: signed.url,
        filename: signed.filename,
        expires_in: signed.expires_in,
      });
    }
    return { task_id: String(row.id), count: items.length, skipped, items, expires_in: 86_400 };
  }

  /** 存储 key（无协议前缀）→ 预签名；mock/外部 URL 原样返回 */
  private async signResult(spaceId: string, taskId: bigint, index: number, uri: string) {
    const isStorageKey = !/^[a-z][a-z0-9+.-]*:\/\//i.test(uri);
    const url = isStorageKey
      ? await this.storage.signDownload(spaceId, uri, 86_400).catch(() => null)
      : uri;
    const ext = uri.split(".").pop()?.toLowerCase() || "bin";
    return { url, filename: `task-${taskId}-${index}.${ext}`, expires_in: 86_400 };
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
      .where(and(eq(tasks.id, share.taskId), eq(tasks.spaceId, share.spaceId), isNull(tasks.deletedAt)));
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
          ? await this.storage
              .signDownload(String(row.spaceId), item.uri, 3600)
              .catch(() => "")
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
      .where(and(eq(tasks.spaceId, BigInt(spaceId)), inArray(tasks.id, ids), isNull(tasks.deletedAt)));

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
      .where(and(eq(tasks.id, bigId), eq(tasks.spaceId, BigInt(spaceId)), isNull(tasks.deletedAt)));
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
      .where(and(eq(tasks.id, share.taskId), eq(tasks.spaceId, share.spaceId), isNull(tasks.deletedAt)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "task not found");

    const results = Array.isArray(row.results) ? (row.results as Array<{ uri?: string }>) : [];
    if (results.length === 0) throw new AppError(ErrorCode.NOT_FOUND, "no downloadable results");
    /**
     * 同步打包上限：**>100 个产物直接拒**，不做异步任务化。
     *
     * 为什么要有上限：这是匿名公开端点，一个请求就要把 N 个对象读进内存 + zip 压缩，
     * 116 个 4K 视频能轻松吃满进程内存（同步打包把请求拖死，还会连累同进程的其它接口）。
     * 为什么不改成"202 + 任务态"：该端点无鉴权、无用户态可用（匿名访客没有任务中心），
     * 异步化的结果没有地方可查、也没法回调，反而增加一个可被滥用的长任务入口。
     * 真正的大批量下载走登录态 `POST /tasks/batch-download`（有鉴权、有配额、可审计）。
     */
    if (results.length > MAX_SHARE_PACK_FILES) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        `too many files (${results.length} > ${MAX_SHARE_PACK_FILES}), use task batch-download`,
        { field: "files", max: MAX_SHARE_PACK_FILES, actual: results.length },
      );
    }

    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const files: string[] = [];
    for (let i = 0; i < results.length; i += 1) {
      const uri = results[i]?.uri;
      if (!uri) continue;
      try {
        const data = await this.readResultUri(String(share.spaceId), uri);
        if (!data) continue;
        const ext = uri.split(".").pop()?.toLowerCase() || "bin";
        const name = `result-${i + 1}.${ext}`;
        zip.file(name, data);
        files.push(name);
      } catch (error) {
        // 单个产物失败不阻断整包（沿用既有语义），拒绝原因进结构化日志
        this.logResultSkip(row.id, uri, error);
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
    await this.storage.put(String(share.spaceId), key, buffer, "application/zip");
    const url = await this.storage.signDownload(String(share.spaceId), key, 3600);
    return {
      url,
      filename: `share-${String(row.id)}-${files.length}.zip`,
      count: files.length,
      expires_in: 3600,
    };
  }
}
