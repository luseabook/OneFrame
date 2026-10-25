import { resolve } from "node:path";
import { z } from "zod";

/** 生产/开发默认的短信 IP 频控阈值（条/小时） */
export const DEFAULT_SMS_IP_HOURLY_LIMIT = 20;
/**
 * 测试环境默认放宽：api e2e 每个 spec 文件都会新建用户并发送验证码，
 * 它们共享同一个代理 IP（127.0.0.1）。默认 20 会让连续复跑在
 * `sms:ip:*` 计数器（TTL 1h，跨进程/跨轮次保留）上触发 429 频控，
 * 表现为"上一次能过、下一次大面积失败"的伪回归。
 * 因此 test 环境默认取一个足够大的值；生产默认保持 20 不变。
 */
export const TEST_SMS_IP_HOURLY_LIMIT = 100_000;

export function smsIpHourlyLimitDefault(nodeEnv: string | undefined): number {
  return nodeEnv === "test" ? TEST_SMS_IP_HOURLY_LIMIT : DEFAULT_SMS_IP_HOURLY_LIMIT;
}

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
  // 短信 IP 频控阈值（条/小时）：测试环境默认放宽，否则多测试文件共用
  // 127.0.0.1 会互相挤占（`sms:ip:*` 计数 TTL 1h，跨复跑保留）
  SMS_IP_HOURLY_LIMIT: z.coerce.number().int().min(1).optional(),
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

  // ── 微信支付 APIv3（WECHAT_*）──
  // 商户号
  WECHAT_MCH_ID: z.string().optional(),
  // 公众号/小程序 AppID（Native/H5/JSAPI 下单与前端 paySign 都需要）
  WECHAT_APP_ID: z.string().optional(),
  // 商户 API 证书序列号（Authorization 头 serial_no）
  WECHAT_MCH_SERIAL_NO: z.string().optional(),
  // 商户 API 私钥：PEM 内联（支持 \n 转义）或通过 *_PATH 指向文件
  WECHAT_MCH_PRIVATE_KEY: z.string().optional(),
  WECHAT_MCH_PRIVATE_KEY_PATH: z.string().optional(),
  // APIv3 密钥（32 字节，回调资源 AEAD_AES_256_GCM 解密）
  WECHAT_API_V3_KEY: z.string().optional(),
  /** 微信支付平台证书公钥（PEM，用于回调验签）；未配置则所有 wechat 回调被拒 */
  WECHAT_PLATFORM_PUBLIC_KEY: z.string().optional(),
  WECHAT_PLATFORM_PUBLIC_KEY_PATH: z.string().optional(),
  /**
   * 平台证书轮换：JSON `{ "<serial_no>": "<PEM>", ... }`（或 *_PATH 指向 JSON 文件）。
   * 回调按 `Wechatpay-Serial` 头精确选择验签公钥；未知 serial 一律 401。
   * 轮换期可同时配置新旧证书；未提供 serial 时回退 WECHAT_PLATFORM_PUBLIC_KEY。
   */
  WECHAT_PLATFORM_PUBLIC_KEYS: z.string().optional(),
  WECHAT_PLATFORM_PUBLIC_KEYS_PATH: z.string().optional(),
  /** API 基址，生产默认 https://api.mch.weixin.qq.com（测试可指向本地假网关） */
  WECHAT_API_BASE: z.string().optional(),
  /** 回调地址（必须在微信商户平台配置为可公网访问的 HTTPS） */
  WECHAT_NOTIFY_URL: z.string().optional(),

  // ── 支付宝开放平台（ALIPAY_*）──
  ALIPAY_APP_ID: z.string().optional(),
  /** 应用私钥（PEM 内联或 *_PATH 文件） */
  ALIPAY_APP_PRIVATE_KEY: z.string().optional(),
  ALIPAY_APP_PRIVATE_KEY_PATH: z.string().optional(),
  /** 支付宝公钥（PEM，用于回调/响应验签）；未配置则所有 alipay 回调被拒 */
  ALIPAY_PUBLIC_KEY: z.string().optional(),
  ALIPAY_PUBLIC_KEY_PATH: z.string().optional(),
  /** 网关：生产 https://openapi.alipay.com/gateway.do；沙箱可覆盖 */
  ALIPAY_GATEWAY: z.string().optional(),
  ALIPAY_NOTIFY_URL: z.string().optional(),
  ALIPAY_SIGN_TYPE: z.enum(["RSA2"]).default("RSA2"),

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

// ── 生产启动守卫（fail fast；纯函数便于单测）──────────────────────────────
//
// 目标：生产环境不允许带着「仓库默认弱密钥 / 未显式确认 Cookie Secure / 只配了一半的支付凭据」
// 启动。所有问题一次性聚合抛出，错误信息只包含**变量名与原因**，绝不打印任何值。

/** 仓库内置的开发默认值：生产出现即视为未配置 */
export const INSECURE_DEFAULTS = {
  JWT_SECRET: "dev-only-jwt-secret-change-me",
  PHONE_HMAC_PEPPER: "dev-only-phone-pepper",
  PHONE_ENC_KEY: "dev-only-phone-enc-key",
  ADMIN_PASSWORD: "admin12345",
} as const;

export type RawEnv = Record<string, string | undefined>;

function rawValue(raw: RawEnv, key: string): string | undefined {
  const value = raw[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function missingFrom(raw: RawEnv, keys: string[]): string[] {
  return keys.filter((key) => rawValue(raw, key) === undefined);
}

/** 支付渠道凭据完整性（PAYMENT_LIVE=true 时） */
export function collectPaymentProblems(raw: RawEnv): string[] {
  if ((rawValue(raw, "PAYMENT_LIVE") ?? "false") !== "true") return [];

  const wechatBase = ["WECHAT_APP_ID", "WECHAT_MCH_ID", "WECHAT_MCH_SERIAL_NO", "WECHAT_API_V3_KEY", "WECHAT_NOTIFY_URL"];
  const wechatPrivateKeyOk =
    rawValue(raw, "WECHAT_MCH_PRIVATE_KEY") !== undefined || rawValue(raw, "WECHAT_MCH_PRIVATE_KEY_PATH") !== undefined;
  const wechatPlatformKeyOk =
    rawValue(raw, "WECHAT_PLATFORM_PUBLIC_KEY") !== undefined ||
    rawValue(raw, "WECHAT_PLATFORM_PUBLIC_KEY_PATH") !== undefined ||
    rawValue(raw, "WECHAT_PLATFORM_PUBLIC_KEYS") !== undefined ||
    rawValue(raw, "WECHAT_PLATFORM_PUBLIC_KEYS_PATH") !== undefined;
  const wechatMissing = [
    ...missingFrom(raw, wechatBase),
    ...(wechatPrivateKeyOk ? [] : ["WECHAT_MCH_PRIVATE_KEY"]),
    ...(wechatPlatformKeyOk ? [] : ["WECHAT_PLATFORM_PUBLIC_KEY"]),
  ];
  const wechatTouched =
    wechatPrivateKeyOk ||
    wechatPlatformKeyOk ||
    rawValue(raw, "WECHAT_MCH_ID") !== undefined ||
    rawValue(raw, "WECHAT_APP_ID") !== undefined;

  const alipayBase = ["ALIPAY_APP_ID", "ALIPAY_NOTIFY_URL"];
  const alipayPrivateKeyOk =
    rawValue(raw, "ALIPAY_APP_PRIVATE_KEY") !== undefined || rawValue(raw, "ALIPAY_APP_PRIVATE_KEY_PATH") !== undefined;
  const alipayPublicKeyOk =
    rawValue(raw, "ALIPAY_PUBLIC_KEY") !== undefined || rawValue(raw, "ALIPAY_PUBLIC_KEY_PATH") !== undefined;
  const alipayMissing = [
    ...missingFrom(raw, alipayBase),
    ...(alipayPrivateKeyOk ? [] : ["ALIPAY_APP_PRIVATE_KEY"]),
    ...(alipayPublicKeyOk ? [] : ["ALIPAY_PUBLIC_KEY"]),
  ];
  const alipayTouched =
    alipayPrivateKeyOk || alipayPublicKeyOk || rawValue(raw, "ALIPAY_APP_ID") !== undefined;

  const problems: string[] = [];
  if (wechatMissing.length > 0 && alipayMissing.length > 0) {
    problems.push(
      "PAYMENT_LIVE=true 但没有任何支付渠道凭据齐全：至少完整配置微信" +
        `（缺少 ${wechatMissing.join(", ")}）或支付宝（缺少 ${alipayMissing.join(", ")}）`,
    );
    return problems;
  }
  // 已启用（配置了任何一项）但凭据不全的渠道：启动失败，避免上线后回调验不过/下单失败
  if (wechatMissing.length > 0 && wechatTouched) {
    problems.push(`微信支付凭据不完整，缺少：${wechatMissing.join(", ")}`);
  }
  if (alipayMissing.length > 0 && alipayTouched) {
    problems.push(`支付宝凭据不完整，缺少：${alipayMissing.join(", ")}`);
  }
  return problems;
}

/** 生产启动守卫：返回所有问题（空数组 = 通过）；只含变量名/原因，不含值 */
export function collectProductionProblems(raw: RawEnv = process.env): string[] {
  const nodeEnv = rawValue(raw, "NODE_ENV") ?? "development";
  if (nodeEnv !== "production") return [];

  const problems: string[] = [];
  const requiredSecrets: Array<{ key: string; insecure: string }> = [
    { key: "JWT_SECRET", insecure: INSECURE_DEFAULTS.JWT_SECRET },
    { key: "PHONE_HMAC_PEPPER", insecure: INSECURE_DEFAULTS.PHONE_HMAC_PEPPER },
    { key: "PHONE_ENC_KEY", insecure: INSECURE_DEFAULTS.PHONE_ENC_KEY },
  ];
  for (const { key, insecure } of requiredSecrets) {
    const value = rawValue(raw, key);
    if (value === undefined) {
      problems.push(`${key} 必须显式配置（当前会回退到仓库默认值）`);
    } else if (value === insecure) {
      problems.push(`${key} 仍是仓库默认值，生产必须替换`);
    }
  }

  if (rawValue(raw, "ADMIN_USERNAME") === undefined) {
    problems.push("ADMIN_USERNAME 必须显式配置（生产不允许默认管理员）");
  }
  const adminPassword = rawValue(raw, "ADMIN_PASSWORD");
  if (adminPassword === undefined) {
    problems.push("ADMIN_PASSWORD 必须显式配置（生产不允许默认管理员）");
  } else if (adminPassword === INSECURE_DEFAULTS.ADMIN_PASSWORD) {
    problems.push("ADMIN_PASSWORD 仍是开发默认值，生产必须替换");
  }

  if (rawValue(raw, "COOKIE_SECURE") === undefined) {
    problems.push("COOKIE_SECURE 必须显式设置（HTTPS 部署为 true；内网 HTTP 需显式 false）");
  }

  problems.push(...collectLlmProblems(raw));
  problems.push(...collectPaymentProblems(raw));
  return problems;
}

/**
 * LLM 步骤配置一致性（F0.2 / 2026-10-26）。
 *
 * 背景：`LlmService` 在 `LLM_MODE=real` 但缺 `DEEPSEEK_API_KEY` 时会**静默回落**
 * 到确定性 mock 文案（`llm.service.ts` 的 `if (!this.deepseek)` 分支），
 * 生产会"看起来在跑、实际输出假内容"，且与 worker 侧"缺 Key 硬失败"的策略不一致。
 * 这里把该组合变为**启动即失败**，让配置错误暴露在部署阶段而不是用户内容里。
 *
 * 注意：未显式设置 `LLM_MODE` 时默认 mock（本地/CI 正常可用），不算问题。
 */
export function collectLlmProblems(raw: RawEnv): string[] {
  const llmMode = rawValue(raw, "LLM_MODE") ?? "mock";
  if (llmMode !== "real") return [];
  if (rawValue(raw, "DEEPSEEK_API_KEY") !== undefined) return [];
  return ["LLM_MODE=real 但缺少 DEEPSEEK_API_KEY：会静默回落到 mock 文案，必须显式配置或改回 LLM_MODE=mock"];
}

/**
 * 解析 + 校验环境变量（纯函数，便于单测）。
 * - 非 production：只做 schema 校验，保留开发/测试默认值；
 * - production：额外执行启动守卫，聚合所有问题一次性抛错（不含任何密钥值）。
 */
export function buildEnv(raw: RawEnv = process.env): Env {
  const parsed = envSchema.parse(raw);
  const problems = collectProductionProblems(raw);
  if (problems.length > 0) {
    throw new Error(
      `生产环境配置校验失败（${problems.length} 项，拒绝启动）：\n - ${problems.join("\n - ")}`,
    );
  }
  return {
    ...parsed,
    SMS_IP_HOURLY_LIMIT: parsed.SMS_IP_HOURLY_LIMIT ?? smsIpHourlyLimitDefault(parsed.NODE_ENV),
  };
}

export type Env = z.infer<typeof envSchema> & { SMS_IP_HOURLY_LIMIT: number };

export const env = buildEnv();
