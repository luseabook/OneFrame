import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { CanvasService } from "./canvas.service";
import { MAX_PIN_SLOTS } from "./canvas-group.service";

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
/**
 * 画布封面：`asset_id` 与 `node_id` 二选一；都不给 = 清除（回落到自动兜底）。
 *
 * 为什么不做成必填：清除是常见操作（"这张图不好看，换回自动"），
 * 强制传 `asset_id: null` 会让前端为"没值"造一个假值。
 */
const coverCanvas = z.object({
  asset_id: z.string().max(20).nullable().optional(),
  node_id: z.string().max(20).nullable().optional(),
});

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

/**
 * 画布恢复入参（两种模式互斥）：
 * - `node_ids`：撤销软删（既有语义，`routes.txt:359`）；
 * - `from_snapshot` / 省略：从快照补齐缺失节点与边。
 * 明确互斥是为了避免"既想撤销删除又想补快照"这种歧义请求被静默解释成其中一种。
 */
const recoverBody = z
  .object({
    node_ids: z.array(z.string().min(1)).min(1).max(500).optional(),
    from_snapshot: z.boolean().optional(),
    version: z.number().int().min(1).optional(),
  })
  .refine((value) => !(value.node_ids && value.from_snapshot), {
    message: "node_ids 与 from_snapshot 不能同时给",
  });

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
        // 第 120 批：与 `PUT nodes/:id/pin-groups` 同一语义，项数上限必须相同（每画布 7 槽）
        group_ids: z.array(z.string()).max(MAX_PIN_SLOTS).optional(),
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

  /**
   * 设置 / 清除画布封面（第 62 批）。
   *
   * 放在 `POST /canvas/canvases/:id/cover` 而不是塞进 `PATCH canvases/:id`：
   * ① 竞品就是独立动作（`POST /script_project/edit { cover, sp_id }`）；
   * ② 改名要带乐观锁 version，设封面不该被画布版本号拖累（封面与画布内容无关）。
   */
  @Post("canvases/:canvas_id/cover")
  async cover(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    return this.canvas.setCover(c.spaceId, canvasId, parseOrThrow(coverCanvas, body ?? {}));
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

  /**
   * 节点恢复（两种模式，按入参区分）：
   * - `{node_ids:[...]}`（既有）：撤销软删，恢复**指定**节点；
   * - `{from_snapshot:true}`（新）或省略 node_ids：从最近快照补齐**缺失**的节点与边，
   *   不覆盖现存（见 canvas.service.recoverNodesFromSnapshot 注释）。
   */
  @Post("canvases/:canvas_id/nodes-recover")
  async recoverNodes(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    const input = parseOrThrow(recoverBody, body ?? {});
    if (input.node_ids && input.node_ids.length > 0) {
      return this.canvas.recoverNodes(c.spaceId, canvasId, input.node_ids);
    }
    return this.canvas.recoverNodesFromSnapshot(c.spaceId, canvasId, input.version);
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

  /**
   * 单个节点（第 87 批：竞品 `GET /df/canvas/:canvas_id/nodes/:node_id`）。
   *
   * 与列表接口同一套归属校验；单独一条是为了"任务回调后只重绘一张卡片"这类
   * 常见刷新路径不必拉整画布。
   */
  @Get("canvases/:canvas_id/nodes/:node_id")
  async node(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("node_id") nodeId: string,
  ) {
    const c = this.ctx(req);
    return this.canvas.nodeDetail(c.spaceId, canvasId, nodeId);
  }

  /**
   * 节点锁状态（第 87 批：竞品 `GET /df/canvas/:canvas_id/nodes/:node_id/lock`）。
   *
   * 锁只在 Redis（30s TTL），所以这条读的是缓存而不是库：`locked_by` 是持锁的
   * user_id，`ttl_s` 供前端决定还要不要等。
   */
  @Get("canvases/:canvas_id/nodes/:node_id/lock")
  async nodeLock(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("node_id") nodeId: string,
  ) {
    const c = this.ctx(req);
    return this.canvas.nodeLock(c.spaceId, canvasId, nodeId);
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

  /**
   * 取消钉住（第 87 批：竞品是 `DELETE /df/canvas/:canvas_id/pinned-node`）。
   *
   * 语义与 `PUT {"node_id": null}` 完全一致（`setPinnedNode` 里 `null` 就是清除），
   * 但竞品的调用形状是 DELETE 且**没有 body**，只给 PUT 的话按竞品写的客户端会 405/404。
   * 两条路都保留：PUT 带 body 适合"切换钉住对象"，DELETE 适合"取消钉住"。
   */
  @Delete("canvases/:canvas_id/pinned-node")
  async unpinNode(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string) {
    const c = this.ctx(req);
    return this.canvas.setPinnedNode(c.spaceId, canvasId, { node_id: null });
  }
}
