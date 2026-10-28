import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, inArray, sql } from "drizzle-orm";
import {
  createDb,
  creditAccounts,
  creditFlows,
  models,
  spaces,
  taskEvents,
  taskShares,
  tasks,
  users,
} from "@app/db";
import { newId, TaskStatus } from "@app/shared";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";

/**
 * 删除任务记录（第 72 批；对照竞品 `DELETE /web/v1/task/{task_id}`，CLI `commands/task.md:195`）。
 *
 * 这组用例钉的是**「删」这件事的三个边界**，而不是"DELETE 能不能跑通"：
 *
 * 1. **只允许终态**：1 排队 / 2 运行 / 6 审核中还在飞 —— 删记录不会停上游生成，用户以为删掉了、
 *    后台还在跑还会回写结果。所以运行中被拒是**正确行为**，不是待办。
 * 2. **软删而不是物理删**：`canvas_nodes.task_id`、`assets.source_task_id` 有外键，
 *    `credit_flows.ref_task_id` 是对账依据。所以删完要能证明「行还在、结果还在、只是读不到」。
 * 3. **所有读路径一起收口**：列表 / 详情 / `?ids=` / `/task/result` / 打包下载 / 公开分享，
 *    漏掉任何一条都会变成"删了还能看见"。
 *
 * 第 4 例还刻意覆盖了第 69 批那类"坏 id 变 500"的回归：`BigInt("abc")` 必须 400101。
 */
const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app");

let app: NestFastifyApplication;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let token = "";
let spaceId = "";
let userId = "";
let modelId = "";
const otherSpaces: bigint[] = [];

async function inject(
  method: "GET" | "POST" | "DELETE",
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

/** 直接造任务行（不跑真实生成）：本用例只关心删除语义 */
async function seedTask(
  status: number,
  tag: string,
  overrides: { creditsFrozen?: number; results?: unknown } = {},
): Promise<string> {
  const id = newId();
  await db.insert(tasks).values({
    id,
    spaceId: BigInt(spaceId),
    userId: BigInt(userId),
    capability: "image",
    mode: "text2image",
    modelId: BigInt(modelId),
    input: { prompt: "delete me" },
    options: { ratio: "1:1", resolution: "1K", count: 1 },
    status,
    progress: status === TaskStatus.SUCCEEDED ? 100 : 0,
    results: overrides.results ?? (status === TaskStatus.SUCCEEDED ? [{ uri: "u/seed/del.png" }] : null),
    creditsFrozen: overrides.creditsFrozen ?? 0,
    creditsSettled: status === TaskStatus.SUCCEEDED ? 10 : 0,
    dedupeKey: `spec-del:${tag}:${String(id)}`,
    finishedAt: status === TaskStatus.SUCCEEDED ? new Date() : null,
  });
  return String(id);
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
  const code = sms.body.data.debug_code as string;
  const login = await inject("POST", "/auth/login", { phone, code, age_confirmed: true }, "");
  expect(login.body.code).toBe(0);
  token = login.body.data.access_token as string;
  spaceId = login.body.data.space_id as string;
  userId = login.body.data.user.id as string;

  const [model] = await db
    .select()
    .from(models)
    .where(sql`${models.modes} ? 'text2image'`)
    .orderBy(models.id)
    .limit(1);
  if (!model) throw new Error("no model supports text2image; run seed first");
  modelId = String(model.id);
});

afterAll(async () => {
  const spaceTaskIds = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.spaceId, BigInt(spaceId)));
  if (spaceTaskIds.length > 0) {
    const ids = spaceTaskIds.map((row) => row.id);
    await db.delete(taskShares).where(inArray(taskShares.taskId, ids));
    await db.delete(taskEvents).where(inArray(taskEvents.taskId, ids));
  }
  await db.delete(tasks).where(eq(tasks.spaceId, BigInt(spaceId)));
  await db.delete(creditFlows).where(eq(creditFlows.spaceId, BigInt(spaceId)));
  for (const space of otherSpaces) {
    const otherTaskIds = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.spaceId, space));
    if (otherTaskIds.length > 0) {
      const ids = otherTaskIds.map((row) => row.id);
      await db.delete(taskShares).where(inArray(taskShares.taskId, ids));
      await db.delete(taskEvents).where(inArray(taskEvents.taskId, ids));
    }
    await db.delete(tasks).where(eq(tasks.spaceId, space));
    await db.delete(creditAccounts).where(eq(creditAccounts.spaceId, space));
    await db.delete(spaces).where(eq(spaces.id, space));
    await db.delete(users).where(eq(users.id, space - 1n));
  }
  await app.close();
  await pool.end();
});

describe("删除任务记录（软删）", () => {
  it("成功态任务：删除后行与结果仍在，但列表/详情/批量/下载/分享全部读不到", async () => {
    const taskId = await seedTask(TaskStatus.SUCCEEDED, "a");

    // 删前：详情可读、列表含它
    const before = await inject("GET", `/tasks/${taskId}`);
    expect(before.body.code).toBe(0);
    const listBefore = await inject("GET", "/tasks?page=1&page_size=100");
    // 注意：任务 DTO 的主键字段叫 `task_id`（不是 `id`），见 tasks.service.ts 的 TaskDto。
    expect((listBefore.body.data.list as Array<{ task_id: string }>).some((t) => t.task_id === taskId)).toBe(true);

    const del = await inject("DELETE", `/tasks/${taskId}`);
    expect(del.body.code).toBe(0);
    expect(del.body.data).toMatchObject({ deleted: true, task_id: taskId, status: TaskStatus.SUCCEEDED });

    // 软删：行还在、结果还在（对账与外键链不能被剪断）
    const [row] = await db.select().from(tasks).where(eq(tasks.id, BigInt(taskId)));
    expect(row.deletedAt).not.toBeNull();
    expect(Array.isArray(row.results)).toBe(true);
    expect(row.creditsSettled).toBe(10);

    // 所有读路径一起收口
    const detail = await inject("GET", `/tasks/${taskId}`);
    expect(detail.body.code).toBe(400102);
    const listAfter = await inject("GET", "/tasks?page=1&page_size=100");
    expect((listAfter.body.data.list as Array<{ task_id: string }>).some((t) => t.task_id === taskId)).toBe(false);
    // `?ids=` 走 getMany，同样必须过滤掉已删任务（否则「删了但还能按 id 拉回来」）
    const byIds = await inject("GET", `/tasks?ids=${taskId}`);
    expect((byIds.body.data as Array<{ task_id: string }>).some((t) => t.task_id === taskId)).toBe(false);
    const many = await inject("POST", "/task/result", { task_ids: [taskId] });
    expect(many.body.data.items).toHaveLength(0);
    expect(many.body.data.missing).toEqual([taskId]);
    const zip = await inject("POST", "/tasks/batch-download", { task_ids: [taskId] });
    expect(zip.body.code).toBe(400102);
  });

  it("公开分享随任务一起失效：share 行还在，但取不到内容", async () => {
    const taskId = await seedTask(TaskStatus.SUCCEEDED, "share");
    const created = await inject("POST", `/tasks/${taskId}/share`, { expires_days: 7 });
    expect(created.body.code).toBe(0);
    const shareToken = created.body.data.token as string;
    expect(typeof shareToken).toBe("string");

    // 删前分享页可读
    const beforeShare = await inject("GET", `/share/${shareToken}`, undefined, "");
    expect(beforeShare.body.code).toBe(0);

    await inject("DELETE", `/tasks/${taskId}`);
    const afterShare = await inject("GET", `/share/${shareToken}`, undefined, "");
    expect(afterShare.body.code).toBe(400102);
    const afterZip = await inject("POST", `/share/${shareToken}/batch-download`, undefined, "");
    expect(afterZip.body.code).toBe(400102);

    // share 行不被删（撤销/过期是用户/时间的事，删任务不改审计）
    const [shareRow] = await db.select().from(taskShares).where(eq(taskShares.token, shareToken));
    expect(shareRow.revokedAt).toBeNull();
  });

  it("运行中的任务拒绝删除：不会「删了记录但后台还在生成」", async () => {
    for (const status of [TaskStatus.PENDING, TaskStatus.RUNNING, TaskStatus.REVIEWING]) {
      const taskId = await seedTask(status, `run-${String(status)}`);
      const res = await inject("DELETE", `/tasks/${taskId}`);
      expect(res.body.code).toBe(400101);
      expect(String(res.body.msg)).toContain("running");
      // 拒绝后任务仍可读（没有被软删）
      const detail = await inject("GET", `/tasks/${taskId}`);
      expect(detail.body.code).toBe(0);
    }
  });

  it("带冻结积分的任务拒绝删除（否则那笔钱永远悬着）", async () => {
    const taskId = await seedTask(TaskStatus.FAILED, "frozen", { creditsFrozen: 10 });
    const res = await inject("DELETE", `/tasks/${taskId}`);
    expect(res.body.code).toBe(400101);
    expect(String(res.body.msg)).toContain("frozen");
  });

  it("坏 id / 不存在 / 重复删 / 跨 space：400101 或 400102，绝不 500", async () => {
    const ok = await seedTask(TaskStatus.SUCCEEDED, "edge");
    const bad = await inject("DELETE", "/tasks/abc");
    expect(bad.body.code).toBe(400101);
    expect(bad.status).toBeLessThan(500);
    expect(String(bad.body.msg)).toContain("invalid task id");

    const missing = await inject("DELETE", "/tasks/999999999999999999");
    expect(missing.body.code).toBe(400102);

    expect((await inject("DELETE", `/tasks/${ok}`)).body.code).toBe(0);
    const again = await inject("DELETE", `/tasks/${ok}`);
    expect(again.body.code).toBe(400102);
    expect(again.status).toBeLessThan(500);

    const another = await seedTaskForAnotherSpace();
    const cross = await inject("DELETE", `/tasks/${another}`);
    expect(cross.body.code).toBe(400102);
    // 对方任务仍可读（我们只"看不见"，没有越权改动）
    const [otherRow] = await db.select().from(tasks).where(eq(tasks.id, BigInt(another)));
    expect(otherRow.deletedAt).toBeNull();
  });
});

/** 造一个"别的 space"的已成功任务：跨租户删除必须 400102 且不产生副作用 */
async function seedTaskForAnotherSpace(): Promise<string> {
  const otherUser = BigInt(`7${String(Date.now()).slice(-9)}${Math.floor(Math.random() * 100)}`);
  const otherSpace = otherUser + 1n;
  await db.insert(users).values({ id: otherUser, nickname: `spec-del-${String(otherUser)}` });
  await db.insert(spaces).values({ id: otherSpace, ownerUserId: otherUser });
  await db.insert(creditAccounts).values({ spaceId: otherSpace, balance: 0, frozen: 0 });
  otherSpaces.push(otherSpace);
  const id = newId();
  await db.insert(tasks).values({
    id,
    spaceId: otherSpace,
    userId: otherUser,
    capability: "image",
    mode: "text2image",
    modelId: BigInt(modelId),
    input: { prompt: "other space" },
    options: {},
    status: TaskStatus.SUCCEEDED,
    progress: 100,
    results: [{ uri: "u/other/del.png" }],
    dedupeKey: `spec-del:other:${String(id)}`,
  });
  return String(id);
}
