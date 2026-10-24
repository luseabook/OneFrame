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
