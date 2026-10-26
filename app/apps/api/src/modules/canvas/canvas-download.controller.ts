import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { CanvasDownloadService } from "./canvas-download.service";

/**
 * 画布节点产物批量下载（C13）。
 *
 * 路径差异（已登记）：参照站是 `/canvas/node/batch-download*`（不带 canvas，靠 node_ids 反推）。
 * 我方挂在 `canvases/:canvas_id/...` 下：与本域所有写操作同形状，且能一次校验
 * "这些节点属于该画布且属于该 space"，不必先反查一遍再校验。
 */
@Controller("canvas")
export class CanvasDownloadController {
  constructor(@Inject(CanvasDownloadService) private readonly svc: CanvasDownloadService) {}

  private ctx(req: AuthedRequest): { spaceId: string; userId: string } {
    if (!req.auth) throw new Error("auth missing");
    return { spaceId: req.auth.spaceId, userId: req.auth.userId };
  }

  /** 打包选中节点的产物 → 产生一张"下载单"（后续可反复取链接） */
  @Post("canvases/:canvas_id/nodes/batch-download")
  async create(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    const input = parseOrThrow(
      z.object({ node_ids: z.array(z.string().min(1)).min(1).max(50) }),
      body,
    );
    return this.svc.create(c.spaceId, canvasId, c.userId, input.node_ids);
  }

  /** 下载单列表（同一批文件过期后仍能重新取链接，这是它必须落库的原因） */
  @Get("canvases/:canvas_id/download-lists")
  async list(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
  ) {
    const c = this.ctx(req);
    return this.svc.list(c.spaceId, canvasId, Number(page ?? 1), Number(pageSize ?? 20));
  }

  /** 现签 24h 下载链接 */
  @Post("canvases/:canvas_id/download-lists/:list_id/url")
  async url(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("list_id") listId: string,
  ) {
    const c = this.ctx(req);
    return this.svc.url(c.spaceId, canvasId, listId);
  }
}
