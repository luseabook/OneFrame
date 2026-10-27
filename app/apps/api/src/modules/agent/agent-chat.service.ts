import { Inject, Injectable, Logger } from "@nestjs/common";
import { generationRequestSchema } from "@app/shared";
import { AppError, ErrorCode, newId } from "@app/shared";
import { RedisService } from "../../redis/redis.service";
import { GenerationsService } from "../generations/generations.service";
import { ModelsService } from "../models/models.service";
import { CanvasService } from "../canvas/canvas.service";
import { AgentEventsService } from "./agent-events.service";
import { AgentMessagesService } from "./agent-messages.service";
import { AgentReplyService, type AgentHistoryItem } from "./agent-reply.service";
import { AgentSessionsService } from "./agent-sessions.service";
import { AgentTaskService } from "./agent-task.service";
import { AGENT_EVENT, type AgentMessageDto } from "./agent.types";

/** 在途轮次标记的 TTL：LLM 慢请求也不该超过这个量级 */
const TURN_TTL_S = 180;

export interface SendMessageInput {
  content: string;
  contentType?: 1 | 2 | 3 | 4;
  referenceNodeIds?: string[];
  decision?: { interrupt_id: string; decision: "approve" | "reject"; edits?: unknown };
  /** 显式要求"等本轮结束再返回"；默认排队语义（裁决 D5） */
  wait?: boolean;
  /**
   * 额外写进用户消息 `payload` 的字段（不参与 LLM 提示词）。
   * 用在独立创作页：把"这条发言用了哪几张 Skill 卡"留痕，
   * 后续可按消息反查产物来源（与画布 node-binding 同一思路）。
   */
  extraPayload?: Record<string, unknown>;
}

@Injectable()
export class AgentChatService {
  private readonly logger = new Logger("agent.chat");
  /**
   * 会话级串行队列。
   *
   * 为什么需要：一轮对话会追加多条事件（thinking → 可能建任务 → 回复），
   * 两轮并发交错时前端会看到"回复插到提问前面"。这里保证同会话 FIFO。
   * 单进程假设：与画布节点锁（Redis TTL）同级，多实例部署时退化为"可能并发"，
   * 但 seq 分配仍有 advisory lock 兜底，不会写出乱序数据。
   */
  private readonly chains = new Map<string, Promise<void>>();

  constructor(
    @Inject(AgentSessionsService) private readonly sessions: AgentSessionsService,
    @Inject(AgentMessagesService) private readonly messages: AgentMessagesService,
    @Inject(AgentEventsService) private readonly events: AgentEventsService,
    @Inject(AgentReplyService) private readonly reply: AgentReplyService,
    @Inject(GenerationsService) private readonly generations: GenerationsService,
    @Inject(ModelsService) private readonly models: ModelsService,
    @Inject(CanvasService) private readonly canvas: CanvasService,
    @Inject(AgentTaskService) private readonly taskService: AgentTaskService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  /**
   * 发送一条用户消息。
   *
   * 返回值必须"立刻"给出：用户消息先落库 + 落事件，助手那一轮在后台跑，
   * 进度通过 SSE 推。这样即使 LLM 要 10s，输入框也不会转圈等到超时。
   */
  async send(
    auth: { userId: string; spaceId: string },
    sessionId: string,
    input: SendMessageInput,
  ): Promise<{ message_id: string; stream_id: string; queued: boolean }> {
    const session = await this.sessions.requireSession(auth.spaceId, sessionId);
    if (session.status !== 1) {
      throw new AppError(ErrorCode.INVALID_PARAM, "session already ended", { field: "session_id" });
    }
    const content = input.content.trim();
    // HITL 决策不是"发言"：允许 content 为空，只带 decision（PRD：决策卡片上点"同意"不该
    // 凭空造一句用户台词写进会话记录）
    if (!content && !input.decision) {
      throw new AppError(ErrorCode.BAD_REQUEST, "content is required", { field: "content" });
    }

    const inflightKey = `agent:turn:${sessionId}`;
    const busy = (await this.redis.get(inflightKey)) !== null;
    // 默认排队（裁决 D5）：只有客户端显式 ?wait=1 才报"在途"
    if (busy && input.wait) {
      throw new AppError(ErrorCode.AGENT_TURN_IN_FLIGHT, "previous turn still running", { session_id: sessionId });
    }

    // HITL 决策也走消息通道（契约 §4.4.4 B）：它本身不是"发言"，但要留痕
    const isDecision = !!input.decision;
    const userMessage = await this.messages.append({
      spaceId: BigInt(auth.spaceId),
      sessionId: session.id,
      role: 1,
      content: isDecision ? `[${input.decision!.decision}]${content ? ` ${content}` : ""}` : content,
      contentType: 1,
      payload: {
        ...(input.referenceNodeIds?.length ? { reference_node_ids: input.referenceNodeIds } : {}),
        ...(input.decision ? { decision: input.decision } : {}),
        ...(input.extraPayload ?? {}),
      },
      createdBy: BigInt(auth.userId),
    });

    const streamId = this.messages.streamIdFor(BigInt(userMessage.message_id));
    await this.events.append({
      spaceId: BigInt(auth.spaceId),
      sessionId: session.id,
      type: AGENT_EVENT.USER_MESSAGE,
      payload: { message_id: userMessage.message_id, content: userMessage.content },
      streamId,
    });

    // 首条消息充当会话标题：空标题的会话在列表里全是"新会话"，无法区分
    if (!session.title) {
      await this.sessions.update(auth.spaceId, sessionId, { title: content.slice(0, 24) });
    }

    this.enqueue(sessionId, () =>
      this.runTurn(
        { userId: auth.userId, spaceId: auth.spaceId },
        { sessionId: session.id, spaceId: session.spaceId, canvasId: session.canvasId },
        inflightKey,
      ),
    );

    return { message_id: userMessage.message_id, stream_id: streamId, queued: busy };
  }

  /** 结束会话：之后 POST 消息会被 400107 式拒绝（status != 1） */
  async end(spaceId: string, sessionId: string): Promise<{ ok: boolean; session: { status: number } }> {
    const updated = await this.sessions.update(spaceId, sessionId, { status: 2 });
    return { ok: true, session: { status: updated.status } };
  }

  private enqueue(key: string, task: () => Promise<void>): void {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(task).catch((error: unknown) => {
      this.logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "agent turn failed in queue",
      );
    });
    this.chains.set(key, next);
    void next.finally(() => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    });
  }

  /** 跑一轮：thinking → (可选)投递任务 → 助手消息 */
  private async runTurn(
    auth: { userId: string; spaceId: string },
    ctx: { sessionId: bigint; spaceId: bigint; canvasId: bigint | null },
    inflightKey: string,
  ): Promise<void> {
    const acquired = await this.redis.setNx(inflightKey, "1", TURN_TTL_S);
    if (!acquired) {
      // 别的进程正在跑同一会话：本轮直接退出，前端会靠轮询补到对方的结果
      return;
    }
    try {
      await this.events.append({
        spaceId: ctx.spaceId,
        sessionId: ctx.sessionId,
        type: AGENT_EVENT.MODEL_STEP,
        payload: { step: "thinking" },
      });

      const history = await this.messages.list(ctx.sessionId, undefined, 20);
      const items: AgentHistoryItem[] = history.list.map((message) => ({
        role: message.role,
        content: message.content,
      }));

      const result = await this.reply.reply({
        history: items,
        canvas: await this.canvasContext(auth.spaceId, ctx.canvasId),
      });

      let taskId: bigint | null = null;
      if (result.generate) {
        taskId = await this.submitGeneration(auth, ctx.sessionId, result.generate);
        if (taskId !== null) {
          await this.events.append({
            spaceId: ctx.spaceId,
            sessionId: ctx.sessionId,
            type: AGENT_EVENT.TASK_PROGRESS,
            payload: { task_id: String(taskId), status: 1, progress: 0 },
            taskId,
          });
        }
      }

      const assistant = await this.messages.append({
        spaceId: ctx.spaceId,
        sessionId: ctx.sessionId,
        role: 2,
        content: result.reply,
        contentType: result.content_type,
        payload: { ...(result.nodes ? { nodes: result.nodes } : {}), ...(taskId ? { task_id: String(taskId) } : {}) },
        taskId,
      });
      await this.events.append({
        spaceId: ctx.spaceId,
        sessionId: ctx.sessionId,
        type: AGENT_EVENT.AGENT_MESSAGE,
        payload: this.messageFrame(assistant),
        taskId,
        streamId: this.messages.streamIdFor(BigInt(assistant.message_id)),
      });
      await this.sessions.touch(ctx.sessionId);
    } catch (error) {
      // 失败必须让用户看见，而不是留一条"永远在想"的消息
      const code = error instanceof AppError ? error.code : ErrorCode.INTERNAL;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ err: message, code }, "agent turn failed");
      await this.events.append({
        spaceId: ctx.spaceId,
        sessionId: ctx.sessionId,
        type: AGENT_EVENT.ERROR,
        payload: { code, message: message.slice(0, 300) },
      });
    } finally {
      await this.redis.del(inflightKey);
    }
  }

  private messageFrame(message: AgentMessageDto): Record<string, unknown> {
    return {
      message_id: message.message_id,
      content: message.content,
      content_type: message.content_type,
      payload: message.payload,
      task_id: message.task_id,
    };
  }

  /**
   * 真投递一次生成（复用 generations → tasks，禁止另造任务表）。
   *
   * 参数默认值**必须来自模型目录**：图像模型的档位是 1K/2K/4K，视频是 720p/1080p，
   * 写死任一档都会在另一类模型上直接报 "resolution not supported"
   * （canvas 节点任务踩过同一个坑，见 canvas-node-tasks.service.ts 注释）。
   */
  private async submitGeneration(
    auth: { userId: string; spaceId: string },
    sessionId: bigint,
    generate: { capability: "image" | "video"; prompt: string },
  ): Promise<bigint | null> {
    const mode = generate.capability === "video" ? "text2video" : "text2image";
    const candidates = await this.models.list({ capability: generate.capability, visible: true });
    const model = candidates.find((item) => Object.prototype.hasOwnProperty.call(item.modes ?? {}, mode));
    if (!model) {
      await this.events.append({
        spaceId: BigInt(auth.spaceId),
        sessionId,
        type: AGENT_EVENT.ERROR,
        payload: { code: ErrorCode.INVALID_PARAM, message: `模型目录里没有支持 ${mode} 的可用模型` },
      });
      return null;
    }
    // 档位默认值统一由 AgentTaskService.normalize 从模型目录补，
    // 这里只负责"选哪个模型"——两处都写一遍必然漂移
    const parsed = generationRequestSchema.safeParse({
      mode,
      model: model.name,
      input: { prompt: generate.prompt },
      options: {},
      quote_id: null,
    });
    if (!parsed.success) {
      await this.events.append({
        spaceId: BigInt(auth.spaceId),
        sessionId,
        type: AGENT_EVENT.ERROR,
        payload: {
          code: ErrorCode.INVALID_PARAM,
          message: parsed.error.issues[0]?.message ?? "invalid generation params",
        },
      });
      return null;
    }
    let request;
    try {
      request = await this.taskService.normalize(parsed.data);
    } catch (error) {
      await this.events.append({
        spaceId: BigInt(auth.spaceId),
        sessionId,
        type: AGENT_EVENT.ERROR,
        payload: {
          code: error instanceof AppError ? error.code : ErrorCode.INVALID_PARAM,
          message: error instanceof Error ? error.message.slice(0, 200) : "invalid generation params",
        },
      });
      return null;
    }
    const created = await this.generations.create(
      { userId: auth.userId, spaceId: auth.spaceId, jti: String(newId()) },
      request,
      `agent:${sessionId}:${newId()}`,
    );
    return BigInt(created.task_id);
  }

  /** 画布上下文：只给"有几个节点、都是什么类型"，够助手判断该新建还是复用 */
  private async canvasContext(
    spaceId: string,
    canvasId: bigint | null,
  ): Promise<{ nodeCount: number; nodeTypes: string[]; selectionCount: number } | null> {
    if (canvasId === null) return null;
    const nodes = await this.canvas.nodesByType(spaceId, String(canvasId));
    const types = Array.from(new Set(nodes.list.map((node) => String(node.node_type))));
    return { nodeCount: nodes.list.length, nodeTypes: types, selectionCount: 0 };
  }

  /** 消息列表（供 SSE 重连后补齐用；与 REST 同一实现，避免两套分页语义） */
  async history(sessionId: string, spaceId: string, afterCursor: string | undefined, pageSize: number) {
    const session = await this.sessions.requireSession(spaceId, sessionId);
    return this.messages.list(session.id, afterCursor, pageSize);
  }
}
