import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LipSyncAdapter } from "./lip-sync";
import type { NormalizedGenRequest } from "./types";

const request = (refs: string[], overrides: Record<string, unknown> = {}): NormalizedGenRequest => ({
  task_id: "t-lip-1",
  model: { name: "lip-vendor-1", vendor: "lip-sync", adapter_code: "lip-sync" },
  request: {
    mode: "tts",
    model: "lip-vendor-1",
    scene: null,
    input: { prompt: "让人物对上这句台词", reference_uris: refs },
    options: { ratio: "16:9", resolution: "720p", duration: 5, count: 1, ...overrides },
  } as NormalizedGenRequest["request"],
});

describe("LipSyncAdapter 构造契约", () => {
  it("real 模式缺 apiKey → 构造即抛错", () => {
    expect(() => new LipSyncAdapter({})).toThrow(/requires apiKey in real mode/);
  });

  it("mock 模式不需要 apiKey", () => {
    expect(() => new LipSyncAdapter({ mock: true })).not.toThrow();
  });
});

describe("LipSyncAdapter 输入契约（video + audio 顺序固定）", () => {
  it("缺一个素材 → vendorParamError，指出需要 2 个", async () => {
    const adapter = new LipSyncAdapter({ mock: true });
    await expect(adapter.submit(request(["https://x/video.mp4"]))).rejects.toMatchObject({
      kind: "invalid_param",
      retryable: false,
    });
  });

  it("缺全部素材 → vendorParamError", async () => {
    const adapter = new LipSyncAdapter({ mock: true });
    await expect(adapter.submit(request([]))).rejects.toMatchObject({ kind: "invalid_param" });
  });

  it("非法 mode → vendorParamError（不静默退化成默认模式）", async () => {
    const adapter = new LipSyncAdapter({ mock: true });
    await expect(
      adapter.submit(request(["https://x/v.mp4", "https://x/a.mp3"], { mode: "telepathy" })),
    ).rejects.toMatchObject({ kind: "invalid_param" });
  });

  it("两个素材齐了 → 产出 .mp4", async () => {
    const adapter = new LipSyncAdapter({ mock: true });
    const submitted = await adapter.submit(request(["https://x/v.mp4", "https://x/a.mp3"]));
    const state = await adapter.poll(submitted.vendor_task_id!);
    expect(state.status).toBe("succeeded");
    expect(state.results![0]!.uri).toBe("mock://results/mock-lip-sync-t-lip-1.mp4");
    expect(state.results![0]!.duration_s).toBe(5);
  });
});

describe("LipSyncAdapter 真实 HTTP 协议", () => {
  let server: Server;
  let baseUrl = "";
  let lastBody: Record<string, unknown> = {};
  let polls = 0;
  let mode: "success" | "sensitive" | "nourl" = "success";

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (req.method === "POST" && req.url === "/v1/lip-sync/tasks") {
          lastBody = JSON.parse(body || "{}") as Record<string, unknown>;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "vendor-lip-1" }));
          return;
        }
        if (req.method === "GET" && req.url === "/v1/lip-sync/tasks/vendor-lip-1") {
          polls += 1;
          res.writeHead(200, { "content-type": "application/json" });
          if (polls === 1) {
            res.end(JSON.stringify({ status: "queued" }));
            return;
          }
          if (mode === "success") {
            res.end(
              JSON.stringify({ status: "succeeded", results: [{ video_url: `${baseUrl}/lip.mp4`, duration: 8 }] }),
            );
          } else if (mode === "sensitive") {
            res.end(JSON.stringify({ status: "failed", error_code: "FaceSensitiveBlocked", message: "face not allowed" }));
          } else {
            res.end(JSON.stringify({ status: "succeeded", results: [] }));
          }
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

  it("把 reference_uris 按 [视频, 音频] 拆进 video_url/audio_url", async () => {
    polls = 0;
    mode = "success";
    const adapter = new LipSyncAdapter({ apiKey: "k", baseUrl, defaultModel: "lip-1" });
    const submitted = await adapter.submit(request(["https://x/v.mp4", "https://x/a.mp3"], { mode: "lip_only" }));
    expect(submitted.vendor_task_id).toBe("vendor-lip-1");
    expect(lastBody).toMatchObject({
      model: "lip-1",
      video_url: "https://x/v.mp4",
      audio_url: "https://x/a.mp3",
      mode: "lip_only",
      sync_strength: 1,
    });

    expect((await adapter.poll("vendor-lip-1")).status).toBe("pending");
    const done = await adapter.poll("vendor-lip-1");
    expect(done.status).toBe("succeeded");
    expect(done.results![0]!.uri).toBe(`${baseUrl}/lip.mp4`);
    expect(done.results![0]!.duration_s).toBe(8);
  });

  it("失败原因含审核信号（FaceSensitive）→ review_rejected 而不是普通 failed", async () => {
    polls = 0;
    mode = "sensitive";
    const adapter = new LipSyncAdapter({ apiKey: "k", baseUrl });
    await adapter.submit(request(["https://x/v.mp4", "https://x/a.mp3"]));
    await adapter.poll("vendor-lip-1");
    const state = await adapter.poll("vendor-lip-1");
    // 审核类失败要落 745802（改素材可重试），不是 745900（供应商故障）
    expect(state.status).toBe("review_rejected");
    expect(state.error?.code).toBe("output_rejected");
  });

  it("成功但无产物 → failed（不能落 SUCCEEDED 没有 URI）", async () => {
    polls = 0;
    mode = "nourl";
    const adapter = new LipSyncAdapter({ apiKey: "k", baseUrl });
    await adapter.submit(request(["https://x/v.mp4", "https://x/a.mp3"]));
    await adapter.poll("vendor-lip-1");
    const state = await adapter.poll("vendor-lip-1");
    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("without video result");
  });
});
