import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, eq, inArray, sql } from "drizzle-orm";
import { createDb, creditAccounts, creditFlows, models, spaces, taskEvents, tasks, users } from "@app/db";
import { newId, TaskStatus } from "@app/shared";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";

/**
 * 任务系统收口三件（第 26 项，对照竞品 `task.md` 的 `result` / `regenerate` / `feedback`）：
 *
 * 1. **`POST /task/result` 是"批量快照"不是"轮询"**：既有 `GET /tasks?ids=` 走 ETag/304，
 *    适合前端轮询；CLI/脚本要的是一次拿全。所以断言重点是"缺的 id 进 missing 而不是整批 404"
 *    ——批量接口最怕一条坏全批废。
 * 2. **regenerate ≠ retry**：retry 只对失败态、递增 attempt_no；regenerate 成功态也允许、
 *    是新任务（attempt_no=1 且 origin_task_id 指向原任务）。两者混用会让"重试统计"失真。
 * 3. **feedback 双写**：`tasks.feedback`（agent 域读）+ `task_events`（审计），
 *    重复提交覆盖而不是叠加，且不能把 agent 写的 `reaction` 冲掉。
 */
const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app");

let app: NestFastifyApplication;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let token = "";
let spaceId = "";
let userId = "";
let modelId = "";
/** 由所选模型 mode 配置派生的合法选项（见 beforeAll 说明） */
let ratio = "1:1";
let resolution = "1K";
let taskId = "";
let otherTaskId = "";
/** 造过的"别的 space"（afterAll 精确清理，避免污染 dev 库） */
const otherSpaces: bigint[] = [];

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

/** 直接造一条已成功的任务（不跑真实生成：本测试只验证批量/重生成/反馈三个读写下法） */
async function seedTask(status: number, dedupeSuffix: string): Promise<string> {
  const id = newId();
  await db.insert(tasks).values({
    id,
    spaceId: BigInt(spaceId),
    userId: BigInt(userId),
    capability: "image",
    mode: "text2image",
    modelId: BigInt(modelId),
    input: { prompt: "a cat on a windowsill" },
    // 选项必须落在模型 mode 配置的合法域内：`count` 也必须给（modeCfg.counts=[1,2,3,4]，
    // 缺 count 会被判 "count undefined not supported"）——报价是拿原选项复算的，
    // 造夹具时"差不多就行"的选项值会在 regenerate 路径上被拆穿（400101）。
    options: { ratio, resolution, count: 1 },
    status,
    progress: status === TaskStatus.SUCCEEDED ? 100 : 0,
    results:
      status === TaskStatus.SUCCEEDED
        ? [{ uri: "u/seed/result.png", preview_uri: "u/seed/result.png" }]
        : null,
    creditsFrozen: status === TaskStatus.SUCCEEDED ? 0 : 10,
    creditsSettled: status === TaskStatus.SUCCEEDED ? 10 : 0,
    dedupeKey: `spec:${dedupeSuffix}:${Date.now()}`,
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

  // 必须挑一个**真的支持 text2image** 的模型：`credits.price()` 会校验
  // `model.modes[mode]` 是否存在，随便取第一条模型（可能是 video_parse 的文本模型）
  // 会让 regenerate 报 400101 —— 这类"测试自己选错模型"的失败最容易误导人。
  const [model] = await db
    .select()
    .from(models)
    .where(sql`${models.modes} ? 'text2image'`)
    .orderBy(models.id)
    .limit(1);
  if (!model) throw new Error("no model supports text2image; run seed first");
  modelId = String(model.id);
  // 选项从该模型 mode 配置的默认值派生，而不是写死——不同模型的分辨率/画幅枚举不同
  const modeCfg = (model.modes as Record<string, { default_ratio?: string; default_resolution?: string }>)[
    "text2image"
  ];
  ratio = modeCfg?.default_ratio ?? "1:1";
  resolution = modeCfg?.default_resolution ?? "1K";

  // 直接给这个 space 充够余额：regenerate 会走真实报价+冻结，gift 80 分可能不够
  await db
    .update(creditAccounts)
    .set({ balance: 100_000, updatedAt: new Date() })
    .where(eq(creditAccounts.spaceId, BigInt(spaceId)));

  taskId = await seedTask(TaskStatus.SUCCEEDED, "a");
  otherTaskId = await seedTask(TaskStatus.FAILED, "b");
});

afterAll(async () => {
  // 先删本 space 全部任务的 task_events：regenerate 会造新任务，
  // 只删 taskId 那条会撞 task_events 的外键（这里最容易漏）。
  const spaceTaskIds = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.spaceId, BigInt(spaceId)));
  if (spaceTaskIds.length > 0) {
    await db.delete(taskEvents).where(
      inArray(
        taskEvents.taskId,
        spaceTaskIds.map((row) => row.id),
      ),
    );
  }
  await db.delete(tasks).where(eq(tasks.spaceId, BigInt(spaceId)));
  await db.delete(creditFlows).where(eq(creditFlows.spaceId, BigInt(spaceId)));
  for (const space of otherSpaces) {
    const otherTaskIds = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.spaceId, space));
    if (otherTaskIds.length > 0) {
      await db.delete(taskEvents).where(
        inArray(
          taskEvents.taskId,
          otherTaskIds.map((row) => row.id),
        ),
      );
    }
    await db.delete(tasks).where(eq(tasks.spaceId, space));
    await db.delete(creditAccounts).where(eq(creditAccounts.spaceId, space));
    await db.delete(spaces).where(eq(spaces.id, space));
    await db.delete(users).where(eq(users.id, space - 1n));
  }
  await app.close();
  await pool.end();
});

describe("task/result 批量快照", () => {
  it("返回命中的任务，缺的 id 进 missing 而不是整批失败", async () => {
    const res = await inject("POST", "/task/result", {
      task_ids: [taskId, "999999999999999999"],
    });
    expect(res.body.code).toBe(0);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].task_id).toBe(taskId);
    expect(res.body.data.items[0].status).toBe(TaskStatus.SUCCEEDED);
    expect(res.body.data.items[0].results[0].uri).toBe("u/seed/result.png");
    expect(res.body.data.missing).toEqual(["999999999999999999"]);
  });

  it("只返回本 space 的任务（别人的 id 进 missing，不报错也不泄露）", async () => {
    const another = await seedTaskForAnotherSpace();
    const res = await inject("POST", "/task/result", { task_ids: [another] });
    expect(res.body.code).toBe(0);
    expect(res.body.data.items).toHaveLength(0);
    expect(res.body.data.missing).toEqual([another]);
  });

  it("上限 100：101 个 id 直接参数错误", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => String(1000 + i));
    const res = await inject("POST", "/task/result", { task_ids: ids });
    expect(res.body.code).not.toBe(0);
  });

  it("非法 id 报参数错误而不是 500", async () => {
    const res = await inject("POST", "/task/result", { task_ids: ["not-a-number"] });
    expect(res.body.code).not.toBe(0);
    expect(res.status).toBeLessThan(500);
  });
});

describe("regenerate（与 retry 分开的新任务）", () => {
  it("成功态任务可 regenerate，产出新任务且 origin 指向原任务", async () => {
    const res = await inject("POST", `/tasks/${taskId}/regenerate`, { idempotency_key: "regen-1" });
    expect(res.body.code).toBe(0);
    const created = res.body.data;
    expect(created.task_id).not.toBe(taskId);
    expect(created.status).toBe(TaskStatus.PENDING);

    const [row] = await db.select().from(tasks).where(eq(tasks.id, BigInt(created.task_id)));
    expect(String(row.originTaskId)).toBe(taskId);
    expect(row.attemptNo).toBe(1);
    expect(row.creditsFrozen).toBeGreaterThan(0);
  });

  it("同一 idempotency_key 重复提交只产生一个任务", async () => {
    const first = await inject("POST", `/tasks/${taskId}/regenerate`, { idempotency_key: "regen-idem" });
    const second = await inject("POST", `/tasks/${taskId}/regenerate`, { idempotency_key: "regen-idem" });
    expect(first.body.data.task_id).toBe(second.body.data.task_id);
  });

  it("运行中的任务拒绝 regenerate（否则会同时跑两版）", async () => {
    const running = await seedTask(TaskStatus.RUNNING, "c");
    const res = await inject("POST", `/tasks/${running}/regenerate`, {});
    expect(res.body.code).not.toBe(0);
  });
});

describe("feedback（双写 + 覆盖语义）", () => {
  it("首次提交写 tasks.feedback 与 task_events 各一条", async () => {
    const res = await inject("POST", `/tasks/${taskId}/feedback`, {
      rating: 4,
      comment: "构图不错",
      tags: ["构图"],
    });
    expect(res.body.code).toBe(0);
    expect(res.body.data.updated).toBe(false);

    const [row] = await db.select().from(tasks).where(eq(tasks.id, BigInt(taskId)));
    expect((row.feedback as { rating?: number }).rating).toBe(4);

    const events = await db
      .select()
      .from(taskEvents)
      .where(and(eq(taskEvents.taskId, BigInt(taskId)), eq(taskEvents.type, "task.feedback")));
    expect(events).toHaveLength(1);
  });

  it("重复提交覆盖同一条事件，且不冲掉 agent 侧写的 reaction", async () => {
    // 模拟 agent 域先写过 reaction
    await db.update(tasks).set({ feedback: { reaction: "like" } }).where(eq(tasks.id, BigInt(taskId)));

    const res = await inject("POST", `/tasks/${taskId}/feedback`, { rating: 2, comment: "重来一版" });
    expect(res.body.code).toBe(0);
    expect(res.body.data.updated).toBe(true);

    const [row] = await db.select().from(tasks).where(eq(tasks.id, BigInt(taskId)));
    const feedback = row.feedback as { rating?: number; reaction?: string };
    expect(feedback.rating).toBe(2);
    expect(feedback.reaction).toBe("like");

    const events = await db
      .select()
      .from(taskEvents)
      .where(and(eq(taskEvents.taskId, BigInt(taskId)), eq(taskEvents.type, "task.feedback")));
    expect(events).toHaveLength(1);
  });

  it("rating 越界被参数校验拦住", async () => {
    const res = await inject("POST", `/tasks/${taskId}/feedback`, { rating: 9 });
    expect(res.body.code).not.toBe(0);
    expect(res.status).toBeLessThan(500);
  });

  it("越权任务（别的 space）返回 404 而不是写入成功", async () => {
    const another = await seedTaskForAnotherSpace();
    const res = await inject("POST", `/tasks/${another}/feedback`, { rating: 5 });
    expect(res.body.code).not.toBe(0);
  });
});

/** 造一个"别的 space"的任务：批量结果与越权写都必须看不见它 */
async function seedTaskForAnotherSpace(): Promise<string> {
  const otherUser = BigInt(`7${String(Date.now()).slice(-9)}${Math.floor(Math.random() * 100)}`);
  const otherSpace = otherUser + 1n;
  await db.insert(users).values({ id: otherUser, nickname: `spec-other-${String(otherUser)}` });
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
    dedupeKey: `spec:other:${String(id)}`,
  });
  return String(id);
}

