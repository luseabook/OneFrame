import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeepSeekChatAdapter } from "./deepseek";
import { MockAdapter } from "./mock";
import type { NormalizedGenRequest } from "./types";

const request: NormalizedGenRequest = {
  task_id: "t1",
  model: { name: "deepseek-v4-pro", vendor: "deepseek", adapter_code: "deepseek:chat" },
  request: {
    mode: "text2video",
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
    },
  },
};

describe("DeepSeekChatAdapter", () => {
  let server: Server;
  let baseUrl = "";
  let lastBody: Record<string, unknown> = {};
  let lastAuth = "";

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        lastAuth = String(req.headers.authorization ?? "");
        lastBody = JSON.parse(body || "{}") as Record<string, unknown>;
        if (body.includes("FAIL")) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end('{"error":"boom"}');
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ message: { content: "第一集：开端" } }], usage: { total_tokens: 42 } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server address unavailable");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("maps chat completion to sync text result", async () => {
    const adapter = new DeepSeekChatAdapter({ apiKey: "test-key", baseUrl, model: "deepseek-chat" });
    const res = await adapter.submit(request);
    expect(res.sync_results?.[0]?.text).toBe("第一集：开端");
    expect(lastAuth).toBe("Bearer test-key");
    expect(lastBody.model).toBe("deepseek-chat");
    expect(JSON.stringify(lastBody.messages)).toContain("写一个三集大纲");
  });

  it("surfaces vendor failures without leaking full body", async () => {
    const adapter = new DeepSeekChatAdapter({ apiKey: "k", baseUrl });
    const failing = { ...request, request: { ...request.request, input: { ...request.request.input, prompt: "FAIL" } } };
    await expect(adapter.submit(failing)).rejects.toThrow(/deepseek http 500/);
  });
});

describe("MockAdapter", () => {
  it("transitions running → succeeded and returns a mock result", async () => {
    const adapter = new MockAdapter({ delayMs: 0 });
    const { vendor_task_id } = await adapter.submit(request);
    expect(vendor_task_id).toBe("mock-t1");
    const state = await adapter.poll(vendor_task_id!);
    expect(state.status).toBe("succeeded");
    expect(state.results?.[0]?.uri).toBe("mock://results/t1.mp4");
  });

  it("supports failure/review behaviours", async () => {
    const failing = new MockAdapter({ delayMs: 0, behavior: "fail" });
    const { vendor_task_id } = await failing.submit(request);
    expect((await failing.poll(vendor_task_id!)).status).toBe("failed");

    const rejected = new MockAdapter({ delayMs: 0, behavior: "review_rejected" });
    const submitted = await rejected.submit(request);
    expect((await rejected.poll(submitted.vendor_task_id!)).status).toBe("review_rejected");
  });
});

describe("MockAdapter 文本分支", () => {
  /**
   * LLM 适配器是同步的（`deepseek:chat` 的 submit 直接返回 sync_results）。
   * mock 必须照同一形状返回文本：否则本地/E2E 里"剧本优化"会拿到一个 .mp4 的
   * mock 结果——形状错了，前端要文本却收到视频 URI，看起来像功能坏了。
   */
  const textRequest = (mode: string): NormalizedGenRequest => ({
    task_id: "t-text",
    model: { name: "deepseek-v4-pro", vendor: "deepseek", adapter_code: "deepseek:chat" },
    request: {
      mode: mode as NormalizedGenRequest["request"]["mode"],
      model: "deepseek-v4-pro",
      scene: null,
      input: { prompt: "场景一 · 夜 · 内\n林晚：这件事没那么简单。", reference_uris: [] },
      options: { ratio: "9:16", resolution: "per_call", duration: 5, count: 1 },
    },
  });

  it("同步返回文本结果（无 vendor_task_id），且按 mode 给出不同结构", async () => {
    const mock = new MockAdapter();
    const optimized = await mock.submit(textRequest("script_optimization"));
    expect(optimized.vendor_task_id).toBeUndefined();
    expect(optimized.sync_results?.[0]?.text).toContain("优化后的剧本");
    expect(optimized.sync_results?.[0]?.uri).toBe("");

    const storyboard = await mock.submit(textRequest("storyboard_parse"));
    expect(storyboard.sync_results?.[0]?.text).toContain("分镜清单");

    // 拆分资产的产出必须是**合法 JSON**：前端要按角色/场景/道具渲染，
    // mock 返回自由文本会让"解析失败"盖住真正的链路问题
    const assets = await mock.submit(textRequest("asset_extraction"));
    const parsed = JSON.parse(assets.sync_results?.[0]?.text ?? "{}") as {
      characters?: unknown[];
      scenes?: unknown[];
      props?: unknown[];
    };
    expect(Array.isArray(parsed.characters)).toBe(true);
    expect(Array.isArray(parsed.scenes)).toBe(true);
    expect(Array.isArray(parsed.props)).toBe(true);

    // 视频拆解（分析类）也必须走**同步文本**分支、且产出与拆分资产同形的 JSON——
    // 否则本地/E2E 拆视频会拿到 .mp4 假结果，前端解析失败会掩盖真正的链路问题
    const videoParse = await mock.submit(textRequest("video_parse"));
    expect(videoParse.vendor_task_id).toBeUndefined();
    const parsedVideo = JSON.parse(videoParse.sync_results?.[0]?.text ?? "{}") as {
      characters?: Array<{ name?: string; prompt?: string }>;
      scenes?: unknown[];
      props?: unknown[];
    };
    expect(Array.isArray(parsedVideo.characters)).toBe(true);
    expect(parsedVideo.characters?.[0]?.name).toBeTruthy();
    expect(Array.isArray(parsedVideo.scenes)).toBe(true);
    expect(Array.isArray(parsedVideo.props)).toBe(true);
  });

  it("媒体类仍走异步 mock（返回 vendor_task_id 而不是同步结果）", async () => {
    const mock = new MockAdapter();
    const submitted = await mock.submit({
      ...textRequest("text2image"),
      model: { name: "tgi-2", vendor: "volcengine", adapter_code: "volcengine:image" },
    });
    expect(submitted.vendor_task_id).toBeTruthy();
    expect(submitted.sync_results).toBeUndefined();
  });
});