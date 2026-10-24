import { resolve } from "node:path";
import { Worker } from "bullmq";
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import pino from "pino";
import { assets, createDb, tasks, users } from "@app/db";
import type { AdapterRuntimeOptions } from "@app/model-adapters";
import { createStorage } from "@app/storage";
import { QUEUES, redisConnection, type QueueName } from "./queues";
import { runGenerationTask, type ExecutorDeps } from "./executor";
import { runExport } from "./export";

const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["job.data.access_token", "*.access_token"], // observability §1：token 禁入日志
});

const databaseUrl = process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/app";
const storageDir = process.env.STORAGE_DIR ?? resolve(process.cwd(), "../../data/storage");
const storageDriver = (process.env.STORAGE_DRIVER as "local" | "s3" | undefined) ?? "local";
const storage = createStorage({
  driver: storageDriver,
  rootDir: storageDir,
  publicBaseUrl: process.env.STORAGE_PUBLIC_BASE ?? "http://127.0.0.1:3000/v1",
  signSecret: process.env.STORAGE_SIGN_SECRET ?? "dev-only-storage-sign-secret",
  ...(storageDriver === "s3" && process.env.STORAGE_S3_BUCKET
    ? {
        s3: {
          bucket: process.env.STORAGE_S3_BUCKET,
          region: process.env.STORAGE_S3_REGION ?? "cn-hangzhou",
          endpoint: process.env.STORAGE_S3_ENDPOINT,
          publicEndpoint: process.env.STORAGE_S3_PUBLIC_ENDPOINT,
          forcePathStyle: process.env.STORAGE_S3_FORCE_PATH_STYLE === "true",
          accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID ?? "",
          secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY ?? "",
        },
      }
    : {}),
});

const adapterOptions: AdapterRuntimeOptions = {
  mode: process.env.ADAPTER_MODE === "real" ? "real" : "mock",
  ...(process.env.DEEPSEEK_API_KEY
    ? {
        deepseek: {
          apiKey: process.env.DEEPSEEK_API_KEY,
          baseUrl: process.env.DEEPSEEK_BASE_URL,
          model: process.env.DEEPSEEK_MODEL,
        },
      }
    : {}),
  ...(process.env.ARK_API_KEY
    ? {
        ark: {
          apiKey: process.env.ARK_API_KEY,
          baseUrl: process.env.ARK_BASE_URL,
          modelMap: (() => {
            try {
              return process.env.ARK_MODEL_MAP
                ? (JSON.parse(process.env.ARK_MODEL_MAP) as Record<string, string>)
                : undefined;
            } catch {
              return undefined;
            }
          })(),
        },
      }
    : {}),
  ...(process.env.HTTP_VIDEO_BASE_URL
    ? {
        httpVideo: {
          baseUrl: process.env.HTTP_VIDEO_BASE_URL,
          apiKey: process.env.HTTP_VIDEO_API_KEY,
          submitPath: process.env.HTTP_VIDEO_SUBMIT_PATH,
          pollPath: process.env.HTTP_VIDEO_POLL_PATH,
          cancelPath: process.env.HTTP_VIDEO_CANCEL_PATH,
          modelMap: (() => {
            try {
              return process.env.HTTP_VIDEO_MODEL_MAP
                ? (JSON.parse(process.env.HTTP_VIDEO_MODEL_MAP) as Record<string, string>)
                : undefined;
            } catch {
              return undefined;
            }
          })(),
        },
      }
    : {}),
};

const aiLabel = {
  enabled: process.env.AI_LABEL_ENABLED !== "false",
  text: process.env.AI_LABEL_TEXT ?? "AI生成",
  fontPath: process.env.AI_LABEL_FONT_PATH,
  ffmpegPath: process.env.FFMPEG_PATH,
};

const { db } = createDb(databaseUrl);
const deps: ExecutorDeps = {
  db,
  storage,
  adapterOptions,
  aiLabel,
  log: (obj, msg) => log.info(obj, msg),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 1000),
  maxPollMs: Number(process.env.POLL_MAX_MS ?? 120_000),
};

// 定期维护：任务结果 90 天清理、回收站资产 7 天物理删除（PRD F5）
async function runMaintenance(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - 90 * 86_400_000);
    await db
      .update(tasks)
      .set({ results: [], updatedAt: new Date() })
      .where(and(eq(tasks.status, 3), lt(tasks.updatedAt, cutoff), sql`jsonb_array_length(${tasks.results}) > 0`));
    const deleted = await db
      .delete(assets)
      .where(and(isNotNull(assets.deletedAt), lt(assets.deletedAt, new Date(Date.now() - 7 * 86_400_000))))
      .returning({ id: assets.id });
    // 注销账号满 30 天 → 物理清理（PRD F1）
    const purgedUsers = await db
      .delete(users)
      .where(and(isNotNull(users.deletedAt), lt(users.deletedAt, new Date(Date.now() - 30 * 86_400_000))))
      .returning({ id: users.id });
    log.info({ purged_assets: deleted.length, purged_users: purgedUsers.length }, "maintenance done");
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "maintenance failed");
  }
}
void runMaintenance();
const maintenanceTimer = setInterval(
  () => void runMaintenance(),
  Number(process.env.MAINTENANCE_INTERVAL_MS ?? 6 * 3_600_000),
);
maintenanceTimer.unref();

const workers: Worker[] = (Object.values(QUEUES) as QueueName[]).map((name) =>
  new Worker(
    name,
    async (job) => {
      if (name === QUEUES.GEN_SUBMIT) {
        const taskId = (job.data as { taskId?: string }).taskId;
        if (!taskId) throw new Error("missing taskId");
        await runGenerationTask(taskId, deps);
        return { ok: true, taskId };
      }
      if (name === QUEUES.EXPORT) {
        const exportId = (job.data as { exportId?: string }).exportId;
        if (!exportId) throw new Error("missing exportId");
        await runExport(exportId, { db, storage, log: (obj, msg) => log.info(obj, msg) });
        return { ok: true, exportId };
      }
      log.info({ queue: name, job_id: job.id }, "job received (no-op)");
      return { ok: true };
    },
    {
      connection: redisConnection,
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? 5),
    },
  ).on("error", (err) => log.error({ queue: name, err: err.message }, "worker error")),
);

const heartbeat = setInterval(() => log.info({ running: workers.length }, "worker heartbeat"), 30_000);

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(heartbeat);

  // 停机上限：BullMQ close() 会等当前 job 处理完；超时则强制退出，
  // 避免容器停不下来（未完成的 job 会被 BullMQ 重新投递，不会丢失）
  const timeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 25_000);
  const force = setTimeout(() => {
    log.error({ timeoutMs }, "shutdown timeout, forcing exit");
    process.exit(1);
  }, timeoutMs);
  force.unref();

  try {
    // close() 停止拉取新 job 并等待在途 job 完成
    await Promise.all(workers.map((w) => w.close()));
    clearTimeout(force);
    log.info("closed cleanly");
    process.exit(0);
  } catch (err) {
    clearTimeout(force);
    log.error({ err }, "shutdown error");
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

log.info(
  { queues: Object.values(QUEUES), pid: process.pid, adapterMode: adapterOptions.mode },
  "[worker] started",
);
