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
    req.adminAuth = this.auth.verify(header.slice(7));
    return true;
  }
}
