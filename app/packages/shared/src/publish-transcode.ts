import { trimVideoBuffer, type TrimResult } from "./ffmpeg-trim";

/**
 * 切片发布的**转码状态机**（`timeline_publications`：1 排队 → 2 转码中 → 3 可播放 / 4 失败）。
 *
 * 为什么单独抽到 `@app/shared`：这条状态机在**两个进程**里都要跑——
 * ① 生产：API 只入队，worker 消费并真转码（`apps/worker/src/publish-transcode.ts`）；
 * ② 开发/测试：没有常驻 worker 时 API 直接内联跑（`POST .../timeline/publish` 之后
 *    fire-and-forget），否则跑一次 E2E 就得先起 worker。
 * 两份实现必然漂移（改了一处忘了另一处，就会出现"队列里成功、内联路径失败"这种
 * 只在生产才复现的问题），所以状态机**只写一份**，由调用方注入 IO。
 *
 * 三条不变量（API 侧原实现即有，抽取时原样保留）：
 * 1. **终态不可覆盖**：3/4/5 直接跳过，重复触发（重试、队列重投）不会把已发布作品打回失败；
 * 2. **降级留痕**：能裁就裁（`transcode_mode="ffmpeg"`），不能裁就复制并记 `transcode_reason`——
 *    绝不"悄悄复制却对外说裁过"；
 * 3. **失败不抛**：异常一律落 status=4 + `error`，调用方拿到的是 outcome 而不是异常
 *    （队列任务不该因为"片源不可解码"无限重投）。
 */

/** 与 `timeline_publications.status` 对齐（DB 里是 smallint） */
export const PUB_STATUS_QUEUED = 1;
export const PUB_STATUS_TRANSCODING = 2;
export const PUB_STATUS_READY = 3;
export const PUB_STATUS_FAILED = 4;
export const PUB_STATUS_REMOVED = 5;

/** 终态：命中即跳过（幂等/防覆盖） */
export const PUB_TERMINAL_STATUSES: readonly number[] = [
  PUB_STATUS_READY,
  PUB_STATUS_FAILED,
  PUB_STATUS_REMOVED,
];

export interface PublishTranscodeRow {
  status: number;
  /** 发布时的区间 `{ start_ms?, end_ms?, clip_ids? }`；空对象表示整片 */
  slice: unknown;
}

export interface PublishTranscodeReadyPatch {
  fileUri: string;
  shareToken: string;
  transcodeMode: "ffmpeg" | "copy";
  transcodeReason: string | null;
}

export interface PublishTranscodeDeps {
  loadPublication(id: string): Promise<PublishTranscodeRow | null>;
  markTranscoding(id: string): Promise<void>;
  readSource(key: string): Promise<Buffer | null>;
  putFile(key: string, buffer: Buffer): Promise<void>;
  nextShareToken(): Promise<string>;
  markReady(id: string, patch: PublishTranscodeReadyPatch): Promise<void>;
  markFailed(id: string, reason: string): Promise<void>;
  /** 测试注入点：默认走 `trimVideoBuffer`（真 ffmpeg，失败返回 ok:false 而不抛） */
  trim?: (buffer: Buffer, startMs: number, endMs: number) => Promise<TrimResult>;
}

export interface PublishTranscodeInput {
  publicationId: string;
  spaceId: string;
  /** 源成片在 storage 里的 key（发布时那次 timeline export 的产物） */
  sourceKey: string;
}

export interface PublishTranscodeOutcome {
  result: "ready" | "failed" | "skipped";
  transcodeMode?: "ffmpeg" | "copy";
  reason?: string;
}

/** 成片在 storage 的落点（与发布记录同 id，删除导出文件不影响已发布作品） */
export function publicationObjectKey(spaceId: string, publicationId: string): string {
  return `u/${spaceId}/publications/${publicationId}.mp4`;
}

export async function runPublishTranscode(
  deps: PublishTranscodeDeps,
  input: PublishTranscodeInput,
): Promise<PublishTranscodeOutcome> {
  const { publicationId, spaceId, sourceKey } = input;
  const trim = deps.trim ?? trimVideoBuffer;

  const row = await deps.loadPublication(publicationId);
  if (!row) return { result: "skipped", reason: "publication not found" };
  if (PUB_TERMINAL_STATUSES.includes(row.status)) {
    return { result: "skipped", reason: `publication already in terminal status ${row.status}` };
  }

  try {
    await deps.markTranscoding(publicationId);

    const source = await deps.readSource(sourceKey);
    if (!source || source.byteLength === 0) throw new Error("rendered product is empty");

    const slice = (row.slice ?? {}) as Record<string, unknown>;
    let buffer = source;
    let mode: "ffmpeg" | "copy" = "copy";
    let degradeReason: string | null = null;
    const trimmed = await trim(source, Number(slice.start_ms ?? 0), Number(slice.end_ms ?? 0));
    if (trimmed.ok && trimmed.buffer) {
      buffer = trimmed.buffer;
      mode = "ffmpeg";
    } else {
      degradeReason = trimmed.reason ?? "trim skipped";
    }

    const key = publicationObjectKey(spaceId, publicationId);
    await deps.putFile(key, buffer);
    const token = await deps.nextShareToken();
    await deps.markReady(publicationId, {
      fileUri: key,
      shareToken: token,
      transcodeMode: mode,
      transcodeReason: degradeReason,
    });
    return { result: "ready", transcodeMode: mode, ...(degradeReason ? { reason: degradeReason } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.markFailed(publicationId, message.slice(0, 500));
    return { result: "failed", reason: message };
  }
}
