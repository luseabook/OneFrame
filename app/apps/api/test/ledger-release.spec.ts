import { afterAll, beforeAll, describe, expect, it } from "vitest";
import cookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, inArray, sql } from "drizzle-orm";
import {
  createDb,
  creditAccounts,
  creditFlows,
  creditIn,
  freezeCredits,
  models,
  releaseFrozen,
  taskOutstandingFrozen,
  tasks,
} from "@app/db";
import { newId, TaskStatus } from "@app/shared";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/http/exception.filter";
import { EnvelopeInterceptor } from "../src/common/http/envelope.interceptor";

/**
 * 冻结收尾的守卫（PR-03 / PR-06，上线前全检 2026-10-29）。
 *
 * 这一组用例钉的不是「解冻能不能跑通」，而是**三件曾经同时坏掉的事**：
 *
 * 1. **`tasks.credits_frozen` 从未被写回过 0**（全仓 5 处写入全是 insert 初值）。
 *    于是「是否已释放冻结」这个语义从未被表达，4 处以 `creditsFrozen > 0` 为判据的地方全部恒真；
 *    叠加 `executor.fail()` 的守卫漏了 `CANCELED`，**取消一个在跑的任务必然被退两次钱**。
 * 2. **注销账号不清冻结**：任务被置 `status=5` 但没人 unfreeze，看门狗只扫 status 1/2 → 永不再处理。
 *    更糟的是 `auditLedger` 的不平判据是 `a.frozen <> Σ f.frozen_delta`，注销只改状态不动流水，
 *    两边仍然相等 → **这笔悬着的钱结构上查不出来**。
 * 3. **额度口径用错字段**：按 `tasks.credits_frozen` 退款会让「已 settle 的任务」再退一次，
 *    极端情况等于每次成功生成都全额退款。所以额度只能按流水算。
 *
 * 因此这里的判据是**全库不变式**（双向）而不是单点断言：任何一次收尾之后，
 *   ① `balance == Σ delta`、② `frozen == Σ frozen_delta`、③ `tasks.credits_frozen == Σ frozen_delta(task)`。
 * 只改一处、只加一句 `creditsFrozen: 0` 都会被这三条抓住。
 *
 * 注意：必须跑在**真实 PG** 上（`postgres:16-alpine` service 容器，CI 形态）。
 * 用内存库/mock 证明绿了，等于重演这个 bug 当初进仓库的路径 —— 它之所以能活到现在，
 * 就是因为夹具编码了生产不会出现的状态。
 */
const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app");

let app: NestFastifyApplication;
const phone = `13${String(Math.floor(Math.random() * 900000000) + 100000000)}`;
let spaceId = "";
let userId = "";
let modelId = "";
let token = "";

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

/** 直接造"已冻结"的任务行：本用例只关心收尾语义，不跑真实生成 */
async function seedFrozenTask(tag: string, cost: number, status = TaskStatus.PENDING): Promise<bigint> {
  const id = newId();
  await db.transaction(async (tx) => {
    await tx.insert(tasks).values({
      id,
      spaceId: BigInt(spaceId),
      userId: BigInt(userId),
      capability: "image",
      mode: "text2image",
      modelId: BigInt(modelId),
      input: { prompt: "ledger release" },
      options: { ratio: "1:1", resolution: "1K", count: 1 },
      status,
      progress: 0,
      creditsFrozen: cost,
      dedupeKey: `spec-ledger:${tag}:${String(id)}`,
    });
    await freezeCredits(tx, {
      spaceId: BigInt(spaceId),
      cost,
      taskId: id,
      memo: `spec freeze ${tag}`,
    });
  });
  return id;
}

function release(taskId: bigint, disposition: "settle" | "unfreeze") {
  return db.transaction((tx) =>
    releaseFrozen(tx, { spaceId: BigInt(spaceId), taskId, disposition, memo: `spec ${disposition}` }),
  );
}

async function account() {
  const [row] = await db
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.spaceId, BigInt(spaceId)));
  if (!row) throw new Error("credit account missing");
  return row;
}

/** 该任务在流水里的未释放冻结额度（负值=已释放） */
async function outstandingOf(taskId: bigint): Promise<number> {
  return db.transaction((tx) => taskOutstandingFrozen(tx, taskId));
}

async function flowCount(taskId: bigint, kind: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(creditFlows)
    .where(sql`${creditFlows.refTaskId} = ${taskId} and ${creditFlows.kind} = ${kind}`);
  return Number(row?.n ?? 0);
}

/** 账户字段 vs 流水合计（双向不变式，与 worker 的 auditLedger 同口径） */
async function assertLedgerInvariant(): Promise<void> {
  const rows = (await db.execute(sql`
    select a.balance, a.frozen,
           coalesce(sum(f.delta), 0) as sum_delta,
           coalesce(sum(f.frozen_delta), 0) as sum_frozen_delta
      from credit_accounts a
      left join credit_flows f on f.space_id = a.space_id
     where a.space_id = ${BigInt(spaceId)}
     group by a.space_id, a.balance, a.frozen
  `)) as {
    rows?: Array<{ balance: number; frozen: number; sum_delta: number; sum_frozen_delta: number }>;
  };
  const row = rows.rows?.[0];
  expect(row).toBeTruthy();
  expect(Number(row!.balance)).toBe(Number(row!.sum_delta));
  expect(Number(row!.frozen)).toBe(Number(row!.sum_frozen_delta));
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
    await db.delete(tasks).where(inArray(tasks.id, spaceTaskIds.map((r) => r.id)));
  }
  await db.delete(creditFlows).where(eq(creditFlows.spaceId, BigInt(spaceId)));
  await app.close();
  await pool.end();
});

describe("冻结收尾：releaseFrozen（PR-03/PR-06）", () => {
  it("取消后再进 fail：只退一次钱（终态重复调用的幂等）", async () => {
    const start = await account();
    const taskId = await seedFrozenTask("cancel-then-fail", 8);
    const afterFreeze = await account();
    expect(afterFreeze.balance).toBe(start.balance - 8);
    expect(afterFreeze.frozen).toBe(start.frozen + 8);

    // ① 用户取消 → unfreeze
    const first = await release(taskId, "unfreeze");
    expect(first.released).toBe(8);
    // ② worker 的 fail() 迟到（修复前守卫漏了 CANCELED，这里会再退一次）
    const second = await release(taskId, "unfreeze");
    expect(second.released).toBe(0);
    // ③ 再迟一次也一样
    const third = await release(taskId, "unfreeze");
    expect(third.released).toBe(0);

    const end = await account();
    expect(end.balance).toBe(start.balance);
    expect(end.frozen).toBe(start.frozen);
    // 只允许一条 unfreeze 流水，不允许「退三次」
    expect(await flowCount(taskId, "unfreeze")).toBe(1);
    expect(await outstandingOf(taskId)).toBe(0);
    await assertLedgerInvariant();
  });

  it("成功后 settle：不产生可用余额，且 credits_settled 不被归零", async () => {
    const start = await account();
    const taskId = await seedFrozenTask("settle", 5);
    // 模拟 executor.succeed()：先记录"这笔实际结算了多少"，再收尾
    await db.update(tasks).set({ creditsSettled: 5, status: TaskStatus.SUCCEEDED }).where(eq(tasks.id, taskId));

    const res = await release(taskId, "settle");
    expect(res.released).toBe(5);

    const end = await account();
    // settle 是「钱已经花了」：可用余额不回来，冻结清掉
    expect(end.balance).toBe(start.balance - 5);
    expect(end.frozen).toBe(start.frozen);
    expect(await flowCount(taskId, "settle")).toBe(1);
    expect(await flowCount(taskId, "unfreeze")).toBe(0);

    const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(row!.creditsSettled).toBe(5);
    expect(row!.creditsFrozen).toBe(0);
    await assertLedgerInvariant();
  });

  it("字段与流水同向：credits_frozen == Σ frozen_delta(task)", async () => {
    const taskId = await seedFrozenTask("field-sync", 3);
    const before = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(before[0]!.creditsFrozen).toBe(3);
    expect(await outstandingOf(taskId)).toBe(3);

    await release(taskId, "unfreeze");
    const after = await db.select().from(tasks).where(eq(tasks.id, taskId));
    // 这条断言专防「有人再加回只归零不 unfreeze」或反过来
    expect(after[0]!.creditsFrozen).toBe(0);
    expect(await outstandingOf(taskId)).toBe(0);
    await assertLedgerInvariant();
  });

  it("随机 100 次终态后：balance==Σdelta 且 frozen==Σfrozen_delta（双向不变式）", async () => {
    // 先补足余额，避免随机成本把账户打到不足（本用例只关心不变式，不关心价格）
    await db.transaction((tx) =>
      creditIn(tx, { spaceId: BigInt(spaceId), amount: 1000, kind: "adjust", memo: "spec topup" }),
    );

    // 固定种子的 LCG：随机但不抖，失败可复现
    let seed = 20261029;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };

    for (let i = 0; i < 100; i += 1) {
      const cost = 1 + rand(3);
      const taskId = await seedFrozenTask(`rand-${i}`, cost);
      const disposition = rand(2) === 0 ? "unfreeze" : "settle";
      await release(taskId, disposition);
      // 0~2 次重复收尾：模拟 cancel→fail、succeed→watchdog 这类并发/迟到路径
      const repeats = rand(3);
      for (let k = 0; k < repeats; k += 1) await release(taskId, disposition);

      const [row] = await db.select().from(tasks).where(eq(tasks.id, taskId));
      expect(row!.creditsFrozen).toBe(0);
      expect(await outstandingOf(taskId)).toBe(0);
    }

    await assertLedgerInvariant();

    // 第三条不变式对**全空间**成立（不只是本次造的任务）
    const mismatched = (await db.execute(sql`
      select t.id
        from tasks t
        left join credit_flows f on f.ref_task_id = t.id
       where t.space_id = ${BigInt(spaceId)}
       group by t.id, t.credits_frozen
      having t.credits_frozen <> coalesce(sum(f.frozen_delta), 0)
    `)) as { rows?: Array<{ id: string }> };
    expect(mismatched.rows ?? []).toEqual([]);
  });
});
