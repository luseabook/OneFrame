import { describe, expect, it } from "vitest";
import { readEnvNumber } from "./env-number";

/**
 * 数值环境变量读取（第 123 批）。
 *
 * 这张表盯的是 `Number(process.env.<键> ?? d)` 的两类静默：空白 → 0、坏值 → NaN。
 * 两条都不报错、类型检查也过，只有运行时的行为能证明（见 `_acceptance/d123`）。
 */
describe("readEnvNumber", () => {
  it("未设置时返回默认值", () => {
    expect(readEnvNumber("POLL_INTERVAL_MS", { default: 1000, min: 1 }, {})).toBe(1000);
  });

  it("空白与纯空格视为未设置，而不是 0（Number('') === 0 的陷阱）", () => {
    expect(readEnvNumber("POLL_INTERVAL_MS", { default: 1000, min: 1 }, { POLL_INTERVAL_MS: "" })).toBe(1000);
    expect(readEnvNumber("POLL_INTERVAL_MS", { default: 1000, min: 1 }, { POLL_INTERVAL_MS: "   " })).toBe(1000);
    expect(readEnvNumber("POLL_INTERVAL_MS", { default: 1000, min: 1 }, { POLL_INTERVAL_MS: "\t\n" })).toBe(1000);
  });

  it("接受十进制、负号、科学计数法与首尾空白", () => {
    expect(readEnvNumber("X", { default: 1 }, { X: "1000" })).toBe(1000);
    expect(readEnvNumber("X", { default: 1 }, { X: " 5 " })).toBe(5);
    expect(readEnvNumber("X", { default: 1 }, { X: "1e3" })).toBe(1000);
    expect(readEnvNumber("X", { default: 1 }, { X: "+42" })).toBe(42);
    expect(readEnvNumber("X", { default: 1 }, { X: "-7" })).toBe(-7);
    expect(readEnvNumber("X", { default: 1 }, { X: ".5" })).toBe(0.5);
  });

  it.each(["30s", "5m", "abc", "0x10", "Infinity", "NaN", "1_000", "1,000", "1 000"])(
    "拒绝非十进制写法 %s（RangeError，含变量名与原始值）",
    (raw) => {
      expect(() => readEnvNumber("SHUTDOWN_TIMEOUT_MS", { default: 25_000 }, { SHUTDOWN_TIMEOUT_MS: raw })).toThrow(
        RangeError,
      );
      expect(() => readEnvNumber("SHUTDOWN_TIMEOUT_MS", { default: 25_000 }, { SHUTDOWN_TIMEOUT_MS: raw })).toThrow(
        `invalid SHUTDOWN_TIMEOUT_MS: ${JSON.stringify(raw)}`,
      );
    },
  );

  it("要求整数时拒绝小数与小数型科学计数法", () => {
    expect(() => readEnvNumber("WORKER_ID", { default: 0, integer: true }, { WORKER_ID: "1.5" })).toThrow(
      /must be an integer/,
    );
    expect(readEnvNumber("X", { default: 0 }, { X: "1.5" })).toBe(1.5);
  });

  it("min / max 为闭区间；0 在 min=0 下是合法值（「停用」语义）", () => {
    expect(readEnvNumber("X", { default: 1, min: 0, integer: true }, { X: "0" })).toBe(0);
    expect(readEnvNumber("X", { default: 1, min: 1, max: 1023, integer: true }, { X: "1023" })).toBe(1023);
    expect(() => readEnvNumber("X", { default: 1, min: 1 }, { X: "0" })).toThrow(/must be >= 1/);
    expect(() => readEnvNumber("X", { default: 1, max: 1023 }, { X: "1024" })).toThrow(/must be <= 1023/);
  });

  it("默认值本身不合规格时也抛（这是代码写错，不是配置写错）", () => {
    expect(() => readEnvNumber("X", { default: 1.5, integer: true }, {})).toThrow(/invalid default for X/);
    expect(() => readEnvNumber("X", { default: 0, min: 1 }, {})).toThrow(/invalid default for X/);
    expect(() => readEnvNumber("X", { default: Number.NaN }, {})).toThrow(/invalid default for X/);
  });

  it("只读注入的 env，不碰 process.env", () => {
    const before = process.env.POLL_INTERVAL_MS;
    expect(readEnvNumber("POLL_INTERVAL_MS", { default: 1000, min: 1 }, { POLL_INTERVAL_MS: "250" })).toBe(250);
    expect(process.env.POLL_INTERVAL_MS).toBe(before);
  });

  it("错误信息不含「静默回落」的措辞，而是明确拒绝", () => {
    expect(() => readEnvNumber("WORKER_CONCURRENCY", { default: 5, min: 1, integer: true }, { WORKER_CONCURRENCY: "5m" })).toThrow(
      /blank = unset/,
    );
    expect(() => readEnvNumber("WORKER_CONCURRENCY", { default: 5, min: 1, integer: true }, { WORKER_CONCURRENCY: "5m" })).not.toThrow(
      /default/i,
    );
  });
});