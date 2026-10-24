import { describe, expect, it } from "vitest";
import { ErrorCode } from "./errors";
import { generationRequestSchema } from "./schemas/generation";
import { characterSchema, createProjectSchema, generateVideosSchema, storyboardSchema } from "./schemas/project";
import { loginRequestSchema, refreshRequestSchema } from "./schemas/auth";

describe("generationRequestSchema", () => {
  it("applies defaults and accepts a minimal text2video request", () => {
    const r = generationRequestSchema.parse({
      mode: "text2video",
      model: "seedance-2.0-pro",
      input: { prompt: "一只柯基犬在草地上奔跑" },
    });
    expect(r.options).toMatchObject({ ratio: "9:16", resolution: "720p", duration: 5, count: 1 });
  });

  it("accepts 1..30s outer bounds and rejects 0/31 or unknown mode", () => {
    const base = { mode: "text2video", model: "m", input: {} };
    expect(generationRequestSchema.safeParse({ ...base, options: { duration: 1 } }).success).toBe(true);
    expect(generationRequestSchema.safeParse({ ...base, options: { duration: 30 } }).success).toBe(true);
    expect(generationRequestSchema.safeParse({ ...base, options: { duration: 0 } }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...base, options: { duration: 31 } }).success).toBe(false);
    expect(generationRequestSchema.safeParse({ ...base, mode: "time_travel" }).success).toBe(false);
  });

  it("accepts pipeline scene keys and rejects mode-as-scene", () => {
    const base = { model: "m", input: {} };
    expect(
      generationRequestSchema.safeParse({ ...base, mode: "text2video", scene: "storyboard_reference_video" })
        .success,
    ).toBe(true);
    expect(
      generationRequestSchema.safeParse({ ...base, mode: "image2video", scene: "studio_asset_image" }).success,
    ).toBe(false);
  });
});

describe("createProjectSchema", () => {
  it("accepts novel/idea/script sources within 5万字 and rejects overflow or reserved fission", () => {
    const base = { title: "测试项目", source_text: "x".repeat(1000) };
    expect(createProjectSchema.safeParse(base).success).toBe(true);
    expect(createProjectSchema.safeParse({ ...base, source_type: 2 }).success).toBe(true);
    expect(createProjectSchema.safeParse({ ...base, source_type: 3 }).success).toBe(true);
    expect(createProjectSchema.safeParse({ ...base, source_type: 4 }).success).toBe(false); // fission 预留
    expect(
      createProjectSchema.safeParse({ ...base, source_text: "x".repeat(50001) }).success,
    ).toBe(false);
  });
});

describe("generateVideosSchema", () => {
  it("requires model + budget and accepts optional model enum overrides", () => {
    const base = { shot_ids: ["s1"], budget_credits_max: 100, model: "seedance-2.5" };
    expect(generateVideosSchema.safeParse(base).success).toBe(true);
    expect(generateVideosSchema.safeParse({ ...base, ratio: "9:16", resolution: "720p" }).success).toBe(true);
    expect(generateVideosSchema.safeParse({ ...base, model: "" }).success).toBe(false);
    expect(generateVideosSchema.safeParse({ ...base, budget_credits_max: 0 }).success).toBe(false);
    expect(generateVideosSchema.safeParse({ ...base, shot_ids: [] }).success).toBe(false);
  });
});

describe("characterSchema", () => {
  it("defaults to draft and accepts finalized status", () => {
    expect(characterSchema.parse({ id: "c1", name: "阿凯" }).status).toBe(1);
    expect(characterSchema.safeParse({ id: "c1", name: "阿凯", status: 2 }).success).toBe(true);
  });
});

describe("loginRequestSchema", () => {
  it("validates CN phone and 6-digit code", () => {
    expect(loginRequestSchema.safeParse({ phone: "13800138000", code: "123456" }).success).toBe(true);
    expect(loginRequestSchema.safeParse({ phone: "23800138000", code: "123456" }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ phone: "13800138000", code: "12345" }).success).toBe(false);
  });
});

describe("refreshRequestSchema", () => {
  it("has no body: refresh token travels via HttpOnly Cookie", () => {
    expect(refreshRequestSchema.safeParse({}).success).toBe(true);
    // strict：请求体携带 refresh_token 应被拒绝（Cookie 方案下前端拿不到 token）
    expect(refreshRequestSchema.safeParse({ refresh_token: "x" }).success).toBe(false);
  });
});

describe("storyboardSchema duration_s", () => {
  const base = { id: "s1", shot_no: 1 };
  it("stores 1..30 with default 5; model enum is validated at dispatch", () => {
    expect(storyboardSchema.parse(base).duration_s).toBe(5);
    for (const d of [1, 5, 10, 30]) {
      expect(storyboardSchema.safeParse({ ...base, duration_s: d }).success).toBe(true);
    }
    for (const d of [0, 31]) {
      expect(storyboardSchema.safeParse({ ...base, duration_s: d }).success).toBe(false);
    }
  });
});

describe("error codes", () => {
  it("keeps the documented segment layout", () => {
    expect(ErrorCode.INSUFFICIENT_BALANCE).toBe(745701);
    expect(ErrorCode.BUDGET_EXCEEDED).toBe(745703);
    expect(ErrorCode.INPUT_REJECTED).toBe(745801);
    expect(ErrorCode.CAPTCHA_REQUIRED).toBe(429101);
    expect(ErrorCode.CANCEL_NOT_ALLOWED).toBe(400103);
    expect(ErrorCode.SOURCE_TOO_LONG).toBe(400104);
    expect(ErrorCode.ASSET_NOT_READY).toBe(400105);
    expect(ErrorCode.EXPORT_INCOMPLETE).toBe(400106);
    expect(ErrorCode.QUOTE_REQUIRED).toBe(400107);
  });
});
