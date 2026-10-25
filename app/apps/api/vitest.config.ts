import { defineConfig } from "vitest/config";

/**
 * api 测试环境基线（F0.1）
 *
 * 背景：本模块有 14 个 e2e suite 在 beforeAll 里直接连真实 PG / Redis，它们此前
 * 完全依赖 `src/config/env.ts` 的默认值（localhost:5432 / localhost:6379）。
 * 而本仓库约定的本地实例跑在 55432 / 6380（见 docs/05-ops/deployment.md §1），
 * 于是「裸跑 `pnpm -w test`」在开发机必然 ECONNREFUSED（CI 有 service 容器 +
 * workflow env，所以一直是绿的）——门禁因此不可复现。
 *
 * 这里只补**测试专用默认值**：显式传入的变量永远优先（CI 的 workflow env、
 * 本地自定义端口、`DATABASE_URL=... pnpm test` 均不受影响）。
 */
const TEST_ENV_DEFAULTS: Record<string, string> = {
  NODE_ENV: process.env.NODE_ENV ?? "test",
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://app:app@127.0.0.1:55432/app",
  REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6380",
  // 多测试文件共享 127.0.0.1，短信 IP 频控会互相挤占（TTL 1h，跨轮次保留）
  SMS_IP_HOURLY_LIMIT: process.env.SMS_IP_HOURLY_LIMIT ?? "100000",
};

export default defineConfig({
  test: {
    env: TEST_ENV_DEFAULTS,
    // 全量 e2e 串行由 package.json 的 --no-file-parallelism 保证；这里放宽单测超时，
    // 避免慢机器上首次建连被默认 5s 打断。
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
});
