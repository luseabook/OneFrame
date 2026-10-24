import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { sql } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * 退款业务闭环 e2e（api-spec §10.5，mock 渠道 + 积分回冲）：
 * - 支付 → 管理端全额退款 → status=4、余额回到充值前、refund_no/refund_status 落库；
 * - 负向流水 kind=refund 且 Σdelta == balance（ledger 不变式）；
 * - 重复退款幂等（只扣一次、不重复调渠道）；
 * - 未支付订单拒绝、普通用户 403、部分退款拒绝；
 * - 余额不足（已被消耗）拒绝且不冲正、订单保持已支付。
 */
describe("refund flow (mock channel)", () => {
  let app: NestFastifyApplication;
  let adminToken = "";

  const inject = async (
    method: "GET" | "POST",
    url: string,
    options: { payload?: unknown; token?: string } = {},
  ) => {
    const headers: Record<string, string> = {};
    if (options.payload !== undefined) headers["content-type"] = "application/json";
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    const res = await app.inject({
      method,
      url: `/v1${url}`,
      headers,
      payload: options.payload === undefined ? undefined : JSON.stringify(options.payload),
    });
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: res.statusCode, json, rawBody: res.body };
  };

  const loginUser = async (prefix: string): Promise<string> => {
    const phone = `${prefix}${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10)}`;
    const sms = await inject("POST", "/auth/sms-code", { payload: { phone } });
    const code = (sms.json.data as { debug_code?: string }).debug_code ?? "";
    expect(code).not.toBe("");
    const login = await inject("POST", "/auth/login", { payload: { phone, code, age_confirmed: true } });
    const token = (login.json.data as { access_token?: string }).access_token ?? "";
    expect(token).not.toBe("");
    return token;
  };

  const me = async (token: string) =>
    (await inject("GET", "/me", { token })).json.data as {
      space: { id: string };
      credits: { balance: number; frozen: number };
    };

  const balanceOf = async (token: string): Promise<number> => (await me(token)).credits.balance;

  const flows = async (token: string) => {
    const res = await inject("GET", "/credits/flows?page=1&page_size=100", { token });
    return (res.json.data as { list: Array<{ kind: string; delta: number; balance_after: number; memo: string | null }> })
      .list;
  };

  const paidOrder = async (sku: string, token: string) => {
    const created = await inject("POST", "/billing/orders", { payload: { sku, channel: "mock" }, token });
    expect(created.json.code).toBe(0);
    const order = created.json.data as { order_id: string; amount_cents: number; credits: number };
    const paid = await inject("POST", `/billing/orders/${order.order_id}/mock-pay`, { payload: {}, token });
    expect((paid.json.data as { credited: boolean }).credited).toBe(true);
    return order;
  };

  const refund = async (orderId: string, body: Record<string, unknown> = {}, token = adminToken) =>
    inject("POST", `/ops/admin/orders/${orderId}/refund`, { payload: body, token });

  beforeAll(async () => {
    const existing = await db.execute(sql`select count(*)::int as n from skus`);
    const skuCount = (existing as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? 0;
    if (skuCount === 0) {
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

    const admin = await inject("POST", "/ops/admin/login", {
      payload: { username: "admin", password: "admin12345" },
    });
    adminToken = (admin.json.data as { token?: string }).token ?? "";
    expect(adminToken).not.toBe("");
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("refunds a paid order fully: status=4, refund fields, balance restored, negative refund flow", async () => {
    const token = await loginUser("15");
    const before = await balanceOf(token);
    const order = await paidOrder("credits-500", token);
    expect(await balanceOf(token)).toBe(before + order.credits);

    const res = await refund(order.order_id, { reason: "E3 未成年人误充（工单 TK-001）" });
    expect(res.json.code).toBe(0);
    const data = res.json.data as {
      order_id: string;
      status: number;
      refund_no: string;
      refund_status: string;
      refund_amount_cents: number;
      refunded_at: string;
      idempotent: boolean;
    };
    expect(data).toMatchObject({
      order_id: order.order_id,
      status: 4,
      refund_no: `rf-${order.order_id}`,
      refund_status: "succeeded",
      refund_amount_cents: order.amount_cents,
      idempotent: false,
    });
    expect(data.refunded_at).toBeTruthy();

    // 余额回到充值前
    expect(await balanceOf(token)).toBe(before);

    // 订单详情带退款信息
    const detail = await inject("GET", `/billing/orders/${order.order_id}`, { token });
    const orderDto = detail.json.data as {
      status: number;
      refund_no: string;
      refund_status: string;
      refund_reason: string;
      refund_amount_cents: number;
    };
    expect(orderDto.status).toBe(4);
    expect(orderDto.refund_no).toBe(`rf-${order.order_id}`);
    expect(orderDto.refund_status).toBe("succeeded");
    expect(orderDto.refund_reason).toContain("E3");
    expect(orderDto.refund_amount_cents).toBe(order.amount_cents);

    // 流水含 refund 负向；Σdelta == balance（ledger 不变式）
    const rows = await flows(token);
    const refundFlows = rows.filter((row) => row.kind === "refund");
    expect(refundFlows).toHaveLength(1);
    expect(refundFlows[0].delta).toBe(-order.credits);
    expect(refundFlows[0].memo).toContain(`rf-${order.order_id}`);
    const sum = rows.reduce((acc, row) => acc + row.delta, 0);
    expect(sum).toBe(await balanceOf(token));
  });

  it("is idempotent: repeated refund neither charges credits again nor adds a second flow", async () => {
    const token = await loginUser("16");
    const before = await balanceOf(token);
    const order = await paidOrder("credits-500", token);
    const first = await refund(order.order_id, { reason: "duplicate check" });
    expect(first.json.code).toBe(0);
    const balanceAfterFirst = await balanceOf(token);
    expect(balanceAfterFirst).toBe(before);

    const second = await refund(order.order_id, { reason: "duplicate check" });
    expect(second.json.code).toBe(0);
    const data = second.json.data as { idempotent: boolean; status: number; refund_no: string };
    expect(data.idempotent).toBe(true);
    expect(data.status).toBe(4);
    expect(data.refund_no).toBe(`rf-${order.order_id}`);

    expect(await balanceOf(token)).toBe(balanceAfterFirst);
    const refundFlows = (await flows(token)).filter((row) => row.kind === "refund");
    expect(refundFlows).toHaveLength(1);
  });

  it("rejects refunding a pending (unpaid) order", async () => {
    const token = await loginUser("17");
    const created = await inject("POST", "/billing/orders", { payload: { sku: "credits-500", channel: "mock" }, token });
    const order = created.json.data as { order_id: string };
    const res = await refund(order.order_id);
    expect(res.json.code).toBe(400101);
    const detail = await inject("GET", `/billing/orders/${order.order_id}`, { token });
    expect((detail.json.data as { status: number }).status).toBe(1);
  });

  it("rejects partial refund requests", async () => {
    const token = await loginUser("18");
    const order = await paidOrder("credits-1000", token);
    const res = await refund(order.order_id, { amount_cents: 100 });
    expect(res.json.code).toBe(400101);
    const detail = await inject("GET", `/billing/orders/${order.order_id}`, { token });
    expect((detail.json.data as { status: number }).status).toBe(2);
  });

  it("returns 403 when a normal user token tries to refund", async () => {
    const token = await loginUser("19");
    const order = await paidOrder("credits-500", token);
    const res = await refund(order.order_id, {}, token);
    expect(res.json.code).toBe(403101);
    const detail = await inject("GET", `/billing/orders/${order.order_id}`, { token });
    expect((detail.json.data as { status: number }).status).toBe(2);
  });

  it("requires admin auth for the refund endpoint", async () => {
    const token = await loginUser("13");
    const order = await paidOrder("credits-500", token);
    const res = await inject("POST", `/ops/admin/orders/${order.order_id}/refund`, { payload: {} });
    expect(res.json.code).toBe(401101);
  });

  it("rejects refund when credits were already consumed (no negative balance, order stays paid)", async () => {
    const token = await loginUser("12");
    const order = await paidOrder("credits-1000", token);
    const account = await me(token);
    const balanceBeforeRefund = account.credits.balance;

    // 模拟"积分已被消耗"：直接扣减账户余额（真实消耗走 freeze/settle，此处只验证退款守卫）
    await db.execute(
      sql`update credit_accounts set balance = balance - ${order.credits}, updated_at = now() where space_id = ${BigInt(account.space.id)}`,
    );
    expect(await balanceOf(token)).toBe(balanceBeforeRefund - order.credits);

    const refundFlowsBefore = (await flows(token)).filter((row) => row.kind === "refund").length;
    const res = await refund(order.order_id, { reason: "未成年人误充" });
    expect(res.json.code).toBe(400101);
    // 信封不携带 details：balance/credits 必须写进 message，运营才能一眼看到差多少
    const msg = String((res.json as { msg?: string }).msg ?? "");
    expect(msg).toContain("insufficient credits to roll back");
    expect(msg).toContain(`balance=${balanceBeforeRefund - order.credits}`);
    expect(msg).toContain(`credits=${order.credits}`);
    const detail = await inject("GET", `/billing/orders/${order.order_id}`, { token });
    expect((detail.json.data as { status: number }).status).toBe(2);
    expect((await flows(token)).filter((row) => row.kind === "refund")).toHaveLength(refundFlowsBefore);
  });

  it("lists orders for ops with refund audit fields", async () => {
    const token = await loginUser("11");
    const order = await paidOrder("credits-500", token);
    const refunded = await refund(order.order_id, { reason: "ops list check" });
    expect(refunded.json.code).toBe(0);

    const list = await inject("GET", "/ops/admin/orders?status=4&page=1&page_size=50", { token: adminToken });
    expect(list.json.code).toBe(0);
    const rows = (list.json.data as { list: Array<Record<string, unknown>> }).list;
    const row = rows.find((item) => item.order_id === order.order_id);
    expect(row).toMatchObject({ status: 4, refund_no: `rf-${order.order_id}`, refund_status: "succeeded" });
    expect(row?.refund_operator).toBeTruthy();
  });
});
