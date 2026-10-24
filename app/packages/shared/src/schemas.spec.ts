import { describe, expect, it } from "vitest";
import { ErrorCode } from "./errors";
import { generationRequestSchema } from "./schemas/generation";
import { createProjectSchema, storyboardSchema } from "./schemas/project";
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

  it("rejects out-of-range duration and unknown mode", () => {
    const base = { model: "m", input: {} };
    expect(
      generationRequestSchema.safeParse({ ...base, mode: "text2video", options: { duration: 3 } }).success,
    ).toBe(false);
    expect(generationRequestSchema.safeParse({ ...base, mode: "time_travel" }).success).toBe(false);
  });
});

describe("createProjectSchema", () => {
  it("accepts a novel source within limit and rejects overflow", () => {
    const base = { title: "测试项目", source_text: "x".repeat(1000) };
    expect(createProjectSchema.safeParse(base).success).toBe(true);
    expect(
      createProjectSchema.safeParse({ ...base, source_text: "x".repeat(50001) }).success,
    ).toBe(false);
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
  it("only accepts model duration tiers (4/5/6/8/10) and defaults to 5", () => {
    expect(storyboardSchema.parse(base).duration_s).toBe(5);
    for (const d of [4, 5, 6, 8, 10]) {
      expect(storyboardSchema.safeParse({ ...base, duration_s: d }).success).toBe(true);
    }
    for (const d of [2, 3, 7, 15]) {
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
  });
});
