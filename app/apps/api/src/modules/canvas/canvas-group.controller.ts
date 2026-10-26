import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req } from "@nestjs/common";
import { z } from "zod";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { CanvasGroupService } from "./canvas-group.service";

/**
 * 固定组（C10）+ 节点组模板（C11）端点
 *
 * 固定组是"画布顶部那排可一键跳转的分组"，每画布 7 个槽位；
 * 节点组模板是"一组节点的复用片段"（与整画布模板不同物，不混用）。
 */
@Controller("canvas")
export class CanvasGroupController {
  constructor(@Inject(CanvasGroupService) private readonly svc: CanvasGroupService) {}

  private ctx(req: AuthedRequest): { spaceId: string; userId: string } {
    if (!req.auth) throw new Error("auth missing");
    return { spaceId: req.auth.spaceId, userId: req.auth.userId };
  }

  // ── 固定组 ──────────────────────────────────────────────
  @Get("canvases/:canvas_id/pin-groups")
  async list(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string) {
    const c = this.ctx(req);
    return this.svc.listPinGroups(c.spaceId, canvasId);
  }

  /** 按槽位整体替换（不是增量添加） */
  @Put("canvases/:canvas_id/pin-groups/:slot")
  async upsert(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("slot") slot: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    const input = parseOrThrow(
      z.object({
        name: z.string().max(60).optional(),
        color: z.string().max(32).optional(),
        node_ids: z.array(z.string().min(1)).max(200),
      }),
      body,
    );
    return this.svc.upsertPinGroup(c.spaceId, canvasId, { slot: Number(slot), ...input });
  }

  @Delete("canvases/:canvas_id/pin-groups/:slot")
  async remove(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("slot") slot: string,
  ) {
    const c = this.ctx(req);
    return this.svc.deletePinGroup(c.spaceId, canvasId, Number(slot));
  }

  /** 清空成员但保留组 */
  @Delete("canvases/:canvas_id/pin-groups/:slot/members")
  async clearMembers(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("slot") slot: string,
  ) {
    const c = this.ctx(req);
    return this.svc.clearPinGroupMembers(c.spaceId, canvasId, Number(slot));
  }

  /** 节点侧入口：直接设某节点属于哪些固定组 */
  @Put("canvases/:canvas_id/nodes/:node_id/pin-groups")
  async setNodeGroups(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("node_id") nodeId: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    const input = parseOrThrow(z.object({ group_ids: z.array(z.string().min(1)).max(7) }), body);
    return this.svc.setNodePinGroups(c.spaceId, canvasId, nodeId, input.group_ids);
  }

  // ── 节点组模板 ──────────────────────────────────────────
  @Get("canvases/:canvas_id/group-templates")
  async listTemplates(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string) {
    const c = this.ctx(req);
    return this.svc.listGroupTemplates(c.spaceId, canvasId);
  }

  @Post("canvases/:canvas_id/groups/:group_id/templates")
  async createTemplate(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("group_id") groupId: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    const input = parseOrThrow(z.object({ name: z.string().min(1).max(60) }), body);
    return this.svc.createGroupTemplate(c.spaceId, c.userId, canvasId, groupId, input);
  }

  @Put("canvases/:canvas_id/group-templates/:template_id")
  async updateTemplate(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("template_id") templateId: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    const input = parseOrThrow(z.object({ name: z.string().min(1).max(60).optional() }), body);
    return this.svc.updateGroupTemplate(c.spaceId, canvasId, templateId, input);
  }
}
