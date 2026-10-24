import { Body, Controller, Inject, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { reportCreateSchema } from "@app/shared";
import { Public } from "../../common/public.decorator";
import { clientIp } from "../../common/client-ip";
import { parseOrThrow } from "../../common/zod";
import { ReportsService } from "./reports.service";

@Controller("share")
export class PublicReportController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @Public()
  @Post(":token/report")
  async report(@Param("token") token: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    const input = parseOrThrow(reportCreateSchema, body);
    return this.reports.create(token, input, clientIp(req));
  }
}
