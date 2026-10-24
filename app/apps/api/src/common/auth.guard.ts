import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { eq } from "drizzle-orm";
import { users } from "@app/db";
import { AppError, ErrorCode } from "@app/shared";
import { IS_PUBLIC_KEY } from "./public.decorator";
import type { AuthedRequest } from "./auth.types";
import { TokenService } from "../modules/auth/token.service";
import { db } from "../db/database";

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "missing bearer token");
    }
    const payload = this.tokens.verifyAccess(header.slice(7));
    await this.tokens.assertAccessActive(payload.jti);
    // 账号已注销/封禁 → token 立即失效
    const [user] = await db
      .select({ status: users.status, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, BigInt(payload.sub)));
    if (!user || user.status !== 1 || user.deletedAt) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "account disabled");
    }
    request.auth = { userId: payload.sub, spaceId: payload.sid, jti: payload.jti };
    return true;
  }
}
