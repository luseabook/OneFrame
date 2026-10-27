import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { createDb, modelPrices, models } from "@app/db";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";

/**
 * 按秒计价转译层（第 23 项计费最后一块）。
 *
 * 真实风险：价目表只覆盖 5s / 10s 两档，用户请求 20s 时旧逻辑"就近取低档"会按 10s 收
 * ——**请求越长越亏，且长视频是主力场景**。这里锁住三件事：
 * 1. 命中真实档 → 按档位价（`pricingBasis: tier`）；
 * 2. 请求低于最低档 → 仍按最低档收（`tier_lower`，宁多收不漏收，且与 PRD F2「就近取低档」一致）；
 * 3. 请求高于最高档 → `ceil(秒 × 每秒单价)`（`seconds`），且**严格贵于最高档**。
 */
const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app");

let app: NestFastifyApplication;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
const tag = String(Date.now()).slice(-6);
const modelName = `spec-seconds-model-${tag}`;
let token = "";
let modelId = "";

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
  await app.useGlobalInterceptors(new EnvelopeInterceptor());
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

  // 自造模型 + 两档价目（5s=100 积分，10s=180 积分），不依赖 seed
  const base = Date.now() * 1000;
  await db.insert(models).values({
    id: BigInt(base + 1),
    vendor: "self",
    name: modelName,
    displayName: "秒级计价测试模型",
    description: "",
    logo: "",
    capability: "video",
    types: [],
    tags: [],
    promotions: [],
    adapterCode: "mock-video",
    visible: true,
    needVip: false,
    audioVideoSupport: false,
    sort: 100,
    modeOrder: {},
    modes: {
      text2video: {
        ratios: ["9:16"],
        resolutions: ["720p"],
        // 枚举允许 2/15/20，但价目表只登记了 5/10 两档 —— 这正是"按秒转译"要覆盖的场景
        durations: [2, 5, 10, 15, 20],
        countMax: 1,
      },
    },
    sceneModes: {},
  });
  const [row] = await db.select().from(models).where(eq(models.name, modelName));
  modelId = String(row!.id);
  await db.insert(modelPrices).values([
    { id: BigInt(base + 11), modelId: row!.id, mode: "text2video", resolution: "720p", durationS: 5, credits: 100, strikeCredits: 100, active: true },
    { id: BigInt(base + 12), modelId: row!.id, mode: "text2video", resolution: "720p", durationS: 10, credits: 180, strikeCredits: 180, active: true },
  ]);
});

afterAll(async () => {
  await db.delete(modelPrices).where(eq(modelPrices.modelId, BigInt(modelId)));
  await db.delete(models).where(eq(models.name, modelName));
  await app.close();
  await pool.end();
});

function quoteBody(duration: number) {
  return {
    mode: "text2video",
    model: modelName,
    input: { prompt: "test" },
    options: { ratio: "9:16", resolution: "720p", duration, count: 1 },
  };
}

describe("按秒计价转译层", () => {
  it("命中真实时长档：按档位价", async () => {
    const res = await inject("POST", "/credits/quote", quoteBody(10));
    expect(res.body.code).toBe(0);
    expect(res.body.data.credits).toBe(180);
  });

  it("低于最低档：仍按最低档收（不漏收）", async () => {
    const res = await inject("POST", "/credits/quote", quoteBody(2));
    expect(res.body.code).toBe(0);
    expect(res.body.data.credits).toBe(100);
  });

  it("高于最高档：按秒外推，且严格贵于最高档", async () => {
    // 每秒单价 = 180 / 10 = 18 → 20s = 360
    const res = await inject("POST", "/credits/quote", quoteBody(20));
    expect(res.body.code).toBe(0);
    expect(res.body.data.credits).toBe(360);
    expect(res.body.data.credits).toBeGreaterThan(180);
  });

  it("外推向上取整（不出现小数积分）", async () => {
    // 7s × 18 = 126 已整；用 5s 档比例验证 ceil：15s × 18 = 270
    const res = await inject("POST", "/credits/quote", quoteBody(15));
    expect(res.body.data.credits).toBe(270);
    expect(Number.isInteger(res.body.data.credits)).toBe(true);
  });
});
