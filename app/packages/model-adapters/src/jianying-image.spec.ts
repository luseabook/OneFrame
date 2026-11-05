import { describe, expect, it } from "vitest";
import { isVendorError, VendorError } from "./errors";
import {
  JIANYING_IMAGE_PATH,
  JianyingImageAdapter,
  mapJianyingResolution,
  type JianyingImageConfig,
} from "./jianying-image";
import { resolveAdapter } from "./registry";
import type { NormalizedGenRequest } from "./types";

interface RequestOverrides {
  prompt?: string;
  mode?: "text2image" | "image2image" | "multi_reference";
  referenceUris?: string[];
  firstFrameUri?: string;
  ratio?: string;
  resolution?: string;
  count?: number;
  seed?: number | null;
  modelName?: string;
  /** effect / style / mask_uri 等业务侧宽松字段（toolOptionsSchema 之外，故走 override 注入） */
  options?: Record<string, unknown>;
}

function makeRequest(overrides: RequestOverrides = {}): NormalizedGenRequest {
  const modelName = overrides.modelName ?? "jianying-draw";
  return {
    task_id: "t-jy-img-1",
    model: { name: modelName, vendor: "jianying", adapter_code: "jianying:image" },
    request: {
      mode: overrides.mode ?? "text2image",
      model: modelName,
      scene: null,
      input: {
        prompt: overrides.prompt ?? "清晨薄雾里的江南水乡，写实摄影",
        reference_uris: overrides.referenceUris ?? [],
        first_frame_uri: overrides.firstFrameUri,
      },
      options: {
        ratio: overrides.ratio ?? "1:1",
        resolution: overrides.resolution ?? "1K",
        duration: 5,
        count: overrides.count ?? 1,
        enable_audio: true,
        mouth_drive: false,
        seed: overrides.seed ?? null,
        ...(overrides.options ?? {}),
      },
    } as unknown as NormalizedGenRequest["request"],
  };
}

interface FakeResponse {
  status?: number;
  body?: unknown;
  rawText?: string;
  throwErr?: Error;
}

/** 假 fetch：按调用序列返回，并记录每次请求（url + init）；照 ark-image.spec.ts 的替身写法 */
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

function makeAdapter(fetchImpl: typeof fetch, extra: Partial<JianyingImageConfig> = {}) {
  return new JianyingImageAdapter({ baseUrl: "http://127.0.0.1:8788", retryBaseMs: 1, ...extra }, fetchImpl);
}

const okImage = (extra: Record<string, unknown> = {}) => ({
  created: 1_700_000_000,
  data: [
    {
      url: "http://127.0.0.1:8788/files/1.png",
      size: "1024x1024",
      revised_prompt: "晨雾水乡",
      watermark_removed: false,
    },
  ],
  ...extra,
});

describe("JianyingImageAdapter 出站协议（文生图/图生图）", () => {
  it("POSTs /v1/images/generations（同步接口）并按 OpenAI 兼容字段下发", async () => {
    const { impl, calls } = fakeFetch([{ body: okImage() }]);
    const adapter = makeAdapter(impl, { apiKey: "gw-key", modelMap: { "jianying-draw": "jianying-style-301" } });
    const res = await adapter.submit(makeRequest({ count: 2 }));

    expect(res.sync_results?.length).toBe(1);
    // 同步协议：绝不返回 vendor_task_id（网关没有任务概念）
    expect(res.vendor_task_id).toBeUndefined();
    expect(calls.length).toBe(1);
    const call = calls[0]!;
    expect(call.url).toBe(`http://127.0.0.1:8788${JIANYING_IMAGE_PATH}`);
    expect(call.method).toBe("POST");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.headers.authorization).toBe("Bearer gw-key");
    expect(call.body).toMatchObject({
      model: "jianying-style-301",
      prompt: "清晨薄雾里的江南水乡，写实摄影",
      aspect_ratio: "1:1",
      resolution: "1k",
      n: 2,
      response_format: "url",
      fit: "crop",
      watermark: "keep",
    });
    // 文生图不带参考图 / effect
    expect(call.body).not.toHaveProperty("reference_image");
    expect(call.body).not.toHaveProperty("effect");
  });

  it("水印：默认下发 keep；removeUpstreamWatermark 显式开启才发 remove", async () => {
    const keep = fakeFetch([{ body: okImage() }]);
    await makeAdapter(keep.impl).submit(makeRequest());
    expect(keep.calls[0]!.body.watermark).toBe("keep");

    const remove = fakeFetch([{ body: okImage() }]);
    await makeAdapter(remove.impl, { removeUpstreamWatermark: true }).submit(makeRequest());
    expect(remove.calls[0]!.body.watermark).toBe("remove");
  });

  it("图生图：reference_image + effect 走同一个 JSON 接口（不需要 multipart）", async () => {
    const { impl, calls } = fakeFetch([{ body: okImage() }, { body: okImage() }]);
    const adapter = makeAdapter(impl);

    // 首帧优先于 reference_uris[0]（与 ark-image 的 imageReferences 一致）
    await adapter.submit(
      makeRequest({
        mode: "image2image",
        firstFrameUri: "https://cdn.example.com/upload/first.png",
        referenceUris: ["https://cdn.example.com/ref/other.png"],
        options: { effect: "301", style: ["401"] },
      }),
    );
    expect(calls[0]!.url).toBe(`http://127.0.0.1:8788${JIANYING_IMAGE_PATH}`);
    expect(calls[0]!.body.reference_image).toBe("https://cdn.example.com/upload/first.png");
    expect(calls[0]!.body.effect).toBe("301");
    expect(calls[0]!.body.style).toEqual(["401"]);

    // effect_id 别名同样认；style 单值字符串直接下发
    await adapter.submit(
      makeRequest({
        mode: "image2image",
        referenceUris: ["https://cdn.example.com/ref/a.png"],
        options: { effect_id: "101", style: "201" },
      }),
    );
    expect(calls[1]!.body).toMatchObject({
      reference_image: "https://cdn.example.com/ref/a.png",
      effect: "101",
      style: "201",
    });
  });

  it("图生图缺 options.effect → vendorParamError（不静默落到网关默认「3D 童话」风格）", async () => {
    const { impl, calls } = fakeFetch([{ body: okImage() }]);
    const err = await makeAdapter(impl)
      .submit(makeRequest({ mode: "image2image", referenceUris: ["https://cdn.example.com/ref/a.png"] }))
      .catch((e: unknown) => e);

    expect(isVendorError(err)).toBe(true);
    expect((err as VendorError).kind).toBe("invalid_param");
    expect((err as Error).message).toContain("options.effect");
    // 护栏必须在打网络之前生效
    expect(calls.length).toBe(0);
  });

  it("mask（mask_uri / 第二张参考图）显式拒收，绝不静默丢弃", async () => {
    // 第二张参考图在既有约定里是「蒙版位」（brush-repaint → image-inpaint），
    // 网关本批未接线蒙版：静默丢弃会变成「用户以为局部重绘、实际整图重绘还计费」。
    const { impl, calls } = fakeFetch([{ body: okImage() }]);
    const adapter = makeAdapter(impl);

    const byOption = await adapter
      .submit(makeRequest({ mode: "image2image", referenceUris: ["https://cdn.example.com/ref/a.png"], options: { effect: "301", mask_uri: "https://cdn.example.com/mask.png" } }))
      .catch((e: unknown) => e);
    expect(isVendorError(byOption)).toBe(true);
    expect((byOption as VendorError).kind).toBe("invalid_param");
    expect((byOption as Error).message).toContain("docs/02-architecture/jianying-gateway-integration.md");

    const bySecondRef = await adapter
      .submit(
        makeRequest({
          mode: "multi_reference",
          referenceUris: ["https://cdn.example.com/ref/a.png", "https://cdn.example.com/mask.png"],
          options: { effect: "301" },
        }),
      )
      .catch((e: unknown) => e);
    expect(isVendorError(bySecondRef)).toBe(true);
    expect((bySecondRef as Error).message).toContain("mask");
    expect(calls.length).toBe(0);
  });

  it("seed 不下发（网关 schema 收字段但上游不消费，避免误以为可复现）", async () => {
    const { impl, calls } = fakeFetch([{ body: okImage() }]);
    await makeAdapter(impl).submit(makeRequest({ seed: 1234 }));
    expect(calls[0]!.body).not.toHaveProperty("seed");
  });

  it("resolution 收敛：1K→1k；视频档位 720p 不下发（交给网关默认）", async () => {
    expect(mapJianyingResolution("1K")).toBe("1k");
    expect(mapJianyingResolution("2k")).toBe("2k");
    expect(mapJianyingResolution("1080p")).toBe("2k");
    expect(mapJianyingResolution("1536")).toBe("1536");
    expect(mapJianyingResolution("720p")).toBeUndefined();

    const { impl, calls } = fakeFetch([{ body: okImage() }]);
    await makeAdapter(impl).submit(makeRequest({ resolution: "720p" }));
    expect(calls[0]!.body).not.toHaveProperty("resolution");
  });

  it("prompt 与参考图都为空 → vendorParamError（不打网络）", async () => {
    const { impl, calls } = fakeFetch([{ body: okImage() }]);
    const err = await makeAdapter(impl)
      .submit(makeRequest({ prompt: "   ", referenceUris: [] }))
      .catch((e: unknown) => e);
    expect(isVendorError(err)).toBe(true);
    expect((err as VendorError).kind).toBe("invalid_param");
    expect((err as Error).message).toContain("input.prompt or reference image");
    expect(calls.length).toBe(0);
  });
});

describe("JianyingImageAdapter 结果解析", () => {
  it("解析 data[].size → width/height，并透传 meta（size / watermark_removed）", async () => {
    const { impl } = fakeFetch([
      {
        body: {
          created: 1_700_000_000,
          data: [{ url: "http://127.0.0.1:8788/files/wide.png", size: "1792x1024", watermark_removed: true }],
        },
      },
    ]);
    const res = await makeAdapter(impl).submit(makeRequest({ ratio: "16:9" }));
    const first = res.sync_results![0]!;
    expect(first.uri).toBe("http://127.0.0.1:8788/files/wide.png");
    expect(first.width).toBe(1792);
    expect(first.height).toBe(1024);
    expect(first.meta).toMatchObject({
      vendor: "jianying",
      size: "1792x1024",
      watermark_removed: true,
    });
  });

  it("b64_json 兜底转 data URI（meta.inline_base64 = true）", async () => {
    const { impl } = fakeFetch([{ body: { created: 1, data: [{ b64_json: "QUJD", size: "1024x1024" }] } }]);
    const res = await makeAdapter(impl).submit(makeRequest());
    expect(res.sync_results?.[0]?.uri).toBe("data:image/png;base64,QUJD");
    expect(res.sync_results?.[0]?.meta?.inline_base64).toBe(true);
    expect(res.sync_results?.[0]?.width).toBe(1024);
  });

  it("200 但 data 为空 → vendor_error（不重试）", async () => {
    const { impl, calls } = fakeFetch([{ body: { created: 1, data: [] } }]);
    const err = await makeAdapter(impl, { maxRetries: 2 })
      .submit(makeRequest())
      .catch((e: unknown) => e);
    expect((err as VendorError).kind).toBe("vendor_error");
    expect((err as Error).message).toContain("no image data");
    expect(calls.length).toBe(1);
  });

  it("200 但响应体带 error → classifyVendorPayloadError（vendor_error，不重试）", async () => {
    const { impl, calls } = fakeFetch([
      { body: { error: { message: "upstream returned empty image", type: "upstream_error", code: "EMPTY_IMAGE" } } },
    ]);
    const err = await makeAdapter(impl, { maxRetries: 2 })
      .submit(makeRequest())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VendorError);
    expect((err as VendorError).kind).toBe("vendor_error");
    expect((err as Error).message).toContain("upstream returned empty image");
    expect(calls.length).toBe(1);
  });
});

describe("JianyingImageAdapter 错误映射 / 同步语义守卫", () => {
  it("502 upstream_error → VendorError（kind=vendor_error）", async () => {
    const { impl, calls } = fakeFetch([
      { status: 502, body: { error: { message: "upstream 502", type: "upstream_error" } } },
    ]);
    const err = await makeAdapter(impl, { maxRetries: 0 })
      .submit(makeRequest())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VendorError);
    expect((err as VendorError).kind).toBe("vendor_error");
    expect((err as Error).message).toContain("502");
    expect(calls.length).toBe(1);
  });

  it("401 authentication_error → auth_error（不重试）", async () => {
    const { impl, calls } = fakeFetch([
      { status: 401, body: { error: { message: "invalid api key", type: "authentication_error" } } },
    ]);
    const err = await makeAdapter(impl, { maxRetries: 3 })
      .submit(makeRequest())
      .catch((e: unknown) => e);
    expect((err as VendorError).kind).toBe("auth_error");
    expect(calls.length).toBe(1);
  });

  it("poll() 直接抛 vendorProtocolError（防误配进轮询路径变无限轮询）", async () => {
    const { impl, calls } = fakeFetch([{ body: okImage() }]);
    const err = await makeAdapter(impl)
      .poll("any-task-id")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VendorError);
    expect((err as VendorError).kind).toBe("vendor_error");
    expect((err as Error).message).toContain("synchronous");
    expect((err as Error).message).toContain("poll is not supported");
    expect(calls.length).toBe(0);
  });

  it("cancel() 是 no-op（同步接口无取消语义，不发网络请求）", async () => {
    const { impl, calls } = fakeFetch([{ body: okImage() }]);
    await expect(makeAdapter(impl).cancel("any-task-id")).resolves.toBeUndefined();
    expect(calls.length).toBe(0);
  });
});

describe("registry：剪影生图网关选择", () => {
  it("adapterHint=jianying-image + jianyingImage.baseUrl → JianyingImageAdapter", () => {
    const adapter = resolveAdapter("tomoviee:image", {
      mode: "real",
      jianyingImage: { baseUrl: "http://127.0.0.1:8788" },
      adapterHint: "jianying-image",
    });
    expect(adapter).toBeInstanceOf(JianyingImageAdapter);
    expect(adapter.vendor).toBe("jianying");
  });

  it("hint 命中但缺 baseUrl → 显式报错，不静默 mock", () => {
    expect(() => resolveAdapter("tomoviee:image", { mode: "real", adapterHint: "jianying-image" })).toThrow(
      /jianying image adapter requires base_url/,
    );
  });

  it("自建档直接写 code=jianying:image 时无 hint 也能命中；缺配置同样硬失败", () => {
    const adapter = resolveAdapter("jianying:image", {
      mode: "real",
      jianyingImage: { baseUrl: "http://127.0.0.1:8788" },
    });
    expect(adapter).toBeInstanceOf(JianyingImageAdapter);
    expect(() => resolveAdapter("jianying:image", { mode: "real" })).toThrow(/jianying image adapter requires base_url/);
  });
});