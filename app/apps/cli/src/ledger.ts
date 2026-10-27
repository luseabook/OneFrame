import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CliError } from "./errors";
import { ledgerFile } from "./config";

/**
 * 本地幂等账本（三态）。
 *
 * 契约来源：`_acceptance/_gap/cli-skill/reelmate-cli-skill/commands/ledger.md:5-16`
 * ——账本记录每一次**非幂等写**的结果状态，阻止「同一次写被提交两遍」：
 *
 * | 状态 | 含义 | 同键再写 |
 * |---|---|---|
 * | `pending` | 已占位，请求未结束 | 拒绝 |
 * | `in_doubt` | 已发出但结果未知（可能已生效） | 拒绝，等人工复核 |
 * | `applied` | 确认成功 | 按重放短路，返回上次结果 |
 *
 * 两条已知偏离（登记在回报「待取证」）：
 * 1. 竞品 `ledger.md:11` 说 `pending` 拒绝时用**退出码 11**，但
 *    `manual/error-codes.md:5-19` 只定义 0..10。两份文档自相矛盾，我方按本批任务
 *    口径取 0..10 全集，`pending`/`in_doubt` 拒绝统一走**退出码 1**（一般失败），
 *    并在 `error.raw.state` 里带上真实状态，脚本仍能区分。
 * 2. 竞品账本落在 `$REELMATE_CONFIG_DIR/state/idempotency.json`，我方对应
 *    `$ONEFRAME_CONFIG_DIR/state/idempotency.json`。
 */

export type LedgerState = "pending" | "in_doubt" | "applied";

export interface LedgerEntry {
  key: string;
  state: LedgerState;
  /** 目标端点（method + path），用于人工复核时定位是哪一笔写 */
  endpoint: string;
  item_count: number;
  at: string;
  note?: string;
  /** `applied` 时保存上次结果，供同键重放直接短路返回 */
  data?: unknown;
}

interface LedgerFile {
  version: 1;
  entries: LedgerEntry[];
}

export function readLedger(dir: string): LedgerEntry[] {
  const file = ledgerFile(dir);
  if (!existsSync(file)) return []; // 新装 CLI 本来就没有账本（ledger.md:50）
  const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<LedgerFile>;
  return Array.isArray(parsed.entries) ? parsed.entries : [];
}

export function writeLedger(dir: string, entries: LedgerEntry[]): void {
  const file = ledgerFile(dir);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const payload: LedgerFile = { version: 1, entries };
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
}

export function findEntry(entries: readonly LedgerEntry[], key: string): LedgerEntry | undefined {
  return entries.find((e) => e.key === key);
}

export function upsertEntry(entries: readonly LedgerEntry[], entry: LedgerEntry): LedgerEntry[] {
  const next = entries.filter((e) => e.key !== entry.key);
  next.push(entry);
  return next.sort((a, b) => a.at.localeCompare(b.at));
}

export function removeEntry(entries: readonly LedgerEntry[], key: string): LedgerEntry[] {
  return entries.filter((e) => e.key !== key);
}

export type LedgerDecision =
  | { action: "proceed" }
  | { action: "replay"; entry: LedgerEntry }
  | { action: "blocked"; reason: string; entry: LedgerEntry };

/**
 * 写前的三态判定。`--force-replay KEY` 只对 `in_doubt` 放行一次
 * （`commands/ledger.md:106-114`：已复核完、直接带在重打的命令上）。
 */
export function decideWrite(
  entries: readonly LedgerEntry[],
  key: string,
  opts: { forceReplay?: string } = {},
): LedgerDecision {
  const entry = findEntry(entries, key);
  if (!entry) return { action: "proceed" };
  if (entry.state === "applied") return { action: "replay", entry };
  if (opts.forceReplay && opts.forceReplay === `${entry.key}` && entry.state === "in_doubt") {
    return { action: "proceed" };
  }
  if (entry.state === "pending") {
    return {
      action: "blocked",
      entry,
      reason: `幂等键 ${key} 处于 pending（可能有另一个进程正在处理）；确认无并发后用 ledger resolve 或 --force-replay`,
    };
  }
  return {
    action: "blocked",
    entry,
    reason: `幂等键 ${key} 处于 in_doubt（上次请求已发出但结果未知，可能已在服务端生效）；先用只读命令复核再用 ledger resolve 解除`,
  };
}

/** 判定结果 → 直接抛 CliError（保持调用方干净） */
export function assertWritable(decision: LedgerDecision): void {
  if (decision.action !== "blocked") return;
  throw new CliError("internal", decision.reason, {
    exitCode: 1,
    retryable: false,
    // 状态原样带给脚本，让脚本能区分 pending / in_doubt（退出码 0..10 不含 11）
    raw: { state: decision.entry.state, key: decision.entry.key },
  });
}
