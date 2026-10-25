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
 * cam 团队域契约测试（F1 契约 §12.3 / §14.5，ADR-010/011）
 *
 * 重点验证三件事（这三件错了会静默腐化数据）：
 * 1. 团队 = spaces(type=2)，不另建表（ADR-010）
 * 2. 团队积分池 = space 级 credit_accounts；分配/回收**成对**记账，
 *    全系统 `balance == Σdelta` 与 `frozen == Σ frozen_delta` 双不变式不破（ADR-011）
 * 3. `role_level` 不是单调特权轴：特权按码集判（§12.3.1 红线）
 */
describe("team (cam) e2e", () => {
  let app: NestFastifyApplication;
  let uid = 0;

  const inject = async (method: string, url: string, payload?: unknown, authToken?: string) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    const res = await app.inject({
      method: method as "GET" | "POST" | "PATCH" | "DELETE",
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = JSON.parse(res.body);
    return { status: res.statusCode, ...body, body };
  };

  async function loginNewUser(prefix: string): Promise<{ token: string; spaceId: string; userId: string }> {
    // 手机号必须匹配 ^1\d{10}（11 位、以 1 开头）：
    // 用 1 + 时间戳后 8 位 + prefix 后 2 位（保证不同 prefix 不撞号）
    const tail = String(Date.now()).slice(-8);
    const tag = String(prefix).replace(/\D/g, "").slice(-2).padStart(2, "0");
    const phone = `1${tail}${tag}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = sms.data?.debug_code as string;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const token = login.data?.access_token as string;
    const spaceId = String(login.data?.space_id ?? "");
    const userId = String(login.data?.user?.id ?? "");
    if (!userId || userId === "undefined") {
      throw new Error(`login helper: missing user.id, got body=${JSON.stringify(login.body).slice(0, 200)}`);
    }
    return { token, spaceId, userId };
  }

  /** 建立团队空间（spaces.type=2）+ owner 成员（ADR-010：不新建 teams 表） */
  async function createTeam(ownerUserId: string): Promise<{ teamSpaceId: string }> {
    const idRow = (await db.execute(sql`select (extract(epoch from clock_timestamp())*1000000)::bigint as id`)) as {
      rows?: Array<{ id: string }>;
    };
    const base = BigInt(idRow.rows?.[0]?.id ?? Date.now());
    const teamId = base * 1000n + BigInt(Math.floor(Math.random() * 1000));
    await db.execute(sql`
      insert into spaces (id, owner_user_id, type, name, max_seats, status, agent_whitelist, film_enabled, created_at, updated_at)
      values (${teamId}, ${BigInt(ownerUserId)}, 2, '测试团队', 3, 1, 0, 0, now(), now())
    `);
    await db.execute(sql`
      insert into credit_accounts (space_id, balance, frozen, updated_at)
      values (${teamId}, 1000, 0, now())
      on conflict (space_id) do update set balance = 1000, frozen = 0, updated_at = now()
    `);
    // 关键：注资必须配一条流水，否则 `balance == Σdelta` 不变式从一开始就是假的
    // （本测试随后要验证转账保持该不变式，seed 必须先自洽）
    await db.execute(sql`
      insert into credit_flows (id, space_id, delta, frozen_delta, kind, balance_after, memo, created_at)
      values (${BigInt(Date.now()) * 1000n + 7n}, ${teamId}, 1000, 0, 'recharge', 1000, '测试注资', now())
    `);
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${teamId}, ${BigInt(ownerUserId)}, 1, 0, 1, 'master', now(), now())
      on conflict (space_id, user_id) do update set role = 1, role_code = 'master', status = 1
    `);
    return { teamSpaceId: String(teamId) };
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
    uid = Date.now();
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await pool.end().catch(() => {});
  });

  it("团队空间不是新表：spaces(type=2) 即团队（ADR-010）", async () => {
    const owner = await loginNewUser("71");
    const { teamSpaceId } = await createTeam(owner.userId);
    // 用 owner 的 token + 切 space：这里通过 header 无法切，直接验证数据层
    const rows = (await db.execute(sql`
      select id, type, max_seats, film_enabled from spaces where id = ${BigInt(teamSpaceId)}
    `)) as { rows?: Array<{ type: number; max_seats: number; film_enabled: number }> };
    expect(rows.rows?.[0]?.type).toBe(2);
    expect(rows.rows?.[0]?.max_seats).toBe(3);
  });

  it("分配/回收集成对记账：全系统 Σdelta 与 Σfrozen_delta 守恒（ADR-011 核心）", async () => {
    const owner = await loginNewUser("72");
    const member = await loginNewUser("73");
    const { teamSpaceId } = await createTeam(owner.userId);

    // 加入成员到团队
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${BigInt(teamSpaceId)}, ${BigInt(member.userId)}, 3, 0, 1, 'animator', now(), now())
      on conflict (space_id, user_id) do nothing
    `);

    // 记录操作前的全系统基线与两个账户
    const before = (await db.execute(sql`
      select
        coalesce(sum(delta),0)::bigint as sum_delta,
        coalesce(sum(frozen_delta),0)::bigint as sum_frozen
      from credit_flows
    `)) as { rows?: Array<{ sum_delta: string; sum_frozen: string }> };
    const beforeDelta = BigInt(before.rows?.[0]?.sum_delta ?? "0");
    const beforeFrozen = BigInt(before.rows?.[0]?.sum_frozen ?? "0");

    const teamAccBefore = (await db.execute(sql`
      select balance from credit_accounts where space_id = ${BigInt(teamSpaceId)}
    `)) as { rows?: Array<{ balance: number }> };
    const memberSpace = (await db.execute(sql`
      select id from spaces where owner_user_id = ${BigInt(member.userId)} and type = 1
    `)) as { rows?: Array<{ id: string }> };
    const memberSpaceId = memberSpace.rows?.[0]?.id;
    expect(memberSpaceId).toBeTruthy();
    const memberAccBefore = (await db.execute(sql`
      select balance from credit_accounts where space_id = ${BigInt(memberSpaceId!)}
    `)) as { rows?: Array<{ balance: number }> };

    const teamBal0 = teamAccBefore.rows?.[0]?.balance ?? 0;
    const memberBal0 = memberAccBefore.rows?.[0]?.balance ?? 0;

    // 直接调用服务（避免依赖 header 切 space 的额外机制）
    const { TeamService } = await import("../src/modules/team/team.service");
    const svc = app.get(TeamService);

    const alloc = await svc.allocate(teamSpaceId, owner.userId, { user_id: member.userId, amount: 250 });
    expect(alloc.team_balance).toBe(teamBal0 - 250);
    expect(alloc.member_balance).toBe(memberBal0 + 250);

    // 关键：全系统 Σdelta 不变（成对转账互相抵消）
    const after = (await db.execute(sql`
      select
        coalesce(sum(delta),0)::bigint as sum_delta,
        coalesce(sum(frozen_delta),0)::bigint as sum_frozen
      from credit_flows
    `)) as { rows?: Array<{ sum_delta: string; sum_frozen: string }> };
    expect(BigInt(after.rows?.[0]?.sum_delta ?? "0")).toBe(beforeDelta);
    expect(BigInt(after.rows?.[0]?.sum_frozen ?? "0")).toBe(beforeFrozen);

    // 反向回收，同样守恒
    const rec = await svc.recover(teamSpaceId, owner.userId, { user_id: member.userId, amount: 100 });
    expect(rec.team_balance).toBe(teamBal0 - 150);
    expect(rec.member_balance).toBe(memberBal0 + 150);

    const after2 = (await db.execute(sql`
      select coalesce(sum(delta),0)::bigint as sum_delta from credit_flows
    `)) as { rows?: Array<{ sum_delta: string }> };
    expect(BigInt(after2.rows?.[0]?.sum_delta ?? "0")).toBe(beforeDelta);

    // 每个账户的 balance 仍等于它自己的 Σdelta（单账户不变式）
    const check = (await db.execute(sql`
      select a.space_id, a.balance, coalesce(sum(f.delta),0)::bigint as sum_delta
      from credit_accounts a
      left join credit_flows f on f.space_id = a.space_id
      where a.space_id in (${BigInt(teamSpaceId)}, ${BigInt(memberSpaceId!)})
      group by a.space_id, a.balance
    `)) as { rows?: Array<{ space_id: string; balance: number; sum_delta: string }> };
    for (const r of check.rows ?? []) {
      expect(Number(r.balance)).toBe(Number(r.sum_delta));
    }
  });

  it("团队余额不足时分配被拒（745701），且不产生任何流水", async () => {
    const owner = await loginNewUser("74");
    const member = await loginNewUser("75");
    const { teamSpaceId } = await createTeam(owner.userId);
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${BigInt(teamSpaceId)}, ${BigInt(member.userId)}, 3, 0, 1, 'animator', now(), now())
      on conflict (space_id, user_id) do nothing
    `);
    // 把团队余额压到 10
    await db.execute(sql`update credit_accounts set balance = 10 where space_id = ${BigInt(teamSpaceId)}`);

    const { TeamService } = await import("../src/modules/team/team.service");
    const svc = app.get(TeamService);
    const countBefore = (await db.execute(sql`
      select count(*)::int as n from credit_flows where space_id = ${BigInt(teamSpaceId)}
    `)) as { rows?: Array<{ n: number }> };

    await expect(svc.allocate(teamSpaceId, owner.userId, { user_id: member.userId, amount: 999 })).rejects.toThrow();

    const countAfter = (await db.execute(sql`
      select count(*)::int as n from credit_flows where space_id = ${BigInt(teamSpaceId)}
    `)) as { rows?: Array<{ n: number }> };
    expect(countAfter.rows?.[0]?.n).toBe(countBefore.rows?.[0]?.n);
  });

  it("特权按码集判定：level 11(film_maker) 有特权，level 4(导演) 无管理特权（§12.3.1 红线）", async () => {
    const { TeamService } = await import("../src/modules/team/team.service");
    // 直接测纯函数逻辑，不依赖 DB
    const asMember = (roleCode: string) => ({ spaceId: "1", userId: "2", role: 3, roleCode });

    expect(TeamService.hasPrivilege(asMember("film_maker"))).toBe(true); // level 11
    expect(TeamService.hasPrivilege(asMember("producer"))).toBe(true);
    expect(TeamService.hasPrivilege(asMember("admin"))).toBe(true);
    expect(TeamService.hasPrivilege(asMember("director"))).toBe(false); // level 4，但非特权码
    expect(TeamService.hasPrivilege(asMember("screenwriter"))).toBe(false);
    // owner(role=1) 等价 master
    expect(TeamService.hasPrivilege({ spaceId: "1", userId: "2", role: 1, roleCode: null })).toBe(true);
  });

  it("席位上限触发 400108", async () => {
    const owner = await loginNewUser("76");
    const { teamSpaceId } = await createTeam(owner.userId); // max_seats=3
    const { TeamService } = await import("../src/modules/team/team.service");
    const svc = app.get(TeamService);
    // 已有 1 个成员(owner)；补到 3 个
    for (const p of ["77", "78"]) {
      const u = await loginNewUser(p);
      await db.execute(sql`
        insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
        values (${BigInt(teamSpaceId)}, ${BigInt(u.userId)}, 3, 0, 1, 'animator', now(), now())
        on conflict (space_id, user_id) do nothing
      `);
    }
    await expect(svc.assertSeatAvailable(teamSpaceId)).rejects.toMatchObject({ code: 400108 });
  });
});
