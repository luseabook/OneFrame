import { Body, Controller, Get, Param, Post, Put, Query, Req, Res , Inject} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { loginRequestSchema, smsCodeRequestSchema, AppError, ErrorCode, readEnvFlag } from "@app/shared";
import { env, smsLoginEnabled } from "../../config/env";
import { llmStatus } from "../../health/llm-status";
import { CAPTCHA_ENFORCE_SPEC } from "../../config/env-values";
import { Public } from "../../common/public.decorator";
import { clientIp } from "../../common/client-ip";
import { parseOrThrow } from "../../common/zod";
import type { AuthedRequest } from "../../common/auth.types";
import { AuthService } from "./auth.service";
import { OauthService } from "./oauth.service";
import { CaptchaService } from "../moderation/captcha.service";

/**
 * 发码入参：公共契约 + `invite_code` + **可选**行为验证码。
 *
 * 验证码是"开关式"的：`CAPTCHA_ENFORCE=1` 时必填，默认关（现有 e2e/真机验收全走无码路径）。
 * 字段名 `captcha_ticket`/`captcha_answer` 与 `POST /moderation/captcha/verify` 同口径。
 */
/**
 * 资料更新入参（第 85 批：竞品 `POST /web/v1/user-info`）。
 * 两个字段都可选，但至少要给一个 —— 空 body 打进来按 400101 拒掉，
 * 而不是"什么也没改却回 200 成功"（那会让客户端以为保存生效了）。
 */
const userInfoBody = z.object({
  nickname: z.string().max(40).optional(),
  avatar_uri: z.string().max(512).nullable().optional(),
});

/**
 * 设置写入入参（第 85 批：竞品 `PUT /web/v1/user-settings`）。
 *
 * 竞品的 requestDataJsonSchema 是 `{}`，没有任何字段证据，所以这里**同时**接受三种写法：
 * `{scope_type, settings:{...}}`、`{scope_type, patch:{...}}`、以及把键直接平铺在 body 顶层。
 * 前两种是"明确包裹"，第三种是兼容"客户端直接把设置对象扔过来"的写法。
 */
const userSettingsBody = z.object({
  scope_type: z.string().max(32).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  patch: z.record(z.string(), z.unknown()).optional(),
});

const smsBody = smsCodeRequestSchema.extend({
  invite_code: z.string().min(1).optional(),
  captcha_ticket: z.string().min(1).max(2048).optional(),
  captcha_answer: z.union([z.string().max(20), z.number()]).optional(),
});
const loginBody = loginRequestSchema.extend({
  invite_code: z.string().min(1).optional(),
  age_confirmed: z.boolean().optional(),
  /** `false` → refresh Cookie 不写 maxAge（浏览器关闭即失效）。缺省 true，与历史行为一致 */
  keep_login: z.boolean().optional(),
  captcha_ticket: z.string().min(1).max(2048).optional(),
  captcha_answer: z.union([z.string().max(20), z.number()]).optional(),
});
/**
 * 邮箱 + 密码注册（api-spec §33.6，第 130 批）。
 * 长度上限按 RFC 5321（邮箱 254）与实际可用性取；密码上限 72 是 scrypt/BCrypt 系列
 * 通行的"别拿超长串打 CPU"的护栏（不是截断，是拒绝）。
 */
const emailRegisterBody = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(8).max(72),
  invite_code: z.string().min(1).max(32).optional(),
  age_confirmed: z.boolean().optional(),
  keep_login: z.boolean().optional(),
});
/**
 * 密码登录：`identifier` 现在是**邮箱**（手机号密码登录未开放，服务里显式拒绝）。
 * 字段名用 `identifier` 而不是 `email`，是为了将来开放手机号密码登录时前端零改动。
 */
const passwordLoginBody = z.object({
  identifier: z.string().min(1).max(254),
  password: z.string().min(1).max(72),
  keep_login: z.boolean().optional(),
});
const waitlistBody = z.object({
  phone: z.string().regex(/^1\d{10}$/),
  source: z.string().max(50).optional(),
});
const oauthCallbackBody = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(8).max(128),
  /** 首登补年满确认（第三方渠道拿不到，按竞品做法在首登表单收集） */
  age_confirmed: z.boolean().optional(),
});
const renewBody = z.object({
  master_token: z.string().min(10).optional(),
});
const bindPhoneBody = z.object({
  phone: z.string().regex(/^1\d{10}$/),
  code: z.string().regex(/^\d{6}$/),
});

@Controller()
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OauthService) private readonly oauth: OauthService,
    @Inject(CaptchaService) private readonly captcha: CaptchaService,
  ) {
    // 说明：验证码在本 controller 里是"可选闸门"，见 smsBody 注释与 enforceCaptcha()
  }

  /**
   * 可选的行为验证码闸门（`CAPTCHA_ENFORCE` 打开时生效，默认关）。
   *
   * 为什么放在 controller 而不是 service：它只拦"发码/登录"这两个入口，
   * 而 `AuthService` 本身还要被 OAuth/内部调用复用（那些路径不该被算术题挡住）。
   * 为什么现场读环境变量而不是 `env` 常量：测试需要在同一进程里切"开/关"两态（与 OAuth 同口径）。
   *
   * 第 124 批：判定改走唯一入口 `readEnvFlag`（1/true/yes/on；0/false/no/off），
   * 旧写法 `String(...) !== "1"` 把 `CAPTCHA_ENFORCE=true` 判成「关」——强制校验没开，
   * 入口在没有任何提示的情况下直接放行。坏值在启动时已被 schema 拦住，此处只可能在
   * 运行期被改动后抛错（响亮失败，不静默放行）。
   */
  private async enforceCaptcha(input: { captcha_ticket?: string; captcha_answer?: unknown }): Promise<void> {
    if (!readEnvFlag("CAPTCHA_ENFORCE", CAPTCHA_ENFORCE_SPEC)) return;
    if (!input.captcha_ticket) {
      throw new AppError(ErrorCode.INVALID_PARAM, "captcha required (captcha_required)", {
        field: "captcha_ticket",
      });
    }
    const result = await this.captcha.verify(input.captcha_ticket, input.captcha_answer);
    if (!result.passed) {
      throw new AppError(ErrorCode.INVALID_PARAM, `captcha failed (${result.reason ?? "wrong_answer"})`, {
        field: "captcha_answer",
        reason: result.reason,
        retry_allowed: result.retry_allowed,
      });
    }
  }

  /**
   * 短信登录闸门（2026-11-04 产品决策：**不接短信网关**）。
   *
   * 关闭时两个入口都回 400101 并明确指引邮箱 + 密码。为什么不是「继续回 200、只是不发送」：
   * 那样前端会显示"验证码已发送"，用户等一分钟再点重发，最后发现整条路是死的 ——
   * 沉默失败比报错更难定位，也让客服无法判断到底哪一步坏了。
   */
  private ensureSmsLoginEnabled(): void {
    if (smsLoginEnabled(env)) return;
    throw new AppError(ErrorCode.INVALID_PARAM, "短信登录暂未开放，请使用邮箱 + 密码登录", {
      field: "phone",
    });
  }

  @Public()
  @Post("auth/sms-code")
  async sms(@Body() body: unknown, @Req() req: FastifyRequest): Promise<{ debug_code?: string }> {
    this.ensureSmsLoginEnabled();
    const input = parseOrThrow(smsBody, body);
    await this.enforceCaptcha(input);
    return this.auth.sendCode(input.phone, clientIp(req));
  }

  @Public()
  @Post("auth/login")
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: FastifyReply) {
    this.ensureSmsLoginEnabled();
    const input = parseOrThrow(loginBody, body);
    // 登录入口同样走可选验证码闸门（同一开关，避免"发码防住了、登录没防"的半吊子状态）
    await this.enforceCaptcha(
      input as { captcha_ticket?: string; captcha_answer?: unknown },
    );
    const result = await this.auth.login(input.phone, input.code, input.invite_code, input.age_confirmed);
    this.setRefreshCookie(res, result.refresh_token, input.keep_login);
    const { refresh_token: _ignored, ...payload } = result;
    return payload;
  }

  @Public()
  @Post("auth/email/register")
  async registerEmail(@Body() body: unknown, @Res({ passthrough: true }) res: FastifyReply) {
    const input = parseOrThrow(emailRegisterBody, body);
    // 与短信注册保持同一条合规闸门：新账号必须有成年确认（建号即落 age_declared_at）
    // 注意字段名映射：HTTP 契约是 snake_case，服务内部是 camelCase——漏映射的后果是
    // `ageConfirmed` 永远是 undefined，于是"已勾选成年"也一律被判成未勾选。
    const result = await this.auth.registerWithPassword({
      email: input.email,
      password: input.password,
      inviteCode: input.invite_code,
      ageConfirmed: input.age_confirmed,
    });
    this.setRefreshCookie(res, result.refresh_token, input.keep_login);
    const { refresh_token: _ignored, ...payload } = result;
    return payload;
  }

  /**
   * 密码登录（api-spec §33.6）。返回体与 `POST /v1/auth/login` **完全一致**
   * （`access_token/expires_in/user/space_id/master_token/...`，refresh 走 httpOnly Cookie），
   * 前端两条路径可以共用同一段"登录成功后"的逻辑。
   */
  @Public()
  @Post("auth/login/password")
  async loginPassword(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const input = parseOrThrow(passwordLoginBody, body);
    // 传真实来源 IP：失败限流按「账号哈希 + IP」计数（SEC-04），与 admin 登录同口径
    const result = await this.auth.loginWithPassword({ ...input, ip: clientIp(req) });
    this.setRefreshCookie(res, result.refresh_token, input.keep_login);
    const { refresh_token: _ignored, ...payload } = result;
    return payload;
  }

  @Public()
  @Post("auth/refresh")
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const token = req.cookies?.refresh_token;
    const result = await this.auth.refresh(token);
    this.setRefreshCookie(res, result.refresh_token);
    const { refresh_token: _ignored, ...payload } = result;
    return payload;
  }

  @Post("auth/logout")
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const auth = req.auth;
    if (!auth) return { ok: true };
    await this.auth.logout(auth.userId, auth.jti);
    res.clearCookie("refresh_token", { path: "/v1/auth" });
    return { ok: true };
  }

  @Get("me")
  async me(@Req() req: AuthedRequest) {
    const auth = req.auth;
    if (!auth) return null;
    const result = await this.auth.me(auth.userId, auth.spaceId);
    /**
     * `llm_mode`（api-spec §33.1，2026-11-03）：`"real" | "mock"`。
     *
     * 只对**已登录**用户暴露：`/v1/ping` 匿名可达，把部署形态广播给任何扫描器没有必要；
     * 而 banner 只对登录后的用户有意义。`mock` 时前端顶栏必须常驻提示且不可关闭
     * —— 假内容不可见等于没有声明（`PAGE-07`/`LOG-04` 同族教训）。
     * 该字段**不参与任何计费/权限分支**。
     */
    return { ...result, llm_mode: llmStatus(env).mode };
  }

  /**
   * 更新账号资料（第 85 批：竞品 `POST /web/v1/user-info`）。
   *
   * 竞品有两条 `user-info`：GET 取资料、POST 改资料。我的 GET 对应物是 `GET /me`（登记为偏离），
   * 但 POST 这条**原先没有** —— 按竞品形状发请求的客户端会 404，所以补上。
   */
  @Post("user-info")
  async updateUserInfo(@Req() req: AuthedRequest, @Body() body: unknown) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.auth.updateProfile(auth.userId, parseOrThrow(userInfoBody, body ?? {}));
  }

  /** 账号设置读取（第 85 批：竞品 `GET /web/v1/user-settings?scope_type=&keys=`） */
  @Get("user-settings")
  async readUserSettings(
    @Req() req: AuthedRequest,
    @Query("scope_type") scopeType?: string,
    @Query("keys") keys?: string | string[],
  ) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.auth.readSettings(auth.userId, scopeType, keys);
  }

  /**
   * 账号设置合并写入（第 85 批：竞品 `PUT /web/v1/user-settings`）。
   *
   * body 里既没有 `settings` 也没有 `patch` 时，把除 `scope_type` 之外的所有顶层键当作设置项
   * —— 竞品没有字段证据，客户端可能是"直接把对象扔过来"。空 patch 一律 400101。
   */
  @Put("user-settings")
  async writeUserSettings(@Req() req: AuthedRequest, @Body() body: unknown) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    const input = parseOrThrow(userSettingsBody, body ?? {});
    const { settings, patch, scope_type } = input;
    let payload = settings ?? patch;
    if (!payload) {
      const rest = { ...(body as Record<string, unknown> | undefined) };
      delete rest.scope_type;
      delete rest.settings;
      delete rest.patch;
      if (Object.keys(rest).length > 0) payload = rest as Record<string, unknown>;
    }
    if (!payload) {
      throw new AppError(ErrorCode.INVALID_PARAM, "settings are required", { field: "settings" });
    }
    return this.auth.mergeSettings(auth.userId, scope_type, payload);
  }

  /**
   * 客户端公网 IP（第 85 批：竞品 `GET /web/v1/user/ip`）。
   *
   * 与 `clientIp(req)` 同口径（信任代理时取 X-Forwarded-For 首个），
   * 前端拿它做"当前区域/网络提示"，也是客服排查的白名单依据。
   */
  @Get("user/ip")
  async userIp(@Req() req: FastifyRequest) {
    return { ip: clientIp(req) };
  }

  /** 保存账号级语言偏好（跨设备跟随账号；空串=清除，回到跟随设备） */
  @Post("me/locale")
  async setLocale(@Req() req: AuthedRequest, @Body() body: { locale?: string }) {
    const auth = req.auth;
    if (!auth) return null;
    return this.auth.setPreferredLocale(auth.userId, String(body?.locale ?? ""));
  }

  /** 标记新手引导已读（PRD 增补 §3.2） */
  @Post("me/onboarded")
  async onboarded(@Req() req: AuthedRequest) {
    const auth = req.auth;
    if (!auth) return null;
    return this.auth.markOnboarded(auth.userId);
  }

  // 账号注销（PRD F1）
  @Post("me/delete")
  async deleteAccount(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    const result = await this.auth.deleteAccount(auth.userId, auth.spaceId);
    res.clearCookie("refresh_token", { path: "/v1/auth" });
    return result;
  }

  /** 已登录账号绑定手机号；不自动合并既有账号。 */
  @Post("auth/bind/phone")
  async bindPhone(@Req() req: AuthedRequest, @Body() body: unknown) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    const input = parseOrThrow(bindPhoneBody, body ?? {});
    return this.auth.bindPhone(auth.userId, input.phone, input.code);
  }

  @Public()
  @Post("waitlist")
  async waitlist(@Body() body: unknown) {
    const input = parseOrThrow(waitlistBody, body);
    return this.auth.waitlist(input.phone, input.source ?? "landing");
  }

  // ── 第三方登录（SSO）────────────────────────────────────

  /**
   * 渠道清单：前端据此决定哪些按钮可点（未配置 → 置灰 + tooltip）。
   *
   * 为什么要单独一个清单端点而不是让前端"点了试错"：置灰状态必须在**首屏**就正确，
   * 否则用户会先看到一个可点按钮、点完才被告知没配置——那是误导性交互。
   */
  @Public()
  @Get("auth/oauth/providers")
  async oauthProviders() {
    return this.oauth.listProviders();
  }

  /** 取授权 URL（state 落 Redis 5 分钟，一次性） */
  @Public()
  @Post("auth/oauth/:provider/url")
  async oauthUrl(@Param("provider") provider: string) {
    return this.oauth.createAuthorizeUrl(provider);
  }

  /** 已登录账号发起第三方渠道绑定；state 里固化当前用户，回调只绑不建号。 */
  @Post("auth/bind/oauth/:provider/url")
  async oauthBindUrl(@Param("provider") provider: string, @Req() req: AuthedRequest) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.oauth.createAuthorizeUrl(provider, auth.userId);
  }

  /**
   * 回调：校验 state → code 换用户信息 → 绑定/建号 → 发双 token。
   *
   * ⚠️ 已知偏离：Apple 的真实回调是 `response_mode=form_post`（浏览器提交表单），
   * 本端点只接 JSON。生产需要在 Web 前置换算（BFF 路由把 form 转成 JSON），
   * 已写进回报「待取证/偏离」；不改协议层是为了不引新依赖与中间件。
   */
  @Public()
  @Post("auth/oauth/:provider/callback")
  async oauthCallback(
    @Param("provider") provider: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const input = parseOrThrow(oauthCallbackBody, body ?? {});
    const { profile, mock, bindUserId } = await this.oauth.exchangeCode(provider, input.code, input.state);
    if (bindUserId) {
      const bound = await this.auth.bindOAuth(bindUserId, provider, profile);
      return { ...bound, mock };
    }
    const result = await this.auth.loginWithOAuth(provider, profile);
    this.setRefreshCookie(res, result.refresh_token);
    const { refresh_token: _ignored, ...payload } = result;
    return { ...payload, mock };
  }

  /**
   * 静默续期：master token → 新 access，**不轮换**任何会话凭据。
   *
   * 兼容老客户端：没有 master（历史会话）时回落到 refresh Cookie，但同样不轮换。
   */
  @Public()
  @Post("auth/renew")
  async renew(@Body() body: unknown, @Req() req: FastifyRequest) {
    const input = parseOrThrow(renewBody, body ?? {});
    return this.auth.renew(input.master_token, req.cookies?.refresh_token);
  }

  /**
   * 写 refresh Cookie。
   *
   * `keepLogin`（第 130 批补）：`false` → **不发 `maxAge`**，浏览器按"会话 Cookie"处理，
   * 关掉浏览器即失效；`true`/缺省 → 发 `maxAge=REFRESH_TTL_S`（14 天），关浏览器仍保留。
   *
   * 为什么由服务端决定而不是前端：前端那个 `keepLogin` 复选框此前是**装饰性控件**
   * （`login()` 从未把值传出去），用户勾不勾都一样 —— 这类"看起来有效的开关"比没有更坏。
   * 现在语义落在唯一能生效的地方：Cookie 的存活期。
   */
  private setRefreshCookie(res: FastifyReply, token: string, keepLogin?: boolean): void {
    res.setCookie("refresh_token", token, {
      httpOnly: true,
      // 默认：production 走 Secure；可由 COOKIE_SECURE 显式覆盖（本地 HTTP 部署需为 false）
      secure: env.COOKIE_SECURE ?? env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/v1/auth",
      ...(keepLogin === false ? {} : { maxAge: env.REFRESH_TTL_S }),
    });
  }
}
