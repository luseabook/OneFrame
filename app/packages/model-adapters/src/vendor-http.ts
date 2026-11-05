// 供应商 HTTP 客户端（第 125 批：五份手写传输收口成一个入口）
//
// 改前：deepseek / ark-image / ark-video / postprocess / http-video 各自搓一遍重试、超时、
// 错误分类与响应读取，四道闸各有缺口（响应体不封顶 5/5、错误分类缺 1/5、重试缺 1/5、
// fetch 注入缺 1/5）。本文件把四件事一次做完：
//   · 重试只认 isRetryableVendorError（429/5xx/超时/网络），4xx 业务错误不重试；
//   · 超时只在这里起 AbortController，到点 abort；
//   · 非 2xx 错误体最多读 8 KiB、2xx 成功体最多读 32 MiB，到顶即取消响应流；
//   · fetch 只在未注入时取全局一次，其余全部走构造参数。
// 各适配器只保留「请求体怎么拼 / 响应怎么解释」，不再碰传输层。

import {
  classifyVendorHttpError,
  classifyVendorNetworkError,
  isRetryableVendorError,
  readVendorErrorBody,
  readVendorJson,
  VENDOR_ERROR_BODY_MAX_BYTES,
  VENDOR_RESPONSE_MAX_BYTES,
  VendorError,
} from "./errors";

/** 与全局 fetch 同形；测试替身从这里注入 */
export type VendorFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type VendorJsonBody = Record<string, unknown>;

export interface VendorHttpClientConfig {
  /** 供应商标签：默认文案前缀与错误归类都用它（ark / deepseek / http-video / tts…） */
  vendor: string;
  baseUrl: string;
  /** 单次请求超时（毫秒）；到点 abort，归类为可重试的 timeout */
  timeoutMs: number;
  /** 有值才发 `authorization: Bearer <key>` */
  apiKey?: string;
  /**
   * 额外请求头（原样合并）。
   *
   * 为什么需要：有些 OpenAI 兼容网关在协议之外提**自己**的要求，典型是 OpenCode Zen Go 的
   * `x-opencode-session`（不带就 400 `MissingSessionID`，见 providerOptions.headers 的用法）。
   * 这类要求是**供应商局部**的，不该散落成各适配器里的 if——统一从配置注入。
   * `authorization` 仍在最后写入，配置里塞同名头也覆盖不掉鉴权。
   */
  extraHeaders?: Record<string, string>;
  /** 429/5xx/超时/网络的重试次数（不含 4xx 业务错误） */
  maxRetries?: number;
  /** 指数退避基础毫秒 */
  retryBaseMs?: number;
  /**
   * 覆盖错误文案前缀。默认 `${vendor} ${operation} -> `；
   * DeepSeek 传 `deepseek http ` 保持既有 `deepseek http 401: …` 文案。
   */
  messagePrefix?: string;
  /** 2xx 响应体字节上限，默认 VENDOR_RESPONSE_MAX_BYTES */
  maxResponseBytes?: number;
  /** 非 2xx 错误体读取上限，默认 VENDOR_ERROR_BODY_MAX_BYTES */
  maxErrorBytes?: number;
  /** 覆盖「2xx 但不是 JSON」的文案（DeepSeek 既有文案） */
  invalidJsonMessage?: string;
  /** 网络错误文案是否带 operation；默认带，DeepSeek 既有文案不带 */
  networkErrorOperation?: boolean;
  /** 测试注入点；不传才用全局 fetch */
  fetchImpl?: VendorFetch;
}

interface ResolvedConfig {
  vendor: string;
  baseUrl: string;
  timeoutMs: number;
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  maxRetries: number;
  retryBaseMs: number;
  messagePrefix?: string;
  maxResponseBytes: number;
  maxErrorBytes: number;
  invalidJsonMessage?: string;
  networkErrorOperation: boolean;
  /** 未注入时留空：请求时才落到全局 fetch，信号在调用点显式传下去 */
  fetchImpl?: VendorFetch;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VendorHttpClient {
  private readonly resolved: ResolvedConfig;

  constructor(config: VendorHttpClientConfig) {
    this.resolved = {
      vendor: config.vendor,
      baseUrl: config.baseUrl.replace(/\/$/, ""),
      timeoutMs: config.timeoutMs,
      apiKey: config.apiKey,
      extraHeaders: config.extraHeaders,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryBaseMs: config.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
      messagePrefix: config.messagePrefix,
      maxResponseBytes: config.maxResponseBytes ?? VENDOR_RESPONSE_MAX_BYTES,
      maxErrorBytes: config.maxErrorBytes ?? VENDOR_ERROR_BODY_MAX_BYTES,
      invalidJsonMessage: config.invalidJsonMessage,
      networkErrorOperation: config.networkErrorOperation ?? true,
      fetchImpl: config.fetchImpl,
    };
  }

  /** 请求入口：带指数退避，只重试 VendorError.retryable */
  async request<T = VendorJsonBody>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.resolved.maxRetries; attempt += 1) {
      try {
        return (await this.requestOnce(method, path, body)) as T;
      } catch (err) {
        lastError = err;
        if (!isRetryableVendorError(err) || attempt === this.resolved.maxRetries) break;
        await sleep(this.resolved.retryBaseMs * 2 ** attempt);
      }
    }
    throw lastError;
  }

  private async requestOnce(method: "GET" | "POST", path: string, body?: unknown): Promise<VendorJsonBody> {
    const { vendor, fetchImpl, messagePrefix, invalidJsonMessage, networkErrorOperation } = this.resolved;
    const operation = `${method} ${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.resolved.timeoutMs);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      // 供应商要求的附加头先铺，鉴权头最后写（配置里塞同名头也不能顶掉鉴权）
      if (this.resolved.extraHeaders) Object.assign(headers, this.resolved.extraHeaders);
      if (this.resolved.apiKey) headers.authorization = `Bearer ${this.resolved.apiKey}`;
      const url = `${this.resolved.baseUrl}${path}`;
      const init: RequestInit = {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      };
      // 注入替身走构造参数；未注入时才落到全局 fetch —— 信号在这一处显式写进实参，
      // 守卫测试才能在调用点看见时间上限（而不是藏在包装函数背后）。
      const res = fetchImpl
        ? await fetchImpl(url, { ...init, signal: controller.signal })
        : await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        const text = await readVendorErrorBody(res, { maxBytes: this.resolved.maxErrorBytes });
        throw classifyVendorHttpError(res.status, text, { vendor, operation, messagePrefix });
      }
      return await readVendorJson(res, {
        vendor,
        operation,
        maxBytes: this.resolved.maxResponseBytes,
        invalidJsonMessage,
      });
    } catch (err) {
      if (err instanceof VendorError) throw err;
      // 超时 / 网络层错误 → 可重试
      if (
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TimeoutError" || err.name === "TypeError")
      ) {
        throw classifyVendorNetworkError(err, { vendor, operation: networkErrorOperation ? operation : undefined });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 2xx 但响应体自带 error 的情形（Ark 图像同步接口的审核拒绝）：
 * 用与非 2xx 相同的口径归类，避免「HTTP 成功、业务失败」绕过 auth/quota/output_rejected。
 */
export function classifyVendorPayloadError(
  payload: unknown,
  context: { vendor: string; operation: string; messagePrefix?: string },
): VendorError {
  let bodyText: string;
  try {
    bodyText = JSON.stringify(payload) ?? String(payload);
  } catch {
    bodyText = String(payload);
  }
  return classifyVendorHttpError(200, bodyText, context);
}
