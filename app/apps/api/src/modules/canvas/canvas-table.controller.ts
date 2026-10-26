import { Body, Controller, Inject, Param, Post, Req } from "@nestjs/common";
import { z } from "zod";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { CanvasTableService } from "./canvas-table.service";

/**
 * 表格节点的 Excel 导入（C 族残留的最后一个明显空白）。
 *
 * 路径差异（已登记）：参照站是 `/nodes/:node_id/table/import`（不带 canvas），
 * 我方统一挂在 `canvases/:canvas_id/nodes/:node_id/...` 下——本域所有节点写操作
 * 都是这个形状，且带 canvas 才能一次校验"节点属于该画布且属于该 space"。
 */
@Controller("canvas")
export class CanvasTableController {
  constructor(@Inject(CanvasTableService) private readonly svc: CanvasTableService) {}

  private ctx(req: AuthedRequest): { spaceId: string } {
    if (!req.auth) throw new Error("auth missing");
    return { spaceId: req.auth.spaceId };
  }

  /** 第一步：解析并列出工作表（**不自动选第一个**，见 service 注释） */
  @Post("canvases/:canvas_id/nodes/:node_id/table/import")
  async importWorkbook(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("node_id") nodeId: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    const input = parseOrThrow(
      z.object({
        file_name: z.string().min(1).max(255),
        // 上限交给 decodeBase64Upload 判断（它会给出"超过 N MB"的明确提示），
        // 这里只挡明显异常的巨型字符串，避免在 zod 层就把真实文件拒掉
        file_base64: z.string().min(8).max(14 * 1024 * 1024),
      }),
      body,
    );
    return this.svc.importWorkbook(c.spaceId, canvasId, nodeId, input);
  }

  /** 第二步：显式确认工作表 → 写入节点参数（sheet_selection_required=false） */
  @Post("canvases/:canvas_id/nodes/:node_id/table/confirm-sheet")
  async confirmSheet(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("node_id") nodeId: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    const input = parseOrThrow(
      z.object({ import_token: z.string().min(1).max(64), sheet_id: z.string().min(1).max(64) }),
      body,
    );
    return this.svc.confirmSheet(c.spaceId, canvasId, nodeId, input);
  }
}
