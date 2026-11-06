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
import { z } from "zod";
import { parse as parseFormUrlEncoded } from "node:querystring";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Public } from "../../common/public.decorator";
import type { AuthedRequest } from "../../common/auth.types";
import { clientIp } from "../../common/client-ip";
import { parseOrThrow } from "../../common/zod";
import { AppError, ErrorCode, isAppError } from "@app/shared";
import { env } from "../../config/env";
import { BillingService } from "./billing.service";
import { ChannelService, resolveAlipayConfig } from "./channels/channel.service";
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
const PAYMENT_MODES = ["native", "h5", "jsapi", "page", "precreate"] as const satisfies readonly PaymentMode[];

/**
 * 下单入参（SEC 审查：与其它模块一致改用 zod，而不是手工 as 断言）。
 * 手工校验有三个问题：多余字段被静默放行、类型错误与缺失报同一句话、
 * 同一份规则在 `/orders` 与 `/subscribe` 各写一遍必然漂移。
 */
const orderInputSchema = z.object({
  sku: z
    .string({ required_error: "sku is required", invalid_type_error: "sku is required" })
    .min(1, "sku is required")
    .max(128),
  channel: z.enum(CHANNELS, { errorMap: () => ({ message: "channel must be one of mock|wechat|alipay" }) }).optional(),
  mode: z.enum(PAYMENT_MODES, { errorMap: () => ({ message: "mode is invalid" }) }).optional(),
  openid: z.string().max(128).optional(),
});

/**
 * mock 渠道端点的准入判定（PR-02）。**纯函数**，本机无库也能测（test/payment-guard.spec.ts）。
 *
 * 修的是什么：原来只在 `PAYMENT_LIVE=true` 时才 403 —— 等于**拿业务开关当安全开关**。
 * `PAYMENT_LIVE` 缺省是 false（compose 也没传），于是按样例部署的生产实例
 * = 匿名 `POST /billing/notify/mock` 可入账 = mock 支付敞口。
 * 现在安全边界只认 `NODE_ENV`：生产一律硬拒，与 PAYMENT_LIVE 取值无关。
 *
 * `PAYMENT_LIVE=true` 仍然禁用 mock 是**叠加的联调约束**（真收款环境不该还能点"模拟支付"），
 * 它只能更严、不能代替上面那条安全判定。
 */
export function mockEndpointBlockReason(
  nodeEnv: string | undefined,
  paymentLive: boolean,
  action: string,
): string | null {
  if ((nodeEnv ?? "development") === "production") {
    return `${action} disabled in production (mock channel is never available on production)`;
  }
  if (paymentLive) return `${action} disabled when PAYMENT_LIVE=true`;
  return null;
}

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
    return this.billing.createOrder(req.auth?.spaceId ?? "", req.auth?.userId ?? "", {
      ...this.parseOrderInput(body),
      clientIp: clientIp(req),
    });
  }

  /**
   * 下单入参解析（两个入口共用）：schema 负责形状/枚举/nullable，
   * channel 的"缺省跟随 PAYMENT_LIVE"属于业务默认值，留在这一层。
   */
  private parseOrderInput(body: unknown): {
    sku: string;
    channel: (typeof CHANNELS)[number];
    mode?: PaymentMode;
    openid?: string;
  } {
    const input = parseOrThrow(orderInputSchema, body ?? {});
    const channel = input.channel ?? (env.PAYMENT_LIVE ? undefined : "mock");
    if (!channel) {
      throw new AppError(ErrorCode.INVALID_PARAM, "channel must be one of mock|wechat|alipay", {
        field: "channel",
      });
    }
    return { sku: input.sku, channel, mode: input.mode, openid: input.openid };
  }

  /** 订单状态轮询 */
  @Get("billing/orders/:id")
  async detail(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.billing.getOrder(req.auth?.spaceId ?? "", id);
  }

  // ── 订阅制（竞品 VIP 13 档 + 动态价格；第 23 项计费补齐）────────────────

  /**
   * 订阅档位（公开）：定价页/升级弹窗用。
   * 公开的理由与 `/billing/skus` 一致——未登录用户也要能看到价格档位。
   */
  @Public()
  @Get("billing/plans")
  async plans() {
    return { plans: await this.billing.listPlans() };
  }

  /**
   * 动态价格（公开，对照竞品 `sku-price`）。
   * 与 `listPlans` 的分工：这个按单个 sku 返回"牌价/活动价/折扣来源"，
   * 前端下单前用它展示"原价划掉 + 活动价"，避免把促销逻辑复制到前端。
   */
  @Public()
  @Get("billing/sku-price")
  async skuPrice(@Query("sku") sku?: string) {
    if (!sku) throw new AppError(ErrorCode.INVALID_PARAM, "sku is required", { field: "sku" });
    return this.billing.skuPrice(sku);
  }

  /**
   * 动态价格（POST 形状，第 85 批）。
   *
   * 竞品这条是 `POST /web/v1/buy/sku-price`（`requestBodyType: json`、两个 schema 都是 `{}`），
   * 我方原先只有 `GET /billing/sku-price` —— 按竞品形状发 POST 的客户端会 404。
   * 入参按"body 优先、query 兜底"取 sku：竞品把 sku 放 body 里，但既然没有字段证据，
   * 两种都收，免得它其实是放 query 时又打不通。
   */
  @Public()
  @Post("buy/sku-price")
  async skuPricePost(@Query("sku") skuQuery?: string, @Body() body?: unknown) {
    const input = (body ?? {}) as { sku?: unknown };
    const sku = typeof input.sku === "string" && input.sku ? input.sku : skuQuery;
    if (!sku) throw new AppError(ErrorCode.INVALID_PARAM, "sku is required", { field: "sku" });
    return this.billing.skuPrice(sku);
  }

  /**
   * 升级补差价**报价**（登录态；只读，不动钱）。
   * 前端用它在定价页给出"补 ¥X"的明确数字；真正下单仍走 /billing/orders（原价），
   * 折抵接入动钱路径需产品确认，已在进度文档 §5.4 第 1 条登记。
   */
  @Get("billing/upgrade-quote")
  async upgradeQuote(@Req() req: AuthedRequest, @Query("sku") sku?: string) {
    if (!sku) throw new AppError(ErrorCode.INVALID_PARAM, "sku is required", { field: "sku" });
    return this.billing.quoteUpgrade(req.auth?.spaceId ?? "", sku);
  }

  /** 当前订阅状态（登录态；无订阅返回 null，不是 404 —— 前端按 null 展示"未订阅"） */
  @Get("billing/subscription")
  async subscription(@Req() req: AuthedRequest) {
    return this.billing.currentSubscription(req.auth?.spaceId ?? "");
  }

  /** 订阅下单：复用普通下单链路（VIP sku），支付成功由 markPaid 激活订阅 */
  @Post("billing/subscribe")
  async subscribe(@Req() req: AuthedRequest, @Body() body: unknown) {
    const input = this.parseOrderInput(body);
    const plans = await this.billing.listPlans();
    if (!plans.some((plan) => plan.sku === input.sku)) {
      throw new AppError(ErrorCode.INVALID_PARAM, "sku is not a subscription plan", { field: "sku" });
    }
    return this.billing.createOrder(req.auth?.spaceId ?? "", req.auth?.userId ?? "", {
      sku: input.sku,
      channel: input.channel,
      mode: input.mode,
      clientIp: clientIp(req),
    });
  }

  /** 取消订阅（关自动续费；到期自然失效，不立即剥夺已付费权益） */
  @Post("billing/subscription/cancel")
  async cancelSubscription(@Req() req: AuthedRequest) {
    return this.billing.cancelSubscription(req.auth?.spaceId ?? "");
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
      /**
       * 走 ChannelService 的统一解析（同下单路径），而不是直接读 env：
       * `ALIPAY_PUBLIC_KEY` 允许单行 `\n` 转义写法、也允许用 `ALIPAY_PUBLIC_KEY_PATH`
       * 挂载密钥文件。直接读 env 时这两种配置都会让验签**静默失败**，渠道于是无限重推、
       * 订单永远不到账。
       */
      const alipay = resolveAlipayConfig(env);
      if (!alipay.config) {
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
        publicKeyPem: alipay.config.publicKeyPem,
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
   *
   * 生产一律 403（`NODE_ENV==="production"` 硬拒，PR-02：不再拿 PAYMENT_LIVE 当安全开关）。
   * 载荷里 `amount_cents` 必填——mock 没有渠道签名，省略金额就等于跳过金额校验。
   * 可选 `space_id`：传了就按空间归属校验（非生产联调时可用来验证归属拒绝分支）。
   */
  @Public()
  @Post("billing/notify/mock")
  async notifyMock(@Body() body: unknown) {
    this.assertMockEndpointEnabled("mock notify");
    const payload = (body ?? {}) as {
      order_id?: string;
      channel_order_id?: string;
      amount_cents?: number;
      space_id?: string;
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
      spaceId: payload.space_id,
    });
  }

  /**
   * mock 渠道"我已完成支付"（仅联调）。
   *
   * 生产一律 403（同上）。归属校验：订单必须属于**当前登录 space**（先按 space 取单，
   * 取不到即 NOT_FOUND，不泄露订单是否存在）；金额从库里这一行取，
   * 不信任客户端传值——因此这里既能满足 mock 渠道"金额必填"的口径，
   * 也不会把"由谁决定金额"交给调用方。
   */
  @Post("billing/orders/:id/mock-pay")
  async mockPay(@Req() req: AuthedRequest, @Param("id") id: string) {
    this.assertMockEndpointEnabled("mock pay");
    const spaceId = req.auth?.spaceId ?? "";
    const order = await this.billing.getOrder(spaceId, id);
    return this.billing.markPaid({
      orderId: id,
      channel: "mock",
      channelOrderId: `mock-${id}-${Date.now()}`,
      amountCents: order.amount_cents,
      spaceId,
    });
  }

  // ── 内部工具 ────────────────────────────────────────────────────────────

  /** mock 渠道端点准入（PR-02）：生产硬拒，非生产按 PAYMENT_LIVE 联调开关 */
  private assertMockEndpointEnabled(action: string): void {
    const reason = mockEndpointBlockReason(env.NODE_ENV, env.PAYMENT_LIVE, action);
    if (reason) throw new HttpException(reason, HttpStatus.FORBIDDEN);
  }

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

