import { resolve } from "node:path";
import { z } from "zod";
import { STORAGE_DRIVER_SPEC, STORAGE_S3_FORCE_PATH_STYLE_SPEC } from "@app/shared";
// 第 124 批：布尔 / 枚举变量走 @app/shared 的唯一接受表，schema 只做接线
import {
  CATALOG_SYNC_TOOLS_SPEC,
  CAPTCHA_ENFORCE_SPEC,
  MODERATION_ENABLED_SPEC,
  OAUTH_MOCK_SPEC,
  zEnvEnum,
  zEnvFlag,
} from "./env-values";

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
  // `/v1/metrics` 的 Prometheus 抓取令牌（Bearer）。指标含业务与资金异常，
  // 生产必须显式设置；开发/测试不配则端点一律 401。
  METRICS_TOKEN: z.string().min(16).optional(),

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

  // ── 切片发布转码（第 57 批）──
  // inline（默认）：发布后由 API 进程内异步跑 ffmpeg —— 单机/开发/测试形态，无需常驻 worker；
  // worker：只入队（`publish.transcode`），由 worker 消费并真转码 —— 生产形态，
  //   API 不再跑 ffmpeg（长片不占 API 事件循环），且 **API 重启不会把转码丢掉**（任务在 Redis 里）。
  PUBLISH_TRANSCODE_MODE: z.enum(["inline", "worker"]).default("inline"),

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

  // 语音转写（Agent STT，第 4 批）：竞品 `agent/stt-token`（rt:126）。
  // 我方策略：**厂商 Key 不下发浏览器**，只下发短期会话令牌；缺 Key 时 /
  // `AGENT_STT_PROVIDER` 为 browser 时端点返回 available=false，前端回落到
  // 浏览器内置识别（Web Speech / 录音后本地转写），不抛 500。
  AGENT_STT_PROVIDER: z.enum(["browser", "volc", "minimax", "custom"]).default("browser"),
  AGENT_STT_API_KEY: z.string().optional(),
  AGENT_STT_BASE_URL: z.string().optional(),
  AGENT_STT_MODEL: z.string().optional(),

  // 第三方登录（第 2 轮）：四个渠道全部**可选**——没配就明确返回"未配置"，
  // 绝不静默降级成假登录。竞品 login.md 有微信/QQ/Apple/抖音四渠道。
  // ⚠️ 这四项由 `modules/auth/oauth.service.ts` **在调用时读 process.env**（而非本 schema 常量），
  // 目的是让测试能在同一进程内切换"已配置/未配置"两种态；此处登记只为可发现性与生产校验提示。
  OAUTH_WECHAT_APP_ID: z.string().optional(),
  OAUTH_WECHAT_SECRET: z.string().optional(),
  OAUTH_WECHAT_REDIRECT_URI: z.string().optional(),
  OAUTH_QQ_APP_ID: z.string().optional(),
  OAUTH_QQ_APP_KEY: z.string().optional(),
  OAUTH_QQ_REDIRECT_URI: z.string().optional(),
  OAUTH_APPLE_CLIENT_ID: z.string().optional(),
  OAUTH_APPLE_TEAM_ID: z.string().optional(),
  OAUTH_APPLE_KEY_ID: z.string().optional(),
  OAUTH_APPLE_PRIVATE_KEY: z.string().optional(),
  OAUTH_APPLE_REDIRECT_URI: z.string().optional(),
  OAUTH_DOUYIN_CLIENT_KEY: z.string().optional(),
  OAUTH_DOUYIN_SECRET: z.string().optional(),
  OAUTH_DOUYIN_REDIRECT_URI: z.string().optional(),
  /** 仅非生产生效：把 OAuth 回调短路成本地假用户（便于 E2E 覆盖"登录成功"分支） */
  OAUTH_MOCK: zEnvFlag("OAUTH_MOCK", OAUTH_MOCK_SPEC),
  /** master token 有效期（秒）：长令牌只用于换 access，不得打业务端点 */
  MASTER_TTL_S: z.coerce.number().int().min(3600).default(2_592_000), // 30 天

  /**
   * 行为验证码是否在**登录/发码**入口强制校验（默认关）。
   *
   * 为什么默认关：验证码只有本地算术题模式（无第三方 Key），强制校验会把"机器人防护"
   * 变成"用户多答一道题"，而现有 13 套 e2e 与真机验收全都走无验证码路径。
   * 运营决定开启时置 true（第 124 批起接受表固定为 1/true/yes/on，服务在**调用时**
   * 现场读环境变量，便于测试切态；此处只登记接受范围与默认值）。
   */
  CAPTCHA_ENFORCE: zEnvFlag("CAPTCHA_ENFORCE", CAPTCHA_ENFORCE_SPEC),

  /**
   * 影视版离线通知 webhook（第 4 轮）：为空 = 只走广播面，不投递（响应 `delivery:"stored"`）。
   * 用途：把 `task.notified` 等事件推到企业微信/飞书机器人或客户自己的网关，不必接推送厂商。
   * `FILM_NOTIFY_SECRET` 用于 HMAC-SHA256 签名（`x-of-signature: sha256=<hex>`），接收方可验来源。
   * 与 OAuth 同口径：**服务内调用时读 process.env**（便于测试切态），此处仅登记可发现性。
   */
  FILM_NOTIFY_WEBHOOK_URL: z.string().optional(),
  FILM_NOTIFY_SECRET: z.string().optional(),

  /**
   * 首页未读长轮询挂起上限（毫秒）：默认 25s（低于常见反代 30s 读超时，
   * 避免网关先断、客户端拿到 502 而不是"空结果重连"）。测试/联调可调小到 300ms。
   */
  HOME_UNREAD_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(25_000),

  // 运营后台（独立 admin_users；生产必须显式配置）
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  /**
   * 管理端 JWT 专用密钥（PR-05：与用户域 `JWT_SECRET` **物理分离**）。
   *
   * 为什么必须拆：原先后台 token 与用户 token 同一把密钥。用户侧密钥的暴露面远大于
   * 后台（日志、前端构建产物、备份、第三方集成、本地开发机……），一旦泄露，后果不是
   * "能伪造用户"，而是**能直接伪造 admin token**。
   *
   * - 生产：必填（见 `collectProductionProblems`），并受占位符黑名单 + 强度下限约束；
   * - 开发/测试：缺省回落到 `JWT_SECRET`（`resolveAdminJwtSecret`），
   *   本地/CI 不必多配一个变量；回落这件事由 `admin-auth.service` 启动时打 warn。
   */
  ADMIN_JWT_SECRET: z.string().min(16).optional(),
  ADMIN_JWT_TTL_S: z.coerce.number().int().min(300).default(7200),
  /**
   * 供应商 Key 的落库加密主密钥（≥32 字符）。
   * 生产必须显式配置；非生产缺省从 JWT_SECRET 派生，避免本地/CI 多配一个变量。
   * 这里不强制启动失败：控制面未启用时不能因为多了这把钥匙就阻断旧部署。
   */
  PROVIDER_ENCRYPTION_KEY: z.string().min(32).optional(),
  PROVIDER_ENCRYPTION_KEY_ID: z.string().min(1).max(32).default("v1"),
  /**
   * 供应商路由模式：
   * - off：完全沿用环境变量（默认，回滚路径）
   * - fallback：有 active 路由走数据库，没有回落环境变量
   * - on：只走数据库，缺路由直接失败，不静默 mock
   */
  PROVIDER_DB_RESOLVE: z.enum(["off", "fallback", "on"]).default("off"),
  /**
   * 工具目录（`tool-catalog.ts`）是否用代码定义强制覆盖库内工具模型/价目。
   *
   * 默认 **false**：工具模型也是运营资产，后台改价/上下架/排序必须能持久
   * （此前每次进程启动都会被代码目录覆盖，等于"改了重启就回滚"）。
   * 只有需要"代码即真相"的测试/应急场景才打开；正常运营不要开。
   */
  CATALOG_SYNC_TOOLS: zEnvFlag("CATALOG_SYNC_TOOLS", CATALOG_SYNC_TOOLS_SPEC),

  // 内容安全（MVP 敏感词；供应商审核 P2）
  MODERATION_ENABLED: zEnvFlag("MODERATION_ENABLED", MODERATION_ENABLED_SPEC),
  MODERATION_WORDS: z.string().optional(),

  // 结果存储（ADR-005：生产替换为 OSS/S3 driver）—— 与 worker 共用同一张取值表
  STORAGE_DRIVER: zEnvEnum("STORAGE_DRIVER", STORAGE_DRIVER_SPEC),
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
  STORAGE_S3_FORCE_PATH_STYLE: zEnvFlag("STORAGE_S3_FORCE_PATH_STYLE", STORAGE_S3_FORCE_PATH_STYLE_SPEC),

  // ── 画布批量下载：用户可控产物 URI 的服务端拉取守卫（PR-04 SSRF 收口）──
  /**
   * 允许服务端 fetch 的 host 清单：逗号分隔，支持 `*.example.com` 通配（**不**含裸域）。
   * 留空 = **只允许存储自身 host**（由 `STORAGE_PUBLIC_BASE` / `STORAGE_S3_*` 推导），
   * 绝不默认放行任意 host。内网/保留地址永远拒绝——写进白名单也不放行。
   * 配置了本项就只认本项：产物托管在自己的 CDN 时，请把该 host 一并写上。
   */
  CANVAS_DOWNLOAD_HOST_ALLOWLIST: z.string().default(""),
  /** 单个远程产物拉取的大小上限（字节）：默认 200MiB，超限立刻中止（已读字节不落盘） */
  CANVAS_DOWNLOAD_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1024 * 1024 * 1024)
    .default(200 * 1024 * 1024),
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

/**
 * 占位符/示例值黑名单（PR-05）。
 *
 * 为什么不能再只认 `INSECURE_DEFAULTS` 那 4 个仓库默认值：`.env.production.example`
 * 给的是 `change-me-*` / `minioadmin`，长度全部满足 `min(16)`/`min(8)`，
 * 于是**照抄模板上线 = 公开已知密钥**（可伪造任意用户/管理员 token、可读写对象存储）。
 * 这里改为"长得像占位符就拒"，与长度无关；`<...>` 覆盖 `<your-secret>` 这类写法。
 */
export const PLACEHOLDER_SECRET_PATTERN =
  /change[-\s_]?me|dev-only|minioadmin|example|placeholder|your[-\s_]|<[^>]*>/i;

/**
 * 密钥熵下限的落地形式：字符类别数（PR-05）。
 *
 * 为什么不用香农熵：它需要采样长度、对短密钥不稳定，运维也无法从报错里反推"该怎么改"。
 * 字符类别数（大写/小写/数字/符号）能被一句话说清，且 `openssl rand -base64 32`
 * 天然满足 3 类以上。长度下限沿用 schema 里既有的 `min()`，不在这里重复。
 */
export const SECRET_CHAR_CLASSES = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/] as const;
export const MIN_SECRET_CHAR_CLASSES = 3;

/** 返回强度不足的原因（null = 通过）；纯函数便于单测 */
export function secretStrengthProblem(value: string): string | null {
  const classes = SECRET_CHAR_CLASSES.filter((pattern) => pattern.test(value)).length;
  if (classes < MIN_SECRET_CHAR_CLASSES) {
    return `只用到了 ${classes} 类字符（大写/小写/数字/符号），至少需要 ${MIN_SECRET_CHAR_CLASSES} 类`;
  }
  return null;
}

/**
 * 生产必须**显式配置**且必须是随机值的签名/加密密钥。
 *
 * `ADMIN_JWT_SECRET`：PR-05 新增（admin 与用户拆密钥）；
 * `STORAGE_SIGN_SECRET`：与它们同类——仓库里有 `dev-only-storage-sign-secret` 默认值，
 *   生产沿用即等于公开签名密钥，任何人可伪造存储直链（PR-05 的"占位密钥盲区"同源）。
 */
export const REQUIRED_SECRET_KEYS = [
  "JWT_SECRET",
  "ADMIN_JWT_SECRET",
  "PHONE_HMAC_PEPPER",
  "PHONE_ENC_KEY",
  "STORAGE_SIGN_SECRET",
] as const;

/** 缺失时的额外说明（解释"为什么这把密钥不能省"），只写变量名与原因，绝不写值 */
const REQUIRED_SECRET_NOTES: Record<(typeof REQUIRED_SECRET_KEYS)[number], string> = {
  JWT_SECRET: "当前会回退到仓库默认值",
  ADMIN_JWT_SECRET: "非生产会回落到 JWT_SECRET，生产必须独立：用户域密钥泄露不得导致 admin token 可伪造",
  PHONE_HMAC_PEPPER: "当前会回退到仓库默认值",
  PHONE_ENC_KEY: "当前会回退到仓库默认值",
  STORAGE_SIGN_SECRET: "当前会回退到仓库默认值 dev-only-storage-sign-secret",
};

/**
 * 密钥类问题（PR-05）：缺失 / 仍是仓库默认值 / 命中占位符 / 强度不足。
 * 顺序刻意如此：先报"没配"，再报"配了但等于没配"，最后报"配了但太弱"。
 */
export function collectSecretProblems(raw: RawEnv): string[] {
  const problems: string[] = [];
  const insecureValues: string[] = Object.values(INSECURE_DEFAULTS);
  for (const key of REQUIRED_SECRET_KEYS) {
    const value = rawValue(raw, key);
    if (value === undefined) {
      problems.push(`${key} 必须显式配置（${REQUIRED_SECRET_NOTES[key]}）`);
      continue;
    }
    if (insecureValues.includes(value)) {
      problems.push(`${key} 仍是仓库默认值，生产必须替换`);
      continue;
    }
    if (PLACEHOLDER_SECRET_PATTERN.test(value)) {
      problems.push(`${key} 命中占位符黑名单（change-me/example/minioadmin/your- 一类模板值），生产必须替换为随机值`);
      continue;
    }
    const strength = secretStrengthProblem(value);
    if (strength !== null) {
      problems.push(`${key} 强度不足：${strength}（建议 openssl rand -base64 32）`);
    }
  }

  // 对象存储凭据：不强制要求存在（compose 已用 ${VAR:?} 卡住缺失），
  // 但只要出现就必须不是"公开已知口令"——样例里的 `minioadmin` 正是这一类。
  for (const key of ["STORAGE_S3_ACCESS_KEY_ID", "STORAGE_S3_SECRET_ACCESS_KEY"] as const) {
    const value = rawValue(raw, key);
    if (value !== undefined && PLACEHOLDER_SECRET_PATTERN.test(value)) {
      problems.push(`${key} 命中占位符黑名单（minioadmin 等公开口令），生产必须替换`);
    }
  }
  return problems;
}

/**
 * 支付开关必须显式声明（PR-02）。
 *
 * 背景：`PAYMENT_LIVE` 缺省回落到 false → "生产默认就是 mock 渠道"，而 mock 经销
 * 正是这次 P0 的敞口来源。安全边界已经改成 `NODE_ENV==="production"` 一律硬拒 mock
 * （业务开关不再当安全开关），但"生产到底要不要真收款"必须是**部署者的显式决定**，
 * 不能靠一个默认值替他决定。
 */
export function collectPaymentModeProblems(raw: RawEnv): string[] {
  const value = rawValue(raw, "PAYMENT_LIVE");
  if (value === undefined) {
    return ["PAYMENT_LIVE 必须显式设置（true 真实收款 / false 仅 mock 联调；生产不允许依赖 false 默认值）"];
  }
  if (value !== "true" && value !== "false") {
    return ["PAYMENT_LIVE 只能是 true 或 false（其它值既过不了 schema，也让支付链路状态不可判定）"];
  }
  return [];
}

/**
 * 管理端 token 密钥解析（PR-05）。
 *
 * 生产由守卫强制 `ADMIN_JWT_SECRET` 显式配置；非生产缺省回落到 `JWT_SECRET`，
 * 让本地/CI 不必多配一个变量。但"回落到与用户域同密钥"必须**可见**，所以额外返回
 * `fallback`，由 `admin-auth.service` 启动时打 warn —— 否则会出现
 * "以为拆了、其实只是靠生产守卫兜住"的错觉。
 */
export function resolveAdminJwtSecret(source: {
  ADMIN_JWT_SECRET?: string;
  JWT_SECRET: string;
}): { secret: string; fallback: boolean } {
  const own = typeof source.ADMIN_JWT_SECRET === "string" ? source.ADMIN_JWT_SECRET.trim() : "";
  if (own !== "") return { secret: own, fallback: false };
  return { secret: source.JWT_SECRET, fallback: true };
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
  // PR-05：仓库默认值 / 占位符黑名单 / 字符类别强度，三个口径一起判（含 ADMIN_JWT_SECRET）
  problems.push(...collectSecretProblems(raw));

  if (rawValue(raw, "ADMIN_USERNAME") === undefined) {
    problems.push("ADMIN_USERNAME 必须显式配置（生产不允许默认管理员）");
  }
  const adminPassword = rawValue(raw, "ADMIN_PASSWORD");
  if (adminPassword === undefined) {
    problems.push("ADMIN_PASSWORD 必须显式配置（生产不允许默认管理员）");
  } else if (adminPassword === INSECURE_DEFAULTS.ADMIN_PASSWORD) {
    problems.push("ADMIN_PASSWORD 仍是开发默认值，生产必须替换");
  } else if (PLACEHOLDER_SECRET_PATTERN.test(adminPassword)) {
    // 口令类不做字符类别强制（运维习惯不同），但"照抄样例"必须拦住
    problems.push("ADMIN_PASSWORD 命中占位符黑名单（change-me 一类模板值），生产必须替换");
  }

  // PR-02：支付开关必须显式声明（不要用默认值替部署者决定生产走不走真实收款）
  problems.push(...collectPaymentModeProblems(raw));

  if (rawValue(raw, "COOKIE_SECURE") === undefined) {
    problems.push("COOKIE_SECURE 必须显式设置（HTTPS 部署为 true；内网 HTTP 需显式 false）");
  }

  if (rawValue(raw, "METRICS_TOKEN") === undefined) {
    problems.push("METRICS_TOKEN 必须显式设置（/v1/metrics 含任务与资金指标，不能匿名抓取）");
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
