import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import { z } from "zod";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { CanvasMaterialService } from "./canvas-material.service";

/**
 * 画布素材 + 批注端点（C8/C9）
 *
 * 素材只存 object_key（不存 URL）：直链会过期，换存储驱动还要洗库。
 * 批注不复用 content_reports：后者是公开举报，有独立频控与处置流。
 */
@Controller("canvas")
export class CanvasMaterialController {
  constructor(@Inject(CanvasMaterialService) private readonly svc: CanvasMaterialService) {}

  private ctx(req: AuthedRequest): { spaceId: string; userId: string } {
    if (!req.auth) throw new Error("auth missing");
    return { spaceId: req.auth.spaceId, userId: req.auth.userId };
  }

  // ── 素材 ────────────────────────────────────────────────
  @Get("canvases/:canvas_id/materials")
  async listMaterials(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Query("material_type") materialType?: string,
    @Query("source") source?: string,
    @Query("node_id") nodeId?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
  ) {
    const c = this.ctx(req);
    return this.svc.listMaterials(c.spaceId, canvasId, {
      material_type: materialType,
      source: source !== undefined ? Number(source) : undefined,
      node_id: nodeId,
      page: page ? Number(page) : undefined,
      page_size: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post("canvases/:canvas_id/materials")
  async createMaterial(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    const input = parseOrThrow(
      z.object({
        object_key: z.string().min(1).max(2048),
        material_type: z.enum(["image", "video", "audio", "file"]),
        name: z.string().max(200).optional(),
        node_id: z.string().optional(),
        source: z.number().int().min(1).max(3).optional(),
      }),
      body,
    );
    return this.svc.createMaterial(c.spaceId, canvasId, input);
  }

  @Post("canvases/:canvas_id/materials/batch-delete")
  async batchDelete(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    const input = parseOrThrow(z.object({ material_ids: z.array(z.string().min(1)).min(1).max(200) }), body);
    return this.svc.batchDeleteMaterials(c.spaceId, canvasId, input.material_ids);
  }

  @Post("canvases/:canvas_id/upload-file")
  async upload(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    const input = parseOrThrow(z.object({ object_key: z.string().min(1).max(2048) }), body);
    return this.svc.registerUpload(c.spaceId, canvasId, input);
  }

  @Post("canvases/:canvas_id/materials/batch-download")
  async batchDownload(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    const input = parseOrThrow(z.object({ material_ids: z.array(z.string().min(1)).min(1).max(200) }), body);
    return this.svc.batchDownload(c.spaceId, canvasId, input.material_ids);
  }

  // ── 批注 ────────────────────────────────────────────────
  @Get("canvases/:canvas_id/comment-nodes")
  async listCommentNodes(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Query("scope") scope?: string,
    @Query("resolved") resolved?: string,
    @Query("uid") uid?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
  ) {
    const c = this.ctx(req);
    return this.svc.listCommentNodes(c.spaceId, canvasId, {
      scope,
      resolved: resolved === undefined ? undefined : resolved === "1" || resolved === "true",
      uid,
      page: page ? Number(page) : undefined,
      page_size: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Post("canvases/:canvas_id/comment-nodes")
  async createCommentNode(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    const input = parseOrThrow(
      z.object({
        anchor: z.object({ x: z.number(), y: z.number() }),
        node_id: z.string().optional(),
        scope: z.enum(["canvas", "node"]).optional(),
        content: z.string().min(1).max(2000),
      }),
      body,
    );
    return this.svc.createCommentNode(c.spaceId, c.userId, canvasId, input);
  }

  @Get("canvases/:canvas_id/comment-nodes/:cn_id")
  async getCommentNode(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("cn_id") cnId: string,
  ) {
    const c = this.ctx(req);
    return this.svc.getCommentNode(c.spaceId, canvasId, cnId);
  }

  @Put("canvases/:canvas_id/comment-nodes/:cn_id")
  async updateCommentNode(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("cn_id") cnId: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    const input = parseOrThrow(
      z.object({
        anchor: z.object({ x: z.number(), y: z.number() }).optional(),
        scope: z.enum(["canvas", "node"]).optional(),
      }),
      body,
    );
    return this.svc.updateCommentNode(c.spaceId, canvasId, cnId, input);
  }

  @Delete("canvases/:canvas_id/comment-nodes/:cn_id")
  async deleteCommentNode(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("cn_id") cnId: string,
  ) {
    const c = this.ctx(req);
    return this.svc.deleteCommentNode(c.spaceId, c.userId, canvasId, cnId);
  }

  @Get("canvases/:canvas_id/comment-nodes/:cn_id/comments")
  async listComments(
    @Req() req: AuthedRequest,
    @Param("canvas_id") _canvasId: string,
    @Param("cn_id") cnId: string,
  ) {
    const c = this.ctx(req);
    return this.svc.listComments(c.spaceId, cnId);
  }

  @Post("canvases/:canvas_id/comment-nodes/:cn_id/comments")
  async addComment(
    @Req() req: AuthedRequest,
    @Param("canvas_id") _canvasId: string,
    @Param("cn_id") cnId: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    const input = parseOrThrow(
      z.object({ content: z.string().min(1).max(2000), mentions: z.array(z.string()).max(20).optional() }),
      body,
    );
    return this.svc.addComment(c.spaceId, c.userId, cnId, input);
  }

  @Put("canvases/:canvas_id/comment-nodes/:cn_id/comments/:comment_id")
  async updateComment(
    @Req() req: AuthedRequest,
    @Param("comment_id") commentId: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    const input = parseOrThrow(z.object({ content: z.string().min(1).max(2000) }), body);
    return this.svc.updateComment(c.spaceId, c.userId, commentId, input);
  }

  @Delete("canvases/:canvas_id/comment-nodes/:cn_id/comments/:comment_id")
  async deleteComment(@Req() req: AuthedRequest, @Param("comment_id") commentId: string) {
    const c = this.ctx(req);
    return this.svc.deleteComment(c.spaceId, c.userId, commentId);
  }

  @Post("canvases/:canvas_id/comment-nodes/:cn_id/resolve")
  async resolve(
    @Req() req: AuthedRequest,
    @Param("cn_id") cnId: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    const input = parseOrThrow(z.object({ resolved: z.boolean() }), body);
    return this.svc.resolveCommentNode(c.spaceId, c.userId, cnId, input.resolved);
  }
}
