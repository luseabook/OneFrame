import { Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { taskEvents, tasks } from "@app/db";
import { AppError, ErrorCode } from "@app/shared";
import { db } from "../../db/database";

/**
 * 审核态只读查询（模块 #25 收尾）：`GET /moderation/status?task_id=`。
 *
 * 只读两处既有事实：
 * - `tasks.status`（6 = REVIEWING / 7 = REVIEW_REJECTED，见 `TaskStatus`）；
 * - `task_events` 最近若干条（worker 把审核中/驳回写进事件流）。
 *
 * 不新增表、不推断"应该被驳回"：没有审核事件就是没有，返回空数组而不是编一个。
 */

const STATUS_NAME: Record<number, string> = {
  1: "queued",
  2: "running",
  3: "succeeded",
  4: "failed",
  5: "canceled",
  6: "reviewing",
  7: "review_rejected",
};

export interface ModerationTaskStatus {
  task_id: string;
  status: number;
  status_name: string;
  reviewing: boolean;
  rejected: boolean;
  terminal: boolean;
  mode: string;
  capability: string;
  result_count: number;
  error: unknown;
  finished_at: string | null;
  events: Array<{ type: string; created_at: string; payload: unknown }>;
}

@Injectable()
export class ModerationStatusService {
  async taskStatus(spaceId: string, taskId: string): Promise<ModerationTaskStatus> {
    let id: bigint;
    try {
      id = BigInt(taskId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid task_id", { field: "task_id" });
    }
    const [row] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.spaceId, BigInt(spaceId))));
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "task not found");

    const events = await db
      .select({ type: taskEvents.type, createdAt: taskEvents.createdAt, payload: taskEvents.payload })
      .from(taskEvents)
      .where(eq(taskEvents.taskId, row.id))
      .orderBy(desc(taskEvents.createdAt))
      .limit(20);

    const status = Number(row.status);
    const results = Array.isArray(row.results) ? row.results.length : 0;
    return {
      task_id: String(row.id),
      status,
      status_name: STATUS_NAME[status] ?? `unknown(${status})`,
      reviewing: status === 6,
      rejected: status === 7,
      terminal: [3, 4, 5, 7].includes(status),
      mode: row.mode,
      capability: row.capability,
      result_count: results,
      error: row.error ?? null,
      finished_at: row.finishedAt ? row.finishedAt.toISOString() : null,
      events: events.map((event) => ({
        type: event.type,
        created_at: event.createdAt.toISOString(),
        payload: event.payload ?? null,
      })),
    };
  }
}
