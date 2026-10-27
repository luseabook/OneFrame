import { Injectable } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { and, eq, gt } from "drizzle-orm";
import { taskEvents, taskShares, tasks } from "@app/db";
import { AppError, ErrorCode } from "@app/shared";
import { db } from "../../db/database";

/**
 * 公开分享链接的**只读实时流**（SSE）。
 *
 * 为什么需要：分享出去的链接目前只有"读一次快照"（`GET /share/:token`），
 * 观看者只能手动刷新才知道任务有没有跑完。对"分享给客户看进度"这个高频场景，
 * 静态快照等于不可用。
 *
 * 安全边界（比登录侧更严，因为**只认 token 不认身份**）：
 * 1. 只推该 share 行绑定的那一个 task，绝不接受 task_id 入参（越权读取=事故）；
 * 2. 只推**状态/进度/事件类型**，不推 storage key、不推积分字段、不推 space/user；
 * 3. 分享被撤销/过期 → 立刻以 `event: revoked` 收尾并断开（避免"撤销了还能看进度"）；
 * 4. 任务进入终态（3 成功 / 4 失败 / 5 取消）→ 推一条 `event: done` 后关闭连接，
 *    不让浏览器挂着一个永不结束的 SSE。
 *
 * 实现说明（诚实标注）：本仓没有跨进程事件总线，这里用**轮询 task 行 + task_events 增量**
 * 的方式喂 SSE（默认 1s 一次）。对"分钟级"的图像/视频任务足够；真正的发布订阅要等
 * Redis Pub/Sub 落地，届时只需替换 `pollOnce`。
 */
@Injectable()
export class ShareStreamService {
  /** 心跳：反代/浏览器都会掐掉长时间无数据的连接 */
  private static readonly HEARTBEAT_MS = 15_000;
  /** 轮询间隔：任务进度本身就是秒级粒度，1s 足够且不会打爆库 */
  private static readonly POLL_MS = 1_000;
  /** 单条连接最长存活（默认 10min；到点主动收尾，让客户端重连） */
  private static readonly MAX_LIFETIME_MS = 600_000;

  constructor() {}

  /** 校验 token 并取出 share+task（撤销/过期一律 404，不泄露"存在但被撤销"） */
  private async resolve(token: string): Promise<{
    shareId: bigint;
    spaceId: bigint;
    taskId: bigint;
  }> {
    const clean = String(token ?? "").trim();
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(clean)) {
      throw new AppError(ErrorCode.NOT_FOUND, "share not found or expired");
    }
    const [share] = await db.select().from(taskShares).where(eq(taskShares.token, clean));
    if (!share || share.revokedAt || share.expiresAt.getTime() <= Date.now()) {
      throw new AppError(ErrorCode.NOT_FOUND, "share not found or expired");
    }
    return { shareId: share.id as bigint, spaceId: share.spaceId as bigint, taskId: share.taskId as bigint };
  }

  /** 读当前进度 + 自 afterId 之后的新事件（不推产物内容，只推类型与时间） */
  private async pollOnce(
    spaceId: bigint,
    taskId: bigint,
    afterEventId: bigint,
  ): Promise<{
    status: number;
    progress: number;
    finished: boolean;
    events: Array<{ id: bigint; type: string; at: string }>;
  } | null> {
    const [row] = await db
      .select({
        status: tasks.status,
        progress: tasks.progress,
        finishedAt: tasks.finishedAt,
      })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.spaceId, spaceId)));
    if (!row) return null;
    const events = await db
      .select({ id: taskEvents.id, type: taskEvents.type, createdAt: taskEvents.createdAt })
      .from(taskEvents)
      .where(and(eq(taskEvents.taskId, taskId), gt(taskEvents.id, afterEventId)))
      .limit(50);
    return {
      status: Number(row.status),
      progress: Number(row.progress ?? 0),
      finished: row.finishedAt !== null || [3, 4, 5].includes(Number(row.status)),
      events: events.map((e) => ({ id: e.id as bigint, type: String(e.type), at: e.createdAt.toISOString() })),
    };
  }

  async pipe(reply: FastifyReply, token: string, timeoutMs?: number): Promise<void> {
    const { spaceId, taskId } = await this.resolve(token);
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const maxLifetime = Math.min(
      ShareStreamService.MAX_LIFETIME_MS,
      Math.max(1_000, Number(timeoutMs ?? ShareStreamService.MAX_LIFETIME_MS)),
    );

    let closed = false;
    let lastStatus = -1;
    let lastProgress = -1;
    let lastEventId = 0n;


    const write = (chunk: string): void => {
      if (!closed) raw.write(chunk);
    };
    const frame = (event: string, data: Record<string, unknown>): void => {
      write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    // 先声明清理器（finish 会在轮询回调里被调用，必须能在 const 之后访问）
    let cleanup: () => void = () => {};
    const finish = (reason: string): void => {
      if (closed) return;
      // 收尾帧必须在置 closed 之前写：write() 在 closed 为真时会丢弃写入，
      // 顺序反了的表现是"客户端永远收不到 closed，只能等超时"（本 spec 实测抓到）。
      raw.write(`event: closed\ndata: ${JSON.stringify({ reason })}\n\n`);
      closed = true;
      cleanup();
      raw.end();
    };

    // 连接建立即回一帧，客户端不必等第一次轮询
    frame("open", { task_id: String(taskId) });

    const tick = async (): Promise<void> => {
      if (closed) return;
      try {
        // 每一轮都重新校验 share：撤销/过期后必须立刻断开
        const check = await db.select({ id: taskShares.id, revokedAt: taskShares.revokedAt, expiresAt: taskShares.expiresAt })
          .from(taskShares)
          .where(and(eq(taskShares.taskId, taskId), eq(taskShares.spaceId, spaceId)));
        const stillValid = check.some((s) => !s.revokedAt && s.expiresAt.getTime() > Date.now());
        if (!stillValid) {
          finish("revoked");
          return;
        }
        const snap = await this.pollOnce(spaceId, taskId, lastEventId);
        if (!snap) {
          finish("not_found");
          return;
        }
        if (snap.status !== lastStatus || snap.progress !== lastProgress) {
          lastStatus = snap.status;
          lastProgress = snap.progress;
          frame("status", { status: snap.status, progress: snap.progress });
        }
        for (const e of snap.events) {
          lastEventId = e.id;
          frame("task_event", { type: e.type, at: e.at });
        }
        if (snap.finished) {
          frame("done", { status: snap.status });
          finish("done");
        }
      } catch {
        // 单轮失败不改行为：连接存亡交给心跳与客户端重连
      }
    };

    const poller = setInterval(() => void tick(), ShareStreamService.POLL_MS);
    const heartbeat = setInterval(() => frame("ping", { ts: Date.now() }), ShareStreamService.HEARTBEAT_MS);
    const lifetime = setTimeout(() => finish("timeout"), maxLifetime);

    cleanup = (): void => {
      clearInterval(poller);
      clearInterval(heartbeat);
      clearTimeout(lifetime);
    };

    reply.raw.on("close", () => {
      closed = true;
      cleanup();
    });

    await tick();
  }
}
