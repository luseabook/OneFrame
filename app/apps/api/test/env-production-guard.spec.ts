import { describe, expect, it } from "vitest";
import {
  INSECURE_DEFAULTS,
  buildEnv,
  collectPaymentProblems,
  collectProductionProblems,
} from "../src/config/env";

/**
 * 生产启动守卫单测（api-spec §10.6 / deployment.md §9）：
 * - production 缺显式密钥 / 仍用仓库默认值 / 未显式 COOKIE_SECURE / 支付凭据不全 → fail fast；
 * - test / development 完全不受影响；
 * - 错误信息聚合且**只含变量名**，绝不打印密钥值。
 *
 * PR-05（2026-10-29）后基线新增三项显式配置：`ADMIN_JWT_SECRET`（admin 与用户拆密钥）、
 * `STORAGE_SIGN_SECRET`（仓库默认值是 dev-only-*）、以及 `PAYMENT_LIVE`（必须显式声明）。
 * 同时密钥值改为 3 类字符：守卫新增的强度下限会拒绝 2 类字符的"长但可猜"值。
 */
const secureProd = (overrides: Record<string, string | undefined> = {}) => ({
  NODE_ENV: "production",
  JWT_SECRET: "Prod-Jwt-Secret-0123456789AbCdEf",
  ADMIN_JWT_SECRET: "Prod-Admin-Jwt-Secret-0123456789AbCdEf",
  PHONE_HMAC_PEPPER: "Prod-Phone-Pepper-0123456789AbC",
  PHONE_ENC_KEY: "Prod-Phone-Enc-Key-0123456789AbC",
  STORAGE_SIGN_SECRET: "Prod-Storage-Sign-0123456789AbC",
  ADMIN_USERNAME: "ops-admin",
  ADMIN_PASSWORD: "Prod-Admin-Password-123456",
  COOKIE_SECURE: "true",
  METRICS_TOKEN: "Prod-Metrics-Token-0123456789",
  PAYMENT_LIVE: "false",
  // 2026-11-03：生产必须显式 LLM_MODE=real 且配真实 Key（默认 mock 会静默输出假文案）
  LLM_MODE: "real",
  DEEPSEEK_API_KEY: "Prod-Deepseek-Key-0123456789",
  ...overrides,
});

describe("production env guard (api)", () => {
  it("does not affect development/test environments", () => {
    expect(collectProductionProblems({ NODE_ENV: "test" })).toEqual([]);
    expect(collectProductionProblems({ NODE_ENV: "development" })).toEqual([]);
    expect(collectProductionProblems({})).toEqual([]);

    const devEnv = buildEnv({ NODE_ENV: "development" });
    expect(devEnv.JWT_SECRET).toBe(INSECURE_DEFAULTS.JWT_SECRET);
    expect(devEnv.SMS_IP_HOURLY_LIMIT).toBe(20);

    const testEnv = buildEnv({ NODE_ENV: "test" });
    expect(testEnv.SMS_IP_HOURLY_LIMIT).toBe(100_000);
    expect(testEnv.PAYMENT_LIVE).toBe(false);
  });

  it("aggregates every missing secret/default/COOKIE_SECURE problem in production", () => {
    const problems = collectProductionProblems({ NODE_ENV: "production" });
    const joined = problems.join("\n");
    for (const key of ["JWT_SECRET", "PHONE_HMAC_PEPPER", "PHONE_ENC_KEY", "ADMIN_USERNAME", "ADMIN_PASSWORD", "COOKIE_SECURE", "METRICS_TOKEN"]) {
      expect(joined).toContain(key);
    }
    expect(problems.length).toBeGreaterThanOrEqual(6);
  });

  it("rejects repository default secrets in production", () => {
    const problems = collectProductionProblems({
      NODE_ENV: "production",
      JWT_SECRET: INSECURE_DEFAULTS.JWT_SECRET,
      PHONE_HMAC_PEPPER: INSECURE_DEFAULTS.PHONE_HMAC_PEPPER,
      PHONE_ENC_KEY: INSECURE_DEFAULTS.PHONE_ENC_KEY,
      ADMIN_USERNAME: "ops",
      ADMIN_PASSWORD: INSECURE_DEFAULTS.ADMIN_PASSWORD,
      COOKIE_SECURE: "true",
    });
    const joined = problems.join("\n");
    expect(joined).toContain("JWT_SECRET 仍是仓库默认值");
    expect(joined).toContain("PHONE_HMAC_PEPPER 仍是仓库默认值");
    expect(joined).toContain("PHONE_ENC_KEY 仍是仓库默认值");
    expect(joined).toContain("ADMIN_PASSWORD 仍是开发默认值");
  });

  it("accepts a fully explicit production configuration without payments live", () => {
    expect(collectProductionProblems(secureProd())).toEqual([]);
    const env = buildEnv(secureProd({ PAYMENT_LIVE: "false" }));
    expect(env.NODE_ENV).toBe("production");
    expect(env.PAYMENT_LIVE).toBe(false);
  });

  describe("LLM 步骤不得静默回落 mock（F0.2）", () => {
    it("rejects LLM_MODE=real without DEEPSEEK_API_KEY in production", () => {
      const problems = collectProductionProblems(secureProd({ LLM_MODE: "real", DEEPSEEK_API_KEY: undefined }));
      expect(problems.join("\n")).toContain("DEEPSEEK_API_KEY");
      expect(() => buildEnv(secureProd({ LLM_MODE: "real", DEEPSEEK_API_KEY: undefined }))).toThrow(/LLM_MODE=real/);
    });

    it("rejects LLM_MODE=real when the key is present but empty/blank", () => {
      const problems = collectProductionProblems(secureProd({ LLM_MODE: "real", DEEPSEEK_API_KEY: "   " }));
      expect(problems.join("\n")).toContain("DEEPSEEK_API_KEY");
    });

    it("生产显式 LLM_MODE=mock 也算问题（2026-11-03 收紧，与 worker ADAPTER_MODE 同口径）", () => {
      const joined = collectProductionProblems(secureProd({ LLM_MODE: "mock" })).join("\n");
      // 2026-11-03 同日加了验收逃生舱后，文案变成"被拒绝 + 指出该设哪个变量"，
      // 断言跟着改口径（原来锚定的是旧措辞"必须为 real"）。
      expect(joined).toContain("LLM_MODE=mock 在生产被拒绝");
      expect(joined).toContain("ONEFRAME_ALLOW_MOCK_LLM=1");
      expect(() => buildEnv(secureProd({ LLM_MODE: "mock" }))).toThrow(/LLM_MODE=mock 在生产被拒绝/);
    });

    it("生产未显式设置 LLM_MODE 也拒绝（默认 mock 不得替部署者决定）", () => {
      const joined = collectProductionProblems(secureProd({ LLM_MODE: undefined })).join("\n");
      expect(joined).toContain("LLM_MODE 必须显式设置为 real");
    });

    it("accepts LLM_MODE=real with a non-blank key", () => {
      expect(collectProductionProblems(secureProd({ LLM_MODE: "real", DEEPSEEK_API_KEY: "sk-test" }))).toEqual([]);
      // 基线（real + 真实 Key）本身必须干净
      expect(collectProductionProblems(secureProd())).toEqual([]);
    });

    it("does not enforce the LLM rule outside production", () => {
      expect(collectProductionProblems({ NODE_ENV: "test", LLM_MODE: "real" })).toEqual([]);
      expect(collectProductionProblems({ NODE_ENV: "development", LLM_MODE: "real" })).toEqual([]);
      // 非生产不设或设 mock 都不该报
      expect(collectProductionProblems({ NODE_ENV: "test" })).toEqual([]);
      expect(collectProductionProblems({ NODE_ENV: "development", LLM_MODE: "mock" })).toEqual([]);
    });
  });

  it("fails fast with an aggregated error message that never prints secret values", () => {
    const raw = {
      NODE_ENV: "production",
      JWT_SECRET: "super-secret-value-should-not-be-logged",
      ADMIN_USERNAME: "ops",
      ADMIN_PASSWORD: "another-secret-admin-password",
    };
    let message = "";
    try {
      buildEnv(raw);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("生产环境配置校验失败");
    expect(message).toContain("PHONE_HMAC_PEPPER");
    expect(message).toContain("COOKIE_SECURE");
    // 只报变量名与原因：绝不回显任何配置值
    expect(message).not.toContain("super-secret-value-should-not-be-logged");
    expect(message).not.toContain("another-secret-admin-password");
  });

  describe("payment credentials when PAYMENT_LIVE=true", () => {
    const fullWechat = {
      WECHAT_APP_ID: "wxtest",
      WECHAT_MCH_ID: "1900000001",
      WECHAT_MCH_SERIAL_NO: "SERIAL1",
      WECHAT_MCH_PRIVATE_KEY_PATH: "/run/secrets/wechat_key.pem",
      WECHAT_API_V3_KEY: "0123456789abcdef0123456789abcdef",
      WECHAT_PLATFORM_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----\nxxx\n-----END PUBLIC KEY-----",
      WECHAT_NOTIFY_URL: "https://api.example.com/v1/billing/notify/wechat",
    };
    const fullAlipay = {
      ALIPAY_APP_ID: "2021000000000000",
      ALIPAY_APP_PRIVATE_KEY_PATH: "/run/secrets/alipay_app_key.pem",
      ALIPAY_PUBLIC_KEY_PATH: "/run/secrets/alipay_public_key.pem",
      ALIPAY_NOTIFY_URL: "https://api.example.com/v1/billing/notify/alipay",
    };

    it("requires at least one fully-configured channel when payments are live", () => {
      const problems = collectPaymentProblems(secureProd({ PAYMENT_LIVE: "true" }));
      expect(problems.join("\n")).toContain("没有任何支付渠道凭据齐全");
    });

    it("accepts a complete wechat configuration only", () => {
      const problems = collectProductionProblems(secureProd({ PAYMENT_LIVE: "true", ...fullWechat }));
      expect(problems).toEqual([]);
    });

    it("accepts platform cert rotation map as the platform key source", () => {
      const problems = collectProductionProblems(
        secureProd({
          PAYMENT_LIVE: "true",
          ...fullWechat,
          WECHAT_PLATFORM_PUBLIC_KEY: undefined,
          WECHAT_PLATFORM_PUBLIC_KEYS: '{"SERIAL1":"pem"}',
        }),
      );
      expect(problems).toEqual([]);
    });

    it("rejects a partially configured channel (enabled but incomplete)", () => {
      // 支付宝完整、微信缺一项 → 微信属于"已启用但凭据不全"，必须启动失败
      const problems = collectProductionProblems(
        secureProd({ PAYMENT_LIVE: "true", ...fullWechat, ...fullAlipay, WECHAT_APP_ID: undefined }),
      );
      const joined = problems.join("\n");
      expect(joined).toContain("微信支付凭据不完整");
      expect(joined).toContain("WECHAT_APP_ID");
    });

    it("rejects a partially configured alipay channel even when wechat is complete", () => {
      const problems = collectProductionProblems(
        secureProd({
          PAYMENT_LIVE: "true",
          ...fullWechat,
          ALIPAY_APP_ID: "2021000000000000",
        }),
      );
      const joined = problems.join("\n");
      expect(joined).toContain("支付宝凭据不完整");
      expect(joined).toContain("ALIPAY_APP_PRIVATE_KEY");
    });

    it("accepts complete wechat + complete alipay", () => {
      const problems = collectProductionProblems(secureProd({ PAYMENT_LIVE: "true", ...fullWechat, ...fullAlipay }));
      expect(problems).toEqual([]);
    });

    it("does not enforce payment credentials outside production", () => {
      expect(collectProductionProblems({ NODE_ENV: "test", PAYMENT_LIVE: "true" })).toEqual([]);
    });
  });
});
