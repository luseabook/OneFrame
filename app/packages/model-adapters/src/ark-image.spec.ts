import { describe, expect, it } from "vitest";
import { ARK_IMAGE_PATH, ARK_IMAGE_TASK_PATH, ArkImageAdapter, mapArkImageSize, type ArkImageConfig } from "./ark-image";
import { RetryableVendorError, VendorError, isVendorError } from "./errors";
import { MockAdapter } from "./mock";
import { resolveAdapter } from "./registry";
import type { NormalizedGenRequest } from "./types";

function makeRequest(overrides: {
  prompt?: string;
  referenceUris?: string[];
  firstFrameUri?: string;
  ratio?: string;
  resolution?: string;
  count?: number;
  seed?: number | null;
  mode?: "text2image" | "image2image" | "multi_reference";
  modelName?: string;
} = {}): NormalizedGenRequest {
  return {
    task_id: "t-img-1",
    model: {
      name: overrides.modelName ?? "seedream-3.0",
      vendor: "volcengine",
      adapter_code: "volcengine:image",
    },
    request: {
      mode: overrides.mode ?? "text2image",
      model: overrides.modelName ?? "seedream-3.0",
      scene: null,
      input: {
        prompt: overrides.prompt ?? "雨夜霓虹街头，赛博朋克风格",
        reference_uris: overrides.referenceUris ?? [],
        first_frame_uri: overrides.firstFrameUri,
      },
      options: {
        ratio: overrides.ratio ?? "1:1",
        resolution: overrides.resolution ?? "720p",
        duration: 5,
        count: overrides.count ?? 1,
        enable_audio: true,
        mouth_drive: false,
        seed: overrides.seed ?? null,
      },
    },
  };
}

interface FakeResponse {
  status?: number;
  body?: unknown;
  rawText?: string;
  throwErr?: Error;
}

/** 假 fetch：按调用序列返回，并记录每次请求（url + init） */
function fakeFetch(responses: FakeResponse[]) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  let index = 0;
  const impl = (async (url: string, init: RequestInit = {}) => {
    const response = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    calls.push({
      url: String(url),
      method: String(init.method ?? "GET"),
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

function makeAdapter(fetchImpl: typeof fetch, extra: Partial<ArkImageConfig> = {}) {
  return new ArkImageAdapter({ apiKey: "ark-key", baseUrl: "https://ark.test", retryBaseMs: 1, ...extra }, fetchImpl);
}

const okImage = (extra: Record<string, unknown> = {}) => ({
  model: "doubao-seedream-3-0-t2i-250415",
  created: 1_700_000_000,
  data: [{ url: "https://ark.test/img/1.png", size: "1024x1024" }],
  usage: { generated_images: 1, total_tokens: 100 },
  ...extra,
});

describe("ArkImageAdapter 出站协议（文生图/图生图）", () => {
  it("POSTs /api/v3/images/generations with Bearer auth and documented fields", async () => {
    const { impl, calls } = fakeFetch([{ body: okImage() }]);
    const adapter = makeAdapter(impl, { modelMap: { "seedream-3.0": "ep-img-123" } });
    const res = await adapter.submit(makeRequest());

    expect(res.sync_results?.length).toBe(1);
    expect(calls.length).toBe(1);
    const call = calls[0]!;
    expect(call.url).toBe(`https://ark.test${ARK_IMAGE_PATH}`);
    expect(call.method).toBe("POST");
    expect(call.headers.authorization).toBe("Bearer ark-key");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.body).toMatchObject({
      model: "ep-img-123",
      prompt: "雨夜霓虹街头，赛博朋克风格",
      size: "1024x1024",
      response_format: "url",
      watermark: true,
    });
    // 文生图不携带 image 字段
    expect(call.body).not.toHaveProperty("image");
  });

  it("文生图：seed/guidance_scale 仅在配置/请求给出时发送", async () => {
    const { impl, calls } = fakeFetch([{ body: okImage() }, { body: okImage() }]);
    await makeAdapter(impl).submit(makeRequest({ seed: 1234 }));
    expect(calls[0]!.body.seed).toBe(1234);
    expect(calls[0]!.body).not.toHaveProperty("guidance_scale");

    await makeAdapter(impl, { guidanceScale: 2.5 }).submit(makeRequest());
    expect(calls[1]!.body.guidance_scale).toBe(2.5);
    expect(calls[1]!.body).not.toHaveProperty("seed");
  });

  it("图生图：单张参考图传 image 字符串；首帧 + 多参考图去重后传数组", async () => {
    const single = fakeFetch([{ body: okImage() }]);
    await makeAdapter(single.impl).submit(
      makeRequest({ mode: "image2image", referenceUris: ["https://cdn/ref-a.png"] }),
    );
    expect(single.calls[0]!.body.image).toBe("https://cdn/ref-a.png");

    const multi = fakeFetch([{ body: okImage() }]);
    await makeAdapter(multi.impl).submit(
      makeRequest({
        mode: "multi_reference",
        firstFrameUri: "https://cdn/first.png",
        referenceUris: ["https://cdn/ref-a.png", "https://cdn/first.png"],
      }),
    );
    expect(multi.calls[0]!.body.image).toEqual(["https://cdn/first.png", "https://cdn/ref-a.png"]);
  });

  it("count>1 时开启 sequential_image_generation 并限制 max_images", async () => {
    const { impl, calls } = fakeFetch([{ body: okImage() }]);
    await makeAdapter(impl).submit(makeRequest({ count: 3 }));
    expect(calls[0]!.body.sequential_image_generation).toBe("auto");
    expect(calls[0]!.body.sequential_image_generation_options).toEqual({ max_images: 3 });

    const one = fakeFetch([{ body: okImage() }]);
    await makeAdapter(one.impl).submit(makeRequest({ count: 1 }));
    expect(one.calls[0]!.body).not.toHaveProperty("sequential_image_generation");
  });

  it("业务 resolution/ratio → Ark size 映射", () => {
    expect(mapArkImageSize("9:16", "720p")).toBe("720x1280");
    expect(mapArkImageSize("16:9", "720p")).toBe("1280x720");
    expect(mapArkImageSize("1:1", "720p")).toBe("1024x1024");
    expect(mapArkImageSize("4:3", "720p")).toBe("1152x864");
    expect(mapArkImageSize("9:16", "1080p")).toBe("2K");
    expect(mapArkImageSize("9:16", "2K")).toBe("2K");
    expect(mapArkImageSize("16:9", "4k")).toBe("4K");
    // 显式像素尺寸直通
    expect(mapArkImageSize("1:1", "1536x1024")).toBe("1536x1024");
    // 未知比例回落默认尺寸
    expect(mapArkImageSize("7:5", "720p")).toBe("1024x1024");
  });

  it("缺少 prompt 且无参考图时提交前显式失败（不打网络）", async () => {
    const { impl, calls } = fakeFetch([{ body: okImage() }]);
    const err = await makeAdapter(impl)
      .submit(makeRequest({ prompt: "", referenceUris: [] }))
      .catch((e: unknown) => e);
    expect(isVendorError(err)).toBe(true);
    expect((err as VendorError).kind).toBe("invalid_param");
    expect(calls.length).toBe(0);
  });
});

describe("ArkImageAdapter 结果解析", () => {
  it("解析 data[].url（宽度/高度/usage 透传）", async () => {
    const { impl } = fakeFetch([{ body: okImage() }]);
    const res = await makeAdapter(impl).submit(makeRequest());
    const first = res.sync_results![0]!;
    expect(first.uri).toBe("https://ark.test/img/1.png");
    expect(first.width).toBe(1024);
    expect(first.height).toBe(1024);
    expect(first.meta?.usage).toMatchObject({ generated_images: 1 });
  });

  it("解析多图（sequential 输出多张）", async () => {
    const { impl } = fakeFetch([
      {
        body: okImage({
          data: [
            { url: "https://ark.test/img/1.png", size: "1024x1024" },
            { url: "https://ark.test/img/2.png", size: "1024x1024" },
            { url: "https://ark.test/img/3.png", size: "1024x1024" },
          ],
        }),
      },
    ]);
    const res = await makeAdapter(impl).submit(makeRequest({ count: 3 }));
    expect(res.sync_results?.map((r) => r.uri)).toEqual([
      "https://ark.test/img/1.png",
      "https://ark.test/img/2.png",
      "https://ark.test/img/3.png",
    ]);
  });

  it("解析 b64_json 为 data URI（兜底路径）", async () => {
    const { impl } = fakeFetch([{ body: { data: [{ b64_json: "QUJD", size: "1024x1024" }] } }]);
    const res = await makeAdapter(impl).submit(makeRequest());
    expect(res.sync_results?.[0]?.uri).toBe("data:image/png;base64,QUJD");
    expect(res.sync_results?.[0]?.meta?.inline_base64).toBe(true);
  });

  it("同步 200 但无图 → vendor_error（不重试）", async () => {
    const { impl, calls } = fakeFetch([{ body: { data: [] } }]);
    const err = await makeAdapter(impl, { maxRetries: 2 })
      .submit(makeRequest())
      .catch((e: unknown) => e);
    expect((err as VendorError).kind).toBe("vendor_error");
    expect((err as Error).message).toContain("no image data");
    expect(calls.length).toBe(1);
  });

  it("200 + error 体（同步审核拒绝）→ output_rejected", async () => {
    const { impl } = fakeFetch([
      { body: { error: { code: "OutputImageSensitiveContentDetected", message: "sensitive output" } } },
    ]);
    const err = await makeAdapter(impl)
      .submit(makeRequest())
      .catch((e: unknown) => e);
    expect((err as VendorError).kind).toBe("output_rejected");
    expect((err as VendorError).retryable).toBe(false);
  });
});

describe("ArkImageAdapter 异步任务兜底（返回 task id 时）", () => {
  it("submit 返回 vendor_task_id，poll 走任务接口并归一化状态", async () => {
    const { impl, calls } = fakeFetch([
      { body: { id: "img-task-1" } },
      { body: { id: "img-task-1", status: "queued" } },
      { body: { id: "img-task-1", status: "processing" } },
      {
        body: {
          id: "img-task-1",
          status: "succeeded",
          content: [{ type: "image_url", image_url: { url: "https://ark.test/img/async.png" } }],
        },
      },
    ]);
    const adapter = makeAdapter(impl);
    const submitted = await adapter.submit(makeRequest());
    expect(submitted.vendor_task_id).toBe("img-task-1");

    expect((await adapter.poll("img-task-1")).status).toBe("pending");
    expect((await adapter.poll("img-task-1")).status).toBe("running");
    const done = await adapter.poll("img-task-1");
    expect(done.status).toBe("succeeded");
    expect(done.results?.[0]?.uri).toBe("https://ark.test/img/async.png");
    expect(calls[1]!.url).toBe(`https://ark.test${ARK_IMAGE_TASK_PATH}/img-task-1`);
    expect(calls[1]!.method).toBe("GET");
  });

  it("审核驳回状态 → review_rejected / output_rejected", async () => {
    const { impl } = fakeFetch([{ body: { status: "rejected", error: { message: "violence" } } }]);
    const state = await makeAdapter(impl).poll("t");
    expect(state.status).toBe("review_rejected");
    expect(state.error?.code).toBe("output_rejected");
    expect(state.error?.message).toBe("violence");
  });

  it("失败且错误码含审核信号 → review_rejected；其他失败 → vendor_error", async () => {
    const rejected = await makeAdapter(
      fakeFetch([{ body: { status: "failed", error: { code: "AuditFailed", message: "不合规" } } }]).impl,
    ).poll("t");
    expect(rejected.status).toBe("review_rejected");
    expect(rejected.error?.code).toBe("output_rejected");

    const failed = await makeAdapter(
      fakeFetch([{ body: { status: "failed", error: { code: "InternalError", message: "boom" } } }]).impl,
    ).poll("t");
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("InternalError");
  });

  it("成功但无图 → vendor_error", async () => {
    const state = await makeAdapter(fakeFetch([{ body: { status: "succeeded", content: [] } }]).impl).poll("t");
    expect(state.status).toBe("failed");
    expect(state.error?.code).toBe("vendor_error");
  });
});

describe("ArkImageAdapter 错误映射与重试边界", () => {
  it("401 鉴权失败：auth_error，不重试", async () => {
    const { impl, calls } = fakeFetch([
      { status: 401, body: { error: { code: "AuthenticationError", message: "invalid api key" } } },
    ]);
    const err = await makeAdapter(impl, { maxRetries: 3 })
      .submit(makeRequest())
      .catch((e: unknown) => e);
    expect((err as VendorError).kind).toBe("auth_error");
    expect((err as VendorError).retryable).toBe(false);
    expect((err as Error).message).toContain("401");
    expect(calls.length).toBe(1);
  });

  it("429 限流：退避后重试成功", async () => {
    const { impl, calls } = fakeFetch([
      { status: 429, body: { error: { code: "RateLimitExceeded", message: "slow down" } } },
      { body: okImage() },
    ]);
    const res = await makeAdapter(impl, { maxRetries: 2 }).submit(makeRequest());
    expect(res.sync_results?.length).toBe(1);
    expect(calls.length).toBe(2);
  });

  it("400 参数错误：invalid_param，不重试", async () => {
    const { impl, calls } = fakeFetch([
      { status: 400, body: { error: { code: "InvalidParameter", message: "size is invalid" } } },
    ]);
    const err = await makeAdapter(impl, { maxRetries: 3 })
      .submit(makeRequest())
      .catch((e: unknown) => e);
    expect((err as VendorError).kind).toBe("invalid_param");
    expect((err as Error).message).toContain("400");
    expect(calls.length).toBe(1);
  });

  it("400 + 审核码：output_rejected，不重试", async () => {
    const { impl, calls } = fakeFetch([
      {
        status: 400,
        body: { error: { code: "OutputImageSensitiveContentDetected", message: "sensitive" } },
      },
    ]);
    const err = await makeAdapter(impl, { maxRetries: 3 })
      .submit(makeRequest())
      .catch((e: unknown) => e);
    expect((err as VendorError).kind).toBe("output_rejected");
    expect(calls.length).toBe(1);
  });

  it("5xx：重试耗尽后抛 RetryableVendorError（调用次数 = maxRetries+1）", async () => {
    const { impl, calls } = fakeFetch([{ status: 503, body: { error: { message: "busy" } } }]);
    await expect(makeAdapter(impl, { maxRetries: 2 }).submit(makeRequest())).rejects.toBeInstanceOf(
      RetryableVendorError,
    );
    expect(calls.length).toBe(3);
  });

  it("网络错误：重试耗尽后抛 RetryableVendorError", async () => {
    const { impl, calls } = fakeFetch([{ throwErr: new TypeError("fetch failed") }]);
    await expect(makeAdapter(impl, { maxRetries: 1 }).submit(makeRequest())).rejects.toBeInstanceOf(
      RetryableVendorError,
    );
    expect(calls.length).toBe(2);
  });

  it("超时：AbortController 触发后归一化为 timeout 且可重试", async () => {
    // fetch 永不返回，等 signal abort 后抛 AbortError
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
      .submit(makeRequest())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RetryableVendorError);
    expect((err as VendorError).kind).toBe("timeout");
    expect(calls).toBe(1);
  });
});

describe("registry：Ark 图像选择", () => {
  const arkVideoConfig = { apiKey: "ark-key", baseUrl: "https://ark.test", modelMap: {} };

  it("Ark 已配置时 volcengine:image / volcengine:seedream 走 ArkImageAdapter", () => {
    for (const code of ["volcengine:image", "volcengine:seedream"]) {
      expect(resolveAdapter(code, { mode: "real", ark: arkVideoConfig })).toBeInstanceOf(ArkImageAdapter);
    }
  });

  it("显式 arkImageCodes 可把 tomoviee:image 指向 Ark 图像", () => {
    const adapter = resolveAdapter("tomoviee:image", {
      mode: "real",
      ark: arkVideoConfig,
      arkImageCodes: ["tomoviee:image"],
    });
    expect(adapter).toBeInstanceOf(ArkImageAdapter);
  });

  it("arkImageCodes 指向但缺 Ark Key → 显式报错，不静默 mock", () => {
    expect(() =>
      resolveAdapter("tomoviee:image", { mode: "real", arkImageCodes: ["tomoviee:image"] }),
    ).toThrow(/ARK_API_KEY/);
  });

  it("未配置 arkImageCodes 时 tomoviee:image 保持原有显式报错", () => {
    expect(() => resolveAdapter("tomoviee:image", { mode: "real", ark: arkVideoConfig })).toThrow(
      /vendor adapter not implemented yet: tomoviee:image/,
    );
  });

  it("arkImage 独立配置优先于 ark（可用不同 Base URL/模型映射）", () => {
    expect(
      resolveAdapter("volcengine:image", {
        mode: "real",
        arkImage: { apiKey: "img-key", baseUrl: "https://img.test" },
      }),
    ).toBeInstanceOf(ArkImageAdapter);
  });

  it("mock 模式仍返回 MockAdapter（不依赖 Key）", () => {
    expect(resolveAdapter("tomoviee:image", { mode: "mock" })).toBeInstanceOf(MockAdapter);
  });
});
