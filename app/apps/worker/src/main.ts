import { Worker } from "bullmq";
import pino from "pino";
import { eq } from "drizzle-orm";
import {
  createDb,
  settleCredits,
  taskEvents,
  tasks,
  unfreezeCredits,
} from "@app/db";
import { newId, TaskStatus } from "@app/shared";
import { QUEUES, redisConnection, type QueueName } from "./queues";

const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["job.data.access_token", "*.access_token"], // observability §1：token 禁入日志
});

const { db } = createDb(process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/app");
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// P1 mock 执行器：真实适配器在 WBS 1.4/1.5 接入后替换 submit/poll；
// 任务状态机、记账结算与事件链路保持不变。
async function executeGeneration(taskId: string): Promise<void> {
  const id = BigInt(taskId);

  await db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).for("update");
    if (!task) throw new Error(`task not found: ${taskId}`);
    if (task.status !== TaskStatus.PENDING && task.status !== TaskStatus.RUNNING) return;
    await tx
      .update(tasks)
      .set({ status: TaskStatus.RUNNING, progress: 10, updatedAt: new Date() })
      .where(eq(tasks.id, id));
    await tx.insert(taskEvents).values({
      id: newId(),
      taskId: id,
      type: "task.running",
      payload: { mock: true },
    });
  });

  await sleep(1200);

  await db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).for("update");
    if (!task) return;
    if (
      task.status === TaskStatus.CANCELED ||
      task.status === TaskStatus.SUCCEEDED ||
      task.status === TaskStatus.FAILED
    ) {
      return;
    }

    const results = [
      {
        uri: `mock://results/${taskId}.mp4`,
        preview_uri: `mock://results/${taskId}.jpg`,
        duration_s: task.options && typeof task.options === "object" ? 5 : 5,
        width: 720,
        height: 1280,
        meta: { mock: true },
      },
    ];
    await tx
      .update(tasks)
      .set({
        status: TaskStatus.SUCCEEDED,
        progress: 100,
        results,
        creditsSettled: task.creditsFrozen,
        finishedAt: new Date(),
        expireAt: new Date(Date.now() + 90 * 24 * 3600 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id));
    if (task.creditsFrozen > 0) {
      await settleCredits(tx, {
        spaceId: task.spaceId,
        cost: task.creditsFrozen,
        taskId: id,
        memo: "mock success settle",
      });
    }
    await tx.insert(taskEvents).values({
      id: newId(),
      taskId: id,
      type: "task.succeeded",
      payload: { mock: true },
    });
  });
}

async function failGeneration(taskId: string, error: unknown): Promise<void> {
  const id = BigInt(taskId);
  await db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, id)).for("update");
    if (!task) return;
    if (task.status === TaskStatus.SUCCEEDED || task.status === TaskStatus.FAILED) return;
    if (task.creditsFrozen > 0) {
      await unfreezeCredits(tx, {
        spaceId: task.spaceId,
        cost: task.creditsFrozen,
        taskId: id,
        memo: "task failed refund",
      });
    }
    await tx
      .update(tasks)
      .set({
        status: TaskStatus.FAILED,
        error: {
          kind: "mock_error",
          message: error instanceof Error ? error.message : String(error),
        },
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id));
    await tx.insert(taskEvents).values({
      id: newId(),
      taskId: id,
      type: "task.failed",
      payload: { mock: true },
    });
  });
}

const workers: Worker[] = (Object.values(QUEUES) as QueueName[]).map((name) =>
  new Worker(
    name,
    async (job) => {
      if (name === QUEUES.GEN_SUBMIT) {
        const taskId = (job.data as { taskId?: string }).taskId;
        if (!taskId) throw new Error("missing taskId");
        try {
          await executeGeneration(taskId);
          return { ok: true, taskId };
        } catch (error) {
          await failGeneration(taskId, error);
          throw error;
        }
      }
      log.info({ queue: name, job_id: job.id }, "job received (no-op)");
      return { ok: true };
    },
    {
      connection: redisConnection,
      concurrency: 5,
    },
  ).on("error", (err) => log.error({ queue: name, err: err.message }, "worker error")),
);

const heartbeat = setInterval(() => log.info({ running: workers.length }, "worker heartbeat"), 30_000);

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(heartbeat);
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

log.info({ queues: Object.values(QUEUES), pid: process.pid }, "[worker] started (mock generation executor)");
