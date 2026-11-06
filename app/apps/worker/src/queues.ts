import { redisConnectionOptions } from "@app/shared";

// 队列命名（docs/02-architecture/system-design.md §1）
// 注意：BullMQ 队列名不允许包含 ':'（Redis key 分隔符保留），故用点号
//
// 第 112 批（§5.6 C「队列孤儿消息」审计）把名字拆成两组，worker 只给**有真实处理器**的
// 队列建 Worker。审计前 worker 对 7 个名字全部建 Worker，其中 3 个没有生产者，落到兜底
// 分支 `return { ok: true }` —— 任何误入的消息会被**静默完成并丢失**（不重试、不进 failed）。
// 现在预留名不再建 Worker：没有消费者的队列里出现消息会作为积压可见，而不是被 no-op 吃掉。
export const QUEUES = {
  // 有生产者、有处理器：
  GEN_SUBMIT: "gen.submit", // API QueueService.enqueueTask
  EXPORT: "export.zip", // API QueueService.enqueueExport
  TIMELINE_EXPORT: "timeline.export", // API QueueService.enqueueTimelineExport
  // 切片发布转码（第 57 批）：API 以 PUBLISH_TRANSCODE_MODE=worker 发布时入队；
  // worker 发布看门狗也会重投（main.ts publications-watchdog）
  PUBLISH_TRANSCODE: "publish.transcode",
  // 预留名（当前无生产者）：
  // 生成流水线的轮询与转存是 executor.ts runGenerationTask 里的**同步循环**
  //（submit → 1s 轮询 → 转存 → 结算），不经过队列；notify 尚未接通知渠道。
  GEN_POLL: "gen.poll",
  RESULT_TRANSFER: "result.transfer",
  NOTIFY: "notify",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** 有真实处理器、worker 会建实例的队列（main.ts 的处理器表必须恰好覆盖这几个） */
export const HANDLED_QUEUES = [
  QUEUES.GEN_SUBMIT,
  QUEUES.EXPORT,
  QUEUES.TIMELINE_EXPORT,
  QUEUES.PUBLISH_TRANSCODE,
] as const;

/**
 * 预留名：当前没有任何生产者，因此不建 Worker。
 * 保留名字是为了给将来的「异步轮询 / 转存 / 通知」留出稳定契约；
 * 若哪天真有生产者，必须同时补处理器，否则守卫用例
 * `queue-topology.spec.ts` 会失败。
 */
export const RESERVED_QUEUES = [QUEUES.GEN_POLL, QUEUES.RESULT_TRANSFER, QUEUES.NOTIFY] as const;

export type HandledQueueName = (typeof HANDLED_QUEUES)[number];

export const redisConnection = {
  // 统一解析（shared）：TLS / ACL 用户名 / db 序号都不再被丢掉
  ...redisConnectionOptions(process.env.REDIS_URL ?? "redis://localhost:6379"),
  maxRetriesPerRequest: null,
};
