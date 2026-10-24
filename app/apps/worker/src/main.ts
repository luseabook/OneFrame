import { Worker } from "bullmq";
import pino from "pino";
import { QUEUES, redisConnection, type QueueName } from "./queues";

const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["job.data.access_token", "*.access_token"], // observability §1：token 禁入日志
});

// P0 骨架：三队列 Worker 空转占位（DoD：杀进程可恢复、优雅退出）
// P1 在此挂真实编排：submit→适配器 / poll→退避重排 / transfer→OSS 转存+结算
const workers: Worker[] = (Object.values(QUEUES) as QueueName[]).map((name) =>
  new Worker(
    name,
    async (job) => {
      log.info({ queue: name, job_id: job.id, name: job.name }, "job received (P0 no-op)");
      return { ok: true };
    },
    {
      connection: { ...redisConnection, maxRetriesPerRequest: null },
      concurrency: 5,
    },
  ).on("error", (err) => log.error({ queue: name, err: err.message }, "worker error")),
);

const heartbeat = setInterval(
  () => log.info({ running: workers.length }, "worker heartbeat"),
  30_000,
);

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(heartbeat);
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

log.info(
  { queues: Object.values(QUEUES), pid: process.pid },
  "[worker] started (P0 no-op handlers)",
);
