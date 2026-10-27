import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { assetReports, creatorAssets, creatorFollows, creatorLikes, creatorProfiles, creditFlows, users } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import { TeamService } from "../team/team.service";
import { CampaignService } from "../campaign/campaign.service";
import { OpService, type TeamCtx } from "../op/op.service";

/**
 * 创作者中心（crc）—— 对照参照产品 `/web/v1/crc/*` 30 端点（`rt:275-304`，
 * 证据整理见 `docs/01-product/_parts/d-commerce-account.md:373-389`）。
 *
 * 三条硬约束（每条都来自竞品的真实行为或本仓既定 ADR）：
 *
 * 1. **审核是独立状态机**：`1 草稿 → 2 待审 → 3 通过 / 4 驳回 → 5 下架`。
 *    只有 `3` 会被公开列表（`home/list`、`resource/list`）看到——这是"投稿"与
 *    "私有项目"的本质区别（schema.ts:2296 注释）。驳回后必须回到草稿再提交，
 *    不允许 4 → 3 跳跃（否则驳回形同虚设）。
 *
 * 2. **点赞/关注必须幂等**：靠 `uq_creator_likes` / `uq_creator_follows` 唯一键，
 *    重复调用返回**同一态**而不是报错或重复计数。计数用 SQL 自增/自减，
 *    不做"读出再写回"（并发下会丢计数）。
 *
 * 3. **奖励发分走 `creditIn`**：`crc/user/incentive` 是**读视图**，不是发放入口；
 *    真正发分的入口是活动报名（campaign）与运营奖励（op），它们都走账本。
 */

export const ASSET_STATUS = { DRAFT: 1, PENDING: 2, APPROVED: 3, REJECTED: 4, OFFLINE: 5 } as const;
export const ASSET_KIND = { VIDEO: 1, IMAGE: 2, SCRIPT: 3 } as const;

const STATUS_LABEL: Record<number, string> = { 1: "草稿", 2: "待审", 3: "已通过", 4: "已驳回", 5: "已下架" };
const KIND_LABEL: Record<number, string> = { 1: "视频", 2: "图片", 3: "剧本" };

/**
 * 举报原因走服务端配置（竞品证据：`crc/assets/report/config` 是独立端点，
 * `d-commerce-account.md:389` "举报原因走服务端配置，非前端硬编码"）。
 */
export const REPORT_REASONS = [
  { value: "porn", label: "色情低俗" },
  { value: "violence", label: "暴力血腥" },
  { value: "illegal", label: "违法违规" },
  { value: "infringement", label: "侵权抄袭" },
  { value: "spam", label: "垃圾广告" },
  { value: "other", label: "其它" },
];

/**
 * 分类树 / 效果树（常量）。
 *
 * 竞品这两个是**服务端配置驱动**的（`crc/category/tree`、`crc/effect/tree`），
 * 但树的具体内容我方没有抓到（`d-commerce-account.md` 只给了端点）。按 ADR-013
 * 决策 2：结构照做（返回 `{value,label,children}` 三层树），内容自拟并登记待取证。
 */
export const CATEGORY_TREE = [
  {
    value: "video",
    label: "视频",
    children: [
      { value: "short_drama", label: "短剧", children: [] },
      { value: "ad", label: "广告片", children: [] },
      { value: "mv", label: "MV", children: [] },
      { value: "other_video", label: "其它视频", children: [] },
    ],
  },
  {
    value: "image",
    label: "图片",
    children: [
      { value: "character", label: "角色设定", children: [] },
      { value: "scene", label: "场景概念", children: [] },
      { value: "storyboard", label: "分镜图", children: [] },
    ],
  },
  {
    value: "script",
    label: "剧本",
    children: [
      { value: "novel", label: "小说", children: [] },
      { value: "screenplay", label: "剧本", children: [] },
    ],
  },
];

export const EFFECT_TREE = [
  {
    value: "style",
    label: "风格",
    children: [
      { value: "anime", label: "动漫", children: [] },
      { value: "realistic", label: "写实", children: [] },
      { value: "ink", label: "水墨", children: [] },
    ],
  },
  {
    value: "camera",
    label: "运镜",
    children: [
      { value: "push", label: "推镜", children: [] },
      { value: "pan", label: "摇镜", children: [] },
      { value: "handheld", label: "手持", children: [] },
    ],
  },
];

/**
 * 效果标签的合法取值（= `EFFECT_TREE` 的叶子，扁平化）。
 * 白名单理由：`effect` 写库后会被列表筛选直接比较；允许任意字符串时一次手误就会
 * 让某批作品在筛选项里"永远查不到"，且无任何报错（脏数据静默失配）。未知值 400101。
 */
export const EFFECT_VALUES: string[] = EFFECT_TREE.flatMap((group) =>
  ((group as { children?: Array<{ value: string }> }).children ?? []).map((child) => String(child.value)),
);

@Injectable()
export class CreatorService {
  constructor(
    @Inject(TeamService) private readonly team: TeamService,
    @Inject(OpService) private readonly op: OpService,
    @Inject(CampaignService) private readonly campaigns: CampaignService,
  ) {}

  async requireMember(spaceId: string, userId: string): Promise<TeamCtx> {
    return this.team.requireMember(spaceId, userId);
  }

  /** 审核动作的准入：必须是**作品所属 space** 的管理员（本方法给审核类动作统一入口） */
  assertCanReview(ctx: TeamCtx, assetSpaceId: bigint) {
    if (!this.isOperatorOf(ctx, assetSpaceId)) {
      throw new AppError(ErrorCode.FORBIDDEN, "operator privilege required", { reason: "not_operator" });
    }
  }

  // ── 资料（rt:303 GET / 304 POST）──────────────────────────
  /**
   * 取（没有就建）创作者资料。
   *
   * 为什么自动建档而不是报 404：竞品 `crc/user/info` 是创作者中心的**首屏数据源**，
   * 新用户第一次进来就必须有资料可展示（默认昵称取账号昵称）。报 404 会让前端
   * 多一次"是否已开通创作者"的分支判断，而竞品没有这个分支。
   */
  async ensureProfile(userId: string, spaceId: string) {
    const uid = BigInt(userId);
    await db
      .insert(creatorProfiles)
      .values({
        id: newId(),
        userId: uid,
        spaceId: BigInt(spaceId),
        nickname: "",
        bio: "",
        status: 1,
      })
      .onConflictDoNothing({ target: creatorProfiles.userId });
    const [row] = await db.select().from(creatorProfiles).where(eq(creatorProfiles.userId, uid)).limit(1);
    if (!row) throw new AppError(ErrorCode.INTERNAL, "creator profile missing");
    if (!row.nickname) {
      // 默认昵称取账号昵称（竞品默认昵称由 uid 派生，`d-commerce-account.md:54`；我方取账号名更友好）
      const [user] = await db.select({ nickname: users.nickname }).from(users).where(eq(users.id, uid)).limit(1);
      const nickname = user?.nickname ?? `创作者${userId.slice(-6)}`;
      await db.update(creatorProfiles).set({ nickname, updatedAt: new Date() }).where(eq(creatorProfiles.id, row.id));
      row.nickname = nickname;
    }
    return row;
  }

  async profileInfo(ctx: TeamCtx) {
    const profile = await this.ensureProfile(ctx.userId, ctx.spaceId);
    const [works] = await db
      .select({
        total: sql<number>`count(*) filter (where ${creatorAssets.deletedAt} is null)::int`,
        approved: sql<number>`count(*) filter (where ${creatorAssets.status} = 3 and ${creatorAssets.deletedAt} is null)::int`,
        pending: sql<number>`count(*) filter (where ${creatorAssets.status} = 2 and ${creatorAssets.deletedAt} is null)::int`,
        rejected: sql<number>`count(*) filter (where ${creatorAssets.status} = 4 and ${creatorAssets.deletedAt} is null)::int`,
        views: sql<number>`coalesce(sum(${creatorAssets.viewCount}), 0)::int`,
        likes: sql<number>`coalesce(sum(${creatorAssets.likeCount}), 0)::int`,
      })
      .from(creatorAssets)
      .where(eq(creatorAssets.creatorUserId, BigInt(ctx.userId)));

    const [following] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(creatorFollows)
      .where(eq(creatorFollows.followerUserId, BigInt(ctx.userId)));
    const [fans] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(creatorFollows)
      .where(eq(creatorFollows.creatorUserId, BigInt(ctx.userId)));

    return {
      user_id: String(profile.userId),
      nickname: profile.nickname,
      bio: profile.bio,
      avatar_uri: profile.avatarUri,
      status: profile.status,
      follower_count: Number(fans?.n ?? 0),
      following_count: Number(following?.n ?? 0),
      like_count: Number(works?.likes ?? 0),
      works: {
        total: Number(works?.total ?? 0),
        approved: Number(works?.approved ?? 0),
        pending: Number(works?.pending ?? 0),
        rejected: Number(works?.rejected ?? 0),
      },
      view_count: Number(works?.views ?? 0),
      // 前端据此决定要不要渲染"通过/驳回"按钮（没有权限时按钮不该出现，
      // 而不是出现了点了才 403——"点了没反应"是明确的体验缺陷）
      can_review: TeamService.hasPrivilege(ctx),
      created_at: profile.createdAt,
    };
  }

  async updateProfile(ctx: TeamCtx, input: { nickname?: string; bio?: string; avatar_uri?: string | null }) {
    const profile = await this.ensureProfile(ctx.userId, ctx.spaceId);
    if (profile.status !== 1) {
      throw new AppError(ErrorCode.FORBIDDEN, "creator frozen", { reason: "creator_frozen" });
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.nickname !== undefined) patch.nickname = input.nickname;
    if (input.bio !== undefined) patch.bio = input.bio;
    if (input.avatar_uri !== undefined) patch.avatarUri = input.avatar_uri;
    await db.update(creatorProfiles).set(patch).where(eq(creatorProfiles.id, profile.id));
    return this.profileInfo(ctx);
  }

  /**
   * 激励（`crc/user/incentive`）。
   *
   * 口径：**只读视图**。数据源是 `credit_flows` 里 `kind='gift'` 的流入
   * （运营奖励/活动奖励/兑换码/每日奖励都走这里），按 memo 归类。
   * 这是 `d-commerce-account.md:86` 的 `give_val`（赠送分）口径。
   */
  async incentive(ctx: TeamCtx, page = 1, pageSize = 20) {
    const spaceId = BigInt(ctx.spaceId);
    const kindOf = sql<string>`case
      when ${creditFlows.memo} like 'daily reward%' then 'daily_reward'
      when ${creditFlows.memo} like 'campaign signup%' then 'campaign'
      when ${creditFlows.memo} like 'redeem code%' then 'redeem_code'
      when ${creditFlows.memo} like 'invite redeem%' then 'invite'
      when ${creditFlows.memo} like 'op points giveaway%' then 'giveaway'
      else 'other' end`;

    const rows = await db
      .select({
        id: creditFlows.id,
        delta: creditFlows.delta,
        memo: creditFlows.memo,
        created_at: creditFlows.createdAt,
        category: kindOf,
      })
      .from(creditFlows)
      .where(and(eq(creditFlows.spaceId, spaceId), eq(creditFlows.kind, "gift")))
      .orderBy(desc(creditFlows.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const byCategory = await db
      .select({ category: kindOf, total: sql<number>`coalesce(sum(${creditFlows.delta}), 0)::int` })
      .from(creditFlows)
      .where(and(eq(creditFlows.spaceId, spaceId), eq(creditFlows.kind, "gift")))
      .groupBy(kindOf);

    const [totals] = await db
      .select({
        total: sql<number>`coalesce(sum(${creditFlows.delta}), 0)::int`,
        n: sql<number>`count(*)::int`,
      })
      .from(creditFlows)
      .where(and(eq(creditFlows.spaceId, spaceId), eq(creditFlows.kind, "gift")));

    return {
      total_credits: Number(totals?.total ?? 0),
      record_count: Number(totals?.n ?? 0),
      by_category: Object.fromEntries(byCategory.map((r) => [r.category, Number(r.total)])),
      list: rows.map((r) => ({
        id: String(r.id),
        credits: r.delta,
        category: r.category,
        memo: r.memo,
        created_at: r.created_at,
      })),
      page,
      page_size: pageSize,
    };
  }

  // ── 作品：创建 / 编辑 / 删除（我方补充，见模块头）──────────────
  async createAsset(
    ctx: TeamCtx,
    input: {
      title: string;
      summary?: string;
      kind?: number;
      category?: string;
      cover_uri?: string | null;
      uri?: string | null;
    },
  ) {
    await this.ensureProfile(ctx.userId, ctx.spaceId);
    const inserted = await db
      .insert(creatorAssets)
      .values({
        id: newId(),
        spaceId: BigInt(ctx.spaceId),
        creatorUserId: BigInt(ctx.userId),
        kind: input.kind ?? ASSET_KIND.VIDEO,
        title: input.title,
        summary: input.summary ?? "",
        // 分类默认 general（迁移 0025 的列默认值）；运营/作者可用 category 树的值覆盖
        category: input.category ?? "general",
        coverUri: input.cover_uri ?? null,
        uri: input.uri ?? null,
        status: ASSET_STATUS.DRAFT,
      })
      .returning();
    return this.assetView(inserted[0]!);
  }

  /**
   * 编辑作品（只有草稿/已驳回可改）。
   * 已驳回的作品被编辑后回到草稿（1）：驳回意见针对的是旧稿，
   * 改完必须重新提交才会回到待审队列——否则审核员会看到"没重新提交却状态变了"。
   */
  async updateAsset(
    ctx: TeamCtx,
    input: {
      asset_id: string;
      title?: string;
      summary?: string;
      kind?: number;
      category?: string;
      effect?: string | null;
      cover_uri?: string | null;
      uri?: string | null;
    },
  ) {
    const row = await this.ownAsset(ctx, input.asset_id);
    if (row.status !== ASSET_STATUS.DRAFT && row.status !== ASSET_STATUS.REJECTED) {
      throw new AppError(ErrorCode.INVALID_PARAM, "只有草稿/已驳回的作品可编辑", { field: "asset_id" });
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) patch.title = input.title;
    if (input.summary !== undefined) patch.summary = input.summary;
    if (input.kind !== undefined) patch.kind = input.kind;
    if (input.category !== undefined) patch.category = input.category;
    // effect 允许显式传 null 清空（与 category 不同：效果是可选标签）
    if (input.effect !== undefined) patch.effect = input.effect;
    if (input.cover_uri !== undefined) patch.coverUri = input.cover_uri;
    if (input.uri !== undefined) patch.uri = input.uri;
    if (row.status === ASSET_STATUS.REJECTED) {
      patch.status = ASSET_STATUS.DRAFT;
      patch.reviewNote = null;
    }
    const updated = await db
      .update(creatorAssets)
      .set(patch)
      .where(eq(creatorAssets.id, row.id))
      .returning();
    return this.assetView(updated[0]!);
  }

  /** 软删（`crc/assets/delete`）：待审中不可删（否则审核队列里的作品会凭空消失） */
  async deleteAsset(ctx: TeamCtx, assetId: string) {
    const row = await this.ownAsset(ctx, assetId);
    if (row.status === ASSET_STATUS.PENDING) {
      throw new AppError(ErrorCode.INVALID_PARAM, "审核中的作品不能删除，请先撤回", { field: "asset_id" });
    }
    if (row.status === ASSET_STATUS.APPROVED) {
      throw new AppError(ErrorCode.INVALID_PARAM, "已通过的作品请先下架再删除", { field: "asset_id" });
    }
    await db
      .update(creatorAssets)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(creatorAssets.id, row.id));
    return { deleted: true, asset_id: assetId };
  }

  /** 审核失败善后（`crc/assets/audit-fail/del`）：只允许删"已驳回" */
  async deleteAuditFail(ctx: TeamCtx, assetId: string) {
    const row = await this.ownAsset(ctx, assetId);
    if (row.status !== ASSET_STATUS.REJECTED) {
      throw new AppError(ErrorCode.INVALID_PARAM, "只能删除已驳回的作品", { field: "asset_id" });
    }
    await db
      .update(creatorAssets)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(creatorAssets.id, row.id));
    return { deleted: true, asset_id: assetId };
  }

  // ── 审核状态机（rt:296 `resource/action/status`）────────────────
  /**
   * 状态流转。`action` 语义（我方定义，竞品只有路径没有枚举，已登记待取证）：
   *   submit    1|4 → 2（投稿）
   *   resubmit  5   → 2（下架后重新送审）
   *   offline   3   → 5（作者自行下架）
   *   approve   2   → 3（审核通过，写 published_at）
   *   reject    2   → 4（驳回，写 review_note）
   * 前三个作者可做，后两个需要运营特权（团队管理员兼任，见回报的偏离说明）。
   */
  async changeAssetStatus(
    ctx: TeamCtx,
    input: { asset_id: string; action: "submit" | "resubmit" | "offline" | "approve" | "reject"; review_note?: string },
  ) {
    const row = await this.ownAsset(ctx, input.asset_id, { allowOtherWhenOperator: true });
    const isOperator = this.isOperatorOf(ctx, row.spaceId);
    const isOwner = String(row.creatorUserId) === ctx.userId;

    const transition: Record<string, { from: number[]; to: number; needOperator?: boolean }> = {
      submit: { from: [ASSET_STATUS.DRAFT, ASSET_STATUS.REJECTED], to: ASSET_STATUS.PENDING },
      resubmit: { from: [ASSET_STATUS.OFFLINE], to: ASSET_STATUS.PENDING },
      offline: { from: [ASSET_STATUS.APPROVED], to: ASSET_STATUS.OFFLINE },
      approve: { from: [ASSET_STATUS.PENDING], to: ASSET_STATUS.APPROVED, needOperator: true },
      reject: { from: [ASSET_STATUS.PENDING], to: ASSET_STATUS.REJECTED, needOperator: true },
    };
    const rule = transition[input.action];
    if (!rule) throw new AppError(ErrorCode.INVALID_PARAM, "unknown action", { field: "action" });
    if (rule.needOperator) {
      // 审核必须在**作品所属 space** 内具备特权；不能拿别的空间的 master 身份来审
      if (!isOperator) {
        throw new AppError(ErrorCode.FORBIDDEN, "operator privilege required", { reason: "not_operator" });
      }
    } else if (!isOwner) {
      // 别人的作品不能替你提交/下架（运营也一样：运营用 approve/reject 表达意见）
      throw new AppError(ErrorCode.FORBIDDEN, "not your asset", { reason: "not_owner" });
    }
    if (!rule.from.includes(row.status)) {
      throw new AppError(ErrorCode.INVALID_PARAM, `state ${row.status} cannot ${input.action}`, {
        field: "action",
        from: row.status,
        allowed: rule.from,
      });
    }
    // 送审前必须有可审内容：空标题/无素材的稿子进队列只是浪费审核人力
    if (rule.to === ASSET_STATUS.PENDING && (!row.title || (!row.uri && !row.coverUri))) {
      throw new AppError(ErrorCode.INVALID_PARAM, "作品缺少标题或素材，不能送审", { field: "asset_id" });
    }

    const patch: Record<string, unknown> = { status: rule.to, updatedAt: new Date() };
    if (rule.needOperator) {
      // 审核留痕（迁移 0025 的 reviewed_by / reviewed_at）：没有这两列时"谁放行的"
      // 只能靠猜，出问题无法追责，也无法做审核人维度的统计
      patch.reviewedBy = BigInt(ctx.userId);
      patch.reviewedAt = new Date();
    }
    if (rule.to === ASSET_STATUS.APPROVED) {
      patch.publishedAt = new Date();
      patch.reviewNote = null;
    }
    if (rule.to === ASSET_STATUS.REJECTED) {
      patch.reviewNote = input.review_note ?? "内容不符合投稿规范";
    }
    const updated = await db.update(creatorAssets).set(patch).where(eq(creatorAssets.id, row.id)).returning();
    return { ...this.assetView(updated[0]!), action: input.action };
  }

  // ── 作品读：我的 / 审核中 / 公开 ───────────────────────────
  async myAssets(
    ctx: TeamCtx,
    opts: { status?: number; kind?: number; page?: number; pageSize?: number } = {},
  ) {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 20;
    const conds = [eq(creatorAssets.creatorUserId, BigInt(ctx.userId)), sql`${creatorAssets.deletedAt} is null`];
    if (opts.status) conds.push(eq(creatorAssets.status, opts.status));
    if (opts.kind) conds.push(eq(creatorAssets.kind, opts.kind));
    const rows = await db
      .select()
      .from(creatorAssets)
      .where(and(...conds))
      .orderBy(desc(creatorAssets.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [agg] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(creatorAssets)
      .where(and(...conds));
    return { list: rows.map((r) => this.assetView(r)), count: Number(agg?.n ?? 0), page, page_size: pageSize };
  }

  /** 审核中列表（`crc/assets/auditing/list`）：**我提交的**待审作品 */
  async auditingList(ctx: TeamCtx, page = 1, pageSize = 20) {
    return this.myAssets(ctx, { status: ASSET_STATUS.PENDING, page, pageSize });
  }

  /** 审核中详情（`crc/assets/auditing/info`）：只给作者看自己的待审稿 */
  async auditingInfo(ctx: TeamCtx, assetId: string) {
    const row = await this.ownAsset(ctx, assetId);
    return {
      ...this.assetView(row),
      review: {
        status: row.status,
        status_label: STATUS_LABEL[row.status] ?? null,
        note: row.reviewNote,
        // SLA 不做计时器（任务口径）：只披露提交时间，让前端算"已等待多久"
        submitted_at: row.updatedAt,
      },
    };
  }

  /** 公开信息流（`crc/home/list`）：**只有 status=3 可见** */
  async publicFeed(
    opts: {
      kind?: number;
      category?: string;
      effect?: string;
      q?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 20;
    const conds = [eq(creatorAssets.status, ASSET_STATUS.APPROVED), sql`${creatorAssets.deletedAt} is null`];
    if (opts.kind) conds.push(eq(creatorAssets.kind, opts.kind));
    // 分类过滤走 idx_creator_assets_category(status, category, published_at desc)（迁移 0025）
    if (opts.category) conds.push(eq(creatorAssets.category, opts.category));
    // 效果过滤走 idx_creator_assets_effect(status, effect, published_at desc)（迁移 0033）
    if (opts.effect) conds.push(eq(creatorAssets.effect, opts.effect));
    if (opts.q) conds.push(ilike(creatorAssets.title, `%${opts.q}%`));
    const rows = await db
      .select()
      .from(creatorAssets)
      .where(and(...conds))
      .orderBy(desc(creatorAssets.publishedAt), desc(creatorAssets.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [agg] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(creatorAssets)
      .where(and(...conds));
    return {
      list: await this.withCreatorNames(rows),
      count: Number(agg?.n ?? 0),
      page,
      page_size: pageSize,
    };
  }

  /** 作品详情（`crc/resource/info`）：公开态任何人可看；非公开只有作者/运营可看 */
  async assetInfo(ctx: TeamCtx, assetId: string) {
    const [row] = await db.select().from(creatorAssets).where(eq(creatorAssets.id, BigInt(assetId))).limit(1);
    if (!row || row.deletedAt) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    const isOwner = String(row.creatorUserId) === ctx.userId;
    // 运营特权只在**作品所在的 space** 生效：否则任何人在自己的个人空间里都是 master，
    // 就能看别人空间的草稿（越权）。这一条是本域最容易写错的地方。
    const isSpaceOperator = this.isOperatorOf(ctx, row.spaceId);
    if (row.status !== ASSET_STATUS.APPROVED && !isOwner && !isSpaceOperator) {
      // 不泄露"存在但不可见"：与不存在同样处理
      throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    }
    const [liked] = await db
      .select({ id: creatorLikes.id })
      .from(creatorLikes)
      .where(and(eq(creatorLikes.assetId, row.id), eq(creatorLikes.userId, BigInt(ctx.userId))))
      .limit(1);
    // 浏览数：公开详情每看一次 +1（作者自己看不计，否则刷自己的数没意义）。
    // 用 `update ... returning` 拿自增后的值：先 update 再返回旧行会让响应里的
    // view_count 永远比真实值小 1（前端"刚看完却还是旧数"的经典 bug）。
    let viewCount = row.viewCount;
    if (!isOwner) {
      const [bumped] = await db
        .update(creatorAssets)
        .set({ viewCount: sql`${creatorAssets.viewCount} + 1` })
        .where(eq(creatorAssets.id, row.id))
        .returning({ viewCount: creatorAssets.viewCount });
      viewCount = bumped?.viewCount ?? row.viewCount;
    }
    return {
      ...this.assetView(row),
      view_count: viewCount,
      liked: liked !== undefined,
      is_owner: isOwner,
    };
  }

  /** 预览元数据（`crc/file_preview`）：只回元信息，不代理文件流 */
  async filePreview(ctx: TeamCtx, assetId: string) {
    const info = await this.assetInfo(ctx, assetId);
    return {
      id: info.id,
      title: info.title,
      kind: info.kind,
      kind_label: info.kind_label,
      cover_uri: info.cover_uri,
      uri: info.uri,
      status: info.status,
      preview_url: `/creator-center/preview/${info.id}`,
    };
  }

  /** 下载（`crc/assets/download`）：只有已通过的作品可下载（竞品 id+slug 双参数，我方用 id） */
  async downloadInfo(ctx: TeamCtx, assetId: string) {
    const [row] = await db.select().from(creatorAssets).where(eq(creatorAssets.id, BigInt(assetId))).limit(1);
    if (!row || row.deletedAt) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    const isOwner = String(row.creatorUserId) === ctx.userId;
    if (row.status !== ASSET_STATUS.APPROVED && !isOwner) {
      throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    }
    if (!row.uri) throw new AppError(ErrorCode.ASSET_NOT_READY, "作品还没有可下载的素材");
    return {
      asset_id: String(row.id),
      title: row.title,
      kind: row.kind,
      uri: row.uri,
      // 文件名给前端 <a download> 用；扩展名按 kind 推断（不猜 uri 后缀，避免 404）
      filename: `${row.title || "work"}.${row.kind === ASSET_KIND.IMAGE ? "png" : row.kind === ASSET_KIND.SCRIPT ? "txt" : "mp4"}`,
    };
  }

  /** 分享（`crc/assets/share`）：生成站内分享路径并回传计数（不新建短链表） */
  async share(ctx: TeamCtx, assetId: string) {
    const row = await this.ownAsset(ctx, assetId);
    if (row.status !== ASSET_STATUS.APPROVED) {
      throw new AppError(ErrorCode.INVALID_PARAM, "只有已通过的作品可分享", { field: "asset_id" });
    }
    return {
      asset_id: assetId,
      share_path: `/creator-center/preview/${assetId}`,
      // 绝对地址由前端按当前 origin 拼（服务端不知道对外域名，不写死）
      title: row.title,
      cover_uri: row.coverUri,
    };
  }

  // ── 点赞（rt:284 / 285）──────────────────────────────────
  /**
   * 点赞/取消（幂等）。
   *
   * 两种动作都返回**当前真实态**（`liked` + `like_count`），前端无条件用响应刷新，
   * 不做本地乐观计数——否则并发点赞会把计数算错。
   */
  async likeAction(ctx: TeamCtx, input: { asset_id: string; action: "like" | "unlike" }) {
    const assetId = BigInt(input.asset_id);
    const [asset] = await db.select().from(creatorAssets).where(eq(creatorAssets.id, assetId)).limit(1);
    if (!asset || asset.deletedAt) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    if (asset.status !== ASSET_STATUS.APPROVED) {
      throw new AppError(ErrorCode.INVALID_PARAM, "只能点赞已通过的作品", { field: "asset_id" });
    }
    const uid = BigInt(ctx.userId);

    if (input.action === "like") {
      const inserted = await db
        .insert(creatorLikes)
        .values({ id: newId(), assetId, userId: uid })
        .onConflictDoNothing({ target: [creatorLikes.assetId, creatorLikes.userId] })
        .returning({ id: creatorLikes.id });
      if (inserted.length > 0) {
        await db
          .update(creatorAssets)
          .set({ likeCount: sql`${creatorAssets.likeCount} + 1` })
          .where(eq(creatorAssets.id, assetId));
        await db
          .update(creatorProfiles)
          .set({ likeCount: sql`${creatorProfiles.likeCount} + 1` })
          .where(eq(creatorProfiles.userId, asset.creatorUserId));
      }
    } else {
      const removed = await db
        .delete(creatorLikes)
        .where(and(eq(creatorLikes.assetId, assetId), eq(creatorLikes.userId, uid)))
        .returning({ id: creatorLikes.id });
      if (removed.length > 0) {
        // greatest(..., 0) 兜底：历史上若有手工数据导致计数偏低，绝不能减成负数
        await db
          .update(creatorAssets)
          .set({ likeCount: sql`greatest(${creatorAssets.likeCount} - 1, 0)` })
          .where(eq(creatorAssets.id, assetId));
        await db
          .update(creatorProfiles)
          .set({ likeCount: sql`greatest(${creatorProfiles.likeCount} - 1, 0)` })
          .where(eq(creatorProfiles.userId, asset.creatorUserId));
      }
    }

    const [fresh] = await db
      .select({ likeCount: creatorAssets.likeCount })
      .from(creatorAssets)
      .where(eq(creatorAssets.id, assetId))
      .limit(1);
    const [mine] = await db
      .select({ id: creatorLikes.id })
      .from(creatorLikes)
      .where(and(eq(creatorLikes.assetId, assetId), eq(creatorLikes.userId, uid)))
      .limit(1);
    return {
      asset_id: input.asset_id,
      liked: mine !== undefined,
      like_count: fresh?.likeCount ?? 0,
      // 幂等标记：本次动作是否真的改变了状态（前端可用于"重复点击不弹 toast"）
      changed: input.action === "like" ? mine !== undefined : mine === undefined,
    };
  }

  /** 点赞列表（`crc/assets/likes`）：给 asset_id 看"谁赞了"，不给则看"我赞过哪些" */
  async likes(ctx: TeamCtx, opts: { assetId?: string; page?: number; pageSize?: number } = {}) {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 20;
    if (opts.assetId) {
      const rows = await db
        .select({ user_id: creatorLikes.userId, nickname: users.nickname, created_at: creatorLikes.createdAt })
        .from(creatorLikes)
        .innerJoin(users, eq(users.id, creatorLikes.userId))
        .where(eq(creatorLikes.assetId, BigInt(opts.assetId)))
        .orderBy(desc(creatorLikes.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return {
        scope: "asset",
        list: rows.map((r) => ({ user_id: String(r.user_id), nickname: r.nickname, created_at: r.created_at })),
        count: rows.length,
      };
    }
    const rows = await db
      .select({ asset: creatorAssets, liked_at: creatorLikes.createdAt })
      .from(creatorLikes)
      .innerJoin(creatorAssets, eq(creatorAssets.id, creatorLikes.assetId))
      .where(eq(creatorLikes.userId, BigInt(ctx.userId)))
      .orderBy(desc(creatorLikes.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return {
      scope: "mine",
      list: rows.map((r) => ({ ...this.assetView(r.asset), liked_at: r.liked_at })),
      count: rows.length,
    };
  }

  // ── 举报（rt:287 / 288）──────────────────────────────────
  reportConfig() {
    return { reasons: REPORT_REASONS };
  }

  /**
   * 举报作品。一人一作品只记一条（重复举报覆盖补充说明，不刷爆运营队列）。
   * 落 `asset_reports`（迁移 0027，唯一键 `(asset_id, reporter_user_id)`）。
   *
   * 为什么不复用 `content_reports`：那张表的 `task_id` 是业务必需（分享/任务举报），
   * 创作者作品不是任务；硬塞会让"举报处理"列表混入两类对象、且 FK 无法表达。
   */
  async report(
    ctx: TeamCtx,
    input: { asset_id: string; reason: string; detail?: string; contact?: string },
  ) {
    if (!REPORT_REASONS.some((r) => r.value === input.reason)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "举报原因非法", { field: "reason" });
    }
    const [asset] = await db
      .select({ id: creatorAssets.id })
      .from(creatorAssets)
      .where(eq(creatorAssets.id, BigInt(input.asset_id)))
      .limit(1);
    if (!asset) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    await db
      .insert(assetReports)
      .values({
        id: newId(),
        assetId: asset.id,
        reporterUserId: BigInt(ctx.userId),
        spaceId: BigInt(ctx.spaceId),
        reason: input.reason,
        detail: input.detail ?? null,
        contact: input.contact ?? null,
        status: 1,
      })
      .onConflictDoUpdate({
        target: [assetReports.assetId, assetReports.reporterUserId],
        set: {
          reason: input.reason,
          detail: input.detail ?? null,
          contact: input.contact ?? null,
          updatedAt: new Date(),
        },
      });
    return { reported: true, asset_id: input.asset_id, reason: input.reason };
  }

  // ── 关注 / 粉丝（rt:299 / 300 / 301）──────────────────────
  /**
   * 关注/取关（幂等）。计数同样用 SQL 自增，并落到 `creator_profiles.follower_count`。
   */
  async followAction(ctx: TeamCtx, input: { creator_user_id: string; action: "follow" | "unfollow" }) {
    if (input.creator_user_id === ctx.userId) {
      throw new AppError(ErrorCode.INVALID_PARAM, "不能关注自己", { field: "creator_user_id" });
    }
    const target = BigInt(input.creator_user_id);
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, target)).limit(1);
    if (!user) throw new AppError(ErrorCode.NOT_FOUND, "creator not found");
    await this.ensureProfile(input.creator_user_id, ctx.spaceId);
    const me = BigInt(ctx.userId);

    if (input.action === "follow") {
      const inserted = await db
        .insert(creatorFollows)
        .values({ id: newId(), followerUserId: me, creatorUserId: target })
        .onConflictDoNothing({ target: [creatorFollows.followerUserId, creatorFollows.creatorUserId] })
        .returning({ id: creatorFollows.id });
      if (inserted.length > 0) {
        await db
          .update(creatorProfiles)
          .set({ followerCount: sql`${creatorProfiles.followerCount} + 1`, updatedAt: new Date() })
          .where(eq(creatorProfiles.userId, target));
      }
    } else {
      const removed = await db
        .delete(creatorFollows)
        .where(and(eq(creatorFollows.followerUserId, me), eq(creatorFollows.creatorUserId, target)))
        .returning({ id: creatorFollows.id });
      if (removed.length > 0) {
        await db
          .update(creatorProfiles)
          .set({ followerCount: sql`greatest(${creatorProfiles.followerCount} - 1, 0)`, updatedAt: new Date() })
          .where(eq(creatorProfiles.userId, target));
      }
    }

    const [row] = await db
      .select({ id: creatorFollows.id })
      .from(creatorFollows)
      .where(and(eq(creatorFollows.followerUserId, me), eq(creatorFollows.creatorUserId, target)))
      .limit(1);
    const [profile] = await db
      .select({ followerCount: creatorProfiles.followerCount })
      .from(creatorProfiles)
      .where(eq(creatorProfiles.userId, target))
      .limit(1);
    return {
      creator_user_id: input.creator_user_id,
      following: row !== undefined,
      follower_count: profile?.followerCount ?? 0,
    };
  }

  /** 我的关注（`crc/user/follows`） */
  async myFollows(ctx: TeamCtx, page = 1, pageSize = 20) {
    const rows = await db
      .select({
        user_id: creatorFollows.creatorUserId,
        nickname: users.nickname,
        followed_at: creatorFollows.createdAt,
        follower_count: creatorProfiles.followerCount,
        bio: creatorProfiles.bio,
      })
      .from(creatorFollows)
      .innerJoin(users, eq(users.id, creatorFollows.creatorUserId))
      .leftJoin(creatorProfiles, eq(creatorProfiles.userId, creatorFollows.creatorUserId))
      .where(eq(creatorFollows.followerUserId, BigInt(ctx.userId)))
      .orderBy(desc(creatorFollows.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return {
      list: rows.map((r) => ({
        user_id: String(r.user_id),
        nickname: r.nickname,
        bio: r.bio ?? "",
        follower_count: r.follower_count ?? 0,
        followed_at: r.followed_at,
      })),
      count: rows.length,
      page,
      page_size: pageSize,
    };
  }

  /** 我的粉丝（`crc/user/fans`） */
  async myFans(ctx: TeamCtx, page = 1, pageSize = 20) {
    const rows = await db
      .select({
        user_id: creatorFollows.followerUserId,
        nickname: users.nickname,
        followed_at: creatorFollows.createdAt,
      })
      .from(creatorFollows)
      .innerJoin(users, eq(users.id, creatorFollows.followerUserId))
      .where(eq(creatorFollows.creatorUserId, BigInt(ctx.userId)))
      .orderBy(desc(creatorFollows.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return {
      list: rows.map((r) => ({ user_id: String(r.user_id), nickname: r.nickname, followed_at: r.followed_at })),
      count: rows.length,
      page,
      page_size: pageSize,
    };
  }

  // ── 运营位 / 分类树（rt:290 / 295 / 291 / 292）────────────────
  bannerList(type?: string) {
    // 竞品 `banner_list?type=&scene=`：type 决定取哪个运营位。`pop_up` 复用同一张表。
    const slot = type === "pop_up" ? "pop_up" : type === "activity" ? "activity" : "banner";
    return this.op.listActivePromoSlots(slot);
  }

  popUp(type?: string) {
    const slot = type === "creator" ? "creator" : "pop_up";
    return this.op.listActivePromoSlots(slot);
  }

  categoryTree() {
    return { list: CATEGORY_TREE };
  }

  effectTree() {
    return { list: EFFECT_TREE };
  }

  // ── 活动位（rt:275-278）：委托 campaign 域，避免口径分裂 ──────────
  async activityList(ctx: TeamCtx, page = 1, pageSize = 20) {
    return this.campaigns.listMine(ctx, page, pageSize);
  }

  async activityPublic(ctx: TeamCtx, page = 1, pageSize = 20) {
    return this.campaigns.list(ctx, { page, pageSize });
  }

  async activityInfo(ctx: TeamCtx, id: string) {
    return this.campaigns.detail(ctx, id);
  }

  async activityResourceList(ctx: TeamCtx, campaignId: string, page = 1, pageSize = 20) {
    return this.campaigns.resourceList(ctx, campaignId, page, pageSize);
  }

  // ── 内部 ─────────────────────────────────────────────────
  /**
   * 取"我的作品"。`allowOtherWhenOperator` 只给审核动作开口子：
   * 审核员要看得到别人的待审稿，但**作品归属判断**仍然写在这一处，
   * 避免每个调用点各自判一遍（那样必然有一处漏判）。
   */
  private async ownAsset(ctx: TeamCtx, assetId: string, opts: { allowOtherWhenOperator?: boolean } = {}) {
    const [row] = await db.select().from(creatorAssets).where(eq(creatorAssets.id, BigInt(assetId))).limit(1);
    if (!row || row.deletedAt) throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    const isOwner = String(row.creatorUserId) === ctx.userId;
    if (!isOwner && !(opts.allowOtherWhenOperator && this.isOperatorOf(ctx, row.spaceId))) {
      // 别人的作品一律 404（不泄露存在性；403 会告诉攻击者"这个 id 是有效作品"）
      throw new AppError(ErrorCode.NOT_FOUND, "asset not found");
    }
    return row;
  }

  /** 特权只在作品所属 space 内生效（跨 space 的 master 什么都不是） */
  private isOperatorOf(ctx: TeamCtx, assetSpaceId: bigint): boolean {
    return String(assetSpaceId) === ctx.spaceId && TeamService.hasPrivilege(ctx);
  }

  private assetView(r: typeof creatorAssets.$inferSelect) {
    return {
      id: String(r.id),
      title: r.title,
      summary: r.summary,
      kind: r.kind,
      kind_label: KIND_LABEL[r.kind] ?? null,
      category: r.category,
      /** 效果标签（迁移 0033）：null = 未设置 */
      effect: r.effect,
      cover_uri: r.coverUri,
      uri: r.uri,
      status: r.status,
      status_label: STATUS_LABEL[r.status] ?? null,
      review_note: r.reviewNote,
      reviewed_by: r.reviewedBy ? String(r.reviewedBy) : null,
      reviewed_at: r.reviewedAt,
      creator_user_id: String(r.creatorUserId),
      space_id: String(r.spaceId),
      view_count: r.viewCount,
      like_count: r.likeCount,
      published_at: r.publishedAt,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    };
  }

  /** 批量补创作者昵称（信息流 N+1 的解法：一次 inArray 取完） */
  private async withCreatorNames(rows: Array<typeof creatorAssets.$inferSelect>) {
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.map((r) => String(r.creatorUserId)))];
    const profiles = await db
      .select({ userId: creatorProfiles.userId, nickname: creatorProfiles.nickname, avatar: creatorProfiles.avatarUri })
      .from(creatorProfiles)
      .where(inArray(creatorProfiles.userId, ids.map((id) => BigInt(id))));
    const map = new Map(profiles.map((p) => [String(p.userId), p]));
    return rows.map((r) => {
      const p = map.get(String(r.creatorUserId));
      return {
        ...this.assetView(r),
        // 只回昵称/头像：creatorProfiles.userId 是 bigint，直接塞进响应会在
        // JSON.stringify 阶段抛 "Do not know how to serialize a BigInt"（500）
        creator: p ? { nickname: p.nickname, avatar_uri: p.avatar } : null,
      };
    });
  }
}
