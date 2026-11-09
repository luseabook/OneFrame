import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { adminUsers } from "@app/db";
import { AppError, ErrorCode } from "@app/shared";
import { db } from "../../db/database";
import { env } from "../../config/env";
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
    /**
     * 凭证来源（H-2）：Bearer 来自 API/脚本客户端；HttpOnly Cookie 来自运营后台浏览器。
     * Cookie 源额外做**同源校验**（写请求）——SameSite=Strict 已在现代浏览器挡住跨站表单，
     * 这一层防的是旧浏览器/代理改写，属于纵深防御，不影响 Bearer 客户端。
     */
    const cookieToken = (req.cookies as Record<string, string | undefined> | undefined)?.admin_token;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : cookieToken;
    if (!token) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "admin auth required");
    }
    if (!header?.startsWith("Bearer ") && !READ_ONLY_METHODS.has(req.method)) {
      // 开发环境经 Nuxt dev 代理时 Host 可能被改写成上游地址，同源校验会误杀；
      // 生产（nginx 显式 `proxy_set_header Host $host`）才强制。
      if (env.NODE_ENV === "production") assertSameOrigin(req);
    }
    let payload: AdminAuth;
    try {
      payload = this.auth.verify(token);
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

/**
 * Cookie 凭证的写请求同源校验。
 *
 * 为什么必须有：Cookie 会自动携带，若反代层把 API 暴露在另一个站点下，
 * 恶意页面就能借运营的浏览器发起写操作（CSRF）。Origin/Referer 二者取其一，
 * 均缺失（非浏览器客户端）时拒绝 Cookie 写请求——这类客户端请改用 Bearer。
 */
/**
 * 取一个 URL/Host 值的**主机名**（不含端口），失败返回 null。
 *
 * 为什么只比主机名、不比端口：
 * nginx 用 `proxy_set_header Host $host` 转发时，`$host` **不含端口**（这是刻意写的，
 * 用来让 `server_name` 精确匹配域名）。于是后台挂在非 80 端口（如 IP 直连 `:8080`）时，
 * 浏览器发的 `Origin: http://1.2.3.4:8080` 与上游看到的 `Host: 1.2.3.4` 永远不相等 ——
 * 结果是**所有写操作被自己的 CSRF 防线拦死**（读请求因为只校验 GET/HEAD 不受影响，
 * 症状极具迷惑性：页面能看、一点保存就 403101）。2026-11-07 验收实测踩到。
 *
 * 安全代价：同主机不同端口会被视作同源。跨站请求的 Origin 主机名与本机不同，仍被拒；
 * 真正把"攻击者可控制同主机另一端口"当威胁时，正确做法是 nginx 传 `$http_host`
 * 并在本函数里恢复端口比较 —— 但那是基础设施改动，不该由这段守卫替运维决定。
 */
function hostOnly(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  try {
    // 兼容三种入参：完整 URL（Origin/Referer）、`host:port`、裸 host
    return new URL(text.includes("://") ? text : `http://${text}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function assertSameOrigin(req: FastifyRequest): void {
  const source = req.headers.origin ?? req.headers.referer;
  if (!source) {
    throw new AppError(ErrorCode.FORBIDDEN, "cross-site admin request rejected");
  }
  const sourceHost = hostOnly(source);
  if (!sourceHost) {
    throw new AppError(ErrorCode.FORBIDDEN, "cross-site admin request rejected");
  }
  // 反代可能保留 Host 或注入 X-Forwarded-Host（CDN）；两者任一匹配即可
  const allowed = [req.headers.host, req.headers["x-forwarded-host"]]
    .flatMap((value) => (typeof value === "string" ? value.split(",") : []))
    .map((value) => hostOnly(value))
    .filter((value): value is string => Boolean(value));
  if (!allowed.includes(sourceHost)) {
    throw new AppError(ErrorCode.FORBIDDEN, "cross-site admin request rejected");
  }
}
