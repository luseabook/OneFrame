// 切片发布转码（第 57 批）：worker 侧消费 `publish.transcode`。
//
// 状态机本体在 `@app/shared runPublishTranscode`——API 内联路径与这里**共用同一份实现**，
// 所以两边对"终态不覆盖 / 降级留痕 / 失败不抛"的语义不可能漂移。
// 本文件只做一件事：把 worker 手里已有的 db / storage 适配成 `PublishTranscodeDeps`。
//
// 为什么值得从 API 搬出来：API 进程内的 fire-and-forget 在重启时会**丢失**正在转码的发布
// （看门狗会把停在 1/2 态的记录判为失败）；下沉到队列后任务在 Redis 里，worker 重启会重投。

import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { timelinePublications } from "@app/db";
import type { Db } from "@app/db";
import {
  ErrorCode,
  PUB_STATUS_FAILED,
  PUB_STATUS_QUEUED,
  PUB_STATUS_READY,
  PUB_STATUS_TRANSCODING,
  publicationObjectKey,
  runPublishTranscode,
} from "@app/shared";
import type { PublishTranscodeDeps, PublishTranscodeOutcome } from "@app/shared";
import type { StorageDriver } from "@app/storage";

export interface PublishTranscodeJobData {
  publicationId: string;
  spaceId: string;
  sourceKey: string;
}

export interface PublishTranscodeJobDeps {
  db: Db;
  storage: StorageDriver;
  log?: (obj: Record<string, unknown>, msg: string) => void;
}

/** shareToken 唯一键兜底：冲突就换一个（最多 3 次，超出即抛）——与 api 侧同口径 */
async function uniqueShareToken(db: Db): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = randomBytes(16).toString("hex");
    const [existing] = await db
      .select({ id: timelinePublications.id })
      .from(timelinePublications)
      .where(eq(timelinePublications.shareToken, token))
      .limit(1);
    if (!existing) return token;
  }
  throw new Error("failed to allocate unique share token");
}

export function buildPublishTranscodeDeps(
  deps: PublishTranscodeJobDeps,
): PublishTranscodeDeps {
  const { db, storage } = deps;
  const idOf = (id: string): bigint | null => {
    try {
      return BigInt(id);
    } catch {
      return null;
    }
  };

  return {
    loadPublication: async (id: string) => {
      const bigintId = idOf(id);
      if (bigintId === null) return null;
      const [row] = await db
        .select({ status: timelinePublications.status, slice: timelinePublications.slice })
        .from(timelinePublications)
        .where(eq(timelinePublications.id, bigintId));
      return row ? { status: row.status, slice: row.slice } : null;
    },
    markTranscoding: async (id: string) => {
      const bigintId = idOf(id);
      if (bigintId === null) return;
      await db
        .update(timelinePublications)
        .set({ status: PUB_STATUS_TRANSCODING, error: null, updatedAt: new Date() })
        .where(eq(timelinePublications.id, bigintId));
    },
    readSource: (key: string) => storage.read(key),
    putFile: async (key: string, buffer: Buffer) => {
      await storage.put(key, buffer, "video/mp4");
    },
    nextShareToken: () => uniqueShareToken(db),
    markReady: async (id: string, patch) => {
      const bigintId = idOf(id);
      if (bigintId === null) return;
      await db
        .update(timelinePublications)
        .set({
          status: PUB_STATUS_READY,
          fileUri: patch.fileUri,
          shareToken: patch.shareToken,
          publishedAt: new Date(),
          transcodeMode: patch.transcodeMode,
          transcodeReason: patch.transcodeReason,
          error: null,
          updatedAt: new Date(),
        })
        // 幂等保护：worker 重投可能撞上已经被别的实例改成终态的记录，
        // 此时不能再写回去（否则会把已发布作品打回转码中）。状态机在 runPublishTranscode
        // 入口已查过终态，这里再加一道条件更新，防两个 worker 同时消费同一 job 的竞态。
        .where(
          and(
            eq(timelinePublications.id, bigintId),
            inArray(timelinePublications.status, [PUB_STATUS_QUEUED, PUB_STATUS_TRANSCODING]),
          ),
        );
    },
    markFailed: async (id: string, reason: string) => {
      const bigintId = idOf(id);
      if (bigintId === null) return;
      await db
        .update(timelinePublications)
        .set({
          status: PUB_STATUS_FAILED,
          error: {
            code: ErrorCode.VENDOR_ERROR,
            message: `publication transcode failed: ${reason}`,
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(timelinePublications.id, bigintId),
            inArray(timelinePublications.status, [PUB_STATUS_QUEUED, PUB_STATUS_TRANSCODING]),
          ),
        )
        .catch(() => undefined);
    },
  };
}

/**
 * 消费一条 `publish.transcode` 任务。
 *
 * **不抛异常**：状态机自己会把失败落到 status=4（带 error 原因）。抛出去只会让 BullMQ 把
 * job 标成 failed 并重试一次——而转码失败通常是确定性的（源文件坏了/磁盘满），
 * 重试只是白烧 CPU，且记录已经是失败态了，重试还会被终态检查挡掉。返回 outcome 供 job 日志。
 */
export async function runPublishTranscodeJob(
  deps: PublishTranscodeJobDeps,
  data: PublishTranscodeJobData,
): Promise<PublishTranscodeOutcome> {
  const { publicationId, spaceId, sourceKey } = data;
  const outcome = await runPublishTranscode(buildPublishTranscodeDeps(deps), {
    publicationId,
    spaceId,
    sourceKey,
  });
  deps.log?.(
    {
      publication_id: publicationId,
      result: outcome.result,
      transcode_mode: outcome.transcodeMode,
      reason: outcome.reason,
    },
    "publish transcode finished",
  );
  return outcome;
}

export { publicationObjectKey };
