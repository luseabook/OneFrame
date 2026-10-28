import { Inject, Injectable } from "@nestjs/common";
import { and, arrayContains, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import {
  InsufficientBalanceError,
  creditIn,
  creditOut,
  marketAgreements,
  marketReviewLogs,
  marketWithdrawals,
  marketWorks,
  novelChapters,
  novelCharacters,
  novelEpisodeOutlines,
  novelEpisodes,
  novels,
  promoSlots,
  users,
} from "@app/db";
import type { Tx } from "@app/db";
import { AppError, ErrorCode, newId } from "@app/shared";
import { db } from "../../db/database";
import type { AuthContext } from "../../common/auth.types";
import {
  MARKET_AGREEMENT_KIND,
  MARKET_AGREEMENT_STATUS,
  MARKET_COMMISSION_BPS,
  MARKET_MIN_WITHDRAW_CREDITS,
  MARKET_REVIEW_ACTION,
  MARKET_REVIEW_ACTION_LABEL,
  MARKET_WITHDRAW_STATUS,
  MARKET_WITHDRAW_STATUS_LABEL,
  MARKET_WORK_STATUS,
  MARKET_WORK_STATUS_LABEL,
  commissionOf,
  revenueOf,
} from "./market.constants";
import { MarketTaxonomyService, type MarketCategory, type MarketTag } from "./market-taxonomy.service";

type WorkRow = typeof marketWorks.$inferSelect;
type AgreementRow = typeof marketAgreements.$inferSelect;
type WithdrawalRow = typeof marketWithdrawals.$inferSelect;

/** 集市列表默认可见的在售状态：只列「能买到的」，草稿/待审/驳回/下架不出现在集市 */
const VISIBLE_STATUS = [MARKET_WORK_STATUS.ON_SALE, MARKET_WORK_STATUS.PREORDER];

/**
 * 剧本集市（novel_market）服务 —— 对照竞品 `/web/v1/df/novel_market/*` 29 端点（rt:601-629）。
 *
 * ## 三条设计约束
 *
 * 1. **钱只有一条路**：购买/预售定金一律 `creditOut`（事务内锁账户 + 校验余额 + 写负向流水），
 *    余额不足 745701；退款回冲一律 `creditIn(kind='adjust')`。收益只累计到
 *    `market_works.revenue_credits`（**不进 `credit_accounts`**，schema.ts:2425-2427：
 *    收益是可提现的"收入"，与消耗型积分是两种钱，混在一起会让充值积分能被提现）。
 *
 * 2. **跨 space 读必须凭"已购凭据"，不能凭"知道 id"**。作品详情/作者/协议是公开的（集市要能被浏览），
 *    但 `content-tree` / `characters` / `episodes` / `download` / `parse` 是真内容——
 *    没买过就 403（`assertEntitled`）。竞品把这类读取放在 `/scripts/{nm_id}/*` 下由登录态兜底，
 *    我方的买方与作者**不在同一个 space**，所以必须显式判权，不能复用 `NovelService`
 *    （它按 `novels.space_id` 判权，买方永远读不到）。
 *
 * 3. **幂等靠"业务唯一状态"，不靠 Idempotency-Key**。同一买家对同一作品重复 `buy`
 *    返回已有协议（`idempotent: true`）而不是再扣一次分——判据是
 *    `market_agreements(work_id, buyer_user_id, kind=购买, status=已生效)`；
 *    并发双击由「先 `SELECT ... FOR UPDATE` 锁作品行」串行化，两次请求不会都走到扣分。
 */
@Injectable()
export class MarketService {
  /**
   * 分类/标签是**真表**（迁移 0030：`market_categories` / `market_tags`），
   * 作品通过 `market_works.category_id` / `tag_ids` 直接引用，筛选因此是纯 SQL。
   *
   * 显式 `@Inject` 是硬要求：esbuild/vitest 不产装饰器元数据，
   * 纯类型注入会拿到 `undefined`（这是本仓多个模块踩过的坑）。
   */
  constructor(@Inject(MarketTaxonomyService) private readonly taxonomy: MarketTaxonomyService) {}

  // ══════════════════════════════════════════════════════════
  // 一、C 端浏览
  // ══════════════════════════════════════════════════════════

  /**
   * 集市列表（rt:614 `GET /scripts?tag_ids=&category_id=&keyword=&page=&page_size=`）。
   *
   * 分类/标签现在是**纯 SQL 过滤**（迁移 0030 给 `market_works` 加了 `category_id` /
   * `tag_ids` 两列 + `idx_market_works_category`）：分类走等值、标签走数组包含，
   * 不再需要"先查 taxonomy 再回表求交"的两段式。
   * 标签仍是**「且」语义**（`arrayContains`）：竞品 `tag_ids` 多选的实际语义未取证，
   * 取"同时带全部选中标签"更能缩小结果集 → 登记待取证。
   */
  async listScripts(
    _auth: AuthContext,
    query: {
      category_id?: string;
      tag_ids?: string[];
      keyword?: string;
      kind?: number;
      owner_user_id?: string;
      page?: number;
      page_size?: number;
    },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, query.page_size ?? 20));

    const conds = [inArray(marketWorks.status, [...VISIBLE_STATUS]), isNull(marketWorks.deletedAt)];
    if (query.kind !== undefined) conds.push(eq(marketWorks.kind, query.kind));
    if (query.owner_user_id) conds.push(eq(marketWorks.ownerUserId, BigInt(query.owner_user_id)));
    if (query.keyword && query.keyword.trim() !== "") {
      const kw = `%${query.keyword.trim()}%`;
      conds.push(or(ilike(marketWorks.title, kw), ilike(marketWorks.summary, kw))!);
    }
    if (query.category_id) conds.push(eq(marketWorks.categoryId, BigInt(query.category_id)));
    if (query.tag_ids && query.tag_ids.length > 0) {
      conds.push(arrayContains(marketWorks.tagIds, query.tag_ids.map((id) => BigInt(id))));
    }

    const where = and(...conds);
    const rows = await db
      .select({
        work: marketWorks,
        authorName: users.nickname,
        authorAvatar: users.avatarUri,
      })
      .from(marketWorks)
      .leftJoin(users, eq(users.id, marketWorks.ownerUserId))
      .where(where)
      .orderBy(desc(marketWorks.publishedAt), desc(marketWorks.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(marketWorks)
      .where(where);

    return {
      list: rows.map((r) => ({
        ...this.toWorkDto(r.work),
        author: { user_id: String(r.work.ownerUserId), nickname: r.authorName ?? "", avatar_uri: r.authorAvatar ?? null },
      })),
      total: countRow?.count ?? 0,
      page,
      page_size: pageSize,
      taxonomy_filtered: Boolean(query.category_id || (query.tag_ids && query.tag_ids.length > 0)),
    };
  }

  /**
   * 集市配置（rt:620 `GET /scripts/config`）：分类/标签目录 + 抽成/提现门槛 + 协议类型。
   *
   * 这些是**前端渲染筛选器与购买确认弹窗**需要的口径，必须与后端结算同源
   * （`MARKET_COMMISSION_BPS` 直接下发，前端不写死 20%）。
   */
  async marketConfig() {
    const [categories, tags] = await Promise.all([this.taxonomy.listCategories(), this.taxonomy.listTags()]);
    return {
      categories: categories.filter((c) => c.status === 1),
      tags: tags.filter((t) => t.status === 1),
      commission_bps: MARKET_COMMISSION_BPS,
      commission_note: "运营未拍板，当前为初值（20%）",
      min_withdraw_credits: MARKET_MIN_WITHDRAW_CREDITS,
      agreement_kinds: [
        { kind: MARKET_AGREEMENT_KIND.PURCHASE, name: "购买协议", note: "一次买断，未定稿内容随作者更新" },
        { kind: MARKET_AGREEMENT_KIND.PREORDER, name: "预售协议", note: "先付定金锁定，开售后转正" },
        { kind: MARKET_AGREEMENT_KIND.LICENSE, name: "授权协议", note: "分成授权，收益按成交逐笔结算" },
      ],
      work_status: Object.entries(MARKET_WORK_STATUS_LABEL).map(([k, v]) => ({ status: Number(k), name: v })),
    };
  }

  /** 集市推广位（rt:621 `GET /scripts/promotions`）—— 读 `promo_slots` 的 market 位 */
  async promotions() {
    const rows = await db
      .select()
      .from(promoSlots)
      .where(and(eq(promoSlots.slot, "market"), eq(promoSlots.status, 1)))
      .orderBy(promoSlots.sort);
    const now = Date.now();
    return {
      list: rows
        .filter(
          (r) =>
            (!r.startsAt || r.startsAt.getTime() <= now) && (!r.endsAt || r.endsAt.getTime() > now),
        )
        .map((r) => ({
          id: String(r.id),
          title: r.title,
          image_uri: r.imageUri,
          link_uri: r.linkUri,
          sort: r.sort,
          starts_at: r.startsAt?.toISOString() ?? null,
          ends_at: r.endsAt?.toISOString() ?? null,
        })),
    };
  }

  /** 作品详情（rt:625）—— 公开浏览，不含正文 */
  async scriptDetail(workId: string) {
    const { work, authorName, authorAvatar } = await this.loadVisibleWork(workId);
    const counts = await this.novelCounts(work.novelId);
    return {
      ...this.toWorkDto(work),
      author: { user_id: String(work.ownerUserId), nickname: authorName ?? "", avatar_uri: authorAvatar ?? null },
      counts,
      /** 买方视角：是否需要先购买才能看内容 */
      access: {
        free_preview: true,
        requires_purchase: true,
        content_endpoints: ["content-tree", "characters", "episodes", "download"],
      },
    };
  }

  /**
   * 内容树（rt:624 `GET /scripts/{nm_id}/content-tree`）—— **需先购买**。
   * 返回章节/分集大纲/分集剧本的**结构骨架**（标题、字数、状态），不返回正文。
   */
  async scriptContentTree(auth: AuthContext, workId: string) {
    const { work } = await this.loadVisibleWork(workId);
    await this.assertEntitled(work, auth.userId);
    if (!work.novelId) {
      throw new AppError(ErrorCode.NOT_FOUND, "work has no linked novel; content tree unavailable");
    }
    const [chapters, epOutlines, episodes] = await Promise.all([
      db
        .select({
          chapterNo: novelChapters.chapterNo,
          title: novelChapters.title,
          wordCount: novelChapters.wordCount,
        })
        .from(novelChapters)
        .where(eq(novelChapters.novelId, work.novelId))
        .orderBy(novelChapters.chapterNo),
      db
        .select({
          episodeNo: novelEpisodeOutlines.episodeNo,
          title: novelEpisodeOutlines.title,
          synopsis: novelEpisodeOutlines.synopsis,
        })
        .from(novelEpisodeOutlines)
        .where(eq(novelEpisodeOutlines.novelId, work.novelId))
        .orderBy(novelEpisodeOutlines.episodeNo),
      db
        .select({ episodeNo: novelEpisodes.episodeNo, title: novelEpisodes.title, status: novelEpisodes.status })
        .from(novelEpisodes)
        .where(eq(novelEpisodes.novelId, work.novelId))
        .orderBy(novelEpisodes.episodeNo),
    ]);
    return {
      work_id: String(work.id),
      novel_id: String(work.novelId),
      chapters: chapters.map((c) => ({ chapter_no: c.chapterNo, title: c.title, word_count: c.wordCount })),
      chapter_count: chapters.length,
      total_word_count: chapters.reduce((sum, c) => sum + c.wordCount, 0),
      episode_outlines: epOutlines.map((e) => ({
        episode_no: e.episodeNo,
        title: e.title,
        synopsis: e.synopsis,
      })),
      episodes: episodes.map((e) => ({ episode_no: e.episodeNo, title: e.title, status: e.status })),
      /** 正文不在结构树里返回（下载走 `GET /scripts/:id/download`，便于审计与限流） */
      content_included: false,
    };
  }

  /** 角色卡（rt:623 `GET /scripts/{nm_id}/characters`）—— 需先购买 */
  async scriptCharacters(auth: AuthContext, workId: string) {
    const { work } = await this.loadVisibleWork(workId);
    await this.assertEntitled(work, auth.userId);
    if (!work.novelId) {
      throw new AppError(ErrorCode.NOT_FOUND, "work has no linked novel; characters unavailable");
    }
    const rows = await db
      .select()
      .from(novelCharacters)
      .where(eq(novelCharacters.novelId, work.novelId))
      .orderBy(novelCharacters.roleType, novelCharacters.createdAt);
    return {
      work_id: String(work.id),
      list: rows.map((c) => ({
        id: String(c.id),
        name: c.name,
        role_type: c.roleType,
        role_type_name: c.roleType === 1 ? "主角" : c.roleType === 3 ? "反派" : "配角",
        description: c.description,
        appearance: c.appearance,
        personality: c.personality,
        is_core: c.isCore,
      })),
      count: rows.length,
    };
  }

  /**
   * 分集剧本（rt:627 `GET /scripts/{nm_id}/episodes?start_episode_no=&end_episode_no=`）。
   * 需先购买；区间为闭区间，缺省取全部。
   */
  async scriptEpisodes(
    auth: AuthContext,
    workId: string,
    query: { start_episode_no?: number; end_episode_no?: number },
  ) {
    const { work } = await this.loadVisibleWork(workId);
    await this.assertEntitled(work, auth.userId);
    if (!work.novelId) {
      throw new AppError(ErrorCode.NOT_FOUND, "work has no linked novel; episodes unavailable");
    }
    if (
      query.start_episode_no !== undefined &&
      query.end_episode_no !== undefined &&
      query.start_episode_no > query.end_episode_no
    ) {
      throw new AppError(ErrorCode.INVALID_PARAM, "start_episode_no must not exceed end_episode_no", {
        field: "start_episode_no",
      });
    }
    const conds = [eq(novelEpisodes.novelId, work.novelId)];
    if (query.start_episode_no !== undefined) {
      conds.push(sql`${novelEpisodes.episodeNo} >= ${query.start_episode_no}`);
    }
    if (query.end_episode_no !== undefined) {
      conds.push(sql`${novelEpisodes.episodeNo} <= ${query.end_episode_no}`);
    }
    const rows = await db
      .select()
      .from(novelEpisodes)
      .where(and(...conds))
      .orderBy(novelEpisodes.episodeNo);
    return {
      work_id: String(work.id),
      list: rows.map((e) => ({
        id: String(e.id),
        episode_no: e.episodeNo,
        title: e.title,
        status: e.status,
        version: e.version,
        word_count: e.scriptText.length,
        script_text: e.scriptText,
      })),
      count: rows.length,
    };
  }

  /**
   * 增量时间戳（rt:629 `GET /scripts/{nm_id}/timestamp`）。
   *
   * ⚠️ 竞品该端点语义**未取证**（只有路由无参数说明）。我方定义为
   * 「客户端拿它判断是否需要重新拉内容」：作品行 `updated_at` + 本子 `updated_at` 的毫秒值。
   * 登记待取证，见回报。
   */
  async scriptTimestamp(workId: string) {
    const { work } = await this.loadVisibleWork(workId);
    let novelUpdatedAt: Date | null = null;
    if (work.novelId) {
      const [novel] = await db.select({ updatedAt: novels.updatedAt }).from(novels).where(eq(novels.id, work.novelId));
      novelUpdatedAt = novel?.updatedAt ?? null;
    }
    return {
      work_id: String(work.id),
      work_updated_at_ms: work.updatedAt.getTime(),
      novel_updated_at_ms: novelUpdatedAt?.getTime() ?? null,
      published_at_ms: work.publishedAt?.getTime() ?? null,
      server_time_ms: Date.now(),
    };
  }

  /** 作者信息（rt:617 `GET /scripts/:nm_id/author`）—— 公开 */
  async scriptAuthor(workId: string) {
    const { work, authorName, authorAvatar } = await this.loadVisibleWork(workId);
    const [stats] = await db
      .select({
        works: sql<number>`count(*)::int`,
        sales: sql<number>`coalesce(sum(${marketWorks.salesCount}), 0)::int`,
      })
      .from(marketWorks)
      .where(and(eq(marketWorks.ownerUserId, work.ownerUserId), isNull(marketWorks.deletedAt)));
    return {
      user_id: String(work.ownerUserId),
      nickname: authorName ?? "",
      avatar_uri: authorAvatar ?? null,
      published_works: stats?.works ?? 0,
      total_sales: stats?.sales ?? 0,
    };
  }

  /** 商务条款（rt:618 `GET /scripts/:nm_id/business`）—— 公开 */
  async scriptBusiness(workId: string) {
    const { work } = await this.loadVisibleWork(workId);
    return {
      work_id: String(work.id),
      commission_bps: MARKET_COMMISSION_BPS,
      commission_note: "运营未拍板，当前为初值（20%）",
      /** 平台抽成后的创作者实收比例（bps） */
      creator_share_bps: 10000 - MARKET_COMMISSION_BPS,
      /** 授权类型：本期只做「买断」与「预售定金」，分成授权（kind=3）仅留协议位不开放交易 */
      license_kinds: [
        { kind: MARKET_AGREEMENT_KIND.PURCHASE, name: "买断", available: true },
        { kind: MARKET_AGREEMENT_KIND.PREORDER, name: "预售定金", available: work.preorderPriceCredits !== null },
        { kind: MARKET_AGREEMENT_KIND.LICENSE, name: "分成授权", available: false, note: "协议位保留，交易未开放（待运营拍板）" },
      ],
      settlement: {
        revenue_field: "revenue_credits",
        note: "收益只累计，不进入积分余额；提现走 market_withdrawals 人工审核",
        min_withdraw_credits: MARKET_MIN_WITHDRAW_CREDITS,
      },
    };
  }

  /** 创作者资料（rt:619 `GET /scripts/:nm_id/creator`）—— 公开，与 author 的区别是带联系方式占位 */
  async scriptCreator(workId: string) {
    const { work, authorName, authorAvatar } = await this.loadVisibleWork(workId);
    const [agg] = await db
      .select({
        revenue: sql<number>`coalesce(sum(${marketWorks.revenueCredits}), 0)::int`,
      })
      .from(marketWorks)
      .where(eq(marketWorks.ownerUserId, work.ownerUserId));
    return {
      user_id: String(work.ownerUserId),
      nickname: authorName ?? "",
      avatar_uri: authorAvatar ?? null,
      /** 联系方式不公开（合规）：只暴露"可通过平台商务联系" */
      contact: { channel: "platform", note: "商务合作经平台撮合，不公开个人联系方式" },
      total_revenue_credits: agg?.revenue ?? 0,
    };
  }

  /**
   * 协议正文（rt:615 `GET /scripts/:nm_id/agreement`）—— 公开（买前必须能看）。
   *
   * 三类协议（购买/预售/授权）同源生成：条文里只填**本篇的真实数字**
   * （价格、抽成比例、退款口径），不写死模板外的承诺。
   */
  async scriptAgreement(workId: string, query: { kind?: number }) {
    const { work, authorName } = await this.loadVisibleWork(workId);
    const kind = query.kind ?? MARKET_AGREEMENT_KIND.PURCHASE;
    if (![1, 2, 3].includes(kind)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "unsupported agreement kind", { field: "kind" });
    }
    const price =
      kind === MARKET_AGREEMENT_KIND.PREORDER ? (work.preorderPriceCredits ?? 0) : work.priceCredits;
    const titleMap: Record<number, string> = { 1: "作品购买协议", 2: "作品预售协议", 3: "作品授权协议" };
    const body = [
      `《${titleMap[kind]}》`,
      "",
      `作品：《${work.title}》（作品编号 ${String(work.id)}）`,
      `作者：${authorName ?? ""}`,
      `乙方（购买方）：以平台账号为准`,
      "",
      "1. 标的：卖方在「一帧剧本集市」上架的上述作品，按本协议约定的方式交付。",
      `2. 价格：${price} 积分（平台抽成 ${MARKET_COMMISSION_BPS / 100}%，作者实收 ${revenueOf(price)} 积分）。`,
      kind === MARKET_AGREEMENT_KIND.PREORDER
        ? "3. 预售：定金支付后锁定价格，开售后可下载完整内容；开售前可取消并全额退回定金。"
        : "3. 交付：支付成功后即可在集市「我的购买」下载内容，作者后续更新对已购用户免费。",
      "4. 权利范围：仅限购买方自身创作使用，不得转售、再分发或用于训练第三方模型。",
      "5. 退款：预售定金在开售前可取消并全额退回；买断与分成授权一经交付不支持退款。",
      "6. 争议：由平台按《用户协议》与集市规则处理。",
      "",
      "（本协议由平台按成交信息自动生成，具有与线下签署文本同等效力。）",
    ].join("\n");
    return { work_id: String(work.id), kind, kind_name: titleMap[kind], title: titleMap[kind], body, signed: false };
  }

  /**
   * 协议附件（rt:616 `GET /scripts/:nm_id/agreement-file`）—— 返回 text/plain 供下载。
   * 与 `agreement` 同一份内容，只是形态不同（前端"下载协议"按钮直接用）。
   */
  async scriptAgreementFile(workId: string, query: { kind?: number }) {
    const agreement = await this.scriptAgreement(workId, query);
    return {
      filename: `agreement-${workId}-${agreement.kind}.txt`,
      content_type: "text/plain; charset=utf-8",
      content: agreement.body,
    };
  }

  // ══════════════════════════════════════════════════════════
  // 二、交易（钱必须走账本）
  // ══════════════════════════════════════════════════════════

  /**
   * 立即购买（现货）。
   *
   * 竞品把"下单"收敛在 `POST /scripts/{nm_id}/preorder`（rt:628）一个端点上，
   * 没有独立的"买断"路由。我方**拆成两条**（`buy` / `preorder`）：定金与全款在账务上
   * 是两种东西（定金可退、全款不可退），同一端点无法在流水里区分，对账时会互相污染。
   * → 已登记为「已知偏离」，见回报。
   */
  async buy(auth: AuthContext, workId: string) {
    return db.transaction(async (tx) => {
      const work = await this.lockWork(tx, workId);
      this.assertOnSale(work);
      if (work.status === MARKET_WORK_STATUS.PREORDER) {
        throw new AppError(ErrorCode.INVALID_PARAM, "work is in preorder phase; use POST /market/scripts/:id/preorder", {
          field: "preorder",
        });
      }
      if (work.ownerUserId === BigInt(auth.userId)) {
        throw new AppError(ErrorCode.INVALID_PARAM, "cannot purchase your own work");
      }
      if (work.priceCredits <= 0) {
        throw new AppError(ErrorCode.INVALID_PARAM, "work price not set by creator");
      }

      const existing = await this.findActiveAgreement(tx, work.id, BigInt(auth.userId), MARKET_AGREEMENT_KIND.PURCHASE);
      if (existing) {
        // 幂等：重复购买不重复扣分，直接回当前协议（并发双击由上面的作品行锁串行化）
        return { agreement: this.toAgreementDto(existing, work), idempotent: true, balance_after: null };
      }

      const price = work.priceCredits;
      const balanceAfter = await this.deduct(tx, auth.spaceId, price, `market buy work=${String(work.id)}`);
      const [agreement] = await tx
        .insert(marketAgreements)
        .values({
          id: newId(),
          workId: work.id,
          buyerUserId: BigInt(auth.userId),
          spaceId: BigInt(auth.spaceId),
          kind: MARKET_AGREEMENT_KIND.PURCHASE,
          priceCredits: price,
          status: MARKET_AGREEMENT_STATUS.ACTIVE,
          signedAt: new Date(),
        })
        .returning();
      await this.accrueRevenue(tx, work, price);
      return { agreement: this.toAgreementDto(agreement!, work), idempotent: false, balance_after: balanceAfter };
    });
  }

  /**
   * 预售定金（rt:628 `POST /scripts/{nm_id}/preorder`）。
   *
   * 定金 = `preorder_price_credits`，同样走 `creditOut`；收益按定金额累计
   * （与 `revenue_credits = Σ(已生效协议价 − 抽成)` 的对账口径一致，取消时按同额减回）。
   */
  async preorder(auth: AuthContext, workId: string) {
    return db.transaction(async (tx) => {
      const work = await this.lockWork(tx, workId);
      if (work.status !== MARKET_WORK_STATUS.PREORDER) {
        throw new AppError(ErrorCode.INVALID_PARAM, "work is not in preorder phase", {
          status: work.status,
          status_name: MARKET_WORK_STATUS_LABEL[work.status] ?? "",
        });
      }
      if (work.ownerUserId === BigInt(auth.userId)) {
        throw new AppError(ErrorCode.INVALID_PARAM, "cannot preorder your own work");
      }
      const price = work.preorderPriceCredits ?? 0;
      if (price <= 0) {
        throw new AppError(ErrorCode.INVALID_PARAM, "preorder price not set by creator");
      }

      const existing = await this.findActiveAgreement(tx, work.id, BigInt(auth.userId), MARKET_AGREEMENT_KIND.PREORDER);
      if (existing) {
        return { agreement: this.toAgreementDto(existing, work), idempotent: true, balance_after: null };
      }

      const balanceAfter = await this.deduct(
        tx,
        auth.spaceId,
        price,
        `market preorder work=${String(work.id)}`,
      );
      const [agreement] = await tx
        .insert(marketAgreements)
        .values({
          id: newId(),
          workId: work.id,
          buyerUserId: BigInt(auth.userId),
          spaceId: BigInt(auth.spaceId),
          kind: MARKET_AGREEMENT_KIND.PREORDER,
          priceCredits: price,
          status: MARKET_AGREEMENT_STATUS.ACTIVE,
          signedAt: new Date(),
        })
        .returning();
      await this.accrueRevenue(tx, work, price);
      return { agreement: this.toAgreementDto(agreement!, work), idempotent: false, balance_after: balanceAfter };
    });
  }

  /**
   * 取消订单（rt:622 `POST /scripts/{nm_id}/cancelorder`）—— **只对预售定金开放**。
   *
   * 为什么买断不能取消：内容已可下载（`download` 已放行），退款等于"白拿"，竞品亦无买断退款路由。
   * 回冲走 `creditIn(kind='adjust')`（`creditOut` 只有负向，退钱是正向），
   * 同时**减回** `revenue_credits`，保证 `Σrevenue == Σ(生效协议价 − 抽成)` 恒等。
   */
  async cancelOrder(auth: AuthContext, workId: string) {
    return db.transaction(async (tx) => {
      const work = await this.lockWork(tx, workId);
      const buyer = BigInt(auth.userId);
      const row = await this.findActiveAgreement(tx, work.id, buyer, MARKET_AGREEMENT_KIND.PREORDER);
      if (!row) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          "no cancellable preorder found (only preorder deposits can be cancelled; purchase orders cannot)",
        );
      }
      if (work.status !== MARKET_WORK_STATUS.PREORDER) {
        throw new AppError(ErrorCode.INVALID_PARAM, "preorder already converted; cannot cancel", {
          status: work.status,
        });
      }

      const price = row.priceCredits;
      await tx
        .update(marketAgreements)
        .set({ status: MARKET_AGREEMENT_STATUS.REFUNDED, updatedAt: new Date() })
        .where(eq(marketAgreements.id, row.id));
      // 反向记录（schema.ts:2465：退款加一行反向记录，不改原行的金额）
      const [refundRow] = await tx
        .insert(marketAgreements)
        .values({
          id: newId(),
          workId: work.id,
          buyerUserId: buyer,
          spaceId: row.spaceId,
          kind: MARKET_AGREEMENT_KIND.REFUND,
          priceCredits: price,
          status: MARKET_AGREEMENT_STATUS.REFUNDED,
          signedAt: new Date(),
        })
        .returning();

      const { balanceAfter } = await creditIn(tx, {
        spaceId: row.spaceId,
        amount: price,
        kind: "adjust",
        memo: `market preorder refund work=${String(work.id)} agreement=${String(row.id)}`,
      });
      await tx
        .update(marketWorks)
        .set({
          revenueCredits: sql`greatest(${marketWorks.revenueCredits} - ${revenueOf(price)}, 0)`,
          salesCount: sql`greatest(${marketWorks.salesCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(marketWorks.id, work.id));

      return {
        cancelled: true,
        agreement: this.toAgreementDto({ ...row, status: MARKET_AGREEMENT_STATUS.REFUNDED }, work),
        refund: this.toAgreementDto(refundRow!, work),
        refund_credits: price,
        balance_after: balanceAfter,
      };
    });
  }

  /**
   * 下载已购内容（rt:626 `GET /scripts/{nm_id}/download`）—— 需先购买，返回本子全文。
   *
   * 用 `text/plain` 直出（`@SkipEnvelope`）：浏览器点"下载"要能直接拿到文件，
   * 包一层 JSON 信封会让前端必须先解包再造 Blob。
   */
  async download(auth: AuthContext, workId: string) {
    const { work } = await this.loadVisibleWork(workId);
    await this.assertEntitled(work, auth.userId);
    if (!work.novelId) {
      throw new AppError(ErrorCode.NOT_FOUND, "work has no linked novel; nothing to download");
    }
    const [chapters, episodes] = await Promise.all([
      db
        .select()
        .from(novelChapters)
        .where(eq(novelChapters.novelId, work.novelId))
        .orderBy(novelChapters.chapterNo),
      db.select().from(novelEpisodes).where(eq(novelEpisodes.novelId, work.novelId)).orderBy(novelEpisodes.episodeNo),
    ]);
    const parts: string[] = [`# ${work.title}`, "", work.summary, ""];
    if (episodes.length > 0) {
      for (const ep of episodes) {
        parts.push(`## 第 ${ep.episodeNo} 集 ${ep.title}`, "", ep.scriptText, "");
      }
    } else {
      for (const chapter of chapters) {
        parts.push(`## 第 ${chapter.chapterNo} 章 ${chapter.title}`, "", chapter.content, "");
      }
    }
    return {
      filename: `work-${String(work.id)}.md`,
      content_type: "text/markdown; charset=utf-8",
      content: parts.join("\n"),
      chapter_count: chapters.length,
      episode_count: episodes.length,
    };
  }

  /**
   * 作品解析（task 要求：解析已购本子 → novel 域，**只读结构**）。
   *
   * 只读：不复制、不写库。真正"导入到我方 novel 域"需要产品先定许可范围
   * （买断是否允许二次改编/再发布），未拍板前不做写库，登记为未完成项。
   */
  async parsePurchased(auth: AuthContext, workId: string) {
    const { work } = await this.loadVisibleWork(workId);
    await this.assertEntitled(work, auth.userId);
    const counts = await this.novelCounts(work.novelId);
    return {
      work_id: String(work.id),
      novel_id: work.novelId ? String(work.novelId) : null,
      /** 只读结构：解析出的骨架供前端预览，不落库 */
      structure: {
        kind: work.kind === 2 ? "script" : work.kind === 3 ? "storyboard_pack" : "novel",
        counts,
        writable: false,
        note: "只读解析：买断后的二次改编许可未拍板，本期不复制到我方 novel 域",
      },
    };
  }

  // ══════════════════════════════════════════════════════════
  // 三、创作者侧（上架 / 编辑 / 提交 / 下架 / 解析 / 收益 / 提现）
  // ══════════════════════════════════════════════════════════

  /** 创作者资料（rt:601 `GET /creator/profile`） */
  async creatorProfile(auth: AuthContext) {
    const [user] = await db
      .select({ id: users.id, nickname: users.nickname, avatarUri: users.avatarUri })
      .from(users)
      .where(eq(users.id, BigInt(auth.userId)));
    const works = await db
      .select({ status: marketWorks.status, sales: marketWorks.salesCount, revenue: marketWorks.revenueCredits })
      .from(marketWorks)
      .where(and(eq(marketWorks.ownerUserId, BigInt(auth.userId)), isNull(marketWorks.deletedAt)));
    const revenueTotal = works.reduce((sum, w) => sum + w.revenue, 0);
    const withdrawStats = await this.withdrawStats(BigInt(auth.userId));
    return {
      user_id: auth.userId,
      nickname: user?.nickname ?? "",
      avatar_uri: user?.avatarUri ?? null,
      works_count: works.length,
      on_sale_count: works.filter((w) => w.status === MARKET_WORK_STATUS.ON_SALE || w.status === MARKET_WORK_STATUS.PREORDER)
        .length,
      total_sales: works.reduce((sum, w) => sum + w.sales, 0),
      revenue_credits: revenueTotal,
      available_withdraw_credits: Math.max(0, revenueTotal - withdrawStats.locked),
      commission_bps: MARKET_COMMISSION_BPS,
      min_withdraw_credits: MARKET_MIN_WITHDRAW_CREDITS,
    };
  }

  /** 我的作品列表（rt:604 `GET /creator/works`） */
  async creatorWorks(auth: AuthContext, query: { status?: number; page?: number; page_size?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, query.page_size ?? 20));
    const conds = [eq(marketWorks.ownerUserId, BigInt(auth.userId)), isNull(marketWorks.deletedAt)];
    if (query.status !== undefined) conds.push(eq(marketWorks.status, query.status));
    const where = and(...conds);
    const rows = await db
      .select()
      .from(marketWorks)
      .where(where)
      .orderBy(desc(marketWorks.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(marketWorks).where(where);
    return {
      list: rows.map((r) => this.toWorkDto(r)),
      total: countRow?.count ?? 0,
      page,
      page_size: pageSize,
    };
  }

  /** 单作品（rt:605 `GET /creator/works/:nm_id`） */
  async creatorWorkDetail(auth: AuthContext, workId: string) {
    const work = await this.loadOwnWork(auth, workId);
    const novelFinalized = work.novelId ? await this.isNovelFinalized(work.novelId) : null;
    return {
      ...this.toWorkDto(work),
      counts: await this.novelCounts(work.novelId),
      /** 上架前置条件：价格 > 0 且（未关联本子 或 本子已定稿）。缺什么一次说清，避免前端逐个试 */
      readiness: {
        has_novel: work.novelId !== null,
        novel_finalized: novelFinalized,
        price_set: work.priceCredits > 0,
        can_submit: work.priceCredits > 0 && (work.novelId === null || novelFinalized === true),
      },
    };
  }

  /**
   * 上架/保存作品（rt:604 `POST /creator/works` 与 rt:612 `POST /creator/works/save`）。
   *
   * 两条路径都写同一份数据，区别只在**是否保留独立路由**（竞品两条都在，
   * `save` 是"存草稿"语义）。为对齐覆盖，两条都保留：`save` 强制落到 `draft`
   * （已有作品则不改其状态），`create` 允许指定 `submit=true` 直接提交审核。
   */
  async creatorSaveWork(
    auth: AuthContext,
    input: {
      work_id?: string;
      novel_id?: string;
      title: string;
      summary?: string;
      cover_uri?: string;
      kind?: number;
      price_credits?: number;
      preorder_price_credits?: number | null;
      category_id?: string | null;
      tag_ids?: string[];
    },
    mode: "create" | "save",
    submit: boolean,
  ) {
    const owner = BigInt(auth.userId);
    const spaceId = BigInt(auth.spaceId);
    if (input.price_credits !== undefined && input.price_credits < 0) {
      throw new AppError(ErrorCode.INVALID_PARAM, "price_credits must be >= 0", { field: "price_credits" });
    }
    if (input.preorder_price_credits !== undefined && input.preorder_price_credits !== null) {
      if (input.preorder_price_credits < 0) {
        throw new AppError(ErrorCode.INVALID_PARAM, "preorder_price_credits must be >= 0", {
          field: "preorder_price_credits",
        });
      }
    }

    return db.transaction(async (tx) => {
      // 分类/标签引用先校验（迁移 0030：真表 + `market_works.category_id/tag_ids` 两列），
      // 校验和写入放在**同一个事务**里：否则"分类刚被运营停用"与"作品写进去"之间会漏一个窗口，
      // 留下指向停用分类的悬空引用。
      const refs = await this.taxonomy.resolveRefs(tx, {
        category_id: input.category_id,
        tag_ids: input.tag_ids,
      });
      let work: WorkRow;
      if (input.work_id) {
        const existing = await this.lockWork(tx, input.work_id);
        this.assertOwner(existing, auth.userId);
        if (existing.status === MARKET_WORK_STATUS.PENDING) {
          throw new AppError(ErrorCode.INVALID_PARAM, "work is under review; cannot edit until reviewed", {
            status: existing.status,
          });
        }
        // 在售/预售中改价只影响**后续成交**：已成交 agreement 保留原价、收益不回算
        // （这正是"revenue_credits 只记累计"的意义）。预售中改价必须保留定金价，
        // 否则状态 6 的作品会变成"没有可下单价格"的死单。
        if (existing.status === MARKET_WORK_STATUS.PREORDER && !hasPreorderPrice(input, existing)) {
          throw new AppError(ErrorCode.INVALID_PARAM, "preorder work must keep a positive preorder_price_credits", {
            field: "preorder_price_credits",
          });
        }
        const [updated] = await tx
          .update(marketWorks)
          .set({
            title: input.title,
            summary: input.summary ?? existing.summary,
            coverUri: input.cover_uri ?? existing.coverUri,
            kind: input.kind ?? existing.kind,
            priceCredits: input.price_credits ?? existing.priceCredits,
            preorderPriceCredits:
              input.preorder_price_credits === undefined
                ? existing.preorderPriceCredits
                : input.preorder_price_credits,
            novelId: input.novel_id ? BigInt(input.novel_id) : existing.novelId,
            ...(refs.categoryId !== undefined ? { categoryId: refs.categoryId } : {}),
            ...(refs.tagIds !== undefined ? { tagIds: refs.tagIds } : {}),
            updatedAt: new Date(),
          })
          .where(eq(marketWorks.id, existing.id))
          .returning();
        work = updated!;
      } else {
        const [created] = await tx
          .insert(marketWorks)
          .values({
            id: newId(),
            novelId: input.novel_id ? BigInt(input.novel_id) : null,
            ownerUserId: owner,
            spaceId,
            title: input.title,
            summary: input.summary ?? "",
            coverUri: input.cover_uri ?? null,
            kind: input.kind ?? 1,
            priceCredits: input.price_credits ?? 0,
            preorderPriceCredits: input.preorder_price_credits ?? null,
            categoryId: refs.categoryId ?? null,
            tagIds: refs.tagIds ?? [],
            status: MARKET_WORK_STATUS.DRAFT,
          })
          .returning();
        work = created!;
      }

      // 关联本子必须是本空间的（跨 space 挂别人本子 = 越权上架）
      if (work.novelId) {
        const [novel] = await tx
          .select({ spaceId: novels.spaceId })
          .from(novels)
          .where(eq(novels.id, work.novelId));
        if (!novel) throw new AppError(ErrorCode.NOT_FOUND, "novel not found", { field: "novel_id" });
        if (novel.spaceId !== spaceId) {
          throw new AppError(ErrorCode.FORBIDDEN, "novel belongs to another space", { field: "novel_id" });
        }
      }

      if (mode === "create" && submit) {
        work = await this.transitionToPending(tx, work, { operatorUserId: owner });
      }
      return { work: this.toWorkDto(work) };
    });
  }

  /** 提交审核（rt:609 `POST /creator/works/:nm_id/submit`）：草稿/已驳回/已下架 → 待审 */
  async creatorSubmit(auth: AuthContext, workId: string) {
    return db.transaction(async (tx) => {
      const work = await this.lockWork(tx, workId);
      this.assertOwner(work, auth.userId);
      if (work.priceCredits <= 0) {
        throw new AppError(ErrorCode.INVALID_PARAM, "price_credits must be > 0 before submit", {
          field: "price_credits",
        });
      }
      // 关联了本子就必须是本子定稿态（竞品以 status=16 作为"可被引用"判据，schema.ts:1300-1305）；
      // 未关联本子的外部投稿放行——它没有本子可校验。
      if (work.novelId && !(await this.isNovelFinalized(work.novelId))) {
        throw new AppError(ErrorCode.INVALID_PARAM, "novel must be finalized (status=16) before submit", {
          field: "novel_id",
        });
      }
      const updated = await this.transitionToPending(tx, work, { operatorUserId: BigInt(auth.userId) });
      return { work: this.toWorkDto(updated) };
    });
  }

  /** 下架（rt:608 `POST /creator/works/:nm_id/offline`）：在售/预售中 → 已下架 */
  async creatorOffline(auth: AuthContext, workId: string) {
    return db.transaction(async (tx) => {
      const work = await this.lockWork(tx, workId);
      this.assertOwner(work, auth.userId);
      if (work.status !== MARKET_WORK_STATUS.ON_SALE && work.status !== MARKET_WORK_STATUS.PREORDER) {
        throw new AppError(ErrorCode.INVALID_PARAM, "only on-sale or preorder works can be offlined", {
          status: work.status,
          status_name: MARKET_WORK_STATUS_LABEL[work.status] ?? "",
        });
      }
      const [updated] = await tx
        .update(marketWorks)
        .set({ status: MARKET_WORK_STATUS.OFFLINE, updatedAt: new Date() })
        .where(eq(marketWorks.id, work.id))
        .returning();
      // 下架后已在售订单不受影响（已购用户仍可 download）；新单不再产生
      await this.writeReviewLog(tx, {
        workId: work.id,
        action: MARKET_REVIEW_ACTION.OFFLINE,
        operatorUserId: BigInt(auth.userId),
        note: null,
      });
      return { work: this.toWorkDto(updated!) };
    });
  }

  /** 编辑作品（task 要求"编辑"；竞品无独立 PATCH 路由，语义并入 save） */
  async creatorPatch(
    auth: AuthContext,
    workId: string,
    input: {
      title?: string;
      summary?: string;
      cover_uri?: string;
      price_credits?: number;
      preorder_price_credits?: number | null;
      kind?: number;
      category_id?: string | null;
      tag_ids?: string[];
    },
  ) {
    return db.transaction(async (tx) => {
      const work = await this.lockWork(tx, workId);
      this.assertOwner(work, auth.userId);
      if (work.status === MARKET_WORK_STATUS.PENDING) {
        throw new AppError(ErrorCode.INVALID_PARAM, "work is under review; cannot edit until reviewed");
      }
      if (input.price_credits !== undefined && input.price_credits < 0) {
        throw new AppError(ErrorCode.INVALID_PARAM, "price_credits must be >= 0", { field: "price_credits" });
      }
      const refs = await this.taxonomy.resolveRefs(tx, {
        category_id: input.category_id,
        tag_ids: input.tag_ids,
      });
      const [updated] = await tx
        .update(marketWorks)
        .set({
          title: input.title ?? work.title,
          summary: input.summary ?? work.summary,
          coverUri: input.cover_uri ?? work.coverUri,
          kind: input.kind ?? work.kind,
          priceCredits: input.price_credits ?? work.priceCredits,
          preorderPriceCredits:
            input.preorder_price_credits === undefined ? work.preorderPriceCredits : input.preorder_price_credits,
          ...(refs.categoryId !== undefined ? { categoryId: refs.categoryId } : {}),
          ...(refs.tagIds !== undefined ? { tagIds: refs.tagIds } : {}),
          updatedAt: new Date(),
        })
        .where(eq(marketWorks.id, work.id))
        .returning();
      return { work: this.toWorkDto(updated!) };
    });
  }

  /** 创作者视角看协议（rt:606 `GET /creator/works/:nm_id/agreement`）：与买家同文 + 结算明细 */
  async creatorWorkAgreement(auth: AuthContext, workId: string) {
    const work = await this.loadOwnWork(auth, workId);
    const buyerView = await this.scriptAgreement(String(work.id), { kind: MARKET_AGREEMENT_KIND.PURCHASE });
    return {
      ...buyerView,
      creator_view: {
        price_credits: work.priceCredits,
        commission_credits: commissionOf(work.priceCredits),
        revenue_credits: revenueOf(work.priceCredits),
        commission_bps: MARKET_COMMISSION_BPS,
        note: "抽成比例为运营初值（20%），拍板后新成交按新比例，历史不回算",
      },
    };
  }

  /** 创作者视角的内容树（rt:607）—— 自己的作品不需要购买凭据 */
  async creatorWorkContentTree(auth: AuthContext, workId: string) {
    const work = await this.loadOwnWork(auth, workId);
    return this.buildContentTree(work);
  }

  /**
   * 作品解析（rt:611 `POST /creator/works/parse`）—— 上架前的"一键填表"。
   *
   * 输入本子 id，输出可直接喂给上架表单的结构（标题/摘要/角色数/章节数/分集数）。
   * **不写库**（这是"解析预览"，不是"创建作品"）；摘要取世界观 summary 的前 200 字。
   */
  async creatorParseWork(auth: AuthContext, input: { novel_id: string; work_id?: string }) {
    if (input.work_id) {
      const own = await this.loadOwnWork(auth, input.work_id);
      if (own.novelId && String(own.novelId) !== input.novel_id) {
        throw new AppError(ErrorCode.INVALID_PARAM, "work_id does not link to this novel", { field: "novel_id" });
      }
    }
    const [novel] = await db.select().from(novels).where(eq(novels.id, BigInt(input.novel_id)));
    if (!novel) throw new AppError(ErrorCode.NOT_FOUND, "novel not found", { field: "novel_id" });
    if (novel.spaceId !== BigInt(auth.spaceId)) {
      throw new AppError(ErrorCode.FORBIDDEN, "novel belongs to another space", { field: "novel_id" });
    }
    const chapters = await db
      .select({ wordCount: novelChapters.wordCount })
      .from(novelChapters)
      .where(eq(novelChapters.novelId, novel.id));
    const [charCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(novelCharacters)
      .where(eq(novelCharacters.novelId, novel.id));
    const [epCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(novelEpisodes)
      .where(eq(novelEpisodes.novelId, novel.id));
    const meta = (novel.meta ?? {}) as Record<string, unknown>;
    const worldviewSummary = typeof meta["worldview_summary"] === "string" ? (meta["worldview_summary"] as string) : "";
    return {
      novel_id: String(novel.id),
      title: novel.title,
      status: novel.status,
      /** 定稿才能上架（与 submit 的前置条件同源，避免"解析通过但提交失败"） */
      finalized: novel.status === 16,
      chapter_count: chapters.length,
      total_word_count: chapters.reduce((sum, c) => sum + c.wordCount, 0),
      character_count: charCount?.count ?? 0,
      episode_count: epCount?.count ?? 0,
      suggested: {
        title: novel.title,
        summary: worldviewSummary.slice(0, 200),
        kind: epCount?.count ? 2 : 1,
        cover_uri: typeof meta["cover_uri"] === "string" ? (meta["cover_uri"] as string) : null,
      },
      writable: false,
    };
  }

  /** 创作者数据（rt:613 `GET /creator/works/stats`） */
  async creatorStats(auth: AuthContext) {
    const owner = BigInt(auth.userId);
    const rows = await db
      .select({
        status: marketWorks.status,
        sales: marketWorks.salesCount,
        revenue: marketWorks.revenueCredits,
      })
      .from(marketWorks)
      .where(and(eq(marketWorks.ownerUserId, owner), isNull(marketWorks.deletedAt)));
    const byStatus: Record<string, number> = {};
    for (const row of rows) {
      const name = MARKET_WORK_STATUS_LABEL[row.status] ?? String(row.status);
      byStatus[name] = (byStatus[name] ?? 0) + 1;
    }
    const revenue = rows.reduce((sum, r) => sum + r.revenue, 0);
    const withdrawStats = await this.withdrawStats(owner);
    return {
      works_count: rows.length,
      works_by_status: byStatus,
      total_sales: rows.reduce((sum, r) => sum + r.sales, 0),
      revenue_credits: revenue,
      commission_bps: MARKET_COMMISSION_BPS,
      withdraw: {
        locked_credits: withdrawStats.locked,
        paid_credits: withdrawStats.paid,
        available_credits: Math.max(0, revenue - withdrawStats.locked),
      },
    };
  }

  /** 收益明细（rt:602 `GET /creator/revenues?status=&page=&page_size=`） */
  async creatorRevenues(
    auth: AuthContext,
    query: { status?: number; page?: number; page_size?: number },
  ) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, query.page_size ?? 20));
    const conds = [eq(marketWorks.ownerUserId, BigInt(auth.userId))];
    if (query.status !== undefined) conds.push(eq(marketAgreements.status, query.status));
    const where = and(...conds);
    const rows = await db
      .select({ agreement: marketAgreements, work: marketWorks })
      .from(marketAgreements)
      .innerJoin(marketWorks, eq(marketWorks.id, marketAgreements.workId))
      .where(where)
      .orderBy(desc(marketAgreements.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(marketAgreements)
      .innerJoin(marketWorks, eq(marketWorks.id, marketAgreements.workId))
      .where(where);
    return {
      list: rows.map((r) => ({
        agreement_id: String(r.agreement.id),
        work_id: String(r.work.id),
        work_title: r.work.title,
        kind: r.agreement.kind,
        kind_name: this.agreementKindName(r.agreement.kind),
        price_credits: r.agreement.priceCredits,
        commission_credits: commissionOf(r.agreement.priceCredits),
        revenue_credits: revenueOf(r.agreement.priceCredits),
        status: r.agreement.status,
        status_name: this.agreementStatusName(r.agreement.status),
        buyer_user_id: String(r.agreement.buyerUserId),
        created_at: r.agreement.createdAt.toISOString(),
      })),
      total: countRow?.count ?? 0,
      page,
      page_size: pageSize,
    };
  }

  /** 收益总览（rt:603 `GET /creator/revenues/overview`） */
  async creatorRevenuesOverview(auth: AuthContext) {
    const owner = BigInt(auth.userId);
    const stats = await this.creatorStats(auth);
    const withdrawStats = await this.withdrawStats(owner);
    return {
      revenue_credits: stats.revenue_credits,
      total_sales: stats.total_sales,
      commission_bps: MARKET_COMMISSION_BPS,
      /** 可提现 = 累计收益 − 已申请未终结的提现（1 待审 / 2 已通过 / 3 已打款） */
      available_credits: Math.max(0, stats.revenue_credits - withdrawStats.locked),
      locked_credits: withdrawStats.locked,
      paid_credits: withdrawStats.paid,
      min_withdraw_credits: MARKET_MIN_WITHDRAW_CREDITS,
      settlement_note: "收益不进入积分余额；提现走人工审核 + 渠道打款",
    };
  }

  /**
   * 提现申请（rt:610 `POST /creator/works/:nm_id/withdraw` + 账户维度入口）。
   *
   * ## 与竞品的偏离（重要）
   * 竞品**按作品提现**（路径里带 `nm_id`，`d-commerce-account.md:415-417`：
   * "提现按作品维度而非账户余额，说明收益是分作品分账"）。我方
   * `market_withdrawals` **没有 `work_id` 列**（schema.ts:2494-2515），本批不能改 schema，
   * 所以：
   * - 资金口径统一按**账户**算（`available = Σrevenue − Σ未终结提现`），保证不会超额提现；
   * - 作品归属写进 `account_info.work_id`（jsonb，可查询、可对账），保留"这笔钱是从哪个作品来的"；
   * - 传入 `work_id` 时额外校验**该作品未提现收益**足够（否则会出现"用 A 作品的收益替 B 作品提现"）。
   * → 需要 `market_withdrawals.work_id` 列才能真正照做，已登记给 Lead。
   */
  async creatorWithdraw(
    auth: AuthContext,
    input: { amount_credits?: number; work_id?: string; channel?: string; account_info?: Record<string, unknown> },
  ) {
    const owner = BigInt(auth.userId);
    return db.transaction(async (tx) => {
      // 同一用户同时只允许 1 笔待审：advisory 锁串行化"查+插"，否则并发两个请求都能查到 0 笔
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`market_withdraw:${auth.userId}`}))`);
      const [pending] = await tx
        .select({ id: marketWithdrawals.id })
        .from(marketWithdrawals)
        .where(and(eq(marketWithdrawals.userId, owner), eq(marketWithdrawals.status, MARKET_WITHDRAW_STATUS.PENDING)))
        .limit(1);
      if (pending) {
        throw new AppError(ErrorCode.INVALID_PARAM, "a withdrawal request is already pending review", {
          withdrawal_id: String(pending.id),
        });
      }

      const revenue = await this.totalRevenue(tx, owner);
      const locked = await this.lockedWithdraw(tx, owner);
      const available = Math.max(0, revenue - locked);

      let amount = input.amount_credits;
      if (amount === undefined) {
        if (!input.work_id) {
          throw new AppError(ErrorCode.INVALID_PARAM, "amount_credits is required", { field: "amount_credits" });
        }
        // 未传金额时，按该作品的未提现收益全额申请（对齐竞品"按作品一笔"的用法）
        amount = await this.workAvailable(tx, owner, input.work_id);
      }
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new AppError(ErrorCode.INVALID_PARAM, "amount_credits must be a positive integer", {
          field: "amount_credits",
        });
      }
      if (amount < MARKET_MIN_WITHDRAW_CREDITS) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          `amount_credits must be at least ${MARKET_MIN_WITHDRAW_CREDITS}`,
          { field: "amount_credits", min: MARKET_MIN_WITHDRAW_CREDITS },
        );
      }
      if (amount > available) {
        throw new AppError(ErrorCode.INVALID_PARAM, `amount exceeds available balance (${available})`, {
          field: "amount_credits",
          available,
        });
      }
      if (input.work_id) {
        const workAvailable = await this.workAvailable(tx, owner, input.work_id);
        if (amount > workAvailable) {
          throw new AppError(ErrorCode.INVALID_PARAM, `amount exceeds this work's unwithdrawn revenue (${workAvailable})`, {
            field: "amount_credits",
            work_available: workAvailable,
          });
        }
      }

      const [row] = await tx
        .insert(marketWithdrawals)
        .values({
          id: newId(),
          userId: owner,
          spaceId: BigInt(auth.spaceId),
          amountCredits: amount,
          /** 归属作品落**真列**（迁移 0030）；空 = 账户级汇总提现 */
          workId: input.work_id ? BigInt(input.work_id) : null,
          status: MARKET_WITHDRAW_STATUS.PENDING,
          channel: input.channel ?? "alipay",
          accountInfo: input.account_info ?? {},
        })
        .returning();
      return { withdrawal: this.toWithdrawalDto(row!) };
    });
  }

  /** 我的提现列表（供前端看状态机进度；竞品该列表未在 C 端路由中单列，属我方补充） */
  async creatorWithdrawals(auth: AuthContext, query: { status?: number; page?: number; page_size?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, query.page_size ?? 20));
    const conds = [eq(marketWithdrawals.userId, BigInt(auth.userId))];
    if (query.status !== undefined) conds.push(eq(marketWithdrawals.status, query.status));
    const where = and(...conds);
    const rows = await db
      .select()
      .from(marketWithdrawals)
      .where(where)
      .orderBy(desc(marketWithdrawals.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(marketWithdrawals).where(where);
    return { list: rows.map((r) => this.toWithdrawalDto(r)), total: countRow?.count ?? 0, page, page_size: pageSize };
  }

  /** 撤销提现（状态机 1 待审 → 5 已撤销）。已通过的不能撤（可能已在打款流程） */
  async creatorCancelWithdrawal(auth: AuthContext, withdrawalId: string) {
    return db.transaction(async (tx) => {
      const row = await this.lockWithdrawal(tx, withdrawalId);
      if (row.userId !== BigInt(auth.userId)) {
        throw new AppError(ErrorCode.FORBIDDEN, "not your withdrawal request");
      }
      if (row.status !== MARKET_WITHDRAW_STATUS.PENDING) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          `only pending withdrawals can be cancelled (status=${row.status})`,
          { status: row.status, status_name: MARKET_WITHDRAW_STATUS_LABEL[row.status] ?? "" },
        );
      }
      const [updated] = await tx
        .update(marketWithdrawals)
        .set({ status: MARKET_WITHDRAW_STATUS.CANCELLED, updatedAt: new Date() })
        .where(eq(marketWithdrawals.id, row.id))
        .returning();
      return { withdrawal: this.toWithdrawalDto(updated!) };
    });
  }

  // ══════════════════════════════════════════════════════════
  // 四、Admin（运营后台，`/v1/ops/market`）
  // ══════════════════════════════════════════════════════════

  /** 作品列表（rt:105 `GET /scripts/list`）：默认列待审，可按状态过滤 */
  async adminListWorks(query: { status?: number; keyword?: string; page?: number; page_size?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20));
    const conds = [isNull(marketWorks.deletedAt)];
    conds.push(eq(marketWorks.status, query.status ?? MARKET_WORK_STATUS.PENDING));
    if (query.keyword && query.keyword.trim() !== "") {
      conds.push(ilike(marketWorks.title, `%${query.keyword.trim()}%`));
    }
    const where = and(...conds);
    const rows = await db
      .select({ work: marketWorks, authorName: users.nickname })
      .from(marketWorks)
      .leftJoin(users, eq(users.id, marketWorks.ownerUserId))
      .where(where)
      .orderBy(desc(marketWorks.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(marketWorks).where(where);
    return {
      list: rows.map((r) => ({
        ...this.toWorkDto(r.work),
        author: { user_id: String(r.work.ownerUserId), nickname: r.authorName ?? "" },
      })),
      total: countRow?.count ?? 0,
      page,
      page_size: pageSize,
    };
  }

  /** 作品详情（运营视角：带作者、本子、审核提示） */
  async adminWorkDetail(workId: string) {
    const { work, authorName, authorAvatar } = await this.loadVisibleWork(workId);
    const logs = await db
      .select()
      .from(marketReviewLogs)
      .where(eq(marketReviewLogs.workId, work.id))
      .orderBy(desc(marketReviewLogs.createdAt))
      .limit(50);
    return {
      ...this.toWorkDto(work),
      author: { user_id: String(work.ownerUserId), nickname: authorName ?? "", avatar_uri: authorAvatar ?? null },
      counts: await this.novelCounts(work.novelId),
      review: {
        auditable: work.status === MARKET_WORK_STATUS.PENDING,
        rejected_can_resubmit: work.status === MARKET_WORK_STATUS.REJECTED,
        last_audit_note: work.auditNote,
      },
      /** 完整审核轨迹（迁移 0030 的 market_review_logs）：客诉/申诉靠这个还原 */
      review_logs: logs.map((l) => this.toReviewLogDto(l)),
    };
  }

  /**
   * 运营代提审（rt:109 `POST /scripts/{nm_id}/submit-review`，双段式第一段）。
   *
   * 竞品的双段式（submit-review → review-result）里，第一段是"把作品送进审核队列"。
   * 我方 `market_works.status` 只有 `2 待审` 一个状态位，所以这一段做的是
   * **运营代创作者提交**（草稿/已驳回/已下架 → 待审），与 C 端 submit 同义但走运营权限。
   * 已待审时**幂等返回**（不报错），便于运营批量点。
   */
  async adminSubmitReview(workId: string, operatorAdminId?: string) {
    return db.transaction(async (tx) => {
      const work = await this.lockWork(tx, workId);
      if (work.status === MARKET_WORK_STATUS.PENDING) {
        return { work: this.toWorkDto(work), idempotent: true };
      }
      if (work.priceCredits <= 0) {
        throw new AppError(ErrorCode.INVALID_PARAM, "price_credits must be > 0 before review", {
          field: "price_credits",
        });
      }
      const updated = await this.transitionToPending(tx, work, {
        operatorAdminId: operatorAdminId ? BigInt(operatorAdminId) : null,
      });
      return { work: this.toWorkDto(updated), idempotent: false };
    });
  }

  /**
   * 出审核结论（rt:107 `POST /scripts/{nm_id}/review-result`，双段式第二段）。
   *
   * 状态机：**只有 `2 待审` 可审**；`3 在售 / 4 已驳回 / 5 已下架 / 6 预售中` 再审一律 400101
   * （不可逆：驳回后只能"重新提交成新的待审"，不能直接改判）。
   * 通过时若作品设了预售定金 → 落 `6 预售中`，否则落 `3 在售`。
   */
  async adminReviewResult(
    workId: string,
    input: {
      result: "approved" | "rejected";
      audit_note?: string;
      category_id?: string;
      tag_ids?: string[];
    },
    operatorAdminId?: string,
  ) {
    return db.transaction(async (tx) => {
      const work = await this.lockWork(tx, workId);
      if (work.status !== MARKET_WORK_STATUS.PENDING) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          `work is not pending review (status=${work.status}); review is not reversible`,
          { status: work.status, status_name: MARKET_WORK_STATUS_LABEL[work.status] ?? "" },
        );
      }
      const approved = input.result === "approved";
      const nextStatus = approved
        ? work.preorderPriceCredits !== null
          ? MARKET_WORK_STATUS.PREORDER
          : MARKET_WORK_STATUS.ON_SALE
        : MARKET_WORK_STATUS.REJECTED;
      const refs = await this.taxonomy.resolveRefs(tx, {
        category_id: input.category_id,
        tag_ids: input.tag_ids,
      });
      const [updated] = await tx
        .update(marketWorks)
        .set({
          status: nextStatus,
          auditNote: input.audit_note ?? null,
          publishedAt: approved ? new Date() : work.publishedAt,
          ...(refs.categoryId !== undefined ? { categoryId: refs.categoryId } : {}),
          ...(refs.tagIds !== undefined ? { tagIds: refs.tagIds } : {}),
          updatedAt: new Date(),
        })
        .where(eq(marketWorks.id, work.id))
        .returning();
      await this.writeReviewLog(tx, {
        workId: work.id,
        action: approved ? MARKET_REVIEW_ACTION.APPROVE : MARKET_REVIEW_ACTION.REJECT,
        operatorAdminId: operatorAdminId ? BigInt(operatorAdminId) : null,
        note: input.audit_note ?? null,
      });
      return { work: this.toWorkDto(updated!) };
    });
  }

  /**
   * 原始剧本溯源（rt:108 `GET /scripts/{nm_id}/source-original-script`）。
   *
   * 竞品这个端点的存在证明"平台持有上游原始剧本"（`d-commerce-account.md:412`）。
   * 我方对应 `market_works.novel_id → novels`（本子），返回本子元信息与章节骨架；
   * **不返回全文**（全文归 `download` 且需购买凭据，运营也不该绕过购买协议看全本——
   * 只给"这份作品是从哪本子来的、结构多大"，用于纠纷溯源）。
   */
  async adminSourceOriginalScript(workId: string) {
    const { work } = await this.loadVisibleWork(workId);
    if (!work.novelId) {
      return { work_id: String(work.id), novel_id: null, available: false, note: "该作品未关联本子（外部投稿）" };
    }
    const [novel] = await db.select().from(novels).where(eq(novels.id, work.novelId));
    if (!novel) {
      return { work_id: String(work.id), novel_id: String(work.novelId), available: false, note: "本子已不存在" };
    }
    const chapters = await db
      .select({ chapterNo: novelChapters.chapterNo, title: novelChapters.title, wordCount: novelChapters.wordCount })
      .from(novelChapters)
      .where(eq(novelChapters.novelId, novel.id))
      .orderBy(novelChapters.chapterNo);
    return {
      work_id: String(work.id),
      novel_id: String(novel.id),
      available: true,
      novel: {
        title: novel.title,
        status: novel.status,
        source_type: novel.sourceType,
        space_id: String(novel.spaceId),
        created_at: novel.createdAt.toISOString(),
      },
      chapters: chapters.map((c) => ({ chapter_no: c.chapterNo, title: c.title, word_count: c.wordCount })),
      total_word_count: chapters.reduce((sum, c) => sum + c.wordCount, 0),
      /** 全文索引不在这里给：避免运营侧成为"绕过购买的读取口" */
      content_included: false,
    };
  }

  /** 运营代存草稿（rt:106 `POST /scripts/save-draft`） */
  async adminSaveDraft(input: {
    owner_user_id: string;
    space_id: string;
    novel_id?: string;
    title: string;
    summary?: string;
    price_credits?: number;
    preorder_price_credits?: number | null;
    kind?: number;
  }) {
    const [created] = await db
      .insert(marketWorks)
      .values({
        id: newId(),
        novelId: input.novel_id ? BigInt(input.novel_id) : null,
        ownerUserId: BigInt(input.owner_user_id),
        spaceId: BigInt(input.space_id),
        title: input.title,
        summary: input.summary ?? "",
        kind: input.kind ?? 1,
        priceCredits: input.price_credits ?? 0,
        preorderPriceCredits: input.preorder_price_credits ?? null,
        status: MARKET_WORK_STATUS.DRAFT,
      })
      .returning();
    return { work: this.toWorkDto(created!) };
  }

  /** 集市看板（rt:102 `GET /dashboard/scripts`）：各状态计数 + 成交额 + 待处理量 */
  async adminDashboard() {
    const [statusRows, agreeAgg, pendingWithdraw] = await Promise.all([
      db
        .select({ status: marketWorks.status, count: sql<number>`count(*)::int` })
        .from(marketWorks)
        .where(isNull(marketWorks.deletedAt))
        .groupBy(marketWorks.status),
      db
        .select({
          agreements: sql<number>`count(*)::int`,
          gross: sql<number>`coalesce(sum(${marketAgreements.priceCredits}), 0)::int`,
        })
        .from(marketAgreements)
        .where(eq(marketAgreements.status, MARKET_AGREEMENT_STATUS.ACTIVE)),
      db
        .select({ count: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${marketWithdrawals.amountCredits}), 0)::int` })
        .from(marketWithdrawals)
        .where(eq(marketWithdrawals.status, MARKET_WITHDRAW_STATUS.PENDING)),
    ]);
    const byStatus: Record<string, number> = {};
    for (const row of statusRows) {
      byStatus[MARKET_WORK_STATUS_LABEL[row.status] ?? String(row.status)] = row.count;
    }
    const gross = agreeAgg[0]?.gross ?? 0;
    return {
      works_by_status: byStatus,
      pending_review: byStatus[MARKET_WORK_STATUS_LABEL[MARKET_WORK_STATUS.PENDING]!] ?? 0,
      agreements: agreeAgg[0]?.agreements ?? 0,
      gross_credits: gross,
      commission_credits: commissionOf(gross),
      creator_revenue_credits: revenueOf(gross),
      commission_bps: MARKET_COMMISSION_BPS,
      pending_withdrawals: { count: pendingWithdraw[0]?.count ?? 0, amount_credits: pendingWithdraw[0]?.amount ?? 0 },
    };
  }

  // ── 分类 / 标签 ──────────────────────────────────────────
  async adminCategories(): Promise<{ list: MarketCategory[] }> {
    return { list: await this.taxonomy.listCategories() };
  }

  async adminCreateCategory(input: { name: string; sort?: number }) {
    return db.transaction(async (tx) => ({ category: await this.taxonomy.createCategory(tx, input) }));
  }

  async adminPatchCategory(id: string, input: { name?: string; sort?: number; status?: number }) {
    return db.transaction(async (tx) => ({ category: await this.taxonomy.patchCategory(tx, id, input) }));
  }

  /**
   * 删分类 = **停用**（`status=2`），不物理删。
   * `market_works.category_id` 没有反向级联，物理删会让历史作品的分类变成悬空指针，
   * 列表按该分类筛选直接漏数据（schema.ts:3052-3056 记录了这个取舍）。
   */
  async adminDeleteCategory(id: string) {
    return db.transaction(async (tx) => {
      const category = await this.taxonomy.disableCategory(tx, id);
      return { deleted: true, disabled: true, id: category.id, status: category.status };
    });
  }

  async adminTags(): Promise<{ list: MarketTag[] }> {
    return { list: await this.taxonomy.listTags() };
  }

  async adminCreateTag(input: { name: string }) {
    return db.transaction(async (tx) => this.taxonomy.createTag(tx, input));
  }

  /** 改标签名（第 83 批）；与分类改名同口径：走事务，重名 400101、不存在 400102 */
  async adminPatchTag(id: string, input: { name: string }) {
    return db.transaction(async (tx) => ({ tag: await this.taxonomy.patchTag(tx, id, input) }));
  }

  /** 删标签 = 物理删 + 从所有作品 `tag_ids` 摘除（返回受影响的按品数） */
  async adminDeleteTag(id: string) {
    return db.transaction(async (tx) => {
      const result = await this.taxonomy.deleteTag(tx, id);
      return { deleted: true, id: result.id, affected_works: result.affected_works };
    });
  }

  // ── 推广位（写 promo_slots）─────────────────────────────
  async adminPromotions(slot = "market") {
    const rows = await db
      .select()
      .from(promoSlots)
      .where(eq(promoSlots.slot, slot))
      .orderBy(promoSlots.sort);
    return {
      list: rows.map((r) => ({
        id: String(r.id),
        slot: r.slot,
        title: r.title,
        image_uri: r.imageUri,
        link_uri: r.linkUri,
        sort: r.sort,
        status: r.status,
        starts_at: r.startsAt?.toISOString() ?? null,
        ends_at: r.endsAt?.toISOString() ?? null,
        view_count: r.viewCount,
        click_count: r.clickCount,
      })),
    };
  }

  async adminCreatePromotion(input: {
    slot?: string;
    title: string;
    image_uri?: string;
    link_uri?: string;
    sort?: number;
    starts_at?: string;
    ends_at?: string;
  }) {
    const [row] = await db
      .insert(promoSlots)
      .values({
        id: newId(),
        slot: input.slot ?? "market",
        title: input.title,
        imageUri: input.image_uri ?? null,
        linkUri: input.link_uri ?? null,
        sort: input.sort ?? 0,
        status: 1,
        startsAt: input.starts_at ? new Date(input.starts_at) : null,
        endsAt: input.ends_at ? new Date(input.ends_at) : null,
      })
      .returning();
    return { promotion: { id: String(row!.id), slot: row!.slot, title: row!.title, sort: row!.sort, status: row!.status } };
  }

  async adminPatchPromotion(
    id: string,
    input: {
      title?: string;
      image_uri?: string;
      link_uri?: string;
      sort?: number;
      status?: number;
      starts_at?: string | null;
      ends_at?: string | null;
    },
  ) {
    const [row] = await db
      .update(promoSlots)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.image_uri !== undefined ? { imageUri: input.image_uri } : {}),
        ...(input.link_uri !== undefined ? { linkUri: input.link_uri } : {}),
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.starts_at !== undefined ? { startsAt: input.starts_at ? new Date(input.starts_at) : null } : {}),
        ...(input.ends_at !== undefined ? { endsAt: input.ends_at ? new Date(input.ends_at) : null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(promoSlots.id, BigInt(id)))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "promotion not found");
    return { promotion: { id: String(row.id), slot: row.slot, title: row.title, sort: row.sort, status: row.status } };
  }

  /** 停用推广位（不物理删：保留投放历史与曝光/点击计数） */
  async adminDeletePromotion(id: string) {
    const [row] = await db
      .update(promoSlots)
      .set({ status: 2, updatedAt: new Date() })
      .where(eq(promoSlots.id, BigInt(id)))
      .returning();
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "promotion not found");
    return { deleted: true, id: String(row.id), status: row.status };
  }

  // ── 提现审核（状态机）────────────────────────────────────
  async adminWithdrawals(query: { status?: number; page?: number; page_size?: number }) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.page_size ?? 20));
    const where =
      query.status !== undefined ? eq(marketWithdrawals.status, query.status) : undefined;
    const rows = await db
      .select({ row: marketWithdrawals, nickname: users.nickname })
      .from(marketWithdrawals)
      .leftJoin(users, eq(users.id, marketWithdrawals.userId))
      .where(where)
      .orderBy(desc(marketWithdrawals.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(marketWithdrawals)
      .where(where);
    return {
      list: rows.map((r) => ({ ...this.toWithdrawalDto(r.row), user_nickname: r.nickname ?? "" })),
      total: countRow?.count ?? 0,
      page,
      page_size: pageSize,
    };
  }

  /**
   * 提现审核（通过 / 驳回）。**状态机不可跳步**：
   * - 通过：只允许 `1 待审 → 2 已通过`
   * - 驳回：只允许 `1 待审` 或 `2 已通过` → `4 已驳回`（打款失败/资料错误）
   * - 其它（已打款/已驳回/已撤销）再审 → 400101
   */
  async adminReviewWithdrawal(withdrawalId: string, input: { result: "approved" | "rejected"; review_note?: string }) {
    return db.transaction(async (tx) => {
      const row = await this.lockWithdrawal(tx, withdrawalId);
      const approved = input.result === "approved";
      if (approved) {
        if (row.status !== MARKET_WITHDRAW_STATUS.PENDING) {
          throw new AppError(
            ErrorCode.INVALID_PARAM,
            `only pending withdrawals can be approved (status=${row.status})`,
            { status: row.status, status_name: MARKET_WITHDRAW_STATUS_LABEL[row.status] ?? "" },
          );
        }
      } else if (row.status !== MARKET_WITHDRAW_STATUS.PENDING && row.status !== MARKET_WITHDRAW_STATUS.APPROVED) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          `only pending or approved withdrawals can be rejected (status=${row.status})`,
          { status: row.status, status_name: MARKET_WITHDRAW_STATUS_LABEL[row.status] ?? "" },
        );
      }
      const [updated] = await tx
        .update(marketWithdrawals)
        .set({
          status: approved ? MARKET_WITHDRAW_STATUS.APPROVED : MARKET_WITHDRAW_STATUS.REJECTED,
          reviewNote: input.review_note ?? null,
          updatedAt: new Date(),
        })
        .where(eq(marketWithdrawals.id, row.id))
        .returning();
      return { withdrawal: this.toWithdrawalDto(updated!) };
    });
  }

  /**
   * 打款（`2 已通过 → 3 已打款`）。
   *
   * **真实打款不在这里做**：竞品打款渠道未取证，我方也不接资金通道（合规与资质）。
   * 本端点只做"运营在渠道侧打完款后回填凭证"，把状态推进到终态并记录渠道流水号。
   * 待审直接打款（跳步）→ 400101，这是本批 DoD 明确要求拒绝的场景。
   */
  async adminPayoutWithdrawal(withdrawalId: string, input: { channel_refund_no?: string; review_note?: string }) {
    return db.transaction(async (tx) => {
      const row = await this.lockWithdrawal(tx, withdrawalId);
      if (row.status !== MARKET_WITHDRAW_STATUS.APPROVED) {
        throw new AppError(
          ErrorCode.INVALID_PARAM,
          `withdrawal must be approved before payout (status=${row.status})`,
          { status: row.status, status_name: MARKET_WITHDRAW_STATUS_LABEL[row.status] ?? "" },
        );
      }
      const [updated] = await tx
        .update(marketWithdrawals)
        .set({
          status: MARKET_WITHDRAW_STATUS.PAID,
          paidAt: new Date(),
          reviewNote: input.review_note ?? row.reviewNote,
          accountInfo: {
            ...(row.accountInfo as Record<string, unknown>),
            ...(input.channel_refund_no ? { channel_refund_no: input.channel_refund_no } : {}),
            paid_manually: true,
          },
          updatedAt: new Date(),
        })
        .where(eq(marketWithdrawals.id, row.id))
        .returning();
      return { withdrawal: this.toWithdrawalDto(updated!) };
    });
  }

  // ══════════════════════════════════════════════════════════
  // 五、内部工具
  // ══════════════════════════════════════════════════════════

  /** 扣分（唯一入口）：转成 745701，绝不把底层异常直接抛给客户端 */
  /**
   * 扣分（唯一入口）：**必须走积分账本** `creditOut`，任何情况下不允许直接改
   * `credit_accounts.balance`（`database.md §4` 对账不变式 `balance == Σdelta`）。
   *
   * `kind` 固定传 **`consume`**（迁移 0030 起 `creditOut` 的 kind 是
   * `"refund" | "consume"` union）：集市购买/预售定金是"直接消耗"，不是退款。
   * 记成 `refund` 会让财务对账的"退款金额"虚高（ledger.ts:178-184 的注释原话）。
   */
  private async deduct(tx: Tx, spaceId: string, amount: number, memo: string): Promise<number> {
    try {
      const { balanceAfter } = await creditOut(tx, {
        spaceId: BigInt(spaceId),
        amount,
        kind: "consume",
        memo,
      });
      return balanceAfter;
    } catch (err) {
      if (err instanceof InsufficientBalanceError) {
        throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, "积分余额不足（745701）", {
          required: amount,
          field: "credits",
        });
      }
      throw err;
    }
  }

  /** 收益累计（成交价 − 抽成），**不进 credit_accounts**（schema.ts:2425-2427） */
  private async accrueRevenue(tx: Tx, work: WorkRow, price: number) {
    await tx
      .update(marketWorks)
      .set({
        salesCount: sql`${marketWorks.salesCount} + 1`,
        revenueCredits: sql`${marketWorks.revenueCredits} + ${revenueOf(price)}`,
        updatedAt: new Date(),
      })
      .where(eq(marketWorks.id, work.id));
  }

  private async lockWork(tx: Tx, workId: string): Promise<WorkRow> {
    let id: bigint;
    try {
      id = BigInt(workId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid work id", { field: "id" });
    }
    // 软删的作品一律当不存在（404 而不是 403：不泄露"这个 id 曾经存在"）
    const [row] = await tx.select().from(marketWorks).where(eq(marketWorks.id, id)).for("update");
    if (!row || row.deletedAt) throw new AppError(ErrorCode.NOT_FOUND, "market work not found");
    return row;
  }

  private async lockWithdrawal(tx: Tx, withdrawalId: string): Promise<WithdrawalRow> {
    let id: bigint;
    try {
      id = BigInt(withdrawalId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid withdrawal id", { field: "id" });
    }
    const [row] = await tx.select().from(marketWithdrawals).where(eq(marketWithdrawals.id, id)).for("update");
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, "withdrawal not found");
    return row;
  }

  /** 公开可见作品（集市浏览/详情/协议）：软删 → 404 */
  private async loadVisibleWork(workId: string) {
    let id: bigint;
    try {
      id = BigInt(workId);
    } catch {
      throw new AppError(ErrorCode.INVALID_PARAM, "invalid work id", { field: "id" });
    }
    const [row] = await db
      .select({ work: marketWorks, authorName: users.nickname, authorAvatar: users.avatarUri })
      .from(marketWorks)
      .leftJoin(users, eq(users.id, marketWorks.ownerUserId))
      .where(eq(marketWorks.id, id));
    if (!row || row.work.deletedAt) throw new AppError(ErrorCode.NOT_FOUND, "market work not found");
    return { work: row.work, authorName: row.authorName, authorAvatar: row.authorAvatar };
  }

  /** 自己的作品（创作者侧）：不是我的 → 403（不是 404：自己的创作列表里不该出现别人 id 的"不存在"混淆） */
  private async loadOwnWork(auth: AuthContext, workId: string): Promise<WorkRow> {
    const work = await this.loadVisibleWork(workId).then((r) => r.work);
    this.assertOwner(work, auth.userId);
    return work;
  }

  private assertOwner(work: WorkRow, userId: string) {
    if (work.ownerUserId !== BigInt(userId)) {
      throw new AppError(ErrorCode.FORBIDDEN, "not the owner of this work");
    }
  }

  private assertOnSale(work: WorkRow) {
    if (work.status !== MARKET_WORK_STATUS.ON_SALE && work.status !== MARKET_WORK_STATUS.PREORDER) {
      throw new AppError(ErrorCode.INVALID_PARAM, "work is not on sale", {
        status: work.status,
        status_name: MARKET_WORK_STATUS_LABEL[work.status] ?? "",
      });
    }
  }

  /**
   * 内容读取凭据：作者本人 or 存在**已生效**的购买/预售协议。
   * 没有凭据 → 403 `reason=not_purchased`（前端据此弹"去购买"，而不是报错）。
   */
  private async assertEntitled(work: WorkRow, userId: string) {
    if (work.ownerUserId === BigInt(userId)) return;
    const [row] = await db
      .select({ id: marketAgreements.id })
      .from(marketAgreements)
      .where(
        and(
          eq(marketAgreements.workId, work.id),
          eq(marketAgreements.buyerUserId, BigInt(userId)),
          eq(marketAgreements.status, MARKET_AGREEMENT_STATUS.ACTIVE),
          inArray(marketAgreements.kind, [MARKET_AGREEMENT_KIND.PURCHASE, MARKET_AGREEMENT_KIND.PREORDER]),
        ),
      )
      .limit(1);
    if (!row) {
      throw new AppError(ErrorCode.FORBIDDEN, "purchase required to read this work's content", {
        reason: "not_purchased",
        work_id: String(work.id),
      });
    }
  }

  private async findActiveAgreement(tx: Tx, workId: bigint, buyerUserId: bigint, kind: number) {
    const [row] = await tx
      .select()
      .from(marketAgreements)
      .where(
        and(
          eq(marketAgreements.workId, workId),
          eq(marketAgreements.buyerUserId, buyerUserId),
          eq(marketAgreements.kind, kind),
          eq(marketAgreements.status, MARKET_AGREEMENT_STATUS.ACTIVE),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  /** 草稿/已驳回/已下架 → 待审（在售/预售中的作品不允许回退，必须先 offline） */
  /**
   * 草稿/已驳回/已下架 → 待审（在售/预售中的作品不允许回退，必须先 offline）。
   * 每次成功迁移都写一条 `market_review_logs(action=1 提交)`：
   * 审核轨迹从"谁提交的"开始，之后才有通过/驳回/下架。
   */
  private async transitionToPending(
    tx: Tx,
    work: WorkRow,
    operator: { operatorUserId?: bigint | null; operatorAdminId?: bigint | null },
  ): Promise<WorkRow> {
    if (
      work.status === MARKET_WORK_STATUS.ON_SALE ||
      work.status === MARKET_WORK_STATUS.PREORDER ||
      work.status === MARKET_WORK_STATUS.PENDING
    ) {
      throw new AppError(
        ErrorCode.INVALID_PARAM,
        `cannot submit from status=${work.status}; offline it first`,
        { status: work.status, status_name: MARKET_WORK_STATUS_LABEL[work.status] ?? "" },
      );
    }
    const [updated] = await tx
      .update(marketWorks)
      .set({ status: MARKET_WORK_STATUS.PENDING, updatedAt: new Date() })
      .where(eq(marketWorks.id, work.id))
      .returning();
    await this.writeReviewLog(tx, {
      workId: work.id,
      action: MARKET_REVIEW_ACTION.SUBMIT,
      operatorUserId: operator.operatorUserId ?? null,
      operatorAdminId: operator.operatorAdminId ?? null,
      note: null,
    });
    return updated!;
  }

  /** 审核留痕（迁移 0030 `market_review_logs`）：与状态变更同事务，失败即一起回滚 */
  private async writeReviewLog(
    tx: Tx,
    input: {
      workId: bigint;
      action: number;
      operatorUserId?: bigint | null;
      operatorAdminId?: bigint | null;
      note: string | null;
    },
  ): Promise<void> {
    await tx.insert(marketReviewLogs).values({
      id: newId(),
      workId: input.workId,
      action: input.action,
      operatorUserId: input.operatorUserId ?? null,
      operatorAdminId: input.operatorAdminId ?? null,
      note: input.note,
    });
  }

  private toReviewLogDto(row: typeof marketReviewLogs.$inferSelect) {
    return {
      id: String(row.id),
      work_id: String(row.workId),
      action: row.action,
      action_name: MARKET_REVIEW_ACTION_LABEL[row.action] ?? String(row.action),
      operator_admin_id: row.operatorAdminId ? String(row.operatorAdminId) : null,
      operator_user_id: row.operatorUserId ? String(row.operatorUserId) : null,
      note: row.note,
      created_at: row.createdAt.toISOString(),
    };
  }

  /**
   * 本子是否"可上架"：竞品以 `status=16 已定稿` 作为可被引用判据
   * （schema.ts:1300-1305）。未关联本子的外部投稿由调用方决定是否放行。
   */
  private async isNovelFinalized(novelId: bigint | null): Promise<boolean> {
    if (!novelId) return false;
    const [row] = await db.select({ status: novels.status }).from(novels).where(eq(novels.id, novelId));
    return row?.status === 16;
  }

  private async novelCounts(novelId: bigint | null) {
    if (!novelId) {
      return { chapters: 0, characters: 0, episodes: 0, total_word_count: 0 };
    }
    const [[chapterAgg], [charAgg], [epAgg]] = await Promise.all([
      db
        .select({
          count: sql<number>`count(*)::int`,
          words: sql<number>`coalesce(sum(${novelChapters.wordCount}), 0)::int`,
        })
        .from(novelChapters)
        .where(eq(novelChapters.novelId, novelId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(novelCharacters)
        .where(eq(novelCharacters.novelId, novelId)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(novelEpisodes)
        .where(eq(novelEpisodes.novelId, novelId)),
    ]);
    return {
      chapters: chapterAgg?.count ?? 0,
      characters: charAgg?.count ?? 0,
      episodes: epAgg?.count ?? 0,
      total_word_count: chapterAgg?.words ?? 0,
    };
  }

  private async buildContentTree(work: WorkRow) {
    if (!work.novelId) {
      return {
        work_id: String(work.id),
        novel_id: null,
        chapters: [],
        chapter_count: 0,
        total_word_count: 0,
        episode_outlines: [],
        episodes: [],
        content_included: false,
      };
    }
    const [chapters, outlines, episodes] = await Promise.all([
      db
        .select({
          chapterNo: novelChapters.chapterNo,
          title: novelChapters.title,
          wordCount: novelChapters.wordCount,
        })
        .from(novelChapters)
        .where(eq(novelChapters.novelId, work.novelId))
        .orderBy(novelChapters.chapterNo),
      db
        .select({
          episodeNo: novelEpisodeOutlines.episodeNo,
          title: novelEpisodeOutlines.title,
          synopsis: novelEpisodeOutlines.synopsis,
        })
        .from(novelEpisodeOutlines)
        .where(eq(novelEpisodeOutlines.novelId, work.novelId))
        .orderBy(novelEpisodeOutlines.episodeNo),
      db
        .select({ episodeNo: novelEpisodes.episodeNo, title: novelEpisodes.title, status: novelEpisodes.status })
        .from(novelEpisodes)
        .where(eq(novelEpisodes.novelId, work.novelId))
        .orderBy(novelEpisodes.episodeNo),
    ]);
    return {
      work_id: String(work.id),
      novel_id: String(work.novelId),
      chapters: chapters.map((c) => ({ chapter_no: c.chapterNo, title: c.title, word_count: c.wordCount })),
      chapter_count: chapters.length,
      total_word_count: chapters.reduce((sum, c) => sum + c.wordCount, 0),
      episode_outlines: outlines.map((e) => ({ episode_no: e.episodeNo, title: e.title, synopsis: e.synopsis })),
      episodes: episodes.map((e) => ({ episode_no: e.episodeNo, title: e.title, status: e.status })),
      content_included: false,
    };
  }

  /** 累计收益（不含已下架作品？——下架不影响已得收益，故全部计入，只排除软删） */
  private async totalRevenue(tx: Tx, ownerUserId: bigint): Promise<number> {
    const [row] = await tx
      .select({ sum: sql<number>`coalesce(sum(${marketWorks.revenueCredits}), 0)::int` })
      .from(marketWorks)
      .where(and(eq(marketWorks.ownerUserId, ownerUserId), isNull(marketWorks.deletedAt)));
    return row?.sum ?? 0;
  }

  /** 已申请未终结的提现额（1 待审 / 2 已通过 / 3 已打款）——这些钱不能再申请一次 */
  private async lockedWithdraw(tx: Tx, ownerUserId: bigint): Promise<number> {
    const [row] = await tx
      .select({ sum: sql<number>`coalesce(sum(${marketWithdrawals.amountCredits}), 0)::int` })
      .from(marketWithdrawals)
      .where(
        and(
          eq(marketWithdrawals.userId, ownerUserId),
          inArray(marketWithdrawals.status, [
            MARKET_WITHDRAW_STATUS.PENDING,
            MARKET_WITHDRAW_STATUS.APPROVED,
            MARKET_WITHDRAW_STATUS.PAID,
          ]),
        ),
      );
    return row?.sum ?? 0;
  }

  /** 某作品的未提现收益（按 account_info.work_id 归属反查，见我方偏离说明） */
  private async workAvailable(tx: Tx, ownerUserId: bigint, workId: string): Promise<number> {
    const [work] = await tx
      .select({ revenue: marketWorks.revenueCredits, owner: marketWorks.ownerUserId })
      .from(marketWorks)
      .where(eq(marketWorks.id, BigInt(workId)));
    if (!work) throw new AppError(ErrorCode.NOT_FOUND, "market work not found", { field: "work_id" });
    if (work.owner !== ownerUserId) {
      throw new AppError(ErrorCode.FORBIDDEN, "not the owner of this work", { field: "work_id" });
    }
    const [claimed] = await tx
      .select({ sum: sql<number>`coalesce(sum(${marketWithdrawals.amountCredits}), 0)::int` })
      .from(marketWithdrawals)
      .where(
        and(
          eq(marketWithdrawals.userId, ownerUserId),
          inArray(marketWithdrawals.status, [
            MARKET_WITHDRAW_STATUS.PENDING,
            MARKET_WITHDRAW_STATUS.APPROVED,
            MARKET_WITHDRAW_STATUS.PAID,
          ]),
          /**
           * 归属判据：新行走真列 `work_id`；迁移 0030 之前写入的旧行把归属放在
           * `account_info.work_id`（jsonb 文本）。两者都算"这笔钱已经为这个作品申请过"，
           * 只认列会让旧行的额度凭空多出来一笔（可被重复提现）。
           */
          or(
            eq(marketWithdrawals.workId, BigInt(workId)),
            sql`${marketWithdrawals.accountInfo}->>'work_id' = ${workId}`,
          ),
        ),
      );
    return Math.max(0, work.revenue - (claimed?.sum ?? 0));
  }

  private async withdrawStats(ownerUserId: bigint) {
    const [row] = await db
      .select({
        locked: sql<number>`coalesce(sum(case when ${marketWithdrawals.status} in (1,2) then ${marketWithdrawals.amountCredits} else 0 end), 0)::int`,
        paid: sql<number>`coalesce(sum(case when ${marketWithdrawals.status} = 3 then ${marketWithdrawals.amountCredits} else 0 end), 0)::int`,
      })
      .from(marketWithdrawals)
      .where(eq(marketWithdrawals.userId, ownerUserId));
    return { locked: row?.locked ?? 0, paid: row?.paid ?? 0 };
  }

  // ── DTO ─────────────────────────────────────────────────
  private toWorkDto(work: WorkRow) {
    return {
      id: String(work.id),
      novel_id: work.novelId ? String(work.novelId) : null,
      owner_user_id: String(work.ownerUserId),
      space_id: String(work.spaceId),
      title: work.title,
      summary: work.summary,
      cover_uri: work.coverUri,
      kind: work.kind,
      kind_name: work.kind === 2 ? "剧本" : work.kind === 3 ? "分镜包" : "小说",
      price_credits: work.priceCredits,
      preorder_price_credits: work.preorderPriceCredits,
      status: work.status,
      status_name: MARKET_WORK_STATUS_LABEL[work.status] ?? String(work.status),
      audit_note: work.auditNote,
      sales_count: work.salesCount,
      revenue_credits: work.revenueCredits,
      /** 分类/标签直接来自 `market_works` 的两列（迁移 0030），不再回查配置 */
      category_id: work.categoryId ? String(work.categoryId) : null,
      tag_ids: work.tagIds.map((id) => String(id)),
      published_at: work.publishedAt?.toISOString() ?? null,
      created_at: work.createdAt.toISOString(),
      updated_at: work.updatedAt.toISOString(),
    };
  }

  private toAgreementDto(row: AgreementRow, work: WorkRow) {
    return {
      id: String(row.id),
      work_id: String(row.workId),
      work_title: work.title,
      buyer_user_id: String(row.buyerUserId),
      space_id: String(row.spaceId),
      kind: row.kind,
      kind_name: this.agreementKindName(row.kind),
      price_credits: row.priceCredits,
      commission_credits: commissionOf(row.priceCredits),
      revenue_credits: revenueOf(row.priceCredits),
      status: row.status,
      status_name: this.agreementStatusName(row.status),
      signed_at: row.signedAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
    };
  }

  private toWithdrawalDto(row: WithdrawalRow) {
    return {
      id: String(row.id),
      user_id: String(row.userId),
      space_id: String(row.spaceId),
      amount_credits: row.amountCredits,
      /** 归属作品（迁移 0030 的真列）；null = 账户级汇总提现 */
      work_id: row.workId ? String(row.workId) : null,
      status: row.status,
      status_name: MARKET_WITHDRAW_STATUS_LABEL[row.status] ?? String(row.status),
      channel: row.channel,
      account_info: row.accountInfo as Record<string, unknown>,
      review_note: row.reviewNote,
      paid_at: row.paidAt?.toISOString() ?? null,
      /** 状态机允许的下一步（前端据此渲染按钮，避免点了没反应） */
      next_actions:
        row.status === MARKET_WITHDRAW_STATUS.PENDING
          ? ["approve", "reject", "cancel"]
          : row.status === MARKET_WITHDRAW_STATUS.APPROVED
            ? ["payout", "reject"]
            : [],
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private agreementKindName(kind: number) {
    return kind === MARKET_AGREEMENT_KIND.PURCHASE
      ? "购买"
      : kind === MARKET_AGREEMENT_KIND.PREORDER
        ? "预售"
        : kind === MARKET_AGREEMENT_KIND.LICENSE
          ? "授权"
          : "退款";
  }

  private agreementStatusName(status: number) {
    return status === MARKET_AGREEMENT_STATUS.PENDING
      ? "待支付"
      : status === MARKET_AGREEMENT_STATUS.ACTIVE
        ? "已生效"
        : "已退款";
  }
}

/** 预售作品改价时必须保留定金价（否则状态 6 的作品会没有可下单价格） */
function hasPreorderPrice(input: { preorder_price_credits?: number | null }, existing: WorkRow): boolean {
  const next = input.preorder_price_credits === undefined ? existing.preorderPriceCredits : input.preorder_price_credits;
  return next !== null && next > 0;
}
