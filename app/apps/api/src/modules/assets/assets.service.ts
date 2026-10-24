import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { assets } from "@app/db";
import { AppError, ErrorCode, newId, type AssetUploadRequest } from "@app/shared";
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

  async list(spaceId: string, page = 1, pageSize = 20) {
    const p = Math.max(1, page);
    const ps = Math.min(100, Math.max(1, pageSize));
    const where = and(eq(assets.spaceId, BigInt(spaceId)), isNull(assets.deletedAt));
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
    let bigId: bigint;
    try {
      bigId = BigInt(id);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid asset id", { field: "id" });
    }
    const [row] = await db
      .update(assets)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(assets.id, bigId), eq(assets.spaceId, BigInt(spaceId)), isNull(assets.deletedAt)))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    return { ok: true };
  }

  private async toDto(row: AssetRow) {
    return {
      id: String(row.id),
      kind: row.kind,
      name: row.name,
      uri: row.uri,
      url: await this.storage.signDownload(row.uri, 3600),
      meta: row.meta,
      created_at: row.createdAt.toISOString(),
    };
  }
}
