import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HttpVideoAdapter } from "./http-video";
import type { NormalizedGenRequest } from "./types";

const request: NormalizedGenRequest = {
  task_id: "t1",
  model: { name: "seedance-2.5", vendor: "volcengine", adapter_code: "volcengine:video" },
  request: {
    mode: "text2video",
    model: "seedance-2.5",
    scene: null,
    input: { prompt: "雨夜街头", reference_uris: [] },
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

describe("HttpVideoAdapter", () => {
  let server: Server;
  let baseUrl = "";
  let polls = 0;
  let lastAuth = "";
  let lastBody: Record<string, unknown> = {};
  let mode: "success" | "fail" | "review" = "success";

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        lastAuth = String(req.headers.authorization ?? "");
        if (req.method === "POST" && req.url === "/v1/video/tasks") {
          lastBody = JSON.parse(body || "{}") as Record<string, unknown>;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ task_id: "vendor-task-1" }));
          return;
        }
        if (req.method === "GET" && req.url === "/v1/video/tasks/vendor-task-1") {
          polls += 1;
          if (polls === 1) {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ status: "running" }));
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify(
              mode === "success"
                ? { status: "succeeded", results: [{ url: `${baseUrl}/media.mp4`, duration: 5 }] }
                : mode === "review"
                  ? { status: "review_rejected", message: "content violates policy" }
                  : { status: "failed", message: "vendor exploded" },
            ),
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

  it("submits with mapped model/auth and polls to results", async () => {
    polls = 0;
    mode = "success";
    const adapter = new HttpVideoAdapter({
      baseUrl,
      apiKey: "vendor-key",
      modelMap: { "seedance-2.5": "doubao-seedance-2.5" },
    });
    const submitted = await adapter.submit(request);
    expect(submitted.vendor_task_id).toBe("vendor-task-1");
    expect(lastAuth).toBe("Bearer vendor-key");
    expect(lastBody.model).toBe("doubao-seedance-2.5");
    expect(lastBody.prompt).toBe("雨夜街头");

    const first = await adapter.poll("vendor-task-1");
    expect(first.status).toBe("running");
    const second = await adapter.poll("vendor-task-1");
    expect(second.status).toBe("succeeded");
    expect(second.results?.[0]?.uri).toBe(`${baseUrl}/media.mp4`);
  });

  it("maps vendor failures", async () => {
    polls = 0;
    mode = "fail";
    const adapter = new HttpVideoAdapter({ baseUrl });
    await adapter.submit(request);
    await adapter.poll("vendor-task-1");
    const state = await adapter.poll("vendor-task-1");
    expect(state.status).toBe("failed");
    expect(state.error?.message).toContain("vendor exploded");
  });

  it("maps vendor review rejection to output_rejected", async () => {
    polls = 0;
    mode = "review";
    const adapter = new HttpVideoAdapter({ baseUrl });
    await adapter.submit(request);
    await adapter.poll("vendor-task-1");
    const state = await adapter.poll("vendor-task-1");
    expect(state.status).toBe("review_rejected");
    expect(state.error?.code).toBe("output_rejected");
  });
});
