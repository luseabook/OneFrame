import { Inject, Injectable } from "@nestjs/common";
import {
  AppError,
  ErrorCode,
  generationRequestSchema,
  isAppError,
  type GenerationRequest,
} from "@app/shared";
import { CreditsService } from "../credits/credits.service";
import { ModerationService } from "../moderation/moderation.service";
import { GenerationsService } from "../generations/generations.service";
import { ModelsService, type ModeConfig } from "../models/models.service";
import { TasksService, type TaskDto } from "../tasks/tasks.service";
import { AgentEventsService } from "./agent-events.service";
import { AgentSessionsService } from "./agent-sessions.service";
import { AGENT_EVENT } from "./agent.types";

export interface CreateCheckResult {
  ok: boolean;
  credits_estimate: number;
  blockers: Array<{ code: number; field?: string; msg: string }>;
  /** 实际会被采用的档位（可能由模型目录纠正过）—— 让客户端知道"我们真的要跑什么" */
  normalized_options?: Record<string, unknown>;
}

@Injectable()
export class AgentTaskService {
  constructor(
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(ModerationService) private readonly moderation: ModerationService,
    @Inject(GenerationsService) private readonly generations: GenerationsService,
    @Inject(ModelsService) private readonly models: ModelsService,
    @Inject(TasksService) private readonly tasks: TasksService,
    @Inject(AgentEventsService) private readonly events: AgentEventsService,
    @Inject(AgentSessionsService) private readonly sessions: AgentSessionsService,
  ) {}

  /**
   * 把请求里的档位对齐到**模型目录支持的值**。
   *
   * 为什么必须做：`generationRequestSchema` 的默认值是 `resolution: "720p"`，
   * 那是视频档位；图像模型的合法值是 `1K/2K/4K`。Agent 侧拿到的 body 往往不带
   * options（模型是对话里选的），直接投递会得到 "resolution 720p not supported"。
   * 这与 canvas 节点任务是同一个坑，规则也一致：**档位由目录决定，禁止写死**
   * （docs/03-frontend/conventions.md §3）。
   */
  async normalize(request: GenerationRequest): Promise<GenerationRequest> {
    const model = await this.models.findByName(request.model);
    const modeCfg = ((model.modes ?? {}) as Record<string, ModeConfig>)[request.mode] ?? {};
    const options: Record<string, unknown> = { ...(request.options as Record<string, unknown>) };

    const resolutions = Array.isArray(modeCfg.resolutions) ? modeCfg.resolutions : [];
    const currentResolution = typeof options.resolution === "string" ? options.resolution : undefined;
    if (resolutions.length > 0 && (currentResolution === undefined || !resolutions.includes(currentResolution))) {
      options.resolution =
        modeCfg.default_resolution && resolutions.includes(modeCfg.default_resolution)
          ? modeCfg.default_resolution
          : resolutions[0];
    }

    const durations = Array.isArray(modeCfg.durations) ? modeCfg.durations : [];
    if (durations.length > 0 && !durations.includes(Number(options.duration))) {
      options.duration = modeCfg.default_duration ?? durations[0];
    }

    const ratios = Array.isArray(modeCfg.ratios) ? modeCfg.ratios : [];
    if (ratios.length > 0 && !ratios.includes(String(options.ratio))) {
      options.ratio = ratios[0];
    }

    const counts = Array.isArray(modeCfg.counts) ? modeCfg.counts : [];
    if (counts.length > 0 && !counts.includes(Number(options.count))) {
      options.count = modeCfg.default_count ?? counts[0];
    }

    const parsed = generationRequestSchema.safeParse({ ...request, options });
    if (!parsed.success) {
      throw new AppError(ErrorCode.INVALID_PARAM, parsed.error.issues[0]?.message ?? "invalid params", {
        field: parsed.error.issues[0]?.path.join("."),
      });
    }
    return parsed.data;
  }

  /**
   * 只校验不落库、不冻结（契约 §3.6 明确 N 幂等）。
   *
   * 为什么要有它：Agent 在"真正投递前"需要先把"会不会失败"告诉用户
   * （余额不足 / 提示词被拦 / 档位不支持）。若直接调 create，用户会在
   * 卡被扣了之后才看到失败——那是把校验当成副作用。
   */
  async check(auth: { spaceId: string }, request: GenerationRequest): Promise<CreateCheckResult> {
    try {
      const normalized = await this.normalize(request);
      this.moderation.assertPrompt(normalized.input.prompt);
      const priced = await this.credits.price(normalized, auth.spaceId);
      return {
        ok: priced.sufficient,
        credits_estimate: priced.credits,
        blockers: priced.sufficient
          ? []
          : [{ code: ErrorCode.INSUFFICIENT_BALANCE, field: "credits", msg: "积分不足" }],
        normalized_options: normalized.options as Record<string, unknown>,
      };
    } catch (error) {
      if (isAppError(error)) {
        const details = error.details as { field?: string } | undefined;
        return {
          ok: false,
          credits_estimate: 0,
          blockers: [{ code: error.code, field: details?.field, msg: error.message }],
        };
      }
      throw error;
    }
  }

  /** 真投递：一律走 generations（冻结/幂等/dedupe 都在那里），本域不碰 billing */
  async create(
    auth: { userId: string; spaceId: string; jti: string },
    request: GenerationRequest,
    idempotencyKey: string,
    sessionId?: string,
  ): Promise<{ task_id: string; status: number; credits_estimate: number; session_id: string | null }> {
    const normalized = await this.normalize(request);
    const created = await this.generations.create(auth, normalized, idempotencyKey);
    let boundSession: string | null = null;
    if (sessionId) {
      // 会话可能是独立创作（scope=1）：只有存在且属于本 space 才记事件，不因会话问题回滚任务
      try {
        const session = await this.sessions.requireSession(auth.spaceId, sessionId);
        boundSession = String(session.id);
        await this.events.append({
          spaceId: BigInt(auth.spaceId),
          sessionId: session.id,
          type: AGENT_EVENT.TASK_PROGRESS,
          payload: { task_id: created.task_id, status: 1, progress: 0 },
          taskId: BigInt(created.task_id),
        });
      } catch (error) {
        if (!isAppError(error)) throw error;
        boundSession = null;
      }
    }
    return { ...created, session_id: boundSession };
  }

  async detail(spaceId: string, taskId: string) {
    return this.tasks.detail(spaceId, taskId);
  }

  async update(
    spaceId: string,
    taskId: string,
    input: { title?: string | null; feedback?: { reaction?: "like" | "dislike" | "none"; comment?: string } },
  ): Promise<TaskDto> {
    const patch: { title?: string | null; feedback?: unknown } = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.feedback !== undefined) {
      const reaction = input.feedback.reaction;
      if (reaction !== undefined && !["like", "dislike", "none"].includes(reaction)) {
        throw new AppError(ErrorCode.INVALID_PARAM, "invalid reaction", { field: "feedback.reaction" });
      }
      patch.feedback = {
        reaction: reaction ?? "none",
        comment: (input.feedback.comment ?? "").slice(0, 500),
        at: new Date().toISOString(),
      };
    }
    return this.tasks.updateMeta(spaceId, taskId, patch);
  }

  async batchDownload(spaceId: string, taskIds: string[]) {
    if (taskIds.length > 50) {
      throw new AppError(ErrorCode.INVALID_PARAM, "at most 50 tasks per batch", { field: "task_ids" });
    }
    return this.tasks.batchDownload(spaceId, taskIds);
  }
}
