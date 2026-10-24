import { ChannelError } from "./errors";

/**
 * 渠道 HTTP 传输层：可注入 fetch + 重试策略。
 *
 * 重试语义（生产渠道的通用约定）：
 * - 网络错误 / 超时 → 重试（幂等操作，例如查单；下单/退款由渠道侧幂等键兜底）
 * - HTTP 429 / 5xx → 重试，退避基数可配
 * - HTTP 4xx → 业务错误，**不重试**（重试只会放大问题）
 * - 2xx 原样返回文本，由适配器解析
 */

export interface FetchResponseLike {
  status: number;
  text(): Promise<string>;
  headers?: { get(name: string): string | null };
}

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<FetchResponseLike>;

export interface HttpRequestSpec {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface RetryPolicy {
  /** 额外重试次数（默认 2，即最多 3 次尝试） */
  retries?: number;
  /** 指数退避基数（毫秒），第 n 次重试等待 base * 2^(n-1) */
  baseDelayMs?: number;
  /** 单次请求超时（毫秒） */
  timeoutMs?: number;
  /** 供测试注入的 sleep（避免真实等待） */
  sleep?: (ms: number) => Promise<void>;
}

export interface HttpResult {
  status: number;
  text: string;
}

const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 300;
const DEFAULT_TIMEOUT_MS = 10_000;
const BODY_PREVIEW_LIMIT = 2048;

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // 测试/CLI 场景下不要因为退避定时器阻止进程退出
    (timer as { unref?: () => void }).unref?.();
  });

function errorMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function preview(body: string): string {
  return body.length > BODY_PREVIEW_LIMIT ? `${body.slice(0, BODY_PREVIEW_LIMIT)}…` : body;
}

export async function sendWithRetry(
  fetchImpl: FetchLike,
  spec: HttpRequestSpec,
  policy: RetryPolicy = {},
): Promise<HttpResult> {
  const retries = Math.max(0, policy.retries ?? DEFAULT_RETRIES);
  const baseDelayMs = Math.max(1, policy.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const timeoutMs = Math.max(1, policy.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const sleep = policy.sleep ?? defaultSleep;

  let lastError: ChannelError | undefined;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(baseDelayMs * 2 ** (attempt - 1));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    (timer as { unref?: () => void }).unref?.();

    let response: FetchResponseLike;
    try {
      response = await fetchImpl(spec.url, {
        method: spec.method,
        headers: spec.headers,
        body: spec.body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      lastError =
        (err as { name?: string } | undefined)?.name === "AbortError"
          ? new ChannelError("CHANNEL_TIMEOUT", `channel request timeout after ${timeoutMs}ms`, {
              retryable: true,
              cause: err,
            })
          : new ChannelError("CHANNEL_NETWORK", `channel request failed: ${errorMessage(err)}`, {
              retryable: true,
              cause: err,
            });
      continue;
    }
    clearTimeout(timer);

    const text = await response.text().catch(() => "");
    if (response.status >= 200 && response.status < 300) {
      return { status: response.status, text };
    }
    if (response.status === 429) {
      lastError = new ChannelError("CHANNEL_RATE_LIMITED", "channel rate limited (HTTP 429)", {
        retryable: true,
        httpStatus: 429,
        details: { body: preview(text) },
      });
      continue;
    }
    if (response.status >= 500) {
      lastError = new ChannelError("CHANNEL_SERVER_ERROR", `channel server error (HTTP ${response.status})`, {
        retryable: true,
        httpStatus: response.status,
        details: { body: preview(text) },
      });
      continue;
    }
    // 4xx：业务拒绝，不重试
    throw new ChannelError("CHANNEL_BUSINESS_ERROR", `channel rejected request (HTTP ${response.status})`, {
      retryable: false,
      httpStatus: response.status,
      details: { body: preview(text) },
    });
  }

  throw lastError ?? new ChannelError("CHANNEL_NETWORK", "channel request failed", { retryable: true });
}

/** 尝试把渠道错误响应体解析成 {code,message}，用于 vendorCode/错误文案 */
export function parseErrorBody(text: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const code = parsed.code ?? parsed.sub_code ?? parsed.error_code;
    const message = parsed.message ?? parsed.sub_msg ?? parsed.msg ?? parsed.error_message;
    return {
      code: code === undefined ? undefined : String(code),
      message: message === undefined ? undefined : String(message),
    };
  } catch {
    return {};
  }
}
