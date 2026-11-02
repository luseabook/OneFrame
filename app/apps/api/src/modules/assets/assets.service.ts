import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { assetFolders, assets, tasks } from "@app/db";
import { AppError, ErrorCode, TaskStatus, newId, type AssetUploadRequest } from "@app/shared";
import { db } from "../../db/database";
import { StorageService } from "../../storage/storage.service";

type AssetRow = typeof assets.$inferSelect;

/**
 * 上传白名单：图片（8MB）+ 视频/音频（32MB）。
 *
 * 视频是给「视频续写/编辑/参考」这类工具用的：它们必须有视频源才能工作。
 * 音频是给第 3 批工具箱的（对口型的人声、音色修改的源音轨、自动配乐的参考音轨）。
 * MVP 走 base64（没有 OSS 直传），32MB 上限对应 base64 约 43M 字符，
 * Fastify bodyLimit 已同步抬到 48MB；真实生产应换预签名直传（见 api-spec §9）。
 */
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/mp4": "m4a",
};
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 32 * 1024 * 1024;

@Injectable()
export class AssetsService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  async upload(spaceId: string, input: AssetUploadRequest) {
    const data = Buffer.from(input.data_base64, "base64");
    const isVideo = input.content_type.startsWith("video/");
    const isAudio = input.content_type.startsWith("audio/");
    const maxBytes = isVideo || isAudio ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (data.byteLength === 0 || data.byteLength > maxBytes) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        isVideo || isAudio ? "video/audio too large (max 32MB)" : "image too large (max 8MB)",
        { field: "data_base64", max_bytes: maxBytes },
      );
    }
    const id = newId();
    const ext = EXT[input.content_type] ?? "bin";
    const key = `u/${spaceId}/assets/${id}/orig.${ext}`;
    await this.storage.put(spaceId, key, data, input.content_type);
    const [row] = await db
      .insert(assets)
      .values({
        id,
        spaceId: BigInt(spaceId),
        // kind 跟着内容走：视频/音频工具要把这个 asset 当源素材用，
        // 一律写 image 会让资产库筛选/播放器都拿错类型
        kind: isVideo ? "video" : isAudio ? "audio" : "image",
        uri: key,
        name: input.filename,
        tags: [],
        meta: { content_type: input.content_type, size: data.byteLength },
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "asset upload failed");
    return this.toDto(row);
  }

  // 任务结果一键转存：同一任务同一结果幂等复用
  async fromTask(spaceId: string, taskId: string, index = 0) {
    let bigId: bigint;
    try {
      bigId = BigInt(taskId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid task id", { field: "task_id" });
    }
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, bigId), eq(tasks.spaceId, BigInt(spaceId))));
    if (!task) throw new AppError(ErrorCode.NOT_FOUND, "task not found");
    if (task.status !== TaskStatus.SUCCEEDED) {
      throw new AppError(ErrorCode.ASSET_NOT_READY, "task not succeeded yet");
    }
    const results = Array.isArray(task.results) ? (task.results as Array<{ uri?: string }>) : [];
    const uri = results[index]?.uri;
    if (!uri) throw new AppError(ErrorCode.NOT_FOUND, "result not found");
    // 任务结果可能来自适配器直传或历史数据；写资产前再校验一次归属，
    // 防止跨空间 key 借「一键转存」进入本空间资产库。
    this.storage.assertResultUri(spaceId, uri, "result_uri");

    const [existing] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.spaceId, BigInt(spaceId)), eq(assets.sourceTaskId, bigId), eq(assets.uri, uri)));
    if (existing) return this.toDto(existing);

    const [row] = await db
      .insert(assets)
      .values({
        id: newId(),
        spaceId: BigInt(spaceId),
        kind: task.capability === "image" ? "image" : "video",
        uri,
        sourceTaskId: task.id,
        name: `task-${task.id}-${index + 1}`,
        tags: ["from-task"],
        meta: { task_id: String(task.id), result_index: index },
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "asset transfer failed");
    return this.toDto(row);
  }

  async listFolders(spaceId: string) {
    const rows = await db
      .select()
      .from(assetFolders)
      .where(eq(assetFolders.spaceId, BigInt(spaceId)))
      .orderBy(assetFolders.name);
    return rows.map((row) => ({
      id: String(row.id),
      parent_id: row.parentId ? String(row.parentId) : null,
      name: row.name,
      created_at: row.createdAt.toISOString(),
    }));
  }

  async createFolder(spaceId: string, name: string, parentId?: string) {
    const [row] = await db
      .insert(assetFolders)
      .values({
        id: newId(),
        spaceId: BigInt(spaceId),
        name: name.slice(0, 80),
        parentId: parentId ? BigInt(parentId) : null,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, "folder create failed");
    return { id: String(row.id), name: row.name, parent_id: row.parentId ? String(row.parentId) : null };
  }

  async updateAsset(
    spaceId: string,
    id: string,
    input: { folder_id?: string | null; tags?: string[]; name?: string },
  ) {
    const bigId = this.parseId(id);
    const [row] = await db
      .update(assets)
      .set({
        ...(input.folder_id !== undefined
          ? { folderId: input.folder_id === null ? null : BigInt(input.folder_id) }
          : {}),
        ...(input.tags !== undefined ? { tags: input.tags.slice(0, 20) } : {}),
        ...(input.name !== undefined ? { name: input.name.slice(0, 200) } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(assets.id, bigId), eq(assets.spaceId, BigInt(spaceId)), isNull(assets.deletedAt)))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    return this.toDto(row);
  }

  // 结果 90 天到期：返回未来 7 天内到期且未转存资产的任务结果
  async expiringTasks(spaceId: string) {
    const now = Date.now();
    const cutoff = new Date(now - 83 * 86_400_000);
    const rows = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.spaceId, BigInt(spaceId)),
          eq(tasks.status, TaskStatus.SUCCEEDED),
          lt(tasks.updatedAt, cutoff),
          sql`jsonb_array_length(${tasks.results}) > 0`,
        ),
      )
      .limit(50);
    const transferred = await db
      .select({ taskId: assets.sourceTaskId })
      .from(assets)
      .where(and(eq(assets.spaceId, BigInt(spaceId)), isNotNull(assets.sourceTaskId)));
    const transferredIds = new Set(transferred.map((row) => String(row.taskId)));
    return rows
      .filter((row) => !transferredIds.has(String(row.id)))
      .map((row) => {
        const expiresAt = new Date(row.updatedAt.getTime() + 90 * 86_400_000);
        return {
          task_id: String(row.id),
          expires_at: expiresAt.toISOString(),
          days_left: Math.max(0, Math.ceil((expiresAt.getTime() - now) / 86_400_000)),
        };
      });
  }

  async list(spaceId: string, page = 1, pageSize = 20, deleted = false, folderId?: string, tag?: string) {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(1, pageSize));
    const where = and(
      eq(assets.spaceId, BigInt(spaceId)),
      deleted ? isNotNull(assets.deletedAt) : isNull(assets.deletedAt),
      folderId ? eq(assets.folderId, BigInt(folderId)) : undefined,
      tag ? sql`${tag} = ANY(${assets.tags})` : undefined,
    );
    const rows = await db
      .select()
      .from(assets)
      .where(where)
      .orderBy(desc(assets.createdAt))
      .limit(ps)
      .offset((p - 1) * ps);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(assets).where(where);
    return {
      list: await Promise.all(rows.map((row) => this.toDto(row))),
      total: countRow?.count ?? 0,
      page: p,
      page_size: ps,
    };
  }

  /**
   * 单个素材详情（第 88 批）。
   *
   * 竞品形状：`GET /web/v1/asset/resource/:category/:res_id`（`_acceptance/competitor_endpoints.tsv`，
   * 只有方法+路径，两个 schema 都是 `{}`）。我方此前只有列表与 PATCH/DELETE，没有「按 id 取一个」——
   * 客户端按竞品形状拿详情只能 404。这里按 id 直取，形状与列表里同一行**完全一致**（同一个 `toDto`、
   * 同样的签 URL）：详情比列表多字段最容易让前端分叉。
   *
   * 已软删的不返回（要看得走回收站列表 `?deleted=true`）：详情页拿到已删素材会让人以为它还能用。
   */
  async detail(spaceId: string, id: string) {
    const bigId = this.parseId(id);
    const [row] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.id, bigId), eq(assets.spaceId, BigInt(spaceId)), isNull(assets.deletedAt)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    return this.toDto(row);
  }

  async remove(spaceId: string, id: string) {
    const bigId = this.parseId(id);
    const [row] = await db
      .update(assets)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(assets.id, bigId), eq(assets.spaceId, BigInt(spaceId)), isNull(assets.deletedAt)))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    return { ok: true };
  }

  // 回收站恢复（7 天内可恢复；物理清理由后续定时任务负责）
  async restore(spaceId: string, id: string) {
    const bigId = this.parseId(id);
    const [row] = await db
      .update(assets)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(and(eq(assets.id, bigId), eq(assets.spaceId, BigInt(spaceId)), isNotNull(assets.deletedAt)))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "asset not in recycle bin");
    return this.toDto(row);
  }

  private parseId(id: string): bigint {
    try {
      return BigInt(id);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid asset id", { field: "id" });
    }
  }

  private async toDto(row: AssetRow) {
    return {
      id: String(row.id),
      kind: row.kind,
      name: row.name,
      uri: row.uri,
      // 历史坏 key 只让该条 URL 为空，不让整页列表 500；写入侧仍由 assertOwnedKey 拒绝。
      url: await this.storage
        .signDownload(String(row.spaceId), row.uri, 3600)
        .catch(() => null),
      source_task_id: row.sourceTaskId ? String(row.sourceTaskId) : null,
      tags: row.tags,
      deleted_at: row.deletedAt?.toISOString() ?? null,
      meta: row.meta,
      created_at: row.createdAt.toISOString(),
    };
  }
}
