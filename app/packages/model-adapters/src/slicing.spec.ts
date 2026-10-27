import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SLICE_COUNT_MAX, SlicingAdapter } from "./slicing";
import type { NormalizedGenRequest } from "./types";

const request = (
  overrides: Record<string, unknown> = {},
  refs: string[] = ["https://x/long.mp4"],
): NormalizedGenRequest => ({
  task_id: "t-slice-1",
  model: { name: "slice-vendor-1", vendor: "slicing", adapter_code: "slicing" },
  request: {
    mode: "tts",
    model: "slice-vendor-1",
    scene: null,
    input: { prompt: "", reference_uris: refs },
    options: { ratio: "16:9", resolution: "720p", duration: 5, count: 1, ...overrides },
  } as NormalizedGenRequest["request"],
});

describe("SlicingAdapter 构造契约", () => {
  it("real 模式缺 apiKey → 构造即抛错", () => {
    expect(() => new SlicingAdapter({})).toThrow(/requires apiKey in real mode/);
  });

  it("mock 模式不需要 apiKey", () => {
    expect(() => new SlicingAdapter({ mock: true })).not.toThrow();
  });
});

describe("SlicingAdapter 三种策略", () => {
  it("duration 策略：默认每条 5s，产出 1 条（mock 默认 count=2 不适用 duration 策略）", async () => {
    const adapter = new SlicingAdapter({ mock: true });
    const submitted = await adapter.submit(request({ strategy: "duration", slice_duration: 5 }));
    const state = await adapter.poll(submitted.vendor_task_id!);
    expect(state.status).toBe("succeeded");
    // duration 策略的产物条数由源视频长度决定，适配器不知道 → mock 给 2 条最小可断言集
    expect(state.results!.length).toBe(2);
    // 多产物必须是**稳定的名字序列**（时间线拼回去不能乱序）
    expect(state.results!.map((r) => r.uri)).toEqual([
      "mock://results/mock-slicing-t-slice-1-0.mp4",
      "mock://results/mock-slicing-t-slice-1-1.mp4",
    ]);
    expect(state.results![0]!.duration_s).toBe(5);
  });

  it("ranges 策略：产物条数 = 区间数，且顺序与输入一致", async () => {
    const adapter = new SlicingAdapter({ mock: true });
    const ranges = [
      { start: 0, end: 3 },
      { start: 5, end: 9 },
      { start: 12, end: 15 },
    ];
    const submitted = await adapter.submit(request({ ranges }));
    const state = await adapter.poll(submitted.vendor_task_id!);
    expect(state.results!.length).toBe(3);
    expect(state.results!.map((r) => r.uri)).toEqual([
      "mock://results/mock-slicing-t-slice-1-0.mp4",
      "mock://results/mock-slicing-t-slice-1-1.mp4",
      "mock://results/mock-slicing-t-slice-1-2.mp4",
    ]);
  });

  it("count 策略：产物条数 = 请求的 count", async () => {
    const adapter = new SlicingAdapter({ mock: true });
    const submitted = await adapter.submit(request({ strategy: "count", count: 4 }));
    const state = await adapter.poll(submitted.vendor_task_id!);
    expect(state.results!.length).toBe(4);
  });

  it("没有源视频 → vendorParamError", async () => {
    const adapter = new SlicingAdapter({ mock: true });
    await expect(adapter.submit(request({}, []))).rejects.toMatchObject({
      kind: "invalid_param",
      retryable: false,
    });
  });

  it("ranges 为空 → vendorParamError", async () => {
    const adapter = new SlicingAdapter({ mock: true });
    await expect(adapter.submit(request({ ranges: [] }))).rejects.toMatchObject({
      kind: "invalid_param",
    });
  });

  it("区间 end <= start → vendorParamError", async () => {
    const adapter = new SlicingAdapter({ mock: true });
    await expect(adapter.submit(request({ ranges: [{ start: 5, end: 5 }] }))).rejects.toThrow(
      /end must be > start/,
    );
  });

  it("区间乱序/重叠 → vendorParamError（否则拼回时间线会重复或丢帧）", async () => {
    const adapter = new SlicingAdapter({ mock: true });
    await expect(
      adapter.submit(request({ ranges: [{ start: 0, end: 6 }, { start: 4, end: 8 }] })),
    ).rejects.toThrow(/sorted and non-overlapping/);
    await expect(
      adapter.submit(request({ ranges: [{ start: 5, end: 8 }, { start: 0, end: 3 }] })),
    ).rejects.toThrow(/sorted and non-overlapping/);
  });

  it("区间数超过上限 → vendorParamError", async () => {
    const adapter = new SlicingAdapter({ mock: true });
    const ranges = Array.from({ length: SLICE_COUNT_MAX + 1 }, (_, i) => ({ start: i * 2, end: i * 2 + 1 }));
    await expect(adapter.submit(request({ ranges }))).rejects.toThrow(/at most/);
  });

  it("slice_duration 越界 → vendorParamError", async () => {
    const adapter = new SlicingAdapter({ mock: true });
    await expect(adapter.submit(request({ strategy: "duration", slice_duration: 0 }))).rejects.toMatchObject({
      kind: "invalid_param",
    });
    await expect(adapter.submit(request({ strategy: "duration", slice_duration: 999 }))).rejects.toMatchObject({
      kind: "invalid_param",
    });
  });
});

describe("SlicingAdapter 真实 HTTP 协议", () => {
  let server: Server;
  let baseUrl = "";
  let lastBody: Record<string, unknown> = {};
  let polls = 0;
  let mode: "success" | "review" = "success";

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        if (req.method === "POST" && req.url === "/v1/video/slicing/tasks") {
          lastBody = JSON.parse(body || "{}") as Record<string, unknown>;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ task_id: "vendor-slice-1" }));
          return;
        }
        if (req.method === "GET" && req.url === "/v1/video/slicing/tasks/vendor-slice-1") {
          polls += 1;
          if (polls === 1) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ status: "running" }));
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          if (mode === "success") {
            res.end(
              JSON.stringify({
                status: "succeeded",
                data: {
                  segments: [
                    { video_url: `${baseUrl}/s0.mp4`, duration: 3 },
                    { video_url: `${baseUrl}/s1.mp4`, duration: 4 },
                  ],
                },
              }),
            );
          } else {
            res.end(JSON.stringify({ status: "audit_failed", message: "contains sensitive content" }));
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

  it("ranges 策略：区间按 [[start,end]] 数组发出，多产物按顺序返回", async () => {
    polls = 0;
    mode = "success";
    const adapter = new SlicingAdapter({ apiKey: "k", baseUrl, defaultModel: "slice-1" });
    const ranges = [
      { start: 0, end: 3 },
      { start: 5, end: 9 },
    ];
    const { vendor_task_id } = await adapter.submit(request({ ranges }));
    expect(vendor_task_id).toBe("vendor-slice-1");
    expect(lastBody).toMatchObject({
      model: "slice-1",
      video_url: "https://x/long.mp4",
      strategy: "ranges",
      ranges: [
        [0, 3],
        [5, 9],
      ],
      with_cover: true,
    });

    expect((await adapter.poll("vendor-slice-1")).status).toBe("running");
    const done = await adapter.poll("vendor-slice-1");
    expect(done.status).toBe("succeeded");
    expect(done.results!.map((r) => r.uri)).toEqual([`${baseUrl}/s0.mp4`, `${baseUrl}/s1.mp4`]);
    expect(done.results!.map((r) => r.duration_s)).toEqual([3, 4]);
  });

  it("duration 策略：发 slice_duration，不发 ranges", async () => {
    polls = 0;
    mode = "success";
    const adapter = new SlicingAdapter({ apiKey: "k", baseUrl });
    await adapter.submit(request({ strategy: "duration", slice_duration: 7 }));
    expect(lastBody.strategy).toBe("duration");
    expect(lastBody.slice_duration).toBe(7);
    expect(lastBody.ranges).toBeUndefined();
    await adapter.poll("vendor-slice-1");
    await adapter.poll("vendor-slice-1");
  });

  it("audit_failed（含审核信号）→ review_rejected", async () => {
    polls = 0;
    mode = "review";
    const adapter = new SlicingAdapter({ apiKey: "k", baseUrl });
    await adapter.submit(request({ strategy: "duration" }));
    await adapter.poll("vendor-slice-1");
    const state = await adapter.poll("vendor-slice-1");
    expect(state.status).toBe("review_rejected");
    expect(state.error?.code).toBe("output_rejected");
  });
});
