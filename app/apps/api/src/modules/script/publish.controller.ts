import { Controller, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Public } from "../../common/public.decorator";
import { clientIp } from "../../common/client-ip";
import { PublishService } from "./publish.service";

/**
 * ReelFlow 公开播放端点（`/v1/watch/:token`）。
 *
 * 为什么单独一个 controller 而不是塞进 `ScriptController`：
 * 这两个端点是**唯一不带登录态**的 script 域入口，和"项目管理"那一片的鉴权/权限前置
 * 完全不同（后者每条都要 `req.auth` + 空间隔离）。混在一起最容易在后续重构时
 * 顺手给它套上 `AuthedRequest`，把公开页打死；分开写 + 两个方法都标 `@Public()`，
 * 评审时一眼能看出"这是能力式授权（token 即凭据）"。
 *
 * 边界（本批）：
 * - 只有**只读**（播放信息）与**计数**（播放量），不碰 `publish`/`unpublish` 状态机；
 * - 响应里不含 space/user/积分等内部字段（见 `PublishService.publicWatch` 注释）；
 * - 计数只落 Redis（`timeline_publications` 无 view_count 列，本批不改 schema）。
 */
@Controller()
export class PublishPublicController {
  constructor(@Inject(PublishService) private readonly publish: PublishService) {}

  /** 公开播放信息：只认 token；token 无效 / 已下架 / 转码中 各有明确 reason */
  @Public()
  @Get("watch/:token")
  async watch(@Param("token") token: string) {
    return this.publish.publicWatch(token);
  }

  /**
   * 播放计数：同 token + 同 IP 5 分钟内只算一次。
   * 响应里 `counted` 明确表达"这次是否真的 +1"（前端不要假装每次都加）。
   */
  @Public()
  @Post("watch/:token/view")
  async view(@Param("token") token: string, @Req() req: FastifyRequest) {
    return this.publish.recordView(token, clientIp(req));
  }
}
