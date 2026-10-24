import { describe, expect, it } from "vitest";
import { DeepSeekChatAdapter, type DeepSeekConfig } from "./deepseek";
import { RetryableVendorError, VendorError } from "./errors";
import type { NormalizedGenRequest } from "./types";

const messages = [{ role: "user" as const, content: "写一个三集大纲" }];

interface FakeResponse {
  status?: number;
  body?: unknown;
  rawText?: string;
  throwErr?: Error;
}

function fakeFetch(responses: FakeResponse[]) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  let index = 0;
  const impl = (async (url: string, init: RequestInit = {}) => {
    const response = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    calls.push({
      url: String(url),
      headers: { ...(init.headers as Record<string, string>) },
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    if (response.throwErr) throw response.throwErr;
    const status = response.status ?? 200;
    const text = response.rawText ?? JSON.stringify(response.body ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(text),
      text: async () => text,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function makeAdapter(fetchImpl: typeof fetch, extra: Partial<DeepSeekConfig> = {}) {
  return new DeepSeekChatAdapter({ apiKey: "k", baseUrl: "https://ds.test", retryBaseMs: 1, ...extra }, fetchImpl);
}

const okBody = { choices: [{ message: { content: "第一集：开端" } }], usage: { total_tokens: 42 } };

const baseRequest: NormalizedGenRequest = {
  task_id: "t-ds-1",
  model: { name: "deepseek-v4-pro", vendor: "deepseek", adapter_code: "deepseek:chat" },
  request: {
    mode: "text2image",
    model: "deepseek-v4-pro",
    scene: null,
    input: { prompt: "写一个三集大纲", reference_uris: [] },
    options: {
      ratio: "9:16",
      resolution: "720p",
      duration: 5,
      count: 1,
      enable_audio: true,
      mouth_drive: false,
      seed: null,
    },
  },
};

describe("DeepSeek 错误分层契约", () => {
  it("401 鉴权失败：auth_error 且不重试", async () => {
    const { impl, calls } = fakeFetch([
      { status: 401, body: { error: { code: "AuthenticationError", message: "invalid api key" } } },
    ]);
    const err = await makeAdapter(impl, { maxRetries: 3 })
      .chat(messages)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VendorError);
    expect((err as VendorError).kind).toBe("auth_error");
    expect((err as VendorError).retryable).toBe(false);
    expect((err as Error).message).toMatch(/deepseek http 401/);
    expect(calls.length).toBe(1);
  });

  it("402 余额不足：quota_exceeded 且不重试", async () => {
    const { impl, calls } = fakeFetch([{ status: 402, body: { error: { message: "Insufficient Balance" } } }]);
    const err = await makeAdapter(impl, { maxRetries: 3 })
      .chat(messages)
      .catch((e: unknown) => e);
    expect((err as VendorError).kind).toBe("quota_exceeded");
    expect((err as VendorError).retryable).toBe(false);
    expect(calls.length).toBe(1);
  });

  it("429 限流：重试后成功", async () => {
    const { impl, calls } = fakeFetch([
      { status: 429, body: { error: { code: "RateLimitExceeded", message: "slow down" } } },
      { body: okBody },
    ]);
    const result = await makeAdapter(impl, { maxRetries: 2 }).chat(messages);
    expect(result.text).toBe("第一集：开端");
    expect(result.usage).toEqual({ total_tokens: 42 });
    expect(calls.length).toBe(2);
  });

  it("5xx：重试耗尽后抛 RetryableVendorError（次数 = maxRetries+1）", async () => {
    const { impl, calls } = fakeFetch([{ status: 500, body: { error: "boom" } }]);
    await expect(makeAdapter(impl, { maxRetries: 2 }).chat(messages)).rejects.toBeInstanceOf(RetryableVendorError);
    expect(calls.length).toBe(3);
  });

  it("超时（AbortError）→ RetryableVendorError kind=timeout", async () => {
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

    const err = await makeAdapter(hanging, { timeoutMs: 10, maxRetries: 0 })
      .chat(messages)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RetryableVendorError);
    expect((err as VendorError).kind).toBe("timeout");
    expect(calls).toBe(1);
  });

  it("网络错误（fetch TypeError）→ RetryableVendorError", async () => {
    const { impl, calls } = fakeFetch([{ throwErr: new TypeError("fetch failed") }]);
    await expect(makeAdapter(impl, { maxRetries: 1 }).chat(messages)).rejects.toBeInstanceOf(RetryableVendorError);
    expect(calls.length).toBe(2);
  });

  it("响应缺 choices[0].message.content → 明确错误且不重试", async () => {
    const { impl, calls } = fakeFetch([{ body: { choices: [] } }]);
    const err = await makeAdapter(impl, { maxRetries: 2 })
      .chat(messages)
      .catch((e: unknown) => e);
    expect((err as Error).message).toContain("missing choices[0].message.content");
    expect((err as VendorError).retryable).toBe(false);
    expect(calls.length).toBe(1);
  });

  it("2xx 但响应不是 JSON → 明确协议错误", async () => {
    const { impl } = fakeFetch([{ status: 200, rawText: "<html>gateway</html>" }]);
    const err = await makeAdapter(impl)
      .chat(messages)
      .catch((e: unknown) => e);
    expect((err as Error).message).toContain("not valid json");
    expect((err as VendorError).retryable).toBe(false);
  });

  it("错误信息不泄露完整响应体", async () => {
    const tail = "TAIL_MARKER_SHOULD_NOT_LEAK";
    const { impl } = fakeFetch([
      { status: 500, rawText: JSON.stringify({ error: { code: "Boom", message: `${"x".repeat(5000)}${tail}` } }) },
    ]);
    const err = await makeAdapter(impl, { maxRetries: 0 })
      .chat(messages)
      .catch((e: unknown) => e);
    expect((err as Error).message.length).toBeLessThan(400);
    expect((err as Error).message).not.toContain(tail);
  });

  it("缺少 prompt 时提交前失败（不打网络）", async () => {
    const { impl, calls } = fakeFetch([{ body: okBody }]);
    const err = await makeAdapter(impl)
      .submit({ ...baseRequest, request: { ...baseRequest.request, input: { ...baseRequest.request.input, prompt: "" } } })
      .catch((e: unknown) => e);
    expect((err as VendorError).kind).toBe("invalid_param");
    expect(calls.length).toBe(0);
  });

  it("成功时保持既有文案与鉴权头（回归）", async () => {
    const { impl, calls } = fakeFetch([{ body: okBody }]);
    const res = await makeAdapter(impl, { model: "deepseek-chat" }).submit(baseRequest);
    expect(res.sync_results?.[0]?.text).toBe("第一集：开端");
    expect(calls[0]!.headers.authorization).toBe("Bearer k");
    expect(calls[0]!.url).toBe("https://ds.test/chat/completions");
    expect(calls[0]!.body.model).toBe("deepseek-chat");
  });
});
