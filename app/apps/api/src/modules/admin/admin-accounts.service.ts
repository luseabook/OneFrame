import { Injectable } from "@nestjs/common";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { adminUsers } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { hashAdminPassword, type AdminRole } from "./admin-auth.service";

/** 停用态：1 启用 / 2 停用（与 `admin_users.status` 同口径） */
export type AdminStatus = 1 | 2;

export interface AdminAccountDto {
  id: string;
  username: string;
  role: string;
  status: number;
  created_at: string;
  last_login_at: string | null;
}

function toDto(row: typeof adminUsers.$inferSelect): AdminAccountDto {
  return {
    id: String(row.id),
    username: row.username,
    role: row.role,
    status: row.status,
    created_at: row.createdAt.toISOString(),
    last_login_at: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
  };
}

function parseId(id: string): bigint {
  try {
    return BigInt(id);
  } catch {
    throw new AppError(ErrorCode.INVALID_PARAM, "invalid admin id", { field: "id" });
  }
}

/**
 * 管理员账号管理（契约 §3.3）——仅 `super` 可调，权限判断在控制器里做。
 *
 * 设计要点（为什么这样写）：
 * 1. **不做物理删除**：`admin_audit_logs.admin_id`、`content_reports.handled_by` 等多处外键
 *    都指向本表，删行会让历史留痕悬空；"停用"用 `status=2` 表达，既保留追溯又能立刻踢下线。
 * 2. **改密/启停时 `token_version++`**：JWT 无状态，不前进版本号的话旧 token 会一直有效到
 *    过期（默认 2 小时）。改角色**不需要**前进：`AdminGuard` 每次请求都从库里读角色，
 *    降权在下一个请求就生效（这也是为什么 guard 必须读库）。
 * 3. **最后一个 super 保护**：降级/停用最后一个启用的 super，等于把"管管理员"的能力永久锁死，
 *    只能手改数据库才能恢复。检查放在事务里 + `for update`，避免两个并发请求各停一个导致全灭。
 */
@Injectable()
export class AdminAccountsService {
  async list(): Promise<{ list: AdminAccountDto[] }> {
    const rows = await db
      .select()
      .from(adminUsers)
      .orderBy(asc(adminUsers.createdAt), asc(adminUsers.id));
    return { list: rows.map(toDto) };
  }

  /** 新建管理员：重名 → 400101（唯一索引兜底，先查再插是为了给出明确文案） */
  async create(input: { username: string; password: string; role: AdminRole }): Promise<AdminAccountDto> {
    const [existing] = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.username, input.username))
      .limit(1);
    if (existing) {
      throw new AppError(ErrorCode.INVALID_PARAM, "username already exists", { field: "username" });
    }
    const id = newId();
    let row: typeof adminUsers.$inferSelect | undefined;
    try {
      [row] = await db
        .insert(adminUsers)
        .values({
          id,
          username: input.username,
          passwordHash: hashAdminPassword(input.password),
          role: input.role,
          // 新建账号一定是启用态且密码刚设置：直接写上时间，避免"从没改过密码"的误报
          passwordUpdatedAt: new Date(),
        })
        .returning();
    } catch (err) {
      // 唯一索引 23505：上面查过一次，这里兜的是并发创建同名账号的竞态。
      // 其它错误（连接/约束不符）必须原样抛出，不能都伪装成"重名"。
      if ((err as { code?: string }).code === "23505") {
        throw new AppError(ErrorCode.INVALID_PARAM, "username already exists", { field: "username" });
      }
      throw err;
    }
    if (!row) {
      throw new AppError(ErrorCode.INVALID_PARAM, "username already exists", { field: "username" });
    }
    return toDto(row);
  }

  async update(
    actorAdminId: string,
    id: string,
    input: { role?: AdminRole; status?: AdminStatus; password?: string },
  ): Promise<AdminAccountDto> {
    const targetId = parseId(id);
    return db.transaction(async (tx) => {
      // 行锁：并发的两次"停用 super"必须串行，否则两边都会看到"还有另一个 super"
      const [row] = await tx.select().from(adminUsers).where(eq(adminUsers.id, targetId)).for("update");
      if (!row) throw new AppError(ErrorCode.NOT_FOUND, "admin not found");

      const nextRole = input.role ?? row.role;
      const nextStatus = input.status ?? row.status;
      const passwordChanged = input.password !== undefined;
      const statusChanged = nextStatus !== row.status;
      const roleChanged = nextRole !== row.role;
      if (!passwordChanged && !statusChanged && !roleChanged) {
        // 空补丁静默成功会让前端以为"保存了"，这里显式报错，排查更快
        throw new AppError(ErrorCode.INVALID_PARAM, "nothing to update");
      }

      // 停用自己 = 立刻把自己锁在门外（下一次请求 guard 就 401），只可能是误操作
      if (nextStatus !== 1 && String(row.id) === actorAdminId) {
        throw new AppError(ErrorCode.INVALID_PARAM, "cannot disable your own account");
      }

      // 最后一个启用的 super 不能被降级/停用（已在停用态的 super 不占"启用"名额，无需保护）
      const losingSuper = row.role === "super" && row.status === 1 && (nextRole !== "super" || nextStatus !== 1);
      if (losingSuper) {
        const [agg] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(adminUsers)
          .where(and(eq(adminUsers.role, "super"), eq(adminUsers.status, 1), ne(adminUsers.id, row.id)));
        if ((agg?.count ?? 0) === 0) {
          throw new AppError(ErrorCode.INVALID_PARAM, "cannot demote or disable the last super admin");
        }
      }

      const patch: Partial<typeof adminUsers.$inferInsert> = { role: nextRole, status: nextStatus, updatedAt: new Date() };
      if (passwordChanged) {
        patch.passwordHash = hashAdminPassword(input.password!);
        patch.passwordUpdatedAt = new Date();
      }
      // 改密或启停 → 全端强制重登；改角色不必（guard 每请求读库，权限立即生效）
      if (passwordChanged || statusChanged) {
        patch.tokenVersion = row.tokenVersion + 1;
      }

      const [updated] = await tx.update(adminUsers).set(patch).where(eq(adminUsers.id, row.id)).returning();
      if (!updated) throw new AppError(ErrorCode.NOT_FOUND, "admin not found");
      return toDto(updated);
    });
  }
}
