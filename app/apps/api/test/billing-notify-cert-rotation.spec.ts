import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  buildWechatNotifyBody,
  generateRsaKeyPair,
  wechatNotifyHeaders,
} from "./channels-test-utils";

/**
 * 微信平台证书轮换（api-spec §10.3，e2e）：
 * - `WECHAT_PLATFORM_PUBLIC_KEYS`（serial → PEM）+ 回调按 `Wechatpay-Serial` 精确选公钥；
 * - 未知 serial → 401 默认拒绝；未带 serial → 回退单公钥 `WECHAT_PLATFORM_PUBLIC_KEY`；
 * - 轮换期新旧证书可同时在线。
 *
 * 注意：本文件必须在设置 env 之后动态导入 AppModule（env 在 import 时解析一次），
 * 因此这里不再静态导入任何依赖 env 的模块；纯函数选择逻辑在 channels-factory.spec.ts。
 */

const oldPlatform = generateRsaKeyPair();
const newPlatform = generateRsaKeyPair();
const fallbackPlatform = generateRsaKeyPair();
const API_V3_KEY = "0123456789abcdef0123456789abcdef";
const SERIAL_OLD = "OLD_SERIAL_0001";
const SERIAL_NEW = "NEW_SERIAL_0002";
const WECHAT_SUCCESS = '{"code":"SUCCESS","message":"成功"}';


describe("wechat platform cert rotation (notify e2e)", () => {
  let app: import("@nestjs/platform-fastify").NestFastifyApplication;
  let pool: { end: () => Promise<void> };
  let db: typeof import("../src/db/database").db;
  let ordersTable: typeof import("@app/db").orders;
  let token = "";

  const inject = async (path: string, body?: unknown, tokenValue?: string) => {
    const res = await app.inject({
      method: "POST",
      url: `/v1${path}`,
      headers: {
        "content-type": "application/json",
        ...(tokenValue ? { authorization: `Bearer ${tokenValue}` } : {}),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(res.body) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: res.statusCode, rawBody: res.body, json };
  };

  const getJson = async (path: string) => {
    const res = await app.inject({ method: "GET", url: `/v1${path}`, headers: { authorization: `Bearer ${token}` } });
    return JSON.parse(res.body) as { data: unknown };
  };

  const balance = async (): Promise<number> => {
    const me = (await getJson("/me")) as { data: { credits: { balance: number } } };
    return me.data.credits.balance;
  };

  /** 建一条 mock 订单后把渠道改成 wechat（回调只关心订单 id/金额快照） */
  const createWechatOrder = async (sku: string): Promise<{ orderId: string; amountCents: number; credits: number }> => {
    const created = await inject("/billing/orders", { sku, channel: "mock" }, token);
    expect(created.json.code).toBe(0);
    const order = created.json.data as { order_id: string; amount_cents: number; credits: number };
    await db.update(ordersTable).set({ channel: "wechat" }).where(eq(ordersTable.id, BigInt(order.order_id)));
    return { orderId: order.order_id, amountCents: order.amount_cents, credits: order.credits };
  };

  const buildNotify = (input: {
    outTradeNo: string;
    transactionId: string;
    amountCents: number;
    signWith: string;
    serial?: string;
    tamperSignature?: boolean;
  }) => {
    const plaintext = {
      mchid: "1900000004",
      out_trade_no: input.outTradeNo,
      transaction_id: input.transactionId,
      trade_state: "SUCCESS",
      amount: { total: input.amountCents, payer_total: input.amountCents, currency: "CNY" },
    };
    const rawBody = buildWechatNotifyBody(plaintext, API_V3_KEY);
    return {
      rawBody,
      headers: wechatNotifyHeaders(rawBody, input.signWith, {
        serial: input.serial,
        tamperSignature: input.tamperSignature,
      }),
    };
  };

  const sendNotify = (notify: ReturnType<typeof buildNotify>) =>
    app.inject({ method: "POST", url: "/v1/billing/notify/wechat", headers: notify.headers, payload: notify.rawBody });

  beforeAll(async () => {
    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app",
      REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6380",
      PAYMENT_LIVE: "false",
      WECHAT_API_V3_KEY: API_V3_KEY,
      WECHAT_PLATFORM_PUBLIC_KEYS: JSON.stringify({
        [SERIAL_OLD]: oldPlatform.publicKeyPem,
        [SERIAL_NEW]: newPlatform.publicKeyPem,
      }),
      WECHAT_PLATFORM_PUBLIC_KEY: fallbackPlatform.publicKeyPem,
    });

    const { AppModule } = await import("../src/app.module");
    const { AllExceptionsFilter } = await import("../src/common/http/exception.filter");
    const { EnvelopeInterceptor } = await import("../src/common/http/envelope.interceptor");
    const { NestFactory } = await import("@nestjs/core");
    const { FastifyAdapter } = await import("@nestjs/platform-fastify");
    const cookie = (await import("@fastify/cookie")).default;
    const database = await import("../src/db/database");
    const dbIndex = await import("@app/db");
    pool = database.pool;
    db = database.db;
    ordersTable = dbIndex.orders;

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

    const phone = `14${String(Date.now()).slice(-9)}`;
    const sms = await inject("/auth/sms-code", { phone });
    const code = (sms.json.data as { debug_code?: string }).debug_code ?? "";
    const login = await inject("/auth/login", { phone, code, age_confirmed: true });
    token = (login.json.data as { access_token: string }).access_token;
    expect(token).not.toBe("");
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("accepts a notify signed with the current platform certificate (NEW serial)", async () => {
    const order = await createWechatOrder("credits-500");
    const before = await balance();
    const notify = buildNotify({
      outTradeNo: order.orderId,
      transactionId: `4200000${randomBytes(4).toString("hex")}`,
      amountCents: order.amountCents,
      signWith: newPlatform.privateKeyPem,
      serial: SERIAL_NEW,
    });
    const res = await sendNotify(notify);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(WECHAT_SUCCESS);
    expect(await balance()).toBe(before + order.credits);
  });

  it("accepts a notify signed with the previous platform certificate during rotation (OLD serial)", async () => {
    const order = await createWechatOrder("credits-1000");
    const before = await balance();
    const notify = buildNotify({
      outTradeNo: order.orderId,
      transactionId: `4200000${randomBytes(4).toString("hex")}`,
      amountCents: order.amountCents,
      signWith: oldPlatform.privateKeyPem,
      serial: SERIAL_OLD,
    });
    const res = await sendNotify(notify);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(WECHAT_SUCCESS);
    expect(await balance()).toBe(before + order.credits);
  });

  it("rejects unknown Wechatpay-Serial with 401 (default deny)", async () => {
    const order = await createWechatOrder("credits-3000");
    const before = await balance();
    const notify = buildNotify({
      outTradeNo: order.orderId,
      transactionId: `4200000${randomBytes(4).toString("hex")}`,
      amountCents: order.amountCents,
      signWith: newPlatform.privateKeyPem,
      serial: "UNKNOWN_SERIAL_9999",
    });
    const res = await sendNotify(notify);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({ code: "FAIL" });
    expect(res.body).toContain("unknown wechat platform certificate serial");
    expect(await balance()).toBe(before);
  });

  it("falls back to the single public key when no serial header is sent", async () => {
    const order = await createWechatOrder("credits-3000");
    const before = await balance();
    const notify = buildNotify({
      outTradeNo: order.orderId,
      transactionId: `4200000${randomBytes(4).toString("hex")}`,
      amountCents: order.amountCents,
      signWith: fallbackPlatform.privateKeyPem,
    });
    const res = await sendNotify(notify);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(WECHAT_SUCCESS);
    expect(await balance()).toBe(before + order.credits);
  });

  it("rejects a no-serial notify signed by a non-fallback key", async () => {
    const order = await createWechatOrder("credits-6000");
    const before = await balance();
    const notify = buildNotify({
      outTradeNo: order.orderId,
      transactionId: `4200000${randomBytes(4).toString("hex")}`,
      amountCents: order.amountCents,
      signWith: newPlatform.privateKeyPem,
    });
    const res = await sendNotify(notify);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({ code: "FAIL" });
    expect(await balance()).toBe(before);
  });

  it("still rejects tampered signatures even with a valid serial", async () => {
    const order = await createWechatOrder("credits-6000");
    const before = await balance();
    const notify = buildNotify({
      outTradeNo: order.orderId,
      transactionId: `4200000${randomBytes(4).toString("hex")}`,
      amountCents: order.amountCents,
      signWith: newPlatform.privateKeyPem,
      serial: SERIAL_NEW,
      tamperSignature: true,
    });
    const res = await sendNotify(notify);
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain("wechat signature verification failed");
    expect(await balance()).toBe(before);
  });
});
