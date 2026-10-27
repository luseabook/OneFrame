import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { campaignSignupDrafts, campaignSignups, campaigns, creditIn, creatorAssets, users } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { TeamService } from "../team/team.service";
import type { TeamCtx } from "../op/op.service";

/**
 * 激励活动（campaign）—— 对照参照产品 `/web/v1/campaign/*` 6 端点（`rt:267-272`，
 * 证据整理见 `docs/01-product/_parts/d-commerce-account.md:419-433`）。
 *
 * 竞品的 6 条端点与本模块的对应关系：
 *   `campaign/list`                → `GET  /campaigns`
 *   `campaign/detail`              → `GET  /campaigns/:id`
 *   `campaign/awards`              → `GET  /campaigns/:id/awards`
 *   `campaign/shortlist`           → `GET  /campaigns/:id/shortlist`
 *   `campaign/signup/draft` GET    → `GET  /campaigns/:id/signup`
 *   `campaign/signup/draft` POST   → `PUT  /campaigns/:id/signup`
 *   `campaign/signup/submit`       → `POST /campaigns/:id/signup`
 * 另加两条我方必需：
 *   `DELETE /campaigns/:id/signup`           取消报名（任务要求"取消"；竞品未见，登记待取证）
 *   `POST /campaigns/:id/signups/:sid/status` 运营置入围/获奖（否则 shortlist/awards 永远为空）
 *
 * 双主键注意：竞品用 `campaign_id` + `campaign_key`（可读 slug）双主键支持"多渠道入口"
 * （`d-commerce-account.md:431`）。我方 `campaigns` 表**没有 key 列**，故只支持 id，
 * 这一点已登记为待迁移项（加列属 Lead 的 schema 域）。
 *
 * 报名奖励发分必须走 `creditIn`（账本），不允许直接 update 余额：
 * `campaigns.reward_credits` 为 0 时不发，且发分与报名落库在**同一事务**里，
 * 避免"报名成功但没发分"或"发分了但没报名"。
 */

export const CAMPAIGN_STATUS = { DRAFT: 1, RUNNING: 2, ENDED: 3, OFFLINE: 4 } as const;
export const SIGNUP_STATUS = { SIGNED: 1, SHORTLISTED: 2, AWARDED: 3, CANCELLED: 4 } as const;

const SIGNUP_LABEL: Record<number, string> = { 1: "已报名", 2: "已入围", 3: "已获奖", 4: "已取消" };

@Injectable()
export class CampaignService {
  constructor(@Inject(TeamService) private readonly team: TeamService) {}

  async requireMember(spaceId: string, userId: string): Promise<TeamCtx> {
    return this.team.requireMember(spaceId, userId);
  }

  requireOperator(ctx: TeamCtx) {
    if (!TeamService.hasPrivilege(ctx)) {
      throw new AppError(ErrorCode.FORBIDDEN, "operator privilege required", { reason: "not_operator" });
    }
  }

  // ── 读 ───────────────────────────────────────────────────
  /**
   * 活动列表。默认只给"进行中 + 已结束"（草稿/已下线是运营态，前台不该看到）。
   * 竞品 `campaign/list` 无参数证据（未抓包），故 status 过滤做成可选而不是硬编码。
   */
  async list(
    ctx: TeamCtx,
    opts: { status?: number; page?: number; pageSize?: number; onlyMine?: boolean } = {},
  ) {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 20;
    const statuses = opts.status ? [opts.status] : [CAMPAIGN_STATUS.RUNNING, CAMPAIGN_STATUS.ENDED];
    const rows = await db
      .select()
      .from(campaigns)
      .where(inArray(campaigns.status, statuses))
      .orderBy(desc(campaigns.startAt), desc(campaigns.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [agg] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(campaigns)
      .where(inArray(campaigns.status, statuses));

    const mine = await this.mySignupMap(ctx, rows.map((r) => r.id));
    const list = rows.map((r) => ({ ...this.view(r), my_signup: mine.get(String(r.id)) ?? null }));
    return { list, count: Number(agg?.n ?? 0), page, page_size: pageSize };
  }

  /** 我报名过的活动（`crc/activity/list` 用；`onlyMine` 版本） */
  async listMine(ctx: TeamCtx, page = 1, pageSize = 20) {
    const rows = await db
      .select({ campaign: campaigns, signup: campaignSignups })
      .from(campaignSignups)
      .innerJoin(campaigns, eq(campaigns.id, campaignSignups.campaignId))
      .where(eq(campaignSignups.userId, BigInt(ctx.userId)))
      .orderBy(desc(campaignSignups.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return {
      list: rows.map((r) => ({ ...this.view(r.campaign), my_signup: this.signupView(r.signup) })),
      count: rows.length,
      page,
      page_size: pageSize,
    };
  }

  async detail(ctx: TeamCtx, idOrKey: string) {
    const row = await this.loadCampaign(idOrKey);
    const [signup] = await db
      .select()
      .from(campaignSignups)
      .where(and(eq(campaignSignups.campaignId, row.id), eq(campaignSignups.userId, BigInt(ctx.userId))))
      .limit(1);
    const [counts] = await db
      .select({
        total: sql<number>`count(*) filter (where ${campaignSignups.status} <> 4)::int`,
        shortlisted: sql<number>`count(*) filter (where ${campaignSignups.status} in (2,3))::int`,
      })
      .from(campaignSignups)
      .where(eq(campaignSignups.campaignId, row.id));

    return {
      ...this.view(row),
      my_signup: signup ? this.signupView(signup) : null,
      signup_count: Number(counts?.total ?? 0),
      shortlist_count: Number(counts?.shortlisted ?? 0),
      // 是否还能报名：进行中且在窗口内（前端据此决定按钮态，避免点了才报错）
      open_for_signup: this.isOpen(row),
    };
  }

  /** 入围名单（`campaign/shortlist`）：status ∈ {已入围, 已获奖}，按入围时间倒序 */
  async shortlist(ctx: TeamCtx, idOrKey: string, page = 1, pageSize = 20) {
    const campaignId = (await this.loadCampaign(idOrKey)).id;
    const rows = await db
      .select({
        signup_id: campaignSignups.id,
        user_id: campaignSignups.userId,
        nickname: users.nickname,
        status: campaignSignups.status,
        work_id: campaignSignups.workId,
        nominated_at: campaignSignups.nominatedAt,
      })
      .from(campaignSignups)
      .innerJoin(users, eq(users.id, campaignSignups.userId))
      .where(
        and(eq(campaignSignups.campaignId, campaignId), inArray(campaignSignups.status, [2, 3])),
      )
      .orderBy(desc(campaignSignups.nominatedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [agg] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(campaignSignups)
      .where(and(eq(campaignSignups.campaignId, campaignId), inArray(campaignSignups.status, [2, 3])));
    return {
      list: rows.map((r) => ({
        signup_id: String(r.signup_id),
        user_id: String(r.user_id),
        nickname: r.nickname,
        status: r.status,
        status_label: SIGNUP_LABEL[r.status] ?? null,
        work_id: r.work_id ? String(r.work_id) : null,
        nominated_at: r.nominated_at,
      })),
      count: Number(agg?.n ?? 0),
      page,
      page_size: pageSize,
    };
  }

  /**
   * 奖项 / 获奖名单（`campaign/awards`）。
   *
   * 偏离说明：竞品这个端点的响应结构未取证（`d-commerce-account.md:424` 只有路径），
   * 且我方 `campaigns` 表没有"奖项设置"子表。故以**获奖名单（status=已获奖）承载**，
   * 并把 `campaigns.reward_credits` 作为奖项额度披露。等取证到奖项层级/名额结构再补表。
   */
  async awards(ctx: TeamCtx, idOrKey: string) {
    const campaign = await this.loadCampaign(idOrKey);
    const campaignId = campaign.id;
    const rows = await db
      .select({
        signup_id: campaignSignups.id,
        user_id: campaignSignups.userId,
        nickname: users.nickname,
        work_id: campaignSignups.workId,
        nominated_at: campaignSignups.nominatedAt,
      })
      .from(campaignSignups)
      .innerJoin(users, eq(users.id, campaignSignups.userId))
      .where(and(eq(campaignSignups.campaignId, campaignId), eq(campaignSignups.status, SIGNUP_STATUS.AWARDED)))
      .orderBy(desc(campaignSignups.nominatedAt))
      .limit(200);
    return {
      campaign_id: String(campaignId),
      campaign_key: campaign.campaignKey,
      reward_credits: campaign.rewardCredits,
      awards_structure_known: false,
      note: "竞品奖项结构未取证；我方以获奖名单承载（status=3）",
      list: rows.map((r) => ({
        signup_id: String(r.signup_id),
        user_id: String(r.user_id),
        nickname: r.nickname,
        work_id: r.work_id ? String(r.work_id) : null,
        awarded_at: r.nominated_at,
      })),
      count: rows.length,
    };
  }

  // ── 报名草稿（可续填，`d-commerce-account.md:426 / 432`）──────────
  /**
   * 草稿落 `campaign_signup_drafts`（迁移 0027），唯一键 `(campaign_id, user_id)`。
   * 覆盖写而不是追加：追加会让"我上次填到哪"取决于读取顺序。
   */
  async getDraft(ctx: TeamCtx, idOrKey: string) {
    const campaign = await this.loadCampaign(idOrKey);
    const [draft] = await db
      .select()
      .from(campaignSignupDrafts)
      .where(
        and(
          eq(campaignSignupDrafts.campaignId, campaign.id),
          eq(campaignSignupDrafts.userId, BigInt(ctx.userId)),
        ),
      )
      .limit(1);
    return {
      campaign_id: String(campaign.id),
      campaign_key: campaign.campaignKey,
      draft: draft ? this.draftView(draft) : null,
      has_draft: draft !== undefined,
    };
  }

  /** 保存草稿（可反复覆盖；提交报名后仍保留，便于"我上次填到哪"） */
  async saveDraft(
    ctx: TeamCtx,
    idOrKey: string,
    input: { work_id?: string | null; channel?: string | null; answers?: Record<string, unknown> },
  ) {
    // 活动必须存在，否则草稿会指向一个死 id
    const campaign = await this.loadCampaign(idOrKey);
    if (input.work_id) await this.assertMyWork(ctx, input.work_id);
    const workId = input.work_id ? BigInt(input.work_id) : null;
    const [row] = await db
      .insert(campaignSignupDrafts)
      .values({
        id: newId(),
        campaignId: campaign.id,
        userId: BigInt(ctx.userId),
        spaceId: BigInt(ctx.spaceId),
        workId,
        channel: input.channel ?? null,
        answers: input.answers ?? {},
      })
      .onConflictDoUpdate({
        target: [campaignSignupDrafts.campaignId, campaignSignupDrafts.userId],
        set: {
          workId,
          channel: input.channel ?? null,
          answers: input.answers ?? {},
          updatedAt: new Date(),
        },
      })
      .returning();
    return { saved: true, draft: this.draftView(row!) };
  }

  // ── 报名 / 取消 ──────────────────────────────────────────
  /**
   * 提交报名。
   *
   * 幂等：`uq_campaign_signups (campaign_id, user_id)` 是唯一裁决者。
   * 语义分三种，别混：
   *   - 首次报名 → 落库 + 发报名奖励；
   *   - 重复提交（已是 1/2/3）→ `replayed:true`，**不重复发分**；
   *   - 取消后重报（status=4）→ 恢复为 1，**也不重复发分**（奖励一人一次）。
   */
  async signup(
    ctx: TeamCtx,
    idOrKey: string,
    input: { work_id?: string | null; channel?: string | null },
  ) {
    // 竞品的 `campaign_id` 与 `campaign_key` 双主键（`d-commerce-account.md:431`）：
    // 先解析成内部 id，后续一律按 id 操作（可读 slug 只在入口层出现）
    const campaignId = (await this.loadCampaign(idOrKey)).id;
    if (input.work_id) await this.assertMyWork(ctx, input.work_id);

    return db.transaction(async (tx) => {
      const [campaign] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).for("update").limit(1);
      if (!campaign) throw new AppError(ErrorCode.NOT_FOUND, "campaign not found");
      if (!this.isOpen(campaign)) {
        throw new AppError(ErrorCode.INVALID_PARAM, "campaign not open for signup", { field: "campaign_id" });
      }

      const existing = await tx
        .select()
        .from(campaignSignups)
        .where(and(eq(campaignSignups.campaignId, campaignId), eq(campaignSignups.userId, BigInt(ctx.userId))))
        .limit(1);

      if (existing[0]) {
        const row = existing[0];
        if (row.status !== SIGNUP_STATUS.CANCELLED) {
          // 已在报名态：判断是"重复提交"还是"补作品"。补作品要更新 work_id（有用）
          if (input.work_id && String(row.workId ?? "") !== input.work_id) {
            const updated = await tx
              .update(campaignSignups)
              .set({ workId: BigInt(input.work_id), updatedAt: new Date() })
              .where(eq(campaignSignups.id, row.id))
              .returning();
            return { signed_up: true, replayed: true, rewarded_credits: 0, signup: this.signupView(updated[0]!) };
          }
          return { signed_up: true, replayed: true, rewarded_credits: 0, signup: this.signupView(row) };
        }
        // 取消后重报：恢复状态但不重复发奖
        const revived = await tx
          .update(campaignSignups)
          .set({ status: SIGNUP_STATUS.SIGNED, workId: input.work_id ? BigInt(input.work_id) : row.workId, updatedAt: new Date() })
          .where(eq(campaignSignups.id, row.id))
          .returning();
        return { signed_up: true, replayed: false, revived: true, rewarded_credits: 0, signup: this.signupView(revived[0]!) };
      }

      const inserted = await tx
        .insert(campaignSignups)
        .values({
          id: newId(),
          campaignId,
          userId: BigInt(ctx.userId),
          spaceId: BigInt(ctx.spaceId),
          workId: input.work_id ? BigInt(input.work_id) : null,
          status: SIGNUP_STATUS.SIGNED,
        })
        .onConflictDoNothing({ target: [campaignSignups.campaignId, campaignSignups.userId] })
        .returning();
      if (inserted.length === 0) {
        // 并发下被另一请求抢先：以库里那行为准，不发分
        const [row] = await tx
          .select()
          .from(campaignSignups)
          .where(and(eq(campaignSignups.campaignId, campaignId), eq(campaignSignups.userId, BigInt(ctx.userId))))
          .limit(1);
        return { signed_up: true, replayed: true, rewarded_credits: 0, signup: row ? this.signupView(row) : null };
      }

      let rewarded = 0;
      let balanceAfter: number | null = null;
      if (campaign.rewardCredits > 0) {
        const res = await creditIn(tx, {
          spaceId: BigInt(ctx.spaceId),
          amount: campaign.rewardCredits,
          kind: "gift",
          memo: `campaign signup campaign=${String(campaignId)} user=${ctx.userId} channel=${input.channel ?? "-"}`,
        });
        rewarded = campaign.rewardCredits;
        balanceAfter = res.balanceAfter;
      }

      return {
        signed_up: true,
        replayed: false,
        rewarded_credits: rewarded,
        balance_after: balanceAfter,
        signup: this.signupView(inserted[0]!),
      };
    });
  }

  /** 取消报名（status → 4）。已入围/已获奖不允许自行取消（运营态），返回 400101 */
  async cancelSignup(ctx: TeamCtx, idOrKey: string) {
    const campaignId = (await this.loadCampaign(idOrKey)).id;
    const updated = await db
      .update(campaignSignups)
      .set({ status: SIGNUP_STATUS.CANCELLED, updatedAt: new Date() })
      .where(
        and(
          eq(campaignSignups.campaignId, campaignId),
          eq(campaignSignups.userId, BigInt(ctx.userId)),
          eq(campaignSignups.status, SIGNUP_STATUS.SIGNED),
        ),
      )
      .returning();
    if (updated[0]) return { cancelled: true, signup: this.signupView(updated[0]) };
    // 没更新到：要么没报名（404），要么已入围/获奖/已取消（400101，语义不同要给前端可读理由）
    const [row] = await db
      .select()
      .from(campaignSignups)
      .where(and(eq(campaignSignups.campaignId, campaignId), eq(campaignSignups.userId, BigInt(ctx.userId))))
      .limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "signup not found");
    if (row.status === SIGNUP_STATUS.CANCELLED) {
      return { cancelled: true, replayed: true, signup: this.signupView(row) };
    }
    throw new AppError(ErrorCode.INVALID_PARAM, "已入围/已获奖的报名不能自行取消", { field: "campaign_id" });
  }

  /** 运营置入围(2)/获奖(3)（竞品无对应端点，见模块头注释） */
  async setSignupStatus(ctx: TeamCtx, idOrKey: string, signupId: string, status: 2 | 3) {
    this.requireOperator(ctx);
    const campaignId = (await this.loadCampaign(idOrKey)).id;
    const updated = await db
      .update(campaignSignups)
      .set({ status, nominatedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(campaignSignups.id, BigInt(signupId)), eq(campaignSignups.campaignId, campaignId)))
      .returning();
    const row = updated[0];
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "signup not found");
    return { signup: this.signupView(row) };
  }

  /** 活动下的报名作品（`crc/activity/resource/list`）——只列已通过审核的作品 */
  async resourceList(ctx: TeamCtx, idOrKey: string, page = 1, pageSize = 20) {
    const campaignId = (await this.loadCampaign(idOrKey)).id;
    const rows = await db
      .select({
        asset: creatorAssets,
        user_id: campaignSignups.userId,
      })
      .from(campaignSignups)
      .innerJoin(creatorAssets, eq(creatorAssets.id, campaignSignups.workId))
      .where(
        and(
          eq(campaignSignups.campaignId, campaignId),
          eq(campaignSignups.status, SIGNUP_STATUS.SIGNED),
          eq(creatorAssets.status, 3),
        ),
      )
      .orderBy(desc(creatorAssets.publishedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return {
      list: rows.map((r) => ({
        id: String(r.asset.id),
        title: r.asset.title,
        summary: r.asset.summary,
        cover_uri: r.asset.coverUri,
        kind: r.asset.kind,
        creator_user_id: String(r.user_id),
        like_count: r.asset.likeCount,
        published_at: r.asset.publishedAt,
      })),
      count: rows.length,
      page,
      page_size: pageSize,
    };
  }

  // ── 内部 ─────────────────────────────────────────────────
  /**
   * 按 `campaign_id` 或 `campaign_key` 取活动（竞品双主键，`d-commerce-account.md:431`）。
   *
   * 判定顺序：纯数字 → 当 id；否则当可读 slug。这比"先 id 后 key 各查一次"少一次往返，
   * 也避免 id 与 key 撞值时的歧义（id 是雪花数字，key 由运营起名，约定不以数字开头）。
   */
  private async loadCampaign(idOrKey: string) {
    const byId = /^\d+$/.test(idOrKey);
    const [row] = byId
      ? await db.select().from(campaigns).where(eq(campaigns.id, BigInt(idOrKey))).limit(1)
      : await db.select().from(campaigns).where(eq(campaigns.campaignKey, idOrKey)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "campaign not found");
    return row;
  }

  /** 报名窗口判定：进行中 + 在 [startAt, endAt] 内（endAt 为空 = 不限） */
  private isOpen(row: typeof campaigns.$inferSelect): boolean {
    if (row.status !== CAMPAIGN_STATUS.RUNNING) return false;
    const now = Date.now();
    if (row.startAt && row.startAt.getTime() > now) return false;
    if (row.endAt && row.endAt.getTime() < now) return false;
    return true;
  }

  /** 只能给自己名下的作品报名（拿别人的作品报名 = 冒名） */
  private async assertMyWork(ctx: TeamCtx, workId: string) {
    const [asset] = await db
      .select({ id: creatorAssets.id, owner: creatorAssets.creatorUserId })
      .from(creatorAssets)
      .where(eq(creatorAssets.id, BigInt(workId)))
      .limit(1);
    if (!asset) throw new AppError(ErrorCode.NOT_FOUND, "work not found", { field: "work_id" });
    if (String(asset.owner) !== ctx.userId) {
      throw new AppError(ErrorCode.FORBIDDEN, "work does not belong to you", { field: "work_id" });
    }
  }

  private async mySignupMap(ctx: TeamCtx, campaignIds: bigint[]) {
    const map = new Map<string, ReturnType<CampaignService["signupView"]>>();
    if (campaignIds.length === 0) return map;
    const rows = await db
      .select()
      .from(campaignSignups)
      .where(
        and(
          inArray(campaignSignups.campaignId, campaignIds),
          eq(campaignSignups.userId, BigInt(ctx.userId)),
        ),
      );
    for (const r of rows) map.set(String(r.campaignId), this.signupView(r));
    return map;
  }

  private view(r: typeof campaigns.$inferSelect) {
    return {
      id: String(r.id),
      campaign_key: r.campaignKey,
      title: r.title,
      kind: r.kind,
      brief: r.brief,
      cover_uri: r.coverUri,
      reward_credits: r.rewardCredits,
      start_at: r.startAt,
      end_at: r.endAt,
      status: r.status,
      space_id: r.spaceId ? String(r.spaceId) : null,
    };
  }

  private signupView(r: typeof campaignSignups.$inferSelect) {
    return {
      id: String(r.id),
      campaign_id: String(r.campaignId),
      status: r.status,
      status_label: SIGNUP_LABEL[r.status] ?? null,
      work_id: r.workId ? String(r.workId) : null,
      nominated_at: r.nominatedAt,
      created_at: r.createdAt,
    };
  }

  private draftView(r: typeof campaignSignupDrafts.$inferSelect) {
    return {
      campaign_id: String(r.campaignId),
      user_id: String(r.userId),
      work_id: r.workId ? String(r.workId) : null,
      channel: r.channel,
      answers: (r.answers ?? {}) as Record<string, unknown>,
      saved_at: r.updatedAt,
    };
  }
}
