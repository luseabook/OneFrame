import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { CanvasTemplateService } from "./canvas-template.service";

/**
 * 整画布模板端点（C2）
 *
 * 路径归一：参照站有 `canvas-tpls` / `canvas/:id/tpls` / `canvas/templates/*`
 * 三组前缀指同一实体，统一为 `/canvas-templates`（契约 draft §3.1 建议）。
 */
@Controller("canvas")
export class CanvasTemplateController {
  constructor(@Inject(CanvasTemplateService) private readonly svc: CanvasTemplateService) {}

  private ctx(req: AuthedRequest): { spaceId: string; userId: string } {
    if (!req.auth) throw new Error("auth missing");
    return { spaceId: req.auth.spaceId, userId: req.auth.userId };
  }

  /** 模板列表（官方 + 本团队 + 我的个人，按可见性过滤） */
  @Get("templates")
  async list(
    @Req() req: AuthedRequest,
    @Query("tpl_type") tplType?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
    @Query("mine") mine?: string,
  ) {
    const c = this.ctx(req);
    return this.svc.list(c.spaceId, c.userId, {
      tpl_type: tplType ? Number(tplType) : undefined,
      page: page ? Number(page) : undefined,
      page_size: pageSize ? Number(pageSize) : undefined,
      mine: mine === "1" || mine === "true",
    });
  }

  /** 个人模板搜索 */
  @Get("templates/personal")
  async personal(
    @Req() req: AuthedRequest,
    @Query("query") query?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
  ) {
    const c = this.ctx(req);
    return this.svc.searchPersonal(c.spaceId, c.userId, query ?? "", Number(page ?? 1), Number(pageSize ?? 20));
  }

  @Get("templates/:template_id")
  async get(@Req() req: AuthedRequest, @Param("template_id") templateId: string) {
    const c = this.ctx(req);
    return this.svc.get(c.spaceId, c.userId, templateId);
  }

  /** 套用模板：返回"待插入的节点描述"，由前端合并进本地画布，走正常 commit 落库 */
  @Get("templates/:template_id/instantiate")
  async instantiate(
    @Req() req: AuthedRequest,
    @Param("template_id") templateId: string,
    @Query("dx") dx?: string,
    @Query("dy") dy?: string,
  ) {
    const c = this.ctx(req);
    return this.svc.instantiate(c.spaceId, c.userId, templateId, {
      x: dx ? Number(dx) : 0,
      y: dy ? Number(dy) : 0,
    });
  }

  @Post("canvases/:canvas_id/tpls")
  async createFromCanvas(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    const input = parseOrThrow(
      z.object({
        name: z.string().min(1).max(60),
        tpl_scope: z.number().int().min(2).max(3).optional(),
        description: z.string().max(500).optional(),
        cover_uri: z.string().max(2048).optional(),
      }),
      body,
    );
    return this.svc.createFromCanvas(c.spaceId, c.userId, canvasId, input);
  }

  @Post("templates/:template_id/sync-team")
  async syncTeam(@Req() req: AuthedRequest, @Param("template_id") templateId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    const input = parseOrThrow(z.object({ team_space_id: z.string().min(1) }), body);
    return this.svc.syncToTeam(c.spaceId, c.userId, templateId, input.team_space_id);
  }

  @Delete("templates/personal/:template_id")
  async removePersonal(@Req() req: AuthedRequest, @Param("template_id") templateId: string) {
    const c = this.ctx(req);
    return this.svc.removePersonal(c.spaceId, c.userId, templateId);
  }
}

