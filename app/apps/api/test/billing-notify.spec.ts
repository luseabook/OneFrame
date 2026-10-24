import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createCipheriv, randomBytes, randomUUID } from "node:crypto";
import { stringify as stringifyQuery, parse as parseQuery } from "node:querystring";
import { sql } from "drizzle-orm";
import {
  generateRsaKeyPair,
  parseAuthorizationFields,
  rsaSign,
  rsaVerify,
} from "./channels-test-utils";

/**
 * 渠道回调 e2e：真实 HTTP 状态 + 渠道协议响应体 + 幂等入账。
 *
 * 复现的三个生产缺陷（本文件按"修复后"断言真实协议行为）：
 * 1) 微信验签必须对**原始请求体字节**验签：本文件刻意发送带缩进/空白的 JSON，
 *    旧实现用 JSON.stringify(解析后对象) 会因空白丢失导致验签失败；
 * 2) 支付宝通知是 application/x-www-form-urlencoded：旧实现拿不到/拿错参数会验签失败；
 * 3) 回调响应不能包全局信封：微信必须 `{"code":"SUCCESS","message":"成功"}`，
 *    支付宝必须纯文本 `success`；失败必须是真实 HTTP 4xx + 渠道失败体。
 *
 * 微信/支付宝网关均为本地假 HTTP server（不出网，不触碰真实商户）。
 */

interface CapturedHttp {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

function startServer(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void | Promise<void>,
): Promise<{ server: Server; port: number; requests: CapturedHttp[] }> {
  const requests: CapturedHttp[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
      void Promise.resolve(handler(req, res, body)).catch((err: unknown) => {
        res.statusCode = 500;
        res.end(String(err));
      });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port, requests });
    });
  });
}

const sendJson = (res: ServerResponse, status: number, payload: unknown): void => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
};

const sendRaw = (res: ServerResponse, status: number, body: string): void => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(body);
};

const WECHAT_API_V3_KEY = "0123456789abcdef0123456789abcdef";
const merchant = generateRsaKeyPair(); // 商户 API 私钥：出站请求签名
const wechatPlatform = generateRsaKeyPair(); // 微信平台证书：回调用公钥验签
const alipayApp = generateRsaKeyPair(); // 支付宝应用私钥：出站请求签名
const alipayPlatform = generateRsaKeyPair(); // 支付宝公钥：回调/响应验签

const WECHAT_SUCCESS_BODY = '{"code":"SUCCESS","message":"成功"}';
const ALIPAY_SUCCESS_BODY = "success";

describe("payment notify e2e (live channels)", () => {
  let wechatGateway: Awaited<ReturnType<typeof startServer>>;
  let alipayGateway: Awaited<ReturnType<typeof startServer>>;
  let app: import("@nestjs/platform-fastify").NestFastifyApplication;
  let pool: { end: () => Promise<void> };

  let wechatToken = "";
  let alipayToken = "";

  const inject = async (
    method: string,
    url: string,
    options: {
      payload?: unknown;
      rawPayload?: string;
      contentType?: string;
      authToken?: string;
      headers?: Record<string, string>;
    } = {},
  ) => {
    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.authToken) headers.authorization = `Bearer ${options.authToken}`;
    let payload: string | undefined = options.rawPayload;
    if (payload === undefined && options.payload !== undefined) {
      headers["content-type"] = options.contentType ?? "application/json";
      payload = JSON.stringify(options.payload);
    } else if (options.contentType) {
      headers["content-type"] = options.contentType;
    }
    const res = await app.inject({ method: method as "GET" | "POST", url: `/v1${url}`, headers, payload });
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      body = {};
    }
    return { status: res.statusCode, rawBody: res.body, headers: res.headers, body };
  };

  const login = async (prefix: string): Promise<string> => {
    const phone = `${prefix}${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 10)}`;
    const sms = await inject("POST", "/auth/sms-code", { payload: { phone } });
    const code = (sms.body.data as { debug_code?: string } | null)?.debug_code ?? "";
    expect(code).not.toBe("");
    const loginRes = await inject("POST", "/auth/login", {
      payload: { phone, code, age_confirmed: true },
    });
    const token = ((loginRes.body.data as { access_token?: string } | null)?.access_token ?? "") as string;
    expect(token).not.toBe("");
    return token;
  };

  const balanceOf = async (token: string): Promise<number> => {
    const me = await inject("GET", "/me", { authToken: token });
    return (me.body.data as { credits: { balance: number } }).credits.balance;
  };

  /** 构造微信 APIv3 加密回调（plaintext 为官方交易通知结构） */
  const buildWechatNotify = (input: {
    outTradeNo: string;
    transactionId: string;
    amountCents: number;
    pretty?: boolean;
    tamperSignature?: boolean;
    tamperBody?: boolean;
  }) => {
    const plaintext = {
      mchid: "1900000002",
      appid: "wxe2etestappid",
      out_trade_no: input.outTradeNo,
      transaction_id: input.transactionId,
      trade_type: "NATIVE",
      trade_state: "SUCCESS",
      trade_state_desc: "支付成功",
      bank_type: "OTHERS",
      success_time: "2026-10-25T04:00:00+08:00",
      payer: { openid: "oE2Eopenid0001" },
      amount: { total: input.amountCents, payer_total: input.amountCents, currency: "CNY", payer_currency: "CNY" },
    };
    const nonce = "0123456789ab";
    const associatedData = "transaction";
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(WECHAT_API_V3_KEY, "utf8"), Buffer.from(nonce, "utf8"));
    cipher.setAAD(Buffer.from(associatedData, "utf8"));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(plaintext), "utf8"), cipher.final()]);
    const ciphertext = Buffer.concat([encrypted, cipher.getAuthTag()]).toString("base64");

    const payload = {
      id: `EV-${randomBytes(6).toString("hex")}`,
      create_time: "2026-10-25T04:00:00+08:00",
      event_type: "TRANSACTION.SUCCESS",
      resource_type: "encrypt-resource",
      summary: "支付成功",
      resource: {
        original_type: "transaction",
        algorithm: "AEAD_AES_256_GCM",
        ciphertext,
        associated_data: associatedData,
        nonce,
      },
    };
    // 关键：带缩进/空白的原始请求体。旧实现 JSON.stringify(解析后对象) 会丢空白 → 验签失败
    const rawBody = input.pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonceStr = randomBytes(8).toString("hex");
    const signed = rsaSign(wechatPlatform.privateKeyPem, `${timestamp}\n${nonceStr}\n${rawBody}\n`);
    return {
      rawBody,
      headers: {
        "wechatpay-timestamp": timestamp,
        "wechatpay-nonce": nonceStr,
        "wechatpay-signature": input.tamperSignature ? rsaSign(wechatPlatform.privateKeyPem, "tampered") : signed,
      },
    };
  };

  /** 构造支付宝异步通知（urlencoded；默认按官方"排除 sign/sign_type"规则签名） */
  const buildAlipayNotify = (input: {
    outTradeNo: string;
    tradeNo: string;
    totalAmount: string;
    tamperAmount?: boolean;
    tamperSignature?: boolean;
    omitSignature?: boolean;
  }) => {
    const params: Record<string, string> = {
      app_id: "2016102300012345",
      notify_time: "2026-10-25 04:00:00",
      notify_type: "trade_status_sync",
      notify_id: randomBytes(8).toString("hex"),
      charset: "utf-8",
      version: "1.0",
      sign_type: "RSA2",
      out_trade_no: input.outTradeNo,
      trade_no: input.tradeNo,
      trade_status: "TRADE_SUCCESS",
      total_amount: input.totalAmount,
      receipt_amount: input.totalAmount,
      subject: "一帧 500 积分",
    };
    const content = Object.keys(params)
      .filter((k) => k !== "sign" && k !== "sign_type" && params[k] !== "")
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    params.sign = input.tamperSignature ? rsaSign(alipayPlatform.privateKeyPem, "tampered") : rsaSign(alipayPlatform.privateKeyPem, content);
    if (input.tamperAmount) params.total_amount = "0.01";
    if (input.omitSignature) delete params.sign;
    return stringifyQuery(params);
  };

  beforeAll(async () => {
    // ── 假微信网关 ──
    wechatGateway = await startServer((req, res, body) => {
      if (req.method === "POST" && req.url === "/v3/pay/transactions/native") {
        JSON.parse(body || "{}");
        sendJson(res, 200, { code_url: "weixin://wxpay/bizpayurl?pr=e2efake" });
        return;
      }
      if (req.method === "POST" && req.url?.endsWith("/close")) {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.method === "POST" && req.url === "/v3/refund/domestic/refunds") {
        sendJson(res, 200, { refund_id: `rf-${randomBytes(4).toString("hex")}`, status: "PROCESSING" });
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/v3/pay/transactions/out-trade-no/")) {
        sendJson(res, 200, { trade_state: "SUCCESS", transaction_id: "wx-query-tx", amount: { total: 1 } });
        return;
      }
      sendJson(res, 404, { code: "NOT_FOUND", message: `unexpected ${req.method} ${req.url}` });
    });

    // ── 假支付宝网关 ──
    alipayGateway = await startServer((req, res, body) => {
      if (req.url?.startsWith("/gateway.do")) {
        const form = parseQuery(body) as Record<string, string | string[]>;
        const method = String(form.method ?? "");
        if (method === "alipay.trade.precreate") {
          const node = { code: "10000", msg: "Success", qr_code: "https://qr.alipay.com/e2efake" };
          const rawNode = JSON.stringify(node);
          const sign = rsaSign(alipayPlatform.privateKeyPem, rawNode);
          sendRaw(res, 200, `{"alipay_trade_precreate_response":${rawNode},"sign":${JSON.stringify(sign)}}`);
          return;
        }
        if (method === "alipay.trade.close" || method === "alipay.trade.refund" || method === "alipay.trade.query") {
          const nodeKey = `${method.replace(/\./g, "_")}_response`;
          const node = { code: "10000", msg: "Success", trade_no: "ali-tx", trade_status: "TRADE_SUCCESS", total_amount: "50.00" };
          const rawNode = JSON.stringify(node);
          const sign = rsaSign(alipayPlatform.privateKeyPem, rawNode);
          sendRaw(res, 200, `{"${nodeKey}":${rawNode},"sign":${JSON.stringify(sign)}}`);
          return;
        }
        sendJson(res, 404, { error_response: { code: "40004", msg: "unknown method" } });
        return;
      }
      sendJson(res, 404, { error: "unexpected" });
    });

    // ── 渠道凭据（全部本地生成，进程内注入，绝不落到文件/日志）──
    Object.assign(process.env, {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app",
      REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6380",
      NODE_ENV: "test",
      PAYMENT_LIVE: "true",
      WECHAT_APP_ID: "wxe2etestappid",
      WECHAT_MCH_ID: "1900000002",
      WECHAT_MCH_SERIAL_NO: "E2ESERIAL0001",
      WECHAT_MCH_PRIVATE_KEY: merchant.privateKeyPem,
      WECHAT_API_V3_KEY,
      WECHAT_PLATFORM_PUBLIC_KEY: wechatPlatform.publicKeyPem,
      WECHAT_NOTIFY_URL: "https://api.example.com/v1/billing/notify/wechat",
      WECHAT_API_BASE: `http://127.0.0.1:${wechatGateway.port}`,
      ALIPAY_APP_ID: "2016102300012345",
      ALIPAY_APP_PRIVATE_KEY: alipayApp.privateKeyPem,
      ALIPAY_PUBLIC_KEY: alipayPlatform.publicKeyPem,
      ALIPAY_NOTIFY_URL: "https://api.example.com/v1/billing/notify/alipay",
      ALIPAY_GATEWAY: `http://127.0.0.1:${alipayGateway.port}/gateway.do`,
    });

    // 环境变量就绪后再加载 env.ts / AppModule（env 在 import 时解析一次）
    const { AppModule } = await import("../src/app.module");
    const { AllExceptionsFilter } = await import("../src/common/http/exception.filter");
    const { EnvelopeInterceptor } = await import("../src/common/http/envelope.interceptor");
    const { NestFactory } = await import("@nestjs/core");
    const { FastifyAdapter } = await import("@nestjs/platform-fastify");
    const cookie = (await import("@fastify/cookie")).default;
    const database = await import("../src/db/database");
    pool = database.pool;

    // 确保 SKU 存在（与 billing.spec 一致：空库时补最小目录）
    const existing = await database.db.execute(sql`select count(*)::int as n from skus`);
    const skuCount = (existing as { rows?: Array<{ n: number }> }).rows?.[0]?.n ?? 0;
    if (skuCount === 0) {
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

    wechatToken = await login("15");
    alipayToken = await login("16");
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
    await new Promise<void>((resolve) => wechatGateway?.server.close(() => resolve()));
    await new Promise<void>((resolve) => alipayGateway?.server.close(() => resolve()));
  });

  it("exposes live channels with credentials configured", async () => {
    const res = await inject("GET", "/billing/channels");
    expect(res.body.code).toBe(0);
    const data = res.body.data as {
      live: boolean;
      channels: Array<{ channel: string; configured: boolean; modes: string[] }>;
    };
    expect(data.live).toBe(true);
    const wechat = data.channels.find((c) => c.channel === "wechat");
    const alipay = data.channels.find((c) => c.channel === "alipay");
    expect(wechat).toMatchObject({ configured: true });
    expect(alipay).toMatchObject({ configured: true });
    // 生产模式不再向客户端暴露 mock 渠道
    expect(data.channels.find((c) => c.channel === "mock")).toBeUndefined();
  });

  it("creates a wechat native order with code_url and a verifiable APIv3 signature", async () => {
    const before = wechatGateway.requests.length;
    const res = await inject("POST", "/billing/orders", {
      payload: { sku: "credits-500", channel: "wechat", mode: "native" },
      authToken: wechatToken,
    });
    expect(res.body.code).toBe(0);
    const order = res.body.data as {
      order_id: string;
      amount_cents: number;
      channel: string;
      status: number;
      pay_params: { mode: string; code_url: string; out_trade_no: string } | null;
    };
    expect(order.channel).toBe("wechat");
    expect(order.status).toBe(1);
    expect(order.pay_params?.mode).toBe("native");
    expect(order.pay_params?.code_url).toBe("weixin://wxpay/bizpayurl?pr=e2efake");

    // 假网关收到的出站请求：签名串必须可被商户公钥验证
    const call = wechatGateway.requests.slice(before).find((r) => r.url === "/v3/pay/transactions/native");
    expect(call).toBeDefined();
    const authorization = String(call?.headers.authorization ?? "");
    expect(authorization.startsWith("WECHATPAY2-SHA256-RSA2048 ")).toBe(true);
    const fields = parseAuthorizationFields(authorization);
    const message = `POST\n/v3/pay/transactions/native\n${fields.timestamp}\n${fields.nonce_str}\n${call?.body}\n`;
    expect(rsaVerify(merchant.publicKeyPem, message, fields.signature)).toBe(true);
  });

  it("acknowledges a signed wechat notify with the exact SUCCESS body and credits once", async () => {
    const orderRes = await inject("POST", "/billing/orders", {
      payload: { sku: "credits-500", channel: "wechat", mode: "native" },
      authToken: wechatToken,
    });
    expect(orderRes.body.code).toBe(0);
    const order = orderRes.body.data as { order_id: string; amount_cents: number; credits: number };
    const balanceBefore = await balanceOf(wechatToken);

    // 带缩进/空白的原始体：只有"按原始字节验签"的实现才能通过
    const notify = buildWechatNotify({
      outTradeNo: order.order_id,
      transactionId: `42000000${randomBytes(4).toString("hex")}`,
      amountCents: order.amount_cents,
      pretty: true,
    });
    const res = await inject("POST", "/billing/notify/wechat", {
      rawPayload: notify.rawBody,
      contentType: "application/json",
      headers: notify.headers,
    });
    expect(res.status).toBe(200);
    expect(res.rawBody).toBe(WECHAT_SUCCESS_BODY);
    expect(res.headers["x-request-id"]).toBeTruthy();

    // 缺陷复现：若用 JSON.stringify(解析后对象)（旧实现）拼验签串，签名必然对不上——
    // 因为微信签名覆盖的是原始字节，pretty 体里的空白在重新序列化后已经丢失。
    const reSerialized = JSON.stringify(JSON.parse(notify.rawBody));
    expect(reSerialized).not.toBe(notify.rawBody);
    const oldImplementationWouldPass = rsaVerify(
      wechatPlatform.publicKeyPem,
      `${notify.headers["wechatpay-timestamp"]}\n${notify.headers["wechatpay-nonce"]}\n${reSerialized}\n`,
      notify.headers["wechatpay-signature"],
    );
    expect(oldImplementationWouldPass).toBe(false);

    expect(await balanceOf(wechatToken)).toBe(balanceBefore + order.credits);

    // 重复回调：仍返回 SUCCESS（渠道不再重试），但只入账一次
    const repeat = await inject("POST", "/billing/notify/wechat", {
      rawPayload: notify.rawBody,
      contentType: "application/json",
      headers: notify.headers,
    });
    expect(repeat.status).toBe(200);
    expect(repeat.rawBody).toBe(WECHAT_SUCCESS_BODY);
    expect(await balanceOf(wechatToken)).toBe(balanceBefore + order.credits);

    const detail = await inject("GET", `/billing/orders/${order.order_id}`, { authToken: wechatToken });
    expect((detail.body.data as { status: number }).status).toBe(2);
  });

  it("rejects a tampered wechat signature with HTTP 401 FAIL body and no credit", async () => {
    const orderRes = await inject("POST", "/billing/orders", {
      payload: { sku: "credits-1000", channel: "wechat", mode: "native" },
      authToken: wechatToken,
    });
    const order = orderRes.body.data as { order_id: string; amount_cents: number };
    const balanceBefore = await balanceOf(wechatToken);

    const notify = buildWechatNotify({
      outTradeNo: order.order_id,
      transactionId: `42000000${randomBytes(4).toString("hex")}`,
      amountCents: order.amount_cents,
      tamperSignature: true,
    });
    const res = await inject("POST", "/billing/notify/wechat", {
      rawPayload: notify.rawBody,
      contentType: "application/json",
      headers: notify.headers,
    });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: "FAIL" });
    expect(await balanceOf(wechatToken)).toBe(balanceBefore);

    const detail = await inject("GET", `/billing/orders/${order.order_id}`, { authToken: wechatToken });
    expect((detail.body.data as { status: number }).status).toBe(1);
  });

  it("rejects a wechat notify whose amount differs from the order snapshot", async () => {
    const orderRes = await inject("POST", "/billing/orders", {
      payload: { sku: "credits-1000", channel: "wechat", mode: "native" },
      authToken: wechatToken,
    });
    const order = orderRes.body.data as { order_id: string; amount_cents: number };
    const balanceBefore = await balanceOf(wechatToken);

    const notify = buildWechatNotify({
      outTradeNo: order.order_id,
      transactionId: `42000000${randomBytes(4).toString("hex")}`,
      amountCents: 1, // 篡改金额
    });
    const res = await inject("POST", "/billing/notify/wechat", {
      rawPayload: notify.rawBody,
      contentType: "application/json",
      headers: notify.headers,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "FAIL" });
    expect(await balanceOf(wechatToken)).toBe(balanceBefore);
  });

  it("closes a pending wechat order locally and on the channel", async () => {
    const orderRes = await inject("POST", "/billing/orders", {
      payload: { sku: "credits-1000", channel: "wechat", mode: "native" },
      authToken: wechatToken,
    });
    const order = orderRes.body.data as { order_id: string };
    const before = wechatGateway.requests.length;
    const closed = await inject("POST", `/billing/orders/${order.order_id}/close`, {
      payload: {},
      authToken: wechatToken,
    });
    expect((closed.body.data as { closed: boolean }).closed).toBe(true);
    expect(
      wechatGateway.requests.slice(before).some((r) => r.method === "POST" && r.url?.endsWith("/close")),
    ).toBe(true);
  });

  it("reuses the pending order and replays pay_params without calling the channel again", async () => {
    const first = await inject("POST", "/billing/orders", {
      payload: { sku: "credits-500", channel: "wechat", mode: "native" },
      authToken: wechatToken,
    });
    const nativeCallCount = wechatGateway.requests.filter((r) => r.url === "/v3/pay/transactions/native").length;
    const second = await inject("POST", "/billing/orders", {
      payload: { sku: "credits-500", channel: "wechat", mode: "native" },
      authToken: wechatToken,
    });
    const firstOrder = first.body.data as { order_id: string; pay_params: { code_url: string } | null };
    const secondOrder = second.body.data as { order_id: string; pay_params: { code_url: string } | null };
    expect(secondOrder.order_id).toBe(firstOrder.order_id);
    expect(secondOrder.pay_params?.code_url).toBe(firstOrder.pay_params?.code_url);
    expect(wechatGateway.requests.filter((r) => r.url === "/v3/pay/transactions/native").length).toBe(nativeCallCount);
  });

  it("creates an alipay precreate order with a signed request and QR code", async () => {
    const before = alipayGateway.requests.length;
    const res = await inject("POST", "/billing/orders", {
      payload: { sku: "credits-500", channel: "alipay", mode: "precreate" },
      authToken: alipayToken,
    });
    expect(res.body.code).toBe(0);
    const order = res.body.data as {
      order_id: string;
      amount_cents: number;
      pay_params: { mode: string; qr_code: string } | null;
    };
    expect(order.pay_params?.mode).toBe("precreate");
    expect(order.pay_params?.qr_code).toBe("https://qr.alipay.com/e2efake");

    const call = alipayGateway.requests.slice(before)[0];
    expect(call).toBeDefined();
    const form = parseQuery(call.body) as Record<string, string>;
    expect(form.method).toBe("alipay.trade.precreate");
    const content = Object.keys(form)
      .filter((k) => k !== "sign" && form[k] !== "")
      .sort()
      .map((k) => `${k}=${form[k]}`)
      .join("&");
    expect(rsaVerify(alipayApp.publicKeyPem, content, form.sign)).toBe(true);
  });

  it("accepts an alipay urlencoded notify with plain-text success and credits once", async () => {
    const orderRes = await inject("POST", "/billing/orders", {
      payload: { sku: "credits-500", channel: "alipay", mode: "precreate" },
      authToken: alipayToken,
    });
    expect(orderRes.body.code).toBe(0);
    const order = orderRes.body.data as { order_id: string; amount_cents: number; credits: number };
    const balanceBefore = await balanceOf(alipayToken);

    const rawBody = buildAlipayNotify({
      outTradeNo: order.order_id,
      tradeNo: `20261025220014${randomBytes(4).toString("hex")}`,
      totalAmount: (order.amount_cents / 100).toFixed(2),
    });
    const res = await inject("POST", "/billing/notify/alipay", {
      rawPayload: rawBody,
      contentType: "application/x-www-form-urlencoded",
    });
    expect(res.status).toBe(200);
    expect(res.rawBody).toBe(ALIPAY_SUCCESS_BODY);
    expect(res.headers["x-request-id"]).toBeTruthy();
    // 支付宝只认纯文本 success；被全局信封包成 {"code":0,...} 会导致无限重试
    expect(String(res.headers["content-type"])).toContain("text/plain");
    expect(res.rawBody).not.toContain('"code"');
    expect(await balanceOf(alipayToken)).toBe(balanceBefore + order.credits);

    // 重复通知只入账一次，且仍返回 success
    const repeat = await inject("POST", "/billing/notify/alipay", {
      rawPayload: rawBody,
      contentType: "application/x-www-form-urlencoded",
    });
    expect(repeat.status).toBe(200);
    expect(repeat.rawBody).toBe(ALIPAY_SUCCESS_BODY);
    expect(await balanceOf(alipayToken)).toBe(balanceBefore + order.credits);
  });

  it("rejects alipay notify with tampered amount (signature mismatch) and plain-text failure", async () => {
    const orderRes = await inject("POST", "/billing/orders", {
      payload: { sku: "credits-1000", channel: "alipay", mode: "precreate" },
      authToken: alipayToken,
    });
    const order = orderRes.body.data as { order_id: string; amount_cents: number };
    const balanceBefore = await balanceOf(alipayToken);

    const rawBody = buildAlipayNotify({
      outTradeNo: order.order_id,
      tradeNo: `20261025220014${randomBytes(4).toString("hex")}`,
      totalAmount: (order.amount_cents / 100).toFixed(2),
      tamperAmount: true,
    });
    const res = await inject("POST", "/billing/notify/alipay", {
      rawPayload: rawBody,
      contentType: "application/x-www-form-urlencoded",
    });
    expect(res.status).toBe(401);
    expect(res.rawBody).toBe("failure");
    expect(await balanceOf(alipayToken)).toBe(balanceBefore);
  });

  it("rejects alipay notify without a signature", async () => {
    const rawBody = buildAlipayNotify({
      outTradeNo: "999",
      tradeNo: "888",
      totalAmount: "1.00",
      omitSignature: true,
    });
    const res = await inject("POST", "/billing/notify/alipay", {
      rawPayload: rawBody,
      contentType: "application/x-www-form-urlencoded",
    });
    expect(res.status).toBe(401);
    expect(res.rawBody).toBe("failure");
  });

  it("returns HTTP 403 for mock endpoints when PAYMENT_LIVE=true", async () => {
    const orderRes = await inject("POST", "/billing/orders", {
      payload: { sku: "credits-500", channel: "wechat", mode: "native" },
      authToken: wechatToken,
    });
    const order = orderRes.body.data as { order_id: string };

    const mockPay = await inject("POST", `/billing/orders/${order.order_id}/mock-pay`, {
      payload: {},
      authToken: wechatToken,
    });
    expect(mockPay.status).toBe(403);
    expect(mockPay.body).toMatchObject({ code: 403101 });

    const mockNotify = await inject("POST", "/billing/notify/mock", {
      payload: { order_id: order.order_id, channel_order_id: "x" },
    });
    expect(mockNotify.status).toBe(403);
    expect(mockNotify.body).toMatchObject({ code: 403101 });
  });
});
