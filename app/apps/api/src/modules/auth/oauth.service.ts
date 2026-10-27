import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AppError, ErrorCode } from "@app/shared";
import { RedisService } from "../../redis/redis.service";
import { AppleIdTokenError, verifyAppleIdToken, type VerifiedAppleClaims } from "./apple-id-token";

/**
 * 第三方登录（SSO）—— 竞品证据：`rea-reelmate/cmd/login.md`、`d-commerce-account.md`
 * （微信/QQ/Apple/抖音四个入口，登录页实测四个按钮，见 `apps/web/pages/login.vue` 的 `.tp` 组）。
 *
 * ## 本模块最硬的一条规矩：**未配置渠道绝不返回假成功**
 *
 * 竞品登录页的第三方按钮只有在渠道凭据就绪时才会跳转。我方照做，并且做得更严格：
 * 凡是"渠道凭据未配齐"，一律 `400101 + details.reason=provider_not_configured`，
 * 前端据此把按钮置灰并给 tooltip。**不允许**返回一个假的授权 URL、也不允许在
 * 回调里凭空造一个用户——那会让运营以为渠道通了，而实际上线后没人能登录。
 *
 * ## 配置从哪读
 *
 * 读 `process.env`（**调用时**读，不是启动时快照）：
 * - `config/env.ts` 由 Lead 独占，本批写权限不含它；
 * - 调用时读带来一个有意的好处：测试可以在同一进程内切换"未配置 → 配置态"，
 *   从而既验证"未配置必须报错"，又验证"配置态能拿到 url+state"（DoD 要求两条都测）。
 * 生产应把这几项搬进 `env.ts` 做启动校验（已写进回报的「需要 Lead 做」）。
 *
 * ## state 为什么必须落 Redis 且一次性
 *
 * state 是 CSRF 防护：攻击者可以把自己渠道账号的 code 塞给受害者浏览器。
 * 若 state 不校验/可重放，等于把"第三方账号绑定"变成可伪造的登录入口。
 * 所以：5 分钟 TTL、按 provider 隔离、**消费即删**（重放会得到 state_invalid）。
 */

export const OAUTH_PROVIDERS = ["wechat", "qq", "apple", "douyin"] as const;
export type OauthProvider = (typeof OAUTH_PROVIDERS)[number];

export interface OauthProfile {
  external_id: string;
  nickname: string;
  avatar: string | null;
}

interface ProviderSpec {
  provider: OauthProvider;
  label: string;
  /** 三个必填配置（缺一即"未配置"）：客户端标识、客户端密钥、回调地址 */
  idVar: string;
  secretVar: string;
  redirectVar: string;
  /** 拼授权页 URL（state/redirect 都必须带上） */
  authorize: (cfg: Record<string, string>, state: string) => string;
  /** code → 用户信息（真实网络调用；测试走 mock） */
  exchange: (cfg: Record<string, string>, code: string) => Promise<OauthProfile>;
}

const STATE_TTL_S = 300;

/** 8s 超时：渠道接口挂掉时不能把登录请求一直吊死（前端会以为按钮没反应） */
const EXCHANGE_TIMEOUT_MS = 8_000;

async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`provider http ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  return json;
}

/** 渠道返回里的"业务错误"（HTTP 200 + errcode）：必须显式转失败，不能当成功 */
function providerError(payload: Record<string, unknown>): never {
  const errcode = payload.errcode ?? payload.error ?? payload.errno;
  const errmsg = payload.errmsg ?? payload.error_description ?? payload.message;
  throw new AppError(ErrorCode.INVALID_PARAM, `provider error: ${String(errmsg ?? errcode ?? "unknown")}`, {
    reason: "provider_exchange_failed",
    errcode: errcode === undefined ? null : String(errcode),
  });
}

const PROVIDER_SPECS: Record<OauthProvider, ProviderSpec> = {
  wechat: {
    provider: "wechat",
    label: "微信",
    idVar: "OAUTH_WECHAT_APP_ID",
    secretVar: "OAUTH_WECHAT_SECRET",
    redirectVar: "OAUTH_WECHAT_REDIRECT_URI",
    authorize: (cfg, state) =>
      `https://open.weixin.qq.com/connect/qrconnect?appid=${encodeURIComponent(cfg.OAUTH_WECHAT_APP_ID ?? "")}` +
      `&redirect_uri=${encodeURIComponent(cfg.OAUTH_WECHAT_REDIRECT_URI ?? "")}` +
      `&response_type=code&scope=snsapi_login&state=${encodeURIComponent(state)}#wechat_redirect`,
    exchange: async (cfg, code) => {
      // 微信开放平台：先 code 换 access_token+openid，再拉 userinfo
      const token = await fetchJson(
        "https://api.weixin.qq.com/sns/oauth2/access_token" +
          `?appid=${encodeURIComponent(cfg.OAUTH_WECHAT_APP_ID ?? "")}` +
          `&secret=${encodeURIComponent(cfg.OAUTH_WECHAT_SECRET ?? "")}` +
          `&code=${encodeURIComponent(code)}&grant_type=authorization_code`,
      );
      if (token.errcode) providerError(token);
      const openId = String(token.openid ?? "");
      const accessToken = String(token.access_token ?? "");
      if (!openId || !accessToken) providerError(token);
      const info = await fetchJson(
        "https://api.weixin.qq.com/sns/userinfo" +
          `?access_token=${encodeURIComponent(accessToken)}&openid=${encodeURIComponent(openId)}&lang=zh_CN`,
      );
      if (info.errcode) providerError(info);
      // unionid 优先：同一开发平台下多应用要归一到同一个用户
      const externalId = String(token.unionid ?? info.unionid ?? openId);
      return {
        external_id: externalId,
        nickname: String(info.nickname ?? "微信用户"),
        avatar: typeof info.headimgurl === "string" ? info.headimgurl : null,
      };
    },
  },
  qq: {
    provider: "qq",
    label: "QQ",
    idVar: "OAUTH_QQ_APP_ID",
    secretVar: "OAUTH_QQ_APP_KEY",
    redirectVar: "OAUTH_QQ_REDIRECT_URI",
    authorize: (cfg, state) =>
      `https://graph.qq.com/oauth2.0/authorize?response_type=code` +
      `&client_id=${encodeURIComponent(cfg.OAUTH_QQ_APP_ID ?? "")}` +
      `&redirect_uri=${encodeURIComponent(cfg.OAUTH_QQ_REDIRECT_URI ?? "")}` +
      `&state=${encodeURIComponent(state)}&scope=get_user_info`,
    exchange: async (cfg, code) => {
      const token = await fetchJson(
        "https://graph.qq.com/oauth2.0/token?grant_type=authorization_code" +
          `&client_id=${encodeURIComponent(cfg.OAUTH_QQ_APP_ID ?? "")}` +
          `&client_secret=${encodeURIComponent(cfg.OAUTH_QQ_APP_KEY ?? "")}` +
          `&code=${encodeURIComponent(code)}` +
          `&redirect_uri=${encodeURIComponent(cfg.OAUTH_QQ_REDIRECT_URI ?? "")}&fmt=json`,
      );
      if (!token.access_token) providerError(token);
      const me = await fetchJson(
        `https://graph.qq.com/oauth2.0/me?access_token=${encodeURIComponent(String(token.access_token))}&fmt=json`,
      );
      const openId = String(me.openid ?? "");
      if (!openId) providerError(me);
      const info = await fetchJson(
        "https://graph.qq.com/user/get_user_info" +
          `?access_token=${encodeURIComponent(String(token.access_token))}` +
          `&oauth_consumer_key=${encodeURIComponent(cfg.OAUTH_QQ_APP_ID ?? "")}` +
          `&openid=${encodeURIComponent(openId)}`,
      );
      if (Number(info.ret ?? 0) !== 0) providerError(info);
      return {
        external_id: openId,
        nickname: String(info.nickname ?? "QQ用户"),
        avatar: typeof info.figureurl_qq_1 === "string" ? info.figureurl_qq_1 : null,
      };
    },
  },
  apple: {
    provider: "apple",
    label: "Apple",
    idVar: "OAUTH_APPLE_CLIENT_ID",
    secretVar: "OAUTH_APPLE_PRIVATE_KEY",
    redirectVar: "OAUTH_APPLE_REDIRECT_URI",
    authorize: (cfg, state) =>
      `https://appleid.apple.com/auth/authorize?response_type=code` +
      `&client_id=${encodeURIComponent(cfg.OAUTH_APPLE_CLIENT_ID ?? "")}` +
      `&redirect_uri=${encodeURIComponent(cfg.OAUTH_APPLE_REDIRECT_URI ?? "")}` +
      `&scope=${encodeURIComponent("name email")}&response_mode=form_post&state=${encodeURIComponent(state)}`,
    exchange: async (cfg, code) => {
      /**
       * Apple 的 token 端点要求 `client_secret` 是**用私钥 ES256 签出的 JWT**（而不是明文密钥），
       * 所以这里用私钥现签一个 5 分钟有效的 client_secret。
       *
       * id_token **必须验签**（见 `apple-id-token.ts` 的注释）：它是身份断言，
       * 不验签时 `sub` 与一段随手 base64 的 JSON 等价；同时校验 iss/aud/exp。
       * 失败一律走 `providerError`（400101 + 稳定 reason），**绝不降级为"信任解码结果"**。
       */
      const { createSign } = await import("node:crypto");
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: process.env.OAUTH_APPLE_KEY_ID ?? "" }))
        .toString("base64url");
      const claims = Buffer.from(
        JSON.stringify({
          iss: process.env.OAUTH_APPLE_TEAM_ID ?? "",
          iat: now,
          exp: now + 300,
          aud: "https://appleid.apple.com",
          sub: cfg.OAUTH_APPLE_CLIENT_ID ?? "",
        }),
      ).toString("base64url");
      const signer = createSign("SHA256");
      signer.update(`${header}.${claims}`);
      const signature = signer.sign(cfg.OAUTH_APPLE_PRIVATE_KEY ?? "", "base64url");
      const clientSecret = `${header}.${claims}.${signature}`;
      const res = await fetch("https://appleid.apple.com/auth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: cfg.OAUTH_APPLE_CLIENT_ID ?? "",
          client_secret: clientSecret,
          redirect_uri: cfg.OAUTH_APPLE_REDIRECT_URI ?? "",
        }),
        signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
      });
      const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) providerError(payload);
      const idToken = String(payload.id_token ?? "");
      if (!idToken) providerError(payload);
      const verified: VerifiedAppleClaims = await verifyAppleIdToken(idToken, {
        clientId: cfg.OAUTH_APPLE_CLIENT_ID ?? "",
      }).catch((err: unknown) => {
        // reason 是稳定枚举（bad_signature/expired/bad_audience/...），可直接进 details 排障；
        // 不回显 token 本身，避免把凭据写进日志与响应。
        providerError({
          oauth_error: "id_token_invalid",
          reason: err instanceof AppleIdTokenError ? err.reason : "verify_failed",
        });
      });
      return {
        external_id: verified.sub,
        nickname: verified.email ? verified.email.split("@")[0] : "Apple用户",
        avatar: null,
      };
    },
  },
  douyin: {
    provider: "douyin",
    label: "抖音",
    idVar: "OAUTH_DOUYIN_CLIENT_KEY",
    secretVar: "OAUTH_DOUYIN_SECRET",
    redirectVar: "OAUTH_DOUYIN_REDIRECT_URI",
    authorize: (cfg, state) =>
      `https://open.douyin.com/platform/oauth/connect/?client_key=${encodeURIComponent(cfg.OAUTH_DOUYIN_CLIENT_KEY ?? "")}` +
      `&response_type=code&scope=${encodeURIComponent("user_info")}` +
      `&redirect_uri=${encodeURIComponent(cfg.OAUTH_DOUYIN_REDIRECT_URI ?? "")}` +
      `&state=${encodeURIComponent(state)}`,
    exchange: async (cfg, code) => {
      const token = await fetchJson("https://open.douyin.com/oauth/access_token/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_key: cfg.OAUTH_DOUYIN_CLIENT_KEY,
          client_secret: cfg.OAUTH_DOUYIN_SECRET,
          code,
          grant_type: "authorization_code",
        }),
      });
      const data = (token.data ?? {}) as Record<string, unknown>;
      const openId = String(data.open_id ?? "");
      const accessToken = String(data.access_token ?? "");
      if (!openId) providerError(token);
      const info = await fetchJson(
        "https://open.douyin.com/oauth/userinfo/" +
          `?access_token=${encodeURIComponent(accessToken)}&open_id=${encodeURIComponent(openId)}`,
      );
      const profile = (info.data ?? {}) as Record<string, unknown>;
      return {
        external_id: openId,
        nickname: String(profile.nickname ?? "抖音用户"),
        avatar: typeof profile.avatar === "string" ? profile.avatar : null,
      };
    },
  },
};

@Injectable()
export class OauthService {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  private spec(provider: string): ProviderSpec {
    const spec = PROVIDER_SPECS[provider as OauthProvider];
    if (!spec) {
      throw new AppError(ErrorCode.INVALID_PARAM, `unsupported provider: ${provider}（unsupported_provider）`, {
        field: "provider",
        reason: "unsupported_provider",
        allowed: [...OAUTH_PROVIDERS],
      });
    }
    return spec;
  }

  /** 该渠道的凭据是否配齐（三个变量都在才算） */
  private config(provider: OauthProvider): Record<string, string> | null {
    const spec = PROVIDER_SPECS[provider];
    const out: Record<string, string> = {};
    for (const key of [spec.idVar, spec.secretVar, spec.redirectVar]) {
      const value = process.env[key];
      if (!value || value.length === 0) return null;
      out[key] = value;
    }
    // 额外必填（Apple 的签发需要 team/key id，缺失时登录必然失败，直接当"未配置"）
    if (provider === "apple" && (!process.env.OAUTH_APPLE_TEAM_ID || !process.env.OAUTH_APPLE_KEY_ID)) return null;
    return out;
  }

  isConfigured(provider: OauthProvider): boolean {
    return this.config(provider) !== null;
  }

  /**
   * mock 开关：**只在非生产**且显式 `OAUTH_MOCK=1` 时生效。
   *
   * 为什么需要：本仓库没有渠道测试账号，CI/测试机也不会去调微信。但"成功路径"必须被
   * 真实覆盖（否则等于只有失败路径有测试）。mock 只替换**渠道那一跳**（code→用户信息），
   * 之后的建号/绑定/发 token 全走真实链路，所以测出来的仍然是真语义。
   * 生产环境下即使误设 OAUTH_MOCK=1 也不生效（`NODE_ENV === "production"` 短路）。
   */
  private mockEnabled(): boolean {
    return process.env.NODE_ENV !== "production" && process.env.OAUTH_MOCK === "1";
  }

  /** 渠道清单（登录页用来决定哪些按钮可点） */
  listProviders() {
    return {
      list: OAUTH_PROVIDERS.map((provider) => {
        const spec = PROVIDER_SPECS[provider];
        const configured = this.isConfigured(provider);
        return {
          provider,
          label: spec.label,
          configured,
          // 未配置时显式给原因，前端 tooltip 直接用
          disabled_reason: configured ? null : "provider_not_configured",
        };
      }),
      mock: this.mockEnabled(),
    };
  }

  /** 生成授权 URL + state（state 落 Redis 5 分钟，一次性） */
  async createAuthorizeUrl(provider: string) {
    const spec = this.spec(provider);
    const cfg = this.config(spec.provider);
    if (!cfg) {
      throw new AppError(ErrorCode.INVALID_PARAM, `${spec.label}登录未配置（provider_not_configured）`, {
        provider: spec.provider,
        reason: "provider_not_configured",
        missing: [spec.idVar, spec.secretVar, spec.redirectVar],
      });
    }
    const state = randomUUID();
    await this.redis.set(
      `oauth:state:${spec.provider}:${state}`,
      JSON.stringify({ provider: spec.provider, created_at: Date.now() }),
      STATE_TTL_S,
    );
    return {
      provider: spec.provider,
      authorize_url: spec.authorize(cfg, state),
      state,
      expires_in: STATE_TTL_S,
      // 明确告诉前端：mock 模式下点的不是真实渠道（避免验收时误判"渠道已通"）
      mock: this.mockEnabled(),
    };
  }

  /**
   * 回调：校验 state（一次性）→ code 换用户信息。
   *
   * state 无论成功失败都先删：失败后重放同一个 state 也必须被拒（否则可被用来
   * 反复尝试 code）。返回的 profile 交给 AuthService 做绑定/建号。
   */
  async exchangeCode(provider: string, code: string, state: string): Promise<{ profile: OauthProfile; mock: boolean }> {
    const spec = this.spec(provider);
    const cfg = this.config(spec.provider);
    if (!cfg) {
      throw new AppError(ErrorCode.INVALID_PARAM, `${spec.label}登录未配置（provider_not_configured）`, {
        provider: spec.provider,
        reason: "provider_not_configured",
      });
    }
    if (!state || state.length < 8) {
      throw new AppError(ErrorCode.INVALID_PARAM, "缺少 state（state_invalid）", {
        field: "state",
        reason: "state_invalid",
      });
    }
    const key = `oauth:state:${spec.provider}:${state}`;
    const stored = await this.redis.get(key);
    await this.redis.del(key);
    if (!stored) {
      throw new AppError(ErrorCode.INVALID_PARAM, "state 已失效（过期或已被使用）（state_invalid）", {
        field: "state",
        reason: "state_invalid",
      });
    }
    if (this.mockEnabled()) {
      // mock：用 code 派生稳定 external_id，便于断言"同一 code/同一外部账号只建一个用户"
      return {
        mock: true,
        profile: {
          external_id: `${spec.provider}_mock_${code}`,
          nickname: `${spec.label}用户${code.slice(-2)}`,
          avatar: null,
        },
      };
    }
    try {
      return { mock: false, profile: await spec.exchange(cfg, code) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      // 网络/协议失败 → 参数类错误 + 明确 reason；**绝不**降级成"登录成功但没用户信息"
      throw new AppError(ErrorCode.INVALID_PARAM, `渠道换取用户信息失败（provider_exchange_failed）：${message.slice(0, 120)}`, {
        provider: spec.provider,
        reason: "provider_exchange_failed",
      });
    }
  }
}


