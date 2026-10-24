import { describe, expect, it } from "vitest";
import {
  DEFAULT_SMS_IP_HOURLY_LIMIT,
  TEST_SMS_IP_HOURLY_LIMIT,
  smsIpHourlyLimitDefault,
} from "../src/config/env";

/**
 * 测试可复跑性：NODE_ENV=test 时短信 IP 频控默认值必须放宽。
 *
 * 背景：api e2e 每个 spec 都会新建用户发码，全部共享代理 IP 127.0.0.1；
 * `sms:ip:*` 计数器 TTL 1 小时且跨进程保留，默认 20 会让"连续复跑"在第 N 次
 * 触发 429（历史现象：首跑全绿、复跑大面积 401/429）。生产默认必须保持 20。
 */
describe("sms ip hourly limit defaults", () => {
  it("keeps the production default strict (20/h)", () => {
    expect(DEFAULT_SMS_IP_HOURLY_LIMIT).toBe(20);
    expect(smsIpHourlyLimitDefault("production")).toBe(20);
    expect(smsIpHourlyLimitDefault(undefined)).toBe(20);
    expect(smsIpHourlyLimitDefault("development")).toBe(20);
  });

  it("relaxes the default only for the test environment", () => {
    expect(smsIpHourlyLimitDefault("test")).toBe(TEST_SMS_IP_HOURLY_LIMIT);
    expect(TEST_SMS_IP_HOURLY_LIMIT).toBeGreaterThanOrEqual(1000);
  });
});
