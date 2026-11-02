// 切片发布转码（第 57 批）：worker 侧消费 `publish.transcode`。
//
// 状态机本体在 `@app/shared runPublishTranscode`——API 内联路径与这里**共用同一份实现**，
// 所以两边对"终态不覆盖 / 降级留痕 / 失败不抛"的语义不可能漂移。
// 本文件只做一件事：把 worker 手里已有的 db / storage 适配成 `PublishTranscodeDeps`。
//
// 为什么值得从 API 搬出来：API 进程内的 fire-and-forget 在重启时会**丢失**正在转码的发布
// （看门狗会把停在 1/2 态的记录判为失败）；下沉到队列后任务在 Redis 里，worker 重启会重投。

import { randomBytes } from "node:crypto";
import { and, eq, lt, or, inArray } from "drizzle-orm";
import { timelineExports, timelinePublications } from "@app/db";
import type { Db } from "@app/db";
import {
  ErrorCode,
  PUB_STATUS_FAILED,
  PUB_STATUS_QUEUED,
  PUB_STATUS_READY,
  PUB_STATUS_TRANSCODING,
  PUB_TRANSCODE_STALE_MINUTES,
  publicationObjectKey,
  runPublishTranscode,
} from "@app/shared";
import type { PublishTranscodeDeps, PublishTranscodeOutcome } from "@app/shared";
import { assertKeyInSpace, type StorageDriver } from "@app/storage";

export interface PublishTranscodeJobData {
  publicationId: string;
  spaceId: string;
  sourceKey: string;
}

/**
 * 反查发布记录的源成片 key（`slice.source_export_id` → `timeline_exports.file_uri`）。
 *
 * 为什么需要它（第 58 批）：看门狗判定"超时且不在队列"之后要**先救再判死**，
 * 而重投需要 `sourceKey`。这个值没有单独存列，发布时被塞进了 `slice` 的
 * `source_export_id`（`publish.service.ts` 落库处），所以只能顺着这条线反查。
 *
 * 返回 null 的三种情况都是"救不了"：slice 里没有 `source_export_id`（早期记录 / 手工插入）、
 * 对应导出记录已被删除、导出已完成但 `file_uri` 为空（导出失败残留）。
 * 调用方据此才允许把记录判失败 —— 这就是"能重投就重投，投不了才判死"的分界线。
 */
export async function resolvePublicationSourceKey(
  db: Db,
  publicationId: string,
): Promise<string | null> {
  let bigintId: bigint;
  try {
    bigintId = BigInt(publicationId);
  } catch {
    return null;
  }
  const [pub] = await db
    .select({ slice: timelinePublications.slice })
    .from(timelinePublications)
    .where(eq(timelinePublications.id, bigintId));
  if (!pub) return null;
  const slice = (pub.slice ?? {}) as Record<string, unknown>;
  const rawExportId = slice.source_export_id;
  if (rawExportId === undefined || rawExportId === null || rawExportId === "") return null;
  let exportId: bigint;
  try {
    exportId = BigInt(String(rawExportId));
  } catch {
    return null;
  }
  const [row] = await db
    .select({ fileUri: timelineExports.fileUri })
    .from(timelineExports)
    .where(eq(timelineExports.id, exportId));
  const key = row?.fileUri?.trim();
  return key ? key : null;
}

export interface PublishTranscodeJobDeps {
  db: Db;
  storage: StorageDriver;
  log?: (obj: Record<string, unknown>, msg: string) => void;
  /**
   * 「转码中」多久没心跳算执行者已死、可被接管（分钟）。默认与看门狗
   * `reviveStuckPublications` 同源的 `PUB_TRANSCODE_STALE_MINUTES`；
   * 测试注入小值来模拟"孤儿记录"而不用真等 15 分钟。
   */
  staleMinutes?: number;
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
  spaceId: string,
): PublishTranscodeDeps {
  const { db, storage } = deps;
  const staleMinutes = deps.staleMinutes ?? PUB_TRANSCODE_STALE_MINUTES;
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
    // 抢占式进入转码中（第 58 批）：一条条件更新同时覆盖两种可抢占情形 ——
    // ① status=1（排队）：正常首发，或看门狗重投；
    // ② status=2 且 updated_at 早于 staleMinutes（执行者已死的接管）：worker 崩溃后
    //    BullMQ 重投的 job 面对的就是这种孤儿记录，只认 1 等于永远放弃它。
    // 两条之外（已到 3/4/5，或另一个执行者刚开始转）一律抢不到 → 状态机 skipped。
    // 为什么不能无条件 set：入队 + 内联兜底 + 重投三者可能让同一条发布有两个执行者，
    // 并行转两遍白烧 CPU，后写者还会覆盖先写者已生成的 shareToken（分享链接中途失效）。
    markTranscoding: async (id: string) => {
      const bigintId = idOf(id);
      if (bigintId === null) return false;
      const staleCutoff = new Date(Date.now() - staleMinutes * 60_000);
      const claimed = await db
        .update(timelinePublications)
        .set({ status: PUB_STATUS_TRANSCODING, error: null, updatedAt: new Date() })
        .where(
          and(
            eq(timelinePublications.id, bigintId),
            or(
              eq(timelinePublications.status, PUB_STATUS_QUEUED),
              and(
                eq(timelinePublications.status, PUB_STATUS_TRANSCODING),
                lt(timelinePublications.updatedAt, staleCutoff),
              ),
            ),
          ),
        )
        .returning({ id: timelinePublications.id });
      return claimed.length > 0;
    },
    readSource: (key: string) => storage.read(assertKeyInSpace(spaceId, key)),
    putFile: async (key: string, buffer: Buffer) => {
      await storage.put(assertKeyInSpace(spaceId, key), buffer, "video/mp4");
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
  const outcome = await runPublishTranscode(buildPublishTranscodeDeps(deps, spaceId), {
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
