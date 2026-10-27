import type { CliErrorKind, ExitCode } from "./exit-codes";

/**
 * CLI 内部异常。`kind` 决定 envelope 的 `error.kind`，`exitCode` 决定进程退出码；
 * 未显式给 exitCode 时由调用方按 kind 查 `KIND_EXIT` 推导。
 */
export class CliError extends Error {
  readonly kind: CliErrorKind;
  readonly raw?: unknown;
  readonly retryable?: boolean;
  readonly exitCode?: ExitCode;

  constructor(
    kind: CliErrorKind,
    message: string,
    opts: { raw?: unknown; retryable?: boolean; exitCode?: ExitCode } = {},
  ) {
    super(message);
    this.name = "CliError";
    this.kind = kind;
    this.raw = opts.raw;
    this.retryable = opts.retryable;
    this.exitCode = opts.exitCode;
  }
}

export const usageError = (message: string, raw?: unknown): CliError =>
  new CliError("usage", message, { raw });

export const isCliError = (e: unknown): e is CliError => e instanceof CliError;
