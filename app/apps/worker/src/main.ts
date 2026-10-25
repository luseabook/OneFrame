import { resolve } from "node:path";
import { Worker } from "bullmq";
import pino from "pino";
import { createDb } from "@app/db";
import { assertWorkerEnv } from "./env-guard";
import { auditLedger, expireShares, purgeOldData, reconcileOrders, reviveStuckTasks } from "./maintenance";
import type { AdapterRuntimeOptions } from "@app/model-adapters";
import { createStorage } from "@app/storage";
import { QUEUES, redisConnection, type QueueName } from "./queues";
import { runGenerationTask, type ExecutorDeps } from "./executor";
import { runExport } from "./export";
import { runTimelineExport } from "./timeline-export";

const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["job.data.access_token", "*.access_token"], // observability §1：token 禁入日志
});

// 生产启动守卫（fail fast）：NODE_ENV=production 时禁止 ADAPTER_MODE=mock，
// 且必须至少配置一种真实供应商，否则直接拒绝启动（错误信息不含密钥值）。
assertWorkerEnv(process.env);

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

/** env 里的 JSON 映射（如 ARK_MODEL_MAP）解析失败时忽略，交由适配器按原样发送 */
function parseJsonRecord(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return undefined;
  }
}

/** 逗号分隔的 adapter_code 列表（ARK_IMAGE_REPLACE_CODES） */
function parseCodeList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
}

const arkModelMap = parseJsonRecord(process.env.ARK_MODEL_MAP);

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
          modelMap: arkModelMap,
        },
        // 图像（Seedream）与视频共用 ARK_API_KEY；模型映射/超时可独立配置
        arkImage: {
          apiKey: process.env.ARK_API_KEY,
          baseUrl: process.env.ARK_IMAGE_BASE_URL ?? process.env.ARK_BASE_URL,
          modelMap: parseJsonRecord(process.env.ARK_IMAGE_MODEL_MAP) ?? arkModelMap,
          responseFormat: process.env.ARK_IMAGE_RESPONSE_FORMAT === "b64_json" ? "b64_json" : "url",
          watermark: process.env.ARK_IMAGE_WATERMARK !== "false",
          timeoutMs: Number(process.env.ARK_IMAGE_TIMEOUT_MS ?? 120_000),
        },
      }
    : {}),
  // 运营显式选择：把既有 adapter_code（如 tomoviee:image）路由到 Ark 图像；未配置时保持原报错
  arkImageCodes: parseCodeList(process.env.ARK_IMAGE_REPLACE_CODES),
  ...(process.env.HTTP_VIDEO_BASE_URL
    ? {
        httpVideo: {
          baseUrl: process.env.HTTP_VIDEO_BASE_URL,
          apiKey: process.env.HTTP_VIDEO_API_KEY,
          submitPath: process.env.HTTP_VIDEO_SUBMIT_PATH,
          pollPath: process.env.HTTP_VIDEO_POLL_PATH,
          cancelPath: process.env.HTTP_VIDEO_CANCEL_PATH,
          modelMap: parseJsonRecord(process.env.HTTP_VIDEO_MODEL_MAP),
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

// P7 成片合成：ffmpeg 路径可配（默认 PATH）；mock 模式下源视频为占位字节 → 回退色板
const timelineExportDeps = {
  db,
  storage,
  ffmpegPath: process.env.FFMPEG_PATH,
  ffprobePath: process.env.FFPROBE_PATH,
  adapterMode: adapterOptions.mode,
  aiLabel,
  log: (obj: Record<string, unknown>, msg: string) => log.info(obj, msg),
};

// ── 定时维护（deployment.md §7）──
// 各任务频率不同，因此拆成多个独立定时器，而不是塞进一个 6h 的大任务里。
// 资金相关（对账/看门狗）必须高频，否则用户付了钱没到账、或积分永久冻结。
async function safeRun(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    log.warn({ task: name, err: err instanceof Error ? err.message : String(err) }, "maintenance task failed");
  }
}

function schedule(name: string, intervalMs: number, fn: () => Promise<unknown>, runOnStart = false): void {
  if (intervalMs <= 0) {
    log.info({ task: name }, "maintenance task disabled (interval<=0)");
    return;
  }
  if (runOnStart) void safeRun(name, fn);
  const timer = setInterval(() => void safeRun(name, fn), intervalMs);
  timer.unref();
}

// 订单对账（5min）：已支付未入账 → 补账；待支付超时 → 关闭
schedule(
  "orders-reconcile",
  Number(process.env.ORDERS_RECONCILE_INTERVAL_MS ?? 5 * 60_000),
  async () => {
    const n = await reconcileOrders(db, log);
    if (n > 0) log.warn({ reconciled: n }, "orders reconciled");
  },
  true,
);

// 任务看门狗（1min）：卡死的任务置失败并解冻积分
schedule(
  "tasks-watchdog",
  Number(process.env.TASKS_WATCHDOG_INTERVAL_MS ?? 60_000),
  async () => {
    const n = await reviveStuckTasks(db, log);
    if (n > 0) log.warn({ revived: n }, "stuck tasks revived");
  },
  true,
);

// 分享过期清理（1h）
schedule("shares-expire", Number(process.env.SHARES_EXPIRE_INTERVAL_MS ?? 3_600_000), () => expireShares(db, log));

// 资金对账（每日）：balance == Σdelta 不平即告警
schedule(
  "flows-audit",
  Number(process.env.FLOWS_AUDIT_INTERVAL_MS ?? 86_400_000),
  async () => {
    const mismatch = await auditLedger(db, log);
    if (mismatch === 0) log.info("ledger audit ok");
  },
  true,
);

// 数据保留清理（6h）：结果 90 天 / 回收站 7 天 / 注销 30 天
schedule(
  "retention-purge",
  Number(process.env.MAINTENANCE_INTERVAL_MS ?? 6 * 3_600_000),
  () => purgeOldData(db, log),
  true,
);

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
      if (name === QUEUES.TIMELINE_EXPORT) {
        const exportId = (job.data as { exportId?: string }).exportId;
        if (!exportId) throw new Error("missing exportId");
        await runTimelineExport(exportId, timelineExportDeps);
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
