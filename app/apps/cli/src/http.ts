import { CliError } from "./errors";
import { EXIT, mapBusinessCode, mapHttpStatus, type ExitCode } from "./exit-codes";
import { redactUrl } from "./redact";

/**
 * HTTP 传输层（可注入，单测用它断言「dry-run 不发请求」「幂等键透传」）。
 *
 * 不使用 axios / node-fetch：Node 20+ 自带 fetch，CLI 保持零运行时依赖，
 * 避免为一个薄壳引入依赖树（也便于 `pnpm --filter @app/cli build` 在无网络环境跑）。
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface TransportRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface TransportResponse {
  status: number;
  body: string;
}

export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

/** 生产传输：Node 内置 fetch；非 2xx 也返回 body，由上层按信封解析（不抛） */
export function fetchTransport(
  fetchImpl: typeof fetch = globalThis.fetch,
  defaultTimeoutMs = 30_000,
): Transport {
  return async (req) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), defaultTimeoutMs);
    try {
      const res = await fetchImpl(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
      return { status: res.status, body: await res.text() };
    } finally {
      clearTimeout(timer);
    }
  };
}

export interface ApiCall {
  method: HttpMethod;
  /** 相对 baseUrl 的路径（不含 `/v1` 前缀，前缀属于 baseUrl） */
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  /** 透传 `Idempotency-Key` 头（服务端表 `idempotency_records` 见 schema.ts:342） */
  idempotencyKey?: string;
  timeoutMs?: number;
}

export interface ApiClientOptions {
  baseUrl: string;
  transport: Transport;
  token?: string;
  spaceId?: string;
  timeoutMs?: number;
}

/** dry-run 用：只描述将要发送的请求，不构造 Authorization */
export interface RequestDescription {
  method: HttpMethod;
  path: string;
  url: string;
  query: Record<string, unknown>;
  body: unknown;
  idempotency_key: string | null;
  space_id: string | null;
}

function encodeQuery(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      // 数组按逗号连接：与 api 侧 `?ids=a,b` 的既有口径一致（tasks.controller.ts:26）
      if (value.length > 0) params.set(key, value.map((v) => String(v)).join(","));
    } else if (typeof value === "object") {
      params.set(key, JSON.stringify(value));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly transport: Transport;
  private readonly token?: string;
  private readonly spaceId?: string;
  private readonly timeoutMs: number;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.transport = opts.transport;
    this.token = opts.token;
    this.spaceId = opts.spaceId;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  buildUrl(path: string, query: Record<string, unknown> = {}): string {
    const clean = path.startsWith("/") ? path : `/${path}`;
    return `${this.baseUrl}${clean}${encodeQuery(query)}`;
  }

  private headers(call: ApiCall): Record<string, string> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (call.body !== undefined) headers["content-type"] = "application/json";
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.spaceId) headers["x-space-id"] = this.spaceId;
    if (call.idempotencyKey) headers["idempotency-key"] = call.idempotencyKey;
    return headers;
  }

  /** dry-run 描述（不含凭据；URL 里的敏感查询值已脱敏） */
  describe(call: ApiCall): RequestDescription {
    const query = call.query ?? {};
    return {
      method: call.method,
      path: call.path.startsWith("/") ? call.path : `/${call.path}`,
      url: redactUrl(this.buildUrl(call.path, query)),
      query,
      body: call.body ?? null,
      idempotency_key: call.idempotencyKey ?? null,
      space_id: this.spaceId ?? null,
    };
  }

  /**
   * SSE 用的裸请求描述（URL + 鉴权头），交给 `runtime.openStream` 打开长连接。
   *
   * 为什么单独开一个方法而不是复用 {@link call}：`call` 会把响应体整段文本读下来再
   * 解 `{code,msg,data}` 信封，而 SSE 的响应体永远不会结束、也没有信封——走同一个
   * 路径只会等到超时。这里只借用鉴权头与 baseUrl，其余全部交给流式处理。
   */
  streamRequest(path: string, query: Record<string, unknown> = {}): RequestDescription & {
    method: HttpMethod;
    headers: Record<string, string>;
  } {
    const url = this.buildUrl(path, query);
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (this.spaceId) headers["x-space-id"] = this.spaceId;
    return {
      ...this.describe({ method: "GET", path, query }),
      method: "GET" as HttpMethod,
      url,
      headers,
    };
  }

  /**
   * 发一次业务请求并解开信封。
   * 统一信封 `{code,msg,data}`（api-spec §1）：`code===0` 返回 data，否则按
   * exit-codes.ts 的业务码表抛 CliError（HTTP 200 + code≠0 是我方约定）。
   */
  async call<T = unknown>(call: ApiCall): Promise<T> {
    const url = this.buildUrl(call.path, call.query);
    const headers = this.headers(call);
    let res: TransportResponse;
    try {
      res = await this.transport({
        method: call.method,
        url,
        headers,
        body: call.body === undefined ? undefined : JSON.stringify(call.body),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const timedOut = /abort|timeout|timed out/i.test(message);
      throw new CliError(timedOut ? "timeout" : "network", message, {
        // 写操作即使网络超时也不要盲目重放（error-codes.md:23）
        retryable: call.method === "GET",
        exitCode: timedOut ? EXIT.TIMEOUT : EXIT.FAILURE,
        raw: { url: redactUrl(url) },
      });
    }

    let parsed: unknown;
    try {
      parsed = res.body === "" ? {} : (JSON.parse(res.body) as unknown);
    } catch {
      const mapped = mapHttpStatus(res.status);
      throw new CliError(mapped.kind, `unexpected non-JSON response (HTTP ${res.status})`, {
        raw: { status: res.status, url: redactUrl(url) },
        exitCode: mapped.exit,
      });
    }

    const envelope = parsed as { code?: number; msg?: string; data?: unknown };
    if (typeof envelope.code !== "number") {
      const mapped = mapHttpStatus(res.status);
      throw new CliError(mapped.kind, `malformed envelope (HTTP ${res.status})`, {
        raw: { status: res.status, url: redactUrl(url) },
        exitCode: mapped.exit,
      });
    }
    if (envelope.code === 0) return envelope.data as T;

    const mapped = mapBusinessCode(envelope.code);
    throw new CliError(mapped.kind, envelope.msg?.trim() || `request failed (code ${envelope.code})`, {
      // 是否可重试由调用方按 kind 判断；这里只把后端业务码原样交给脚本
      retryable: mapped.kind === "network" || mapped.kind === "timeout" || mapped.kind === "server",
      exitCode: mapped.exit as ExitCode,
      raw: { code: envelope.code, status: res.status },
    });
  }
}
