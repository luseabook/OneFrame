import { EventEmitter } from "node:events";
import { Injectable, Logger } from "@nestjs/common";
import { and, asc, eq, gt, lt, sql } from "drizzle-orm";
import { agentEvents } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";

/**
 * 一帧 SSE 的形态（api-spec §14 agent 段 / 契约 §4.4.1）。
 * `id` 与 `seq` 是两条不同的轴：
 * - `id`（stream_id）是客户端回传的续传游标；
 * - `seq` 是服务端重放用的会话内单调序，客户端不该解释它。
 */
export interface AgentEventFrame {
  id: string;
  type: string;
  seq: number;
  payload: Record<string, unknown>;
}

/** 事件保留期：与 `database.md` §10 对齐（7 天，同分享 token 级） */
const EVENT_TTL_MS = 7 * 24 * 3600 * 1000;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * 会话级串行化：同一会话的消息 seq / 事件 seq 必须严格单调，
 * 并发插入靠 `pg_advisory_xact_lock` 把同一会话的写入排成队。
 * 用事务级 advisory lock 而不是 `MAX(seq)+1` 裸查：后者在两个请求同时到达时
 * 会算出同一个 seq，然后被唯一索引打回 500——那是把并发问题丢给用户。
 */
export async function lockSession(tx: Tx, sessionId: bigint): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`agent_session:${sessionId}`}))`);
}

/** 会话内下一个事件序号（调用方必须已持有会话锁） */
export async function nextEventSeq(tx: Tx, sessionId: bigint): Promise<bigint> {
  const [row] = await tx
    .select({ maxSeq: sql<string>`coalesce(max(${agentEvents.seq}), 0)::text` })
    .from(agentEvents)
    .where(eq(agentEvents.sessionId, sessionId));
  return BigInt(row?.maxSeq ?? "0") + 1n;
}

@Injectable()
export class AgentEventsService {
  private readonly logger = new Logger("agent.events");
  /**
   * 进程内实时通道。DB 才是权威（重启/多实例后靠 replay 补齐，这是
   * ADR-012 "SSE 是通知加速器，不是状态存储" 的直接体现），
   * 这个总线只负责把"刚提交的新事件"立刻推给同进程的 SSE 连接。
   */
  private readonly bus = new EventEmitter();

  constructor() {
    this.bus.setMaxListeners(0);
  }

  subscribe(sessionId: string, handler: (frame: AgentEventFrame) => void): () => void {
    const channel = `agent:${sessionId}`;
    const listener = (frame: AgentEventFrame): void => handler(frame);
    this.bus.on(channel, listener);
    return () => this.bus.off(channel, listener);
  }

  /**
   * 追加事件并（事务提交后）推给同进程订阅者。
   * `streamId` 由调用方决定：消息类事件用 `m<message_id>` 这种确定性 id，
   * 好处是"消息 ↔ 事件"无需再建映射表就能互查。
   */
  async append(input: {
    spaceId: bigint;
    sessionId: bigint;
    type: string;
    payload: Record<string, unknown>;
    taskId?: bigint | null;
    streamId?: string;
  }): Promise<AgentEventFrame> {
    const frame = await db.transaction(async (tx) => {
      await lockSession(tx, input.sessionId);
      const seq = await nextEventSeq(tx, input.sessionId);
      const streamId = input.streamId ?? String(seq);
      await tx.insert(agentEvents).values({
        id: newId(),
        spaceId: input.spaceId,
        sessionId: input.sessionId,
        streamId,
        seq,
        type: input.type,
        payload: input.payload,
        taskId: input.taskId ?? null,
        expiresAt: new Date(Date.now() + EVENT_TTL_MS),
      });
      return { id: streamId, type: input.type, seq: Number(seq), payload: input.payload };
    });

    // 只有在事务成功提交后才广播：回滚的事件绝不能让前端看见
    this.bus.emit(`agent:${input.sessionId}`, frame);
    return frame;
  }

  /**
   * 解析续传游标：`last_stream_id` → 事件 seq。
   * 游标已被清理（超出 7 天保留期）时抛 **746004**——不能复用 400102：
   * 会话还在，只是"增量的起点没了"，前端应拉全量消息后重连（契约 D5）。
   */
  async resolveCursor(sessionId: bigint, lastStreamId: string): Promise<bigint> {
    const [row] = await db
      .select({ seq: agentEvents.seq })
      .from(agentEvents)
      .where(and(eq(agentEvents.sessionId, sessionId), eq(agentEvents.streamId, lastStreamId)));
    if (!row) {
      throw new AppError(ErrorCode.STREAM_CURSOR_EXPIRED, "stream cursor expired, rebuild from full messages", {
        last_stream_id: lastStreamId,
      });
    }
    return row.seq;
  }

  /** 当前队尾 seq（首次建流时用它把"历史"切掉，只推新事件） */
  async lastSeq(sessionId: bigint): Promise<bigint> {
    const [row] = await db
      .select({ maxSeq: sql<string>`coalesce(max(${agentEvents.seq}), 0)::text` })
      .from(agentEvents)
      .where(eq(agentEvents.sessionId, sessionId));
    return BigInt(row?.maxSeq ?? "0");
  }

  /** 重放 seq > afterSeq 的事件（仍下发原 `id:`，客户端游标才能继续推进） */
  async replay(sessionId: bigint, afterSeq: bigint, limit = 500): Promise<AgentEventFrame[]> {
    const rows = await db
      .select()
      .from(agentEvents)
      .where(and(eq(agentEvents.sessionId, sessionId), gt(agentEvents.seq, afterSeq)))
      .orderBy(asc(agentEvents.seq))
      .limit(limit);
    return rows.map((row) => ({
      id: row.streamId,
      type: row.type,
      seq: Number(row.seq),
      payload: row.payload as Record<string, unknown>,
    }));
  }

  /** 兜底轮询：多实例/worker 写入的事件本进程收不到总线通知，由它补齐 */
  async since(sessionId: bigint, afterSeq: bigint, limit = 100): Promise<AgentEventFrame[]> {
    return this.replay(sessionId, afterSeq, limit);
  }

  /** 过期事件清理（机会式调用，不建定时任务：MVP 只有一条低频路径需要它） */
  async purgeExpired(): Promise<number> {
    const rows = await db
      .delete(agentEvents)
      .where(lt(agentEvents.expiresAt, new Date()))
      .returning({ id: agentEvents.id });
    if (rows.length > 0) this.logger.log(`purged ${rows.length} expired agent events`);
    return rows.length;
  }
}
