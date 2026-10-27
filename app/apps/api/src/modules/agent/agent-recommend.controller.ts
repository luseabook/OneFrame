import { Controller, Get, Inject, Req } from "@nestjs/common";
import { AppError, ErrorCode } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { AgentRecommendService } from "./agent-recommend.service";

/**
 * 推荐卡（竞品 `GET /web/v1/df/canvas/agent-recommend-cards`，`routes.txt:378`）。
 *
 * 路径取 `/agent-recommend-cards`：我方把 agent 域收在 `/v1/agent*` 下，
 * 推荐卡对应用户直接可用的创作入口，不限定画布（`/df/canvas` 是竞品的域名划分，
 * ADR-009 只要求"能 1:1 核对"，不要求把画布前缀也搬过来）。
 * 无参数：按登录空间最近项目/资产/会话选卡，空态给竞品那 4 张兜底卡。
 */
@Controller("agent-recommend-cards")
export class AgentRecommendController {
  constructor(@Inject(AgentRecommendService) private readonly recommend: AgentRecommendService) {}

  @Get()
  async list(@Req() req: AuthedRequest) {
    const auth = req.auth;
    if (!auth) throw new AppError(ErrorCode.UNAUTHORIZED, "login required");
    return this.recommend.cards(auth.spaceId);
  }
}
