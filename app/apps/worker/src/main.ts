import { resolve } from "node:path";
import { Worker, Queue, type Job } from "bullmq";
import pino from "pino";
import { createDb } from "@app/db";
import { timelinePublications } from "@app/db";
import { eq } from "drizzle-orm";
import {
  probeFfmpeg,
  readEnvEnum,
  readEnvFlag,
  readEnvNumber,
  deriveProviderSecretKey,
  STORAGE_DRIVER_SPEC,
  STORAGE_S3_FORCE_PATH_STYLE_SPEC,
} from "@app/shared";
import { assertWorkerEnv } from "./env-guard";
import {
  ADAPTER_MODE_SPEC,
  AI_LABEL_ENABLED_SPEC,
  ARK_IMAGE_RESPONSE_FORMAT_SPEC,
  ARK_IMAGE_WATERMARK_SPEC,
  PROVIDER_DB_RESOLVE_SPEC,
} from "./env-flags";
import {
  auditLedger,
  expireShares,
  purgeOldData,
  reconcileOrders,
  reviveStuckPublications,
  reviveStuckTasks,
} from "./maintenance";
import type { AdapterRuntimeOptions } from "@app/model-adapters";
import { createStorage } from "@app/storage";
import { HANDLED_QUEUES, QUEUES, RESERVED_QUEUES, redisConnection, type HandledQueueName } from "./queues";
import { DEFAULT_MAX_POLL_MS, runGenerationTask, type ExecutorDeps } from "./executor";
import { runExport } from "./export";
import { runTimelineExport } from "./timeline-export";
import { runPublishTranscodeJob, resolvePublicationSourceKey, type PublishTranscodeJobData } from "./publish-transcode";

const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: ["job.data.access_token", "*.access_token"], // observability §1：token 禁入日志
});

// 停机上限（第 123 批）：在**启动时**读一次并校验。旧写法在 shutdown() 里现读，
// `SHUTDOWN_TIMEOUT_MS=30s` 会得到 NaN → 强制退出定时器 0ms 就开火（exit(1)），
// 把还没 drain 完的进程直接杀掉；空白则得到 0，同样立即强杀。
const SHUTDOWN_TIMEOUT_MS = readEnvNumber("SHUTDOWN_TIMEOUT_MS", { default: 25_000, min: 0, integer: true });

// 生产启动守卫（fail fast）：NODE_ENV=production 时禁止 ADAPTER_MODE=mock，
// 且必须至少配置一种真实供应商，否则直接拒绝启动（错误信息不含密钥值）。
assertWorkerEnv(process.env);

const databaseUrl = process.env.DATABASE_URL ?? "postgres://app:app@localhost:5432/app";
const storageDir = process.env.STORAGE_DIR ?? resolve(process.cwd(), "../../data/storage");
// 布尔 / 枚举配置统一走 @app/shared 的唯一入口（第 124 批）：拼错不静默落到另一侧，
// 坏值启动即抛（`STORAGE_DRIVER=S3` 不再被裸转换当成未知驱动）。
const storageDriver = readEnvEnum("STORAGE_DRIVER", STORAGE_DRIVER_SPEC);
const providerDbResolve = readEnvEnum("PROVIDER_DB_RESOLVE", PROVIDER_DB_RESOLVE_SPEC);
const providerSecretMaterial =
  process.env.PROVIDER_ENCRYPTION_KEY?.trim() ||
  (process.env.NODE_ENV === "production"
    ? ""
    : `provider:${process.env.JWT_SECRET?.trim() || "oneframe-local-provider-secret"}`);
const providerSecretKey = providerDbResolve === "off" ? undefined : deriveProviderSecretKey(providerSecretMaterial);
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
          forcePathStyle: readEnvFlag("STORAGE_S3_FORCE_PATH_STYLE", STORAGE_S3_FORCE_PATH_STYLE_SPEC),
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
  mode: readEnvEnum("ADAPTER_MODE", ADAPTER_MODE_SPEC),
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
          responseFormat: readEnvEnum("ARK_IMAGE_RESPONSE_FORMAT", ARK_IMAGE_RESPONSE_FORMAT_SPEC),
          watermark: readEnvFlag("ARK_IMAGE_WATERMARK", ARK_IMAGE_WATERMARK_SPEC),
          timeoutMs: readEnvNumber("ARK_IMAGE_TIMEOUT_MS", { default: 120_000, min: 1, integer: true }),
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
  enabled: readEnvFlag("AI_LABEL_ENABLED", AI_LABEL_ENABLED_SPEC),
  text: process.env.AI_LABEL_TEXT ?? "AI生成",
  fontPath: process.env.AI_LABEL_FONT_PATH,
  ffmpegPath: process.env.FFMPEG_PATH,
};

const { db } = createDb(databaseUrl);
const deps: ExecutorDeps = {
  db,
  storage,
  adapterOptions,
  providerDbResolve,
  ...(providerSecretKey ? { providerSecretKey } : {}),
  aiLabel,
  log: (obj, msg) => log.info(obj, msg),
  pollIntervalMs: readEnvNumber("POLL_INTERVAL_MS", { default: 1000, min: 1, integer: true }),
  maxPollMs: readEnvNumber("POLL_MAX_MS", { default: DEFAULT_MAX_POLL_MS, min: 1, integer: true }),
  // P10：real 模式下出站素材 URI 的签名有效期（默认 6h，覆盖供应商长任务）
  outboundUriTtlSeconds: readEnvNumber("ADAPTER_URI_TTL_SECONDS", { default: 21_600, min: 1, integer: true }),
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

/**
 * 整集导出（zip 打包）：第 77 批起每个镜头文件按分镜表时长真裁，
 * 因此同样需要 ffmpeg 路径。没配就退回「复制 + manifest 记原因」，不会失败。
 */
const episodeExportDeps = {
  db,
  storage,
  ffmpegPath: process.env.FFMPEG_PATH,
  log: (obj: Record<string, unknown>, msg: string) => log.info(obj, msg),
};

/**
 * 启动时记录媒体能力（`ffmpeg`）。
 *
 * 为什么放在启动日志里：`ffmpeg` 决定"真裁剪/显式水印"能不能做，是**部署环境属性**。
 * 以前这类能力只体现在代码分支里，运维不知道这台机器到底走了哪条路；
 * 现在启动即打印，且失败原因是可读的（缺二进制 / 权限 / 超时）。
 * 探测结果同时经 `GET /v1/meta/capabilities` 对外透出（公开只读，不含敏感信息）。
 */
async function logMediaCapability(): Promise<void> {
  const ffmpeg = await probeFfmpeg(process.env.FFMPEG_PATH);
  if (ffmpeg.available) {
    log.info({ ffmpeg: ffmpeg.version, path: ffmpeg.path }, "media capability: ffmpeg available (real trim/watermark)");
  } else {
    log.warn({ path: ffmpeg.path, reason: ffmpeg.reason }, "media capability: ffmpeg unavailable (degraded to copy)");
  }
}
void logMediaCapability();

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
  readEnvNumber("ORDERS_RECONCILE_INTERVAL_MS", { default: 5 * 60_000, min: 0, integer: true }),
  async () => {
    const n = await reconcileOrders(db, log);
    if (n > 0) log.warn({ reconciled: n }, "orders reconciled");
  },
  true,
);

// 任务看门狗（1min）：卡死的任务置失败并解冻积分
schedule(
  "tasks-watchdog",
  readEnvNumber("TASKS_WATCHDOG_INTERVAL_MS", { default: 60_000, min: 0, integer: true }),
  async () => {
    const n = await reviveStuckTasks(db, log);
    if (n > 0) log.warn({ revived: n }, "stuck tasks revived");
  },
  true,
);

// 发布转码看门狗（2min）：找"没有任何执行者"的发布记录（停在 1 排队 / 2 转码中）。
//
// 第 58 批修掉一条会把好任务误杀的链路：worker 停机期间任务正常积压在 Redis 里排队，
// 重启时本任务 `runOnStart=true` 先跑，旧实现在"超时即失败"口径下把它们全判成 4（失败），
// 随后队列把 job 投出来也只会被终态检查 skipped —— 第 57 批下沉换来的"重启可重投"被全抵消。
// 现在分三步：① 仍在队列（waiting/delayed/active）→ 跳过；② 不在队列但源成片还在 → **重投**；
// ③ 连源都找不到 → 才判失败。判定所需的两件事由这里注入真实现，看门狗本身不认识队列。
const publishTranscodeQueue = new Queue(QUEUES.PUBLISH_TRANSCODE, { connection: redisConnection });

schedule(
  "publications-watchdog",
  readEnvNumber("PUBLICATIONS_WATCHDOG_INTERVAL_MS", { default: 120_000, min: 0, integer: true }),
  async () => {
    const n = await reviveStuckPublications(db, log, 15, undefined, {
      pendingInQueue: async () => {
        // 本队列 jobId 带时间戳（为了允许重投），所以只能按 data.publicationId 扫，
        // 不能拼固定 jobId 去 getJob。一次把四个"未完成"状态里的 id 全取回，
        // 避免逐条记录重复扫队列（积压时那是 O(n×m) 的浪费）。
        const states = ["wait", "delayed", "active", "paused"] as const;
        const held = new Set<string>();
        for (const state of states) {
          const jobs = await publishTranscodeQueue.getJobs([state], 0, 1000, true);
          for (const job of jobs) {
            const id = (job?.data as { publicationId?: string })?.publicationId;
            if (id) held.add(id);
          }
        }
        return held;
      },
      requeue: async ({ publicationId }) => {
        const sourceKey = await resolvePublicationSourceKey(db, publicationId);
        if (!sourceKey) {
          log.warn({ publication_id: publicationId }, "stuck publication has no resolvable source");
          return false;
        }
        const [row] = await db
          .select({ spaceId: timelinePublications.spaceId })
          .from(timelinePublications)
          .where(eq(timelinePublications.id, BigInt(publicationId)));
        if (!row) return false;
        await publishTranscodeQueue.add(
          "transcode",
          { publicationId, spaceId: String(row.spaceId), sourceKey },
          {
            // jobId 带时间戳：同一发布允许真正重投（固定 id 会被 BullMQ 去重，
            // 表现为"加了但没跑"，这里与 api 侧 enqueuePublishTranscode 同因）。
            jobId: `publish-transcode-retry-${publicationId}-${Date.now()}`,
            attempts: 1,
            removeOnComplete: 200,
            removeOnFail: 200,
          },
        );
        log.warn({ publication_id: publicationId }, "stuck publication requeued by watchdog");
        return true;
      },
    });
    if (n > 0) log.warn({ revived: n }, "stuck publications marked failed");
  },
  true,
);

// 分享过期清理（1h）
schedule(
  "shares-expire",
  readEnvNumber("SHARES_EXPIRE_INTERVAL_MS", { default: 3_600_000, min: 0, integer: true }),
  () => expireShares(db, log),
);

// 资金对账（每日）：balance == Σdelta 不平即告警
schedule(
  "flows-audit",
  readEnvNumber("FLOWS_AUDIT_INTERVAL_MS", { default: 86_400_000, min: 0, integer: true }),
  async () => {
    const mismatch = await auditLedger(db, log);
    if (mismatch === 0) log.info("ledger audit ok");
  },
  true,
);

// 数据保留清理（6h）：结果 90 天 / 回收站 7 天 / 注销 30 天
schedule(
  "retention-purge",
  readEnvNumber("MAINTENANCE_INTERVAL_MS", { default: 6 * 3_600_000, min: 0, integer: true }),
  () => purgeOldData(db, log),
  true,
);

/**
 * 每个**有处理器**的队列对应一个函数（第 112 批）。
 *
 * 为什么从「为所有名字建 Worker + if 链 + 兜底 no-op」改成显式表：
 * 旧写法给 `gen.poll` / `result.transfer` / `notify` 也建了 Worker，而这 3 个名字没有任何
 * 生产者；一旦有消息误入，兜底分支会 `return { ok: true }` —— BullMQ 视为处理成功并删除，
 * 消息**静默丢失**（既不在 failed，也没有重试）。现在处理器表与 `HANDLED_QUEUES` 一一对应，
 * 少一个键 typecheck 失败；预留队列不建 Worker，消息会积压可见。
 */
type JobHandler = (job: Job) => Promise<Record<string, unknown>>;

const handlers: Record<HandledQueueName, JobHandler> = {
  [QUEUES.GEN_SUBMIT]: async (job) => {
    const taskId = (job.data as { taskId?: string }).taskId;
    if (!taskId) throw new Error("missing taskId");
    await runGenerationTask(taskId, deps);
    return { ok: true, taskId };
  },
  [QUEUES.EXPORT]: async (job) => {
    const exportId = (job.data as { exportId?: string }).exportId;
    if (!exportId) throw new Error("missing exportId");
    await runExport(exportId, episodeExportDeps);
    return { ok: true, exportId };
  },
  [QUEUES.TIMELINE_EXPORT]: async (job) => {
    const exportId = (job.data as { exportId?: string }).exportId;
    if (!exportId) throw new Error("missing exportId");
    await runTimelineExport(exportId, timelineExportDeps);
    return { ok: true, exportId };
  },
  [QUEUES.PUBLISH_TRANSCODE]: async (job) => {
    const data = job.data as Partial<PublishTranscodeJobData>;
    if (!data.publicationId || !data.spaceId || !data.sourceKey) {
      throw new Error("missing publicationId/spaceId/sourceKey");
    }
    const outcome = await runPublishTranscodeJob(
      { db, storage, log: (obj, msg) => log.info(obj, msg) },
      {
        publicationId: data.publicationId,
        spaceId: data.spaceId,
        sourceKey: data.sourceKey,
      },
    );
    return { ok: true, ...outcome };
  },
};

const workers: Worker[] = HANDLED_QUEUES.map((name) =>
  new Worker(name, handlers[name], {
    connection: redisConnection,
    concurrency: readEnvNumber("WORKER_CONCURRENCY", { default: 5, min: 1, integer: true }),
    /**
     * 锁窗口（H-13）：本轮任务可达十几分钟（生成轮询 / 导出打包 / 转码），
     * BullMQ 默认 lockDuration=30s 由事件循环续约 —— 同步 ZIP 组装或大 JSON
     * 序列化一旦阻塞事件循环超过窗口，job 会被判 stalled 并被**重派给另一个 worker**。
     * 放宽到 120s + 显式 stalledInterval，给长任务留出余量。
     */
    lockDuration: 120_000,
    stalledInterval: 60_000,
    maxStalledCount: 2,
  }).on("error", (err) => log.error({ queue: name, err: err.message }, "worker error")),
);

const heartbeat = setInterval(() => log.info({ running: workers.length }, "worker heartbeat"), 30_000);

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  clearInterval(heartbeat);

  // 停机上限：BullMQ close() 会等当前 job 处理完；超时则强制退出，
  // 避免容器停不下来（未完成的 job 会被 BullMQ 重新投递，不会丢失）
  const force = setTimeout(() => {
    log.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "shutdown timeout, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  force.unref();

  try {
    // close() 停止拉取新 job 并等待在途 job 完成
    await Promise.all(workers.map((w) => w.close()));
    // 看门狗持有的 Queue 句柄也要关，否则 Redis 连接会挂到进程退出（"closed cleanly" 变成假象）
    await publishTranscodeQueue.close();
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
  {
    queues: HANDLED_QUEUES,
    // 预留名同样打印：运维看到启动日志就知道这几个名字没有消费者，
    // 不会把「队列里没动静」误判成 worker 掉线
    reservedQueues: RESERVED_QUEUES,
    pid: process.pid,
    adapterMode: adapterOptions.mode,
  },
  "[worker] started",
);
