import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import { Public } from "../../common/public.decorator";
import { parseOrThrow } from "../../common/zod";
import { AdminGuard } from "../admin/admin.guard";
import type { AdminAuth } from "../admin/admin-auth.service";
import { MarketService } from "./market.service";

/** AdminGuard 会把管理员身份挂到请求上（`admin.guard.ts:17`） */
type AdminRequest = FastifyRequest & { adminAuth?: AdminAuth };

/**
 * 集市 Admin（运营后台）—— 对照竞品 `/v1/rmadminsrv/novel_market/*` 12 端点（`routes.txt:100-111`）。
 *
 * ## 鉴权模型与竞品一致：后台与 C 端**物理隔离**
 * 竞品把审核放在独立服务域 `rmadminsrv`，不在 `web/v1` 下
 * （`docs/01-product/_parts/d-commerce-account.md:412`）。我方用 `/v1/ops/market` 前缀 +
 * `AdminGuard`（`@Public()` 跳过全局用户 AuthGuard）实现同样的隔离：
 * 普通用户 token 打不过来（403 `admin only`），管理员凭证是独立的 `oneframe-admin` 签发。
 *
 * ## 端点映射（14 条覆盖竞品 12 条）
 * | 竞品 | 我方 |
 * |---|---|
 * | `GET /scripts/list` (rt:105) | `GET /ops/market/scripts/list` |
 * | `POST /scripts/save-draft` (rt:106) | `POST /ops/market/scripts/save-draft` |
 * | `POST /scripts/{nm_id}/submit-review` (rt:109) | `POST /ops/market/scripts/:id/submit-review` |
 * | `POST /scripts/{nm_id}/review-result` (rt:107) | `POST /ops/market/scripts/:id/review-result` |
 * | `GET /scripts/{nm_id}/source-original-script` (rt:108) | 同名映射 |
 * | `GET /dashboard/scripts` (rt:102) | `GET /ops/market/dashboard/scripts` |
 * | `categories` / `categories/{id}` (rt:100-101) | 4 条 CRUD |
 * | `tags` / `tags/{tag_id}` (rt:110-111) | 3 条 CRUD |
 * | `promotions` / `promotions/{id}` (rt:103-104) | 4 条 CRUD（写 `promo_slots`） |
 * | （提现审核无竞品路由） | `withdrawals` 3 条（我方补：提现状态机必须有人审） |
 */
const pageQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const listQuery = pageQuery.extend({
  status: z.coerce.number().int().min(1).max(6).optional(),
  keyword: z.string().max(100).optional(),
});

const reviewBody = z.object({
  /** 双段式第二段：出结论。驳回必须给理由（audit_note），否则创作者不知道为什么被拒 */
  result: z.enum(["approved", "rejected"]),
  audit_note: z.string().max(1000).optional(),
  category_id: z.string().min(1).max(32).optional(),
  tag_ids: z.array(z.string().min(1).max(32)).max(20).optional(),
});

const saveDraftBody = z.object({
  owner_user_id: z.string().min(1).max(32),
  space_id: z.string().min(1).max(32),
  novel_id: z.string().min(1).max(32).optional(),
  title: z.string().trim().min(1).max(120),
  summary: z.string().max(2000).optional(),
  kind: z.number().int().min(1).max(3).optional(),
  price_credits: z.number().int().min(0).max(10_000_000).optional(),
  preorder_price_credits: z.number().int().min(0).max(10_000_000).nullable().optional(),
});

const categoryBody = z.object({ name: z.string().trim().min(1).max(40), sort: z.number().int().min(0).max(9999).optional() });
const categoryPatch = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  sort: z.number().int().min(0).max(9999).optional(),
  status: z.number().int().min(1).max(2).optional(),
});

const tagBody = z.object({ name: z.string().trim().min(1).max(40) });

const promotionBody = z.object({
  slot: z.string().trim().min(1).max(32).optional(),
  title: z.string().trim().min(1).max(120),
  image_uri: z.string().max(2048).optional(),
  link_uri: z.string().max(2048).optional(),
  sort: z.number().int().min(0).max(9999).optional(),
  starts_at: z.string().datetime().optional(),
  ends_at: z.string().datetime().optional(),
});

const promotionPatch = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  image_uri: z.string().max(2048).optional(),
  link_uri: z.string().max(2048).optional(),
  sort: z.number().int().min(0).max(9999).optional(),
  status: z.number().int().min(1).max(2).optional(),
  starts_at: z.string().datetime().nullable().optional(),
  ends_at: z.string().datetime().nullable().optional(),
});

const withdrawalReviewBody = z.object({
  result: z.enum(["approved", "rejected"]),
  review_note: z.string().max(500).optional(),
});

const payoutBody = z.object({
  /** 渠道侧打款流水号（运营在支付宝/微信后台打完款后回填，用于对账） */
  channel_refund_no: z.string().max(128).optional(),
  review_note: z.string().max(500).optional(),
});

// 全局用户 AuthGuard 跳过；本控制器由 AdminGuard 独立鉴权（与 AdminController 同模式）
@Public()
@UseGuards(AdminGuard)
@Controller("ops/market")
export class MarketAdminController {
  constructor(@Inject(MarketService) private readonly market: MarketService) {}

  // ── 作品审核 ─────────────────────────────────────────────

  /** 1. 作品列表（默认待审；rt:105） */
  @Get("scripts/list")
  list(@Query() query: unknown) {
    return this.market.adminListWorks(parseOrThrow(listQuery, query ?? {}));
  }

  /** 2. 看板（rt:102）：各状态计数 + 成交额 + 抽成 + 待处理提现 */
  @Get("dashboard/scripts")
  dashboard() {
    return this.market.adminDashboard();
  }

  /** 3. 作品详情（运营视角） */
  @Get("scripts/:id")
  detail(@Param("id") id: string) {
    return this.market.adminWorkDetail(id);
  }

  /** 4. 待审列表（等价 `scripts/list?status=2`，保留独立路径便于运营书签） */
  @Get("scripts/pending")
  pending(@Query() query: unknown) {
    const q = parseOrThrow(pageQuery.extend({ keyword: z.string().max(100).optional() }), query ?? {});
    return this.market.adminListWorks({ ...q, status: 2 });
  }

  /** 5. 双段式第一段：把作品送进审核队列（rt:109） */
  @Post("scripts/:id/submit-review")
  submitReview(@Req() req: AdminRequest, @Param("id") id: string) {
    return this.market.adminSubmitReview(id, req.adminAuth?.adminId);
  }

  /** 6. 双段式第二段：出审核结论（rt:107）—— 通过需/驳回都要 audit_note 留痕 */
  @Post("scripts/:id/review-result")
  reviewResult(@Req() req: AdminRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(reviewBody, body ?? {});
    // 驳回必须给理由：否则创作者只能看到"被驳回"而无法改，运营侧也失去可追溯性
    if (input.result === "rejected" && (input.audit_note ?? "").trim() === "") {
      throw new AppError(ErrorCode.INVALID_PARAM, "audit_note is required when rejecting a work", {
        field: "audit_note",
      });
    }
    return this.market.adminReviewResult(id, input, req.adminAuth?.adminId);
  }

  /** 7. 原始剧本溯源（rt:108）：只给结构与来源，不给全文 */
  @Get("scripts/:id/source-original-script")
  sourceOriginalScript(@Param("id") id: string) {
    return this.market.adminSourceOriginalScript(id);
  }

  /** 8. 运营代存草稿（rt:106） */
  @Post("scripts/save-draft")
  saveDraft(@Body() body: unknown) {
    return this.market.adminSaveDraft(parseOrThrow(saveDraftBody, body ?? {}));
  }

  // ── 分类 / 标签（rt:100-101、:110-111）────────────────────

  /**
   * 9. 分类列表
   *
   * 第 94 批：补 `keyword`（竞品 query `parent_id/keyword/page/page_size`）。
   * `parent_id` 有意不接 —— 我方 `market_categories` 是平表无该列，接了恒空（见 service 注释）。
   */
  @Get("categories")
  categories(@Query() query: unknown) {
    return this.market.adminCategories(
      parseOrThrow(z.object({ keyword: z.string().max(100).optional() }), query ?? {}),
    );
  }

  /** 10. 建分类 */
  @Post("categories")
  createCategory(@Body() body: unknown) {
    return this.market.adminCreateCategory(parseOrThrow(categoryBody, body ?? {}));
  }

  /** 11. 改分类 */
  @Patch("categories/:id")
  patchCategory(@Param("id") id: string, @Body() body: unknown) {
    return this.market.adminPatchCategory(id, parseOrThrow(categoryPatch, body ?? {}));
  }

  /** 12. 删分类（同时清掉作品上的引用，避免悬空筛选 id） */
  @Delete("categories/:id")
  deleteCategory(@Param("id") id: string) {
    return this.market.adminDeleteCategory(id);
  }

  /**
   * 13. 标签列表
   *
   * 第 94 批：补 `keyword`（竞品 query 是 `keyword/status/page/page_size`）。
   * `status` 有意不接 —— `market_tags` 没有 status 列，接了只会恒空（见 service 注释）。
   */
  @Get("tags")
  tags(@Query() query: unknown) {
    return this.market.adminTags(parseOrThrow(z.object({ keyword: z.string().max(100).optional() }), query ?? {}));
  }

  /** 14. 建标签 */
  @Post("tags")
  createTag(@Body() body: unknown) {
    return this.market.adminCreateTag(parseOrThrow(tagBody, body ?? {}));
  }

  /**
   * 14b. 改标签名（第 83 批）。
   *
   * 竞品是 `PUT /v1/rmadminsrv/novel_market/tags/{tag_id}`；我方统一用 PATCH 做局部更新
   * （分类/推广位同风格），方法差异登记在 `competitor-route-parity.spec.ts` 的 DEVIATIONS。
   */
  @Patch("tags/:id")
  patchTag(@Param("id") id: string, @Body() body: unknown) {
    return this.market.adminPatchTag(id, parseOrThrow(tagBody, body ?? {}));
  }

  /** 15. 删标签 */
  @Delete("tags/:id")
  deleteTag(@Param("id") id: string) {
    return this.market.adminDeleteTag(id);
  }

  // ── 推广位（rt:103-104，写 promo_slots）───────────────────

  /**
   * 16. 推广位列表
   *
   * 第 94 批：补 `enabled`（竞品 query `enabled/page/page_size`），并去掉
   * `slot` 缺省时硬编码 `"market"` 的隐式选择（不指定 = 全部位）。
   */
  @Get("promotions")
  promotions(@Query() query: unknown) {
    const q = parseOrThrow(
      z.object({
        slot: z.string().max(32).optional(),
        enabled: z.coerce.number().int().min(1).max(2).optional(),
      }),
      query ?? {},
    );
    return this.market.adminPromotions(q);
  }

  /** 17. 建推广位 */
  @Post("promotions")
  createPromotion(@Body() body: unknown) {
    return this.market.adminCreatePromotion(parseOrThrow(promotionBody, body ?? {}));
  }

  /** 18. 改推广位 */
  @Patch("promotions/:id")
  patchPromotion(@Param("id") id: string, @Body() body: unknown) {
    return this.market.adminPatchPromotion(id, parseOrThrow(promotionPatch, body ?? {}));
  }

  /** 19. 停用推广位（软停，保留投放历史与计数） */
  @Delete("promotions/:id")
  deletePromotion(@Param("id") id: string) {
    return this.market.adminDeletePromotion(id);
  }

  // ── 提现审核（我方补充：状态机必须有人审）──────────────────

  /** 20. 提现申请列表 */
  @Get("withdrawals")
  withdrawals(@Query() query: unknown) {
    return this.market.adminWithdrawals(
      parseOrThrow(pageQuery.extend({ status: z.coerce.number().int().min(1).max(5).optional() }), query ?? {}),
    );
  }

  /** 21. 提现审核：通过（1→2）/ 驳回（1|2→4），跳步一律 400101 */
  @Post("withdrawals/:id/review")
  reviewWithdrawal(@Param("id") id: string, @Body() body: unknown) {
    return this.market.adminReviewWithdrawal(id, parseOrThrow(withdrawalReviewBody, body ?? {}));
  }

  /** 22. 打款回填：只允许 2 已通过 → 3 已打款（跳步 = 400101） */
  @Post("withdrawals/:id/payout")
  payout(@Param("id") id: string, @Body() body: unknown) {
    return this.market.adminPayoutWithdrawal(id, parseOrThrow(payoutBody, body ?? {}));
  }
}
