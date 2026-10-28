import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import JSZip from "jszip";
import { createDb, episodes, exportJobs, models, scriptProjects, spaces, storyboards, tasks, users } from "@app/db";
import { LocalStorage } from "@app/storage";
import { newId } from "@app/shared";
import { runExport, trimShotBuffer, type TrimFn } from "../src/export";

const run = promisify(execFile);

const ffmpegAvailable =
  spawnSync("ffmpeg", ["-version"], { windowsHide: true }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { windowsHide: true }).status === 0;

/** 造一个 5 秒、可解码的 h264 mp4（真实 ffmpeg） */
async function makeSourceVideo(file: string): Promise<Buffer> {
  await run(
    "ffmpeg",
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=duration=5:size=320x240:rate=24",
      "-pix_fmt",
      "yuv420p",
      "-c:v",
      "libx264",
      file,
    ],
    { windowsHide: true },
  );
  return readFile(file);
}

async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
    { windowsHide: true },
  );
  return Number(stdout.trim());
}

/**
 * 第 77 批：整集导出的 zip 里，`manifest.json` 一直写着每个镜头的 `duration_s`，
 * 但 mp4 文件是原样复制的生成结果 —— 「包里写的时长」与「包里视频实际时长」不一致。
 * 这一组用例钉住两件事：① `trimShotBuffer` 的裁/不裁判定；② `runExport` 把真实处理方式
 * 写进 manifest（`file_duration_mode` / `clip_trim`），失败必须诚实标 `copy` + 原因。
 */
describe("trimShotBuffer", () => {
  it("does not trim when the storyboard has no authored duration", async () => {
    const source = Buffer.from("SOURCE-NOT-VIDEO");
    let called = false;
    const trim: TrimFn = async () => {
      called = true;
      return { ok: true, buffer: Buffer.from("SHOULD-NOT-BE-USED") };
    };
    const out = await trimShotBuffer(source, null, { trim });
    expect(called).toBe(false);
    expect(out.mode).toBe("copy");
    expect(out.durationS).toBeNull();
    expect(out.reason).toBe("storyboard has no authored duration to trim to");
    expect(out.buffer.equals(source)).toBe(true);
    expect(out.fileBytes).toBe(source.byteLength);
  });

  it("falls back to copy with the trim reason when ffmpeg is unavailable", async () => {
    const source = Buffer.from("SOURCE-NOT-VIDEO");
    const trim: TrimFn = async () => ({ ok: false, reason: "ffmpeg not found in PATH" });
    const out = await trimShotBuffer(source, 3, { trim });
    expect(out.mode).toBe("copy");
    expect(out.reason).toBe("ffmpeg not found in PATH");
    expect(out.buffer.equals(source)).toBe(true);
    expect(out.sourceBytes).toBe(source.byteLength);
    expect(out.fileBytes).toBe(source.byteLength);
  });

  it("reports ffmpeg mode and the authored duration when trimming succeeds", async () => {
    const source = Buffer.from("SOURCE-NOT-VIDEO");
    const trimmedBuffer = Buffer.from("TRIMMED-BYTES");
    const seen: Array<{ start: number; end: number }> = [];
    const trim: TrimFn = async (_buffer, startMs, endMs) => {
      seen.push({ start: startMs, end: endMs });
      return { ok: true, buffer: trimmedBuffer };
    };
    const out = await trimShotBuffer(source, 2, { trim });
    expect(seen).toEqual([{ start: 0, end: 2000 }]);
    expect(out.mode).toBe("ffmpeg");
    expect(out.durationS).toBe(2);
    expect(out.reason).toBeNull();
    expect(out.buffer.equals(trimmedBuffer)).toBe(true);
    expect(out.sourceBytes).toBe(source.byteLength);
    expect(out.fileBytes).toBe(trimmedBuffer.byteLength);
  });

  it("clamps authored duration into the 1..30s contract", async () => {
    const source = Buffer.from("SOURCE-NOT-VIDEO");
    const ends: number[] = [];
    const trim: TrimFn = async (_buffer, _startMs, endMs) => {
      ends.push(endMs);
      return { ok: true, buffer: Buffer.from("T") };
    };
    await trimShotBuffer(source, 0.2, { trim });
    await trimShotBuffer(source, 99, { trim });
    expect(ends).toEqual([1000, 30_000]);
  });

  it.skipIf(!ffmpegAvailable)("trims a real 5s video down to the authored 2s", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trim-shot-"));
    try {
      const source = await makeSourceVideo(join(dir, "source.mp4"));
      expect(await probeDuration(join(dir, "source.mp4"))).toBeGreaterThan(4.5);
      const out = await trimShotBuffer(source, 2);
      expect(out.mode).toBe("ffmpeg");
      expect(out.durationS).toBe(2);
      const trimmedFile = join(dir, "trimmed.mp4");
      await run("powershell", ["-NoProfile", "-Command", `[IO.File]::WriteAllBytes('${trimmedFile}', [Convert]::FromBase64String('${out.buffer.toString("base64")}'))`], {
        windowsHide: true,
      });
      const duration = await probeDuration(trimmedFile);
      expect(duration).toBeGreaterThan(1.5);
      expect(duration).toBeLessThan(2.6);
      expect(out.fileBytes).toBeLessThan(out.sourceBytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("runExport clip manifest", () => {
  const handle = createDb(process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app");
  const db = handle.db;
  let storageDir = "";
  let storage: LocalStorage;
  let spaceId: bigint;
  let userId: bigint;
  let projectId: bigint;
  /** 每个用例单独一集：`uq_storyboards_episode_shot(episode_id, shot_no)` 不允许同集两个 1 号镜 */
  const episodeIds: bigint[] = [];
  let epCounter = 0;
  let modelId: bigint;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), "export-trim-"));
    storage = new LocalStorage({
      rootDir: storageDir,
      publicBaseUrl: "http://127.0.0.1:3000/v1",
      signSecret: "test-secret",
    });
    const tag = String(Date.now()).slice(-9);
    userId = BigInt(`7${tag}`);
    spaceId = BigInt(`6${tag}`);
    await db.insert(users).values({ id: userId, nickname: `export-trim-${tag}` });
    await db.insert(spaces).values({ id: spaceId, ownerUserId: userId });
    projectId = newId();
    await db.insert(scriptProjects).values({ id: projectId, spaceId, title: "导出裁剪测试", ratio: "9:16" });
    const [model] = await db.select().from(models).limit(1);
    if (!model) throw new Error("models table empty; run seed first");
    modelId = model.id;
  });

  afterAll(async () => {
    await db.delete(exportJobs).where(eq(exportJobs.spaceId, spaceId));
    if (episodeIds.length > 0) {
      await db.delete(storyboards).where(inArray(storyboards.episodeId, episodeIds));
    }
    await db.delete(tasks).where(eq(tasks.spaceId, spaceId));
    if (episodeIds.length > 0) {
      await db.delete(episodes).where(inArray(episodes.id, episodeIds));
    }
    await db.delete(scriptProjects).where(eq(scriptProjects.id, projectId));
    await db.delete(spaces).where(eq(spaces.id, spaceId));
    await db.delete(users).where(eq(users.id, userId));
    await handle.pool.end();
    await rm(storageDir, { recursive: true, force: true });
  });

  /** 造「一集一镜」：源视频进 storage，任务成功且 results 指向它，分镜 authored 时长 2s */
  async function seedEpisode(source: Buffer, opts: { durationS: number | null } = { durationS: 2 }): Promise<bigint> {
    epCounter += 1;
    const episodeId = newId();
    episodeIds.push(episodeId);
    await db.insert(episodes).values({ id: episodeId, projectId, epNo: epCounter, title: `第${epCounter}集` });
    const taskId = newId();
    const key = `u/${spaceId}/tasks/${taskId}.mp4`;
    await storage.put(key, source, "video/mp4");
    await db.insert(tasks).values({
      id: taskId,
      spaceId,
      userId,
      episodeId,
      capability: "video",
      mode: "text2video",
      modelId,
      input: { prompt: "export-trim" },
      options: {},
      status: 3,
      results: [{ uri: key }],
    });
    await db.insert(storyboards).values({
      id: newId(),
      episodeId,
      shotNo: 1,
      shotDesc: "镜头一",
      durationS: opts.durationS,
      status: 3,
      videoTaskId: taskId,
    });
    const exportId = newId();
    await db.insert(exportJobs).values({ id: exportId, spaceId, episodeId, status: 1 });
    return exportId;
  }

  async function readZipManifest(exportId: bigint): Promise<{
    manifest: Record<string, unknown>;
    files: Record<string, Buffer>;
  }> {
    const [row] = await db.select().from(exportJobs).where(eq(exportJobs.id, exportId));
    expect(row?.status).toBe(3);
    const buffer = await storage.read(row!.fileUri!);
    const zip = await JSZip.loadAsync(buffer);
    const manifestRaw = await zip.file("manifest.json")!.async("string");
    const files: Record<string, Buffer> = {};
    const shotEntry = zip.file("shot-01.mp4");
    if (shotEntry) files["shot-01.mp4"] = await shotEntry.async("nodebuffer");
    return { manifest: JSON.parse(manifestRaw) as Record<string, unknown>, files };
  }

  it("records ffmpeg mode and authored duration in the manifest when trimming works", async () => {
    const source = Buffer.from("SOURCE-CLIP-BYTES");
    const trimmed = Buffer.from("TRIMMED-CLIP-BYTES");
    const exportId = await seedEpisode(source);
    const trimmedCalls: Array<{ start: number; end: number }> = [];
    await runExport(String(exportId), {
      db,
      storage,
      trim: async (_buffer, startMs, endMs) => {
        trimmedCalls.push({ start: startMs, end: endMs });
        return { ok: true, buffer: trimmed };
      },
    });

    const { manifest, files } = await readZipManifest(exportId);
    expect(trimmedCalls).toEqual([{ start: 0, end: 2000 }]);
    expect((manifest.clip_trim as Record<string, unknown>).mode).toBe("ffmpeg");
    expect((manifest.clip_trim as Record<string, unknown>).trimmed).toBe(1);
    expect((manifest.clip_trim as Record<string, unknown>).copied).toBe(0);
    const shot = (manifest.shots as Array<Record<string, unknown>>)[0]!;
    expect(shot.duration_s).toBe(2);
    expect(shot.file_duration_s).toBe(2);
    expect(shot.file_duration_mode).toBe("ffmpeg");
    expect(shot.trim_reason).toBeNull();
    expect(shot.source_bytes).toBe(source.byteLength);
    expect(shot.file_bytes).toBe(trimmed.byteLength);
    // zip 里放的确实是被裁过的字节，而不是源文件
    expect(files["shot-01.mp4"]!.equals(trimmed)).toBe(true);
  });

  it("degrades to copy and says why when trimming is unavailable", async () => {
    const source = Buffer.from("SOURCE-CLIP-BYTES");
    const exportId = await seedEpisode(source);
    await runExport(String(exportId), {
      db,
      storage,
      trim: async () => ({ ok: false, reason: "ffmpeg not found in PATH" }),
    });

    const { manifest, files } = await readZipManifest(exportId);
    expect((manifest.clip_trim as Record<string, unknown>).mode).toBe("copy");
    expect((manifest.clip_trim as Record<string, unknown>).copied).toBe(1);
    expect((manifest.clip_trim as Record<string, unknown>).reasons).toEqual(["ffmpeg not found in PATH"]);
    const shot = (manifest.shots as Array<Record<string, unknown>>)[0]!;
    expect(shot.file_duration_mode).toBe("copy");
    expect(shot.file_duration_s).toBeNull();
    expect(shot.trim_reason).toBe("ffmpeg not found in PATH");
    expect(files["shot-01.mp4"]!.equals(source)).toBe(true);
  });

  it("still copies (and says so) when the storyboard has no authored duration", async () => {
    const source = Buffer.from("SOURCE-CLIP-BYTES");
    const exportId = await seedEpisode(source, { durationS: null });
    await runExport(String(exportId), { db, storage });

    const { manifest } = await readZipManifest(exportId);
    expect((manifest.clip_trim as Record<string, unknown>).mode).toBe("copy");
    expect((manifest.clip_trim as Record<string, unknown>).reasons).toEqual([
      "storyboard has no authored duration to trim to",
    ]);
    const shot = (manifest.shots as Array<Record<string, unknown>>)[0]!;
    expect(shot.duration_s).toBeNull();
    expect(shot.file_duration_mode).toBe("copy");
  });

  it.skipIf(!ffmpegAvailable)("trims a real 5s clip to the authored 2s inside the zip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "export-trim-real-"));
    try {
      const source = await makeSourceVideo(join(dir, "source.mp4"));
      const exportId = await seedEpisode(source);
      await runExport(String(exportId), { db, storage });
      const { manifest, files } = await readZipManifest(exportId);
      expect((manifest.clip_trim as Record<string, unknown>).mode).toBe("ffmpeg");
      const shot = (manifest.shots as Array<Record<string, unknown>>)[0]!;
      expect(shot.file_duration_mode).toBe("ffmpeg");
      expect(shot.file_duration_s).toBe(2);
      const file = join(dir, "from-zip.mp4");
      await run(
        "powershell",
        ["-NoProfile", "-Command", `[IO.File]::WriteAllBytes('${file}', [Convert]::FromBase64String('${files["shot-01.mp4"]!.toString("base64")}'))`],
        { windowsHide: true },
      );
      const duration = await probeDuration(file);
      expect(duration).toBeGreaterThan(1.5);
      expect(duration).toBeLessThan(2.6);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
