import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { probeFfmpeg } from "./media-capability";

const run = promisify(execFile);

/**
 * 按时间区间**真裁剪**一段视频（ffmpeg）。
 *
 * 为什么独立成模块：切片发布的裁剪逻辑要能被单测直接喂真实 mp4（不经过 DB/storage），
 * 否则"真裁剪"永远只能靠集成测试间接证明。
 *
 * 关键取舍：
 * 1. **不用 `-c copy`**：copy 按关键帧对齐，尾部会多带内容，而对外发布的切片时长必须准
 *    → 用 `-ss/-to` 在 `-i` 之后（解码后裁）并重编码（libx264 + aac、`+faststart` 便于边下边播）。
 * 2. **失败绝不抛**：返回 `{ok:false, reason}`，由调用方**降级为复制并留痕**——
 *    没装 ffmpeg、片源不可解码、区间过短都是正常情况，不能把发布打成 500。
 * 3. 临时目录一定清理（`finally`），避免长跑进程攒临时文件。
 */
export interface TrimResult {
  ok: boolean;
  buffer?: Buffer;
  reason?: string;
  /** 实际用了哪个 ffmpeg（审计/排查用） */
  ffmpegPath?: string;
}

/** 区间小于 200ms 视为"不该裁"（ffmpeg 在极短区间上容易产出 0 帧） */
const MIN_TRIM_MS = 200;

export async function trimVideoBuffer(
  buffer: Buffer,
  startMs: number,
  endMs: number,
  options: { ffmpegPath?: string; timeoutMs?: number } = {},
): Promise<TrimResult> {
  const start = Math.max(0, Math.round(Number(startMs) || 0));
  const end = Math.round(Number(endMs) || 0);
  if (!Number.isFinite(end) || end - start < MIN_TRIM_MS) {
    return { ok: false, reason: "slice interval too short for trimming" };
  }
  if (!buffer || buffer.byteLength === 0) {
    return { ok: false, reason: "source buffer is empty" };
  }

  const cap = await probeFfmpeg(options.ffmpegPath ?? process.env.FFMPEG_PATH);
  if (!cap.available) return { ok: false, reason: cap.reason ?? "ffmpeg unavailable" };

  const dir = await mkdtemp(join(tmpdir(), "pub-trim-"));
  const input = join(dir, "in.mp4");
  const output = join(dir, "out.mp4");
  try {
    await writeFile(input, buffer);
    await run(
      cap.path,
      [
        "-y",
        "-i",
        input,
        "-ss",
        String(start / 1000),
        "-to",
        String(end / 1000),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeout: options.timeoutMs ?? 120_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    );
    const trimmed = await readFile(output);
    if (trimmed.byteLength === 0) return { ok: false, reason: "ffmpeg produced empty output" };
    return { ok: true, buffer: trimmed, ffmpegPath: cap.path };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `ffmpeg trim failed: ${message.slice(0, 300)}`, ffmpegPath: cap.path };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
