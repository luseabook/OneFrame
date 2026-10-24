import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AppError, ErrorCode } from "@app/shared";
import { IS_PUBLIC_KEY } from "./public.decorator";
import type { AuthedRequest } from "./auth.types";
import { TokenService } from "../modules/auth/token.service";

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
    request.auth = { userId: payload.sub, spaceId: payload.sid, jti: payload.jti };
    return true;
  }
}
