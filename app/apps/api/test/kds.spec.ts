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
 * 数据看板（kds/da）契约测试 —— 对照参照产品 `/web/v1/kds/da/*` 13 端点。
 *
 * 重点验证四件事（这四件错了看板数字就不可信）：
 *
 * 1. **空数据不能 500**：新团队/新成员没有任何流水时必须返回 0 与空列表，
 *    不是抛异常（这是聚合接口最常见的线上事故）。
 * 2. **排名顺序正确**：按消耗降序，rank 从 1 连续递增。
 * 3. **只看本 space**：另一个团队的消耗不能串进来（多租户隔离红线）。
 * 4. **非成员 403**：不是该 space 成员一律拒，且 team_id 与 token 空间不一致时也拒。
 *
 * 口径注意：`credit_flows` **没有 user_id 列**。消耗人只能从 `tasks.user_id` 取，
 * 所以凡是"按人聚合"的查询都必须 join tasks。本测试刻意造了"流水存在但任务
 * 属于别人"的场景，验证不会错归。
 */
describe("kds/dashboard e2e", () => {
  let app: NestFastifyApplication;
  let seq = 0;

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
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      body = { raw: res.body };
    }
    // 统一信封（api-spec §1）：成功 {code:0,data}；业务错误 HTTP 200 + code≠0
    return {
      status: res.statusCode,
      code: (body as { code?: number }).code ?? -1,
      msg: (body as { msg?: string }).msg ?? "",
      body,
      data: (body as { data?: unknown }).data,
    };
  };

  async function loginNewUser(prefix: string): Promise<{ token: string; spaceId: string; userId: string }> {
    const tail = String(Date.now()).slice(-8);
    const tag = String(prefix).replace(/\D/g, "").slice(-2).padStart(2, "0");
    const phone = `1${tail}${tag}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = login.data as { access_token?: string; space_id?: string; user?: { id?: string } } | undefined;
    return {
      token: data?.access_token ?? "",
      spaceId: String(data?.space_id ?? ""),
      userId: String(data?.user?.id ?? ""),
    };
  }

  /** 建团队空间 + owner（spaces.type=2，ADR-010：不新建 teams 表） */
  async function createTeam(ownerUserId: string, name = "看板测试团队") {
    seq += 1;
    const idRow = (await db.execute(
      sql`select (extract(epoch from clock_timestamp())*1000000)::bigint as id`,
    )) as { rows?: Array<{ id: string }> };
    const teamId = BigInt(idRow.rows?.[0]?.id ?? Date.now()) * 1000n + BigInt(seq);
    await db.execute(sql`
      insert into spaces (id, owner_user_id, type, name, max_seats, status, agent_whitelist, film_enabled, created_at, updated_at)
      values (${teamId}, ${BigInt(ownerUserId)}, 2, ${name}, 10, 1, 0, 0, now(), now())
    `);
    await db.execute(sql`
      insert into credit_accounts (space_id, balance, frozen, updated_at)
      values (${teamId}, 0, 0, now())
      on conflict (space_id) do update set updated_at = now()
    `);
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${teamId}, ${BigInt(ownerUserId)}, 1, 0, 1, 'master', now(), now())
      on conflict (space_id, user_id) do update set role = 1, role_code = 'master', status = 1
    `);
    return { teamSpaceId: String(teamId), teamId };
  }

  async function addMember(teamSpaceId: string, userId: string, roleCode = "animator", quota = 0) {
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${BigInt(teamSpaceId)}, ${BigInt(userId)}, 3, ${quota}, 1, ${roleCode}, now(), now())
      on conflict (space_id, user_id) do update set status = 1, role_code = ${roleCode}, credits_quota = ${quota}
    `);
  }

  /**
   * 造一条"已结算"的消耗：task（记 user_id）+ settle 流水（记 ref_task_id）。
   * 这是 kds 所有按人聚合的数据来源形状。
   */
  async function seedConsume(opts: {
    spaceId: string;
    userId: string;
    credits: number;
    episodeId?: string | null;
    status?: number;
  }) {
    seq += 1;
    const idRow = (await db.execute(
      sql`select (extract(epoch from clock_timestamp())*1000000)::bigint as id`,
    )) as { rows?: Array<{ id: string }> };
    const base = BigInt(idRow.rows?.[0]?.id ?? Date.now()) * 1000n + BigInt(seq);
    const taskId = base;
    // 需要一个合法 model_id：取目录里任意一条
    const m = (await db.execute(sql`select id from models limit 1`)) as { rows?: Array<{ id: string }> };
    const modelId = BigInt(m.rows?.[0]?.id ?? "1");
    await db.execute(sql`
      insert into tasks (id, space_id, user_id, episode_id, attempt_no, capability, mode, model_id,
                         input, options, status, progress, credits_frozen, credits_settled, created_at, updated_at)
      values (${taskId}, ${BigInt(opts.spaceId)}, ${BigInt(opts.userId)},
              ${opts.episodeId ? BigInt(opts.episodeId) : null}, 1, 'video', 'text2video', ${modelId},
              '{"prompt":"kds test"}'::jsonb, '{}'::jsonb, ${opts.status ?? 3}, 100, ${opts.credits}, ${opts.credits}, now(), now())
    `);
    await db.execute(sql`
      insert into credit_flows (id, space_id, delta, frozen_delta, kind, ref_task_id, balance_after, memo, created_at)
      values (${base + 1n}, ${BigInt(opts.spaceId)}, ${-opts.credits}, 0, 'settle', ${taskId}, 0, 'kds test consume', now())
    `);
    return { taskId: String(taskId) };
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
      logger: false,
    });
    await app.register(cookie);
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await pool.end().catch(() => {});
  });

  // ── 空数据 ───────────────────────────────────────────────
  it("空团队：排名/明细/看板聚合都返回 0 与空列表，不 500", async () => {
    const owner = await loginNewUser("81");
    const { teamSpaceId } = await createTeam(owner.userId, "空数据团队");

    const rank = await inject("GET", `/kds/da/team/${teamSpaceId}/point-consume-rank`, undefined, owner.token, teamSpaceId);
    expect(rank.status).toBe(200);
    expect((rank.data as { list: unknown[] }).list).toEqual([]);

    const participate = await inject(
      "GET",
      `/kds/da/team/${teamSpaceId}/member-participate-detail`,
      undefined,
      owner.token,
      teamSpaceId,
    );
    expect(participate.status).toBe(200);
    expect((participate.data as { list: unknown[]; count: number }).list).toEqual([]);
    expect((participate.data as { count: number }).count).toBe(0);

    const query = await inject("GET", `/kds/da/team/${teamSpaceId}/query`, undefined, owner.token, teamSpaceId);
    expect(query.status).toBe(200);
    const q = query.data as { kpi: { total_consume: number; task_count: number }; rank: unknown[] };
    expect(q.kpi.total_consume).toBe(0);
    expect(q.kpi.task_count).toBe(0);
    expect(q.rank).toEqual([]);

    const canvas = await inject("GET", "/kds/da/canvas/total-point-consume", undefined, owner.token, teamSpaceId);
    expect(canvas.status).toBe(200);
    expect((canvas.data as { total_point: number }).total_point).toBe(0);
  });

  // ── 排名顺序 ─────────────────────────────────────────────
  it("排名按消耗降序、rank 从 1 连续；消耗人从 tasks.user_id 取（credit_flows 无该列）", async () => {
    const owner = await loginNewUser("82");
    const a = await loginNewUser("83");
    const b = await loginNewUser("84");
    const { teamSpaceId } = await createTeam(owner.userId, "排名团队");
    await addMember(teamSpaceId, a.userId, "animator");
    await addMember(teamSpaceId, b.userId, "editor");

    // a 消耗 30（两笔），b 消耗 10，owner 消耗 5
    await seedConsume({ spaceId: teamSpaceId, userId: a.userId, credits: 20 });
    await seedConsume({ spaceId: teamSpaceId, userId: a.userId, credits: 10 });
    await seedConsume({ spaceId: teamSpaceId, userId: b.userId, credits: 10 });
    await seedConsume({ spaceId: teamSpaceId, userId: owner.userId, credits: 5 });

    const res = await inject("GET", `/kds/da/team/${teamSpaceId}/point-consume-rank`, undefined, owner.token, teamSpaceId);
    expect(res.status).toBe(200);
    const list = (res.data as { list: Array<{ rank: number; user_id: string; consumed: number; task_count: number }> }).list;
    expect(list.length).toBe(3);
    expect(list.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(list[0]!.user_id).toBe(a.userId);
    expect(list[0]!.consumed).toBe(30);
    expect(list[0]!.task_count).toBe(2);
    // 严格降序
    for (let i = 1; i < list.length; i += 1) {
      expect(list[i - 1]!.consumed).toBeGreaterThanOrEqual(list[i]!.consumed);
    }
  });

  // ── 多租户隔离 ───────────────────────────────────────────
  it("只看本 space：另一团队的消耗不串进来", async () => {
    const owner1 = await loginNewUser("85");
    const owner2 = await loginNewUser("86");
    const t1 = await createTeam(owner1.userId, "团队一");
    const t2 = await createTeam(owner2.userId, "团队二");

    await seedConsume({ spaceId: t1.teamSpaceId, userId: owner1.userId, credits: 100 });
    await seedConsume({ spaceId: t2.teamSpaceId, userId: owner2.userId, credits: 7 });

    const r1 = await inject(
      "GET",
      `/kds/da/team/${t1.teamSpaceId}/point-consume-rank`,
      undefined,
      owner1.token,
      t1.teamSpaceId,
    );
    const r2 = await inject(
      "GET",
      `/kds/da/team/${t2.teamSpaceId}/point-consume-rank`,
      undefined,
      owner2.token,
      t2.teamSpaceId,
    );

    const list1 = (r1.data as { list: Array<{ consumed: number }> }).list;
    const list2 = (r2.data as { list: Array<{ consumed: number }> }).list;
    expect(list1.length).toBe(1);
    expect(list1[0]!.consumed).toBe(100);
    expect(list2.length).toBe(1);
    expect(list2[0]!.consumed).toBe(7);
  });

  // ── 权限 ─────────────────────────────────────────────────
  it("非成员访问被拒（403101）；team_id 与 token 空间不一致也被拒", async () => {
    const owner = await loginNewUser("87");
    const outsider = await loginNewUser("88");
    const { teamSpaceId } = await createTeam(owner.userId, "权限团队");

    // 外人访问别人的团队看板：业务错误走信封（HTTP 200 + code=403101），与全站一致
    const denied = await inject(
      "GET",
      `/kds/da/team/${teamSpaceId}/basic-info`,
      undefined,
      outsider.token,
    );
    expect(denied.code).toBe(403101);

    // 本人是 A 空间成员，却在路径里写 B 空间 → 同样 403101（不能靠路径参数越权）
    const mismatch = await inject(
      "GET",
      `/kds/da/team/999999999/point-consume-rank`,
      undefined,
      owner.token,
      owner.spaceId,
    );
    expect(mismatch.code).toBe(403101);
  });

  // ── 参与者明细 / 消耗明细 / 配额 ─────────────────────────
  it("成员参与明细含任务数与成功率；消耗明细可追到 ref_task_id", async () => {
    const owner = await loginNewUser("89");
    const u = await loginNewUser("90");
    const { teamSpaceId } = await createTeam(owner.userId, "明细团队");
    await addMember(teamSpaceId, u.userId, "animator", 500);

    const { taskId } = await seedConsume({ spaceId: teamSpaceId, userId: u.userId, credits: 12 });
    await seedConsume({ spaceId: teamSpaceId, userId: u.userId, credits: 8, status: 4 });

    const part = await inject(
      "GET",
      `/kds/da/team/${teamSpaceId}/member-participate-detail`,
      undefined,
      owner.token,
      teamSpaceId,
    );
    expect(part.status).toBe(200);
    const row = (
      part.data as { list: Array<{ user_id: string; task_total: number; task_done: number; task_failed: number }> }
    ).list.find((x) => x.user_id === u.userId);
    expect(row?.task_total).toBe(2);
    expect(row?.task_done).toBe(1);
    expect(row?.task_failed).toBe(1);

    const detail = await inject(
      "GET",
      `/kds/da/team/member/${u.userId}/point-consume-detail`,
      undefined,
      owner.token,
      teamSpaceId,
    );
    expect(detail.status).toBe(200);
    const flows = (detail.data as { list: Array<{ ref_task_id: string | null; consumed: number }> }).list;
    expect(flows.length).toBe(2);
    expect(flows.some((f) => f.ref_task_id === taskId)).toBe(true);
    expect(flows.reduce((s, f) => s + f.consumed, 0)).toBe(20);

    const quota = await inject(
      "GET",
      `/kds/da/team/member/${u.userId}/point-quota-detail`,
      undefined,
      owner.token,
      teamSpaceId,
    );
    expect(quota.status).toBe(200);
    const qd = quota.data as { quota: number; consumed_total: number; remaining: number };
    expect(qd.quota).toBe(500);
    expect(qd.consumed_total).toBe(20);
    expect(qd.remaining).toBe(480);
  });

  // ── 项目数据 / 导出 ──────────────────────────────────────
  it("项目数据按剧集聚合，成功率只算终态；导出返回 text/csv", async () => {
    const owner = await loginNewUser("91");
    const { teamSpaceId, teamId } = await createTeam(owner.userId, "项目数据团队");

    seq += 1;
    const epRow = (await db.execute(
      sql`select (extract(epoch from clock_timestamp())*1000000)::bigint as id`,
    )) as { rows?: Array<{ id: string }> };
    const episodeId = (BigInt(epRow.rows?.[0]?.id ?? Date.now()) * 1000n + BigInt(seq)).toString();

    await seedConsume({ spaceId: teamSpaceId, userId: owner.userId, credits: 5, episodeId });
    await seedConsume({ spaceId: teamSpaceId, userId: owner.userId, credits: 5, episodeId });
    await seedConsume({ spaceId: teamSpaceId, userId: owner.userId, credits: 5, episodeId, status: 4 });

    const proj = await inject(
      "GET",
      `/kds/da/team/${teamSpaceId}/project-data/basic-info`,
      undefined,
      owner.token,
      teamSpaceId,
    );
    expect(proj.status).toBe(200);
    const pRow = (
      proj.data as { list: Array<{ episode_id: string; task_total: number; task_done: number; success_rate: number }> }
    ).list.find((x) => x.episode_id === episodeId);
    expect(pRow?.task_total).toBe(3);
    expect(pRow?.task_done).toBe(2);
    // 成功率 = 成功 / 终态 = 2/3
    expect(pRow?.success_rate).toBeCloseTo(0.6667, 3);

    const csv = await app.inject({
      method: "GET",
      url: `/v1/kds/da/team/${teamId}/project-data/export`,
      headers: { authorization: `Bearer ${owner.token}`, "x-space-id": teamSpaceId },
    });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain("project-data.csv");
    expect(csv.body).toContain("剧集ID");
  });
});
