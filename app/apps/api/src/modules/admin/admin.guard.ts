import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { adminUsers } from "@app/db";
import { AppError, ErrorCode } from "@app/shared";
import { db } from "../../db/database";
import { AdminAuthService, type AdminAuth } from "./admin-auth.service";

/**
 * 管理端独立鉴权（`/v1/ops/*`，与用户域 `AuthGuard` 物理隔离）。
 *
 * 为什么改成 async 读库：改造前只验签，于是**改密/停用/降权都不生效**——token 在
 * 有效期内（默认 2 小时）一直是"当时那个权限"。运营后台恰恰是权限最敏感的面，
 * 停用一个离职运营却还要等两小时，是不可接受的。现在每次请求都按 `sub` 回库校验：
 * 1) 账号仍存在；2) `status=1`（未停用）；3) `token_version` 与 token 里的 `ver` 一致。
 * 任何一条不满足 → 401101，让前端回登录页重新认证。
 *
 * 错误码语义（`test/admin.spec.ts` 依赖，不要改）：
 * - **没带凭证** → 401101「admin auth required」；
 * - **带了凭证但不是管理员**（普通用户 token / 过期 token）→ 403101「admin only」；
 * - 凭证本身有效但账号已失效（停用/改密/被降权）→ 401101（重登能解决，属认证态问题）。
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(AdminAuthService) private readonly auth: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest & { adminAuth?: AdminAuth }>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "admin auth required");
    }
    let payload: AdminAuth;
    try {
      payload = this.auth.verify(header.slice(7));
    } catch {
      // 已携带凭证但不是管理员（普通用户 token）→ 403；无凭证仍 401
      throw new AppError(ErrorCode.FORBIDDEN, "admin only");
    }

    // sub 是我们自己签的雪花 id 字符串；仍防御性解析：非法值应该 401 而不是 500
    let adminId: bigint;
    try {
      adminId = BigInt(payload.adminId);
    } catch {
      throw new AppError(ErrorCode.UNAUTHORIZED, "admin auth required");
    }

    const [row] = await db
      .select({
        username: adminUsers.username,
        role: adminUsers.role,
        status: adminUsers.status,
        tokenVersion: adminUsers.tokenVersion,
      })
      .from(adminUsers)
      .where(eq(adminUsers.id, adminId));

    // 账号被删/停用/改密/降权后旧 token 一律失效：统一 401101，前端重登即可拿到新态
    if (!row || row.status !== 1 || row.tokenVersion !== payload.ver) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "admin account disabled or credentials changed");
    }

    /**
     * viewer 只读：读请求（GET/HEAD/OPTIONS）放行，其余 403101。
     * 为什么不只看 GET：HEAD/OPTIONS 也是预检/探测语义，没有副作用；把它们当写请求
     * 会让浏览器跨域预检或监控探活直接失败，反而掩盖真正的越权尝试。
     */
    if (row.role === "viewer" && !READ_ONLY_METHODS.has(req.method)) {
      throw new AppError(ErrorCode.FORBIDDEN, "viewer role is read-only");
    }

    // 以**库里的**用户名/角色为准（管理员可能刚被改名或降权），token 里的值只作弱参考
    req.adminAuth = {
      adminId: payload.adminId,
      username: row.username,
      role: row.role,
      ver: row.tokenVersion,
    };
    return true;
  }
}

/** 无副作用的 HTTP 方法（viewer 可执行） */
const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
