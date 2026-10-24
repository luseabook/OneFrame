import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { taskEvents, tasks, freezeCredits, unfreezeCredits } from "@app/db";
import { AppError, ErrorCode, newId, type GenerationRequest } from "@app/shared";
import { db } from "../../db/database";
import { QueueService } from "../../queue/queue.service";
import { RedisService } from "../../redis/redis.service";
import { CreditsService } from "../credits/credits.service";
import type { AuthContext } from "../../common/auth.types";

const IDEM_TTL_S = 300;

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
  ) {}

  async create(auth: AuthContext, body: GenerationRequest, idempotencyKey: string): Promise<CreateTaskResult> {
    const idemKey = `idem:gen:${auth.spaceId}:${idempotencyKey}`;
    const acquired = await this.redis.setNx(idemKey, "pending", IDEM_TTL_S);
    if (!acquired) {
      const cached = await this.redis.get(idemKey);
      if (cached && cached !== "pending") return JSON.parse(cached) as CreateTaskResult;
      throw new AppError(ErrorCode.IDEMPOTENT_REPLAY, "request in progress, retry later");
    }

    try {
      const priced = await this.credits.price(body, auth.spaceId);
      if (!priced.sufficient) {
        throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, "Insufficient Balance");
      }
      if (body.quote_id) {
        const quote = await this.credits.readQuote(body.quote_id, auth.spaceId, body);
        if (quote.credits !== priced.credits) {
          throw new AppError(ErrorCode.QUOTE_MISMATCH, "price changed, re-quote", { field: "quote_id" });
        }
      }

      const taskId = newId();
      await db.transaction(async (tx) => {
        await tx.insert(tasks).values({
          id: taskId,
          spaceId: BigInt(auth.spaceId),
          userId: BigInt(auth.userId),
          capability: priced.model.capability,
          mode: body.mode,
          scene: body.scene ?? null,
          modelId: priced.model.id,
          input: body.input,
          options: body.options,
          status: 1,
          progress: 0,
          creditsFrozen: priced.credits,
          idempotencyKey,
        });
        await freezeCredits(tx, {
          spaceId: BigInt(auth.spaceId),
          cost: priced.credits,
          taskId,
          memo: `freeze for ${body.mode}`,
        });
        await tx.insert(taskEvents).values({
          id: newId(),
          taskId,
          type: "task.created",
          payload: { mode: body.mode, model: body.model, scene: body.scene ?? null },
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
          if (task && task.status === 1 && task.creditsFrozen > 0) {
            await unfreezeCredits(tx, {
              spaceId: task.spaceId,
              cost: task.creditsFrozen,
              taskId,
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
