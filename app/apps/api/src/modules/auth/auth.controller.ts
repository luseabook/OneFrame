import { Body, Controller, Get, Param, Post, Req, Res , Inject} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { loginRequestSchema, smsCodeRequestSchema, AppError, ErrorCode } from "@app/shared";
import { env } from "../../config/env";
import { Public } from "../../common/public.decorator";
import { clientIp } from "../../common/client-ip";
import { parseOrThrow } from "../../common/zod";
import type { AuthedRequest } from "../../common/auth.types";
import { AuthService } from "./auth.service";
import { OauthService } from "./oauth.service";

const smsBody = smsCodeRequestSchema.extend({ invite_code: z.string().min(1).optional() });
const loginBody = loginRequestSchema.extend({
  invite_code: z.string().min(1).optional(),
  age_confirmed: z.boolean().optional(),
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

@Controller()
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(OauthService) private readonly oauth: OauthService,
  ) {}

  @Public()
  @Post("auth/sms-code")
  async sms(@Body() body: unknown, @Req() req: FastifyRequest): Promise<{ debug_code?: string }> {
    const input = parseOrThrow(smsBody, body);
    return this.auth.sendCode(input.phone, clientIp(req));
  }

  @Public()
  @Post("auth/login")
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: FastifyReply) {
    const input = parseOrThrow(loginBody, body);
    const result = await this.auth.login(input.phone, input.code, input.invite_code, input.age_confirmed);
    this.setRefreshCookie(res, result.refresh_token);
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
    return this.auth.me(auth.userId, auth.spaceId);
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
    const { profile, mock } = await this.oauth.exchangeCode(provider, input.code, input.state);
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

  private setRefreshCookie(res: FastifyReply, token: string): void {
    res.setCookie("refresh_token", token, {
      httpOnly: true,
      // 默认：production 走 Secure；可由 COOKIE_SECURE 显式覆盖（本地 HTTP 部署需为 false）
      secure: env.COOKIE_SECURE ?? env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/v1/auth",
      maxAge: env.REFRESH_TTL_S,
    });
  }
}
