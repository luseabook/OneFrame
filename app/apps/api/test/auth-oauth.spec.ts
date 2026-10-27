import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { pool } from "../src/db/database";

/**
 * 第三方登录（SSO）+ 双 token 契约测试 —— 对照 `rea-reelmate/cmd/login.md` 与
 * `d-commerce-account.md` 的四渠道登录，以及本批要求：
 *
 * 1. **未配置渠道绝不返回假成功**：`400101`，且消息里带机器可读的
 *    `provider_not_configured`（全局 AllExceptionsFilter 只下发 `{code,msg}`，
 *    `details` 不出网——这是全仓一致行为，见回报「需要 Lead 做」）；
 * 2. **双 token**：`access` 只用于业务端点；`master` 长有效期、**只能**换 access
 *    （拿 master 打业务端点必须 401，这条是最容易被"图省事"改坏的）；
 * 3. `POST /auth/renew` 只续 access：不轮换 refresh、不轮换 master；
 * 4. `state` 一次性：成功消费后重放必须 `state_invalid`（否则可被用来伪造第三方绑定）。
 *
 * 关于 mock：本仓库没有渠道测试账号，CI 也不能调微信。所以这里用**显式开关**
 * `OAUTH_MOCK=1`（且非 production 才生效）替换"渠道那一跳"，之后的建号/绑定/发 token
 * 全走真实链路——测出来仍是真语义。生产即使误设也不生效（service 里短路）。
 */

const OAUTH_ENV_KEYS = [
  "OAUTH_WECHAT_APP_ID",
  "OAUTH_WECHAT_SECRET",
  "OAUTH_WECHAT_REDIRECT_URI",
  "OAUTH_QQ_APP_ID",
  "OAUTH_QQ_APP_KEY",
  "OAUTH_QQ_REDIRECT_URI",
  "OAUTH_MOCK",
];

describe("auth oauth (SSO) + 双 token e2e", () => {
  let app: NestFastifyApplication;
  const savedEnv: Record<string, string | undefined> = {};

  /** 测试内切换"已配置/未配置"：service 是调用时读 process.env，所以能即时生效 */
  function setOauthEnv(vars: Record<string, string | undefined>): void {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  const inject = async (
    method: string,
    url: string,
    payload?: unknown,
    token?: string,
    spaceId?: string,
  ) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    if (spaceId) headers["x-space-id"] = spaceId;
    const res = await app.inject({
      method: method as "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      body = { raw: res.body };
    }
    return {
      status: res.statusCode,
      code: (body as { code?: number }).code ?? -1,
      msg: (body as { msg?: string }).msg ?? "",
      data: (body as { data?: unknown }).data,
      body,
      setCookie: res.headers["set-cookie"],
    };
  };

  async function loginNewUser(prefix: string): Promise<{ token: string; spaceId: string; userId: string; body: Record<string, unknown> }> {
    const tail = String(Date.now()).slice(-8);
    const tag = String(prefix).replace(/\D/g, "").slice(-2).padStart(2, "0");
    const phone = `1${tail}${tag}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login.data as { access_token?: string; space_id?: string; user?: { id?: string } } | undefined;
    return {
      token: data?.access_token ?? "",
      spaceId: String(data?.space_id ?? ""),
      userId: String(data?.user?.id ?? ""),
      body: (login.data ?? {}) as Record<string, unknown>,
    };
  }

  beforeAll(async () => {
    for (const key of OAUTH_ENV_KEYS) savedEnv[key] = process.env[key];
    for (const key of OAUTH_ENV_KEYS) delete process.env[key];
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
      logger: false,
    });
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 90_000);

  afterAll(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await app.close();
    await pool.end().catch(() => undefined);
  });

  // ── 1. 未配置：绝不假成功 ───────────────────────────────

  it("未配置任一渠道：providers 全部 configured=false；取授权 URL 一律 400101+provider_not_configured", async () => {
    const providers = await inject("GET", "/auth/oauth/providers");
    expect(providers.code).toBe(0);
    const list = (providers.data as { list: Array<{ provider: string; configured: boolean; disabled_reason: string | null }> }).list;
    expect(list.map((p) => p.provider).sort()).toEqual(["apple", "douyin", "qq", "wechat"]);
    // 默认测试环境没有任何渠道凭据 → 全未配置，且必须给出 disabled_reason（前端置灰 + tooltip 用）
    for (const p of list) {
      expect(p.configured).toBe(false);
      expect(p.disabled_reason).toBe("provider_not_configured");
    }

    const url = await inject("POST", "/auth/oauth/wechat/url", {});
    expect(url.code).toBe(400101);
    expect(url.msg).toContain("provider_not_configured");
    // 关键反例：绝不能返回一个"看起来能跳"的授权地址
    expect(url.data).toBeNull();
  });

  it("不支持的 provider → 400101 unsupported_provider（不静默当成 wechat）", async () => {
    const res = await inject("POST", "/auth/oauth/weibo/url", {});
    expect(res.code).toBe(400101);
    expect(res.msg).toContain("unsupported_provider");
  });

  // ── 2. 配置态：拿到 url + state ─────────────────────────

  it("配置态：providers 标记 configured=true；授权 URL 带 state 与渠道域名（state 落 Redis 5 分钟）", async () => {
    setOauthEnv({
      OAUTH_WECHAT_APP_ID: "wx_test_app",
      OAUTH_WECHAT_SECRET: "wx_test_secret",
      OAUTH_WECHAT_REDIRECT_URI: "http://127.0.0.1:3002/v1/auth/oauth/wechat/callback",
      OAUTH_MOCK: "1",
    });
    try {
      const providers = await inject("GET", "/auth/oauth/providers");
      const list = (providers.data as { list: Array<{ provider: string; configured: boolean }> }).list;
      const wechat = list.find((p) => p.provider === "wechat")!;
      expect(wechat.configured).toBe(true);
      // 其它渠道仍未配置：配置是**按渠道**生效的，不能一个渠道配好就全绿
      expect(list.find((p) => p.provider === "qq")!.configured).toBe(false);

      const url = await inject("POST", "/auth/oauth/wechat/url", {});
      expect(url.code).toBe(0);
      const data = url.data as { authorize_url: string; state: string; expires_in: number };
      expect(data.authorize_url).toContain("open.weixin.qq.com");
      expect(data.authorize_url).toContain(`state=${data.state}`);
      expect(data.authorize_url).toContain(encodeURIComponent("http://127.0.0.1:3002/v1/auth/oauth/wechat/callback"));
      expect(data.state.length).toBeGreaterThanOrEqual(8);
      expect(data.expires_in).toBe(300);
    } finally {
      setOauthEnv({
        OAUTH_WECHAT_APP_ID: undefined,
        OAUTH_WECHAT_SECRET: undefined,
        OAUTH_WECHAT_REDIRECT_URI: undefined,
        OAUTH_MOCK: undefined,
      });
    }
  });

  // ── 3. state 一次性 ────────────────────────────────────

  it("回调 state 校验：伪造/重放/缺失都 400101 state_invalid（CSRF 防护不可绕过）", async () => {
    setOauthEnv({
      OAUTH_WECHAT_APP_ID: "wx_test_app",
      OAUTH_WECHAT_SECRET: "wx_test_secret",
      OAUTH_WECHAT_REDIRECT_URI: "http://127.0.0.1:3002/v1/auth/oauth/wechat/callback",
      OAUTH_MOCK: "1",
    });
    try {
      const forged = await inject("POST", "/auth/oauth/wechat/callback", {
        code: "abc",
        state: "11111111-1111-1111-1111-111111111111",
      });
      expect(forged.code).toBe(400101);
      expect(forged.msg).toContain("state_invalid");

      const missing = await inject("POST", "/auth/oauth/wechat/callback", { code: "abc" });
      expect(missing.code).toBe(400101);

      // 正常走一遍，再用同一个 state 重放 → 必须被拒（state 消费即删）
      const url = await inject("POST", "/auth/oauth/wechat/url", {});
      const state = (url.data as { state: string }).state;
      const first = await inject("POST", "/auth/oauth/wechat/callback", { code: "replay1", state });
      expect(first.code).toBe(0);
      const replay = await inject("POST", "/auth/oauth/wechat/callback", { code: "replay1", state });
      expect(replay.code).toBe(400101);
      expect(replay.msg).toContain("state_invalid");
    } finally {
      setOauthEnv({
        OAUTH_WECHAT_APP_ID: undefined,
        OAUTH_WECHAT_SECRET: undefined,
        OAUTH_WECHAT_REDIRECT_URI: undefined,
        OAUTH_MOCK: undefined,
      });
    }
  });

  // ── 4. 成功路径：建号 / 绑定复用 / 双 token ─────────────

  it("OAuth 首登建号（created=true）并发 master+access；同 external_id 二次登录复用同一用户（不重复建号）", async () => {
    setOauthEnv({
      OAUTH_QQ_APP_ID: "qq_test_app",
      OAUTH_QQ_APP_KEY: "qq_test_secret",
      OAUTH_QQ_REDIRECT_URI: "http://127.0.0.1:3002/v1/auth/oauth/qq/callback",
      OAUTH_MOCK: "1",
    });
    try {
      const externalCode = `bind${String(Date.now()).slice(-6)}`;
      const url1 = await inject("POST", "/auth/oauth/qq/url", {});
      const state1 = (url1.data as { state: string }).state;
      const login1 = await inject("POST", "/auth/oauth/qq/callback", { code: externalCode, state: state1 });
      expect(login1.code).toBe(0);
      const d1 = login1.data as {
        created: boolean;
        provider: string;
        access_token: string;
        master_token: string;
        master_expires_in: number;
        space_id: string;
        user: { id: string };
        mock: boolean;
      };
      expect(d1.created).toBe(true);
      expect(d1.provider).toBe("qq");
      expect(d1.mock).toBe(true); // 让验收者一眼看出走的是 mock 渠道跳
      expect(d1.access_token.length).toBeGreaterThan(20);
      expect(d1.master_token.length).toBeGreaterThan(20);
      expect(d1.master_expires_in).toBeGreaterThan(86_400);
      // 浏览器端：refresh 仍走 httpOnly Cookie（与手机号登录完全一致）
      expect(String(login1.setCookie ?? "")).toContain("refresh_token=");

      // 第二次登录（同一个外部账号，state 换一个新的）→ 不许建新号
      const url2 = await inject("POST", "/auth/oauth/qq/url", {});
      const state2 = (url2.data as { state: string }).state;
      const login2 = await inject("POST", "/auth/oauth/qq/callback", { code: externalCode, state: state2 });
      expect(login2.code).toBe(0);
      const d2 = login2.data as { created: boolean; user: { id: string }; space_id: string };
      expect(d2.created).toBe(false);
      expect(d2.user.id).toBe(d1.user.id);
      expect(d2.space_id).toBe(d1.space_id);

      // 新 access 可正常访问业务端点
      const me = await inject("GET", "/me", undefined, d1.access_token);
      expect(me.code).toBe(0);
      expect((me.data as { user: { id: string } }).user.id).toBe(d1.user.id);
    } finally {
      setOauthEnv({
        OAUTH_QQ_APP_ID: undefined,
        OAUTH_QQ_APP_KEY: undefined,
        OAUTH_QQ_REDIRECT_URI: undefined,
        OAUTH_MOCK: undefined,
      });
    }
  });

  // ── 5. 双 token 边界：master 不得用于业务端点 ───────────

  it("双 token：master 打业务端点 → 401；master 只能经 /auth/renew 换 access", async () => {
    const user = await loginNewUser("21");
    const masterToken = String(user.body.master_token ?? "");
    expect(masterToken.length).toBeGreaterThan(20);

    // 红线：master 不是 access，业务端点必须拒
    const withMaster = await inject("GET", "/me", undefined, masterToken);
    expect(withMaster.code).toBe(401101);
    expect(withMaster.msg).toContain("wrong token type");

    // renew：master → 新 access，且不返回新的 master（不轮换）
    const renew = await inject("POST", "/auth/renew", { master_token: masterToken });
    expect(renew.code).toBe(0);
    const renewed = renew.data as { access_token: string; expires_in: number; master_token?: string };
    expect(renewed.access_token.length).toBeGreaterThan(20);
    expect(renewed.master_token).toBeUndefined();

    const me = await inject("GET", "/me", undefined, renewed.access_token);
    expect(me.code).toBe(0);
    expect((me.data as { user: { id: string } }).user.id).toBe(user.userId);

    // 同一个 master 可以反复续（长有效期的意义），不会一次就失效
    const renewAgain = await inject("POST", "/auth/renew", { master_token: masterToken });
    expect(renewAgain.code).toBe(0);
  });

  it("renew 负例：无凭据 / 拿 access 冒充 master / 登出后 → 401", async () => {
    const none = await inject("POST", "/auth/renew", {});
    expect(none.code).toBe(401101);

    const user = await loginNewUser("22");
    const accessAsMaster = await inject("POST", "/auth/renew", { master_token: user.token });
    expect(accessAsMaster.code).toBe(401101);

    // 登出会 revoke master：之后 renew 必须失败（长有效期不等于永久凭据）
    const logout = await inject("POST", "/auth/logout", {}, user.token);
    expect(logout.code).toBe(0);
    const afterLogout = await inject("POST", "/auth/renew", { master_token: String(user.body.master_token) });
    expect(afterLogout.code).toBe(401101);
  });

  it("登录响应同时下发双 token（字段齐全，且 refresh 仍只走 Cookie 不下发 body 明文）", async () => {
    const user = await loginNewUser("23");
    expect(user.body.access_token).toBeTruthy();
    expect(user.body.master_token).toBeTruthy();
    expect(Number(user.body.master_expires_in)).toBeGreaterThan(0);
    // 历史约定：refresh_token 不进 body（httpOnly Cookie）
    expect(user.body.refresh_token).toBeUndefined();
  });
});

