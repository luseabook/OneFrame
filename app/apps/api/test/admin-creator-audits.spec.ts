import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, eq, inArray } from "drizzle-orm";
import { creatorAssets, users } from "@app/db";
import { newId } from "@app/shared";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { db } from "../src/db/database";

/**
 * 平台运营的创作者审核队列（模块 #10 收尾）。
 *
 * 背景：创作者作品**此前只有空间管理员能审**（`POST /crc/assets/audit`），平台运营域看不到队列；
 * 而竞品侧创作者内容是平台内容池的一部分，运营必须能直接处置。本用例钉住：
 * 1. 列表按状态过滤（待审=2）且带作者/空间信息；
 * 2. 通过 → 3 + `published_at` 落值 + `reviewed_by_admin`/`reviewed_by_kind=2` 留痕（与空间管理员区分）；
 * 3. 驳回 → 4 + `review_note` 带运营理由；
 * 4. 跳步拒绝：待审态直接下架、已通过态再通过都 400101（不允许绕过审核记录）；
 * 5. 用户 token 打管理端 → 401/403（身份域不混用）。
 */
describe("ops admin creator-audits e2e", () => {
  let app: NestFastifyApplication;
  let adminToken = "";
  let userToken = "";
  const createdIds: bigint[] = [];
  let userId = "";
  let spaceId = "";

  async function adminInject(method: "GET" | "POST", url: string, payload?: Record<string, unknown>, token?: string) {
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      payload,
      headers: { ...((token ?? adminToken) ? { authorization: `Bearer ${token ?? adminToken}` } : {}) },
    });
    return res.json() as { code: number; msg: string; data: unknown };
  }

  async function seedAsset(status: number, title: string): Promise<bigint> {
    const id = BigInt(newId());
    await db.insert(creatorAssets).values({
      id,
      spaceId: BigInt(spaceId),
      creatorUserId: BigInt(userId),
      kind: 1,
      title,
      summary: "运营审核队列用例",
      status,
      category: "general",
    });
    createdIds.push(id);
    return id;
  }

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.register(cookie as never);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const login = await adminInject("POST", "/ops/admin/login", {
      username: "admin",
      password: "admin12345",
    });
    adminToken = (login.data as { token: string }).token;

    // 造一个真实用户空间（创作者作品必须挂在真实 space/user 上，否则外键失败）
    const phone = `13${String(Date.now()).slice(-9)}`;
    const sms = await app.inject({
      method: "POST",
      url: "/v1/auth/sms-code",
      payload: { phone },
      headers: { "content-type": "application/json" },
    });
    const code = (sms.json() as { data?: { debug_code?: string } }).data?.debug_code;
    const userLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { phone, code, age_confirmed: true },
      headers: { "content-type": "application/json" },
    });
    const body = userLogin.json() as { data?: { access_token?: string; space_id?: string; user?: { id?: string } } };
    userToken = body.data?.access_token ?? "";
    spaceId = String(body.data?.space_id ?? "");
    userId = String(body.data?.user?.id ?? "");
  });

  afterAll(async () => {
    if (createdIds.length > 0) {
      await db.delete(creatorAssets).where(inArray(creatorAssets.id, createdIds));
    }
    await app.close();
  });

  it("待审队列：只返回 status=2 的作品，带作者/空间/标题", async () => {
    const stamp = Date.now();
    const pending = await seedAsset(2, `待审作品-${stamp}`);
    const approved = await seedAsset(3, `已通过作品-${stamp}`);
    const title = `待审作品-${stamp}`;

    // 这是**全平台**队列且按 created_at 升序（最旧的在前）。被测库是所有 spec 共用的开发库、
    // 历史轮次会在里面留下 status=2 的创作者作品，`page_size` 上限又只有 100 —— 直接断言
    // "新建的行出现在第一页"会随累计数据量随机变红（第 64 批总闸就是这么红的）。
    // 故用接口自带的 `q` 标题模糊过滤收敛到本用例造的行，同时保留对状态过滤与字段的完整断言。
    const res = await adminInject("GET", `/ops/admin/creator-audits?status=2&page_size=100&q=${encodeURIComponent(title)}`);
    expect(res.code).toBe(0);
    const data = res.data as {
      list: Array<{ id: string; status: number; creator_user_id: string; space_id: string; title: string }>;
      total: number;
      status: number;
    };
    const ids = data.list.map((item) => item.id);
    expect(ids).toContain(String(pending));
    expect(ids).not.toContain(String(approved));
    // 标题过滤 + 状态过滤双生效：页内不允许混进别的标题或非待审的行
    expect(data.list.every((item) => item.title.includes(title))).toBe(true);
    expect(data.list.every((item) => item.status === 2)).toBe(true);
    const row = data.list.find((item) => item.id === String(pending))!;
    expect(row.status).toBe(2);
    expect(row.creator_user_id).toBe(userId);
    expect(row.space_id).toBe(spaceId);
  });

  it("通过：2→3，published_at 落值，reviewed_by_admin/reviewed_by_kind=2 留痕", async () => {
    const id = await seedAsset(2, `运营通过-${Date.now()}`);
    const res = await adminInject("POST", `/ops/admin/creator-audits/${id}/review`, { action: "approve" });
    expect(res.code).toBe(0);
    const data = res.data as { status: number; from_status: number; reviewed_by_kind: number; published_at: string };
    expect(data.from_status).toBe(2);
    expect(data.status).toBe(3);
    expect(data.reviewed_by_kind).toBe(2);
    expect(data.published_at).toBeTruthy();

    const [row] = await db.select().from(creatorAssets).where(eq(creatorAssets.id, id));
    expect(row!.status).toBe(3);
    expect(row!.reviewedByAdmin).not.toBeNull();
    expect(row!.reviewedBy).toBeNull(); // 空间管理员列不写：两个身份域分开留痕
    expect(row!.publishedAt).not.toBeNull();
  });

  it("驳回：2→4，review_note 记录运营理由", async () => {
    const id = await seedAsset(2, `运营驳回-${Date.now()}`);
    const res = await adminInject("POST", `/ops/admin/creator-audits/${id}/review`, {
      action: "reject",
      note: "封面含未授权素材",
    });
    expect(res.code).toBe(0);
    expect((res.data as { status: number }).status).toBe(4);
    const [row] = await db.select().from(creatorAssets).where(eq(creatorAssets.id, id));
    expect(row!.reviewNote).toContain("未授权素材");
  });

  it("跳步拒绝：待审直接下架 400101；已通过再通过 400101", async () => {
    const pending = await seedAsset(2, `跳步-待审-${Date.now()}`);
    const offline = await adminInject("POST", `/ops/admin/creator-audits/${pending}/review`, {
      action: "offline",
    });
    expect(offline.code).toBe(400101);
    expect(offline.msg).toContain("已通过");

    const approved = await seedAsset(3, `跳步-已通过-${Date.now()}`);
    const again = await adminInject("POST", `/ops/admin/creator-audits/${approved}/review`, {
      action: "approve",
    });
    expect(again.code).toBe(400101);
    expect(again.msg).toContain("待审");
  });

  it("身份域不混用：用户 token 打管理端 → 403（不是 200 也不是 500）", async () => {
    const id = await seedAsset(2, `越权-${Date.now()}`);
    const res = await adminInject("POST", `/ops/admin/creator-audits/${id}/review`, { action: "approve" }, userToken);
    expect([403101, 401101]).toContain(res.code);
    const [row] = await db.select().from(creatorAssets).where(eq(creatorAssets.id, id));
    expect(row!.status).toBe(2); // 未被改动
  });

  it("清理前置检查：种子作品都在（避免用例互相污染）", async () => {
    const rows = await db
      .select({ id: creatorAssets.id })
      .from(creatorAssets)
      .where(and(inArray(creatorAssets.id, createdIds)));
    expect(rows.length).toBe(createdIds.length);
    // users 表存在性（FK 正常）
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, BigInt(userId)));
    expect(u).toBeDefined();
  });
});
