import { describe, expect, it } from "vitest";
import {
  INSECURE_DEFAULTS,
  PLACEHOLDER_SECRET_PATTERN,
  SECRET_CHAR_CLASSES,
  collectPaymentModeProblems,
  collectProductionProblems,
  collectSecretProblems,
  resolveAdminJwtSecret,
  secretStrengthProblem,
} from "../src/config/env";

/**
 * 占位密钥盲区（PR-05）——纯函数单测，不连库。
 *
 * 背景：守卫原来只认 4 个仓库默认值（`dev-only-*` / `admin12345`），而
 * `.env.production.example` 给的是 `change-me-*` / `minioadmin`，长度全都过 `min()`，
 * 于是**照抄模板上线 = 公开已知密钥**：可伪造任意用户 token，且因为 admin 与用户
 * 共用 `JWT_SECRET`，还能直接伪造 admin token。
 *
 * 这里锁三件事：占位符黑名单、字符类别强度下限、admin 密钥与用户密钥分离。
 */

/** 强随机值的代表（3 类字符；既非占位符也非仓库默认值） */
const strong = (label: string): string => `Prod-${label}-0123456789AbCdEf`;

/** 一份"全部显式且合规"的生产配置基线 */
const prodEnv = (overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  NODE_ENV: "production",
  JWT_SECRET: strong("Jwt-Secret"),
  ADMIN_JWT_SECRET: strong("Admin-Jwt-Secret"),
  PHONE_HMAC_PEPPER: strong("Phone-Pepper"),
  PHONE_ENC_KEY: strong("Phone-Enc-Key"),
  STORAGE_SIGN_SECRET: strong("Storage-Sign"),
  ADMIN_USERNAME: "ops-admin",
  ADMIN_PASSWORD: strong("Admin-Password"),
  COOKIE_SECURE: "true",
  METRICS_TOKEN: strong("Metrics-Token"),
  PAYMENT_LIVE: "false",
  // 2026-11-03：生产必须显式 LLM_MODE=real 且配真实 Key（默认 mock 会静默输出假文案）
  LLM_MODE: "real",
  DEEPSEEK_API_KEY: strong("Deepseek-Key"),
  ...overrides,
});

describe("占位符黑名单（PR-05）", () => {
  it("覆盖样例里的每一类占位写法", () => {
    for (const value of [
      "change-me-strong",
      "change-me-32-bytes-random-key",
      "CHANGE_ME_openssl_rand_base64_32",
      "dev-only-jwt-secret-change-me",
      "minioadmin",
      "example-token-value",
      "placeholder-secret-0000",
      "your-secret-here",
      "<your-token>",
    ]) {
      expect(PLACEHOLDER_SECRET_PATTERN.test(value), `${value} 应命中占位符黑名单`).toBe(true);
    }
  });

  it("不会误伤正常的随机值", () => {
    for (const value of [strong("Jwt"), "q7Zx9fT2mK4pL8vR1sB6nC3d", "Xk29fJ1mQ7LzP0aB"]) {
      expect(PLACEHOLDER_SECRET_PATTERN.test(value), `${value} 不应命中`).toBe(false);
    }
  });

  it("长度够但长得像模板的密钥仍被判为问题（这正是原守卫的盲区）", () => {
    const problems = collectSecretProblems(prodEnv({ JWT_SECRET: "change-me-at-least-32-bytes-random" }));
    expect(problems.join("\n")).toContain("JWT_SECRET 命中占位符黑名单");
  });

  it("minioadmin 这类公开口令在对象存储凭据上也被拦", () => {
    const problems = collectSecretProblems(
      prodEnv({ STORAGE_S3_ACCESS_KEY_ID: "minioadmin", STORAGE_S3_SECRET_ACCESS_KEY: "minioadmin" }),
    );
    const joined = problems.join("\n");
    expect(joined).toContain("STORAGE_S3_ACCESS_KEY_ID 命中占位符黑名单");
    expect(joined).toContain("STORAGE_S3_SECRET_ACCESS_KEY 命中占位符黑名单");
  });

  it("仓库默认值仍然按「仍是仓库默认值」报，文案不变（既有断言依赖）", () => {
    const problems = collectSecretProblems(
      prodEnv({
        JWT_SECRET: INSECURE_DEFAULTS.JWT_SECRET,
        PHONE_HMAC_PEPPER: INSECURE_DEFAULTS.PHONE_HMAC_PEPPER,
        PHONE_ENC_KEY: INSECURE_DEFAULTS.PHONE_ENC_KEY,
      }),
    );
    const joined = problems.join("\n");
    expect(joined).toContain("JWT_SECRET 仍是仓库默认值");
    expect(joined).toContain("PHONE_HMAC_PEPPER 仍是仓库默认值");
    expect(joined).toContain("PHONE_ENC_KEY 仍是仓库默认值");
  });

  it("ADMIN_PASSWORD 的模板值也被拦（口令类不强制字符类别，但必须换掉 change-me）", () => {
    const problems = collectProductionProblems(prodEnv({ ADMIN_PASSWORD: "change-me-strong" }));
    expect(problems.join("\n")).toContain("ADMIN_PASSWORD 命中占位符黑名单");
  });
});

describe("强度下限：字符类别（PR-05 的熵口径）", () => {
  it("字符类别定义是 4 类，下限为 3 类", () => {
    expect(SECRET_CHAR_CLASSES).toHaveLength(4);
  });

  it("只有 1~2 类字符的「长密钥」不算合格", () => {
    expect(secretStrengthProblem("prodonlyjwts0123456789abcdef")).toContain("2 类");
    expect(secretStrengthProblem("PRODONLYJWTSECRET0123456789")).toContain("2 类");
    expect(secretStrengthProblem("abcdefghijklmnop")).toContain("1 类");
  });

  it("3 类以上通过（大小写+数字，或任意 3 类组合）", () => {
    expect(secretStrengthProblem(strong("Jwt-Secret"))).toBeNull();
    expect(secretStrengthProblem("abcDEF123")).toBeNull();
  });

  it("强度不足会被聚合成启动失败的原因，并给出生成建议", () => {
    const problems = collectProductionProblems(prodEnv({ ADMIN_JWT_SECRET: "adminjwtsecret0123456789" }));
    const joined = problems.join("\n");
    expect(joined).toContain("ADMIN_JWT_SECRET 强度不足");
    expect(joined).toContain("openssl rand -base64 32");
  });
});

describe("admin 与用户拆密钥（PR-05）", () => {
  it("生产缺 ADMIN_JWT_SECRET → 启动失败，并说明「不得回落 JWT_SECRET」", () => {
    const problems = collectProductionProblems(prodEnv({ ADMIN_JWT_SECRET: undefined }));
    const joined = problems.join("\n");
    expect(joined).toContain("ADMIN_JWT_SECRET 必须显式配置");
    expect(joined).toContain("不得导致 admin token 可伪造");
  });

  it("生产基线与数据示例可自洽：全部显式合规时没有问题", () => {
    expect(collectProductionProblems(prodEnv())).toEqual([]);
  });

  it("非生产缺省回落到 JWT_SECRET，并且回落状态可被日志发现", () => {
    expect(resolveAdminJwtSecret({ JWT_SECRET: "dev-only-jwt-secret-change-me" })).toEqual({
      secret: "dev-only-jwt-secret-change-me",
      fallback: true,
    });
    expect(resolveAdminJwtSecret({ ADMIN_JWT_SECRET: "  ", JWT_SECRET: "x".repeat(16) })).toEqual({
      secret: "x".repeat(16),
      fallback: true,
    });
  });

  it("配了 ADMIN_JWT_SECRET 就不再回落（生产用的就是这条分支）", () => {
    expect(resolveAdminJwtSecret({ ADMIN_JWT_SECRET: "admin-only-secret", JWT_SECRET: "user-secret" })).toEqual({
      secret: "admin-only-secret",
      fallback: false,
    });
  });
});

describe("PAYMENT_LIVE 必须显式声明（PR-02）", () => {
  it("缺省算问题：不允许用 false 默认值替部署者决定生产走不走真实收款", () => {
    expect(collectPaymentModeProblems({}).join("\n")).toContain("PAYMENT_LIVE 必须显式设置");
    expect(collectProductionProblems(prodEnv({ PAYMENT_LIVE: undefined })).join("\n")).toContain(
      "PAYMENT_LIVE 必须显式设置",
    );
  });

  it("非 true/false 算问题", () => {
    expect(collectPaymentModeProblems({ PAYMENT_LIVE: "yes" }).join("\n")).toContain("只能是 true 或 false");
    expect(collectPaymentModeProblems({ PAYMENT_LIVE: "1" }).join("\n")).toContain("只能是 true 或 false");
  });

  it("显式 true / false 都不算配置问题（true 只是要求渠道凭据齐全，那是另一条守卫）", () => {
    expect(collectPaymentModeProblems({ PAYMENT_LIVE: "false" })).toEqual([]);
    expect(collectPaymentModeProblems({ PAYMENT_LIVE: "true" })).toEqual([]);
  });

  it("非生产不受影响", () => {
    expect(collectProductionProblems({ NODE_ENV: "development" })).toEqual([]);
    expect(collectProductionProblems({ NODE_ENV: "test" })).toEqual([]);
  });
});

describe("报错只含变量名与原因，绝不回显密钥值", () => {
  it("占位符/弱值/缺失三类问题都不带值", () => {
    const problems = collectProductionProblems(
      prodEnv({
        JWT_SECRET: "change-me-leak-canary-value",
        PHONE_ENC_KEY: "weakleakcanary0123456789",
        ADMIN_JWT_SECRET: undefined,
      }),
    );
    const joined = problems.join("\n");
    expect(joined).not.toContain("leak-canary");
    expect(joined).not.toContain("weakleakcanary");
  });
});
