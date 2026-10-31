import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { AllowStreamToken } from "../../common/allow-stream-token.decorator";
import { SkipEnvelope } from "../../common/http/skip-envelope.decorator";
import { parseOrThrow } from "../../common/zod";
import { AgentChatService } from "./agent-chat.service";
import { AgentSessionsService } from "./agent-sessions.service";
import { AgentSkillsService } from "./agent-skills.service";
import { AgentStreamService } from "./agent-stream.service";

/**
 * 独立创作 Agent（scope=1）的会话端点 —— `/agent` 页面用。
 *
 * 为什么需要这一层：`agent.controller.ts` 只有 `task/*`（无会话 CRUD），
 * 画布内会话在 `canvas-chat.controller.ts`（scope=2）。`/agent` 页要"历史会话侧栏 +
 * 切换会话 + SSE 续传 + 已读"，就必须有 scope=1 的会话入口；底层完全复用
 * 既有 `agent_sessions / agent_messages / agent_events` 三表，没有第二套存储。
 *
 * 作用域闸门：只放行 `scope=1` 的会话。拿画布会话 id 来打这些端点一律 404，
 * 避免"两套入口拼起来能改画布会话"的越权面。
 */
@Controller("agent")
export class AgentConversationsController {
  constructor(
    @Inject(AgentSessionsService) private readonly sessions: AgentSessionsService,
    @Inject(AgentChatService) private readonly chat: AgentChatService,
    @Inject(AgentStreamService) private readonly stream: AgentStreamService,
    @Inject(AgentSkillsService) private readonly skills: AgentSkillsService,
  ) {}

  private auth(req: AuthedRequest): { userId: string; spaceId: string; jti: string } {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return { userId: auth.userId, spaceId: auth.spaceId, jti: auth.jti };
  }

  /** 会话必须是独立创作会话（scope=1）且属于本 space */
  private async requireStandalone(spaceId: string, sessionId: string) {
    const session = await this.sessions.requireSession(spaceId, sessionId);
    if (session.scope !== 1) {
      throw new AppError(ErrorCode.NOT_FOUND, "session not found", { session_id: sessionId });
    }
    return session;
  }

  /** 历史会话侧栏 */
  @Get("sessions")
  async listSessions(
    @Req() req: AuthedRequest,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
  ) {
    const a = this.auth(req);
    return this.sessions.list({ spaceId: a.spaceId, canvasId: null }, Number(page ?? 1), Number(pageSize ?? 20));
  }

  /** 新建会话（不建也能聊：`POST /agent/task/chat` 会自动开一个） */
  @Post("sessions")
  async createSession(@Req() req: AuthedRequest, @Body() body: unknown) {
    const a = this.auth(req);
    const input = parseOrThrow(z.object({ title: z.string().max(60).optional() }), body ?? {});
    return { session: await this.sessions.create({ spaceId: a.spaceId, userId: a.userId, title: input.title }) };
  }

  @Patch("sessions/:session_id")
  async updateSession(
    @Req() req: AuthedRequest,
    @Param("session_id") sessionId: string,
    @Body() body: unknown,
  ) {
    const a = this.auth(req);
    await this.requireStandalone(a.spaceId, sessionId);
    const input = parseOrThrow(
      z.object({
        title: z.string().max(60).optional(),
        // 1 活跃 / 2 已结束 / 3 已归档
        status: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      }),
      body ?? {},
    );
    return { session: await this.sessions.update(a.spaceId, sessionId, input) };
  }

  @Delete("sessions/:session_id")
  async removeSession(@Req() req: AuthedRequest, @Param("session_id") sessionId: string) {
    const a = this.auth(req);
    await this.requireStandalone(a.spaceId, sessionId);
    return this.sessions.remove(a.spaceId, sessionId);
  }

  /** 游标分页：`after_event_id` 传上页的 `next_event_id`（不重不漏） */
  @Get("sessions/:session_id/messages")
  async listMessages(
    @Req() req: AuthedRequest,
    @Param("session_id") sessionId: string,
    @Query("after_event_id") afterEventId?: string,
    @Query("page_size") pageSize?: string,
  ) {
    const a = this.auth(req);
    await this.requireStandalone(a.spaceId, sessionId);
    return this.chat.history(sessionId, a.spaceId, afterEventId, Number(pageSize ?? 50));
  }

  /**
   * 发消息。
   *
   * `skill_ids`：本次发言使用的 Skill 卡。它**不参与 LLM 提示词**（正文由前端把卡片
   * 的预置 prompt 填进输入框，用户可改），只做两件事：
   * 1. 写进用户消息 payload，便于回溯"这条产物用了哪张卡"；
   * 2. 给卡片 `use_count` +1（广场排序信号）。
   */
  @Post("sessions/:session_id/messages")
  async sendMessage(
    @Req() req: AuthedRequest,
    @Param("session_id") sessionId: string,
    @Body() body: unknown,
  ) {
    const a = this.auth(req);
    await this.requireStandalone(a.spaceId, sessionId);
    const input = parseOrThrow(
      z.object({
        content: z.string().max(4000).optional(),
        content_type: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
        skill_ids: z.array(z.string().min(1)).max(5).optional(),
        decision: z
          .object({
            interrupt_id: z.string().min(1).max(128),
            decision: z.enum(["approve", "reject"]),
            edits: z.unknown().optional(),
          })
          .optional(),
        wait: z.boolean().optional(),
      }),
      body ?? {},
    );
    const skillIds = input.skill_ids ?? [];
    if (skillIds.length > 0) await this.skills.markUsed(a.spaceId, skillIds);
    return this.chat.send(
      { userId: a.userId, spaceId: a.spaceId },
      sessionId,
      {
        content: input.content ?? "",
        contentType: input.content_type,
        decision: input.decision,
        wait: input.wait,
        ...(skillIds.length > 0 ? { extraPayload: { skill_ids: skillIds } } : {}),
      },
    );
  }

  /** 已读回执：前端拿到未读数后收起角标 */
  @Post("sessions/:session_id/read")
  async markRead(@Req() req: AuthedRequest, @Param("session_id") sessionId: string, @Body() body: unknown) {
    const a = this.auth(req);
    const session = await this.requireStandalone(a.spaceId, sessionId);
    const input = parseOrThrow(z.object({ last_read_seq: z.number().int().min(0) }), body ?? {});
    return { unread_count: await this.sessions.markRead(session.id, input.last_read_seq) };
  }

  /**
   * 会话事件流（SSE）。不带 `last_stream_id` 时只推"从现在开始"的新事件
   * （客户端已用 messages 拉过全量）；带游标则增量重放，游标过期 → 746004。
   */
  @Get("sessions/:session_id/stream")
  @AllowStreamToken()
  @SkipEnvelope()
  async streamSession(
    @Req() req: AuthedRequest,
    @Param("session_id") sessionId: string,
    @Res() reply: FastifyReply,
    @Query("last_stream_id") lastStreamId?: string,
  ): Promise<void> {
    const a = this.auth(req);
    const session = await this.requireStandalone(a.spaceId, sessionId);
    await this.stream.pipeSession(reply, session.id, lastStreamId);
  }
}
