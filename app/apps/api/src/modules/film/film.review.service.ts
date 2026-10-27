import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { filmReviewComments, filmReviewReads, filmReviewVersions, filmTasks } from "@app/db";
import { AppError, ErrorCode, FilmTaskStatus, newId } from "@app/shared";
import { db } from "../../db/database";
import type { FilmTableRow, FilmTaskRow } from "./film.access";
import { FilmRealtimeService } from "./film.realtime";

/**
 * 审核版本链服务 —— 本批**机制 #1**（审核版本链）的全部语义都在这里。
 *
 * 三条不可回退的规则：
 *
 * 1. **版本号不可变且单调递增**：每次提交产生 `V01`/`V02`…（两位补零，>99 自然进位 V100）。
 *    版本行一旦落库就不再重写 `version_no`，驳回后再次提交得到的是**新**版本号，
 *    而不是"复用 V02"——否则"这条意见是针对哪一版提的"就无法回答。
 * 2. **评论挂版本**：`film_review_comments.version_id` 必填。评论挂行不挂版本，
 *    会让 V01 的意见在 V03 上继续显示，审核人会被过期意见误导。
 * 3. **已读按版本**：`film_review_reads` 的唯一键是 (version_id, user_id)。
 *    这样才能表达"我看过 V02 了，但 V03 还没看"，`unread` 才有意义。
 *    用"按行记 last_read_version_no"也能算，但一旦需要"标记某几版已读"就要改表结构。
 *
 * 双轨状态（契约 §6.3 明确要求）：
 * - 行 `film_tasks.status` = 这活到哪一步（1 未开始 / 2 制作中 / 3 提交审核 / 4 驳回 / 5 定稿）
 * - 版本 `film_review_versions.status` = 这一版过没过审（1 待审 / 2 通过 / 3 驳回）
 * 两者不能合并：一次通过后行是 5(done)，但历史版本仍是 approved，语义不同。
 */

export interface FilmReviewVersionRow {
  id: bigint;
  taskId: bigint;
  spaceId: bigint;
  versionNo: string;
  status: number;
  submittedBy: bigint;
  submittedAt: Date;
  decidedBy: bigint | null;
  decidedAt: Date | null;
  assetIds: unknown;
  thumbFileId: string | null;
  decisionComment: string | null;
}

/** 版本号：V01 起，两位补零；>=100 自然进位（不截断、不丢位） */
export function formatVersionNo(n: number): string {
  return `V${String(n).padStart(2, "0")}`;
}

export function parseVersionNo(no: string): number {
  const m = /^V(\d+)$/.exec(no);
  return m ? Number(m[1]) : 0;
}

@Injectable()
export class FilmReviewService {
  constructor(@Inject(FilmRealtimeService) private readonly realtime: FilmRealtimeService) {}

  toView(row: FilmReviewVersionRow, extra: { commentCount: number; readByMe: boolean }) {
    return {
      id: String(row.id),
      version_id: String(row.id),
      task_id: String(row.taskId),
      version_no: row.versionNo,
      status: row.status,
      submitted_by: String(row.submittedBy),
      submitted_at: row.submittedAt.toISOString(),
      decided_by: row.decidedBy ? String(row.decidedBy) : null,
      decided_at: row.decidedAt ? row.decidedAt.toISOString() : null,
      decision_comment: row.decisionComment ?? null,
      asset_ids: Array.isArray(row.assetIds) ? (row.assetIds as string[]) : [],
      thumb_file_id: row.thumbFileId ?? null,
      comment_count: extra.commentCount,
      read_by_me: extra.readByMe,
    };
  }

  /**
   * 登记一个新版本（`review` 提交 与 `submit-result` 共用）。
   *
   * 并发安全：先在事务里对**任务行加锁**（`SELECT ... FOR UPDATE`），再算 max(version_no)。
   * 不加锁时两个并发的"提交"会算出同一个 V03，靠唯一键报错重试反而更差
   * （用户看到一次失败）。锁是行级的，不影响同表其它行。
   */
  async submitVersion(params: {
    table: FilmTableRow;
    task: FilmTaskRow;
    userId: string;
    assetIds: string[];
    thumbFileId?: string;
    comment?: string;
    /** 由画布 submit-result 触发时带上，用于广播事件区分来源 */
    source?: "manual" | "canvas";
    nodeId?: string;
  }) {
    const { table, task, userId } = params;
    const version = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from film_tasks where id = ${task.id} for update`);
      const [maxRow] = (await tx
        .select({ maxNo: sql<string | null>`max(${filmReviewVersions.versionNo})` })
        .from(filmReviewVersions)
        .where(eq(filmReviewVersions.taskId, task.id))) as Array<{ maxNo: string | null }>;
      const nextNo = parseVersionNo(maxRow?.maxNo ?? "V00") + 1;
      const versionNo = formatVersionNo(nextNo);
      const versionId = newId();
      const [inserted] = (await tx
        .insert(filmReviewVersions)
        .values({
          id: versionId,
          taskId: task.id,
          spaceId: task.spaceId,
          versionNo,
          status: 1, // 待审
          submittedBy: BigInt(userId),
          assetIds: params.assetIds,
          thumbFileId: params.thumbFileId ?? null,
        })
        .returning()) as FilmReviewVersionRow[];
      // 行状态推 pending_review：submit-result 之所以是"唯一自动化衔接点"就是因为这一步，
      // 没有它画布产物回填后行还停在"制作中"，审核人永远看不到。
      await tx
        .update(filmTasks)
        .set({
          reviewVersionNo: nextNo,
          status: FilmTaskStatus.PENDING_REVIEW,
          version: sql`${filmTasks.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(filmTasks.id, task.id));
      if (params.comment && params.comment.trim().length > 0) {
        await tx.insert(filmReviewComments).values({
          id: newId(),
          versionId,
          spaceId: task.spaceId,
          authorId: BigInt(userId),
          content: params.comment.trim(),
        });
      }
      return inserted;
    });

    this.realtime.broadcast({
      spaceId: String(table.spaceId),
      projectId: String(table.projectId),
      tableId: String(table.id),
      type: "task.review_submitted",
      payload: {
        task_id: String(task.id),
        version_id: String(version.id),
        version_no: version.versionNo,
        source: params.source ?? "manual",
        node_id: params.nodeId ?? null,
      },
      originUserId: userId,
    });
    return {
      version_id: String(version.id),
      id: String(version.id),
      version_no: version.versionNo,
      status: version.status,
      task_id: String(task.id),
      task_status: FilmTaskStatus.PENDING_REVIEW,
      asset_ids: params.assetIds,
    };
  }

  /** 审核详情：版本链 + 评论 + 我的已读状态（审核抽屉一次拉全） */
  async getReview(spaceId: string, taskId: string, userId: string) {
    const versions = (await db
      .select()
      .from(filmReviewVersions)
      .where(and(eq(filmReviewVersions.taskId, BigInt(taskId)), eq(filmReviewVersions.spaceId, BigInt(spaceId))))
      .orderBy(desc(filmReviewVersions.versionNo))) as FilmReviewVersionRow[];
    const versionIds = versions.map((v) => v.id);
    const comments = versionIds.length
      ? ((await db
          .select()
          .from(filmReviewComments)
          .where(inArray(filmReviewComments.versionId, versionIds))
          .orderBy(asc(filmReviewComments.createdAt))) as Array<{
          id: bigint;
          versionId: bigint;
          authorId: bigint;
          content: string;
          createdAt: Date;
        }>)
      : [];
    const reads = versionIds.length
      ? ((await db
          .select({ versionId: filmReviewReads.versionId })
          .from(filmReviewReads)
          .where(and(inArray(filmReviewReads.versionId, versionIds), eq(filmReviewReads.userId, BigInt(userId))))) as Array<{
          versionId: bigint;
        }>)
      : [];
    const readSet = new Set(reads.map((r) => String(r.versionId)));
    const commentCount = new Map<string, number>();
    for (const c of comments) commentCount.set(String(c.versionId), (commentCount.get(String(c.versionId)) ?? 0) + 1);
    const latest = versions[0] ?? null;
    return {
      task_id: String(taskId),
      latest_version_no: latest?.versionNo ?? null,
      version_id: latest ? String(latest.id) : null,
      thumb_file_id: latest?.thumbFileId ?? null,
      // unread = 我没读过的版本数（不是"有评论就算未读"：已读回执是显式动作）
      unread: versions.filter((v) => !readSet.has(String(v.id))).length,
      versions: versions.map((v) =>
        this.toView(v, {
          commentCount: commentCount.get(String(v.id)) ?? 0,
          readByMe: readSet.has(String(v.id)),
        }),
      ),
      comments: comments.map((c) => ({
        id: String(c.id),
        comment_id: String(c.id),
        version_id: String(c.versionId),
        author_id: String(c.authorId),
        content: c.content,
        created_at: c.createdAt.toISOString(),
      })),
    };
  }

  /** 加评论：必须挂在一个**属于本行**的版本上（跨行/跨租户一律 400102） */
  async addComment(params: { table: FilmTableRow; task: FilmTaskRow; userId: string; versionId: string; content: string }) {
    const [version] = (await db
      .select()
      .from(filmReviewVersions)
      .where(
        and(
          eq(filmReviewVersions.id, BigInt(params.versionId)),
          eq(filmReviewVersions.taskId, params.task.id),
          eq(filmReviewVersions.spaceId, params.task.spaceId),
        ),
      )
      .limit(1)) as FilmReviewVersionRow[];
    if (!version) throw new AppError(ErrorCode.NOT_FOUND, "review version not found");
    const id = newId();
    await db.insert(filmReviewComments).values({
      id,
      versionId: version.id,
      spaceId: params.task.spaceId,
      authorId: BigInt(params.userId),
      content: params.content,
    });
    this.realtime.broadcast({
      spaceId: String(params.table.spaceId),
      projectId: String(params.table.projectId),
      tableId: String(params.table.id),
      type: "review.comment_added",
      payload: { task_id: String(params.task.id), version_id: String(version.id), comment_id: String(id) },
      originUserId: params.userId,
    });
    return { comment_id: String(id), id: String(id), version_id: String(version.id) };
  }

  /** 已读回执：按版本批量标记（重复标记是幂等的，只更新 read_at） */
  async markRead(params: { table: FilmTableRow; task: FilmTaskRow; userId: string; versionIds: string[] }) {
    const rows = (await db
      .select({ id: filmReviewVersions.id })
      .from(filmReviewVersions)
      .where(
        and(
          eq(filmReviewVersions.taskId, params.task.id),
          eq(filmReviewVersions.spaceId, params.task.spaceId),
          inArray(filmReviewVersions.id, params.versionIds.map((v) => BigInt(v))),
        ),
      )) as Array<{ id: bigint }>;
    if (rows.length !== params.versionIds.length) {
      throw new AppError(ErrorCode.NOT_FOUND, "some review versions do not belong to this task");
    }
    for (const row of rows) {
      await db
        .insert(filmReviewReads)
        .values({
          id: newId(),
          versionId: row.id,
          spaceId: params.task.spaceId,
          userId: BigInt(params.userId),
          readAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [filmReviewReads.versionId, filmReviewReads.userId],
          set: { readAt: new Date() },
        });
    }
    return { ok: true, read_version_ids: rows.map((r) => String(r.id)) };
  }

  /**
   * 审核决策（通过/驳回）。
   *
   * 竞品**没有** review/approve|reject 端点（契约 §7 A3 已取证：routes 里不存在），
   * 决策通过 `POST .../tasks/:id/status` 承载 —— 我方照做，但把"落版本状态"这件事
   * 放在这里，保证「行状态」与「版本状态」双轨同时推进，不会一边有一边没有。
   *
   * 不可变性：已经决策过的版本不允许再次决策（`400101 reason=version_immutable`）。
   * 要改判只能等下一版提交——这就是审核链可追溯的代价。
   */
  async decideLatest(params: {
    table: FilmTableRow;
    task: FilmTaskRow;
    userId: string;
    decision: 2 | 3;
    comment?: string;
  }) {
    const version = await db.transaction(async (tx) => {
      const [latest] = (await tx
        .select()
        .from(filmReviewVersions)
        .where(eq(filmReviewVersions.taskId, params.task.id))
        .orderBy(desc(filmReviewVersions.versionNo))
        .limit(1)) as FilmReviewVersionRow[];
      if (!latest) {
        throw new AppError(ErrorCode.INVALID_PARAM, "task has no review version to decide", {
          field: "status",
          reason: "no_review_version",
        });
      }
      if (latest.status !== 1) {
        throw new AppError(ErrorCode.INVALID_PARAM, `version ${latest.versionNo} already decided`, {
          field: "status",
          reason: "version_immutable",
          version_no: latest.versionNo,
        });
      }
      const [updated] = (await tx
        .update(filmReviewVersions)
        .set({
          status: params.decision,
          decidedBy: BigInt(params.userId),
          decidedAt: new Date(),
          decisionComment: params.comment ?? null,
          updatedAt: new Date(),
        })
        .where(eq(filmReviewVersions.id, latest.id))
        .returning()) as FilmReviewVersionRow[];
      return updated;
    });
    this.realtime.broadcast({
      spaceId: String(params.table.spaceId),
      projectId: String(params.table.projectId),
      tableId: String(params.table.id),
      type: "review.decided",
      payload: {
        task_id: String(params.task.id),
        version_id: String(version.id),
        version_no: version.versionNo,
        status: version.status,
      },
      originUserId: params.userId,
    });
    return {
      version_id: String(version.id),
      version_no: version.versionNo,
      status: version.status,
      decision_comment: version.decisionComment ?? null,
    };
  }

  /** 当前行最新版本（`review_ref` 只读列与前端展示用） */
  async latestVersion(taskId: string) {
    const [row] = (await db
      .select()
      .from(filmReviewVersions)
      .where(eq(filmReviewVersions.taskId, BigInt(taskId)))
      .orderBy(desc(filmReviewVersions.versionNo))
      .limit(1)) as FilmReviewVersionRow[];
    return row ?? null;
  }
}
