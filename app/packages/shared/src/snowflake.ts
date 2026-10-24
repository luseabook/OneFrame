// 雪花 ID：41bit 毫秒 + 10bit worker + 12bit 序列，epoch=2026-01-01 UTC
// 所有表主键统一 bigint 雪花（docs/02-architecture/database.md），API 层字符串化防 JS 精度丢失
const EPOCH = 1767225600000n;
const WORKER_BITS = 10n;
const SEQ_BITS = 12n;
const MAX_WORKER = (1n << WORKER_BITS) - 1n;
const MAX_SEQ = (1n << SEQ_BITS) - 1n;

export class Snowflake {
  private lastMs = 0n;
  private seq = 0n;

  constructor(readonly workerId: bigint = 1n) {
    if (workerId < 0n || workerId > MAX_WORKER) {
      throw new Error(`workerId must be within [0, ${MAX_WORKER}]`);
    }
  }

  nextId(): bigint {
    let now = BigInt(Date.now());
    if (now === this.lastMs) {
      this.seq = (this.seq + 1n) & MAX_SEQ;
      if (this.seq === 0n) {
        // 当前毫秒序列耗尽，自旋到下一毫秒
        while (now <= this.lastMs) now = BigInt(Date.now());
      }
    } else {
      this.seq = 0n;
    }
    this.lastMs = now;
    return (
      ((now - EPOCH) << (WORKER_BITS + SEQ_BITS)) |
      (this.workerId << SEQ_BITS) |
      this.seq
    );
  }
}

const globalForSnowflake = globalThis as unknown as {
  __appSnowflake?: Snowflake;
};

export const snowflake: Snowflake =
  globalForSnowflake.__appSnowflake ??
  (globalForSnowflake.__appSnowflake = new Snowflake(
    // 多进程（API 副本/worker/测试 worker）必须用不同 worker id，否则同毫秒会撞主键。
    // 显式 WORKER_ID 优先；否则用 pid 取模，避免所有进程默认 1。
    process.env.WORKER_ID ? BigInt(process.env.WORKER_ID) : BigInt(process.pid % 1024),
  ));

export const newId = (): bigint => snowflake.nextId();
