import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { sql } from "drizzle-orm";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * 支付闭环契约测试（PRD §10 / api-spec §10）
 * 重点验证：下单快照、幂等入账、金额防篡改、状态机、跨空间隔离、ledger 不变式
 */
describe("billing (e2e)", () => {
  let app: NestFastifyApplication;
  let token = "";

  const inject = async (method: string, url: string, payload?: unknown, authToken?: string) => {
    const headers: Record<string, string> = {};
    if (payload !== undefined) headers["content-type"] = "application/json";
    if (authToken) headers.authorization = `Bearer ${authToken}`;
    const res = await app.inject({
      method: method as "GET" | "POST",
      url: `/v1${url}`,
      headers,
      payload: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const body = JSON.parse(res.body);
    return { status: res.statusCode, ...body, body };
  };

  /** 测试环境 sms-code 回显 debug_code，无需读 Redis */
  async function loginNewUser(prefix: string): Promise<string> {
    const phone = `${prefix}${String(Date.now()).slice(-9)}`;
    const sms = await inject("POST", "/auth/sms-code", { phone });
    const code = sms.data?.debug_code as string;
    const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true });
    const tk = (login.data?.access_token ?? login.body?.data?.access_token ?? "") as string;
    return tk;
  }

  beforeAll(async () => {
    // 确保 SKU 存在（seed 可能未跑）
    const existing = await db.execute(sql`select count(*)::int as n from skus`);
    const n = (existing as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? 0;
    if (n === 0) {
      await db.execute(sql`
        insert into skus (id, kind, sku, label, price_cents, credits, active, created_at, updated_at)
        values
          (1, 'credits', 'credits-500', '500 积分', 5000, 500, true, now(), now()),
          (2, 'credits', 'credits-1000', '1000 积分', 10000, 1000, true, now(), now())
        on conflict (sku) do nothing
      `);
    }

    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: true }), {
      logger: false,
    });
    await app.register(cookie as never);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    token = await loginNewUser("19");
    expect(token).not.toBe("");
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await pool.end();
  });

  it("lists public skus with price and credits", async () => {
    const res = await inject("GET", "/billing/skus");
    expect(res.code).toBe(0);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data[0].price_cents).toBeGreaterThan(0);
    expect(res.data[0].credits).toBeGreaterThan(0);
  });

  it("rejects real channel when PAYMENT_LIVE=false", async () => {
    const res = await inject("POST", "/billing/orders", { sku: "credits-500", channel: "wechat" }, token);
    expect(res.code).toBe(400101);
  });

  it("creates a mock order with price snapshot and reuses it within 60s", async () => {
    const a = await inject("POST", "/billing/orders", { sku: "credits-500", channel: "mock" }, token);
    expect(a.code).toBe(0);
    expect(a.data.amount_cents).toBe(5000);
    expect(a.data.credits).toBe(500);
    expect(a.data.status).toBe(1);

    const b = await inject("POST", "/billing/orders", { sku: "credits-500", channel: "mock" }, token);
    expect(b.data.order_id).toBe(a.data.order_id);
  });

  it("credits balance exactly once and is idempotent on repeat payment", async () => {
    const before = await inject("GET", "/me", undefined, token);
    const bal0 = before.data.credits.balance as number;

    const order = await inject("POST", "/billing/orders", { sku: "credits-1000", channel: "mock" }, token);
    const orderId = order.data.order_id as string;

    const pay1 = await inject("POST", `/billing/orders/${orderId}/mock-pay`, {}, token);
    expect(pay1.data.credited).toBe(true);

    const mid = await inject("GET", "/me", undefined, token);
    expect(mid.data.credits.balance).toBe(bal0 + 1000);

    const pay2 = await inject("POST", `/billing/orders/${orderId}/mock-pay`, {}, token);
    expect(pay2.data.credited).toBe(false);

    const after = await inject("GET", "/me", undefined, token);
    expect(after.data.credits.balance).toBe(bal0 + 1000);
  });

  it("rejects callback with tampered amount", async () => {
    const order = await inject("POST", "/billing/orders", { sku: "credits-500", channel: "mock" }, token);
    const res = await inject("POST", "/billing/notify/mock", {
      order_id: order.data.order_id,
      channel_order_id: "tampered-1",
      amount_cents: 1,
    });
    expect(res.code).toBe(400101);
  });

  it("closes pending order and refuses payment afterwards", async () => {
    const order = await inject("POST", "/billing/orders", { sku: "credits-1000", channel: "mock" }, token);
    const orderId = order.data.order_id as string;
    const close = await inject("POST", `/billing/orders/${orderId}/close`, {}, token);
    expect(close.data.closed).toBe(true);

    const detail = await inject("GET", `/billing/orders/${orderId}`, undefined, token);
    expect(detail.data.status).toBe(3);

    const pay = await inject("POST", "/billing/notify/mock", {
      order_id: orderId,
      channel_order_id: "after-close",
      amount_cents: 10000,
    });
    expect(pay.code).toBe(400101);
  });

  it("keeps ledger invariant after recharge", async () => {
    const flows = await inject("GET", "/credits/flows?page=1&page_size=100", undefined, token);
    const sum = (flows.data.list as Array<{ delta: number }>).reduce((a, f) => a + f.delta, 0);
    const me = await inject("GET", "/me", undefined, token);
    expect(sum).toBe(me.data.credits.balance);
  });

  it("isolates orders across spaces", async () => {
    const order = await inject("POST", "/billing/orders", { sku: "credits-500", channel: "mock" }, token);
    const otherToken = await loginNewUser("18");
    const res = await inject("GET", `/billing/orders/${order.data.order_id}`, undefined, otherToken);
    expect(res.code).toBe(400102);
  });
});
