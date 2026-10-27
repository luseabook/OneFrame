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
import { db, pool } from "../src/db/database";

/**
 * 激励活动（campaign）契约测试 —— 对照参照产品 `/web/v1/campaign/*` 6 端点（`rt:267-272`）。
 *
 * 三件事必须钉死（都是竞品行为直接推出来的）：
 *
 * 1. **报名奖励走账本且只发一次**：`campaigns.reward_credits > 0` 时报名即发放，
 *    重复报名/取消后重报**都不能再发**（一人一次），否则可以刷分。
 * 2. **报名窗口**：只有"进行中 + 在 start_at/end_at 内"可报名（`isOpen` 的单一实现，
 *    creator 域 `crc/activity/*` 复用它，不在两处各写一遍）。
 * 3. **入围/获奖是运营动作**：普通成员置状态必须 403；shortlist/awards 的数据来源
 *    就是这里（否则两个列表永远空，等于假端点）。
 *
 * 用**真实 `AppModule`** 跑（验收口径）；报名草稿落 `campaign_signup_drafts`（迁移 0027）。
 */
describe("campaign e2e", () => {
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
      method: method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
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
      data: (body as { data?: unknown }).data,
    };
  };

  async function loginNewUser(prefix: string): Promise<{ token: string; spaceId: string; userId: string }> {
    const tail = String(Date.now()).slice(-7);
    const tag = String(prefix).replace(/\D/g, "").slice(-2).padStart(2, "0");
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

  async function createTeam(ownerUserId: string, name = "活动测试团队") {
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
      values (${teamId}, 0, 0, now()) on conflict (space_id) do update set updated_at = now()
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

  /**
   * 直接 SQL 造活动。
   *
   * 为什么不经接口：`campaigns` 的创建属**平台运营**（竞品在 `rmopsrv`/后台，`rt:100-109`），
   * 本批只做 C 端 6 端点，故测试用 SQL 造数（与 kds.spec 造流水同一做法）。
   */
  async function createCampaign(opts: {
    title: string;
    status?: number;
    rewardCredits?: number;
    startAt?: string | null;
    endAt?: string | null;
    spaceId?: string | null;
  }) {
    seq += 1;
    const idRow = (await db.execute(
      sql`select (extract(epoch from clock_timestamp())*1000000)::bigint as id`,
    )) as { rows?: Array<{ id: string }> };
    const id = BigInt(idRow.rows?.[0]?.id ?? Date.now()) * 1000n + BigInt(seq);
    await db.execute(sql`
      insert into campaigns (id, space_id, title, kind, brief, reward_credits, start_at, end_at, status, created_at, updated_at)
      values (${id}, ${opts.spaceId ? BigInt(opts.spaceId) : null}, ${opts.title}, 1, '测试活动说明',
              ${opts.rewardCredits ?? 0},
              ${opts.startAt ? new Date(opts.startAt) : null},
              ${opts.endAt ? new Date(opts.endAt) : null},
              ${opts.status ?? 2}, now(), now())
    `);
    return String(id);
  }

  async function balanceOf(spaceId: string): Promise<number> {
    const res = (await db.execute(
      sql`select balance from credit_accounts where space_id = ${BigInt(spaceId)}`,
    )) as { rows?: Array<{ balance: number }> };
    return Number(res.rows?.[0]?.balance ?? 0);
  }

  async function campaignGiftCount(spaceId: string, campaignId: string): Promise<number> {
    const res = (await db.execute(
      sql`select count(*)::int as n from credit_flows
          where space_id = ${BigInt(spaceId)} and kind = 'gift' and memo like ${`campaign signup campaign=${campaignId}%`}`,
    )) as { rows?: Array<{ n: number }> };
    return Number(res.rows?.[0]?.n ?? 0);
  }

  /** 造一个"已通过"的作品（走真实端点：create → submit → approve），供报名带作品用 */
  async function publishAsset(token: string, spaceId: string, title: string) {
    const created = await inject("POST", "/crc/assets/create", { title, uri: "s3://demo/clip.mp4" }, token, spaceId);
    expect(created.code).toBe(0);
    const id = (created.data as { id: string }).id;
    const submitted = await inject("POST", "/crc/resource/action/status", { asset_id: id, action: "submit" }, token, spaceId);
    expect(submitted.code).toBe(0);
    const approved = await inject("POST", "/crc/resource/action/status", { asset_id: id, action: "approve" }, token, spaceId);
    expect(approved.code).toBe(0);
    return id;
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

  // ── 列表 / 详情 ──────────────────────────────────────────
  it("列表只给「进行中/已结束」，草稿与已下线不进列表；详情给出可报名标志", async () => {
    const u = await loginNewUser("31");
    const running = await createCampaign({ title: `进行中活动${Date.now()}`, status: 2 });
    const draft = await createCampaign({ title: `草稿活动${Date.now()}`, status: 1 });

    const list = await inject("GET", "/campaigns", undefined, u.token);
    expect(list.code).toBe(0);
    const ids = (list.data as { list: Array<{ id: string }> }).list.map((c) => c.id);
    expect(ids).toContain(running);
    expect(ids).not.toContain(draft);

    const detail = await inject("GET", `/campaigns/${running}`, undefined, u.token);
    expect(detail.code).toBe(0);
    const d = detail.data as { open_for_signup: boolean; my_signup: unknown; signup_count: number };
    expect(d.open_for_signup).toBe(true);
    expect(d.my_signup).toBeNull();
    expect(d.signup_count).toBe(0);
  });

  // ── 报名奖励：发分 + 幂等 ────────────────────────────────
  it("报名发奖励积分（走 creditIn 记账）：首次发 30，重复报名回放不再发分", async () => {
    const u = await loginNewUser("32");
    const campaignId = await createCampaign({ title: `有奖活动${Date.now()}`, rewardCredits: 30 });
    const before = await balanceOf(u.spaceId);

    const first = await inject("POST", `/campaigns/${campaignId}/signup`, { channel: "douyin" }, u.token);
    expect(first.code).toBe(0);
    const s1 = first.data as { signed_up: boolean; replayed: boolean; rewarded_credits: number; signup: { status: number } };
    expect(s1.signed_up).toBe(true);
    expect(s1.replayed).toBe(false);
    expect(s1.rewarded_credits).toBe(30);
    expect(s1.signup.status).toBe(1);
    expect(await balanceOf(u.spaceId)).toBe(before + 30);
    // 流水 memo 必须带活动与用户，否则对账时无法回答"这 30 分是怎么来的"
    expect(await campaignGiftCount(u.spaceId, campaignId)).toBe(1);

    const second = await inject("POST", `/campaigns/${campaignId}/signup`, {}, u.token);
    expect(second.code).toBe(0);
    expect((second.data as { replayed: boolean }).replayed).toBe(true);
    expect((second.data as { rewarded_credits: number }).rewarded_credits).toBe(0);
    expect(await balanceOf(u.spaceId)).toBe(before + 30);
    expect(await campaignGiftCount(u.spaceId, campaignId)).toBe(1);
  });

  it("取消报名 → 状态 4；取消后重报只恢复状态，不再发奖励（奖励一人一次）", async () => {
    const u = await loginNewUser("33");
    const campaignId = await createCampaign({ title: `可取消活动${Date.now()}`, rewardCredits: 20 });
    await inject("POST", `/campaigns/${campaignId}/signup`, {}, u.token);
    const afterFirst = await balanceOf(u.spaceId);

    const cancel = await inject("DELETE", `/campaigns/${campaignId}/signup`, undefined, u.token);
    expect(cancel.code).toBe(0);
    expect((cancel.data as { cancelled: boolean; signup: { status: number } }).signup.status).toBe(4);

    const revive = await inject("POST", `/campaigns/${campaignId}/signup`, {}, u.token);
    expect(revive.code).toBe(0);
    const r = revive.data as { revived: boolean; rewarded_credits: number; signup: { status: number } };
    expect(r.revived).toBe(true);
    expect(r.rewarded_credits).toBe(0);
    expect(r.signup.status).toBe(1);
    expect(await balanceOf(u.spaceId)).toBe(afterFirst);
  });

  // ── 报名草稿（可续填）────────────────────────────────────
  it("报名草稿：PUT 保存后 GET 能读回（含 channel）；带作品报名时作品必须是自己名下", async () => {
    const owner = await loginNewUser("34");
    const other = await loginNewUser("35");
    const campaignId = await createCampaign({ title: `草稿活动${Date.now()}` });
    const myWork = await publishAsset(owner.token, owner.spaceId, "我的投稿作品");
    const otherWork = await publishAsset(other.token, other.spaceId, "别人的作品");

    const save = await inject(
      "PUT",
      `/campaigns/${campaignId}/signup`,
      { work_id: myWork, channel: "wechat", answers: { intro: "第一次投稿" } },
      owner.token,
    );
    expect(save.code).toBe(0);

    const draft = await inject("GET", `/campaigns/${campaignId}/signup`, undefined, owner.token);
    expect(draft.code).toBe(0);
    const d = draft.data as { has_draft: boolean; draft: { channel: string; work_id: string; answers: { intro: string } } };
    expect(d.has_draft).toBe(true);
    expect(d.draft.channel).toBe("wechat");
    expect(d.draft.work_id).toBe(myWork);
    expect(d.draft.answers.intro).toBe("第一次投稿");

    // 拿别人的作品报名 = 冒名，必须 403（而不是"成功报名但作品不是他的"）
    const stolen = await inject("POST", `/campaigns/${campaignId}/signup`, { work_id: otherWork }, owner.token);
    expect(stolen.code).toBe(403101);

    const ok = await inject("POST", `/campaigns/${campaignId}/signup`, { work_id: myWork }, owner.token);
    expect(ok.code).toBe(0);
    expect((ok.data as { signup: { work_id: string } }).signup.work_id).toBe(myWork);
  });

  // ── 入围 / 获奖（运营动作）────────────────────────────────
  it("入围与获奖：运营置 status 后 shortlist/awards 可见；普通成员置状态 403", async () => {
    const owner = await loginNewUser("36");
    const member = await loginNewUser("37");
    const { teamSpaceId } = await createTeam(owner.userId, "活动运营团队");
    await addMember(teamSpaceId, member.userId);
    const campaignId = await createCampaign({ title: `评选活动${Date.now()}`, rewardCredits: 0, spaceId: teamSpaceId });

    const signup = await inject("POST", `/campaigns/${campaignId}/signup`, {}, member.token, teamSpaceId);
    expect(signup.code).toBe(0);
    const signupId = (signup.data as { signup: { id: string } }).signup.id;

    const deny = await inject(
      "POST",
      `/campaigns/${campaignId}/signups/${signupId}/status`,
      { status: 2 },
      member.token,
      teamSpaceId,
    );
    expect(deny.code).toBe(403101);

    const shortlisted = await inject(
      "POST",
      `/campaigns/${campaignId}/signups/${signupId}/status`,
      { status: 2 },
      owner.token,
      teamSpaceId,
    );
    expect(shortlisted.code).toBe(0);

    const shortlist = await inject("GET", `/campaigns/${campaignId}/shortlist`, undefined, member.token, teamSpaceId);
    expect(shortlist.code).toBe(0);
    expect((shortlist.data as { count: number }).count).toBe(1);
    expect((shortlist.data as { list: Array<{ status_label: string }> }).list[0]!.status_label).toBe("已入围");

    const awarded = await inject(
      "POST",
      `/campaigns/${campaignId}/signups/${signupId}/status`,
      { status: 3 },
      owner.token,
      teamSpaceId,
    );
    expect(awarded.code).toBe(0);

    const awards = await inject("GET", `/campaigns/${campaignId}/awards`, undefined, member.token, teamSpaceId);
    expect(awards.code).toBe(0);
    expect((awards.data as { count: number }).count).toBe(1);
    // 奖项结构未取证，诚实标注（不要让前端以为是完整的奖项层级）
    expect((awards.data as { awards_structure_known: boolean }).awards_structure_known).toBe(false);
  });

  it("已入围/已获奖的报名不能自行取消（400101），未报名取消返回 404", async () => {
    const owner = await loginNewUser("38");
    const { teamSpaceId } = await createTeam(owner.userId, "报名态团队");
    const campaignId = await createCampaign({ title: `状态活动${Date.now()}`, spaceId: teamSpaceId });

    const none = await inject("DELETE", `/campaigns/${campaignId}/signup`, undefined, owner.token, teamSpaceId);
    expect(none.code).toBe(400102);

    const signup = await inject("POST", `/campaigns/${campaignId}/signup`, {}, owner.token, teamSpaceId);
    const signupId = (signup.data as { signup: { id: string } }).signup.id;
    await inject("POST", `/campaigns/${campaignId}/signups/${signupId}/status`, { status: 3 }, owner.token, teamSpaceId);

    const cancel = await inject("DELETE", `/campaigns/${campaignId}/signup`, undefined, owner.token, teamSpaceId);
    expect(cancel.code).toBe(400101);
    expect(cancel.msg).toContain("不能自行取消");
  });

  // ── 报名窗口 ────────────────────────────────────────────
  it("报名窗口：草稿活动 / 已过期活动报名一律 400101；不存在活动 400102", async () => {
    const u = await loginNewUser("39");
    const draft = await createCampaign({ title: `未开始活动${Date.now()}`, status: 1 });
    const ended = await createCampaign({
      title: `已结束活动${Date.now()}`,
      status: 2,
      endAt: new Date(Date.now() - 86_400_000).toISOString(),
    });

    const d = await inject("POST", `/campaigns/${draft}/signup`, {}, u.token);
    expect(d.code).toBe(400101);
    const e = await inject("POST", `/campaigns/${ended}/signup`, {}, u.token);
    expect(e.code).toBe(400101);

    const missing = await inject("POST", "/campaigns/123456789012345678/signup", {}, u.token);
    expect(missing.code).toBe(400102);
  });

  // ── 活动作品列表（crc/activity/resource/list）───────────────
  it("活动作品列表只列「已报名 + 作品已通过」的投稿", async () => {
    const u = await loginNewUser("41");
    const campaignId = await createCampaign({ title: `投稿活动${Date.now()}` });
    const work = await publishAsset(u.token, u.spaceId, "活动投稿作品");
    await inject("POST", `/campaigns/${campaignId}/signup`, { work_id: work }, u.token);

    const res = await inject("POST", "/crc/activity/resource/list", { campaign_id: campaignId }, u.token);
    expect(res.code).toBe(0);
    const list = (res.data as { list: Array<{ id: string }> }).list;
    expect(list.length).toBe(1);
    expect(list[0]!.id).toBe(work);

    // 我报名的活动出现在 crc/activity/list（creator 域复用同一份数据，不许两处各算一遍）
    const mine = await inject("POST", "/crc/activity/list", {}, u.token);
    expect(mine.code).toBe(0);
    expect((mine.data as { list: Array<{ id: string }> }).list.some((c) => c.id === campaignId)).toBe(true);
  });

  // ── 租户隔离 ────────────────────────────────────────────
  it("非成员带团队 X-Space-Id 访问活动：守卫层 403101", async () => {
    const owner = await loginNewUser("42");
    const outsider = await loginNewUser("43");
    const { teamSpaceId } = await createTeam(owner.userId, "活动隔离团队");
    const campaignId = await createCampaign({ title: `隔离活动${Date.now()}`, spaceId: teamSpaceId });

    const res = await inject("POST", `/campaigns/${campaignId}/signup`, {}, outsider.token, teamSpaceId);
    expect(res.code).toBe(403101);
  });
});



