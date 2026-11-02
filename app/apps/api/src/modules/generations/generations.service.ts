import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { taskEvents, tasks, freezeCredits, releaseFrozen } from "@app/db";
import { AppError, ErrorCode, generationRequestSchema, newId, type GenerationRequest } from "@app/shared";
import { db } from "../../db/database";
import { QueueService } from "../../queue/queue.service";
import { RedisService } from "../../redis/redis.service";
import { CreditsService } from "../credits/credits.service";
import { ModerationService } from "../moderation/moderation.service";
import type { AuthContext } from "../../common/auth.types";
import {
  assertToolInput,
  ensureToolCatalog,
  isToolMode,
  normalizeToolOptions,
  ToolInputError,
  toolForMode,
} from "./tool-catalog";
import { selectProviderRoute } from "./provider-route";

const IDEM_TTL_S = 300;

/**
 * 工具箱请求体：公共 `GenerationRequest` + 工具专有参数（见 generations.controller 的 toolOptionsSchema）。
 * 用交叉类型而不是新接口，是为了让 `credits.price()` / `tasks.insert()` 对它的使用保持零改动。
 */
export type GeneratableRequest = GenerationRequest & {
  options: GenerationRequest["options"] & Record<string, unknown>;
};

export interface CreateTaskResult {
  task_id: string;
  status: number;
  credits_estimate: number;
}

@Injectable()
export class GenerationsService {
  private readonly logger = new Logger("generations");

  constructor(
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(QueueService) private readonly queue: QueueService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ModerationService) private readonly moderation: ModerationService,
  ) {}

  async create(auth: AuthContext, body: GeneratableRequest, idempotencyKey: string): Promise<CreateTaskResult> {
    this.moderation.assertPrompt(body.input.prompt);

    /**
     * 工具箱 mode 的两道前置（第 3 批）。
     *
     * 1. **目录惰性 ensure**：工具能力是「一 model 一 mode」的独立目录行，
     *    线上库（已有 46 个模型）不会因为发一次版就重跑 seed，所以这里补一次（幂等）。
     * 2. **输入前置校验 + 档位归一**：缺素材/缺必填参数必须在这里拦住，
     *    而不是等 worker 里的适配器 validate 抛错——那时积分已冻结、任务已落库，
     *    用户要等一次"失败-退冻"才知道少传了东西（体验与对账都更差）。
     */
    let request: GeneratableRequest = body;
    if (isToolMode(body.mode)) {
      const tool = toolForMode(body.mode);
      if (tool) {
        await ensureToolCatalog();
        try {
          assertToolInput(tool, body.input, (body.options ?? {}) as Record<string, unknown>);
        } catch (error) {
          if (error instanceof ToolInputError) {
            throw new AppError(ErrorCode.INVALID_PARAM, error.message, error.details);
          }
          throw error;
        }
        request = normalizeToolOptions(tool, body);
      }
    }

    const idemKey = `idem:gen:${auth.spaceId}:${idempotencyKey}`;
    const acquired = await this.redis.setNx(idemKey, "pending", IDEM_TTL_S);
    if (!acquired) {
      const cached = await this.redis.get(idemKey);
      if (cached && cached !== "pending") return JSON.parse(cached) as CreateTaskResult;
      throw new AppError(ErrorCode.IDEMPOTENT_REPLAY, "request in progress, retry later");
    }

    try {
      const priced = await this.credits.price(request, auth.spaceId);
      if (!priced.sufficient) {
        throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, "Insufficient Balance");
      }
      if (request.quote_id) {
        /**
         * 报价指纹按**公共契约字段**算，不按工具扩展字段算。
         *
         * `POST /credits/quote` 用的是共享 `generationRequestSchema`（它会剥掉 voice/effect/
         * region 这类工具专有键），而 `/generations` 用超集 schema。若把带工具参数的 body
         * 直接丢给 `readQuote()`，同一笔请求的指纹必然对不上 → 每次提交都 745702。
         * 用 base schema 再 parse 一遍还原"报价时看到的那份 body"，指纹即可对齐；
         * 这不会削弱保护：影响价格的全在公共字段里（mode/model/scene/input/options 的
         * ratio/resolution/duration/count），工具专有参数不参与计价。
         */
        const quoteShaped = generationRequestSchema.parse(request);
        const quote = await this.credits.readQuote(request.quote_id, auth.spaceId, quoteShaped);
        if (quote.credits !== priced.credits) {
          throw new AppError(ErrorCode.QUOTE_MISMATCH, "price changed, re-quote", { field: "quote_id" });
        }
      }

      const taskId = newId();
      const providerRoute = await selectProviderRoute(priced.model.id);
      await db.transaction(async (tx) => {
        await tx.insert(tasks).values({
          id: taskId,
          spaceId: BigInt(auth.spaceId),
          userId: BigInt(auth.userId),
          capability: priced.model.capability,
          mode: request.mode,
          scene: request.scene ?? null,
          modelId: priced.model.id,
          routeId: providerRoute?.routeId ?? null,
          routeSnapshot: providerRoute?.snapshot ?? null,
          input: request.input,
          options: request.options,
          status: 1,
          progress: 0,
          creditsFrozen: priced.credits,
          idempotencyKey,
        });
        await freezeCredits(tx, {
          spaceId: BigInt(auth.spaceId),
          cost: priced.credits,
          taskId,
          memo: `freeze for ${request.mode}`,
        });
        await tx.insert(taskEvents).values({
          id: newId(),
          taskId,
          type: "task.created",
          payload: {
            mode: request.mode,
            model: request.model,
            scene: request.scene ?? null,
            ...(providerRoute ? { route_id: providerRoute.snapshot.route_id } : {}),
          },
        });
      });

      const result: CreateTaskResult = {
        task_id: String(taskId),
        status: 1,
        credits_estimate: priced.credits,
      };
      try {
        await this.queue.enqueueTask(String(taskId));
      } catch (queueError) {
        // 入队失败：补偿性回滚（任务 FAILED + 解冻 + 事件），避免冻结悬空
        await db.transaction(async (tx) => {
          const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).for("update");
          if (task && task.status === 1) {
            // 入队失败 = unfreeze（PR-03）：额度按流水 outstanding 算，幂等；
            // 不再用 `creditsFrozen > 0` 当判据（该字段在修复前只增不减、恒真）。
            await releaseFrozen(tx, {
              spaceId: task.spaceId,
              taskId,
              disposition: "unfreeze",
              memo: "enqueue failed refund",
            });
            await tx
              .update(tasks)
              .set({
                status: 4,
                error: { kind: "queue_error", message: "enqueue failed" },
                finishedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(tasks.id, taskId));
            await tx.insert(taskEvents).values({
              id: newId(),
              taskId,
              type: "task.failed",
              payload: { reason: "enqueue_failed" },
            });
          }
        });
        this.logger.error(
          { err: queueError instanceof Error ? queueError.message : String(queueError) },
          "enqueue failed",
        );
        throw queueError;
      }
      await this.redis.set(idemKey, JSON.stringify(result), IDEM_TTL_S);
      return result;
    } catch (error) {
      await this.redis.del(idemKey);
      if (error instanceof Error && error.name === "InsufficientBalanceError") {
        throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, "Insufficient Balance");
      }
      this.logger.warn({ err: error instanceof Error ? error.message : String(error) }, "generation create failed");
      throw error;
    }
  }
}
