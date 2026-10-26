import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { agentEvents, agentMessageBindings, agentMessages, agentSessions } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { lockSession } from "./agent-events.service";
import type { AgentContentType, AgentMessageDto, AgentRole } from "./agent.types";

export interface AppendMessageInput {
  spaceId: bigint;
  sessionId: bigint;
  role: AgentRole;
  content: string;
  contentType?: AgentContentType;
  payload?: Record<string, unknown>;
  taskId?: bigint | null;
  createdBy?: bigint | null;
}

@Injectable()
export class AgentMessagesService {
  /**
   * 追加消息。
   *
   * seq 用会话级 advisory lock 串行分配（与事件同一把锁），保证"先发的消息
   * 序号一定更小"——否则前端按 seq 排序会出现回复插到提问前面。
   *
   * 注意：**消息与事件是两次写入**，理论上存在"消息落库、事件没落"的窗口。
   * 这是有意的取舍：ADR-012 规定 REST 是权威、SSE 只是加速器，
   * 漏一帧可由轮询 `GET …/messages` 补齐；反过来为了原子性把两张表的
   * 写入塞进一个事务，会让事件表承担消息表的锁竞争，得不偿失。
   */
  async append(input: AppendMessageInput): Promise<AgentMessageDto> {
    const row = await db.transaction(async (tx) => {
      await lockSession(tx, input.sessionId);
      // 消息序号与事件序号是两条独立的单调轴（前者是展示序、后者是续传序），
      // 各自在同一把会话锁下自增，互不干扰
      const [seqRow] = await tx
        .select({ maxSeq: sql<string>`coalesce(max(${agentMessages.seq}), 0)::text` })
        .from(agentMessages)
        .where(eq(agentMessages.sessionId, input.sessionId));
      const seq = Number(BigInt(seqRow?.maxSeq ?? "0") + 1n);
      const [created] = await tx
        .insert(agentMessages)
        .values({
          id: newId(),
          spaceId: input.spaceId,
          sessionId: input.sessionId,
          role: input.role,
          content: input.content,
          contentType: input.contentType ?? 1,
          payload: input.payload ?? {},
          taskId: input.taskId ?? null,
          seq,
          createdBy: input.createdBy ?? null,
        })
        .returning();
      if (!created) throw new AppError(ErrorCode.INTERNAL, "message insert failed");
      return created;
    });
    return this.toDto(row);
  }

  /**
   * 按游标分页。
   *
   * `after_event_id` 是**不透明游标**（我们返回什么，客户端就回传什么）。
   * 参照站的参数名指向事件 id，但消息与事件并非 1:1，用事件 id 反查消息要
   * 额外 join；把游标定义成"上一批最后一条消息的 seq"既保持参数名对齐，
   * 又不必为分页引入映射表。SSE 续传走的是真实的 `last_stream_id`，两者互不干扰。
   */
  async list(
    sessionId: bigint,
    afterCursor: string | undefined,
    pageSize: number,
  ): Promise<{ list: AgentMessageDto[]; next_event_id: string | null; has_more: boolean }> {
    const size = Math.min(Math.max(1, pageSize), 200);
    let afterSeq = 0;
    if (afterCursor) {
      const parsed = Number(afterCursor);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new AppError(ErrorCode.INVALID_PARAM, "invalid after_event_id", { field: "after_event_id" });
      }
      afterSeq = parsed;
    }
    const rows = await db
      .select()
      .from(agentMessages)
      .where(and(eq(agentMessages.sessionId, sessionId), gt(agentMessages.seq, afterSeq)))
      .orderBy(asc(agentMessages.seq))
      .limit(size + 1);

    const hasMore = rows.length > size;
    const page = hasMore ? rows.slice(0, size) : rows;
    const last = page[page.length - 1];
    return {
      list: page.map((row) => this.toDto(row)),
      next_event_id: last ? String(last.seq) : null,
      has_more: hasMore,
    };
  }

  async requireMessage(
    sessionId: bigint,
    messageId: string,
  ): Promise<typeof agentMessages.$inferSelect> {
    let id: bigint;
    try {
      id = BigInt(messageId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid message_id", { field: "message_id" });
    }
    const [row] = await db
      .select()
      .from(agentMessages)
      .where(and(eq(agentMessages.id, id), eq(agentMessages.sessionId, sessionId)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "message not found", { message_id: messageId });
    return row;
  }

  /** 0 无 / 1 赞 / 2 踩 / 3 已取消（"取消"保留原值语义，便于统计撤销率） */
  async setReaction(
    sessionId: bigint,
    messageId: string,
    reaction: "like" | "dislike" | "none",
  ): Promise<{ ok: boolean }> {
    const message = await this.requireMessage(sessionId, messageId);
    if (message.role === 1) {
      // 给自己的提问点赞没有意义，且会让"回答质量"统计失真
      throw new AppError(ErrorCode.INVALID_PARAM, "cannot react to your own message", {
        field: "message_id",
      });
    }
    const value = reaction === "like" ? 1 : reaction === "dislike" ? 2 : 0;
    await db
      .update(agentMessages)
      .set({ reaction: value, updatedAt: new Date() })
      .where(eq(agentMessages.id, message.id));
    return { ok: true };
  }

  /** 消息 ↔ 节点绑定：幂等（重复绑定同一节点只更新 kind） */
  async bindNodes(
    spaceId: bigint,
    sessionId: bigint,
    messageId: string,
    nodeIds: string[],
    bindingKind = 1,
  ): Promise<{ bound: number }> {
    const message = await this.requireMessage(sessionId, messageId);
    if (message.spaceId !== spaceId) {
      throw new AppError(ErrorCode.NOT_FOUND, "message not found", { message_id: messageId });
    }
    const ids: bigint[] = [];
    for (const raw of nodeIds) {
      try {
        ids.push(BigInt(raw));
      } catch {
        throw new AppError(ErrorCode.INVALID_PARAM, "invalid node id", { field: "node_ids", value: raw });
      }
    }
    if (ids.length === 0) return { bound: 0 };
    await db
      .insert(agentMessageBindings)
      .values(
        ids.map((nodeId) => ({
          id: newId(),
          spaceId,
          messageId: message.id,
          nodeId,
          bindingKind,
        })),
      )
      .onConflictDoUpdate({
        target: [agentMessageBindings.messageId, agentMessageBindings.nodeId],
        set: { bindingKind, updatedAt: new Date() },
      });
    return { bound: ids.length };
  }

  /**
   * 历史产出：只取"助手 + 带 nodes 的卡片消息"，即真正给出过可落地节点的那些。
   * 用途是让用户回头复用之前生成过的节点方案，而不是再翻一遍聊天记录。
   */
  async writingOutputs(
    spaceId: string,
    canvasId: string | null,
    page: number,
    pageSize: number,
  ): Promise<{ list: AgentMessageDto[]; total: number; page: number; page_size: number }> {
    const size = Math.min(Math.max(1, pageSize), 100);
    const offset = (Math.max(1, page) - 1) * size;
    const scopeFilter = canvasId
      ? sql`${agentSessions.canvasId} = ${BigInt(canvasId)}`
      : sql`${agentSessions.scope} = 1`;
    const where = and(
      eq(agentMessages.spaceId, BigInt(spaceId)),
      eq(agentMessages.role, 2),
      sql`jsonb_array_length(${agentMessages.payload} -> 'nodes') > 0`,
      sql`exists (select 1 from ${agentSessions} where ${agentSessions.id} = ${agentMessages.sessionId} and ${agentSessions.deletedAt} is null and ${scopeFilter})`,
    );

    const rows = await db
      .select()
      .from(agentMessages)
      .where(where)
      .orderBy(desc(agentMessages.createdAt))
      .limit(size)
      .offset(offset);
    const [countRow] = await db.select({ total: sql<number>`count(*)::int` }).from(agentMessages).where(where);
    return {
      list: rows.map((row) => this.toDto(row)),
      total: countRow?.total ?? 0,
      page: Math.max(1, page),
      page_size: size,
    };
  }

  /** 供 SSE 复用的"消息 → 事件 stream_id"约定：`m<message_id>` */
  streamIdFor(messageId: bigint): string {
    return `m${messageId}`;
  }

  /** 找出某条消息对应的事件（续传/回放时对齐游标用） */
  async eventIdFor(sessionId: bigint, messageId: bigint): Promise<string | null> {
    const [row] = await db
      .select({ streamId: agentEvents.streamId })
      .from(agentEvents)
      .where(
        and(
          eq(agentEvents.sessionId, sessionId),
          eq(agentEvents.streamId, this.streamIdFor(messageId)),
        ),
      );
    return row?.streamId ?? null;
  }

  private toDto(row: typeof agentMessages.$inferSelect): AgentMessageDto {
    return {
      message_id: String(row.id),
      role: row.role as AgentRole,
      content: row.content,
      content_type: row.contentType as AgentContentType,
      payload: row.payload as Record<string, unknown>,
      task_id: row.taskId === null ? null : String(row.taskId),
      seq: row.seq,
      created_at: row.createdAt.toISOString(),
      reaction: row.reaction,
    };
  }
}
