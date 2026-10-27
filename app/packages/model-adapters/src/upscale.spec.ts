import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UPSCALE_DEFAULT_TARGET, UpscaleAdapter } from "./upscale";
import type { NormalizedGenRequest } from "./types";

const request = (overrides: Record<string, unknown> = {}, refs: string[] = ["https://x/src.mp4"]): NormalizedGenRequest => ({
  task_id: "t-up-1",
  model: { name: "upscale-vendor-1", vendor: "upscale", adapter_code: "upscale" },
  request: {
    mode: "tts",
    model: "upscale-vendor-1",
    scene: null,
    input: { prompt: "", reference_uris: refs },
    options: { ratio: "16:9", resolution: "1080p", duration: 5, count: 1, ...overrides },
  } as NormalizedGenRequest["request"],
});

describe("UpscaleAdapter 构造契约", () => {
  it("real 模式缺 apiKey → 构造即抛错", () => {
    expect(() => new UpscaleAdapter({})).toThrow(/requires apiKey in real mode/);
  });

  it("mock 模式不需要 apiKey", () => {
    expect(() => new UpscaleAdapter({ mock: true })).not.toThrow();
  });
});

describe("UpscaleAdapter 输入契约", () => {
  it("没有源视频 → vendorParamError（超分不是生成）", async () => {
    const adapter = new UpscaleAdapter({ mock: true });
    await expect(adapter.submit(request({}, []))).rejects.toMatchObject({
      kind: "invalid_param",
      retryable: false,
    });
  });

  it("目标档非法 → vendorParamError，不静默用默认档", async () => {
    const adapter = new UpscaleAdapter({ mock: true });
    await expect(adapter.submit(request({ resolution: "8K" }))).rejects.toMatchObject({
      kind: "invalid_param",
    });
  });

  it("resolution 大小写不敏感（4k / 4K 都接受）", async () => {
    const adapter = new UpscaleAdapter({ mock: true });
    await expect(adapter.submit(request({ resolution: "4k" }))).resolves.toBeTruthy();
  });

  it("产出 .mp4，时长沿用请求时长", async () => {
    const adapter = new UpscaleAdapter({ mock: true });
    const submitted = await adapter.submit(request({ duration: 12 }));
    const state = await adapter.poll(submitted.vendor_task_id!);
    expect(state.status).toBe("succeeded");
    expect(state.results![0]!.uri).toBe("mock://results/mock-upscale-t-up-1.mp4");
    expect(state.results![0]!.duration_s).toBe(12);
  });
});

describe("UpscaleAdapter 真实 HTTP 协议", () => {
  let server: Server;
  let baseUrl = "";
  let lastBody: Record<string, unknown> = {};
  let polls = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (req.method === "POST" && req.url === "/v1/video/upscale/tasks") {
          lastBody = JSON.parse(body || "{}") as Record<string, unknown>;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ task_id: "vendor-up-1" }));
          return;
        }
        if (req.method === "GET" && req.url === "/v1/video/upscale/tasks/vendor-up-1") {
          polls += 1;
          res.writeHead(200, { "content-type": "application/json" });
          if (polls === 1) {
            res.end(JSON.stringify({ state: "in_progress" }));
            return;
          }
          res.end(
            JSON.stringify({
              state: "done",
              // 供应商把同一产物同时放在 data 与 output 两处：必须去重，否则一次生成算两次
              data: { videos: [{ download_url: `${baseUrl}/up.mp4`, duration: 5 }] },
              output: { videos: [{ download_url: `${baseUrl}/up.mp4` }] },
            }),
          );
          return;
        }
        res.writeHead(404);
        res.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("address unavailable");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("提交带 video_url 与 target_resolution；响应去重后只有一条产物", async () => {
    polls = 0;
    const adapter = new UpscaleAdapter({ apiKey: "k", baseUrl, defaultModel: "up-1" });
    const { vendor_task_id } = await adapter.submit(request({ resolution: "2K" }));
    expect(vendor_task_id).toBe("vendor-up-1");
    expect(lastBody).toMatchObject({
      model: "up-1",
      video_url: "https://x/src.mp4",
      target_resolution: "2K",
      scale: 2,
    });

    expect((await adapter.poll("vendor-up-1")).status).toBe("running");
    const done = await adapter.poll("vendor-up-1");
    expect(done.status).toBe("succeeded");
    // 关键：同一 URL 出现在 data 与 output 两处 → 只能计 1 条（重复会多扣一次费）
    expect(done.results).toHaveLength(1);
    expect(done.results![0]!.uri).toBe(`${baseUrl}/up.mp4`);
  });

  it("未给 resolution 时用默认档（1080p）", async () => {
    polls = 0;
    const adapter = new UpscaleAdapter({ apiKey: "k", baseUrl });
    await adapter.submit(request({ resolution: "" }));
    expect(lastBody.target_resolution).toBe(UPSCALE_DEFAULT_TARGET);
    await adapter.poll("vendor-up-1");
    await adapter.poll("vendor-up-1");
  });
});
