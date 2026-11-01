import { describe, expect, it } from "vitest";
import { createDb, DB_LIMITS, dbPoolOptions, resolveDbLimits } from "./client";

/**
 * 数据库四道闸（第 121 批）的契约测试——纯函数，不连库。
 *
 * 本文件锁三件事：
 * 1. 默认值本身：每个数都是**有限正整数**。`0` 在 pg 里的语义恰好是「永远等」，
 *    正是这批要消掉的缺陷，所以「默认值是 0」必须是一条红测试，而不是一句注释；
 * 2. 接线：`DbLimits` 的六个键与 pg `PoolConfig` 的六个键**逐一双向对应**，
 *    用整对象 `toEqual` 锁死键集合——以后谁加了 pg 选项却没加闸（或反过来），这里先红；
 * 3. 拒绝：0 / 负数 / NaN / Infinity / 小数 / 拼错的键名都必须抛 `RangeError`，
 *    不允许「悄悄回落默认值」（那会让一条闸无声消失）。
 */
const DSN = "postgres://app:app@localhost:5432/app";

describe("DbLimits defaults", () => {
  it("六个数都是有限正整数（0 = 永远等，不允许出现在默认值里）", () => {
    expect(DB_LIMITS).toEqual({
      poolMax: 10,
      idleMs: 30_000,
      acquireMs: 10_000,
      statementMs: 30_000,
      lockMs: 10_000,
      idleTxMs: 60_000,
    });
    for (const [key, value] of Object.entries(DB_LIMITS)) {
      expect(Number.isInteger(value), `${key} 必须是整数`).toBe(true);
      expect(value, `${key} 必须是正的有限值`).toBeGreaterThan(0);
    }
  });

  it("默认值对象冻结，运行时改不动", () => {
    expect(Object.isFrozen(DB_LIMITS)).toBe(true);
  });

  it("acquire < statement < idleTx（池饱和先暴露，其次语句，最后是泄漏事务）", () => {
    expect(DB_LIMITS.acquireMs).toBeLessThan(DB_LIMITS.statementMs);
    expect(DB_LIMITS.statementMs).toBeLessThan(DB_LIMITS.idleTxMs);
    expect(DB_LIMITS.lockMs).toBeLessThan(DB_LIMITS.statementMs);
  });
});

describe("dbPoolOptions 接线", () => {
  it("默认配置与 pg 的键一一对应（整对象相等，防两个方向漂移）", () => {
    expect(dbPoolOptions(DSN)).toEqual({
      connectionString: DSN,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 30_000,
      lock_timeout: 10_000,
      idle_in_transaction_session_timeout: 60_000,
    });
    expect(Object.keys(dbPoolOptions(DSN)).sort()).toEqual(
      [
        "connectionString",
        "max",
        "idleTimeoutMillis",
        "connectionTimeoutMillis",
        "statement_timeout",
        "lock_timeout",
        "idle_in_transaction_session_timeout",
      ].sort(),
    );
  });

  it("六个覆盖值各自只改对应的 pg 键", () => {
    const base = dbPoolOptions(DSN);
    const cases: [keyof typeof DB_LIMITS, keyof ReturnType<typeof dbPoolOptions>][] = [
      ["poolMax", "max"],
      ["idleMs", "idleTimeoutMillis"],
      ["acquireMs", "connectionTimeoutMillis"],
      ["statementMs", "statement_timeout"],
      ["lockMs", "lock_timeout"],
      ["idleTxMs", "idle_in_transaction_session_timeout"],
    ];
    for (const [limit, pgKey] of cases) {
      const opts = dbPoolOptions(DSN, { [limit]: 1_234 });
      expect(opts[pgKey], `${limit} → ${String(pgKey)}`).toBe(1_234);
      const changed = Object.keys(opts).filter(
        (k) => opts[k as keyof typeof opts] !== base[k as keyof typeof base],
      );
      expect(changed, `${limit} 不应影响别的键`).toEqual([pgKey]);
    }
  });

  it("resolveDbLimits 返回副本，覆盖不会污染默认值", () => {
    const resolved = resolveDbLimits({ statementMs: 5_000 });
    expect(resolved.statementMs).toBe(5_000);
    expect(resolved.acquireMs).toBe(DB_LIMITS.acquireMs);
    expect(resolved).not.toBe(DB_LIMITS);
    expect(DB_LIMITS.statementMs).toBe(30_000);
  });
});

describe("dbPoolOptions 拒绝「等于无限」的取值", () => {
  const keys = [
    "poolMax",
    "idleMs",
    "acquireMs",
    "statementMs",
    "lockMs",
    "idleTxMs",
  ] as const;
  const badValues: [string, number][] = [
    ["0（pg 的「永远等」）", 0],
    ["负数", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["小数", 12.5],
  ];

  for (const key of keys) {
    for (const [label, value] of badValues) {
      it(`${key} = ${label} → RangeError`, () => {
        expect(() => dbPoolOptions(DSN, { [key]: value })).toThrowError(RangeError);
        expect(() => dbPoolOptions(DSN, { [key]: value })).toThrowError(
          new RegExp(`invalid db limit ${key}: .*0 = wait forever`),
        );
      });
    }
  }

  it("拼错的键名 → RangeError（否则覆盖值静默失效、闸悄悄回落默认）", () => {
    expect(() => dbPoolOptions(DSN, { statementTimeout: 1 } as never)).toThrowError(
      /unknown db limit statementTimeout/,
    );
  });
});

describe("createDb 真正把闸接进 Pool", () => {
  it("pool.options 带着六个值（不是只写在常量里）", () => {
    const { pool } = createDb(DSN);
    try {
      expect(pool.options).toMatchObject({
        connectionString: DSN,
        max: DB_LIMITS.poolMax,
        idleTimeoutMillis: DB_LIMITS.idleMs,
        connectionTimeoutMillis: DB_LIMITS.acquireMs,
        statement_timeout: DB_LIMITS.statementMs,
        lock_timeout: DB_LIMITS.lockMs,
        idle_in_transaction_session_timeout: DB_LIMITS.idleTxMs,
      });
    } finally {
      void pool.end();
    }
  });

  it("覆盖值也只改对应的键", () => {
    const { pool } = createDb(DSN, { acquireMs: 250, statementMs: 400 });
    try {
      expect(pool.options.connectionTimeoutMillis).toBe(250);
      expect(pool.options.statement_timeout).toBe(400);
      expect(pool.options.lock_timeout).toBe(DB_LIMITS.lockMs);
    } finally {
      void pool.end();
    }
  });
});