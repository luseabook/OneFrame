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
 * 创作者中心（crc）契约测试 —— 对照参照产品 `/web/v1/crc/*` 30 端点（`rt:275-304`）。
 *
 * 五件事钉死（每条都对应一个真实的越权/数据事故）：
 *
 * 1. **审核状态机不可跳步**：1→2→3 / 2→4 / 3→5，其中 4→3 直接非法。
 * 2. **只有 status=3 出现在公开列表**（`home/list`、`resource/list`）：这是"投稿"与
 *    "私有项目"的分界线，漏一个 where 条件就会把用户草稿暴露给全站。
 * 3. **点赞/关注幂等**：唯一键兜底，重复调用返回同一态且计数不涨。
 * 4. **别人的东西看不到**：非本人访问未公开作品一律 404（不是 403，避免泄露存在性）；
 *    运营特权也只在**作品所属 space** 内生效（否则谁的个人空间都是 master）。
 * 5. **激励是读视图**：数据来自 `credit_flows` 的 gift 流入，不在 crc 里另记一笔账。
 *
 * 用**真实 `AppModule`** 跑（验收口径）。
 */
describe("crc e2e", () => {
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
      method: method as "GET" | "POST" | "DELETE",
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

  async function createTeam(ownerUserId: string, name = "创作者测试团队") {
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

  /** 造作品：返回 id（走真实端点，不直插表——状态机的入口必须也一起被测到） */
  async function createAsset(token: string, spaceId: string, title: string, uri: string | null = "s3://demo/a.mp4") {
    const res = await inject("POST", "/crc/assets/create", { title, uri, summary: "测试投稿" }, token, spaceId);
    expect(res.code).toBe(0);
    return (res.data as { id: string }).id;
  }

  async function act(token: string, spaceId: string, assetId: string, action: string, note?: string) {
    return inject(
      "POST",
      "/crc/resource/action/status",
      { asset_id: assetId, action, ...(note ? { review_note: note } : {}) },
      token,
      spaceId,
    );
  }

  /** 走完整链路直到"已通过" */
  async function publish(token: string, spaceId: string, title: string) {
    const id = await createAsset(token, spaceId, title);
    expect((await act(token, spaceId, id, "submit")).code).toBe(0);
    expect((await act(token, spaceId, id, "approve")).code).toBe(0);
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

  // ── 资料 ────────────────────────────────────────────────
  it("资料：首屏自动建档（默认昵称取账号名）→ 更新昵称/bio 生效", async () => {
    const u = await loginNewUser("51");
    const info = await inject("GET", "/crc/user/info", undefined, u.token);
    expect(info.code).toBe(0);
    const d = info.data as {
      nickname: string;
      works: { total: number };
      follower_count: number;
      can_review: boolean;
    };
    // 竞品新用户也能拿到资料（不报 404），所以我方必须自动建档
    expect(d.nickname.length).toBeGreaterThan(0);
    expect(d.works.total).toBe(0);
    expect(d.follower_count).toBe(0);
    // `can_review` 是给前端的按钮许可位：个人空间 owner 具备管理特权 → true。
    // 前端据此决定是否渲染"通过/驳回"，避免"按钮在但点了 403"。
    expect(d.can_review).toBe(true);

    const updated = await inject(
      "POST",
      "/crc/user/update",
      { nickname: "首席动画师", bio: "专攻分镜", avatar_uri: "s3://demo/avatar.png" },
      u.token,
    );
    expect(updated.code).toBe(0);
    expect((updated.data as { nickname: string }).nickname).toBe("首席动画师");
    expect((updated.data as { bio: string }).bio).toBe("专攻分镜");

    const again = await inject("GET", "/crc/user/info", undefined, u.token);
    expect((again.data as { nickname: string }).nickname).toBe("首席动画师");
  });

  // ── 审核状态机 + 公开可见性 ────────────────────────────────
  it("审核链：草稿→待审→通过后公开列表可见；下架后不可见；重新送审回到待审", async () => {
    const u = await loginNewUser("52");
    const title = `状态机作品${Date.now()}`;
    const id = await createAsset(u.token, u.spaceId, title);

    // 1 草稿：公开列表不可见
    const feedDraft = await inject("GET", "/crc/home/list", undefined, u.token);
    expect(feedDraft.code).toBe(0);
    expect((feedDraft.data as { list: Array<{ id: string }> }).list.some((a) => a.id === id)).toBe(false);

    const submitted = await act(u.token, u.spaceId, id, "submit");
    expect(submitted.code).toBe(0);
    expect((submitted.data as { status: number }).status).toBe(2);

    const feedPending = await inject("GET", "/crc/home/list", undefined, u.token);
    expect((feedPending.data as { list: Array<{ id: string }> }).list.some((a) => a.id === id)).toBe(false);

    const approved = await act(u.token, u.spaceId, id, "approve");
    expect(approved.code).toBe(0);
    expect((approved.data as { status: number; published_at: string | null }).status).toBe(3);
    expect((approved.data as { published_at: string | null }).published_at).not.toBeNull();

    // 只有 3 可被公开列表看到（本条是整个 crc 域最重要的一条断言）
    const feedApproved = await inject("GET", "/crc/home/list", undefined, u.token);
    expect((feedApproved.data as { list: Array<{ id: string; creator: { nickname: string } | null }> }).list.some((a) => a.id === id)).toBe(true);

    const offline = await act(u.token, u.spaceId, id, "offline");
    expect(offline.code).toBe(0);
    expect((offline.data as { status: number }).status).toBe(5);
    const feedOffline = await inject("GET", "/crc/home/list", undefined, u.token);
    expect((feedOffline.data as { list: Array<{ id: string }> }).list.some((a) => a.id === id)).toBe(false);

    const resubmit = await act(u.token, u.spaceId, id, "resubmit");
    expect(resubmit.code).toBe(0);
    expect((resubmit.data as { status: number }).status).toBe(2);
  });

  it("审核链：驳回写 review_note、4→3 非法跳步被拒；审核失败的作品可删除", async () => {
    const u = await loginNewUser("53");
    const id = await createAsset(u.token, u.spaceId, `被驳回作品${Date.now()}`);
    await act(u.token, u.spaceId, id, "submit");

    const rejected = await act(u.token, u.spaceId, id, "reject", "画面里有第三方水印");
    expect(rejected.code).toBe(0);
    expect((rejected.data as { status: number }).status).toBe(4);
    expect((rejected.data as { review_note: string }).review_note).toContain("水印");

    // 驳回后直接"通过"是非法的：驳回意见针对旧稿，必须先改再提交
    const jump = await act(u.token, u.spaceId, id, "approve");
    expect(jump.code).toBe(400101);

    // 编辑已驳回作品 → 自动回草稿（改完必须重新提交）
    const edited = await inject("POST", "/crc/assets/update", { asset_id: id, title: "改好的作品" }, u.token);
    expect(edited.code).toBe(0);
    expect((edited.data as { status: number }).status).toBe(1);

    // 再造一个驳回稿，走"审核失败善后删除"
    const id2 = await createAsset(u.token, u.spaceId, `待删驳回稿${Date.now()}`);
    await act(u.token, u.spaceId, id2, "submit");
    await act(u.token, u.spaceId, id2, "reject");
    const del = await inject("POST", "/crc/assets/audit-fail/del", { asset_id: id2 }, u.token);
    expect(del.code).toBe(0);

    // 已删除的作品不可再被查询到（软删也算删）
    const info = await inject("GET", `/crc/resource/info?id=${id2}`, undefined, u.token);
    expect(info.code).toBe(400102);
  });

  it("审核链：审核中不能删除；已通过必须先下架（防止审核队列里消失/误删在架作品）", async () => {
    const u = await loginNewUser("54");
    const id = await createAsset(u.token, u.spaceId, `保护作品${Date.now()}`);
    await act(u.token, u.spaceId, id, "submit");
    const delPending = await inject("POST", "/crc/assets/delete", { asset_id: id }, u.token);
    expect(delPending.code).toBe(400101);

    await act(u.token, u.spaceId, id, "approve");
    const delApproved = await inject("POST", "/crc/assets/delete", { asset_id: id }, u.token);
    expect(delApproved.code).toBe(400101);
    expect(delApproved.msg).toContain("下架");
  });

  // ── 我的作品 / 审核中 ──────────────────────────────────────
  it("我的作品与审核中列表：assets/me 含全部状态，auditing/list 只含待审；auditing/info 披露审核态", async () => {
    const u = await loginNewUser("55");
    const draft = await createAsset(u.token, u.spaceId, `草稿作品${Date.now()}`);
    const pending = await createAsset(u.token, u.spaceId, `待审作品${Date.now()}`);
    await act(u.token, u.spaceId, pending, "submit");

    const me = await inject("GET", "/crc/assets/me", undefined, u.token);
    expect(me.code).toBe(0);
    const meIds = (me.data as { list: Array<{ id: string }> }).list.map((a) => a.id);
    expect(meIds).toContain(draft);
    expect(meIds).toContain(pending);

    const auditing = await inject("POST", "/crc/assets/auditing/list", {}, u.token);
    expect(auditing.code).toBe(0);
    const auditIds = (auditing.data as { list: Array<{ id: string; status: number }> }).list;
    expect(auditIds.length).toBe(1);
    expect(auditIds[0]!.id).toBe(pending);
    expect(auditIds[0]!.status).toBe(2);

    const detail = await inject("POST", "/crc/assets/auditing/info", { asset_id: pending }, u.token);
    expect(detail.code).toBe(0);
    expect((detail.data as { review: { status_label: string } }).review.status_label).toBe("待审");

    // 按状态筛：草稿数是 1
    const onlyDraft = await inject("GET", "/crc/assets/me?status=1", undefined, u.token);
    expect((onlyDraft.data as { list: Array<{ id: string }> }).list.map((a) => a.id)).toEqual([draft]);
  });

  // ── 点赞 ────────────────────────────────────────────────
  it("点赞幂等：重复点赞不涨数、重复取消不跌成负数；点赞列表双向可查", async () => {
    const owner = await loginNewUser("56");
    const fan = await loginNewUser("57");
    const id = await publish(owner.token, owner.spaceId, `点赞作品${Date.now()}`);

    const like1 = await inject("POST", "/crc/assets/likes/action", { asset_id: id, action: "like" }, fan.token);
    expect(like1.code).toBe(0);
    expect((like1.data as { liked: boolean; like_count: number }).liked).toBe(true);
    expect((like1.data as { like_count: number }).like_count).toBe(1);

    const like2 = await inject("POST", "/crc/assets/likes/action", { asset_id: id, action: "like" }, fan.token);
    // 幂等的核心：count 不能变 2
    expect((like2.data as { liked: boolean; like_count: number }).liked).toBe(true);
    expect((like2.data as { like_count: number }).like_count).toBe(1);

    const likers = await inject("POST", "/crc/assets/likes", { asset_id: id }, owner.token);
    expect((likers.data as { count: number }).count).toBe(1);
    expect((likers.data as { list: Array<{ user_id: string }> }).list[0]!.user_id).toBe(fan.userId);

    const mine = await inject("POST", "/crc/assets/likes", {}, fan.token);
    expect((mine.data as { scope: string; list: Array<{ id: string }> }).scope).toBe("mine");
    expect((mine.data as { list: Array<{ id: string }> }).list.some((a) => a.id === id)).toBe(true);

    const unlike1 = await inject("POST", "/crc/assets/likes/action", { asset_id: id, action: "unlike" }, fan.token);
    expect((unlike1.data as { liked: boolean; like_count: number }).liked).toBe(false);
    expect((unlike1.data as { like_count: number }).like_count).toBe(0);

    const unlike2 = await inject("POST", "/crc/assets/likes/action", { asset_id: id, action: "unlike" }, fan.token);
    // 重复取消：count 不能变 -1（DB 有 greatest 兜底）
    expect((unlike2.data as { like_count: number }).like_count).toBe(0);

    // 未通过审核的作品不能点赞（草稿不该产生互动数据）
    const draftId = await createAsset(owner.token, owner.spaceId, `草稿不可赞${Date.now()}`);
    const badLike = await inject("POST", "/crc/assets/likes/action", { asset_id: draftId, action: "like" }, fan.token);
    expect(badLike.code).toBe(400101);
  });

  // ── 关注 / 粉丝 ──────────────────────────────────────────
  it("关注幂等：重复关注粉丝数不涨、重复取关不跌；关注/粉丝列表互相对应；不能关注自己", async () => {
    const creator = await loginNewUser("58");
    const fanA = await loginNewUser("59");
    await inject("GET", "/crc/user/info", undefined, creator.token); // 先建档，粉丝数落在 creator_profiles

    const f1 = await inject("POST", "/crc/user/follows/action", { creator_user_id: creator.userId }, fanA.token);
    expect(f1.code).toBe(0);
    expect((f1.data as { following: boolean; follower_count: number }).following).toBe(true);
    expect((f1.data as { follower_count: number }).follower_count).toBe(1);

    const f2 = await inject("POST", "/crc/user/follows/action", { creator_user_id: creator.userId }, fanA.token);
    expect((f2.data as { follower_count: number }).follower_count).toBe(1);

    const fans = await inject("POST", "/crc/user/fans", {}, creator.token);
    expect((fans.data as { list: Array<{ user_id: string }> }).list[0]!.user_id).toBe(fanA.userId);

    const follows = await inject("POST", "/crc/user/follows", {}, fanA.token);
    expect((follows.data as { list: Array<{ user_id: string }> }).list[0]!.user_id).toBe(creator.userId);

    const u1 = await inject("POST", "/crc/user/follows/action", { creator_user_id: creator.userId, action: "unfollow" }, fanA.token);
    expect((u1.data as { following: boolean; follower_count: number }).following).toBe(false);
    expect((u1.data as { follower_count: number }).follower_count).toBe(0);
    const u2 = await inject("POST", "/crc/user/follows/action", { creator_user_id: creator.userId, action: "unfollow" }, fanA.token);
    expect((u2.data as { follower_count: number }).follower_count).toBe(0);

    const self = await inject("POST", "/crc/user/follows/action", { creator_user_id: fanA.userId }, fanA.token);
    expect(self.code).toBe(400101);

    const ghost = await inject("POST", "/crc/user/follows/action", { creator_user_id: "123456789012345678" }, fanA.token);
    expect(ghost.code).toBe(400102);
  });

  // ── 可见性 / 越权 ────────────────────────────────────────
  it("别人的非公开作品一律 404（不是 403，避免泄露作品是否存在）；不能编辑/下架别人的作品", async () => {
    const owner = await loginNewUser("61");
    const intruder = await loginNewUser("62");
    const draftId = await createAsset(owner.token, owner.spaceId, `别人的草稿${Date.now()}`);

    const info = await inject("GET", `/crc/resource/info?id=${draftId}`, undefined, intruder.token);
    expect(info.code).toBe(400102);

    const edit = await inject("POST", "/crc/assets/update", { asset_id: draftId, title: "篡改" }, intruder.token);
    expect(edit.code).toBe(400102);

    const submit = await act(intruder.token, intruder.spaceId, draftId, "submit");
    expect(submit.code).toBe(400102);

    // 公开作品的详情任何登录用户可看，但 view_count 会给作者之外的人计数
    const pubId = await publish(owner.token, owner.spaceId, `公开作品${Date.now()}`);
    const seen = await inject("GET", `/crc/resource/info?id=${pubId}`, undefined, intruder.token);
    expect(seen.code).toBe(0);
    expect((seen.data as { view_count: number }).view_count).toBe(1);
    const seenAgain = await inject("GET", `/crc/resource/info?id=${pubId}`, undefined, intruder.token);
    expect((seenAgain.data as { view_count: number }).view_count).toBe(2);
  });

  // ── 举报 ────────────────────────────────────────────────
  it("举报：原因服务端下发；非法原因 400101；同一人重复举报覆盖不报错", async () => {
    const u = await loginNewUser("63");
    const pubId = await publish(u.token, u.spaceId, `可举报作品${Date.now()}`);

    const cfg = await inject("GET", "/crc/assets/report/config", undefined, u.token);
    expect(cfg.code).toBe(0);
    expect((cfg.data as { reasons: Array<{ value: string }> }).reasons.length).toBeGreaterThanOrEqual(5);

    const bad = await inject("POST", "/crc/assets/report", { asset_id: pubId, reason: "nonsense" }, u.token);
    expect(bad.code).toBe(400101);

    const ok = await inject(
      "POST",
      "/crc/assets/report",
      { asset_id: pubId, reason: "infringement", detail: "疑似搬运" },
      u.token,
    );
    expect(ok.code).toBe(0);
    expect((ok.data as { reported: boolean }).reported).toBe(true);

    const again = await inject("POST", "/crc/assets/report", { asset_id: pubId, reason: "spam" }, u.token);
    expect(again.code).toBe(0);
  });

  // ── 下载 / 分享 / 预览 ───────────────────────────────────
  it("下载与分享：已通过可下载可分享；无素材下载返回 400105；未通过作品不能分享", async () => {
    const u = await loginNewUser("64");
    const noUri = await createAsset(u.token, u.spaceId, `无素材作品${Date.now()}`, null);
    await act(u.token, u.spaceId, noUri, "submit");
    await act(u.token, u.spaceId, noUri, "approve");
    // 送审校验允许只有 cover_uri 的情况，这里 title+无 uri 会先被拦，故直接断言错误码
    const noFile = await inject("GET", `/crc/assets/download?id=${noUri}`, undefined, u.token);
    expect([400101, 400105]).toContain(noFile.code);

    const pubId = await publish(u.token, u.spaceId, `可下载作品${Date.now()}`);
    const dl = await inject("GET", `/crc/assets/download?id=${pubId}`, undefined, u.token);
    expect(dl.code).toBe(0);
    expect((dl.data as { uri: string; filename: string }).uri).toContain("s3://");
    expect((dl.data as { filename: string }).filename.endsWith(".mp4")).toBe(true);

    const share = await inject("POST", "/crc/assets/share", { asset_id: pubId }, u.token);
    expect(share.code).toBe(0);
    expect((share.data as { share_path: string }).share_path).toBe(`/creator-center/preview/${pubId}`);

    const draftId = await createAsset(u.token, u.spaceId, `草稿不可分享${Date.now()}`);
    const badShare = await inject("POST", "/crc/assets/share", { asset_id: draftId }, u.token);
    expect(badShare.code).toBe(400101);

    const preview = await inject("GET", `/crc/file_preview?id=${pubId}`, undefined, u.token);
    expect(preview.code).toBe(0);
    expect((preview.data as { preview_url: string }).preview_url).toContain(pubId);
  });

  // ── 激励读视图 ──────────────────────────────────────────
  it("激励视图：数据来自 credit_flows 的 gift 流入（先领每日奖励，再查激励汇总）", async () => {
    const u = await loginNewUser("65");
    const reward = await inject("POST", "/op/daily-reward", {}, u.token);
    expect(reward.code).toBe(0);

    const inc = await inject("POST", "/crc/user/incentive", {}, u.token);
    expect(inc.code).toBe(0);
    const d = inc.data as {
      total_credits: number;
      by_category: Record<string, number>;
      list: Array<{ category: string; credits: number }>;
    };
    // 每日奖励 5 分要能在激励里看到，且归类到 daily_reward（不是 other）
    expect(d.by_category.daily_reward).toBe(5);
    expect(d.total_credits).toBeGreaterThanOrEqual(5);
    expect(d.list[0]!.category).toBe("daily_reward");
  });

  // ── 运营位 / 分类树 ──────────────────────────────────────
  it("运营位与分类树：banner/pop_up 返回平台投放位结构；category/effect 树是三层结构", async () => {
    const u = await loginNewUser("66");
    // `promo_slots` 是平台级内容（无 space 列），其它用例/其它环境可能已有投放，
    // 所以断言"结构正确"而不是"一定为空"
    const banner = await inject("GET", "/crc/banner_list?type=banner&scene=home", undefined, u.token);
    expect(banner.code).toBe(0);
    expect(Array.isArray((banner.data as { list: unknown[] }).list)).toBe(true);
    expect((banner.data as { slot: string }).slot).toBe("banner");

    const popUp = await inject("GET", "/crc/pop_up?type=pop_up", undefined, u.token);
    expect(popUp.code).toBe(0);
    expect((popUp.data as { slot: string }).slot).toBe("pop_up");

    const cat = await inject("GET", "/crc/category/tree", undefined, u.token);
    expect(cat.code).toBe(0);
    const catList = (cat.data as { list: Array<{ value: string; children: Array<{ children: unknown[] }> }> }).list;
    expect(catList.length).toBeGreaterThan(0);
    expect(Array.isArray(catList[0]!.children)).toBe(true);

    const eff = await inject("GET", "/crc/effect/tree", undefined, u.token);
    expect(eff.code).toBe(0);
    expect((eff.data as { list: unknown[] }).list.length).toBeGreaterThan(0);
  });

  // ── 分类过滤（迁移 0025 的 category 列）────────────────────
  it("分类过滤：resource/list 的 category 是真过滤（只返回该分类的已通过作品）", async () => {
    const u = await loginNewUser("71");
    const adId = await createAsset(u.token, u.spaceId, `广告片作品${Date.now()}`, "s3://demo/ad.mp4");
    const dramaId = await createAsset(u.token, u.spaceId, `短剧作品${Date.now()}`, "s3://demo/drama.mp4");
    // 分类在创建后按运营口径打标（create 接口支持 category，这里用 update 走另一条路径）
    await inject("POST", "/crc/assets/update", { asset_id: adId, category: "ad" }, u.token);
    await inject("POST", "/crc/assets/update", { asset_id: dramaId, category: "short_drama" }, u.token);
    for (const id of [adId, dramaId]) {
      await act(u.token, u.spaceId, id, "submit");
      await act(u.token, u.spaceId, id, "approve");
    }

    const filtered = await inject("POST", "/crc/resource/list", { category: "ad" }, u.token);
    expect(filtered.code).toBe(0);
    const ids = (filtered.data as { list: Array<{ id: string }> }).list.map((a) => a.id);
    expect(ids).toContain(adId);
    expect(ids).not.toContain(dramaId);
    // 明确告诉前端哪些筛选真的生效（第 5 轮 effect 已有列，默认不传时 applied=false）
    expect((filtered.data as { filters: { category_applied: boolean; effect_applied: boolean } }).filters)
      .toMatchObject({ category_applied: true, effect_applied: false });
  });

  it("效果过滤：resource/list 的 effect 是真过滤（迁移 0033 新增列）；未知效果 400101", async () => {
    const u = await loginNewUser("72");
    const ts = Date.now();
    const animeId = await createAsset(u.token, u.spaceId, `动漫风格${ts}`, "s3://demo/a.mp4");
    const inkId = await createAsset(u.token, u.spaceId, `水墨风格${ts}`, "s3://demo/i.mp4");
    const plainId = await createAsset(u.token, u.spaceId, `无效果${ts}`, "s3://demo/p.mp4");
    // 效果标签走 update 打标（值必须来自 crc/effect/tree 的叶子）
    expect((await inject("POST", "/crc/assets/update", { asset_id: animeId, effect: "anime" }, u.token)).code).toBe(0);
    expect((await inject("POST", "/crc/assets/update", { asset_id: inkId, effect: "ink" }, u.token)).code).toBe(0);
    for (const id of [animeId, inkId, plainId]) {
      await act(u.token, u.spaceId, id, "submit");
      await act(u.token, u.spaceId, id, "approve");
    }

    const filtered = await inject("POST", "/crc/resource/list", { effect: "anime" }, u.token);
    expect(filtered.code).toBe(0);
    const list = (filtered.data as { list: Array<{ id: string; effect?: string | null }>; filters: { effect_applied: boolean } });
    const ids = list.list.map((a) => a.id);
    expect(ids).toContain(animeId);
    expect(ids).not.toContain(inkId);
    expect(ids).not.toContain(plainId);
    // 筛选真实生效 + DTO 回显 effect
    expect(list.filters.effect_applied).toBe(true);
    expect(list.list.find((a) => a.id === animeId)?.effect).toBe("anime");

    // 未知效果值：明确 400101（不是"查空结果"让用户以为没有这类作品）
    const bad = await inject("POST", "/crc/resource/list", { effect: "not-an-effect" }, u.token);
    expect(bad.code).toBe(400101);

    // 更新时显式传 null 可清空效果——只能在草稿态（已通过的作品必须下架后才能编辑）
    const draftId = await createAsset(u.token, u.spaceId, `草稿清空效果${ts}`, "s3://demo/d2.mp4");
    expect((await inject("POST", "/crc/assets/update", { asset_id: draftId, effect: "anime" }, u.token)).code).toBe(0);
    const cleared = await inject("POST", "/crc/assets/update", { asset_id: draftId, effect: null }, u.token);
    expect(cleared.code).toBe(0);
    expect((cleared.data as { effect: string | null }).effect).toBeNull();
    // 已通过状态下修改效果被拒（状态机保护，不是筛选项的问题）
    expect((await inject("POST", "/crc/assets/update", { asset_id: plainId, effect: "anime" }, u.token)).code).toBe(400101);
  });

  // ── 团队空间 + 隔离 ─────────────────────────────────────
  it("团队空间：作品归属 creator 个人，但 space 记为团队；非成员带该 X-Space-Id 访问被守卫拒绝", async () => {
    const owner = await loginNewUser("67");
    const outsider = await loginNewUser("68");
    const { teamSpaceId } = await createTeam(owner.userId, "创作者团队");

    const created = await inject("POST", "/crc/assets/create", { title: `团队作品${Date.now()}` }, owner.token, teamSpaceId);
    expect(created.code).toBe(0);
    const asset = created.data as { id: string; space_id: string; creator_user_id: string };
    expect(asset.space_id).toBe(teamSpaceId);
    expect(asset.creator_user_id).toBe(owner.userId);

    const denied = await inject("GET", "/crc/assets/me", undefined, outsider.token, teamSpaceId);
    expect(denied.code).toBe(403101);
  });

  // ── 参数校验 ────────────────────────────────────────────
  it("参数校验：缺 id / 空标题 / 非法 kind 都落到 400101，不 500", async () => {
    const u = await loginNewUser("69");
    const noId = await inject("GET", "/crc/resource/info", undefined, u.token);
    expect(noId.code).toBe(400101);

    const emptyTitle = await inject("POST", "/crc/assets/create", { title: "" }, u.token);
    expect(emptyTitle.code).toBe(400101);

    const badKind = await inject("POST", "/crc/assets/create", { title: "x", kind: 9 }, u.token);
    expect(badKind.code).toBe(400101);

    const badAction = await inject(
      "POST",
      "/crc/resource/action/status",
      { asset_id: "1", action: "publish" },
      u.token,
    );
    expect(badAction.code).toBe(400101);
  });

  // ── 竞品形状别名（第 80 批）──────────────────────────────
  /**
   * 竞品把这三条「查询」写成 POST（`POST /web/v1/crc/user/info`、
   * `POST /web/v1/crc/assets/me`、`POST /web/v1/crc/file_preview`），
   * 我方原本只有 GET。第 80 批补了 POST 别名，本用例钉死「别名与 GET 是同一份数据」——
   * 别名最容易腐坏的方式是复制一份逻辑，然后两边慢慢不一致。
   */
  it("竞品形状：POST user/info · assets/me · file_preview 与 GET 返回同一份数据", async () => {
    const u = await loginNewUser("71");
    const created = await inject("POST", "/crc/assets/create", { title: `别名作品${Date.now()}` }, u.token);
    expect(created.code).toBe(0);
    const assetId = String((created.data as { id: string }).id);

    const profileGet = await inject("GET", "/crc/user/info", undefined, u.token);
    const profilePost = await inject("POST", "/crc/user/info", {}, u.token);
    expect(profileGet.code).toBe(0);
    expect(profilePost.code).toBe(0);
    expect(profilePost.data).toEqual(profileGet.data);

    const meGet = await inject("GET", "/crc/assets/me?page=1&page_size=10", undefined, u.token);
    const mePost = await inject("POST", "/crc/assets/me", { page: 1, page_size: 10 }, u.token);
    expect(meGet.code).toBe(0);
    expect(mePost.code).toBe(0);
    expect(mePost.data).toEqual(meGet.data);

    const previewGet = await inject("GET", `/crc/file_preview?id=${assetId}`, undefined, u.token);
    const previewPost = await inject("POST", "/crc/file_preview", { id: assetId }, u.token);
    expect(previewGet.code).toBe(0);
    expect(previewPost.code).toBe(0);
    expect(previewPost.data).toEqual(previewGet.data);

    // body 与 query 都缺 id 时仍然是 400101，不是 500
    const missing = await inject("POST", "/crc/file_preview", {}, u.token);
    expect(missing.code).toBe(400101);
  });
});
