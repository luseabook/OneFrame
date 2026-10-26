import { Inject, Injectable } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { taskEvents, tasks } from "@app/db";
import { AppError, ErrorCode } from "@app/shared";
import { db } from "../../db/database";
import { AgentEventsService, type AgentEventFrame } from "./agent-events.service";

/** 心跳间隔：低于常见网关 30s 空闲断连阈值 */
const HEARTBEAT_MS = 15_000;
/** 兜底轮询：多实例场景本进程收不到总线通知，靠它补齐（ADR-012 双通道） */
const POLL_MS = 2_000;
/** 任务终态集合：进入终态后服务端主动收尾，避免前端挂一条永不断的连接 */
const TERMINAL_STATUS = [3, 4, 5, 7];

/**
 * SSE 输出通道。
 *
 * 为什么直写 `reply.raw` 而不是 Nest 的返回值：SSE 是一条长连接字节流，
 * 全局 `EnvelopeInterceptor` 会把返回值包成 JSON 信封，因此这些路由必须
 * 同时打 `@SkipEnvelope()`；写头也必须绕开 Fastify 的 reply 生命周期，
 * 否则框架会在处理函数返回时补一个 JSON body 把流冲掉。
 */
@Injectable()
export class AgentStreamService {
  constructor(@Inject(AgentEventsService) private readonly events: AgentEventsService) {}

  /**
   * 会话事件流。
   *
   * 首次连接（无游标）**不重放**历史：客户端已经用 `GET …/messages` 拉过全量，
   * 再重放一遍会让消息重复。带 `last_stream_id` 时重放增量，游标过期 → 746004。
   */
  async pipeSession(reply: FastifyReply, sessionId: bigint, lastStreamId?: string): Promise<void> {
    let cursor: bigint;
    let initial: AgentEventFrame[] = [];
    if (lastStreamId) {
      cursor = await this.events.resolveCursor(sessionId, lastStreamId);
      initial = await this.events.replay(sessionId, cursor);
    } else {
      // 定位到当前队尾：只推"从现在开始"的新事件
      cursor = await this.events.lastSeq(sessionId);
    }

    return this.run(reply, {
      label: `session:${sessionId}`,
      initial,
      startSeq: cursor,
      subscribe: (onFrame) => this.events.subscribe(String(sessionId), onFrame),
      poll: (afterSeq) => this.events.since(sessionId, afterSeq),
    });
  }

  /** 任务进度流（`GET /agent/task/stream`）：只推状态与结果指针，不推二进制 */
  async pipeTask(reply: FastifyReply, spaceId: string, taskId: string): Promise<void> {
    let id: bigint;
    try {
      id = BigInt(taskId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid task_id", { field: "task_id" });
    }
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.spaceId, BigInt(spaceId))));
    if (!task) throw new AppError(ErrorCode.NOT_FOUND, "task not found", { task_id: taskId });

    const events = await db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, id))
      .orderBy(asc(taskEvents.createdAt));
    const initial: AgentEventFrame[] = events.map((event, index) => ({
      id: `t${event.id}`,
      type: "task_progress",
      seq: index + 1,
      payload: { task_id: taskId, ...(event.payload as Record<string, unknown>) },
    }));

    let lastStatus = task.status;
    let lastProgress = task.progress;
    return this.run(reply, {
      label: `task:${taskId}`,
      initial,
      startSeq: BigInt(initial.length),
      subscribe: () => () => undefined,
      poll: async (afterSeq) => {
        const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
        if (!row) return [];
        const changed = row.status !== lastStatus || row.progress !== lastProgress;
        if (!changed) return [];
        lastStatus = row.status;
        lastProgress = row.progress;
        return [
          {
            id: `t${row.updatedAt.getTime()}`,
            type: "task_progress",
            seq: Number(afterSeq) + 1,
            payload: {
              task_id: taskId,
              status: row.status,
              progress: row.progress,
              results: row.results ?? null,
              error: row.error ?? null,
            },
          },
        ];
      },
      isDone: async () => {
        const [row] = await db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, id));
        return !!row && TERMINAL_STATUS.includes(row.status);
      },
    });
  }

  private run(
    reply: FastifyReply,
    flow: {
      label: string;
      initial: AgentEventFrame[];
      startSeq: bigint;
      subscribe: (onFrame: (frame: AgentEventFrame) => void) => () => void;
      poll: (afterSeq: bigint) => Promise<AgentEventFrame[]>;
      isDone?: () => Promise<boolean>;
    },
  ): Promise<void> {
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 关掉反代的响应缓冲，否则 SSE 会被攒成一坨才吐出来
      "X-Accel-Buffering": "no",
    });

    let lastSent = flow.startSeq;
    let closed = false;
    // 先占位再在 Promise 里赋值：轮询回调与连接关闭回调都要能调用它
    let finish: () => void = () => {
      closed = true;
    };

    const write = (chunk: string): void => {
      if (!closed) raw.write(chunk);
    };
    const send = (frame: AgentEventFrame): void => {
      if (frame.seq <= Number(lastSent)) return;
      lastSent = BigInt(frame.seq);
      // data 里重复携带 id/type：客户端既可能只读 `id:` 字段，也可能只解 JSON（契约 A-04 两种都兼容）
      write(
        `id: ${frame.id}\nevent: ${frame.type}\ndata: ${JSON.stringify({
          id: frame.id,
          type: frame.type,
          seq: frame.seq,
          payload: frame.payload,
        })}\n\n`,
      );
    };

    flow.initial.forEach(send);
    const unsubscribe = flow.subscribe(send);
    const heartbeat = setInterval(() => write(`event: ping\ndata: {"ts":${Date.now()}}\n\n`), HEARTBEAT_MS);
    const poller = setInterval(() => {
      void (async () => {
        try {
          const frames = await flow.poll(lastSent);
          frames.forEach(send);
          if (flow.isDone && (await flow.isDone())) finish();
        } catch {
          // 单轮轮询失败不改变行为：连接存亡交给客户端心跳/重连判定
        }
      })();
    }, POLL_MS);

    return new Promise<void>((resolve) => {
      finish = (): void => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearInterval(poller);
        unsubscribe();
        try {
          raw.end();
        } catch {
          // 连接已断，end 抛错无需处理
        }
        resolve();
      };
      raw.on("close", finish);
      raw.on("error", finish);
    });
  }
}
