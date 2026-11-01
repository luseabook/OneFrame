import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_KILL_GRACE_MS,
  execFileBounded,
  type BoundedExecImpl,
} from "./exec-bounded";

type Caught = Error & { escalated?: boolean; cause?: unknown; code?: number };

const node = process.execPath;

const catchError = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error as Caught,
  );

/**
 * 第 116 批：execFile 自带 timeout 只发一次 SIGTERM，不保证进程退出。
 * 这里用注入的 exec 替身把「到点 → SIGTERM → 宽限 → SIGKILL → 放手」整条链钉住，
 * 不依赖宿主真的能忽略信号（Windows 的 SIGTERM 本身就是 TerminateProcess）。
 */
describe("execFileBounded（第 116 批）", () => {
  it("子进程正常结束：返回 stdout/stderr，不留下定时器", async () => {
    const kills: string[] = [];
    const fast: BoundedExecImpl = (_file, _args, _options, callback) => {
      setImmediate(() => callback(null, "done", "warn"));
      return {
        kill: (signal) => {
          kills.push(String(signal));
          return true;
        },
      };
    };

    await expect(
      execFileBounded("ffmpeg", ["-version"], { timeoutMs: 30 }, fast),
    ).resolves.toEqual({ stdout: "done", stderr: "warn" });

    // 比上限再等一会：回调早到就必须清掉 SIGTERM 定时器
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(kills).toEqual([]);
  });

  it("真实子进程成功/失败都保持 execFile 原有语义（失败不包装成超时）", async () => {
    await expect(
      execFileBounded(node, ["-e", "process.stdout.write('out'); process.stderr.write('err')"], {
        timeoutMs: 5_000,
      }),
    ).resolves.toEqual({ stdout: "out", stderr: "err" });

    const failed = await catchError(
      execFileBounded(node, ["-e", "process.stderr.write('boom'); process.exit(7)"], {
        timeoutMs: 5_000,
      }),
    );
    expect(failed).not.toBeNull();
    expect(failed?.name).not.toBe("TimeoutError");
    expect(failed?.code).toBe(7);
  });

  it("永不退出的子进程：到点 SIGTERM，宽限后 SIGKILL，并在 SIGKILL 时放手", async () => {
    const kills: string[] = [];
    const hung: BoundedExecImpl = () => ({
      kill: (signal) => {
        kills.push(String(signal));
        return true;
      },
    });

    const started = Date.now();
    const error = await catchError(
      execFileBounded("ffmpeg", ["-i", "bad.mp4"], { timeoutMs: 60, killGraceMs: 60 }, hung),
    );

    expect(error?.name).toBe("TimeoutError");
    expect(error?.message).toMatch(/ffmpeg timed out after 60 ms/);
    expect(error?.escalated).toBe(true);
    expect(kills).toEqual(["SIGTERM", "SIGKILL"]);
    // 不等待永不发生的 close：两次信号 + 宽限后就该落定
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("SIGTERM 后在宽限内退出：仍是超时（不把被杀当成功），但不再补 SIGKILL", async () => {
    const kills: string[] = [];
    const diesOnTerm: BoundedExecImpl = (_file, _args, _options, callback) => ({
      kill: (signal) => {
        kills.push(String(signal));
        if (signal === "SIGTERM") {
          const killed = Object.assign(new Error("Command failed: killed"), {
            killed: true,
            signal: "SIGTERM",
          });
          setImmediate(() => callback(killed, "", ""));
        }
        return true;
      },
    });

    const error = await catchError(
      execFileBounded("ffmpeg", [], { timeoutMs: 40, killGraceMs: 5_000 }, diesOnTerm),
    );

    expect(error?.name).toBe("TimeoutError");
    expect(error?.escalated).toBe(false);
    expect(error?.cause).toBeInstanceOf(Error);
    expect(kills).toEqual(["SIGTERM"]);
  });

  it("kill 本身抛错不能变成未捕获异常（定时器回调里必须兜住）", async () => {
    const throwing: BoundedExecImpl = () => ({
      kill: () => {
        throw new Error("kill failed");
      },
    });

    const error = await catchError(
      execFileBounded("ffmpeg", [], { timeoutMs: 20, killGraceMs: 20 }, throwing),
    );
    expect(error?.name).toBe("TimeoutError");
    expect(error?.escalated).toBe(true);
  });

  it("非法上限构造即抛，不静默退化成无上限", () => {
    const make = (patch: { timeoutMs?: number; killGraceMs?: number }) => () =>
      execFileBounded("ffmpeg", [], { timeoutMs: 100, ...patch });
    expect(make({ timeoutMs: -1 })).toThrow(/invalid timeoutMs/);
    expect(make({ timeoutMs: Number.NaN })).toThrow(/invalid timeoutMs/);
    expect(make({ killGraceMs: -1 })).toThrow(/invalid killGraceMs/);
    expect(make({ killGraceMs: Number.NaN })).toThrow(/invalid killGraceMs/);
  });

  it("默认宽限窗口是有限值（不是 0，也不是 10 分钟级）", () => {
    expect(DEFAULT_KILL_GRACE_MS).toBeGreaterThanOrEqual(500);
    expect(DEFAULT_KILL_GRACE_MS).toBeLessThanOrEqual(5_000);
  });
});

const source = (path: string) => readFileSync(join(__dirname, path), "utf8");
const workerSource = (file: string) =>
  readFileSync(join(__dirname, "..", "..", "..", "apps", "worker", "src", file), "utf8");

describe("接线守卫：所有 ffmpeg/ffprobe 调用都走带升级的版本（第 116 批）", () => {
  it("四个调用点不再直接 promisify(execFile)，超时值原样保留", () => {
    const media = source("media-capability.ts");
    expect(media).toContain("execFileBounded(bin, [\"-version\"]");
    expect(media).toContain("timeoutMs: 5_000");

    const trim = source("ffmpeg-trim.ts");
    expect(trim).toContain("execFileBounded(");
    expect(trim).toContain("timeoutMs: options.timeoutMs ?? 120_000");

    const label = workerSource("label.ts");
    expect(label).toContain("execFileBounded(config.ffmpegPath ?? \"ffmpeg\"");
    expect(label).toContain("timeoutMs: 30_000");

    const timeline = workerSource("timeline-export.ts");
    expect(timeline.match(/execFileBounded\(/g)).toHaveLength(4);
    expect(timeline.match(/timeoutMs: FFMPEG_TIMEOUT_MS/g)).toHaveLength(3);
    expect(timeline).toContain("timeoutMs: 30_000");

    for (const [name, text] of [
      ["media-capability.ts", media],
      ["ffmpeg-trim.ts", trim],
      ["label.ts", label],
      ["timeline-export.ts", timeline],
    ] as const) {
      expect(text, name).not.toContain("promisify(execFile)");
      expect(text, name).not.toContain("from \"node:child_process\"");
    }
  });

  it("升级顺序固定在实现里：先 SIGTERM、宽限后 SIGKILL、随后立即放手", () => {
    const implementation = source("exec-bounded.ts");
    const term = implementation.indexOf('safeKill(child, "SIGTERM")');
    const grace = implementation.indexOf("timers.kill = setTimeout");
    const kill = implementation.indexOf('safeKill(child, "SIGKILL")');
    const release = implementation.indexOf(
      "settle(() => reject(timeoutError(file, timeoutMs, escalated)))",
    );
    expect(term).toBeGreaterThan(-1);
    expect(grace).toBeGreaterThan(term);
    expect(kill).toBeGreaterThan(grace);
    expect(release).toBeGreaterThan(kill);
    expect(implementation).toContain("}, killGraceMs);");
    expect(implementation).toContain("DEFAULT_KILL_GRACE_MS");
  });
});