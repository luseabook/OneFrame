import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { CanvasNodeTasksService } from "./canvas-node-tasks.service";

/**
 * 画布节点派生任务端点（F1 契约 §14.4 C6 / draft §3.4）
 *
 * 全部落在既有 `tasks` 体系上（ADR-003：不得新建任务表）。
 * 前缀与 canvas 域一致：`/canvas/canvases/{id}/...`。
 */

const genInput = z.object({
  prompt: z.string().max(50_000).optional(),
  reference_uris: z.array(z.string()).max(8).optional(),
  first_frame_uri: z.string().nullish(),
  last_frame_uri: z.string().nullish(),
});
const genOptions = z.record(z.unknown()).optional();
const generateBody = z.object({
  mode: z.string().min(1),
  model: z.string().min(1),
  input: genInput.default({}),
  options: genOptions,
  quote_id: z.string().min(1).optional(),
});

const batchBody = z.object({
  items: z
    .array(
      z.object({
        node_id: z.string().min(1),
        mode: z.string().min(1),
        model: z.string().min(1),
        input: genInput.default({}),
        options: genOptions,
        quote_id: z.string().min(1).optional(),
      }),
    )
    .min(1)
    .max(50),
});

const syncBody = z.object({ node_ids: z.array(z.string().min(1)).max(500).default([]) });

@Controller("canvas")
export class CanvasNodeTasksController {
  constructor(@Inject(CanvasNodeTasksService) private readonly svc: CanvasNodeTasksService) {}

  private ctx(req: AuthedRequest): { spaceId: string; userId: string } {
    if (!req.auth) {
      // 与其他 canvas 端点保持一致：未登录由全局 AuthGuard 拦，这里只是类型收窄
      throw new Error("auth missing");
    }
    return { spaceId: req.auth.spaceId, userId: req.auth.userId };
  }

  /** 单节点投递生成任务（回写 node.task_id + status=2） */
  @Post("canvases/:canvas_id/nodes/:node_id/generate")
  async generate(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("node_id") nodeId: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    const input = parseOrThrow(generateBody, body);
    return this.svc.generate(
      { spaceId: c.spaceId, userId: c.userId } as never,
      c.spaceId,
      canvasId,
      nodeId,
      input,
    );
  }

  /** 批量投递（≤50，逐条独立，一条失败不连累其它） */
  @Post("canvases/:canvas_id/batch-node-tasks")
  async batch(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    const input = parseOrThrow(batchBody, body);
    return this.svc.batchGenerate(
      { spaceId: c.spaceId, userId: c.userId } as never,
      c.spaceId,
      canvasId,
      input.items,
    );
  }

  /** 节点任务状态（含结果），校验 task 确实属于该节点 */
  @Get("canvases/:canvas_id/nodes/:node_id/task/:task_id")
  async taskStatus(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("node_id") nodeId: string,
    @Param("task_id") taskId: string,
  ) {
    const c = this.ctx(req);
    return this.svc.nodeTaskStatus(c.spaceId, canvasId, nodeId, taskId);
  }

  /**
   * 校正一批节点的任务状态。
   * 前端打开画布时调一次：防止错过轮询窗口后画布永远停在"生成中"。
   */
  @Post("canvases/:canvas_id/nodes/sync-tasks")
  async sync(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Body() body: unknown) {
    const c = this.ctx(req);
    const input = parseOrThrow(syncBody, body);
    return this.svc.syncNodeTaskStates(c.spaceId, canvasId, input.node_ids);
  }

  /** 一次性取走"本画布哪些节点有在途任务"（前端决定要不要开轮询） */
  @Get("canvases/:canvas_id/running-nodes")
  async running(@Req() req: AuthedRequest, @Param("canvas_id") canvasId: string, @Query("status") _status?: string) {
    const c = this.ctx(req);
    return this.svc.syncNodeTaskStates(c.spaceId, canvasId, []);
  }
}
