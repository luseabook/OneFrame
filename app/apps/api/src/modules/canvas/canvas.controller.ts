import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { CanvasService } from "./canvas.service";

/**
 * 画布（canvas）域端点 —— F1 契约 §14.4
 *
 * 路径以 `/canvas` 为前缀（参照为 `/web/v1/df/canvas/*`；我方按 ADR-009 保留域划分、
 * 由 `X-Space-Id` 表达空间，因此路径里不带 space/team id）。
 */

const createCanvas = z.object({
  title: z.string().max(60).optional(),
  creation_mode: z.number().int().min(1).max(2).optional(),
  episode_id: z.string().optional(),
});
const renameCanvas = z.object({ title: z.string().min(1).max(60), version: z.number().int().optional() });

const nodeBase = z.object({
  node_type: z.string().min(1),
  name: z.string().max(80).optional(),
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  z_index: z.number().int().optional(),
  params: z.unknown().optional(),
});
const createNodeBody = nodeBase;
const patchNodeBody = z.object({
  version: z.number().int().optional(),
  name: z.string().max(80).optional(),
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  z_index: z.number().int().optional(),
  params: z.unknown().optional(),
  status: z.number().int().min(1).max(3).optional(),
});
const batchNodesBody = z.object({ nodes: z.array(nodeBase).min(1).max(200) });
const batchEditBody = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1),
        version: z.number().int().optional(),
        name: z.string().max(80).optional(),
        x: z.number().int().optional(),
        y: z.number().int().optional(),
        z_index: z.number().int().optional(),
        params: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(200),
});
const idsBody = z.object({ node_ids: z.array(z.string().min(1)).min(1).max(500) });

const edgeBody = z.object({
  src_node_id: z.string().min(1),
  dst_node_id: z.string().min(1),
  semantic: z.enum(["pipeline", "reference", "sequence"]).optional(),
});
const batchEdgesBody = z.object({ edges: z.array(edgeBody).min(1).max(500) });
const edgeIdsBody = z.object({ edge_ids: z.array(z.string().min(1)).min(1).max(500) });

const commitBody = z.object({
  version: z.number().int().min(1),
  nodes: z
    .array(
      z.object({
        id: z.string().optional(),
        node_type: z.string().min(1),
        name: z.string().max(80).optional(),
        x: z.number().int(),
        y: z.number().int(),
        width: z.number().int().nullable().optional(),
        height: z.number().int().nullable().optional(),
        z_index: z.number().int().optional(),
        params: z.unknown().optional(),
        task_id: z.string().nullable().optional(),
        status: z.number().int().min(1).max(3).optional(),
        group_ids: z.array(z.string()).optional(),
      }),
    )
    .max(1000),
  edges: z.array(edgeBody).max(2000),
  groups: z
    .array(
      z.object({
        id: z.string().optional(),
        parent_id: z.string().nullable().optional(),
        name: z.string().max(60).optional(),
        sort: z.number().int().optional(),
        status: z.number().int().min(1).max(2).optional(),
      }),
    )
    .max(200)
    .optional(),
  kind: z.number().int().min(1).max(2).optional(),
});

const groupBody = z.object({
  name: z.string().max(60).optional(),
  parent_id: z.string().nullable().optional(),
  sort: z.number().int().optional(),
});
const pinBody = z.object({ node_id: z.string().nullable() });

@Controller("canvas")
export class CanvasController {
  constructor(@Inject(CanvasService) private readonly canvas: CanvasService) {}

  private ctx(req: AuthedRequest): { spaceId: string; userId: string } {
    if (!req.auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return { spaceId: req.auth.spaceId, userId: req.auth.userId };
  }

  // ── 画布 ────────────────────────────────────────────────
  @Get("canvases")
  async list(@Req() req: AuthedRequest, @Query("page") page?: string, @Query("page_size") pageSize?: string) {
    const c = this.ctx(req);
    return this.canvas.list(c.spaceId, Number(page ?? 1), Number(pageSize ?? 20));
  }

  @Post("canvases")
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const c = this.ctx(req);
    return this.canvas.create(c.spaceId, c.userId, parseOrThrow(createCanvas, body));
  }

  @Get("canvases/:canvas_id")
  async get(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string) {
    const c = this.ctx(req);
    return this.canvas.get(c.spaceId, canvasId);
  }

  @Patch("canvases/:canvas_id")
  async rename(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    return this.canvas.rename(c.spaceId, canvasId, parseOrThrow(renameCanvas, body));
  }

  @Delete("canvases/:canvas_id")
  async remove(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string) {
    const c = this.ctx(req);
    return this.canvas.remove(c.spaceId, canvasId);
  }

  /** 整图提交（乐观锁 + 快照） */
  @Post("canvases/:canvas_id/commit")
  async commit(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    return this.canvas.commit(c.spaceId, canvasId, c.userId, parseOrThrow(commitBody, body));
  }

  @Get("canvases/:canvas_id/snapshots")
  async snapshots(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Query("limit") limit?: string) {
    const c = this.ctx(req);
    return this.canvas.listSnapshots(c.spaceId, canvasId, Number(limit ?? 20));
  }

  @Get("canvases/:canvas_id/snapshots/:version")
  async snapshot(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Param("version") version: string) {
    const c = this.ctx(req);
    return this.canvas.getSnapshot(c.spaceId, canvasId, Number(version));
  }

  // ── 节点 ────────────────────────────────────────────────
  @Post("canvases/:canvas_id/nodes")
  async createNode(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    return this.canvas.createNode(c.spaceId, canvasId, parseOrThrow(createNodeBody, body));
  }

  @Post("canvases/:canvas_id/nodes/batch")
  async batchCreate(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    const input = parseOrThrow(batchNodesBody, body);
    return this.canvas.batchCreateNodes(c.spaceId, canvasId, input.nodes);
  }

  @Post("canvases/:canvas_id/nodes/batch-edit")
  async batchEdit(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    const input = parseOrThrow(batchEditBody, body);
    return this.canvas.batchEditNodes(c.spaceId, canvasId, input.nodes);
  }

  @Patch("canvases/:canvas_id/nodes/:node_id")
  async patchNode(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("node_id") nodeId: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    return this.canvas.updateNode(c.spaceId, canvasId, nodeId, parseOrThrow(patchNodeBody, body));
  }

  @Delete("canvases/:canvas_id/nodes/:node_id")
  async deleteNode(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Param("node_id") nodeId: string) {
    const c = this.ctx(req);
    return this.canvas.removeNode(c.spaceId, canvasId, nodeId);
  }

  @Post("canvases/:canvas_id/nodes/batch-delete")
  async batchDelete(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    const input = parseOrThrow(idsBody, body);
    return this.canvas.batchDeleteNodes(c.spaceId, canvasId, input.node_ids);
  }

  @Post("canvases/:canvas_id/nodes-recover")
  async recoverNodes(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    const input = parseOrThrow(idsBody, body);
    return this.canvas.recoverNodes(c.spaceId, canvasId, input.node_ids);
  }

  @Get("canvases/:canvas_id/nodes")
  async nodes(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Query("node_type") nodeType?: string,
  ) {
    const c = this.ctx(req);
    return this.canvas.nodesByType(c.spaceId, canvasId, nodeType);
  }

  // ── 连线 ────────────────────────────────────────────────
  @Post("canvases/:canvas_id/edges")
  async createEdge(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    return this.canvas.createEdge(c.spaceId, canvasId, parseOrThrow(edgeBody, body));
  }

  @Post("canvases/:canvas_id/edges/batch")
  async batchEdges(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    const input = parseOrThrow(batchEdgesBody, body);
    return this.canvas.batchCreateEdges(c.spaceId, canvasId, input.edges);
  }

  @Delete("canvases/:canvas_id/edges/:edge_id")
  async deleteEdge(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Param("edge_id") edgeId: string) {
    const c = this.ctx(req);
    return this.canvas.deleteEdge(c.spaceId, canvasId, edgeId);
  }

  @Post("canvases/:canvas_id/edges/batch-delete")
  async batchDeleteEdges(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    const input = parseOrThrow(edgeIdsBody, body);
    return this.canvas.batchDeleteEdges(c.spaceId, canvasId, input.edge_ids);
  }

  // ── 锁 / 心跳 ───────────────────────────────────────────
  @Post("canvases/:canvas_id/nodes/:node_id/lock")
  async lock(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Param("node_id") nodeId: string) {
    const c = this.ctx(req);
    return this.canvas.lockNode(c.spaceId, canvasId, nodeId, c.userId);
  }

  @Post("canvases/:canvas_id/nodes/:node_id/unlock")
  async unlock(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Param("node_id") nodeId: string) {
    const c = this.ctx(req);
    return this.canvas.unlockNode(c.spaceId, canvasId, nodeId, c.userId);
  }

  @Post("canvases/:canvas_id/nodes/:node_id/renew")
  async renew(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Param("node_id") nodeId: string) {
    const c = this.ctx(req);
    return this.canvas.renewNode(c.spaceId, canvasId, nodeId, c.userId);
  }

  @Post("canvases/:canvas_id/heartbeat")
  async heartbeat(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string) {
    const c = this.ctx(req);
    return this.canvas.heartbeat(c.spaceId, canvasId, c.userId);
  }

  // ── 分组 ────────────────────────────────────────────────
  @Post("canvases/:canvas_id/groups")
  async createGroup(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    return this.canvas.createGroup(c.spaceId, canvasId, parseOrThrow(groupBody, body));
  }

  @Delete("canvases/:canvas_id/groups/:group_id")
  async deleteGroup(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("group_id") groupId: string,
  ) {
    const c = this.ctx(req);
    return this.canvas.deleteGroup(c.spaceId, canvasId, groupId);
  }

  /** 钉住节点（单选；body.node_id=null 表示取消钉住） */
  @Put("canvases/:canvas_id/pinned-node")
  async pinNode(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    return this.canvas.setPinnedNode(c.spaceId, canvasId, parseOrThrow(pinBody, body));
  }
}
