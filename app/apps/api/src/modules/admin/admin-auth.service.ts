import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { eq, sql } from "drizzle-orm";
import { adminUsers } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { env, resolveAdminJwtSecret } from "../../config/env";
import { RedisService } from "../../redis/redis.service";

/** 登录失败限流：同（用户名+IP）5 分钟内 10 次失败即 429 */
const ADMIN_LOGIN_MAX_FAILURES = 10;
const ADMIN_LOGIN_FAIL_TTL_S = 300;

/** 管理端角色（契约 §3.2）：super 管管理员+全量 / ops 运营写 / viewer 只读 */
export type AdminRole = "super" | "ops" | "viewer";
export const ADMIN_ROLES: readonly AdminRole[] = ["super", "ops", "viewer"] as const;

export interface AdminAuth {
  adminId: string;
  username: string;
  role: string;
  /**
   * token 里的令牌版本号。
   *
   * 为什么要把 `ver` 放进返回值而不是只留在 JWT 里：`AdminGuard` 必须能用同一个值跟
   * 库里的 `admin_users.token_version` 比对（改密/停用/降权后旧 token 立即失效），
   * 而这个比对发生在 guard 里、验签之后，所以验签结果必须把 `ver` 带出来。
   */
  ver: number;
}

export function hashAdminPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger("admin-auth");

  /**
   * 管理端 token 密钥（PR-05：与用户域分离）。
   *
   * 生产由启动守卫强制 `ADMIN_JWT_SECRET` 显式配置；非生产缺省回落到 `JWT_SECRET`。
   * 回落必须**可见**（onModuleInit 打 warn），否则本地开发很容易"以为已经拆了密钥"，
   * 而真正生效的隔离只是生产守卫那一层。
   */
  private readonly jwtSecret = resolveAdminJwtSecret(env);

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async onModuleInit(): Promise<void> {
    if (this.jwtSecret.fallback) {
      this.logger.warn(
        "ADMIN_JWT_SECRET 未配置：admin token 回落到 JWT_SECRET（仅限非生产；生产启动守卫会直接拒绝启动）",
      );
    }
    await this.bootstrap();
  }

  // 首次启动创建管理员：显式 env 优先；非生产允许默认 admin/admin12345（仅本地/CI）
  private async bootstrap(): Promise<void> {
    const username = env.ADMIN_USERNAME ?? (env.NODE_ENV === "production" ? undefined : "admin");
    const password = env.ADMIN_PASSWORD ?? (env.NODE_ENV === "production" ? undefined : "admin12345");
    if (!username || !password) return;
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(adminUsers);
    if ((countRow?.count ?? 0) > 0) return;
    await db
      .insert(adminUsers)
      .values({
        id: newId(),
        username,
        passwordHash: hashAdminPassword(password),
        // 首账号必须是 super：否则生产上没有人能创建/停用其他管理员，
        // 管理员 CRUD 端点（仅 super 可调）会永久锁死，只能靠手改库解锁。
        role: "super",
      })
      .onConflictDoNothing({ target: adminUsers.username });
  }

  async login(
    username: string,
    password: string,
    ip?: string,
  ): Promise<{ token: string; expires_in: number; role: string }> {
    /**
     * 登录失败限流（api-spec §13 的 admin 落地）。
     *
     * 为什么按「用户名+IP」而不是只按用户名：只按用户名会被攻击者用任意用户名
     * 打满计数，把真实管理员锁在门外（DoS）；只按 IP 又会被僵尸网络绕过。
     * 两个维度拼起来，既限制单点爆破，又不制造"别人能锁死我的账号"。
     *
     * 失败计数是旁路：Redis 抖动时退化为不限流，绝不因此拒绝正确密码的登录。
     */
    const failKey = `admin:login:fail:${username.trim().toLowerCase()}:${ip || "unknown"}`;
    let failures = 0;
    try {
      failures = Number(await this.redis.get(failKey)) || 0;
    } catch {
      failures = 0;
    }
    if (failures >= ADMIN_LOGIN_MAX_FAILURES) {
      throw new AppError(ErrorCode.RATE_LIMITED, "too many failed login attempts, try again later");
    }

    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.username, username));
    // 停用（status=2）与密码错误回同一句文案：不向调用方泄露"这个账号存在但被停用"。
    if (!admin || admin.status !== 1 || !verifyPassword(password, admin.passwordHash)) {
      try {
        await this.redis.incrWithTtl(failKey, ADMIN_LOGIN_FAIL_TTL_S);
      } catch {
        // 限流计数写失败不影响"登录失败"的判定
      }
      throw new AppError(ErrorCode.UNAUTHORIZED, "invalid username or password");
    }
    // 成功即清零：避免"输错几次后正确登录，计数仍挂在那里"
    try {
      await this.redis.del(failKey);
    } catch {
      // 忽略：清计数失败只会多保留一次失败窗口
    }
    const token = jwt.sign(
      {
        sub: String(admin.id),
        username: admin.username,
        role: admin.role,
        // 改密/停用会让库里的 token_version 前进，旧 token 的 ver 对不上即失效
        ver: admin.tokenVersion,
        typ: "admin",
      },
      // PR-05：admin token 用**独立密钥**签发，不与用户域 JWT_SECRET 共享
      this.jwtSecret.secret,
      { expiresIn: env.ADMIN_JWT_TTL_S, issuer: "oneframe-admin" },
    );    // 登录时间用于安全审计（"这个账号多久没登录/是否异地登录"）。
    // 失败不抛：写时间戳只是审计增强，不能因为写库抖动把已成功的登录打回去。
    try {
      await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, admin.id));
    } catch {
      // 忽略：last_login_at 缺失不影响鉴权
    }
    return { token, expires_in: env.ADMIN_JWT_TTL_S, role: admin.role };
  }

  verify(token: string): AdminAuth {
    try {
      const payload = jwt.verify(token, this.jwtSecret.secret, { issuer: "oneframe-admin" }) as {
        sub: string;
        username: string;
        role: string;
        ver?: number;
        typ?: string;
      };
      if (payload.typ !== "admin") throw new Error("not an admin token");
      // 老 token（本轮改造前签发）没有 ver：按 0 处理 → 与库里 (≥1) 必然不等，
      // 等价于"全部旧会话强制重登"。这是有意的：旧 token 无法反映角色/状态变更。
      const ver = typeof payload.ver === "number" ? payload.ver : 0;
      return { adminId: payload.sub, username: payload.username, role: payload.role, ver };
    } catch {
      throw new AppError(ErrorCode.UNAUTHORIZED, "admin auth required");
    }
  }
}
