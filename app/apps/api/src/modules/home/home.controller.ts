import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { TeamService } from "../team/team.service";
import { HomeService, type AbView, type HomeConfigView, type UnreadView } from "./home.service";

/**
 * 首页域（模块 #1 收尾）：配置驱动 / 未读长轮询 / AB 实验位。
 *
 * 三条路由都需要登录：`/home` 页面在 `requiresAuth` 之后，且 space 级运营覆盖
 * 与个人未读/AB 都带租户或用户维度——公开化没有收益，只有越权读风险。
 */
@Controller("home")
export class HomeController {
  constructor(
    @Inject(HomeService) private readonly home: HomeService,
    @Inject(TeamService) private readonly team: TeamService,
  ) {}

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
