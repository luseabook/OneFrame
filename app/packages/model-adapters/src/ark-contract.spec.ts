import { describe, expect, it } from "vitest";
import { ArkVideoAdapter, RetryableVendorError } from "./ark-video";
import type { NormalizedGenRequest } from "./types";

const baseReq: NormalizedGenRequest = {
  task_id: "t-1",
  request: {
    mode: "universal_reference",
    model: "seedance-2.5",
    scene: "storyboard_reference_video",
    input: { prompt: "雨夜街道", reference_uris: ["https://cdn/a.jpg"] },
    options: { ratio: "9:16", resolution: "720p", duration: 5, count: 1 },
  } as unknown as NormalizedGenRequest["request"],
  model: { name: "seedance-2.5", vendor: "volcengine", adapter_code: "volcengine:seedance" },
};

/** 构造一个按调用序列返回的假 fetch */
function fakeFetch(responses: Array<{ status?: number; body?: unknown; throwErr?: Error }>) {
  let i = 0;
  return (async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    if (r.throwErr) throw r.throwErr;
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.body ?? {},
      text: async () => JSON.stringify(r.body ?? {}),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("ArkVideoAdapter", () => {
  const make = (fetchImpl: typeof fetch, extra = {}) =>
    new ArkVideoAdapter({ apiKey: "k", baseUrl: "https://ark.test", retryBaseMs: 1, ...extra }, fetchImpl);

  it("submits with model/content and returns vendor task id", async () => {
    let captured: { url?: string; body?: unknown } = {};
    const f = (async (url: string, init: RequestInit) => {
      captured = { url, body: JSON.parse(String(init.body)) };
      return { ok: true, status: 200, json: async () => ({ id: "vt-1" }), text: async () => "{}" } as unknown as Response;
    }) as unknown as typeof fetch;

    const res = await make(f).submit(baseReq);
    expect(res.vendor_task_id).toBe("vt-1");
    expect(String(captured.url)).toContain("/api/v3/contents/generations/tasks");
    const body = captured.body as { model: string; content: Array<{ type: string }> };
    expect(body.model).toBe("seedance-2.5");
    // 文本 + 参考图各一项
    expect(body.content.filter((c) => c.type === "text").length).toBe(1);
    expect(body.content.filter((c) => c.type === "image_url").length).toBe(1);
  });

  it("maps review_rejected status to review_rejected with output_rejected code", async () => {
    const f = fakeFetch([{ body: { status: "rejected", error: { message: "violence" } } }]);
    const st = await make(f).poll("vt-1");
    expect(st.status).toBe("review_rejected");
    expect(st.error?.code).toBe("output_rejected");
    expect(st.error?.message).toBe("violence");
  });

  it("maps audit_failed alias to review_rejected", async () => {
    const f = fakeFetch([{ body: { status: "audit_failed" } }]);
    const st = await make(f).poll("vt-1");
    expect(st.status).toBe("review_rejected");
    expect(st.error?.code).toBe("output_rejected");
  });

  it("maps failed status to vendor_error code", async () => {
    const f = fakeFetch([{ body: { status: "failed", error: { message: "internal" } } }]);
    const st = await make(f).poll("vt-1");
    expect(st.status).toBe("failed");
    expect(st.error?.code).toBe("vendor_error");
  });

  it("returns running for unknown status (not rejected)", async () => {
    const f = fakeFetch([{ body: { status: "some_new_state" } }]);
    const st = await make(f).poll("vt-1");
    expect(st.status).toBe("running");
    expect(st.error).toBeUndefined();
  });

  it("maps queued/processing correctly", async () => {
    expect((await make(fakeFetch([{ body: { status: "queued" } }])).poll("x")).status).toBe("pending");
    expect((await make(fakeFetch([{ body: { status: "processing" } }])).poll("x")).status).toBe("running");
  });

  it("extracts video_url from content[0], data.video_url or output.video_url", async () => {
    const a = await make(fakeFetch([{ body: { status: "succeeded", content: [{ video_url: "https://v/1.mp4" }] } }])).poll("x");
    expect(a.results?.[0]?.uri).toBe("https://v/1.mp4");

    const b = await make(fakeFetch([{ body: { status: "succeeded", video_url: "https://v/2.mp4" } }])).poll("x");
    expect(b.results?.[0]?.uri).toBe("https://v/2.mp4");

    const c = await make(fakeFetch([{ body: { status: "succeeded", output: { video_url: "https://v/3.mp4" } } }])).poll("x");
    expect(c.results?.[0]?.uri).toBe("https://v/3.mp4");
  });

  it("fails with vendor_error when succeeded but no video_url", async () => {
    const st = await make(fakeFetch([{ body: { status: "succeeded" } }])).poll("x");
    expect(st.status).toBe("failed");
    expect(st.error?.code).toBe("vendor_error");
  });

  it("retries 5xx then succeeds", async () => {
    const f = fakeFetch([{ status: 503, body: { msg: "busy" } }, { body: { id: "vt-retry" } }]);
    const res = await make(f, { maxRetries: 2 }).submit(baseReq);
    expect(res.vendor_task_id).toBe("vt-retry");
  });

  it("does not retry 4xx business errors", async () => {
    let calls = 0;
    const f = (async () => {
      calls += 1;
      return {
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => "bad request",
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(make(f, { maxRetries: 3 }).submit(baseReq)).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });

  it("retries network errors and surfaces RetryableVendorError after exhaustion", async () => {
    const f = fakeFetch([{ throwErr: new TypeError("fetch failed") }]);
    await expect(make(f, { maxRetries: 1 }).submit(baseReq)).rejects.toBeInstanceOf(RetryableVendorError);
  });

  it("retries 429 rate limit", async () => {
    const f = fakeFetch([{ status: 429, body: { msg: "rate" } }, { body: { id: "vt-ok" } }]);
    const res = await make(f, { maxRetries: 1 }).submit(baseReq);
    expect(res.vendor_task_id).toBe("vt-ok");
  });
});
