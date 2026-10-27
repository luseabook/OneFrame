import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Module } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { AuthGuard } from "../src/common/auth.guard";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { AuthModule } from "../src/modules/auth/auth.module";
import { CreditsModule } from "../src/modules/credits/credits.module";
import { GenerationsModule } from "../src/modules/generations/generations.module";
import { RedrawModule } from "../src/modules/redraw/redraw.module";
import { TeamModule } from "../src/modules/team/team.module";
import { QueueModule } from "../src/queue/queue.module";
import { RedisModule } from "../src/redis/redis.module";
import { StorageModule } from "../src/storage/storage.module";
import { db, pool } from "../src/db/database";

/**
 * 视频转绘（video_redraw）契约测试 —— 对照参照产品
 * `/web/v1/df/script_project/video_redraw/*` 8 端点（`rt:703-710`）。
 *
 * 本域最容易出的四类事故，逐一钉死：
 *
 * 1. **白送生成**：重绘必须"报价 → 冻结 → 入队"，不能只有任务没有扣费。
 *    所以断言不看接口返回值，而是直接查 `credit_accounts.balance` 与 `credit_flows`（kind=freeze）。
 * 2. **重复扣费**：客户端双击/重试在生成类端点上是高频行为，默认幂等键必须让第二次
 *    返回**同一个 task_id** 且不多冻结一次。
 * 3. **重复分镜**：`storyboard/plan` 若每次追加，点两下分镜数就翻倍——本测试断言"再 plan 一次数量不变"。
 * 4. **跨 space / 跨模式越权**：别人的转绘项目、自己的普通剧本项目都必须 404（不泄露存在性）。
 */
@Module({
  imports: [RedisModule, QueueModule, StorageModule, AuthModule, TeamModule, CreditsModule, GenerationsModule, RedrawModule],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
class ScopedE2eModule {}

const E2eRoot = process.env.OF_SCOPED_E2E ? ScopedE2eModule : AppModule;

describe("video-redraw e2e", () => {
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
      method: method as "GET" | "POST",
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
    return { token: data?.access_token ?? "", spaceId: String(data?.space_id ?? ""), userId: String(data?.user?.id ?? "") };
  }

  /** 建团队空间 + owner（余额可控，用于"报价不足"用例） */
  async function createTeam(ownerUserId: string, balance = 0, name = "转绘测试团队") {
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
      values (${teamId}, ${balance}, 0, now())
      on conflict (space_id) do update set balance = ${balance}, frozen = 0, updated_at = now()
    `);
    await db.execute(sql`
      insert into space_members (space_id, user_id, role, credits_quota, status, role_code, created_at, updated_at)
      values (${teamId}, ${BigInt(ownerUserId)}, 1, 0, 1, 'master', now(), now())
      on conflict (space_id, user_id) do update set role = 1, role_code = 'master', status = 1
    `);
    return String(teamId);
  }

  async function balanceOf(spaceId: string): Promise<{ balance: number; frozen: number }> {
    const res = (await db.execute(
      sql`select balance, frozen from credit_accounts where space_id = ${BigInt(spaceId)}`,
    )) as { rows?: Array<{ balance: number; frozen: number }> };
    return { balance: Number(res.rows?.[0]?.balance ?? 0), frozen: Number(res.rows?.[0]?.frozen ?? 0) };
  }

  async function freezeFlowCount(spaceId: string): Promise<number> {
    const res = (await db.execute(
      sql`select count(*)::int as n from credit_flows where space_id = ${BigInt(spaceId)} and kind = 'freeze'`,
    )) as { rows?: Array<{ n: number }> };
    return Number(res.rows?.[0]?.n ?? 0);
  }

  /** 建转绘项目（源视频 60s，便于切集/切镜断言） */
  async function createRedrawProject(token: string, spaceId: string, title = `转绘项目${Date.now()}`) {
    const res = await inject(
      "POST",
      "/video-redraw/projects",
      {
        title,
        source_uri: "s3://demo/source.mp4",
        source_kind: "upload",
        style: "anime",
        redraw_strength: 80,
        source_duration_s: 60,
      },
      token,
      spaceId,
    );
    expect(res.code).toBe(0);
    return res.data as { id: string; project_mode: number; mode_meta: Record<string, unknown> };
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

  // ── 1. 创建项目 ──────────────────────────────────────────
  it("创建转绘项目：project_mode=3 + mode_meta 落库（源视频/风格/强度）；非法 style 与缺 source_uri → 400101", async () => {
    const u = await loginNewUser("81");
    const p = await createRedrawProject(u.token, u.spaceId);
    expect(p.project_mode).toBe(3);
    expect(p.mode_meta).toMatchObject({
      source_uri: "s3://demo/source.mp4",
      source_kind: "upload",
      style: "anime",
      redraw_strength: 80,
      source_duration_s: 60,
    });

    const badStyle = await inject(
      "POST",
      "/video-redraw/projects",
      { title: "x", source_uri: "s3://a/b.mp4", style: "nope" },
      u.token,
    );
    expect(badStyle.code).toBe(400101);

    const noUri = await inject("POST", "/video-redraw/projects", { title: "x" }, u.token);
    expect(noUri.code).toBe(400101);

    const badStrength = await inject(
      "POST",
      "/video-redraw/projects",
      { title: "x", source_uri: "s3://a/b.mp4", redraw_strength: 120 },
      u.token,
    );
    expect(badStrength.code).toBe(400101);
  });

  // ── 2. 项目详情：四段进度 ─────────────────────────────────
  it("项目详情：新项目 stage=episode/status=1；切集→分镜后 stage 推进（竞品字段名 video_redraw_stage 对齐）", async () => {
    const u = await loginNewUser("82");
    const p = await createRedrawProject(u.token, u.spaceId);

    const info0 = await inject("GET", `/video-redraw/projects/${p.id}`, undefined, u.token);
    expect(info0.code).toBe(0);
    const d0 = info0.data as {
      video_redraw_stage: string;
      video_redraw_stage_status: number;
      progress: { episodes: number; storyboards: number; percent: number };
      source: { uri: string; duration_s: number };
    };
    expect(d0.video_redraw_stage).toBe("episode");
    expect(d0.video_redraw_stage_status).toBe(1);
    expect(d0.progress.episodes).toBe(0);
    expect(d0.source.uri).toBe("s3://demo/source.mp4");

    // 切集后再看：stage 推到 storyboard
    const ep = await inject("POST", `/video-redraw/projects/${p.id}/episodes`, {}, u.token);
    expect(ep.code).toBe(0);
    const info1 = await inject("GET", `/video-redraw/projects/${p.id}`, undefined, u.token);
    expect((info1.data as { video_redraw_stage: string }).video_redraw_stage).toBe("storyboard");
    expect((info1.data as { progress: { episodes: number } }).progress.episodes).toBe(1);
  });

  // ── 3. 切集（单个 + 批量）────────────────────────────────
  it("切集：单个 ep_no 自增并记录源区间；批量按源时长等分（60s / 3 集 = 20s 一集）", async () => {
    const u = await loginNewUser("83");
    const p = await createRedrawProject(u.token, u.spaceId);

    const one = await inject("POST", `/video-redraw/projects/${p.id}/episodes`, { title: "自定义集名" }, u.token);
    expect(one.code).toBe(0);
    const e1 = one.data as { ep_no: number; title: string; source_range: [number, number] };
    expect(e1.ep_no).toBe(1);
    expect(e1.title).toBe("自定义集名");
    expect(e1.source_range).toEqual([0, 60]);

    const batch = await inject("POST", `/video-redraw/projects/${p.id}/episodes/batch`, { count: 3 }, u.token);
    expect(batch.code).toBe(0);
    const created = (batch.data as { created: number; episodes: Array<{ ep_no: number; synopsis: string }> });
    expect(created.created).toBe(3);
    // ep_no 连续（1 已被上面占用 → 2,3,4），且区间首尾相接
    expect(created.episodes.map((e) => e.ep_no)).toEqual([2, 3, 4]);
    expect(created.episodes[0]!.synopsis).toContain("source 0.0s-20.0s");
    expect(created.episodes[2]!.synopsis).toContain("source 40.0s-60.0s");

    // 非法 count → 400101
    const bad = await inject("POST", `/video-redraw/projects/${p.id}/episodes/batch`, { count: 0 }, u.token);
    expect(bad.code).toBe(400101);
  });

  // ── 4. 分镜计划（覆盖式幂等）──────────────────────────────
  it("分镜计划：按 shot_duration_s 切镜（60s/5s=12 镜）；重复 plan 不翻倍；提示词带风格与强度", async () => {
    const u = await loginNewUser("84");
    const p = await createRedrawProject(u.token, u.spaceId);
    const ep = await inject("POST", `/video-redraw/projects/${p.id}/episodes`, {}, u.token);
    const episodeId = (ep.data as { id: string }).id;

    const plan1 = await inject(
      "POST",
      `/video-redraw/projects/${p.id}/storyboard/plan`,
      { episode_id: episodeId, shot_duration_s: 5 },
      u.token,
    );
    expect(plan1.code).toBe(0);
    const d1 = plan1.data as { shots: number; list: Array<{ shot_no: number; video_prompt: string; duration_s: number }> };
    expect(d1.shots).toBe(12);
    expect(d1.list[0]!.shot_no).toBe(1);
    expect(d1.list[0]!.video_prompt).toContain("日系动漫");
    expect(d1.list[0]!.video_prompt).toContain("强度 80");

    // 幂等：再 plan 一次（同参数）→ 镜数不变、镜号不重复
    const plan2 = await inject(
      "POST",
      `/video-redraw/projects/${p.id}/storyboard/plan`,
      { episode_id: episodeId, shot_duration_s: 5 },
      u.token,
    );
    expect((plan2.data as { shots: number }).shots).toBe(12);

    // 改镜长（10s）→ 6 镜；少的镜被裁剪（未绑定则可删）
    const plan3 = await inject(
      "POST",
      `/video-redraw/projects/${p.id}/storyboard/plan`,
      { episode_id: episodeId, shot_duration_s: 10 },
      u.token,
    );
    expect((plan3.data as { shots: number }).shots).toBe(6);

    // 缺 episode_id → 400101；不存在的集 → 400102
    const noEp = await inject("POST", `/video-redraw/projects/${p.id}/storyboard/plan`, {}, u.token);
    expect(noEp.code).toBe(400101);
    const ghostEp = await inject(
      "POST",
      `/video-redraw/projects/${p.id}/storyboard/plan`,
      { episode_id: "123456789012345678" },
      u.token,
    );
    expect(ghostEp.code).toBe(400102);
  });

  // ── 5. 积分预估 ─────────────────────────────────────────
  it("积分预估：unit×shots 与余额比较；不足时 sufficient=false（只试算，不冻结）", async () => {
    const owner = await loginNewUser("85");
    const spaceId = await createTeam(owner.userId, 100, "预估团队");
    const p = await createRedrawProject(owner.token, spaceId);
    const ep = await inject("POST", `/video-redraw/projects/${p.id}/episodes`, {}, owner.token, spaceId);
    const episodeId = (ep.data as { id: string }).id;
    await inject(
      "POST",
      `/video-redraw/projects/${p.id}/storyboard/plan`,
      { episode_id: episodeId, shot_duration_s: 5 },
      owner.token,
      spaceId,
    );

    const point = await inject("POST", `/video-redraw/projects/${p.id}/point`, {}, owner.token, spaceId);
    expect(point.code).toBe(0);
    const d = point.data as {
      shots: number;
      unit_credits: number;
      total_credits: number;
      sufficient: boolean;
      balance: number;
      model: string;
    };
    expect(d.shots).toBe(12);
    expect(d.unit_credits).toBeGreaterThan(0);
    expect(d.total_credits).toBe(d.unit_credits * d.shots);
    expect(d.balance).toBe(100);
    expect(d.sufficient).toBe(d.balance >= d.total_credits);
    expect(d.model.length).toBeGreaterThan(0);

    // 试算不冻结：余额/冻结都不变
    const after = await balanceOf(spaceId);
    expect(after).toEqual({ balance: 100, frozen: 0 });
    expect(await freezeFlowCount(spaceId)).toBe(0);

    // 余额不足的场景：把余额清零后再预估
    await db.execute(sql`update credit_accounts set balance = 0 where space_id = ${BigInt(spaceId)}`);
    const poor = await inject("POST", `/video-redraw/projects/${p.id}/point`, {}, owner.token, spaceId);
    expect((poor.data as { sufficient: boolean }).sufficient).toBe(false);

    const badShots = await inject("POST", `/video-redraw/projects/${p.id}/point`, { shots: 0 }, owner.token, spaceId);
    expect(badShots.code).toBe(400101);
  });

  // ── 6. 生成：记账 + 幂等 ────────────────────────────────
  it("生成重绘产物：走 credits 冻结（余额降、frozen 升）+ 落 project_assets 与分镜任务 id；同幂等键不重复扣费", async () => {
    const owner = await loginNewUser("86");
    const spaceId = await createTeam(owner.userId, 500, "生成团队");
    const p = await createRedrawProject(owner.token, spaceId);
    const ep = await inject("POST", `/video-redraw/projects/${p.id}/episodes`, {}, owner.token, spaceId);
    const episodeId = (ep.data as { id: string }).id;
    const plan = await inject(
      "POST",
      `/video-redraw/projects/${p.id}/storyboard/plan`,
      { episode_id: episodeId, shot_duration_s: 5 },
      owner.token,
      spaceId,
    );
    const shotIds = (plan.data as { list: Array<{ id: string }> }).list.map((s) => s.id);

    const before = await balanceOf(spaceId);
    const gen = await inject(
      "POST",
      `/video-redraw/projects/${p.id}/resources/generate`,
      { storyboard_ids: [shotIds[0]], target: "image" },
      owner.token,
      spaceId,
    );
    expect(gen.code).toBe(0);
    const g = gen.data as { count: number; tasks: Array<{ storyboard_id: string; project_asset_id: string; task_id: string }> };
    expect(g.count).toBe(1);
    expect(g.tasks[0]!.task_id.length).toBeGreaterThan(0);

    const after = await balanceOf(spaceId);
    // "不白送"：余额必须减少、冻结必须增加，且金额一致（冻结 = 报价）
    expect(after.balance).toBeLessThan(before.balance);
    const frozenCost = before.balance - after.balance;
    expect(after.frozen).toBe(frozenCost);
    expect(await freezeFlowCount(spaceId)).toBe(1);

    // 任务与资产落库
    const assetRow = (await db.execute(
      sql`select id, kind, source_task_id from project_assets where id = ${BigInt(g.tasks[0]!.project_asset_id)}`,
    )) as { rows?: Array<{ kind: string; source_task_id: string }> };
    expect(assetRow.rows?.[0]?.kind).toBe("redraw");
    expect(String(assetRow.rows?.[0]?.source_task_id)).toBe(g.tasks[0]!.task_id);
    const shotRow = (await db.execute(
      sql`select image_task_id, status from storyboards where id = ${BigInt(shotIds[0]!)}`,
    )) as { rows?: Array<{ image_task_id: string | null; status: number }> };
    expect(String(shotRow.rows?.[0]?.image_task_id)).toBe(g.tasks[0]!.task_id);
    expect(shotRow.rows?.[0]?.status).toBe(3);

    // 幂等：同一镜 + 同 target（默认幂等键）再点一次 → 同一个 task_id，且不再冻结
    const again = await inject(
      "POST",
      `/video-redraw/projects/${p.id}/resources/generate`,
      { storyboard_ids: [shotIds[0]], target: "image" },
      owner.token,
      spaceId,
    );
    expect(again.code).toBe(0);
    expect((again.data as { tasks: Array<{ task_id: string }> }).tasks[0]!.task_id).toBe(g.tasks[0]!.task_id);
    expect(await freezeFlowCount(spaceId)).toBe(1);
    expect(await balanceOf(spaceId)).toEqual(after);
  });

  it("生成：余额不足 → 745701；没有分镜 → 400101", async () => {
    const owner = await loginNewUser("87");
    const spaceId = await createTeam(owner.userId, 0, "空余额团队");
    const p = await createRedrawProject(owner.token, spaceId);
    const ep = await inject("POST", `/video-redraw/projects/${p.id}/episodes`, {}, owner.token, spaceId);
    const episodeId = (ep.data as { id: string }).id;

    // 没分镜就生成 → 400101（前置校验，不该进入报价）
    const noShots = await inject(
      "POST",
      `/video-redraw/projects/${p.id}/resources/generate`,
      { episode_id: episodeId },
      owner.token,
      spaceId,
    );
    expect(noShots.code).toBe(400101);

    const plan = await inject(
      "POST",
      `/video-redraw/projects/${p.id}/storyboard/plan`,
      { episode_id: episodeId, shot_duration_s: 5 },
      owner.token,
      spaceId,
    );
    const shotId = (plan.data as { list: Array<{ id: string }> }).list[0]!.id;

    const poor = await inject(
      "POST",
      `/video-redraw/projects/${p.id}/resources/generate`,
      { storyboard_ids: [shotId] },
      owner.token,
      spaceId,
    );
    expect(poor.code).toBe(745701);
    // 失败不产生冻结流水
    expect(await freezeFlowCount(spaceId)).toBe(0);
  });

  // ── 7. 绑定（快照语义）──────────────────────────────────
  it("绑定：自动绑定已生成产物；显式 binds 是快照覆盖（先删后插，sort 落列）", async () => {
    const owner = await loginNewUser("88");
    const spaceId = await createTeam(owner.userId, 500, "绑定团队");
    const p = await createRedrawProject(owner.token, spaceId);
    const ep = await inject("POST", `/video-redraw/projects/${p.id}/episodes`, {}, owner.token, spaceId);
    const episodeId = (ep.data as { id: string }).id;
    const plan = await inject(
      "POST",
      `/video-redraw/projects/${p.id}/storyboard/plan`,
      { episode_id: episodeId, shot_duration_s: 10 },
      owner.token,
      spaceId,
    );
    const shots = (plan.data as { list: Array<{ id: string }> }).list;
    const gen = await inject(
      "POST",
      `/video-redraw/projects/${p.id}/resources/generate`,
      { storyboard_ids: [shots[0]!.id, shots[1]!.id] },
      owner.token,
      spaceId,
    );
    const tasks = (gen.data as { tasks: Array<{ project_asset_id: string }> }).tasks;

    // 自动绑定：把已生成的产物按 name 约定绑回各自镜
    const auto = await inject(
      "POST",
      `/video-redraw/projects/${p.id}/asset/bind`,
      { episode_id: episodeId },
      owner.token,
      spaceId,
    );
    expect(auto.code).toBe(0);
    expect((auto.data as { bound: number }).bound).toBe(2);

    const boundRows = (await db.execute(
      sql`select storyboard_id, project_asset_id, sort from storyboard_assets sa
          join storyboards s on s.id = sa.storyboard_id
          where s.episode_id = ${BigInt(episodeId)} order by storyboard_id, sort`,
    )) as { rows?: Array<{ storyboard_id: string; project_asset_id: string; sort: number }> };
    expect(boundRows.rows?.length).toBe(2);

    // 快照覆盖：把第 1 镜的绑定替换成第 2 镜的产物 → 该镜只剩 1 条，且指向新资产
    const explicit = await inject(
      "POST",
      `/video-redraw/projects/${p.id}/asset/bind`,
      { binds: [{ storyboard_id: shots[0]!.id, project_asset_ids: [tasks[1]!.project_asset_id, tasks[0]!.project_asset_id] }] },
      owner.token,
      spaceId,
    );
    expect(explicit.code).toBe(0);
    const after = (await db.execute(
      sql`select project_asset_id, sort from storyboard_assets where storyboard_id = ${BigInt(shots[0]!.id)} order by sort`,
    )) as { rows?: Array<{ project_asset_id: string; sort: number }> };
    expect(after.rows?.length).toBe(2);
    // sort 显式落列且保持传入顺序（顺序影响提示词里 [[@img1]] 的编号）
    expect(after.rows?.map((r) => String(r.project_asset_id))).toEqual([
      tasks[1]!.project_asset_id,
      tasks[0]!.project_asset_id,
    ]);
    expect(after.rows?.map((r) => r.sort)).toEqual([0, 1]);

    // 绑别人的资产 → 400102（不泄露存在性）
    const other = await loginNewUser("89");
    const otherSpace = await createTeam(other.userId, 100, "别人团队");
    const otherProject = await createRedrawProject(other.token, otherSpace);
    const otherEp = await inject("POST", `/video-redraw/projects/${otherProject.id}/episodes`, {}, other.token, otherSpace);
    const otherEpId = (otherEp.data as { id: string }).id;
    const otherPlan = await inject(
      "POST",
      `/video-redraw/projects/${otherProject.id}/storyboard/plan`,
      { episode_id: otherEpId },
      other.token,
      otherSpace,
    );
    const otherShot = (otherPlan.data as { list: Array<{ id: string }> }).list[0]!.id;
    const otherGen = await inject(
      "POST",
      `/video-redraw/projects/${otherProject.id}/resources/generate`,
      { storyboard_ids: [otherShot] },
      other.token,
      otherSpace,
    );
    const otherAsset = (otherGen.data as { tasks: Array<{ project_asset_id: string }> }).tasks[0]!.project_asset_id;

    const steal = await inject(
      "POST",
      `/video-redraw/projects/${p.id}/asset/bind`,
      { binds: [{ storyboard_id: shots[0]!.id, project_asset_ids: [otherAsset] }] },
      owner.token,
      spaceId,
    );
    expect(steal.code).toBe(400102);
  });

  // ── 8. 跨 space / 跨模式 ────────────────────────────────
  it("跨 space：别人的转绘项目一律 404；非成员带该 X-Space-Id 被守卫拒绝 403101", async () => {
    const owner = await loginNewUser("91");
    const outsider = await loginNewUser("92");
    const spaceId = await createTeam(owner.userId, 100, "隔离团队");
    const p = await createRedrawProject(owner.token, spaceId);

    const peek = await inject("GET", `/video-redraw/projects/${p.id}`, undefined, outsider.token);
    expect(peek.code).toBe(400102);

    const peekWithHeader = await inject("GET", `/video-redraw/projects/${p.id}`, undefined, outsider.token, spaceId);
    expect(peekWithHeader.code).toBe(403101);

    // 列表只看到自己的（跨 space 不串）
    const list = await inject("GET", "/video-redraw/projects", undefined, outsider.token);
    expect(list.code).toBe(0);
    expect((list.data as { list: Array<{ id: string }> }).list.some((x) => x.id === p.id)).toBe(false);
  });

  it("跨模式：普通剧本项目（project_mode=1）调转绘端点返回 404（不泄露项目存在）", async () => {
    const u = await loginNewUser("93");
    // 用既有剧本端点建一个普通项目（`ScriptController` 是 @Controller() 无前缀 → `/v1/projects`）
    const normal = await inject("POST", "/projects", { title: `普通剧本${Date.now()}` }, u.token);
    expect(normal.code).toBe(0);
    const pid = (normal.data as { id: string }).id;
    const res = await inject("GET", `/video-redraw/projects/${pid}`, undefined, u.token);
    expect(res.code).toBe(400102);
    // 转绘列表里也不会出现普通项目（project_mode=3 过滤）
    const list = await inject("GET", "/video-redraw/projects", undefined, u.token);
    expect((list.data as { list: Array<{ id: string }> }).list.some((x) => x.id === pid)).toBe(false);
  });

  // ── 9. 参数校验 ─────────────────────────────────────────
  it("参数校验：非法 project id / 空 title / 非法 target 都落到 400xxx，不 500", async () => {
    const u = await loginNewUser("94");
    const notFound = await inject("GET", "/video-redraw/projects/not-a-number", undefined, u.token);
    expect(notFound.code).toBe(400102);

    const emptyTitle = await inject("POST", "/video-redraw/projects", { title: "", source_uri: "s3://a.mp4" }, u.token);
    expect(emptyTitle.code).toBe(400101);

    const p = await createRedrawProject(u.token, u.spaceId);
    const badTarget = await inject("POST", `/video-redraw/projects/${p.id}/point`, { target: "pdf" }, u.token);
    expect(badTarget.code).toBe(400101);

    const badBind = await inject("POST", `/video-redraw/projects/${p.id}/asset/bind`, { binds: [] }, u.token);
    expect(badBind.code).toBe(400101);
  });
});
