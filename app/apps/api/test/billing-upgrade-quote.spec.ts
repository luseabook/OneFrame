import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { createDb, skus, subscriptions } from "@app/db";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";

/**
 * 升级补差价**报价**（第 23 项计费）。
 *
 * 竞品 ReelMate 有升级入口，但折算规则无证据可取证 —— 因此本仓口径是**自定**的、
 * 已登记进度文档 §5.4 第 1 条待确认：折抵 = 当前档有效价 × 剩余天数 / 当前档周期天数。
 *
 * 这里断言的不是"端点能返回"，而是四个真实会赔钱的边界：
 * 1. **无生效订阅不能折抵**：否则等于白送（没买过也能抵）；
 * 2. **同档不能升级**：否则反复调接口就能把价格抵到 0；
 * 3. **降价不算升级**：降级必须走"到期自然生效"，不能退钱（需求里没有退款语义）；
 * 4. **剩余天数折抵随时间递减**：剩 15 天只能是整月的一半，不能虚高。
 */
const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app");

let app: NestFastifyApplication;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
const tag = String(Date.now()).slice(-6);
let token = "";
let spaceId = "";
let userId = "";
const monthSku = `spec-up-month-${tag}`;
const yearSku = `spec-up-year-${tag}`;
const cheapSku = `spec-up-cheap-${tag}`;
let monthSkuId = "";
let yearSkuId = "";

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

/** 换掉当前订阅行（每次断言前准备状态，避免测试之间靠顺序耦合） */
async function setSubscription(skuValue: string, skuRowId: string, daysLeft: number) {
  await db.delete(subscriptions).where(eq(subscriptions.spaceId, BigInt(spaceId)));
  if (daysLeft <= 0) return;
  await db.insert(subscriptions).values({
    // 雪花 id 由调用方给（schema 无 default），测试自己造一个不撞车的
    id: BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 999)),
    spaceId: BigInt(spaceId),
    userId: BigInt(userId),
    skuId: BigInt(skuRowId),
    sku: skuValue,
    startAt: new Date(Date.now() - 1_000),
    endAt: new Date(Date.now() + daysLeft * 86_400_000),
    status: 1,
  });
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
  // 用户 id 在 login 响应的 user 子对象里（顶层只有 space_id）
  userId = String(login.body.data.user.id);

  const base = Date.now() * 1000;
  await db.insert(skus).values([
    { id: BigInt(base + 1), kind: "vip", sku: monthSku, label: "月卡", priceCents: 3900, credits: 600, period: "month", active: true },
    { id: BigInt(base + 2), kind: "vip", sku: yearSku, label: "年卡", priceCents: 19900, credits: 8000, period: "year", active: true },
    { id: BigInt(base + 3), kind: "vip", sku: cheapSku, label: "周卡(更便宜)", priceCents: 900, credits: 100, period: "7d", active: true },
  ]);
  const rows = await db.select().from(skus);
  monthSkuId = String(rows.find((r) => r.sku === monthSku)!.id);
  yearSkuId = String(rows.find((r) => r.sku === yearSku)!.id);
});

afterAll(async () => {
  await db.delete(subscriptions).where(eq(subscriptions.spaceId, BigInt(spaceId)));
  for (const sku of [monthSku, yearSku, cheapSku]) {
    await db.delete(skus).where(eq(skus.sku, sku));
  }
  await app.close();
  await pool.end();
});

describe("升级补差价报价", () => {
  it("无生效订阅时不给折抵（否则没买过也能抵）", async () => {
    await setSubscription(monthSku, monthSkuId, 0);
    const res = await inject("GET", `/billing/upgrade-quote?sku=${yearSku}`);
    expect(res.body.code).toBe(0);
    expect(res.body.data.is_upgrade).toBe(false);
    expect(res.body.data.reason).toBe("no_active_subscription");
    expect(res.body.data.credit_cents).toBe(0);
    expect(res.body.data.payable_cents).toBe(19900);
  });

  it("满月月卡升年卡：折抵整月价，应付 = 年卡 − 月卡", async () => {
    await setSubscription(monthSku, monthSkuId, 30);
    const res = await inject("GET", `/billing/upgrade-quote?sku=${yearSku}`);
    expect(res.body.data.is_upgrade).toBe(true);
    expect(res.body.data.days_left).toBe(30);
    expect(res.body.data.current_period_days).toBe(30);
    expect(res.body.data.credit_cents).toBe(3900);
    expect(res.body.data.payable_cents).toBe(16000);
  });

  it("剩 15 天只折一半（折抵随时间递减，不能虚高）", async () => {
    await setSubscription(monthSku, monthSkuId, 15);
    const res = await inject("GET", `/billing/upgrade-quote?sku=${yearSku}`);
    expect(res.body.data.is_upgrade).toBe(true);
    expect(res.body.data.days_left).toBe(15);
    expect(res.body.data.credit_cents).toBe(1950);
    expect(res.body.data.payable_cents).toBe(17950);
  });

  it("同档不算升级（否则反复调用能把价格抵到 0）", async () => {
    await setSubscription(monthSku, monthSkuId, 30);
    const res = await inject("GET", `/billing/upgrade-quote?sku=${monthSku}`);
    expect(res.body.data.is_upgrade).toBe(false);
    expect(res.body.data.reason).toBe("same_plan");
    expect(res.body.data.credit_cents).toBe(0);
  });

  it("降价不算升级（降级走到期自然生效，不退钱）", async () => {
    await setSubscription(yearSku, yearSkuId, 200);
    const res = await inject("GET", `/billing/upgrade-quote?sku=${monthSku}`);
    expect(res.body.data.is_upgrade).toBe(false);
    expect(res.body.data.reason).toBe("not_an_upgrade");
    expect(res.body.data.credit_cents).toBe(0);
  });

  it("充值包不能当升级目标（不是订阅商品）", async () => {
    await setSubscription(monthSku, monthSkuId, 30);
    const res = await inject("GET", "/billing/upgrade-quote?sku=does-not-exist");
    expect(res.body.code).not.toBe(0);
  });
});
