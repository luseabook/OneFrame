import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  buildWechatNotifyBody,
  generateRsaKeyPair,
  parseAuthorizationFields,
  rsaVerify,
  wechatNotifyHeaders,
} from "./channels-test-utils";

/**
 * 退款渠道闭环 e2e（微信 APIv3 + 假网关）：
 * - 真实渠道退款：调用渠道退款接口（幂等单号 rf-{orderId}），落 refund_no/refund_status；
 * - 重复退款幂等：渠道只被调用一次；
 * - 渠道退款失败 → 事务回滚：订单保持已支付、积分不冲正、返回 VENDOR_ERROR；
 * - 未支付订单拒绝退款且不调渠道。
 */

interface CapturedHttp {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

function startServer(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void,
): Promise<{ server: Server; port: number; requests: CapturedHttp[] }> {
  const requests: CapturedHttp[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      handler(req, res, body);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, port: typeof address === "object" && address ? address.port : 0, requests });
    });
  });
}

const sendJson = (res: ServerResponse, status: number, payload: unknown): void => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
};

const merchant = generateRsaKeyPair();
const platform = generateRsaKeyPair();
const API_V3_KEY = "0123456789abcdef0123456789abcdef";

describe("refund flow (wechat live channel)", () => {
  let gateway: Awaited<ReturnType<typeof startServer>>;
  let app: import("@nestjs/platform-fastify").NestFastifyApplication;
  let pool: { end: () => Promise<void> };
  let refundFailureMode = false;
  let refundCalls = 0;

  let userToken = "";
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
    return { status: res.statusCode, json };
  };

  const balanceOf = async (): Promise<number> => {
    const me = await inject("GET", "/me", { token: userToken });
    return (me.json.data as { credits: { balance: number } }).credits.balance;
  };

  const flows = async () => {
    const res = await inject("GET", "/credits/flows?page=1&page_size=100", { token: userToken });
    return (res.json.data as { list: Array<{ kind: string; delta: number }> }).list;
  };

  const createWechatOrder = async (sku: string): Promise<{ orderId: string; amountCents: number; credits: number }> => {
    const created = await inject("POST", "/billing/orders", { payload: { sku, channel: "wechat", mode: "native" }, token: userToken });
    expect(created.json.code).toBe(0);
    const order = created.json.data as { order_id: string; amount_cents: number; credits: number };
    return { orderId: order.order_id, amountCents: order.amount_cents, credits: order.credits };
  };

  const payWechatOrder = async (order: { orderId: string; amountCents: number }) => {
    const rawBody = buildWechatNotifyBody(
      {
        mchid: "1900000005",
        out_trade_no: order.orderId,
        transaction_id: `4200000${randomBytes(4).toString("hex")}`,
        trade_state: "SUCCESS",
        amount: { total: order.amountCents, payer_total: order.amountCents, currency: "CNY" },
      },
      API_V3_KEY,
    );
    const headers = wechatNotifyHeaders(rawBody, platform.privateKeyPem);
    const res = await app.inject({ method: "POST", url: "/v1/billing/notify/wechat", headers, payload: rawBody });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"code":"SUCCESS","message":"成功"}');
  };

  const refund = async (orderId: string, body: Record<string, unknown> = {}) =>
    inject("POST", `/ops/admin/orders/${orderId}/refund`, { payload: body, token: adminToken });

  beforeAll(async () => {
    gateway = await startServer((req, res, body) => {
      if (req.url === "/v3/pay/transactions/native") {
        JSON.parse(body || "{}");
        sendJson(res, 200, { code_url: "weixin://wxpay/bizpayurl?pr=refundfake" });
        return;
      }
      if (req.url === "/v3/refund/domestic/refunds") {
        refundCalls += 1;
        if (refundFailureMode) {
          sendJson(res, 500, { code: "SYSTEM_ERROR", message: "退款系统繁忙" });
          return;
        }
        sendJson(res, 200, {
          refund_id: `50300000${randomBytes(4).toString("hex")}`,
          status: "SUCCESS",
          out_refund_no: JSON.parse(body || "{}").out_refund_no,
        });
        return;
      }
      if (req.url?.endsWith("/close")) {
        res.statusCode = 204;
        res.end();
        return;
      }
      sendJson(res, 404, { code: "NOT_FOUND", message: `unexpected ${req.method} ${req.url}` });
    });

    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app",
      REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6380",
      PAYMENT_LIVE: "true",
      WECHAT_APP_ID: "wxrefundtestapp",
      WECHAT_MCH_ID: "1900000005",
      WECHAT_MCH_SERIAL_NO: "REFUNDSERIAL",
      WECHAT_MCH_PRIVATE_KEY: merchant.privateKeyPem,
      WECHAT_API_V3_KEY: API_V3_KEY,
      WECHAT_PLATFORM_PUBLIC_KEY: platform.publicKeyPem,
      WECHAT_NOTIFY_URL: "https://api.example.com/v1/billing/notify/wechat",
      WECHAT_API_BASE: `http://127.0.0.1:${gateway.port}`,
    });

    const { AppModule } = await import("../src/app.module");
    const { AllExceptionsFilter } = await import("../src/common/http/exception.filter");
    const { EnvelopeInterceptor } = await import("../src/common/http/envelope.interceptor");
    const { NestFactory } = await import("@nestjs/core");
    const { FastifyAdapter } = await import("@nestjs/platform-fastify");
    const cookie = (await import("@fastify/cookie")).default;
    const database = await import("../src/db/database");
    pool = database.pool;

    const existing = await database.db.execute(sql`select count(*)::int as n from skus`);
    if (((existing as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? 0) === 0) {
      await database.db.execute(sql`
        insert into skus (id, kind, sku, label, price_cents, credits, active, created_at, updated_at)
        values
          (1, 'credits', 'credits-500', '500 积分', 5000, 500, true, now(), now()),
          (2, 'credits', 'credits-1000', '1000 积分', 10000, 1000, true, now(), now())
        on conflict (sku) do nothing
      `);
    }

    app = await NestFactory.create(AppModule, new FastifyAdapter({ trustProxy: true, genReqId: () => randomUUID() }), {
      logger: false,
      rawBody: true,
    });
    await app.register(cookie as never);
    app.setGlobalPrefix("v1");
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const phone = `17${String(Date.now()).slice(-9)}`;
    const sms = await inject("POST", "/auth/sms-code", { payload: { phone } });
    const code = (sms.json.data as { debug_code?: string }).debug_code ?? "";
    const login = await inject("POST", "/auth/login", { payload: { phone, code, age_confirmed: true } });
    userToken = (login.json.data as { access_token?: string }).access_token ?? "";
    expect(userToken).not.toBe("");

    const admin = await inject("POST", "/ops/admin/login", { payload: { username: "admin", password: "admin12345" } });
    adminToken = (admin.json.data as { token?: string }).token ?? "";
    expect(adminToken).not.toBe("");
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await new Promise<void>((resolve) => gateway?.server.close(() => resolve()));
  });

  it("refunds through the wechat channel with a fixed idempotent refund number", async () => {
    const before = await balanceOf();
    const order = await createWechatOrder("credits-500");
    await payWechatOrder(order);
    expect(await balanceOf()).toBe(before + order.credits);

    const refundsBefore = refundCalls;
    const res = await refund(order.orderId, { reason: "E3 未成年人误充" });
    expect(res.json.code).toBe(0);
    const data = res.json.data as {
      status: number;
      refund_no: string;
      refund_status: string;
      refund_amount_cents: number;
      idempotent: boolean;
      channel_refund_id?: string;
    };
    expect(data.status).toBe(4);
    expect(data.refund_no).toBe(`rf-${order.orderId}`);
    expect(data.refund_status).toBe("succeeded");
    expect(data.refund_amount_cents).toBe(order.amountCents);
    expect(data.idempotent).toBe(false);
    expect(data.channel_refund_id).toBeTruthy();

    // 渠道侧确实收到退款请求：幂等单号、全额、签名可被商户公钥验证
    expect(refundCalls).toBe(refundsBefore + 1);
    const call = [...gateway.requests].reverse().find((req) => req.url === "/v3/refund/domestic/refunds");
    expect(call).toBeDefined();
    const body = JSON.parse(call?.body ?? "{}") as {
      out_trade_no: string;
      out_refund_no: string;
      amount: { refund: number; total: number; currency: string };
    };
    expect(body.out_trade_no).toBe(order.orderId);
    expect(body.out_refund_no).toBe(`rf-${order.orderId}`);
    expect(body.amount).toEqual({ refund: order.amountCents, total: order.amountCents, currency: "CNY" });
    const auth = parseAuthorizationFields(String(call?.headers.authorization ?? ""));
    expect(
      rsaVerify(
        merchant.publicKeyPem,
        `POST\n/v3/refund/domestic/refunds\n${auth.timestamp}\n${auth.nonce_str}\n${call?.body}\n`,
        auth.signature,
      ),
    ).toBe(true);

    // 余额回冲 + 负向流水
    expect(await balanceOf()).toBe(before);
    const rows = await flows();
    const refundFlows = rows.filter((row) => row.kind === "refund");
    expect(refundFlows).toHaveLength(1);
    expect(refundFlows[0].delta).toBe(-order.credits);
    expect(rows.reduce((acc, row) => acc + row.delta, 0)).toBe(await balanceOf());
  });

  it("does not call the channel twice on repeated refund (idempotent)", async () => {
    const order = await createWechatOrder("credits-1000");
    await payWechatOrder(order);
    const first = await refund(order.orderId, { reason: "idempotent" });
    expect(first.json.code).toBe(0);
    const callsAfterFirst = refundCalls;

    const second = await refund(order.orderId, { reason: "idempotent" });
    expect(second.json.code).toBe(0);
    expect((second.json.data as { idempotent: boolean }).idempotent).toBe(true);
    expect(refundCalls).toBe(callsAfterFirst);
  });

  it("keeps the order paid and does not roll back credits when the channel refund fails", async () => {
    const order = await createWechatOrder("credits-1000");
    await payWechatOrder(order);
    const balanceBefore = await balanceOf();
    const refundFlowsBefore = (await flows()).filter((row) => row.kind === "refund").length;

    refundFailureMode = true;
    try {
      const res = await refund(order.orderId, { reason: "channel failure" });
      expect(res.json.code).toBe(745900); // VENDOR_ERROR（渠道错误，未入账/未冲正）
    } finally {
      refundFailureMode = false;
    }

    // 事务回滚：订单保持已支付、积分未冲正、无 refund 流水
    expect(await balanceOf()).toBe(balanceBefore);
    const detail = await inject("GET", `/billing/orders/${order.orderId}`, { token: userToken });
    const orderDto = detail.json.data as { status: number; refund_no: string | null };
    expect(orderDto.status).toBe(2);
    expect(orderDto.refund_no).toBeNull();
    expect((await flows()).filter((row) => row.kind === "refund")).toHaveLength(refundFlowsBefore);

    // 失败后重试应能成功（渠道恢复后运营可重试，幂等单号不变）
    const retry = await refund(order.orderId, { reason: "retry after failure" });
    expect(retry.json.code).toBe(0);
    expect((retry.json.data as { status: number }).status).toBe(4);
    expect(await balanceOf()).toBe(balanceBefore - order.credits);
  });

  it("rejects refunding an unpaid wechat order without calling the channel", async () => {
    const order = await createWechatOrder("credits-500");
    const callsBefore = refundCalls;
    const res = await refund(order.orderId);
    expect(res.json.code).toBe(400101);
    expect(refundCalls).toBe(callsBefore);
    const detail = await inject("GET", `/billing/orders/${order.orderId}`, { token: userToken });
    expect((detail.json.data as { status: number }).status).toBe(1);
  });
});
