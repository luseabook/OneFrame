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

  @Post("credits/quote/batch")
  async quoteBatch(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(batchSchema, body);
    return this.credits.quoteBatch(input.items, req.auth?.spaceId ?? "");
  }
}
