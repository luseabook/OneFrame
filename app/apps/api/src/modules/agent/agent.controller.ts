import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { AppError, ErrorCode, generationRequestSchema } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { SkipEnvelope } from "../../common/http/skip-envelope.decorator";
import { signStreamToken, streamTokenExpiresAt, STREAM_TOKEN_TTL_S } from "../../common/stream-token";
import { parseOrThrow } from "../../common/zod";
import { AgentChatService } from "./agent-chat.service";
import { AgentSessionsService } from "./agent-sessions.service";
import { AgentStreamService } from "./agent-stream.service";
import { AgentTaskService } from "./agent-task.service";

/**
 * agent 域端点（契约 §3.6，前缀 `/v1/agent`）。
 *
 * 路由顺序说明：`task/create`、`task/stream` 这类字面量必须在 `task/:task_id`
 * **之前**声明，否则会被参数路由吞掉（Nest 按声明顺序匹配）。
 */
@Controller("agent")
export class AgentController {
  constructor(
    @Inject(AgentTaskService) private readonly tasks: AgentTaskService,
    @Inject(AgentChatService) private readonly chat: AgentChatService,
    @Inject(AgentSessionsService) private readonly sessions: AgentSessionsService,
    @Inject(AgentStreamService) private readonly stream: AgentStreamService,
  ) {}

  private auth(req: AuthedRequest): { userId: string; spaceId: string; jti: string } {
    if (!req.auth) throw new Error("auth missing");
    return req.auth;
  }

  /** 只校验不落库：让 Agent 在投递前告诉用户"会不会失败" */
  @Post("task/create-check")
  async createCheck(@Req() req: AuthedRequest, @Body() body: unknown) {
    const a = this.auth(req);
    const input = parseOrThrow(generationRequestSchema, body);
    return this.tasks.check(a, input);
  }

  @Post("task/create")
  async create(
    @Req() req: AuthedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!idempotencyKey) {
      throw new AppError(ErrorCode.BAD_REQUEST, "Idempotency-Key header required");
    }
    const a = this.auth(req);
    const input = parseOrThrow(
      generationRequestSchema.extend({ session_id: z.string().min(1).optional() }),
      body,
    );
    const { session_id: sessionId, ...request } = input;
    return this.tasks.create(a, request, idempotencyKey, sessionId);
  }

  @Post("task/batch-download")
  async batchDownload(@Req() req: AuthedRequest, @Body() body: unknown) {
    const a = this.auth(req);
    const input = parseOrThrow(z.object({ task_ids: z.array(z.string().min(1)).min(1).max(50) }), body);
    return this.tasks.batchDownload(a.spaceId, input.task_ids);
  }

  /**
   * 任务进度流。
   *
   * 契约草案里这条在参照站是 `POST + raw body + query task_id`（bundle 证据），
   * 但它的内容**未取证**（A-05/G-12），而 SSE 用 GET 才能吃到浏览器原生的
   * 断线重连与 `Last-Event-ID` 语义。这里取 GET `?task_id=`，差异已登记。
   */
  @Get("task/stream")
  @SkipEnvelope()
  async taskStream(
    @Req() req: AuthedRequest,
    @Query("task_id") taskId: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await this.pipeTaskStream(req, taskId, reply);
  }

  /**
   * 任务进度流的 POST 别名（第 84 批）。
   *
   * 竞品这条是 `POST /web/v1/agent/task/stream`（bundle 证据：`method: Method.POST`、
   * `requestBodyType: json`、`queryNames: ["task_id"]`）—— 按竞品形状发 POST 的客户端
   * 打到我方只读 GET 路径上是 **404**，这是客户端自己改不掉的形状差异，所以补别名而不是只登记。
   * GET 保留：浏览器原生 `EventSource` 只能发 GET，断线重连语义靠它。
   *
   * `task_id` 先看 query、再看 body（竞品的 raw body 里也可能带），两处都给时 query 优先。
   */
  @Post("task/stream")
  @SkipEnvelope()
  async taskStreamPost(
    @Req() req: AuthedRequest,
    @Query("task_id") queryTaskId: string | undefined,
    @Body() body: unknown,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const input = parseOrThrow(z.object({ task_id: z.string().min(1).optional() }), body ?? {});
    await this.pipeTaskStream(req, queryTaskId ?? input.task_id, reply);
  }

  /** GET / POST 两条流共用的取数与校验（避免两份鉴权/参数校验漂移） */
  private async pipeTaskStream(
    req: AuthedRequest,
    taskId: string | undefined,
    reply: FastifyReply,
  ): Promise<void> {
    const a = this.auth(req);
    if (!taskId) throw new AppError(ErrorCode.INVALID_PARAM, "task_id is required", { field: "task_id" });
    await this.stream.pipeTask(reply, a.spaceId, taskId);
  }

  /** 签发 SSE 短令牌（EventSource 无法带 Authorization 头，ADR-012） */
  @Post("stream-token")
  async streamToken(@Req() req: AuthedRequest, @Body() body: unknown) {
    const a = this.auth(req);
    const input = parseOrThrow(z.object({ session_id: z.string().min(1).optional() }), body ?? {});
    if (input.session_id) {
      // 绑定前先确认会话归属，避免签出"能连别人会话"的令牌
      await this.sessions.requireSession(a.spaceId, input.session_id);
    }
    return {
      token: signStreamToken({ sub: a.userId, sid: a.spaceId, ses: input.session_id ?? null }),
      expires_at: streamTokenExpiresAt(),
      ttl_s: STREAM_TOKEN_TTL_S,
    };
  }

  /** 对话（独立创作 Agent）：无 session_id 时自动开一个 scope=1 会话 */
  @Post("task/chat")
  async taskChat(@Req() req: AuthedRequest, @Body() body: unknown) {
    const a = this.auth(req);
    const input = parseOrThrow(
      z.object({
        session_id: z.string().min(1).optional(),
        content: z.string().min(1).max(4000),
        content_type: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
        attachments: z.array(z.string().max(2048)).max(9).optional(),
        wait: z.boolean().optional(),
      }),
      body,
    );
    const sessionId = input.session_id ?? (await this.sessions.create({ spaceId: a.spaceId, userId: a.userId })).session_id;
    return this.chat.send(a, sessionId, {
      content: input.content,
      contentType: input.content_type,
      wait: input.wait,
    });
  }

  @Post("task/chat-end")
  async taskChatEnd(@Req() req: AuthedRequest, @Body() body: unknown) {
    const a = this.auth(req);
    const input = parseOrThrow(z.object({ session_id: z.string().min(1) }), body);
    return this.chat.end(a.spaceId, input.session_id);
  }

  @Get("task/:task_id")
  async taskDetail(@Req() req: AuthedRequest, @Param("task_id") taskId: string) {
    const a = this.auth(req);
    return this.tasks.detail(a.spaceId, taskId);
  }

  @Put("task/:task_id")
  async taskUpdate(@Req() req: AuthedRequest, @Param("task_id") taskId: string, @Body() body: unknown) {
    const a = this.auth(req);
    const input = parseOrThrow(
      z.object({
        title: z.string().max(120).nullable().optional(),
        feedback: z
          .object({
            reaction: z.enum(["like", "dislike", "none"]).optional(),
            comment: z.string().max(500).optional(),
          })
          .optional(),
      }),
      body,
    );
    return this.tasks.update(a.spaceId, taskId, input);
  }
}
