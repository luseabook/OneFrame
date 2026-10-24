import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { reportResolveSchema } from "@app/shared";
import { Public } from "../../common/public.decorator";
import { parseOrThrow } from "../../common/zod";
import { BillingService } from "../billing/billing.service";
import { AdminAuthService } from "./admin-auth.service";
import { AdminGuard } from "./admin.guard";
import { AdminService } from "./admin.service";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

// 退款（api-spec §10.5）：本期仅全额退款；amount_cents 只用于声明/校验，不等于订单金额直接 400101
const refundOrderSchema = z.object({
  reason: z.string().trim().max(200).optional(),
  amount_cents: z.number().int().positive().optional(),
});

const modelPatchSchema = z.object({
  visible: z.boolean().optional(),
  sort: z.number().int().min(0).max(9999).optional(),
});

const pricePatchSchema = z.object({
  credits: z.number().int().min(0).optional(),
  strikeCredits: z.number().int().min(0).optional(),
  memberCredits: z.number().int().min(0).nullable().optional(),
  timeLimitedCredits: z.number().int().min(0).nullable().optional(),
});

@Controller("ops/admin")
export class AdminAuthController {
  constructor(@Inject(AdminAuthService) private readonly auth: AdminAuthService) {}

  @Public()
  @Post("login")
  async login(@Body() body: unknown) {
    const input = parseOrThrow(loginSchema, body);
    return this.auth.login(input.username, input.password);
  }
}

// 全局用户 AuthGuard 跳过；本控制器由 AdminGuard 独立鉴权
@Public()
@UseGuards(AdminGuard)
@Controller("ops/admin")
export class AdminController {
  constructor(
    @Inject(AdminService) private readonly admin: AdminService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  @Get("dashboard")
  dashboard() {
    return this.admin.dashboard();
  }

  @Get("queues")
  queues() {
    return this.admin.queues();
  }

  @Get("task-metrics")
  taskMetrics() {
    return this.admin.taskMetrics();
  }

  @Get("failed-tasks.csv")
  async failedTasksCsv(@Res() res: FastifyReply): Promise<void> {
    const csv = await this.admin.failedTasksCsv();
    res
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="failed-tasks.csv"')
      .send(csv);
  }

  @Get("funnel")
  funnel() {
    return this.admin.funnel();
  }

  @Get("reports")
  reports(
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
  ) {
    return this.admin.listReports(Number(page ?? 1), Number(pageSize ?? 20), status ? Number(status) : undefined);
  }

  @Post("reports/:id/resolve")
  resolveReport(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest & { adminAuth?: { adminId: string } },
  ) {
    const input = parseOrThrow(reportResolveSchema, body);
    return this.admin.resolveReport(id, req.adminAuth?.adminId ?? "", input.action, input.note);
  }

  @Get("models")
  models() {
    return this.admin.listModels();
  }

  @Patch("models/:id")
  updateModel(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updateModel(id, parseOrThrow(modelPatchSchema, body));
  }

  @Get("model-prices")
  prices(
    @Query("model_id") modelId?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
  ) {
    return this.admin.listPrices(modelId, Number(page ?? 1), Number(pageSize ?? 20));
  }

  @Patch("model-prices/:id")
  updatePrice(@Param("id") id: string, @Body() body: unknown) {
    return this.admin.updatePrice(id, parseOrThrow(pricePatchSchema, body));
  }

  @Get("tasks")
  tasks(@Query("status") status?: string, @Query("page") page?: string, @Query("page_size") pageSize?: string) {
    return this.admin.listTasks(Number(page ?? 1), Number(pageSize ?? 20), status ? Number(status) : undefined);
  }

  @Get("exports")
  exports(@Query("page") page?: string, @Query("page_size") pageSize?: string) {
    return this.admin.listExports(Number(page ?? 1), Number(pageSize ?? 20));
  }

  @Get("shares")
  shares(@Query("page") page?: string, @Query("page_size") pageSize?: string) {
    return this.admin.listShares(Number(page ?? 1), Number(pageSize ?? 20));
  }

  @Post("shares/:id/revoke")
  revokeShare(@Param("id") id: string) {
    return this.admin.revokeShare(id);
  }

  // ── 订单 / 退款（api-spec §10.5；运营审核后操作，工单与退款记录留痕） ──

  @Get("orders")
  orders(@Query("status") status?: string, @Query("page") page?: string, @Query("page_size") pageSize?: string) {
    return this.admin.listOrders(Number(page ?? 1), Number(pageSize ?? 20), status ? Number(status) : undefined);
  }

  @Post("orders/:id/refund")
  refundOrder(
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: FastifyRequest & { adminAuth?: { adminId: string; username?: string } },
  ) {
    const input = parseOrThrow(refundOrderSchema, body ?? {});
    return this.billing.refundOrder({
      orderId: id,
      reason: input.reason,
      amountCents: input.amount_cents,
      operator: req.adminAuth?.username ?? req.adminAuth?.adminId,
    });
  }
}
