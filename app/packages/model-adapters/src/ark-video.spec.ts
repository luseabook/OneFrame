import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArkVideoAdapter } from "./ark-video";
import { resolveAdapter } from "./registry";
import type { NormalizedGenRequest } from "./types";

const request: NormalizedGenRequest = {
  task_id: "t1",
  model: { name: "seedance-2.5", vendor: "volcengine", adapter_code: "volcengine:video" },
  request: {
    mode: "image2video",
    model: "seedance-2.5",
    scene: null,
    input: { prompt: "雨夜街头", reference_uris: [], first_frame_uri: "https://cdn.example.com/frame.png" },
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

describe("ArkVideoAdapter", () => {
  let server: Server;
  let baseUrl = "";
  let lastBody: Record<string, unknown> = {};
  let lastAuth = "";
  let polls = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        lastAuth = String(req.headers.authorization ?? "");
        if (req.method === "POST" && req.url === "/api/v3/contents/generations/tasks") {
          lastBody = JSON.parse(body || "{}") as Record<string, unknown>;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "cgt-1" }));
          return;
        }
        if (req.method === "GET" && req.url === "/api/v3/contents/generations/tasks/cgt-1") {
          polls += 1;
          res.writeHead(200, { "content-type": "application/json" });
          if (polls === 1) {
            res.end(JSON.stringify({ id: "cgt-1", status: "queued" }));
          } else if (polls === 2) {
            res.end(JSON.stringify({ id: "cgt-1", status: "running" }));
          } else {
            res.end(
              JSON.stringify({
                id: "cgt-1",
                status: "succeeded",
                content: { video_url: `${baseUrl}/result.mp4`, cover_url: `${baseUrl}/cover.jpg` },
              }),
            );
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

  it("is selected for volcengine codes in real mode", () => {
    expect(resolveAdapter("volcengine:video", { mode: "real", ark: { apiKey: "k" } })).toBeInstanceOf(
      ArkVideoAdapter,
    );
    expect(resolveAdapter("volcengine:video", { mode: "mock" })).not.toBeInstanceOf(ArkVideoAdapter);
  });

  it("maps prompt/params/images to Ark content and polls to video url", async () => {
    polls = 0;
    const adapter = new ArkVideoAdapter({ apiKey: "ark-key", baseUrl, modelMap: { "seedance-2.5": "ep-123" } });
    const submitted = await adapter.submit(request);
    expect(submitted.vendor_task_id).toBe("cgt-1");
    expect(lastAuth).toBe("Bearer ark-key");
    expect(lastBody.model).toBe("ep-123");
    const content = lastBody.content as Array<Record<string, unknown>>;
    expect(content[0]?.type).toBe("text");
    expect(String(content[0]?.text)).toContain("--resolution 720p");
    expect(content[1]?.type).toBe("image_url");

    expect((await adapter.poll("cgt-1")).status).toBe("pending");
    expect((await adapter.poll("cgt-1")).status).toBe("running");
    const done = await adapter.poll("cgt-1");
    expect(done.status).toBe("succeeded");
    expect(done.results?.[0]?.uri).toBe(`${baseUrl}/result.mp4`);
  });
});
