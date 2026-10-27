import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TtsAdapter, TTS_DEFAULT_SPEED, TTS_DEFAULT_VOICE } from "./tts";
import type { NormalizedGenRequest } from "./types";

const baseRequest = (overrides: Partial<NormalizedGenRequest["request"]> = {}): NormalizedGenRequest => ({
  task_id: "t-tts-1",
  model: { name: "tts-volc", vendor: "tts", adapter_code: "tts" },
  request: {
    mode: "tts",
    model: "tts-volc",
    scene: null,
    input: { prompt: "林晚：这件事没有你想的那么简单。", reference_uris: [] },
    options: { ratio: "16:9", resolution: "720p", duration: 5, count: 1 },
    ...overrides,
  } as NormalizedGenRequest["request"],
});

describe("TtsAdapter 构造契约（真实模式缺 Key 必须硬失败）", () => {
  /**
   * 这条是模块的硬约定（registry.ts 顶部注释）：真实模式没有 Key 时**显式报错**，
   * 绝不静默回落 mock——否则业务以为真的出片了，实际上什么都没发给供应商。
   */
  it("real 模式缺 apiKey → 构造即抛错，不静默回落 mock", () => {
    expect(() => new TtsAdapter({ baseUrl: "http://127.0.0.1:1" })).toThrow(/requires apiKey in real mode/);
  });

  it("mock 模式不需要 apiKey（本地/CI 可用）", () => {
    expect(() => new TtsAdapter({ mock: true })).not.toThrow();
  });
});

describe("TtsAdapter mock 形状（确定性：同输入同输出）", () => {
  it("提交→轮询得到一条 .mp3，且 uri 只由 task_id 决定", async () => {
    const adapter = new TtsAdapter({ mock: true });
    const submitted = await adapter.submit(baseRequest());
    expect(submitted.vendor_task_id).toBe("mock-tts-t-tts-1");

    const state = await adapter.poll(submitted.vendor_task_id!);
    expect(state.status).toBe("succeeded");
    expect(state.results).toHaveLength(1);
    // 音频产物必须是 .mp3：前端直接塞 <audio src>，.mp4 会静默不播（与 mock 图像/文本同一条教训）
    expect(state.results![0]!.uri).toBe("mock://results/mock-tts-t-tts-1.mp3");
    expect(state.results![0]!.meta).toMatchObject({ mock: true, media: "audio" });

    // 同输入同输出：同一实例再跑一次，结果字符串完全一致（不需要冻结时间）
    const again = await adapter.submit(baseRequest());
    const second = await adapter.poll(again.vendor_task_id!);
    expect(second.results![0]!.uri).toBe(state.results![0]!.uri);

    // 跨实例也一致：产物 URI 只由 vendor_task_id 决定，不含时间/随机数
    const fresh = new TtsAdapter({ mock: true });
    const third = await fresh.submit(baseRequest());
    expect((await fresh.poll(third.vendor_task_id!)).results![0]!.uri).toBe(state.results![0]!.uri);
  });

  it("mockPendingRounds 让前 N 次轮询返回 running（测轮询节奏用）", async () => {
    const adapter = new TtsAdapter({ mock: true, mockPendingRounds: 2 });
    const { vendor_task_id } = await adapter.submit(baseRequest());
    expect((await adapter.poll(vendor_task_id!)).status).toBe("running");
    expect((await adapter.poll(vendor_task_id!)).status).toBe("running");
    expect((await adapter.poll(vendor_task_id!)).status).toBe("succeeded");
  });

  it("duration_s 由字数估算（稳定可断言，不依赖真实音频）", async () => {
    const adapter = new TtsAdapter({ mock: true });
    const { vendor_task_id } = await adapter.submit(baseRequest());
    const state = await adapter.poll(vendor_task_id!);
    // 16 字 / 5 ≈ 3.2 → 3
    expect(state.results![0]!.duration_s).toBe(3);
  });

  it("cancel 之后轮询 → failed（不留在 running 永久轮询）", async () => {
    const adapter = new TtsAdapter({ mock: true });
    const { vendor_task_id } = await adapter.submit(baseRequest());
    await adapter.cancel(vendor_task_id!);
    const state = await adapter.poll(vendor_task_id!);
    expect(state.status).toBe("failed");
    expect(state.error?.code).toBe("mock_not_found");
  });
});

describe("TtsAdapter 参数校验", () => {
  it("空 prompt → vendorParamError（invalid_param，不重试）", async () => {
    const adapter = new TtsAdapter({ mock: true });
    const empty = baseRequest({ input: { prompt: "   ", reference_uris: [] } });
    await expect(adapter.submit(empty)).rejects.toMatchObject({ kind: "invalid_param", retryable: false });
  });

  it("语速越界 → vendorParamError，不发给供应商", async () => {
    const adapter = new TtsAdapter({ mock: true });
    const fast = baseRequest();
    (fast.request.options as Record<string, unknown>).speed = 9;
    await expect(adapter.submit(fast)).rejects.toMatchObject({ kind: "invalid_param" });
  });
});

describe("TtsAdapter 真实 HTTP 协议", () => {
  let server: Server;
  let baseUrl = "";
  let lastBody: Record<string, unknown> = {};
  let lastAuth = "";
  let mode: "success" | "review" | "noresult" | "fail" = "success";
  let polls = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        lastAuth = String(req.headers.authorization ?? "");
        if (req.method === "POST" && req.url === "/v1/tts/tasks") {
          lastBody = JSON.parse(body || "{}") as Record<string, unknown>;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ task_id: "vendor-tts-1" }));
          return;
        }
        if (req.method === "GET" && req.url === "/v1/tts/tasks/vendor-tts-1") {
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
                data: { audios: [{ audio_url: `${baseUrl}/out.mp3`, duration: 12 }] },
              }),
            );
          } else if (mode === "review") {
            res.end(JSON.stringify({ status: "review_rejected", message: "content violates policy" }));
          } else if (mode === "noresult") {
            res.end(JSON.stringify({ status: "succeeded", data: { audios: [] } }));
          } else {
            res.end(JSON.stringify({ status: "failed", error_message: "vendor exploded" }));
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

  it("提交带上 voice/speed/format，轮询取 audio_url", async () => {
    polls = 0;
    mode = "success";
    const adapter = new TtsAdapter({ apiKey: "vendor-key", baseUrl, defaultModel: "tts-1" });
    const req = baseRequest();
    (req.request.options as Record<string, unknown>).voice = "zh_male_jieshuoxingger";
    (req.request.options as Record<string, unknown>).speed = 1.25;

    const { vendor_task_id } = await adapter.submit(req);
    expect(vendor_task_id).toBe("vendor-tts-1");
    expect(lastAuth).toBe("Bearer vendor-key");
    expect(lastBody).toMatchObject({
      model: "tts-1",
      text: "林晚：这件事没有你想的那么简单。",
      voice: "zh_male_jieshuoxingger",
      speed: 1.25,
      format: "mp3",
    });

    expect((await adapter.poll("vendor-tts-1")).status).toBe("running");
    const done = await adapter.poll("vendor-tts-1");
    expect(done.status).toBe("succeeded");
    expect(done.results).toEqual([
      { uri: `${baseUrl}/out.mp3`, preview_uri: undefined, duration_s: 12, width: undefined, height: undefined },
    ]);
  });

  it("未给 voice/speed 时用默认值（不靠供应商兜底）", async () => {
    polls = 0;
    mode = "success";
    const adapter = new TtsAdapter({ apiKey: "k", baseUrl });
    await adapter.submit(baseRequest());
    expect(lastBody.voice).toBe(TTS_DEFAULT_VOICE);
    expect(lastBody.speed).toBe(TTS_DEFAULT_SPEED);
    await adapter.poll("vendor-tts-1");
    await adapter.poll("vendor-tts-1");
  });

  it("审核驳回 → review_rejected + output_rejected（745802，不落 running）", async () => {
    polls = 0;
    mode = "review";
    const adapter = new TtsAdapter({ apiKey: "k", baseUrl });
    await adapter.submit(baseRequest());
    await adapter.poll("vendor-tts-1");
    const state = await adapter.poll("vendor-tts-1");
    expect(state.status).toBe("review_rejected");
    expect(state.error?.code).toBe("output_rejected");
  });

  it("成功但无产物 → failed（不能落 SUCCEEDED 却没有 URI）", async () => {
    polls = 0;
    mode = "noresult";
    const adapter = new TtsAdapter({ apiKey: "k", baseUrl });
    const { vendor_task_id } = await adapter.submit(baseRequest());
    await adapter.poll(vendor_task_id!);
    const state = await adapter.poll(vendor_task_id!);
    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("without audio result");
  });

  it("供应商失败 → failed + vendor_error", async () => {
    polls = 0;
    mode = "fail";
    const adapter = new TtsAdapter({ apiKey: "k", baseUrl });
    const { vendor_task_id } = await adapter.submit(baseRequest());
    await adapter.poll(vendor_task_id!);
    const state = await adapter.poll(vendor_task_id!);
    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("vendor exploded");
  });

  it("fetchResults：已完成返回产物；未完成显式抛错（不返回空数组）", async () => {
    polls = 0;
    mode = "success";
    const adapter = new TtsAdapter({ apiKey: "k", baseUrl });
    const { vendor_task_id } = await adapter.submit(baseRequest());
    // 第一次 poll 仍是 running
    await expect(adapter.fetchResults(vendor_task_id!)).rejects.toThrow(/not finished/);
    const results = await adapter.fetchResults(vendor_task_id!);
    expect(results[0]?.uri).toBe(`${baseUrl}/out.mp3`);
  });
});
