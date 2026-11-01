import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export interface DbHandle {
  db: Db;
  pool: Pool;
}

/**
 * 数据库侧的四道闸（第 121 批）。
 *
 * ## 为什么必须显式写
 * pg 8.23.1 里这四项的默认值都是「不设」：`statement_timeout: false`、
 * `lock_timeout: false`、`idle_in_transaction_session_timeout: false`，
 * `connectionTimeoutMillis` 未传时 pg-pool 的 `connect()` 直接把回调压进
 * `_pendingQueue` 而**不挂定时器**（`if (!this.options.connectionTimeoutMillis) { push; return }`）
 * ——也就是「池满就无限等」。在此之前，本仓库所有别的等待都封了顶：停机等 25s
 * （`main.ts:13`）、出站 fetch 有时间 + 字节双闸（第 119 批）、ffmpeg SIGTERM→SIGKILL
 * （第 116 批）、入站列表项数封顶（第 120 批）。只有数据库这一处的等待没有上限。
 *
 * ## 四个数对应四种真实卡死
 * - `acquireMs`：10 个连接全被慢查询占住 → 第 11 个请求**永远不返回**；请求在内存里堆积，
 *   直到 LB 超时才断，期间进程既没报错也没指标。10s 让「池被占满」先暴露出来。
 * - `statementMs`：一条慢 SQL 可以永远占着连接、快照与它持有的锁。30s 与停机上限同量级
 *   （单个请求不该比整个进程的停机窗口更久）。
 * - `lockMs`：`SELECT … FOR UPDATE`（`ledger.lockAccount`）与 `pg_advisory_xact_lock`
 *   （agent 事件 seq）被别的事务挡住时，过去是无限等；10s 后语句直接失败，
 *   不会拖满 30s 的语句窗口。
 * - `idleTxMs`：客户端 `BEGIN` 后崩溃/挂起，事务、行锁与陈旧快照永远不释放；
 *   服务端在 60s 无语句时直接断开该会话。仓库里没有超过 60s 的事务。
 *
 * ## 诚实边界
 * - 这些是**每连接**的服务端参数（startup runtime parameters），对池里新建的每条连接生效；
 *   迁移走 drizzle-kit、不经过 `createDb`，所以不受影响（也不该受影响）。
 * - 超时后客户端拿到的是 pg 原始错误：语句超时 SQLSTATE `57014`、锁等待超时 `55P03`、
 *   acquire 超时是 pg-pool 的 `Error("timeout exceeded when trying to connect")`。
 *   `AllExceptionsFilter` 会把它归为 500 + `INTERNAL`（不新增对外错误码——那是契约变更）。
 * - 不按请求动态调整：这些是进程级常量，需要不同口径时用 `createDb` 的第二参数覆盖。
 */
export interface DbLimits {
  /** 池内连接上限 */
  poolMax: number;
  /** 空闲连接回收时间 */
  idleMs: number;
  /** 从池里取连接（或新建连接）的等待上限 */
  acquireMs: number;
  /** 单条语句在服务端的执行上限 */
  statementMs: number;
  /** 单条语句等待行锁 / 表锁 / advisory lock 的上限 */
  lockMs: number;
  /** 事务开始后「没有语句」状态的上限（服务端会直接断开该会话） */
  idleTxMs: number;
}

export const DB_LIMITS: Readonly<DbLimits> = Object.freeze({
  poolMax: 10,
  idleMs: 30_000,
  acquireMs: 10_000,
  statementMs: 30_000,
  lockMs: 10_000,
  idleTxMs: 60_000,
});

const LIMIT_KEYS = [
  "poolMax",
  "idleMs",
  "acquireMs",
  "statementMs",
  "lockMs",
  "idleTxMs",
] as const satisfies readonly (keyof DbLimits)[];

/**
 * 合并默认值与覆盖值，并拒绝任何「等于无限」的取值。
 *
 * `0` 不是「立即超时」，在 pg 里它恰好是「永远等」——正是这批要消掉的语义，
 * 所以 0、负数、NaN、Infinity、小数一律抛 `RangeError`，而不是悄悄回落默认值。
 * 键名拼错也抛（`statementTimeout` 之类会静默保留默认值，是最难发现的一种漏）。
 */
export function resolveDbLimits(overrides: Partial<DbLimits> = {}): DbLimits {
  for (const key of Object.keys(overrides)) {
    if (!(LIMIT_KEYS as readonly string[]).includes(key)) {
      throw new RangeError(`unknown db limit ${key}`);
    }
  }
  const merged: DbLimits = { ...DB_LIMITS, ...overrides };
  for (const key of LIMIT_KEYS) {
    const value = merged[key];
    if (!Number.isInteger(value) || value <= 0) {
      throw new RangeError(
        `invalid db limit ${key}: ${String(value)} (must be a positive integer; 0 = wait forever)`,
      );
    }
  }
  return merged;
}

/** 把四道闸映射成 pg 的 `PoolConfig`（纯函数，便于在不连库的情况下断言接线）。 */
export function dbPoolOptions(
  connectionString: string,
  overrides: Partial<DbLimits> = {},
): PoolConfig {
  const limits = resolveDbLimits(overrides);
  return {
    connectionString,
    max: limits.poolMax,
    idleTimeoutMillis: limits.idleMs,
    connectionTimeoutMillis: limits.acquireMs,
    statement_timeout: limits.statementMs,
    lock_timeout: limits.lockMs,
    idle_in_transaction_session_timeout: limits.idleTxMs,
  };
}

export function createDb(
  connectionString: string,
  overrides: Partial<DbLimits> = {},
): DbHandle {
  const pool = new Pool(dbPoolOptions(connectionString, overrides));
  return { db: drizzle(pool, { schema }), pool };
}