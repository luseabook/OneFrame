import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { FleetService } from "./fleet.service";

const bindSchema = z.object({ token: z.string().min(16).max(512) });

const poolSchema = z.object({
  lifecycle: z.enum(["session", "on_demand", "always_on", "scheduled"]).optional(),
  idle_minutes: z.number().int().min(1).max(240).optional(),
  gpu_spec: z.enum(["v-48g", "4090D", "5090-p", "h800", "pro6000-p", "v-32g-p"]).optional(),
  budget_daily_cents: z.number().int().min(0).max(10_000_000).optional(),
  budget_month_cents: z.number().int().min(0).max(100_000_000).optional(),
  image_source: z.enum(["app", "private", "community"]).optional(),
  image_uuid: z.string().min(1).max(128).optional(),
  application_uuid: z.string().min(1).max(64).optional(),
  application_version: z.string().min(1).max(32).optional(),
});

/**
 * 「我的算力」用户侧接口（docs/02-architecture/autodl-integration.md §2.5）。
 * 全部挂在 /v1/compute 下；Token 只进不出（响应只有末 4 位）。
 */
@Controller("compute")
export class FleetController {
  constructor(@Inject(FleetService) private readonly fleet: FleetService) {}

  @Get("summary")
  async summary(@Req() req: AuthedRequest) {
    return this.fleet.summary(req.auth!.userId);
  }

  @Post("account")
  async bind(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(bindSchema, body);
    return this.fleet.bind(req.auth!.userId, req.auth?.spaceId ?? "", input.token);
  }

  @Post("account/test")
  async test(@Req() req: AuthedRequest) {
    return this.fleet.testToken(req.auth!.userId);
  }

  @Delete("account")
  async unbind(@Req() req: AuthedRequest) {
    await this.fleet.unbind(req.auth!.userId);
    return { ok: true };
  }

  @Patch("pool")
  async updatePool(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = parseOrThrow(poolSchema, body);
    await this.fleet.updatePool(req.auth!.userId, {
      lifecycle: input.lifecycle,
      idleMinutes: input.idle_minutes,
      gpuSpec: input.gpu_spec,
      dailyBudgetCents: input.budget_daily_cents,
      monthBudgetCents: input.budget_month_cents,
      imageSource: input.image_source,
      imageUuid: input.image_uuid,
      applicationUuid: input.application_uuid,
      applicationVersion: input.application_version,
    });
    return { ok: true };
  }

  /** 手动开机：返回节点 id；真正"就绪"由网关心跳回写 */
  @Post("nodes")
  async startNode(@Req() req: AuthedRequest) {
    return this.fleet.startNode(req.auth!.userId);
  }

  @Post("nodes/:id/stop")
  async stopNode(@Req() req: AuthedRequest, @Param("id") id: string) {
    await this.fleet.stopNode(req.auth!.userId, id);
    return { ok: true };
  }

  @Get("bills")
  async bills(@Req() req: AuthedRequest, @Query("limit") limit?: string) {
    return this.fleet.bills(req.auth!.userId, Number(limit ?? 20));
  }
}