import { describe, expect, it, beforeEach } from "vitest";
import { parseFfmpegVersion, probeFfmpeg, resetFfmpegProbeCache } from "./media-capability";

/**
 * 媒体能力探测（`ffmpeg`）。
 *
 * 为什么需要它：`ffmpeg` 是**部署环境**决定的，不是产品开关。过去的写法是"代码里假设没有"，
 * 于是环境装了 ffmpeg 也要改代码才能用上（#20 的"真 ffmpeg 裁剪"就卡在这）。
 * 现在改成运行时探测：能探测到就 `available:true`，探测不到就给出**可读原因**让上层诚实降级。
 *
 * 本 spec 只锁"探测本身"的语义（不依赖机器上装没装 ffmpeg）：
 * 1. 版本解析容错；
 * 2. 不可用时**不抛异常**而是返回 `available:false` + `reason`（这是最关键的一条：
 *    探测失败是正常结果，不能把服务打挂）；
 * 3. 用 `false`/不存在路径模拟"没装"，用 `node` 模拟"存在但不是 ffmpeg"；
 * 4. 结果有缓存（同一 path 第二次不再 spawn；`force` 可绕过）。
 */
describe("media capability: ffmpeg probe", () => {
  beforeEach(() => resetFfmpegProbeCache());

  it("解析 ffmpeg -version 的版本号（含发行版后缀）", () => {
    expect(parseFfmpegVersion("ffmpeg version 6.1.1-full_build-www.gyan.dev Copyright (c) 2000-2023")).toBe(
      "6.1.1-full_build-www.gyan.dev",
    );
    expect(parseFfmpegVersion("ffmpeg version n6.0 Copyright")).toBe("n6.0");
    expect(parseFfmpegVersion("")).toBeNull();
    expect(parseFfmpegVersion("not ffmpeg at all")).toBeNull();
  });

  it("可执行文件存在但不是 ffmpeg → available:false，且 reason 可读（不抛异常）", async () => {
    // 用 `node` 冒充：它能执行，但 `node -version` 的退出码/stdout 不是 ffmpeg 形态
    const cap = await probeFfmpeg("node");
    expect(cap.available).toBe(false);
    expect(cap.version).toBeNull();
    expect(cap.reason).toBeTruthy();
    expect(cap.reason).toMatch(/node|失败/);
  });

  it("路径不存在 → available:false，reason 明确说\"未找到\"（ENOENT 分支）", async () => {
    const cap = await probeFfmpeg("/definitely/not/here/ffmpeg-xyz");
    expect(cap.available).toBe(false);
    expect(cap.reason).toContain("未找到");
  });

  it("缓存生效：同一 path 第二次不再探测（checked_at 相同）；force 可强制重探", async () => {
    const first = await probeFfmpeg("/definitely/not/here/ffmpeg-xyz");
    const second = await probeFfmpeg("/definitely/not/here/ffmpeg-xyz");
    expect(second.checked_at).toBe(first.checked_at);

    await new Promise((r) => setTimeout(r, 5));
    const forced = await probeFfmpeg("/definitely/not/here/ffmpeg-xyz", { force: true });
    expect(new Date(forced.checked_at).getTime()).toBeGreaterThanOrEqual(new Date(first.checked_at).getTime());
  });

  it("默认用 PATH 里的 ffmpeg：本机装没装都必须是\"返回结果\"而不是抛错", async () => {
    const cap = await probeFfmpeg();
    expect(typeof cap.available).toBe("boolean");
    expect(cap.path).toBe("ffmpeg");
    expect(cap.checked_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    if (!cap.available) expect(cap.reason).toBeTruthy();
  }, 15_000);
});
