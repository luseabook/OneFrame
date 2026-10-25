import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  creditAccounts,
  creditFlows,
  identities,
  spaceMembers,
  spaces,
  teamGroups,
  teamMemberProjects,
  teamRoles,
} from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { hashPhone } from "../auth/crypto";

/**
 * 团队（cam）域服务 —— F1 契约 §12.3 / ADR-010 / ADR-011
 *
 * 三条不可回退的约束：
 * 1. 团队 = `spaces(type=2)`，不另建 teams 表；RE 的 team_id 映射为 space_id。
 * 2. 团队积分池 = 该 team-space 的 `credit_accounts`，**不另建账本**；
 *    分配/回收必须**成对**写 `credit_flows`，否则 `balance == Σdelta` 立刻破。
 * 3. `role_level` 不是单调特权轴：特权用**码集**判，禁止 `role_level <= N`（见 §12.3.1）。
 */

/** 内置角色（RE 实测 11 级；level 仅展示/排序，不作特权判据） */
export const BUILTIN_ROLES = [
  { code: "master", name: "团队主账号", level: 1 },
  { code: "admin", name: "管理员", level: 2 },
  { code: "group_admin", name: "组管理员", level: 3 },
  { code: "director", name: "导演", level: 4 },
  { code: "screenwriter", name: "编剧", level: 5 },
  { code: "animator", name: "动画师", level: 6 },
  { code: "editor", name: "剪辑师", level: 7 },
  { code: "designer", name: "美术", level: 8 },
  { code: "project_executor", name: "项目执行", level: 9 },
  { code: "film_producer", name: "影视制片", level: 10 },
  { code: "film_maker", name: "影视制作", level: 11 },
] as const;

/**
 * 特权码集（**唯一**的权限判据）。
 * 注意 level 11(film_maker) 的特权高于 level 4(导演)——任何 `role_level <= N` 都会判错。
 */
const PRIVILEGED_CODES = new Set([
  "master",
  "admin",
  "group_admin",
  "producer",
  "maker",
  "film_producer",
  "film_maker",
]);

export type TeamRole = "master" | "admin" | "group_admin" | "member";

export interface TeamContext {
  spaceId: string;
  userId: string;
  /** space_members.role（1 owner / 2 admin / 3 member）——空间归属 */
  role: number;
  /** 业务岗位码（可为空，空则按 role 兜底） */
  roleCode: string | null;
}

@Injectable()
export class TeamService {
  /** 解析并校验"当前用户在该 space 的团队身份"；非成员→403 */
  async requireMember(spaceId: string, userId: string): Promise<TeamContext> {
    const [row] = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, BigInt(userId))));
    if (!row) {
      throw new AppError(ErrorCode.FORBIDDEN, "not a member of this space", { reason: "not_member" });
    }
    if (row.status !== 1) {
      throw new AppError(ErrorCode.FORBIDDEN, "membership disabled", { reason: "not_member" });
    }
    return {
      spaceId,
      userId,
      role: row.role,
      roleCode: row.roleCode ?? null,
    };
  }

  /**
   * 是否具备团队管理特权。
   * owner(role=1) 直接等价 master；其余一律看 role_code 是否落在特权码集。
   */
  static hasPrivilege(ctx: TeamContext): boolean {
    if (ctx.role === 1) return true;
    if (ctx.role === 2) return true; // MVP 期的 admin 保持等价（历史数据）
    return ctx.roleCode ? PRIVILEGED_CODES.has(ctx.roleCode) : false;
  }

  requirePrivilege(ctx: TeamContext, action: string): void {
    if (!TeamService.hasPrivilege(ctx)) {
      throw new AppError(ErrorCode.FORBIDDEN, `role insufficient for ${action}`, {
        reason: "role_insufficient",
      });
    }
  }

  /**
   * 创建团队空间（对齐参照「去开通」这一步）。
   * 团队不是新表：建的是 `spaces(type=2)` + 积分账户 + owner 成员 + 内置角色（ADR-010）。
   * 同一用户可拥有多个团队；`X-Space-Id` 决定"当前在哪个团队里操作"。
   */
  async createTeam(ownerUserId: string, input: { name: string; max_seats?: number }) {
    const name = input.name.trim();
    if (!name) throw new AppError(ErrorCode.INVALID_PARAM, "team name required", { field: "name" });
    return db.transaction(async (tx) => {
      const spaceId = newId();
      await tx.insert(spaces).values({
        id: spaceId,
        ownerUserId: BigInt(ownerUserId),
        type: 2,
        name,
        maxSeats: input.max_seats ?? 5,
        status: 1,
      });
      await tx.insert(creditAccounts).values({
        spaceId,
        balance: 0,
        frozen: 0,
        updatedAt: new Date(),
      });
      await tx.insert(spaceMembers).values({
        spaceId,
        userId: BigInt(ownerUserId),
        role: 1, // owner
        roleCode: "master",
        roleLevel: 1,
        status: 1,
        nickname: null,
        joinedAt: new Date(),
      });
      await tx
        .insert(teamRoles)
        .values(
          BUILTIN_ROLES.map((r) => ({
            id: newId(),
            spaceId,
            roleCode: r.code,
            roleName: r.name,
            roleLevel: r.level,
            isSystem: true,
          })),
        )
        .onConflictDoNothing();
      return { space_id: String(spaceId), name, max_seats: input.max_seats ?? 5 };
    });
  }

  /** 当前用户所属的全部团队（用于前端空间切换） */
  async myTeams(userId: string) {
    const rows = await db
      .select({
        spaceId: spaceMembers.spaceId,
        role: spaceMembers.role,
        roleCode: spaceMembers.roleCode,
        name: spaces.name,
        type: spaces.type,
        status: spaces.status,
        maxSeats: spaces.maxSeats,
      })
      .from(spaceMembers)
      .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
      .where(and(eq(spaceMembers.userId, BigInt(userId)), eq(spaceMembers.status, 1)));
    return {
      list: rows.map((r) => ({
        space_id: String(r.spaceId),
        name: r.name,
        type: r.type,
        status: r.status,
        max_seats: r.maxSeats,
        role: r.role,
        role_code: r.roleCode,
      })),
    };
  }

  /**
   * 批量添加成员（对齐参照 cam/team/member/batch）。
   *
   * 设计取舍（重要）：**只允许加入已注册用户**，不接受"代建账号"。
   * 理由：① 代建账号需要手机号验证码归属证明，否则任何人可把他人手机号拉进团队；
   * ② 参照产品的成员体系有独立账号+密码（member/credential），我方是手机号登录，
   * 语义不同——强行对齐会引入账号接管风险。未注册手机号返回 400101 并说明原因。
   */
  async addMembers(
    spaceId: string,
    opUserId: string,
    input: { members: Array<{ phone?: string; user_id?: string; role_code?: string; group_id?: string; nickname?: string }> },
  ) {
    if (!Array.isArray(input.members) || input.members.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "members required", { field: "members" });
    }
    if (input.members.length > 50) {
      throw new AppError(ErrorCode.INVALID_PARAM, "at most 50 members per batch", { field: "members" });
    }

    const results: Array<{ phone?: string; user_id?: string; ok: boolean; code?: number; reason?: string }> = [];
    let added = 0;

    for (const item of input.members) {
      const phone = item.phone?.trim();
      const rawUserId = item.user_id?.trim();
      let targetUserId: bigint | null = null;

      if (rawUserId) {
        targetUserId = BigInt(rawUserId);
      } else if (phone) {
        if (!/^1\d{10}$/.test(phone)) {
          results.push({ phone, ok: false, code: ErrorCode.INVALID_PARAM, reason: "invalid phone" });
          continue;
        }
        const [identity] = await db
          .select({ userId: identities.userId })
          .from(identities)
          .where(and(eq(identities.provider, "phone"), eq(identities.phoneHash, hashPhone(phone))));
        if (!identity) {
          results.push({ phone, ok: false, code: ErrorCode.INVALID_PARAM, reason: "phone not registered" });
          continue;
        }
        targetUserId = identity.userId;
      } else {
        results.push({ ok: false, code: ErrorCode.INVALID_PARAM, reason: "phone or user_id required" });
        continue;
      }

      const [exists] = await db
        .select({ status: spaceMembers.status })
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, targetUserId)));
      if (exists) {
        results.push({ phone, user_id: String(targetUserId), ok: false, code: ErrorCode.INVALID_PARAM, reason: "already a member" });
        continue;
      }

      // 逐个校验席位：批量里超出的部分逐条拒绝，而不是整批失败
      try {
        await this.assertSeatAvailable(spaceId);
      } catch (e) {
        const err = e as AppError;
        results.push({ phone, user_id: String(targetUserId), ok: false, code: err.code, reason: "seat limit reached" });
        continue;
      }

      const roleCode = item.role_code ?? "project_executor";
      const [role] = await db
        .select({ roleLevel: teamRoles.roleLevel })
        .from(teamRoles)
        .where(and(eq(teamRoles.spaceId, BigInt(spaceId)), eq(teamRoles.roleCode, roleCode)));

      await db.insert(spaceMembers).values({
        spaceId: BigInt(spaceId),
        userId: targetUserId,
        role: 3, // 空间归属 member；岗位由 role_code 表达
        roleCode,
        roleLevel: role?.roleLevel ?? null,
        groupId: item.group_id ? BigInt(item.group_id) : null,
        nickname: item.nickname ?? null,
        status: 1,
        invitedAt: new Date(),
        joinedAt: new Date(),
      });
      void opUserId;
      added += 1;
      results.push({ phone, user_id: String(targetUserId), ok: true });
    }

    return { added, failed: results.filter((r) => !r.ok).length, items: results };
  }

  /** 批量改状态（启用/停用/待激活）；禁止批量停用 owner */
  async batchMemberStatus(spaceId: string, input: { user_ids: string[]; status: number }) {
    if (!Array.isArray(input.user_ids) || input.user_ids.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "user_ids required", { field: "user_ids" });
    }
    if (input.user_ids.length > 200) {
      throw new AppError(ErrorCode.INVALID_PARAM, "at most 200 per batch", { field: "user_ids" });
    }
    const owners = await db
      .select({ userId: spaceMembers.userId })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.role, 1)));
    const ownerIds = new Set(owners.map((o) => String(o.userId)));
    const blocked = input.user_ids.filter((id) => ownerIds.has(String(id)));
    if (blocked.length > 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "cannot change owner status", { field: "user_ids", blocked });
    }
    await db
      .update(spaceMembers)
      .set({ status: input.status, updatedAt: new Date() })
      .where(
        and(
          eq(spaceMembers.spaceId, BigInt(spaceId)),
          inArray(spaceMembers.userId, input.user_ids.map((id) => BigInt(id))),
        ),
      );
    return { updated: input.user_ids.length };
  }

  /** 批量换组（group_id 传 null 表示移出分组） */
  async changeGroup(spaceId: string, input: { user_ids: string[]; group_id: string | null }) {
    if (!Array.isArray(input.user_ids) || input.user_ids.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "user_ids required", { field: "user_ids" });
    }
    if (input.group_id) {
      const [group] = await db.select().from(teamGroups).where(eq(teamGroups.id, BigInt(input.group_id)));
      if (!group || String(group.spaceId) !== spaceId) {
        throw new AppError(ErrorCode.INVALID_PARAM, "group not in this team", { field: "group_id" });
      }
    }
    await db
      .update(spaceMembers)
      .set({ groupId: input.group_id ? BigInt(input.group_id) : null, updatedAt: new Date() })
      .where(
        and(
          eq(spaceMembers.spaceId, BigInt(spaceId)),
          inArray(spaceMembers.userId, input.user_ids.map((id) => BigInt(id))),
        ),
      );
    return { updated: input.user_ids.length };
  }

  /** 成员 CSV 导出（对齐参照 member/export） */
  async membersCsv(spaceId: string): Promise<string> {
    const data = await this.listMembers(spaceId, 1, 100, undefined, undefined, undefined);
    const rows = data.list as Array<Record<string, unknown>>;
    const header = ["user_id", "nickname", "account", "role_code", "group_id", "credits_quota", "status", "remark"];
    const esc = (v: unknown): string => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(header.map((h) => esc(r[h])).join(","));
    }
    // BOM：让 Excel 正确识别 UTF-8 中文
    return `\uFEFF${lines.join("\n")}`;
  }

  /** 团队信息（含席位/统计） */
  async info(spaceId: string) {
    const [space] = await db.select().from(spaces).where(eq(spaces.id, BigInt(spaceId)));
    if (!space) throw new AppError(ErrorCode.NOT_FOUND, "space not found");
    const [counts] = await db
      .select({
        members: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where status = 1)::int`,
      })
      .from(spaceMembers)
      .where(eq(spaceMembers.spaceId, BigInt(spaceId)));
    const [account] = await db
      .select()
      .from(creditAccounts)
      .where(eq(creditAccounts.spaceId, BigInt(spaceId)));
    return {
      space_id: spaceId,
      name: space.name,
      type: space.type,
      status: space.status,
      max_seats: space.maxSeats,
      used_seats: counts?.active ?? 0,
      // 团队积分池就是该 space 的余额（ADR-011：不另存 team_credit_total）
      credit_total: account?.balance ?? 0,
      frozen: account?.frozen ?? 0,
      film_enabled: space.filmEnabled === 1,
      agent_whitelist: space.agentWhitelist === 1,
    };
  }

  // ── 分组 ────────────────────────────────────────────────
  async listGroups(spaceId: string) {
    const rows = await db
      .select()
      .from(teamGroups)
      .where(eq(teamGroups.spaceId, BigInt(spaceId)))
      .orderBy(teamGroups.parentId, teamGroups.sort);
    return {
      list: rows.map((r) => ({
        id: String(r.id),
        parent_id: r.parentId ? String(r.parentId) : null,
        name: r.name,
        leader_user_id: r.leaderUserId ? String(r.leaderUserId) : null,
        sort: r.sort,
        status: r.status,
      })),
    };
  }

  async createGroup(
    spaceId: string,
    input: { name: string; parent_id?: string; leader_user_id?: string; sort?: number },
  ) {
    let parentId: bigint | null = null;
    if (input.parent_id) {
      const [parent] = await db.select().from(teamGroups).where(eq(teamGroups.id, BigInt(input.parent_id)));
      // 禁跨 space 的 parent（§12.3.2）
      if (!parent || String(parent.spaceId) !== spaceId) {
        throw new AppError(ErrorCode.INVALID_PARAM, "parent group not in this team", { field: "parent_id" });
      }
      parentId = parent.id;
    }
    const id = newId();
    await db.insert(teamGroups).values({
      id,
      spaceId: BigInt(spaceId),
      parentId,
      name: input.name,
      leaderUserId: input.leader_user_id ? BigInt(input.leader_user_id) : null,
      sort: input.sort ?? 0,
    });
    return { id: String(id) };
  }

  async updateGroup(spaceId: string, groupId: string, input: { name?: string; leader_user_id?: string | null; sort?: number; status?: number }) {
    const [group] = await db.select().from(teamGroups).where(eq(teamGroups.id, BigInt(groupId)));
    if (!group || String(group.spaceId) !== spaceId) throw new AppError(ErrorCode.NOT_FOUND, "group not found");
    await db
      .update(teamGroups)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.leader_user_id !== undefined
          ? { leaderUserId: input.leader_user_id ? BigInt(input.leader_user_id) : null }
          : {}),
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(eq(teamGroups.id, group.id));
    return { ok: true };
  }

  async deleteGroup(spaceId: string, groupId: string) {
    const [group] = await db.select().from(teamGroups).where(eq(teamGroups.id, BigInt(groupId)));
    if (!group || String(group.spaceId) !== spaceId) throw new AppError(ErrorCode.NOT_FOUND, "group not found");
    // 有子组或成员时拒绝（避免悬挂引用）
    const [child] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(teamGroups)
      .where(and(eq(teamGroups.spaceId, BigInt(spaceId)), eq(teamGroups.parentId, group.id)));
    if ((child?.n ?? 0) > 0) throw new AppError(ErrorCode.INVALID_PARAM, "group has children", { field: "group_id" });
    const [m] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.groupId, group.id)));
    if ((m?.n ?? 0) > 0) throw new AppError(ErrorCode.INVALID_PARAM, "group has members", { field: "group_id" });
    await db.delete(teamGroups).where(eq(teamGroups.id, group.id));
    return { ok: true };
  }

  // ── 角色 ────────────────────────────────────────────────
  async listRoles(spaceId: string) {
    const rows = await db.select().from(teamRoles).where(eq(teamRoles.spaceId, BigInt(spaceId)));
    if (rows.length === 0) {
      // 首次访问：按内置 11 级初始化（幂等）
      await db
        .insert(teamRoles)
        .values(
          BUILTIN_ROLES.map((r) => ({
            id: newId(),
            spaceId: BigInt(spaceId),
            roleCode: r.code,
            roleName: r.name,
            roleLevel: r.level,
            isSystem: true,
          })),
        )
        .onConflictDoNothing();
      const again = await db.select().from(teamRoles).where(eq(teamRoles.spaceId, BigInt(spaceId)));
      return { list: again.map(this.toRoleDto) };
    }
    return { list: rows.map(this.toRoleDto) };
  }

  private toRoleDto = (r: typeof teamRoles.$inferSelect) => ({
    id: String(r.id),
    role_code: r.roleCode,
    role_name: r.roleName,
    role_level: r.roleLevel,
    is_system: r.isSystem,
    description: r.description,
    power_list: r.powerList,
    status: r.status,
  });

  // ── 成员 ────────────────────────────────────────────────
  async listMembers(spaceId: string, page = 1, pageSize = 20, groupId?: string, roleCode?: string, status?: number) {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(1, pageSize));
    const cond = [eq(spaceMembers.spaceId, BigInt(spaceId))];
    if (groupId) cond.push(eq(spaceMembers.groupId, BigInt(groupId)));
    if (roleCode) cond.push(eq(spaceMembers.roleCode, roleCode));
    if (status !== undefined) cond.push(eq(spaceMembers.status, status));
    const where = and(...cond);
    const rows = await db
      .select()
      .from(spaceMembers)
      .where(where)
      .orderBy(desc(spaceMembers.createdAt))
      .limit(ps)
      .offset((p - 1) * ps);
    const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(spaceMembers).where(where);
    return {
      list: rows.map((r) => ({
        user_id: String(r.userId),
        role: r.role,
        role_code: r.roleCode,
        role_level: r.roleLevel,
        group_id: r.groupId ? String(r.groupId) : null,
        nickname: r.nickname,
        account: r.account,
        remark: r.remark,
        status: r.status,
        // 未回收的已分配额上限（**不是余额**，§12.3.1）
        credits_quota: r.creditsQuota,
        joined_at: r.joinedAt?.toISOString() ?? null,
      })),
      total: cnt?.n ?? 0,
      page: p,
      page_size: ps,
    };
  }

  async updateMember(
    spaceId: string,
    userId: string,
    input: { role_code?: string; role_id?: string; group_id?: string | null; nickname?: string; remark?: string; status?: number },
  ) {
    const [row] = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, BigInt(userId))));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "member not found");

    let roleLevel = row.roleLevel;
    if (input.role_code) {
      const [role] = await db
        .select()
        .from(teamRoles)
        .where(and(eq(teamRoles.spaceId, BigInt(spaceId)), eq(teamRoles.roleCode, input.role_code)));
      if (!role) throw new AppError(ErrorCode.INVALID_PARAM, "unknown role_code", { field: "role_code" });
      roleLevel = role.roleLevel;
    }
    // 禁把最后一名 owner 降级（否则团队失去主控）
    if (input.status === 2 && row.role === 1) {
      throw new AppError(ErrorCode.INVALID_PARAM, "cannot disable team owner", { field: "status" });
    }
    await db
      .update(spaceMembers)
      .set({
        ...(input.role_code !== undefined ? { roleCode: input.role_code } : {}),
        ...(input.role_id !== undefined ? { roleId: input.role_id ? BigInt(input.role_id) : null } : {}),
        ...(roleLevel !== null ? { roleLevel } : {}),
        ...(input.group_id !== undefined ? { groupId: input.group_id ? BigInt(input.group_id) : null } : {}),
        ...(input.nickname !== undefined ? { nickname: input.nickname } : {}),
        ...(input.remark !== undefined ? { remark: input.remark } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, BigInt(userId))));
    return { ok: true };
  }

  async removeMember(spaceId: string, userId: string) {
    const [row] = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, BigInt(userId))));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "member not found");
    if (row.role === 1) throw new AppError(ErrorCode.INVALID_PARAM, "cannot remove team owner", { field: "user_id" });
    await db
      .delete(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, BigInt(userId))));
    return { ok: true };
  }

  /** 席位校验：邀请/绑定成员前调用（400108） */
  async assertSeatAvailable(spaceId: string): Promise<void> {
    const [space] = await db.select().from(spaces).where(eq(spaces.id, BigInt(spaceId)));
    if (!space) throw new AppError(ErrorCode.NOT_FOUND, "space not found");
    const [cnt] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.status, 1)));
    if ((cnt?.n ?? 0) >= space.maxSeats) {
      throw new AppError(ErrorCode.TEAM_SEAT_EXCEEDED, "team seat limit reached", { limit: space.maxSeats });
    }
  }

  // ── 团队积分：分配 / 回收（成对记账，ADR-011）──────────────
  /**
   * 分配：团队 space → 成员个人 space。
   * 必须在一个事务里同时写两条流水，否则 Σdelta 会漂。
   */
  async allocate(
    spaceId: string,
    opUserId: string,
    input: { user_id: string; amount: number; group_id?: string; memo?: string },
  ) {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "amount must be a positive integer", { field: "amount" });
    }
    const [member] = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, BigInt(input.user_id))));
    if (!member) throw new AppError(ErrorCode.INVALID_PARAM, "member not in this team", { field: "user_id" });

    // 成员个人 space（团队外的那一个）
    const [personal] = await db
      .select()
      .from(spaces)
      .where(and(eq(spaces.ownerUserId, BigInt(input.user_id)), eq(spaces.type, 1)));
    if (!personal) throw new AppError(ErrorCode.INVALID_PARAM, "member has no personal space", { field: "user_id" });

    return db.transaction(async (tx) => {
      // 锁团队账户（余额校验）
      const [teamAcc] = await tx
        .select()
        .from(creditAccounts)
        .where(eq(creditAccounts.spaceId, BigInt(spaceId)))
        .for("update");
      if (!teamAcc) throw new AppError(ErrorCode.NOT_FOUND, "team credit account missing");
      if (teamAcc.balance < input.amount) {
        throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, "Insufficient Balance");
      }
      const teamAfter = teamAcc.balance - input.amount;
      await tx
        .update(creditAccounts)
        .set({ balance: teamAfter, updatedAt: new Date() })
        .where(eq(creditAccounts.spaceId, BigInt(spaceId)));

      // 锁成员个人账户
      const [memAcc] = await tx
        .select()
        .from(creditAccounts)
        .where(eq(creditAccounts.spaceId, personal.id))
        .for("update");
      if (!memAcc) throw new AppError(ErrorCode.NOT_FOUND, "member credit account missing");
      const memAfter = memAcc.balance + input.amount;
      await tx
        .update(creditAccounts)
        .set({ balance: memAfter, updatedAt: new Date() })
        .where(eq(creditAccounts.spaceId, personal.id));

      const groupId = input.group_id ? BigInt(input.group_id) : member.groupId ?? null;
      const base = {
        refSpaceId: personal.id,
        refUserId: BigInt(input.user_id),
        opUserId: BigInt(opUserId),
        groupId,
        memo: input.memo ?? `团队分配 ${input.amount}`,
      };
      // 成对：团队出账（负）
      await tx.insert(creditFlows).values({
        id: newId(),
        spaceId: BigInt(spaceId),
        delta: -input.amount,
        frozenDelta: 0,
        kind: "team_allocate_out",
        balanceAfter: teamAfter,
        ...base,
      });
      // 成对：成员入账（正）
      await tx.insert(creditFlows).values({
        id: newId(),
        spaceId: personal.id,
        delta: input.amount,
        frozenDelta: 0,
        kind: "team_allocate_in",
        balanceAfter: memAfter,
        refSpaceId: BigInt(spaceId),
        refUserId: BigInt(input.user_id),
        opUserId: BigInt(opUserId),
        groupId,
        memo: input.memo ?? `团队分配 ${input.amount}`,
      });

      // 已分配额上限（credits_quota）随分配增长——它不是余额，仅作额度上限记录
      await tx
        .update(spaceMembers)
        .set({ creditsQuota: member.creditsQuota + input.amount, updatedAt: new Date() })
        .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, BigInt(input.user_id))));

      return { team_balance: teamAfter, member_balance: memAfter, amount: input.amount };
    });
  }

  /** 回收：成员个人 space → 团队 space（allocate 的严格反向，成对记账） */
  async recover(
    spaceId: string,
    opUserId: string,
    input: { user_id: string; amount: number; memo?: string },
  ) {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "amount must be a positive integer", { field: "amount" });
    }
    const [member] = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, BigInt(input.user_id))));
    if (!member) throw new AppError(ErrorCode.INVALID_PARAM, "member not in this team", { field: "user_id" });
    const [personal] = await db
      .select()
      .from(spaces)
      .where(and(eq(spaces.ownerUserId, BigInt(input.user_id)), eq(spaces.type, 1)));
    if (!personal) throw new AppError(ErrorCode.INVALID_PARAM, "member has no personal space", { field: "user_id" });

    return db.transaction(async (tx) => {
      const [memAcc] = await tx
        .select()
        .from(creditAccounts)
        .where(eq(creditAccounts.spaceId, personal.id))
        .for("update");
      if (!memAcc) throw new AppError(ErrorCode.NOT_FOUND, "member credit account missing");
      if (memAcc.balance < input.amount) {
        throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, "member balance insufficient for recovery");
      }
      const memAfter = memAcc.balance - input.amount;
      await tx
        .update(creditAccounts)
        .set({ balance: memAfter, updatedAt: new Date() })
        .where(eq(creditAccounts.spaceId, personal.id));

      const [teamAcc] = await tx
        .select()
        .from(creditAccounts)
        .where(eq(creditAccounts.spaceId, BigInt(spaceId)))
        .for("update");
      if (!teamAcc) throw new AppError(ErrorCode.NOT_FOUND, "team credit account missing");
      const teamAfter = teamAcc.balance + input.amount;
      await tx
        .update(creditAccounts)
        .set({ balance: teamAfter, updatedAt: new Date() })
        .where(eq(creditAccounts.spaceId, BigInt(spaceId)));

      const groupId = member.groupId ?? null;
      await tx.insert(creditFlows).values({
        id: newId(),
        spaceId: personal.id,
        delta: -input.amount,
        frozenDelta: 0,
        kind: "team_recover_out",
        balanceAfter: memAfter,
        refSpaceId: BigInt(spaceId),
        refUserId: BigInt(input.user_id),
        opUserId: BigInt(opUserId),
        groupId,
        memo: input.memo ?? `团队回收 ${input.amount}`,
      });
      await tx.insert(creditFlows).values({
        id: newId(),
        spaceId: BigInt(spaceId),
        delta: input.amount,
        frozenDelta: 0,
        kind: "team_recover_in",
        balanceAfter: teamAfter,
        refSpaceId: personal.id,
        refUserId: BigInt(input.user_id),
        opUserId: BigInt(opUserId),
        groupId,
        memo: input.memo ?? `团队回收 ${input.amount}`,
      });

      const newQuota = Math.max(0, member.creditsQuota - input.amount);
      await tx
        .update(spaceMembers)
        .set({ creditsQuota: newQuota, updatedAt: new Date() })
        .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, BigInt(input.user_id))));

      return { team_balance: teamAfter, member_balance: memAfter, amount: input.amount };
    });
  }

  /** 团队积分流水（含 8 个筛选维度，对应参照 points-flow/list） */
  async listPointsFlows(
    spaceId: string,
    opts: { page?: number; page_size?: number; kind?: string; target_user_id?: string; group_id?: string; op_user_id?: string } = {},
  ) {
    const p = Math.max(1, opts.page ?? 1);
    const ps = Math.min(100, Math.max(1, opts.page_size ?? 20));
    // 只看团队相关流水（团队出/入 + 属于本 team 的分配记录）
    const cond = [
      eq(creditFlows.spaceId, BigInt(spaceId)),
      sql`${creditFlows.kind} in ('team_allocate_out','team_allocate_in','team_recover_out','team_recover_in')`,
    ];
    if (opts.kind) cond.push(eq(creditFlows.kind, opts.kind));
    if (opts.target_user_id) cond.push(eq(creditFlows.refUserId, BigInt(opts.target_user_id)));
    if (opts.group_id) cond.push(eq(creditFlows.groupId, BigInt(opts.group_id)));
    if (opts.op_user_id) cond.push(eq(creditFlows.opUserId, BigInt(opts.op_user_id)));
    const where = and(...cond);
    const rows = await db
      .select()
      .from(creditFlows)
      .where(where)
      .orderBy(desc(creditFlows.createdAt))
      .limit(ps)
      .offset((p - 1) * ps);
    const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(creditFlows).where(where);
    return {
      list: rows.map((r) => ({
        id: String(r.id),
        kind: r.kind,
        delta: r.delta,
        balance_after: r.balanceAfter,
        target_user_id: r.refUserId ? String(r.refUserId) : null,
        from_space_id: String(r.spaceId),
        to_space_id: r.refSpaceId ? String(r.refSpaceId) : null,
        op_user_id: r.opUserId ? String(r.opUserId) : null,
        group_id: r.groupId ? String(r.groupId) : null,
        memo: r.memo,
        created_at: r.createdAt.toISOString(),
      })),
      total: cnt?.n ?? 0,
      page: p,
      page_size: ps,
    };
  }

  /** 成员积分排行（对应 cam/team/account-points-ranking） */
  async pointsRanking(spaceId: string, limit = 20) {
    const rows = await db
      .select({
        userId: spaceMembers.userId,
        nickname: spaceMembers.nickname,
        quota: spaceMembers.creditsQuota,
      })
      .from(spaceMembers)
      .where(eq(spaceMembers.spaceId, BigInt(spaceId)))
      .orderBy(desc(spaceMembers.creditsQuota))
      .limit(Math.min(100, Math.max(1, limit)));
    return { list: rows.map((r) => ({ user_id: String(r.userId), nickname: r.nickname, credits: r.quota })) };
  }

  // ── 成员↔项目 ───────────────────────────────────────────
  async listMemberProjects(spaceId: string, userId?: string) {
    const cond = [eq(teamMemberProjects.spaceId, BigInt(spaceId))];
    if (userId) cond.push(eq(teamMemberProjects.userId, BigInt(userId)));
    const rows = await db
      .select()
      .from(teamMemberProjects)
      .where(and(...cond))
      .orderBy(desc(teamMemberProjects.createdAt));
    return {
      list: rows.map((r) => ({
        user_id: String(r.userId),
        project_kind: r.projectKind,
        project_id: String(r.projectId),
        participation_type: r.participationType,
      })),
    };
  }

  async bindMemberProject(
    spaceId: string,
    opUserId: string,
    input: { user_id: string; project_kind: number; project_id: string; participation_type?: number },
  ) {
    const [member] = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, BigInt(input.user_id))));
    if (!member) throw new AppError(ErrorCode.INVALID_PARAM, "member not in this team", { field: "user_id" });
    await db
      .insert(teamMemberProjects)
      .values({
        id: newId(),
        spaceId: BigInt(spaceId),
        userId: BigInt(input.user_id),
        projectKind: input.project_kind,
        projectId: BigInt(input.project_id),
        participationType: input.participation_type ?? 1,
        grantedBy: BigInt(opUserId),
      })
      .onConflictDoUpdate({
        target: [teamMemberProjects.spaceId, teamMemberProjects.userId, teamMemberProjects.projectKind, teamMemberProjects.projectId],
        set: { participationType: input.participation_type ?? 1, updatedAt: new Date() },
      });
    return { ok: true };
  }

  async unbindMemberProject(spaceId: string, input: { user_id: string; project_kind: number; project_id: string }) {
    await db
      .delete(teamMemberProjects)
      .where(
        and(
          eq(teamMemberProjects.spaceId, BigInt(spaceId)),
          eq(teamMemberProjects.userId, BigInt(input.user_id)),
          eq(teamMemberProjects.projectKind, input.project_kind),
          eq(teamMemberProjects.projectId, BigInt(input.project_id)),
        ),
      );
    return { ok: true };
  }
}
