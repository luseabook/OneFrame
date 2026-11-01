import { execFile, type ExecFileOptions } from "node:child_process";
import { basename } from "node:path";

/** SIGTERM 之后等多久再补 SIGKILL：被杀进程可能正在 flush 输出，给一个短暂收尾窗口 */
export const DEFAULT_KILL_GRACE_MS = 2_000;

export interface BoundedExecOptions extends Omit<ExecFileOptions, "timeout" | "killSignal" | "encoding"> {
  /** 到点先发 SIGTERM；0 = 不设上限（只留给显式关闭的部署，调用点不应传 0） */
  timeoutMs: number;
  /** SIGTERM 后仍未退出就发 SIGKILL（默认 DEFAULT_KILL_GRACE_MS） */
  killGraceMs?: number;
  /** 默认 utf8；设成别的编码时 stdout/stderr 仍是该编码解码后的字符串 */
  encoding?: BufferEncoding;
}

export interface BoundedExecResult {
  stdout: string;
  stderr: string;
}

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

interface ChildHandle {
  kill(signal?: NodeJS.Signals | number): boolean;
}

/** 仅供测试注入替身；生产一律用 node 的 execFile */
export type BoundedExecImpl = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
  callback: ExecCallback,
) => ChildHandle;

// execFile 的重载在 encoding 为 string 时回调给出 string；这里把类型收窄成唯一形态
const defaultExec = execFile as unknown as BoundedExecImpl;

function timeoutError(file: string, timeoutMs: number, escalated: boolean, cause?: Error): Error {
  const message = escalated
    ? `${basename(file)} timed out after ${timeoutMs} ms and did not exit after SIGTERM (SIGKILL sent)`
    : `${basename(file)} timed out after ${timeoutMs} ms (SIGTERM sent)`;
  return Object.assign(new Error(message), {
    name: "TimeoutError",
    killed: true,
    signal: "SIGTERM",
    escalated,
    cause,
  });
}

function safeKill(child: ChildHandle, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    // 进程可能已退出/句柄已回收；kill 失败不应把定时器回调变成未捕获异常
  }
}

/**
 * 带 SIGTERM → SIGKILL 升级的 execFile（第 116 批）。
 *
 * 为什么不用 execFile 自带的 `timeout`：它只发一次默认的 `killSignal`（SIGTERM）就返回，
 * 不保证进程真的退出。ffmpeg 在解码损坏片源、等待网络输入或卡在驱动里时可能忽略 SIGTERM，
 * 旧实现于是出现"超时错误已经抛出，ffmpeg 进程仍在跑"的静默泄漏——worker 重启也带不走它。
 * 这里在宽限窗口后补一次 SIGKILL，并在 SIGKILL 之后立刻放手：即使进程卡在不可中断的
 * 内核调用里（SIGKILL 都杀不掉），调用方也不会被无限挂住。
 *
 * 边界（诚实说清）：
 * 1. 只杀直接子进程，不杀进程组。我们始终 execFile 直接调 ffmpeg/ffprobe（不经过 shell），
 *    正常情况下子进程就是 ffmpeg 本体；若部署方把 `FFMPEG_PATH` 指向包装脚本，脚本派生的
 *    孙进程不在此保证内。
 * 2. Windows 没有 POSIX 信号：`kill("SIGTERM")` 已等价 TerminateProcess，第二次 SIGKILL
 *    通常只是无害的补充；升级逻辑的价值主要体现在 Linux/macOS。
 * 3. 超时路径丢弃已产出的部分 stdout/stderr（错误对象带 `escalated` 区分是否已升级），
 *    调用方拿到的是 TimeoutError，而不是半截输出。
 * 4. SIGKILL 后不等待 `close` 事件：不可中断状态下的进程可能残留，宁可留下孤儿也不挂死任务。
 */
export function execFileBounded(
  file: string,
  args: readonly string[],
  options: BoundedExecOptions,
  exec: BoundedExecImpl = defaultExec,
): Promise<BoundedExecResult> {
  const { timeoutMs, killGraceMs = DEFAULT_KILL_GRACE_MS, ...execOptions } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error(`invalid timeoutMs: ${String(timeoutMs)}（需为非负毫秒数，0 = 不设上限）`);
  }
  if (!Number.isFinite(killGraceMs) || killGraceMs < 0) {
    throw new Error(`invalid killGraceMs: ${String(killGraceMs)}（需为非负毫秒数）`);
  }

  return new Promise<BoundedExecResult>((resolve, reject) => {
    let settled = false;
    let termSent = false;
    let escalated = false;
    const timers: { term?: NodeJS.Timeout; kill?: NodeJS.Timeout } = {};

    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      if (timers.term) clearTimeout(timers.term);
      if (timers.kill) clearTimeout(timers.kill);
      finish();
    };

    const child = exec(
      file,
      args,
      { ...execOptions, encoding: execOptions.encoding ?? "utf8" },
      (error, stdout, stderr) => {
        if (termSent) {
          // 到点之后才退出：无论最终是自己退出还是被信号杀掉，对外都是超时
          settle(() => reject(timeoutError(file, timeoutMs, escalated, error ?? undefined)));
          return;
        }
        if (error) settle(() => reject(error));
        else settle(() => resolve({ stdout, stderr }));
      },
    );

    if (timeoutMs === 0) return;

    timers.term = setTimeout(() => {
      termSent = true;
      safeKill(child, "SIGTERM");
      timers.kill = setTimeout(() => {
        escalated = true;
        safeKill(child, "SIGKILL");
        // 不再等 close：不可中断状态下的进程会让 close 永不发生，调用方不能被它挂住
        settle(() => reject(timeoutError(file, timeoutMs, escalated)));
      }, killGraceMs);
    }, timeoutMs);
  });
}