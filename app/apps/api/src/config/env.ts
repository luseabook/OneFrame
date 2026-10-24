import { resolve } from "node:path";
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
  // refresh_token Cookie 是否加 Secure：
  // 生产 HTTPS 部署应为 true；本地/内网 HTTP 部署需显式设为 false，
  // 否则浏览器不保存 Cookie → 刷新页面即掉登录（并引发 hydration 不一致）。
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),

  // Alpha 准入 / 新人礼包
  AUTH_REQUIRE_INVITE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  GIFT_CREDITS: z.coerce.number().int().min(0).default(80),
  // 短信 IP 频控阈值（条/小时）：测试环境需放宽，否则多测试文件并行发码会互相挤占
  SMS_IP_HOURLY_LIMIT: z.coerce.number().int().min(1).default(20),
  // 新用户是否自动获得示例作品（PRD 增补 §3.2 首次体验）
  SEED_SAMPLE_PROJECT: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  QUOTE_TTL_S: z.coerce.number().int().min(30).default(300),

  // ── 支付（PRD §10 / api-spec §10）──
  // PAYMENT_LIVE=false：仅允许 mock 渠道（联调用），非 mock 下单直接拒绝，避免"假支付"上线
  PAYMENT_LIVE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  ORDER_TTL_S: z.coerce.number().int().min(60).default(900), // 订单有效期 15min
  WECHAT_MCH_ID: z.string().optional(),
  WECHAT_API_V3_KEY: z.string().optional(),
  ALIPAY_APP_ID: z.string().optional(),

  // LLM 步骤（大纲/角色/剧本/分镜）：mock 用于本地/CI；real 需 DEEPSEEK_API_KEY
  LLM_MODE: z.enum(["mock", "real"]).default("mock"),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default("deepseek-chat"),

  // 运营后台（独立 admin_users；生产必须显式配置）
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ADMIN_JWT_TTL_S: z.coerce.number().int().min(300).default(7200),

  // 内容安全（MVP 敏感词；供应商审核 P2）
  MODERATION_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  MODERATION_WORDS: z.string().optional(),

  // 结果存储（ADR-005：生产替换为 OSS/S3 driver）
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_DIR: z.string().default(resolve(process.cwd(), "../../data/storage")),
  STORAGE_PUBLIC_BASE: z.string().default("http://127.0.0.1:3000/v1"),
  STORAGE_SIGN_SECRET: z.string().min(8).default("dev-only-storage-sign-secret"),
  // S3/OSS（STORAGE_DRIVER=s3 时必填）
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().default("cn-hangzhou"),
  STORAGE_S3_ENDPOINT: z.string().optional(),
  STORAGE_S3_PUBLIC_ENDPOINT: z.string().optional(),
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;
