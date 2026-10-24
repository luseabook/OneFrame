// 队列命名（docs/02-architecture/system-design.md §1）
// 注意：BullMQ 队列名不允许包含 ':'（Redis key 分隔符保留），故用点号
// gen.submit       创建任务：领 → 适配器 submit → 状态 RUNNING → 加入 poll 延时队列
// gen.poll         轮询：delayed job（5s 起指数退避 ≤30s，上限=模型 P99×2）
// result.transfer  成功后：下载 → 转存自有 OSS(ADR-005) → 结算 → 通知
export const QUEUES = {
  GEN_SUBMIT: "gen.submit",
  GEN_POLL: "gen.poll",
  RESULT_TRANSFER: "result.transfer",
  NOTIFY: "notify",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");

export const redisConnection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  maxRetriesPerRequest: null,
};
