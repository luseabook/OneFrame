import { describe, expect, it } from "vitest";
import { assertWorkerEnv, collectWorkerProductionProblems } from "./env-guard";

/**
 * worker 生产启动守卫单测（deployment.md §9）：
 * NODE_ENV=production 时禁止 mock 生成、必须至少一种真实供应商；错误信息不含密钥值。
 */
describe("worker production env guard", () => {
  it("does not affect development/test environments", () => {
    expect(collectWorkerProductionProblems({ NODE_ENV: "development" })).toEqual([]);
    expect(collectWorkerProductionProblems({ NODE_ENV: "test" })).toEqual([]);
    expect(collectWorkerProductionProblems({})).toEqual([]);
  });

  it("rejects ADAPTER_MODE=mock in production", () => {
    const problems = collectWorkerProductionProblems({
      NODE_ENV: "production",
      ADAPTER_MODE: "mock",
      ARK_API_KEY: "ark-key",
    });
    expect(problems.join("\n")).toContain("ADAPTER_MODE 必须为 real");
  });

  it("rejects production without any real vendor configured", () => {
    const problems = collectWorkerProductionProblems({ NODE_ENV: "production", ADAPTER_MODE: "real" });
    expect(problems.join("\n")).toContain("至少配置一种真实供应商");
  });

  it("accepts real mode with any single real vendor", () => {
    expect(
      collectWorkerProductionProblems({ NODE_ENV: "production", ADAPTER_MODE: "real", ARK_API_KEY: "ark-key" }),
    ).toEqual([]);
    expect(
      collectWorkerProductionProblems({ NODE_ENV: "production", ADAPTER_MODE: "real", DEEPSEEK_API_KEY: "ds-key" }),
    ).toEqual([]);
    expect(
      collectWorkerProductionProblems({
        NODE_ENV: "production",
        ADAPTER_MODE: "real",
        HTTP_VIDEO_BASE_URL: "https://vendor.example.com",
      }),
    ).toEqual([]);
  });

  it("treats blank vendor values as unconfigured", () => {
    const problems = collectWorkerProductionProblems({
      NODE_ENV: "production",
      ADAPTER_MODE: "real",
      ARK_API_KEY: "   ",
      DEEPSEEK_API_KEY: "",
    });
    expect(problems.join("\n")).toContain("至少配置一种真实供应商");
  });

  it("assertWorkerEnv throws an aggregated message without leaking values", () => {
    let message = "";
    try {
      assertWorkerEnv({
        NODE_ENV: "production",
        ADAPTER_MODE: "mock",
        ARK_API_KEY: "ark-super-secret-key-value",
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("worker 生产环境配置校验失败");
    expect(message).toContain("ADAPTER_MODE");
    expect(message).not.toContain("ark-super-secret-key-value");
  });
});
