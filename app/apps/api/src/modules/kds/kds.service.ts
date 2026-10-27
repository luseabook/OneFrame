import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  creditAccounts,
  creditFlows,
  spaceMembers,
  spaces,
  tasks,
} from "@app/db";
import { AppError, ErrorCode } from "@app/shared";
import { db } from "../../db/database";
import { TeamService } from "../team/team.service";

/**
 * 团队数据看板（kds/da）服务 —— 对应参照产品 `/web/v1/kds/da/*` 13 个只读端点。
 *
 * 三条设计约束（为什么这么写）：
 *
 * 1. **纯读聚合，不新建表**。数据源全是既有表：`credit_flows`（消耗流水）、
 *    `credit_accounts`（池余额）、`tasks`（任务粒度）、`space_members`（成员维度）。
 *    看板是「既有事实的另一种切法」，不是新事实。
 *
 * 2. **一律按 space 隔离**。参照产品的 team_id 对应我方 space_id（ADR-010：
 *    团队 = spaces(type=2)，不另建 teams 表）。所有查询第一条件都是 spaceId，
 *    且调用前必须先过 `requireMember`（非成员 403）。
 *
 * 3. **聚合走 SQL，不在应用层循环**。成员数 × 任务数会把 N+1 放大成全表扫描；
 *    所有排名/明细都用 GROUP BY 或子查询一次取完。索引已由 `idx_flows_space`、
 *    `idx_flows_space_kind` 覆盖（见 schema.ts creditFlows）。
 *
 * 口径说明（重要，和竞品对齐）：
 * - 「消耗」= `credit_flows` 中 `kind='settle'` 的 `-delta` 绝对值（结算是真扣），
 *   不含 `freeze`（冻结只是占用，失败会解冻）。这与 `GET /credits/flows` 的
 *   `tab=consume` 口径一致。
 * - 「任务数」= `tasks` 全状态计数；「成功率」= 成功态 / 已终态（排除 PENDING/RUNNING）。
 */
@Injectable()
export class KdsService {
  constructor(
    @Inject(TeamService) private readonly team: TeamService,
  ) {}

  /** 权限闸门：非成员直接 403（复用 cam 域守卫，不另写一套） */
  async requireMember(spaceId: string, userId: string) {
    return this.team.requireMember(spaceId, userId);
  }

  // ── 1. 画布总积分消耗 ────────────────────────────────────
  /**
   * 画布域的积分总消耗。参照产品是独立端点，因为它统计的是「画布节点任务」
   * 这一类消耗，和流水线（项目/剧集）分开看——团队排产时两条线的成本要拆开。
   *
   * 我方归类：`tasks` 里能追到 `task_events` 的 canvas 来源，或直接按
   * `capability` + 无 episode_id 判定。这里用可判定的口径：
   * 消耗流水中 `ref_task_id` 对应的 task 没有 `episode_id`（即非流水线任务）。
   */
  async canvasTotalPointConsume(spaceId: string, range?: { from?: string; to?: string }) {
    const conds = [
      eq(creditFlows.spaceId, BigInt(spaceId)),
      eq(creditFlows.kind, "settle"),
    ];
    if (range?.from) conds.push(gte(creditFlows.createdAt, new Date(range.from)));

    const [row] = await db
      .select({
        total: sql<number>`coalesce(sum(abs(${creditFlows.delta})), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(creditFlows)
      .innerJoin(tasks, eq(creditFlows.refTaskId, tasks.id))
      .where(and(...conds, sql`${tasks.episodeId} is null`));

    return {
      total_point: Number(row?.total ?? 0),
      task_count: Number(row?.count ?? 0),
      scope: "canvas",
      from: range?.from ?? null,
      to: range?.to ?? null,
    };
  }

  // ── 2. 团队基本信息 ──────────────────────────────────────
  async teamBasicInfo(spaceId: string) {
    const [space] = await db
      .select()
      .from(spaces)
      .where(eq(spaces.id, BigInt(spaceId)))
      .limit(1);
    if (!space) throw new AppError(ErrorCode.NOT_FOUND, "space not found");

    const [memberAgg] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${spaceMembers.status} = 1)::int`,
      })
      .from(spaceMembers)
      .where(eq(spaceMembers.spaceId, BigInt(spaceId)));

    const [acct] = await db
      .select({
        balance: creditAccounts.balance,
        frozen: creditAccounts.frozen,
      })
      .from(creditAccounts)
      .where(eq(creditAccounts.spaceId, BigInt(spaceId)))
      .limit(1);

    return {
      space_id: spaceId,
      name: space.name,
      type: space.type,
      max_seats: space.maxSeats ?? null,
      member_total: Number(memberAgg?.total ?? 0),
      member_active: Number(memberAgg?.active ?? 0),
      pool_balance: acct?.balance ?? 0,
      pool_frozen: acct?.frozen ?? 0,
      created_at: space.createdAt,
    };
  }

  // ── 3. 积分消耗排名 ──────────────────────────────────────
  /**
   * 按成员聚合消耗。
   *
   * 注意 `credit_flows` 本身**没有** "发起人" 列——它只有 `op_user_id`（操作者）
   * 和 `ref_user_id`（分配目标）。真正的消耗人要从 `tasks.user_id` 取，
   * 所以这里必须 join tasks（踩过一次：误用不存在的 `creditFlows.userId`）。
   */
  async pointConsumeRank(
    spaceId: string,
    opts: { from?: string; to?: string; limit?: number } = {},
  ) {
    const limit = Math.min(opts.limit ?? 20, 100);
    const conds = [eq(creditFlows.spaceId, BigInt(spaceId)), eq(creditFlows.kind, "settle")];
    if (opts.from) conds.push(gte(creditFlows.createdAt, new Date(opts.from)));

    const rows = await db
      .select({
        user_id: tasks.userId,
        consumed: sql<number>`coalesce(sum(abs(${creditFlows.delta})), 0)::int`,
        task_count: sql<number>`count(distinct ${creditFlows.refTaskId})::int`,
      })
      .from(creditFlows)
      .innerJoin(tasks, eq(creditFlows.refTaskId, tasks.id))
      .where(and(...conds))
      .groupBy(tasks.userId)
      .orderBy(desc(sql`sum(abs(${creditFlows.delta}))`))
      .limit(limit);

    const userIds = rows.map((r) => r.user_id);
    const members = userIds.length
      ? await db
          .select({
            userId: spaceMembers.userId,
            nickname: spaceMembers.nickname,
            roleCode: spaceMembers.roleCode,
            roleLevel: spaceMembers.roleLevel,
          })
          .from(spaceMembers)
          .where(
            and(eq(spaceMembers.spaceId, BigInt(spaceId)), inArray(spaceMembers.userId, userIds)),
          )
      : [];
    const byId = new Map(members.map((m) => [String(m.userId), m]));

    return {
      list: rows.map((r, i) => {
        const m = byId.get(String(r.user_id));
        return {
          rank: i + 1,
          user_id: String(r.user_id),
          nickname: m?.nickname ?? null,
          role_code: m?.roleCode ?? null,
          role_level: m?.roleLevel ?? null,
          consumed: Number(r.consumed),
          task_count: Number(r.task_count),
        };
      }),
      from: opts.from ?? null,
      to: opts.to ?? null,
    };
  }

  // ── 4. 成员参与明细 ──────────────────────────────────────
  async memberParticipateDetail(
    spaceId: string,
    opts: { page?: number; page_size?: number; from?: string; to?: string } = {},
  ) {
    const page = Math.max(opts.page ?? 1, 1);
    const pageSize = Math.min(opts.page_size ?? 20, 100);
    const offset = (page - 1) * pageSize;

    const conds = [eq(tasks.spaceId, BigInt(spaceId))];
    if (opts.from) conds.push(gte(tasks.createdAt, new Date(opts.from)));

    const rows = await db
      .select({
        user_id: tasks.userId,
        task_total: sql<number>`count(*)::int`,
        task_done: sql<number>`count(*) filter (where ${tasks.status} = 3)::int`,
        task_failed: sql<number>`count(*) filter (where ${tasks.status} = 4)::int`,
        last_active: sql<Date | null>`max(${tasks.createdAt})`,
        consumed: sql<number>`coalesce(sum(${tasks.creditsSettled}), 0)::int`,
      })
      .from(tasks)
      .where(and(...conds))
      .groupBy(tasks.userId)
      .orderBy(desc(sql`count(*)`))
      .limit(pageSize)
      .offset(offset);

    const [cnt] = await db
      .select({ n: sql<number>`count(distinct ${tasks.userId})::int` })
      .from(tasks)
      .where(and(...conds));

    const userIds = rows.map((r) => r.user_id);
    const members = userIds.length
      ? await db
          .select({
            userId: spaceMembers.userId,
            nickname: spaceMembers.nickname,
            roleCode: spaceMembers.roleCode,
            groupId: spaceMembers.groupId,
          })
          .from(spaceMembers)
          .where(
            and(eq(spaceMembers.spaceId, BigInt(spaceId)), inArray(spaceMembers.userId, userIds)),
          )
      : [];
    const byId = new Map(members.map((m) => [String(m.userId), m]));

    return {
      list: rows.map((r) => {
        const m = byId.get(String(r.user_id));
        return {
          user_id: String(r.user_id),
          nickname: m?.nickname ?? null,
          role_code: m?.roleCode ?? null,
          group_id: m?.groupId ? String(m.groupId) : null,
          task_total: Number(r.task_total),
          task_done: Number(r.task_done),
          task_failed: Number(r.task_failed),
          consumed: Number(r.consumed),
          last_active: r.last_active,
        };
      }),
      page,
      page_size: pageSize,
      count: Number(cnt?.n ?? 0),
      has_more: offset + rows.length < Number(cnt?.n ?? 0),
    };
  }

  // ── 5. 积分管理流水 ──────────────────────────────────────
  /** 分配/回收的成对流水（cam 域写，这里只读呈现） */
  async pointManageFlow(
    spaceId: string,
    opts: { page?: number; page_size?: number } = {},
  ) {
    const page = Math.max(opts.page ?? 1, 1);
    const pageSize = Math.min(opts.page_size ?? 20, 100);
    const offset = (page - 1) * pageSize;
    const conds = [
      eq(creditFlows.spaceId, BigInt(spaceId)),
      inArray(creditFlows.kind, ["adjust"]),
    ];

    const rows = await db
      .select({
        id: creditFlows.id,
        kind: creditFlows.kind,
        delta: creditFlows.delta,
        ref_user_id: creditFlows.refUserId,
        op_user_id: creditFlows.opUserId,
        group_id: creditFlows.groupId,
        memo: creditFlows.memo,
        balance_after: creditFlows.balanceAfter,
        created_at: creditFlows.createdAt,
      })
      .from(creditFlows)
      .where(and(...conds))
      .orderBy(desc(creditFlows.createdAt))
      .limit(pageSize)
      .offset(offset);

    const [cnt] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(creditFlows)
      .where(and(...conds));

    return {
      list: rows.map((r) => ({
        id: String(r.id),
        kind: r.kind,
        delta: r.delta,
        ref_user_id: r.ref_user_id ? String(r.ref_user_id) : null,
        op_user_id: r.op_user_id ? String(r.op_user_id) : null,
        group_id: r.group_id ? String(r.group_id) : null,
        memo: r.memo,
        balance_after: r.balance_after,
        created_at: r.created_at,
      })),
      page,
      page_size: pageSize,
      count: Number(cnt?.n ?? 0),
      has_more: offset + rows.length < Number(cnt?.n ?? 0),
    };
  }

  // ── 6. 项目数据概览 ──────────────────────────────────────
  /**
   * 按剧集（episode）聚合。参照产品的 project-data 是「项目粒度」；
   * 我方 project = script_projects，episode = 集。这里按 episode 聚合后再在
   * 上层归并，避免跨域 join（ADR-009：cam/kds 不依赖 script 表结构）。
   */
  async projectDataBasicInfo(spaceId: string, opts: { page?: number; page_size?: number } = {}) {
    const page = Math.max(opts.page ?? 1, 1);
    const pageSize = Math.min(opts.page_size ?? 20, 100);
    const offset = (page - 1) * pageSize;

    const rows = await db
      .select({
        episode_id: tasks.episodeId,
        task_total: sql<number>`count(*)::int`,
        task_done: sql<number>`count(*) filter (where ${tasks.status} = 3)::int`,
        task_failed: sql<number>`count(*) filter (where ${tasks.status} = 4)::int`,
        task_terminal: sql<number>`count(*) filter (where ${tasks.status} in (3,4,5,6))::int`,
        consumed: sql<number>`coalesce(sum(${tasks.creditsSettled}), 0)::int`,
      })
      .from(tasks)
      .where(and(eq(tasks.spaceId, BigInt(spaceId)), sql`${tasks.episodeId} is not null`))
      .groupBy(tasks.episodeId)
      .orderBy(desc(sql`count(*)`))
      .limit(pageSize)
      .offset(offset);

    return {
      list: rows.map((r) => {
        const terminal = Number(r.task_terminal);
        return {
          episode_id: r.episode_id ? String(r.episode_id) : null,
          task_total: Number(r.task_total),
          task_done: Number(r.task_done),
          task_failed: Number(r.task_failed),
          success_rate: terminal > 0 ? Number((Number(r.task_done) / terminal).toFixed(4)) : null,
          consumed: Number(r.consumed),
        };
      }),
      page,
      page_size: pageSize,
    };
  }

  // ── 7. 项目成员积分明细 ──────────────────────────────────
  async projectMemberPointDetail(spaceId: string, episodeId: string) {
    const rows = await db
      .select({
        user_id: tasks.userId,
        consumed: sql<number>`coalesce(sum(${tasks.creditsSettled}), 0)::int`,
        task_count: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .where(
        and(eq(tasks.spaceId, BigInt(spaceId)), eq(tasks.episodeId, BigInt(episodeId))),
      )
      .groupBy(tasks.userId)
      .orderBy(desc(sql`sum(${tasks.creditsSettled})`));

    return {
      episode_id: episodeId,
      list: rows.map((r) => ({
        user_id: String(r.user_id),
        consumed: Number(r.consumed),
        task_count: Number(r.task_count),
      })),
    };
  }

  // ── 8. 成员积分消耗明细 ──────────────────────────────────
  /**
   * 某成员的消耗流水明细。
   *
   * `credit_flows` 没有"发起人"列，消耗人只能从 `tasks.user_id` 取 → 必须 join。
   * 用 innerJoin 而不是 leftJoin：没有对应任务的结算流水（理论上不存在）不应
   * 出现在"某成员消耗明细"里，宁可少一条也不要错归到别人头上。
   */
  async memberPointConsumeDetail(
    spaceId: string,
    opUserId: string,
    opts: { page?: number; page_size?: number } = {},
  ) {
    const page = Math.max(opts.page ?? 1, 1);
    const pageSize = Math.min(opts.page_size ?? 20, 100);
    const offset = (page - 1) * pageSize;
    const conds = [
      eq(creditFlows.spaceId, BigInt(spaceId)),
      eq(tasks.userId, BigInt(opUserId)),
      eq(creditFlows.kind, "settle"),
    ];

    const rows = await db
      .select({
        id: creditFlows.id,
        delta: creditFlows.delta,
        ref_task_id: creditFlows.refTaskId,
        memo: creditFlows.memo,
        balance_after: creditFlows.balanceAfter,
        created_at: creditFlows.createdAt,
      })
      .from(creditFlows)
      .innerJoin(tasks, eq(creditFlows.refTaskId, tasks.id))
      .where(and(...conds))
      .orderBy(desc(creditFlows.createdAt))
      .limit(pageSize)
      .offset(offset);

    const [cnt] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(creditFlows)
      .innerJoin(tasks, eq(creditFlows.refTaskId, tasks.id))
      .where(and(...conds));

    return {
      user_id: opUserId,
      list: rows.map((r) => ({
        id: String(r.id),
        consumed: Math.abs(r.delta),
        ref_task_id: r.ref_task_id ? String(r.ref_task_id) : null,
        memo: r.memo,
        balance_after: r.balance_after,
        created_at: r.created_at,
      })),
      page,
      page_size: pageSize,
      count: Number(cnt?.n ?? 0),
      has_more: offset + rows.length < Number(cnt?.n ?? 0),
    };
  }

  // ── 9. 成员积分配额明细 ──────────────────────────────────
  /** 配额 = 已分配但未回收的上限（`space_members.credits_quota`），**不是余额** */
  async memberPointQuotaDetail(spaceId: string, opUserId: string) {
    const [m] = await db
      .select({
        quota: spaceMembers.creditsQuota,
        roleCode: spaceMembers.roleCode,
        groupId: spaceMembers.groupId,
        status: spaceMembers.status,
      })
      .from(spaceMembers)
      .where(
        and(eq(spaceMembers.spaceId, BigInt(spaceId)), eq(spaceMembers.userId, BigInt(opUserId))),
      )
      .limit(1);
    if (!m) throw new AppError(ErrorCode.NOT_FOUND, "member not found");

    // 已消耗：该成员发起的任务的 settle 流水（credit_flows 无 user_id，走 tasks join）
    const [consume] = await db
      .select({ n: sql<number>`coalesce(sum(abs(${creditFlows.delta})), 0)::int` })
      .from(creditFlows)
      .innerJoin(tasks, eq(creditFlows.refTaskId, tasks.id))
      .where(
        and(
          eq(creditFlows.spaceId, BigInt(spaceId)),
          eq(tasks.userId, BigInt(opUserId)),
          eq(creditFlows.kind, "settle"),
        ),
      );

    // 已分配：以该成员为 ref_user 的 adjust 正数
    const [allocated] = await db
      .select({ n: sql<number>`coalesce(sum(case when ${creditFlows.delta} > 0 then ${creditFlows.delta} else 0 end), 0)::int` })
      .from(creditFlows)
      .where(
        and(
          eq(creditFlows.spaceId, BigInt(spaceId)),
          eq(creditFlows.refUserId, BigInt(opUserId)),
          eq(creditFlows.kind, "adjust"),
        ),
      );

    const quota = m.quota;
    const allocatedTo = Number(allocated?.n ?? 0);
    return {
      user_id: opUserId,
      quota,
      allocated_total: allocatedTo,
      consumed_total: Number(consume?.n ?? 0),
      remaining: quota - Number(consume?.n ?? 0),
      role_code: m.roleCode,
      group_id: m.groupId ? String(m.groupId) : null,
      status: m.status,
    };
  }

  // ── 10. 团队查询（仪表盘聚合入口）────────────────────────
  /** 一次返回看板首屏需要的全部数字，避免前端连打 6 个请求 */
  async teamQuery(spaceId: string, opts: { from?: string; to?: string } = {}) {
    const [basic, rank, canvas, projectData] = await Promise.all([
      this.teamBasicInfo(spaceId),
      this.pointConsumeRank(spaceId, { from: opts.from, limit: 10 }),
      this.canvasTotalPointConsume(spaceId, opts),
      this.projectDataBasicInfo(spaceId, { page: 1, page_size: 10 }),
    ]);

    const [monthAgg] = await db
      .select({
        team_total: sql<number>`coalesce(sum(abs(${creditFlows.delta})), 0)::int`,
        task_count: sql<number>`count(distinct ${creditFlows.refTaskId})::int`,
      })
      .from(creditFlows)
      .where(
        and(
          eq(creditFlows.spaceId, BigInt(spaceId)),
          eq(creditFlows.kind, "settle"),
          opts.from ? gte(creditFlows.createdAt, new Date(opts.from)) : sql`true`,
        ),
      );

    return {
      basic,
      kpi: {
        total_consume: Number(monthAgg?.team_total ?? 0),
        task_count: Number(monthAgg?.task_count ?? 0),
        active_member: basic.member_active,
        project_count: projectData.list.length,
      },
      rank: rank.list,
      canvas,
      projects: projectData.list,
      from: opts.from ?? null,
      to: opts.to ?? null,
    };
  }

  // ── 11/12/13. 三个导出（CSV）────────────────────────────
  private toCsv(headers: string[], rows: Array<Array<string | number | null>>): string {
    const esc = (v: string | number | null) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  }

  /** 团队查询导出（成员维度） */
  async exportTeamQuery(spaceId: string) {
    const data = await this.pointConsumeRank(spaceId, { limit: 100 });
    const csv = this.toCsv(
      ["排名", "用户ID", "昵称", "角色", "消耗积分", "任务数"],
      data.list.map((r) => [r.rank, r.user_id, r.nickname, r.role_code, r.consumed, r.task_count]),
    );
    return { filename: "team-point-consume.csv", csv };
  }

  /** 项目数据导出（剧集维度） */
  async exportProjectData(spaceId: string) {
    const data = await this.projectDataBasicInfo(spaceId, { page: 1, page_size: 100 });
    const csv = this.toCsv(
      ["剧集ID", "任务数", "成功", "失败", "成功率", "消耗积分"],
      data.list.map((r) => [
        r.episode_id,
        r.task_total,
        r.task_done,
        r.task_failed,
        r.success_rate,
        r.consumed,
      ]),
    );
    return { filename: "project-data.csv", csv };
  }

  /** 积分管理流水导出 */
  async exportPointManageFlow(spaceId: string) {
    const data = await this.pointManageFlow(spaceId, { page: 1, page_size: 100 });
    const csv = this.toCsv(
      ["时间", "类型", "变动", "目标用户", "操作者", "分组", "余额后", "备注"],
      data.list.map((r) => [
        r.created_at ? new Date(r.created_at).toISOString() : "",
        r.kind,
        r.delta,
        r.ref_user_id,
        r.op_user_id,
        r.group_id,
        r.balance_after,
        r.memo,
      ]),
    );
    return { filename: "point-manage-flow.csv", csv };
  }
}
