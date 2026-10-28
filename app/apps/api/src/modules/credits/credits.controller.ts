import { Body, Controller, Get, Post, Query, Req, Inject } from "@nestjs/common";
import { z } from "zod";
import { generationRequestSchema } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { CreditsService } from "./credits.service";

const batchSchema = z.object({
  items: z.array(generationRequestSchema).min(1).max(50),
});

@Controller()
export class CreditsController {
  constructor(@Inject(CreditsService) private readonly credits: CreditsService) {}

  @Post("credits/quote")
  async quote(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(generationRequestSchema, body);
    return this.credits.quote(input, req.auth?.spaceId ?? "");
  }

  @Get("credits/flows")
  async flows(
    @Req() req: AuthedRequest,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
    @Query("task_id") taskId?: string,
  ) {
    return this.credits.listFlows(req.auth?.spaceId ?? "", Number(page ?? 1), Number(pageSize ?? 20), taskId);
  }

  // ── 账号级积分视图（第 85 批：竞品 `GET /web/v1/user/credits*`）────────

  /** 余额（竞品 `GET /web/v1/user/credits`） */
  @Get("user/credits")
  async userCredits(@Req() req: AuthedRequest) {
    return this.credits.accountCredits(req.auth?.spaceId ?? "");
  }

  /**
   * 流水（竞品 `GET /web/v1/user/credits-log?page&page_size&event_type`）。
   * `event_type` 与竞品同名；映射到本产品的 7 种流水 kind，见 `CreditsService.flowKinds`。
   */
  @Get("user/credits-log")
  async userCreditsLog(
    @Req() req: AuthedRequest,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
    @Query("event_type") eventType?: string,
  ) {
    return this.credits.listFlows(
      req.auth?.spaceId ?? "",
      Number(page ?? 1),
      Number(pageSize ?? 20),
      undefined,
      this.credits.flowKinds(eventType),
    );
  }

  /** 看板（竞品 `GET /web/v1/user/credits-dashboard`） */
  @Get("user/credits-dashboard")
  async userCreditsDashboard(@Req() req: AuthedRequest) {
    return this.credits.creditsDashboard(req.auth?.spaceId ?? "");
  }

  /**
   * 看板分页流水（竞品 `GET /web/v1/user/credits-dashboard/flows?tab&page&page_size`）。
   * `tab` 是竞品的页签命名（全部/消耗/充值），映射同 `event_type`。
   */
  @Get("user/credits-dashboard/flows")
  async userCreditsDashboardFlows(
    @Req() req: AuthedRequest,
    @Query("tab") tab?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
  ) {
    return this.credits.listFlows(
      req.auth?.spaceId ?? "",
      Number(page ?? 1),
      Number(pageSize ?? 20),
      undefined,
      this.credits.flowKinds(tab),
    );
  }

  @Post("credits/quote/batch")
  async quoteBatch(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(batchSchema, body);
    return this.credits.quoteBatch(input.items, req.auth?.spaceId ?? "");
  }
}
