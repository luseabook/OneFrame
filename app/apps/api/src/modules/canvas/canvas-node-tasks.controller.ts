import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { CanvasNodeTasksService } from "./canvas-node-tasks.service";
import { CanvasDeriveService } from "./canvas-derive.service";

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

/**
 * 文本类派生入参。
 *
 * `source_text` 可选：不传就用节点自身的原文（剧本/文本节点的 params）。
 * 也就是说，正常路径是"选中节点点按钮"，而不是让前端把正文再搬一遍——
 * 正文搬一遍就会出现"节点里改了、请求里还是旧的"这种不一致。
 */
const deriveBody = z.object({
  // zod 只挡明显异常的巨型请求；"超 5 万字"的业务错误码（400104）由 service 给。
  // 若 zod 也卡 50000，同一条规则会冒出两个码，前端没法统一处理。
  source_text: z.string().max(200_000).optional(),
  prompt: z.string().max(2_000).optional(),
  model: z.string().min(1).optional(),
});

@Controller("canvas")
export class CanvasNodeTasksController {
  constructor(
    @Inject(CanvasNodeTasksService) private readonly svc: CanvasNodeTasksService,
    @Inject(CanvasDeriveService) private readonly derive: CanvasDeriveService,
  ) {}

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

  /** 剧本优化（文本类派生，按次计价，价目由后台配置） */
  @Post("canvases/:canvas_id/nodes/:node_id/script-optimization")
  async scriptOptimization(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("node_id") nodeId: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    const input = parseOrThrow(deriveBody, body ?? {});
    return this.derive.derive(c, canvasId, nodeId, "script_optimization", input);
  }

  /** 拆解分镜（文本类派生；结果由 worker 回写到节点 params.result_text） */
  @Post("canvases/:canvas_id/nodes/:node_id/storyboard-parse")
  async storyboardParse(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("node_id") nodeId: string,
    @Body() body: unknown,
  ) {
    const c = this.ctx(req);
    const input = parseOrThrow(deriveBody, body ?? {});
    return this.derive.derive(c, canvasId, nodeId, "storyboard_parse", input);
  }
}
