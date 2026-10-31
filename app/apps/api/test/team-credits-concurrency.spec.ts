import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { AppError, ErrorCode, newId } from "@app/shared";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * 团队积分并发用例（第 107 批）
 *
 * 背景：`TeamService.allocate` 与 `recover` 方向相反（团队→成员 / 成员→团队）。
 * 如果两条路径各自按"业务方向"加锁（allocate 先锁团队、recover 先锁成员），
 * 并发一进一出时 PostgreSQL 会判定 `40P01` 死锁，线上表现为随机 500。
 * P1-5/6 已把两条路径收敛到 `lockCreditAccountPair()`（两个 space 按 id 升序加锁）；
 * `credits_quota` 也从"事务外读值回写"改成 SQL 自增 / `greatest(0, …)` 递减。
 *
 * 本用例在**真实 PostgreSQL** 上并发调用服务方法验证这两条修复不被回退。
 * 每个调用各自从连接池取连接、各自一个事务 —— 行锁与死锁检测都是数据库的真实行为，
 * 不是把调用串行化后假装并发。断言四件事：
 *   1. 混合 allocate/recover 并发全部成交，不出现 40P01（加锁顺序统一）；
 *   2. 32 路并发 allocate(1) 后 `credits_quota` 精确为 32（无丢更新）；
 *   3. 并发 recover 超过余额时只有余额允许的部分成功，quota 下限 0；
 *   4. 每个 space 的 `balance == Σdelta`，全系统 Σdelta 守恒（成对记账）。
 *
 * **未覆盖**：多进程/多主机部署下的同场景（连接池 max=10，单进程内已能制造真实锁竞争），
 * 以及 HTTP 层（直接调 service，避免把并发退化成串行请求）。
 */
describe("team credits concurrency (real PG)", () => {
  let app: NestFastifyApplication;
  let svc: import("../src/modules/team/team.service").TeamService;

  const inject = async (method: string, url: string, payload?: unknown) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    const res = await app.inject({
      method: method as "GET" | "POST" | "PATCH" | "DELETE",
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = JSON.parse(res.body);
    return { status: res.statusCode, ...body, body };
  };

  async function loginNewUser(prefix: string): Promise<{ spaceId: string; userId: string }> {
    // 手机号必须匹配 ^1\d{10}：1 + 时间戳后 8 位 + prefix 后 2 位（各用例用不同 prefix 防撞号）
    const tail = String(Date.now()).slice(-8);
    const tag = String(prefix).replace(/\D/g, "").slice(-2).padStart(2, "0");
    const phone = `1${tail}${tag}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = sms.data?.debug_code as string;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const userId = String(login.data?.user?.id ?? "");
    if (!userId || userId === "undefined") {
      throw new Error(`login helper: missing user.id, got body=${JSON.stringify(login.body).slice(0, 200)}`);
    }
    return { spaceId: String(login.data?.space_id ?? ""), userId };
  }

  /** 团队 = spaces(type=2)（ADR-010）；注资必须配一条流水，否则 balance == Σdelta 一开始就是假的 */
  async function createTeam(ownerUserId: string): Promise<{ teamSpaceId: string }> {
    const idRow = (await db.execute(sql`select (extract(epoch from clock_timestamp())*1000000)::bigint as id`)) as {
      rows?: Array<{ id: string }>;
    };
    const base = BigInt(idRow.rows?.[0]?.id ?? Date.now());
    const teamId = base * 1000n + BigInt(Math.floor(Math.random() * 1000));
    await db.execute(sql`
      insert into spaces (id, owner_user_id, type, name, max_seats, status, agent_whitelist, film_enabled, created_at, updated_at)
      values (${teamId}, ${BigInt(ownerUserId)}, 2, '并发测试团队', 3, 1, 0, 0, now(), now())
    `);
    await db.execute(sql`
      insert into credit_accounts (space_id, balance, frozen, updated_at)
      values (${teamId}, 1000, 0, now())
      on conflict (space_id) do update set balance = 1000, frozen = 0, updated_at = now()
    `);
    await db.execute(sql`
      insert into credit_flows (id, space_id, delta, frozen_delta, kind, balance_after, memo, created_at)
      values (${newId()}, ${teamId}, 1000, 0, 'recharge', 1000, '并发测试注资', now())
    `);
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${teamId}, ${BigInt(ownerUserId)}, 1, 0, 1, 'master', now(), now())
      on conflict (space_id, user_id) do update set role = 1, role_code = 'master', status = 1
    `);
    return { teamSpaceId: String(teamId) };
  }

  async function joinTeam(teamSpaceId: string, userId: string) {
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${BigInt(teamSpaceId)}, ${BigInt(userId)}, 3, 0, 1, 'animator', now(), now())
      on conflict (space_id, user_id) do nothing
    `);
  }

  async function personalSpaceId(userId: string): Promise<string> {
    const rows = (await db.execute(sql`
      select id from spaces where owner_user_id = ${BigInt(userId)} and type = 1
    `)) as { rows?: Array<{ id: string }> };
    const id = rows.rows?.[0]?.id;
    if (!id) throw new Error(`personal space missing for user ${userId}`);
    return id;
  }

  async function balanceOf(spaceId: string): Promise<number> {
    const rows = (await db.execute(sql`
      select balance from credit_accounts where space_id = ${BigInt(spaceId)}
    `)) as { rows?: Array<{ balance: number }> };
    const v = rows.rows?.[0]?.balance;
    if (v === undefined || v === null) throw new Error(`credit account missing for space ${spaceId}`);
    return Number(v);
  }

  async function quotaOf(teamSpaceId: string, userId: string): Promise<number> {
    const rows = (await db.execute(sql`
      select credits_quota from space_members
      where space_id = ${BigInt(teamSpaceId)} and user_id = ${BigInt(userId)}
    `)) as { rows?: Array<{ credits_quota: number }> };
    const v = rows.rows?.[0]?.credits_quota;
    if (v === undefined || v === null) throw new Error(`member row missing for user ${userId}`);
    return Number(v);
  }

  async function flowSum(spaceId: string): Promise<bigint> {
    const rows = (await db.execute(sql`
      select coalesce(sum(delta), 0)::bigint as s from credit_flows where space_id = ${BigInt(spaceId)}
    `)) as { rows?: Array<{ s: string }> };
    return BigInt(rows.rows?.[0]?.s ?? "0");
  }

  async function globalFlowSum(): Promise<bigint> {
    const rows = (await db.execute(sql`
      select coalesce(sum(delta), 0)::bigint as s from credit_flows
    `)) as { rows?: Array<{ s: string }> };
    return BigInt(rows.rows?.[0]?.s ?? "0");
  }

  /** 并发结果里不允许出现任何非业务错误（40P01 / 连接池超时都会被当成真实缺陷暴露出来） */
  function rejectionsOf(settled: PromiseSettledResult<unknown>[]): unknown[] {
    return settled.filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => r.reason);
  }

  function describeReason(reason: unknown): string {
    if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
    return String(reason);
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
    const { TeamService } = await import("../src/modules/team/team.service");
    svc = app.get(TeamService);
  }, 90_000);

  afterAll(async () => {
    await app.close();
    await pool.end().catch(() => {});
  });

  it("混合 allocate/recover 并发全部成交：相反方向共用同一加锁顺序，无 40P01", async () => {
    const owner = await loginNewUser("81");
    const member = await loginNewUser("82");
    const { teamSpaceId } = await createTeam(owner.userId);
    await joinTeam(teamSpaceId, member.userId);
    const personal = await personalSpaceId(member.userId);
    // 新用户个人账户自带注册赠送余额，断言一律用"起始值 + 增量"，不写死绝对值
    const personalStart = await balanceOf(personal);

    // 先给成员 300：并发 recover 需要成员侧有余额可扣
    await svc.allocate(teamSpaceId, owner.userId, { user_id: member.userId, amount: 300 });

    // 一半分配、一半回收交错发起 —— 原缺陷（两侧各按业务方向加锁）会在这里撞死锁
    const ops: Array<Promise<unknown>> = [];
    for (let i = 0; i < 20; i++) {
      ops.push(svc.allocate(teamSpaceId, owner.userId, { user_id: member.userId, amount: 1 }));
      ops.push(svc.recover(teamSpaceId, owner.userId, { user_id: member.userId, amount: 1 }));
    }
    const settled = await Promise.allSettled(ops);
    const rejections = rejectionsOf(settled);
    expect(rejections.map(describeReason)).toEqual([]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(40);

    // 20 进 20 出，净值回到种子后的 700 / 起始值+300
    expect(await balanceOf(teamSpaceId)).toBe(700);
    expect(await balanceOf(personal)).toBe(personalStart + 300);
    expect(await quotaOf(teamSpaceId, member.userId)).toBe(300);
  });

  it("32 路并发分配：credits_quota 精确累加（SQL 自增，无丢更新）", async () => {
    const owner = await loginNewUser("83");
    const member = await loginNewUser("84");
    const { teamSpaceId } = await createTeam(owner.userId);
    await joinTeam(teamSpaceId, member.userId);
    const personal = await personalSpaceId(member.userId);
    const personalStart = await balanceOf(personal);

    const settled = await Promise.allSettled(
      Array.from({ length: 32 }, () =>
        svc.allocate(teamSpaceId, owner.userId, { user_id: member.userId, amount: 1 }),
      ),
    );
    const rejections = rejectionsOf(settled);
    expect(rejections.map(describeReason)).toEqual([]);

    // 若 quota 用"事务外读值 + 回写"，并发下会丢更新，这里会小于 32
    expect(await quotaOf(teamSpaceId, member.userId)).toBe(32);
    expect(await balanceOf(teamSpaceId)).toBe(1000 - 32);
    expect(await balanceOf(personal)).toBe(personalStart + 32);

    // 成对记账：团队侧 32 条 out，成员侧 32 条 in
    const outRows = (await db.execute(sql`
      select count(*)::int as n from credit_flows
      where space_id = ${BigInt(teamSpaceId)} and kind = 'team_allocate_out'
    `)) as { rows?: Array<{ n: number }> };
    const inRows = (await db.execute(sql`
      select count(*)::int as n from credit_flows
      where space_id = ${BigInt(personal)} and kind = 'team_allocate_in'
    `)) as { rows?: Array<{ n: number }> };
    expect(Number(outRows.rows?.[0]?.n)).toBe(32);
    expect(Number(inRows.rows?.[0]?.n)).toBe(32);
  });

  it("并发回收超过余额：只有余额允许的部分成功，quota 下限为 0（不出现负值）", async () => {
    const owner = await loginNewUser("85");
    const member = await loginNewUser("86");
    const { teamSpaceId } = await createTeam(owner.userId);
    await joinTeam(teamSpaceId, member.userId);
    const personal = await personalSpaceId(member.userId);
    const personalStart = await balanceOf(personal);

    await svc.allocate(teamSpaceId, owner.userId, { user_id: member.userId, amount: 100 });
    // 成员当前全部余额（注册赠送 + 本次分配）。回收额取"全部余额"而不是写死 50，
    // 这样不依赖注册赠送的具体数额：并发下恰好一笔能成交。
    const memberBalance = personalStart + 100;

    // 6 路并发各回收全部余额：恰好 1 笔成交、5 笔因余额不足失败
    const settled = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        svc.recover(teamSpaceId, owner.userId, { user_id: member.userId, amount: memberBalance }),
      ),
    );
    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejections = rejectionsOf(settled);
    expect(fulfilled).toHaveLength(1);
    expect(rejections).toHaveLength(5);
    for (const reason of rejections) {
      expect(reason).toBeInstanceOf(AppError);
      // 必须是余额不足这种业务错误，而不是 40P01 死锁或连接池超时
      expect((reason as AppError).code).toBe(ErrorCode.INSUFFICIENT_BALANCE);
    }

    expect(await balanceOf(personal)).toBe(0);
    // 团队净额：−100（分配）+ memberBalance（唯一成交的回收）
    expect(await balanceOf(teamSpaceId)).toBe(1000 - 100 + memberBalance);
    // greatest(0, quota − amount)：回收额大于 allocation 时 quota 落回 0，不会变负
    expect(await quotaOf(teamSpaceId, member.userId)).toBe(0);
  });

  it("混合并发后每个 space 的 balance == Σdelta，全系统 Σdelta 守恒（成对记账）", async () => {
    const owner = await loginNewUser("87");
    const member = await loginNewUser("88");
    const { teamSpaceId } = await createTeam(owner.userId);
    await joinTeam(teamSpaceId, member.userId);
    const personal = await personalSpaceId(member.userId);

    await svc.allocate(teamSpaceId, owner.userId, { user_id: member.userId, amount: 400 });
    const globalBefore = await globalFlowSum();

    const ops: Array<Promise<unknown>> = [];
    for (let i = 0; i < 10; i++) {
      ops.push(svc.allocate(teamSpaceId, owner.userId, { user_id: member.userId, amount: 2 }));
      ops.push(svc.recover(teamSpaceId, owner.userId, { user_id: member.userId, amount: 3 }));
    }
    const settled = await Promise.allSettled(ops);
    expect(rejectionsOf(settled).map(describeReason)).toEqual([]);

    // 每个 space 落账后的余额必须等于该 space 全部流水的 delta 之和
    for (const spaceId of [teamSpaceId, personal]) {
      expect(await flowSum(spaceId)).toBe(BigInt(await balanceOf(spaceId)));
    }
    // 成对转账在全系统层面互相抵消：总 Σdelta 不变
    expect(await globalFlowSum()).toBe(globalBefore);

    // quota 记录的是"未回收的分配额"：400 + 10×2 - 10×3
    expect(await quotaOf(teamSpaceId, member.userId)).toBe(390);
  });
});