import { Body, Controller, Get, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { Public } from "../../common/public.decorator";
import type { AuthedRequest } from "../../common/auth.types";
import { BillingService } from "./billing.service";

@Controller()
export class BillingController {
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  /** SKU 目录（公开，落地页/定价页可展示） */
  @Public()
  @Get("billing/skus")
  async skus() {
    return this.billing.listSkus();
  }

  /** 下单 */
  @Post("billing/orders")
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = (body ?? {}) as { sku?: string; channel?: string };
    if (!input.sku) {
      return { code: 400101, msg: "sku is required", data: null };
    }
    const channel = (input.channel ?? "mock") as "wechat" | "alipay" | "mock";
    return this.billing.createOrder(req.auth?.spaceId ?? "", req.auth?.userId ?? "", {
      sku: input.sku,
      channel,
    });
  }

  /** 订单状态轮询 */
  @Get("billing/orders/:id")
  async detail(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.billing.getOrder(req.auth?.spaceId ?? "", id);
  }

  /** 用户订单历史 */
  @Get("billing/orders")
  async list(@Req() req: AuthedRequest, @Query("page") page?: string, @Query("page_size") pageSize?: string) {
    return this.billing.listOrders(req.auth?.spaceId ?? "", Number(page ?? 1), Number(pageSize ?? 20));
  }

  /** 关闭未支付订单 */
  @Post("billing/orders/:id/close")
  async close(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.billing.closeOrder(req.auth?.spaceId ?? "", id);
  }

  /**
   * 渠道支付回调（服务端到服务端，不在用户契约内）。
   * 生产必须校验签名；当前为骨架实现，PAYMENT_LIVE 未开时仅接受 mock 渠道。
   */
  @Public()
  @Post("billing/notify/:channel")
  async notify(@Param("channel") channel: string, @Body() body: unknown) {
    const payload = (body ?? {}) as {
      order_id?: string;
      channel_order_id?: string;
      amount_cents?: number;
      signature?: string;
    };
    if (!payload.channel_order_id) {
      return { code: 400101, msg: "channel_order_id is required", data: null };
    }
    const res = await this.billing.markPaid({
      orderId: payload.order_id,
      channel,
      channelOrderId: payload.channel_order_id,
      amountCents: payload.amount_cents,
    });
    return res;
  }

  /**
   * mock 渠道"我已完成支付"（仅联调）。
   * 真实渠道下前端不应调用此端点，由 notify 回调驱动入账。
   */
  @Post("billing/orders/:id/mock-pay")
  async mockPay(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.billing.markPaid({
      orderId: id,
      channel: "mock",
      channelOrderId: `mock-${id}-${Date.now()}`,
    });
  }
}
