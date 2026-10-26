import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { canvasCommentNodes, canvasComments, canvasMaterials, canvasNodes, canvases } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";

/**
 * 画布素材 + 批注（C8/C9）
 *
 * 为什么合成一个服务文件：两者都是"挂在画布上的附属内容"，
 * 共享同一套"画布归属校验 + space 隔离"逻辑；拆成两个文件会让这段
 * 校验逻辑复制两遍（本项目已因复制校验出过 400102 vs 400101 不一致的问题）。
 *
 * 两条硬语义：
 * 1. **素材只存 object_key，不存 URL**。直链会过期，且换存储驱动（local/S3/OSS）
 *    就要洗库。取用时由 storage 层签 URL。
 * 2. **批注不复用 content_reports**。后者是"公开举报"，有独立频控/处置流；
 *    批注是站内协作，混用会让举报队列里混进一堆"这里改一下"。
 */

/** 素材类型白名单（与 canvas_materials.material_type 注释一致） */
const MATERIAL_TYPES = ["image", "video", "audio", "file"] as const;

@Injectable()
export class CanvasMaterialService {
  /** 校验画布属于该 space（所有下游操作的前置） */
  private async mustGetCanvas(spaceId: string, canvasId: string) {
    const [canvas] = await db
      .select()
      .from(canvases)
      .where(and(eq(canvases.id, BigInt(canvasId)), eq(canvases.spaceId, BigInt(spaceId)), isNull(canvases.deletedAt)));
    if (!canvas) throw new AppError(ErrorCode.NOT_FOUND, "canvas not found");
    return canvas;
  }

  // ── 素材 ────────────────────────────────────────────────
  async listMaterials(
    spaceId: string,
    canvasId: string,
    q: { material_type?: string; source?: number; node_id?: string; page?: number; page_size?: number },
  ) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.page_size ?? 20));

    const conditions = [eq(canvasMaterials.canvasId, canvas.id), isNull(canvasMaterials.deletedAt)];
    if (q.material_type) conditions.push(eq(canvasMaterials.materialType, q.material_type));
    if (q.source !== undefined) conditions.push(eq(canvasMaterials.source, q.source));
    if (q.node_id) conditions.push(eq(canvasMaterials.nodeId, BigInt(q.node_id)));

    const rows = await db
      .select()
      .from(canvasMaterials)
      .where(and(...conditions))
      .orderBy(desc(canvasMaterials.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [cnt] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(canvasMaterials)
      .where(and(...conditions));

    return {
      list: rows.map((r) => this.toMaterialDto(r)),
      total: cnt?.n ?? 0,
      page,
      page_size: pageSize,
    };
  }

  /** 挂一条素材到画布（上传/节点产出/资产库引用 三来源） */
  async createMaterial(
    spaceId: string,
    canvasId: string,
    input: { object_key: string; material_type: string; name?: string; node_id?: string; source?: number },
  ) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    if (!MATERIAL_TYPES.includes(input.material_type as (typeof MATERIAL_TYPES)[number])) {
      throw new AppError(ErrorCode.INVALID_PARAM, `material_type must be one of ${MATERIAL_TYPES.join("/")}`, {
        field: "material_type",
      });
    }
    if (!input.object_key.trim()) {
      throw new AppError(ErrorCode.BAD_REQUEST, "object_key is required", { field: "object_key" });
    }
    if (input.node_id) {
      // 节点必须属于同一画布，否则会造出"画布A的素材挂在画布B的节点上"
      const [n] = await db
        .select()
        .from(canvasNodes)
        .where(and(eq(canvasNodes.id, BigInt(input.node_id)), eq(canvasNodes.canvasId, canvas.id)));
      if (!n) throw new AppError(ErrorCode.NOT_FOUND, "node not found in this canvas");
    }

    const id = newId();
    await db.insert(canvasMaterials).values({
      id,
      spaceId: BigInt(spaceId),
      canvasId: canvas.id,
      materialType: input.material_type,
      source: input.source ?? 1,
      nodeId: input.node_id ? BigInt(input.node_id) : null,
      name: input.name ?? "",
      objectKey: input.object_key,
      meta: {},
    });
    return { material_id: String(id) };
  }

  async batchDeleteMaterials(spaceId: string, canvasId: string, materialIds: string[]) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    if (materialIds.length === 0) {
      throw new AppError(ErrorCode.BAD_REQUEST, "material_ids must not be empty", { field: "material_ids" });
    }
    const valid = materialIds.filter((id) => /^\d{1,20}$/.test(id)).map((id) => BigInt(id));
    const res = await db
      .update(canvasMaterials)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(canvasMaterials.canvasId, canvas.id),
          inArray(canvasMaterials.id, valid.length ? valid : [BigInt(0)]),
          isNull(canvasMaterials.deletedAt),
        ),
      )
      .returning({ id: canvasMaterials.id });
    return { deleted: res.length };
  }

  /**
   * 登记一个已上传对象为画布文件。
   * 只做"把 object_key 记到画布上"，真正的上传走 files 域（本项目已有）。
   */
  async registerUpload(spaceId: string, canvasId: string, input: { object_key: string }) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    if (!input.object_key.trim()) {
      throw new AppError(ErrorCode.BAD_REQUEST, "object_key is required", { field: "object_key" });
    }
    const id = newId();
    await db.insert(canvasMaterials).values({
      id,
      spaceId: BigInt(spaceId),
      canvasId: canvas.id,
      materialType: guessType(input.object_key),
      source: 1,
      name: input.object_key.split("/").pop() ?? "上传文件",
      objectKey: input.object_key,
      meta: {},
    });
    return { file_id: String(id), uri: input.object_key };
  }

  /** 批量下载：返回每条的 object_key（前端再逐条换签名 URL） */
  async batchDownload(spaceId: string, canvasId: string, materialIds: string[]) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const valid = materialIds.filter((id) => /^\d{1,20}$/.test(id)).map((id) => BigInt(id));
    if (valid.length === 0) return { list: [], missing: materialIds };
    const rows = await db
      .select()
      .from(canvasMaterials)
      .where(
        and(
          eq(canvasMaterials.canvasId, canvas.id),
          inArray(canvasMaterials.id, valid),
          isNull(canvasMaterials.deletedAt),
        ),
      )
      .orderBy(asc(canvasMaterials.createdAt));
    const found = new Set(rows.map((r) => String(r.id)));
    return {
      list: rows.map((r) => ({
        material_id: String(r.id),
        object_key: r.objectKey,
        material_type: r.materialType,
        name: r.name,
      })),
      // 显式回报"哪些 id 没找到"：静默丢弃会让用户以为下载了但文件缺失
      missing: materialIds.filter((id) => !found.has(id)),
    };
  }

  private toMaterialDto(row: typeof canvasMaterials.$inferSelect) {
    return {
      id: String(row.id),
      material_type: row.materialType,
      source: row.source,
      node_id: row.nodeId ? String(row.nodeId) : null,
      name: row.name,
      object_key: row.objectKey,
      meta: row.meta,
      created_at: row.createdAt.toISOString(),
    };
  }

  // ── 批注 ────────────────────────────────────────────────
  async listCommentNodes(
    spaceId: string,
    canvasId: string,
    q: { scope?: string; resolved?: boolean; uid?: string; page?: number; page_size?: number },
  ) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.page_size ?? 20));

    const conditions = [eq(canvasCommentNodes.canvasId, canvas.id), isNull(canvasCommentNodes.deletedAt)];
    if (q.scope) conditions.push(eq(canvasCommentNodes.scope, q.scope));
    if (q.resolved !== undefined) conditions.push(eq(canvasCommentNodes.resolved, q.resolved));
    if (q.uid) conditions.push(eq(canvasCommentNodes.createdBy, BigInt(q.uid)));

    const rows = await db
      .select()
      .from(canvasCommentNodes)
      .where(and(...conditions))
      .orderBy(desc(canvasCommentNodes.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [cnt] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(canvasCommentNodes)
      .where(and(...conditions));

    // 带上每个批注点的消息数与最后一条内容（前端画飘点时要显示摘要）
    const ids = rows.map((r) => r.id);
    const counts = ids.length
      ? await db
          .select({
            cnId: canvasComments.commentNodeId,
            n: sql<number>`count(*)::int`,
          })
          .from(canvasComments)
          .where(and(inArray(canvasComments.commentNodeId, ids), isNull(canvasComments.deletedAt)))
          .groupBy(canvasComments.commentNodeId)
      : [];
    const countMap = new Map(counts.map((c) => [String(c.cnId), c.n]));

    return {
      list: rows.map((r) => ({
        ...this.toCommentNodeDto(r),
        comment_count: countMap.get(String(r.id)) ?? 0,
      })),
      total: cnt?.n ?? 0,
      page,
      page_size: pageSize,
    };
  }

  /**
   * 新建批注点 + 首条内容（一次调用完成"点 + 说话"）。
   * 分两步（先建点再发消息）会让用户点完看到空点，体验更差。
   */
  async createCommentNode(
    spaceId: string,
    userId: string,
    canvasId: string,
    input: { anchor: { x: number; y: number }; node_id?: string; scope?: string; content: string },
  ) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    if (!input.content.trim()) {
      throw new AppError(ErrorCode.BAD_REQUEST, "content is required", { field: "content" });
    }
    if (input.node_id) {
      const [n] = await db
        .select()
        .from(canvasNodes)
        .where(and(eq(canvasNodes.id, BigInt(input.node_id)), eq(canvasNodes.canvasId, canvas.id)));
      if (!n) throw new AppError(ErrorCode.NOT_FOUND, "node not found in this canvas");
    }

    const cnId = newId();
    await db.transaction(async (tx) => {
      await tx.insert(canvasCommentNodes).values({
        id: cnId,
        spaceId: BigInt(spaceId),
        canvasId: canvas.id,
        anchorX: Math.round(input.anchor.x),
        anchorY: Math.round(input.anchor.y),
        nodeId: input.node_id ? BigInt(input.node_id) : null,
        scope: input.scope ?? (input.node_id ? "node" : "canvas"),
        createdBy: BigInt(userId),
      });
      await tx.insert(canvasComments).values({
        id: newId(),
        spaceId: BigInt(spaceId),
        commentNodeId: cnId,
        content: input.content,
        mentions: [],
        createdBy: BigInt(userId),
      });
    });
    return { comment_node_id: String(cnId) };
  }

  async getCommentNode(spaceId: string, canvasId: string, cnId: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const [row] = await db
      .select()
      .from(canvasCommentNodes)
      .where(and(eq(canvasCommentNodes.id, BigInt(cnId)), eq(canvasCommentNodes.canvasId, canvas.id), isNull(canvasCommentNodes.deletedAt)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "comment node not found");
    return { comment_node: this.toCommentNodeDto(row) };
  }

  /** 移动锚点（拖动批注点） */
  async updateCommentNode(
    spaceId: string,
    canvasId: string,
    cnId: string,
    input: { anchor?: { x: number; y: number }; scope?: string },
  ) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const [row] = await db
      .select()
      .from(canvasCommentNodes)
      .where(and(eq(canvasCommentNodes.id, BigInt(cnId)), eq(canvasCommentNodes.canvasId, canvas.id), isNull(canvasCommentNodes.deletedAt)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "comment node not found");
    await db
      .update(canvasCommentNodes)
      .set({
        ...(input.anchor ? { anchorX: Math.round(input.anchor.x), anchorY: Math.round(input.anchor.y) } : {}),
        ...(input.scope ? { scope: input.scope } : {}),
        updatedAt: new Date(),
      })
      .where(eq(canvasCommentNodes.id, row.id));
    return { ok: true };
  }

  /** 删除批注点（只能删自己创建的） */
  async deleteCommentNode(spaceId: string, userId: string, canvasId: string, cnId: string) {
    const canvas = await this.mustGetCanvas(spaceId, canvasId);
    const [row] = await db
      .select()
      .from(canvasCommentNodes)
      .where(and(eq(canvasCommentNodes.id, BigInt(cnId)), eq(canvasCommentNodes.canvasId, canvas.id), isNull(canvasCommentNodes.deletedAt)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "comment node not found");
    if (row.createdBy === null || String(row.createdBy) !== userId) {
      throw new AppError(ErrorCode.FORBIDDEN, "you can only delete your own comment");
    }
    await db
      .update(canvasCommentNodes)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(canvasCommentNodes.id, row.id));
    return { ok: true };
  }

  /** 批注点下的消息列表 */
  async listComments(spaceId: string, cnId: string) {
    const [cn] = await db
      .select()
      .from(canvasCommentNodes)
      .where(and(eq(canvasCommentNodes.id, BigInt(cnId)), eq(canvasCommentNodes.spaceId, BigInt(spaceId)), isNull(canvasCommentNodes.deletedAt)));
    if (!cn) throw new AppError(ErrorCode.NOT_FOUND, "comment node not found");
    const rows = await db
      .select()
      .from(canvasComments)
      .where(and(eq(canvasComments.commentNodeId, cn.id), isNull(canvasComments.deletedAt)))
      .orderBy(asc(canvasComments.createdAt));
    return { list: rows.map((r) => this.toCommentDto(r)) };
  }

  async addComment(
    spaceId: string,
    userId: string,
    cnId: string,
    input: { content: string; mentions?: string[] },
  ) {
    const [cn] = await db
      .select()
      .from(canvasCommentNodes)
      .where(and(eq(canvasCommentNodes.id, BigInt(cnId)), eq(canvasCommentNodes.spaceId, BigInt(spaceId)), isNull(canvasCommentNodes.deletedAt)));
    if (!cn) throw new AppError(ErrorCode.NOT_FOUND, "comment node not found");
    if (!input.content.trim()) {
      throw new AppError(ErrorCode.BAD_REQUEST, "content is required", { field: "content" });
    }
    const id = newId();
    await db.insert(canvasComments).values({
      id,
      spaceId: BigInt(spaceId),
      commentNodeId: cn.id,
      content: input.content,
      mentions: (input.mentions ?? []).filter((m) => /^\d{1,20}$/.test(m)).map((m) => BigInt(m)),
      createdBy: BigInt(userId),
    });
    return { comment_id: String(id) };
  }

  async updateComment(spaceId: string, userId: string, commentId: string, input: { content: string }) {
    const [row] = await db
      .select()
      .from(canvasComments)
      .where(and(eq(canvasComments.id, BigInt(commentId)), eq(canvasComments.spaceId, BigInt(spaceId)), isNull(canvasComments.deletedAt)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "comment not found");
    if (row.createdBy === null || String(row.createdBy) !== userId) {
      throw new AppError(ErrorCode.FORBIDDEN, "you can only edit your own comment");
    }
    await db
      .update(canvasComments)
      .set({ content: input.content, updatedAt: new Date() })
      .where(eq(canvasComments.id, row.id));
    return { ok: true };
  }

  async deleteComment(spaceId: string, userId: string, commentId: string) {
    const [row] = await db
      .select()
      .from(canvasComments)
      .where(and(eq(canvasComments.id, BigInt(commentId)), eq(canvasComments.spaceId, BigInt(spaceId)), isNull(canvasComments.deletedAt)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "comment not found");
    if (row.createdBy === null || String(row.createdBy) !== userId) {
      throw new AppError(ErrorCode.FORBIDDEN, "you can only delete your own comment");
    }
    await db
      .update(canvasComments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(canvasComments.id, row.id));
    return { ok: true };
  }

  /** 标记批注点为已解决/重新打开（协作里最常用的动作） */
  async resolveCommentNode(spaceId: string, userId: string, cnId: string, resolved: boolean) {
    const [row] = await db
      .select()
      .from(canvasCommentNodes)
      .where(and(eq(canvasCommentNodes.id, BigInt(cnId)), eq(canvasCommentNodes.spaceId, BigInt(spaceId)), isNull(canvasCommentNodes.deletedAt)));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "comment node not found");
    await db
      .update(canvasCommentNodes)
      .set({
        resolved,
        resolvedBy: resolved ? BigInt(userId) : null,
        resolvedAt: resolved ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(canvasCommentNodes.id, row.id));
    return { comment_node_id: String(row.id), resolved };
  }

  private toCommentNodeDto(row: typeof canvasCommentNodes.$inferSelect) {
    return {
      id: String(row.id),
      anchor: { x: row.anchorX, y: row.anchorY },
      node_id: row.nodeId ? String(row.nodeId) : null,
      scope: row.scope,
      resolved: row.resolved,
      resolved_by: row.resolvedBy ? String(row.resolvedBy) : null,
      resolved_at: row.resolvedAt?.toISOString() ?? null,
      created_by: row.createdBy ? String(row.createdBy) : null,
      created_at: row.createdAt.toISOString(),
    };
  }

  private toCommentDto(row: typeof canvasComments.$inferSelect) {
    return {
      id: String(row.id),
      comment_node_id: String(row.commentNodeId),
      content: row.content,
      mentions: row.mentions.map((m) => String(m)),
      created_by: row.createdBy ? String(row.createdBy) : null,
      created_at: row.createdAt.toISOString(),
    };
  }
}

/** 按扩展名猜素材类型（上传时用户可能不选类型） */
function guessType(objectKey: string): string {
  const ext = objectKey.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "avi", "mkv"].includes(ext)) return "video";
  if (["mp3", "wav", "aac", "m4a", "ogg", "flac"].includes(ext)) return "audio";
  return "file";
}

