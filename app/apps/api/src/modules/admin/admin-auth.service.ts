import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { eq, sql } from "drizzle-orm";
import { adminUsers } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { env } from "../../config/env";

export interface AdminAuth {
  adminId: string;
  username: string;
  role: string;
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
  async onModuleInit(): Promise<void> {
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
      .values({ id: newId(), username, passwordHash: hashAdminPassword(password), role: "ops" })
      .onConflictDoNothing({ target: adminUsers.username });
  }

  async login(username: string, password: string): Promise<{ token: string; expires_in: number; role: string }> {
    const [admin] = await db.select().from(adminUsers).where(eq(adminUsers.username, username));
    if (!admin || !verifyPassword(password, admin.passwordHash)) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "invalid username or password");
    }
    const token = jwt.sign({ sub: String(admin.id), username: admin.username, role: admin.role, typ: "admin" }, env.JWT_SECRET, {
      expiresIn: env.ADMIN_JWT_TTL_S,
      issuer: "oneframe-admin",
    });
    return { token, expires_in: env.ADMIN_JWT_TTL_S, role: admin.role };
  }

  verify(token: string): AdminAuth {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET, { issuer: "oneframe-admin" }) as {
        sub: string;
        username: string;
        role: string;
        typ?: string;
      };
      if (payload.typ !== "admin") throw new Error("not an admin token");
      return { adminId: payload.sub, username: payload.username, role: payload.role };
    } catch {
      throw new AppError(ErrorCode.UNAUTHORIZED, "admin auth required");
    }
  }
}
