import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * #7 团队的 **query 字段级**对账（第 95 批）。
 *
 * 为什么单开一个 spec：第 94 批在 #12 上证明了「端点全在、参数被静默丢弃」是一类
 * 守卫（只比 METHOD + path）看不见的真缺口 —— 请求返回 **200 + code 0 + 未过滤全集**，
 * 客户端以为筛选生效了。本文件把同一方法落到 cam：
 *
 * | 竞品端点 | 竞品 QUERY | 我方此前只收 |
 * |---|---|---|
 * | `cam/team/points-flow/{list,export}` | 10 个 | 6 个（缺时间范围 / op_type / 两个人名） |
 * | `cam/team/:id/members` + `member/export` | 11 个 | 5 个（缺 nick/remark/role_ids/has_group/include_descendants） |
 *
 * 三条红线（错了会静默给出错数据，比 400 更难查）：
 * 1. **筛出来的列表与导出的 CSV 必须是同一批人/同一批流水**（导出曾写死 100 行且忽略筛选）；
 * 2. **`include_descendants` 必须真展开子树**，否则分组筛选漏掉下级成员却显示"共 N 人"；
 * 3. **`op_user_account` 有意不接** —— `space_members.account` 是从未写入的死列，
 *    接了恒空；这条用断言钉住，防止下一批误以为是漏接又去接。
 */
describe("team query 字段级对账（第 95 批）", () => {
  let app: NestFastifyApplication;
  let seq = 0;
  const teamSpaceIds: bigint[] = [];
  const touchedUserIds: bigint[] = [];

  const mkId = (): bigint => {
    seq += 1;
    return BigInt(Date.now()) * 1000n + BigInt(seq);
  };

  const inject = async (
    method: string,
    url: string,
    payload?: unknown,
    authToken?: string,
    spaceId?: string,
  ) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    if (spaceId) headers["x-space-id"] = spaceId;
    const res = await app.inject({
      method: method as "GET" | "POST" | "PATCH" | "DELETE",
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let body: { code: number; msg: string; data?: unknown } = { code: -1, msg: "", data: null };
    try {
      body = JSON.parse(res.body) as { code: number; msg: string; data?: unknown };
    } catch {
      body = { code: -1, msg: res.body, data: null };
    }
    return { status: res.statusCode, code: body.code, msg: body.msg, data: body.data as never, raw: res.body };
  };

  async function loginNewUser(prefix: string): Promise<{ token: string; spaceId: string; userId: string }> {
    const tail = String(Date.now()).slice(-8);
    const tag = String(prefix).replace(/\D/g, "").slice(-2).padStart(2, "0");
    const phone = `1${tail}${tag}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code as string;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login.data as { access_token?: string; space_id?: string; user?: { id?: string } };
    const token = String(data?.access_token ?? "");
    const spaceId = String(data?.space_id ?? "");
    const userId = String(data?.user?.id ?? "");
    if (!token || !userId || userId === "undefined") {
      throw new Error(`login helper: bad body=${login.raw.slice(0, 200)}`);
    }
    touchedUserIds.push(BigInt(userId));
    return { token, spaceId, userId };
  }

  async function createTeamSpace(ownerUserId: string): Promise<bigint> {
    const teamId = mkId();
    await db.execute(sql`
      insert into spaces (id, owner_user_id, type, name, max_seats, status, agent_whitelist, film_enabled, created_at, updated_at)
      values (${teamId}, ${BigInt(ownerUserId)}, 2, 'query 测试团队', 20, 1, 0, 0, now(), now())
    `);
    await db.execute(sql`
      insert into credit_accounts (space_id, balance, frozen, updated_at)
      values (${teamId}, 10000, 0, now())
      on conflict (space_id) do update set balance = 10000, frozen = 0, updated_at = now()
    `);
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${teamId}, ${BigInt(ownerUserId)}, 1, 0, 1, 'master', now(), now())
      on conflict (space_id, user_id) do update set role = 1, role_code = 'master', status = 1
    `);
    teamSpaceIds.push(teamId);
    return teamId;
  }

  /** 直接塞成员行（绕过邀请），便于精确控制 nickname / remark / role_id / group_id */
  async function addMember(
    spaceId: bigint,
    userId: string,
    opts: { nickname: string; remark?: string; roleCode?: string; roleId?: bigint; groupId?: bigint },
  ) {
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, role_id, group_id, nickname, remark, created_at, updated_at)
      values (${spaceId}, ${BigInt(userId)}, 3, 0, 1, ${opts.roleCode ?? "animator"}, ${opts.roleId ?? null}, ${opts.groupId ?? null}, ${opts.nickname}, ${opts.remark ?? null}, now(), now())
      on conflict (space_id, user_id) do update
        set role_code = ${opts.roleCode ?? "animator"}, role_id = ${opts.roleId ?? null},
            group_id = ${opts.groupId ?? null}, nickname = ${opts.nickname}, remark = ${opts.remark ?? null}, status = 1
    `);
  }

  async function addGroup(spaceId: bigint, name: string, parentId?: bigint): Promise<bigint> {
    const gid = mkId();
    await db.execute(sql`
      insert into team_groups (id, space_id, parent_id, name, sort, status, created_at, updated_at)
      values (${gid}, ${spaceId}, ${parentId ?? null}, ${name}, 0, 1, now(), now())
    `);
    return gid;
  }

  /** 直接写一条流水行（team 级四类 kind 才在 points-flow 的取值域内） */
  async function addFlow(
    spaceId: bigint,
    opts: {
      kind: string;
      opUserId?: string;
      targetUserId?: string;
      groupId?: bigint;
      delta?: number;
      memo?: string;
      at?: Date;
    },
  ): Promise<bigint> {
    const fid = mkId();
    await db.execute(sql`
      insert into credit_flows (id, space_id, delta, frozen_delta, kind, ref_user_id, op_user_id, group_id, balance_after, memo, created_at)
      values (${fid}, ${spaceId}, ${opts.delta ?? 10}, 0, ${opts.kind},
              ${opts.targetUserId ? BigInt(opts.targetUserId) : null},
              ${opts.opUserId ? BigInt(opts.opUserId) : null},
              ${opts.groupId ?? null}, 100, ${opts.memo ?? "测试流水"}, ${opts.at ?? new Date()})
    `);
    return fid;
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
      logger: false,
    });
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    await app.useGlobalFilters(new AllExceptionsFilter()).init();
    await app.getHttpAdapter().getInstance().ready();
  }, 90_000);

  afterAll(async () => {
    if (teamSpaceIds.length > 0) {
      // 子先父后：team_roles 也挂 space（第一例建了自定义角色），必须先清它
      for (const sid of teamSpaceIds) {
        await db.execute(sql`delete from credit_flows where space_id = ${sid}`);
        await db.execute(sql`delete from space_members where space_id = ${sid}`);
        await db.execute(sql`delete from team_groups where space_id = ${sid}`);
        await db.execute(sql`delete from team_roles where space_id = ${sid}`);
        await db.execute(sql`delete from credit_accounts where space_id = ${sid}`);
        await db.execute(sql`delete from spaces where id = ${sid}`);
      }
    }
    await app.close();
    await pool.end().catch(() => {});
  });

  // ── 一、成员列表的 5 个新筛参 ──────────────────────────────

  it("成员列表：nick / remark / role_ids / has_group 真过滤（不是静默丢弃）", async () => {
    const owner = await loginNewUser("71");
    const team = await createTeamSpace(owner.userId);
    const role = mkId();
    await db.execute(sql`
      insert into team_roles (id, space_id, role_code, role_name, role_level, is_system, created_at, updated_at)
      values (${role}, ${team}, 'query_probe_role', '查询探针角色', 5, false, now(), now())
    `);

    const m1 = await loginNewUser("72");
    const m2 = await loginNewUser("73");
    const m3 = await loginNewUser("74");
    const groupA = await addGroup(team, "分组A");
    // m1：昵称唯一 + 有备注 + 有自定义角色 + 在组里
    await addMember(team, m1.userId, { nickname: "阿尔法", remark: "配音负责人", roleCode: "animator", roleId: role, groupId: groupA });
    // m2：昵称唯一 + 无备注 + 无组
    await addMember(team, m2.userId, { nickname: "贝塔", remark: "剪辑" });
    // m3：昵称唯一 + 无组
    await addMember(team, m3.userId, { nickname: "伽马" });

    const base = `/cam/team/members?page_size=100`;

    // 1) nick 模糊
    const byNick = await inject("GET", `${base}&nick=${encodeURIComponent("阿尔")}`, undefined, owner.token, String(team));
    expect(byNick.code).toBe(0);
    expect((byNick.data as { list: Array<{ user_id: string }> }).list.map((x) => x.user_id)).toEqual([m1.userId]);

    // 2) remark 模糊（"配音" 只命中 m1 的备注，不命中别人的昵称）
    const byRemark = await inject("GET", `${base}&remark=${encodeURIComponent("配音")}`, undefined, owner.token, String(team));
    expect((byRemark.data as { list: Array<{ user_id: string }> }).list.map((x) => x.user_id)).toEqual([m1.userId]);

    // 3) role_ids（自定义角色 id）
    const byRole = await inject("GET", `${base}&role_ids=${String(role)}`, undefined, owner.token, String(team));
    expect((byRole.data as { list: Array<{ user_id: string }> }).list.map((x) => x.user_id)).toEqual([m1.userId]);

    // 4) has_group=1 只命中在组里的；has_group=0 命中其余两个
    const withGroup = await inject("GET", `${base}&has_group=1`, undefined, owner.token, String(team));
    expect((withGroup.data as { list: Array<{ user_id: string }> }).list.map((x) => x.user_id)).toEqual([m1.userId]);
    const withoutGroup = await inject("GET", `${base}&has_group=0`, undefined, owner.token, String(team));
    const noGroupIds = (withoutGroup.data as { list: Array<{ user_id: string }> }).list.map((x) => x.user_id);
    expect(noGroupIds).toContain(m2.userId);
    expect(noGroupIds).toContain(m3.userId);
    expect(noGroupIds).not.toContain(m1.userId);

    // 5) total 与 list 同口径（列表 join/where 与 count 必须一致）
    expect((byNick.data as { total: number }).total).toBe(1);

    // 6) account 有意不接：传了也应被忽略（`space_members.account` 是从未写入的死列），
    //    返回条数不受影响 —— 这条断言防止下一批"顺手补上"一个恒空过滤器
    const byAccount = await inject("GET", `${base}&account=${encodeURIComponent("13800000000")}`, undefined, owner.token, String(team));
    expect(byAccount.code).toBe(0);
    expect((byAccount.data as { list: unknown[] }).list.length).toBeGreaterThanOrEqual(2);
  });

  it("include_descendants：分组筛选真的展开子树（否则漏下级却显示共 N 人）", async () => {
    const owner = await loginNewUser("75");
    const team = await createTeamSpace(owner.userId);
    const root = await addGroup(team, "根分组");
    const child = await addGroup(team, "子分组", root);
    const grandchild = await addGroup(team, "孙分组", child);

    const inRoot = await loginNewUser("76");
    const inChild = await loginNewUser("77");
    const inGrand = await loginNewUser("78");
    await addMember(team, inRoot.userId, { nickname: "根成员", groupId: root });
    await addMember(team, inChild.userId, { nickname: "子成员", groupId: child });
    await addMember(team, inGrand.userId, { nickname: "孙成员", groupId: grandchild });

    // 只给 group_id：只命中直属
    const direct = await inject("GET", `/cam/team/members?group_id=${String(root)}&page_size=100`, undefined, owner.token, String(team));
    expect((direct.data as { list: Array<{ user_id: string }> }).list.map((x) => x.user_id)).toEqual([inRoot.userId]);
    expect((direct.data as { total: number }).total).toBe(1);

    // include_descendants=1：三级全收（根 + 子 + 孙）
    const deep = await inject(
      "GET",
      `/cam/team/members?group_id=${String(root)}&include_descendants=1&page_size=100`,
      undefined,
      owner.token,
      String(team),
    );
    const deepIds = (deep.data as { list: Array<{ user_id: string }> }).list.map((x) => x.user_id);
    expect(deepIds).toContain(inRoot.userId);
    expect(deepIds).toContain(inChild.userId);
    expect(deepIds).toContain(inGrand.userId);
    // total 必须跟着展开后的结果走（不能还是 1）
    expect((deep.data as { total: number }).total).toBe(3);

    // 从子分组往下只该收 子 + 孙（不含根）
    const mid = await inject(
      "GET",
      `/cam/team/members?group_id=${String(child)}&include_descendants=1&page_size=100`,
      undefined,
      owner.token,
      String(team),
    );
    const midIds = (mid.data as { list: Array<{ user_id: string }> }).list.map((x) => x.user_id);
    expect(midIds).toEqual([inGrand.userId, inChild.userId].sort((a, b) => midIds.indexOf(a) - midIds.indexOf(b)));
    expect(midIds).not.toContain(inRoot.userId);
    expect(midIds.length).toBe(2);
  });

  it("成员导出与列表同口径：筛出来什么就导出什么（此前写死 100 行且忽略筛选）", async () => {
    const owner = await loginNewUser("79");
    const team = await createTeamSpace(owner.userId);
    const target = await loginNewUser("80");
    const other = await loginNewUser("81");
    await addMember(team, target.userId, { nickname: "导出目标甲" });
    await addMember(team, other.userId, { nickname: "导出目标乙" });

    const nick = encodeURIComponent("导出目标甲");
    const listRes = await inject("GET", `/cam/team/members?nick=${nick}&page_size=100`, undefined, owner.token, String(team));
    expect((listRes.data as { total: number }).total).toBe(1);

    const csvRes = await app.inject({
      method: "GET",
      url: `/v1/cam/team/member/export?nick=${nick}`,
      headers: { authorization: `Bearer ${owner.token}`, "x-space-id": String(team) },
    });
    expect(csvRes.statusCode).toBe(200);
    expect(csvRes.headers["content-type"]).toContain("text/csv");
    const csv = csvRes.body;
    // BOM + 表头
    expect(csv.startsWith("\uFEFF")).toBe(true);
    // 只含被筛中的那个人，另一个人不能出现在 CSV 里
    expect(csv).toContain(target.userId);
    expect(csv).not.toContain(other.userId);
    // 行数 = 表头 + 1
    const lines = csv.replace(/^\uFEFF/, "").trim().split("\n");
    expect(lines.length).toBe(2);
  });

  // ── 二、流水的 4 个新筛参 ──────────────────────────────────

  it("团队流水：时间范围 / op_type / op_user_name / target_user_name 真过滤", async () => {
    const owner = await loginNewUser("82");
    const team = await createTeamSpace(owner.userId);
    const opA = await loginNewUser("83");
    const tgtA = await loginNewUser("84");
    const opB = await loginNewUser("85");
    const tgtB = await loginNewUser("86");
    // 名字来自 users.nickname（join users），先设好
    await db.execute(sql`update users set nickname = '操作者甲' where id = ${BigInt(opA.userId)}`);
    await db.execute(sql`update users set nickname = '操作者乙' where id = ${BigInt(opB.userId)}`);

    const old = new Date("2020-01-01T00:00:00Z");
    const recent = new Date();
    const fOld = await addFlow(team, { kind: "team_allocate_out", opUserId: opA.userId, targetUserId: tgtA.userId, memo: "旧流水", at: old });
    const fNew = await addFlow(team, { kind: "team_allocate_out", opUserId: opB.userId, targetUserId: tgtB.userId, memo: "新流水", at: recent });

    const listUrl = (qs: string) => `/cam/team/points-flow/list?page_size=100&${qs}`;
    const ids = (r: { data: unknown }) => (r.data as { list: Array<{ id: string }> }).list.map((x) => x.id);

    // 1) 时间下界：只留新的
    const after = await inject("GET", listUrl(`create_time_start=${encodeURIComponent("2024-01-01T00:00:00Z")}`), undefined, owner.token, String(team));
    expect(after.code).toBe(0);
    expect(ids(after)).toEqual([String(fNew)]);

    // 2) 时间上界：只留旧的
    const before = await inject("GET", listUrl(`create_time_end=${encodeURIComponent("2021-01-01T00:00:00Z")}`), undefined, owner.token, String(team));
    expect(ids(before)).toEqual([String(fOld)]);

    // 3) op_type 等价于 kind（同一列两个名字）
    const byOpType = await inject("GET", listUrl("op_type=team_allocate_out"), undefined, owner.token, String(team));
    expect(ids(byOpType).length).toBe(2);
    const byOtherKind = await inject("GET", listUrl("op_type=team_recover_out"), undefined, owner.token, String(team));
    expect(ids(byOtherKind)).toEqual([]);

    // 3b) kind 与 op_type 冲突 → 400101（不能静默取其一）
    const conflict = await inject("GET", listUrl("kind=team_allocate_out&op_type=team_recover_out"), undefined, owner.token, String(team));
    expect(conflict.code).toBe(400101);
    expect(conflict.msg).toContain("op_type");

    // 4) op_user_name 模糊（join users.nickname）
    const byOp = await inject("GET", listUrl(`op_user_name=${encodeURIComponent("操作者甲")}`), undefined, owner.token, String(team));
    expect(ids(byOp)).toEqual([String(fOld)]);
    const byOpNone = await inject("GET", listUrl(`op_user_name=${encodeURIComponent("查无此人")}`), undefined, owner.token, String(team));
    expect(ids(byOpNone)).toEqual([]);

    // 5) 导出与列表同口径：同一个筛选，导出 1 行
    const exp = await inject(
      "GET",
      `/cam/team/points-flow/export?op_user_name=${encodeURIComponent("操作者甲")}`,
      undefined,
      owner.token,
      String(team),
    );
    expect(exp.code).toBe(0);
    expect((exp.data as { row_count: number }).row_count).toBe(1);
  });

  it("target_user_name 走 space_members 昵称快照（不是 users 昵称）", async () => {
    const owner = await loginNewUser("87");
    const team = await createTeamSpace(owner.userId);
    const tgtA = await loginNewUser("88");
    const tgtB = await loginNewUser("89");
    // 成员快照昵称
    await addMember(team, tgtA.userId, { nickname: "目标阿尔法" });
    await addMember(team, tgtB.userId, { nickname: "目标贝塔" });
    // users.nickname 故意设成别的，证明筛选走的是 space_members 而非 users
    await db.execute(sql`update users set nickname = '用户表里的甲' where id = ${BigInt(tgtA.userId)}`);

    const fA = await addFlow(team, { kind: "team_allocate_out", opUserId: owner.userId, targetUserId: tgtA.userId });
    const fB = await addFlow(team, { kind: "team_allocate_out", opUserId: owner.userId, targetUserId: tgtB.userId });

    const byTarget = await inject(
      "GET",
      `/cam/team/points-flow/list?page_size=100&target_user_name=${encodeURIComponent("目标阿尔法")}`,
      undefined,
      owner.token,
      String(team),
    );
    expect(byTarget.code).toBe(0);
    expect((byTarget.data as { list: Array<{ id: string }> }).list.map((x) => x.id)).toEqual([String(fA)]);
    // 用 users.nickname 的写法搜不到（证明用的是成员快照列）
    const byUsersNick = await inject(
      "GET",
      `/cam/team/points-flow/list?page_size=100&target_user_name=${encodeURIComponent("用户表里的甲")}`,
      undefined,
      owner.token,
      String(team),
    );
    expect((byUsersNick.data as { list: unknown[] }).list).toEqual([]);
    void fB;
  });
});
