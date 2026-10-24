import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { assets, tasks } from "@app/db";
import { AppError, ErrorCode, TaskStatus, newId, type AssetUploadRequest } from "@app/shared";
import { db } from "../../db/database";
import { StorageService } from "../../storage/storage.service";

type AssetRow = typeof assets.$inferSelect;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_BYTES = 8 * 1024 * 1024;

@Injectable()
export class AssetsService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  async upload(spaceId: string, input: AssetUploadRequest) {
    const data = Buffer.from(input.data_base64, "base64");
    if (data.byteLength === 0 || data.byteLength > MAX_BYTES) {
      throw new AppError(ErrorCode.INVALID_PARAM, "image too large (max 8MB)", { field: "data_base64" });
    }
    const id = newId();
    const ext = EXT[input.content_type] ?? "bin";
    const key = `u/${spaceId}/assets/${id}/orig.${ext}`;
    await this.storage.put(key, data, input.content_type);
    const [row] = await db
      .insert(assets)
      .values({
        id,
        spaceId: BigInt(spaceId),
        kind: "image",
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

  async list(spaceId: string, page = 1, pageSize = 20, deleted = false) {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(1, pageSize));
    const where = and(
      eq(assets.spaceId, BigInt(spaceId)),
      deleted ? isNotNull(assets.deletedAt) : isNull(assets.deletedAt),
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
      url: await this.storage.signDownload(row.uri, 3600),
      source_task_id: row.sourceTaskId ? String(row.sourceTaskId) : null,
      tags: row.tags,
      deleted_at: row.deletedAt?.toISOString() ?? null,
      meta: row.meta,
      created_at: row.createdAt.toISOString(),
    };
  }
}
