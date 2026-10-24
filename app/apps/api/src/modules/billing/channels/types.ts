/**
 * 支付渠道适配层：与渠道无关的统一定义。
 *
 * 设计目标：
 * - 适配器可注入 fetch（契约测试不触网）；
 * - 所有渠道错误统一成 ChannelError（含 retryable 语义），由 service 层映射成 AppError；
 * - 支付参数（payParams）是可直接下发给前端的 JSON，不含任何密钥/证书内容。
 */

export type PaymentChannelId = "wechat" | "alipay";

/** 支付形态：决定前端如何呈现（二维码 / 跳转 / JSAPI 调起） */
export type PaymentMode = "native" | "h5" | "jsapi" | "page" | "precreate";

/** 下单入参（渠道无关） */
export interface CreatePaymentInput {
  /** 商户侧订单号（= orders.id），渠道幂等键 */
  outTradeNo: string;
  amountCents: number;
  /** 商品描述（渠道要求不能为空） */
  description: string;
  /** 渠道异步通知地址；未传则用适配器配置里的默认值 */
  notifyUrl?: string;
  /** 透传字段（微信 attach / 支付宝 passback_params 等） */
  attach?: string;
  /** H5 支付需要的用户端 IP */
  clientIp?: string;
  /** JSAPI 支付需要的用户 openid */
  openid?: string;
  /** 期望支付形态；不传则用渠道默认（微信 native / 支付宝 page） */
  mode?: PaymentMode;
  /** 订单过期秒数（渠道侧 time_expire） */
  expireSeconds?: number;
  /** 支付宝 page.pay 支付完成后跳回地址 */
  returnUrl?: string;
}

/** 渠道下单结果：payParams 原样下发给前端 */
export interface CreatedPayment {
  channel: PaymentChannelId;
  mode: PaymentMode;
  payParams: Record<string, unknown>;
}

export interface ChannelQueryResult {
  paid: boolean;
  /** 渠道状态原文（微信 trade_state / 支付宝 trade_status） */
  status: string;
  channelOrderId?: string;
  amountCents?: number;
  raw?: unknown;
}

export interface RefundInput {
  outTradeNo: string;
  /** 商户侧退款单号（幂等键） */
  outRefundNo: string;
  /** 原订单总额（分） */
  totalCents: number;
  /** 本次退款金额（分） */
  refundCents: number;
  reason?: string;
  notifyUrl?: string;
}

export interface RefundResult {
  refundId?: string;
  status?: string;
  raw?: unknown;
}

export interface PaymentChannelAdapter {
  readonly id: PaymentChannelId;
  readonly modes: PaymentMode[];
  /** 按 mode 下单（默认渠道主形态），返回可直接下发前端的支付参数 */
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  /** 主动查单（回调补偿；前端轮询不直接打渠道） */
  query(outTradeNo: string): Promise<ChannelQueryResult>;
  /** 关闭未支付订单（幂等，渠道侧可能返回订单不存在） */
  close(outTradeNo: string): Promise<void>;
  refund(input: RefundInput): Promise<RefundResult>;
}

/** 渠道可用性（GET /billing/channels 下发） */
export interface ChannelAvailability {
  channel: PaymentChannelId | "mock";
  configured: boolean;
  modes: PaymentMode[];
  /** 未配置时给出缺失项，便于部署排障（不含密钥值） */
  missing?: string[];
  reason?: string;
}

/** 把分转成渠道要求的元字符串（两位小数） */
export function centsToYuan(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 元字符串转分（支付宝回调 total_amount） */
export function yuanToCents(yuan: string | undefined): number | undefined {
  if (yuan === undefined || yuan === "") return undefined;
  const n = Number(yuan);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}
