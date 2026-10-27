import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "../src/common/auth.guard";
import { AuthModule } from "../src/modules/auth/auth.module";
import { CampaignModule } from "../src/modules/campaign/campaign.module";
import { CreatorModule } from "../src/modules/creator/creator.module";
import { OpModule } from "../src/modules/op/op.module";
import { TeamModule } from "../src/modules/team/team.module";
import { QueueModule } from "../src/queue/queue.module";
import { RedisModule } from "../src/redis/redis.module";
import { StorageModule } from "../src/storage/storage.module";

/**
 * 开发期快速反馈用的最小模块图（**只在显式设置 `OF_SCOPED_E2E=1` 时启用**）。
 *
 * 为什么留这个开关：并行开发时别的域（如 market）在途改坏 `AppModule` 的装配，
 * 会让本域 spec 在 `NestFactory.create` 阶段就退出（0 用例），完全看不到本域的回归。
 * 默认路径仍是**真实 `AppModule`**（验收口径），这个分支只在开发时用：
 *   OF_SCOPED_E2E=1 npx vitest run test/op.spec.ts
 */
@Module({
  imports: [RedisModule, QueueModule, StorageModule, AuthModule, TeamModule, OpModule, CampaignModule, CreatorModule],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
class ScopedE2eModule {}

const E2eRoot = process.env.OF_SCOPED_E2E ? ScopedE2eModule : AppModule;
import { hashAdminPassword } from "../src/modules/admin/admin-auth.service";
import { newId } from "@app/shared";
import { db, pool } from "../src/db/database";

/**
 * 运营增长（op）契约测试 —— 对照参照产品 `/web/v1/op/*` 31 端点（`rt:829-859`）。
 *
 * 这个域最容易出的三类事故，也正是本文件要钉死的三件事：
 *
 * 1. **重复发分**：每日奖励/兑换码/邀请核销都是"一人一次"。竞态下先查后写必然双发，
 *    所以断言不看 HTTP 码，直接看**余额增量**与 `credit_flows` 行数
 *    （每日奖励的并发裁决在 `op_daily_rewards.uq_op_daily_rewards` 上，迁移 0025）。
 * 2. **越权**：运营动作（发分/实验/运营位/兑换码 CRUD）只能由本 space 管理员做；
 *    非成员连 `X-Space-Id` 都会被 AuthGuard 挡住（租户隔离在守卫层就断）。
 * 3. **AB 变体漂移**：同一用户必须永远命中同一变体，否则实验数据无意义。
 *
 * 用**真实 `AppModule`** 跑：这是验收口径（Lead 明确要求）。这意味着任何其它域的
 * boot 故障都会在这里暴露——这是有价值的信号，不要为了绿而换回最小模块图。
 */
describe("op e2e", () => {
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
    return {
      status: res.statusCode,
      code: (body as { code?: number }).code ?? -1,
      msg: (body as { msg?: string }).msg ?? "",
      body,
      data: (body as { data?: unknown }).data,
    };
  };

  async function loginNewUser(prefix: string): Promise<{ token: string; spaceId: string; userId: string }> {
    const tail = String(Date.now()).slice(-7);
    const tag = String(prefix).replace(/\D/g, "").slice(-2).padStart(2, "0");
    // 随机化末位：同号码会复用老账号，测试就变成"在别人的数据上断言"
    const phone = `1${tail}${tag}${String(Math.floor(Math.random() * 9))}`;
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

  /** 建团队空间 + owner（ADR-010：团队 = spaces.type=2，不新建 teams 表） */
  async function createTeam(ownerUserId: string, name = "运营测试团队") {
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
    return { teamSpaceId: String(teamId) };
  }

  async function addMember(teamSpaceId: string, userId: string, roleCode = "animator") {
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${BigInt(teamSpaceId)}, ${BigInt(userId)}, 3, 0, 1, ${roleCode}, now(), now())
      on conflict (space_id, user_id) do update set status = 1, role_code = ${roleCode}
    `);
  }

  /** 运营位写接口要**运营账号**鉴权（`promo_slots.created_by` 指向 admin_users）。 */
  async function loginAdmin(): Promise<string> {
    const username = `t_${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    await db.execute(sql`
      insert into admin_users (id, username, password_hash, role, created_at, updated_at)
      values (${newId()}, ${username}, ${hashAdminPassword("test12345")}, 'ops', now(), now())
    `);
    const res = await inject("POST", "/ops/admin/login", { username, password: "test12345" });
    if (res.code !== 0) throw new Error(`admin login failed: ${res.msg}`);
    return (res.data as { token: string }).token;
  }

  /** 余额读库直查（不信接口返回，防止"接口说发了但库没变"） */
  async function balanceOf(spaceId: string): Promise<number> {
    const res = (await db.execute(
      sql`select balance from credit_accounts where space_id = ${BigInt(spaceId)}`,
    )) as { rows?: Array<{ balance: number }> };
    return Number(res.rows?.[0]?.balance ?? 0);
  }

  async function giftFlowCount(spaceId: string, memoLike: string): Promise<number> {
    const res = (await db.execute(
      sql`select count(*)::int as n from credit_flows where space_id = ${BigInt(spaceId)} and kind = 'gift' and memo like ${memoLike}`,
    )) as { rows?: Array<{ n: number }> };
    return Number(res.rows?.[0]?.n ?? 0);
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(E2eRoot, new FastifyAdapter({ trustProxy: true }), {
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

  // ── 每日奖励：幂等 ───────────────────────────────────────
  it("每日奖励：当天第一次发 5 分并落 gift 流水，第二次返回 already_rewarded 且余额不变", async () => {
    const u = await loginNewUser("91");
    const before = await balanceOf(u.spaceId);
    const first = await inject("POST", "/op/daily-reward", {}, u.token);
    expect(first.code).toBe(0);
    const d1 = first.data as { rewarded: boolean; credits: number; balance_after: number };
    expect(d1.rewarded).toBe(true);
    expect(d1.credits).toBe(5);
    // 新人礼包会先给一笔，所以断言"增量"而不是绝对值
    expect(d1.balance_after).toBe(before + 5);

    const second = await inject("POST", "/op/daily-reward", {}, u.token);
    expect(second.code).toBe(0);
    const d2 = second.data as { rewarded: boolean; already_rewarded: boolean; credits: number };
    // 为什么要断言 credits=0：幂等必须体现在**发分动作**上，不能只体现在 HTTP 200 上
    expect(d2.rewarded).toBe(false);
    expect(d2.already_rewarded).toBe(true);
    expect(d2.credits).toBe(0);
    expect(await balanceOf(u.spaceId)).toBe(before + 5);
    expect(await giftFlowCount(u.spaceId, "daily reward%")).toBe(1);
  });

  // ── 兑换码：CRUD + 两段式 + 幂等 + 配额 ──────────────────
  it("兑换码：运营创建 → info 查询不兑换 → redeem 发分 → 重复 redeem 回放不重复发分", async () => {
    const owner = await loginNewUser("92");
    const { teamSpaceId } = await createTeam(owner.userId, "兑换码团队");
    const created = await inject("POST", "/op/redeem-code", { credits: 50, max_uses: 5 }, owner.token, teamSpaceId);
    expect(created.code).toBe(0);
    const code = (created.data as { code: string }).code;
    expect(code.length).toBeGreaterThan(3);

    // 两段式：info 只查不兑（竞品拆成两个服务路径的核心理由）
    const info = await inject("POST", "/op/redeem-code/info", { code }, owner.token, teamSpaceId);
    expect(info.code).toBe(0);
    expect((info.data as { valid: boolean }).valid).toBe(true);
    expect((info.data as { credits: number }).credits).toBe(50);
    expect(await balanceOf(teamSpaceId)).toBe(0);

    const redeemed = await inject("POST", "/redeem-code/redeem", { code }, owner.token, teamSpaceId);
    expect(redeemed.code).toBe(0);
    const r1 = redeemed.data as { redeemed: boolean; credits: number; balance_after: number; used_count: number };
    expect(r1.redeemed).toBe(true);
    expect(r1.credits).toBe(50);
    expect(r1.balance_after).toBe(50);
    expect(r1.used_count).toBe(1);

    // 关键：重复兑换不能 500，也不能再发一次分
    const again = await inject("POST", "/redeem-code/redeem", { code }, owner.token, teamSpaceId);
    expect(again.code).toBe(0);
    const r2 = again.data as { redeemed: boolean; replayed: boolean; credits: number };
    expect(r2.replayed).toBe(true);
    expect(r2.credits).toBe(0);
    expect(await balanceOf(teamSpaceId)).toBe(50);
    expect(await giftFlowCount(teamSpaceId, "redeem code=%")).toBe(1);

    // 二次 info 应提示 already_redeemed（前端据此置灰按钮而不是让用户白点）
    const info2 = await inject("POST", "/op/redeem-code/info", { code }, owner.token, teamSpaceId);
    expect((info2.data as { reason: string }).reason).toBe("already_redeemed");
  });

  it("兑换码：max_uses=1 时第二个人兑换返回「已用尽」，余额只加一次", async () => {
    const owner = await loginNewUser("93");
    const { teamSpaceId } = await createTeam(owner.userId, "限额团队");
    const other = await loginNewUser("94");
    await addMember(teamSpaceId, other.userId);

    const created = await inject("POST", "/op/redeem-code", { credits: 10, max_uses: 1 }, owner.token, teamSpaceId);
    const code = (created.data as { code: string }).code;

    const first = await inject("POST", "/redeem-code/redeem", { code }, owner.token, teamSpaceId);
    expect(first.code).toBe(0);

    const second = await inject("POST", "/redeem-code/redeem", { code }, other.token, teamSpaceId);
    // 配额是"原子条件更新"抢的，抢不到必须报业务错（400101），不能静默成功
    expect(second.code).toBe(400101);
    expect(await balanceOf(teamSpaceId)).toBe(10);
  });

  it("兑换码：团队定向码在别的 space 兑换返回「不存在」（不泄露存在性）", async () => {
    const owner = await loginNewUser("95");
    const outsider = await loginNewUser("96");
    const { teamSpaceId } = await createTeam(owner.userId, "定向码团队");
    const created = await inject("POST", "/op/redeem-code", { credits: 30 }, owner.token, teamSpaceId);
    const code = (created.data as { code: string }).code;

    const before = await balanceOf(outsider.spaceId);
    const res = await inject("POST", "/redeem-code/redeem", { code }, outsider.token);
    expect(res.code).toBe(400101);
    expect(res.msg).toContain("不存在");
    expect(await balanceOf(outsider.spaceId)).toBe(before);
  });

  // ── 邀请码 / 分销归因 ───────────────────────────────────
  it("邀请码：生成幂等（同一用户两次同码）→ 校验 → 被邀请人核销得 100 分并建立单层分销关系", async () => {
    const inviter = await loginNewUser("97");
    const code1 = await inject("POST", "/op/invite-code", {}, inviter.token);
    expect(code1.code).toBe(0);
    const code = (code1.data as { code: string }).code;
    expect(code.startsWith("OF")).toBe(true);

    const again = await inject("POST", "/op/invite-code", {}, inviter.token);
    // 幂等关键：重复调用不能刷出第二个码，否则"我邀请了几人"归因会裂开
    expect((again.data as { code: string }).code).toBe(code);

    const invitee = await loginNewUser("98");
    const check = await inject("GET", `/op/invite-code/check?code=${code}`, undefined, invitee.token);
    expect(check.code).toBe(0);
    expect((check.data as { valid: boolean }).valid).toBe(true);

    const before = await balanceOf(invitee.spaceId);
    const verify = await inject("POST", "/op/invite-code/verify", { code }, invitee.token);
    expect(verify.code).toBe(0);
    expect((verify.data as { verified: boolean; credits: number }).credits).toBe(100);
    expect(await balanceOf(invitee.spaceId)).toBe(before + 100);

    // 重复核销：回放，不再发分
    const replay = await inject("POST", "/op/invite-code/verify", { code }, invitee.token);
    expect(replay.code).toBe(0);
    expect((replay.data as { replayed: boolean }).replayed).toBe(true);
    expect(await balanceOf(invitee.spaceId)).toBe(before + 100);

    // 归因：被邀请人建立了到邀请人的单层分销关系（跨 space 读平台级映射）
    const overview = await inject("POST", "/op/distributor/overview", {}, inviter.token);
    expect(overview.code).toBe(0);
    const ov = overview.data as { invitee_count: number; me: { commission_bps: number } };
    expect(ov.invitee_count).toBe(1);
    // 默认 0：拍板前不计佣（任务口径）
    expect(ov.me.commission_bps).toBe(0);

    const detail = await inject("POST", "/op/distributor/detail", {}, inviter.token);
    expect((detail.data as { list: Array<{ user_id: string }> }).list[0]!.user_id).toBe(invitee.userId);

    const inviteeOverview = await inject("POST", "/op/distributor/overview", {}, invitee.token);
    expect((inviteeOverview.data as { me: { parent_user_id: string | null } }).me.parent_user_id).toBe(inviter.userId);
  });

  it("邀请码：不存在的码校验返回 valid=false / reason=not_found，核销报参数错", async () => {
    const u = await loginNewUser("99");
    const check = await inject("GET", "/op/invite-code/check?code=OFNOPE123", undefined, u.token);
    expect(check.code).toBe(0);
    expect((check.data as { valid: boolean }).valid).toBe(false);
    expect((check.data as { reason: string }).reason).toBe("not_found");

    const verify = await inject("POST", "/op/invite-code/verify", { code: "OFNOPE123" }, u.token);
    expect(verify.code).toBe(400101);
  });

  // ── 权限 / 租户隔离 ──────────────────────────────────────
  it("非成员带别人的 X-Space-Id：AuthGuard 直接 403（租户隔离在守卫层就断掉）", async () => {
    const owner = await loginNewUser("11");
    const outsider = await loginNewUser("12");
    const { teamSpaceId } = await createTeam(owner.userId, "隔离团队");

    const res = await inject("POST", "/op/daily-reward", {}, outsider.token, teamSpaceId);
    expect(res.status).toBe(200); // 信封把业务错误也包成 200，靠 code 区分
    expect(res.code).toBe(403101);
  });

  it("运营动作权限：普通成员发分/建实验/建运营位一律 403，管理员可以", async () => {
    const owner = await loginNewUser("13");
    const member = await loginNewUser("14");
    const { teamSpaceId } = await createTeam(owner.userId, "权限团队");
    await addMember(teamSpaceId, member.userId, "animator");

    const denyGive = await inject(
      "POST",
      "/op/points-giveaway",
      { user_ids: [member.userId], credits: 10 },
      member.token,
      teamSpaceId,
    );
    expect(denyGive.code).toBe(403101);

    const denyExp = await inject(
      "POST",
      "/op/abtest/experiments",
      { key: `deny_${Date.now()}`, variants: [{ name: "a", weight: 1 }] },
      member.token,
      teamSpaceId,
    );
    expect(denyExp.code).toBe(403101);

    // 运营位写入口不在 op 域（已由 admin 域的 `/ops/admin/promo-slots` 承担）：
    // 这里只验证"空间成员/管理员都读得到、但都不能用空间 token 去写"，
    // 写接口的鉴权在下面的运营位用例里单独测。
    const denySlotRead = await inject("GET", "/op/promo-slots?slot=banner", undefined, member.token, teamSpaceId);
    expect(denySlotRead.code).toBe(403101);

    const allowGive = await inject(
      "POST",
      "/op/points-giveaway",
      { user_ids: [member.userId], credits: 10, reason: "测试奖励" },
      owner.token,
      teamSpaceId,
    );
    expect(allowGive.code).toBe(0);
    expect((allowGive.data as { granted_credits: number }).granted_credits).toBe(10);
    expect(await balanceOf(teamSpaceId)).toBe(10);
    // 发分 memo 必须写清来源（审计要能追到操作人与目标人）
    expect(await giftFlowCount(teamSpaceId, "op points giveaway by=%")).toBe(1);
  });

  it("定向发分：目标不是本 space 成员时拒绝（不能给别的团队充值）", async () => {
    const owner = await loginNewUser("15");
    const outsider = await loginNewUser("16");
    const { teamSpaceId } = await createTeam(owner.userId, "越权发分团队");
    const before = await balanceOf(outsider.spaceId);
    const res = await inject(
      "POST",
      "/op/points-giveaway",
      { user_ids: [outsider.userId], credits: 10 },
      owner.token,
      teamSpaceId,
    );
    expect(res.code).toBe(400101);
    expect(await balanceOf(outsider.spaceId)).toBe(before);
    expect(await balanceOf(teamSpaceId)).toBe(0);
  });

  // ── AB 实验 ─────────────────────────────────────────────
  it("AB：同一用户重复命中返回同一变体，且 ab_hits 只有一行（一人一变体）", async () => {
    const owner = await loginNewUser("17");
    const { teamSpaceId } = await createTeam(owner.userId, "AB团队");
    const key = `exp_${Date.now()}`;
    const created = await inject(
      "POST",
      "/op/abtest/experiments",
      { key, variants: [{ name: "control", weight: 50 }, { name: "v1", weight: 50 }], status: 2 },
      owner.token,
      teamSpaceId,
    );
    expect(created.code).toBe(0);

    const hit1 = await inject("GET", `/op/abtest/hit?experiment_keys=${key}`, undefined, owner.token, teamSpaceId);
    expect(hit1.code).toBe(0);
    const v1 = (hit1.data as { benefits: Record<string, string> }).benefits[key];
    expect(["control", "v1"]).toContain(v1);

    const hit2 = await inject("GET", `/op/abtest/hit?experiment_keys=${key}`, undefined, owner.token, teamSpaceId);
    const v2 = (hit2.data as { benefits: Record<string, string> }).benefits[key];
    expect(v2).toBe(v1);

    const res = (await db.execute(
      sql`select count(*)::int as n from ab_hits h join ab_experiments e on e.id = h.experiment_id
          where e.key = ${key} and h.user_id = ${BigInt(owner.userId)}`,
    )) as { rows?: Array<{ n: number }> };
    expect(Number(res.rows?.[0]?.n ?? 0)).toBe(1);
  });

  it("AB：命中只覆盖运行中(status=2)的实验；结束后不再命中", async () => {
    const owner = await loginNewUser("18");
    const { teamSpaceId } = await createTeam(owner.userId, "AB结束团队");
    const key = `exp_end_${Date.now()}`;
    await inject(
      "POST",
      "/op/abtest/experiments",
      { key, variants: [{ name: "control", weight: 1 }], status: 2 },
      owner.token,
      teamSpaceId,
    );
    const running = await inject("GET", `/op/abtest/hit?experiment_keys=${key}`, undefined, owner.token, teamSpaceId);
    expect((running.data as { hit: boolean }).hit).toBe(true);

    const list = await inject("GET", "/op/abtest/experiments", undefined, owner.token, teamSpaceId);
    const exp = (list.data as { list: Array<{ id: string; key: string }> }).list.find((e) => e.key === key)!;
    const ended = await inject("PATCH", `/op/abtest/experiments/${exp.id}`, { status: 3 }, owner.token, teamSpaceId);
    expect(ended.code).toBe(0);

    const after = await inject("GET", `/op/abtest/hit?experiment_keys=${key}`, undefined, owner.token, teamSpaceId);
    expect((after.data as { hit: boolean }).hit).toBe(false);
  });

  // ── 问卷 ────────────────────────────────────────────────
  it("问卷：缺必填 → 400101；填全 → is_complete=1；重复提交回放不覆盖", async () => {
    const u = await loginNewUser("21");
    const bad = await inject("POST", "/op/questionnaire", { questionnaire_id: "register", answers: {} }, u.token);
    expect(bad.code).toBe(400101);
    expect(bad.msg).toContain("必填");

    const ok = await inject(
      "POST",
      "/op/questionnaire",
      { questionnaire_id: "register", answers: { scene: "short_drama", team_size: 3 } },
      u.token,
    );
    expect(ok.code).toBe(0);
    expect((ok.data as { filled: boolean }).filled).toBe(true);

    const check = await inject("GET", "/op/register-questionnaire/check", undefined, u.token);
    expect((check.data as { is_complete: number }).is_complete).toBe(1);

    const again = await inject(
      "POST",
      "/op/questionnaire",
      { questionnaire_id: "register", answers: { scene: "ad", team_size: 9 } },
      u.token,
    );
    expect((again.data as { replayed: boolean }).replayed).toBe(true);
    // 回放返回**原答案**（问卷是留资，不是可编辑表单）
    expect((again.data as { submission: { answers: { scene: string } } }).submission.answers.scene).toBe("short_drama");
  });

  it("问卷审核：运营能按 id 审核；普通成员看不到提交列表(403)", async () => {
    const owner = await loginNewUser("22");
    const member = await loginNewUser("23");
    const { teamSpaceId } = await createTeam(owner.userId, "问卷审核团队");
    await addMember(teamSpaceId, member.userId);
    await inject(
      "POST",
      "/op/questionnaire",
      { questionnaire_id: "beta", answers: { company: "测", capacity: 2, ai_film: "yes", contact: "x" } },
      member.token,
      teamSpaceId,
    );

    const deny = await inject(
      "GET",
      "/op/questionnaire/mgr/list?questionnaire_id=beta",
      undefined,
      member.token,
      teamSpaceId,
    );
    expect(deny.code).toBe(403101);

    const list = await inject(
      "GET",
      "/op/questionnaire/mgr/list?questionnaire_id=beta",
      undefined,
      owner.token,
      teamSpaceId,
    );
    expect(list.code).toBe(0);
    const rows = (list.data as { list: Array<{ id: string; review_status: string }> }).list;
    expect(rows.length).toBe(1);
    expect(rows[0]!.review_status).toBe("pending");

    const reviewed = await inject(
      "POST",
      `/op/questionnaire/mgr/review/${encodeURIComponent(rows[0]!.id)}`,
      { status: "approved", note: "ok" },
      owner.token,
      teamSpaceId,
    );
    expect(reviewed.code).toBe(0);
    expect((reviewed.data as { review_status: string }).review_status).toBe("approved");
  });

  it("内测申请：提交 → beta-status 反映 pending；短信码验证后标记 mobile_verified 且码不可重放", async () => {
    const u = await loginNewUser("24");
    const phone = `1380000${String(Date.now()).slice(-4)}`;
    const submit = await inject(
      "POST",
      "/op/beta-questionnaire",
      { answers: { company: "星海", capacity: 4, ai_film: "yes", contact: phone } },
      u.token,
    );
    expect(submit.code).toBe(0);
    expect((submit.data as { review_status: string }).review_status).toBe("pending");

    const status1 = await inject("GET", "/op/beta-status", undefined, u.token);
    expect((status1.data as { submitted: boolean }).submitted).toBe(true);
    expect((status1.data as { mobile_verified: boolean }).mobile_verified).toBe(false);

    const captcha = await inject("POST", "/op/mobile-captcha", { phone }, u.token);
    expect(captcha.code).toBe(0);
    const code = (captcha.data as { debug_code?: string }).debug_code;
    expect(code).toBeTruthy();

    const verify = await inject("POST", "/op/beta-questionnaire/mobile-verify", { phone, code }, u.token);
    expect(verify.code).toBe(0);
    const status2 = await inject("GET", "/op/beta-status", undefined, u.token);
    expect((status2.data as { mobile_verified: boolean }).mobile_verified).toBe(true);

    // 验证码一次性：重放必须失败（否则一个码可以无限次通过验证）
    const replay = await inject("POST", "/op/beta-questionnaire/mobile-verify", { phone, code }, u.token);
    expect(replay.code).toBe(400101);
  });

  // ── 运营位 ──────────────────────────────────────────────
  it("运营位：运营账号创建后出现在后台与前台投放位；停用后前台不再返回", async () => {
    const owner = await loginNewUser("25");
    const { teamSpaceId } = await createTeam(owner.userId, "运营位团队");
    const adminToken = await loginAdmin();
    const title = `双十一活动${Date.now()}`;
    const created = await inject(
      "POST",
      "/ops/admin/promo-slots",
      { slot: "banner", title, link_uri: "/activities", sort: 1 },
      adminToken,
    );
    expect(created.code).toBe(0);
    const id = (created.data as { id: string }).id;
    // 运营位是平台级内容，`created_by` 必须落在 admin_users（不是 users，否则撞 FK）
    expect((created.data as { created_by: string | null }).created_by).toBeTruthy();

    // `promo_slots` 是**平台级**表（无 space 列，schema 注释即"首页横幅"），
    // 所以不能断言"全表只有 1 条"——只断言"我建的这条在里面"。
    const list = await inject("GET", "/ops/admin/promo-slots?slot=banner", undefined, adminToken);
    expect(list.code).toBe(0);
    expect((list.data as { list: Array<{ id: string }> }).list.some((s) => s.id === id)).toBe(true);

    // 空间管理员也能读到后台列表（客服/调试场景），但**不能写**
    const spaceList = await inject("GET", "/op/promo-slots?slot=banner", undefined, owner.token, teamSpaceId);
    expect(spaceList.code).toBe(0);
    expect((spaceList.data as { list: Array<{ id: string }> }).list.some((s) => s.id === id)).toBe(true);

    // 前台读取（creator 域 `crc/banner_list` 与运营位共用同一张 promo_slots）
    const publicList = await inject("GET", "/crc/banner_list", undefined, owner.token, teamSpaceId);
    expect((publicList.data as { list: Array<{ id: string }> }).list.some((s) => s.id === id)).toBe(true);

    const off = await inject("DELETE", `/ops/admin/promo-slots/${id}`, undefined, adminToken);
    expect(off.code).toBe(0);
    const publicAfter = await inject("GET", "/crc/banner_list", undefined, owner.token, teamSpaceId);
    expect((publicAfter.data as { list: Array<{ id: string }> }).list.some((s) => s.id === id)).toBe(false);
  });

  it("运营位：空间管理员不能写（写入口必须运营账号鉴权，否则会撞 admin_users 外键）", async () => {
    const ownerA = await loginNewUser("27");
    const ownerB = await loginNewUser("28");
    const a = await createTeam(ownerA.userId, "A 运营位团队");
    const b = await createTeam(ownerB.userId, "B 运营位团队");
    const adminToken = await loginAdmin();
    const created = await inject(
      "POST",
      "/ops/admin/promo-slots",
      { slot: "banner", title: `平台Banner${Date.now()}` },
      adminToken,
    );
    expect(created.code).toBe(0);
    const id = (created.data as { id: string }).id;

    // 读是全局的（平台级内容），A/B 都能读到
    const read = await inject("GET", "/op/promo-slots?slot=banner", undefined, ownerB.token, b.teamSpaceId);
    expect((read.data as { list: Array<{ id: string }> }).list.some((s) => s.id === id)).toBe(true);

    // 写不行：空间 token 打 admin 写接口 → 403（带的是用户 token，不是运营 token）
    const hackA = await inject("DELETE", `/ops/admin/promo-slots/${id}`, undefined, ownerA.token, a.teamSpaceId);
    expect(hackA.code).toBe(403101);
    const hackB = await inject("DELETE", `/ops/admin/promo-slots/${id}`, undefined, ownerB.token, b.teamSpaceId);
    expect(hackB.code).toBe(403101);

    // op 侧已无写路由（只有 GET）：账密不混用，避免"用户 id 写进 admin 外键"
    const noRoute = await inject("POST", "/op/promo-slots", { slot: "banner" }, ownerA.token, a.teamSpaceId);
    expect(noRoute.code).not.toBe(0);
  });

  // ── 参数校验 ────────────────────────────────────────────
  it("参数校验：创建兑换码 credits=0 拒绝；实验 key 重复拒绝；缺参不 500", async () => {
    const owner = await loginNewUser("26");
    const { teamSpaceId } = await createTeam(owner.userId, "校验团队");
    const badRedeem = await inject("POST", "/op/redeem-code", { credits: 0 }, owner.token, teamSpaceId);
    expect(badRedeem.code).toBe(400101);

    const key = `dup_${Date.now()}`;
    const first = await inject(
      "POST",
      "/op/abtest/experiments",
      { key, variants: [{ name: "a", weight: 1 }] },
      owner.token,
      teamSpaceId,
    );
    expect(first.code).toBe(0);
    const dup = await inject(
      "POST",
      "/op/abtest/experiments",
      { key, variants: [{ name: "a", weight: 1 }] },
      owner.token,
      teamSpaceId,
    );
    expect(dup.code).toBe(400101);

    // 空体 + 非法枚举：都要落到 400101，而不是 500/挂起
    const noCode = await inject("POST", "/redeem-code/redeem", {}, owner.token, teamSpaceId);
    expect(noCode.code).toBe(400101);
    // 实验变体为空数组 → 参数校验拦住（否则"命中"时没有变体可选，等于埋了个雷）
    const badVariants = await inject(
      "POST",
      "/op/abtest/experiments",
      { key: `bad_${Date.now()}`, variants: [] },
      owner.token,
      teamSpaceId,
    );
    expect(badVariants.code).toBe(400101);
  });
});








