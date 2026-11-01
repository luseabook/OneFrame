import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, inArray } from "drizzle-orm";
import {
  adminUsers,
  creditAccounts,
  creditFlows,
  identities,
  inviteCodes,
  inviteRedemptions,
  spaces,
  users,
  waitlistEntries,
} from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { db, pool } from "../src/db/database";
import { OpService } from "../src/modules/op/op.service";
import { encryptPhone, hashPhone } from "../src/modules/auth/crypto";

/**
 * P2 社区/用户面运营端点 e2e（契约 §2.1–§2.3）：用户管理 / 等待名单 / 邀请码。
 *
 * 覆盖的**行为契约**（实现可改，语义不可改）：
 * 1. `q` 三态：11 位手机号走 HMAC（不是明文 LIKE）、纯数字走 id、其它走昵称模糊；
 * 2. 手机号只出打码（`138****1234`），`phone_cipher` 解不开时该行 null 而不是整页 500；
 * 3. `space_id` 取个人空间（`spaces.owner_user_id = users.id`）；
 * 4. 已注销改状态 → 400101；restore 只对已注销生效，昵称传了才覆盖；
 * 5. 等待名单只回 `phone_hash_prefix`（平台没有明文），invite 幂等返回原时间；
 * 6. 邀请码批量生成 8 位无歧义码、`created_by` 是当前 admin、耗尽不可启用；
 * 7. 邀请码删除只对"从未核销"开放：未用可删、已用（含核销行存在但 used_count 仍是 0）拒绝、再删 400102；
 * 8. 删除与核销并发：真核销持锁未提交时删除被条件删除挡下；核销提交后条件不再成立 → 400101，
 *    码 / 核销行 / 积分不出现半状态（自由竞争下每张码也只有一个赢家）。
 *
 * 本机没有 PG 时这些用例会直接失败（与其余 admin e2e 同口径），
 * 所以契约 §5 规定验证只跑 typecheck/lint + 纯函数单测（`admin-invite-code.unit.spec.ts`）；
 * 本文件保证的是"有库时断言正确"，由 CI 执行。
 */
describe("ops admin P2 (users/waitlist/invite-codes)", () => {
  let app: NestFastifyApplication;
  let adminToken = "";
  let adminId = "";
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  /** 手机号必须 11 位且 1 开头（`/^1\d{10}$/` 才会走 HMAC 分支），用时间戳拼出唯一值 */
  const phoneTail = String(Date.now() % 1e8).padStart(8, "0");
  const phone = `139${phoneTail}`;
  /** 一个"没注册过"的手机号：同样符合 11 位格式，但 identities 里不存在 */
  const ghostPhone = `137${phoneTail}`;

  let userId = "";
  let userSpaceId = "";
  let deletedUserId = "";
  let waitlistId = "";
  const createdInviteCodeIds: string[] = [];
  const createdUserIds: string[] = [];

  const inject = async (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (adminToken) headers.authorization = `Bearer ${adminToken}`;
    const res = await app.inject({
      method,
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
      data: (body as { data?: any }).data,
      raw: res.body,
    };
  };

  /**
   * 等一条"真的在等行锁"的 SQL 出现。并发用例靠它确认删除/核销到了预期的阻塞点，
   * 而不是靠 sleep 猜时序（sleep 既慢又会在忙碌机器上假阴性）。
   */
  const waitForWaitingQuery = async (fragment: string, timeoutMs = 8000): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const res = await pool.query<{ one: number }>(
        `select 1 as one from pg_stat_activity
          where datname = current_database()
            and state = 'active'
            and wait_event_type = 'Lock'
            and query ilike $1
          limit 1`,
        [`%${fragment}%`],
      );
      if ((res.rowCount ?? 0) > 0) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  };

  const countRedemptions = async (codeId: string): Promise<number> => {
    const rows = await db
      .select({ id: inviteRedemptions.id })
      .from(inviteRedemptions)
      .where(eq(inviteRedemptions.codeId, BigInt(codeId)));
    return rows.length;
  };

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.register(cookie as never);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const login = await inject("POST", "/ops/admin/login", { username: "admin", password: "admin12345" });
    expect(login.code).toBe(0);
    adminToken = login.data.token as string;
    const [me] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.username, "admin"));
    adminId = me ? String(me.id) : "";
    expect(adminId).not.toBe("");

    // ── 夹具：一个正常用户（有手机号身份 + 个人空间）、一个已注销用户 ──
    userId = String(newId());
    deletedUserId = String(newId());
    createdUserIds.push(userId, deletedUserId);
    await db.insert(users).values([
      { id: BigInt(userId), nickname: `p2-user-${suffix}` },
      // 注销后昵称已被匿名化（契约 §2.1 说明），这里直接造出"已注销"终态
      { id: BigInt(deletedUserId), nickname: "已注销用户", status: 2, deletedAt: new Date() },
    ]);
    await db.insert(identities).values({
      id: newId(),
      userId: BigInt(userId),
      provider: "phone",
      phoneHash: hashPhone(phone),
      phoneCipher: encryptPhone(phone),
    });
    userSpaceId = String(newId());
    await db.insert(spaces).values({ id: BigInt(userSpaceId), ownerUserId: BigInt(userId), type: 1, name: "p2 个人空间" });

    waitlistId = String(newId());
    await db.insert(waitlistEntries).values({
      id: BigInt(waitlistId),
      phoneHash: hashPhone(`wait-${suffix}`),
      source: "landing",
    });
  });

  afterAll(async () => {
    try {
      // 外键顺序：核销记录 → 邀请码 → 等待名单 → 身份 → 空间 → 用户
      if (createdInviteCodeIds.length > 0) {
        const ids = createdInviteCodeIds.map((id) => BigInt(id));
        await db.delete(inviteRedemptions).where(inArray(inviteRedemptions.codeId, ids));
        await db.delete(inviteCodes).where(inArray(inviteCodes.id, ids));
      }
      await db.delete(waitlistEntries).where(eq(waitlistEntries.id, BigInt(waitlistId)));
      // 并发核销用例会写入积分流水和账户；两者都外键到 spaces，必须先清
      await db.delete(creditFlows).where(eq(creditFlows.spaceId, BigInt(userSpaceId)));
      await db.delete(creditAccounts).where(eq(creditAccounts.spaceId, BigInt(userSpaceId)));
      for (const id of createdUserIds) {
        await db.delete(identities).where(eq(identities.userId, BigInt(id)));
        await db.delete(spaces).where(eq(spaces.ownerUserId, BigInt(id)));
        await db.delete(users).where(eq(users.id, BigInt(id)));
      }
    } finally {
      await app.close();
    }
  });

  // ── 用户管理 ──────────────────────────────────────────────

  it("q 为 11 位手机号：走 HMAC 命中用户，且只回打码手机号", async () => {
    const res = await inject("GET", `/ops/admin/users?q=${phone}`);
    expect(res.code).toBe(0);
    expect(res.data.total).toBe(1);
    const row = res.data.list[0];
    expect(row.id).toBe(userId);
    expect(row.phone_masked).toBe(`${phone.slice(0, 3)}****${phone.slice(-4)}`);
    // 绝不出明文：整行任何字段都不应包含完整号码
    expect(JSON.stringify(row)).not.toContain(phone);
    // 个人空间 id 从 spaces.owner_user_id 推出
    expect(row.space_id).toBe(userSpaceId);
    expect(row.deleted_at).toBeNull();
    expect(row.status).toBe(1);
  });

  it("q 为未注册手机号：空页而不是退回昵称模糊", async () => {
    const res = await inject("GET", `/ops/admin/users?q=${ghostPhone}`);
    expect(res.code).toBe(0);
    expect(res.data.total).toBe(0);
    expect(res.data.list).toEqual([]);
  });

  it("q 为纯数字：按用户 id 精确；q 为其它：昵称模糊", async () => {
    const byId = await inject("GET", `/ops/admin/users?q=${userId}`);
    expect(byId.code).toBe(0);
    expect(byId.data.list.map((item: any) => item.id)).toContain(userId);

    const byNickname = await inject("GET", `/ops/admin/users?q=p2-user-${suffix}`);
    expect(byNickname.code).toBe(0);
    expect(byNickname.data.list.map((item: any) => item.id)).toContain(userId);
  });

  it("status / deleted 过滤与分页信封", async () => {
    const deletedOnly = await inject("GET", "/ops/admin/users?deleted=1&page=1&page_size=100");
    expect(deletedOnly.code).toBe(0);
    expect(deletedOnly.data.page).toBe(1);
    expect(deletedOnly.data.page_size).toBe(100);
    const ids = deletedOnly.data.list.map((item: any) => item.id);
    expect(ids).toContain(deletedUserId);
    expect(ids).not.toContain(userId);
    for (const row of deletedOnly.data.list) expect(row.deleted_at).not.toBeNull();

    const notDeleted = await inject("GET", "/ops/admin/users?deleted=0&page_size=100");
    expect(notDeleted.data.list.map((item: any) => item.id)).toContain(userId);
    expect(notDeleted.data.list.map((item: any) => item.id)).not.toContain(deletedUserId);

    const banned = await inject("GET", "/ops/admin/users?status=2&page_size=100");
    for (const row of banned.data.list) expect(row.status).toBe(2);

    // 越界 page 归一到最后一页（前端直接用返回值渲染分页器）
    const overflow = await inject("GET", "/ops/admin/users?page=9999&page_size=20");
    expect(overflow.code).toBe(0);
    expect(overflow.data.page).toBeLessThanOrEqual(9999);
    expect(overflow.data.list.length).toBeLessThanOrEqual(20);

    // 非法分页 / 非法 id → 400101（不是 500）
    expect((await inject("GET", "/ops/admin/users?page_size=999")).code).toBe(400101);
    expect((await inject("GET", "/ops/admin/users?q=abc&status=9")).code).toBe(400101);
    expect((await inject("PATCH", "/ops/admin/users/not-a-number", { status: 2 })).code).toBe(400101);
    expect((await inject("PATCH", "/ops/admin/users/999999999999", { status: 2 })).code).toBe(400102);
  });

  it("PATCH status：封禁 / 解封；已注销用户 → 400101", async () => {
    const banned = await inject("PATCH", `/ops/admin/users/${userId}`, { status: 2 });
    expect(banned.code).toBe(0);
    expect(banned.data.status).toBe(2);
    // 回包是同一份行 DTO（含打码手机号与空间），前端不必再拉一次列表
    expect(banned.data.phone_masked).toBe(`${phone.slice(0, 3)}****${phone.slice(-4)}`);
    expect(banned.data.space_id).toBe(userSpaceId);

    const unbanned = await inject("PATCH", `/ops/admin/users/${userId}`, { status: 1 });
    expect(unbanned.code).toBe(0);
    expect(unbanned.data.status).toBe(1);

    // 已注销：不许绕过注销直接解封，必须先 restore
    const blocked = await inject("PATCH", `/ops/admin/users/${deletedUserId}`, { status: 1 });
    expect(blocked.code).toBe(400101);

    // status 缺失/越界 → 400101（不能默认成"解封"）
    expect((await inject("PATCH", `/ops/admin/users/${userId}`, {})).code).toBe(400101);
    expect((await inject("PATCH", `/ops/admin/users/${userId}`, { status: 3 })).code).toBe(400101);
  });

  it("POST restore：仅对已注销生效，昵称传了才覆盖", async () => {
    const nickname = `p2-restored-${suffix}`;
    const restored = await inject("POST", `/ops/admin/users/${deletedUserId}/restore`, { nickname });
    expect(restored.code).toBe(0);
    expect(restored.data.status).toBe(1);
    expect(restored.data.deleted_at).toBeNull();
    expect(restored.data.nickname).toBe(nickname);

    // 再恢复一次 → 400101（已经不是注销态）
    expect((await inject("POST", `/ops/admin/users/${deletedUserId}/restore`, {})).code).toBe(400101);
    // 未注销用户同样 400101
    expect((await inject("POST", `/ops/admin/users/${userId}/restore`, {})).code).toBe(400101);
  });

  it("phone_cipher 解不开时该行 phone_masked 为 null，不拖垮整页", async () => {
    const brokenUserId = String(newId());
    createdUserIds.push(brokenUserId);
    await db.insert(users).values({ id: BigInt(brokenUserId), nickname: `p2-broken-${suffix}` });
    await db.insert(identities).values({
      id: newId(),
      userId: BigInt(brokenUserId),
      provider: "phone",
      phoneHash: hashPhone(`broken-${suffix}`),
      // 故意写一个格式错误的密文：线上换过 PHONE_ENC_KEY 的环境就是这样
      phoneCipher: "not-a-valid-cipher",
    });

    const res = await inject("GET", `/ops/admin/users?q=p2-broken-${suffix}`);
    expect(res.code).toBe(0);
    expect(res.data.total).toBe(1);
    expect(res.data.list[0].phone_masked).toBeNull();
  });

  // ── 等待名单 ──────────────────────────────────────────────

  it("等待名单：只回 hash 前缀，invite 幂等且保留原时间", async () => {
    const pending = await inject("GET", "/ops/admin/waitlist?invited=0&page_size=100");
    expect(pending.code).toBe(0);
    const row = (pending.data.list as any[]).find((item) => item.id === waitlistId);
    expect(row).toBeTruthy();
    // 前 10 位 + "…"：长度固定 11，且不含任何明文手机号字段
    expect(row.phone_hash_prefix).toHaveLength(11);
    expect(row.phone_hash_prefix.endsWith("…")).toBe(true);
    expect(row.phone_hash_prefix.startsWith(hashPhone(`wait-${suffix}`).slice(0, 10))).toBe(true);
    expect(Object.keys(row).sort()).toEqual(["created_at", "id", "invited_at", "phone_hash_prefix", "source"]);

    const first = await inject("POST", `/ops/admin/waitlist/${waitlistId}/invite`);
    expect(first.code).toBe(0);
    expect(first.data.idempotent).toBe(false);
    expect(typeof first.data.invited_at).toBe("string");

    const second = await inject("POST", `/ops/admin/waitlist/${waitlistId}/invite`);
    expect(second.code).toBe(0);
    expect(second.data.idempotent).toBe(true);
    // 幂等：返回同一时间，不覆盖成 now()
    expect(second.data.invited_at).toBe(first.data.invited_at);

    const invited = await inject("GET", "/ops/admin/waitlist?invited=1&page_size=100");
    expect((invited.data.list as any[]).map((item) => item.id)).toContain(waitlistId);

    const missing = await inject("POST", "/ops/admin/waitlist/999999999999/invite");
    expect(missing.code).toBe(400102);
    expect((await inject("GET", "/ops/admin/waitlist?invited=2")).code).toBe(400101);
  });

  // ── 邀请码 ────────────────────────────────────────────────

  it("批量发码：8 位无歧义码、互不重复、created_by 是当前管理员", async () => {
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const res = await inject("POST", "/ops/admin/invite-codes", {
      credits: 100,
      max_uses: 2,
      expires_at: expiresAt,
      count: 3,
    });
    expect(res.code).toBe(0);
    const codes = res.data.codes as any[];
    expect(codes).toHaveLength(3);
    for (const item of codes) {
      createdInviteCodeIds.push(item.id);
      expect(item.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
      expect(item.credits).toBe(100);
      expect(item.max_uses).toBe(2);
      expect(item.used_count).toBe(0);
      expect(item.status).toBe(1);
      expect(item.created_by).toBe(adminId);
      expect(new Date(item.expires_at).toISOString()).toBe(expiresAt);
    }
    expect(new Set(codes.map((item) => item.code)).size).toBe(3);

    // 不传参数 → 默认 credits=0 / max_uses=1 / count=1 / 永不过期
    const defaults = await inject("POST", "/ops/admin/invite-codes", {});
    expect(defaults.code).toBe(0);
    expect(defaults.data.codes).toHaveLength(1);
    createdInviteCodeIds.push(defaults.data.codes[0].id);
    expect(defaults.data.codes[0].credits).toBe(0);
    expect(defaults.data.codes[0].max_uses).toBe(1);
    expect(defaults.data.codes[0].expires_at).toBeNull();

    // 范围校验：count 1..50、credits 0..100000、max_uses 1..1000
    expect((await inject("POST", "/ops/admin/invite-codes", { count: 51 })).code).toBe(400101);
    expect((await inject("POST", "/ops/admin/invite-codes", { count: 0 })).code).toBe(400101);
    expect((await inject("POST", "/ops/admin/invite-codes", { credits: -1 })).code).toBe(400101);
    expect((await inject("POST", "/ops/admin/invite-codes", { max_uses: 0 })).code).toBe(400101);
    expect((await inject("POST", "/ops/admin/invite-codes", { expires_at: "not-a-time" })).code).toBe(400101);
  });

  it("邀请码列表分页 + 停用/启用 + 耗尽不可启用", async () => {
    const list = await inject("GET", "/ops/admin/invite-codes?status=1&page=1&page_size=100");
    expect(list.code).toBe(0);
    expect(list.data.page).toBe(1);
    expect(list.data.page_size).toBe(100);
    const mine = (list.data.list as any[]).filter((item) => createdInviteCodeIds.includes(item.id));
    expect(mine.length).toBeGreaterThan(0);
    expect(Object.keys(mine[0]).sort()).toEqual([
      "code",
      "created_at",
      "created_by",
      "credits",
      "expires_at",
      "id",
      "max_uses",
      "status",
      "used_count",
    ]);

    const target = mine[0];
    const disabled = await inject("PATCH", `/ops/admin/invite-codes/${target.id}`, { status: 2 });
    expect(disabled.code).toBe(0);
    expect(disabled.data.status).toBe(2);
    const enabled = await inject("PATCH", `/ops/admin/invite-codes/${target.id}`, { status: 1 });
    expect(enabled.code).toBe(0);
    expect(enabled.data.status).toBe(1);

    // 用满：直接用库把 used_count 顶到 max_uses，模拟已经发完的码
    await db.update(inviteCodes).set({ usedCount: 2 }).where(eq(inviteCodes.id, BigInt(target.id)));
    const exhausted = await inject("PATCH", `/ops/admin/invite-codes/${target.id}`, { status: 1 });
    expect(exhausted.code).toBe(400101);
    // 列表里呈现为 3（耗尽由 used_count>=max_uses 派生）
    const after = await inject("GET", "/ops/admin/invite-codes?page_size=100");
    const row = (after.data.list as any[]).find((item) => item.id === target.id);
    expect(row.status).toBe(3);
    // status=3 过滤必须与 DTO 呈现一致，否则这条码会在"有效"和"耗尽"里同时消失
    const exhaustedOnly = await inject("GET", "/ops/admin/invite-codes?status=3&page_size=100");
    expect((exhaustedOnly.data.list as any[]).map((item) => item.id)).toContain(target.id);
    const activeOnly = await inject("GET", "/ops/admin/invite-codes?status=1&page_size=100");
    expect((activeOnly.data.list as any[]).map((item) => item.id)).not.toContain(target.id);
    // 停用仍允许（"停用"不会让状态变得更不可用）
    expect((await inject("PATCH", `/ops/admin/invite-codes/${target.id}`, { status: 2 })).code).toBe(0);

    expect((await inject("PATCH", "/ops/admin/invite-codes/999999999999", { status: 2 })).code).toBe(400102);
    expect((await inject("PATCH", `/ops/admin/invite-codes/${target.id}`, { status: 3 })).code).toBe(400101);
  });

  it("邀请码删除：未核销可删、已核销拒绝（快照与核销表都算数）、再删 400102", async () => {
    // ── 未使用的码：删掉后行真的消失，列表里也查不到 ──
    const fresh = (await inject("POST", "/ops/admin/invite-codes", { count: 1 })).data.codes[0];
    createdInviteCodeIds.push(fresh.id);
    const removed = await inject("DELETE", `/ops/admin/invite-codes/${fresh.id}`);
    expect(removed.code).toBe(0);
    expect(removed.data).toMatchObject({ id: fresh.id, code: fresh.code, deleted: true });
    const [gone] = await db.select().from(inviteCodes).where(eq(inviteCodes.id, BigInt(fresh.id)));
    expect(gone).toBeUndefined();
    // 再删是"不存在"而不是"删除成功"：清理脚本重跑时不能假装删掉了什么
    expect((await inject("DELETE", `/ops/admin/invite-codes/${fresh.id}`)).code).toBe(400102);
    expect((await inject("DELETE", "/ops/admin/invite-codes/not-a-number")).code).toBe(400101);

    // ── used_count>0：拒绝删除，行必须还在（已用码的唯一处置是停用） ──
    const used = (await inject("POST", "/ops/admin/invite-codes", { count: 1 })).data.codes[0];
    createdInviteCodeIds.push(used.id);
    await db.update(inviteCodes).set({ usedCount: 1 }).where(eq(inviteCodes.id, BigInt(used.id)));
    expect((await inject("DELETE", `/ops/admin/invite-codes/${used.id}`)).code).toBe(400101);
    const [kept] = await db.select().from(inviteCodes).where(eq(inviteCodes.id, BigInt(used.id)));
    expect(kept).toBeDefined();

    // ── 核销表有行但 used_count 仍是 0（历史不一致）：同样拒绝，不能只信快照 ──
    const ghost = (await inject("POST", "/ops/admin/invite-codes", { count: 1 })).data.codes[0];
    createdInviteCodeIds.push(ghost.id);
    await db.insert(inviteRedemptions).values({
      id: newId(),
      codeId: BigInt(ghost.id),
      spaceId: BigInt(userSpaceId),
    });
    expect((await inject("DELETE", `/ops/admin/invite-codes/${ghost.id}`)).code).toBe(400101);
    const [ghostKept] = await db.select().from(inviteCodes).where(eq(inviteCodes.id, BigInt(ghost.id)));
    expect(ghostKept).toBeDefined();
  });

  it("并发：核销持锁未提交时删除被条件删除挡下，提交后 400101 且码/核销/积分无半状态", async () => {
    const op = app.get(OpService);
    const ctx = { spaceId: userSpaceId, userId, role: 1, roleCode: null };
    const fresh = (await inject("POST", "/ops/admin/invite-codes", { count: 1, credits: 50, max_uses: 1 })).data.codes[0];
    createdInviteCodeIds.push(fresh.id);

    // 真核销在事务里会先锁邀请码行、再经 creditIn → lockAccount 锁积分账户行。
    // 这里先把账户行占住，核销就会停在"已改 used_count、尚未提交"的位置——
    // 这正是删除最危险的窗口：只看快照会以为还能删。
    await db
      .insert(creditAccounts)
      .values({ spaceId: BigInt(userSpaceId), balance: 0 })
      .onConflictDoNothing({ target: creditAccounts.spaceId });
    const [accountBefore] = await db
      .select({ balance: creditAccounts.balance })
      .from(creditAccounts)
      .where(eq(creditAccounts.spaceId, BigInt(userSpaceId)));
    const beforeBalance = accountBefore?.balance ?? 0;

    let releaseAccount = () => {};
    const holdAccount = new Promise<void>((resolve) => {
      releaseAccount = resolve;
    });
    let markAccountLocked = () => {};
    const accountLocked = new Promise<void>((resolve) => {
      markAccountLocked = resolve;
    });
    const holder = db.transaction(async (tx) => {
      await tx.select().from(creditAccounts).where(eq(creditAccounts.spaceId, BigInt(userSpaceId))).for("update");
      markAccountLocked();
      await holdAccount;
    });
    await accountLocked;

    const verifyPromise = op.verifyInviteCode(ctx, fresh.code).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    let deletePromise: ReturnType<typeof inject> | null = null;
    let creditBlocked = false;
    let deleteBlocked = false;
    try {
      creditBlocked = await waitForWaitingQuery("credit_accounts");
      if (creditBlocked) {
        deletePromise = inject("DELETE", `/ops/admin/invite-codes/${fresh.id}`);
        deleteBlocked = await waitForWaitingQuery('delete from "invite_codes"');
      }
    } finally {
      releaseAccount();
      await holder;
    }
    const verified = await verifyPromise;
    const removed = deletePromise ? await deletePromise : null;

    // 两个"真的在等锁"都被观测到，才说明这不是 sleep 撞出来的巧合
    expect(creditBlocked).toBe(true);
    expect(deleteBlocked).toBe(true);
    // 核销赢了：积分到账、核销行落库
    expect(verified).toEqual({
      ok: true,
      value: expect.objectContaining({
        verified: true,
        replayed: false,
        credits: 50,
        balance_after: beforeBalance + 50,
      }),
    });
    // 删除醒来后条件已不成立（used_count 1 ≠ 0），只能回 400101，不能删掉刚核销的码
    expect(removed?.code).toBe(400101);

    const [kept] = await db.select().from(inviteCodes).where(eq(inviteCodes.id, BigInt(fresh.id)));
    expect(kept).toBeDefined();
    expect(kept.usedCount).toBe(1);
    expect(kept.status).toBe(3);
    expect(await countRedemptions(fresh.id)).toBe(1);
    const [accountAfter] = await db
      .select({ balance: creditAccounts.balance })
      .from(creditAccounts)
      .where(eq(creditAccounts.spaceId, BigInt(userSpaceId)));
    expect(accountAfter.balance).toBe(beforeBalance + 50);
    const flows = await db
      .select({ id: creditFlows.id })
      .from(creditFlows)
      .where(eq(creditFlows.refCodeId, BigInt(fresh.id)));
    expect(flows.length).toBe(1);
  });

  it("并发：自由竞争下每张码只有一个赢家——删除成功则核销不存在，核销成功则删除 400101", async () => {
    const op = app.get(OpService);
    const ctx = { spaceId: userSpaceId, userId, role: 1, roleCode: null };
    // credits=0 让核销不必排积分账户锁，两边的相对时序交给数据库调度；
    // 断言只要求"每张码恰好一个赢家"，不假设谁赢、也不假设赢家比例。
    const codes: { id: string; code: string }[] = (
      await inject("POST", "/ops/admin/invite-codes", { count: 6, credits: 0, max_uses: 1 })
    ).data.codes;
    for (const item of codes) createdInviteCodeIds.push(item.id);

    const outcomes = await Promise.all(
      codes.map(async (item) => {
        const [deleted, verified] = await Promise.allSettled([
          inject("DELETE", `/ops/admin/invite-codes/${item.id}`),
          op.verifyInviteCode(ctx, item.code),
        ]);
        return { item, deleted, verified };
      }),
    );

    let deleteWins = 0;
    let verifyWins = 0;
    for (const { item, deleted, verified } of outcomes) {
      const deleteWon = deleted.status === "fulfilled" && deleted.value.code === 0;
      const verifyWon = verified.status === "fulfilled";
      expect(deleteWon !== verifyWon).toBe(true);

      if (deleteWon) {
        deleteWins += 1;
        expect(verified.status).toBe("rejected");
        if (verified.status === "rejected") {
          expect(verified.reason).toBeInstanceOf(AppError);
          expect((verified.reason as AppError).code).toBe(ErrorCode.INVALID_PARAM);
        }
        const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.id, BigInt(item.id)));
        expect(row).toBeUndefined();
        expect(await countRedemptions(item.id)).toBe(0);
      } else {
        verifyWins += 1;
        expect(verified.status).toBe("fulfilled");
        expect(deleted.status).toBe("fulfilled");
        if (deleted.status === "fulfilled") expect(deleted.value.code).toBe(400101);
        const [row] = await db.select().from(inviteCodes).where(eq(inviteCodes.id, BigInt(item.id)));
        expect(row).toBeDefined();
        expect(row.usedCount).toBe(1);
        expect(row.status).toBe(3);
        expect(await countRedemptions(item.id)).toBe(1);
      }
    }
    // 不出现"两张码同一赢家"的错配：6 张码全部有且只有一个结局
    expect(deleteWins + verifyWins).toBe(codes.length);
  });
});
