import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { and, eq } from "drizzle-orm";
import { spaceMembers, spaces, users } from "@app/db";
import { AppError, ErrorCode } from "@app/shared";
import { ALLOW_STREAM_TOKEN_KEY } from "./allow-stream-token.decorator";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { verifyStreamToken } from "./stream-token";
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
    let userId: string;
    let tokenSpaceId: string;
    let jti: string;
    if (header?.startsWith("Bearer ")) {
      const payload = this.tokens.verifyAccess(header.slice(7));
      await this.tokens.assertAccessActive(payload.jti);
      userId = payload.sub;
      tokenSpaceId = payload.sid;
      jti = payload.jti;
    } else {
      /**
       * SSE 通道：浏览器 `EventSource` 不能设置请求头，只能把凭据放查询参数。
       * 这里接受短时效 `stream_token`（ADR-012），其 audience 与 access token
       * 不同，两套令牌互不可用（见 common/stream-token.ts）。
       *
       * P1-9：只对显式标注 `@AllowStreamToken()` 的处理器开放。原来所有受保护路由
       * 都接受查询参数令牌，等于把"短时效、无 jti、无法吊销"的凭据变成通用后门。
       */
      const allowStreamToken = this.reflector.getAllAndOverride<boolean>(ALLOW_STREAM_TOKEN_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowStreamToken) throw new AppError(ErrorCode.UNAUTHORIZED, "missing bearer token");
      const query = request.query as Record<string, unknown> | undefined;
      const raw = query?.stream_token;
      const provided = typeof raw === "string" ? raw : Array.isArray(raw) ? String(raw[0]) : undefined;
      // 标注了但没带参数：保持同一文案，避免把"缺头"误报成"SSE 令牌问题"
      if (!provided) throw new AppError(ErrorCode.UNAUTHORIZED, "missing bearer token");
      const streamPayload = verifyStreamToken(provided);
      userId = streamPayload.sub;
      tokenSpaceId = streamPayload.sid;
      // stream token 没有 jti（不能用于普通请求），日志侧标记来源即可
      jti = "stream";
    }
    // 账号已注销/封禁 → token 立即失效
    const [user] = await db
      .select({ status: users.status, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, BigInt(userId)));
    if (!user || user.status !== 1 || user.deletedAt) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "account disabled");
    }

    // ── 空间切换（ADR-010：团队成员的所有请求都带团队 space_id）──
    // token 里的 sid 是登录时的个人空间；团队场景由 `X-Space-Id` 指定目标空间。
    // 安全性：必须校验请求者确实是该空间成员，否则 403——不能只信客户端头。
    let spaceId = tokenSpaceId;
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
        .where(and(eq(spaceMembers.spaceId, targetId), eq(spaceMembers.userId, BigInt(userId))));
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

    request.auth = { userId, spaceId, jti };
    return true;
  }
}
