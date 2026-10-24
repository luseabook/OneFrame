import { resolve } from "node:path";
import { Worker } from "bullmq";
import pino from "pino";
import { createDb } from "@app/db";
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
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

log.info(
  { queues: Object.values(QUEUES), pid: process.pid, adapterMode: adapterOptions.mode },
  "[worker] started",
);
