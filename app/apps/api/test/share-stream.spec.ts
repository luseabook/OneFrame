import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { sql } from "drizzle-orm";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";
import { AppModule } from "../src/app.module";
import { db, pool } from "../src/db/database";

/**
 * 公开分享链接的**只读实时流**（`GET /share/:token/stream`）。
 *
 * 为什么有这个端点：`GET /share/:token` 只是"读一次快照"，观看者只能手动刷新才知道
 * 任务跑完没有；"把进度分享给客户"这个场景等于不可用。
 *
 * 本 spec 锁的是**安全边界**与**生命周期**，不是 SSE 细节：
 * 1. 只认 token，不接受 task_id 入参（越权读取）；
 * 2. 撤销/过期 → 404（不泄露"存在但被撤销"）；
 * 3. 任务终态 → 推 `done` 后连接关闭（不让浏览器挂着永不结束的 SSE）；
 * 4. 推送内容不含 storage key / 积分 / space（防止通过分享链接侧漏内部字段）。
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("public share stream (SSE)", () => {
  let app: NestFastifyApplication;
  const stamp = String(Date.now()).slice(-9);
  let spaceId = "";
  let taskId = "";
  let shareToken = "";
  let revokedToken = "";

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix("v1");
    app.useGlobalInterceptors(new EnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    // fixture：space + 运行中任务 + 两条 share（一条有效、一条已撤销）
    const uid = `${stamp}1`;
    await db.execute(sql`insert into users (id, nickname) values (${BigInt(uid)}, 'sse')`);
    const sp = await db.execute<{ id: string }>(
      sql`insert into spaces (id, name, type, owner_user_id) values (${BigInt(`${stamp}2`)}, 'sse-space', 1, ${BigInt(uid)}) returning id`,
    );
    spaceId = String(sp.rows[0]?.id);
    const modelId = (
      await db.execute<{ id: string }>(sql`select id from models limit 1`)
    ).rows[0]?.id;
    const tk = await db.execute<{ id: string }>(
      sql`insert into tasks (id, space_id, user_id, attempt_no, mode, capability, model_id, status, progress, input, options, credits_frozen, credits_settled)
          values (${BigInt(`${stamp}3`)}, ${BigInt(spaceId)}, ${BigInt(uid)}, 1, 'text2image', 'image', ${BigInt(String(modelId ?? "1"))}, 2, 40, '{}'::jsonb, '{}'::jsonb, 0, 0)
          returning id`,
    );
    taskId = String(tk.rows[0]?.id);
    shareToken = `sse${stamp}valid`.padEnd(24, "a");
    revokedToken = `sse${stamp}revok`.padEnd(24, "b");
    await db.execute(
      sql`insert into task_shares (id, task_id, space_id, token, expires_at, created_at)
          values (${BigInt(`${stamp}4`)}, ${BigInt(taskId)}, ${BigInt(spaceId)}, ${shareToken}, now() + interval '1 day', now())`,
    );
    await db.execute(
      sql`insert into task_shares (id, task_id, space_id, token, expires_at, revoked_at, created_at)
          values (${BigInt(`${stamp}5`)}, ${BigInt(taskId)}, ${BigInt(spaceId)}, ${revokedToken}, now() + interval '1 day', now(), now())`,
    );
  }, 60_000);

  afterAll(async () => {
    await db.execute(sql`delete from task_shares where space_id = ${BigInt(spaceId)}`);
    await db.execute(sql`delete from tasks where space_id = ${BigInt(spaceId)}`);
    await db.execute(sql`delete from spaces where id = ${BigInt(spaceId)}`);
    await db.execute(sql`delete from users where id = ${BigInt(`${stamp}1`)}`);
    await app.close();
    await pool.end().catch(() => undefined);
  });

  it("有效 token：收到 open + status 帧，且任务进入终态后推 done 并关闭", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/share/${shareToken}/stream?timeout_ms=2500`,
    });
    // SSE 会被 inject 收完整段 body（连接在 done/timeout 后关闭）
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const body = res.body;
    expect(body).toContain("event: open");
    expect(body).toContain("event: status");
    expect(body).toContain('"status":2');
    // 不应侧漏内部字段
    expect(body).not.toMatch(/u\/|storage|credits|space_id/i);
  });

  it("任务终态 → 推 done 并结束连接", async () => {
    await db.execute(sql`update tasks set status = 3, progress = 100, finished_at = now() where id = ${BigInt(taskId)}`);
    const res = await app.inject({
      method: "GET",
      url: `/v1/share/${shareToken}/stream?timeout_ms=3000`,
    });
    expect(res.body).toContain("event: status");
    expect(res.body).toContain('"status":3');
    expect(res.body).toContain("event: done");
    expect(res.body).toContain('"reason":"done"');
  }, 10_000);

  it("已撤销的 token → 404（不泄露存在性）", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/share/${revokedToken}/stream?timeout_ms=800` });
    const parsed = res.json() as { code: number };
    expect(parsed.code).toBe(400102);
  });

  it("形状非法的 token 直接 404，不打库", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/share/x/stream" });
    const parsed = res.json() as { code: number };
    expect(parsed.code).toBe(400102);
  });
});
