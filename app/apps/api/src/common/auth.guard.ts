import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { and, eq } from "drizzle-orm";
import { spaceMembers, spaces, users } from "@app/db";
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

    // ── 空间切换（ADR-010：团队成员的所有请求都带团队 space_id）──
    // token 里的 sid 是登录时的个人空间；团队场景由 `X-Space-Id` 指定目标空间。
    // 安全性：必须校验请求者确实是该空间成员，否则 403——不能只信客户端头。
    let spaceId = payload.sid;
    const rawSpace = request.headers["x-space-id"];
    const requested = Array.isArray(rawSpace) ? rawSpace[0] : rawSpace;
    if (requested && String(requested).trim() !== "" && String(requested) !== spaceId) {
      const target = String(requested).trim();
      let targetId: bigint;
      try {
        targetId = BigInt(target);
      } catch {
        throw new AppError(ErrorCode.INVALID_PARAM, "invalid X-Space-Id", { field: "X-Space-Id" });
      }
      const [membership] = await db
        .select({ status: spaceMembers.status })
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, targetId), eq(spaceMembers.userId, BigInt(payload.sub))));
      if (!membership || membership.status !== 1) {
        throw new AppError(ErrorCode.FORBIDDEN, "not a member of requested space", {
          reason: "not_member",
        });
      }
      const [space] = await db
        .select({ status: spaces.status })
        .from(spaces)
        .where(eq(spaces.id, targetId));
      if (!space || space.status === 2) {
        throw new AppError(ErrorCode.FORBIDDEN, "space disabled", { reason: "space_disabled" });
      }
      spaceId = target;
    }

    request.auth = { userId: payload.sub, spaceId, jti: payload.jti };
    return true;
  }
}
