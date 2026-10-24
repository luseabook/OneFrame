import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Req } from "@nestjs/common";
import { Public } from "../../common/public.decorator";
import type { AuthedRequest } from "../../common/auth.types";
import { AppError, ErrorCode } from "@app/shared";
import { env } from "../../config/env";
import { BillingService } from "./billing.service";
import {
  decryptWechatResource,
  verifyAlipaySignature,
  verifyWechatSignature,
  type WechatNotifyPayload,
} from "./payment-signature";

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
      throw new AppError(ErrorCode.INVALID_PARAM, "sku is required", { field: "sku" });
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
   * 微信支付 APIv3 回调。
   *
   * 安全策略（默认拒绝）：
   * 1) 未配置平台公钥 → 直接 401 拒绝（不允许"跳过验签"路径）
   * 2) 验签失败 → 401
   * 3) 解密失败 → 400
   * 4) 金额与订单快照不符 → 400（在 service 内校验）
   */
  @Public()
  @Post("billing/notify/wechat")
  async notifyWechat(
    @Body() body: WechatNotifyPayload,
    @Headers("wechatpay-timestamp") timestamp?: string,
    @Headers("wechatpay-nonce") nonce?: string,
    @Headers("wechatpay-signature") signature?: string,
  ) {
    if (!env.WECHAT_PLATFORM_PUBLIC_KEY) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "wechat platform public key not configured");
    }
    const verified = verifyWechatSignature({
      timestamp: timestamp ?? "",
      nonce: nonce ?? "",
      signature: signature ?? "",
      body: JSON.stringify(body ?? {}),
      platformPublicKeyPem: env.WECHAT_PLATFORM_PUBLIC_KEY,
    });
    if (!verified) throw new AppError(ErrorCode.UNAUTHORIZED, "wechat signature verification failed");

    const resource = body?.resource;
    if (!resource?.ciphertext || !resource?.nonce) {
      throw new AppError(ErrorCode.INVALID_PARAM, "missing resource.ciphertext/nonce");
    }
    const decoded = decryptWechatResource({
      ciphertext: resource.ciphertext,
      nonce: resource.nonce,
      associatedData: resource.associated_data,
      apiV3Key: env.WECHAT_API_V3_KEY ?? "",
    });
    if (!decoded) throw new AppError(ErrorCode.INVALID_PARAM, "wechat resource decrypt failed");

    const orderId = String(decoded.out_trade_no ?? "");
    const channelOrderId = String(decoded.transaction_id ?? "");
    const amount = (decoded.amount as { total?: number } | undefined)?.total;
    if (!orderId || !channelOrderId) {
      throw new AppError(ErrorCode.INVALID_PARAM, "missing out_trade_no/transaction_id");
    }
    return this.billing.markPaid({
      orderId,
      channel: "wechat",
      channelOrderId,
      amountCents: typeof amount === "number" ? amount : undefined,
    });
  }

  /**
   * 支付宝异步通知（form-urlencoded 转成对象由框架处理）。
   * 未配置支付宝公钥 → 拒绝；验签失败 → 拒绝。
   */
  @Public()
  @Post("billing/notify/alipay")
  async notifyAlipay(@Body() body: Record<string, string>) {
    if (!env.ALIPAY_PUBLIC_KEY) {
      throw new AppError(ErrorCode.UNAUTHORIZED, "alipay public key not configured");
    }
    const params = Object.fromEntries(
      Object.entries(body ?? {}).map(([k, v]) => [k, v === undefined || v === null ? "" : String(v)]),
    );
    const verified = verifyAlipaySignature({
      params,
      publicKeyPem: env.ALIPAY_PUBLIC_KEY,
      signType: params.sign_type,
    });
    if (!verified) throw new AppError(ErrorCode.UNAUTHORIZED, "alipay signature verification failed");

    // trade_status 只有 TRADE_SUCCESS / TRADE_FINISHED 才入账
    if (params.trade_status !== "TRADE_SUCCESS" && params.trade_status !== "TRADE_FINISHED") {
      return { ok: true, ignored: true, reason: `trade_status=${params.trade_status}` };
    }
    const orderId = params.out_trade_no;
    const channelOrderId = params.trade_no;
    if (!orderId || !channelOrderId) {
      throw new AppError(ErrorCode.INVALID_PARAM, "missing out_trade_no/trade_no");
    }
    // 支付宝金额单位是元，转为分
    const totalYuan = Number(params.total_amount ?? "0");
    const amountCents = Number.isFinite(totalYuan) ? Math.round(totalYuan * 100) : undefined;
    return this.billing.markPaid({
      orderId,
      channel: "alipay",
      channelOrderId,
      amountCents,
    });
  }

  /**
   * mock 渠道回调（仅联调）：模拟渠道侧异步通知，验证幂等入账与金额校验链路。
   * PAYMENT_LIVE=true 时禁用，生产环境只接受真实渠道回调。
   */
  @Public()
  @Post("billing/notify/mock")
  async notifyMock(@Body() body: unknown) {
    if (env.PAYMENT_LIVE) {
      throw new AppError(ErrorCode.FORBIDDEN, "mock notify disabled when PAYMENT_LIVE=true");
    }
    const payload = (body ?? {}) as {
      order_id?: string;
      channel_order_id?: string;
      amount_cents?: number;
    };
    if (!payload.channel_order_id) {
      throw new AppError(ErrorCode.INVALID_PARAM, "channel_order_id is required", {
        field: "channel_order_id",
      });
    }
    return this.billing.markPaid({
      orderId: payload.order_id,
      channel: "mock",
      channelOrderId: payload.channel_order_id,
      amountCents: payload.amount_cents,
    });
  }

  /**
   * mock 渠道"我已完成支付"（仅联调）。
   * PAYMENT_LIVE=true 时禁用，防止生产环境被绕过真实支付。
   */
  @Post("billing/orders/:id/mock-pay")
  async mockPay(@Req() req: AuthedRequest, @Param("id") id: string) {
    if (env.PAYMENT_LIVE) {
      throw new AppError(ErrorCode.FORBIDDEN, "mock pay disabled when PAYMENT_LIVE=true");
    }
    return this.billing.markPaid({
      orderId: id,
      channel: "mock",
      channelOrderId: `mock-${id}-${Date.now()}`,
    });
  }
}
