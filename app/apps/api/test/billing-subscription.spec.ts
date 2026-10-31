import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, eq } from "drizzle-orm";
import { createDb, creditFlows, orders, skuPromotions, skus, subscriptions } from "@app/db";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";

/**
 * 订阅制 + 动态价格（第 23 项计费 75% → 补齐；对照竞品 VIP 13 档与 `sku-price`）。
 *
 * 五条断言对应五个真实风险，而不是"端点能返回"：
 * 1. **VIP 商品才进订阅，充值包不行**：否则用户会"订阅充值包"，拿到一份没有权益的订阅；
 * 2. **支付成功才激活**：下单不动订阅（未付款就有权益 = 白送）；
 * 3. **续期不从过去补**：断档后再买，起点取 max(现在, 原到期日)；
 * 4. **取消 = 关自动续费**，到期前权益仍在（不是立即失效）；
 * 5. **动态价格可解释**：活动价与牌价的关系能被断言出来，而不是"前端看着像"。
 */
const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app");

let app: NestFastifyApplication;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
const tag = String(Date.now()).slice(-6);
let token = "";
let spaceId = "";
let vipSkuId = "";
const vipSku = `spec-vip-month-${tag}`;
const vipYearSku = `spec-vip-year-${tag}`;
const creditsSku = `spec-credits-${tag}`;

async function inject(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
  authToken = token,
) {
  const headers: Record<string, string> = {};
  if (payload) headers["content-type"] = "application/json";
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  const res = await app.inject({ method, url: `/v1${url}`, payload, headers });
  return { status: res.statusCode, body: res.json() as { code: number; msg: string; data: any } };
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

  const sms = await inject("POST", "/auth/sms-code", { phone }, "");
  const login = await inject(
    "POST",
    "/auth/login",
    { phone, code: sms.body.data.debug_code as string, age_confirmed: true },
    "",
  );
  token = login.body.data.access_token as string;
  spaceId = login.body.data.space_id as string;

  // 自造两档 SKU，不依赖 seed 是否已跑（测试要能在任何 dev 库上独立成立）
  const base = Date.now() * 1000;
  await db.insert(skus).values({
    id: BigInt(base + 1),
    kind: "vip",
    sku: vipSku,
    label: "规格测试会员 · 月",
    priceCents: 3900,
    credits: 600,
    period: "month",
    active: true,
  });
  await db.insert(skus).values({
    id: BigInt(base + 2),
    kind: "vip",
    sku: vipYearSku,
    label: "规格测试会员 · 年",
    priceCents: 39900,
    credits: 6000,
    period: "year",
    active: true,
  });
  await db.insert(skus).values({
    id: BigInt(base + 3),
    kind: "credits",
    sku: creditsSku,
    label: "规格测试积分包",
    priceCents: 5000,
    credits: 500,
    active: true,
  });
  const [row] = await db.select().from(skus).where(eq(skus.sku, vipSku));
  vipSkuId = String(row!.id);
});

afterAll(async () => {
  const orderRows = await db.select().from(orders).where(eq(orders.spaceId, BigInt(spaceId)));
  for (const order of orderRows) {
    await db.delete(subscriptions).where(eq(subscriptions.orderId, order.id));
  }
  await db.delete(subscriptions).where(eq(subscriptions.spaceId, BigInt(spaceId)));
  await db.delete(creditFlows).where(eq(creditFlows.spaceId, BigInt(spaceId)));
  await db.delete(orders).where(eq(orders.spaceId, BigInt(spaceId)));
  await db.delete(skuPromotions).where(eq(skuPromotions.sku, vipSku));
  await db.delete(skus).where(and(eq(skus.sku, vipSku), eq(skus.id, BigInt(vipSkuId))));
  await db.delete(skus).where(eq(skus.sku, vipYearSku));
  await db.delete(skus).where(eq(skus.sku, creditsSku));
  await app.close();
  await pool.end();
});

describe("订阅制", () => {
  it("档位列表只含 VIP 商品（充值包不进订阅档）", async () => {
    const res = await inject("GET", "/billing/plans", undefined, "");
    expect(res.body.code).toBe(0);
    const skusList = res.body.data.plans as Array<{ sku: string; price_cents: number }>;
    expect(skusList.some((plan) => plan.sku === vipSku)).toBe(true);
    expect(skusList.some((plan) => plan.sku === creditsSku)).toBe(false);
  });

  it("未订阅时 /billing/subscription 返回 null 而不是 404", async () => {
    const res = await inject("GET", "/billing/subscription");
    expect(res.body.code).toBe(0);
    expect(res.body.data).toBeNull();
  });

  it("充值包不能走订阅下单（不能被伪装成订阅）", async () => {
    const res = await inject("POST", "/billing/subscribe", { sku: creditsSku, channel: "mock" });
    expect(res.body.code).not.toBe(0);
    expect(res.body.msg).toContain("subscription");
  });

  it("下单不激活订阅（付款前没有权益）", async () => {
    const created = await inject("POST", "/billing/subscribe", { sku: vipSku, channel: "mock" });
    expect(created.body.code).toBe(0);
    const status = await inject("GET", "/billing/subscription");
    expect(status.body.data).toBeNull();
  });

  it("支付成功后激活订阅，且天数等于周期（月=30 天）", async () => {
    const created = await inject("POST", "/billing/subscribe", { sku: vipSku, channel: "mock" });
    const orderId = created.body.data.order_id as string;
    const paid = await inject("POST", `/billing/orders/${orderId}/mock-pay`, {});
    expect(paid.body.code).toBe(0);

    const status = await inject("GET", "/billing/subscription");
    expect(status.body.code).toBe(0);
    expect(status.body.data.sku).toBe(vipSku);
    expect(status.body.data.days_left).toBeGreaterThanOrEqual(29);
    expect(status.body.data.days_left).toBeLessThanOrEqual(30);
    expect(status.body.data.auto_renew).toBe(true);
  });

  it("再次购买是续期（到期日顺延，active 行仍只有一条）", async () => {
    const before = await inject("GET", "/billing/subscription");
    const beforeEnd = new Date(before.body.data.end_at as string).getTime();

    const created = await inject("POST", "/billing/subscribe", { sku: vipSku, channel: "mock" });
    await inject("POST", `/billing/orders/${created.body.data.order_id}/mock-pay`, {});

    const after = await inject("GET", "/billing/subscription");
    const afterEnd = new Date(after.body.data.end_at as string).getTime();
    expect(afterEnd).toBeGreaterThan(beforeEnd);

    const activeRows = await db
      .select()
      .from(subscriptions)
      .where(and(eq(subscriptions.spaceId, BigInt(spaceId)), eq(subscriptions.status, 1)));
    expect(activeRows).toHaveLength(1);
  });

  it("升级换档：折抵后新周期从今天起算，不叠加旧周期剩余天数", async () => {
    const before = await inject("GET", "/billing/subscription");
    const beforeEnd = new Date(before.body.data.end_at as string).getTime();
    expect(beforeEnd).toBeGreaterThan(Date.now());

    const quote = await inject("GET", `/billing/upgrade-quote?sku=${vipYearSku}`);
    expect(quote.body.code).toBe(0);
    expect(quote.body.data.is_upgrade).toBe(true);
    expect(quote.body.data.credit_cents).toBeGreaterThan(0);
    const payable = quote.body.data.payable_cents as number;
    expect(payable).toBeLessThan(39900);

    const created = await inject("POST", "/billing/subscribe", { sku: vipYearSku, channel: "mock" });
    expect(created.body.code).toBe(0);
    expect(created.body.data.amount_cents).toBe(payable);
    await inject("POST", `/billing/orders/${created.body.data.order_id}/mock-pay`, {});

    const after = await inject("GET", "/billing/subscription");
    expect(after.body.data.sku).toBe(vipYearSku);
    const afterEnd = new Date(after.body.data.end_at as string).getTime();
    // 折抵已买断旧周期剩余价值 → 新到期日 ≈ 今天 + 365 天。
    // 若仍按续期顺延，会额外多出旧周期剩余的约 59 天（> 旧到期日 + 365 天）。
    expect(afterEnd - Date.now()).toBeLessThanOrEqual(365 * 86_400_000 + 60_000);
    expect(afterEnd - Date.now()).toBeGreaterThan(364 * 86_400_000);
  });

  it("取消订阅只关自动续费，到期前权益仍在", async () => {
    const res = await inject("POST", "/billing/subscription/cancel", {});
    expect(res.body.code).toBe(0);
    expect(res.body.data.auto_renew).toBe(false);

    const status = await inject("GET", "/billing/subscription");
    expect(status.body.data).not.toBeNull();
    expect(status.body.data.auto_renew).toBe(false);
  });

  it("没有订阅时取消返回业务错误而不是 500", async () => {
    const other = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
    const sms = await inject("POST", "/auth/sms-code", { phone: other }, "");
    const login = await inject(
      "POST",
      "/auth/login",
      { phone: other, code: sms.body.data.debug_code as string, age_confirmed: true },
      "",
    );
    const otherToken = login.body.data.access_token as string;
    const res = await inject("POST", "/billing/subscription/cancel", {}, otherToken);
    expect(res.body.code).not.toBe(0);
    expect(res.status).toBeLessThan(500);
  });
});

describe("动态价格 sku-price", () => {
  it("无活动时返回牌价且折扣为 0", async () => {
    const res = await inject("GET", `/billing/sku-price?sku=${vipSku}`, undefined, "");
    expect(res.body.code).toBe(0);
    expect(res.body.data.price_cents).toBe(3900);
    expect(res.body.data.discount_cents).toBe(0);
    expect(res.body.data.promotion).toBeNull();
  });

  it("限时特价生效时返回活动价并给出折扣来源", async () => {
    await db.insert(skuPromotions).values({
      id: BigInt(Date.now()) * 1000n + 9n,
      sku: vipSku,
      kind: 1,
      priceCents: 2900,
      label: "限时 5 折",
      active: true,
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 3_600_000),
    });
    const res = await inject("GET", `/billing/sku-price?sku=${vipSku}`, undefined, "");
    expect(res.body.data.price_cents).toBe(2900);
    expect(res.body.data.list_price_cents).toBe(3900);
    expect(res.body.data.discount_cents).toBe(1000);
    expect(res.body.data.promotion.label).toBe("限时 5 折");
  });

  it("过期活动不再生效（活动时间边界必须真的生效）", async () => {
    await db
      .update(skuPromotions)
      .set({ endsAt: new Date(Date.now() - 1000) })
      .where(eq(skuPromotions.sku, vipSku));
    const res = await inject("GET", `/billing/sku-price?sku=${vipSku}`, undefined, "");
    expect(res.body.data.price_cents).toBe(3900);
  });

  it("不存在的 sku 返回业务错误", async () => {
    const res = await inject("GET", "/billing/sku-price?sku=does-not-exist", undefined, "");
    expect(res.body.code).not.toBe(0);
  });
});
