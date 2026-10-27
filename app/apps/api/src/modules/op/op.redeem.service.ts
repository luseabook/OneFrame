import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { creditIn, redeemCodeRedemptions, redeemCodes } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import type { TeamCtx } from "./op.service";
import { OpService } from "./op.service";

/**
 * 兑换码服务（`/web/v1/op/redeem-code/*` + `/web/v1/redeem-code/redeem`）。
 *
 * 竞品刻意拆成两段（`d-commerce-account.md:468-471`）：
 *   `POST /op/redeem-code/info`  查询（**不兑换**，让用户先看到"这是什么码、给多少分"）
 *   `POST /redeem-code/redeem`   核销（独立服务路径，可能对接卡券/渠道系统）
 * 我方保留两段，路径也照抄（ADR-009 保留域划分便于 1:1 核对）。
 *
 * **并发是本模块的核心风险**，处理顺序很关键（先查后写 = 必现重复兑换）：
 *   ① 校验码可用（只读，不依赖它做去重）；
 *   ② `INSERT redeem_code_redemptions ... ON CONFLICT DO NOTHING` —— 唯一键
 *      `uq_redeem_code_redemptions (code_id, user_id)` 决定谁赢，输的人立即返回回放；
 *   ③ 条件 UPDATE `used_count = used_count + 1 WHERE max_uses = 0 OR used_count < max_uses`
 *      —— 原子占配额，抢不到就抛错，整个事务回滚（连 ② 的行一起回滚）；
 *   ④ 最后才 `creditIn`（发分必须在"配额已占到 + 核销行已落"之后）。
 * 这样即使两个请求同时到，也最多一个人拿到分，且 `used_count` 不会超发。
 */
@Injectable()
export class OpRedeemService {
  constructor(@Inject(OpService) private readonly op: OpService) {}

  async requireMember(spaceId: string, userId: string) {
    return this.op.requireMember(spaceId, userId);
  }

  /**
   * 核销兑换码。
   *
   * 重放语义（不是报错）：同一用户再次兑同一个码，返回 `replayed:true` 且 `credits:0`。
   * 理由：用户重复点击/刷新是最常见的真实行为，报错反而让人以为"兑换失败了"，
   * 于是继续点——真正该被拒绝的是**重复发分**，不是重复请求。
   */
  async redeem(ctx: TeamCtx, code: string) {
    return db.transaction(async (tx) => {
      const [row] = await tx.select().from(redeemCodes).where(eq(redeemCodes.code, code)).limit(1);
      if (!row) throw new AppError(ErrorCode.INVALID_PARAM, "兑换码不存在", { field: "code" });
      if (row.status !== 1) throw new AppError(ErrorCode.INVALID_PARAM, "兑换码已停用", { field: "code" });
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
        throw new AppError(ErrorCode.INVALID_PARAM, "兑换码已过期", { field: "code" });
      }
      // 平台码（space_id 为空）人人可兑；团队定向码只在本 space 生效
      if (row.spaceId !== null && String(row.spaceId) !== ctx.spaceId) {
        throw new AppError(ErrorCode.INVALID_PARAM, "兑换码不存在", { field: "code" });
      }

      // ② 唯一键占位：并发下只有一个请求能插入成功
      const claimed = await tx
        .insert(redeemCodeRedemptions)
        .values({
          id: newId(),
          codeId: row.id,
          userId: BigInt(ctx.userId),
          spaceId: BigInt(ctx.spaceId),
          credits: row.credits,
        })
        .onConflictDoNothing({ target: [redeemCodeRedemptions.codeId, redeemCodeRedemptions.userId] })
        .returning({ id: redeemCodeRedemptions.id });
      if (claimed.length === 0) {
        return { redeemed: false, replayed: true, already_redeemed: true, credits: 0, code };
      }

      // ③ 原子占配额（max_uses = 0 表示不限次）
      const quota = await tx
        .update(redeemCodes)
        .set({ usedCount: sql`${redeemCodes.usedCount} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(redeemCodes.id, row.id),
            or(eq(redeemCodes.maxUses, 0), sql`${redeemCodes.usedCount} < ${redeemCodes.maxUses}`),
          ),
        )
        .returning({ usedCount: redeemCodes.usedCount });
      if (quota.length === 0) {
        // 抛错 → 整个事务回滚（含上面占位的核销行），不会出现"占了坑却没发分"
        throw new AppError(ErrorCode.INVALID_PARAM, "兑换码已用尽", { field: "code" });
      }

      // ④ 发分走账本
      const credited = await creditIn(tx, {
        spaceId: BigInt(ctx.spaceId),
        amount: row.credits,
        kind: "gift",
        codeId: row.id,
        memo: `redeem code=${row.code} user=${ctx.userId}`,
      });

      return {
        redeemed: true,
        replayed: false,
        already_redeemed: false,
        code,
        credits: row.credits,
        used_count: quota[0]!.usedCount,
        balance_after: credited.balanceAfter,
      };
    });
  }

  /** 运营创建兑换码（团队定向码；平台码归 admin 域，见 admin 模块） */
  async create(
    ctx: TeamCtx,
    input: { code?: string; credits: number; max_uses?: number; expires_at?: string | null },
  ) {
    this.op.requireOperator(ctx);
    if (input.credits <= 0) throw new AppError(ErrorCode.INVALID_PARAM, "credits must be > 0", { field: "credits" });
    const code = (input.code ?? `OF${newId().toString(36).toUpperCase().slice(-8)}`).toUpperCase();
    const inserted = await db
      .insert(redeemCodes)
      .values({
        id: newId(),
        code,
        spaceId: BigInt(ctx.spaceId),
        credits: input.credits,
        maxUses: input.max_uses ?? 1,
        usedCount: 0,
        expiresAt: input.expires_at ? new Date(input.expires_at) : null,
        status: 1,
        createdBy: BigInt(ctx.userId),
      })
      .onConflictDoNothing({ target: redeemCodes.code })
      .returning();
    const row = inserted[0];
    if (!row) throw new AppError(ErrorCode.INVALID_PARAM, "兑换码已存在", { field: "code" });
    return this.view(row);
  }

  async list(ctx: TeamCtx, page = 1, pageSize = 20) {
    this.op.requireOperator(ctx);
    const rows = await db
      .select()
      .from(redeemCodes)
      .where(eq(redeemCodes.spaceId, BigInt(ctx.spaceId)))
      .orderBy(desc(redeemCodes.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [agg] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(redeemCodes)
      .where(eq(redeemCodes.spaceId, BigInt(ctx.spaceId)));
    return { list: rows.map((r) => this.view(r)), count: Number(agg?.n ?? 0), page, page_size: pageSize };
  }

  async update(
    ctx: TeamCtx,
    id: string,
    input: { status?: number; max_uses?: number; expires_at?: string | null },
  ) {
    this.op.requireOperator(ctx);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.status !== undefined) patch.status = input.status;
    if (input.max_uses !== undefined) patch.maxUses = input.max_uses;
    if (input.expires_at !== undefined) patch.expiresAt = input.expires_at ? new Date(input.expires_at) : null;
    // 只能是本 space 的码：跨 space 一律 404（不泄露存在性）
    const updated = await db
      .update(redeemCodes)
      .set(patch)
      .where(and(eq(redeemCodes.id, BigInt(id)), eq(redeemCodes.spaceId, BigInt(ctx.spaceId))))
      .returning();
    const row = updated[0];
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "redeem code not found");
    return this.view(row);
  }

  /** 软停用：已发出的码不能物理删（核销记录要能追溯） */
  async disable(ctx: TeamCtx, id: string) {
    this.op.requireOperator(ctx);
    const updated = await db
      .update(redeemCodes)
      .set({ status: 2, updatedAt: new Date() })
      .where(and(eq(redeemCodes.id, BigInt(id)), eq(redeemCodes.spaceId, BigInt(ctx.spaceId))))
      .returning({ id: redeemCodes.id });
    if (updated.length === 0) throw new AppError(ErrorCode.NOT_FOUND, "redeem code not found");
    return { id, status: 2 };
  }

  private view(r: typeof redeemCodes.$inferSelect) {
    return {
      id: String(r.id),
      code: r.code,
      space_id: r.spaceId ? String(r.spaceId) : null,
      credits: r.credits,
      max_uses: r.maxUses,
      used_count: r.usedCount,
      remaining_uses: r.maxUses > 0 ? Math.max(0, r.maxUses - r.usedCount) : -1,
      expires_at: r.expiresAt,
      status: r.status,
      created_at: r.createdAt,
    };
  }
}
