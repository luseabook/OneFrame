import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { contentReports, taskShares } from "@app/db";
import { AppError, ErrorCode, newId, type ReportCreateRequest } from "@app/shared";
import { db } from "../../db/database";
import { RedisService } from "../../redis/redis.service";

@Injectable()
export class ReportsService {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async create(token: string, input: ReportCreateRequest, ip: string) {
    const [share] = await db.select().from(taskShares).where(eq(taskShares.token, token));
    if (!share || share.revokedAt || share.expiresAt.getTime() <= Date.now()) {
      throw new AppError(ErrorCode.NOT_FOUND, "share not found or expired");
    }
    // 公开入口频控：同 token+IP 每小时 5 次
    const count = await this.redis.incrWithTtl(`report:${token}:${ip}`, 3600);
    if (count > 5) throw new AppError(ErrorCode.RATE_LIMITED, "举报过于频繁，请稍后再试");

    const id = newId();
    await db.insert(contentReports).values({
      id,
      spaceId: share.spaceId,
      taskId: share.taskId,
      shareId: share.id,
      reason: input.reason,
      detail: input.detail ?? null,
      contact: input.contact ?? null,
      status: 1,
    });
    return { report_id: String(id), status: 1 };
  }

  async countPending(): Promise<number> {
    const rows = await db
      .select({ id: contentReports.id })
      .from(contentReports)
      .where(and(eq(contentReports.status, 1), isNull(contentReports.handledAt)));
    return rows.length;
  }
}
