import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, inArray } from "drizzle-orm";
import { models, tasks } from "@app/db";
import { newId } from "@app/shared";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { env } from "../src/config/env";
import { db } from "../src/db/database";

/**
 * 内容安全外延（模块 #25 收尾）：验证码票据 / 文本检测 / 审核态只读。
 *
 * 重点验证五件事：
 * 1. **诚实口径**：第三方未接入 → `available:false` + `provider:null` + 本地算术题模式，
 *    任何情况下都不出现「已接入腾讯云」这类假话；
 * 2. **票据是真的能验真的能防重放**：签名 / 5 分钟过期 / 一次性（同票第二次必失败）；
 * 3. **答错也作废**：否则一张票可以枚举答案（10×10 只有 100 种可能）；
 * 4. **文本检测给位置与分类**：`hits[].index` 必须能指回原文，运营才能定位；
 * 5. **审核态只读**：6/7 两态透出，跨 space 不报"存在/不存在"差异（不泄露）。
 */
describe("moderation captcha / text-detect / status e2e", () => {
  let app: NestFastifyApplication;
  let token = "";
  let spaceId = "";
  let otherToken = "";
  let otherSpaceId = "";
  let reviewingTaskId = "";
  let rejectedTaskId = "";
  const seededTaskIds: bigint[] = [];

  const inject = async (method: string, url: string, payload?: unknown, authToken?: string, space?: string) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    if (space) headers["x-space-id"] = space;
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

  async function login(tag: string): Promise<{ token: string; spaceId: string; userId: string }> {
    const phone = `1${String(Date.now()).slice(-8)}${tag}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = (sms.data as { debug_code?: string } | undefined)?.debug_code;
    const res = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const data = res.data as { access_token?: string; space_id?: string; user?: { id?: string } } | undefined;
    return {
      token: data?.access_token ?? "",
      spaceId: String(data?.space_id ?? ""),
      userId: String(data?.user?.id ?? ""),
    };
  }

  async function seedTask(space: string, user: string, status: number): Promise<string> {
    const [model] = await db.select({ id: models.id }).from(models).limit(1);
    const id = BigInt(newId());
    await db.insert(tasks).values({
      id,
      spaceId: BigInt(space),
      userId: BigInt(user),
      capability: "video",
      mode: "text2video",
      modelId: model.id,
      input: { prompt: "审核态测试" },
      options: { ratio: "9:16", resolution: "720p", duration: 5, count: 1 },
      status,
    });
    seededTaskIds.push(id);
    return String(id);
  }

  /** 白盒构造"已过期"的合法签名票据（服务端签名算法一致，但 exp 在过去） */
  function expiredTicket(): string {
    const signKey = createHmac("sha256", env.JWT_SECRET).update("captcha-ticket:v1").digest("hex");
    const payload = { v: 1, jti: `expired-${Date.now()}`, a: 1, b: 2, op: "+", exp: Date.now() - 1000, scope: "captcha" };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = createHmac("sha256", signKey).update(payloadB64).digest("base64url");
    return `${payloadB64}.${sig}`;
  }

  beforeAll(async () => {
    const appInstance = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    await appInstance.register(cookie as never);
    appInstance.setGlobalPrefix("v1");
    appInstance.useGlobalFilters(new AllExceptionsFilter());
    appInstance.useGlobalInterceptors(new EnvelopeInterceptor());
    await appInstance.init();
    app = appInstance;

    const me = await login("01");
    token = me.token;
    spaceId = me.spaceId;
    const other = await login("02");
    otherToken = other.token;
    otherSpaceId = other.spaceId;
    reviewingTaskId = await seedTask(spaceId, me.userId, 6);
    rejectedTaskId = await seedTask(spaceId, me.userId, 7);
  });

  afterAll(async () => {
    if (seededTaskIds.length > 0) await db.delete(tasks).where(inArray(tasks.id, seededTaskIds));
    await app.close();
  });

  // ── 验证码 ───────────────────────────────────────────────
  it("取票：诚实返回 available:false + 本地算术题模式（不冒充第三方）", async () => {
    const res = await inject("POST", "/moderation/captcha/ticket");
    // Nest 的 POST 默认 201；信封 code 才是业务判据
    expect([200, 201]).toContain(res.status);
    expect(res.code).toBe(0);
    const data = res.data as {
      available: boolean;
      provider: unknown;
      mode: string;
      reason: string;
      integration: string;
      challenge: { a: number; b: number; op: string };
      ticket: string;
      expires_in: number;
    };
    expect(data.available).toBe(false);
    expect(data.provider).toBeNull();
    expect(data.mode).toBe("local_arithmetic");
    expect(data.reason).toBe("third_party_not_configured");
    expect(data.integration).toBe("none");
    expect(data.expires_in).toBe(300);
    expect(data.challenge.a).toBeGreaterThanOrEqual(1);
    expect(data.challenge.b).toBeGreaterThanOrEqual(1);
    expect(data.challenge.op).toBe("+");
    expect(data.ticket.split(".")).toHaveLength(2);
  });

  it("验票通过（答案 = a+b），同票重放 → used_or_expired（一次性）", async () => {
    const ticketRes = await inject("POST", "/moderation/captcha/ticket");
    const ticket = ticketRes.data as { ticket: string; challenge: { a: number; b: number } };
    const answer = ticket.challenge.a + ticket.challenge.b;

    const ok = await inject("POST", "/moderation/captcha/verify", { ticket: ticket.ticket, answer });
    expect(ok.code).toBe(0);
    expect(ok.data).toMatchObject({ passed: true, retry_allowed: false });

    const replay = await inject("POST", "/moderation/captcha/verify", { ticket: ticket.ticket, answer });
    expect(replay.code).toBe(0);
    expect(replay.data).toMatchObject({ passed: false, reason: "used_or_expired" });
  });

  it("答错也消耗票据（防枚举），重试必须重新取票", async () => {
    const ticketRes = await inject("POST", "/moderation/captcha/ticket");
    const ticket = ticketRes.data as { ticket: string; challenge: { a: number; b: number } };
    const wrong = await inject("POST", "/moderation/captcha/verify", {
      ticket: ticket.ticket,
      answer: ticket.challenge.a + ticket.challenge.b + 1,
    });
    expect(wrong.data).toMatchObject({ passed: false, reason: "wrong_answer" });

    const again = await inject("POST", "/moderation/captcha/verify", {
      ticket: ticket.ticket,
      answer: ticket.challenge.a + ticket.challenge.b,
    });
    expect(again.data).toMatchObject({ passed: false, reason: "used_or_expired" });
  });

  it("改过的票据 → invalid_ticket（签名兜住，不信任客户端）", async () => {
    const ticketRes = await inject("POST", "/moderation/captcha/ticket");
    const ticket = ticketRes.data as { ticket: string; challenge: { a: number; b: number } };
    const [payloadB64, sig] = ticket.ticket.split(".");
    // 改动 payload 的一个字符（把 a 改大），签名不再匹配
    const tampered = `${
      payloadB64.slice(0, -1) === payloadB64.at(-1) ? payloadB64.slice(0, -1) + "A" : payloadB64.slice(0, -1) + "A"
    }.${sig}`;
    const res = await inject("POST", "/moderation/captcha/verify", { ticket: tampered, answer: 1 });
    expect(res.data).toMatchObject({ passed: false, reason: "invalid_ticket" });
  });

  it("过期票据 → expired（5 分钟窗口由 exp 判定）", async () => {
    const res = await inject("POST", "/moderation/captcha/verify", { ticket: expiredTicket(), answer: 3 });
    expect(res.data).toMatchObject({ passed: false, reason: "expired" });
  });

  it("参数校验：缺 ticket / 缺 answer → 400101", async () => {
    expect((await inject("POST", "/moderation/captcha/verify", {})).code).toBe(400101);
    const ticketRes = await inject("POST", "/moderation/captcha/ticket");
    const ticket = (ticketRes.data as { ticket: string }).ticket;
    expect((await inject("POST", "/moderation/captcha/verify", { ticket })).code).toBe(400101);
  });

  // ── 文本检测 ─────────────────────────────────────────────
  it("命中敏感词：给出位置/分类/等级，动作=block", async () => {
    const res = await inject("POST", "/moderation/text-detect", { text: "这里有赌博内容" }, token, spaceId);
    expect(res.code).toBe(0);
    const data = res.data as {
      risky: boolean;
      action: string;
      hits: Array<{ word: string; index: number; category: string; level: number }>;
      categories: string[];
    };
    expect(data.risky).toBe(true);
    expect(data.action).toBe("block");
    expect(data.hits[0]).toMatchObject({ word: "赌博", index: 3, category: "gambling", level: 3 });
    expect(data.categories).toEqual(["gambling"]);
  });

  it("干净文本 → risky:false / action:allow / 空命中", async () => {
    const res = await inject("POST", "/moderation/text-detect", { text: "一只柯基在草地上奔跑" }, token, spaceId);
    expect(res.data).toMatchObject({ risky: false, action: "allow", hits: [], categories: [] });
  });

  it("多个命中按出现位置升序（运营可原文定位）", async () => {
    const res = await inject(
      "POST",
      "/moderation/text-detect",
      { text: "诈骗教程之后又提赌博" },
      token,
      spaceId,
    );
    const hits = (res.data as { hits: Array<{ word: string; index: number }> }).hits;
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const indexes = hits.map((hit) => hit.index);
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes);
    expect(hits[0].word).toBe("诈骗教程");
    expect(hits[1].word).toBe("赌博");
  });

  it("检测需要登录（避免被当免费审核接口刷）", async () => {
    const res = await inject("POST", "/moderation/text-detect", { text: "赌博" });
    expect(res.code).toBe(401101);
  });

  it("空文本是合法的（返回 allow，不报错）", async () => {
    const res = await inject("POST", "/moderation/text-detect", { text: "" }, token, spaceId);
    expect(res.code).toBe(0);
    expect(res.data).toMatchObject({ risky: false, action: "allow" });
  });

  // ── 审核态 ───────────────────────────────────────────────
  it("status：审核中=reviewing、驳回=rejected，且能读回 mode/事件", async () => {
    const reviewing = await inject("GET", `/moderation/status?task_id=${reviewingTaskId}`, undefined, token, spaceId);
    expect(reviewing.code).toBe(0);
    const reviewingData = reviewing.data as {
      status: number;
      status_name: string;
      reviewing: boolean;
      rejected: boolean;
      mode: string;
      events: unknown[];
    };
    expect(reviewingData.status).toBe(6);
    expect(reviewingData.status_name).toBe("reviewing");
    expect(reviewingData.reviewing).toBe(true);
    expect(reviewingData.rejected).toBe(false);
    expect(reviewingData.mode).toBe("text2video");
    expect(Array.isArray(reviewingData.events)).toBe(true);

    const rejected = await inject("GET", `/moderation/status?task_id=${rejectedTaskId}`, undefined, token, spaceId);
    expect((rejected.data as { rejected: boolean }).rejected).toBe(true);
    expect((rejected.data as { status_name: string }).status_name).toBe("review_rejected");
  });

  it("status：跨 space 与不存在都返回 400102（不泄露任务是否存在）", async () => {
    const cross = await inject("GET", `/moderation/status?task_id=${reviewingTaskId}`, undefined, otherToken, otherSpaceId);
    expect(cross.code).toBe(400102);
    const missing = await inject("GET", "/moderation/status?task_id=999999999999", undefined, token, spaceId);
    expect(missing.code).toBe(400102);
  });

  it("status：非法 task_id → 400101；缺参数 → 400101；未登录 → 401101", async () => {
    expect((await inject("GET", "/moderation/status?task_id=abc", undefined, token, spaceId)).code).toBe(400101);
    expect((await inject("GET", "/moderation/status", undefined, token, spaceId)).code).toBe(400101);
    expect((await inject("GET", `/moderation/status?task_id=${reviewingTaskId}`)).code).toBe(401101);
  });

  it("清理前置检查：任务行确实存在（避免用例互相污染）", async () => {
    const rows = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, BigInt(reviewingTaskId)));
    expect(rows).toHaveLength(1);
  });
});
