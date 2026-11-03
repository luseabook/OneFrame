/**
 * 进程内运行时计数器（进程级、单调递增、不持久化）。
 *
 * ## 为什么需要它（Ops 的 P2 观察项，2026-11-03）
 *
 * 密码登录的失败限流是 **fail-open** 设计：Redis 抖动时退化为不限流，但绝不因为
 * 计数失败而拒绝一次正确密码（可用性优先，这个取舍是对的）。
 * 代价是——**Redis 挂掉时这层防护静默消失**，而 `/v1/metrics` 原先没有任何一条
 * 指标能看出来（现网 9 条指标里 `rate_limit|redis_` 命中为 0）。
 *
 * 攻击者最省事的做法因此变成"先把 Redis 打挂"。这个计数器让"防护已失效"变成
 * 可被 Prometheus 抓到的数字，而不是只存在于代码注释里的假设。
 *
 * ## 边界
 * - 进程内、重启清零：它回答"本进程启动以来遇到过几次限流不可用"，
 *   不回答"历史上是否发生过"。要跨重启就得上 Prometheus 的 `increase()` 或落库，
 *   对这条观察项而言不值得。
 * - 只在**限流相关**的失败路径上自增；不要把任意异常都塞进来（否则它变成"什么都算"的噪声指标）。
 */
const counters = new Map<string, number>();

/** 计数器名（保持与指标名一一对应，避免两套命名） */
export const COUNTER_RATE_LIMIT_UNAVAILABLE = "rate_limit_unavailable";

export function bumpCounter(name: string, by = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function counterValue(name: string): number {
  return counters.get(name) ?? 0;
}

/** 快照（稳定排序，便于测试与 diff） */
export function snapshotCounters(): Array<[string, number]> {
  return [...counters.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** 仅供测试：清空 */
export function resetCounters(): void {
  counters.clear();
}
