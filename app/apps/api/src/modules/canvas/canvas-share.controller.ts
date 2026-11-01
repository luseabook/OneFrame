import { Body, Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import { AppError, ErrorCode, canvasShareCreateSchema } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { Public } from "../../common/public.decorator";
import { parseOrThrow } from "../../common/zod";
import { CanvasShareService } from "./canvas-share.service";

/**
 * 画布分享（第 126 批）—— 主人侧三个动作 + 公开侧三个读口。
 *
 * 路径沿用画布域前缀：`/v1/canvas/canvases/:canvas_id/share[...]`。
 * 公开侧不带画布前缀，与任务分享的 `/v1/share/:token` 同层，
 * 这样公开页只需知道一个 token，不暴露"这是第几号画布"。
 */
@Controller("canvas")
export class CanvasShareController {
  constructor(@Inject(CanvasShareService) private readonly shares: CanvasShareService) {}

  private ctx(req: AuthedRequest): { spaceId: string } {
    if (!req.auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return { spaceId: req.auth.spaceId };
  }

  /**
   * 新建分享（会撤销该画布所有旧链接）。
   *
   * 幂等性是"同一个画布只有一条有效链接"，不是"重放同一个 token"：
   * 每次调用都会冻结**当下**的内容并换发新 token，旧地址立即失效。
   */
  @Post("canvases/:canvas_id/share")
  async create(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    return this.shares.create(c.spaceId, canvasId, parseOrThrow(canvasShareCreateSchema, body ?? {}));
  }

  /** 关闭分享：撤销全部有效链接；重复调用返回 `closed: 0`，不报错 */
  @Post("canvases/:canvas_id/share/close")
  async close(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string) {
    const c = this.ctx(req);
    return this.shares.close(c.spaceId, canvasId);
  }

  /**
   * 刷新快照：保留 token 与过期时间，只把内容更新到画布当前状态。
   *
   * 与"重新分享"分开：链接可能已经发出去了，换 token 等于让所有观众重新拿地址；
   * 但刚生成的图又确实要补进去，所以需要一条"原地更新"。
   */
  @Post("canvases/:canvas_id/share/retry")
  async retry(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string) {
    const c = this.ctx(req);
    return this.shares.retry(c.spaceId, canvasId);
  }
}

/** 公开侧：只认 token；撤销、过期、画布软删都在服务层判为 404，不区分原因 */
@Controller()
export class PublicCanvasShareController {
  constructor(@Inject(CanvasShareService) private readonly shares: CanvasShareService) {}

  @Public()
  @Get("canvas-share/:token")
  async get(@Param("token") token: string) {
    return this.shares.publicGet(token);
  }

  @Public()
  @Get("canvas-share/:token/file-urls")
  async fileUrls(@Param("token") token: string) {
    return this.shares.publicFileUrls(token);
  }

  @Public()
  @Get("canvas-share/:token/file-thumbs")
  async fileThumbs(@Param("token") token: string) {
    return this.shares.publicFileThumbs(token);
  }
}