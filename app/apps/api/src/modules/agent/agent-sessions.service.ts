import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { agentMessages, agentSessions, canvases } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import type { CanvasScope } from "./agent.types";

export interface AgentSessionDto {
  session_id: string;
  title: string;
  status: number;
  scope: number;
  canvas_id: string | null;
  last_active_at: string | null;
  created_at: string;
  message_count: number;
  last_message_preview: string;
}

@Injectable()
export class AgentSessionsService {
  /**
   * 校验会话归属（space 隔离是硬约束：跨 space 一律按"不存在"处理，
   * 避免用 403 泄漏"这个 id 存在但不是你的"）。
   */
  async requireSession(spaceId: string, sessionId: string): Promise<typeof agentSessions.$inferSelect> {
    let id: bigint;
    try {
      id = BigInt(sessionId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid session_id", { field: "session_id" });
    }
    const [row] = await db
      .select()
      .from(agentSessions)
      .where(
        and(
          eq(agentSessions.id, id),
          eq(agentSessions.spaceId, BigInt(spaceId)),
          isNull(agentSessions.deletedAt),
        ),
      );
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "session not found", { session_id: sessionId });
    return row;
  }

  /** 画布内会话必须挂在属于本 space 且未删除的画布上 */
  async assertCanvas(spaceId: string, canvasId: string): Promise<void> {
    let id: bigint;
    try {
      id = BigInt(canvasId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid canvas_id", { field: "canvas_id" });
    }
    const [row] = await db
      .select({ id: canvases.id })
      .from(canvases)
      .where(and(eq(canvases.id, id), eq(canvases.spaceId, BigInt(spaceId)), isNull(canvases.deletedAt)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "canvas not found", { canvas_id: canvasId });
  }

  async list(
    scope: CanvasScope,
    page = 1,
    pageSize = 20,
  ): Promise<{ list: AgentSessionDto[]; total: number; page: number; page_size: number }> {
    const size = Math.min(Math.max(1, pageSize), 100);
    const offset = (Math.max(1, page) - 1) * size;
    const where = scope.canvasId
      ? and(
          eq(agentSessions.spaceId, BigInt(scope.spaceId)),
          eq(agentSessions.scope, 2),
          eq(agentSessions.canvasId, BigInt(scope.canvasId)),
          isNull(agentSessions.deletedAt),
        )
      : and(
          eq(agentSessions.spaceId, BigInt(scope.spaceId)),
          eq(agentSessions.scope, 1),
          isNull(agentSessions.deletedAt),
        );

    const rows = await db
      .select()
      .from(agentSessions)
      .where(where)
      // NULLS LAST：从未活跃过的会话不该抢在活跃会话前面
      .orderBy(sql`${agentSessions.lastActiveAt} desc nulls last`, desc(agentSessions.createdAt))
      .limit(size)
      .offset(offset);

    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(agentSessions)
      .where(where);

    const stats = await this.statsFor(rows.map((row) => row.id));
    return {
      list: rows.map((row) => this.toDto(row, stats.get(String(row.id)))),
      total: countRow?.total ?? 0,
      page: Math.max(1, page),
      page_size: size,
    };
  }

  private async statsFor(ids: bigint[]): Promise<Map<string, { count: number; last: string }>> {
    const out = new Map<string, { count: number; last: string }>();
    if (ids.length === 0) return out;
    const rows = await db
      .select({
        sessionId: agentMessages.sessionId,
        count: sql<number>`count(*)::int`,
        last: sql<string>`(array_agg(${agentMessages.content} order by ${agentMessages.seq} desc))[1]`,
      })
      .from(agentMessages)
      .where(inArray(agentMessages.sessionId, ids))
      .groupBy(agentMessages.sessionId);
    for (const row of rows) {
      out.set(String(row.sessionId), { count: row.count, last: row.last ?? "" });
    }
    return out;
  }

  async create(input: {
    spaceId: string;
    userId: string;
    canvasId?: string | null;
    title?: string;
  }): Promise<AgentSessionDto> {
    const scope = input.canvasId ? 2 : 1;
    if (input.canvasId) await this.assertCanvas(input.spaceId, input.canvasId);
    const id = newId();
    const [row] = await db
      .insert(agentSessions)
      .values({
        id,
        spaceId: BigInt(input.spaceId),
        scope,
        canvasId: input.canvasId ? BigInt(input.canvasId) : null,
        title: input.title?.trim() ?? "",
        status: 1,
        createdBy: BigInt(input.userId),
        lastActiveAt: new Date(),
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "session create failed");
    return this.toDto(row, undefined);
  }

  async update(
    spaceId: string,
    sessionId: string,
    input: { title?: string; status?: number },
  ): Promise<AgentSessionDto> {
    const session = await this.requireSession(spaceId, sessionId);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.status !== undefined) {
      if (![1, 2, 3].includes(input.status)) {
        throw new AppError(ErrorCode.INVALID_PARAM, "status must be 1|2|3", { field: "status" });
      }
      patch.status = input.status;
    }
    const [row] = await db
      .update(agentSessions)
      .set(patch)
      .where(eq(agentSessions.id, session.id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "session update failed");
    const stats = await this.statsFor([row.id]);
    return this.toDto(row, stats.get(String(row.id)));
  }

  /** 软删：消息与事件保留（分享链接/审计仍要看得到历史），只挡列表与读取 */
  async remove(spaceId: string, sessionId: string): Promise<{ ok: boolean }> {
    const session = await this.requireSession(spaceId, sessionId);
    await db
      .update(agentSessions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(agentSessions.id, session.id));
    return { ok: true };
  }

  async touch(sessionId: bigint): Promise<void> {
    await db
      .update(agentSessions)
      .set({ lastActiveAt: new Date(), updatedAt: new Date() })
      .where(eq(agentSessions.id, sessionId));
  }

  /**
   * 未读数：按"用户读到第几号消息"与"当前最大 seq"的差计算。
   * 不用 `last_read_at` 时间戳：时钟回拨/并发写入下时间比较会出现负未读。
   */
  async unreadCount(sessionId: bigint): Promise<number> {
    const [row] = await db
      .select({ maxSeq: sql<number>`coalesce(max(${agentMessages.seq}), 0)::int` })
      .from(agentMessages)
      .where(eq(agentMessages.sessionId, sessionId));
    const [session] = await db
      .select({ lastReadSeq: agentSessions.lastReadSeq })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId));
    return Math.max(0, (row?.maxSeq ?? 0) - (session?.lastReadSeq ?? 0));
  }

  async markRead(sessionId: bigint, lastReadSeq: number): Promise<number> {
    await db
      .update(agentSessions)
      .set({ lastReadSeq, updatedAt: new Date() })
      .where(eq(agentSessions.id, sessionId));
    return this.unreadCount(sessionId);
  }

  private toDto(
    row: typeof agentSessions.$inferSelect,
    stats: { count: number; last: string } | undefined,
  ): AgentSessionDto {
    return {
      session_id: String(row.id),
      title: row.title,
      status: row.status,
      scope: row.scope,
      canvas_id: row.canvasId === null ? null : String(row.canvasId),
      last_active_at: row.lastActiveAt ? row.lastActiveAt.toISOString() : null,
      created_at: row.createdAt.toISOString(),
      message_count: stats?.count ?? 0,
      last_message_preview: (stats?.last ?? "").slice(0, 80),
    };
  }
}
