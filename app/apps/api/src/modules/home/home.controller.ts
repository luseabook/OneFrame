import { Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { Public } from "../../common/public.decorator";
import { TokenService } from "../auth/token.service";
import { TeamService } from "../team/team.service";
import { HomeService, type AbView, type HomeConfigView, type UnreadView } from "./home.service";

/**
 * 首页域（模块 #1 收尾）：配置驱动 / 未读长轮询 / AB 实验位 / 运营位打点。
 *
 * 读接口（config/unread/ab）需要登录：`/home` 页面在 `requiresAuth` 之后，且 space 级
 * 运营覆盖与个人未读/AB 都带租户或用户维度——公开化没有收益，只有越权读风险。
 *
 * 唯一的例外是**运营位打点**（`promo/:id/view|click`）：公开是产品要求——
 * 分享出去的首页/未登录落地页也会展示 banner，打点不能因为没登录就丢。
 * 它只做「计数器 +1」，不返回任何租户数据，且 5 分钟去重（见 HomeService.trackPromo）。
 */
@Controller("home")
export class HomeController {
  constructor(
    @Inject(HomeService) private readonly home: HomeService,
    @Inject(TeamService) private readonly team: TeamService,
    @Inject(TokenService) private readonly tokens: TokenService,
  ) {}

  /** 公开打点里的"可选身份"：带了有效 access token 就按用户去重，否则按匿名访客（ip+UA 哈希） */
  private actor(req: AuthedRequest): { userId: string | null; ip: string | null; userAgent: string | null } {
    let userId: string | null = null;
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      try {
        userId = this.tokens.verifyAccess(header.slice(7)).sub;
      } catch {
        // 过期/伪造 token 不影响打点：降级成匿名访客，绝不因为打点失败影响首页渲染
        userId = null;
      }
    }
    const rawAgent = req.headers["user-agent"];
    return {
      userId,
      ip: req.ip ?? null,
      userAgent: typeof rawAgent === "string" ? rawAgent.slice(0, 200) : null,
    };
  }

  /**
   * 运营位曝光/点击打点（公开）。
   *
   * 为什么用 POST 而不是 GET：打点有副作用（计数 +1），GET 会被浏览器/爬虫预取
   * （`<link rel=prefetch>`、安全扫描器）凭空刷高曝光数；POST 不会被预取。
   */
  @Public()
  @Post("promo/:id/view")
  async promoView(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.home.trackPromo(id, "view", this.actor(req));
  }

  @Public()
  @Post("promo/:id/click")
  async promoClick(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.home.trackPromo(id, "click", this.actor(req));
  }

  /**
   * 首页板块配置：space 覆盖 > global > 内置默认（未配置也是成功，标 source=default）。
   *
   * 为什么需要登录：space 覆盖层属于该空间的运营配置，公开端点若接受 `?space_id=`
   * 就等于让任何人读别家的运营位安排。`/home` 页面本身在 `requiresAuth` 之后，
   * 公开访问没有收益，所以这里直接用登录态解析 space（不读 query）。
   */
  @Get("config")
  async config(@Req() req: AuthedRequest): Promise<HomeConfigView> {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.home.config(auth.spaceId);
  }

  /**
   * 未读长轮询：最多挂 `min(timeout_ms, 25s)`，有增量立即返回，超时返回空 items。
   *
   * 可中断：客户端断开时 Fastify 的 `req.raw` 触发 `close`，这里通过 `shouldStop`
   * 让轮询循环在 ≤200ms 内退出并释放（不是等满 25s 才结束）。
   */
  @Get("unread")
  async unread(
    @Req() req: AuthedRequest,
    @Query("since") since?: string,
    @Query("timeout_ms") timeoutMs?: string,
  ): Promise<UnreadView> {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    let closed = false;
    const onClose = (): void => {
      closed = true;
    };
    req.raw.on("close", onClose);
    try {
      return await this.home.unread(auth.spaceId, auth.userId, {
        since,
        timeoutMsRaw: timeoutMs,
        shouldStop: () => closed,
      });
    } finally {
      req.raw.off("close", onClose);
    }
  }

  /** AB 实验位：无运行中实验 → active:false（不伪造变体） */
  @Get("ab")
  async ab(@Req() req: AuthedRequest, @Query("key") key?: string): Promise<AbView> {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    if (!key) throw new AppError(ErrorCode.INVALID_PARAM, "key is required", { field: "key" });
    // 空间成员校验：AB 命中会写库（ab_hits），必须先确认是本空间成员
    await this.team.requireMember(auth.spaceId, auth.userId);
    return this.home.ab(auth.userId, key);
  }
}
