import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { createDb, creditFlows } from "@app/db";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";

// 端到端契约测试（需要真实 PG + Redis；CI 由 service containers 提供）
let app: NestFastifyApplication;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;

async function inject(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: { code: number; msg: string; data: any } }> {
  const res = await app.inject({ method, url: `/v1${url}`, payload, headers });
  return { status: res.statusCode, body: res.json() };
}

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  await app.register(cookie as never);
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe("P1 vertical slice: auth → quote → generation → cancel", () => {
  let token = "";
  let spaceId = "";
  let taskId = "";
  let quoteId = "";

  it("sends sms code and logs in (new user gets 80 gift)", async () => {
    const sms = await inject("POST", "/auth/sms-code", { phone });
    expect(sms.body.code).toBe(0);
    const code = sms.body.data.debug_code as string;
    expect(code).toMatch(/^\d{6}$/);

    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    expect(login.body.code).toBe(0);
    token = login.body.data.access_token as string;
    spaceId = login.body.data.space_id as string;
    expect(login.body.data.user.id).toBeTruthy();
    expect(spaceId).toBeTruthy();
  });

  it("returns balance 80 from /me", async () => {
    const me = await inject("GET", "/me", undefined, { authorization: `Bearer ${token}` });
    expect(me.body.data.credits).toEqual({ balance: 80, frozen: 0 });
  });

  it("lists credit flows including the signup gift", async () => {
    const res = await inject("GET", "/credits/flows?page=1&page_size=50", undefined, {
      authorization: `Bearer ${token}`,
    });
    expect(res.body.code).toBe(0);
    const gift = res.body.data.list.find((flow: { kind: string }) => flow.kind === "gift");
    expect(gift).toBeTruthy();
    expect(gift.delta).toBe(80);
  });

  it("rejects sensitive prompts with 745801 and no task", async () => {
    const res = await inject(
      "POST",
      "/generations",
      {
        mode: "text2video",
        model: "sky-media-2.0",
        input: { prompt: "赌博推广视频" },
      },
      { authorization: `Bearer ${token}`, "idempotency-key": "moderation-test-1" },
    );
    expect(res.body.code).toBe(745801);
    const me = await inject("GET", "/me", undefined, { authorization: `Bearer ${token}` });
    expect(me.body.data.credits).toEqual({ balance: 80, frozen: 0 });
  });

  it("quotes 8 credits for text2video 5s/720p", async () => {
    const quote = await inject(
      "POST",
      "/credits/quote",
      { mode: "text2video", model: "sky-media-2.0", input: { prompt: "一只柯基在草地奔跑" } },
      { authorization: `Bearer ${token}` },
    );
    expect(quote.body.code).toBe(0);
    expect(quote.body.data.credits).toBe(8);
    expect(quote.body.data.sufficient).toBe(true);
    quoteId = quote.body.data.quote_id;
  });

  it("creates a task, freezes 8 credits, and is idempotent on replay", async () => {
    const body = {
      mode: "text2video",
      model: "sky-media-2.0",
      input: { prompt: "一只柯基在草地奔跑" },
      quote_id: quoteId,
    };
    const idem = "test-idem-key-0001";
    const created = await inject("POST", "/generations", body, {
      authorization: `Bearer ${token}`,
      "idempotency-key": idem,
    });
    expect(created.body.code).toBe(0);
    taskId = created.body.data.task_id;
    expect(created.body.data.credits_estimate).toBe(8);

    const replay = await inject("POST", "/generations", body, {
      authorization: `Bearer ${token}`,
      "idempotency-key": idem,
    });
    expect(replay.body.data.task_id).toBe(taskId);

    const me = await inject("GET", "/me", undefined, { authorization: `Bearer ${token}` });
    expect(me.body.data.credits).toEqual({ balance: 72, frozen: 8 });
  });

  it("supports ETag/304 for batch id polling", async () => {
    const first = await app.inject({
      method: "GET",
      url: `/v1/tasks?ids=${taskId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/v1/tasks?ids=${taskId}`,
      headers: { authorization: `Bearer ${token}`, "if-none-match": etag },
    });
    expect(second.statusCode).toBe(304);
  });

  it("shares a task publicly and revokes it", async () => {
    const created = await inject("POST", `/tasks/${taskId}/share`, { expires_in_days: 7 }, {
      authorization: `Bearer ${token}`,
    });
    expect(created.body.code).toBe(0);
    const tokenValue = created.body.data.token as string;
    expect(tokenValue.length).toBeGreaterThan(20);

    const publicView = await app.inject({ method: "GET", url: `/v1/share/${tokenValue}` });
    const publicBody = publicView.json() as { code: number; data: { task_id: string } };
    expect(publicBody.code).toBe(0);
    expect(publicBody.data.task_id).toBe(taskId);

    const revoked = await inject("DELETE", `/tasks/${taskId}/share`, undefined, {
      authorization: `Bearer ${token}`,
    });
    expect(revoked.body.code).toBe(0);

    const afterRevoke = await app.inject({ method: "GET", url: `/v1/share/${tokenValue}` });
    expect((afterRevoke.json() as { code: number }).code).toBe(400102);
  });

  it("accepts a public report and lets admin take the share down", async () => {
    const created = await inject("POST", `/tasks/${taskId}/share`, { expires_in_days: 7 }, {
      authorization: `Bearer ${token}`,
    });
    const tokenValue = created.body.data.token as string;

    const report = await app.inject({
      method: "POST",
      url: `/v1/share/${tokenValue}/report`,
      payload: { reason: "illegal", detail: "test report" },
    });
    expect((report.json() as { code: number }).code).toBe(0);

    const adminLogin = await app.inject({
      method: "POST",
      url: "/v1/ops/admin/login",
      payload: { username: "admin", password: "admin12345" },
    });
    const adminToken = (adminLogin.json() as { data: { token: string } }).data.token;
    const list = await app.inject({
      method: "GET",
      url: "/v1/ops/admin/reports",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const rows = (list.json() as { data: { list: Array<{ id: string; task_id: string; status: number }> } }).data.list;
    const row = rows.find((item) => item.task_id === taskId);
    expect(row).toBeTruthy();
    expect(row!.status).toBe(1);

    const resolved = await app.inject({
      method: "POST",
      url: `/v1/ops/admin/reports/${row!.id}/resolve`,
      payload: { action: "takedown", note: "违规下线" },
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const resolvedBody = resolved.json() as { code: number; data: { status: number } };
    expect(resolvedBody.code).toBe(0);
    expect(resolvedBody.data.status).toBe(2);

    const publicView = await app.inject({ method: "GET", url: `/v1/share/${tokenValue}` });
    expect((publicView.json() as { code: number }).code).toBe(400102);
  });

  it("cancels a pending task and unfreezes credits", async () => {
    const canceled = await inject("POST", `/tasks/${taskId}/cancel`, {}, {
      authorization: `Bearer ${token}`,
    });
    expect(canceled.body.code).toBe(0);
    expect(canceled.body.data.status).toBe(5);

    const me = await inject("GET", "/me", undefined, { authorization: `Bearer ${token}` });
    expect(me.body.data.credits).toEqual({ balance: 80, frozen: 0 });
  });

  it("keeps the ledger invariant balance == Σdelta && frozen == Σfrozen_delta", async () => {
    const { db, pool } = createDb(process.env.DATABASE_URL ?? "");
    try {
      const rows = await db.select().from(creditFlows).where(eq(creditFlows.spaceId, BigInt(spaceId)));
      const delta = rows.reduce((sum, row) => sum + row.delta, 0);
      const frozen = rows.reduce((sum, row) => sum + row.frozenDelta, 0);
      expect(delta).toBe(80);
      expect(frozen).toBe(0);
    } finally {
      await pool.end();
    }
    const me = await inject("GET", "/me", undefined, { authorization: `Bearer ${token}` });
    expect(me.body.data.credits.balance).toBe(80);
    expect(me.body.data.credits.frozen).toBe(0);
  });
});
