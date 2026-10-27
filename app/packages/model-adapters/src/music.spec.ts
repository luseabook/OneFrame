import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MUSIC_DEFAULT_DURATION_S, MusicAdapter } from "./music";
import type { NormalizedGenRequest } from "./types";

const request = (overrides: Record<string, unknown> = {}): NormalizedGenRequest => ({
  task_id: "t-music-1",
  model: { name: "music-vendor-1", vendor: "music", adapter_code: "music:text2music" },
  request: {
    mode: "tts", // 任务形态由 adapter_code 决定；这里只关心媒体产物
    model: "music-vendor-1",
    scene: null,
    input: { prompt: "紧张悬疑，低音弦乐渐强", reference_uris: [] },
    options: { ratio: "16:9", resolution: "720p", duration: 5, count: 1, ...overrides },
  } as NormalizedGenRequest["request"],
});

describe("MusicAdapter 构造契约", () => {
  it("real 模式缺 apiKey → 构造即抛错", () => {
    expect(() => new MusicAdapter({})).toThrow(/requires apiKey in real mode/);
  });

  it("mock 模式不需要 apiKey", () => {
    expect(() => new MusicAdapter({ mock: true })).not.toThrow();
  });

  it("未知 kind → 构造即抛错（不静默变成 text2music）", () => {
    expect(() => new MusicAdapter({ mock: true }, "text2rap" as never)).toThrow(/unknown music kind/);
  });
});

describe("MusicAdapter mock 形状", () => {
  it("text2music 与 text2sfx 都产出 .mp3，且时长取请求值并按各自上界裁剪", async () => {
    const music = new MusicAdapter({ mock: true }, "text2music");
    const submitted = await music.submit(request({ duration: 45 }));
    const state = await music.poll(submitted.vendor_task_id!);
    expect(state.status).toBe("succeeded");
    // 音频产物必须是 .mp3（前端 <audio src> 直接用）
    expect(state.results![0]!.uri).toBe("mock://results/mock-music-t-music-1.mp3");
    expect(state.results![0]!.duration_s).toBe(45);

    // 音效上界 30s：60s 会被裁到 30s（不是报错——裁剪是显式语义，越界校验在别处）
    const sfx = new MusicAdapter({ mock: true }, "text2sfx");
    const sfxSubmit = await sfx.submit(request({ duration: 30 }));
    const sfxState = await sfx.poll(sfxSubmit.vendor_task_id!);
    expect(sfxState.results![0]!.duration_s).toBe(30);
    expect(sfxState.results![0]!.uri.endsWith(".mp3")).toBe(true);
  });

  it("未给 duration 时用默认值（MUSIC_DEFAULT_DURATION_S）", async () => {
    const adapter = new MusicAdapter({ mock: true }, "text2music");
    // 清掉 request() 里的 duration:5，才能验证适配器默认值
    const req = request({ duration: undefined });
    const submitted = await adapter.submit(req);
    const state = await adapter.poll(submitted.vendor_task_id!);
    expect(state.results![0]!.duration_s).toBe(MUSIC_DEFAULT_DURATION_S);
  });

  it("同输入同输出（跨实例产物 URI 一致）", async () => {
    const a = new MusicAdapter({ mock: true });
    const first = await a.poll((await a.submit(request())).vendor_task_id!);
    const b = new MusicAdapter({ mock: true });
    const second = await b.poll((await b.submit(request())).vendor_task_id!);
    expect(second.results![0]!.uri).toBe(first.results![0]!.uri);
  });

  it("duration 越界 → 提交前拦住", async () => {
    const sfx = new MusicAdapter({ mock: true }, "text2sfx");
    // 音效上界 30s，60s 越界
    await expect(sfx.submit(request({ duration: 60 }))).rejects.toMatchObject({ kind: "invalid_param" });
  });
});

describe("MusicAdapter 真实 HTTP 协议", () => {
  let server: Server;
  let baseUrl = "";
  let lastBody: Record<string, unknown> = {};
  let lastPath = "";
  let mode: "success" | "review" = "success";
  let polls = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        lastPath = `${req.method} ${req.url}`;
        if (req.method === "POST" && (req.url === "/v1/music/tasks" || req.url === "/v1/sfx/tasks")) {
          lastBody = JSON.parse(body || "{}") as Record<string, unknown>;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ task_id: "vendor-music-1" }));
          return;
        }
        if (req.method === "GET" && /^\/v1\/(music|sfx)\/tasks\/vendor-music-1$/.test(req.url ?? "")) {
          polls += 1;
          res.writeHead(200, { "content-type": "application/json" });
          if (polls === 1) {
            res.end(JSON.stringify({ data: { status: "processing" } }));
            return;
          }
          if (mode === "success") {
            res.end(
              JSON.stringify({
                data: { status: "completed", results: [{ audio_url: `${baseUrl}/bgm.mp3`, duration: 30 }] },
              }),
            );
          } else {
            res.end(JSON.stringify({ data: { status: "rejected", message: "copyright blocked" } }));
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

  it("text2music 走 /v1/music/tasks，带上 kind/prompt/duration", async () => {
    polls = 0;
    mode = "success";
    const adapter = new MusicAdapter({ apiKey: "k", baseUrl }, "text2music");
    await adapter.submit(request({ duration: 45 }));
    expect(lastPath).toBe("POST /v1/music/tasks");
    expect(lastBody).toMatchObject({ kind: "text2music", prompt: "紧张悬疑，低音弦乐渐强", duration: 45, instrumental: false });

    expect((await adapter.poll("vendor-music-1")).status).toBe("running");
    const done = await adapter.poll("vendor-music-1");
    expect(done.status).toBe("succeeded");
    expect(done.results![0]!.uri).toBe(`${baseUrl}/bgm.mp3`);
  });

  it("text2sfx 走 /v1/sfx/tasks 且 instrumental 恒为 false", async () => {
    polls = 0;
    mode = "success";
    const adapter = new MusicAdapter({ apiKey: "k", baseUrl }, "text2sfx");
    await adapter.submit(request({ duration: 10, instrumental: true }));
    expect(lastPath).toBe("POST /v1/sfx/tasks");
    expect(lastBody.instrumental).toBe(false);
    expect(lastBody.kind).toBe("text2sfx");
    await adapter.poll("vendor-music-1");
    await adapter.poll("vendor-music-1");
  });

  it("审核驳回（data.status=rejected）→ review_rejected", async () => {
    polls = 0;
    mode = "review";
    const adapter = new MusicAdapter({ apiKey: "k", baseUrl });
    await adapter.submit(request());
    await adapter.poll("vendor-music-1");
    const state = await adapter.poll("vendor-music-1");
    expect(state.status).toBe("review_rejected");
    expect(state.error?.code).toBe("output_rejected");
  });
});
