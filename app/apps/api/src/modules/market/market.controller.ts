import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { MarketService } from "./market.service";

/**
 * 剧本集市 C 端（买/看）+ 创作者侧（上架/收益/提现）控制器。
 *
 * 对照竞品 `/web/v1/df/novel_market/*` 29 端点（`routes.txt:601-629`，
 * 逐条映射见 `docs/01-product/_parts/d-commerce-account.md:391-402`、`:414-417`）。
 *
 * 路径划分（ADR-009：保留竞品域名划分以便 1:1 核对）：
 * - `/v1/market/scripts/*`        —— 集市浏览与交易（竞品 `df/novel_market/scripts/*`）
 * - `/v1/market/creator/*`        —— 创作者侧（竞品 `df/novel_market/creator/*`）
 * - `/v1/ops/market/*`            —— 运营后台（竞品 `/v1/rmadminsrv/novel_market/*`，
 *   物理隔离在另一个服务域，我方用 AdminGuard 隔离，见 market-admin.controller.ts）
 *
 * 鉴权：全局 `AuthGuard` 已保证「登录 + 是该 X-Space-Id 的成员」；本控制器不额外
 * `requireMember`（不 import TeamModule），原因与 `novel.module.ts` 相同：
 * 所有查询第一条件都是 `auth.spaceId`/`auth.userId`，越权面已经被数据条件锁死；
 * 唯一需要**跨 space** 的读取（买家读作者的本子内容）用 `assertEntitled` 显式判购买凭据。
 */

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional(),
});

const listScriptsQuery = pageQuery.extend({
  category_id: z.string().min(1).max(32).optional(),
  /** 逗号分隔或重复 query 参数都接受（前端多选常用 `?tag_ids=a,b`） */
  tag_ids: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const arr = Array.isArray(v) ? v : v.split(",");
      return arr.map((s) => s.trim()).filter((s) => s.length > 0);
    }),
  keyword: z.string().max(100).optional(),
  kind: z.coerce.number().int().min(1).max(3).optional(),
  owner_user_id: z.string().min(1).max(32).optional(),
});

const episodesQuery = z.object({
  start_episode_no: z.coerce.number().int().min(1).optional(),
  end_episode_no: z.coerce.number().int().min(1).optional(),
});

const agreementQuery = z.object({ kind: z.coerce.number().int().min(1).max(3).optional() });

const saveWorkBody = z.object({
  work_id: z.string().min(1).max(32).optional(),
  novel_id: z.string().min(1).max(32).optional(),
  title: z.string().trim().min(1).max(120),
  summary: z.string().max(2000).optional(),
  cover_uri: z.string().max(2048).optional(),
  kind: z.number().int().min(1).max(3).optional(),
  price_credits: z.number().int().min(0).max(10_000_000).optional(),
  preorder_price_credits: z.number().int().min(0).max(10_000_000).nullable().optional(),
  category_id: z.string().min(1).max(32).nullable().optional(),
  tag_ids: z.array(z.string().min(1).max(32)).max(20).optional(),
  /** 仅 `POST /creator/works` 生效（`/save` 强制留草稿） */
  submit: z.boolean().optional(),
});

const patchWorkBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  summary: z.string().max(2000).optional(),
  cover_uri: z.string().max(2048).optional(),
  kind: z.number().int().min(1).max(3).optional(),
  price_credits: z.number().int().min(0).max(10_000_000).optional(),
  preorder_price_credits: z.number().int().min(0).max(10_000_000).nullable().optional(),
  category_id: z.string().min(1).max(32).nullable().optional(),
  tag_ids: z.array(z.string().min(1).max(32)).max(20).optional(),
});

const parseBody = z.object({
  novel_id: z.string().min(1).max(32),
  work_id: z.string().min(1).max(32).optional(),
});

const withdrawBody = z.object({
  amount_credits: z.number().int().min(1).max(100_000_000).optional(),
  work_id: z.string().min(1).max(32).optional(),
  channel: z.enum(["alipay", "wechat", "bank"]).optional(),
  account_info: z.record(z.unknown()).optional(),
});

const revenuesQuery = pageQuery.extend({ status: z.coerce.number().int().min(1).max(3).optional() });

/** 从请求里取授权上下文（AuthGuard 已保证存在） */
function requireAuth(req: AuthedRequest) {
  const auth = req.auth;
  if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
  return auth;
}

@Controller("market")
export class MarketController {
  constructor(@Inject(MarketService) private readonly market: MarketService) {}

  // ── 一、集市浏览（公开可看，正文另需购买凭据）───────────────

  /** 1. 集市列表/搜索/分类/标签（rt:614） */
  @Get("scripts")
  async listScripts(@Req() req: AuthedRequest, @Query() query: unknown) {
    return this.market.listScripts(requireAuth(req), parseOrThrow(listScriptsQuery, query ?? {}));
  }

  /** 2. 集市配置（rt:620）：分类/标签/抽成/提现门槛 */
  @Get("scripts/config")
  config() {
    return this.market.marketConfig();
  }

  /** 3. 推广位（rt:621） */
  @Get("scripts/promotions")
  promotions() {
    return this.market.promotions();
  }

  /** 4. 作品详情（rt:625） */
  @Get("scripts/:id/detail")
  detail(@Param("id") id: string) {
    return this.market.scriptDetail(id);
  }

  /** 5. 内容树（rt:624）—— 需已购买 */
  @Get("scripts/:id/content-tree")
  contentTree(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.market.scriptContentTree(requireAuth(req), id);
  }

  /** 6. 角色卡（rt:623）—— 需已购买 */
  @Get("scripts/:id/characters")
  characters(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.market.scriptCharacters(requireAuth(req), id);
  }

  /** 7. 分集剧本（rt:627）—— 需已购买 */
  @Get("scripts/:id/episodes")
  episodes(@Req() req: AuthedRequest, @Param("id") id: string, @Query() query: unknown) {
    return this.market.scriptEpisodes(requireAuth(req), id, parseOrThrow(episodesQuery, query ?? {}));
  }

  /** 8. 增量时间戳（rt:629，语义待取证） */
  @Get("scripts/:id/timestamp")
  timestamp(@Param("id") id: string) {
    return this.market.scriptTimestamp(id);
  }

  /** 9. 作者（rt:617） */
  @Get("scripts/:id/author")
  author(@Param("id") id: string) {
    return this.market.scriptAuthor(id);
  }

  /** 10. 商务条款（rt:618） */
  @Get("scripts/:id/business")
  business(@Param("id") id: string) {
    return this.market.scriptBusiness(id);
  }

  /** 11. 创作者资料（rt:619） */
  @Get("scripts/:id/creator")
  creatorOfWork(@Param("id") id: string) {
    return this.market.scriptCreator(id);
  }

  /** 12. 协议正文（rt:615）：购买/预售/授权三类 */
  @Get("scripts/:id/agreement")
  agreement(@Param("id") id: string, @Query() query: unknown) {
    return this.market.scriptAgreement(id, parseOrThrow(agreementQuery, query ?? {}));
  }

  /** 13. 协议附件下载（rt:616）—— text/plain 直出，不包信封 */
  @Get("scripts/:id/agreement-file")
  async agreementFile(
    @Param("id") id: string,
    @Query() query: unknown,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.market.scriptAgreementFile(id, parseOrThrow(agreementQuery, query ?? {}));
    return this.sendText(reply, file.filename, file.content);
  }

  // ── 二、交易（钱走账本）──────────────────────────────────

  /** 14. 立即购买（我方新增：竞品把下单收敛在 preorder，见 service 里的偏离说明） */
  @Post("scripts/:id/buy")
  buy(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.market.buy(requireAuth(req), id);
  }

  /** 15. 预售定金（rt:628） */
  @Post("scripts/:id/preorder")
  preorder(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.market.preorder(requireAuth(req), id);
  }

  /** 16. 取消预售订单并退回定金（rt:622） */
  @Post("scripts/:id/cancelorder")
  cancelOrder(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.market.cancelOrder(requireAuth(req), id);
  }

  /** 17. 下载已购内容（rt:626）—— markdown 直出 */
  @Get("scripts/:id/download")
  async download(@Req() req: AuthedRequest, @Param("id") id: string, @Res() reply: FastifyReply) {
    const file = await this.market.download(requireAuth(req), id);
    return this.sendFile(reply, file.filename, file.content_type, file.content);
  }

  /** 18. 作品解析（task 要求：已购本子 → 只读结构） */
  @Post("scripts/:id/parse")
  parse(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.market.parsePurchased(requireAuth(req), id);
  }

  // ── 三、创作者侧 ─────────────────────────────────────────

  /** 19. 创作者资料（rt:601） */
  @Get("creator/profile")
  profile(@Req() req: AuthedRequest) {
    return this.market.creatorProfile(requireAuth(req));
  }

  /** 20. 我的作品列表（rt:604 GET） */
  @Get("creator/works")
  works(@Req() req: AuthedRequest, @Query() query: unknown) {
    return this.market.creatorWorks(
      requireAuth(req),
      parseOrThrow(pageQuery.extend({ status: z.coerce.number().int().min(1).max(6).optional() }), query ?? {}),
    );
  }

  /** 21. 上架（rt:604 POST）：可直接提交审核（`submit=true`） */
  @Post("creator/works")
  createWork(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(saveWorkBody, body ?? {});
    return this.market.creatorSaveWork(requireAuth(req), input, "create", input.submit === true);
  }

  /** 22. 存草稿（rt:612 `POST /creator/works/save`）：强制留草稿，忽略 submit */
  @Post("creator/works/save")
  saveWork(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(saveWorkBody, body ?? {});
    return this.market.creatorSaveWork(requireAuth(req), input, "save", false);
  }

  /** 23. 作品解析（rt:611 `POST /creator/works/parse`）：本子 → 上架表单建议值 */
  @Post("creator/works/parse")
  parseWork(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.market.creatorParseWork(requireAuth(req), parseOrThrow(parseBody, body ?? {}));
  }

  /** 24. 创作者数据（rt:613） */
  @Get("creator/works/stats")
  stats(@Req() req: AuthedRequest) {
    return this.market.creatorStats(requireAuth(req));
  }

  /** 25. 单作品（rt:605） */
  @Get("creator/works/:id")
  workDetail(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.market.creatorWorkDetail(requireAuth(req), id);
  }

  /** 26. 编辑作品（task 要求；竞品无独立 PATCH，语义并入 save） */
  @Patch("creator/works/:id")
  patchWork(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.market.creatorPatch(requireAuth(req), id, parseOrThrow(patchWorkBody, body ?? {}));
  }

  /** 27. 提交审核（rt:609） */
  @Post("creator/works/:id/submit")
  submit(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.market.creatorSubmit(requireAuth(req), id);
  }

  /** 28. 下架（rt:608） */
  @Post("creator/works/:id/offline")
  offline(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.market.creatorOffline(requireAuth(req), id);
  }

  /** 29. 创作者视角协议（rt:606） */
  @Get("creator/works/:id/agreement")
  creatorAgreement(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.market.creatorWorkAgreement(requireAuth(req), id);
  }

  /** 30. 创作者视角内容树（rt:607） */
  @Get("creator/works/:id/content-tree")
  creatorContentTree(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.market.creatorWorkContentTree(requireAuth(req), id);
  }

  /** 31. 收益明细（rt:602） */
  @Get("creator/revenues")
  revenues(@Req() req: AuthedRequest, @Query() query: unknown) {
    return this.market.creatorRevenues(requireAuth(req), parseOrThrow(revenuesQuery, query ?? {}));
  }

  /** 32. 收益总览（rt:603） */
  @Get("creator/revenues/overview")
  revenuesOverview(@Req() req: AuthedRequest) {
    return this.market.creatorRevenuesOverview(requireAuth(req));
  }

  /** 33. 以某作品收益名义提现（rt:610 `POST /creator/works/:nm_id/withdraw`） */
  @Post("creator/works/:id/withdraw")
  withdrawByWork(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: unknown) {
    const input = parseOrThrow(withdrawBody, body ?? {});
    return this.market.creatorWithdraw(requireAuth(req), { ...input, work_id: id });
  }

  /** 34. 账户维度提现（我方补充：竞品只有按作品提现，见 service 偏离说明） */
  @Post("creator/withdraw")
  withdraw(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.market.creatorWithdraw(requireAuth(req), parseOrThrow(withdrawBody, body ?? {}));
  }

  /** 35. 我的提现申请（我方补充：竞品该列表未在 C 端路由单列） */
  @Get("creator/withdrawals")
  withdrawals(@Req() req: AuthedRequest, @Query() query: unknown) {
    return this.market.creatorWithdrawals(
      requireAuth(req),
      parseOrThrow(pageQuery.extend({ status: z.coerce.number().int().min(1).max(5).optional() }), query ?? {}),
    );
  }

  /** 36. 撤销提现（状态机 1 待审 → 5 已撤销） */
  @Post("creator/withdrawals/:id/cancel")
  cancelWithdrawal(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.market.creatorCancelWithdrawal(requireAuth(req), id);
  }

  /** 文本直出（协议/正文下载）：统一 UTF-8 + 附件名，前端点一下就能存盘 */
  private sendText(reply: FastifyReply, filename: string, content: string) {
    return this.sendFile(reply, filename, "text/plain; charset=utf-8", content);
  }

  private sendFile(reply: FastifyReply, filename: string, contentType: string, content: string) {
    reply.header("content-type", contentType);
    reply.header("content-disposition", `attachment; filename="${filename}"`);
    return reply.send(content);
  }
}
