import { z } from "zod";

// 配置层：启动即校验，缺失/非法直接崩（docs/04-engineering/dev-workflow.md §5）
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().default("postgres://app:app@localhost:5432/app"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  WORKER_ID: z.coerce.number().int().min(0).max(1023).optional(),

  // 鉴权（ADR-006/008）
  JWT_SECRET: z.string().min(16).default("dev-only-jwt-secret-change-me"),
  ACCESS_TTL_S: z.coerce.number().int().min(60).default(7200),
  REFRESH_TTL_S: z.coerce.number().int().min(3600).default(14 * 24 * 3600),
  PHONE_HMAC_PEPPER: z.string().min(8).default("dev-only-phone-pepper"),
  PHONE_ENC_KEY: z.string().min(8).default("dev-only-phone-enc-key"),

  // Alpha 准入 / 新人礼包
  AUTH_REQUIRE_INVITE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  GIFT_CREDITS: z.coerce.number().int().min(0).default(80),
  QUOTE_TTL_S: z.coerce.number().int().min(30).default(300),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
