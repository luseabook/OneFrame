import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { episodes, projectTimelines, scriptProjects, tasks, timelineExports } from "@app/db";
import type { Db } from "@app/db";
import type { StorageDriver } from "@app/storage";
import { escapeDrawtext, watermarkFilter } from "./label";

const run = promisify(execFile);

const FFMPEG_TIMEOUT_MS = 10 * 60_000;

export interface TimelineExportDeps {
  db: Db;
  storage: StorageDriver;
  /** ffmpeg/ffprobe 可执行路径（默认走 PATH，可用 FFMPEG_PATH/FFPROBE_PATH 覆盖） */
  ffmpegPath?: string;
  ffprobePath?: string;
  /** ADAPTER_MODE：mock 时源视频是占位字节，逐段回退 lavfi 色板以保证 dev 也能出可播放 mp4 */
  adapterMode?: "mock" | "real";
  aiLabel?: { enabled: boolean; text: string; fontPath?: string };
  log?: (obj: Record<string, unknown>, msg: string) => void;
}

interface TimelineClip {
  clip_id?: string;
  shot_id?: string;
  task_id?: string | null;
  name?: string;
  duration?: number;
}

interface VideoDims {
  width: number;
  height: number;
}

/** 成片分辨率：按项目 ratio；未知比例按 9:16 */
export function dimensionsForRatio(ratio?: string | null): VideoDims {
  if (ratio === "16:9") return { width: 1280, height: 720 };
  if (ratio === "1:1") return { width: 720, height: 720 };
  return { width: 720, height: 1280 };
}

/** 依次尝试读取 clip 源视频数据；无 task / 无结果 / 读取失败 → null（导出侧决定回退或跳过） */
async function readClipSource(deps: TimelineExportDeps, clip: TimelineClip): Promise<Buffer | null> {
  if (!clip.task_id) return null;
  try {
    const [task] = await deps.db.select().from(tasks).where(eq(tasks.id, BigInt(clip.task_id)));
    if (!task || task.status !== 3) return null;
    const results = Array.isArray(task.results) ? (task.results as Array<{ uri?: string }>) : [];
    const uri = results[0]?.uri;
    if (!uri) return null;
    if (/^https?:\/\//.test(uri)) {
      const res = await fetch(uri);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return null; // mock:// 等非存储 key
    return await deps.storage.read(uri);
  } catch {
    return null;
  }
}

async function hasVideoStream(ffprobe: string, file: string): Promise<boolean> {
  try {
    const { stdout } = await run(
      ffprobe,
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file],
      { timeout: 30_000, windowsHide: true },
    );
    return stdout.includes("video");
  } catch {
    return false;
  }
}

/** 归一化转码：统一分辨率/30fps/yuv420p/h264/无音轨，按 clip.duration 截断 */
async function normalizeSegment(
  ffmpeg: string,
  input: string,
  output: string,
  dims: VideoDims,
  durationS: number,
  log: TimelineExportDeps["log"],
): Promise<boolean> {
  const { width, height } = dims;
  const vf = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "setsar=1",
    "format=yuv420p",
  ].join(",");
  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input,
    "-vf",
    vf,
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-an",
    "-t",
    String(durationS),
    output,
  ];
  try {
    await run(ffmpeg, args, { timeout: FFMPEG_TIMEOUT_MS, windowsHide: true });
    return true;
  } catch (error) {
    log?.(
      { input, err: error instanceof Error ? error.message.slice(0, 300) : String(error) },
      "timeline segment transcode failed",
    );
    return false;
  }
}

/** mock 兼容：用 lavfi 色板 + clip 名称生成深色片段（可播放 mp4） */
async function mockSegment(
  ffmpeg: string,
  output: string,
  dims: VideoDims,
  durationS: number,
  name: string,
  fontPath?: string,
): Promise<void> {
  const { width, height } = dims;
  const fontSize = Math.max(24, Math.round(height / 24));
  const font = fontPath ? `fontfile='${fontPath.replace(/\\/g, "/").replace(":", "\\:")}':` : "";
  const safeName = escapeDrawtext(name.slice(0, 40));
  const vf =
    `drawtext=${font}text='${safeName}':x=(w-tw)/2:y=(h-th)/2:` +
    `fontsize=${fontSize}:fontcolor=white@0.9:box=1:boxcolor=black@0.35`;
  // 深色底（与产品深色主题一致），显式 30fps + yuv420p，时长 = clip.duration
  await run(
    ffmpeg,
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=0x14161d:s=${width}x${height}:d=${durationS}:r=30`,
      "-vf",
      vf,
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-an",
      "-t",
      String(durationS),
      output,
    ],
    { timeout: FFMPEG_TIMEOUT_MS, windowsHide: true },
  );
}

function concatListLine(file: string): string {
  // concat demuxer 的单引号转义：' -> '\''
  return `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`;
}

/**
 * 按分集时间线合成成片：
 * 1) 逐段取源视频（tasks.results[0].uri → storage.read）；无源/不可解码时：
 *    mock 模式回退 lavfi 色板（保证 dev 出可播放 mp4），real 模式跳过并计数 skipped；
 * 2) 统一 720x1280 / 1280x720、30fps、h264 yuv420p、无音轨；按 clip.duration 截断；
 * 3) concat demuxer 拼接 + 右下角「AI 生成」显式水印；
 * 4) 上传 u/<space>/timelines/<exportId>.mp4，状态置 3；任何失败置 4（不抛出到 worker）。
 */
export async function runTimelineExport(exportId: string, deps: TimelineExportDeps): Promise<void> {
  let id: bigint;
  try {
    id = BigInt(exportId);
  } catch {
    return;
  }
  const [row] = await deps.db.select().from(timelineExports).where(eq(timelineExports.id, id));
  if (!row) {
    deps.log?.({ export_id: exportId }, "timeline export row not found");
    return;
  }
  if (row.status === 3 || row.status === 4) return;

  await deps.db
    .update(timelineExports)
    .set({ status: 2, error: null, updatedAt: new Date() })
    .where(eq(timelineExports.id, id));

  const ffmpeg = deps.ffmpegPath ?? "ffmpeg";
  const ffprobe = deps.ffprobePath ?? "ffprobe";
  const labelEnabled = deps.aiLabel?.enabled !== false;
  const labelText = deps.aiLabel?.text ?? "AI生成";
  const mockMode = deps.adapterMode !== "real";
  let dir: string | undefined;

  try {
    const [episode] = await deps.db.select().from(episodes).where(eq(episodes.id, row.episodeId));
    if (!episode) throw new Error("episode not found");
    const [project] = await deps.db.select().from(scriptProjects).where(eq(scriptProjects.id, row.projectId));
    const [timeline] = await deps.db
      .select()
      .from(projectTimelines)
      .where(eq(projectTimelines.episodeId, row.episodeId));
    const clips = Array.isArray(timeline?.clips) ? (timeline!.clips as TimelineClip[]) : [];
    if (clips.length === 0) throw new Error("timeline is empty");

    const dims = dimensionsForRatio(project?.ratio);
    dir = await mkdtemp(join(tmpdir(), "timeline-export-"));
    const segments: string[] = [];
    let skipped = 0;
    let durationS = 0;
    let mockSegments = 0;

    for (let index = 0; index < clips.length; index += 1) {
      const clip = clips[index]!;
      const duration = Math.max(1, Math.min(30, Math.round(Number(clip.duration) || 1)));
      const segmentPath = join(dir, `seg-${String(index).padStart(3, "0")}.mp4`);
      const source = await readClipSource(deps, clip);
      let produced = false;

      if (source) {
        const sourcePath = join(dir, `src-${String(index).padStart(3, "0")}.mp4`);
        await writeFile(sourcePath, source);
        if (await hasVideoStream(ffprobe, sourcePath)) {
          produced = await normalizeSegment(ffmpeg, sourcePath, segmentPath, dims, duration, deps.log);
        }
      }

      if (!produced) {
        if (!mockMode) {
          skipped += 1;
          deps.log?.(
            { export_id: exportId, clip_id: clip.clip_id, task_id: clip.task_id ?? null },
            "timeline clip skipped (no usable source video)",
          );
          continue;
        }
        // mock 兼容：占位结果不是视频 → lavfi 深色色板 + clip 名称（可播放 mp4）
        await mockSegment(ffmpeg, segmentPath, dims, duration, String(clip.name ?? `片段 ${index + 1}`), deps.aiLabel?.fontPath);
        mockSegments += 1;
        deps.log?.(
          { export_id: exportId, clip_id: clip.clip_id, duration_s: duration },
          "timeline mock segment generated (lavfi color plate)",
        );
      }

      segments.push(segmentPath);
      durationS += duration;
    }

    if (segments.length === 0) throw new Error("no usable clips to export");

    const listPath = join(dir, "concat.txt");
    await writeFile(listPath, segments.map(concatListLine).join("\n"), "utf8");
    const outputPath = join(dir, "out.mp4");
    const watermark = labelEnabled ? watermarkFilter(labelText, deps.aiLabel?.fontPath) : undefined;
    const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath];
    if (watermark) args.push("-vf", watermark);
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-an",
      "-movflags",
      "+faststart",
      "-t",
      String(Math.max(1, durationS)),
      outputPath,
    );
    await run(ffmpeg, args, { timeout: FFMPEG_TIMEOUT_MS, windowsHide: true });
    const buffer = await readFile(outputPath);
    if (buffer.byteLength === 0) throw new Error("ffmpeg produced empty file");

    const key = `u/${row.spaceId}/timelines/${exportId}.mp4`;
    await deps.storage.put(key, buffer, "video/mp4");
    await deps.db
      .update(timelineExports)
      .set({
        status: 3,
        fileUri: key,
        clipCount: segments.length,
        skipped,
        durationS,
        watermarked: Boolean(watermark),
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(timelineExports.id, id));
    deps.log?.(
      {
        export_id: exportId,
        key,
        segments: segments.length,
        skipped,
        mock_segments: mockSegments,
        duration_s: durationS,
        watermarked: Boolean(watermark),
        bytes: buffer.byteLength,
      },
      mockSegments > 0 ? "timeline export succeeded (mock segments synthesized)" : "timeline export succeeded",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log?.({ export_id: exportId, err: message.slice(0, 500) }, "timeline export failed");
    try {
      await deps.db
        .update(timelineExports)
        .set({
          status: 4,
          error: { code: 500000, message: `timeline export failed: ${message.slice(0, 800)}` },
          updatedAt: new Date(),
        })
        .where(eq(timelineExports.id, id));
    } catch (updateError) {
      deps.log?.(
        { export_id: exportId, err: updateError instanceof Error ? updateError.message : String(updateError) },
        "timeline export status update failed",
      );
    }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
