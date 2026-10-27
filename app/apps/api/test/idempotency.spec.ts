import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { assetFolders, createDb, idempotencyRecords } from "@app/db";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { IdempotencyInterceptor } from "../src/common/http/idempotency.interceptor";

/**
 * 幂等账本（`Idempotency-Key`）契约测试 —— 对照竞品 CLI `ledger` 三态与
 * `manual/workflow/_stage-machine.md:99-104`「写操作即使网络超时也不要盲目重放」。
 *
 * 六条断言对应六个真实事故场景：
 * 1. 同 key 同体重复提交 → **只执行一次**（响应相同、副作用只有一条）；
 * 2. 同 key 不同体 → 参数错误（不能把 A 的结果返给 B）；
 * 3. 处理中重放 → `746001` 稍后重试，不重复执行；
 * 4. 确定性业务失败 → 缓存并按原错误重放；
 * 5. 状态不明 → `746001` 且提示 `x-force-replay`；带该头则重新执行；
 * 6. 过期记录（>5min）→ 视为新请求；
 * 7. 未登录/无 space 的写不参与幂等（回调重试语义不能被改写）。
 */
const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app");

let app: NestFastifyApplication;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let token = "";
let spaceId = "";

async function inject(
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  const res = await app.inject({ method, url: `/v1${url}`, payload, headers });
  return { status: res.statusCode, headers: res.headers, body: res.json() as { code: number; msg: string; data: any } };
}

const authHeaders = (extra: Record<string, string> = {}) => ({
  authorization: `Bearer ${token}`,
  ...extra,
});

beforeAll(async () => {
  app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: false,
  });
  await app.register(cookie as never);
  app.setGlobalPrefix("v1");
  app.useGlobalFilters(new AllExceptionsFilter());
  // 与 main.ts 同序：幂等在信封外层
  app.useGlobalInterceptors(new IdempotencyInterceptor(), new EnvelopeInterceptor());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const sms = await inject("POST", "/auth/sms-code", { phone });
  const login = await inject("POST", "/auth/login", {
    phone,
    code: sms.body.data.debug_code as string,
    age_confirmed: true,
  });
  token = login.body.data.access_token as string;
  spaceId = login.body.data.space_id as string;
});

afterAll(async () => {
  await db.delete(idempotencyRecords).where(eq(idempotencyRecords.spaceId, BigInt(spaceId)));
  await db.delete(assetFolders).where(eq(assetFolders.spaceId, BigInt(spaceId)));
  await app.close();
  await pool.end();
});

describe("幂等账本", () => {
  it("同 key 同体重放：只执行一次，响应一致", async () => {
    const key = `spec-idem-${Date.now()}-1`;
    const first = await inject(
      "POST",
      "/asset-folders",
      { name: "幂等目录" },
      authHeaders({ "idempotency-key": key }),
    );
    expect(first.body.code).toBe(0);
    const second = await inject(
      "POST",
      "/asset-folders",
      { name: "幂等目录" },
      authHeaders({ "idempotency-key": key }),
    );
    expect(second.body.code).toBe(0);
    expect(second.body.data.id).toBe(first.body.data.id);

    const rows = await db
      .select()
      .from(assetFolders)
      .where(and(eq(assetFolders.spaceId, BigInt(spaceId)), eq(assetFolders.name, "幂等目录")));
    expect(rows).toHaveLength(1);
  });

  it("同 key 不同体：参数错误（不能把 A 的结果返给 B）", async () => {
    const key = `spec-idem-${Date.now()}-2`;
    await inject("POST", "/asset-folders", { name: "目录A" }, authHeaders({ "idempotency-key": key }));
    const diff = await inject(
      "POST",
      "/asset-folders",
      { name: "目录B" },
      authHeaders({ "idempotency-key": key }),
    );
    expect(diff.body.code).not.toBe(0);
    expect(diff.body.msg).toContain("different request");
  });

  it("确定性业务失败会被缓存并按原错误重放", async () => {
    const key = `spec-idem-${Date.now()}-3`;
    // name 为空串 → zod 校验失败（确定性错误）
    const first = await inject("POST", "/asset-folders", { name: "" }, authHeaders({ "idempotency-key": key }));
    expect(first.body.code).not.toBe(0);
    const second = await inject("POST", "/asset-folders", { name: "" }, authHeaders({ "idempotency-key": key }));
    expect(second.body.code).toBe(first.body.code);
    expect(second.body.msg).toBe(first.body.msg);
  });

  it("处理中（status=1）重放返回 746001，不重复执行", async () => {
    const key = `spec-idem-${Date.now()}-4`;
    const payload = { name: "处理中的目录" };
    // 必须用**与拦截器一致**的哈希（method:url:JSON.stringify(body)），
    // 否则会先命中"换体"错误，测到的就不是 status=1 分支了。
    const requestHash = createHash("sha256")
      .update(`POST:/v1/asset-folders:${JSON.stringify(payload)}`)
      .digest("hex");
    await db.insert(idempotencyRecords).values({
      id: BigInt(Date.now()) * 1000n + 4n,
      key,
      spaceId: BigInt(spaceId),
      requestHash,
      status: 1,
      expireAt: new Date(Date.now() + 60_000),
    });
    const res = await inject(
      "POST",
      "/asset-folders",
      payload,
      authHeaders({ "idempotency-key": key }),
    );
    expect(res.body.code).toBe(746001);
    expect(res.body.msg).toContain("still in progress");
    const rows = await db
      .select()
      .from(assetFolders)
      .where(and(eq(assetFolders.spaceId, BigInt(spaceId)), eq(assetFolders.name, "处理中的目录")));
    expect(rows).toHaveLength(0);
  });

  it("状态不明（status=3）拒绝自动重放，带 x-force-replay 才重跑", async () => {
    const key = `spec-idem-${Date.now()}-5`;
    const payload = { name: "不明状态目录" };
    // 先跑一次拿到真实 requestHash
    const first = await inject("POST", "/asset-folders", payload, authHeaders({ "idempotency-key": key }));
    expect(first.body.code).toBe(0);
    const [record] = await db
      .select()
      .from(idempotencyRecords)
      .where(and(eq(idempotencyRecords.key, key), eq(idempotencyRecords.spaceId, BigInt(spaceId))));
    await db
      .update(idempotencyRecords)
      .set({ status: 3, responseBody: null })
      .where(eq(idempotencyRecords.id, record!.id));

    const blocked = await inject("POST", "/asset-folders", payload, authHeaders({ "idempotency-key": key }));
    expect(blocked.body.code).toBe(746001);
    expect(blocked.body.msg).toContain("force-replay");

    const forced = await inject(
      "POST",
      "/asset-folders",
      payload,
      authHeaders({ "idempotency-key": key, "x-force-replay": "1" }),
    );
    expect(forced.body.code).toBe(0);
    const rows = await db
      .select()
      .from(assetFolders)
      .where(and(eq(assetFolders.spaceId, BigInt(spaceId)), eq(assetFolders.name, "不明状态目录")));
    // 首次 + 强制重放各一条（强制重放是显式"我知道可能重复"，允许产生副作用）
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("过期记录视为新请求", async () => {
    const key = `spec-idem-${Date.now()}-6`;
    const payload = { name: "过期目录" };
    const first = await inject("POST", "/asset-folders", payload, authHeaders({ "idempotency-key": key }));
    expect(first.body.code).toBe(0);
    const [record] = await db
      .select()
      .from(idempotencyRecords)
      .where(and(eq(idempotencyRecords.key, key), eq(idempotencyRecords.spaceId, BigInt(spaceId))));
    await db
      .update(idempotencyRecords)
      .set({ expireAt: new Date(Date.now() - 1000) })
      .where(eq(idempotencyRecords.id, record!.id));

    const again = await inject("POST", "/asset-folders", payload, authHeaders({ "idempotency-key": key }));
    expect(again.body.code).toBe(0);
    expect(again.body.data.id).not.toBe(first.body.data.id);
  });

  it("未登录的写不参与幂等（回调/登录重试语义不能被改写）", async () => {
    const key = `spec-idem-${Date.now()}-7`;
    const res = await inject(
      "POST",
      "/asset-folders",
      { name: "匿名目录" },
      { "idempotency-key": key },
    );
    expect(res.body.code).toBe(401101);
    const records = await db.select().from(idempotencyRecords).where(eq(idempotencyRecords.key, key));
    expect(records).toHaveLength(0);
  });
});

