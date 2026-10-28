import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import {
  creditAccounts,
  creditFlows,
  episodes,
  identities,
  models,
  scriptProjects,
  spaceMembers,
  spaces,
  tasks,
  teamGroups,
  teamMemberProjects,
  teamRoles,
  users,
  userThirdKeys,
} from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { toBigId } from "../../common/bigid";
import { decryptPhone, decryptSecret, encryptSecret, hashPhone, hashSecret, maskSecret } from "../auth/crypto";
import { StorageService } from "../../storage/storage.service";
import {
  codesToPowerList,
  isKnownPermission,
  listPermissionCatalog,
  powerListToCodes,
} from "./permission-catalog";

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
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

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
   * 按权限码判权（**渐进式拦截**，默认放行）。
   *
   * 判定顺序（每一步都能让存量用例继续通过）：
   * 1. **owner 短路**：`role=1`（space owner）或 `roleCode="master"` 直接通过——
   *    owner 的特权来自契约 `isOwner` 判定，不该被 power_list 影响；
   * 2. **没有岗位码**（`roleCode` 为空）→ 放行。存量 13 个 e2e 的成员都是 role=3 且无岗位；
   * 3. **岗位在该 space 没有角色行** → 放行（历史数据/自定义岗位）；
   * 4. **角色 power_list 为空** → 放行。这是"默认放行"的核心：没有显式配置 = 尚未收紧；
   * 5. 否则要求 `code` 精确出现在 power_list 里（竞品 `hasPermission` 也是精确串匹配）。
   *
   * 只对 `ENFORCED_PERMISSIONS` 里列出的码调用（见 `enforced-permissions.ts`）；
   * 不要把这个方法挂到全站端点上——那是另一批"全量迁移存量角色默认权限"的活。
   */
  async requirePermission(spaceId: string, userId: string, code: string): Promise<TeamContext> {
    const ctx = await this.requireMember(spaceId, userId);
    // 1) owner 短路
    if (ctx.role === 1 || ctx.roleCode === "master") return ctx;
    // 2) 未分配岗位 → 默认放行
    const roleCode = ctx.roleCode;
    if (!roleCode) return ctx;
    // 3) 岗位无角色行 → 默认放行
    const [role] = await db
      .select({ powerList: teamRoles.powerList })
      .from(teamRoles)
      .where(and(eq(teamRoles.spaceId, BigInt(spaceId)), eq(teamRoles.roleCode, roleCode)));
    if (!role) return ctx;
    // 4) 未显式配置权限 → 默认放行
    const codes = powerListToCodes(role.powerList);
    if (codes.length === 0) return ctx;
    // 5) 显式配置过 → 精确匹配
    if (codes.includes(code)) return ctx;
    // details 不出网（AllExceptionsFilter 只回 code+msg），所以把码写进 msg
    throw new AppError(ErrorCode.FORBIDDEN, `permission denied: ${code}`, {
      reason: "permission_denied",
      code,
      role_code: roleCode,
    });
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

  /**
   * 成员 CSV 导出（对齐参照 member/export）。
   *
   * 第 95 批：改成**与列表同一组筛选**。此前它写死 `listMembers(spaceId, 1, 100)` ——
   * 既忽略竞品那 11 个 query 参数，又硬截 100 行：导出的内容和列表看到的对不上，
   * 而运营导表正是为了"把筛出来的这批人拿走"。现在按同一 `extra` 过滤，上限 5000 行。
   */
  async membersCsv(
    spaceId: string,
    extra: {
      group_id?: string;
      role_code?: string;
      status?: string;
      nick?: string;
      remark?: string;
      role_ids?: string;
      has_group?: string;
      include_descendants?: string;
    } = {},
  ): Promise<string> {
    const data = await this.listMembers(
      spaceId,
      1,
      5000,
      extra.group_id,
      extra.role_code,
      extra.status === undefined || extra.status === "" ? undefined : Number(extra.status),
      {
        nick: extra.nick,
        remark: extra.remark,
        role_ids: extra.role_ids,
        has_group: extra.has_group,
        include_descendants: extra.include_descendants,
      },
    );
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

  // ── 团队设置（对齐参照 team/edit）──────────────────────────
  /**
   * 改团队名 / 席位上限 / 功能开关。
   *
   * 两条硬约束：
   * 1. **只有团队空间能改**：个人空间（type=1）也走 `/cam/team/info` 读，
   *    但改名/席位对它没有意义；不挡住就会出现"把个人空间改成 5 席位团队"的脏数据。
   * 2. **席位不能低于现有成员数**：否则下一次邀请会被自己的配置锁死，
   *    而且列表里"已用 4 / 上限 3"是自相矛盾的状态。
   */
  async updateTeam(
    spaceId: string,
    input: { name?: string; max_seats?: number; film_enabled?: boolean; agent_whitelist?: boolean },
  ) {
    const [space] = await db.select().from(spaces).where(eq(spaces.id, BigInt(spaceId)));
    if (!space) throw new AppError(ErrorCode.NOT_FOUND, "space not found");
    if (space.type !== 2) {
      throw new AppError(ErrorCode.INVALID_PARAM, "not a team space", { field: "space_id" });
    }
    if (input.max_seats !== undefined) {
      const [cnt] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.status, 1)));
      const used = cnt?.n ?? 0;
      if (input.max_seats < used) {
        throw new AppError(ErrorCode.INVALID_PARAM, "max_seats cannot be lower than current members", {
          field: "max_seats",
          used,
        });
      }
    }
    await db
      .update(spaces)
      .set({
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.max_seats !== undefined ? { maxSeats: input.max_seats } : {}),
        ...(input.film_enabled !== undefined ? { filmEnabled: input.film_enabled ? 1 : 0 } : {}),
        ...(input.agent_whitelist !== undefined ? { agentWhitelist: input.agent_whitelist ? 1 : 0 } : {}),
        updatedAt: new Date(),
      })
      .where(eq(spaces.id, space.id));
    return this.info(spaceId);
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
    const [group] = await db.select().from(teamGroups).where(eq(teamGroups.id, toBigId(groupId, "group_id")));
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
    const [group] = await db.select().from(teamGroups).where(eq(teamGroups.id, toBigId(groupId, "group_id")));
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

  /**
   * 分组统计（对齐参照 group/stats）：成员数 / 任务数 / 已消耗 / 已分配。
   *
   * `points_used` 用该组成员在**本团队空间**下已结算的任务积分之和——
   * 不用个人空间的余额，否则"组消耗"会把成员自己在别处的花费算进来。
   */
  async groupStats(spaceId: string, groupId: string) {
    const [group] = await db.select().from(teamGroups).where(eq(teamGroups.id, toBigId(groupId, "group_id")));
    if (!group || String(group.spaceId) !== spaceId) {
      throw new AppError(ErrorCode.NOT_FOUND, "group not found");
    }
    const members = await db
      .select({ userId: spaceMembers.userId })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.groupId, group.id)));
    const memberIds = members.map((m) => m.userId);
    let taskCount = 0;
    let pointsUsed = 0;
    if (memberIds.length > 0) {
      const [agg] = await db
        .select({
          n: sql<number>`count(*)::int`,
          used: sql<number>`coalesce(sum(credits_settled), 0)::int`,
        })
        .from(tasks)
        .where(and(eq(tasks.spaceId, BigInt(spaceId)), inArray(tasks.userId, memberIds)));
      taskCount = agg?.n ?? 0;
      pointsUsed = agg?.used ?? 0;
    }
    const [alloc] = await db
      .select({ total: sql<number>`coalesce(sum(-delta), 0)::int` })
      .from(creditFlows)
      .where(
        and(
          eq(creditFlows.spaceId, BigInt(spaceId)),
          eq(creditFlows.groupId, group.id),
          eq(creditFlows.kind, "team_allocate_out"),
        ),
      );
    return {
      group_id: String(group.id),
      member_count: memberIds.length,
      task_count: taskCount,
      points_used: pointsUsed,
      points_allocated: alloc?.total ?? 0,
    };
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

  /**
   * 成员列表。
   *
   * 第 95 批：竞品 `cam/team/:team_id/members` 的 QUERY 有 11 个参数，我方此前只收 5 个
   * （page/page_size/group_id/role_code/status），其余被丢弃 → 「按昵称/按角色集/按是否分组」
   * 筛选全部失效。补的判据：
   * - `nick` / `remark`：`space_members.nickname` / `.remark` 明文列 → 模糊匹配，真能做；
   * - `role_ids`（逗号分隔或重复）：`space_members.role_id` → `inArray`；
   * - `has_group`（1/0）：`group_id is not null` / `is null`；
   * - `include_descendants`：`team_groups.parent_id` 是树 → 给了 `group_id` 时把它整棵子树展开；
   * - `account` / `sp_ids`：**有意不接**。`space_members.account` 是从未写入的死列
   *   （两处 `insert(spaceMembers)` 都不带它），接了就恒空；`sp_ids`（成员参与的项目）
   *   要 join `team_member_projects` 再聚合，属跨表新口径，留给产品确认后再做。
   */
  async listMembers(
    spaceId: string,
    page = 1,
    pageSize = 20,
    groupId?: string,
    roleCode?: string,
    status?: number,
    extra: {
      nick?: string;
      remark?: string;
      role_ids?: string;
      has_group?: string;
      include_descendants?: string;
    } = {},
  ) {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(1, pageSize));
    const cond = [eq(spaceMembers.spaceId, BigInt(spaceId))];
    if (roleCode) cond.push(eq(spaceMembers.roleCode, roleCode));
    if (status !== undefined) cond.push(eq(spaceMembers.status, status));

    // 分组过滤：给了 group_id 且要含下级 → 展开整棵子树（否则只命中直属分组）
    if (groupId) {
      const ids = await this.groupSubtreeIds(spaceId, groupId, extra.include_descendants === "1" || extra.include_descendants === "true");
      cond.push(inArray(spaceMembers.groupId, ids.map((id) => BigInt(id))));
    } else if (extra.has_group === "1" || extra.has_group === "true") {
      cond.push(sql`${spaceMembers.groupId} is not null`);
    } else if (extra.has_group === "0" || extra.has_group === "false") {
      cond.push(sql`${spaceMembers.groupId} is null`);
    }

    if (extra.nick) cond.push(ilike(spaceMembers.nickname, `%${extra.nick}%`));
    if (extra.remark) cond.push(ilike(spaceMembers.remark, `%${extra.remark}%`));
    if (extra.role_ids) {
      const ids = extra.role_ids
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => BigInt(s));
      if (ids.length > 0) cond.push(inArray(spaceMembers.roleId, ids));
    }

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
      list: rows.map((r) => this.toMemberDto(r)),
      total: cnt?.n ?? 0,
      page: p,
      page_size: ps,
    };
  }

  /**
   * 取一个分组及其（可选）所有后代的 id。
   *
   * 为什么要这个方法：`team_groups.parent_id` 是自引用树，而 `include_descendants`
   * 是竞品 `members` 端点上的真实参数。用循环逐层展开而不是递归 CTE ——
   * 团队分组是**人工维护的个位数~十位数层级**，循环上限（10 层）足够，
   * 且不引入 PG 专属语法（本地/CI 换库不会炸）。
   */
  private async groupSubtreeIds(spaceId: string, rootGroupId: string, includeDescendants: boolean): Promise<string[]> {
    const all = await db
      .select({ id: teamGroups.id, parentId: teamGroups.parentId })
      .from(teamGroups)
      .where(eq(teamGroups.spaceId, BigInt(spaceId)));
    const root = String(rootGroupId);
    if (!includeDescendants) return [root];

    const childrenOf = new Map<string, string[]>();
    for (const g of all) {
      const pid = g.parentId ? String(g.parentId) : null;
      if (!pid) continue;
      const arr = childrenOf.get(pid) ?? [];
      arr.push(String(g.id));
      childrenOf.set(pid, arr);
    }
    // BFS + 层级上限：即使数据里有环（人工改 parent 造出来的），也不会死循环
    const out: string[] = [];
    const seen = new Set<string>();
    let frontier = [root];
    for (let depth = 0; depth < 10 && frontier.length > 0; depth += 1) {
      const next: string[] = [];
      for (const id of frontier) {
        if (seen.has(id)) continue;
        seen.add(id);
        out.push(id);
        next.push(...(childrenOf.get(id) ?? []));
      }
      frontier = next;
    }
    return out;
  }

  /** 成员行 → 契约 DTO（列表与详情共用，避免两处字段漂移） */
  private toMemberDto = (r: typeof spaceMembers.$inferSelect) => ({
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
  });

  /** 单成员详情（对齐参照 member/:id） */
  async memberDetail(spaceId: string, userId: string) {
    const [row] = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, toBigId(userId, "user_id"))));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "member not found");
    return this.toMemberDto(row);
  }

  /**
   * 改成员昵称（团队内展示名）。
   *
   * 与 `updateMember` 分开的理由：那边改的是角色/分组/状态（管理员操作），
   * 昵称是成员自己的展示名——混在一个接口里会让"我只想改个名字"也要求管理员权限。
   */
  async updateMemberNickname(spaceId: string, userId: string, nickname: string) {
    const name = nickname.trim();
    if (!name) throw new AppError(ErrorCode.INVALID_PARAM, "nickname required", { field: "nickname" });
    const [row] = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, BigInt(userId))));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "member not found");
    await db
      .update(spaceMembers)
      .set({ nickname: name, updatedAt: new Date() })
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, BigInt(userId))));
    return { ok: true, nickname: name };
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

  /**
   * 批量分配（≤50）：**逐条独立**，一条失败不连累其它。
   *
   * 为什么不包成一个事务：批量分配的语义是"能分的都分出去"，
   * 包事务会出现"第 12 条余额不足 → 前 11 条已分配全部回滚"，
   * 与用户意图相反（与画布 batch-node-tasks 同一个判断）。
   */
  async batchAllocate(
    spaceId: string,
    opUserId: string,
    input: { items: Array<{ user_id: string; amount: number }>; memo?: string },
  ) {
    if (input.items.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "items must not be empty", { field: "items" });
    }
    if (input.items.length > 50) {
      throw new AppError(ErrorCode.INVALID_PARAM, "items must be <= 50", { field: "items" });
    }
    const results: Array<{
      user_id: string;
      ok: boolean;
      code?: number;
      msg?: string;
      amount?: number;
      team_balance?: number;
      member_balance?: number;
    }> = [];
    let succeeded = 0;
    for (const item of input.items) {
      try {
        const r = await this.allocate(spaceId, opUserId, {
          user_id: item.user_id,
          amount: item.amount,
          ...(input.memo ? { memo: input.memo } : {}),
        });
        results.push({
          user_id: item.user_id,
          ok: true,
          amount: item.amount,
          team_balance: r.team_balance,
          member_balance: r.member_balance,
        });
        succeeded += 1;
      } catch (e) {
        const err = e as { code?: number; message?: string };
        results.push({
          user_id: item.user_id,
          ok: false,
          code: err.code ?? ErrorCode.INTERNAL,
          msg: err.message ?? "allocate failed",
        });
      }
    }
    return { items: results, succeeded, failed: results.length - succeeded };
  }

  /**
   * 流水筛选条件（列表与导出共用，避免两边筛选语义漂移）。
   *
   * 第 95 批扩了 4 个维度（竞品 `cam/team/points-flow/{list,export}` 的 QUERY 有、我方此前丢弃）：
   * - `create_time_start` / `create_time_end`：`credit_flows.created_at` 范围（闭区间）；
   * - `op_type`：竞品把流水类型叫 `op_type`，我方列是 `credit_flows.kind` → **同一列的两个名字**；
   *   两个都给（`kind` 是老调用方，`op_type` 是照竞品写的调用方），同时给则必须一致；
   * - `op_user_name`：操作者昵称模糊（`users.nickname` 明文）。**刻意不做 `op_user_account`**：
   *   `space_members.account` 是一列从未被写入的**死列**（`insert(spaceMembers)` 两处都不带它），
   *   手机号又以 `phone_hash`(HMAC) + `phone_cipher`(AES-GCM) 存储、无法模糊检索 ——
   *   接一个恒空的账户搜索比不接更坏（这条判据与第 94 批 #12 的 `parent_id` 一致）。
   * - `target_user_name`：目标成员昵称模糊。
   *
   * 名字筛选需要 join `users`，所以这里返回 `{where, needsUserJoin}`，
   * 由调用方决定是否加 join（导出同样走这里，保证两边口径一致）。
   */
  private pointsFlowWhere(
    spaceId: string,
    opts: {
      kind?: string;
      target_user_id?: string;
      group_id?: string;
      op_user_id?: string;
      create_time_start?: string;
      create_time_end?: string;
      op_type?: string;
      op_user_name?: string;
      target_user_name?: string;
    } = {},
  ) {
    const cond = [
      eq(creditFlows.spaceId, BigInt(spaceId)),
      sql`${creditFlows.kind} in ('team_allocate_out','team_allocate_in','team_recover_out','team_recover_in')`,
    ];
    // `kind` 与 `op_type` 是同一列的两个名字；两个都给时必须一致，否则是调用方自相矛盾
    if (opts.kind && opts.op_type && opts.kind !== opts.op_type) {
      throw new AppError(ErrorCode.INVALID_PARAM, "kind and op_type disagree; they are the same field", {
        field: "op_type",
      });
    }
    const kind = opts.kind ?? opts.op_type;
    if (kind) cond.push(eq(creditFlows.kind, kind));
    if (opts.target_user_id) cond.push(eq(creditFlows.refUserId, BigInt(opts.target_user_id)));
    if (opts.group_id) cond.push(eq(creditFlows.groupId, BigInt(opts.group_id)));
    if (opts.op_user_id) cond.push(eq(creditFlows.opUserId, BigInt(opts.op_user_id)));

    const from = this.timeOrNull(opts.create_time_start);
    const to = this.timeOrNull(opts.create_time_end);
    if (from) cond.push(gte(creditFlows.createdAt, from));
    if (to) cond.push(lte(creditFlows.createdAt, to));

    // 名字筛选走 `users`（操作者）与 `spaceMembers`（目标成员的昵称快照）
    let needsUserJoin = false;
    let needsMemberJoin = false;
    if (opts.op_user_name) {
      cond.push(ilike(users.nickname, `%${opts.op_user_name}%`));
      needsUserJoin = true;
    }
    if (opts.target_user_name) {
      cond.push(ilike(spaceMembers.nickname, `%${opts.target_user_name}%`));
      needsMemberJoin = true;
    }
    return { where: and(...cond), needsUserJoin, needsMemberJoin };
  }

  /**
   * 团队积分流水（对应参照 points-flow/list）。
   *
   * 第 95 批筛选维度从 6 个补到 10 个（竞品 QUERY 里被丢弃的 4 个）。
   * 名字筛选要 join，**列表与导出必须走同一组 join**，否则 `total` 与 `list` 会对不上
   * （`where` 用了 users 而 count 没 join，count 会直接报 SQL 错）。
   */
  async listPointsFlows(
    spaceId: string,
    opts: {
      page?: number;
      page_size?: number;
      kind?: string;
      target_user_id?: string;
      group_id?: string;
      op_user_id?: string;
      create_time_start?: string;
      create_time_end?: string;
      op_type?: string;
      op_user_name?: string;
      target_user_name?: string;
    } = {},
  ) {
    const p = Math.max(1, opts.page ?? 1);
    const ps = Math.min(100, Math.max(1, opts.page_size ?? 20));
    const { where, needsUserJoin, needsMemberJoin } = this.pointsFlowWhere(spaceId, opts);
    const base = () => {
      // 一律显式 `select({ creditFlows })`：`select()` 在**无 join** 时返回扁平行、
      // 有 join 时返回 `{creditFlows: …}` —— 两种形状混用会让 map 静默拿到 undefined。
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle 的 builder 在条件 join 下类型会退化成 any
      let q: any = db.select({ creditFlows }).from(creditFlows);
      if (needsUserJoin) q = q.leftJoin(users, eq(users.id, creditFlows.opUserId));
      if (needsMemberJoin) {
        q = q.leftJoin(
          spaceMembers,
          and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, creditFlows.refUserId)),
        );
      }
      return q;
    };
    const rows = await base()
      .where(where)
      .orderBy(desc(creditFlows.createdAt))
      .limit(ps)
      .offset((p - 1) * ps);

    // count 用同一条 join 链，只换 select 列
    let cntQ: any = db.select({ n: sql<number>`count(*)::int` }).from(creditFlows);
    if (needsUserJoin) cntQ = cntQ.leftJoin(users, eq(users.id, creditFlows.opUserId));
    if (needsMemberJoin) {
      cntQ = cntQ.leftJoin(
        spaceMembers,
        and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, creditFlows.refUserId)),
      );
    }
    const [cnt] = await cntQ.where(where);

    return {
      // join 之后行形状是 `{credit_flows: row, users?: …, space_members?: …}`；
      // 这里取 `creditFlows` 那一层，保证**返回形状与不带 join 时完全一致**
      list: rows.map((r: { creditFlows: typeof creditFlows.$inferSelect }) => ({
        id: String(r.creditFlows.id),
        kind: r.creditFlows.kind,
        delta: r.creditFlows.delta,
        balance_after: r.creditFlows.balanceAfter,
        target_user_id: r.creditFlows.refUserId ? String(r.creditFlows.refUserId) : null,
        from_space_id: String(r.creditFlows.spaceId),
        to_space_id: r.creditFlows.refSpaceId ? String(r.creditFlows.refSpaceId) : null,
        op_user_id: r.creditFlows.opUserId ? String(r.creditFlows.opUserId) : null,
        group_id: r.creditFlows.groupId ? String(r.creditFlows.groupId) : null,
        memo: r.creditFlows.memo,
        created_at: r.creditFlows.createdAt.toISOString(),
      })),
      total: cnt?.n ?? 0,
      page: p,
      page_size: ps,
    };
  }

  /**
   * 流水导出（CSV，对齐参照 points-flow/export）。
   *
   * 返回**现签链接**而不是直接吐二进制：导出在用户认知里是"生成一个可下载文件"，
   * 可能过一会儿才点；链接 1h 有效，文件留在存储里可重复取。
   * 单次上限 5000 行——团队流水是运营报表而非审计全量，超过请用筛选分批导。
   */
  async exportPointsFlows(
    spaceId: string,
    opts: {
      kind?: string;
      target_user_id?: string;
      group_id?: string;
      op_user_id?: string;
      create_time_start?: string;
      create_time_end?: string;
      op_type?: string;
      op_user_name?: string;
      target_user_name?: string;
    } = {},
  ) {
    const { where, needsUserJoin, needsMemberJoin } = this.pointsFlowWhere(spaceId, opts);
    // 导出与列表必须同一组 join / 同一个 where，否则「导出的行数 ≠ 列表 total」
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 同 listPointsFlows：条件 join 使 builder 类型退化
    let q: any = db.select({ creditFlows }).from(creditFlows);
    if (needsUserJoin) q = q.leftJoin(users, eq(users.id, creditFlows.opUserId));
    if (needsMemberJoin) {
      q = q.leftJoin(
        spaceMembers,
        and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, creditFlows.refUserId)),
      );
    }
    const joined = await q.where(where).orderBy(desc(creditFlows.createdAt)).limit(5000);
    const rows: Array<typeof creditFlows.$inferSelect> = joined.map(
      (r: { creditFlows: typeof creditFlows.$inferSelect }) => r.creditFlows,
    );
    const esc = (v: unknown): string => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "id",
      "kind",
      "delta",
      "balance_after",
      "target_user_id",
      "from_space_id",
      "to_space_id",
      "op_user_id",
      "group_id",
      "memo",
      "created_at",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          String(r.id),
          r.kind,
          r.delta,
          r.balanceAfter,
          r.refUserId ? String(r.refUserId) : "",
          String(r.spaceId),
          r.refSpaceId ? String(r.refSpaceId) : "",
          r.opUserId ? String(r.opUserId) : "",
          r.groupId ? String(r.groupId) : "",
          r.memo ?? "",
          r.createdAt.toISOString(),
        ]
          .map(esc)
          .join(","),
      );
    }
    // BOM：Excel 直接双击打开不乱码（与成员导出一致）
    const csv = `\uFEFF${lines.join("\n")}`;
    const stamp = Date.now();
    const key = `u/${spaceId}/exports/points-flow-${stamp}.csv`;
    await this.storage.put(key, Buffer.from(csv, "utf8"), "text/csv; charset=utf-8");
    const ttl = 3600;
    const url = await this.storage.signDownload(key, ttl);
    return {
      file_uri: url,
      filename: `points-flow-${stamp}.csv`,
      expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
      row_count: rows.length,
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

  // ── 权限码体系（目录 + 角色绑定存储）────────────────────
  /**
   * ⚠️ 本批边界（写死在这里，防后来者误以为已生效）：
   * 下面三个方法只负责**目录展示**与**角色 power_list 存储**，**不参与任何请求鉴权**。
   * 全站入口拦截（L3 按 power_list 判权）留到独立批次，因为它会打穿既有 13 个 e2e suite
   * （那些 team 成员都是 role=3 且 power_list 为空）——需要同时定义"存量角色的默认权限"。
   * 详见 `permission-catalog.ts` 文件头。
   */

  /** 权限码目录（按分组；前端矩阵编辑器直接渲染） */
  permissionCatalog() {
    return listPermissionCatalog();
  }

  /** 某个角色的权限码（role_id 必须属于本 space；不存在 → 400102） */
  async getRolePermissions(spaceId: string, roleId: string) {
    await this.listRoles(spaceId); // 懒初始化内置 11 级角色（幂等）
    const [role] = await db
      .select()
      .from(teamRoles)
      .where(and(eq(teamRoles.id, toBigId(roleId, "role_id")), eq(teamRoles.spaceId, BigInt(spaceId))));
    if (!role) throw new AppError(ErrorCode.NOT_FOUND, "role not found");
    const codes = powerListToCodes(role.powerList);
    return {
      role_id: String(role.id),
      role_code: role.roleCode,
      role_name: role.roleName,
      role_level: role.roleLevel,
      is_system: role.isSystem,
      permissions: codes,
      power_list: role.powerList,
      module_id_list: role.moduleIdList,
      known_permissions: codes.filter((c) => isKnownPermission(c)),
      unknown_permissions: codes.filter((c) => !isKnownPermission(c)),
    };
  }

  /**
   * 覆盖写角色权限（幂等：同一集合重复写，落库字节与返回值都相同）。
   *
   * 三条规则：
   * 1. **未知码直接拒**（400101 `field=permissions`，附全部未知码）——静默丢弃会让
   *    运维以为配置成功，实际少了权限；
   * 2. **owner 角色（master）不可改**：它的特权来自 `role_code` 短路（契约 §3.1
   *    `isOwner` 判定），写 power_list 不生效，允许写反而制造"配了但没用"的假象；
   * 3. 排序去重后写 → 同集合重复 PUT 的 `power_list` 字节完全一致（`changed=false`），
   *    这样审计 diff 不会因为勾选顺序不同而每次都"看起来变了"。
   */
  async setRolePermissions(spaceId: string, roleId: string, codes: string[], moduleIdList?: unknown) {
    await this.listRoles(spaceId);
    const [role] = await db
      .select()
      .from(teamRoles)
      .where(and(eq(teamRoles.id, toBigId(roleId, "role_id")), eq(teamRoles.spaceId, BigInt(spaceId))));
    if (!role) throw new AppError(ErrorCode.NOT_FOUND, "role not found");
    if (role.roleCode === "master") {
      throw new AppError(ErrorCode.INVALID_PARAM, "owner role permissions are fixed（owner_role_immutable）", {
        field: "role_id",
        reason: "owner_role_immutable",
      });
    }
    const unique = [...new Set(codes)];
    const unknown = unique.filter((c) => !isKnownPermission(c)).sort();
    if (unknown.length > 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, `unknown permission codes: ${unknown.join(", ")}`, {
        field: "permissions",
        reason: "unknown_code",
        unknown,
      });
    }
    const nextPowerList = codesToPowerList(unique);
    const nextModuleIdList = moduleIdList === undefined ? role.moduleIdList : moduleIdList;
    const before = powerListToCodes(role.powerList).sort();
    const after = unique.sort();
    const changed = JSON.stringify(before) !== JSON.stringify(after) ||
      JSON.stringify(role.moduleIdList) !== JSON.stringify(nextModuleIdList);
    if (changed) {
      await db
        .update(teamRoles)
        .set({ powerList: nextPowerList, moduleIdList: nextModuleIdList as never, updatedAt: new Date() })
        .where(eq(teamRoles.id, role.id));
    }
    return {
      role_id: String(role.id),
      role_code: role.roleCode,
      changed,
      permissions: after,
      power_list: nextPowerList,
      module_id_list: nextModuleIdList,
    };
  }

  /**
   * `GET /cam/temp-info` —— 团队级"模型开关矩阵"。
   *
   * 契约 §3.4 的响应字段（`api_key_white / is_lingman_wsid / is_sd_discount_black /
   * is_support / sd_480p_is_support / sd_is_support / seedance_is_support /
   * tsd_is_support`）里有 4 个是**折扣/白名单**语义而非能力开关，我方**没有对应列**，
   * 也没有取证到判定来源（contract §7 A-adjacent）。
   *
   * 处理原则（和 points_ro 一致）：**能推导的给真实值，推不出来的给 null 并列入
   * `unverified`**，绝不返回假 `false` 让前端以为"确定不支持"。
   *   - 可推导：`api_key_white`（本 space 是否配了 BYOK key）、四个模型族支持位
   *     （按 models 目录里的可见模型名匹配）；
   *   - 不可推导：`is_lingman_wsid` / `is_sd_discount_black` / `is_support` → null。
   */
  async tempInfo(spaceId: string) {
    const [space] = await db.select().from(spaces).where(eq(spaces.id, BigInt(spaceId)));
    if (!space) throw new AppError(ErrorCode.NOT_FOUND, "space not found");

    const visibleModels = await db
      .select({ name: models.name, displayName: models.displayName, vendor: models.vendor, capability: models.capability })
      .from(models)
      .where(eq(models.visible, true));

    const familySupported = (needle: string): boolean =>
      visibleModels.some(
        (m) =>
          m.name.toLowerCase().includes(needle) || (m.displayName ?? "").toLowerCase().includes(needle),
      );

    const [byok] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(userThirdKeys)
      .where(and(eq(userThirdKeys.spaceId, BigInt(spaceId)), eq(userThirdKeys.status, 1)));

    const unverified = ["is_lingman_wsid", "is_sd_discount_black", "is_support"];

    return {
      space_id: String(space.id),
      name: space.name,
      type: space.type,
      // ── 我方真实状态（有列 / 可聚合）──
      film_enabled: space.filmEnabled === 1,
      agent_whitelist: space.agentWhitelist === 1,
      api_key_white: Number(byok?.n ?? 0) > 0,
      // ── 模型开关矩阵（按 models 目录派生；契约同名字段）──
      sd_is_support: familySupported("sd"),
      sd_480p_is_support: familySupported("480p"),
      seedance_is_support: familySupported("seedance"),
      tsd_is_support: familySupported("tsd"),
      // ── 未取证：显式 null，不用假 false 冒充"确定不支持" ──
      is_lingman_wsid: null,
      is_sd_discount_black: null,
      is_support: null,
      unverified,
      derived_from: "models_catalog",
      model_families: {
        total_visible: visibleModels.length,
        vendors: [...new Set(visibleModels.map((m) => m.vendor))].sort(),
      },
    };
  }

  // ── 项目↔成员关联（对齐参照 `GET /cam/linked-users`）────────────
  /**
   * `GET /cam/linked-users[?sp_id]` —— 哪些成员在哪些项目上。
   *
   * 数据源是 `team_member_projects`（成员被授权参与哪些项目），**不是登录态**
   * ——"关联用户"在参照里是给项目负责人看的编制表，不是在线名单。
   * 一个成员参与多个项目就是多行；`sp_id` 给了就只看那一个项目。
   */
  async linkedUsers(spaceId: string, spId?: string) {
    const cond = [eq(teamMemberProjects.spaceId, BigInt(spaceId))];
    if (spId) cond.push(eq(teamMemberProjects.projectId, toBigId(spId, "sp_id")));
    const rows = await db
      .select({
        userId: teamMemberProjects.userId,
        projectKind: teamMemberProjects.projectKind,
        projectId: teamMemberProjects.projectId,
        participationType: teamMemberProjects.participationType,
        memberNickname: spaceMembers.nickname,
        roleCode: spaceMembers.roleCode,
        memberStatus: spaceMembers.status,
        userName: users.nickname,
        projectTitle: scriptProjects.title,
      })
      .from(teamMemberProjects)
      .leftJoin(
        spaceMembers,
        and(
          eq(spaceMembers.spaceId, teamMemberProjects.spaceId),
          eq(spaceMembers.userId, teamMemberProjects.userId),
        ),
      )
      .leftJoin(users, eq(users.id, teamMemberProjects.userId))
      .leftJoin(
        scriptProjects,
        and(
          eq(scriptProjects.id, teamMemberProjects.projectId),
          eq(teamMemberProjects.projectKind, 1),
        ),
      )
      .where(and(...cond))
      .orderBy(desc(teamMemberProjects.createdAt))
      .limit(1000);
    const userIds = [...new Set(rows.map((r) => String(r.userId)))];
    return {
      list: rows.map((r) => ({
        user_id: String(r.userId),
        nickname: r.memberNickname ?? r.userName ?? null,
        role_code: r.roleCode ?? null,
        member_status: r.memberStatus ?? null,
        project_kind: r.projectKind,
        project_id: String(r.projectId),
        project_title: r.projectTitle ?? null,
        participation_type: r.participationType,
      })),
      user_count: userIds.length,
      total: rows.length,
    };
  }

  // ── 项目维度积分（对齐参照 cam/team/project-points-*）──────────
  /**
   * 消耗流水本来就只记到"任务"（`credit_flows.ref_task_id`），项目维度得靠
   * `tasks.episode_id → episodes.project_id → script_projects.title` 反查。
   *
   * 两个刻意的取舍：
   * 1. 只取 `kind='settle'`：冻结/解冻/回收是同一笔钱的不同阶段，全算进来会把
   *    一次生成计成三次消耗（对齐参照"项目消耗"语义）。
   * 2. 反查不到项目时**保留该行**、`project_id/project_title` 记 `null`，
   *    而不是丢掉——丢掉会让"消耗总额 > 各项目之和"这种账对不上，且看不出缺口在哪。
   */
  private projectPointsCond(
    spaceId: string,
    opts: { create_time_start?: string; create_time_end?: string; op_user_name?: string } = {},
  ) {
    const cond = [eq(creditFlows.spaceId, BigInt(spaceId)), eq(creditFlows.kind, "settle")];
    const from = this.timeOrNull(opts.create_time_start);
    const to = this.timeOrNull(opts.create_time_end);
    if (from) cond.push(gte(creditFlows.createdAt, from));
    if (to) cond.push(lte(creditFlows.createdAt, to));
    if (opts.op_user_name) cond.push(ilike(users.nickname, `%${opts.op_user_name}%`));
    return and(...cond);
  }

  private timeOrNull(raw?: string): Date | null {
    if (!raw) return null;
    const t = new Date(raw);
    return Number.isNaN(t.getTime()) ? null : t;
  }

  async listProjectPointsFlows(
    spaceId: string,
    opts: {
      page?: number;
      page_size?: number;
      create_time_start?: string;
      create_time_end?: string;
      op_user_name?: string;
    } = {},
  ) {
    const p = Math.max(1, opts.page ?? 1);
    const ps = Math.min(100, Math.max(1, opts.page_size ?? 20));
    const where = this.projectPointsCond(spaceId, opts);
    const rows = await db
      .select({
        id: creditFlows.id,
        delta: creditFlows.delta,
        taskId: creditFlows.refTaskId,
        opUserId: creditFlows.opUserId,
        opUserName: users.nickname,
        projectId: episodes.projectId,
        projectTitle: scriptProjects.title,
        createdAt: creditFlows.createdAt,
      })
      .from(creditFlows)
      .leftJoin(tasks, eq(tasks.id, creditFlows.refTaskId))
      .leftJoin(episodes, eq(episodes.id, tasks.episodeId))
      .leftJoin(
        scriptProjects,
        and(eq(scriptProjects.id, episodes.projectId), eq(scriptProjects.spaceId, BigInt(spaceId))),
      )
      .leftJoin(users, eq(users.id, creditFlows.opUserId))
      .where(where)
      .orderBy(desc(creditFlows.createdAt))
      .limit(ps)
      .offset((p - 1) * ps);
    const [cnt] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(creditFlows)
      .leftJoin(tasks, eq(tasks.id, creditFlows.refTaskId))
      .leftJoin(episodes, eq(episodes.id, tasks.episodeId))
      .leftJoin(
        scriptProjects,
        and(eq(scriptProjects.id, episodes.projectId), eq(scriptProjects.spaceId, BigInt(spaceId))),
      )
      .leftJoin(users, eq(users.id, creditFlows.opUserId))
      .where(where);
    return {
      list: rows.map((r) => ({
        id: String(r.id),
        project_id: r.projectId ? String(r.projectId) : null,
        project_title: r.projectTitle ?? null,
        task_id: r.taskId ? String(r.taskId) : null,
        op_user_id: r.opUserId ? String(r.opUserId) : null,
        op_user_name: r.opUserName ?? null,
        points: -r.delta,
        created_at: r.createdAt.toISOString(),
      })),
      total: cnt?.n ?? 0,
      page: p,
      page_size: ps,
      unattributed_scoped: false,
    };
  }

  /**
   * 项目消耗流水导出（CSV；上限 5000 行，理由同 `exportPointsFlows`）。
   *
   * 第 95 批补 `page` / `page_size`：竞品该端点确实带这两个参数（导出也分页）。
   * 语义按「对**筛选后**的集合开窗」实现 —— 不传 = 全量（仍受 5000 行上限）；
   * 传了就只导出那一窗。**不能忽略它们**：调用方按竞品写 `?page=2&page_size=100`
   * 时，若被静默丢掉会拿到第 1 页的数据却以为是第 2 页，导出的账直接错位。
   */
  async exportProjectPointsFlows(
    spaceId: string,
    opts: {
      create_time_start?: string;
      create_time_end?: string;
      op_user_name?: string;
      page?: number;
      page_size?: number;
    } = {},
  ) {
    const where = this.projectPointsCond(spaceId, opts);
    const pageSize = Math.min(5000, Math.max(1, opts.page_size ?? 5000));
    const page = Math.max(1, opts.page ?? 1);
    const rows = await db
      .select({
        id: creditFlows.id,
        delta: creditFlows.delta,
        taskId: creditFlows.refTaskId,
        opUserId: creditFlows.opUserId,
        opUserName: users.nickname,
        projectId: episodes.projectId,
        projectTitle: scriptProjects.title,
        createdAt: creditFlows.createdAt,
      })
      .from(creditFlows)
      .leftJoin(tasks, eq(tasks.id, creditFlows.refTaskId))
      .leftJoin(episodes, eq(episodes.id, tasks.episodeId))
      .leftJoin(
        scriptProjects,
        and(eq(scriptProjects.id, episodes.projectId), eq(scriptProjects.spaceId, BigInt(spaceId))),
      )
      .leftJoin(users, eq(users.id, creditFlows.opUserId))
      .where(where)
      .orderBy(desc(creditFlows.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const esc = (v: unknown): string => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "id",
      "project_id",
      "project_title",
      "task_id",
      "op_user_id",
      "op_user_name",
      "points",
      "created_at",
    ];
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          String(r.id),
          r.projectId ? String(r.projectId) : "",
          r.projectTitle ?? "",
          r.taskId ? String(r.taskId) : "",
          r.opUserId ? String(r.opUserId) : "",
          r.opUserName ?? "",
          -r.delta,
          r.createdAt.toISOString(),
        ]
          .map(esc)
          .join(","),
      );
    }
    const csv = `\uFEFF${lines.join("\n")}`;
    const stamp = Date.now();
    const key = `u/${spaceId}/exports/project-points-flow-${stamp}.csv`;
    await this.storage.put(key, Buffer.from(csv, "utf8"), "text/csv; charset=utf-8");
    const ttl = 3600;
    const url = await this.storage.signDownload(key, ttl);
    return {
      file_uri: url,
      filename: `project-points-flow-${stamp}.csv`,
      expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
      row_count: rows.length,
    };
  }

  /** 项目消耗排行（`POST cam/team/project-points-ranking`，取消耗最多的前 N 个项目） */
  async projectPointsRanking(
    spaceId: string,
    opts: { limit?: number; create_time_start?: string; create_time_end?: string } = {},
  ) {
    const cond = [eq(creditFlows.spaceId, BigInt(spaceId)), eq(creditFlows.kind, "settle")];
    const from = this.timeOrNull(opts.create_time_start);
    const to = this.timeOrNull(opts.create_time_end);
    if (from) cond.push(gte(creditFlows.createdAt, from));
    if (to) cond.push(lte(creditFlows.createdAt, to));
    const rows = await db
      .select({
        projectId: episodes.projectId,
        projectTitle: scriptProjects.title,
        points: sql<number>`sum(-${creditFlows.delta})::int`,
        flows: sql<number>`count(*)::int`,
      })
      .from(creditFlows)
      .leftJoin(tasks, eq(tasks.id, creditFlows.refTaskId))
      .leftJoin(episodes, eq(episodes.id, tasks.episodeId))
      .leftJoin(
        scriptProjects,
        and(eq(scriptProjects.id, episodes.projectId), eq(scriptProjects.spaceId, BigInt(spaceId))),
      )
      .where(and(...cond))
      .groupBy(episodes.projectId, scriptProjects.title)
      .orderBy(desc(sql`sum(-${creditFlows.delta})`))
      .limit(Math.min(100, Math.max(1, opts.limit ?? 20)));
    return {
      list: rows.map((r, i) => ({
        rank: i + 1,
        project_id: r.projectId ? String(r.projectId) : null,
        project_title: r.projectTitle ?? null,
        points: Number(r.points ?? 0),
        flow_count: Number(r.flows ?? 0),
      })),
    };
  }

  // ── 成员登录凭据（对齐参照 `GET cam/team/member/:member_id/credential`）──
  /**
   * 成员的"登录凭据"。
   *
   * 参照里这个接口大概率是给**子账号体系**发账号/查初始密码用的；我方团队模型是
   * 「手机号邀请真实用户」（`addMembers` 按 `identities.phone_hash` 找人），
   * **没有子账号密码**。所以这里只诚实返回：登录方式 + 打码账号，
   * 并显式给出 `has_password:false` / `can_reset_password:false` ——
   * 不编一个假密码字段出来让前端以为可以"重置密码"。
   *
   * 只回打码值：调用方是需要看"这个人用哪个号登录"的团队管理员，
   * 不是需要完整手机号的业务场景（完整号码要单独授权，见隐私口径）。
   */
  async memberCredential(spaceId: string, memberUserId: string) {
    const uid = toBigId(memberUserId, "member_id");
    const [member] = await db
      .select({
        userId: spaceMembers.userId,
        nickname: spaceMembers.nickname,
        roleCode: spaceMembers.roleCode,
        status: spaceMembers.status,
        userName: users.nickname,
      })
      .from(spaceMembers)
      .leftJoin(users, eq(users.id, spaceMembers.userId))
      .where(and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, uid)));
    if (!member) throw new AppError(ErrorCode.NOT_FOUND, "member not in this team");

    const rows = await db
      .select({ provider: identities.provider, phoneCipher: identities.phoneCipher })
      .from(identities)
      .where(eq(identities.userId, uid))
      .orderBy(asc(identities.createdAt));

    const methods = rows.map((r) => {
      if (r.provider !== "phone") return { provider: r.provider, account_masked: null };
      if (!r.phoneCipher) return { provider: "phone", account_masked: null };
      try {
        const phone = decryptPhone(r.phoneCipher);
        const masked =
          phone.length >= 7
            ? `${phone.slice(0, 3)}****${phone.slice(-4)}`
            : "*".repeat(phone.length);
        return { provider: "phone", account_masked: masked };
      } catch {
        // 换过 PHONE_ENC_KEY 时旧密文解不开：给 null 而不是 500
        return { provider: "phone", account_masked: null };
      }
    });

    return {
      user_id: String(uid),
      nickname: member.nickname ?? member.userName ?? null,
      role_code: member.roleCode ?? null,
      member_status: member.status,
      login_methods: methods,
      has_password: false,
      can_reset_password: false,
      note: "members sign in with their own phone number; this build has no sub-account password",
    };
  }

  // ── BYOK 第三方 Key（对齐参照 cam/user/third/key/*）────────────
  /**
   * 只返回**自己的** Key。
   *
   * `user_third_keys` 存的是个人 API Key（BYOK），管理员能列出别人的就等于
   * 团队里放了一台"Key 收割机"。表上带 `space_id` 是为了同一用户在多团队
   * 各配一份互不串——不是为了让别人的 space 看见。
   *
   * 明文永不回传：只回 `api_key_masked`（`sk-ab…wxyz`）。
   */
  async listThirdKeys(spaceId: string, userId: string) {
    const rows = await db
      .select()
      .from(userThirdKeys)
      .where(
        and(eq(userThirdKeys.spaceId, BigInt(spaceId)), eq(userThirdKeys.userId, BigInt(userId))),
      )
      .orderBy(desc(userThirdKeys.createdAt));
    return { list: rows.map((r) => this.thirdKeyDto(r)) };
  }

  private thirdKeyDto(row: typeof userThirdKeys.$inferSelect) {
    let masked = "******";
    try {
      masked = maskSecret(decryptSecret(row.keyCipher));
    } catch {
      // 密文坏了（换过 PHONE_ENC_KEY）不该让整页 500：给占位并让用户重填
      masked = "******";
    }
    return {
      id: String(row.id),
      provider: row.provider,
      label: row.label,
      api_key_masked: masked,
      status: row.status,
      last_used_at: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt ? row.updatedAt.toISOString() : null,
    };
  }

  /** 查自己的 Key；别人的 / 别的 space 的一律 `not found`（不告诉"它存在但你没权"） */
  private async findThirdKey(spaceId: string, userId: string, id: string) {
    const kid = toBigId(id, "id");
    const [row] = await db
      .select()
      .from(userThirdKeys)
      .where(
        and(
          eq(userThirdKeys.id, kid),
          eq(userThirdKeys.spaceId, BigInt(spaceId)),
          eq(userThirdKeys.userId, BigInt(userId)),
        ),
      );
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "third key not found");
    return row;
  }

  async thirdKeyInfo(spaceId: string, userId: string, id: string) {
    return { third_key: this.thirdKeyDto(await this.findThirdKey(spaceId, userId, id)) };
  }

  async addThirdKey(
    spaceId: string,
    userId: string,
    input: { provider: string; label?: string; api_key: string; status?: number },
  ) {
    const keyHash = hashSecret(input.api_key);
    const [dup] = await db
      .select({ id: userThirdKeys.id })
      .from(userThirdKeys)
      .where(
        and(
          eq(userThirdKeys.spaceId, BigInt(spaceId)),
          eq(userThirdKeys.userId, BigInt(userId)),
          eq(userThirdKeys.provider, input.provider),
          eq(userThirdKeys.keyHash, keyHash),
        ),
      );
    if (dup) {
      throw new AppError(ErrorCode.INVALID_PARAM, "this key is already registered for the provider", {
        field: "api_key",
      });
    }
    const id = newId();
    await db.insert(userThirdKeys).values({
      id,
      userId: BigInt(userId),
      spaceId: BigInt(spaceId),
      provider: input.provider,
      label: input.label?.trim() ?? "",
      keyCipher: encryptSecret(input.api_key),
      keyHash,
      status: input.status ?? 1,
    });
    return { third_key: this.thirdKeyDto(await this.findThirdKey(spaceId, userId, String(id))) };
  }

  async updateThirdKey(
    spaceId: string,
    userId: string,
    id: string,
    input: { provider?: string; label?: string; api_key?: string; status?: number },
  ) {
    const row = await this.findThirdKey(spaceId, userId, id);
    const patch: Partial<typeof userThirdKeys.$inferInsert> = { updatedAt: new Date() };
    if (input.provider !== undefined) patch.provider = input.provider;
    if (input.label !== undefined) patch.label = input.label.trim();
    if (input.status !== undefined) patch.status = input.status;
    if (input.api_key !== undefined) {
      const keyHash = hashSecret(input.api_key);
      const provider = input.provider ?? row.provider;
      // 换成"同 provider 下另一行已用过的同一把 key"要拒，否则查重形同虚设
      const sameHash = await db
        .select({ id: userThirdKeys.id })
        .from(userThirdKeys)
        .where(
          and(
            eq(userThirdKeys.spaceId, BigInt(spaceId)),
            eq(userThirdKeys.userId, BigInt(userId)),
            eq(userThirdKeys.provider, provider),
            eq(userThirdKeys.keyHash, keyHash),
          ),
        );
      if (sameHash.some((r) => String(r.id) !== String(row.id))) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          "this key is already registered for the provider",
          { field: "api_key" },
        );
      }
      patch.keyCipher = encryptSecret(input.api_key);
      patch.keyHash = keyHash;
    }
    await db.update(userThirdKeys).set(patch).where(eq(userThirdKeys.id, row.id));
    return { third_key: this.thirdKeyDto(await this.findThirdKey(spaceId, userId, id)) };
  }

  /**
   * 硬删而不是软删：这是**凭据**，留一行软删记录意味着密文还在库里躺着。
   * 想停用请 PUT `status=2`（保留 key 但不再参与派发）。
   */
  async deleteThirdKey(spaceId: string, userId: string, id: string) {
    const row = await this.findThirdKey(spaceId, userId, id);
    await db.delete(userThirdKeys).where(eq(userThirdKeys.id, row.id));
    return { deleted: true, id: String(row.id) };
  }
}

