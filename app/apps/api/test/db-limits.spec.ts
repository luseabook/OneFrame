import { afterAll, describe, expect, it } from "vitest";
import { createDb, DB_LIMITS } from "@app/db";
import { env } from "../src/config/env";
import { pool } from "../src/db/database";

/**
 * 数据库四道闸的**活体**证明（第 121 批）。
 *
 * 纯函数测试（`packages/db/src/db-limits.spec.ts`）只能证明「我们把参数传给了 pg」，
 * 不能证明「PostgreSQL 真的按这个参数执行」。这里连真实库，用三种服务端可见的证据补上：
 * - `pg_settings.setting`（毫秒字符串）证明会话参数真的生效——api 的**共享池**也算一遍，
 *   证明生产接线而不只是 `createDb` 的默认值；
 * - `pg_sleep(1)` + `statementMs: 200` → SQLSTATE `57014`，证明语句真的被打断；
 * - 会话级 advisory lock（私有 key，不碰任何业务表）+ `lockMs: 200` → SQLSTATE `55P03`，
 *   证明锁等待真的被打断；
 * - `poolMax: 1` + 占住唯一连接 + acquire 闸 → pg-pool 的
 *   `timeout exceeded when trying to connect`，证明「池满无限等」真的消失了。
 *
 * 为什么锁用 advisory lock 而不是 `LOCK TABLE`：api 的 e2e 是并行跑的，对业务表加排他锁
 * 会互相拖慢、还可能让自己的 LOCK 先撞上别人的事务而红得莫名其妙；advisory lock 的 key
 * 是本进程私有的，零争用、完全确定。
 *
 * 诚实边界：
 * - 不断言耗时（CI 抖动会假红）；「是否被打断」由 SQLSTATE 与「pg_sleep 本来会成功」共同证明；
 * - 不断言 `idle_in_transaction_session_timeout` 的真实触发（要挂 60s），只断言服务端
 *   `pg_settings` 的值；它的行为是 PostgreSQL 自身语义，不需要我们再证明；
 * - 超时后的对外形状（500 + INTERNAL）不在本文件断言：那是 `AllExceptionsFilter` 的既有契约，
 *   本批不新增错误码。
 */
const DSN = env.DATABASE_URL;

/** `pg_settings.setting` 对这三个参数返回**毫秒字符串**，与单位显示无关，适合做精确断言 */
async function sessionSettings(queryable: {
  query: (text: string) => Promise<{ rows: unknown[] }>;
}): Promise<Record<string, string>> {
  const res = await queryable.query(
    `select name, setting from pg_settings
      where name in ('statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout')`,
  );
  return Object.fromEntries(
    (res.rows as { name: string; setting: string }[]).map((r) => [r.name, r.setting]),
  );
}

describe("db limits (live)", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("api 共享池的会话参数 = DB_LIMITS（生产接线）", async () => {
    expect(await sessionSettings(pool)).toEqual({
      statement_timeout: String(DB_LIMITS.statementMs),
      lock_timeout: String(DB_LIMITS.lockMs),
      idle_in_transaction_session_timeout: String(DB_LIMITS.idleTxMs),
    });
  });

  it("createDb 新建的连接同样带着四道闸（不是只在共享池上）", async () => {
    const { pool: fresh } = createDb(DSN);
    try {
      expect(await sessionSettings(fresh)).toEqual({
        statement_timeout: "30000",
        lock_timeout: "10000",
        idle_in_transaction_session_timeout: "60000",
      });
    } finally {
      await fresh.end();
    }
  });

  it("statementMs=200 → pg_sleep(1) 被服务端打断（57014）", async () => {
    const { pool: capped } = createDb(DSN, { statementMs: 200 });
    try {
      // 没有这道闸时，下面这句会安静地睡满 1 秒并成功返回——这正是改前的行为。
      await expect(capped.query("select pg_sleep(1)")).rejects.toMatchObject({
        code: "57014",
        message: expect.stringContaining("statement timeout"),
      });
    } finally {
      await capped.end();
    }
  });

  it("lockMs=200 → 第二个会话等不到私有 advisory lock（55P03）", async () => {
    const { pool: capped } = createDb(DSN, { lockMs: 200 });
    const key = 900_000 + (process.pid % 90_000);
    const holder = await capped.connect();
    try {
      await holder.query("select pg_advisory_lock($1)", [key]);
      const waiter = await capped.connect();
      try {
        await expect(
          waiter.query("select pg_advisory_lock($1)", [key]),
        ).rejects.toMatchObject({
          code: "55P03",
          message: expect.stringContaining("lock timeout"),
        });
      } finally {
        waiter.release();
      }
    } finally {
      // 持锁会话必须显式解锁再归还，否则连接被回收时锁仍随会话存在直到断开。
      await holder.query("select pg_advisory_unlock($1)", [key]);
      holder.release();
      await capped.end();
    }
  });

  it("acquireMs + 池满 → 取连接不再无限等（pg-pool 超时）", async () => {
    // acquireMs 同时罩住「新建连接（TCP + 认证）」和「排队等空闲连接」两件事。
    // 本机握手偶发 >100ms，若把闸压到 100ms，第一条连接会先被自己的闸掐掉（假红）。
    // 所以先预热点亮那唯一一条连接并归还，让计时窗口只覆盖**排队**——
    // 这才是这道闸要防的场景（池被慢查询占满）。
    const { pool: capped } = createDb(DSN, { poolMax: 1, acquireMs: 500 });
    await capped.query("select 1");
    const held = await capped.connect();
    try {
      await expect(capped.query("select 1")).rejects.toThrowError(
        /timeout exceeded when trying to connect/,
      );
    } finally {
      held.release();
      await capped.end();
    }
  });
});