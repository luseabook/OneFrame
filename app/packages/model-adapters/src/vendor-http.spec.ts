import { describe, expect, it } from "vitest";
import { RetryableVendorError, VendorError } from "./errors";
import { classifyVendorPayloadError, VendorHttpClient } from "./vendor-http";

interface FakeCall {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  } as unknown as Response;
}

/** 带 body 流的响应：走「逐块读到上限即取消」的真实路径，记录是否被取消 */
function streamResponse(chunks: string[], status = 200) {
  const queue = chunks.map((chunk) => new TextEncoder().encode(chunk));
  let index = 0;
  let cancelled = false;
  const body = {
    getReader() {
      return {
        async read() {
          if (index >= queue.length) return { done: true, value: undefined };
          return { done: false, value: queue[index++] };
        },
        async cancel() {
          cancelled = true;
        },
        releaseLock() {},
      };
    },
  };
  const response = {
    ok: status >= 200 && status < 300,
    status,
    body,
    json: async () => {
      throw new Error("streamed response must not fall back to json()");
    },
    text: async () => "",
  } as unknown as Response;
  return { response, wasCancelled: () => cancelled };
}

function fakeFetch(...responses: Array<Response | Error>) {
  const calls: FakeCall[] = [];
  let index = 0;
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url: String(url),
      headers: { ...(init.headers as Record<string, string>) },
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function client(overrides: Partial<ConstructorParameters<typeof VendorHttpClient>[0]> = {}) {
  return new VendorHttpClient({
    vendor: "acme",
    baseUrl: "https://v.test",
    timeoutMs: 1_000,
    retryBaseMs: 1,
    ...overrides,
  });
}

describe("VendorHttpClient 传输层四道闸", () => {
  it("2xx：解析 JSON、带 Bearer、baseUrl 末尾斜杠被抹掉", async () => {
    const { impl, calls } = fakeFetch(jsonResponse({ task_id: "t1" }));
    const data = await client({ baseUrl: "https://v.test/", apiKey: "k", fetchImpl: impl }).request(
      "POST",
      "/tasks",
      { a: 1 },
    );
    expect(data).toEqual({ task_id: "t1" });
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe("https://v.test/tasks");
    expect(calls[0]!.headers.authorization).toBe("Bearer k");
    expect(calls[0]!.body).toEqual({ a: 1 });
  });

  it("extraHeaders 原样合并，且不能顶掉鉴权头（供应商私有要求走配置，不进代码）", async () => {
    const { impl, calls } = fakeFetch(jsonResponse({ ok: true }));
    const api = client({
      apiKey: "sk-1",
      // 典型场景：OpenCode Zen Go 强制 x-opencode-session；配置里再塞一个 authorization 也不能生效
      extraHeaders: { "x-opencode-session": "space-42", "user-agent": "oneframe-worker/1.0", authorization: "Bearer spoofed" },
      fetchImpl: impl,
    });

    await api.request("GET", "/v1/models");

    expect(calls[0]!.headers["x-opencode-session"]).toBe("space-42");
    expect(calls[0]!.headers["user-agent"]).toBe("oneframe-worker/1.0");
    expect(calls[0]!.headers.authorization).toBe("Bearer sk-1");
  });

  it("无 apiKey 时不发 authorization", async () => {
    const { impl, calls } = fakeFetch(jsonResponse({ ok: true }));
    await client({ fetchImpl: impl }).request("GET", "/x");
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });

  it("4xx 业务错误：分类后不重试", async () => {
    const { impl, calls } = fakeFetch(jsonResponse({ error: { message: "bad key" } }, 401));
    const err = await client({ fetchImpl: impl, maxRetries: 3 })
      .request("POST", "/x")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VendorError);
    expect((err as VendorError).kind).toBe("auth_error");
    expect((err as VendorError).retryable).toBe(false);
    expect(calls.length).toBe(1);
  });

  it("429：按指数退避重试后成功（次数 = 重试次数 + 1）", async () => {
    const { impl, calls } = fakeFetch(jsonResponse({ error: "slow" }, 429), jsonResponse({ ok: true }));
    const data = await client({ fetchImpl: impl, maxRetries: 2 }).request("GET", "/x");
    expect(data).toEqual({ ok: true });
    expect(calls.length).toBe(2);
  });

  it("超时：到点 abort，归类为可重试 timeout", async () => {
    let calls = 0;
    const hanging = ((_url: string, init: RequestInit = {}) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as unknown as typeof fetch;
    const err = await client({ fetchImpl: hanging, timeoutMs: 10, maxRetries: 0 })
      .request("GET", "/x")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RetryableVendorError);
    expect((err as VendorError).kind).toBe("timeout");
    expect(calls).toBe(1);
  });

  it("网络错误：默认文案带 operation；关掉后只留供应商标签", async () => {
    const withOp = await client({ fetchImpl: fakeFetch(new TypeError("fetch failed")).impl, maxRetries: 0 })
      .request("POST", "/x")
      .catch((e: unknown) => e);
    expect((withOp as Error).message).toBe("acme POST /x network error: fetch failed");

    const withoutOp = await client({
      fetchImpl: fakeFetch(new TypeError("fetch failed")).impl,
      maxRetries: 0,
      networkErrorOperation: false,
    })
      .request("POST", "/x")
      .catch((e: unknown) => e);
    expect((withoutOp as Error).message).toBe("acme network error: fetch failed");
  });

  it("messagePrefix 覆盖默认文案前缀（DeepSeek 兼容）", async () => {
    const empty = { ok: false, status: 401, text: async () => "" } as unknown as Response;
    const { impl } = fakeFetch(empty);
    const err = await client({ fetchImpl: impl, maxRetries: 0, messagePrefix: "deepseek http " })
      .request("POST", "/chat/completions")
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe("deepseek http 401: (empty body)");
  });

  it("2xx 成功体超过上限：取消响应流、协议错误、不重试", async () => {
    const { response, wasCancelled } = streamResponse(["x".repeat(64)]);
    const { impl, calls } = fakeFetch(response);
    const err = await client({ fetchImpl: impl, maxResponseBytes: 32, maxRetries: 3 })
      .request("GET", "/x")
      .catch((e: unknown) => e);
    expect((err as VendorError).kind).toBe("vendor_error");
    expect((err as VendorError).retryable).toBe(false);
    expect((err as Error).message).toContain("response body exceeds 32 bytes");
    expect(wasCancelled()).toBe(true);
    expect(calls.length).toBe(1);
  });

  it("非 2xx 错误体超过上限：读到上限即取消流", async () => {
    const { response, wasCancelled } = streamResponse(["y".repeat(64), "z".repeat(64)], 500);
    const { impl } = fakeFetch(response);
    const err = await client({ fetchImpl: impl, maxErrorBytes: 16, maxRetries: 0 })
      .request("GET", "/x")
      .catch((e: unknown) => e);
    expect((err as VendorError).kind).toBe("vendor_error");
    expect(wasCancelled()).toBe(true);
  });

  it("正常流式 2xx：分块拼接后解析 JSON（不走 json() 兜底）", async () => {
    const { response } = streamResponse(['{"task_id":', '"t9"}']);
    const data = await client({ fetchImpl: fakeFetch(response).impl }).request("POST", "/x");
    expect(data).toEqual({ task_id: "t9" });
  });

  it("classifyVendorPayloadError：200 + error 体同样走审核驳回判定", () => {
    const err = classifyVendorPayloadError(
      { error: { code: "OutputImageSensitiveContentDetected", message: "sensitive content" } },
      { vendor: "ark", operation: "POST /api/v3/images/generations" },
    );
    expect(err.kind).toBe("output_rejected");
    expect(err.retryable).toBe(false);
  });
});
