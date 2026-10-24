import { Body, Controller, Get, Post, Req, Res , Inject} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { loginRequestSchema, smsCodeRequestSchema, AppError, ErrorCode } from "@app/shared";
import { env } from "../../config/env";
import { Public } from "../../common/public.decorator";
import { clientIp } from "../../common/client-ip";
import { parseOrThrow } from "../../common/zod";
import type { AuthedRequest } from "../../common/auth.types";
import { AuthService } from "./auth.service";

const smsBody = smsCodeRequestSchema.extend({ invite_code: z.string().min(1).optional() });
const loginBody = loginRequestSchema.extend({
  invite_code: z.string().min(1).optional(),
  age_confirmed: z.boolean().optional(),
});
const waitlistBody = z.object({
  phone: z.string().regex(/^1\d{10}$/),
  source: z.string().max(50).optional(),
});

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

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
