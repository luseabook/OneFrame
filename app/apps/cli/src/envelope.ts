import type { CliErrorKind } from "./exit-codes";

/**
 * stdout 的**唯一**输出形状。
 *
 * 契约来源：`_acceptance/_gap/cli-skill/reelmate-cli-skill/SKILL.md:43`
 * 「成功 envelope 为 `{ok:true,data,links}`，失败为 `{ok:false,error}`」+
 * `SKILL.md:43` 「stdout 只消费业务数据，进度从 stderr 读取」。
 *
 * 因此：
 * - `writeSuccess` / `writeFailure` 只往 stdout 写**一个** JSON 文档；
 * - 进度、人类可读表格、提示一律走 stderr（见 render.ts）；
 * - `--json` 时 stdout 必须能被 `JSON.parse` 整段吃掉（不用 console.log 逐行拼）。
 */
export interface CliSuccess<T = unknown> {
  ok: true;
  data: T;
  links: Record<string, string>;
}

export interface CliFailure {
  ok: false;
  error: {
    kind: CliErrorKind;
    message: string;
    raw?: unknown;
    retryable?: boolean;
  };
}

export type CliOutput = CliSuccess | CliFailure;

export function success<T>(data: T, links: Record<string, string> = {}): CliSuccess<T> {
  return { ok: true, data, links };
}

export function failure(
  kind: CliErrorKind,
  message: string,
  opts: { raw?: unknown; retryable?: boolean } = {},
): CliFailure {
  const error: CliFailure["error"] = { kind, message };
  if (opts.raw !== undefined) error.raw = opts.raw;
  if (opts.retryable !== undefined) error.retryable = opts.retryable;
  return { ok: false, error };
}

export const isSuccess = (o: CliOutput): o is CliSuccess => o.ok;
