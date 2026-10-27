import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { probeFfmpeg } from "@app/shared";
import { trimVideoBuffer } from "../src/modules/script/ffmpeg-trim";

/**
 * 切片发布的**真裁剪**（ffmpeg）。
 *
 * 背景：#20 长期挂着"真 ffmpeg 裁剪（现为产物复制）"。上一批把 ffmpeg 改成运行时探测
 * （`GET /meta/capabilities`），这批把裁剪真正接上——所以必须有**能证明"真的裁了"**的测试，
 * 而不是"没报错就算过"。
 *
 * 本 spec 用真实 mp4 验证四件事：
 * 1. 裁 1s–3s 后，产物**能解码**且**时长≈2s**（不是把原片复制一份）；
 * 2. 区间过短（<200ms）→ 拒绝裁剪并给原因（避免产出 0 帧文件）；
 * 3. 空 buffer → 拒绝并给原因；
 * 4. **机器上没有 ffmpeg 时整组跳过**（skip 而不是 fail）：CI/开发机不该因为没有 ffmpeg 就红，
 *    但一旦有 ffmpeg 就必须真裁——这条是"探测 + 诚实降级"的落地。
 */
const run = promisify(execFile);

describe("ffmpeg trim (publication slice)", () => {
  let dir = "";
  let source: Buffer;
  let hasFfmpeg = false;

  /** 用 ffmpeg 现造一段 5s 的彩条视频（testsrc），再读成 Buffer 当"成片产物" */
  beforeAll(async () => {
    const cap = await probeFfmpeg();
    hasFfmpeg = cap.available;
    if (!hasFfmpeg) return;
    dir = await mkdtemp(join(tmpdir(), "trim-spec-"));
    const src = join(dir, "src.mp4");
    await run(cap.path, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:rate=25:duration=5",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      src,
    ]);
    source = readFileSync(src);
  }, 120_000);

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  });

  /** 读 mp4 时长（毫秒）：优先 ffprobe，缺失时退回解析 ffmpeg -i 的 stderr */
  const durationMs = async (buf: Buffer): Promise<number> => {
    const cap = await probeFfmpeg();
    const tmp = await mkdtemp(join(tmpdir(), "dur-"));
    const file = join(tmp, "x.mp4");
    try {
      await writeFile(file, buf);
      try {
        const { stdout } = await run("ffprobe", [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=nw=1:nk=1",
          file,
        ]);
        return Math.round(Number(stdout.trim()) * 1000);
      } catch {
        // 没有 ffprobe：从 `ffmpeg -i` 的 stderr 里读 Duration
        const err = await run(cap.path, ["-i", file]).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }));
        const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(String(err.stderr ?? ""));
        if (!m) return 0;
        return Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
      }
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  it("裁 1s–3s：产物可解码且时长≈2s（真裁剪，不是复制）", async () => {
    if (!hasFfmpeg) {
      console.log("  (skip) 本机无 ffmpeg —— 探测结果为不可用，按设计跳过真裁剪断言");
      return;
    }
    const result = await trimVideoBuffer(source, 1000, 3000);
    expect(result.ok).toBe(true);
    expect(result.buffer && result.buffer.byteLength > 0).toBe(true);
    const ms = await durationMs(result.buffer!);
    // 允许 ±600ms（重编码对首尾帧对齐有微小偏差）
    expect(Math.abs(ms - 2000)).toBeLessThanOrEqual(600);
  }, 180_000);

  it("区间过短（<200ms）→ 拒绝裁剪并给可读原因（不产出 0 帧文件）", async () => {
    const result = await trimVideoBuffer(source ?? Buffer.from("x"), 1000, 1100);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("too short");
  });

  it("空 buffer → 拒绝并给原因", async () => {
    const result = await trimVideoBuffer(Buffer.alloc(0), 0, 2000);
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("不可解码的字节 → 返回 ok:false 而不是抛异常（调用方据此降级为复制并留痕）", async () => {
    if (!hasFfmpeg) return;
    const result = await trimVideoBuffer(Buffer.from("not a real mp4 at all"), 0, 1000);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("ffmpeg trim failed");
  }, 120_000);
});
