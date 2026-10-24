import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { AppError, ErrorCode } from "@app/shared";
import { AdminAuthService, type AdminAuth } from "./admin-auth.service";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(AdminAuthService) private readonly auth: AdminAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<FastifyRequest & { adminAuth?: AdminAuth }>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "admin auth required");
    }
    try {
      req.adminAuth = this.auth.verify(header.slice(7));
    } catch {
      // 已携带凭证但不是管理员（普通用户 token）→ 403；无凭证仍 401
      throw new AppError(ErrorCode.FORBIDDEN, "admin only");
    }
    return true;
  }
}
