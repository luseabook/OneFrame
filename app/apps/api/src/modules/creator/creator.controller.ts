import { Body, Controller, Get, Inject, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { CreatorService, EFFECT_VALUES } from "./creator.service";
import type { TeamCtx } from "../op/op.service";

/**
 * 创作者中心（crc）控制器 —— 对照参照产品 `/web/v1/crc/*` 30 条（`rt:275-304`）。
 *
 * 逐条映射（竞品路径 → 我方路径）见 `creator.service.ts` 各方法注释与
 * `_acceptance/_team/report-eco-creator.md` 的对照表。路径全部照抄竞品命名，
 * 只把 `/web/v1` 前缀去掉（我方网关就是 `/v1`）。
 *
 * 权限：每条都先 `requireMember`（非成员 403101）。作品归属判定在 service 内部完成，
 * 控制器不重复判断——两处判断必然漂移，而这里的资产归属是越权高发点。
 */

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const pageBody = pageQuery;

/**
 * 「我的作品」列表筛选：GET 走 query、POST 走 body，规则必须完全一致。
 * 抽出来是因为两条路由（`assets/me` 的 GET 与 POST）共用它——
 * 复制一份 zod 的后果是两边漂移，而漂移只有调用方才会发现。
 */
const myAssetsSchema = z.object({
  status: z.coerce.number().int().min(1).max(5).optional(),
  kind: z.coerce.number().int().min(1).max(3).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const assetInputBody = z.object({
  title: z.string().min(1).max(80),
  summary: z.string().max(1000).optional(),
  kind: z.number().int().min(1).max(3).optional(),
  category: z.string().min(1).max(40).optional(),
  /** 效果标签：取值来自 `crc/effect/tree` 叶子（迁移 0033 新增列）；null = 清空 */
  effect: z.enum(EFFECT_VALUES as [string, ...string[]]).nullish(),
  cover_uri: z.string().max(500).nullish(),
  uri: z.string().max(500).nullish(),
});

const assetUpdateBody = assetInputBody.partial().extend({ asset_id: z.string().min(1) });

const statusActionBody = z.object({
  asset_id: z.string().min(1),
  action: z.enum(["submit", "resubmit", "offline", "approve", "reject"]),
  review_note: z.string().max(500).optional(),
});

const likeActionBody = z.object({
  asset_id: z.string().min(1),
  // 默认 like：竞品 `likes/action` 是单一动作端点，前端传"目标态"更明显，
  // 但为了兼容"只点一下"的调用方，缺省当 like（幂等，重复点不会重复计数）
  action: z.enum(["like", "unlike"]).optional(),
});

const reportBody = z.object({
  asset_id: z.string().min(1),
  reason: z.string().min(1).max(40),
  detail: z.string().max(500).optional(),
  contact: z.string().max(120).optional(),
});

const followActionBody = z.object({
  creator_user_id: z.string().min(1),
  action: z.enum(["follow", "unfollow"]).optional(),
});

const feedQuery = z.object({
  kind: z.coerce.number().int().min(1).max(3).optional(),
  q: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const resourceListBody = feedQuery.extend({
  category: z.string().max(40).optional(),
  effect: z.string().max(40).optional(),
});

@Controller("crc")
export class CreatorController {
  constructor(@Inject(CreatorService) private readonly creator: CreatorService) {}

  private async ctx(req: AuthedRequest): Promise<TeamCtx> {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.creator.requireMember(auth.spaceId, auth.userId);
  }

  // ── 资料 ─────────────────────────────────────────────────
  /** rt:303 `crc/user/info` */
  @Get("user/info")
  async userInfo(@Req() req: AuthedRequest) {
    return this.creator.profileInfo(await this.ctx(req));
  }

  /**
   * rt:303 `crc/user/info` 的 POST 形状。
   *
   * 竞品把"读自己的资料"写成 POST（`_acceptance/competitor_endpoints.tsv` 里是
   * `POST /web/v1/crc/user/info`），路径与语义都和 GET 完全一样，只是方法不同。
   * 这里保留两种方法：GET 是 REST 的正确形状，POST 是给「照竞品前端写的调用方」的别名。
   * body 一律忽略——资料只由登录身份决定，带参数进来也没有可读的东西。
   */
  @Post("user/info")
  async userInfoPost(@Req() req: AuthedRequest) {
    return this.creator.profileInfo(await this.ctx(req));
  }

  /** rt:304 `crc/user/update` */
  @Post("user/update")
  async userUpdate(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(
      z.object({
        nickname: z.string().min(1).max(30).optional(),
        bio: z.string().max(500).optional(),
        avatar_uri: z.string().max(500).nullish(),
      }),
      body ?? {},
    );
    return this.creator.updateProfile(m, b);
  }

  /** rt:302 `crc/user/incentive`（激励汇总，只读；发分在 op/campaign 走账本） */
  @Post("user/incentive")
  async userIncentive(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(pageBody, body ?? {});
    return this.creator.incentive(m, b.page ?? 1, b.page_size ?? 20);
  }

  // ── 关注 / 粉丝 ──────────────────────────────────────────
  /** rt:300 `crc/user/follows` */
  @Post("user/follows")
  async follows(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(pageBody, body ?? {});
    return this.creator.myFollows(m, b.page ?? 1, b.page_size ?? 20);
  }

  /** rt:299 `crc/user/fans` */
  @Post("user/fans")
  async fans(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(pageBody, body ?? {});
    return this.creator.myFans(m, b.page ?? 1, b.page_size ?? 20);
  }

  /** rt:301 `crc/user/follows/action`（幂等：重复关注返回同一态） */
  @Post("user/follows/action")
  async followAction(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(followActionBody, body ?? {});
    return this.creator.followAction(m, { creator_user_id: b.creator_user_id, action: b.action ?? "follow" });
  }

  // ── 信息流 / 公开作品 ────────────────────────────────────
  /** rt:294 `crc/home/list`（只有审核通过的作品可见） */
  @Get("home/list")
  async homeList(@Req() req: AuthedRequest, @Query() query: unknown) {
    await this.ctx(req);
    const q = parseOrThrow(feedQuery, query ?? {});
    return this.creator.publicFeed({ kind: q.kind, q: q.q, page: q.page, pageSize: q.page_size });
  }

  /** rt:298 `crc/resource/list`（POST 版信息流，带分类/效果筛选） */
  @Post("resource/list")
  async resourceList(@Req() req: AuthedRequest, @Body() body: unknown) {
    await this.ctx(req);
    const b = parseOrThrow(resourceListBody, body ?? {});
    // category 是真过滤（迁移 0025 给了 `creator_assets.category` + 组合索引）；
    // effect 是"展现层标签"，表里没有对应列，只做透传校验并显式说明未生效
    // 两个筛选现在都**真过滤**（category 迁移 0025、effect 迁移 0033）。
    // effect 先做白名单校验：未知值直接 400101，而不是查空结果让用户以为"没有这类作品"。
    if (b.effect && !EFFECT_VALUES.includes(b.effect)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "unknown effect", {
        field: "effect",
        supported: EFFECT_VALUES,
      });
    }
    const feed = await this.creator.publicFeed({
      kind: b.kind,
      category: b.category,
      effect: b.effect,
      q: b.q,
      page: b.page,
      pageSize: b.page_size,
    });
    return {
      ...feed,
      filters: {
        category: b.category ?? null,
        category_applied: Boolean(b.category),
        effect: b.effect ?? null,
        effect_applied: Boolean(b.effect),
      },
    };
  }

  /** rt:297 `crc/resource/info` */
  @Get("resource/info")
  async resourceInfo(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(z.object({ id: z.string().min(1) }), query ?? {});
    return this.creator.assetInfo(m, q.id);
  }

  /** rt:296 `crc/resource/action/status`（审核状态机） */
  @Post("resource/action/status")
  async resourceActionStatus(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.creator.changeAssetStatus(m, parseOrThrow(statusActionBody, body ?? {}));
  }

  // ── 我的作品 / 审核流 ────────────────────────────────────
  /** rt:286 `crc/assets/me` */
  @Get("assets/me")
  async assetsMe(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(myAssetsSchema, query ?? {});
    return this.creator.myAssets(m, { status: q.status, kind: q.kind, page: q.page, pageSize: q.page_size });
  }

  /** rt:286 `crc/assets/me` 的 POST 形状（竞品用 POST 传筛选条件，body 与 GET 的 query 同构） */
  @Post("assets/me")
  async assetsMePost(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(myAssetsSchema, body ?? {});
    return this.creator.myAssets(m, { status: b.status, kind: b.kind, page: b.page, pageSize: b.page_size });
  }

  /** rt:281 `crc/assets/auditing/list` */
  @Post("assets/auditing/list")
  async auditingList(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(pageBody, body ?? {});
    return this.creator.auditingList(m, b.page ?? 1, b.page_size ?? 20);
  }

  /** rt:280 `crc/assets/auditing/info` */
  @Post("assets/auditing/info")
  async auditingInfo(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(z.object({ asset_id: z.string().min(1) }), body ?? {});
    return this.creator.auditingInfo(m, b.asset_id);
  }

  /** rt:279 `crc/assets/audit-fail/del`（只删已驳回） */
  @Post("assets/audit-fail/del")
  async auditFailDel(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(z.object({ asset_id: z.string().min(1) }), body ?? {});
    return this.creator.deleteAuditFail(m, b.asset_id);
  }

  /** rt:282 `crc/assets/delete` */
  @Post("assets/delete")
  async assetsDelete(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(z.object({ asset_id: z.string().min(1) }), body ?? {});
    return this.creator.deleteAsset(m, b.asset_id);
  }

  /** rt:283 `crc/assets/download` */
  @Get("assets/download")
  async assetsDownload(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(z.object({ id: z.string().min(1) }), query ?? {});
    return this.creator.downloadInfo(m, q.id);
  }

  /** rt:289 `crc/assets/share` */
  @Post("assets/share")
  async assetsShare(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(z.object({ asset_id: z.string().min(1) }), body ?? {});
    return this.creator.share(m, b.asset_id);
  }

  /** rt:284 `crc/assets/likes`（给 asset_id = 谁赞了；不给 = 我赞过谁） */
  @Post("assets/likes")
  async assetsLikes(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(pageBody.extend({ asset_id: z.string().min(1).optional() }), body ?? {});
    return this.creator.likes(m, { assetId: b.asset_id, page: b.page, pageSize: b.page_size });
  }

  /** rt:285 `crc/assets/likes/action`（幂等） */
  @Post("assets/likes/action")
  async likesAction(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(likeActionBody, body ?? {});
    return this.creator.likeAction(m, { asset_id: b.asset_id, action: b.action ?? "like" });
  }

  /** rt:287 `crc/assets/report` */
  @Post("assets/report")
  async assetsReport(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.creator.report(m, parseOrThrow(reportBody, body ?? {}));
  }

  /** rt:288 `crc/assets/report/config`（举报原因服务端下发，不硬编码在前端） */
  @Get("assets/report/config")
  async reportConfig(@Req() req: AuthedRequest) {
    await this.ctx(req);
    return this.creator.reportConfig();
  }

  // ── 我方补充：创建 / 编辑 ────────────────────────────────
  /**
   * 作品创建 / 编辑。竞品 30 条 crc 端点里没有"创建作品"（它的上传走
   * `asset/workflows` 那条资源链，`rt:210-221`），我方没有等价上传链，
   * 故补两条最小端点并在回报里登记为"我方补充（待取证竞品创建路径）"。
   */
  @Post("assets/create")
  async assetsCreate(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.creator.createAsset(m, parseOrThrow(assetInputBody, body ?? {}));
  }

  @Post("assets/update")
  async assetsUpdate(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    return this.creator.updateAsset(m, parseOrThrow(assetUpdateBody, body ?? {}));
  }

  // ── 运营位 / 分类树 / 预览 ───────────────────────────────
  /** rt:290 `crc/banner_list?type=&scene=` */
  @Get("banner_list")
  async bannerList(@Req() req: AuthedRequest, @Query() query: unknown) {
    await this.ctx(req);
    const q = parseOrThrow(
      z.object({ type: z.string().max(20).optional(), scene: z.string().max(20).optional() }),
      query ?? {},
    );
    return { ...(await this.creator.bannerList(q.type)), scene: q.scene ?? null };
  }

  /** rt:295 `crc/pop_up?type=` */
  @Get("pop_up")
  async popUp(@Req() req: AuthedRequest, @Query() query: unknown) {
    await this.ctx(req);
    const q = parseOrThrow(z.object({ type: z.string().max(20).optional() }), query ?? {});
    return this.creator.popUp(q.type);
  }

  /** rt:291 `crc/category/tree` */
  @Get("category/tree")
  async categoryTree(@Req() req: AuthedRequest) {
    await this.ctx(req);
    return this.creator.categoryTree();
  }

  /** rt:292 `crc/effect/tree` */
  @Get("effect/tree")
  async effectTree(@Req() req: AuthedRequest) {
    await this.ctx(req);
    return this.creator.effectTree();
  }

  /** rt:293 `crc/file_preview` */
  @Get("file_preview")
  async filePreview(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(z.object({ id: z.string().min(1) }), query ?? {});
    return this.creator.filePreview(m, q.id);
  }

  /**
   * rt:293 `crc/file_preview` 的 POST 形状。
   *
   * 竞品用 POST 传 `id`；这里同时接受 body 与 query，body 优先——
   * 照竞品前端写的调用方只发 body，照我方文档写的调用方只发 query，两种都能通。
   */
  @Post("file_preview")
  async filePreviewPost(@Req() req: AuthedRequest, @Query() query: unknown, @Body() body: unknown) {
    const m = await this.ctx(req);
    const source = { ...(query as object | undefined), ...(body as object | undefined) };
    const b = parseOrThrow(z.object({ id: z.string().min(1) }), source);
    return this.creator.filePreview(m, b.id);
  }

  // ── 活动位（rt:275-278）────────────────────────────────────
  /** rt:276 `crc/activity/list`（我报名过的） */
  @Post("activity/list")
  async activityList(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(pageBody, body ?? {});
    return this.creator.activityList(m, b.page ?? 1, b.page_size ?? 20);
  }

  /** rt:277 `crc/activity/public`（可报名的公开活动） */
  @Post("activity/public")
  async activityPublic(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(pageBody, body ?? {});
    return this.creator.activityPublic(m, b.page ?? 1, b.page_size ?? 20);
  }

  /** rt:275 `crc/activity/info` */
  @Get("activity/info")
  async activityInfo(@Req() req: AuthedRequest, @Query() query: unknown) {
    const m = await this.ctx(req);
    const q = parseOrThrow(z.object({ id: z.string().min(1) }), query ?? {});
    return this.creator.activityInfo(m, q.id);
  }

  /** rt:278 `crc/activity/resource/list`（活动下的投稿作品） */
  @Post("activity/resource/list")
  async activityResourceList(@Req() req: AuthedRequest, @Body() body: unknown) {
    const m = await this.ctx(req);
    const b = parseOrThrow(pageBody.extend({ campaign_id: z.string().min(1) }), body ?? {});
    return this.creator.activityResourceList(m, b.campaign_id, b.page ?? 1, b.page_size ?? 20);
  }
}
