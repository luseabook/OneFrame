import { describe, expect, it } from "vitest";
import {
  LipSyncAdapter,
  MusicAdapter,
  POSTPROCESS_CODES,
  resolveAdapter,
  SlicingAdapter,
  SubtitleEraseAdapter,
  TtsAdapter,
  UpscaleAdapter,
} from "./index";
import type { NormalizedGenRequest } from "./types";

const request: NormalizedGenRequest = {
  task_id: "t-reg-1",
  model: { name: "m", vendor: "tts", adapter_code: POSTPROCESS_CODES.tts },
  request: {
    mode: "tts",
    model: "m",
    scene: null,
    input: { prompt: "测试", reference_uris: [] },
    options: { ratio: "16:9", resolution: "720p", duration: 5, count: 1 },
  } as NormalizedGenRequest["request"],
};

describe("registry：后处理 adapter_code 注册", () => {
  /**
   * 本组断言的是「第 3 批工具箱的前置」：六个新能力必须能被 registry 解析出**正确的适配器类**，
   * 且**缺 Key 时硬失败**（不静默回落 mock）——这是 registry.ts 顶部既有约定，
   * 新增的 code 必须遵守同一条规则。
   */
  it("每个 code 都能解析出对应适配器实例", () => {
    const postprocess = { apiKey: "test-key", baseUrl: "http://127.0.0.1:1" };
    expect(resolveAdapter(POSTPROCESS_CODES.tts, { mode: "real", postprocess })).toBeInstanceOf(TtsAdapter);
    expect(resolveAdapter(POSTPROCESS_CODES.music, { mode: "real", postprocess })).toBeInstanceOf(MusicAdapter);
    expect(resolveAdapter(POSTPROCESS_CODES.sfx, { mode: "real", postprocess })).toBeInstanceOf(MusicAdapter);
    expect(resolveAdapter(POSTPROCESS_CODES.lipSync, { mode: "real", postprocess })).toBeInstanceOf(LipSyncAdapter);
    expect(resolveAdapter(POSTPROCESS_CODES.upscale, { mode: "real", postprocess })).toBeInstanceOf(UpscaleAdapter);
    expect(resolveAdapter(POSTPROCESS_CODES.subtitleErase, { mode: "real", postprocess })).toBeInstanceOf(
      SubtitleEraseAdapter,
    );
    expect(resolveAdapter(POSTPROCESS_CODES.slicing, { mode: "real", postprocess })).toBeInstanceOf(SlicingAdapter);
  });

  it("music 的两个 code 落到同一类但 kind 不同（text2music vs text2sfx）", () => {
    const postprocess = { apiKey: "test-key" };
    const music = resolveAdapter(POSTPROCESS_CODES.music, { mode: "real", postprocess }) as MusicAdapter;
    const sfx = resolveAdapter(POSTPROCESS_CODES.sfx, { mode: "real", postprocess }) as MusicAdapter;
    expect(music.musicKind).toBe("text2music");
    expect(sfx.musicKind).toBe("text2sfx");
  });

  it("real 模式缺 postprocess.apiKey → 每个 code 都显式报错，绝不静默 mock", () => {
    for (const code of Object.values(POSTPROCESS_CODES)) {
      expect(() => resolveAdapter(code, { mode: "real" })).toThrow(/requires apiKey in real mode/);
    }
  });

  it("单个能力可覆盖 apiKey/baseUrl（供应商不同网关）", () => {
    const adapter = resolveAdapter(POSTPROCESS_CODES.tts, {
      mode: "real",
      postprocess: { tts: { apiKey: "tts-only-key", baseUrl: "http://127.0.0.1:9" } },
    });
    expect(adapter).toBeInstanceOf(TtsAdapter);
  });

  it("mock 模式一律返回共享 MockAdapter（不构造真实 HTTP 客户端）", () => {
    const adapter = resolveAdapter(POSTPROCESS_CODES.tts, { mode: "mock" });
    // 共享 mock 的 vendor 标识固定为 mock，与真实适配器区分
    expect(adapter.vendor).toBe("mock");
    expect(adapter).not.toBeInstanceOf(TtsAdapter);
  });

  it("未实现的新供应商 code 报「not implemented」，不是「unknown」", () => {
    // 目录里新增了 minimax / happy-horse / midjourney / google / openai 的模型，
    // 它们的 adapter_code 目前没有真实实现：要报「尚未实现、请用 mock」，
    // 而不是「未知 code」——前者是可执行的运营指引，后者像是拼错了
    for (const code of ["minimax:video", "happy-horse:video", "midjourney:image", "google:chat", "openai:chat"]) {
      expect(() => resolveAdapter(code, { mode: "real" })).toThrow(/vendor adapter not implemented yet/);
    }
  });
});

describe("registry：mock 模式下后处理能力也能跑通端到端形状", () => {
  /**
   * 共享 `MockAdapter`（`mode: "mock"` 时所有 code 都用它）默认有 1200ms 模拟延迟，
   * 第一次轮询必然返回 running——这与真实异步供应商的节奏一致，不是 bug。
   * 这里断言的是**产物形状**：语音类任务必须落到 .mp3，不能是 .mp4。
   */
  it("tts 模式在 mock 下产出 .mp3（与能力一致，不是 .mp4）", async () => {
    const adapter = resolveAdapter(POSTPROCESS_CODES.tts, { mode: "mock" });
    const submitted = await adapter.submit(request);
    const pending = await adapter.poll(submitted.vendor_task_id!);
    expect(pending.status).toBe("running");

    // 等过 mock 的模拟延迟（1.2s）再取终态；用真实时钟，避免给测试引入假定时器复杂度
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const state = await adapter.poll(submitted.vendor_task_id!);
    expect(state.status).toBe("succeeded");
    expect(state.results![0]?.uri.endsWith(".mp3")).toBe(true);
  }, 10_000);
});
