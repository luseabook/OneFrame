import JSZip from "jszip";
import { and, eq, inArray } from "drizzle-orm";
import { episodes, exportJobs, storyboards, tasks } from "@app/db";
import type { Db } from "@app/db";
import { assertKeyInSpace, type StorageDriver } from "@app/storage";
import { downloadBounded, trimVideoBuffer, type TrimResult } from "@app/shared";

/** 注入点（测试用）：默认走真 ffmpeg 的 `trimVideoBuffer` */
export type TrimFn = (
  buffer: Buffer,
  startMs: number,
  endMs: number,
  options?: { ffmpegPath?: string },
) => Promise<TrimResult>;

export interface ExportDeps {
  db: Db;
  storage: StorageDriver;
  log?: (obj: Record<string, unknown>, msg: string) => void;
  /** ffmpeg 可执行路径（默认 PATH；可用 FFMPEG_PATH 覆盖） */
  ffmpegPath?: string;
  /** 测试注入点：默认 `trimVideoBuffer` */
  trim?: TrimFn;
  /** 远程产物下载的总时长上限（默认 5 分钟；与 executor 的传输上限一致） */
  downloadTimeoutMs?: number;
  /** 远程产物下载的总字节上限（默认 256MiB；与 label 的上限一致） */
  downloadMaxBytes?: number;
}

type TaskResult = { uri?: string };

/** 分镜时长下限/上限（与 `storyboards.duration_s` 的契约一致：1..30 秒整数） */
const MIN_SHOT_S = 1;
const MAX_SHOT_S = 30;

export interface ShotTrimResult {
  buffer: Buffer;
  /** `ffmpeg` = 真按分镜时长裁过；`copy` = 原样复制（含原因） */
  mode: "ffmpeg" | "copy";
  reason: string | null;
  /** 实际写入 zip 的时长（秒）；未裁时为 null（长度由源视频决定） */
  durationS: number | null;
  sourceBytes: number;
  fileBytes: number;
}

/**
 * 把「一次生成出的镜头视频」按**分镜表里 authored 的时长**裁齐。
 *
 * 为什么需要它（第 77 批）：整集导出的 zip 里，`manifest.json` 一直写着每个镜头的
 * `duration_s`，但 mp4 文件是**原样复制**的生成结果 —— 生成模型给的时长与分镜表并不一致
 * （可能更长，也可能更短），于是「包里写的时长」和「包里视频的实际时长」是两回事。
 * 成片合成那条通道（`timeline-export.ts` 的 `normalizeSegment`）早就按 `-t duration` 裁过，
 * 只有 zip 通道没裁；这一条补齐后两条通道对「镜头时长」的语义一致。
 *
 * 诚实降级（与 #20 的切片发布同一套口径）：没有 ffmpeg / 源不可解码时**照旧复制**，
 * 但把 `mode="copy"` 与原因写进 manifest，绝不「悄悄没裁却宣称裁了」。
 * 另外 `duration_s` 为空时**不裁**（宁可原样交付，也不猜一个时长把片子截短）。
 */
export async function trimShotBuffer(
  source: Buffer,
  durationS: number | null | undefined,
  options: { ffmpegPath?: string; trim?: TrimFn } = {},
): Promise<ShotTrimResult> {
  const sourceBytes = source.byteLength;
  const authored =
    durationS === null || durationS === undefined
      ? null
      : Math.max(MIN_SHOT_S, Math.min(MAX_SHOT_S, Math.round(Number(durationS) || 0)));
  if (authored === null || !Number.isFinite(authored) || authored <= 0) {
    return {
      buffer: source,
      mode: "copy",
      reason: "storyboard has no authored duration to trim to",
      durationS: null,
      sourceBytes,
      fileBytes: sourceBytes,
    };
  }

  const trim = options.trim ?? trimVideoBuffer;
  const result = await trim(source, 0, authored * 1000, { ffmpegPath: options.ffmpegPath });
  if (result.ok && result.buffer && result.buffer.byteLength > 0) {
    return {
      buffer: result.buffer,
      mode: "ffmpeg",
      reason: null,
      durationS: authored,
      sourceBytes,
      fileBytes: result.buffer.byteLength,
    };
  }
  return {
    buffer: source,
    mode: "copy",
    reason: result.reason ?? "trim unavailable",
    durationS: null,
    sourceBytes,
    fileBytes: sourceBytes,
  };
}

async function readResult(deps: ExportDeps, spaceId: string, uri: string): Promise<Buffer> {
  if (/^https?:\/\//.test(uri)) {
    // 第 119 批：原来裸 `fetch()` + `arrayBuffer()` —— 供应商 CDN 连上不发完就挂死整条导出，
    // 发 4GB 就 OOM（导出侧必须整块进内存）。统一走双上限下载。
    return downloadBounded(uri, {
      timeoutMs: deps.downloadTimeoutMs,
      maxBytes: deps.downloadMaxBytes,
    });
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) throw new Error(`unsupported result uri: ${uri.slice(0, 20)}`);
  return deps.storage.read(assertKeyInSpace(spaceId, uri));
}

// 整集导出：只打包已成功的镜头；无可用视频 → FAILED 400106（前端提示补齐）
export async function runExport(exportId: string, deps: ExportDeps): Promise<void> {
  const id = BigInt(exportId);
  const [row] = await deps.db.select().from(exportJobs).where(eq(exportJobs.id, id));
  if (!row) throw new Error(`export not found: ${exportId}`);
  if (row.status === 3 || row.status === 4) return;

  await deps.db
    .update(exportJobs)
    .set({ status: 2, updatedAt: new Date() })
    .where(eq(exportJobs.id, id));

  try {
    const [episode] = await deps.db.select().from(episodes).where(eq(episodes.id, row.episodeId));
    if (!episode) throw new Error("episode not found");
    const shots = await deps.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.episodeId, row.episodeId))
      .orderBy(storyboards.shotNo);
    const taskIds = shots.map((s) => s.videoTaskId).filter((v): v is bigint => v !== null);
    const taskRows =
      taskIds.length > 0
        ? await deps.db.select().from(tasks).where(and(inArray(tasks.id, taskIds), eq(tasks.status, 3)))
        : [];
    const taskById = new Map(taskRows.map((t) => [String(t.id), t]));

    const zip = new JSZip();
    const manifest = {
      export_id: exportId,
      episode: { ep_no: episode.epNo, title: episode.title, synopsis: episode.synopsis },
      /**
       * N-12（2026-11-03）：本集的 synopsis/scriptText 是否由 mock LLM 生成。
       * 与 `ai_label` 同源但**不同义**：`ai_label` 说"这是 AI 生成的"，
       * `llm_mock` 说"这是**假** AI 生成的（确定性占位文案，不是真模型输出）"。
       * 导出物离开系统后这是唯一能自证来源的字段，所以必须写进 manifest。
       */
      llm_mock: episode.llmMock === true,
      generated_at: new Date().toISOString(),
      ai_label: { ai_generated: true, standard: "GB 45438 / 生成合成内容标识办法", explicit: false, implicit: true },
      /** 每个镜头文件的处理方式汇总（第 77 批）：`ffmpeg` = 按分镜时长真裁过，`copy` = 原样复制 */
      clip_trim: {
        mode: "copy" as "ffmpeg" | "copy" | "mixed",
        trimmed: 0,
        copied: 0,
        reasons: [] as string[],
      },
      shots: [] as Array<Record<string, unknown>>,
    };

    for (const shot of shots) {
      const task = shot.videoTaskId ? taskById.get(String(shot.videoTaskId)) : undefined;
      const uri = (task?.results as TaskResult[] | null)?.[0]?.uri;
      if (!uri) continue;
      const fileName = `shot-${String(shot.shotNo).padStart(2, "0")}.mp4`;
      try {
        const source = await readResult(deps, String(row.spaceId), uri);
        const trimmed = await trimShotBuffer(source, shot.durationS, {
          ffmpegPath: deps.ffmpegPath,
          trim: deps.trim,
        });
        zip.file(fileName, trimmed.buffer);
        if (trimmed.mode === "ffmpeg") manifest.clip_trim.trimmed += 1;
        else {
          manifest.clip_trim.copied += 1;
          if (trimmed.reason && !manifest.clip_trim.reasons.includes(trimmed.reason)) {
            manifest.clip_trim.reasons.push(trimmed.reason);
          }
        }
        const resultMeta = (task?.results as Array<{ meta?: { ai_label?: { explicit?: boolean } } }> | null)?.[0]?.meta;
        const aiLabel = resultMeta?.ai_label;
        if (aiLabel?.explicit) manifest.ai_label.explicit = true;
        manifest.shots.push({
          shot_no: shot.shotNo,
          shot_desc: shot.shotDesc,
          /** 分镜表里 authored 的时长（秒） */
          duration_s: shot.durationS,
          /** 文件实际时长：真裁过 = authored；复制 = null（由源视频决定） */
          file_duration_s: trimmed.durationS,
          file_duration_mode: trimmed.mode,
          trim_reason: trimmed.reason,
          source_bytes: trimmed.sourceBytes,
          file_bytes: trimmed.fileBytes,
          ratio: shot.ratio,
          resolution: shot.resolution,
          task_id: shot.videoTaskId ? String(shot.videoTaskId) : null,
          file: fileName,
          ai_label: aiLabel ?? null,
        });
      } catch (error) {
        deps.log?.(
          { export_id: exportId, shot_no: shot.shotNo, err: error instanceof Error ? error.message : String(error) },
          "export skip result",
        );
      }
    }

    // 汇总模式：全裁过 = ffmpeg；全没裁 = copy；混合 = mixed（不留「看起来都一样」的模糊态）
    manifest.clip_trim.mode =
      manifest.clip_trim.trimmed > 0 && manifest.clip_trim.copied === 0
        ? "ffmpeg"
        : manifest.clip_trim.trimmed === 0
          ? "copy"
          : "mixed";

    // PRD F2⑦：成功镜 <80% 拒绝导出（400106）
    const successRate = shots.length > 0 ? manifest.shots.length / shots.length : 0;
    if (manifest.shots.length === 0 || successRate < 0.8) {
      await deps.db
        .update(exportJobs)
        .set({
          status: 4,
          error: {
            code: 400106,
            message:
              manifest.shots.length === 0
                ? "no video results to export"
                : `only ${Math.round(successRate * 100)}% shots succeeded (min 80%)`,
          },
          updatedAt: new Date(),
        })
        .where(eq(exportJobs.id, id));
      return;
    }

    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    const key = `u/${row.spaceId}/exports/${id}/episode-${episode.epNo}.zip`;
    await deps.storage.put(
      assertKeyInSpace(String(row.spaceId), key),
      buffer,
      "application/zip",
    );
    await deps.db
      .update(exportJobs)
      .set({
        status: 3,
        fileUri: key,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        updatedAt: new Date(),
      })
      .where(eq(exportJobs.id, id));
  } catch (error) {
    deps.log?.(
      { export_id: exportId, err: error instanceof Error ? error.message : String(error) },
      "export failed",
    );
    await deps.db
      .update(exportJobs)
      .set({
        status: 4,
        error: { code: 500000, message: error instanceof Error ? error.message : String(error) },
        updatedAt: new Date(),
      })
      .where(eq(exportJobs.id, id));
  }
}
