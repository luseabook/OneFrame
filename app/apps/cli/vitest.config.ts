import { defineConfig } from "vitest/config";

/**
 * CLI 单测基线。
 *
 * 与 api 的 vitest.config 不同：CLI 单测**不连库、不连网**，全部通过注入
 * `transport` / `configDir` 跑纯逻辑（envelope、退出码映射、参数解析、
 * dry-run、幂等键），所以这里不需要任何 env 默认值。
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.spec.ts"],
    testTimeout: 15_000,
  },
});
