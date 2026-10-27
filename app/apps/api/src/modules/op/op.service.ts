import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, like, sql } from "drizzle-orm";
import {
  abExperiments,
  abHits,
  creditFlows,
  creditIn,
  distributorRelations,
  inviteCodes,
  inviteRedemptions,
  marketWithdrawals,
  opDailyRewards,
  orders,
  promoSlots,
  redeemCodes,
  spaceMembers,
  users,
} from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { RedisService } from "../../redis/redis.service";
import { TeamService } from "../team/team.service";

/**
 * 运营增长（op）主服务 —— 对照参照产品 `/web/v1/op/*` 31 个端点（`rt:829-859`，
 * 证据整理见 `docs/01-product/_parts/d-commerce-account.md:437-511`）。
 *
 * 四条设计约束（每条都对应竞品的一个真实行为）：
 *
 * 1. **发分一律走 `creditIn` 记账**。运营奖励是"gift"类流入，必须落 `credit_flows`
 *    并写清 memo 来源（`d-commerce-account.md:86` 的 `give_val` 口径 = 赠送分）。
 *    直接 `update credit_accounts.balance` 会让对账不变式 `balance == Σdelta` 失效。
 *
 * 2. **幂等靠数据库唯一键，不靠"先查后写"**。每日奖励/兑换码/邀请核销/AB 命中
 *    全部是"一人一次"语义，并发下先查后写必然双发（本仓已有 `idempotency_records`
 *    的三态教训）。这里用 `onConflictDoNothing` + 唯一索引做最终裁决。
 *
 * 3. **单层分销**（`distributor_relations.parent_user_id` 唯一，schema 注释已写明）。
 *    `commission_bps` 默认 0：佣金结算要接订单分账，本批不做（`d-commerce-account.md:451`
 *    的"按成交分佣"需要 `invitee/order-records` 真实订单支撑，见下方该方法注释）。
 *
 * 4. **AB 变体按权重哈希 userId 决定**，落 `ab_hits` 唯一键（一人一变体）。
 *    不用随机数：随机会让同一用户刷新就换变体，实验数据直接报废。
 */

/** 每日奖励积分。运营可调（常量集中在此，未拍板项不散落进 SQL）。 */
export const DAILY_REWARD_CREDITS = 5;
/** 个人邀请码核销赠分。运营可调。 */
export const INVITE_CODE_CREDITS = 100;
/** 分销分佣比例（万分比）。0 = 解绑前不计佣（合规前置未拍板）。 */
export const DISTRIBUTOR_DEFAULT_BPS = 0;

/** 运营后台可写的运营位类型（`promo_slots.slot`） */
export const PROMO_SLOTS = ["banner", "pop_up", "activity", "creator"] as const;

export type TeamCtx = { spaceId: string; userId: string; role: number; roleCode: string | null };

export interface ExperimentVariant {
  name: string;
  weight: number;
}

@Injectable()
export class OpService {
  constructor(
    @Inject(TeamService) private readonly team: TeamService,
    @Inject(RedisService) private readonly redis: RedisService,
  ) {}

  // ── 权限 ─────────────────────────────────────────────────
  async requireMember(spaceId: string, userId: string): Promise<TeamCtx> {
    return this.team.requireMember(spaceId, userId);
  }

  /**
   * 运营后台动作的准入：必须是该 space 成员 **且** 具备管理特权。
   * 竞品把这类动作放在 `rmopsrv`/`rmadminsrv` 独立域（`rt:118`、`d-commerce-account.md:412`），
   * 我方是模块化单体（ADR-002），用"成员 + 特权"做等价边界。
   */
  requireOperator(ctx: TeamCtx) {
    if (!TeamService.hasPrivilege(ctx)) {
      throw new AppError(ErrorCode.FORBIDDEN, "operator privilege required", { reason: "not_operator" });
    }
  }

  // ── 邀请码（rt:840 / 847 / 848）────────────────────────────
  /**
   * 我的专属邀请码（`POST /op/invite-code`）。
   *
   * 归属落在 `invite_codes.owner_user_id`（迁移 0027）。**不要**和 `created_by` 混用：
   * 那是 `admin_users` 的外键（运账号），两者 id 空间不同，混用会把返佣判给运营账号。
   *
   * 幂等语义：同一用户重复调用返回**同一个码**，不会刷出一堆码
   * （否则"我邀请了几个人"无法归因）。竞品 GET/POST 同路径（`rt:840`），
   * GET = 查已有的，POST = 生成/刷新。
   */
  async ensureMyInviteCode(ctx: TeamCtx) {
    const mine = await this.findMyInviteCodeRow(ctx.userId);
    if (mine) return this.inviteCodeView(ctx, mine.code);

    // 唯一键 uq_invite_codes_code 兜底：极小概率撞码时换一个重试
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = `OF${randomBytes(4).toString("hex").toUpperCase()}`;
      const inserted = await db
        .insert(inviteCodes)
        .values({
          id: newId(),
          code,
          credits: INVITE_CODE_CREDITS,
          // maxUses=0 语义：不限次（schema 注释：0 = 不限次数）。个人码要能被多人用。
          maxUses: 0,
          usedCount: 0,
          status: 1,
          ownerUserId: BigInt(ctx.userId),
        })
        .onConflictDoNothing({ target: inviteCodes.code })
        .returning({ code: inviteCodes.code });
      if (inserted[0]) return this.inviteCodeView(ctx, inserted[0].code);

      // 撞码继续；但也可能"别的并发请求刚给这个用户建了码"→ 直接复用，别再多建
      const raced = await this.findMyInviteCodeRow(ctx.userId);
      if (raced) return this.inviteCodeView(ctx, raced.code);
    }
    throw new AppError(ErrorCode.INTERNAL, "invite code generation failed");
  }

  /**
   * 找我的码。`idx_invite_codes_owner` 不是唯一索引（历史码可能同主人），
   * 故按 id 升序取最早那条：并发首建时两个请求会返回**同一个**码，行为确定。
   */
  private async findMyInviteCodeRow(userId: string) {
    const [row] = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.ownerUserId, BigInt(userId)))
      .orderBy(inviteCodes.id)
      .limit(1);
    return row ?? null;
  }

  /** `GET /op/invite-code` —— 我的码 + 已邀请人数（不生成，纯读） */
  async myInviteCode(ctx: TeamCtx) {
    const mine = await this.findMyInviteCodeRow(ctx.userId);
    if (!mine) return { code: null, invitee_count: 0, credits: INVITE_CODE_CREDITS };
    return this.inviteCodeView(ctx, mine.code);
  }

  private async inviteCodeView(ctx: TeamCtx, code: string) {
    const [inviteeCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(distributorRelations)
      .where(and(eq(distributorRelations.parentUserId, BigInt(ctx.userId)), eq(distributorRelations.status, 1)));
    return {
      code,
      credits: INVITE_CODE_CREDITS,
      invitee_count: Number(inviteeCount?.n ?? 0),
      share_link: `/invite?code=${code}`,
    };
  }

  /** `GET /op/invite-code/check?code=` —— 只校验不核销（前端输码时实时提示） */
  async checkInviteCode(ctx: TeamCtx, code: string) {
    const [invite] = await db.select().from(inviteCodes).where(eq(inviteCodes.code, code)).limit(1);
    if (!invite) return { valid: false, reason: "not_found", credits: 0, remaining_uses: 0 };
    const expired = invite.expiresAt ? invite.expiresAt.getTime() <= Date.now() : false;
    const exhausted = invite.maxUses > 0 && invite.usedCount >= invite.maxUses;
    const reason = invite.status !== 1 ? "disabled" : expired ? "expired" : exhausted ? "exhausted" : "";
    // 已核销过：前端要能提示"你已经用过这个码"，而不是让用户点了才报错
    const redeemed = await db
      .select({ id: inviteRedemptions.id })
      .from(inviteRedemptions)
      .where(and(eq(inviteRedemptions.codeId, invite.id), eq(inviteRedemptions.spaceId, BigInt(ctx.spaceId))))
      .limit(1);
    return {
      valid: !reason,
      reason: redeemed.length > 0 ? "already_redeemed" : reason,
      credits: invite.credits,
      remaining_uses: invite.maxUses > 0 ? Math.max(0, invite.maxUses - invite.usedCount) : -1,
      expires_at: invite.expiresAt,
    };
  }

  /**
   * `POST /op/invite-code/verify` —— 核销邀请码（登录后补填）。
   *
   * 并发/重放：唯一键 `uq_invite_redemptions (code_id, space_id)` 决定谁赢；
   * 输的人**不报错**，返回 `replayed:true` 与既有状态 —— 这是竞品
   * "登录时带了邀请码、随后又点了一次"的真实场景，报错会吓到用户。
   */
  async verifyInviteCode(ctx: TeamCtx, code: string) {
    return db.transaction(async (tx) => {
      const [invite] = await tx.select().from(inviteCodes).where(eq(inviteCodes.code, code)).for("update").limit(1);
      if (!invite) throw new AppError(ErrorCode.INVALID_PARAM, "邀请码不存在", { field: "code" });
      if (invite.status !== 1) throw new AppError(ErrorCode.INVALID_PARAM, "邀请码已停用", { field: "code" });
      if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now()) {
        throw new AppError(ErrorCode.INVALID_PARAM, "邀请码已过期", { field: "code" });
      }
      if (invite.maxUses > 0 && invite.usedCount >= invite.maxUses) {
        throw new AppError(ErrorCode.INVALID_PARAM, "邀请码已用尽", { field: "code" });
      }

      const claimed = await tx
        .insert(inviteRedemptions)
        .values({ id: newId(), codeId: invite.id, spaceId: BigInt(ctx.spaceId) })
        .onConflictDoNothing({ target: [inviteRedemptions.codeId, inviteRedemptions.spaceId] })
        .returning({ id: inviteRedemptions.id });
      if (claimed.length === 0) {
        return { verified: true, replayed: true, credits: 0, already_redeemed: true };
      }

      const usedCount = invite.usedCount + 1;
      await tx
        .update(inviteCodes)
        .set({
          usedCount,
          status: invite.maxUses > 0 && usedCount >= invite.maxUses ? 3 : invite.status,
          updatedAt: new Date(),
        })
        .where(eq(inviteCodes.id, invite.id));

      let balanceAfter: number | null = null;
      if (invite.credits > 0) {
        const res = await creditIn(tx, {
          spaceId: BigInt(ctx.spaceId),
          amount: invite.credits,
          kind: "gift",
          codeId: invite.id,
          memo: `invite redeem code=${invite.code} user=${ctx.userId}`,
        });
        balanceAfter = res.balanceAfter;
      }

      // 归因：邀请人 → 被邀请人（单层）。佣金比例 0 表示"关系已建立但不计佣"。
      // 归属直接读 `invite_codes.owner_user_id`（迁移 0027），不再走 KV 映射：
      // 跨 space 的映射必须由表承载，否则"谁邀请的谁"会随 KV 清理而丢。
      const ownerUserId = invite.ownerUserId ? String(invite.ownerUserId) : null;
      if (ownerUserId && ownerUserId !== ctx.userId) {
        await tx
          .insert(distributorRelations)
          .values({
            id: newId(),
            userId: BigInt(ctx.userId),
            parentUserId: BigInt(ownerUserId),
            commissionBps: DISTRIBUTOR_DEFAULT_BPS,
            status: 1,
          })
          .onConflictDoNothing({ target: distributorRelations.userId });
      }

      return {
        verified: true,
        replayed: false,
        credits: invite.credits,
        balance_after: balanceAfter,
        inviter_user_id: ownerUserId,
      };
    });
  }

  /** `POST /op/referral-link` —— 推荐链接（由我的码派生，不另建短链表） */
  async referralLink(ctx: TeamCtx) {
    const mine = await this.ensureMyInviteCode(ctx);
    return {
      code: mine.code,
      link: mine.share_link,
      invitee_count: mine.invitee_count,
      // 竞品推荐链接带渠道参数（`channel` 出现在 campaign 报名，`rt:271`）；我方按码传递，渠道由前端追加
      channel_hint: "?channel=<你的渠道标识>",
    };
  }

  // ── 分销（rt:836-839 / 849）────────────────────────────────
  async distributorOverview(ctx: TeamCtx) {
    const [rel] = await db
      .select()
      .from(distributorRelations)
      .where(eq(distributorRelations.userId, BigInt(ctx.userId)))
      .limit(1);

    const [inviteeAgg] = await db
      .select({ n: sql<number>`count(*) filter (where ${distributorRelations.status} = 1)::int` })
      .from(distributorRelations)
      .where(eq(distributorRelations.parentUserId, BigInt(ctx.userId)));

    const [incomeAgg] = await db
      .select({
        total: sql<number>`coalesce(sum(${creditFlows.delta}), 0)::int`,
        n: sql<number>`count(*)::int`,
      })
      .from(creditFlows)
      .where(
        and(
          eq(creditFlows.spaceId, BigInt(ctx.spaceId)),
          like(creditFlows.memo, `distributor_commission:${ctx.userId}%`),
        ),
      );

    return {
      me: {
        parent_user_id: rel?.parentUserId ? String(rel.parentUserId) : null,
        commission_bps: rel?.commissionBps ?? DISTRIBUTOR_DEFAULT_BPS,
        bound_at: rel?.createdAt ?? null,
      },
      invitee_count: Number(inviteeAgg?.n ?? 0),
      income_credits: Number(incomeAgg?.total ?? 0),
      income_records: Number(incomeAgg?.n ?? 0),
      // 未结算 = 已成交但佣金还没入账。本批订单分账未接（见 incomeDetail 注释），恒为 0
      pending_credits: 0,
    };
  }

  /** `POST /op/distributor/detail` —— 我邀请来的人（`invitee_type` 预留：1 全部 / 2 已付费） */
  async distributorDetail(ctx: TeamCtx, page = 1, pageSize = 20, inviteeType?: number) {
    const base = and(
      eq(distributorRelations.parentUserId, BigInt(ctx.userId)),
      eq(distributorRelations.status, 1),
    );
    const rows = await db
      .select({
        user_id: distributorRelations.userId,
        nickname: users.nickname,
        commission_bps: distributorRelations.commissionBps,
        bound_at: distributorRelations.createdAt,
      })
      .from(distributorRelations)
      .innerJoin(users, eq(users.id, distributorRelations.userId))
      .where(base)
      .orderBy(desc(distributorRelations.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [agg] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(distributorRelations)
      .where(base);

    // invitee_type=2 只保留"有已支付订单"的被邀请人（按成交分佣口径，`d-commerce-account.md:451`）
    let list = rows.map((r) => ({
      user_id: String(r.user_id),
      nickname: r.nickname,
      commission_bps: r.commission_bps,
      bound_at: r.bound_at,
      paid_orders: 0,
    }));
    if (list.length > 0) {
      const paid = await db
        .select({ userId: orders.userId, n: sql<number>`count(*)::int` })
        .from(orders)
        .where(
          and(
            inArray(
              orders.userId,
              list.map((r) => BigInt(r.user_id)),
            ),
            eq(orders.status, 2),
          ),
        )
        .groupBy(orders.userId);
      const paidMap = new Map(paid.map((p) => [String(p.userId), Number(p.n)]));
      list = list
        .map((r) => ({ ...r, paid_orders: paidMap.get(r.user_id) ?? 0 }))
        .filter((r) => (inviteeType === 2 ? r.paid_orders > 0 : true));
    }
    return { list, count: Number(agg?.n ?? 0), page, page_size: pageSize };
  }

  /**
   * `POST /op/distributor/income-detail` —— 分佣收入明细。
   *
   * **口径（诚实声明）**：佣金入账流水以 memo 前缀 `distributor_commission:<userId>`
   * 标记（`creditIn` 没有 `ref_user_id` 入参，只能在 memo 里带归因）。
   * `commission_bps` 默认 0 → 未拍板前不产生佣金，返回空列表是**正确结果**，
   * 不是"没实现"：真正产生佣金要先接订单分账（本批不做，回报已列）。
   */
  async distributorIncomeDetail(ctx: TeamCtx, page = 1, pageSize = 20) {
    const where = and(
      eq(creditFlows.spaceId, BigInt(ctx.spaceId)),
      like(creditFlows.memo, `distributor_commission:${ctx.userId}%`),
    );
    const rows = await db
      .select({
        id: creditFlows.id,
        delta: creditFlows.delta,
        balance_after: creditFlows.balanceAfter,
        memo: creditFlows.memo,
        created_at: creditFlows.createdAt,
      })
      .from(creditFlows)
      .where(where)
      .orderBy(desc(creditFlows.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [agg] = await db
      .select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${creditFlows.delta}),0)::int` })
      .from(creditFlows)
      .where(where);
    return {
      list: rows.map((r) => ({ ...r, id: String(r.id) })),
      count: Number(agg?.n ?? 0),
      total_credits: Number(agg?.total ?? 0),
      page,
      page_size: pageSize,
    };
  }

  /**
   * `POST /op/distributor/withdrawal-list` —— 分销提现列表。
   *
   * 与集市提现共用一张 `market_withdrawals`（都是"收益 → 提现"的同一套人工审核 + 打款流程，
   * 拆两张表会让财务对账要 union）。用 memo 区分来源：分销佣金 `review_note` 前缀
   * `distributor:`。当前佣金为 0，故列表为空是正确结果。
   */
  async distributorWithdrawalList(ctx: TeamCtx, page = 1, pageSize = 20) {
    const rows = await db
      .select()
      .from(marketWithdrawals)
      .where(and(eq(marketWithdrawals.userId, BigInt(ctx.userId)), like(marketWithdrawals.reviewNote, "distributor:%")))
      .orderBy(desc(marketWithdrawals.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return {
      // 不能直接 spread 行对象：bigint 列进 JSON.stringify 会抛
      // "Do not know how to serialize a BigInt"（500），必须逐字段字符串化
      list: rows.map((r) => ({
        id: String(r.id),
        user_id: String(r.userId),
        space_id: String(r.spaceId),
        amount_credits: r.amountCredits,
        status: r.status,
        channel: r.channel,
        review_note: r.reviewNote,
        paid_at: r.paidAt,
        created_at: r.createdAt,
      })),
      count: rows.length,
      page,
      page_size: pageSize,
      note: "分销佣金结算未接入（commission_bps 默认 0），覆盖佣金后才产生提现单",
    };
  }

  /** `POST /op/invitee/order-records` —— 被邀请人的订单（按成交分佣的前提数据） */
  async inviteeOrderRecords(ctx: TeamCtx, page = 1, pageSize = 20) {
    const relations = await db
      .select({ userId: distributorRelations.userId })
      .from(distributorRelations)
      .where(and(eq(distributorRelations.parentUserId, BigInt(ctx.userId)), eq(distributorRelations.status, 1)));
    if (relations.length === 0) return { list: [], count: 0, total_cents: 0, page, page_size: pageSize };

    const ids = relations.map((r) => r.userId);
    const rows = await db
      .select({
        id: orders.id,
        user_id: orders.userId,
        nickname: users.nickname,
        sku: orders.sku,
        amount_cents: orders.amountCents,
        status: orders.status,
        paid_at: orders.paidAt,
        created_at: orders.createdAt,
      })
      .from(orders)
      .innerJoin(users, eq(users.id, orders.userId))
      .where(inArray(orders.userId, ids))
      .orderBy(desc(orders.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [agg] = await db
      .select({
        n: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(case when ${orders.status} = 2 then ${orders.amountCents} else 0 end), 0)::int`,
      })
      .from(orders)
      .where(inArray(orders.userId, ids));

    return {
      list: rows.map((r) => ({ ...r, id: String(r.id), user_id: String(r.user_id) })),
      count: Number(agg?.n ?? 0),
      total_cents: Number(agg?.total ?? 0),
      page,
      page_size: pageSize,
    };
  }

  // ── 每日奖励（rt:835）────────────────────────────────────
  /** 东八区日期串：奖励按"自然日"发，不能用 UTC 日期（否则晚上 8 点后跨日） */
  private shanghaiDay(now = new Date()): string {
    return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  }

  /**
   * `POST /op/daily-reward` —— 每人每天 1 次，发 `DAILY_REWARD_CREDITS` 分。
   *
   * 竞品只在 `is_new_user` 时拉一次（`d-commerce-account.md:456-466`），我方放宽为
   * "每天可领"——这是**本批产品决策**（任务口径写明"每人每天 1 次"），
   * 与竞品的差异已登记回报。
   *
   * 并发：`op_daily_rewards` 的 `uq_op_daily_rewards (user_id, reward_date)` 是唯一裁决者
   * （迁移 0025）。先插入领奖记录，抢到的人才 `creditIn`；输的人直接回放，
   * **绝不能**先查后写——用户连点/客户端重试就是在这里双发的。
   */
  async dailyReward(ctx: TeamCtx) {
    const day = this.shanghaiDay();
    return db.transaction(async (tx) => {
      const claimed = await tx
        .insert(opDailyRewards)
        .values({
          id: newId(),
          userId: BigInt(ctx.userId),
          spaceId: BigInt(ctx.spaceId),
          rewardDate: day,
          credits: DAILY_REWARD_CREDITS,
        })
        .onConflictDoNothing({ target: [opDailyRewards.userId, opDailyRewards.rewardDate] })
        .returning({ id: opDailyRewards.id });
      if (claimed.length === 0) {
        const [existing] = await tx
          .select({ credits: opDailyRewards.credits })
          .from(opDailyRewards)
          .where(and(eq(opDailyRewards.userId, BigInt(ctx.userId)), eq(opDailyRewards.rewardDate, day)))
          .limit(1);
        return {
          rewarded: false,
          already_rewarded: true,
          day,
          credits: 0,
          today_credits: existing?.credits ?? DAILY_REWARD_CREDITS,
        };
      }
      const res = await creditIn(tx, {
        spaceId: BigInt(ctx.spaceId),
        amount: DAILY_REWARD_CREDITS,
        kind: "gift",
        memo: `daily reward day=${day} user=${ctx.userId}`,
      });
      // 回填流水引用：对账时要能从领奖记录直接跳到账本，而不是靠 memo 模糊匹配。
      //
      // 前提与边界（Lead 提示的并发点，这里逐条对上）：
      //   - `creditIn` 不回传流水 id（ledger 在共享包，签名变更需全仓复查，本批不做）；
      //   - 查询条件用 (space_id, kind='gift', memo=**本用户本日唯一串**)：memo 里带
      //     `day` 与 `user`，同一 space 同一用户同一天只可能有一条这样的流水，
      //     所以"最后一条同 memo"不会取到别人的（不同用户/不同日的 memo 不同）；
      //   - 再按 (created_at desc, id desc) 排序：即便将来出现同 memo 的历史脏数据，
      //     取到的也是最新那条；order by id desc 与 created_at 同向（雪花 id 单调）。
      const memo = `daily reward day=${day} user=${ctx.userId}`;
      const [flow] = await tx
        .select({ id: creditFlows.id })
        .from(creditFlows)
        .where(
          and(
            eq(creditFlows.spaceId, BigInt(ctx.spaceId)),
            eq(creditFlows.kind, "gift"),
            eq(creditFlows.memo, memo),
          ),
        )
        .orderBy(desc(creditFlows.createdAt), desc(creditFlows.id))
        .limit(1);
      if (flow) {
        await tx.update(opDailyRewards).set({ flowRef: flow.id }).where(eq(opDailyRewards.id, claimed[0]!.id));
      }
      return {
        rewarded: true,
        already_rewarded: false,
        day,
        credits: DAILY_REWARD_CREDITS,
        balance_after: res.balanceAfter,
      };
    });
  }

  // ── 定向发分（rt:851）────────────────────────────────────
  /**
   * `POST /op/points-giveaway` —— 运营定向给成员发分。
   *
   * 为什么发到 **space 池** 而不是个人户头：ADR-011 定的是 space 级积分账户，
   * 个人只有"配额"（`space_members.credits_quota`），没有独立余额。
   * 所以本条按"给该 space 定向发放 N 分，memo 记到人"落地——这是账本结构的约束，
   * 不是简化（要发到个人必须先做个人子账户，属第 6 批之外）。
   */
  async pointsGiveaway(
    ctx: TeamCtx,
    input: { user_ids: string[]; credits: number; reason?: string },
  ) {
    this.requireOperator(ctx);
    if (input.credits <= 0) throw new AppError(ErrorCode.INVALID_PARAM, "credits must be > 0", { field: "credits" });

    // 只允许发给本 space 成员（跨 space 发分 = 越权给别人团队充值）
    const members = await db
      .select({ userId: spaceMembers.userId })
      .from(spaceMembers)
      .where(
        and(
          eq(spaceMembers.spaceId, BigInt(ctx.spaceId)),
          inArray(
            spaceMembers.userId,
            input.user_ids.map((id) => BigInt(id)),
          ),
          eq(spaceMembers.status, 1),
        ),
      );
    const validIds = new Set(members.map((m) => String(m.userId)));
    const rejected = input.user_ids.filter((id) => !validIds.has(id));
    if (validIds.size === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "no target member in this space", { field: "user_ids" });
    }

    return db.transaction(async (tx) => {
      const res = await creditIn(tx, {
        spaceId: BigInt(ctx.spaceId),
        amount: input.credits,
        kind: "gift",
        memo: `op points giveaway by=${ctx.userId} to=${[...validIds].join(",")} reason=${input.reason ?? "-"}`,
      });
      return {
        granted_credits: input.credits,
        granted_users: [...validIds],
        rejected_users: rejected,
        balance_after: res.balanceAfter,
      };
    });
  }

  // ── AB 实验（rt:829 + 我方 experiments CRUD）────────────────
  /**
   * 变体选择：`sha256(key:userId)` 取前 4 字节当 uint32，按变体权重落桶。
   *
   * 为什么用哈希而不是随机：随机的话同一用户每次刷新都可能换变体，
   * 实验组数据立刻失效；哈希保证"同人同变体"且服务端可复算。
   */
  pickVariant(key: string, userId: string, variants: ExperimentVariant[]): string | null {
    const total = variants.reduce((s, v) => s + Math.max(0, v.weight), 0);
    if (total <= 0) return variants[0]?.name ?? null;
    const digest = createHash("sha256").update(`${key}:${userId}`).digest();
    const bucket = digest.readUInt32BE(0) % total;
    let acc = 0;
    for (const v of variants) {
      acc += Math.max(0, v.weight);
      if (bucket < acc) return v.name;
    }
    return variants[variants.length - 1]?.name ?? null;
  }

  /**
   * `GET /op/abtest/hit` —— 命中运行中的实验。
   *
   * 返回形状对照竞品（`d-commerce-account.md:476`）：`{hit, benefits}`。
   * 竞品返回 5 个 `BENEFIT_*` 布尔（首次免费权益开关），我方把"变体名"映射成
   * `benefits: { <experiment_key>: <variant_name> }`——语义是"这个开关当前给谁开"，
   * 消费方拿同一个字段做限免判定。
   *
   * 一致性：先算变体，再 `onConflictDoNothing` 落 `ab_hits`；若已存在（另一请求先落），
   * **以库里的为准**回读，保证"一人一变体"不会因为并发而出现两个答案。
   */
  async abtestHit(ctx: TeamCtx, experimentKeys?: string[]) {
    const conds = [eq(abExperiments.status, 2)];
    if (experimentKeys && experimentKeys.length > 0) conds.push(inArray(abExperiments.key, experimentKeys));
    const experiments = await db.select().from(abExperiments).where(and(...conds));

    const benefits: Record<string, string> = {};
    for (const exp of experiments) {
      const variants = this.parseVariants(exp.variants);
      const picked = this.pickVariant(exp.key, ctx.userId, variants);
      if (!picked) continue;
      const inserted = await db
        .insert(abHits)
        .values({ id: newId(), experimentId: exp.id, userId: BigInt(ctx.userId), variant: picked })
        .onConflictDoNothing({ target: [abHits.experimentId, abHits.userId] })
        .returning({ variant: abHits.variant });
      if (inserted.length > 0) {
        benefits[exp.key] = inserted[0]!.variant;
        continue;
      }
      const [row] = await db
        .select({ variant: abHits.variant })
        .from(abHits)
        .where(and(eq(abHits.experimentId, exp.id), eq(abHits.userId, BigInt(ctx.userId))))
        .limit(1);
      if (row) benefits[exp.key] = row.variant;
    }
    return { hit: Object.keys(benefits).length > 0, benefits };
  }

  private parseVariants(raw: unknown): ExperimentVariant[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((v) => {
        const item = v as { name?: unknown; weight?: unknown };
        return { name: String(item?.name ?? ""), weight: Number(item?.weight ?? 0) };
      })
      .filter((v) => v.name.length > 0);
  }

  async listExperiments(ctx: TeamCtx) {
    this.requireOperator(ctx);
    const rows = await db.select().from(abExperiments).orderBy(desc(abExperiments.createdAt)).limit(200);
    return {
      list: rows.map((r) => ({
        id: String(r.id),
        key: r.key,
        name: r.name,
        variants: this.parseVariants(r.variants),
        status: r.status,
        start_at: r.startAt,
        end_at: r.endAt,
      })),
    };
  }

  async createExperiment(
    ctx: TeamCtx,
    input: { key: string; name?: string; variants: ExperimentVariant[]; status?: number },
  ) {
    this.requireOperator(ctx);
    const status = input.status ?? 2;
    const inserted = await db
      .insert(abExperiments)
      .values({
        id: newId(),
        key: input.key,
        name: input.name ?? input.key,
        variants: input.variants,
        status,
        startAt: status === 2 ? new Date() : null,
      })
      .onConflictDoNothing({ target: abExperiments.key })
      .returning({ id: abExperiments.id });
    if (inserted.length === 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "experiment key exists", { field: "key" });
    }
    return { id: String(inserted[0]!.id), key: input.key, status };
  }

  async updateExperiment(
    ctx: TeamCtx,
    id: string,
    input: { name?: string; variants?: ExperimentVariant[]; status?: number },
  ) {
    this.requireOperator(ctx);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.variants !== undefined) patch.variants = input.variants;
    if (input.status !== undefined) {
      patch.status = input.status;
      if (input.status === 3) patch.endAt = new Date();
      if (input.status === 2) patch.startAt = new Date();
    }
    const updated = await db
      .update(abExperiments)
      .set(patch)
      .where(eq(abExperiments.id, BigInt(id)))
      .returning({ id: abExperiments.id, status: abExperiments.status });
    if (updated.length === 0) throw new AppError(ErrorCode.NOT_FOUND, "experiment not found");
    return { id, status: updated[0]!.status };
  }

  // ── 运营位（rt:290 banner_list / 295 pop_up + 我方后台 CRUD）──
  /** 前台读：只返回"启用 + 在投放窗口内"，按 sort 升序（权重轮播由前端按序取） */
  async listActivePromoSlots(slot: string) {
    const now = new Date();
    const rows = await db
      .select()
      .from(promoSlots)
      .where(
        and(
          eq(promoSlots.slot, slot),
          eq(promoSlots.status, 1),
          sql`(${promoSlots.startsAt} is null or ${promoSlots.startsAt} <= ${now})`,
          sql`(${promoSlots.endsAt} is null or ${promoSlots.endsAt} >= ${now})`,
        ),
      )
      .orderBy(promoSlots.sort)
      .limit(50);
    return {
      slot,
      list: rows.map((r) => ({
        id: String(r.id),
        title: r.title,
        image_uri: r.imageUri,
        link_uri: r.linkUri,
        sort: r.sort,
      })),
    };
  }

  /** 运营后台全量列表（含停用/未生效；admin 鉴权，调用方已校验） */
  async listPromoSlotsAsAdmin(slot?: string) {
    const rows = await db
      .select()
      .from(promoSlots)
      .where(slot ? eq(promoSlots.slot, slot) : undefined)
      .orderBy(promoSlots.slot, promoSlots.sort)
      .limit(200);
    return { list: rows.map((r) => this.promoSlotView(r)) };
  }

  /** 空间管理员看运营位（客服/调试场景；与 admin 全量列表共用同一 view） */
  async listPromoSlots(ctx: TeamCtx, slot?: string) {
    this.requireOperator(ctx);
    return this.listPromoSlotsAsAdmin(slot);
  }


  private promoSlotView(r: typeof promoSlots.$inferSelect) {
    return {
      id: String(r.id),
      slot: r.slot,
      title: r.title,
      image_uri: r.imageUri,
      link_uri: r.linkUri,
      sort: r.sort,
      status: r.status,
      created_by: r.createdBy ? String(r.createdBy) : null,
      starts_at: r.startsAt,
      ends_at: r.endsAt,
      view_count: r.viewCount,
      click_count: r.clickCount,
    };
  }

  // ── 奖励通知 / 短信码（rt:859 / 850）──────────────────────
  /**
   * `POST /op/rewards-notification` —— 奖励到账通知。
   *
   * 我方没有站内消息表，故以"近 30 天 gift 类流水"作为通知源（同一批数据
   * 前端也用于余额弹窗，`d-commerce-account.md:462` 的 `refreshCreditsInfo`）。
   */
  async rewardsNotification(ctx: TeamCtx) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await db
      .select({
        id: creditFlows.id,
        delta: creditFlows.delta,
        memo: creditFlows.memo,
        created_at: creditFlows.createdAt,
      })
      .from(creditFlows)
      .where(
        and(
          eq(creditFlows.spaceId, BigInt(ctx.spaceId)),
          eq(creditFlows.kind, "gift"),
          gte(creditFlows.createdAt, since),
          // 定向发分是"给空间池"，对个人不构成到账通知，排除掉
          sql`coalesce(${creditFlows.memo}, '') not like 'op points giveaway%'`,
        ),
      )
      .orderBy(desc(creditFlows.createdAt))
      .limit(50);
    return {
      list: rows.map((r) => ({ id: String(r.id), credits: r.delta, memo: r.memo, created_at: r.created_at })),
      count: rows.length,
    };
  }

  /** `POST /op/mobile-captcha` —— 发手机验证码（复用 auth 的限频口径：1 次/分钟、5 次/天） */
  async sendMobileCaptcha(phone: string, ip?: string) {
    const perMinute = await this.redis.incrWithTtl(`op:sms:60:${phone}`, 60);
    if (perMinute > 1) throw new AppError(ErrorCode.RATE_LIMITED, "发送过于频繁，请稍后重试");
    const perDay = await this.redis.incrWithTtl(`op:sms:day:${phone}`, 86_400);
    if (perDay > 5) throw new AppError(ErrorCode.RATE_LIMITED, "今日发送次数已达上限");
    if (ip) {
      const perIp = await this.redis.incrWithTtl(`op:sms:ip:${ip}`, 3600);
      if (perIp > 20) throw new AppError(ErrorCode.RATE_LIMITED, "当前网络发码次数已达上限");
    }
    // 与 auth 的 sms 分开命名空间：运营验证码不能拿去登别人的账号
    const code = String(Math.floor(100_000 + Math.random() * 900_000));
    await this.redis.set(`op:sms:code:${phone}`, JSON.stringify({ code, tries: 0 }), 300);
    const dev = process.env.NODE_ENV !== "production";
    return { sent: true, ...(dev ? { debug_code: code } : {}) };
  }

  /** 校验运营验证码（内测问卷的手机核验用），成功后作废，不可重放 */
  async verifyMobileCaptcha(phone: string, code: string) {
    const raw = await this.redis.get(`op:sms:code:${phone}`);
    if (!raw) throw new AppError(ErrorCode.INVALID_PARAM, "验证码不存在或已过期", { field: "code" });
    const data = JSON.parse(raw) as { code: string; tries: number };
    if (data.tries >= 5) {
      await this.redis.del(`op:sms:code:${phone}`);
      throw new AppError(ErrorCode.INVALID_PARAM, "验证码已作废，请重新获取", { field: "code" });
    }
    if (data.code !== code) {
      data.tries += 1;
      await this.redis.set(`op:sms:code:${phone}`, JSON.stringify(data), 300);
      throw new AppError(ErrorCode.INVALID_PARAM, "验证码错误", { field: "code" });
    }
    await this.redis.del(`op:sms:code:${phone}`);
    return { verified: true };
  }

  /** 兑换码查询（`POST /op/redeem-code/info`，**不兑换**；两段式见 `d-commerce-account.md:468-471`） */
  async redeemCodeInfo(ctx: TeamCtx, code: string) {
    const [row] = await db.select().from(redeemCodes).where(eq(redeemCodes.code, code)).limit(1);
    if (!row) return { found: false, code, valid: false, reason: "not_found" };
    const exhausted = row.maxUses > 0 && row.usedCount >= row.maxUses;
    const expired = row.expiresAt ? row.expiresAt.getTime() <= Date.now() : false;
    const [mine] = await db
      .select({ id: creditFlows.id })
      .from(creditFlows)
      .where(and(eq(creditFlows.spaceId, BigInt(ctx.spaceId)), eq(creditFlows.refCodeId, row.id)))
      .limit(1);
    const reason = row.status !== 1
      ? "disabled"
      : expired
        ? "expired"
        : exhausted
          ? "exhausted"
          : mine
            ? "already_redeemed"
            : "";
    return {
      found: true,
      code,
      credits: row.credits,
      // -1 = 不限次（schema：max_uses 0 = 不限次数）
      remaining_uses: row.maxUses > 0 ? Math.max(0, row.maxUses - row.usedCount) : -1,
      expires_at: row.expiresAt,
      valid: !reason,
      reason,
    };
  }
}
