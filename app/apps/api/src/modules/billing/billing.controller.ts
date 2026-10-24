import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { parse as parseFormUrlEncoded } from "node:querystring";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Public } from "../../common/public.decorator";
import type { AuthedRequest } from "../../common/auth.types";
import { clientIp } from "../../common/client-ip";
import { AppError, ErrorCode, isAppError } from "@app/shared";
import { env } from "../../config/env";
import { BillingService } from "./billing.service";
import { ChannelService } from "./channels/channel.service";
import type { PaymentMode } from "./channels/types";
import {
  decryptWechatResource,
  verifyAlipaySignature,
  verifyWechatSignature,
  type WechatNotifyPayload,
} from "./payment-signature";

/**
 * 渠道回调成功/失败响应体必须严格符合渠道协议（否则渠道无限重试）：
 * - 微信 APIv3：HTTP 200 + `{"code":"SUCCESS","message":"成功"}`；失败 `{"code":"FAIL","message":"..."}`
 * - 支付宝：HTTP 200 + 纯文本 `success`；失败纯文本 `failure`
 * 因此 notify 端点用 @Res 直写，绕过全局信封（EnvelopeInterceptor）与
 * 全局异常过滤器（AppError→HTTP200 信封）的语义。
 */
const WECHAT_SUCCESS_BODY = '{"code":"SUCCESS","message":"成功"}';
const ALIPAY_SUCCESS_BODY = "success";
const ALIPAY_FAILURE_BODY = "failure";

const CHANNELS = ["mock", "wechat", "alipay"] as const;
const PAYMENT_MODES: PaymentMode[] = ["native", "h5", "jsapi", "page", "precreate"];

type NotifyRequest = FastifyRequest & { rawBody?: Buffer };

@Controller()
export class BillingController {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    // 平台证书公钥按 Wechatpay-Serial 选择（轮换期可同时在线新旧证书）
    @Inject(ChannelService) private readonly channelService: ChannelService,
  ) {}

  /** SKU 目录（公开，落地页/定价页可展示） */
  @Public()
  @Get("billing/skus")
  async skus() {
    return this.billing.listSkus();
  }

  /** 可用支付渠道（公开）：前端据此决定展示 mock 一键付 / 微信二维码 / 支付宝跳转 */
  @Public()
  @Get("billing/channels")
  async channels() {
    return this.billing.listChannels();
  }

  /** 下单 */
  @Post("billing/orders")
  async create(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = (body ?? {}) as {
      sku?: unknown;
      channel?: unknown;
      mode?: unknown;
      openid?: unknown;
    };
    if (!input.sku || typeof input.sku !== "string") {
      throw new AppError(ErrorCode.INVALID_PARAM, "sku is required", { field: "sku" });
    }
    const channel = (input.channel ?? (env.PAYMENT_LIVE ? "" : "mock")) as string;
    if (!CHANNELS.includes(channel as (typeof CHANNELS)[number])) {
      throw new AppError(ErrorCode.INVALID_PARAM, "channel must be one of mock|wechat|alipay", {
        field: "channel",
      });
    }
    const mode = typeof input.mode === "string" ? input.mode : undefined;
    if (mode && !PAYMENT_MODES.includes(mode as PaymentMode)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "mode is invalid", { field: "mode", allowed: PAYMENT_MODES });
    }
    return this.billing.createOrder(req.auth?.spaceId ?? "", req.auth?.userId ?? "", {
      sku: input.sku,
      channel: channel as "wechat" | "alipay" | "mock",
      mode: mode as PaymentMode | undefined,
      openid: typeof input.openid === "string" ? input.openid : undefined,
      clientIp: clientIp(req),
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

  // ── 微信支付 APIv3 回调 ──────────────────────────────────────────────────

  /**
   * 微信支付 APIv3 回调。
   *
   * 关键点：验签签名串 `timestamp\nnonce\nbody\n` 里的 body 必须是**原始请求体字节**。
   * 用 JSON.stringify(解析后的对象) 会因空白/键序/数字格式差异导致验签失败（生产必踩），
   * 因此这里读 Fastify 的 rawBody（Nest 以 `rawBody: true` 注册解析器时保留）。
   *
   * 安全策略（默认拒绝）：未配置平台公钥 / 原始体缺失 / 验签失败 → 401；解密失败/字段缺失 → 400。
   */
  @Public()
  @Post("billing/notify/wechat")
  async notifyWechat(
    @Req() req: NotifyRequest,
    @Res() res: FastifyReply,
    @Headers("wechatpay-timestamp") timestamp?: string,
    @Headers("wechatpay-nonce") nonce?: string,
    @Headers("wechatpay-signature") signature?: string,
    @Headers("wechatpay-serial") serial?: string,
  ): Promise<void> {
    this.attachRequestId(res, req);
    const fail = (status: number, message: string): void =>
      this.sendJson(res, status, JSON.stringify({ code: "FAIL", message }));

    try {
      if (!this.channelService.hasWechatPlatformKeys) {
        fail(401, "wechat platform public key not configured");
        return;
      }
      // 证书轮换：按 Wechatpay-Serial 精确选择验签公钥；未知 serial 一律 401（默认拒绝）
      const platformPublicKey = this.channelService.wechatPlatformPublicKey(serial);
      if (!platformPublicKey) {
        fail(401, "unknown wechat platform certificate serial");
        return;
      }
      const rawBody = this.rawBodyText(req);
      if (!rawBody) {
        fail(401, "raw request body unavailable");
        return;
      }
      const verified = verifyWechatSignature({
        timestamp: timestamp ?? "",
        nonce: nonce ?? "",
        signature: signature ?? "",
        body: rawBody,
        platformPublicKeyPem: platformPublicKey,
      });
      if (!verified) {
        fail(401, "wechat signature verification failed");
        return;
      }

      let body: WechatNotifyPayload;
      try {
        body = JSON.parse(rawBody) as WechatNotifyPayload;
      } catch {
        fail(400, "invalid JSON body");
        return;
      }

      const resource = body?.resource;
      if (!resource?.ciphertext || !resource?.nonce) {
        fail(400, "missing resource.ciphertext/nonce");
        return;
      }
      const decoded = decryptWechatResource({
        ciphertext: resource.ciphertext,
        nonce: resource.nonce,
        associatedData: resource.associated_data,
        apiV3Key: env.WECHAT_API_V3_KEY ?? "",
      });
      if (!decoded) {
        fail(400, "wechat resource decrypt failed");
        return;
      }

      const orderId = String(decoded.out_trade_no ?? "");
      const channelOrderId = String(decoded.transaction_id ?? "");
      const amount = (decoded.amount as { total?: number } | undefined)?.total;
      if (!orderId || !channelOrderId) {
        fail(400, "missing out_trade_no/transaction_id");
        return;
      }
      await this.billing.markPaid({
        orderId,
        channel: "wechat",
        channelOrderId,
        amountCents: typeof amount === "number" ? amount : undefined,
      });
      this.sendJson(res, 200, WECHAT_SUCCESS_BODY);
    } catch (err) {
      fail(this.notifyHttpStatus(err), this.notifyMessage(err));
    }
  }

  // ── 支付宝异步通知 ──────────────────────────────────────────────────────

  /**
   * 支付宝异步通知（application/x-www-form-urlencoded）。
   *
   * 这里不依赖框架解析结果：用原始请求体 + node:querystring 自行解析，
   * 避免某些部署下 urlencoded 解析器缺失/被覆盖导致 `@Body()` 为空、验签必然失败。
   * 成功/失败响应必须是纯文本 `success` / `failure`。
   */
  @Public()
  @Post("billing/notify/alipay")
  async notifyAlipay(
    @Req() req: NotifyRequest,
    @Res() res: FastifyReply,
    @Body() body: Record<string, string>,
  ): Promise<void> {
    this.attachRequestId(res, req);
    const fail = (status: number): void => this.sendText(res, status, ALIPAY_FAILURE_BODY);

    try {
      if (!env.ALIPAY_PUBLIC_KEY) {
        fail(401);
        return;
      }
      const params = this.alipayNotifyParams(req, body);
      if (!params.sign) {
        fail(401);
        return;
      }
      const verified = verifyAlipaySignature({
        params,
        publicKeyPem: env.ALIPAY_PUBLIC_KEY,
        signType: params.sign_type,
      });
      if (!verified) {
        fail(401);
        return;
      }

      // trade_status 只有 TRADE_SUCCESS / TRADE_FINISHED 才入账；其余状态也要 ack，避免渠道持续重试
      if (params.trade_status !== "TRADE_SUCCESS" && params.trade_status !== "TRADE_FINISHED") {
        this.sendText(res, 200, ALIPAY_SUCCESS_BODY);
        return;
      }
      const orderId = params.out_trade_no;
      const channelOrderId = params.trade_no;
      if (!orderId || !channelOrderId) {
        fail(400);
        return;
      }
      // 支付宝金额单位是元，转为分
      const totalYuan = Number(params.total_amount ?? "0");
      const amountCents = Number.isFinite(totalYuan) ? Math.round(totalYuan * 100) : undefined;
      await this.billing.markPaid({ orderId, channel: "alipay", channelOrderId, amountCents });
      this.sendText(res, 200, ALIPAY_SUCCESS_BODY);
    } catch (err) {
      fail(this.notifyHttpStatus(err));
    }
  }

  // ── mock 渠道（仅联调） ──────────────────────────────────────────────────

  /**
   * mock 渠道回调（仅联调）：模拟渠道侧异步通知，验证幂等入账与金额校验链路。
   * PAYMENT_LIVE=true 时禁用（真实 HTTP 403），生产环境只接受真实渠道回调。
   */
  @Public()
  @Post("billing/notify/mock")
  async notifyMock(@Body() body: unknown) {
    if (env.PAYMENT_LIVE) {
      throw new HttpException("mock notify disabled when PAYMENT_LIVE=true", HttpStatus.FORBIDDEN);
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
   * PAYMENT_LIVE=true 时禁用（真实 HTTP 403），防止生产环境被绕过真实支付。
   */
  @Post("billing/orders/:id/mock-pay")
  async mockPay(@Req() req: AuthedRequest, @Param("id") id: string) {
    if (env.PAYMENT_LIVE) {
      throw new HttpException("mock pay disabled when PAYMENT_LIVE=true", HttpStatus.FORBIDDEN);
    }
    return this.billing.markPaid({
      orderId: id,
      channel: "mock",
      channelOrderId: `mock-${id}-${Date.now()}`,
    });
  }

  // ── 内部工具 ────────────────────────────────────────────────────────────

  /** 渠道回调也要带上 request_id（日志/排障链路），@Res 直写路径显式补 */
  private attachRequestId(res: FastifyReply, req: FastifyRequest): void {
    const id = (req as FastifyRequest & { id?: string }).id;
    if (id) res.header("x-request-id", id);
  }

  private rawBodyText(req: NotifyRequest): string | undefined {
    return req.rawBody ? req.rawBody.toString("utf8") : undefined;
  }

  /** 支付宝通知参数：优先用原始 urlencoded 体自行解析（不依赖框架解析器） */
  private alipayNotifyParams(req: NotifyRequest, body: Record<string, string> | undefined): Record<string, string> {
    const raw = this.rawBodyText(req);
    if (raw) {
      const parsed = parseFormUrlEncoded(raw);
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (value === undefined) continue;
        out[key] = Array.isArray(value) ? (value[0] ?? "") : value;
      }
      if (Object.keys(out).length > 0) return out;
    }
    return Object.fromEntries(
      Object.entries(body ?? {}).map(([k, v]) => [k, v === undefined || v === null ? "" : String(v)]),
    );
  }

  private sendJson(res: FastifyReply, status: number, body: string): void {
    res.status(status).header("content-type", "application/json; charset=utf-8").send(body);
  }

  private sendText(res: FastifyReply, status: number, body: string): void {
    res.status(status).header("content-type", "text/plain; charset=utf-8").send(body);
  }

  private notifyHttpStatus(err: unknown): number {
    if (isAppError(err)) {
      if (err.code === ErrorCode.INVALID_PARAM) return 400;
      if (err.code === ErrorCode.NOT_FOUND) return 404;
      return 500;
    }
    return 500;
  }

  private notifyMessage(err: unknown): string {
    if (isAppError(err)) return err.message;
    return "internal error";
  }
}

