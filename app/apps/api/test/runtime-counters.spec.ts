import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COUNTER_RATE_LIMIT_UNAVAILABLE,
  bumpCounter,
  counterValue,
  resetCounters,
  snapshotCounters,
} from "../src/health/runtime-counters";

/**
 * 限流不可用计数器（Ops 的 P2 观察项）。
 *
 * 背景：密码登录的失败限流是 **fail-open**——Redis 抖动时不限流、但也绝不拒绝一次
 * 正确密码。取舍本身是对的（可用性优先），但代价是**防护会静默消失**：
 * 现网 `/v1/metrics` 原有 9 条指标里 `rate_limit|ratelimit|redis_` 命中为 0，
 * 也就是说"这层防护是否还有效"当时无法被任何机器判据观察到。
 *
 * 这条指标把"防护失效"变成可被抓取的数字。用例锁两件事：
 * 1. 计数语义（自增、可快照、可清零）；
 * 2. **接线**：两个 fail-open 的 catch 分支确实会 bump，且 metrics 端点确实会输出它——
 *    否则这就又变成一个"写好了但没人调用"的装饰品（今天已经出现过两个）。
 */
describe("runtime counters", () => {
  beforeEach(() => resetCounters());

  it("自增 / 读取 / 快照 / 清零", () => {
    expect(counterValue(COUNTER_RATE_LIMIT_UNAVAILABLE)).toBe(0);
    bumpCounter(COUNTER_RATE_LIMIT_UNAVAILABLE);
    bumpCounter(COUNTER_RATE_LIMIT_UNAVAILABLE, 2);
    expect(counterValue(COUNTER_RATE_LIMIT_UNAVAILABLE)).toBe(3);
    expect(snapshotCounters()).toEqual([[COUNTER_RATE_LIMIT_UNAVAILABLE, 3]]);
    resetCounters();
    expect(counterValue(COUNTER_RATE_LIMIT_UNAVAILABLE)).toBe(0);
  });

  it("密码登录的两个 fail-open 分支都会 bump（读失败 / 写失败）", () => {
    const source = readFileSync(join(__dirname, "..", "src/modules/auth/auth.service.ts"), "utf8");
    const bumps = source.match(/bumpCounter\(COUNTER_RATE_LIMIT_UNAVAILABLE\)/g) ?? [];
    // 恰好两处：读计数失败、写计数失败。少一处就意味着某个 fail-open 路径不可见。
    expect(bumps.length).toBe(2);
  });

  it("/v1/metrics 会输出该指标（不是只定义不接线）", () => {
    const source = readFileSync(join(__dirname, "..", "src/health/metrics.controller.ts"), "utf8");
    expect(source).toContain("oneframe_rate_limit_unavailable_total");
    expect(source).toContain("# TYPE oneframe_rate_limit_unavailable_total counter");
    expect(source).toContain("counterValue(COUNTER_RATE_LIMIT_UNAVAILABLE)");
  });
});
