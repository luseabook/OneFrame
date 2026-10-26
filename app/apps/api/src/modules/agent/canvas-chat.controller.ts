import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { SkipEnvelope } from "../../common/http/skip-envelope.decorator";
import { parseOrThrow } from "../../common/zod";
import { AgentChatService } from "./agent-chat.service";
import { AgentMessagesService } from "./agent-messages.service";
import { AgentSessionsService } from "./agent-sessions.service";
import { AgentStreamService } from "./agent-stream.service";

/**
 * 画布内对话会话端点（契约 §3.3 的 C7 族）。
 *
 * 与 `agent.controller.ts` 共用同一套会话/消息/事件表（契约 §2.3.0 的合表决策）：
 * 这里只是"作用域固定为某个画布"的入口，没有第二套实现。
 * 注意 `chat/sessions/*` 不挂在画布下——会话 id 本身已经唯一，
 * 多带一段 canvas_id 只会让前端在每个调用点重复校验。
 */
@Controller("canvas")
export class CanvasChatController {
  constructor(
    @Inject(AgentSessionsService) private readonly sessions: AgentSessionsService,
    @Inject(AgentMessagesService) private readonly messages: AgentMessagesService,
    @Inject(AgentChatService) private readonly chat: AgentChatService,
    @Inject(AgentStreamService) private readonly stream: AgentStreamService,
  ) {}

  private auth(req: AuthedRequest): { userId: string; spaceId: string } {
    if (!req.auth) throw new Error("auth missing");
    return { userId: req.auth.userId, spaceId: req.auth.spaceId };
  }

  /** 校验"这个会话确实属于这个画布"，防止拿别人的 session_id 拼路径偷读 */
  private async assertBelongs(spaceId: string, canvasId: string, sessionId: string): Promise<void> {
    const session = await this.sessions.requireSession(spaceId, sessionId);
    if (session.scope !== 2 || String(session.canvasId) !== canvasId) {
      throw new AppError(ErrorCode.NOT_FOUND, "session not found in this canvas", { session_id: sessionId });
    }
  }

  @Get("canvases/:canvas_id/chat/sessions")
  async listSessions(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
  ) {
    const a = this.auth(req);
    await this.sessions.assertCanvas(a.spaceId, canvasId);
    return this.sessions.list({ spaceId: a.spaceId, canvasId }, Number(page ?? 1), Number(pageSize ?? 20));
  }

  @Post("canvases/:canvas_id/chat/sessions")
  async createSession(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Body() body: unknown,
  ) {
    const a = this.auth(req);
    const input = parseOrThrow(z.object({ title: z.string().max(60).optional() }), body ?? {});
    const session = await this.sessions.create({
      spaceId: a.spaceId,
      userId: a.userId,
      canvasId,
      title: input.title,
    });
    return { session };
  }

  @Patch("canvases/:canvas_id/chat/sessions/:session_id")
  async updateSession(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("session_id") sessionId: string,
    @Body() body: unknown,
  ) {
    const a = this.auth(req);
    await this.assertBelongs(a.spaceId, canvasId, sessionId);
    const input = parseOrThrow(
      z.object({
        title: z.string().max(60).optional(),
        status: z.union([z.literal(1), z.literal(2)]).optional(),
      }),
      body ?? {},
    );
    return { session: await this.sessions.update(a.spaceId, sessionId, input) };
  }

  @Delete("canvases/:canvas_id/chat/sessions/:session_id")
  async removeSession(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("session_id") sessionId: string,
  ) {
    const a = this.auth(req);
    await this.assertBelongs(a.spaceId, canvasId, sessionId);
    return this.sessions.remove(a.spaceId, sessionId);
  }

  @Get("canvases/:canvas_id/chat/sessions/:session_id/messages")
  async listMessages(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("session_id") sessionId: string,
    @Query("after_event_id") afterEventId?: string,
    @Query("page_size") pageSize?: string,
  ) {
    const a = this.auth(req);
    await this.assertBelongs(a.spaceId, canvasId, sessionId);
    return this.chat.history(sessionId, a.spaceId, afterEventId, Number(pageSize ?? 50));
  }

  @Post("canvases/:canvas_id/chat/sessions/:session_id/messages")
  async postMessage(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Param("session_id") sessionId: string,
    @Body() body: unknown,
  ) {
    const a = this.auth(req);
    await this.assertBelongs(a.spaceId, canvasId, sessionId);
    const input = parseOrThrow(
      z.object({
        // HITL 决策允许只带 decision 不带正文（前端点"同意/拒绝"不该伪造一句用户台词）
        content: z.string().max(4000).optional(),
        content_type: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
        reference_node_ids: z.array(z.string().min(1)).max(50).optional(),
        decision: z
          .object({
            interrupt_id: z.string().min(1).max(128),
            decision: z.enum(["approve", "reject"]),
            edits: z.unknown().optional(),
          })
          .optional(),
        wait: z.boolean().optional(),
      }),
      body,
    );
    return this.chat.send(a, sessionId, {
      content: input.content ?? "",
      contentType: input.content_type,
      referenceNodeIds: input.reference_node_ids,
      decision: input.decision,
      wait: input.wait,
    });
  }

  /** 历史产出：助手真正给过"可落地节点"的那些消息，用于复用 */
  @Get("canvases/:canvas_id/chat/writing-outputs")
  async writingOutputs(
    @Req() req: AuthedRequest,
    @Param("canvas_id") canvasId: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
  ) {
    const a = this.auth(req);
    await this.sessions.assertCanvas(a.spaceId, canvasId);
    return this.messages.writingOutputs(a.spaceId, canvasId, Number(page ?? 1), Number(pageSize ?? 20));
  }

  @Post("chat/sessions/:session_id/read")
  async markRead(@Req() req: AuthedRequest, @Param("session_id") sessionId: string, @Body() body: unknown) {
    const a = this.auth(req);
    const session = await this.sessions.requireSession(a.spaceId, sessionId);
    const input = parseOrThrow(z.object({ last_read_seq: z.number().int().min(0) }), body);
    return { unread_count: await this.sessions.markRead(session.id, input.last_read_seq) };
  }

  /**
   * 会话事件流。
   *
   * 走 `?last_stream_id=` 增量续传；游标已过期 → 746004（客户端据此拉全量后重连）。
   * 该响应不是 JSON 信封，必须 `@SkipEnvelope()`。
   */
  @Get("chat/sessions/:session_id/stream")
  @SkipEnvelope()
  async streamSession(
    @Req() req: AuthedRequest,
    @Param("session_id") sessionId: string,
    @Res() reply: FastifyReply,
    @Query("last_stream_id") lastStreamId?: string,
  ): Promise<void> {
    const a = this.auth(req);
    const session = await this.sessions.requireSession(a.spaceId, sessionId);
    await this.stream.pipeSession(reply, session.id, lastStreamId);
  }

  @Post("chat/sessions/:session_id/messages/:message_id/reaction")
  async react(
    @Req() req: AuthedRequest,
    @Param("session_id") sessionId: string,
    @Param("message_id") messageId: string,
    @Body() body: unknown,
  ) {
    const a = this.auth(req);
    const session = await this.sessions.requireSession(a.spaceId, sessionId);
    const input = parseOrThrow(z.object({ reaction: z.enum(["like", "dislike", "none"]) }), body);
    return this.messages.setReaction(session.id, messageId, input.reaction);
  }

  /** 消息 → 画布节点绑定：记录"这个节点是这条消息产出的"，可按节点反查来源 */
  @Post("chat/sessions/:session_id/messages/:message_id/node-binding")
  async bindNodes(
    @Req() req: AuthedRequest,
    @Param("session_id") sessionId: string,
    @Param("message_id") messageId: string,
    @Body() body: unknown,
  ) {
    const a = this.auth(req);
    const session = await this.sessions.requireSession(a.spaceId, sessionId);
    const input = parseOrThrow(
      z.object({
        node_ids: z.array(z.string().min(1)).min(1).max(200),
        binding_kind: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      }),
      body,
    );
    return this.messages.bindNodes(
      BigInt(a.spaceId),
      session.id,
      messageId,
      input.node_ids,
      input.binding_kind ?? 1,
    );
  }
}
