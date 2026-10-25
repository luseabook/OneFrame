import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, episodes, models, projectTimelines, scriptProjects, spaces, tasks, timelineExports, users } from "@app/db";
import { LocalStorage } from "@app/storage";
import { newId } from "@app/shared";
import { runTimelineExport } from "../src/timeline-export";

const run = promisify(execFile);

const ffmpegAvailable =
  spawnSync("ffmpeg", ["-version"], { windowsHide: true }).status === 0 &&
  spawnSync("ffprobe", ["-version"], { windowsHide: true }).status === 0;

interface ProbeInfo {
  streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  format?: { duration?: string };
}

async function probe(file: string): Promise<ProbeInfo> {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-show_entries", "format=duration", "-of", "json", file],
    { windowsHide: true },
  );
  return JSON.parse(stdout) as ProbeInfo;
}

// 需要真实 ffmpeg/ffprobe（本机 PATH 已有 8.1.1）；缺失则整组跳过
describe.skipIf(!ffmpegAvailable)("timeline export (ffmpeg)", () => {
  const handle = createDb(process.env.DATABASE_URL ?? "postgres://app@127.0.0.1:55432/app");
  const db = handle.db;
  let storageDir = "";
  let storage: LocalStorage;
  let spaceId: bigint;
  let userId: bigint;
  let projectId: bigint;
  let episodeId: bigint;
  let modelId: bigint;
  const logs: Array<{ msg: string; obj: Record<string, unknown> }> = [];

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), "timeline-export-"));
    storage = new LocalStorage({
      rootDir: storageDir,
      publicBaseUrl: "http://127.0.0.1:3000/v1",
      signSecret: "test-secret",
    });

    const tag = String(Date.now()).slice(-9);
    userId = BigInt(`9${tag}`);
    spaceId = BigInt(`8${tag}`);
    await db.insert(users).values({ id: userId, nickname: `timeline-${tag}` });
    await db.insert(spaces).values({ id: spaceId, ownerUserId: userId });
    projectId = newId();
    await db.insert(scriptProjects).values({ id: projectId, spaceId, title: "timeline 合成测试", ratio: "9:16" });
    episodeId = newId();
    await db.insert(episodes).values({ id: episodeId, projectId, epNo: 1, title: "第1集" });
    const [model] = await db.select().from(models).limit(1);
    if (!model) throw new Error("models table empty; run seed first");
    modelId = model.id;
  });

  afterAll(async () => {
    await db.delete(timelineExports).where(eq(timelineExports.spaceId, spaceId));
    await db.delete(projectTimelines).where(eq(projectTimelines.spaceId, spaceId));
    await db.delete(tasks).where(eq(tasks.spaceId, spaceId));
    await db.delete(episodes).where(eq(episodes.projectId, projectId));
    await db.delete(scriptProjects).where(eq(scriptProjects.id, projectId));
    await db.delete(spaces).where(eq(spaces.id, spaceId));
    await db.delete(users).where(eq(users.id, userId));
    await handle.pool.end();
    await rm(storageDir, { recursive: true, force: true });
  });

  function log(obj: Record<string, unknown>, msg: string): void {
    logs.push({ msg, obj });
  }

  async function seedExport(opts: {
    withMockTaskResults: boolean;
    clipCount: number;
    durations: number[];
  }): Promise<bigint> {
    const exportId = newId();
    const clips: Array<Record<string, unknown>> = [];
    for (let i = 0; i < opts.clipCount; i += 1) {
      let taskId: string | null = null;
      if (opts.withMockTaskResults) {
        // mock 适配器的产物：占位文本字节（不是视频）→ 导出应回退 lavfi 色板
        const key = `u/${spaceId}/tasks/mock-${exportId}-${i}.mp4`;
        await storage.put(key, Buffer.from(`mock result for task ${i}`), "video/mp4");
        const id = newId();
        await db.insert(tasks).values({
          id,
          spaceId,
          userId,
          episodeId,
          capability: "video",
          mode: "text2video",
          modelId,
          input: { prompt: "mock" },
          options: {},
          status: 3,
          results: [{ uri: key }],
        });
        taskId = String(id);
      }
      clips.push({
        clip_id: `clip-${i}`,
        shot_id: `shot-${i}`,
        task_id: taskId,
        name: `片段 ${i + 1}`,
        duration: opts.durations[i] ?? 1,
      });
    }
    await db
      .insert(projectTimelines)
      .values({ id: newId(), spaceId, projectId, episodeId, clips })
      .onConflictDoUpdate({
        target: projectTimelines.episodeId,
        set: { clips, updatedAt: new Date() },
      });
    await db.insert(timelineExports).values({
      id: exportId,
      spaceId,
      projectId,
      episodeId,
      status: 1,
      clipCount: opts.clipCount,
      durationS: opts.durations.reduce((a, b) => a + b, 0),
    });
    return exportId;
  }

  it("synthesizes a playable mp4 from mock clips with AI watermark", async () => {
    const exportId = await seedExport({ withMockTaskResults: true, clipCount: 2, durations: [1, 1] });
    logs.length = 0;
    await runTimelineExport(String(exportId), {
      db,
      storage,
      adapterMode: "mock",
      aiLabel: { enabled: true, text: "AI生成" },
      log,
    });

    const [row] = await db.select().from(timelineExports).where(eq(timelineExports.id, exportId));
    expect(row?.status).toBe(3);
    expect(row?.error).toBeNull();
    expect(row?.watermarked).toBe(true);
    expect(row?.skipped).toBe(0);
    expect(row?.durationS).toBe(2);
    expect(row?.fileUri).toBe(`u/${spaceId}/timelines/${exportId}.mp4`);

    const buffer = await storage.read(row!.fileUri!);
    expect(buffer.byteLength).toBeGreaterThan(1000);
    expect(buffer.subarray(4, 8).toString()).toBe("ftyp"); // 合法 mp4 容器

    const info = await probe(join(storageDir, row!.fileUri!));
    const videoStream = info.streams?.find((s) => s.codec_type === "video");
    expect(videoStream).toBeTruthy();
    expect(videoStream?.width).toBe(720);
    expect(videoStream?.height).toBe(1280);
    const duration = Number(info.format?.duration ?? 0);
    expect(duration).toBeGreaterThan(1.6);
    expect(duration).toBeLessThan(3.2);

    // mock 回退与水印均被使用（日志可追溯）
    expect(logs.some((entry) => entry.msg.includes("mock segment"))).toBe(true);
    expect(logs.some((entry) => entry.msg.includes("timeline export succeeded"))).toBe(true);
  });

  it("fails with a clear error (status 4) when ffmpeg is missing", async () => {
    const exportId = await seedExport({ withMockTaskResults: false, clipCount: 1, durations: [1] });
    await runTimelineExport(String(exportId), {
      db,
      storage,
      // 用明确不存在的可执行文件模拟「未安装 ffmpeg」
      ffmpegPath: "definitely-not-an-ffmpeg-binary",
      adapterMode: "mock",
      aiLabel: { enabled: true, text: "AI生成" },
      log,
    });
    const [row] = await db.select().from(timelineExports).where(eq(timelineExports.id, exportId));
    expect(row?.status).toBe(4);
    const error = row?.error as { code?: number; message?: string };
    expect(error?.code).toBe(500000);
    expect(String(error?.message)).toContain("timeline export failed");
  });

  it("skips clips without usable source video in real mode (no mock fallback)", async () => {
    const exportId = await seedExport({ withMockTaskResults: false, clipCount: 2, durations: [1, 1] });
    logs.length = 0;
    await runTimelineExport(String(exportId), {
      db,
      storage,
      adapterMode: "real",
      aiLabel: { enabled: true, text: "AI生成" },
      log,
    });
    const [row] = await db.select().from(timelineExports).where(eq(timelineExports.id, exportId));
    // real 模式无源视频 → 全部跳过 → 无可合成片段，明确失败（不产出 mock 色板）
    expect(row?.status).toBe(4);
    const error = row?.error as { message?: string };
    expect(String(error?.message)).toContain("no usable clips");
    expect(logs.some((entry) => entry.msg.includes("timeline clip skipped"))).toBe(true);
  });
});

