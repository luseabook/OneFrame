import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertRegion, SubtitleEraseAdapter, type SubtitleRegion } from "./subtitle-erase";
import type { NormalizedGenRequest } from "./types";

const request = (
  overrides: Record<string, unknown> = {},
  refs: string[] = ["https://x/src.mp4"],
): NormalizedGenRequest => ({
  task_id: "t-de-1",
  model: { name: "de-vendor-1", vendor: "subtitle-erase", adapter_code: "subtitle-erase" },
  request: {
    mode: "tts",
    model: "de-vendor-1",
    scene: null,
    input: { prompt: "", reference_uris: refs },
    options: { ratio: "16:9", resolution: "1080p", duration: 5, count: 1, ...overrides },
  } as NormalizedGenRequest["request"],
});

describe("assertRegion 归一化坐标校验", () => {
  it("合法区域通过", () => {
    expect(() => assertRegion({ x: 0, y: 0.8, w: 1, h: 0.2 })).not.toThrow();
  });

  it("越界 / 尺寸为 0 / 越出画面 → 报错（静默裁剪会让用户框错位置却看不出来）", () => {
    expect(() => assertRegion({ x: -0.1, y: 0, w: 0.5, h: 0.5 })).toThrow(/within 0~1/);
    expect(() => assertRegion({ x: 0, y: 0, w: 0, h: 0.5 })).toThrow(/must be > 0/);
    expect(() => assertRegion({ x: 0.6, y: 0, w: 0.6, h: 0.2 })).toThrow(/overflows frame/);
    expect(() => assertRegion({ x: 0, y: 0.9, w: 0.2, h: 0.2 })).toThrow(/overflows frame/);
  });
});

describe("SubtitleEraseAdapter 构造契约", () => {
  it("real 模式缺 apiKey → 构造即抛错", () => {
    expect(() => new SubtitleEraseAdapter({})).toThrow(/requires apiKey in real mode/);
  });

  it("mock 模式不需要 apiKey", () => {
    expect(() => new SubtitleEraseAdapter({ mock: true })).not.toThrow();
  });
});

describe("SubtitleEraseAdapter 两种模式", () => {
  it("auto 模式不需要 region", async () => {
    const adapter = new SubtitleEraseAdapter({ mock: true });
    const submitted = await adapter.submit(request({ mode: "auto" }));
    const state = await adapter.poll(submitted.vendor_task_id!);
    expect(state.status).toBe("succeeded");
    expect(state.results![0]!.uri.endsWith(".mp4")).toBe(true);
  });

  it("region 模式缺 region → vendorParamError（不能悄悄退化成 auto）", async () => {
    const adapter = new SubtitleEraseAdapter({ mock: true });
    // 退化成 auto 会让「只擦框内」变成「全片改写」，产物不可逆且已扣费
    await expect(adapter.submit(request({ mode: "region" }))).rejects.toMatchObject({
      kind: "invalid_param",
      retryable: false,
    });
  });

  it("region 模式带合法区域 → 通过", async () => {
    const adapter = new SubtitleEraseAdapter({ mock: true });
    const region: SubtitleRegion = { x: 0.1, y: 0.85, w: 0.8, h: 0.1 };
    const submitted = await adapter.submit(request({ mode: "region", region }));
    expect(submitted.vendor_task_id).toBeTruthy();
  });

  it("region 越界 → vendorParamError", async () => {
    const adapter = new SubtitleEraseAdapter({ mock: true });
    await expect(
      adapter.submit(request({ mode: "region", region: { x: 0.9, y: 0, w: 0.5, h: 0.2 } })),
    ).rejects.toThrow(/overflows frame/);
  });

  it("sub_mode 也能当 region 来源（兼容画布侧既有传参）", async () => {
    const adapter = new SubtitleEraseAdapter({ mock: true });
    const submitted = await adapter.submit(
      request({ mode: "region", sub_mode: { x: 0, y: 0.9, w: 1, h: 0.1 } }),
    );
    expect(submitted.vendor_task_id).toBeTruthy();
  });

  it("未知 mode → vendorParamError", async () => {
    const adapter = new SubtitleEraseAdapter({ mock: true });
    await expect(adapter.submit(request({ mode: "erase_everything" }))).rejects.toMatchObject({
      kind: "invalid_param",
    });
  });
});

describe("SubtitleEraseAdapter 真实 HTTP 协议", () => {
  let server: Server;
  let baseUrl = "";
  let lastBody: Record<string, unknown> = {};
  let polls = 0;
  let mode: "success" | "rejected" = "success";

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (req.method === "POST" && req.url === "/v1/video/de-subtitle/tasks") {
          lastBody = JSON.parse(body || "{}") as Record<string, unknown>;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ task_id: "vendor-de-1" }));
          return;
        }
        if (req.method === "GET" && req.url === "/v1/video/de-subtitle/tasks/vendor-de-1") {
          polls += 1;
          res.writeHead(200, { "content-type": "application/json" });
          if (polls === 1) {
            res.end(JSON.stringify({ status: "running" }));
            return;
          }
          if (mode === "success") {
            res.end(JSON.stringify({ status: "succeeded", data: { videos: [{ video_url: `${baseUrl}/clean.mp4` }] } }));
          } else {
            res.end(JSON.stringify({ status: "review_rejected", message: "video blocked" }));
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

  it("auto 模式：请求体只带 mode，不带 region", async () => {
    polls = 0;
    mode = "success";
    const adapter = new SubtitleEraseAdapter({ apiKey: "k", baseUrl, defaultModel: "de-1" });
    await adapter.submit(request({ mode: "auto" }));
    expect(lastBody).toMatchObject({ model: "de-1", video_url: "https://x/src.mp4", mode: "auto", inpaint: false });
    expect(lastBody.region).toBeUndefined();
    await adapter.poll("vendor-de-1");
    const done = await adapter.poll("vendor-de-1");
    expect(done.results![0]!.uri).toBe(`${baseUrl}/clean.mp4`);
  });

  it("region 模式：area 归一化后按 [x,y,w,h] 数组发出去", async () => {
    polls = 0;
    mode = "success";
    const adapter = new SubtitleEraseAdapter({ apiKey: "k", baseUrl });
    await adapter.submit(request({ mode: "region", region: { x: 0.1, y: 0.85, w: 0.8, h: 0.1 } }));
    expect(lastBody.mode).toBe("region");
    expect(lastBody.region).toEqual([0.1, 0.85, 0.8, 0.1]);
    await adapter.poll("vendor-de-1");
    await adapter.poll("vendor-de-1");
  });

  it("审核驳回 → review_rejected", async () => {
    polls = 0;
    mode = "rejected";
    const adapter = new SubtitleEraseAdapter({ apiKey: "k", baseUrl });
    await adapter.submit(request({ mode: "auto" }));
    await adapter.poll("vendor-de-1");
    const state = await adapter.poll("vendor-de-1");
    expect(state.status).toBe("review_rejected");
    expect(state.error?.code).toBe("output_rejected");
  });
});
